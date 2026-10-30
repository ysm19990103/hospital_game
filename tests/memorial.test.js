'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemorial, classifyDeath } = require('../src/memorial');
const { createGame } = require('../src/engine');

const fixedTime = 1792464123000;
function memoryStorage() {
  const values = new Map(); const calls = { reads: 0, writes: 0 };
  return {
    values, calls,
    getItem(key) { calls.reads += 1; return values.get(key); },
    setItem(key, value) { calls.writes += 1; values.set(key, value); return true; },
  };
}
function source() {
  return [{
    id: 28, sourceChapterId: 28, gameOrder: 1, title: '赤色祭坛', clues: [],
    choices: [{ id: 'end', label: '离开', requiresClues: 0, effects: {}, ending: { title: '离开', text: '', tone: 'mixed' } }],
  }];
}
const noRandom = {
  fatalRisk: { work: 0, research: 0, politics: 0 },
  beneficialRisk: { chief_duty_appointment: 0, national_grant_award: 0, record_speech_champion: 0 },
  lowHpEventChance: 0, lowHpAdditionalChance: 0,
  statusEventProbability: 0, recoveryEventProbability: 0,
};
function game(extra = {}) {
  return createGame(source(), { seed: 7, debug: true, clock: () => fixedTime, rules: noRandom, ...extra });
}

test('memorial records both the independent game time and an injected real timestamp', () => {
  const storage = memoryStorage(); const g = game({ storage });
  for (let i = 0; i < 6; i += 1) g.act({ type: 'rest' });
  g.act({ type: 'forceEvent', eventId: 'record_failure' });
  const archive = g.getMemorial(); const record = archive.records[0];
  assert.equal(archive.total, 1); assert.equal(record.character, '李晨光');
  assert.equal(record.day, 2); assert.equal(record.completedDays, 1); assert.equal(record.dayPhase, '午');
  assert.equal(record.actionCount, 6); assert.equal(record.recordedAtMs, fixedTime);
  assert.equal(record.recordedAt, new Date(fixedTime).toISOString());
  assert.equal(record.chapterId, 28); assert.equal(record.sourceChapterId, 28);
  assert.equal(record.chapterOrder, 1); assert.equal(record.gameOrder, 1); assert.equal(record.chapterTitle, '赤色祭坛');
  assert.equal(record.category, 'clinical'); assert.equal(record.causeId, 'record_failure');
  assert.equal(record.persisted, true); assert.equal(g.state.failure.deathId, record.deathId);
  assert.equal(g.state.failure.memorialSaved, true); assert.equal(archive.storageError, null);
});

test('rendering or repeatedly loading the same failure never appends another death', () => {
  const storage = memoryStorage(); const g = game({ storage });
  g.act({ type: 'forceEvent', eventId: 'record_failure' }); const failureSave = g.save().json;
  const id = g.state.failure.deathId;
  for (let i = 0; i < 5; i += 1) {
    g.getMemorial(); assert.equal(g.load(failureSave).ok, true);
    assert.equal(g.act({ type: 'forceEvent', eventId: 'record_failure' }).ok, false);
  }
  assert.equal(g.getMemorial().total, 1);
  const reloaded = game({ storage, clock: () => fixedTime + 999999 });
  assert.equal(reloaded.load(failureSave).ok, true);
  assert.equal(reloaded.getMemorial().total, 1);
  assert.equal(reloaded.getMemorial().records[0].deathId, id);
  assert.equal(reloaded.getMemorial().records[0].recordedAtMs, fixedTime);
});

test('another death after checkpoint restore and another after new game each append a unique record', () => {
  const storage = memoryStorage(); const g = game({ storage });
  g.act({ type: 'forceEvent', eventId: 'record_failure' });
  g.restoreCheckpoint(); g.act({ type: 'forceEvent', eventId: 'record_failure' });
  g.newGame(); g.act({ type: 'forceEvent', eventId: 'grant_failure' });
  const archive = g.getMemorial();
  assert.equal(archive.total, 3); assert.equal(new Set(archive.records.map((r) => r.deathId)).size, 3);
  assert.deepEqual(archive.records.map((r) => r.causeId), ['record_failure', 'record_failure', 'grant_failure']);
  assert.equal(archive.stats.find((s) => s.category === 'clinical').count, 2);
  assert.equal(archive.stats.find((s) => s.category === 'clinical').percentage, 66.7);
  assert.equal(archive.stats.find((s) => s.category === 'research').percentage, 33.3);
  assert.equal(game({ storage }).getMemorial().total, 3);
});

test('a later game instance merges existing memorial records instead of overwriting them', () => {
  const storage = memoryStorage();
  const first = game({ storage }); const second = game({ storage });
  first.act({ type: 'forceEvent', eventId: 'record_failure' });
  second.act({ type: 'forceEvent', eventId: 'faction_failure' });
  const loaded = game({ storage }).getMemorial();
  assert.equal(loaded.total, 2); assert.equal(new Set(loaded.records.map((r) => r.deathId)).size, 2);
  assert.deepEqual(loaded.records.map((r) => r.causeId), ['record_failure', 'faction_failure']);
});

test('getMemorial is an in-memory view with no per-render storage I/O', () => {
  const storage = memoryStorage(); const g = game({ storage });
  g.act({ type: 'forceEvent', eventId: 'record_failure' });
  const before = { ...storage.calls };
  for (let i = 0; i < 100; i += 1) g.getMemorial();
  assert.deepEqual(storage.calls, before);
});

test('storage refusal retains a death in memory, reports failure, and allows an explicit retry', () => {
  const storage = memoryStorage(); const write = storage.setItem;
  let blocked = true;
  storage.setItem = function (key, value) { return blocked ? false : write.call(this, key, value); };
  const g = game({ storage }); g.act({ type: 'forceEvent', eventId: 'grant_failure' });
  const id = g.state.failure.deathId;
  assert.equal(g.getMemorial().total, 1); assert.equal(g.getMemorial().unsavedCount, 1);
  assert.equal(g.state.failure.memorialSaved, false); assert.match(g.state.failure.memorialError, /拒绝/);
  assert.equal(g.getMemorial().records[0].persisted, false);
  blocked = false;
  assert.equal(g.retryMemorialSave().ok, true);
  assert.equal(g.getMemorial().unsavedCount, 0); assert.equal(g.state.failure.memorialSaved, true);
  assert.equal(g.getMemorial().records[0].deathId, id);
  assert.equal(game({ storage }).getMemorial().total, 1);
});

test('game save retries pending memorial records and reports its own false adapter result', () => {
  const storage = memoryStorage(); const write = storage.setItem;
  let blocked = true;
  storage.setItem = function (key, value) { return blocked ? false : write.call(this, key, value); };
  const g = game({ storage }); g.act({ type: 'forceEvent', eventId: 'grant_failure' });
  assert.equal(g.save().ok, false);
  blocked = false;
  assert.equal(g.save().ok, true); assert.equal(g.getMemorial().unsavedCount, 0);
  assert.equal(g.state.failure.memorialSaved, true);
});

test('a failure save can recover an unsaved memorial with its original id and time', () => {
  const first = game(); first.act({ type: 'forceEvent', eventId: 'record_failure' });
  const saved = first.save().json; const deathId = first.state.failure.deathId;
  assert.equal(first.getMemorial().unsavedCount, 1);
  const storage = memoryStorage(); const loaded = game({ storage, clock: () => fixedTime + 12345 });
  loaded.load(saved); loaded.load(saved);
  assert.equal(loaded.getMemorial().total, 1);
  assert.equal(loaded.getMemorial().records[0].deathId, deathId);
  assert.equal(loaded.getMemorial().records[0].recordedAtMs, fixedTime);
  assert.equal(loaded.getMemorial().records[0].persisted, true);
});

test('malformed old memorial data is preserved rather than overwritten on a new death', () => {
  const storage = memoryStorage(); storage.values.set('baiyi-game-memorial-v1', 'broken old archive');
  const g = game({ storage }); g.act({ type: 'forceEvent', eventId: 'record_failure' });
  assert.equal(g.getMemorial().total, 1); assert.equal(g.getMemorial().unsavedCount, 1);
  assert.ok(g.getMemorial().storageError);
  assert.equal(storage.values.get('baiyi-game-memorial-v1'), 'broken old archive');
});

test('WeChat-style synchronous storage and clock objects are supported', () => {
  const values = {};
  const archive = createMemorial({
    storage: { getStorageSync: (key) => values[key], setStorageSync: (key, value) => { values[key] = value; } },
    clock: { now: () => fixedTime },
  });
  assert.equal(archive.append({ category: 'other', character: '李晨光' }).ok, true);
  assert.equal(archive.read().records[0].recordedAtMs, fixedTime);
  assert.equal(archive.read().records[0].persisted, true);
});

test('cause classification uses the immediate event before considering fatigue', () => {
  assert.equal(classifyDeath({ id: 'record_failure' }), 'clinical');
  assert.equal(classifyDeath({ id: 'grant_failure' }), 'research');
  assert.equal(classifyDeath({ id: 'faction_failure' }), 'workplace');
  assert.equal(classifyDeath({ actionType: 'monthly_assessment', exhaustionLethal: true }), 'assessment');
  assert.equal(classifyDeath({ eventId: 'harsh_leader', exhaustionLethal: true }), 'workplace');
  assert.equal(classifyDeath({ eventId: 'patient_conflict', exhaustionLethal: true }), 'clinical');
  assert.equal(classifyDeath({ eventId: 'family_betrayal', exhaustionLethal: true }), 'other');
  assert.equal(classifyDeath({ actionType: 'travel', exhaustionLethal: true }), 'overwork');
  assert.equal(classifyDeath({ actionType: 'travel' }), 'other');
});

test('actual exhaustion and an actual leader event receive distinct categories', () => {
  const exhausted = game(); exhausted.state.hp = 5; exhausted.state.energy = 0;
  exhausted.act({ type: 'travel', room: 'other' });
  assert.equal(exhausted.getMemorial().records[0].category, 'overwork');
  const leader = game(); leader.state.hp = 5; leader.state.energy = 0;
  leader.act({ type: 'forceEvent', eventId: 'harsh_leader' }); leader.resolveEvent('comply');
  assert.equal(leader.getMemorial().records[0].category, 'workplace');
  assert.equal(leader.getMemorial().records[0].causeId, 'harsh_leader');
  assert.match(leader.getMemorial().records[0].causeTitle, /苛刻的领导/);
});

test('monthly-assessment death is stored under the explicit assessment category', () => {
  const g = game({ knowledge: [{ id: 'q', category: '内科', options: ['正确', '错误'], correctIndex: 0 }] });
  g.state.actionCount = 139; g.act({ type: 'rest' }); g.state.hp = 5;
  g.answerMonthly(1, 'q');
  const record = g.getMemorial().records[0];
  assert.equal(record.category, 'assessment'); assert.equal(record.day, 29);
  assert.equal(record.actionCount, 140); assert.equal(record.actionType, 'monthly_assessment');
  assert.match(record.causeTitle, /月度考核/);
});

test('no durable adapter is an explicit limitation while in-session history remains usable', () => {
  const g = game(); g.act({ type: 'forceEvent', eventId: 'record_failure' });
  assert.equal(g.getMemorial().total, 1); assert.equal(g.getMemorial().unsavedCount, 1);
  assert.match(g.getMemorial().storageError, /未配置持久存储/);
  g.newGame(); assert.equal(g.getMemorial().total, 1);
});
