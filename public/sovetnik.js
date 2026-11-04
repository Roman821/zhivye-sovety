// «Советник» — окно ИИ-помощника. История разговора хранится только в открытой вкладке.
let svHistory=[],svOpen=false,svBusy=false,svUsage=null;
const svSuggestions=['Что у меня на этой неделе?','Какие задачи просрочены?','Как добавить подзадачу?','Как запросить отчёт у Советов?'];
// Безопасное оформление ответа: сначала экранирование, затем только жирный текст, списки и внутренние ссылки.
// Модель не всегда пишет ссылки как [название](/#item=ID): внутренние адреса в любом виде превращаются в ссылку «Открыть».
const svLinkName=href=>href.startsWith('/#page=')?'Открыть раздел':'Открыть';
const svLink=(href,text)=>`<a href="${href}" data-sv-link>${text}</a>`;
function svFormat(text){
 return esc(text).replace(/\[([^\]]{1,200})\]\(\s*(\/#(?:item|page)=[\w-]+)\s*\)/g,(_,t,href)=>svLink(href,/^\s*\/#/.test(t)?svLinkName(href):t))
  .replace(/[\[(]\s*(\/#(?:item|page)=[\w-]+)\s*[\])]/g,(_,href)=>svLink(href,svLinkName(href)))
  .replace(/(?<!href=")(\/#(?:item|page)=[\w-]+)/g,(_,href)=>svLink(href,svLinkName(href)))
  .replace(/\*\*([^*]{1,300})\*\*/g,'<strong>$1</strong>')
  .split(/\n/).map(line=>/^\s*[-•*]\s+/.test(line)?`<li>${line.replace(/^\s*[-•*]\s+/,'')}</li>`:/^\s*\d+[.)]\s+/.test(line)?`<li class="num">${line.replace(/^\s*\d+[.)]\s+/,'')}</li>`:line?`<p>${line}</p>`:'').join('').replace(/(<li(?: class="num")?>.*?<\/li>)+/g,m=>`<ul>${m}</ul>`);
}
function svMessages(){return svHistory.length?svHistory.map(m=>`<div class="sv-msg ${m.role}">${m.role==='user'?esc(m.content):svFormat(m.content)}</div>`).join('')+(svBusy?'<div class="sv-msg assistant sv-typing" aria-label="Советник думает"><span></span><span></span><span></span></div>':''):`<div class="sv-hello"><strong>Здравствуйте! Я Советник.</strong><p>Подскажу, как пользоваться платформой, и найду задачи, сроки, заседания, отчёты и материалы — в пределах ваших прав доступа.</p><div class="sv-chips">${svSuggestions.map(s=>`<button type="button" data-sv-ask="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`;}
function svRender(){
 let root=$('#sovetnik');if(!state.sovetnikOn||state.demo||!state.user){root?.remove?.();return;}
 if(!root){root=document.createElement('div');root.id='sovetnik';document.body.append(root);}
 root.innerHTML=svOpen?`<section class="sv-panel" role="dialog" aria-label="Советник"><header><span class="sv-avatar">${icon('bulb')}</span><div><strong>Советник</strong><small>ИИ-помощник · ответы стоит проверять</small></div><button type="button" class="icon-button" data-sv-close aria-label="Закрыть">${icon('close')}</button></header><div class="sv-body" aria-live="polite">${svMessages()}</div><form id="sv-form"><textarea name="q" rows="2" maxlength="1500" placeholder="Спросите о платформе, задачах или сроках" ${svBusy?'disabled':''}></textarea><button class="button primary" type="submit" ${svBusy?'disabled':''} aria-label="Отправить">${icon('arrow')}</button></form><footer>${svUsage?`Вопросов сегодня: ${svUsage.used} из ${svUsage.limit} · `:''}<button type="button" class="text-button" data-sv-clear>Новый разговор</button></footer></section>`:`<button type="button" class="sv-launcher" data-sv-open aria-label="Открыть Советника">${icon('bulb')}<span>Советник</span></button>`;
 const body=root.querySelector('.sv-body');if(body)body.scrollTop=body.scrollHeight;
}
async function svAsk(q){
 q=q.trim();if(!q||svBusy)return;svHistory.push({role:'user',content:q});svBusy=true;svRender();
 try{const d=await api('/sovetnik','POST',{messages:svHistory.slice(-8)});svHistory.push({role:'assistant',content:d.answer});svUsage={used:d.used,limit:d.limit};}
 catch(err){svHistory.push({role:'assistant',content:err.message});}
 finally{svBusy=false;svRender();$('#sv-form textarea')?.focus();}
}
document.addEventListener('click',e=>{const t=e.target.closest('[data-sv-open],[data-sv-close],[data-sv-ask],[data-sv-clear],[data-sv-link]');if(!t)return;
 if(t.hasAttribute('data-sv-open')){svOpen=true;svRender();$('#sv-form textarea')?.focus();if(!svUsage)api('/sovetnik').then(d=>{svUsage={used:d.used,limit:d.limit};if(svOpen&&!svBusy)svRender();}).catch(()=>{});}
 if(t.hasAttribute('data-sv-close')){svOpen=false;svRender();}
 if(t.dataset.svAsk)svAsk(t.dataset.svAsk);
 if(t.hasAttribute('data-sv-clear')){svHistory=[];svRender();}
 if(t.hasAttribute('data-sv-link')&&matchMedia('(max-width: 700px)').matches){svOpen=false;svRender();}
});
document.addEventListener('submit',e=>{if(e.target.id!=='sv-form')return;e.preventDefault();svAsk(e.target.elements.q.value);});
document.addEventListener('keydown',e=>{if(e.target.matches?.('#sv-form textarea')&&e.key==='Enter'&&!e.shiftKey){e.preventDefault();svAsk(e.target.value);}if(e.key==='Escape'&&svOpen&&!$('#modal')?.open){svOpen=false;svRender();}});
