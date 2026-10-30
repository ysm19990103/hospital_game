'use strict';

/** Permanent local cosmetics. No engine, RNG, score, profile or survey access. */
const STORAGE_KEY = 'baiyi.medals.v1';
const MEDAL_CATALOG = Object.freeze([
  Object.freeze({ id: 'first_full_marks', name: '小试牛刀', description: '完成一次月度考核，并答对全部题目。' }),
  Object.freeze({ id: 'wealth_200', name: '财源滚滚', description: '金币余额达到 200。' }),
  Object.freeze({ id: 'zero_coins', name: '沿街乞讨', description: '金币余额为 0 时获得。' }),
  Object.freeze({ id: 'work_streak_4', name: '勤奋过人', description: '连续完成 4 次有效工作。' }),
  Object.freeze({ id: 'research_streak_4', name: '科研达人', description: '连续完成 4 次有效科研。' }),
  Object.freeze({ id: 'no_rest_10', name: '通宵达旦', description: '连续 7 个游戏日未休息或娱乐；首次视频日也计入。' }),
  Object.freeze({ id: 'death_5', name: '死亡牛马', description: '纪念馆累计记录 5 次死亡。' }),
  Object.freeze({ id: 'leadership_bad_5', name: '鼠鼠鼠了', description: '连续 5 次不良事件都来自领导或派系。' }),
  Object.freeze({ id: 'beneficial_5', name: '好运降临', description: '累计经历 5 次良性随机事件。' }),
  Object.freeze({ id: 'balanced_week', name: '劳逸结合', description: '连续 7 个完整游戏日，每天都有临床行动与正式休息。' }),
  Object.freeze({ id: 'knowledge_10', name: '学以致用', description: '正确完成 10 项不同的教学任务。' }),
  Object.freeze({ id: 'puzzles_5', name: '抽丝剥茧', description: '看完 5 个不同章节的剧情视频；旧版推理进度保留。' }),
  Object.freeze({ id: 'npc_all', name: '同舟共济', description: '完成四位同行者各自的支线。' }),
  Object.freeze({ id: 'branch_2', name: '改写命运', description: '在同一章节收集两个不同的分支结局。' }),
]);
const IDS = MEDAL_CATALOG.map((medal) => medal.id);
const NPC_IDS = Object.freeze(['guning', 'huangning', 'limuliang', 'liuchangsheng']);
const ACTIONS = ['work', 'research', 'politics', 'rest', 'entertain', 'inspect', 'travel', 'prepare', 'puzzle', 'npc', 'clinical'];
const NO_REST_UNITS = 35;
const emptyProgress = () => ({ workStreak: 0, researchStreak: 0, noRestCount: 0 });
const emptyBalance = () => ({ consecutiveDays: 0, dayNumber: null, actionsObserved: 0, hasClinical: false, hasRest: false, fullDay: false });
const emptyEvents = () => ({ leadershipAdverseStreak: 0, beneficialCount: 0 });
const emptyCollections = () => ({ knowledgeIds: [], puzzleChapterIds: [], npcIds: [], chapterEndings: [] });
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const identifier = (value) => (typeof value === 'string' && /^[A-Za-z0-9_:.-]{1,100}$/.test(value))
  || (Number.isSafeInteger(value) && value >= 0);
const occurrenceId = (value) => typeof value === 'string' && /^[A-Za-z0-9_:.-]{1,200}$/.test(value);
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value);
const fullMarks = (value) => plain(value) && Number.isSafeInteger(value.score)
  && Number.isSafeInteger(value.total) && value.total > 0 && value.score === value.total;

// Select only evidence relevant to a cosmetic unlock. Never persist game state,
// answers, participant IDs, names, other personal fields or arbitrary metadata.
function evidenceFor(id, source) {
  if (!plain(source)) return null;
  if (id === 'first_full_marks' && fullMarks(source)) {
    const evidence = { score: source.score, total: source.total };
    if (Number.isSafeInteger(source.month) && source.month > 0) evidence.month = source.month;
    return evidence;
  }
  if (id === 'wealth_200' && typeof source.money === 'number' && Number.isFinite(source.money) && source.money >= 200) return { money: source.money };
  if (id === 'zero_coins' && source.money === 0) return { money: 0 };
  if (id === 'work_streak_4' && count(source.consecutiveActions) && source.consecutiveActions >= 4) return { actionType: 'work', consecutiveActions: source.consecutiveActions };
  if (id === 'research_streak_4' && count(source.consecutiveActions) && source.consecutiveActions >= 4) return { actionType: 'research', consecutiveActions: source.consecutiveActions };
  // Keep original ten-unit unlocks readable; new unlocks use NO_REST_UNITS.
  if (id === 'no_rest_10' && count(source.consecutiveActions) && source.consecutiveActions >= 10) return { consecutiveActions: source.consecutiveActions };
  if (id === 'death_5' && count(source.deathCount) && source.deathCount >= 5) return { deathCount: source.deathCount };
  if (id === 'leadership_bad_5' && count(source.consecutiveEvents) && source.consecutiveEvents >= 5) return { consecutiveEvents: source.consecutiveEvents };
  if (id === 'beneficial_5' && count(source.beneficialEvents) && source.beneficialEvents >= 5) return { beneficialEvents: source.beneficialEvents };
  if (id === 'balanced_week' && count(source.consecutiveDays) && source.consecutiveDays >= 7) return { consecutiveDays: source.consecutiveDays };
  if (id === 'knowledge_10' && count(source.questionCount) && source.questionCount >= 10) return { questionCount: source.questionCount };
  if (id === 'puzzles_5' && count(source.chapterCount) && source.chapterCount >= 5) return { chapterCount: source.chapterCount };
  if (id === 'npc_all' && source.npcCount === NPC_IDS.length) return { npcCount: NPC_IDS.length };
  if (id === 'branch_2' && identifier(source.chapterId) && count(source.endingCount) && source.endingCount >= 2) return { chapterId: String(source.chapterId), endingCount: source.endingCount };
  return null;
}

function sanitizeCollections(source) {
  if (!plain(source)) throw new Error('storage_corrupt');
  const result = emptyCollections();
  for (const field of ['knowledgeIds', 'puzzleChapterIds', 'npcIds']) {
    if (!Array.isArray(source[field]) || source[field].some((id) => !identifier(id)
      || (field === 'npcIds' && !NPC_IDS.includes(id)))) throw new Error('storage_corrupt');
    result[field] = [...new Set(source[field].map(String))];
  }
  if (!Array.isArray(source.chapterEndings)) throw new Error('storage_corrupt');
  const chapters = new Map();
  for (const chapter of source.chapterEndings) {
    if (!plain(chapter) || !identifier(chapter.chapterId) || !Array.isArray(chapter.endingIds)
      || chapter.endingIds.some((id) => !identifier(id))) throw new Error('storage_corrupt');
    const key = String(chapter.chapterId);
    chapters.set(key, [...new Set([...(chapters.get(key) || []), ...chapter.endingIds.map(String)])]);
  }
  result.chapterEndings = [...chapters].map(([chapterId, endingIds]) => ({ chapterId, endingIds }));
  return result;
}
function mergeCollections(first, second) {
  return sanitizeCollections({
    knowledgeIds: [...first.knowledgeIds, ...second.knowledgeIds],
    puzzleChapterIds: [...first.puzzleChapterIds, ...second.puzzleChapterIds],
    npcIds: [...first.npcIds, ...second.npcIds],
    chapterEndings: [...first.chapterEndings, ...second.chapterEndings],
  });
}

function createMedals(storage, options = {}) {
  let records = new Map();
  let persistedIds = new Set();
  let activeTitle = null;
  let activeDirty = false;
  let progress = emptyProgress();
  let lastActionCount = null;
  let lastVideoDays = null;
  let progressDirty = false;
  let balanceProgress = emptyBalance();
  let eventProgress = emptyEvents();
  let seenEventIds = new Set();
  let eventsDirty = false;
  let collections = emptyCollections();
  let collectionsDirty = false;
  let storageError = null;
  let clockError = null;

  function readDisk() {
    if (!storage || typeof storage.getItem !== 'function') throw new Error('storage_unavailable');
    const raw = storage.getItem(STORAGE_KEY);
    if (raw == null || raw === '') return { records: [], activeTitle: null, progress: emptyProgress(), lastActionCount: null, lastVideoDays: null,
      balanceProgress: emptyBalance(), eventProgress: emptyEvents(), seenEventIds: [], collections: emptyCollections() };
    let data;
    try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { throw new Error('storage_corrupt'); }
    if (!plain(data) || data.version !== 1 || !Array.isArray(data.records)) throw new Error('storage_corrupt');
    const sanitized = []; const seen = new Set();
    for (const record of data.records) {
      if (!plain(record) || !IDS.includes(record.id) || seen.has(record.id)
        || (record.unlockedAt !== null && (typeof record.unlockedAt !== 'string' || !Number.isFinite(Date.parse(record.unlockedAt))))) throw new Error('storage_corrupt');
      const evidence = evidenceFor(record.id, record.evidence);
      if (!evidence) throw new Error('storage_corrupt');
      seen.add(record.id);
      sanitized.push({ id: record.id, unlockedAt: record.unlockedAt, evidence });
    }
    if (data.activeTitle !== null && !seen.has(data.activeTitle)) throw new Error('storage_corrupt');
    const savedProgress = data.progress === undefined ? emptyProgress() : data.progress;
    const savedActionCount = data.lastActionCount === undefined ? null : data.lastActionCount;
    const savedVideoDays = data.lastVideoDays === undefined ? null : data.lastVideoDays;
    if (!plain(savedProgress) || Object.keys(emptyProgress()).some((key) => !count(savedProgress[key]))
      || (savedActionCount !== null && (!count(savedActionCount) || savedActionCount === 0))
      || (savedVideoDays !== null && (!count(savedVideoDays) || savedVideoDays === 0))) throw new Error('storage_corrupt');
    // Added fields are optional only for migration from the original seven-title
    // version. Existing permanent unlocks and worn title are never reset.
    const savedBalance = data.balanceProgress === undefined ? emptyBalance() : data.balanceProgress;
    if (!plain(savedBalance) || !count(savedBalance.consecutiveDays) || !count(savedBalance.actionsObserved)
      || savedBalance.actionsObserved > 5 || (savedBalance.dayNumber !== null && (!count(savedBalance.dayNumber) || savedBalance.dayNumber === 0))
      || ['hasClinical', 'hasRest', 'fullDay'].some((key) => typeof savedBalance[key] !== 'boolean')) throw new Error('storage_corrupt');
    const savedEvents = data.eventProgress === undefined ? emptyEvents() : data.eventProgress;
    const savedEventIds = data.seenEventIds === undefined ? [] : data.seenEventIds;
    if (!plain(savedEvents) || !count(savedEvents.leadershipAdverseStreak) || !count(savedEvents.beneficialCount)
      || !Array.isArray(savedEventIds) || savedEventIds.some((id) => !occurrenceId(id))) throw new Error('storage_corrupt');
    const savedCollections = data.collections === undefined ? emptyCollections() : sanitizeCollections(data.collections);
    return { records: sanitized, activeTitle: data.activeTitle,
      progress: { workStreak: savedProgress.workStreak, researchStreak: savedProgress.researchStreak, noRestCount: savedProgress.noRestCount },
      lastActionCount: savedActionCount, lastVideoDays: savedVideoDays,
      balanceProgress: Object.fromEntries(Object.keys(emptyBalance()).map((key) => [key, savedBalance[key]])),
      eventProgress: { leadershipAdverseStreak: savedEvents.leadershipAdverseStreak, beneficialCount: savedEvents.beneficialCount },
      seenEventIds: [...new Set(savedEventIds)], collections: savedCollections };
  }
  function mergeFromDisk() {
    const disk = readDisk();
    const merged = new Map(disk.records.map((record) => [record.id, record]));
    // A stored first unlock wins if two active views earned the same title.
    for (const [id, record] of records) if (!merged.has(id)) merged.set(id, record);
    records = merged;
    persistedIds = new Set(disk.records.map((record) => record.id));
    if (!activeDirty) activeTitle = disk.activeTitle;
    if (!progressDirty) { progress = disk.progress; lastActionCount = disk.lastActionCount; lastVideoDays = disk.lastVideoDays; balanceProgress = disk.balanceProgress; }
    if (!eventsDirty) eventProgress = disk.eventProgress;
    seenEventIds = new Set([...disk.seenEventIds, ...seenEventIds]);
    collections = mergeCollections(disk.collections, collections);
    return disk;
  }
  function unsavedCount() {
    return [...records.keys()].filter((id) => !persistedIds.has(id)).length + (activeDirty ? 1 : 0)
      + (progressDirty ? 1 : 0) + (eventsDirty ? 1 : 0) + (collectionsDirty ? 1 : 0);
  }
  function retry() {
    try {
      mergeFromDisk();
      if (unsavedCount()) {
        if (!storage || typeof storage.setItem !== 'function') throw new Error('storage_unavailable');
        const accepted = storage.setItem(STORAGE_KEY, JSON.stringify({
          version: 1, records: [...records.values()], activeTitle, progress, lastActionCount, lastVideoDays,
          balanceProgress, eventProgress, seenEventIds: [...seenEventIds], collections,
        }));
        if (accepted === false || (accepted && typeof accepted.then === 'function')) throw new Error('storage_write_failed');
        persistedIds = new Set(records.keys()); activeDirty = false; progressDirty = false; eventsDirty = false; collectionsDirty = false;
      }
      storageError = null;
      return { ok: true, persisted: true, storageError: null, unsavedCount: 0 };
    } catch (error) {
      storageError = error && error.message || 'storage_write_failed';
      return { ok: false, persisted: false, storageError, unsavedCount: unsavedCount() };
    }
  }
  try { mergeFromDisk(); } catch (error) { storageError = error && error.message || 'storage_read_failed'; }

  function getState() {
    return {
      medals: MEDAL_CATALOG.map((medal) => {
        const record = records.get(medal.id);
        return { ...medal, unlocked: !!record, unlockedAt: record ? record.unlockedAt : null,
          evidence: record ? clone(record.evidence) : null };
      }),
      activeTitle, progress: clone(progress), balanceProgress: clone(balanceProgress),
      eventProgress: clone(eventProgress), collections: clone(collections),
      storageKey: STORAGE_KEY, storageError, clockError, unsavedCount: unsavedCount(),
    };
  }
  function now() {
    try {
      const clock = options && options.clock;
      const value = typeof clock === 'function' ? clock() : clock && typeof clock.now === 'function' ? clock.now() : Date.now();
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) throw new Error('invalid_clock');
      clockError = null; return date.toISOString();
    } catch (_) {
      // An unavailable clock must not lose a one-time achievement. Null means
      // the timestamp is unknown; the title and its game evidence remain valid.
      clockError = 'invalid_clock'; return null;
    }
  }
  function observeState(gameState) {
    if (!plain(gameState)) return { ok: false, code: 'invalid_game_state', newlyUnlocked: [], storageError };
    try { mergeFromDisk(); } catch (error) { storageError = error && error.message || 'storage_read_failed'; }
    const candidates = [];
    const assessment = Array.isArray(gameState.completedAssessments) && gameState.completedAssessments.find(fullMarks);
    if (assessment) candidates.push(['first_full_marks', evidenceFor('first_full_marks', assessment)]);
    for (const id of ['wealth_200', 'zero_coins']) {
      const evidence = evidenceFor(id, { money: gameState.money });
      if (evidence) candidates.push([id, evidence]);
    }
    if (Array.isArray(gameState.endings)) {
      for (const ending of gameState.endings) {
        if (plain(ending) && identifier(ending.chapterId) && identifier(ending.choiceId)) rememberEnding(ending.chapterId, ending.choiceId);
      }
    }
    if (Array.isArray(gameState.completedVideos)) {
      for (const id of gameState.completedVideos) {
        if (Number.isInteger(Number(id)) && Number(id) >= 1 && Number(id) <= 29) rememberId('puzzleChapterIds', Number(id));
      }
    }
    candidates.push(...collectionCandidates());
    return applyCandidates(candidates, 'observed');
  }
  function applyCandidates(candidates, code) {
    const newlyUnlockedIds = [];
    for (const [id, evidence] of candidates) {
      if (records.has(id)) continue;
      records.set(id, { id, unlockedAt: now(), evidence });
      newlyUnlockedIds.push(id);
    }
    // Retry an earlier refused write even when this observation unlocks nothing.
    if (newlyUnlockedIds.length || unsavedCount() || storageError) retry();
    const snapshot = getState();
    return { ok: true, code, newlyUnlocked: snapshot.medals.filter((medal) => newlyUnlockedIds.includes(medal.id)),
      persisted: !storageError && !unsavedCount(), storageError, clockError, unsavedCount: unsavedCount() };
  }
  function observeAction(type, gameState, context = {}) {
    // The game adapter calls this ONLY after act returned ok and advanced its
    // calendar actionCount, even if that action immediately entered failure.
    if (!ACTIONS.includes(type) || !plain(gameState) || !count(gameState.actionCount) || gameState.actionCount === 0) {
      return { ok: false, code: 'invalid_action', newlyUnlocked: [], storageError };
    }
    try { mergeFromDisk(); } catch (error) { storageError = error && error.message || 'storage_read_failed'; }
    if (lastActionCount === gameState.actionCount) return applyCandidates([], 'duplicate_action');
    progress.workStreak = type === 'work' ? progress.workStreak + 1 : 0;
    progress.researchStreak = type === 'research' ? progress.researchStreak + 1 : 0;
    progress.noRestCount = ['rest', 'entertain'].includes(type) ? 0 : progress.noRestCount + 1;
    updateBalance(type, gameState);
    lastActionCount = gameState.actionCount; progressDirty = true;
    const candidates = [];
    for (const [id, consecutiveActions] of [
      ['work_streak_4', progress.workStreak], ['research_streak_4', progress.researchStreak], ['no_rest_10', progress.noRestCount],
    ]) {
      if (id === 'no_rest_10' && consecutiveActions < NO_REST_UNITS) continue;
      const evidence = evidenceFor(id, { consecutiveActions });
      if (evidence) candidates.push([id, evidence]);
    }
    if (plain(context)) {
      if (type === 'clinical' && context.correct === true && identifier(context.questionId)) rememberId('knowledgeIds', context.questionId);
      if (type === 'puzzle' && context.puzzleSolved === true && identifier(context.chapterId)) rememberId('puzzleChapterIds', context.chapterId);
      if (type === 'npc' && context.questCompleted === true && NPC_IDS.includes(context.npcId)) rememberId('npcIds', context.npcId);
    }
    const balancedEvidence = evidenceFor('balanced_week', { consecutiveDays: balanceProgress.consecutiveDays });
    if (balancedEvidence) candidates.push(['balanced_week', balancedEvidence]);
    candidates.push(...collectionCandidates());
    return applyCandidates(candidates, 'action_observed');
  }
  function observeVideoDay(gameState, elapsedUnits) {
    if (!plain(gameState) || !count(gameState.videoDays) || gameState.videoDays === 0 || elapsedUnits !== 5) {
      return { ok: false, code: 'invalid_video_day', newlyUnlocked: [], storageError };
    }
    try { mergeFromDisk(); } catch (error) { storageError = error && error.message || 'storage_read_failed'; }
    if (lastVideoDays !== null && gameState.videoDays <= lastVideoDays) return applyCandidates([], 'duplicate_video_day');
    // A full day of story time is not five completed work/research actions.
    // It does count as time without a formal rest and interrupts balanced days.
    progress.workStreak = 0; progress.researchStreak = 0;
    progress.noRestCount += elapsedUnits;
    balanceProgress = emptyBalance();
    lastVideoDays = gameState.videoDays; progressDirty = true;
    const evidence = progress.noRestCount >= NO_REST_UNITS ? evidenceFor('no_rest_10', { consecutiveActions: progress.noRestCount }) : null;
    return applyCandidates(evidence ? [['no_rest_10', evidence]] : [], 'video_day_observed');
  }
  function updateBalance(type, gameState) {
    const actionCount = gameState.actionCount;
    const dayNumber = Math.floor((actionCount - 1) / 5) + 1 + (count(gameState.videoDays) ? gameState.videoDays : 0);
    const position = ((actionCount - 1) % 5) + 1;
    if (lastActionCount !== null && actionCount !== lastActionCount + 1) balanceProgress.consecutiveDays = 0;
    if (balanceProgress.dayNumber !== dayNumber) {
      balanceProgress.dayNumber = dayNumber; balanceProgress.actionsObserved = 0;
      balanceProgress.hasClinical = false; balanceProgress.hasRest = false;
      balanceProgress.fullDay = position === 1;
    } else if (lastActionCount === null || actionCount !== lastActionCount + 1) balanceProgress.fullDay = false;
    balanceProgress.actionsObserved += 1;
    if (['work', 'clinical'].includes(type)) balanceProgress.hasClinical = true;
    if (['rest', 'entertain'].includes(type)) balanceProgress.hasRest = true;
    if (position === 5) {
      const complete = balanceProgress.fullDay && balanceProgress.actionsObserved === 5
        && balanceProgress.hasClinical && balanceProgress.hasRest;
      balanceProgress.consecutiveDays = complete ? balanceProgress.consecutiveDays + 1 : 0;
    }
  }
  function rememberId(field, id) {
    const key = String(id);
    if (!collections[field].includes(key)) { collections[field].push(key); collectionsDirty = true; }
  }
  function rememberEnding(chapterId, endingId) {
    const key = String(chapterId); const choiceId = String(endingId);
    let entry = collections.chapterEndings.find((chapter) => chapter.chapterId === key);
    if (!entry) { entry = { chapterId: key, endingIds: [] }; collections.chapterEndings.push(entry); }
    if (!entry.endingIds.includes(choiceId)) { entry.endingIds.push(choiceId); collectionsDirty = true; }
  }
  function collectionCandidates() {
    const candidates = [];
    for (const [id, source] of [
      ['knowledge_10', { questionCount: collections.knowledgeIds.length }],
      ['puzzles_5', { chapterCount: collections.puzzleChapterIds.length }],
      ['npc_all', { npcCount: collections.npcIds.length }],
    ]) {
      const evidence = evidenceFor(id, source);
      if (evidence) candidates.push([id, evidence]);
    }
    const branch = collections.chapterEndings.find((chapter) => chapter.endingIds.length >= 2);
    if (branch) candidates.push(['branch_2', evidenceFor('branch_2', { chapterId: branch.chapterId, endingCount: branch.endingIds.length })]);
    return candidates;
  }
  function observeEvent(event) {
    const categories = { adverse: 'adverse', misfortune: 'adverse', fatal: 'adverse', beneficial: 'beneficial', beneficial_over_time: 'beneficial' };
    if (!plain(event) || !occurrenceId(event.occurrenceId) || !Object.prototype.hasOwnProperty.call(categories, event.category)) {
      return { ok: false, code: 'invalid_event', newlyUnlocked: [], storageError };
    }
    const family = event.family === undefined ? event.medalFamily : event.family;
    if (family != null && (typeof family !== 'string' || !/^[a-z_]{1,60}$/.test(family))) return { ok: false, code: 'invalid_event', newlyUnlocked: [], storageError };
    try { mergeFromDisk(); } catch (error) { storageError = error && error.message || 'storage_read_failed'; }
    if (seenEventIds.has(event.occurrenceId)) return applyCandidates([], 'duplicate_event');
    seenEventIds.add(event.occurrenceId); eventsDirty = true;
    if (categories[event.category] === 'beneficial') eventProgress.beneficialCount += 1;
    else eventProgress.leadershipAdverseStreak = ['leadership', 'faction'].includes(family) ? eventProgress.leadershipAdverseStreak + 1 : 0;
    const candidates = [];
    for (const [id, source] of [
      ['leadership_bad_5', { consecutiveEvents: eventProgress.leadershipAdverseStreak }],
      ['beneficial_5', { beneficialEvents: eventProgress.beneficialCount }],
    ]) {
      const evidence = evidenceFor(id, source);
      if (evidence) candidates.push([id, evidence]);
    }
    return applyCandidates(candidates, 'event_observed');
  }
  function observeMemorial(snapshot) {
    if (!plain(snapshot) || !count(snapshot.total)) return { ok: false, code: 'invalid_memorial', newlyUnlocked: [], storageError };
    try { mergeFromDisk(); } catch (error) { storageError = error && error.message || 'storage_read_failed'; }
    // The memorial owns death deduplication; reopening its screen is not a death.
    // Read its total only, never its potentially detailed records.
    const evidence = evidenceFor('death_5', { deathCount: snapshot.total });
    return applyCandidates(evidence ? [['death_5', evidence]] : [], 'memorial_observed');
  }
  function resetProgress() {
    try { mergeFromDisk(); } catch (error) { storageError = error && error.message || 'storage_read_failed'; }
    if (lastActionCount !== null || lastVideoDays !== null || Object.values(progress).some((value) => value !== 0)
      || balanceProgress.consecutiveDays !== 0 || balanceProgress.dayNumber !== null) {
      progress = emptyProgress(); balanceProgress = emptyBalance(); lastActionCount = null; lastVideoDays = null; progressDirty = true;
    }
    return applyCandidates([], 'progress_reset');
  }
  function restBreak() {
    try { mergeFromDisk(); } catch (error) { storageError = error && error.message || 'storage_read_failed'; }
    if (progress.noRestCount !== 0) { progress.noRestCount = 0; progressDirty = true; }
    return applyCandidates([], 'rest_break');
  }
  function equip(id) {
    if (id !== null && (typeof id !== 'string' || !IDS.includes(id))) return { ok: false, code: 'invalid_title', activeTitle, storageError };
    try { mergeFromDisk(); } catch (error) { storageError = error && error.message || 'storage_read_failed'; }
    if (id !== null && !records.has(id)) return { ok: false, code: 'title_locked', activeTitle, storageError };
    if (activeTitle !== id) { activeTitle = id; activeDirty = true; }
    const saved = retry();
    return { ok: true, code: 'equipped', activeTitle, persisted: saved.persisted, storageError, unsavedCount: unsavedCount() };
  }

  return { observeState, observeAction, observeVideoDay, observeEvent, observeMemorial, resetProgress, restBreak, getState, equip, retry };
}

module.exports = { createMedals, MEDAL_CATALOG, NPC_IDS, STORAGE_KEY };
