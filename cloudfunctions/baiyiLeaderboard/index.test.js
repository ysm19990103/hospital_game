'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('./core');
const config = require('./server-config.json');
const bundle = require('./vendor');
const copy = (value) => JSON.parse(JSON.stringify(value));

function serverHarness() {
  let rows = new Map();
  const client = (records) => ({ collection: (collection) => ({ doc: (id) => ({
    async get() { return { data: records.has(`${collection}/${id}`) ? copy(records.get(`${collection}/${id}`)) : null }; },
    async set({ data }) { records.set(`${collection}/${id}`, copy(data)); },
  }) }) });
  const db = { collection: (name) => client(rows).collection(name), async runTransaction(callback) {
    const next = new Map(Array.from(rows, ([key, value]) => [key, copy(value)]));
    const result = await callback(client(next));
    rows = next;
    return { result };
  } };
  const cloud = { init() {}, DYNAMIC_CURRENT_ENV: 'test', database: () => db, getWXContext: () => ({ OPENID: 'test-player-openid' }) };
  const authoritative = { ...bundle, createGame: (chapters, options) => bundle.createGame(chapters, { ...options, rules: {
    fatalRisk: { work: 0, research: 0, politics: 0 },
    beneficialRisk: { chief_duty_appointment: 0, national_grant_award: 0, record_speech_champion: 0 },
    lowHpEventChance: 0, lowHpAdditionalChance: 0, salaryPenaltyProbability: 0, statusEventProbability: 0, recoveryEventProbability: 0,
  } }) };
  const exports = {};
  const dependencies = { 'wx-server-sdk': cloud, 'node:crypto': require('node:crypto'), './server-config.json': { ...config, enabled: true }, './core': core, './vendor': authoritative };
  vm.runInNewContext(fs.readFileSync(require.resolve('./index'), 'utf8'), {
    exports, require(name) { assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name]; },
    process: { env: { LEADERBOARD_PLAYER_SECRET: 'test-only-player-secret-more-than-thirty-two-characters' } },
  }, { filename: 'baiyiLeaderboard/index.js' });
  return { request: async (event) => copy(await exports.main(event)), records: () => Array.from(rows, ([key, value]) => ({ key, value: copy(value) })) };
}

test('cloud account answer history survives new runs while old runs stay readable and retry-safe', async () => {
  const server = serverHarness();
  const first = await server.request({ action: 'startRun' });
  assert.equal(first.ok, true);
  assert.deepEqual(first.questionHistorySnapshot, []);
  const question = bundle.knowledge[0];
  const operations = [{ method: 'act', action: { type: 'clinical', questionId: question.id, answer: question.correctIndex } }];
  const answered = await server.request({ action: 'appendOperations', runId: first.runId, expectedSeq: 0, operations });
  assert.equal(answered.ok, true);
  assert.equal(answered.questionHistory.length, 1);
  assert.equal(answered.questionHistory[0].questionId, question.id);
  assert.deepEqual(answered.questionHistorySnapshot, []);
  const retry = await server.request({ action: 'appendOperations', runId: first.runId, expectedSeq: 0, operations });
  assert.equal(retry.replayed, true);
  assert.equal(retry.seq, 1);
  assert.deepEqual(retry.saveData, answered.saveData);

  const second = await server.request({ action: 'startRun' });
  assert.equal(second.ok, true);
  assert.notEqual(second.runId, first.runId);
  assert.deepEqual(second.questionHistorySnapshot, answered.questionHistory);
  const repeated = await server.request({ action: 'appendOperations', runId: second.runId, expectedSeq: 0, operations });
  assert.equal(repeated.ok, false);
  assert.equal(repeated.code, 'no_op');
  const unchanged = await server.request({ action: 'getRun', runId: second.runId });
  assert.equal(unchanged.seq, 0);
  assert.equal(unchanged.state.actionCount, 0);

  const oldRead = await server.request({ action: 'getRun', runId: first.runId });
  assert.equal(oldRead.readOnly, true);
  assert.deepEqual(oldRead.saveData, answered.saveData);
  const oldWrite = await server.request({ action: 'appendOperations', runId: first.runId, expectedSeq: 1, operations: [{ method: 'act', action: 'rest' }] });
  assert.equal(oldWrite.code, 'run_read_only');
  const oldRetry = await server.request({ action: 'appendOperations', runId: first.runId, expectedSeq: 0, operations });
  assert.equal(oldRetry.ok, true);
  assert.equal(oldRetry.readOnly, true);
  assert.equal(oldRetry.seq, 1);
  const buckets = server.records().filter(({ key }) => key.startsWith('baiyi_ranked_daily/'));
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].value.longest, answered.peakActionCount);
});

test('cloud records one video day and keeps retries idempotent while rejecting client history or saves', async () => {
  const server = serverHarness();
  assert.equal((await server.request({ action: 'startRun', questionHistory: [] })).code, 'invalid_request');
  const started = await server.request({ action: 'startRun' });
  const completed = await server.request({ action: 'appendOperations', runId: started.runId, expectedSeq: 0,
    operations: [{ method: 'completeVideo', chapterId: bundle.chapters[0].id }] });
  assert.equal(completed.ok, true);
  assert.equal(completed.seq, 1);
  assert.equal(completed.state.actionCount, 0);
  assert.equal(completed.state.videoDays, 1);
  assert.equal(completed.state.completedDays, 1);
  assert.equal(completed.peakActionCount, 5);
  assert.equal(completed.peakMoney, started.peakMoney);
  assert.deepEqual(completed.state.completedVideos, [bundle.chapters[0].id]);
  const retry=await server.request({action:'appendOperations',runId:started.runId,expectedSeq:0,
    operations:[{method:'completeVideo',chapterId:bundle.chapters[0].id}]});
  assert.equal(retry.replayed,true);
  assert.deepEqual(retry.saveData,completed.saveData);
  const injected = await server.request({ action: 'appendOperations', runId: started.runId, expectedSeq: 1, operations: [{ method: 'load', saveData: started.saveData }] });
  assert.equal(injected.code, 'invalid_operation');
});
