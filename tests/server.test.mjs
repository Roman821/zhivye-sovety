import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
test('Рабочий цикл, роли, защита и сохранение данных',{timeout:60000},async()=>{
 const data=mkdtempSync(join(tmpdir(),'sovety-test-'));let child,url;
 async function start(){child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'0',SOVETY_DATA_DIR:data},stdio:['ignore','pipe','pipe']});let output='';url=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Server timeout: '+output)),10000);child.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/http:\/\/127.0.0.1:\d+/);if(m){clearTimeout(timeout);resolve(m[0]);}});child.stderr.on('data',c=>output+=c);child.once('exit',()=>{clearTimeout(timeout);reject(new Error(output));});});}
 async function stop(){if(child?.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}}
 async function request(path,{method='GET',body,cookie,origin}={}){const headers={};if(body)headers['Content-Type']='application/json';if(cookie)headers.Cookie=cookie;if(origin)headers.Origin=origin;const r=await fetch(url+'/api'+path,{method,headers,body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 const profile={name:'Координатор теста',email:'admin@example.test',password:'a strong password 123',council:'Региональный Совет'};
 const item={title:'Совместная встреча',kind:'initiative',description:'Обсудить планы Советов',goal:'Согласовать действия',owner:'Команда',council:'Региональный Совет',deadline:'2026-11-12',priority:'normal',status:'new'};
 try{
 await start();assert.equal((await request('/bootstrap')).data.setupRequired,true);
 assert.equal((await request('/items')).status,401);
 const setup=await request('/setup',{method:'POST',body:profile});assert.equal(setup.status,201);const admin=setup.cookie;assert.ok(admin);
 assert.equal((await request('/bootstrap',{cookie:admin})).data.user.role,'admin');assert.ok(!(await request('/bootstrap',{cookie:admin})).data.user.password);
 assert.equal((await request('/setup',{method:'POST',body:profile})).status,409);
 assert.equal((await request('/login',{method:'POST',body:{email:profile.email,password:'wrong'}})).status,401);
 assert.equal((await request('/items',{method:'POST',cookie:admin,origin:'https://untrusted.test',body:item})).status,403);
 const a=await request('/items',{method:'POST',cookie:admin,body:item});assert.equal(a.status,201);const id=a.data.item.id;
 for(const role of ['chair','deputy_chair','secretary','press_secretary','member','municipal_curator','specialist','local_delegate','regional_delegate']) { const invitation=await request('/invites',{method:'POST',cookie:admin,body:{role,council:'Тестовый Совет'}}); assert.equal(invitation.status,201); assert.equal(invitation.data.role,role); }
 assert.equal((await request('/invites',{method:'POST',cookie:admin,body:{role:'admin',council:'Тестовый Совет'}})).status,400);
 const inv=await request('/invites',{method:'POST',cookie:admin,body:{roles:['chair','secretary','regional_delegate'],council:'Ширинский район'}});assert.equal(inv.status,201);
 const reg=await request('/register',{method:'POST',body:{name:'Председатель',email:'chair@example.test',password:profile.password,code:inv.data.code,role:'admin',council:'Региональный Совет'}});assert.equal(reg.status,201);assert.equal(reg.data.user.role,'chair');assert.equal(reg.data.user.council,'Ширинский район');const chair=reg.cookie;assert.deepEqual(reg.data.user.roles,['chair','secretary','regional_delegate']);
 // Council directories and rosters are independent from login accounts.
 assert.equal((await request('/council-data')).status,401);
 assert.equal((await request('/council-directory',{method:'POST',cookie:admin,body:{name:'Ширинский район',level:'local'}})).status,200);
 assert.equal((await request('/council-directory',{method:'POST',cookie:admin,body:{name:'Чужой Совет',level:'primary'}})).status,200);
 assert.equal((await request('/council-directory',{method:'POST',cookie:chair,body:{name:'Чужой Совет',level:'local'}})).status,403);
 const person=await request('/council-roster',{method:'POST',cookie:chair,body:{council:'Ширинский район',name:'Иванов Иван Иванович',positions:['Председатель','Секретарь','Делегат в региональный Совет Первых']}});assert.equal(person.status,200);
 const other=await request('/council-roster',{method:'POST',cookie:admin,body:{council:'Чужой Совет',name:'Другой участник',position:'Секретарь'}});
 assert.equal((await request('/council-roster',{method:'POST',cookie:chair,body:{id:other.data.id,council:'Ширинский район',name:'Подмена',position:'Участник'}})).status,403);
 assert.equal((await request('/council-roster/remove',{method:'POST',cookie:chair,body:{id:other.data.id}})).status,403);
 const query={title:'Годовой отчёт',year:2026,deadline:'2026-12-20',councils:['Ширинский район','Чужой Совет']};
 assert.equal((await request('/report-requests',{method:'POST',cookie:chair,body:query})).status,403);
 assert.equal((await request('/report-requests',{method:'POST',cookie:admin,body:query})).status,201);
 const cd=(await request('/council-data',{cookie:chair})).data;assert.equal(cd.roster.length,2);assert.equal(cd.roster.find(r=>r.id===person.data.id).positions.length,3);assert.equal(cd.reports.length,1);assert.equal(cd.requests.length,1);
 const all=(await request('/council-data',{cookie:admin})).data;const foreign=all.reports.find(r=>r.council==='Чужой Совет');
 const activity={name:'Форум Первых',date:'2026-01-12',level:'local',department:'Ширинский район',location:'Районный дом культуры',organizers:'Местный Совет Первых',council_role:'organizer',contribution:'Подготовили программу и организовали площадку',initiated:true,participants:30,description:'Провели мастерские',result:'Создали три команды',post_url:'https://vk.com/wall-123_456'};
 const rp=cd.reports[0],payload={version:rp.version,status:'submitted',activities:[activity,{...activity,date:'2026-12-20',level:'primary',participants:4},{...activity,initiated:false,participants:100}],local_practice:'Практика района',primary_practice:'Практика школы'};
 assert.equal((await request('/council-reports/'+foreign.id,{method:'PUT',cookie:chair,body:payload})).status,403);
 assert.equal((await request('/council-reports/'+rp.id,{method:'PUT',cookie:chair,body:{...payload,primary_practice:''}})).status,400);
 for(const bad of [{participants:-1},{participants:1.5},{participants:null},{date:'2025-01-12'},{date:'2026-02-30'},{post_url:'javascript:alert(1)'},{post_url:'https://user:pass@example.com/'},{organizers:''},{contribution:''},{level:'unknown'},{initiated:null}])assert.equal((await request('/council-reports/'+rp.id,{method:'PUT',cookie:chair,body:{...payload,activities:[{...activity,...bad}]}})).status,400,JSON.stringify(bad));
 assert.equal((await request('/council-reports/'+rp.id,{method:'PUT',cookie:chair,body:{...payload,activities:[],no_events:false}})).status,400);
 assert.equal((await request('/council-reports/'+rp.id,{method:'PUT',cookie:chair,body:{...payload,no_events:true}})).status,400);
 assert.equal((await request('/council-reports/'+rp.id,{method:'PUT',cookie:chair,body:{...payload,status:'draft',activities:[{...activity,participants:null,description:''}]}})).status,200);
 payload.version++;
 assert.equal((await request('/council-reports/'+rp.id,{method:'PUT',cookie:chair,body:{...payload,months:Array.from({length:12},()=>[999,999,999,999])}})).status,200);
 assert.equal((await request('/council-reports/'+rp.id,{method:'PUT',cookie:chair,body:payload})).status,409);
 const saved=(await request('/council-data',{cookie:chair})).data.reports[0];assert.equal(saved.status,'submitted');assert.deepEqual(saved.months[0],[1,0,30,0,0,0]);assert.deepEqual(saved.months[11],[0,1,0,4,0,0]);assert.equal(saved.activities.length,3);
 assert.equal((await request('/members/roles',{method:'POST',cookie:chair,body:{id:reg.data.user.id,roles:['chair','local_delegate']}})).status,403);
 assert.equal((await request('/members/roles',{method:'POST',cookie:admin,body:{id:reg.data.user.id,roles:['admin','chair']}})).status,400);
 assert.equal((await request('/members/roles',{method:'POST',cookie:admin,body:{id:reg.data.user.id,roles:['chair','local_delegate','regional_delegate']}})).status,200);
 assert.deepEqual((await request('/bootstrap',{cookie:chair})).data.user.roles,['chair','local_delegate','regional_delegate']);


 assert.equal((await request('/register',{method:'POST',body:{name:'Дубль',email:'second@example.test',password:profile.password,code:inv.data.code}})).status,400);
 assert.equal((await request('/invites',{method:'POST',cookie:chair,body:{role:'secretary',council:'test'}})).status,403);
 assert.equal((await request('/members',{cookie:chair})).status,403);
 assert.equal((await request('/items/'+id,{method:'PUT',cookie:chair,body:{...item,title:'Чужое изменение',version:1}})).status,404);
 const own=await request('/items',{method:'POST',cookie:chair,body:{...item,council:'Подменённый Совет',title:'Идея района'}});assert.equal(own.data.item.council,'Ширинский район');
 const upd=await request('/items/'+own.data.item.id,{method:'PUT',cookie:chair,body:{...own.data.item,status:'progress'}});assert.equal(upd.status,200);assert.equal(upd.data.item.version,2);
 assert.equal((await request('/items/'+own.data.item.id,{method:'PUT',cookie:chair,body:{...own.data.item,status:'discussion'}})).status,409);
 assert.equal((await request('/items/'+own.data.item.id,{method:'PUT',cookie:chair,body:{...upd.data.item,status:'done'}})).status,400);
 assert.equal((await request('/items/'+own.data.item.id,{method:'PUT',cookie:chair,body:{...upd.data.item,status:'done',result:'Провели встречу и записали решения'}})).status,200);
 assert.equal((await request('/items/'+id+'/comments',{method:'POST',cookie:chair,body:{body:'Готовы подключиться'}})).status,404);
 assert.equal((await request('/items/'+id+'/comments',{method:'POST',cookie:admin,body:{body:'Готовы подключиться'}})).status,201);
 const detail=await request('/items/'+id,{cookie:admin});assert.equal(detail.data.events.length,2);assert.equal(detail.data.events[1].event_type,'comment');
 const members=await request('/members',{cookie:admin});assert.equal(members.data.members.length,2);assert.ok(members.data.members.every(m=>!m.password));
 assert.equal((await request('/members/access',{method:'POST',cookie:admin,body:{id:reg.data.user.id,active:false}})).status,200);
 assert.equal((await request('/items',{cookie:chair})).status,401);
 const backup=await request('/export',{cookie:admin});assert.equal(backup.data.items.length,2);assert.ok(backup.data.events.length>=5);
 await stop();await start();assert.equal((await request('/bootstrap')).data.setupRequired,false);
 const login=await request('/login',{method:'POST',body:{email:profile.email,password:profile.password}});assert.equal(login.status,200);
 assert.equal((await request('/items',{cookie:login.cookie})).data.items.length,2);
 const persisted=(await request('/council-data',{cookie:login.cookie})).data;assert.equal(persisted.roster.length,4);assert.equal(persisted.reports.find(r=>r.id===rp.id).status,'submitted');assert.equal(persisted.reports.find(r=>r.id===rp.id).activities.length,3);assert.equal(persisted.roster.find(r=>r.id===person.data.id).positions.length,3);
 assert.equal((await fetch(url+'/../server.mjs')).status,404);
 assert.equal((await request('/logout',{method:'POST',cookie:login.cookie,body:{}})).status,200);
 assert.equal((await request('/items',{cookie:login.cookie})).status,401);
 }finally{await stop();rmSync(data,{recursive:true,force:true});}
});
