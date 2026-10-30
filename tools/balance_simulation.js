#!/usr/bin/env node
'use strict';
/** Monte Carlo gameplay calibration only. Uses real content and public engine API.
 * No direct state mutations, timed death, hidden difficulty or medical claims.
 * External elapsed exposure continues through checkpoint restores. One real
 * action is one unit; a first video completion adds five units (one day).
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
const {createGame,ACTION_INFO,DEFAULT_RULES,CLINICAL_ABSENCE_UNITS}=require('../src/engine');
const chapters=require('../data/chapters.json');
const knowledge=require('../data/knowledge.json');
const npcs=require('../data/npcs.json');
const LOADED_SOURCE_HASHES=Object.fromEntries(['src/engine.js','src/memorial.js','data/chapters.json','data/knowledge.json','data/npcs.json','tools/balance_simulation.js'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,p))).digest('hex')]));
const LOADED_DEFAULT_RULES=JSON.parse(JSON.stringify(DEFAULT_RULES));
const ORIGINAL_HP=Object.fromEntries(['work','research','politics'].map(k=>[k,ACTION_INFO[k].hp]));
const BASE_FATAL={...DEFAULT_RULES.fatalRisk};
const PROFILES={
 cautious:{label:'主动休息',hpAt:60,energyAt:30,restAdherence:.98,maxRest:2,prepareChance:.8,work:3,research:1,politics:1,accuracy:.85,entertainChance:.7,eventBestChance:.98},
 balanced:{label:'中等策略',hpAt:35,energyAt:18,restAdherence:.85,maxRest:2,prepareChance:.35,work:4,research:2,politics:1,accuracy:.8,entertainChance:.4,eventBestChance:.8},
 risky:{label:'冒险策略',hpAt:15,energyAt:5,restAdherence:.4,maxRest:1,prepareChance:0,work:5,research:3,politics:2,accuracy:.75,entertainChance:.2,eventBestChance:.3},
 overwork:{label:'忽视休息',hpAt:0,energyAt:0,restAdherence:0,maxRest:0,prepareChance:0,work:5,research:3,politics:2,accuracy:.75,entertainChance:0,eventBestChance:.3},
};
function mixSeed(x){x=(x+0x9e3779b9)>>>0;x=Math.imul(x^(x>>>16),0x21f0aaad);x=Math.imul(x^(x>>>15),0x735a2d97);return(x^(x>>>15))>>>0;}
function rng(seed){let x=(seed>>>0)||1;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
function rulesFor({hp=14,energy=35,mult=1,fatalRisk}={}){return {restHpGain:hp,restEnergyGain:energy,fatalRisk:fatalRisk||Object.fromEntries(Object.entries(BASE_FATAL).map(([k,v])=>[k,v*mult]))};}
function scoreEffects(e={}){return (e.hp||0)+.45*(e.energy||0)+.7*(e.trust||0)+.05*(e.money||0);}
function chooseAnswer(q,random,accuracy){return random()<accuracy?q.correctIndex:(q.correctIndex+1+Math.floor(random()*(q.options.length-1)))%q.options.length;}
function chapterPlan(ch,profile,order){
 const h=ch.clues.filter(c=>c.room==='hospital'),o=ch.clues.filter(c=>c.room==='other');
 const tasks=[];const risk=[];
 for(let i=0;i<Math.max(profile.work,profile.research,profile.politics);i++){
  if(i<profile.work)risk.push({type:'work'});
  if(i<profile.research)risk.push({type:'research'});
  if(i<profile.politics)risk.push({type:'politics'});
 }
 const content=ch.presentation==='video'?[{type:'clinical',questionId:knowledge[order%knowledge.length].id},
  {type:'npc',npcId:npcs[order%npcs.length].id},{type:'npc',npcId:npcs[order%npcs.length].id,completeQuest:true}]:[...h.map(c=>({type:'inspect',clueId:c.id})),{type:'clinical',questionId:knowledge[order%knowledge.length].id},
  {type:'npc',npcId:npcs[order%npcs.length].id},{type:'travel',room:'other'},...o.map(c=>({type:'inspect',clueId:c.id})),
  {type:'puzzle'},{type:'npc',npcId:npcs[order%npcs.length].id,completeQuest:true}];
 // Alternate occupational tasks and story investigation, never repeat invalid clues.
 while(content.length||risk.length){if(content.length)tasks.push(content.shift());if(risk.length)tasks.push(risk.shift());}
 return tasks;
}
function simulate(seed,strategy='balanced',config={},options={}){
 const profile=PROFILES[strategy];if(!profile)throw Error('Unknown strategy '+strategy);
 const random=rng(mixSeed((seed^0x51ed270b)>>>0));
 const game=createGame(chapters,{seed,knowledge,npcs,rules:rulesFor(config),now:()=>0});
 const horizon=options.horizon||2500;
 let effective=0,lastDeathAt=0,taskIndex=0,restStreak=0,plan=chapterPlan(chapters[0],profile,0),iterations=0;
 const intervals=[],causes={},categories={},actions={},chaptersSeen=new Set(),answers={correct:0,total:0};
 let firstDeath=null,restoredDeaths=0,monthly=0,hints=0,invalid=0,sinceClinical=0,maxClinicalGap=0;
 function requireOk(result){if(!result||!result.ok){invalid++;throw Error(JSON.stringify({seed,strategy,chapter:game.state.chapterId,result}));}return result;}
 function action(a){const before=game.state.actionCount;const r=requireOk(game.act(a));const delta=game.state.actionCount-before;if(delta!==1)throw Error('Expected one effective action: '+JSON.stringify({a,delta,r}));effective++;sinceClinical++;maxClinicalGap=Math.max(maxClinicalGap,sinceClinical);if(a.type==='work'||a.type==='clinical')sinceClinical=0;actions[a.type]=(actions[a.type]||0)+1;return r;}
 function resetPlan(){const i=chapters.findIndex(c=>c.id===game.state.chapterId);plan=chapterPlan(game.getChapter(),profile,i);taskIndex=0;restStreak=0;}
 while(effective<horizon&&iterations++<horizon*12){
  const s=game.state;chaptersSeen.add(s.chapterId);
  if(s.status==='failure'){
   const interval=effective-lastDeathAt;intervals.push(interval);lastDeathAt=effective;if(firstDeath===null)firstDeath=effective;
   const cause=s.failure.eventId||s.failure.id;causes[cause]=(causes[cause]||0)+1;const cat=s.failure.memorialRecord.category;categories[cat]=(categories[cat]||0)+1;
   if(options.firstDeathOnly)break;
   requireOk(game.restoreCheckpoint());
   const restoredHp=Math.max(1,Math.floor(game.rules.maxHp*(game.rules.restoreHpRatio===undefined?1:game.rules.restoreHpRatio)));if(game.state.hp!==restoredHp)throw Error('Unexpected checkpoint HP restoration');
   restoredDeaths++;resetPlan();continue;
  }
  if(s.status==='complete')break;
  if(s.event){
   const choices=s.event.choices.filter(c=>c.available!==false);
   const choice=random()<profile.eventBestChance?choices.slice().sort((a,b)=>scoreEffects(b.effects)-scoreEffects(a.effects))[0]:choices[0];
   requireOk(game.resolveEvent(choice.id));continue;
  }
  const exam=game.getMonthlyAssessment();
  if(exam&&exam.status==='active'){
   if(game.state.money>=exam.hintCost&&random()<.3){requireOk(game.buyMonthlyHint(exam.question.id));hints++;}
   const answer=chooseAnswer(exam.question,random,profile.accuracy);answers.total++;answers.correct+=answer===exam.question.correctIndex?1:0;
   requireOk(game.answerMonthly(answer,exam.question.id));monthly++;continue;
  }
  if(s.status==='chapter_end'){
   const i=chapters.findIndex(c=>c.id===s.chapterId);requireOk(game.startChapter(chapters[i+1].id));resetPlan();continue;
  }
  if(game.getChapter().presentation==='video'&&!game.isVideoCompleted(s.chapterId)){
   const r=requireOk(game.completeVideo(s.chapterId));
   const units=r.elapsedUnits||0;
   effective+=units;sinceClinical+=units;maxClinicalGap=Math.max(maxClinicalGap,sinceClinical);
   restStreak=0;continue;
  }
  // Return to clinical work near the inactivity threshold, including video time.
  if(sinceClinical>=CLINICAL_ABSENCE_UNITS-1){action({type:'work'});restStreak=0;continue;}
  // Prevent a low-HP threshold from degenerating into an endless rest-only policy.
  const needsRest=s.hp<profile.hpAt||s.energy<profile.energyAt;
  if(needsRest&&restStreak<profile.maxRest&&random()<profile.restAdherence){
   const useEntertainment=s.money>=10&&s.hp<70&&random()<profile.entertainChance;
   action({type:useEntertainment?'entertain':'rest'});restStreak++;continue;
  }
  if(taskIndex>=plan.length){
   let choices=game.getAvailableChoices();if(!choices.length)throw Error('No valid ending');
   let choice;
   if(strategy==='cautious')choice=choices.slice().sort((a,b)=>scoreEffects(b.effects)-scoreEffects(a.effects))[0];
   else if(strategy==='risky'||strategy==='overwork')choice=choices.slice().sort((a,b)=>(b.effects.money||0)-(a.effects.money||0))[0];
   else {const roll=random(),target=roll<.5?5:roll<.85?3:0;choice=choices.find(c=>c.requiresClues===target)||choices[0];}
   requireOk(game.chooseEnding(choice.id));continue;
  }
  const task=plan[taskIndex];
  // Completed global lessons and quests are skipped, not submitted again for free time.
  if(task.type==='clinical'&&game.isQuestionAnswered(task.questionId)){taskIndex++;continue;}
  if(task.type==='npc'&&task.completeQuest&&s.flags['npc_done_'+task.npcId]){taskIndex++;continue;}
  if(task.type==='puzzle'&&s.flags.puzzleSolved){taskIndex++;continue;}
  if(task.type==='inspect'&&s.clues.includes(task.clueId)){taskIndex++;continue;}
  if(task.type==='travel'&&s.room===task.room){taskIndex++;continue;}
  const prepareKind={work:'record',research:'grant',politics:'neutral'}[task.type];
  if(prepareKind&&s.money>=5&&!s.flags['prepared_'+prepareKind]&&random()<profile.prepareChance){action({type:'prepare',kind:prepareKind});restStreak=0;continue;}
  const a={...task};
  if(a.type==='clinical'||a.type==='puzzle'){
   const q=a.type==='clinical'?knowledge.find(q=>q.id===a.questionId):game.getChapter().puzzle;
   a.answer=chooseAnswer(q,random,profile.accuracy);answers.total++;answers.correct+=a.answer===q.correctIndex?1:0;
  }
  const result=action(a);restStreak=0;
  if(a.type!=='puzzle'||result.correct)taskIndex++;
 }
 if(iterations>=horizon*12)throw Error('Loop guard reached');
 // If an effective action at the horizon kills the player, include that terminal event.
 if(game.state.status==='failure'&&effective!==lastDeathAt){
  intervals.push(effective-lastDeathAt);lastDeathAt=effective;if(firstDeath===null)firstDeath=effective;
  const c=game.state.failure.eventId||game.state.failure.id;causes[c]=(causes[c]||0)+1;const cat=game.state.failure.memorialRecord.category;categories[cat]=(categories[cat]||0)+1;
 }
 return {seed,strategy,effective,deaths:intervals.length,intervalSum:intervals.reduce((a,b)=>a+b,0),intervals,
  firstDeath,tail:effective-lastDeathAt,completed:game.state.status==='complete',horizonCensored:effective>=horizon&&game.state.status!=='complete',
  causes,categories,actions,answers,monthly,hints,invalid,chaptersReached:chaptersSeen.size,restoredDeaths,maxClinicalGap};
}
function quantile(v,p){if(!v.length)return null;const a=v.slice().sort((x,y)=>x-y),j=(a.length-1)*p,i=Math.floor(j);return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(j-i);}
function mean(v){return v.length?v.reduce((a,b)=>a+b,0)/v.length:null;}
function summarize(runs,boot=1000){
 const total=runs.reduce((a,r)=>a+r.effective,0),deaths=runs.reduce((a,r)=>a+r.deaths,0),intervalSum=runs.reduce((a,r)=>a+r.intervalSum,0);
 const intervals=runs.flatMap(r=>r.intervals),first=runs.flatMap(r=>r.firstDeath===null?[]:[r.firstDeath]),recurrent=runs.flatMap(r=>r.intervals.slice(1));
 const causes={},categories={},actions={};let correct=0,answered=0;
 for(const r of runs){for(const [k,v]of Object.entries(r.causes))causes[k]=(causes[k]||0)+v;for(const [k,v]of Object.entries(r.categories))categories[k]=(categories[k]||0)+v;for(const [k,v]of Object.entries(r.actions))actions[k]=(actions[k]||0)+v;correct+=r.answers.correct;answered+=r.answers.total;}
 const random=rng(0x773411),bootstrap=[],firstBoot=[],repeatBoot=[],rateBoot=[];
 for(let b=0;b<boot;b++){
  let sum=0,n=0,fs=0,fn=0,rs=0,rn=0,exposure=0;
  for(let i=0;i<runs.length;i++){const r=runs[Math.floor(random()*runs.length)];sum+=r.intervalSum;n+=r.deaths;exposure+=r.effective;if(r.firstDeath!==null){fs+=r.firstDeath;fn++;}rs+=r.intervalSum-(r.firstDeath||0);rn+=Math.max(0,r.deaths-1);}
  if(n){bootstrap.push(sum/n/5);rateBoot.push(exposure/n/5);}if(fn)firstBoot.push(fs/fn/5);if(rn)repeatBoot.push(rs/rn/5);
 }
 const ci=a=>[quantile(a,.025),quantile(a,.975)];
 const actionTotal=Object.values(actions).reduce((sum,n)=>sum+n,0);
 return {seeds:runs.length,totalElapsedUnits:total,totalEffectiveActions:actionTotal,deaths,meanIntervalUnits:deaths?intervalSum/deaths:null,meanIntervalDays:deaths?intervalSum/deaths/5:null,meanIntervalDaysCI95:ci(bootstrap),
  firstDeathDays:mean(first)===null?null:mean(first)/5,firstDeathDaysCI95:ci(firstBoot),firstDeathObserved:first.length,
  restoredIntervalDays:mean(recurrent)===null?null:mean(recurrent)/5,restoredIntervalDaysCI95:ci(repeatBoot),restoredIntervals:recurrent.length,
  exposurePerDeathDays:deaths?total/deaths/5:null,exposurePerDeathDaysCI95:ci(rateBoot),
  intervalQuantileDays:{p10:quantile(intervals,.1)/5,p50:quantile(intervals,.5)/5,p90:quantile(intervals,.9)/5},
  diedWithinSevenDaysFraction:intervals.filter(x=>x<=35).length/intervals.length,
  completedCampaigns:runs.filter(r=>r.completed).length,horizonCensored:runs.filter(r=>r.horizonCensored).length,terminalTailUnits:runs.reduce((a,r)=>a+r.tail,0),
  categoryCounts:categories,categoryFractions:Object.fromEntries(Object.entries(categories).map(([k,v])=>[k,v/deaths])),causeCounts:causes,causeFractions:Object.fromEntries(Object.entries(causes).map(([k,v])=>[k,v/deaths])),
  actionCounts:actions,actionFractions:Object.fromEntries(Object.entries(actions).map(([k,v])=>[k,actionTotal?v/actionTotal:0])),
  accuracy:answered?correct/answered:null,answers:answered,monthlyAnswers:runs.reduce((a,r)=>a+r.monthly,0),
  meanChaptersReached:mean(runs.map(r=>r.chaptersReached)),invalidActions:runs.reduce((a,r)=>a+r.invalid,0),maxClinicalGap:Math.max(...runs.map(r=>r.maxClinicalGap))};
}
function runExperiment(config,strategies=['balanced'],n=1000,options={}){
 const results={};
 // Experimental action damage changes affect this simulation process only.
 // Production source is never edited and effects are restored even if a run fails.
 try {
  for(const type of Object.keys(ORIGINAL_HP))ACTION_INFO[type].hp=config.actionHpLoss&&config.actionHpLoss[type]!==undefined?-config.actionHpLoss[type]:ORIGINAL_HP[type];
  for(const strategy of strategies){const runs=[];for(let i=0;i<n;i++)runs.push(simulate(mixSeed((options.seedStart||10000)+i),strategy,config,options));results[strategy]=summarize(runs,options.boot||1000);if(options.keepRuns)results[strategy].runs=runs;if(options.onProgress)options.onProgress(strategy,results[strategy]);}
 } finally {for(const type of Object.keys(ORIGINAL_HP))ACTION_INFO[type].hp=ORIGINAL_HP[type];}
 return {configuration:config,loadedDefaultRules:LOADED_DEFAULT_RULES,effectiveRules:{...LOADED_DEFAULT_RULES,...rulesFor(config)},experimentalActionHpLoss:config.actionHpLoss||null,targetDays:7,actionsPerDay:5,profiles:PROFILES,results};
}
function sourceHashes(){return {...LOADED_SOURCE_HASHES};}
function args(argv){const out={};for(let i=0;i<argv.length;i++){if(argv[i].startsWith('--'))out[argv[i].slice(2)]=argv[i+1]&&!argv[i+1].startsWith('--')?argv[++i]:true;}return out;}
if(require.main===module){
 const a=args(process.argv.slice(2));const config={hp:Number(a.hp===undefined?14:a.hp),energy:Number(a.energy===undefined?35:a.energy),mult:Number(a.mult===undefined?1:a.mult)};
 if(a['fatal-work']!==undefined||a['fatal-research']!==undefined||a['fatal-politics']!==undefined)config.fatalRisk={work:Number(a['fatal-work']===undefined?.025:a['fatal-work']),research:Number(a['fatal-research']===undefined?.03:a['fatal-research']),politics:Number(a['fatal-politics']===undefined?.025:a['fatal-politics'])};
 const partial={configuration:config,sourceHashes:sourceHashes(),completed:false,results:{}};
 const onProgress=(strategy,result)=>{partial.results[strategy]=result;if(a.out){fs.mkdirSync(path.dirname(path.resolve(a.out)),{recursive:true});fs.writeFileSync(a.out+'.partial.json',JSON.stringify(partial,null,2)+'\n');}process.stderr.write(JSON.stringify({strategy,meanDays:result.meanIntervalDays,ci95:result.meanIntervalDaysCI95,deaths:result.deaths})+'\n');};
 const report={generatedAt:new Date().toISOString(),sourceHashes:sourceHashes(),method:'independent seeded 29-chapter campaigns; elapsed exposure includes first video completions (5 units each) and real actions (1 unit each), external to rollback; cluster bootstrap by seed',
  seedStart:Number(a['seed-start']||10000),horizon:Number(a.horizon||2500),bootstrapReplicates:Number(a.boot||1000),
  ...runExperiment(config,a.strategy&&a.strategy!=='all'?[a.strategy]:['balanced','cautious','risky','overwork'],Number(a.seeds||1000),{horizon:Number(a.horizon||2500),seedStart:Number(a['seed-start']||10000),boot:Number(a.boot||1000),firstDeathOnly:!!a['first-death-only'],onProgress})};
 const json=JSON.stringify(report,null,2);if(a.out){fs.mkdirSync(path.dirname(path.resolve(a.out)),{recursive:true});fs.writeFileSync(a.out,json+'\n');if(fs.existsSync(a.out+'.partial.json'))fs.unlinkSync(a.out+'.partial.json');}
 console.log(JSON.stringify({configuration:config,results:Object.fromEntries(Object.entries(report.results).map(([k,v])=>[k,{meanDays:v.meanIntervalDays,ci95:v.meanIntervalDaysCI95,firstDays:v.firstDeathDays,restoredDays:v.restoredIntervalDays,deaths:v.deaths,completed:v.completedCampaigns,censored:v.horizonCensored,accuracy:v.accuracy,invalid:v.invalidActions}]))},null,2));
}
module.exports={simulate,summarize,runExperiment,sourceHashes,PROFILES,rulesFor,mixSeed};
