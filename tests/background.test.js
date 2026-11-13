'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRunner, assert, eq, sleep, domainsSrc, createPage } = require('./helpers');

const { test, run } = createRunner();
const ROOT = path.join(__dirname, '..');
const spoofSrc = fs.readFileSync(path.join(ROOT, 'spoof.js'), 'utf8');
const bgSrc = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

function makeEnv(stored = {}) {
  const calls = { register: [], update: [], rules: [] };
  const listeners = { installed: [], startup: [], changed: [], message: [] };
  const chrome = {
    storage: {
      local: {
        get(arg, cb) {
          const data = Object.assign({}, stored);
          if (typeof cb === 'function') { cb(data); return; }
          return Promise.resolve(data);
        }
      },
      onChanged: { addListener: fn => listeners.changed.push(fn) }
    },
    scripting: {
      updateContentScripts: async arr => { calls.update.push(arr); },
      registerContentScripts: async arr => { calls.register.push(arr); },
      unregisterContentScripts: async () => {}
    },
    declarativeNetRequest: {
      updateDynamicRules: async opts => { calls.rules.push(opts); }
    },
    runtime: {
      onInstalled: { addListener: fn => listeners.installed.push(fn) },
      onStartup: { addListener: fn => listeners.startup.push(fn) },
      onMessage: { addListener: fn => listeners.message.push(fn) },
      getURL: p => 'chrome-extension://test/' + p
    }
  };
  const sandbox = {
    chrome, console, URL, setTimeout, clearTimeout,
    fetch: async (u) => ({ text: async () => /domains\.js/.test(u) ? domainsSrc : spoofSrc })
  };
  vm.createContext(sandbox);
  vm.runInContext(domainsSrc, sandbox, { filename: 'domains.js' });   // 模拟 importScripts 预置
  vm.runInContext(bgSrc, sandbox, { filename: 'background.js' });
  return { calls, listeners, sandbox };
}

const ZH = 'zh-CN,zh;q=0.9';
const EN = 'en-US,en;q=0.9';

function ruleMatches(cond, u) {
  if (cond.requestDomains && !cond.requestDomains.some(d => u.hostname === d || u.hostname.endsWith('.' + d))) return false;
  if (cond.regexFilter) return new RegExp(cond.regexFilter).test(u.href);
  if (cond.urlFilter) {
    const f = cond.urlFilter;
    if (f === '*') return true;
    if (f.startsWith('||')) return u.hostname.startsWith(f.slice(2));
    if (f.startsWith('*.')) return u.hostname.endsWith(f.slice(1));
    return u.href.includes(f);
  }
  return true;
}

/** 用与 DNR 相同的"优先级最高者生效"语义，求某个 URL 最终会被改成的 Accept-Language。 */
function headerFor(rules, url) {
  const u = new URL(url);
  const hit = rules.filter(r => ruleMatches(r.condition, u)).sort((a, b) => b.priority - a.priority)[0];
  if (!hit) return null;
  const h = hit.action.requestHeaders.find(x => x.header === 'Accept-Language');
  return h ? h.value : null;
}

/** 调 wds-gate 通道，拿后台对某个 host 的伪装裁决（boot.js 据此决定是否建通道）。 */
function gate(env, host) {
  return new Promise((resolve, reject) => {
    const fn = env.listeners.message[0];
    if (!fn) return reject(new Error('没有注册 wds-gate 监听'));
    const t = setTimeout(() => reject(new Error('gate 超时: ' + host)), 1000);
    fn({ type: 'wds-gate', host }, {}, (resp) => { clearTimeout(t); resolve(resp); });
  });
}

async function boot(stored) {
  const env = makeEnv(stored);
  env.listeners.installed.forEach(fn => fn({ reason: 'install' }));
  await sleep(20);
  return env;
}

test('BG1 注册 MAIN/ISOLATED 双段脚本：文件顺序、document_start、帧全覆盖', async () => {
  const env = await boot({ tz: 'Asia/Tokyo', lang: 'ja-JP', langList: ['ja-JP', 'ja'] });
  const all = env.calls.update.flat().concat(env.calls.register.flat());
  const main = all.find(s => s.id === 'spoof-main');
  const bootScript = all.find(s => s.id === 'spoof-boot');
  assert(main && bootScript, '两段脚本都要注册');
  eq(main.world, 'MAIN');
  eq(main.js.join(','), 'domains.js,mode-split.js,spoof.js', '文件顺序即执行顺序');
  eq(main.runAt, 'document_start');
  eq(main.allFrames, true);
  eq(main.matchOriginAsFallback, true, 'about/data/blob 帧');
  assert(!('matchAboutBlank' in main), 'scripting API 不接受 matchAboutBlank');
  assert(main.excludeMatches.some(m => m.includes('challenges.cloudflare.com')), '保留 Cloudflare 排除');
  assert(main.js.every(x => typeof x === 'string'), 'Chrome 只接受文件，内联 code 会注册失败');
  eq(bootScript.js.join(','), 'boot.js');
  assert(bootScript.world === undefined || bootScript.world === 'ISOLATED', 'boot 跑隔离世界');
  eq(bootScript.matchOriginAsFallback, true);
});

test('BG6 global 模式注册 global 模式文件', async () => {
  const env = await boot({ mode: 'global' });
  const all = env.calls.update.flat().concat(env.calls.register.flat());
  const main = all.find(s => s.id === 'spoof-main');
  eq(main.js.join(','), 'domains.js,mode-global.js,spoof.js');
});

test('BG2 .cn/.中国/本地/裸主机名/IPv6 请求头与 JS 判定一致', async () => {
  const env = await boot({});
  const rules = env.calls.rules[0].addRules;
  const cases = [
    ['https://www.12306.cn/', ZH], ['https://www.taobao.com/', ZH], ['https://www.gov.cn/', ZH],
    ['https://example.xn--fiqs8s/', ZH],
    ['http://192.168.1.1/', ZH], ['http://10.0.0.1/', ZH], ['http://nas:8080/', ZH],
    ['http://localhost:3000/', ZH], ['http://[::1]:8080/', ZH], ['http://[fe80::1]/', ZH],
    ['http://[fd00::1]/', ZH], ['http://printer.local/', ZH],
    ['https://www.alibaba.com/', EN], ['https://sub.wechat.com/', EN], ['https://example.com/', EN],
    ['https://www.xiaomi.com/', EN]
  ];
  cases.forEach(([url, want]) => eq(headerFor(rules, url), want, url));
});

test('BG3 global 模式不再注入中文头', async () => {
  const env = await boot({ mode: 'global' });
  const rules = env.calls.rules[0].addRules;
  eq(headerFor(rules, 'https://www.taobao.com/'), EN);
  eq(headerFor(rules, 'https://www.12306.cn/'), EN);
  eq(headerFor(rules, 'http://192.168.1.1/'), EN);
});

test('BG4 配置变化会重新注册脚本（后续导航生效）', async () => {
  const env = await boot({});
  const before = env.calls.update.length + env.calls.register.length;
  env.listeners.changed.forEach(fn => fn({ lang: { newValue: 'ja-JP' } }, 'local'));
  await sleep(20);
  const after = env.calls.update.length + env.calls.register.length;
  assert(after > before, 'storage.onChanged 应触发重注册');
});

test('BG5 请求头跟随配置的出口语言（不再硬编码英文）', async () => {
  const ja = 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7';
  const env = await boot({ langHeader: ja });
  const rules = env.calls.rules[0].addRules;
  eq(headerFor(rules, 'https://example.com/'), ja);
  eq(headerFor(rules, 'https://www.alibaba.com/'), ja);
  eq(headerFor(rules, 'https://www.taobao.com/'), ZH);
});

/**
 * BG7 回归：国际品牌站同时在 CN 与 FOREIGN 两份名单里，gate 必须与 spoof.js 一样
 * 让 FOREIGN 优先返回"要伪装"。否则 boot.js 不建通道，页面侧只能用 DEFAULTS，
 * 出现"请求头已伪装、JS 时区仍是真实"的矛盾指纹。
 */
test('BG7 FOREIGN∩CN 域名 gate 与 spoof.js 同口径：一律要伪装', async () => {
  const env = await boot({});
  const mustSpoof = [
    'alibaba.com', 'www.alibaba.com', 'aliexpress.com', 'sub.aliexpress.com', 'wechat.com',
    'xiaomi.com', 'www.xiaomi.com', 'huawei.com', 'oppo.com', 'vivo.com',
    'oneplus.com', 'realme.com', 'meizu.com', 'tiktok.com', 'www.tiktok.com'
  ];
  for (const h of mustSpoof) eq((await gate(env, h)).spoof, true, h + ' 应伪装');
  // 纯国内/本地仍然不伪装
  const mustNative = [
    'taobao.com', 'www.12306.cn', 'gov.cn', 'example.cn', 'example.xn--fiqs8s',
    'localhost', '192.168.1.1', '10.0.0.1', 'nas', 'printer.local', '172.20.1.1'
  ];
  for (const h of mustNative) eq((await gate(env, h)).spoof, false, h + ' 不应伪装');
  // 普通国外站
  for (const h of ['example.com', 'www.google.com']) eq((await gate(env, h)).spoof, true, h + ' 应伪装');
});

test('BG8 global 模式下 gate 对所有 host 都返回伪装', async () => {
  const env = await boot({ mode: 'global' });
  for (const h of ['taobao.com', 'localhost', '192.168.1.1', 'tiktok.com', 'example.com']) {
    eq((await gate(env, h)).spoof, true, h);
  }
});

run();
