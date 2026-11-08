import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));

test('Личный кабинет редактирует профиль и безопасно меняет почту и пароль',{timeout:30000},async()=>{
 const data=mkdtempSync(join(tmpdir(),'sovety-account-'));let child;
 try{
  child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(20000+Math.floor(Math.random()*20000)),SOVETY_DATA_DIR:data},stdio:['ignore','pipe','pipe']});
  const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(new Error(out)),8000);child.stdout.on('data',chunk=>{out+=chunk;const match=out.match(/http:\/\/127.0.0.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.stderr.on('data',chunk=>out+=chunk);child.once('exit',()=>{clearTimeout(timer);reject(new Error(out));});});
  async function req(path,method='GET',value,cookie){const response=await fetch(url+'/api'+path,{method,headers:{...(value?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:value?JSON.stringify(value):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  const password='test-strong-123';
  assert.equal((await req('/account')).status,401);
  const setup=await req('/setup','POST',{name:'Анна Иванова',email:'anna@example.test',password,council:'Региональный Совет'});
  assert.equal(setup.status,201);const originalCookie=setup.cookie;
  const invite=await req('/invites','POST',{name:'Борис Петров',roles:['member'],council:'Региональный Совет'},originalCookie);
  assert.equal(invite.status,201);
  assert.equal((await req('/register','POST',{name:'Борис Петров',email:'boris@example.test',password,code:invite.data.code})).status,201);

  const initial=await req('/account','GET',undefined,originalCookie);
  assert.equal(initial.status,200);assert.equal(initial.data.user.email,'anna@example.test');assert.equal(initial.data.person.name,'Анна Иванова');assert.equal(initial.data.user.password,undefined);
  const originalPositions=initial.data.person.positions;
  const changed=await req('/account/profile','PUT',{name:'Анна Сергеевна',council:'Чужой Совет',positions:['Координатор'],birth_year:2008,education:'school',institution:'Школа № 1',study_year:'11 класс',phone:'+7 900 000-00-00',vk:'https://vk.com/anna',bio:'Новые сведения о себе'},originalCookie);
  assert.equal(changed.status,200);assert.equal(changed.data.user.name,'Анна Сергеевна');assert.equal(changed.data.person.name,'Анна Сергеевна');assert.equal(changed.data.person.council,'Региональный Совет');assert.deepEqual(changed.data.person.positions,originalPositions);assert.equal(changed.data.person.institution,'Школа № 1');
  const people=(await req('/people-data','GET',undefined,originalCookie)).data.people;
  assert.equal(people.find(person=>person.user_id===setup.data.user.id).name,'Анна Сергеевна');

  assert.equal((await req('/account/email','PUT',{email:'new@example.test',current_password:'wrong-password'},originalCookie)).status,403);
  assert.equal((await req('/account/email','PUT',{email:'not-an-email',current_password:password},originalCookie)).status,400);
  assert.equal((await req('/account/email','PUT',{email:'boris@example.test',current_password:password},originalCookie)).status,409);
  const email=await req('/account/email','PUT',{email:'New.Anna@Example.Test',current_password:password},originalCookie);
  assert.equal(email.status,200);assert.equal(email.data.user.email,'new.anna@example.test');
  assert.equal((await req('/login','POST',{email:'anna@example.test',password})).status,401);
  const secondSession=await req('/login','POST',{email:'new.anna@example.test',password});
  assert.equal(secondSession.status,200);

  assert.equal((await req('/account/password','PUT',{current_password:'wrong-password',new_password:'new-strong-123',confirmation:'new-strong-123'},originalCookie)).status,403);
  assert.equal((await req('/account/password','PUT',{current_password:password,new_password:'short',confirmation:'short'},originalCookie)).status,400);
  assert.equal((await req('/account/password','PUT',{current_password:password,new_password:'new-strong-123',confirmation:'different-123'},originalCookie)).status,400);
  assert.equal((await req('/account/password','PUT',{current_password:password,new_password:password,confirmation:password},originalCookie)).status,400);
  const newCookieResponse=await req('/account/password','PUT',{current_password:password,new_password:'new-strong-123',confirmation:'new-strong-123'},originalCookie);
  assert.equal(newCookieResponse.status,200);assert.ok(newCookieResponse.cookie);
  assert.equal((await req('/account','GET',undefined,originalCookie)).status,401);
  assert.equal((await req('/account','GET',undefined,secondSession.cookie)).status,401);
  assert.equal((await req('/account','GET',undefined,newCookieResponse.cookie)).status,200);
  assert.equal((await req('/login','POST',{email:'new.anna@example.test',password})).status,401);
  assert.equal((await req('/login','POST',{email:'new.anna@example.test',password:'new-strong-123'})).status,200);
 }finally{
  if(child?.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}
  rmSync(data,{recursive:true,force:true});
 }
});
