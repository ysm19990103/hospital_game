'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('../src/engine');
const chapters = () => [1, 2].map(id => ({
  id, title: `章${id}`, presentation: 'video',
  clues: [{ id: 'a', room: 'hospital', flags: { storySeen: true } }, { id: 'b', room: 'other' }],
  puzzle: { options: ['甲'], correctIndex: 0 },
  choices: [{ id: 'truth', requiresClues: 99, requiresPuzzle: true, effects: {}, ending: { title: '真相' } }],
}));
const quietRules = { statusEventProbability: 0, recoveryEventProbability: 0,
  lowHpEventChance: 0, lowHpAdditionalChance: 0, salaryPenaltyProbability: 0,
  fatalRisk: { work: 0, research: 0, politics: 0 },
  beneficialRisk: { chief_duty_appointment: 0, national_grant_award: 0, record_speech_champion: 0 } };
const game = (data = chapters(), options = {}) => createGame(data, {
  seed: 42, debug: true, ...options, rules: { ...quietRules, ...(options.rules || {}) },
});

test('unwatched video blocks every branch; viewing archives story information without puzzle credit', () => {
  const g = game();
  assert.equal(g.isVideoCompleted(), false);
  assert.deepEqual(g.getAvailableChoices(), []);
  assert.equal(g.chooseEnding('truth').ok, false);
  const result = g.completeVideo(1);
  assert.equal(result.ok, true); assert.equal(result.archivedClues, 2);
  assert.equal(g.isVideoCompleted('1'), true);
  assert.deepEqual(g.state.clues, ['a', 'b']);
  assert.deepEqual(g.state.allClues, ['1:a', '1:b']);
  assert.equal(g.state.flags.storySeen, true);
  assert.equal(g.state.flags.puzzleSolved, false);
  assert.equal(g.state.flags.totalPuzzlesSolved, undefined);
  assert.equal(g.getAvailableChoices().length, 1);
  assert.equal(g.chooseEnding('truth').ok, true);
});

test('first video advances exactly one day, settles existing effects, and repeated completion is free', () => {
  const g = game();
  g.act('rest'); g.act('rest');
  g.act({ type: 'forceEvent', eventId: 'director_hostility' }); g.resolveEvent('continue');
  const before = structuredClone(g.state);
  const completed = g.completeVideo(1);
  assert.equal(completed.ok, true); assert.equal(completed.consumedTime, 0);
  assert.equal(completed.advancedDays, 1); assert.equal(completed.elapsedUnits, 5);
  assert.deepEqual(completed.triggeredEvents, []);
  for (const field of ['energy', 'money', 'trust', 'insight', 'time', 'actionCount', 'dayPhaseIndex', '_rng', 'salary']) {
    assert.deepEqual(g.state[field], before[field], field);
  }
  assert.equal(g.state.day, before.day + 1); assert.equal(g.state.completedDays, before.completedDays + 1);
  assert.equal(g.state.videoDays, 1); assert.equal(g.state.hp, before.hp - 6);
  assert.equal(g.state.clinicalIdleActions, before.clinicalIdleActions + 5);
  assert.equal(g.state.survivalActionCount, before.survivalActionCount + 5);
  assert.equal(g.state.cooldown, 0);
  assert.equal(g.state.statusEffects[0].remainingActions, 20);
  assert.equal(g.state.statusEffects[0].ticksRemaining, 4);
  assert.equal(completed.statusEffectTicks.length, 1);
  const after = structuredClone(g.state);
  const repeat = g.completeVideo(1);
  assert.equal(repeat.alreadyCompleted, true); assert.equal(repeat.advancedDays, 0); assert.equal(repeat.elapsedUnits, 0);
  assert.deepEqual(g.state, after);
});

test('completion rejects stale chapter, classic chapters, events and ended chapters', () => {
  const g = game(); const before = structuredClone(g.state);
  assert.equal(g.completeVideo(2).ok, false); assert.deepEqual(g.state, before);
  g.act({ type: 'forceEvent', eventId: 'harsh_leader' });
  assert.equal(g.completeVideo(1).ok, false);
  g.resolveEvent('clarify'); g.completeVideo(1); g.chooseEnding('truth');
  assert.equal(g.completeVideo(1).ok, false);
  const classic = chapters(); delete classic[0].presentation;
  const old = game(classic);
  assert.equal(old.completeVideo(1).ok, false);
  assert.deepEqual(old.getAvailableChoices(), []);
});

test('video choices preserve explicit resource and story flag requirements', () => {
  const data = chapters();
  data[0].choices[0].requiresFlags = { consent: true };
  data[0].choices[0].requires = { money: 60, flags: { witness: true } };
  const g = game(data); g.completeVideo(1);
  assert.equal(g.getAvailableChoices().length, 0);
  g.state.flags.consent = true; g.state.flags.witness = true;
  assert.equal(g.chooseEnding('truth').ok, false);
  g.state.money = 60;
  assert.equal(g.getAvailableChoices().length, 1);
});

test('video records save and restore, chapter replay retains them, new game resets them', () => {
  const g = game();
  g.completeVideo(1); g.checkpoint('已观看');
  const restored = game(); assert.equal(restored.load(g.save().json).ok, true);
  assert.equal(restored.isVideoCompleted(), true);
  assert.equal(restored.state.videoDays, 1); assert.equal(restored.state.day, 2);
  assert.equal(restored.completeVideo(1).advancedDays, 0);
  restored.chooseEnding('truth'); restored.startChapter(2); restored.completeVideo(2);
  assert.equal(restored.startChapter(1, { replay: true }).ok, true);
  assert.deepEqual(restored.state.completedVideos, [1, 2]);
  assert.deepEqual(restored.state.clues, ['a', 'b']);
  assert.equal(restored.state.flags.puzzleSolved, false);
  restored.newGame(); assert.deepEqual(restored.state.completedVideos, []); assert.equal(restored.state.videoDays, 0);
  restored.completeVideo(1); restored.restoreCheckpoint();
  assert.equal(restored.isVideoCompleted(), false);
  assert.equal(restored.state.videoDays, 0); assert.equal(restored.state.day, 1);
  assert.equal(restored.completeVideo(1).advancedDays, 1);
});

test('older saves default missing video records without claiming videos were viewed', () => {
  const g = game(); const saved = g.save().data;
  for (const state of [saved.state, saved.checkpoint, ...Object.values(saved.chapterStarts)]) { delete state.completedVideos; delete state.videoDays; }
  assert.equal(g.load(saved).ok, true);
  assert.deepEqual(g.state.completedVideos, []);
  assert.equal(g.chooseEnding('truth').ok, false);
  assert.equal(g.state.videoDays, 0);
});

test('old viewed-video saves do not receive retroactive days or new event rolls', () => {
  const g = game(); g.completeVideo(1);
  const saved = g.save().data;
  for (const s of [saved.state, saved.checkpoint, ...Object.values(saved.chapterStarts)]) delete s.videoDays;
  assert.equal(g.load(saved).ok, true);
  assert.equal(g.state.completedDays, 0); assert.equal(g.state.day, 1);
  const before = structuredClone(g.state);
  assert.equal(g.completeVideo(1).advancedDays, 0);
  assert.deepEqual(g.state, before);
});

test('video crossing day 28 settles accrued salary once and schedules an unanswered monthly assessment', () => {
  const knowledge = [1, 2, 3].map(id => ({ id: `q${id}`, category: id === 3 ? '内分泌' : '内科', options: ['甲', '乙'], correctIndex: 0 }));
  const g = game(chapters(), { knowledge });
  g.state.actionCount = 136; g.act('rest');
  g.state.salary.accrued = 48; g.state.salary.workCount = 2; g.state.salary.penaltyChecked = true;
  const beforeMoney = g.state.money;
  const completed = g.completeVideo(1);
  assert.equal(g.state.actionCount, 137); assert.equal(g.state.completedDays, 28); assert.equal(g.state.dayPhaseIndex, 2);
  assert.equal(completed.salaryPayment.credited, 48); assert.equal(g.state.money, beforeMoney + 48);
  assert.equal(g.state.salary.month, 2); assert.equal(g.state.salary.penaltyChecked, false);
  assert.equal(g.getMonthlyAssessment().month, 1); assert.equal(g.getMonthlyAssessment().total, 3);
  assert.deepEqual(g.getAvailableChoices(), []);
  while (g.getMonthlyAssessment()) { const q = g.getMonthlyAssessment().question; g.answerMonthly(q.correctIndex, q.id); }
  assert.equal(g.completeVideo(1).advancedDays, 0); assert.equal(g.state.salaryPayments.length, 1);
  const restored = game(chapters(), { knowledge }); assert.equal(restored.load(g.save().json).ok, true);
  assert.equal(restored.state.day, 29); assert.equal(restored.state.dayPhaseIndex, 2);
});

test('video day records exhausted monthly bank as unavailable without a full-mark reward', () => {
  const g = game(); g.state.actionCount = 135;
  const completed = g.completeVideo(1);
  assert.equal(completed.assessmentUnavailable.status, 'unavailable');
  assert.equal(g.state.completedAssessments[0].total, 0);
  assert.equal(g.state.flags.monthlyAssessmentsCompleted, undefined);
  assert.equal(g.getMonthlyAssessment(), null); assert.equal(g.state.hp, 100);
});

test('a random video event and a due assessment coexist in event-first order', () => {
  const knowledge = [{ id: 'boundary', options: ['甲', '乙'], correctIndex: 0 }];
  const g = game(chapters(), { knowledge, rules: { statusEventProbability: 1 } });
  g.state.actionCount = 135;
  g.completeVideo(1);
  assert.ok(g.state.event); assert.equal(g.getMonthlyAssessment().blockedByEvent, true);
  assert.equal(g.answerMonthly(0, 'boundary').ok, false);
  assert.equal(g.completeVideo(1).ok, false); assert.equal(g.state.videoDays, 1);
  g.resolveEvent('continue');
  assert.equal(g.getMonthlyAssessment().blockedByEvent, false);
  assert.equal(g.answerMonthly(0, 'boundary').ok, true);
  assert.equal(g.getAvailableChoices().length, 1);
  assert.equal(g.completeVideo(1).advancedDays, 0);
});

test('video settles existing damage and recovery together once while preserving their fractional timers', () => {
  const g = game();
  for (const eventId of ['director_hostility', 'special_trait']) { g.act({ type: 'forceEvent', eventId }); g.resolveEvent('continue'); }
  g.act('rest'); g.act('rest');
  g.state.hp = 70;
  const completed = g.completeVideo(1);
  assert.equal(completed.statusEffectTicks.length, 2); assert.equal(g.state.hp, 68);
  assert.deepEqual(g.state.statusEffects.map(e => e.tickIn), [3, 3]);
  assert.deepEqual(g.state.statusEffects.map(e => e.remainingActions), [18, 8]);
  assert.deepEqual(g.state.statusEffects.map(e => e.ticksRemaining), [4, 2]);
  assert.equal(g.state.actionCount, 2); assert.equal(g.state.flags.restCount, 2);
});

test('a video day can end in status-effect death, with its day and cause retained in memorial', () => {
  const g = game(); g.act({ type: 'forceEvent', eventId: 'cyberbullying' }); g.resolveEvent('continue');
  g.state.hp = 7;
  const r = g.completeVideo(1);
  assert.equal(r.ok, true); assert.equal(r.advancedDays, 1); assert.equal(r.status, 'failure');
  assert.equal(g.isVideoCompleted(), true); assert.equal(g.state.failure.eventId, 'cyberbullying');
  assert.equal(g.state.day, 2); assert.equal(g.state.actionCount, 0);
  assert.equal(g.getMemorial().records[0].day, 2); assert.equal(g.getMemorial().records[0].causeId, 'cyberbullying');
  assert.equal(r.triggeredEvents.length, 0); assert.equal(g.state.event, null);
});

test('one first video produces at most one ambient event and new status starts after acknowledgment', () => {
  const g = game(chapters(), { rules: { statusEventProbability: 1, recoveryEventProbability: 1 } });
  const r = g.completeVideo(1);
  assert.equal(r.triggeredEvents.length, 1); assert.equal(g.state.event.category, 'misfortune');
  assert.equal(g.state.hp, 100); assert.deepEqual(g.state.statusEffects, []);
  const duration = g.state.event.statusEffect.durationDays;
  g.resolveEvent('continue');
  assert.equal(g.state.statusEffects[0].remainingActions, duration * 5);
  assert.equal(g.state.statusEffects[0].tickIn, 5); assert.equal(g.state.hp, 100);
});

test('video can trigger the existing beneficial ambient pool without manufacturing work rewards or fatal work rolls', () => {
  const g = game(chapters(), { rules: { recoveryEventProbability: 1,
    fatalRisk: { work: 1, research: 1, politics: 1 } } });
  g.state.hp = 50;
  const r = g.completeVideo(1);
  assert.equal(r.triggeredEvents.length, 1); assert.equal(g.state.event.category, 'beneficial_over_time');
  assert.equal(g.state.hp, 50); assert.equal(g.state.status, 'playing');
  assert.equal(g.state.money, 50); assert.equal(g.state.salary.accrued, 0);
  assert.equal(g.state.salary.penaltyChecked, false);
  assert.equal(g.state.flags.workCount, undefined); assert.equal(g.state.flags.researchCount, undefined);
});

test('video low-health event obeys the existing threshold and cooldown expires with its elapsed day', () => {
  const g = game(chapters(), { rules: { lowHpEventChance: 1 } });
  g.state.hp = 29; g.state._belowHandled = true; g.state.cooldown = 2;
  const r = g.completeVideo(1);
  assert.equal(r.triggeredEvents.length, 1); assert.equal(g.state.event.category, 'misfortune');
  assert.equal(g.state.cooldown, 2); assert.equal(g.state.hp, 29);
});

test('video time crosses clinical-absence threshold once, without pretending a clinical action happened', () => {
  const g = game();
  for (let i = 0; i < 32; i++) g.act(i === 20 ? 'research' : 'rest');
  const r = g.completeVideo(1);
  assert.equal(r.clinicalAbsenceTriggered, true); assert.equal(g.state.clinicalIdleActions, 37);
  assert.equal(g.state.survivalActionCount, 0); assert.equal(g.state.actionCount, 32);
  assert.equal(g.state.flags.restCount, 31);
  assert.equal(g.completeVideo(1).advancedDays, 0);
  g.chooseEnding('truth'); g.startChapter(2);
  assert.equal(g.completeVideo(2).clinicalAbsenceTriggered, false);
  assert.equal(g.state.clinicalIdleActions, 42); assert.equal(g.state.survivalActionCount, 0);
  g.act('work'); assert.equal(g.state.clinicalIdleActions, 0); assert.equal(g.state.survivalActionCount, 1);
});

test('invalid saved video-day counters are rejected without changing the current game', () => {
  const g = game();
  for (const value of [-1, 1.5, '1']) {
    const saved = g.save().data; saved.state.videoDays = value;
    assert.equal(g.load(saved).ok, false); assert.equal(g.state.videoDays, 0);
  }
});
