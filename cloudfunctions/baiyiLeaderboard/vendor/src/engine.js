'use strict';

const { createMemorial, classifyDeath } = require('./memorial');
const { createQuestionHistory } = require('./question-history');
const DEFAULT_SIDE_STORIES = require('../data/side-stories.json');

/** Pure, synchronous game rules. No DOM, network, clock, or WeChat dependency.
 * `time` counts accumulated story periods; the calendar separately advances
 * one day for every five effective actions or each first-completed video.
 * `videoDays` keeps video time separate from actual action counts. Every 28 completed game days
 * schedules an assessment. Only the separate death memorial records real time;
 * it never influences the game calendar or random outcomes.
 */
const DEFAULT_RULES = Object.freeze({
  threshold: 30,
  maxHp: 100,
  maxEnergy: 100,
  initialEnergy: 80,
  initialMoney: 50,
  eventCooldown: 2,
  lowHpEventChance: 0.18,
  lowHpAdditionalChance: 0.32,
  exhaustionDamage: 1,
  fatalRisk: Object.freeze({ work: 0.125, research: 0.15, politics: 0.125 }),
  beneficialRisk: Object.freeze({ chief_duty_appointment: 0.012, national_grant_award: 0.015, record_speech_champion: 0.012 }),
  preparedRiskMultiplier: 0.3,
  assessmentQuestionCount: 3,
  assessmentWrongHpLoss: 10,
  assessmentHintCost: 5,
  entertainCost: 10,
  entertainHpGain: 20,
  entertainEnergyGain: 20,
  salaryPenaltyProbability: 0.15,
  workWage: 24,
  workStipend: 3,
  restHpGain: 14,
  restEnergyGain: 35,
  restCost: 0,
  directorHostilityHpPerTick: 6,
  cyberbullyingHpPerTick: 8,
  seniorRulesHpPerTick: 7,
  statusEventProbability: 0.02,
  restoreHpRatio: 0.5,
  divineLoveHpPerTick: 8,
  specialTraitHpPerTick: 4,
  recoveryEventProbability: 0.01,
  maxNegativeStatusEffects: 2,
});
const ACTIONS_PER_DAY = 5;
const CLINICAL_ABSENCE_DAYS = 7;
const CLINICAL_ABSENCE_UNITS = CLINICAL_ABSENCE_DAYS * ACTIONS_PER_DAY;
const RESEARCH_ABSENCE_DAYS = 5;
const RESEARCH_ABSENCE_UNITS = RESEARCH_ABSENCE_DAYS * ACTIONS_PER_DAY;
const DAYS_PER_ASSESSMENT = 28;
const DAY_PHASES = Object.freeze(['晨', '午', '昏', '夜', '深夜']);
const LEADERSHIP_EVENT_IDS = Object.freeze(['harsh_leader', 'director_hostility', 'senior_rules', 'faction_failure']);

const BENEFICIAL_EVENTS = Object.freeze({
  chief_duty_appointment: {
    id: 'chief_duty_appointment', title: '获聘总值班', category: 'beneficial',
    text: '你获聘总值班。这个转机让你的血量立即恢复至 100%；精力、线索和此前选择的后果继续保留。',
    choices: [{ id: 'continue', label: '收下喜报，继续前行', text: '血量已在喜报出现时恢复，确认不会再次回血。', effects: {} }],
  },
  national_grant_award: {
    id: 'national_grant_award', title: '获得国家级科学基金', category: 'beneficial',
    text: '国家级科学基金获批。你的血量立即恢复至 100%；精力、线索和此前选择的后果继续保留。',
    choices: [{ id: 'continue', label: '收下喜报，继续前行', text: '血量已在喜报出现时恢复，确认不会再次回血。', effects: {} }],
  },
  record_speech_champion: {
    id: 'record_speech_champion', title: '获得病历演讲比赛冠军', category: 'beneficial',
    text: '你获得了病历演讲比赛冠军。血量立即恢复至 100%；精力、线索和此前选择的后果继续保留。',
    choices: [{ id: 'continue', label: '收下喜报，继续前行', text: '血量已在喜报出现时恢复，确认不会再次回血。', effects: {} }],
  },
});

const FATAL_EVENTS = Object.freeze({
  record_failure: {
    id: 'record_failure', title: '丙级病历',
    text: '病历被评定为丙级，本次规培历程在此中断。此前的准备可以降低风险，但不能保证豁免。',
    cause: 'instant_fatal', actionType: 'work',
  },
  grant_failure: {
    id: 'grant_failure', title: '科研基金申请失败',
    text: '科研基金申请失败，关键机会随之失去，本条故事路线在此结束。',
    cause: 'instant_fatal', actionType: 'research',
  },
  faction_failure: {
    id: 'faction_failure', title: '被上级派系斗争波及',
    text: '你被卷入上级的派系斗争，即使仍有血量，也无法继续当前路线。',
    cause: 'instant_fatal', actionType: 'politics',
  },
  research_absence: {
    id: 'research_absence', title: '连续5日未开展科研',
    text: '连续 5 个游戏日没有完成一次科研行动，科研考核未通过，本次旅程在此结束。完成科研会重新开始计算这 5 天；看视频度过的时间也计入期限。',
    cause: 'research_absence', actionType: 'research',
  },
});

// All texts here are game adaptation, not claims about the source films.
const EVENTS = Object.freeze({
  divine_love: {
    id: 'divine_love', title: '神爱世人', category: 'beneficial_over_time',
    text: '一份善意让你重新获得支撑。确认后持续 4 个游戏日，每 5 个有效行动或首次看完一章视频恢复一次血量。',
    statusEffect: { kind: 'heal', durationDays: 4, hpPerTick: 8, damageRule: 'divineLoveHpPerTick' },
    choices: [{ id: 'continue', label: '接受这份善意', text: '持续恢复已生效，确认时不立即回血，也不清除其他状态。', effects: {} }],
  },
  special_trait: {
    id: 'special_trait', title: '特殊特质', category: 'beneficial_over_time',
    text: '一份特殊特质支持着你。确认后持续 3 个游戏日，每 5 个有效行动或首次看完一章视频恢复一次血量。',
    statusEffect: { kind: 'heal', durationDays: 3, hpPerTick: 4, damageRule: 'specialTraitHpPerTick' },
    choices: [{ id: 'continue', label: '接受这份支持', text: '持续恢复已生效，确认时不立即回血，也不清除其他状态。', effects: {} }],
  },
  director_hostility: {
    id: 'director_hostility', title: '高层好像讨厌你呢', category: 'misfortune',
    text: '持续的冷遇与额外压力正在影响你。确认后持续 5 个游戏日，每 5 个有效行动或首次看完一章视频扣除一次血量；关闭游戏不推进。',
    statusEffect: { durationDays: 5, hpPerTick: 6, damageRule: 'directorHostilityHpPerTick' },
    choices: [{ id: 'continue', label: '知晓压力，继续应对', text: '持续状态已生效，确认时不立即扣血。', effects: {} }],
  },
  cyberbullying: {
    id: 'cyberbullying', title: '遭遇网暴', category: 'misfortune',
    text: '恶意言论持续扩散。确认后持续 3 个游戏日，每 5 个有效行动或首次看完一章视频扣除一次血量；关闭游戏不推进。',
    statusEffect: { durationDays: 3, hpPerTick: 8, damageRule: 'cyberbullyingHpPerTick' },
    choices: [{ id: 'continue', label: '保留证据，继续应对', text: '持续状态已生效，确认时不立即扣血。', effects: {} }],
  },
  senior_rules: {
    id: 'senior_rules', title: '前辈觉得你不守规则', category: 'misfortune',
    text: '前辈对你的处事方式持续施压。确认后持续 4 个游戏日，每 5 个有效行动或首次看完一章视频扣除一次血量；关闭游戏不推进。',
    statusEffect: { durationDays: 4, hpPerTick: 7, damageRule: 'seniorRulesHpPerTick' },
    choices: [{ id: 'continue', label: '记录情况，继续应对', text: '持续状态已生效，确认时不立即扣血。', effects: {} }],
  },
  harsh_leader: {
    id: 'harsh_leader', title: '苛刻的领导', category: 'misfortune',
    text: '额外任务与严厉质问同时到来。你的应对会影响精力与信任。',
    choices: [
      { id: 'comply', label: '接下额外任务', text: '消耗精力与血量，换取暂时的信任。', effects: { energy: -12, hp: -4, trust: 2 } },
      { id: 'clarify', label: '整理依据，说明边界', text: '花费时间澄清任务，但可能损失信任。', effects: { time: 1, energy: -6, trust: -1, insight: 1 }, flags: { defendedBoundary: true } },
      { id: 'seek_help', label: '请可信的同事协助', text: '需要信任至少 3，消耗部分人情。', requires: { trust: 3 }, effects: { trust: -2, energy: -4, hp: 3 }, flags: { soughtHelp: true } },
    ],
  },
  patient_conflict: {
    id: 'patient_conflict', title: '患者家属的质问', category: 'misfortune',
    text: '沟通出现误会，家属要求立即作出解释。你需要决定如何处理。',
    choices: [
      { id: 'explain', label: '留出时间说明情况', text: '花费时间与精力，增加信任。', effects: { time: 1, energy: -10, trust: 2, insight: 1 } },
      { id: 'coordinate', label: '请同事共同沟通', text: '需要信任至少 2。', requires: { trust: 2 }, effects: { energy: -4, trust: -1 }, flags: { soughtHelp: true } },
      { id: 'withdraw', label: '暂时退出争执', text: '减少当下消耗，但留下关系代价。', effects: { hp: -3, trust: -3 } },
    ],
  },
  health_crisis: {
    id: 'health_crisis', title: '身体发出警报', category: 'misfortune',
    text: '持续透支已经影响你的状态。继续行动或停下来，都有代价。',
    choices: [
      { id: 'stop', label: '暂停任务，休整', text: '花费时间与部分金钱，恢复血量和精力。', effects: { time: 3, money: -8, hp: 14, energy: 22 }, flags: { protectedHealth: true } },
      { id: 'care', label: '寻求帮助并休息', text: '需要至少 15 金钱，恢复更多状态。', requires: { money: 15 }, effects: { time: 2, money: -15, hp: 22, energy: 28 }, flags: { protectedHealth: true, soughtHelp: true } },
      { id: 'push_on', label: '继续撑完眼前任务', text: '获得一点收入，但进一步损伤状态。', effects: { hp: -10, energy: -8, money: 10 }, flags: { ignoredHealth: true } },
    ],
  },
  family_betrayal: {
    id: 'family_betrayal', title: '亲近之人的背叛', category: 'misfortune',
    text: '此前埋下的家庭矛盾在此刻暴露。你需要决定是否继续承担这段关系的代价。',
    choices: [
      { id: 'confront', label: '当面追问真相', text: '承受冲突的损耗，获取更多信息。', effects: { hp: -7, energy: -6, trust: -2, insight: 3 }, flags: { familyConflictResolved: true } },
      { id: 'set_boundary', label: '保留证据，划清边界', text: '消耗精力，保护后续选择。', effects: { energy: -8, hp: -2, insight: 2 }, flags: { familyConflictResolved: true, familyBoundary: true } },
      { id: 'postpone', label: '暂时维持关系', text: '付出金钱与血量，矛盾仍然存在。', effects: { money: -18, hp: -4, time: 1 }, flags: { familyDeferred: true } },
    ],
  },
});

const ACTION_INFO = Object.freeze({
  inspect: { time: 1, energy: -7 },
  travel: { time: 1, energy: -5 },
  rest: { time: 2, energy: 35, hp: 14, money: 0 },
  entertain: { time: 1, energy: 20, hp: 20, money: -10 },
  work: { time: 2, energy: -16, hp: -4, trust: 1 },
  research: { time: 2, energy: -18, hp: -3, insight: 2 },
  politics: { time: 1, energy: -12, hp: -2, trust: 1 },
  prepare: { time: 1, energy: -8, money: -5 },
  puzzle: { time: 1, energy: -8 },
  npc: { time: 1, energy: -3 },
  clinical: { time: 1, energy: -5 },
});

const PREPARE_KIND = { work: 'record', research: 'grant', politics: 'neutral' };
const FATAL_FOR_ACTION = { work: 'record_failure', research: 'grant_failure', politics: 'faction_failure' };
const STATUSES = new Set(['playing', 'failure', 'chapter_end', 'complete']);
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const numeric = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function seedNumber(value) {
  if (Number.isFinite(value)) return (Number(value) >>> 0) || 0x9e3779b9;
  const text = String(value == null ? 'baiyi-story' : value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0) || 0x9e3779b9;
}

function createGame(chapters, options = {}) {
  if (!Array.isArray(chapters) || chapters.length === 0) throw new Error('至少需要一个章节。');
  if (chapters.some((c) => !c || c.id == null)) throw new Error('每章必须包含 id。');
  if (new Set(chapters.map((c) => String(c.id))).size !== chapters.length) throw new Error('章节 id 不得重复。');
  const rules = Object.assign({}, DEFAULT_RULES, options.rules || {});
  rules.fatalRisk = Object.assign({}, DEFAULT_RULES.fatalRisk, (options.rules || {}).fatalRisk || {});
  rules.beneficialRisk = Object.assign({}, DEFAULT_RULES.beneficialRisk, (options.rules || {}).beneficialRisk || {});
  rules.threshold = clamp(numeric(rules.threshold, 30), 1, 100);
  rules.eventCooldown = Math.max(0, Math.floor(numeric(rules.eventCooldown, 2)));
  rules.lowHpEventChance = clamp(numeric(rules.lowHpEventChance, 0.18), 0, 1);
  rules.lowHpAdditionalChance = clamp(numeric(rules.lowHpAdditionalChance, 0.32), 0, 1);
  rules.preparedRiskMultiplier = clamp(numeric(rules.preparedRiskMultiplier, 0.3), 0, 1);
  rules.exhaustionDamage = Math.max(0, numeric(rules.exhaustionDamage, 1));
  rules.assessmentQuestionCount = Math.max(1, Math.floor(numeric(rules.assessmentQuestionCount, 3)));
  rules.assessmentWrongHpLoss = Math.max(0, numeric(rules.assessmentWrongHpLoss, 10));
  rules.assessmentHintCost = Math.max(0, Math.floor(numeric(rules.assessmentHintCost, 5)));
  rules.entertainCost = Math.max(0, Math.floor(numeric(rules.entertainCost, 10)));
  rules.entertainHpGain = Math.max(0, numeric(rules.entertainHpGain, 20));
  rules.entertainEnergyGain = Math.max(0, numeric(rules.entertainEnergyGain, 20));
  rules.salaryPenaltyProbability = clamp(numeric(rules.salaryPenaltyProbability, 0.15), 0, 1);
  rules.workWage = Math.max(0, Math.floor(numeric(rules.workWage, 24)));
  rules.workStipend = Math.max(0, Math.floor(numeric(rules.workStipend, 3)));
  rules.restHpGain = Math.max(0, numeric(rules.restHpGain, 14));
  rules.restEnergyGain = Math.max(0, numeric(rules.restEnergyGain, 35));
  rules.restCost = Math.max(0, Math.floor(numeric(rules.restCost, 0)));
  rules.directorHostilityHpPerTick = Math.max(0, numeric(rules.directorHostilityHpPerTick, 6));
  rules.cyberbullyingHpPerTick = Math.max(0, numeric(rules.cyberbullyingHpPerTick, 8));
  rules.seniorRulesHpPerTick = Math.max(0, numeric(rules.seniorRulesHpPerTick, 7));
  rules.statusEventProbability = clamp(numeric(rules.statusEventProbability, 0.02), 0, 1);
  rules.restoreHpRatio = clamp(numeric(rules.restoreHpRatio, 0.5), 0.01, 1);
  rules.divineLoveHpPerTick = Math.max(0, numeric(rules.divineLoveHpPerTick, 8));
  rules.specialTraitHpPerTick = Math.max(0, numeric(rules.specialTraitHpPerTick, 4));
  rules.recoveryEventProbability = clamp(numeric(rules.recoveryEventProbability, 0.01), 0, 1);
  rules.maxNegativeStatusEffects = Math.max(0, Math.floor(numeric(rules.maxNegativeStatusEffects, 2)));
  const initialSeed = seedNumber(options.seed);
  const storageKey = options.storageKey || 'baiyi-game-save-v1';
  const memorial = createMemorial({ storage: options.storage, storageKey: options.memorialKey, clock: options.clock });
  const questionHistory = options.questionHistory || createQuestionHistory({ storage: options.storage, storageKey: options.questionHistoryKey });
  // Identity randomness is isolated from seeded gameplay randomness. Servers
  // pass a stable run id here so replayed operations reproduce occurrence ids.
  const occurrenceNamespace = String(options.occurrenceNamespace || `local-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_:.-]/g, '_').slice(0, 160);
  let eventHighWater = 0;
  let emittedEvents = [];
  let state;
  let checkpointData = null;
  let chapterStarts = {};
  let restoreAttempts = 0;
  let memorySave = null;
  let lastDamage = null;

  function catalogItems(catalog, key) {
    if (Array.isArray(catalog)) return catalog;
    if (catalog && Array.isArray(catalog[key])) return catalog[key];
    if (catalog && Array.isArray(catalog.items)) return catalog.items;
    return [];
  }
  const npcCatalog = catalogItems(options.npcs, 'npcs');
  const sideStoryCatalog = catalogItems(options.sideStories === undefined ? DEFAULT_SIDE_STORIES : options.sideStories, 'sideStories');
  const questionCatalog = catalogItems(options.knowledge, 'questions');

  function syncCalendar(target = state) {
    target.completedDays = Math.floor(target.actionCount / ACTIONS_PER_DAY) + (target.videoDays || 0);
    target.day = target.completedDays + 1;
    target.dayPhaseIndex = target.actionCount % ACTIONS_PER_DAY;
    target.dayPhase = DAY_PHASES[target.dayPhaseIndex];
  }
  function assessmentActive() {
    return !!state.monthlyAssessment && state.monthlyAssessment.status === 'active';
  }
  function newSalary(month) { return { month, accrued: 0, reduced: false, rate: 1, workCount: 0, penaltyChecked: false }; }
  function getSalary() { return clone(state.salary); }
  function getResearchDeadline() {
    const remainingUnits = Math.max(0, RESEARCH_ABSENCE_UNITS - state.researchIdleUnits);
    return {
      limitDays: RESEARCH_ABSENCE_DAYS, limitUnits: RESEARCH_ABSENCE_UNITS,
      elapsedUnits: state.researchIdleUnits, remainingUnits,
      remainingDays: Math.floor(remainingUnits / ACTIONS_PER_DAY),
      remainingActions: remainingUnits % ACTIONS_PER_DAY,
      dueSoon: remainingUnits <= ACTIONS_PER_DAY, overdue: remainingUnits === 0,
    };
  }
  function settleSalaryIfDue() {
    const completedMonth = Math.floor(state.completedDays / DAYS_PER_ASSESSMENT);
    if (completedMonth < state.salary.month) return null;
    const amount = Math.floor(state.salary.accrued * state.salary.rate);
    const moneyBefore = state.money;
    state.money = clamp(state.money + amount, 0, 99999);
    const payment = Object.assign({}, clone(state.salary), {
      amount, credited: state.money - moneyBefore, paidDay: state.completedDays, paidAtAction: state.actionCount,
    });
    state.salaryPayments.push(payment);
    log(`第 ${payment.month} 月发薪：应发 ${payment.accrued} 金币，${payment.reduced ? '本月减薪，按 50% 发放' : '按全额发放'}，实发 ${payment.credited} 金币。`, 'salary_payment');
    state.salary = newSalary(completedMonth + 1);
    return clone(payment);
  }
  function validQuestions() {
    const ids = new Set();
    return questionCatalog.filter((question) => {
      if (!question || question.id == null || ids.has(String(question.id)) || !Array.isArray(question.options)
          || !Number.isInteger(question.correctIndex) || question.correctIndex < 0 || question.correctIndex >= question.options.length) return false;
      ids.add(String(question.id));
      return true;
    });
  }
  function selectAssessmentQuestions() {
    if (questionHistory.refresh) questionHistory.refresh();
    const pool = validQuestions().filter((question) => !questionHistory.has(question.id));
    const count = Math.min(rules.assessmentQuestionCount, pool.length);
    const picked = [];
    function pick(candidates) {
      if (!candidates.length || picked.length >= count) return;
      picked.push(candidates[Math.floor(nextRandom() * candidates.length)]);
    }
    if (count >= 2) {
      pick(pool.filter((question) => /内科/.test(String(question.category || '')) && !/内分泌/.test(String(question.category || ''))));
      pick(pool.filter((question) => /内分泌/.test(String(question.category || '')) && !picked.includes(question)));
    }
    while (picked.length < count) pick(pool.filter((question) => !picked.includes(question)));
    return picked.map((question) => question.id);
  }
  function scheduleAssessmentIfDue() {
    const month = Math.floor(state.completedDays / DAYS_PER_ASSESSMENT);
    if (month <= state._lastAssessmentMonth || assessmentActive()) return;
    state._lastAssessmentMonth = month;
    const questionIds = selectAssessmentQuestions();
    if (!questionIds.length) {
      state.completedAssessments.push({ month, questionIds: [], answers: [], index: 0, status: 'unavailable', score: 0, total: 0, completedDay: state.completedDays });
      log(`已度过 ${state.completedDays} 个游戏日：第 ${month} 次月度考核暂无未做过的新题，本次免考，不扣血、不授予满分奖励。`, 'assessment_unavailable');
      return;
    }
    state.monthlyAssessment = { month, questionIds, answers: [], purchasedHints: [], index: 0, status: 'active', startedDay: state.completedDays, score: 0, total: questionIds.length };
    log(`已度过 ${state.completedDays} 个游戏日，进入第 ${month} 次月度考核：${questionIds.length} 题，每答错一题立即扣 ${rules.assessmentWrongHpLoss} 血量。`, 'assessment');
  }

  function chapterIndex(id) { return chapters.findIndex((c) => String(c.id) === String(id)); }
  function getChapter() { return chapters[chapterIndex(state.chapterId)] || null; }
  function getNextUnfinishedChapter() {
    return clone(chapters.find((chapter) => !state.chapterResults[String(chapter.id)]) || null);
  }
  function isQuestionAnswered(id) { return questionHistory.has(id); }
  function getUnansweredQuestions() {
    if (questionHistory.refresh) questionHistory.refresh();
    return validQuestions().filter((q) => !questionHistory.has(q.id)).map(clone);
  }
  function getAnsweredQuestions() {
    return validQuestions().filter((q) => questionHistory.has(q.id)).map((q) => {
      const record = questionHistory.get(q.id);
      return Object.assign(clone(q), { recordedAnswer: record.answer, correct: record.correct, answerSource: record.source });
    });
  }
  function getQuestionHistory() { return questionHistory.getState(); }
  function rememberQuestion(question, answer, source) {
    const recorded = questionHistory.record({ questionId: question.id, answer,
      correct: answer === question.correctIndex, source, chapterId: state.chapterId });
    if (!recorded.ok) log(`题目历史尚未持久保存：${recorded.storageError}`, 'storage_error');
    return recorded;
  }
  function reconcileQuestionHistory() {
    // Import older saves without treating their answers as fresh actions.
    const records = [];
    for (const question of validQuestions()) {
      const answer = state.flags[`knowledge_${question.id}`];
      if (Number.isInteger(answer) && answer >= 0 && answer < question.options.length) {
        records.push({ questionId: question.id, answer, correct: answer === question.correctIndex, source: 'legacy', chapterId: state.chapterId });
      }
    }
    for (const assessment of [...state.completedAssessments, state.monthlyAssessment].filter(Boolean)) {
      for (const answer of assessment.answers || []) records.push(Object.assign({}, answer, { source: 'monthly', chapterId: state.chapterId }));
    }
    const merged = questionHistory.merge(records);
    if (!merged.ok) log(`题目历史尚未持久保存：${merged.storageError}`, 'storage_error');
    if (!assessmentActive()) return;
    const assessment = state.monthlyAssessment;
    while (assessment.index < assessment.questionIds.length) {
      const id = assessment.questionIds[assessment.index];
      const first = questionHistory.get(id);
      if (!first) break;
      const question = questionCatalog.find((item) => String(item.id) === String(id));
      assessment.answers.push({ questionId: id, answer: first.answer, correct: first.correct,
        explanation: question ? question.explanation || '' : '', hpLoss: 0, fromHistory: true });
      assessment.index++;
      assessment.score += first.correct ? 1 : 0;
      assessment.skippedQuestionIds = (assessment.skippedQuestionIds || []).concat(id);
      log('月考已恢复这道题的首次答案，不重复作答、扣血或收费。', 'assessment_history');
    }
    if (assessment.index === assessment.questionIds.length) finishAssessment(assessment);
  }
  function finishAssessment(assessment) {
    if (assessment.status !== 'active') return;
    assessment.status = 'completed';
    assessment.completedDay = state.completedDays;
    state.completedAssessments.push(clone(assessment));
    state.flags.monthlyAssessmentsCompleted = (state.flags.monthlyAssessmentsCompleted || 0) + 1;
    log(`第 ${assessment.month} 次月考完成：${assessment.score}/${assessment.total} 题正确。`, 'assessment_completed');
  }
  function isVideoCompleted(chapterId = state.chapterId) {
    return state.completedVideos.some((id) => String(id) === String(chapterId));
  }
  function archiveVideoClues(chapter) {
    let archived = 0;
    for (const clue of chapter.clues || []) {
      if (!state.clues.includes(clue.id)) { state.clues.push(clue.id); archived++; }
      const globalId = `${chapter.id}:${clue.id}`;
      if (!state.allClues.includes(globalId)) state.allClues.push(globalId);
      if (clue.flags) Object.assign(state.flags, clone(clue.flags));
    }
    return archived;
  }
  function completeVideo(chapterId) {
    const blocked = guard('completeVideo');
    if (blocked) return blocked;
    const chapter = getChapter();
    if (chapter.presentation !== 'video' || String(chapter.id) !== String(chapterId)) {
      return result(false, 'completeVideo', '只能记录当前章节的视频播放完成。');
    }
    if (isVideoCompleted(chapter.id)) return result(true, 'completeVideo', '本章视频已经看完，可随时回看。', {
      chapterId: chapter.id, alreadyCompleted: true, archivedClues: 0, advancedDays: 0, elapsedUnits: 0,
    });
    state.completedVideos.push(chapter.id);
    const archivedClues = archiveVideoClues(chapter);
    return finishVideoDay('completeVideo', {
      chapterId: chapter.id, alreadyCompleted: false, archivedClues,
    }, '本章视频已看完，游戏时间度过一天，剧情资料自动归档。');
  }
  function getSideStories(npcId) {
    return sideStoryCatalog.filter((story) => npcId === undefined || String(story.npcId) === String(npcId)).map(clone);
  }
  function sideStory(id) { return sideStoryCatalog.find((story) => String(story.id) === String(id)); }
  function isSideVideoCompleted(id) {
    return state.completedSideVideos.some((known) => String(known) === String(id));
  }
  function sideStoryUnlocked(story) {
    return !!story && (story.requires || []).every(isSideVideoCompleted);
  }
  function canPlaySideVideo(id) {
    return state.status === 'playing' && !state.event && !assessmentActive() && sideStoryUnlocked(sideStory(id));
  }
  function completeSideVideo(sideStoryId) {
    const blocked = guard('completeSideVideo');
    if (blocked) return blocked;
    const story = sideStory(sideStoryId);
    if (!story) return result(false, 'completeSideVideo', '没有找到这段人物支线。');
    if (!sideStoryUnlocked(story)) return result(false, 'completeSideVideo', '请先完整观看这位同行者的前一段故事。');
    if (isSideVideoCompleted(story.id)) return result(true, 'completeSideVideo', '这段人物支线已经看完，重看不再推进时间。', {
      sideStoryId: story.id, alreadyCompleted: true, advancedDays: 0, elapsedUnits: 0,
    });
    state.completedSideVideos.push(story.id);
    return finishVideoDay('completeSideVideo', {
      sideStoryId: story.id, npcId: story.npcId, alreadyCompleted: false,
    }, `人物支线《${story.title}》已看完，游戏时间度过一天。`);
  }
  function finishVideoDay(type, details, message) {
    state.videoDays += 1;
    const extra = Object.assign({ advancedDays: 1, elapsedUnits: ACTIONS_PER_DAY }, details);
    settleElapsedTime(type, ACTIONS_PER_DAY, extra);
    log(message, 'video');
    if (state.hp <= 0) fail('hp_zero', { actionType: type });
    if (state.status !== 'failure') extra.statusEffectTicks = tickStatusEffects(ACTIONS_PER_DAY);
    if (state.status === 'failure') return result(true, type, state.failure.title, extra);
    // Five elapsed time units age existing cooldowns, but the film is only one
    // event opportunity. Never synthesize five work/rest actions or event rolls.
    state.cooldown = Math.max(0, state.cooldown - (ACTIONS_PER_DAY - 1));
    rollAmbientEvent();
    return result(true, type, state.event ? state.event.title : message, extra);
  }
  function nextRandom() {
    let x = state._rng >>> 0;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    state._rng = (x >>> 0) || 0x9e3779b9;
    return state._rng / 4294967296;
  }
  function log(text, type = 'story') {
    state.log.push({ action: state.actionCount, time: state.time, type, text });
    if (state.log.length > 100) state.log.splice(0, state.log.length - 100);
  }
  function result(ok, type, message, extra = {}) {
    const history = questionHistory.getState();
    return Object.assign({ ok, type, message, status: state.status, event: clone(state.event), failure: clone(state.failure), consumedTime: 0,
      questionHistoryError: history.storageError, questionHistoryUnsavedCount: history.unsavedCount,
      triggeredEvent: clone(emittedEvents[emittedEvents.length - 1] || null), triggeredEvents: clone(emittedEvents) }, extra);
  }
  function recordOccurrence(definition, category = definition.category) {
    eventHighWater = Math.max(eventHighWater, state._eventSequence || 0) + 1;
    state._eventSequence = eventHighWater;
    const occurrence = {
      occurrenceId: `${occurrenceNamespace}:${eventHighWater}`, id: definition.id, title: definition.title,
      category, medalFamily: LEADERSHIP_EVENT_IDS.includes(definition.id) ? 'leadership' : null,
      isBeneficial: category === 'beneficial' || category === 'beneficial_over_time', actionCount: definition.actionCount == null ? state.actionCount : definition.actionCount,
    };
    state.lastTriggeredEvent = clone(occurrence);
    emittedEvents.push(clone(occurrence));
    return occurrence;
  }
  function clampResources() {
    state.hp = clamp(numeric(state.hp), 0, rules.maxHp);
    state.energy = clamp(numeric(state.energy), 0, rules.maxEnergy);
    state.money = clamp(numeric(state.money), 0, 99999);
    state.trust = clamp(numeric(state.trust), -100, 100);
    state.insight = clamp(numeric(state.insight), 0, 100);
    state.time = Math.max(0, numeric(state.time));
  }
  function applyEffects(effects = {}, flags = {}) {
    const energyDelta = numeric(effects.energy);
    const deficit = Math.max(0, -(state.energy + energyDelta));
    const directHpDelta = numeric(effects.hp);
    const exhaustionDamage = deficit * rules.exhaustionDamage;
    lastDamage = {
      hpBefore: state.hp, directHpDelta, exhaustionDamage,
      exhaustionLethal: exhaustionDamage > 0 && state.hp + directHpDelta > 0 && state.hp + directHpDelta - exhaustionDamage <= 0,
    };
    state.energy += energyDelta;
    state.hp += directHpDelta - exhaustionDamage;
    ['money', 'trust', 'insight', 'time'].forEach((key) => { state[key] += numeric(effects[key]); });
    if (effects.flags && typeof effects.flags === 'object') Object.assign(state.flags, clone(effects.flags));
    if (flags && typeof flags === 'object') Object.assign(state.flags, clone(flags));
    clampResources();
    if (deficit > 0) log(`精力透支 ${deficit}，额外损失 ${deficit * rules.exhaustionDamage} 血量。`, 'exhaustion');
    if (state.hp >= rules.threshold) state._belowHandled = false;
  }
  function fail(id, extra = {}) {
    if (state.status === 'failure') return;
    const fatal = FATAL_EVENTS[id];
    state.failure = Object.assign({}, fatal || {
      id: 'hp_zero', title: '血量耗尽', text: '持续的损耗让你无法再继续行动。这条路线在这里结束。', cause: 'hp_zero', actionType: null,
    }, { chapterId: state.chapterId, actionCount: state.actionCount, hp: state.hp }, fatal ? {} : (lastDamage || {}), extra);
    if (fatal) Object.assign(state.failure, recordOccurrence(fatal, 'fatal'));
    state.status = 'failure';
    state.event = null;
    log(state.failure.title, 'failure');
    const chapter = getChapter();
    const causeEvent = state.failure.eventId && EVENTS[state.failure.eventId];
    const saved = memorial.append({
      character: '李晨光', day: state.day, completedDays: state.completedDays,
      dayPhaseIndex: state.dayPhaseIndex, dayPhase: state.dayPhase, actionCount: state.actionCount,
      chapterId: state.chapterId, sourceChapterId: chapter.sourceChapterId == null ? chapter.id : chapter.sourceChapterId,
      chapterOrder: chapter.gameOrder || chapterIndex(chapter.id) + 1, gameOrder: chapter.gameOrder || chapterIndex(chapter.id) + 1,
      chapterTitle: chapter.title || `第 ${chapter.id} 章`,
      causeId: state.failure.eventId || state.failure.id,
      causeTitle: causeEvent ? `${causeEvent.title}（血量耗尽）` : state.failure.actionType === 'monthly_assessment' ? '月度考核扣分后血量耗尽' : state.failure.title,
      causeText: state.failure.text, actionType: state.failure.actionType || null, eventId: state.failure.eventId || null,
      occurrenceId: state.failure.occurrenceId || null,
      category: classifyDeath(state.failure), hp: state.hp,
    });
    state.failure.deathId = saved.record.deathId;
    state.failure.memorialRecord = saved.record;
    state.failure.memorialSaved = saved.ok;
    state.failure.memorialError = saved.storageError || null;
    if (!saved.ok) log(`纪念记录尚未持久保存：${saved.storageError}`, 'storage_error');
  }
  function guard(type) {
    if (state.status !== 'playing') return result(false, type, '当前不能行动，请读取节点或继续章节。');
    if (state.event) return result(false, type, '请先处理当前厄运事件。');
    if (assessmentActive()) return result(false, type, '请先完成当前月度考核。');
    return null;
  }
  function conditionsMet(requires = {}) {
    for (const key of ['hp', 'energy', 'money', 'trust', 'insight']) {
      if (requires[key] != null && state[key] < numeric(requires[key])) return false;
    }
    if (requires.flags) {
      for (const [key, value] of Object.entries(requires.flags)) if (state.flags[key] !== value) return false;
    }
    return true;
  }
  function eligibleEvents() {
    const familyReady = !state.flags.familyConflictResolved && (
      state.flags.familyTension >= 1 || state.flags.familyBetrayalForeshadowed === true || state.flags.familyConflict === true
    );
    const candidates = ['health_crisis', 'cyberbullying'];
    if (state.room === 'hospital') candidates.push('harsh_leader', 'patient_conflict', 'director_hostility', 'senior_rules');
    if (familyReady) candidates.push('family_betrayal');
    const inactive = candidates.filter(canActivateStatus);
    const allowed = getChapter().allowedEvents;
    return Array.isArray(allowed) && inactive.some((id) => allowed.includes(id))
      ? inactive.filter((id) => allowed.includes(id)) : inactive;
  }
  function eligibleStatusEvents() {
    return eligibleEvents().filter((id) => EVENTS[id].statusEffect);
  }
  function canActivateStatus(id) {
    const definition = EVENTS[id] && EVENTS[id].statusEffect;
    if (!definition) return true;
    if (state.statusEffects.some((effect) => effect.id === id)) return false;
    return definition.kind === 'heal'
      || state.statusEffects.filter((effect) => effect.kind !== 'heal').length < rules.maxNegativeStatusEffects;
  }
  function triggerEvent(eventId) {
    if (eventId && !canActivateStatus(eventId)) return false;
    const ids = eligibleEvents();
    const id = eventId || ids[Math.floor(nextRandom() * ids.length)];
    state.event = clone(EVENTS[id]);
    Object.assign(state.event, recordOccurrence(state.event));
    if (state.event.statusEffect) {
      state.event.statusEffect.hpPerTick = rules[state.event.statusEffect.damageRule];
      const healing = state.event.statusEffect.kind === 'heal';
      state.event.text = `确认后持续 ${state.event.statusEffect.durationDays} 个游戏日：每完成 5 个有效行动或首次看完一章视频${healing ? '恢复' : '扣除'} ${state.event.statusEffect.hpPerTick} 血量，共 ${state.event.statusEffect.durationDays} 次。确认时不立即改变血量，关闭游戏、看菜单与月考答题不推进；同种状态不叠加。${healing ? '与同次持续伤害合并净额后结算，不清除其他状态。' : ''}`;
    }
    state.event.choices.forEach((choice) => { choice.available = conditionsMet(choice.requires); });
    if (state.event.category === 'misfortune') {
      state.cooldown = rules.eventCooldown;
      state._belowHandled = state.hp < rules.threshold;
    }
    log(`${state.event.category === 'beneficial_over_time' ? '持续喜报' : '厄运事件'}：${state.event.title}`, 'event');
    return true;
  }
  function getStatusEffects() { return clone(state.statusEffects); }
  function activateStatusEffect(event) {
    if (!event.statusEffect || !canActivateStatus(event.id)) return null;
    const definition = event.statusEffect;
    const effect = {
      id: event.id, title: event.title, remainingActions: definition.durationDays * ACTIONS_PER_DAY,
      tickIn: ACTIONS_PER_DAY, hpPerTick: definition.hpPerTick, ticksRemaining: definition.durationDays,
      startedAtAction: state.actionCount,
      kind: definition.kind === 'heal' ? 'heal' : 'damage', isBeneficial: definition.kind === 'heal',
      occurrenceId: event.occurrenceId || null,
    };
    state.statusEffects.push(effect);
    log(`${effect.title}持续状态生效：${definition.durationDays} 个游戏日，每 5 个有效行动或首次看完一章视频${effect.kind === 'heal' ? '恢复' : '扣除'} ${effect.hpPerTick} 血量。`, 'status_started');
    return clone(effect);
  }
  function tickStatusEffects(elapsedUnits = 1) {
    const ticks = [];
    for (const effect of state.statusEffects) {
      effect.remainingActions = Math.max(0, effect.remainingActions - elapsedUnits);
      effect.tickIn -= elapsedUnits;
    }
    for (const effect of state.statusEffects) {
      if (effect.tickIn > 0) continue;
      effect.tickIn += ACTIONS_PER_DAY;
      effect.ticksRemaining = Math.max(0, effect.ticksRemaining - 1);
      ticks.push({ id: effect.id, title: effect.title, kind: effect.kind, hpDelta: effect.kind === 'heal' ? effect.hpPerTick : -effect.hpPerTick, remainingActions: effect.remainingActions });
    }
    if (ticks.length && state.hp > 0) {
      const hpBefore = state.hp;
      const hpDelta = ticks.reduce((sum, tick) => sum + tick.hpDelta, 0);
      state.hp = clamp(state.hp + hpDelta, 0, rules.maxHp);
      if (state.hp >= rules.threshold) state._belowHandled = false;
      log(`持续状态合并结算：${ticks.map((tick) => `${tick.title}${tick.hpDelta >= 0 ? '+' : ''}${tick.hpDelta}`).join('、')}；血量 ${hpBefore} → ${state.hp}。`, 'status_tick');
      if (state.hp <= 0) {
        let remainingHp = hpBefore + ticks.filter((tick) => tick.kind === 'heal').reduce((sum, tick) => sum + tick.hpDelta, 0);
        const culprit = ticks.filter((tick) => tick.kind === 'damage').find((tick) => { remainingHp += tick.hpDelta; return remainingHp <= 0; });
        fail('hp_zero', {
          actionType: 'status_effect', eventId: culprit.id, title: `${culprit.title}（血量耗尽）`,
          occurrenceId: state.statusEffects.find((effect) => effect.id === culprit.id).occurrenceId || null,
          text: `同次持续回血与伤害合并后净损失 ${-hpDelta} 血量，${culprit.title}的持续压力使本条路线结束。`,
          hpBefore, directHpDelta: hpDelta, exhaustionDamage: 0, exhaustionLethal: false,
          statusContributors: clone(ticks),
        });
      }
    }
    for (const effect of state.statusEffects.filter((item) => item.remainingActions <= 0)) log(`${effect.title}持续状态结束。`, 'status_expired');
    state.statusEffects = state.statusEffects.filter((effect) => effect.remainingActions > 0);
    return ticks;
  }
  function beneficialForAction(type, action = {}) {
    if (type === 'work') return ['chief_duty_appointment', 'record_speech_champion'];
    if (type === 'politics') return ['chief_duty_appointment'];
    if (type === 'research') return ['national_grant_award'];
    if (type === 'prepare' && action.kind === 'record') return ['record_speech_champion'];
    return [];
  }
  function triggerBeneficial(id) {
    const hpBefore = state.hp;
    state.hp = rules.maxHp;
    state._belowHandled = false;
    state.event = clone(BENEFICIAL_EVENTS[id]);
    Object.assign(state.event, recordOccurrence(state.event));
    state.event.choices[0].available = true;
    state.event.hpRestored = state.hp - hpBefore;
    state.flags[`received_${id}`] = (state.flags[`received_${id}`] || 0) + 1;
    log(`喜报：${state.event.title}。血量立即恢复至 100%（${state.hp}），精力与已有线索、关系及选择后果不重置；本次行动不再同时判定致命或普通厄运。`, 'beneficial');
  }
  function getRisks() {
    const out = {};
    for (const action of Object.keys(FATAL_FOR_ACTION)) {
      const kind = PREPARE_KIND[action];
      const prepared = !!state.flags[`prepared_${kind}`];
      const probability = clamp(numeric(rules.fatalRisk[action]) * (prepared ? rules.preparedRiskMultiplier : 1), 0, 1);
      out[action] = {
        probability, prepared, eventId: FATAL_FOR_ACTION[action],
        title: FATAL_EVENTS[FATAL_FOR_ACTION[action]].title,
        text: `每次${{ work: '工作', research: '科研', politics: '处理人际事务' }[action]}有 ${(probability * 100).toFixed(2).replace(/\.?0+$/, '')}% 概率直接进入失败结局${prepared ? '；已准备，风险降低但未消除' : '；事前准备可以降低风险'}。`,
      };
    }
    out.misfortune = {
      threshold: rules.threshold, belowThreshold: state.hp < rules.threshold, cooldown: state.cooldown,
      probability: state.hp < rules.threshold ? clamp(rules.lowHpEventChance + rules.lowHpAdditionalChance * (rules.threshold - state.hp) / rules.threshold, 0, 1) : 0,
    };
    out.beneficial = Object.keys(BENEFICIAL_EVENTS).map((id) => ({
      id, title: BENEFICIAL_EVENTS[id].title, probability: clamp(numeric(rules.beneficialRisk[id]), 0, 1),
      text: '相关行动中低概率出现；一旦出现，血量立即恢复至 100%，不会恢复精力，也不会重置此前的选择后果。',
    }));
    return out;
  }
  function settleElapsedTime(type, elapsedUnits, extra) {
    const clinicallyActive = type === 'work' || type === 'clinical';
    const idleBefore = state.clinicalIdleActions;
    if (clinicallyActive) {
      state.clinicalIdleActions = 0;
      state.survivalActionCount += elapsedUnits;
    } else {
      state.clinicalIdleActions += elapsedUnits;
      state.survivalActionCount = state.clinicalIdleActions >= CLINICAL_ABSENCE_UNITS ? 0 : state.survivalActionCount + elapsedUnits;
    }
    extra.clinicalAbsenceTriggered = idleBefore < CLINICAL_ABSENCE_UNITS && state.clinicalIdleActions >= CLINICAL_ABSENCE_UNITS && !clinicallyActive;
    if (extra.clinicalAbsenceTriggered) log(`脱离临床：连续 ${CLINICAL_ABSENCE_DAYS} 个游戏日没有临床工作或首次教学作答，本局累计存活计时归零。首次看完一章视频计入 1 天；继续非临床活动不再累计，恢复临床行动后重新累计。游戏日历、月考和金币不受此惩罚影响。`, 'clinical_absence');
    syncCalendar();
    // Research on the final allowed action fulfils the obligation before its
    // elapsed unit is assessed. Preparation, viewing and cancelled actions do
    // not fulfil it; every first-completed film contributes five elapsed units.
    state.researchIdleUnits = type === 'research' ? 0 : state.researchIdleUnits + elapsedUnits;
    extra.researchDeadline = getResearchDeadline();
    if (state.researchIdleUnits >= RESEARCH_ABSENCE_UNITS) {
      extra.researchAbsenceTriggered = true;
      fail('research_absence', { elapsedResearchIdleUnits: state.researchIdleUnits });
      return;
    }
    const salaryPayment = settleSalaryIfDue();
    if (salaryPayment) extra.salaryPayment = salaryPayment;
    const assessmentMonthBefore = state._lastAssessmentMonth;
    scheduleAssessmentIfDue();
    const lastAssessment = state.completedAssessments[state.completedAssessments.length - 1];
    if (state._lastAssessmentMonth > assessmentMonthBefore && lastAssessment && lastAssessment.month === state._lastAssessmentMonth && lastAssessment.status === 'unavailable') {
      extra.assessmentUnavailable = clone(lastAssessment);
      extra.assessmentMessage = `第 ${lastAssessment.month} 次月度考核暂无新题，本次免考，不扣血或发放满分奖励。`;
    }
  }
  function finishAction(type, message, timeBefore, extra = {}, action = {}) {
    state.actionCount += 1;
    extra.elapsedUnits = 1;
    settleElapsedTime(type, 1, extra);
    log(message, 'action');
    if (state.status === 'failure') return result(true, type, state.failure.title, { consumedTime: state.time - timeBefore, ...extra });
    if (state.hp <= 0) {
      fail('hp_zero', { actionType: type });
      return result(true, type, state.failure.title, { consumedTime: state.time - timeBefore, ...extra });
    }
    extra.statusEffectTicks = tickStatusEffects();
    if (state.status === 'failure') return result(true, type, state.failure.title, { consumedTime: state.time - timeBefore, ...extra });
    const beneficialIds = beneficialForAction(type, action);
    if (FATAL_FOR_ACTION[type] || beneficialIds.length) {
      // One categorical roll: fatal, beneficial, or neither. Outcomes cannot overlap.
      const roll = nextRandom();
      let cumulative = FATAL_FOR_ACTION[type] ? getRisks()[type].probability : 0;
      if (roll < cumulative) {
        fail(FATAL_FOR_ACTION[type]);
        return result(true, type, state.failure.title, { consumedTime: state.time - timeBefore, ...extra });
      }
      for (const id of beneficialIds) {
        cumulative = Math.min(1, cumulative + clamp(numeric(rules.beneficialRisk[id]), 0, 1));
        if (roll < cumulative) {
          triggerBeneficial(id);
          return result(true, type, state.event.title, { consumedTime: state.time - timeBefore, ...extra, beneficial: true });
        }
      }
    }
    rollAmbientEvent();
    return result(true, type, message, { consumedTime: state.time - timeBefore, ...extra });
  }
  function rollAmbientEvent() {
    if (state.hp < rules.threshold && !state._belowHandled) {
      triggerEvent();
    } else if (state.cooldown > 0) {
      state.cooldown -= 1;
    } else if (state.hp < rules.threshold && nextRandom() < getRisks().misfortune.probability) {
      triggerEvent();
    } else if (state.hp >= rules.threshold && rules.statusEventProbability > 0) {
      const statusCandidates = eligibleStatusEvents();
      if (statusCandidates.length && nextRandom() < rules.statusEventProbability) triggerEvent(statusCandidates[Math.floor(nextRandom() * statusCandidates.length)]);
    }
    if (!state.event && rules.recoveryEventProbability > 0) {
      const recoveryCandidates = ['divine_love', 'special_trait'].filter(canActivateStatus);
      if (recoveryCandidates.length && nextRandom() < rules.recoveryEventProbability) triggerEvent(recoveryCandidates[Math.floor(nextRandom() * recoveryCandidates.length)]);
    }
  }

  function act(action) {
    if (typeof action === 'string') action = { type: action };
    if (!action || typeof action.type !== 'string') return result(false, 'invalid', '行动格式无效。');
    const type = action.type;
    if (type === 'move') return result(true, type, '移动仅改变画面位置，不消耗时间或资源。');
    if (type === 'clinical') {
      if (questionHistory.refresh) questionHistory.refresh();
      const question = questionCatalog.find((item) => String(item.id) === String(action.questionId));
      if (question && questionHistory.has(question.id)) {
        const record = questionHistory.get(question.id);
        const recordedAnswer = record.answer;
        return result(true, type, '复习已作答题目，不再消耗时间或发放奖励。', {
          review: true, recordedAnswer, correct: record.correct,
          explanation: question.explanation || '', question: clone(question),
        });
      }
    }
    const blocked = guard(type);
    if (blocked) return blocked;
    if (type === 'forceEvent') {
      if (options.debug !== true) return result(false, type, '调试事件未开启。');
      const id = action.eventId;
      if (FATAL_EVENTS[id]) fail(id, { debug: true });
      else if (BENEFICIAL_EVENTS[id]) triggerBeneficial(id);
      else if (EVENTS[id]) {
        if (!triggerEvent(id)) return result(false, type, '这种持续状态已生效，或负面持续状态数量已达上限，不额外叠加。');
      }
      else return result(false, type, '未知事件。');
      return result(true, type, FATAL_EVENTS[id] ? state.failure.title : state.event.title);
    }
    if (!ACTION_INFO[type]) return result(false, type, '未知行动。');
    const chapter = getChapter();
    const timeBefore = state.time;
    let message = '';
    let extra = {};
    if (type === 'npc') {
      const npc = npcCatalog.find((item) => String(item.id) === String(action.npcId));
      if (!npc) return result(false, type, '没有找到这位人物的对话目录。');
      const quest = npc.quest;
      if (action.completeQuest === true) {
        if (!quest) return result(false, type, '这位人物没有待完成的支线。');
        if (state.flags[`npc_done_${npc.id}`]) return result(false, type, '本周目已经完成这条支线，奖励不会重复发放。');
        if (Array.isArray(quest.requiresSideVideos)) {
          if (quest.requiresSideVideos.some((id) => !isSideVideoCompleted(id))) {
            return result(false, type, '请先完整观看这位同行者的支线影像，再一起完成约定。', { requiredSideVideos: clone(quest.requiresSideVideos) });
          }
        } else {
          const required = Math.max(0, Math.floor(numeric(quest.cluesRequired, numeric(npc.cluesRequired, 2))));
          if (state.clues.length < required) return result(false, type, `完成这条支线需要至少 ${required} 条本章线索。`, { cluesRequired: required });
        }
        applyEffects(ACTION_INFO.npc);
        applyEffects(quest.reward || {}, quest.flags || {});
        state.flags[`npc_done_${npc.id}`] = true;
        state.flags.npcQuestsCompleted = (state.flags.npcQuestsCompleted || 0) + 1;
        message = `完成${npc.name || npc.title || npc.id}的支线：${quest.title || '约定'}`;
        extra = { npc: clone(npc), questCompleted: true, reward: clone(quest.reward || {}) };
      } else {
        applyEffects(ACTION_INFO.npc);
        state.flags[`npc_talks_${npc.id}`] = (state.flags[`npc_talks_${npc.id}`] || 0) + 1;
        message = `与${npc.name || npc.title || npc.id}交谈。`;
        extra = { npc: clone(npc), questCompleted: false };
      }
    } else if (type === 'clinical') {
      const question = questionCatalog.find((item) => String(item.id) === String(action.questionId));
      if (!question || !Array.isArray(question.options) || !Number.isInteger(question.correctIndex)) return result(false, type, '没有找到有效的教学题目。');
      const flag = `knowledge_${question.id}`;
      const answer = action.answer;
      if (!Number.isInteger(answer) || answer < 0 || answer >= question.options.length) return result(false, type, '请选择有效的教学题答案。');
      const correct = answer === question.correctIndex;
      const recorded = rememberQuestion(question, answer, 'clinical');
      if (recorded.alreadyRecorded) return result(true, type, '这道题已经作答过，当前只展示解析。', {
        review: true, recordedAnswer: recorded.record.answer, correct: recorded.record.correct,
        explanation: question.explanation || '', question: clone(question),
      });
      applyEffects(Object.assign({}, ACTION_INFO.clinical, correct ? { insight: 1 } : {}));
      state.flags[flag] = answer;
      if (correct) state.flags.knowledgeCorrect = (state.flags.knowledgeCorrect || 0) + 1;
      message = correct ? '教学题回答正确，认知增加 1。' : '教学题已记录，可以阅读解析并随时复习。';
      extra = { correct, review: false, recordedAnswer: answer, explanation: question.explanation || '', question: clone(question) };
    } else if (type === 'inspect') {
      const clue = (chapter.clues || []).find((item) => String(item.id) === String(action.clueId));
      if (!clue) return result(false, type, '这里没有这条线索。');
      if (clue.room && clue.room !== state.room) return result(false, type, '请先前往线索所在场景。');
      if (state.clues.includes(clue.id)) return result(false, type, '这条线索已经记录，可在档案中免费重读。');
      applyEffects(Object.assign({}, ACTION_INFO.inspect, { insight: 1 }));
      state.clues.push(clue.id);
      const globalId = `${chapter.id}:${clue.id}`;
      if (!state.allClues.includes(globalId)) state.allClues.push(globalId);
      if (clue.flags) Object.assign(state.flags, clone(clue.flags));
      message = `记录线索：${clue.title || clue.id}`;
      extra.clue = clone(clue);
    } else if (type === 'travel') {
      const room = action.room;
      if (!['hospital', 'other'].includes(room)) return result(false, type, '未知场景。');
      if (state.room === room) return result(false, type, '已经在这个场景中。');
      applyEffects(ACTION_INFO.travel);
      state.room = room;
      if (!state.visited.includes(room)) state.visited.push(room);
      message = room === 'hospital' ? '返回医院。' : '进入异界。';
    } else if (type === 'entertain') {
      if (state.money < rules.entertainCost) return result(false, type, `娱乐需要 ${rules.entertainCost} 金币，当前余额不足；仍可选择基础休息。`, { charged: 0 });
      const hpBefore = state.hp;
      const energyBefore = state.energy;
      applyEffects({ time: 1, money: -rules.entertainCost, hp: rules.entertainHpGain, energy: rules.entertainEnergyGain });
      state.flags.entertainCount = (state.flags.entertainCount || 0) + 1;
      extra = { charged: rules.entertainCost, hpRestored: state.hp - hpBefore, energyRestored: state.energy - energyBefore };
      message = `花费 ${rules.entertainCost} 金币娱乐放松，恢复 ${extra.hpRestored} 血量和 ${extra.energyRestored} 精力。`;
    } else if (type === 'prepare') {
      const kind = action.kind;
      if (!['record', 'grant', 'neutral'].includes(kind)) return result(false, type, '请选择病历、基金或中立应对准备。');
      if (state.flags[`prepared_${kind}`]) return result(false, type, '本章已经完成这项准备。');
      if (state.money < 5) return result(false, type, '准备需要至少 5 金钱。');
      applyEffects(ACTION_INFO.prepare);
      state.flags[`prepared_${kind}`] = true;
      message = `完成${{ record: '病历复核', grant: '基金论证', neutral: '中立应对' }[kind]}准备：对应突发失败风险降低，但不会归零。`;
    } else if (type === 'puzzle') {
      if (!chapter.puzzle) return result(false, type, '本章没有待解问题。');
      if (state.flags.puzzleSolved) return result(false, type, '本章推理已经完成。');
      let answer = action.answer;
      if (typeof answer === 'string' && !/^\d+$/.test(answer)) answer = chapter.puzzle.options.indexOf(answer);
      else answer = Number(answer);
      if (!Number.isInteger(answer) || answer < 0 || answer >= chapter.puzzle.options.length) return result(false, type, '请选择有效的推理答案。');
      const correct = answer === chapter.puzzle.correctIndex;
      applyEffects(Object.assign({}, ACTION_INFO.puzzle, correct ? { insight: 3, trust: 1 } : { energy: -10 }));
      state.flags.puzzleAttempts = (state.flags.puzzleAttempts || 0) + 1;
      if (correct) {
        state.flags.puzzleSolved = true;
        state.flags[`puzzle_${chapter.id}`] = true;
        state.flags.totalPuzzlesSolved = (state.flags.totalPuzzlesSolved || 0) + 1;
      }
      message = correct ? `推理成立：${chapter.puzzle.explanation || '你将线索连接起来。'}` : '推理尚有缺口，可以重新检查线索后再尝试。';
      extra.correct = correct;
    } else {
      applyEffects(type === 'rest'
        ? { time: ACTION_INFO.rest.time, hp: rules.restHpGain, energy: rules.restEnergyGain, money: -rules.restCost }
        : ACTION_INFO[type]);
      const labels = { rest: '暂停行动，休息恢复。', research: '推进一次科研。', politics: '处理一次人际事务。' };
      message = labels[type];
      if (type === 'work') {
        const moneyBefore = state.money;
        state.money = clamp(state.money + rules.workStipend, 0, 99999);
        const stipendCredited = state.money - moneyBefore;
        state.salary.accrued += rules.workWage;
        state.salary.workCount += 1;
        const firstWorkThisMonth = !state.salary.penaltyChecked;
        const salaryPenaltyTriggered = firstWorkThisMonth && rules.salaryPenaltyProbability > 0 && nextRandom() < rules.salaryPenaltyProbability;
        state.salary.penaltyChecked = true;
        if (salaryPenaltyTriggered) {
          state.salary.reduced = true;
          state.salary.rate = 0.5;
          recordOccurrence({ id: 'salary_penalty', title: '本月工资减半', category: 'misfortune', actionCount: state.actionCount + 1 });
          log(`第 ${state.salary.month} 月首次临床工作判定发生减薪事件：本月工资只发 50%，本月不再重复判定；即时津贴、剧情与支线奖励不受影响。`, 'salary_penalty');
        }
        extra.wagesAccrued = rules.workWage;
        extra.stipendCredited = stipendCredited;
        extra.salaryPenaltyTriggered = salaryPenaltyTriggered;
        message = `完成临床工作，即时获得 ${stipendCredited} 金币津贴（不受半薪影响）；应发工资增加 ${rules.workWage} 金币，本月累计 ${state.salary.accrued} 金币，满 28 个游戏日统一${state.salary.reduced ? '按 50%' : '全额'}发放。${salaryPenaltyTriggered ? '本月首次工作触发减薪，本月工资减至 50%。' : ''}`;
      }
      if (type === 'rest') state.flags.restCount = (state.flags.restCount || 0) + 1;
      else state.flags[`${type}Count`] = (state.flags[`${type}Count`] || 0) + 1;
    }
    return finishAction(type, message, timeBefore, extra, action);
  }

  function resolveEvent(choiceId) {
    if (state.status !== 'playing' || !state.event) return result(false, 'resolveEvent', '没有待处理的厄运事件。');
    const event = state.event;
    const choice = event.choices.find((item) => String(item.id) === String(choiceId));
    if (!choice) return result(false, 'resolveEvent', '未知应对选项。');
    if (!conditionsMet(choice.requires)) return result(false, 'resolveEvent', '目前不满足这个应对选项的条件。');
    const timeBefore = state.time;
    applyEffects(choice.effects, choice.flags);
    const activatedStatusEffect = activateStatusEffect(event);
    state.event = null;
    if (event.category === 'misfortune') state.cooldown = rules.eventCooldown;
    state._belowHandled = state.hp < rules.threshold;
    if (event.category === 'misfortune') state.flags.eventsSurvived = (state.flags.eventsSurvived || 0) + 1;
    log(`${event.title}：${choice.label}`, 'event_resolution');
    if (state.hp <= 0) fail('hp_zero', { actionType: 'resolveEvent', eventId: event.id, occurrenceId: event.occurrenceId || null });
    const message = event.statusEffect && !activatedStatusEffect ? '同种持续状态已存在，或负面状态已达上限，本次不额外叠加。' : (choice.text || choice.label);
    return result(true, 'resolveEvent', state.failure ? state.failure.title : message, { consumedTime: state.time - timeBefore, resolvedEventId: event.id, activatedStatusEffect });
  }

  function choiceAvailable(choice) {
    if (getChapter().presentation === 'video') {
      if (!isVideoCompleted()) return false;
    } else {
      if (state.clues.length < numeric(choice.requiresClues)) return false;
      if (choice.requiresPuzzle && !state.flags.puzzleSolved) return false;
    }
    if (choice.requiresFlags && !Object.entries(choice.requiresFlags).every(([key, value]) => state.flags[key] === value)) return false;
    return conditionsMet(choice.requires);
  }
  function getAvailableChoices() {
    if (state.status !== 'playing' || state.event || assessmentActive()) return [];
    return (getChapter().choices || []).filter(choiceAvailable).map(clone);
  }
  function finalOutcome() {
    const completed = Object.values(state.chapterResults);
    const truths = completed.filter((entry) => entry.evidenceRequired >= 5 || entry.tone === 'truth' || entry.tone === 'good' || /(?:^|_)truth$/.test(String(entry.choiceId))).length;
    let id = 'survivor'; let title = '带着余痕继续生活';
    let text = '你走出了这段历程。有些关系与谜团仍未解决，但选择留下了属于你的轨迹。';
    if (state.insight >= 35 && state.trust >= 8 && state.hp >= rules.threshold && truths >= Math.ceil(chapters.length / 2)) {
      id = 'shared_dawn'; title = '共同迎来的晨光'; text = '积累的证据、保留下来的信任与仍可支撑生活的状态，让你拥有了新的出路。';
    } else if (state.insight >= 25 && state.trust < 0) {
      id = 'lonely_witness'; title = '孤独的见证者'; text = '你看清了许多真相，却在长久的选择中失去了一些能够同行的人。';
    } else if (state.hp < rules.threshold) {
      id = 'scarred_exit'; title = '伤痕累累的出口'; text = '你抵达终点时已经处在斩杀线之下。如何重新生活，成为最后留下的问题。';
    }
    return { id, title, text, hp: state.hp, trust: state.trust, insight: state.insight, truths, completedChapters: completed.length };
  }
  function chooseEnding(choiceId) {
    const blocked = guard('chooseEnding');
    if (blocked) return blocked;
    const chapter = getChapter();
    if (chapter.presentation === 'video' && !isVideoCompleted()) return result(false, 'chooseEnding', '请先看完本章视频，再选择接下来的行动。');
    const choice = (chapter.choices || []).find((item) => String(item.id) === String(choiceId));
    if (!choice || !choiceAvailable(choice)) return result(false, 'chooseEnding', '当前尚未满足这条分支的条件。');
    const timeBefore = state.time;
    applyEffects(choice.effects, choice.flags);
    if (state.hp <= 0) {
      fail('hp_zero', { actionType: 'chooseEnding' });
      return result(true, 'chooseEnding', state.failure.title, { consumedTime: state.time - timeBefore });
    }
    const ending = Object.assign({ title: choice.label, text: choice.text || '', tone: 'neutral' }, clone(choice.ending || {}));
    const record = Object.assign({}, ending, {
      chapterId: chapter.id, choiceId: choice.id, hp: state.hp, trust: state.trust, insight: state.insight,
      clues: state.clues.slice(), puzzleSolved: !!state.flags.puzzleSolved, evidenceRequired: numeric(choice.requiresClues),
    });
    state.chapterResults[String(chapter.id)] = record;
    state.flags[`chapter_${chapter.id}_choice`] = choice.id;
    if (!state.endings.some((item) => String(item.chapterId) === String(chapter.id) && item.choiceId === choice.id)) state.endings.push(clone(record));
    // Newly inserted chapters may precede an older save's completed finale.
    // Preserve existing results and finish only once the current catalog is full.
    state.status = getNextUnfinishedChapter() === null ? 'complete' : 'chapter_end';
    state.ending = clone(record);
    if (state.status === 'complete') state.finalEnding = finalOutcome();
    log(`章节结局：${ending.title}`, 'ending');
    return result(true, 'chooseEnding', ending.title, { consumedTime: state.time - timeBefore, chapterEnded: true, ending: clone(record), finalEnding: clone(state.finalEnding) });
  }

  function getMonthlyAssessment() {
    if (!assessmentActive()) return null;
    const assessment = clone(state.monthlyAssessment);
    const currentId = assessment.questionIds[assessment.index];
    assessment.question = clone(questionCatalog.find((question) => String(question.id) === String(currentId))) || null;
    assessment.blockedByEvent = !!state.event;
    assessment.blockedByFailure = state.status === 'failure';
    assessment.wrongHpLoss = rules.assessmentWrongHpLoss;
    assessment.hasHint = assessment.purchasedHints.some((id) => String(id) === String(currentId));
    assessment.hintCost = rules.assessmentHintCost;
    return assessment;
  }
  function buyMonthlyHint(questionId) {
    if (state.status !== 'playing') return result(false, 'buyMonthlyHint', '当前无法查阅考核提示，请先读取关键节点。');
    if (state.event) return result(false, 'buyMonthlyHint', '请先处理当前事件，再查阅考核提示。');
    if (!assessmentActive()) return result(false, 'buyMonthlyHint', '没有待完成的月度考核。');
    const assessment = state.monthlyAssessment;
    const currentId = assessment.questionIds[assessment.index];
    if (questionId == null || String(questionId) !== String(currentId)) return result(false, 'buyMonthlyHint', '只能查阅当前考核题的提示。');
    const question = questionCatalog.find((item) => String(item.id) === String(currentId));
    if (!question) return result(false, 'buyMonthlyHint', '存档中的考核题目暂未载入，请恢复相应题库。');
    if (assessment.purchasedHints.some((id) => String(id) === String(currentId))) {
      return result(true, 'buyMonthlyHint', '本题提示已购买，再次查阅不收费。', { question: clone(question), charged: 0, alreadyPurchased: true });
    }
    if (state.money < rules.assessmentHintCost) return result(false, 'buyMonthlyHint', `查阅本题提示需要 ${rules.assessmentHintCost} 金币，仍可直接作答。`, { charged: 0, alreadyPurchased: false });
    state.money -= rules.assessmentHintCost;
    assessment.purchasedHints.push(currentId);
    log(`第 ${assessment.month} 次月考第 ${assessment.index + 1} 题：花费 ${rules.assessmentHintCost} 金币查阅手册提示，本题再次查阅不收费。`, 'assessment_hint');
    return result(true, 'buyMonthlyHint', '已购买本题手册提示。', { question: clone(question), charged: rules.assessmentHintCost, alreadyPurchased: false });
  }
  function answerMonthly(answerIndex, expectedQuestionId) {
    if (state.status !== 'playing') return result(false, 'answerMonthly', '当前无法继续考核，请先读取关键节点。');
    if (state.event) return result(false, 'answerMonthly', '请先处理当前事件，再继续月度考核。');
    if (!assessmentActive()) return result(false, 'answerMonthly', '没有待完成的月度考核。');
    const assessment = state.monthlyAssessment;
    const questionId = assessment.questionIds[assessment.index];
    if (expectedQuestionId !== undefined && String(expectedQuestionId) !== String(questionId)) return result(false, 'answerMonthly', '这道题已经提交或不是当前题，请刷新考核题目。');
    const question = questionCatalog.find((item) => String(item.id) === String(questionId));
    if (!question) return result(false, 'answerMonthly', '存档中的考核题目暂未载入，请恢复相应题库。');
    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= question.options.length) return result(false, 'answerMonthly', '请选择当前考核题的有效答案。');
    if (assessment.answers.some((answer) => String(answer.questionId) === String(questionId))) return result(false, 'answerMonthly', '这道题已经提交，不能重复计分。');
    const correct = answerIndex === question.correctIndex;
    const recorded = rememberQuestion(question, answerIndex, 'monthly');
    if (recorded.alreadyRecorded) {
      reconcileQuestionHistory();
      return result(true, 'answerMonthly', '已恢复首次答案，本题不再扣血或计为新作答。', {
        review: true, correct: recorded.record.correct, recordedAnswer: recorded.record.answer,
        explanation: question.explanation || '', hpLoss: 0, assessmentCompleted: assessment.status === 'completed',
      });
    }
    const hpBefore = state.hp;
    if (!correct) applyEffects({ hp: -rules.assessmentWrongHpLoss });
    const answer = { questionId, answer: answerIndex, correct, explanation: question.explanation || '', hpLoss: hpBefore - state.hp };
    assessment.answers.push(answer);
    assessment.index += 1;
    assessment.score += correct ? 1 : 0;
    log(`第 ${assessment.month} 次月考第 ${assessment.index} 题：${correct ? '回答正确' : `回答错误，扣除 ${answer.hpLoss} 血量`}。`, 'assessment_answer');
    if (state.hp <= 0) {
      assessment.status = 'failed';
      fail('hp_zero', { actionType: 'monthly_assessment', assessmentMonth: assessment.month });
      return result(true, 'answerMonthly', '考核扣分后血量耗尽。', { correct, explanation: answer.explanation, hpLoss: answer.hpLoss, assessmentCompleted: false });
    }
    reconcileQuestionHistory();
    const completed = assessment.status === 'completed';
    // Answers consume no action or time. Only a new threshold crossing can
    // schedule a normal event here; no second low-HP lottery is performed.
    if (state.hp < rules.threshold && !state._belowHandled) triggerEvent();
    return result(true, 'answerMonthly', correct ? '回答正确。' : `回答错误，扣除 ${answer.hpLoss} 血量。`, {
      correct, explanation: answer.explanation, hpLoss: answer.hpLoss, assessmentCompleted: completed,
      assessment: clone(assessment), nextQuestionId: completed ? null : assessment.questionIds[assessment.index],
    });
  }

  function checkpoint(label = '关键节点') {
    if (state.status !== 'playing' || state.event || state.hp <= 0) return result(false, 'checkpoint', '请在可行动且没有待处理事件时设置节点。');
    state.checkpointLabel = String(label);
    checkpointData = clone(state);
    return result(true, 'checkpoint', `节点已记录：${state.checkpointLabel}`);
  }
  function restoreCheckpoint() {
    if (!checkpointData) return result(false, 'restoreCheckpoint', '尚无可读取的关键节点。');
    const collectedEndings = clone(state.endings);
    const survivalActionCount = state.survivalActionCount;
    const clinicalIdleActions = state.clinicalIdleActions;
    const lastTriggeredEvent = clone(state.lastTriggeredEvent);
    eventHighWater = Math.max(eventHighWater, state._eventSequence || 0);
    restoreAttempts += 1;
    state = clone(checkpointData);
    state.status = 'playing'; state.failure = null; state.event = null;
    state.hp = Math.max(1, Math.floor(rules.maxHp * rules.restoreHpRatio));
    state.survivalActionCount = survivalActionCount;
    state.clinicalIdleActions = clinicalIdleActions;
    state._eventSequence = eventHighWater;
    state.lastTriggeredEvent = lastTriggeredEvent;
    state.endings = collectedEndings;
    state.cooldown = Math.max(rules.eventCooldown, state.cooldown);
    state._belowHandled = false;
    // A restored node must not replay exactly the same random failure forever.
    state._rng = seedNumber(state._rng ^ Math.imul(restoreAttempts, 0x9e3779b9));
    state.flags.restoreCount = restoreAttempts;
    reconcileQuestionHistory();
    log(`回到节点：${state.checkpointLabel}，血量恢复至 ${Math.round(rules.restoreHpRatio * 100)}%；其余资源、剧情和持续状态恢复到节点。`, 'restore');
    return result(true, 'restoreCheckpoint', `已回到 ${state.checkpointLabel}，血量恢复至 ${Math.round(rules.restoreHpRatio * 100)}%。其余资源、剧情和持续状态按节点恢复，未来的随机事件会重新判定。`);
  }

  function enterChapter(chapter) {
    state.chapterId = chapter.id;
    state.clues = []; state.room = 'hospital'; state.visited = ['hospital'];
    state.event = null; state.failure = null; state.ending = null; state.finalEnding = null;
    state.status = 'playing';
    state.flags.puzzleSolved = false; state.flags.puzzleAttempts = 0;
    ['record', 'grant', 'neutral'].forEach((kind) => { state.flags[`prepared_${kind}`] = false; });
    if (chapter.flags && typeof chapter.flags === 'object') Object.assign(state.flags, clone(chapter.flags));
    if (chapter.presentation === 'video' && isVideoCompleted(chapter.id)) archiveVideoClues(chapter);
    reconcileQuestionHistory();
    state.checkpointLabel = `${chapter.title || `第 ${chapter.id} 章`} · 开始`;
    log(`进入${chapter.title || `第 ${chapter.id} 章`}`, 'chapter');
    checkpointData = clone(state);
    chapterStarts[String(chapter.id)] = clone(state);
  }
  function startChapter(id, params = {}) {
    const index = chapterIndex(id);
    if (index < 0) return result(false, 'startChapter', '章节不存在。');
    const chapter = chapters[index];
    if (params.replay) {
      const snapshot = chapterStarts[String(chapter.id)];
      if (!snapshot) return result(false, 'startChapter', '尚未到达这个章节，无法重玩。');
      const endings = clone(state.endings);
      const completedVideos = state.completedVideos.slice();
      const survivalActionCount = state.survivalActionCount;
      const clinicalIdleActions = state.clinicalIdleActions;
      const lastTriggeredEvent = clone(state.lastTriggeredEvent);
      eventHighWater = Math.max(eventHighWater, state._eventSequence || 0);
      state = clone(snapshot);
      state.completedVideos = completedVideos;
      state.survivalActionCount = survivalActionCount;
      state.clinicalIdleActions = clinicalIdleActions;
      state._eventSequence = eventHighWater;
      state.lastTriggeredEvent = lastTriggeredEvent;
      state.hp = Math.max(1, Math.floor(rules.maxHp * rules.restoreHpRatio));
      state._belowHandled = false;
      state.cooldown = Math.max(rules.eventCooldown, state.cooldown);
      state.endings = endings;
      for (let i = index; i < chapters.length; i += 1) {
        delete state.chapterResults[String(chapters[i].id)];
        if (i > index) delete chapterStarts[String(chapters[i].id)];
      }
      restoreAttempts += 1;
      state._rng = seedNumber(state._rng ^ Math.imul(restoreAttempts, 0x85ebca6b));
      state.flags.restoreCount = restoreAttempts;
      enterChapter(chapter);
      return result(true, 'startChapter', `开始分支重玩：血量恢复至 ${Math.round(rules.restoreHpRatio * 100)}%，其余资源和持续状态按章节节点恢复；本章及后续通关进度重置，已经收集的结局保留。`, { replay: true });
    }
    if (String(state.chapterId) === String(id) && state.status === 'playing') return result(true, 'startChapter', '已经在当前章节。');
    if (state.status === 'failure' || state.event) return result(false, 'startChapter', '请先处理当前事件或读取失败前的节点。');
    if (assessmentActive()) return result(false, 'startChapter', '请先完成月度考核，再继续章节。');
    if (state.chapterResults[String(id)]) return result(false, 'startChapter', '此章已经完成，请使用分支重玩。');
    if (chapters.slice(0, index).some((item) => !state.chapterResults[String(item.id)])) return result(false, 'startChapter', '请先完成前面的章节。');
    if (state.status === 'playing' && state.chapterId != null) return result(false, 'startChapter', '请先完成当前章节。');
    enterChapter(chapter);
    return result(true, 'startChapter', `进入${chapter.title || `第 ${chapter.id} 章`}`);
  }

  function newGame() {
    state = {
      chapterId: null, hp: rules.maxHp, energy: rules.initialEnergy, time: 0, money: rules.initialMoney,
      trust: 0, insight: 0, clues: [], allClues: [], flags: {}, room: 'hospital', visited: ['hospital'],
      actionCount: 0, cooldown: 0, event: null, status: 'playing', failure: null, endings: [],
      survivalActionCount: 0, clinicalIdleActions: 0, researchIdleUnits: 0,
      statusEffects: [], completedVideos: [], completedSideVideos: [], videoDays: 0,
      _eventSequence: eventHighWater, lastTriggeredEvent: null,
      chapterResults: {}, checkpointLabel: '', log: [], ending: null, finalEnding: null,
      _rng: initialSeed, _belowHandled: false,
      day: 1, completedDays: 0, dayPhaseIndex: 0, dayPhase: DAY_PHASES[0],
      monthlyAssessment: null, completedAssessments: [], _lastAssessmentMonth: 0,
      salary: newSalary(1), salaryPayments: [],
    };
    checkpointData = null; chapterStarts = {}; restoreAttempts = 0;
    clampResources(); enterChapter(chapters[0]);
    return result(true, 'newGame', '新的故事开始了。');
  }
  function getMemorial() { return memorial.read(); }
  function retryMemorialSave() {
    const retried = memorial.retry();
    if (state.failure && state.failure.deathId) {
      const record = memorial.read().records.find((item) => item.deathId === state.failure.deathId);
      state.failure.memorialSaved = !!record && record.persisted;
      state.failure.memorialError = retried.storageError || null;
    }
    return result(retried.ok, 'retryMemorialSave', retried.ok ? '纪念记录已保存。' : `纪念记录尚未保存：${retried.storageError}`, retried);
  }
  function save() {
    if (questionHistory.flush) questionHistory.flush();
    const memorialResult = retryMemorialSave();
    const data = { version: 2, state: clone(state), checkpoint: clone(checkpointData), chapterStarts: clone(chapterStarts), restoreAttempts };
    const json = JSON.stringify(data);
    try {
      if (options.storage) {
        let accepted;
        if (typeof options.storage.setItem === 'function') accepted = options.storage.setItem(storageKey, json);
        else if (typeof options.storage.setStorageSync === 'function') accepted = options.storage.setStorageSync(storageKey, json);
        else if (typeof options.storage.set === 'function') accepted = options.storage.set(storageKey, json);
        else return result(false, 'save', '存档接口不可用。');
        if (accepted === false) return result(false, 'save', '存储拒绝保存进度，当前进度仍保留在本次运行中。');
        if (accepted && typeof accepted.then === 'function') return result(false, 'save', '当前存档需要同步存储接口。');
      }
      memorySave = json;
      const questionHistoryWarning = questionHistory.getState().storageError;
      const warnings = [memorialResult.ok ? null : `纪念记录尚未持久保存：${memorialResult.storageError}`,
        questionHistoryWarning ? `已做题记录尚未持久保存：${questionHistoryWarning}` : null].filter(Boolean);
      return result(true, 'save', warnings.length ? `进度已保存；${warnings.join('；')}` : '进度已保存。', {
        data, json, memorialWarning: memorialResult.ok ? null : memorialResult.storageError, questionHistoryWarning,
      });
    } catch (error) { return result(false, 'save', `保存失败：${error.message}`); }
  }
  function validState(value) {
    return value && chapterIndex(value.chapterId) >= 0 && STATUSES.has(value.status)
      && ['clues', 'allClues', 'visited', 'endings', 'log'].every((key) => Array.isArray(value[key]))
      && (value.completedVideos === undefined || (Array.isArray(value.completedVideos) && value.completedVideos.every((id) => chapterIndex(id) >= 0)))
      && (value.completedSideVideos === undefined || (Array.isArray(value.completedSideVideos) && value.completedSideVideos.every((id) => !!sideStory(id))))
      && (value.videoDays === undefined || (Number.isInteger(value.videoDays) && value.videoDays >= 0))
      && (value.researchIdleUnits === undefined || (Number.isSafeInteger(value.researchIdleUnits) && value.researchIdleUnits >= 0
        && (value.status === 'failure' || value.researchIdleUnits < RESEARCH_ABSENCE_UNITS)))
      && value.flags && typeof value.flags === 'object' && value.chapterResults && typeof value.chapterResults === 'object'
      && ['hp', 'energy', 'money', 'trust', 'insight', 'time', 'actionCount', 'cooldown', '_rng'].every((key) => Number.isFinite(value[key]))
      && (!value.event || ((EVENTS[value.event.id] || BENEFICIAL_EVENTS[value.event.id]) && Array.isArray(value.event.choices)))
      && (value.status !== 'failure' || (value.failure && typeof value.failure.title === 'string'));
  }
  function normalizeSavedState(value, version) {
    const normalized = clone(value);
    // Older completed videos were free; do not retroactively advance their days.
    normalized.videoDays = normalized.videoDays || 0;
    syncCalendar(normalized);
    normalized.completedVideos = Array.from(new Set((normalized.completedVideos || []).map((id) => chapters[chapterIndex(id)].id)));
    normalized.completedSideVideos = Array.from(new Set((normalized.completedSideVideos || []).map((id) => sideStory(id).id)));
    normalized._eventSequence = Math.max(0, Math.floor(numeric(normalized._eventSequence, 0)));
    if (!normalized.lastTriggeredEvent) normalized.lastTriggeredEvent = null;
    normalized.survivalActionCount = Math.max(0, Math.floor(numeric(normalized.survivalActionCount, normalized.actionCount)));
    normalized.clinicalIdleActions = Math.max(0, Math.floor(numeric(normalized.clinicalIdleActions, 0)));
    // v0.4 and older saves predate this rule. Give those snapshots a full first
    // window; subsequent saves retain the counter rather than resetting it.
    normalized.researchIdleUnits = normalized.researchIdleUnits === undefined ? 0 : normalized.researchIdleUnits;
    if (!Array.isArray(normalized.statusEffects)) normalized.statusEffects = [];
    for (const effect of normalized.statusEffects) {
      effect.kind = effect.kind || (EVENTS[effect.id].statusEffect.kind === 'heal' ? 'heal' : 'damage');
      effect.isBeneficial = effect.kind === 'heal';
    }
    if (!Array.isArray(normalized.completedAssessments)) normalized.completedAssessments = [];
    if (!normalized.salary) normalized.salary = newSalary(Math.floor(normalized.completedDays / DAYS_PER_ASSESSMENT) + 1);
    if (typeof normalized.salary.penaltyChecked !== 'boolean') normalized.salary.penaltyChecked = normalized.salary.workCount > 0 || normalized.salary.reduced;
    if (!Array.isArray(normalized.salaryPayments)) normalized.salaryPayments = [];
    if (!normalized.monthlyAssessment) normalized.monthlyAssessment = null;
    for (const assessment of [normalized.monthlyAssessment, ...normalized.completedAssessments]) {
      if (assessment && !Array.isArray(assessment.purchasedHints)) assessment.purchasedHints = [];
    }
    if (!Number.isFinite(normalized._lastAssessmentMonth)) {
      // Legacy saves were played before the assessment system existed. Do not
      // retroactively punish all previously completed months on import.
      normalized._lastAssessmentMonth = version === 1 ? Math.floor(normalized.completedDays / DAYS_PER_ASSESSMENT) : 0;
    }
    return normalized;
  }
  function validAssessment(value) {
    if (value === null || value === undefined) return true;
    return Number.isInteger(value.month) && value.month >= 1 && Array.isArray(value.questionIds)
      && Array.isArray(value.answers) && Number.isInteger(value.index) && value.index >= 0 && value.index <= value.questionIds.length
      && ['active', 'completed', 'failed', 'unavailable'].includes(value.status)
      && value.answers.length === value.index
      && new Set(value.questionIds.map(String)).size === value.questionIds.length
      && (value.purchasedHints === undefined || (Array.isArray(value.purchasedHints)
        && value.purchasedHints.every((id) => value.questionIds.some((questionId) => String(questionId) === String(id)))
        && new Set(value.purchasedHints.map(String)).size === value.purchasedHints.length))
      && (value.status !== 'active' || value.index < value.questionIds.length);
  }
  function validSalary(value) {
    if (value === undefined || value === null) return true;
    return Number.isInteger(value.month) && value.month >= 1
      && Number.isFinite(value.accrued) && value.accrued >= 0
      && typeof value.reduced === 'boolean' && value.rate === (value.reduced ? 0.5 : 1)
      && (value.penaltyChecked === undefined || typeof value.penaltyChecked === 'boolean')
      && Number.isInteger(value.workCount) && value.workCount >= 0;
  }
  function validStatusEffects(value) {
    if (value === undefined || value === null) return true;
    return Array.isArray(value) && new Set(value.map((item) => item && item.id)).size === value.length
      && value.every((item) => item && EVENTS[item.id] && EVENTS[item.id].statusEffect
        && Number.isInteger(item.remainingActions) && item.remainingActions > 0
        && item.remainingActions <= EVENTS[item.id].statusEffect.durationDays * ACTIONS_PER_DAY
        && Number.isInteger(item.tickIn) && item.tickIn >= 1 && item.tickIn <= ACTIONS_PER_DAY
        && Number.isFinite(item.hpPerTick) && item.hpPerTick >= 0
        && Number.isInteger(item.ticksRemaining) && item.ticksRemaining >= 1
        && (item.kind === undefined || ['heal', 'damage'].includes(item.kind))
        && Number.isFinite(item.startedAtAction));
  }
  function load(input) {
    try {
      let raw = input;
      if (raw === undefined && options.storage) {
        if (typeof options.storage.getItem === 'function') raw = options.storage.getItem(storageKey);
        else if (typeof options.storage.getStorageSync === 'function') raw = options.storage.getStorageSync(storageKey);
        else if (typeof options.storage.get === 'function') raw = options.storage.get(storageKey);
      }
      if (raw === undefined || raw === null || raw === '') raw = memorySave;
      if (!raw) return result(false, 'load', '还没有存档。');
      const data = typeof raw === 'string' ? JSON.parse(raw) : clone(raw);
      if (![1, 2].includes(data.version) || !validState(data.state) || !validState(data.checkpoint)
          || data.checkpoint.status !== 'playing' || data.checkpoint.event || data.checkpoint.hp <= 0
          || !data.chapterStarts || typeof data.chapterStarts !== 'object'
          || Object.values(data.chapterStarts).some((item) => !validState(item))
          || ![data.state, data.checkpoint, ...Object.values(data.chapterStarts)].every((item) => validAssessment(item.monthlyAssessment) && validSalary(item.salary) && validStatusEffects(item.statusEffects))) {
        return result(false, 'load', '存档不完整或不兼容，当前进度未改变。');
      }
      state = normalizeSavedState(data.state, data.version); checkpointData = normalizeSavedState(data.checkpoint, data.version);
      eventHighWater = Math.max(eventHighWater, state._eventSequence);
      state._eventSequence = eventHighWater;
      chapterStarts = Object.fromEntries(Object.entries(data.chapterStarts).map(([key, value]) => [key, normalizeSavedState(value, data.version)]));
      restoreAttempts = Math.max(0, Math.floor(numeric(data.restoreAttempts)));
      clampResources();
      reconcileQuestionHistory();
      // The same failed save carries its original death id and real timestamp.
      // Ensure a previously unsaved record exists, but never mint a new death.
      if (state.failure && state.failure.memorialRecord && state.failure.deathId) {
        const retained = memorial.append(state.failure.memorialRecord);
        state.failure.memorialSaved = retained.ok;
        state.failure.memorialError = retained.storageError || null;
      }
      memorySave = JSON.stringify(data);
      return result(true, 'load', '已恢复保存的进度。');
    } catch (error) { return result(false, 'load', `读取失败：${error.message}`); }
  }

  const api = { getChapter, getNextUnfinishedChapter, getAvailableChoices, isVideoCompleted, getSideStories, isSideVideoCompleted, canPlaySideVideo, getUnansweredQuestions, isQuestionAnswered, getAnsweredQuestions, getQuestionHistory, getRisks, getMonthlyAssessment, getSalary, getResearchDeadline, getStatusEffects, getMemorial };
  for (const [name, method] of Object.entries({ act, checkpoint, restoreCheckpoint, save, load, newGame, startChapter, resolveEvent, chooseEnding, completeVideo, completeSideVideo, buyMonthlyHint, answerMonthly, retryMemorialSave })) {
    api[name] = (...args) => { emittedEvents = []; return method(...args); };
  }
  Object.defineProperty(api, 'state', { enumerable: true, get: () => state });
  Object.defineProperty(api, 'rules', { enumerable: true, get: () => clone(rules) });
  newGame();
  return api;
}

module.exports = { createGame, DEFAULT_RULES, EVENTS, FATAL_EVENTS, BENEFICIAL_EVENTS, ACTION_INFO, ACTIONS_PER_DAY, CLINICAL_ABSENCE_DAYS, CLINICAL_ABSENCE_UNITS, RESEARCH_ABSENCE_DAYS, RESEARCH_ABSENCE_UNITS, DAYS_PER_ASSESSMENT, DAY_PHASES, LEADERSHIP_EVENT_IDS };
