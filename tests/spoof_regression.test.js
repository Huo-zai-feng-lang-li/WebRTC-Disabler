/**
 * spoof.js 回归测试（Node 桩环境，无第三方框架）。
 * 复现两个已坐实的 bug：
 *  A1 fake RTC 方法在 this 为 null/非实例时，异步 startGathering 读 __gathering 抛 TypeError；
 *  A2 Date.prototype.toString 分钟字段误用 map.min，输出 "undefined"。
 * 运行：node tests/spoof_regression.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'spoof.js'), 'utf8');

// ---- 桩浏览器环境 ----
const nav = {
  language: 'zh-CN',
  languages: ['zh-CN'],
  geolocation: {},
  permissions: { query: function () { return Promise.resolve({ state: 'prompt' }); } }
};

const sandbox = {
  console,
  setTimeout, clearTimeout, Promise, Object, Function, Array, Math, JSON,
  RegExp, Error, Intl, Date, Number, String, Boolean, Symbol, Reflect,
  navigator: nav,
  location: { hostname: 'example.com', href: 'https://example.com/', protocol: 'https:' },
  addEventListener: function () {}
};
sandbox.window = sandbox;
sandbox.Navigator = function () {};
sandbox.Navigator.prototype = nav;
vm.createContext(sandbox);

// 捕获异步未捕获异常（A1 崩溃发生在 setTimeout 内）
const uncaught = [];
process.on('uncaughtException', (e) => uncaught.push(e));

vm.runInContext(src, sandbox, { filename: 'spoof.js' });

const failures = [];
function assert(cond, msg) { if (!cond) failures.push(msg); }

async function main() {
  // A1-1 正常实例调用 createOffer 不应抛错
  const Pc = sandbox.RTCPeerConnection;
  assert(typeof Pc === 'function', 'RTCPeerConnection 已注入 window');
  const pc = new Pc();
  const offer = await pc.createOffer();
  assert(offer && typeof offer.sdp === 'string', '正常实例 createOffer 返回 SDP');

  // A1-2 方法解绑后以 null / undefined / 假对象调用，不应产生未捕获 TypeError
  const detachedOffer = Pc.prototype.createOffer;
  const detachedSet = Pc.prototype.setLocalDescription;
  await detachedOffer.call(null);
  await detachedOffer.call(undefined);
  await detachedOffer.call({ bogus: true });
  await detachedSet.call(null);
  await detachedSet.call(undefined);
  await new Promise(r => setTimeout(r, 80));
  const rtcCrash = uncaught.find(e => /__gathering|localDescription|signalingState/.test(e.message));
  assert(!rtcCrash, '无效 this 调用不抛实例属性 TypeError' + (rtcCrash ? `：${rtcCrash.message}` : ''));

  // A1-3 正常实例行为不变：setLocalDescription 应写入 localDescription
  const pc2 = new Pc();
  const desc = { type: 'offer', sdp: 'v=0' };
  await pc2.setLocalDescription(desc);
  assert(pc2.localDescription === desc, '正常实例 setLocalDescription 写入 localDescription');

  // A2 Date.toString 分钟字段不得为 undefined
  const ds = new sandbox.Date().toString();
  assert(!/undefined/.test(ds), 'Date.toString 不含 undefined，实际：' + ds);

  if (failures.length) {
    console.error('FAIL:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
  console.log('PASS: RTC 防护 + Date.toString 分钟字段 全部通过');
}

main().catch(e => { console.error('测试执行异常:', e); process.exit(1); });
