'use strict';
// The UI plays immediately. Only successful state-changing operations enter
// the server replay queue; the server never accepts client scores or saves.
const {createGame}=require('./engine');
const {createLeaderboard}=require('./leaderboard');
const {createMedals}=require('./medals');
const {createQuestionHistory}=require('./question-history');
const MODE_KEY='baiyi.session.mode.v1';
function createRunSession(chapters,options,boardConfig,transport,onMessage=()=>{}) {
  const storage=options.storage;
  const leaderboard=createLeaderboard(boardConfig,storage,transport);
  const medals=createMedals(storage,{clock:options.clock});
  const localQuestionHistory=options.questionHistory||createQuestionHistory({storage,storageKey:options.questionHistoryKey});
  let game,online=false,lastHistoryError=null;
  function rememberMode(){try{storage.setItem(MODE_KEY,JSON.stringify({online,runId:online&&leaderboard.getState().online.run.id}));}catch(_){}}
  function observe(g,r,action,method){
    if(online)localQuestionHistory.merge(g.getQuestionHistory().records);
    const historyError=g.getQuestionHistory().storageError||localQuestionHistory.getState().storageError;
    if(historyError&&historyError!==lastHistoryError)onMessage('已做题记录暂未保存，原记录未覆盖；请保留当前游戏并稍后重试。');
    lastHistoryError=historyError;
    const unlocked=[];
    const collect=reply=>{if(reply&&reply.newlyUnlocked)unlocked.push(...reply.newlyUnlocked);};
    if(method==='restoreCheckpoint'||(method==='startChapter'&&action&&action.replay))collect(medals.resetProgress());
    if(action&&method==='act')collect(medals.observeAction(action.type,g.state,{
      ...action,correct:r.correct,chapterId:g.state.chapterId,puzzleSolved:!!g.state.flags.puzzleSolved,
      npcId:r.npc?r.npc.id:action.npcId,questCompleted:r.questCompleted,
    }));
    if(['completeVideo','completeSideVideo'].includes(method)&&r.advancedDays===1&&!r.alreadyCompleted)collect(medals.observeVideoDay(g.state,r.elapsedUnits));
    if(method==='resolveEvent'&&r.resolvedEventId==='health_crisis'&&['stop','care'].includes(action))collect(medals.restBreak());
    collect(medals.observeState(g.state));
    collect(medals.observeMemorial(g.getMemorial()));
    if(method==='chooseEnding'&&r.ending&&medals.observeEnding)collect(medals.observeEnding({chapterId:r.ending.chapterId,endingId:r.ending.choiceId}));
    const events=Array.isArray(r.triggeredEvents)?r.triggeredEvents:[r.triggeredEvent||(!method?g.state.lastTriggeredEvent:null)].filter(Boolean);
    if(medals.observeEvent)events.forEach(event=>collect(medals.observeEvent(event)));
    const ids=new Set();
    return unlocked.filter(item=>{if(ids.has(item.id))return false;ids.add(item.id);return true;});
  }
  function bindGame(seed,occurrenceNamespace,onlineQuestionRecords){
    const questionHistory=Array.isArray(onlineQuestionRecords)?createQuestionHistory({initialRecords:onlineQuestionRecords}):localQuestionHistory;
    const g=createGame(chapters,{...options,seed:seed===undefined?Date.now():seed,occurrenceNamespace,questionHistory});
    const operations={
      act:args=>({method:'act',action:args[0]}),resolveEvent:args=>({method:'resolveEvent',choiceId:args[0]}),
      chooseEnding:args=>({method:'chooseEnding',choiceId:args[0]}),
      completeVideo:args=>({method:'completeVideo',chapterId:args[0]}),
      completeSideVideo:args=>({method:'completeSideVideo',sideStoryId:args[0]}),
      answerMonthly:args=>({method:'answerMonthly',answerIndex:args[0],expectedQuestionId:args[1]}),
      buyMonthlyHint:args=>({method:'buyMonthlyHint',expectedQuestionId:args[0]}),
      startChapter:args=>({method:'startChapter',chapterId:args[0],params:args[1]}),
      checkpoint:args=>({method:'checkpoint',label:args[0]}),restoreCheckpoint:()=>({method:'restoreCheckpoint'}),
    };
    Object.keys(operations).forEach(name=>{const original=g[name];g[name]=(...args)=>{
      const count=g.state.actionCount,r=original(...args);
      if(r.ok){
        leaderboard.observeState(g.state);
        const changed=(name!=='act'||g.state.actionCount>count)&&!(['completeVideo','completeSideVideo'].includes(name)&&r.alreadyCompleted);
        const action=name==='act'&&changed?(typeof args[0]==='string'?{type:args[0]}:args[0]):name==='startChapter'?args[1]:name==='resolveEvent'?args[0]:null;
        r.medalsUnlocked=observe(g,r,action,name);
        if(online&&changed&&!(name==='buyMonthlyHint'&&r.alreadyPurchased)){
          leaderboard.appendOperations([operations[name](args)]).then(reply=>{if(!reply.ok)onMessage('全服同步待重试；本机进度已保留。');});
        }
      }
      return r;
    };});
    return g;
  }
  game=bindGame();
  async function start(){
    online=false;
    if(leaderboard.getState().online.configured){
      const response=await leaderboard.startOnlineRun();
      if(response.ok&&response.saveData){game=bindGame(response.seed,response.runId,response.questionHistory||response.questionHistorySnapshot||[]);const loaded=game.load(response.saveData);online=loaded.ok;}
      if(!online)onMessage('全服暂不可用，本次开启本机旅程。');
    }
    if(!online)game=bindGame();
    medals.resetProgress();observe(game,{});
    leaderboard.startLocalRun();leaderboard.observeState(game.state);rememberMode();
    return {ok:true,game,online};
  }
  async function resume(){
    let mode={};try{mode=JSON.parse(storage.getItem(MODE_KEY)||'{}');}catch(_){}
    const ranked=leaderboard.getState().online;
    online=!!(mode.online&&ranked.configured&&ranked.run&&mode.runId===ranked.run.id);
    if(online){
      const reply=await leaderboard.resumeOnlineRun();
      if(!reply.ok||!reply.saveData)return {ok:false,message:'全服旅程暂未同步，请稍后重试。当前存档未改动。'};
      if(reply.readOnly)return {ok:false,message:'这个全服旅程已成为历史记录，请开启新旅程；已有排行纪录会保留。'};
      game=bindGame(reply.seed,reply.runId,reply.questionHistory||reply.questionHistorySnapshot||[]);const r=game.load(reply.saveData);if(!r.ok)return r;
    }else{const r=game.load();if(!r.ok)return r;}
    leaderboard.observeState(game.state);observe(game,{});return {ok:true,game,online};
  }
  return {get game(){return game},leaderboard,medals,start,resume,get online(){return online}};
}
module.exports={createRunSession};
