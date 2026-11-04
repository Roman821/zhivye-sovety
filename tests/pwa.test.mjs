import {test} from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import http from 'node:http';import {createPublicKey,verify} from 'node:crypto';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
test('Веб-приложение: манифест, Service Worker, уведомления и push с подписью VAPID',{timeout:30000},async()=>{
 const data=mkdtempSync(join(tmpdir(),'sovety-pwa-'));let child;const pushes=[];
 const receiver=http.createServer((req,res)=>{pushes.push({url:req.url,headers:req.headers});res.writeHead(req.url.includes('gone')?410:201);res.end();});
 await new Promise(r=>receiver.listen(0,'127.0.0.1',r));const pushOrigin=`http://127.0.0.1:${receiver.address().port}`;
 try{
 child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(20000+Math.floor(Math.random()*20000)),SOVETY_DATA_DIR:data,SOVETY_PUSH_TEST_ORIGIN:pushOrigin,SOVETY_NOTIFICATIONS:'on'},stdio:['ignore','pipe','pipe']});
 const url=await new Promise((resolve,reject)=>{let out='';const t=setTimeout(()=>reject(new Error(out)),8000);child.stdout.on('data',c=>{out+=c;const m=out.match(/http:\/\/127.0.0.1:\d+/);if(m){clearTimeout(t);resolve(m[0]);}});child.stderr.on('data',c=>out+=c);child.once('exit',()=>{clearTimeout(t);reject(new Error(out));});});
 async function req(p,method='GET',value,cookie){const r=await fetch(url+'/api'+p,{method,headers:{...(value?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:value?JSON.stringify(value):undefined});return {status:r.status,data:await r.json()};}
 async function login(email,password){const r=await fetch(url+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});return r.headers.get('set-cookie').split(';')[0];}
 // Файлы приложения
 const manifest=await fetch(url+'/manifest.webmanifest');assert.match(manifest.headers.get('content-type'),/application\/manifest\+json/);const m=await manifest.json();assert.equal(m.display,'standalone');assert.ok(m.icons.some(i=>i.sizes==='512x512'&&i.purpose==='maskable'));
 for(const f of ['/sw.js','/pwa.js','/icon-192.png','/icon-512.png','/apple-touch-icon.png'])assert.equal((await fetch(url+f)).status,200,f);
 assert.match(await (await fetch(url+'/')).text(),/rel="manifest"/);
 const password='test-strong-123';await req('/setup','POST',{name:'Координатор',email:'owner@example.test',password,council:'Ширинский район'});const owner=await login('owner@example.test',password);
 await req('/council-directory','POST',{name:'Ширинский район',level:'local'},owner);
 const inv=await req('/invites','POST',{name:'Петрова Анна',roles:['member'],council:'Ширинский район'},owner);await req('/register','POST',{name:'Петрова Анна',email:'anna@example.test',password,code:inv.data.code});const anna=await login('anna@example.test',password);
 // Подписка: только известные службы push (в тесте — локальная).
 const key=(await req('/push/key','GET',undefined,anna)).data.key;assert.equal(Buffer.from(key,'base64url').length,65);
 assert.equal((await req('/push/subscribe','POST',{endpoint:'https://evil.example/collect'},anna)).status,400);
 assert.equal((await req('/push/subscribe','POST',{endpoint:'http://169.254.169.254/latest'},anna)).status,400);
 assert.equal((await req('/push/subscribe','POST',{endpoint:pushOrigin+'/device-1'},anna)).status,200);
 assert.equal((await req('/notifications','GET',undefined,anna)).data.push,true);
 // Назначение задачи создаёт уведомление и отправляет push без содержимого.
 const person=(await req('/people-data','GET',undefined,owner)).data.people.find(p=>p.name==='Петрова Анна').id;
 const item=(await req('/items','POST',{title:'Подготовить форум',kind:'task',description:'Описание',council:'Ширинский район',priority:'normal',status:'new',deadline:'2026-12-01',assignee_ids:[person]},owner)).data.item;
 for(let i=0;i<50&&!pushes.length;i++)await new Promise(r=>setTimeout(r,50));
 assert.equal(pushes.length,1);assert.equal(pushes[0].url,'/device-1');assert.equal(pushes[0].headers['content-length'],'0');assert.ok(pushes[0].headers.ttl);
 const [,jwt,k]=pushes[0].headers.authorization.match(/^vapid t=([^,]+), k=(.+)$/);assert.equal(k,key);
 const [h,c,s]=jwt.split('.'),claims=JSON.parse(Buffer.from(c,'base64url'));assert.equal(claims.aud,pushOrigin);assert.ok(claims.exp>Date.now()/1000);
 const raw=Buffer.from(key,'base64url'),pub=createPublicKey({key:{kty:'EC',crv:'P-256',x:raw.subarray(1,33).toString('base64url'),y:raw.subarray(33).toString('base64url')},format:'jwk'});
 assert.ok(verify('sha256',Buffer.from(h+'.'+c),{key:pub,dsaEncoding:'ieee-p1363'},Buffer.from(s,'base64url')),'подпись VAPID верна');
 // Тексты Service Worker забирает с нашего сервера, повторно не показывает.
 const pending=(await req('/notifications/pending','POST',{endpoint:pushOrigin+'/device-1'},anna)).data.notifications;assert.equal(pending.length,1);assert.equal(pending[0].title,'Вам назначена задача');assert.match(pending[0].body,/Подготовить форум/);assert.equal(pending[0].url,'/#item='+item.id);
 assert.equal((await req('/notifications/pending','POST',{endpoint:pushOrigin+'/device-1'},anna)).data.notifications.length,0);
 // Повторное сохранение без новых ответственных не дублирует уведомление; автору уведомление не приходит.
 await req('/items/'+item.id,'PUT',{...item,title:'Подготовить форум активистов',version:item.version},owner);
 assert.equal((await req('/notifications','GET',undefined,anna)).data.unread,1);assert.equal((await req('/notifications','GET',undefined,owner)).data.notifications.length,0);
 // Подзадача и запрос отчёта
 await req('/items/'+item.id+'/subtasks','POST',{title:'Найти площадку',deadline:'2026-11-20',assignee_ids:[person]},owner);
 await req('/report-requests','POST',{title:'Годовой отчёт',year:2026,deadline:'2026-12-20',councils:['Ширинский район']},owner);
 const list=(await req('/notifications','GET',undefined,anna)).data;assert.equal(list.unread,3);assert.deepEqual(list.notifications.map(n=>n.title).sort(),['Вам назначена задача','Вам назначена подзадача','Запрошен отчёт'].sort());
 assert.equal((await req('/push/test','POST',{},anna)).status,200);assert.equal((await req('/notifications','GET',undefined,anna)).data.notifications[0].title,'Уведомления включены');
 assert.equal((await req('/notifications/read','POST',{},anna)).status,200);assert.equal((await req('/notifications','GET',undefined,anna)).data.unread,0);
 // Исчезнувшая подписка (410) удаляется.
 await req('/push/subscribe','POST',{endpoint:pushOrigin+'/gone'},anna);await req('/items/'+item.id+'/subtasks','POST',{title:'Ещё шаг',assignee_ids:[person]},owner);
 for(let i=0;i<50&&!pushes.some(p=>p.url==='/gone');i++)await new Promise(r=>setTimeout(r,50));await new Promise(r=>setTimeout(r,200));
 assert.equal((await req('/push/unsubscribe','POST',{endpoint:pushOrigin+'/device-1'},anna)).status,200);assert.equal((await req('/notifications','GET',undefined,anna)).data.push,false);
 assert.equal((await req('/notifications','GET')).status,401);
 }finally{receiver.close();if(child?.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}rmSync(data,{recursive:true,force:true});}
});
