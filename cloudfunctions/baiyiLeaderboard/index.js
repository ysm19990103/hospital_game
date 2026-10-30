'use strict';

// Only this adapter uses WeChat. core.js is testable without cloud credentials.
const cloud = require('wx-server-sdk');
const crypto = require('node:crypto');
const config = require('./server-config.json');
const core = require('./core');
const bundle = require('./vendor');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COLLECTIONS = { runs: 'baiyi_ranked_runs', buckets: 'baiyi_ranked_daily', snapshots: 'baiyi_ranked_snapshots', gates: 'baiyi_ranked_gates', players: 'baiyi_ranked_players' };
const seasonKey = `${config.seasonId}_${bundle.engineVersion.slice(0, 16)}_${core.hash(config.restorePolicy).slice(0, 8)}`;
const clone = (value) => JSON.parse(JSON.stringify(value));
function doc(client, kind, id) { return client.collection(COLLECTIONS[kind]).doc(id); }
async function read(client, kind, id) {
  // A missing document is expected; permission/network/collection errors must
  // propagate. SDK versions differ in absent-document behavior.
  try {
    const response = await doc(client, kind, id).get();
    return Array.isArray(response.data) ? response.data[0] || null : response.data || null;
  } catch (error) {
    if (/DOCUMENT_NOT_FOUND|document.*(?:not exist|not found)|document\s+不存在/i.test(`${error.code || ''} ${error.errCode || ''} ${error.message || ''}`)) return null;
    throw error;
  }
}
async function transact(callback) {
  const response = await db.runTransaction(callback);
  return response && Object.prototype.hasOwnProperty.call(response, 'result') ? response.result : response;
}
function runReply(run, replay, extra = {}) {
  return { ok: true, runId: run.runId, seed: run.seed, seq: run.operations.length, engineVersion: run.engineVersion, seasonId: seasonKey, restorePolicy: config.restorePolicy, longestMetric: config.longestMetric,
    state: replay.state, saveData: replay.saveData, peakActionCount: replay.peakActionCount, peakMoney: replay.peakMoney,
    questionHistorySnapshot: clone(run.questionHistorySnapshot || []), questionHistory: replay.questionHistory, ...extra };
}
function accountHistoryId(player) { return `history_${player.playerId}`; }
function mergedQuestionHistory(...records) {
  const history = bundle.createQuestionHistory();
  for (const entries of records) history.merge(entries || []);
  return history.getRecords();
}
async function advanceDayGate() {
  return transact(async (tx) => {
    const window = core.dayWindow(Date.now());
    const gate = await read(tx, 'gates', seasonKey);
    if (!gate || gate.dayStart < window.cutoff) await doc(tx, 'gates', seasonKey).set({ data: { seasonId: seasonKey, dayStart: window.cutoff, updatedAt: Date.now() } });
    return window;
  });
}
async function writeBucket(tx, player, run, replay, gate, acceptedAt) {
  const id = `${seasonKey}_${gate.dayStart}_${player.playerId}`;
  let bucket = await read(tx, 'buckets', id);
  if (!bucket) bucket = { seasonId: seasonKey, dayStart: gate.dayStart, ...player, longest: -1, wealthiest: -1 };
  for (const [metric, score] of [['longest', replay.peakActionCount], ['wealthiest', replay.peakMoney]]) {
    if (score > bucket[metric]) {
      bucket[metric] = score; bucket[`${metric}RunId`] = run.runId; bucket[`${metric}At`] = acceptedAt;
    }
  }
  // Updating the read gate makes roll-over and score writes conflict even on
  // engines with document-level optimistic transactions. Prior days seal first.
  await doc(tx, 'gates', seasonKey).set({ data: { seasonId: seasonKey, dayStart: gate.dayStart, updatedAt: acceptedAt } });
  delete bucket._id;
  await doc(tx, 'buckets', id).set({ data: bucket });
}
async function startRun(player) {
  await advanceDayGate();
  const runId = crypto.randomBytes(16).toString('hex');
  const seed = crypto.randomBytes(4).readUInt32BE(0) || 1;
  return transact(async (tx) => {
    const acceptedAt = Date.now();
    const window = core.dayWindow(acceptedAt);
    const gate = await read(tx, 'gates', seasonKey);
    if (!gate || gate.dayStart !== window.cutoff) core.fail('daily_rollover_retry', '榜单正在跨日，请重试。');
    const profileId = `${seasonKey}_${player.playerId}`;
    const profile = await read(tx, 'players', profileId);
    // The history document is independent of leaderboard season/rule version.
    const account = await read(tx, 'players', accountHistoryId(player));
    const starts = profile && profile.dayStart === window.cutoff ? profile.starts : 0;
    if (starts >= config.maxStartsPerDay) core.fail('start_rate_limit', '今日新建竞技局次数达到技术上限。');
    const run = { runId, seed, startedAt: acceptedAt, updatedAt: acceptedAt, playerId: player.playerId, engineVersion: bundle.engineVersion, seasonId: seasonKey, operations: [], operationTimes: [], questionHistorySnapshot: mergedQuestionHistory(account && account.questionHistory) };
    const replay = core.replayRun(run, [], config, bundle);
    await doc(tx, 'runs', runId).set({ data: run });
    await doc(tx, 'players', profileId).set({ data: { ...player, dayStart: window.cutoff, starts: starts + 1 } });
    await doc(tx, 'players', accountHistoryId(player)).set({ data: { ...player, questionHistory: replay.questionHistory, activeRunId: runId, updatedAt: acceptedAt } });
    await writeBucket(tx, player, run, replay, gate, acceptedAt);
    return runReply(run, replay);
  });
}
async function appendOperations(player, event) {
  if (!/^[a-f0-9]{32}$/.test(event.runId || '') || !Number.isSafeInteger(event.expectedSeq) || event.expectedSeq < 0) core.fail('invalid_request', '周目或序号无效。');
  const operations = core.normalizeBatch(event.operations, config);
  await advanceDayGate();
  return transact(async (tx) => {
    const run = await read(tx, 'runs', event.runId);
    if (!run || run.playerId !== player.playerId) core.fail('run_not_found', '找不到属于当前玩家的竞技局。');
    if (run.engineVersion !== bundle.engineVersion || run.seasonId !== seasonKey) core.fail('engine_version_changed', '游戏规则版本已更新，请保留原纪录并开启新竞技局。');
    const account = await read(tx, 'players', accountHistoryId(player));
    if (event.expectedSeq < run.operations.length) {
      const previous = run.operations.slice(event.expectedSeq, event.expectedSeq + operations.length);
      if (previous.length !== operations.length || core.hash(JSON.stringify(previous)) !== core.hash(JSON.stringify(operations))) core.fail('sequence_conflict', '此序号已提交不同操作，请同步服务器周目。');
      return runReply(run, core.replayRun(run, run.operations, config, bundle), { replayed: true, readOnly: !account || account.activeRunId !== run.runId });
    }
    // A newly opened run supersedes prior writable runs. This prevents replaying
    // two old snapshots in parallel to earn the same first-answer reward twice.
    if (!account || account.activeRunId !== run.runId) core.fail('run_read_only', '已开启新的竞技局，此旧局仅可查看；历史最高纪录仍保留。');
    if (event.expectedSeq !== run.operations.length) core.fail('sequence_conflict', '操作序号与服务器不一致。');
    const operationTime = Date.now();
    run.operationTimes = [...(run.operationTimes || run.operations.map(() => run.startedAt)), ...operations.map(() => operationTime)];
    const replay = core.replayRun(run, [...run.operations, ...operations], config, bundle);
    const acceptedAt = Date.now();
    const gate = await read(tx, 'gates', seasonKey);
    if (!gate || gate.dayStart !== core.dayWindow(acceptedAt).cutoff) core.fail('daily_rollover_retry', '榜单正在跨日，请重试。');
    run.operations.push(...operations); run.updatedAt = acceptedAt;
    delete run._id;
    await doc(tx, 'runs', run.runId).set({ data: run });
    await doc(tx, 'players', accountHistoryId(player)).set({ data: { ...player, questionHistory: mergedQuestionHistory(account.questionHistory, replay.questionHistory), activeRunId: run.runId, updatedAt: acceptedAt } });
    await writeBucket(tx, player, run, replay, gate, acceptedAt);
    return runReply(run, replay);
  });
}
async function getRun(player, event) {
  if (!/^[a-f0-9]{32}$/.test(event.runId || '')) core.fail('invalid_request', '周目标识无效。');
  const run = await read(db, 'runs', event.runId);
  if (!run || run.playerId !== player.playerId) core.fail('run_not_found', '找不到属于当前玩家的竞技局。');
  if (run.engineVersion !== bundle.engineVersion || run.seasonId !== seasonKey) core.fail('engine_version_changed', '游戏规则版本已更新，请保留原纪录并开启新竞技局。');
  const account = await read(db, 'players', accountHistoryId(player));
  return runReply(run, core.replayRun(run, run.operations, config, bundle), { readOnly: !account || account.activeRunId !== run.runId });
}
async function topBoard(metric, cutoff) {
  const entries = [];
  const seen = new Set();
  let scanned = 0;
  const pageSize = 100;
  while (entries.length < config.boardLimit) {
    if (scanned >= config.maxSnapshotRows) core.fail('snapshot_capacity', '快照扫描达到技术上限，需要扩容索引聚合；旧榜继续保留。');
    const response = await db.collection(COLLECTIONS.buckets)
      .where({ seasonId: seasonKey, dayStart: db.command.lt(cutoff) })
      .orderBy(metric, 'desc').orderBy(`${metric}At`, 'asc').orderBy('playerId', 'asc')
      .skip(scanned).limit(pageSize).get();
    const rows = response.data || [];
    for (const row of rows) {
      if (seen.has(row.playerId)) continue;
      seen.add(row.playerId); entries.push(core.publicEntry(row, metric));
      if (entries.length === config.boardLimit) break;
    }
    scanned += rows.length;
    if (rows.length < pageSize) break;
  }
  return entries;
}
async function ensureSnapshot() {
  const window = await advanceDayGate();
  const snapshotId = `${seasonKey}_${window.dayId}`;
  const existing = await read(db, 'snapshots', snapshotId);
  if (existing) return existing;
  // Sealed buckets are immutable: query both metrics before atomic publication.
  const [longest, wealthiest] = await Promise.all([topBoard('longest', window.cutoff), topBoard('wealthiest', window.cutoff)]);
  const snapshot = { seasonId: seasonKey, dayId: window.dayId, cutoff: window.cutoff, snapshotAt: window.snapshotAt, nextUpdateAt: window.nextUpdateAt, generatedAt: new Date().toISOString(), longestMetric: config.longestMetric, restorePolicy: config.restorePolicy, boards: { longest, wealthiest } };
  return transact(async (tx) => {
    const alreadyPublished = await read(tx, 'snapshots', snapshotId);
    if (alreadyPublished) return alreadyPublished;
    await doc(tx, 'snapshots', snapshotId).set({ data: snapshot });
    return snapshot;
  });
}
function validateEnvelope(event) {
  const fields = { startRun: ['action'], getBoards: ['action'], getRun: ['action', 'runId'], appendOperations: ['action', 'runId', 'expectedSeq', 'operations'] };
  if (!event || !Object.prototype.hasOwnProperty.call(fields, event.action) || Object.keys(event).some((key) => !fields[event.action].includes(key))) core.fail('invalid_request', '请求包含不允许的字段；不能提交分数、状态或身份。');
}
exports.main = async (event = {}) => {
  try {
    if (!config.enabled) return { ok: false, code: 'online_disabled', message: '全服榜尚未启用。' };
    core.validateConfig(config);
    const context = cloud.getWXContext();
    const openid = context.OPENID;
    if (event.Type === 'Timer') {
      if (!core.isTrustedTimer(event, openid, process.env.LEADERBOARD_TIMER_SECRET, config.timerName)) core.fail('unauthorized_timer', '定时快照鉴权失败。');
      const snapshot = await ensureSnapshot();
      return { ok: true, snapshotAt: snapshot.snapshotAt, nextUpdateAt: snapshot.nextUpdateAt };
    }
    validateEnvelope(event);
    const player = core.anonymousPlayer(openid, process.env.LEADERBOARD_PLAYER_SECRET);
    if (event.action === 'startRun') return await startRun(player);
    if (event.action === 'appendOperations') return await appendOperations(player, event);
    if (event.action === 'getRun') return await getRun(player, event);
    const snapshot = clone(await ensureSnapshot()); delete snapshot._id;
    return { ok: true, ...snapshot, player, source: 'server_snapshot' };
  } catch (error) {
    // Never include event/context/OPENID/secrets in response or logs.
    if (!error.code || !/^[a-z_]+$/.test(error.code)) return { ok: false, code: 'server_error', message: '云榜暂时不可用，请稍后重试。' };
    return { ok: false, code: error.code, message: error.message };
  }
};
