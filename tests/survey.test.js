'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSurvey, STORAGE_PREFIX } = require('../src/survey');
const runtimeConfig = require('../data/study-config.json');
function storage() {
  const values = new Map();
  return { values, getItem: (k) => values.get(k) ?? null,
    setItem(k, v) { values.set(k, v); return true; }, removeItem(k) { values.delete(k); return true; } };
}
// Technical placeholders only: not actual scale items or a validated tool.
function config(overrides = {}) {
  return { enabled: true, studyId: 'technical-test-only', scaleId: 'PLACEHOLDER', scaleVersion: 'TEST-1',
    instructions: '技术指导语占位符。', consentText: '技术同意文本占位符。', recallWindow: '技术回顾时间占位符。',
    assessmentWindowHours: 24, itemsPerBreak: 2,
    responseOptions: [{ value: 0, label: '测试选项零' }, { value: 1, label: '测试选项一' }],
    items: Array.from({ length: 5 }, (_, i) => ({ id: `q${i + 1}`, text: `技术占位题 ${i + 1}`, originalOrder: i + 1 })), ...overrides };
}
function started(conf = config(), store = storage()) {
  const survey = createSurvey(conf, store);
  assert.equal(survey.consent(true).ok, true); assert.equal(survey.beginAssessment().ok, true);
  return { survey, store };
}
function withClock(ms, fn) {
  const original = Date.now; let now = ms; Date.now = () => now;
  try { fn((next) => { now = next; }); } finally { Date.now = original; }
}

test('shipping configuration is empty and cannot consent, collect or create identifiers', () => {
  const st = storage(); const survey = createSurvey(runtimeConfig, st);
  assert.equal(runtimeConfig.enabled, false); assert.deepEqual(runtimeConfig.items, []);
  assert.equal(survey.isConfigured(), false); assert.equal(survey.consent(true).code, 'not_configured');
  assert.equal(survey.beginAssessment().ok, false); assert.deepEqual(survey.getNextBatch(1), []);
  assert.equal(survey.answer('q1', 0, { chapterId: 1 }).ok, false);
  assert.equal(survey.getState().participantId, null); assert.equal(st.values.size, 0);
});
test('valid configuration still collects nothing before explicit consent', () => {
  const st = storage(); const survey = createSurvey(config(), st);
  assert.equal(survey.isConfigured(), true); assert.equal(survey.beginAssessment().code, 'consent_required');
  assert.deepEqual(survey.getNextBatch(1), []);
  assert.equal(survey.answer('q1', 1, { chapterId: 1 }).code, 'consent_required');
  assert.equal(survey.skip('q1', { chapterId: 1 }).code, 'consent_required');
  assert.equal(survey.getState().participantId, null); assert.equal(st.values.size, 0);
});
test('survey persistence and clearing cannot overwrite game saves or replay responses', () => {
  const st = storage(); const gameState = JSON.stringify({ hp: 43, rngState: 987, chapterId: 4 });
  st.setItem('baiyi-game-save-v1', gameState); const { survey } = started(config(), st);
  survey.getNextBatch(4); survey.answer('q1', 1, { chapterId: 4 }); const id = survey.getState().participantId;
  assert.ok(survey.getState().storageKey.startsWith(STORAGE_PREFIX)); assert.equal(st.getItem('baiyi-game-save-v1'), gameState);
  st.setItem('baiyi-game-save-v1', JSON.stringify({ hp: 100, rngState: 42, chapterId: 1 }));
  const restored = createSurvey(config(), st);
  assert.equal(restored.getState().participantId, id); assert.equal(restored.getState().assessment.records[0].value, 1);
  const remaining = st.getItem('baiyi-game-save-v1'); restored.clearData();
  assert.equal(st.getItem('baiyi-game-save-v1'), remaining); assert.equal(st.values.size, 1);
});
test('original item order and two-item batches persist; chapters cannot farm more items', () => {
  const c = config(); c.items.reverse(); const { survey } = started(c);
  const batch = survey.getNextBatch(1); assert.deepEqual(batch.map((i) => i.id), ['q1', 'q2']);
  assert.deepEqual(batch.map((i) => i.originalOrder), [1, 2]);
  assert.equal(survey.answer('q1', 0, { chapterId: 1 }).ok, true); assert.equal(survey.skip('q2', { chapterId: 1 }).ok, true);
  assert.deepEqual(survey.getNextBatch(1), []); assert.deepEqual(survey.getNextBatch(2).map((i) => i.id), ['q3', 'q4']);
  assert.deepEqual(survey.getNextBatch(1), []);
});
test('unfinished batch resumes in another chapter without item or presentation duplication', () => {
  const { survey, store } = started(); survey.getNextBatch(1); survey.getNextBatch(1);
  survey.answer('q1', 1, { chapterId: 1 }); assert.deepEqual(survey.getNextBatch(2).map((i) => i.id), ['q2']);
  assert.equal(survey.getState().assessment.batches.length, 1);
  const restored = createSurvey(config(), store); assert.deepEqual(restored.getNextBatch(2).map((i) => i.id), ['q2']);
  assert.equal(restored.getState().assessment.records[0].presentations.length, 1);
  assert.equal(restored.getState().assessment.records[1].presentations.length, 2);
  restored.skip('q2', { chapterId: 2 }); assert.deepEqual(restored.getNextBatch(1), []); assert.deepEqual(restored.getNextBatch(2), []);
  assert.deepEqual(restored.getNextBatch(3).map((i) => i.id), ['q3', 'q4']);
});
test('answers and skips retain timestamps, explicit missingness and first responses', () => {
  withClock(Date.UTC(2026, 9, 20), (setTime) => {
    const { survey } = started(); survey.getNextBatch('one'); const shown = survey.getState().assessment.records[0].presentedAt;
    setTime(Date.UTC(2026, 9, 20, 0, 1)); survey.answer('q1', 0, { chapterId: 'one' }); survey.skip('q2', { chapterId: 'one' });
    const records = survey.getState().assessment.records;
    assert.equal(records[0].presentedAt, shown); assert.ok(records[0].answeredAt > shown); assert.equal(records[0].value, 0);
    assert.equal(records[1].value, null); assert.equal(records[1].answeredAt, null); assert.ok(records[1].skippedAt);
    assert.equal(records[1].missingReason, 'participant_skip');
    assert.equal(survey.answer('q1', 1, { chapterId: 'one' }).code, 'already_resolved');
    assert.equal(survey.answer('q2', 1, { chapterId: 'one' }).code, 'already_resolved');
    assert.equal(survey.skip('q1', { chapterId: 'one' }).code, 'already_resolved'); assert.equal(survey.getState().assessment.records[0].value, 0);
  });
});
test('only presented items and exact option values can be answered', () => {
  const { survey } = started(); survey.getNextBatch(1);
  for (const invalid of [-1, 2, '0', null, undefined, true, NaN, Infinity, {}]) assert.equal(survey.answer('q1', invalid, { chapterId: 1 }).code, 'invalid_value');
  assert.equal(survey.answer('q1', 0, { chapterId: 2 }).code, 'not_presented_in_chapter');
  assert.equal(survey.answer('q3', 0, { chapterId: 1 }).code, 'not_presented_in_chapter');
  assert.equal(survey.answer('missing', 0, { chapterId: 1 }).code, 'unknown_item'); assert.equal(survey.getState().assessment.records[0].status, 'presented');
  const { survey: labels } = started(config({ responseOptions: [{ value: 'A', label: '测试甲' }, { value: 'B', label: '测试乙' }] }));
  labels.getNextBatch(1); assert.equal(labels.answer('q1', 'A', { chapterId: 1 }).ok, true);
});
test('overdue is flagged without silently replacing the assessment', () => {
  withClock(Date.UTC(2026, 9, 20), (setTime) => {
    const { survey, store } = started(); const id = survey.getState().assessment.assessmentId; survey.getNextBatch(1);
    setTime(Date.UTC(2026, 9, 21, 1)); assert.equal(survey.getState().overdue, true);
    assert.equal(survey.beginAssessment().code, 'assessment_exists'); assert.equal(survey.getState().assessment.assessmentId, id);
    assert.equal(survey.answer('q1', 1, { chapterId: 1 }).ok, true);
    const restored = createSurvey(config(), store); assert.equal(restored.getState().assessment.assessmentId, id);
    assert.equal(restored.getState().assessment.overdue, true); assert.equal(JSON.parse(restored.exportData()).assessment.overdue, true);
  });
});
test('timely completion stays complete and timely on subsequent days', () => {
  withClock(Date.UTC(2026, 9, 20), (setTime) => {
    const { survey } = started(config({ items: [{ id: 'only', text: '仅技术占位符', originalOrder: 1 }] }));
    survey.getNextBatch(1); survey.answer('only', 1, { chapterId: 1 }); const id = survey.getState().assessment.assessmentId;
    setTime(Date.UTC(2026, 9, 23)); assert.equal(survey.getState().overdue, false); assert.equal(survey.getState().assessment.status, 'complete');
    assert.deepEqual(survey.getNextBatch(2), []); survey.beginAssessment(); assert.equal(survey.getState().assessment.assessmentId, id);
  });
});
test('withdrawal persists, stops future invitations and answers, and is locally deletable', () => {
  const { survey, store } = started(); survey.getNextBatch(1); survey.answer('q1', 1, { chapterId: 1 });
  const participant = survey.getState().participantId; assert.equal(survey.withdraw().ok, true);
  assert.equal(survey.getState().withdrawalRecords.length, 1); assert.equal(survey.withdraw().code, 'already_withdrawn');
  assert.equal(survey.getState().withdrawalRecords.length, 1); const restored = createSurvey(config(), store);
  assert.equal(restored.getState().participantId, participant); assert.deepEqual(restored.getNextBatch(2), []);
  assert.equal(restored.answer('q2', 0, { chapterId: 1 }).code, 'withdrawn'); assert.equal(restored.consent(true).code, 'withdrawn');
  assert.equal(restored.beginAssessment().code, 'withdrawn'); const out = JSON.parse(restored.exportData());
  assert.equal(out.assessment.records[0].value, 1); assert.ok(out.withdrawnAt); assert.equal(restored.clearData().ok, true);
  assert.equal(restored.getState().participantId, null); assert.equal(restored.getState().assessment, null);
  assert.deepEqual(restored.getState().withdrawalRecords, []); assert.equal(store.values.size, 0);
});
test('decline records only opt-out and no participant or assessment', () => {
  const store = storage(); const survey = createSurvey(config(), store); assert.equal(survey.consent(false).ok, true);
  assert.equal(survey.getState().consentStatus, 'declined'); assert.equal(survey.getState().participantId, null);
  assert.equal(survey.beginAssessment().code, 'declined'); assert.deepEqual(createSurvey(config(), store).getNextBatch(1), []);
});
test('export gives raw responses and missingness without scoring or identifying fields', () => {
  const { survey } = started(); survey.getNextBatch(1); survey.answer('q1', 0, { chapterId: 1 }); survey.skip('q2', { chapterId: 1 });
  const data = JSON.parse(survey.exportData()); assert.deepEqual(data.assessment.counts, { total: 5, answered: 1, skipped: 1, missing: 4 });
  assert.equal(data.scoring.computed, false);
  for (const key of ['score', 'totalScore', 'name', 'phone', 'employeeId', 'hp', 'energy', 'rngState']) {
    assert.equal(Object.prototype.hasOwnProperty.call(data, key), false); assert.equal(Object.prototype.hasOwnProperty.call(data.assessment, key), false);
  }
  assert.ok(data.participantId.startsWith('participant_'));
});
test('configuration changes cannot mix versions in one assessment', () => {
  const { survey, store } = started(); survey.getNextBatch(1); const changed = createSurvey(config({ scaleVersion: 'TEST-2' }), store);
  assert.equal(changed.isConfigured(), true); assert.equal(changed.getState().configMismatch, true); assert.deepEqual(changed.getNextBatch(2), []);
  assert.equal(changed.answer('q1', 1, { chapterId: 1 }).code, 'configuration_changed');
  assert.equal(JSON.parse(changed.exportData()).assessment.scaleVersion, 'TEST-1'); assert.equal(changed.withdraw().ok, true);
});
test('invalid configuration and failed or corrupt storage cannot silently collect', () => {
  for (const invalid of [{ recallWindow: null }, { itemsPerBreak: 3 }, { assessmentWindowHours: 0 },
    { responseOptions: [{ value: 0, label: '甲' }, { value: 0, label: '乙' }] },
    { items: [{ id: 'x', text: '测试', originalOrder: 1 }, { id: 'x', text: '测试', originalOrder: 2 }] }]) {
    assert.equal(createSurvey(config(invalid), storage()).isConfigured(), false);
  }
  const failed = createSurvey(config(), { getItem: () => null, setItem: () => false });
  assert.equal(failed.consent(true).ok, false); assert.equal(failed.getState().participantId, null);
  const broken = storage(); broken.setItem(`${STORAGE_PREFIX}technical-test-only`, 'broken-json'); const corrupt = createSurvey(config(), broken);
  assert.equal(corrupt.consent(true).code, 'storage_corrupt'); assert.equal(corrupt.clearData().ok, true); assert.equal(corrupt.consent(true).ok, true);
});

test('occupation is memory-only before consent and exported only after explicit consent', () => {
  const store = storage(); const survey = createSurvey(config(), store);
  assert.equal(survey.setParticipantContext({ occupation: 'medical_student' }).code, 'participant_context_pending');
  assert.equal(store.values.size, 0);
  assert.equal(survey.getState().participantContext, null);
  assert.equal(JSON.parse(survey.exportData()).participantContext, null);
  assert.equal(createSurvey(config(), store).getState().participantContext, null);
  survey.consent(true);
  assert.deepEqual(survey.getState().participantContext, { occupation: 'medical_student' });
  assert.deepEqual(JSON.parse(survey.exportData()).participantContext, { occupation: 'medical_student' });
  const restored = createSurvey(config(), store);
  assert.deepEqual(restored.getState().participantContext, { occupation: 'medical_student' });
  assert.equal(restored.setParticipantContext({ occupation: 'doctor' }).ok, true);
  assert.deepEqual(restored.getState().participantContext, { occupation: 'doctor' });
  restored.withdraw();
  assert.equal(restored.setParticipantContext({ occupation: 'other' }).code, 'withdrawn');
  assert.deepEqual(JSON.parse(restored.exportData()).participantContext, { occupation: 'doctor' });
});

test('occupation validates the three categories, forbids extra profile fields and respects opt-out', () => {
  const store = storage(); const survey = createSurvey(runtimeConfig, store);
  for (const invalid of [null, {}, { occupation: 'nurse' }, { occupation: '医生' }, { occupation: 'doctor', name: 'not-collected' }]) {
    assert.equal(survey.setParticipantContext(invalid).code, 'invalid_participant_context');
  }
  assert.equal(survey.setParticipantContext({ occupation: 'other' }).ok, true);
  assert.equal(store.values.size, 0); assert.equal(JSON.parse(survey.exportData()).participantContext, null);
  const declining = createSurvey(config(), storage()); declining.setParticipantContext({ occupation: 'doctor' }); declining.decline();
  assert.equal(declining.getState().participantContext, null);
  assert.equal(declining.setParticipantContext({ occupation: 'other' }).code, 'declined');
  const clearing = createSurvey(config(), storage()); clearing.setParticipantContext({ occupation: 'doctor' }); clearing.clearData(); clearing.consent(true);
  assert.equal(clearing.getState().participantContext, null);
});

test('reordered chapters keep source identifier and game order separate for presentation, answer and skip', () => {
  const { survey, store } = started();
  const batch = survey.getNextBatch(25, { gameOrder: 1 });
  assert.equal(batch[0].chapterId, 25); assert.equal(batch[0].sourceId, 25); assert.equal(batch[0].gameOrder, 1);
  let record = survey.getState().assessment.records[0];
  assert.equal(record.sourceId, 25); assert.equal(record.gameOrder, 1);
  assert.deepEqual(record.presentations.map((p) => [p.sourceId, p.gameOrder]), [[25, 1]]);
  assert.equal(survey.answer('q1', 1, { chapterId: 25, gameOrder: 1 }).ok, true);
  assert.equal(survey.skip('q2', { chapterId: 25, gameOrder: 1 }).ok, true);
  const exported = JSON.parse(createSurvey(config(), store).exportData());
  for (const r of exported.assessment.records.slice(0, 2)) {
    assert.equal(r.answeredChapterId, 25); assert.equal(r.sourceId, 25); assert.equal(r.gameOrder, 1);
  }
  assert.deepEqual(exported.assessment.batches[0].contexts, [{ sourceId: 25, gameOrder: 1 }]);
  assert.deepEqual(survey.getNextBatch(25, { gameOrder: 2 }), []);
  assert.deepEqual(survey.getNextBatch(1, { gameOrder: 2 }).map((i) => [i.sourceId, i.gameOrder]), [[1, 2], [1, 2]]);
});

test('missing gameOrder stays null and supplied answer order must match an actual presentation', () => {
  const { survey } = started(); survey.getNextBatch(28, { gameOrder: 3 });
  assert.equal(survey.answer('q1', 0, { chapterId: 28, gameOrder: 28 }).code, 'not_presented_in_context');
  assert.equal(survey.answer('q1', 0, { chapterId: 28 }).ok, true);
  assert.equal(survey.getState().assessment.records[0].gameOrder, 3);
  assert.equal(survey.skip('q2', { chapterId: 28 }).ok, true);
  survey.getNextBatch(9);
  assert.equal(survey.getState().assessment.records[2].gameOrder, null);
  survey.answer('q3', 1, { chapterId: 9 });
  assert.equal(survey.getState().assessment.records[2].sourceId, 9);
  assert.equal(survey.getState().assessment.records[2].gameOrder, null);
  assert.deepEqual(survey.getNextBatch(2, { gameOrder: -1 }), []);
  assert.equal(survey.skip('q4', { chapterId: 9, gameOrder: 1.5 }).code, 'invalid_game_order');
});

test('older saved survey without participant context loads without confusing source and display order', () => {
  const { survey, store } = started(); survey.getNextBatch(29);
  const key = survey.getState().storageKey; const legacy = JSON.parse(store.getItem(key));
  delete legacy.participantContext;
  for (const r of legacy.assessment.records) {
    delete r.sourceId; delete r.gameOrder;
    for (const p of r.presentations) { delete p.sourceId; delete p.gameOrder; }
  }
  for (const b of legacy.assessment.batches) delete b.contexts;
  store.setItem(key, JSON.stringify(legacy));
  const restored = createSurvey(config(), store);
  assert.equal(restored.getState().lastError, null); assert.equal(restored.getState().participantContext, null);
  assert.equal(restored.answer('q1', 0, { chapterId: 29 }).ok, true);
  const record = restored.getState().assessment.records[0];
  assert.equal(record.sourceId, 29); assert.equal(record.gameOrder, null);
});
