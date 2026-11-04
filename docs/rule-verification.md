# 规则验证：覆盖审计与验证边界

## 实施前覆盖矩阵

本次以 `0b50ec8` 的五组 YAML、生成器、全部 Bun 测试及 `build-rules.yml` 为基线审计。已有能力继续复用；下表的“缺口”描述新增前的状态。

| 验证层次 | 原有证据 | 原有覆盖与缺口 |
| --- | --- | --- |
| YAML Schema 与合法输入 | `model.test.ts` | 严格字段、重复键、未知标签/别名、有效日期、域名与 IPv4/IPv6 CIDR、空有效集合、注释类型均已有正反例；无需第二个 Schema 校验器。 |
| 同集重复与解析冲突 | `model.test.ts` | 已拒绝含禁用项的重复条件、等价 IPv6 及重叠 CIDR 的冲突解析选项；同策略覆盖允许且保留顺序。尚无跨集合诊断或后缀覆盖报告。 |
| 目标格式、顺序与候选项 | `generate.test.ts` | 已覆盖四类型到三端映射、完整 Loon 文本、QX 关键字、注释、禁用项、顺序与确定性；缺独立于渲染映射的列表解析和静态匹配测试。 |
| 显式解析兼容性 | `generate.test.ts` | 已检查 QX 历史第三字段声明、禁用候选兼容、sing-box 不预解析契约及拒绝丢失 resolve-on-match；这些检查不证明客户端 DNS 等价。 |
| 五组历史回归 | `migration.test.ts`、`fixtures/legacy/` | 已检查五组基础文件名、Loon/QX 完整字节快照、JSON 有效条件和顺序及提交产物；快照只是迁移证据。 |
| 官方 SRS 编译与解析 | `srs.ts`、`cli.test.ts`、`migration.test.ts` | 已固定官方 1.14.4 编译、反编译与规范化内容比较、二进制确定性、合法/非法样本。不能以模拟编译器代替现有真实集成测试。 |
| 官方 SRS 正反匹配 | `migration.test.ts` | 已对五组全部启用规则及后缀根域/单级子域/两类假后缀执行官方 `rule-set match`，并检查禁用遥测；独立 fixture 已覆盖 exact、IPv4/IPv6 两端边界。缺跨三端共用的固定业务案例表及多级子域。 |
| CLI、离仓库执行与隐私 | `cli.test.ts` | 已覆盖显式目录、目标子集、缺失/漂移/遗留产物、符号链接、失败前不写入及子进程错误脱敏；新增工具仍须复用这些边界。 |
| 既有 Loon 插件 | `tests/loon/` | 已覆盖新版语法、参数、元数据、必选/可选功能与 YouTube Music 范围；全部保留。 |
| CI | `build-rules.yml` | 已在 PR/main/手动触发锁定依赖与工具、类型检查、全部测试、Schema、临时构建与产物一致性；无外部业务服务依赖。新增检查应接入现有流程。 |
| 客户端加载与真实流量 | 尚无真机证据 | Loon/QX 不具备本仓库可执行的官方加载器；SRS CLI 匹配不等于完整运行时路由。需明确静态子集边界、研究 sing-box 本地隔离流量并提供维护者可执行的真机清单。 |

## 优先补齐的缺口

新增独立静态解析器与固定匹配案例，比较三端共同支持的目标集合；针对错误关键字、字段、启用状态、顺序和 CIDR 边界建立能失败的回归样本。保留原始 YAML、产物路径、规则顺序与业务含义。

质量诊断只解释重复与包含关系，不自动删除或合并。合理的后缀覆盖、禁用候选说明和跨集共享服务不能成为必须修复的错误。默认仅报告集合/分组/规则序号，避免泄露私人域名、IP、文件名和凭据。

自动化证据应区分 Schema 合法、生成一致、静态集合匹配、官方规则加载和实际流量路由。Apple 客户端无法在本环境运行；其结果必须由维护者记录，不能将静态通过写成真机通过。

## 新增验证层

| 能力 | 自动化证据 | 明确边界 |
| --- | --- | --- |
| 独立产物解析 | `src/verify.ts`、`tests/verify.test.ts` | 独立于渲染器的类型映射；复用严格输入校验器校验值。只接受本项目四类生成语法，不是通用 Loon/QX 配置解析器。 |
| 正反匹配与误匹配回归 | `fixtures/matches.json`、`verify.test.ts` | 手写期望覆盖五组；通用案例覆盖根域、多级子域、后缀边界、精确域名子域反例、IPv4/IPv6 网络边界和禁用项。比较共同支持的目标集合，不执行 DNS。 |
| 典型错误样本 | `verify.test.ts`、既有 `model.test.ts`/`cli.test.ts` | 错关键字/字段/地址、启用状态改变、顺序漂移、未知 JSON 条件、重复条件及非法官方输入会失败；不通过增加同义快照替代语义测试。 |
| QX 远程引用 | `verifyQxRemoteEntry` 与 README 示例回归 | 有限检查 `filter_remote` URL、tag、enabled、force-policy；实际策略存在性与覆盖效果需要真机确认。历史 no-resolve 仍是第三字段策略 token。 |
| 质量诊断 | `src/quality.ts`、`tests/quality.test.ts` | 精确重复、域名包含、IPv4/IPv6 重叠、启用/候选交叉、跨集解析选项歧义；不自动排序、删除或合并。 |
| 官方运行时加载与流量 | `tests/runtime.test.ts` | 官方 check/run 加载五组提交的 JSON/SRS；使用临时 HTTP inbound 和本地响应端证明模拟目标的路由选择、顺序及显式预解析影响。无业务网站请求，无系统代理修改。 |
| 回归与 CI | `rules:verify`、`build-rules.yml` | 保留全部既有测试；临时构建/检查和提交产物检查仍执行，工具版本/下载哈希/依赖锁定不变。 |

静态后缀匹配按标签边界；IP 通过数字网段比较，且不将 IPv4 与 IPv6 地址族视为同一条件。运行时测试为不同 outbound 配置可区分的 IPv4 loopback HTTP 代理响应端，收到隧道请求后仅在本地响应，不连接模拟目标。因此能验证 IPv6 目标元数据匹配，却不声称验证 IPv6 网络连通性。官方 `rule-set match` 的 IPv6 网络边界仍由既有迁移测试验证。

## sing-box 聚合输出回归

生成器现在为每个集合输出一个普通规则，将启用条件汇总为 `domain`、`domain_suffix`、`ip_cidr` 数组。`generate.test.ts` 覆盖跨分组和跨类型交错、每个字段内的顺序、IPv4/IPv6 共享数组、空字段省略和禁用项；`verify.test.ts` 独立解析紧凑与旧布局，拒绝未知字段、非法值和重复项，并验证字段数组顺序、缺失和意外启用。

`migration.test.ts` 核对当前六组提交产物的完整条件、每个字段内的源顺序、官方 SRS 重编译及正反匹配；Loon/QX 列表继续与迁移快照逐字节比较。`cli.test.ts` 用官方编译器证明相邻/重叠 IPv4/IPv6 CIDR、同名精确域名与后缀的等价规范化，同时用错误解码样本确认校验仍拒绝扩大空隙、遗漏前缀、混淆地址族、把精确域名扩大为后缀或丢失后缀匹配。

`runtime.test.ts` 使用单对象多字段、多值数组验证 Source/Binary 的域名/IP OR 匹配，并覆盖外层域名条件并入地址组以及显式逻辑 AND 的交集行为。主配置迁移要求见[规则格式说明](rule-format.md#从逐条对象迁移到单对象)。这些证据不扩大真机、远程更新或 DNS 等价的验证范围。

## 推荐入口与输出

先按 [rulegen 安装说明](../tools/rulegen/README.md) 安装固定 Bun 和官方编译器，设置 `PATH` 与 `SING_BOX_BIN` 指向同一官方二进制。生成器不会联网下载工具。仓库内完整只读验证：

```sh
bun run rules:verify
```

该脚本依次复用 `typecheck`、完整 `bun test` 和 CLI `verify`。Bun 原生报告测试通过/失败数，CLI 复用已有 validate/check 路径（含真实 SRS compile/decompile），独立解析已有产物并输出质量诊断与计数。不会隐式 build 或修复漂移；需要更新产物时先执行 `bun run rules:build`，再验证。原有 `rules:validate`、`rules:build`、`rules:check` 均保留。

CLI 末尾 JSON 包含 `ruleSets`、四类规则数量（含候选）、`enabled`、`disabled`、`artifacts`、`error`、`warning`、`info`。每条诊断包含 severity/code/locations/relation/message；source/group/rule 均为零基数组位置，source 顺序与输入目录中排序后的 YAML 一致。解析/Schema/漂移/官方编译错误返回非零；Warning/Info 供人工判断，不使正常包含或共享服务成为错误。

- **Error**：违反既有 Schema/项目约束，例如同集重复、冲突解析选项或无效输入。优先复用原校验器拒绝，不增加另一套宽松校验。
- **Warning**：跨集重复/覆盖或可能扩展启用集合的候选；跨集相交 CIDR 的解析选项不同也需检查配置顺序。
- **Info**：同集合理包含、已被启用后缀覆盖的禁用候选或仅禁用候选间包含。候选是说明，不是排除列表。

诊断默认不包含源文件名、元数据、域名、IP、注释或子进程输出；没有公开 CI 详细值模式。质量分析是有限集合的成对关系检查，时间复杂度 O(n²)，适合当前小型规则集合；大规模私人数据需要先评估规模，不为当前五组引入数据库或索引服务。

CI 安装依赖与工具后，测试本身仅使用本地文件和 loopback；不做业务 HTTP 请求或外部 DNS 探测。loopback runtime 需要允许本地监听以及 sing-box 初始化网络观察所需权限；受限沙箱禁止时测试会明确失败，不跳过或伪称全量通过。测试每次启动独立进程、临时目录与动态端口，结束清理。

## 私人仓库复用

不要对私人规则运行公开仓库的默认输入/输出。进入私人仓库，显式指定已经构建在私人环境的产物：

```sh
bun /opt/ProxyKit/tools/rulegen/src/cli.ts verify \
  --input /work/private/shared/rules \
  --output /work/private/generated \
  --sing-box /opt/sing-box/sing-box
```

此命令复用通用静态验证、官方编译与质量检查；不会执行公开五组固定业务案例。私人 Bun 测试可导入 `parseListArtifact`、`parseSingBoxArtifact`、`verifyArtifact`、`matchesRules` 和 `analyzeQuality`，在私人仓库内维护独立正反案例。避免将敏感 probe 放入测试名称或把失败原始值通过 Bun 断言打印到公共日志。原有目录隔离及固定 SHA 指南见 [Private 集成](private-integration.md)。

## 尚未验证与后续方向

本次自动化没有证明 Loon/QX 的真机加载、策略选择或 DNS 行为；没有验证 sing-box 各平台的远程更新/缓存、真实 IPv6 网络、移动系统 VPN 或业务服务可用性。按[客户端验证清单](client-verification.md)执行并保存记录，不能将 CI 通过填作真机结果。

后续优先投入：维护者在实际设备完成五组正反与更新记录；为新增业务规则补充独立固定案例；再根据实际故障扩展客户端版本、远程缓存/更新和 DNS 集成测试。真实服务探测应保持独立、可选，网络故障不能直接判为规则语义错误。
