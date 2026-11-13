# WebRTC Disabler v3.10 — 全链路对抗性审计报告

- 审计对象：`D:\Desktop\Super-File\浏览器扩展\WebRTC-Disabler`，HEAD `5c7b3ec`（v3.10），工作区 clean、无 untracked
- 审计姿态：证伪优先。注释、README、CHANGELOG、handoff 中的所有承诺均视为"待证伪供词"
- 取证手段：全量静态阅读 + `node --check` + 自带测试 + Node 22 `vm` 攻防复现（TZ=Asia/Shanghai） + Chromium 147 原生基线探针（Chrome DevTools MCP）
- 审计时间：2026-11-12

---

## 1. 门禁裁决

**🛑 REJECT（禁止发布/禁止继续加固式微调）**

理由：存在 5 条 🔴，且全部可由**页面脚本单方面触发**，不需要用户操作、不需要额外权限。扩展的核心承诺"WebRTC 不泄露真实 IP / 时区语言已伪装"在对抗性站点上不成立。当前 5 条 🔴 没有一条会被仓库现有测试发现（测试全绿只覆盖两个历史崩溃点）。

---

## 2. 端到端链路与闭环核验

| 环节 | 位置 | 结论 |
|---|---|---|
| 配置起点 | `boot.js:99-107` `chrome.storage.local.get(null)` 异步读取 | 存疑（首帧竞态，见 P7） |
| 配置下发 | `boot.js:91-95` `window.postMessage(...,'*')` | **断裂**（页面可读可伪造，见 P3） |
| 配置消费 | `spoof.js:620-623` 无认证监听 | **断裂**（同上） |
| 应用入口 | `spoof.js:590-611` `apply()` | **断裂**（页面可直接调用，见 P2） |
| 原生对象保管 | `spoof.js:146-168` `window.__spoofNatives` | **断裂**（页面可读，见 P1） |
| 终端表现 1 | 页面 JS API 返回值 | 部分不一致（P5/P6/P9/P10/P11） |
| 终端表现 2 | `background.js:96-148` DNR 改 Accept-Language | 与 JS 判定不同源（P8） |

链路缺口总结：配置是"广播"而非"私密通道"，原生对象是"挂在 window 上的公共财产"，iframe/Worker 是"未设防的侧门"。

---

## 3. 缺陷清单

### 🔴 P1 原生对象全局暴露：页面一行代码拿回真实 RTC（IP 泄露）

- **定位**：`spoof.js:146-168`（`natives` 捕获并 `defineHidden(window,'__spoofNatives',natives)`）、`spoof.js:617`
- **事实证据**：
  - 代码路径明确：`RTC: window.RTCPeerConnection || window.webkitRTCPeerConnection`，随后挂到页面可读的 `window.__spoofNatives.RTC`。
  - Node vm 实测：`'__spoofNatives' in window === true`；`__spoofNatives.getTZO.call(new Date()) === -480`（真实 UTC+8），`__spoofNatives.langDesc.get.call(navigator) === 'zh-CN'`，`__spoofNatives.dateToString` 输出真实时区的原生字符串。
  - `defineHidden` 只做了 `enumerable:false`，**不可枚举 ≠ 页面不可访问**：`in window`、`window.__spoofNatives.RTC`、`Object.getOwnPropertyNames(window)` 全部拿得到。
- **攻击链**：
  1. `new (window.__spoofNatives.RTC)({iceServers:[{urls:'stun:...'}]})` → 真实 ICE/STUN → 真实公网 IP；
  2. 或 `window.__fakeRTC = window.__spoofNatives.RTC; window.__applySpoofConfig({mode:'split',webrtcMode:'spoof'})` → 让扩展自己把原生 RTC 当作"假 RTC"装上。
- **危害**：核心防护被 1 行代码绕过；同时泄露真实时区与语言。这是"把保险箱钥匙挂在门上"。
- **修复**：`natives`/`Fake` 全部收回 IIFE 闭包，删除 `__spoofNatives`、`__fakeRTC`、`__applySpoofConfig` 三个 window 名；`webrtcMode=off` 与 `restoreLocale()` 只用闭包引用。测试需要的观测点改为测试构建专属注入（生产构建不生成）。
- **信心评分**：9.5 / 10

### 🔴 P2 页面可直接调用 apply，强制降级到原生

- **定位**：`spoof.js:617` `defineHidden(window,'__applySpoofConfig',apply)`
- **事实证据**：Node vm 实测 `__applySpoofConfig({localeMode:'native',mode:'global',webrtcMode:'off'})` 后：`Date.prototype.getTimezoneOffset` 恢复原生（返回 -480）、`navigator.language` 回到 `zh-CN`、`Intl.DateTimeFormat` 回到原生对象。即一次调用即可关掉全部本地伪装；WebRTC 分支同样走 `applyWebRTC('off')`（`spoof.js:399-416`），在 Chrome 中即原生构造器。
- **危害**：不需要理解内部结构，页面脚本即可自我"解除保护"后再探测真实 IP/时区。
- **修复**：不暴露 apply。若必须保留调试入口，改为仅接受内部签名的完整配置对象，且**任何外部输入不得把 `localeMode` 设为 `native`、不得把 `webrtcMode` 设为 `off`**；保护等级只允许升不允许降。
- **信心评分**：9.5 / 10

### 🔴 P3 postMessage 配置通道可伪造、且配置对页面全透明

- **定位**：`boot.js:91-95`、`spoof.js:620-623`
- **事实证据**：
  - 消息体是明文：`{__spoofConfig:true, cfg:{...全部存储键...}}`，页面 `addEventListener('message')` 可直接读到，包括 `mode/webrtcMode/tz/lang/geoLat/geoLng`。
  - 无任何认证：只校验 `ev.source === window && ev.data.__spoofConfig === true`，页面 `window.postMessage` 自己给自己发即可通过。
  - Node vm 实测（用真实 `window` 身份投递伪造消息）：locale 立即被还原（offset 480→-480、lang→zh-CN、Intl 还原）；WebRTC 分支按代码 `applyWebRTC('off')` 同样还原原生。
  - **协议是自描述的**：页面只要监听一次 boot 的真实消息，就学会消息形状，然后可周期性重放 `{localeMode:'native',webrtcMode:'off'}` 压制后续正确配置。
- **危害**：对任何愿意写 10 行 JS 的站点，WebRTC 防护与时区伪装 100% 失效；同时泄露用户的伪装参数。
- **修复**（架构级，见第 5 节）：
  - 首选：删除 window 消息通道。改用 `chrome.scripting.registerContentScripts`（`world:'MAIN'`, `runAt:'document_start'`）注册一份"配置字面量已内联"的脚本；设置变更时先 unregister 再 register，并对已开标签用 `chrome.scripting.executeScript` 热更新。配置不进 DOM、不进 window、页面不可读。
  - 兜底：消息必须一次性、带 boot 生成的不可预测 token，且**拒绝所有降级字段**；初始配置后立即移除监听。
- **信心评分**：9.5 / 10

### 🔴 P4 about:blank / srcdoc / data: / blob: 帧未注入 → 原生 RTC 直达真实 IP

- **定位**：`manifest.json:25-51`，两条 `content_scripts` 均未声明 `match_about_blank` / `match_origin_as_fallback`
- **事实证据**：
  - Chrome 官方文档明确：`match_about_blank` 默认 `false`；`match_origin_as_fallback` 默认 `false`，后者才是注入 `about:`、`data:`、`blob:`、`filesystem:` 帧的开关（已抓取 developer.chrome.com 原文核对）。
  - 代码中没有任何帧内补注入逻辑（无 `scripting.executeScript`、无帧内 bootstrap）。
- **攻击链**：
  ```js
  const f = document.createElement('iframe');           // about:blank
  document.body.appendChild(f);
  const pc = new f.contentWindow.RTCPeerConnection({ iceServers: [...] }); // 原生，真实 STUN
  ```
  `srcdoc`、`data:text/html,...`、`URL.createObjectURL(new Blob([...]))`、`window.open('about:blank')` 同理。页面还能在这些帧里读到真实时区/语言（`new f.contentWindow.Date().getTimezoneOffset()`）。
- **附带设计雷（必须先拆）**：`spoof.js:111` 与 `boot.js:70` 的 `isLocalIntranet()` 对**空 hostname 返回 true**（"视为本地内网"）。一旦补上 `match_origin_as_fallback`，`about:srcdoc` 等帧会被判为"本地"→ 去还原真实环境，泄露反而放大。隐私工具的默认必须是 **fail-closed（判不出就伪装）**，绝不能 fail-open。
- **修复**：
  1. 两条 content_scripts 增加 `"match_origin_as_fallback": true`、`"match_about_blank": true`；
  2. `isLocalIntranet()` 不再把空 hostname 当本地；空 host 时用 `location.ancestorOrigins[0]` / `document.referrer` 推断发起方站点，判不出→按"伪装"处理；
  3. 为 `srcdoc` 帧补一条从父帧继承配置的路径（同源可读 `parent` 配置，跨源则用发起方主机名判定）。
- **信心评分**：8.5 / 10（manifest 缺字段与平台语义 10/10；未做扩展态 E2E，因为当前可用的自动化浏览器未安装本扩展）

### 🔴 P5 时区伪装只覆盖 3 个入口：内部自相矛盾，并直接泄露真实时区

- **定位**：`spoof.js:435-459`（`targetOffset`/`getTimezoneOffset`）、`spoof.js:491-513`（`Date.toString`）
- **事实证据**（Node 22，系统 TZ=Asia/Shanghai，伪装 America/Los_Angeles）：
  - `new Date().getTimezoneOffset()` → `480`（声称 UTC-8）
  - `new Date().getHours()` → `14`（真实上海时间）
  - 按伪装 offset 推算应为 `22` 点 → **同一页面内两个 API 差 8 小时**
  - `new Date().toTimeString()` → `"14:16:52 GMT+0800 (中国标准时间)"`（真实）
  - `new Date().toLocaleString()` → `"2026/11/13 14:16:52"`（真实时区 + 中文格式）
  - `Intl.DateTimeFormat().resolvedOptions().timeZone` → `America/Los_Angeles`（伪装）
- **未覆盖清单**：`getHours/getMinutes/getSeconds/getMilliseconds/getDay/getDate/getMonth/getFullYear/getYear`、全部 `setXxx`、`toTimeString/toLocaleString/toLocaleDateString/toLocaleTimeString`、`new Date(y,m,d,...)` 与 `Date.parse` 的本地时区解析。整个本地时间语义仍是系统真实时区。
- **危害**：`getHours()` 与 `getTimezoneOffset()` 互查是最基础的指纹探针，一条就判定"时区伪造"；且真实时区（中国 UTC+8）被直接读出，等于泄露地理位置线索。这使"时区伪装"从"降低识别率"变成"提高识别率"。
- **修复**：建立统一的"虚拟本地时间层"：以 `targetOffset(date)` 为基准，把本地时间换算成 `UTC + offset` 后再实现全部 get/set 与 `to*`；`Date` 构造与 `parse` 的本地解析同步改写。若不愿承担这个改造面，应在产品上明确降级承诺"仅伪装 Intl/getTimezoneOffset/toString"，不要宣称时区已伪装。
- **信心评分**：9.5 / 10

### 🟡 P6 `Date.prototype.toString` 输出格式与原生不一致

- **定位**：`spoof.js:491-513`，`timeZoneName:'short'`（502 行还硬编码 PST/PDT 兜底）
- **事实证据**：
  - Chromium 147 原生（本机 MCP 探针）：`"Fri Nov 13 2026 14:14:30 GMT+0800 (中国标准时间)"` —— 长时区名、本地化。
  - spoof 算法（Node 实测）：`"Thu Nov 12 2026 22:16:52 GMT-0800 (PST)"` —— 短时区名 + 英文。
  - `Intl` 的 `timeZoneName:'long'` 明确返回 `Pacific Standard Time`，与原生格式同源；代码用了 `short`。
- **危害**：`new Date().toString()` 是最高频探针之一，格式差异直接暴露"非原生环境"。
- **修复**：按原生输出复刻：`timeZoneName:'long'` + 浏览器默认 locale 的时区名；去掉 PST/PDT 硬编码兜底（应按 tz 查表或让 Intl 返回）。
- **信心评分**：8.5 / 10

### 🟡 P7 首帧用硬编码 DEFAULTS，配置异步到达 → 页面加载中指纹跳变

- **定位**：`spoof.js:613-615` 在 document_start 立即 `apply({DEFAULTS})`；`boot.js:99` 的 storage 读取是异步回调
- **事实证据**：代码顺序确定：`spoof.js` 先以 `America/Los_Angeles/en-US/spoof` 应用一次，boot 的 `chrome.storage.local.get` 回调到达后才推送真实配置。页面内联脚本（document_start 后立即执行）通常早于该回调。
- **场景**：用户配置 `Asia/Tokyo/ja-JP` → 页面开始读到 LA/en-US，几毫秒后变成 Tokyo/ja-JP；同一次加载内 Date/Intl 值发生跳变。`global` 模式下国内页还会先 `native` 再 `spoof`。
- **危害**：既可能给出错误的伪装国（与 IP 国家不符），又制造"环境在加载中变化"的强特征。
- **修复**：配置随注册脚本内联（与 P3 同一方案），做到 document_start 同步可用；在无法同步的旧路径上，首帧采取 **fail-closed 的保守值**并只允许一次最终应用。
- **信心评分**：8 / 10

### 🟡 P8 DNR 分流范围 ≠ JS 分流范围（`.cn` / `.中国` / 裸主机名）

- **定位**：`background.js:122-130`（仅 191 个 `requestDomains`）、`spoof.js:97-98`（全部 `.cn`/`.中国` 判国内）
- **事实证据**：JS 层对**任意** `.cn` 域名还原中文环境；DNR 只对 191 个显式域名设中文头，其余命中 `urlFilter:'*'` 的英文头规则（priority 1）。`www.gov.cn`、`www.12306.cn`、`www.icbc.com.cn` 等大量 .cn 站不在名单内。
- **后果**：页面内 `navigator.languages = zh-CN`、真实上海时区，但请求头 `Accept-Language: en-US,en;q=0.9` → 服务端语言协商错误、页面可能出英文；服务端还可把"header 与 JS 声明不一致"作为风控特征。
- **修复**：加一条 `regexFilter`（RE2）匹配 `^https?://[^/]*\.cn(:\d+)?/`，并处理 `.中国` 的 punycode（`xn--fiqs8s`）；裸主机名单独规则或改为"无点 host 也发中文头"。
- **信心评分**：8.5 / 10

### 🟡 P9 假冒 RTC 表面与原生差异过大：一条探针即可识别，且功能残缺

- **定位**：`spoof.js:180-396`
- **原生基线（Chromium 147 实测）**：实例自有属性 `[]`；原型 45 个可枚举成员；构造器 `length = 0`；`signalingState` 是原型 accessor；`createOffer` 返回 `RTCSessionDescription`；`getStats` 返回 `RTCStatsReport`。
- **伪造实测（Node vm）**：实例自有属性 21 个（`Object.getOwnPropertyNames(pc)` 全可见，`__config/__gathering/...`）；原型仅 18 个成员；构造器 `length = 1`；`createOffer()` 返回朴素 `Object`（原生为 `RTCSessionDescription`），`localDescription` 已是原生 `RTCSessionDescription`；`getStats()` 返回 `Map`。
- **其他差异**：`addTrack()` 返回 `{track:null}` 且 `getSenders()` 恒为 `[]`；`setRemoteDescription` 不更新 signalingState；`close()` 后定时器仍可能派发 candidate/connected；事件对象无 `isTrusted`。
- **危害**：`Object.getOwnPropertyNames(pc).length === 0` 或 `Object.keys(RTCPeerConnection.prototype).length === 45` 任一即可识别；依赖真实 RTC 的会议/直播站在国外站上功能异常。
- **修复**：对齐构造器 length、原型成员集合与 accessor 形态；用原生 `RTCSessionDescription`/`RTCStatsReport` 构造返回值；补齐 `restartIce/addTransceiver/canTrickleIceCandidates` 等；事件至少补 `isTrusted:true` 与 `target/currentTarget`。
- **信心评分**：9 / 10

### 🟡 P10 "国内页保持真实"并未做到：Function.toString 与 moz 全局残留

- **定位**：`spoof.js:37-47`（脚本顶层无条件替换 `Function.prototype.toString`）；`spoof.js:407-414`（无条件补 `mozRTCPeerConnection`）
- **事实证据**：
  - Chromium 原生：`Object.getOwnPropertyNames(Function.prototype.toString) = ['length','name']`；扩展后多出 `toString` 与 `__nativeFTS`（`maskToString` 与 `maskedFTS` 各写一次自有属性）。
  - Chromium 原生：`'mozRTCPeerConnection' in window === false`；扩展在非 disable 模式会写入该名。
  - 这两处与域名无关，`restoreLocale()` 也不还原 `Function.prototype.toString`。
- **危害**：用户核心诉求之一是"国内站不能被改动"。现在国内页虽时区语言真实，但 `Function.prototype.toString` 与 `mozRTCPeerConnection` 已非原生，仍可被检测；"国内站 100% 原样"的承诺不成立。
- **修复**：`Function.prototype.toString` 代理改为按需安装、国内页完整还原；`moz/webkit` 别名只在原生存在时同步，不要凭空创建；把"还原"做成一个完整的 `restoreAll()`（含全局函数、`permissions`、`moz` 别名）。
- **信心评分**：8.5 / 10

### 🟡 P11 `navigator.permissions.query` 被写成实例自有属性（所有页面可检测）

- **定位**：`spoof.js:551-556`（伪造路径）、`spoof.js:583-585`（还原路径也会写）
- **事实证据**：Chromium 原生 `navigator.permissions.hasOwnProperty('query') === false`、`Object.getOwnPropertyNames(navigator.permissions) === []`。代码直接给实例赋值，任意一条路径执行后都会产生自有属性（连原生函数也被挂成 own）。
- **危害**：所有页面（包括国内页）都多出一个原生不存在的自有属性，`Object.getOwnPropertyNames(navigator.permissions)` 一条即识别；还原路径的"还原"本身反而制造了指纹。
- **修复**：改 hook `Permissions.prototype.query`，保留原生描述符；还原时 `delete navigator.permissions.query` 并恢复原型。
- **信心评分**：8.5 / 10

### 🟡 P12 时区热路径性能退化 1600~3600 倍

- **定位**：`spoof.js:435-454`（每次调用新建 `Intl.DateTimeFormat` + `formatToParts`）、`spoof.js:491-498`（`toString` 同样每次新建）
- **事实证据**（Node 22 / ICU，20,000 次调用）：
  - 伪造 `getTimezoneOffset`：180–290 µs/次
  - 原生 `getTimezoneOffset`：0.06–0.11 µs/次
  - 比值 ≈ 1,600–3,600 倍
- **危害**：日期库、日志、表格排序在每次取时区时都构造 ICU 格式化器，国外站上出现明显卡顿；`toString` 同量级。
- **修复**：按 tz 缓存 `DateTimeFormat` 实例；offset 按"日期/小时桶"缓存，DST 边界失效；一次计算查表。
- **信心评分**：9 / 10

### 🟡 P13 popup 时区状态可静默丢失：自动匹配后保存会回退到洛杉矶

- **定位**：`popup.js:196-203`（动态 add option）、`popup.js:108`（load 直接 `value = cfg.tz`）、`popup.js:145-155`（save 读 select 值）
- **事实证据（代码推演，逻辑确定）**：`TIMEZONES` 预设不含 `Europe/Amsterdam`、`Europe/Warsaw` 等；自动匹配时会临时 `add` 一个 option 并保存成功。下次打开弹窗，`fillSelects()` 只填预设，`load()` 给一个不存在的 value → `selectedIndex = -1`，`value = ''`；用户点"保存"→ `cfg.tz = ''` → `spoof.js:595` 的 `cfg.tz || DEFAULTS.tz` 回退 `America/Los_Angeles`，而 `lang` 仍是 `nl-NL` → 时区/语言互相矛盾，用户无感知。
- **修复**：`load()` 时若 tz 不在列表则动态补 option；save 前校验 tz 非空且合法；或将时区改为 `input + datalist`。
- **信心评分**：9 / 10

### 🟡 P14 CN_DOMAINS 把中国公司的国际站当国内站

- **定位**：`spoof.js:52`（alibaba.com）、`spoof.js:65`（wechat.com）、`spoof.js:71-72`（mi.com/xiaomi.com/huawei.com/oppo.com/vivo.com/meizu.com/oneplus.com/realme.com）、`spoof.js:87`（meitu.com）
- **后果**：开着美国代理访问 `alibaba.com`、`xiaomi.com`、`huawei.com`、`oneplus.com` 等国际站时，被还原为上海时区 + `zh-CN`，与出口 IP 公开矛盾，等于主动向对方暴露"中国真实环境"。
- **修复**：增加"强制按国外处理"名单，或在 `pageIsChina()` 里对这批 eTLD+1 返回 false；更稳的做法是按响应 `Content-Language`/路径语言判定，而不是只看域名。
- **信心评分**：8 / 10（是否触发取决于用户访问习惯）

### 🟡 P15 现有测试不覆盖保护主链路

- **定位**：`tests/spoof_regression.test.js:46-74`
- **事实证据**：用例仅覆盖 A1（无效 this 不崩）与 A2（`toString` 无 undefined）；`node tests/spoof_regression.test.js` 全绿，`node --check` 四文件通过。
- **缺口**：没有 `restoreLocale`、`apply` 门控、postMessage 校验、iframe/Worker、时区自洽、DNR 规则构建、popup 状态持久化的测试。本次 5 条 🔴 均不会被发现。
- **修复**：增加表驱动用例：`getHours/getTimezoneOffset` 自洽、`Object.getOwnPropertyNames(pc)` 对照原生基线、伪造消息被拒、`__spoofNatives` 不存在、`.cn` header 规则、popup 预设外时区往返保存。
- **信心评分**：9 / 10

### 🟢 其他（不阻断，但应在同一轮清理）

1. `.中国` 分支不可达：Chrome 把主机名序列化为 punycode（实测 `new URL('https://example.中国').hostname === 'example.xn--fiqs8s'`），`host.endsWith('.中国')` 永不命中。
2. `Intl` 包装器 `Intl.DateTimeFormat.length` 变为 2（原生 0）；`Intl.DateTimeFormat.prototype.constructor !== Intl.DateTimeFormat`（原生实测为 `true`）。
3. `Navigator.prototype.language/geolocation` 重定义时漏了 `enumerable:true`（原生实测为 `true`）。
4. `new Date(NaN).getTimezoneOffset()` 返回 420（原生 `NaN`）；`getTimezoneOffset.call(null)` 返回数值而不抛 `TypeError`。
5. `webkitRTCPeerConnection` 原生存在、`mozRTCPeerConnection` 原生不存在，但代码对两者一视同仁地赋值。
6. 三份 `CN_DOMAINS`、两份 `DEFAULTS`、两份语言映射重复维护（本次实测三份一致：191/191、无重复，但存在漂移风险）。
7. README 第 18 行"WebRTC 在所有网站都保护"与 v3.9 起的分流行为矛盾（国内页走原生 RTC）。
8. `manifest.json` 缺 `minimum_chrome_version`；`world:MAIN` 需要 Chrome 111+。
9. `spoof.js` 624 行单个 IIFE 同时承载 RTC/时区/地理/通道，建议拆分为 `rtc.js`、`locale.js`、`geo.js`、`channel.js`（不影响运行，影响可维护性）。
10. Cloudflare 挑战域名被 `exclude_matches` 后完全裸奔（这是有意的取舍）；若将来 CF 改为跨帧比对时区，会重新出现不一致。当前用户已验证通过，不列为缺陷。

---

## 4. 五维核查矩阵

- **架构契约与安全红线**：🔴 见 P1/P2/P3。MAIN world 的"页面可访问并干扰"风险在 Chrome 官方文档中有明确警告，当前实现正面撞上。
- **端到端功能闭环**：🔴/🟡 见 P4（帧内无链路）、P7（首帧竞态）、P8（header 与 JS 不同源）。
- **对抗性 Bug / 并发 / 异常**：🟡 见 P11（还原反而制造指纹）、P12（性能）、P9（行为不完整）。
- **性能与代码复杂度**：🟡 P12（实测 1600–3600 倍）；单文件 624 行 < 700，函数圈复杂度未见超标。
- **领域专项（前端/隐私客户端）**：🟡 P5、P10、P13、P14。
- **已取证核查、未发现异常**：无硬编码密钥/Token，无 eval/远程脚本加载，无向第三方上传数据，popup 使用 `textContent` 无 HTML 注入，无破坏性文件操作。

---

## 5. 修复路线（按依赖顺序）

**P0（阻断项，必须先做，否则后续加固没有意义）**

1. **去全局化**：`natives`、`Fake`、`apply` 收回闭包；删除 `__spoofNatives/__fakeRTC/__applySpoofConfig`；`applyWebRTC('off')` 与 `restoreLocale` 只用闭包引用。
2. **换配置通道**：`chrome.scripting.registerContentScripts`（MAIN world、document_start、配置内联）；设置变更 unregister→register，并对已开标签补一次 `executeScript`。彻底移除 `window.postMessage({__spoofConfig})`。
3. **补齐帧覆盖**：`match_origin_as_fallback: true` + `match_about_blank: true`；`isLocalIntranet()` 空 host 改 fail-closed，按 `ancestorOrigins` 判定。
4. **时区语义收敛**：要么补齐 `get*/set*/to*` 与构造/parse 的统一换算层，要么在产品文案上明确降级，不再宣称"时区已伪装"。

**P1（高优，做完 P0 立刻做）**

5. RTC 表面对齐原生（构造器 length、原型成员、accessor、`RTCSessionDescription`/`RTCStatsReport`、事件 `isTrusted`）。
6. DNR 增加 `.cn` 正则规则与裸主机名规则；`.中国` 用 punycode 规则。
7. popup 时区预设外值持久化 + save 校验；`COUNTRY_LANG` 缺失时给出明确兜底并提示。
8. `getTimezoneOffset`/`toString` 缓存化，压到 µs 级。

**P2（同轮清理）**

9. `Function.prototype.toString` 仅境外页安装、国内页完整还原；`mozRTCPeerConnection` 仅在原生存在时同步。
10. `permissions.query` 改挂原型；还原时删除自有属性。
11. 更新 README/CHANGELOG 与实现一致；补 `minimum_chrome_version`；三份域名表合并为单一数据源（构建期生成为三份常量）。
12. 补齐回归测试（见 P15 清单）。

---

## 6. 修复后验收清单（可直接当回归脚本）

- [ ] `'__spoofNatives' in window === false`、`'__fakeRTC' in window === false`、`'__applySpoofConfig' in window === false`
- [ ] 页面监听 `message`，在正常浏览中收不到任何 `__spoofConfig` 消息
- [ ] `document.createElement('iframe')`（about:blank）与 `srcdoc` 帧内 `RTCPeerConnection` 为假冒对象；`new f.contentWindow.RTCPeerConnection()` 不产生 srflx 候选
- [ ] Worker 内 `new Date().getTimezoneOffset()` 与页面一致（若决定不支持，写进 README 已知限制）
- [ ] `getHours()` 与 `getTimezoneOffset()` 自洽；`toTimeString/toLocaleString` 不再泄露真实时区
- [ ] `new Date().toString()` 与同版本原生 Chromium 输出逐字符一致（含时区名与 locale）
- [ ] `Object.getOwnPropertyNames(pc)` 与原生基线一致（0 个实例自有属性）
- [ ] 未收录 `.cn` 站（如 `www.12306.cn`）请求头为中文
- [ ] 自动匹配 `Europe/Amsterdam` → 关闭再打开 popup → 直接保存，tz 仍为 Amsterdam
- [ ] `getTimezoneOffset` 1 万次调用 < 50 ms
- [ ] 国内页 `Object.getOwnPropertyNames(Function.prototype.toString)` 回到 `['length','name']`，`'mozRTCPeerConnection' in window === false`

---

## 7. 架构洞察

1. **"伪装输出"不是隐身，环境一致性才是。** 现在做的是"把几个读数改成美国"，但 `getHours`、`toTimeString`、`toLocaleString` 还在说上海话。检测方不需要破解 hook，只要让两个原生 API 互相对账就能识破。 stealth 系统的第一原则是**内部无矛盾**，而不是"关键指标达标"。
2. **MAIN world 里没有秘密。** Chrome 官方明确警告 MAIN world 脚本可被宿主页面访问和干扰。把 `natives`、`apply` 挂在 `window` 上，本质是把降级开关交给被保护对象。正确姿势是"闭包即边界"：能少暴露一个名字，就少一个被绕过的入口。
3. **隐私组件的默认值必须 fail-closed。** `isLocalIntranet()` 对空 hostname 返回 `true`（视为本地→还原真实），这是"判不出来就放行"的写法。隐私组件必须反过来：判不出来就伪装，宁可误伤可用性，不可误伤匿名性。

---

## 8. 审计证据索引（可复现）

| 证据 | 命令/方式 | 关键输出 |
|---|---|---|
| 三份域名表一致 | Node 正则抽取 + Set 对比 | 各 191、无重复、无差异 |
| Node 攻防复现 | `attack.js`（vm 加载 spoof.js，TZ=Asia/Shanghai） | offset 480、hours 14、toTimeString 上海、invalid offset 420、postMessage 降级成功 |
| 时区格式对照 | `verify.js`（TZ=America/Los_Angeles） | 原生 `(北美太平洋标准时间)` vs 伪造 `(PST)` |
| 原生 RTC 基线 | Chrome DevTools `evaluate_script` | 实例自有属性 0、原型 45 成员、length 0、stats `RTCStatsReport`、`localDescription` `RTCSessionDescription` |
| 伪造 RTC 基线 | Node vm | 实例自有属性 21、原型 19 own names、length 1 |
| 全局残留基线 | Chrome DevTools | `Function.prototype.toString` own names `['length','name']`；`navigator.permissions` own keys `[]`；`language` descriptor enumerable `true` |
| 帧注入语义 | Chrome 官方 content_scripts 文档 | `match_about_blank` 默认 false；`match_origin_as_fallback` 默认 false，覆盖 `about:/data:/blob:/filesystem:` |
| 性能 | Node 20k 次循环 | 180–290 µs vs 0.06–0.11 µs |
| 现有测试 | `node tests/spoof_regression.test.js`、`node --check` | PASS / 四文件语法 OK |

---

## 9. 修复后复验（v3.11 闭环，2026-11-13）

- **单测**：`spoof_regression` 31/31、`background` 6/6、`popup` 5/5（`TZ=Asia/Shanghai`，Node 22）。
- **真机 E2E**：Chrome 157 + CDP `Extensions.loadUnpacked`，`tests/e2e_chrome.js` **40/40**。
  - 国外页：语言/时区/DST/Date.toString/Intl、RTC 实例零自有属性、length=0、createOffer 返回 `RTCSessionDescription`、SDP 仅 mDNS、about:blank/srcdoc、Worker、定位、请求头全部通过。
  - 国内页 / 本地 IP：语言、时区保持真实，无国外痕迹，`.cn` 头为 zh-CN。
  - global 模式：国外/国内都按东京 + 日文头；还原后回到洛杉矶/真实。
- **架构修正**（真机硬约束，详见 `plan-全链路修复.md` 闭环结果）：动态注册只接受文件；不支持 `matchAboutBlank`（由 `matchOriginAsFallback` 覆盖 about:blank）；配置经一次性令牌从 `boot.js` 下发，boot 先向后台 `wds-gate` 确认本页是否需要伪装（split 下国内/本地不建通道），并按 100ms 重试直到收到 ack；`web_accessible_resources` 必需；DNR 同步串行化。
- **仍未覆盖的风险**：配置异步窗口（<1ms）；Worker 早于源码创建回退原生；Cloudflare 挑战域不注入（设计如此）。这些已写入 README 已知边界，不再声称"绝对无窗口"。
