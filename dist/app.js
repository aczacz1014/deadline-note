import { STORE_KEY, createId, localDateKey, normalizeTask, dueInfo, selectTasks, getMetrics, parseBackup, encodeBackup, readStore, writeStore, demoTasks } from './model.js';

const $ = selector => document.querySelector(selector);
const statusNames = { todo: '시작 전', doing: '진행 중', done: '완료' };
const viewNames = { all: ['나의 과제', '머릿속 할 일을 꺼내고, 오늘에 집중해요.'], urgent: ['마감 임박', '지연된 과제와 7일 이내 마감을 먼저 확인해요.'], doing: ['진행 중인 과제', '잘하고 있어요. 시작한 일을 하나씩 마무리해요.'], done: ['완료한 과제', '해낸 일들을 모아보면, 생각보다 많이 왔어요.'] };
let tasks = [];
let storageFailed = false;
let filters = { view: 'all', query: '', course: '', type: '', sort: 'due' };
let toastTimer;
let confirmAction = null;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.toggle('error', error);
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, error ? 7000 : 3500);
}

function storageError(error) {
  storageFailed = true;
  $('#storage-error').hidden = false;
  $('#storage-error-message').textContent = `${error.message} 원본을 백업한 뒤 초기화하거나, 정상 백업 파일을 불러와 주세요.`;
  ['#add-btn', '#empty-add-btn', '#demo-btn', '#export-btn'].forEach(id => { $(id).disabled = true; });
  $('#saved-label').textContent = '저장 상태를 확인해 주세요';
}

function load() {
  try { tasks = readStore(localStorage); storageFailed = false; $('#storage-error').hidden = true; ['#add-btn', '#empty-add-btn', '#demo-btn', '#export-btn'].forEach(id => { $(id).disabled = false; }); }
  catch (error) { storageError(error); }
}

function mutate(change, message) {
  try {
    const current = readStore(localStorage);
    const next = change(current).map(normalizeTask);
    if (next.length > 1000) throw new Error('과제는 최대 1,000개까지 저장할 수 있습니다.');
    writeStore(localStorage, next);
    tasks = next;
    render();
    $('#saved-label').textContent = '방금 저장했어요';
    if (message) toast(message);
    return true;
  } catch (error) { toast(`저장하지 못했습니다. ${error.message}`, true); return false; }
}

function requestConfirm(title, message, action, { danger = false, label = '확인' } = {}) {
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  $('#confirm-ok').textContent = label;
  $('#confirm-ok').classList.toggle('danger', danger);
  confirmAction = action;
  $('#confirm-dialog').showModal();
  $('#confirm-cancel').focus();
}

function setView(view) {
  filters.view = view;
  render();
}

function renderCourses() {
  const courses = [...new Set(tasks.map(t => t.course).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  const selected = filters.course;
  $('#course-filter').replaceChildren(node('option', '', '모든 수업'));
  $('#course-filter').firstChild.value = '';
  $('#course-options').replaceChildren();
  courses.forEach(course => { const option = node('option', '', course); option.value = course; $('#course-filter').append(option); const suggestion = node('option'); suggestion.value = course; $('#course-options').append(suggestion); });
  if (courses.includes(selected)) $('#course-filter').value = selected;
  else { filters.course = ''; $('#course-filter').value = ''; }
}

function taskRow(task, now) {
  const row = node('article', `task-row${task.status === 'done' ? ' is-done' : ''}`);
  const complete = node('button', 'complete-btn', '✓');
  complete.type = 'button';
  complete.setAttribute('aria-label', `${task.title}: ${task.status === 'done' ? '미완료로 되돌리기' : '완료로 변경'}`);
  complete.setAttribute('aria-pressed', String(task.status === 'done'));
  complete.addEventListener('click', () => mutate(current => current.map(t => t.id === task.id ? { ...t, status: t.status === 'done' ? 'todo' : 'done', updatedAt: new Date().toISOString() } : t), task.status === 'done' ? '시작 전 상태로 되돌렸어요.' : '하나 더 해냈어요! 과제를 완료했어요.'));
  const main = node('div', 'task-main');
  const title = node('button', 'task-title', task.title); title.type = 'button'; title.addEventListener('click', () => openTask(task.id));
  const meta = node('div', 'task-meta');
  if (task.course) { meta.append(node('span', 'course-label', task.course), node('span', 'meta-separator', '·')); }
  meta.append(node('span', '', task.type));
  if (task.priority !== 'normal') meta.append(node('span', 'meta-separator', '·'), node('span', `priority-dot ${task.priority}`, task.priority === 'high' ? '우선순위 높음' : '우선순위 낮음'));
  main.append(title, meta);
  const due = dueInfo(task, now);
  const dueCell = node('div', 'due-cell');
  const date = new Date(`${task.dueDate}T${task.dueTime}`);
  dueCell.append(node('span', `due-badge ${due.tone}`, due.text), node('span', 'due-date', `${date.getMonth() + 1}.${String(date.getDate()).padStart(2, '0')} (${['일','월','화','수','목','금','토'][date.getDay()]}) ${task.dueTime}`));
  const status = node('select', `row-status ${task.status}`);
  status.setAttribute('aria-label', `${task.title} 진행 상태`);
  Object.entries(statusNames).forEach(([value, label]) => { const option = node('option', '', label); option.value = value; status.append(option); });
  status.value = task.status;
  status.addEventListener('change', () => { const changed = status.value; if (!mutate(current => current.map(t => t.id === task.id ? { ...t, status: changed, updatedAt: new Date().toISOString() } : t), '진행 상태를 저장했어요.')) status.value = task.status; });
  const remove = node('button', 'delete-btn');
  remove.type = 'button'; remove.setAttribute('aria-label', `${task.title} 삭제`);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '15'); svg.setAttribute('height', '15'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5'); path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.5'); path.setAttribute('stroke-linecap', 'round'); svg.append(path); remove.append(svg);
  remove.addEventListener('click', () => requestConfirm('과제를 삭제할까요?', `‘${task.title}’ 과제가 삭제됩니다. 삭제한 과제는 되돌릴 수 없어요.`, () => mutate(current => current.filter(t => t.id !== task.id), '과제를 삭제했어요.'), { danger: true, label: '삭제' }));
  row.append(complete, main, dueCell, status, remove);
  return row;
}

function render() {
  const now = new Date();
  const metrics = getMetrics(tasks, now);
  $('#today-label').textContent = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(now);
  $('#page-title').textContent = viewNames[filters.view][0]; $('#page-description').textContent = viewNames[filters.view][1];
  document.querySelectorAll('[data-view]').forEach(button => { const active = button.dataset.view === filters.view; button.classList.toggle('active', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  $('#nav-all').textContent = metrics.total; $('#nav-urgent').textContent = selectTasks(tasks, { view: 'urgent' }, now).length; $('#nav-doing').textContent = metrics.doing; $('#nav-done').textContent = metrics.done;
  $('#stat-remaining').textContent = metrics.total - metrics.done; $('#stat-today').textContent = metrics.today; $('#stat-overdue').textContent = `지연된 과제 ${metrics.overdue}개`; $('#stat-progress').textContent = metrics.progress; $('#progress-count').textContent = `${metrics.done} / ${metrics.total}`; $('#progress-bar').style.width = `${metrics.progress}%`; $('.progress-track').setAttribute('aria-valuenow', metrics.progress);
  if (metrics.overdue) { $('#focus-title').textContent = `지연된 과제 ${metrics.overdue}개, 먼저 살펴볼까요?`; $('#focus-text').textContent = '마감을 놓친 일부터 확인하고, 다시 계획을 세워봐요.'; }
  else if (metrics.today) { $('#focus-title').textContent = `오늘 마감 ${metrics.today}개, 가볍게 끝내봐요.`; $('#focus-text').textContent = '중요한 일부터 하나씩. 끝낸 과제에는 체크를 남겨주세요.'; }
  else if (metrics.total && metrics.done === metrics.total) { $('#focus-title').textContent = '모두 해냈어요. 오늘은 조금 가볍게.'; $('#focus-text').textContent = '작은 완료가 모여 여유가 되었어요. 다음 계획도 이곳에 남겨주세요.'; }
  else { $('#focus-title').textContent = '오늘의 여유는, 작은 계획에서.'; $('#focus-text').textContent = metrics.total ? '다가오는 마감을 미리 확인하면 오늘의 계획이 조금 더 가벼워져요.' : '첫 과제를 등록하고 나만의 플래너를 시작해 보세요.'; }
  renderCourses();
  const shown = selectTasks(tasks, filters, now);
  $('#result-count').textContent = shown.length;
  $('#task-list').replaceChildren(...shown.map(task => taskRow(task, now)));
  $('#empty-state').hidden = shown.length !== 0;
  const firstUse = tasks.length === 0 && filters.view === 'all' && !filters.query && !filters.course && !filters.type;
  $('#empty-title').textContent = firstUse ? '계획을 적을 작은 공간이 생겼어요.' : '이 조건에 맞는 과제가 없어요.';
  $('#empty-text').textContent = firstUse ? '과제를 등록하면 마감과 진행 상황을 한눈에 볼 수 있어요.' : '검색 조건을 바꾸거나 전체 과제를 확인해 보세요.';
  $('#empty-add-btn').hidden = !firstUse; $('#demo-btn').hidden = !firstUse; $('#clear-filters-btn').hidden = firstUse;
  $('#remove-demo-btn').hidden = !tasks.some(t => t.source === 'demo');
}

function openTask(id = '') {
  if (storageFailed) return;
  load();
  if (storageFailed) return;
  const task = tasks.find(t => t.id === id);
  if (id && !task) { toast('다른 창에서 삭제된 과제입니다.', true); render(); return; }
  $('#task-form').reset(); $('#task-id').value = id;
  $('#dialog-title').textContent = task ? '과제 수정' : '새 과제 등록';
  $('#task-title').value = task?.title ?? ''; $('#task-course').value = task?.course ?? ''; $('#task-date').value = task?.dueDate ?? localDateKey(); $('#task-time').value = task?.dueTime ?? '23:59'; $('#task-type').value = task?.type ?? '개인 과제'; $('#task-priority').value = task?.priority ?? 'normal'; $('#task-status').value = task?.status ?? 'todo'; $('#task-memo').value = task?.memo ?? ''; $('#form-error').hidden = true;
  $('#task-dialog').showModal(); $('#task-title').focus();
}

$('#task-form').addEventListener('submit', event => {
  event.preventDefault();
  const id = $('#task-id').value;
  const stamp = new Date().toISOString();
  try {
    const original = tasks.find(t => t.id === id);
    const task = normalizeTask({ id: id || createId(), title: $('#task-title').value, course: $('#task-course').value, dueDate: $('#task-date').value, dueTime: $('#task-time').value, type: $('#task-type').value, priority: $('#task-priority').value, status: $('#task-status').value, memo: $('#task-memo').value, createdAt: original?.createdAt ?? stamp, updatedAt: stamp, source: original?.source ?? 'user' });
    const saved = mutate(current => {
      if (id && !current.some(t => t.id === id)) throw new Error('다른 창에서 삭제된 과제입니다. 새 과제로 등록해 주세요.');
      return id ? current.map(t => t.id === id ? task : t) : [...current, task];
    }, id ? '과제 내용을 수정했어요.' : '새 과제를 등록했어요. 한 걸음 시작했네요!');
    if (saved) { $('#task-dialog').close(); if (filters.view === 'done' && task.status !== 'done') toast('저장했어요. 전체 과제에서 확인할 수 있어요.'); }
    else { $('#form-error').textContent = '저장되지 않았습니다. 입력한 내용은 이 창에 남아 있어요. 저장 공간과 다른 창의 변경 사항을 확인해 주세요.'; $('#form-error').hidden = false; }
  } catch (error) { $('#form-error').textContent = error.message; $('#form-error').hidden = false; }
});

['#add-btn', '#empty-add-btn'].forEach(id => $(id).addEventListener('click', () => openTask()));
['#close-dialog', '#cancel-dialog'].forEach(id => $(id).addEventListener('click', () => $('#task-dialog').close()));
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
$('#focus-btn').addEventListener('click', () => setView('urgent'));
$('#search').addEventListener('input', event => { filters.query = event.target.value; render(); });
$('#course-filter').addEventListener('change', event => { filters.course = event.target.value; render(); });
$('#type-filter').addEventListener('change', event => { filters.type = event.target.value; render(); });
$('#sort').addEventListener('change', event => { filters.sort = event.target.value; render(); });
$('#clear-filters-btn').addEventListener('click', () => { filters = { view: 'all', query: '', course: '', type: '', sort: 'due' }; $('#search').value = ''; $('#type-filter').value = ''; $('#sort').value = 'due'; render(); });
$('#demo-btn').addEventListener('click', () => mutate(current => current.length ? current : demoTasks(), '가상 예시 과제 5개를 추가했어요. 자유롭게 수정해 보세요.'));
$('#remove-demo-btn').addEventListener('click', () => requestConfirm('예시 과제를 지울까요?', '예시로 추가된 과제만 삭제합니다. 직접 등록한 과제는 유지됩니다.', () => mutate(current => current.filter(t => t.source !== 'demo'), '예시 과제를 삭제했어요.'), { danger: true, label: '예시 삭제' }));
$('#confirm-cancel').addEventListener('click', () => $('#confirm-dialog').close());
$('#confirm-ok').addEventListener('click', () => { const action = confirmAction; $('#confirm-dialog').close(); confirmAction = null; action?.(); });
$('#confirm-dialog').addEventListener('close', () => { confirmAction = null; });
['#help-btn', '#footer-help-btn'].forEach(id => $(id).addEventListener('click', () => $('#help-dialog').showModal())); $('#close-help').addEventListener('click', () => $('#help-dialog').close());

function download(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const link = node('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('#export-btn').addEventListener('click', () => { try { download(encodeBackup(readStore(localStorage)), `deadline-note-${localDateKey()}.json`); toast('백업 파일을 저장했어요.'); } catch (error) { toast(error.message, true); } });
$('#import-btn').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw new Error('1MB 이하의 백업 파일을 선택해 주세요.');
    const imported = parseBackup(await file.text());
    requestConfirm('백업 파일을 불러올까요?', `백업의 과제 ${imported.length}개로 현재 기록 전체를 교체합니다.\n현재 기록이 필요하면 먼저 ‘백업 저장’을 해주세요.`, () => {
      try { writeStore(localStorage, imported); load(); render(); toast(`${imported.length}개 과제를 불러왔어요.`); } catch (error) { toast(`불러오지 못했습니다. ${error.message}`, true); }
    }, { label: '교체하여 불러오기' });
  } catch (error) { toast(`불러오지 못했습니다. ${error.message}`, true); }
});
$('#raw-backup-btn').addEventListener('click', () => { try { const raw = localStorage.getItem(STORE_KEY); if (raw === null) throw new Error('백업할 원본 기록이 없습니다.'); download(raw, `deadline-note-original-${localDateKey()}.json`); } catch (error) { toast(error.message, true); } });
$('#reset-btn').addEventListener('click', () => requestConfirm('저장 기록을 초기화할까요?', '현재 브라우저에 저장된 마감노트 기록을 모두 삭제합니다. 먼저 원본 백업을 저장하는 것을 권장해요.', () => { try { localStorage.removeItem(STORE_KEY); tasks = []; load(); render(); toast('기록을 초기화했어요.'); } catch (error) { toast(error.message, true); } }, { danger: true, label: '초기화' }));
window.addEventListener('storage', event => { if (event.key === STORE_KEY || event.key === null) { load(); render(); toast('다른 창의 변경 사항을 반영했어요.'); } });
window.addEventListener('focus', () => { load(); render(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { load(); render(); } });
setInterval(() => { if (!document.hidden) render(); }, 60000);
load(); render();
