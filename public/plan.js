// План работы: подзадачи, «Для кого», личный календарь.
const myPersonId=()=>state.peopleData?.people.find(p=>p.user_id===state.user?.id)?.id;
const personName=id=>state.peopleData?.people.find(p=>p.id===id)?.name||'Участник';
const subtaskOverdue=s=>!s.done&&s.deadline&&s.deadline<today();
function subtaskProgress(i){const list=i.subtasks||[];if(!list.length)return '';const done=list.filter(s=>s.done).length,late=list.filter(subtaskOverdue).length;return `<div class="subtask-summary"><progress max="${list.length}" value="${done}" aria-label="Выполнено подзадач"></progress><small>Подзадачи: ${done} из ${list.length}${late?` · <b class="overdue">просрочено ${late}</b>`:''}</small></div>`;}
function audienceText(i){return i.audience==='people'&&i.audience_ids?.length?i.audience_ids.map(personName).join(', '):'Весь Совет';}
function subtaskForm(itemId,s={}){return `<form id="subtask-form" data-item-id="${esc(itemId)}" data-subtask-id="${esc(s.id||'')}"><div class="form-row"><label>${s.id?'Изменить подзадачу':'Новая подзадача'}<input name="title" required maxlength="200" value="${esc(s.title)}" placeholder="Например, согласовать площадку"></label><label>Внутренний срок<input name="deadline" type="date" value="${esc(s.deadline)}"></label></div><label>Ответственные<select data-person-picker name="assignee_ids" multiple>${personOptions(s.assignee_ids||[])}</select></label><div class="form-error" role="alert"></div><div class="form-actions">${s.id?'<button type="button" class="button" data-subtask-cancel>Отмена</button>':''}<button class="button primary" type="submit">${s.id?'Сохранить подзадачу':'Добавить подзадачу'}</button></div></form>`;}
function subtaskSection(i,editor){
 if(state.demo)return '';const me=myPersonId(),list=i.subtasks||[],done=list.filter(s=>s.done).length;
 const rows=list.map(s=>`<li class="subtask ${s.done?'done':''} ${subtaskOverdue(s)?'overdue':''}"><label class="cf-check"><input type="checkbox" data-subtask-toggle="${esc(s.id)}" ${s.done?'checked':''} ${editor||s.assignee_ids.includes(me)?'':'disabled'}><span>${esc(s.title)}</span></label><small>${s.deadline?(subtaskOverdue(s)?'Просрочено: ':'Срок: ')+date(s.deadline):'Без срока'}${s.assignee_ids.length?' · '+esc(s.assignee_ids.map(personName).join(', ')):''}</small>${editor?`<span class="subtask-actions"><button type="button" class="text-button" data-subtask-edit="${esc(s.id)}">Изменить</button><button type="button" class="text-button" data-subtask-remove="${esc(s.id)}">Удалить</button></span>`:''}</li>`).join('');
 return `<section class="detail-block subtasks"><h3>Подзадачи ${list.length?`<span>${done} из ${list.length}</span>`:''}</h3>${list.length?`<progress max="${list.length}" value="${done}" aria-label="Выполнено подзадач"></progress><ul class="subtask-list">${rows}</ul>`:'<p class="muted">Разбейте задачу на шаги со своими сроками и ответственными.</p>'}${editor?`<div id="subtask-form-wrap">${subtaskForm(i.id)}</div>`:''}</section>`;
}
async function refreshDetail(itemId){await load();await detail(itemId);}
function personalForm(e={}){modal(`<div class="eyebrow">МОЙ КАЛЕНДАРЬ</div><h2>${e.id?'Личная запись':'Новая личная запись'}</h2><p class="muted">Личные записи видите только вы.</p><form id="personal-form" data-id="${esc(e.id||'')}"><label>Что запланировано<input name="title" required maxlength="200" value="${esc(e.title)}"></label><div class="form-row"><label>Дата<input name="date" type="date" required value="${esc(e.date||state.calendarMonth+'-'+String(new Date().getDate()).padStart(2,'0'))}"></label><label>Время<input name="start_time" type="time" value="${esc(e.start_time)}"></label></div><label>Заметка<textarea name="note" rows="3" maxlength="3000">${esc(e.note)}</textarea></label>${e.id?`<label class="cf-check"><input type="checkbox" name="done" ${e.done?'checked':''}>Выполнено</label>`:''}<div class="form-error" role="alert"></div><div class="form-actions">${e.id?'<button type="button" class="button" data-personal-remove="'+esc(e.id)+'">Удалить</button>':''}<button class="button primary" type="submit">Сохранить</button></div></form>`);}
function calendarEntries(){
 const month=state.calendarMonth,me=myPersonId(),mine=state.calendarMode==='mine',out=[];
 for(const i of state.items){if(i.status==='archive')continue;
  const forMe=!!me&&((i.assignee_ids||[]).includes(me)||(i.audience==='people'&&(i.audience_ids||[]).includes(me))||(i.audience!=='people'&&['meeting','vks'].includes(i.kind)&&i.council===state.user?.council));
  if(i.deadline?.startsWith(month)&&(!mine||forMe))out.push({date:i.deadline,cls:i.kind,label:(i.start_time?i.start_time+' · ':'')+(['meeting','vks'].includes(i.kind)?types[i.kind]+': ':'')+i.title,item:i.id,overdue:overdue(i),done:i.status==='done'});
  for(const s of i.subtasks||[])if(s.deadline?.startsWith(month)&&(!mine||s.assignee_ids.includes(me)))out.push({date:s.deadline,cls:'subtask',label:'↳ '+s.title+' · '+i.title,item:i.id,overdue:subtaskOverdue(s),done:s.done});
 }
 if(mine)for(const e of state.personal||[])if(e.date.startsWith(month))out.push({date:e.date,cls:'personal',label:(e.start_time?e.start_time+' · ':'')+e.title,personal:e.id,overdue:!e.done&&e.date<today(),done:e.done});
 return out;
}
function calendar(){
 const parts=state.calendarMonth.split('-').map(Number),start=new Date(parts[0],parts[1]-1,1),days=new Date(parts[0],parts[1],0).getDate(),offset=(start.getDay()+6)%7,entries=calendarEntries(),mine=state.calendarMode==='mine';
 const chip=e=>`<button type="button" ${e.item?`data-item="${esc(e.item)}"`:`data-personal="${esc(e.personal)}"`} class="calendar-event ${e.cls} ${e.overdue?'overdue':''} ${e.done?'done':''}">${esc(e.label)}</button>`;
 return heading('НЕ УПУСТИТЬ ВАЖНОЕ','Сроки и календарь',mine?'Ваши задачи, подзадачи, встречи Совета и личные записи.':'Задачи, подзадачи, заседания и ВКС Советов.')+`<section class="panel"><div class="section-title"><div class="view-switch calendar-mode" aria-label="Какой календарь показать"><button type="button" class="${mine?'':'selected'}" data-calendar-mode="all">Общий</button><button type="button" class="${mine?'selected':''}" data-calendar-mode="mine">Мой</button></div><h2>${start.toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}</h2><label>Месяц <input type="month" id="calendar-month" value="${state.calendarMonth}"></label>${mine&&!state.demo?btn('Личная запись','personal-new','primary','plus'):''}</div><div class="calendar-grid">${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d=>`<div class="week-day">${d}</div>`).join('')}${'<div class="calendar-day blank"></div>'.repeat(offset)}${Array.from({length:days},(_,j)=>{const d=`${state.calendarMonth}-${String(j+1).padStart(2,'0')}`;return `<div class="calendar-day ${d===today()?'today':''}"><strong>${j+1}</strong>${entries.filter(e=>e.date===d).map(chip).join('')}</div>`;}).join('')}</div>${entries.length?'<p class="calendar-legend"><span class="calendar-event subtask">↳ подзадача</span>'+(mine?'<span class="calendar-event personal">личная запись</span>':'')+'<span class="calendar-event overdue">просрочено</span></p>':`<p class="muted">${mine?'На этот месяц у вас пока нет задач и личных записей.':'На этот месяц сроки пока не назначены.'}</p>`}</section>`;
}
document.addEventListener('click',async e=>{
 const t=e.target.closest('[data-calendar-mode],[data-personal],[data-personal-remove],[data-subtask-edit],[data-subtask-remove],[data-subtask-cancel],[data-action="personal-new"]');if(!t)return;
 try{
  if(t.dataset.calendarMode){state.calendarMode=t.dataset.calendarMode;render();return;}
  if(t.dataset.action==='personal-new')return personalForm();
  if(t.dataset.personal)return personalForm((state.personal||[]).find(x=>x.id===t.dataset.personal));
  if(t.dataset.personalRemove){if(!confirm('Удалить личную запись?'))return;await api('/personal/'+t.dataset.personalRemove+'/remove','POST',{});state.personal=(await api('/personal')).entries;closeModal();render();toast('Личная запись удалена.');return;}
  const item=currentItem;if(!item)return;
  if(t.dataset.subtaskEdit){$('#subtask-form-wrap').innerHTML=subtaskForm(item.id,item.subtasks.find(s=>s.id===t.dataset.subtaskEdit));$('#subtask-form-wrap input[name=title]').focus();return;}
  if(t.hasAttribute('data-subtask-cancel')){$('#subtask-form-wrap').innerHTML=subtaskForm(item.id);return;}
  if(t.dataset.subtaskRemove){if(!confirm('Удалить подзадачу?'))return;await api('/subtasks/'+t.dataset.subtaskRemove+'/remove','POST',{});await refreshDetail(item.id);toast('Подзадача удалена.');}
 }catch(err){toast(err.message);}
});
document.addEventListener('change',async e=>{const box=e.target.closest('[data-subtask-toggle]');if(!box||!currentItem)return;box.disabled=true;try{await api('/subtasks/'+box.dataset.subtaskToggle,'PUT',{done:box.checked});await refreshDetail(currentItem.id);}catch(err){box.checked=!box.checked;box.disabled=false;toast(err.message);}});
document.addEventListener('submit',async e=>{
 const f=e.target;if(!['subtask-form','personal-form'].includes(f.id))return;e.preventDefault();const error=f.querySelector('.form-error');
 try{
  if(f.id==='subtask-form'){const data={title:f.elements.title.value,deadline:f.elements.deadline.value,assignee_ids:new FormData(f).getAll('assignee_ids')},id=f.dataset.subtaskId;await api(id?'/subtasks/'+id:'/items/'+f.dataset.itemId+'/subtasks',id?'PUT':'POST',data);await refreshDetail(f.dataset.itemId);toast(id?'Подзадача сохранена.':'Подзадача добавлена.');}
  if(f.id==='personal-form'){const data={title:f.elements.title.value,date:f.elements.date.value,start_time:f.elements.start_time.value,note:f.elements.note.value,done:!!f.elements.done?.checked},id=f.dataset.id;await api('/personal'+(id?'/'+id:''),id?'PUT':'POST',data);state.personal=(await api('/personal')).entries;closeModal();state.calendarMode='mine';render();toast('Личная запись сохранена.');}
 }catch(err){if(error)error.textContent=err.message;else toast(err.message);}
});
