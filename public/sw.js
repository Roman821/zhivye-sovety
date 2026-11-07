// Service Worker платформы «Советы Первых 19»: установка как приложения, просмотр без интернета, push-уведомления.
const SHELL='sovety-shell-v2',API='sovety-api';
const shell=['/','/style.css','/app.js','/council-features.js','/exceljs.min.js','/exports.js','/people.js','/person-picker.js','/registration.js','/plan.js','/efficiency.js','/materials.js','/council-picker.js','/pwa.js','/first-logo-white.png','/favicon.png','/icon-192.png','/manifest.webmanifest'];
// Только эти ответы сервера сохраняются для просмотра без связи. Файлы материалов и фото не кешируются.
const cachedApi=['/api/bootstrap','/api/items','/api/people-data','/api/personal','/api/council-data','/api/materials','/api/identity-status','/api/notifications'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(SHELL).then(c=>c.addAll(shell)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==SHELL&&k!==API).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
 const r=e.request,u=new URL(r.url);if(r.method!=='GET'||u.origin!==self.location.origin)return;
 const api=u.pathname.startsWith('/api/');if(api&&!cachedApi.includes(u.pathname))return;
 // Сначала сеть — данные всегда свежие; без связи — последняя сохранённая версия.
 e.respondWith(fetch(r).then(res=>{if(res.ok){const copy=res.clone();caches.open(api?API:SHELL).then(c=>c.put(r,copy));}return res;}).catch(async()=>{
  const hit=await caches.match(r);if(hit)return hit;
  if(api)return new Response(JSON.stringify({error:'Нет связи с сервером. Проверьте интернет.'}),{status:503,headers:{'Content-Type':'application/json; charset=utf-8'}});
  return caches.match('/');
 }));
});
self.addEventListener('push',e=>{e.waitUntil((async()=>{
 let list=[];try{const sub=await self.registration.pushManager.getSubscription();const r=await fetch('/api/notifications/pending',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:sub?.endpoint||''})});if(r.ok)list=(await r.json()).notifications;}catch{}
 if(!list.length)list=[{id:'sovety',title:'Советы Первых 19',body:'Есть новые уведомления.',url:'/'}];
 await Promise.all(list.slice(0,5).map(n=>self.registration.showNotification(n.title,{body:n.body,icon:'/icon-192.png',badge:'/icon-192.png',tag:n.id,lang:'ru',data:{url:n.url||'/'}})));
})());});
self.addEventListener('notificationclick',e=>{e.notification.close();const url=new URL(e.notification.data?.url||'/',self.location.origin).href;e.waitUntil((async()=>{
 const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
 for(const w of windows)if(new URL(w.url).origin===self.location.origin){await w.focus();return w.navigate(url);}
 return self.clients.openWindow(url);
})());});
