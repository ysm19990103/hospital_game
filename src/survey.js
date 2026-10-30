'use strict';

/**
 * Local, optional research questionnaire. No game imports, game RNG, scoring,
 * network transmission or identifying profile fields. All item text must come
 * from a separately authorised questionnaire; this module supplies no items.
 *
 * Item shape: {id, text, originalOrder}; array position is the original order
 * when originalOrder is omitted. Options: [{value: number|string, label}].
 * Storage: synchronous getItem/setItem/removeItem (same interface as Storage).
 * getNextBatch returns an array; other mutations return {ok, code, state}.
 * Unfinished batches may resume in a later chapter, but each chapter is linked
 * to at most one batch and each item is assigned only once per assessment.
 * chapterId/sourceId is the source-film identifier, not its current gameOrder.
 * Occupation selected before consent remains private in memory until consent.
 */
const STORAGE_PREFIX = 'baiyi.research.survey.v1:';
const DEFAULT_CONFIG = Object.freeze({
  enabled: false, scaleId: null, scaleVersion: null, instructions: '',
  responseOptions: [], items: [], itemsPerBreak: 2, consentText: '',
  recallWindow: null, studyId: 'baiyi-burnout-pilot', assessmentWindowHours: 24,
});
const copy = (value) => JSON.parse(JSON.stringify(value));
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const validValue = (value) => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
const valueKey = (value) => `${typeof value}:${String(value)}`;
const isoNow = () => new Date(Date.now()).toISOString();
const OCCUPATIONS = Object.freeze(['doctor', 'medical_student', 'other']);
const validGameOrder = (value) => value === undefined || value === null || (Number.isInteger(value) && value > 0);

function prepareConfig(input) {
  const c = { ...DEFAULT_CONFIG, ...(input || {}) };
  const errors = [];
  if (c.enabled !== true) errors.push('disabled');
  for (const field of ['studyId', 'scaleId', 'scaleVersion', 'instructions', 'consentText', 'recallWindow']) {
    if (!text(c[field])) errors.push(`missing_${field}`);
  }
  if (![1, 2].includes(c.itemsPerBreak)) errors.push('invalid_itemsPerBreak');
  if (!Number.isFinite(c.assessmentWindowHours) || c.assessmentWindowHours <= 0) errors.push('invalid_assessmentWindowHours');
  const options = Array.isArray(c.responseOptions) ? c.responseOptions : [];
  if (options.length < 2 || options.some((o) => !o || !validValue(o.value) || !text(o.label))
      || new Set(options.map((o) => o && valueKey(o.value))).size !== options.length) errors.push('invalid_responseOptions');
  const items = (Array.isArray(c.items) ? c.items : []).map((item, i) => ({
    id: item && item.id, text: item && item.text,
    originalOrder: item && item.originalOrder !== undefined ? item.originalOrder : i + 1,
  }));
  if (!items.length || items.some((i) => !text(i.id) || !text(i.text) || !Number.isInteger(i.originalOrder) || i.originalOrder < 1)
      || new Set(items.map((i) => i.id)).size !== items.length
      || new Set(items.map((i) => i.originalOrder)).size !== items.length) errors.push('invalid_items');
  items.sort((a, b) => a.originalOrder - b.originalOrder);
  c.items = items;
  c.responseOptions = options.map((o) => ({ value: o && o.value, label: o && o.label }));
  return { config: c, errors };
}

// Consistency marker only, not a signature or a security primitive.
function fingerprint(c) {
  const source = JSON.stringify([c.studyId, c.scaleId, c.scaleVersion, c.instructions,
    c.responseOptions, c.items, c.itemsPerBreak, c.consentText, c.recallWindow, c.assessmentWindowHours]);
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) { hash ^= source.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function randomId(prefix) {
  const cryptoObject = typeof globalThis !== 'undefined' && globalThis.crypto;
  if (cryptoObject && typeof cryptoObject.randomUUID === 'function') return `${prefix}_${cryptoObject.randomUUID()}`;
  if (cryptoObject && typeof cryptoObject.getRandomValues === 'function') {
    const bytes = new Uint8Array(16); cryptoObject.getRandomValues(bytes);
    return `${prefix}_${Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('')}`;
  }
  // Compatibility fallback for hosts without Web Crypto. No game RNG is read.
  const parts = Array.from({ length: 4 }, () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0'));
  return `${prefix}_${parts.join('')}`;
}

function createSurvey(input, storage) {
  const prepared = prepareConfig(input);
  const config = prepared.config;
  const configFingerprint = fingerprint(config);
  const studyId = text(config.studyId) ? config.studyId : DEFAULT_CONFIG.studyId;
  const storageKey = `${STORAGE_PREFIX}${encodeURIComponent(studyId)}`;
  let lastError = null;
  let loadError = null;
  let pendingParticipantContext = null;
  const empty = () => ({
    schemaVersion: 1, studyId, participantId: null, consentStatus: 'not_asked',
    consentAt: null, declinedAt: null, withdrawnAt: null, consentFingerprint: null,
    participantContext: null, assessment: null, withdrawalRecords: [],
  });
  let state = empty();

  if (storage && typeof storage.getItem === 'function') {
    try {
      const raw = storage.getItem(storageKey);
      if (raw !== null && raw !== undefined && raw !== '') {
        const saved = typeof raw === 'string' ? JSON.parse(raw) : copy(raw);
        if (!validSavedState(saved, studyId)) throw new Error('invalid_state');
        // Select only fields owned by this module; never import a user profile.
        for (const key of Object.keys(state)) {
          if (saved[key] !== undefined) state[key] = copy(saved[key]);
        }
      }
    } catch (_) { loadError = 'storage_corrupt'; }
  }

  function isConfigured() { return prepared.errors.length === 0; }
  function mismatch() { return Boolean(state.consentFingerprint && state.consentFingerprint !== configFingerprint); }
  function nowOverdue(assessment) {
    if (!assessment) return false;
    const lastTime = assessment.completedAt || state.withdrawnAt || isoNow();
    return assessment.overdue || Date.parse(lastTime) > Date.parse(assessment.deadlineAt);
  }
  function getState() {
    const snapshot = copy(state);
    if (snapshot.assessment) snapshot.assessment.overdue = nowOverdue(snapshot.assessment);
    snapshot.configured = isConfigured();
    snapshot.configurationErrors = prepared.errors.slice();
    snapshot.configMismatch = mismatch();
    snapshot.storageKey = storageKey;
    snapshot.overdue = Boolean(snapshot.assessment && snapshot.assessment.overdue);
    snapshot.lastError = lastError || loadError;
    return snapshot;
  }
  function result(ok, code) { return { ok, code, state: getState() }; }
  function commit(next) {
    try {
      if (storage) {
        if (typeof storage.setItem !== 'function' || storage.setItem(storageKey, JSON.stringify(next)) === false) throw new Error('write_failed');
      }
      state = next; lastError = null; return true;
    } catch (_) { lastError = 'storage_error'; return false; }
  }
  function gate(requireConsent) {
    if (loadError) return loadError;
    if (!isConfigured()) return 'not_configured';
    if (mismatch()) return 'configuration_changed';
    if (state.consentStatus === 'withdrawn') return 'withdrawn';
    if (state.consentStatus === 'declined') return 'declined';
    if (requireConsent && state.consentStatus !== 'accepted') return 'consent_required';
    return null;
  }
  function setParticipantContext(context) {
    if (!context || typeof context !== 'object' || Array.isArray(context)
        || !OCCUPATIONS.includes(context.occupation)
        || Object.keys(context).some((key) => key !== 'occupation')) return result(false, 'invalid_participant_context');
    if (loadError) return result(false, loadError);
    if (state.consentStatus === 'withdrawn' || state.consentStatus === 'declined') return result(false, state.consentStatus);
    const selected = { occupation: context.occupation };
    if (state.consentStatus !== 'accepted') {
      pendingParticipantContext = selected;
      return result(true, 'participant_context_pending');
    }
    const reason = gate(true);
    if (reason) return result(false, reason);
    const next = copy(state); next.participantContext = selected;
    return result(commit(next), lastError || 'participant_context_saved');
  }
  function consent(accepted) {
    const reason = gate(false);
    if (reason) return result(false, reason);
    if (typeof accepted !== 'boolean') return result(false, 'invalid_consent');
    if (!accepted) return decline();
    if (state.consentStatus === 'accepted') return result(true, 'already_consented');
    const next = copy(state);
    next.consentStatus = 'accepted'; next.consentAt = isoNow();
    next.consentFingerprint = configFingerprint; next.participantId = randomId('participant');
    next.participantContext = pendingParticipantContext ? copy(pendingParticipantContext) : null;
    const saved = commit(next);
    if (saved) pendingParticipantContext = null;
    return result(saved, lastError || 'consented');
  }
  function beginAssessment() {
    const reason = gate(true);
    if (reason) return result(false, reason);
    if (state.assessment) return result(true, 'assessment_exists');
    const next = copy(state); const startedAt = isoNow();
    next.assessment = {
      assessmentId: randomId('assessment'), startedAt,
      deadlineAt: new Date(Date.parse(startedAt) + config.assessmentWindowHours * 3600000).toISOString(),
      assessmentWindowHours: config.assessmentWindowHours,
      status: 'in_progress', completedAt: null, overdue: false,
      scaleId: config.scaleId, scaleVersion: config.scaleVersion,
      recallWindow: config.recallWindow, configFingerprint,
      responseOptions: copy(config.responseOptions), itemsPerBreak: config.itemsPerBreak,
      batches: [], chapterBatches: {},
      records: config.items.map((item) => ({
        itemId: item.id, originalOrder: item.originalOrder, status: 'not_presented',
        value: null, presentedAt: null, answeredAt: null, skippedAt: null,
        answeredChapterId: null, sourceId: null, gameOrder: null,
        missingReason: 'not_presented', presentations: [],
      })),
    };
    return result(commit(next), lastError || 'assessment_started');
  }
  function chapterKey(chapterId) {
    if ((typeof chapterId === 'number' && Number.isFinite(chapterId)) || text(chapterId)) return `chapter:${String(chapterId)}`;
    return null;
  }
  function getNextBatch(chapterId, context = {}) {
    const reason = gate(true); const key = chapterKey(chapterId);
    const suppliedOrder = context && context.gameOrder;
    if (!validGameOrder(suppliedOrder)) { lastError = 'invalid_game_order'; return []; }
    const gameOrder = suppliedOrder === undefined || suppliedOrder === null ? null : suppliedOrder;
    if (reason || !key || !state.assessment || state.assessment.status !== 'in_progress') {
      lastError = reason || (!key ? 'invalid_chapter' : null); return [];
    }
    const next = copy(state); const a = next.assessment; const at = isoNow();
    a.overdue = nowOverdue(a);
    let batch = a.batches.find((b) => b.id === a.chapterBatches[key]);
    if (batch && batch.completedAt) return [];
    if (!batch) {
      batch = a.batches.find((b) => !b.completedAt);
      if (!batch) {
        const items = a.records.filter((r) => r.status === 'not_presented').slice(0, config.itemsPerBreak);
        if (!items.length) return [];
        batch = { id: `batch_${a.batches.length + 1}`, itemIds: items.map((r) => r.itemId), createdAt: at, completedAt: null, chapterIds: [], contexts: [] };
        a.batches.push(batch);
      }
      a.chapterBatches[key] = batch.id;
      batch.chapterIds.push(chapterId);
    }
    if (!batch.contexts) batch.contexts = [];
    if (!batch.contexts.some((c) => chapterKey(c.sourceId) === key && c.gameOrder === gameOrder)) {
      batch.contexts.push({ sourceId: chapterId, gameOrder });
    }
    const pending = a.records.filter((r) => batch.itemIds.includes(r.itemId) && !['answered', 'skipped'].includes(r.status));
    for (const record of pending) {
      record.status = 'presented'; record.missingReason = 'unanswered';
      if (!record.presentedAt) {
        record.presentedAt = at; record.sourceId = chapterId; record.gameOrder = gameOrder;
      }
      if (!record.presentations.some((p) => chapterKey(p.chapterId) === key && (p.gameOrder ?? null) === gameOrder)) {
        record.presentations.push({ chapterId, sourceId: chapterId, gameOrder, presentedAt: at });
      }
    }
    if (!commit(next)) return [];
    return pending.map((record) => ({
      id: record.itemId, itemId: record.itemId, originalOrder: record.originalOrder,
      text: config.items.find((i) => i.id === record.itemId).text,
      responseOptions: copy(config.responseOptions), presentedAt: record.presentedAt,
      batchId: batch.id, chapterId, sourceId: chapterId, gameOrder,
    }));
  }
  function respond(itemId, value, context, skipping) {
    const reason = gate(true);
    if (reason) return result(false, reason);
    if (!state.assessment) return result(false, 'assessment_required');
    if (state.assessment.status !== 'in_progress') return result(false, 'assessment_closed');
    const key = chapterKey(context && context.chapterId);
    const suppliedOrder = context && context.gameOrder;
    if (!validGameOrder(suppliedOrder)) return result(false, 'invalid_game_order');
    const existing = state.assessment.records.find((r) => r.itemId === itemId);
    if (!existing) return result(false, 'unknown_item');
    if (['answered', 'skipped'].includes(existing.status)) return result(false, 'already_resolved');
    if (!key || !existing.presentations.some((p) => chapterKey(p.chapterId) === key)) return result(false, 'not_presented_in_chapter');
    const matchingPresentations = existing.presentations.filter((p) => chapterKey(p.chapterId) === key
      && (suppliedOrder === undefined || suppliedOrder === null || p.gameOrder === suppliedOrder));
    if (!matchingPresentations.length) return result(false, 'not_presented_in_context');
    const presentation = matchingPresentations[matchingPresentations.length - 1];
    const gameOrder = suppliedOrder === undefined || suppliedOrder === null ? (presentation.gameOrder ?? null) : suppliedOrder;
    if (!skipping && !config.responseOptions.some((o) => Object.is(o.value, value))) return result(false, 'invalid_value');
    const next = copy(state); const a = next.assessment; const at = isoNow();
    const record = a.records.find((r) => r.itemId === itemId);
    record.status = skipping ? 'skipped' : 'answered'; record.value = skipping ? null : value;
    record.answeredAt = skipping ? null : at; record.skippedAt = skipping ? at : null;
    record.answeredChapterId = context.chapterId; record.missingReason = skipping ? 'participant_skip' : null;
    record.sourceId = context.chapterId; record.gameOrder = gameOrder;
    a.overdue = nowOverdue(a);
    for (const batch of a.batches) {
      if (!batch.completedAt && batch.itemIds.every((id) => a.records.some((r) => r.itemId === id && ['answered', 'skipped'].includes(r.status)))) batch.completedAt = at;
    }
    if (a.records.every((r) => ['answered', 'skipped'].includes(r.status))) { a.status = 'complete'; a.completedAt = at; }
    return result(commit(next), lastError || (skipping ? 'skipped' : 'answered'));
  }
  function answer(itemId, value, context = {}) { return respond(itemId, value, context, false); }
  function skip(itemId, context = {}) { return respond(itemId, null, context, true); }
  function decline() {
    if (loadError) return result(false, loadError);
    if (!isConfigured()) return result(false, 'not_configured');
    if (state.consentStatus === 'withdrawn') return result(false, 'withdrawn');
    if (state.consentStatus === 'accepted') return withdraw();
    if (state.consentStatus === 'declined') return result(true, 'already_declined');
    const next = copy(state); next.consentStatus = 'declined'; next.declinedAt = isoNow();
    pendingParticipantContext = null;
    return result(commit(next), lastError || 'declined');
  }
  function withdraw() {
    if (loadError) return result(false, loadError);
    if (state.consentStatus === 'withdrawn') return result(true, 'already_withdrawn');
    if (state.consentStatus !== 'accepted') return result(false, 'consent_required');
    const next = copy(state); const at = isoNow();
    next.consentStatus = 'withdrawn'; next.withdrawnAt = at;
    next.withdrawalRecords.push({ withdrawnAt: at, assessmentId: next.assessment ? next.assessment.assessmentId : null });
    if (next.assessment) { next.assessment.overdue = nowOverdue(next.assessment); next.assessment.status = 'withdrawn'; }
    return result(commit(next), lastError || 'withdrawn');
  }
  function exportData() {
    const s = getState(); const a = s.assessment;
    return JSON.stringify({
      schemaVersion: 1, studyId, participantId: s.participantId,
      participantContext: s.participantContext,
      consentStatus: s.consentStatus, consentAt: s.consentAt, declinedAt: s.declinedAt,
      withdrawnAt: s.withdrawnAt, withdrawalRecords: s.withdrawalRecords,
      assessment: a ? {
        assessmentId: a.assessmentId, scaleId: a.scaleId, scaleVersion: a.scaleVersion,
        configFingerprint: a.configFingerprint, recallWindow: a.recallWindow,
        startedAt: a.startedAt, completedAt: a.completedAt, deadlineAt: a.deadlineAt,
        assessmentWindowHours: a.assessmentWindowHours, overdue: a.overdue,
        status: a.status, itemsPerBreak: a.itemsPerBreak,
        responseOptions: a.responseOptions, records: a.records, batches: a.batches,
        counts: { total: a.records.length, answered: a.records.filter((r) => r.status === 'answered').length,
          skipped: a.records.filter((r) => r.status === 'skipped').length,
          missing: a.records.filter((r) => r.status !== 'answered').length },
      } : null,
      scoring: { computed: false, reason: 'Scoring is not implemented; use the authorised manual and its missing-data rules separately.' },
    }, null, 2);
  }
  function clearData() {
    try {
      if (storage && (typeof storage.removeItem !== 'function' || storage.removeItem(storageKey) === false)) throw new Error('delete_failed');
      state = empty(); pendingParticipantContext = null; lastError = null; loadError = null;
      return result(true, 'cleared');
    } catch (_) { lastError = 'storage_error'; return result(false, 'storage_error'); }
  }
  return { getState, isConfigured, setParticipantContext, consent, beginAssessment, getNextBatch, answer, skip, decline, withdraw, exportData, clearData };
}

function validSavedState(s, studyId) {
  if (!s || s.schemaVersion !== 1 || s.studyId !== studyId
      || !['not_asked', 'accepted', 'declined', 'withdrawn'].includes(s.consentStatus)
      || !Array.isArray(s.withdrawalRecords)) return false;
  for (const key of ['participantId', 'consentAt', 'declinedAt', 'withdrawnAt', 'consentFingerprint']) {
    if (s[key] !== null && typeof s[key] !== 'string') return false;
  }
  if (['accepted', 'withdrawn'].includes(s.consentStatus) && (!s.participantId || !s.consentAt || !s.consentFingerprint)) return false;
  if (s.participantContext !== undefined && s.participantContext !== null
      && (!OCCUPATIONS.includes(s.participantContext.occupation)
        || Object.keys(s.participantContext).some((key) => key !== 'occupation'))) return false;
  if (s.assessment === null) return true;
  const a = s.assessment;
  if (!a || !text(a.assessmentId) || !text(a.scaleId) || !text(a.scaleVersion)
      || !Number.isFinite(Date.parse(a.startedAt)) || !Number.isFinite(Date.parse(a.deadlineAt))
      || !['in_progress', 'complete', 'withdrawn'].includes(a.status)
      || !Array.isArray(a.records) || !a.records.length || !Array.isArray(a.batches)
      || !a.chapterBatches || typeof a.chapterBatches !== 'object' || !Array.isArray(a.responseOptions)) return false;
  return a.records.every((r) => r && text(r.itemId) && Number.isInteger(r.originalOrder)
    && ['not_presented', 'presented', 'answered', 'skipped'].includes(r.status) && Array.isArray(r.presentations))
    && a.batches.every((b) => b && text(b.id) && Array.isArray(b.itemIds) && Array.isArray(b.chapterIds));
}

module.exports = { createSurvey, DEFAULT_CONFIG, STORAGE_PREFIX };
