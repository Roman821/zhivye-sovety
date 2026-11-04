import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('Внешний режим защищает первичную настройку и cookies',{timeout:20000},async()=>{
 const data=mkdtempSync(join(tmpdir(),'sovety-host-test-')),code='test-code-for-isolated-server-0123456789';
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(20000+Math.floor(Math.random()*20000)),HOST:'0.0.0.0',PUBLIC_ORIGIN:'https://sovety.example',SETUP_CODE:code,SOVETY_DATA_DIR:data},stdio:['ignore','pipe','pipe']});
 try{
 const url=await new Promise((resolve,reject)=>{let output='';child.stdout.on('data',c=>{output+=c;const m=output.match(/http:\/\/127.0.0.1:\d+/);if(m)resolve(m[0]);});child.on('error',reject);child.on('exit',n=>reject(new Error('Server exit '+n)));});
 const bootstrap=await (await fetch(url+'/api/bootstrap')).json();assert.equal(bootstrap.hosted,true);assert.equal(bootstrap.setupCodeRequired,true);assert.ok(!JSON.stringify(bootstrap).includes(code));
 const credentials={name:'Тест',email:'owner@example.test',password:'long-test-password',council:'Совет'};
 const post=(body,origin='https://sovety.example')=>fetch(url+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
 assert.equal((await post(credentials)).status,403);
 assert.equal((await post({...credentials,setup_code:code},'https://other.example')).status,403);
 const good=await post({...credentials,setup_code:code});assert.equal(good.status,201);assert.match(good.headers.get('set-cookie'),/; Secure/);
 }finally{if(child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}rmSync(data,{recursive:true,force:true});}
});
