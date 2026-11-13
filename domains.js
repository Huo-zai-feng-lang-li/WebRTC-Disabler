/**
 * 域名名单单一来源。
 * background.js 通过 importScripts 读取；页面注册时本文件先于 mode/spoof 执行，
 * spoof 读取后立即删除该全局，页面脚本拿不到、也改不了判定名单。
 */
(function (root) {
  'use strict';
  var CN = [
  'baidu.com', 'qq.com', 'weixin.qq.com', 'taobao.com', 'tmall.com', 'jd.com', '163.com', '126.com',
  'sina.com.cn', 'weibo.com', 'sohu.com', 'ifeng.com', 'cctv.com', 'cntv.cn',
  'alipay.com', 'alibaba.com', 'aliexpress.com', 'antgroup.com', 'tmall.hk',
  'douyin.com', 'tiktok.com', 'toutiao.com', 'ixigua.com', 'bytedance.com',
  'bilibili.com', 'b23.tv', 'zhihu.com', 'douban.com', 'csdn.net',
  'xiaohongshu.com', 'xhs.cn', 'xhslink.com', 'meituan.com', 'dianping.com', 'ele.me',
  'pinduoduo.com', 'suning.com', 'gome.com.cn', 'vip.com', 'dangdang.com',
  '12306.cn', 'ctrip.com', 'qunar.com', 'fliggy.com', 'trip.com',
  'weibo.cn', 'sina.cn', 'sina.com', 'sohu.com.cn', '163.com.cn',
  '360.cn', '360.com', 'so.com', 'sogou.com', 'sm.cn',
  'baidubce.com', 'bdstatic.com', 'bdimg.com', 'bcebos.com',
  'qq.com.cn', 'tencent.com', 'qcloud.com', 'myqcloud.com', 'qpic.cn',
  'aliyun.com', 'aliyuncs.com', 'taobao.org', 'tmall.com.cn',
  'netease.com', '163.net', '126.net', 'yeah.net',
  'mi.com', 'xiaomi.com', 'miui.com', 'huawei.com', 'hicloud.com',
  'oppo.com', 'vivo.com', 'meizu.com', 'oneplus.com', 'realme.com',
  'lenovo.com', 'zte.com.cn', 'tcl.com', 'hisense.com', 'konka.com',
  'icbc.com.cn', 'ccb.com', 'boc.cn', 'abchina.com', 'cmbchina.com',
  'psbc.com', 'cebbank.com', 'citicbank.com', 'cmbc.com.cn', 'bankcomm.com',
  'spdb.com.cn', 'hxb.com.cn', 'cgbchina.com.cn', 'unionpay.com',
  'gov.cn', 'edu.cn', 'org.cn', 'ac.cn', 'mil.cn',
  'people.com.cn', 'xinhuanet.com', 'chinanews.com', 'gmw.cn', 'ce.cn',
  'chinadaily.com.cn', 'huanqiu.com', 'thepaper.cn', 'yicai.com',
  'eastmoney.com', '10jqka.com.cn', 'hexun.com', 'stockstar.com',
  'autohome.com.cn', 'pcauto.com.cn', 'bitauto.com', 'xcar.com.cn',
  'fang.com', 'anjuke.com', 'ke.com', 'lianjia.com', '58.com',
  'ganji.com', 'baixing.com', 'koubei.com', 'nuomi.com',
  'youku.com', 'iqiyi.com', 'mgtv.com', 'tudou.com', 'letv.com',
  'pptv.com', 'fun.tv', 'acfun.cn', 'douyu.com', 'huya.com',
  'kugou.com', 'kuwo.cn', 'y.qq.com', 'music.163.com', 'xiami.com',
  'didiglobal.com', 'didi.com', 'hellobike.com', 'mobike.com',
  'sf-express.com', 'zto.com', 'yto.net.cn', 'sto.cn', 'yundaex.com',
  'jd.com.cn', 'jdl.com', 'deppon.com', 'best-inc.com',
  '10086.cn', '10010.com', '189.cn', 'chinamobile.com', 'chinatelecom.com.cn',
  'chinaunicom.com.cn', '10000.com', '139.com', 'wo.com.cn',
  'meitu.com', 'meituan.net', 'dianping.net', 'waimai.com',
  'qyer.com', 'mafengwo.cn', 'elong.com', 'tuniu.com',
  'lagou.com', 'zhipin.com', '51job.com', 'liepin.com', 'zhaopin.com',
  'ganji.com.cn', '58.com.cn', 'anjuke.com.cn', 'fang.com.cn',
  'alibaba-inc.com', 'taobao.net', 'tmall.net', 'etao.com',
  'juejin.cn', 'oschina.net', 'cnblogs.com', 'segmentfault.com',
  'gitee.com', 'coding.net', 'gitcode.com', 'aliyun.com.cn',
  'vmall.com', 'honor.com', 'nubia.com', 'smartisan.com'
];

/**
 * 面向全球的品牌站：出口 IP 在国外时按国内处理会直接泄露真实时区，故强制走伪装。
 * 这些域名同时也在 CN_DOMAINS 里（用于国内直连场景的历史兼容），DNR 用更高优先级覆盖。
 */
var FOREIGN = [
  'alibaba.com', 'aliexpress.com', 'wechat.com', 'xiaomi.com', 'huawei.com',
  'oppo.com', 'vivo.com', 'oneplus.com', 'realme.com', 'meizu.com', 'tiktok.com'
];

  root.__WDS_LISTS = { cn: CN, foreign: FOREIGN };
})(typeof globalThis !== 'undefined' ? globalThis : this);
