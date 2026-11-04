export function materialsFeatures(h){
 const {db,randomUUID,now,fail,required,str,json,body,transaction,fullAccess,canManage,userRoles,userPermissions,homeCouncils,manager}=h;
 db.exec(`CREATE TABLE IF NOT EXISTS materials(id TEXT PRIMARY KEY,title TEXT NOT NULL,category TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',url TEXT NOT NULL DEFAULT '',levels TEXT NOT NULL DEFAULT '[]',councils TEXT NOT NULL DEFAULT '[]',roles TEXT NOT NULL DEFAULT '[]',author_id TEXT NOT NULL REFERENCES users(id),author_name TEXT NOT NULL,file_name TEXT NOT NULL DEFAULT '',file_type TEXT NOT NULL DEFAULT '',file_size INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS material_files(material_id TEXT PRIMARY KEY REFERENCES materials(id),data BLOB NOT NULL);`);
 const categories=['methodics','documents','presentations','vks','links','other'],levels=['regional','local','primary'];
 const roles=['admin','chair','deputy_chair','secretary','press_secretary','member','municipal_curator','specialist','local_delegate','regional_delegate'];
 // Только офисные документы, PDF, текст и изображения: файлы всегда отдаются на скачивание, а не открываются как страница.
 const types={pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',odt:'application/vnd.oasis.opendocument.text',ods:'application/vnd.oasis.opendocument.spreadsheet',odp:'application/vnd.oasis.opendocument.presentation',rtf:'application/rtf',txt:'text/plain',csv:'text/csv',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',zip:'application/zip'};
 const fileLimit=10*1024*1024,quota=300*1024*1024;
 const used=()=>db.prepare('SELECT COALESCE(SUM(file_size),0) AS n FROM materials').get().n;
 const canAdd=u=>manager(u)||userPermissions(u).includes('manage_materials');
 const canChange=(u,m)=>m.author_id===u.id||fullAccess(u);
 function visible(u,m){
  if(fullAccess(u)||m.author_id===u.id)return true;
  const lv=JSON.parse(m.levels),cs=JSON.parse(m.councils),rs=JSON.parse(m.roles),home=homeCouncils(u);
  const levelOf=c=>db.prepare('SELECT level FROM council_directory WHERE name=?').get(c)?.level;
  return (!lv.length||home.some(c=>lv.includes(levelOf(c))))&&(!cs.length||home.some(c=>cs.includes(c)))&&(!rs.length||userRoles(u).some(r=>rs.includes(r)));
 }
 const view=(m,u)=>({...m,levels:JSON.parse(m.levels),councils:JSON.parse(m.councils),roles:JSON.parse(m.roles),has_file:!!m.file_name,can_edit:canChange(u,m)});
 const list=(v,allowed,label)=>{if(v===undefined)return [];if(!Array.isArray(v)||v.length>300||v.some(x=>typeof x!=='string'||!allowed(x)))fail(`Проверьте поле «${label}».`);return [...new Set(v)];};
 function values(b){
  const title=required(b.title,'Название',200),category=b.category;if(!categories.includes(category))fail('Выберите раздел материала.');
  const url=str(b.url,2000);if(url){let link;try{link=new URL(url);}catch{fail('Проверьте ссылку.');}if(!['http:','https:'].includes(link.protocol)||link.username||link.password)fail('Ссылка должна начинаться с https:// или http://.');}
  const known=new Set(db.prepare('SELECT name FROM council_directory').all().map(c=>c.name));
  return {title,category,description:str(b.description,5000),url,levels:JSON.stringify(list(b.levels,x=>levels.includes(x),'Уровни')),councils:JSON.stringify(list(b.councils,x=>known.has(x),'Советы')),roles:JSON.stringify(list(b.roles,x=>roles.includes(x),'Должности'))};
 }
 async function raw(req){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>fileLimit)fail('Файл больше 10 МБ. Сожмите его или загрузите на Яндекс Диск и добавьте ссылку.',413);chunks.push(c);}return Buffer.concat(chunks);}
 const get=id=>{const m=db.prepare('SELECT * FROM materials WHERE id=?').get(id);if(!m)fail('Материал не найден.',404);return m;};
 const handler=async(req,res,p,u)=>{
  if(!p.startsWith('/api/materials'))return false;
  if(p==='/api/materials'&&req.method==='GET'){json(res,{materials:db.prepare('SELECT * FROM materials ORDER BY updated DESC').all().filter(m=>visible(u,m)).map(m=>view(m,u)),can_add:canAdd(u),used:used(),quota,file_limit:fileLimit,types:Object.keys(types)});return true;}
  if(p==='/api/materials'&&req.method==='POST'){if(!canAdd(u))fail('Добавлять материалы могут управляющие и участники с правом «Добавлять методические материалы».',403);const v=values(await body(req)),id=randomUUID(),t=now();db.prepare('INSERT INTO materials(id,title,category,description,url,levels,councils,roles,author_id,author_name,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,v.title,v.category,v.description,v.url,v.levels,v.councils,v.roles,u.id,u.name,t,t);json(res,{material:view(get(id),u)},201);return true;}
  const m=p.match(/^\/api\/materials\/([a-f0-9-]+)(?:\/(file|remove))?$/);if(!m)fail('Такого действия нет.',404);
  const old=get(m[1]);if(!visible(u,old))fail('Материал не найден.',404);
  if(m[2]==='file'&&req.method==='GET'){const f=db.prepare('SELECT data FROM material_files WHERE material_id=?').get(old.id);if(!f)fail('Файл не найден.',404);res.writeHead(200,{'Content-Type':old.file_type||'application/octet-stream','Content-Length':f.data.length,'Content-Disposition':`attachment; filename="material.${old.file_name.split('.').pop()}"; filename*=UTF-8''${encodeURIComponent(old.file_name)}`,'Cache-Control':'private, no-store'});res.end(f.data);return true;}
  if(!canChange(u,old))fail('Изменять материал может его автор, координатор или специалист.',403);
  if(m[2]==='file'&&req.method==='PUT'){
   let name;try{name=decodeURIComponent(String(req.headers['x-file-name']||''));}catch{fail('Не удалось прочитать имя файла.');}name=name.replace(/[\\/\0\r\n"]/g,'_').trim().slice(0,200);const ext=name.includes('.')?name.split('.').pop().toLowerCase():'';
   if(!types[ext])fail('Можно загрузить PDF, документы Word, Excel, PowerPoint, OpenDocument, текст, изображения JPG/PNG или архив ZIP.');
   const data=await raw(req);if(!data.length)fail('Файл пустой.');if(used()-old.file_size+data.length>quota)fail('Место для файлов закончилось (300 МБ). Удалите ненужные материалы или храните крупные файлы по ссылке.',413);
   transaction(()=>{db.prepare('INSERT INTO material_files VALUES(?,?) ON CONFLICT(material_id) DO UPDATE SET data=excluded.data').run(old.id,data);db.prepare('UPDATE materials SET file_name=?,file_type=?,file_size=?,updated=? WHERE id=?').run(name,types[ext],data.length,now(),old.id);});
   json(res,{material:view(get(old.id),u)});return true;
  }
  if(m[2]==='remove'&&req.method==='POST'){transaction(()=>{db.prepare('DELETE FROM material_files WHERE material_id=?').run(old.id);db.prepare('DELETE FROM materials WHERE id=?').run(old.id);});json(res,{ok:true});return true;}
  if(!m[2]&&req.method==='PUT'){const b=await body(req),v=values(b);if(b.remove_file===true)db.prepare('DELETE FROM material_files WHERE material_id=?').run(old.id);db.prepare(`UPDATE materials SET title=?,category=?,description=?,url=?,levels=?,councils=?,roles=?,updated=?${b.remove_file===true?",file_name='',file_type='',file_size=0":''} WHERE id=?`).run(v.title,v.category,v.description,v.url,v.levels,v.councils,v.roles,now(),old.id);json(res,{material:view(get(old.id),u)});return true;}
  fail('Метод не поддерживается.',405);
 };
 handler.backup=()=>({materials:db.prepare('SELECT * FROM materials').all()});
 return handler;
}
