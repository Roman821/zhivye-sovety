import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {scryptSync} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
test('Старые составы, должности и отчёты сохраняются при обновлении',{timeout:20000},async()=>{
 const data=mkdtempSync(join(tmpdir(),'sovety-migrate-')),id='11111111-1111-4111-8111-111111111111';let child;
 try{
 const db=new DatabaseSync(join(data,'sovety.sqlite'));
 db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password TEXT NOT NULL,role TEXT NOT NULL,council TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL);
 CREATE TABLE council_directory(name TEXT PRIMARY KEY,level TEXT NOT NULL,parent TEXT NOT NULL DEFAULT '');
 CREATE TABLE council_roster(id TEXT PRIMARY KEY,council TEXT NOT NULL,name TEXT NOT NULL,position TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE TABLE council_reports(id TEXT PRIMARY KEY,request_id TEXT,council TEXT NOT NULL,year INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'draft',months TEXT NOT NULL DEFAULT '[]',local_practice TEXT NOT NULL DEFAULT '',primary_practice TEXT NOT NULL DEFAULT '',updated TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,UNIQUE(request_id,council));`);
 const password='migration-test-123',stored='salt:'+scryptSync(password,'salt',64).toString('hex');
 db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('old-user','Участник','old@example.test',stored,'chair','Совет',1,new Date().toISOString());
 db.prepare('INSERT INTO council_directory VALUES(?,?,?)').run('Совет','local','');
 db.prepare('INSERT INTO council_roster VALUES(?,?,?,?,?)').run('person','Совет','Иванов Иван Иванович','Председатель',new Date().toISOString());
 const months=Array.from({length:12},()=>[1,2,30,40]);
 db.prepare('INSERT INTO council_reports VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,null,'Совет',2026,'submitted',JSON.stringify(months),'Практика района','Практика школы',new Date().toISOString(),1);db.close();
 child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(20000+Math.floor(Math.random()*20000)),SOVETY_DATA_DIR:data},stdio:['ignore','pipe','pipe']});
 const url=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('Startup timeout')),8000);child.stdout.on('data',c=>{text+=c;const m=text.match(/http:\/\/127.0.0.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Server exited'));});});
 const login=await fetch(url+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'old@example.test',password})});const user=await login.json();assert.deepEqual(user.user.roles,['chair']);const cookie=login.headers.get('set-cookie').split(';')[0];
 const load=async()=>await (await fetch(url+'/api/council-data',{headers:{Cookie:cookie}})).json();
 const before=await load();assert.deepEqual(before.roster[0].positions,['Председатель']);assert.deepEqual(before.reports[0].months,months);assert.deepEqual(before.reports[0].activities,[]);
 const payload={version:1,status:'submitted',activities:[],no_events:true,local_practice:'Практика района',primary_practice:'Практика школы'};
 const save=async p=>fetch(url+'/api/council-reports/'+id,{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(p)});
 assert.equal((await save(payload)).status,400);assert.deepEqual((await load()).reports[0].months,months);
 assert.equal((await save({...payload,replace_legacy:true})).status,200);assert.deepEqual((await load()).reports[0].months,Array.from({length:12},()=>[0,0,0,0,0,0]));
 }finally{if(child?.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}rmSync(data,{recursive:true,force:true});}
});
