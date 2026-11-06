# rulegen

Bun + TypeScript 规则生成器。入口是 `src/cli.ts`，直接运行源码，不需要打包，也不在运行时联网。依赖通过仓库根目录 `bun.lock` 固定。

## 安装与命令

使用 Bun **1.4.4** 和官方 sing-box **1.14.4**。默认输入和输出基于 CLI 模块所在的仓库根目录定位，不依赖当前工作目录。

这两个版本为 2026-11-03 核对的最新稳定版；Bun 的 `@types/bun` 同步固定为 1.4.4。Bun 安装方式见[官方文档](https://bun.com/docs/installation)，安装后用 `bun --version` 确认版本。Linux x86_64 可按以下方式安装官方 sing-box，其他平台从 [1.14.4 Release](https://github.com/SagerNet/sing-box/releases/tag/v1.14.4) 选择对应归档及 SHA256：

```sh
mkdir -p /tmp/proxykit-toolchain
curl --fail --silent --show-error --location --retry 3 \
  https://github.com/SagerNet/sing-box/releases/download/v1.14.4/sing-box-1.14.4-linux-amd64.tar.gz \
  --output /tmp/proxykit-toolchain/sing-box.tar.gz
echo '699a1b510aa4396b2176d32d1181920399ebf1e267835da6f3b598d0f7c24968  /tmp/proxykit-toolchain/sing-box.tar.gz' | sha256sum --check
tar -xzf /tmp/proxykit-toolchain/sing-box.tar.gz -C /tmp/proxykit-toolchain
export PATH="/tmp/proxykit-toolchain/sing-box-1.14.4-linux-amd64:$PATH"
export SING_BOX_BIN="/tmp/proxykit-toolchain/sing-box-1.14.4-linux-amd64/sing-box"
sing-box version
```

```sh
bun install --frozen-lockfile
bun tools/rulegen/src/cli.ts --help
bun tools/rulegen/src/cli.ts validate
bun tools/rulegen/src/cli.ts build
bun tools/rulegen/src/cli.ts check
```

| 参数 | 用途 |
| --- | --- |
| `build` | 验证后构建全部规则，默认三端输出 |
| `validate` | 验证规则和目标兼容性，不写文件 |
| `check` | 重新生成并比较已有产物，漂移返回非零 |
| `verify` | 复用 check，独立解析产物并报告规则数量与脱敏质量诊断，不写文件 |
| `--input DIR` | 输入 YAML 目录，默认 `shared/rules/` |
| `--output ROOT` | 输出根目录，默认工具仓库根目录 |
| `--target loon,quantumultx,sing-box` | 逗号分隔目标子集；默认 `all` |
| `--sing-box PATH` | 官方编译器路径，默认从 PATH 查找 |
| `--help` | 帮助信息 |

输出目录布局固定为 `ROOT/loon/rules/`、`ROOT/quantumultx/filters/` 和 `ROOT/sing-box/rules/`。所选目标目录内的 `.list` 或 `.json` / `.srs` 均为受管理产物，`build` 会移除源目录中已不存在的同类产物，`check` 则报告它们；因此外部调用应使用专用输出根目录。显式相对路径按调用者当前目录解析；省略路径时始终使用工具自身默认目录。外部仓库应显式给出输入与输出，避免将私有产物写入公开生成器 checkout：

```sh
bun /opt/ProxyKit/tools/rulegen/src/cli.ts build \
  --input /work/private/shared/rules \
  --output /work/private/generated \
  --target all --sing-box /opt/sing-box/sing-box
```

也可以只生成文本规则：

```sh
bun tools/rulegen/src/cli.ts build --target loon,quantumultx --output /tmp/proxykit-rules
```

选择 sing-box 目标时同时生成 JSON 和 SRS；编译器缺失、版本不符、编译失败或解析验证失败均不能当作成功。为保证 SRS 字节可重复，编译器固定为 1.14.4；升级须同时更新 CI 校验和、文档、测试及全部产物。消费者最低 1.10.0，与构建工具的固定版本分别管理。

每个 sing-box 集合将全部启用条件汇总到一个普通对象的 `domain`、`domain_suffix` 和 `ip_cidr` 数组，省略空字段，并保留各数组内的源顺序。继续使用 Source Rule Set version 2；聚合不会提高消费者最低版本。官方反编译可能合并相邻或重叠 CIDR，校验按地址族比较地址并集。旧版逐条对象到单对象的外层条件组合变化及显式逻辑 AND 写法，见[规则格式与迁移边界](../../docs/rule-format.md#从逐条对象迁移到单对象)。

条件可用 `targets` 显式限定客户端；省略则仍适用三端。User-Agent / ASN 仅能生成 Loon / QX 文本，sing-box 必须显式排除，否则校验失败；不会在线展开 ASN。WeChat 当前按要求只给 Loon 添加这三条，其他目标保留原匹配范围，详见[客户端差异](../../sing-box/README.md#wechat-上游对照与客户端差异)。

## 校验和维护

[格式文档](../../docs/rule-format.md) 定义 Schema v1。未知字段、类型错误、非法域名、CIDR、重复条件、冲突选项及无启用规则的规则集均拒绝。诊断只应定位结构位置，不输出域名、IP、YAML 内容或编译器可能包含输入数据的原始错误。生成器不读取远程规则，不解析节点订阅，不修改公共或私人远程仓库。

```sh
bun run typecheck
SING_BOX_BIN=/opt/sing-box/sing-box bun test
bun run rules:validate
bun run rules:build
bun run rules:check
```

测试覆盖 Schema、两类域名与 CIDR、顺序、重复检测、禁用和注释、目标格式、历史列表快照、跨客户端匹配集合、确定性、仓库外调用、漂移及真实官方 SRS 编译和解析。既有 `tests/loon/` 继续执行。迁移快照仅作为回归证据，不能作为第二份维护源；修改规则时应明确说明与历史快照的预期差异。

[架构说明](../../docs/architecture.md) 记录模块职责与产物策略；[Private 集成](../../docs/private-integration.md) 提供固定 Commit 引用方式。

## 规则质量与实际验证

`bun run rules:verify` 依次执行类型检查、全部 Bun 测试及 `cli.ts verify`；需将官方编译器放入 PATH，并用 `SING_BOX_BIN` 指定同一工具供测试使用。CLI `verify` 支持上表中的显式输入/输出与目标子集，适合在私人仓库复用；只运行 CLI 时不会执行公开回归或本地流量测试。Warning/Info 不阻断正常覆盖，Error/漂移/编译失败返回非零。

[覆盖矩阵与诊断说明](../../docs/rule-verification.md) 区分原有能力、新增静态匹配与官方 loopback 路由证据；[客户端清单](../../docs/client-verification.md) 提供 Apple 客户端及 sing-box 真机导入、更新、策略和 DNS 验证流程。静态检查不等于 Loon/QX 实际加载，loopback 不等于业务可达性。
