'use strict';

const CATEGORY_LABELS = Object.freeze({
  clinical: '医疗事件', research: '科研事件', workplace: '职场事件',
  overwork: '精力透支', assessment: '月度考核', other: '其他事件',
});
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

/** Categorize the immediate game cause, not a conjectured underlying disease. */
function classifyDeath(failure = {}) {
  if (failure.actionType === 'monthly_assessment') return 'assessment';
  if (failure.id === 'record_failure') return 'clinical';
  if (failure.id === 'grant_failure' || failure.id === 'research_absence') return 'research';
  if (failure.id === 'faction_failure') return 'workplace';
  if (['harsh_leader', 'director_hostility', 'senior_rules'].includes(failure.eventId)) return 'workplace';
  if (failure.eventId === 'patient_conflict' || failure.eventId === 'health_crisis') return 'clinical';
  if (failure.eventId === 'family_betrayal' || failure.eventId === 'cyberbullying') return 'other';
  if (failure.exhaustionLethal === true) return 'overwork';
  if (failure.actionType === 'research') return 'research';
  if (failure.actionType === 'clinical') return 'clinical';
  if (failure.actionType === 'work' || failure.actionType === 'politics') return 'workplace';
  return 'other';
}

/** Independent, append-only archive. read() never performs storage I/O. */
function createMemorial(options = {}) {
  const storage = options.storage;
  const storageKey = options.storageKey || 'baiyi-game-memorial-v1';
  const instanceTag = Math.random().toString(36).slice(2, 10) || 'local';
  let records = [];
  let persistedIds = new Set();
  let sequence = 0;
  let storageError = null;

  function readValue() {
    if (!storage) return null;
    if (typeof storage.getItem === 'function') return storage.getItem(storageKey);
    if (typeof storage.getStorageSync === 'function') return storage.getStorageSync(storageKey);
    if (typeof storage.get === 'function') return storage.get(storageKey);
    throw new Error('纪念馆读取接口不可用。');
  }
  function writeValue(value) {
    if (!storage) throw new Error('未配置持久存储，纪念记录暂时只保留在本次运行中。');
    let accepted;
    if (typeof storage.setItem === 'function') accepted = storage.setItem(storageKey, value);
    else if (typeof storage.setStorageSync === 'function') accepted = storage.setStorageSync(storageKey, value);
    else if (typeof storage.set === 'function') accepted = storage.set(storageKey, value);
    else throw new Error('纪念馆保存接口不可用。');
    if (accepted === false) throw new Error('存储拒绝保存纪念记录。');
    if (accepted && typeof accepted.then === 'function') throw new Error('纪念馆需要同步存储接口。');
  }
  function readDisk() {
    const raw = readValue();
    if (raw == null || raw === '') return { version: 1, records: [], sequence: 0 };
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!data || data.version !== 1 || !Array.isArray(data.records)
        || data.records.some((record) => !record || typeof record.deathId !== 'string')) {
      throw new Error('已有纪念记录格式无法读取；为保留原记录，本次没有覆盖它们。');
    }
    return data;
  }
  function mergeFromDisk() {
    const disk = readDisk();
    const merged = new Map();
    for (const record of disk.records) merged.set(record.deathId, clone(record));
    for (const record of records) if (!merged.has(record.deathId)) merged.set(record.deathId, record);
    records = [...merged.values()];
    persistedIds = new Set(disk.records.map((record) => record.deathId));
    sequence = Math.max(sequence, Number(disk.sequence) || 0, records.length);
  }
  try { mergeFromDisk(); } catch (error) { storageError = error.message; }

  function retry() {
    if (!records.some((record) => !persistedIds.has(record.deathId))) return { ok: !storageError, storageError, unsavedCount: 0 };
    try {
      // Merge before writing so a later run never replaces an earlier archive.
      mergeFromDisk();
      writeValue(JSON.stringify({ version: 1, records, sequence }));
      persistedIds = new Set(records.map((record) => record.deathId));
      storageError = null;
      return { ok: true, storageError: null, unsavedCount: 0 };
    } catch (error) {
      storageError = error.message;
      return { ok: false, storageError, unsavedCount: records.filter((record) => !persistedIds.has(record.deathId)).length };
    }
  }
  function now() {
    const clock = options.clock;
    const value = typeof clock === 'function' ? clock() : clock && typeof clock.now === 'function' ? clock.now() : Date.now();
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('现实记录时间无效。');
    return { recordedAt: date.toISOString(), recordedAtMs: date.getTime() };
  }
  function append(input) {
    const suppliedId = input && input.deathId;
    const existing = suppliedId && records.find((record) => record.deathId === suppliedId);
    if (existing) {
      if (!persistedIds.has(existing.deathId)) retry();
      return { ok: persistedIds.has(existing.deathId), duplicate: true, record: clone(existing), storageError };
    }
    let timestamp;
    try {
      timestamp = input.recordedAt && Number.isFinite(input.recordedAtMs)
        ? { recordedAt: input.recordedAt, recordedAtMs: input.recordedAtMs } : now();
    } catch (error) {
      // A broken injected clock must not stop the game from entering failure.
      timestamp = { recordedAt: null, recordedAtMs: null, clockError: error.message };
    }
    sequence += 1;
    let deathId = suppliedId || `death-${timestamp.recordedAtMs == null ? 'unknown' : timestamp.recordedAtMs.toString(36)}-${sequence.toString(36)}-${instanceTag}`;
    while (records.some((record) => record.deathId === deathId)) deathId += '-next';
    const category = CATEGORY_LABELS[input.category] ? input.category : 'other';
    const record = { ...clone(input), ...timestamp, deathId, category, categoryLabel: CATEGORY_LABELS[category] };
    delete record.persisted;
    records.push(record);
    const saved = retry();
    return { ok: saved.ok, duplicate: false, record: clone(record), storageError: saved.storageError };
  }
  function read() {
    const total = records.length;
    const stats = Object.entries(CATEGORY_LABELS).map(([category, label]) => {
      const count = records.filter((record) => record.category === category).length;
      return { category, label, count, percentage: total ? Math.round(count * 1000 / total) / 10 : 0 };
    });
    return {
      records: records.map((record) => ({ ...clone(record), persisted: persistedIds.has(record.deathId) })),
      stats, total, storageError,
      unsavedCount: records.filter((record) => !persistedIds.has(record.deathId)).length,
    };
  }
  return { append, read, retry };
}

module.exports = { createMemorial, classifyDeath, CATEGORY_LABELS };
