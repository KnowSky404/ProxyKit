# Shared

`rules/*.yaml` 是公开规则的唯一维护源，包含来源、更新时间、分组、注释、禁用候选项及明确的兼容策略。由 [rulegen](../tools/rulegen/README.md) 生成：

- `loon/rules/*.list`
- `quantumultx/filters/*.list`
- `sing-box/rules/*.json`、`*.srs`

当前规则组为 `binance`、`bitget-wallet`、`bybit`、`ur` 和 `wise`。不要分别维护多份规则，也不要直接编辑生成文件。格式、校验与 `no-resolve` 限制见 [规则格式](../docs/rule-format.md)。

`shared/scripts/` 保留给确实可跨客户端复用的脚本源码；客户端 API 专属脚本留在原目录。第三方来源和许可信息必须保留。私人域名、VPS IP、Token、原始抓包不得放入本目录；私有生成任务在私人仓库独立执行。
