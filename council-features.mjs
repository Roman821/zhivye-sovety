export function councilFeatures(h){
 const {db,randomUUID,now,fail,required,str,admin,canEdit,json,body,transaction,manager,validatePersonIds,profileValues,publicPerson,canViewPerson,userRoles,roleLabels}=h;
 db.exec(`CREATE TABLE IF NOT EXISTS council_directory(name TEXT PRIMARY KEY,level TEXT NOT NULL,parent TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS council_roster(id TEXT PRIMARY KEY,council TEXT NOT NULL REFERENCES council_directory(name),name TEXT NOT NULL,position TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS report_requests(id TEXT PRIMARY KEY,title TEXT NOT NULL,year INTEGER NOT NULL,deadline TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS council_reports(id TEXT PRIMARY KEY,request_id TEXT REFERENCES report_requests(id),council TEXT NOT NULL,year INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'draft',months TEXT NOT NULL DEFAULT '[]',local_practice TEXT NOT NULL DEFAULT '',primary_practice TEXT NOT NULL DEFAULT '',updated TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,UNIQUE(request_id,council));`);

 for(const [table,column,definition] of [['council_roster','positions',"TEXT NOT NULL DEFAULT '[]'"],['council_reports','activities',"TEXT NOT NULL DEFAULT '[]'"],['council_reports','no_events','INTEGER NOT NULL DEFAULT 0'],['council_reports','deleted_at',"TEXT NOT NULL DEFAULT ''"]])if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
 const roster=r=>publicPerson(r);const rosterFor=(r,u)=>canViewPerson(u,r)?{...roster(r),can_view:true,can_edit:canEdit(u,r)}:{id:r.id,council:r.council,name:r.name,position:r.position,positions:JSON.parse(r.positions).length?JSON.parse(r.positions):[r.position],archived:r.archived,can_view:false,can_edit:false};
 const report=r=>({...r,months:JSON.parse(r.months),activities:JSON.parse(r.activities),no_events:!!r.no_events});
 const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
 function validActivities(list,y,submitted,u,permitted=[]){
  if(!Array.isArray(list)||list.length>300)fail('Добавьте не более 300 мероприятий в один отчёт.');
  return list.map((a,i)=>{
   if(!a||typeof a!=='object')fail('Проверьте карточку мероприятия.');
   const label=`Мероприятие ${i+1}: `,v={};
   for(const [k,t,max] of [['name','название',200],['date','дата',10],['level','уровень',20],['department','отделение / Совет',200],['location','место проведения',500],['organizers','организаторы',1000],['council_role','роль Совета',30],['contribution','участие Совета',3000],['description','описание',5000],['result','результат',3000],['post_url','ссылка на пост',2000]]){
    if(typeof a[k]==='string'&&a[k].trim().length>max)fail(label+`поле «${t}» слишком длинное.`);
    v[k]=str(a[k],max);if(submitted&&k!=='post_url'&&!v[k])fail(label+`заполните поле «${t}».`);
   }
   if(v.date&&(!validDate(v.date)||Number(v.date.slice(0,4))!==y))fail(label+'дата должна быть в отчётном году.');
   if(v.level&&!['local','primary','regional'].includes(v.level))fail(label+'выберите региональный, местный или первичный уровень.');
   if(v.council_role&&!['organizer','coorganizer','participant','other','none'].includes(v.council_role))fail(label+'выберите роль Совета.');
   if(v.post_url){let url;try{url=new URL(v.post_url);}catch{fail(label+'проверьте ссылку на пост.');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password)fail(label+'ссылка должна начинаться с https:// или http://.');}
   if(a.initiated!==true&&a.initiated!==false&&!(a.initiated===null&&!submitted))fail(label+'укажите, инициировано ли событие Советом.');v.initiated=a.initiated;
   if(a.participants===null&&!submitted)v.participants=null;else{if(!Number.isSafeInteger(a.participants)||a.participants<0||a.participants>100000000)fail(label+'укажите целое неотрицательное число участников.');v.participants=a.participants;}
   v.participant_ids=validatePersonIds(a.participant_ids||[],u,permitted);if(v.participants!==null&&v.participant_ids.length>v.participants)fail(label+'отмеченных участников больше, чем общее число присутствующих.');return v;
  });
 }
 function activityMonths(list){const months=Array.from({length:12},()=>[0,0,0,0,0,0]);for(const a of list)if(a.initiated===true&&validDate(a.date)&&['local','primary','regional'].includes(a.level)){const j=Number(a.date.slice(5,7))-1,k=a.level==='regional'?4:a.level==='local'?0:1;months[j][k]++;months[j][k===4?5:k+2]+=a.participants||0;}return months;}

 const year=v=>{if(!Number.isInteger(v)||v<2000||v>2100)fail('Укажите год от 2000 до 2100.');return v;};
 const getReport=(id,u)=>{const r=db.prepare('SELECT * FROM council_reports WHERE id=?').get(id);if(!r)fail('Отчёт не найден.',404);if(!canEdit(u,r))fail('Этот отчёт доступен его Совету и координатору.',403);return r;};
 const handler=async(req,res,p,u)=>{
 if(!p.startsWith('/api/council-')&&!p.startsWith('/api/report-'))return false;
 if(p==='/api/council-data'&&req.method==='GET'){
 const directory=db.prepare('SELECT * FROM council_directory ORDER BY name').all();
 const names=[...new Set([...directory.map(c=>c.name),...db.prepare('SELECT DISTINCT council FROM users WHERE active=1').all().map(c=>c.council)])].sort();
 const baseRoster=(manager(u)?db.prepare('SELECT * FROM council_roster WHERE archived=0 ORDER BY council,name').all():db.prepare('SELECT * FROM council_roster WHERE council=? AND archived=0 ORDER BY name').all(u.council)).map(r=>rosterFor(r,u));
 const linked=db.prepare('SELECT m.council AS member_council,m.positions AS member_positions,r.* FROM council_memberships m JOIN council_roster r ON r.id=m.person_id WHERE r.archived=0 AND m.council<>r.council ORDER BY m.council,r.name').all().filter(r=>manager(u)||r.member_council===u.council).map(r=>({...rosterFor(r,u),council:r.member_council,home_council:r.council,positions:JSON.parse(r.member_positions),membership:true,can_edit:canEdit(u,r)&&canEdit(u,{council:r.member_council})}));
 json(res,{directory,names,roster:[...baseRoster,...linked],requests:manager(u)?db.prepare('SELECT * FROM report_requests ORDER BY created DESC').all():db.prepare('SELECT DISTINCT q.* FROM report_requests q JOIN council_reports r ON r.request_id=q.id WHERE r.council=? ORDER BY q.created DESC').all(u.council),reports:(manager(u)?db.prepare("SELECT * FROM council_reports WHERE deleted_at='' ORDER BY updated DESC").all():db.prepare("SELECT * FROM council_reports WHERE council=? AND deleted_at='' ORDER BY updated DESC").all(u.council)).map(report),deletedReports:(manager(u)?db.prepare("SELECT * FROM council_reports WHERE deleted_at<>'' ORDER BY deleted_at DESC").all():db.prepare("SELECT * FROM council_reports WHERE council=? AND deleted_at<>'' ORDER BY deleted_at DESC").all(u.council)).map(report)});return true;
 }
 if(p==='/api/council-directory'&&req.method==='POST'){if(u.signup_source==='self'&&!manager(u))fail('Советы добавляет управляющий.',403);
 const b=await body(req),name=required(b.name,'Название Совета',200);if(!canEdit(u,{council:name}))fail('Можно вести только свой Совет.',403);
 if(!['regional','local','primary'].includes(b.level))fail('Выберите уровень Совета.');const parent=str(b.parent,200);if(parent===name)fail('Совет не может быть вышестоящим для себя.');
 db.prepare('INSERT INTO council_directory VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET level=excluded.level,parent=excluded.parent').run(name,b.level,parent);json(res,{ok:true});return true;
 }
 if(p==='/api/council-roster'&&req.method==='POST'){
 const b=await body(req),council=required(b.council,'Совет',200);if(!canEdit(u,{council}))fail('Можно вести только состав своего Совета.',403);
 if(!db.prepare('SELECT name FROM council_directory WHERE name=?').get(council))fail('Сначала добавьте Совет и его уровень.');
 const old=b.id?db.prepare('SELECT * FROM council_roster WHERE id=?').get(b.id):null;if(b.id&&!old)fail('Участник не найден.',404);if(old&&!canEdit(u,old))fail('Нет доступа к составу.',403);
 if(u.signup_source==='self'&&!manager(u)&&(!old||old.user_id!==u.id))fail('Можно изменять только свою карточку.',403);
 const name=required(b.name,'ФИО',200),list=b.positions??[b.position];if(!Array.isArray(list)||!list.length||list.length>20||list.some(v=>typeof v!=='string'||!v.trim()||v.trim().length>200))fail('Укажите одну или несколько должностей, не более 20.');
 if(u.signup_source==='self'&&!manager(u)){const allowed=[...userRoles(u).map(r=>roleLabels[r]),...(old?(JSON.parse(old.positions).length?JSON.parse(old.positions):[old.position]):[])];if(list.some(v=>!allowed.includes(v.trim())))fail('Должности назначает управляющий.',403);}
 const positions=[...new Set(list.map(v=>v.trim()))],profile=profileValues(b,old||{}),row={council,name,position:positions.join('; '),positions:JSON.stringify(positions),updated:now(),...profile},keys=Object.keys(row),id=old?.id||randomUUID();
 if(old)db.prepare(`UPDATE council_roster SET ${keys.map(k=>k+'=?').join(',')} WHERE id=?`).run(...keys.map(k=>row[k]),id);else db.prepare(`INSERT INTO council_roster(id,${keys.join(',')}) VALUES(?,${keys.map(()=>'?').join(',')})`).run(id,...keys.map(k=>row[k]));json(res,{id});return true;
 }
 if(p==='/api/council-roster/remove'&&req.method==='POST'){
 if(u.signup_source==='self'&&!manager(u))fail('Исключать участников может управляющий.',403);const b=await body(req),old=db.prepare('SELECT * FROM council_roster WHERE id=?').get(b.id);if(!old)fail('Участник не найден.',404);if(!canEdit(u,old))fail('Нет доступа к этому составу.',403);db.prepare('UPDATE council_roster SET archived=1 WHERE id=?').run(b.id);json(res,{ok:true});return true;
 }
 if(p==='/api/report-requests'&&req.method==='POST'){
 admin(u);const b=await body(req),title=required(b.title,'Название запроса',200),y=year(b.year),deadline=required(b.deadline,'Срок',10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(deadline)||isNaN(Date.parse(deadline))||new Date(deadline).toISOString().slice(0,10)!==deadline)fail('Проверьте дату срока.');
 if(!Array.isArray(b.councils)||!b.councils.length||b.councils.length>300)fail('Выберите от 1 до 300 Советов.');
 const targets=[...new Set(b.councils.map(c=>required(c,'Совет',200)))];
 for(const council of targets)if(!db.prepare('SELECT name FROM council_directory WHERE name=? UNION SELECT council FROM users WHERE council=?').get(council,council))fail('Добавьте Совет перед запросом отчёта.');
 const id=randomUUID();transaction(()=>{db.prepare('INSERT INTO report_requests VALUES(?,?,?,?,?)').run(id,title,y,deadline,now());for(const c of targets)db.prepare('INSERT INTO council_reports(id,request_id,council,year,updated) VALUES(?,?,?,?,?)').run(randomUUID(),id,c,y,now());});json(res,{id},201);return true;
 }
 if(p==='/api/council-reports'&&req.method==='POST'){
 const b=await body(req),council=manager(u)?required(b.council,'Совет',200):u.council,y=year(b.year),id=randomUUID();
 db.prepare('INSERT INTO council_reports(id,council,year,updated) VALUES(?,?,?,?)').run(id,council,y,now());json(res,{report:report(db.prepare('SELECT * FROM council_reports WHERE id=?').get(id))},201);return true;
 }
 const removal=p.match(/^\/api\/council-reports\/([a-f0-9-]+)\/(trash|restore)$/);
 if(removal&&req.method==='POST'){const old=getReport(removal[1],u),b=await body(req),deleted=removal[2]==='trash'?now():'';const change=db.prepare('UPDATE council_reports SET deleted_at=?,version=version+1 WHERE id=? AND version=?').run(deleted,old.id,b.version);if(!change.changes)fail('Отчёт уже изменён. Обновите список.',409);json(res,{ok:true});return true;}
 const m=p.match(/^\/api\/council-reports\/([a-f0-9-]+)$/);
 if(m&&req.method==='PUT'){
 const old=getReport(m[1],u),b=await body(req);if(old.deleted_at)fail('Сначала восстановите отчёт из корзины.',409);if(!['draft','submitted'].includes(b.status))fail('Выберите статус отчёта.');
 const activities=validActivities(b.activities,old.year,b.status==='submitted',u,JSON.parse(old.activities).flatMap(a=>a.participant_ids||[]));
 const legacy=JSON.parse(old.activities).length===0&&JSON.parse(old.months).some(row=>row.some(n=>n>0));if(legacy&&b.replace_legacy!==true)fail('Подтвердите замену ранее введённых итогов расчётом по карточкам мероприятий.');
 if(b.status==='submitted'&&!activities.length&&b.no_events!==true)fail('Добавьте мероприятия или подтвердите, что мероприятий за год не было.');
 if(activities.length&&b.no_events===true)fail('Уберите отметку об отсутствии мероприятий: в отчёте есть карточки.');
 const months=activityMonths(activities);
 const lp=str(b.local_practice,12000),pp=str(b.primary_practice,12000);if(b.status==='submitted'&&(!lp||!pp))fail('Опишите минимум одну яркую практику местного и первичного отделений.');
 const changed=db.prepare('UPDATE council_reports SET months=?,local_practice=?,primary_practice=?,status=?,updated=?,activities=?,no_events=?,version=version+1 WHERE id=? AND version=?').run(JSON.stringify(months),lp,pp,b.status,now(),JSON.stringify(activities),b.no_events?1:0,old.id,b.version);if(!changed.changes)fail('Отчёт уже изменён. Откройте его заново.',409);json(res,{ok:true});return true;
 }
 fail('Такого действия нет.',404);
 };
 handler.backup=()=>({directory:db.prepare('SELECT * FROM council_directory').all(),roster:db.prepare('SELECT * FROM council_roster').all().map(r=>({...r,positions:JSON.parse(r.positions)})),reportRequests:db.prepare('SELECT * FROM report_requests').all(),reports:db.prepare('SELECT * FROM council_reports').all().map(report)});
 return handler;
}
