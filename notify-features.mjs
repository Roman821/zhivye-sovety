import {generateKeyPairSync,createPrivateKey,sign} from 'node:crypto';
// Уведомления: список на сайте и push на телефон/компьютер.
// Push отправляется без содержимого (только сигнал): текст Service Worker забирает с нашего сервера,
// поэтому через службы Google/Apple/Mozilla не проходят данные Советов, а шифрование не нужно.
export function notifyFeatures(h){
 const {db,randomUUID,now,fail,str,json,body}=h;
 // Уведомления пока отключены по решению координатора (4 ноября 2026). Включить: SOVETY_NOTIFICATIONS=on в /etc/sovety.env.
 const enabled=process.env.SOVETY_NOTIFICATIONS==='on';
 db.exec(`CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS push_subscriptions(endpoint TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),created TEXT NOT NULL,last_seen TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,body TEXT NOT NULL,url TEXT NOT NULL DEFAULT '/',dedupe TEXT NOT NULL,created TEXT NOT NULL,read INTEGER NOT NULL DEFAULT 0,UNIQUE(user_id,dedupe));`);
 const b64u=b=>Buffer.from(b).toString('base64url');
 let vapid=db.prepare("SELECT value FROM app_settings WHERE key='vapid'").get()?.value;
 if(!vapid){vapid=JSON.stringify(generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey.export({format:'jwk'}));db.prepare("INSERT INTO app_settings VALUES('vapid',?)").run(vapid);}
 const jwk=JSON.parse(vapid),privateKey=createPrivateKey({key:jwk,format:'jwk'}),publicKey=b64u(Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]));
 const subject=process.env.PUBLIC_ORIGIN||'mailto:sovety@localhost';
 // Отправка только на адреса известных служб push — сервер не должен обращаться к произвольным адресам.
 const testOrigin=process.env.SOVETY_PUSH_TEST_ORIGIN||'';
 function allowedEndpoint(v){let u;try{u=new URL(v);}catch{return false;}if(testOrigin&&u.origin===testOrigin)return true;return u.protocol==='https:'&&!u.port&&['.googleapis.com','.push.apple.com','.push.services.mozilla.com','.notify.windows.com'].some(s=>u.hostname.endsWith(s));}
 function vapidJwt(aud){const head=b64u(JSON.stringify({typ:'JWT',alg:'ES256'})),claims=b64u(JSON.stringify({aud,exp:Math.floor(Date.now()/1000)+12*3600,sub:subject}));return head+'.'+claims+'.'+b64u(sign('sha256',Buffer.from(head+'.'+claims),{key:privateKey,dsaEncoding:'ieee-p1363'}));}
 async function pushTo(endpoint){try{const r=await fetch(endpoint,{method:'POST',headers:{TTL:'86400',Urgency:'normal',Authorization:`vapid t=${vapidJwt(new URL(endpoint).origin)}, k=${publicKey}`},body:new Uint8Array(0),signal:AbortSignal.timeout(10000)});if([404,410].includes(r.status))db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(endpoint);else if(!r.ok)console.error('Push не доставлен:',r.status,new URL(endpoint).hostname);}catch(e){console.error('Push не отправлен:',e.message);}}
 // userIds — аккаунты получателей; dedupe защищает от повторов одного и того же уведомления.
 function notify(userIds,{title,body:text,url='/',dedupe},actor){
  if(!enabled)return 0;
  const ids=[...new Set(userIds)].filter(id=>id&&id!==actor?.id&&db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(id));const fresh=[];
  for(const id of ids){const r=db.prepare('INSERT OR IGNORE INTO notifications(id,user_id,title,body,url,dedupe,created) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),id,title.slice(0,120),text.slice(0,300),url,dedupe||randomUUID(),now());if(r.changes)fresh.push(id);}
  for(const id of fresh)for(const s of db.prepare('SELECT endpoint FROM push_subscriptions WHERE user_id=?').all(id))pushTo(s.endpoint);
  return fresh.length;
 }
 const usersOfPeople=ids=>ids.length?db.prepare(`SELECT user_id FROM council_roster WHERE user_id<>'' AND id IN (${ids.map(()=>'?').join(',')})`).all(...ids).map(r=>r.user_id):[];
 const usersOfCouncils=names=>{const set=new Set();for(const c of names){for(const r of db.prepare('SELECT id FROM users WHERE council=? AND active=1').all(c))set.add(r.id);for(const r of db.prepare("SELECT r.user_id FROM council_memberships m JOIN council_roster r ON r.id=m.person_id WHERE m.council=? AND r.user_id<>''").all(c))set.add(r.user_id);}return [...set];};
 const kinds={meeting:'заседание',vks:'ВКС',task:'задача',initiative:'инициатива',project:'проект',problem:'проблема'};
 const fmt=d=>d?new Date(d+'T12:00:00Z').toLocaleDateString('ru-RU',{day:'numeric',month:'long'}):'';
 // События платформы
 function itemSaved(item,old,actor){
  const added=JSON.parse(item.assignee_ids).filter(id=>!JSON.parse(old?.assignee_ids||'[]').includes(id));
  notify(usersOfPeople(added),{title:'Вам назначена '+(item.kind==='task'?'задача':'запись: '+kinds[item.kind]),body:item.title+(item.deadline?' · срок '+fmt(item.deadline):''),url:'/#item='+item.id,dedupe:'assign:'+item.id+':'+added.join(',')},actor);
  if(['meeting','vks'].includes(item.kind)&&!old){const people=item.audience==='people'?usersOfPeople(JSON.parse(item.audience_ids)):usersOfCouncils([item.council]);notify(people,{title:'Запланировано '+(item.kind==='vks'?'ВКС':'заседание'),body:item.title+' · '+fmt(item.deadline)+(item.start_time?' в '+item.start_time:''),url:'/#item='+item.id,dedupe:'meeting:'+item.id},actor);}
 }
 function subtaskSaved(s,item,oldIds,actor){const added=JSON.parse(s.assignee_ids).filter(id=>!oldIds.includes(id));notify(usersOfPeople(added),{title:'Вам назначена подзадача',body:s.title+' · '+item.title+(s.deadline?' · срок '+fmt(s.deadline):''),url:'/#item='+item.id,dedupe:'subtask:'+s.id+':'+added.join(',')},actor);}
 function reportRequested(request,councils,actor){notify(usersOfCouncils(councils),{title:'Запрошен отчёт',body:request.title+' · срок '+fmt(request.deadline),url:'/#page=reports',dedupe:'request:'+request.id},actor);}
 // Напоминания о сроках «на завтра» — днём по Красноярску, один раз на запись.
 const local=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Krasnoyarsk',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(d).reduce((a,p)=>(a[p.type]=p.value,a),{});
 function reminders(at=new Date()){
  const p=local(at),hour=Number(p.hour);if(hour<9||hour>=21)return 0;const t=local(new Date(at.getTime()+86400000)),tomorrow=`${t.year}-${t.month}-${t.day}`;let sent=0;
  for(const i of db.prepare("SELECT * FROM items WHERE deadline=? AND status NOT IN ('done','archive')").all(tomorrow)){
   const meeting=['meeting','vks'].includes(i.kind),users=meeting?(i.audience==='people'?usersOfPeople(JSON.parse(i.audience_ids)):usersOfCouncils([i.council])):usersOfPeople(JSON.parse(i.assignee_ids));
   sent+=notify(users,{title:meeting?'Завтра '+(i.kind==='vks'?'ВКС':'заседание'):'Завтра срок: '+kinds[i.kind],body:i.title+(i.start_time?' в '+i.start_time:''),url:'/#item='+i.id,dedupe:'due:'+i.id+':'+tomorrow});
  }
  for(const s of db.prepare("SELECT s.*,i.title AS item_title,i.status AS item_status FROM item_subtasks s JOIN items i ON i.id=s.item_id WHERE s.deadline=? AND s.done=0").all(tomorrow))if(s.item_status!=='archive')sent+=notify(usersOfPeople(JSON.parse(s.assignee_ids)),{title:'Завтра срок подзадачи',body:s.title+' · '+s.item_title,url:'/#item='+s.item_id,dedupe:'due-sub:'+s.id+':'+tomorrow});
  for(const e of db.prepare('SELECT * FROM personal_entries WHERE date=? AND done=0').all(tomorrow))sent+=notify([e.user_id],{title:'Завтра в личном календаре',body:e.title+(e.start_time?' в '+e.start_time:''),url:'/#page=calendar',dedupe:'due-personal:'+e.id+':'+tomorrow});
  for(const r of db.prepare("SELECT c.id,c.council,q.title,q.deadline,q.id AS request_id FROM council_reports c JOIN report_requests q ON q.id=c.request_id WHERE q.deadline=? AND c.status<>'submitted' AND c.deleted_at=''").all(tomorrow))sent+=notify(usersOfCouncils([r.council]),{title:'Завтра срок отчёта',body:r.title+' · '+r.council,url:'/#page=reports',dedupe:'due-report:'+r.id+':'+tomorrow});
  return sent;
 }
 if(!enabled)db.exec('DELETE FROM push_subscriptions');
 if(enabled){const timer=setInterval(()=>{try{reminders();}catch(e){console.error(e);}},30*60000);timer.unref();setTimeout(()=>{try{reminders();}catch(e){console.error(e);}},15000).unref();}
 const view=n=>({...n,read:!!n.read});
 const handler=async(req,res,p,u)=>{
  if(!p.startsWith('/api/push/')&&!p.startsWith('/api/notifications'))return false;
  if(!enabled)fail('Уведомления отключены.',404);
  if(p==='/api/push/key'&&req.method==='GET'){json(res,{key:publicKey});return true;}
  if(p==='/api/push/subscribe'&&req.method==='POST'){const b=await body(req),endpoint=str(b.endpoint,1000);if(!allowedEndpoint(endpoint))fail('Этот браузер использует неизвестную службу уведомлений.');if(db.prepare('SELECT count(*) AS n FROM push_subscriptions WHERE user_id=?').get(u.id).n>=10)db.prepare('DELETE FROM push_subscriptions WHERE endpoint=(SELECT endpoint FROM push_subscriptions WHERE user_id=? ORDER BY last_seen LIMIT 1)').run(u.id);db.prepare('INSERT INTO push_subscriptions VALUES(?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,last_seen=excluded.last_seen').run(endpoint,u.id,now(),now());json(res,{ok:true});return true;}
  if(p==='/api/push/test'&&req.method==='POST'){notify([u.id],{title:'Уведомления включены',body:'Так будут приходить новости о ваших задачах, заседаниях и отчётах.',url:'/',dedupe:'test:'+Date.now()});json(res,{ok:true});return true;}
  if(p==='/api/push/unsubscribe'&&req.method==='POST'){const b=await body(req);db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?').run(str(b.endpoint,1000),u.id);json(res,{ok:true});return true;}
  if(p==='/api/notifications'&&req.method==='GET'){json(res,{notifications:db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created DESC LIMIT 50').all(u.id).map(view),unread:db.prepare('SELECT count(*) AS n FROM notifications WHERE user_id=? AND read=0').get(u.id).n,push:db.prepare('SELECT count(*) AS n FROM push_subscriptions WHERE user_id=?').get(u.id).n>0});return true;}
  if(p==='/api/notifications/read'&&req.method==='POST'){db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(u.id);json(res,{ok:true});return true;}
  // Service Worker забирает тексты, появившиеся после прошлого показа на этом устройстве.
  if(p==='/api/notifications/pending'&&req.method==='POST'){const b=await body(req),sub=db.prepare('SELECT * FROM push_subscriptions WHERE endpoint=? AND user_id=?').get(str(b.endpoint,1000),u.id),since=sub?.last_seen||new Date(Date.now()-3600000).toISOString();const list=db.prepare('SELECT * FROM notifications WHERE user_id=? AND created>? AND read=0 ORDER BY created DESC LIMIT 5').all(u.id,since).map(view);if(sub)db.prepare('UPDATE push_subscriptions SET last_seen=? WHERE endpoint=?').run(now(),sub.endpoint);json(res,{notifications:list});return true;}
  fail('Такого действия нет.',404);
 };
 Object.assign(handler,{enabled,notify,itemSaved,subtaskSaved,reportRequested,reminders,publicKey,backup:()=>({notifications:db.prepare('SELECT * FROM notifications').all()})});
 return handler;
}
