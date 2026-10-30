'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/platform'), 'utf8');

function nativePlatform(overrides = {}) {
  const listeners = {};
  let reads = 0;
  const wx = {
    createCanvas: () => ({}),
    getWindowInfo: () => { reads++; return { windowWidth: 800, windowHeight: 450, pixelRatio: 3 }; },
    getStorageSync: () => '',
    setStorageSync: () => {},
    removeStorageSync: () => {},
    onTouchStart: fn => { listeners.down = fn; },
    onTouchMove: fn => { listeners.move = fn; },
    onTouchEnd: fn => { listeners.up = fn; },
    onTouchCancel: fn => { listeners.cancel = fn; },
    onWindowResize: fn => { listeners.resize = fn; },
    onHide: fn => { listeners.hide = fn; },
    ...overrides,
  };
  const context = { wx, module: { exports: {} }, requestAnimationFrame: () => {} };
  vm.runInNewContext(source, context);
  return { platform: context.module.exports, wx, listeners, reads: () => reads };
}

function player(overrides = {}) {
  const v = {
    destroyed: 0,
    paused: 0,
    removedListeners: [],
    onEnded(fn) { this.ended = fn; },
    onError(fn) { this.error = fn; },
    onTimeUpdate(fn) { this.timeUpdate = fn; },
    onPause(fn) { this.pausedEvent = fn; },
    onPlay(fn) { this.playedEvent = fn; },
    offEnded(fn) { this.removedListeners.push(['ended', fn]); },
    offError(fn) { this.removedListeners.push(['error', fn]); },
    offTimeUpdate(fn) { this.removedListeners.push(['timeUpdate', fn]); },
    offPause(fn) { this.removedListeners.push(['pause', fn]); },
    offPlay(fn) { this.removedListeners.push(['play', fn]); },
    play() { return Promise.resolve(); },
    pause() { this.paused++; return Promise.resolve(); },
    stop() { return Promise.resolve(); },
    destroy() { this.destroyed++; },
    ...overrides,
  };
  return v;
}
const rect = { x: 0, y: 0, w: 640, h: 360 };
const plain = value => JSON.parse(JSON.stringify(value));
const settled = () => new Promise(resolve => setImmediate(resolve));

function browserPlatform(options = {}) {
  const windowEvents = {}, documentEvents = {}, videos = [], buttons = [], appended = [];
  const createdUrls = [], revokedUrls = [], decoded = [];
  const canvas = { addEventListener() {}, setPointerCapture() {} };
  const window = {
    innerWidth: 800, innerHeight: 450, devicePixelRatio: 1,
    addEventListener(name, fn) { windowEvents[name] = fn; },
    BAIYI_VIDEOS: options.embedded,
    Blob,
    atob(value) { assert.equal(this, window); decoded.push(value); return atob(value); },
    URL: {
      createObjectURL(blob) { createdUrls.push(blob); return `blob:chapter-${createdUrls.length}`; },
      revokeObjectURL(url) { revokedUrls.push(url); },
    },
  };
  const document = {
    hidden: false,
    getElementById: () => canvas,
    addEventListener(name, fn) { documentEvents[name] = fn; },
    body: { appendChild(node) { appended.push(node); } },
    createElement(kind) {
      if(kind === 'button') {
        const b = { style: {}, removed: 0, remove() { this.removed++; } };
        buttons.push(b); return b;
      }
      assert.equal(kind, 'video');
      const v = {
        style: {}, currentTime: 0, duration: NaN, readyState: 0,
        paused: 0, removed: 0, loadCalls: 0, playCalls: 0,
        play() { this.playCalls++; return options.play ? options.play(this) : Promise.resolve(); },
        pause() { this.paused++; if(this.onpause)this.onpause(); },
        removeAttribute(name) { if(name === 'src')this.src = ''; },
        load() { this.loadCalls++; },
        remove() { this.removed++; },
      };
      videos.push(v); return v;
    },
  };
  const context = { module: { exports: {} }, window, document, requestAnimationFrame() {} };
  vm.runInNewContext(source, context);
  return { platform: context.module.exports, window, document, windowEvents, documentEvents, videos, buttons, appended, createdUrls, revokedUrls, decoded };
}

test('storage reports failed writes and failed removal explicitly', () => {
  const { platform: p, wx } = nativePlatform();
  assert.equal(p.storage.setItem('key', 'value'), true);
  assert.equal(p.storage.removeItem('key'), true);
  wx.setStorageSync = wx.removeStorageSync = () => { throw new Error('storage failed'); };
  assert.equal(p.storage.setItem('key', 'value'), false);
  assert.equal(p.storage.removeItem('key'), false);
});

test('replaced video callbacks cannot close the current player', () => {
  const first = player();
  const second = player({ stop() { throw new Error('stop failed'); } });
  let next = first, firstEnd = 0, secondEnd = 0, errors = 0;
  const { platform: p } = nativePlatform({ createVideo: () => next });
  p.playVideo('first.mp4', rect, () => { firstEnd++; }, () => { errors++; });
  const oldEnded = first.ended, oldError = first.error;
  next = second;
  p.playVideo('second.mp4', rect, () => { secondEnd++; }, () => { errors++; });
  oldEnded();
  oldError(new Error('late network error'));
  assert.equal(first.destroyed, 1);
  assert.equal(firstEnd, 0);
  assert.equal(second.destroyed, 0);
  assert.equal(errors, 0);
  p.closeVideo();
  p.closeVideo();
  assert.equal(second.destroyed, 1, 'destroy still runs when stop throws');
  assert.equal(secondEnd, 1);
});

test('video creation and play rejection complete the error path once', async () => {
  let ended = 0, errors = 0;
  const reasons = [];
  const rejected = player({
    play: () => Promise.reject(new Error('play failed')),
    stop: () => Promise.reject(new Error('already stopped')),
  });
  const { platform: p, wx } = nativePlatform({ createVideo: () => rejected });
  p.playVideo('broken.mp4', rect, result => { ended++; reasons.push(result.reason); }, () => { errors++; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ended, 1);
  assert.equal(errors, 1);
  assert.equal(rejected.destroyed, 1);
  assert.deepEqual(reasons, ['error']);
  rejected.error(new Error('duplicate error'));
  assert.equal(errors, 1);
  wx.createVideo = () => { throw new Error('creation failed'); };
  p.playVideo('missing.mp4', rect, () => { ended++; }, () => { errors++; });
  assert.equal(ended, 2);
  assert.equal(errors, 2);
});

test('dimensions are cached until resize, which closes the independent video layer', () => {
  const v = player();
  const h = nativePlatform({ createVideo: () => v });
  let ended = 0, resized = 0, outcome;
  h.platform.bind(() => {});
  h.platform.setResize(() => { resized++; });
  for (let i = 0; i < 10; i++) h.platform.size();
  assert.equal(h.reads(), 1);
  assert.equal(h.platform.size().dpr, 2);
  h.platform.playVideo('clip.mp4', rect, value => { ended++; outcome = value; });
  h.wx.getWindowInfo = () => ({ windowWidth: 900, windowHeight: 500, pixelRatio: 1 });
  h.listeners.resize();
  assert.equal(h.platform.size().w, 900);
  assert.equal(resized, 1);
  assert.equal(ended, 1);
  assert.equal(v.destroyed, 1);
  assert.equal(outcome.reason, 'resize');
});

test('native initialTime, position progress, hide pause and real ended stay distinct', () => {
  const v = player(), progress = [], outcomes = [], input = [];
  let creation;
  const h = nativePlatform({ createVideo: options => { creation = options; return v; } });
  h.platform.bind(kind => input.push(kind));
  h.platform.playVideo('media/ch01.mp4', rect, value => outcomes.push(plain(value)), null,
    { startTime: 12, onProgress: value => progress.push(plain(value)) });
  assert.equal(creation.initialTime, 12);
  assert.equal(creation.controls, true);
  assert.equal(creation.showCenterPlayBtn, true);
  assert.equal(creation.objectFit, 'contain');
  assert.equal(creation.muted, false);
  v.timeUpdate({ position: 18.5, duration: 90 });
  h.listeners.hide();
  assert.deepEqual(progress.at(-1), { currentTime: 18.5, duration: 90 });
  assert.equal(v.paused, 1);
  assert.equal(v.destroyed, 0);
  assert.deepEqual(input, ['hide']);
  assert.equal(outcomes.length, 0);
  const staleTimeUpdate = v.timeUpdate;
  v.ended(); v.ended(); staleTimeUpdate({ position: 0, duration: 90 });
  assert.deepEqual(outcomes, [{ reason: 'ended', currentTime: 90, duration: 90 }]);
  assert.deepEqual(progress.at(-1), { currentTime: 90, duration: 90 });
  assert.equal(v.removedListeners.length, 5);
  assert.equal(v.removedListeners.find(([name]) => name === 'timeUpdate')[1], staleTimeUpdate);
});

test('manual close cannot impersonate natural completion and preserves native progress', () => {
  const v = player(), outcomes = [];
  const { platform: p } = nativePlatform({ createVideo: () => v });
  p.playVideo('clip.mp4', rect, result => outcomes.push(plain(result)));
  v.timeUpdate({ position: 30, duration: 100 });
  p.closeVideo('ended'); v.ended(); p.closeVideo();
  assert.deepEqual(outcomes, [{ reason: 'closed', currentTime: 30, duration: 100 }]);
});

test('browser restores on metadata, records progress and pauses when hidden without completing', () => {
  const h = browserPlatform(), progress = [], outcomes = [], inputs = [];
  h.platform.bind(kind => inputs.push(kind));
  h.platform.playVideo('media/ch02.mp4', rect, result => outcomes.push(plain(result)), null,
    { startTime: 22, onProgress: value => progress.push(plain(value)) });
  const v = h.videos[0];
  assert.equal(v.currentTime, 0, 'wait for metadata before seeking');
  assert.equal(v.controls, true); assert.equal(v.playsInline, true);
  assert.match(v.style.cssText, /object-fit:contain/);
  assert.equal(v.src, 'media/ch02.mp4');
  v.duration = 80; v.readyState = 1; v.onloadedmetadata();
  assert.equal(v.currentTime, 22);
  v.currentTime = 35.25; v.ontimeupdate();
  h.document.hidden = true; h.documentEvents.visibilitychange();
  assert.deepEqual(progress.at(-1), { currentTime: 35.25, duration: 80 });
  assert.equal(v.paused, 1); assert.equal(v.removed, 0);
  assert.equal(outcomes.length, 0); assert.deepEqual(inputs, ['hide']);
  h.platform.closeVideo();
  assert.deepEqual(outcomes, [{ reason: 'closed', currentTime: 35.25, duration: 80 }]);
  assert.equal(v.onended, null); assert.equal(v.ontimeupdate, null);
  assert.equal(v.onloadedmetadata, null); assert.equal(v.src, '');
  assert.equal(v.removed, 1); assert.equal(v.loadCalls, 1);
});

test('browser autoplay refusal leaves native controls and a usable central play button', async () => {
  let blocked = true;
  const h = browserPlatform({ play() {
    if(blocked)return Promise.reject(Object.assign(new Error('gesture required'), { name: 'NotAllowedError' }));
    return Promise.resolve();
  } });
  const outcomes = [], errors = [];
  h.platform.playVideo('https://example.test/ch03.mp4', rect, value => outcomes.push(plain(value)), error => errors.push(error));
  await settled();
  const v = h.videos[0], button = h.buttons[0];
  assert.equal(v.removed, 0); assert.equal(v.controls, true);
  assert.equal(v.src, 'https://example.test/ch03.mp4');
  assert.equal(button.textContent, '点击播放');
  assert.equal(typeof button.onclick, 'function');
  assert.equal(errors.length, 0); assert.equal(outcomes.length, 0);
  blocked = false; button.onclick(); await settled();
  assert.equal(v.playCalls, 2); assert.equal(button.removed, 1);
  assert.equal(button.onclick, null);
  v.duration = 75; v.currentTime = 75; v.onended();
  assert.deepEqual(outcomes, [{ reason: 'ended', currentTime: 75, duration: 75 }]);
});

test('embedded videos decode only the selected chapter and release each object URL once', async () => {
  const embedded = { 'media/ch01.mp4': btoa('chapter one'), 'media/ch02.mp4': btoa('chapter two') };
  Object.defineProperty(embedded, 'media/ch29.mp4', { enumerable: true, get() { throw new Error('must not decode unseen chapters'); } });
  const h = browserPlatform({ embedded }), outcomes = [], progress = [];
  assert.equal(h.decoded.length, 0);
  h.platform.playVideo('media/ch01.mp4', rect, result => outcomes.push(result), null,
    { startTime: 14, onProgress: value => progress.push(plain(value)) });
  const first = h.videos[0], oldEnded = first.onended, oldError = first.onerror, oldTime = first.ontimeupdate;
  assert.equal(first.src, 'blob:chapter-1');
  assert.equal(h.decoded.length, 1);
  assert.equal(h.createdUrls[0].type, 'video/mp4');
  assert.equal(await h.createdUrls[0].text(), 'chapter one');
  h.platform.playVideo('media/ch02.mp4', rect, result => outcomes.push(plain(result)));
  assert.deepEqual(progress.at(-1), { currentTime: 14, duration: 0 }, 'early close retains requested resume position');
  assert.equal(h.decoded.length, 2); assert.equal(h.videos[1].src, 'blob:chapter-2');
  assert.deepEqual(h.revokedUrls, ['blob:chapter-1']);
  oldEnded(); oldError(new Error('late failure')); oldTime();
  assert.equal(h.videos[1].removed, 0); assert.equal(outcomes.length, 0);
  h.videos[1].duration = 20; h.videos[1].currentTime = 20; h.videos[1].onended();
  h.platform.closeVideo();
  assert.deepEqual(h.revokedUrls, ['blob:chapter-1', 'blob:chapter-2']);
  assert.deepEqual(outcomes, [{ reason: 'ended', currentTime: 20, duration: 20 }]);
});

test('browser decoder or media failures report error and release allocated resources', () => {
  const h = browserPlatform({ embedded: { bad: '%%%', good: btoa('mp4') } });
  const outcomes = [], errors = [];
  const onEnd = value => outcomes.push(plain(value));
  const onError = (error, result) => errors.push({ error, result: plain(result) });
  h.platform.playVideo('bad', rect, onEnd, onError, { startTime: 8 });
  assert.equal(outcomes[0].reason, 'error'); assert.equal(outcomes[0].currentTime, 8);
  assert.equal(errors.length, 1); assert.equal(h.videos[0].removed, 1);
  h.platform.playVideo('good', rect, onEnd, onError);
  const v = h.videos[1], stale = v.onerror;
  v.currentTime = 17; v.duration = 40; v.onerror(new Error('decode failed')); stale(new Error('again'));
  assert.deepEqual(outcomes[1], { reason: 'error', currentTime: 17, duration: 40 });
  assert.deepEqual(errors[1].result, outcomes[1]);
  assert.equal(errors.length, 2); assert.deepEqual(h.revokedUrls, ['blob:chapter-1']);
});

test('browser blur cancels held input without forcing an autosave', () => {
  const windowEvents = {};
  const canvas = { addEventListener() {}, setPointerCapture() {} };
  const context = {
    module: { exports: {} },
    document: { getElementById: () => canvas, addEventListener() {} },
    window: {
      innerWidth: 800, innerHeight: 450, devicePixelRatio: 1,
      addEventListener: (name, fn) => { windowEvents[name] = fn; },
    },
    requestAnimationFrame() {},
  };
  vm.runInNewContext(source, context);
  const received = [];
  context.module.exports.bind(kind => received.push(kind));
  windowEvents.blur();
  assert.deepEqual(received, ['cancel']);
});
