# sing-box

`rules/` 中的 `.json`（Source Rule Set）及 `.srs`（Binary Rule Set）由 `shared/rules/*.yaml` 生成。消费者最低 **sing-box 1.10.0**，使用规则集格式 **version 2**；仓库和 CI 固定官方 **1.10.7** 编译器以保证可重复构建。

## 已收录规则

- [`rules/binance.json`](rules/binance.json) / [`rules/binance.srs`](rules/binance.srs): Binance App 分流规则。
- [`rules/bitget-wallet.json`](rules/bitget-wallet.json) / [`rules/bitget-wallet.srs`](rules/bitget-wallet.srs): Bitget Wallet App 分流规则。
- [`rules/bybit.json`](rules/bybit.json) / [`rules/bybit.srs`](rules/bybit.srs): Bybit App 分流规则。
- [`rules/ur.json`](rules/ur.json) / [`rules/ur.srs`](rules/ur.srs): UR App 分流规则。
- [`rules/wise.json`](rules/wise.json) / [`rules/wise.srs`](rules/wise.srs): Wise App 分流规则。

来源和候选项见对应 YAML；JSON/SRS 仅包含启用的匹配条件，不包含策略、注释或禁用条件。现阶段文件很小、更新频率低，因此将 SRS 和 JSON 一起提交，保持 `main/sing-box/rules/<name>.srs` 稳定 Raw URL；不引入 Release Assets 的更新与 URL 管理成本。

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
      { "rule_set": ["proxykit-wise"], "outbound": "YOUR_OUTBOUND" }
    ]
  }
}
```

此片段采用 1.10.x 的路由写法；新版本应按其官方配置迁移指南填写路由动作。使用 Source JSON 时将 `format` 改为 `source` 并改用 `.json` URL。[官方 Rule Set 文档](https://sing-box.sagernet.org/configuration/rule-set/) 说明加载方式。

**Binance 的 IP 规则带有 Loon `no-resolve` 语义。** sing-box headless 规则不能携带这一开关；引用该集合时，主配置不得在此前通过 inbound domain strategy 或路由解析预先将域名转成 IP。不要启用按源 IP 匹配该规则集，也不要把包含 IP 条件的集合直接当成等价 DNS 规则。此约束保存在源文件显式兼容声明中，不能用一份规则集覆盖所有主配置的解析语义。详见 [规则格式与语义限制](../docs/rule-format.md)。

构建、编译与校验命令见 [rulegen](../tools/rulegen/README.md)；不得手工修改 JSON 或自行编码 SRS。
