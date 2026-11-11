# 更新日志

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
