'use strict';

// Answer history deliberately lives outside a run save: loading an old node or
// starting over must not turn an answered question into a new reward.
const STORAGE_KEY = 'baiyi-question-history-v1';
const clone = (value) => JSON.parse(JSON.stringify(value));

function createQuestionHistory(options = {}) {
  const records = new Map();
  const pending = new Set();
  const key = options.storageKey || STORAGE_KEY;
  let storageError = null;
  let readFailed = false;

  function validRecord(record) {
    return !!record && ['string', 'number'].includes(typeof record.questionId)
      && (typeof record.questionId !== 'number' || Number.isFinite(record.questionId))
      && String(record.questionId).trim().length > 0 && Number.isInteger(record.answer) && record.answer >= 0
      && typeof record.correct === 'boolean';
  }
  function accept(record, unsaved = false) {
    if (!validRecord(record)
        || !String(record.questionId) || !Number.isInteger(record.answer) || record.answer < 0
        || typeof record.correct !== 'boolean') return false;
    const id = String(record.questionId);
    if (records.has(id)) return false;
    const value = { questionId: record.questionId, answer: record.answer, correct: record.correct,
      source: ['clinical', 'monthly', 'legacy'].includes(record.source) ? record.source : 'legacy' };
    if (record.chapterId != null) value.chapterId = record.chapterId;
    records.set(id, value);
    if (unsaved && options.storage) pending.add(id);
    return true;
  }
  function readStorage() {
    const storage = options.storage;
    if (!storage) return;
    const raw = typeof storage.getItem === 'function' ? storage.getItem(key)
      : typeof storage.getStorageSync === 'function' ? storage.getStorageSync(key)
        : typeof storage.get === 'function' ? storage.get(key) : null;
    if (raw && typeof raw.then === 'function') {
      if (typeof raw.catch === 'function') raw.catch(() => {});
      throw new Error('题目历史仅支持同步读取接口。');
    }
    if (!raw) return;
    const saved = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!saved || saved.version !== 1 || !Array.isArray(saved.records)) throw new Error('题目历史格式不兼容。');
    if (saved.records.some(record => !validRecord(record))
        || new Set(saved.records.map(record => String(record.questionId))).size !== saved.records.length) {
      throw new Error('题目历史记录损坏，原数据未覆盖。');
    }
    // A second instance may have saved since this instance was created. The
    // persisted first answer wins, including over an unpersisted local answer.
    for (const record of saved.records) {
      const id = String(record.questionId);
      records.delete(id); accept(record); pending.delete(id);
    }
  }
  function refresh() {
    const wasReadFailure = readFailed;
    try { readStorage(); readFailed = false; if (wasReadFailure) storageError = null; return true; }
    catch (error) { readFailed = true; storageError = `题目历史读取失败，原数据未覆盖：${error.message || error}`; return false; }
  }
  function getRecords() { return Array.from(records.values(), clone); }
  function persist() {
    if (!options.storage) return true;
    if (!refresh() || readFailed) return false;
    if (pending.size === 0) { storageError = null; return true; }
    try {
      const storage = options.storage;
      const json = JSON.stringify({ version: 1, records: getRecords() });
      let saved;
      if (typeof storage.setItem === 'function') saved = storage.setItem(key, json);
      else if (typeof storage.setStorageSync === 'function') saved = storage.setStorageSync(key, json);
      else if (typeof storage.set === 'function') saved = storage.set(key, json);
      else throw new Error('题目历史存储不可写。');
      if (saved && typeof saved.then === 'function') {
        if (typeof saved.catch === 'function') saved.catch(() => {});
        throw new Error('题目历史仅支持同步写入接口。');
      }
      if (saved === false) throw new Error('存储拒绝保存题目历史。');
      pending.clear(); storageError = null;
      return true;
    } catch (error) { storageError = error.message || String(error); return false; }
  }
  function get(id) { const value = records.get(String(id)); return value ? clone(value) : null; }
  function record(value) {
    refresh();
    const changed = accept(value, true);
    const saved = persist();
    return { ok: saved, alreadyRecorded: !changed, record: get(value && value.questionId), storageError };
  }
  function merge(values) {
    refresh();
    let added = 0;
    for (const value of Array.isArray(values) ? values : []) if (accept(value, true)) added++;
    return { ok: persist(), added, storageError };
  }
  refresh();
  merge(options.initialRecords);
  return { has: (id) => records.has(String(id)), get, getRecords, record, merge, refresh, flush: persist,
    getState: () => ({ records: getRecords(), storageError, unsavedCount: pending.size }) };
}

module.exports = { createQuestionHistory, STORAGE_KEY };
