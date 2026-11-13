'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRunner, assert, eq, sleep } = require('./helpers');

const { test, run } = createRunner();
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const popupSrc = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

function optionsFor(id) {
  const m = new RegExp('<select[^>]*id="' + id + '"[\\s\\S]*?</select>').exec(html);
  if (!m) return [];
  return [...m[0].matchAll(/<option value="([^"]+)"/g)].map(x => ({ value: x[1], text: x[1] }));
}

function makeSelect(id) {
  return {
    id,
    options: optionsFor(id),
    _value: '',
    listeners: {},
    add(o) { this.options.push(o); },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    get value() { return this._value; },
    // 与浏览器一致：赋予不在 options 中的值会选中失败、value 变空串
    set value(v) { this._value = this.options.some(o => o.value === v) ? v : ''; }
  };
}

function makeEnv(stored = {}, ipResponse = null) {
  const ids = ['mode', 'webrtcMode', 'tz', 'geoLat', 'geoLng', 'lang', 'ipVal', 'ipFlag', 'tzAuto',
    'cityVal', 'latVal', 'lngVal', 'langAuto', 'status', 'saveBtn', 'autoBtn', 'testBtn'];
  const els = {};
  ids.forEach(id => {
    els[id] = (id === 'tz' || id === 'lang') ? makeSelect(id) : {
      id, value: '', textContent: '', className: '', disabled: false, listeners: {},
      addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    };
  });
  const saved = [];
  const state = { closed: 0, reloaded: 0, ready: null };
  const chrome = {
    storage: {
      local: {
        get(arg, cb) { cb(Object.assign({}, stored)); },
        set(obj, cb) { saved.push(obj); if (cb) cb(); }
      }
    },
    tabs: {
      query(opts, cb) { cb([{ id: 1, url: 'https://example.com/' }]); },
      reload(id, cb) { state.reloaded++; if (cb) cb(); },
      create(opts, cb) { state.created = opts.url; if (cb) cb(); }
    }
  };
  const document = {
    getElementById: id => els[id],
    addEventListener(type, fn) { if (type === 'DOMContentLoaded') state.ready = fn; }
  };
  const sandbox = {
    document, chrome, console, setTimeout, clearTimeout,
    window: { close() { state.closed++; } },
    Option: function Option(text, value) { this.text = text; this.value = value; },
    fetch: async () => ({
      ok: true,
      json: async () => ipResponse || {
        success: true, country: 'United States', country_code: 'US',
        timezone: { id: 'America/Chicago' }, city: 'Chicago',
        latitude: 41.8781, longitude: -87.6298,
        connection: { asn: 123, org: 'Test ISP' }, flag: { emoji: '🇺🇸' }
      }
    })
  };
  vm.createContext(sandbox);
  vm.runInContext(popupSrc, sandbox, { filename: 'popup.js' });
  return { els, saved, state, sandbox };
}

const NL = {
  mode: 'split', webrtcMode: 'spoof', tz: 'Europe/Amsterdam',
  lang: 'nl-NL', langList: ['nl-NL', 'nl'], geoLat: 52.3676, geoLng: 4.9041
};

test('P1 预设外时区：重开弹窗不丢、再保存不回退洛杉矶', async () => {
  const env = makeEnv(NL);
  env.state.ready();
  await sleep(10);
  eq(env.els.tz.value, 'Europe/Amsterdam', 'load 后 select 应保留预设外时区');
  eq(env.els.lang.value, 'nl-NL');
  await env.els.saveBtn.listeners.click[0]();
  await sleep(10);
  eq(env.saved.length, 1, '保存一次');
  eq(env.saved[0].tz, 'Europe/Amsterdam', 'tz 不得被静默改写');
  eq(env.saved[0].lang, 'nl-NL');
  eq(env.saved[0].geoLat, 52.3676);
});

test('P2 时区为空时禁止静默保存', async () => {
  const env = makeEnv(NL);
  env.state.ready();
  await sleep(10);
  env.els.tz.options = [];        // 模拟选项被外部清空
  env.els.tz.value = 'X';         // 选中失败 → value=''
  await env.els.saveBtn.listeners.click[0]();
  await sleep(10);
  eq(env.saved.length, 0, '空 tz 不应落盘');
  assert(/时区/.test(env.els.status.textContent), '应提示时区错误: ' + env.els.status.textContent);
});

test('P3 经纬度超范围禁止保存', async () => {
  const env = makeEnv(NL);
  env.state.ready();
  await sleep(10);
  env.els.geoLat.value = '999';
  await env.els.saveBtn.listeners.click[0]();
  await sleep(10);
  eq(env.saved.length, 0);
  assert(/纬度|经纬度/.test(env.els.status.textContent), '提示: ' + env.els.status.textContent);
});

test('P4 自动匹配美国：语言/时区/经纬度一致落盘', async () => {
  const env = makeEnv({});
  env.state.ready();
  await sleep(10);
  await env.els.autoBtn.listeners.click[0]();
  await sleep(20);
  eq(env.saved.length, 1);
  eq(env.saved[0].tz, 'America/Chicago');
  eq(env.saved[0].lang, 'en-US');
  eq(env.saved[0].geoLat, 41.8781);
  eq(env.saved[0].geoLng, -87.6298);
  assert(env.state.reloaded > 0, '保存后刷新当前页');
});

test('P5 未内置语言的国家：不静默保存，提示确认语言', async () => {
  const env = makeEnv({}, {
    success: true, country: 'Nowhere', country_code: 'XX',
    timezone: { id: 'Etc/Unknown' }, city: 'X', latitude: 1, longitude: 2,
    connection: { asn: 1, org: 'x' }, flag: { emoji: '🏳️' }
  });
  env.state.ready();
  await sleep(10);
  await env.els.autoBtn.listeners.click[0]();
  await sleep(20);
  eq(env.saved.length, 0, '语言不确定时不应静默落盘');
  assert(/语言/.test(env.els.status.textContent), '应提示语言确认: ' + env.els.status.textContent);
});

run();
