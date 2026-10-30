'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLeaderboard, beijingWindow, STORAGE_KEY } = require('../src/leaderboard');

function memoryStorage() {
  const data = new Map();
  return { data, getItem: (key) => data.get(key), setItem(key, value) { data.set(key, value); return true; } };
}
function setup(config = {}, transport) {
  const storage = memoryStorage(); let time = Date.parse('2026-10-20T15:59:00Z');
  const boards = createLeaderboard({ ...config, clock: () => time }, storage, transport);
  return { boards, storage, advance: (milliseconds) => { time += milliseconds; }, setTime: (value) => { time = Date.parse(value); } };
}
const onlineConfig = { enabled: true, envId: 'unit-test-env' };
const operation = { method: 'act', action: { type: 'rest' } };

function fakeServer() {
  const calls = []; let seq = 0; const history = []; let loseResponse = false;
  const transport = async (payload, meta) => {
    calls.push({ payload, meta });
    if (payload.action === 'startRun') { seq = 0; history.length = 0; return { ok: true, runId: 'server-run', seed: 123, seq, saveData: { version: 2, state: { actionCount: 0 } } }; }
    if (payload.action === 'appendOperations') {
      if (payload.expectedSeq < seq) {
        assert.deepEqual(history.slice(payload.expectedSeq, payload.expectedSeq + payload.operations.length), payload.operations);
      } else { assert.equal(payload.expectedSeq, seq); history.push(...payload.operations); seq += payload.operations.length; }
      if (loseResponse) { loseResponse = false; throw new Error('response_lost_after_commit'); }
      return { result: { ok: true, runId: 'server-run', seq, saveData: { version: 2, state: { actionCount: seq } } } };
    }
    if (payload.action === 'getRun') return { ok: true, runId: 'server-run', seq, saveData: { version: 2, state: { actionCount: seq } } };
    if (payload.action === 'getBoards') return { ok: true, boards: { longest: [], wealthiest: [] }, snapshotAt: '2026-10-19T16:00:00Z', nextUpdateAt: '2026-10-20T16:00:00Z', serverTime: '2026-10-20T10:00:00Z' };
    throw new Error('unexpected_action');
  };
  return { calls, transport, loseNext: () => { loseResponse = true; }, sequence: () => seq };
}

test('real Beijing midnight is UTC 16:00, independent of game days', () => {
  assert.deepEqual(beijingWindow(Date.parse('2026-10-20T15:59:59Z')), {
    dayKey: '2026-10-20', snapshotAt: '2026-10-19T16:00:00.000Z', nextUpdateAt: '2026-10-20T16:00:00.000Z',
  });
  assert.equal(beijingWindow(Date.parse('2026-10-20T16:00:00Z')).dayKey, '2026-10-21');
});

test('daily device boards freeze until midnight; current best remains visible separately', () => {
  const { boards, advance } = setup();
  boards.startLocalRun(); boards.observeState({ actionCount: 11, money: 90, day: 5000, status: 'playing' });
  const first = boards.getLocalBoards();
  assert.equal(first.label, '本机纪录'); assert.equal(first.verified, false);
  assert.deepEqual(first.boards, { longest: [], wealthiest: [] });
  assert.equal(first.currentBest.longest.score, 11);
  assert.equal(first.currentBest.longest.survivalDays, 3);
  advance(60000);
  assert.equal(boards.getLocalBoards().boards.longest[0].score, 11);
  boards.observeState({ actionCount: 21, money: 120, status: 'playing' });
  assert.equal(boards.getLocalBoards().boards.longest[0].score, 11);
  assert.equal(boards.getLocalBoards().currentBest.longest.score, 21);
  advance(86400000);
  assert.equal(boards.getLocalBoards().boards.longest[0].score, 21);
});

test('death, checkpoint restore and a later improved attempt retain single-run peaks', () => {
  const { boards } = setup();
  const run = boards.startLocalRun().run;
  boards.observeState({ actionCount: 19, money: 300, status: 'failure' });
  boards.observeState({ actionCount: 5, money: 20, status: 'playing' });
  assert.equal(boards.getState().run.id, run.id);
  assert.equal(boards.getState().run.peakActionCount, 19);
  assert.equal(boards.getState().run.peakMoney, 300);
  boards.observeState({ actionCount: 22, money: 95, status: 'playing' });
  assert.equal(boards.getLocalBoards().currentBest.longest.score, 22);
  assert.equal(boards.getLocalBoards().currentBest.wealthiest.score, 300);
});

test('survival reset cannot inherit calendar progress or remove an already achieved record', () => {
  const { boards, advance } = setup();
  const runId = boards.startLocalRun().run.id;
  boards.observeState({ actionCount: 44, survivalActionCount: 9, money: 300 });
  boards.observeState({ actionCount: 45, survivalActionCount: 0, money: 100 });
  boards.observeState({ actionCount: 53, survivalActionCount: 0, money: 110 });
  assert.equal(boards.getState().run.id, runId);
  assert.equal(boards.getState().run.peakActionCount, 9);
  assert.equal(boards.getLocalBoards().currentBest.longest.score, 9);
  assert.equal(boards.getLocalBoards().currentBest.longest.survivalDays, 2);
  advance(60000);
  assert.equal(boards.getLocalBoards().boards.longest[0].score, 9);
  assert.equal(boards.getLocalBoards().boards.wealthiest[0].score, 300);
  // The first clinical action restarts counting; a later streak can beat the old peak.
  boards.observeState({ actionCount: 54, survivalActionCount: 1, money: 110 });
  assert.equal(boards.getState().run.peakActionCount, 9);
  boards.observeState({ actionCount: 64, survivalActionCount: 11, money: 120 });
  assert.equal(boards.getLocalBoards().currentBest.longest.score, 11);
  // Loading a prior plot node does not roll back the independent survival streak.
  boards.observeState({ actionCount: 3, survivalActionCount: 12, money: 30 });
  assert.equal(boards.getLocalBoards().currentBest.longest.score, 12);
  assert.equal(boards.getLocalBoards().boards.longest[0].score, 9);
});

test('legacy states use calendar count only when the survival counter is absent', () => {
  const { boards } = setup();
  boards.observeState({ actionCount: 8, money: 0 });
  assert.equal(boards.getState().run.peakActionCount, 8);
  boards.startLocalRun();
  boards.observeState({ actionCount: 100, survivalActionCount: 0, money: 0 });
  assert.equal(boards.getState().run.peakActionCount, 0);
  for (const invalid of [null, -1, NaN, '3']) {
    assert.equal(boards.observeState({ actionCount: 100, survivalActionCount: invalid, money: 0 }).code, 'invalid_game_state');
  }
  assert.equal(boards.getState().run.peakActionCount, 0);
});

test('new game resets run peaks but keeps the player all-time records, without summing runs', () => {
  const { boards } = setup();
  const playerId = boards.getState().player.id;
  const firstId = boards.startLocalRun().run.id;
  boards.observeState({ actionCount: 15, money: 500 });
  const second = boards.startLocalRun();
  assert.notEqual(second.run.id, firstId); assert.equal(second.player.id, playerId);
  boards.observeState({ actionCount: 12, money: 600 });
  const best = boards.getLocalBoards().currentBest;
  assert.equal(best.longest.score, 15); assert.equal(best.longest.runId, firstId);
  assert.equal(best.wealthiest.score, 600); assert.equal(best.wealthiest.runId, second.run.id);
  assert.equal(boards.getState().run.peakActionCount, 12);
});

test('storage namespace and anonymous profile never read or change game or survey records', () => {
  const storage = memoryStorage();
  storage.data.set('baiyi-game-save-v2', 'game-original');
  storage.data.set('baiyi.research.survey.v1:pilot', 'research-original');
  const boards = createLeaderboard({}, storage);
  boards.observeState({ actionCount: 7, money: 45, name: 'should never be stored', phone: 'private' });
  assert.equal(storage.data.get('baiyi-game-save-v2'), 'game-original');
  assert.equal(storage.data.get('baiyi.research.survey.v1:pilot'), 'research-original');
  const raw = storage.data.get(STORAGE_KEY);
  assert.ok(!raw.includes('private')); assert.ok(!raw.includes('should never be stored'));
  const reloaded = createLeaderboard({}, storage);
  assert.deepEqual(reloaded.getState().player, boards.getState().player);
  assert.equal(reloaded.getState().run.peakMoney, 45);
  const view = reloaded.getState(); view.run.peakMoney = 9999;
  assert.equal(reloaded.getState().run.peakMoney, 45);
});

test('invalid local observations and unfinished config cannot fabricate a connected board', async () => {
  let calls = 0;
  const { boards } = setup({}, async () => { calls += 1; return { ok: true }; });
  assert.equal(boards.observeState({ actionCount: -1, money: 0 }).ok, false);
  assert.equal(boards.observeState({ actionCount: 2, money: NaN }).ok, false);
  assert.equal(boards.getState().run, null);
  assert.equal((await boards.startOnlineRun()).code, 'online_not_configured');
  assert.equal((await boards.refreshBoards()).code, 'online_not_configured');
  assert.equal(calls, 0); assert.equal(boards.getState().online.connected, false);
  assert.equal(boards.getState().online.label, '全服榜未配置');
  const missingEnv = setup({ enabled: true }, async () => { calls += 1; }).boards;
  assert.equal((await missingEnv.startOnlineRun()).ok, false); assert.equal(calls, 0);
});

test('online actions are serial, use server-issued run and seed, and never transmit observed scores', async () => {
  const server = fakeServer(); const { boards } = setup(onlineConfig, server.transport);
  boards.observeState({ actionCount: 999999, money: 999999 });
  const start = await boards.startOnlineRun(); assert.equal(start.seed, 123);
  await Promise.all([boards.appendOperations([operation]), boards.appendOperations([operation])]);
  const payloads = server.calls.map((c) => c.payload);
  assert.deepEqual(payloads[0], { action: 'startRun' });
  assert.equal(payloads[1].expectedSeq, 0); assert.equal(payloads[2].expectedSeq, 1);
  assert.ok(!JSON.stringify(payloads).includes('999999'));
  assert.equal(boards.getState().online.run.seq, 2); assert.equal(boards.getState().online.connected, true);
  assert.equal(server.calls[0].meta.envId, 'unit-test-env');
});

test('response loss keeps a persistent queue and retries the same sequence without duplicating actions', async () => {
  const server = fakeServer(); const { boards, storage } = setup(onlineConfig, server.transport);
  await boards.startOnlineRun(); server.loseNext();
  assert.equal((await boards.appendOperations([operation])).queued, true);
  assert.equal(server.sequence(), 1); assert.equal(boards.getState().online.pendingCount, 1);
  const reloaded = createLeaderboard(onlineConfig, storage, server.transport);
  assert.equal(reloaded.getState().online.connected, false);
  const response = await reloaded.resumeOnlineRun();
  assert.equal(response.ok, true); assert.equal(response.saveData.state.actionCount, 1);
  assert.equal(server.sequence(), 1); assert.equal(reloaded.getState().online.pendingCount, 0);
  assert.equal(server.calls.at(-1).payload.action, 'getRun');
});

test('large operation groups are split to the server batch limit and all acknowledgements advance sequence', async () => {
  const server = fakeServer(); const { boards } = setup(onlineConfig, server.transport);
  await boards.startOnlineRun();
  assert.equal((await boards.appendOperations(Array.from({ length: 65 }, () => operation))).ok, true);
  assert.deepEqual(server.calls.filter((c) => c.payload.action === 'appendOperations').map((c) => c.payload.operations.length), [30, 30, 5]);
  assert.equal(boards.getState().online.run.seq, 65);
});

test('checkpoint replay, chapter replay and hint purchase are operations; debug, score and save injection are rejected locally', async () => {
  const server = fakeServer(); const { boards } = setup(onlineConfig, server.transport);
  await boards.startOnlineRun();
  for (const bad of [
    { method: 'setScore', score: 500 }, { method: 'load', save: '{}' },
    { method: 'act', action: { type: 'forceEvent', eventId: 'record_failure' } },
    { method: 'act', action: { type: 'work', money: 500 } }, { method: '__proto__' },
  ]) assert.equal((await boards.appendOperations([bad])).code, 'invalid_operations');
  const valid = [
    { method: 'checkpoint', label: '长夜' }, { method: 'restoreCheckpoint' },
    { method: 'startChapter', chapterId: 1, params: { replay: true } },
    { method: 'buyMonthlyHint', expectedQuestionId: 'q1' },
    { method: 'answerMonthly', answerIndex: 1, expectedQuestionId: 'q1' },
    { method: 'act', action: { type: 'entertain' } },
  ];
  assert.equal((await boards.appendOperations(valid)).ok, true);
  assert.equal(server.sequence(), valid.length);
});

test('changing cloud environment cannot replay another environment queue or claim its connection', async () => {
  const server = fakeServer(); const { boards, storage } = setup(onlineConfig, server.transport);
  await boards.startOnlineRun(); server.loseNext(); await boards.appendOperations([operation]);
  const other = createLeaderboard({ ...onlineConfig, envId: 'different-env' }, storage, server.transport);
  assert.equal(other.getState().online.run, null);
  assert.equal(other.getState().online.pendingCount, 0);
  assert.equal((await other.resumeOnlineRun()).code, 'no_online_run');
});

test('board refresh uses server timestamps, and a failed connection is honestly reported', async () => {
  const server = fakeServer(); const { boards } = setup(onlineConfig, server.transport);
  await boards.refreshBoards();
  assert.equal(boards.getState().online.snapshotAt, '2026-10-19T16:00:00Z');
  const failing = setup(onlineConfig, async () => { throw new Error('offline'); }).boards;
  assert.equal((await failing.refreshBoards()).code, 'network_error');
  assert.equal(failing.getState().online.status, 'error');
  assert.equal(failing.getState().online.connected, false);
});

test('unknown metric never masquerades as a supported active-minute ranking', async () => {
  const { boards } = setup({ ...onlineConfig, longestMetric: 'activeMinutes' }, async () => { throw new Error('should not call'); });
  assert.ok(boards.getState().online.configurationErrors.includes('unsupported_longest_metric'));
  assert.equal((await boards.startOnlineRun()).code, 'online_not_configured');
});

test('clock rollback does not republish the daily board; corrupt storage is not overwritten', () => {
  const { boards, setTime } = setup(); boards.observeState({ actionCount: 10, money: 50 });
  setTime('2026-10-20T16:00:00Z'); const snapshot = boards.getLocalBoards();
  setTime('2026-10-19T16:00:00Z'); assert.deepEqual(boards.getLocalBoards().boards, snapshot.boards);
  const storage = memoryStorage(); storage.data.set(STORAGE_KEY, 'broken json');
  const broken = createLeaderboard({}, storage); broken.observeState({ actionCount: 1, money: 1 });
  assert.equal(broken.getState().storageError, 'storage_corrupt'); assert.equal(storage.data.get(STORAGE_KEY), 'broken json');
});
