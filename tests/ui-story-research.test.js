'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const appPath = path.resolve(__dirname, '../src/app.js');
const appRequire = createRequire(appPath);

function boot() {
  const values = new Map(), draws = [], players = [];
  let frame, listener;
  const gradient={addColorStop(){}};
  const ctx = new Proxy({measureText:t=>({width:String(t).length*10}),createLinearGradient:()=>gradient,
    fillText:t=>draws.push(String(t)),globalAlpha:1}, {get:(obj,key)=>key in obj?obj[key]:()=>{}});
  const platform = {native:false,canvas:{style:{},getContext:()=>ctx},size:()=>({w:1280,h:720,dpr:1}),
    storage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>{values.set(k,v);return true;}},
    image:()=>null,setResize(){},raf:fn=>{frame=fn;},bind:fn=>{listener=fn;},closeVideo(){},
    playVideo:(src,rect,onClose,onError,options)=>players.push({src,rect,onClose,onError,options})};
  const context={window:{},location:{search:''},URLSearchParams,console,setTimeout,clearTimeout,
    require:name=>name==='./platform'?platform:appRequire(name),module:{exports:{}},exports:{}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(appPath,'utf8'),context,{filename:appPath});
  const app=context.window.BAIYI_APP;
  function render(){draws.length=0;frame(100);return app.buttons();}
  function click(label){const b=render().find(b=>b.label===label);assert.ok(b,`Missing button: ${label}`);assert.equal(b.disabled,false,label);listener('down',{x:b.x+b.w/2,y:b.y+b.h/2});}
  return {app,render,click,players,values,draws,context,platform};
}

function ready(h){h.app.start();h.app.game.state.hp=100;h.app.game.state.energy=100;h.app.game.state.event=null;}

test('research is visible in the main action row and opens a zero-time deadline explanation',()=>{
  const h=boot();ready(h);h.app.game.state.researchIdleUnits=22;
  const before=h.app.game.state.actionCount;
  h.render();assert.ok(h.draws.includes('科研期限：还剩 0天3次行动'));
  h.click('科研申请');assert.equal(h.app.getModal().type,'risk');h.render();
  assert.ok(h.draws.some(s=>s.includes('每5个游戏日至少完成一次科研')));
  assert.equal(h.app.game.state.actionCount,before);assert.equal(h.app.game.state.researchIdleUnits,22);
});

test('first main video warns at one-day deadline; choosing research keeps movie and time untouched',()=>{
  const h=boot();ready(h);h.app.game.state.researchIdleUnits=20;
  h.click('播放本章剧情');assert.equal(h.app.getModal().type,'researchVideoWarning');
  assert.equal(h.players.length,0);assert.equal(h.app.game.state.videoDays,0);
  h.click('先做科研');assert.equal(h.app.getModal().type,'risk');assert.equal(h.app.getModal().action,'research');
  assert.equal(h.app.game.state.researchIdleUnits,20);assert.equal(h.app.game.state.actionCount,0);
});

test('explicitly continuing warned video reaches the real research failure and memorial',()=>{
  const h=boot();ready(h);const g=h.app.game;g.state.researchIdleUnits=20;
  h.click('播放本章剧情');h.click('仍然继续观看');assert.equal(h.players.length,1);
  h.players[0].onClose({reason:'ended',currentTime:100,duration:100});
  assert.equal(g.state.status,'failure');assert.equal(g.state.failure.id,'research_absence');
  assert.equal(g.getMemorial().total,1);assert.equal(h.app.getModal(),null);
});

test('completed main video replay bypasses deadline warning and does not age the deadline',()=>{
  const h=boot();ready(h);const g=h.app.game;g.state.completedVideos=[g.state.chapterId];g.state.researchIdleUnits=24;
  h.click('重看本章剧情');assert.equal(h.players.length,1);assert.equal(h.app.getModal(),null);
  h.players[0].onClose({reason:'ended',currentTime:100,duration:100});
  assert.equal(g.state.status,'playing');assert.equal(g.state.researchIdleUnits,24);assert.equal(g.state.videoDays,0);
});

test('side video uses the same deadline warning and research escape without advancing time',()=>{
  const h=boot();ready(h);h.app.game.state.researchIdleUnits=23;h.app.setScreen('sideStories');
  h.click('观看故事');assert.equal(h.app.getModal().type,'researchVideoWarning');assert.equal(h.players.length,0);
  h.click('先做科研');assert.equal(h.app.getModal().action,'research');assert.equal(h.app.getScreen(),'play');
  assert.equal(h.app.game.state.researchIdleUnits,23);assert.equal(h.app.game.state.completedSideVideos.length,0);
});

test('new story intro is free and survives a pause so resume does not repeat it',()=>{
  const h=boot();ready(h);const chapter=h.app.chapters.find(c=>c.transitionIntro);
  assert.ok(chapter,'Expanded catalogue must be assembled before UI verification');
  const g=h.app.game;g.state.chapterId=chapter.id;g.state.researchIdleUnits=0;
  h.click('播放本章剧情');assert.equal(h.app.getModal().type,'storyIntro');assert.equal(h.players.length,0);
  h.click('进入剧情');assert.equal(h.players.length,1);assert.equal(g.state.actionCount,0);
  h.players[0].onClose({reason:'pause',currentTime:20,duration:300});
  h.click('继续播放 · 0:20');assert.equal(h.players.length,2);assert.equal(h.app.getModal(),null);
  assert.equal(h.players[1].options.startTime,20);assert.equal(g.state.videoDays,0);
});

test('legacy complete journey can enter earliest inserted chapter without resetting old results',()=>{
  const h=boot();ready(h);const g=h.app.game,old=h.app.chapters.filter(c=>Number(c.id)<=29);
  const missing=h.app.chapters.filter(c=>Number(c.id)>29);
  assert.ok(missing.length,'Expanded catalogue must be assembled before UI verification');
  g.state.chapterResults=Object.fromEntries(old.map(c=>[String(c.id),{chapterId:c.id,title:c.title}]));
  g.state.completedVideos=old.map(c=>c.id);g.state.chapterId=27;g.state.status='complete';
  g.state.finalEnding={title:'旧日终章',text:'已经走过的旅程。'};
  const next=g.getNextUnfinishedChapter();
  h.click('回望补入的往事 · '+next.title);
  assert.equal(g.state.chapterId,next.id);assert.equal(g.state.status,'playing');
  assert.equal(Object.keys(g.state.chapterResults).length,old.length);
  assert.equal(g.state.completedVideos.length,old.length);assert.equal(h.app.getModal().type,'storyIntro');
});


test('last-action preparation clearly warns it is not research and offers a zero-time return to research',()=>{
  const h=boot();ready(h);const g=h.app.game;g.state.researchIdleUnits=24;
  h.click('科研申请');h.render();assert.ok(h.draws.includes('事前准备不算完成科研。'));
  h.click('准备将导致逾期');h.render();
  assert.ok(h.draws.includes('此时再花1次行动准备会触发科研逾期，请直接完成科研。'));
  const prep=h.app.buttons().find(b=>b.label==='检查标书：核实依据');assert.ok(prep);assert.equal(prep.disabled,false);
  h.click('直接完成科研 · 查看风险');assert.equal(h.app.getModal().action,'research');
  assert.equal(g.state.researchIdleUnits,24);assert.equal(g.state.actionCount,0);
});
