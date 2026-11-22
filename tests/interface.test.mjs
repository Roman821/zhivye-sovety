import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=['app.js','plan.js','efficiency.js','sovetnik.js'].map(f=>readFileSync(new URL('../public/'+f,import.meta.url),'utf8')).join('\n');
function app(){const nodes={};const context=vm.createContext({console,setTimeout,clearTimeout,URL,Intl,Date,fetch:()=>new Promise(()=>{}),window:{scrollTo(){}},document:{querySelector:s=>nodes[s]||(nodes[s]={innerHTML:'',textContent:'',classList:{add(){},remove(){}},showModal(){},close(){}}),addEventListener(){}}});vm.runInContext(source,context);return {run:code=>vm.runInContext(code,context),nodes};}
test('Поиск и сочетание фильтров работают независимо от вида списка',()=>{const a=app();a.run('state.items=demoItems;state.demo=true');assert.equal(a.run('filtered().length'),6);a.run("state.query='наставничества'");assert.equal(a.run('filtered()[0].title'),'Совет — Совету');a.run("state.query='';state.council='Ширинский район';state.status='progress'");assert.equal(a.run('filtered().length'),2);a.run("state.page='initiative'");assert.equal(a.run('filtered().length'),1);a.run("state.view='list';render()");assert.ok(a.nodes['#app'].innerHTML.includes('class="rows"'));});
test('Обзор разделяет личные задачи и общую работу Советов участника',()=>{
 const a=app();
 a.run(`
  state.demo=false;
  state.user={id:'u1',name:'Анна',council:'Основной Совет',scope:null};
  state.peopleData={people:[{id:'p1',user_id:'u1',memberships:[{council:'Второй Совет'}]}]};
  const workItem=(id,overrides={})=>({id,title:id,kind:'task',status:'new',council:'Основной Совет',...overrides});
  state.items=[
   workItem('assigned',{council:'Другой Совет',assignee_ids:['p1']}),
   workItem('addressed',{kind:'project',audience:'people',audience_ids:['p1'],deadline:'2099-01-01'}),
   workItem('both',{assignee_ids:['p1'],deadline:'2000-01-01'}),
   workItem('own-council'),
   workItem('second-council',{kind:'project',council:'Второй Совет'}),
   workItem('unrelated',{council:'Другой Совет'}),
   workItem('private-to-other',{audience:'people',audience_ids:['p2']}),
   workItem('completed',{status:'done'}),
   workItem('archived',{status:'archive'}),
   workItem('meeting',{kind:'vks'})
  ];
 `);
 const html=a.run('overviewWork()');
 const [personal,councils]=html.split('<h2 id="council-work">');
 const tileIds=panel=>[...panel.matchAll(/data-item="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(tileIds(personal),['both','addressed','assigned']);
 assert.deepEqual(tileIds(councils),['own-council','second-council']);
 assert.match(personal,/Просрочено/);
 assert.match(personal,/Вы ответственный/);
 assert.match(a.run("state.items=[];overviewWork()"),/Пока нет открытых задач и проектов/);
 assert.match(a.run("registry()"),/<section class="hero">[\s\S]*<div class="overview-work">[\s\S]*<section class="stats">/);
 assert.doesNotMatch(a.run("state.demo=true;registry()"),/id="personal-work"/);
});
test('Кнопка удаления Совета доступна только при полном доступе и открывает подтверждение',()=>{
 const a=app();
 a.run(`state.demo=false;state.user={role:'municipal_curator',manage_all:true,full_access:false};
  state.councils=['Совет <1>'];state.peopleData={directory:[{name:'Совет <1>'}]};`);
 assert.doesNotMatch(a.run('councils()'),/data-remove-council/);
 assert.match(a.run("state.user={role:'specialist',full_access:true};councils()"),/data-remove-council="Совет &lt;1&gt;"/);
 a.run("confirmCouncilRemoval(state.councils[0])");
 assert.match(a.nodes['#modal'].innerHTML,/Удалить Совет\?/);
 assert.match(a.nodes['#modal'].innerHTML,/name="name" value="Совет &lt;1&gt;"/);
});
test('Форма ВКС показывает состав и гостей из списка для посещаемости',()=>{
 const a=app();
 a.run(readFileSync(new URL('../public/council-features.js',import.meta.url),'utf8'));
 a.run(readFileSync(new URL('../public/people.js',import.meta.url),'utf8'));
 a.run(`state.user={council:'Региональный Совет'};state.peopleData={
  directory:[{name:'Региональный Совет',level:'regional'}],
  people:[{id:'secretary',name:'Секретарь',council:'Региональный Совет'}],
  meeting_people:[
   {id:'delegate',name:'Делегат',council:'Местный Совет',memberships:[{council:'Региональный Совет'}]},
   {id:'guest',name:'Гость',council:'Местный Совет'}
  ]
 };state.items=[];meetingCount=()=>{};meetingForm({format:'vks',attendance:[{person_id:'guest',status:'present'}]})`);
 const html=a.nodes['#modal'].innerHTML;
 assert.match(html,/<option value="guest" selected>Гость/);
 assert.match(html,/Делегат<small>Местный Совет<\/small><\/span><select data-attendee="delegate"/);
 assert.match(html,/data-attendee="guest"[^>]*>[\s\S]*?<option value="present" selected>/);
});
test('Просроченные записи не включают завершённые и архивные',()=>{const a=app();a.run("state.items=[{deadline:'2000-01-01',status:'progress',updated:'1'},{deadline:'2000-01-01',status:'done',updated:'1'},{deadline:'2000-01-01',status:'archive',updated:'1'}];state.status='overdue'");assert.equal(a.run('filtered().length'),1);});
test('Пользовательский текст экранируется в карточках и формах',()=>{const a=app();const html=a.run("card({...demoItems[0],title:'<img src=x onerror=alert(1)>',council:'<script>evil()</script>'})");assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;img'));assert.equal(a.run("esc('\" autofocus onfocus=evil()')"),'&quot; autofocus onfocus=evil()');});
test('Ознакомительный и пустой рабочий режимы различаются',()=>{const a=app();a.run('state.items=demoItems;render()');assert.ok(a.nodes['#app'].innerHTML.includes('Примеры данных'));a.run("state.demo=false;state.items=[];state.user={name:'Тест',role:'admin',council:'Совет'};render()");assert.ok(a.nodes['#app'].innerHTML.includes('Начните с первой идеи'));assert.ok(!a.nodes['#app'].innerHTML.includes('Примеры данных'));assert.ok(a.nodes['#app'].innerHTML.includes('Участники и доступ'));});

test('Показатели участника считают сроки и явные отметки посещаемости',()=>{const a=app();a.run(readFileSync(new URL('../public/council-features.js',import.meta.url),'utf8'));a.run(readFileSync(new URL('../public/people.js',import.meta.url),'utf8'));a.run("pfYear=2026;state.peopleData={items:[{id:'1',kind:'task',assignee_ids:['p'],deadline:'2026-10-31',created:'2026-01-01',status:'done',completed_at:'2026-10-31T15:00:00Z',completed_deadline:'2026-10-31'},{id:'2',kind:'project',assignee_ids:['p'],deadline:'2026-10-31',created:'2026-01-01',status:'done',completed_at:'2026-10-31T18:00:00Z',completed_deadline:'2026-10-31'},{id:'3',kind:'task',assignee_ids:['p'],deadline:'2026-01-01',created:'2026-01-01',status:'progress'},{id:'4',kind:'initiative',author_person_id:'p',assignee_ids:[],created:'2026-01-01',status:'new'}],meetings:['present','absent','excused','unknown'].map((status,n)=>({id:String(n),date:'2026-10-01',attendance:[{person_id:'p',status}]})),appearances:[{date:'2026-10-01',participant_ids:['p'],level:'regional'}]}");const stats=a.run("participantStats({id:'p'})");assert.equal(stats.tasks.length,3);assert.equal(stats.done.length,2);assert.equal(stats.datedDone.length,2);assert.equal(stats.onTime.length,1);assert.equal(stats.present.length,1);assert.equal(stats.absent.length,1);assert.equal(stats.excused.length,1);assert.equal(stats.authored.length,1);assert.equal(stats.events.length,1);assert.equal(stats.monthly[9][0],1);assert.equal(stats.monthly[10][0],1);});

test('Календарь отображает запланированные заседания и ВКС со временем',()=>{const a=app();a.run("state.calendarMonth='2026-11';state.items=[{id:'meeting',title:'Заседание Совета',kind:'meeting',deadline:'2026-11-15',start_time:'17:00',status:'new'},{id:'vks',title:'Созвон Советов',kind:'vks',deadline:'2026-11-15',start_time:'18:30',status:'new'}]");const html=a.run('calendar()');assert.ok(html.includes('17:00'));assert.ok(html.includes('18:30'));assert.ok(html.includes('Заседание: Заседание Совета'));assert.ok(html.includes('ВКС: Созвон Советов'));});
test('Календарь показывает подзадачи, просрочки и личные записи только в режиме «Мой»',()=>{const a=app();a.run("state.calendarMonth='2026-11';state.user={id:'u1',name:'Анна',council:'Шира',role:'member'};state.peopleData={people:[{id:'p1',user_id:'u1',name:'Анна',council:'Шира'}],directory:[]};state.personal=[{id:'e1',title:'Личная встреча',date:'2026-11-03',start_time:'',done:false}];state.items=[{id:'t1',title:'Форум',kind:'task',deadline:'2026-11-25',status:'progress',council:'Шира',assignee_ids:[],audience:'council',audience_ids:[],subtasks:[{id:'s1',title:'Площадка',deadline:'2026-11-02',assignee_ids:['p1'],done:false},{id:'s2',title:'Афиша',deadline:'2026-11-04',assignee_ids:['p9'],done:false}]}]");
 let html=a.run('calendar()');assert.ok(html.includes('Форум'));assert.ok(html.includes('↳ Площадка'));assert.ok(html.includes('↳ Афиша'));assert.ok(!html.includes('Личная встреча'));
 a.run("state.calendarMode='mine'");html=a.run('calendar()');assert.ok(html.includes('Личная встреча'));assert.ok(html.includes('↳ Площадка'));assert.ok(!html.includes('↳ Афиша'));assert.ok(!html.includes('>Форум<'));
 assert.ok(a.run("subtaskProgress(state.items[0])").includes('Подзадачи: 0 из 2'));});
test('Общая эффективность считает баллы, сроки, посещаемость и итоги Советов за период',()=>{const a=app();a.run(`state.demo=false;state.user={id:'u1',name:'Анна',council:'Шира',role:'admin'};
 state.peopleData={directory:[{name:'Шира',level:'local'},{name:'Школа',level:'primary'}],people:[{id:'p1',name:'Анна',council:'Шира',positions:[],memberships:[]},{id:'p2',name:'Борис',council:'Школа',positions:[],memberships:[]}],
 items:[{id:'t1',kind:'task',status:'done',assignee_ids:['p1'],deadline:'2026-03-10',created:'2026-03-01T00:00:00Z',completed_at:'2026-03-09T05:00:00Z',completed_deadline:'2026-03-10'},{id:'t2',kind:'task',status:'progress',assignee_ids:['p1'],deadline:'2026-03-15',created:'2026-03-01T00:00:00Z'},{id:'i1',kind:'initiative',status:'new',assignee_ids:[],author_person_id:'p2',created:'2026-07-02T00:00:00Z',deadline:''}],
 meetings:[{date:'2026-03-20',attendance:[{person_id:'p1',status:'present'},{person_id:'p2',status:'absent'}]},{date:'2026-04-20',attendance:[{person_id:'p1',status:'absent'}]}],appearances:[{date:'2026-03-25',participant_ids:['p2']}]};
 state.items=[{id:'t1',subtasks:[{id:'s1',title:'Шаг',deadline:'2026-03-05',assignee_ids:['p1'],done:true,done_at:'2026-03-06T05:00:00Z',created:'2026-03-01T00:00:00Z'}]},{id:'t2',subtasks:[]},{id:'i1',subtasks:[]}];efYear=2026;efPeriod='';`);
 const rows=a.run('efRows()'),anna=rows.find(r=>r.person.id==='p1'),boris=rows.find(r=>r.person.id==='p2');
 // Анна: задача 3 + подзадача 2 + заседание 2 − просрочка 2 = 5; вовремя 1 из (2 выполненных + 1 просрочка).
 assert.equal(anna.score,5);assert.equal(anna.completed,2);assert.equal(anna.overdue,1);assert.equal(anna.discipline,33);assert.equal(anna.attendance,50);assert.equal(JSON.stringify(anna.monthly[2]),'[2,1,0]');
 assert.equal(boris.score,5);assert.equal(boris.attendance,0);assert.equal(boris.events,1);assert.equal(boris.initiatives,1);
 a.run("efPeriod='q1'");const q1=a.run('efRows()').find(r=>r.person.id==='p2');assert.equal(q1.initiatives,0);assert.equal(q1.score,2);
 a.run("efPeriod='';efLevel='primary'");assert.equal(a.run('efRows().map(r=>r.person.name).join()'),'Борис');
 a.run("efLevel=''");const totals=a.run('efCouncilTotals(efRows())');assert.equal(totals.length,2);assert.equal(totals.find(t=>t.council==='Шира').attendance,50);
 a.run("state.page='efficiency'");const html=a.run('efficiencyPage()');assert.ok(html.includes('Рейтинг участников'));assert.ok(html.includes('Итоги по Советам'));});
test('Советник оформляет ссылки в любом виде и не пропускает HTML',()=>{const a=app();
 const answer='4 ноября, 18:00 — ВКС "Разработка плана на год" [/#item=048a07be-8012-4335-a7b2-31654e88e935]\n- [Календарь](/#page=calendar)\n- см. /#item=abc-1 и (/#page=reports)\n**важно** <img src=x onerror=alert(1)> [x](javascript:alert(1))';
 const html=a.run('svFormat('+JSON.stringify(answer)+')');
 assert.ok(html.includes('<a href="/#item=048a07be-8012-4335-a7b2-31654e88e935" data-sv-link>Открыть</a>'));assert.ok(!html.includes('[/#item'));
 assert.ok(html.includes('<a href="/#page=calendar" data-sv-link>Календарь</a>'));assert.ok(html.includes('<a href="/#item=abc-1" data-sv-link>Открыть</a>'));assert.ok(html.includes('<a href="/#page=reports" data-sv-link>Открыть раздел</a>'));
 assert.ok(html.includes('<strong>важно</strong>'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('href="javascript'));assert.equal((html.match(/<a /g)||[]).length,4);});

test('Вопрос/ответ экранирует текст и показывает действия по правам',()=>{const a=app();a.run(readFileSync(new URL('../public/qa.js',import.meta.url),'utf8'));a.run("qaData={can_answer:true}");const html=a.run("qaCard({id:'q1',question:'<img src=x onerror=alert(1)>',author_name:'<script>evil()</script>',council:'Совет',created:'2026-11-08T05:00:00Z',answer:'Ответ <b>без HTML</b>',answer_author_name:'Координатор',answered_at:'2026-11-08T06:00:00Z',answered:true,can_delete:true})");assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<b>без HTML</b>'));assert.ok(html.includes('&lt;img'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('Изменить ответ'));assert.ok(html.includes('Удалить'));});

test('Личный кабинет показывает данные и портфолио, экранирует HTML и не дублирует загрузку в общей форме',()=>{const a=app();a.run(readFileSync(new URL('../public/council-features.js',import.meta.url),'utf8'));a.run(readFileSync(new URL('../public/people.js',import.meta.url),'utf8'));a.run(readFileSync(new URL('../public/account.js',import.meta.url),'utf8'));a.run(`state.demo=false;state.user={id:'u1',name:'Анна',email:'anna@example.test',council:'Совет',role:'member'};state.peopleData={people:[{id:'p1',user_id:'u1',name:'<script>evil()</script>',council:'Совет',positions:['Участник'],memberships:[],birth_year:2008,education:'school',institution:'Школа',study_year:'11 класс',phone:'',vk:'',bio:'<img src=x onerror=alert(1)>',has_photo:true,has_portfolio:true,portfolio_name:'Достижения.pdf',portfolio_type:'application/pdf',portfolio_size:1024,updated:'2026-11-08T00:00:00Z'}],items:[],meetings:[],appearances:[]};pfYear=2026;`);
 const html=a.run('accountPage()');assert.ok(html.includes('Личный кабинет'));assert.ok(html.includes('anna@example.test'));assert.ok(html.includes('Моё портфолио'));assert.ok(html.includes('Достижения.pdf'));assert.ok(html.includes('/portfolio?view=1'));assert.ok(html.includes('Изменить почту'));assert.ok(html.includes('Изменить пароль'));assert.ok(html.includes('class="account-photo-download"'));assert.ok(html.includes('/api/people/p1/photo?download=1'));assert.ok(html.includes('aria-label="Скачать свою фотографию"'));assert.ok(!html.includes('<script>evil'));assert.ok(!html.includes('<img src=x'));assert.ok(html.includes('&lt;script&gt;'));
 assert.ok(!a.run('profileFields({})').includes('portfolio_file'));});

test('Личный кабинет открывается через нижний профиль без отдельного пункта меню',()=>{const a=app();a.run("state.demo=false;state.user={id:'u1',name:'Анна',email:'anna@example.test',council:'Совет',role:'member'};state.peopleData={people:[],directory:[],items:[],meetings:[],appearances:[]};render()");const html=a.nodes['#app'].innerHTML,navigation=html.match(/<nav>([\s\S]*?)<\/nav>/)?.[1]||'';assert.ok(!navigation.includes('data-page="account"'));assert.ok(html.includes('class="profile-account '));assert.ok(html.includes('data-page="account"'));assert.ok(html.includes('aria-label="Открыть личный кабинет"'));assert.ok(html.includes('data-action="logout"'));});

test('Новая карточка сохраняет выбранный Совет и предлагает должность участника',()=>{const a=app();a.run(readFileSync(new URL('../public/council-features.js',import.meta.url),'utf8'));a.run(readFileSync(new URL('../public/people.js',import.meta.url),'utf8'));a.run(`state.demo=false;state.user={id:'admin',name:'Координатор',council:'Региональный Совет Первых',role:'admin',manage_all:true,manage_scope:null,permissions:[]};state.peopleData={people:[],directory:[{name:'Региональный Совет Первых',level:'regional'},{name:'Совет Первых г. Черногорска',level:'local'}]};councilData={names:['Региональный Совет Первых','Совет Первых г. Черногорска'],directory:state.peopleData.directory,roster:[]};cfPerson('',true,'Совет Первых г. Черногорска');`);
 const html=a.nodes['#modal'].innerHTML;assert.ok(html.includes('value="Совет Первых г. Черногорска" selected'));assert.ok(html.includes('value="Участник" checked'));assert.ok(html.includes('Оригинал сохраняется без уменьшения'));
 a.run("membershipForm('', 'Совет Первых г. Черногорска')");assert.ok(a.nodes['#modal'].innerHTML.includes('value="Совет Первых г. Черногорска" selected'));
 a.run("state.page='roster';renderCouncilFeatures()");assert.ok(a.nodes['#council-features'].innerHTML.includes('data-council="Совет Первых г. Черногорска"'));
});

test('Кнопка добавления в Совете не переключает страницу на общий обзор',async()=>{
 let click;const context=vm.createContext({console,setTimeout,clearTimeout,URL,Intl,Date,fetch:()=>new Promise(()=>{}),window:{scrollTo(){}},document:{addEventListener(type,handler){if(type==='click')click=handler;}}});
 vm.runInContext(readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),context);
 vm.runInContext("state.page='roster';state.council=''",context);
 await click({target:{closest:()=>({dataset:{council:'Совет Первых г. Черногорска',cf:'person'}})}});
 assert.equal(vm.runInContext('state.page',context),'roster');
});
