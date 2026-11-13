WebRTC Disabler v3.12  浏览器隐私防护扩展
=========================================

【功能】
1. WebRTC 防护（智能分流：国内/本地真实，国外按弹窗所选模式）
   - 智能分流下，国内网站和本地内网使用【真实 WebRTC】：视频/语音通话、
     屏幕共享正常（这些站本就直连，WebRTC 不会新增 IP 泄露）
   - 国外网站按弹窗所选模式（弹窗中“WebRTC 模式”仅对国外站生效）：
     · 伪装（推荐）：接口显示正常但只返回 mDNS 虚拟地址，绝不向 STUN 发包
     · 彻底禁用：页面提示“不支持 WebRTC”，最严格但属少数派特征
     · 关闭：国外站也用原生（会泄露真实 IP，不推荐）
   - 全局伪装模式下，所有网站统一按所选模式（含国内站）
2. 应用范围两档（配合“国内外分流”代理）
   - 智能分流（推荐，默认）：国内网站（.cn/.中国 及 domains.js 中的国内域名）
     和本地内网（192.168/10/172.16-31/127/169.254、localhost、.local、
     裸主机名、私有 IPv6）保持你电脑真实的时区/语言/定位和原生 WebRTC；
     只有国外网站才按出口国伪装。
   - 全局伪装：所有网站统一使用下面的时区/语言/定位（不分国内外）
3. 时区伪装（自动夏令时）、语言伪装（navigator.language / 各 Intl 接口 /
   Accept-Language 请求头，分流模式下国内站自动发中文头）、地理定位伪装
4. 弹窗“按 IP 自动匹配”：识别出口所在国家，自动填好国外站伪装值
5. 保存/自动匹配后立即刷新当前页并关闭弹窗（内置页不刷新）
6. 弹窗内置“打开伪装检测页”按钮，直达 https://ipip.la/disguise.html
7. 自动排除 Cloudflare 人机验证域名（challenges.cloudflare.com 及其备用域），
   不向其验证 iframe 注入脚本，避免干扰网站的安全验证（v3.10 起）

【安装方法】
1. 打开 chrome://extensions/（豆包浏览器同样地址）
2. 右上角打开“开发者模式”
3. 点“加载未打包的扩展程序”，选择本文件夹（WebRTC-Disabler）
4. 看到 WebRTC Disabler 3.12 且无红色“错误”即成功（需 Chrome/Chromium 119+）
5. 点工具栏扩展图标打开设置面板

【日常使用（分流代理用户）】
- 应用范围保持“智能分流”即可，国内站自动真实、国外站自动伪装
- 开着代理时点一次“按 IP 自动匹配”，把“国外站伪装值”设成代理出口
  （如美国洛杉矶 / en-US）；之后开关代理一般不用再动
- 国内站永远读取你电脑真实环境，不会被改成美国，可放心访问百度/淘宝等
- 若你不用分流、希望所有网站都伪装成同一个身份，把应用范围改“全局伪装”
- 配置通道：后台注册两段内容脚本。MAIN world 依次执行
  `domains.js → mode-split.js|mode-global.js → spoof.js`（名单/模式读完即删）；
  隔离世界的 `boot.js` 先向后台确认本页是否需要伪装（split 下国内/本地直接退出），
  需要时才读 storage，并用一次性令牌把配置与源码交给 spoof。
  令牌只在两个内容脚本之间经 DOM 属性交换并立即删除，页面看不到，
  伪造 postMessage 会被忽略；应用一次后监听立即注销
- 域名名单只有一份：domains.js。页面判定与请求头规则共用它；
  没收录的国内网站如需识别，只改 domains.js，然后重载扩展
  （不影响 WebRTC 防护，仅时区/语言暂按国外处理）
- 已知边界：`registerContentScripts` 不支持 `matchAboutBlank`（静态 manifest 字段），
  about:blank 帧由 `matchOriginAsFallback` 覆盖；Cloudflare 挑战域名不注入
- 已知窗口：storage 读取是异步的，配置到达前（通常 <1ms、早于页面脚本）
  先按默认值工作；Worker 在源码到达前创建会回退原生

【文件清单】
  manifest.json   扩展清单 v3.12（无静态 content_scripts，由后台动态注册；声明 WAR）
  domains.js      国内/国际品牌域名名单（唯一来源，同时供页面判定与后台）
  mode-split.js / mode-global.js  注册时选定分流模式（不产生页面可见全局）
  spoof.js        MAIN world 伪装引擎（名单/模式/配置读完即删）
  boot.js         隔离世界配置桥（storage → 一次性令牌 → spoof）
  background.js   注册两段脚本 + 串行同步 DNR 请求头 + 配置变化重注册
  popup.html/css/js  设置弹窗界面
  tests/          Node vm 回归（3 套）+ 真实 Chrome E2E（80 项）
  icons/          摄像头+挂锁 单图标 16/48/128
  README.md       本文件

【验证】
  $env:TZ='Asia/Shanghai'; node tests/spoof_regression.test.js   # 31/31
  node tests/background.test.js                                  # 8/8
  node tests/popup.test.js                                       # 5/5
  node tests/e2e_chrome.js                                       # 80/80（需本机 Chrome）

【本扩展管不了的（需其他手段）】
- IPv6：分流代理下 IPv6 可能绕过代理直连，建议在无线网卡直接禁用 IPv6
  （立即生效、可恢复）；这也能消除“无法获取 IP 归属”提示
- 机房/数据中心 IP 扣分：只能换住宅 IP 代理
- DNS 泄露 / EXE 程序：在代理客户端开启 TUN/全局模式 + 远程 DNS，
  浏览器扩展只保护浏览器，EXE 需 TUN 全局接管；扩展本身不改 DNS
- 字体/Canvas/WebGL/音频指纹：硬件层检测本就 100% 正常，不建议改动
- 国外视频/语音通话网站（如 Google Meet、Zoom 网页版走代理时）：伪装模式下
  无法真正通话（HTTP 代理不转发 UDP，放开即泄露真实 IP），需要通话时把
  “WebRTC 模式”临时切“关闭”，或改用支持 UDP/TURN 的代理；国内会议网页版
  （腾讯会议/飞书/钉钉）在智能分流下走真实 WebRTC，可正常通话
