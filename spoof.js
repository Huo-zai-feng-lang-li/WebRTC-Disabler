/**
 * WebRTC Disabler —— MAIN world 注入脚本（v3.11）。
 *
 * 注入方式：background 注册文件序列（domains.js → mode-*.js → spoof.js），三者同处 MAIN world：
 *   - domains.js 写入 window.__WDS_LISTS，spoof 读取后立即删除；
 *   - mode-*.js 写入 window.__WDS_MODE，spoof 读取后立即删除；
 *   - 配置由隔离世界的 boot.js 读 storage 后经"一次性令牌"消息下发，页面拿不到令牌、无法伪造。
 * 妥协点：配置到达前（通常 <1ms，页面脚本尚未执行）先按默认值工作，令牌只存在于两个内容脚本之间。
 *
 * 安全约束：
 * - 不向页面暴露任何全局名（无 __spoofNatives / __applySpoofConfig / __fakeRTC）。
 * - 不接受无令牌的 postMessage，页面没有任何通道可以降级防护。
 * - 国内/本地页面在 split 模式下零改动，直接 return。
 * - 域名判不出来时按国外伪装（fail-closed），绝不静默放行真实环境。
 */
(function () {
  'use strict';

  var root = typeof globalThis !== 'undefined' ? globalThis
    : (typeof self !== 'undefined' ? self : window);
  var SELF_SRC = (typeof SRC === 'string' && SRC) || '';
  var DEFAULTS = {
    mode: 'split', webrtcMode: 'spoof', localeMode: 'spoof',
    tz: 'America/Los_Angeles', lang: 'en-US', langList: ['en-US', 'en'],
    geoLat: 34.0522, geoLng: -118.2437
  };

  /** 读取注册时写入的共享名单/模式，读完立即删除，避免页面枚举到内部全局。 */
  function takeGlobal(name, fallback) {
    try {
      var v = root[name];
      delete root[name];
      return v === undefined ? fallback : v;
    } catch (e) { return fallback; }
  }

  var LISTS = takeGlobal('__WDS_LISTS', null);
  var CN_LIST = (LISTS && Array.isArray(LISTS.cn)) ? LISTS.cn
    : ((typeof CN_DOMAINS !== 'undefined' && CN_DOMAINS) ? CN_DOMAINS : []);
  var FOREIGN_LIST = (LISTS && Array.isArray(LISTS.foreign)) ? LISTS.foreign
    : ((typeof FOREIGN_DOMAINS !== 'undefined' && FOREIGN_DOMAINS) ? FOREIGN_DOMAINS : []);
  var MODE = takeGlobal('__WDS_MODE', 'split') === 'global' ? 'global' : 'split';

  /** 归一化存储配置：非法值一律回退默认，避免空 tz/lang 造成指纹断裂。 */
  function normalizeConfig(raw) {
    var c = Object.assign({}, DEFAULTS, raw && typeof raw === 'object' ? raw : {});
    if (typeof c.tz !== 'string' || !c.tz) c.tz = DEFAULTS.tz;
    if (typeof c.lang !== 'string' || !c.lang) c.lang = DEFAULTS.lang;
    if (!Array.isArray(c.langList) || !c.langList.length) c.langList = [c.lang, c.lang.split('-')[0]];
    if (!isFinite(c.geoLat)) c.geoLat = DEFAULTS.geoLat;
    if (!isFinite(c.geoLng)) c.geoLng = DEFAULTS.geoLng;
    return c;
  }

  var current = normalizeConfig(typeof CFG === 'object' && CFG ? CFG : null);
  if (typeof CFG !== 'object' || !CFG) current.mode = MODE;

  var TOKEN_ATTR = 'data-wds-k';

  function randomToken() {
    try {
      var buf = new Uint8Array(16);
      root.crypto.getRandomValues(buf);
      var s = '';
      for (var i = 0; i < buf.length; i++) s += (buf[i] < 16 ? '0' : '') + buf[i].toString(16);
      return s;
    } catch (e) { return String(Math.random()).slice(2) + String(Date.now()); }
  }

  /**
   * 与 boot.js 的 rendezvous：先到者写入 DOM 属性，后到者读取并删除。
   * 两个内容脚本都早于页面脚本执行，所以页面永远看不到令牌；令牌只用来拒伪造消息。
   */
  function rendezvousToken() {
    try {
      var el = document && document.documentElement;
      if (!el) return null;
      var t = el.getAttribute(TOKEN_ATTR);
      if (t) { el.removeAttribute(TOKEN_ATTR); return t; }
      t = randomToken();
      el.setAttribute(TOKEN_ATTR, t);
      return t;
    } catch (e) { return null; }
  }

  function hostMatches(host, list) {
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (host === d || host.endsWith('.' + d)) return true;
    }
    return false;
  }

  /** 国内域名判定：名单 + .cn + .中国（punycode 为 .xn--fiqs8s）。 */
  function pageIsChina(host) {
    if (!host) return false;
    var h = host.toLowerCase();
    if (hostMatches(h, FOREIGN_LIST)) return false;
    if (/\.(cn|xn--fiqs8s)$/.test(h)) return true;
    return hostMatches(h, CN_LIST);
  }

  /** 本地/内网判定。空 host 一律返回 false——判不出来就必须伪装。 */
  function isLocalIntranet(host) {
    if (!host) return false;
    var h = host.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
    if (h.indexOf(':') >= 0) {
      if (h === '::1' || h === '::' || h === '0:0:0:0:0:0:0:1') return true;
      if (/^fe[89ab][0-9a-f]{2}:/.test(h) || /^f[cd][0-9a-f]{2}:/.test(h)) return true;
      if (h.indexOf('::ffff:') === 0) return isLocalIntranet(h.slice(7));
      return false;
    }
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
      var p = h.split('.').map(Number);
      return p[0] === 10 || p[0] === 127 || p[0] === 0 ||
        (p[0] === 169 && p[1] === 254) || (p[0] === 192 && p[1] === 168) ||
        (p[0] === 172 && p[1] >= 16 && p[1] <= 31);
    }
    if (h === 'localhost' || /\.local$/.test(h)) return true;
    return h.indexOf('.') < 0;
  }

  /**
   * 当前文档应使用的判定主机名。
   * about:blank/srcdoc/data/blob 没有自己的 hostname，取直接父页面来源；
   * 取不到则返回空串（上层按国外处理）。
   */
  function frameHost() {
    try {
      var h = (root.location && root.location.hostname || '').toLowerCase();
      if (h) return h;
      var ao = root.location && root.location.ancestorOrigins;
      if (ao && ao.length) return new URL(ao[ao.length - 1]).hostname.toLowerCase();
      if (typeof document !== 'undefined' && document.referrer) {
        return new URL(document.referrer).hostname.toLowerCase();
      }
    } catch (e) { /* 跨源读不到就走伪装 */ }
    return '';
  }

  var host = frameHost();
  var bridgeToken = rendezvousToken();
  var spoofEnv = current.mode === 'global' || !(pageIsChina(host) || isLocalIntranet(host));
  if (!spoofEnv) {
    // 国内/本地：不装任何 hook；若自己写了握手令牌，立即清掉并回 ack，避免通道空转
    try {
      if (bridgeToken) {
        root.postMessage({ __wds: 1, token: bridgeToken, ack: 1, skip: 1 }, '*');
        var el = document && document.documentElement;
        if (el && el.getAttribute(TOKEN_ATTR) === bridgeToken) el.removeAttribute(TOKEN_ATTR);
        bridgeToken = null;
      }
    } catch (e) { /* 忽略 */ }
    return;
  }

  /** 配置通道：只接受带本次令牌的消息；应用一次后立即注销监听。 */
  function applyBridgeConfig(d) {
    if (!d || d.__wds !== 1 || !bridgeToken || d.token !== bridgeToken) return false;
    bridgeToken = null;
    try {
      var el = document && document.documentElement;
      if (el && el.getAttribute(TOKEN_ATTR) === d.token) el.removeAttribute(TOKEN_ATTR);
    } catch (e) { /* 忽略 */ }
    if (typeof d.src === 'string' && d.src) SELF_SRC = d.src;
    Object.assign(current, normalizeConfig(d.cfg));
    offsetCache.clear();
    offsetDtf = null;
    nameDtf = null;
    try { root.postMessage({ __wds: 1, token: d.token, ack: 1 }, '*'); } catch (e) { /* 无 window 的 Worker 环境 */ }
    return true;
  }

  function onBridgeMessage(e) {
    if (applyBridgeConfig(e && e.data) && root.removeEventListener) {
      root.removeEventListener('message', onBridgeMessage, false);
    }
  }
  if (root.addEventListener) root.addEventListener('message', onBridgeMessage, false);

  // ---------- 原生引用（全部留在闭包，页面不可达） ----------
  var NativeDate = root.Date;
  var dateProto = NativeDate.prototype;
  var natives = {
    DTF: root.Intl && root.Intl.DateTimeFormat,
    dateToString: dateProto.toString,
    dateGetTZO: dateProto.getTimezoneOffset,
    dateToLocaleString: dateProto.toLocaleString,
    dateToLocaleDateString: dateProto.toLocaleDateString,
    dateToLocaleTimeString: dateProto.toLocaleTimeString,
    dateParse: NativeDate.parse,
    dateUTC: NativeDate.UTC,
    dateNow: NativeDate.now,
    RTC: root.RTCPeerConnection,
    webkitRTC: root.webkitRTCPeerConnection
  };
  var realLocale = 'en-US';
  try { realLocale = natives.DTF().resolvedOptions().locale || 'en-US'; } catch (e) { /* 保持默认 */ }

  // ---------- Function.prototype.toString 掩码（仅在被保护页安装） ----------
  var nativeSourceMap = new WeakMap();
  var nativeFTS = Function.prototype.toString;
  var maskInstalled = false;

  function ensureMask() {
    if (maskInstalled) return;
    maskInstalled = true;
    // 不加任何自有属性：原生 Function.prototype.toString 的 own names 只有 length/name
    Function.prototype.toString = methodOf(function () {
      if (nativeSourceMap.has(this)) return nativeSourceMap.get(this);
      return nativeFTS.call(this);
    });
    nativeSourceMap.set(Function.prototype.toString, 'function toString() { [native code] }');
  }

  /** 记录一个函数的原生源码，让 .toString() 输出与原生一致。 */
  function markNative(fake, nativeRef, name) {
    try {
      var src = nativeRef ? nativeFTS.call(nativeRef) : 'function ' + (name || '') + '() { [native code] }';
      nativeSourceMap.set(fake, src);
    } catch (e) { /* 掩码失败不影响功能 */ }
  }

  /**
   * 原生方法是"方法定义"创建的，没有 own prototype；普通函数表达式会多一个 prototype 属性，
   * 一眼可被 Object.getOwnPropertyNames 识破。这里用方法简写包一层，保持原生表面。
   */
  function methodOf(impl) {
    return {
      invoke() { return impl.apply(this, arguments); }   // 方法简写（不是 invoke: function）才没有 own prototype
    }.invoke;
  }

  function setMeta(fn, name, length, isCtor) {
    if (!isCtor) fn = methodOf(fn);
    try {
      Object.defineProperty(fn, 'name', { value: name, configurable: true });
      if (length !== undefined) Object.defineProperty(fn, 'length', { value: length, configurable: true });
    } catch (e) { /* 老内核忽略 */ }
    return fn;
  }

  // ---------- 时区换算层：所有 Date 本地时间读数都走这一个 offset 来源 ----------
  var BUCKET = 900000;              // 15 分钟桶：DST 切换当天误差窗口可控，且避免无界增长
  var offsetCache = new Map();
  var offsetDtf = null;
  var nameDtf = null;

  function computeOffset(date) {
    try {
      if (!offsetDtf) offsetDtf = new natives.DTF('en-US', { timeZone: current.tz, timeZoneName: 'longOffset' });
      var parts = offsetDtf.formatToParts(date);
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type !== 'timeZoneName') continue;
        var v = parts[i].value;
        if (v === 'GMT') return 0;
        var m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(v);
        if (m) return (m[1] === '-' ? 1 : -1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
      }
    } catch (e) { /* 落到原生 offset，至少不返回错误数值 */ }
    return natives.dateGetTZO.call(date);
  }

  /** 目标时区在 date 时刻的 getTimezoneOffset 值（UTC−本地，分钟）；无效日期返回 NaN。 */
  function offsetMinutesFor(date) {
    var t = date.getTime();
    if (t !== t) return NaN;
    var bucket = Math.floor(t / BUCKET);
    var hit = offsetCache.get(bucket);
    if (hit !== undefined) return hit;
    var off = computeOffset(date);
    if (offsetCache.size > 8192) offsetCache.clear();
    offsetCache.set(bucket, off);
    return off;
  }

  /** 把真实时间戳平移成"目标时区的墙钟"，再用 UTC getter 读本地分量。 */
  function localDateFor(date) {
    return new NativeDate(date.getTime() - offsetMinutesFor(date) * 60000);
  }

  /** 墙钟（视为 UTC 的毫秒数）→ 目标时区下的真实时间戳；迭代一次以跨过 DST 边界。 */
  function wallToUtc(wall) {
    var off = offsetMinutesFor(new NativeDate(wall));
    var t = wall + off * 60000;
    var off2 = offsetMinutesFor(new NativeDate(t));
    if (off2 !== off) t = wall + off2 * 60000;
    return t;
  }

  var LOCAL_GET = {
    getFullYear: 'getUTCFullYear', getMonth: 'getUTCMonth', getDate: 'getUTCDate',
    getDay: 'getUTCDay', getHours: 'getUTCHours', getMinutes: 'getUTCMinutes',
    getSeconds: 'getUTCSeconds', getMilliseconds: 'getUTCMilliseconds'
  };
  var LOCAL_SET = {
    setFullYear: 'setUTCFullYear', setMonth: 'setUTCMonth', setDate: 'setUTCDate',
    setHours: 'setUTCHours', setMinutes: 'setUTCMinutes', setSeconds: 'setUTCSeconds',
    setMilliseconds: 'setUTCMilliseconds'
  };
  var WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function gmtSuffix(off) {
    var a = Math.abs(off);
    return 'GMT' + (off >= 0 ? '-' : '+') + pad2(Math.floor(a / 60)) + pad2(a % 60);
  }

  /** 长时区名（如 Pacific Standard Time / 北美太平洋标准时间），对齐原生而非 PST 缩写。 */
  function longTzName(date) {
    try {
      if (!nameDtf) nameDtf = new natives.DTF(realLocale, { timeZone: current.tz, timeZoneName: 'long' });
      var parts = nameDtf.formatToParts(date);
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === 'timeZoneName') return parts[i].value;
      }
    } catch (e) { /* 用 GMT 后缀兜底 */ }
    return gmtSuffix(offsetMinutesFor(date));
  }

  function localParts(date) {
    var l = localDateFor(date);
    return {
      weekday: WEEK[l.getUTCDay()], month: MONTH[l.getUTCMonth()],
      day: pad2(l.getUTCDate()), year: l.getUTCFullYear(),
      time: pad2(l.getUTCHours()) + ':' + pad2(l.getUTCMinutes()) + ':' + pad2(l.getUTCSeconds())
    };
  }

  function withSpoofTz(options) {
    var o = {};
    if (options) Object.keys(options).forEach(function (k) { o[k] = options[k]; });
    if (o.timeZone === undefined) o.timeZone = current.tz;
    return o;
  }

  /** 用目标时区解释本地时间字符串；date-only 与显式时区字符串保持原生语义。 */
  function parseInSpoofTz(str) {
    var t = natives.dateParse(str);
    if (t !== t) return NaN;
    var s = String(str).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return t;                    // 规范：date-only 按 UTC
    if (/[zZ]$/.test(s)) return t;
    if (/[+-]\d{2}:?\d{2}\s*(\([^)]*\))?$/.test(s)) return t;       // 自带 ±HH:MM
    if (/(GMT|UTC)/i.test(s)) return t;
    var realOff = natives.dateGetTZO.call(new NativeDate(t));
    return wallToUtc(t - realOff * 60000);
  }

  function hookDate() {
    Object.keys(LOCAL_GET).forEach(function (m) {
      var orig = dateProto[m];
      var fn = setMeta(function () {
        if (this.getTime() !== this.getTime()) return NaN;
        return localDateFor(this)[LOCAL_GET[m]]();
      }, m, 0);
      dateProto[m] = fn;
      markNative(fn, orig, m);
    });

    var origGetYear = dateProto.getYear;
    var getYear = setMeta(function () {
      if (this.getTime() !== this.getTime()) return NaN;
      return localDateFor(this).getUTCFullYear() - 1900;
    }, 'getYear', 0);
    dateProto.getYear = getYear;
    markNative(getYear, origGetYear, 'getYear');

    var getTZO = setMeta(function () { return offsetMinutesFor(this); }, 'getTimezoneOffset', 0);
    dateProto.getTimezoneOffset = getTZO;
    markNative(getTZO, natives.dateGetTZO, 'getTimezoneOffset');

    Object.keys(LOCAL_SET).forEach(function (m) {
      var orig = dateProto[m];
      var fn = setMeta(function () {
        if (this.getTime() !== this.getTime()) return orig.apply(this, arguments);
        var local = localDateFor(this);
        local[LOCAL_SET[m]].apply(local, arguments);
        var t = wallToUtc(local.getTime());
        this.setTime(t);
        return t;
      }, m, orig.length);
      dateProto[m] = fn;
      markNative(fn, orig, m);
    });

    var origSetYear = dateProto.setYear;
    var setYear = setMeta(function (y) {
      var full = (y >= 0 && y <= 99) ? 1900 + y : y;
      return dateProto.setFullYear.call(this, full);
    }, 'setYear', 1);
    dateProto.setYear = setYear;
    markNative(setYear, origSetYear, 'setYear');

    var toString = setMeta(function () {
      if (this.getTime() !== this.getTime()) return 'Invalid Date';
      var p = localParts(this);
      return p.weekday + ' ' + p.month + ' ' + p.day + ' ' + p.year + ' ' + p.time +
        ' ' + gmtSuffix(offsetMinutesFor(this)) + ' (' + longTzName(this) + ')';
    }, 'toString', 0);
    dateProto.toString = toString;
    markNative(toString, natives.dateToString, 'toString');

    var toTimeString = setMeta(function () {
      if (this.getTime() !== this.getTime()) return 'Invalid Date';
      var p = localParts(this);
      return p.time + ' ' + gmtSuffix(offsetMinutesFor(this)) + ' (' + longTzName(this) + ')';
    }, 'toTimeString', 0);
    dateProto.toTimeString = toTimeString;
    markNative(toTimeString, dateProto.toTimeString, 'toTimeString');

    var toDateString = setMeta(function () {
      if (this.getTime() !== this.getTime()) return 'Invalid Date';
      var p = localParts(this);
      return p.weekday + ' ' + p.month + ' ' + p.day + ' ' + p.year;
    }, 'toDateString', 0);
    dateProto.toDateString = toDateString;
    markNative(toDateString, dateProto.toDateString, 'toDateString');

    [['toLocaleString', natives.dateToLocaleString],
      ['toLocaleDateString', natives.dateToLocaleDateString],
      ['toLocaleTimeString', natives.dateToLocaleTimeString]].forEach(function (pair) {
      var fn = setMeta(function (locales, options) {
        return pair[1].call(this, locales, withSpoofTz(options));
      }, pair[0], 0);
      dateProto[pair[0]] = fn;
      markNative(fn, pair[1], pair[0]);
    });

    // 构造器：多参数数字形式与单字符串形式都按目标时区解释本地时间
    function SpoofDate(y, m, d, h, mi, s, ms) {
      if (!new.target) return dateProto.toString.call(new NativeDate());
      var n = arguments.length;
      if (n === 0) return new NativeDate();
      if (n === 1) {
        if (typeof y === 'string') return new NativeDate(SpoofDate.parse(y));
        return new NativeDate(y);
      }
      var wall = natives.dateUTC(
        y, m, d === undefined ? 1 : d, h === undefined ? 0 : h,
        mi === undefined ? 0 : mi, s === undefined ? 0 : s, ms === undefined ? 0 : ms
      );
      return new NativeDate(wallToUtc(wall));
    }
    SpoofDate.parse = setMeta(parseInSpoofTz, 'parse', 1);
    SpoofDate.UTC = natives.dateUTC;
    SpoofDate.now = natives.dateNow;
    setMeta(SpoofDate, 'Date', undefined, true);
    SpoofDate.prototype = dateProto;
    markNative(SpoofDate.parse, natives.dateParse, 'parse');
    try {
      Object.defineProperty(dateProto, 'constructor', { value: SpoofDate, writable: true, configurable: true });
    } catch (e) { /* 极端内核忽略 */ }
    markNative(SpoofDate, NativeDate, 'Date');
    root.Date = SpoofDate;
  }

  // ---------- Intl：默认语言/时区跟随出口，显式参数优先 ----------
  function wrapLocaleCtor(Ctor, name, withTimeZone, callableWithoutNew) {
    function Wrapped(locales, options) {
      if (!new.target && !callableWithoutNew) {
        throw new TypeError("Constructor " + name + " requires 'new'");
      }
      var loc = (locales == null || (Array.isArray(locales) && locales.length === 0)) ? current.langList : locales;
      var o = {};
      if (options) Object.keys(options).forEach(function (k) { o[k] = options[k]; });
      if (!o.localeMatcher) o.localeMatcher = 'best fit';
      if (withTimeZone && o.timeZone === undefined) o.timeZone = current.tz;
      return new Ctor(loc, o);
    }
    setMeta(Wrapped, name, 0, true);
    Wrapped.prototype = Ctor.prototype;
    try {
      Object.defineProperty(Ctor.prototype, 'constructor', { value: Wrapped, writable: true, configurable: true });
    } catch (e) { /* 忽略 */ }
    Object.getOwnPropertyNames(Ctor).forEach(function (k) {
      if (k === 'length' || k === 'name' || k === 'prototype') return;
      try { Wrapped[k] = Ctor[k]; } catch (e) { /* 只读静态忽略 */ }
    });
    markNative(Wrapped, Ctor, name);
    return Wrapped;
  }

  function hookIntl() {
    if (!root.Intl) return;
    ['DateTimeFormat', 'NumberFormat', 'Collator', 'PluralRules', 'RelativeTimeFormat', 'ListFormat', 'DisplayNames']
      .forEach(function (name) {
        var C = root.Intl[name];
        if (typeof C !== 'function') return;
        root.Intl[name] = wrapLocaleCtor(
          C, name, name === 'DateTimeFormat', name === 'DateTimeFormat' || name === 'NumberFormat'
        );
      });
  }

  // ---------- Navigator / Geolocation / Permissions ----------
  function makeCoords() {
    var coords = {
      latitude: current.geoLat, longitude: current.geoLng, accuracy: 30,
      altitude: 100, altitudeAccuracy: 10, heading: null, speed: null,
      toJSON: methodOf(function () {
        return {
          latitude: this.latitude, longitude: this.longitude, accuracy: this.accuracy,
          altitude: this.altitude, altitudeAccuracy: this.altitudeAccuracy,
          heading: this.heading, speed: this.speed
        };
      })
    };
    try {
      if (root.GeolocationCoordinates) Object.setPrototypeOf(coords, root.GeolocationCoordinates.prototype);
    } catch (e) { /* 无此构造器的环境保持普通对象 */ }
    return coords;
  }

  function makePosition() {
    var pos = {
      coords: makeCoords(), timestamp: natives.dateNow(),
      toJSON: methodOf(function () { return { coords: this.coords.toJSON(), timestamp: this.timestamp }; })
    };
    try {
      if (root.GeolocationPosition) Object.setPrototypeOf(pos, root.GeolocationPosition.prototype);
    } catch (e) { /* 同上 */ }
    return pos;
  }

  function hookGeolocation(nav) {
    var geo = nav.geolocation;
    if (!geo) return;
    var proto = Object.getPrototypeOf(geo);
    if (!proto) return;
    var timers = new Map();
    var seq = 1;
    var getCurrentPosition = setMeta(function (success) {
      setTimeout(function () { if (typeof success === 'function') success(makePosition()); }, 100);
    }, 'getCurrentPosition', 1);
    var watchPosition = setMeta(function (success) {
      var id = seq++;
      var t = setTimeout(function () {
        timers.delete(id);
        if (typeof success === 'function') success(makePosition());
      }, 100);
      timers.set(id, t);
      return id;
    }, 'watchPosition', 1);
    var clearWatch = setMeta(function (id) {
      var t = timers.get(id);
      if (t) { clearTimeout(t); timers.delete(id); }
    }, 'clearWatch', 1);
    proto.getCurrentPosition = getCurrentPosition;
    proto.watchPosition = watchPosition;
    proto.clearWatch = clearWatch;
    markNative(getCurrentPosition, natives.geoGetCurrentPosition, 'getCurrentPosition');
    markNative(watchPosition, natives.geoWatchPosition, 'watchPosition');
    markNative(clearWatch, natives.geoClearWatch, 'clearWatch');
  }

  function hookPermissions(nav) {
    if (!nav.permissions) return;
    var proto = Object.getPrototypeOf(nav.permissions);
    if (!proto) return;
    var orig = proto.query;
    if (typeof orig !== 'function') return;
    // 挂在原型上：navigator.permissions 实例保持零自有属性
    var query = setMeta(function (descriptor) {
      if (!descriptor || descriptor.name !== 'geolocation') return orig.apply(this, arguments);
      return orig.call(this, descriptor).then(function (status) {
        try {
          Object.defineProperty(status, 'state', { get: function () { return 'granted'; }, configurable: true });
        } catch (e) { /* 保留原生状态 */ }
        return status;
      }, function () {
        return { name: 'geolocation', state: 'granted', onchange: null };
      });
    }, 'query', 1);
    proto.query = query;
    markNative(query, orig, 'query');
  }

  function hookNavigator() {
    var nav = root.navigator;
    if (!nav) return;
    var proto = Object.getPrototypeOf(nav);
    [['language', function () { return current.lang; }],
      ['languages', function () { return Object.freeze(current.langList.slice()); }]]
      .forEach(function (pair) {
        var desc = Object.getOwnPropertyDescriptor(proto, pair[0]);
        if (desc && desc.configurable === false) return;
        var getter = setMeta(pair[1], 'get ' + pair[0]);
        try {
          Object.defineProperty(proto, pair[0], {
            get: getter, enumerable: desc ? desc.enumerable : true, configurable: true
          });
          if (desc && desc.get) markNative(getter, desc.get, 'get ' + pair[0]);
        } catch (e) { /* 只读环境忽略 */ }
      });
    hookGeolocation(nav);
    hookPermissions(nav);
  }

  // ---------- WebRTC：状态全部入 WeakMap，表面与原生对齐 ----------
  function makeSdp(config, type) {
    var ice = config && config.iceServers ? config.iceServers : [];
    var ufrag = Math.random().toString(36).slice(2, 10);
    var pwd = Math.random().toString(36).slice(2, 26);
    var fp = Array.from({ length: 32 }, function () {
      return Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase();
    }).join(':');
    // 只留 mDNS 候选：任何 STUN/srflx 都会把真实 IP 写进 SDP
    var lines = ['v=0', 'o=- ' + Math.floor(Math.random() * 1e10) + ' 2 IN IP4 127.0.0.1',
      's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=msid-semantic: WMS',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111', 'c=IN IP4 0.0.0.0', 'a=rtcp:9 IN IP4 0.0.0.0',
      'a=ice-ufrag:' + ufrag, 'a=ice-pwd:' + pwd,
      'a=fingerprint:sha-256 ' + fp, 'a=setup:actpass', 'a=mid:0', 'a=sendrecv',
      'a=rtcp-mux', 'a=rtpmap:111 opus/48000/2'];
    // 真实 Chrome 的 SDP 里也有候选行；只写 mDNS 主机候选，绝不出现 srflx/公网 IP
    lines.push('a=candidate:1 1 udp 2130706431 ' + randomMdns() + '.local 9 typ host');
    ice.forEach(function (srv) {
      (srv.urls ? [].concat(srv.urls) : []).forEach(function (u) {
        if (u.indexOf('turn:') === 0 || u.indexOf('turns:') === 0) lines.push('a=candidate:0 1 udp 2130706431 relay.local 9 typ relay');
      });
    });
    return lines.join('\r\n') + '\r\n';
  }

  function randomMdns() {
    var hex = '0123456789abcdef';
    var s = '';
    for (var i = 0; i < 8; i++) s += hex[Math.floor(Math.random() * 16)];
    s += '-';
    for (var j = 0; j < 4; j++) s += hex[Math.floor(Math.random() * 16)];
    return s;
  }

  function applyRtc() {
    if (current.webrtcMode === 'disable') {
      if (natives.RTC) root.RTCPeerConnection = undefined;
      if (natives.webkitRTC) root.webkitRTCPeerConnection = undefined;
      return;
    }
    if (current.webrtcMode !== 'spoof') return;      // off：保留原生
    if (typeof natives.RTC !== 'function') return;   // Worker 等无 RTC 环境，不凭空造构造器

    var NativeRTC = natives.RTC;
    var stateMap = new WeakMap();
    var HANDLERS = ['icecandidate', 'iceconnectionstatechange', 'signalingstatechange',
      'connectionstatechange', 'icegatheringstatechange', 'negotiationneeded', 'track', 'datachannel'];
    var proto = {};

    function st(pc) {
      var s = stateMap.get(pc);
      if (!s) throw new TypeError('Illegal invocation');
      return s;
    }

    function makeDesc(init) {
      if (typeof root.RTCSessionDescription === 'function') {
        try { return new root.RTCSessionDescription(init); } catch (e) { /* 落到普通对象 */ }
      }
      return { type: init.type, sdp: init.sdp, toJSON: function () { return { type: this.type, sdp: this.sdp }; } };
    }

    function fire(pc, type, props) {
      var s = st(pc);
      if (s.closed) return;
      var event = typeof root.Event === 'function' ? new root.Event(type) : { type: type };
      if (props) {
        Object.keys(props).forEach(function (k) {
          try { Object.defineProperty(event, k, { value: props[k], enumerable: true, configurable: true }); } catch (e) { /* 忽略 */ }
        });
      }
      try { Object.defineProperty(event, 'isTrusted', { value: true, configurable: true }); } catch (e) { /* 忽略 */ }
      try { Object.defineProperty(event, 'target', { value: pc, configurable: true }); } catch (e) { /* 忽略 */ }
      var h = s.handlers[type];
      if (typeof h === 'function') h.call(pc, event);
      (s.listeners[type] || []).slice().forEach(function (fn) { fn.call(pc, event); });
    }

    function schedule(pc, fn, ms) {
      var s = st(pc);
      s.timers.push(setTimeout(function () { if (!s.closed) fn(); }, ms));
    }

    function makeCandidates() {
      var out = [];
      var count = 1 + Math.floor(Math.random() * 3);
      for (var i = 0; i < count; i++) {
        var init = {
          candidate: 'candidate:' + i + ' 1 udp ' + (2e9 - i) + ' ' + randomMdns() + '.local ' +
            (50000 + Math.floor(Math.random() * 10000)) + ' typ host',
          sdpMid: '0', sdpMLineIndex: 0
        };
        var cand = init;
        if (typeof root.RTCIceCandidate === 'function') {
          try { cand = new root.RTCIceCandidate(init); } catch (e) { cand = init; }
        }
        out.push(cand);
      }
      return out;
    }

    function startGathering(pc) {
      var s = st(pc);
      s.iceGatheringState = 'gathering';
      fire(pc, 'icegatheringstatechange');
      var cands = makeCandidates();
      cands.forEach(function (c, i) {
        schedule(pc, function () { fire(pc, 'icecandidate', { candidate: c }); }, i * 80);
      });
      schedule(pc, function () {
        fire(pc, 'icecandidate', { candidate: null });
        s.iceGatheringState = 'complete';
        fire(pc, 'icegatheringstatechange');
      }, cands.length * 80 + 50);
    }

    function FakeRTCPeerConnection() {
      stateMap.set(this, {
        config: Object.assign({}, arguments[0]),
        signalingState: 'stable', iceGatheringState: 'new', iceConnectionState: 'new', connectionState: 'new',
        localDescription: null, remoteDescription: null,
        senders: [], transceivers: [], streams: [], channels: [],
        listeners: {}, handlers: {}, timers: [], closed: false
      });
    }

    function defMethod(name, fn, arity) {
      fn = setMeta(fn, name, arity || 0);
      Object.defineProperty(proto, name, { value: fn, writable: true, enumerable: true, configurable: true });
      markNative(fn, NativeRTC.prototype[name], name);
    }

    function defGetter(name, read) {
      var getter = setMeta(read, 'get ' + name);
      Object.defineProperty(proto, name, { get: getter, enumerable: true, configurable: true });
    }

    defMethod('createOffer', function () {
      return Promise.resolve(makeDesc({ type: 'offer', sdp: makeSdp(st(this).config, 'offer') }));
    });
    defMethod('createAnswer', function () {
      return Promise.resolve(makeDesc({ type: 'answer', sdp: makeSdp(st(this).config, 'answer') }));
    });
    defMethod('setLocalDescription', function (desc) {
      var s = st(this);
      s.localDescription = makeDesc(desc);
      if (desc && desc.type === 'offer') s.signalingState = 'have-local-offer';
      if (desc && desc.type === 'answer') s.signalingState = 'stable';
      startGathering(this);
      return Promise.resolve();
    }, 1);
    defMethod('setRemoteDescription', function (desc) {
      var s = st(this);
      s.remoteDescription = makeDesc(desc);
      if (desc && desc.type === 'offer') s.signalingState = 'have-remote-offer';
      if (desc && desc.type === 'answer') s.signalingState = 'stable';
      return Promise.resolve();
    }, 1);
    defMethod('addIceCandidate', function () { st(this); return Promise.resolve(); }, 1);
    defMethod('getStats', function () { st(this); return Promise.resolve(new Map()); });
    defMethod('close', function () {
      var s = st(this);
      s.timers.forEach(clearTimeout);
      s.timers = [];
      s.closed = true;
      s.signalingState = 'closed';
      s.iceConnectionState = 'closed';
      s.connectionState = 'closed';
      s.iceGatheringState = 'complete';
    });
    defMethod('addTrack', function (track) {
      var s = st(this);
      var sender = { track: track, replaceTrack: function (t) { this.track = t; return Promise.resolve(); } };
      s.senders.push(sender);
      return sender;
    }, 1);
    defMethod('removeTrack', function (sender) {
      var s = st(this);
      s.senders = s.senders.filter(function (x) { return x !== sender; });
    }, 1);
    defMethod('getSenders', function () { return st(this).senders.slice(); });
    defMethod('getReceivers', function () {
      return st(this).transceivers.map(function (t) { return t.receiver; });
    });
    defMethod('getTransceivers', function () { return st(this).transceivers.slice(); });
    defMethod('addTransceiver', function (trackOrKind) {
      var s = st(this);
      var track = typeof trackOrKind === 'object' ? trackOrKind : { kind: trackOrKind };
      var transceiver = { mid: null, sender: { track: track }, receiver: { track: track }, direction: 'sendrecv' };
      s.transceivers.push(transceiver);
      s.senders.push(transceiver.sender);
      return transceiver;
    }, 1);
    defMethod('createDTMFSender', function (sender) {
      st(this);
      return { sender: sender, toneBuffer: '', ontonechange: null, insertDTMF: function () {} };
    }, 1);
    defMethod('addStream', function (stream) { st(this).streams.push(stream); }, 1);
    defMethod('removeStream', function (stream) {
      var s = st(this);
      s.streams = s.streams.filter(function (x) { return x !== stream; });
    }, 1);
    defMethod('getLocalStreams', function () { return st(this).streams.slice(); });
    defMethod('getRemoteStreams', function () { return []; });
    defMethod('setConfiguration', function (config) { st(this).config = Object.assign({}, config); }, 1);
    defMethod('getConfiguration', function () { return Object.assign({}, st(this).config); });
    defMethod('restartIce', function () { st(this); });
    defMethod('addEventListener', function (type, fn) {
      var s = st(this);
      (s.listeners[type] = s.listeners[type] || []).push(fn);
    }, 2);
    defMethod('removeEventListener', function (type, fn) {
      var s = st(this);
      s.listeners[type] = (s.listeners[type] || []).filter(function (x) { return x !== fn; });
    }, 2);
    defMethod('dispatchEvent', function (event) { fire(this, event.type, event); return true; }, 1);
    defMethod('createDataChannel', function (label, options) {
      var s = st(this);
      var channel = {
        label: label || '', ordered: !(options && options.ordered === false),
        protocol: (options && options.protocol) || '',
        readyState: 'connecting', bufferedAmount: 0, binaryType: 'arraybuffer',
        onopen: null, onmessage: null, onclose: null, onerror: null,
        send: function () { throw new Error('not connected'); },
        close: function () { this.readyState = 'closed'; }
      };
      s.channels.push(channel);
      schedule(this, function () {
        channel.readyState = 'open';
        fire(this, 'datachannel', { channel: channel });
        if (typeof channel.onopen === 'function') channel.onopen({ type: 'open' });
      }, 50);
      return channel;
    }, 1);

    [['signalingState', 'signalingState'], ['iceGatheringState', 'iceGatheringState'],
      ['iceConnectionState', 'iceConnectionState'], ['connectionState', 'connectionState'],
      ['localDescription', 'localDescription'], ['pendingLocalDescription', 'localDescription'],
      ['currentLocalDescription', 'localDescription'], ['remoteDescription', 'remoteDescription'],
      ['pendingRemoteDescription', 'remoteDescription'], ['currentRemoteDescription', 'remoteDescription']]
      .forEach(function (pair) {
        defGetter(pair[0], function () { return st(this)[pair[1]]; });
      });
    defGetter('canTrickleIceCandidates', function () { st(this); return null; });
    defGetter('sctp', function () { st(this); return null; });

    HANDLERS.forEach(function (type) {
      Object.defineProperty(proto, 'on' + type, {
        get: setMeta(function () { return st(this).handlers[type] || null; }, 'get on' + type),
        set: setMeta(function (fn) { st(this).handlers[type] = fn; }, 'set on' + type, 1),
        enumerable: true, configurable: true
      });
    });

    setMeta(FakeRTCPeerConnection, 'RTCPeerConnection', 0, true);
    FakeRTCPeerConnection.prototype = proto;
    FakeRTCPeerConnection.generateCertificate = setMeta(
      function () { return Promise.resolve({}); }, 'generateCertificate', 1
    );
    Object.defineProperty(proto, 'constructor', { value: FakeRTCPeerConnection, writable: true, configurable: true });
    markNative(FakeRTCPeerConnection, NativeRTC, 'RTCPeerConnection');
    markNative(FakeRTCPeerConnection.generateCertificate, NativeRTC.generateCertificate, 'generateCertificate');
    root.RTCPeerConnection = FakeRTCPeerConnection;
    // 别名只在原生存在时替换：Chrome 本来就没有 mozRTCPeerConnection，不能凭空造出指纹
    if (natives.webkitRTC) root.webkitRTCPeerConnection = FakeRTCPeerConnection;
  }

  // ---------- Worker：把同一份自包含代码注入 classic worker ----------
  function installWorkerHook() {
    var NativeWorker = root.Worker;
    if (typeof NativeWorker !== 'function') return;

    function buildWorkerCode(absUrl) {
      return '(function(){var CFG=' + JSON.stringify(current) + ';var SRC=' + JSON.stringify(SELF_SRC) +
        ';\n' + SELF_SRC + '\n})();\n;importScripts(' + JSON.stringify(absUrl) + ');';
    }

    function WrappedWorker(url, options) {
      if (options && options.type === 'module') return new NativeWorker(url, options);
      if (!SELF_SRC) return new NativeWorker(url, options);   // 配置/源码尚未到达：先放原生，不做半成品
      try {
        var abs = new URL(String(url), root.location.href).href;
        if (/^data:/i.test(abs)) return new NativeWorker(url, options);
        var blobUrl = URL.createObjectURL(new Blob([buildWorkerCode(abs)], { type: 'text/javascript' }));
        return new NativeWorker(blobUrl, options);
      } catch (e) {
        // CSP worker-src 等限制下回退原生，宁可不伪装也不把站点弄坏
        return new NativeWorker(url, options);
      }
    }
    setMeta(WrappedWorker, 'Worker', 1, true);
    WrappedWorker.prototype = NativeWorker.prototype;
    markNative(WrappedWorker, NativeWorker, 'Worker');
    root.Worker = WrappedWorker;
  }

  ensureMask();
  hookDate();
  hookIntl();
  hookNavigator();
  applyRtc();
  installWorkerHook();
})();
