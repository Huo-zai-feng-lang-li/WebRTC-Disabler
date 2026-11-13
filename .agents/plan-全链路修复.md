# WebRTC Disabler v3.11 全链路修复计划

> 规格来源：`.agents/WebRTC防护-全链路对抗性审计.md`（P1–P15 与 🟢 清单）。用户已明确指令"全部修复，然后全部测试"，按原生执行 + TDD 推进。

## 目标
让"不泄露真实 IP / 时区语言自洽 / 国内页零改动"这三条承诺在对抗性页面下也成立，并用可复现的自动化测试证明。

## 架构决策
1. **配置通道**：删除 `boot.js` 与 `window.postMessage({__spoofConfig})`。`background.js` 读取 `spoof.js` 源码，把 `CFG`（配置）与 `SRC`（自源码，供 Worker 用）包进一层 IIFE，通过 `chrome.scripting.registerContentScripts/updateContentScripts`（`world:'MAIN'`、`runAt:'document_start'`）注册。配置同步可用（顺带修掉首帧竞态），页面不可读、不可伪造。
2. **零全局**：`natives`、`Fake`、内部状态全部留在 IIFE 闭包；不再出现 `__spoofNatives/__fakeRTC/__applySpoofConfig`。不再提供任何页面可调用的降级入口。已打开标签在下次导航生效（popup 保存时刷新当前页）。
3. **国内页零改动**：`split` 且国内/本地 → 直接 return，不装任何 hook（含 `Function.prototype.toString`、`permissions`、`moz*`）。
4. **fail-closed**：空 hostname 不再视为本地；用 `location.ancestorOrigins` / `document.referrer` 推断发起方，判不出 → 按国外伪装。
5. **时区统一换算层**：`offsetMinutesFor(date)` 单点计算（formatter 缓存 + 15 分钟桶缓存），`get*`/`set*`/`to*`/`Date` 构造与 `parse` 全部走该层；`toString` 用长时区名对齐原生格式。
6. **RTC 表面对齐**：实例状态存 WeakMap（实例自有属性 0），成员挂原型（accessor + 方法），构造器 `length=0`，返回值用原生 `RTCSessionDescription`，无效 `this` 抛 `TypeError`（对齐原生，不再静默返回）。
7. **DNR 与 JS 同源**：补 `.cn`/`.中国`(punycode) 正则、裸主机名、IPv6 本地规则；增加"国际站强制国外"名单（alibaba.com、wechat.com、xiaomi.com、huawei.com、oppo.com、vivo.com、oneplus.com、realme.com、meizu.com），三处判定共用同一份常量。
8. **Worker**：`spoof.js` 改为 `root = window||self` 环境无关写法；包装 `Worker` 构造器，把同一份自包含代码 + `importScripts(绝对URL)` 注入 classic worker；module worker 与异常场景回退原生（不破坏站点）。
9. **popup**：预设外时区在 load 时自动补 option；save 校验时区/经纬度；自动匹配遇到未内置语言的国家时，不静默保存，提示用户确认语言。

## 文件
- 重写：`spoof.js`、`background.js`、`popup.js`、`tests/spoof_regression.test.js`
- 修改：`manifest.json`（3.11、+scripting、minimum_chrome_version 119、移除静态 content_scripts）、`README.md`、`CHANGELOG.md`、`.agents/handoff.md`
- 保留：`boot.js`（原计划"配置内联"方案被真机约束推翻，最终由 boot 承担一次性令牌下发，见下方闭环结果）
- 新增：`domains.js`（唯一域名名单，background 与页面共用）、`mode-split.js`、`mode-global.js`
- 新增：`tests/helpers.js`、`tests/background.test.js`、`tests/popup.test.js`

## 审查重点
- 伪造配置/降级：任何页面输入都不能让境外页回到原生 RTC 或真实时区。
- 国内页原生化：hook 前后描述符逐项相等。
- 帧/Worker 逃逸：about:blank、srcdoc、classic Worker 不得拿到原生 RTC 或真实时区。
- DST/无效日期/构造与 parse：换算层在这些路径不自相矛盾。
- 不破坏站点：Worker 包装失败必须回退；`Intl`/`Date` 调用签名与原生一致。

## 验证
1. 每个模块先写失败测试，再实现到绿。
2. `node tests/spoof_regression.test.js`、`node tests/background.test.js`、`node tests/popup.test.js` 全绿；`node --check` 全部源文件。
3. 浏览器 E2E：加载扩展后实测境外页/国内页/about:blank 帧/srcdoc 帧/Worker 的 RTC 与时区，以及 `.cn` 站 Accept-Language。

---

## 闭环结果（2026-11-13，v3.11 最终架构）

真机验证推翻了计划里的"配置内联"方案，最终落地为：
- **动态注册只接受文件**：`js:[{code:'...'}]` 报 `Invalid type: expected string, found object`，配置不能内联。
- **动态注册不支持 `matchAboutBlank`**：传该字段整条注册失败（`Unexpected property: 'matchAboutBlank'`）；about:blank 由 `matchOriginAsFallback` 覆盖，E2E 已实测通过。
- **最终架构**：MAIN world 按文件顺序注入 `domains.js → mode-split.js|mode-global.js → spoof.js`；ISOLATED 的 `boot.js` 先向后台确认本页是否需要伪装（split 下国内/本地直接退出、不建通道），需要时才读 storage，经 DOM 属性 rendezvous 的一次性令牌把配置 + 源码交给 spoof（令牌由先到者写、后到者读并删除，页面看不到；应用一次即注销监听；boot 按 100ms 重试直到收到 spoof 的 ack，避免注入顺序导致的漏配）。
- **WAR 必需**：`manifest.json` 增加 `web_accessible_resources`（domains.js/spoof.js），否则隔离世界 fetch 扩展资源被拦，Worker 源码为空、退回原生。
- **DNR 串行化**：`onInstalled`/`onStartup`/storage 变化曾在同一 tick 并发调用 `updateDynamicRules`，报 "Rule with id 1 does not have a unique ID"；改为串行队列 + 合并重跑。
- **验证**：spoof 31/31、background 6/6、popup 5/5、真机 E2E 40/40（Chrome 157，CDP `Extensions.loadUnpacked`）。
- **已知边界**：storage 异步窗口（通常 <1ms，先默认值，文档已写明）；Worker 在源码到达前创建会回退原生；Cloudflare 挑战域不注入。
