/**
 * tests/e2e_chrome.js — 真实 Chrome 扩展态 E2E（手动运行）
 *
 * 覆盖：扩展加载、页面注入、国内外分流、特殊帧、Worker、RTC 表面、定位、DNR 请求头、配置热更新。
 * 运行：node tests/e2e_chrome.js
 * 依赖：本机 Chrome（默认路径可用 CHROME_PATH 覆盖）。脚本自建本地 HTTP 服务与临时 profile，结束自动清理。
 */
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EXT = path.resolve(__dirname, '..');
const PORT = 8765;
const DEBUG_PORT = 9333;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = typeof expected === 'function' ? expected(actual) : actual === expected;
  if (ok) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + '  got=' + JSON.stringify(actual)); }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
}

/** 本地页面 + 请求头回显；所有域名都映射到 127.0.0.1，用 hostname 触发分流。 */
function startServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/echo') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ al: req.headers['accept-language'] || null }));
      return;
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><meta charset="utf-8"><title>e2e</title><body><p>e2e</p></body>');
  });
  return listen(server).then(() => server);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }
      }, 8000);
    });
  }
}

async function connectBrowser() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      const info = await r.json();
      const ws = new WebSocket(info.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      return new Cdp(ws);
    } catch (e) {
      await new Promise(r => setTimeout(r, 250));
    }
  }
  throw new Error('无法连接 Chrome CDP');
}

async function newPage(cdp) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  return { targetId, sessionId };
}

async function evalIn(cdp, sessionId, expr, awaitPromise = true) {
  const r = await cdp.send('Runtime.evaluate', {
    expression: expr, awaitPromise, returnByValue: true, userGesture: true
  }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception));
  return r.result.value;
}

async function goto(cdp, sessionId, url) {
  await cdp.send('Page.navigate', { url }, sessionId);
  for (let i = 0; i < 60; i++) {
    try {
      const state = await evalIn(cdp, sessionId, 'document.readyState', false);
      if (state === 'complete') return;
    } catch (e) { /* 导航中 */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('页面加载超时: ' + url);
}

const PAGE = (host) => `http://${host}:${PORT}/page`;
const ECHO = (host) => `http://${host}:${PORT}/echo`;

function assertForeignSurface(s) {
  check('国外页 navigator.language=en-US', s.lang, 'en-US');
  check('国外页 languages 一致', Array.isArray(s.langs) && s.langs[0], 'en-US');
  check('国外页时区偏移=480（洛杉矶）', s.off, 480);
  check('国外页夏令时切换（1月480/7月420）', JSON.stringify(s.dst), JSON.stringify([480, 420]));
  check('国外页 Date.toString 含长时区名', /Pacific|GMT-0800/.test(s.dateStr), true);
  check('国外页 Intl 时区=America/Los_Angeles', s.intlTz, 'America/Los_Angeles');
  check('国外页无旧全局 __spoofNatives', s.globals.indexOf('__spoofNatives'), -1);
  check('国外页无旧全局 __applySpoofConfig', s.globals.indexOf('__applySpoofConfig'), -1);
  check('国外页 RTC 实例零自有属性', s.rtc.own, 0);
  check('国外页 RTC 构造器 length=0', s.rtc.ctorLen, 0);
  check('国外页 createOffer 返回 RTCSessionDescription', s.rtc.offerCtor, 'RTCSessionDescription');
  check('国外页 SDP 不含 STUN 地址', /stun:|turn:/.test(s.rtc.sdp), false);
  check('国外页 SDP 只含 mDNS 候选', /\.local/.test(s.rtc.sdp), true);
  check('国外页 about:blank 帧继承伪装', s.aboutOff, 480);
  check('国外页 about:blank 帧语言一致', s.aboutLang, 'en-US');
  check('国外页 srcdoc 帧继承伪装', s.srcdocOff, 480);
  check('国外页 Worker 内时区一致', s.workerOff, 480);
  check('国外页 Worker 内语言一致', s.workerLang, 'en-US');
  check('国外页定位返回伪装坐标', Math.abs(s.geo.lat - 34.0522) < 1e-6 && Math.abs(s.geo.lng + 118.2437) < 1e-6, true);
}

function assertDomesticSurface(s, offWant) {
  check('国内页语言=zh-CN', s.lang, 'zh-CN');
  check('国内页时区=系统真实偏移', s.off, offWant);
  check('国内页无国外时区痕迹', /Pacific|Los_Angeles/.test(String(s.dateStr) + String(s.intlTz)), false);
}

const PROBE = `(async () => {
  const globals = Object.getOwnPropertyNames(window);
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  const rtc = {
    own: Object.getOwnPropertyNames(pc).length,
    ctorLen: RTCPeerConnection.length,
    offerCtor: '', localCtor: '', sdp: ''
  };
  try {
    const offer = await pc.createOffer();
    rtc.offerCtor = offer && offer.constructor ? offer.constructor.name : String(offer);
    await pc.setLocalDescription(offer);
    await new Promise(r => setTimeout(r, 250));
    rtc.sdp = String((pc.localDescription && pc.localDescription.sdp) || offer.sdp || '');
    rtc.localCtor = pc.localDescription ? pc.localDescription.constructor.name : '';
  } catch (e) { rtc.err = e.message; }

  const frameProbe = (f) => {
    try {
      const w = f.contentWindow;
      return { off: w.eval('new Date().getTimezoneOffset()'), lang: w.navigator.language };
    } catch (e) { return { off: -999, lang: 'ERR:' + e.message }; }
  };
  const f1 = document.createElement('iframe');
  document.body.appendChild(f1);
  const f2 = document.createElement('iframe');
  f2.srcdoc = '<p>srcdoc</p>';
  document.body.appendChild(f2);
  await new Promise(r => setTimeout(r, 300));
  const about = frameProbe(f1);
  const srcdoc = frameProbe(f2);

  const worker = await new Promise((resolve) => {
    try {
      const src = 'postMessage({ off: new Date().getTimezoneOffset(), lang: navigator.language });';
      const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      const timer = setTimeout(() => resolve({ off: -999, lang: 'TIMEOUT' }), 3000);
      w.onmessage = (e) => { clearTimeout(timer); resolve(e.data); w.terminate(); };
      w.onerror = (e) => { clearTimeout(timer); resolve({ off: -999, lang: 'ERR:' + e.message }); };
    } catch (e) { resolve({ off: -999, lang: 'ERR:' + e.message }); }
  });

  const geo = await new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      navigator.geolocation.getCurrentPosition(
        p => finish({ lat: p.coords.latitude, lng: p.coords.longitude }),
        e => finish({ err: e.message })
      );
    } catch (e) { finish({ err: e.message }); }
    setTimeout(() => finish({ err: 'timeout' }), 3000);
  });

  return {
    lang: navigator.language,
    langs: navigator.languages,
    off: new Date().getTimezoneOffset(),
    dst: [new Date(2026, 0, 1).getTimezoneOffset(), new Date(2026, 6, 1).getTimezoneOffset()],
    dateStr: new Date().toString(),
    intlTz: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    globals,
    rtc,
    aboutOff: about.off, aboutLang: about.lang,
    srcdocOff: srcdoc.off,
    workerOff: worker.off, workerLang: worker.lang,
    geo
  };
})()`;

async function findOurWorker(cdp) {
  for (let i = 0; i < 40; i++) {
    const targets = await cdp.send('Target.getTargets');
    for (const t of targets.targetInfos.filter(x => x.type === 'service_worker')) {
      try {
        const sessionId = (await cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
        await cdp.send('Runtime.enable', {}, sessionId);
        const name = await evalIn(cdp, sessionId, 'chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest().name : null');
        if (name === 'WebRTC Disabler') return { target: t, sessionId };
        await cdp.send('Target.detachFromTarget', { sessionId });
      } catch (e) { /* 别的上下文，跳过 */ }
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return null;
}

async function getEcho(cdp, sessionId, host) {
  const r = await evalIn(cdp, sessionId, `fetch(${JSON.stringify(ECHO(host))}).then(r=>r.json())`);
  return r.al;
}

async function setStorage(cdp, swSession, obj) {
  const expr = `chrome.storage.local.set(${JSON.stringify(obj)}).then(()=>'ok')`;
  const ok = await evalIn(cdp, swSession, expr);
  if (ok !== 'ok') throw new Error('storage set failed');
  await new Promise(r => setTimeout(r, 400));   // 等 background 重注册
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wds-e2e-'));
  const server = await startServer();
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--no-first-run', '--no-default-browser-check', '--no-proxy-server',
    '--host-resolver-rules=MAP foreign.test 127.0.0.1, MAP www.example.cn 127.0.0.1, MAP domestic.test 127.0.0.1, MAP www.tiktok.com 127.0.0.1, MAP www.xiaomi.com 127.0.0.1',
    'about:blank'
  ], { stdio: 'ignore' });

  let cdp, swSession;
  try {
    cdp = await connectBrowser();
    // Chrome 137+ 的正式版已禁用 --load-extension，改用 CDP 的 Extensions.loadUnpacked
    const loaded = await cdp.send('Extensions.loadUnpacked', { path: EXT });
    check('扩展加载成功（返回扩展 id）', loaded && loaded.id, (v) => typeof v === 'string' && v.length > 10);
    const ours = await findOurWorker(cdp);
    if (!ours) throw new Error('扩展未加载：找不到 WebRTC Disabler 的 background SW');
    check('扩展已加载（background SW 存在）', true, true);
    const extVersion = await evalIn(cdp, ours.sessionId, 'chrome.runtime.getManifest().version');
    check('扩展版本=3.11', extVersion, '3.11');
    swSession = ours.sessionId;
    let ruleCount = 0;
    for (let i = 0; i < 20; i++) {
      ruleCount = await evalIn(cdp, swSession, 'chrome.declarativeNetRequest.getDynamicRules().then(r=>r.length)');
      if (ruleCount > 20) break;
      await new Promise(r => setTimeout(r, 250));
    }
    check('DNR 动态规则已注册', ruleCount, (v) => v > 20);

    const sysOff = await evalIn(cdp, swSession, 'new Date().getTimezoneOffset()');
    const page = await newPage(cdp);

    // ---------- 国外页（split 默认） ----------
    await goto(cdp, page.sessionId, PAGE('foreign.test'));
    const foreign = await evalIn(cdp, page.sessionId, PROBE);
    assertForeignSurface(foreign);
    check('国外页请求头=en-US', await getEcho(cdp, page.sessionId, 'foreign.test'), 'en-US,en;q=0.9');

    // ---------- 国内 .cn ----------
    await goto(cdp, page.sessionId, PAGE('www.example.cn'));
    const cn = await evalIn(cdp, page.sessionId, PROBE);
    assertDomesticSurface(cn, sysOff);
    check('国内 .cn 请求头=zh-CN', await getEcho(cdp, page.sessionId, 'www.example.cn'), 'zh-CN,zh;q=0.9');

    // ---------- 本地 IP ----------
    await goto(cdp, page.sessionId, PAGE('127.0.0.1'));
    const local = await evalIn(cdp, page.sessionId, PROBE);
    assertDomesticSurface(local, sysOff);
    check('本地 IP 请求头=zh-CN', await getEcho(cdp, page.sessionId, '127.0.0.1'), 'zh-CN,zh;q=0.9');

    // ---------- 国际品牌站（同时在 CN 与 FOREIGN 名单）：必须整体伪装，不能只改请求头 ----------
    // 回归点：background 的 gate 若漏判 FOREIGN 优先，boot 不建通道 → 请求头已伪装、JS 仍是真实时区。
    for (const host of ['www.tiktok.com', 'www.xiaomi.com']) {
      await goto(cdp, page.sessionId, PAGE(host));
      const brand = await evalIn(cdp, page.sessionId, PROBE);
      assertForeignSurface(brand);
      check(`品牌站 ${host} 请求头=en-US`, await getEcho(cdp, page.sessionId, host), 'en-US,en;q=0.9');
    }

    // ---------- 配置热更新：global + 东京/日语 ----------
    await setStorage(cdp, swSession, {
      mode: 'global', tz: 'Asia/Tokyo', lang: 'ja-JP', langList: ['ja-JP', 'ja'],
      langHeader: 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7'
    });
    await goto(cdp, page.sessionId, PAGE('foreign.test'));
    const gForeign = await evalIn(cdp, page.sessionId, PROBE);
    check('global 国外页时区=东京(-540)', gForeign.off, -540);
    check('global 国外页语言=ja-JP', gForeign.lang, 'ja-JP');
    const jaHeader = await evalIn(cdp, swSession, 'chrome.storage.local.get(null).then(c=>c.langHeader)');
    check('global 国外页请求头=配置的日文头', await getEcho(cdp, page.sessionId, 'foreign.test'), jaHeader);
    await goto(cdp, page.sessionId, PAGE('www.example.cn'));
    const gCn = await evalIn(cdp, page.sessionId, PROBE);
    check('global 国内页也伪装（东京）', gCn.off, -540);
    check('global 国内页语言=ja-JP', gCn.lang, 'ja-JP');
    check('global 国内页请求头=配置的日文头', await getEcho(cdp, page.sessionId, 'www.example.cn'), jaHeader);

    // ---------- 还原 split ----------
    await setStorage(cdp, swSession, { mode: 'split', tz: 'America/Los_Angeles', lang: 'en-US', langList: ['en-US', 'en'], langHeader: 'en-US,en;q=0.9' });
    await goto(cdp, page.sessionId, PAGE('foreign.test'));
    check('还原后国外页时区=洛杉矶', await evalIn(cdp, page.sessionId, 'new Date().getTimezoneOffset()'), 480);
    await goto(cdp, page.sessionId, PAGE('www.example.cn'));
    check('还原后国内页时区=系统真实', await evalIn(cdp, page.sessionId, 'new Date().getTimezoneOffset()'), sysOff);
  } catch (e) {
    fail++;
    console.log('  FAIL E2E 异常: ' + e.message);
  } finally {
    try { if (cdp && cdp.ws) cdp.ws.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    try { server.close(); } catch (e) {}
    await new Promise(r => setTimeout(r, 300));
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exitCode = fail ? 1 : 0;
})();
