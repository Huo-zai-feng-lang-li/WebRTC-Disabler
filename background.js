/**
 * background.js — 配置注册 + DNR 请求头（v3.12）
 *
 * 设计要点：
 * - 页面脚本按文件顺序注册（domains.js → mode-*.js → spoof.js，MAIN world）；
 *   配置由隔离世界的 boot.js 读 storage 后，经一次性令牌消息交给 spoof，页面无法伪造。
 * - 域名名单来自 domains.js（importScripts），同一份源码也会注入页面脚本，避免两套判定漂移。
 * - 设置变化只更新注册（后续导航生效）；popup 保存时会刷新当前标签。
 */
'use strict';

try { importScripts('domains.js'); } catch (e) { /* 测试环境已预置 */ }

var LISTS = (typeof globalThis !== 'undefined' && globalThis.__WDS_LISTS) || { cn: [], foreign: [] };
var CN = LISTS.cn || [];
var FOREIGN = LISTS.foreign || [];
try { delete globalThis.__WDS_LISTS; } catch (e) { /* 忽略 */ }

var ZH = 'zh-CN,zh;q=0.9';
var EN = 'en-US,en;q=0.9';
var DEFAULTS = {
  mode: 'split', webrtcMode: 'spoof', tz: 'America/Los_Angeles',
  lang: 'en-US', langList: ['en-US', 'en'], geoLat: 34.0522, geoLng: -118.2437
};
var CF_EXCLUDES = [
  'https://challenges.cloudflare.com/*',
  'https://challenges.fed.cloudflare.com/*',
  'https://challenges.cloudflare-cn.com/*',
  'https://challenges-staging.cloudflare.com/*'
];
var LOCAL_FILTERS = [
  '||10.', '||127.', '||0.', '||169.254.', '||192.168.', '||localhost', '*.local',
  '||172.16.', '||172.17.', '||172.18.', '||172.19.', '||172.20.', '||172.21.',
  '||172.22.', '||172.23.', '||172.24.', '||172.25.', '||172.26.', '||172.27.',
  '||172.28.', '||172.29.', '||172.30.', '||172.31.'
];
var SCRIPT_ID = 'spoof-main';
var BOOT_ID = 'spoof-boot';
var ALL_RULE_IDS = [1, 2, 3, 4, 5, 6].concat(
  Array.from({ length: 31 }, function (_, i) { return 10 + i; })   // 10..40
);
var syncTimer = null;
/** 读取存储配置并补齐默认值；页面侧还会再做一次归一化。 */
async function loadConfig() {
  var stored = await chrome.storage.local.get(null);
  return Object.assign({}, DEFAULTS, stored && typeof stored === 'object' ? stored : {});
}

function makeRule(id, priority, condition, value) {
  return {
    id: id,
    priority: priority,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'Accept-Language', operation: 'set', value: value }]
    },
    condition: condition
  };
}

/**
 * 生成 DNR 规则。优先级：国际品牌(4) > .cn/本地/裸主机名(3) > 国内名单(2) > 全局国外(1)。
 * global 模式下所有请求都用配置的出口语言头，与页面侧全量伪装保持一致。
 */
function safeHeader(v) {
  if (typeof v !== 'string') return EN;
  var s = v.replace(/[\r\n]/g, '').trim();
  return s || EN;
}

function buildRules(mode, foreignHeader) {
  var F = safeHeader(foreignHeader);
  var rules = [makeRule(1, 1, { urlFilter: '*' }, F)];
  if (mode === 'global') return rules;
  rules.push(makeRule(2, 2, { requestDomains: CN }, ZH));
  rules.push(makeRule(3, 4, { requestDomains: FOREIGN }, F));
  rules.push(makeRule(4, 3, { regexFilter: '^https?://[^/]*\\.(cn|xn--fiqs8s)(:\\d+)?/' }, ZH));
  rules.push(makeRule(5, 3, { regexFilter: '^https?://[^/:.]+(:\\d+)?/' }, ZH));
  rules.push(makeRule(6, 3, {
    regexFilter: '^https?://\\[(::1|0:0:0:0:0:0:0:1|fe[89ab][0-9a-f:]*|f[cd][0-9a-f:]*)(%25[^\\]]*)?\\]'
  }, ZH));
  LOCAL_FILTERS.forEach(function (f, i) {
    rules.push(makeRule(10 + i, 3, { urlFilter: f }, ZH));
  });
  return rules;
}

async function syncHeaderRules() {
  var cfg = await loadConfig();
  var mode = cfg.mode === 'global' ? 'global' : 'split';
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: ALL_RULE_IDS,
    addRules: buildRules(mode, cfg.langHeader)
  });
}

/**
 * 注册页面脚本。两段：
 * - MAIN：domains.js → mode-*.js → spoof.js（文件顺序即执行顺序，共享 world，不产生全局）
 * - ISOLATED：boot.js 读 storage 后经一次性令牌把配置交给 spoof
 * 只接受文件、不接受内联代码（registerContentScripts 的硬约束）。
 */
async function upsertScript(props) {
  try {
    await chrome.scripting.updateContentScripts([props]);
  } catch (e) {
    await chrome.scripting.registerContentScripts([props]);
  }
}

async function applyMainScript() {
  var cfg = await loadConfig();
  var modeFile = cfg.mode === 'global' ? 'mode-global.js' : 'mode-split.js';
  var common = {
    matches: ['<all_urls>'],
    excludeMatches: CF_EXCLUDES,
    runAt: 'document_start',
    allFrames: true,
    matchOriginAsFallback: true,
    persistAcrossSessions: true
  };
  var mainProps = Object.assign({
    id: SCRIPT_ID,
    js: ['domains.js', modeFile, 'spoof.js'],
    world: 'MAIN'
  }, common);
  var bootProps = Object.assign({
    id: BOOT_ID,
    js: ['boot.js']
  }, common);
  await upsertScript(mainProps);
  await upsertScript(bootProps);
}

/**
 * 串行化同步：onInstalled/onStartup/storage 变化可能在同一 tick 触发多次，
 * 并发调用 updateDynamicRules 会互相覆盖并报 "id 不唯一"。
 */
var syncing = null;
var syncQueued = false;

async function runSync() {
  try {
    await applyMainScript();
  } catch (e) {
    console.error('[WebRTC Disabler] 注册页面脚本失败', e);
  }
  try {
    await syncHeaderRules();
  } catch (e) {
    console.error('[WebRTC Disabler] 更新请求头规则失败', e);
  }
}

function startSync() {
  syncing = runSync().then(function () {
    syncing = null;
    if (syncQueued) {
      syncQueued = false;
      syncAll();
    }
  }).catch(function (e) {
    syncing = null;
    console.error('[WebRTC Disabler] 同步失败', e);
  });
}

function syncAll() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(function () {
    if (syncing) { syncQueued = true; return; }
    startSync();
  }, 0);
}

/** 与 spoof.js 同口径的国内/本地判定（仅用于决定是否建立配置通道）。 */
function isDomesticHost(host) {
  var h = String(host || '').toLowerCase();
  if (!h) return false;                        // 空 host：交给 spoof 按帧来源 fail-closed 处理
  // 国际品牌站（FOREIGN）优先于国内名单：与 spoof.js 的 pageIsChina 顺序一致，
  // 否则 alibaba.com 这类同时命中两份名单的域名会出现"请求头伪装、JS 不伪装"的矛盾指纹。
  if (FOREIGN.some(function (d) { return h === d || h.slice(-(d.length + 1)) === '.' + d; })) return false;
  if (h === 'localhost' || /\.local$/.test(h)) return true;
  if (/^\[[0-9a-f:]+\]$/.test(h)) {
    return /^\[(::1|0:0:0:0:0:0:0:1|fe[89ab][0-9a-f:]*|f[cd][0-9a-f:]*)\]$/.test(h);
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    return /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
  }
  if (h.indexOf('.') === -1) return true;      // 裸主机名
  if (h === 'cn' || /\.cn$/.test(h) || /\.xn--fiqs8s$/.test(h)) return true;
  return CN.some(function (d) { return h === d || h.slice(-(d.length + 1)) === '.' + d; });
}

if (chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'wds-gate') return false;
    loadConfig().then(function (cfg) {
      var mode = cfg.mode === 'global' ? 'global' : 'split';
      sendResponse({ spoof: mode === 'global' || !isDomesticHost(msg.host) });
    }).catch(function () {
      sendResponse({ spoof: true });            // 读配置失败：按保护优先
    });
    return true;
  });
}
chrome.runtime.onInstalled.addListener(function () { syncAll(); });
chrome.runtime.onStartup.addListener(function () { syncAll(); });
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === 'local') syncAll();
});
