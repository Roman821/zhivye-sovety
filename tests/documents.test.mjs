import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function app(){
 const nodes={};
 const context=vm.createContext({console,setTimeout,clearTimeout,URL,Intl,Date,Blob,Uint8Array,fetch:()=>new Promise(()=>{}),localStorage:{getItem:()=>null,setItem(){},removeItem(){}},window:{scrollTo(){}},document:{querySelector:s=>nodes[s]||(nodes[s]={innerHTML:'',textContent:'',classList:{add(){},remove(){}},showModal(){},close(){}}),addEventListener(){}}});
 vm.runInContext(readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),context);
 vm.runInContext(readFileSync(new URL('../public/documents.js',import.meta.url),'utf8'),context);
 return {run:code=>vm.runInContext(code,context),nodes};
}

test('Конструктор содержит семь документов и строит предпросмотр каждой формы',()=>{
 const a=app();assert.equal(a.run('Object.keys(docTemplates).length'),7);
 for(const type of a.run('Object.keys(docTemplates)')){a.run(`docType=${JSON.stringify(type)};docData=docDefaults(docType)`);assert.ok(a.run('docModel(docType,docData).length')>0);assert.ok(a.run('documentsPage()').includes('doc-paper'));}
});

test('Кворум требует более половины, а суммы открытого голосования сверяются',()=>{
 const a=app();a.run(`docData={...docDefaults('general'),number:'1',organization:'Школа',location:'Шира',total:10,present:6,attendees:'Иванов Иван Иванович',speakerChair:'Петров Пётр Петрович',meetingChair:'Сидоров Сидор Сидорович',speakerSecretary:'Петров Пётр Петрович',meetingSecretary:'Иванова Анна Сергеевна',speakerCouncil:'Петров Пётр Петрович',councilMembers:'Иванов И. И.'};for(const p of ['chair','secretary','council'])Object.assign(docData,{[p+'For']:6,[p+'Against']:0,[p+'Abstain']:0});`);
 assert.deepEqual(Array.from(a.run('docChecks("general",docData).errors')),[]);assert.ok(a.run('docModel("general",docData).map(b=>b.text||"").join(" ")').includes('Кворум имеется'));
 a.run('docData.present=5');assert.ok(a.run('docChecks("general",docData).errors').some(x=>x.includes('Нет кворума')));
 a.run('docData.present=6;docData.chairFor=5');assert.ok(a.run('docChecks("general",docData).errors').some(x=>x.includes('сумма')));
});

test('Тайное голосование определяет большинство и не выбирает при равенстве',()=>{
 const a=app();a.run(`docData={...docDefaults('first'),total:9,present:5,elections:[{position:'chair',speaker:'Иванов И. И.',abstain:0,candidates:[{name:'Петров П. П.',votes:4},{name:'Сидорова А. А.',votes:1}]}]}`);
 assert.deepEqual(Array.from(a.run('docChecks("first",docData).errors').filter(x=>!x.startsWith('Заполните'))),[]);assert.ok(a.run('docModel("first",docData).map(b=>b.text||"").join(" ")').includes('Избрать Председатель — Петров П. П.'));
 a.run('docData.elections[0].candidates=[{name:"Петров П. П.",votes:2},{name:"Сидорова А. А.",votes:2},{name:"Козлов К. К.",votes:1}]');assert.ok(a.run('docModel("first",docData).map(b=>b.text||"").join(" ")').includes('кандидат не избран'));
});

test('Протокол комиссии проверяет движение и действительность бюллетеней',()=>{
 const a=app();a.run(`docData={...docDefaults('commission'),electorate:10,received:10,issued:6,cancelled:1,inBox:5,invalid:0,valid:5,abstain:1,candidates:[{name:'Петров П. П.',votes:3},{name:'Сидорова А. А.',votes:1}]}`);
 assert.deepEqual(Array.from(a.run('docChecks("commission",docData).errors').filter(x=>!x.startsWith('Заполните'))),[]);
 a.run('docData.valid=4');assert.equal(a.run('docChecks("commission",docData).errors').filter(x=>!x.startsWith('Заполните')).length,2);
});

test('Бюллетень сортирует кандидатов по алфавиту, предпросмотр экранирует HTML',()=>{
 const a=app();a.run(`docData={...docDefaults('ballot'),candidates:[{name:'Яковлев Я. Я.',school:'10А'},{name:'Антонов А. А.',school:'9Б'}]}`);const rows=a.run('docModel("ballot",docData).find(b=>b.type==="table").rows');assert.equal(rows[0][0],'Антонов А. А.');
 const html=a.run('docPreviewHtml([bp("<img src=x onerror=alert(1)>")])');assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;img'));
});

test('Встроенные методические материалы доступны без входа',()=>{
 const a=app();a.run(readFileSync(new URL('../public/materials.js',import.meta.url),'utf8'));a.run('state.demo=true;materialsData={materials:mtBuiltin,can_add:false}');const html=a.run('materialsPage()');assert.equal(a.run('mtBuiltin.length'),5);assert.ok(html.includes('Документооборот Совета Первых'));assert.ok(html.includes('data-page="documents"'));assert.ok(html.includes('Скачать материал'));
});
