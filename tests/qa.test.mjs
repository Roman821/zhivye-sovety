import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));

test('Вопрос/ответ: вопросы участников, ответы управляющих и выгрузка',{timeout:30000},async()=>{
 const data=mkdtempSync(join(tmpdir(),'sovety-qa-'));let child;
 try{
  child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(20000+Math.floor(Math.random()*20000)),SOVETY_DATA_DIR:data},stdio:['ignore','pipe','pipe']});
  const url=await new Promise((resolve,reject)=>{let out='';const t=setTimeout(()=>reject(new Error(out)),8000);child.stdout.on('data',c=>{out+=c;const m=out.match(/http:\/\/127.0.0.1:\d+/);if(m){clearTimeout(t);resolve(m[0]);}});child.stderr.on('data',c=>out+=c);child.once('exit',()=>{clearTimeout(t);reject(new Error(out));});});
  async function req(p,method='GET',value,cookie){const r=await fetch(url+'/api'+p,{method,headers:{...(value?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:value?JSON.stringify(value):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  const password='test-strong-123';
  const setup=await req('/setup','POST',{name:'Координатор',email:'owner@example.test',password,council:'Региональный Совет'}),owner=setup.cookie;
  async function member(name,email){const inv=await req('/invites','POST',{name,roles:['member'],council:'Совет А',level:'local'},owner);assert.equal(inv.status,201);const reg=await req('/register','POST',{name,email,password,code:inv.data.code});assert.equal(reg.status,201);return reg.cookie;}
  const author=await member('Автор вопроса','author@example.test'),other=await member('Другой участник','other@example.test');
  assert.equal((await req('/qa')).status,401);
  const created=await req('/qa','POST',{question:'Как добавить мероприятие в отчёт?'},author);assert.equal(created.status,201);assert.equal(created.data.question.answered,false);assert.equal(created.data.question.can_delete,true);
  const id=created.data.question.id;
  assert.equal((await req('/qa/'+id,'PUT',{answer:'Откройте годовой отчёт.'},author)).status,403);
  const answered=await req('/qa/'+id,'PUT',{answer:'Откройте годовой отчёт и добавьте карточку мероприятия.'},owner);assert.equal(answered.status,200);assert.equal(answered.data.question.answered,true);assert.equal(answered.data.question.answer_author_name,'Координатор');
  const list=await req('/qa','GET',undefined,other);assert.equal(list.status,200);assert.equal(list.data.can_answer,false);assert.equal(list.data.questions[0].answer,'Откройте годовой отчёт и добавьте карточку мероприятия.');assert.equal(list.data.questions[0].can_delete,false);
  const exported=await req('/export','GET',undefined,owner);assert.equal(exported.status,200);assert.equal(exported.data.qaQuestions.length,1);assert.equal(exported.data.qaQuestions[0].id,id);
  assert.equal((await req('/qa/'+id,'DELETE',{},other)).status,403);
  assert.equal((await req('/qa/'+id,'DELETE',{},author)).status,200);assert.equal((await req('/qa','GET',undefined,owner)).data.questions.length,0);
 }finally{if(child?.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}rmSync(data,{recursive:true,force:true});}
});
