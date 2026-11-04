export function planFeatures(h){
 const {db,randomUUID,now,fail,required,str,canEdit,json,body,transaction,validatePersonIds,personForUser,hooks}=h;
 db.exec(`CREATE TABLE IF NOT EXISTS item_subtasks(id TEXT PRIMARY KEY,item_id TEXT NOT NULL REFERENCES items(id),title TEXT NOT NULL,deadline TEXT NOT NULL DEFAULT '',assignee_ids TEXT NOT NULL DEFAULT '[]',done INTEGER NOT NULL DEFAULT 0,done_at TEXT NOT NULL DEFAULT '',position INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS personal_entries(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,date TEXT NOT NULL,start_time TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',done INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL,updated TEXT NOT NULL);`);
 const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
 const subtaskView=s=>({...s,assignee_ids:JSON.parse(s.assignee_ids),done:!!s.done});
 const entryView=e=>({...e,done:!!e.done});
 function subtasksByItem(){const map=new Map();for(const s of db.prepare('SELECT * FROM item_subtasks ORDER BY position,created').all()){if(!map.has(s.item_id))map.set(s.item_id,[]);map.get(s.item_id).push(subtaskView(s));}return map;}
 const subtasksFor=id=>db.prepare('SELECT * FROM item_subtasks WHERE item_id=? ORDER BY position,created').all(id).map(subtaskView);
 const event=(itemId,u,text)=>db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)').run(randomUUID(),itemId,u.name,u.id,text,'change',now());
 function subtaskValues(b,u,old){
  const title=required(b.title,'Подзадача',200),deadline=str(b.deadline,10);if(deadline&&!validDate(deadline))fail('Проверьте срок подзадачи.');
  const ids=b.assignee_ids===undefined?JSON.parse(old?.assignee_ids||'[]'):validatePersonIds(b.assignee_ids,u,JSON.parse(old?.assignee_ids||'[]'));
  return {title,deadline,assignee_ids:JSON.stringify(ids)};
 }
 function entryValues(b){
  const title=required(b.title,'Что запланировано',200),date=required(b.date,'Дата',10),start_time=str(b.start_time,5);
  if(!validDate(date))fail('Проверьте дату.');if(start_time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(start_time))fail('Проверьте время.');
  return {title,date,start_time,note:str(b.note,3000),done:b.done?1:0};
 }
 const handler=async(req,res,p,u)=>{
  const add=p.match(/^\/api\/items\/([a-f0-9-]+)\/subtasks$/);
  if(add&&req.method==='POST'){
   const item=db.prepare('SELECT * FROM items WHERE id=?').get(add[1]);if(!item)fail('Запись не найдена.',404);if(!canEdit(u,item))fail('Добавлять подзадачи может Совет записи или ответственный.',403);
   if(db.prepare('SELECT count(*) AS n FROM item_subtasks WHERE item_id=?').get(item.id).n>=100)fail('В одной задаче может быть не более 100 подзадач.');
   const v=subtaskValues(await body(req),u),id=randomUUID(),t=now(),position=db.prepare('SELECT COALESCE(MAX(position),0)+1 AS n FROM item_subtasks WHERE item_id=?').get(item.id).n;
   transaction(()=>{db.prepare('INSERT INTO item_subtasks(id,item_id,title,deadline,assignee_ids,position,created,updated) VALUES(?,?,?,?,?,?,?,?)').run(id,item.id,v.title,v.deadline,v.assignee_ids,position,t,t);event(item.id,u,`Добавлена подзадача «${v.title}».`);});
   const created=db.prepare('SELECT * FROM item_subtasks WHERE id=?').get(id);hooks?.subtaskSaved(created,item,[],u);json(res,{subtask:subtaskView(created)},201);return true;
  }
  const sub=p.match(/^\/api\/subtasks\/([a-f0-9-]+)(\/remove)?$/);
  if(sub&&req.method==='POST'||sub&&req.method==='PUT'){
   const s=db.prepare('SELECT * FROM item_subtasks WHERE id=?').get(sub[1]);if(!s)fail('Подзадача не найдена.',404);const item=db.prepare('SELECT * FROM items WHERE id=?').get(s.item_id);
   const editor=canEdit(u,item),assignee=JSON.parse(s.assignee_ids).includes(personForUser(u)?.id);
   if(sub[2]&&req.method==='POST'){if(!editor)fail('Удалять подзадачи может Совет записи или ответственный.',403);transaction(()=>{db.prepare('DELETE FROM item_subtasks WHERE id=?').run(s.id);event(item.id,u,`Удалена подзадача «${s.title}».`);});json(res,{ok:true});return true;}
   if(sub[2]||req.method!=='PUT')fail('Метод не поддерживается.',405);
   if(!editor&&!assignee)fail('Изменять подзадачу может Совет записи или её ответственный.',403);
   const b=await body(req),done=b.done===undefined?!!s.done:b.done===true,v=editor&&b.title!==undefined?subtaskValues(b,u,s):{title:s.title,deadline:s.deadline,assignee_ids:s.assignee_ids};
   transaction(()=>{db.prepare('UPDATE item_subtasks SET title=?,deadline=?,assignee_ids=?,done=?,done_at=?,updated=? WHERE id=?').run(v.title,v.deadline,v.assignee_ids,done?1:0,done?(s.done?s.done_at:now()):'',now(),s.id);if(done!==!!s.done)event(item.id,u,done?`Подзадача «${v.title}» выполнена.`:`Подзадача «${v.title}» снова в работе.`);else event(item.id,u,`Обновлена подзадача «${v.title}».`);});
   const saved=db.prepare('SELECT * FROM item_subtasks WHERE id=?').get(s.id);hooks?.subtaskSaved(saved,item,JSON.parse(s.assignee_ids),u);json(res,{subtask:subtaskView(saved)});return true;
  }
  // Личные записи календаря видит и изменяет только их владелец.
  if(p==='/api/personal'&&req.method==='GET'){json(res,{entries:db.prepare('SELECT * FROM personal_entries WHERE user_id=? ORDER BY date,start_time').all(u.id).map(entryView)});return true;}
  if(p==='/api/personal'&&req.method==='POST'){if(db.prepare('SELECT count(*) AS n FROM personal_entries WHERE user_id=?').get(u.id).n>=2000)fail('Слишком много личных записей. Удалите старые.');const v=entryValues(await body(req)),id=randomUUID(),t=now();db.prepare('INSERT INTO personal_entries(id,user_id,title,date,start_time,note,done,created,updated) VALUES(?,?,?,?,?,?,?,?,?)').run(id,u.id,v.title,v.date,v.start_time,v.note,v.done,t,t);json(res,{entry:entryView(db.prepare('SELECT * FROM personal_entries WHERE id=?').get(id))},201);return true;}
  const own=p.match(/^\/api\/personal\/([a-f0-9-]+)(\/remove)?$/);
  if(own){const e=db.prepare('SELECT * FROM personal_entries WHERE id=? AND user_id=?').get(own[1],u.id);if(!e)fail('Запись не найдена.',404);
   if(own[2]&&req.method==='POST'){db.prepare('DELETE FROM personal_entries WHERE id=?').run(e.id);json(res,{ok:true});return true;}
   if(!own[2]&&req.method==='PUT'){const v=entryValues(await body(req));db.prepare('UPDATE personal_entries SET title=?,date=?,start_time=?,note=?,done=?,updated=? WHERE id=?').run(v.title,v.date,v.start_time,v.note,v.done,now(),e.id);json(res,{entry:entryView(db.prepare('SELECT * FROM personal_entries WHERE id=?').get(e.id))});return true;}
   fail('Метод не поддерживается.',405);}
  return false;
 };
 Object.assign(handler,{subtasksByItem,subtasksFor,backup:()=>({subtasks:db.prepare('SELECT * FROM item_subtasks').all(),personalEntries:db.prepare('SELECT * FROM personal_entries').all()})});
 return handler;
}
