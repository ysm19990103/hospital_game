'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./core');
const config = require('./server-config.json');
const { createGame } = require('../../src/engine');
const { createQuestionHistory } = require('../../src/question-history');
const chapters = require('../../data/chapters.json');
const npcs = require('../../data/npcs.json');
const knowledge = require('../../data/knowledge.json');
const sideStories = require('../../data/side-stories.json');
const run = { runId: 'side-video-replay-test', seed: 42, startedAt: Date.parse('2026-10-26T05:00:00Z') };
const quietRules = {
  statusEventProbability: 0, recoveryEventProbability: 0,
  lowHpEventChance: 0, lowHpAdditionalChance: 0, salaryPenaltyProbability: 0,
  fatalRisk: { work: 0, research: 0, politics: 0 },
  beneficialRisk: { chief_duty_appointment: 0, national_grant_award: 0, record_speech_champion: 0 },
};
const bundle = {
  chapters, npcs, knowledge, createQuestionHistory,
  createGame: (data, options) => createGame(data, { ...options, sideStories, rules: quietRules }),
};
const op = id => ({ method: 'completeSideVideo', sideStoryId: id });
const replay = operations => core.replayRun(run, operations, config, bundle);

test('side-video protocol accepts only the operation and catalog identifier', () => {
  assert.deepEqual(core.normalizeOperation(op('huangning_origin'), config), op('huangning_origin'));
  for (const invalid of [
    { ...op('huangning_origin'), advancedDays: 100 },
    { ...op('huangning_origin'), state: {} },
    { method: 'completeSideVideo', chapterId: 1 },
    op('../other'), op(null), op(1), op({ id: 'huangning_origin' }),
  ]) assert.throws(() => core.normalizeOperation(invalid, config), { code: 'invalid_operation' });
});

test('side story replay adds one elapsed day and score without completing main-story content', () => {
  const before = replay([]);
  const after = replay([op('huangning_origin')]);
  assert.equal(after.state.videoDays, before.state.videoDays + 1);
  assert.equal(after.state.completedDays, before.state.completedDays + 1);
  assert.equal(after.state.actionCount, before.state.actionCount);
  assert.equal(after.peakActionCount, before.peakActionCount + 5);
  assert.equal(after.peakMoney, before.peakMoney);
  assert.deepEqual(after.state.completedSideVideos, ['huangning_origin']);
  for (const field of ['chapterId', 'completedVideos', 'chapterResults', 'clues', 'allClues', 'money', 'hp', 'energy']) {
    assert.deepEqual(after.state[field], before.state[field], field);
  }
  assert.deepEqual(after.saveData, replay([op('huangning_origin')]).saveData);
});

test('duplicate side completion cannot mint additional elapsed days or leaderboard score', () => {
  const once = replay([op('huangning_origin')]);
  const twice = replay([op('huangning_origin'), op('huangning_origin')]);
  assert.deepEqual(twice.state, once.state);
  assert.equal(twice.peakActionCount, once.peakActionCount);
  assert.equal(twice.peakMoney, once.peakMoney);
});

test('authoritative replay rejects unknown and chronologically locked side stories', () => {
  assert.throws(() => replay([op('unknown_side')]), { code: 'operation_rejected' });
  assert.throws(() => replay([op('huangning_reunion')]), { code: 'operation_rejected' });
  const reached = replay([op('huangning_origin'), op('huangning_reunion')]);
  assert.deepEqual(reached.state.completedSideVideos, ['huangning_origin', 'huangning_reunion']);
  assert.equal(reached.state.completedDays, 2);
  assert.equal(reached.peakActionCount, 10);
});

test('local and server side-story histories reproduce identical saves and state', () => {
  const operations = [
    { method: 'act', action: { type: 'rest' } },
    op('limuliang_city_god'),
    { method: 'checkpoint', label: '城隍梦之后' },
    op('limuliang_dice'),
    { method: 'restoreCheckpoint' },
  ];
  const local = bundle.createGame(chapters, {
    seed: run.seed, occurrenceNamespace: run.runId,
    questionHistory: createQuestionHistory(), npcs, knowledge, clock: () => run.startedAt,
  });
  for (const operation of operations) {
    const reply = operation.method === 'act' ? local.act(operation.action)
      : operation.method === 'completeSideVideo' ? local.completeSideVideo(operation.sideStoryId)
      : operation.method === 'checkpoint' ? local.checkpoint(operation.label)
      : local.restoreCheckpoint();
    assert.equal(reply.ok, true, reply.message);
  }
  const server = replay(operations);
  assert.deepEqual(server.state, local.state);
  assert.deepEqual(server.saveData, local.save().data);
  assert.deepEqual(server.state.completedSideVideos, ['limuliang_city_god']);
  assert.equal(server.state.videoDays, 1);
  assert.equal(server.peakActionCount, 11);
});

