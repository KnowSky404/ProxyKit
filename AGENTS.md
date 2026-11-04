# ProxyKit 开发约束

## 开发工作流（所有变更必遵守）

### 独立 worktree 与任务分支

- 功能迭代、问题修复、重构、规则更新、测试、文档和配置变更均在独立 Git worktree 和任务分支中完成；本约束文件自身的修改也适用。不得直接在 `main` 或其他集成分支上开发、提交或推送。
- 开始前检查工作区、现有 worktree 和分支状态；获取最新远端目标分支（默认 `origin/main`），以其为基线创建任务 worktree 和分支。分支使用 `feat/`、`fix/`、`docs/`、`chore/` 等清晰前缀，一个任务对应一个分支和 PR；已存在的同任务 worktree 可以复用。
- 主工作区用于协调和同步，保留用户已有的未提交改动及其他任务的 worktree；不得为创建或清理任务而覆盖、重置或删除无关内容。
- 在任务 worktree 内完成实现与必要验证，遵守本文各专项检查要求。提交只包含当前任务相关内容，使用 Conventional Commits 格式；未经用户明确要求，不省略提交。

### 每次推送与创建 PR 前的本地审查

- 每次 `git push`（含首次推送、修复后追加推送及 rebase 后推送）和每次创建 PR 之前，必须先在任务 worktree 内执行本地 Codex `/review`，审查相对目标分支的完整差异，包括尚未提交的相关修改。非交互环境可使用 Codex CLI 的 `codex review --base <目标分支>`，未提交改动另用 `codex review --uncommitted` 覆盖。
- 对审查发现的问题逐项修复，补充必要验证并重新审查，直到没有未解决的有效问题。认为不适用的发现必须记录依据，不能直接忽略。未经实际运行、运行失败或中断的审查均不算通过；不得用普通自查或 CI 代替 `/review`。
- 审查必须对应即将推送或创建 PR 的最新内容；审查后发生任何内容变更、冲突解决或 rebase，均须重新验证和审查。若推送后没有新增变更，创建 PR 前可复用覆盖同一提交和目标基线的已通过审查结果。
- 本地审查和验证通过后，提交并推送任务分支，创建面向目标分支的 PR；不得直接推送集成分支。PR 说明写明问题、最终行为、验证结果及必要限制，并按照 GitHub 正文安全约束使用临时文件和 `--body-file`。

### PR 审查、修复与 rebase 合并

- PR 创建或更新后，等待 Codex 机器人完成对最新 head 提交的 review，并检查 review、行内评论、普通评论及必需的 CI 检查。机器人未回复、仍在审查、失败或仅审查了旧提交，都不代表通过；不能因暂时没有评论就合并。
- 若未自动触发 Codex review，可在 PR 中请求 `@codex review`。若机器人不可用或无法确认最新提交已完成审查，保留 PR 并报告阻塞，不得自行跳过此门禁。
- 有效审查问题必须修复；有异议的发现应说明依据并确认已得到处理，不能仅为清空线程而标记解决。修复后执行必要验证与本地 `/review`，再推送，并重新等待最新提交的机器人审查；重复此流程直至无未解决的有效问题。
- 合并前再次确认 PR 最新 head 未变、Codex review 已完成且没有未解决的有效问题、必需 CI 全部通过、所需审批已满足且无合并冲突。目标分支更新后若需同步或解决冲突，回到验证、本地审查、推送和远端审查流程。
- 满足门禁后，默认由代理继续执行 GitHub 的 **Rebase and merge**（例如 `gh pr merge --rebase --match-head-commit <已核验的 head SHA> --delete-branch`），无需用户再次重复授权；不得改用 merge commit 或 squash，不得绕过分支保护或使用管理员权限强行合并。若仓库不允许 rebase 合并，报告阻塞。
- 如需重写已推送的任务分支历史，仅允许在确认没有覆盖他人提交后使用 `--force-with-lease`；禁止裸 `--force`，并遵守推送前本地审查要求。

### 合并后的清理与交付

- 确认 PR 已实际合并后，删除远端任务分支；切回主工作区，确认任务 worktree 干净后移除该 worktree，再删除本地任务分支。Rebase 合并后提交 SHA 可能不同，删除前须核对 PR 的合并状态及任务提交已被纳入，不能仅因本地分支未显示 merged 就盲目强删。
- 清理仅针对当前任务；存在未提交改动、其他 worktree 占用或归属不明的提交时，保留相关内容并说明原因。主工作区可安全同步时使用 fast-forward 更新目标分支，不得破坏已有改动。
- 交付说明包含变更摘要、验证与本地审查结果、PR 链接、机器人审查状态、合并结果和分支/worktree 清理结果。权限、认证、网络或审查服务阻塞时如实报告已完成步骤与待办，保留任务成果，不得宣称已推送、已通过审查或已合并。

## 分流规则的默认适配范围

- 新增、修改或删除分流规则时，除非任务明确指定仅支持某一个代理 App，否则必须同步适配仓库中全部已支持的代理 App。
- 当前已支持的代理 App 包括 Loon、Quantumult X 和 sing-box；以后新增的 App 目录也自动纳入此默认范围。
- 不得只提交某一个 App 的规则而遗漏其他 App 的等价规则。规则基础文件名、有效匹配集合和对应 README 索引应保持同步；注释及禁用候选项保留在共享 YAML 和文本列表，sing-box JSON/SRS 仅携带启用条件。
- 仅当用户明确要求单 App 实现，或目标 App 确实不支持所需能力时，才允许不做全 App 适配；后一种情况必须在交付说明和相关文档中写明限制及原因。

## 分流规则目录与语法

- Loon 分流规则放在 `loon/rules/`，域名规则使用 `DOMAIN`、`DOMAIN-SUFFIX` 等 Loon 语法。
- Quantumult X 分流规则放在 `quantumultx/filters/`，对应域名规则使用 `HOST`、`HOST-SUFFIX` 等 Quantumult X 语法。
- 两端文件应使用相同的基础文件名；转换语法时保持匹配目标、启用状态、顺序和语义一致。
- IPv6 CIDR 的客户端关键字不同：Loon 使用 `IP-CIDR6`，Quantumult X 使用 `IP6-CIDR`；共享 YAML 使用 `ipv6-cidr`，sing-box 映射到 `ip_cidr`。跨端文本等价检查必须归一化这组关键字，并保留 IPv6 回归覆盖，不能因关键字不同而判定生成器输出错误。
- sing-box 生成规则放在 `sing-box/rules/`，包括 Source JSON 和官方 CLI 编译的 SRS。新增、重命名或删除规则文件时，同步更新 `loon/README.md`、`quantumultx/README.md`、`sing-box/README.md` 以及其他受影响的索引文档。

## 统一规则生成器约束

- `shared/rules/*.yaml` 是公开分流规则唯一维护源；禁止分别编辑 `loon/rules/*.list`、`quantumultx/filters/*.list` 和 `sing-box/rules/*.{json,srs}`。由 `tools/rulegen/src/cli.ts` 验证、构建并检查所有客户端产物。
- Schema 变更同步更新校验器、类型、目标渲染、测试与 `docs/rule-format.md`；未知字段、重复 YAML 键、非法域名/CIDR、重复条件、冲突解析选项及空有效集合必须失败，不能静默纠正或丢弃规则。
- 规则数组决定顺序；来源、元数据、分组、注释和禁用候选项不得丢失。历史迁移快照仅作为回归证据，不构成第二份维护源；后续有意改变规则必须明确记录预期差异。
- `no-resolve` 必须显式处理客户端语义差异。Loon 保留标志；QX 历史第三字段仅按 `legacy-policy-token` 兼容声明保留，并要求订阅 `force-policy`，不得宣称其为 QX DNS 开关。sing-box CIDR 要求 `no_resolve: true` 和 `require-no-pre-resolution` 声明；主配置不得提前解析。不能将此集成前提描述成无条件跨端 DNS 等价。
- sing-box 使用 Source Rule Set version 2、最低消费者 1.10.0；编译器固定官方 1.14.4。禁止自行编码 SRS，实际编译并用官方 CLI 解析验证。升级编译器时同步更新下载校验和、CI、文档、测试和全部二进制产物。
- CLI 必须支持仓库外运行与显式输入/输出目录，不从运行时网络获取规则，不将私人 YAML、域名、IP、Token 或可能回显输入的子进程错误写入日志。私人构建必须在私人仓库执行，显式指定私人输入和输出；公开工作流不得读取私人数据。
- 保持现有 Raw 路径。每次规则变更提交 YAML 和全部目标产物，执行 `bun run typecheck`、`bun test`、`bun run rules:validate`、`bun run rules:build`、`bun run rules:check`。完整测试必须提供官方编译器，不能跳过 SRS 测试后声称全量通过；原有 Loon 插件测试必须保留。
- CI 在 PR、main 推送和手动触发时校验产物；Actions 固定 Commit SHA，编译器下载固定 SHA256，依赖使用 lockfile，Token 最小只读权限。禁止 PR 自动写入主分支、上传私人 Artifacts 或增加无必要的定时构建。

## Loon 插件语法

- 新增、修改或改编 Loon 插件时，相关配置一律使用 Loon 官方当前新版语法，不得新增旧格式或将已迁移配置退回旧格式；配套配置片段、文档示例和测试须保持一致。
- `[Rewrite]` 遵循 [Rewrite v2 官方文档](https://nsloon.app/docs/Rewrite/rewrite_v2/)，使用 `request/response if <condition> then <action>`，需要多个 Action 时使用 `|` 连接。
- `[Script]` 遵循 [Script v2 官方文档](https://nsloon.app/docs/Script/script_v2/)，HTTP 脚本使用 `request/response if <condition> then script(...) with ...`；Cron、Network Changed 和 Generic 脚本同样使用对应触发器配合 `then script(...)`，属性通过可选的 `with` 配置。
- Script 属性使用新版名称，例如 `requires_body`、`binary_body_mode`、`img_url` 和 `enable`；插件对象参数使用 `{${参数名}}` 传入。不得使用旧式 `http-request`、`http-response`、`script-path=` 或旧式参数列表。
- 迁移旧配置时保留匹配范围、顺序、参数类型和运行行为；旧 HTTP Script 默认忽略大小写，迁移时须显式保留正则 `i` 标志。不要将配置属性改名规则套用到 JavaScript API 字段。
- `#!loon_version` 和 README 必须与所用语法及功能的最低版本一致；Rewrite v2 至少需要 Loon 3.5.1（978），Script v2 至少需要 Loon 3.5.1（983），使用更晚引入的能力时同步提高最低版本。编写时核对官方文档，不以旧示例作为语法依据。

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

- 对比 YAML 和所有 App 的规则基础文件名，确认 Loon / QX 列表以及 sing-box JSON / SRS 完整；运行 `rules:check` 检查缺失、漂移与遗留产物。
- 将 App 专属关键字归一化后对比同名文本规则，确认有效规则和注释掉的候选规则均无缺失或意外差异；sing-box 校验启用匹配集合、官方编译和解析，核对外部解析前提。
- 检查每个目标 App 的规则语法，避免把另一个 App 的关键字直接复制过来。
- 检查 Loon 插件及配套示例使用新版 Rewrite / Script 语法，确认属性名、参数引用和最低版本声明一致。
- 检查插件内所有 Raw GitHub 路径均与仓库中的实际文件路径一致，并确认 README 中的安装入口、支持范围和依赖说明已经同步。
