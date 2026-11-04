# Shared

`rules/*.yaml` 是公开规则的唯一维护源，包含来源、更新时间、分组、注释、禁用候选项及明确的兼容策略。由 [rulegen](../tools/rulegen/README.md) 生成：

- `loon/rules/*.list`
- `quantumultx/filters/*.list`
- `sing-box/rules/*.json`、`*.srs`

当前规则组为 `binance`、`bitget-wallet`、`bybit`、`telegram`、`ur`、`wechat` 和 `wise`。不要分别维护多份规则，也不要直接编辑生成文件。格式、校验与 `no-resolve` 限制见 [规则格式](../docs/rule-format.md)。

`shared/scripts/` 保留给确实可跨客户端复用的脚本源码；客户端 API 专属脚本留在原目录。第三方来源和许可信息必须保留。私人域名、VPS IP、Token、原始抓包不得放入本目录；私有生成任务在私人仓库独立执行。

## Telegram

`rules/telegram.yaml` 包含 7 条域名后缀、9 条 IPv4 CIDR 和 5 条 IPv6 CIDR。网段完整保留 [Telegram 官方清单](https://core.telegram.org/resources/cidr.txt)（2026-11-04 核对）的集合和顺序；域名来源为[官方链接文档](https://core.telegram.org/api/links)、[Desktop 下载页](https://desktop.telegram.org)、[Telegraph 公告](https://telegram.org/blog/instant-view)和 [Telescope 公告](https://telegram.org/blog/video-messages-and-telescope)。后缀包含根域及所有子域，覆盖网页、API、链接、Desktop 更新和这两个附属服务。

规则只定义匹配集合；请选择本机已有的代理策略，并放在可能提前命中的宽泛直连规则之前。第三方 Mini App、外部网页/媒体、共享推送服务以及任意点对点通话地址不由此集合完整覆盖。静态规则不会自动跟随官方网段变化，也未完成 Loon/QX 真机业务验证。

订阅入口：

- [Loon](https://raw.githubusercontent.com/KnowSky404/ProxyKit/main/loon/rules/telegram.list)：导入远程规则后绑定代理策略。
- [Quantumult X](https://raw.githubusercontent.com/KnowSky404/ProxyKit/main/quantumultx/filters/telegram.list)：在 `filter_remote` 中设置 `force-policy=你的策略名`；CIDR 第三字段的 `no-resolve` 是兼容策略文本，必须覆盖，不能当作 DNS 开关。
- [sing-box SRS](https://raw.githubusercontent.com/KnowSky404/ProxyKit/main/sing-box/rules/telegram.srs) / [Source JSON](https://raw.githubusercontent.com/KnowSky404/ProxyKit/main/sing-box/rules/telegram.json)：按 [sing-box 引用示例](../sing-box/README.md#引用示例)替换文件名和 tag，再绑定本机 outbound；主配置不得在命中本集合前预解析域名，不得启用源 IP 匹配。消费者最低 1.10.0；显式 `action` 需要 1.11.0。

三端解析行为的限制见[规则格式](../docs/rule-format.md#no-resolve-的显式兼容边界)。上述 main 订阅链接在 PR 合并后可用。
