// ============================================================================
// boot.js — 隔离世界内容脚本：从 chrome.storage 读取配置，结合当前域名判断
// 智能分流（国内域名保持真实 / 国外域名伪装），再通过 postMessage 下发给
// 主世界 spoof.js（postMessage 不受页面 CSP 限制）
// ============================================================================
(function () {
  'use strict';

  // 与 spoof.js 保持一致的国内域名表
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

  // 与 spoof.js 保持一致：本地内网（私有 IP / localhost / .local / 裸主机名）
  function isLocalIntranet() {
    try {
      var host = (location.hostname || '').toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
      if (!host) return true;
      if (host === 'localhost' || host.endsWith('.local')) return true;
      if (host.indexOf('.') === -1 && host.indexOf(':') === -1) return true;
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
        if (/^fe[89ab]/.test(host)) return true;
        if (/^f[cd]/.test(host)) return true;
      }
    } catch (e) {}
    return false;
  }

  function pushToMain(cfg) {
    try {
      window.postMessage({ __spoofConfig: true, cfg: cfg }, '*');
    } catch (e) {}
  }

  function syncAll() {
    try {
      chrome.storage.local.get(null, function (stored) {
        stored = stored || {};
        var mode = stored.mode || 'split';
        var cfg = Object.assign({}, stored);
        // 全局模式：所有域名伪装；智能分流：国内域名保持真实，国外域名伪装
        cfg.localeMode = (mode === 'global') ? 'spoof' : ((pageIsChina() || isLocalIntranet()) ? 'native' : 'spoof');
        pushToMain(cfg);
      });
    } catch (e) {}
  }

  // 存储就绪后立即同步一次
  syncAll();

  // 设置变更时实时更新（已打开的标签无需刷新即可切换；保存按钮也会主动刷新）
  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'local') syncAll();
    });
  } catch (e) {}
})();
