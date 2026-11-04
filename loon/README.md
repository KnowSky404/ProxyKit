# Loon

存放 Loon 使用的分流规则、插件、脚本和配置片段。

## 子目录

- `configs/`: Loon 配置片段或完整配置。
- `plugins/`: `.plugin` 插件文件。
- `rules/`: 由 `shared/rules/*.yaml` 自动生成的分流规则列表。
- `scripts/`: 插件或重写规则引用的脚本。

## 文件建议

- 插件使用 `.plugin` 后缀。
- 当前生成规则固定使用 `.list` 后缀，原公开路径保持不变。
- 脚本按语言使用 `.js` 等后缀。

## 已收录插件

YouTube 插件使用新版 Script 语法，需要 **Loon 3.5.1（983）或更新版本**；SideStore 插件需要 **Loon 3.5.3（1007）或更新版本**。安装或更新插件前请检查版本与 Build。

- `plugins/youtube-enhance.plugin`: YouTube / YouTube Music 去广告与播放增强插件；原作者为 [Maasea](https://github.com/Maasea)，基于 [Maasea/sgmodule](https://github.com/Maasea/sgmodule) 的模块及脚本适配，使用仓库内的 Loon 专用 `scripts/youtube.request.js` 中继 InitPlayback Worker 响应，遵循 Apache-2.0 许可。
- `plugins/youtube.plugin`: YouTube 与 YouTube Music 去广告及播放增强插件，作者为 [KnowSky404](https://github.com/KnowSky404)；当前版本仅适配 YouTube Music，YouTube 支持尚未实现。可通过远程链接直接安装，运行脚本全部托管于本项目，不调用第三方 Worker 或上游远程脚本。广告过滤、后台播放和画中画固定开启，仅向用户提供 Music 选段、升级入口及调试开关；不要与 `youtube-enhance.plugin` 同时启用。
- [`plugins/sidestore.plugin`](plugins/sidestore.plugin): SideStore 本机回环插件，作者为 [KnowSky404](https://github.com/KnowSky404)；使用 Loon 的 `include-tun` 和 `[IP Rewrite]` 替代 SideStore 访问 `10.7.0.1` 时所需的 LocalDevVPN 回环功能。无需脚本或 MITM，当前已核对官方配置，尚未完成真机续签验证。

### SideStore：替代 LocalDevVPN

参考 [Luke 的博客](https://bssn520.github.io/p/22/)，配置语法与最低版本以 [Loon 官方插件文档](https://nsloon.app/docs/Plugin/#ip-rewrite)、[通用配置文档](https://nsloon.app/docs/General/#include-tun)及 [3.5.3（1007）官方发布示例](https://t.me/s/loonnews?q=1007)为依据。本插件仅适配 Loon，目标为 SideStore 使用默认地址 `10.7.0.1` 的本机连接。

1. 确认 Loon 为 **3.5.3（1007）或更新版本**；仅版本号为 3.5.3、Build 低于 1007 时仍不支持。SideStore 应已完成安装、设备配对和账号设置。
2. 在 Loon 的插件页面导入 [`sidestore.plugin`](plugins/sidestore.plugin) 并启用。文件发布到 GitHub `main` 分支后，也可添加[远程插件链接](https://raw.githubusercontent.com/KnowSky404/ProxyKit/main/loon/plugins/sidestore.plugin)。
3. 关闭 LocalDevVPN 或旧的 SideStore WireGuard 隧道及其自动连接，断开再连接一次 Loon VPN，让包含路由生效。刷新时保持 Loon VPN 连接。
4. 打开 SideStore，检查 Device Reachability，再手动刷新一个 App；实际刷新成功后，再配置快捷指令定时运行 SideStore 的刷新操作。插件本身不执行续签。

插件中的核心配置如下；请保留在 `.plugin` 文件内导入，主配置不支持 `[IP Rewrite]`：

```ini
[General]
include-tun = 10.7.0.1/32
ipv6-vif = off

[IP Rewrite]
10.7.0.1 = reflect
```

`include-tun` 将单个 IPv4 地址纳入 TUN，与原有包含路由合并；`reflect` 对命中的数据包交换源、目的 IP 并回注本机，端口与载荷保持原样，先于分流规则、HTTP Rewrite、脚本和 MITM 执行，因此无需添加 `DIRECT` 规则。该插件沿用官方示例关闭 IPv6 VIF，**影响整个 Loon TUN 的 IPv6 虚拟接口**；关闭插件并重连后，若其他插件没有声明 `off`，则恢复主配置中的模式。这不等于关闭系统全部 IPv6，也不修改 `ip-mode`。

若设备仍不可达，先检查 Build、插件启用状态和 VPN 是否已重连，再检查是否有更靠前的插件对 `10.7.0.1` 声明了其他 IP Rewrite 动作。按当前官方文档，`include-tun = 10.7.0.1/32` 优先于相同的 `bypass-tun` 条目，也比 `10.0.0.0/8` 更具体，无需为此删除整个私网绕过配置。若 SideStore 使用自定义目标地址，本插件的默认配置不适用，需按实际目标同时调整包含路由与回环地址。

本插件只提供本机回环；设备配对、Apple 账号和 Anisette 服务仍由 SideStore 管理，具体安装前置条件及故障排查参见 [SideStore 官方文档](https://docs.sidestore.io/docs/installation/install)。本地检查不能替代 iPhone / iPad 上的导入、可达性及实际刷新验证，当前不声明已经完成真机验证。

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

以下 `.list` 由共享 YAML 生成，禁止直接编辑。新增、修改或删除规则时，同时生成 Loon、Quantumult X 和 sing-box 产物并维护三个 README 索引；命令见 [rulegen](../tools/rulegen/README.md)。Loon 的 `no-resolve` 继续保留，跨客户端差异见 [规则格式](../docs/rule-format.md)。插件与脚本不由规则生成器管理。

- `rules/binance.list`: Binance App 分流规则，基于 iOS App 抓包整理。
- `rules/bitget-wallet.list`: Bitget Wallet App 分流规则，基于 iOS App Loon 抓包整理。
- `rules/bybit.list`: Bybit App 分流规则，基于 iOS App Loon 抓包整理。
- [`rules/telegram.list`](rules/telegram.list): Telegram 官方服务域名及 IPv4/IPv6 网段，包含 Telegraph、Telescope 与 Desktop 更新；[范围和引用说明](../shared/README.md#telegram)。
- `rules/ur.list`: UR App 分流规则，基于 iOS App Loon 抓包整理。
- [`rules/wechat.list`](rules/wechat.list): 微信 / WeChat 分流规则，迁自手工维护的 sing-box 配置；保留共享腾讯端点及整个 `43.160.0.0/12` 网段，策略由订阅配置绑定。私网直连仍由主配置单独管理，迁移边界见 [WeChat 说明](../sing-box/README.md#wechat-迁移说明)。
- `rules/wise.list`: Wise App 分流规则，基于 iOS App Loon 抓包整理。
