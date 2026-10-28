export const STORE_KEY = 'deadline-note:v1';
export const TYPES = ['개인 과제', '팀 프로젝트', '시험 준비', '기타'];
export const STATUSES = ['todo', 'doing', 'done'];
export const PRIORITIES = ['high', 'normal', 'low'];

export function createId(provider = globalThis.crypto) {
  if (typeof provider?.randomUUID === 'function') return provider.randomUUID();
  if (typeof provider?.getRandomValues === 'function') {
    const bytes = provider.getRandomValues(new Uint8Array(16));
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (y < 2000 || y > 2100) return false;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function normalizeTask(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('과제 형식이 올바르지 않습니다.');
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > 100) throw new Error('과제명은 1~100자로 입력해 주세요.');
  const course = typeof input.course === 'string' ? input.course.trim() : '';
  const memo = typeof input.memo === 'string' ? input.memo.trim() : '';
  if (course.length > 40 || memo.length > 1000) throw new Error('수업명은 40자, 메모는 1,000자까지 입력할 수 있습니다.');
  if (!validDate(input.dueDate)) throw new Error('마감 날짜를 올바르게 입력해 주세요. (2000~2100년)');
  if (typeof input.dueTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.dueTime)) throw new Error('마감 시간을 올바르게 입력해 주세요.');
  if (!TYPES.includes(input.type) || !STATUSES.includes(input.status) || !PRIORITIES.includes(input.priority)) throw new Error('분류, 진행 상태 또는 우선순위가 올바르지 않습니다.');
  if (typeof input.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.id)) throw new Error('과제 ID가 올바르지 않습니다.');
  const isTimestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  if (!isTimestamp(input.createdAt) || !isTimestamp(input.updatedAt)) throw new Error('과제의 기록 날짜가 올바르지 않습니다.');
  return { id: input.id, title, course, dueDate: input.dueDate, dueTime: input.dueTime, type: input.type, status: input.status, priority: input.priority, memo, createdAt: input.createdAt, updatedAt: input.updatedAt, source: input.source === 'demo' ? 'demo' : 'user' };
}

export function dueInfo(task, now = new Date()) {
  const [y, m, d] = task.dueDate.split('-').map(Number);
  const [hour, minute] = task.dueTime.split(':').map(Number);
  const deadline = new Date(y, m - 1, d, hour, minute, 59, 999);
  const dayDiff = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (task.status === 'done') return { text: '완료', tone: 'done', dayDiff, deadline };
  if (deadline < now) return { text: dayDiff === 0 ? '마감 지남' : `${Math.abs(dayDiff)}일 지연`, tone: 'overdue', dayDiff, deadline };
  if (dayDiff === 0) return { text: '오늘 마감', tone: 'today', dayDiff, deadline };
  if (dayDiff === 1) return { text: '내일 마감', tone: 'soon', dayDiff, deadline };
  return { text: `D-${dayDiff}`, tone: dayDiff <= 3 ? 'soon' : 'later', dayDiff, deadline };
}

export function selectTasks(tasks, { view = 'all', query = '', course = '', type = '', sort = 'due' } = {}, now = new Date()) {
  const needle = query.trim().toLocaleLowerCase();
  const ranks = { high: 0, normal: 1, low: 2 };
  return tasks.filter(t => {
    if (view === 'urgent' && (t.status === 'done' || dueInfo(t, now).dayDiff > 7)) return false;
    if (view === 'doing' && t.status !== 'doing') return false;
    if (view === 'done' && t.status !== 'done') return false;
    if (course && t.course !== course) return false;
    if (type && t.type !== type) return false;
    return !needle || [t.title, t.course, t.memo].join(' ').toLocaleLowerCase().includes(needle);
  }).sort((a, b) => {
    if (sort === 'recent') return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
    if ((a.status === 'done') !== (b.status === 'done')) return a.status === 'done' ? 1 : -1;
    if (sort === 'priority' && ranks[a.priority] !== ranks[b.priority]) return ranks[a.priority] - ranks[b.priority];
    return `${a.dueDate}T${a.dueTime}`.localeCompare(`${b.dueDate}T${b.dueTime}`) || a.createdAt.localeCompare(b.createdAt);
  });
}

export function getMetrics(tasks, now = new Date()) {
  const done = tasks.filter(t => t.status === 'done').length;
  return { total: tasks.length, done, doing: tasks.filter(t => t.status === 'doing').length, today: tasks.filter(t => t.status !== 'done' && t.dueDate === localDateKey(now)).length, overdue: tasks.filter(t => dueInfo(t, now).tone === 'overdue').length, progress: tasks.length ? Math.round(done / tasks.length * 100) : 0 };
}

export function parseBackup(raw) {
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('올바른 JSON 백업 파일이 아닙니다.'); }
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.tasks)) throw new Error('마감노트 버전 1 백업 파일을 선택해 주세요.');
  if (data.tasks.length > 1000) throw new Error('과제는 최대 1,000개까지 불러올 수 있습니다.');
  const tasks = data.tasks.map(normalizeTask);
  if (new Set(tasks.map(t => t.id)).size !== tasks.length) throw new Error('중복된 과제 ID가 있어 불러올 수 없습니다.');
  return tasks;
}

export function encodeBackup(tasks) {
  return JSON.stringify({ app: 'deadline-note', schemaVersion: 1, exportedAt: new Date().toISOString(), tasks: tasks.map(normalizeTask) }, null, 2);
}

export function readStore(storage) {
  const raw = storage.getItem(STORE_KEY);
  return raw === null ? [] : parseBackup(raw);
}

export function writeStore(storage, tasks) {
  storage.setItem(STORE_KEY, encodeBackup(tasks));
}

export function demoTasks(now = new Date()) {
  const date = offset => { const d = new Date(now); d.setDate(d.getDate() + offset); return localDateKey(d); };
  const stamp = now.toISOString();
  return [
    { title: '마케팅 팀 프로젝트 발표 자료', course: '마케팅', dueDate: date(0), dueTime: '23:59', type: '팀 프로젝트', status: 'doing', priority: 'high', memo: '시장 분석 정리 → 팀원 의견 확인 → 최종 슬라이드 점검' },
    { title: '통계학 연습문제 제출', course: '경영통계', dueDate: date(1), dueTime: '18:00', type: '개인 과제', status: 'todo', priority: 'normal', memo: '5장 연습문제 1~8번 풀이와 계산 확인' },
    { title: '웹 앱 개발 보고서 작성', course: '생성형 AI', dueDate: date(3), dueTime: '23:59', type: '개인 과제', status: 'doing', priority: 'high', memo: '주요 기능 화면 캡처와 실제 문제 해결 과정 정리' },
    { title: '중간고사 오답 복습', course: '재무관리', dueDate: date(6), dueTime: '20:00', type: '시험 준비', status: 'todo', priority: 'low', memo: '자본예산과 채권 가치평가 중심으로 복습' },
    { title: '팀 인터뷰 질문지 정리', course: '마케팅', dueDate: date(-1), dueTime: '18:00', type: '팀 프로젝트', status: 'done', priority: 'normal', memo: '완료 처리 예시입니다.' }
  ].map((t, i) => ({ ...t, id: `demo-${createId()}`, createdAt: new Date(now.getTime() - i * 60000).toISOString(), updatedAt: stamp, source: 'demo' }));
}
