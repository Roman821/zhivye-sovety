export function qaFeatures(h){
 const {db,randomUUID,now,fail,required,json,body,fullAccess}=h;
 db.exec(`CREATE TABLE IF NOT EXISTS qa_questions(
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id),
  author_name TEXT NOT NULL,
  council TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT '',
  answer_author_id TEXT NOT NULL DEFAULT '',
  answer_author_name TEXT NOT NULL DEFAULT '',
  created TEXT NOT NULL,
  updated TEXT NOT NULL,
  answered_at TEXT NOT NULL DEFAULT ''
 );`);
 const view=(q,u)=>({...q,answered:!!q.answer,can_delete:fullAccess(u)||q.author_id===u.id});
 const get=id=>{const q=db.prepare('SELECT * FROM qa_questions WHERE id=?').get(id);if(!q)fail('Вопрос не найден.',404);return q;};
 const handler=async(req,res,p,u)=>{
  if(!p.startsWith('/api/qa'))return false;
  if(p==='/api/qa'&&req.method==='GET'){
   const questions=db.prepare('SELECT * FROM qa_questions ORDER BY answered_at=\'\' DESC,updated DESC').all().map(q=>view(q,u));
   json(res,{questions,can_answer:fullAccess(u),open_count:questions.filter(q=>!q.answered).length});return true;
  }
  if(p==='/api/qa'&&req.method==='POST'){
   const b=await body(req),question=required(b.question,'Вопрос',5000),id=randomUUID(),t=now();
   db.prepare('INSERT INTO qa_questions(id,question,author_id,author_name,council,created,updated) VALUES(?,?,?,?,?,?,?)').run(id,question,u.id,u.name,u.council,t,t);
   json(res,{question:view(get(id),u)},201);return true;
  }
  const match=p.match(/^\/api\/qa\/([a-f0-9-]+)$/);if(!match)fail('Такого действия нет.',404);
  const old=get(match[1]);
  if(req.method==='PUT'){
   if(!fullAccess(u))fail('Отвечать на вопросы могут координатор и специалист.',403);
   const b=await body(req),answer=required(b.answer,'Ответ',8000),t=now();
   db.prepare('UPDATE qa_questions SET answer=?,answer_author_id=?,answer_author_name=?,answered_at=?,updated=? WHERE id=?').run(answer,u.id,u.name,t,t,old.id);
   json(res,{question:view(get(old.id),u)});return true;
  }
  if(req.method==='DELETE'){
   if(!fullAccess(u)&&old.author_id!==u.id)fail('Удалить вопрос может его автор, координатор или специалист.',403);
   db.prepare('DELETE FROM qa_questions WHERE id=?').run(old.id);json(res,{ok:true});return true;
  }
  fail('Метод не поддерживается.',405);
 };
 handler.backup=()=>({qaQuestions:db.prepare('SELECT * FROM qa_questions').all()});
 return handler;
}
