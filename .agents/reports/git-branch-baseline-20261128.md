# 本机 git 基线：单主干、单工作树、特性分支即 PR（2026-11-28）

本文件是本机 git 工作方式的最终约定，取代 `.agents/reports/worktree-audit-20261128.md` §6.4 / §6.6 的旧口径。
同内容已提交到 `deepseek-harness` 仓库：`.agents/reports/git-branch-baseline-20261128.md`。

## 1. 约定

1. **每仓唯一主干。** `deepseek-harness` 主干为 `master`；其余仓库为 `main`（历史仓为 `master`）。主干是唯一开发基线，所有改动从主干切出。
2. **唯一工作树。** 正常工作只使用仓库主检出。禁止长期保留第二工作树；需要并行时临时 `git worktree add`，任务结束即删。
3. **特性分支生命周期 = PR 生命周期。** 流程固定为：`git fetch origin` → `git switch -c <type>/<name>-<date> origin/<main>` → 开发 → PR → 合并 → `git worktree remove` → `git branch -d`（本地与远端同名分支一并删除）。合并后不保留分支。
4. **发布快照与维护线不长期驻留。** `release/*`、`maintained/*` 只作为 tag/主干历史存在；需要回滚时按 tag 重建，不再保留活分支。
5. **未合并内容不得直接丢弃。** 删除前必须先归档：bundle（分支对象）+ format-patch（未合并提交）+ patch/未跟踪清单（工作树改动），并写入 MANIFEST。归档完成、校验通过后才允许 `worktree remove --force` 与 `branch -D`。

## 2. 本次收敛（2026-11-28）

| 仓库 | 分支（前 → 后） | 工作树（前 → 后） |
|---|---|---|
| `deepseek-harness` | 27 → 1（`master`） | 21 → 1 |
| `dsh-task-center` | 11 → 1（`master`） | 11 → 1 |
| `dsh-session-fts` | 7 → 1（`main`） | 7 → 1 |
| `dsh-nas-stack` | 4 → 1（`main`） | 2 → 1 |
| `dsh-copilot-acp-unified-20261123` | 2 → 1（`main`） | 2 → 1 |
| `dsh-session-memory` | 2 → 1（`main`） | 2 → 1 |
| `dsh-plantuml` | 2 → 1（`main`） | 1 → 1 |

合计删除分支 49 条、工作树 39 个；归档 51 个 bundle、18 组 format-patch、若干工作树 patch 与未跟踪文件 tarball，总计 1.3 GB。
其余 `~/projects/dsh-*`、`~/projects/*-2026112*` 仓库扫描后本已是单分支单工作树，未作改动；非 git 目录仅扫描，未触碰。

## 3. 归档位置与结构

```
~/dsh-archive/git-branches-20261128/
├── MANIFEST.md                     # deepseek-harness：分支/tip/未合并数/改动/恢复
├── README.md                       # 本文件
├── <safe-branch>.bundle            # 每分支一个自包含 bundle
├── <safe-branch>.worktree.patch    # git diff HEAD --binary（含暂存）
├── <safe-branch>.untracked.txt     # 未跟踪清单
├── <safe-branch>.untracked.tar.gz  # 真实未跟踪文件（排除 node_modules 等产物）
├── <safe-branch>.conflicts.txt     # 冲突文件与索引 stage 清单
├── <safe-branch>.conflict-state.tar.gz  # 冲突各 stage blob + 工作副本
├── patches/<safe-branch>/*.patch   # git format-patch（未合并提交）
├── provenance-*.txt                # 归档前分支/工作树快照
└── <repo>/                         # 其余仓库同结构 + 各自 MANIFEST.md
```

`<safe-branch>` 为分支名把 `/` 替换为 `-`。

## 4. 恢复方式

```sh
# 分支（deepseek-harness 为 shallow clone，bundle 以 origin 的 shallow 边界为基底；
# 在 origin 的正常 clone 中直接可用）
git clone -b feat-instant-composer \
  ~/dsh-archive/git-branches-20261128/feat-instant-composer.bundle /tmp/restore

# 或取回本仓
git fetch ~/dsh-archive/git-branches-20261128/feat-instant-composer.bundle \
  refs/heads/feat-instant-composer:refs/heads/feat-instant-composer

# 未合并提交（无需 bundle，直接落在主干上）
git am ~/dsh-archive/git-branches-20261128/patches/fix-mainline-resolve-20261122/*.patch

# 未提交改动
git apply --3way ~/dsh-archive/git-branches-20261128/fix-conv-windowing.worktree.patch

# 未跟踪文件
tar -xzf ~/dsh-archive/git-branches-20261128/fix-conv-windowing.untracked.tar.gz -C .

# 冲突现场（netopt/integration-20261123，5 处冲突）
tar -xzf ~/dsh-archive/git-branches-20261128/netopt-integration-20261123.conflict-state.tar.gz -C /tmp/netopt
```

## 5. 校验

```sh
git -C ~/projects/deepseek-harness worktree list   # 1 条
git -C ~/projects/deepseek-harness branch          # 仅 master
git -C ~/projects/deepseek-harness status --short  # 空
du -sh ~/dsh-archive/git-branches-20261128         # 1.3G
```

## 6. 例外与已知限制

- `deepseek-harness` 为 shallow clone（3 个边界提交）。bundle 不含边界前的 upstream 历史，恢复时以 origin 历史为基底；未合并提交本身完整包含在 bundle 与 `patches/` 中。
- `dsh-copilot-acp-unified-20261123` 原先无本地主干，已按 `maintenance/main` 建立本地 `main`。
- `magpie-ultrafast-capability-20261125` 无任何分支（detached HEAD），仅 1 个工作树，保持原样。
- `work-dsh-422-runtime-source-20261122` 只有 `fix/work-422` 一条分支、无主干，保持原样。
- 归档后不得删除 `~/dsh-archive`；远端已有分支未做任何删除或改写（本次 PR 分支合并后按约定删除）。
