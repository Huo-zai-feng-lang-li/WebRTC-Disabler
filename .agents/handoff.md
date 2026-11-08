# 最新接续状态 (2026-10-09 23:40)

## 核心进展
- 自研浏览器扩展 **WebRTC Disabler v3.9 已功能完整闭环并实测通过**，目录 `D:\Desktop\Super-File\浏览器扩展\WebRTC-Disabler\`，已加载进豆包自动化浏览器（扩展 ID `mdlnagjhelacmdpjlaamfijicnjmfmko`，重新"加载已解压"可能变）。
- 最新交付包：`D:\Desktop\Super-File\浏览器扩展\WebRTC-Disabler-v3.9.zip`（49.1KB，暂存目录打包，不含用户原图 1.png/2.png）。
- v3.9 实测（WebRTC 也按分流处理）：国外站 ipip.la → 假 RTC 仅 1 条 mDNS、洛杉矶/en-US；国内站 baidu → **真实原生 RTC（host+srflx 共 4 候选，通话可用）**、上海/zh-CN；本地 127.0.0.1 → 真实原生 RTC、上海/zh-CN。时区/语言/定位：国外伪装、国内与本地真实。`RTCPeerConnection.name` 与原型方法 `toString` 均为 `[native code]`；扩展无红色错误。

## 核心动机与背景 (Motivation & Background)
- 用户用 HTTP 代理 VPN `127.0.0.1:51081`（**不支持 UDP**、美国出口、**国内外分流**：国内站直连、国外站走代理）。ipip.la 检测经 WebRTC STUN 泄露真实公网 IPv4 `112.43.123.250`（新疆昌吉/五家渠，中国移动 AS9808）与 IPv6 `2409:8a7c:...`。
- 已验证的死路（勿重复）：WebRTC Network Limiter 在 HTTP 代理下拦不住 UDP 直连；Chrome/Edge 注册表 `WebRTCIPHandlingPolicy` 豆包浏览器不读；chrome://flags 无 WebRTC 项；CDP setWebRTCIPHandlingPolicy 在 Chromium 147 已移除；disable_non_proxied_udp 在 HTTP 代理下仍泄露。故自研 MV3 扩展。
- 关键诉求：浏览器不泄露真实 IP；时区/语言/定位与出口国一致；**国内外分流时代国内站不能被改成美国指纹**；单张清晰静态图标（摄像头+闭合挂锁，不要动态轮换）。

## 关键设计与实现 (Implementation & Decisions)
- manifest v3.9（MV3）：permissions=`storage`,`declarativeNetRequest`；host=`<all_urls>`；两条 content_script 均 document_start/all_frames：`spoof.js`(world MAIN) + `boot.js`(默认隔离世界)；background service_worker=`background.js`；单图标 icons/icon16|48|128.png（白摄像头+金锁）。
- **WebRTC（v3.9 起也按分流处理）**：spoof.js apply() 计算 effectiveRtc——split 下国内域名或本地内网强制 `off`（真实原生 RTC，视频/语音通话正常；这些站直连本就看到真实 IP，WebRTC 无新增泄露），国外站按存储的 webrtcMode；global 模式所有站点按 webrtcMode。FakeRTCPeerConnection 只产生一个 mDNS `.local` host 候选、零 srflx/STUN；三档 webrtcMode=spoof(推荐)/disable/off（弹窗标签已改"仅国外站生效"）。v3.7 加固：构造器 `name='RTCPeerConnection'`，构造器与 18 个原型方法 + generateCertificate 的 `toString` 均用原生引用 `Function.prototype.toString.call(nativeRef)` 输出 `[native code]`。原生对象只在 `window.__spoofNatives` 捕获一次（测试可用 `RTCPeerConnection===window.__spoofNatives.RTC` 区分真假）。
- **智能分流 mode=split(默认)/global**：三份脚本各有一份**完全相同的 CN_DOMAINS（191 个可注册域名，已校验一致、无重复）** + `.cn`/`.中国` TLD 判定，函数同名 `pageIsChina()`；v3.8 新增 `isLocalIntranet()`（私有 IPv4 10/172.16-31/192.168/127/169.254/0、IPv6 ::1/fe80::/10/fc00::/7、localhost、.local、无点裸主机名），子域与各 iframe 按自身域名独立判定。split 下国内域名或本地内网 `restoreLocale()` 还原真实时区/语言/Intl/地理定位（还原依赖首次捕获的 langDesc/langsDesc/geoDesc 与 Date.getTimezoneOffset/toString 描述符），国外域名 `spoofLocale()`；global 全部伪装。isLocalIntranet 已用 27 项单元测试覆盖。
- **配置通道**：boot.js 从 chrome.storage 读配置，按 mode+pageIsChina() 设 `cfg.localeMode='native'/'spoof'`，postMessage 下发给主世界 spoof.js（绕开严格 CSP，如 ipip.la）；storage.onChanged 实时重推，保存按钮另会 reload 当前 http/https 标签并 500ms 后 window.close() 关弹窗。
- **Accept-Language 头（background.js DNR 动态规则）**：split 时 priority3 的 23 条本地内网规则（私有 IP 段/localhost/.local urlFilter）设中文头，rule id2/priority2 对 requestDomains=191 国内域名设 `zh-CN,zh;q=0.9`，rule id1/priority1 对 `urlFilter:'*'` 设出口国语言头；共 25 条动态规则；global 仅保留 id1。onChanged 监听 lang 或 mode 重算。
- popup：应用范围下拉 id=mode、WebRTC 模式、时区(标签"国外站伪装值")、语言、经纬度；"按 IP 自动匹配"主用 https://ipwho.is/ 备用 http://ip-api.com/json/（split 下这些是国外域名，开代理时返回代理出口，正好校准国外伪装值）；"打开伪装检测页"。
- 时区伪装用原生 Intl.DateTimeFormat(longOffset) 现算偏移，自动夏令时；当前存储测试值 mode=split、webrtcMode=spoof、tz=America/Los_Angeles、lang=en-US、geo 34.0522/-118.2437。
- 检测结论：开美国代理综合伪装约 96%（机房 IP -8 需住宅代理、Cookie -10 需一号一浏览器配置，扩展无法解决）；硬件层 Canvas/WebGL/音频/字体本就 100% 正常，决定不 hook（易破坏验证码、伪造值反成新指纹）。

## 待办事项 (Next Steps)
- [x] **IPv6 已在 WLAN 网卡禁用（2026-10-09 完成并验证）**：执行 `Disable-NetAdapterBinding -Name "WLAN" -ComponentID ms_tcpip6`。验证：Enabled=False、WLAN 无全局 v6 地址（原 2409:8a7c:638:6ee0:: 两个已消失）、无 v6 默认路由、`curl -6` 失败；代理 IPv4 出口仍洛杉矶 154.19.243.9、国内百度直连正常。**恢复命令**：`Enable-NetAdapterBinding -Name "WLAN" -ComponentID ms_tcpip6`。只禁用了 WLAN（当前唯一联网网卡），改用以太网/其他网络需对该网卡再禁用；注册表 DisabledComponents=0x20 仍保留（无害）。
- [x] **浏览器旁路已处理（2026-10-09）**：豆包"使用安全 DNS(DoH)"实测本就关闭（#secureDnsToggle checked=false）；`chrome://flags/#enable-quic` 已设 **Disabled 并持久化，完全重启浏览器后生效**。
- [x] **DNS 泄露复测（2026-10-09）**：开代理 ipip.la/dns.html 出口洛杉矶 154.19.243.9，DNS 区"未探测到 DNS 服务器"、无任何中国运营商解析器（国外域名由 dotsvpn 代理端远程解析/FakeIP，本地不可见，未泄露）。
- [ ] 若用户反馈某国内 .com 站仍显示英文/国外时区：把该可注册域名同时加进 `spoof.js`、`boot.js`、`background.js` 三份 CN_DOMAINS（必须三处同步），node --check 校验→chrome://extensions 点 dev-reload-button（多层 Shadow DOM，需全树递归找 id 含 reload 的 CR-ICON-BUTTON）→目标站强刷验证→升版本号→重新打包。
- [ ] **EXE/系统级 DNS 残留限制（非扩展能解决）**：点点加速器 dotsvpn 仅本地 HTTP 代理（127.0.0.1:51081，一键开关、自动分流，无 TUN/远程DNS 设置入口；TAP-Windows Adapter V9 已装但未连接）。不走浏览器/系统代理的 EXE 仍可能直连；要全覆盖需换支持 TUN 的客户端（Clash/Mihomo/sing-box 等）。

## 关键上下文
- 目录: `D:\Desktop\Super-File\浏览器扩展\WebRTC-Disabler\`（桌面真实路径 `D:\Desktop\Desktop`，非 C:\Users\...\Desktop）
- 主要文件: manifest.json(v3.9)、spoof.js(CN_DOMAINS+pageIsChina+isLocalIntranet+buildFakeRTC/applyWebRTC(按分流选真假)+spoofLocale/restoreLocale)、boot.js(相同 CN_DOMAINS+isLocalIntranet+postMessage 下发)、background.js(相同 CN_DOMAINS+DNR 本地23条+id2国内+id1国外)、popup.html/css/js(WebRTC 下拉标注"仅国外站")、使用说明.txt(v3.9)、icons/icon16|48|128.png；icons/1.png、2.png 为用户原图，**未被引用、保留勿删**。
- 历史交付 zip（同目录）：v3.9(最新,WebRTC 也分流)/v3.8(本地内网还原)/v3.7(WebRTC原生级加固)/v3.6(修 deepseek 等国内.com)/v3.5(智能分流+单图标)/v3.3/v3.2/v3.1。
- 检测页：https://ipip.la/disguise.html（综合）、https://ipip.la/webrtc.html（WebRTC 专项）。
- 浏览器：豆包 147（Chromium），D:\Doubao\app\Doubao.exe，自动化 profile_explorer；bu.navigate 允许 chrome:// 与 chrome-extension://，bu.new_tab 拒扩展协议；扩展管理页为多层 Shadow DOM。
- 环境：Windows pwsh 7（禁 Bash 语法、复杂文本走临时脚本、中文 ps1 用 pwsh -NoProfile -File）；代理客户端=**点点加速器 dotsvpn**（`C:\Program Files (x86)\dotsvpn\dotsvpn.exe`，PID 11644），仅本地 HTTP 代理 127.0.0.1:51081（不支持 UDP、自动国内外分流、一键开关无 TUN 入口）；出口曾见 154.19.243.9/149.104.139.142（AS8796 FASTNET 洛杉矶）。真实 IPv4=112.43.123.250（新疆移动 AS9808）；WLAN IPv4 DNS=192.168.1.1。**WLAN 的 IPv6 已于 2026-10-09 禁用**；浏览器 DoH 关、QUIC flag Disabled（重启生效）。用户简体中文、要极简交付与官方证据/信心评分；人在中国，系统真实时区 Asia/Shanghai(UTC+8)。
- 已知限制（非 bug）：未收录的小众国内 .com 在 split 下暂按国外处理（.cn 全自动覆盖，WebRTC 仍保护）；无代理直连国外站会显示美国指纹与中国 IP 不符（本应开代理）；高级检测若用 Function.prototype.toString.call(fn) 显式调用仍可绕过方法级 toString 伪装，再深入需代理全局 Function.toString，风险大于收益，未做。
