// ============================================================================
// background.js — Service Worker
//   按模式同步 Accept-Language 请求头：
//   - split 智能分流：国内域名发中文，其余域名发出口国语言
//   - global 全局伪装：所有域名发出口国语言
// ============================================================================
(function () {
  'use strict';

  var RESOURCE_TYPES = [
    'main_frame', 'sub_frame', 'stylesheet', 'script', 'image',
    'font', 'object', 'xmlhttprequest', 'ping', 'csp_report',
    'media', 'websocket', 'other'
  ];

  // 国内域名（与 spoof.js/boot.js 一致），DNR 自动匹配其全部子域
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

  var DOMESTIC_HEADER = 'zh-CN,zh;q=0.9';

  // 本地内网 urlFilter（DNR 无法按 IP 段匹配，逐段列出；裸主机名由 JS 层处理）
  var LOCAL_URL_FILTERS = [
    '||10.', '||127.', '||0.', '||169.254.', '||192.168.', '||localhost', '*.local'
  ];
  for (var b = 16; b <= 31; b++) LOCAL_URL_FILTERS.push('||172.' + b + '.');
  var LOCAL_ID_START = 10;

  var LANG_HEADER_MAP = {
    'en-US': 'en-US,en;q=0.9',
    'en-GB': 'en-GB,en;q=0.9',
    'en-CA': 'en-CA,en;q=0.9',
    'en-AU': 'en-AU,en;q=0.9',
    'en-SG': 'en-SG,en;q=0.9',
    'ja-JP': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
    'ko-KR': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    'zh-CN': 'zh-CN,zh;q=0.9,en;q=0.8',
    'zh-TW': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    'zh-HK': 'zh-HK,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    'de-DE': 'de-DE,de;q=0.9,en;q=0.8',
    'fr-FR': 'fr-FR,fr;q=0.9,en;q=0.8',
    'es-ES': 'es-ES,es;q=0.9,en;q=0.8',
    'es-MX': 'es-MX,es;q=0.9,en;q=0.8',
    'ru-RU': 'ru-RU,ru;q=0.9,en;q=0.8',
    'pt-BR': 'pt-BR,pt;q=0.9,en;q=0.8',
    'it-IT': 'it-IT,it;q=0.9,en;q=0.8',
    'nl-NL': 'nl-NL,nl;q=0.9,en;q=0.8',
    'th-TH': 'th-TH,th;q=0.9,en;q=0.8',
    'vi-VN': 'vi-VN,vi;q=0.9,en;q=0.8',
    'id-ID': 'id-ID,id;q=0.9,en;q=0.8',
    'ms-MY': 'ms-MY,ms;q=0.9,en;q=0.8',
    'tr-TR': 'tr-TR,tr;q=0.9,en;q=0.9',
    'ar-SA': 'ar-SA,ar;q=0.9,en;q=0.8',
    'ar-AE': 'ar-AE,ar;q=0.9,en;q=0.8'
  };

  async function syncHeader() {
    var stored = await chrome.storage.local.get(['lang', 'mode']);
    var lang = stored.lang || 'en-US';
    var mode = stored.mode || 'split';
    var foreignHeader = LANG_HEADER_MAP[lang] ||
      (lang + ',' + lang.split('-')[0] + ';q=0.9,en;q=0.8');

    var addRules = [];
    var removeIds = [1, 2];
    for (var i = 0; i < LOCAL_URL_FILTERS.length; i++) removeIds.push(LOCAL_ID_START + i);

    if (mode === 'split') {
      // 本地内网（优先级最高）：固定中文头
      LOCAL_URL_FILTERS.forEach(function (f, idx) {
        addRules.push({
          id: LOCAL_ID_START + idx,
          priority: 3,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [{ header: 'accept-language', operation: 'set', value: DOMESTIC_HEADER }]
          },
          condition: { urlFilter: f, resourceTypes: RESOURCE_TYPES }
        });
      });

      // 国内域名：固定中文头
      addRules.push({
        id: 2,
        priority: 2,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'accept-language', operation: 'set', value: DOMESTIC_HEADER }]
        },
        condition: { requestDomains: CN_DOMAINS, resourceTypes: RESOURCE_TYPES }
      });
    }

    // 其余（国外）域名：出口国语言头
    addRules.push({
      id: 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'accept-language', operation: 'set', value: foreignHeader }]
      },
      condition: { urlFilter: '*', resourceTypes: RESOURCE_TYPES }
    });

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: removeIds,
      addRules: addRules
    });
  }

  chrome.runtime.onInstalled.addListener(syncHeader);
  chrome.runtime.onStartup.addListener(syncHeader);
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && (changes.lang || changes.mode)) syncHeader();
  });
})();
