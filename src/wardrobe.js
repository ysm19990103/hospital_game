'use strict';

// Local display preference only: no game state, resource, RNG or research access.
const STORAGE_KEY = 'baiyi.wardrobe.v1';
const GENDERS = Object.freeze(['male', 'female']);
// New unlocks follow the current main-story catalogue. Previously earned
// eligibility remains permanent in the independent wardrobe save.
const CHAPTER_IDS = Object.freeze(require('../data/chapters.json').map((chapter) => chapter.id));
const OUTFITS = Object.freeze([
  ['white_coat', '经典白大衣'],
  ['coat_scrubs', '白大衣配刷手服'],
  ['sky_blue', '天蓝刷手服'],
  ['forest_green', '墨绿刷手服'],
  ['navy', '藏蓝刷手服'],
  ['purple', '紫色刷手服'],
].map(([id, name]) => Object.freeze({ id, name, image: `assets/outfits/${id}.png` })));

function createWardrobe(storage) {
  let selectedId = 'white_coat';
  let gender = 'male';
  let femaleUnlocked = false;
  let unlockDirty = false;
  let storageError = null;
  const known = (id) => typeof id === 'string' && OUTFITS.some((outfit) => outfit.id === id);

  function readDisk() {
    if (!storage || typeof storage.getItem !== 'function') throw new Error('storage_unavailable');
    let raw;
    try { raw = storage.getItem(STORAGE_KEY); } catch (_) { throw new Error('storage_read_failed'); }
    if (raw == null || raw === '') return null;
    let data;
    try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { throw new Error('storage_corrupt'); }
    if (!data || data.version !== 1 || !known(data.selectedId)
      || (data.gender !== undefined && !GENDERS.includes(data.gender))
      || (data.femaleUnlocked !== undefined && typeof data.femaleUnlocked !== 'boolean')) throw new Error('storage_corrupt');
    // A prior female selection is not evidence of completing the story. Old
    // saves keep the outfit but use male artwork unless eligibility was earned.
    const unlocked = data.femaleUnlocked === true;
    return { selectedId: data.selectedId, gender: data.gender === 'female' && unlocked ? 'female' : 'male', femaleUnlocked: unlocked };
  }
  try {
    const saved = readDisk();
    if (saved) { selectedId = saved.selectedId; gender = saved.gender; femaleUnlocked = saved.femaleUnlocked; }
  } catch (error) { storageError = error.message; }

  function appearance(outfit) {
    return { id: outfit.id, name: outfit.name, image: `assets/outfits/${gender === 'female' ? 'female/' : ''}${outfit.id}.png` };
  }
  function getState() { return { outfits: OUTFITS.map(appearance), selectedId, gender, femaleUnlocked, storageError }; }
  function getSelected() { return appearance(OUTFITS.find((outfit) => outfit.id === selectedId)); }
  function persist(code) {
    try {
      // Preserve unreadable existing data. Retrying after storage recovers will
      // save the current in-memory choice, including when the ID is unchanged.
      const saved = readDisk();
      // A later wardrobe instance must never replace a previously earned unlock.
      femaleUnlocked = femaleUnlocked || !!(saved && saved.femaleUnlocked);
      if (!storage || typeof storage.setItem !== 'function') throw new Error('storage_unavailable');
      let accepted;
      try { accepted = storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, selectedId, gender, femaleUnlocked })); }
      catch (_) { throw new Error('storage_write_failed'); }
      if (accepted === false || (accepted && typeof accepted.then === 'function')) throw new Error('storage_write_failed');
      storageError = null; unlockDirty = false;
      return { ok: true, persisted: true, code, selectedId, gender, femaleUnlocked, storageError: null };
    } catch (error) {
      storageError = error.message || 'storage_write_failed';
      return { ok: false, persisted: false, code: 'not_saved', selectedId, gender, femaleUnlocked, storageError };
    }
  }
  function select(id) {
    if (!known(id)) return { ok: false, persisted: false, code: 'invalid_outfit', selectedId, gender, storageError };
    selectedId = id;
    return persist('selected');
  }
  function setGender(value) {
    if (!GENDERS.includes(value)) return { ok: false, persisted: false, code: 'invalid_gender', selectedId, gender, storageError };
    if (value === 'female' && !femaleUnlocked) return { ok: false, persisted: false, code: 'locked', selectedId, gender, femaleUnlocked, storageError };
    gender = value;
    return persist('gender_selected');
  }
  function observeCompletion(state, expectedChapterIds = CHAPTER_IDS) {
    const response = (ok, code) => ({ ok, code, newlyUnlocked: false, unlocked: femaleUnlocked, femaleUnlocked,
      persisted: !unlockDirty && storageError === null, storageError });
    if (!Array.isArray(expectedChapterIds) || expectedChapterIds.length !== CHAPTER_IDS.length
      || expectedChapterIds.some((id) => typeof id !== 'number' && typeof id !== 'string')
      || new Set(expectedChapterIds.map(String)).size !== CHAPTER_IDS.length
      || CHAPTER_IDS.some((id) => !expectedChapterIds.some((expected) => (typeof expected === 'number' || typeof expected === 'string') && String(expected) === String(id)))) {
      return response(false, 'invalid_chapters');
    }
    if (!state || typeof state !== 'object' || Array.isArray(state)) return response(false, 'invalid_game_state');
    const results = state.chapterResults;
    const complete = state.status === 'complete' && results && typeof results === 'object' && !Array.isArray(results)
      && CHAPTER_IDS.every((id) => {
        if (!Object.prototype.hasOwnProperty.call(results, String(id))) return false;
        const record = results[String(id)];
        return record && typeof record === 'object' && !Array.isArray(record)
          && (record.chapterId === undefined || ((typeof record.chapterId === 'string' || typeof record.chapterId === 'number') && String(record.chapterId) === String(id)));
      });
    const newlyUnlocked = !femaleUnlocked && !!complete;
    if (newlyUnlocked) { femaleUnlocked = true; unlockDirty = true; }
    if (unlockDirty) {
      const saved = persist('female_unlocked');
      return { ...saved, newlyUnlocked, unlocked: femaleUnlocked };
    }
    return response(true, femaleUnlocked ? 'already_unlocked' : 'incomplete_story');
  }

  return { getState, getSelected, select, setGender, observeCompletion };
}

module.exports = { createWardrobe, OUTFITS, GENDERS, CHAPTER_IDS, STORAGE_KEY };
