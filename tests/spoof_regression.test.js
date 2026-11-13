'use strict';

const assertNode = require('assert');
const { createPage, runSpoof, evaluate, createRunner, assert, eq, sleep } = require('./helpers');

const { test, run } = createRunner();

const BASE_CFG = {
  mode: 'split', webrtcMode: 'spoof', localeMode: 'spoof',
  tz: 'America/Los_Angeles', lang: 'en-US', langList: ['en-US', 'en'],
  geoLat: 34.0522, geoLng: -118.2437
};
const cfg = (o) => Object.assign({}, BASE_CFG, o);

function foreign(opts = {}) {
  return runSpoof(createPage(Object.assign({ hostname: 'example.com', cfg: cfg() }, opts)));
}

/** 跨 realm 的错误没有相同原型，按 name 判定，避免 assert.throws 的 realm 限制。 */
function throwsTypeError(fn, msg) {
  try { fn(); } catch (e) { eq(e.name, 'TypeError', msg); return; }
  throw new Error((msg || '') + '：未抛出异常');
}

// ---------- A. 配置通道与全局暴露 ----------
test('A1 不再暴露 __spoofNatives / __fakeRTC / __applySpoofConfig', () => {
  const sb = foreign({ rtc: true });
  ['__spoofNatives', '__fakeRTC', '__applySpoofConfig'].forEach(k => {
    eq(evaluate(sb, `typeof ${k}`), 'undefined', k);
  });
});

test('A2 配置通道只认一次性令牌：伪造消息无法降级', () => {
  const sb = foreign();
  const fire = (data) => (sb.listeners.message || []).slice().forEach(fn => fn({ data }));
  eq((sb.listeners.message || []).length, 1, '受保护页只装一个桥监听');
  // 无令牌 / 错令牌：一律忽略，配置仍是默认值
  fire({ __wds: 1, token: 'wrong', cfg: cfg({ tz: 'Asia/Tokyo', lang: 'ja-JP', webrtcMode: 'off' }) });
  fire({ __wds: 1, cfg: cfg({ tz: 'Asia/Tokyo', lang: 'ja-JP', webrtcMode: 'off' }) });
  eq(sb.navigator.language, 'en-US', '伪造消息不能改语言');
  eq(evaluate(sb, 'Intl.DateTimeFormat().resolvedOptions().timeZone'), 'America/Los_Angeles');
  const token = evaluate(sb, 'document.documentElement.getAttribute("data-wds-k")');
  assert(typeof token === 'string' && token.length >= 16, '令牌由 spoof 生成');
  // 正确令牌：应用一次后注销监听
  fire({ __wds: 1, token, cfg: cfg({ tz: 'Asia/Tokyo', lang: 'ja-JP', langList: ['ja-JP', 'ja'] }) });
  eq(sb.navigator.language, 'ja-JP', '正确令牌才生效');
  eq(evaluate(sb, 'new Date().getTimezoneOffset()'), -540);
  eq((sb.listeners.message || []).length, 0, '应用后立即注销监听');
  fire({ __wds: 1, token, cfg: cfg({ tz: 'Asia/Shanghai', lang: 'zh-CN' }) });
  eq(sb.navigator.language, 'ja-JP', '二次伪造被忽略');
});

test('A3 内联 CFG 同步生效（无 DEFAULTS 首帧跳变）', () => {
  const sb = runSpoof(createPage({
    hostname: 'example.com',
    cfg: cfg({ tz: 'Asia/Tokyo', lang: 'ja-JP', langList: ['ja-JP', 'ja'] })
  }));
  eq(evaluate(sb, 'Intl.DateTimeFormat().resolvedOptions().timeZone'), 'Asia/Tokyo');
  eq(sb.navigator.language, 'ja-JP');
  eq(evaluate(sb, 'new Date().getTimezoneOffset()'), -540);
});

// ---------- B. 国内页零改动 ----------
test('B1 国内页不装任何 hook', () => {
  const sb = createPage({ hostname: 'www.baidu.com', cfg: cfg(), rtc: true });
  const beforeGlobals = evaluate(sb, 'Object.getOwnPropertyNames(this).sort().join(",")');
  const beforeDate = evaluate(sb, 'Date.prototype.getTimezoneOffset');
  const beforeIntl = evaluate(sb, 'Intl.DateTimeFormat');
  const beforeFts = evaluate(sb, 'Function.prototype.toString');
  const beforeRtc = sb.RTCPeerConnection;
  runSpoof(sb);
  eq(evaluate(sb, 'Object.getOwnPropertyNames(this).sort().join(",")'), beforeGlobals, '全局名集合');
  eq(evaluate(sb, 'Date.prototype.getTimezoneOffset'), beforeDate, 'Date 未被改');
  eq(evaluate(sb, 'Intl.DateTimeFormat'), beforeIntl, 'Intl 未被改');
  eq(evaluate(sb, 'Function.prototype.toString'), beforeFts, 'Function#toString 未被改');
  eq(sb.RTCPeerConnection, beforeRtc, 'RTC 未被改');
  eq(evaluate(sb, '"mozRTCPeerConnection" in this'), false, '不新增 mozRTC');
  eq(sb.navigator.language, 'zh-CN');
  eq(Object.getOwnPropertyNames(sb.navigator.permissions).length, 0, 'permissions 无实例自有属性');
});

test('B2 split 下国内/本地恢复原生（不伪装）', () => {
  ['www.taobao.com', 'www.12306.cn', 'example.xn--fiqs8s', '192.168.1.1', 'localhost', 'nas', '[::1]'].forEach(h => {
    const sb = runSpoof(createPage({ hostname: h, cfg: cfg() }));
    eq(sb.navigator.language, 'zh-CN', h + ' 语言');
    eq(evaluate(sb, 'Intl.DateTimeFormat().resolvedOptions().timeZone'), Intl.DateTimeFormat().resolvedOptions().timeZone, h + ' 时区');
  });
});

// ---------- C. 域名与帧判定（fail-closed） ----------
test('C1 国际品牌域名强制按国外伪装', () => {
  ['www.alibaba.com', 'www.wechat.com', 'www.xiaomi.com', 'www.huawei.com'].forEach(h => {
    const sb = runSpoof(createPage({ hostname: h, cfg: cfg() }));
    eq(sb.navigator.language, 'en-US', h);
  });
});

test('C2 空 hostname 且无法判源 → 伪装（不再当本地放行）', () => {
  const sb = runSpoof(createPage({ hostname: '', href: 'about:blank', cfg: cfg() }));
  eq(sb.navigator.language, 'en-US');
});

test('C3 about:blank/srcdoc 继承发起方：国外父页 → 伪装', () => {
  const sb = runSpoof(createPage({
    hostname: '', href: 'about:srcdoc', cfg: cfg(),
    ancestorOrigins: ['https://example.com']
  }));
  eq(sb.navigator.language, 'en-US');
  eq(evaluate(sb, 'new Date().getTimezoneOffset()'), 480);
});

test('C4 about:blank 继承发起方：国内父页 → 原生', () => {
  const sb = runSpoof(createPage({
    hostname: '', href: 'about:blank', cfg: cfg(),
    ancestorOrigins: ['https://www.baidu.com']
  }));
  eq(sb.navigator.language, 'zh-CN');
});

test('C5 global 模式连国内页也伪装', () => {
  const sb = runSpoof(createPage({ hostname: 'www.baidu.com', cfg: cfg({ mode: 'global' }) }));
  eq(sb.navigator.language, 'en-US');
  eq(evaluate(sb, 'new Date().getTimezoneOffset()'), 480);
});

// ---------- D. 时区一致性 ----------
const LA = 'America/Los_Angeles';
function expected(ts) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: LA, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
    hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23', timeZoneName: 'longOffset'
  });
  const p = {};
  dtf.formatToParts(new Date(ts)).forEach(x => { p[x.type] = x.value; });
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(p.timeZoneName);
  const off = m ? (m[1] === '-' ? 1 : -1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
  return { ...p, offset: off };
}
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STAMPS = [Date.UTC(2026, 0, 15, 12, 34, 56), Date.UTC(2026, 6, 4, 5, 6, 7), Date.UTC(2026, 10, 12, 18, 16, 52)];

test('D1 get* 与 getTimezoneOffset 自洽（含夏令时）', () => {
  const sb = foreign();
  const D = evaluate(sb, 'Date');
  STAMPS.forEach(ts => {
    const e = expected(ts);
    const d = new D(ts);
    eq(d.getFullYear(), Number(e.year), 'year@' + ts);
    eq(d.getMonth(), Number(e.month) - 1, 'month@' + ts);
    eq(d.getDate(), Number(e.day), 'date@' + ts);
    eq(d.getHours(), Number(e.hour), 'hours@' + ts);
    eq(d.getMinutes(), Number(e.minute), 'minutes@' + ts);
    eq(d.getSeconds(), Number(e.second), 'seconds@' + ts);
    eq(d.getDay(), WD.indexOf(e.weekday), 'day@' + ts);
    eq(d.getTimezoneOffset(), e.offset, 'offset@' + ts);
  });
});

test('D2 toString/toTimeString/toDateString 与 get* 一致，时区名为长名', () => {
  const sb = createPage({ hostname: 'example.com', cfg: cfg() });
  const realLocale = evaluate(sb, 'Intl.DateTimeFormat().resolvedOptions().locale');
  runSpoof(sb);
  const D = evaluate(sb, 'Date');
  const ts = STAMPS[0];
  const e = expected(ts);
  const d = new D(ts);
  const longName = new Intl.DateTimeFormat(realLocale, { timeZone: LA, timeZoneName: 'long' })
    .formatToParts(new Date(ts)).find(p => p.type === 'timeZoneName').value;
  const str = d.toString();
  assert(/^\w{3} \w{3} \d{2} \d{4} \d{2}:\d{2}:\d{2} GMT[+-]\d{4} \(.+\)$/.test(str), 'toString 格式: ' + str);
  assert(str.includes(longName), `toString 含长时区名 ${longName}: ${str}`);
  assert(str.startsWith(`${e.weekday} `), '星期一致: ' + str);
  assert(str.includes(` ${String(e.hour).padStart(2, '0')}:${e.minute}:${e.second} `), '时分秒一致: ' + str);
  const ts2 = d.toTimeString();
  assert(ts2.includes(longName) && ts2.startsWith(`${String(e.hour).padStart(2, '0')}:`), 'toTimeString: ' + ts2);
  eq(d.toDateString().split(' ')[0], e.weekday, 'toDateString');
});

test('D3 toLocaleString/toLocaleTimeString 使用伪装时区', () => {
  const sb = foreign();
  const D = evaluate(sb, 'Date');
  const ts = STAMPS[2];
  const e = expected(ts);
  const d = new D(ts);
  const nativeExpected = new Date(ts).toLocaleString('en-US', { timeZone: LA });
  eq(d.toLocaleString('en-US'), nativeExpected, 'toLocaleString');
  eq(d.toLocaleTimeString('en-US', { hour12: false }).slice(0, 2), String(e.hour).padStart(2, '0'), 'toLocaleTimeString');
  const noOpt = d.toLocaleString('en-US');
  assert(noOpt === nativeExpected, '缺省 options 也注入 timeZone');
});

test('D4 Date 构造器按伪装时区解释本地时间', () => {
  const sb = foreign();
  const D = evaluate(sb, 'Date');
  eq(new D(2026, 0, 1, 0, 0, 0).getTime(), Date.UTC(2026, 0, 1, 8, 0, 0), '冬季 PST');
  eq(new D(2026, 6, 1, 0, 0, 0).getTime(), Date.UTC(2026, 6, 1, 7, 0, 0), '夏季 PDT');
  const d = new D(2026, 10, 12, 10, 30);
  eq(d.getHours(), 10, '构造后 getHours 回读');
  eq(d.getMinutes(), 30);
});

test('D5 Date.parse 本地/UTC/显式时区语义', () => {
  const sb = foreign();
  const D = evaluate(sb, 'Date');
  eq(D.parse('2026-01-01 00:00'), Date.UTC(2026, 0, 1, 8), '本地日期时间');
  eq(D.parse('2026-01-01T00:00:00'), Date.UTC(2026, 0, 1, 8), 'ISO 本地');
  eq(D.parse('2026-01-01'), Date.UTC(2026, 0, 1), 'date-only 按 UTC');
  eq(D.parse('2026-01-01T00:00:00Z'), Date.UTC(2026, 0, 1), '显式 Z');
  assert(Number.isNaN(D.parse('not a date')), '非法字符串');
});

test('D6 set* 与 get* 往返一致', () => {
  const sb = foreign();
  const D = evaluate(sb, 'Date');
  const d = new D(2026, 0, 15, 10, 0, 0);
  d.setHours(20);
  eq(d.getHours(), 20, 'setHours');
  d.setMinutes(45);
  eq(d.getMinutes(), 45);
  d.setFullYear(2027, 1, 2);
  eq(d.getFullYear(), 2027); eq(d.getMonth(), 1); eq(d.getDate(), 2);
  eq(d.getTimezoneOffset(), expected(d.getTime()).offset, 'set 后 offset 仍正确');
});

test('D7 Invalid Date 与原生类型语义', () => {
  const sb = foreign();
  const D = evaluate(sb, 'Date');
  const bad = new D(NaN);
  assert(Number.isNaN(bad.getTimezoneOffset()), 'Invalid offset=NaN');
  eq(bad.toString(), 'Invalid Date');
  eq(Object.prototype.toString.call(new D()), '[object Date]');
  assert(new D() instanceof D, 'instanceof');
  eq(D.UTC(2026, 0, 1), Date.UTC(2026, 0, 1), 'Date.UTC 原生');
  eq(D.length, 7, 'Date.length');
  assert(Math.abs(D.now() - Date.now()) < 2000, 'Date.now 真实');
  assert(typeof D() === 'string' && /GMT[+-]\d{4}/.test(D()), 'Date() 返回伪装时间串');
});

test('D8 offset 计算有缓存，热路径不再每次新建 Intl', () => {
  const sb = foreign();
  const ms = evaluate(sb, `(function(){
    var d = new Date();
    for (var i = 0; i < 100; i++) d.getTimezoneOffset();
    var t = Date.now();
    for (var j = 0; j < 20000; j++) d.getTimezoneOffset();
    return Date.now() - t;
  })()`);
  console.log(`       20k getTimezoneOffset: ${ms}ms`);
  assert(ms < 150, `缓存后 20k 次耗时应 <150ms，实际 ${ms}ms`);
});

// ---------- E. Intl / Navigator / Permissions 表面 ----------
test('E1 Intl 包装器 length/prototype/可调用性对齐原生', () => {
  const sb = foreign();
  const I = evaluate(sb, 'Intl');
  eq(I.DateTimeFormat.length, 0, 'DTF.length');
  eq(I.DateTimeFormat.prototype.constructor, I.DateTimeFormat, 'prototype.constructor');
  eq(I.NumberFormat.length, 0, 'NumberFormat.length');
  assert(I.DateTimeFormat() instanceof I.DateTimeFormat, 'DTF 可无 new 调用');
  throwsTypeError(() => I.DisplayNames(['en-US'], { type: 'region' }), 'DisplayNames 无 new 应抛错');
});

test('E2 Intl 默认时区/语言可被显式参数覆盖', () => {
  const sb = foreign();
  const I = evaluate(sb, 'Intl');
  eq(new I.DateTimeFormat('en-US').resolvedOptions().timeZone, LA);
  eq(new I.DateTimeFormat('en-US', { timeZone: 'UTC' }).resolvedOptions().timeZone, 'UTC');
  eq(new I.DateTimeFormat('en-US').resolvedOptions().locale, 'en-US');
  eq(new I.DateTimeFormat([]).resolvedOptions().locale, 'en-US', '空 locales 数组也视为缺省');
});

test('E3 navigator descriptor 保真 + permissions 无实例自有属性', () => {
  const sb = foreign();
  const proto = Object.getPrototypeOf(sb.navigator);
  eq(Object.getOwnPropertyDescriptor(proto, 'language').enumerable, true, 'language enumerable');
  eq(sb.navigator.language, 'en-US');
  eq(JSON.stringify(sb.navigator.languages), JSON.stringify(['en-US', 'en']));
  eq(Object.getOwnPropertyNames(sb.navigator.permissions).length, 0, 'query 不落在实例上');
  eq(Object.getOwnPropertyNames(evaluate(sb, 'Function.prototype.toString')).join(','), 'length,name', 'toString 无多余自有属性');
});

test('E4 geolocation 返回伪装坐标且带 toJSON', async () => {
  const sb = foreign();
  const pos = await new Promise(res => sb.navigator.geolocation.getCurrentPosition(res));
  eq(pos.coords.latitude, 34.0522);
  eq(pos.coords.longitude, -118.2437);
  assert(typeof pos.toJSON === 'function', 'position.toJSON');
  eq(pos.coords.toJSON().latitude, 34.0522);
});

// ---------- F. WebRTC ----------
test('F1 假 RTC 构造器与实例表面对齐', () => {
  const sb = foreign({ rtc: true });
  eq(sb.RTCPeerConnection.length, 0, 'length=0');
  eq(sb.RTCPeerConnection.name, 'RTCPeerConnection');
  const pc = new sb.RTCPeerConnection();
  eq(Object.getOwnPropertyNames(pc).length, 0, '实例零自有属性');
  const proto = sb.RTCPeerConnection.prototype;
  ['restartIce', 'addTransceiver', 'getSenders', 'getTransceivers', 'addTrack', 'createOffer'].forEach(m => {
    eq(typeof proto[m], 'function', m);
  });
  eq(typeof Object.getOwnPropertyDescriptor(proto, 'signalingState').get, 'function', 'signalingState 为原型访问器');
  eq(typeof Object.getOwnPropertyDescriptor(proto, 'canTrickleIceCandidates').get, 'function', 'canTrickleIceCandidates 存在');
  eq(proto.constructor, sb.RTCPeerConnection);
  eq(evaluate(sb, '"mozRTCPeerConnection" in this'), false, '不伪造 mozRTC');
});

test('F2 createOffer 返回原生 RTCSessionDescription，信令状态推进', async () => {
  const sb = foreign({ rtc: true });
  const pc = new sb.RTCPeerConnection();
  const offer = await pc.createOffer();
  eq(offer.type, 'offer');
  assert(offer instanceof sb.RTCSessionDescription, 'offer 为 RTCSessionDescription');
  await pc.setLocalDescription(offer);
  assert(pc.localDescription instanceof sb.RTCSessionDescription, 'localDescription 类型');
  eq(pc.signalingState, 'have-local-offer');
  const answer = await pc.createAnswer();
  await pc.setRemoteDescription(answer);
  eq(pc.signalingState, 'stable');
});

test('F3 无效 this 抛 TypeError（对齐原生，不再静默返回）', () => {
  const sb = foreign({ rtc: true });
  throwsTypeError(() => sb.RTCPeerConnection.prototype.createOffer.call(null), 'createOffer 非法 this');
  throwsTypeError(() => sb.RTCPeerConnection.prototype.addIceCandidate.call({}), 'addIceCandidate 非法 this');
});

test('F4 ICE 候选只含 .local，事件 isTrusted，close 后不再派发', async () => {
  const sb = foreign({ rtc: true });
  const pc = new sb.RTCPeerConnection();
  const events = [];
  pc.onicecandidate = (e) => events.push(e);
  await pc.setLocalDescription(await pc.createOffer());
  await sleep(250);
  assert(events.length >= 1, '有候选事件');
  const withCand = events.filter(e => e.candidate);
  assert(withCand.every(e => /\.local/.test(e.candidate.candidate) && !/srflx/.test(e.candidate.candidate)), '仅 mDNS');
  assert(events.every(e => e.isTrusted === true), 'isTrusted=true');
  const n = events.length;
  pc.close();
  await sleep(200);
  eq(events.length, n, 'close 后无新事件');
  eq(pc.signalingState, 'closed');
});

test('F5 addTrack/getSenders 一致，getStats 返回 Promise', async () => {
  const sb = foreign({ rtc: true });
  const pc = new sb.RTCPeerConnection();
  const track = { kind: 'audio' };
  pc.addTrack(track);
  eq(pc.getSenders().length, 1);
  eq(pc.getSenders()[0].track, track);
  const stats = await pc.getStats();
  assert(stats && typeof stats.forEach === 'function', 'stats 可遍历');
});

test('F6 disable/off 与 mDNS SDP', async () => {
  const off = foreign({ rtc: true, cfg: cfg({ webrtcMode: 'off' }) });
  const nativeBefore = off.RTCPeerConnection;
  eq(typeof nativeBefore, 'function', 'off 保留原生');
  const dis = foreign({ rtc: true, cfg: cfg({ webrtcMode: 'disable' }) });
  eq(typeof dis.RTCPeerConnection, 'undefined', 'disable 删除构造器');
  const sb = foreign({ rtc: true });
  const pc = new sb.RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  const offer = await pc.createOffer();
  assert(!/stun:/.test(offer.sdp), 'SDP 不含 STUN');
  assert(/\.local/.test(offer.sdp), 'SDP 含 mDNS');
});

// ---------- G. Worker ----------
test('G1 Worker 环境（无 window/document/RTC）也能伪装时区语言', () => {
  const sb = createPage({ hostname: 'example.com', cfg: cfg(), noDocument: true });
  sb.window = undefined;
  delete Object.getPrototypeOf(sb.navigator).geolocation;
  runSpoof(sb);
  eq(sb.navigator.language, 'en-US');
  eq(evaluate(sb, 'Intl.DateTimeFormat().resolvedOptions().timeZone'), LA);
  eq(evaluate(sb, 'new Date(2026,0,1,0).getTime()'), Date.UTC(2026, 0, 1, 8));
  eq(evaluate(sb, 'typeof RTCPeerConnection'), 'undefined', 'Worker 不凭空造 RTC');
});

test('G2 classic Worker 被注入同一份自包含代码 + importScripts 绝对路径', () => {
  const sb = foreign({ worker: true, src: '/*SPOOF-SOURCE*/' });
  const Native = sb.Worker;
  const w = new sb.Worker('/sw.js');
  assert(String(w.url).startsWith('blob:'), '改用 blob URL');
  const code = sb.URL.lastBlob.parts.join('');
  assert(code.includes('/*SPOOF-SOURCE*/'), '包含自源码');
  assert(code.includes('importScripts("https://example.com/sw.js")'), 'importScripts 绝对路径: ' + code.slice(-120));
  assert(w instanceof sb.Worker, 'instanceof 保持');
  eq(sb.Worker.prototype, Native.prototype, 'prototype 保持');
});

test('G3 module Worker 与异常场景回退原生', () => {
  const sb = foreign({ worker: true, src: '/*SPOOF-SOURCE*/' });
  const w = new sb.Worker('/m.js', { type: 'module' });
  eq(w.url, '/m.js', 'module 不包装');
  sb.URL.createObjectURL = () => { throw new Error('blocked'); };
  const w2 = new sb.Worker('/c.js');
  eq(w2.url, '/c.js', 'blob 失败回退原始 URL');
});

run();
