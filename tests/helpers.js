'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { URL } = require('url');

const ROOT = path.join(__dirname, '..');
const spoofSrc = fs.readFileSync(path.join(ROOT, 'spoof.js'), 'utf8');
const domainsSrc = fs.readFileSync(path.join(ROOT, 'domains.js'), 'utf8');

/** 原生 Navigator 桩：language/languages/geolocation/permissions 均为原型访问器（对齐 Chrome）。 */
function buildNavigator() {
  const proto = {};
  const geo = Object.create({ getCurrentPosition() {}, watchPosition() {}, clearWatch() {} });
  Object.defineProperty(proto, 'language', { get() { return 'zh-CN'; }, enumerable: true, configurable: true });
  Object.defineProperty(proto, 'languages', { get() { return ['zh-CN', 'zh']; }, enumerable: true, configurable: true });
  Object.defineProperty(proto, 'geolocation', { get() { return geo; }, enumerable: true, configurable: true });

  function PermissionStatus(state) { this._state = state; }
  Object.defineProperty(PermissionStatus.prototype, 'state', {
    get() { return this._state; }, enumerable: true, configurable: true
  });
  const Permissions = function Permissions() {};
  Permissions.prototype.query = function query() {
    return Promise.resolve(new PermissionStatus('prompt'));
  };
  const perms = Object.create(Permissions.prototype);
  Object.defineProperty(proto, 'permissions', { get() { return perms; }, enumerable: true, configurable: true });

  const nav = Object.create(proto);
  return { nav, proto, Permissions, PermissionStatus, geo, perms };
}

/** 原生 WebRTC 桩：原型 accessor + 方法，实例零自有属性。 */
function buildNativeRtc() {
  function RTCPeerConnection() {}
  RTCPeerConnection.generateCertificate = function generateCertificate() { return Promise.resolve({}); };
  const proto = RTCPeerConnection.prototype;
  const state = new WeakMap();
  const ensure = (pc) => {
    if (!state.has(pc)) state.set(pc, { signalingState: 'stable', localDescription: null, handlers: {} });
    return state.get(pc);
  };
  Object.defineProperty(proto, 'signalingState', {
    get() { return ensure(this).signalingState; }, enumerable: true, configurable: true
  });
  Object.defineProperty(proto, 'localDescription', {
    get() { return ensure(this).localDescription; }, enumerable: true, configurable: true
  });
  Object.defineProperty(proto, 'canTrickleIceCandidates', {
    get() { return null; }, enumerable: true, configurable: true
  });
  Object.defineProperty(proto, 'onicecandidate', {
    get() { return ensure(this).handlers.icecandidate || null; },
    set(fn) { ensure(this).handlers.icecandidate = fn; },
    enumerable: true, configurable: true
  });
  ['createOffer', 'createAnswer', 'setLocalDescription', 'setRemoteDescription', 'addIceCandidate',
    'close', 'getStats', 'addTrack', 'removeTrack', 'getSenders', 'getReceivers', 'getTransceivers',
    'setConfiguration', 'getConfiguration', 'addEventListener', 'removeEventListener', 'dispatchEvent',
    'createDataChannel', 'restartIce', 'addTransceiver', 'createDTMFSender', 'addStream', 'removeStream',
    'getLocalStreams', 'getRemoteStreams'].forEach((m) => {
    proto[m] = function () { return Promise.resolve(); };
  });
  function RTCSessionDescription(init) { this.type = init.type; this.sdp = init.sdp; }
  RTCSessionDescription.prototype.toJSON = function () { return { type: this.type, sdp: this.sdp }; };
  function RTCIceCandidate(init) { Object.assign(this, init); }
  function Event(type) { this.type = type; }
  Object.defineProperty(Event.prototype, 'isTrusted', { get() { return false; } });
  return { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, Event };
}

/**
 * 创建独立 V8 realm 的页面环境。
 * @param {object} opts hostname/cfg/src/rtc/worker/ancestorOrigins/referrer/href/noDocument
 */
function createPage(opts = {}) {
  const hostname = opts.hostname === undefined ? 'example.com' : opts.hostname;
  const PageURL = class extends URL {};   // 每页独立，避免 createObjectURL 桩污染宿主 URL
  const sb = {
    console,
    setTimeout, clearTimeout,
    location: {
      hostname,
      href: opts.href || ('https://' + (hostname || 'example.com') + '/'),
      protocol: 'https:',
      ancestorOrigins: opts.ancestorOrigins
    },
    navigator: buildNavigator().nav,
    CFG: opts.cfg,
    SRC: opts.src,
    listeners: {},
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      const list = this.listeners[type] || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    URL: PageURL
  };
  if (!opts.noDocument) {
    const attrs = {};
    sb.document = {
      referrer: opts.referrer || '',
      documentElement: {
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
        setAttribute(k, v) { attrs[k] = String(v); },
        removeAttribute(k) { delete attrs[k]; }
      }
    };
  }
  if (opts.rtc) Object.assign(sb, buildNativeRtc());
  sb.Navigator = function Navigator() {};
  if (opts.worker) {
    const NativeWorker = function Worker(url, options) {
      this.url = url; this.options = options; NativeWorker.instances.push(this);
    };
    NativeWorker.instances = [];
    sb.Worker = NativeWorker;
    sb.Blob = class Blob {
      constructor(parts, options) { this.parts = parts; this.type = options && options.type; }
    };
    let n = 0;
    PageURL.createObjectURL = (blob) => { PageURL.lastBlob = blob; return 'blob:mock-' + (++n); };
  }
  vm.createContext(sb);
  const g = vm.runInContext('this', sb);
  sb.window = g;
  sb.self = g;
  if (opts.workerEnv) sb.window = undefined;
  sb.Navigator.prototype = Object.getPrototypeOf(sb.navigator);
  return sb;
}

function runSpoof(sb) {
  // 与 background 注入方式一致：domains + spoof 同处一个闭包，不向页面泄漏任何全局名
  vm.runInContext('(function(){\n' + domainsSrc + '\n' + spoofSrc + '\n})();', sb, { filename: 'spoof-inject.js' });
  return sb;
}

function evaluate(sb, code) {
  return vm.runInContext(code, sb);
}

/** 极简测试运行器：支持 async 用例，输出失败明细并以退出码标记。 */
function createRunner() {
  const cases = [];
  const test = (name, fn) => cases.push({ name, fn });
  async function run() {
    const failures = [];
    for (const c of cases) {
      try {
        await c.fn();
        console.log('  ok  ' + c.name);
      } catch (e) {
        failures.push({ name: c.name, error: e });
        console.log('  FAIL ' + c.name + '\n       ' + (e && e.message));
      }
    }
    console.log(`\n${cases.length - failures.length}/${cases.length} passed`);
    if (failures.length) {
      console.log('FAILURES:\n' + failures.map(f => ' - ' + f.name).join('\n'));
      process.exitCode = 1;
    }
    return failures;
  }
  return { test, run };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'eq'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { createPage, runSpoof, evaluate, createRunner, assert, eq, sleep, spoofSrc, domainsSrc, ROOT };
