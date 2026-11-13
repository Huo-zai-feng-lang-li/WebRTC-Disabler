# 更新日志

## v3.11 (2026-11-12)

### 修复（全链路对抗性审计的 5 条严重问题）
- **配置通道可被页面利用**：删除 `__applySpoofConfig` / `__spoofNatives` / `__fakeRTC` 三个全局和可伪造的 postMessage 广播。最终架构：MAIN world 按文件顺序注入 `domains.js → mode-*.js → spoof.js`（名单/模式读完即删，不产生页面可见全局）；隔离世界的 `boot.js` 先向后台确认本页是否需要伪装（split 下国内/本地直接退出、不建通道），需要时读 storage，用"一次性令牌"把配置与源码交给 spoof；令牌由两个内容脚本经 DOM 属性 rendezvous 交换并删除，页面脚本看不到，伪造消息一律忽略，应用后立即注销监听。
- **特殊帧逃逸**：动态注册脚本使用 `matchOriginAsFallback: true`，`about:blank`/`srcdoc`/`data:`/`blob:` 帧继承发起方判定，不再出现"父页伪装、子帧原生"。注意 `matchAboutBlank` 是 manifest 静态字段，`scripting.registerContentScripts` 会直接报 `Unexpected property`，不能混用。
- **时区自相矛盾**：新增统一 `offsetMinutesFor()` 换算层（15 分钟桶缓存），`get*/set*/to*/构造/parse` 全部走同一偏移；`toString` 输出长时区名；热路径 20k 次 `getTimezoneOffset` 从 5286ms 降到 11–26ms。
- **国内页不再被改动**：split 下国内/本地直接 return，零 hook；空 hostname 通过 `ancestorOrigins`/`referrer` 判发起方，判不出按国外处理（fail-closed）。
- **假 RTC 表面差异**：状态存 WeakMap（实例零自有属性）、成员挂原型、构造器 `length=0`、仅 mDNS 候选、事件 `isTrusted=true`、`close` 清理定时器、非法 `this` 抛 `TypeError`。

### 修复（中度）
- **品牌站只伪装请求头、不伪装 JS**：`alibaba.com`/`tiktok.com`/`xiaomi.com`/`huawei.com` 等 11 个域名同时出现在 `domains.js` 的 CN 与 FOREIGN 两份名单里。DNR 规则与 `spoof.js` 都按"FOREIGN 优先"处理，但 `background.js` 的 `isDomesticHost()` 只查 CN，导致 `wds-gate` 回 `{spoof:false}`、`boot.js` 不建配置通道，页面侧只能停留在 DEFAULTS 或真实环境——出现"请求头 ja-JP / JS 时区洛杉矶或真实时区"的矛盾指纹，比不伪装更易被识别。修复：`isDomesticHost()` 开头增加 FOREIGN 优先判定，与 `spoof.js` 的 `pageIsChina()` 顺序完全一致。
- **DNR 与 JS 分流不一致**：`domains.js` 成为唯一名单；DNR 新增 `.cn/.xn--fiqs8s` 正则、裸主机名、私有 IPv6、23 条本地规则，国际品牌站用更高优先级发英文头；`updateDynamicRules` 串行化，消除 `onInstalled`/`onStartup`/storage 并发导致的 "id 不唯一" 竞态。
- **popup 丢配置**：预设外时区/语言先补 option 再赋值，不再保存成空串；保存前校验时区、纬度 ±90、经度 ±180；IP 自动匹配遇到未内置语言的国家只填字段、不静默落盘。
- **Worker 环境**：classic Worker 注入同一份 domains+spoof 代码（源码经令牌通道下发，不在页面全局）；`module` Worker、data: URL、异常场景回退原生，不破坏页面。

### 测试
- `tests/spoof_regression.test.js` 31/31（A 配置/令牌通道、B 国内零改动、C 域名与帧、D 时区、E 指纹/定位、F RTC、G Worker）
- `tests/background.test.js` 8/8（双段注册描述符、global 模式文件、DNR 与 JS 判定一致、配置变更重注册、langHeader、**FOREIGN∩CN 域名的 gate 裁决与 spoof.js 同口径**、global 模式全量伪装）
- `tests/popup.test.js` 5/5（时区持久化、空值/经纬度校验、自动匹配、未内置语言）
- `tests/e2e_chrome.js` 真实 Chrome 扩展态 **80/80**（CDP `Extensions.loadUnpacked`；含国外/国内/本地分流、DST、about:blank/srcdoc、Worker、RTC/SDP、定位、请求头、**FOREIGN∩CN 品牌站完整伪装面**、global 热切换与还原）
- 运行方式：`$env:TZ='Asia/Shanghai'; node tests/spoof_regression.test.js`（三套同理）；E2E 用 `node tests/e2e_chrome.js`

## v3.10 (2026-11-11)

### 修复
- **Cloudflare Turnstile 验证失败**（开扩展被拦、关扩展即过）：根因是 manifest 的 `content_scripts` 使用 `matches: ["<all_urls>"]` + `all_frames: true`，导致 spoof.js/boot.js 也被注入到 `challenges.cloudflare.com` 的验证 iframe 内，CF 自身运行环境的 Date/Intl/navigator 被 hook，跨帧一致性校验失败，进入 `interactiveBegin` 无限人工交互直至超时。修复：两条 content_scripts 增加 `exclude_matches`，排除 4 个 Cloudflare 挑战域名。
- **FakeRTCPeerConnection 空 this 崩溃（A1）**：新增 `isPc(pc)` 实例校验，`startGathering` 入口判空，`addEventListener`/`removeEventListener`/`createOffer`/`setLocalDescription`/`setRemoteDescription`/`close`/`getConfiguration` 对无效 `this` 安全返回，不再抛 `Cannot read properties of null (reading '__gathering')`。
- **Date.prototype.toString 分钟字段 undefined（A2）**：拼接由 `map.min` 修正为 `map.minute`。

### 加固（指纹一致性）
- 新增隐身外壳：`nativeSourceMap`（WeakMap）+ `markNative()` + `defineHidden()`，并代理 `Function.prototype.toString`，使 hook 后的函数经 `fn.toString()` 与 `Function.prototype.toString.call(fn)` 都返回 `[native code]`。
- 覆盖 FakeRTCPeerConnection 构造器与全部原型方法、generateCertificate、Intl 系列包装构造器（name 恢复原名）、Date.getTimezoneOffset/toString、Navigator.language/languages getter、geolocation 三方法与 getter、navigator.permissions.query。
- `window.__spoofNatives` / `__fakeRTC` / `__applySpoofConfig` 改为不可枚举挂载；RTC 实例自有属性改为不可枚举。

### 测试
- 新增 `tests/spoof_regression.test.js`（Node vm 桩环境，无框架）：覆盖正常实例 createOffer/setLocalDescription、null/undefined/假对象调用不抛实例属性 TypeError、Date.toString 无 undefined。`node tests/spoof_regression.test.js` 全绿，`node --check spoof.js` 通过。

### 验证
- 真机：https://www.xpgmail.com/login 的 Turnstile 由必失败变为绿勾通过；WebRTC 不泄露（用户确认）。
- 影响面：仅排除 CF 挑战域名，主页面与其他 iframe 伪装不变，WebRTC/时区/语言/定位逻辑未改动。

## v3.9 (2026-10-09)
- WebRTC 也按国内外分流处理：国内/本地真实原生 RTC（通话可用），国外站按所选模式伪装。
- 智能分流 + 本地内网识别；单图标；Accept-Language 按域名分流。

## v3.8
- 新增 `isLocalIntranet()`：私有 IPv4/IPv6、localhost、.local、裸主机名保持真实环境。

## v3.7
- WebRTC 构造器 `name='RTCPeerConnection'`，构造器与原型方法 `toString` 均伪装为 `[native code]`。

## v3.6
- 修复 DeepSeek 等国内 .com 站误判。

## v3.5
- 智能分流（split/global）+ 单图标。

## v3.1 - v3.3
- 早期版本：WebRTC 三档模式、时区/语言/定位伪装、按 IP 自动匹配。
