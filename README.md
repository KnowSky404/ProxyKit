# ProxyKit

ProxyKit 是面向 Loon、Quantumult X 和 sing-box 的公开分流规则、插件、脚本资源与规则生成工具集。公共规则只维护一份 YAML，再生成各客户端可直接订阅的文件；不包含代理节点、私人数据或订阅转换服务。

## 目录

```text
shared/rules/              # 唯一维护的 YAML 规则源
loon/rules/                # 生成的 Loon .list；保留原公开路径
loon/plugins/、scripts/    # 现有 Loon 插件和脚本
quantumultx/filters/       # 生成的 Quantumult X .list；保留原公开路径
sing-box/rules/            # 生成的 Source JSON 和官方编译的 SRS
tools/rulegen/             # Bun + TypeScript CLI、校验器和测试
tests/loon/               # 原有插件回归测试
docs/                     # 架构、规则格式和私有复用指南
.github/workflows/        # 只读构建校验
```

保留已有客户端配置目录，不为规划中的功能新增空目录。Loon 插件、脚本、Raw URL 和既有测试保留，规则升级不改变其行为。

## 引用公开规则

目前收录 `binance`、`bitget-wallet`、`bybit`、`ur`、`wise` 五组。以 Wise 为例：

- [Loon 规则](https://raw.githubusercontent.com/KnowSky404/ProxyKit/main/loon/rules/wise.list)
- [Quantumult X 规则](https://raw.githubusercontent.com/KnowSky404/ProxyKit/main/quantumultx/filters/wise.list)
- [sing-box Source JSON](https://raw.githubusercontent.com/KnowSky404/ProxyKit/main/sing-box/rules/wise.json)
- [sing-box Binary SRS](https://raw.githubusercontent.com/KnowSky404/ProxyKit/main/sing-box/rules/wise.srs)

Loon 在订阅配置中绑定策略；Quantumult X 在 `filter_remote` 中显式设置 `force-policy=你的策略名`。源数据不保存节点名。sing-box 使用说明见 [客户端文档](sing-box/README.md)。这些 `main` 链接在 PR 合并后提供本次新增内容。

## 添加和生成规则

需要 [Bun](https://bun.sh/) **1.4.4**；完整构建还需要官方 **sing-box 1.10.7** CLI。消费者加载生成的 JSON/SRS 最低需要 sing-box **1.10.0**（规则集格式 version 2）。生成器不会自动下载工具或规则。

```sh
bun install --frozen-lockfile
bun run rules:validate
bun run rules:build
bun run rules:check
bun run typecheck
bun test
```

将官方 `sing-box` 放入 `PATH`，或使用 `--sing-box /absolute/path/to/sing-box`。SRS 集成测试可通过 `SING_BOX_BIN` 指定同一二进制；测试必须有官方编译器，缺少时直接失败，不跳过 SRS 验证。

新增规则时在 `shared/rules/` 添加同名 `.yaml`，按照 [格式文档](docs/rule-format.md) 填写元数据、分组和匹配条件。修改生成源后重建全部客户端输出，同时维护三个客户端 README 索引。禁止直接修改生成文件。提交 YAML 和生成产物，并运行上述校验；CLI 参数和仓库外调用见 [rulegen 文档](tools/rulegen/README.md)。

## 自动化与支持范围

[构建工作流](.github/workflows/build-rules.yml) 在 PR、推送 `main` 和手动运行时安装锁定依赖、类型检查、运行全部测试、验证 YAML、在临时目录构建三端输出，并检查提交产物。漂移、无效规则或 SRS 编译失败会使 CI 失败；工作流不自动提交或合并。

支持精确域名、域名后缀、IPv4/IPv6 CIDR、禁用候选规则和结构化注释。现有两端列表迁移以快照回归测试保证字节不变。JSON/SRS 只携带启用的匹配条件；维护信息和候选项保存在 YAML 及两端文本列表中。

`no-resolve` 不是跨客户端通用标志：Loon 正式支持，Quantumult X 现有第三字段只按历史兼容文本保留，不能视为 DNS 开关；sing-box 依赖调用方不预解析的路由配置。相关源文件必须显式声明兼容策略，详见 [语义差异](docs/rule-format.md)。因此不宣称任意主配置下的 DNS 行为完全等价。

Loon 插件的实际支持范围、最低版本和真机验证限制见 [Loon 文档](loon/README.md)。公共与私人规则隔离设计见 [架构](docs/architecture.md) 和 [Private 集成指南](docs/private-integration.md)。本次不实现 Workers、R2、私人仓库创建、Web 编辑器或节点管理。
