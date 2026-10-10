# Chrome Locale SG

轻量的 Chrome Manifest V3 本地扩展，让普通网页优先使用**新加坡中文**。纯 JavaScript / HTML / CSS，无依赖、无遥测、无远程代码。

**当前版本：0.2.0。默认开启、默认所有 HTTP / HTTPS 网站、浏览器启动后自动生效。**

```text
navigator.language                     zh-SG
navigator.languages                    ["zh-SG", "en-US"]
Intl.DateTimeFormat 默认 Locale        zh-SG
Intl.NumberFormat 默认 Locale          zh-SG
Accept-Language                        zh-SG,en-US;q=0.9
时区                                   系统原生值（例如 Asia/Singapore）
```

不改系统语言、Chrome 用户配置、GPS、User-Agent、字体或时区；正式扩展不含 `debugger` 权限，不使用 CDP、远程调试端口、Puppeteer 或 Playwright。

## 安装：每个 Chrome Profile 各加载一次

1. 下载 Release 附件 **`Chrome-Locale-SG-v0.2.0.zip`**，解压到长期保留的目录。
2. 切换到想使用的 Chrome Profile，在地址栏打开 `chrome://extensions`。
3. 开启“开发者模式”，点击“加载已解压的扩展程序”，选择解压后的 **`extension` 文件夹**。
4. 确认扩展启用。**无需逐站点击授权**：新安装默认申请并使用所有 HTTP / HTTPS 网站访问权。
5. 在工具栏扩展菜单中，将 Chrome Locale SG **固定到工具栏**，才能随时看见状态灯。
6. 已经打开的旧网页刷新一次；之后新网页和浏览器重启后的正常导航自动生效。

“开发者模式”不等于“某扩展已开始调试浏览器”。本扩展没有调试接口，不隐藏任何 Chrome 警告。

**另一份 Profile：**切换到该 Profile，再做一次加载。可以在同一电脑的多个 Profile 中选择同一个 `extension` 文件夹；每份 Profile 的开关和自定义设置独立保存。

**另一台电脑：**下载相同 Release ZIP、解压、加载。日常使用不需要 Node、Python 或测试浏览器，也没有写死某台机器的路径。代码和包可用于常规桌面 Chrome；本次实际验收平台为 macOS，其他操作系统未逐一实测。

**不要把 GitHub 发布等同于 Chrome 商店发布：**GitHub 是源码和安装包的下载处，不会让 macOS / Windows Chrome 自动从 GitHub 安装、同步或更新扩展。此版本需要每个 Profile 各加载一次；以后更新时替换文件并在扩展管理页点“重新加载”。若需要商店式的一键安装和自动更新，应另行发布到 Chrome Web Store。

> 不要移动或删除正在被 Chrome 加载的 `extension` 目录。可把新包内容覆盖到这个固定目录，再在每份 Profile 中重新加载扩展。

## 图标：看当前网页是否真正生效

SG 图标右上角有状态灯，工具栏角标和悬停提示同步变化：

| 显示 | 含义 |
|---|---|
| 绿灯「开」 | 当前顶层网页的语言和两个 Intl Locale 已核对，请求头规则已注册 |
| 灰灯「关」 | 总开关已关闭 |
| 灰灯「—」 | 当前网站被排除，或属于 Chrome 受限页面 |
| 黄灯「…」 | 网页正在加载、等待注入或尚未检测 |
| 黄灯「权」 | Chrome 限制了当前网站访问权限 |
| 红灯「!」 | 配置同步失败，或当前网页实测值与目标不一致 |

不会仅因为“总开关为开”就把所有网页涂绿。标签切换、导航完成、配置改变、文档同步及 Popup“重新检测”都会更新状态；不用轮询或常驻进程。

**状态代表最近一次检测，不是持续监控网页每个函数。**页面稍后自行改写接口时，需要再点击“重新检测”。“已注册请求头规则”也不冒充“服务器已收到该请求头”；真实请求头请用本地验收页核对。MV3 后台休眠是正常省电行为，不代表扩展没有运行。

## Popup 设置

- 总开关即时保存，同时更新内容脚本、请求头规则和图标。
- 首选语言、后备语言、启用/排除网站通过“保存并应用”提交。
- **启用网站留空＝所有普通网站**；排除网站留空＝不额外排除。
- 网站每行一个域名，包含其子域名；不接受路径、端口或查询参数。IP 和 `localhost` 使用精确主机匹配。
- 每个 iframe 按它自己的域名匹配，而不是继承顶层页面的排除状态。
- 后备语言逗号分隔，可留空，最多 8 个；标签自动正规化、去重。
- “恢复网站访问”按钮仅用于 Chrome 把权限改成“点击时”等限制后的恢复。正常全站安装不用操作。
- 下半部分从当前网页 MAIN 世界读取实时值，不把设置框当检测结果。
- 保存后建议刷新。已创建的 Intl 实例、缓存字符串和已经发出的请求无法倒带。

### 从 0.1.x 升级

- 旧默认组合 `zh-SG / zh-CN / en-US` 自动迁移为 `zh-SG / en-US`。
- 保留旧总开关、启用/排除范围；用户自定义语言不被覆盖。
- 迁移只做一次；升级后主动设置三语言组合，不会在下次启动又被改掉。
- 新版本把全站访问从可选改为安装权限。Chrome 可能暂停更新后的扩展，要求用户确认增加的权限；先确认启用，再刷新网页。

## 自动启动的实现与边界

默认组合使用持久化的 MAIN 世界 `document_start` 内容脚本；注册已可用时，在文档最早阶段同步设置语言。动态内容脚本登记 `persistAcrossSessions: true`，DNR 动态请求头规则也持久化；浏览器启动时后台检查并协调保存的状态，无需反复开 Popup。

启动时还会主动同步已打开的网页，导航完成时补同步可能早于扩展注册加载的文档，不需要手工打开 Popup，也不会擅自刷新导致表单丢失。

**已知启动竞态：**测试中，使用命令行临时加载扩展时，浏览器启动的第一个网页可能比扩展更早执行，第一段脚本和第一笔主文档请求仍用原始语言。随后可以自动补同步，但不能倒改已经发出的请求。这一项单独记为限制，**不承诺浏览器启动的第一个请求绝对已经改好**；持久化安装与所有恢复标签情境仍需逐环境核验。

**新装后第一次、扩展升级后或用户重新授予权限后，已存在的页面建议刷新一次。**其他情况下无需手工触发；但 `chrome://newtab` 内部页面不是普通网站，不在覆盖范围。

### 自定义语言的早期窗口

默认 `zh-SG / en-US` 是打包好的同步预设。改成其他组合后，MAIN 脚本不能同步读取扩展 storage，因此需要异步下发配置，**网页第一个脚本可能暂时读到原始值**。这已在真实浏览器测试中观察到，不宣称自定义组合也能完全抢在所有网页脚本之前。

不使用同步网络请求、跨站 cookie、动态远程代码或大量编码脚本绕开这个限制。

## Intl 与网站兼容性

只在调用省略 Locale 或显式传入 `undefined` 时补首选语言。`en-US`、`ja-JP`、语言列表、`Intl.Locale`、Unicode 扩展和 options 原样透传；显式时区照常保留。

用原生构造函数的 Proxy 处理默认参数，保留原型、静态方法、`name`、`length`、`instanceof`、子类和原生异常。Navigator 只修改可安全替换的原型 getter，保留描述符与非法接收者检查，不强改不可配置属性或页面自有属性。

涵盖浏览器已提供的 DateTimeFormat、NumberFormat、Collator、PluralRules、RelativeTimeFormat、ListFormat、DisplayNames、Segmenter、DurationFormat；不存在的 API 不创建假接口。不同 API 的 ICU 数据可能把某些语言回退到近似标签，不伪造 `resolvedOptions()`。

### 仍可能暴露原始环境

- Worker / Worklet 的 JavaScript 语言与 Locale；不侵入 Worker 构造函数。
- `Intl.X([])`、空列表/任意对象、`Intl.X.prototype.constructor`、提前缓存的原生函数。
- Date / Number / BigInt / String 的原生 `toLocaleString` 等入口，不保证经过被包装的 Intl 属性。
- `instance.constructor === Intl.X` 等函数身份检查：本方案是兼容性包装，不是无痕原生 Locale 切换。
- Chrome 内部页面、网上应用店、PDF 浏览器、其他扩展页面、文件 URL。
- 未获授权的跨域 frame、不透明来源、特殊 sandbox、创建者/导航来源复杂的 blank/blob/data frame。
- 网站账号、cookie、HTML `lang`、浏览器菜单、翻译 UI、字体、拼写检查和服务器自行选择的语言。

普通同源与已授权跨源 iframe 已实测；`allFrames` 和 `matchOriginAsFallback` 只能在 Chrome 允许的范围内覆盖。特定 srcdoc / sandbox / blank 测试的成功，不代表所有组合都可靠。BFCache 有 pageshow 同步处理，但未穷尽所有预渲染、恢复标签和缓存策略。

## 权限、隐私与冲突

正式版四项 API 权限：`storage`、`scripting`、`activeTab`、`declarativeNetRequestWithHostAccess`；网站权限为 `http://*/*`、`https://*/*`，用于默认全站注入和请求头一致。图标使用 Chrome Action API，不增加额外权限。

不申请 debugger、webRequest、geolocation、management 等权限；使用本机 `storage.local`，不做跨设备设置同步；不采集、上传或保存浏览历史，不请求外部服务器。扩展页面 CSP 为 `connect-src 'none'`，没有远程代码或网页公开资源。

默认对所有普通网站改语言会影响网站的语言协商，这是预期功能。网站不兼容时，加入排除名单再刷新。

配置保存把规则、注册和页面更新串行协调；失败尝试回滚并显示错误。Chrome 没有跨 storage / DNR / 注册 / 所有页面的原子事务，保存瞬间可能短暂交错，保存成功后刷新是完整生效边界。

不依赖 QA Settings 或 Locale Switcher。独立验证时关闭其他语言/请求头修改扩展。发现接口被第三方改写会提示，不强行覆盖第三方；无法识别所有先于本扩展的补丁。

## 测试与打包

开发/验收需要 Node.js 22+；**安装使用扩展不需要 Node**。零第三方依赖，无需 `npm install`。

```sh
npm test
npm run check
npm run package
```

`package` 跨平台生成：

- `dist/Chrome-Locale-SG-v0.2.0.zip`：只含正式 extension 文件夹。
- `dist/SHA256SUMS.txt`：安装包校验值。
- `dist/FILES-SHA256SUMS.txt`：正式文件逐项校验值。

### 本机手动验收

```sh
npm run test:browser
```

打开打印的 loopback 地址，页面显示**第一个 inline 脚本**读到的值，以及本地服务器真正收到的主文档/fetch `Accept-Language`。只访问本机。停止测试服务按 Ctrl+C，正式扩展不依赖它运行。

验收顺序：默认两语言 → 两个 Locale → 服务器请求头 → 原生时区 → 图标绿灯 → 关闭并刷新及灰灯 → 再开启 → 排除网站 → 新普通标签 → 完整退出并重启 → 显式 en-US/ja-JP 仍保留。先保存工作再退出自己的浏览器。

### 独立真实浏览器回归（无 CDP）

下载官方 Chrome for Testing 完整浏览器，然后运行：

```sh
npm run test:browser -- --chrome "/你的目录/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
```

测试工具使用独立临时 profile，不改日常 Chrome。正常回归保持正式版的全站网站权限，只额外加入测试入口和本机结果回报；没有 CDP、Puppeteer/Playwright 或隐藏提示参数。

四轮启动覆盖自定义、默认和关闭状态的三次完整重启，并直接检查**浏览器启动参数打开的第一个页面**的自动补同步、首段脚本与请求头；最早读值存在竞态时标为 limitation，而不是成功。记录实际版本、状态灯、请求头、逐项结果到本地 `test-results/browser.json`。原始记录含本机路径，不进入发布源码；公开摘要见 `docs/验收记录.md`。

`--headless` 可用于无头测试，但不能替代真实工具栏的目视验收。正式品牌 Chrome 用界面“加载已解压”，不要依赖它支持测试用命令行扩展加载。

### 调试能力研究不属于正式功能

正式版没有调试模式。此前隔离探测显示原生 `Emulation.setLocaleOverride` 可以改善 `toLocaleString`、空 Locale 列表和部分 Worker Intl，但 Navigator 仍需另行处理，接口实验性、可信客户端限制与进程范围需要逐版本核对。

如明确愿意进行调试研究，可给上面的独立测试命令加 `--debugger-probe`；这仅在测试副本增加 debugger 权限。它不等于一个已验收的全自动调试增强版，也不承诺无提示条。

## 恢复原始浏览器状态

在 Popup 关闭，或在 `chrome://extensions` 禁用/移除扩展，再刷新所有受影响页面；必要时保存工作后完整退出 Chrome。Chrome 停用扩展不会自动撤销旧文档里已经改过的 JavaScript 对象。

移除会清理扩展自身配置、规则和注册，无需改系统或 Profile 文件。这只撤销本扩展的影响，不撤销安装前自行修改过的系统/浏览器设置。

## 文件组织

```text
extension/   manifest、内容脚本、后台、中文 Popup、状态图标
  lib/       设置/迁移、DNR 规则、状态协调、图标状态
 tests/      Node 单测、浏览器测试夹具
 tools/      审计、图标生成、跨平台打包、本机验收、发布材料准备
 docs/       不含本机路径的验收摘要
```

请求头规则由 `extension/lib/rules.js` 生成持久化动态规则，没有另留始终开启的静态规则文件，避免总开关失效。

## 官方依据

核对日期：2026-10-10。最低 API 版本 Chrome 119，实际测试版本见验收记录；不把 API 文档支持当成所有版本都实测通过。

- [内容脚本与运行时机](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Scripting：MAIN、documentId、持久化注册](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [DNR：请求头修改与动态规则](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
- [Action：图标、角标和标签页状态](https://developer.chrome.com/docs/extensions/reference/api/action)
- [权限请求与被限制的网站访问](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Chrome 扩展分发方式与限制](https://developer.chrome.com/docs/extensions/how-to/distribute)
- [ECMA-402：原生 Intl 语义](https://tc39.es/ecma402/)
- [官方 Chrome for Testing](https://developer.chrome.com/docs/automation-and-testing/chrome-for-testing)
