'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('../src/engine');
const { createQuestionHistory, STORAGE_KEY } = require('../src/question-history');
const chapters = [{ id: 1, choices: [{ id: 'leave', effects: {} }], clues: [] }];
const questions = [1, 2, 3, 4].map(id => ({ id: `q${id}`, category: id % 2 ? '内科' : '内分泌',
  question: `题${id}`, options: ['甲', '乙'], correctIndex: 0, explanation: `解析${id}` }));
const rules = { fatalRisk: { work: 0, research: 0, politics: 0 },
  beneficialRisk: { chief_duty_appointment: 0, national_grant_award: 0, record_speech_champion: 0 },
  statusEventProbability: 0, recoveryEventProbability: 0, lowHpEventChance: 0, lowHpAdditionalChance: 0 };
const storage = () => { const map = new Map(); return { getItem: id => map.get(id), setItem: (id, value) => map.set(id, value) }; };
const game = (options = {}) => createGame(chapters, { seed: 7, knowledge: questions, rules, ...options });
function advance(g, count) { for (let i = 0; i < count; i++) assert.equal(g.act({ type: g.state.researchIdleUnits >= 20 ? 'research' : 'rest' }).ok, true); }
function finishExam(g) { while (g.getMonthlyAssessment()) { const q = g.getMonthlyAssessment().question; assert.equal(g.answerMonthly(q.correctIndex, q.id).ok, true); } }

test('persistent question history keeps the first answer, including wrong answers', () => {
  const s = storage(); const h = createQuestionHistory({ storage: s });
  assert.equal(h.record({ questionId: 'q1', answer: 1, correct: false, source: 'clinical' }).ok, true);
  assert.equal(h.record({ questionId: 'q1', answer: 0, correct: true, source: 'monthly' }).alreadyRecorded, true);
  const reloaded = createQuestionHistory({ storage: s });
  assert.equal(reloaded.get('q1').correct, false); assert.equal(reloaded.get('q1').answer, 1);
  assert.equal(reloaded.getRecords().length, 1);
  assert.ok(s.getItem(STORAGE_KEY));
});

test('storage rejection keeps memory history and reports a retryable save error', () => {
  let refuse = true; const s = storage(); const write = s.setItem;
  s.setItem = (...args) => refuse ? false : write(...args);
  const h = createQuestionHistory({ storage: s });
  assert.equal(h.record({ questionId: 'q1', answer: 0, correct: true }).ok, false);
  assert.equal(h.has('q1'), true); assert.equal(h.getState().unsavedCount, 1);
  assert.match(h.getState().storageError, /拒绝/);
  refuse = false; assert.equal(h.flush(), true);
  assert.equal(h.getState().unsavedCount, 0);
});

test('answered questions remain review-only through checkpoint, old save, chapter replay and new game', () => {
  const s = storage(); const g = game({ storage: s }); const oldSave = g.save().json;
  assert.equal(g.act({ type: 'clinical', questionId: 'q1', answer: 1 }).correct, false);
  for (const restore of [() => g.restoreCheckpoint(), () => g.load(oldSave), () => g.startChapter(1, { replay: true }), () => g.newGame()]) {
    assert.equal(restore().ok, true);
    assert.equal(g.isQuestionAnswered('q1'), true);
    const before = structuredClone(g.state);
    const review = g.act({ type: 'clinical', questionId: 'q1', answer: 0 });
    assert.equal(review.review, true); assert.equal(review.correct, false); assert.equal(review.explanation, '解析1');
    assert.deepEqual(g.state, before);
  }
  const restarted = game({ storage: s });
  assert.equal(restarted.isQuestionAnswered('q1'), true);
  assert.equal(restarted.getUnansweredQuestions().length, 3);
  assert.equal(restarted.getAnsweredQuestions()[0].recordedAnswer, 1);
});

test('daily and monthly answers share history, exhausted exams are waived until new questions arrive', () => {
  const s = storage(); const g = game({ storage: s });
  g.act({ type: 'clinical', questionId: 'q1', answer: 1 }); advance(g, 139);
  assert.equal(g.getMonthlyAssessment().total, 3);
  assert.ok(!g.getMonthlyAssessment().questionIds.includes('q1'));
  const fromExam = g.getMonthlyAssessment().question.id;
  finishExam(g);
  const before = structuredClone(g.state);
  assert.equal(g.act({ type: 'clinical', questionId: fromExam, answer: 0 }).review, true);
  assert.deepEqual(g.state, before);
  assert.deepEqual(g.getUnansweredQuestions(), []);
  advance(g, 140);
  assert.equal(g.getMonthlyAssessment(), null);
  assert.equal(g.state.completedAssessments.at(-1).status, 'unavailable');
  assert.equal(g.state.completedAssessments.at(-1).total, 0);
  assert.ok(g.state.log.some(entry => /免考/.test(entry.text)));
  const expanded = game({ storage: s, knowledge: questions.concat({ ...questions[0], id: 'new-question' }) });
  assert.deepEqual(expanded.getUnansweredQuestions().map(q => q.id), ['new-question']);
  advance(expanded, 140);
  assert.equal(expanded.getMonthlyAssessment().total, 1);
  assert.equal(expanded.getMonthlyAssessment().question.id, 'new-question');
});

test('a partially completed assessment keeps submitted answers when restored and never repeats later submitted questions', () => {
  const g = game(); advance(g, 140);
  const first = g.getMonthlyAssessment().question; g.answerMonthly(0, first.id); g.checkpoint('中途');
  const answered = structuredClone(g.state.monthlyAssessment.answers);
  const second = g.getMonthlyAssessment().question; g.answerMonthly(1, second.id);
  assert.equal(g.restoreCheckpoint().ok, true);
  assert.deepEqual(g.state.monthlyAssessment.answers.slice(0, 1), answered);
  assert.equal(g.state.monthlyAssessment.index, 2);
  assert.ok(g.state.monthlyAssessment.questionIds.includes(second.id));
  assert.equal(g.state.monthlyAssessment.answers[1].fromHistory, true);
  assert.equal(g.state.monthlyAssessment.answers[1].correct, false);
  assert.equal(g.isQuestionAnswered(second.id), true);
  finishExam(g);
  assert.equal(g.state.completedAssessments.at(-1).score, 2);
  assert.equal(g.state.completedAssessments.at(-1).total, 3);
});

test('legacy saves import both daily and monthly answer records without awarding new actions', () => {
  const source = game(); source.act({ type: 'clinical', questionId: 'q1', answer: 1 }); advance(source, 139);
  const current = source.getMonthlyAssessment().question; source.answerMonthly(0, current.id);
  const saved = source.save().json; const fresh = game();
  assert.equal(fresh.load(saved).ok, true);
  assert.equal(fresh.isQuestionAnswered('q1'), true); assert.equal(fresh.isQuestionAnswered(current.id), true);
  assert.deepEqual(fresh.state, source.state);
});

test('no-question exemptions never appear as a completed full-marks assessment', () => {
  const g = game({ knowledge: [questions[0]] });
  g.act({ type: 'clinical', questionId: 'q1', answer: 0 }); advance(g, 138);
  const due = g.act({ type: 'rest' });
  assert.equal(due.assessmentUnavailable.total, 0); assert.match(due.assessmentMessage, /暂无新题.*免考/);
  assert.equal(g.state.completedAssessments.length, 1);
  assert.equal(g.state.completedAssessments[0].status, 'unavailable');
  assert.equal(g.state.flags.monthlyAssessmentsCompleted, undefined);
  assert.equal(g.getMonthlyAssessment(), null);
});

test('restoring after a correct monthly answer retains the original three-question full score without charging twice', () => {
  const g = game(); advance(g, 140);
  const ids = g.getMonthlyAssessment().questionIds.slice();
  g.answerMonthly(0, ids[0]); g.checkpoint('第一题后');
  g.answerMonthly(0, ids[1]); g.restoreCheckpoint();
  assert.equal(g.state.hp, 50); assert.equal(g.state.monthlyAssessment.index, 2);
  assert.equal(g.state.monthlyAssessment.total, 3);
  assert.deepEqual(g.state.monthlyAssessment.questionIds, ids);
  assert.equal(g.state.monthlyAssessment.answers[1].hpLoss, 0);
  g.answerMonthly(0, ids[2]);
  assert.equal(g.state.completedAssessments.at(-1).score, 3);
  assert.equal(g.state.completedAssessments.at(-1).total, 3);
  assert.equal(g.state.hp, 50);
});

test('corrupt history is preserved untouched and can be retried after storage recovery', () => {
  for (const raw of ['{broken', JSON.stringify({ version: 1, records: [{ questionId: 'q1', answer: 'invalid', correct: true }] })]) {
    const s = storage(); s.setItem(STORAGE_KEY, raw);
    const h = createQuestionHistory({ storage: s });
    assert.equal(h.record({ questionId: 'q2', answer: 0, correct: true }).ok, false);
    assert.equal(s.getItem(STORAGE_KEY), raw);
    assert.equal(h.has('q2'), true); assert.equal(h.getState().unsavedCount, 1);
    assert.match(h.getState().storageError, /原数据未覆盖/);
    s.setItem(STORAGE_KEY, JSON.stringify({ version: 1, records: [{ questionId: 'q1', answer: 1, correct: false }] }));
    assert.equal(h.flush(), true);
    assert.equal(createQuestionHistory({ storage: s }).getRecords().length, 2);
  }
});

test('independent history instances merge without losing or replacing persisted first answers', () => {
  const s = storage(); const a = createQuestionHistory({ storage: s }); const b = createQuestionHistory({ storage: s });
  a.record({ questionId: 'q1', answer: 1, correct: false });
  b.record({ questionId: 'q2', answer: 0, correct: true });
  assert.equal(b.record({ questionId: 'q1', answer: 0, correct: true }).alreadyRecorded, true);
  const final = createQuestionHistory({ storage: s });
  assert.equal(final.getRecords().length, 2); assert.equal(final.get('q1').correct, false);
});

test('asynchronous storage results are rejected without silently discarding pending records', async () => {
  const h = createQuestionHistory({ storage: { getItem: () => null, setItem: () => Promise.reject(new Error('offline')) } });
  assert.equal(h.record({ questionId: 'q1', answer: 0, correct: true }).ok, false);
  assert.equal(h.getState().unsavedCount, 1); assert.match(h.getState().storageError, /同步写入/);
  await new Promise(resolve => setImmediate(resolve));
});

test('saving retries pending history even after loading an older game save', () => {
  const s = storage(); let refuseHistory = true; const write = s.setItem;
  s.setItem = (id, value) => id === STORAGE_KEY && refuseHistory ? false : write(id, value);
  const g = game({ storage: s }); const oldSave = g.save().json;
  const answer = g.act({ type: 'clinical', questionId: 'q1', answer: 0 });
  assert.match(answer.questionHistoryError, /拒绝/);
  assert.equal(g.load(oldSave).ok, true);
  assert.match(g.save().questionHistoryWarning, /拒绝/);
  refuseHistory = false;
  assert.equal(g.save().questionHistoryWarning, null);
  const resumed = game({ storage: s }); resumed.load();
  assert.equal(resumed.isQuestionAnswered('q1'), true);
  assert.equal(resumed.act({ type: 'clinical', questionId: 'q1', answer: 0 }).review, true);
});
