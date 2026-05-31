# ProxyKit

用于整理 Loon、Quantumult X 等代理工具使用的分流规则、插件、重写脚本和相关配置。

## 目录结构

```text
.
├── loon/
│   ├── configs/    # Loon 配置片段或完整配置
│   ├── plugins/    # Loon 插件
│   ├── rules/      # Loon 分流规则
│   └── scripts/    # Loon 脚本
├── quantumultx/
│   ├── configs/    # Quantumult X 配置片段或完整配置
│   ├── filters/    # Quantumult X 分流规则
│   ├── rewrites/   # Quantumult X 重写规则
│   └── scripts/    # Quantumult X 脚本
└── shared/
    ├── rules/      # 可被多个工具复用的通用规则源
    └── scripts/    # 可被多个工具复用的通用脚本
```

## 命名建议

- 使用小写英文、数字和连字符命名文件，例如 `apple-services.list`。
- 按用途拆分规则，例如 `ai-services.list`、`streaming.list`、`direct.list`。
- 工具专属格式放在对应工具目录，通用源文件放在 `shared/`。
- 文件开头建议写明用途、适用工具、维护日期和引用来源。

## 维护约定

- `loon/` 只放 Loon 可直接使用或以 Loon 为目标生成的内容。
- `quantumultx/` 只放 Quantumult X 可直接使用或以 Quantumult X 为目标生成的内容。
- `shared/` 放通用域名、IP、脚本源码或转换前的规则素材。
- 如果某个规则来自第三方项目，请在文件注释或对应 README 中保留来源链接和许可说明。
