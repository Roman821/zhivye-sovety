import {test} from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
test('Подзадачи, «Для кого» и личный календарь',{timeout:30000},async()=>{
 const data=mkdtempSync(join(tmpdir(),'sovety-plan-'));let child;
 try{
 child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'0',SOVETY_DATA_DIR:data},stdio:['ignore','pipe','pipe']});
 const url=await new Promise((resolve,reject)=>{let out='';const t=setTimeout(()=>reject(new Error(out)),8000);child.stdout.on('data',c=>{out+=c;const m=out.match(/http:\/\/127.0.0.1:\d+/);if(m){clearTimeout(t);resolve(m[0]);}});child.stderr.on('data',c=>out+=c);child.once('exit',()=>{clearTimeout(t);reject(new Error(out));});});
 async function req(p,method='GET',value,cookie){const r=await fetch(url+'/api'+p,{method,headers:{...(value?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:value?JSON.stringify(value):undefined});return {status:r.status,data:await r.json()};}
 async function login(email,password){const r=await fetch(url+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});return r.headers.get('set-cookie').split(';')[0];}
 const password='test-strong-123';await req('/setup','POST',{name:'Координатор',email:'owner@example.test',password,council:'Региональный Совет'});const owner=await login('owner@example.test',password);
 for(const [name,level] of [['Региональный Совет','regional'],['Ширинский район','local'],['Абаканский район','local']])await req('/council-directory','POST',{name,level},owner);
 async function member(name,council,n){const inv=await req('/invites','POST',{name,roles:['member'],council},owner);await req('/register','POST',{name,email:`p${n}@example.test`,password,code:inv.data.code});return login(`p${n}@example.test`,password);}
 const chair=await member('Иванов Иван','Ширинский район',1),helper=await member('Петрова Анна','Ширинский район',2),stranger=await member('Сидоров Пётр','Абаканский район',3);
 const people=(await req('/people-data','GET',undefined,owner)).data.people,id=n=>people.find(p=>p.name===n).id;
 const task={title:'Форум активистов',kind:'task',description:'Подготовить районный форум',council:'Ширинский район',priority:'normal',status:'progress',deadline:'2026-12-10'};
 // «Для кого»: отдельные участники должны быть выбраны.
 assert.equal((await req('/items','POST',{...task,audience:'people',audience_ids:[]},chair)).status,400);
 assert.equal((await req('/items','POST',{...task,audience:'everyone'},chair)).status,400);
 const created=await req('/items','POST',{...task,audience:'people',audience_ids:[id('Петрова Анна')]},chair);assert.equal(created.status,201);
 const item=created.data.item;assert.equal(item.audience,'people');assert.deepEqual(item.audience_ids,[id('Петрова Анна')]);assert.deepEqual(item.subtasks,[]);
 // Подзадачи со своими сроками и ответственными.
 assert.equal((await req('/items/'+item.id+'/subtasks','POST',{title:'Чужая правка'},stranger)).status,403);
 assert.equal((await req('/items/'+item.id+'/subtasks','POST',{title:'',deadline:'2026-12-01'},chair)).status,400);
 assert.equal((await req('/items/'+item.id+'/subtasks','POST',{title:'Площадка',deadline:'2026-02-30'},chair)).status,400);
 const s1=await req('/items/'+item.id+'/subtasks','POST',{title:'Согласовать площадку',deadline:'2026-11-20',assignee_ids:[id('Петрова Анна')]},chair);assert.equal(s1.status,201);
 const s2=await req('/items/'+item.id+'/subtasks','POST',{title:'Разослать приглашения',deadline:'2026-12-01',assignee_ids:[id('Иванов Иван')]},chair);assert.equal(s2.status,201);
 assert.equal((await req('/items/'+item.id+'/subtasks','POST',{title:'Чужой ответственный',assignee_ids:[id('Сидоров Пётр')]},chair)).status,403);
 // Участник Совета записи может отметить и изменить подзадачу.
 const toggled=await req('/subtasks/'+s1.data.subtask.id,'PUT',{done:true},helper);assert.equal(toggled.status,200);assert.equal(toggled.data.subtask.done,true);assert.ok(toggled.data.subtask.done_at);
 // Ответственный из другого Совета может только отметить выполнение своей подзадачи.
 const outside=await req('/items/'+item.id+'/subtasks','POST',{title:'Помощь соседей',assignee_ids:[id('Сидоров Пётр')]},owner);assert.equal(outside.status,201);
 const marked=await req('/subtasks/'+outside.data.subtask.id,'PUT',{done:true,title:'Переименовано'},stranger);assert.equal(marked.status,200);assert.equal(marked.data.subtask.done,true);assert.equal(marked.data.subtask.title,'Помощь соседей');
 assert.equal((await req('/subtasks/'+s2.data.subtask.id,'PUT',{done:true},stranger)).status,403);
 assert.equal((await req('/subtasks/'+outside.data.subtask.id+'/remove','POST',{},stranger)).status,403);assert.equal((await req('/subtasks/'+outside.data.subtask.id+'/remove','POST',{},owner)).status,200);
 const listed=(await req('/items','GET',undefined,chair)).data.items.find(i=>i.id===item.id);assert.equal(listed.subtasks.length,2);assert.equal(listed.subtasks.filter(s=>s.done).length,1);
 assert.equal((await req('/subtasks/'+s2.data.subtask.id+'/remove','POST',{},stranger)).status,403);
 assert.equal((await req('/subtasks/'+s2.data.subtask.id+'/remove','POST',{},chair)).status,200);
 const detail=(await req('/items/'+item.id,'GET',undefined,owner)).data;assert.equal(detail.item.subtasks.length,1);assert.ok(detail.events.some(e=>e.body.includes('выполнена')));
 // Личные записи видит только владелец.
 assert.equal((await req('/personal','POST',{title:'Подготовить речь',date:'2026-13-01'},helper)).status,400);
 const mine=await req('/personal','POST',{title:'Подготовить речь',date:'2026-11-18',start_time:'09:30',note:'Тезисы'},helper);assert.equal(mine.status,201);
 assert.equal((await req('/personal','GET',undefined,helper)).data.entries.length,1);
 assert.equal((await req('/personal','GET',undefined,owner)).data.entries.length,0);
 assert.equal((await req('/personal/'+mine.data.entry.id,'PUT',{title:'Взлом',date:'2026-11-18'},owner)).status,404);
 assert.equal((await req('/personal/'+mine.data.entry.id+'/remove','POST',{},chair)).status,404);
 const done=await req('/personal/'+mine.data.entry.id,'PUT',{title:'Подготовить речь',date:'2026-11-18',done:true},helper);assert.equal(done.data.entry.done,true);
 assert.equal((await req('/personal/'+mine.data.entry.id+'/remove','POST',{},helper)).status,200);
 assert.equal((await req('/personal','GET',undefined,helper)).data.entries.length,0);
 const backup=(await req('/export','GET',undefined,owner)).data;assert.equal(backup.subtasks.length,1);
 }finally{if(child?.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}rmSync(data,{recursive:true,force:true});}
});
