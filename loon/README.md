# Loon

存放 Loon 使用的分流规则、插件、脚本和配置片段。

## 子目录

- `configs/`: Loon 配置片段或完整配置。
- `plugins/`: `.plugin` 插件文件。
- `rules/`: 分流规则列表。
- `scripts/`: 插件或重写规则引用的脚本。

## 文件建议

- 插件使用 `.plugin` 后缀。
- 规则文件可按实际格式使用 `.list`、`.conf` 或 `.txt`。
- 脚本按语言使用 `.js` 等后缀。

## 已收录插件

当前插件使用新版 Script 语法，需要 **Loon 3.5.1（983）或更新版本**；安装或更新插件前请先升级 Loon。

- `plugins/youtube-enhance.plugin`: YouTube / YouTube Music 去广告与播放增强插件；原作者为 [Maasea](https://github.com/Maasea)，基于 [Maasea/sgmodule](https://github.com/Maasea/sgmodule) 的模块及脚本适配，使用仓库内的 Loon 专用 `scripts/youtube.request.js` 中继 InitPlayback Worker 响应，遵循 Apache-2.0 许可。
- `plugins/youtube.plugin`: YouTube 与 YouTube Music 去广告及播放增强插件，作者为 [KnowSky404](https://github.com/KnowSky404)；当前版本仅适配 YouTube Music，YouTube 支持尚未实现。可通过远程链接直接安装，运行脚本全部托管于本项目，不调用第三方 Worker 或上游远程脚本。广告过滤、后台播放和画中画固定开启，仅向用户提供 Music 选段、升级入口及调试开关；不要与 `youtube-enhance.plugin` 同时启用。

## 已收录脚本

- `scripts/youtube.request.js`: Loon 专用 YouTube 请求脚本。原始逻辑及实现来源为 [Maasea/sgmodule](https://github.com/Maasea/sgmodule/blob/master/Script/Youtube/youtube.request.js)，本仓库将跨域 URL 重写改为 Loon `$httpClient` 二进制请求与响应中继；修改说明见 `scripts/youtube.request.NOTICE`，许可全文见 `scripts/LICENSE-APACHE-2.0`。
- `scripts/youtube/request.js`: YouTube 请求脚本；当前仅处理 YouTube Music，在设备内拒绝带广告标记的 InitPlayback 响应并触发 App 自身的 Player/GetWatch 回退，不访问第三方 Worker。
- `scripts/youtube/response.js`: YouTube 响应脚本；当前仅处理 YouTube Music，在设备内处理 Player/GetWatch 和 Guide protobuf，固定移除播放器广告字段并启用后台播放与画中画，同时提供 Music 选段和升级入口开关。

## Rewrite / Script 语法

- 按 [Loon 新版 Script 文档](https://nsloon.app/docs/Script/script_v2/) 使用 `request/response if ... then script(...) with ...`。URL 正则显式保留 `i` 标志，以延续旧配置忽略大小写的匹配行为；Body 属性使用 `requires_body`、`binary_body_mode`。
- 插件参数使用 `script("路径", {${参数名}})` 传入，脚本仍收到包含原参数名及类型的 `$argument` 对象。迁移保留原有匹配顺序、脚本地址、60 秒超时和开关默认值，JavaScript 业务逻辑不变；兼容插件 `youtube-enhance.plugin` 也仅更新配置语法与最低版本。
- 当前仓库尚无独立 `[Rewrite]` 条目。后续新增时遵循 [Loon 新版 Rewrite 文档](https://nsloon.app/docs/Rewrite/rewrite_v2/)，使用 `request/response if ... then ...`；该语法从 3.5.1（978）起支持。不要将这些 Loon 配置语法用于 Quantumult X。
- 本地回归验证：在仓库根目录运行 `bun test tests/loon`。测试检查配置约束和模拟脚本行为，不能替代 Loon 真机导入及播放验证。

## 已收录规则

- `rules/binance.list`: Binance App 分流规则，基于 iOS App 抓包整理。
- `rules/bitget-wallet.list`: Bitget Wallet App 分流规则，基于 iOS App Loon 抓包整理。
- `rules/bybit.list`: Bybit App 分流规则，基于 iOS App Loon 抓包整理。
- `rules/ur.list`: UR App 分流规则，基于 iOS App Loon 抓包整理。
- `rules/wise.list`: Wise App 分流规则，基于 iOS App Loon 抓包整理。
