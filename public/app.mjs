import { visibleQuestions, eligibility, timeCheck, answerError, formatValue, displayAnswer } from './logic.mjs';
import { editorMarkup, collectEditorForm, blankSurvey, repairReferences, defaultCondition, ruleAt, setRule, operators } from './editor.mjs';
const app = document.querySelector('#app');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = {
  survey: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 2 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 4 4 10-10"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>'
};
const icon = name => `<span class="icon" aria-hidden="true">${icons[name] || icons.survey}</span>`;
const logo = `<span class="brand-mark">${icon('survey')}</span><span>Survey<span class="brand-light">Studio</span></span>`;
const state = { admin: location.pathname === '/admin', auth: null, surveys: [], selected: null, tab: new URLSearchParams(location.search).get('view') === 'account' ? 'account' : 'responses', responsePage: 1, filter: '', survey: null, answers: {}, meta: {}, step: 0, review: false, submitted: false, key: crypto.randomUUID(), rangeMax: {}, allocationDraft: {}, busy: false, editor: null, dirty: false };
async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(state.auth ? { 'X-CSRF-Token': state.auth.csrf } : {}), ...options.headers };
  const response = await fetch(path, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined, credentials: 'same-origin' });
  const value = await response.json();
  if (!response.ok) { const error = new Error(value.error || 'Không thể kết nối.'); error.status = response.status; throw error; }
  return value;
}
let toastTimer;
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 4500); }
function errorBox(message) { return `<div class="error-box" role="alert">${esc(message)}</div>`; }
function date(value) { return new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }); }
function badge(status) { return `<span class="badge ${status}">${{ open: 'Đang nhận', closed: 'Đã đóng', draft: 'Bản nháp' }[status]}</span>`; }
function surveyQuestions() { return visibleQuestions(state.survey, state.answers, state.meta); }
function surveySteps() { return [...new Set(surveyQuestions().map(q => q.section))].sort((a,b) => a-b); }
function renderSurvey() {
  const survey = state.survey, questions = surveyQuestions(), steps = surveySteps();
  const plannedSteps = eligibility(state.answers,survey) === 'pending' ? survey.sections.map((_,i) => i) : steps;
  state.step = Math.min(state.step, steps.length - 1);
  const current = steps[state.step];
  const done = questions.filter(q => state.answers[q.id] && !answerError(q,state.answers[q.id])).length;
  const percent = state.submitted ? 100 : Math.round(done / questions.length * 100);
  const screened = eligibility(state.answers,survey) === 'screened_out';
  document.title = `${survey.title} · Survey Studio`;
  app.innerHTML = `<div class="survey-shell">
    <aside class="survey-aside"><a class="brand" href="/">${logo}</a><div class="study-tag">KHẢO SÁT ${survey.kind === 'genai' ? 'GENAI' : 'TRỰC TUYẾN'}</div><h1>${esc(survey.title)}</h1><p class="aside-description">${esc(survey.description)}</p>
    <nav class="study-steps" aria-label="Các phần khảo sát">${plannedSteps.map((section,i) => `<div class="study-step ${state.step === i && !state.review ? 'active' : i < state.step || state.review ? 'complete' : ''}"><span>${i < state.step || state.review ? icon('check') : String(i + 1).padStart(2,'0')}</span><p>${esc(survey.sections[section])}</p></div>`).join('')}</nav>
    <div class="aside-footer">${icon('lock')}<p>Câu trả lời chỉ hiển thị với quản trị viên khảo sát.</p></div></aside>
    <main class="survey-main"><header class="survey-topbar"><span>BIỂU MẪU KHẢO SÁT</span><span>Không cần tài khoản</span></header>
    <div class="survey-content"><div class="progress-meta"><span>${state.review ? 'Kiểm tra trước khi gửi' : `Phần ${state.step + 1} / ${plannedSteps.length}`}</span><span>${percent}% câu đang hiển thị</span></div><progress value="${percent}" max="100" aria-label="Tiến độ các câu đang hiển thị"></progress>
    ${state.submitted ? `<div class="success-panel"><div class="success-icon">${icon('check')}</div><p class="eyebrow">ĐÃ GỬI THÀNH CÔNG</p><h2>Cảm ơn bạn đã tham gia.</h2><p>Câu trả lời của bạn đã được ghi nhận${screened ? ' ở phần xác định nhóm người tham gia' : ''}.</p><div class="receipt">Mã xác nhận <strong>${esc(state.receipt?.slice(0,8))}</strong></div><p class="muted">Bạn có thể đóng trang này.</p></div>` : state.review ? renderReview(questions) : `
      <div class="section-heading"><p class="eyebrow">PHẦN ${String(state.step+1).padStart(2,'0')}</p><h2>${esc(survey.sections[current])}</h2>${state.step === 0 && survey.introduction ? `<p>${esc(survey.introduction)}</p>` : ''}<span class="required-note">Các câu có dấu <span>*</span> cần được trả lời.</span></div>
      <div id="question-list">${questions.filter(q => q.section === current).map(renderQuestion).join('')}</div>
      ${survey.analysis && questions.some(q=>q.section===current&&[survey.analysis.actual,survey.analysis.hypothetical,survey.analysis.direction].includes(q.id)) ? renderTimeCheck() : ''}
      ${screened ? `<div class="notice">Cảm ơn bạn. Nhóm của bạn hiện nằm ngoài phạm vi khảo sát này. Bạn có thể gửi phần xác định nhóm người tham gia và kết thúc.</div>` : ''}
      <div id="survey-error"></div><div class="survey-actions"><button class="button secondary" data-action="back" ${state.step === 0 ? 'disabled' : ''}>Quay lại</button><span>${questions.filter(q => q.section === current).length} câu trong phần này</span><button class="button primary" data-action="next">${screened ? 'Kiểm tra và kết thúc' : state.step === plannedSteps.length - 1 ? 'Kiểm tra câu trả lời' : 'Tiếp tục'}</button></div>`}
    <footer class="survey-footer"><span>Survey Studio</span><span>Câu trả lời chưa được gửi sẽ mất khi đóng trang.</span></footer></div></main></div>`;
}
function renderQuestion(q) {
  const a = state.answers[q.id];
  let field = '';
  if (q.type === 'single' || q.type === 'multiple') {
    field = `<div class="options">${q.options.map((option,i) => {
      const checked = q.type === 'single' ? a?.value === i : a?.value?.includes(i);
      return `<label class="option ${checked ? 'selected' : ''}"><input type="${q.type === 'single' ? 'radio' : 'checkbox'}" name="${esc(q.id)}" data-question="${esc(q.id)}" data-choice="${i}" ${checked ? 'checked' : ''}><span>${esc(option)}</span></label>`;
    }).join('')}</div>`;
  }
  if (q.type === 'slider') {
    const max = state.rangeMax[q.id] || q.max;
    const selected = typeof a?.value === 'number';
    field = `<div class="slider-box ${selected ? 'answered' : ''}"><div class="slider-reading" id="reading-${q.id}">${selected ? esc(formatValue(q,a.value)) : '<span>Chưa chọn giá trị</span>'}</div><input class="range" aria-label="${esc(q.title)}" type="range" min="${q.min}" max="${max}" step="${q.step}" value="${selected ? a.value : q.min}" data-question="${q.id}" data-range="true"><div class="range-labels"><span>${esc(formatValue(q,q.min))}</span>${q.unit === 'index' ? '<span>Mốc trước AI = 100</span>' : ''}<span id="max-${q.id}">${esc(formatValue(q,max))}</span></div><div class="range-tools"><button class="text-button" data-action="choose-min" data-id="${q.id}">Chọn ${esc(formatValue(q,q.min))}</button>${q.expand && (q.cap === null || max < q.cap) ? `<button class="text-button" data-action="expand" data-id="${q.id}">${q.unit === 'index' ? 'Mở rộng thang' : 'Mở rộng khoảng giờ'}</button>` : ''}</div></div>`;
  }
  if (q.type === 'allocation') {
    const values = state.allocationDraft[q.id] || a?.value || q.options.map(() => 0);
    const total = values.reduce((s,v) => s+v,0);
    field = `<div class="allocation-summary" id="allocation-summary-${q.id}">Đã phân bổ <strong>${total}%</strong> · ${total > 100 ? `Vượt ${total-100}%` : `Còn ${100-total}%`}</div><div class="allocation-list">${q.options.map((option,i) => `<div class="allocation-item"><div><label for="alloc-${q.id}-${i}">${i+1}. ${esc(option)}</label><strong id="alloc-value-${q.id}-${i}">${values[i]}%</strong></div><input id="alloc-${q.id}-${i}" type="range" min="0" max="100" step="5" value="${values[i]}" data-question="${q.id}" data-allocation="${i}" aria-label="${esc(option)}"></div>`).join('')}</div><label class="allocation-confirm"><input type="checkbox" data-question="${q.id}" data-confirm="true" ${a?.confirmed ? 'checked' : ''}>Tôi xác nhận các tỷ lệ trên, bao gồm các nhóm 0%.</label>`;
  }
  if (q.type === 'text') field = `<textarea rows="4" maxlength="5000" placeholder="Câu trả lời của bạn…" data-question="${q.id}" data-text="true">${esc(a?.value || '')}</textarea>`;
  if (q.specials?.length) field += `<div class="specials">${q.specials.map((special,i) => `<label class="option compact ${a?.special === i ? 'selected' : ''}"><input type="radio" name="${q.id}-special" data-question="${q.id}" data-special="${i}" ${a?.special === i ? 'checked' : ''}><span>${esc(special)}</span></label>`).join('')}</div>`;
  const showOther = q.type === 'allocation' ? a?.special === undefined : q.other?.some(i => Array.isArray(a?.value) ? a.value.includes(i) : a?.value === i);
  if (q.other?.length && showOther) field += `<input type="text" class="other-input" placeholder="Mô tả thêm${q.otherRequired ? ' (bắt buộc)' : ' (tùy chọn)'}" aria-label="Mô tả thêm cho ${q.id}" maxlength="1000" data-question="${q.id}" data-other="true" value="${esc(a?.other || '')}">`;
  return `<section class="question-card" id="card-${q.id}" aria-labelledby="title-${q.id}"><div class="question-code">${esc(q.id.replace('_','.'))}<span>${q.required ? 'Bắt buộc' : 'Tùy chọn'}</span></div><h3 id="title-${q.id}">${esc(q.title)}${q.required ? ' <span class="asterisk">*</span>' : ''}</h3>${q.help ? `<p class="question-help">${esc(q.help)}</p>` : ''}${q.type === 'multiple' && q.maxChoices ? `<p class="choice-limit">Chọn tối đa ${q.maxChoices} đáp án</p>` : ''}${field}<div class="field-error" id="error-${q.id}" role="alert"></div></section>`;
}
function renderTimeCheck() {
  const a = state.survey.analysis, check = timeCheck(state.answers,a);
  if (!check.conflict) return '';
  return `<section class="notice"><h3>Kiểm tra lại hướng thay đổi thời gian</h3><p>${esc(a.hypothetical)} − ${esc(a.actual)} = ${esc(formatValue({unit:'hours'},check.delta))}/tuần, nhưng ${esc(a.direction)} đang thể hiện hướng khác. Bạn có thể quay lại sửa hoặc giữ các câu trả lời và chọn cơ sở cho phần phân bổ thời gian.</p><label class="option"><input type="radio" name="time-basis" data-time-basis="numeric" ${state.meta.timeBasis === 'numeric' ? 'checked' : ''}><span>Dùng hướng tính từ ${esc(a.actual)}–${esc(a.hypothetical)}.</span></label><label class="option"><input type="radio" name="time-basis" data-time-basis="reported" ${state.meta.timeBasis === 'reported' ? 'checked' : ''}><span>Dùng hướng trải nghiệm đã chọn ở ${esc(a.direction)}.</span></label><p class="muted">Các giá trị gốc vẫn được giữ để quản trị viên rà soát.</p></section>`;
}
function renderReview(questions) {
  return `<div class="section-heading"><p class="eyebrow">TRƯỚC KHI GỬI</p><h2>Kiểm tra câu trả lời</h2><p>Bạn có thể quay lại để sửa. Khi gửi, câu trả lời sẽ được lưu cho quản trị viên khảo sát.</p></div><div class="review-list">${questions.map(q => `<div><span>${esc(q.id)}</span><section><h3>${esc(q.title)}</h3><p>${esc(displayAnswer(q,state.answers[q.id]))}</p></section></div>`).join('')}</div><div id="survey-error"></div><div class="survey-actions"><button class="button secondary" data-action="edit-answers">Quay lại sửa</button><button class="button primary" data-action="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Đang gửi…' : 'Gửi câu trả lời'}</button></div>`;
}
function showSurveyErrors(questions) {
  let first;
  for (const q of questions) {
    const message = answerError(q,state.answers[q.id]);
    const el = document.getElementById(`error-${q.id}`);
    if (el) el.textContent = message || '';
    if (message && !first) first = q.id;
  }
  if (first) { document.getElementById(`card-${first}`)?.scrollIntoView({behavior:'smooth',block:'center'}); return false; }
  if (state.survey.analysis && timeCheck(state.answers,state.survey.analysis).conflict && !state.meta.timeBasis) { document.querySelector('#survey-error').innerHTML = errorBox('Vui lòng xác nhận hướng thay đổi thời gian ở phần kiểm tra.'); return false; }
  return true;
}
function rerenderWithFocus(target) {
  const selector = target?.dataset.choice !== undefined ? `[data-question="${target.dataset.question}"][data-choice="${target.dataset.choice}"]` : target?.dataset.special !== undefined ? `[data-question="${target.dataset.question}"][data-special="${target.dataset.special}"]` : null;
  renderSurvey(); if (selector) app.querySelector(selector)?.focus({preventScroll:true});
}
function clearStaleAnswers() {
  const allowed = new Set(surveyQuestions().map(q => q.id));
  for (const id of Object.keys(state.answers)) if (!allowed.has(id)) { delete state.answers[id]; delete state.allocationDraft[id]; }
}
function changeAnswer(target) {
  if (target.dataset.timeBasis) { state.meta.timeBasis = target.dataset.timeBasis; clearStaleAnswers(); renderSurvey(); return; }
  const id = target.dataset.question, q = state.survey?.questions.find(x => x.id === id);
  if (!q) return;
  state.dirty = true;
  const old = state.answers[id] || {};
  if (target.dataset.choice !== undefined) {
    const index = Number(target.dataset.choice);
    if (q.type === 'single') state.answers[id] = { value: index, ...(q.other?.includes(index) && old.other ? {other:old.other} : {}) };
    else {
      let values = old.value || [];
      if (target.checked) values = q.exclusive?.includes(index) ? [index] : [...values.filter(v => !q.exclusive?.includes(v)), index];
      else values = values.filter(v => v !== index);
      state.answers[id] = { value: values, ...(old.other ? {other:old.other} : {}) };
    }
    resetTimeConfirmation(id);
    clearStaleAnswers(); rerenderWithFocus(target);
  } else if (target.dataset.special !== undefined) {
    state.answers[id] = { special: Number(target.dataset.special) };
    resetTimeConfirmation(id);
    clearStaleAnswers(); rerenderWithFocus(target);
  } else if (target.dataset.confirm) {
    const values = state.allocationDraft[id] || old.value || q.options.map(() => 0);
    state.answers[id] = { value: [...values], confirmed: target.checked, ...(old.other ? {other:old.other} : {}) };
    const error = answerError(q,state.answers[id]); document.getElementById(`error-${id}`).textContent = error || '';
  }
}
function inputAnswer(target) {
  const id = target.dataset.question, q = state.survey?.questions.find(x => x.id === id);
  if (!q) return;
  state.dirty = true;
  if (target.dataset.range) {
    const specialBefore = state.answers[id]?.special !== undefined;
    state.answers[id] = { value: Number(target.value) };
    resetTimeConfirmation(id);
    document.getElementById(`reading-${id}`).textContent = formatValue(q,Number(target.value));
    target.closest('.slider-box').classList.add('answered');
    document.querySelectorAll(`[data-question="${id}"][data-special]`).forEach(el => { el.checked = false; el.closest('.option').classList.remove('selected'); });
    if (specialBefore && q.other?.length) rerenderWithFocus(target);
  } else if (target.dataset.allocation !== undefined) {
    const values = [...(state.allocationDraft[id] || state.answers[id]?.value || q.options.map(() => 0))];
    values[Number(target.dataset.allocation)] = Number(target.value); state.allocationDraft[id] = values;
    state.answers[id] = { value: values, confirmed: false, ...(state.answers[id]?.other ? {other:state.answers[id].other} : {}) };
    document.querySelector(`[data-question="${id}"][data-confirm]`).checked = false;
    document.querySelectorAll(`[data-question="${id}"][data-special]`).forEach(el => { el.checked = false; el.closest('.option').classList.remove('selected'); });
    document.getElementById(`alloc-value-${id}-${target.dataset.allocation}`).textContent = `${target.value}%`;
    const total = values.reduce((s,v) => s+v,0);
    document.getElementById(`allocation-summary-${id}`).innerHTML = `Đã phân bổ <strong>${total}%</strong> · ${total > 100 ? `Vượt ${total-100}%` : `Còn ${100-total}%`}`;
  } else if (target.dataset.other) {
    state.answers[id] = { ...(state.answers[id] || {}), other: target.value };
  } else if (target.dataset.text) state.answers[id] = { value: target.value };
}
function renderLogin(error = '') {
  document.title = 'Đăng nhập quản trị · Survey Studio';
  app.innerHTML = `<main class="login-page"><div class="login-brand brand">${logo}</div><div class="login-card"><div class="login-icon">${icon('lock')}</div><p class="eyebrow">KHÔNG GIAN QUẢN TRỊ</p><h1>Chào mừng trở lại.</h1><p>Đăng nhập để quản lý khảo sát và xem câu trả lời.</p><form id="login-form"><label>Tên đăng nhập<input name="username" autocomplete="username" required placeholder="Tên tài khoản"></label><label>Mật khẩu<input type="password" name="password" autocomplete="current-password" required placeholder="Nhập mật khẩu"></label><div id="login-error">${error ? errorBox(error) : ''}</div><button class="button primary full" type="submit">Đăng nhập</button></form><div class="login-note">${icon('lock')}<span>Dữ liệu khảo sát được bảo vệ bằng tài khoản quản trị.</span></div></div><a class="back-survey" href="/s/genai">Về trang khảo sát</a></main>`;
}
async function loadAdmin() {
  const [surveys,preset]=await Promise.all([api('/api/admin/surveys'),state.defaultTemplate?Promise.resolve(state.defaultTemplate):api('/api/admin/templates/genai')]);
  state.surveys=surveys;state.defaultTemplate=preset;
  if (!state.selected || !state.surveys.some(x => x.id === state.selected)) state.selected = state.surveys[0]?.id;
  renderAdmin();
}
function renderAdmin() {
  const survey = state.surveys.find(x => x.id === state.selected);
  const total = state.surveys.reduce((sum,s) => sum+s.total,0);
  const open = state.surveys.filter(s => s.status === 'open').length;
  document.title = 'Quản lý khảo sát · Survey Studio';
  app.innerHTML = `<div class="admin-shell"><aside class="admin-sidebar"><a class="brand" href="/admin">${logo}</a><p class="sidebar-caption">KHÔNG GIAN LÀM VIỆC</p><button class="nav-item ${state.tab !== 'account' ? 'active' : ''}" data-action="dashboard">${icon('grid')}<span>Khảo sát của tôi</span><span class="nav-count">${state.surveys.length}</span></button><button class="nav-item ${state.tab === 'account' ? 'active' : ''}" data-action="account">${icon('lock')}<span>Tài khoản</span></button><div class="sidebar-bottom"><div class="private-note">${icon('lock')}<div><strong>Chỉ dành cho admin</strong><p>Câu trả lời không được hiển thị trên link khảo sát.</p></div></div><div class="user-row"><span class="avatar">A</span><div><strong>${esc(state.auth.username)}</strong><small>Quản trị viên</small></div><button class="text-button" data-action="logout">Đăng xuất</button></div></div></aside>
    <main class="admin-main"><header class="admin-topbar"><span>Không gian quản trị <b>/</b> ${state.tab === 'account' ? 'Tài khoản' : 'Khảo sát'}</span><span class="private-label">${icon('lock')}Riêng tư</span></header><div class="admin-content">${state.tab === 'account' ? renderAccount() : `<div class="page-heading"><div><p class="eyebrow">TỔNG QUAN</p><h1>Khảo sát của tôi</h1><p>Tạo biểu mẫu, chia sẻ link và quản lý câu trả lời.</p></div><button class="button primary" data-action="new-survey">${icon('plus')}Tạo khảo sát</button></div>
    <div class="stats"><article><span>Tổng câu trả lời</span><strong>${total.toLocaleString('vi-VN')}</strong><p>Trên tất cả khảo sát</p></article><article><span>Khảo sát đang nhận</span><strong>${String(open).padStart(2,'0')}</strong><p>Sẵn sàng nhận câu trả lời</p></article><article class="privacy-stat"><span>Quyền truy cập dữ liệu</span><strong>${icon('lock')}Chỉ admin</strong><p>Người trả lời không cần đăng nhập</p></article></div>
    <section class="survey-table-panel"><div class="panel-heading"><h2>Danh sách khảo sát</h2><span>${state.surveys.length} khảo sát</span></div><div class="table-scroll"><table class="surveys-table"><thead><tr><th>TÊN KHẢO SÁT</th><th>TRẠNG THÁI</th><th>CÂU TRẢ LỜI</th><th>THAO TÁC</th></tr></thead><tbody>${state.surveys.map(s => `<tr class="${s.id === state.selected ? 'selected-row' : ''}"><td><button class="survey-title-button" data-action="select-survey" data-id="${s.id}"><span class="table-icon">${icon('survey')}</span><span><strong>${esc(s.title)}</strong><small>/s/${esc(s.slug)}</small></span></button></td><td>${badge(s.status)}</td><td><strong>${s.total}</strong><small class="table-subtext">${s.eligible} đủ điều kiện</small></td><td><button class="text-button" data-action="copy-link" data-id="${s.id}">${icon('link')}Sao chép link</button></td></tr>`).join('')}</tbody></table></div></section>
    ${survey ? `<section class="detail-panel"><div class="detail-header"><div><p class="eyebrow">KHẢO SÁT ĐANG CHỌN</p><h2>${esc(survey.title)}</h2></div><a class="button secondary" href="/s/${survey.slug}" target="_blank" rel="noopener">Xem biểu mẫu</a></div><div class="detail-toolbar"><div class="tabs"><button class="tab ${state.tab === 'responses' ? 'active' : ''}" data-action="responses">Câu trả lời <span>${survey.total}</span></button><button class="tab ${state.tab === 'content' ? 'active' : ''}" data-action="content">Nội dung & cài đặt</button></div><a class="button secondary small" href="/api/admin/surveys/${survey.id}/export">${icon('download')}Xuất CSV / Excel</a></div><div id="detail-content">${state.tab === 'content' ? renderSurveySettings(survey) : '<div class="loading">Đang tải câu trả lời…</div>'}</div></section>` : ''}`}</div></main></div><dialog id="modal"></dialog>`;
  const topbar=app.querySelector('.admin-topbar');
  const accountActions=document.createElement('div');accountActions.className='admin-account-actions';
  const accountLink=document.createElement('a');accountLink.className='button secondary small';accountLink.href='/admin?view=account';accountLink.textContent='Đổi mật khẩu';
  accountActions.append(accountLink,topbar.querySelector('.private-label'));topbar.append(accountActions);
  if (state.tab === 'responses' && survey) void loadResponses();
}
function renderAccount() {
  return `<div class="page-heading"><div><p class="eyebrow">BẢO VỆ TÀI KHOẢN</p><h1>Tài khoản quản trị</h1><p>Đổi mật khẩu để bảo vệ dữ liệu khảo sát của bạn.</p></div></div><section class="account-card"><h2>Đổi mật khẩu</h2><form id="password-form"><label>Mật khẩu hiện tại<input type="password" name="current" autocomplete="current-password" maxlength="256" required></label><label>Mật khẩu mới<input type="password" name="password" aria-label="Mật khẩu mới" aria-describedby="new-password-help" autocomplete="new-password" minlength="12" maxlength="256" required><small id="new-password-help">Tối thiểu 12 ký tự.</small></label><label>Nhập lại mật khẩu mới<input type="password" name="confirm" autocomplete="new-password" minlength="12" maxlength="256" required></label><label class="inline-checkbox password-visibility"><input type="checkbox" id="show-passwords">Hiện mật khẩu</label><div id="password-error"></div><div id="password-success" role="status" aria-live="polite"></div><button class="button primary" type="submit">Cập nhật mật khẩu</button></form></section>`;
}
function renderSurveySettings(survey) {
  return `<div class="settings-grid"><div><h3>Nội dung biểu mẫu</h3><p>${survey.questions.length} câu hỏi · ${survey.sections.length} phần</p><p class="muted">Bạn có thể thêm, xóa, đổi loại, sắp xếp và chỉnh điều kiện hiển thị của mọi câu hỏi.</p><button class="button secondary" data-action="edit-survey">Chỉnh sửa khảo sát</button> <a class="text-button" href="/api/admin/surveys/${survey.id}/schema">Tải mẫu JSON</a></div><div><h3>Nhận câu trả lời</h3><p>${badge(survey.status)}</p><label>Trạng thái<select id="status-select"><option value="draft" ${survey.status === 'draft' ? 'selected' : ''}>Bản nháp</option><option value="open" ${survey.status === 'open' ? 'selected' : ''}>Đang nhận câu trả lời</option><option value="closed" ${survey.status === 'closed' ? 'selected' : ''}>Đã đóng</option></select></label><button class="button primary small" data-action="save-status">Lưu trạng thái</button><p class="muted">Khi đóng hoặc ở bản nháp, link sẽ ngừng nhận câu trả lời.</p></div></div>`;
}
let responseRequest = 0;
async function loadResponses() {
  const request = ++responseRequest;
  const selected = state.selected;
  try {
    const data = await api(`/api/admin/surveys/${selected}/responses?page=${state.responsePage}&outcome=${state.filter}`);
    if (request !== responseRequest || selected !== state.selected || state.tab !== 'responses') return;
    state.responseData = data;
    const el = document.querySelector('#detail-content'); if (!el) return;
    el.innerHTML = `<div class="responses-filter"><span>${data.total} câu trả lời${state.filter ? ' trong bộ lọc' : ''}</span><label>Lọc <select id="response-filter"><option value="">Tất cả</option><option value="eligible" ${state.filter === 'eligible' ? 'selected' : ''}>Đủ điều kiện</option><option value="screened_out" ${state.filter === 'screened_out' ? 'selected' : ''}>Ngoài phạm vi</option></select></label></div>${!data.total ? `<div class="empty-state"><div>${icon('survey')}</div><h3>${state.filter ? 'Chưa có câu trả lời phù hợp' : 'Chưa có câu trả lời'}</h3><p>Sao chép link khảo sát để bắt đầu thu thập.</p><button class="button secondary" data-action="copy-link" data-id="${selected}">${icon('link')}Sao chép link khảo sát</button></div>` : `<div class="table-scroll"><table class="responses-table"><thead><tr><th>MÃ TRẢ LỜI</th><th>THỜI GIAN GỬI</th><th>NHÓM THAM GIA</th><th>RÀ SOÁT</th><th></th></tr></thead><tbody>${data.responses.map(r => `<tr><td><span class="mono">${esc(r.id.slice(0,8))}</span></td><td>${date(r.createdAt)}</td><td><span class="badge ${r.outcome === 'eligible' ? 'neutral' : 'draft'}">${r.outcome === 'eligible' ? 'Đủ điều kiện' : 'Ngoài phạm vi'}</span></td><td>${r.meta.timeConflict || r.meta.jobOtherReview ? '<span class="review-flag">Cần rà soát</span>' : '<span class="muted">—</span>'}</td><td><button class="text-button" data-action="response-detail" data-id="${r.id}">Xem chi tiết</button></td></tr>`).join('')}</tbody></table></div><div class="pagination"><span>Trang ${data.page} / ${data.pages}</span><div><button class="button secondary small" data-action="prev-page" ${data.page <= 1 ? 'disabled' : ''}>Trước</button><button class="button secondary small" data-action="next-page" ${data.page >= data.pages ? 'disabled' : ''}>Sau</button></div></div>`}`;
  } catch (error) { if (error.status === 401) { state.auth=null; renderLogin('Phiên đăng nhập đã hết hạn.'); } else document.querySelector('#detail-content')?.replaceChildren(Object.assign(document.createElement('p'),{textContent:error.message})); }
}
function modal(content, className = '') { const el = document.querySelector('#modal'); el.className = className; el.innerHTML = content; el.showModal(); }
function showResponse(id) {
  const r = state.responseData.responses.find(x => x.id === id);
  modal(`<div class="modal-header"><div><p class="eyebrow">CÂU TRẢ LỜI ${esc(r.id.slice(0,8))}</p><h2>Chi tiết câu trả lời</h2><p>${date(r.createdAt)} · Phiên bản ${r.version}</p></div><button class="button secondary small" data-action="close-modal">Đóng</button></div>${r.meta.timeConflict ? '<div class="notice">Có khác biệt giữa chênh lệch Q10–Q11 và Q12. Cơ sở người trả lời chọn: ' + (r.meta.timeBasis === 'numeric' ? 'Q10–Q11' : 'Q12') + '.</div>' : ''}${r.meta.jobOtherReview ? '<div class="notice">Nhóm công việc “khác” cần được rà soát theo quy tắc phân loại của nghiên cứu.</div>' : ''}<div class="review-list">${r.snapshot.questions.filter(q => r.answers[q.id]).map(q => `<div><span>${esc(q.id)}</span><section><h3>${esc(q.title)}</h3><p>${esc(displayAnswer(q,r.answers[q.id]))}</p></section></div>`).join('')}</div>`, 'response-modal');
}
async function newSurvey() {
  const preset=structuredClone(state.defaultTemplate);
  state.editor={...preset,title:'Khảo sát mới',slug:'khao-sat-'+Date.now().toString(36),status:'draft'};
  state.editorWarnings=[];openEditor();
}
function openEditor() {
  const dialog=document.querySelector('#modal'),scroll=dialog.scrollTop;
  const opened=[...dialog.querySelectorAll('details[data-detail][open]')].map(el=>el.dataset.detail);
  modal(editorMarkup(state.editor,state.editorWarnings||[]),'editor-modal');
  for(const el of dialog.querySelectorAll('details[data-detail]'))if(opened.includes(el.dataset.detail))el.open=true;
  dialog.scrollTop=scroll;
}
function collectEditor() {
  const form=document.querySelector('#editor-form');if(form)collectEditorForm(state.editor,form);
}
function repairEditor() {
  const warnings=repairReferences(state.editor);
  state.editorWarnings=[...new Set([...(state.editorWarnings||[]),...warnings])];
  if(warnings.length)toast('Đã cập nhật các điều kiện liên quan. Xem ghi chú trong trình soạn.');
}
function resetTimeConfirmation(id) {
  const a=state.survey?.analysis;
  if(a&&[a.actual,a.hypothetical,a.direction].includes(id))delete state.meta.timeBasis;
}
async function adminAction(action,target) {
  if(action==='restore-default'||action==='blank-questions'){
    collectEditor();
    const preset=action==='restore-default'?structuredClone(state.defaultTemplate):blankSurvey();
    Object.assign(state.editor,{questions:structuredClone(preset.questions),sections:[...preset.sections],analysis:structuredClone(preset.analysis),kind:preset.kind,routingVersion:1});
    state.editorWarnings=[];openEditor();toast('Đã thay bộ câu hỏi trong bản đang soạn. Bấm Lưu khảo sát để áp dụng.');
  }
  if(['add-rule','add-rule-group','remove-rule'].includes(action)){
    collectEditor();const q=state.editor.questions[Number(target.closest('.editor-question').dataset.index)],path=target.dataset.path||'';
    if(action==='remove-rule')setRule(q,path,null);
    else{
      const child=defaultCondition(state.editor,q.id),addition=action==='add-rule-group'?{any:[child]}:child,node=q.showWhen?ruleAt(q,path):null;
      if(node?.all||node?.any)(node.all||node.any).push(addition);
      else setRule(q,path,node?{all:[node,addition]}:addition);
    }
    openEditor();document.querySelector(`[data-detail="${q.id}-conditions"]`).open=true;
  }
  if (action === 'logout') { await api('/api/auth/logout',{method:'POST',body:{}}); state.auth=null; renderLogin(); }
  if (action === 'dashboard') { state.tab='responses'; renderAdmin(); }
  if (action === 'account') { state.tab='account'; renderAdmin(); }
  if (action === 'select-survey') { state.selected=target.dataset.id; state.tab='responses'; state.responsePage=1; state.filter=''; renderAdmin(); }
  if (action === 'copy-link') {
    const survey=state.surveys.find(s=>s.id===target.dataset.id);
    const url=`${location.origin}/s/${survey.slug}`;
    try { await navigator.clipboard.writeText(url); toast('Đã sao chép link khảo sát.'); } catch { modal(`<div class="modal-header"><h2>Link khảo sát</h2><button class="button secondary" data-action="close-modal">Đóng</button></div><input readonly value="${esc(url)}" aria-label="Link khảo sát">`); }
  }
  if (action === 'responses' || action === 'content') { state.tab=action; renderAdmin(); }
  if (action === 'save-status') {
    const survey=state.surveys.find(s=>s.id===state.selected);
    await api(`/api/admin/surveys/${survey.id}`,{method:'PUT',body:{...survey,status:document.querySelector('#status-select').value}}); await loadAdmin(); toast('Đã cập nhật trạng thái khảo sát.');
  }
  if (action === 'prev-page' || action === 'next-page') { state.responsePage += action === 'prev-page' ? -1 : 1; await loadResponses(); }
  if (action === 'response-detail') showResponse(target.dataset.id);
  if (action === 'close-modal') document.querySelector('#modal').close();
  if (action === 'new-survey') await newSurvey();
  if (action === 'edit-survey') { state.editor=structuredClone(state.surveys.find(x=>x.id===state.selected));state.editorWarnings=[]; openEditor(); }
  if (action === 'close-editor') { document.querySelector('#modal').close(); state.editor=null; }
  if (action === 'add-question') {
    collectEditor();
    if (!state.editor.sections.length) state.editor.sections=['Nội dung khảo sát'];
    let n=state.editor.questions.length+1; while(state.editor.questions.some(q=>q.id===`Q${String(n).padStart(2,'0')}`)) n++;
    state.editor.questions.push({id:`Q${String(n).padStart(2,'0')}`,section:0,type:'single',title:'Câu hỏi mới',help:'',required:true,options:['Lựa chọn 1','Lựa chọn 2']}); openEditor();
    document.querySelector('.editor-question:last-child')?.scrollIntoView({behavior:'smooth'});
  }
  if (['remove-question','move-up','move-down'].includes(action)) {
    collectEditor(); const i=Number(target.dataset.index), list=state.editor.questions;
    if (action === 'remove-question') { if (list.length===1) return toast('Cần giữ ít nhất một câu hỏi.'); list.splice(i,1);repairEditor(); }
    else { const j=i+(action==='move-up'?-1:1); [list[i],list[j]]=[list[j],list[i]]; } openEditor();
  }
}
app.addEventListener('click', async event => {
  const target=event.target.closest('[data-action]'); if (!target || target.disabled) return;
  const action=target.dataset.action;
  try {
    if (state.admin) return await adminAction(action,target);
    if (action==='back') { state.step--; renderSurvey(); window.scrollTo({top:0,behavior:'smooth'}); }
    if (action==='next') {
      clearStaleAnswers(); const questions=surveyQuestions(), steps=surveySteps();
      if (!showSurveyErrors(questions.filter(q=>q.section===steps[state.step]))) return;
      if (state.step===steps.length-1 || eligibility(state.answers,state.survey)==='screened_out') state.review=true;
      else state.step++;
      renderSurvey(); window.scrollTo({top:0,behavior:'smooth'});
    }
    if (action==='edit-answers') { state.review=false; state.step=0; renderSurvey(); window.scrollTo({top:0,behavior:'smooth'}); }
    if (action==='choose-min') {
      const q=state.survey.questions.find(q=>q.id===target.dataset.id); state.answers[q.id]={value:q.min}; state.dirty=true;
      resetTimeConfirmation(q.id);
      clearStaleAnswers(); renderSurvey();
    }
    if (action==='expand') {
      const q=state.survey.questions.find(q=>q.id===target.dataset.id);
      state.rangeMax[q.id]=Math.min((state.rangeMax[q.id]||q.max)+q.expand,q.cap??Number.MAX_SAFE_INTEGER); renderSurvey();
    }
    if (action==='submit') {
      if (state.busy) return;
      state.busy=true; renderSurvey();
      try { const result=await api(`/api/public/surveys/${state.survey.slug}/responses`,{method:'POST',body:{version:state.survey.version,answers:state.answers,meta:state.meta,submissionKey:state.key}}); state.submitted=true; state.receipt=result.receipt; state.dirty=false; }
      finally { state.busy=false; renderSurvey(); }
    }
  } catch(error) {
    if (error.status===401 && state.admin) {state.auth=null;return renderLogin('Vui lòng đăng nhập lại.');}
    const el=document.querySelector('#survey-error'); if (el) el.innerHTML=errorBox(error.message); else toast(error.message);
  }
});
app.addEventListener('input',event=>{if(!state.admin)inputAnswer(event.target);});
app.addEventListener('change', async event => {
  const target=event.target;
  if (!state.admin) {
    if (target.dataset.range) { inputAnswer(target); clearStaleAnswers(); renderSurvey(); app.querySelector(`[data-question="${target.dataset.question}"][data-range]`)?.focus({preventScroll:true}); }
    else changeAnswer(target);
    return;
  }
  if (target.id==='response-filter') {state.filter=target.value;state.responsePage=1;await loadResponses();}
  if(target.id==='show-passwords')document.querySelectorAll('#password-form input[name]').forEach(input=>{input.type=target.checked?'text':'password';});
  if(target.id==='question-jump'&&target.value!=='')document.querySelector(`.editor-question[data-index="${Number(target.value)}"]`)?.scrollIntoView({behavior:'smooth',block:'start'});
  if (target.name==='sections' && state.editor) {
    collectEditor(); if(!state.editor.sections.length)state.editor.sections=['Nội dung khảo sát'];
    for(const q of state.editor.questions) q.section=Math.min(q.section,state.editor.sections.length-1);
    openEditor();
  }
  if(target.dataset.ruleField){
    collectEditor();const q=state.editor.questions[Number(target.closest('.editor-question').dataset.index)],path=target.dataset.path||'',node=ruleAt(q,path),field=target.dataset.ruleField;
    if(field==='mode'){const children=node.all||node.any;setRule(q,path,{[target.value]:children});}
    if(field==='source'){
      if(target.value.startsWith('__'))setRule(q,path,{context:target.value.slice(2)});
      else{const source=state.editor.questions.find(q=>q.id===target.value);setRule(q,path,{question:source.id,op:operators(source)[0],...(source.type==='allocation'?{}:{value:source.type==='text'?'':0})});}
    }
    if(field==='op'){node.op=target.value;const source=state.editor.questions.find(q=>q.id===node.question);if(node.op==='answered')delete node.value;else node.value=source.type==='text'?'':0;}
    if(field==='value'){const source=state.editor.questions.find(q=>q.id===node.question);node.value=source.type==='text'&&node.op!=='special'?target.value:Number(target.value);}
    openEditor();
  }
  if(target.id==='analysis-enabled'){
    collectEditor();
    if(target.checked){
      const hours=state.editor.questions.filter(q=>q.type==='slider'&&q.unit==='hours'),direction=state.editor.questions.find(q=>q.type==='single'&&q.options.length>=4);
      if(hours.length<2||!direction){target.checked=false;return toast('Cần hai thanh kéo đơn vị giờ và một câu chọn ít nhất bốn đáp án.');}
      state.editor.analysis={actual:hours[0].id,hypothetical:hours[1].id,direction:direction.id,savingChoice:0,unchangedChoice:1,slowerChoice:2,unknownChoice:3,allocation:null};
    }else{state.editor.analysis=null;repairEditor();}
    openEditor();
  }
  if(target.dataset.analysis){collectEditor();repairEditor();openEditor();}
  if(['options','specials'].includes(target.dataset.prop)){collectEditor();repairEditor();}
  if(target.dataset.prop==='unit'){collectEditor();repairEditor();openEditor();}
  if (target.dataset.prop==='type') {
    const index=Number(target.closest('.editor-question').dataset.index);
    collectEditor(); const old=state.editor.questions[index], type=target.value;
    state.editor.questions[index]={id:old.id,section:old.section,title:old.title,help:old.help,required:old.required,showWhen:old.showWhen,type,...(['single','multiple','allocation'].includes(type)?{options:old.options||['Lựa chọn 1','Lựa chọn 2'],...(type==='allocation'?{specials:[]}:{} )} : type==='slider'?{min:0,max:100,step:1,unit:'index',specials:[]}:{})};repairEditor(); openEditor();
  }
  if (target.id==='import-json') {
    try { const file=target.files[0]; if (!file) return; if(file.size>512*1024)throw new Error('Mẫu tối đa 512 KB.'); const input=JSON.parse(await file.text());
      
      if(!Array.isArray(input.questions)||!Array.isArray(input.sections))throw new Error('Mẫu cần có sections và questions.');
      state.editor={...input,id:state.editor.id,version:state.editor.version,slug:state.editor.slug,kind:input.kind||'generic',routingVersion:1,status:'draft'};state.editorWarnings=[];repairEditor(); openEditor(); toast('Đã nhập mẫu. Kiểm tra rồi lưu khảo sát.');
    }catch(error){toast(error.message);}
  }
});
app.addEventListener('submit', async event => {
  event.preventDefault(); const form=event.target, submit=form.querySelector('[type="submit"]');
  if(form.id==='editor-form'&&state.savingEditor)return;
  if(form.id==='editor-form'){state.savingEditor=true;document.querySelector('[form="editor-form"]').disabled=true;}
  submit.disabled=true;
  try {
    const values=Object.fromEntries(new FormData(form));
    if(form.id==='login-form'){state.auth=await api('/api/auth/login',{method:'POST',body:values});await loadAdmin();}
    if(form.id==='password-form'){
      document.querySelector('#password-error').replaceChildren();document.querySelector('#password-success').replaceChildren();
      if(values.password!==values.confirm)throw new Error('Hai mật khẩu mới chưa khớp.');
      await api('/api/auth/password',{method:'POST',body:{current:values.current,password:values.password}});
      form.reset();form.querySelectorAll('input[name]').forEach(input=>{input.type='password';});
      document.querySelector('#password-success').innerHTML='<p class="password-success-message">Đã đổi mật khẩu thành công. Lần đăng nhập tiếp theo, hãy dùng mật khẩu mới.</p>';
      toast('Đã đổi mật khẩu. Các phiên khác đã được đăng xuất.');
    }
    if(form.id==='editor-form'){
      collectEditor();repairEditor();const s=state.editor; const saved=await api(s.id?`/api/admin/surveys/${s.id}`:'/api/admin/surveys',{method:s.id?'PUT':'POST',body:s});state.selected=saved.id;document.querySelector('#modal').close();state.editor=null;await loadAdmin();toast('Đã lưu khảo sát.');
    }
  }catch(error){const el=document.querySelector(form.id==='login-form'?'#login-error':form.id==='password-form'?'#password-error':'#editor-error');if(el)el.innerHTML=errorBox(error.message);else toast(error.message);}
  finally{submit.disabled=false;if(form.id==='editor-form'){state.savingEditor=false;const headerButton=document.querySelector('[form="editor-form"]');if(headerButton)headerButton.disabled=false;}}
});
window.addEventListener('beforeunload',event=>{if(state.dirty&&!state.submitted){event.preventDefault();event.returnValue='';}});
async function init() {
  try {
    if(state.admin){try{state.auth=await api('/api/auth/me');await loadAdmin();}catch(error){if(error.status===401)renderLogin();else throw error;}}
    else{const slug=location.pathname.split('/')[2]||'genai';state.survey=await api(`/api/public/surveys/${slug}`);renderSurvey();}
  }catch(error){app.innerHTML=`<main class="unavailable"><div class="brand">${logo}</div><h1>${error.status===410?'Khảo sát đang tạm đóng.':'Không thể mở khảo sát.'}</h1><p>${esc(error.message)}</p><button class="button secondary" id="reload-page">Tải lại trang</button></main>`;document.querySelector('#reload-page').addEventListener('click',()=>location.reload());}
}
void init();
// Optional browser-agent access mirrors visible navigation; it cannot read admin data anonymously.
if(document.modelContext?.registerTool){
  try{void Promise.resolve(document.modelContext.registerTool({name:'read_survey_progress',description:'Đọc tiến độ biểu mẫu đang mở, không gửi hoặc sửa câu trả lời.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute(input){if(!input||typeof input!=='object'||Object.keys(input).length)throw new Error('Không nhận tham số.');if(state.admin||!state.survey)throw new Error('Không có biểu mẫu công khai đang mở.');return{title:state.survey.title,part:state.step+1,parts:surveySteps().length,submitted:state.submitted};}})).catch(()=>{});}catch{}
}
