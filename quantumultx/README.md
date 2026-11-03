# Quantumult X

存放 Quantumult X 使用的分流规则、重写规则、脚本和配置片段。

## 子目录

- `configs/`: Quantumult X 配置片段或完整配置。
- `filters/`: 由 `shared/rules/*.yaml` 自动生成的分流规则。
- `rewrites/`: 重写规则。
- `scripts/`: 重写规则或任务引用的脚本。

## 文件建议

- 当前生成规则使用 `.list` 后缀，原公开路径保持不变。
- 重写规则可使用 `.conf` 或 `.rewrite` 后缀。
- 脚本按语言使用 `.js` 等后缀。

## 已收录规则

以下列表由共享 YAML 生成，禁止直接编辑；修改源后使用 [rulegen](../tools/rulegen/README.md) 重建三个客户端。规则中的 `HOST` / `HOST-SUFFIX` 分别对应精确域名 / 根域及子域后缀；IPv6 使用 `IP6-CIDR`。

请在 `filter_remote` 中指定 `force-policy=你的策略名`，由本机配置选择节点。Binance 列表保留迁移前的第三字段 `no-resolve` 文本，它处于 QX 策略字段位置，**不代表 QX 支持同名 DNS 开关**；必须由 `force-policy` 覆盖。该选项的历史信息和显式兼容声明保存在 YAML，不承诺所有主配置下与 Loon 的 DNS 语义一致。依据及限制见 [规则格式](../docs/rule-format.md)。

```ini
[filter_remote]
https://raw.githubusercontent.com/KnowSky404/ProxyKit/main/quantumultx/filters/wise.list, tag=Wise, force-policy=你的策略名, enabled=true
```

- `filters/binance.list`: Binance App 分流规则，基于 iOS App 抓包整理。
- `filters/bitget-wallet.list`: Bitget Wallet App 分流规则，基于 iOS App Loon 抓包整理。
- `filters/bybit.list`: Bybit App 分流规则，基于 iOS App Loon 抓包整理。
- `filters/ur.list`: UR App 分流规则，基于 iOS App Loon 抓包整理。
- `filters/wise.list`: Wise App 分流规则，基于 iOS App Loon 抓包整理。
