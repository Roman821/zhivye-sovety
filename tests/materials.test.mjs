import {test} from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
test('Методические материалы: файлы, ссылки, доступ по уровням, Советам и должностям',{timeout:30000},async()=>{
 const data=mkdtempSync(join(tmpdir(),'sovety-materials-'));let child;
 try{
 child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(20000+Math.floor(Math.random()*20000)),SOVETY_DATA_DIR:data},stdio:['ignore','pipe','pipe']});
 const url=await new Promise((resolve,reject)=>{let out='';const t=setTimeout(()=>reject(new Error(out)),8000);child.stdout.on('data',c=>{out+=c;const m=out.match(/http:\/\/127.0.0.1:\d+/);if(m){clearTimeout(t);resolve(m[0]);}});child.stderr.on('data',c=>out+=c);child.once('exit',()=>{clearTimeout(t);reject(new Error(out));});});
 async function req(p,method='GET',value,cookie){const r=await fetch(url+'/api'+p,{method,headers:{...(value?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:value?JSON.stringify(value):undefined});return {status:r.status,data:await r.json()};}
 async function upload(id,name,bytes,cookie){const r=await fetch(url+'/api/materials/'+id+'/file',{method:'PUT',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(name),Cookie:cookie},body:bytes});return {status:r.status,data:await r.json()};}
 async function login(email,password){const r=await fetch(url+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});return r.headers.get('set-cookie').split(';')[0];}
 const password='test-strong-123';await req('/setup','POST',{name:'Координатор',email:'owner@example.test',password,council:'Региональный Совет'});const owner=await login('owner@example.test',password);
 for(const [name,level,parent] of [['Региональный Совет','regional'],['Ширинский район','local'],['Школа Шира','primary','Ширинский район']])await req('/council-directory','POST',{name,level,parent},owner);
 async function member(name,roles,council,n){const inv=await req('/invites','POST',{name,roles,council},owner);await req('/register','POST',{name,email:`m${n}@example.test`,password,code:inv.data.code});return await login(`m${n}@example.test`,password);}
 const curator=await member('Куратор',['municipal_curator'],'Ширинский район',1),chair=await member('Председатель школы',['chair'],'Школа Шира',2),pupil=await member('Участник школы',['member'],'Школа Шира',3);
 assert.equal((await req('/materials','POST',{title:'Памятка',category:'methodics'},pupil)).status,403);
 assert.equal((await req('/materials','POST',{title:'Памятка',category:'unknown'},owner)).status,400);
 assert.equal((await req('/materials','POST',{title:'Памятка',category:'links',url:'javascript:alert(1)'},owner)).status,400);
 const all=(await req('/materials','POST',{title:'Устав Движения',category:'documents',description:'Для всех'},owner)).data.material;
 await req('/materials','POST',{title:'Для председателей',category:'methodics',roles:['chair']},owner);
 const forLocal=(await req('/materials','POST',{title:'Для местных Советов',category:'presentations',levels:['local']},owner)).data.material;
 const vks=await req('/materials','POST',{title:'Запись ВКС',category:'vks',url:'https://vk.com/video-1_2',councils:['Школа Шира']},curator);assert.equal(vks.status,201);
 const titles=async c=>(await req('/materials','GET',undefined,c)).data.materials.map(m=>m.title).sort().join(' | ');
 assert.equal(await titles(pupil),'Запись ВКС | Устав Движения');
 assert.equal(await titles(chair),'Для председателей | Запись ВКС | Устав Движения');
 assert.equal(await titles(curator),'Для местных Советов | Запись ВКС | Устав Движения');
 assert.equal((await req('/materials','GET',undefined,owner)).data.materials.length,4);
 // Файлы: разрешённые типы, отдача только на скачивание, проверка доступа.
 assert.equal((await upload(all.id,'evil.html',Buffer.from('<script>alert(1)</script>'),owner)).status,400);
 assert.equal((await upload(all.id,'big.pdf',Buffer.alloc(10*1024*1024+1),owner)).status,413);
 const up=await upload(all.id,'Устав.pdf',Buffer.from('%PDF-1.4 test'),owner);assert.equal(up.status,200);assert.equal(up.data.material.file_name,'Устав.pdf');assert.equal(up.data.material.file_size,13);
 const file=await fetch(url+'/api/materials/'+all.id+'/file',{headers:{Cookie:pupil}});assert.equal(file.status,200);assert.match(file.headers.get('content-disposition'),/^attachment/);assert.equal(await file.text(),'%PDF-1.4 test');
 assert.equal((await fetch(url+'/api/materials/'+forLocal.id+'/file',{headers:{Cookie:pupil}})).status,404);
 assert.equal((await upload(all.id,'x.pdf',Buffer.from('x'),curator)).status,403);
 // Изменять может автор; координатор — любой материал.
 assert.equal((await req('/materials/'+vks.data.material.id,'PUT',{title:'Запись ВКС от 1 ноября',category:'vks',url:'https://vk.com/video-1_2',councils:['Школа Шира']},curator)).status,200);
 assert.equal((await req('/materials/'+all.id+'/remove','POST',{},curator)).status,403);
 // Отдельное право позволяет добавлять материалы.
 const pupilId=(await req('/bootstrap','GET',undefined,pupil)).data.user.id;
 assert.equal((await req('/members/permissions','POST',{id:pupilId,permissions:['manage_materials']},owner)).status,200);
 assert.equal((await req('/materials','POST',{title:'Опыт школы',category:'other',url:'https://example.org'},pupil)).status,201);
 assert.equal((await req('/materials/'+all.id,'PUT',{title:'Устав',category:'documents',remove_file:true},owner)).data.material.has_file,false);
 assert.equal((await fetch(url+'/api/materials/'+all.id+'/file',{headers:{Cookie:owner}})).status,404);
 assert.equal((await req('/materials/'+all.id+'/remove','POST',{},owner)).status,200);assert.equal((await req('/materials','GET',undefined,owner)).data.materials.length,4);
 assert.ok((await req('/export','GET',undefined,owner)).data.materials.length===4);
 }finally{if(child?.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}rmSync(data,{recursive:true,force:true});}
});
