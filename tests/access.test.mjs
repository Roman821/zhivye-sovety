import {test} from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
test('Доступ по уровням Советов, район куратора и отдельные права',{timeout:30000},async()=>{
 const data=mkdtempSync(join(tmpdir(),'sovety-access-'));let child;
 try{
 child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(20000+Math.floor(Math.random()*20000)),SOVETY_DATA_DIR:data},stdio:['ignore','pipe','pipe']});
 const url=await new Promise((resolve,reject)=>{let out='';const t=setTimeout(()=>reject(new Error(out)),8000);child.stdout.on('data',c=>{out+=c;const m=out.match(/http:\/\/127.0.0.1:\d+/);if(m){clearTimeout(t);resolve(m[0]);}});child.stderr.on('data',c=>out+=c);child.once('exit',()=>{clearTimeout(t);reject(new Error(out));});});
 async function req(p,method='GET',value,cookie){const r=await fetch(url+'/api'+p,{method,headers:{...(value?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:value?JSON.stringify(value):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 const password='test-strong-123',owner=(await req('/setup','POST',{name:'Координатор',email:'owner@example.test',password,council:'Региональный Совет'})).cookie;
 // Уведомления по умолчанию выключены: ни колокольчика, ни push.
 assert.equal((await req('/bootstrap','GET',undefined,owner)).data.notifications,false);assert.equal((await req('/bootstrap','GET',undefined,owner)).data.sovetnik,false);assert.equal((await req('/sovetnik','POST',{messages:[{role:'user',content:'Привет'}]},owner)).status,404);assert.equal((await req('/notifications','GET',undefined,owner)).status,404);
 const dir=(name,level,parent='')=>req('/council-directory','POST',{name,level,parent},owner);
 for(const [n,l,p] of [['Региональный Совет','regional'],['Ширинский район','local'],['Абаканский район','local'],['Школа №1 Шира','primary','Ширинский район'],['Школа №5 Абакан','primary','Абаканский район']])assert.equal((await dir(n,l,p)).status,200);
 async function member(name,roles,council,n){const inv=await req('/invites','POST',{name,roles,council},owner);assert.equal(inv.status,201);const reg=await req('/register','POST',{name,email:`u${n}@example.test`,password,code:inv.data.code});assert.equal(reg.status,201);return reg;}
 const curator=await member('Куратор Шира',['municipal_curator'],'Ширинский район',1),localChair=await member('Председатель Шира',['chair'],'Ширинский район',2),school=await member('Председатель школы',['chair'],'Школа №1 Шира',3),regional=await member('Член регионального',['member'],'Региональный Совет',4),other=await member('Председатель Абакан',['chair'],'Абаканский район',5);
 const item=c=>({title:'Запись '+c,kind:'initiative',description:'Описание',council:c,priority:'normal',status:'new'});
 for(const c of ['Региональный Совет','Ширинский район','Абаканский район','Школа №1 Шира','Школа №5 Абакан'])assert.equal((await req('/items','POST',item(c),owner)).status,201);
 const seen=async who=>(await req('/items','GET',undefined,who.cookie)).data.items.map(i=>i.council).sort();
 assert.deepEqual(await seen(school),['Школа №1 Шира']);
 assert.deepEqual(await seen(localChair),['Ширинский район','Школа №1 Шира']);
 assert.deepEqual(await seen(curator),['Ширинский район','Школа №1 Шира']);
 assert.equal((await seen(regional)).length,5);
 assert.deepEqual(await seen(other),['Абаканский район','Школа №5 Абакан']);
 // Местный Совет видит подчинённую школу, но изменять её записи не может.
 const schoolItem=(await req('/items','GET',undefined,localChair.cookie)).data.items.find(i=>i.council==='Школа №1 Шира');
 assert.equal((await req('/items/'+schoolItem.id,'PUT',{...schoolItem,title:'Правка',version:schoolItem.version},localChair.cookie)).status,403);
 assert.equal((await req('/items/'+schoolItem.id,'PUT',{...schoolItem,title:'Правка куратора',version:schoolItem.version},curator.cookie)).status,200);
 // Куратор управляет только своим районом.
 const members=(await req('/members','GET',undefined,curator.cookie)).data.members.map(m=>m.council).sort();assert.deepEqual([...new Set(members)],['Ширинский район','Школа №1 Шира']);
 assert.equal((await req('/members/roles','POST',{id:other.data.user.id,roles:['member']},curator.cookie)).status,403);
 assert.equal((await req('/members/access','POST',{id:other.data.user.id,active:false},curator.cookie)).status,403);
 assert.equal((await req('/members/roles','POST',{id:school.data.user.id,roles:['specialist']},curator.cookie)).status,403);
 assert.equal((await req('/invites','POST',{roles:['member'],council:'Абаканский район'},curator.cookie)).status,403);
 const newSchool=await req('/invites','POST',{roles:['member'],council:'Школа №2 Шира'},curator.cookie);assert.equal(newSchool.status,201);
 const directory=(await req('/council-data','GET',undefined,owner)).data.directory;assert.deepEqual(directory.find(c=>c.name==='Школа №2 Шира'),{name:'Школа №2 Шира',level:'primary',parent:'Ширинский район'});
 assert.equal((await req('/invites','POST',{roles:['member'],council:'Новый район',level:'local'},curator.cookie)).status,403);
 assert.equal((await req('/report-requests','POST',{title:'Запрос',year:2026,deadline:'2026-12-01',councils:['Абаканский район']},curator.cookie)).status,403);
 assert.equal((await req('/report-requests','POST',{title:'Запрос района',year:2026,deadline:'2026-12-01',councils:['Школа №1 Шира']},curator.cookie)).status,201);
 assert.equal((await req('/export','GET',undefined,curator.cookie)).status,403);
 // Нельзя повысить свой Совет до регионального уровня, чтобы получить доступ ко всем Советам.
 assert.equal((await req('/council-directory','POST',{name:'Ширинский район',level:'regional'},localChair.cookie)).status,403);
 assert.equal((await req('/council-directory','POST',{name:'Школа №5 Абакан',level:'primary',parent:'Ширинский район'},curator.cookie)).status,403);
 // Отдельные права выдаются в пределах зоны и действуют сверх должности.
 assert.equal((await req('/report-requests','POST',{title:'Запрос',year:2026,deadline:'2026-12-01',councils:['Школа №1 Шира']},localChair.cookie)).status,403);
 assert.equal((await req('/members/permissions','POST',{id:localChair.data.user.id,permissions:['request_reports','edit_plan']},other.cookie)).status,403);
 assert.equal((await req('/members/permissions','POST',{id:localChair.data.user.id,permissions:['unknown']},curator.cookie)).status,400);
 assert.equal((await req('/members/permissions','POST',{id:localChair.data.user.id,permissions:['request_reports','edit_plan']},curator.cookie)).status,200);
 assert.deepEqual((await req('/bootstrap','GET',undefined,localChair.cookie)).data.user.permissions,['request_reports','edit_plan']);
 assert.equal((await req('/report-requests','POST',{title:'Запрос школам',year:2026,deadline:'2026-12-01',councils:['Школа №1 Шира']},localChair.cookie)).status,201);
 assert.equal((await req('/report-requests','POST',{title:'Чужой запрос',year:2026,deadline:'2026-12-01',councils:['Школа №5 Абакан']},localChair.cookie)).status,403);
 const fresh=(await req('/items','GET',undefined,localChair.cookie)).data.items.find(i=>i.council==='Школа №1 Шира');
 assert.equal((await req('/items/'+fresh.id,'PUT',{...fresh,title:'Правка по праву',version:fresh.version},localChair.cookie)).status,200);
 assert.equal((await req('/items','POST',item('Абаканский район'),localChair.cookie)).status,403);
 assert.equal((await req('/members/permissions','POST',{id:curator.data.user.id,permissions:['edit_plan']},curator.cookie)).status,400);
 }finally{if(child?.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}rmSync(data,{recursive:true,force:true});}
});
