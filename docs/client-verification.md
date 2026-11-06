# 客户端实际验证清单

自动化测试的覆盖矩阵见[规则验证](rule-verification.md)。本文是真机操作流程与空白记录模板，**本次没有执行 Loon、Quantumult X 或移动端真机测试**。静态列表检查不是客户端加载验证；官方 SRS 编译/匹配也不证明业务服务可达。

## 准备可复现环境

记录客户端版本、OS、规则提交 SHA、主配置版本、测试时间、预期策略和 DNS 配置。先备份配置，在独立测试配置中选择一个测试策略，关闭会抢先命中的其他规则或记录它们的顺序；勿改变生产订阅。公开规则使用各客户端 README 的 Raw URL；需要固定版本复测时，将 URL 中的 `main` 换成待验证提交 SHA。

从 `tools/rulegen/tests/fixtures/matches.json` 选取每组正反例，先查看该组 YAML，确认禁用候选是否仍被其他启用后缀覆盖。禁用一条规则不代表对该域名作显式排除。反例必须观察最终命中规则及策略，不能只看网页是否打开。文档示例域和保留 IP 不必能连通：连接失败仍可能已正确路由。业务可达性应另记，不据此修改匹配期望。

更新测试可在临时测试分支构建一个带 `probe.example.test` 的专用集合，将增删该条件前后的文件通过本地受控 HTTP 服务分发给测试设备。勿为了测试修改公共生产规则。记录加载内容的提交/摘要，避免把 CDN 缓存当作客户端匹配问题。

## Loon：iOS / iPadOS

1. 按 [Loon README](../loon/README.md) 中的远程规则链接添加订阅，绑定独立测试策略。打开资源管理，手动更新，确认更新时间、无解析错误和启用规则数量。检查注释与禁用项未变成活动条件。
2. 分别发出根域名、子域名、多级子域名请求；对精确域名再测其子域名。用客户端请求/路由日志或规则测试功能核对实际命中条目、远程规则集与策略。
3. 测试后缀左右边界，例如在临时集合中令 `example.test` 为后缀：根域和 `a.b.example.test` 应命中，`badexample.test`、`example.test.evil.test` 不应命中该集合。
4. 对临时 IPv4/IPv6 CIDR 测试网络首尾、两侧邻接地址。直接 IP 请求应按预期匹配；带 `no-resolve` 的条件不得被描述为会主动解析域名的规则。另用受控 DNS 日志确认域名请求有无发生解析，并记录主配置对结果的影响。
5. 在临时订阅中添加/移除 probe 后手动更新并重测，确认实际加载内容、规则命中及策略已变化。记录失败时的资源状态；不要凭“下载成功”断言匹配成功。

6. WeChat 应加载 34 条启用条件。对两条 User-Agent 使用受控 HTTP 请求头，分别测试匹配前缀和无关前缀；记录 HTTPS 下请求头是否可见，不据此推断整个 App 都会匹配。对 `AS132203` 用客户端 ASN 数据库确认测试目标归属，检查纯 IP 请求及 `no-resolve` 行为，并记录共享腾讯业务也可能命中。自动化测试只检查新增条件的语法与来源，不替代这一步。

语法依据：[域名规则](https://nsloon.app/docs/Rule/domain_rule/)、[IP 规则与 no-resolve](https://nsloon.app/docs/Rule/ip_rule/)、[HTTP / User-Agent 规则](https://nsloon.app/docs/Rule/http_rule/)。当前仓库没有可靠的官方 Loon CLI 加载器，只对本项目生成语法作有限静态验证。

## Quantumult X：Apple 平台

1. 按 [QX README](../quantumultx/README.md) 导入 `filter_remote`，保持 `enabled=true`、非空 `tag` 和 `force-policy=测试策略`。确认测试策略在主配置中真实存在，资源可下载、更新且无字段错误。
2. 更新资源并检查规则解析数量。分别执行与 Loon 相同的域名、后缀边界和 CIDR 正反例，记录命中资源/条目及最终策略。若前置规则抢先匹配，先修正测试配置再下结论。
3. 特别检查 Binance：历史 `IP-CIDR,地址,no-resolve` 的第三字段位于策略位置，必须被订阅 `force-policy` 覆盖。确认实际连接选择测试策略；不得将该字段当作 QX 正式 DNS 开关。若要比较带/不带 force-policy 的影响，只在专用测试配置中操作，并记录未知策略/导入错误或实际策略，不预设结果。
4. 用受控域名和 DNS 日志记录解析时机。该观察与策略覆盖分别记录，不能由 `force-policy` 生效推导跨客户端 DNS 等价。
5. 对临时订阅修改 probe，刷新后确认加载内容与最终匹配均更新。

官方依据：[规则字段样例](https://raw.githubusercontent.com/crossutility/Quantumult-X/master/filter.snippet)、[filter_remote 与 force-policy 配置](https://raw.githubusercontent.com/crossutility/Quantumult-X/master/sample.conf)。本仓库检查订阅行的有限子集，不代替 QX 导入验证。

## sing-box：macOS / Linux / Android

1. 从 [sing-box README](../sing-box/README.md) 配置片段创建独立配置，选择本机已有测试 outbound；Source 使用 `.json`/`source`，Binary 使用 `.srs`/`binary`。确认客户端至少 1.10.0；示例 `action: route` 需要 1.11.0 以上。桌面可先运行 `sing-box check -c test.json`。
2. 在测试配置中启用日志并启动，确认远程规则下载、缓存、加载成功。首次下载失败应记录为资源加载问题，不能记为匹配错误。分别加载 Source/Binary 并执行相同案例，核对命中规则集和 outbound。
3. 将跨集重叠案例绑定两个可区分的测试 outbound，交换 `route.rules` 顺序，确认先匹配的路由规则决定选择。集合内部是匹配集合，并不自带策略优先级。当前集合为单普通对象；外层同时设置域名/IP 条件时检查地址组 OR 语义，需要交集则使用显式逻辑 AND，见[迁移说明](rule-format.md#从逐条对象迁移到单对象)。
4. 对 Binance 等带 no-resolve 意图的 IP 集合，确认此前无 `action: resolve`、旧 inbound domain strategy 等预解析行为，且未设置 `rule_set_ip_cidr_match_source`。分别发出直接 IP 与域名请求。额外在隔离配置启用受控 hosts 解析，记录行为差异，然后恢复无预解析配置。不要将集合用作等价 DNS 地址过滤。
5. 在临时 HTTP 规则服务发布新版 probe，缩短测试配置的 `update_interval` 或重启无旧缓存的测试实例，确认资源重新下载并加载新内容；再验证路由改变。记录更新前后摘要、缓存路径、HTTP 状态与命中结果。正式远程更新/缓存行为仍需在目标平台执行。
6. 测试结束停止实例并删除测试缓存；不修改系统全局代理或生产配置。

官方依据：[Rule Set](https://sing-box.sagernet.org/configuration/rule-set/)、[Headless Rule](https://sing-box.sagernet.org/configuration/rule-set/headless-rule/)、[Route Rule](https://sing-box.sagernet.org/configuration/route/rule/)。仓库自动化使用官方运行时和本地模拟流量，覆盖加载与路由的范围见覆盖矩阵；这不是三平台真机结果。

## 验证记录模板

| 项目 | 记录 |
| --- | --- |
| 执行者、日期、客户端/OS 版本 | 待执行 |
| 规则 SHA/摘要、主配置版本 | 待执行 |
| 加载方式、更新时间、缓存状态、规则数量 | 待执行 |
| 测试类型/案例序号 | 待执行 |
| 目标（私人验证时仅保存在私人环境） | 待执行 |
| 预期命中规则集/策略与 DNS 前提 | 待执行 |
| 实际命中规则集/策略及解析观察 | 待执行 |
| Positive / Negative / 更新 / 顺序测试结果 | 待执行 |
| 业务可达性（独立记录） | 待执行 |
| 证据位置、异常、复测结论 | 待执行 |

抓包、日志和配置可能包含账户、签名 URL 或私人地址。公开报告使用案例序号与结构位置；完整记录留在对应私人环境。所有“待执行”必须由实际执行者填写，不可据 CI 结果代填。
