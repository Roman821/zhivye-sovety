// Временная рубрика для вопросов участников во время тестирования платформы.
let qaData=null;
const qaDate=value=>new Date(value).toLocaleString('ru-RU',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});
async function loadQa(){
 const el=$('#qa');if(!el)return;
 if(state.demo){el.innerHTML=heading('ТЕСТИРОВАНИЕ ПЛАТФОРМЫ','Вопрос/ответ','Войдите, чтобы задать вопрос и посмотреть ответы.',btn('Войти','auth','primary'));return;}
 try{qaData=await api('/qa');if($('#qa'))$('#qa').innerHTML=qaPage();}catch(e){el.innerHTML=`<section class="panel">${esc(e.message)} <button class="button" data-qa="refresh">Повторить</button></section>`;}
}
function qaCard(q){
 return `<article class="qa-card ${q.answered?'answered':''}"><div class="qa-card-top"><span class="badge ${q.answered?'done':'discussion'}"><i></i>${q.answered?'Отвечен':'Ждёт ответа'}</span><time>${qaDate(q.created)}</time></div><p class="qa-question">${esc(q.question)}</p><div class="qa-author"><strong>${esc(q.author_name)}</strong><span>${esc(q.council)}</span></div>${q.answered?`<div class="qa-answer"><div class="eyebrow">ОТВЕТ</div><p>${esc(q.answer)}</p><small>${esc(q.answer_author_name)} · ${qaDate(q.answered_at)}</small></div>`:''}<div class="cf-actions">${qaData.can_answer?`<button class="button" data-qa="answer" data-id="${esc(q.id)}">${q.answered?'Изменить ответ':'Ответить'}</button>`:''}${q.can_delete?`<button class="button qa-delete" data-qa="remove" data-id="${esc(q.id)}">Удалить</button>`:''}</div></article>`;
}
function qaPage(){
 const questions=qaData?.questions||[],open=questions.filter(q=>!q.answered).length;
 return heading('ВРЕМЕННАЯ РУБРИКА · ТЕСТИРОВАНИЕ','Вопрос/ответ','Задавайте вопросы о работе платформы. Отвечают координатор и специалист.',btn('Задать вопрос','qa-new','primary','plus'))+`<div class="qa-notice">${icon('help')}<p><strong>Помогаем разобраться в платформе.</strong><br>Здесь можно спросить о разделах, записях, отчётах и правах доступа. Вопросы и ответы видны всем зарегистрированным участникам.</p><span>${open?`Ждут ответа: ${open}`:'Нет вопросов без ответа'}</span></div>${questions.length?`<div class="qa-list">${questions.map(qaCard).join('')}</div>`:`<section class="panel empty">${icon('help')}<h3>Вопросов пока нет</h3><p>Станьте первым, кто задаст вопрос о платформе.</p>${btn('Задать вопрос','qa-new','primary','plus')}</section>`}`;
}
function qaQuestionForm(){modal(`<div class="eyebrow">ВОПРОС / ОТВЕТ</div><h2>Задать вопрос</h2><p class="muted">Опишите, что хотели сделать и где возникла сложность.</p><form id="qa-question-form"><label>Ваш вопрос<textarea name="question" required maxlength="5000" rows="6" placeholder="Например: как добавить мероприятие в годовой отчёт?"></textarea></label><div class="form-error" role="alert"></div><div class="form-actions">${btn('Отмена','close')}<button class="button primary" type="submit">Опубликовать вопрос</button></div></form>`);}
function qaAnswerForm(id){const q=qaData.questions.find(q=>q.id===id);if(!q)return;modal(`<div class="eyebrow">ОТВЕТ НА ВОПРОС</div><h2>${esc(q.author_name)}</h2><p class="qa-modal-question">${esc(q.question)}</p><form id="qa-answer-form" data-id="${esc(q.id)}"><label>Ответ<textarea name="answer" required maxlength="8000" rows="7" placeholder="Напишите понятную инструкцию или объяснение">${esc(q.answer)}</textarea></label><div class="form-error" role="alert"></div><div class="form-actions">${btn('Отмена','close')}<button class="button primary" type="submit">Сохранить ответ</button></div></form>`);}
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-qa],[data-action="qa-new"]');if(!b)return;
 try{
  if(b.dataset.qa==='refresh')return loadQa();
  if(b.dataset.action==='qa-new')return qaQuestionForm();
  if(b.dataset.qa==='answer')return qaAnswerForm(b.dataset.id);
  if(b.dataset.qa==='remove'){if(!confirm('Удалить вопрос вместе с ответом?'))return;await api('/qa/'+b.dataset.id,'DELETE',{});await loadQa();toast('Вопрос удалён.');}
 }catch(err){toast(err.message);}
});
document.addEventListener('submit',async e=>{
 const f=e.target;if(!['qa-question-form','qa-answer-form'].includes(f.id))return;e.preventDefault();const submit=f.querySelector('[type=submit]'),error=f.querySelector('.form-error');submit.disabled=true;error.textContent='';
 try{const data=Object.fromEntries(new FormData(f));if(f.id==='qa-question-form')await api('/qa','POST',data);else await api('/qa/'+f.dataset.id,'PUT',data);closeModal();await loadQa();toast(f.id==='qa-question-form'?'Вопрос опубликован.':'Ответ сохранён.');}catch(err){error.textContent=err.message;}finally{submit.disabled=false;}
});
