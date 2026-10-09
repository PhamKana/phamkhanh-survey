const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const choices={single:'Chọn một đáp án',multiple:'Chọn nhiều đáp án',slider:'Thanh kéo',text:'Văn bản',allocation:'Phân bổ 100%'};
const option=(value,label,current)=>`<option value="${esc(value)}" ${value===current?'selected':''}>${esc(label)}</option>`;
export function blankSurvey(){return {title:'Khảo sát mới',slug:'khao-sat-'+Date.now().toString(36),description:'',introduction:'Bạn không cần đăng nhập. Câu trả lời chỉ hiển thị với quản trị viên khảo sát.',sections:['Nội dung khảo sát'],kind:'generic',status:'draft',routingVersion:1,analysis:null,questions:[{id:'Q01',section:0,type:'single',title:'Câu hỏi của bạn',help:'',required:true,options:['Lựa chọn 1','Lựa chọn 2']}]};}
export function defaultCondition(survey,id){const source=survey.questions.find(q=>q.id!==id);return source?{question:source.id,op:'answered'}:{context:'eligible'};}
export function ruleAt(question,path){let node=question.showWhen;if(path)for(const index of path.split('.'))node=(node.all||node.any)[Number(index)];return node;}
export function setRule(question,path,replacement){
  if(!path){if(replacement)question.showWhen=replacement;else delete question.showWhen;return;}
  const indices=path.split('.').map(Number),last=indices.pop();let node=question.showWhen;
  for(const index of indices)node=(node.all||node.any)[index];
  const list=node.all||node.any;if(replacement)list[last]=replacement;else list.splice(last,1);
  if(!list.length)setRule(question,indices.join('.'),null);
}
export function operators(source){
  const base={single:['eq','ne','answered'],multiple:['includes','answered'],slider:['eq','ne','gt','gte','lt','lte','answered'],text:['eq','ne','answered'],allocation:['answered']}[source?.type]||['answered'];
  return [...base,...(source?.specials?.length?['special']:[])];
}
const operatorLabels={eq:'Bằng / chọn đáp án',ne:'Khác đáp án',includes:'Có chọn đáp án',gt:'Lớn hơn',gte:'Lớn hơn hoặc bằng',lt:'Nhỏ hơn',lte:'Nhỏ hơn hoặc bằng',answered:'Đã trả lời',special:'Chọn lựa chọn riêng'};
function ruleMarkup(node,survey,id,path=''){
  if(node.all||node.any){const key=node.all?'all':'any',list=node[key];return `<div class="condition-group"><div class="condition-group-head"><select data-rule-field="mode" data-path="${path}" aria-label="Cách kết hợp điều kiện">${option('all','Tất cả điều kiện đúng',key)}${option('any','Ít nhất một điều kiện đúng',key)}</select><button class="text-button danger" type="button" data-action="remove-rule" data-path="${path}">Gỡ nhóm</button></div>${list.map((c,i)=>ruleMarkup(c,survey,id,path?`${path}.${i}`:String(i))).join('')}<div class="condition-add"><button class="text-button" type="button" data-action="add-rule" data-path="${path}">Thêm điều kiện</button><button class="text-button" type="button" data-action="add-rule-group" data-path="${path}">Thêm nhóm hoặc</button></div></div>`;}
  const source=survey.questions.find(q=>q.id===node.question),sourceValue=node.context?`__${node.context}`:node.question;
  let value='';
  if(source&&node.op!=='answered'){
    const list=node.op==='special'?source.specials:['single','multiple'].includes(source.type)?source.options:null;
    value=list?`<select data-rule-field="value" data-path="${path}" aria-label="Đáp án điều kiện">${list.map((label,i)=>option(String(i),`${i+1}. ${label}`,String(node.value))).join('')}</select>`:`<input type="${source.type==='slider'?'number':'text'}" step="any" data-rule-field="value" data-path="${path}" value="${esc(node.value)}" aria-label="Giá trị điều kiện">`;
  }
  return `<div class="condition-row"><select data-rule-field="source" data-path="${path}" aria-label="Câu hỏi làm điều kiện">${option('__eligible','Đã qua các câu xác định nhóm',sourceValue)}${survey.analysis?option('__saving','Có tiết kiệm thời gian (đã xác nhận)',sourceValue):''}${survey.questions.filter(q=>q.id!==id).map(q=>option(q.id,`${q.id} · ${q.title}`,sourceValue)).join('')}</select>${source?`<select data-rule-field="op" data-path="${path}" aria-label="Phép so sánh">${operators(source).map(op=>option(op,operatorLabels[op],node.op)).join('')}</select>`:''}${value}<button class="text-button danger" type="button" data-action="remove-rule" data-path="${path}">Gỡ</button></div>`;
}
function optionFlags(q,key,label){return `<details class="option-flags"><summary>${label}${q[key]?.length?` (${q[key].length})`:''}</summary>${q.options.map((text,i)=>`<label class="inline-checkbox"><input type="checkbox" data-flag="${key}" value="${i}" ${q[key]?.includes(i)?'checked':''}>${i+1}. ${esc(text)}</label>`).join('')}</details>`;}
function questionMarkup(q,i,survey){
  return `<section class="editor-question" data-index="${i}"><div class="editor-question-header"><strong>Câu ${i+1} · ${esc(q.id)}</strong><div><button class="text-button" type="button" data-action="move-up" data-index="${i}" ${i===0?'disabled':''}>Lên</button><button class="text-button" type="button" data-action="move-down" data-index="${i}" ${i===survey.questions.length-1?'disabled':''}>Xuống</button><button class="text-button danger" type="button" data-action="remove-question" data-index="${i}">Xóa</button></div></div>
  <label>Nội dung câu hỏi<textarea data-prop="title" rows="2" maxlength="2000" required>${esc(q.title)}</textarea></label><label>Hướng dẫn<textarea data-prop="help" rows="2" maxlength="5000">${esc(q.help||'')}</textarea></label>
  <div class="two-columns"><label>Loại câu hỏi<select data-prop="type">${Object.entries(choices).map(([value,label])=>option(value,label,q.type)).join('')}</select></label><label>Phần<select data-prop="section">${survey.sections.map((section,index)=>option(String(index),section,String(q.section))).join('')}</select></label></div>
  ${q.options?`<label>Các đáp án (mỗi đáp án một dòng)<textarea data-prop="options" rows="${Math.min(q.options.length,6)}" required>${esc(q.options.join('\n'))}</textarea></label>`:''}
  ${q.type==='slider'?`<div class="slider-settings">${['min','max','step'].map(prop=>`<label>${{min:'Từ',max:'Đến',step:'Bước'}[prop]}<input type="number" data-prop="${prop}" step="any" value="${q[prop]}" required></label>`).join('')}<label>Đơn vị<select data-prop="unit">${Object.entries({index:'Giá trị',hours:'Giờ',percent:'Phần trăm',days:'Ngày',points:'Điểm'}).map(([value,label])=>option(value,label,q.unit)).join('')}</select></label></div><div class="two-columns"><label>Mở rộng thêm mỗi lần (0 = tắt)<input type="number" step="any" min="0" data-prop="expand" value="${q.expand||0}"></label><label>Giới hạn cuối (trống = không đặt trần)<input type="number" step="any" data-prop="cap" value="${q.cap??''}"></label></div>`:''}
  ${['slider','allocation'].includes(q.type)?`<label>Lựa chọn riêng (mỗi dòng một lựa chọn)<textarea data-prop="specials" rows="2">${esc((q.specials||[]).join('\n'))}</textarea></label>`:''}
  <label class="inline-checkbox"><input type="checkbox" data-prop="required" ${q.required?'checked':''}>Bắt buộc trả lời</label>
  <details class="question-advanced" data-detail="${q.id}-options"><summary>Lựa chọn bổ sung</summary>${q.options?`${optionFlags(q,'other','Cho phép mô tả khác')}${q.type==='multiple'?`<label>Số đáp án tối đa (trống = không giới hạn)<input type="number" data-prop="maxChoices" min="1" max="${q.options.length}" value="${q.maxChoices||''}"></label>${optionFlags(q,'exclusive','Các đáp án cần chọn riêng')}<label>Các cặp không chọn đồng thời (số thứ tự, mỗi cặp một dòng)<textarea data-prop="incompatible" rows="2" placeholder="1,2">${esc((q.incompatible||[]).map(pair=>pair.map(n=>n+1).join(',')).join('\n'))}</textarea></label>`:''}${['single','multiple'].includes(q.type)?optionFlags(q,'screenOut','Các đáp án kết thúc khảo sát')+optionFlags(q,'reviewChoices','Các đáp án cần admin rà soát'):''}<label class="inline-checkbox"><input type="checkbox" data-prop="otherRequired" ${q.otherRequired?'checked':''}>Bắt buộc mô tả khi chọn đáp án khác</label>`:'Câu văn bản không có lựa chọn bổ sung.'}</details>
  <details class="question-advanced" data-detail="${q.id}-conditions"><summary>Điều kiện hiển thị · ${q.showWhen?'Có điều kiện':'Luôn hiển thị'}</summary>${q.showWhen?ruleMarkup(q.showWhen,survey,q.id):'<p class="muted">Câu này hiển thị với mọi người chưa kết thúc khảo sát.</p><button class="text-button" type="button" data-action="add-rule" data-path="">Thêm điều kiện hiển thị</button>'}</details></section>`;
}
function analysisMarkup(survey){
  const a=survey.analysis;
  return `<details class="question-advanced analysis-settings" data-detail="analysis"><summary>Tính chênh lệch thời gian${a?' · Đang bật':''}</summary><label class="inline-checkbox"><input type="checkbox" id="analysis-enabled" ${a?'checked':''}>Tính thời gian tiết kiệm và kiểm tra hướng thay đổi</label>${a?`<div class="analysis-fields">${['actual','hypothetical','direction','allocation'].map(key=>`<label>${{actual:'Câu thời gian thực tế',hypothetical:'Câu thời gian giả định',direction:'Câu đánh giá hướng thay đổi',allocation:'Câu phân bổ (tùy chọn)'}[key]}<select data-analysis="${key}">${key==='allocation'?option('','Không chọn',a[key]||''):''}${survey.questions.filter(q=>key==='direction'?q.type==='single':key==='allocation'?q.type==='allocation':q.type==='slider'&&q.unit==='hours').map(q=>option(q.id,`${q.id} · ${q.title}`,a[key])).join('')}</select></label>`).join('')}${['savingChoice','unchangedChoice','slowerChoice','unknownChoice'].map(key=>`<label>${{savingChoice:'Đáp án tiết kiệm',unchangedChoice:'Đáp án không thay đổi',slowerChoice:'Đáp án tốn thêm thời gian',unknownChoice:'Đáp án chưa đủ cơ sở'}[key]}<select data-analysis="${key}">${(survey.questions.find(q=>q.id===a.direction)?.options||[]).map((label,i)=>option(String(i),label,String(a[key]))).join('')}</select></label>`).join('')}</div>`:'<p class="muted">Bật khi có hai thanh kéo đơn vị giờ và một câu chọn đáp án về hướng thay đổi.</p>'}</details>`;
}
export function editorMarkup(survey,warnings=[]){return `<div class="modal-header"><div><p class="eyebrow">TRÌNH SOẠN KHẢO SÁT</p><h2>${survey.id?'Chỉnh sửa khảo sát':'Tạo khảo sát'}</h2></div><div class="editor-header-actions"><button class="button primary small" type="submit" form="editor-form">Lưu thay đổi</button><button class="button secondary small" data-action="close-editor">Đóng</button></div></div>
<form id="editor-form"><details class="editor-basics-details" data-detail="basics" ${survey.id?'':'open'}><summary>Thông tin khảo sát · ${esc(survey.title)}</summary><div class="editor-basics"><label>Tên khảo sát<input name="title" value="${esc(survey.title)}" maxlength="250" required></label><div class="two-columns"><label>Đường dẫn /s/<input name="slug" pattern="[a-z0-9][a-z0-9-]{0,79}" value="${esc(survey.slug)}" required></label><label>Trạng thái<select name="status">${['draft','open','closed'].map(value=>option(value,{draft:'Bản nháp',open:'Đang nhận',closed:'Đã đóng'}[value],survey.status)).join('')}</select></label></div><label>Mô tả<textarea name="description" rows="2" maxlength="5000">${esc(survey.description)}</textarea></label><label>Lời giới thiệu / hướng dẫn<textarea name="introduction" rows="2" maxlength="5000">${esc(survey.introduction)}</textarea></label><label>Tên các phần (mỗi phần một dòng)<textarea name="sections" rows="${Math.min(survey.sections.length,4)}">${esc(survey.sections.join('\n'))}</textarea></label></div></details>
<div class="editor-template-tools"><button class="button secondary small" type="button" data-action="restore-default">Dùng bộ câu hỏi từ file Word</button><button class="text-button" type="button" data-action="blank-questions">Dùng bộ câu hỏi trống</button><label class="button secondary small">Nhập mẫu JSON<input type="file" id="import-json" accept=".json,application/json" hidden></label></div>
<p class="editor-hint">Bạn có thể thêm, xóa, đổi loại và sắp xếp mọi câu hỏi. Điều kiện hiển thị nằm ở cuối từng câu. Những thay đổi chỉ áp dụng khi bạn bấm Lưu khảo sát.</p>${warnings.length?`<div class="notice">${warnings.map(text=>`<p>${esc(text)}</p>`).join('')}</div>`:''}${analysisMarkup(survey)}
<div class="editor-jump"><label for="question-jump">Đi đến câu hỏi</label><select id="question-jump"><option value="">Chọn câu cần sửa</option>${survey.questions.map((q,i)=>option(String(i),`${i+1}. ${q.id} · ${q.title}`,'')).join('')}</select></div><div class="editor-questions">${survey.questions.map((q,i)=>questionMarkup(q,i,survey)).join('')}</div><button class="button secondary" type="button" data-action="add-question">Thêm câu hỏi</button><div id="editor-error"></div><div class="editor-actions"><button class="button secondary" type="button" data-action="close-editor">Hủy</button><button class="button primary" type="submit">Lưu khảo sát</button></div></form>`;}
export function collectEditorForm(survey,form){
  for(const name of ['title','slug','description','introduction','status'])survey[name]=form.elements[name].value;
  survey.sections=form.elements.sections.value.split('\n').map(s=>s.trim()).filter(Boolean);
  form.querySelectorAll('.editor-question').forEach(card=>{
    const q=survey.questions[Number(card.dataset.index)];
    card.querySelectorAll('[data-prop]').forEach(el=>{
      const prop=el.dataset.prop,value=el.value;
      if(['required','otherRequired'].includes(prop))q[prop]=el.checked;
      else if(['options','specials'].includes(prop))q[prop]=value.split('\n').map(s=>s.trim()).filter(Boolean);
      else if(prop==='incompatible')q[prop]=value.trim()?value.split('\n').map(line=>line.split(',').map(s=>Number(s.trim())-1)):[];
      else if(['maxChoices','cap'].includes(prop))q[prop]=value===''?undefined:Number(value);
      else q[prop]=['section','min','max','step','expand'].includes(prop)?Number(value):value;
    });
    if(q.expand&&q.cap===undefined)q.cap=null;
    if(!q.expand){delete q.expand;delete q.cap;}
    for(const flag of ['other','exclusive','screenOut','reviewChoices']){
      const boxes=card.querySelectorAll(`[data-flag="${flag}"]`);
      if(boxes.length)q[flag]=[...boxes].filter(el=>el.checked).map(el=>Number(el.value));
    }
  });
  if(survey.analysis)form.querySelectorAll('[data-analysis]').forEach(el=>{survey.analysis[el.dataset.analysis]=el.dataset.analysis.endsWith('Choice')?Number(el.value):el.value||null;});
}
export function repairReferences(survey){
  const warnings=[];const byId=new Map(survey.questions.map(q=>[q.id,q]));
  for(const q of survey.questions){
    for(const key of ['other','exclusive','screenOut','reviewChoices'])if(q[key]){const previous=q[key];q[key]=previous.filter(i=>i<q.options?.length);if(q[key].length!==previous.length)warnings.push(`${q.id}: đã gỡ lựa chọn bổ sung cho các đáp án bị xóa.`);}
    if(q.incompatible)q.incompatible=q.incompatible.filter(pair=>pair.every(i=>i<q.options?.length));
    if(q.maxChoices)q.maxChoices=Math.min(q.maxChoices,q.options.length);
    q.section=Math.max(0,Math.min(q.section,survey.sections.length-1));
  }
  const a=survey.analysis;
  if(a && (['actual','hypothetical'].some(key=>byId.get(a[key])?.type!=='slider'||byId.get(a[key])?.unit!=='hours')||byId.get(a.direction)?.type!=='single'||['savingChoice','unchangedChoice','slowerChoice','unknownChoice'].some(key=>a[key]>=byId.get(a.direction).options.length))){survey.analysis=null;warnings.push('Đã tắt tính chênh lệch vì một câu hoặc đáp án dùng để tính đã bị xóa hay đổi loại. Bạn có thể cấu hình lại ở mục Tính chênh lệch thời gian.');}
  if(survey.analysis?.allocation&&byId.get(survey.analysis.allocation)?.type!=='allocation')survey.analysis.allocation=null;
  function repair(node){
    if(!node)return null;
    if(node.all||node.any){const key=node.all?'all':'any',children=node[key].map(repair).filter(Boolean);return children.length?{[key]:children}:null;}
    if(node.context)return node.context==='saving'&&!survey.analysis?null:node;
    const source=byId.get(node.question);if(!source||!operators(source).includes(node.op))return null;
    if(node.op==='special' && node.value>=source.specials.length)return null;
    if(['single','multiple'].includes(source.type)&&node.op!=='answered'&&(node.value>=source.options.length||!Number.isInteger(node.value)))return null;
    if(source.type==='slider'&&node.op!=='answered'&&!Number.isFinite(node.value))return null;
    if(source.type==='text'&&node.op!=='answered'&&typeof node.value!=='string')return null;
    return node;
  }
  for(const q of survey.questions){const previous=JSON.stringify(q.showWhen),next=repair(q.showWhen);if(next)q.showWhen=next;else delete q.showWhen;if(previous!==JSON.stringify(q.showWhen)&&previous!==undefined)warnings.push(`${q.id}: đã gỡ điều kiện tham chiếu câu hoặc đáp án không còn phù hợp. Kiểm tra lại Điều kiện hiển thị.`);}
  return [...new Set(warnings)];
}
