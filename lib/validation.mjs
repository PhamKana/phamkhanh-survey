import { answerError, visibleQuestions, eligibility, timeCheck, conditionReferences, hasContext } from '../public/logic.mjs';
const fail = message => { const error = new Error(message); error.status = 400; throw error; };
const bounded = (x, max) => typeof x === 'string' && x.length <= max;
export function validateSurvey(input, original) {
  if (!input || typeof input !== 'object' || !bounded(input.title, 250) || !input.title.trim()) fail('Tên khảo sát không hợp lệ.');
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(input.slug || '')) fail('Đường dẫn chỉ dùng chữ thường không dấu, số và dấu gạch ngang.');
  if (!['draft','open','closed'].includes(input.status)) fail('Trạng thái không hợp lệ.');
  if (!Array.isArray(input.sections) || !input.sections.length || input.sections.length > 20 || input.sections.some(x => !bounded(x, 200) || !x.trim())) fail('Cần có từ 1 đến 20 phần.');
  if (!Array.isArray(input.questions) || !input.questions.length || input.questions.length > 150) fail('Cần có từ 1 đến 150 câu hỏi.');
  if (!['generic','genai'].includes(input.kind)) fail('Loại khảo sát không hợp lệ.');
  const ids = new Set();
  const questions = input.questions.map(q => {
    if (!q || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(q.id || '') || ids.has(q.id)) fail('Mã câu hỏi bị trùng hoặc không hợp lệ.');
    ids.add(q.id);
    if (!bounded(q.title, 2000) || !q.title.trim() || !bounded(q.help || '', 5000) || !Number.isInteger(q.section) || q.section < 0 || q.section >= input.sections.length || !['single','multiple','slider','text','allocation'].includes(q.type)) fail(`Cấu hình ${q.id} không hợp lệ.`);
    const clean = { id: q.id, title: q.title.trim(), help: q.help || '', section: q.section, type: q.type, required: q.required !== false };
    if (['single','multiple','allocation'].includes(q.type)) {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 40 || q.options.some(x => !bounded(x, 1000) || !x.trim())) fail(`Đáp án ${q.id} không hợp lệ.`);
      clean.options = q.options.map(x => x.trim());
    }
    if (['slider','allocation'].includes(q.type)) {
      if (!Array.isArray(q.specials || []) || (q.specials || []).some(x => !bounded(x, 500) || !x.trim())) fail(`Lựa chọn riêng của ${q.id} không hợp lệ.`);
      clean.specials = q.specials || [];
    }
    if (q.type === 'slider') {
      if (![q.min,q.max,q.step].every(x => typeof x === 'number' && Number.isFinite(x)) || q.min >= q.max || q.step <= 0 || !['hours','percent','days','points','index'].includes(q.unit)) fail(`Khoảng thanh kéo ${q.id} không hợp lệ.`);
      Object.assign(clean, { min: q.min, max: q.max, step: q.step, unit: q.unit });
      if (q.expand) { if (!Number.isFinite(q.expand) || q.expand <= 0 || (q.cap !== null && (!Number.isFinite(q.cap) || q.cap < q.max))) fail(`Khoảng mở rộng ${q.id} không hợp lệ.`); clean.expand = q.expand; clean.cap = q.cap; }
    }
    for (const key of ['other','exclusive','screenOut','reviewChoices']) if (q[key] !== undefined) {
      if (!Array.isArray(q[key]) || q[key].some(x => !Number.isInteger(x) || x < 0 || x >= (clean.options?.length || 0))) fail(`Lựa chọn ${key} ở ${q.id} không hợp lệ.`);
      clean[key] = q[key];
    }
    if((clean.screenOut?.length || clean.reviewChoices?.length) && !['single','multiple'].includes(clean.type)) fail(`Lựa chọn kết thúc hoặc rà soát ở ${q.id} cần câu hỏi chọn đáp án.`);
    if (q.incompatible) {
      if (!Array.isArray(q.incompatible) || q.incompatible.some(pair => !Array.isArray(pair) || pair.length !== 2 || pair.some(x => !Number.isInteger(x) || x < 0 || x >= (clean.options?.length || 0)))) fail('Cặp lựa chọn không hợp lệ.');
      clean.incompatible = q.incompatible;
    }
    if (q.maxChoices !== undefined) { if (!Number.isInteger(q.maxChoices) || q.maxChoices < 1 || q.maxChoices > clean.options?.length) fail('Số lựa chọn tối đa không hợp lệ.'); clean.maxChoices = q.maxChoices; }
    if (q.otherRequired) clean.otherRequired = true;
    return clean;
  });
  const byId=new Map(questions.map(q=>[q.id,q]));
  let analysis=null;
  if(input.analysis){
    const a=input.analysis;
    for(const key of ['actual','hypothetical'])if(byId.get(a[key])?.type!=='slider'||byId.get(a[key])?.unit!=='hours')fail('Các câu tính chênh lệch phải là thanh kéo đơn vị giờ.');
    const direction=byId.get(a.direction);
    if(direction?.type!=='single')fail('Câu đánh giá hướng thay đổi phải là chọn một đáp án.');
    const choices=['savingChoice','unchangedChoice','slowerChoice','unknownChoice'];
    if(choices.some(key=>!Number.isInteger(a[key])||a[key]<0||a[key]>=direction.options.length)||new Set(choices.map(key=>a[key])).size!==4)fail('Chọn bốn đáp án riêng cho các hướng thay đổi thời gian.');
    if(new Set([a.actual,a.hypothetical,a.direction]).size!==3)fail('Các câu dùng tính chênh lệch phải khác nhau.');
    if(a.allocation && byId.get(a.allocation)?.type!=='allocation')fail('Câu phân bổ thời gian không hợp lệ.');
    analysis=Object.fromEntries(['actual','hypothetical','direction',...choices,'allocation'].map(key=>[key,a[key]??null]));
  }
  for(let i=0;i<questions.length;i++){
    const q=questions[i];
    if(input.questions[i].showWhen)q.showWhen=validateCondition(input.questions[i].showWhen,byId,analysis);
    if(q.screenOut?.length && (hasContext(q.showWhen,'eligible')||hasContext(q.showWhen,'saving')))fail(`${q.id}: câu xác định nhóm không thể phụ thuộc vào kết quả xác định nhóm hoặc thời gian tiết kiệm.`);
  }
  const graph=new Map(questions.map(q=>[q.id,[...conditionReferences(q.showWhen),...(hasContext(q.showWhen,'eligible')?questions.filter(x=>x.screenOut?.length).map(x=>x.id):[]),...(hasContext(q.showWhen,'saving')&&analysis?[analysis.actual,analysis.hypothetical,analysis.direction]:[])]]));
  const completed=new Set(),visiting=new Set();
  function visit(id){if(visiting.has(id))fail(`Điều kiện hiển thị bị vòng lặp ở ${id}.`);if(completed.has(id))return;visiting.add(id);for(const ref of graph.get(id)||[])visit(ref);visiting.delete(id);completed.add(id);}
  for(const q of questions)visit(q.id);
  const order=new Map(questions.map((q,i)=>({q,i})).sort((a,b)=>a.q.section-b.q.section||a.i-b.i).map((entry,i)=>[entry.q.id,i]));
  for(const q of questions)for(const ref of graph.get(q.id)||[])if(order.get(ref)>=order.get(q.id))fail(`Điều kiện của ${q.id} dựa trên ${ref}. Đặt ${ref} trước ${q.id} hoặc sửa điều kiện hiển thị.`);
  if (!bounded(input.description || '', 5000) || !bounded(input.introduction || '', 5000)) fail('Mô tả quá dài.');
  const clean={ title: input.title.trim(), slug: input.slug, status: input.status, kind: input.kind, routingVersion:1, analysis, sections: input.sections, description: input.description || '', introduction: input.introduction || '', questions };
  if(!visibleQuestions(clean,{}).length)fail('Cần có ít nhất một câu hiển thị khi bắt đầu khảo sát.');
  return clean;
}
export function validateCondition(node,byId,analysis,depth=0,budget={count:0}){
  if(!node||typeof node!=='object'||Array.isArray(node)||depth>8||++budget.count>150)fail('Điều kiện hiển thị không hợp lệ hoặc quá phức tạp.');
  if(node.all!==undefined||node.any!==undefined){
    const key=node.all!==undefined?'all':'any',children=node[key];
    if(Object.keys(node).length!==1||!Array.isArray(children)||!children.length||children.length>40)fail('Nhóm điều kiện cần ít nhất một điều kiện.');
    return {[key]:children.map(c=>validateCondition(c,byId,analysis,depth+1,budget))};
  }
  if(node.context){
    if(Object.keys(node).length!==1||!['eligible','saving'].includes(node.context)||node.context==='saving'&&!analysis)fail('Điều kiện thời gian tiết kiệm cần bật tính chênh lệch thời gian.');
    return {context:node.context};
  }
  const source=byId.get(node.question);
  if(!source)fail(`Điều kiện tham chiếu câu không tồn tại: ${node.question}.`);
  if(node.op==='answered')return {question:node.question,op:'answered'};
  if(node.op==='special'){
    if(!Number.isInteger(node.value)||node.value<0||node.value>=(source.specials?.length||0))fail(`Lựa chọn riêng trong điều kiện ${node.question} không hợp lệ.`);
  }else if(source.type==='single'||source.type==='multiple'){
    if(![source.type==='single'?'eq':'includes',...(source.type==='single'?['ne']:[])].includes(node.op)||!Number.isInteger(node.value)||node.value<0||node.value>=source.options.length)fail(`Đáp án trong điều kiện ${node.question} không hợp lệ.`);
  }else if(source.type==='slider'){
    if(!['eq','ne','gt','gte','lt','lte'].includes(node.op)||!Number.isFinite(node.value))fail(`Giá trị trong điều kiện ${node.question} không hợp lệ.`);
  }else if(source.type==='text'){
    if(!['eq','ne'].includes(node.op)||!bounded(node.value,5000))fail(`Nội dung trong điều kiện ${node.question} không hợp lệ.`);
  }else fail('Câu phân bổ chỉ hỗ trợ điều kiện đã trả lời.');
  return {question:node.question,op:node.op,value:node.value};
}
export function validateSubmission(survey, body) {
  if (!body || typeof body.answers !== 'object' || body.answers === null || Array.isArray(body.answers) || !/^[a-f0-9-]{36}$/i.test(body.submissionKey || '')) fail('Dữ liệu gửi không hợp lệ.');
  const raw = body.answers, rawMeta = body.meta || {};
  const meta = {};
  if (rawMeta.timeBasis && ['numeric','reported'].includes(rawMeta.timeBasis)) meta.timeBasis = rawMeta.timeBasis;
  if (Object.keys(raw).some(id => !survey.questions.some(q => q.id === id))) fail('Có câu hỏi không thuộc khảo sát.');
  const answers = {};
  // Validate parents before evaluating branches; forged indices must never change routing.
  for (const q of survey.questions) if (raw[q.id] !== undefined) {
    const error = answerError({ ...q, required: false }, raw[q.id]);
    if (error) fail(`${q.id}: ${error}`);
  }
  for (const q of visibleQuestions(survey, raw, meta)) {
    const error = answerError(q, raw[q.id]);
    if (error) fail(`${q.id}: ${error}`);
    if (raw[q.id]) {
      const a = raw[q.id];
      answers[q.id] = a.special !== undefined ? { special: a.special } : { value: a.value };
      if (a.other) answers[q.id].other = a.other;
      if (q.type === 'allocation' && a.confirmed) answers[q.id].confirmed = true;
    }
  }
  const outcome = eligibility(answers,survey);
  if (outcome === 'pending') fail('Chưa hoàn tất phần xác định người tham gia.');
  meta.reviewQuestions=survey.questions.filter(q=>q.reviewChoices?.some(i=>Array.isArray(answers[q.id]?.value)?answers[q.id].value.includes(i):answers[q.id]?.value===i)).map(q=>q.id);
  meta.jobOtherReview=meta.reviewQuestions.length>0;
  if (survey.analysis) {
    const check = timeCheck(answers,survey.analysis);
    if (check.conflict && !meta.timeBasis) fail(`Vui lòng xác nhận hướng thay đổi thời gian ở ${survey.analysis.direction}.`);
    meta.timeConflict = check.conflict;
    meta.savedHours = check.delta;
    meta.missingSavingMagnitude = !!answers[survey.analysis.allocation] && check.delta === null;
  }
  return { answers, meta, outcome };
}
