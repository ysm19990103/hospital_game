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
