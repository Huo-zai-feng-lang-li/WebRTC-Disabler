// ============================================================================
// spoof.js — 运行在页面主世界（MAIN world），document_start 注入
// 功能：WebRTC 伪装/禁用（全局生效）；时区/语言/Intl/地理定位伪装
//   - mode=split（默认，智能分流）：国内域名保持真实环境，国外域名按出口国伪装
//   - mode=global：所有域名统一伪装
// 配置由 boot.js 从 chrome.storage 读取后通过 postMessage 下发
// ============================================================================
(function () {
  'use strict';

  // ---- 隐身外壳：统一 Function.prototype.toString 代理 ----
  // hook 后的函数在用 Function.prototype.toString.call(fn) 严格调用时仍返回原生源码，
  // 规避 CF Turnstile 等对 [native code] 的一致性校验；不影响正常 fn.toString()。
  var nativeFTS = (function () {
    var cur = Function.prototype.toString;
    return (cur && cur.__nativeFTS) ? cur.__nativeFTS : cur;
  })();
  var nativeSourceMap = (typeof WeakMap === 'function') ? new WeakMap() : null;

  function markNative(fn, nativeRef, fallback) {
    if (!fn || !nativeSourceMap) return fn;
    var txt;
    try { txt = nativeRef ? nativeFTS.call(nativeRef) : (fallback || ''); }
    catch (e) { txt = fallback || ''; }
    if (txt) nativeSourceMap.set(fn, txt);
    return fn;
  }

  function defineHidden(obj, prop, value) {
    try {
      Object.defineProperty(obj, prop, { value: value, writable: true, configurable: true, enumerable: false });
    } catch (e) {
      try { obj[prop] = value; } catch (e2) {}
    }
  }

  if (nativeSourceMap && !Function.prototype.toString.__nativeFTS) {
    var maskedFTS = function toString() {
      try {
        if (this && nativeSourceMap.has(this)) return nativeSourceMap.get(this);
      } catch (e) {}
      return nativeFTS.call(this);
    };
    defineHidden(maskedFTS, '__nativeFTS', nativeFTS);
    nativeSourceMap.set(maskedFTS, 'function toString() { [native code] }');
    defineHidden(Function.prototype, 'toString', maskedFTS);
  }

  // 常见国内可注册域名（不含 .cn，.cn 在 pageIsChina 单独判定）；子域自动命中
  var CN_DOMAINS = [
    'baidu.com', 'baidubce.com', 'bdstatic.com', 'bdimg.com', 'baidupcs.com', 'yunjiasu-cdn.net',
    'taobao.com', 'tmall.com', 'alicdn.com', 'aliyun.com', 'aliyuncs.com', 'alibaba.com',
    '1688.com', 'alimama.com', 'alipay.com', 'antgroup.com', 'mmstat.com', 'taobaocdn.com',
    'qq.com', 'tencent.com', 'gtimg.com', 'gtimg.cn', 'qpic.cn', 'qlogo.cn', 'qcloud.com',
    'tencentcloud.cn', 'myqcloud.com', 'wechat.com', 'foxmail.com', 'tenpay.com', 'weixinbridge.com',
    'weibo.com', 'weibocdn.com', 'sina.com', 'sina.com.cn', 'sinaimg.cn',
    'jd.com', 'jdcdn.com', 'jdcloud.com', '360buyimg.com',
    '360.cn', '360.com', 'so.com', 'haosou.com',
    'bilibili.com', 'hdslb.com', 'bilivideo.com', 'biliapi.net',
    'zhihu.com', 'zhimg.com', 'douban.com',
    '163.com', 'netease.com', '126.com', '127.net', 'youdao.com', 'ydstatic.com',
    'csdn.net', 'gitee.com', 'juejin.cn', 'segmentfault.com', 'cnblogs.com',
    'meituan.com', 'dianping.com', 'ele.me', 'didi.com',
    'xiaohongshu.com', 'xhscdn.com',
    'douyin.com', 'toutiao.com', 'ixigua.com', 'bytedance.com', 'feishu.cn', 'kuaishou.com',
    'wps.cn', 'kingsoft.com', '4399.com', '17173.com',
    'iqiyi.com', 'qiyi.com', 'youku.com', 'tudou.com', 'mgtv.com', 'cctv.com', 'cctv.cn',
    'xinhuanet.com', 'people.cn', 'china.com', 'china.com.cn',
    'ctrip.com', 'qunar.com', 'elong.com', 'mafengwo.cn', 'ly.com',
    'zhipin.com', 'lagou.com', '51job.com', 'zhaopin.com',
    'mi.com', 'xiaomi.com', 'miui.com', 'huawei.com', 'hicloud.com', 'vmall.com',
    'oppo.com', 'vivo.com', 'meizu.com', 'oneplus.com', 'realme.com',
    'amap.com', 'autonavi.com',
    'eastmoney.com', '10jqka.com.cn', 'xueqiu.com',
    'smzdm.com', 'jianshu.com', 'coolapk.com', '2345.com', 'hao123.com', 'uc.cn', 'umeng.com',
    'unionpay.com', 'cmbchina.com', 'ccb.com', 'abchina.com', 'bankcomm.com', 'psbc.com',
    '10010.com', '10086.cn', '189.cn',
    'douyu.com', 'huya.com', 'yy.com', 'vip.com', 'suning.com', 'dangdang.com',
    'deepseek.com', 'doubao.com', 'kimi.com', 'baichuan-ai.com', 'stepfun.com',
    'lingyiwanwu.com', 'minimaxi.com', 'bochaai.com', 'volcengine.com', 'volces.com',
    'jianying.com', 'fanqienovel.com', 'dingtalk.com', 'qiniu.com', 'qiniudn.com',
    'upaiyun.com', 'upyun.com', 'sogou.com', 'kugou.com', 'ximalaya.com', 'hupu.com',
    'ithome.com', '36kr.com', 'sspai.com', 'ifanr.com', 'cnbeta.com', 'qidian.com',
    'jjwxc.net', 'dongchedi.com', '58.com', 'ganji.com', 'anjuke.com', 'lianjia.com',
    'ke.com', 'yiche.com', 'guahao.com', 'chunyuyisheng.com', 'caiyunapp.com',
    'xuetangx.com', 'zhihuishu.com', 'chaoxing.com', 'icourse163.org', 'fliggy.com',
    'pinduoduo.com', 'yangkeduo.com', 'dewu.com', 'meitu.com', 'ifeng.com',
    'caixin.com', 'yicai.com', 'jiemian.com', 'infzm.com', 'lofter.com',
    '1905.com', 'xiachufang.com'
  ];

  // 判断当前页面（含 iframe 自身域名）是否为国内站点
  function pageIsChina() {
    try {
      var host = (location.hostname || '').toLowerCase().replace(/\.$/, '');
      if (!host) return false;
      if (host === 'cn' || host.endsWith('.cn')) return true;
      if (host.endsWith('.中国')) return true;
      for (var i = 0; i < CN_DOMAINS.length; i++) {
        var d = CN_DOMAINS[i];
        if (host === d || host.endsWith('.' + d)) return true;
      }
    } catch (e) {}
    return false;
  }

  // 判断当前页面是否为本地内网（私有 IP / localhost / .local / 裸主机名）
  function isLocalIntranet() {
    try {
      var host = (location.hostname || '').toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
      if (!host) return true;
      if (host === 'localhost' || host.endsWith('.local')) return true;
      if (host.indexOf('.') === -1 && host.indexOf(':') === -1) return true; // 裸主机名如 nas / router
      var m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
      if (m) {
        var a = +m[1], b = +m[2];
        if (a === 10 || a === 127 || a === 0) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        if (a === 169 && b === 254) return true;
        return false;
      }
      if (host.indexOf(':') !== -1) {
        if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
        if (/^fe[89ab]/.test(host)) return true;   // 链路本地 fe80::/10
        if (/^f[cd]/.test(host)) return true;       // 唯一本地 fc00::/7
      }
    } catch (e) {}
    return false;
  }

  var DEFAULTS = {
    mode: 'split',                 // split=智能分流(推荐) | global=全局统一伪装
    webrtcMode: 'spoof',           // spoof=伪装(推荐) | disable=彻底禁用 | off=关闭
    tz: 'America/Los_Angeles',
    lang: 'en-US',
    langList: ['en-US', 'en'],
    geoLat: 34.0522,
    geoLng: -118.2437
  };

  function nativeDesc(obj, prop) {
    try { return Object.getOwnPropertyDescriptor(obj, prop); } catch (e) { return null; }
  }

  // ---- 只捕获一次原生对象，避免重复包裹 ----
  var natives = window.__spoofNatives || (function () {
    var NP = Navigator.prototype;
    return {
      RTC: window.RTCPeerConnection || window.webkitRTCPeerConnection || null,
      DTF: Intl.DateTimeFormat,
      NumberFormat: Intl.NumberFormat,
      Collator: Intl.Collator,
      PluralRules: Intl.PluralRules,
      RelativeTimeFormat: Intl.RelativeTimeFormat,
      ListFormat: Intl.ListFormat,
      DisplayNames: Intl.DisplayNames,
      Segmenter: Intl.Segmenter,
      dateToString: Date.prototype.toString,
      getTZO: Date.prototype.getTimezoneOffset,
      geo: navigator.geolocation,
      permissionsQuery: navigator.permissions && navigator.permissions.query,
      langDesc: nativeDesc(NP, 'language'),
      langsDesc: nativeDesc(NP, 'languages'),
      geoDesc: nativeDesc(NP, 'geolocation')
    };
  })();
  if (!window.__spoofNatives) defineHidden(window, '__spoofNatives', natives);

  var current = {};

  function randStr(n) {
    var s = '';
    var chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (var i = 0; i < n; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
    return s;
  }

  // ================= WebRTC 伪装实现 =================
  function buildFakeRTC() {
    function FakeRTCPeerConnection(config) {
      this.__config = config || {};
      this.__gathering = false;
      this.signalingState = 'stable';
      this.iceGatheringState = 'new';
      this.iceConnectionState = 'new';
      this.connectionState = 'new';
      this.localDescription = null;
      this.remoteDescription = null;
      this.pendingLocalDescription = null;
      this.pendingRemoteDescription = null;
      this.currentLocalDescription = null;
      this.currentRemoteDescription = null;
      this.onicecandidate = null;
      this.onicegatheringstatechange = null;
      this.oniceconnectionstatechange = null;
      this.onconnectionstatechange = null;
      this.onsignalingstatechange = null;
      this.onnegotiationneeded = null;
      this.ondatachannel = null;
      this.ontrack = null;
      this.__listeners = {};
      // 真实 RTCPeerConnection 实例无自有可枚举属性，这里对齐，避免 Object.keys/JSON 暴露
      var self = this;
      Object.getOwnPropertyNames(this).forEach(function (k) {
        try {
          var d = Object.getOwnPropertyDescriptor(self, k);
          d.enumerable = false;
          Object.defineProperty(self, k, d);
        } catch (e) {}
      });
    }

    function fakeFingerprint() {
      var b = '';
      for (var i = 0; i < 32; i++) b += '0123456789abcdef'.charAt(Math.floor(Math.random() * 16));
      return b.toUpperCase().replace(/(.{2})(?=.)/g, '$1:').slice(0, 95);
    }

    function fakeSdp(type) {
      var ufrag = randStr(8);
      var pwd = randStr(24);
      var lines = [
        'v=0',
        'o=- 4611731400430051336 2 IN IP4 0.0.0.0',
        's=-', 't=0 0',
        'a=group:BUNDLE 0',
        'a=msid-semantic: WMS',
        'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
        'c=IN IP4 0.0.0.0',
        'a=ice-ufrag:' + ufrag,
        'a=ice-pwd:' + pwd,
        'a=ice-options:trickle',
        'a=fingerprint:sha-256 ' + fakeFingerprint(),
        'a=setup:' + (type === 'offer' ? 'actpass' : 'active'),
        'a=mid:0',
        'a=sctp-port:5000',
        'a=max-message-size:262144'
      ];
      return { type: type, sdp: lines.join('\r\n') + '\r\n' };
    }

    function emit(pc, type, evt) {
      if (typeof pc['on' + type] === 'function') {
        try { pc['on' + type](evt); } catch (e) {}
      }
      (pc.__listeners[type] || []).forEach(function (fn) {
        try { fn(evt); } catch (e) {}
      });
    }

    function setState(pc, prop, val, eventName) {
      pc[prop] = val;
      emit(pc, eventName, { type: eventName, target: pc });
    }

    function startGathering(pc) {
      if (!isPc(pc)) return;
      if (pc.__gathering || pc.signalingState === 'closed') return;
      pc.__gathering = true;
      setState(pc, 'iceGatheringState', 'gathering', 'icegatheringstatechange');

      // 只发 mDNS .local 主机候选（Chrome 隐私模式下的正常表现），绝不发 srflx/公网IP
      var host = randStr(8) + '-' + randStr(4) + '-' + randString2() + '.local';
      var candBase = 'candidate:' + Math.floor(Math.random() * 4294967295) +
        ' 1 udp 2113937151 ' + host + ' ' + (50000 + Math.floor(Math.random() * 10000)) +
        ' typ host generation 0 ufrag ' + randStr(4) + ' network-id 1';
      var IceCandidate = natives.RTC && window.RTCIceCandidate;

      setTimeout(function () {
        var candidate = IceCandidate
          ? new IceCandidate({ candidate: candBase, sdpMid: '0', sdpMLineIndex: 0 })
          : { candidate: candBase, sdpMid: '0', sdpMLineIndex: 0 };
        emit(pc, 'icecandidate', { type: 'icecandidate', candidate: candidate, target: pc });
      }, 60);

      setTimeout(function () {
        emit(pc, 'icecandidate', { type: 'icecandidate', candidate: null, target: pc });
        setState(pc, 'iceGatheringState', 'complete', 'icegatheringstatechange');
        setState(pc, 'iceConnectionState', 'connected', 'iceconnectionstatechange');
        setState(pc, 'connectionState', 'connected', 'connectionstatechange');
      }, 180);
    }

    function randString2() {
      return randStr(4) + '-' + randStr(4) + '-' + randStr(12);
    }

    // 校验 this 是否为有效 fake 实例；反爬探测可能解绑方法并以 null/非实例调用，
    // 此时直接安全返回，避免异步流程读取实例属性抛 TypeError 被挑战脚本当作环境错误上报。
    function isPc(pc) {
      return !!pc && typeof pc === 'object' && '__gathering' in pc;
    }

    var P = FakeRTCPeerConnection.prototype;
    P.addEventListener = function (type, fn) {
      if (!isPc(this)) return;
      (this.__listeners[type] = this.__listeners[type] || []).push(fn);
    };
    P.removeEventListener = function (type, fn) {
      if (!isPc(this)) return;
      var arr = this.__listeners[type] || [];
      var i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    };
    P.dispatchEvent = function () { return true; };
    P.createDataChannel = function (label) {
      return {
        label: label || '', readyState: 'connecting',
        send: function () {}, close: function () {},
        addEventListener: function () {}, removeEventListener: function () {}
      };
    };
    P.createOffer = function () {
      var pc = this;
      if (!isPc(pc)) return Promise.resolve(fakeSdp('offer'));
      return new Promise(function (resolve) {
        setTimeout(function () {
          var sdp = fakeSdp('offer');
          resolve(sdp);
          startGathering(pc);
        }, 10);
      });
    };
    P.createAnswer = function () {
      return Promise.resolve(fakeSdp('answer'));
    };
    P.setLocalDescription = function (desc) {
      var pc = this;
      if (!isPc(pc)) return Promise.resolve();
      return new Promise(function (resolve) {
        pc.localDescription = desc || pc.localDescription;
        if (desc && desc.type === 'offer') pc.signalingState = 'have-local-offer';
        emit(pc, 'signalingstatechange', { type: 'signalingstatechange', target: pc });
        startGathering(pc);
        resolve();
      });
    };
    P.setRemoteDescription = function (desc) {
      if (!isPc(this)) return Promise.resolve();
      this.remoteDescription = desc;
      return Promise.resolve();
    };
    P.addIceCandidate = function () { return Promise.resolve(); };
    P.close = function () {
      if (!isPc(this)) return;
      this.signalingState = 'closed';
      this.iceConnectionState = 'closed';
      this.connectionState = 'closed';
    };
    P.getStats = function () { return Promise.resolve(new Map()); };
    P.addTrack = function () { return { track: null, replaceTrack: function () { return Promise.resolve(); } }; };
    P.removeTrack = function () {};
    P.getSenders = function () { return []; };
    P.getReceivers = function () { return []; };
    P.getTransceivers = function () { return []; };
    P.setConfiguration = function () {};
    P.getConfiguration = function () { return isPc(this) ? this.__config : {}; };

    FakeRTCPeerConnection.generateCertificate = function () {
      return Promise.resolve({});
    };

    // ---- 隐身加固：注册进 nativeSourceMap，同时 fn.toString() 与 Function.prototype.toString.call(fn) 都返回原生源码 ----
    function maskToString(fn, nativeRef, fallback) {
      if (!fn) return fn;
      markNative(fn, nativeRef, fallback);
      try {
        var own = function toString() {
          try {
            return (nativeSourceMap && nativeSourceMap.get(fn)) || nativeFTS.call(fn);
          } catch (e) { return fallback || ''; }
        };
        markNative(own, null, 'function toString() { [native code] }');
        Object.defineProperty(fn, 'toString', { value: own, configurable: true, writable: true });
      } catch (e) {}
      return fn;
    }
    var NativeProto = natives.RTC && natives.RTC.prototype;
    [
      'addEventListener', 'removeEventListener', 'dispatchEvent', 'createDataChannel',
      'createOffer', 'createAnswer', 'setLocalDescription', 'setRemoteDescription',
      'addIceCandidate', 'close', 'getStats', 'addTrack', 'removeTrack',
      'getSenders', 'getReceivers', 'getTransceivers', 'setConfiguration', 'getConfiguration'
    ].forEach(function (m) {
      if (P[m]) maskToString(P[m], NativeProto && NativeProto[m], 'function ' + m + '() { [native code] }');
    });
    maskToString(FakeRTCPeerConnection, natives.RTC, 'function RTCPeerConnection() { [native code] }');
    maskToString(FakeRTCPeerConnection.generateCertificate,
      natives.RTC && natives.RTC.generateCertificate, 'function generateCertificate() { [native code] }');
    try {
      Object.defineProperty(FakeRTCPeerConnection, 'name', { value: 'RTCPeerConnection', configurable: true });
    } catch (e) {}

    return FakeRTCPeerConnection;
  }

  // ================= WebRTC（所有模式、所有域名均生效） =================
  function applyWebRTC(mode) {
    var Fake = window.__fakeRTC || buildFakeRTC();
    if (!window.__fakeRTC) defineHidden(window, '__fakeRTC', Fake);
    var rtcValue;
    if (mode === 'disable') rtcValue = undefined;
    else if (mode === 'off') rtcValue = natives.RTC;
    else rtcValue = Fake;
    try {
      Object.defineProperty(window, 'RTCPeerConnection', { value: rtcValue, writable: true, configurable: true });
      Object.defineProperty(window, 'webkitRTCPeerConnection', { value: rtcValue, writable: true, configurable: true });
      if (mode === 'disable') {
        try { delete window.mozRTCPeerConnection; } catch (e) {}
        window.mozRTCPeerConnection = undefined;
      } else if (natives.RTC) {
        window.mozRTCPeerConnection = rtcValue;
      }
    } catch (e) {}
  }

  // ================= 时区/语言/定位 伪装（仅国外域名） =================
  function spoofLocale() {
    // ---- navigator.language / languages ----
    try {
      Object.defineProperty(Navigator.prototype, 'language', {
        get: markNative(function () { return current.lang; }, natives.langDesc && natives.langDesc.get,
          'function get language() { [native code] }'),
        configurable: true
      });
      Object.defineProperty(Navigator.prototype, 'languages', {
        get: markNative(function () { return current.langList.slice(); }, natives.langsDesc && natives.langsDesc.get,
          'function get languages() { [native code] }'),
        configurable: true
      });
    } catch (e) {}

    // ---- 时区 ----
    function targetOffset(date) {
      try {
        var parts = new natives.DTF('en-US', {
          timeZone: current.tz,
          timeZoneName: 'longOffset'
        }).formatToParts(date);
        for (var i = 0; i < parts.length; i++) {
          if (parts[i].type === 'timeZoneName') {
            var m = parts[i].value.match(/GMT([+-])(\d{2}):?(\d{2})?/);
            if (m) {
              var sign = m[1] === '-' ? 1 : -1;
              var h = parseInt(m[2], 10) || 0;
              var min = parseInt(m[3], 10) || 0;
              return sign * (h * 60 + min);
            }
          }
        }
      } catch (e) {}
      return 420;
    }

    Date.prototype.getTimezoneOffset = markNative(
      function getTimezoneOffset() { return targetOffset(this); },
      natives.getTZO, 'function getTimezoneOffset() { [native code] }'
    );

    function wrapLocaleCtor(Ctor, withTimeZone) {
      function Wrapped(locales, options) {
        if (locales === undefined || locales === null) locales = current.lang;
        if (withTimeZone) {
          if (options === undefined || options === null) options = {};
          if (options.timeZone === undefined) options.timeZone = current.tz;
        }
        return new Ctor(locales, options);
      }
      Wrapped.prototype = Ctor.prototype;
      if (Ctor.supportedLocalesOf) Wrapped.supportedLocalesOf = Ctor.supportedLocalesOf;
      // 还原构造器 name 与 native 源码，避免 "Wrapped" 与源码泄露指纹
      try {
        Object.defineProperty(Wrapped, 'name', { value: Ctor.name, configurable: true });
      } catch (e) {}
      markNative(Wrapped, Ctor, 'function ' + Ctor.name + '() { [native code] }');
      markNative(Wrapped.supportedLocalesOf, Ctor.supportedLocalesOf,
        'function supportedLocalesOf() { [native code] }');
      return Wrapped;
    }

    Intl.DateTimeFormat = wrapLocaleCtor(natives.DTF, true);
    if (natives.NumberFormat) Intl.NumberFormat = wrapLocaleCtor(natives.NumberFormat, false);
    if (natives.Collator) Intl.Collator = wrapLocaleCtor(natives.Collator, false);
    if (natives.PluralRules) Intl.PluralRules = wrapLocaleCtor(natives.PluralRules, false);
    if (natives.RelativeTimeFormat) Intl.RelativeTimeFormat = wrapLocaleCtor(natives.RelativeTimeFormat, false);
    if (natives.ListFormat) Intl.ListFormat = wrapLocaleCtor(natives.ListFormat, false);
    if (natives.DisplayNames) Intl.DisplayNames = wrapLocaleCtor(natives.DisplayNames, false);
    if (natives.Segmenter) Intl.Segmenter = wrapLocaleCtor(natives.Segmenter, false);

    Date.prototype.toString = markNative(function () {
      try {
        var p = new natives.DTF('en-US', {
          timeZone: current.tz,
          weekday: 'short', month: 'short', day: '2-digit',
          year: 'numeric', hour: '2-digit', minute: '2-digit',
          second: '2-digit', hour12: false, timeZoneName: 'short'
        }).formatToParts(this);
        var map = {};
        p.forEach(function (x) { map[x.type] = x.value; });
        var off = targetOffset(this);
        var tzAbbr = map.timeZoneName || (off === 480 ? 'PST' : 'PDT');
        var sign = off >= 0 ? '-' : '+';
        var abs = Math.abs(off);
        var hh = String(Math.floor(abs / 60)).padStart(2, '0');
        var mm = String(abs % 60).padStart(2, '0');
        return map.weekday + ' ' + map.month + ' ' + map.day + ' ' + map.year +
          ' ' + map.hour + ':' + map.minute + ':' + map.second +
          ' GMT' + sign + hh + mm + ' (' + tzAbbr + ')';
      } catch (e) {
        return natives.dateToString.call(this);
      }
    }, natives.dateToString, 'function toString() { [native code] }');

    // ---- 地理定位 ----
    try {
      function fakePosition() {
        return {
          coords: {
            latitude: current.geoLat,
            longitude: current.geoLng,
            accuracy: 20000,
            altitude: null, altitudeAccuracy: null,
            heading: null, speed: null
          },
          timestamp: Date.now()
        };
      }
      var NativeGeoProto = (window.Geolocation && window.Geolocation.prototype) || null;
      var geo = {
        getCurrentPosition: markNative(function (success) {
          if (typeof success === 'function') success(fakePosition());
        }, NativeGeoProto && NativeGeoProto.getCurrentPosition,
          'function getCurrentPosition() { [native code] }'),
        watchPosition: markNative(function (success) {
          if (typeof success === 'function') success(fakePosition());
          return 1;
        }, NativeGeoProto && NativeGeoProto.watchPosition,
          'function watchPosition() { [native code] }'),
        clearWatch: markNative(function () {},
          NativeGeoProto && NativeGeoProto.clearWatch,
          'function clearWatch() { [native code] }')
      };
      Object.defineProperty(Navigator.prototype, 'geolocation', {
        get: markNative(function () { return geo; }, natives.geoDesc && natives.geoDesc.get,
          'function get geolocation() { [native code] }'),
        configurable: true
      });

      if (natives.permissionsQuery) {
        navigator.permissions.query = markNative(function (descriptor) {
          if (descriptor && descriptor.name === 'geolocation') {
            return Promise.resolve({ state: 'granted', onchange: null });
          }
          return natives.permissionsQuery.call(navigator.permissions, descriptor);
        }, natives.permissionsQuery, 'function query() { [native code] }');
      }
    } catch (e) {}
  }

  // ================= 国内域名：恢复真实时区/语言/定位 =================
  function restoreNativeProp(prop, desc) {
    try {
      if (desc) Object.defineProperty(Navigator.prototype, prop, desc);
      else delete Navigator.prototype[prop];
    } catch (e) {}
  }
  function restoreLocale() {
    try {
      Intl.DateTimeFormat = natives.DTF;
      if (natives.NumberFormat) Intl.NumberFormat = natives.NumberFormat;
      if (natives.Collator) Intl.Collator = natives.Collator;
      if (natives.PluralRules) Intl.PluralRules = natives.PluralRules;
      if (natives.RelativeTimeFormat) Intl.RelativeTimeFormat = natives.RelativeTimeFormat;
      if (natives.ListFormat) Intl.ListFormat = natives.ListFormat;
      if (natives.DisplayNames) Intl.DisplayNames = natives.DisplayNames;
      if (natives.Segmenter) Intl.Segmenter = natives.Segmenter;
      Date.prototype.getTimezoneOffset = natives.getTZO;
      Date.prototype.toString = natives.dateToString;
      restoreNativeProp('language', natives.langDesc);
      restoreNativeProp('languages', natives.langsDesc);
      restoreNativeProp('geolocation', natives.geoDesc);
      if (natives.permissionsQuery && navigator.permissions) {
        navigator.permissions.query = natives.permissionsQuery;
      }
    } catch (e) {}
  }

  // ================= 应用配置（可重复调用） =================
  function apply(cfg) {
    cfg = cfg || {};
    current = {
      mode: cfg.mode || DEFAULTS.mode,
      webrtcMode: cfg.webrtcMode || DEFAULTS.webrtcMode,
      tz: cfg.tz || DEFAULTS.tz,
      lang: cfg.lang || DEFAULTS.lang,
      langList: (cfg.langList && cfg.langList.length) ? cfg.langList : DEFAULTS.langList,
      geoLat: (cfg.geoLat !== undefined && cfg.geoLat !== null && cfg.geoLat !== '') ? Number(cfg.geoLat) : DEFAULTS.geoLat,
      geoLng: (cfg.geoLng !== undefined && cfg.geoLng !== null && cfg.geoLng !== '') ? Number(cfg.geoLng) : DEFAULTS.geoLng
    };

    // WebRTC：智能分流下国内/本地内网走真实 RTC（这些站本就直连，WebRTC 无新增泄露，
    // 且能保证视频/语音通话正常）；国外站按所选模式防护。全局模式则所有站点按所选模式。
    var effectiveRtc = current.webrtcMode;
    if (current.mode === 'split' && (pageIsChina() || isLocalIntranet())) effectiveRtc = 'off';
    applyWebRTC(effectiveRtc);

    // 智能分流且当前为国内/本地内网 -> 保持真实；其余情况伪装
    if (cfg.localeMode === 'native') restoreLocale();
    else spoofLocale();
  }

  // 首次同步生效，抢在页面脚本之前：默认智能分流，国内页直接保持真实、国外页用默认(美国)
  var firstLocaleMode = (DEFAULTS.mode === 'global') ? 'spoof' : ((pageIsChina() || isLocalIntranet()) ? 'native' : 'spoof');
  apply(Object.assign({}, DEFAULTS, { localeMode: firstLocaleMode }));

  if (window.__applySpoofConfig !== apply) defineHidden(window, '__applySpoofConfig', apply);

  // 通过 postMessage 接收隔离世界 boot.js 下发的配置（不受页面 CSP 限制）
  window.addEventListener('message', function (ev) {
    if (ev.source !== window || !ev.data || ev.data.__spoofConfig !== true) return;
    apply(ev.data.cfg || {});
  });
})();
