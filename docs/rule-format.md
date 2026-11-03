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
| `rules[].type` | `domain`、`domain-suffix`、`ipv4-cidr` 或 `ipv6-cidr` |
| `rules[].value` | 单个域名或带前缀长度的 CIDR |
| `rules[].enabled` | 可选布尔值，默认 `true`；`false` 为禁用候选项 |
| `rules[].comments` | 可选字符串数组，规则前的注释 |
| `rules[].options.no_resolve` | 可选布尔值，仅适用于 CIDR；显式保留解析意图 |
| `compatibility` | 可选对象，承认目标端无法直接表达的解析语义；见下文 |

字段类型必须严格匹配；未知字段、未知版本和规则类型直接失败，防止拼写错误被忽略。YAML 重复映射键、别名展开、未知标签、多文档输入和解析器警告均拒绝。注释应作为上述结构化字段保存；普通 YAML `#` 注释不是输出内容。不要在匹配源中加入节点或策略名称。

## 校验规则

- 域名采用规范化小写 ASCII / punycode，不允许 URL、通配符、端口、空标签、前导点、尾随点、IP 地址或标签首尾连字符；标签和总长度必须合法。国际化域名先转换为 punycode。
- CIDR 必须包含有效 IPv4 / IPv6 和对应范围的前缀长度，类型与地址族一致。网络边界及规范化要求由校验器检查；不能默默扩大匹配范围。
- 同一规则集内重复条件拒绝，包括启用与禁用状态之间重复，以及同一条件的冲突选项。不同集合可以包含共同依赖，因为每组由用户分别选择策略。
- 后缀覆盖的禁用精确域名可以保留：这是原始抓包说明，并非应自动删除的重复。覆盖关系不等同于相同规则；本阶段不自动合并、排序或去重。
- 每组必须有规则，整个集合至少有一条启用条件。仅包含注释、空组或全部禁用均失败。
- `no_resolve` 不得用于域名；不能通过错误类型、未识别兼容策略或目标不支持的选项生成看似有效的文件。

CLI 诊断定位文件序号、分组与规则位置，不输出具体域名、IP 或输入原文。语义校验在写文件之前完成。

## 目标格式

| 源条件 | Loon | Quantumult X | sing-box version 2 |
| --- | --- | --- | --- |
| `domain` | `DOMAIN` | `HOST` | `domain` |
| `domain-suffix` | `DOMAIN-SUFFIX` | `HOST-SUFFIX` | `domain_suffix` |
| `ipv4-cidr` | `IP-CIDR` | `IP-CIDR` | `ip_cidr` |
| `ipv6-cidr` | `IP-CIDR6` | `IP6-CIDR` | `ip_cidr` |

后缀 `example.com` 包含根域、`a.example.com` 和更深子域，不包含 `badexample.com`。sing-box 不添加前导点，避免排除根域。IPv4/IPv6 都表示目标地址，不使用源地址选项。

Loon/QX 的注释、分组及禁用规则按原顺序输出，禁用规则以 `# ` 开头。sing-box JSON 只包含有效条件，每条源规则形成一个 headless rule；SRS 由官方 CLI 编译，再由同一官方 CLI 解析验证。JSON/SRS 不增加官方 Schema 不支持的注释或元数据。

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
