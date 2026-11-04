// Выбор Совета из списка с поиском — по аналогии с выбором участников.
// select[data-council-picker]; data-allow-new разрешает ввести название нового Совета.
(function(){let sequence=0;
 const key=v=>String(v||'').normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').trim().replace(/\s+/gu,' ');
 function enhance(select){if(select.dataset.councilPickerReady)return;select.dataset.councilPickerReady='1';const allowNew=select.hasAttribute('data-allow-new'),uid='council-picker-'+(++sequence),label=select.closest('label'),root=document.createElement('div');root.className='person-picker council-picker';
  root.innerHTML=`<div class="person-picker-input-row"><input id="${uid}" type="text" role="combobox" aria-label="Совет" aria-autocomplete="list" aria-controls="${uid}-list" aria-expanded="false" placeholder="Начните вводить название Совета" autocomplete="off" spellcheck="false"><button type="button" class="person-picker-toggle" aria-label="Показать список Советов" title="Показать Советы">⌄</button></div><div class="person-picker-menu" hidden><div id="${uid}-list" role="listbox" aria-label="Советы"></div><div class="person-picker-note" role="status" aria-live="polite"></div></div>`;
  select.insertAdjacentElement('afterend',root);select.classList.add('person-picker-native');select.required=false;if(label)label.htmlFor=uid;
  const input=root.querySelector('input'),menu=root.querySelector('.person-picker-menu'),list=root.querySelector('[role=listbox]'),note=root.querySelector('.person-picker-note');let found=[],active=-1;
  const rows=()=>[...select.options].filter(o=>o.value).map(o=>({value:o.value,level:o.dataset.level||''}));
  function sync(){input.value=select.value;validity();}
  function validity(){const typed=input.value.trim();input.setCustomValidity(!typed?'Выберите Совет из списка.':select.value===typed?'':allowNew?'Выберите Совет из списка или подтвердите новый.':'Выберите Совет из списка.');}
  function close(){menu.hidden=true;input.setAttribute('aria-expanded','false');active=-1;}
  function render(showAll){const words=key(showAll?'':input.value).split(' ').filter(Boolean),typed=input.value.trim();found=rows().filter(r=>words.every(w=>key(r.value).includes(w)));const exact=rows().some(r=>key(r.value)===key(typed));
   list.innerHTML=found.slice(0,50).map((r,i)=>`<button type="button" role="option" id="${uid}-o${i}" data-council-choice="${i}" aria-selected="${r.value===select.value}" tabindex="-1"><strong>${esc(r.value)}</strong>${r.level?`<span>${esc(r.level)}</span>`:''}</button>`).join('')+(allowNew&&typed&&!exact?`<button type="button" role="option" data-council-new tabindex="-1"><strong>Новый Совет: ${esc(typed)}</strong><span>Будет создан при сохранении</span></button>`:'');
   note.textContent=found.length?'Найдено: '+found.length:allowNew?'Такого Совета нет — можно создать новый.':'Совпадений нет.';menu.hidden=false;input.setAttribute('aria-expanded','true');active=-1;}
  function choose(value){if(![...select.options].some(o=>o.value===value))select.add(new Option(value,value));select.value=value;sync();close();select.dispatchEvent(new Event('change',{bubbles:true}));}
  root.addEventListener('mousedown',e=>{if(e.target.closest('[role=option]'))e.preventDefault();});
  root.addEventListener('click',e=>{const c=e.target.closest('[data-council-choice]');if(c)return choose(found[Number(c.dataset.councilChoice)].value);if(e.target.closest('[data-council-new]'))return choose(input.value.trim());if(e.target.closest('.person-picker-toggle')){input.focus();render(true);}});
  input.addEventListener('focus',()=>{input.select();render(true);});
  input.addEventListener('input',()=>{select.value='';validity();render();});
  input.addEventListener('keydown',e=>{const options=[...list.querySelectorAll('[role=option]')];if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(menu.hidden)render();if(options.length){active=(active+(e.key==='ArrowDown'?1:-1)+options.length)%options.length;options.forEach((o,i)=>o.classList.toggle('is-active',i===active));options[active].scrollIntoView({block:'nearest'});}}else if(e.key==='Enter'&&!menu.hidden){e.preventDefault();const o=options[active>=0?active:0];if(o)o.click();}else if(e.key==='Escape'&&!menu.hidden){e.preventDefault();e.stopPropagation();close();}});
  root.addEventListener('focusout',e=>{if(!root.contains(e.relatedTarget))close();});
  input.disabled=select.disabled;sync();
 }
 function scan(node){if(node.nodeType!==1)return;if(node.matches('select[data-council-picker]'))enhance(node);for(const s of node.querySelectorAll('select[data-council-picker]'))enhance(s);}
 function init(){scan(document.body);new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)scan(n);}).observe(document.body,{childList:true,subtree:true});}
 if(document.readyState==='complete')init();else document.addEventListener('DOMContentLoaded',init);
})();
