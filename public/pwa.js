// Веб-приложение: установка, работа без связи, уведомления и колокольчик.
let pwaInstallEvent=null,pwaPush=null,pwaNotifications={notifications:[],unread:0};
const pwaStandalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const pwaIos=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const pwaPushSupported=()=>'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
function pwaSidebar(){if(state.demo)return '';const install=!pwaStandalone()&&(pwaInstallEvent||pwaIos());const push=pwaPushSupported()||pwaIos();return (install||push)?`<div class="pwa-actions">${install?`<button class="nav-item" data-action="pwa-install">${icon('download')}<span>Установить приложение</span></button>`:''}${push?`<button class="nav-item" data-action="pwa-push">${icon('alert')}<span>Уведомления: ${pwaPush?'включены':'выключены'}</span></button>`:''}</div>`:'';}
function pwaTopbar(){if(state.demo||!state.user)return '';const n=pwaNotifications.unread;return `<button class="icon-button pwa-bell" data-action="pwa-bell" aria-label="Уведомления${n?': новых '+n:''}" title="Уведомления">${icon('alert')}${n?`<span class="pwa-count">${n>99?'99+':n}</span>`:''}</button>`;}
async function pwaLoadNotifications(){if(state.demo||!state.user)return;try{pwaNotifications=await api('/notifications');}catch{}}
function pwaBase64(v){const s=(v+'='.repeat((4-v.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/'),raw=atob(s);return Uint8Array.from(raw,c=>c.charCodeAt(0));}
async function pwaCheckPush(){if(!pwaPushSupported())return;try{const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();pwaPush=sub&&Notification.permission==='granted'?sub:null;if(pwaPush&&state.user)await api('/push/subscribe','POST',{endpoint:pwaPush.endpoint});}catch{pwaPush=null;}}
async function pwaTogglePush(){
 if(!pwaPushSupported()){modal(`<h2>Уведомления на iPhone и iPad</h2><p>На iPhone и iPad уведомления работают только в установленном приложении (iOS 16.4 и новее).</p><ol><li>Откройте сайт в Safari.</li><li>Нажмите «Поделиться» ${'⬆️'}.</li><li>Выберите «На экран «Домой»».</li><li>Откройте приложение с главного экрана и включите уведомления.</li></ol>${btn('Понятно','close','primary')}`);return;}
 if(pwaPush){await api('/push/unsubscribe','POST',{endpoint:pwaPush.endpoint});await pwaPush.unsubscribe();pwaPush=null;render();toast('Уведомления выключены на этом устройстве.');return;}
 const permission=await Notification.requestPermission();if(permission!=='granted'){toast(permission==='denied'?'Уведомления запрещены в настройках браузера. Разрешите их для этого сайта и попробуйте снова.':'Уведомления не включены.');return;}
 const reg=await navigator.serviceWorker.ready,{key}=await api('/push/key');
 pwaPush=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:pwaBase64(key)});await api('/push/subscribe','POST',{endpoint:pwaPush.endpoint});render();toast('Уведомления включены: о назначенных задачах, заседаниях, отчётах и сроках на завтра.');
}
async function pwaInstall(){
 if(pwaInstallEvent){pwaInstallEvent.prompt();const choice=await pwaInstallEvent.userChoice;pwaInstallEvent=null;render();if(choice.outcome==='accepted')toast('Приложение установлено.');return;}
 modal(`<h2>Установить на iPhone или iPad</h2><ol><li>Откройте сайт в Safari.</li><li>Нажмите «Поделиться» ${'⬆️'} внизу экрана.</li><li>Выберите «На экран «Домой»» и нажмите «Добавить».</li></ol><p class="muted">На Android и компьютере установка предлагается кнопкой браузера в адресной строке или в меню «Установить приложение».</p>${btn('Понятно','close','primary')}`);
}
function pwaBell(){const list=pwaNotifications.notifications;modal(`<div class="eyebrow">УВЕДОМЛЕНИЯ</div><h2>Что нового</h2>${list.length?`<ul class="pwa-list">${list.map(n=>`<li class="${n.read?'':'unread'}"><a href="${esc(n.url)}" data-action="close"><strong>${esc(n.title)}</strong><span>${esc(n.body)}</span><small>${new Date(n.created).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</small></a></li>`).join('')}</ul>`:'<p class="muted">Пока уведомлений нет. Здесь появятся назначенные вам задачи и подзадачи, заседания, запросы отчётов и напоминания о сроках.</p>'}${pwaPushSupported()&&!pwaPush?`<p class="muted">Чтобы получать их на телефон или компьютер, включите «Уведомления» в меню слева.</p>`:''}${btn('Закрыть','close','primary')}`);if(pwaNotifications.unread)api('/notifications/read','POST',{}).then(()=>{pwaNotifications.unread=0;pwaNotifications.notifications.forEach(n=>n.read=true);const b=$('.pwa-bell');if(b)b.outerHTML=pwaTopbar();}).catch(()=>{});}
// Ссылки из уведомлений: /#item=ID и /#page=calendar
function pwaRoute(){const m=location.hash.match(/^#(item|page)=([\w-]+)$/);if(!m||state.demo)return;history.replaceState(null,'',location.pathname);if($('#modal')?.open)closeModal();if(m[1]==='page'){state.page=m[2];render();}else detail(m[2]);}
document.addEventListener('click',async e=>{const b=e.target.closest('[data-action^="pwa-"]');if(!b)return;try{if(b.dataset.action==='pwa-install')await pwaInstall();if(b.dataset.action==='pwa-push')await pwaTogglePush();if(b.dataset.action==='pwa-bell')pwaBell();}catch(err){toast(err.message);}});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();pwaInstallEvent=e;if(state.user)render();});
window.addEventListener('appinstalled',()=>{pwaInstallEvent=null;if(state.user)render();});
window.addEventListener('hashchange',pwaRoute);
window.addEventListener('offline',()=>{document.body.classList.add('offline');toast('Нет связи с интернетом. Показаны последние сохранённые данные; изменения сохранить не получится.');});
window.addEventListener('online',()=>{document.body.classList.remove('offline');toast('Связь восстановлена.');load().catch(()=>{});});
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').then(()=>pwaCheckPush().then(()=>{if(state.user)render();})).catch(()=>{});
setInterval(()=>{if(document.visibilityState==='visible'&&state.user&&!state.demo)pwaLoadNotifications().then(()=>{const b=$('.pwa-bell');if(b)b.outerHTML=pwaTopbar();});},120000);
