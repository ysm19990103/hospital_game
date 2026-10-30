'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./core');
const config = require('./server-config.json');
const bundle = require('./vendor');
const run = { runId: 'core-test-run', seed: 1, startedAt: Date.parse('2026-10-20T01:00:00Z') };
// These fixtures use the real bundled engine with test-only probability
// overrides. Production core always supplies the unchanged default rules.
const QUIET_RULES = {
  fatalRisk: { work: 0, research: 0, politics: 0 },
  beneficialRisk: { chief_duty_appointment: 0, national_grant_award: 0, record_speech_champion: 0 },
  lowHpEventChance: 0, lowHpAdditionalChance: 0,
  salaryPenaltyProbability: 0, statusEventProbability: 0, recoveryEventProbability: 0,
};
function rulesBundle(overrides = {}) {
  return { ...bundle, createGame: (chapters, options) => bundle.createGame(chapters, { ...options, rules: { ...QUIET_RULES, ...overrides } }) };
}
const quietBundle = rulesBundle();
const fatalBundle = rulesBundle({ fatalRisk: { work: 1, research: 0, politics: 0 } });
const replay = (operations, override = {}) => core.replayRun(run, operations, { ...config, ...override }, quietBundle);

test('Beijing midnight is UTC16:00 independent of host timezone', () => {
  const before = core.dayWindow(Date.parse('2026-10-20T15:59:59.999Z'));
  const after = core.dayWindow(Date.parse('2026-10-20T16:00:00Z'));
  assert.equal(before.dayId, '2026-10-20');
  assert.equal(after.dayId, '2026-10-21');
  assert.equal(before.nextUpdateAt, after.snapshotAt);
});
test('reject score/state/rules/debug injection and unsupported metrics', () => {
  for (const op of [{ method: 'load', state: {} }, { method: 'newGame' }, { method: 'act', action: { type: 'forceEvent', eventId: 'national_grant_award' } }, { method: 'act', action: { type: 'rest', money: 999 } }]) {
    assert.throws(() => core.normalizeOperation(op, config), { code: 'invalid_operation' });
  }
  assert.throws(() => replay([], { longestMetric: 'activeMinutes' }), { code: 'unsupported_metric' });
});
test('server replay matches seed, records real resource effects and generates authoritative save', () => {
  const operations = Array.from({ length: 6 }, () => ({ method: 'act', action: { type: 'rest' } }));
  const first = replay(operations); const second = replay(operations);
  assert.equal(first.peakActionCount, 6);
  assert.equal(first.peakMoney, second.peakMoney);
  assert.deepEqual(first.saveData, second.saveData);
  assert.equal(first.state.completedDays, 1);
});
test('death restore uses server checkpoint and preserves lifetime run peaks', () => {
  const replayFatal = (operations, override = {}) => core.replayRun(run, operations, { ...config, ...override }, fatalBundle);
  const work = { method: 'act', action: { type: 'work' } };
  const dead = replayFatal([work]);
  assert.equal(dead.state.status, 'failure');
  assert.deepEqual(dead.saveData, replayFatal([work]).saveData);
  assert.equal(dead.state.failure.deathId, undefined);
  assert.equal(dead.saveData.state.failure.memorialRecord, undefined);
  const restored = replayFatal([work, { method: 'restoreCheckpoint' }]);
  assert.equal(restored.state.status, 'playing');
  assert.equal(restored.state.actionCount, 0);
  assert.equal(restored.peakActionCount, 1);
  assert.equal(restored.peakMoney, dead.peakMoney);
  assert.equal(restored.restoreCount, 1);
  assert.throws(() => replayFatal([work, { method: 'restoreCheckpoint' }], { restorePolicy: 'reject' }), { code: 'restore_rejected' });
});
test('spent or restored coins never overwrite a previously reached run peak', () => {
  const chapter = { ...bundle.chapters[0], presentation: 'scene', choices: [{ id: 'reward', requiresClues: 0, effects: { money: 50 }, ending: { title: 'fixture', text: 'fixture', tone: 'hope' } }] };
  const result = core.replayRun(run, [{ method: 'chooseEnding', choiceId: 'reward' }, { method: 'restoreCheckpoint' }], config, { ...bundle, chapters: [chapter] });
  assert.equal(result.peakMoney, result.state.money + 50);
});
test('chapter replay can return only to reached source chapters, never inject checkpoint state', () => {
  assert.throws(() => replay([{ method: 'startChapter', chapterId: bundle.chapters[1].id }]), { code: 'chapter_order' });
  assert.throws(() => replay([{ method: 'startChapter', chapterId: bundle.chapters[1].id, params: { replay: true } }]), { code: 'operation_rejected' });
  const first = bundle.chapters[0].id;
  const result = replay([{ method: 'act', action: { type: 'rest' } }, { method: 'startChapter', chapterId: first, params: { replay: true } }]);
  assert.equal(result.state.actionCount, 0); assert.equal(result.peakActionCount, 1);
});
test('timer marker is not authentication: require secret and no client OPENID', () => {
  const secret = 'test-only-secret-with-over-thirty-two-characters';
  const event = { Type: 'Timer', TriggerName: config.timerName, Message: JSON.stringify({ secret }) };
  assert.equal(core.isTrustedTimer(event, null, secret, config.timerName), true);
  assert.equal(core.isTrustedTimer(event, 'client-openid', secret, config.timerName), false);
  assert.equal(core.isTrustedTimer({ ...event, Message: '{}' }, null, secret, config.timerName), false);
});
test('anonymous ids are keyed, stable and never expose raw openid', () => {
  const secret = 'test-only-secret-with-over-thirty-two-characters';
  const player = core.anonymousPlayer('private-openid', secret);
  assert.deepEqual(player, core.anonymousPlayer('private-openid', secret));
  assert.equal(JSON.stringify(player).includes('private-openid'), false);
  assert.throws(() => core.anonymousPlayer('', secret), { code: 'unauthenticated' });
});
test('longest board carries exact actionCount plus survival day', () => {
  const entry = core.publicEntry({ playerId: 'x', nickname: '匿名', longest: 5, longestRunId: 'r', longestAt: run.startedAt }, 'longest');
  assert.equal(entry.score, 5); assert.equal(entry.actionCount, 5); assert.equal(entry.survivalDays, 2);
});

// Fixed authoritative state stream tests the leaderboard consumer independently
// of the engine's idle-clock implementation and its random event distribution.
function scoreStreamBundle(survivalValues) {
  return {
    ...bundle,
    createGame() {
      let index = 0;
      const state = { status: 'playing', actionCount: 100, money: 0 };
      if (survivalValues) state.survivalActionCount = survivalValues[0];
      return {
        state,
        act() {
          state.actionCount += 1;
          index += 1;
          if (survivalValues) state.survivalActionCount = survivalValues[index];
          return { ok: true };
        },
        save() { return { data: { state: { ...state }, checkpoint: { ...state }, chapterStarts: {} } }; },
      };
    },
  };
}
test('survival reset and clinical recovery preserve the historical peak without using story calendar', () => {
  const rest = { method: 'act', action: { type: 'rest' } };
  const clinical = { method: 'act', action: { type: 'clinical', questionId: 'first_clinical', answer: 0 } };
  const nextClinical = { method: 'act', action: { type: 'clinical', questionId: 'second_clinical', answer: 0 } };
  // The trusted engine reports: peak 34, thirty-fifth idle unit resets to 0,
  // further idle action stays at 0, first clinical action restarts at 1.
  const stream = scoreStreamBundle([33, 34, 0, 0, 1, ...Array.from({length:34},(_,i)=>i+2)]);
  const operations = [rest, rest, rest, clinical, ...Array(33).fill(rest), nextClinical];
  const reset = core.replayRun(run, operations.slice(0, 3), config, stream);
  assert.equal(reset.state.actionCount, 103);
  assert.equal(reset.state.survivalActionCount, 0);
  assert.equal(reset.peakActionCount, 34);
  const recovered = core.replayRun(run, operations.slice(0, 4), config, stream);
  assert.equal(recovered.state.survivalActionCount, 1);
  assert.equal(recovered.peakActionCount, 34);
  const improved = core.replayRun(run, operations, config, stream);
  assert.equal(improved.state.actionCount, 138);
  assert.equal(improved.peakActionCount, 35);
});
test('legacy engines fall back to calendar actionCount only when survival field is absent', () => {
  const operations = [{ method: 'act', action: { type: 'rest' } }];
  const legacy = core.replayRun(run, operations, config, scoreStreamBundle());
  assert.equal(legacy.peakActionCount, 101);
  const zero = core.replayRun(run, operations, config, scoreStreamBundle([0, 0]));
  assert.equal(zero.peakActionCount, 0);
});

test('real bundled engine uses stable run namespace, retains event metadata, and leaves RNG independent of run ID', () => {
  const operations = [{ method: 'act', action: { type: 'work' } }];
  const result = core.replayRun({ ...run, runId: 'server-run-17' }, operations, config, fatalBundle);
  const sameRun = core.replayRun({ ...run, runId: 'server-run-17' }, operations, config, fatalBundle);
  const differentRun = core.replayRun({ ...run, runId: 'server-run-18' }, operations, config, fatalBundle);
  assert.equal(result.state.lastTriggeredEvent.occurrenceId, 'server-run-17:1');
  assert.deepEqual(result.saveData.state.lastTriggeredEvent, result.state.lastTriggeredEvent);
  assert.deepEqual(result.state.lastTriggeredEvent, sameRun.state.lastTriggeredEvent);
  assert.equal(differentRun.state.lastTriggeredEvent.occurrenceId, 'server-run-18:1');
  assert.equal(result.state._rng, differentRun.state._rng);
});

test('real video chapter advances one day and score once through deterministic replay', () => {
  const chapter = bundle.chapters[0];
  assert.equal(chapter.presentation, 'video', 'build current real chapter data before running cloud tests');
  const operation = { method: 'completeVideo', chapterId: chapter.id };
  assert.deepEqual(core.normalizeOperation(operation, config), operation);
  assert.throws(() => core.normalizeOperation({ ...operation, money: 1000 }, config), { code: 'invalid_operation' });
  const before = replay([]);
  const after = replay([operation]);
  const repeated = replay([operation, operation]);
  assert.equal(after.state.actionCount, before.state.actionCount);
  assert.equal(after.state.videoDays, before.state.videoDays + 1);
  assert.equal(after.state.completedDays, before.state.completedDays + 1);
  assert.equal(after.state.money, before.state.money);
  assert.equal(after.state.hp, before.state.hp);
  assert.equal(after.state.energy, before.state.energy);
  assert.equal(after.peakActionCount, before.peakActionCount + 5);
  assert.equal(after.peakMoney, before.peakMoney);
  assert.deepEqual(after.state.completedVideos, [chapter.id]);
  assert.deepEqual(after.state.clues, chapter.clues.map((clue) => clue.id));
  assert.deepEqual(after.state, repeated.state);
  assert.deepEqual(after.saveData,replay([operation]).saveData);
  assert.throws(() => replay([{ method: 'completeVideo', chapterId: bundle.chapters[1].id }]), { code: 'operation_rejected' });
});

test('video completion uses source IDs after a reordered real chapter, never gameOrder', () => {
  const reordered = bundle.chapters.find((chapter) => String(chapter.id) !== String(chapter.gameOrder));
  assert.ok(reordered);
  const chapterBundle = { ...quietBundle, chapters: [reordered] };
  const result = core.replayRun(run, [{ method: 'completeVideo', chapterId: reordered.id }], config, chapterBundle);
  assert.deepEqual(result.state.completedVideos, [reordered.id]);
  assert.throws(() => core.replayRun(run, [{ method: 'completeVideo', chapterId: reordered.gameOrder }], config, chapterBundle), { code: 'operation_rejected' });
});

test('server replay reconstructs immutable first answers from run snapshot and operation history', () => {
  const question = bundle.knowledge[0];
  const op = { method: 'act', action: { type: 'clinical', questionId: question.id, answer: question.correctIndex } };
  const first = replay([op]);
  assert.equal(first.questionHistory.length, 1);
  assert.equal(first.questionHistory[0].questionId, question.id);
  assert.deepEqual(replay([op]), first, 'replaying a log does not inherit an earlier replay memory');
  const restored = replay([op, { method: 'restoreCheckpoint' }]);
  assert.deepEqual(restored.questionHistory, first.questionHistory);
  assert.throws(() => replay([op, { method: 'restoreCheckpoint' }, op]), { code: 'no_op' });
  const laterRun = { ...run, runId: 'later-run', questionHistorySnapshot: first.questionHistory };
  const later = core.replayRun(laterRun, [], config, quietBundle);
  assert.deepEqual(later.questionHistory, first.questionHistory);
  assert.throws(() => core.replayRun(laterRun, [op], config, quietBundle), { code: 'no_op' });
  assert.equal(later.state.actionCount, 0);
});
