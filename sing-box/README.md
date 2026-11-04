# sing-box

`rules/` 中的 `.json`（Source Rule Set）及 `.srs`（Binary Rule Set）由 `shared/rules/*.yaml` 生成。消费者最低 **sing-box 1.10.0**，使用规则集格式 **version 2**；仓库和 CI 固定官方 **1.14.4** 编译器以保证可重复构建。

[1.14.4](https://github.com/SagerNet/sing-box/releases/tag/v1.14.4) 为 2026-11-03 核对的最新稳定版。已用该版本重新编译、解析和匹配验证全部规则。当前条件继续采用 version 2，消费者最低版本保持 1.10.0；[上游更高格式版本](https://sing-box.sagernet.org/configuration/rule-set/source-format/)新增的条件不在当前生成范围内。

## 已收录规则

- [`rules/binance.json`](rules/binance.json) / [`rules/binance.srs`](rules/binance.srs): Binance App 分流规则。
- [`rules/bitget-wallet.json`](rules/bitget-wallet.json) / [`rules/bitget-wallet.srs`](rules/bitget-wallet.srs): Bitget Wallet App 分流规则。
- [`rules/bybit.json`](rules/bybit.json) / [`rules/bybit.srs`](rules/bybit.srs): Bybit App 分流规则。
- [`rules/telegram.json`](rules/telegram.json) / [`rules/telegram.srs`](rules/telegram.srs): Telegram 官方服务域名及 IPv4/IPv6 网段；主配置须遵守不预解析约束，[范围和引用说明](../shared/README.md#telegram)。
- [`rules/ur.json`](rules/ur.json) / [`rules/ur.srs`](rules/ur.srs): UR App 分流规则。
- [`rules/wechat.json`](rules/wechat.json) / [`rules/wechat.srs`](rules/wechat.srs): 微信 / WeChat 分流规则，迁自手工维护的 sing-box 配置；保留共享腾讯端点和整个 `43.160.0.0/12` 网段，具体迁移边界见下文。
- [`rules/wise.json`](rules/wise.json) / [`rules/wise.srs`](rules/wise.srs): Wise App 分流规则。

来源和候选项见对应 YAML；JSON/SRS 仅包含启用的匹配条件，不包含策略、注释或禁用条件。现阶段文件很小、更新频率低，因此将 SRS 和 JSON 一起提交，保持 `main/sing-box/rules/<name>.srs` 稳定 Raw URL；不引入 Release Assets 的更新与 URL 管理成本。

每个 JSON 规则集使用一个普通规则对象，同类值分别汇总到 `domain`、`domain_suffix`、`ip_cidr` 数组，IPv4/IPv6 共用 `ip_cidr`，空字段省略；各数组保留源条件的相对顺序。这些目标地址条件按 OR 匹配。SRS 由同一 JSON 官方编译得到。

**从旧版逐条对象更新时：**下方仅用 `rule_set` 绑定策略的示例保持相同目标匹配结果；若你的外层规则还写了域名/IP 条件，单普通对象集合会按[官方语义](https://sing-box.sagernet.org/configuration/route/rule/#default-fields)将字段并入外层地址组，可能改变原来的交集关系。需要交集时显式使用逻辑 AND，写法和迁移边界见[规则格式说明](../docs/rule-format.md#从逐条对象迁移到单对象)。JSON/SRS 的 Raw 路径保持不变。

## 引用示例

在现有配置的 `route.rule_set` 中添加以下对象，再在 `route.rules` 中绑定本机已有的 outbound。示例是配置片段，不是完整客户端配置：

```json
{
  "route": {
    "rule_set": [
      {
        "type": "remote",
        "tag": "proxykit-wise",
        "format": "binary",
        "url": "https://raw.githubusercontent.com/KnowSky404/ProxyKit/main/sing-box/rules/wise.srs"
      }
    ],
    "rules": [
      { "rule_set": ["proxykit-wise"], "action": "route", "outbound": "YOUR_OUTBOUND" }
    ]
  }
}
```

此片段采用 sing-box 1.14.4 的显式 `action: "route"` 写法，需要 1.11.0 及以上；1.10.x 消费者应省略 `action` 字段，规则集本身仍兼容。升级已有主配置时参照[官方迁移指南](https://sing-box.sagernet.org/migration/)。使用 Source JSON 时将 `format` 改为 `source` 并改用 `.json` URL。[官方 Rule Set 文档](https://sing-box.sagernet.org/configuration/rule-set/) 说明加载方式。

**Binance、WeChat 和 Telegram 的 IP 规则带有 Loon `no-resolve` 语义。** sing-box headless 规则不能携带这一开关；引用这些集合时，主配置不得在此前通过 `action: "resolve"` 等操作预先将域名转成 IP（旧版配置也应检查 inbound domain strategy）。不要启用按源 IP 匹配这些规则集，也不要把包含 IP 条件的集合直接当成等价 DNS 规则。此约束保存在源文件显式兼容声明中，不能用一份规则集覆盖所有主配置的解析语义。详见 [规则格式与语义限制](../docs/rule-format.md)。

## WeChat 迁移说明

`wechat` 来自 [手工维护的 sing-box 路由规则](https://microbin.knowsky.uk/raw/bqWQ3e)，保留全部 **8 条精确域名、22 条域名后缀和 1 条 IPv4 CIDR**，各数组内顺序不变。不扩大精确域名，也不缩减原有共享服务及 `43.160.0.0/12`；该网段并非微信独占，匹配到的其他业务也会使用此集合绑定的策略。

原配置的 `ip_is_private: true` 匹配所有非公网目标，按 [官方路由匹配语义](https://sing-box.sagernet.org/configuration/route/rule/#default-fields)与域名/IP 条件为 OR 关系。它属于全局路由设置，不加入公开微信集合；`action` 和 `outbound: "Direct"` 也由使用方主配置绑定。替换原本内联的微信规则时，可在原位置拆成以下两条，保留对现有其他规则的优先级（`Direct` 必须是主配置中已有的 outbound）：

```json
{
  "route": {
    "rule_set": [
      {
        "type": "remote",
        "tag": "proxykit-wechat",
        "format": "binary",
        "url": "https://raw.githubusercontent.com/KnowSky404/ProxyKit/main/sing-box/rules/wechat.srs"
      }
    ],
    "rules": [
      { "ip_is_private": true, "action": "route", "outbound": "Direct" },
      { "rule_set": ["proxykit-wechat"], "action": "route", "outbound": "Direct" }
    ]
  }
}
```

这是追加到现有配置的片段，不能覆盖其他 `rule_set` 和 `rules`。与上方引用示例相同，显式 `action` 写法需要 sing-box 1.11.0 及以上；1.10.x 省略该字段。

原始片段未编码 `no-resolve`。本次为三端生成采用仓库现有的不预解析约束：YAML 中 CIDR 显式使用 `no_resolve: true`，并声明 QX 兼容策略字段及 sing-box 外部解析前提。**匹配集合保留，不承诺与任意原主配置的 DNS 行为完全相同**；请按上述约束检查已有主配置。Loon/QX 使用各自主配置管理私网直连。

构建、编译与校验命令见 [rulegen](../tools/rulegen/README.md)；不得手工修改 JSON 或自行编码 SRS。
