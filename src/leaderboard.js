'use strict';

/**
 * Two independent scopes: unverified device records and server-replayed boards.
 * No game/save/survey imports and no score-upload endpoint. The injected cloud
 * transport receives (payload, {envId, functionName}) and may return wx {result}.
 * Call startLocalRun only for a NEW game, not for a death/checkpoint restore.
 * All public state is copied so UI code cannot accidentally mutate the records.
 * peakActionCount/actionCount remain protocol names; their source is the
 * independent survivalActionCount, with a calendar fallback for legacy saves.
 */
const STORAGE_KEY = 'baiyi.leaderboard.v1';
const DAY_MS = 86400000;
const BEIJING_OFFSET_MS = 8 * 3600000;
const MAX_BATCH_OPERATIONS = 30;
const DEFAULT_CONFIG = Object.freeze({
  enabled: false, envId: '', functionName: 'baiyiLeaderboard',
  longestMetric: 'actionCount', restorePolicy: 'allow_server_replay',
});
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;

function anonymousId(prefix) {
  const c = typeof globalThis !== 'undefined' && globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return `${prefix}_${c.randomUUID()}`;
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = new Uint8Array(16); c.getRandomValues(bytes);
    return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }
  // Local pseudonym only; online identity and seed always come from the server.
  return `${prefix}_${Array.from({ length: 4 }, () => Math.floor(Math.random() * 4294967296).toString(16).padStart(8, '0')).join('')}`;
}

function beijingWindow(timestamp) {
  const start = Math.floor((timestamp + BEIJING_OFFSET_MS) / DAY_MS) * DAY_MS - BEIJING_OFFSET_MS;
  return {
    dayKey: new Date(timestamp + BEIJING_OFFSET_MS).toISOString().slice(0, 10),
    snapshotAt: new Date(start).toISOString(),
    nextUpdateAt: new Date(start + DAY_MS).toISOString(),
  };
}

function emptyBoards() { return { longest: [], wealthiest: [] }; }
function validEntry(entry) {
  return entry === null || (entry && nonempty(entry.playerId) && nonempty(entry.runId)
    && nonempty(entry.nickname) && integer(entry.score) && Number.isFinite(Date.parse(entry.achievedAt)));
}
function validBest(best) {
  return best && validEntry(best.longest) && validEntry(best.wealthiest);
}
function validBoards(boards) {
  return boards && ['longest', 'wealthiest'].every((name) => Array.isArray(boards[name])
    && boards[name].every((e) => e && nonempty(e.playerId) && nonempty(e.nickname) && integer(e.score)));
}
function validOperation(operation) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) return false;
  const keys = {
    act: ['method', 'action'], resolveEvent: ['method', 'choiceId'], chooseEnding: ['method', 'choiceId'],
    completeVideo: ['method', 'chapterId'], completeSideVideo: ['method', 'sideStoryId'],
    answerMonthly: ['method', 'answerIndex', 'expectedQuestionId'], buyMonthlyHint: ['method', 'expectedQuestionId'],
    startChapter: ['method', 'chapterId', 'params'], checkpoint: ['method', 'label'], restoreCheckpoint: ['method'],
  }[operation.method];
  if (!Array.isArray(keys) || Object.keys(operation).some((key) => !keys.includes(key))) return false;
  if (operation.method === 'act') {
    const action = operation.action;
    if (!action || typeof action !== 'object' || Array.isArray(action)) return false;
    const actionKeys = {
      inspect: ['type', 'clueId'], travel: ['type', 'room'], prepare: ['type', 'kind'],
      puzzle: ['type', 'answer'], npc: ['type', 'npcId', 'completeQuest'], clinical: ['type', 'questionId', 'answer'],
      rest: ['type'], work: ['type'], research: ['type'], politics: ['type'], entertain: ['type'],
    }[action.type];
    return Array.isArray(actionKeys) && !Object.keys(action).some((key) => !actionKeys.includes(key));
  }
  if (operation.method === 'completeSideVideo') return typeof operation.sideStoryId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(operation.sideStoryId);
  if (operation.method === 'completeVideo') {
    return (Number.isSafeInteger(operation.chapterId) && operation.chapterId > 0)
      || (typeof operation.chapterId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(operation.chapterId));
  }
  if (operation.method === 'startChapter' && operation.params != null) {
    return typeof operation.params === 'object' && !Array.isArray(operation.params)
      && Object.keys(operation.params).every((key) => key === 'replay')
      && (operation.params.replay === undefined || typeof operation.params.replay === 'boolean');
  }
  return true;
}

function createLeaderboard(input = {}, storage, transport) {
  const config = { ...DEFAULT_CONFIG, ...input };
  const clock = typeof config.clock === 'function' ? config.clock : Date.now;
  const storageKey = STORAGE_KEY; // Deliberately not caller-supplied: cannot alias a game or research save.
  let storageError = null;
  let corruptStorage = false;
  let onlineStatus = 'disconnected';
  let onlineError = null;
  let queue = Promise.resolve();
  let state = {
    version: 1, player: null, run: null,
    allTime: { longest: null, wealthiest: null }, snapshot: null,
    online: { envId: config.envId || '', run: null, pending: [], boards: emptyBoards(), snapshotAt: null, nextUpdateAt: null, serverTime: null },
  };

  function now() {
    const value = Number(clock());
    if (!Number.isFinite(value)) throw new Error('invalid_clock');
    return value;
  }
  function save() {
    if (corruptStorage) return false;
    try {
      if (!storage || typeof storage.setItem !== 'function') throw new Error('storage_unavailable');
      const accepted = storage.setItem(storageKey, JSON.stringify(state));
      if (accepted === false || (accepted && typeof accepted.then === 'function')) throw new Error('storage_write_failed');
      storageError = null;
      return true;
    } catch (error) { storageError = error.message || 'storage_write_failed'; return false; }
  }
  try {
    const raw = storage && typeof storage.getItem === 'function' ? storage.getItem(storageKey) : null;
    if (raw != null && raw !== '') {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : clone(raw);
      if (!parsed || parsed.version !== 1 || !parsed.player || !nonempty(parsed.player.id)
        || !nonempty(parsed.player.nickname) || !validBest(parsed.allTime)
        || (parsed.run && (!nonempty(parsed.run.id) || !integer(parsed.run.peakActionCount) || !integer(parsed.run.peakMoney)))
        || (parsed.snapshot && (!nonempty(parsed.snapshot.dayKey) || !validBoards(parsed.snapshot.boards)))) throw new Error('storage_corrupt');
      state.player = { id: parsed.player.id, nickname: parsed.player.nickname };
      state.run = clone(parsed.run || null);
      state.allTime = clone(parsed.allTime);
      state.snapshot = clone(parsed.snapshot || null);
      // An environment change must never replay a queue into a different server.
      if (parsed.online && parsed.online.envId === config.envId && validBoards(parsed.online.boards)
        && (!parsed.online.run || (nonempty(parsed.online.run.id) && integer(parsed.online.run.seq) && integer(parsed.online.run.seed)))
        && Array.isArray(parsed.online.pending) && parsed.online.pending.every((batch) => batch
          && (batch.expectedSeq == null || integer(batch.expectedSeq)) && Array.isArray(batch.operations)
          && batch.operations.length > 0 && batch.operations.length <= MAX_BATCH_OPERATIONS
          && batch.operations.every(validOperation))) state.online = clone(parsed.online);
    }
  } catch (_) { storageError = 'storage_corrupt'; corruptStorage = true; }

  if (!state.player) {
    const id = anonymousId('local');
    state.player = { id, nickname: `无名夜行者${id.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()}` };
  }

  function configurationErrors() {
    const errors = [];
    if (config.enabled !== true) errors.push('disabled');
    if (!nonempty(config.envId)) errors.push('missing_env');
    if (!nonempty(config.functionName)) errors.push('missing_function_name');
    if (typeof transport !== 'function') errors.push('missing_transport');
    if (config.longestMetric !== 'actionCount') errors.push('unsupported_longest_metric');
    if (config.restorePolicy !== 'allow_server_replay') errors.push('unsupported_restore_policy');
    return errors;
  }
  function rollover() {
    const window = beijingWindow(now());
    if (!state.snapshot || window.dayKey > state.snapshot.dayKey) {
      state.snapshot = {
        ...window, timezone: 'Asia/Shanghai',
        boards: {
          longest: state.allTime.longest ? [{ ...clone(state.allTime.longest), rank: 1 }] : [],
          wealthiest: state.allTime.wealthiest ? [{ ...clone(state.allTime.wealthiest), rank: 1 }] : [],
        },
      };
      save();
    }
    // Device clock rollback does not republish or alter a previous daily snapshot.
  }
  function getLocalBoards() {
    rollover();
    return {
      scope: 'local', label: '本机纪录', verified: false,
      updateLabel: '每日北京时间 00:00 汇总', metric: 'actionCount', counterSource: 'survivalActionCount', actionsPerDay: 5,
      ...clone(state.snapshot), currentBest: clone(state.allTime),
    };
  }
  function getState() {
    const local = getLocalBoards();
    const errors = configurationErrors();
    return {
      version: 1, storageKey, storageError, player: clone(state.player), run: clone(state.run), local,
      online: {
        configured: !errors.length, connected: !errors.length && onlineStatus === 'connected',
        status: errors.length ? 'disabled' : onlineStatus,
        label: errors.length ? '全服榜未配置' : onlineStatus === 'connected' ? '全服巅峰榜' : '全服榜未连接',
        configurationErrors: errors, lastError: clone(onlineError),
        run: clone(state.online.run), pendingCount: state.online.pending.length,
        boards: clone(state.online.boards), snapshotAt: state.online.snapshotAt,
        nextUpdateAt: state.online.nextUpdateAt, serverTime: state.online.serverTime,
      },
    };
  }
  function result(ok, code, extra = {}) { return { ok, code, ...extra }; }

  function startLocalRun() {
    rollover();
    state.run = {
      id: anonymousId('run'), startedAt: new Date(now()).toISOString(), endedAt: null,
      peakActionCount: 0, peakMoney: 0, lastStatus: null,
    };
    save();
    return result(true, 'local_run_started', { run: clone(state.run), player: clone(state.player) });
  }
  function observeState(gameState) {
    if (!gameState || !integer(gameState.actionCount) || !integer(gameState.money)) return result(false, 'invalid_game_state');
    const survivalCount = gameState.survivalActionCount === undefined ? gameState.actionCount : gameState.survivalActionCount;
    if (!integer(survivalCount)) return result(false, 'invalid_game_state');
    rollover();
    if (!state.run) startLocalRun();
    if (state.run.endedAt) return result(false, 'local_run_finished');
    const timestamp = new Date(now()).toISOString();
    state.run.peakActionCount = Math.max(state.run.peakActionCount, survivalCount);
    state.run.peakMoney = Math.max(state.run.peakMoney, gameState.money);
    state.run.lastStatus = ['playing', 'failure', 'chapter_end', 'complete'].includes(gameState.status) ? gameState.status : null;
    const entry = (score) => ({ playerId: state.player.id, nickname: state.player.nickname, runId: state.run.id, score, achievedAt: timestamp });
    const actionCount = state.run.peakActionCount;
    if (!state.allTime.longest || actionCount > state.allTime.longest.score) {
      state.allTime.longest = { ...entry(actionCount), actionCount, survivalDays: Math.floor(actionCount / 5) + 1,
        completedDays: Math.floor(actionCount / 5), actionsIntoDay: actionCount % 5 };
    }
    if (!state.allTime.wealthiest || state.run.peakMoney > state.allTime.wealthiest.score) {
      state.allTime.wealthiest = { ...entry(state.run.peakMoney), peakMoney: state.run.peakMoney };
    }
    save();
    return result(true, 'local_recorded', { run: clone(state.run), currentBest: clone(state.allTime), persisted: !storageError });
  }
  function finishLocalRun() {
    if (!state.run) return result(false, 'no_local_run');
    if (!state.run.endedAt) state.run.endedAt = new Date(now()).toISOString();
    save();
    return result(true, 'local_run_finished', { run: clone(state.run) });
  }

  function serial(work) {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  }
  async function call(payload) {
    const errors = configurationErrors();
    if (errors.length) return result(false, 'online_not_configured', { errors });
    onlineStatus = 'connecting';
    try {
      const response = await transport(clone(payload), { envId: config.envId, functionName: config.functionName });
      const data = response && Object.prototype.hasOwnProperty.call(response, 'result') ? response.result : response;
      if (!data || data.ok !== true) {
        const problem = data && (data.error || data.code) || 'invalid_server_response';
        onlineError = typeof problem === 'string' ? problem : clone(problem);
        onlineStatus = 'error';
        return result(false, typeof problem === 'string' ? problem : 'server_rejected', { server: clone(data) });
      }
      onlineStatus = 'connected'; onlineError = null;
      if (data.boards && validBoards(data.boards)) state.online.boards = clone(data.boards);
      for (const field of ['snapshotAt', 'nextUpdateAt', 'serverTime']) if (data[field] !== undefined) state.online[field] = clone(data[field]);
      return clone(data);
    } catch (error) {
      onlineStatus = 'error'; onlineError = error && error.message || 'network_error';
      return result(false, 'network_error', { message: onlineError });
    }
  }
  function startOnlineRun() {
    return serial(async () => {
      const response = await call({ action: 'startRun' });
      if (!response.ok) return response;
      if (!nonempty(response.runId) || !integer(response.seq) || !integer(response.seed)) {
        onlineStatus = 'error'; onlineError = 'invalid_run_response';
        return result(false, 'invalid_run_response');
      }
      // This is an explicit new run. A discarded local queue is not claimed online.
      state.online.run = { id: response.runId, seed: response.seed, seq: response.seq };
      state.online.pending = [];
      save();
      return response;
    });
  }
  async function flush() {
    if (!state.online.run) return result(false, 'no_online_run');
    let lastResponse = result(true, 'already_synced', { seq: state.online.run.seq });
    while (state.online.pending.length) {
      const batch = state.online.pending[0];
      if (batch.expectedSeq == null) { batch.expectedSeq = state.online.run.seq; save(); }
      const response = await call({ action: 'appendOperations', runId: state.online.run.id,
        expectedSeq: batch.expectedSeq, operations: batch.operations });
      if (!response.ok) return { ...response, queued: true, pendingCount: state.online.pending.length };
      if (!integer(response.seq) || response.seq < batch.expectedSeq + batch.operations.length) {
        onlineStatus = 'error'; onlineError = 'invalid_sequence_response';
        return result(false, 'invalid_sequence_response', { queued: true });
      }
      state.online.run.seq = response.seq;
      state.online.pending.shift(); save(); lastResponse = response;
    }
    return { ...lastResponse, pendingCount: 0 };
  }
  function appendOperations(operations) {
    let batch;
    try { batch = clone(operations); } catch (_) { return Promise.resolve(result(false, 'invalid_operations')); }
    if (!Array.isArray(batch) || !batch.length || batch.length > 100 || batch.some((o) => !validOperation(o))) {
      return Promise.resolve(result(false, 'invalid_operations'));
    }
    return serial(async () => {
      if (configurationErrors().length) return result(false, 'online_not_configured', { errors: configurationErrors() });
      if (!state.online.run) return result(false, 'no_online_run');
      for (let offset = 0; offset < batch.length; offset += MAX_BATCH_OPERATIONS) {
        state.online.pending.push({ id: anonymousId('batch'), expectedSeq: null, operations: batch.slice(offset, offset + MAX_BATCH_OPERATIONS) });
      }
      save();
      return flush();
    });
  }
  function retryPendingOperations() { return serial(flush); }
  function resumeOnlineRun() {
    return serial(async () => {
      if (!state.online.run) return result(false, 'no_online_run');
      const synced = await flush();
      if (!synced.ok) return synced;
      const response = await call({ action: 'getRun', runId: state.online.run.id });
      if (!response.ok) return response;
      if (!integer(response.seq) || response.seq < state.online.run.seq) {
        onlineStatus = 'error'; onlineError = 'invalid_sequence_response';
        return result(false, 'invalid_sequence_response');
      }
      state.online.run.seq = response.seq; save();
      return response;
    });
  }
  function refreshBoards() {
    return serial(async () => {
      const response = await call({ action: 'getBoards' });
      if (response.ok && !validBoards(response.boards)) {
        onlineStatus = 'error'; onlineError = 'invalid_boards_response';
        return result(false, 'invalid_boards_response');
      }
      if (response.ok) save();
      return response;
    });
  }

  return { startLocalRun, observeState, finishLocalRun, getState, getLocalBoards,
    startOnlineRun, appendOperations, retryPendingOperations, resumeOnlineRun, refreshBoards };
}

module.exports = { createLeaderboard, beijingWindow, DEFAULT_CONFIG, STORAGE_KEY };
