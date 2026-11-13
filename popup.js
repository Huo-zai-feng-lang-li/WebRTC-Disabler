// ============================================================================
// popup.js — 设置面板逻辑（v3.11）
//   修复点：预设外时区不再丢失；保存前校验时区/经纬度；未内置语言的国家不静默保存。
// ============================================================================
(function () {
  'use strict';

  // 常用时区预设
  var TIMEZONES = [
    ['America/Los_Angeles', '洛杉矶（美国西部 UTC-8/-7）'],
    ['America/Denver', '丹佛（美国山地）'],
    ['America/Chicago', '芝加哥（美国中部）'],
    ['America/New_York', '纽约（美国东部 UTC-5/-4）'],
    ['America/Toronto', '多伦多（加拿大东部）'],
    ['America/Sao_Paulo', '圣保罗（巴西）'],
    ['Europe/London', '伦敦（英国 UTC+0/+1）'],
    ['Europe/Paris', '巴黎（法国）'],
    ['Europe/Berlin', '柏林（德国）'],
    ['Europe/Moscow', '莫斯科（俄罗斯）'],
    ['Asia/Dubai', '迪拜（阿联酋）'],
    ['Asia/Kolkata', '孟买/新德里（印度）'],
    ['Asia/Bangkok', '曼谷（泰国）'],
    ['Asia/Singapore', '新加坡（UTC+8）'],
    ['Asia/Hong_Kong', '香港（UTC+8）'],
    ['Asia/Taipei', '台北（UTC+8）'],
    ['Asia/Shanghai', '上海/北京（UTC+8）'],
    ['Asia/Tokyo', '东京（日本 UTC+9）'],
    ['Asia/Seoul', '首尔（韩国 UTC+9）'],
    ['Australia/Sydney', '悉尼（澳大利亚）'],
    ['Pacific/Auckland', '奥克兰（新西兰）']
  ];

  // 语言预设：[值, 显示名, Accept-Language头, 语言列表]
  var LANGS = [
    ['en-US', 'English (United States)', 'en-US,en;q=0.9', ['en-US', 'en']],
    ['en-GB', 'English (United Kingdom)', 'en-GB,en;q=0.9', ['en-GB', 'en']],
    ['en-CA', 'English (Canada)', 'en-CA,en;q=0.9', ['en-CA', 'en']],
    ['en-AU', 'English (Australia)', 'en-AU,en;q=0.9', ['en-AU', 'en']],
    ['en-SG', 'English (Singapore)', 'en-SG,en;q=0.9', ['en-SG', 'en']],
    ['ja-JP', '日本語', 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7', ['ja-JP', 'ja']],
    ['ko-KR', '한국어', 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7', ['ko-KR', 'ko']],
    ['zh-CN', '简体中文', 'zh-CN,zh;q=0.9,en;q=0.8', ['zh-CN', 'zh']],
    ['zh-TW', '繁體中文（台灣）', 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7', ['zh-TW', 'zh']],
    ['zh-HK', '繁體中文（香港）', 'zh-HK,zh;q=0.9,en-US;q=0.8,en;q=0.7', ['zh-HK', 'zh']],
    ['de-DE', 'Deutsch', 'de-DE,de;q=0.9,en;q=0.8', ['de-DE', 'de']],
    ['fr-FR', 'Français', 'fr-FR,fr;q=0.9,en;q=0.8', ['fr-FR', 'fr']],
    ['es-ES', 'Español (España)', 'es-ES,es;q=0.9,en;q=0.8', ['es-ES', 'es']],
    ['es-MX', 'Español (México)', 'es-MX,es;q=0.9,en;q=0.8', ['es-MX', 'es']],
    ['ru-RU', 'Русский', 'ru-RU,ru;q=0.9,en;q=0.8', ['ru-RU', 'ru']],
    ['pt-BR', 'Português (Brasil)', 'pt-BR,pt;q=0.9,en;q=0.8', ['pt-BR', 'pt']],
    ['it-IT', 'Italiano', 'it-IT,it;q=0.9,en;q=0.8', ['it-IT', 'it']],
    ['nl-NL', 'Nederlands', 'nl-NL,nl;q=0.9,en;q=0.8', ['nl-NL', 'nl']],
    ['th-TH', 'ไทย', 'th-TH,th;q=0.9,en;q=0.8', ['th-TH', 'th']],
    ['vi-VN', 'Tiếng Việt', 'vi-VN,vi;q=0.9,en;q=0.8', ['vi-VN', 'vi']],
    ['id-ID', 'Bahasa Indonesia', 'id-ID,id;q=0.9,en;q=0.8', ['id-ID', 'id']],
    ['ms-MY', 'Bahasa Melayu', 'ms-MY,ms;q=0.9,en;q=0.8', ['ms-MY', 'ms']],
    ['tr-TR', 'Türkçe', 'tr-TR,tr;q=0.9,en;q=0.8', ['tr-TR', 'tr']],
    ['ar-SA', 'العربية', 'ar-SA,ar;q=0.9,en;q=0.8', ['ar-SA', 'ar']]
  ];

  // 国家代码 -> 语言值（IP 自动匹配用）
  var COUNTRY_LANG = {
    US: 'en-US', GB: 'en-GB', CA: 'en-CA', AU: 'en-AU', SG: 'en-SG',
    JP: 'ja-JP', KR: 'ko-KR', CN: 'zh-CN', TW: 'zh-TW', HK: 'zh-HK',
    DE: 'de-DE', FR: 'fr-FR', ES: 'es-ES', MX: 'es-MX', RU: 'ru-RU',
    BR: 'pt-BR', PT: 'pt-BR', IT: 'it-IT', NL: 'nl-NL', TH: 'th-TH',
    VN: 'vi-VN', ID: 'id-ID', MY: 'ms-MY', TR: 'tr-TR', SA: 'ar-SA',
    AE: 'ar-SA', PH: 'en-US', IN: 'en-US', IE: 'en-GB', NZ: 'en-AU',
    PL: 'en-US', CZ: 'en-US', SE: 'en-US', NO: 'en-US', DK: 'en-US',
    FI: 'en-US', IL: 'en-US', GR: 'en-US', HU: 'en-US', RO: 'en-US',
    UA: 'ru-RU', ZA: 'en-GB', EG: 'ar-SA', NG: 'en-GB', KE: 'en-GB',
    AR: 'es-ES', CL: 'es-ES', CO: 'es-ES', PE: 'es-ES'
  };

  var DEFAULTS = {
    mode: 'split',
    webrtcMode: 'spoof',
    tz: 'America/Los_Angeles',
    lang: 'en-US',
    langList: ['en-US', 'en'],
    geoLat: 34.0522,
    geoLng: -118.2437
  };

  var $ = function (id) { return document.getElementById(id); };

  function fillSelects() {
    var tzSel = $('tz');
    TIMEZONES.forEach(function (t) { tzSel.add(new Option(t[1], t[0])); });
    var langSel = $('lang');
    LANGS.forEach(function (l) { langSel.add(new Option(l[1], l[0])); });
  }

  /** 存储里可能出现预设外的时区/语言：先补 option 再赋值，避免 select.value 变成空串。 */
  function ensureOption(sel, value) {
    if (!value) return;
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === value) return;
    }
    sel.add(new Option(value, value));
  }

  function langMeta(langVal) {
    for (var i = 0; i < LANGS.length; i++) {
      if (LANGS[i][0] === langVal) return { header: LANGS[i][2], list: LANGS[i][3] };
    }
    var base = langVal.split('-')[0];
    return { header: langVal + ',' + base + ';q=0.9,en;q=0.8', list: [langVal, base] };
  }

  function load() {
    chrome.storage.local.get(null, function (cfg) {
      cfg = cfg || {};
      $('webrtcMode').value = cfg.webrtcMode || DEFAULTS.webrtcMode;
      $('mode').value = cfg.mode || DEFAULTS.mode;
      var tz = cfg.tz || DEFAULTS.tz;
      ensureOption($('tz'), tz);
      $('tz').value = tz;
      var lang = cfg.lang || DEFAULTS.lang;
      ensureOption($('lang'), lang);
      $('lang').value = lang;
      $('geoLat').value = cfg.geoLat !== undefined ? cfg.geoLat : DEFAULTS.geoLat;
      $('geoLng').value = cfg.geoLng !== undefined ? cfg.geoLng : DEFAULTS.geoLng;
    });
  }

  function setStatus(msg, isErr) {
    var el = $('status');
    el.textContent = msg;
    el.className = 'status' + (isErr ? ' err' : '');
  }

  /** 保存后立即刷新当前标签（仅 http/https），500ms 后关闭弹窗。 */
  function reloadActiveTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (tab && tab.url && /^https?:/.test(tab.url)) {
        chrome.tabs.reload(tab.id);
      }
    });
  }

  function persist(cfg, msg) {
    chrome.storage.local.set(cfg, function () {
      setStatus(msg || '已保存，页面已刷新');
      reloadActiveTab();
      setTimeout(function () {
        try { window.close(); } catch (e) {}
      }, 500);
    });
  }

  /** 校验并保存；返回是否成功落盘。空时区/非法经纬度一律拒绝，避免静默写入坏配置。 */
  function save(msg) {
    var langVal = $('lang').value;
    if (!langVal) {
      setStatus('请选择语言', true);
      return false;
    }
    var tz = $('tz').value;
    if (!tz) {
      setStatus('请选择时区', true);
      return false;
    }
    var lat = parseFloat($('geoLat').value);
    var lng = parseFloat($('geoLng').value);
    if (!isFinite(lat) || lat < -90 || lat > 90) {
      setStatus('纬度需在 -90 ~ 90 之间', true);
      return false;
    }
    if (!isFinite(lng) || lng < -180 || lng > 180) {
      setStatus('经度需在 -180 ~ 180 之间', true);
      return false;
    }
    var meta = langMeta(langVal);
    persist({
      mode: $('mode').value,
      webrtcMode: $('webrtcMode').value,
      tz: tz,
      lang: langVal,
      langList: meta.list,
      langHeader: meta.header,
      geoLat: lat,
      geoLng: lng
    }, msg || '已保存，页面已刷新');
    return true;
  }

  /** 按出口 IP 自动匹配（走当前代理）；语言未内置时只填字段、不落盘。 */
  async function autoMatch() {
    var btn = $('autoBtn');
    btn.disabled = true;
    setStatus('正在识别出口 IP…');
    try {
      var data = null, err1 = null;
      try {
        var r1 = await fetch('https://ipwho.is/', { cache: 'no-store' });
        data = await r1.json();
        if (!data || data.success === false) throw new Error('ipwho failed');
        var tz1 = (data.timezone && data.timezone.id) ? data.timezone.id : null;
        applyGeo(data.ip, data.country_code, tz1, data.latitude, data.longitude, data.city);
        return;
      } catch (e) { err1 = e; }
      // 备用：ip-api（http）
      try {
        var r2 = await fetch('http://ip-api.com/json/?fields=status,countryCode,timezone,lat,lon,query,city', { cache: 'no-store' });
        var d2 = await r2.json();
        if (!d2 || d2.status !== 'success') throw new Error('ip-api failed');
        applyGeo(d2.query, d2.countryCode, d2.timezone, d2.lat, d2.lon, d2.city);
        return;
      } catch (e) {
        throw err1 || e;
      }
    } catch (e) {
      setStatus('识别失败，请检查代理后重试', true);
    } finally {
      btn.disabled = false;
    }
  }

  function applyGeo(ip, cc, tz, lat, lng, city) {
    $('ipVal').textContent = ip + (city ? ' · ' + city : '') + (cc ? ' · ' + cc : '');
    if (tz) {
      ensureOption($('tz'), tz);
      $('tz').value = tz;
    }
    if (lat !== undefined && lat !== null) $('geoLat').value = lat;
    if (lng !== undefined && lng !== null) $('geoLng').value = lng;

    var lang = cc ? COUNTRY_LANG[cc] : null;
    if (!lang) {
      // 语言不确定时不能静默保存：否则会出现"荷兰时区 + 美国语言"这类自相矛盾配置
      setStatus('已匹配时区/坐标，但该国家语言未内置，请手动选择语言后保存', true);
      return false;
    }
    ensureOption($('lang'), lang);
    $('lang').value = lang;
    return save('已按出口 IP ' + ip + ' 匹配，页面已刷新');
  }

  // 事件绑定
  document.addEventListener('DOMContentLoaded', function () {
    fillSelects();
    load();
    $('saveBtn').addEventListener('click', function () { save(); });
    $('autoBtn').addEventListener('click', autoMatch);
    $('testBtn').addEventListener('click', function () {
      chrome.tabs.create({ url: 'https://ipip.la/disguise.html' });
    });
  });
})();
