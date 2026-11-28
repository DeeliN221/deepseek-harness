# 质量门与发版链路（本 fork）

本文件记录 `DeeliN221/deepseek-harness` 这个 fork 上实际启用的 CI 与发版规则；上游工作流含义以
`.github/workflows/*.yml` 为准。

## PR 门

| 工作流 | 触发 | 现状 | 说明 |
| --- | --- | --- | --- |
| `CI`（`.github/workflows/ci.yml`） | `pull_request` | **active**（2026-11-28 重新启用） | 发布物隔离（linux/macos）、Node 24 单测与覆盖率、lint、bench、consumers、node-compat，最后以 `all-checks-passed` 汇总 |
| `CI master`（`.github/workflows/ci-master.yml`） | `push master`、手动 | `disabled_manually` | 其中 `serial-linux-selfhosted` 作业要求 `[self-hosted, linux, x64, vm-backup]` 运行器，本 fork 没有该运行器；启用会让该作业无限排队，所以保持关闭 |
| `CI Python` / `CI Windows` | `pull_request` / 手动 | active | 与主门并行 |

`CI` 在 2026-11-16 之后没有产生过任何运行记录，仓库里它是 `disabled_manually` 状态（fork 侧的
手动停用），因此 2026-11-28 的 PR #50 只有空检查列表。重新启用后，PR 会正常触发。

## 本地等价门

在合并前本地跑与 CI 同源的门：

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run lint         # host 契约编译 + oxlint
corepack pnpm run typecheck    # tsx scripts/build.ts --scope typecheck
corepack pnpm test             # build:native-system + vitest
```

`pre-push` 钩子（lefthook）执行 `pnpm run typecheck`；在没有构建产物的工作树里（`git worktree`）它会因
项目引用未构建而失败，此时要么先在该工作树构建，要么用 `--no-verify` 推送并把证据留在 PR 里。

## 发版链路

1. 合并主分支后单独发一个 patch 版本：`corepack pnpm run release:dsh` → 提交 `release(dsh): x.y.z`。
2. `corepack pnpm run release:pack --family dsh --out <dir>` 产出发布物，`release-manifest.json` 记录
   `sourceCommit`。
3. 打 tag、发布（GitHub Release / GitHub Packages 按仓库既有约定），记录仓库、tag、Release 链接与
   `sourceCommit`。
4. 设备只用发布物更新；禁止在设备上就地改文件或加软链冒充更新。

## 真实页面验收

CI 绿只是必要条件。涉及用户可见行为的改动（例如图片上传），合并后在设备上用真实页面验收：
用 launch token 走 `POST /api/session/uploadFileBinary?mediaType=…` 传一张真实图片，或直接在 composer 上传，
结果写进部署台账。
