'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMedals } = require('../src/medals');

const KEY = 'baiyi.medals.v1';
const FIXED_TIME = Date.parse('2026-10-20T12:34:56.000Z');
const OPTIONS = { clock: () => FIXED_TIME };
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  const calls = { reads: [], writes: [] };
  return {
    values, calls, failure: null,
    getItem(key) { calls.reads.push(key); return values.get(key); },
    setItem(key, value) {
      calls.writes.push(key);
      if (this.failure === 'throw') throw new Error('storage unavailable');
      if (this.failure === 'false') return false;
      values.set(key, value); return true;
    },
  };
}
function assessment(score = 3, total = 3, month = 1) {
  return { month, score, total, status: 'completed', index: total, completedDay: month * 28, questionIds: ['q1', 'q2', 'q3'], answers: [] };
}
function state(extra = {}) { return { money: 1, completedAssessments: [], ...extra }; }
function medal(archive, id) { return archive.getState().medals.find((item) => item.id === id); }
function ids(items) { return items.map((item) => item.id).sort(); }
function deepFreeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}

test('video chapters earn the story medal once, retain legacy progress and do not advance action streaks', () => {
  const storage = memoryStorage();
  const archive = createMedals(storage, OPTIONS);
  archive.observeAction('puzzle', state({ actionCount: 1 }), { chapterId: 1, puzzleSolved: true });
  const before = archive.getState().progress;
  archive.observeState(state({ completedVideos: [1, '1', 2, 3, 4, 0, 30, 'missing'] }));
  assert.equal(medal(archive, 'puzzles_5').unlocked, false);
  const result = archive.observeState(state({ completedVideos: [1, 2, 3, 4, 5] }));
  assert.deepEqual(ids(result.newlyUnlocked), ['puzzles_5']);
  assert.deepEqual(archive.getState().progress, before);
  const restored = createMedals(storage, OPTIONS);
  assert.deepEqual(restored.observeState(state({ completedVideos: [5, 4, 3, 2, 1] })).newlyUnlocked, []);
  assert.equal(medal(restored, 'puzzles_5').unlocked, true);
});

test('first video days count no-rest time once across reload and never become work or research actions', () => {
  const storage=memoryStorage(),archive=createMedals(storage,OPTIONS);
  for(let actionCount=1;actionCount<=3;actionCount++)archive.observeAction('work',state({actionCount}));
  assert.equal(archive.getState().progress.workStreak,3);
  archive.observeVideoDay(state({actionCount:3,videoDays:1}),5);
  assert.deepEqual(archive.getState().progress,{workStreak:0,researchStreak:0,noRestCount:8});
  const reloaded=createMedals(storage,OPTIONS);
  assert.equal(reloaded.observeVideoDay(state({actionCount:3,videoDays:1}),5).code,'duplicate_video_day');
  assert.equal(reloaded.getState().progress.noRestCount,8);
  reloaded.observeAction('research',state({actionCount:4,videoDays:1}));
  reloaded.observeVideoDay(state({actionCount:4,videoDays:2}),5);
  assert.deepEqual(reloaded.getState().progress,{workStreak:0,researchStreak:0,noRestCount:14});
  assert.equal(medal(reloaded,'no_rest_10').unlocked,false);
  for(let videoDays=3;videoDays<=6;videoDays++)reloaded.observeVideoDay(state({actionCount:4,videoDays}),5);
  assert.equal(reloaded.getState().progress.noRestCount,34);
  assert.equal(medal(reloaded,'no_rest_10').unlocked,false);
  const result=reloaded.observeAction('work',state({actionCount:5,videoDays:6}));
  assert.deepEqual(ids(result.newlyUnlocked),['no_rest_10']);
  assert.equal(medal(reloaded,'work_streak_4').unlocked,false);
  assert.equal(medal(reloaded,'research_streak_4').unlocked,false);
  reloaded.resetProgress();
  reloaded.observeVideoDay(state({actionCount:0,videoDays:1}),5);
  assert.equal(reloaded.getState().progress.noRestCount,5);
  assert.equal(medal(reloaded,'no_rest_10').unlocked,true);
});

test('video time interrupts balanced days and the next full work-rest day uses the shifted calendar', () => {
  const archive=createMedals(memoryStorage(),OPTIONS);
  let actionCount=0;
  const day=videoDays=>['work','rest','inspect','research','npc'].forEach(type=>archive.observeAction(type,state({actionCount:++actionCount,videoDays})));
  day(0);day(0);
  assert.equal(archive.getState().balanceProgress.consecutiveDays,2);
  archive.observeVideoDay(state({actionCount,videoDays:1}),5);
  assert.equal(archive.getState().balanceProgress.consecutiveDays,0);
  for(let i=0;i<6;i++)day(1);
  assert.equal(archive.getState().balanceProgress.consecutiveDays,6);
  assert.equal(archive.getState().balanceProgress.dayNumber,9);
  assert.equal(medal(archive,'balanced_week').unlocked,false);
  day(1);
  assert.equal(medal(archive,'balanced_week').unlocked,true);
});

test('video-day pending writes and invalid observations cannot duplicate no-rest time', () => {
  const storage=memoryStorage(),archive=createMedals(storage,OPTIONS);
  storage.failure='false';
  const first=archive.observeVideoDay(state({actionCount:0,videoDays:1}),5);
  assert.equal(first.persisted,false);
  assert.equal(archive.getState().progress.noRestCount,5);
  archive.observeVideoDay(state({actionCount:0,videoDays:1}),5);
  assert.equal(archive.getState().progress.noRestCount,5);
  assert.equal(archive.observeVideoDay(state({videoDays:2}),10).ok,false);
  storage.failure=null;archive.retry();
  const reloaded=createMedals(storage,OPTIONS);
  reloaded.observeVideoDay(state({actionCount:0,videoDays:1}),5);
  assert.equal(reloaded.getState().progress.noRestCount,5);
});

test('medals use one independent key and leave game, leaderboard and research records untouched', () => {
  const untouched = {
    'baiyi-game-save-v1': '{"checkpoint":"unchanged"}',
    'baiyi.leaderboard.v1': '{"score":"unchanged"}',
    'baiyi.survey.v1': '{"research":"unchanged"}',
  };
  const storage = memoryStorage(untouched);
  const archive = createMedals(storage, OPTIONS);
  assert.equal(archive.observeState(state({ money: 200 })).ok, true);
  assert.ok(storage.values.has(KEY));
  for (const [key, value] of Object.entries(untouched)) assert.equal(storage.values.get(key), value);
  assert.deepEqual([...new Set(storage.calls.reads)], [KEY]);
  assert.deepEqual([...new Set(storage.calls.writes)], [KEY]);
});

test('小试牛刀 requires a positive completed full score, not an empty or unfinished assessment', () => {
  const archive = createMedals(memoryStorage(), OPTIONS);
  archive.observeState(state({ completedAssessments: [assessment(0, 0), assessment(2, 3)] }));
  assert.equal(medal(archive, 'first_full_marks').unlocked, false);
  archive.observeState(state({ monthlyAssessment: { ...assessment(), status: 'active' } }));
  assert.equal(medal(archive, 'first_full_marks').unlocked, false);
  const result = archive.observeState(state({ completedAssessments: [assessment(2, 3), assessment(3, 3, 2)] }));
  assert.deepEqual(ids(result.newlyUnlocked), ['first_full_marks']);
  const unlocked = medal(archive, 'first_full_marks');
  assert.equal(unlocked.name, '小试牛刀');
  assert.equal(unlocked.unlocked, true);
  assert.equal(new Date(unlocked.unlockedAt).getTime(), FIXED_TIME);
  assert.equal(unlocked.evidence.score, 3);
  assert.equal(unlocked.evidence.total, 3);
});

test('财源滚滚 unlocks exactly at 200 current coins and also accepts a larger balance', () => {
  const archive = createMedals(memoryStorage(), OPTIONS);
  archive.observeState(state({ money: 199 }));
  assert.equal(medal(archive, 'wealth_200').unlocked, false);
  assert.deepEqual(ids(archive.observeState(state({ money: 200 })).newlyUnlocked), ['wealth_200']);
  assert.equal(medal(archive, 'wealth_200').name, '财源滚滚');
  assert.equal(medal(archive, 'wealth_200').evidence.money, 200);
  const larger = createMedals(memoryStorage(), OPTIONS);
  larger.observeState(state({ money: 201 }));
  assert.equal(medal(larger, 'wealth_200').unlocked, true);
});

test('沿街乞讨 unlocks only when the observed balance is zero, not the starting 50 coins', () => {
  const archive = createMedals(memoryStorage(), OPTIONS);
  archive.observeState(state({ money: 50 }));
  assert.equal(medal(archive, 'zero_coins').unlocked, false);
  const initialZero = createMedals(memoryStorage(), OPTIONS);
  const result = initialZero.observeState(state({ money: 0 }));
  assert.deepEqual(ids(result.newlyUnlocked), ['zero_coins']);
  assert.equal(medal(initialZero, 'zero_coins').name, '沿街乞讨');
  assert.equal(initialZero.getState().activeTitle, null);
});

test('repeated observations never reannounce unlocks or replace their first evidence/time', () => {
  let clock = FIXED_TIME;
  const archive = createMedals(memoryStorage(), { clock: () => clock });
  archive.observeState(state({ money: 200, completedAssessments: [assessment()] }));
  const first = archive.getState();
  clock += 100000;
  for (let index = 0; index < 3; index += 1) {
    const result = archive.observeState(state({ money: 500, completedAssessments: [assessment(), assessment(3, 3, 2)] }));
    assert.deepEqual(result.newlyUnlocked, []);
  }
  assert.deepEqual(archive.getState().medals, first.medals);
});

test('titles are opt-in, locked or unknown titles are rejected, and null unequips', () => {
  const archive = createMedals(memoryStorage(), OPTIONS);
  assert.equal(archive.equip('wealth_200').ok, false);
  assert.equal(archive.equip('unknown_title').ok, false);
  assert.equal(archive.getState().activeTitle, null);
  archive.observeState(state({ money: 200 }));
  assert.equal(archive.getState().activeTitle, null);
  assert.equal(archive.equip('wealth_200').ok, true);
  assert.equal(archive.getState().activeTitle, 'wealth_200');
  assert.equal(archive.equip('first_full_marks').ok, false);
  assert.equal(archive.getState().activeTitle, 'wealth_200');
  assert.equal(archive.equip(null).ok, true);
  assert.equal(archive.getState().activeTitle, null);
});

test('reload, new-game state and restored lower resources preserve unlocked medals and title', () => {
  const storage = memoryStorage();
  const archive = createMedals(storage, OPTIONS);
  archive.observeState(state({ money: 200, completedAssessments: [assessment()] }));
  archive.equip('wealth_200');
  archive.observeState(state({ money: 0 }));
  const reloaded = createMedals(storage, { clock: () => FIXED_TIME + 99999 });
  assert.deepEqual(ids(reloaded.getState().medals.filter((item) => item.unlocked)), ['first_full_marks', 'wealth_200', 'zero_coins']);
  assert.equal(reloaded.getState().activeTitle, 'wealth_200');
  assert.deepEqual(reloaded.observeState(state({ money: 0, completedAssessments: [] })).newlyUnlocked, []);
  reloaded.observeState(state({ money: 50, completedAssessments: [] }));
  assert.deepEqual(ids(reloaded.getState().medals.filter((item) => item.unlocked)), ['first_full_marks', 'wealth_200', 'zero_coins']);
  assert.equal(reloaded.getState().activeTitle, 'wealth_200');
});

test('only minimal medal evidence is persisted; unrelated game and research values are excluded', () => {
  const storage = memoryStorage();
  const archive = createMedals(storage, OPTIONS);
  const secret = 'SHOULD_NOT_BE_PERSISTED';
  archive.observeState(state({
    money: 200, _rng: secret, name: secret, phone: secret, participantId: secret,
    researchAnswers: { privateAnswer: secret },
    completedAssessments: [{ ...assessment(), extra: secret, answers: [{ freeText: secret }] }],
  }));
  archive.observeState(state({ money: 0 }));
  const raw = String(storage.values.get(KEY));
  assert.equal(raw.includes(secret), false);
  assert.equal(raw.includes('researchAnswers'), false);
  for (const item of archive.getState().medals.filter((entry) => entry.unlocked)) {
    const allowed = item.id === 'first_full_marks' ? ['score', 'total', 'month', 'completedDay'] : ['money'];
    assert.ok(Object.keys(item.evidence).every((key) => allowed.includes(key)));
  }
});

test('observing and equipping never modify the caller game state or RNG', () => {
  const input = deepFreeze(state({ money: 200, hp: 27, energy: 4, _rng: 123456, flags: { arbitrary: true }, completedAssessments: [assessment()] }));
  const before = JSON.stringify(input);
  const archive = createMedals(memoryStorage(), OPTIONS);
  assert.doesNotThrow(() => archive.observeState(input));
  archive.equip('wealth_200');
  assert.equal(JSON.stringify(input), before);
  const publicState = archive.getState();
  const unlocked = publicState.medals.find((item) => item.id === 'wealth_200');
  unlocked.evidence.money = 99999;
  unlocked.unlocked = false;
  assert.equal(medal(archive, 'wealth_200').evidence.money, 200);
  assert.equal(medal(archive, 'wealth_200').unlocked, true);
});

test('getState is a passive view and performs no repeated storage I/O', () => {
  const storage = memoryStorage();
  const archive = createMedals(storage, OPTIONS);
  archive.observeState(state({ money: 0 }));
  const before = { reads: storage.calls.reads.length, writes: storage.calls.writes.length };
  for (let index = 0; index < 50; index += 1) archive.getState();
  assert.equal(storage.calls.reads.length, before.reads);
  assert.equal(storage.calls.writes.length, before.writes);
});

for (const failure of ['false', 'throw']) {
  test(`a ${failure} storage failure retains unlock and title in memory until explicit retry`, () => {
    const storage = memoryStorage();
    const archive = createMedals(storage, OPTIONS);
    storage.failure = failure;
    const result = archive.observeState(state({ money: 200 }));
    assert.equal(result.ok, true);
    assert.equal(result.persisted, false);
    assert.ok(result.storageError);
    assert.equal(medal(archive, 'wealth_200').unlocked, true);
    assert.ok(archive.getState().unsavedCount >= 1);
    assert.equal(archive.equip('wealth_200').ok, true);
    assert.equal(archive.getState().activeTitle, 'wealth_200');
    assert.ok(archive.getState().unsavedCount >= 2);
    storage.failure = null;
    assert.equal(archive.retry().ok, true);
    assert.equal(archive.getState().unsavedCount, 0);
    assert.equal(archive.getState().storageError, null);
    const reloaded = createMedals(storage, OPTIONS);
    assert.equal(medal(reloaded, 'wealth_200').unlocked, true);
    assert.equal(reloaded.getState().activeTitle, 'wealth_200');
    assert.deepEqual(reloaded.observeState(state({ money: 200 })).newlyUnlocked, []);
  });
}

test('malformed or incompatible medal storage is preserved instead of overwritten', () => {
  for (const original of ['broken JSON record', '{"version":999,"private":"existing record"}']) {
    const storage = memoryStorage({ [KEY]: original });
    const archive = createMedals(storage, OPTIONS);
    assert.ok(archive.getState().storageError);
    archive.observeState(state({ money: 200 }));
    assert.equal(medal(archive, 'wealth_200').unlocked, true);
    assert.ok(archive.getState().unsavedCount >= 1);
    assert.equal(archive.retry().ok, false);
    assert.equal(storage.values.get(KEY), original);
    assert.equal(storage.calls.writes.length, 0);
  }
});

function actionObserver(archive, startingCount = 0) {
  let actionCount = startingCount;
  return (type, extra = {}, context = {}) => {
    actionCount += 1;
    return archive.observeAction(type, state({ actionCount, ...extra }), context);
  };
}

test('勤奋过人 requires four consecutive effective work actions and counts a fatal fourth action', () => {
  const archive = createMedals(memoryStorage(), OPTIONS);
  const act = actionObserver(archive);
  for (let index = 0; index < 3; index += 1) act('work');
  assert.equal(medal(archive, 'work_streak_4').unlocked, false);
  assert.equal(archive.getState().progress.workStreak, 3);
  const result = act('work', { status: 'failure' });
  assert.deepEqual(ids(result.newlyUnlocked), ['work_streak_4']);
  assert.equal(medal(archive, 'work_streak_4').name, '勤奋过人');
  assert.equal(archive.getState().activeTitle, null);
  assert.deepEqual(act('work').newlyUnlocked, []);
});

test('other effective actions break work and research streaks, and four new research actions unlock 科研达人', () => {
  const archive = createMedals(memoryStorage(), OPTIONS);
  const act = actionObserver(archive);
  act('work'); act('work'); act('work');
  act('research');
  assert.equal(archive.getState().progress.workStreak, 0);
  assert.equal(archive.getState().progress.researchStreak, 1);
  act('research'); act('research'); act('inspect');
  assert.equal(archive.getState().progress.researchStreak, 0);
  assert.equal(medal(archive, 'research_streak_4').unlocked, false);
  act('research'); act('research'); act('research');
  const result = act('research');
  assert.ok(result.newlyUnlocked.some((item) => item.id === 'research_streak_4'));
  assert.equal(medal(archive, 'research_streak_4').name, '科研达人');
  assert.equal(medal(archive, 'work_streak_4').unlocked, false);
});

test('通宵达旦 unlocks after seven full days without rest or entertainment', () => {
  const archive = createMedals(memoryStorage(), OPTIONS);
  const act = actionObserver(archive);
  for (let index = 0; index < 34; index += 1) act(index % 2 ? 'research' : 'work');
  assert.equal(medal(archive, 'no_rest_10').unlocked, false);
  assert.equal(archive.getState().progress.noRestCount, 34);
  const result = act('research', { status: 'failure' });
  assert.deepEqual(ids(result.newlyUnlocked), ['no_rest_10']);
  assert.equal(medal(archive, 'no_rest_10').name, '通宵达旦');
  assert.equal(medal(archive, 'no_rest_10').evidence.consecutiveActions, 35);
});

test('previous two-day no-rest unlocks survive the seven-day requirement change', () => {
  const saved={version:1,activeTitle:'no_rest_10',records:[{id:'no_rest_10',unlockedAt:new Date(FIXED_TIME).toISOString(),evidence:{consecutiveActions:10}}]};
  const archive=createMedals(memoryStorage({[KEY]:JSON.stringify(saved)}),OPTIONS);
  assert.equal(archive.getState().storageError,null);
  assert.equal(medal(archive,'no_rest_10').unlocked,true);
  assert.equal(archive.getState().activeTitle,'no_rest_10');
  assert.equal(medal(archive,'no_rest_10').evidence.consecutiveActions,10);
});

test('both rest and entertainment reset continuous no-rest progress', () => {
  for (const breakType of ['rest', 'entertain']) {
    const archive = createMedals(memoryStorage(), OPTIONS);
    const act = actionObserver(archive);
    for (let index = 0; index < 34; index += 1) act('work');
    act(breakType);
    assert.deepEqual(archive.getState().progress, { workStreak: 0, researchStreak: 0, noRestCount: 0 });
    assert.equal(medal(archive, 'no_rest_10').unlocked, false);
    act('research');
    assert.equal(archive.getState().progress.noRestCount, 1);
    assert.equal(medal(archive, 'work_streak_4').unlocked, true);
  }
});

test('observeState, duplicate action notifications and invalid types cannot advance streaks', () => {
  const archive = createMedals(memoryStorage(), OPTIONS);
  const first = state({ actionCount: 1 });
  archive.observeAction('work', first);
  const before = archive.getState().progress;
  for (let index = 0; index < 4; index += 1) archive.observeState(state({ actionCount: 99 }));
  const duplicate = archive.observeAction('work', first);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.code, 'duplicate_action');
  assert.deepEqual(duplicate.newlyUnlocked, []);
  assert.equal(archive.observeAction('unknown', state({ actionCount: 2 })).ok, false);
  assert.equal(archive.observeAction('work', state({ actionCount: 0 })).ok, false);
  assert.deepEqual(archive.getState().progress, before);
});

test('resume retains streak and duplicate sequence while resetProgress starts fresh without removing medals', () => {
  const storage = memoryStorage();
  const archive = createMedals(storage, OPTIONS);
  const act = actionObserver(archive);
  act('work'); act('work'); act('work');
  const resumed = createMedals(storage, OPTIONS);
  assert.equal(resumed.getState().progress.workStreak, 3);
  assert.equal(resumed.observeAction('work', state({ actionCount: 3 })).code, 'duplicate_action');
  const fourth = resumed.observeAction('work', state({ actionCount: 4 }));
  assert.deepEqual(ids(fourth.newlyUnlocked), ['work_streak_4']);
  resumed.equip('work_streak_4');
  resumed.resetProgress();
  assert.deepEqual(resumed.getState().progress, { workStreak: 0, researchStreak: 0, noRestCount: 0 });
  assert.equal(medal(resumed, 'work_streak_4').unlocked, true);
  assert.equal(resumed.getState().activeTitle, 'work_streak_4');
  resumed.observeAction('work', state({ actionCount: 1 }));
  assert.equal(resumed.getState().progress.workStreak, 1);
  const reloaded = createMedals(storage, OPTIONS);
  assert.equal(reloaded.getState().progress.workStreak, 1);
  assert.equal(reloaded.getState().activeTitle, 'work_streak_4');
});

test('restBreak clears only no-rest progress and does not consume an action or interrupt work streak', () => {
  const archive = createMedals(memoryStorage(), OPTIONS);
  const act = actionObserver(archive);
  act('work'); act('work'); act('work');
  archive.restBreak();
  assert.deepEqual(archive.getState().progress, { workStreak: 3, researchStreak: 0, noRestCount: 0 });
  assert.deepEqual(ids(act('work').newlyUnlocked), ['work_streak_4']);
  assert.equal(archive.getState().progress.noRestCount, 1);
});

test('action observations keep only whitelisted streak evidence and never mutate caller state', () => {
  const storage = memoryStorage();
  const archive = createMedals(storage, OPTIONS);
  const privateValue = 'PRIVATE_ACTION_PAYLOAD';
  const input = deepFreeze(state({ actionCount: 1, _rng: 1234, hp: 10, privateNote: privateValue }));
  const before = JSON.stringify(input);
  assert.doesNotThrow(() => archive.observeAction('work', input));
  assert.equal(JSON.stringify(input), before);
  const act = actionObserver(archive, 1);
  act('work'); act('work'); act('work');
  act('research'); act('research'); act('research'); act('research');
  for(let index=0;index<27;index++)act('inspect');
  const unlocked = archive.getState().medals.filter((item) => ['work_streak_4', 'research_streak_4', 'no_rest_10'].includes(item.id));
  assert.equal(unlocked.every((item) => item.unlocked), true);
  for (const item of unlocked) {
    assert.ok(Object.keys(item.evidence).every((key) => ['actionType', 'consecutiveActions'].includes(key)));
    assert.equal(item.evidence.consecutiveActions, item.id === 'no_rest_10' ? 35 : 4);
  }
  assert.equal(String(storage.values.get(KEY)).includes(privateValue), false);
});

test('死亡牛马 unlocks at five global memorial deaths and ignores repeated views of the same archive', () => {
  const archive = createMedals(memoryStorage(), OPTIONS);
  archive.observeMemorial({ total: 4, records: [] });
  assert.equal(medal(archive, 'death_5').unlocked, false);
  const snapshot = { total: 5, records: [] };
  const result = archive.observeMemorial(snapshot);
  assert.deepEqual(ids(result.newlyUnlocked), ['death_5']);
  assert.equal(medal(archive, 'death_5').name, '死亡牛马');
  assert.deepEqual(medal(archive, 'death_5').evidence, { deathCount: 5 });
  for (let index = 0; index < 5; index += 1) assert.deepEqual(archive.observeMemorial(snapshot).newlyUnlocked, []);
  assert.deepEqual(archive.observeMemorial({ total: 6, records: [] }).newlyUnlocked, []);
  assert.deepEqual(medal(archive, 'death_5').evidence, { deathCount: 5 });
});

test('death medal and equipped title survive reload and new-game progress reset', () => {
  const storage = memoryStorage();
  const archive = createMedals(storage, OPTIONS);
  archive.observeMemorial({ total: 5, records: [] });
  archive.equip('death_5');
  const reloaded = createMedals(storage, OPTIONS);
  reloaded.resetProgress();
  reloaded.observeState(state({ money: 50, completedAssessments: [] }));
  reloaded.observeMemorial({ total: 0, records: [] });
  assert.equal(medal(reloaded, 'death_5').unlocked, true);
  assert.equal(reloaded.getState().activeTitle, 'death_5');
});

test('memorial observer only reads a safe total and never inspects or persists personal death records', () => {
  const storage = memoryStorage();
  const archive = createMedals(storage, OPTIONS);
  for (const total of [4.9, '5', NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1]) {
    archive.observeMemorial({ total, records: [] });
    assert.equal(medal(archive, 'death_5').unlocked, false);
  }
  const snapshot = { total: 5 };
  Object.defineProperty(snapshot, 'records', { enumerable: true, get() { throw new Error('records must not be read'); } });
  assert.doesNotThrow(() => archive.observeMemorial(snapshot));
  assert.equal(medal(archive, 'death_5').unlocked, true);
  archive.observeMemorial({ total: 6, records: [{ name: 'PRIVATE_DEATH_PERSON', phone: 'PRIVATE_DEATH_PHONE', privateText: 'PRIVATE_DEATH_NOTE' }] });
  const raw = String(storage.values.get(KEY));
  assert.equal(raw.includes('PRIVATE_DEATH'), false);
  assert.deepEqual(medal(archive, 'death_5').evidence, { deathCount: 5 });
});

function event(occurrenceId, category = 'adverse', family = 'leadership', extra = {}) {
  return { occurrenceId, category, family, ...extra };
}

test('鼠鼠鼠了 counts five leadership or faction adverse events while benefits and ordinary actions do not break the sequence', () => {
  const archive = createMedals(memoryStorage(), OPTIONS);
  for (let index = 0; index < 4; index += 1) archive.observeEvent(event(`leader-${index}`, 'adverse', index % 2 ? 'faction' : 'leadership'));
  assert.equal(archive.getState().eventProgress.leadershipAdverseStreak, 4);
  assert.equal(medal(archive, 'leadership_bad_5').unlocked, false);
  archive.observeEvent(event('benefit-between', 'beneficial', 'grant'));
  archive.observeAction('rest', state({ actionCount: 1 }));
  archive.observeState(state({ money: 50 }));
  assert.equal(archive.getState().eventProgress.leadershipAdverseStreak, 4);
  const result = archive.observeEvent(event('leader-fifth', 'adverse', 'faction'));
  assert.deepEqual(ids(result.newlyUnlocked), ['leadership_bad_5']);
  assert.equal(medal(archive, 'leadership_bad_5').name, '鼠鼠鼠了');
  assert.equal(archive.getState().activeTitle, null);
});

test('a different adverse family breaks the leadership sequence and five later qualifying events start it again', () => {
  const archive = createMedals(memoryStorage(), OPTIONS);
  for (let index = 0; index < 4; index += 1) archive.observeEvent(event(`before-${index}`));
  archive.observeEvent(event('health-interruption', 'adverse', 'health'));
  assert.equal(archive.getState().eventProgress.leadershipAdverseStreak, 0);
  for (let index = 0; index < 4; index += 1) archive.observeEvent(event(`after-${index}`, 'adverse', 'faction'));
  assert.equal(medal(archive, 'leadership_bad_5').unlocked, false);
  archive.observeEvent(event('after-fifth'));
  assert.equal(medal(archive, 'leadership_bad_5').unlocked, true);
});

test('好运降临 uses five cumulative distinct beneficial events even with adverse events in between', () => {
  const archive = createMedals(memoryStorage(), OPTIONS);
  for (let index = 0; index < 4; index += 1) {
    archive.observeEvent(event(`good-${index}`, 'beneficial', 'recovery'));
    archive.observeEvent(event(`bad-between-${index}`, 'adverse', 'health'));
  }
  assert.equal(archive.getState().eventProgress.beneficialCount, 4);
  assert.equal(medal(archive, 'beneficial_5').unlocked, false);
  const result = archive.observeEvent(event('good-fifth', 'beneficial', 'grant'));
  assert.deepEqual(ids(result.newlyUnlocked), ['beneficial_5']);
  assert.equal(medal(archive, 'beneficial_5').name, '好运降临');
  const firstEvidence = medal(archive, 'beneficial_5').evidence;
  assert.deepEqual(archive.observeEvent(event('good-sixth', 'beneficial', 'recovery')).newlyUnlocked, []);
  assert.deepEqual(medal(archive, 'beneficial_5').evidence, firstEvidence);
});

test('stable occurrence IDs deduplicate rerenders, restored events and later repeated effect ticks across reload', () => {
  const storage = memoryStorage();
  const archive = createMedals(storage, OPTIONS);
  const first = event('stable-occurrence');
  archive.observeEvent(first);
  for (let index = 0; index < 5; index += 1) assert.deepEqual(archive.observeEvent(first).newlyUnlocked, []);
  // An occurrence is counted once even if a later caller changes its fields.
  archive.observeEvent(event('stable-occurrence', 'beneficial', 'recovery'));
  archive.observeEvent(event('stable-occurrence', 'adverse', 'health'));
  assert.deepEqual(archive.getState().eventProgress, { leadershipAdverseStreak: 1, beneficialCount: 0 });
  const restored = createMedals(storage, OPTIONS);
  restored.observeEvent(first);
  assert.deepEqual(restored.getState().eventProgress, { leadershipAdverseStreak: 1, beneficialCount: 0 });
  restored.observeEvent(event('new-distinct-occurrence'));
  assert.equal(restored.getState().eventProgress.leadershipAdverseStreak, 2);
});

test('new-game, restore and action-progress resets preserve unfinished event counters and occurrence deduplication', () => {
  const storage = memoryStorage();
  const archive = createMedals(storage, OPTIONS);
  archive.observeEvent(event('saved-leader-1'));
  archive.observeEvent(event('saved-leader-2', 'adverse', 'faction'));
  archive.observeEvent(event('saved-good-1', 'beneficial', 'grant'));
  archive.observeAction('work', state({ actionCount: 1 }));
  archive.resetProgress();
  archive.restBreak();
  archive.observeState(state({ money: 50 }));
  assert.deepEqual(archive.getState().progress, { workStreak: 0, researchStreak: 0, noRestCount: 0 });
  assert.deepEqual(archive.getState().eventProgress, { leadershipAdverseStreak: 2, beneficialCount: 1 });
  const reloaded = createMedals(storage, OPTIONS);
  reloaded.resetProgress();
  reloaded.observeEvent(event('saved-leader-1'));
  reloaded.observeEvent(event('saved-good-1', 'beneficial', 'grant'));
  assert.deepEqual(reloaded.getState().eventProgress, { leadershipAdverseStreak: 2, beneficialCount: 1 });
  reloaded.observeEvent(event('saved-leader-3'));
  reloaded.observeEvent(event('saved-good-2', 'beneficial', 'grant'));
  assert.deepEqual(reloaded.getState().eventProgress, { leadershipAdverseStreak: 3, beneficialCount: 2 });
});

test('version 1 seven-medal archives migrate without losing unlocks, title or action progress', () => {
  const storage = memoryStorage();
  const original = createMedals(storage, OPTIONS);
  original.observeState(state({ money: 200, completedAssessments: [assessment()] }));
  original.observeState(state({ money: 0 }));
  original.observeMemorial({ total: 5 });
  const act = actionObserver(original);
  for (let index = 0; index < 4; index += 1) act('work');
  for (let index = 0; index < 4; index += 1) act('research');
  act('inspect'); act('inspect');
  original.equip('death_5');
  const disk = JSON.parse(storage.values.get(KEY));
  disk.records.push({id:'no_rest_10',unlockedAt:new Date(FIXED_TIME).toISOString(),evidence:{consecutiveActions:10}});
  const oldArchive = {
    version: 1, records: disk.records, activeTitle: disk.activeTitle,
    progress: disk.progress, lastActionCount: disk.lastActionCount,
  };
  assert.equal(oldArchive.records.length, 7);
  storage.values.set(KEY, JSON.stringify(oldArchive));
  const migrated = createMedals(storage, OPTIONS);
  assert.equal(migrated.getState().storageError, null);
  assert.equal(migrated.getState().medals.filter((item) => item.unlocked).length, 7);
  assert.equal(migrated.getState().activeTitle, 'death_5');
  assert.deepEqual(migrated.getState().progress, original.getState().progress);
  assert.deepEqual(migrated.getState().eventProgress, { leadershipAdverseStreak: 0, beneficialCount: 0 });
  migrated.observeEvent(event('first-after-migration', 'beneficial', 'recovery'));
  const again = createMedals(storage, OPTIONS);
  assert.equal(again.getState().medals.filter((item) => item.unlocked).length, 7);
  assert.equal(again.getState().activeTitle, 'death_5');
  assert.equal(again.getState().eventProgress.beneficialCount, 1);
});

test('event observer stores occurrence IDs and counters but no extra event content or personal fields', () => {
  const storage = memoryStorage();
  const archive = createMedals(storage, OPTIONS);
  const privateValue = 'PRIVATE_EVENT_PAYLOAD';
  const input = deepFreeze(event('minimal-event', 'adverse', 'leadership', {
    title: privateValue, text: privateValue, name: privateValue, phone: privateValue,
    participantId: privateValue, researchAnswers: { privateAnswer: privateValue },
  }));
  const before = JSON.stringify(input);
  archive.observeEvent(input);
  assert.equal(JSON.stringify(input), before);
  for (let index = 0; index < 4; index += 1) archive.observeEvent(event(`leadership-unlock-${index}`));
  for (let index = 0; index < 5; index += 1) archive.observeEvent(event(`beneficial-unlock-${index}`, 'beneficial', 'grant'));
  const raw = String(storage.values.get(KEY));
  assert.equal(raw.includes(privateValue), false);
  assert.equal(raw.includes('researchAnswers'), false);
  assert.equal(raw.includes('minimal-event'), true);
  assert.equal(medal(archive, 'leadership_bad_5').unlocked, true);
  assert.equal(medal(archive, 'beneficial_5').unlocked, true);
});

test('engine event metadata maps misfortune/fatal leadership and both beneficial categories to medal counters', () => {
  const archive = createMedals(memoryStorage(), OPTIONS);
  archive.observeEvent({ occurrenceId: 'engine-misfortune', category: 'misfortune', medalFamily: 'leadership', isBeneficial: false });
  archive.observeEvent({ occurrenceId: 'engine-fatal', category: 'fatal', medalFamily: 'leadership', isBeneficial: false });
  archive.observeEvent({ occurrenceId: 'engine-beneficial', category: 'beneficial', medalFamily: null, isBeneficial: true });
  archive.observeEvent({ occurrenceId: 'engine-recovery', category: 'beneficial_over_time', medalFamily: null, isBeneficial: true });
  assert.deepEqual(archive.getState().eventProgress, { leadershipAdverseStreak: 2, beneficialCount: 2 });
  archive.observeEvent({ occurrenceId: 'engine-other-adverse', category: 'misfortune', medalFamily: null, isBeneficial: false });
  assert.deepEqual(archive.getState().eventProgress, { leadershipAdverseStreak: 0, beneficialCount: 2 });
});

function balancedDay(act) {
  return ['work', 'rest', 'inspect', 'research', 'npc'].map((type) => act(type));
}

test('劳逸结合 unlocks only after seven complete five-action days containing both clinical work and rest', () => {
  const archive = createMedals(memoryStorage(), OPTIONS);
  const act = actionObserver(archive);
  for (let day = 0; day < 6; day += 1) balancedDay(act);
  assert.equal(archive.getState().balanceProgress.consecutiveDays, 6);
  assert.equal(medal(archive, 'balanced_week').unlocked, false);
  for (const type of ['work', 'rest', 'inspect', 'research']) act(type);
  assert.equal(medal(archive, 'balanced_week').unlocked, false);
  const result = act('npc');
  assert.ok(result.newlyUnlocked.some((item) => item.id === 'balanced_week'));
  assert.equal(medal(archive, 'balanced_week').name, '劳逸结合');
  assert.deepEqual(medal(archive, 'balanced_week').evidence, { consecutiveDays: 7 });
});

test('a first observed partial day cannot count toward a balanced week; clinical teaching and entertainment can satisfy later days', () => {
  const archive = createMedals(memoryStorage(), OPTIONS);
  const act = actionObserver(archive, 2);
  act('clinical', {}, { questionId: 'partial-q', correct: true });
  act('entertain'); act('inspect');
  assert.equal(archive.getState().balanceProgress.consecutiveDays, 0);
  for (let day = 0; day < 6; day += 1) {
    act('clinical', {}, { questionId: `balanced-q-${day}`, correct: true });
    act('entertain'); act('inspect'); act('research'); act('npc');
  }
  assert.equal(archive.getState().balanceProgress.consecutiveDays, 6);
  assert.equal(medal(archive, 'balanced_week').unlocked, false);
  balancedDay(act);
  assert.equal(medal(archive, 'balanced_week').unlocked, true);
});

test('an incomplete clinical/rest day breaks a balanced streak, resume retains it, and resetProgress clears it', () => {
  const storage = memoryStorage();
  const archive = createMedals(storage, OPTIONS);
  const act = actionObserver(archive);
  for (let day = 0; day < 3; day += 1) balancedDay(act);
  const reloaded = createMedals(storage, OPTIONS);
  assert.equal(reloaded.getState().balanceProgress.consecutiveDays, 3);
  const resumedAct = actionObserver(reloaded, 15);
  for (const type of ['rest', 'research', 'inspect', 'research', 'npc']) resumedAct(type);
  assert.equal(reloaded.getState().balanceProgress.consecutiveDays, 0);
  balancedDay(resumedAct);
  assert.equal(reloaded.getState().balanceProgress.consecutiveDays, 1);
  reloaded.resetProgress();
  assert.equal(reloaded.getState().balanceProgress.consecutiveDays, 0);
  assert.equal(reloaded.getState().balanceProgress.actionsObserved, 0);
  const newAct = actionObserver(reloaded);
  balancedDay(newAct);
  assert.equal(reloaded.getState().balanceProgress.consecutiveDays, 1);
});

test('学以致用 requires ten different correctly answered teaching questions and retains the set across reset/reload', () => {
  const storage = memoryStorage();
  const archive = createMedals(storage, OPTIONS);
  const act = actionObserver(archive);
  act('clinical', {}, { questionId: 'wrong-question', correct: false });
  for (let index = 1; index <= 5; index += 1) act('clinical', {}, { questionId: `q-${index}`, correct: true });
  act('clinical', {}, { questionId: 'q-1', correct: true });
  assert.equal(archive.getState().collections.knowledgeIds.length, 5);
  archive.resetProgress();
  const reloaded = createMedals(storage, OPTIONS);
  const nextAct = actionObserver(reloaded);
  for (let index = 6; index <= 9; index += 1) nextAct('clinical', {}, { questionId: `q-${index}`, correct: true });
  assert.equal(medal(reloaded, 'knowledge_10').unlocked, false);
  nextAct('clinical', {}, { questionId: 'q-10', correct: true });
  assert.equal(medal(reloaded, 'knowledge_10').name, '学以致用');
  assert.equal(medal(reloaded, 'knowledge_10').unlocked, true);
  assert.deepEqual(medal(reloaded, 'knowledge_10').evidence, { questionCount: 10 });
  assert.equal(reloaded.getState().collections.knowledgeIds.includes('wrong-question'), false);
});

test('抽丝剥茧 counts five distinct solved source chapters with numeric/string identity deduplication', () => {
  const archive = createMedals(memoryStorage(), OPTIONS);
  const act = actionObserver(archive);
  act('puzzle', {}, { chapterId: 99, puzzleSolved: false });
  act('puzzle', {}, { chapterId: 1, puzzleSolved: true });
  act('puzzle', {}, { chapterId: '1', puzzleSolved: true });
  assert.deepEqual(archive.getState().collections.puzzleChapterIds, ['1']);
  for (let chapterId = 2; chapterId <= 4; chapterId += 1) act('puzzle', {}, { chapterId, puzzleSolved: true });
  assert.equal(medal(archive, 'puzzles_5').unlocked, false);
  act('puzzle', {}, { chapterId: 5, puzzleSolved: true });
  assert.equal(medal(archive, 'puzzles_5').name, '抽丝剥茧');
  assert.deepEqual(medal(archive, 'puzzles_5').evidence, { chapterCount: 5 });
  archive.resetProgress();
  assert.equal(archive.getState().collections.puzzleChapterIds.length, 5);
});

test('同舟共济 requires each of the four catalog NPC quests, rejecting incomplete, duplicate and unknown NPCs', () => {
  const archive = createMedals(memoryStorage(), OPTIONS);
  const act = actionObserver(archive);
  act('npc', {}, { npcId: 'guning', questCompleted: false });
  act('npc', {}, { npcId: 'unknown-person', questCompleted: true });
  assert.deepEqual(archive.getState().collections.npcIds, []);
  for (const npcId of ['guning', 'huangning', 'limuliang']) act('npc', {}, { npcId, questCompleted: true });
  act('npc', {}, { npcId: 'guning', questCompleted: true });
  assert.equal(medal(archive, 'npc_all').unlocked, false);
  act('npc', {}, { npcId: 'liuchangsheng', questCompleted: true });
  assert.equal(medal(archive, 'npc_all').name, '同舟共济');
  assert.equal(medal(archive, 'npc_all').unlocked, true);
  assert.deepEqual(medal(archive, 'npc_all').evidence, { npcCount: 4 });
  assert.equal(archive.getState().collections.npcIds.length, 4);
});

test('改写命运 requires two distinct branch endings in the same source chapter and merges across games', () => {
  const storage = memoryStorage();
  const archive = createMedals(storage, OPTIONS);
  archive.observeState(state({ endings: [{ chapterId: 1, choiceId: 'c01_truth' }, { chapterId: 1, choiceId: 'c01_truth' }, { chapterId: 2, choiceId: 'c02_rest' }] }));
  assert.equal(medal(archive, 'branch_2').unlocked, false);
  archive.resetProgress();
  const reloaded = createMedals(storage, OPTIONS);
  const result = reloaded.observeState(state({ endings: [{ chapterId: '1', choiceId: 'c01_rest' }] }));
  assert.deepEqual(ids(result.newlyUnlocked), ['branch_2']);
  assert.equal(medal(reloaded, 'branch_2').name, '改写命运');
  assert.deepEqual(medal(reloaded, 'branch_2').evidence, { chapterId: '1', endingCount: 2 });
  const chapter = reloaded.getState().collections.chapterEndings.find((entry) => entry.chapterId === '1');
  assert.deepEqual([...chapter.endingIds].sort(), ['c01_rest', 'c01_truth']);
});

test('collection evidence and saved IDs exclude extra action context and ending text', () => {
  const storage = memoryStorage();
  const archive = createMedals(storage, OPTIONS);
  const secret = 'PRIVATE_COLLECTION_PAYLOAD';
  const act = actionObserver(archive);
  const context = deepFreeze({ questionId: 'allowed-q', correct: true, name: secret, answerText: secret, research: { answers: secret } });
  const before = JSON.stringify(context);
  act('clinical', {}, context);
  archive.observeState(state({ endings: [{ chapterId: 1, choiceId: 'allowed-ending', title: secret, text: secret }] }));
  assert.equal(JSON.stringify(context), before);
  const raw = String(storage.values.get(KEY));
  assert.equal(raw.includes(secret), false);
  assert.deepEqual(archive.getState().collections.knowledgeIds, ['allowed-q']);
  assert.equal(archive.getState().collections.chapterEndings[0].endingIds.includes('allowed-ending'), true);
});

test('health-crisis restBreak does not replace a formal rest action for a balanced day', () => {
  const archive = createMedals(memoryStorage(), OPTIONS);
  const act = actionObserver(archive);
  act('work');
  archive.restBreak();
  act('research'); act('inspect'); act('research'); act('npc');
  assert.equal(archive.getState().balanceProgress.consecutiveDays, 0);
  assert.equal(medal(archive, 'balanced_week').unlocked, false);
});

test('all triggered events are observed in order so salary penalty breaks the streak before a same-action faction fatal event', () => {
  const archive = createMedals(memoryStorage(), OPTIONS);
  for (let index = 0; index < 4; index += 1) archive.observeEvent(event(`pre-salary-leader-${index}`));
  const result = {
    triggeredEvents: [
      { occurrenceId: 'work-salary-penalty', category: 'misfortune', medalFamily: null, isBeneficial: false },
      { occurrenceId: 'work-faction-fatal', category: 'fatal', medalFamily: 'leadership', isBeneficial: false },
    ],
  };
  for (const triggered of result.triggeredEvents) archive.observeEvent(triggered);
  assert.equal(archive.getState().eventProgress.leadershipAdverseStreak, 1);
  assert.equal(medal(archive, 'leadership_bad_5').unlocked, false);
});
