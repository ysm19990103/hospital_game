'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame, FATAL_EVENTS, BENEFICIAL_EVENTS } = require('../src/engine');

function chapters() {
  return [1, 2, 3].map((id) => ({
    id, title: `第${id}章`,
    clues: [
      { id: 'a', title: '病历', text: '医院线索', room: 'hospital' },
      { id: 'b', title: '门后', text: '异界线索', room: 'other', flags: { familyBetrayalForeshadowed: true } },
    ],
    puzzle: { question: '哪一项？', options: ['甲', '乙'], correctIndex: 1, explanation: '依据已连接。' },
    choices: [
      { id: 'leave', label: '离开', requiresClues: 0, effects: {}, ending: { title: '暂别', text: '继续。', tone: 'neutral' } },
      { id: 'truth', label: '揭示', requiresClues: 2, requiresPuzzle: true, effects: { trust: 4, insight: 8 }, flags: { choseTruth: true }, ending: { title: '真相', text: '明白了。', tone: 'truth' } },
    ],
  }));
}

const safeRules = {
  fatalRisk: { work: 0, research: 0, politics: 0 },
  beneficialRisk: { chief_duty_appointment: 0, national_grant_award: 0, record_speech_champion: 0 },
  lowHpEventChance: 0, lowHpAdditionalChance: 0,
  salaryPenaltyProbability: 0,
  statusEventProbability: 0,
  recoveryEventProbability: 0,
};
function game(extra = {}) {
  // Affordability fixtures start at zero explicitly; production starts at 50.
  return createGame(chapters(), { seed: 42, debug: true, ...extra, rules: { initialMoney: 0, ...safeRules, ...(extra.rules || {}) } });
}
function resolveWithoutRecovery(g) {
  g.act({ type: 'forceEvent', eventId: 'harsh_leader' });
  g.resolveEvent('clarify');
}

test('initial state, fixed threshold, and serializable schema', () => {
  const g = createGame(chapters(), { seed: 42, debug: true, rules: safeRules });
  assert.equal(g.state.chapterId, 1);
  assert.equal(g.state.hp, 100);
  assert.equal(g.state.energy, 80);
  assert.equal(g.state.money, 50);
  g.state.money = 7; g.newGame(); assert.equal(g.state.money, 50);
  assert.equal(g.rules.threshold, 30);
  assert.equal(g.getChapter().title, '第1章');
  assert.ok(g.state.checkpointLabel);
  assert.doesNotThrow(() => JSON.stringify(g.state));
});

test('HP exactly 30 is safe; first crossing below 30 guarantees a normal event', () => {
  const g = game();
  g.state.hp = 30;
  g.act({ type: 'travel', room: 'other' });
  assert.equal(g.state.event, null);
  g.act({ type: 'work' });
  assert.equal(g.state.hp, 26);
  assert.equal(g.state.event.category, 'misfortune');
  assert.equal(g.state.status, 'playing');
});

test('two complete effective actions after resolution are protected, third can roll', () => {
  const g = game({ rules: { ...safeRules, lowHpEventChance: 1 } });
  g.state.hp = 25;
  resolveWithoutRecovery(g);
  assert.equal(g.state.cooldown, 2);
  g.act({ type: 'travel', room: 'other' });
  assert.equal(g.state.event, null);
  assert.equal(g.state.cooldown, 1);
  g.act({ type: 'travel', room: 'hospital' });
  assert.equal(g.state.event, null);
  assert.equal(g.state.cooldown, 0);
  g.act({ type: 'travel', room: 'other' });
  assert.ok(g.state.event);
});

test('invalid actions and visual movement cost no time and do not tick cooldown', () => {
  const g = game();
  g.state.cooldown = 2;
  const before = JSON.stringify(g.state);
  assert.equal(g.act({ type: 'move', x: 3 }).ok, true);
  assert.equal(g.act({ type: 'inspect', clueId: 'missing' }).ok, false);
  assert.equal(g.act({ type: 'travel', room: 'hospital' }).ok, false);
  assert.equal(JSON.stringify(g.state), before);
});

test('pending events block normal actions; unavailable event responses stay locked', () => {
  const g = game();
  g.act({ type: 'forceEvent', eventId: 'harsh_leader' });
  const before = JSON.stringify(g.state);
  assert.equal(g.act({ type: 'rest' }).ok, false);
  assert.equal(g.resolveEvent('seek_help').ok, false);
  assert.equal(JSON.stringify(g.state), before);
  assert.equal(g.resolveEvent('clarify').ok, true);
});

for (const [id, definition] of Object.entries(FATAL_EVENTS).filter(([,definition]) => definition.cause === 'instant_fatal')) {
  test(`${id} directly fails independently of full HP`, () => {
    const g = game();
    g.act({ type: 'forceEvent', eventId: id });
    assert.equal(g.state.hp, 100);
    assert.equal(g.state.status, 'failure');
    assert.equal(g.state.failure.id, id);
    assert.equal(g.state.failure.cause, 'instant_fatal');
    assert.equal(g.state.failure.actionType, definition.actionType);
    assert.equal(g.state.event, null);
    assert.equal(g.act({ type: 'rest' }).ok, false);
  });
  test(`${id} can arise from the matching ordinary action above the threshold`, () => {
    const g = game({ rules: { ...safeRules, fatalRisk: { ...safeRules.fatalRisk, [definition.actionType]: 1 } } });
    g.act({ type: definition.actionType });
    assert.equal(g.state.status, 'failure');
    assert.equal(g.state.failure.id, id);
    assert.ok(g.state.hp > 30);
  });
}

test('debug event injection is disabled by default', () => {
  const g = createGame(chapters(), { seed: 1 });
  const before = JSON.stringify(g.state);
  assert.equal(g.act({ type: 'forceEvent', eventId: 'record_failure' }).ok, false);
  assert.equal(JSON.stringify(g.state), before);
});

test('preparation lowers a risk without exemption and cannot be farmed', () => {
  const g = createGame(chapters(), { seed: 42 });
  g.state.money = 5;
  const riskBefore = g.getRisks().work.probability;
  assert.equal(g.act({ type: 'prepare', kind: 'record' }).ok, true);
  assert.ok(g.getRisks().work.probability > 0);
  assert.ok(g.getRisks().work.probability < riskBefore);
  const before = JSON.stringify(g.state);
  assert.equal(g.act({ type: 'prepare', kind: 'record' }).ok, false);
  assert.equal(JSON.stringify(g.state), before);
});

test('energy overdraft becomes additional HP damage', () => {
  const g = game();
  g.state.energy = 2;
  g.act({ type: 'work' });
  assert.equal(g.state.energy, 0);
  assert.equal(g.state.hp, 82); // 4 action damage + 14 energy deficit
  assert.ok(g.state.log.some((entry) => entry.type === 'exhaustion'));
});

test('HP zero is a separate failure route', () => {
  const g = game();
  g.state.hp = 5; g.state.energy = 0;
  g.act({ type: 'travel', room: 'other' });
  assert.equal(g.state.hp, 0);
  assert.equal(g.state.failure.cause, 'hp_zero');
  assert.equal(g.state.event, null);
});

test('resource values clamp and recovery remains available without money', () => {
  const g = game();
  g.state.hp = 99; g.state.energy = 99; g.state.money = 0;
  g.act({ type: 'rest' });
  assert.equal(g.state.hp, 100); assert.equal(g.state.energy, 100); assert.equal(g.state.money, 0);
  g.state.money = 99998; g.state.trust = 100;
  g.state.actionCount = 139;
  g.act({ type: 'work' });
  assert.equal(g.state.money, 99999); assert.equal(g.state.trust, 100);
});

test('restoration clears failure, restores node resources, and changes future RNG', () => {
  const g = game();
  g.act({ type: 'inspect', clueId: 'a' });
  g.checkpoint('线索之后');
  const atNode = structuredClone(g.state);
  g.act({ type: 'forceEvent', eventId: 'grant_failure' });
  assert.equal(g.restoreCheckpoint().ok, true);
  assert.equal(g.state.hp, 50); assert.equal(g.state.energy, atNode.energy);
  assert.deepEqual(g.state.clues, atNode.clues);
  assert.equal(g.state.failure, null); assert.equal(g.state.event, null); assert.equal(g.state.status, 'playing');
  assert.notEqual(g.state._rng, atNode._rng);
  const firstRestoreRng = g.state._rng;
  g.act({ type: 'forceEvent', eventId: 'grant_failure' });
  g.restoreCheckpoint();
  assert.notEqual(g.state._rng, firstRestoreRng);
});

test('low-HP checkpoint restoration restores half HP without immediate ordinary-event loop', () => {
  const g = game({ rules: { ...safeRules, lowHpEventChance: 1 } });
  g.state.hp = 20;
  g.checkpoint('险境');
  g.act({ type: 'forceEvent', eventId: 'record_failure' });
  g.restoreCheckpoint();
  assert.equal(g.state.hp, 50); assert.equal(g.state.event, null);
  g.act({ type: 'travel', room: 'other' });
  assert.equal(g.state.event, null);
  g.act({ type: 'travel', room: 'hospital' });
  assert.equal(g.state.event, null);
});

test('save/load preserves complete state, checkpoints, and deterministic continuation', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  const first = game({ storage });
  first.act({ type: 'inspect', clueId: 'a' }); first.checkpoint('调查后'); first.act({ type: 'travel', room: 'other' });
  assert.equal(first.save().ok, true);
  const second = game({ seed: 99, storage });
  assert.equal(second.load().ok, true);
  assert.deepEqual(second.state, first.state);
  first.act({ type: 'work' }); second.act({ type: 'work' });
  assert.deepEqual(second.state, first.state);
  first.restoreCheckpoint(); second.restoreCheckpoint();
  assert.deepEqual(second.state, first.state);
});

test('failed-state save can load and recover through its preserved checkpoint', () => {
  const g = game();
  g.act({ type: 'forceEvent', eventId: 'faction_failure' });
  const saved = g.save().json;
  const restored = game();
  assert.equal(restored.load(saved).ok, true);
  assert.equal(restored.state.status, 'failure');
  assert.equal(restored.restoreCheckpoint().ok, true);
  assert.equal(restored.state.status, 'playing');
});

test('malformed saves and storage errors preserve the current game', () => {
  const g = game(); const before = JSON.stringify(g.state);
  assert.equal(g.load('{bad').ok, false);
  assert.equal(g.load({ version: 1, state: { chapterId: 999 } }).ok, false);
  assert.equal(JSON.stringify(g.state), before);
  const broken = game({ storage: { setItem() { throw new Error('quota'); } } });
  assert.equal(broken.save().ok, false);
  const refused = game({ storage: { getItem: () => null, setItem: () => false } });
  assert.equal(refused.save().ok, false);
  assert.match(refused.save().message, /拒绝/);
});

test('chapter clues, puzzle, and branch conditions are enforced', () => {
  const g = game();
  assert.deepEqual(g.getAvailableChoices().map((c) => c.id), ['leave']);
  assert.equal(g.chooseEnding('truth').ok, false);
  assert.equal(g.act({ type: 'inspect', clueId: 'b' }).ok, false);
  g.act({ type: 'inspect', clueId: 'a' });
  assert.equal(g.act({ type: 'inspect', clueId: 'a' }).ok, false);
  g.act({ type: 'travel', room: 'other' }); g.act({ type: 'inspect', clueId: 'b' });
  assert.equal(g.act({ type: 'puzzle', answer: 0 }).correct, false);
  assert.equal(g.act({ type: 'puzzle', answer: '乙' }).correct, true);
  assert.deepEqual(g.getAvailableChoices().map((c) => c.id), ['leave', 'truth']);
  assert.equal(g.chooseEnding('truth').ok, true);
  assert.equal(g.state.status, 'chapter_end');
  assert.equal(g.state.flags.choseTruth, true);
  assert.equal(g.state.chapterResults['1'].choiceId, 'truth');
});

test('chapters unlock in order and retain persistent resources', () => {
  const g = game();
  assert.equal(g.startChapter(3).ok, false);
  g.act({ type: 'inspect', clueId: 'a' });
  const energy = g.state.energy;
  g.chooseEnding('leave');
  assert.equal(g.startChapter(2).ok, true);
  assert.equal(g.state.energy, energy);
  assert.deepEqual(g.state.clues, []);
  assert.deepEqual(g.state.allClues, ['1:a']);
  g.chooseEnding('leave'); g.startChapter(3); g.chooseEnding('leave');
  assert.equal(g.state.status, 'complete');
  assert.equal(g.state.finalEnding.completedChapters, 3);
  assert.equal(g.state.endings.length, 3);
});

test('replaying starts at the historical chapter node and discards future route, preserving collected endings', () => {
  const g = game();
  g.chooseEnding('leave'); g.startChapter(2); g.chooseEnding('leave'); g.startChapter(3); g.chooseEnding('leave');
  assert.equal(g.startChapter(1, { replay: true }).ok, true);
  assert.equal(g.state.chapterId, 1); assert.equal(g.state.hp, 50);
  assert.deepEqual(g.state.chapterResults, {});
  assert.equal(g.state.endings.length, 3);
  assert.equal(g.startChapter(3, { replay: true }).ok, false);
});

test('same seeds and action sequence produce identical outcomes', () => {
  const a = createGame(chapters(), { seed: 'stable' });
  const b = createGame(chapters(), { seed: 'stable' });
  for (const action of [{ type: 'work' }, { type: 'rest' }, { type: 'research' }, { type: 'politics' }]) {
    assert.deepEqual(a.act(action), b.act(action));
    assert.deepEqual(a.state, b.state);
  }
});

test('family betrayal needs foreshadowing; hospital encounters do not appear in the other world', () => {
  for (let seed = 1; seed <= 12; seed += 1) {
    const g = game({ seed });
    g.state.room = 'other'; g.state.hp = 29;
    g.act({ type: 'inspect', clueId: 'b' }); // this clue establishes family foreshadowing
    assert.ok(['health_crisis', 'family_betrayal', 'cyberbullying'].includes(g.state.event.id));
    const h = game({ seed });
    h.state.room = 'other'; h.state.hp = 29;
    h.act({ type: 'puzzle', answer: 1 });
    assert.ok(['health_crisis', 'cyberbullying'].includes(h.state.event.id));
  }
});

for (const id of Object.keys(BENEFICIAL_EVENTS)) {
  test(`${id} immediately restores only HP and retains prior consequences`, () => {
    const g = game();
    g.act({ type: 'inspect', clueId: 'a' });
    g.state.hp = 12; g.state.energy = 17; g.state.trust = -8; g.state.money = 41;
    g.state.flags.earlierChoice = 'refuse';
    const before = structuredClone(g.state);
    g.act({ type: 'forceEvent', eventId: id });
    assert.equal(g.state.hp, 100);
    assert.equal(g.state.energy, 17); assert.equal(g.state.money, 41); assert.equal(g.state.trust, -8);
    assert.deepEqual(g.state.clues, before.clues); assert.deepEqual(g.state.allClues, before.allClues);
    assert.equal(g.state.flags.earlierChoice, 'refuse'); assert.equal(g.state.time, before.time);
    assert.equal(g.state.status, 'playing'); assert.equal(g.state.failure, null);
    assert.equal(g.state.event.category, 'beneficial'); assert.equal(g.state.event.id, id);
    assert.equal(g.getRisks().misfortune.belowThreshold, false);
    g.state.hp = 84; // prove acknowledgement does not reapply the heal
    assert.equal(g.resolveEvent('continue').ok, true);
    assert.equal(g.state.hp, 84); assert.equal(g.state.energy, 17);
    assert.equal(g.state.event, null);
  });
}

test('beneficial events occur on eligible actions and are independent of low HP', () => {
  const cases = [
    ['chief_duty_appointment', { type: 'work' }],
    ['chief_duty_appointment', { type: 'politics' }],
    ['national_grant_award', { type: 'research' }],
    ['record_speech_champion', { type: 'work' }],
    ['record_speech_champion', { type: 'prepare', kind: 'record' }],
  ];
  for (const [id, action] of cases) {
    const g = game({ rules: { ...safeRules, beneficialRisk: { ...safeRules.beneficialRisk, [id]: 1 } } });
    g.state.hp = 70;
    if (action.type === 'prepare') g.state.money = 5;
    g.act(action);
    assert.equal(g.state.event.id, id);
    assert.equal(g.state.hp, 100);
    assert.ok(g.state.energy < 80);
    assert.equal(g.state.failure, null);
  }
});

test('fatal and beneficial event slots are mutually exclusive in the same action', () => {
  const g = game({ rules: {
    ...safeRules,
    fatalRisk: { ...safeRules.fatalRisk, work: 1 },
    beneficialRisk: { ...safeRules.beneficialRisk, chief_duty_appointment: 1, record_speech_champion: 1 },
  } });
  g.act({ type: 'work' });
  assert.equal(g.state.status, 'failure'); assert.equal(g.state.failure.id, 'record_failure');
  assert.equal(g.state.hp, 96); assert.equal(g.state.event, null);
  assert.equal(g.state.flags.received_chief_duty_appointment, undefined);
});

test('a beneficial event clears threshold danger without also opening a misfortune', () => {
  const g = game({ rules: {
    ...safeRules, lowHpEventChance: 1,
    beneficialRisk: { ...safeRules.beneficialRisk, national_grant_award: 1 },
  } });
  g.state.hp = 20;
  g.act({ type: 'research' });
  assert.equal(g.state.hp, 100); assert.equal(g.state.event.category, 'beneficial');
  assert.equal(g.state.event.id, 'national_grant_award'); assert.equal(g.state.failure, null);
  assert.ok(g.state.log.some((entry) => entry.type === 'beneficial' && entry.text.includes('精力')));
});

test('a pending beneficial notice can be saved and acknowledged after loading', () => {
  const g = game(); g.act({ type: 'forceEvent', eventId: 'national_grant_award' });
  const restored = game();
  assert.equal(restored.load(g.save().json).ok, true);
  assert.equal(restored.state.event.category, 'beneficial');
  assert.equal(restored.resolveEvent('continue').ok, true);
  assert.equal(restored.state.hp, 100);
});

const npcs = [{
  id: 'colleague', name: '值班同事',
  quest: { title: '核对两处记录', cluesRequired: 2, reward: { trust: 4, insight: 2, money: 10 }, flags: { helpedColleague: true } },
}];
const knowledge = [{
  id: 'knowledge_one', question: '教学题', options: ['甲', '乙', '丙'], correctIndex: 1,
  explanation: '这是测试用解析。',
}];

test('NPC and clinical actions reject missing catalogs without inventing content or spending resources', () => {
  const g = game(); const before = JSON.stringify(g.state);
  assert.equal(g.act({ type: 'npc', npcId: 'colleague' }).ok, false);
  assert.equal(g.act({ type: 'clinical', questionId: 'knowledge_one', answer: 1 }).ok, false);
  assert.equal(JSON.stringify(g.state), before);
});

test('NPC conversations spend one period and three energy and can trigger low-HP misfortune', () => {
  const g = game({ npcs });
  const outcome = g.act({ type: 'npc', npcId: 'colleague' });
  assert.equal(outcome.ok, true); assert.equal(outcome.consumedTime, 1);
  assert.equal(g.state.energy, 77); assert.equal(g.state.time, 1);
  assert.equal(g.state.flags.npc_talks_colleague, 1);
  g.state.hp = 29;
  g.act({ type: 'npc', npcId: 'colleague' });
  assert.equal(g.state.event.category, 'misfortune');
});

test('NPC quests enforce clue requirements and grant catalog rewards once per run across chapters', () => {
  const g = game({ npcs: { npcs } });
  const before = JSON.stringify(g.state);
  assert.equal(g.act({ type: 'npc', npcId: 'colleague', completeQuest: true }).ok, false);
  assert.equal(JSON.stringify(g.state), before);
  g.act({ type: 'inspect', clueId: 'a' }); g.act({ type: 'travel', room: 'other' }); g.act({ type: 'inspect', clueId: 'b' });
  const moneyBefore = g.state.money;
  assert.equal(g.act({ type: 'npc', npcId: 'colleague', completeQuest: true }).questCompleted, true);
  assert.equal(g.state.flags.npc_done_colleague, true);
  assert.equal(g.state.flags.helpedColleague, true); assert.equal(g.state.trust, 4);
  assert.equal(g.state.money, moneyBefore + 10);
  const after = JSON.stringify(g.state);
  assert.equal(g.act({ type: 'npc', npcId: 'colleague', completeQuest: true }).ok, false);
  assert.equal(JSON.stringify(g.state), after);
  g.chooseEnding('leave'); g.startChapter(2);
  const nextChapter = JSON.stringify(g.state);
  assert.equal(g.act({ type: 'npc', npcId: 'colleague', completeQuest: true }).ok, false);
  assert.equal(JSON.stringify(g.state), nextChapter);
});

test('NPC default quest requirement is two clues', () => {
  const g = game({ npcs: [{ id: 'default', quest: { reward: { trust: 1 } } }] });
  const response = g.act({ type: 'npc', npcId: 'default', completeQuest: true });
  assert.equal(response.ok, false); assert.equal(response.cluesRequired, 2);
});

test('first correct teaching answer consumes one period and five energy and rewards insight once', () => {
  const g = game({ knowledge: { questions: knowledge } });
  const first = g.act({ type: 'clinical', questionId: 'knowledge_one', answer: 1 });
  assert.equal(first.ok, true); assert.equal(first.correct, true); assert.equal(first.review, false);
  assert.equal(first.explanation, knowledge[0].explanation);
  assert.equal(g.state.time, 1); assert.equal(g.state.energy, 75); assert.equal(g.state.hp, 100);
  assert.equal(g.state.insight, 1); assert.equal(g.state.flags.knowledgeCorrect, 1);
  assert.equal(g.state.flags.knowledge_knowledge_one, 1);
  const beforeReview = JSON.stringify(g.state);
  const review = g.act({ type: 'clinical', questionId: 'knowledge_one', answer: 0 });
  assert.equal(review.review, true); assert.equal(review.recordedAnswer, 1); assert.equal(review.correct, true);
  assert.equal(JSON.stringify(g.state), beforeReview);
});

test('wrong teaching answers have no direct HP penalty and remain available as free review', () => {
  const g = game({ knowledge });
  const first = g.act({ type: 'clinical', questionId: 'knowledge_one', answer: 0 });
  assert.equal(first.correct, false); assert.equal(first.explanation, knowledge[0].explanation);
  assert.equal(g.state.hp, 100); assert.equal(g.state.insight, 0);
  assert.equal(g.state.flags.knowledgeCorrect, undefined);
  g.state.hp = 20; g.state.cooldown = 2;
  const before = JSON.stringify(g.state);
  assert.equal(g.act({ type: 'clinical', questionId: 'knowledge_one' }).review, true);
  assert.equal(JSON.stringify(g.state), before);
});

test('clinical invalid answers cost nothing; first valid answers participate in ordinary misfortune only', () => {
  const g = game({ knowledge });
  const before = JSON.stringify(g.state);
  assert.equal(g.act({ type: 'clinical', questionId: 'knowledge_one', answer: 99 }).ok, false);
  assert.equal(JSON.stringify(g.state), before);
  g.state.hp = 29;
  const answered = g.act({ type: 'clinical', questionId: 'knowledge_one', answer: 1 });
  assert.equal(answered.correct, true); assert.equal(g.state.event.category, 'misfortune');
  assert.equal(g.state.failure, null);
});

test('all actual video chapters expose every branch after viewing with required research and finish without exploration', () => {
  const actualChapters = require('../data/chapters.json').map((chapter) => ({ ...chapter, presentation: 'video' }));
  assert.ok(actualChapters.length >= 29);
  const g = createGame(actualChapters, { seed: 'full-video-story-quiet-events', rules: safeRules });
  for (const [index, chapter] of actualChapters.entries()) {
    assert.equal(g.state.chapterId, chapter.id);
    assert.deepEqual(g.getAvailableChoices(), []);
    if (g.getResearchDeadline().remainingUnits <= 5) { g.act('research'); g.act('rest'); }
    assert.equal(g.completeVideo(chapter.id).ok, true);
    assert.equal(g.state.clues.length, chapter.clues.length);
    assert.equal(g.getAvailableChoices().length, 3);
    const choice = g.getAvailableChoices().sort((a, b) =>
      ((b.effects.hp || 0) + (b.effects.energy || 0)) - ((a.effects.hp || 0) + (a.effects.energy || 0)))[0];
    assert.equal(g.chooseEnding(choice.id).ok, true);
    assert.notEqual(g.state.status, 'failure');
    if (index < actualChapters.length - 1) assert.equal(g.startChapter(actualChapters[index + 1].id).ok, true);
  }
  assert.equal(g.state.status, 'complete');
  assert.equal(Object.keys(g.state.chapterResults).length, actualChapters.length);
  assert.equal(g.state.completedVideos.length, actualChapters.length);
  assert.equal(g.state.allClues.length, actualChapters.reduce((count,c) => count + c.clues.length, 0));
  assert.equal(g.state.flags.totalPuzzlesSolved, undefined);
  assert.ok(g.state.actionCount > 0);
  assert.equal(g.state.videoDays, actualChapters.length);
  assert.equal(g.state.day, actualChapters.length + Math.floor(g.state.actionCount / 5) + 1);
  assert.ok(g.state.hp > 0);
});


const monthlyQuestions = [
  { id: 'm1', category: '内科', question: '内科题一', options: ['甲', '乙'], correctIndex: 0, explanation: '内科解析一' },
  { id: 'm2', category: '内科', question: '内科题二', options: ['甲', '乙'], correctIndex: 1, explanation: '内科解析二' },
  { id: 'e1', category: '内分泌', question: '内分泌题一', options: ['甲', '乙'], correctIndex: 0, explanation: '内分泌解析一' },
  { id: 'e2', category: '内分泌', question: '内分泌题二', options: ['甲', '乙'], correctIndex: 1, explanation: '内分泌解析二' },
];
function advanceNonClinicalActions(g, count) {
  // Long-running calendar fixtures still fulfil the new research obligation.
  for (let i = 0; i < count; i += 1) assert.equal(g.act({ type: g.state.researchIdleUnits >= 20 ? 'research' : 'rest' }).ok, true);
}
function completeMonthlyCorrectly(g) {
  while (g.getMonthlyAssessment()) {
    const exam = g.getMonthlyAssessment();
    assert.equal(g.answerMonthly(exam.question.correctIndex, exam.question.id).ok, true);
  }
}

test('five effective actions complete a game day regardless of accumulated time', () => {
  const g = game({ knowledge: monthlyQuestions });
  assert.equal(g.state.day, 1); assert.equal(g.state.completedDays, 0); assert.equal(g.state.dayPhase, '晨');
  advanceNonClinicalActions(g, 4);
  assert.equal(g.state.day, 1); assert.equal(g.state.dayPhaseIndex, 4); assert.equal(g.state.dayPhase, '深夜');
  assert.equal(g.state.time, 8);
  g.act({ type: 'move' }); g.act({ type: 'inspect', clueId: 'absent' }); g.getChapter();
  assert.equal(g.state.actionCount, 4);
  advanceNonClinicalActions(g, 1);
  assert.equal(g.state.actionCount, 5); assert.equal(g.state.day, 2); assert.equal(g.state.completedDays, 1);
  assert.equal(g.state.dayPhaseIndex, 0); assert.equal(g.state.dayPhase, '晨'); assert.equal(g.state.time, 10);
});

test('140 and 280 effective actions trigger successive mandatory assessments with both categories', () => {
  const g = game({ knowledge: monthlyQuestions });
  advanceNonClinicalActions(g, 139);
  assert.equal(g.getMonthlyAssessment(), null);
  advanceNonClinicalActions(g, 1);
  const first = g.getMonthlyAssessment();
  assert.equal(first.month, 1); assert.equal(first.total, 3); assert.equal(g.state.day, 29);
  assert.equal(new Set(first.questionIds).size, 3);
  const categories = first.questionIds.map((id) => monthlyQuestions.find((q) => q.id === id).category);
  assert.ok(categories.includes('内科')); assert.ok(categories.includes('内分泌'));
  const beforeBlockedAction = JSON.stringify(g.state);
  assert.equal(g.act({ type: 'rest' }).ok, false); assert.equal(g.chooseEnding('leave').ok, false);
  assert.deepEqual(g.getAvailableChoices(), []);
  assert.equal(JSON.stringify(g.state), beforeBlockedAction);
  completeMonthlyCorrectly(g);
  assert.equal(g.state.actionCount, 140); assert.equal(g.state.time, 280);
  assert.equal(g.state.completedAssessments[0].score, 3);
  advanceNonClinicalActions(g, 140);
  assert.equal(g.getMonthlyAssessment().month, 2); assert.equal(g.state.completedDays, 56);
  completeMonthlyCorrectly(g);
  assert.equal(g.state.completedAssessments.length, 2); assert.equal(g.state.actionCount, 280);
});

test('monthly answers are ordered, charge 10 HP when wrong, and reject duplicate question submissions', () => {
  const g = game({ knowledge: monthlyQuestions }); advanceNonClinicalActions(g, 140);
  const first = g.getMonthlyAssessment();
  const wrong = 1 - first.question.correctIndex;
  const answered = g.answerMonthly(wrong, first.question.id);
  assert.equal(answered.correct, false); assert.equal(answered.hpLoss, 10); assert.equal(g.state.hp, 90);
  assert.equal(answered.explanation, first.question.explanation);
  assert.equal(g.state.monthlyAssessment.index, 1); assert.equal(g.state.actionCount, 140); assert.equal(g.state.time, 280);
  const beforeDuplicate = JSON.stringify(g.state);
  assert.equal(g.answerMonthly(wrong, first.question.id).ok, false);
  assert.equal(JSON.stringify(g.state), beforeDuplicate);
  assert.equal(g.answerMonthly(99, g.getMonthlyAssessment().question.id).ok, false);
  completeMonthlyCorrectly(g);
  assert.equal(g.state.completedAssessments[0].score, 2);
  assert.equal(g.state.completedAssessments[0].answers.length, 3);
  assert.equal(g.answerMonthly(0).ok, false);
});

test('monthly HP loss can cause failure, and a key-node restore resumes its saved assessment', () => {
  const g = game({ knowledge: monthlyQuestions }); advanceNonClinicalActions(g, 140);
  g.state.hp = 5;
  assert.equal(g.checkpoint('月考开始').ok, true);
  const first = g.getMonthlyAssessment();
  const answer = g.answerMonthly(1 - first.question.correctIndex, first.question.id);
  assert.equal(answer.ok, true); assert.equal(g.state.hp, 0);
  assert.equal(g.state.failure.actionType, 'monthly_assessment'); assert.equal(g.state.status, 'failure');
  assert.equal(g.state.monthlyAssessment.status, 'failed');
  assert.equal(g.restoreCheckpoint().ok, true);
  assert.equal(g.state.hp, 50); assert.equal(g.getMonthlyAssessment().index, 1);
  assert.deepEqual(g.getMonthlyAssessment().questionIds, first.questionIds);
  assert.equal(g.getMonthlyAssessment().answers[0].correct, false);
  assert.equal(g.getMonthlyAssessment().answers[0].fromHistory, true);
  assert.equal(g.isQuestionAnswered(first.question.id), true);
  completeMonthlyCorrectly(g);
  assert.equal(g.state.hp, 50); assert.equal(g.state.status, 'playing');
});

test('normal events and fatal outcomes take presentation priority over a newly due assessment', () => {
  const g = game({ knowledge: monthlyQuestions, npcs });
  g.state.actionCount = 139; g.state.hp = 29;
  g.act({ type: 'npc', npcId: 'colleague' });
  assert.ok(g.state.event); assert.equal(g.getMonthlyAssessment().blockedByEvent, true);
  const first = g.getMonthlyAssessment();
  assert.equal(g.answerMonthly(first.question.correctIndex, first.question.id).ok, false);
  const response = g.state.event.choices.find((choice) => choice.available !== false);
  assert.equal(g.resolveEvent(response.id).ok, true);
  assert.equal(g.state.actionCount, 140); assert.equal(g.getMonthlyAssessment().blockedByEvent, false);
  completeMonthlyCorrectly(g);
  const fatal = game({ knowledge: monthlyQuestions, rules: { ...safeRules, fatalRisk: { ...safeRules.fatalRisk, work: 1 } } });
  fatal.state.actionCount = 139; fatal.act({ type: 'work' });
  assert.equal(fatal.state.status, 'failure'); assert.equal(fatal.state.failure.id, 'record_failure');
  assert.equal(fatal.getMonthlyAssessment().blockedByFailure, true);
  assert.equal(fatal.answerMonthly(0).ok, false);
});

test('a monthly answer crossing the threshold schedules one event without an extra low-HP lottery per answer', () => {
  const source = chapters(); source[0].allowedEvents = ['harsh_leader'];
  const g = createGame(source, { seed: 42, knowledge: monthlyQuestions, rules: { ...safeRules, lowHpEventChance: 1 } });
  advanceNonClinicalActions(g, 140); g.state.hp = 35;
  let exam = g.getMonthlyAssessment();
  g.answerMonthly(1 - exam.question.correctIndex, exam.question.id);
  assert.equal(g.state.hp, 25); assert.equal(g.state.event.id, 'harsh_leader');
  assert.equal(g.resolveEvent('clarify').ok, true);
  exam = g.getMonthlyAssessment();
  g.answerMonthly(1 - exam.question.correctIndex, exam.question.id);
  assert.equal(g.state.hp, 15); assert.equal(g.state.event, null);
  exam = g.getMonthlyAssessment();
  g.answerMonthly(1 - exam.question.correctIndex, exam.question.id);
  assert.equal(g.state.hp, 5); assert.equal(g.state.event, null); assert.equal(g.getMonthlyAssessment(), null);
  assert.equal(g.state.actionCount, 140); assert.equal(g.state.cooldown, 2);
});

test('monthly assessment uses only available questions and supports a configurable wrong-answer penalty', () => {
  const g = game({ knowledge: [monthlyQuestions[0]], rules: { ...safeRules, assessmentWrongHpLoss: 7 } });
  advanceNonClinicalActions(g, 140);
  assert.equal(g.getMonthlyAssessment().total, 1); assert.equal(g.getMonthlyAssessment().wrongHpLoss, 7);
  g.answerMonthly(1, 'm1');
  assert.equal(g.state.hp, 93); assert.equal(g.getMonthlyAssessment(), null);
  const noCatalog = game(); advanceNonClinicalActions(noCatalog, 140);
  assert.equal(noCatalog.getMonthlyAssessment(), null);
  assert.equal(noCatalog.state.completedAssessments[0].status, 'unavailable');
  assert.equal(noCatalog.state.completedAssessments[0].questionIds.length, 0);
  assert.equal(noCatalog.act({ type: 'rest' }).ok, true);
});

test('reading an already answered teaching question stays free during a mandatory monthly assessment', () => {
  const g = game({ knowledge: monthlyQuestions });
  g.act({ type: 'clinical', questionId: 'm1', answer: 0 }); advanceNonClinicalActions(g, 139);
  const before = JSON.stringify(g.state);
  assert.equal(g.act({ type: 'clinical', questionId: 'm1' }).review, true);
  assert.equal(JSON.stringify(g.state), before);
});

test('version 2 saves preserve a partially answered monthly assessment and its node', () => {
  const g = game({ knowledge: monthlyQuestions }); advanceNonClinicalActions(g, 140);
  const first = g.getMonthlyAssessment(); g.answerMonthly(first.question.correctIndex, first.question.id);
  g.checkpoint('月考第二题');
  const save = g.save(); assert.equal(save.data.version, 2);
  const loaded = game({ knowledge: monthlyQuestions, seed: 999 });
  assert.equal(loaded.load(save.json).ok, true); assert.deepEqual(loaded.state, g.state);
  assert.equal(loaded.getMonthlyAssessment().index, 1);
  const current = loaded.getMonthlyAssessment(); loaded.answerMonthly(1 - current.question.correctIndex, current.question.id);
  assert.equal(loaded.restoreCheckpoint().ok, true);
  assert.equal(loaded.getMonthlyAssessment().index, 2); assert.equal(loaded.state.hp, 50);
  completeMonthlyCorrectly(loaded); assert.equal(loaded.state.completedAssessments[0].score, 2);
  assert.equal(loaded.state.completedAssessments[0].total, 3);
  assert.deepEqual(loaded.state.completedAssessments[0].skippedQuestionIds, [current.question.id]);
});

test('legacy saves gain a consistent action-based calendar without retroactive missed exams', () => {
  const old = game(); advanceNonClinicalActions(old, 150); const legacy = old.save().data; legacy.version = 1;
  for (const value of [legacy.state, legacy.checkpoint, ...Object.values(legacy.chapterStarts)]) {
    for (const key of ['day', 'completedDays', 'dayPhaseIndex', 'dayPhase', 'monthlyAssessment', 'completedAssessments', '_lastAssessmentMonth']) delete value[key];
  }
  const loaded = game({ knowledge: monthlyQuestions });
  assert.equal(loaded.load(legacy).ok, true);
  assert.equal(loaded.state.day, 31); assert.equal(loaded.state.completedDays, 30);
  assert.equal(loaded.getMonthlyAssessment(), null); assert.equal(loaded.state._lastAssessmentMonth, 1);
  advanceNonClinicalActions(loaded, 130);
  assert.equal(loaded.getMonthlyAssessment().month, 2);
});

test('game calendar never reads the real clock', () => {
  const originalDateNow = Date.now;
  try {
    Date.now = () => { throw new Error('Real clock must not be consulted'); };
    const g = game({ knowledge: monthlyQuestions }); advanceNonClinicalActions(g, 140);
    completeMonthlyCorrectly(g);
    assert.equal(g.state.day, 29); assert.equal(g.state.completedDays, 28);
    assert.equal(g.save().ok, true);
  } finally { Date.now = originalDateNow; }
});

test('with a configurable zero starting balance, work pays a small stipend and separately accrues monthly wages', () => {
  const g = game();
  assert.equal(g.state.money, 0);
  const before = JSON.stringify(g.state);
  assert.equal(g.act({ type: 'prepare', kind: 'record' }).ok, false);
  assert.equal(JSON.stringify(g.state), before);
  const worked = g.act({ type: 'work' });
  assert.equal(worked.ok, true); assert.equal(g.state.money, 3); assert.equal(worked.stipendCredited, 3);
  assert.equal(g.getSalary().accrued, 24); assert.equal(worked.wagesAccrued, 24);
  assert.match(worked.message, /应发工资增加 24 金币.*28 个游戏日/);
  assert.ok(g.state.log.some((entry) => /应发工资增加 24 金币/.test(entry.text)));
  g.newGame();
  assert.equal(g.state.money, 0);
  assert.equal(g.getSalary().accrued, 0);
});

test('monthly hint purchase charges once per current question without advancing time, calendar or RNG', () => {
  const g = game({ knowledge: monthlyQuestions }); advanceNonClinicalActions(g, 140);
  g.state.money = 15;
  const exam = g.getMonthlyAssessment();
  assert.equal(exam.hasHint, false); assert.equal(exam.hintCost, 5);
  const before = structuredClone(g.state);
  const bought = g.buyMonthlyHint(exam.question.id);
  assert.equal(bought.ok, true); assert.equal(bought.charged, 5); assert.equal(bought.alreadyPurchased, false);
  assert.deepEqual(bought.question, exam.question); assert.equal(g.state.money, 10);
  assert.equal(g.getMonthlyAssessment().hasHint, true);
  assert.deepEqual(g.state.monthlyAssessment.purchasedHints, [exam.question.id]);
  for (const key of ['actionCount', 'time', 'day', 'completedDays', 'dayPhaseIndex', 'dayPhase', 'hp', 'energy', 'cooldown', '_rng']) assert.equal(g.state[key], before[key]);
  const beforeRevisit = JSON.stringify(g.state);
  const revisited = g.buyMonthlyHint(exam.question.id);
  assert.equal(revisited.ok, true); assert.equal(revisited.charged, 0); assert.equal(revisited.alreadyPurchased, true);
  assert.equal(JSON.stringify(g.state), beforeRevisit);
  g.answerMonthly(exam.question.correctIndex, exam.question.id);
  assert.equal(g.getMonthlyAssessment().hasHint, false);
  assert.equal(g.buyMonthlyHint(g.getMonthlyAssessment().question.id).charged, 5);
});

test('monthly hints reject noncurrent questions, inactive exams, pending events and failed games without side effects', () => {
  const g = game({ knowledge: monthlyQuestions });
  let before = JSON.stringify(g.state);
  assert.equal(g.buyMonthlyHint('m1').ok, false); assert.equal(JSON.stringify(g.state), before);
  advanceNonClinicalActions(g, 140); g.state.money = 20;
  const current = g.getMonthlyAssessment(); before = JSON.stringify(g.state);
  assert.equal(g.buyMonthlyHint(current.questionIds[1]).ok, false);
  assert.equal(g.buyMonthlyHint().ok, false); assert.equal(JSON.stringify(g.state), before);
  g.state.event = { id: 'harsh_leader', category: 'misfortune', choices: [] };
  before = JSON.stringify(g.state);
  assert.equal(g.buyMonthlyHint(current.question.id).ok, false); assert.equal(JSON.stringify(g.state), before);
  g.state.event = null; g.state.status = 'failure';
  before = JSON.stringify(g.state);
  assert.equal(g.buyMonthlyHint(current.question.id).ok, false); assert.equal(JSON.stringify(g.state), before);
  g.state.status = 'playing'; completeMonthlyCorrectly(g);
  before = JSON.stringify(g.state);
  assert.equal(g.buyMonthlyHint(current.question.id).ok, false); assert.equal(JSON.stringify(g.state), before);
});

test('insufficient coins do not buy a hint or prevent directly answering the assessment', () => {
  const g = game({ knowledge: monthlyQuestions }); advanceNonClinicalActions(g, 140);
  assert.equal(g.state.money, 0);
  const exam = g.getMonthlyAssessment(); const before = JSON.stringify(g.state);
  const declined = g.buyMonthlyHint(exam.question.id);
  assert.equal(declined.ok, false); assert.equal(declined.charged, 0);
  assert.equal(JSON.stringify(g.state), before);
  assert.equal(g.answerMonthly(exam.question.correctIndex, exam.question.id).ok, true);
  assert.equal(g.state.monthlyAssessment.index, 1); assert.equal(g.state.money, 0);
});

test('hint purchases survive saves, and restoring the earlier node restores both coins and purchase state', () => {
  const storage = new Map();
  const g = game({ knowledge: monthlyQuestions, storage }); advanceNonClinicalActions(g, 140); g.state.money = 12;
  g.checkpoint('提示购买前'); const exam = g.getMonthlyAssessment();
  assert.equal(g.buyMonthlyHint(exam.question.id).charged, 5);
  assert.equal(g.save().ok, true);
  const restored = game({ knowledge: monthlyQuestions, storage });
  assert.equal(restored.load().ok, true); assert.equal(restored.state.money, 7);
  assert.equal(restored.getMonthlyAssessment().hasHint, true);
  assert.equal(restored.buyMonthlyHint(exam.question.id).charged, 0);
  assert.equal(restored.restoreCheckpoint().ok, true);
  assert.equal(restored.state.money, 12); assert.equal(restored.getMonthlyAssessment().hasHint, false);
  assert.equal(restored.buyMonthlyHint(exam.question.id).charged, 5);
  assert.equal(restored.state.money, 7);
});

test('hint price is configurable and older assessment saves normalize missing purchases', () => {
  const g = game({ knowledge: monthlyQuestions, rules: { ...safeRules, assessmentHintCost: 3 } });
  advanceNonClinicalActions(g, 140); g.state.money = 3;
  assert.equal(g.getMonthlyAssessment().hintCost, 3);
  assert.equal(g.buyMonthlyHint(g.getMonthlyAssessment().question.id).charged, 3);
  const legacy = g.save().data;
  for (const value of [legacy.state, legacy.checkpoint, ...Object.values(legacy.chapterStarts)]) {
    if (value.monthlyAssessment) delete value.monthlyAssessment.purchasedHints;
  }
  const restored = game({ knowledge: monthlyQuestions });
  assert.equal(restored.load(legacy).ok, true);
  assert.deepEqual(restored.getMonthlyAssessment().purchasedHints, []);
  assert.equal(restored.getMonthlyAssessment().hasHint, false);
  assert.equal(restored.state.money, 0);
});

test('entertainment spends ten earned coins and restores HP and energy in one effective action', () => {
  const g = game(); g.state.actionCount = 139; g.act({ type: 'work' });
  g.state.hp = 60; g.state.energy = 45;
  const before = structuredClone(g.state);
  const enjoyed = g.act({ type: 'entertain' });
  assert.equal(enjoyed.ok, true); assert.equal(enjoyed.charged, 10); assert.equal(enjoyed.consumedTime, 1);
  assert.equal(g.state.money, 17); assert.equal(g.state.hp, 80); assert.equal(g.state.energy, 65);
  assert.equal(enjoyed.hpRestored, 20); assert.equal(enjoyed.energyRestored, 20);
  assert.equal(g.state.actionCount, before.actionCount + 1); assert.equal(g.state.time, before.time + 1);
  assert.equal(g.state.flags.entertainCount, 1);
});

test('unaffordable entertainment is rejected without any mutation while zero-coin basic rest remains available', () => {
  const g = game(); g.state.hp = 60; g.state.energy = 35; g.state.cooldown = 2;
  let before = JSON.stringify(g.state);
  assert.equal(g.act({ type: 'entertain' }).ok, false); assert.equal(JSON.stringify(g.state), before);
  g.state.money = 9; before = JSON.stringify(g.state);
  assert.equal(g.act({ type: 'entertain' }).ok, false); assert.equal(JSON.stringify(g.state), before);
  g.state.money = 0;
  assert.equal(g.act({ type: 'rest' }).ok, true);
  assert.equal(g.state.money, 0); assert.equal(g.state.hp, 74); assert.equal(g.state.energy, 70);
});

test('entertainment gains and cost are configurable, clamp resources, and do not roll fatal work events', () => {
  const g = game({ rules: { ...safeRules, entertainCost: 4, entertainHpGain: 35, entertainEnergyGain: 45,
    fatalRisk: { work: 1, research: 1, politics: 1 } } });
  g.state.money = 4; g.state.hp = 90; g.state.energy = 80;
  const rng = g.state._rng;
  const enjoyed = g.act({ type: 'entertain' });
  assert.equal(enjoyed.ok, true); assert.equal(enjoyed.charged, 4); assert.equal(g.state.money, 0);
  assert.equal(g.state.hp, 100); assert.equal(g.state.energy, 100);
  assert.equal(enjoyed.hpRestored, 10); assert.equal(enjoyed.energyRestored, 20);
  assert.equal(g.state.status, 'playing'); assert.equal(g.state.failure, null); assert.equal(g.state._rng, rng);
});

test('entertainment participates in the low-HP event and action-based monthly calendar systems', () => {
  const g = game({ knowledge: monthlyQuestions });
  g.state.actionCount = 139; g.state.hp = 5; g.state.money = 10;
  const enjoyed = g.act({ type: 'entertain' });
  assert.equal(enjoyed.ok, true); assert.equal(g.state.hp, 25); assert.equal(g.state.money, 0);
  assert.equal(g.state.event.category, 'misfortune'); assert.equal(g.state.failure, null);
  assert.equal(g.state.actionCount, 140); assert.equal(g.state.day, 29);
  assert.equal(g.getMonthlyAssessment().month, 1); assert.equal(g.getMonthlyAssessment().blockedByEvent, true);
});

test('salary is paid at 140 actions before the assessment and the boundary work belongs to the ending month', () => {
  const g = game({ knowledge: monthlyQuestions, rules: { ...safeRules, restCost: 0 } });
  advanceNonClinicalActions(g, 139);
  assert.equal(g.getSalary().month, 1); assert.equal(g.state.salaryPayments.length, 0);
  const worked = g.act({ type: 'work' });
  assert.equal(g.state.actionCount, 140); assert.equal(g.state.money, 27);
  assert.equal(worked.salaryPayment.month, 1); assert.equal(worked.salaryPayment.accrued, 24);
  assert.equal(worked.salaryPayment.amount, 24); assert.equal(worked.salaryPayment.credited, 24);
  assert.equal(worked.salaryPayment.paidDay, 28); assert.equal(worked.salaryPayment.paidAtAction, 140);
  assert.deepEqual(g.getSalary(), { month: 2, accrued: 0, reduced: false, rate: 1, workCount: 0, penaltyChecked: false });
  assert.equal(g.getMonthlyAssessment().month, 1);
  assert.ok(g.state.log.findIndex((entry) => entry.type === 'salary_payment') < g.state.log.findIndex((entry) => entry.type === 'assessment'));
  assert.equal(g.buyMonthlyHint(g.getMonthlyAssessment().question.id).ok, true);
  assert.equal(g.state.money, 22);
  completeMonthlyCorrectly(g);
  g.act({ type: 'work' }); advanceNonClinicalActions(g, 139);
  assert.equal(g.state.salaryPayments.length, 2); assert.equal(g.state.salaryPayments[1].month, 2);
  assert.equal(g.state.salaryPayments[1].amount, 24); assert.equal(g.state.money, 49);
  assert.equal(g.getSalary().month, 3); assert.equal(g.getMonthlyAssessment().month, 2);
});

test('salary penalty halves the entire month once, does not block play, and resets next month', () => {
  const g = game({ rules: { ...safeRules, salaryPenaltyProbability: 1, restCost: 0 } });
  const first = g.act({ type: 'work' });
  assert.equal(first.salaryPenaltyTriggered, true); assert.equal(g.state.event, null); assert.equal(g.state.status, 'playing');
  assert.equal(g.getSalary().rate, 0.5); assert.equal(g.getSalary().reduced, true);
  const second = g.act({ type: 'work' });
  assert.equal(second.salaryPenaltyTriggered, false); assert.equal(g.getSalary().accrued, 48);
  assert.equal(g.getSalary().rate, 0.5); assert.equal(g.getSalary().workCount, 2);
  assert.equal(g.state.log.filter((entry) => entry.type === 'salary_penalty').length, 1);
  advanceNonClinicalActions(g, 138);
  assert.equal(g.state.money, 30); assert.equal(g.state.salaryPayments[0].amount, 24);
  assert.equal(g.getSalary().rate, 1); assert.equal(g.getSalary().reduced, false);
  assert.equal(g.act({ type: 'work' }).salaryPenaltyTriggered, true);
});

test('salary penalties do not reduce story rewards and salary accrual carries across chapters', () => {
  const source = chapters(); source[0].choices[0].effects.money = 17;
  const g = createGame(source, { seed: 42, rules: { ...safeRules, salaryPenaltyProbability: 1, restCost: 0 } });
  g.act({ type: 'work' }); g.chooseEnding('leave'); g.startChapter(2);
  assert.equal(g.state.money, 70); assert.equal(g.getSalary().accrued, 24); assert.equal(g.getSalary().reduced, true);
  advanceNonClinicalActions(g, 139);
  assert.equal(g.state.money, 82); assert.equal(g.state.salaryPayments[0].amount, 12);
});

test('work wages are configurable and reduced wages round down only at month settlement', () => {
  const g = game({ rules: { ...safeRules, salaryPenaltyProbability: 1, workWage: 25, restCost: 0 } });
  assert.equal(g.rules.salaryPenaltyProbability, 1);
  g.act({ type: 'work' });
  assert.equal(g.getSalary().accrued, 25); assert.equal(g.state.money, 3);
  advanceNonClinicalActions(g, 139);
  assert.equal(g.state.money, 15); assert.equal(g.state.salaryPayments[0].accrued, 25);
  assert.equal(g.state.salaryPayments[0].amount, 12);
});

test('salary accrual and penalties persist in saves and nodes while legacy saves gain an empty current ledger', () => {
  const g = game({ rules: { ...safeRules, salaryPenaltyProbability: 1, restCost: 0 } });
  g.act({ type: 'work' }); g.checkpoint('工资记账后');
  const saved = g.save(); const restored = game();
  assert.equal(restored.load(saved.json).ok, true); assert.deepEqual(restored.getSalary(), g.getSalary());
  const copy = restored.getSalary(); copy.accrued = 999;
  assert.equal(restored.getSalary().accrued, 24);
  restored.act({ type: 'work' }); assert.equal(restored.getSalary().accrued, 48);
  restored.restoreCheckpoint(); assert.equal(restored.getSalary().accrued, 24); assert.equal(restored.getSalary().rate, 0.5);
  const legacy = g.save().data;
  legacy.state.actionCount = 150;
  for (const value of [legacy.state, legacy.checkpoint, ...Object.values(legacy.chapterStarts)]) {
    delete value.salary; delete value.salaryPayments;
  }
  assert.equal(restored.load(legacy).ok, true);
  assert.deepEqual(restored.getSalary(), { month: 2, accrued: 0, reduced: false, rate: 1, workCount: 0, penaltyChecked: false });
  assert.deepEqual(restored.state.salaryPayments, []);
});

test('rest recovery and coin cost can be balanced through rules without denying zero-coin recovery', () => {
  const g = game({ rules: { ...safeRules, restHpGain: 8, restEnergyGain: 25, restCost: 3 } });
  g.state.hp = 50; g.state.energy = 30; g.state.money = 2;
  assert.equal(g.act({ type: 'rest' }).ok, true);
  assert.equal(g.state.hp, 58); assert.equal(g.state.energy, 55); assert.equal(g.state.money, 0);
  assert.equal(g.act({ type: 'rest' }).ok, true);
  assert.equal(g.state.hp, 66); assert.equal(g.state.energy, 80); assert.equal(g.state.money, 0);
});

test('node and chapter replay recover half HP while load preserves actual HP and other node resources stay unchanged', () => {
  const g = game();
  g.act({ type: 'work' }); g.state.hp = 42; g.state.energy = 31; g.state.money = 9;
  g.chooseEnding('leave'); g.startChapter(2); g.checkpoint('第二章低血量节点');
  const node = structuredClone(g.state); const saved = g.save();
  const loaded = game();
  assert.equal(loaded.load(saved.json).ok, true); assert.equal(loaded.state.hp, 42);
  assert.deepEqual(loaded.state, node);
  loaded.state.hp = 4; loaded.state.energy = 1; loaded.state.money = 0;
  assert.equal(loaded.restoreCheckpoint().ok, true); assert.equal(loaded.state.hp, 50);
  for (const key of ['energy', 'money', 'time', 'actionCount']) assert.equal(loaded.state[key], node[key]);
  assert.deepEqual(loaded.getSalary(), node.salary); assert.deepEqual(loaded.state.clues, node.clues);
  loaded.state.hp = 7; loaded.state.energy = 2;
  assert.equal(loaded.startChapter(2, { replay: true }).ok, true);
  assert.equal(loaded.state.hp, 50); assert.equal(loaded.state.energy, 31); assert.equal(loaded.state.money, 9);
  assert.deepEqual(loaded.getSalary(), node.salary);
});

test('seven days without clinical work reset only current survival time once and do not kill the character', () => {
  const g = game();
  assert.equal(g.state.survivalActionCount, 0); assert.equal(g.state.clinicalIdleActions, 0);
  advanceNonClinicalActions(g, 34);
  assert.equal(g.state.survivalActionCount, 34); assert.equal(g.state.clinicalIdleActions, 34);
  const absent = g.act({ type: 'rest' });
  assert.equal(absent.clinicalAbsenceTriggered, true); assert.equal(g.state.survivalActionCount, 0);
  assert.equal(g.state.clinicalIdleActions, 35); assert.equal(g.state.status, 'playing'); assert.equal(g.state.event, null);
  assert.equal(g.state.actionCount, 35); assert.equal(g.state.day, 8); assert.equal(g.state.money, 0);
  advanceNonClinicalActions(g, 35);
  assert.equal(g.state.survivalActionCount, 0); assert.equal(g.state.clinicalIdleActions, 70);
  assert.equal(g.state.log.filter((entry) => entry.type === 'clinical_absence').length, 1);
  assert.equal(g.act({ type: 'work' }).clinicalAbsenceTriggered, false);
  assert.equal(g.state.survivalActionCount, 1); assert.equal(g.state.clinicalIdleActions, 0);
  advanceNonClinicalActions(g, 35);
  assert.equal(g.state.survivalActionCount, 0); assert.equal(g.state.log.filter((entry) => entry.type === 'clinical_absence').length, 2);
});

test('only work and first teaching answers reset clinical inactivity; free reviews, invalid actions and monthly answers do not', () => {
  const g = game({ knowledge: monthlyQuestions }); advanceNonClinicalActions(g, 34);
  g.act({ type: 'clinical', questionId: 'm1', answer: 1 });
  assert.equal(g.state.survivalActionCount, 35); assert.equal(g.state.clinicalIdleActions, 0);
  advanceNonClinicalActions(g, 34);
  const before = JSON.stringify(g.state);
  assert.equal(g.act({ type: 'clinical', questionId: 'm1' }).review, true);
  assert.equal(g.act({ type: 'clinical', questionId: 'm2', answer: 999 }).ok, false);
  assert.equal(g.act({ type: 'move' }).ok, true); g.getChapter();
  assert.equal(JSON.stringify(g.state), before);
  assert.equal(g.act({ type: 'rest' }).clinicalAbsenceTriggered, true);
  advanceNonClinicalActions(g, 70);
  const idle = g.state.clinicalIdleActions;
  completeMonthlyCorrectly(g);
  assert.equal(g.state.survivalActionCount, 0); assert.equal(g.state.clinicalIdleActions, idle);
});

test('restoring or replaying preserves the current survival and inactivity counters instead of undoing a penalty', () => {
  const g = game(); g.act({ type: 'work' }); g.checkpoint('临床行动之后');
  advanceNonClinicalActions(g, 35);
  assert.equal(g.state.survivalActionCount, 0); assert.equal(g.state.clinicalIdleActions, 35);
  assert.equal(g.restoreCheckpoint().ok, true);
  assert.equal(g.state.actionCount, 1); assert.equal(g.state.survivalActionCount, 0); assert.equal(g.state.clinicalIdleActions, 35);
  assert.equal(g.startChapter(1, { replay: true }).ok, true);
  assert.equal(g.state.actionCount, 0); assert.equal(g.state.survivalActionCount, 0); assert.equal(g.state.clinicalIdleActions, 35);
  g.act({ type: 'work' }); g.act({ type: 'rest' });
  assert.equal(g.state.survivalActionCount, 2); assert.equal(g.state.clinicalIdleActions, 1);
  g.act({ type: 'forceEvent', eventId: 'record_failure' });
  assert.equal(g.state.survivalActionCount, 2);
  g.restoreCheckpoint();
  assert.equal(g.state.survivalActionCount, 2); assert.equal(g.state.clinicalIdleActions, 1);
  g.newGame(); assert.equal(g.state.survivalActionCount, 0); assert.equal(g.state.clinicalIdleActions, 0);
});

test('survival counters save consistently and legacy saves inherit their action count without historical inactivity penalties', () => {
  const g = game(); g.act({ type: 'work' }); advanceNonClinicalActions(g, 4);
  const saved = g.save(); const loaded = game();
  assert.equal(loaded.load(saved.json).ok, true);
  assert.equal(loaded.state.survivalActionCount, 5); assert.equal(loaded.state.clinicalIdleActions, 4);
  const legacy = saved.data;
  for (const value of [legacy.state, legacy.checkpoint, ...Object.values(legacy.chapterStarts)]) {
    delete value.survivalActionCount; delete value.clinicalIdleActions;
  }
  assert.equal(loaded.load(legacy).ok, true);
  assert.equal(loaded.state.survivalActionCount, 5); assert.equal(loaded.state.clinicalIdleActions, 0);
});

function activateStatus(g, id) {
  assert.equal(g.act({ type: 'forceEvent', eventId: id }).ok, true);
  const before = g.state.hp;
  assert.equal(g.resolveEvent('continue').ok, true);
  assert.equal(g.state.hp, before, 'confirmation must not immediately change HP');
}
function statusGame(extra = {}) {
  return game({ rules: { ...safeRules, restHpGain: 0, restCost: 0 }, ...extra });
}

for (const [id, days, damage] of [['director_hostility', 5, 6], ['cyberbullying', 3, 8], ['senior_rules', 4, 7]]) {
  test(`${id} ticks after each five effective actions and expires after exactly ${days} game days`, () => {
    const g = statusGame(); activateStatus(g, id);
    const initial = g.getStatusEffects()[0];
    assert.equal(initial.remainingActions, days * 5); assert.equal(initial.tickIn, 5);
    assert.equal(initial.kind, 'damage'); assert.equal(initial.isBeneficial, false);
    advanceNonClinicalActions(g, 4); assert.equal(g.state.hp, 100); assert.equal(g.getStatusEffects()[0].tickIn, 1);
    advanceNonClinicalActions(g, 1); assert.equal(g.state.hp, 100 - damage);
    assert.equal(g.getStatusEffects()[0].remainingActions, (days - 1) * 5);
    advanceNonClinicalActions(g, (days - 1) * 5);
    assert.equal(g.state.hp, 100 - damage * days - (days === 5 ? 3 : 0)); assert.deepEqual(g.getStatusEffects(), []);
    assert.equal(g.state.log.filter((entry) => entry.type === 'status_tick').length, days);
    assert.equal(g.state.log.filter((entry) => entry.type === 'status_expired').length, 1);
  });
}

test('two negative ongoing effects coexist while a duplicate or third negative effect is blocked', () => {
  const g = statusGame(); activateStatus(g, 'director_hostility'); activateStatus(g, 'cyberbullying');
  const before = JSON.stringify(g.state);
  assert.equal(g.act({ type: 'forceEvent', eventId: 'director_hostility' }).ok, false);
  assert.equal(g.act({ type: 'forceEvent', eventId: 'senior_rules' }).ok, false);
  assert.equal(JSON.stringify(g.state), before);
  assert.equal(g.getStatusEffects().length, 2);
  const copy = g.getStatusEffects(); copy[0].remainingActions = 1;
  assert.equal(g.getStatusEffects()[0].remainingActions, 25);
  advanceNonClinicalActions(g, 5); assert.equal(g.state.hp, 86);
});

test('ongoing effect clocks ignore real time, menus, invalid actions, free reviews and monthly answers', () => {
  const originalDateNow = Date.now;
  try {
    Date.now = () => { throw new Error('ongoing effects must not use wall time'); };
    const g = statusGame({ knowledge: monthlyQuestions });
    g.act({ type: 'clinical', questionId: 'm1', answer: 0 });
    activateStatus(g, 'cyberbullying');
    const before = JSON.stringify(g.getStatusEffects());
    g.getChapter(); g.getStatusEffects(); g.getRisks(); g.act({ type: 'move' });
    g.act({ type: 'clinical', questionId: 'm1' }); g.act({ type: 'inspect', clueId: 'invalid' });
    assert.equal(JSON.stringify(g.getStatusEffects()), before);
    g.state.actionCount = 139; g.act({ type: 'rest' });
    const duringExam = JSON.stringify(g.getStatusEffects());
    completeMonthlyCorrectly(g);
    assert.equal(JSON.stringify(g.getStatusEffects()), duringExam);
    assert.equal(g.getStatusEffects()[0].remainingActions, 14);
  } finally { Date.now = originalDateNow; }
});

test('ongoing effects survive saves and nodes; restoring half HP does not clear or refresh their saved duration', () => {
  const g = statusGame(); activateStatus(g, 'director_hostility'); advanceNonClinicalActions(g, 4);
  g.state.hp = 42; g.checkpoint('持续压力中');
  const nodeEffects = g.getStatusEffects(); const saved = g.save();
  const restored = statusGame(); assert.equal(restored.load(saved.json).ok, true);
  assert.equal(restored.state.hp, 42); assert.deepEqual(restored.getStatusEffects(), nodeEffects);
  restored.act({ type: 'rest' }); assert.equal(restored.state.hp, 36);
  restored.restoreCheckpoint(); assert.equal(restored.state.hp, 50); assert.deepEqual(restored.getStatusEffects(), nodeEffects);
  restored.act({ type: 'rest' }); assert.equal(restored.state.hp, 44);
  const legacy = saved.data;
  for (const value of [legacy.state, legacy.checkpoint, ...Object.values(legacy.chapterStarts)]) delete value.statusEffects;
  assert.equal(restored.load(legacy).ok, true); assert.deepEqual(restored.getStatusEffects(), []);
});

test('high-HP status lottery uses one shared pool, respects cooldown, and excludes active or wrong-room effects', () => {
  const g = game({ rules: { ...safeRules, statusEventProbability: 1 } });
  g.state.room = 'other';
  g.act({ type: 'rest' }); assert.equal(g.state.event.id, 'cyberbullying'); g.resolveEvent('continue');
  advanceNonClinicalActions(g, 2); assert.equal(g.state.event, null); assert.equal(g.state.cooldown, 0);
  g.act({ type: 'rest' }); assert.equal(g.state.event, null, 'only eligible other-world status is already active');
  g.state.room = 'hospital'; g.act({ type: 'rest' });
  assert.ok(['director_hostility', 'senior_rules'].includes(g.state.event.id));
  const source = chapters(); source[0].allowedEvents = ['senior_rules'];
  const low = createGame(source, { seed: 42, rules: { ...safeRules, restHpGain: 0 } }); low.state.hp = 29;
  low.act({ type: 'rest' }); assert.equal(low.state.event.id, 'senior_rules');
});

test('fatal and instant positive events take precedence over new ongoing event lotteries', () => {
  const fatal = game({ rules: { ...safeRules, fatalRisk: { work: 1 }, statusEventProbability: 1, recoveryEventProbability: 1 } });
  fatal.act({ type: 'work' }); assert.equal(fatal.state.failure.id, 'record_failure'); assert.equal(fatal.state.event, null);
  const positive = game({ rules: { ...safeRules, beneficialRisk: { ...safeRules.beneficialRisk, national_grant_award: 1 }, statusEventProbability: 1, recoveryEventProbability: 1 } });
  positive.act({ type: 'research' }); assert.equal(positive.state.event.id, 'national_grant_award');
  assert.deepEqual(positive.getStatusEffects(), []);
});

for (const [id, category] of [['director_hostility', 'workplace'], ['senior_rules', 'workplace'], ['cyberbullying', 'other']]) {
  test(`${id} is recorded as the immediate cause only when its tick kills positive HP`, () => {
    const g = statusGame(); activateStatus(g, id); advanceNonClinicalActions(g, 4); g.state.hp = 5;
    g.act({ type: 'rest' });
    assert.equal(g.state.status, 'failure'); assert.equal(g.state.failure.eventId, id);
    assert.equal(g.state.failure.actionType, 'status_effect');
    const record = g.getMemorial().records[0];
    assert.equal(record.eventId, id); assert.equal(record.category, category);
    assert.match(record.causeTitle, /血量耗尽/);
  });
}

test('base action exhaustion death keeps its cause even when an ongoing damage tick was due', () => {
  const g = statusGame(); activateStatus(g, 'cyberbullying'); advanceNonClinicalActions(g, 4);
  g.state.hp = 5; g.state.energy = 0;
  g.act({ type: 'travel', room: 'other' });
  assert.equal(g.state.status, 'failure'); assert.equal(g.state.failure.actionType, 'travel');
  assert.equal(g.state.failure.eventId, undefined); assert.equal(g.getMemorial().records[0].category, 'overwork');
});

test('divine love heals four times, caps at maximum HP, never immediately heals and does not remove negative effects', () => {
  const g = statusGame(); g.state.hp = 60; activateStatus(g, 'divine_love');
  assert.equal(g.getStatusEffects()[0].kind, 'heal'); assert.equal(g.getStatusEffects()[0].isBeneficial, true);
  advanceNonClinicalActions(g, 4); assert.equal(g.state.hp, 60);
  advanceNonClinicalActions(g, 1); assert.equal(g.state.hp, 68);
  advanceNonClinicalActions(g, 15); assert.equal(g.state.hp, 92); assert.deepEqual(g.getStatusEffects(), []);
  const capped = statusGame(); capped.state.hp = 99;
  activateStatus(capped, 'director_hostility'); activateStatus(capped, 'divine_love');
  assert.equal(capped.getStatusEffects().length, 2);
  advanceNonClinicalActions(capped, 5); assert.equal(capped.state.hp, 100);
  assert.equal(capped.getStatusEffects().length, 2);
});

test('simultaneous healing and damage are merged before death so a net recovery cannot falsely kill', () => {
  const g = statusGame(); activateStatus(g, 'director_hostility'); activateStatus(g, 'divine_love');
  advanceNonClinicalActions(g, 4); g.state.hp = 5;
  const outcome = g.act({ type: 'rest' });
  assert.equal(g.state.hp, 7); assert.equal(g.state.status, 'playing'); assert.equal(g.getMemorial().total, 0);
  assert.equal(outcome.statusEffectTicks.length, 2);
  const lethal = statusGame();
  activateStatus(lethal, 'director_hostility'); activateStatus(lethal, 'cyberbullying'); activateStatus(lethal, 'divine_love');
  advanceNonClinicalActions(lethal, 4); lethal.state.hp = 5; lethal.act({ type: 'rest' });
  assert.equal(lethal.state.hp, 0); assert.equal(lethal.state.failure.eventId, 'cyberbullying');
  assert.equal(lethal.state.failure.directHpDelta, -6); assert.equal(lethal.getMemorial().records[0].category, 'other');
});

test('ongoing positive events share one lottery, exclude active copies and do not override negative events', () => {
  const g = game({ rules: { ...safeRules, recoveryEventProbability: 1 } });
  g.act({ type: 'rest' }); const firstId = g.state.event.id;
  assert.ok(['divine_love', 'special_trait'].includes(firstId)); assert.equal(g.state.event.category, 'beneficial_over_time');
  g.resolveEvent('continue');
  const before = JSON.stringify(g.state);
  assert.equal(g.act({ type: 'forceEvent', eventId: firstId }).ok, false); assert.equal(JSON.stringify(g.state), before);
  g.act({ type: 'rest' }); assert.notEqual(g.state.event.id, firstId); g.resolveEvent('continue');
  g.act({ type: 'rest' }); assert.equal(g.state.event, null); assert.equal(g.getStatusEffects().length, 2);
  const priority = game({ rules: { ...safeRules, statusEventProbability: 1, recoveryEventProbability: 1 } });
  priority.act({ type: 'rest' }); assert.equal(priority.state.event.category, 'misfortune');
});

test('monthly wage penalty is checked only on first work, survives saving, and is not rolled in empty months', () => {
  const unchecked = game();
  assert.equal(unchecked.getSalary().penaltyChecked, false);
  unchecked.act({ type: 'work' });
  assert.equal(unchecked.getSalary().penaltyChecked, true); assert.equal(unchecked.getSalary().reduced, false);
  const loaded = game({ rules: { ...safeRules, salaryPenaltyProbability: 1 } });
  assert.equal(loaded.load(unchecked.save().json).ok, true);
  const nextWork = loaded.act({ type: 'work' });
  assert.equal(nextWork.salaryPenaltyTriggered, false); assert.equal(loaded.getSalary().reduced, false);
  advanceNonClinicalActions(loaded, 138);
  assert.equal(loaded.getSalary().penaltyChecked, false);
  assert.equal(loaded.act({ type: 'work' }).salaryPenaltyTriggered, true);
  const empty = game({ rules: { ...safeRules, salaryPenaltyProbability: 1 } });
  const noPenaltyControl = game({ rules: { ...safeRules, salaryPenaltyProbability: 0 } });
  advanceNonClinicalActions(empty, 140); advanceNonClinicalActions(noPenaltyControl, 140);
  assert.equal(empty.state.salaryPayments[0].penaltyChecked, false);
  assert.equal(empty.state.salaryPayments[0].amount, 0); assert.equal(empty.state.money, 0);
  assert.equal(empty.state._rng, noPenaltyControl.state._rng);
  assert.equal(empty.act({ type: 'work' }).salaryPenaltyTriggered, true);
});

test('work stipends are immediate and independent of half-pay, while ordinary rest is free even with coins', () => {
  const g = game({ rules: { ...safeRules, salaryPenaltyProbability: 1, workStipend: 7 } });
  assert.equal(g.act({ type: 'work' }).stipendCredited, 7); assert.equal(g.getSalary().reduced, true);
  assert.equal(g.state.money, 7); assert.equal(g.getSalary().accrued, 24);
  assert.equal(g.act({ type: 'work' }).stipendCredited, 7); assert.equal(g.state.money, 14);
  g.act({ type: 'rest' }); assert.equal(g.state.money, 14); assert.equal(g.rules.restCost, 0);
  g.state.money = 99998;
  assert.equal(g.act({ type: 'work' }).stipendCredited, 1); assert.equal(g.state.money, 99999);
});

test('negative status cap removes the third kind from random candidates but does not consume the healing slot', () => {
  const g = game({ rules: { ...safeRules, statusEventProbability: 1 } });
  activateStatus(g, 'director_hostility'); activateStatus(g, 'cyberbullying'); g.state.cooldown = 0;
  g.act({ type: 'rest' }); assert.equal(g.state.event, null);
  assert.equal(g.act({ type: 'forceEvent', eventId: 'senior_rules' }).ok, false);
  activateStatus(g, 'divine_love');
  assert.equal(g.getStatusEffects().length, 3);
  assert.equal(g.getStatusEffects().filter((effect) => effect.kind === 'damage').length, 2);
  assert.equal(g.getStatusEffects().filter((effect) => effect.kind === 'heal').length, 1);
  const configured = game({ rules: { ...safeRules, maxNegativeStatusEffects: 1 } });
  activateStatus(configured, 'director_hostility');
  assert.equal(configured.act({ type: 'forceEvent', eventId: 'cyberbullying' }).ok, false);
  activateStatus(configured, 'divine_love'); assert.equal(configured.getStatusEffects().length, 2);
});

test('special trait heals four HP on exactly three game-day ticks and coexists with the other recovery', () => {
  const g = statusGame(); g.state.hp = 60;
  activateStatus(g, 'special_trait'); assert.equal(g.getStatusEffects()[0].remainingActions, 15);
  advanceNonClinicalActions(g, 4); assert.equal(g.state.hp, 60);
  advanceNonClinicalActions(g, 1); assert.equal(g.state.hp, 64);
  advanceNonClinicalActions(g, 10); assert.equal(g.state.hp, 72); assert.deepEqual(g.getStatusEffects(), []);
  const both = statusGame(); both.state.hp = 50;
  activateStatus(both, 'divine_love'); activateStatus(both, 'special_trait'); advanceNonClinicalActions(both, 5);
  assert.equal(both.state.hp, 62); assert.equal(both.getStatusEffects().length, 2);
  assert.equal(both.getStatusEffects().every((effect) => effect.isBeneficial), true);
});

test('new event occurrences are observable at trigger time and are not emitted again on acknowledgement or save/load', () => {
  const g = game({ occurrenceNamespace: 'test-run' });
  const triggered = g.act({ type: 'forceEvent', eventId: 'director_hostility' });
  assert.equal(triggered.triggeredEvents.length, 1);
  assert.equal(triggered.triggeredEvent.occurrenceId, 'test-run:1');
  assert.equal(triggered.triggeredEvent.title, '高层好像讨厌你呢');
  assert.equal(triggered.triggeredEvent.medalFamily, 'leadership'); assert.equal(triggered.triggeredEvent.isBeneficial, false);
  assert.equal(g.state.event.occurrenceId, triggered.triggeredEvent.occurrenceId);
  const saved = g.save(); assert.equal(saved.triggeredEvent, null);
  const restored = game({ occurrenceNamespace: 'fresh-session' });
  assert.equal(restored.load(saved.json).triggeredEvent, null);
  assert.equal(restored.state.event.occurrenceId, 'test-run:1');
  assert.deepEqual(restored.state.lastTriggeredEvent, triggered.triggeredEvent);
  assert.equal(restored.resolveEvent('continue').triggeredEvent, null);
  assert.equal(restored.getStatusEffects()[0].occurrenceId, 'test-run:1');
  assert.equal(restored.act({ type: 'move' }).triggeredEvent, null);
});

test('new occurrences remain distinct after node restoration, chapter replay, loading older saves and starting over', () => {
  const g = game({ occurrenceNamespace: 'run-sequence' }); const initial = g.save().json;
  const ids = [];
  ids.push(g.act({ type: 'forceEvent', eventId: 'harsh_leader' }).triggeredEvent.occurrenceId);
  g.resolveEvent('clarify'); assert.equal(g.restoreCheckpoint().triggeredEvent, null);
  ids.push(g.act({ type: 'forceEvent', eventId: 'harsh_leader' }).triggeredEvent.occurrenceId);
  g.resolveEvent('clarify'); assert.equal(g.startChapter(1, { replay: true }).triggeredEvent, null);
  ids.push(g.act({ type: 'forceEvent', eventId: 'harsh_leader' }).triggeredEvent.occurrenceId);
  g.load(initial);
  ids.push(g.act({ type: 'forceEvent', eventId: 'harsh_leader' }).triggeredEvent.occurrenceId);
  assert.equal(g.newGame().triggeredEvent, null);
  ids.push(g.act({ type: 'forceEvent', eventId: 'harsh_leader' }).triggeredEvent.occurrenceId);
  assert.equal(new Set(ids).size, 5); assert.deepEqual(ids, [1, 2, 3, 4, 5].map((n) => `run-sequence:${n}`));
  const other = game(); const another = game();
  assert.notEqual(other.act({ type: 'forceEvent', eventId: 'harsh_leader' }).triggeredEvent.occurrenceId,
    another.act({ type: 'forceEvent', eventId: 'harsh_leader' }).triggeredEvent.occurrenceId);
});

test('fatal random occurrences carry stable IDs linked to deaths while later status damage does not count as a new event', () => {
  const g = game({ occurrenceNamespace: 'fatal-sequence' });
  const fatal = g.act({ type: 'forceEvent', eventId: 'faction_failure' });
  assert.equal(fatal.triggeredEvent.id, 'faction_failure'); assert.equal(fatal.triggeredEvent.category, 'fatal');
  assert.equal(fatal.triggeredEvent.medalFamily, 'leadership');
  assert.equal(fatal.failure.occurrenceId, fatal.triggeredEvent.occurrenceId); assert.ok(fatal.failure.deathId);
  const saved = g.save(); const restored = game();
  assert.equal(restored.load(saved.json).triggeredEvent, null);
  assert.equal(restored.state.failure.occurrenceId, fatal.failure.occurrenceId);
  const pressure = statusGame(); activateStatus(pressure, 'director_hostility'); advanceNonClinicalActions(pressure, 4);
  const originalId = pressure.getStatusEffects()[0].occurrenceId; pressure.state.hp = 5;
  const death = pressure.act({ type: 'rest' });
  assert.equal(death.triggeredEvent, null); assert.equal(death.failure.occurrenceId, originalId);
});

test('a wage penalty and a fatal event in one action are both emitted in order for medal accounting', () => {
  const g = game({ occurrenceNamespace: 'combined', rules: { ...safeRules, salaryPenaltyProbability: 1, fatalRisk: { ...safeRules.fatalRisk, work: 1 } } });
  const action = g.act({ type: 'work' });
  assert.deepEqual(action.triggeredEvents.map((event) => event.id), ['salary_penalty', 'record_failure']);
  assert.deepEqual(action.triggeredEvents.map((event) => event.occurrenceId), ['combined:1', 'combined:2']);
  assert.equal(action.triggeredEvents[0].medalFamily, null);
  assert.equal(action.triggeredEvents[0].actionCount, 1); assert.equal(action.triggeredEvents[1].actionCount, 1);
  assert.equal(action.triggeredEvent.id, 'record_failure');
});

test('explicit occurrence namespaces produce stable replay IDs without changing gameplay RNG', () => {
  const a = game({ occurrenceNamespace: 'online-run' }); const b = game({ occurrenceNamespace: 'online-run' });
  for (const id of ['chief_duty_appointment', 'divine_love', 'special_trait']) {
    const aResult = a.act({ type: 'forceEvent', eventId: id });
    const bResult = b.act({ type: 'forceEvent', eventId: id });
    assert.deepEqual(aResult, bResult); assert.equal(aResult.triggeredEvent.isBeneficial, true);
    assert.match(aResult.triggeredEvent.occurrenceId, /^[A-Za-z0-9_:.-]{1,200}$/);
    a.resolveEvent('continue'); b.resolveEvent('continue');
  }
  assert.equal(a.state._rng, b.state._rng);
  assert.equal(a.rules.fatalRisk.work, 0); // the test fixture explicitly suppresses hazards
  const production = createGame(chapters());
  assert.deepEqual(production.rules.fatalRisk, { work: 0.125, research: 0.15, politics: 0.125 });
  assert.equal(production.rules.recoveryEventProbability, 0.01);
});
