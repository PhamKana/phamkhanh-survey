export function numeric(answers, id) {
  const value = answers[id]?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
export function timeCheck(answers, analysis) {
  const actual = analysis ? numeric(answers, analysis.actual) : null, hypothetical = analysis ? numeric(answers, analysis.hypothetical) : null;
  const delta = actual !== null && hypothetical !== null ? hypothetical - actual : null;
  const direction = !analysis || delta === null ? null : delta > 0 ? analysis.savingChoice : delta < 0 ? analysis.slowerChoice : analysis.unchangedChoice;
  const reported = analysis ? numeric(answers, analysis.direction) : null;
  return { delta, direction, reported, conflict: direction !== null && reported !== null && reported !== analysis?.unknownChoice && direction !== reported };
}
export function matchesCondition(condition, getAnswer, contexts = {}) {
  if (!condition) return true;
  if (condition.all) return condition.all.every(c => matchesCondition(c,getAnswer,contexts));
  if (condition.any) return condition.any.some(c => matchesCondition(c,getAnswer,contexts));
  if (condition.context) return !!contexts[condition.context]?.();
  const a = getAnswer(condition.question);
  if (condition.op === 'answered') return !!a && (a.value !== undefined || a.special !== undefined);
  if (!a) return false;
  if (condition.op === 'special') return a.special === condition.value;
  if (a.value === undefined) return false;
  const value = a.value;
  switch (condition.op) {
    case 'eq': return value === condition.value;
    case 'ne': return value !== condition.value;
    case 'includes': return Array.isArray(value) && value.includes(condition.value);
    case 'gt': return typeof value === 'number' && value > condition.value;
    case 'gte': return typeof value === 'number' && value >= condition.value;
    case 'lt': return typeof value === 'number' && value < condition.value;
    case 'lte': return typeof value === 'number' && value <= condition.value;
    default: return false;
  }
}
export function conditionReferences(condition) {
  if (!condition) return [];
  if (condition.all || condition.any) return (condition.all || condition.any).flatMap(conditionReferences);
  return condition.question ? [condition.question] : [];
}
export function hasContext(condition, name) {
  if (!condition) return false;
  return condition.context === name || (condition.all || condition.any || []).some(c => hasContext(c,name));
}
export function routing(survey, answers, meta = {}) {
  const byId = new Map(survey.questions.map(q => [q.id,q])), cache = new Map(), visiting = new Set();
  const screening = survey.questions.filter(q => q.screenOut?.length);
  const isScreened = (q,a) => a && (Array.isArray(a.value) ? a.value.some(v => q.screenOut.includes(v)) : q.screenOut.includes(a.value));
  const screenState = () => {
    let pending = false;
    for (const q of screening) {
      if (!isVisible(q)) continue;
      const a = answers[q.id];
      if (isScreened(q,a)) return 'screened_out';
      if (q.required && (!a || answerError(q,a))) pending = true;
    }
    return pending ? 'pending' : 'eligible';
  };
  const getAnswer = id => byId.has(id) && isVisible(byId.get(id)) ? answers[id] : undefined;
  const contexts = {
    eligible: () => screenState() === 'eligible',
    saving: () => {
      const a = survey.analysis; if (!a) return false;
      const valid = Object.fromEntries([a.actual,a.hypothetical,a.direction].map(id => [id,getAnswer(id)]));
      const check = timeCheck(valid,a);
      return check.conflict ? (meta.timeBasis === 'numeric' ? check.direction === a.savingChoice : meta.timeBasis === 'reported' && check.reported === a.savingChoice) : check.delta !== null ? check.delta > 0 : check.reported === a.savingChoice;
    }
  };
  function isVisible(q) {
    if (cache.has(q.id)) return cache.get(q.id);
    if (visiting.has(q.id)) return false;
    visiting.add(q.id);
    const result = matchesCondition(q.showWhen,getAnswer,contexts);
    visiting.delete(q.id); cache.set(q.id,result); return result;
  }
  const ordered = survey.questions.map((q,i) => ({q,i})).sort((a,b) => a.q.section-b.q.section || a.i-b.i).map(x=>x.q);
  const visible = ordered.filter(isVisible);
  const stop = visible.findIndex(q => q.screenOut?.length && isScreened(q,answers[q.id]));
  return { visible: stop < 0 ? visible : visible.slice(0,stop+1), outcome: screenState() };
}
export const eligibility = (answers,survey) => routing(survey,answers).outcome;
export const visibleQuestions = (survey,answers,meta = {}) => routing(survey,answers,meta).visible;
export function answerError(q, a) {
  if (!a || (a.value === undefined && a.special === undefined)) return q.required ? 'Vui lòng trả lời câu này.' : null;
  if (typeof a !== 'object' || Array.isArray(a)) return 'Câu trả lời không hợp lệ.';
  if (a.special !== undefined) return (q.type === 'slider' || q.type === 'allocation') && Number.isInteger(a.special) && a.special >= 0 && a.special < (q.specials?.length || 0) && a.value === undefined ? null : 'Lựa chọn không hợp lệ.';
  const v = a.value;
  if (q.type === 'single' && (!Number.isInteger(v) || v < 0 || v >= q.options.length)) return 'Vui lòng chọn một đáp án hợp lệ.';
  if (q.type === 'multiple') {
    if (!Array.isArray(v) || v.some(x => !Number.isInteger(x) || x < 0 || x >= q.options.length) || new Set(v).size !== v.length) return 'Lựa chọn không hợp lệ.';
    if (!v.length && q.required) return 'Vui lòng chọn ít nhất một đáp án.';
    if (q.maxChoices && v.length > q.maxChoices) return `Chọn tối đa ${q.maxChoices} đáp án.`;
    if (v.some(x => q.exclusive?.includes(x)) && v.length > 1) return 'Lựa chọn này cần được chọn riêng.';
    if (q.incompatible?.some(pair => pair.every(x => v.includes(x)))) return 'Hai lựa chọn này không thể được chọn cùng nhau.';
  }
  if (q.type === 'slider') {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < q.min || v > (q.expand ? q.cap ?? Number.MAX_SAFE_INTEGER : q.max) || !Number.isSafeInteger(Math.round(v / q.step)) || Math.abs((v - q.min) / q.step - Math.round((v - q.min) / q.step)) > 1e-6) return 'Giá trị thanh kéo không hợp lệ.';
  }
  if (q.type === 'allocation') {
    if (!Array.isArray(v) || v.length !== q.options.length || v.some(x => !Number.isInteger(x) || x < 0 || x > 100 || x % 5) || v.reduce((sum, x) => sum + x, 0) !== 100 || a.confirmed !== true) return 'Phân bổ đủ 100% và xác nhận các tỷ lệ trước khi tiếp tục.';
  }
  if (q.type === 'text' && (typeof v !== 'string' || v.length > 5000 || (q.required && !v.trim()))) return 'Nhập câu trả lời hợp lệ (tối đa 5.000 ký tự).';
  const otherSelected = q.other?.some(i => Array.isArray(v) ? v.includes(i) : v === i);
  if (q.otherRequired && otherSelected && !a.other?.trim()) return 'Vui lòng mô tả nhóm công việc khác.';
  if (a.other !== undefined && (typeof a.other !== 'string' || a.other.length > 1000)) return 'Mô tả thêm tối đa 1.000 ký tự.';
  return null;
}
export function formatValue(q, value) {
  if (q.unit === 'hours') { const minutes = Math.round(Math.abs(value) * 60); return `${value < 0 ? '−' : ''}${Math.floor(minutes / 60)} giờ${minutes % 60 ? ` ${minutes % 60} phút` : ''}`; }
  if (q.unit === 'percent') return `${value}%`;
  if (q.unit === 'days') return `${value} ngày`;
  if (q.unit === 'points') return `${value} điểm`;
  return String(value);
}
export function displayAnswer(q, a) {
  if (!a) return '—';
  if (a.special !== undefined) return q.specials[a.special];
  let text;
  if (q.type === 'single') text = q.options[a.value];
  else if (q.type === 'multiple') text = a.value.map(i => q.options[i]).join(' | ');
  else if (q.type === 'slider') text = formatValue(q, a.value);
  else if (q.type === 'allocation') text = a.value.map((v, i) => `${q.options[i]} ${v}%`).join(' | ');
  else text = a.value;
  return (text || '—') + (a.other ? ` (${a.other})` : '');
}
