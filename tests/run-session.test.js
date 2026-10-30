const test=require('node:test');
const assert=require('node:assert/strict');
const {createRunSession}=require('../src/run-session');
const {createGame}=require('../src/engine');
const {createQuestionHistory}=require('../src/question-history');
const chapters=require('../data/chapters.json');
const knowledge=require('../data/knowledge.json');
const npcs=require('../data/npcs.json');
const quietRules={statusEventProbability:0,recoveryEventProbability:0,lowHpEventChance:0,lowHpAdditionalChance:0,salaryPenaltyProbability:0,fatalRisk:{work:0,research:0,politics:0},beneficialRisk:{chief_duty_appointment:0,national_grant_award:0,record_speech_champion:0}};
const storage=()=>{const values=new Map();return {values,getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}};
test('local sessions preserve peaks through restore and distinguish a new journey',async()=>{
  const s=storage(),run=createRunSession(chapters,{storage:s,knowledge,npcs,rules:quietRules},{enabled:false});
  await run.start();const id=run.leaderboard.getState().run.id;
  run.game.act({type:'clinical',questionId:knowledge[0].id,answer:knowledge[0].correctIndex});
  run.game.checkpoint('test');run.game.act({type:'rest'});run.game.restoreCheckpoint();
  assert.equal(run.leaderboard.getState().run.id,id);assert.equal(run.leaderboard.getState().local.currentBest.longest.score,2);
  run.game.save();const resumed=createRunSession(chapters,{storage:s,knowledge,npcs,rules:quietRules},{enabled:false});
  assert.equal((await resumed.resume()).ok,true);assert.equal(resumed.game.state.chapterId,run.game.state.chapterId);
  await resumed.start();assert.notEqual(resumed.leaderboard.getState().run.id,id);
  assert.equal(resumed.leaderboard.getState().local.currentBest.longest.score,2);
});
test('online bridge sends accepted operations and resumes authoritative state',async()=>{
  const s=storage(),server=createGame(chapters,{seed:7,knowledge,npcs,storage:storage(),rules:quietRules}),calls=[];let seq=0;
  const reply=()=>({ok:true,runId:'test-run',seed:7,seq,saveData:server.save().data});
  const transport=async p=>{calls.push(p);if(p.action==='startRun')return reply();if(p.action==='getRun')return reply();
    if(p.action==='appendOperations'){assert.equal(p.expectedSeq,seq);for(const op of p.operations){let r;if(op.method==='act')r=server.act(op.action);else if(op.method==='checkpoint')r=server.checkpoint(op.label);else if(op.method==='restoreCheckpoint')r=server.restoreCheckpoint();else throw Error('unexpected operation');assert.equal(r.ok,true);seq++;}return reply();}throw Error('unexpected request');};
  const config={enabled:true,envId:'test-env'},run=createRunSession(chapters,{storage:s,knowledge,npcs,rules:quietRules},config,transport);
  await run.start();assert.equal(run.online,true);
  const q=knowledge[0];run.game.act({type:'clinical',questionId:q.id,answer:q.correctIndex});
  run.game.act({type:'clinical',questionId:q.id,answer:q.correctIndex}); // review never enters ranked log
  run.game.checkpoint('test');run.game.act({type:'rest'});run.game.restoreCheckpoint();
  await run.leaderboard.retryPendingOperations();assert.equal(seq,4);
  const resumed=createRunSession(chapters,{storage:s,knowledge,npcs,rules:quietRules},config,transport);
  assert.equal((await resumed.resume()).ok,true);assert.equal(resumed.game.state.hp,server.state.hp);
  assert.equal(resumed.game.state.actionCount,server.state.actionCount);
  assert.equal(calls.filter(x=>x.action==='startRun').length,1);
});
test('a failed read does not silently overwrite a corrupt game save',async()=>{
  const s=storage(),run=createRunSession(chapters,{storage:s,knowledge,npcs},{enabled:false});
  await run.start();run.game.save();const key=[...s.values.keys()].find(k=>k.includes('save'));
  assert.ok(key);s.setItem(key,'broken');const fresh=createRunSession(chapters,{storage:s,knowledge,npcs},{enabled:false});
  assert.equal((await fresh.resume()).ok,false);assert.equal(s.getItem(key),'broken');
});

test('medal adapter counts effective work, keeps cosmetics, and resets action streaks on restore',async()=>{
  const s=storage(),run=createRunSession(chapters,{storage:s,knowledge,npcs,rules:quietRules},{enabled:false});
  await run.start();
  const g=run.game;
  for(let i=0;i<3;i++)assert.equal(g.act({type:'work'}).ok,true);
  assert.equal(run.medals.getState().progress.workStreak,3);
  g.act({type:'move'});g.act({type:'inspect',clueId:'not-a-clue'});
  assert.equal(run.medals.getState().progress.workStreak,3);
  const earned=g.act({type:'work'});
  assert.ok(earned.medalsUnlocked.some(m=>m.id==='work_streak_4'));
  run.medals.equip('work_streak_4');g.save();
  const resume=createRunSession(chapters,{storage:s,knowledge,npcs,rules:quietRules},{enabled:false});
  assert.equal((await resume.resume()).ok,true);
  assert.equal(resume.medals.getState().progress.workStreak,4);
  assert.equal(resume.game.restoreCheckpoint().ok,true);
  assert.equal(resume.medals.getState().progress.workStreak,0);
  assert.equal(resume.medals.getState().activeTitle,'work_streak_4');
  await resume.start();assert.equal(resume.medals.getState().activeTitle,'work_streak_4');
});

test('five new fatalities unlock memorial medal once across restores and fresh journeys',async()=>{
  const run=createRunSession(chapters,{storage:storage(),knowledge,npcs,rules:quietRules,debug:true},{enabled:false});
  await run.start();
  for(let i=0;i<5;i++){
    const r=run.game.act({type:'forceEvent',eventId:'faction_failure'});assert.equal(r.ok,true);
    assert.equal(r.medalsUnlocked.some(m=>m.id==='death_5'),i===4);
    if(i<4)assert.equal(run.game.restoreCheckpoint().ok,true);
  }
  assert.equal(run.game.getMemorial().total,5);
  assert.ok(run.medals.getState().medals.find(m=>m.id==='death_5').unlocked);
  await run.start();assert.equal(run.game.getMemorial().total,5);
  assert.ok(run.medals.getState().medals.find(m=>m.id==='death_5').unlocked);
});

test('clinical achievements use distinct successful question ids across saved sessions',async()=>{
  const s=storage(),opts={storage:s,knowledge,npcs,rules:quietRules},a=createRunSession(chapters,opts,{enabled:false});
  await a.start();
  for(const q of knowledge.slice(0,4))a.game.act({type:'clinical',questionId:q.id,answer:q.correctIndex});
  a.game.save();const b=createRunSession(chapters,opts,{enabled:false});await b.resume();
  const q0=knowledge[0];b.game.act({type:'clinical',questionId:q0.id,answer:q0.correctIndex});
  assert.equal(b.medals.getState().collections.knowledgeIds.length,4);
  for(const q of knowledge.slice(4,10))assert.equal(b.game.act({type:'clinical',questionId:q.id,answer:q.correctIndex}).ok,true);
  assert.ok(b.medals.getState().medals.find(m=>m.id==='knowledge_10').unlocked);
});

test('event achievements count new occurrences, never acknowledgement or saved-state reopening',async()=>{
  const s=storage(),opts={storage:s,knowledge,npcs,rules:quietRules,debug:true},a=createRunSession(chapters,opts,{enabled:false});await a.start();
  for(let i=0;i<4;i++){a.game.act({type:'forceEvent',eventId:'chief_duty_appointment'});a.game.resolveEvent('continue');}
  assert.equal(a.medals.getState().eventProgress.beneficialCount,4);
  a.game.save();const b=createRunSession(chapters,opts,{enabled:false});await b.resume();
  assert.equal(b.medals.getState().eventProgress.beneficialCount,4);
  const r=b.game.act({type:'forceEvent',eventId:'special_trait'});
  assert.ok(r.medalsUnlocked.some(m=>m.id==='beneficial_5'));
  b.game.resolveEvent('continue');assert.equal(b.medals.getState().eventProgress.beneficialCount,5);
  assert.equal(b.game.restoreCheckpoint().ok,true);assert.equal(b.medals.getState().eventProgress.beneficialCount,5);
});

test('video day is replayed online without a work action and repeated completion is not queued',async()=>{
  const source=[{id:1,presentation:'video',clues:[{id:'a',flags:{seen:true}}],choices:[{id:'end',requiresClues:2,requiresPuzzle:true,effects:{}}]}];
  const s=storage(),server=createGame(source,{seed:7,storage:storage(),rules:quietRules}),operations=[];let seq=0;
  const reply=()=>({ok:true,runId:'video-run',seed:7,seq,saveData:server.save().data,questionHistory:server.getQuestionHistory().records});
  const transport=async p=>{
    if(p.action==='startRun'||p.action==='getRun')return reply();
    if(p.action==='appendOperations'){
      assert.equal(p.expectedSeq,seq);
      for(const op of p.operations){operations.push(op);const r=op.method==='completeVideo'?server.completeVideo(op.chapterId):server.chooseEnding(op.choiceId);assert.equal(r.ok,true);seq++;}
      return reply();
    }
    throw Error('unexpected request');
  };
  const config={enabled:true,envId:'test-env'};
  const run=createRunSession(source,{storage:s,rules:quietRules},config,transport);await run.start();
  assert.equal(run.game.completeVideo(2).ok,false);
  assert.equal(run.game.completeVideo(1).ok,true);
  assert.equal(run.game.completeVideo(1).alreadyCompleted,true);
  await run.leaderboard.retryPendingOperations();
  assert.deepEqual(operations,[{method:'completeVideo',chapterId:1}]);
  assert.equal(server.isVideoCompleted(),true);assert.equal(server.state.actionCount,0);
  assert.equal(server.state.videoDays,1);assert.equal(server.state.completedDays,1);
  assert.equal(server.state.survivalActionCount,5);
  assert.equal(run.leaderboard.getState().local.currentBest.longest.score,5);
  assert.deepEqual(run.medals.getState().progress,{workStreak:0,researchStreak:0,noRestCount:5});
  assert.deepEqual(run.medals.getState().collections.puzzleChapterIds,['1']); // latest medal rule counts viewed chapters
  const resumed=createRunSession(source,{storage:s,rules:quietRules},config,transport);assert.equal((await resumed.resume()).ok,true);
  assert.equal(resumed.game.isVideoCompleted(),true);
  assert.equal(resumed.medals.getState().progress.noRestCount,5);
  assert.equal(resumed.game.completeVideo(1).alreadyCompleted,true);
  assert.equal(resumed.medals.getState().progress.noRestCount,5);
  assert.equal(resumed.game.chooseEnding('end').ok,true);await resumed.leaderboard.retryPendingOperations();
  assert.equal(server.state.status,'complete');assert.equal(seq,2);
});

test('seven first video days with required research earn no-rest medal and reset idle survival without erasing peak',async()=>{
  const source=Array.from({length:7},(_,i)=>({id:i+1,presentation:'video',clues:[],choices:[{id:'end',effects:{}}]}));
  const run=createRunSession(source,{storage:storage(),rules:quietRules},{enabled:false});await run.start();
  for(let id=1;id<=6;id++){
    if(id===5)assert.equal(run.game.act('research').ok,true);
    assert.equal(run.game.completeVideo(id).ok,true);
    assert.equal(run.game.chooseEnding('end').ok,true);
    assert.equal(run.game.startChapter(id+1).ok,true);
  }
  assert.equal(run.game.state.survivalActionCount,31);
  assert.equal(run.medals.getState().medals.find(m=>m.id==='no_rest_10').unlocked,false);
  const seventh=run.game.completeVideo(7);
  assert.equal(seventh.advancedDays,1);
  assert.equal(run.game.state.survivalActionCount,0);
  assert.equal(run.leaderboard.getState().local.currentBest.longest.score,31);
  assert.ok(seventh.medalsUnlocked.some(m=>m.id==='no_rest_10'));
  assert.equal(run.medals.getState().progress.workStreak,0);
  assert.equal(run.medals.getState().progress.researchStreak,0);
});

test('local question history survives fresh sessions and new journeys without repeat medals or actions',async()=>{
  const s=storage(),opts={storage:s,knowledge,npcs,rules:quietRules};
  const run=createRunSession(chapters,opts,{enabled:false});await run.start();
  const q=knowledge[0];run.game.act({type:'clinical',questionId:q.id,answer:q.correctIndex});
  await run.start();
  const before=structuredClone(run.game.state);
  assert.equal(run.game.act({type:'clinical',questionId:q.id,answer:q.correctIndex}).review,true);
  assert.deepEqual(run.game.state,before);
  const fresh=createRunSession(chapters,opts,{enabled:false});await fresh.start();
  assert.equal(fresh.game.isQuestionAnswered(q.id),true);
  assert.ok(!fresh.game.getUnansweredQuestions().some(item=>item.id===q.id));
});

test('online account question history stays authoritative and safely merges answers into local review history',async()=>{
  const s=storage(),q1=knowledge[0],q2=knowledge[1];
  createQuestionHistory({storage:s}).record({questionId:q2.id,answer:q2.correctIndex,correct:true,source:'clinical'});
  const serverHistory=createQuestionHistory({initialRecords:[{questionId:q1.id,answer:q1.correctIndex,correct:true,source:'clinical'}]});
  const server=createGame(chapters,{seed:7,knowledge,npcs,rules:quietRules,questionHistory:serverHistory});let seq=0;
  const reply=()=>({ok:true,runId:'history-run',seed:7,seq,saveData:server.save().data,questionHistory:serverHistory.getRecords()});
  const transport=async p=>{
    if(p.action==='startRun'||p.action==='getRun')return reply();
    for(const op of p.operations){assert.equal(server.act(op.action).ok,true);seq++;}return reply();
  };
  const run=createRunSession(chapters,{storage:s,knowledge,npcs,rules:quietRules},{enabled:true,envId:'test-env'},transport);await run.start();
  assert.equal(run.game.isQuestionAnswered(q1.id),true);
  assert.equal(run.game.isQuestionAnswered(q2.id),false); // local claims cannot waive a ranked exam
  assert.equal(run.game.act({type:'clinical',questionId:q1.id}).review,true);
  run.game.act({type:'clinical',questionId:q2.id,answer:q2.correctIndex});await run.leaderboard.retryPendingOperations();
  assert.equal(seq,1);
  const local=createRunSession(chapters,{storage:s,knowledge,npcs,rules:quietRules},{enabled:false});await local.start();
  assert.equal(local.game.isQuestionAnswered(q1.id),true);assert.equal(local.game.isQuestionAnswered(q2.id),true);
});
