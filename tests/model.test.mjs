import test from 'node:test';
import assert from 'node:assert/strict';
import { createId, normalizeTask, dueInfo, selectTasks, getMetrics, parseBackup, encodeBackup, readStore, writeStore, STORE_KEY, localDateKey } from '../dist/model.js';

const task = (overrides = {}) => ({ id: 'task-1', title: '마케팅 보고서', course: '마케팅', dueDate: '2026-10-28', dueTime: '23:59', type: '개인 과제', status: 'todo', priority: 'normal', memo: '', createdAt: '2026-10-28T01:00:00.000Z', updatedAt: '2026-10-28T01:00:00.000Z', source: 'user', ...overrides });
const now = new Date('2026-10-28T20:00:00+09:00');

test('randomUUID가 없는 실행 환경에서도 과제 ID를 만들 수 있다', () => {
  const noRandomUuid = { getRandomValues: bytes => { for (let i = 0; i < bytes.length; i++) bytes[i] = i; return bytes; } };
  assert.match(normalizeTask(task({ id: createId(noRandomUuid) })).id, /^[a-zA-Z0-9_-]+$/);
  const fallbackA = createId({});
  const fallbackB = createId({});
  assert.notEqual(fallbackA, fallbackB);
});

test('등록, 수정, 완료, 삭제한 결과가 재조회에도 유지된다', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  assert.deepEqual(readStore(storage), []);
  writeStore(storage, [task()]);
  const saved = readStore(storage);
  assert.equal(saved[0].title, '마케팅 보고서');
  writeStore(storage, saved.map(t => ({ ...t, title: '최종 발표 자료', status: 'done' })));
  assert.equal(readStore(storage)[0].title, '최종 발표 자료');
  assert.equal(readStore(storage)[0].status, 'done');
  writeStore(storage, []);
  assert.deepEqual(readStore(storage), []);
});

test('한국 시간 자정 이후에도 오늘 날짜가 전날로 바뀌지 않는다', () => {
  assert.equal(localDateKey(new Date('2026-10-29T00:05:00+09:00')), '2026-10-29');
  assert.equal(dueInfo(task(), new Date('2026-10-29T00:05:00+09:00')).text, '1일 지연');
});

test('마감 시각, 내일 마감, 완료 상태를 구분한다', () => {
  assert.equal(dueInfo(task(), now).text, '오늘 마감');
  assert.equal(dueInfo(task({ dueTime: '19:59' }), now).tone, 'overdue');
  assert.equal(dueInfo(task({ dueDate: '2026-10-29' }), now).text, '내일 마감');
  assert.equal(dueInfo(task({ dueDate: '2026-10-27', status: 'done' }), now).text, '완료');
  assert.equal(dueInfo(task({ dueTime: '20:00' }), new Date('2026-10-28T20:00:59+09:00')).tone, 'today');
});

test('완료 과제는 임박 목록에서 제외되고 검색, 필터, 정렬이 함께 동작한다', () => {
  const tasks = [task({ id: 'a', dueDate: '2026-11-10' }), task({ id: 'b', dueDate: '2026-10-27', status: 'done' }), task({ id: 'c', dueDate: '2026-10-29', memo: '인터뷰 정리', priority: 'high', status: 'doing' }), task({ id: 'd', dueDate: '2026-10-26', course: '경영통계' })];
  assert.deepEqual(selectTasks(tasks, { view: 'urgent' }, now).map(t => t.id), ['d', 'c']);
  assert.deepEqual(selectTasks(tasks, { query: '인터뷰', course: '마케팅', view: 'doing' }, now).map(t => t.id), ['c']);
  assert.equal(selectTasks(tasks, { sort: 'priority' }, now)[0].id, 'c');
  const metrics = getMetrics(tasks, now);
  assert.equal(metrics.done, 1); assert.equal(metrics.overdue, 1); assert.equal(metrics.progress, 25);
});

test('잘못된 날짜와 빈 과제명은 저장하지 않는다', () => {
  assert.throws(() => normalizeTask(task({ dueDate: '2026-02-30' })), /날짜/);
  assert.throws(() => normalizeTask(task({ title: '   ' })), /과제명/);
  assert.throws(() => normalizeTask(task({ dueTime: '25:00' })), /시간/);
});

test('백업 왕복 후 한글과 특수문자가 보존된다', () => {
  const original = task({ title: '<img src=x onerror=alert(1)> 한글 & "따옴표"', memo: '첫 줄\n둘째 줄' });
  assert.deepEqual(parseBackup(encodeBackup([original])), [original]);
});

test('손상된 백업, 중복 ID, 비문자열 타임스탬프를 불러오지 않는다', () => {
  assert.throws(() => parseBackup('{not json}'), /JSON/);
  assert.throws(() => parseBackup(JSON.stringify({ schemaVersion: 1, tasks: [task(), task()] })), /중복/);
  assert.throws(() => parseBackup(JSON.stringify({ schemaVersion: 1, tasks: [task({ createdAt: 1 })] })), /기록 날짜/);
});

test('저장 공간 부족과 손상된 저장 데이터는 실패로 전달된다', () => {
  let stored = 'previous-backup';
  const full = { setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.throws(() => writeStore(full, [task()]), /QuotaExceededError/);
  const corrupt = { getItem: () => stored, setItem: (_, v) => { stored = v; } };
  assert.throws(() => readStore(corrupt), /JSON/);
  assert.equal(stored, 'previous-backup');
  assert.equal(STORE_KEY, 'deadline-note:v1');
});
