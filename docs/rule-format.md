# YAML 规则格式与语义

规则文件放在 `shared/rules/<name>.yaml`；基础文件名使用小写字母、数字及连字符，成为各客户端固定的产物名。唯一维护源是 YAML，不能直接编辑客户端生成文件。

## Schema v1

```yaml
version: 1
metadata:
  name: Example
  author: ProxyKit
  updated: '2026-11-03'
  source: Public service documentation
  note: Exact and suffix matches; no routing policy is embedded.
compatibility:
  quantumultx_no_resolve: legacy-policy-token
  sing_box_no_resolve: require-no-pre-resolution
groups:
  - name: Core domains
    comments:
      - A suffix includes both the root domain and its subdomains.
    rules:
      - type: domain-suffix
        value: example.com
      - type: domain
        value: api.example.net
      - type: domain
        value: telemetry.example.org
        enabled: false
        comments:
          - Shared telemetry; enable only after reviewing its scope.
  - name: Published IP ranges
    rules:
      - type: ipv4-cidr
        value: 192.0.2.0/24
        options:
          no_resolve: true
      - type: ipv6-cidr
        value: 2001:db8::/32
        options:
          no_resolve: true
```

本例使用保留域名和文档地址，不是真实私人配置。示例的 CIDR 显式要求不主动解析，并承认下文列出的两端兼容约束。sing-box 对启用的 CIDR 必须填写 `options: { no_resolve: true }` 和兼容声明；它不接受省略该选项或 `no_resolve: false`，因为仅凭 headless 集合无法表达“为此条件主动解析”的要求。

| 字段 | 类型与用途 |
| --- | --- |
| `version` | 整数，当前只能是 `1` |
| `metadata` | 对象，描述规则集 |
| `metadata.name` | 非空字符串，显示名 |
| `metadata.author` | 非空字符串，维护者或原有作者说明 |
| `metadata.updated` | `YYYY-MM-DD` 字符串，有效日历日期 |
| `metadata.source` | 非空字符串，公开来源或原始来源说明 |
| `metadata.note` | 非空字符串，用途及限制 |
| `groups` | 非空数组，按顺序排列规则分组 |
| `groups[].name` | 非空字符串，对应分组注释 |
| `groups[].comments` | 可选字符串数组，分组补充说明 |
| `groups[].rules` | 非空数组，按顺序排列匹配条件 |
| `rules[].type` | `domain`、`domain-suffix`、`ipv4-cidr`、`ipv6-cidr`、`user-agent` 或 `ip-asn` |
| `rules[].value` | 单个域名、带前缀长度的 CIDR、User-Agent 通配符模式或十进制 ASN；均为字符串 |
| `rules[].enabled` | 可选布尔值，默认 `true`；`false` 为禁用候选项 |
| `rules[].targets` | 可选非空客户端数组，取值 `loon`、`quantumultx`、`sing-box`，不允许重复；省略表示全部客户端 |
| `rules[].comments` | 可选字符串数组，规则前的注释 |
| `rules[].options.no_resolve` | 可选布尔值，仅适用于 CIDR / ASN；显式保留解析意图 |
| `compatibility` | 可选对象，承认目标端无法直接表达的解析语义；见下文 |

字段类型必须严格匹配；未知字段、未知版本和规则类型直接失败，防止拼写错误被忽略。YAML 重复映射键、别名展开、未知标签、多文档输入和解析器警告均拒绝。注释应作为上述结构化字段保存；普通 YAML `#` 注释不是输出内容。不要在匹配源中加入节点或策略名称。

## 校验规则

- 域名采用规范化小写 ASCII / punycode，不允许 URL、通配符、端口、空标签、前导点、尾随点、IP 地址或标签首尾连字符；标签和总长度必须合法。国际化域名先转换为 punycode。
- CIDR 必须包含有效 IPv4 / IPv6 和对应范围的前缀长度，类型与地址族一致。网络边界及规范化要求由校验器检查；不能默默扩大匹配范围。
- ASN 使用无前导零的十进制字符串，范围 `1..4294967295`。User-Agent 模式保留大小写，支持 `*` / `?`；当前生成子集限于不含空白和逗号的可打印 ASCII，拒绝配置字段注入。
- 同一规则集内重复条件拒绝，包括启用与禁用状态之间重复，以及同一条件的冲突选项。不同集合可以包含共同依赖，因为每组由用户分别选择策略。
- 后缀覆盖的禁用精确域名可以保留：这是原始抓包说明，并非应自动删除的重复。覆盖关系不等同于相同规则；本阶段不自动合并、排序或去重。
- 每组必须有规则，整个集合至少有一条启用条件；每个选定客户端也必须至少有一条适用的启用条件。仅包含注释、空组或全部禁用均失败。
- `no_resolve` 不得用于域名；不能通过错误类型、未识别兼容策略或目标不支持的选项生成看似有效的文件。

CLI 诊断定位文件序号、分组与规则位置，不输出具体域名、IP 或输入原文。语义校验在写文件之前完成。

## 目标格式

| 源条件 | Loon | Quantumult X | sing-box version 2 |
| --- | --- | --- | --- |
| `domain` | `DOMAIN` | `HOST` | `domain` |
| `domain-suffix` | `DOMAIN-SUFFIX` | `HOST-SUFFIX` | `domain_suffix` |
| `ipv4-cidr` | `IP-CIDR` | `IP-CIDR` | `ip_cidr` |
| `ipv6-cidr` | `IP-CIDR6` | `IP6-CIDR` | `ip_cidr` |
| `user-agent` | `USER-AGENT` | `USER-AGENT` | 不支持，须用 `targets` 明确排除 |
| `ip-asn` | `IP-ASN` | `IP-ASN` | 不支持，须用 `targets` 明确排除 |

`targets` 只决定条件适用于哪些客户端，不改变 `enabled`。未选中的文本目标保留组/规则注释，并输出排除说明；JSON/SRS 只含适用于 sing-box 的启用条件。若 sing-box 在适用范围内，即使条件禁用，也拒绝无法表示的 User-Agent / ASN，避免默默丢弃。原有未限定 `targets` 的规则仍默认三端同步；只有任务明确限定客户端或存在已记录的能力限制时才使用此字段。

例如 WeChat 经明确要求只给 Loon 补充上游 HTTP / ASN 条件：

```yaml
- type: user-agent
  value: "MicroMessenger*"
  targets: [loon]
- type: ip-asn
  value: "132203"
  targets: [loon]
  options:
    no_resolve: true
```

[Loon HTTP 规则](https://nsloon.app/docs/Rule/http_rule/)基于可见请求头匹配，不能等同于识别整个 App；[ASN 规则](https://nsloon.app/docs/Rule/ip_rule/)依赖客户端 ASN 数据库，不等同于固定 CIDR。QX 的[官方配置样例](https://raw.githubusercontent.com/crossutility/Quantumult-X/master/sample.conf)也支持 User-Agent / ASN，但本次 WeChat 按要求仅在 Loon 启用；sing-box [headless Schema](https://sing-box.sagernet.org/configuration/rule-set/headless-rule/)没有对应字段，不自动展开 ASN 网段。QX ASN 如使用历史第三字段 `no-resolve`，仍须遵守下方策略 token 契约。

后缀 `example.com` 包含根域、`a.example.com` 和更深子域，不包含 `badexample.com`。sing-box 不添加前导点，避免排除根域。IPv4/IPv6 都表示目标地址，不使用源地址选项。

Loon/QX 的注释、分组及禁用规则按原顺序输出，禁用规则以 `# ` 开头。sing-box JSON 将一个集合的全部启用条件汇总到一个普通 headless rule：精确域名合并到 `domain`，后缀合并到 `domain_suffix`，IPv4/IPv6 共同合并到 `ip_cidr`；省略空数组。各数组保留对应条件在 YAML 中的相对顺序，不保留不同类型之间的交错位置。元数据、分组、注释和禁用候选项仍完整保留在 YAML 与文本列表中。

按[官方 headless 匹配语义](https://sing-box.sagernet.org/configuration/rule-set/headless-rule/#default-fields)，这些目标地址字段及其数组元素为 OR；不需要额外的 `logical` 包装：

```json
{
  "version": 2,
  "rules": [
    {
      "domain": ["api.example.com", "other.example.com"],
      "domain_suffix": ["example.net"],
      "ip_cidr": ["192.0.2.0/24", "2001:db8::/32"]
    }
  ]
}
```

SRS 由固定官方 CLI 编译，再由同一工具反编译验证。官方 IP 集合会合并相邻或重叠 CIDR，验证按地址族比较每个规则对象内的地址并集，允许这种等价规范化，但拒绝覆盖空隙、遗漏网段或混淆 IPv4/IPv6。官方域名树还会将同名精确域名和后缀合并为后缀，校验允许这一等价表示，但拒绝把仅有的精确域名扩大为后缀，或丢掉后缀匹配能力。JSON 保留全部源条件；JSON/SRS 不增加官方 Schema 不支持的注释或元数据。

### 从逐条对象迁移到单对象

此次调整保留全部启用匹配目标以及 Loon/QX 文本产物；SRS 字节会随聚合结构变化。独立静态验证兼容旧的逐条对象和新的数组结构，按字段核对源条件及顺序；`rules:check` 仍要求提交产物与当前生成器的紧凑布局完全一致。

仅使用 `rule_set` 绑定策略的现有引用方式保持相同的目标匹配结果。若外层普通路由规则还带有 `domain`、`domain_suffix`、`ip_cidr`、`ip_is_private` 等同组条件，必须检查[官方路由组合语义](https://sing-box.sagernet.org/configuration/route/rule/#default-fields)：仅含一个非反转普通规则的集合会将字段并入外层匹配组，与这些目标地址条件形成 OR。旧的多对象集合则作为独立条件与外层条件形成 AND；不能将这种用法视为无条件兼容。此行为已在固定的 1.14.4 运行时验证。

需要交集时，在主配置中显式使用逻辑 AND。例如要求同时匹配额外域名限制和已声明的集合：

```json
{
  "type": "logical",
  "mode": "and",
  "rules": [
    { "domain_suffix": ["example.net"] },
    { "rule_set": ["YOUR_RULE_SET_TAG"] }
  ],
  "action": "route",
  "outbound": "YOUR_OUTBOUND"
}
```

这是添加到 `route.rules` 的片段，引用的 tag/outbound 必须已存在；显式 `action` 需要 1.11.0 及以上，1.10.x 省略该字段。端口、网络等其他匹配组也不因此变成 OR。该结构调整不解除下述不预解析约束，也不承诺 DNS 规则引用等价。

## `no-resolve` 的显式兼容边界

Loon 的 `no-resolve` 仅匹配目标已是 IP 的请求，不为域名执行 DNS 查询。[官方说明](https://nsloon.app/docs/Rule/ip_rule/)。Binance 的 15 条 IPv4 主机规则保留这一标志。

Quantumult X 的[官方规则样例](https://raw.githubusercontent.com/crossutility/Quantumult-X/master/filter.snippet)将第三字段定义为策略；[官方配置](https://raw.githubusercontent.com/crossutility/Quantumult-X/master/sample.conf)没有承诺逐条 IP `no-resolve` 参数。迁移前文件已经使用 `IP-CIDR,地址,no-resolve`，本次为保持订阅文本兼容而保留该第三字段，**不能将它称为有效 DNS 标志**。必须在 `filter_remote` 中配置 `force-policy=你的策略名`，覆盖资源内的历史策略字段。QX 的解析时机由其完整过滤配置决定，无法用本列表证明与 Loon 的 DNS 行为相同。

sing-box 的 [headless Schema](https://sing-box.sagernet.org/configuration/rule-set/headless-rule/)不包含 `no-resolve`；源条件映射到 `ip_cidr` 时，主配置必须不在此前预解析域名，也不能启用 `rule_set_ip_cidr_match_source`。规则集自身不能强制这一外部前提。禁止在无法保证此前提时声称等价使用，也不应直接将这些集合用于 DNS 地址过滤。

因此带 `no_resolve: true` 且选择相关目标时，源数据必须显式声明：

```yaml
compatibility:
  quantumultx_no_resolve: legacy-policy-token
  sing_box_no_resolve: require-no-pre-resolution
```

这两个固定值分别表示维护者接受历史 QX 字段兼容，以及 sing-box 使用方负责不预解析的约束；不是自动修复客户端能力的开关。缺少声明或值拼错会失败。`no_resolve: false` 显式要求允许解析，sing-box 目标拒绝该输入；不能悄悄当作 `true`。只选择 Loon 目标时无需填写其他目标的声明。

## 维护流程

```sh
bun run rules:validate
bun run rules:build
bun run rules:check
bun run typecheck
bun test
```

修改 YAML、生成全部客户端、检查匹配与候选项、更新索引，随后提交源和产物。官方 [Source Format 文档](https://sing-box.sagernet.org/configuration/rule-set/source-format/)说明格式版本和编译命令；本项目固定 version 2、最低消费者 1.10.0 和编译器 1.14.4，不随上游最新 Schema 自动升级。

## IPv6 客户端语法与等价检查

共享 YAML 的 `type: ipv6-cidr` 由生成器转换为不同客户端语法：

| 目标 | IPv6 条件形式 |
| --- | --- |
| Loon | `IP-CIDR6,2001:db8::/32,no-resolve` |
| Quantumult X | `IP6-CIDR,2001:db8::/32,no-resolve` |
| sing-box | `"ip_cidr": ["2001:db8::/32"]` |

以上为语法示例，`2001:db8::/32` 是文档示例网段，不应加入业务规则。QX 示例第三字段仍是须由 `force-policy` 覆盖的兼容策略文本；sing-box 仍依赖主配置不预解析，详见上方解析兼容边界。

跨端文本等价检查在转换 `HOST` / `HOST-SUFFIX` 的同时，必须将 QX 的 `IP6-CIDR` 归一化为 Loon 的 `IP-CIDR6`，再比较顺序、值、注释、启用状态和选项。`tools/rulegen/tests/migration.test.ts` 对未限定客户端的集合执行全文等价检查；含 `targets` 的集合逐端核对源条件及排除项，并单独断言 WeChat 的原 31 条共同条件和 Loon 3 条补充。Telegram 的 IPv6 条件及 `fixtures/matches.json` 中的网段内外边界样例同时覆盖独立解析与官方 sing-box 的 JSON/SRS 运行时匹配。关键字差异本身是预期客户端适配，不能据此修改正确的生成器输出。
