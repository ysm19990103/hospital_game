'use strict';

const crypto = require('node:crypto');
const DAY_MS = 86400000;
const UTC8_MS = 8 * 3600000;
const clone = (value) => JSON.parse(JSON.stringify(value));
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function plain(value) { return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function keys(value, allowed) {
  if (!plain(value) || Object.keys(value).some((key) => !allowed.includes(key))) fail('invalid_operation', '操作包含不允许的字段。');
}
function identifier(value) { return (typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value)) || (Number.isSafeInteger(value) && value >= 0); }
function needId(value) { if (!identifier(value)) fail('invalid_operation', '操作标识无效。'); }
function answer(value) { if (!Number.isInteger(value) || value < 0 || value > 20) fail('invalid_operation', '答案索引无效。'); }
function validateConfig(config) {
  if (config.longestMetric !== 'actionCount') fail('unsupported_metric', '当前仅实现行动数指标；真实活跃分钟尚未实现。');
  if (!['pending_confirmation', 'reject', 'allow_server_replay'].includes(config.restorePolicy)) fail('invalid_config', '读档参榜策略无效。');
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(config.seasonId || '')) fail('invalid_config', '榜期标识无效。');
  for (const name of ['boardLimit', 'maxBatchOperations', 'maxRunOperations', 'maxRunBytes', 'maxSnapshotRows', 'maxStartsPerDay']) {
    if (!Number.isSafeInteger(config[name]) || config[name] < 1) fail('invalid_config', `配置 ${name} 必须为正整数。`);
  }
}
function requireRestorePolicy(config) {
  if (config.restorePolicy === 'pending_confirmation') fail('restore_policy_pending', '读档参榜规则待确认，暂不接受竞技读档。');
  if (config.restorePolicy !== 'allow_server_replay') fail('restore_rejected', '当前榜期不允许读档参榜。');
}
function normalizeOperation(input, config) {
  if (!plain(input)) fail('invalid_operation', '操作格式无效。');
  const op = clone(input);
  if (op.method === 'act') {
    keys(op, ['method', 'action']);
    const action = typeof op.action === 'string' ? { type: op.action } : op.action;
    const extras = { rest: [], entertain: [], work: [], research: [], politics: [], inspect: ['clueId'], travel: ['room'], prepare: ['kind'], puzzle: ['answer'], npc: ['npcId', 'completeQuest'], clinical: ['questionId', 'answer'] };
    if (!plain(action) || !Object.hasOwn(extras, action.type)) fail('invalid_operation', '该行动不允许提交到榜单。');
    keys(action, ['type', ...extras[action.type]]);
    if (['inspect', 'npc', 'clinical'].includes(action.type)) needId(action[{ inspect: 'clueId', npc: 'npcId', clinical: 'questionId' }[action.type]]);
    if (action.type === 'travel' && !['hospital', 'other'].includes(action.room)) fail('invalid_operation', '场景无效。');
    if (action.type === 'prepare' && !['record', 'grant', 'neutral'].includes(action.kind)) fail('invalid_operation', '准备类型无效。');
    if (['puzzle', 'clinical'].includes(action.type)) answer(action.answer);
    if (action.completeQuest !== undefined && typeof action.completeQuest !== 'boolean') fail('invalid_operation', '支线参数无效。');
    return { method: 'act', action };
  }
  if (['resolveEvent', 'chooseEnding'].includes(op.method)) { keys(op, ['method', 'choiceId']); needId(op.choiceId); return op; }
  if (op.method === 'completeVideo') { keys(op, ['method', 'chapterId']); needId(op.chapterId); return op; }
  if (op.method === 'completeSideVideo') {
    keys(op, ['method', 'sideStoryId']);
    if (typeof op.sideStoryId !== 'string') fail('invalid_operation', '支线影像标识无效。');
    needId(op.sideStoryId); return op;
  }
  if (op.method === 'startChapter') {
    keys(op, ['method', 'chapterId', 'params']); needId(op.chapterId);
    if (op.params !== undefined) {
      keys(op.params, ['replay']);
      if (op.params.replay !== true) fail('invalid_operation', '章节参数仅支持 replay:true。');
      requireRestorePolicy(config);
    }
    return op;
  }
  if (op.method === 'buyMonthlyHint') { keys(op, ['method', 'expectedQuestionId']); needId(op.expectedQuestionId); return op; }
  if (op.method === 'answerMonthly') {
    keys(op, ['method', 'answerIndex', 'expectedQuestionId']); answer(op.answerIndex); needId(op.expectedQuestionId); return op;
  }
  if (op.method === 'checkpoint') {
    keys(op, ['method', 'label']);
    if (op.label !== undefined && (typeof op.label !== 'string' || op.label.length > 80)) fail('invalid_operation', '节点标签最多80个字符。');
    return op;
  }
  if (op.method === 'restoreCheckpoint') {
    keys(op, ['method']);
    requireRestorePolicy(config);
    return op;
  }
  fail('invalid_operation', '该方法不允许提交到榜单。');
}
function normalizeBatch(input, config) {
  if (!Array.isArray(input) || input.length < 1 || input.length > config.maxBatchOperations) fail('invalid_batch', '提交操作数超出限制。');
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 20000) fail('invalid_batch', '操作批次过大。');
  return input.map((op) => normalizeOperation(op, config));
}
function survivalCount(state) {
  // Protocol names stay compatible, while the score is separate from the
  // story calendar. Only old engines without this field use actionCount.
  const count = state.survivalActionCount === undefined ? state.actionCount : state.survivalActionCount;
  if (!Number.isSafeInteger(count) || count < 0) fail('invalid_score', '服务器存活计数无效。');
  return count;
}
function replayRun(run, operations, config, bundle) {
  validateConfig(config);
  if (operations.length > config.maxRunOperations || Buffer.byteLength(JSON.stringify(operations), 'utf8') > config.maxRunBytes) fail('run_limit', '本次竞技日志已达到技术上限，请保存纪录并开启新局。');
  let replayTime = run.startedAt;
  // Every replay starts from the account history captured when this run began.
  // Loading today's account history would turn historical answers into reviews
  // and alter both rewards and the sequence of seeded random decisions.
  if (typeof bundle.createQuestionHistory !== 'function') fail('engine_version_changed', '服务器题目记录模块尚未构建，请更新权威规则包。');
  const questionHistory = bundle.createQuestionHistory({ initialRecords: run.questionHistorySnapshot || [] });
  const game = bundle.createGame(bundle.chapters, { seed: run.seed, occurrenceNamespace: run.runId, questionHistory, debug: false, npcs: bundle.npcs, knowledge: bundle.knowledge, clock: () => replayTime });
  let peakMoney = game.state.money;
  let peakActionCount = survivalCount(game.state);
  let restoreCount = 0;
  for (let index = 0; index < operations.length; index += 1) {
    replayTime = Array.isArray(run.operationTimes) && Number.isFinite(run.operationTimes[index]) ? run.operationTimes[index] : run.startedAt;
    const op = normalizeOperation(operations[index], config);
    const chapterReplay = op.method === 'startChapter' && op.params && op.params.replay === true;
    if (['failure', 'complete'].includes(game.state.status) && op.method !== 'restoreCheckpoint' && !chapterReplay) fail('run_ended', `第 ${index + 1} 步位于已结束的周目之后。`);
    let result;
    if (op.method === 'startChapter') {
      const current = bundle.chapters.findIndex((chapter) => String(chapter.id) === String(game.state.chapterId));
      if (!chapterReplay && (game.state.status !== 'chapter_end' || !bundle.chapters[current + 1] || String(bundle.chapters[current + 1].id) !== String(op.chapterId))) fail('chapter_order', '新章节仅允许按故事顺序进入下一章；已到达章节可通过服务器分支重玩。');
      result = game.startChapter(op.chapterId, op.params);
      if (chapterReplay) restoreCount += 1;
    } else if (op.method === 'act') {
      const before = game.state.actionCount;
      result = game.act(op.action);
      if (result.ok && game.state.actionCount !== before + 1) fail('no_op', '复习与画面移动无需上传竞技日志。');
    } else if (op.method === 'completeVideo') result = game.completeVideo(op.chapterId);
    else if (op.method === 'completeSideVideo') result = game.completeSideVideo(op.sideStoryId);
    else if (op.method === 'answerMonthly') result = game.answerMonthly(op.answerIndex, op.expectedQuestionId);
    else if (op.method === 'buyMonthlyHint') result = game.buyMonthlyHint(op.expectedQuestionId);
    else if (op.method === 'restoreCheckpoint') { result = game.restoreCheckpoint(); restoreCount += 1; }
    else if (op.method === 'checkpoint') result = game.checkpoint(op.label);
    else result = game[op.method](op.choiceId);
    if (!result || !result.ok) fail('operation_rejected', `第 ${index + 1} 步被规则拒绝：${result && result.message || '状态不符'}`);
    peakMoney = Math.max(peakMoney, game.state.money);
    peakActionCount = Math.max(peakActionCount, survivalCount(game.state));
  }
  const saved = game.save();
  if (!saved || !saved.data) fail('server_save_failed', '服务器生成权威存档失败。');
  const state = clone(game.state);
  const saveData = clone(saved.data);
  // Memorial remains the device's independent archive. Returning replay-created
  // IDs would duplicate a death already recorded locally before server sync.
  for (const candidate of [state, saveData.state, saveData.checkpoint, ...Object.values(saveData.chapterStarts || {})]) {
    if (!candidate || !candidate.failure) continue;
    for (const key of ['deathId', 'memorialRecord', 'memorialSaved', 'memorialError']) delete candidate.failure[key];
  }
  return { state, saveData, peakMoney, peakActionCount, restoreCount, questionHistory: questionHistory.getRecords() };
}
function dayWindow(now = Date.now()) {
  const cutoff = Math.floor((now + UTC8_MS) / DAY_MS) * DAY_MS - UTC8_MS;
  return { dayId: new Date(cutoff + UTC8_MS).toISOString().slice(0, 10), cutoff, snapshotAt: new Date(cutoff).toISOString(), nextUpdateAt: new Date(cutoff + DAY_MS).toISOString() };
}
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function anonymousPlayer(openid, secret) {
  if (typeof openid !== 'string' || !openid) fail('unauthenticated', '请通过微信云函数接口进入。');
  if (typeof secret !== 'string' || secret.length < 32) fail('server_not_configured', '服务器匿名标识密钥尚未配置。');
  const playerId = crypto.createHmac('sha256', secret).update(openid).digest('hex').slice(0, 32);
  return { playerId, nickname: `夜行者${playerId.slice(0, 6).toUpperCase()}` };
}
function isTrustedTimer(event, openid, secret, timerName) {
  if (openid || !event || event.Type !== 'Timer' || event.TriggerName !== timerName || event.action !== undefined || typeof secret !== 'string' || secret.length < 32) return false;
  try {
    const input = JSON.parse(event.Message);
    const supplied = Buffer.from(typeof input.secret === 'string' ? input.secret : '');
    const expected = Buffer.from(secret);
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  } catch (_) { return false; }
}
function publicEntry(bucket, metric) {
  return { playerId: bucket.playerId, nickname: bucket.nickname, score: bucket[metric], runId: bucket[`${metric}RunId`], achievedAt: new Date(bucket[`${metric}At`]).toISOString(), ...(metric === 'longest' ? { actionCount: bucket[metric], survivalDays: Math.floor(bucket[metric] / 5) + 1, completedDays: Math.floor(bucket[metric] / 5), actionsPerDay: 5 } : {}) };
}
module.exports = { validateConfig, normalizeOperation, normalizeBatch, replayRun, dayWindow, hash, anonymousPlayer, isTrustedTimer, publicEntry, fail };
