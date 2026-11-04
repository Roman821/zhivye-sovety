import {spawn} from 'node:child_process';
import {openSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const url='http://127.0.0.1:18765';
async function ready(){try{const r=await fetch(url+'/api/bootstrap',{signal:AbortSignal.timeout(1000)});const d=await r.json();return r.ok&&typeof d.setupRequired==='boolean';}catch{return false;}}
if(!await ready()){
 mkdirSync(join(root,'data'),{recursive:true});
 const log=openSync(join(root,'data','server.log'),'a');
 const child=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log,log]});child.unref();
 for(let n=0;n<30&&!await ready();n++)await new Promise(r=>setTimeout(r,300));
 if(!await ready())throw new Error('Не удалось запустить сайт. Подробности: data/server.log');
}
console.log(url);
