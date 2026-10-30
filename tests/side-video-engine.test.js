'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('../src/engine');
const { createRunSession } = require('../src/run-session');
const source = [{ id: 1, title: '主线一', presentation: 'video', clues: [{ id: 'clue' }], choices: [{ id: 'end', effects: {} }] },
  { id: 2, title: '主线二', presentation: 'video', clues: [], choices: [{ id: 'end', effects: {} }] }];
const sideStories = [
  { id: 'side_a', npcId: 'friend', title: '同行上篇', requires: [] },
  { id: 'side_b', npcId: 'friend', title: '同行下篇', requires: ['side_a'] },
  { id: 'side_c', npcId: 'another', title: '另一位同行者', requires: [] },
];
const quietRules = { statusEventProbability: 0, recoveryEventProbability: 0,
  lowHpEventChance: 0, lowHpAdditionalChance: 0, salaryPenaltyProbability: 0,
  fatalRisk: { work: 0, research: 0, politics: 0 },
  beneficialRisk: { chief_duty_appointment: 0, national_grant_award: 0, record_speech_champion: 0 } };
const game = (options = {}) => createGame(source, { seed: 42, debug: true, sideStories, ...options, rules: { ...quietRules, ...(options.rules || {}) } });
const storage = () => { const m = new Map(); return { getItem: k => m.get(k) || null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }; };

test('side films advance one calendar day without completing main film, unlocking endings, or collecting clues', () => {
  const g = game();
  const before = structuredClone(g.state);
  const r = g.completeSideVideo('side_a');
  assert.equal(r.ok, true); assert.equal(r.sideStoryId, 'side_a');
  assert.equal(r.advancedDays, 1); assert.equal(r.elapsedUnits, 5);
  assert.equal(g.state.day, 2); assert.equal(g.state.videoDays, 1);
  assert.equal(g.state.survivalActionCount, 5); assert.equal(g.state.clinicalIdleActions, 5);
  for (const key of ['chapterId', 'actionCount', 'hp', 'energy', 'money', 'clues', 'allClues', 'completedVideos', 'chapterResults']) assert.deepEqual(g.state[key], before[key], key);
  assert.deepEqual(g.getAvailableChoices(), []);
  assert.equal(g.chooseEnding('end').ok, false);
  assert.deepEqual(g.getSideStories('friend').map(x => x.id), ['side_a', 'side_b']);
  const detached = g.getSideStories(); detached[0].requires.push('impossible');
  assert.equal(g.canPlaySideVideo('side_a'), true);
  const completed = structuredClone(g.state);
  assert.equal(g.completeSideVideo('side_a').alreadyCompleted, true);
  assert.deepEqual(g.state, completed);
});

test('unknown and out-of-order films are rejected without changing state; event, exam and ended game block completion', () => {
  const g = game(), before = structuredClone(g.state);
  assert.equal(g.canPlaySideVideo('side_b'), false);
  assert.equal(g.completeSideVideo('side_b').ok, false);
  assert.equal(g.completeSideVideo('not_a_story').ok, false);
  assert.deepEqual(g.state, before);
  g.completeSideVideo('side_a'); assert.equal(g.canPlaySideVideo('side_b'), true);
  g.act({ type: 'forceEvent', eventId: 'harsh_leader' });
  assert.equal(g.canPlaySideVideo('side_b'), false); assert.equal(g.completeSideVideo('side_b').ok, false);
  g.resolveEvent('clarify');
  g.state.monthlyAssessment = { month: 1, status: 'active', questionIds: ['q'], answers: [], purchasedHints: [], index: 0, total: 1, score: 0 };
  assert.equal(g.completeSideVideo('side_b').ok, false);
  g.state.monthlyAssessment = null;
  g.completeVideo(1); g.chooseEnding('end');
  assert.equal(g.completeSideVideo('side_b').ok, false);
  g.startChapter(2); assert.equal(g.completeSideVideo('side_b').ok, true);
});

test('side viewing settles ongoing damage and healing once, without creating a work action', () => {
  const g = game();
  for (const eventId of ['director_hostility', 'special_trait']) { g.act({ type: 'forceEvent', eventId }); g.resolveEvent('continue'); }
  g.act('rest'); g.act('rest'); g.state.hp = 70;
  const r = g.completeSideVideo('side_a');
  assert.equal(r.statusEffectTicks.length, 2); assert.equal(g.state.hp, 68);
  assert.deepEqual(g.state.statusEffects.map(e => e.tickIn), [3, 3]);
  assert.deepEqual(g.state.statusEffects.map(e => e.remainingActions), [18, 8]);
  assert.equal(g.state.actionCount, 2); assert.equal(g.state.salary.accrued, 0);
  assert.equal(g.state.flags.workCount, undefined);
});

test('one side film rolls one ambient event and death during its day keeps the existing memorial cause', () => {
  const random = game({ rules: { statusEventProbability: 1, recoveryEventProbability: 1 } });
  const event = random.completeSideVideo('side_a');
  assert.equal(event.triggeredEvents.length, 1); assert.equal(random.state.hp, 100);
  assert.equal(random.state.actionCount, 0); assert.deepEqual(random.state.statusEffects, []);
  const dying = game(); dying.act({ type: 'forceEvent', eventId: 'cyberbullying' }); dying.resolveEvent('continue'); dying.state.hp = 7;
  const r = dying.completeSideVideo('side_a');
  assert.equal(r.status, 'failure'); assert.equal(r.advancedDays, 1);
  assert.equal(dying.isSideVideoCompleted('side_a'), true);
  assert.equal(dying.getMemorial().records[0].causeId, 'cyberbullying');
  assert.equal(dying.getMemorial().records[0].day, 2);
  assert.equal(dying.isVideoCompleted(1), false);
});

test('side video day triggers month settlement and monthly questions exactly once', () => {
  const knowledge = [{ id: 'q', options: ['甲', '乙'], correctIndex: 0 }];
  const g = game({ knowledge }); g.state.actionCount = 135; g.state.salary.accrued = 48;
  const r = g.completeSideVideo('side_a');
  assert.equal(r.salaryPayment.credited, 48); assert.equal(g.state.completedDays, 28);
  assert.equal(g.state.actionCount, 135); assert.equal(g.state.money, 98);
  assert.equal(g.getMonthlyAssessment().question.id, 'q');
  assert.equal(g.completeSideVideo('side_b').ok, false);
  g.answerMonthly(0, 'q');
  const before = structuredClone(g.state);
  assert.equal(g.completeSideVideo('side_a').advancedDays, 0); assert.deepEqual(g.state, before);
});

test('side day counts toward clinical absence, not clinical work', () => {
  const g = game(); for (let i = 0; i < 32; i++) g.act(i === 20 ? 'research' : 'rest');
  const r = g.completeSideVideo('side_a');
  assert.equal(r.clinicalAbsenceTriggered, true); assert.equal(g.state.clinicalIdleActions, 37);
  assert.equal(g.state.survivalActionCount, 0); assert.equal(g.state.actionCount, 32);
  g.act('work'); assert.equal(g.state.clinicalIdleActions, 0);
});

test('checkpoints, saves and new games retain or roll back side viewing consistently with their calendar', () => {
  const g = game(); g.completeSideVideo('side_a'); g.checkpoint('上篇之后'); g.completeSideVideo('side_b');
  const restored = game(); assert.equal(restored.load(g.save().json).ok, true);
  assert.deepEqual(restored.state.completedSideVideos, ['side_a', 'side_b']); assert.equal(restored.state.videoDays, 2);
  restored.restoreCheckpoint();
  assert.deepEqual(restored.state.completedSideVideos, ['side_a']); assert.equal(restored.state.videoDays, 1);
  assert.equal(restored.state.hp, 50); assert.equal(restored.completeSideVideo('side_a').advancedDays, 0);
  assert.equal(restored.completeSideVideo('side_b').advancedDays, 1);
  restored.newGame(); assert.deepEqual(restored.state.completedSideVideos, []); assert.equal(restored.state.videoDays, 0);
});

test('legacy saves import with no invented side completions and invalid side IDs are rejected atomically', () => {
  const g = game(); g.completeVideo(1); const saved = g.save().data;
  for (const s of [saved.state, saved.checkpoint, ...Object.values(saved.chapterStarts)]) delete s.completedSideVideos;
  assert.equal(g.load(saved).ok, true); assert.deepEqual(g.state.completedSideVideos, []);
  assert.deepEqual(g.state.completedVideos, [1]); assert.equal(g.state.videoDays, 1);
  const before = structuredClone(g.state);
  saved.state.completedSideVideos = ['unknown_story'];
  assert.equal(g.load(saved).ok, false); assert.deepEqual(g.state, before);
});

test('NPC help uses viewed side stories instead of obsolete clue gates and pays once', () => {
  const npcs = [{ id: 'friend', name: '同行', quest: { title: '约定', cluesRequired: 99, requiresSideVideos: ['side_a', 'side_b'], reward: { trust: 2 } } }];
  const g = game({ npcs }), assist = { type: 'npc', npcId: 'friend', completeQuest: true };
  assert.equal(g.act(assist).ok, false); assert.equal(g.state.actionCount, 0);
  g.completeSideVideo('side_a'); assert.equal(g.act(assist).ok, false);
  g.completeSideVideo('side_b'); assert.equal(g.act(assist).questCompleted, true);
  assert.equal(g.state.trust, 2); assert.equal(g.state.actionCount, 1);
  assert.equal(g.state.flags.npc_done_friend, true); assert.deepEqual(g.state.clues, []);
  const before = structuredClone(g.state); assert.equal(g.act(assist).ok, false); assert.deepEqual(g.state, before);
});

test('run session tracks side time for medals and rank, queues only first completion, and resumes online', async () => {
  const s = storage(), server = game({ debug: false }), operations = []; let seq = 0;
  const reply = () => ({ ok: true, runId: 'side-run', seed: 42, seq, saveData: server.save().data, questionHistory: [] });
  const transport = async p => {
    if (p.action === 'startRun' || p.action === 'getRun') return reply();
    assert.equal(p.action, 'appendOperations'); assert.equal(p.expectedSeq, seq);
    for (const op of p.operations) { operations.push(op); assert.equal(server.completeSideVideo(op.sideStoryId).ok, true); seq++; }
    return reply();
  };
  const config = { enabled: true, envId: 'test-env' }, options = { storage: s, sideStories, rules: quietRules };
  const run = createRunSession(source, options, config, transport); await run.start();
  assert.equal(run.game.completeSideVideo('side_b').ok, false);
  assert.equal(run.game.completeSideVideo('side_a').ok, true);
  assert.equal(run.game.completeSideVideo('side_a').alreadyCompleted, true);
  await run.leaderboard.retryPendingOperations();
  assert.deepEqual(operations, [{ method: 'completeSideVideo', sideStoryId: 'side_a' }]);
  assert.equal(run.leaderboard.getState().local.currentBest.longest.score, 5);
  assert.equal(run.medals.getState().progress.noRestCount, 5);
  assert.deepEqual(run.medals.getState().collections.puzzleChapterIds, []);
  const resumed = createRunSession(source, options, config, transport); assert.equal((await resumed.resume()).ok, true);
  assert.equal(resumed.game.isSideVideoCompleted('side_a'), true);
  assert.equal(resumed.game.isVideoCompleted(1), false); assert.equal(resumed.game.state.videoDays, 1);
  assert.equal(resumed.game.completeSideVideo('side_a').alreadyCompleted, true);
  assert.equal(resumed.medals.getState().progress.noRestCount, 5);
});
