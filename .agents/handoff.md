# 最新接续状态 (2026-11-13 · v3.12)

## 核心进展
- **WebRTC Disabler v3.12 已提交**，目录 `D:\Desktop\Super-File\浏览器扩展\WebRTC-Disabler\`。
- v3.11 完成全链路对抗性重写（架构级）：静态 content_scripts → `chrome.scripting` 动态注册；可伪造全局 → 一次性令牌握手；`domains.js` 成为名单唯一来源。
- v3.12 修复 v3.11 引入的分流判定不一致 bug（详见下「v3.12 修复」）。
- 真机验证：E2E 80/80，单测 31+8+5 全绿；反证（移除修复）确认测试有效。

## v3.12 修复（本次）
- **品牌站只伪装请求头、不伪装 JS**：11 个域名同时在 `domains.js` 的 CN 与 FOREIGN 名单里（`alibaba.com`/`aliexpress.com`/`wechat.com`/`xiaomi.com`/`huawei.com`/`oppo.com`/`vivo.com`/`oneplus.com`/`realme.com`/`meizu.com`/`tiktok.com`）。
- 根因：DNR 与 `spoof.js#pageIsChina()` 都是 FOREIGN 优先，但 `background.js#isDomesticHost()` 只查 CN → `wds-gate` 回 `{spoof:false}` → `boot.js` 不建通道 → 页面停留在 DEFAULTS/真实环境 → 「请求头 ja-JP / JS 时区真实」矛盾指纹。
- 修复：`background.js` 第 182 行前加 `if (FOREIGN.some(...)) return false;`，与 `pageIsChina()` 顺序对齐。
- 影响面：仅 split 模式下上述 11 个站；其余场景零变化。

## v3.11 架构（当前基线，勿回退）
- **注入**：`chrome.scripting.registerContentScripts` 两段
  - MAIN：`domains.js → mode-split.js|mode-global.js → spoof.js`（文件顺序即执行顺序，读完即删全局）
  - ISOLATED：`boot.js`
  - 公共：`runAt: document_start`、`allFrames`、`matchOriginAsFallback: true`、`persistAcrossSessions`、排除 4 个 CF 挑战域名
- **配置通道**：`boot.js` 先发 `wds-gate` 问后台 → 需要时读 storage + `fetch` 两源码 → `postMessage` 带一次性令牌 → `spoof.js` 校验令牌、应用后立即注销监听。令牌经 DOM 属性 `data-wds-k` rendezvous，页面脚本执行前已被删除。
- **名单单一来源**：`domains.js` 写入 `__WDS_LISTS`，background 用 `importScripts` 读，页面注入也读同一份。
- **模式开关**：`mode-global.js`/`mode-split.js` 各 5 行写 `__WDS_MODE`（`registerContentScripts` 只接受文件、不接受内联代码）。
- **硬约束**：`minimum_chrome_version: 119`（`matchOriginAsFallback` 依赖）；新增 `scripting` 权限；`web_accessible_resources` 声明 `domains.js`/`spoof.js`（配置不在其中，不泄露用户选择）。

## 验证状态
| 测试 | 结果 | 备注 |
|---|---|---|
| `tests/spoof_regression.test.js` | 31/31 | A 配置通道 / B 国内零改动 / C 域名与帧 / D 时区 / E 指纹定位 / F RTC / G Worker |
| `tests/background.test.js` | 8/8 | 含新增 BG7（FOREIGN∩CN gate）/ BG8（global 全量） |
| `tests/popup.test.js` | 5/5 | 时区持久化 / 校验 / 自动匹配 / 未内置语言 |
| `tests/e2e_chrome.js` | 80/80 | 真机 Chrome（headless + CDP `Extensions.loadUnpacked`），含 tiktok/xiaomi 品牌站 |
| 反证 | 7/8 + 70/80 | 移除修复后失败，证明测试有效 |

运行：
```powershell
$env:TZ='Asia/Shanghai'; node tests/spoof_regression.test.js
node tests/background.test.js
node tests/popup.test.js
node tests/e2e_chrome.js    # 需本机 Chrome，可用 CHROME_PATH 覆盖
```

## 已知窗口 / 限制
- **配置到达前的时间窗口**：`sendMessage → storage → 2×fetch → postMessage` 链路不是注释里写的 `<1ms`。慢机器 + 大页面上，首帧理论可能被网站抓到 DEFAULTS（洛杉矶/en-US）或真实值。E2E headless 未复现。**未修复，属设计取舍**。
- **未收录的国内 .com**：split 下按国外处理（`.cn` 全自动覆盖，WebRTC 仍保护）。要补只改 `domains.js` 一处，重载扩展即可（v3.11 起不再需要改三处）。
- **popup 自动匹配**：国家语言未内置时只填字段不落盘，用户需手动选语言再保存（README 已说明）。
- **CF 挑战域名**：4 个 `challenges.*` 域名不注入，避免破坏 Turnstile。
- **Function.prototype.toString 深层探测**：显式 `Function.prototype.toString.call(fn)` 仍可绕过方法级伪装，再深入需代理全局 `Function.toString`，风险大于收益，不做。

## 环境与背景
- 代理：点点加速器 dotsvpn，本地 HTTP 代理 `127.0.0.1:51081`（不支持 UDP、自动国内外分流）。
- 用户网络：真实 IPv4 新疆移动 AS9808；WLAN 的 IPv6 已于 2026-10-09 禁用（恢复命令见旧版 handoff 历史）。
- 系统：Windows，pwsh 7，用户简体中文，人在中国（系统真实时区 Asia/Shanghai UTC+8）。
- 本地开发扩展，改代码后在 `chrome://extensions` 点刷新即生效，不维护 zip 交付包。
- 检测页：`https://ipip.la/disguise.html`（综合）、`https://ipip.la/webrtc.html`（专项）。
- Git 历史：`5492cbe`(docs) → `dbcc629`(fix v3.11 全链路) → `5c7b3ec`(v3.10 CF)。

## 待办
- [ ] **推送远端 / 打 tag**（v3.12 提交后需确认是否 `git push`、`git tag v3.12`）
- [ ] 如需分发：打包 zip（v3.11 起用户未再要求，确认后再做）
- [ ] 若某国内 .com 站仍显示英文/国外时区：只改 `domains.js` 的 CN 名单 → 重载扩展 → 强刷验证
- [ ] 慢网络下「配置到达前窗口」若被证实可观测，需考虑同步注入初始配置（当前未做）
