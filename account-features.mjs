export function accountFeatures(h){
 const {db,now,fail,required,str,json,body,transaction,identity,passwordHash,passwordOk,session,throttle,people}=h;
 const current=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
 const ownPerson=u=>people.personForUser(u);
 const result=(res,u)=>json(res,{user:identity(current(u.id)),person:ownPerson(u)?people.publicPerson(ownPerson(u)):null});
 const checkPassword=(u,password)=>{if(!passwordOk(required(password,'Текущий пароль',200),u.password))fail('Текущий пароль указан неверно.',403);};
 const handler=async(req,res,p,u)=>{
  if(!p.startsWith('/api/account'))return false;
  if(p==='/api/account'&&req.method==='GET'){result(res,u);return true;}
  if(p==='/api/account/profile'&&req.method==='PUT'){
   const person=ownPerson(u);if(!person)fail('Личная карточка пока не связана с аккаунтом. Обратитесь к управляющему.',409);
   const b=await body(req),name=required(b.name,'ФИО',200),profile=people.profileValues(b,person),t=now();
   transaction(()=>{db.prepare('UPDATE users SET name=? WHERE id=?').run(name,u.id);db.prepare('UPDATE council_roster SET name=?,birth_year=?,education=?,institution=?,study_year=?,phone=?,vk=?,bio=?,photo=?,updated=? WHERE id=?').run(name,profile.birth_year,profile.education,profile.institution,profile.study_year,profile.phone,profile.vk,profile.bio,profile.photo,t,person.id);});
   result(res,u);return true;
  }
  if(p==='/api/account/email'&&req.method==='PUT'){
   throttle(req);const b=await body(req);checkPassword(u,b.current_password);
   const email=required(b.email,'Электронная почта',200).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Введите корректную почту.');
   if(db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(email,u.id))fail('Эта почта уже используется другим аккаунтом.',409);
   db.prepare('UPDATE users SET email=? WHERE id=?').run(email,u.id);result(res,u);return true;
  }
  if(p==='/api/account/password'&&req.method==='PUT'){
   throttle(req);const b=await body(req);checkPassword(u,b.current_password);
   const password=required(b.new_password,'Новый пароль',200);if(password.length<10)fail('Новый пароль должен содержать не менее 10 символов.');
   if(password!==str(b.confirmation,200))fail('Пароли не совпадают.');if(passwordOk(password,u.password))fail('Новый пароль должен отличаться от текущего.');
   transaction(()=>{db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordHash(password),u.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);});session(res,current(u.id));json(res,{ok:true});return true;
  }
  if(p==='/api/account'||['/api/account/profile','/api/account/email','/api/account/password'].includes(p))fail('Метод не поддерживается.',405);
  return false;
 };
 return handler;
}
