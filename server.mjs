import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { registrationFeatures } from './registration-features.mjs';
import { peopleFeatures } from './people-features.mjs';
import { councilFeatures } from './council-features.mjs';
import { planFeatures } from './plan-features.mjs';
import { materialsFeatures } from './materials-features.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const host=process.env.HOST||'127.0.0.1';
const publicOrigin=process.env.PUBLIC_ORIGIN?new URL(process.env.PUBLIC_ORIGIN).origin:null;
if(!['127.0.0.1','localhost'].includes(host)&&(!publicOrigin?.startsWith('https://')||!process.env.SETUP_CODE||process.env.SETUP_CODE.length<32))throw new Error('Для внешнего запуска задайте PUBLIC_ORIGIN (https://...) и случайный SETUP_CODE длиной от 32 символов.');
const secureCookie=publicOrigin?.startsWith('https://')?'; Secure':'';
const dataDir = process.env.SOVETY_DATA_DIR || join(root, 'data');
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, 'sovety.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password TEXT NOT NULL,role TEXT NOT NULL,council TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS invites(code TEXT PRIMARY KEY,role TEXT NOT NULL,council TEXT NOT NULL,expires INTEGER NOT NULL,used_by TEXT REFERENCES users(id));
CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,title TEXT NOT NULL,kind TEXT NOT NULL,description TEXT NOT NULL,goal TEXT NOT NULL DEFAULT '',needs TEXT NOT NULL DEFAULT '',next_step TEXT NOT NULL DEFAULT '',result TEXT NOT NULL DEFAULT '',council TEXT NOT NULL,owner TEXT NOT NULL,deadline TEXT NOT NULL DEFAULT '',priority TEXT NOT NULL,status TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created TEXT NOT NULL,updated TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,item_id TEXT NOT NULL REFERENCES items(id),author TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,event_type TEXT NOT NULL,created TEXT NOT NULL);`);
for(const table of ['users','invites'])if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name==='roles'))db.exec(`ALTER TABLE ${table} ADD COLUMN roles TEXT NOT NULL DEFAULT '[]'`);
if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='permissions'))db.exec(`ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '[]'`);
const kinds = ['initiative','project','problem','task','meeting','vks'];
for(const [column,definition] of [['assignee_ids',"TEXT NOT NULL DEFAULT '[]'"],['author_person_id',"TEXT NOT NULL DEFAULT ''"],['completed_at',"TEXT NOT NULL DEFAULT ''"],['completed_deadline',"TEXT NOT NULL DEFAULT ''"],['start_time',"TEXT NOT NULL DEFAULT ''"],['meeting_level',"TEXT NOT NULL DEFAULT ''"],['location',"TEXT NOT NULL DEFAULT ''"],['call_url',"TEXT NOT NULL DEFAULT ''"],['audience',"TEXT NOT NULL DEFAULT 'council'"],['audience_ids',"TEXT NOT NULL DEFAULT '[]'"]])if(!db.prepare('PRAGMA table_info(items)').all().some(c=>c.name===column))db.exec(`ALTER TABLE items ADD COLUMN ${column} ${definition}`);
const statuses = ['new','discussion','progress','done','archive'];
const priorities = ['normal','high','urgent'];
const roles = ['chair','deputy_chair','secretary','press_secretary','member','municipal_curator','specialist','local_delegate','regional_delegate'];
const now = () => new Date().toISOString();
const hash = v => createHash('sha256').update(v).digest('hex');
function passwordHash(p) { const salt=randomBytes(16).toString('hex');return `${salt}:${scryptSync(p,salt,64).toString('hex')}`; }
function passwordOk(p,h) { const [s,k]=h.split(':');return timingSafeEqual(Buffer.from(k,'hex'),scryptSync(p,s,64)); }
function fail(message,status=400) { throw Object.assign(new Error(message),{status}); }
function str(v,max=5000) { if(typeof v!=='string')return ''; return v.trim().slice(0,max); }
function required(v,label,max=200) { const s=str(v,max);if(!s)fail(`Заполните поле «${label}».`);return s; }
function userRoles(u){const list=typeof u.roles==='string'?JSON.parse(u.roles):u.roles;return Array.isArray(list)&&list.length?list:[u.role];}
function validRoles(b){const list=b.roles??[b.role];if(!Array.isArray(list)||!list.length||list.length>roles.length||list.some(r=>!roles.includes(r)))fail('Выберите одну или несколько должностей из списка.');return [...new Set(list)];}
function identity(u) { if(!u)return null;const {password,...safe}=u;const list=s=>s===null?null:[...s];return {...safe,roles:userRoles(u),permissions:userPermissions(u),manage_all:manager(u),full_access:fullAccess(u),scope:list(viewScope(u)),manage_scope:list(manageScope(u))}; }
function auth(req) {
 const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('sovety_session='))?.slice(15);
 if(!token)return null;
 return db.prepare('SELECT u.* FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.active=1').get(hash(token),Date.now())||null;
}
function session(res,u) { const t=randomBytes(32).toString('hex'); db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(t),u.id,Date.now()+7*86400000);res.setHeader('Set-Cookie',`sovety_session=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secureCookie}`); }
function manager(u){return userRoles(u).some(r=>['admin','specialist','municipal_curator'].includes(r));}
function admin(u) { if(!manager(u))fail('Это действие доступно координатору.',403); }
// Зоны доступа: координатор и специалист — все Советы; региональный Совет — все Советы;
// местный Совет и муниципальный куратор — свой Совет и подчинённые первичные; первичный — только свой.
const permissionList=['invite_members','request_reports','view_reports','edit_plan','edit_roster','manage_materials'];
function userPermissions(u){let list;try{list=JSON.parse(u.permissions||'[]');}catch{list=[];}return Array.isArray(list)?list.filter(p=>permissionList.includes(p)):[];}
function fullAccess(u){return userRoles(u).some(r=>['admin','specialist'].includes(r));}
function homeCouncils(u){const person=db.prepare('SELECT id FROM council_roster WHERE user_id=? AND archived=0').get(u.id);return [u.council,...(person?db.prepare('SELECT council FROM council_memberships WHERE person_id=?').all(person.id).map(m=>m.council):[])];}
function district(names){const dir=db.prepare('SELECT name,level,parent FROM council_directory').all();if(names.some(n=>dir.find(c=>c.name===n)?.level==='regional'))return null;const set=new Set(names);let grew=true;while(grew){grew=false;for(const c of dir)if(c.parent&&set.has(c.parent)&&!set.has(c.name)){set.add(c.name);grew=true;}}return set;}
function viewScope(u){return fullAccess(u)?null:district(homeCouncils(u));}
function manageScope(u){if(fullAccess(u))return null;return userRoles(u).includes('municipal_curator')?district(homeCouncils(u)):new Set();}
const inScope=(scope,council)=>scope===null||scope.has(council);
function canManage(u,council){return manager(u)&&inScope(manageScope(u),council);}
function canView(u,council){return canManage(u,council)||inScope(viewScope(u),council);}
function allowed(u,permission,council){return canManage(u,council)||(userPermissions(u).includes(permission)&&canView(u,council));}
function canViewPerson(u,p){return canManage(u,p.council)||p.user_id===u.id||(u.signup_source!=='self'&&canView(u,p.council));}
function canEdit(u,i) {
 if(i.user_id!==undefined&&u.signup_source==='self'&&!manager(u))return i.user_id===u.id;
 if(canManage(u,i.council)||u.council===i.council||(i.assignee_ids&&JSON.parse(i.assignee_ids).includes(people.personForUser(u)?.id)))return true;
 return i.kind!==undefined?allowed(u,'edit_plan',i.council):i.months===undefined&&allowed(u,'edit_roster',i.council);
}
function guardRoles(u,chosen){if(!fullAccess(u)&&chosen.some(r=>['specialist','municipal_curator'].includes(r)))fail('Должности специалиста и муниципального куратора назначают координатор или специалист.',403);}
function event(i,u,body,type='change') {db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)').run(randomUUID(),i,u.name,u.id,body,type,now());}
function transaction(fn) {db.exec('BEGIN IMMEDIATE');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}}
const limits=new Map();
function throttle(req) {const k=req.socket.remoteAddress;const old=limits.get(k);const entry=old&&old.until>Date.now()?old:{count:0,until:Date.now()+60000};entry.count++;limits.set(k,entry);if(entry.count>25)fail('Слишком много попыток. Подождите минуту.',429);}
async function body(req) {let text='';for await(const c of req){text+=c;if(Buffer.byteLength(text)>(/^\/api\/(council-reports\/[a-f0-9-]+|council-roster|meetings(?:\/[a-f0-9-]+)?)$/.test(req.url)?2097152:65536))fail('Слишком большой запрос.',413);}try{return JSON.parse(text||'{}');}catch{fail('Не удалось прочитать запрос.');}}
function credentials(b) {const name=required(b.name,'Имя',100), email=required(b.email,'Электронная почта',200).toLowerCase(),password=required(b.password,'Пароль',200);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Введите корректную почту.');if(password.length<10)fail('Пароль должен содержать не менее 10 символов.');return {name,email,password};}
const itemView=(i,subtasks)=>({...i,assignee_ids:JSON.parse(i.assignee_ids),audience_ids:JSON.parse(i.audience_ids||'[]'),subtasks:subtasks?(subtasks.get(i.id)||[]):plan.subtasksFor(i.id)});
function validItem(b,u,old) {
 const v={title:required(b.title,'Название',160),kind:b.kind,description:required(b.description,'Описание',8000),goal:str(b.goal,3000),needs:str(b.needs,3000),next_step:str(b.next_step,3000),result:str(b.result,3000),council:manager(u)||userPermissions(u).includes('edit_plan')?required(b.council,'Совет',200):(old?.council||u.council),owner:str(b.owner,1000)||'Не назначен',deadline:str(b.deadline,10),priority:b.priority||'normal',status:b.status||'new'};
 v.start_time=str(b.start_time,5);v.meeting_level=str(b.meeting_level,20);v.location=str(b.location,500);v.call_url=str(b.call_url,2000);if(v.start_time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.start_time))fail('Проверьте время начала.');if(['meeting','vks'].includes(v.kind)){if(!v.deadline)fail('Укажите дату заседания или ВКС.');if(!['regional','local','primary'].includes(v.meeting_level))fail('Выберите уровень планируемой встречи.');}if(v.call_url){let link;try{link=new URL(v.call_url);}catch{fail('Проверьте ссылку на ВКС.');}if(!['http:','https:'].includes(link.protocol)||link.username||link.password)fail('Укажите обычную ссылку на ВКС.');}
 const assigned=b.assignee_ids===undefined?JSON.parse(old?.assignee_ids||'[]'):b.assignee_ids;v.assignee_ids=JSON.stringify(people.validatePersonIds(assigned,u,JSON.parse(old?.assignee_ids||'[]')));
 const author=b.author_person_id===undefined?(old?.author_person_id||people.personForUser(u)?.id||''):str(b.author_person_id,100);if(author)people.validatePersonIds([author],u,old?.author_person_id?[old.author_person_id]:[]);v.author_person_id=author;
 if(!['council','people'].includes(b.audience||'council'))fail('Выберите, для кого запись.');v.audience=b.audience||'council';const audience=b.audience_ids===undefined?JSON.parse(old?.audience_ids||'[]'):b.audience_ids;v.audience_ids=JSON.stringify(v.audience==='people'?people.validatePersonIds(audience,u,JSON.parse(old?.audience_ids||'[]')):[]);if(v.audience==='people'&&v.audience_ids==='[]')fail('Выберите участников, для которых эта запись.');
 if(assigned.length)v.owner=people.names(assigned).join('; ');else if(b.assignee_ids!==undefined&&JSON.parse(old?.assignee_ids||'[]').length)v.owner='Не назначен';
 if(!kinds.includes(v.kind)||!statuses.includes(v.status)||!priorities.includes(v.priority))fail('Недопустимый тип, статус или приоритет.');
 if(v.deadline&&(!/^\d{4}-\d{2}-\d{2}$/.test(v.deadline)||Number.isNaN(Date.parse(v.deadline))||new Date(v.deadline).toISOString().slice(0,10)!==v.deadline))fail('Проверьте дату срока.');
 if(v.status==='done'&&!v.result)fail('Чтобы завершить запись, опишите результат.');
 if(v.council!==old?.council&&!canManage(u,v.council)&&v.council!==u.council&&!allowed(u,'edit_plan',v.council))fail('Этот Совет вне вашей зоны доступа.',403);
 return v;
}
const json=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const shared={db,randomUUID,now,fail,required,str,admin,canEdit,json,body,transaction,manager,userRoles,canViewPerson,canManage,canView,allowed,fullAccess,userPermissions,homeCouncils,roleLabels:{admin:'Координатор',chair:'Председатель',deputy_chair:'Заместитель председателя',secretary:'Секретарь',press_secretary:'Пресс-секретарь',member:'Участник',municipal_curator:'Муниципальный куратор',specialist:'Специалист',local_delegate:'Делегат в местный Совет Первых',regional_delegate:'Делегат в региональный Совет Первых'}};
const features=councilFeatures({...shared,validatePersonIds:(...a)=>people.validatePersonIds(...a),profileValues:(...a)=>people.profileValues(...a),publicPerson:r=>people.publicPerson(r)});
const people=peopleFeatures(shared);
const plan=planFeatures({...shared,validatePersonIds:(...a)=>people.validatePersonIds(...a),personForUser:u=>people.personForUser(u)});
const materials=materialsFeatures(shared);
const registration=registrationFeatures({...shared,validRoles,credentials,passwordHash,passwordOk,hash,session,identity,throttle,people});
for(const u of db.prepare("SELECT * FROM users WHERE merged_into=''").all())people.ensureRoster(u);
db.exec("UPDATE items SET author_person_id=COALESCE((SELECT id FROM council_roster WHERE user_id=items.created_by LIMIT 1),'') WHERE author_person_id=''");
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
 try{
 const actualPort=server.address().port;
 if(![`127.0.0.1:${actualPort}`,`localhost:${actualPort}`,publicOrigin?new URL(publicOrigin).host:null].includes(req.headers.host))fail('Этот адрес сервера не разрешён.',403);
 const url=new URL(req.url,'http://localhost');const p=url.pathname;const u=auth(req);
 if(p.startsWith('/api/')){
 if(!['GET','HEAD'].includes(req.method)) {if(req.headers.origin&&req.headers.origin!==(publicOrigin||`http://${req.headers.host}`))fail('Запрос с другого сайта отклонён.',403);if(!req.headers['content-type']?.startsWith(/^\/api\/materials\/[a-f0-9-]+\/file$/.test(p)?'application/octet-stream':'application/json'))fail('Ожидался JSON.',415);}
 if(p==='/api/bootstrap'&&req.method==='GET')return json(res,{setupRequired:db.prepare('SELECT count(*) AS n FROM users').get().n===0,user:identity(u),hosted:!!publicOrigin,setupCodeRequired:!!process.env.SETUP_CODE});
 if(p==='/api/setup'&&req.method==='POST') {throttle(req);const b=await body(req);if(process.env.SETUP_CODE&&!timingSafeEqual(Buffer.from(hash(str(b.setup_code,200))),Buffer.from(hash(process.env.SETUP_CODE))))fail('Неверный код первичной настройки.',403);const c=credentials(b);const council=required(b.council,'Совет',200);const user=transaction(()=>{if(db.prepare('SELECT count(*) AS n FROM users').get().n)fail('Первичная настройка уже выполнена.',409);const id=randomUUID();db.prepare('INSERT INTO users(id,name,email,password,role,council,created) VALUES(?,?,?,?,?,?,?)').run(id,c.name,c.email,passwordHash(c.password),'admin',council,now());return db.prepare('SELECT * FROM users WHERE id=?').get(id);});people.ensureRoster(user);session(res,user);return json(res,{user:identity(user)},201);}
 if(p==='/api/login'&&req.method==='POST'){throttle(req);const b=await body(req);let user=db.prepare('SELECT * FROM users WHERE email=?').get(str(b.email,200).toLowerCase());let hops=0;while(user?.merged_into&&hops++<10)user=db.prepare('SELECT * FROM users WHERE id=?').get(user.merged_into);if(!user||!user.active||user.merged_into||!passwordOk(str(b.password,200),user.password))fail('Неверная почта или пароль.',401);session(res,user);return json(res,{user:identity(user)});}
 if(await registration(req,res,p,u))return;
 if(!u)fail('Войдите в аккаунт.',401);
 if(await people(req,res,p,u))return;
 if(await features(req,res,p,u))return;
 if(await plan(req,res,p,u))return;
 if(await materials(req,res,p,u))return;
 if(p==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);res.setHeader('Set-Cookie','sovety_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,{ok:true});}
 if(p==='/api/items'&&req.method==='GET'){const subtaskMap=plan.subtasksByItem();return json(res,{items:db.prepare('SELECT * FROM items ORDER BY updated DESC').all().filter(i=>canView(u,i.council)||canEdit(u,i)).map(i=>itemView(i,subtaskMap)),councils:db.prepare('SELECT name AS council FROM council_directory UNION SELECT council FROM users WHERE active=1 UNION SELECT council FROM council_roster WHERE archived=0 UNION SELECT council FROM items ORDER BY council').all().map(x=>x.council).filter(c=>canView(u,c))});}
 if(p==='/api/items'&&req.method==='POST'){const v=validItem(await body(req),u);const id=randomUUID(),t=now();transaction(()=>{const row={id,...v,created_by:u.id,created:t,updated:t,completed_at:v.status==='done'?t:'',completed_deadline:v.status==='done'?v.deadline:''};const keys=Object.keys(row);db.prepare(`INSERT INTO items(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));event(id,u,'Создана запись.');});return json(res,{item:itemView(db.prepare('SELECT * FROM items WHERE id=?').get(id))},201);}
 const match=p.match(/^\/api\/items\/([a-f0-9-]+)(\/comments)?$/);
 if(match){const i=db.prepare('SELECT * FROM items WHERE id=?').get(match[1]);if(!i||!(canView(u,i.council)||canEdit(u,i)))fail('Запись не найдена.',404);
 if(match[2]&&req.method==='POST'){const b=await body(req);event(i.id,u,required(b.body,'Комментарий',4000),'comment');return json(res,{ok:true},201);}
 if(!match[2]&&req.method==='GET')return json(res,{item:itemView(i),events:db.prepare('SELECT * FROM events WHERE item_id=? ORDER BY created,id').all(i.id),canEdit:canEdit(u,i)});
 if(!match[2]&&req.method==='PUT'){if(!canEdit(u,i))fail('Изменять запись может её Совет или координатор.',403);const b=await body(req);const v=validItem(b,u,i);if(v.status==='done'&&i.status!=='done'){v.completed_at=now();v.completed_deadline=v.deadline;}else if(v.status!=='done'){v.completed_at='';v.completed_deadline='';}transaction(()=>{const fields=Object.keys(v);const result=db.prepare(`UPDATE items SET ${fields.map(k=>`${k}=?`).join(',')},updated=?,version=version+1 WHERE id=? AND version=?`).run(...fields.map(k=>v[k]),now(),i.id,b.version);if(!result.changes)fail('Запись уже обновлена другим участником. Откройте её заново.',409);const changes=fields.filter(k=>v[k]!==i[k]);event(i.id,u,changes.includes('status')?`Изменён статус: ${i.status} → ${v.status}.`:'Обновлены сведения записи.');});return json(res,{item:itemView(db.prepare('SELECT * FROM items WHERE id=?').get(i.id))});}
 }
 if(p==='/api/members'&&req.method==='GET'){if(!manager(u)&&!userPermissions(u).includes('invite_members'))admin(u);return json(res,{members:db.prepare("SELECT id,name,email,role,roles,permissions,council,active,created FROM users WHERE merged_into='' ORDER BY created").all().filter(m=>canManage(u,m.council)||(m.id!==u.id&&allowed(u,'invite_members',m.council))).map(m=>({...identity(m),can_manage:canManage(u,m.council)&&m.id!==u.id}))});}
 if(p==='/api/invites'&&req.method==='POST'){if(!manager(u)&&!userPermissions(u).includes('invite_members'))admin(u);const b=await body(req),chosen=validRoles(b);const council=required(b.council,'Совет',200),code=randomBytes(9).toString('hex').toUpperCase();guardRoles(u,chosen);
 const known=db.prepare('SELECT * FROM council_directory WHERE name=?').get(council),parent=str(b.parent,200)||(!known&&!fullAccess(u)&&(b.level||'primary')==='primary'?u.council:'');
 if(known?!allowed(u,'invite_members',council):!fullAccess(u)&&((b.level||'primary')!=='primary'||!allowed(u,'invite_members',parent)))fail(known?'Этот Совет вне вашей зоны доступа.':'Новый Совет вне вашей зоны можно создать только как первичный Совет внутри своего района.',403);
 transaction(()=>{people.ensureCouncil(council,fullAccess(u)?b.level:(b.level||'primary'),parent);if(b.name&&!b.allow_homonym&&(registration.matchingAccounts(b.name,council).length||registration.matchingPeople(b.name,council).some(p=>p.user_id)))fail('У этого участника уже есть аккаунт в Совете. Измените его должности в списке участников.',409);const personId=b.name?people.pendingPerson(council,required(b.name,'ФИО',100),chosen,b.allow_homonym===true):'';db.prepare('INSERT INTO invites(code,role,council,expires,used_by,roles,person_id,allow_homonym) VALUES(?,?,?,?,NULL,?,?,?)').run(hash(code),chosen[0],council,Date.now()+7*86400000,JSON.stringify(chosen),personId,b.allow_homonym===true?1:0);});return json(res,{code,council,role:chosen[0],roles:chosen,expires:Date.now()+7*86400000},201);}
 if(p==='/api/members/roles'&&req.method==='POST'){admin(u);const b=await body(req),chosen=validRoles(b),target=db.prepare('SELECT * FROM users WHERE id=?').get(b.id);if(!target||target.merged_into||target.role==='admin')fail('Должности координатора изменить нельзя.');if(!canManage(u,target.council)||target.id===u.id)fail('Этот участник вне вашей зоны доступа.',403);guardRoles(u,chosen);db.prepare('UPDATE users SET role=?,roles=? WHERE id=?').run(chosen[0],JSON.stringify(chosen),b.id);people.ensureRoster(db.prepare('SELECT * FROM users WHERE id=?').get(b.id),true);return json(res,{ok:true});}
 if(p==='/api/members/access'&&req.method==='POST'){admin(u);const b=await body(req);if(b.id===u.id)fail('Нельзя отключить собственный аккаунт.');const target=db.prepare('SELECT * FROM users WHERE id=?').get(b.id);if(!target||target.merged_into||target.role==='admin')fail('Этот аккаунт нельзя изменить.');if(!canManage(u,target.council))fail('Этот участник вне вашей зоны доступа.',403);db.prepare('UPDATE users SET active=? WHERE id=?').run(b.active?1:0,b.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(b.id);return json(res,{ok:true});}
 if(p==='/api/members/permissions'&&req.method==='POST'){admin(u);const b=await body(req),target=db.prepare('SELECT * FROM users WHERE id=?').get(b.id);if(!target||target.merged_into||target.role==='admin')fail('Права координатора изменить нельзя.');if(target.id===u.id)fail('Нельзя изменить собственные права.');if(!canManage(u,target.council))fail('Этот участник вне вашей зоны доступа.',403);const list=b.permissions;if(!Array.isArray(list)||list.some(p=>!permissionList.includes(p)))fail('Выберите права из списка.');db.prepare('UPDATE users SET permissions=? WHERE id=?').run(JSON.stringify([...new Set(list)]),target.id);return json(res,{ok:true});}
 if(p==='/api/export'&&req.method==='GET'){if(!fullAccess(u))fail('Полная выгрузка доступна координатору и специалисту.',403);return json(res,{format:'zhivye-sovety-v1',exportedAt:now(),items:db.prepare('SELECT * FROM items').all(),events:db.prepare('SELECT * FROM events').all(),...features.backup(),...plan.backup(),...materials.backup(),...people.backup(),...registration.backup()});}
 fail('Такого действия нет.',404);
 }
 if(!['GET','HEAD'].includes(req.method))fail('Метод не поддерживается.',405);
 const files={'/materials.js':['materials.js','text/javascript; charset=utf-8'],'/efficiency.js':['efficiency.js','text/javascript; charset=utf-8'],'/plan.js':['plan.js','text/javascript; charset=utf-8'],'/council-picker.js':['council-picker.js','text/javascript; charset=utf-8'],'/person-picker.js':['person-picker.js','text/javascript; charset=utf-8'],'/registration.js':['registration.js','text/javascript; charset=utf-8'],'/people.js':['people.js','text/javascript; charset=utf-8'],'/exceljs.min.js':['exceljs.min.js','text/javascript; charset=utf-8'],'/exceljs-LICENSE.txt':['exceljs-LICENSE.txt','text/plain; charset=utf-8'],'/exports.js':['exports.js','text/javascript; charset=utf-8'],'/council-features.js':['council-features.js','text/javascript; charset=utf-8'],'/first-mark.svg':['first-mark.svg','image/svg+xml'],'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/favicon.svg':['favicon.svg','image/svg+xml']};
 if(!files[p])fail('Страница не найдена.',404);const [file,type]=files[p];res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:readFileSync(join(root,'public',file)));
 }catch(e){json(res,{error:e.status?e.message:'Не удалось выполнить действие. Попробуйте ещё раз.'},e.status||500);if(!e.status)console.error(e);}
});
const port=Number(process.env.PORT||18765);
server.listen(port,host,()=>console.log(`Живые Советы: http://127.0.0.1:${server.address().port}`));
function shutdown(){server.close(()=>{db.close();process.exit(0);});}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
