// Build the document locally, with the bundled docx library.
async function buildDocx(data) {
  if (!data.photo) throw new Error('Добавь фотографию участника.');
  const {Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    ImageRun, AlignmentType, BorderStyle, WidthType, HeightRule,
    TableLayoutType, VerticalAlign, convertMillimetersToTwip: mm} = docx;
  const lines = value => String(value || '').split(/\r\n|[\r\n]/).map(s => s.trim()).filter(Boolean);
  const run = (text, extra = {}) => new TextRun({text, ...extra});
  const body = [];
  const inset = {firstLine: mm(12.5)};
  const paragraph = (children, options = {}) => new Paragraph({children, ...options});
  if (data.photo) {
    const bytes = Uint8Array.from(atob(data.photo.split(',')[1]), c => c.charCodeAt(0));
    const img = new ImageRun({type:'jpg', data:bytes, transformation:{width:181,height:181},
      altText:{title:'Фотография', description:'Фотография участника', name:'Фотография'}});
    const rule = {style:BorderStyle.SINGLE, size:4, color:'000000'};
    body.push(new Table({width:{size:mm(52),type:WidthType.DXA}, columnWidths:[mm(52)],
      layout:TableLayoutType.FIXED, borders:{top:rule,bottom:rule,left:rule,right:rule},
      rows:[new TableRow({cantSplit:true,height:{value:mm(62),rule:HeightRule.ATLEAST},
        children:[new TableCell({verticalAlign:VerticalAlign.CENTER, width:{size:mm(52),type:WidthType.DXA},
          margins:{top:0,bottom:0,left:0,right:0},
          children:[paragraph([img], {alignment:AlignmentType.CENTER,spacing:{before:0,after:0}})]})]})]}));
  }
  const center = {alignment:AlignmentType.CENTER, keepNext:true};
  body.push(paragraph([run(data.name.trim(), {bold:true})], {...center,spacing:{before:data.photo ? 180 : 0}}));
  if (data.school.trim()) body.push(paragraph([run(data.school.trim(),{italics:true})],center));
  if (data.date) {
    const [year, month, day] = data.date.split('-').map(Number);
    const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    body.push(paragraph([run(`(на момент ${day} ${months[month-1]} ${year} года)`,{italics:true})],center));
  }
  let first = true;
  function addBody(children, extra = {}) {
    body.push(paragraph(children,{indent:inset,alignment:AlignmentType.JUSTIFIED, spacing:{before:first ? 240 : 0},...extra}));
    first = false;
  }
  for (const [label, value] of [['Сфера интересов',data.interests],['Место проживания',data.place]]) {
    const parts = lines(value);
    if (!parts.length) continue;
    addBody([run(label + ': ',{bold:true}), run(parts.join(' '),{italics:true})]);
  }
  for (const [label, value, isList] of [
    ['Общественная деятельность',data.activity,true],
    ['Награды и достижения',data.awards,false],
    ['Описание истории/реализованного проекта/мечты',data.story,false]
  ]) {
    const parts = lines(value);
    if (!parts.length) continue;
    addBody([run(label + ':',{bold:true})], {alignment:AlignmentType.LEFT,keepNext:true});
    for (const part of parts) {
      if (isList) addBody([run('–  '+part.replace(/^[-–—•]\s+/,''))],
        {alignment:AlignmentType.LEFT,indent:{left:mm(17.5),hanging:mm(5)}});
      else addBody([run(part)]);
    }
  }
  const doc = new Document({creator:'Советы Первых',title:'Объективка',styles:{default:{document:{
    run:{font:'Times New Roman',size:28,color:'000000',language:{value:'ru-RU'}},
    paragraph:{spacing:{before:0,after:0,line:240}}
  }}},sections:[{properties:{page:{size:{width:mm(210),height:mm(297)},
    margin:{top:mm(15),left:mm(25),right:mm(19),bottom:mm(18)}}},children:body}]});
  return Packer.toBlob(doc);
}

const $=id=>document.getElementById(id);
const keys=['name','school','date','interests','place','activity','awards','story'];
let photo='',ticket=0;
const camera='<svg aria-hidden="true" width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="3.5"/></svg>';
function el(tag,txt='',cls=''){let n=document.createElement(tag);n.textContent=txt;n.className=cls;return n}
function values(){return Object.fromEntries([...keys.map(k=>[k,$(k).value.trim()]),['photo',photo]])}
function render(){
 const d=values(),p=$('preview');p.replaceChildren();let empty=!keys.some(k=>k!=='date'&&d[k])&&!photo;
 if(photo||empty){let box=el('div',photo?'':'Фото','pic'+(photo?'':' empty'));if(photo){let img=new Image();img.src=photo;img.alt='Портрет';box.append(img)}p.append(box)}
 let head=el('div','','center');head.append(el('strong',d.name||'Фамилия Имя Отчество'));if(d.school||empty){head.append(el('br'),el('i',d.school||'Учебное заведение, класс'))}
 if(d.date){head.append(el('br'),el('i','(на момент '+new Intl.DateTimeFormat('ru',{day:'numeric',month:'long',year:'numeric'}).format(new Date(d.date+'T12:00:00')).replace(/\s*г\.$/,' года')+')'))}p.append(head);
 let body=el('section');p.append(body);
 for(let [k,label,hint] of [['interests','Сфера интересов','Твои увлечения'],['place','Место проживания','Населённый пункт'],['activity','Общественная деятельность','Роли и занятия'],['awards','Награды и достижения','Твои достижения'],['story','Описание истории/реализованного проекта/мечты','Рассказ о тебе']]){
 if(!d[k]&&!empty)continue;let row=el('p');row.append(el('b',label+': '));body.append(row);let content=d[k]||hint,cl=d[k]?'':'muted';
 if(['place','interests'].includes(k))row.append(el('i',content,cl));else for(let s of content.split(/\n/).map(x=>x.trim()).filter(Boolean)){body.append(el('p',(k==='activity'?'– ':'')+(k==='activity'?s.replace(/^[-–—•]\s+/,''):s),cl+(k==='activity'?' line':'')))}
 }}
function updatePhoto(){$('upload').setCustomValidity(photo ? '' : 'Добавь фотографию участника.');let box=$('avatar');box.innerHTML=camera;if(photo){let img=new Image();img.src=photo;img.alt='Выбранное фото';box.replaceChildren(img)}$('remove').hidden=!photo;$('pickText').textContent=photo?'Заменить фото':'Добавить фото';render()}
$('date').value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
$('form').addEventListener('input',()=>{render();$('status').textContent=''});
$('remove').onclick=()=>{ticket++;photo='';$('upload').value='';$('photoStatus').textContent='';$('save').disabled=false;updatePhoto()};
$('upload').onchange=async e=>{const file=e.target.files[0];if(!file)return;let t=++ticket;$('save').disabled=true;$('photoStatus').textContent='Подготовка фото…';try{const url=await new Promise((resolve,reject)=>{
 const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);
 });let img=new Image();await new Promise((ok,no)=>{img.onload=ok;img.onerror=no;img.src=url});if(t!==ticket)return;let size=Math.min(img.naturalWidth,img.naturalHeight),canvas=document.createElement('canvas');canvas.width=canvas.height=Math.min(900,size);let ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,(img.naturalWidth-size)/2,(img.naturalHeight-size)/2,size,size,0,0,canvas.width,canvas.height);photo=canvas.toDataURL('image/jpeg',.9);updatePhoto();$('photoStatus').textContent=''}catch{if(t===ticket)$('photoStatus').textContent='Не удалось открыть фото. Выбери изображение JPEG или PNG.'}finally{if(t===ticket){$('save').disabled=false;$('upload').value=''}}};
$('upload').oninvalid=()=>{$('photoStatus').textContent='Добавь фото, чтобы скачать объективку.'};
$('see').onclick=()=>{$('panel').open=true;$('panel').scrollIntoView({block:'start'})};
$('form').onsubmit=async e=>{e.preventDefault();let d=values();if(!d.photo){$('upload').reportValidity();return}if(!d.name){$('name').setCustomValidity('Введи имя для объективки');$('name').reportValidity();return}$('save').disabled=true;try{let blob=await buildDocx(d),link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download='Объективка — '+d.name.replace(/[<>:"/\\|?*]/g,' ').slice(0,100)+'.docx';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),120000);$('status').textContent='Документ готов. Файл можно открыть в Word.'}catch{$('status').textContent='Не удалось создать файл. Попробуй скачать ещё раз.'}finally{$('save').disabled=false}};
$('name').oninput=()=>$('name').setCustomValidity('');
if(matchMedia('(max-width:800px)').matches)$('panel').open=false;updatePhoto();
