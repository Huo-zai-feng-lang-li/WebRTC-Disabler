/**
 * boot.js — 隔离世界内容脚本（v3.11）
 *
 * 职责：先向后台确认本页是否需要伪装（split 下国内/本地直接退出，不建立任何通道），
 *      再读 chrome.storage，与 spoof.js 完成一次性令牌握手，把配置和源码交给 MAIN world。
 * 安全：令牌只存在于两个内容脚本之间。谁先到谁写 DOM 属性，后到者读取并删除；
 *      页面脚本在所有 document_start 内容脚本之后才执行，看不到令牌，伪造消息一律被拒。
 * 可靠：注入顺序不保证（boot 可能先于 spoof），因此 post 后每 100ms 重试，收到 spoof 的
 *      ack 立即停止；令牌在收到 ack 或超时后清掉，不在页面阶段残留。
 */
(function () {
  'use strict';

  var TOKEN_ATTR = 'data-wds-k';
  var MAX_TRIES = 6;

  function randomToken() {
    try {
      var buf = new Uint8Array(16);
      window.crypto.getRandomValues(buf);
      var s = '';
      for (var i = 0; i < buf.length; i++) s += (buf[i] < 16 ? '0' : '') + buf[i].toString(16);
      return s;
    } catch (e) { return String(Math.random()).slice(2) + String(Date.now()); }
  }

  /** 与 spoof.js 相同的 rendezvous：先到者写，后到者读并清除。 */
  function rendezvous() {
    try {
      var el = document.documentElement;
      var t = el.getAttribute(TOKEN_ATTR);
      if (t) { el.removeAttribute(TOKEN_ATTR); return t; }
      t = randomToken();
      el.setAttribute(TOKEN_ATTR, t);
      return t;
    } catch (e) { return null; }
  }

  /** 向后台确认是否需要在本页建立伪装通道；失败时保护优先（继续）。 */
  function needsSpoof(cb) {
    try {
      chrome.runtime.sendMessage({ type: 'wds-gate', host: location.hostname }, function (resp) {
        if (chrome.runtime.lastError) { cb(true); return; }
        cb(!resp || resp.spoof !== false);
      });
    } catch (e) { cb(true); }
  }

  function start() {
    var token = rendezvous();
    if (!token) return;

    var done = false;
    var timer = null;
    var tries = 0;
    var payload = null;

    function cleanup() {
      if (done) return;
      done = true;
      if (timer) clearInterval(timer);
      try {
        var el = document.documentElement;
        if (el && el.getAttribute(TOKEN_ATTR) === token) el.removeAttribute(TOKEN_ATTR);
      } catch (e) { /* 忽略 */ }
      try { window.removeEventListener('message', onAck, false); } catch (e) { /* 忽略 */ }
    }

    function onAck(e) {
      var d = e && e.data;
      if (d && d.__wds === 1 && d.ack === 1 && d.token === token) cleanup();
    }
    window.addEventListener('message', onAck, false);

    function send() {
      if (done || !payload) return;
      var parts = payload.parts;
      var src = parts ? (parts[0] || '') + '\n' + (parts[1] || '') : '';
      try {
        window.postMessage({ __wds: 1, token: token, cfg: payload.cfg || {}, src: src }, '*');
      } catch (e) { /* 页面销毁等异常忽略 */ }
    }

    chrome.storage.local.get(null, function (cfg) {
      Promise.all([
        fetch(chrome.runtime.getURL('domains.js')).then(function (r) { return r.text(); }),
        fetch(chrome.runtime.getURL('spoof.js')).then(function (r) { return r.text(); })
      ]).then(function (parts) {
        payload = { cfg: cfg, parts: parts };
        send();
      }).catch(function () {
        payload = { cfg: cfg, parts: null };
        send();
      }).then(function () {
        timer = setInterval(function () {
          if (done) return;
          if (++tries > MAX_TRIES) { cleanup(); return; }
          send();
        }, 100);
      });
    });
  }

  needsSpoof(function (need) { if (need) start(); });
})();
