import {test} from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
test('Полные права, приглашения, назначения, заседания, профили и корзина отчётов',{timeout:30000},async()=>{
 const data=mkdtempSync(join(tmpdir(),'sovety-people-'));let child;
 try{
 child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(20000+Math.floor(Math.random()*20000)),SOVETY_DATA_DIR:data},stdio:['ignore','pipe','pipe']});
 const url=await new Promise((resolve,reject)=>{let out='';const t=setTimeout(()=>reject(new Error(out)),8000);child.stdout.on('data',c=>{out+=c;const m=out.match(/http:\/\/127.0.0.1:\d+/);if(m){clearTimeout(t);resolve(m[0]);}});child.stderr.on('data',c=>out+=c);child.once('exit',()=>{clearTimeout(t);reject(new Error(out));});});
 async function req(p,method='GET',value,cookie){const r=await fetch(url+'/api'+p,{method,headers:{...(value?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:value?JSON.stringify(value):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 const password='test-strong-123';const setup=await req('/setup','POST',{name:'Координатор',email:'owner@example.test',password,council:'Региональный Совет'}),owner=setup.cookie;
 async function member(name,role,council){const inv=await req('/invites','POST',{name,roles:[role],council,level:'local'},owner);assert.equal(inv.status,201);const reg=await req('/register','POST',{name,email:role+'@example.test',password,code:inv.data.code});assert.equal(reg.status,201);return reg;}
 const specialist=await member('Специалист','specialist','Совет А'),curator=await member('Куратор','municipal_curator','Совет Б'),ordinary=await member('Участник Совета','member','Совет В');
 assert.equal(specialist.data.user.manage_all,true);assert.equal(curator.data.user.manage_all,true);assert.equal(ordinary.data.user.manage_all,false);
 assert.equal((await req('/members','GET',undefined,curator.cookie)).status,200);assert.equal((await req('/members','GET',undefined,specialist.cookie)).status,200);
 assert.equal((await req('/members/access','POST',{id:setup.data.user.id,active:false},specialist.cookie)).status,400);
 const pd=(await req('/people-data','GET',undefined,owner)).data,person=pd.people.find(p=>p.user_id===ordinary.data.user.id);assert.ok(person);assert.equal(pd.people.filter(p=>p.user_id===ordinary.data.user.id).length,1);assert.ok(pd.directory.some(c=>c.name==='Совет В'));
 const membership={person_id:person.id,council:'Региональный Совет',positions:['Делегат в региональный Совет Первых']};
 assert.equal((await req('/council-memberships','POST',membership,ordinary.cookie)).status,403);
 assert.equal((await req('/council-memberships','POST',membership,curator.cookie)).status,403);
 assert.equal((await req('/council-memberships','POST',membership,specialist.cookie)).status,200);
 assert.equal((await req('/council-memberships','POST',membership,specialist.cookie)).status,200);
 const linkedRoster=(await req('/council-data','GET',undefined,owner)).data.roster.filter(p=>p.id===person.id);assert.equal(linkedRoster.length,2);assert.ok(linkedRoster.some(p=>p.council==='Региональный Совет'&&p.membership));
 const samePerson=(await req('/people-data','GET',undefined,owner)).data.people.filter(p=>p.id===person.id);assert.equal(samePerson.length,1);assert.equal(samePerson[0].memberships.length,2);
 assert.equal((await req('/register','POST',{name:person.name,email:'membership-duplicate@example.test',password,council:'Региональный Совет'})).status,409);
 assert.equal((await req('/council-memberships','POST',{...membership,positions:['Секретарь'],edit:true},owner)).status,200);
 assert.deepEqual((await req('/people-data','GET',undefined,owner)).data.people.find(p=>p.id===person.id).memberships.find(m=>!m.primary).positions,['Секретарь']);
 assert.equal((await req('/council-memberships/remove','POST',{person_id:person.id,council:'Региональный Совет'},owner)).status,200);
 const detached=(await req('/people-data','GET',undefined,owner)).data.people.find(p=>p.id===person.id);assert.equal(detached.archived,0);assert.equal(detached.memberships.length,1);assert.equal(detached.user_id,ordinary.data.user.id);

 const profile={id:person.id,name:person.name,council:person.council,positions:['Участник'],birth_year:2008,education:'school',institution:'Школа',study_year:'11 класс',phone:'+7 900 000-00-00',vk:'https://vk.com/example',bio:'Организует встречи',photo:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='};
 assert.equal((await req('/council-roster','POST',profile,specialist.cookie)).status,200);
 assert.equal((await fetch(url+'/api/people/'+person.id+'/photo')).status,401);
 const photoDownload=await fetch(url+'/api/people/'+person.id+'/photo?download=1',{headers:{Cookie:specialist.cookie}});assert.equal(photoDownload.status,200);assert.match(photoDownload.headers.get('content-disposition'),/^attachment;/);assert.match(photoDownload.headers.get('content-disposition'),/filename\*=UTF-8''/);assert.ok((await photoDownload.arrayBuffer()).byteLength>8);
 async function uploadPortfolio(file,name,cookie){const r=await fetch(url+'/api/people/'+person.id+'/portfolio',{method:'PUT',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(name),Cookie:cookie},body:file});return {status:r.status,data:await r.json()};}
 const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
 assert.equal((await uploadPortfolio(pdf,'Достижения участника.pdf',curator.cookie)).status,403);
 assert.equal((await uploadPortfolio(Buffer.from('not a pdf'),'Обман.pdf',specialist.cookie)).status,400);
 const tooLarge=Buffer.alloc(50*1024*1024+1);tooLarge.write('%PDF-');assert.equal((await uploadPortfolio(tooLarge,'Слишком большой.pdf',specialist.cookie)).status,413);
 assert.equal((await uploadPortfolio(pdf,'Достижения участника.pdf',specialist.cookie)).status,200);
 const withPortfolio=(await req('/people-data','GET',undefined,ordinary.cookie)).data.people.find(p=>p.id===person.id);assert.equal(withPortfolio.has_portfolio,true);assert.equal(withPortfolio.portfolio_name,'Достижения участника.pdf');assert.equal(withPortfolio.portfolio_size,pdf.length);
 const portfolioDownload=await fetch(url+'/api/people/'+person.id+'/portfolio',{headers:{Cookie:ordinary.cookie}});assert.equal(portfolioDownload.status,200);assert.equal(portfolioDownload.headers.get('content-type'),'application/pdf');assert.match(portfolioDownload.headers.get('content-disposition'),/^attachment;/);assert.deepEqual(Buffer.from(await portfolioDownload.arrayBuffer()),pdf);
 const portfolioPreview=await fetch(url+'/api/people/'+person.id+'/portfolio?view=1',{headers:{Cookie:ordinary.cookie}});assert.equal(portfolioPreview.status,200);assert.equal(portfolioPreview.headers.get('content-type'),'application/pdf');assert.match(portfolioPreview.headers.get('content-disposition'),/^inline;/);assert.deepEqual(Buffer.from(await portfolioPreview.arrayBuffer()),pdf);
 assert.equal((await req('/people/'+person.id+'/portfolio/remove','POST',{},curator.cookie)).status,403);
 assert.equal((await req('/people/'+person.id+'/portfolio/remove','POST',{},specialist.cookie)).status,200);assert.equal((await req('/people-data','GET',undefined,ordinary.cookie)).data.people.find(p=>p.id===person.id).has_portfolio,false);assert.equal((await fetch(url+'/api/people/'+person.id+'/portfolio',{headers:{Cookie:ordinary.cookie}})).status,404);
 assert.equal((await req('/council-roster','POST',{...profile,photo:'data:image/svg+xml;base64,AAAA',name:'Не должно сохраниться'},owner)).status,400);
 assert.equal((await req('/people-data','GET',undefined,owner)).data.people.find(p=>p.id===person.id).name,person.name);
 const ordinaryData=(await req('/people-data','GET',undefined,ordinary.cookie)).data;assert.ok(ordinaryData.people.every(p=>p.council===ordinary.data.user.council));
 const item={title:'Подготовить форум',kind:'task',description:'Работа по плану',council:'Региональный Совет',assignee_ids:[person.id],author_person_id:person.id,deadline:'2026-12-31',status:'done',result:'Форум подготовлен'};
 const created=await req('/items','POST',item,specialist.cookie);assert.equal(created.status,201);assert.deepEqual(created.data.item.assignee_ids,[person.id]);assert.ok(created.data.item.completed_at);assert.equal(created.data.item.completed_deadline,'2026-12-31');
 const initiative=await req('/items','POST',{...item,title:'Инициатива участника',kind:'initiative',status:'new'},specialist.cookie);assert.equal(initiative.status,201);
 assert.equal((await req('/items/'+created.data.item.id,'PUT',{...item,version:1},ordinary.cookie)).status,200);
 const meeting={council:'Региональный Совет',title:'Итоговая ВКС',date:'2026-10-31',level:'regional',format:'vks',location:'Онлайн',attendance:[{person_id:person.id,status:'present'}],guests:2,initiatives:'Предложили форум',projects:'План форума',problems:'Нужна площадка',decisions:'Провести форум',next_steps:'Подобрать площадку',related_item_ids:[created.data.item.id,initiative.data.item.id]};
 const saved=await req('/meetings','POST',meeting,specialist.cookie);assert.equal(saved.status,201);
 assert.equal((await req('/meetings/'+saved.data.id,'PUT',{...meeting,version:1,attendance:[{person_id:person.id,status:'absent'}]},specialist.cookie)).status,200);
 assert.equal((await req('/meetings/'+saved.data.id,'PUT',{...meeting,version:1},owner)).status,409);
 assert.equal((await req('/meetings/'+saved.data.id,'PUT',{...meeting,version:2},ordinary.cookie)).status,403);
 const report=(await req('/council-reports','POST',{council:'Региональный Совет',year:2026},specialist.cookie)).data.report;
 const activity={name:'Форум',date:'2026-10-30',level:'regional',department:'Региональный Совет',location:'Дом молодёжи',organizers:'Совет',council_role:'organizer',contribution:'Организация',initiated:true,participants:5,participant_ids:[person.id],description:'Встреча',result:'Обсудили идеи',post_url:''};
 const content={version:report.version,status:'submitted',activities:[activity],local_practice:'Практика местного Совета',primary_practice:'Практика школы'};
 assert.equal((await req('/council-reports/'+report.id,'PUT',content,specialist.cookie)).status,200);
 const listed=(await req('/council-data','GET',undefined,owner)).data.reports.find(r=>r.id===report.id);assert.deepEqual(listed.months[9],[0,0,0,0,1,5]);
 let metrics=(await req('/people-data','GET',undefined,owner)).data;assert.equal(metrics.appearances.filter(a=>a.participant_ids.includes(person.id)).length,1);assert.equal(metrics.meetings[0].attendance[0].status,'absent');
 assert.equal((await req('/council-reports/'+report.id+'/trash','POST',{version:listed.version},ordinary.cookie)).status,403);
 assert.equal((await req('/council-reports/'+report.id+'/trash','POST',{version:listed.version},specialist.cookie)).status,200);
 const trash=(await req('/council-data','GET',undefined,specialist.cookie)).data;assert.equal(trash.reports.length,0);assert.equal(trash.deletedReports.length,1);assert.equal((await req('/people-data','GET',undefined,owner)).data.appearances.length,0);
 assert.equal((await req('/council-reports/'+report.id,'PUT',{...content,version:trash.deletedReports[0].version},owner)).status,409);
 assert.equal((await req('/council-reports/'+report.id+'/restore','POST',{version:trash.deletedReports[0].version},specialist.cookie)).status,200);assert.equal((await req('/people-data','GET',undefined,owner)).data.appearances.length,1);
 const draft=(await req('/council-reports','POST',{year:2026,council:person.council},owner)).data.report;assert.equal((await req('/council-reports/'+draft.id+'/trash','POST',{version:draft.version},ordinary.cookie)).status,200);
 }finally{if(child?.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}rmSync(data,{recursive:true,force:true});}
});
