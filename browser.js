(function(){"use strict";const modules={};const cache={};
modules["src/app.js"]=function(require,module,exports){
'use strict';
const P=require('./platform');
const {painter,theme:T}=require('./draw');
const {createRunSession}=require('./run-session');
const {DEFAULT_RULES}=require('./engine');
const {createSurvey}=require('./survey');
const {createWardrobe}=require('./wardrobe');
const chapters=require('../data/chapters.json');
const npcs=require('../data/npcs.json');
const sideStories=require('../data/side-stories.json');
const knowledge=require('../data/knowledge.json');
const studyConfig=require('../data/study-config.json');
const media=require('../data/media-config');
const boardConfig=require('../data/leaderboard-config.json');
const W=1280,H=720, ctx=P.canvas.getContext('2d'),D=painter(ctx);
const debug=!P.native&&new URLSearchParams(location.search).has('debug');
let cloudReady=false;
async function cloudTransport(payload,config){if(!P.native||!wx.cloud)throw Error('cloud_unavailable');if(!cloudReady){wx.cloud.init({env:config.envId,traceUser:false});cloudReady=true;}return wx.cloud.callFunction({name:config.functionName,data:payload});}
const session=createRunSession(chapters,{storage:P.storage,npcs,knowledge,debug},boardConfig,P.native?cloudTransport:null,msg=>notify(msg));
let game=session.game;
const leaderboard=session.leaderboard;
const survey=createSurvey(studyConfig,P.storage);
const wardrobe=createWardrobe(P.storage);
let screen='identity',modal=null,buttons=[],toast='',toastUntil=0,tabPage=0,bookPage=0,bookCategory='全部',archivePage=0,memorialPage=0,medalPage=0;
let occupation=null,monthlyFeedback=null,monthlyReadingId=null,memorialSnapshot=null,sessionActive=false,busy=false,boardSnapshot=null,boardTab='longest';
let transform={s:1,x:0,y:0},clock=0,videoActive=false,videoToken=0,pendingChapterPlayback=false,activeSideStory=null,pendingSideReturn=null,sideNpcId=null,sidePage=0;
const VIDEO_PROGRESS_KEY='baiyi.video-progress.v1';
let videoProgress=readVideoProgress();
const id2=x=>String(x).padStart(2,'0');
const sc=()=>game.state;
const current=()=>game.getChapter();
function notify(s){toast=String(s||'');toastUntil=clock+4300;}
function resize(){const s=P.size();P.canvas.width=Math.round(s.w*s.dpr);P.canvas.height=Math.round(s.h*s.dpr);if(!P.native){P.canvas.style.width=s.w+'px';P.canvas.style.height=s.h+'px'}const scale=Math.min(s.w/W,s.h/H);transform={s:scale,x:(s.w-W*scale)/2,y:(s.h-H*scale)/2,dpr:s.dpr};}
P.setResize(resize);resize();
function button(label,x,y,w,h,fn,opt={}){const disabled=!!opt.disabled;D.box(x,y,w,h,disabled?'#e8ecec':opt.fill||'#f0e7ff',opt.radius||8,disabled?'#d2d9dc':opt.border||T.line);D.text(label,x+w/2,y+(h-(opt.size||18))/2-1,opt.size||18,disabled?'#687581':opt.color||T.ink,'center','sans-serif',opt.bold?'bold':'normal');buttons.push({label,x,y,w,h,fn,disabled,hold:opt.hold});}
function tag(label,x,y,color=T.teal){const width=ctx.measureText(label).width+24;D.box(x,y,width,25,'#e0fff2',5,color);D.text(label,x+12,y+4,13,color);}
function overlay(title,kicker='白衣志怪录'){D.box(0,0,W,H,'rgba(40,36,68,.45)',0);D.box(180,85,920,550,T.panel,16,T.line);[T.mint,T.coral,T.lemon,T.lavender].forEach((c,i)=>D.box(220+i*213,85,201,7,c,3));D.text(kicker,220,113,13,T.gold);D.text(title,220,143,30,T.ink,'left','serif');D.line(220,190,1060,190);}
function cheerfulBackground(){
 const g=ctx.createLinearGradient(0,0,W,H);g.addColorStop(0,'#fff9ed');g.addColorStop(.52,'#effff7');g.addColorStop(1,'#f5edff');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
 ctx.save();ctx.globalAlpha=.7;D.circle(1228,8,181,T.lemon);D.circle(1280,694,187,T.lavender);D.circle(-68,622,158,T.mint);D.circle(925,-76,100,T.coral);ctx.restore();
 for(let i=0;i<13;i++)D.circle(1106+(i%4)*32,104+Math.floor(i/4)*32,3,T.purple);
}
function save(){const r=game.save();if(!r.ok)notify('进度暂未保存，请保留当前页面。');return r.ok;}
function notifyQuestionHistory(){const h=game.getQuestionHistory();if(h.storageError||h.unsavedCount)notify('已做题记录暂未保存，请在值班手册中重试保存。');}
function retryQuestionHistory(){game.save();const h=game.getQuestionHistory();notify(h.storageError||h.unsavedCount?'题目记录仍未保存，请保留当前页面并重试。':'题目记录已保存。');}
function notifyMedals(r){if(r.medalsUnlocked&&r.medalsUnlocked.length)notify('获得称号：'+r.medalsUnlocked.map(m=>m.name).join('、'));}
function observeAppearanceCompletion(){const r=wardrobe.observeCompletion(sc(),chapters.map(c=>c.id));if(r.newlyUnlocked)notify(r.persisted?'通关奖励：女版李晨光已永久解锁，可前往衣橱切换。':'女版李晨光已解锁，本次暂未保存，可在衣橱重试。');return r;}
function result(r,success){if(!r.ok){notify(r.message);return false;}save();if(sc().status==='failure'||sc().event||game.getMonthlyAssessment()){modal=null;}else if(success)success();else notify(r.message);if(r.clinicalAbsenceTriggered)notify('连续7天未参与临床：存活计时归零，完成临床行动后重新累计。');else if(r.salaryPenaltyTriggered)notify('本月薪资事件：工资减至50%，任务津贴不受影响。');else if(r.salaryPayment)notify(`本月工资到账：${r.salaryPayment.credited} 金币。`);notifyMedals(r);if(r.assessmentUnavailable&&r.assessmentMessage)notify(r.assessmentMessage);notifyQuestionHistory();if(r.type==='chooseEnding'||sc().status==='complete')observeAppearanceCompletion();resumePendingChapterPlayback();return true;}
function chapterTitle(){return `第 ${chapters.findIndex(x=>x.id===sc().chapterId)+1} 章 · ${current().title}`;}
function resetChapterUI(){monthlyReadingId=null;pendingSideReturn=null;activeSideStory=null;}
function enter(){sessionActive=true;screen='play';modal=null;monthlyFeedback=null;resetChapterUI();save();startChapterPlayback();}
function startChapterPlayback(){pendingChapterPlayback=true;resumePendingChapterPlayback();}
function resumePendingChapterPlayback(){if(pendingSideReturn){if(sc().status!=='playing'){pendingSideReturn=null;return;}if(screen!=='play'||sc().event||game.getMonthlyAssessment()||monthlyFeedback||modal||videoActive)return;const id=pendingSideReturn;pendingSideReturn=null;openSideStories(id);return;}if(!pendingChapterPlayback)return;if(sc().status!=='playing'){pendingChapterPlayback=false;return;}if(screen!=='play'||sc().event||game.getMonthlyAssessment()||monthlyFeedback||modal||videoActive)return;pendingChapterPlayback=false;if(game.isVideoCompleted(current().id))modal={type:'mission'};else playSource();}
async function newJourney(){if(busy)return;busy=true;try{if(sc().status==='complete'){const reward=observeAppearanceCompletion();if(reward.unlocked&&reward.persisted===false){modal=null;notify('通关奖励暂未保存，请到衣橱重试保存后再开启新故事。');return;}}const r=await session.start();game=r.game;P.closeVideo();videoToken++;videoActive=false;videoProgress={};saveVideoProgress();enter();observeAppearanceCompletion();}catch(_){notify('旅程暂未开启，请重试。');}finally{busy=false;}}
async function continueGame(){if(busy)return;busy=true;try{const r=await session.resume();if(r.ok){game=r.game;sessionActive=true;screen='play';modal=null;monthlyFeedback=null;resetChapterUI();observeAppearanceCompletion();startChapterPlayback();}else if(r.message==='还没有存档。'){busy=false;await newJourney();}else notify(r.message||'暂时无法继续，请重试。');}finally{busy=false;}}
function showBook(){screen='book';modal=null;bookPage=0;}
function doAction(type,extra={}){modal=null;result(game.act(Object.assign({type},extra)));}
function requestRisk(type){const names={work:'整理并提交病历',research:'提交科研申请',politics:'处理科室事务'};modal={type:'risk',action:type,title:names[type]};}
function npc(n){modal={type:'npc',npc:n,index:0};}
function eligibleQuestions(){return knowledge.filter(q=>bookCategory==='全部'||q.category===bookCategory)}
function question(q){if(game.isQuestionAnswered(q.id)){const prior=game.getAnsweredQuestions().find(item=>item.id===q.id);modal={type:'answer',question:q,correct:!!(prior&&prior.correct),answer:prior&&prior.recordedAnswer,repeat:true};return;}if(!sessionActive){notify('开启旅程后可参加学习任务，当前可先查阅手册。');return;}modal={type:'question',question:q};}
function clinicalAnswer(q,index){if(!sessionActive)return;const r=game.act({type:'clinical',questionId:q.id,answer:index});result(r,()=>{modal={type:'answer',question:q,correct:r.correct!=null?r.correct:index===q.correctIndex,answer:index,repeat:!!r.review};});}
function conditions(ch){return game.getAvailableChoices().map(x=>x.id);}
function openWardrobe(){screen='wardrobe';modal=null;}
function chooseOutfit(id){const r=wardrobe.select(id);if(r.persisted)notify('穿搭已更换。');else if(wardrobe.getSelected().id===id)notify('穿搭已更换，本次暂未保存。');else notify('这套穿搭暂不可用。');}
function chooseGender(gender,proceed=false){const r=wardrobe.setGender(gender);if(wardrobe.getState().gender!==gender){notify(r.code==='locked'?`完成全部${chapters.length}章主线后解锁女版李晨光。`:'这个形象暂不可用。');return;}if(proceed)screen='title';notify(r.persisted?'形象已更换。':'形象已更换，本次暂未保存。');}
function drawOutfit(outfit,x,y,w,h,alpha=1){const selected=P.image(outfit.image);if(D.img(selected,x,y,w,h,'contain',alpha))return true;return D.img(P.image('assets/lichenguang-player-small.png'),x,y,w,h,'contain',alpha);}
function avatarScreen(){
 const state=wardrobe.getState();D.text('选择李晨光的形象',76,54,45,T.ink,'left','serif');D.text(state.femaleUnlocked?'可随时在衣橱中切换，当前服装会保留；形象不影响任何属性。':`以男版李晨光开启旅程；完成全部${chapters.length}章主线后，永久解锁女版形象。`,80,119,21,T.muted);
 button('更改职业',1080,29,152,40,()=>{screen='identity'},{size:17});
 [['male','男版李晨光'],['female','女版李晨光']].forEach(([gender,label],i)=>{const x=80+i*575,selected=state.gender===gender,locked=gender==='female'&&!state.femaleUnlocked;
  D.box(x,174,545,460,T.panel,15,selected?T.gold:T.line);drawOutfit({image:'assets/outfits/'+(gender==='female'?'female/':'')+state.selectedId+'.png'},x+40,183,465,354,locked?.3:1);
  if(selected){D.box(x+18,192,96,28,'#fff4c5',6,T.gold);D.text('当前形象',x+66,197,15,T.gold,'center');}
  D.box(x+40,552,465,59,selected?'#5de4b6':'#f0e7ff',8,selected?T.teal:T.line);D.text(label,x+272,locked?557:568,locked?21:25,locked?T.muted:T.ink,'center','serif');if(locked)D.text(`完成全部${chapters.length}章主线后解锁`,x+272,585,14,T.gold,'center');
  buttons.push({label,x,y:174,w:545,h:460,disabled:locked,fn:()=>chooseGender(gender,true)});
 });
 D.text('原作影像保留原有表演，形象选择用于剧场人物卡。',80,670,17,T.muted);
}
function wardrobeScreen(){
 const state=wardrobe.getState();pagesHeader('李晨光的衣橱','六套穿搭自由更换，不消耗行动、金币，不改变属性。');
 [['male','男版李晨光'],['female','女版李晨光']].forEach(([gender,label],i)=>button(label,708+i*181,29,167,40,()=>chooseGender(gender),{size:17,fill:state.gender===gender?'#5de4b6':T.panel,border:state.gender===gender?T.gold:T.line,disabled:gender==='female'&&!state.femaleUnlocked}));
 D.text((state.femaleUnlocked?'':`女版：完成全部${chapters.length}章主线后解锁。`)+'原作影像保留原有表演，形象选择用于剧场人物卡。',43,103,14,T.muted);
 state.outfits.forEach((outfit,i)=>{const x=42+(i%3)*405,y=133+Math.floor(i/3)*270,selected=outfit.id===state.selectedId;
  D.box(x,y,387,256,T.panel,12,selected?T.gold:T.line);drawOutfit(outfit,x+20,y+8,347,198);
  if(selected){D.box(x+16,y+15,84,28,'#fff4c5',6,T.gold);D.text('正在穿戴',x+58,y+20,15,T.gold,'center');}
  D.text(outfit.name,x+193,y+217,23,selected?T.gold:T.ink,'center','serif');
  buttons.push({label:'更换 · '+outfit.name,x,y,w:387,h:256,fn:()=>chooseOutfit(outfit.id)});
 });
 D.text('点击任意穿搭即可更换；选择保存在当前设备。',43,687,15,T.muted);
 if(state.storageError)button('本次未保存 · 重试',946,678,285,33,()=>chooseOutfit(state.selectedId),{size:15,border:T.red});
}
function medalState(){return session.medals?session.medals.getState():{medals:[],activeTitle:null,progress:{}};}
function activeTitleName(){const m=medalState();const title=m.medals.find(x=>x.id===m.activeTitle&&x.unlocked);return title?title.name:null;}
function openMedals(){medalPage=0;screen='medals';modal=null;}
function wearTitle(id){if(!session.medals)return;const r=session.medals.equip(id);if(!r.ok){notify('这个称号尚未解锁。');return;}notify(r.persisted===false?'佩戴已更改，暂未保存。':id?'称号已佩戴。':'已隐藏佩戴称号。');}
function sourceLabel(chapter=current()){return (chapter.sourceLabel||`原作第${chapter.id}章`)+' · '+(chapter.phase||'白衣异闻');}
function nextUnfinishedChapter(){return game.getNextUnfinishedChapter?game.getNextUnfinishedChapter():chapters.find(c=>!sc().chapterResults[String(c.id)])||null;}
function researchDeadline(){return game.getResearchDeadline();}
function researchRemainingText(){const d=researchDeadline();return d.remainingUnits===0?'0天':`${d.remainingDays}天${d.remainingActions?d.remainingActions+'次行动':''}`;}
function header(){D.box(0,0,W,82,T.panel,0);D.box(0,79,W,3,T.mint,0);D.text('白衣志怪录',30,18,27,T.ink,'left','serif');D.text('李晨光 · '+(activeTitleName()||'白衣行者'),31,51,12,activeTitleName()?T.gold:T.muted);D.line(210,19,210,62);D.text(chapterTitle(),231,20,19,T.ink);D.text(current().phase||'医院与异界',231,48,13,T.muted);
 bar('血量',430,19,185,sc().hp,100,T.red,true);bar('精力',645,19,155,sc().energy,100,sc().energy<20?T.red:T.teal,false);if(sc().energy<20)D.text('继续行动可能透支血量',645,61,11,T.red);
 D.text(`第${sc().day}天 · ${sc().dayPhase}`,821,20,15,T.ink);D.text(`${sc().dayPhaseIndex}/5 行动 · ${sc().money} 金币`,821,48,11,T.muted);
 button('异闻录',933,22,87,38,()=>{screen='archive';archivePage=0},{size:15});button('章节',1032,22,76,38,()=>{screen='chapters';tabPage=0},{size:15});button('菜单',1120,22,76,38,()=>{modal={type:'menu'}},{size:15});}
function bar(label,x,y,w,v,max,color,threshold){D.text(label,x,y,13,T.muted);D.text(`${v}/${max}`,x+w,y,13,color,'right');D.box(x,y+24,w,10,'#e0e8e9',5);D.box(x,y+24,w*Math.max(0,v/max),10,color,5);if(threshold){D.line(x+w*.3,y+20,x+w*.3,y+39,T.gold,2);D.text('斩杀线 30',x+w*.3,y+41,10,T.gold,'center')}}
function identityScreen(){D.img(P.image('assets/scenes/ch01-a.jpg'),734,0,546,H,'cover',.16);tag('入院之前',80,100,T.purple);D.text('你的职业背景是？',76,157,49,T.ink,'left','serif');D.wrap(`仅用于调查，不影响角色、剧情或游戏难度。\n你将始终操控李晨光，走过他的${chapters.length}段异闻。`,80,244,690,22,T.muted,38,3);[['doctor','医生'],['medical_student','医学生'],['other','其他职业']].forEach(([value,label],i)=>button(label,80+i*244,409,222,75,()=>{occupation=value;survey.setParticipantContext({occupation:value});screen='avatar'},{size:25,fill:[T.mint,T.coral,T.lavender][i],border:T.line}));D.wrap('职业倦怠自评另行征得研究同意；游戏中的知识考核与自评答案分别处理。',80,537,730,16,T.muted,28,3);D.text('唯一主控 · 李晨光',80,653,16,T.gold);}
function openMemorial(){memorialPage=0;memorialSnapshot=game.getMemorial?game.getMemorial():{records:[],stats:[]};screen='memorial';modal=null;}
async function openBoards(){screen='leaderboard';modal=null;boardSnapshot=leaderboard.getState();if(boardSnapshot.online.configured){await leaderboard.refreshBoards();boardSnapshot=leaderboard.getState();}}
function leaderboardScreen(){pagesHeader('巅峰榜单','每日北京时间 00:00 发布最高纪录；游戏日夜独立运行。');const b=boardSnapshot||leaderboard.getState(),online=b.online.connected,view=online?b.online:b.local;D.text(online?'全服巅峰榜':'本机纪录 · 全服榜未连接',43,115,17,online?T.teal:T.gold);button('最长存活',43,153,160,41,()=>{boardTab='longest'},{size:18,fill:boardTab==='longest'?'#5de4b6':T.panel});button('金币巅峰',217,153,160,41,()=>{boardTab='wealthiest'},{size:18,fill:boardTab==='wealthiest'?'#5de4b6':T.panel});button('刷新榜单',1080,149,152,41,openBoards,{size:16});D.box(42,217,1190,360,T.panel,12,T.line);D.text('名次',65,239,15,T.muted);D.text('玩家',166,239,15,T.muted);D.text(boardTab==='longest'?'累计存活纪录':'金币最高纪录',1207,239,15,T.muted,'right');const rows=view.boards[boardTab]||[];rows.slice(0,7).forEach((r,i)=>{const y=283+i*39;D.text(String(r.rank||i+1),65,y,20,i<3?T.gold:T.muted);D.text(r.nickname,166,y,18,T.ink);D.text(boardTab==='longest'?`${Math.floor(r.score/5)} 天 ${r.score%5} 行动`:`${r.score} 金币`,1207,y,20,T.teal,'right');});if(!rows.length)D.wrap('本次日榜暂无已发布的纪录。\n今天取得的成绩将在下一次凌晨更新时进入榜单。',166,333,910,22,T.muted,38);const best=b.local.currentBest[boardTab];D.text('本机实时最高：'+(best?(boardTab==='longest'?`${Math.floor(best.score/5)} 天 ${best.score%5} 行动`:`${best.score} 金币`):'尚无纪录'),43,607,19,T.gold);D.text('读档可继续刷新纪录；无充值，金币来自游戏内任务与事件。',43,649,15,T.muted);if(b.online.pendingCount)D.text(`${b.online.pendingCount} 批操作等待同步`,1229,607,14,T.gold,'right');D.text(online?'已连接服务器核验榜单':'当前显示本机记录；全服榜需接入微信云环境。',1229,680,12,T.muted,'right');}
function titleScreen(){const im=P.image('assets/scenes/ch26-a.jpg');D.img(im,0,0,W,H,'cover',.34);const g=ctx.createLinearGradient(0,0,W,0);g.addColorStop(0,'rgba(255,249,237,.99)');g.addColorStop(.53,'rgba(255,249,237,.94)');g.addColorStop(1,'rgba(224,255,242,.55)');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
 for(let i=0;i<28;i++){const x=(i*47+clock*.012)%1280,y=90+(i*97)%580;D.circle(x,y,1,'rgba(104,64,173,.25)')}
 D.box(76,74,358,32,T.lemon,8);D.text('医院生存 · 志怪叙事 · 目标情境学习',89,81,15,T.ink);
 D.text('白衣',70,135,103,T.ink,'left','serif');D.text('志怪录',70,239,103,T.ink,'left','serif');D.line(79,365,395,365,T.gold);
 D.text(`李晨光的${chapters.length}段人生异闻`,80,389,22,T.ink);D.wrap(`观看${chapters.length}章人生异闻，在片尾选择命运。\n每5个游戏日至少完成一次科研，逾期直接死亡。`,80,433,560,18,T.muted,31);
 button('继续旅程',80,535,224,58,continueGame,{fill:'#5de4b6',color:'#253344',border:T.teal,bold:true,size:21});
 button('新的故事',320,535,160,58,()=>{modal={type:'newConfirm'}},{size:20});button('更换穿搭',496,535,160,58,openWardrobe,{size:20});
 [['值班手册',showBook],['人物档案',()=>{screen='npcs'}],['称号馆',openMedals],['死亡纪念馆',openMemorial],['巅峰榜单',openBoards],['研究设置',()=>{screen='study'}]].forEach(([label,fn],i)=>button(label,80+(i%3)*176,606+Math.floor(i/3)*47,162,40,fn,{size:16}));
 drawOutfit(wardrobe.getSelected(),704,138,360,538,.9);
 D.text(`可读档 · 多结局 · ${sideStories.length}段同行者支线`,1202,666,14,T.muted,'right');D.text('开发体验版 0.5.0',1202,691,11,'#526273','right');}
function playScreen(){
 header();const completed=game.isVideoCompleted(current().id),position=videoProgress[String(current().id)]||{},resume=position.currentTime>1;
 D.box(34,100,842,492,'#ffffff',12,T.line);D.img(P.image(`assets/scenes/ch${id2(current().id)}-a.jpg`),46,112,818,460,'contain',.75);
 const shade=ctx.createLinearGradient(0,112,0,582);shade.addColorStop(0,'rgba(255,255,255,.72)');shade.addColorStop(.5,'rgba(255,249,237,.35)');shade.addColorStop(1,'rgba(255,255,255,.98)');ctx.fillStyle=shade;ctx.fillRect(46,112,818,470);
 D.text('剧情剧场 · '+sourceLabel(),59,126,15,T.gold);D.text(current().title,455,206,41,T.ink,'center','serif');
 button(resume?'继续播放 · '+formatVideoTime(position.currentTime):completed?'重看本章剧情':'播放本章剧情',247,306,416,74,()=>playSource(),{size:27,fill:'#ffe372',border:T.teal});
 if(resume)button('从头播放',355,397,200,44,()=>playSource({fromStart:true}),{size:18});
 D.text(completed?'已完整观看 · 命运选择已开放':resume?'已看到 '+formatVideoTime(position.currentTime)+' · 可随时继续':'播放自然结束后，选择这一章的命运。',59,534,19,completed?T.teal:T.ink);
 D.text('每章首次看完 +1 天，并判定随机事件；暂停、续播与重看不重复计时。',59,570,13,T.muted);
 D.box(900,100,348,492,T.softYellow,12,T.line);D.circle(1074,265,112,T.mint);D.circle(1196,162,27,T.coral);D.circle(958,360,18,T.lavender);D.text('李晨光 · 当前形象',921,119,18,T.gold);drawOutfit(wardrobe.getSelected(),980,151,190,242);D.text(wardrobe.getSelected().name,1074,398,17,T.ink,'center');
 D.text(`存活 ${Math.floor((sc().survivalActionCount||0)/5)}天 · 信任 ${sc().trust} · 洞察 ${sc().insight}`,921,438,14,T.muted);const effects=game.getStatusEffects(),history=game.getQuestionHistory();if(history.storageError||history.unsavedCount)button('题目记录待保存 · 重试',921,471,306,42,retryQuestionHistory,{size:17,border:T.red});else if(effects.length)button(`持续状态 · 共${effects.length}项`,921,471,306,42,()=>{modal={type:'status'}},{size:17,color:effects.some(e=>e.kind!=='heal')?T.gold:T.teal});else D.text(sc().hp<30?'斩杀线以下：厄运可能降临':'尚在斩杀线之上',921,485,15,sc().hp<30?T.red:T.muted);
 const deadline=researchDeadline();D.text('科研期限：还剩 '+researchRemainingText(),921,519,14,deadline.dueSoon?T.red:T.gold);
 button(completed?'选择本章命运':'观看完成后选择命运',921,542,306,43,()=>{modal={type:'mission'}},{size:18,disabled:!completed,fill:'#5de4b6',border:T.teal});
 const mainActions=[['病历工作','work'],['基础休息','rest'],['科研申请','research'],['学习任务','clinical'],['更多行动','more']];mainActions.forEach(([label,key],i)=>button(label,34+i*245,613,232,78,()=>openAction(key),{size:24,fill:[T.coral,T.mint,T.lemon,T.lavender,T.softPurple][i],border:key==='research'&&deadline.dueSoon?T.red:T.line,bold:true}));
 D.text('剧情可随时暂停 · 更多行动中可查手册、与同行者交谈及保存节点',36,704,11,T.muted);const salary=game.getSalary();D.text(`本月应发 ${salary.accrued} 金币${salary.reduced?' · 已减薪50%':''} · 每28天结算`,1234,704,11,salary.reduced?T.red:T.muted,'right');
}
function openAction(key){
 if(key==='rest'||key==='entertain'||key==='prepare'||key==='status'){modal={type:key};return;}
 if(['work','research','politics'].includes(key)){requestRisk(key);return;}
 if(key==='book'){showBook();return;}
 if(key==='clinical'){const q=game.getUnansweredQuestions()[0];if(q)question(q);else modal={type:'questionsDone'};return;}
 if(key==='save'){modal=null;result(game.checkpoint('剧情与值班 · '+current().title));return;}
 if(key==='source'){playSource();return;}
 if(key==='npcs'){screen='npcs';modal=null;return;}
 modal={type:'actions'};
}
function actionGrid(items){items.forEach(([label,fn],i)=>button(label,220+(i%3)*286,220+Math.floor(i/3)*112,268,94,fn,{size:22,fill:[T.softMint,T.softCoral,T.softPurple,T.softYellow][i%4]}));}
function medalsScreen(){
 const state=medalState(),totalPages=Math.max(1,Math.ceil(state.medals.length/6));medalPage=Math.max(0,Math.min(medalPage,totalPages-1));
 pagesHeader('称号馆','把走过的路佩戴在身上。称号仅作纪念，不改变能力与难度。');
 D.text(`已解锁 ${state.medals.filter(m=>m.unlocked).length} / ${state.medals.length}`,43,118,20,T.gold);
 D.text('当前佩戴：'+(activeTitleName()||'未佩戴称号'),327,121,17,T.muted);
 button('隐藏称号',1060,108,172,42,()=>wearTitle(null),{size:17,disabled:!state.activeTitle});
 state.medals.slice(medalPage*6,medalPage*6+6).forEach((m,i)=>{
  const x=42+(i%3)*405,y=166+Math.floor(i/3)*220,active=m.id===state.activeTitle;
  D.box(x,y,387,204,T.panel,12,active?T.gold:T.line);D.circle(x+34,y+37,17,m.unlocked?'#ffe372':'#e8ecec',m.unlocked?T.gold:T.line);D.text(m.unlocked?'成':'锁',x+34,y+26,17,m.unlocked?T.gold:T.muted,'center');
  D.text(m.name,x+65,y+20,25,m.unlocked?T.ink:T.muted,'left','serif');D.wrap(m.description,x+20,y+69,347,17,T.muted,25,2);
  D.text(m.unlocked?'已解锁 · 永久保留':'尚未解锁',x+20,y+124,13,m.unlocked?T.teal:T.muted);
  button(active?'正在佩戴':m.unlocked?'佩戴 · '+m.name:'待达成',x+20,y+150,347,42,()=>wearTitle(m.id),{size:17,disabled:!m.unlocked||active,fill:active?'#fff4c5':'#f0e7ff'});
 });
 button('上一页',415,638,130,48,()=>medalPage--,{disabled:medalPage===0,size:18});D.text(`${medalPage+1} / ${totalPages}`,640,652,18,T.muted,'center');button('下一页',735,638,130,48,()=>medalPage++,{disabled:medalPage+1>=totalPages,size:18});
 if(state.storageError)button('称号待保存 · 重试',43,642,280,42,()=>{const r=session.medals.retry();notify(r.ok?'称号已保存。':'仍未保存，请保留当前页面。');},{size:16,border:T.red});
}
function returnButton(){button('返回旅程',1080,29,152,40,()=>{screen=sessionActive?'play':'title';modal=null},{size:17})}
function pagesHeader(title,sub){D.text(title,40,28,34,T.ink,'left','serif');D.text(sub,43,76,16,T.muted);returnButton();}
function chaptersScreen(){
 pagesHeader('人生异闻录','依人生阶段编排；原作编号保留。旧进度可以继续补入的篇章。');const start=tabPage*9,next=nextUnfinishedChapter();
 chapters.slice(start,start+9).forEach((c,i)=>{
  const x=40+(i%3)*405,y=118+Math.floor(i/3)*169,reached=c.id===sc().chapterId||!!sc().chapterResults[String(c.id)],available=!!next&&String(next.id)===String(c.id)&&['complete','chapter_end'].includes(sc().status);
  D.box(x,y,387,152,T.panel,10,reached||available?T.line:'#d2d9dc');D.img(P.image(`assets/scenes/ch${id2(c.id)}-a.jpg`),x+12,y+12,91,124,'cover',reached||available?1:.4);D.text(`${start+i+1}. ${c.title}`,x+119,y+19,23,reached||available?T.ink:T.muted,'left','serif');D.text(c.phase||'白衣异闻',x+120,y+56,13,T.gold);D.text(c.sourceLabel||`原作第 ${c.id} 章`,x+120,y+80,12,T.muted);
  button(c.id===sc().chapterId?'回到此章':available?'继续这一章':reached?'分支重玩':'尚未抵达',x+120,y+105,246,33,()=>{if(c.id===sc().chapterId){screen='play';startChapterPlayback()}else if(available){result(game.startChapter(c.id),enter)}else{modal={type:'replayConfirm',chapter:c}}},{size:14,disabled:!reached&&!available});
 });
 button('上一页',415,651,130,40,()=>tabPage--,{disabled:tabPage===0,size:16});D.text(`${tabPage+1} / ${Math.ceil(chapters.length/9)}`,640,663,16,T.muted,'center');button('下一页',735,651,130,40,()=>tabPage++,{disabled:(tabPage+1)*9>=chapters.length,size:16});
}
function bookScreen(){pagesHeader('值班手册','先查阅，再判断；已做题只供复习，不会再次出题。');['全部','内科','内分泌'].forEach((c,i)=>button(c,42+i*112,111,101,34,()=>{bookCategory=c;bookPage=0},{size:15,fill:bookCategory===c?'#5de4b6':T.panel}));D.text(`当前未答 ${game.getUnansweredQuestions().length} / ${knowledge.length} 题`,1232,121,16,T.gold,'right');const qs=eligibleQuestions(),list=qs.slice(bookPage*6,bookPage*6+6);list.forEach((q,i)=>{const x=42+(i%2)*602,y=168+Math.floor(i/2)*146,answered=game.isQuestionAnswered(q.id);D.box(x,y,580,130,T.panel,10,T.line);D.text(q.category+(answered?' · 已做题':''),x+20,y+16,12,answered?T.teal:T.gold);D.text(q.title,x+20,y+43,22,T.ink,'left','serif');D.wrap(q.scene||q.question,x+20,y+77,396,14,T.muted,21,2);button(answered?'复习解析':'查阅 / 作答',x+422,y+71,137,39,()=>{if(answered)question(q);else modal={type:'reading',question:q}},{size:15});});const history=game.getQuestionHistory();if(history.storageError||history.unsavedCount)button('已做题记录暂未保存 · 点击重试',43,605,366,31,retryQuestionHistory,{size:15,border:T.red});button('上一页',415,645,130,40,()=>bookPage--,{disabled:bookPage===0,size:16});D.text(`${bookPage+1} / ${Math.max(1,Math.ceil(qs.length/6))}`,640,657,16,T.muted,'center');button('下一页',735,645,130,40,()=>bookPage++,{disabled:(bookPage+1)*6>=qs.length,size:16});}
function openSideStories(npcId=null){sideNpcId=npcId;sidePage=0;screen='sideStories';modal=null;}
function npcsScreen(){
 pagesHeader('同行者','走进同伴的原作故事。首次完整观看推进一天，重看不重复计时。');
 npcs.forEach((n,i)=>{
  const x=40+(i%3)*405,y=118+Math.floor(i/3)*277,stories=sideStories.filter(v=>v.npcId===n.id),done=stories.filter(v=>game.isSideVideoCompleted(v.id)).length;
  D.box(x,y,387,256,T.panel,12,T.line);D.img(P.image(n.portrait),x+14,y+17,117,169,'contain');
  D.text(n.name,x+146,y+21,24,T.ink,'left','serif');D.wrap(n.subtitle||'同行者',x+146,y+60,220,14,T.gold,23,2);
  D.wrap(n.description.length>27?n.description.slice(0,26)+'…':n.description,x+146,y+113,220,15,T.muted,24,2);D.text('支线影像 '+done+' / '+stories.length,x+146,y+173,14,T.teal);
  button('观看故事',x+14,y+207,218,36,()=>openSideStories(n.id),{size:17,fill:T.mint,border:T.teal});
  button('交谈',x+246,y+207,127,36,()=>npc(n),{size:17});
 });
 const x=850,y=395;D.box(x,y,387,256,T.softPurple,12,T.line);D.text('另一段人生',x+24,y+25,29,T.ink,'left','serif');
 D.wrap('顾宁、黄宁、李慕良、柳长生，\n以及白进与白斯年的医院往事。\n从相遇，走向理解。',x+24,y+79,335,18,T.muted,31,3);
 button(`浏览全部 ${sideStories.length} 段支线`,x+24,y+207,339,36,()=>openSideStories(),{size:17,fill:T.lemon,border:T.gold});
}
function sideStoriesScreen(){
 const person=npcs.find(n=>n.id===sideNpcId),list=sideStories.filter(v=>!sideNpcId||v.npcId===sideNpcId),pages=Math.max(1,Math.ceil(list.length/4));sidePage=Math.max(0,Math.min(sidePage,pages-1));
 pagesHeader(person?person.name+' · 支线剧场':'同行者 · 支线剧场','原作完整影像 · 首次看完 +1 天与随机事件判定 · 暂停可续播，重看不重复计时');
 button('人物档案',886,29,170,40,()=>{screen='npcs';modal=null},{size:17});
 list.slice(sidePage*4,sidePage*4+4).forEach((v,i)=>{
  const x=40+(i%2)*607,y=122+Math.floor(i/2)*251,done=game.isSideVideoCompleted(v.id),unlocked=(v.requires||[]).every(id=>game.isSideVideoCompleted(id)),position=videoProgress['side:'+v.id]||{},resume=position.currentTime>1,ready=sessionActive&&game.canPlaySideVideo(v.id);
  D.box(x,y,590,233,T.panel,12,T.line);D.img(P.image(v.poster),x+14,y+15,208,117,'contain',unlocked?1:.45);
  D.text(v.title,x+238,y+18,25,T.ink,'left','serif');const n=npcs.find(n=>n.id===v.npcId);D.text(n?n.name:'同行者',x+239,y+58,14,T.gold);
  D.wrap(v.description.length>42?v.description.slice(0,41)+'…':v.description,x+239,y+89,332,15,T.muted,25,2);
  const previous=(v.requires||[]).map(id=>sideStories.find(x=>x.id===id)).filter(Boolean).map(x=>x.title).join('、');
  D.text(!unlocked?'先看完《'+previous+'》':done?'已完整观看 · 重看不计时':resume?'已看到 '+formatVideoTime(position.currentTime):'首次观看 · 度过一天',x+16,y+151,15,unlocked?T.teal:T.muted);
  button(!unlocked?'前一段尚未看完':!sessionActive?'开启旅程后观看':resume?'继续播放 · '+formatVideoTime(position.currentTime):done?'重看故事':'观看故事',x+14,y+183,resume?396:562,37,()=>playSideStory(v),{size:17,disabled:!ready,fill:T.mint,border:T.teal});
  if(resume)button('从头播放',x+424,y+183,152,37,()=>playSideStory(v,{fromStart:true}),{size:16,disabled:!ready});
 });
 if(!sessionActive)D.text('请先开启或继续旅程；人物档案与交谈可随时查看。',40,648,16,T.gold);
 else if(sc().status!=='playing'||sc().event||game.getMonthlyAssessment())D.text(sc().status==='complete'?(nextUnfinishedChapter()?'已通关：从章节页继续补入的篇章后，即可体验支线。':'已通关：从章节页重玩已抵达章节，即可继续体验支线。'):'请先返回旅程处理当前事件、考核或章节结局，再开始支线。',40,648,16,T.gold);
 if(pages>1){button('上一页',415,665,130,36,()=>sidePage--,{disabled:sidePage===0,size:16});D.text((sidePage+1)+' / '+pages,640,674,16,T.muted,'center');button('下一页',735,665,130,36,()=>sidePage++,{disabled:sidePage+1>=pages,size:16});}
}

function archiveScreen(){pagesHeader('异闻档案','剧情、值班经历与已抵达的结局。');const rows=sc().log.slice().reverse().slice(archivePage*12,archivePage*12+12);rows.forEach((l,i)=>{D.text(String(l.time||0).padStart(3,'0'),45,126+i*39,13,T.gold);D.text(l.text,105,122+i*39,17,l.type==='failure'?T.red:T.ink)});button('上一页',415,645,130,40,()=>archivePage--,{disabled:archivePage===0,size:16});D.text(`${archivePage+1}`,640,657,16,T.muted,'center');button('下一页',735,645,130,40,()=>archivePage++,{disabled:(archivePage+1)*12>=sc().log.length,size:16});}
function studyScreen(){pagesHeader('研究问卷','问卷记录你的实际感受，与角色的选择和血量分开保存。');D.box(180,135,920,470,T.panel,14,T.line);const configured=survey.isConfigured();D.text(configured?'自愿参加研究':'量表题本待配置',220,171,29,T.ink,'left','serif');
 D.wrap(configured?(studyConfig.consentText||'请阅读研究知情同意说明后，选择是否参加。'):'已预留分次呈现、跳过、退出、匿名记录与导出功能。\n正式量表须使用医院伦理方案确定、获得使用授权的题本；当前不会收集职业倦怠答案。',220,225,830,20,T.muted,34,6);
 if(configured){button('同意参加',220,460,190,48,()=>{const r=survey.consent(true);if(r.ok){survey.beginAssessment();notify('已记录选择。你可随时退出。')}else notify(r.code)},{size:18});button('本次不参加',428,460,190,48,()=>{survey.decline();notify('你仍可继续体验完整游戏。')},{size:18});button('退出研究',636,460,190,48,()=>{survey.withdraw();notify('已停止后续问卷邀请。')},{size:18});}
 button('导出本地研究数据',220,533,245,42,()=>exportSurvey(),{size:16});button('清除本地研究数据',486,533,245,42,()=>{modal={type:'clearStudy'}},{size:16});D.text('答题与否、所选答案均不影响游戏奖励。',220,416,16,T.teal);}
function exportSurvey(){const out=survey.exportData();if(P.native){const path=wx.env.USER_DATA_PATH+'/baiyi-study.json';try{wx.getFileSystemManager().writeFileSync(path,out,'utf8');if(wx.shareFileMessage)wx.shareFileMessage({filePath:path});else notify('已导出至小游戏本地文件目录。')}catch(e){notify('导出未完成。')}}else{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([out],{type:'application/json'}));a.download='baiyi-study.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}}
function readVideoProgress(){try{const raw=P.storage.getItem(VIDEO_PROGRESS_KEY),data=raw?JSON.parse(raw):null;return data&&data.version===1&&data.positions&&typeof data.positions==='object'&&!Array.isArray(data.positions)?data.positions:{}}catch(_){return {}}}
function saveVideoProgress(){try{return P.storage.setItem(VIDEO_PROGRESS_KEY,JSON.stringify({version:1,positions:videoProgress}))!==false}catch(_){return false}}
function recordVideoPosition(id,info={},ended=false){const time=Number(info.currentTime),duration=Number(info.duration);if(!Number.isFinite(time)||time<0)return;videoProgress[String(id)]=Object.assign({},videoProgress[String(id)],{currentTime:ended?0:time,duration:Number.isFinite(duration)&&duration>0?duration:0});if(!saveVideoProgress())notify('播放位置暂未保存，请保留当前页面。');}
function formatVideoTime(value){const sec=Math.max(0,Math.floor(Number(value)||0));return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0');}
function beforeStoryPlayback(story,key,completed,options,side=false){
 if(!completed&&story.transitionIntro&&!(videoProgress[key]&&videoProgress[key].introSeen)&&!options.skipIntro){modal={type:'storyIntro',title:story.title,story,key,side,options};return false;}
 if(!completed&&!options.confirmedResearchDeadline&&researchDeadline().remainingUnits<=5){modal={type:'researchVideoWarning',title:'先安排一次科研？',story,side,options};return false;}
 return true;
}
function continueStoryIntro(m){videoProgress[m.key]=Object.assign({},videoProgress[m.key],{introSeen:true});if(!saveVideoProgress())notify('开场记录暂未保存，请保留当前页面。');const options=Object.assign({},m.options,{skipIntro:true});if(m.side)playSideStory(m.story,options);else playSource(options);}
function continueRiskyVideo(m){const options=Object.assign({},m.options,{confirmedResearchDeadline:true});if(m.side)playSideStory(m.story,options);else playSource(options);}
function chooseResearchBeforeVideo(){pendingChapterPlayback=false;pendingSideReturn=null;screen='play';requestRisk('research');}
function playSource(options={}){
 const chapter=current(),chapterId=chapter.id,owner=game,localPath=media.localFolder+`ch${id2(chapterId)}.mp4`,embedded=!P.native&&window.BAIYI_VIDEOS&&window.BAIYI_VIDEOS[localPath];
 const src=embedded?localPath:media.baseUrl?media.baseUrl.replace(/\/$/,'')+`/ch${id2(chapterId)}.mp4`:(!P.native?localPath:null);
 if(!src||P.native&&!media.enableNativeVideo){videoActive=false;modal={type:'sourceUnavailable',message:'当前微信环境尚未接入可播放的视频地址。本章需视频播放完成后才能选择结局，请配置媒体后重试。'};return;}
 if(!beforeStoryPlayback(chapter,String(chapterId),game.isVideoCompleted(chapterId),options))return;
 P.closeVideo();const token=++videoToken;modal=null;screen='play';videoActive=true;
 const position=videoProgress[String(chapterId)]||{},startTime=options.fromStart?0:Math.max(0,Number(position.currentTime)||0);
 const rect={x:transform.x+160*transform.s,y:transform.y+55*transform.s,w:960*transform.s,h:540*transform.s};
 const belongs=()=>token===videoToken&&game===owner&&String(sc().chapterId)===String(chapterId);
 try{P.playVideo(src,rect,info=>{if(!belongs())return;videoActive=false;recordVideoPosition(chapterId,info,info&&info.reason==='ended');if(info&&info.reason==='ended'){pendingChapterPlayback=true;screen='play';result(owner.completeVideo(chapterId));}else if(info&&info.reason!=='error')notify('播放已暂停，位置已保留；可继续剧情或安排值班。');},()=>{if(!belongs())return;videoActive=false;modal={type:'sourceUnavailable',message:'视频暂时无法播放，请检查媒体文件或网络后重试。关闭或播放出错不会完成本章，也不会解锁命运选择。'};},{startTime,onProgress:info=>{if(belongs())recordVideoPosition(chapterId,info)}});}catch(_){if(belongs()){videoActive=false;modal={type:'sourceUnavailable',message:'播放器暂时不可用。请重试；本章尚未标记为观看完成。'};}}
}
function playSideStory(story,options={}){
 if(!sessionActive||!game.canPlaySideVideo(story.id)){notify('请先完成前一段故事，或返回旅程处理当前事件。');return;}
 const owner=game,chapterId=sc().chapterId,key='side:'+story.id,localPath=media.localFolder+story.video.replace(/^media\//,'');
 const embedded=!P.native&&window.BAIYI_VIDEOS&&window.BAIYI_VIDEOS[localPath],src=embedded?localPath:media.baseUrl?media.baseUrl.replace(/\/$/,'')+'/'+story.video.replace(/^media\//,''):(!P.native?localPath:null);
 if(!src||P.native&&!media.enableNativeVideo){modal={type:'sideSourceUnavailable',story,message:'当前微信环境尚未接入这段视频地址。观看记录保持不变，请配置媒体后重试。'};return;}
 if(!beforeStoryPlayback(story,key,game.isSideVideoCompleted(story.id),options,true))return;
 P.closeVideo();const token=++videoToken;pendingChapterPlayback=false;pendingSideReturn=null;activeSideStory=story;modal=null;screen='play';videoActive=true;
 const position=videoProgress[key]||{},startTime=options.fromStart?0:Math.max(0,Number(position.currentTime)||0),rect={x:transform.x+transform.s*160,y:transform.y+transform.s*55,w:transform.s*960,h:transform.s*540};
 const belongs=()=>token===videoToken&&game===owner&&String(sc().chapterId)===String(chapterId);
 const failed=()=>{if(!belongs())return;videoActive=false;activeSideStory=null;openSideStories(story.npcId);modal={type:'sideSourceUnavailable',story,message:'视频暂时无法播放，请检查媒体或网络后重试。关闭或出错不会推进游戏时间。'};};
 try{P.playVideo(src,rect,info=>{
  if(!belongs())return;videoActive=false;activeSideStory=null;recordVideoPosition(key,info,info&&info.reason==='ended');
  if(info&&info.reason==='ended'){pendingSideReturn=story.npcId;screen='play';const r=owner.completeSideVideo(story.id);if(!result(r)){pendingSideReturn=null;openSideStories(story.npcId);}}
  else if(info&&info.reason!=='error'){openSideStories(story.npcId);notify('支线已暂停，播放位置已保留。');}
 },failed,{startTime,onProgress:info=>{if(belongs())recordVideoPosition(key,info)}});}catch(_){failed();}
}
function failureScreen(){const im=P.image('assets/halloween-death.jpg');if(!D.img(im,0,0,W,H,'cover'))D.img(P.image('assets/halloween-death.png'),0,0,W,H,'cover');D.box(0,0,W,H,'rgba(1,7,13,.36)',0);const glow=.18+Math.sin(clock*.002)*.08;D.circle(1115,570,75,`rgba(230,112,26,${glow})`);D.circle(150,570,61,`rgba(230,112,26,${glow})`);
 D.box(313,99,654,520,'rgba(7,17,25,.9)',14,'#795448');D.text('万圣夜 · 命运终止',640,131,15,'#d7ae80','center');D.text('此夜未尽',640,174,63,'#eadbc1','center','serif');D.line(477,257,803,257,'#996f52');D.text(sc().failure?sc().failure.title:'这一段旅程结束了',640,283,29,'#efc47e','center','serif');D.wrap(sc().failure?sc().failure.text:'你仍有机会，从旧日的节点重新出发。',366,337,548,19,'#c1b8ae',32,3);D.text(sc().failure&&sc().failure.memorialSaved?'这次死亡已记入纪念馆':'纪念记录待保存，请保留当前页面',640,425,13,sc().failure&&sc().failure.memorialSaved?'#b8c6cc':'#ffad9e','center');D.text(`留存节点：${sc().checkpointLabel}`,640,454,15,'#b8c6cc','center');button('读档重来 · 恢复50血量',377,495,526,53,()=>{result(game.restoreCheckpoint(),()=>{modal=null;screen='play';resetChapterUI();startChapterPlayback()})},{fill:'#8f5b35',border:'#d49c61',color:'#fff0d4',size:22});button('死亡纪念馆',447,565,169,34,openMemorial,{size:15,fill:'#17222c',color:'#fff0d4',border:'#795448'});button('返回标题',635,565,169,34,()=>{screen='title';modal=null},{size:15,fill:'#17222c',color:'#fff0d4',border:'#795448'});}
function endingScreen(){
 const e=(sc().status==='complete'?sc().finalEnding:sc().ending)||{title:'新的分岔',text:'故事在这里留下了你的选择。'},next=nextUnfinishedChapter(),backfill=next&&chapters.findIndex(c=>c.id===next.id)<chapters.findIndex(c=>c.id===current().id);
 D.img(P.image(`assets/scenes/ch${id2(current().id)}-c.jpg`),0,0,W,H,'cover',.28);D.box(220,100,840,510,'rgba(255,255,255,.96)',15,T.line);D.text(next&&sc().status==='complete'?'尚有未曾讲起的往事':sc().status==='complete'?'人生终章':'章节结局',640,139,15,T.gold,'center');D.text(e.title||'此路留下回声',640,186,43,T.ink,'center','serif');D.wrap(e.text||e.description||'',285,269,710,23,T.muted,38,5);D.text(`血量 ${sc().hp}  ·  信任 ${sc().trust}  ·  洞察 ${sc().insight}`,640,463,17,T.teal,'center');
 const unlocked=!next&&sc().status==='complete'&&wardrobe.getState().femaleUnlocked;
 button(next?(backfill?'回望补入的往事 · '+next.title:'继续下一章 · '+next.title):'回看人生异闻',unlocked?255:381,520,unlocked?370:518,54,()=>{if(next){const r=game.startChapter(next.id);result(r,enter)}else{screen='chapters';tabPage=0}},{size:21,fill:'#5de4b6',border:T.teal});if(unlocked)button('女版已解锁 · 去衣橱',655,520,370,54,openWardrobe,{size:21,border:T.gold});if(sc().status==='complete')button('返回标题',541,627,198,44,()=>{screen='title';modal=null},{size:19});
}
function eventModal(){const e=sc().event;overlay(e.title,e.category==='beneficial'||e.category==='beneficial_over_time'?'喜报 · 命运回响':'突发事件 · 命运无常');D.wrap(e.text,220,213,830,21,T.muted,34,4);if(e.category==='beneficial_over_time'){const effect=e.statusEffect;D.text(effect?`持续恢复 · ${effect.durationDays}个游戏日 · 每日 +${effect.hpPerTick}`:'持续恢复已准备',640,352,28,T.teal,'center','serif');}if(e.category==='beneficial'){D.text('血量已恢复至 100%',640,342,42,T.gold,'center','serif');D.line(420,405,860,405,T.gold);}e.choices.forEach((c,i)=>{const unavailable=c.requires&&Object.keys(c.requires).some(k=>typeof c.requires[k]==='number'&&sc()[k]<c.requires[k]);button(c.label,220,411+i*61,840,49,()=>{result(game.resolveEvent(c.id));},{disabled:!!unavailable,size:19,fill:e.category==='beneficial'?'#ffe372':'#d7bdff',border:e.category==='beneficial'?T.gold:T.line});});}
function closeModal(){modal=null;}
function monthlyModal(){const a=game.getMonthlyAssessment();if(monthlyFeedback){const f=monthlyFeedback;overlay(f.correct?'考核反馈 · 回答正确':'考核反馈 · 需要补课',`第 ${f.month} 次月度考核`);D.text(f.correct?'血量保持不变':`本题扣除 ${f.hpLoss} 点血量`,220,217,29,f.correct?T.teal:T.red);D.wrap(f.question.explanation,220,278,830,22,T.ink,36,4);D.wrap('知识来源：'+f.question.source.fileName+' / '+f.question.source.section,220,453,830,14,T.muted,23,2);button(a?'继续下一题':'考核完成，返回旅程',220,541,840,50,()=>{monthlyFeedback=null;resumePendingChapterPlayback()},{size:21,fill:'#5de4b6',border:T.teal});return;}if(!a||!a.question)return;const q=a.question;if(monthlyReadingId===q.id&&a.hasHint){overlay(q.title,'月度考核 · 手册提示');D.wrap(q.reading,220,222,830,21,T.ink,34,6);D.wrap('来源：'+q.source.fileName+' / '+q.source.section,220,465,830,14,T.muted,23,2);button('返回本题',220,542,840,49,()=>{monthlyReadingId=null},{size:21});return;}overlay(`第 ${a.month} 次月度考核`,`已度过 ${a.month*28} 个游戏日 · 第 ${a.index+1}/${a.total} 题`);D.text(`每题答错扣 ${a.wrongHpLoss} 血量 · 答题不消耗行动`,220,207,15,T.gold);button(a.hasHint?'查看已购提示':`手册提示 · ${a.hintCost||5}金币`,850,134,210,37,()=>{const r=game.buyMonthlyHint(q.id);if(!r.ok){notify(r.message);return;}save();monthlyReadingId=q.id;},{size:14});D.wrap(q.scene||'',220,244,830,16,T.muted,25,2);D.wrap(q.question,220,307,830,22,T.ink,31,2);q.options.forEach((o,i)=>button(o,220,386+i*52,840,42,()=>{const r=game.answerMonthly(i,q.id);if(!r.ok){notify(r.message);return;}save();modal=null;monthlyFeedback=sc().status==='failure'||r.review?null:{question:q,correct:r.correct,hpLoss:r.hpLoss,month:a.month};if(r.review){notify('已带回首次答案，本题不再重复作答。');resumePendingChapterPlayback();}notifyMedals(r);notifyQuestionHistory();},{size:17}));}
function memorialScreen(){pagesHeader('死亡纪念馆','每次终止都留下记录。读档和开启新游戏不会抹去旧日。');const m=memorialSnapshot||{records:[],stats:[],total:0};D.box(40,116,358,493,T.panel,12,T.line);D.text('死因占比',63,140,25,T.ink,'left','serif');D.text(`累计 ${m.total||0} 次死亡`,63,182,16,T.gold);const stats=m.stats||[];stats.filter(r=>r.count>0).forEach((r,i)=>{const y=229+i*51;D.text(r.label,63,y,16,T.ink);D.text(`${r.count} 次 · ${r.percentage.toFixed(1)}%`,374,y,15,T.gold,'right');D.box(64,y+26,309,5,'#e0e8e9',2);D.box(64,y+26,309*r.percentage/100,5,T.gold,2);});if(!m.total)D.wrap('尚无死亡记录。\n愿每次选择都让你走得更远。',63,249,290,18,T.muted,32);D.text('按最终致死原因分类；占比来自真实记录。',60,575,12,T.muted);const records=m.records.slice().reverse(),rows=records.slice(memorialPage*4,memorialPage*4+4);rows.forEach((r,i)=>{const y=116+i*122;D.box(420,y,817,109,T.panel,10,T.line);D.text(r.causeTitle,440,y+15,23,T.gold,'left','serif');D.text(r.categoryLabel,1215,y+19,15,T.muted,'right');D.text(`第${r.day}天 · ${r.dayPhase}   |   第${r.gameOrder||r.chapterOrder}章 ${r.chapterTitle}`,440,y+53,16,T.ink);const date=new Date(r.recordedAtMs+8*3600000).toISOString().slice(0,19).replace('T',' ');D.text(`记录于 ${date}（北京时间） · ${r.persisted?'已保存':'待保存'}`,440,y+81,12,r.persisted?T.muted:T.red);});button('上一页',599,646,130,40,()=>memorialPage--,{disabled:memorialPage===0,size:16});D.text(`${memorialPage+1} / ${Math.max(1,Math.ceil(records.length/4))}`,836,658,16,T.muted,'center');button('下一页',946,646,130,40,()=>memorialPage++,{disabled:(memorialPage+1)*4>=records.length,size:16});if(m.storageError){button('记录待保存 · 重试',47,645,305,42,()=>{game.retryMemorialSave();memorialSnapshot=game.getMemorial()},{size:15,border:T.red});}}
function renderModal(){if(!modal)return;const m=modal;overlay(m.title||({intro:chapterTitle(),clue:m.clue&&m.clue.title,mission:'选择本章命运',prepare:'事前准备',rest:'给自己留一点余地',entertain:'休闲娱乐',menu:'旅程菜单',question:'值班知识任务',reading:m.question&&m.question.title,answer:'任务反馈',questionsDone:'学习任务',npc:m.npc&&m.npc.name,sourceUnavailable:'原作影像',sideSourceUnavailable:'同行者影像',newConfirm:'开启新的故事',replayConfirm:'重走这一段人生',clearStudy:'清除研究数据',survey:'片刻自评',status:'身心状态',actions:'更多行动'}[m.type]||'白衣异闻'));
 if(!['question','survey'].includes(m.type))button('关闭',992,118,68,34,closeModal,{size:15});
 if(m.type==='status'){const effects=game.getStatusEffects();if(!effects.length)D.text('当前没有持续状态。',220,242,23,T.muted);effects.slice(0,4).forEach((e,i)=>{const x=220+(i%2)*430,y=217+Math.floor(i/2)*151;D.box(x,y,410,134,'#f0e7ff',9,T.line);D.text(e.title,x+17,y+16,21,e.kind==='heal'?T.teal:T.red);D.text(`剩余约 ${Math.ceil(e.remainingActions/5)} 天`,x+17,y+57,17,T.ink);D.text(`每次结算${e.kind==='heal'?'恢复':'扣除'} ${e.hpPerTick} 血量`,x+17,y+88,17,e.kind==='heal'?T.teal:T.red);});D.wrap('每 5 次行动或首次看完一章，结算 1 天的持续状态。\n同次回血与伤害合并结算；菜单、暂停和重复观看不计时。',220,535,830,17,T.muted,28,2);}
 else if(m.type==='actions'){actionGrid([['休闲娱乐',()=>openAction('entertain')],['科研申请',()=>openAction('research')],['科室事务',()=>openAction('politics')],['事前准备',()=>openAction('prepare')],['值班手册',()=>openAction('book')],['身心状态',()=>openAction('status')],['保存节点',()=>openAction('save')],['原作影像',()=>openAction('source')],['人物档案',()=>openAction('npcs')]]);D.text('查看与切换菜单不消耗行动；具体代价会在确认时显示。',220,578,17,T.muted);}
 else if(m.type==='risk'){const risks=game.getRisks();const rr=risks[m.action]||{};D.wrap(m.action==='work'?'完成临床工作立即获得3金币津贴，并累计24金币应发工资；每月有15%概率半薪。':m.action==='research'?`每5个游戏日至少完成一次科研，逾期直接死亡。当前还剩${researchRemainingText()}；完成科研后重新计时。首次看完主线或支线也计1天。`:'科室事务可以建立信任，也可能使你卷入复杂关系。',220,219,820,22,T.ink,36,3);D.wrap('可能出现的失败事件：'+({work:'丙级病历',research:'科研基金申请失败',politics:'被上级派系斗争波及'}[m.action]),220,353,820,20,T.red,32,3);D.wrap(rr.text||'事前准备可以降低风险，但不能保证豁免。',220,450,830,17,T.muted,27,2);if(m.action==='research')D.text('事前准备不算完成科研。',220,327,17,T.gold);button(researchDeadline().remainingUnits===1?'准备将导致逾期':'先做准备',220,538,260,49,()=>{modal={type:'prepare'}},{size:20});button('确认行动',503,538,557,49,()=>doAction(m.action),{size:20,fill:'#ff9b80',border:T.gold});}
 else if(m.type==='storyIntro'){D.text(m.side?'同行者的故事':sourceLabel(m.story),220,219,17,T.gold);D.wrap(m.story.transitionIntro,220,268,830,23,T.ink,39,5);D.wrap(m.story.timeNote||'开场不消耗行动；首次看完影像才推进1天。',220,465,830,17,T.muted,27,2);button('进入剧情',220,538,840,49,()=>continueStoryIntro(m),{size:22,fill:T.mint,border:T.teal});}
 else if(m.type==='researchVideoWarning'){D.wrap(`科研期限还剩${researchRemainingText()}。这段视频首次看完会推进1天，届时将触发科研逾期死亡。`,220,225,830,24,T.red,40,3);D.wrap('可以先完成科研，再回来继续观看；暂停和重看已完成的视频不推进期限。',220,375,830,21,T.muted,34,3);button('先做科研',220,538,400,49,chooseResearchBeforeVideo,{size:22,fill:T.mint,border:T.teal});button('仍然继续观看',641,538,419,49,()=>continueRiskyVideo(m),{size:21,fill:T.softCoral,border:T.red});}
 else if(m.type==='prepare'){const urgent=researchDeadline().remainingUnits===1;D.wrap('计1次行动，花费8精力与5金币，降低对应行动的突发失败概率。\n事前准备不算完成科研。',220,222,830,21,T.muted,35,2);if(urgent)D.text('此时再花1次行动准备会触发科研逾期，请直接完成科研。',220,304,17,T.red);[['record','核对病历：查缺补漏'],['grant','检查标书：核实依据'],['neutral','梳理职责：保持边界']].forEach(([kind,label],i)=>button(label,220,(urgent?335:330)+i*(urgent?66:77),840,urgent?48:56,()=>doAction('prepare',{kind}),{size:21}));if(urgent)button('直接完成科研 · 查看风险',220,542,840,49,()=>requestRisk('research'),{size:21,fill:T.mint,border:T.teal});}
 else if(m.type==='rest'){D.wrap(`基础休息免费，计 1 次行动，恢复 ${DEFAULT_RULES.restHpGain} 血量和 ${DEFAULT_RULES.restEnergyGain} 精力。\n时间也会被记录下来，但你不需要用透支证明自己。`,220,228,825,22,T.ink,39,4);button('留在这里休息',220,527,840,54,()=>doAction('rest'),{size:22,fill:'#5de4b6',border:T.teal});}
 else if(m.type==='entertain'){D.wrap('给下班后的自己安排一场电影、一段音乐或一场游戏。\n消耗 10 金币，恢复 20 血量与 20 精力，计 1 次有效行动。',220,228,825,22,T.ink,39,4);D.text(`当前拥有 ${sc().money} 金币`,220,441,18,T.gold);button(sc().money>=10?'享受片刻闲暇':'金币不足，可先进行基础休息',220,527,840,54,()=>doAction('entertain'),{disabled:sc().money<10,size:22,fill:'#5de4b6',border:T.teal});}
 else if(m.type==='mission'){const completed=game.isVideoCompleted(current().id);D.text(completed?'本章影像已完整播放':'请先观看本章剧情',220,216,19,completed?T.teal:T.gold);D.wrap(completed?'接下来的选择将改写李晨光的命运。':'视频自然播放结束后，三个命运选择才会开放。',220,255,830,21,T.ink,33,2);const avail=conditions(current());current().choices.forEach((ch,i)=>{const y=324+i*87;button(ch.label,220,y,840,48,()=>{const r=game.chooseEnding(ch.id);result(r,()=>{modal=null;inviteSurvey();});},{size:20,disabled:!completed||!avail.includes(ch.id)});D.text(ch.text||ch.ending.text,239,y+55,14,T.muted);});}
 else if(m.type==='reading'){const q=m.question;D.text(q.category+' · 手册要点',220,214,14,T.gold);D.wrap(q.reading,220,250,830,21,T.ink,34,6);D.wrap('来源：'+q.source.fileName+' / '+q.source.section+(q.source.pageOrAnchor?' / '+q.source.pageOrAnchor:''),220,466,830,13,T.muted,22,2);button(game.isQuestionAnswered(q.id)?'查看已做题解析':sessionActive?'查阅完成，尝试任务':'开始旅程后可作答',220,542,840,48,()=>question(q),{size:20,disabled:!sessionActive&&!game.isQuestionAnswered(q.id),fill:'#5de4b6',border:T.teal});}
 else if(m.type==='questionsDone'){D.text('当前题库已完成',220,233,31,T.teal);D.wrap('你已作答当前全部题目。可继续查阅手册与已做题解析；不会重复出题，也不会重复扣行动或发放奖励。',220,301,830,23,T.ink,39,4);button('查阅手册与已做题解析',220,541,840,50,showBook,{size:21,fill:'#5de4b6',border:T.teal});}
 else if(m.type==='question'){const q=m.question;D.wrap(q.scene||'',220,210,830,16,T.gold,25,2);D.wrap(q.question,220,270,830,22,T.ink,33,3);q.options.forEach((o,i)=>button(o,220,377+i*53,840,43,()=>clinicalAnswer(q,i),{size:17}));button('先查手册',919,125,141,33,()=>{modal={type:'reading',question:q}},{size:14});}
 else if(m.type==='answer'){D.text(m.repeat?'已做题复习':m.correct?'判断正确':'把这一点记下来',220,218,31,m.correct?T.teal:T.gold,'left','serif');D.wrap(m.question.explanation,220,279,830,23,T.ink,39,4);D.text('正确选项：'+m.question.options[m.question.correctIndex],220,447,19,T.teal);button('返回任务',220,541,840,50,()=>{modal=null;screen=sessionActive?'play':'book'},{size:20});}
 else if(m.type==='npc'){
 const n=m.npc,d=n.dialogue[m.index%n.dialogue.length],required=n.quest.requiresSideVideos||[],watched=required.every(id=>game.isSideVideoCompleted(id)),done=!!sc().flags['npc_done_'+n.id];
 D.img(P.image(n.portrait),220,211,213,296,'contain');D.text(n.subtitle||'同行者',462,215,16,T.gold);D.text(d.title,462,254,25,T.ink,'left','serif');D.wrap(d.text,462,301,591,21,T.ink,35,4);
 D.text('同行支线：'+n.quest.title,462,452,17,T.teal);D.wrap(n.quest.description,462,482,591,15,T.muted,24,2);
 D.text(done?'同行任务已完成':watched?'计1次行动、耗3精力；奖励信任+2、洞察+1、精力+8':'先看完人物故事，再一起完成同行任务',220,532,14,T.gold);
 button('继续交谈',220,566,210,40,()=>{modal={type:'npc',npc:n,index:m.index+1}},{size:17});
 button('观看人物故事',445,566,250,40,()=>openSideStories(n.id),{size:17,fill:T.mint,border:T.teal});
 button(done?'支线已完成':watched?'帮助同行者':'先观看故事',710,566,350,40,()=>{screen='play';result(game.act({type:'npc',npcId:n.id,completeQuest:true}),()=>{modal={type:'npcDone',npc:n}})},{size:17,disabled:!sessionActive||!watched||done||sc().status!=='playing'||!!sc().event||!!game.getMonthlyAssessment()});
 }
 else if(m.type==='npcDone'){D.wrap(m.npc.quest.completionText,220,230,830,23,T.ink,39,6);button('继续前行',220,542,840,49,closeModal,{size:20});}
 else if(m.type==='sideSourceUnavailable'){D.text('支线影像暂不可用',220,223,27,T.gold);D.wrap(m.message,220,286,830,23,T.ink,38,4);D.text('播放记录已保留；尚未完成的视频不计入游戏天数。',220,449,17,T.muted);button('重试播放',220,543,400,48,()=>playSideStory(m.story),{size:21,fill:T.mint,border:T.teal});button('返回支线剧场',641,543,419,48,()=>openSideStories(m.story.npcId),{size:21});}
 else if(m.type==='sourceUnavailable'){const completed=game.isVideoCompleted(current().id);D.text(completed?'本次重看暂不可用':'本章视频尚未完成',220,223,27,T.gold);D.wrap(completed?'原有观看记录已保留，可继续选择本章命运，或重试播放。':m.message||'视频暂时无法播放，请重试。',220,286,830,23,T.ink,38,4);D.wrap(completed?'重看失败不会撤销本章已经开放的命运选择。':'你仍可安排值班、休息与学习；完整播放本章视频后才能推进主线。',220,449,830,18,T.muted,29,2);button('重试播放',220,543,400,48,()=>playSource(),{size:21,fill:'#5de4b6',border:T.teal});button(completed?'返回命运选择':'返回值班',641,543,419,48,()=>{modal=completed?{type:'mission'}:null},{size:21});}
 else if(m.type==='menu'){actionGrid([['更换穿搭',openWardrobe],['读取关键节点',()=>result(game.restoreCheckpoint(),()=>{closeModal();resetChapterUI();startChapterPlayback()})],['身心状态',()=>{modal={type:'status'}}],['人物档案',()=>{screen='npcs';closeModal()}],['称号馆',openMedals],['死亡纪念馆',openMemorial],['巅峰榜单',openBoards],['研究设置',()=>{screen='study';closeModal()}],['返回标题',()=>{screen='title';closeModal()}]]);D.text('打开菜单不会消耗行动，持续状态也会暂停推进。',220,578,17,T.muted);}
 else if(m.type==='newConfirm'){D.wrap('开启新故事会替换当前游戏进度，并将各章播放位置从头开始。称号、形象资格、已做题和纪念馆独立保留。',220,240,830,23,T.ink,39,4);button('保留当前旅程',220,530,400,52,closeModal,{size:20});button('开始新的故事',641,530,419,52,newJourney,{size:20,fill:'#ffe372',border:T.gold});}
 else if(m.type==='replayConfirm'){D.wrap('将从这章最初的节点重玩；这一章及之后的当前通关进度会重置，收集过的结局仍保留。',220,240,830,23,T.ink,39,4);button('取消',220,530,400,52,closeModal,{size:20});button('重走这一章',641,530,419,52,()=>{result(game.startChapter(m.chapter.id,{replay:true}),enter)},{size:20});}
 else if(m.type==='clearStudy'){D.wrap('这会删除当前设备上保存的研究答卷与参与记录。游戏存档不受影响。',220,240,830,23,T.ink,39,4);button('保留数据',220,530,400,52,closeModal,{size:20});button('确认删除本地答卷',641,530,419,52,()=>{survey.clearData();closeModal();notify('本地研究记录已清除。')},{size:20,fill:'#ff9b80',border:T.red});}
 else if(m.type==='survey'){const item=m.items[m.index];D.wrap(studyConfig.instructions,220,212,830,15,T.muted,24,2);D.wrap(item.text,220,280,830,23,T.ink,36,3);const opts=studyConfig.responseOptions;opts.forEach((o,i)=>button(o.label,220+(i%4)*212,400+Math.floor(i/4)*65,198,52,()=>answerSurvey(item,o.value),{size:15}));button('本题跳过',220,555,250,40,()=>{survey.skip(item.id,{chapterId:sc().chapterId,gameOrder:chapters.indexOf(current())+1});nextSurveyItem()},{size:16});button('退出本次问卷',770,555,290,40,()=>{survey.withdraw();closeModal()},{size:16});}
}
function inviteSurvey(){if(!survey.isConfigured())return;const batch=survey.getNextBatch(sc().chapterId,{gameOrder:chapters.indexOf(current())+1});if(Array.isArray(batch)&&batch.length)modal={type:'survey',items:batch,index:0};}
function answerSurvey(item,value){const r=survey.answer(item.id,value,{chapterId:sc().chapterId,gameOrder:chapters.indexOf(current())+1});if(r.ok)nextSurveyItem();else notify(r.code||'暂未记录。');}
function nextSurveyItem(){if(modal&&modal.type==='survey'){modal.index++;if(modal.index>=modal.items.length)modal=null;}}
P.bind((kind,e)=>{if(kind==='hide'){if(sessionActive)save();saveVideoProgress();return;}if(busy)return;if(kind==='keydown'){if(e.key==='Escape'){if(videoActive)P.closeVideo();else modal=null;}return;}if(kind!=='down')return;const x=(e.x-transform.x)/transform.s,y=(e.y-transform.y)/transform.s;if(x<0||x>W||y<0||y>H)return;for(let i=buttons.length-1;i>=0;i--){const b=buttons[i];if(x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h){if(!b.disabled)b.fn();return;}}});
function render(ms){clock=ms||0;const s=P.size();ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#e8f6f0';ctx.fillRect(0,0,P.canvas.width,P.canvas.height);ctx.setTransform(s.dpr*transform.s,0,0,s.dpr*transform.s,s.dpr*transform.x,s.dpr*transform.y);D.box(0,0,W,H,T.bg,0);cheerfulBackground();buttons=[];
 if(screen==='identity')identityScreen();else if(screen==='avatar')avatarScreen();else if(screen==='title')titleScreen();else if(screen==='chapters')chaptersScreen();else if(screen==='book')bookScreen();else if(screen==='npcs')npcsScreen();else if(screen==='sideStories')sideStoriesScreen();else if(screen==='archive')archiveScreen();else if(screen==='study')studyScreen();else if(screen==='memorial')memorialScreen();else if(screen==='leaderboard')leaderboardScreen();else if(screen==='medals')medalsScreen();else if(screen==='wardrobe')wardrobeScreen();else if(sc().status==='failure')failureScreen();else if(sc().status==='chapter_end'||sc().status==='complete')endingScreen();else playScreen();
 if(sc().status!=='failure'&&sc().event&&screen==='play'){buttons=[];eventModal();}else if(screen==='play'&&sc().status==='playing'&&(monthlyFeedback||game.getMonthlyAssessment())){buttons=[];monthlyModal();}else if(modal){buttons=[];renderModal();}
 if(busy){buttons=[];overlay('正在连接旅程');D.text('请稍候，当前进度保持不变。',640,326,22,T.muted,'center');}if(videoActive){buttons=[];D.box(0,0,W,H,'#fff9ed',0);D.text(activeSideStory?'同行者 · '+activeSideStory.title:chapterTitle(),32,19,20,T.ink);D.text('首次完整播放推进 1 天并判定随机事件；暂停保留位置，重看不额外计时。',640,607,13,T.muted,'center');button(activeSideStory?'暂停观看 · 返回支线':'暂停观看 · 返回值班',420,634,440,73,()=>P.closeVideo(),{size:23});}
 if(toast&&clock<toastUntil&&!videoActive){const width=Math.min(1100,toast.length*16+48);D.box((W-width)/2,83,width,43,'#fff4c5',8,T.teal);D.text(toast,W/2,95,16,T.ink,'center');}
 if(s.w<s.h){ctx.setTransform(s.dpr,0,0,s.dpr,0,0);D.text('请横置设备，观看白衣志怪录',s.w/2,transform.y-42,16,T.muted,'center');}
 P.raf(render);
}
if(!P.native)window.BAIYI_APP={get game(){return game},get medals(){return session.medals},wardrobe,leaderboard,survey,chapters,npcs,sideStories,knowledge,getScreen:()=>screen,getModal:()=>modal,buttons:()=>buttons.map(({label,x,y,w,h,disabled})=>({label,x,y,w,h,disabled})),start:()=>{sessionActive=true;screen='play';modal=null;resetChapterUI()},showFailure:id=>{if(debug){game.act({type:'forceEvent',eventId:id});screen='play';modal=null}},showEvent:id=>{if(debug){game.act({type:'forceEvent',eventId:id});screen='play';modal=null}},setScreen:s=>{screen=s;modal=null},showQuestion:id=>question(knowledge.find(q=>q.id===id)),renderState:()=>({screen,chapter:current().title,hp:sc().hp,energy:sc().energy,room:sc().room,status:sc().status,modal:modal&&modal.type,videoActive,activeSideStory:activeSideStory&&activeSideStory.id,videoCompleted:game.isVideoCompleted(current().id)})};
P.raf(render);

};
modules["src/platform.js"]=function(require,module,exports){
'use strict';
const native = typeof wx !== 'undefined' && typeof wx.createCanvas === 'function';
const canvas = native ? wx.createCanvas() : document.getElementById('game');
const imageCache = {};
let onResize = () => {};
let input = null;
let videoSession = null;
function readSize() {
  if (native) { const x = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); return {w:x.windowWidth,h:x.windowHeight,dpr:Math.min(x.pixelRatio||1,2)}; }
  return {w:window.innerWidth,h:window.innerHeight,dpr:Math.min(window.devicePixelRatio||1,2)};
}
let windowSize = readSize();
function size() { return windowSize; }
function image(path) {
  if(!imageCache[path]) { const im=native?wx.createImage():new Image(); imageCache[path]=im; im._ready=false; im.onload=()=>{im._ready=true}; im.onerror=()=>{im._failed=true}; im.src=(typeof window!=='undefined' && window.BAIYI_ASSETS && window.BAIYI_ASSETS[path]) || path; }
  return imageCache[path];
}
const storage={ getItem(k){try {return native?wx.getStorageSync(k):localStorage.getItem(k)}catch(e){return null}}, setItem(k,v){try{if(native)wx.setStorageSync(k,v);else localStorage.setItem(k,typeof v==='string'?v:JSON.stringify(v));return true}catch(e){return false}}, removeItem(k){try{if(native)wx.removeStorageSync(k);else localStorage.removeItem(k);return true}catch(e){return false}} };
function resized() {
 windowSize=readSize();
 // Native video is an independent layer; close it before the canvas changes geometry.
 closeVideo('resize');
 onResize();
}
function bind(handler) {
 input=handler;
 const send=(kind,e)=>{const t=(e.touches&&e.touches[0])||(e.changedTouches&&e.changedTouches[0])||e;input(kind,{x:t.clientX,y:t.clientY,key:e.key,original:e})};
 if(native){ wx.onTouchStart(e=>send('down',e));wx.onTouchMove(e=>send('move',e));wx.onTouchEnd(e=>send('up',e));wx.onTouchCancel(e=>send('cancel',e)); if(wx.onWindowResize)wx.onWindowResize(resized);wx.onHide(()=>{pauseVideo();input('hide',{});}); }
 else {canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);send('down',e)});canvas.addEventListener('pointermove',e=>send('move',e));canvas.addEventListener('pointerup',e=>send('up',e));canvas.addEventListener('pointercancel',e=>send('cancel',e));window.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key))e.preventDefault();send('keydown',e)});window.addEventListener('keyup',e=>send('keyup',e));window.addEventListener('resize',resized);window.addEventListener('blur',()=>input('cancel',{}));document.addEventListener('visibilitychange',()=>{if(document.hidden){pauseVideo();input('hide',{})}});}
}
function ignoreFailure(fn) {
 try { const value=fn(); if(value&&typeof value.then==='function')value.catch(()=>{}); } catch(e) {}
}
const finiteTime=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
function notifyVideo(fn,value){if(typeof fn==='function')ignoreFailure(()=>fn(value));}
function videoTimes(session,payload) {
 // wx Video.onTimeUpdate reports {position,duration}; HTMLMediaElement exposes
 // currentTime/duration. Keep the last reliable values through pause/destroy.
 const el=session.element;
 const position=payload&&(finiteTime(payload.position)?payload.position:payload.currentTime);
 if(payload&&finiteTime(payload.duration))session.duration=payload.duration;
 if(!native&&el){
  if(finiteTime(el.duration))session.duration=el.duration;
  if(!session.pendingSeek&&finiteTime(el.currentTime))session.currentTime=el.currentTime;
 }
 if(finiteTime(position)&&!session.pendingSeek)session.currentTime=position;
 return {currentTime:session.currentTime,duration:session.duration};
}
function reportVideoProgress(session,payload) {
 if(!session||videoSession!==session)return;
 notifyVideo(session.onProgress,videoTimes(session,payload));
}
function pauseVideo() {
 const session=videoSession;
 if(!session)return;
 if(session.element&&typeof session.element.pause==='function')ignoreFailure(()=>session.element.pause());
 reportVideoProgress(session);
}
function removePlayButton(session) {
 if(!session.playButton)return;
 const button=session.playButton;session.playButton=null;button.onclick=null;
 if(typeof button.remove==='function')ignoreFailure(()=>button.remove());
}
function finishVideo(session,reason,notifyEnd) {
 if(!session||videoSession!==session)return;
 const times=videoTimes(session);
 if(reason==='ended'&&times.duration>0)times.currentTime=times.duration;
 // Invalidate before cleanup or user callbacks: a late event, stop(), or an
 // onProgress callback that starts another clip cannot complete its replacement.
 videoSession=null;
 removePlayButton(session);
 const el=session.element;
 if(el){
  if(native){
   for(const [event,listener] of session.listeners){
    const off=el[`off${event}`];
    if(typeof off==='function')ignoreFailure(()=>off.call(el,listener));
   }
   if(typeof el.stop==='function')ignoreFailure(()=>el.stop());
   if(typeof el.destroy==='function')ignoreFailure(()=>el.destroy());
  }else{
   for(const name of ['onended','onerror','ontimeupdate','onloadedmetadata','ondurationchange','oncanplay','onpause','onplay'])el[name]=null;
   if(typeof el.pause==='function')ignoreFailure(()=>el.pause());
   if(typeof el.removeAttribute==='function')ignoreFailure(()=>el.removeAttribute('src'));
   if(typeof el.load==='function')ignoreFailure(()=>el.load());
   if(typeof el.remove==='function')ignoreFailure(()=>el.remove());
  }
 }
 if(session.objectUrl&&session.urlApi)ignoreFailure(()=>session.urlApi.revokeObjectURL(session.objectUrl));
 notifyVideo(session.onProgress,times);
 const outcome={reason,currentTime:times.currentTime,duration:times.duration};
 if(notifyEnd)notifyVideo(session.onEnd,outcome);
 return outcome;
}
function closeVideo(reason='closed') { return finishVideo(videoSession,reason==='resize'?'resize':'closed',true); }
function browserVideoSource(src,session) {
 const embedded=window.BAIYI_VIDEOS;
 if(!embedded||!Object.prototype.hasOwnProperty.call(embedded,src))return src;
 const base64=embedded[src];
 const decode=window.atob||(typeof atob==='function'?atob:null);
 const BlobType=window.Blob||(typeof Blob!=='undefined'?Blob:null);
 const urlApi=window.URL||(typeof URL!=='undefined'?URL:null);
 if(typeof base64!=='string'||!base64.length||!decode||!BlobType||!urlApi||typeof urlApi.createObjectURL!=='function')throw new Error('Embedded video is unavailable');
 // Only the requested chapter is decoded. Chunking avoids a second, full-size
 // binary string while the standalone HTML retains the base64 source strings.
 const chunks=[];
 for(let offset=0;offset<base64.length;offset+=32768){
  const binary=decode.call(window,base64.slice(offset,offset+32768));
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  chunks.push(bytes);
 }
 session.urlApi=urlApi;
 session.objectUrl=urlApi.createObjectURL(new BlobType(chunks,{type:'video/mp4'}));
 return session.objectUrl;
}
function playVideo(src, rect, onEnd, onError, options={}) {
 // Replacement saves the old position but does not invoke its completion UI.
 finishVideo(videoSession,'closed',false);
 const startTime=finiteTime(options&&options.startTime)?options.startTime:0;
 const session={element:null,onEnd,onProgress:options&&options.onProgress,currentTime:startTime,duration:0,
  pendingSeek:!native&&startTime>0,listeners:[],objectUrl:null,urlApi:null,playButton:null};
 videoSession=session;
 session.ended=()=>finishVideo(session,'ended',true);
 session.error=error=>{
  if(videoSession!==session)return;
  const outcome=finishVideo(session,'error',true);
  if(typeof onError==='function')ignoreFailure(()=>onError(error,outcome));
 };
 const playFailure=error=>{
  // An audible autoplay refusal is recoverable: leave the native play control.
  if(videoSession!==session)return;
  if(!native&&error&&error.name==='NotAllowedError'){
   if(!session.playButton){
    const button=document.createElement('button');session.playButton=button;
    button.type='button';button.textContent='点击播放';
    button.style.cssText=`position:fixed;left:${rect.x+rect.w/2}px;top:${rect.y+rect.h/2}px;transform:translate(-50%,-50%);z-index:11;padding:16px 28px;border:2px solid #fff;border-radius:999px;background:#132d32;color:#fff;font:700 20px sans-serif;cursor:pointer`;
    button.onclick=()=>{if(videoSession===session)attemptPlay();};
    document.body.appendChild(button);
   }
   return;
  }
  session.error(error);
 };
 const attemptPlay=()=>{
  if(videoSession!==session)return;
  try{const playing=session.element.play();if(playing&&typeof playing.then==='function')playing.then(()=>{if(videoSession===session)removePlayButton(session);},playFailure);}
  catch(error){playFailure(error);}
 };
 try {
  let el;
  if(native){
   if(typeof wx.createVideo!=='function')throw new Error('Video is unavailable');
   // Official Mini Game Video uses initialTime and onTimeUpdate.position;
   // it does not expose the Mini Program component's loadedmetadata event.
   // https://developers.weixin.qq.com/minigame/dev/api/media/video/wx.createVideo.html
   el=wx.createVideo({src,x:rect.x,y:rect.y,width:rect.w,height:rect.h,initialTime:startTime,
    objectFit:'contain',controls:true,showCenterPlayBtn:true,autoplay:false,loop:false,muted:false});
   session.element=el;
   const listen=(event,listener)=>{if(typeof el[`on${event}`]==='function'){el[`on${event}`](listener);session.listeners.push([event,listener]);}};
   listen('Ended',session.ended);listen('Error',session.error);
   listen('TimeUpdate',payload=>reportVideoProgress(session,payload));
   listen('Pause',()=>reportVideoProgress(session));listen('Play',()=>reportVideoProgress(session));
  }else{
   el=document.createElement('video');session.element=el;
   el.controls=true;el.playsInline=true;el.autoplay=false;el.loop=false;el.muted=false;el.preload='metadata';
   el.style.cssText=`position:fixed;left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;z-index:10;background:#05090b;object-fit:contain`;
   const ready=()=>{
    if(videoSession!==session)return;
    videoTimes(session);
    if(session.pendingSeek){
     const target=session.duration>0?Math.min(startTime,session.duration):startTime;
     try{el.currentTime=target;session.currentTime=target;session.pendingSeek=false;}catch(_){return;}
    }
    reportVideoProgress(session);
   };
   el.onended=session.ended;el.onerror=session.error;
   el.ontimeupdate=()=>reportVideoProgress(session);el.onpause=()=>reportVideoProgress(session);el.onplay=()=>{removePlayButton(session);reportVideoProgress(session);};
   el.onloadedmetadata=ready;el.oncanplay=ready;el.ondurationchange=()=>reportVideoProgress(session);
   el.src=browserVideoSource(src,session);document.body.appendChild(el);
   if(el.readyState>=1)ready();
  }
  attemptPlay();
 }catch(error){session.error(error);}
}
module.exports={native,canvas,size,image,storage,bind,closeVideo,playVideo,setResize(fn){onResize=fn},raf(fn){return requestAnimationFrame(fn)},vibrate(){if(native&&wx.vibrateShort)wx.vibrateShort({type:'light'})}};

};
modules["src/draw.js"]=function(require,module,exports){
'use strict';
const theme={bg:'#fff9ed',panel:'#ffffff',panel2:'#ecfff8',line:'#b8d7d1',ink:'#253344',muted:'#526273',teal:'#087b6c',gold:'#9b5708',red:'#be3152',purple:'#6840ad',mint:'#5de4b6',coral:'#ff9b80',lemon:'#ffe372',lavender:'#d7bdff',softPurple:'#f0e7ff',softCoral:'#fff0e9',softMint:'#e0fff2',softYellow:'#fff4c5'};
function painter(ctx){
 function box(x,y,w,h,fill,r=10,stroke){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke()}}
 function text(t,x,y,size=20,color=theme.ink,align='left',font='sans-serif',weight='normal'){ctx.font=`${weight} ${size}px ${font}`;ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='top';ctx.fillText(String(t),x,y)}
 function wrap(t,x,y,w,size=18,color=theme.ink,line=29,max=100){ctx.font=`${size}px sans-serif`;ctx.fillStyle=color;ctx.textAlign='left';ctx.textBaseline='top';let dy=0,parts=String(t||'').split('\n');for(const para of parts){let row='';for(const ch of para){if(ctx.measureText(row+ch).width>w&&row){ctx.fillText(row,x,y+dy);dy+=line;row='';if(dy>=line*max)return dy;}row+=ch;}ctx.fillText(row,x,y+dy);dy+=line;if(dy>=line*max)return dy;}return dy}
 function line(x1,y1,x2,y2,color=theme.line,width=1){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke()}
 function img(im,x,y,w,h,fit='cover',alpha=1){if(!im||!im._ready)return false;ctx.save();ctx.globalAlpha*=alpha;box(x,y,w,h,null,8);ctx.clip();const q=fit==='contain'?Math.min(w/im.width,h/im.height):Math.max(w/im.width,h/im.height);ctx.drawImage(im,x+(w-im.width*q)/2,y+(h-im.height*q)/2,im.width*q,im.height*q);ctx.restore();return true}
 function circle(x,y,r,fill,stroke){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1.5;ctx.stroke()}}
 return {box,text,wrap,line,img,circle,theme};
}
module.exports={painter,theme};

};
modules["src/run-session.js"]=function(require,module,exports){
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

};
modules["src/engine.js"]=function(require,module,exports){
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

};
modules["src/memorial.js"]=function(require,module,exports){
'use strict';

const CATEGORY_LABELS = Object.freeze({
  clinical: '医疗事件', research: '科研事件', workplace: '职场事件',
  overwork: '精力透支', assessment: '月度考核', other: '其他事件',
});
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

/** Categorize the immediate game cause, not a conjectured underlying disease. */
function classifyDeath(failure = {}) {
  if (failure.actionType === 'monthly_assessment') return 'assessment';
  if (failure.id === 'record_failure') return 'clinical';
  if (failure.id === 'grant_failure' || failure.id === 'research_absence') return 'research';
  if (failure.id === 'faction_failure') return 'workplace';
  if (['harsh_leader', 'director_hostility', 'senior_rules'].includes(failure.eventId)) return 'workplace';
  if (failure.eventId === 'patient_conflict' || failure.eventId === 'health_crisis') return 'clinical';
  if (failure.eventId === 'family_betrayal' || failure.eventId === 'cyberbullying') return 'other';
  if (failure.exhaustionLethal === true) return 'overwork';
  if (failure.actionType === 'research') return 'research';
  if (failure.actionType === 'clinical') return 'clinical';
  if (failure.actionType === 'work' || failure.actionType === 'politics') return 'workplace';
  return 'other';
}

/** Independent, append-only archive. read() never performs storage I/O. */
function createMemorial(options = {}) {
  const storage = options.storage;
  const storageKey = options.storageKey || 'baiyi-game-memorial-v1';
  const instanceTag = Math.random().toString(36).slice(2, 10) || 'local';
  let records = [];
  let persistedIds = new Set();
  let sequence = 0;
  let storageError = null;

  function readValue() {
    if (!storage) return null;
    if (typeof storage.getItem === 'function') return storage.getItem(storageKey);
    if (typeof storage.getStorageSync === 'function') return storage.getStorageSync(storageKey);
    if (typeof storage.get === 'function') return storage.get(storageKey);
    throw new Error('纪念馆读取接口不可用。');
  }
  function writeValue(value) {
    if (!storage) throw new Error('未配置持久存储，纪念记录暂时只保留在本次运行中。');
    let accepted;
    if (typeof storage.setItem === 'function') accepted = storage.setItem(storageKey, value);
    else if (typeof storage.setStorageSync === 'function') accepted = storage.setStorageSync(storageKey, value);
    else if (typeof storage.set === 'function') accepted = storage.set(storageKey, value);
    else throw new Error('纪念馆保存接口不可用。');
    if (accepted === false) throw new Error('存储拒绝保存纪念记录。');
    if (accepted && typeof accepted.then === 'function') throw new Error('纪念馆需要同步存储接口。');
  }
  function readDisk() {
    const raw = readValue();
    if (raw == null || raw === '') return { version: 1, records: [], sequence: 0 };
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!data || data.version !== 1 || !Array.isArray(data.records)
        || data.records.some((record) => !record || typeof record.deathId !== 'string')) {
      throw new Error('已有纪念记录格式无法读取；为保留原记录，本次没有覆盖它们。');
    }
    return data;
  }
  function mergeFromDisk() {
    const disk = readDisk();
    const merged = new Map();
    for (const record of disk.records) merged.set(record.deathId, clone(record));
    for (const record of records) if (!merged.has(record.deathId)) merged.set(record.deathId, record);
    records = [...merged.values()];
    persistedIds = new Set(disk.records.map((record) => record.deathId));
    sequence = Math.max(sequence, Number(disk.sequence) || 0, records.length);
  }
  try { mergeFromDisk(); } catch (error) { storageError = error.message; }

  function retry() {
    if (!records.some((record) => !persistedIds.has(record.deathId))) return { ok: !storageError, storageError, unsavedCount: 0 };
    try {
      // Merge before writing so a later run never replaces an earlier archive.
      mergeFromDisk();
      writeValue(JSON.stringify({ version: 1, records, sequence }));
      persistedIds = new Set(records.map((record) => record.deathId));
      storageError = null;
      return { ok: true, storageError: null, unsavedCount: 0 };
    } catch (error) {
      storageError = error.message;
      return { ok: false, storageError, unsavedCount: records.filter((record) => !persistedIds.has(record.deathId)).length };
    }
  }
  function now() {
    const clock = options.clock;
    const value = typeof clock === 'function' ? clock() : clock && typeof clock.now === 'function' ? clock.now() : Date.now();
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('现实记录时间无效。');
    return { recordedAt: date.toISOString(), recordedAtMs: date.getTime() };
  }
  function append(input) {
    const suppliedId = input && input.deathId;
    const existing = suppliedId && records.find((record) => record.deathId === suppliedId);
    if (existing) {
      if (!persistedIds.has(existing.deathId)) retry();
      return { ok: persistedIds.has(existing.deathId), duplicate: true, record: clone(existing), storageError };
    }
    let timestamp;
    try {
      timestamp = input.recordedAt && Number.isFinite(input.recordedAtMs)
        ? { recordedAt: input.recordedAt, recordedAtMs: input.recordedAtMs } : now();
    } catch (error) {
      // A broken injected clock must not stop the game from entering failure.
      timestamp = { recordedAt: null, recordedAtMs: null, clockError: error.message };
    }
    sequence += 1;
    let deathId = suppliedId || `death-${timestamp.recordedAtMs == null ? 'unknown' : timestamp.recordedAtMs.toString(36)}-${sequence.toString(36)}-${instanceTag}`;
    while (records.some((record) => record.deathId === deathId)) deathId += '-next';
    const category = CATEGORY_LABELS[input.category] ? input.category : 'other';
    const record = { ...clone(input), ...timestamp, deathId, category, categoryLabel: CATEGORY_LABELS[category] };
    delete record.persisted;
    records.push(record);
    const saved = retry();
    return { ok: saved.ok, duplicate: false, record: clone(record), storageError: saved.storageError };
  }
  function read() {
    const total = records.length;
    const stats = Object.entries(CATEGORY_LABELS).map(([category, label]) => {
      const count = records.filter((record) => record.category === category).length;
      return { category, label, count, percentage: total ? Math.round(count * 1000 / total) / 10 : 0 };
    });
    return {
      records: records.map((record) => ({ ...clone(record), persisted: persistedIds.has(record.deathId) })),
      stats, total, storageError,
      unsavedCount: records.filter((record) => !persistedIds.has(record.deathId)).length,
    };
  }
  return { append, read, retry };
}

module.exports = { createMemorial, classifyDeath, CATEGORY_LABELS };

};
modules["src/question-history.js"]=function(require,module,exports){
'use strict';

// Answer history deliberately lives outside a run save: loading an old node or
// starting over must not turn an answered question into a new reward.
const STORAGE_KEY = 'baiyi-question-history-v1';
const clone = (value) => JSON.parse(JSON.stringify(value));

function createQuestionHistory(options = {}) {
  const records = new Map();
  const pending = new Set();
  const key = options.storageKey || STORAGE_KEY;
  let storageError = null;
  let readFailed = false;

  function validRecord(record) {
    return !!record && ['string', 'number'].includes(typeof record.questionId)
      && (typeof record.questionId !== 'number' || Number.isFinite(record.questionId))
      && String(record.questionId).trim().length > 0 && Number.isInteger(record.answer) && record.answer >= 0
      && typeof record.correct === 'boolean';
  }
  function accept(record, unsaved = false) {
    if (!validRecord(record)
        || !String(record.questionId) || !Number.isInteger(record.answer) || record.answer < 0
        || typeof record.correct !== 'boolean') return false;
    const id = String(record.questionId);
    if (records.has(id)) return false;
    const value = { questionId: record.questionId, answer: record.answer, correct: record.correct,
      source: ['clinical', 'monthly', 'legacy'].includes(record.source) ? record.source : 'legacy' };
    if (record.chapterId != null) value.chapterId = record.chapterId;
    records.set(id, value);
    if (unsaved && options.storage) pending.add(id);
    return true;
  }
  function readStorage() {
    const storage = options.storage;
    if (!storage) return;
    const raw = typeof storage.getItem === 'function' ? storage.getItem(key)
      : typeof storage.getStorageSync === 'function' ? storage.getStorageSync(key)
        : typeof storage.get === 'function' ? storage.get(key) : null;
    if (raw && typeof raw.then === 'function') {
      if (typeof raw.catch === 'function') raw.catch(() => {});
      throw new Error('题目历史仅支持同步读取接口。');
    }
    if (!raw) return;
    const saved = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!saved || saved.version !== 1 || !Array.isArray(saved.records)) throw new Error('题目历史格式不兼容。');
    if (saved.records.some(record => !validRecord(record))
        || new Set(saved.records.map(record => String(record.questionId))).size !== saved.records.length) {
      throw new Error('题目历史记录损坏，原数据未覆盖。');
    }
    // A second instance may have saved since this instance was created. The
    // persisted first answer wins, including over an unpersisted local answer.
    for (const record of saved.records) {
      const id = String(record.questionId);
      records.delete(id); accept(record); pending.delete(id);
    }
  }
  function refresh() {
    const wasReadFailure = readFailed;
    try { readStorage(); readFailed = false; if (wasReadFailure) storageError = null; return true; }
    catch (error) { readFailed = true; storageError = `题目历史读取失败，原数据未覆盖：${error.message || error}`; return false; }
  }
  function getRecords() { return Array.from(records.values(), clone); }
  function persist() {
    if (!options.storage) return true;
    if (!refresh() || readFailed) return false;
    if (pending.size === 0) { storageError = null; return true; }
    try {
      const storage = options.storage;
      const json = JSON.stringify({ version: 1, records: getRecords() });
      let saved;
      if (typeof storage.setItem === 'function') saved = storage.setItem(key, json);
      else if (typeof storage.setStorageSync === 'function') saved = storage.setStorageSync(key, json);
      else if (typeof storage.set === 'function') saved = storage.set(key, json);
      else throw new Error('题目历史存储不可写。');
      if (saved && typeof saved.then === 'function') {
        if (typeof saved.catch === 'function') saved.catch(() => {});
        throw new Error('题目历史仅支持同步写入接口。');
      }
      if (saved === false) throw new Error('存储拒绝保存题目历史。');
      pending.clear(); storageError = null;
      return true;
    } catch (error) { storageError = error.message || String(error); return false; }
  }
  function get(id) { const value = records.get(String(id)); return value ? clone(value) : null; }
  function record(value) {
    refresh();
    const changed = accept(value, true);
    const saved = persist();
    return { ok: saved, alreadyRecorded: !changed, record: get(value && value.questionId), storageError };
  }
  function merge(values) {
    refresh();
    let added = 0;
    for (const value of Array.isArray(values) ? values : []) if (accept(value, true)) added++;
    return { ok: persist(), added, storageError };
  }
  refresh();
  merge(options.initialRecords);
  return { has: (id) => records.has(String(id)), get, getRecords, record, merge, refresh, flush: persist,
    getState: () => ({ records: getRecords(), storageError, unsavedCount: pending.size }) };
}

module.exports = { createQuestionHistory, STORAGE_KEY };

};
modules["data/side-stories.json"]=function(require,module,exports){
module.exports=[
  {
    "id": "guning_red_fox",
    "npcId": "guning",
    "title": "雍和宫红狐",
    "video": "media/side/guning_red_fox.mp4",
    "poster": "assets/side/guning_red_fox.jpg",
    "description": "救下红狐的顾宁许下愿望，却发现愿望的实现方式也需要被说清。",
    "requires": []
  },
  {
    "id": "guning_narcissus_missed",
    "npcId": "guning",
    "title": "水仙错过",
    "video": "media/side/guning_narcissus_missed.mp4",
    "poster": "assets/side/guning_narcissus_missed.jpg",
    "description": "骨科轮转时，顾宁遇见五年后的自己；相互陪伴改变了时间线，也留下无法重逢的遗憾。",
    "requires": [
      "guning_red_fox"
    ],
    "transitionIntro": "听完红狐与愿望的故事，顾宁又讲起骨科轮转时的一次相遇：来帮他度过难关的人，竟然是五年后的自己。",
    "timeNote": "顾宁的往事与未来尾声；五年的跨度只属于片中叙事，首次完整观看仍只推进1个游戏日。",
    "sourceMetadata": {
      "fileName": "水仙错过_动态漫画_1080p.mp4",
      "narrativeOwner": "顾宁",
      "sourceChapterNumber": null,
      "subtitlePath": "docs/source-subtitles/guning_narcissus_missed.srt"
    },
    "sourceReview": {
      "method": "full_subtitles_and_sampled_video_frames",
      "subtitlePath": "docs/source-subtitles/guning_narcissus_missed.srt"
    }
  },
  {
    "id": "huangning_origin",
    "npcId": "huangning",
    "title": "讨封成了规培生",
    "video": "media/side/huangning_origin.mp4",
    "poster": "assets/side/huangning_origin.jpg",
    "description": "黄宁向顾宁讨封，一句话把他带入病历、夜班与科研交织的规培生活。",
    "requires": []
  },
  {
    "id": "huangning_reunion",
    "npcId": "huangning",
    "title": "借来的团圆",
    "video": "media/side/huangning_reunion.mp4",
    "poster": "assets/side/huangning_reunion.jpg",
    "description": "黄宁在病床边听见老人对远方儿子的思念，理解短暂陪伴的意义。",
    "requires": [
      "huangning_origin"
    ]
  },
  {
    "id": "limuliang_city_god",
    "npcId": "limuliang",
    "title": "城隍梦",
    "video": "media/side/limuliang_city_god.mp4",
    "poster": "assets/side/limuliang_city_god.jpg",
    "description": "李慕良在午休的梦中得到晋升捷径，也不得不面对承诺背后的代价。",
    "requires": []
  },
  {
    "id": "limuliang_dice",
    "npcId": "limuliang",
    "title": "命运骰子",
    "video": "media/side/limuliang_dice.mp4",
    "poster": "assets/side/limuliang_dice.jpg",
    "description": "荒诞的命运规则让轻慢感情的李慕良重新面对自己的责任。",
    "requires": [
      "limuliang_city_god"
    ]
  },
  {
    "id": "liuchangsheng_solitude",
    "npcId": "liuchangsheng",
    "title": "五百年孤独",
    "video": "media/side/liuchangsheng_solitude.mp4",
    "poster": "assets/side/liuchangsheng_solitude.jpg",
    "description": "白蛇柳长生来到人间学医，在社交压力与渴望归属之间寻找相处的方式。",
    "requires": []
  },
  {
    "id": "baijin_strategy",
    "npcId": "baijin",
    "title": "锦囊妙计",
    "video": "media/side/baijin_strategy.mp4",
    "poster": "assets/side/baijin_strategy.jpg",
    "description": "新任院长白斯年面临规培基地评审，向祖父白进请教医院管理。",
    "requires": []
  },
  {
    "id": "baijin_self_compassion",
    "npcId": "baijin",
    "title": "恨己如人",
    "video": "media/side/baijin_self_compassion.mp4",
    "poster": "assets/side/baijin_self_compassion.jpg",
    "description": "七旬白进回到年轻规培生的处境，却在查房时面对年长的自己，重新承受他曾认为理所当然的要求。",
    "requires": [
      "baijin_strategy"
    ],
    "transitionIntro": "爷孙谈完医院里的安排，另一则关于白进的异闻翻到了被安排者的一面：年长的他，突然成了被自己审视的年轻规培生。",
    "timeNote": "白进的回溯异闻；年长与年轻的白进属于同一故事的两端，不改变李晨光的年龄与主控身份。",
    "sourceMetadata": {
      "fileName": "白衣志怪录_第三十章_恨己如人_横屏.mp4",
      "narrativeOwner": "白进",
      "sourceChapterNumber": null,
      "filenameChapterNumber": 30,
      "classificationNote": "文件编号与李晨光《美玉白骨》重复，依据完整字幕人物归属，作为白进独立支线保存。",
      "subtitlePath": "docs/source-subtitles/baijin_self_compassion.srt"
    },
    "sourceReview": {
      "method": "full_production_subtitles_and_sampled_video_frames",
      "subtitlePath": "docs/source-subtitles/baijin_self_compassion.srt"
    }
  }
]
;
};
modules["src/leaderboard.js"]=function(require,module,exports){
'use strict';

/**
 * Two independent scopes: unverified device records and server-replayed boards.
 * No game/save/survey imports and no score-upload endpoint. The injected cloud
 * transport receives (payload, {envId, functionName}) and may return wx {result}.
 * Call startLocalRun only for a NEW game, not for a death/checkpoint restore.
 * All public state is copied so UI code cannot accidentally mutate the records.
 * peakActionCount/actionCount remain protocol names; their source is the
 * independent survivalActionCount, with a calendar fallback for legacy saves.
 */
const STORAGE_KEY = 'baiyi.leaderboard.v1';
const DAY_MS = 86400000;
const BEIJING_OFFSET_MS = 8 * 3600000;
const MAX_BATCH_OPERATIONS = 30;
const DEFAULT_CONFIG = Object.freeze({
  enabled: false, envId: '', functionName: 'baiyiLeaderboard',
  longestMetric: 'actionCount', restorePolicy: 'allow_server_replay',
});
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;

function anonymousId(prefix) {
  const c = typeof globalThis !== 'undefined' && globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return `${prefix}_${c.randomUUID()}`;
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = new Uint8Array(16); c.getRandomValues(bytes);
    return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }
  // Local pseudonym only; online identity and seed always come from the server.
  return `${prefix}_${Array.from({ length: 4 }, () => Math.floor(Math.random() * 4294967296).toString(16).padStart(8, '0')).join('')}`;
}

function beijingWindow(timestamp) {
  const start = Math.floor((timestamp + BEIJING_OFFSET_MS) / DAY_MS) * DAY_MS - BEIJING_OFFSET_MS;
  return {
    dayKey: new Date(timestamp + BEIJING_OFFSET_MS).toISOString().slice(0, 10),
    snapshotAt: new Date(start).toISOString(),
    nextUpdateAt: new Date(start + DAY_MS).toISOString(),
  };
}

function emptyBoards() { return { longest: [], wealthiest: [] }; }
function validEntry(entry) {
  return entry === null || (entry && nonempty(entry.playerId) && nonempty(entry.runId)
    && nonempty(entry.nickname) && integer(entry.score) && Number.isFinite(Date.parse(entry.achievedAt)));
}
function validBest(best) {
  return best && validEntry(best.longest) && validEntry(best.wealthiest);
}
function validBoards(boards) {
  return boards && ['longest', 'wealthiest'].every((name) => Array.isArray(boards[name])
    && boards[name].every((e) => e && nonempty(e.playerId) && nonempty(e.nickname) && integer(e.score)));
}
function validOperation(operation) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) return false;
  const keys = {
    act: ['method', 'action'], resolveEvent: ['method', 'choiceId'], chooseEnding: ['method', 'choiceId'],
    completeVideo: ['method', 'chapterId'], completeSideVideo: ['method', 'sideStoryId'],
    answerMonthly: ['method', 'answerIndex', 'expectedQuestionId'], buyMonthlyHint: ['method', 'expectedQuestionId'],
    startChapter: ['method', 'chapterId', 'params'], checkpoint: ['method', 'label'], restoreCheckpoint: ['method'],
  }[operation.method];
  if (!Array.isArray(keys) || Object.keys(operation).some((key) => !keys.includes(key))) return false;
  if (operation.method === 'act') {
    const action = operation.action;
    if (!action || typeof action !== 'object' || Array.isArray(action)) return false;
    const actionKeys = {
      inspect: ['type', 'clueId'], travel: ['type', 'room'], prepare: ['type', 'kind'],
      puzzle: ['type', 'answer'], npc: ['type', 'npcId', 'completeQuest'], clinical: ['type', 'questionId', 'answer'],
      rest: ['type'], work: ['type'], research: ['type'], politics: ['type'], entertain: ['type'],
    }[action.type];
    return Array.isArray(actionKeys) && !Object.keys(action).some((key) => !actionKeys.includes(key));
  }
  if (operation.method === 'completeSideVideo') return typeof operation.sideStoryId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(operation.sideStoryId);
  if (operation.method === 'completeVideo') {
    return (Number.isSafeInteger(operation.chapterId) && operation.chapterId > 0)
      || (typeof operation.chapterId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(operation.chapterId));
  }
  if (operation.method === 'startChapter' && operation.params != null) {
    return typeof operation.params === 'object' && !Array.isArray(operation.params)
      && Object.keys(operation.params).every((key) => key === 'replay')
      && (operation.params.replay === undefined || typeof operation.params.replay === 'boolean');
  }
  return true;
}

function createLeaderboard(input = {}, storage, transport) {
  const config = { ...DEFAULT_CONFIG, ...input };
  const clock = typeof config.clock === 'function' ? config.clock : Date.now;
  const storageKey = STORAGE_KEY; // Deliberately not caller-supplied: cannot alias a game or research save.
  let storageError = null;
  let corruptStorage = false;
  let onlineStatus = 'disconnected';
  let onlineError = null;
  let queue = Promise.resolve();
  let state = {
    version: 1, player: null, run: null,
    allTime: { longest: null, wealthiest: null }, snapshot: null,
    online: { envId: config.envId || '', run: null, pending: [], boards: emptyBoards(), snapshotAt: null, nextUpdateAt: null, serverTime: null },
  };

  function now() {
    const value = Number(clock());
    if (!Number.isFinite(value)) throw new Error('invalid_clock');
    return value;
  }
  function save() {
    if (corruptStorage) return false;
    try {
      if (!storage || typeof storage.setItem !== 'function') throw new Error('storage_unavailable');
      const accepted = storage.setItem(storageKey, JSON.stringify(state));
      if (accepted === false || (accepted && typeof accepted.then === 'function')) throw new Error('storage_write_failed');
      storageError = null;
      return true;
    } catch (error) { storageError = error.message || 'storage_write_failed'; return false; }
  }
  try {
    const raw = storage && typeof storage.getItem === 'function' ? storage.getItem(storageKey) : null;
    if (raw != null && raw !== '') {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : clone(raw);
      if (!parsed || parsed.version !== 1 || !parsed.player || !nonempty(parsed.player.id)
        || !nonempty(parsed.player.nickname) || !validBest(parsed.allTime)
        || (parsed.run && (!nonempty(parsed.run.id) || !integer(parsed.run.peakActionCount) || !integer(parsed.run.peakMoney)))
        || (parsed.snapshot && (!nonempty(parsed.snapshot.dayKey) || !validBoards(parsed.snapshot.boards)))) throw new Error('storage_corrupt');
      state.player = { id: parsed.player.id, nickname: parsed.player.nickname };
      state.run = clone(parsed.run || null);
      state.allTime = clone(parsed.allTime);
      state.snapshot = clone(parsed.snapshot || null);
      // An environment change must never replay a queue into a different server.
      if (parsed.online && parsed.online.envId === config.envId && validBoards(parsed.online.boards)
        && (!parsed.online.run || (nonempty(parsed.online.run.id) && integer(parsed.online.run.seq) && integer(parsed.online.run.seed)))
        && Array.isArray(parsed.online.pending) && parsed.online.pending.every((batch) => batch
          && (batch.expectedSeq == null || integer(batch.expectedSeq)) && Array.isArray(batch.operations)
          && batch.operations.length > 0 && batch.operations.length <= MAX_BATCH_OPERATIONS
          && batch.operations.every(validOperation))) state.online = clone(parsed.online);
    }
  } catch (_) { storageError = 'storage_corrupt'; corruptStorage = true; }

  if (!state.player) {
    const id = anonymousId('local');
    state.player = { id, nickname: `无名夜行者${id.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()}` };
  }

  function configurationErrors() {
    const errors = [];
    if (config.enabled !== true) errors.push('disabled');
    if (!nonempty(config.envId)) errors.push('missing_env');
    if (!nonempty(config.functionName)) errors.push('missing_function_name');
    if (typeof transport !== 'function') errors.push('missing_transport');
    if (config.longestMetric !== 'actionCount') errors.push('unsupported_longest_metric');
    if (config.restorePolicy !== 'allow_server_replay') errors.push('unsupported_restore_policy');
    return errors;
  }
  function rollover() {
    const window = beijingWindow(now());
    if (!state.snapshot || window.dayKey > state.snapshot.dayKey) {
      state.snapshot = {
        ...window, timezone: 'Asia/Shanghai',
        boards: {
          longest: state.allTime.longest ? [{ ...clone(state.allTime.longest), rank: 1 }] : [],
          wealthiest: state.allTime.wealthiest ? [{ ...clone(state.allTime.wealthiest), rank: 1 }] : [],
        },
      };
      save();
    }
    // Device clock rollback does not republish or alter a previous daily snapshot.
  }
  function getLocalBoards() {
    rollover();
    return {
      scope: 'local', label: '本机纪录', verified: false,
      updateLabel: '每日北京时间 00:00 汇总', metric: 'actionCount', counterSource: 'survivalActionCount', actionsPerDay: 5,
      ...clone(state.snapshot), currentBest: clone(state.allTime),
    };
  }
  function getState() {
    const local = getLocalBoards();
    const errors = configurationErrors();
    return {
      version: 1, storageKey, storageError, player: clone(state.player), run: clone(state.run), local,
      online: {
        configured: !errors.length, connected: !errors.length && onlineStatus === 'connected',
        status: errors.length ? 'disabled' : onlineStatus,
        label: errors.length ? '全服榜未配置' : onlineStatus === 'connected' ? '全服巅峰榜' : '全服榜未连接',
        configurationErrors: errors, lastError: clone(onlineError),
        run: clone(state.online.run), pendingCount: state.online.pending.length,
        boards: clone(state.online.boards), snapshotAt: state.online.snapshotAt,
        nextUpdateAt: state.online.nextUpdateAt, serverTime: state.online.serverTime,
      },
    };
  }
  function result(ok, code, extra = {}) { return { ok, code, ...extra }; }

  function startLocalRun() {
    rollover();
    state.run = {
      id: anonymousId('run'), startedAt: new Date(now()).toISOString(), endedAt: null,
      peakActionCount: 0, peakMoney: 0, lastStatus: null,
    };
    save();
    return result(true, 'local_run_started', { run: clone(state.run), player: clone(state.player) });
  }
  function observeState(gameState) {
    if (!gameState || !integer(gameState.actionCount) || !integer(gameState.money)) return result(false, 'invalid_game_state');
    const survivalCount = gameState.survivalActionCount === undefined ? gameState.actionCount : gameState.survivalActionCount;
    if (!integer(survivalCount)) return result(false, 'invalid_game_state');
    rollover();
    if (!state.run) startLocalRun();
    if (state.run.endedAt) return result(false, 'local_run_finished');
    const timestamp = new Date(now()).toISOString();
    state.run.peakActionCount = Math.max(state.run.peakActionCount, survivalCount);
    state.run.peakMoney = Math.max(state.run.peakMoney, gameState.money);
    state.run.lastStatus = ['playing', 'failure', 'chapter_end', 'complete'].includes(gameState.status) ? gameState.status : null;
    const entry = (score) => ({ playerId: state.player.id, nickname: state.player.nickname, runId: state.run.id, score, achievedAt: timestamp });
    const actionCount = state.run.peakActionCount;
    if (!state.allTime.longest || actionCount > state.allTime.longest.score) {
      state.allTime.longest = { ...entry(actionCount), actionCount, survivalDays: Math.floor(actionCount / 5) + 1,
        completedDays: Math.floor(actionCount / 5), actionsIntoDay: actionCount % 5 };
    }
    if (!state.allTime.wealthiest || state.run.peakMoney > state.allTime.wealthiest.score) {
      state.allTime.wealthiest = { ...entry(state.run.peakMoney), peakMoney: state.run.peakMoney };
    }
    save();
    return result(true, 'local_recorded', { run: clone(state.run), currentBest: clone(state.allTime), persisted: !storageError });
  }
  function finishLocalRun() {
    if (!state.run) return result(false, 'no_local_run');
    if (!state.run.endedAt) state.run.endedAt = new Date(now()).toISOString();
    save();
    return result(true, 'local_run_finished', { run: clone(state.run) });
  }

  function serial(work) {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  }
  async function call(payload) {
    const errors = configurationErrors();
    if (errors.length) return result(false, 'online_not_configured', { errors });
    onlineStatus = 'connecting';
    try {
      const response = await transport(clone(payload), { envId: config.envId, functionName: config.functionName });
      const data = response && Object.prototype.hasOwnProperty.call(response, 'result') ? response.result : response;
      if (!data || data.ok !== true) {
        const problem = data && (data.error || data.code) || 'invalid_server_response';
        onlineError = typeof problem === 'string' ? problem : clone(problem);
        onlineStatus = 'error';
        return result(false, typeof problem === 'string' ? problem : 'server_rejected', { server: clone(data) });
      }
      onlineStatus = 'connected'; onlineError = null;
      if (data.boards && validBoards(data.boards)) state.online.boards = clone(data.boards);
      for (const field of ['snapshotAt', 'nextUpdateAt', 'serverTime']) if (data[field] !== undefined) state.online[field] = clone(data[field]);
      return clone(data);
    } catch (error) {
      onlineStatus = 'error'; onlineError = error && error.message || 'network_error';
      return result(false, 'network_error', { message: onlineError });
    }
  }
  function startOnlineRun() {
    return serial(async () => {
      const response = await call({ action: 'startRun' });
      if (!response.ok) return response;
      if (!nonempty(response.runId) || !integer(response.seq) || !integer(response.seed)) {
        onlineStatus = 'error'; onlineError = 'invalid_run_response';
        return result(false, 'invalid_run_response');
      }
      // This is an explicit new run. A discarded local queue is not claimed online.
      state.online.run = { id: response.runId, seed: response.seed, seq: response.seq };
      state.online.pending = [];
      save();
      return response;
    });
  }
  async function flush() {
    if (!state.online.run) return result(false, 'no_online_run');
    let lastResponse = result(true, 'already_synced', { seq: state.online.run.seq });
    while (state.online.pending.length) {
      const batch = state.online.pending[0];
      if (batch.expectedSeq == null) { batch.expectedSeq = state.online.run.seq; save(); }
      const response = await call({ action: 'appendOperations', runId: state.online.run.id,
        expectedSeq: batch.expectedSeq, operations: batch.operations });
      if (!response.ok) return { ...response, queued: true, pendingCount: state.online.pending.length };
      if (!integer(response.seq) || response.seq < batch.expectedSeq + batch.operations.length) {
        onlineStatus = 'error'; onlineError = 'invalid_sequence_response';
        return result(false, 'invalid_sequence_response', { queued: true });
      }
      state.online.run.seq = response.seq;
      state.online.pending.shift(); save(); lastResponse = response;
    }
    return { ...lastResponse, pendingCount: 0 };
  }
  function appendOperations(operations) {
    let batch;
    try { batch = clone(operations); } catch (_) { return Promise.resolve(result(false, 'invalid_operations')); }
    if (!Array.isArray(batch) || !batch.length || batch.length > 100 || batch.some((o) => !validOperation(o))) {
      return Promise.resolve(result(false, 'invalid_operations'));
    }
    return serial(async () => {
      if (configurationErrors().length) return result(false, 'online_not_configured', { errors: configurationErrors() });
      if (!state.online.run) return result(false, 'no_online_run');
      for (let offset = 0; offset < batch.length; offset += MAX_BATCH_OPERATIONS) {
        state.online.pending.push({ id: anonymousId('batch'), expectedSeq: null, operations: batch.slice(offset, offset + MAX_BATCH_OPERATIONS) });
      }
      save();
      return flush();
    });
  }
  function retryPendingOperations() { return serial(flush); }
  function resumeOnlineRun() {
    return serial(async () => {
      if (!state.online.run) return result(false, 'no_online_run');
      const synced = await flush();
      if (!synced.ok) return synced;
      const response = await call({ action: 'getRun', runId: state.online.run.id });
      if (!response.ok) return response;
      if (!integer(response.seq) || response.seq < state.online.run.seq) {
        onlineStatus = 'error'; onlineError = 'invalid_sequence_response';
        return result(false, 'invalid_sequence_response');
      }
      state.online.run.seq = response.seq; save();
      return response;
    });
  }
  function refreshBoards() {
    return serial(async () => {
      const response = await call({ action: 'getBoards' });
      if (response.ok && !validBoards(response.boards)) {
        onlineStatus = 'error'; onlineError = 'invalid_boards_response';
        return result(false, 'invalid_boards_response');
      }
      if (response.ok) save();
      return response;
    });
  }

  return { startLocalRun, observeState, finishLocalRun, getState, getLocalBoards,
    startOnlineRun, appendOperations, retryPendingOperations, resumeOnlineRun, refreshBoards };
}

module.exports = { createLeaderboard, beijingWindow, DEFAULT_CONFIG, STORAGE_KEY };

};
modules["src/medals.js"]=function(require,module,exports){
'use strict';

/** Permanent local cosmetics. No engine, RNG, score, profile or survey access. */
const STORAGE_KEY = 'baiyi.medals.v1';
const MEDAL_CATALOG = Object.freeze([
  Object.freeze({ id: 'first_full_marks', name: '小试牛刀', description: '完成一次月度考核，并答对全部题目。' }),
  Object.freeze({ id: 'wealth_200', name: '财源滚滚', description: '金币余额达到 200。' }),
  Object.freeze({ id: 'zero_coins', name: '沿街乞讨', description: '金币余额为 0 时获得。' }),
  Object.freeze({ id: 'work_streak_4', name: '勤奋过人', description: '连续完成 4 次有效工作。' }),
  Object.freeze({ id: 'research_streak_4', name: '科研达人', description: '连续完成 4 次有效科研。' }),
  Object.freeze({ id: 'no_rest_10', name: '通宵达旦', description: '连续 7 个游戏日未休息或娱乐；首次视频日也计入。' }),
  Object.freeze({ id: 'death_5', name: '死亡牛马', description: '纪念馆累计记录 5 次死亡。' }),
  Object.freeze({ id: 'leadership_bad_5', name: '鼠鼠鼠了', description: '连续 5 次不良事件都来自领导或派系。' }),
  Object.freeze({ id: 'beneficial_5', name: '好运降临', description: '累计经历 5 次良性随机事件。' }),
  Object.freeze({ id: 'balanced_week', name: '劳逸结合', description: '连续 7 个完整游戏日，每天都有临床行动与正式休息。' }),
  Object.freeze({ id: 'knowledge_10', name: '学以致用', description: '正确完成 10 项不同的教学任务。' }),
  Object.freeze({ id: 'puzzles_5', name: '抽丝剥茧', description: '看完 5 个不同章节的剧情视频；旧版推理进度保留。' }),
  Object.freeze({ id: 'npc_all', name: '同舟共济', description: '完成四位同行者各自的支线。' }),
  Object.freeze({ id: 'branch_2', name: '改写命运', description: '在同一章节收集两个不同的分支结局。' }),
]);
const IDS = MEDAL_CATALOG.map((medal) => medal.id);
const NPC_IDS = Object.freeze(['guning', 'huangning', 'limuliang', 'liuchangsheng']);
const ACTIONS = ['work', 'research', 'politics', 'rest', 'entertain', 'inspect', 'travel', 'prepare', 'puzzle', 'npc', 'clinical'];
const NO_REST_UNITS = 35;
const emptyProgress = () => ({ workStreak: 0, researchStreak: 0, noRestCount: 0 });
const emptyBalance = () => ({ consecutiveDays: 0, dayNumber: null, actionsObserved: 0, hasClinical: false, hasRest: false, fullDay: false });
const emptyEvents = () => ({ leadershipAdverseStreak: 0, beneficialCount: 0 });
const emptyCollections = () => ({ knowledgeIds: [], puzzleChapterIds: [], npcIds: [], chapterEndings: [] });
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const identifier = (value) => (typeof value === 'string' && /^[A-Za-z0-9_:.-]{1,100}$/.test(value))
  || (Number.isSafeInteger(value) && value >= 0);
const occurrenceId = (value) => typeof value === 'string' && /^[A-Za-z0-9_:.-]{1,200}$/.test(value);
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value);
const fullMarks = (value) => plain(value) && Number.isSafeInteger(value.score)
  && Number.isSafeInteger(value.total) && value.total > 0 && value.score === value.total;

// Select only evidence relevant to a cosmetic unlock. Never persist game state,
// answers, participant IDs, names, other personal fields or arbitrary metadata.
function evidenceFor(id, source) {
  if (!plain(source)) return null;
  if (id === 'first_full_marks' && fullMarks(source)) {
    const evidence = { score: source.score, total: source.total };
    if (Number.isSafeInteger(source.month) && source.month > 0) evidence.month = source.month;
    return evidence;
  }
  if (id === 'wealth_200' && typeof source.money === 'number' && Number.isFinite(source.money) && source.money >= 200) return { money: source.money };
  if (id === 'zero_coins' && source.money === 0) return { money: 0 };
  if (id === 'work_streak_4' && count(source.consecutiveActions) && source.consecutiveActions >= 4) return { actionType: 'work', consecutiveActions: source.consecutiveActions };
  if (id === 'research_streak_4' && count(source.consecutiveActions) && source.consecutiveActions >= 4) return { actionType: 'research', consecutiveActions: source.consecutiveActions };
  // Keep original ten-unit unlocks readable; new unlocks use NO_REST_UNITS.
  if (id === 'no_rest_10' && count(source.consecutiveActions) && source.consecutiveActions >= 10) return { consecutiveActions: source.consecutiveActions };
  if (id === 'death_5' && count(source.deathCount) && source.deathCount >= 5) return { deathCount: source.deathCount };
  if (id === 'leadership_bad_5' && count(source.consecutiveEvents) && source.consecutiveEvents >= 5) return { consecutiveEvents: source.consecutiveEvents };
  if (id === 'beneficial_5' && count(source.beneficialEvents) && source.beneficialEvents >= 5) return { beneficialEvents: source.beneficialEvents };
  if (id === 'balanced_week' && count(source.consecutiveDays) && source.consecutiveDays >= 7) return { consecutiveDays: source.consecutiveDays };
  if (id === 'knowledge_10' && count(source.questionCount) && source.questionCount >= 10) return { questionCount: source.questionCount };
  if (id === 'puzzles_5' && count(source.chapterCount) && source.chapterCount >= 5) return { chapterCount: source.chapterCount };
  if (id === 'npc_all' && source.npcCount === NPC_IDS.length) return { npcCount: NPC_IDS.length };
  if (id === 'branch_2' && identifier(source.chapterId) && count(source.endingCount) && source.endingCount >= 2) return { chapterId: String(source.chapterId), endingCount: source.endingCount };
  return null;
}

function sanitizeCollections(source) {
  if (!plain(source)) throw new Error('storage_corrupt');
  const result = emptyCollections();
  for (const field of ['knowledgeIds', 'puzzleChapterIds', 'npcIds']) {
    if (!Array.isArray(source[field]) || source[field].some((id) => !identifier(id)
      || (field === 'npcIds' && !NPC_IDS.includes(id)))) throw new Error('storage_corrupt');
    result[field] = [...new Set(source[field].map(String))];
  }
  if (!Array.isArray(source.chapterEndings)) throw new Error('storage_corrupt');
  const chapters = new Map();
  for (const chapter of source.chapterEndings) {
    if (!plain(chapter) || !identifier(chapter.chapterId) || !Array.isArray(chapter.endingIds)
      || chapter.endingIds.some((id) => !identifier(id))) throw new Error('storage_corrupt');
    const key = String(chapter.chapterId);
    chapters.set(key, [...new Set([...(chapters.get(key) || []), ...chapter.endingIds.map(String)])]);
  }
  result.chapterEndings = [...chapters].map(([chapterId, endingIds]) => ({ chapterId, endingIds }));
  return result;
}
function mergeCollections(first, second) {
  return sanitizeCollections({
    knowledgeIds: [...first.knowledgeIds, ...second.knowledgeIds],
    puzzleChapterIds: [...first.puzzleChapterIds, ...second.puzzleChapterIds],
    npcIds: [...first.npcIds, ...second.npcIds],
    chapterEndings: [...first.chapterEndings, ...second.chapterEndings],
  });
}

function createMedals(storage, options = {}) {
  let records = new Map();
  let persistedIds = new Set();
  let activeTitle = null;
  let activeDirty = false;
  let progress = emptyProgress();
  let lastActionCount = null;
  let lastVideoDays = null;
  let progressDirty = false;
  let balanceProgress = emptyBalance();
  let eventProgress = emptyEvents();
  let seenEventIds = new Set();
  let eventsDirty = false;
  let collections = emptyCollections();
  let collectionsDirty = false;
  let storageError = null;
  let clockError = null;

  function readDisk() {
    if (!storage || typeof storage.getItem !== 'function') throw new Error('storage_unavailable');
    const raw = storage.getItem(STORAGE_KEY);
    if (raw == null || raw === '') return { records: [], activeTitle: null, progress: emptyProgress(), lastActionCount: null, lastVideoDays: null,
      balanceProgress: emptyBalance(), eventProgress: emptyEvents(), seenEventIds: [], collections: emptyCollections() };
    let data;
    try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { throw new Error('storage_corrupt'); }
    if (!plain(data) || data.version !== 1 || !Array.isArray(data.records)) throw new Error('storage_corrupt');
    const sanitized = []; const seen = new Set();
    for (const record of data.records) {
      if (!plain(record) || !IDS.includes(record.id) || seen.has(record.id)
        || (record.unlockedAt !== null && (typeof record.unlockedAt !== 'string' || !Number.isFinite(Date.parse(record.unlockedAt))))) throw new Error('storage_corrupt');
      const evidence = evidenceFor(record.id, record.evidence);
      if (!evidence) throw new Error('storage_corrupt');
      seen.add(record.id);
      sanitized.push({ id: record.id, unlockedAt: record.unlockedAt, evidence });
    }
    if (data.activeTitle !== null && !seen.has(data.activeTitle)) throw new Error('storage_corrupt');
    const savedProgress = data.progress === undefined ? emptyProgress() : data.progress;
    const savedActionCount = data.lastActionCount === undefined ? null : data.lastActionCount;
    const savedVideoDays = data.lastVideoDays === undefined ? null : data.lastVideoDays;
    if (!plain(savedProgress) || Object.keys(emptyProgress()).some((key) => !count(savedProgress[key]))
      || (savedActionCount !== null && (!count(savedActionCount) || savedActionCount === 0))
      || (savedVideoDays !== null && (!count(savedVideoDays) || savedVideoDays === 0))) throw new Error('storage_corrupt');
    // Added fields are optional only for migration from the original seven-title
    // version. Existing permanent unlocks and worn title are never reset.
    const savedBalance = data.balanceProgress === undefined ? emptyBalance() : data.balanceProgress;
    if (!plain(savedBalance) || !count(savedBalance.consecutiveDays) || !count(savedBalance.actionsObserved)
      || savedBalance.actionsObserved > 5 || (savedBalance.dayNumber !== null && (!count(savedBalance.dayNumber) || savedBalance.dayNumber === 0))
      || ['hasClinical', 'hasRest', 'fullDay'].some((key) => typeof savedBalance[key] !== 'boolean')) throw new Error('storage_corrupt');
    const savedEvents = data.eventProgress === undefined ? emptyEvents() : data.eventProgress;
    const savedEventIds = data.seenEventIds === undefined ? [] : data.seenEventIds;
    if (!plain(savedEvents) || !count(savedEvents.leadershipAdverseStreak) || !count(savedEvents.beneficialCount)
      || !Array.isArray(savedEventIds) || savedEventIds.some((id) => !occurrenceId(id))) throw new Error('storage_corrupt');
    const savedCollections = data.collections === undefined ? emptyCollections() : sanitizeCollections(data.collections);
    return { records: sanitized, activeTitle: data.activeTitle,
      progress: { workStreak: savedProgress.workStreak, researchStreak: savedProgress.researchStreak, noRestCount: savedProgress.noRestCount },
      lastActionCount: savedActionCount, lastVideoDays: savedVideoDays,
      balanceProgress: Object.fromEntries(Object.keys(emptyBalance()).map((key) => [key, savedBalance[key]])),
      eventProgress: { leadershipAdverseStreak: savedEvents.leadershipAdverseStreak, beneficialCount: savedEvents.beneficialCount },
      seenEventIds: [...new Set(savedEventIds)], collections: savedCollections };
  }
  function mergeFromDisk() {
    const disk = readDisk();
    const merged = new Map(disk.records.map((record) => [record.id, record]));
    // A stored first unlock wins if two active views earned the same title.
    for (const [id, record] of records) if (!merged.has(id)) merged.set(id, record);
    records = merged;
    persistedIds = new Set(disk.records.map((record) => record.id));
    if (!activeDirty) activeTitle = disk.activeTitle;
    if (!progressDirty) { progress = disk.progress; lastActionCount = disk.lastActionCount; lastVideoDays = disk.lastVideoDays; balanceProgress = disk.balanceProgress; }
    if (!eventsDirty) eventProgress = disk.eventProgress;
    seenEventIds = new Set([...disk.seenEventIds, ...seenEventIds]);
    collections = mergeCollections(disk.collections, collections);
    return disk;
  }
  function unsavedCount() {
    return [...records.keys()].filter((id) => !persistedIds.has(id)).length + (activeDirty ? 1 : 0)
      + (progressDirty ? 1 : 0) + (eventsDirty ? 1 : 0) + (collectionsDirty ? 1 : 0);
  }
  function retry() {
    try {
      mergeFromDisk();
      if (unsavedCount()) {
        if (!storage || typeof storage.setItem !== 'function') throw new Error('storage_unavailable');
        const accepted = storage.setItem(STORAGE_KEY, JSON.stringify({
          version: 1, records: [...records.values()], activeTitle, progress, lastActionCount, lastVideoDays,
          balanceProgress, eventProgress, seenEventIds: [...seenEventIds], collections,
        }));
        if (accepted === false || (accepted && typeof accepted.then === 'function')) throw new Error('storage_write_failed');
        persistedIds = new Set(records.keys()); activeDirty = false; progressDirty = false; eventsDirty = false; collectionsDirty = false;
      }
      storageError = null;
      return { ok: true, persisted: true, storageError: null, unsavedCount: 0 };
    } catch (error) {
      storageError = error && error.message || 'storage_write_failed';
      return { ok: false, persisted: false, storageError, unsavedCount: unsavedCount() };
    }
  }
  try { mergeFromDisk(); } catch (error) { storageError = error && error.message || 'storage_read_failed'; }

  function getState() {
    return {
      medals: MEDAL_CATALOG.map((medal) => {
        const record = records.get(medal.id);
        return { ...medal, unlocked: !!record, unlockedAt: record ? record.unlockedAt : null,
          evidence: record ? clone(record.evidence) : null };
      }),
      activeTitle, progress: clone(progress), balanceProgress: clone(balanceProgress),
      eventProgress: clone(eventProgress), collections: clone(collections),
      storageKey: STORAGE_KEY, storageError, clockError, unsavedCount: unsavedCount(),
    };
  }
  function now() {
    try {
      const clock = options && options.clock;
      const value = typeof clock === 'function' ? clock() : clock && typeof clock.now === 'function' ? clock.now() : Date.now();
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) throw new Error('invalid_clock');
      clockError = null; return date.toISOString();
    } catch (_) {
      // An unavailable clock must not lose a one-time achievement. Null means
      // the timestamp is unknown; the title and its game evidence remain valid.
      clockError = 'invalid_clock'; return null;
    }
  }
  function observeState(gameState) {
    if (!plain(gameState)) return { ok: false, code: 'invalid_game_state', newlyUnlocked: [], storageError };
    try { mergeFromDisk(); } catch (error) { storageError = error && error.message || 'storage_read_failed'; }
    const candidates = [];
    const assessment = Array.isArray(gameState.completedAssessments) && gameState.completedAssessments.find(fullMarks);
    if (assessment) candidates.push(['first_full_marks', evidenceFor('first_full_marks', assessment)]);
    for (const id of ['wealth_200', 'zero_coins']) {
      const evidence = evidenceFor(id, { money: gameState.money });
      if (evidence) candidates.push([id, evidence]);
    }
    if (Array.isArray(gameState.endings)) {
      for (const ending of gameState.endings) {
        if (plain(ending) && identifier(ending.chapterId) && identifier(ending.choiceId)) rememberEnding(ending.chapterId, ending.choiceId);
      }
    }
    if (Array.isArray(gameState.completedVideos)) {
      for (const id of gameState.completedVideos) {
        if (Number.isInteger(Number(id)) && Number(id) >= 1 && Number(id) <= 29) rememberId('puzzleChapterIds', Number(id));
      }
    }
    candidates.push(...collectionCandidates());
    return applyCandidates(candidates, 'observed');
  }
  function applyCandidates(candidates, code) {
    const newlyUnlockedIds = [];
    for (const [id, evidence] of candidates) {
      if (records.has(id)) continue;
      records.set(id, { id, unlockedAt: now(), evidence });
      newlyUnlockedIds.push(id);
    }
    // Retry an earlier refused write even when this observation unlocks nothing.
    if (newlyUnlockedIds.length || unsavedCount() || storageError) retry();
    const snapshot = getState();
    return { ok: true, code, newlyUnlocked: snapshot.medals.filter((medal) => newlyUnlockedIds.includes(medal.id)),
      persisted: !storageError && !unsavedCount(), storageError, clockError, unsavedCount: unsavedCount() };
  }
  function observeAction(type, gameState, context = {}) {
    // The game adapter calls this ONLY after act returned ok and advanced its
    // calendar actionCount, even if that action immediately entered failure.
    if (!ACTIONS.includes(type) || !plain(gameState) || !count(gameState.actionCount) || gameState.actionCount === 0) {
      return { ok: false, code: 'invalid_action', newlyUnlocked: [], storageError };
    }
    try { mergeFromDisk(); } catch (error) { storageError = error && error.message || 'storage_read_failed'; }
    if (lastActionCount === gameState.actionCount) return applyCandidates([], 'duplicate_action');
    progress.workStreak = type === 'work' ? progress.workStreak + 1 : 0;
    progress.researchStreak = type === 'research' ? progress.researchStreak + 1 : 0;
    progress.noRestCount = ['rest', 'entertain'].includes(type) ? 0 : progress.noRestCount + 1;
    updateBalance(type, gameState);
    lastActionCount = gameState.actionCount; progressDirty = true;
    const candidates = [];
    for (const [id, consecutiveActions] of [
      ['work_streak_4', progress.workStreak], ['research_streak_4', progress.researchStreak], ['no_rest_10', progress.noRestCount],
    ]) {
      if (id === 'no_rest_10' && consecutiveActions < NO_REST_UNITS) continue;
      const evidence = evidenceFor(id, { consecutiveActions });
      if (evidence) candidates.push([id, evidence]);
    }
    if (plain(context)) {
      if (type === 'clinical' && context.correct === true && identifier(context.questionId)) rememberId('knowledgeIds', context.questionId);
      if (type === 'puzzle' && context.puzzleSolved === true && identifier(context.chapterId)) rememberId('puzzleChapterIds', context.chapterId);
      if (type === 'npc' && context.questCompleted === true && NPC_IDS.includes(context.npcId)) rememberId('npcIds', context.npcId);
    }
    const balancedEvidence = evidenceFor('balanced_week', { consecutiveDays: balanceProgress.consecutiveDays });
    if (balancedEvidence) candidates.push(['balanced_week', balancedEvidence]);
    candidates.push(...collectionCandidates());
    return applyCandidates(candidates, 'action_observed');
  }
  function observeVideoDay(gameState, elapsedUnits) {
    if (!plain(gameState) || !count(gameState.videoDays) || gameState.videoDays === 0 || elapsedUnits !== 5) {
      return { ok: false, code: 'invalid_video_day', newlyUnlocked: [], storageError };
    }
    try { mergeFromDisk(); } catch (error) { storageError = error && error.message || 'storage_read_failed'; }
    if (lastVideoDays !== null && gameState.videoDays <= lastVideoDays) return applyCandidates([], 'duplicate_video_day');
    // A full day of story time is not five completed work/research actions.
    // It does count as time without a formal rest and interrupts balanced days.
    progress.workStreak = 0; progress.researchStreak = 0;
    progress.noRestCount += elapsedUnits;
    balanceProgress = emptyBalance();
    lastVideoDays = gameState.videoDays; progressDirty = true;
    const evidence = progress.noRestCount >= NO_REST_UNITS ? evidenceFor('no_rest_10', { consecutiveActions: progress.noRestCount }) : null;
    return applyCandidates(evidence ? [['no_rest_10', evidence]] : [], 'video_day_observed');
  }
  function updateBalance(type, gameState) {
    const actionCount = gameState.actionCount;
    const dayNumber = Math.floor((actionCount - 1) / 5) + 1 + (count(gameState.videoDays) ? gameState.videoDays : 0);
    const position = ((actionCount - 1) % 5) + 1;
    if (lastActionCount !== null && actionCount !== lastActionCount + 1) balanceProgress.consecutiveDays = 0;
    if (balanceProgress.dayNumber !== dayNumber) {
      balanceProgress.dayNumber = dayNumber; balanceProgress.actionsObserved = 0;
      balanceProgress.hasClinical = false; balanceProgress.hasRest = false;
      balanceProgress.fullDay = position === 1;
    } else if (lastActionCount === null || actionCount !== lastActionCount + 1) balanceProgress.fullDay = false;
    balanceProgress.actionsObserved += 1;
    if (['work', 'clinical'].includes(type)) balanceProgress.hasClinical = true;
    if (['rest', 'entertain'].includes(type)) balanceProgress.hasRest = true;
    if (position === 5) {
      const complete = balanceProgress.fullDay && balanceProgress.actionsObserved === 5
        && balanceProgress.hasClinical && balanceProgress.hasRest;
      balanceProgress.consecutiveDays = complete ? balanceProgress.consecutiveDays + 1 : 0;
    }
  }
  function rememberId(field, id) {
    const key = String(id);
    if (!collections[field].includes(key)) { collections[field].push(key); collectionsDirty = true; }
  }
  function rememberEnding(chapterId, endingId) {
    const key = String(chapterId); const choiceId = String(endingId);
    let entry = collections.chapterEndings.find((chapter) => chapter.chapterId === key);
    if (!entry) { entry = { chapterId: key, endingIds: [] }; collections.chapterEndings.push(entry); }
    if (!entry.endingIds.includes(choiceId)) { entry.endingIds.push(choiceId); collectionsDirty = true; }
  }
  function collectionCandidates() {
    const candidates = [];
    for (const [id, source] of [
      ['knowledge_10', { questionCount: collections.knowledgeIds.length }],
      ['puzzles_5', { chapterCount: collections.puzzleChapterIds.length }],
      ['npc_all', { npcCount: collections.npcIds.length }],
    ]) {
      const evidence = evidenceFor(id, source);
      if (evidence) candidates.push([id, evidence]);
    }
    const branch = collections.chapterEndings.find((chapter) => chapter.endingIds.length >= 2);
    if (branch) candidates.push(['branch_2', evidenceFor('branch_2', { chapterId: branch.chapterId, endingCount: branch.endingIds.length })]);
    return candidates;
  }
  function observeEvent(event) {
    const categories = { adverse: 'adverse', misfortune: 'adverse', fatal: 'adverse', beneficial: 'beneficial', beneficial_over_time: 'beneficial' };
    if (!plain(event) || !occurrenceId(event.occurrenceId) || !Object.prototype.hasOwnProperty.call(categories, event.category)) {
      return { ok: false, code: 'invalid_event', newlyUnlocked: [], storageError };
    }
    const family = event.family === undefined ? event.medalFamily : event.family;
    if (family != null && (typeof family !== 'string' || !/^[a-z_]{1,60}$/.test(family))) return { ok: false, code: 'invalid_event', newlyUnlocked: [], storageError };
    try { mergeFromDisk(); } catch (error) { storageError = error && error.message || 'storage_read_failed'; }
    if (seenEventIds.has(event.occurrenceId)) return applyCandidates([], 'duplicate_event');
    seenEventIds.add(event.occurrenceId); eventsDirty = true;
    if (categories[event.category] === 'beneficial') eventProgress.beneficialCount += 1;
    else eventProgress.leadershipAdverseStreak = ['leadership', 'faction'].includes(family) ? eventProgress.leadershipAdverseStreak + 1 : 0;
    const candidates = [];
    for (const [id, source] of [
      ['leadership_bad_5', { consecutiveEvents: eventProgress.leadershipAdverseStreak }],
      ['beneficial_5', { beneficialEvents: eventProgress.beneficialCount }],
    ]) {
      const evidence = evidenceFor(id, source);
      if (evidence) candidates.push([id, evidence]);
    }
    return applyCandidates(candidates, 'event_observed');
  }
  function observeMemorial(snapshot) {
    if (!plain(snapshot) || !count(snapshot.total)) return { ok: false, code: 'invalid_memorial', newlyUnlocked: [], storageError };
    try { mergeFromDisk(); } catch (error) { storageError = error && error.message || 'storage_read_failed'; }
    // The memorial owns death deduplication; reopening its screen is not a death.
    // Read its total only, never its potentially detailed records.
    const evidence = evidenceFor('death_5', { deathCount: snapshot.total });
    return applyCandidates(evidence ? [['death_5', evidence]] : [], 'memorial_observed');
  }
  function resetProgress() {
    try { mergeFromDisk(); } catch (error) { storageError = error && error.message || 'storage_read_failed'; }
    if (lastActionCount !== null || lastVideoDays !== null || Object.values(progress).some((value) => value !== 0)
      || balanceProgress.consecutiveDays !== 0 || balanceProgress.dayNumber !== null) {
      progress = emptyProgress(); balanceProgress = emptyBalance(); lastActionCount = null; lastVideoDays = null; progressDirty = true;
    }
    return applyCandidates([], 'progress_reset');
  }
  function restBreak() {
    try { mergeFromDisk(); } catch (error) { storageError = error && error.message || 'storage_read_failed'; }
    if (progress.noRestCount !== 0) { progress.noRestCount = 0; progressDirty = true; }
    return applyCandidates([], 'rest_break');
  }
  function equip(id) {
    if (id !== null && (typeof id !== 'string' || !IDS.includes(id))) return { ok: false, code: 'invalid_title', activeTitle, storageError };
    try { mergeFromDisk(); } catch (error) { storageError = error && error.message || 'storage_read_failed'; }
    if (id !== null && !records.has(id)) return { ok: false, code: 'title_locked', activeTitle, storageError };
    if (activeTitle !== id) { activeTitle = id; activeDirty = true; }
    const saved = retry();
    return { ok: true, code: 'equipped', activeTitle, persisted: saved.persisted, storageError, unsavedCount: unsavedCount() };
  }

  return { observeState, observeAction, observeVideoDay, observeEvent, observeMemorial, resetProgress, restBreak, getState, equip, retry };
}

module.exports = { createMedals, MEDAL_CATALOG, NPC_IDS, STORAGE_KEY };

};
modules["src/survey.js"]=function(require,module,exports){
'use strict';

/**
 * Local, optional research questionnaire. No game imports, game RNG, scoring,
 * network transmission or identifying profile fields. All item text must come
 * from a separately authorised questionnaire; this module supplies no items.
 *
 * Item shape: {id, text, originalOrder}; array position is the original order
 * when originalOrder is omitted. Options: [{value: number|string, label}].
 * Storage: synchronous getItem/setItem/removeItem (same interface as Storage).
 * getNextBatch returns an array; other mutations return {ok, code, state}.
 * Unfinished batches may resume in a later chapter, but each chapter is linked
 * to at most one batch and each item is assigned only once per assessment.
 * chapterId/sourceId is the source-film identifier, not its current gameOrder.
 * Occupation selected before consent remains private in memory until consent.
 */
const STORAGE_PREFIX = 'baiyi.research.survey.v1:';
const DEFAULT_CONFIG = Object.freeze({
  enabled: false, scaleId: null, scaleVersion: null, instructions: '',
  responseOptions: [], items: [], itemsPerBreak: 2, consentText: '',
  recallWindow: null, studyId: 'baiyi-burnout-pilot', assessmentWindowHours: 24,
});
const copy = (value) => JSON.parse(JSON.stringify(value));
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const validValue = (value) => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
const valueKey = (value) => `${typeof value}:${String(value)}`;
const isoNow = () => new Date(Date.now()).toISOString();
const OCCUPATIONS = Object.freeze(['doctor', 'medical_student', 'other']);
const validGameOrder = (value) => value === undefined || value === null || (Number.isInteger(value) && value > 0);

function prepareConfig(input) {
  const c = { ...DEFAULT_CONFIG, ...(input || {}) };
  const errors = [];
  if (c.enabled !== true) errors.push('disabled');
  for (const field of ['studyId', 'scaleId', 'scaleVersion', 'instructions', 'consentText', 'recallWindow']) {
    if (!text(c[field])) errors.push(`missing_${field}`);
  }
  if (![1, 2].includes(c.itemsPerBreak)) errors.push('invalid_itemsPerBreak');
  if (!Number.isFinite(c.assessmentWindowHours) || c.assessmentWindowHours <= 0) errors.push('invalid_assessmentWindowHours');
  const options = Array.isArray(c.responseOptions) ? c.responseOptions : [];
  if (options.length < 2 || options.some((o) => !o || !validValue(o.value) || !text(o.label))
      || new Set(options.map((o) => o && valueKey(o.value))).size !== options.length) errors.push('invalid_responseOptions');
  const items = (Array.isArray(c.items) ? c.items : []).map((item, i) => ({
    id: item && item.id, text: item && item.text,
    originalOrder: item && item.originalOrder !== undefined ? item.originalOrder : i + 1,
  }));
  if (!items.length || items.some((i) => !text(i.id) || !text(i.text) || !Number.isInteger(i.originalOrder) || i.originalOrder < 1)
      || new Set(items.map((i) => i.id)).size !== items.length
      || new Set(items.map((i) => i.originalOrder)).size !== items.length) errors.push('invalid_items');
  items.sort((a, b) => a.originalOrder - b.originalOrder);
  c.items = items;
  c.responseOptions = options.map((o) => ({ value: o && o.value, label: o && o.label }));
  return { config: c, errors };
}

// Consistency marker only, not a signature or a security primitive.
function fingerprint(c) {
  const source = JSON.stringify([c.studyId, c.scaleId, c.scaleVersion, c.instructions,
    c.responseOptions, c.items, c.itemsPerBreak, c.consentText, c.recallWindow, c.assessmentWindowHours]);
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) { hash ^= source.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function randomId(prefix) {
  const cryptoObject = typeof globalThis !== 'undefined' && globalThis.crypto;
  if (cryptoObject && typeof cryptoObject.randomUUID === 'function') return `${prefix}_${cryptoObject.randomUUID()}`;
  if (cryptoObject && typeof cryptoObject.getRandomValues === 'function') {
    const bytes = new Uint8Array(16); cryptoObject.getRandomValues(bytes);
    return `${prefix}_${Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('')}`;
  }
  // Compatibility fallback for hosts without Web Crypto. No game RNG is read.
  const parts = Array.from({ length: 4 }, () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0'));
  return `${prefix}_${parts.join('')}`;
}

function createSurvey(input, storage) {
  const prepared = prepareConfig(input);
  const config = prepared.config;
  const configFingerprint = fingerprint(config);
  const studyId = text(config.studyId) ? config.studyId : DEFAULT_CONFIG.studyId;
  const storageKey = `${STORAGE_PREFIX}${encodeURIComponent(studyId)}`;
  let lastError = null;
  let loadError = null;
  let pendingParticipantContext = null;
  const empty = () => ({
    schemaVersion: 1, studyId, participantId: null, consentStatus: 'not_asked',
    consentAt: null, declinedAt: null, withdrawnAt: null, consentFingerprint: null,
    participantContext: null, assessment: null, withdrawalRecords: [],
  });
  let state = empty();

  if (storage && typeof storage.getItem === 'function') {
    try {
      const raw = storage.getItem(storageKey);
      if (raw !== null && raw !== undefined && raw !== '') {
        const saved = typeof raw === 'string' ? JSON.parse(raw) : copy(raw);
        if (!validSavedState(saved, studyId)) throw new Error('invalid_state');
        // Select only fields owned by this module; never import a user profile.
        for (const key of Object.keys(state)) {
          if (saved[key] !== undefined) state[key] = copy(saved[key]);
        }
      }
    } catch (_) { loadError = 'storage_corrupt'; }
  }

  function isConfigured() { return prepared.errors.length === 0; }
  function mismatch() { return Boolean(state.consentFingerprint && state.consentFingerprint !== configFingerprint); }
  function nowOverdue(assessment) {
    if (!assessment) return false;
    const lastTime = assessment.completedAt || state.withdrawnAt || isoNow();
    return assessment.overdue || Date.parse(lastTime) > Date.parse(assessment.deadlineAt);
  }
  function getState() {
    const snapshot = copy(state);
    if (snapshot.assessment) snapshot.assessment.overdue = nowOverdue(snapshot.assessment);
    snapshot.configured = isConfigured();
    snapshot.configurationErrors = prepared.errors.slice();
    snapshot.configMismatch = mismatch();
    snapshot.storageKey = storageKey;
    snapshot.overdue = Boolean(snapshot.assessment && snapshot.assessment.overdue);
    snapshot.lastError = lastError || loadError;
    return snapshot;
  }
  function result(ok, code) { return { ok, code, state: getState() }; }
  function commit(next) {
    try {
      if (storage) {
        if (typeof storage.setItem !== 'function' || storage.setItem(storageKey, JSON.stringify(next)) === false) throw new Error('write_failed');
      }
      state = next; lastError = null; return true;
    } catch (_) { lastError = 'storage_error'; return false; }
  }
  function gate(requireConsent) {
    if (loadError) return loadError;
    if (!isConfigured()) return 'not_configured';
    if (mismatch()) return 'configuration_changed';
    if (state.consentStatus === 'withdrawn') return 'withdrawn';
    if (state.consentStatus === 'declined') return 'declined';
    if (requireConsent && state.consentStatus !== 'accepted') return 'consent_required';
    return null;
  }
  function setParticipantContext(context) {
    if (!context || typeof context !== 'object' || Array.isArray(context)
        || !OCCUPATIONS.includes(context.occupation)
        || Object.keys(context).some((key) => key !== 'occupation')) return result(false, 'invalid_participant_context');
    if (loadError) return result(false, loadError);
    if (state.consentStatus === 'withdrawn' || state.consentStatus === 'declined') return result(false, state.consentStatus);
    const selected = { occupation: context.occupation };
    if (state.consentStatus !== 'accepted') {
      pendingParticipantContext = selected;
      return result(true, 'participant_context_pending');
    }
    const reason = gate(true);
    if (reason) return result(false, reason);
    const next = copy(state); next.participantContext = selected;
    return result(commit(next), lastError || 'participant_context_saved');
  }
  function consent(accepted) {
    const reason = gate(false);
    if (reason) return result(false, reason);
    if (typeof accepted !== 'boolean') return result(false, 'invalid_consent');
    if (!accepted) return decline();
    if (state.consentStatus === 'accepted') return result(true, 'already_consented');
    const next = copy(state);
    next.consentStatus = 'accepted'; next.consentAt = isoNow();
    next.consentFingerprint = configFingerprint; next.participantId = randomId('participant');
    next.participantContext = pendingParticipantContext ? copy(pendingParticipantContext) : null;
    const saved = commit(next);
    if (saved) pendingParticipantContext = null;
    return result(saved, lastError || 'consented');
  }
  function beginAssessment() {
    const reason = gate(true);
    if (reason) return result(false, reason);
    if (state.assessment) return result(true, 'assessment_exists');
    const next = copy(state); const startedAt = isoNow();
    next.assessment = {
      assessmentId: randomId('assessment'), startedAt,
      deadlineAt: new Date(Date.parse(startedAt) + config.assessmentWindowHours * 3600000).toISOString(),
      assessmentWindowHours: config.assessmentWindowHours,
      status: 'in_progress', completedAt: null, overdue: false,
      scaleId: config.scaleId, scaleVersion: config.scaleVersion,
      recallWindow: config.recallWindow, configFingerprint,
      responseOptions: copy(config.responseOptions), itemsPerBreak: config.itemsPerBreak,
      batches: [], chapterBatches: {},
      records: config.items.map((item) => ({
        itemId: item.id, originalOrder: item.originalOrder, status: 'not_presented',
        value: null, presentedAt: null, answeredAt: null, skippedAt: null,
        answeredChapterId: null, sourceId: null, gameOrder: null,
        missingReason: 'not_presented', presentations: [],
      })),
    };
    return result(commit(next), lastError || 'assessment_started');
  }
  function chapterKey(chapterId) {
    if ((typeof chapterId === 'number' && Number.isFinite(chapterId)) || text(chapterId)) return `chapter:${String(chapterId)}`;
    return null;
  }
  function getNextBatch(chapterId, context = {}) {
    const reason = gate(true); const key = chapterKey(chapterId);
    const suppliedOrder = context && context.gameOrder;
    if (!validGameOrder(suppliedOrder)) { lastError = 'invalid_game_order'; return []; }
    const gameOrder = suppliedOrder === undefined || suppliedOrder === null ? null : suppliedOrder;
    if (reason || !key || !state.assessment || state.assessment.status !== 'in_progress') {
      lastError = reason || (!key ? 'invalid_chapter' : null); return [];
    }
    const next = copy(state); const a = next.assessment; const at = isoNow();
    a.overdue = nowOverdue(a);
    let batch = a.batches.find((b) => b.id === a.chapterBatches[key]);
    if (batch && batch.completedAt) return [];
    if (!batch) {
      batch = a.batches.find((b) => !b.completedAt);
      if (!batch) {
        const items = a.records.filter((r) => r.status === 'not_presented').slice(0, config.itemsPerBreak);
        if (!items.length) return [];
        batch = { id: `batch_${a.batches.length + 1}`, itemIds: items.map((r) => r.itemId), createdAt: at, completedAt: null, chapterIds: [], contexts: [] };
        a.batches.push(batch);
      }
      a.chapterBatches[key] = batch.id;
      batch.chapterIds.push(chapterId);
    }
    if (!batch.contexts) batch.contexts = [];
    if (!batch.contexts.some((c) => chapterKey(c.sourceId) === key && c.gameOrder === gameOrder)) {
      batch.contexts.push({ sourceId: chapterId, gameOrder });
    }
    const pending = a.records.filter((r) => batch.itemIds.includes(r.itemId) && !['answered', 'skipped'].includes(r.status));
    for (const record of pending) {
      record.status = 'presented'; record.missingReason = 'unanswered';
      if (!record.presentedAt) {
        record.presentedAt = at; record.sourceId = chapterId; record.gameOrder = gameOrder;
      }
      if (!record.presentations.some((p) => chapterKey(p.chapterId) === key && (p.gameOrder ?? null) === gameOrder)) {
        record.presentations.push({ chapterId, sourceId: chapterId, gameOrder, presentedAt: at });
      }
    }
    if (!commit(next)) return [];
    return pending.map((record) => ({
      id: record.itemId, itemId: record.itemId, originalOrder: record.originalOrder,
      text: config.items.find((i) => i.id === record.itemId).text,
      responseOptions: copy(config.responseOptions), presentedAt: record.presentedAt,
      batchId: batch.id, chapterId, sourceId: chapterId, gameOrder,
    }));
  }
  function respond(itemId, value, context, skipping) {
    const reason = gate(true);
    if (reason) return result(false, reason);
    if (!state.assessment) return result(false, 'assessment_required');
    if (state.assessment.status !== 'in_progress') return result(false, 'assessment_closed');
    const key = chapterKey(context && context.chapterId);
    const suppliedOrder = context && context.gameOrder;
    if (!validGameOrder(suppliedOrder)) return result(false, 'invalid_game_order');
    const existing = state.assessment.records.find((r) => r.itemId === itemId);
    if (!existing) return result(false, 'unknown_item');
    if (['answered', 'skipped'].includes(existing.status)) return result(false, 'already_resolved');
    if (!key || !existing.presentations.some((p) => chapterKey(p.chapterId) === key)) return result(false, 'not_presented_in_chapter');
    const matchingPresentations = existing.presentations.filter((p) => chapterKey(p.chapterId) === key
      && (suppliedOrder === undefined || suppliedOrder === null || p.gameOrder === suppliedOrder));
    if (!matchingPresentations.length) return result(false, 'not_presented_in_context');
    const presentation = matchingPresentations[matchingPresentations.length - 1];
    const gameOrder = suppliedOrder === undefined || suppliedOrder === null ? (presentation.gameOrder ?? null) : suppliedOrder;
    if (!skipping && !config.responseOptions.some((o) => Object.is(o.value, value))) return result(false, 'invalid_value');
    const next = copy(state); const a = next.assessment; const at = isoNow();
    const record = a.records.find((r) => r.itemId === itemId);
    record.status = skipping ? 'skipped' : 'answered'; record.value = skipping ? null : value;
    record.answeredAt = skipping ? null : at; record.skippedAt = skipping ? at : null;
    record.answeredChapterId = context.chapterId; record.missingReason = skipping ? 'participant_skip' : null;
    record.sourceId = context.chapterId; record.gameOrder = gameOrder;
    a.overdue = nowOverdue(a);
    for (const batch of a.batches) {
      if (!batch.completedAt && batch.itemIds.every((id) => a.records.some((r) => r.itemId === id && ['answered', 'skipped'].includes(r.status)))) batch.completedAt = at;
    }
    if (a.records.every((r) => ['answered', 'skipped'].includes(r.status))) { a.status = 'complete'; a.completedAt = at; }
    return result(commit(next), lastError || (skipping ? 'skipped' : 'answered'));
  }
  function answer(itemId, value, context = {}) { return respond(itemId, value, context, false); }
  function skip(itemId, context = {}) { return respond(itemId, null, context, true); }
  function decline() {
    if (loadError) return result(false, loadError);
    if (!isConfigured()) return result(false, 'not_configured');
    if (state.consentStatus === 'withdrawn') return result(false, 'withdrawn');
    if (state.consentStatus === 'accepted') return withdraw();
    if (state.consentStatus === 'declined') return result(true, 'already_declined');
    const next = copy(state); next.consentStatus = 'declined'; next.declinedAt = isoNow();
    pendingParticipantContext = null;
    return result(commit(next), lastError || 'declined');
  }
  function withdraw() {
    if (loadError) return result(false, loadError);
    if (state.consentStatus === 'withdrawn') return result(true, 'already_withdrawn');
    if (state.consentStatus !== 'accepted') return result(false, 'consent_required');
    const next = copy(state); const at = isoNow();
    next.consentStatus = 'withdrawn'; next.withdrawnAt = at;
    next.withdrawalRecords.push({ withdrawnAt: at, assessmentId: next.assessment ? next.assessment.assessmentId : null });
    if (next.assessment) { next.assessment.overdue = nowOverdue(next.assessment); next.assessment.status = 'withdrawn'; }
    return result(commit(next), lastError || 'withdrawn');
  }
  function exportData() {
    const s = getState(); const a = s.assessment;
    return JSON.stringify({
      schemaVersion: 1, studyId, participantId: s.participantId,
      participantContext: s.participantContext,
      consentStatus: s.consentStatus, consentAt: s.consentAt, declinedAt: s.declinedAt,
      withdrawnAt: s.withdrawnAt, withdrawalRecords: s.withdrawalRecords,
      assessment: a ? {
        assessmentId: a.assessmentId, scaleId: a.scaleId, scaleVersion: a.scaleVersion,
        configFingerprint: a.configFingerprint, recallWindow: a.recallWindow,
        startedAt: a.startedAt, completedAt: a.completedAt, deadlineAt: a.deadlineAt,
        assessmentWindowHours: a.assessmentWindowHours, overdue: a.overdue,
        status: a.status, itemsPerBreak: a.itemsPerBreak,
        responseOptions: a.responseOptions, records: a.records, batches: a.batches,
        counts: { total: a.records.length, answered: a.records.filter((r) => r.status === 'answered').length,
          skipped: a.records.filter((r) => r.status === 'skipped').length,
          missing: a.records.filter((r) => r.status !== 'answered').length },
      } : null,
      scoring: { computed: false, reason: 'Scoring is not implemented; use the authorised manual and its missing-data rules separately.' },
    }, null, 2);
  }
  function clearData() {
    try {
      if (storage && (typeof storage.removeItem !== 'function' || storage.removeItem(storageKey) === false)) throw new Error('delete_failed');
      state = empty(); pendingParticipantContext = null; lastError = null; loadError = null;
      return result(true, 'cleared');
    } catch (_) { lastError = 'storage_error'; return result(false, 'storage_error'); }
  }
  return { getState, isConfigured, setParticipantContext, consent, beginAssessment, getNextBatch, answer, skip, decline, withdraw, exportData, clearData };
}

function validSavedState(s, studyId) {
  if (!s || s.schemaVersion !== 1 || s.studyId !== studyId
      || !['not_asked', 'accepted', 'declined', 'withdrawn'].includes(s.consentStatus)
      || !Array.isArray(s.withdrawalRecords)) return false;
  for (const key of ['participantId', 'consentAt', 'declinedAt', 'withdrawnAt', 'consentFingerprint']) {
    if (s[key] !== null && typeof s[key] !== 'string') return false;
  }
  if (['accepted', 'withdrawn'].includes(s.consentStatus) && (!s.participantId || !s.consentAt || !s.consentFingerprint)) return false;
  if (s.participantContext !== undefined && s.participantContext !== null
      && (!OCCUPATIONS.includes(s.participantContext.occupation)
        || Object.keys(s.participantContext).some((key) => key !== 'occupation'))) return false;
  if (s.assessment === null) return true;
  const a = s.assessment;
  if (!a || !text(a.assessmentId) || !text(a.scaleId) || !text(a.scaleVersion)
      || !Number.isFinite(Date.parse(a.startedAt)) || !Number.isFinite(Date.parse(a.deadlineAt))
      || !['in_progress', 'complete', 'withdrawn'].includes(a.status)
      || !Array.isArray(a.records) || !a.records.length || !Array.isArray(a.batches)
      || !a.chapterBatches || typeof a.chapterBatches !== 'object' || !Array.isArray(a.responseOptions)) return false;
  return a.records.every((r) => r && text(r.itemId) && Number.isInteger(r.originalOrder)
    && ['not_presented', 'presented', 'answered', 'skipped'].includes(r.status) && Array.isArray(r.presentations))
    && a.batches.every((b) => b && text(b.id) && Array.isArray(b.itemIds) && Array.isArray(b.chapterIds));
}

module.exports = { createSurvey, DEFAULT_CONFIG, STORAGE_PREFIX };

};
modules["src/wardrobe.js"]=function(require,module,exports){
'use strict';

// Local display preference only: no game state, resource, RNG or research access.
const STORAGE_KEY = 'baiyi.wardrobe.v1';
const GENDERS = Object.freeze(['male', 'female']);
// New unlocks follow the current main-story catalogue. Previously earned
// eligibility remains permanent in the independent wardrobe save.
const CHAPTER_IDS = Object.freeze(require('../data/chapters.json').map((chapter) => chapter.id));
const OUTFITS = Object.freeze([
  ['white_coat', '经典白大衣'],
  ['coat_scrubs', '白大衣配刷手服'],
  ['sky_blue', '天蓝刷手服'],
  ['forest_green', '墨绿刷手服'],
  ['navy', '藏蓝刷手服'],
  ['purple', '紫色刷手服'],
].map(([id, name]) => Object.freeze({ id, name, image: `assets/outfits/${id}.png` })));

function createWardrobe(storage) {
  let selectedId = 'white_coat';
  let gender = 'male';
  let femaleUnlocked = false;
  let unlockDirty = false;
  let storageError = null;
  const known = (id) => typeof id === 'string' && OUTFITS.some((outfit) => outfit.id === id);

  function readDisk() {
    if (!storage || typeof storage.getItem !== 'function') throw new Error('storage_unavailable');
    let raw;
    try { raw = storage.getItem(STORAGE_KEY); } catch (_) { throw new Error('storage_read_failed'); }
    if (raw == null || raw === '') return null;
    let data;
    try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { throw new Error('storage_corrupt'); }
    if (!data || data.version !== 1 || !known(data.selectedId)
      || (data.gender !== undefined && !GENDERS.includes(data.gender))
      || (data.femaleUnlocked !== undefined && typeof data.femaleUnlocked !== 'boolean')) throw new Error('storage_corrupt');
    // A prior female selection is not evidence of completing the story. Old
    // saves keep the outfit but use male artwork unless eligibility was earned.
    const unlocked = data.femaleUnlocked === true;
    return { selectedId: data.selectedId, gender: data.gender === 'female' && unlocked ? 'female' : 'male', femaleUnlocked: unlocked };
  }
  try {
    const saved = readDisk();
    if (saved) { selectedId = saved.selectedId; gender = saved.gender; femaleUnlocked = saved.femaleUnlocked; }
  } catch (error) { storageError = error.message; }

  function appearance(outfit) {
    return { id: outfit.id, name: outfit.name, image: `assets/outfits/${gender === 'female' ? 'female/' : ''}${outfit.id}.png` };
  }
  function getState() { return { outfits: OUTFITS.map(appearance), selectedId, gender, femaleUnlocked, storageError }; }
  function getSelected() { return appearance(OUTFITS.find((outfit) => outfit.id === selectedId)); }
  function persist(code) {
    try {
      // Preserve unreadable existing data. Retrying after storage recovers will
      // save the current in-memory choice, including when the ID is unchanged.
      const saved = readDisk();
      // A later wardrobe instance must never replace a previously earned unlock.
      femaleUnlocked = femaleUnlocked || !!(saved && saved.femaleUnlocked);
      if (!storage || typeof storage.setItem !== 'function') throw new Error('storage_unavailable');
      let accepted;
      try { accepted = storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, selectedId, gender, femaleUnlocked })); }
      catch (_) { throw new Error('storage_write_failed'); }
      if (accepted === false || (accepted && typeof accepted.then === 'function')) throw new Error('storage_write_failed');
      storageError = null; unlockDirty = false;
      return { ok: true, persisted: true, code, selectedId, gender, femaleUnlocked, storageError: null };
    } catch (error) {
      storageError = error.message || 'storage_write_failed';
      return { ok: false, persisted: false, code: 'not_saved', selectedId, gender, femaleUnlocked, storageError };
    }
  }
  function select(id) {
    if (!known(id)) return { ok: false, persisted: false, code: 'invalid_outfit', selectedId, gender, storageError };
    selectedId = id;
    return persist('selected');
  }
  function setGender(value) {
    if (!GENDERS.includes(value)) return { ok: false, persisted: false, code: 'invalid_gender', selectedId, gender, storageError };
    if (value === 'female' && !femaleUnlocked) return { ok: false, persisted: false, code: 'locked', selectedId, gender, femaleUnlocked, storageError };
    gender = value;
    return persist('gender_selected');
  }
  function observeCompletion(state, expectedChapterIds = CHAPTER_IDS) {
    const response = (ok, code) => ({ ok, code, newlyUnlocked: false, unlocked: femaleUnlocked, femaleUnlocked,
      persisted: !unlockDirty && storageError === null, storageError });
    if (!Array.isArray(expectedChapterIds) || expectedChapterIds.length !== CHAPTER_IDS.length
      || expectedChapterIds.some((id) => typeof id !== 'number' && typeof id !== 'string')
      || new Set(expectedChapterIds.map(String)).size !== CHAPTER_IDS.length
      || CHAPTER_IDS.some((id) => !expectedChapterIds.some((expected) => (typeof expected === 'number' || typeof expected === 'string') && String(expected) === String(id)))) {
      return response(false, 'invalid_chapters');
    }
    if (!state || typeof state !== 'object' || Array.isArray(state)) return response(false, 'invalid_game_state');
    const results = state.chapterResults;
    const complete = state.status === 'complete' && results && typeof results === 'object' && !Array.isArray(results)
      && CHAPTER_IDS.every((id) => {
        if (!Object.prototype.hasOwnProperty.call(results, String(id))) return false;
        const record = results[String(id)];
        return record && typeof record === 'object' && !Array.isArray(record)
          && (record.chapterId === undefined || ((typeof record.chapterId === 'string' || typeof record.chapterId === 'number') && String(record.chapterId) === String(id)));
      });
    const newlyUnlocked = !femaleUnlocked && !!complete;
    if (newlyUnlocked) { femaleUnlocked = true; unlockDirty = true; }
    if (unlockDirty) {
      const saved = persist('female_unlocked');
      return { ...saved, newlyUnlocked, unlocked: femaleUnlocked };
    }
    return response(true, femaleUnlocked ? 'already_unlocked' : 'incomplete_story');
  }

  return { getState, getSelected, select, setGender, observeCompletion };
}

module.exports = { createWardrobe, OUTFITS, GENDERS, CHAPTER_IDS, STORAGE_KEY };

};
modules["data/chapters.json"]=function(require,module,exports){
module.exports=[
  {
    "id": 1,
    "title": "鼠神医",
    "tagline": "病榻上的形貌，会改变伸出的手吗？",
    "sourceSummary": "抽样画面中，李晨光被带往一座异界殿堂；患者灰老三显出巨鼠形态，李晨光与白衣人及鼠形助手参与手术，随后返回卧室。",
    "intro": "窗外有人轻叩玻璃。李晨光还穿着睡衣，脚下却已是陌生殿堂的地砖。屏风后传来呻吟，白衣老人递来一件手术衣。",
    "objective": "确认陌生来客与病榻之间的联系，再决定如何回应这场求助。",
    "clues": [
      {
        "id": "c01_1",
        "title": "未凉的枕头",
        "text": "床铺仍留着温度，窗边却没有来客的脚印。",
        "room": "hospital",
        "x": 0.21,
        "y": 0.39
      },
      {
        "id": "c01_2",
        "title": "衣袋中的工牌",
        "text": "普通工牌被带过边界；白衣并未替你说明身份。",
        "room": "hospital",
        "x": 0.48,
        "y": 0.62
      },
      {
        "id": "c01_3",
        "title": "归途的亮屏",
        "text": "手机映出熟悉的卧室，像一扇尚未关严的门。",
        "room": "hospital",
        "x": 0.79,
        "y": 0.32
      },
      {
        "id": "c01_4",
        "title": "灰老三的称呼",
        "text": "老人唤出名字，病榻上的人显出巨鼠形貌。",
        "room": "other",
        "x": 0.24,
        "y": 0.61
      },
      {
        "id": "c01_5",
        "title": "鼠形助手",
        "text": "小小助手把器械摆齐；陌生形貌下仍有明确分工。",
        "room": "other",
        "x": 0.52,
        "y": 0.34
      },
      {
        "id": "c01_6",
        "title": "殿堂的谢意",
        "text": "众人围在手术台旁，目光由焦虑转为期待。",
        "room": "other",
        "x": 0.81,
        "y": 0.55
      }
    ],
    "puzzle": {
      "question": "把眼前线索连起来，哪一件事始终没有改变？",
      "options": [
        "病榻上仍有人等待帮助",
        "变出鼠形便说明来客毫无诚意",
        "所有异界邀请都能靠工牌解释"
      ],
      "correctIndex": 0,
      "explanation": "形貌改变、助手现身与求助场景并存。本章考察叙事线索，不要求玩家作现实医疗判断。"
    },
    "choices": [
      {
        "id": "c01_truth",
        "label": "追问殿堂的来历",
        "text": "完成交接后留下片刻，把来客、称呼与归途逐一记下。",
        "requiresClues": 5,
        "effects": {
          "hp": -3,
          "energy": -9,
          "trust": 3,
          "insight": 12,
          "money": 0
        },
        "ending": {
          "title": "窗缝里的地图",
          "text": "你带回一张无人认得的殿堂草图。清晨照常到来，窗上的一枚细小爪印却没有消失。",
          "tone": "hope"
        }
      },
      {
        "id": "c01_bond",
        "label": "把名字留给灰老三",
        "text": "不索取报酬，询问灰老三的名字，也让他记住你的名字。",
        "requiresClues": 3,
        "effects": {
          "hp": 0,
          "energy": -5,
          "trust": 11,
          "insight": 4,
          "money": -5
        },
        "ending": {
          "title": "有人记得你",
          "text": "殿堂中的感谢终于落到一个名字上。你回到卧室时，衣袋里多了一根系得笨拙的平安绳。",
          "tone": "hope"
        }
      },
      {
        "id": "c01_rest",
        "label": "请老人接手，沿原路返回",
        "text": "说明自己的疲惫，留下已经确认的信息，回到窗边。",
        "requiresClues": 0,
        "effects": {
          "hp": 6,
          "energy": 9,
          "trust": -2,
          "insight": 1,
          "money": 0
        },
        "ending": {
          "title": "未完成的邀请",
          "text": "你在天亮前重新躺下。窗外灯火渐远，这一夜没有给出全部答案，却留住了你的一段睡眠。",
          "tone": "mixed"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        11.3,
        19.6,
        28.0,
        36.3,
        44.6,
        52.9,
        61.2,
        69.5,
        77.9,
        86.2,
        94.5,
        102.8,
        111.1,
        119.4,
        127.8
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 1,
    "phase": "入职",
    "timelineNote": "保留用户确认的源第一章作为游戏开局；进入异界与返回卧室不改变现实年龄。入职阶段为改编定位，原片抽样未给确切入职日期。",
    "presentation": "video",
    "timeNote": "入职 · 病榻上的形貌，会改变伸出的手吗？"
  },
  {
    "id": 28,
    "title": "赤色祭坛",
    "tagline": "当所有人都可被查阅，谁来守住人的边界？",
    "sourceSummary": "入培信息表在群体中流转，李晨光对个人隐私暴露感到担忧，却得到以管理便利为由的回应。梦中医院化为赤色祭坛，个人被材料与要求束缚；醒后他仍面对现实中的制度压力。",
    "intro": "共享表格又增加了一列私密资料。夜里，打印机吐出的纸变成通向赤色祭坛的阶梯。你要查清谁能看到这些资料，哪些要求真的必要。",
    "objective": "追踪资料的流转范围，保留证据并选择回应方式。",
    "roomNames": {
      "hospital": "医院·资料办公室",
      "other": "异界·赤色祭坛"
    },
    "clues": [
      {
        "id": "c28_1",
        "title": "入培共享表",
        "text": "名单中混放着联络信息与个人资料，查看范围没有明确说明。",
        "room": "hospital",
        "x": 0.2,
        "y": 0.32
      },
      {
        "id": "c28_2",
        "title": "群内转发",
        "text": "同一份表格多次流转，接收者已经超出最初的工作群。",
        "room": "hospital",
        "x": 0.51,
        "y": 0.6
      },
      {
        "id": "c28_3",
        "title": "便利答复",
        "text": "面对范围与用途的疑问，回复只强调管理需要。",
        "room": "hospital",
        "x": 0.8,
        "y": 0.35
      },
      {
        "id": "c28_4",
        "title": "无名材料夹",
        "text": "每个人被装进同样的格子，边界在整齐的格式中消失。",
        "room": "other",
        "x": 0.18,
        "y": 0.58
      },
      {
        "id": "c28_5",
        "title": "祭坛刻度",
        "text": "刻度同时记录时间、精力与私密信息，索取没有清晰的终点。",
        "room": "other",
        "x": 0.5,
        "y": 0.28
      },
      {
        "id": "c28_6",
        "title": "未提交副本",
        "text": "你保留了不同版本，可以指出哪些字段后来被添加。",
        "room": "other",
        "x": 0.82,
        "y": 0.6
      }
    ],
    "puzzle": {
      "question": "哪组材料最能支持对资料收集范围提出具体疑问？",
      "options": [
        "表格颜色醒目",
        "不同版本、转发范围与新增字段记录",
        "所有人的名字排得很整齐"
      ],
      "correctIndex": 1,
      "explanation": "版本差异与流转范围能让问题落到可核对的事实，而不是只停留在不安的感受上。"
    },
    "choices": [
      {
        "id": "c28_comply",
        "label": "按要求继续补全所有字段",
        "text": "先让催办停止，把疑问留给以后。",
        "requiresClues": 0,
        "effects": {
          "hp": -7,
          "energy": -5,
          "trust": -1,
          "insight": 0,
          "money": 15
        },
        "ending": {
          "title": "完整的档案",
          "text": "材料夹合上了，祭坛也暂时安静。下一次通知到来时，你发现空白字段又增加了。",
          "tone": "dark"
        }
      },
      {
        "id": "c28_limit",
        "label": "询问必要范围并保留副本",
        "text": "从一项具体要求开始，记录每次回应。",
        "requiresClues": 3,
        "effects": {
          "hp": -2,
          "energy": -5,
          "trust": 2,
          "insight": 4,
          "money": 0
        },
        "ending": {
          "title": "被写下的问题",
          "text": "答复并不轻松，但问题终于有了日期、字段和收件人。你为下一次讨论留下了依据。",
          "tone": "mixed"
        }
      },
      {
        "id": "c28_together",
        "label": "与同伴提出有依据的边界方案",
        "text": "整理证据，提出限制查看范围与减少无关字段的办法。",
        "requiresClues": 5,
        "effects": {
          "hp": 5,
          "energy": -10,
          "trust": 5,
          "insight": 5,
          "money": -10
        },
        "ending": {
          "title": "未被献出的名字",
          "text": "你们没有一夜改变医院，却使部分资料退出了公开流转。名字之外，每个人仍保留自己的生活。",
          "tone": "hope"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        34.9,
        66.8,
        98.7,
        130.6,
        162.5,
        194.4,
        226.3,
        258.2,
        290.1,
        322.0,
        353.9,
        385.8,
        417.7,
        449.6,
        481.5
      ],
      "fullResolutionFrames": []
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 2,
    "phase": "入职",
    "timelineNote": "入培信息表是早期阶段的明确线索；赤色祭坛为梦境，醒后仍回现实。本章前移到入职段，不把梦境计为人生经过的年月。",
    "presentation": "video",
    "timeNote": "入职 · 当所有人都可被查阅，谁来守住人的边界？",
    "flags": {
      "familyBetrayalForeshadowed": true
    }
  },
  {
    "id": 29,
    "title": "键盘共感",
    "tagline": "让重复的敲击停止，让人重新听见彼此。",
    "sourceSummary": "李晨光在宿舍键盘录入病历时，室友张展会出现难以预测的共感。张展通过对比打字、移动鼠标、阅读和手写等活动确认触发情境，随后两人合作制作辅助系统，保留医生核对与判断。",
    "intro": "敲击病历的声音又让张展蜷起肩膀。你停下手，他也松了一口气。经过许多夜晚，你们决定一起找出规律，把减轻负担的办法做得可信。",
    "objective": "复核共感触发条件，设计能够追溯与核对的协作方案。",
    "roomNames": {
      "hospital": "医院·文书工作站",
      "other": "异界·共同的宿舍"
    },
    "clues": [
      {
        "id": "c29_1",
        "title": "病历输入记录",
        "text": "不适与键盘录入病历同步，记录中保留了具体时段。",
        "room": "hospital",
        "x": 0.2,
        "y": 0.32
      },
      {
        "id": "c29_2",
        "title": "信息来源标记",
        "text": "系统试稿为每段内容标出来源，等待逐项核对。",
        "room": "hospital",
        "x": 0.51,
        "y": 0.6
      },
      {
        "id": "c29_3",
        "title": "签名确认栏",
        "text": "草稿完成后仍留有人工确认的位置，没有自动替人签名。",
        "room": "hospital",
        "x": 0.8,
        "y": 0.35
      },
      {
        "id": "c29_4",
        "title": "对比实验表",
        "text": "移动鼠标、阅读与手写未出现同样反应，录入病历时会触发。",
        "room": "other",
        "x": 0.18,
        "y": 0.58
      },
      {
        "id": "c29_5",
        "title": "共感日志",
        "text": "触发情境可以辨认，身体部位和感受却并不固定。",
        "room": "other",
        "x": 0.5,
        "y": 0.28
      },
      {
        "id": "c29_6",
        "title": "共同工作台",
        "text": "两人把整理交给工具，把核对、理解与判断留给协作的人。",
        "room": "other",
        "x": 0.82,
        "y": 0.6
      }
    ],
    "puzzle": {
      "question": "实验记录支持怎样的结论？",
      "options": [
        "一切电脑操作都会触发相同部位的感觉",
        "只有键盘录入病历被观察到触发，共感形式仍不可预测",
        "既然能用工具，就可以取消人工核对"
      ],
      "correctIndex": 1,
      "explanation": "触发情境与具体感受是两件事；对照实验限定了前者，日志说明后者仍不稳定。"
    },
    "choices": [
      {
        "id": "c29_alone",
        "label": "继续独自敲完所有材料",
        "text": "把两个人的困扰暂时压到夜深以后。",
        "requiresClues": 0,
        "effects": {
          "hp": -6,
          "energy": -8,
          "trust": -2,
          "insight": 1,
          "money": 10
        },
        "ending": {
          "title": "同一间失眠的房间",
          "text": "键盘还在响，张展也没有睡着。材料减少了一叠，你们之间却多了一段沉默。",
          "tone": "dark"
        }
      },
      {
        "id": "c29_schedule",
        "label": "先调整输入时间与协作分工",
        "text": "让双方能休息，再逐步验证工具。",
        "requiresClues": 3,
        "effects": {
          "hp": 6,
          "energy": 5,
          "trust": 3,
          "insight": 3,
          "money": -5
        },
        "ending": {
          "title": "安静的一小时",
          "text": "你们重新排好任务。窗外仍是夜色，屋里却第一次有人能安心合上书。",
          "tone": "mixed"
        }
      },
      {
        "id": "c29_build",
        "label": "一起完成可追溯的辅助系统",
        "text": "保存来源、保留人工确认，用工具减少重复而不转嫁责任。",
        "requiresClues": 5,
        "effects": {
          "hp": 8,
          "energy": 8,
          "trust": 6,
          "insight": 6,
          "money": -15
        },
        "ending": {
          "title": "写给明天的留白",
          "text": "最后一段内容经你核对，张展按下保存。你们关掉电脑，给明天留下一段不属于任何表格的时间。",
          "tone": "hope"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        25.95,
        48.91,
        71.86,
        94.81,
        117.77,
        140.72,
        163.67,
        186.63,
        209.58,
        232.53,
        255.49,
        278.44,
        301.39,
        324.35,
        347.3
      ],
      "fullResolutionFrames": [
        5
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 3,
    "phase": "规培",
    "timelineNote": "宿舍、室友张展与病历录入支持安排在共同住宿的早期训练阶段；具体规培年级未核实，共感实验不改变年龄。",
    "presentation": "video",
    "timeNote": "规培 · 让重复的敲击停止，让人重新听见彼此。"
  },
  {
    "id": 14,
    "title": "神笔误用",
    "tagline": "写下去之前，先看见眼前的人。",
    "sourceSummary": "夜班神在梦境般的场景中赠予李晨光神笔，声称医疗记录中的陈述会成为现实。片段对照病历与实际查体，后续出现他重新核实患者情况的场景，并将神笔寓意与真实记录相联系。",
    "intro": "夜班神把笔放进你的掌心，承诺纸上的陈述都会成真。熟悉的模板忽然像一道咒语，而病床上的老人正等你抬头。",
    "objective": "查清模板、观察与神笔之间的矛盾，再决定如何落笔。",
    "clues": [
      {
        "id": "c14_1",
        "title": "旧模板",
        "text": "几份旧记录有完全相同的句子，连停顿也未改变。",
        "room": "hospital",
        "x": 0.22,
        "y": 0.31
      },
      {
        "id": "c14_2",
        "title": "床旁回应",
        "text": "老人清楚地回答了你的问题，与模板中的一句描述冲突。",
        "room": "hospital",
        "x": 0.49,
        "y": 0.5
      },
      {
        "id": "c14_3",
        "title": "记录时间",
        "text": "复制时间早于本次核实时间，这句话来得太早。",
        "room": "hospital",
        "x": 0.77,
        "y": 0.34
      },
      {
        "id": "c14_4",
        "title": "夜班神的赠笔",
        "text": "神笔承诺让陈述成真，却没有承诺替人分辨真假。",
        "room": "other",
        "x": 0.23,
        "y": 0.6
      },
      {
        "id": "c14_5",
        "title": "墨中的倒影",
        "text": "每抄下一行，倒影就更像纸面，也更不像眼前的人。",
        "room": "other",
        "x": 0.51,
        "y": 0.3
      },
      {
        "id": "c14_6",
        "title": "未写的末页",
        "text": "最后一页仍是空白。你可以先观察，再决定写什么。",
        "room": "other",
        "x": 0.78,
        "y": 0.62
      }
    ],
    "puzzle": {
      "question": "哪一步能打破神笔的陷阱？",
      "options": [
        "按旧模板补齐所有空白",
        "先核实眼前情况，再记录可确认内容",
        "只把措辞写得更肯定"
      ],
      "correctIndex": 1,
      "explanation": "床旁回应与记录时间揭示了矛盾：神笔不能替代观察，确定的语气也不能补足证据。"
    },
    "choices": [
      {
        "id": "c14_verify",
        "label": "抬头，再落笔",
        "text": "逐项核对后重写记录，把不确定之处清楚留下。",
        "requiresClues": 5,
        "effects": {
          "energy": -5,
          "trust": 3,
          "insight": 3
        },
        "ending": {
          "title": "墨迹归真",
          "text": "纸面的光渐渐褪去。老人仍坐在床边，而你终于记下了真正听见和看见的东西。",
          "tone": "hope"
        }
      },
      {
        "id": "c14_seal",
        "label": "封存神笔，请同伴复核",
        "text": "暂时停笔，保留原稿并请求第二个人核对。",
        "requiresClues": 0,
        "effects": {
          "money": -10,
          "trust": 2,
          "insight": 1
        },
        "ending": {
          "title": "另一双眼睛",
          "text": "神笔沉进抽屉。同伴拉过椅子，你们一起读完了那份不该匆忙结束的记录。",
          "tone": "mixed"
        }
      },
      {
        "id": "c14_bargain",
        "label": "与夜班神讨价还价",
        "text": "把精力花在索取完美记录的保证上。",
        "requiresClues": 3,
        "effects": {
          "hp": -6,
          "energy": -8,
          "trust": -1,
          "insight": 1
        },
        "ending": {
          "title": "没有保证的承诺",
          "text": "夜班神给了你更华丽的笔盒，却仍不肯替任何一个字作证。天亮时，原来的疑问还在。",
          "tone": "dark"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        26.8,
        50.6,
        74.4,
        98.2,
        121.9,
        145.7,
        169.5,
        193.3,
        217.1,
        240.9,
        264.7,
        288.5,
        312.3,
        336.0,
        359.8
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 4,
    "phase": "规培",
    "timelineNote": "按病历核对学习主题安排在训练前段；赠笔为梦境般的超自然情节，阶段位置是改编安排，非原作明示年份。",
    "presentation": "video",
    "timeNote": "规培 · 写下去之前，先看见眼前的人。"
  },
  {
    "id": 24,
    "title": "签到躺赢",
    "tagline": "真正的奖励，是把判断权留在自己手中。",
    "sourceSummary": "李晨光得到神秘签到系统与多种辅助工具。他在工作中使用提示、整理重点，并在事后与上级复盘，明确希望工具帮助发现遗漏而非代替自己决定。",
    "intro": "手机又弹出一份签到礼物。它能替你整理信息，却把“自动采用”放在最醒目的位置。今天的任务，是弄清哪些事情可以交给工具。",
    "objective": "核对系统提示与原始记录，为工具划定边界。",
    "roomNames": {
      "hospital": "医院·复盘室",
      "other": "异界·签到界面"
    },
    "clues": [
      {
        "id": "c24_1",
        "title": "任务原件",
        "text": "原始信息被分散在几张纸上，需要先核对来源与时间。",
        "room": "hospital",
        "x": 0.2,
        "y": 0.32
      },
      {
        "id": "c24_2",
        "title": "复盘批注",
        "text": "上级圈出一处遗漏，旁边留着你自己补写的理由。",
        "room": "hospital",
        "x": 0.51,
        "y": 0.6
      },
      {
        "id": "c24_3",
        "title": "值班联络表",
        "text": "需要协作的任务标有联系人，提示工具不能替代求援。",
        "room": "hospital",
        "x": 0.8,
        "y": 0.35
      },
      {
        "id": "c24_4",
        "title": "签到清单",
        "text": "奖励逐项解锁，却没有承诺承担使用后的责任。",
        "room": "other",
        "x": 0.18,
        "y": 0.58
      },
      {
        "id": "c24_5",
        "title": "提示界面",
        "text": "重点被突出显示，依据仍需要回到原始材料中寻找。",
        "room": "other",
        "x": 0.5,
        "y": 0.28
      },
      {
        "id": "c24_6",
        "title": "人工确认键",
        "text": "最后一步保持空白，只有你核对后才能完成。",
        "room": "other",
        "x": 0.82,
        "y": 0.6
      }
    ],
    "puzzle": {
      "question": "怎样使用这套系统，才与已经找到的线索一致？",
      "options": [
        "把所有提示直接当成最终决定",
        "只收集奖励，不再核对信息",
        "让系统整理和提示，保留核对与最终确认"
      ],
      "correctIndex": 2,
      "explanation": "工具可以降低整理负担；原始资料、协作记录与人工确认共同保留判断的依据。"
    },
    "choices": [
      {
        "id": "c24_autopilot",
        "label": "开启全自动采用",
        "text": "把今天的决定交给闪烁的按钮。",
        "requiresClues": 0,
        "effects": {
          "hp": 1,
          "energy": 10,
          "trust": -2,
          "insight": -1,
          "money": 10
        },
        "ending": {
          "title": "奖励的阴影",
          "text": "工作似乎变快了，追问理由时你却只能指向屏幕。系统没有替你回答。",
          "tone": "dark"
        }
      },
      {
        "id": "c24_limited",
        "label": "只使用整理功能",
        "text": "减少重复劳动，暂缓使用尚未理解的提示。",
        "requiresClues": 3,
        "effects": {
          "hp": 4,
          "energy": 8,
          "trust": 2,
          "insight": 3,
          "money": 0
        },
        "ending": {
          "title": "有限的便利",
          "text": "你省下一点时间，也保留了重新检查的习惯。礼物终于成为工具，而非命令。",
          "tone": "mixed"
        }
      },
      {
        "id": "c24_review",
        "label": "建立可复核的使用流程",
        "text": "与同伴记录来源、核对结果，再分享工具。",
        "requiresClues": 5,
        "effects": {
          "hp": 5,
          "energy": 6,
          "trust": 4,
          "insight": 5,
          "money": -10
        },
        "ending": {
          "title": "清醒的助手",
          "text": "签到还在继续，你们却不再等它决定命运。省下的时间，被拿去休息、讨论与学习。",
          "tone": "hope"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        29.8,
        56.6,
        83.39,
        110.19,
        136.99,
        163.79,
        190.58,
        217.38,
        244.18,
        270.98,
        297.78,
        324.57,
        351.37,
        378.17,
        404.97
      ],
      "fullResolutionFrames": [
        13
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 5,
    "phase": "规培",
    "timelineNote": "片段出现向上级求助与事后复盘，适合放在学习使用辅助工具的训练阶段；无确切年级证据，签到奖励不等于时序推进。",
    "presentation": "video",
    "timeNote": "规培 · 真正的奖励，是把判断权留在自己手中。"
  },
  {
    "id": 11,
    "title": "规培轮回",
    "tagline": "同一条走廊，谁还记得昨天？",
    "sourceSummary": "李晨光在医院走廊进入异境，与白袍长者交谈。重复的病历、手术和指南成为轮回意象；后段出现患者、同事与镜面，主题转向如何面对工作及自身处境。",
    "intro": "交班铃响了三次，走廊尽头仍是昨夜。一本写着你名字的旧册摊在雾中，白袍长者问：这一次，你准备把谁留在原地？",
    "objective": "比较医院与轮回旧册中的六处痕迹，找出能够改变重复的一件事。",
    "clues": [
      {
        "id": "c11_1",
        "title": "重写的病历",
        "text": "同一段交班文字抄了三遍，患者的称呼却每次不同。",
        "room": "hospital",
        "x": 0.22,
        "y": 0.31
      },
      {
        "id": "c11_2",
        "title": "未冷的水杯",
        "text": "杯底刻着昨天的日期，杯壁仍留着同事递来时的温度。",
        "room": "hospital",
        "x": 0.49,
        "y": 0.5
      },
      {
        "id": "c11_3",
        "title": "交班便签",
        "text": "便签空着接班者一栏：这一轮，你还没有向任何人求援。",
        "room": "hospital",
        "x": 0.77,
        "y": 0.34
      },
      {
        "id": "c11_4",
        "title": "旧册中的自己",
        "text": "册页描着无数个你，每一个都在独自做同样的事。",
        "room": "other",
        "x": 0.23,
        "y": 0.6
      },
      {
        "id": "c11_5",
        "title": "镜中的病床",
        "text": "镜里的人会回应你的话；他们并非轮回布景。",
        "room": "other",
        "x": 0.51,
        "y": 0.3
      },
      {
        "id": "c11_6",
        "title": "长者的空椅",
        "text": "桌旁还有一张椅子。册页只记录任务，从未记录共同承担。",
        "room": "other",
        "x": 0.78,
        "y": 0.62
      }
    ],
    "puzzle": {
      "question": "哪处差异最可能改变本章的轮回？",
      "options": [
        "把病历抄得更快",
        "邀请同伴接过一部分任务",
        "拒绝记住任何患者"
      ],
      "correctIndex": 1,
      "explanation": "旧册重复的是孤身承担的方式；交班便签和空椅提示你尝试建立支持。"
    },
    "choices": [
      {
        "id": "c11_share",
        "label": "补上接班者的名字",
        "text": "把核对过的记录交给同伴，并留下自己的休息时段。",
        "requiresClues": 5,
        "effects": {
          "hp": 10,
          "energy": 12,
          "trust": 3,
          "insight": 3
        },
        "ending": {
          "title": "有人接班",
          "text": "你合上旧册，走廊第一次响起两个人的脚步声。任务仍在，但这一轮有人与你轮流守夜。",
          "tone": "hope"
        }
      },
      {
        "id": "c11_leave",
        "label": "先离开这条走廊",
        "text": "保留已有记录，暂时退出轮回调查。",
        "requiresClues": 0,
        "effects": {
          "hp": 8,
          "energy": 8,
          "trust": 0,
          "insight": 0
        },
        "ending": {
          "title": "暂别回廊",
          "text": "你推开门，天色已亮。长者没有追来，旧册却仍在梦中等候下一次翻页。",
          "tone": "mixed"
        }
      },
      {
        "id": "c11_alone",
        "label": "把所有任务揽到自己手里",
        "text": "依靠熟悉的流程，独自完成这一轮。",
        "requiresClues": 3,
        "effects": {
          "hp": -8,
          "energy": -10,
          "trust": -1,
          "insight": 1
        },
        "ending": {
          "title": "最熟练的囚徒",
          "text": "你终于能背下每一声铃响。轮回赞许你的熟练，也悄悄抹去了通向别人的门。",
          "tone": "dark"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        33.3,
        63.6,
        93.9,
        124.3,
        154.6,
        184.9,
        215.2,
        245.5,
        275.8,
        306.2,
        336.5,
        366.8,
        397.1,
        427.4,
        457.7
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 6,
    "phase": "规培",
    "timelineNote": "规培主题明确；走廊轮回属于异境意象，不解读为多次真实重生或已度过数十年。",
    "presentation": "video",
    "timeNote": "规培 · 同一条走廊，谁还记得昨天？"
  },
  {
    "id": 31,
    "title": "穷且益坚",
    "tagline": "如果不是故事里的主角，你还想怎样生活？",
    "sourceLabel": "原作第31章",
    "sourceSummary": "规培生李晨光在病历夹层发现一本小说：同级沈亦航是日后成为院士的主角，同名的李晨光却只是衬托他的配角。比较与缺乏回应使他迷茫；周末散步后，他重新把心思放回患者、临床学习和具体职责。书中的未来属于小说，并非李晨光已经经历的人生。",
    "intro": "病历夹层里多了一本泛黄的小说。你翻到自己的名字，却发现那几行字只为衬托另一个人的光芒。书合上以后，明天的病房还在等你。",
    "objective": "决定用什么衡量自己的工作，而不只追赶书里的排名。",
    "transitionIntro": "规培的日子重复向前，认真完成的工作却不总能换来回应。一次深夜翻书，让李晨光开始怀疑自己是否只是别人人生里的配角。",
    "timeNote": "规培 · 书中院士是沈亦航的小说结局，李晨光仍在当下的轮转生活。",
    "presentation": "video",
    "video": "media/ch31.mp4",
    "poster": "assets/scenes/ch31-a.jpg",
    "clues": [],
    "sourceMetadata": {
      "fileName": "白衣志怪录_第三十一章_穷且益坚_横屏.mp4",
      "sourceChapterNumber": 31,
      "narrativeOwner": "李晨光",
      "subtitlePath": "docs/source-subtitles/ch31.srt"
    },
    "sourceReview": {
      "method": "full_production_subtitles_and_sampled_video_frames",
      "subtitlePath": "docs/source-subtitles/ch31.srt"
    },
    "adaptationNote": "片尾行动及分支结局为游戏改编；源影片中的情节和片中时间跨度不预先决定玩家命运。",
    "choices": [
      {
        "id": "c31_compare",
        "label": "继续追赶书里的排名",
        "text": "把更多时间投入竞争，希望下一页能够写到自己。",
        "requiresClues": 0,
        "effects": {
          "hp": -5,
          "energy": -8,
          "trust": 1,
          "insight": 3,
          "money": 5
        },
        "ending": {
          "title": "追不上翻动的页码",
          "text": "你把待办清单排得更满。新的结果还没有到来，生活里能容纳其他事情的空白却先少了一些。",
          "tone": "dark"
        }
      },
      {
        "id": "c31_patient",
        "label": "从明天的一位患者做起",
        "text": "重新整理眼前的工作，认真倾听并承担能够完成的职责。",
        "requiresClues": 0,
        "effects": {
          "hp": 2,
          "energy": -2,
          "trust": 6,
          "insight": 5,
          "money": 0
        },
        "ending": {
          "title": "属于你的那一页",
          "text": "你把书放回抽屉，先核对好明早要交接的事项。那页纸没有写成传奇，却留下了一个具体的人得到照顾的经过。",
          "tone": "hope"
        }
      },
      {
        "id": "c31_walk",
        "label": "先出去走一走",
        "text": "给自己留出一点不必接受评分的时间，再重新安排学习与工作。",
        "requiresClues": 0,
        "effects": {
          "hp": 6,
          "energy": 8,
          "trust": 0,
          "insight": 2,
          "money": -3
        },
        "ending": {
          "title": "公园里的空白页",
          "text": "树影从鞋边移过去，你不急着替余生写下结论。回医院时，那本书仍在包里，却没有再替你决定每一步。",
          "tone": "mixed"
        }
      }
    ],
    "gameOrder": 7,
    "phase": "规培",
    "timelineNote": "完整字幕明确主角为规培生；书中沈亦航成为院士是小说内未来，不是李晨光已经历的年岁。接在规培轮回之后，以重复劳动、比较压力与重新寻找工作意义构成主题衔接。"
  },
  {
    "id": 2,
    "title": "日月反背",
    "tagline": "天亮以后，谁能真正下班？",
    "sourceSummary": "抽样画面呈现深夜病历工作、红月与扭曲时钟。年长医师把日月颠倒解释为积累的怨念与过劳的代价；李晨光仍担忧次日病历检查，结尾出现晨光。",
    "intro": "屏幕显示凌晨两点，窗外却挂起一轮赤日。走廊尽头的前辈向你招手：这一次，昼夜不是按照时钟轮换的。",
    "objective": "比较时钟、病历与前辈的提醒，找出反常夜色指向的困境。",
    "clues": [
      {
        "id": "c02_1",
        "title": "两点的屏幕",
        "text": "桌上的电子时钟仍走着，病历堆却没有变薄。",
        "room": "hospital",
        "x": 0.21,
        "y": 0.39
      },
      {
        "id": "c02_2",
        "title": "未改完的病历",
        "text": "你担心的不是红月，而是明天专业组的责问。",
        "room": "hospital",
        "x": 0.48,
        "y": 0.62
      },
      {
        "id": "c02_3",
        "title": "窗边的晨光",
        "text": "光照进走廊时，桌上的任务仍在原处。",
        "room": "hospital",
        "x": 0.79,
        "y": 0.32
      },
      {
        "id": "c02_4",
        "title": "折叠的时钟",
        "text": "异界的表盘弯曲相叠，每一层都有人继续工作。",
        "room": "other",
        "x": 0.24,
        "y": 0.61
      },
      {
        "id": "c02_5",
        "title": "前辈的提醒",
        "text": "他把异象指向劳作与生活失衡留下的怨念。",
        "room": "other",
        "x": 0.52,
        "y": 0.34
      },
      {
        "id": "c02_6",
        "title": "重复的走廊",
        "text": "红与蓝的走廊互相穿透，却都通向同一张办公桌。",
        "room": "other",
        "x": 0.81,
        "y": 0.55
      }
    ],
    "puzzle": {
      "question": "为何仅仅把时钟拨回正常，仍不能结束这个夜晚？",
      "options": [
        "时钟必须全部换成新的",
        "困住人的任务与生活处境没有改变",
        "必须等红月再次升起"
      ],
      "correctIndex": 1,
      "explanation": "前辈的解释与未完病历相互印证：异象把一个不能真正结束的夜班具象化。"
    },
    "choices": [
      {
        "id": "c02_truth",
        "label": "记录重复的夜晚",
        "text": "对照值班记录，留下每次日月反背的共同线索。",
        "requiresClues": 5,
        "effects": {
          "hp": -4,
          "energy": -10,
          "trust": 2,
          "insight": 12,
          "money": 0
        },
        "ending": {
          "title": "不肯归零的钟",
          "text": "你没有拨动时针，而是记下它绕过的每一个人。纸上的夜晚有了边界，身体却比来时更沉。",
          "tone": "mixed"
        }
      },
      {
        "id": "c02_bond",
        "label": "与前辈一起整理交接",
        "text": "把无法独自完成的工作摊开，共同决定交接顺序。",
        "requiresClues": 3,
        "effects": {
          "hp": 3,
          "energy": -3,
          "trust": 10,
          "insight": 5,
          "money": 0
        },
        "ending": {
          "title": "两个人的黎明",
          "text": "你们把最后一份交接写清。太阳没有因此升得更快，但走向窗边时，终于不是一个人。",
          "tone": "hope"
        }
      },
      {
        "id": "c02_rest",
        "label": "交接后离开红色走廊",
        "text": "保留异象记录，把未完成事项交接出去。",
        "requiresClues": 0,
        "effects": {
          "hp": 7,
          "energy": 10,
          "trust": -3,
          "insight": 1,
          "money": -5
        },
        "ending": {
          "title": "被留住的早晨",
          "text": "红光在门后收拢。你没能说服所有人，却在早餐摊前停了下来，第一次发现热气也有颜色。",
          "tone": "mixed"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        18.9,
        34.8,
        50.7,
        66.5,
        82.4,
        98.3,
        114.2,
        130.1,
        146.0,
        161.8,
        177.7,
        193.6,
        209.5,
        225.4,
        241.3
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 8,
    "phase": "规培",
    "timelineNote": "深夜病历与次日检查承接训练阶段的工作负荷；红月和日月颠倒属于志怪情境，不据此推算日期或年龄。",
    "presentation": "video",
    "timeNote": "规培 · 天亮以后，谁能真正下班？"
  },
  {
    "id": 33,
    "title": "第二人格",
    "tagline": "镜中的温柔，能陪你走多远？",
    "sourceLabel": "原作第33章",
    "sourceSummary": "骨科轮转期间，连续通宵的李晨光在镜中遇见自称李辉光的另一个自己。他在查房和手术中得到安慰，却逐渐依赖这段无法确认的关系；后来向现实中的专业人员求助，接受评估、治疗、复诊与休息调整。片尾短暂跳至多年后成熟的手术医生李晨光，回望曾经的陪伴。",
    "intro": "又是一个通宵后的清晨。镜中的人先抬起头，轻声叫你晨光。有人愿意陪你把一天撑过去，你却还不知道，自己会多么依赖这份温柔。",
    "objective": "面对依赖与告别，决定怎样把生活重新握在手中。",
    "transitionIntro": "漫长的夜班之后，故事转向李晨光在骨科轮转的一段经历。镜子里出现的李辉光，让疲惫的清晨暂时有了可以依靠的人。",
    "timeNote": "规培 · 骨科轮转往事；片尾“多年以后”是短暂尾声，下一章仍接续青年时期的经历。",
    "presentation": "video",
    "video": "media/ch33.mp4",
    "poster": "assets/scenes/ch33-a.jpg",
    "clues": [],
    "sourceMetadata": {
      "fileName": "白衣志怪录_第三十三章_第二人格_横屏.mp4",
      "sourceChapterNumber": 33,
      "narrativeOwner": "李晨光",
      "subtitlePath": "docs/source-subtitles/ch33.srt"
    },
    "sourceReview": {
      "method": "full_production_subtitles_and_sampled_video_frames",
      "subtitlePath": "docs/source-subtitles/ch33.srt"
    },
    "adaptationNote": "片尾行动及分支结局为游戏改编；源影片中的情节和片中时间跨度不预先决定玩家命运。",
    "choices": [
      {
        "id": "c33_hide",
        "label": "暂时把这段经历藏起来",
        "text": "你还舍不得告别，只想再独自等一次熟悉的声音。",
        "requiresClues": 0,
        "effects": {
          "hp": -5,
          "energy": -6,
          "trust": -2,
          "insight": 2,
          "money": 0
        },
        "ending": {
          "title": "没有回音的清晨",
          "text": "镜子仍映着你的脸。等待替你拖延了一次告别，也把本可以说给别人听的话留在了房间里。",
          "tone": "dark"
        }
      },
      {
        "id": "c33_help",
        "label": "继续接受现实中的帮助",
        "text": "把经历和担心如实说出来，按已商定的安排继续照顾自己。",
        "requiresClues": 0,
        "effects": {
          "hp": 6,
          "energy": 5,
          "trust": 3,
          "insight": 5,
          "money": -5
        },
        "ending": {
          "title": "另一种陪伴",
          "text": "你记下下一次见面的时间，也答应同伴在交班后一起吃饭。怀念没有立刻消失，但生活开始容得下镜子以外的人。",
          "tone": "hope"
        }
      },
      {
        "id": "c33_goodbye",
        "label": "给辉光写一封不会寄出的信",
        "text": "把想念留下，同时为现实中的休息和求助留出位置。",
        "requiresClues": 0,
        "effects": {
          "hp": 3,
          "energy": 4,
          "trust": 2,
          "insight": 6,
          "money": 0
        },
        "ending": {
          "title": "把温柔带走",
          "text": "你没有抹掉那段记忆，只把信折好放进抽屉。走出门时，安慰自己的那句话终于由你亲口说了出来。",
          "tone": "mixed"
        }
      }
    ],
    "gameOrder": 9,
    "phase": "规培",
    "timelineNote": "完整字幕从骨科轮转连续通宵写起；接在日月反背之后，承接夜班负荷主题。多年后成熟医生的片尾为短暂尾声；观看后回到这段青年经历所在的主线，不能把下一章理解成退休后重返规培。李辉光故事与源26镜中分身牵引情节不同，分别保留。"
  },
  {
    "id": 4,
    "title": "梦中医院",
    "tagline": "每次梦见它，门都在原来的位置。",
    "sourceSummary": "抽样画面中，李晨光反复梦见布局稳定却破旧的医院，经过积水空间、地铁站、门岗、花园与白色建筑。现实同事谈及医院地下空间及地铁站迁移的传闻。",
    "intro": "你又从值班室醒来。墙皮剥落，门牌模糊，可走廊的转弯分毫未变。昨天梦中的水迹，今天已经漫过鞋底。",
    "objective": "拼合梦中固定地标，在追查旧址与寻找出口之间作出选择。",
    "clues": [
      {
        "id": "c04_1",
        "title": "磨损的门牌",
        "text": "字迹已不可读，门与护士站的位置却仍熟悉。",
        "room": "hospital",
        "x": 0.21,
        "y": 0.39
      },
      {
        "id": "c04_2",
        "title": "午餐时的传闻",
        "text": "同事谈起地下空间与旧地铁站，没人给出完整地图。",
        "room": "hospital",
        "x": 0.48,
        "y": 0.62
      },
      {
        "id": "c04_3",
        "title": "醒后的速写",
        "text": "你画下几次梦中的转角，线条竟能重合。",
        "room": "hospital",
        "x": 0.79,
        "y": 0.32
      },
      {
        "id": "c04_4",
        "title": "积水的通道",
        "text": "低处的水缓慢上涨，尽头连接一段陌生站台。",
        "room": "other",
        "x": 0.24,
        "y": 0.61
      },
      {
        "id": "c04_5",
        "title": "花园与门岗",
        "text": "两处地标总在同样的位置，像一张不肯更新的地图。",
        "room": "other",
        "x": 0.52,
        "y": 0.34
      },
      {
        "id": "c04_6",
        "title": "白色建筑",
        "text": "街区中央的白楼反复出现，周围行人却记不清脸。",
        "room": "other",
        "x": 0.81,
        "y": 0.55
      }
    ],
    "puzzle": {
      "question": "哪条线索最适合用来验证这些梦是否共享同一空间？",
      "options": [
        "门岗、花园与白楼的相对位置",
        "梦里每一个行人的长相",
        "每晚梦境持续的分钟数"
      ],
      "correctIndex": 0,
      "explanation": "多次出现且位置固定的地标，是本章地图推理的依据；同事的传闻尚不能代替核实。"
    },
    "choices": [
      {
        "id": "c04_truth",
        "label": "绘出地下与地上的重叠图",
        "text": "沿固定地标再走一遍，把水道、站台与白楼接起来。",
        "requiresClues": 5,
        "effects": {
          "hp": -5,
          "energy": -10,
          "trust": 0,
          "insight": 12,
          "money": -5
        },
        "ending": {
          "title": "一张双面的地图",
          "text": "晨光落在纸上，梦里的站台恰好压住现实的一堵墙。你终于知道要问哪一个问题，却还不知道谁会回答。",
          "tone": "mixed"
        }
      },
      {
        "id": "c04_bond",
        "label": "邀请同事核对旧址",
        "text": "拿出速写，请记得旧院的人一起补充缺口。",
        "requiresClues": 3,
        "effects": {
          "hp": 0,
          "energy": -4,
          "trust": 10,
          "insight": 6,
          "money": 0
        },
        "ending": {
          "title": "共同记得的地方",
          "text": "有人认出了花园边的一段台阶。你把那人的名字写在图角；这座医院不再只寄存在一个人的梦里。",
          "tone": "hope"
        }
      },
      {
        "id": "c04_rest",
        "label": "沿花园返回熟悉的门",
        "text": "停止向积水深处探查，以固定地标寻找离开路线。",
        "requiresClues": 0,
        "effects": {
          "hp": 6,
          "energy": 9,
          "trust": 0,
          "insight": 2,
          "money": 0
        },
        "ending": {
          "title": "暂时醒来",
          "text": "你走过花园，没有推开白楼的门。醒后枕边仍很干燥，只是鞋底仿佛留下了一点水声。",
          "tone": "mixed"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        25.8,
        48.6,
        71.4,
        94.1,
        116.9,
        139.7,
        162.5,
        185.3,
        208.1,
        230.9,
        253.6,
        276.4,
        299.2,
        322.0,
        344.8
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 10,
    "phase": "规培",
    "timelineNote": "安排在熟悉医院空间后；反复进入旧医院是梦中经历，旧建筑与地下传闻不代表李晨光生活在过去年代。",
    "presentation": "video",
    "timeNote": "规培 · 每次梦见它，门都在原来的位置。"
  },
  {
    "id": 6,
    "title": "谵妄预言",
    "tagline": "先照看眼前的人，再面对无法解释的话。",
    "sourceSummary": "抽样画面中，住院老人反复谵妄并说出实验室、棋子与命运相关话语，李晨光感到不安。团队继续处理病情，老人后来清醒；李晨光在夜间工作中仍回想这些话。",
    "intro": "监护仪按自己的节奏响着。老人忽然抓住你的袖口，说你也是玻璃箱里的棋子。你记得他的声音，却不知该把这句话放在哪里。",
    "objective": "分开可核对的事件、患者话语与自己的恐惧，再选择行动。",
    "clues": [
      {
        "id": "c06_1",
        "title": "夜间记录",
        "text": "老人有时清醒、有时言语混乱，记录中的时间并不连续。",
        "room": "hospital",
        "x": 0.21,
        "y": 0.39
      },
      {
        "id": "c06_2",
        "title": "床旁呼叫",
        "text": "团队仍在回应眼前的病情，怪谈没有使照护停下。",
        "room": "hospital",
        "x": 0.48,
        "y": 0.62
      },
      {
        "id": "c06_3",
        "title": "清醒时的目光",
        "text": "后来的老人平静许多，先前的言语没有得到证实。",
        "room": "hospital",
        "x": 0.79,
        "y": 0.32
      },
      {
        "id": "c06_4",
        "title": "玻璃箱的倒影",
        "text": "走廊在想象中弯折，像一只层层反射的盒子。",
        "room": "other",
        "x": 0.24,
        "y": 0.61
      },
      {
        "id": "c06_5",
        "title": "棋子的隐喻",
        "text": "老人谈起看不见的线，把人物比作被牵动的棋子。",
        "room": "other",
        "x": 0.52,
        "y": 0.34
      },
      {
        "id": "c06_6",
        "title": "未发送的问候",
        "text": "你想起一位同事，消息框里只有一句：最近还好吗？",
        "room": "other",
        "x": 0.81,
        "y": 0.55
      }
    ],
    "puzzle": {
      "question": "面对这些线索，哪种记录方式最稳妥？",
      "options": [
        "把老人说的话全部标作已证实预言",
        "将所有不安从记录中删除",
        "分别记录所见、所闻和未核实的解释"
      ],
      "correctIndex": 2,
      "explanation": "本章的悬疑来自不确定性。患者话语与画面事实分开记录，既保留故事张力，也不把谵妄当作可靠预言。"
    },
    "choices": [
      {
        "id": "c06_truth",
        "label": "整理一份不下结论的时间线",
        "text": "逐项比对老人言语与之后发生的事，保留无法对应之处。",
        "requiresClues": 5,
        "effects": {
          "hp": -3,
          "energy": -10,
          "trust": 2,
          "insight": 12,
          "money": 0
        },
        "ending": {
          "title": "未被划掉的问号",
          "text": "你没有找到操纵一切的手，只得到一页仍有空白的时间线。窗玻璃映出的人，终于不再像棋子。",
          "tone": "mixed"
        }
      },
      {
        "id": "c06_bond",
        "label": "给那位同事发出问候",
        "text": "把无法证实的恐惧转为一次具体、温和的关心。",
        "requiresClues": 3,
        "effects": {
          "hp": 2,
          "energy": -4,
          "trust": 12,
          "insight": 4,
          "money": -5
        },
        "ending": {
          "title": "有人回信",
          "text": "很久以后，屏幕亮起一行简短的回复。你们没有谈预言，只约好在下一次交班后一起吃饭。",
          "tone": "hope"
        }
      },
      {
        "id": "c06_rest",
        "label": "交接照护，也照看自己",
        "text": "完成记录并说明疲惫，把剩下的疑问暂时留到清醒时。",
        "requiresClues": 0,
        "effects": {
          "hp": 7,
          "energy": 9,
          "trust": 0,
          "insight": 1,
          "money": 0
        },
        "ending": {
          "title": "玻璃之外",
          "text": "你走出值班室，摸到清晨微凉的风。那个问号还在，但此刻脚下的路是真实的。",
          "tone": "mixed"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        21.5,
        40.0,
        58.5,
        77.0,
        95.5,
        114.0,
        132.5,
        151.0,
        169.5,
        188.0,
        206.5,
        224.9,
        243.4,
        261.9,
        280.4
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 11,
    "phase": "规培",
    "timelineNote": "年老者是住院患者，不是李晨光；作为训练后段的照护与不确定性事件。主角确切年龄未核实。",
    "presentation": "video",
    "timeNote": "规培 · 先照看眼前的人，再面对无法解释的话。"
  },
  {
    "id": 30,
    "title": "美玉白骨",
    "tagline": "水汽散去之后，留下的究竟是什么？",
    "sourceLabel": "原作第30章",
    "sourceSummary": "周末，仍在规培的李晨光去汤泉休息，遇见同届规培生白芍。短暂亲近使他想起感染科轮转时接触的病名，焦虑压过理智，他仓促离开。片尾以志怪方式揭示白芍的另一重身份。",
    "intro": "一周的工作终于告一段落。你在汤池边遇见白芍，聊了很久，却在靠近与退开之间失去了分寸。看完这段经历，再决定怎样回应自己的不安。",
    "objective": "分清亲近、边界与恐惧，选择如何结束这个周末。",
    "transitionIntro": "接连的轮转与夜班之后，李晨光终于有了一个休息的周末。医院外的一次偶遇，把他带进另一场难以说清的惊惶。",
    "timeNote": "规培 · 感染科轮转之后的周末；片尾为志怪揭示，不构成现实中的传播风险判断。",
    "presentation": "video",
    "video": "media/ch30.mp4",
    "poster": "assets/scenes/ch30-a.jpg",
    "clues": [],
    "sourceMetadata": {
      "fileName": "白衣志怪录_第三十章_美玉白骨_横屏.mp4",
      "sourceChapterNumber": 30,
      "narrativeOwner": "李晨光",
      "subtitlePath": "docs/source-subtitles/ch30.srt"
    },
    "sourceReview": {
      "method": "full_production_subtitles_and_sampled_video_frames",
      "subtitlePath": "docs/source-subtitles/ch30.srt"
    },
    "adaptationNote": "片尾行动及分支结局为游戏改编；源影片中的情节和片中时间跨度不预先决定玩家命运。",
    "choices": [
      {
        "id": "c30_leave",
        "label": "说明不适，先离开汤池",
        "text": "不勉强自己继续接触，也不把猜测当作对方的事实。",
        "requiresClues": 0,
        "effects": {
          "hp": 5,
          "energy": 6,
          "trust": -1,
          "insight": 2,
          "money": 0
        },
        "ending": {
          "title": "留下一句完整的话",
          "text": "你说清自己需要独处，披好浴袍走到门外。水汽还在身后，离开的决定终于不再只剩慌乱。",
          "tone": "mixed"
        }
      },
      {
        "id": "c30_boundary",
        "label": "把自己的边界说清楚",
        "text": "坦诚告诉白芍，你需要一些距离和休息。",
        "requiresClues": 0,
        "effects": {
          "hp": 3,
          "energy": 3,
          "trust": 5,
          "insight": 3,
          "money": 0
        },
        "ending": {
          "title": "池边的距离",
          "text": "你们各自坐回池边，谈话慢了下来。亲近没有被强求，安静也不再必须解释成拒绝。",
          "tone": "hope"
        }
      },
      {
        "id": "c30_reflect",
        "label": "把不安写下，暂不下结论",
        "text": "记下真正发生的事，等冷静后再处理反复出现的担心。",
        "requiresClues": 0,
        "effects": {
          "hp": 1,
          "energy": -3,
          "trust": 1,
          "insight": 7,
          "money": 0
        },
        "ending": {
          "title": "没有写满的纸",
          "text": "纸上只有你看见、听见和感受到的事情。那些来不及核实的念头留在空白处，没有变成对另一个人的判词。",
          "tone": "mixed"
        }
      }
    ],
    "gameOrder": 12,
    "phase": "规培",
    "timelineNote": "完整字幕明确白芍为同届规培生，并回忆此前感染内科轮转；安排在规培阶段后段、青年执业之前的周末。片尾志怪反转不作为现实医学事实或人物年龄变化。"
  },
  {
    "id": 5,
    "title": "系谱树说",
    "tagline": "一棵树能展示关联，不能替人作判决。",
    "sourceSummary": "抽样画面展示两名年轻男性患者与伴侣、李晨光及HIV序列和系统发生树分析。字幕明确区分遗传关联与直接传播方向，并提到沟通、知情同意和隐私保护。",
    "intro": "屏幕上的树枝渐渐成形，病房里握着的两只手仍没有松开。你握住报告边缘：有些疑问可以写进分析，有些结论不能。",
    "objective": "区分报告呈现的线索与尚不能回答的问题，决定如何沟通。",
    "clues": [
      {
        "id": "c05_1",
        "title": "相握的手",
        "text": "伴侣守在病床边，承诺与患者一起面对。",
        "room": "hospital",
        "x": 0.21,
        "y": 0.39
      },
      {
        "id": "c05_2",
        "title": "待解释的报告",
        "text": "分析结果尚未沟通，纸上没有替任何人写好罪名。",
        "room": "hospital",
        "x": 0.48,
        "y": 0.62
      },
      {
        "id": "c05_3",
        "title": "病房门帘",
        "text": "这场谈话需要一个不会被旁人随意听见的空间。",
        "room": "hospital",
        "x": 0.79,
        "y": 0.32
      },
      {
        "id": "c05_4",
        "title": "分开的树枝",
        "text": "故事中的两份序列落在相距较远的分支。",
        "room": "other",
        "x": 0.24,
        "y": 0.61
      },
      {
        "id": "c05_5",
        "title": "屏幕上的注释",
        "text": "原片强调：系统发生树不是直接宣判传播关系的判决书。",
        "room": "other",
        "x": 0.52,
        "y": 0.34
      },
      {
        "id": "c05_6",
        "title": "未填的箭头",
        "text": "你的推理板上只有关联线，传播方向一栏仍然空白。",
        "room": "other",
        "x": 0.81,
        "y": 0.55
      }
    ],
    "puzzle": {
      "question": "在本章的证据整理中，哪一项应保持为未定？",
      "options": [
        "两份样本进入过分析",
        "谁直接传给谁的具体方向",
        "画面中曾出现系统发生树"
      ],
      "correctIndex": 1,
      "explanation": "原片字幕已明确这一界限。关卡要求识别证据的范围，不把虚构病例的图形当作现实诊断或归责依据。"
    },
    "choices": [
      {
        "id": "c05_truth",
        "label": "把未知一并写进说明",
        "text": "整理证据边界，预留进一步核对的问题，再交由团队沟通。",
        "requiresClues": 5,
        "effects": {
          "hp": 0,
          "energy": -10,
          "trust": 5,
          "insight": 12,
          "money": -5
        },
        "ending": {
          "title": "没有箭头的树",
          "text": "你删掉一支无法证实的箭头。纸面似乎少了一个答案，却替病房里的两个人留下了说话的余地。",
          "tone": "hope"
        }
      },
      {
        "id": "c05_bond",
        "label": "先听两人的担忧",
        "text": "关掉走廊上的屏幕，在私下谈话中解释能知与未知。",
        "requiresClues": 3,
        "effects": {
          "hp": 0,
          "energy": -5,
          "trust": 12,
          "insight": 5,
          "money": 0
        },
        "ending": {
          "title": "门帘之后",
          "text": "报告合上后，谈话才真正开始。你没有替任何人安排原谅，只让他们各自的声音被听见。",
          "tone": "hope"
        }
      },
      {
        "id": "c05_rest",
        "label": "暂缓个人推断，完成交接",
        "text": "将材料妥善交给后续团队，不独自承担所有解释。",
        "requiresClues": 0,
        "effects": {
          "hp": 3,
          "energy": 8,
          "trust": 0,
          "insight": 2,
          "money": 0
        },
        "ending": {
          "title": "留白的报告",
          "text": "你把疑问写在交接页，而没有填进一个猜测。灯熄了一盏，未定之处仍被完整保留。",
          "tone": "mixed"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        28.7,
        54.4,
        80.1,
        105.9,
        131.6,
        157.3,
        183.0,
        208.7,
        234.4,
        260.2,
        285.9,
        311.6,
        337.3,
        363.0,
        388.7
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 13,
    "phase": "青年执业",
    "timelineNote": "以临床沟通与证据边界作为青年执业开端；本阶段仅为相对叙事安排，不声称源片证明已经完成规培。",
    "presentation": "video",
    "timeNote": "青年执业 · 一棵树能展示关联，不能替人作判决。"
  },
  {
    "id": 10,
    "title": "层外之层",
    "tagline": "最珍贵的知识，也可能带不出那扇门。",
    "sourceSummary": "抽样画面中，平日两层的图书馆出现隐秘楼层，管理员与李晨光先后接近异常空间。李晨光阅读古书后遇到空间震动，返回后书页空白、记忆消褪，仍再次寻找入口。",
    "intro": "这座图书馆只有两层，你一直这样记着。直到楼梯上方又亮起一盏灯，借书台后的人低声问：你今天数过台阶吗？",
    "objective": "辨认隐藏楼层的入口与返回后的变化，决定如何对待无法带走的知识。",
    "clues": [
      {
        "id": "c10_1",
        "title": "楼层旧图",
        "text": "公开的平面图只画着两层，楼梯却仿佛还在向上。",
        "room": "hospital",
        "x": 0.21,
        "y": 0.39
      },
      {
        "id": "c10_2",
        "title": "管理员的手电",
        "text": "光束停在从前没有出现的门缝里。",
        "room": "hospital",
        "x": 0.48,
        "y": 0.62
      },
      {
        "id": "c10_3",
        "title": "空白的书页",
        "text": "带回来的书装帧未变，内容却从纸上消失。",
        "room": "hospital",
        "x": 0.79,
        "y": 0.32
      },
      {
        "id": "c10_4",
        "title": "不在图上的楼梯",
        "text": "上方的灯光很暖，台阶伸向一个没有编号的楼层。",
        "room": "other",
        "x": 0.24,
        "y": 0.61
      },
      {
        "id": "c10_5",
        "title": "古书的低语",
        "text": "陌生书架挤满视野，书页与耳语同时向你展开。",
        "room": "other",
        "x": 0.52,
        "y": 0.34
      },
      {
        "id": "c10_6",
        "title": "褪色的记忆",
        "text": "刚读过的内容只剩零散片段，无法拼成完整答案。",
        "room": "other",
        "x": 0.81,
        "y": 0.55
      }
    ],
    "puzzle": {
      "question": "为什么“已经把书带出来”不等于已经保存了知识？",
      "options": [
        "书页变空白，相关记忆也在消褪",
        "书的封面太旧",
        "图书馆白天没有灯"
      ],
      "correctIndex": 0,
      "explanation": "带出实体、保留文字和记住内容是不同的事情。空白页与褪色记忆构成了本章的双重限制。"
    },
    "choices": [
      {
        "id": "c10_truth",
        "label": "再走一次没有编号的楼梯",
        "text": "只记录入口与变化规律，试着保留可以验证的部分。",
        "requiresClues": 5,
        "effects": {
          "hp": -5,
          "energy": -11,
          "trust": 0,
          "insight": 12,
          "money": -5
        },
        "ending": {
          "title": "台阶之外",
          "text": "你没有再试图搬走整座书库，只在掌心写下台阶的数目。醒来后墨迹仍在，数字却比记忆多了一位。",
          "tone": "dark"
        }
      },
      {
        "id": "c10_bond",
        "label": "把经历讲给管理员听",
        "text": "承认带回的是空白书，与另一个见过门的人交换记录。",
        "requiresClues": 3,
        "effects": {
          "hp": 0,
          "energy": -4,
          "trust": 11,
          "insight": 6,
          "money": 0
        },
        "ending": {
          "title": "两个见证者",
          "text": "管理员没有嘲笑空白的书。他翻开自己的旧本子，两张互不完整的地图，第一次摆在同一张桌上。",
          "tone": "hope"
        }
      },
      {
        "id": "c10_rest",
        "label": "合上书，在二层停留",
        "text": "暂时放过那道门，读完眼前能够读懂的一页。",
        "requiresClues": 0,
        "effects": {
          "hp": 6,
          "energy": 9,
          "trust": -1,
          "insight": 2,
          "money": 0
        },
        "ending": {
          "title": "可读的一页",
          "text": "你在普通书架间找到座位。没有低语，没有金色门缝；这一页的知识很小，却安稳地留在了纸上。",
          "tone": "mixed"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        29.2,
        55.4,
        81.6,
        107.8,
        134.0,
        160.3,
        186.5,
        212.7,
        238.9,
        265.1,
        291.3,
        317.5,
        343.7,
        369.9,
        396.1
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 14,
    "phase": "青年执业",
    "timelineNote": "按持续学习主题安排于已有医院工作经验之后；隐秘楼层和消褪记忆是异界情节，没有现实年岁跃迁证据。",
    "presentation": "video",
    "timeNote": "青年执业 · 最珍贵的知识，也可能带不出那扇门。"
  },
  {
    "id": 9,
    "title": "白薯报恩",
    "tagline": "一份热饭，能暂时把人从纸堆里找回来。",
    "sourceSummary": "抽样画面中，白发的白薯为疲惫的李晨光送饭、协助整理并在家中做饭；他熬夜后难以维持人形，身份与一只白鼠相联系。显露身份后白薯离去，李晨光再次独自工作。",
    "intro": "你说只想休息五分钟，桌边却先放下了一只热饭盒。白发来客自称白薯，仿佛记得一桩被你忘记的小事。",
    "objective": "找出报恩的来处，并决定怎样回应这份陪伴。",
    "clues": [
      {
        "id": "c09_1",
        "title": "热饭盒",
        "text": "饭菜的热气遮住了屏幕，提醒你还没有吃晚饭。",
        "room": "hospital",
        "x": 0.21,
        "y": 0.39
      },
      {
        "id": "c09_2",
        "title": "并排的笔迹",
        "text": "有人陪着整理桌面；病历和研究仍需你亲自负责。",
        "room": "hospital",
        "x": 0.48,
        "y": 0.62
      },
      {
        "id": "c09_3",
        "title": "空下来的椅子",
        "text": "天亮后的座位只留下被收好的筷子。",
        "room": "hospital",
        "x": 0.79,
        "y": 0.32
      },
      {
        "id": "c09_4",
        "title": "消散的人形",
        "text": "熬过一夜后，白薯说法力已不足以维持完整人形。",
        "room": "other",
        "x": 0.24,
        "y": 0.61
      },
      {
        "id": "c09_5",
        "title": "实验室的白鼠",
        "text": "回忆中的小小白鼠，使眼前人的名字有了另一层意思。",
        "room": "other",
        "x": 0.52,
        "y": 0.34
      },
      {
        "id": "c09_6",
        "title": "未说完的告别",
        "text": "显露身份后，白薯的身影渐淡，饭盒仍留在桌上。",
        "room": "other",
        "x": 0.81,
        "y": 0.55
      }
    ],
    "puzzle": {
      "question": "哪条线索把白薯的来访与“报恩”连在一起？",
      "options": [
        "饭盒的颜色",
        "窗外城市的灯光",
        "实验室白鼠的回忆与他的身份显露"
      ],
      "correctIndex": 2,
      "explanation": "白鼠回忆与白薯形貌变化共同构成叙事呼应。游戏中的物品搜集和告别选项属于新增改编。"
    },
    "choices": [
      {
        "id": "c09_truth",
        "label": "找回那次相遇的细节",
        "text": "去实验室核对自己的记忆，再回来听他讲完。",
        "requiresClues": 5,
        "effects": {
          "hp": -3,
          "energy": -9,
          "trust": 5,
          "insight": 11,
          "money": 0
        },
        "ending": {
          "title": "名字有了来处",
          "text": "你终于想起那一团微小的白色。原来被自己略过的一瞬，会在另一个生命那里成为漫长的记忆。",
          "tone": "hope"
        }
      },
      {
        "id": "c09_bond",
        "label": "请他也坐下来吃饭",
        "text": "停止把陪伴当作无限的帮助，让送饭的人也得到休息。",
        "requiresClues": 3,
        "effects": {
          "hp": 4,
          "energy": -3,
          "trust": 12,
          "insight": 4,
          "money": -10
        },
        "ending": {
          "title": "两份碗筷",
          "text": "你又摆出一副碗筷。白薯愣了片刻，坐到灯下；这顿饭终于不再只为了让你更快回到工作。",
          "tone": "hope"
        }
      },
      {
        "id": "c09_rest",
        "label": "道谢后一起收起桌面",
        "text": "不再追问法术与旧事，先结束这一夜的工作。",
        "requiresClues": 0,
        "effects": {
          "hp": 7,
          "energy": 10,
          "trust": 2,
          "insight": 1,
          "money": -5
        },
        "ending": {
          "title": "关灯之前",
          "text": "你把饭盒洗好，放在靠窗的位置。来客是否还会出现尚未可知，但今晚的灯已经可以关了。",
          "tone": "mixed"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        24.5,
        46.1,
        67.6,
        89.1,
        110.7,
        132.2,
        153.7,
        175.3,
        196.8,
        218.4,
        239.9,
        261.4,
        283.0,
        304.5,
        326.0
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 15,
    "phase": "青年执业",
    "timelineNote": "置于工作负担逐渐加重、需要生活支持的阶段；白薯白发是该角色造型，不能据此判断李晨光已老。",
    "presentation": "video",
    "timeNote": "青年执业 · 一份热饭，能暂时把人从纸堆里找回来。"
  },
  {
    "id": 19,
    "title": "家猫难当",
    "tagline": "愿意留下，不等于属于谁。",
    "sourceSummary": "李晨光与白猫、灰猫及其拟人形象相处，故事呈现居家关系、猫爬架和兽医咨询。后段出现流浪猫照护与金猫妖对幻想的调侃；素材包含拟人化表达，不能视为真实动物处置指南。",
    "intro": "白猫把新买的爬架让给灰猫，回头却问你为何总是晚归。温柔的屋子忽然塞满了没有说出口的期待，你需要重新划清照顾与占有。",
    "objective": "找到猫、家人与照顾者各自的需要，决定这个家如何继续。",
    "clues": [
      {
        "id": "c19_1",
        "title": "加班消息",
        "text": "你发出的每句“快回家了”都比上一次更晚。",
        "room": "hospital",
        "x": 0.22,
        "y": 0.31
      },
      {
        "id": "c19_2",
        "title": "兽医预约",
        "text": "咨询记录留下了待讨论的选择，没有替任何人决定。",
        "room": "hospital",
        "x": 0.49,
        "y": 0.5
      },
      {
        "id": "c19_3",
        "title": "照护清单",
        "text": "喂养、陪伴与日常安排都需要真实的人手和时间。",
        "room": "hospital",
        "x": 0.77,
        "y": 0.34
      },
      {
        "id": "c19_4",
        "title": "双层猫架",
        "text": "两层都晒得到太阳，谁也不必抢占唯一的高处。",
        "room": "other",
        "x": 0.23,
        "y": 0.6
      },
      {
        "id": "c19_5",
        "title": "白猫的留白",
        "text": "白猫画出了自己的小窝，也给灰猫留了一扇门。",
        "room": "other",
        "x": 0.51,
        "y": 0.3
      },
      {
        "id": "c19_6",
        "title": "金猫妖的笑话",
        "text": "笑话戳破“被需要就必须拥有”的想象，街边的碗仍等着水。",
        "room": "other",
        "x": 0.78,
        "y": 0.62
      }
    ],
    "puzzle": {
      "question": "怎样的安排更能回应这间屋子的矛盾？",
      "options": [
        "把所有选择都交给最忙的人",
        "让依赖者始终争夺唯一的位置",
        "分清需要、界限与可承担的照护"
      ],
      "correctIndex": 2,
      "explanation": "猫架、留白和照护清单提示：共同生活需要空间与分工，靠独占无法补足时间。"
    },
    "choices": [
      {
        "id": "c19_share",
        "label": "重新商量这个家的边界",
        "text": "把承诺写成可承担的安排，尊重每个角色的空间。",
        "requiresClues": 5,
        "effects": {
          "trust": 4,
          "insight": 2,
          "money": -15,
          "energy": -3
        },
        "ending": {
          "title": "门仍开着",
          "text": "你添了一只水碗，也删去了一句无法兑现的承诺。这个家没有变得完美，却终于容得下彼此。",
          "tone": "hope"
        }
      },
      {
        "id": "c19_help",
        "label": "请人分担照护",
        "text": "承认独自照顾不过来，先安排可靠的支持。",
        "requiresClues": 0,
        "effects": {
          "hp": 5,
          "energy": 8,
          "money": -25,
          "trust": 1
        },
        "ending": {
          "title": "有人看顾的窗台",
          "text": "今晚又要值班，窗台却有人替你守着。你开始明白，求助也可以是一种认真。",
          "tone": "mixed"
        }
      },
      {
        "id": "c19_own",
        "label": "坚持自己拥有最终决定权",
        "text": "把所有安排都写成命令，以为秩序就是亲近。",
        "requiresClues": 3,
        "effects": {
          "trust": -4,
          "insight": -1,
          "energy": -6
        },
        "ending": {
          "title": "整齐的空房间",
          "text": "猫架和碗都留在原处，房间比从前整齐。你叫了几声名字，只有自己的声音回答。",
          "tone": "dark"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        45.2,
        87.5,
        129.7,
        172.0,
        214.2,
        256.4,
        298.7,
        340.9,
        383.1,
        425.4,
        467.6,
        509.9,
        552.1,
        594.3,
        636.6
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 16,
    "phase": "青年执业",
    "timelineNote": "先建立与猫的居家关系，再进入猫照顾生病主人的源22；先后为关系连续性的改编，不声称两片已有明确日期。",
    "presentation": "video",
    "timeNote": "青年执业 · 愿意留下，不等于属于谁。"
  },
  {
    "id": 22,
    "title": "猫为人主",
    "tagline": "当你病倒，谁才是这个家的主人？",
    "sourceSummary": "李晨光生病后，猫为他做饭、清洗餐具，并与猫友通话谈论照顾人类。病愈后，他看着恢复普通模样的猫，对往事仍存疑惑。",
    "intro": "病后的那碗热汤让你恢复了一些力气，电话却传来一句“我家人类又病了”。你循着汤香与铃声，寻找这场照顾的真相。",
    "objective": "辨认猫留下的照料痕迹，并决定如何回应这份关系。",
    "roomNames": {
      "hospital": "医院·休息角",
      "other": "异界·猫的客厅"
    },
    "clues": [
      {
        "id": "c22_1",
        "title": "休息申请",
        "text": "你终于写下“需要休息”，没有再把这一栏留白。",
        "room": "hospital",
        "x": 0.2,
        "y": 0.32
      },
      {
        "id": "c22_2",
        "title": "未接来电",
        "text": "工作通知排成一列，家中的号码却只留下了一声轻响。",
        "room": "hospital",
        "x": 0.51,
        "y": 0.6
      },
      {
        "id": "c22_3",
        "title": "饮食便笺",
        "text": "纸条把简单的一餐分成几步，角落沾着细小爪印。",
        "room": "hospital",
        "x": 0.8,
        "y": 0.35
      },
      {
        "id": "c22_4",
        "title": "温热汤碗",
        "text": "汤已经放到伸手可及的位置，旁边还有一杯水。",
        "room": "other",
        "x": 0.18,
        "y": 0.58
      },
      {
        "id": "c22_5",
        "title": "洗净餐具",
        "text": "碗盘被摆得整齐，水池边有尚未干透的脚印。",
        "room": "other",
        "x": 0.5,
        "y": 0.28
      },
      {
        "id": "c22_6",
        "title": "猫友通话",
        "text": "电话记录里，两只猫认真讨论着脆弱又忙碌的人类。",
        "room": "other",
        "x": 0.82,
        "y": 0.6
      }
    ],
    "puzzle": {
      "question": "哪组线索更支持“猫曾主动照料你”，而不只是你的愿望？",
      "options": [
        "汤碗、洗净餐具和通话记录彼此呼应",
        "猫一直躺在太阳下",
        "你平时喜欢这只猫"
      ],
      "correctIndex": 0,
      "explanation": "相互独立的生活痕迹形成同一条照料链；喜爱与猜想本身不能代替这些痕迹。"
    },
    "choices": [
      {
        "id": "c22_forget",
        "label": "把异象当成病中梦境",
        "text": "收好碗筷，继续原来的日程。",
        "requiresClues": 0,
        "effects": {
          "hp": 2,
          "energy": 3,
          "trust": 0,
          "insight": 0,
          "money": 0
        },
        "ending": {
          "title": "一声普通的喵",
          "text": "猫重新趴回窗边。你回到了熟悉的忙碌，那碗汤的来历没有再被提起。",
          "tone": "mixed"
        }
      },
      {
        "id": "c22_observe",
        "label": "悄悄保留这份秘密",
        "text": "留意它的需要，也把休息写进行程。",
        "requiresClues": 3,
        "effects": {
          "hp": 8,
          "energy": 5,
          "trust": 2,
          "insight": 2,
          "money": -5
        },
        "ending": {
          "title": "窗边的默契",
          "text": "你没有揭穿猫。每天多留的一点陪伴，让这个家不再只等待深夜的钥匙声。",
          "tone": "hope"
        }
      },
      {
        "id": "c22_equal",
        "label": "认真说一声谢谢",
        "text": "承认自己也需要照顾，重新商量这个家的生活。",
        "requiresClues": 5,
        "effects": {
          "hp": 10,
          "energy": 6,
          "trust": 4,
          "insight": 3,
          "money": -10
        },
        "ending": {
          "title": "互为家人",
          "text": "猫没有回答，只把爪子搭在你手上。你决定学会照顾它，也接受自己被照顾。",
          "tone": "hope"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        19.78,
        36.56,
        53.34,
        70.12,
        86.9,
        103.68,
        120.46,
        137.24,
        154.02,
        170.8,
        187.58,
        204.36,
        221.14,
        237.92,
        254.7
      ],
      "fullResolutionFrames": []
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 17,
    "phase": "青年执业",
    "timelineNote": "承接源19的居家关系；病中与病愈属于本章短期过程，没有退休或晚年证据，不能把生病等同年老。",
    "presentation": "video",
    "timeNote": "青年执业 · 当你病倒，谁才是这个家的主人？"
  },
  {
    "id": 13,
    "title": "钱有定数",
    "tagline": "天平称得出报酬，称不出沉默。",
    "sourceSummary": "李晨光因收入差异产生疑问，梦中遇见两位持钱币、天平的古装人物。字幕讨论收入与所谓“定数”，同时标明梦境寓言并非现实分配正当性的证明；醒后重新投入临床工作。",
    "intro": "工资单还没看完，走廊已变作雾中的衙门。两位持秤者说一切自有定数，你却看见秤盘下面压着一张没有署名的工时表。",
    "objective": "核对报酬、劳动和天平的六条线索，选择如何回应“定数”。",
    "clues": [
      {
        "id": "c13_1",
        "title": "工资单",
        "text": "纸上列着金额，没有写明每项工作的时间与责任。",
        "room": "hospital",
        "x": 0.22,
        "y": 0.31
      },
      {
        "id": "c13_2",
        "title": "工时表",
        "text": "姓名被折在背面，许多额外工作尚未被记录。",
        "room": "hospital",
        "x": 0.49,
        "y": 0.5
      },
      {
        "id": "c13_3",
        "title": "带教批注",
        "text": "有价值的指导留在页边，与工资项目不是同一栏。",
        "room": "hospital",
        "x": 0.77,
        "y": 0.34
      },
      {
        "id": "c13_4",
        "title": "双面钱币",
        "text": "钱币一面刻着“所得”，另一面刻着“应得”，两面并不相同。",
        "room": "other",
        "x": 0.23,
        "y": 0.6
      },
      {
        "id": "c13_5",
        "title": "失衡的秤盘",
        "text": "一侧放钱，一侧放影子；秤从未真正称量劳动。",
        "room": "other",
        "x": 0.51,
        "y": 0.3
      },
      {
        "id": "c13_6",
        "title": "定数告示",
        "text": "告示没有署名，也没有说明它如何得出结论。",
        "room": "other",
        "x": 0.78,
        "y": 0.62
      }
    ],
    "puzzle": {
      "question": "梦里的天平最缺少什么？",
      "options": [
        "更多金币",
        "一条令人安心的神谕",
        "可核对的劳动与分配依据"
      ],
      "correctIndex": 2,
      "explanation": "金额、指导和劳动记录属于不同信息；没有依据的“定数”无法解释它们的差异。"
    },
    "choices": [
      {
        "id": "c13_document",
        "label": "留下可核对的记录",
        "text": "与同伴整理工时和分配依据，保留继续讨论的可能。",
        "requiresClues": 5,
        "effects": {
          "energy": -5,
          "trust": 3,
          "insight": 3
        },
        "ending": {
          "title": "账本之外",
          "text": "你走出雾衙，手里多了一本真实的工时记录。天平仍在，却不再替你决定什么值得被问。",
          "tone": "hope"
        }
      },
      {
        "id": "c13_today",
        "label": "先把今天过完",
        "text": "把疑问记下，暂不在梦里寻求裁决。",
        "requiresClues": 0,
        "effects": {
          "hp": 5,
          "energy": 6,
          "insight": 1
        },
        "ending": {
          "title": "把疑问折好",
          "text": "你把告示折进笔记本，回到病房。问题尚未解决，但你保住了继续追问的力气。",
          "tone": "mixed"
        }
      },
      {
        "id": "c13_destiny",
        "label": "接受一切早已注定",
        "text": "交出工时表，换取持秤者许诺的平静。",
        "requiresClues": 3,
        "effects": {
          "energy": 8,
          "trust": -2,
          "insight": -2
        },
        "ending": {
          "title": "不再发问的人",
          "text": "天平终于静止，因为你不再往秤上放任何证据。雾中安静得听不见自己的脚步。",
          "tone": "dark"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        17.8,
        32.6,
        47.4,
        62.2,
        77.0,
        91.8,
        106.6,
        121.4,
        136.2,
        151.0,
        165.8,
        180.6,
        195.5,
        210.3,
        225.1
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 18,
    "phase": "青年执业",
    "timelineNote": "将收入比较放在日常工作经验积累后；持钱币与天平的人物出现在梦中，梦境定数不作为现实年代或必然命运。",
    "presentation": "video",
    "timeNote": "青年执业 · 天平称得出报酬，称不出沉默。"
  },
  {
    "id": 16,
    "title": "蟋蟀斗趣",
    "tagline": "看见金笼之后，还要彼此争斗吗？",
    "sourceSummary": "李晨光与同事张一凡围绕待遇和工作发生争执，随后一同坠入巨大的金色容器及观众包围的异境。他们意识到争斗被观看，后段回到现实与同事共同讨论规则和差异。",
    "intro": "你与张一凡争到一半，桌面忽然倾斜。两人落进一只金色小罐，头顶传来笑声——原来有人一直等着你们互相扑咬。",
    "objective": "比较两人的记录与金罐中的机关，找到争执背后的观看者。",
    "clues": [
      {
        "id": "c16_1",
        "title": "两张待遇表",
        "text": "数字确有差别，表格却没有说明差别怎样形成。",
        "room": "hospital",
        "x": 0.22,
        "y": 0.31
      },
      {
        "id": "c16_2",
        "title": "共同任务单",
        "text": "争执双方承担着重叠的工作，名字写在同一张纸上。",
        "room": "hospital",
        "x": 0.49,
        "y": 0.5
      },
      {
        "id": "c16_3",
        "title": "张一凡的批注",
        "text": "他抱怨的句子里，有几句与你昨夜写下的一样。",
        "room": "hospital",
        "x": 0.77,
        "y": 0.34
      },
      {
        "id": "c16_4",
        "title": "金罐边缘",
        "text": "罐壁光滑，向对方冲撞只会让两人一起滑回底部。",
        "room": "other",
        "x": 0.23,
        "y": 0.6
      },
      {
        "id": "c16_5",
        "title": "看台笑声",
        "text": "笑声在争吵时变响，在两人交谈时渐渐停下。",
        "room": "other",
        "x": 0.51,
        "y": 0.3
      },
      {
        "id": "c16_6",
        "title": "牵动的金线",
        "text": "金线连着两张待遇表，却通向同一处高台。",
        "room": "other",
        "x": 0.78,
        "y": 0.62
      }
    ],
    "puzzle": {
      "question": "怎样的行动最能让看台失去兴趣？",
      "options": [
        "比同伴叫得更响",
        "共同核对规则并寻找出口",
        "证明对方比自己更弱"
      ],
      "correctIndex": 1,
      "explanation": "共同任务、相似批注和同源金线都指向同一处；彼此争斗正是看台期待的表演。"
    },
    "choices": [
      {
        "id": "c16_together",
        "label": "与张一凡一起找出口",
        "text": "交换记录，约定把问题带回公开讨论。",
        "requiresClues": 5,
        "effects": {
          "trust": 4,
          "insight": 3,
          "energy": -4
        },
        "ending": {
          "title": "罐外同路",
          "text": "你们踩着对方递来的手越过罐口。回到办公室时，那两张表第一次并排放在桌上。",
          "tone": "hope"
        }
      },
      {
        "id": "c16_truce",
        "label": "先停战，保留距离",
        "text": "停止争吵，分别保存自己的记录。",
        "requiresClues": 0,
        "effects": {
          "hp": 5,
          "energy": 6,
          "trust": 1
        },
        "ending": {
          "title": "没有掌声的休场",
          "text": "看台灯光暗了。你们尚未成为朋友，但终于不再为观众的笑声继续受伤。",
          "tone": "mixed"
        }
      },
      {
        "id": "c16_win",
        "label": "继续争出唯一的赢家",
        "text": "试图让高台承认自己才配离开。",
        "requiresClues": 3,
        "effects": {
          "hp": -8,
          "energy": -8,
          "trust": -3,
          "money": 15
        },
        "ending": {
          "title": "冠军的金罐",
          "text": "高台给你一枚奖章，又换来一只更亮的罐子。张一凡的身影消失后，笑声仍未停。",
          "tone": "dark"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        29.2,
        55.3,
        81.5,
        107.7,
        133.8,
        160.0,
        186.2,
        212.4,
        238.5,
        264.7,
        290.9,
        317.0,
        343.2,
        369.4,
        395.5
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 19,
    "phase": "青年执业",
    "timelineNote": "承接待遇差异，发展到同事竞争与共同讨论；金色容器为异境，不表示真实职位或年龄改变。",
    "presentation": "video",
    "timeNote": "青年执业 · 看见金笼之后，还要彼此争斗吗？"
  },
  {
    "id": 7,
    "title": "身份互换",
    "tagline": "羡慕的那个人，也藏着看不见的疲惫。",
    "sourceSummary": "抽样画面中，李晨光与年轻的沈亦航互相羡慕，随后交换身体，体验对方在临床、训练、学业与社交中的压力；两人在理解加深后恢复原来的身体。",
    "intro": "镜中那张脸属于沈亦航。桌上的日程、衣袋里的工牌、突然变近的手术台，都在提醒你：羡慕从来没有附带使用说明。",
    "objective": "比较两份生活留下的痕迹，决定交换结束前留下些什么。",
    "clues": [
      {
        "id": "c07_1",
        "title": "互换的工牌",
        "text": "名字与镜中面容对不上，今天的任务却照常开始。",
        "room": "hospital",
        "x": 0.21,
        "y": 0.39
      },
      {
        "id": "c07_2",
        "title": "椅边的脚凳",
        "text": "在对方的身体里，连熟悉的工作台高度都发生了变化。",
        "room": "hospital",
        "x": 0.48,
        "y": 0.62
      },
      {
        "id": "c07_3",
        "title": "排满的日程",
        "text": "看似光鲜的生活被训练、研究、合唱和应酬填满。",
        "room": "hospital",
        "x": 0.79,
        "y": 0.32
      },
      {
        "id": "c07_4",
        "title": "双面的镜子",
        "text": "金与蓝两道光映在镜面，彼此的疲惫第一次清晰。",
        "room": "other",
        "x": 0.24,
        "y": 0.61
      },
      {
        "id": "c07_5",
        "title": "未说出口的羡慕",
        "text": "一人想要青春与机会，一人羡慕效率与经验。",
        "room": "other",
        "x": 0.52,
        "y": 0.34
      },
      {
        "id": "c07_6",
        "title": "桌旁的长谈",
        "text": "交换越久，两人越能看见对方藏起来的伤口。",
        "room": "other",
        "x": 0.81,
        "y": 0.55
      }
    ],
    "puzzle": {
      "question": "两份日程拼在一起后，最需要修正的是哪一个判断？",
      "options": [
        "对方的生活只有自己想要的优点",
        "两人确实承担不同的任务",
        "交换使平时看不到的压力显现"
      ],
      "correctIndex": 0,
      "explanation": "日程、身体差异与长谈共同推翻了单面的想象。身份交换并没有把另一个人的生活变得简单。"
    },
    "choices": [
      {
        "id": "c07_truth",
        "label": "完整体验彼此最难的一天",
        "text": "共同记录压力从何而来，把羡慕拆成具体问题。",
        "requiresClues": 5,
        "effects": {
          "hp": -4,
          "energy": -10,
          "trust": 6,
          "insight": 12,
          "money": 0
        },
        "ending": {
          "title": "镜面后的日程",
          "text": "恢复原貌以后，你仍会羡慕他，却不再把他的笑容当作全部生活。两份日程被订在了同一个本子里。",
          "tone": "hope"
        }
      },
      {
        "id": "c07_bond",
        "label": "约定互相分担一件小事",
        "text": "在换回之前说出真实困难，只作能够兑现的承诺。",
        "requiresClues": 3,
        "effects": {
          "hp": 3,
          "energy": -3,
          "trust": 12,
          "insight": 5,
          "money": -5
        },
        "ending": {
          "title": "两张并排的椅子",
          "text": "交换结束，椅子没有再分开。有人替你留了一份热饭，你也记得在他沉默时问一句是否需要帮忙。",
          "tone": "hope"
        }
      },
      {
        "id": "c07_rest",
        "label": "承认不适应，提前换回",
        "text": "停止用一次交换证明自己，保留身体与精力。",
        "requiresClues": 0,
        "effects": {
          "hp": 7,
          "energy": 9,
          "trust": -2,
          "insight": 2,
          "money": 0
        },
        "ending": {
          "title": "熟悉的重量",
          "text": "工牌重新贴回胸口。你没有走完他的全部生活，但已经知道自己的疲惫不必靠贬低别人来解释。",
          "tone": "mixed"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        36.1,
        69.2,
        102.3,
        135.4,
        168.5,
        201.6,
        234.7,
        267.8,
        300.9,
        334.0,
        367.1,
        400.2,
        433.3,
        466.4,
        499.5
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 20,
    "phase": "青年执业",
    "timelineNote": "李晨光与更年轻同伴互相羡慕，交换身体后仍恢复原身；片段提示培养路径及基础训练压力，不能把他安排成已退休导师。交换不是现实回龄。",
    "presentation": "video",
    "timeNote": "青年执业 · 羡慕的那个人，也藏着看不见的疲惫。"
  },
  {
    "id": 17,
    "title": "异常维度",
    "tagline": "看见的边界，也需要被记录。",
    "sourceSummary": "李晨光经历眼部受伤及处理后，出现异常视觉体验，并在眼科评估场景中与医生讨论可能原因。异界生物、空间裂隙和记录研究与现实检查交替出现，片段保留超自然疑问而非确证其医学原因。",
    "intro": "窗边的影子没有随光线移动。它像另一间房的访客，从你的视野边缘缓缓经过。你需要弄清它何时出现，也需要保住回到现实的路。",
    "objective": "分别收集现实记录与异界痕迹，建立可以反复核对的观察边界。",
    "clues": [
      {
        "id": "c17_1",
        "title": "复查单",
        "text": "检查记录描述了能够观察的变化，没有解释所有异象。",
        "room": "hospital",
        "x": 0.22,
        "y": 0.31
      },
      {
        "id": "c17_2",
        "title": "观察日记",
        "text": "异象的时间被记下，疲惫程度和所在位置也各占一栏。",
        "room": "hospital",
        "x": 0.49,
        "y": 0.5
      },
      {
        "id": "c17_3",
        "title": "相机回放",
        "text": "影像与记忆并不完全一致，差异本身需要保留。",
        "room": "hospital",
        "x": 0.77,
        "y": 0.34
      },
      {
        "id": "c17_4",
        "title": "透明访客",
        "text": "它沿着自己的路线经过，没有回应你的呼喊。",
        "room": "other",
        "x": 0.23,
        "y": 0.6
      },
      {
        "id": "c17_5",
        "title": "窗边裂隙",
        "text": "裂隙看似靠近，却没有留下可供另一人触摸的边缘。",
        "room": "other",
        "x": 0.51,
        "y": 0.3
      },
      {
        "id": "c17_6",
        "title": "回程灯标",
        "text": "灯标同时记录时刻和所在房间，帮助你辨认返程。",
        "room": "other",
        "x": 0.78,
        "y": 0.62
      }
    ],
    "puzzle": {
      "question": "哪份记录最有助于辨认异常出现的条件？",
      "options": [
        "只写最惊险的一次经历",
        "把所有影子都命名为怪物",
        "同时保留时刻、状态、位置及不一致之处"
      ],
      "correctIndex": 2,
      "explanation": "日记、回放与灯标可相互核对；本章需要识别条件，而非急着替未知下结论。"
    },
    "choices": [
      {
        "id": "c17_boundary",
        "label": "建立观察边界",
        "text": "继续必要的现实评估，把异象记录交给可信的人保管。",
        "requiresClues": 5,
        "effects": {
          "trust": 2,
          "insight": 4,
          "energy": -3
        },
        "ending": {
          "title": "窗边的见证者",
          "text": "访客依旧偶尔经过。你为窗边留了一盏灯，也为自己留下了能被他人找到的地址。",
          "tone": "hope"
        }
      },
      {
        "id": "c17_close",
        "label": "暂时远离裂隙",
        "text": "停止主动追踪，返回熟悉的生活节奏。",
        "requiresClues": 0,
        "effects": {
          "hp": 10,
          "energy": 10,
          "insight": 1
        },
        "ending": {
          "title": "把窗关上",
          "text": "帘子落下，房间重新有了边界。你仍不知道那是什么，但今晚可以先睡一觉。",
          "tone": "mixed"
        }
      },
      {
        "id": "c17_follow",
        "label": "独自追随透明访客",
        "text": "舍弃返程标记，试图一次走到裂隙尽头。",
        "requiresClues": 3,
        "effects": {
          "hp": -8,
          "energy": -10,
          "trust": -2,
          "insight": 2
        },
        "ending": {
          "title": "另一边的走廊",
          "text": "你发现了更多房间，却无法证明哪一扇门通向原来的世界。远处的灯越来越像陌生的眼睛。",
          "tone": "dark"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        36.6,
        70.1,
        103.7,
        137.3,
        170.8,
        204.4,
        238.0,
        271.6,
        305.1,
        338.7,
        372.3,
        405.8,
        439.4,
        473.0,
        506.5
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 21,
    "phase": "青年执业",
    "timelineNote": "现实眼部事件与检查作为健康线起点；异界裂隙与异常视觉不作经过多年或超自然病因的确证。",
    "presentation": "video",
    "timeNote": "青年执业 · 看见的边界，也需要被记录。"
  },
  {
    "id": 18,
    "title": "健康晴雨",
    "tagline": "黄宁递来一杯茶，也递来一个疑问。",
    "sourceSummary": "黄宁以星盘语言与李晨光谈论眼前状态和财运。片段同时呈现疲劳、波动的手机图表、眼科咨询与调整作息，明确将星盘作为寓言并强调现实风险判断。",
    "intro": "黄宁把茶推到你手边，笑说星盘上的晴雨也许会落进眼睛。手机行情仍在跳动，你必须分清哪种声音值得此刻回应。",
    "objective": "核对身体状态、决策记录和星盘寓言，找到可以实际改变的环节。",
    "clues": [
      {
        "id": "c18_1",
        "title": "未喝完的茶",
        "text": "黄宁问了三次要不要休息，你始终盯着屏幕。",
        "room": "hospital",
        "x": 0.22,
        "y": 0.31
      },
      {
        "id": "c18_2",
        "title": "夜间记录",
        "text": "最冲动的几笔决定都挤在睡眠不足的夜里。",
        "room": "hospital",
        "x": 0.49,
        "y": 0.5
      },
      {
        "id": "c18_3",
        "title": "预约便签",
        "text": "便签上只有一次现实的约定，没有预测未来的数字。",
        "room": "hospital",
        "x": 0.77,
        "y": 0.34
      },
      {
        "id": "c18_4",
        "title": "星盘上的眼睛",
        "text": "图案把健康与财富画在一起，却没有画出因果之桥。",
        "room": "other",
        "x": 0.23,
        "y": 0.6
      },
      {
        "id": "c18_5",
        "title": "红蓝潮汐",
        "text": "潮汐同时涨落，不能单凭相似节奏确定谁推动了谁。",
        "room": "other",
        "x": 0.51,
        "y": 0.3
      },
      {
        "id": "c18_6",
        "title": "黄宁的空白页",
        "text": "他留下一页没有星象的纸，等你写能亲自执行的安排。",
        "room": "other",
        "x": 0.78,
        "y": 0.62
      }
    ],
    "puzzle": {
      "question": "哪项发现足以支持现在先暂停决定？",
      "options": [
        "星盘保证明天一定转运",
        "你已疲倦，判断记录也出现反复",
        "两个图案使用了同一种颜色"
      ],
      "correctIndex": 1,
      "explanation": "夜间记录和未喝完的茶提供了当下可观察的状态；星盘与颜色只构成本章的寓言。"
    },
    "choices": [
      {
        "id": "c18_care",
        "label": "先照顾自己，再决定",
        "text": "关掉行情提醒，履行现实约定，并给黄宁回一条消息。",
        "requiresClues": 5,
        "effects": {
          "hp": 12,
          "energy": 12,
          "trust": 3,
          "insight": 2,
          "money": -10
        },
        "ending": {
          "title": "晴雨自知",
          "text": "黄宁合上星盘。第二天的天气并未因你而变，但你终于有余力决定是否带伞。",
          "tone": "hope"
        }
      },
      {
        "id": "c18_wait",
        "label": "给自己一个暂停键",
        "text": "暂缓重要决定，保存记录以后再看。",
        "requiresClues": 0,
        "effects": {
          "hp": 6,
          "energy": 8,
          "insight": 1
        },
        "ending": {
          "title": "未下注的夜晚",
          "text": "手机静了下来。你没有赢回所有损失，却保留了下一次清醒选择的机会。",
          "tone": "mixed"
        }
      },
      {
        "id": "c18_sign",
        "label": "等待星象替你决定",
        "text": "把每次波动都解释成预兆，继续追逐下一次翻转。",
        "requiresClues": 3,
        "effects": {
          "hp": -6,
          "energy": -10,
          "money": -20,
          "insight": -1
        },
        "ending": {
          "title": "永不放晴的屏幕",
          "text": "黄宁的茶凉透了。你记住了每一种预兆，却忘记上一次安稳入睡是什么时候。",
          "tone": "dark"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        34.3,
        65.6,
        96.9,
        128.2,
        159.5,
        190.7,
        222.0,
        253.3,
        284.6,
        315.9,
        347.2,
        378.5,
        409.8,
        441.1,
        472.4
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 22,
    "phase": "青年执业",
    "timelineNote": "眼科咨询与作息调整和源17形成健康主题连续性；相邻是改编组织，不断言两片疾病因果。星盘是角色寓言。",
    "presentation": "video",
    "timeNote": "青年执业 · 黄宁递来一杯茶，也递来一个疑问。"
  },
  {
    "id": 26,
    "title": "夜班镜妖",
    "tagline": "镜中人比你早一步抬起了手。",
    "sourceSummary": "夜班中的李晨光逐渐发现镜中影像与自己不同步，遮挡镜子与拍摄也未能消除异象。同事把经历归为疲惫，后来镜中分身伸手将他拉入镜面。",
    "intro": "夜班的走廊安静下来，你停步时，镜中的白衣却继续向前。手机屏幕只映出空荡的房间。先确认自己看到的，再决定要不要靠近。",
    "objective": "比对镜面与现实的差异，寻找安全离开的办法。",
    "roomNames": {
      "hospital": "医院·夜班走廊",
      "other": "异界·镜中病房"
    },
    "clues": [
      {
        "id": "c26_1",
        "title": "值班时钟",
        "text": "你记下异象发生的时刻，几次记录都落在连续忙碌之后。",
        "room": "hospital",
        "x": 0.2,
        "y": 0.32
      },
      {
        "id": "c26_2",
        "title": "手机照片",
        "text": "照片里只剩普通倒影，与当时目击的动作不一致。",
        "room": "hospital",
        "x": 0.51,
        "y": 0.6
      },
      {
        "id": "c26_3",
        "title": "同伴回应",
        "text": "有人认为是疲惫。你可以请求陪同，而不必独自证明一切。",
        "room": "hospital",
        "x": 0.8,
        "y": 0.35
      },
      {
        "id": "c26_4",
        "title": "迟滞倒影",
        "text": "你放下手，镜中的手却停在半空，随后才缓缓落下。",
        "room": "other",
        "x": 0.18,
        "y": 0.58
      },
      {
        "id": "c26_5",
        "title": "遮镜黑布",
        "text": "布后仍有轻响，遮挡没有让异常彻底终止。",
        "room": "other",
        "x": 0.5,
        "y": 0.28
      },
      {
        "id": "c26_6",
        "title": "镜缘冷光",
        "text": "分身靠近边缘时，光线向现实一侧延伸。距离正在缩短。",
        "room": "other",
        "x": 0.82,
        "y": 0.6
      }
    ],
    "puzzle": {
      "question": "结合这些线索，哪种判断更可靠？",
      "options": [
        "手机没有拍到，所以可以独自触碰镜面",
        "倒影动作异常，照片不能排除危险，应保持距离并寻求陪同",
        "只要用布遮住镜子就永远安全"
      ],
      "correctIndex": 1,
      "explanation": "多次动作差异与遮挡后的异常需要共同考虑；单张照片或遮布都不足以证明安全。"
    },
    "choices": [
      {
        "id": "c26_touch",
        "label": "伸手确认镜中的自己",
        "text": "用最直接的方式寻找答案。",
        "requiresClues": 0,
        "effects": {
          "hp": -12,
          "energy": -8,
          "trust": -1,
          "insight": 2,
          "money": 0
        },
        "ending": {
          "title": "镜内的夜班",
          "text": "冰冷的手扣住你的手腕。你终于看清了另一条走廊，却从此需要寻找回到现实的路。",
          "tone": "dark"
        }
      },
      {
        "id": "c26_cover",
        "label": "遮住镜面，暂时撤离",
        "text": "先离开房间，再把异常记录交给同伴。",
        "requiresClues": 3,
        "effects": {
          "hp": 3,
          "energy": -4,
          "trust": 2,
          "insight": 3,
          "money": -5
        },
        "ending": {
          "title": "暂闭的门",
          "text": "黑布垂下，你带着记录走出房间。门后仍有声音，但今晚你没有独自回头。",
          "tone": "mixed"
        }
      },
      {
        "id": "c26_witness",
        "label": "邀请同伴共同封闭异常通道",
        "text": "依据时间与动作记录，避开镜缘的牵引。",
        "requiresClues": 5,
        "effects": {
          "hp": 5,
          "energy": -10,
          "trust": 4,
          "insight": 5,
          "money": -10
        },
        "ending": {
          "title": "有人同行的走廊",
          "text": "你们在镜面伸手之前退到门外。倒影失去目标，清晨的第一束光照在两个人的工牌上。",
          "tone": "hope"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        25.33,
        47.66,
        69.99,
        92.32,
        114.64,
        136.97,
        159.3,
        181.63,
        203.96,
        226.29,
        248.62,
        270.95,
        293.28,
        315.6,
        337.93
      ],
      "fullResolutionFrames": []
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 23,
    "phase": "青年执业",
    "timelineNote": "工作夜班中的自我分离作为青年阶段末尾危机；镜内命运为可改变分支，后续主线不默认永久困镜已成既定事实。",
    "presentation": "video",
    "timeNote": "异境经历 · 回到现实再继续前行"
  },
  {
    "id": 3,
    "title": "鬼市",
    "tagline": "连亡魂也害怕永无休息的白衣人。",
    "sourceSummary": "抽样画面中，疲惫的李晨光伏案后进入青色灯火的鬼市，见到幽灵与摊位。幽灵谈及死后仍被困在医院的人；李晨光随后回到办公桌前。",
    "intro": "伏案片刻，再抬头时，电脑的光变成了一条街的青灯。摊主看见你的白衣，忽然收住了招徕的声音。",
    "objective": "听懂鬼市对你的畏惧，选择带着什么离开。",
    "clues": [
      {
        "id": "c03_1",
        "title": "压皱的病历",
        "text": "醒来前，你的额头一直抵在这叠纸上。",
        "room": "hospital",
        "x": 0.21,
        "y": 0.39
      },
      {
        "id": "c03_2",
        "title": "空掉的茶杯",
        "text": "杯底只剩一道冷茶印，倒映出青色的街灯。",
        "room": "hospital",
        "x": 0.48,
        "y": 0.62
      },
      {
        "id": "c03_3",
        "title": "桌边的电话",
        "text": "熟悉的铃声似乎穿过了整条鬼市。",
        "room": "hospital",
        "x": 0.79,
        "y": 0.32
      },
      {
        "id": "c03_4",
        "title": "古旧摊位",
        "text": "铜盒与药材摆得整齐，摊主却不肯直视白衣。",
        "room": "other",
        "x": 0.24,
        "y": 0.61
      },
      {
        "id": "c03_5",
        "title": "亡魂的惊问",
        "text": "他们谈起永无休息、死后仍困在医院的人。",
        "room": "other",
        "x": 0.52,
        "y": 0.34
      },
      {
        "id": "c03_6",
        "title": "重叠的身影",
        "text": "鬼市上方浮现伏案、手术与走廊中的你。",
        "room": "other",
        "x": 0.81,
        "y": 0.55
      }
    ],
    "puzzle": {
      "question": "摊主们真正惊惧的是什么？",
      "options": [
        "工牌上的金属反光",
        "陌生的药材名字",
        "白衣人连死后也无法停下的处境"
      ],
      "correctIndex": 2,
      "explanation": "幽灵的惊问与反复工作的身影相呼应。恐惧由鬼怪转向了没有出口的劳作。"
    },
    "choices": [
      {
        "id": "c03_truth",
        "label": "问清那位留院亡魂",
        "text": "沿青灯追问传闻，把鬼市的恐惧写成见闻。",
        "requiresClues": 5,
        "effects": {
          "hp": -4,
          "energy": -8,
          "trust": 2,
          "insight": 12,
          "money": 0
        },
        "ending": {
          "title": "比鬼更冷的传闻",
          "text": "老摊主终于开口。你记下一个没有日期的夜班，回头时，自己的影子还站在摊位前。",
          "tone": "dark"
        }
      },
      {
        "id": "c03_bond",
        "label": "坐下听摊主说完",
        "text": "不再证明自己是活人，先听这条街的客人讲自己的事。",
        "requiresClues": 3,
        "effects": {
          "hp": 0,
          "energy": -4,
          "trust": 10,
          "insight": 5,
          "money": -5
        },
        "ending": {
          "title": "青灯下的空座",
          "text": "对方为你让出一张矮凳。回程的电话响起时，你听见一句轻轻的道别，而不是驱赶。",
          "tone": "hope"
        }
      },
      {
        "id": "c03_rest",
        "label": "循电话声返回",
        "text": "收起追问，沿熟悉的铃声找到办公桌。",
        "requiresClues": 0,
        "effects": {
          "hp": 5,
          "energy": 9,
          "trust": -2,
          "insight": 1,
          "money": 0
        },
        "ending": {
          "title": "桌上的灯还亮着",
          "text": "你醒来时，电话尚未挂断。鬼市留在杯底的青光渐渐散去，这一次你没有继续趴回病历上。",
          "tone": "mixed"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        26.0,
        48.9,
        71.9,
        94.9,
        117.9,
        140.8,
        163.8,
        186.8,
        209.8,
        232.7,
        255.7,
        278.7,
        301.7,
        324.6,
        347.6
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 24,
    "phase": "职业转折",
    "timelineNote": "重读仍被医院束缚的亡者故事，作为审视职业道路的转折；幽灵的死亡和年岁不等于李晨光已死亡或进入晚年。",
    "presentation": "video",
    "timeNote": "职业转折 · 连亡魂也害怕永无休息的白衣人。"
  },
  {
    "id": 12,
    "title": "连山文明",
    "tagline": "山河会记住一种文明的代价。",
    "sourceSummary": "疲惫的李晨光进入名为连山的文明幻境，见到灾变回忆、山水城市和模拟系统。当地人物讲述生存与文明，系统字幕明确其医学场景为虚构概念模拟；末段他回到桌前记录。",
    "intro": "实验室的灯熄灭时，山水间升起透明的高塔。连山的来客请你为一段文明记忆作证，而手中的笔记只剩六页。",
    "objective": "搜集连山的灾变、协作与模拟痕迹，决定带回现实的究竟是什么。",
    "clues": [
      {
        "id": "c12_1",
        "title": "未完成的笔记",
        "text": "桌面留下一个问题：技术的答案是否包含使用它的人？",
        "room": "hospital",
        "x": 0.22,
        "y": 0.31
      },
      {
        "id": "c12_2",
        "title": "实验室时钟",
        "text": "现实只过去片刻，梦中的城市却讲完了漫长年代。",
        "room": "hospital",
        "x": 0.49,
        "y": 0.5
      },
      {
        "id": "c12_3",
        "title": "空白复核栏",
        "text": "笔记末页写着“待验证”，尚无任何现实检验记录。",
        "room": "hospital",
        "x": 0.77,
        "y": 0.34
      },
      {
        "id": "c12_4",
        "title": "灾变石壁",
        "text": "熔岩与海潮刻在同一块石壁上，胜利者的名字被水洗掉。",
        "room": "other",
        "x": 0.23,
        "y": 0.6
      },
      {
        "id": "c12_5",
        "title": "共用水渠",
        "text": "城中的水路连接田地和高塔，没有一座塔独占源头。",
        "room": "other",
        "x": 0.51,
        "y": 0.3
      },
      {
        "id": "c12_6",
        "title": "模拟铭牌",
        "text": "设备自称概念模拟；明亮的图像并不等于已经实现的技术。",
        "room": "other",
        "x": 0.78,
        "y": 0.62
      }
    ],
    "puzzle": {
      "question": "哪样东西最适合从连山带回现实？",
      "options": [
        "可以直接治病的神奇结论",
        "等待验证的问题与协作方法",
        "宣称自己掌握了全部文明"
      ],
      "correctIndex": 1,
      "explanation": "模拟铭牌与复核栏相互印证：可带回的是问题和方法，尚不是现实疗效。"
    },
    "choices": [
      {
        "id": "c12_method",
        "label": "带回问题与方法",
        "text": "把观察、假说和未验证部分逐一分开记录。",
        "requiresClues": 5,
        "effects": {
          "trust": 2,
          "insight": 4,
          "energy": -4
        },
        "ending": {
          "title": "山外有山",
          "text": "你没有带回万能答案，只带回了一册可继续追问的笔记。连山的灯在窗外亮了一瞬。",
          "tone": "hope"
        }
      },
      {
        "id": "c12_memory",
        "label": "只保留这场梦",
        "text": "接受来客的告别，把文明留在故事里。",
        "requiresClues": 0,
        "effects": {
          "hp": 6,
          "energy": 8,
          "insight": 1
        },
        "ending": {
          "title": "一页山水",
          "text": "你醒来后画下水渠和山峰。纸上的城市不再发光，却让狭小的房间多了一扇窗。",
          "tone": "mixed"
        }
      },
      {
        "id": "c12_claim",
        "label": "独占文明的名义",
        "text": "隐去模拟标识，向众人宣称自己是唯一的继承者。",
        "requiresClues": 3,
        "effects": {
          "trust": -3,
          "insight": -1,
          "money": 20
        },
        "ending": {
          "title": "高塔上的回声",
          "text": "人们最初围拢过来，随后只听见你反复说出自己的名字。连山没有再次回应。",
          "tone": "dark"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        28.6,
        54.1,
        79.7,
        105.2,
        130.8,
        156.3,
        181.9,
        207.4,
        233.0,
        258.5,
        284.1,
        309.6,
        335.2,
        360.7,
        386.3
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 25,
    "phase": "职业转折",
    "timelineNote": "由个人工作转向生活方式与制度想象；文明灾变史属于幻境背景，不计入李晨光现实寿命。",
    "presentation": "video",
    "timeNote": "职业转折 · 山河会记住一种文明的代价。"
  },
  {
    "id": 8,
    "title": "多一小时",
    "tagline": "借来的时间，也会向身体索取回声。",
    "sourceSummary": "抽样画面中，实习神官给李晨光每天额外一小时。他将时间投入工作与研究，随后名声、事务增加并出现健康危机；神官说明馈赠有代价，结尾呈现病床。",
    "intro": "实习神官把沙漏放在病历堆上：从今往后，你每天都有第二十五个小时。沙子没有落下，你却已经想好要多完成什么。",
    "objective": "看清额外时间与新增负担的关系，决定这一个小时的去处。",
    "clues": [
      {
        "id": "c08_1",
        "title": "无尽的待办",
        "text": "清单刚被划去一项，就又增加了两项。",
        "room": "hospital",
        "x": 0.21,
        "y": 0.39
      },
      {
        "id": "c08_2",
        "title": "新来的邀约",
        "text": "成绩带来讲座、会议与应酬，日历没有因此空出来。",
        "room": "hospital",
        "x": 0.48,
        "y": 0.62
      },
      {
        "id": "c08_3",
        "title": "床边的座椅",
        "text": "家人在床旁守着；那些日程现在无人能够替你兑现。",
        "room": "hospital",
        "x": 0.79,
        "y": 0.32
      },
      {
        "id": "c08_4",
        "title": "第二十五格",
        "text": "沙漏圈出一小时，外界的钟在这段时间里不动。",
        "room": "other",
        "x": 0.24,
        "y": 0.61
      },
      {
        "id": "c08_5",
        "title": "神官的迟疑",
        "text": "他承认馈赠并非没有代价，承诺时没有把一切说清。",
        "room": "other",
        "x": 0.52,
        "y": 0.34
      },
      {
        "id": "c08_6",
        "title": "悬枝上的蜂蜜",
        "text": "甜味近在指尖，脚下却是看不到底的空处。",
        "room": "other",
        "x": 0.81,
        "y": 0.55
      }
    ],
    "puzzle": {
      "question": "哪两条线索共同说明“多一小时”没有自动带来自由？",
      "options": [
        "沙漏发光与神官衣饰",
        "待办不断增长与新邀约填满日历",
        "窗外夜色与办公桌位置"
      ],
      "correctIndex": 1,
      "explanation": "额外时间被新的要求再次占满。关卡讨论虚构时间交易中的选择，不将故事里的健康危机视为定量医学因果。"
    },
    "choices": [
      {
        "id": "c08_truth",
        "label": "追问馈赠的完整代价",
        "text": "拿着新增日程去找神官，要求说明契约留下的空白。",
        "requiresClues": 5,
        "effects": {
          "hp": -5,
          "energy": -8,
          "trust": 0,
          "insight": 12,
          "money": 0
        },
        "ending": {
          "title": "沙漏背面的字",
          "text": "你看见原先没被念出的条款。第二十五个小时仍在发光，但你终于知道，光里也能藏着阴影。",
          "tone": "mixed"
        }
      },
      {
        "id": "c08_bond",
        "label": "将这一小时留给重要的人",
        "text": "取消一场应酬，把额外时间用来赴一场平常的约。",
        "requiresClues": 3,
        "effects": {
          "hp": 4,
          "energy": 3,
          "trust": 11,
          "insight": 4,
          "money": -10
        },
        "ending": {
          "title": "没有议程的晚餐",
          "text": "这一个小时没有成果记录。饭菜慢慢凉下去，你却记住了对面那个人今天说过的话。",
          "tone": "hope"
        }
      },
      {
        "id": "c08_rest",
        "label": "归还沙漏，留下完整的夜",
        "text": "停止继续借取，接受清单并不会全部做完。",
        "requiresClues": 0,
        "effects": {
          "hp": 10,
          "energy": 11,
          "trust": -3,
          "insight": 2,
          "money": -5
        },
        "ending": {
          "title": "二十四小时",
          "text": "沙漏熄灭时，你感到一点失落。后来你关掉台灯，发现失去一小时，也可以是找回一个夜晚。",
          "tone": "hope"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        25.8,
        48.6,
        71.3,
        94.1,
        116.9,
        139.7,
        162.4,
        185.2,
        208.0,
        230.8,
        253.6,
        276.3,
        299.1,
        321.9,
        344.7
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 26,
    "phase": "职业转折",
    "timelineNote": "工作与研究扩张、荣誉增加及健康危机适合放在职业投入升级后；额外时间与病床结局为超自然代价及可改变分支，未核实具体年龄。",
    "presentation": "video",
    "timeNote": "职业转折 · 借来的时间，也会向身体索取回声。"
  },
  {
    "id": 15,
    "title": "时光回溯",
    "tagline": "再活一次，也可以选择另一种活法。",
    "sourceSummary": "片段呈现李晨光的科研投入、实验室压力与一次晕厥后的救治。随后出现时光神及回溯意象，末段他重新安排科研、生活与健康，并与他人交谈、出游。",
    "intro": "你醒在一叠尚未提交的研究记录旁。昨天的失误还未发生，时光神却说，这次回溯只会归还时间，不会替你决定如何使用。",
    "objective": "找出旧时间线中被忽略的代价，为重来的这一轮留下可持续的安排。",
    "clues": [
      {
        "id": "c15_1",
        "title": "旧实验记录",
        "text": "同一组结果旁写满了重试，休息一栏始终空着。",
        "room": "hospital",
        "x": 0.22,
        "y": 0.31
      },
      {
        "id": "c15_2",
        "title": "失约消息",
        "text": "朋友的消息没有责备，只有数次未被回复的邀请。",
        "room": "hospital",
        "x": 0.49,
        "y": 0.5
      },
      {
        "id": "c15_3",
        "title": "病床手环",
        "text": "手环证明你曾经停下；它没有写着“必须立刻回去”。",
        "room": "hospital",
        "x": 0.77,
        "y": 0.34
      },
      {
        "id": "c15_4",
        "title": "回溯的门",
        "text": "门后是同一张桌子，桌前的人却记得上一轮的代价。",
        "room": "other",
        "x": 0.23,
        "y": 0.6
      },
      {
        "id": "c15_5",
        "title": "时光神的沙漏",
        "text": "沙子可以倒流，决定仍要由你自己作出。",
        "room": "other",
        "x": 0.51,
        "y": 0.3
      },
      {
        "id": "c15_6",
        "title": "未填写的日程",
        "text": "空白同时容得下研究、休养和见面，没有一项自动消失。",
        "room": "other",
        "x": 0.78,
        "y": 0.62
      }
    ],
    "puzzle": {
      "question": "本章回溯真正改变了什么？",
      "options": [
        "你可以带着记忆重新安排选择",
        "所有风险都从世界上消失",
        "只要更努力就能跳过休息"
      ],
      "correctIndex": 0,
      "explanation": "回溯门和沙漏只归还选择的机会；旧记录与手环仍提醒你行动会有代价。"
    },
    "choices": [
      {
        "id": "c15_balance",
        "label": "重写自己的日程",
        "text": "保留研究目标，同时写入休养、求助和生活的时间。",
        "requiresClues": 5,
        "effects": {
          "hp": 12,
          "energy": 10,
          "trust": 2,
          "insight": 3
        },
        "ending": {
          "title": "没有重演的明天",
          "text": "这次你在天黑前合上了本子。未完成的工作仍在，但明天不再只是昨天的延长。",
          "tone": "hope"
        }
      },
      {
        "id": "c15_pause",
        "label": "暂停项目，先恢复状态",
        "text": "承认此刻承受不住，把重启留到以后。",
        "requiresClues": 0,
        "effects": {
          "hp": 16,
          "energy": 12,
          "money": -20,
          "insight": 1
        },
        "ending": {
          "title": "缓行的时间",
          "text": "沙漏仍在走。你没有追上所有人，却重新听见了钟声之外的鸟鸣。",
          "tone": "mixed"
        }
      },
      {
        "id": "c15_repeat",
        "label": "用前世记忆赶上全部进度",
        "text": "把每个空档都填进新一轮计划。",
        "requiresClues": 3,
        "effects": {
          "hp": -10,
          "energy": -12,
          "money": 20,
          "insight": 1
        },
        "ending": {
          "title": "熟悉的终点",
          "text": "你比上一轮更早完成了许多事，也更早认出了那个不肯停下的自己。回溯门开始模糊。",
          "tone": "dark"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        30.9,
        58.9,
        86.8,
        114.7,
        142.7,
        170.6,
        198.5,
        226.5,
        254.4,
        282.3,
        310.3,
        338.2,
        366.1,
        394.1,
        422.0
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 27,
    "phase": "职业转折",
    "timelineNote": "承接科研与健康危机，讨论重新安排生活；片段含时间窗帘中的未来记忆。回溯与预见不按真实回龄或已发生退休计算，主线仍处于职业转折的外层时间。",
    "presentation": "video",
    "timeNote": "时光重返 · 外层现实仍在职业转折"
  },
  {
    "id": 25,
    "title": "无效重生",
    "tagline": "回到过去之后，谁来改写那些不变的规则？",
    "sourceSummary": "疲惫的李晨光回到高中时代，尝试重新安排生活，却再度面对考试、家庭期待与社会评价。结尾指出，需要改变的可能不仅是年龄与时间，还有单一轨道的规则。",
    "intro": "值班室的钟倒转，你坐回熟悉的课桌。书包里却仍装着旧工牌。两段人生的时间表叠在一起，你必须找出真正没有改变的东西。",
    "objective": "比较两段人生的限制，决定这次重来要改变什么。",
    "roomNames": {
      "hospital": "医院·旧日值班室",
      "other": "异界·高中教室"
    },
    "clues": [
      {
        "id": "c25_1",
        "title": "旧工牌",
        "text": "照片上的你已经长大，背面写满未曾兑现的休息日。",
        "room": "hospital",
        "x": 0.2,
        "y": 0.32
      },
      {
        "id": "c25_2",
        "title": "轮转安排",
        "text": "日程看似不断更新，能够自行决定的空白却很少。",
        "room": "hospital",
        "x": 0.51,
        "y": 0.6
      },
      {
        "id": "c25_3",
        "title": "未拆车票",
        "text": "一张计划中的远行车票，始终夹在工作材料之间。",
        "room": "hospital",
        "x": 0.8,
        "y": 0.35
      },
      {
        "id": "c25_4",
        "title": "高中倒计时",
        "text": "数字换了起点，却仍要求每一天围着同一个终点转。",
        "room": "other",
        "x": 0.18,
        "y": 0.58
      },
      {
        "id": "c25_5",
        "title": "家庭对话",
        "text": "关心与期待混在一起，未来被反复归结为唯一的成功路径。",
        "room": "other",
        "x": 0.5,
        "y": 0.28
      },
      {
        "id": "c25_6",
        "title": "双重时间表",
        "text": "两张表的年份不同，挤掉休息与兴趣的位置却几乎重合。",
        "room": "other",
        "x": 0.82,
        "y": 0.6
      }
    ],
    "puzzle": {
      "question": "两张时间表中最值得改变的共同点是什么？",
      "options": [
        "任务占满生活，选择空间反复被压缩",
        "主角的年龄不同",
        "钟表采用了不同的数字"
      ],
      "correctIndex": 0,
      "explanation": "重来的时间并不会自动带来不同的生活；两段日程共同暴露的是选择空间被挤压。"
    },
    "choices": [
      {
        "id": "c25_repeat",
        "label": "用经验赢下同一场竞争",
        "text": "把重来的优势全部投入成绩与排名。",
        "requiresClues": 0,
        "effects": {
          "hp": -5,
          "energy": -6,
          "trust": -1,
          "insight": 1,
          "money": 20
        },
        "ending": {
          "title": "更快的旧路",
          "text": "这一次你提前到达了熟悉的位置。窗外仍然是夜色，桌上的日程也没有空下来。",
          "tone": "dark"
        }
      },
      {
        "id": "c25_small",
        "label": "守住一项自己的选择",
        "text": "保留兴趣与休息，接受不能处处领先。",
        "requiresClues": 3,
        "effects": {
          "hp": 6,
          "energy": 4,
          "trust": 2,
          "insight": 3,
          "money": -5
        },
        "ending": {
          "title": "留白的一页",
          "text": "你没有立刻改变所有规则，却第一次在时间表上写下不需要证明价值的一小时。",
          "tone": "mixed"
        }
      },
      {
        "id": "c25_change",
        "label": "与家人和同伴重新商量道路",
        "text": "把问题从“再努力一点”移向可改变的安排。",
        "requiresClues": 5,
        "effects": {
          "hp": 8,
          "energy": -5,
          "trust": 4,
          "insight": 5,
          "money": -10
        },
        "ending": {
          "title": "未落下的笔尖",
          "text": "你们开始讨论不同的道路。过去尚未被改写，但那条唯一的轨道终于出现了岔口。",
          "tone": "hope"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        27.02,
        51.04,
        75.05,
        99.07,
        123.09,
        147.11,
        171.12,
        195.14,
        219.16,
        243.18,
        267.2,
        291.21,
        315.23,
        339.25,
        363.27
      ],
      "fullResolutionFrames": [
        15
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 28,
    "phase": "职业转折",
    "timelineNote": "高中段是成年工作压力下的重生支线，不是按高中年龄应排在全游戏最前；主线停留于职业转折的外层时间。",
    "presentation": "video",
    "timeNote": "时光重返 · 外层现实仍在职业转折"
  },
  {
    "id": 23,
    "title": "无尽旷野",
    "tagline": "规则之外，是否还有一片可以站立的土地？",
    "sourceSummary": "一次医院团建转变为封闭空间内的淘汰游戏，失败者在光中消失。李晨光面对越来越苛刻的关卡，最后离开比赛空间，在旷野中再次见到其他人。",
    "intro": "会议室的门变成了黑色网格，倒计时宣布只留下最后一人。你看见同伴被光带走，却没看见任何人证明那就是死亡。",
    "objective": "调查淘汰机制，选择独自竞争、帮助同伴或寻找规则外的出口。",
    "roomNames": {
      "hospital": "医院·团建会议室",
      "other": "异界·淘汰赛场"
    },
    "clues": [
      {
        "id": "c23_1",
        "title": "团建通知",
        "text": "通知写着合作与放松，现场却没有任何退出说明。",
        "room": "hospital",
        "x": 0.2,
        "y": 0.32
      },
      {
        "id": "c23_2",
        "title": "缺席名牌",
        "text": "消失者的名字仍保留在参与名单上，没有被划去。",
        "room": "hospital",
        "x": 0.51,
        "y": 0.6
      },
      {
        "id": "c23_3",
        "title": "桥梁任务",
        "text": "搭桥原本依靠协作，排行榜却只记录个人名次。",
        "room": "hospital",
        "x": 0.8,
        "y": 0.35
      },
      {
        "id": "c23_4",
        "title": "淘汰光痕",
        "text": "光芒消退后没有留下伤痕，只有通向墙后的短暂坐标。",
        "room": "other",
        "x": 0.18,
        "y": 0.58
      },
      {
        "id": "c23_5",
        "title": "不完整规则",
        "text": "声音不断解释如何获胜，却始终没有解释离开之后会怎样。",
        "room": "other",
        "x": 0.5,
        "y": 0.28
      },
      {
        "id": "c23_6",
        "title": "旷野风声",
        "text": "网格裂缝透进草叶气息，远处传来熟悉同伴的呼喊。",
        "room": "other",
        "x": 0.82,
        "y": 0.6
      }
    ],
    "puzzle": {
      "question": "哪组发现最支持“离开比赛空间不等于被抹除”？",
      "options": [
        "名次越靠前，倒计时越快",
        "光痕留下坐标，裂缝外还有熟悉的声音",
        "获胜者能够获得奖章"
      ],
      "correctIndex": 1,
      "explanation": "坐标与裂缝外的回应指向另一个空间；排行榜只说明比赛内部的排序。"
    },
    "choices": [
      {
        "id": "c23_winner",
        "label": "继续争取唯一名额",
        "text": "接受排名规则，将有限资源留给自己。",
        "requiresClues": 0,
        "effects": {
          "hp": -10,
          "energy": -8,
          "trust": -3,
          "insight": 1,
          "money": 25
        },
        "ending": {
          "title": "孤独的第一名",
          "text": "榜首亮起你的名字，身后的座位全部空了。你获得通行证，却不知道还能向谁分享。",
          "tone": "dark"
        }
      },
      {
        "id": "c23_bridge",
        "label": "先让同伴跨过断桥",
        "text": "用自己的时间为其他人争取选择。",
        "requiresClues": 3,
        "effects": {
          "hp": -6,
          "energy": -8,
          "trust": 4,
          "insight": 3,
          "money": -5
        },
        "ending": {
          "title": "还没有散的人",
          "text": "你们没能同时抵达榜首，却记住了彼此的位置。下一道门前，多了一只愿意伸来的手。",
          "tone": "mixed"
        }
      },
      {
        "id": "c23_field",
        "label": "循着风声离开赛场",
        "text": "联结所有线索，打开墙后的通道。",
        "requiresClues": 5,
        "effects": {
          "hp": 6,
          "energy": -10,
          "trust": 5,
          "insight": 5,
          "money": 0
        },
        "ending": {
          "title": "无尽旷野",
          "text": "草地接住脚步，同伴从不同方向走来。这里没有最后一人的名额，你们可以各自选择道路。",
          "tone": "hope"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        24.77,
        46.54,
        68.31,
        90.08,
        111.84,
        133.61,
        155.38,
        177.15,
        198.92,
        220.69,
        242.46,
        264.23,
        286.0,
        307.76,
        329.53
      ],
      "fullResolutionFrames": [
        13
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 29,
    "phase": "职业转折",
    "timelineNote": "在竞争压力积累后检验是否离开淘汰规则；光中消失与旷野是异境叙事，不等于所有人物自然死亡或退休。",
    "presentation": "video",
    "timeNote": "职业转折 · 规则之外，是否还有一片可以站立的土地？"
  },
  {
    "id": 21,
    "title": "永恒传说",
    "tagline": "永恒的尽头，谁还拥有离开的权利？",
    "sourceSummary": "年轻医生在不断更新的工作与竞争中追求永恒。李晨光接受荣誉仪式后，被束缚在钢铁会议室，继续监视下一批年轻住院医。",
    "intro": "颁奖前夜，一份没有终止日期的邀请函被放在你的桌上。监控屏里，另一个你已经坐上了那把椅子。你还有时间查清“永恒”的代价。",
    "objective": "对照荣誉承诺与监控记录，决定是否接受永恒席位。",
    "roomNames": {
      "hospital": "医院·荣誉走廊",
      "other": "异界·钢铁会议室"
    },
    "clues": [
      {
        "id": "c21_1",
        "title": "换班名册",
        "text": "每年换上新名字，最下方的工作项目却从未删减。",
        "room": "hospital",
        "x": 0.2,
        "y": 0.32
      },
      {
        "id": "c21_2",
        "title": "授勋邀请",
        "text": "邀请只写永久保留席位，没有写离任程序。",
        "room": "hospital",
        "x": 0.51,
        "y": 0.6
      },
      {
        "id": "c21_3",
        "title": "前辈录音",
        "text": "疲惫的声音藏在颂词后：“先问一问，门还能不能打开。”",
        "room": "hospital",
        "x": 0.8,
        "y": 0.35
      },
      {
        "id": "c21_4",
        "title": "固定座椅",
        "text": "扶手能够记录所有操作，椅背内侧却没有解除按钮。",
        "room": "other",
        "x": 0.18,
        "y": 0.58
      },
      {
        "id": "c21_5",
        "title": "循环影像",
        "text": "屏幕里的青年重复着同一套争夺，画面边缘没有出口。",
        "room": "other",
        "x": 0.5,
        "y": 0.28
      },
      {
        "id": "c21_6",
        "title": "未签署条款",
        "text": "一栏空白留给继任者。你可以拒绝把下一代名字填进去。",
        "room": "other",
        "x": 0.82,
        "y": 0.6
      }
    ],
    "puzzle": {
      "question": "哪条证据最能揭示“永恒席位”的真实代价？",
      "options": [
        "颁奖仪式十分盛大",
        "席位没有退出程序，职责持续指向下一批人",
        "奖章能够长久保存"
      ],
      "correctIndex": 1,
      "explanation": "荣誉是否持久不是关键；退出权的缺失与持续监视的职责，揭示了席位的束缚。"
    },
    "choices": [
      {
        "id": "c21_seat",
        "label": "接受永久席位",
        "text": "让掌声盖过尚未说出口的疑问。",
        "requiresClues": 0,
        "effects": {
          "hp": -8,
          "energy": -5,
          "trust": -1,
          "insight": 1,
          "money": 25
        },
        "ending": {
          "title": "永恒值守",
          "text": "勋章亮起，椅背合拢。你保住了名字，却将下一批年轻人的名字写进屏幕。",
          "tone": "dark"
        }
      },
      {
        "id": "c21_record",
        "label": "保留记录，暂缓签署",
        "text": "把模糊条款与会议影像留给后来的同伴。",
        "requiresClues": 3,
        "effects": {
          "hp": -2,
          "energy": -5,
          "trust": 2,
          "insight": 3,
          "money": 0
        },
        "ending": {
          "title": "迟到的疑问",
          "text": "仪式延后。有人开始询问退出程序，荣誉第一次需要回答具体的问题。",
          "tone": "mixed"
        }
      },
      {
        "id": "c21_exit",
        "label": "拒绝席位，打开退场通道",
        "text": "联合证人解除控制，让新人自己决定去留。",
        "requiresClues": 5,
        "effects": {
          "hp": 5,
          "energy": -10,
          "trust": 4,
          "insight": 5,
          "money": -15
        },
        "ending": {
          "title": "有限而自由",
          "text": "你没有获得永恒。你与同伴走出会议室，第一次把明天留给尚未安排的生活。",
          "tone": "hope"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        23.97,
        44.95,
        65.92,
        86.89,
        107.87,
        128.84,
        149.81,
        170.79,
        191.76,
        212.73,
        233.71,
        254.68,
        275.65,
        296.63,
        317.6
      ],
      "fullResolutionFrames": [
        13
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 30,
    "phase": "职业转折",
    "timelineNote": "可放晚年之前：原片呈现年轻住院医轮换、荣誉仪式及钢铁会议室，没有已退休证据。游戏将永恒席位作为未来命运分支展示，不能按永恒时长累计年龄。",
    "presentation": "video",
    "timeNote": "异境经历 · 回到现实再继续前行"
  },
  {
    "id": 20,
    "title": "瞬间移动",
    "tagline": "距离缩短后，时间终于可以属于你。",
    "sourceSummary": "李晨光在拥挤通勤中希望节省时间，后来通过旧照片与四字念语出现瞬间移动。他往返医院、住处、父母家和旅行地点，并将节约出的时间用于休息、相聚与生活。",
    "intro": "旧照片在掌心发热。念语落下，你已站在医院门前，手表却几乎没有走动。省下来的路程会成为休息，还是下一份加班的空白？",
    "objective": "核对照片、时间与目的地的联系，决定如何使用新获得的自由。",
    "clues": [
      {
        "id": "c20_1",
        "title": "拥挤车票",
        "text": "每日往返消耗的时间，过去从未被写进自己的计划。",
        "room": "hospital",
        "x": 0.22,
        "y": 0.31
      },
      {
        "id": "c20_2",
        "title": "进门时刻",
        "text": "手表与医院门钟相符，改变的是路程而非钟表。",
        "room": "hospital",
        "x": 0.49,
        "y": 0.5
      },
      {
        "id": "c20_3",
        "title": "未用的午休",
        "text": "今天的空档仍在，尚未被任何人领取。",
        "room": "hospital",
        "x": 0.77,
        "y": 0.34
      },
      {
        "id": "c20_4",
        "title": "旧照片",
        "text": "清楚的地点图像为念语提供了落脚之处。",
        "room": "other",
        "x": 0.23,
        "y": 0.6
      },
      {
        "id": "c20_5",
        "title": "家门灯光",
        "text": "照片背面留着家人的字，目的地也可以是一场相见。",
        "room": "other",
        "x": 0.51,
        "y": 0.3
      },
      {
        "id": "c20_6",
        "title": "远行相册",
        "text": "陌生风景并未要求你搬走，只提醒世界还有别的方向。",
        "room": "other",
        "x": 0.78,
        "y": 0.62
      }
    ],
    "puzzle": {
      "question": "根据本章线索，瞬移首先归还了什么？",
      "options": [
        "被路程占据的可支配时间",
        "无限的工作能力",
        "自动完成所有职责的保证"
      ],
      "correctIndex": 0,
      "explanation": "门钟、手表和午休空档共同说明：路程缩短了，身体能力与任务边界仍然存在。"
    },
    "choices": [
      {
        "id": "c20_live",
        "label": "把省下的时间留给生活",
        "text": "保留休息，回家见面，再选择一处想去的地方。",
        "requiresClues": 5,
        "effects": {
          "hp": 10,
          "energy": 12,
          "trust": 3,
          "insight": 2,
          "money": -10
        },
        "ending": {
          "title": "终于赶上的晚饭",
          "text": "你在饭菜热着时推开家门。城市依旧拥堵，而你第一次没有把省下的时间全部交出去。",
          "tone": "hope"
        }
      },
      {
        "id": "c20_commute",
        "label": "只用它完成日常往返",
        "text": "谨慎保留秘密，先熟悉能力的边界。",
        "requiresClues": 0,
        "effects": {
          "hp": 5,
          "energy": 8,
          "insight": 1
        },
        "ending": {
          "title": "短短的一条路",
          "text": "你仍在同一家医院工作。只是每天回家的那条路，终于短得能装下一场完整的睡眠。",
          "tone": "mixed"
        }
      },
      {
        "id": "c20_more",
        "label": "接下更多可以瞬间赶到的任务",
        "text": "把所有新增空档继续排满。",
        "requiresClues": 3,
        "effects": {
          "hp": -8,
          "energy": -10,
          "money": 30,
          "trust": -1
        },
        "ending": {
          "title": "没有距离的牢笼",
          "text": "你可以抵达任何地方，却没有一处允许你停留。照片越来越多，属于自己的空白越来越少。",
          "tone": "dark"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        16.8,
        30.6,
        44.4,
        58.2,
        71.9,
        85.7,
        99.5,
        113.3,
        127.1,
        140.9,
        154.7,
        168.5,
        182.3,
        196.0,
        209.8
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 31,
    "phase": "职业转折",
    "timelineNote": "以通勤、探望父母、休息与旅行收束在职人生；字幕仍提到赶回上班，故置于退休前。旧照片是移动媒介，不表示穿越到照片年代；晚年前的具体位置为改编安排。",
    "presentation": "video",
    "timeNote": "职业转折 · 距离缩短后，时间终于可以属于你。"
  },
  {
    "id": 27,
    "title": "截止日期",
    "tagline": "有些约定，不需要倒计时。",
    "sourceSummary": "李晨光长期受到各种工作时限催促。退休、年老并出现记忆退化后，他仍反复念叨报告与手术期限；家人以陪伴、日常活动和熟悉的人事帮助他安定下来。",
    "intro": "走廊尽头的门通向多年后的家。白发的你仍攥着一张空白纸，催促一份早已完成的报告。你要替他找到仍然属于今天的事情。",
    "objective": "区分旧日任务与当下生活，重新安排时间的意义。",
    "roomNames": {
      "hospital": "医院·归档走廊",
      "other": "异界·未来的家"
    },
    "clues": [
      {
        "id": "c27_1",
        "title": "催办清单",
        "text": "不同任务共用醒目的红字，没有写何时可以停下。",
        "room": "hospital",
        "x": 0.2,
        "y": 0.32
      },
      {
        "id": "c27_2",
        "title": "归档记录",
        "text": "那份被反复催促的报告，已经留有多年前的完成日期。",
        "room": "hospital",
        "x": 0.51,
        "y": 0.6
      },
      {
        "id": "c27_3",
        "title": "退休合影",
        "text": "同伴送来花束，照片背面没有待办事项，只有祝福。",
        "room": "hospital",
        "x": 0.8,
        "y": 0.35
      },
      {
        "id": "c27_4",
        "title": "空白便笺",
        "text": "纸上没有新的要求，握着它的人却仍然十分着急。",
        "room": "other",
        "x": 0.18,
        "y": 0.58
      },
      {
        "id": "c27_5",
        "title": "今日图卡",
        "text": "浇花、散步、吃饭被画成简单图案，旁边留着陪伴者的位置。",
        "room": "other",
        "x": 0.5,
        "y": 0.28
      },
      {
        "id": "c27_6",
        "title": "旧相册",
        "text": "熟悉的面孔唤起谈话，今天不需要靠完成报告来证明。",
        "room": "other",
        "x": 0.82,
        "y": 0.6
      }
    ],
    "puzzle": {
      "question": "哪组线索能帮助区分“旧日催促”与“今天的任务”？",
      "options": [
        "墙上的钟仍然在走",
        "报告早已归档，今日图卡列的是生活安排",
        "空白纸看起来很正式"
      ],
      "correctIndex": 1,
      "explanation": "归档日期说明旧任务已经结束；当下安排提供了具体、可辨认的生活线索。"
    },
    "choices": [
      {
        "id": "c27_deadline",
        "label": "继续追赶记忆中的报告",
        "text": "把新的清单交到未来的自己手里。",
        "requiresClues": 0,
        "effects": {
          "hp": -8,
          "energy": -6,
          "trust": -1,
          "insight": 0,
          "money": 10
        },
        "ending": {
          "title": "永不交班",
          "text": "报告一次次写到开头，钟声一次次变得急促。你完成了许多事，却仍不知道何时可以停下。",
          "tone": "dark"
        }
      },
      {
        "id": "c27_remind",
        "label": "用记录说明任务早已结束",
        "text": "留下清楚的日期，也安排固定的相伴时刻。",
        "requiresClues": 3,
        "effects": {
          "hp": 4,
          "energy": 3,
          "trust": 2,
          "insight": 3,
          "money": 0
        },
        "ending": {
          "title": "已经完成",
          "text": "你把完成日期圈给他看，再陪他坐了一会儿。焦虑没有立刻消失，屋里却多了一份耐心。",
          "tone": "mixed"
        }
      },
      {
        "id": "c27_today",
        "label": "把今天还给生活",
        "text": "收好旧清单，与家人建立温柔且具体的日常。",
        "requiresClues": 5,
        "effects": {
          "hp": 10,
          "energy": 5,
          "trust": 5,
          "insight": 4,
          "money": -10
        },
        "ending": {
          "title": "今天一起走走",
          "text": "你们去浇花、散步、翻相册。夕阳落下时，那张纸终于被松开，手掌转而握住另一只手。",
          "tone": "hope"
        }
      }
    ],
    "sourceReview": {
      "method": "sampled_frames",
      "timestamps": [
        3.0,
        31.32,
        59.64,
        87.97,
        116.29,
        144.61,
        172.93,
        201.26,
        229.58,
        257.9,
        286.22,
        314.54,
        342.87,
        371.19,
        399.51,
        427.83
      ],
      "fullResolutionFrames": [
        7
      ]
    },
    "adaptationNote": "互动情节与分支为游戏改编",
    "gameOrder": 32,
    "phase": "晚年",
    "timelineNote": "最后一章：源片明确包含退休、灰发年老及家人陪伴，前段工作期限作为往事回顾。退休后不再无说明地返回规培主线；结局允许改变晚年处境。",
    "presentation": "video",
    "timeNote": "晚年 · 退休后的生活"
  }
];
};
modules["data/npcs.json"]=function(require,module,exports){
module.exports=[
  {
    "id": "guning",
    "name": "顾宁",
    "subtitle": "经历过愿望与未来相遇的规培生",
    "sourceSummary": "顾宁救下受伤红狐，希望医院不再勾心斗角。红狐用摧毁医院来实现愿望，他只好用第二个愿望恢复医院与众人的生活，重新面对改变现实的代价。《水仙错过》讲述他在骨科轮转时与五年后的自己相遇、相互依恋，又因时间线改变而无法重逢。",
    "description": "仍想把医生做好。经历过愿望的失控后，他会先问清每个承诺究竟怎样兑现。",
    "portrait": "assets/npcs/guning.jpg",
    "sourceFiles": [
      "顾宁与雍和宫红狐_第二章_横屏重绘版.mp4",
      "水仙错过_动态漫画_1080p.mp4"
    ],
    "dialogue": [
      {
        "title": "愿望的措辞",
        "text": "“医院里再没有矛盾”，听起来多好。我后来才懂，只说想消除什么，没有说想留下什么，也会酿成灾难。晨光，这次先把条件写清楚。"
      },
      {
        "title": "救下的红狐",
        "text": "救它时，我只是看见一条受伤的腿。善意并不保证接下来每件事都顺利，但我也不想因此学会对求助视而不见。"
      },
      {
        "title": "能做的一小步",
        "text": "让所有人一夜之间彼此理解，我已经不敢许这种愿。我们先核对一件事，把一句含糊的交代说清楚。能做的一小步，也算改变。"
      },
      {
        "title": "没有等到的重逢",
        "text": "那段骨科轮转，我也曾盼着有人替我把难关都过完。后来才知道，被陪过一段路和永远有人陪着，是两件事。晨光，你要是想听，我把那段故事讲给你。"
      }
    ],
    "quest": {
      "title": "愿望之外的条件",
      "description": "看完《雍和宫红狐》，和顾宁一起写清当前决定想保住什么、可能付出什么。",
      "reward": {
        "trust": 2,
        "insight": 1,
        "energy": 8
      },
      "completionText": "顾宁把愿望与条件并排写好，在结论旁补上限制。“这样，我们至少知道自己答应了什么。”你们分担了后续整理。",
      "requiresSideVideos": [
        "guning_red_fox"
      ]
    }
  },
  {
    "id": "huangning",
    "name": "黄宁",
    "subtitle": "讨封成规培生的妖怪",
    "sourceSummary": "黄宁向顾宁讨封，却被一句话带进写病历、值夜班、做科研的规培生活。在《借来的团圆》中，他看见病中老人对远方儿子的思念，化作儿子的模样给予短暂陪伴。",
    "description": "熬过夜班，也记得病床边没有说出口的愿望。他能体会规培生的疲惫，愿意留一点精力给具体的人。",
    "portrait": "assets/npcs/huangning.jpg",
    "sourceFiles": [
      "黄宁讨封成了规培生_横屏重绘版.mp4",
      "黄宁规培生日记_第三章_借来的团圆_横屏重绘版.mp4"
    ],
    "dialogue": [
      {
        "title": "一句话的夜班",
        "text": "那时我只想问一句“像不像人”，没想到连病历、夜班和科研都一块儿领到了。晨光，接班前先看清任务，别把自己也写进一张没有尽头的表。"
      },
      {
        "title": "借来的团圆",
        "text": "我见过病床边最难开口的愿望：不是要奇迹，只是想有人坐一会儿。可替别人决定怎样被陪伴，也会留下问题。这次，我们先听对方怎么说。"
      },
      {
        "title": "留下休息的位置",
        "text": "还有事情没做完，我知道。可你已经连刚才那句话都要问第二遍了。把急事交代清楚，我陪你把剩下的排好，再去歇一会儿。"
      }
    ],
    "quest": {
      "title": "陪伴的空档",
      "description": "看完黄宁的两段经历，再一起区分必须立即处理的事与可以交接的事，留出休息与陪伴的时间。",
      "reward": {
        "trust": 2,
        "insight": 1,
        "energy": 8
      },
      "completionText": "黄宁在交接单上留出一小格空白。“这里不填新任务。”你们完成了整理，也终于有空坐下喘口气。",
      "requiresSideVideos": [
        "huangning_origin",
        "huangning_reunion"
      ]
    }
  },
  {
    "id": "limuliang",
    "name": "李慕良",
    "subtitle": "经历城隍梦与命运骰子的医生",
    "sourceSummary": "《城隍梦》里，李慕良在梦中借狐家之力晋升，背弃伴侣后受罚惊醒。《命运骰子》则以荒诞的怀孕概率规则，让这位轻慢感情的外科医生面对自己的责任。",
    "description": "对机会与评价很敏感。两则故事里的代价，使他成为讨论承诺、责任与个人选择的同行。",
    "portrait": "assets/npcs/limuliang.jpg",
    "sourceFiles": [
      "李慕良_城隍梦_自然配音版.mp4",
      "李慕良_城隍梦_自然配音字幕.srt",
      "李慕良_第二章_命运骰子_自然配音版.mp4",
      "李慕良_第二章_命运骰子_字幕.srt"
    ],
    "dialogue": [
      {
        "title": "梦里的捷径",
        "text": "我梦见过一条很快的路，快到我以为所有好处都理所当然。醒来以后，最难回答的不是路能不能走通，是我拿谁的付出换了那几步。"
      },
      {
        "title": "骰子与责任",
        "text": "把结果交给运气，听起来像谁都不用负责。可骰子停下来，总有人要承受后果。要签下名字，就先弄清那个人是不是只有你自己。"
      },
      {
        "title": "先看事实",
        "text": "夸奖和流言都来得太快。我们先把听到的说法逐一核对，弄清发生了什么。至于别人想听怎样的故事，可以晚一点再说。"
      }
    ],
    "quest": {
      "title": "签字之前",
      "description": "看完《城隍梦》与《命运骰子》，和李慕良核对承诺的受益者、责任人和未说清的后果。",
      "reward": {
        "trust": 2,
        "insight": 1,
        "energy": 8
      },
      "completionText": "李慕良划去了凭印象写下的一句评价，把依据补在旁边。“这次，我得知道自己签的是什么。”共同核对替你省下了反复返工的力气。",
      "requiresSideVideos": [
        "limuliang_city_god",
        "limuliang_dice"
      ]
    }
  },
  {
    "id": "liuchangsheng",
    "name": "柳长生",
    "subtitle": "在人间学习相处的白蛇规培生",
    "sourceSummary": "《五百年孤独》中，久修的白蛇柳长生进入人间，因不熟悉社交规则屡受挫。他选择医学并来到医院规培，却仍难以应付人际压力，常以沉默保护自己。",
    "description": "话少，重视边界。比起突然的热闹，他更容易接住一张写明任务、时间与选择余地的便笺。",
    "portrait": "assets/npcs/liuchangsheng.jpg",
    "sourceFiles": [
      "liu_changsheng_anime_narrative.mp4",
      "data.json｜新笔记／第17章 五百年孤独",
      "Liu Changsheng Enters a Modern City.png"
    ],
    "dialogue": [
      {
        "title": "先写下来",
        "text": "如果不急，可以把要我做的事写下来吗？我不是不想回答。只是有时一句客套里藏着好几层意思，我需要一点时间分清。"
      },
      {
        "title": "空着的座位",
        "text": "我也想坐到大家中间。只是越想表现得合适，越容易说错话。你可以替我留一个位置，但先别替我答应。我想自己决定什么时候过去。"
      },
      {
        "title": "安静的同行",
        "text": "原来并肩走一段路，也可以不一直找话题。这样很好。晨光，你有事就直说；没有事，我们安静地把这段走完。"
      }
    ],
    "quest": {
      "title": "安静的交接",
      "description": "看完《五百年孤独》，与柳长生把含糊的交代整理成写明事项、时间和可确认问题的短便笺。",
      "reward": {
        "trust": 2,
        "insight": 1,
        "energy": 8
      },
      "completionText": "柳长生逐条确认便笺，终于不必反复猜测话外的意思。“谢谢你等我看完。”清楚的交接让你们都轻松了一些。",
      "requiresSideVideos": [
        "liuchangsheng_solitude"
      ]
    }
  },
  {
    "id": "baijin",
    "name": "白进与白斯年",
    "subtitle": "从管理者与年轻规培生两端回望的祖孙故事",
    "sourceSummary": "白进曾是三甲医院的科室主任。孙子白斯年担任另一家医院院长后，面临规培基地评审与员工士气问题，前去向祖父请教。《恨己如人》中，七旬白进回到年轻规培生的处境，在查房与工作中承受年长的自己施加的要求。此为他的回溯异闻，不是李晨光的人生章节。",
    "description": "医院安排落到年轻医生身上会变成什么？爷孙的谈话与白进的回溯异闻，让李晨光看见同一问题的两端。",
    "portrait": "assets/side/baijin_strategy.jpg",
    "sourceFiles": [
      "JinNangMiaoJi_Animated_Voiced_1080p.mp4",
      "白衣志怪录_第三十章_恨己如人_横屏.mp4"
    ],
    "dialogue": [
      {
        "title": "评审之前",
        "text": "白斯年：“评审快到了，材料和人手都在催。我得弄清每件事由谁负责，不能只盯着最后那一张表。”"
      },
      {
        "title": "谁来承担",
        "text": "白进：“一项安排写下来很容易。真正难的是知道它到了科室、到了一个人手里，还会变成什么。”"
      },
      {
        "title": "听完再决定",
        "text": "李晨光记下了爷孙的谈话。管理者的想法与一线的感受未必相同；在答应新任务前，他想先核对时间、人手和承担的后果。"
      },
      {
        "title": "换到被审视的那一边",
        "text": "李晨光：“我还想听听白进的另一段经历。如果提出要求的人，也得用年轻时的身体和处境去完成那些要求，他会怎样看待同一场查房？”"
      }
    ],
    "quest": {
      "title": "安排落到谁身上",
      "description": "看完《锦囊妙计》，把一项工作安排的目标、执行者与所需时间写清楚，再决定如何回应。",
      "requiresSideVideos": [
        "baijin_strategy"
      ],
      "reward": {
        "trust": 2,
        "insight": 1,
        "energy": 8
      },
      "completionText": "你把任务、所需时间和交接责任逐项列出，向对方确认。“先让安排说得明白，再决定怎样完成。”清楚的分工减少了来回猜测。"
    }
  }
]
;
};
modules["data/knowledge.json"]=function(require,module,exports){
module.exports=[
  {
    "id": "med01",
    "title": "新患者到达病房",
    "category": "内科",
    "scene": "护士告知一位新患者刚刚到达病房，病历首页还未填完。",
    "question": "依据手册的新收患者常规，首先应优先完成哪一项？",
    "options": [
      "先把全部文书补齐，再见患者",
      "快速评估患者，识别急危重情况",
      "等所有检验结果齐全再评估"
    ],
    "correctIndex": 1,
    "explanation": "新收患者应先快速评估并识别急危重情况。文书工作需要完成，但不应延误对患者当前状态的了解。",
    "source": {
      "fileName": "协和内科住院医师手册_第3版_离线网站.zip / index.html",
      "section": "临床工作规范／新收患者常规",
      "pageOrAnchor": "PDF原始页30；#topic=topic-009&page=30"
    },
    "reading": "提前了解病情有助于准备；患者到达后，应关注生命体征、意识、循环和呼吸等情况，及时识别需要优先处理的问题。",
    "tags": [
      "新收患者",
      "优先级",
      "病情评估"
    ]
  },
  {
    "id": "med02",
    "title": "用自己的语言汇报",
    "category": "内科",
    "scene": "查房前，你要把复杂的住院经过汇报给上级医师。",
    "question": "哪种汇报最符合手册强调的原则？",
    "options": [
      "按时间和逻辑组织信息，突出主要问题、判断与计划",
      "逐字朗读整份入院病历",
      "只列异常化验数值，省略临床判断"
    ],
    "correctIndex": 0,
    "explanation": "手册强调简明、有条理、有思路。信息之外，还应体现对病情的理解、目前问题的判断及诊疗计划。",
    "source": {
      "fileName": "协和内科住院医师手册_第3版_离线网站.zip / index.html",
      "section": "如何汇报病例",
      "pageOrAnchor": "PDF原始页32；#topic=topic-010&page=32"
    },
    "reading": "病例汇报应围绕主要症状组织现病史，结合相关病史、重要体征和检查，最后总结主要问题及评估计划。",
    "tags": [
      "病例汇报",
      "临床思维"
    ]
  },
  {
    "id": "med03",
    "title": "SOAP中的客观信息",
    "category": "内科",
    "scene": "你正在整理今日病程记录，准备把信息放入SOAP结构。",
    "question": "体格检查和检验结果主要应放在哪一部分？",
    "options": [
      "S：患者主观症状",
      "P：诊疗计划",
      "O：客观结果"
    ],
    "correctIndex": 2,
    "explanation": "O对应客观结果，包括查体、出入量、体重和有意义的检验检查信息；S是症状，A是评估，P是计划。",
    "source": {
      "fileName": "协和内科住院医师手册_第3版_离线网站.zip / index.html",
      "section": "日常病程记录",
      "pageOrAnchor": "PDF原始页33；#topic=topic-011&page=33"
    },
    "reading": "日常病程既要记录病情现状和变化，也要体现医师的分析与决策依据。SOAP有助于区分症状、客观证据、评估和计划。",
    "tags": [
      "病程记录",
      "SOAP",
      "病历质量"
    ]
  },
  {
    "id": "med04",
    "title": "让交班可以执行",
    "category": "内科",
    "scene": "夜班同事接过你的交班本，想知道今晚重点关注什么。",
    "question": "哪种交班方式最有助于维持诊疗连续性？",
    "options": [
      "只说“这个患者你多看着点”",
      "说明当前问题、自己的判断、待办任务和观察重点",
      "把所有既往病历原样复制给同事"
    ],
    "correctIndex": 1,
    "explanation": "交班应简明直接，并让待办事项具有可操作性。当前问题、已有判断和需要继续观察或完成的任务都很重要。",
    "source": {
      "fileName": "协和内科住院医师手册_第3版_离线网站.zip / index.html",
      "section": "如何交接班",
      "pageOrAnchor": "PDF原始页35；#topic=topic-013&page=35"
    },
    "reading": "交班的目标是维持诊疗连续性、保证患者安全和体现协作。信息应面向接班医师的实际需要，而非单纯堆积病史。",
    "tags": [
      "交接班",
      "团队协作"
    ]
  },
  {
    "id": "med05",
    "title": "确认真正理解",
    "category": "内科",
    "scene": "解释一项检查后，患者点头说“我知道了”，你准备确认其理解。",
    "question": "手册建议用哪种方式进一步确认患者是否理解？",
    "options": [
      "请患者用自己的话复述关键内容",
      "仅确认知情同意书已签名",
      "只问家属是否同意，不再询问患者"
    ],
    "correctIndex": 0,
    "explanation": "请患者按自己的理解复述，有助于发现信息遗漏或误解。签字是流程的一部分，不能替代理解与沟通。",
    "source": {
      "fileName": "协和内科住院医师手册_第3版_离线网站.zip / index.html",
      "section": "知情同意",
      "pageOrAnchor": "PDF原始页39；#topic=topic-015&page=39"
    },
    "reading": "知情同意过程包括评估决策能力、解释获益与风险、讨论其他选择、确认理解，并记录沟通。手册提倡医患共同决策。",
    "tags": [
      "知情同意",
      "沟通",
      "共同决策"
    ]
  },
  {
    "id": "med06",
    "title": "谈话之后的记录",
    "category": "内科",
    "scene": "家属谈话即将结束，大家已就下一步安排达成共识。",
    "question": "此时最合适的收尾是什么？",
    "options": [
      "只说“以后再看”，立即离开",
      "反复重复医学术语，以显示专业性",
      "确认疑问，总结决定与下一步计划，并记录谈话"
    ],
    "correctIndex": 2,
    "explanation": "手册强调在结束谈话时确认疑问、总结决定、安排下一步，并在病程中记录谈话和计划。",
    "source": {
      "fileName": "协和内科住院医师手册_第3版_离线网站.zip / index.html",
      "section": "如何与患者家属谈话",
      "pageOrAnchor": "PDF原始页41；#topic=topic-016&page=41"
    },
    "reading": "与家属谈话前先了解病情并明确目标；谈话中使用通俗语言，回应关切；结束时留下清晰、可追踪的共同计划。",
    "tags": [
      "医患沟通",
      "记录规范"
    ]
  },
  {
    "id": "med07",
    "title": "坏消息中的停顿",
    "category": "内科",
    "scene": "说明检查结果后，患者沉默并流泪，谈话室安静下来。",
    "question": "依据SPIKES框架，下一步更适合怎样做？",
    "options": [
      "忽略情绪，迅速讲完全部技术细节",
      "观察并回应患者情绪，给予表达空间",
      "立即结束谈话，避免患者继续难过"
    ],
    "correctIndex": 1,
    "explanation": "SPIKES包含共情环节。观察情绪、探讨感受并回应，有助于患者在被理解的基础上继续沟通。",
    "source": {
      "fileName": "协和内科住院医师手册_第3版_离线网站.zip / index.html",
      "section": "如何告知坏消息",
      "pageOrAnchor": "PDF原始页42；#topic=topic-017&page=42"
    },
    "reading": "告知坏消息应准备合适环境，了解患者已有认知及信息意愿，分段说明，回应情绪，最后总结与规划。",
    "tags": [
      "SPIKES",
      "共情",
      "沟通"
    ]
  },
  {
    "id": "med08",
    "title": "理解弥散能力",
    "category": "内科",
    "scene": "你和同伴正在阅读一张肺功能报告，看到DLCO这一项。",
    "question": "DLCO主要反映哪一环节的气体交换能力？",
    "options": [
      "肺泡腔到肺毛细血管之间的气体交换",
      "口腔到食管之间的气体流动",
      "心房到心室之间的血流速度"
    ],
    "correctIndex": 0,
    "explanation": "手册将弥散功能描述为肺泡腔到毛细血管的气体交换。它与单纯的通气功能属于不同的观察角度。",
    "source": {
      "fileName": "协和内科住院医师手册_第3版_离线网站.zip / index.html",
      "section": "肺功能／主要概念",
      "pageOrAnchor": "PDF原始页132；#topic=topic-054&page=132"
    },
    "reading": "通气功能关注气体进出肺泡；弥散功能关注肺泡与毛细血管之间的交换。解读时应将不同参数和临床情境结合。",
    "tags": [
      "肺功能",
      "DLCO",
      "检查解释"
    ]
  },
  {
    "id": "med09",
    "title": "系统地阅读心电图",
    "category": "内科",
    "scene": "桌上有一份新心电图，你要向同伴说明自己的阅读顺序。",
    "question": "哪一种做法符合手册的“系统、全面”原则？",
    "options": [
      "只看机器自动给出的结论",
      "只寻找自己熟悉的一种波形",
      "依次关注心率、心律、传导等，并结合整体图形"
    ],
    "correctIndex": 2,
    "explanation": "心电图应系统解读。手册依次讨论导联、心率、心律和传导等内容，不能仅凭一个局部特征或机器结论。",
    "source": {
      "fileName": "协和内科住院医师手册_第3版_离线网站.zip / index.html",
      "section": "心电图速读",
      "pageOrAnchor": "PDF原始页178；#topic=topic-068&page=178"
    },
    "reading": "阅读心电图可采用固定框架，避免遗漏：先确认基本信息和导联，再分析心率、心律、传导及其他波形变化。",
    "tags": [
      "心电图",
      "系统评估"
    ]
  },
  {
    "id": "med10",
    "title": "损伤与合成功能",
    "category": "内科",
    "scene": "“肝功能”报告里有转氨酶、白蛋白和凝血酶原时间，你准备分清含义。",
    "question": "哪组指标与肝脏合成功能关系更直接？",
    "options": [
      "ALT与AST",
      "白蛋白与凝血酶原时间",
      "血钠与血钾"
    ],
    "correctIndex": 1,
    "explanation": "手册区分肝损伤指标与合成功能指标：ALT、AST等主要提示损伤；白蛋白、PT反映合成功能的一个侧面。",
    "source": {
      "fileName": "协和内科住院医师手册_第3版_离线网站.zip / index.html",
      "section": "肝功能解读／概述",
      "pageOrAnchor": "PDF原始页223；#topic=topic-080&page=223"
    },
    "reading": "“肝功能”是一组不同意义的指标。解读时应区分损伤、胆汁排泄与合成功能，并结合临床及其他影响因素。",
    "tags": [
      "肝功能",
      "检验解释"
    ]
  },
  {
    "id": "med11",
    "title": "贫血先分清机制",
    "category": "内科",
    "scene": "你发现患者血红蛋白降低，准备进一步整理贫血的原因。",
    "question": "哪组检查有助于从形态和骨髓反应两个角度分析贫血？",
    "options": [
      "MCV、网织红细胞及外周血涂片",
      "仅记录患者是否感到乏力",
      "只查一次体温"
    ],
    "correctIndex": 0,
    "explanation": "手册列出血常规中的MCV、网织红细胞和外周血涂片，结合病史来决定后续检查，区分生成不足与破坏或丢失等机制。",
    "source": {
      "fileName": "协和内科住院医师手册_第3版_离线网站.zip / index.html",
      "section": "贫血／诊断",
      "pageOrAnchor": "PDF原始页324；#topic=topic-118&page=324"
    },
    "reading": "贫血分析需要病史与实验室信息配合。MCV帮助形态分类，网织红细胞反映造血反应，涂片提供细胞形态线索。",
    "tags": [
      "贫血",
      "网织红细胞",
      "诊断思路"
    ]
  },
  {
    "id": "med12",
    "title": "胸水需要配对信息",
    "category": "内科",
    "scene": "同伴准备按Light标准判断胸腔积液性质，手上只有胸水报告。",
    "question": "还需要关注哪组配对数据？",
    "options": [
      "仅患者身高与体重",
      "仅尿常规中的蛋白",
      "血清蛋白和LDH，与胸水结果配合"
    ],
    "correctIndex": 2,
    "explanation": "Light标准包含胸水与血清蛋白、LDH的比较，因此需要相应血清结果。分类结果仍应放回病因背景中解释。",
    "source": {
      "fileName": "协和内科住院医师手册_第3版_离线网站.zip / index.html",
      "section": "胸腔积液／病因诊断",
      "pageOrAnchor": "PDF原始页163；#topic=topic-064&page=163"
    },
    "reading": "胸腔积液评估包含外观与针对性检查。渗出液判断可使用Light标准，但个别临床情境可能出现误分类，需要综合分析。",
    "tags": [
      "胸腔积液",
      "Light标准",
      "配对检查"
    ]
  },
  {
    "id": "endo01",
    "title": "骨骺闭合前后",
    "category": "内分泌",
    "scene": "异闻档案提到同一种激素过量，却出现两种不同的身体变化。",
    "question": "生长激素过量发生于骨骺闭合前与闭合后，典型表现分别是什么？",
    "options": [
      "都只表现为体重下降",
      "巨人症与肢端肥大症",
      "甲状腺肿与低血糖"
    ],
    "correctIndex": 1,
    "explanation": "手册概述指出，骨骺闭合前的GH过量可导致巨人症，成人骨骺闭合后则主要表现为肢端肥大症。",
    "source": {
      "fileName": "pumch-endocrine-handbook-offline.zip / pumch-endocrine-handbook-offline.html",
      "section": "生长激素腺瘤／概述",
      "pageOrAnchor": "内置章节键 acromegaly；原HTML标注原书页8–13"
    },
    "reading": "GH腺瘤的临床评估涉及激素分泌、占位影响与并发症。相同的激素过量，在不同发育阶段可呈现不同表型。",
    "tags": [
      "GH",
      "肢端肥大症",
      "病理生理"
    ]
  },
  {
    "id": "endo02",
    "title": "高催乳素并非一个病因",
    "category": "内分泌",
    "scene": "一份催乳素升高的结果放在桌上，同伴问能否立刻认定为垂体瘤。",
    "question": "哪一种判断更符合手册的诊断思路？",
    "options": [
      "任何催乳素升高都等于催乳素瘤",
      "只凭一次化验便可确定肿瘤位置",
      "结合临床、化验与影像，并排查生理、药物等其他原因"
    ],
    "correctIndex": 2,
    "explanation": "高催乳素血症有多种原因。催乳素瘤诊断需结合临床、生化和垂体影像，并排除其他原因。",
    "source": {
      "fileName": "pumch-endocrine-handbook-offline.zip / pumch-endocrine-handbook-offline.html",
      "section": "催乳素瘤／诊断要点与鉴别诊断",
      "pageOrAnchor": "内置章节键 prolactinoma；原HTML标注原书页2–7"
    },
    "reading": "妊娠、哺乳、某些药物及其他疾病都可能影响PRL。化验与肿瘤大小明显不相称时，还应考虑测定方法的干扰。",
    "tags": [
      "PRL",
      "鉴别诊断",
      "检验解释"
    ]
  },
  {
    "id": "endo03",
    "title": "多尿背后的信号",
    "category": "内分泌",
    "scene": "你在知识角比较中枢性与肾性尿崩症的机制。",
    "question": "中枢性尿崩症的主要机制是哪一项？",
    "options": [
      "抗利尿激素的分泌或释放不足",
      "肾小管对抗利尿激素的反应障碍",
      "甲状腺激素生成增加"
    ],
    "correctIndex": 0,
    "explanation": "中枢性尿崩症与抗利尿激素分泌或释放不足有关；肾性尿崩症则与肾脏对该激素的反应障碍有关。",
    "source": {
      "fileName": "pumch-endocrine-handbook-offline.zip / pumch-endocrine-handbook-offline.html",
      "section": "中枢性尿崩症／概述与诊断思路",
      "pageOrAnchor": "内置章节键 central-di；原HTML标注原书页23–28"
    },
    "reading": "尿崩症常表现为大量低渗尿、烦渴和多饮。诊断思路需要先确认多尿性质，再区分机制并寻找病因。",
    "tags": [
      "ADH",
      "尿崩症",
      "病理生理"
    ]
  },
  {
    "id": "endo04",
    "title": "被抗体启动的受体",
    "category": "内分泌",
    "scene": "一张甲状腺示意图上，TSH受体旁画着一枚抗体。",
    "question": "Graves病中，与刺激TSH受体有关的抗体是哪一类？",
    "options": [
      "抗核抗体",
      "TSH受体抗体TRAb",
      "抗内因子抗体"
    ],
    "correctIndex": 1,
    "explanation": "手册将Graves病描述为自身免疫性疾病：刺激性TSH受体抗体可促使甲状腺激素生成和释放增多。",
    "source": {
      "fileName": "pumch-endocrine-handbook-offline.zip / pumch-endocrine-handbook-offline.html",
      "section": "Graves病／概述",
      "pageOrAnchor": "内置章节键 graves；原HTML标注原书页53–55"
    },
    "reading": "Graves病的判断结合临床、甲状腺功能及相关辅助检查。TRAb与TSH受体相关，是理解其发病机制的重要线索。",
    "tags": [
      "Graves病",
      "TRAb",
      "自身免疫"
    ]
  },
  {
    "id": "endo05",
    "title": "桥本甲状腺炎的机制",
    "category": "内分泌",
    "scene": "同伴把桥本甲状腺炎与普通细菌感染混为一谈，请你纠正概念。",
    "question": "桥本甲状腺炎主要属于哪一类疾病？",
    "options": [
      "自身免疫性甲状腺炎",
      "单纯细菌性化脓感染",
      "仅由外伤导致的甲状腺出血"
    ],
    "correctIndex": 0,
    "explanation": "桥本甲状腺炎是自身免疫性甲状腺炎的一种，涉及淋巴细胞浸润和甲状腺滤泡破坏。",
    "source": {
      "fileName": "pumch-endocrine-handbook-offline.zip / pumch-endocrine-handbook-offline.html",
      "section": "慢性淋巴细胞性甲状腺炎／概述",
      "pageOrAnchor": "内置章节键 hashimoto；原HTML标注原书页75–77"
    },
    "reading": "桥本甲状腺炎可缓慢进展，甲状腺功能状态随病程变化。抗体结果需结合甲状腺功能和临床信息解读。",
    "tags": [
      "桥本甲状腺炎",
      "自身免疫"
    ]
  },
  {
    "id": "endo06",
    "title": "把血钙与PTH放在一起",
    "category": "内分泌",
    "scene": "评估疑似原发性甲旁亢时，两份来自不同日期的化验放在你面前。",
    "question": "手册强调，定性判断尤其需要怎样的信息？",
    "options": [
      "仅看颈部超声有无结节",
      "仅记录是否出现骨痛",
      "同步测定并结合判断血钙与PTH"
    ],
    "correctIndex": 2,
    "explanation": "手册明确强调血钙与PTH应同步测定、联合判断。定位影像用于寻找病灶，不能替代生化层面的定性评估。",
    "source": {
      "fileName": "pumch-endocrine-handbook-offline.zip / pumch-endocrine-handbook-offline.html",
      "section": "原发性甲状旁腺功能亢进症／诊断要点／实验室检查",
      "pageOrAnchor": "内置章节键 primary-hyperparathyroidism；原HTML标注原书页150–156"
    },
    "reading": "原发性甲旁亢评估包括定性、定位和并发症评价。生化信息与影像各自回答不同问题，不能互相替代。",
    "tags": [
      "甲旁亢",
      "PTH",
      "诊断顺序"
    ]
  },
  {
    "id": "endo07",
    "title": "醛固酮与肾素的方向",
    "category": "内分泌",
    "scene": "你正在整理原发性醛固酮增多症的激素轴示意图。",
    "question": "其典型病理生理关系是哪一项？",
    "options": [
      "醛固酮减少，肾素持续受抑制",
      "醛固酮分泌增多，肾素受抑制",
      "两者均由甲状腺直接分泌"
    ],
    "correctIndex": 1,
    "explanation": "原醛症的特点包括醛固酮分泌增多及肾素受抑制。患者可伴低钾，也可能没有低钾。",
    "source": {
      "fileName": "pumch-endocrine-handbook-offline.zip / pumch-endocrine-handbook-offline.html",
      "section": "原发性醛固酮增多症／概述与临床表现",
      "pageOrAnchor": "内置章节键 primary-aldosteronism；原HTML标注原书页327–331"
    },
    "reading": "理解原醛症应先认识醛固酮与肾素的关系。正常血钾并不能单独排除该病，检查结果还受取样条件等因素影响。",
    "tags": [
      "原醛症",
      "肾素",
      "病理生理"
    ]
  },
  {
    "id": "endo08",
    "title": "阵发性症状的组合",
    "category": "内分泌",
    "scene": "病例讨论中出现阵发性血压升高，你要留意手册提到的症状组合。",
    "question": "PPGL章节列出的常见三个症状是什么？",
    "options": [
      "头痛、心悸、大汗",
      "黄疸、腹水、瘙痒",
      "咳嗽、咳痰、咯血"
    ],
    "correctIndex": 0,
    "explanation": "手册列出头痛、心悸和大汗为常见症状组合。这些线索提示进一步评估的方向，本身不能完成诊断。",
    "source": {
      "fileName": "pumch-endocrine-handbook-offline.zip / pumch-endocrine-handbook-offline.html",
      "section": "嗜铬细胞瘤和副神经节瘤／诊断要点／临床表现",
      "pageOrAnchor": "内置章节键 ppgl；原HTML标注原书页332–337"
    },
    "reading": "嗜铬细胞瘤和副神经节瘤涉及儿茶酚胺相关表现。诊断还需结合生化、定位与其他评估。",
    "tags": [
      "PPGL",
      "儿茶酚胺",
      "临床线索"
    ]
  },
  {
    "id": "endo09",
    "title": "激素轴的反馈",
    "category": "内分泌",
    "scene": "你要在示意图中区分原发性与继发性肾上腺皮质功能减退。",
    "question": "原发性肾上腺皮质功能减退时，ACTH通常呈什么变化？",
    "options": [
      "必然完全测不到",
      "必然随皮质醇一起下降",
      "因反馈减弱而升高"
    ],
    "correctIndex": 2,
    "explanation": "手册指出，原发性肾上腺皮质功能减退时ACTH常明显升高；继发性者ACTH可低或处于正常范围。",
    "source": {
      "fileName": "pumch-endocrine-handbook-offline.zip / pumch-endocrine-handbook-offline.html",
      "section": "肾上腺皮质功能减退症／实验室检查／血皮质醇和ACTH",
      "pageOrAnchor": "内置章节键 adrenal-insufficiency；原HTML标注原书页338–342"
    },
    "reading": "同样的靶腺激素不足，可能来自靶腺本身，也可能来自上游调控。将皮质醇与ACTH放在同一激素轴中理解有助于鉴别。",
    "tags": [
      "肾上腺功能减退",
      "ACTH",
      "负反馈"
    ]
  },
  {
    "id": "endo10",
    "title": "库欣病与综合征",
    "category": "内分泌",
    "scene": "教学卡上同时出现“库欣病”和“库欣综合征”，同伴以为二者完全等同。",
    "question": "手册中的“库欣病”特指哪一种病因？",
    "options": [
      "所有外源性糖皮质激素作用",
      "垂体ACTH腺瘤所致的库欣综合征",
      "所有肾上腺占位"
    ],
    "correctIndex": 1,
    "explanation": "库欣综合征是较广的综合征名称；库欣病特指垂体ACTH腺瘤这一病因。",
    "source": {
      "fileName": "pumch-endocrine-handbook-offline.zip / pumch-endocrine-handbook-offline.html",
      "section": "库欣综合征／概述与病因分类",
      "pageOrAnchor": "内置章节键 cushing；原HTML标注原书页320–326"
    },
    "reading": "内源性库欣综合征可按ACTH依赖性与非依赖性分类。讨论病因前，也应了解有无外源性糖皮质激素使用。",
    "tags": [
      "库欣病",
      "库欣综合征",
      "病因分类"
    ]
  },
  {
    "id": "endo11",
    "title": "不同血糖指标的时间窗",
    "category": "内分泌",
    "scene": "同伴把一次指尖血糖与HbA1c当成同一种时间尺度的结果。",
    "question": "HbA1c通常主要反映哪段时间的平均血糖水平？",
    "options": [
      "过去约2–3个月",
      "刚刚过去的几分钟",
      "一生以来的全部血糖"
    ],
    "correctIndex": 0,
    "explanation": "手册说明HbA1c主要反映约2–3个月平均血糖；即时血糖则反映测量时的状态。两者提供的信息不同。",
    "source": {
      "fileName": "pumch-endocrine-handbook-offline.zip / pumch-endocrine-handbook-offline.html",
      "section": "血糖监测临床应用／概述",
      "pageOrAnchor": "内置章节键 glucose-monitoring；原HTML标注原书页302–311"
    },
    "reading": "血糖监测方式各有时间窗。解释指标时先明确它反映即时、近期还是较长期的情况，再与临床情境结合。",
    "tags": [
      "HbA1c",
      "血糖监测",
      "时间窗"
    ]
  },
  {
    "id": "endo12",
    "title": "结节评估问什么",
    "category": "内分泌",
    "scene": "超声报告写着“甲状腺结节”，患者担心这是否已经等于癌症。",
    "question": "甲状腺结节评估中的核心问题之一是什么？",
    "options": [
      "有结节就可直接等同恶性肿瘤",
      "只看是否能摸到，忽略其他信息",
      "结合临床与相关检查判断良恶性风险"
    ],
    "correctIndex": 2,
    "explanation": "手册将良恶性鉴别列为结节评估要点。发现结节并不等于已经确诊恶性肿瘤。",
    "source": {
      "fileName": "pumch-endocrine-handbook-offline.zip / pumch-endocrine-handbook-offline.html",
      "section": "甲状腺结节／概述与诊断要点",
      "pageOrAnchor": "内置章节键 thyroid-nodule；原HTML标注原书页88–90"
    },
    "reading": "甲状腺结节评估结合病史、体征、甲状腺功能及超声等信息；必要时进一步检查。结节的存在与性质是不同的问题。",
    "tags": [
      "甲状腺结节",
      "风险评估",
      "诊断思路"
    ]
  }
]
;
};
modules["data/study-config.json"]=function(require,module,exports){
module.exports={
  "enabled": false,
  "scaleId": null,
  "scaleVersion": null,
  "instructions": "",
  "responseOptions": [],
  "items": [],
  "itemsPerBreak": 2,
  "consentText": "",
  "recallWindow": null,
  "studyId": "baiyi-burnout-pilot",
  "assessmentWindowHours": 24,
  "configurationNote": "待核对获授权的具体量表版本、原版指导语、原版题序、作答选项、回顾时间及研究知情同意文本后导入。当前不展示或采集量表。24小时仅为技术默认，须研究方案确认。",
  "importFormatNote": "授权题目格式为 {id, text, originalOrder}，选项格式为 {value, label}；本配置不含任何真实题目。模块不计算分数。"
}
;
};
modules["data/media-config.js"]=function(require,module,exports){
'use strict';
// HTTPS base for WeChat media. Keep chXX.mp4 and side/*.mp4 below the same base.
// Browser index uses media/ paths; the standalone HTML embeds every video in the current chapter and side-story catalogs.
// Configure the WeChat media domain before release. Never put credentials here.
module.exports={baseUrl:'',localFolder:'media/',enableNativeVideo:true};

};
modules["data/leaderboard-config.json"]=function(require,module,exports){
module.exports={
  "enabled": false,
  "envId": "",
  "functionName": "baiyiLeaderboard",
  "longestMetric": "actionCount",
  "restorePolicy": "allow_server_replay"
}
;
};
function norm(p){const a=[];p.split("/").forEach(x=>{if(x==="..")a.pop();else if(x&&x!==".")a.push(x)});return a.join("/")}function req(name,from){let key=norm((from?from.slice(0,from.lastIndexOf("/")+1):"")+name);if(!/\.(js|json)$/.test(key))key+=".js";if(cache[key])return cache[key].exports;if(!modules[key])throw Error("Missing module "+key);const m={exports:{}};cache[key]=m;modules[key](n=>req(n,key),m,m.exports);return m.exports;}req("src/app.js","");})();