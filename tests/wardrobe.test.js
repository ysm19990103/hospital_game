'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWardrobe } = require('../src/wardrobe');
const KEY = 'baiyi.wardrobe.v1';
const CATALOG = [
  ['white_coat', '经典白大衣'], ['coat_scrubs', '白大衣配刷手服'],
  ['sky_blue', '天蓝刷手服'], ['forest_green', '墨绿刷手服'],
  ['navy', '藏蓝刷手服'], ['purple', '紫色刷手服'],
];
const CHAPTER_IDS = require('../data/chapters.json').map((chapter) => chapter.id);
function completedGame(ids = CHAPTER_IDS) {
  return { status: 'complete', chapterResults: Object.fromEntries(ids.map((id) => [String(id), { chapterId: id }])) };
}
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values, failure: null, writes: [],
    getItem(key) { return values.get(key); },
    setItem(key, value) {
      this.writes.push(key);
      if (this.failure === 'throw') throw new Error('storage unavailable');
      if (this.failure === 'false') return false;
      values.set(key, value); return true;
    },
  };
}

test('female avatar is locked without writes until all chapters complete, then both genders expose six outfits', () => {
  const storage = memoryStorage();
  const wardrobe = createWardrobe(storage);
  assert.deepEqual(wardrobe.getState().outfits.map(({ id, name }) => [id, name]), CATALOG);
  for (const { id, image } of wardrobe.getState().outfits) assert.equal(image, `assets/outfits/${id}.png`);
  assert.equal(wardrobe.getState().selectedId, 'white_coat');
  assert.equal(wardrobe.getState().gender, 'male');
  assert.equal(wardrobe.getState().femaleUnlocked, false);
  assert.equal(wardrobe.getSelected().id, 'white_coat');
  assert.equal(wardrobe.select('unknown_outfit').ok, false);
  assert.equal(wardrobe.getSelected().id, 'white_coat');
  const writesBefore = storage.writes.length;
  const locked = wardrobe.setGender('female');
  assert.equal(locked.ok, false);
  assert.equal(locked.code, 'locked');
  assert.equal(wardrobe.getState().gender, 'male');
  assert.equal(wardrobe.getState().selectedId, 'white_coat');
  assert.equal(storage.writes.length, writesBefore);
  assert.equal(wardrobe.observeCompletion(completedGame()).newlyUnlocked, true);
  for (const gender of ['male', 'female']) {
    assert.equal(wardrobe.setGender(gender).ok, true);
    assert.deepEqual(wardrobe.getState().outfits.map(({ id, name }) => [id, name]), CATALOG);
    for (const { id, image } of wardrobe.getState().outfits) {
      const expected = `assets/outfits/${gender === 'female' ? 'female/' : ''}${id}.png`;
      assert.equal(image, expected);
      assert.equal(wardrobe.select(id).ok, true);
      assert.equal(wardrobe.getSelected().image, expected);
    }
  }
  const before = wardrobe.getState();
  assert.equal(wardrobe.setGender('unknown').ok, false);
  assert.equal(wardrobe.setGender({ gender: 'male', privateField: 'PRIVATE_GENDER_FIELD' }).ok, false);
  assert.equal(wardrobe.getState().gender, before.gender);
  assert.equal(wardrobe.getState().selectedId, before.selectedId);
  assert.equal(String(storage.values.get(KEY)).includes('PRIVATE_GENDER_FIELD'), false);
});

test('gender and outfit persist independently, and an old version 1 choice migrates to male without losing its outfit', () => {
  const untouched = { 'baiyi-game-save-v1': 'game state', 'baiyi.survey.v1': 'research data' };
  const storage = memoryStorage(untouched);
  const wardrobe = createWardrobe(storage);
  const result = wardrobe.select('purple');
  assert.equal(result.ok, true);
  assert.equal(result.persisted, true);
  wardrobe.observeCompletion(completedGame());
  assert.equal(wardrobe.setGender('female').ok, true);
  assert.equal(wardrobe.getState().selectedId, 'purple');
  const reloaded = createWardrobe(storage);
  assert.equal(reloaded.getSelected().id, 'purple');
  assert.equal(reloaded.getState().gender, 'female');
  assert.equal(reloaded.getSelected().image, 'assets/outfits/female/purple.png');
  for (const [key, value] of Object.entries(untouched)) assert.equal(storage.values.get(key), value);
  assert.deepEqual([...new Set(storage.writes)], [KEY]);
  const saved = JSON.parse(storage.values.get(KEY));
  assert.equal(saved.selectedId, 'purple');
  assert.equal(saved.gender, 'female');
  assert.equal(saved.femaleUnlocked, true);
  assert.ok(Object.keys(saved).every((key) => ['version', 'selectedId', 'gender', 'femaleUnlocked'].includes(key)));
  const legacyStorage = memoryStorage({ [KEY]: '{"version":1,"selectedId":"navy"}' });
  const legacy = createWardrobe(legacyStorage);
  assert.equal(legacy.getState().gender, 'male');
  assert.equal(legacy.getState().selectedId, 'navy');
  assert.equal(legacy.getSelected().image, 'assets/outfits/navy.png');
  assert.equal(legacy.getState().femaleUnlocked, false);
  legacy.observeCompletion(completedGame());
  assert.equal(legacy.setGender('female').ok, true);
  assert.equal(createWardrobe(legacyStorage).getState().selectedId, 'navy');
  const oldFemale = createWardrobe(memoryStorage({ [KEY]: '{"version":1,"selectedId":"purple","gender":"female"}' }));
  assert.equal(oldFemale.getState().gender, 'male');
  assert.equal(oldFemale.getState().femaleUnlocked, false);
  assert.equal(oldFemale.getState().selectedId, 'purple');
  const unlockedFemale = createWardrobe(memoryStorage({ [KEY]: '{"version":1,"selectedId":"navy","gender":"female","femaleUnlocked":true}' }));
  assert.equal(unlockedFemale.getState().gender, 'female');
  assert.equal(unlockedFemale.getState().selectedId, 'navy');
});

test('storage refusal or exception retains session gender and outfit while reporting failure, then permits same-value retries', () => {
  for (const failure of ['false', 'throw']) {
    const storage = memoryStorage();
    const wardrobe = createWardrobe(storage);
    wardrobe.observeCompletion(completedGame());
    const before = storage.values.get(KEY);
    storage.failure = failure;
    const refused = wardrobe.select('forest_green');
    assert.equal(refused.ok, false);
    assert.equal(refused.persisted, false);
    assert.ok(refused.storageError);
    assert.equal(wardrobe.getState().selectedId, 'forest_green');
    const refusedGender = wardrobe.setGender('female');
    assert.equal(refusedGender.ok, false);
    assert.equal(refusedGender.persisted, false);
    assert.equal(refusedGender.gender, 'female');
    assert.ok(refusedGender.storageError);
    assert.equal(wardrobe.getSelected().image, 'assets/outfits/female/forest_green.png');
    assert.equal(storage.values.get(KEY), before);
    storage.failure = null;
    const genderRetry = wardrobe.setGender('female');
    assert.equal(genderRetry.ok, true);
    assert.equal(genderRetry.persisted, true);
    const retried = wardrobe.select('forest_green');
    assert.equal(retried.ok, true);
    assert.equal(retried.persisted, true);
    assert.equal(wardrobe.getState().storageError, null);
    assert.equal(createWardrobe(storage).getSelected().id, 'forest_green');
    assert.equal(createWardrobe(storage).getState().gender, 'female');
  }
});

test('damaged saved choices are reported and preserved without overwriting the original record', () => {
  for (const original of ['broken wardrobe JSON', '{"version":999,"selectedId":"navy"}']) {
    const storage = memoryStorage({ [KEY]: original });
    const wardrobe = createWardrobe(storage);
    assert.ok(wardrobe.getState().storageError);
    const result = wardrobe.select('sky_blue');
    assert.equal(result.ok, false);
    assert.equal(result.persisted, false);
    assert.ok(result.storageError);
    assert.equal(wardrobe.setGender('female').ok, false);
    assert.equal(storage.values.get(KEY), original);
    assert.equal(storage.writes.length, 0);
  }
});

test('opening the final chapter, incomplete results, video fields, forged keys and invalid expected lists cannot unlock female avatar', () => {
  const lastId = CHAPTER_IDS[CHAPTER_IDS.length - 1], firstId = CHAPTER_IDS[0];
  const incomplete = CHAPTER_IDS.slice(0, -1);
  const wrongRecord = completedGame(); wrongRecord.chapterResults[String(lastId)] = { chapterId: firstId };
  const nonObjectRecord = completedGame(); nonObjectRecord.chapterResults[String(lastId)] = 'completed';
  const cases = [
    [{ status: 'playing', chapterId: lastId, chapterResults: {} }],
    [completedGame(incomplete)],
    [{ status: 'complete', chapterResults: {}, videosWatched: CHAPTER_IDS, videoWatchMinutes: 9999 }],
    [completedGame([...incomplete, 9999])],
    [wrongRecord], [nonObjectRecord],
    [completedGame(), [lastId]],
    [completedGame(), incomplete],
    [completedGame(), [...incomplete, firstId]],
  ];
  for (const [game, expected] of cases) {
    const storage = memoryStorage();
    const wardrobe = createWardrobe(storage);
    const result = expected === undefined ? wardrobe.observeCompletion(game) : wardrobe.observeCompletion(game, expected);
    assert.equal(result.newlyUnlocked, false);
    assert.equal(wardrobe.getState().femaleUnlocked, false);
    assert.equal(storage.writes.length, 0);
  }
});

test('all current main chapters unlock once regardless of expected order/string form and remain unlocked across new games', () => {
  const storage = memoryStorage();
  const wardrobe = createWardrobe(storage);
  const full = completedGame();
  delete full.chapterResults[String(CHAPTER_IDS[CHAPTER_IDS.length - 1])].chapterId; // The real chapter key is sufficient; this field is optional.
  const result = wardrobe.observeCompletion(full, [...CHAPTER_IDS].reverse().map(String));
  assert.equal(result.ok, true);
  assert.equal(result.newlyUnlocked, true);
  assert.equal(result.femaleUnlocked, true);
  assert.equal(result.persisted, true);
  assert.equal(wardrobe.observeCompletion(full).newlyUnlocked, false);
  wardrobe.setGender('female');
  wardrobe.observeCompletion({ status: 'playing', chapterResults: {} });
  assert.equal(wardrobe.getState().femaleUnlocked, true);
  const reloaded = createWardrobe(storage);
  assert.equal(reloaded.getState().femaleUnlocked, true);
  assert.equal(reloaded.getState().gender, 'female');
  assert.equal(reloaded.observeCompletion(full).newlyUnlocked, false);
});

test('expanded story requires new chapters for a fresh unlock while an earned legacy unlock remains permanent', () => {
  const oldChapterIds = Array.from({ length: 29 }, (_, index) => index + 1);
  assert.ok(CHAPTER_IDS.some((id) => !oldChapterIds.includes(id)), 'Build the expanded chapter catalogue before running this regression.');
  const oldCompleted = completedGame(oldChapterIds);
  const freshStorage = memoryStorage();
  const fresh = createWardrobe(freshStorage);
  assert.equal(fresh.observeCompletion(oldCompleted).newlyUnlocked, false);
  assert.equal(fresh.getState().femaleUnlocked, false);
  assert.equal(fresh.observeCompletion(oldCompleted, oldChapterIds).code, 'invalid_chapters');
  assert.equal(freshStorage.writes.length, 0);
  assert.equal(fresh.observeCompletion(completedGame()).newlyUnlocked, true);

  const oldStorage = memoryStorage({ [KEY]: JSON.stringify({ version: 1, selectedId: 'navy', gender: 'female', femaleUnlocked: true }) });
  const earned = createWardrobe(oldStorage);
  assert.equal(earned.observeCompletion(oldCompleted).unlocked, true);
  assert.equal(earned.getState().gender, 'female');
  assert.equal(earned.select('purple').ok, true);
  const reloaded = createWardrobe(oldStorage);
  assert.equal(reloaded.getState().femaleUnlocked, true);
  assert.equal(reloaded.getState().gender, 'female');
  assert.equal(reloaded.getState().selectedId, 'purple');
});

test('unlock write failure retains session eligibility and repeated completion retries without announcing a second unlock', () => {
  const storage = memoryStorage();
  const wardrobe = createWardrobe(storage);
  storage.failure = 'false';
  const first = wardrobe.observeCompletion(completedGame());
  assert.equal(first.ok, false);
  assert.equal(first.persisted, false);
  assert.equal(first.newlyUnlocked, true);
  assert.ok(first.storageError);
  assert.equal(wardrobe.getState().femaleUnlocked, true);
  assert.equal(storage.values.has(KEY), false);
  storage.failure = null;
  const retried = wardrobe.observeCompletion(completedGame());
  assert.equal(retried.ok, true);
  assert.equal(retried.persisted, true);
  assert.equal(retried.newlyUnlocked, false);
  assert.equal(createWardrobe(storage).getState().femaleUnlocked, true);
});
