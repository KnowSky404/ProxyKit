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

- `plugins/youtube-enhance.plugin`: YouTube / YouTube Music 去广告与播放增强插件；原作者为 [Maasea](https://github.com/Maasea)，基于 [Maasea/sgmodule](https://github.com/Maasea/sgmodule) 的模块及脚本适配，使用仓库内的 Loon 专用 `scripts/youtube.request.js` 中继 InitPlayback Worker 响应，遵循 Apache-2.0 许可。

## 已收录脚本

- `scripts/youtube.request.js`: Loon 专用 YouTube 请求脚本。原始逻辑及实现来源为 [Maasea/sgmodule](https://github.com/Maasea/sgmodule/blob/master/Script/Youtube/youtube.request.js)，本仓库将跨域 URL 重写改为 Loon `$httpClient` 二进制请求与响应中继；修改说明见 `scripts/youtube.request.NOTICE`，许可全文见 `scripts/LICENSE-APACHE-2.0`。

## 已收录规则

- `rules/binance.list`: Binance App 分流规则，基于 iOS App 抓包整理。
- `rules/bitget-wallet.list`: Bitget Wallet App 分流规则，基于 iOS App Loon 抓包整理。
- `rules/bybit.list`: Bybit App 分流规则，基于 iOS App Loon 抓包整理。
- `rules/ur.list`: UR App 分流规则，基于 iOS App Loon 抓包整理。
- `rules/wise.list`: Wise App 分流规则，基于 iOS App Loon 抓包整理。
