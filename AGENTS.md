# ProxyKit 开发约束

## 分流规则的默认适配范围

- 新增、修改或删除分流规则时，除非任务明确指定仅支持某一个代理 App，否则必须同步适配仓库中全部已支持的代理 App。
- 当前已支持的代理 App 包括 Loon 和 Quantumult X；以后新增的 App 目录也自动纳入此默认范围。
- 不得只提交某一个 App 的规则而遗漏其他 App 的等价规则。规则文件名、有效规则集合、注释说明和对应 README 索引应保持同步。
- 仅当用户明确要求单 App 实现，或目标 App 确实不支持所需能力时，才允许不做全 App 适配；后一种情况必须在交付说明和相关文档中写明限制及原因。

## 分流规则目录与语法

- Loon 分流规则放在 `loon/rules/`，域名规则使用 `DOMAIN`、`DOMAIN-SUFFIX` 等 Loon 语法。
- Quantumult X 分流规则放在 `quantumultx/filters/`，对应域名规则使用 `HOST`、`HOST-SUFFIX` 等 Quantumult X 语法。
- 两端文件应使用相同的基础文件名；转换语法时保持匹配目标、启用状态、顺序和语义一致。
- 新增、重命名或删除规则文件时，同步更新 `loon/README.md`、`quantumultx/README.md` 以及其他受影响的索引文档。

## Loon 插件的命名与元数据

- 新增或重新命名的项目自有插件使用简洁、稳定的产品名，不在文件名、`#!name`、脚本标签或日志前缀中加入 `Enhance`、`Standalone` 等实现阶段或部署方式限定词，除非任务明确要求。文件名使用对应产品的小写规范名，例如 `plugins/youtube.plugin`。
- 项目自有插件的 `#!author` 使用 GitHub 用户名 `KnowSky404`，`#!homepage` 指向项目地址 `https://github.com/KnowSky404/ProxyKit`；README 或注释中的作者链接指向个人主页 `https://github.com/KnowSky404`。
- 插件应提供与目标 App 一致的图标。重命名插件或脚本时，必须在同一提交中同步插件内的远程路径、脚本标签、日志前缀、测试和对应 README 索引。
- 当规范脚本名与现有兼容实现冲突时，优先使用 `loon/scripts/<plugin>/request.js`、`response.js` 等产品目录组织新实现，不得为抢占文件名而覆盖或改变旧插件行为。
- 改编第三方实现时，即使插件元数据使用项目作者，也必须在源码注释、NOTICE 或 README 中保留原作者、上游链接和适用许可证，不得移除第三方署名。

## YouTube 插件专项约定

- 项目自有实现以 `loon/plugins/youtube.plugin` 为规范入口，配套本地脚本放在 `loon/scripts/youtube/`。旧的 `youtube-enhance.plugin` 作为独立兼容实现保留，除非任务明确要求，否则不得修改、替换或与新插件混用。
- 当前 `youtube.plugin` 只适配 Loon 和 YouTube Music。插件名称可以覆盖计划支持的 YouTube 与 YouTube Music，但描述和 README 必须如实注明当前实际适配范围；不得提前宣称尚未验证的 YouTube 或 Quantumult X 支持。
- `youtube.plugin` 的运行时脚本和辅助逻辑必须由本仓库托管并在设备本地完成，不得依赖第三方远程脚本、Worker 或中继服务。第三方仓库链接只能用于来源和许可说明，不能成为该插件的运行时依赖。
- YouTube Music 的广告过滤、后台播放和画中画属于强制能力，脚本中默认启用且不向用户提供关闭开关。Music 的“选段”和“升级”入口屏蔽为可选开关，并默认开启；调试日志也可作为独立开关。
- 抓包文件可能包含令牌、账号标识和签名媒体地址，只能用于本地分析，不得提交到仓库、公开附件或日志中。
- 插件和脚本变更至少运行对应 Bun 测试，并覆盖元数据、远程依赖边界、必选功能不可关闭、可选开关组合以及 YouTube App 不受当前 Music 逻辑影响等行为。

## 提交前检查

- 对比所有 App 的规则文件清单，确认没有仅存在于单一 App 目录的文件。
- 将 App 专属关键字归一化后对比同名规则，确认有效规则和注释掉的候选规则均无缺失或意外差异。
- 检查每个目标 App 的规则语法，避免把另一个 App 的关键字直接复制过来。
- 检查插件内所有 Raw GitHub 路径均与仓库中的实际文件路径一致，并确认 README 中的安装入口、支持范围和依赖说明已经同步。
