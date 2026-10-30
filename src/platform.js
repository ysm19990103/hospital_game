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
