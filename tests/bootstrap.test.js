'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'game.js'), 'utf8');

function boot(overrides = {}) {
  const calls = { loads: [], modals: [], loading: [], hides: 0, exits: 0, apps: [] };
  const wx = {
    loadSubpackage(options) { calls.loads.push(options); },
    showLoading(options) { calls.loading.push(options); },
    hideLoading() { calls.hides++; },
    showModal(options) { calls.modals.push(options); },
    exitMiniProgram() { calls.exits++; },
    createCanvas() { throw new Error('Bootstrap must not create a canvas'); },
    ...overrides
  };
  vm.runInNewContext(source, { wx, require(name) { calls.apps.push(name); } }, { filename: 'game.js' });
  return calls;
}

test('native bootstrap waits for both resource packages and starts app once', () => {
  const calls = boot();
  assert.equal(calls.loads.length, 1);
  assert.equal(calls.loads[0].name, 'scenes');
  assert.equal(calls.loading[0].title, '正在进入医院');
  assert.equal(calls.loading[0].mask, true);
  assert.deepEqual(calls.apps, []);
  calls.loads[0].success();
  assert.equal(calls.loads.length, 2);
  assert.equal(calls.loads[1].name, 'outfits');
  assert.deepEqual(calls.apps, []);
  assert.equal(calls.hides, 0);
  calls.loads[0].success();
  calls.loads[0].fail();
  calls.loads[1].success();
  calls.loads[1].success();
  calls.loads[1].fail();
  assert.deepEqual(calls.apps, ['./src/app']);
  assert.equal(calls.hides, 1);
  assert.equal(calls.modals.length, 0);
});

test('failed load offers retry; stale callbacks cannot start or interrupt the next attempt', () => {
  const calls = boot();
  const first = calls.loads[0];
  first.fail();
  assert.equal(calls.hides, 1);
  assert.equal(calls.modals[0].confirmText, '重试');
  assert.equal(calls.modals[0].cancelText, '退出');
  calls.modals[0].success({ confirm: true });
  assert.equal(calls.loads.length, 2);
  first.success();
  first.fail();
  calls.modals[0].success({ confirm: true });
  assert.deepEqual(calls.apps, []);
  assert.equal(calls.loads.length, 2);
  assert.equal(calls.modals.length, 1);
  calls.loads[1].success();
  assert.deepEqual(calls.apps, []);
  calls.loads[2].success();
  assert.deepEqual(calls.apps, ['./src/app']);
  assert.equal(calls.hides, 2);
});

test('cancel after load failure exits without starting app', () => {
  const calls = boot();
  calls.loads[0].fail();
  calls.modals[0].success({ cancel: true });
  assert.equal(calls.exits, 1);
  assert.deepEqual(calls.apps, []);
});

test('synchronous load errors also hide loading and offer recovery', () => {
  const calls = boot({ loadSubpackage() { throw new Error('network unavailable'); } });
  assert.equal(calls.hides, 1);
  assert.equal(calls.modals.length, 1);
  assert.equal(calls.modals[0].title, '资源加载失败');
  assert.deepEqual(calls.apps, []);
});

test('missing subpackage capability asks to upgrade without entering the app', () => {
  const calls = boot({ loadSubpackage: undefined });
  assert.equal(calls.loads.length, 0);
  assert.equal(calls.loading.length, 0);
  assert.equal(calls.modals[0].title, '请升级微信');
  assert.equal(calls.modals[0].showCancel, false);
  assert.deepEqual(calls.apps, []);
  calls.modals[0].success({ confirm: true });
  assert.equal(calls.exits, 1);
});

test('failure of the second package still blocks startup and allows a complete retry', () => {
  const calls = boot();
  calls.loads[0].success();
  calls.loads[1].fail();
  assert.deepEqual(calls.apps, []);
  assert.equal(calls.hides, 1);
  calls.modals[0].success({ confirm: true });
  assert.equal(calls.loads[2].name, 'scenes');
  calls.loads[1].success();
  assert.deepEqual(calls.apps, []);
  calls.loads[2].success();
  calls.loads[3].success();
  assert.deepEqual(calls.apps, ['./src/app']);
});

test('package configuration preserves asset paths and includes empty entries', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'game.json'), 'utf8'));
  assert.deepEqual(config.subpackages, [{ name: 'scenes', root: 'assets/scenes' }, { name: 'outfits', root: 'assets/outfits' }]);
  for (const pkg of config.subpackages) {
    assert.equal(fs.readFileSync(path.join(root, pkg.root, 'game.js'), 'utf8').trim(), '');
  }
});
