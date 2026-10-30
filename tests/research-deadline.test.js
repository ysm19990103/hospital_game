'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame, RESEARCH_ABSENCE_DAYS, RESEARCH_ABSENCE_UNITS } = require('../src/engine');
const { createQuestionHistory } = require('../src/question-history');
const source = [{ id: 1, title: '当前章节', presentation: 'video', clues: [], choices: [{ id: 'end', effects: {} }] },
  { id: 2, title: '下一章', presentation: 'video', clues: [], choices: [{ id: 'end', effects: {} }] }];
const sideStories = [1, 2, 3, 4, 5].map(id => ({ id: `side_${id}`, npcId: 'friend', title: '支线', requires: [] }));
const quietRules = { statusEventProbability: 0, recoveryEventProbability: 0,
  lowHpEventChance: 0, lowHpAdditionalChance: 0, salaryPenaltyProbability: 0,
  fatalRisk: { work: 0, research: 0, politics: 0 },
  beneficialRisk: { chief_duty_appointment: 0, national_grant_award: 0, record_speech_champion: 0 } };
const storage = () => { const m = new Map(); return { getItem: k => m.get(k) || null, setItem: (k, v) => m.set(k, v) }; };
const game = (options = {}) => createGame(source, { seed: 42, debug: true, sideStories,
  clock: () => Date.parse('2026-10-30T01:00:00Z'), ...options, rules: { ...quietRules, ...(options.rules || {}) } });
function rest(g, count) { for (let i = 0; i < count; i++) assert.equal(g.act('rest').ok, true); }

test('research absence kills at exactly 25 elapsed units even at full HP, with one persistent research death', () => {
  const s = storage(), g = game({ storage: s });
  assert.equal(RESEARCH_ABSENCE_DAYS, 5); assert.equal(RESEARCH_ABSENCE_UNITS, 25);
  assert.deepEqual(g.getResearchDeadline(), { limitDays: 5, limitUnits: 25, elapsedUnits: 0,
    remainingUnits: 25, remainingDays: 5, remainingActions: 0, dueSoon: false, overdue: false });
  rest(g, 24); assert.equal(g.state.status, 'playing'); assert.equal(g.getResearchDeadline().remainingUnits, 1);
  const failure = g.act('rest');
  assert.equal(failure.researchAbsenceTriggered, true); assert.equal(g.state.status, 'failure');
  assert.equal(g.state.hp, 100); assert.equal(g.state.failure.id, 'research_absence');
  assert.equal(g.state.completedDays, 5); assert.equal(g.state.day, 6);
  assert.equal(g.getMemorial().total, 1); const record = g.getMemorial().records[0];
  assert.equal(record.category, 'research'); assert.equal(record.causeId, 'research_absence'); assert.equal(record.persisted, true);
  assert.equal(g.act('research').ok, false); assert.equal(g.getMemorial().total, 1);
  const resumed = game({ storage: s }); assert.equal(resumed.load(g.save().json).ok, true);
  assert.equal(resumed.getMemorial().total, 1); assert.equal(resumed.getMemorial().records[0].deathId, record.deathId);
});

test('completed research on last allowed action resets deadline, while menus, rejected actions and preparation do not', () => {
  const g = game(); rest(g, 23);
  const before = structuredClone(g.state);
  assert.equal(g.act({ type: 'inspect', clueId: 'missing' }).ok, false);
  g.getResearchDeadline(); g.getRisks(); g.getChapter(); g.act('move');
  assert.deepEqual(g.state, before);
  assert.equal(g.act({ type: 'prepare', kind: 'grant' }).ok, true);
  assert.equal(g.state.researchIdleUnits, 24);
  const blockedBefore = structuredClone(g.state); assert.equal(g.act({ type: 'prepare', kind: 'grant' }).ok, false);
  assert.deepEqual(g.state, blockedBefore);
  assert.equal(g.act('research').ok, true); assert.equal(g.state.status, 'playing');
  assert.equal(g.state.actionCount, 25); assert.equal(g.state.researchIdleUnits, 0);
  assert.equal(g.getResearchDeadline().remainingUnits, 25);
  rest(g, 24); assert.equal(g.state.status, 'playing'); g.act('rest'); assert.equal(g.state.status, 'failure');
});

test('first main and side films count a day, repeat viewing is free, and fifth day fails before ambient events', () => {
  const g = game(); g.completeVideo(1); g.completeSideVideo('side_1');
  const after = structuredClone(g.state);
  assert.equal(g.completeVideo(1).alreadyCompleted, true); assert.equal(g.completeSideVideo('side_1').alreadyCompleted, true);
  assert.deepEqual(g.state, after);
  g.completeSideVideo('side_2'); g.completeSideVideo('side_3'); assert.equal(g.state.researchIdleUnits, 20);
  const result = g.completeSideVideo('side_4');
  assert.equal(result.researchAbsenceTriggered, true); assert.equal(result.advancedDays, 1);
  assert.equal(g.state.actionCount, 0); assert.equal(g.state.videoDays, 5); assert.equal(g.state.failure.id, 'research_absence');
  assert.deepEqual(result.triggeredEvents.map(e => e.id), ['research_absence']);
  assert.equal(g.isSideVideoCompleted('side_4'), true);
});

test('ordinary research fatal risk still applies even when research meets deadline', () => {
  const g = game({ rules: { fatalRisk: { work: 0, research: 1, politics: 0 } } }); rest(g, 24);
  g.act('research'); assert.equal(g.state.researchIdleUnits, 0);
  assert.equal(g.state.failure.id, 'grant_failure'); assert.equal(g.getMemorial().records[0].category, 'research');
});

test('deadline death takes priority over a full-health award and does not draw random outcomes', () => {
  const g = game({ rules: { beneficialRisk: { chief_duty_appointment: 1, national_grant_award: 1, record_speech_champion: 1 } } });
  rest(g, 24); const rng = g.state._rng;
  g.act('work'); assert.equal(g.state.failure.id, 'research_absence'); assert.equal(g.state._rng, rng);
  assert.equal(g.state.event, null);
});

test('saved checkpoints preserve remaining deadline and restore 50 HP; subsequent death appends memorial', () => {
  const s = storage(), g = game({ storage: s }); rest(g, 24); g.checkpoint('科研期限前');
  g.act('rest'); assert.equal(g.getMemorial().total, 1);
  g.restoreCheckpoint(); assert.equal(g.state.hp, 50); assert.equal(g.state.researchIdleUnits, 24);
  g.act('rest'); assert.equal(g.getMemorial().total, 2);
  g.restoreCheckpoint(); assert.equal(g.state.researchIdleUnits, 24); g.act('research');
  assert.equal(g.state.status, 'playing'); assert.equal(g.state.researchIdleUnits, 0);
  const resumed = game({ storage: s }); assert.equal(resumed.load(g.save().json).ok, true);
  assert.equal(resumed.state.researchIdleUnits, 0); resumed.restoreCheckpoint(); assert.equal(resumed.state.researchIdleUnits, 24);
});

test('legacy saves get a full first window, later loads retain count, and malformed counts are rejected atomically', () => {
  const g = game(), legacy = g.save().data;
  legacy.state.actionCount = 200;
  for (const snapshot of [legacy.state, legacy.checkpoint, ...Object.values(legacy.chapterStarts)]) delete snapshot.researchIdleUnits;
  assert.equal(g.load(legacy).ok, true); assert.equal(g.state.researchIdleUnits, 0); assert.equal(g.getResearchDeadline().remainingUnits, 25);
  rest(g, 7); const saved = g.save().data; assert.equal(game().load(saved).ok, true);
  const resumed = game(); resumed.load(saved); assert.equal(resumed.state.researchIdleUnits, 7);
  for (const invalid of [-1, 1.5, '5', NaN, 25]) {
    const bad = g.save().data; bad.state.researchIdleUnits = invalid; const before = structuredClone(g.state);
    assert.equal(g.load(bad).ok, false); assert.deepEqual(g.state, before);
  }
});

test('normal chapter progression carries deadline and chapter replay restores its recorded counter', () => {
  const g = game(); g.completeVideo(1); g.chooseEnding('end'); g.startChapter(2);
  assert.equal(g.state.researchIdleUnits, 5); rest(g, 7);
  g.startChapter(2, { replay: true }); assert.equal(g.state.researchIdleUnits, 5); assert.equal(g.state.hp, 50);
  g.act('research'); assert.equal(g.state.researchIdleUnits, 0);
  g.startChapter(2, { replay: true }); assert.equal(g.state.researchIdleUnits, 5);
});

test('authoritative operation replay enforces the same deadline and research reset', () => {
  const core = require('../cloudfunctions/baiyiLeaderboard/core');
  const config = require('../cloudfunctions/baiyiLeaderboard/server-config.json');
  const run = { runId: 'research-deadline-replay', seed: 42, startedAt: Date.parse('2026-10-30T01:00:00Z') };
  const bundle = { chapters: source, npcs: [], knowledge: [], createQuestionHistory,
    createGame: (chapters, options) => createGame(chapters, { ...options, sideStories, rules: quietRules }) };
  const restOp = { method: 'act', action: { type: 'rest' } };
  const researchOp = { method: 'act', action: { type: 'research' } };
  const operations = [...Array(24).fill(restOp), researchOp, ...Array(25).fill(restOp)];
  const server = core.replayRun(run, operations, config, bundle), local = game({ occurrenceNamespace: run.runId });
  for (const op of operations) assert.equal(local.act(op.action).ok, true);
  assert.equal(server.state.failure.id, local.state.failure.id); assert.equal(server.state.researchIdleUnits, 25);
  assert.equal(server.state.actionCount, local.state.actionCount); assert.equal(server.state._rng, local.state._rng);
  assert.equal(server.state.failure.occurrenceId, local.state.failure.occurrenceId);
  assert.deepEqual(server.saveData, core.replayRun(run, operations, config, bundle).saveData);
  const restored = core.replayRun(run, [...operations, { method: 'restoreCheckpoint' }, researchOp], config, bundle);
  assert.equal(restored.state.status, 'playing'); assert.equal(restored.state.researchIdleUnits, 0);
});


test('completed legacy catalog can fill newly inserted chapters without overwriting earlier progress', () => {
  const old = game(); old.completeVideo(1); old.chooseEnding('end'); old.startChapter(2); old.completeVideo(2); old.chooseEnding('end');
  const saved = old.save().data, originalResults = structuredClone(saved.state.chapterResults);
  for (const snapshot of [saved.state, saved.checkpoint, ...Object.values(saved.chapterStarts)]) delete snapshot.researchIdleUnits;
  const inserted = { id: 99, title: '新插入的故事', presentation: 'video', clues: [], choices: [{ id: 'end', effects: {} }] };
  const expanded = createGame([source[0], inserted, source[1]], { rules: quietRules, sideStories });
  assert.equal(expanded.load(saved).ok, true); assert.equal(expanded.state.status, 'complete');
  assert.equal(expanded.getNextUnfinishedChapter().id, 99); assert.equal(expanded.state.researchIdleUnits, 0);
  assert.equal(expanded.startChapter(99).ok, true); assert.deepEqual(expanded.state.completedVideos, [1, 2]);
  expanded.completeVideo(99); expanded.chooseEnding('end');
  assert.equal(expanded.state.status, 'complete'); assert.equal(expanded.getNextUnfinishedChapter(), null);
  assert.deepEqual(expanded.state.chapterResults['1'], originalResults['1']);
  assert.deepEqual(expanded.state.chapterResults['2'], originalResults['2']);
  assert.equal(expanded.state.finalEnding.completedChapters, 3);
});

test('partly completed legacy story keeps its current chapter, then offers earlier inserted content', () => {
  const old = game(); old.completeVideo(1); old.chooseEnding('end'); old.startChapter(2); old.act('rest');
  const saved = old.save().data, oldCheckpoint = structuredClone(saved.checkpoint);
  const inserted = { id: 99, title: '补叙', presentation: 'video', clues: [], choices: [{ id: 'end', effects: {} }] };
  const expanded = createGame([source[0], inserted, source[1]], { rules: quietRules, sideStories });
  assert.equal(expanded.load(saved).ok, true); assert.equal(expanded.state.chapterId, 2);
  assert.deepEqual(expanded.save().data.checkpoint, oldCheckpoint);
  assert.equal(expanded.startChapter(99).ok, false);
  expanded.completeVideo(2); expanded.chooseEnding('end');
  assert.equal(expanded.state.status, 'chapter_end'); assert.equal(expanded.getNextUnfinishedChapter().id, 99);
  const result2 = structuredClone(expanded.state.chapterResults['2']);
  expanded.startChapter(99); expanded.completeVideo(99); expanded.chooseEnding('end');
  assert.equal(expanded.state.status, 'complete'); assert.deepEqual(expanded.state.chapterResults['2'], result2);
});
