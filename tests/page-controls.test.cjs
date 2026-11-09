const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { pageVisible, controlPoint, exposeControl, clickCommentTab } = require('../src/page-controls.cjs');

test('comment tab opens through its own handler when a coordinate click is covered', () => {
  let clicked = 0;
  const button = { matches: () => false, click: () => { clicked++; } };
  const tab = { closest: () => button };
  const context = vm.createContext({ commentControls: () => ({ tab }), pageVisible: () => true });
  assert.equal(vm.runInContext(`(${clickCommentTab.toString()})()`, context), true);
  assert.equal(clicked, 1);
});

test('comment editor remains clickable when its own placeholder covers the center', () => {
  const rect = { left: 10, right: 210, top: 20, bottom: 80, width: 200, height: 60 };
  const root = { contains: node => node === placeholder };
  const placeholder = {};
  const editor = {
    isContentEditable: true, parentElement: { parentElement: root },
    closest: () => null, contains: () => false,
    getBoundingClientRect: () => rect
  };
  const context = vm.createContext({
    innerWidth: 400, innerHeight: 300,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    document: { elementFromPoint: () => placeholder },
    pageVisible: vm.runInNewContext(`(${pageVisible.toString()})`, {
      innerWidth: 400, innerHeight: 300,
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' })
    })
  });
  const point = vm.runInContext(`(${controlPoint.toString()})(editor)`, Object.assign(context, { editor }));
  assert.equal(point.x, 110);
  assert.equal(point.y, 50);
});

test('send button is brought into a resized scrolling comment panel', () => {
  let top = 420;
  const panel = {
    tagName: 'SECTION', scrollHeight: 700, clientHeight: 140,
    parentElement: { tagName: 'BODY' },
    getBoundingClientRect: () => ({ left: 0, right: 300, top: 20, bottom: 160 })
  };
  Object.defineProperty(panel, 'scrollTop', { get: () => 420 - top, set: value => { top = 420 - value; } });
  const button = {
    isContentEditable: false, parentElement: panel, contains: () => false,
    getBoundingClientRect: () => ({ left: 20, right: 120, top, bottom: top + 30, width: 100, height: 30 })
  };
  const context = vm.createContext({
    innerWidth: 400, innerHeight: 300, button,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1', overflowY: 'auto' }),
    document: { elementFromPoint: (_x, y) => y >= 20 && y <= 160 ? button : null },
    pageVisible: node => { const r = node.getBoundingClientRect(); return r.top < 300 && r.bottom > 0; }
  });
  vm.runInContext(`const controlPoint = ${controlPoint.toString()}; const exposeControl = ${exposeControl.toString()};`, context);
  const point = vm.runInContext('exposeControl(button)', context);
  assert.ok(point && point.y < 160);
});
