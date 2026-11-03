# 在私人仓库中复用公开生成器

本次只提供接口和示例，不创建私人仓库，不收集真实私人域名、VPS IP 或凭据。公开生成器可按固定 Commit SHA 引用，无需复制或分叉代码。

## 隔离方式

在私人仓库 GitHub Actions 中分别 checkout 私人仓库和公开工具：

```text
workspace/
├── private/                  # 当前私人仓库，只由私人 CI 读取
│   ├── shared/rules/*.yaml    # 私人规则
│   └── generated/            # 所有私人产物留在此目录
└── generator/                # 固定 SHA 的公开 ProxyKit
    └── tools/rulegen/
```

始终传递私人输入与输出的绝对路径。生成器默认输出到工具自身仓库，私人调用时不能省略 `--output`。不要对公开 checkout 执行提交或 push，不使用公开仓库工作流的输入参数携带私人规则。

## Private GitHub Actions 示例

将以下工作流放入未来的私人仓库。**先把 `PUBLIC_RULEGEN_SHA` 占位符替换为经过评审、包含本生成器的真实 40 位 Commit SHA**；不能用可移动的 `main`，也不要直接执行未替换的模板。Bun 依赖按该 Commit 的 lockfile 安装。固定版本可以通过选择对应版本的 Commit SHA 实现。

```yaml
name: Build private rules
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-24.04
    env:
      PUBLIC_RULEGEN_SHA: REPLACE_WITH_REVIEWED_40_CHARACTER_COMMIT_SHA
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          path: private
          persist-credentials: false
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          repository: KnowSky404/ProxyKit
          ref: ${{ env.PUBLIC_RULEGEN_SHA }}
          path: generator
          persist-credentials: false
      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2
        with:
          bun-version: 1.4.4
      - name: Install pinned dependencies
        run: bun install --cwd "$GITHUB_WORKSPACE/generator" --frozen-lockfile
      - name: Install verified official compiler
        shell: bash
        run: |
          set -euo pipefail
          archive="$RUNNER_TEMP/sing-box-1.14.4-linux-amd64.tar.gz"
          curl --fail --silent --show-error --location --retry 3 \
            https://github.com/SagerNet/sing-box/releases/download/v1.14.4/sing-box-1.14.4-linux-amd64.tar.gz \
            --output "$archive"
          echo "699a1b510aa4396b2176d32d1181920399ebf1e267835da6f3b598d0f7c24968  $archive" | sha256sum --check --status
          tar -xzf "$archive" -C "$RUNNER_TEMP"
          echo "$RUNNER_TEMP/sing-box-1.14.4-linux-amd64" >> "$GITHUB_PATH"
      - name: Generate inside private checkout
        shell: bash
        run: |
          set -euo pipefail
          tool="$GITHUB_WORKSPACE/generator/tools/rulegen/src/cli.ts"
          bun "$tool" validate \
            --input "$GITHUB_WORKSPACE/private/shared/rules" \
            --output "$GITHUB_WORKSPACE/private/generated"
          bun "$tool" build \
            --input "$GITHUB_WORKSPACE/private/shared/rules" \
            --output "$GITHUB_WORKSPACE/private/generated"
          bun "$tool" check \
            --input "$GITHUB_WORKSPACE/private/shared/rules" \
            --output "$GITHUB_WORKSPACE/private/generated"
```

命令从私人目录读取 YAML，本地生成 `generated/loon/rules/*.list`、`generated/quantumultx/filters/*.list` 及 `generated/sing-box/rules/*.{json,srs}`。目标子集可通过 `--target` 指定；编译器不在 PATH 时增加 `--sing-box /absolute/path/to/sing-box`。Schema、显式兼容声明与公开任务一致，见 [规则格式](rule-format.md)。

## 保存和访问控制

示例只在当前私人 job 工作区构建，不推送、不上传附件；job 结束后临时结果消失。需要长期保存时，可由私人仓库自行设计受控步骤，将 `private/generated/` 提交回**该私人仓库**，或写入具备访问控制的存储。只为那一步配置最小写权限，不扩展公开仓库权限；凭据只来自其私人 Secrets / 受控身份，不写入 YAML、命令参数、公共配置或日志。

不要把私人订阅直接链接到公共 Raw GitHub，不把访问 Token 放进订阅 URL。私人仓库 Raw 下载通常需要认证，具体设备获取方式是独立的分发设计；本次不实现网关、Workers 或 R2。

不要使用 `cat`、调试 shell 跟踪或未审查的编译器标准错误来输出私人输入，也不要把输入、产物或失败转储作为公共 Artifacts。工具错误只包含结构位置和类别，不回显域名 / IP；这不替代私人 CI 对权限、日志保留和存储的管理。

## 规则质量验证

构建后可在同一私人环境运行 CLI `verify`，保留 `--input`、`--output` 与固定编译器绝对路径。它复用现有 check 并报告脱敏诊断；不会运行公开案例。私人正反案例、工具 API 及日志边界见[验证文档](rule-verification.md#私人仓库复用)。
