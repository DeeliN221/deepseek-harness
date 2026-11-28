# 工作树与分支清点审计（2026-11-28）

- 仓库：`DeeliN221/deepseek-harness`，主干 `origin/master` @ `7143a77873`
- 生成时间：2026-11-28 17:26 (+08:00)；生成方式：只读扫描 `git worktree list --porcelain`、`git branch -vv`、`git status --short`、`git log @{u}..HEAD`
- 范围：monorepo 注册工作树 36 个、本地分支 47 条（均不含本审计分支）、外部独立仓库/克隆 49 个

## 分类口径

| 类别 | 判据 | 处置 |
|---|---|---|
| A 可删 | 工作树目录已不存在或 prunable；或分支已完全合并进 `origin/master`、已跟踪树干净、未跟踪内容仅为构建产物 | `worktree prune` / `worktree remove --force` / `branch -d` |
| B 需保留 | 存在未合并提交，或已跟踪文件有未提交改动（含冲突） | 一律不动，仅登记 |
| C 待定 | 已合并但含未跟踪证据/基线/发布产物；或仅本地实验、已推送未合并、活跃发布分支 | 一律不动，仅登记 |

> 安全约束：不使用 `git branch -D`、不 force push、不改源码。B 类 0 改动。

## 1. Monorepo 工作树（36）

| # | 路径 | 分支 | 未提交(已跟踪/未跟踪) | 未合并提交 | 最近提交 | prunable | 分类 | 处置 |
|---|---|---|---|---|---|---|---|---|
| 1 | `/Users/xbugs/projects/deepseek-harness` | feat/sidebar-split-plugins | 0/0 | 0 | 2026-11-27 23:06 |  | C | 切换到 master 后删除已合并分支 |
| 2 | `/private/tmp/core-master` | (detached) | 0/0 | 27234 | 2026-11-16 21:51 | 是 | A | git worktree prune |
| 3 | `/private/tmp/core-ml` | fix/mainline-resolve-20261122 | 0/0 | 15 | 2026-11-22 08:49 | 是 | A | git worktree prune（保留分支） |
| 4 | `/Users/xbugs/projects/deepseek-harness/.agents/worktrees/feat-instant-composer` | feat-instant-composer | 0/0 | 7 | 2026-11-19 00:33 |  | B | 保持不动 |
| 5 | `/Users/xbugs/projects/deepseek-harness/.agents/worktrees/feat-session-search` | feat-session-search | 0/0 | 0 | 2026-11-19 07:56 |  | A | worktree remove --force |
| 6 | `/Users/xbugs/projects/deepseek-harness/.agents/worktrees/fix-boot-review-followup` | fix-boot-review-followup | 0/0 | 1 | 2026-11-19 08:44 |  | B | 保持不动 |
| 7 | `/Users/xbugs/projects/dsh-mac-model-state-20261125` | (detached) | 0/447 | 0 | 2026-11-25 22:28 |  | C | 保持不动 |
| 8 | `/Users/xbugs/projects/dsh-session-recovery-20261123` | feat/session-recovery-20261123 | 12/3 | 0 | 2026-11-23 10:57 |  | B | 保持不动 |
| 9 | `/Users/xbugs/projects/dsh-sidebar-source-takeover-20261127` | feat/nas-sidebar-single-row-20261127 | 0/2 | 0 | 2026-11-27 03:10 |  | C | 保持不动 |
| 10 | `/Users/xbugs/projects/netopt-20261123/core` | netopt/integration-20261123 | 17/0 | 0 | 2026-11-23 12:37 |  | B | 保持不动 |
| 11 | `/Users/xbugs/projects/worktrees/dsh-acp-unified-20261123-core` | feat/acp-unified-mainchat-20261123 | 0/0 | 1 | 2026-11-23 13:21 |  | B | 保持不动 |
| 12 | `/Users/xbugs/projects/worktrees/dsh-chat-async-dispatch-20261123` | feat/chat-async-dispatch-20261123 | 0/0 | 0 | 2026-11-23 10:52 |  | A | worktree remove --force |
| 13 | `/Users/xbugs/projects/worktrees/dsh-chat-elapsed-20261122` | (detached) | 0/0 | 0 | 2026-11-23 00:53 |  | A | worktree remove --force |
| 14 | `/Users/xbugs/projects/worktrees/dsh-chat-window-tail-20261124` | (detached) | 0/773 | 0 | 2026-11-24 18:29 |  | A | worktree remove --force |
| 15 | `/Users/xbugs/Projects/worktrees/dsh-complete-gui-20261125` | fix/mac-session-gui-20261125 | 0/0 | 0 | 2026-11-25 22:28 |  | A | worktree remove --force |
| 16 | `/Users/xbugs/Projects/worktrees/dsh-complete-release-20261125` | chore/complete-release-20261125 | 8/8 | 1 | 2026-11-25 22:41 |  | B | 保持不动 |
| 17 | `/Users/xbugs/projects/worktrees/dsh-conv-windowing` | fix/conv-windowing | 5/774 | 0 | 2026-11-13 00:02 |  | B | 保持不动 |
| 18 | `/Users/xbugs/projects/worktrees/dsh-explicit-enter-send` | fix/explicit-enter-send-20261112 | 0/780 | 0 | 2026-11-12 19:10 |  | C | 保持不动 |
| 19 | `/Users/xbugs/projects/worktrees/dsh-fleet-entry-dedup-20261123` | fix/fleet-entry-dedup-20261123 | 0/0 | 0 | 2026-11-23 22:07 |  | A | worktree remove --force |
| 20 | `/Users/xbugs/projects/worktrees/dsh-header-release-20261123` | fix/header-actions-release-20261123 | 0/2 | 0 | 2026-11-23 11:27 |  | C | 保持不动 |
| 21 | `/Users/xbugs/Projects/worktrees/dsh-history-scroll-20261126` | fix/history-scroll-20261126 | 0/0 | 1 | 2026-11-27 02:36 |  | B | 保持不动 |
| 22 | `/Users/xbugs/Projects/worktrees/dsh-inline-file-link-20261125` | fix/inline-file-path-links-20261125 | 0/395 | 0 | 2026-11-25 19:28 |  | C | 保持不动 |
| 23 | `/Users/xbugs/projects/worktrees/dsh-netopt-closeout-20261123` | fix/netopt-closeout-20261123 | 0/0 | 0 | 2026-11-23 17:44 |  | A | worktree remove --force |
| 24 | `/Users/xbugs/projects/worktrees/dsh-official-build-7333589c2bb062b2bd9a79a756a32aaa4410d577` | (detached) | 0/0 | 0 | 2026-11-23 21:29 |  | A | worktree remove --force |
| 25 | `/Users/xbugs/projects/worktrees/dsh-pr7-record` | (detached) | 0/0 | 0 | 2026-11-19 07:42 |  | A | worktree remove --force |
| 26 | `/Users/xbugs/projects/worktrees/dsh-release-closeout-20261123` | release/dsh-closeout-20261123 | 0/0 | 0 | 2026-11-23 00:53 |  | A | worktree remove --force |
| 27 | `/Users/xbugs/Projects/worktrees/dsh-release-docs-agy-20261126` | docs/release-gates-agy-20261126 | 0/0 | 0 | 2026-11-25 22:28 |  | A | worktree remove --force |
| 28 | `/Users/xbugs/projects/worktrees/dsh-release-final-20261123` | release/dsh-0.2.3-final-20261123 | 0/0 | 3 | 2026-11-28 17:19 |  | B | 保持不动 |
| 29 | `/Users/xbugs/Projects/worktrees/dsh-release-tests-copilot-20261126` | fix/release-tests-copilot-20261126 | 0/0 | 0 | 2026-11-25 22:28 |  | A | worktree remove --force |
| 30 | `/Users/xbugs/projects/worktrees/dsh-session-recovery-closeout-20261123` | feat/session-recovery-closeout-20261123 | 0/0 | 0 | 2026-11-23 18:44 |  | A | worktree remove --force |
| 31 | `/Users/xbugs/projects/worktrees/dsh-sidebar-b` | feat/sidebar-minimal-nav-plugins | 0/385 | 2 | 2026-11-11 01:50 |  | B | 保持不动 |
| 32 | `/Users/xbugs/projects/worktrees/dsh-sidebar-minimal` | feat/sidebar-minimal-nav | 0/390 | 2 | 2026-11-11 00:47 |  | B | 保持不动 |
| 33 | `/Users/xbugs/projects/worktrees/dsh-sidebar-new-session-20261123` | feat/sidebar-nav-trim-20261124 | 0/0 | 1 | 2026-11-24 13:28 |  | B | 保持不动 |
| 34 | `/Users/xbugs/projects/worktrees/dsh-voice-release-20261116` | release/wechat-dictation-20261116 | 0/1 | 0 | 2026-11-16 19:09 |  | C | 保持不动 |
| 35 | `/Users/xbugs/projects/worktrees/dsh-wechat-dictation` | fix/wechat-dictation-state | 0/773 | 0 | 2026-11-14 20:06 |  | A | worktree remove --force |
| 36 | `/Users/xbugs/Projects/worktrees/sidebar-alias-bundles-20261125` | fix/sidebar-alias-bundles-20261125 | 0/0 | 0 | 2026-11-25 14:19 |  | A | worktree remove --force |

## 2. Monorepo 本地分支（46）

| 分支 | upstream | 跟踪状态 | 已合并 origin/master | 工作树 | 本地领先 | 分类 | 处置 |
|---|---|---|---|---|---|---|---|
| `chore/complete-release-20261125` | origin/master | [ahead 1, behind 44] | 否 | 是 | 1 | B | 保持 |
| `chore/liveshare-owner-endpoint-classification-20261125` | origin/chore/liveshare-owner-endpoint-classification-20261125 | - | 是 | 否 | 0 | A | git branch -d |
| `docs/release-gates-agy-20261126` | origin/master | [behind 44] | 是 | 是 | 0 | A | git branch -d |
| `feat-instant-composer` | - | - | 否 | 是 | 7 | B | 保持 |
| `feat-session-search` | - | - | 是 | 是 | 0 | A | git branch -d |
| `feat/acp-unified-mainchat-20261123` | origin/master | [ahead 1, behind 103] | 否 | 是 | 1 | B | 保持 |
| `feat/cascade-stop` | origin/feat/cascade-stop | - | 否 | 否 | 2 | C | 保持 |
| `feat/chat-async-dispatch-20261123` | origin/feat/chat-async-dispatch-20261123 | - | 是 | 是 | 0 | A | git branch -d |
| `feat/conversation-view-tabs` | - | - | 是 | 否 | 0 | A | git branch -d |
| `feat/nas-sidebar-single-row-20261127` | origin/feat/nas-sidebar-single-row-20261127 | [behind 1] | 是 | 是 | 0 | C | 保持 |
| `feat/openai-process-folding` | - | - | 是 | 否 | 0 | A | git branch -d |
| `feat/session-recovery-20261123` | origin/master | [behind 107] | 是 | 是 | 0 | B | 保持 |
| `feat/session-recovery-closeout-20261123` | origin/feat/session-recovery-closeout-20261123 | - | 是 | 是 | 0 | A | git branch -d |
| `feat/sidebar-minimal-nav` | - | - | 否 | 是 | 2 | B | 保持 |
| `feat/sidebar-minimal-nav-plugins` | - | - | 否 | 是 | 2 | B | 保持 |
| `feat/sidebar-nav-icons-20261128` | origin/master | [ahead 2] | 否 | 是 | 2 | B | 保持 |
| `feat/sidebar-nav-trim-20261124` | - | - | 否 | 是 | 1 | B | 保持 |
| `feat/sidebar-split-plugins` | origin/feat/sidebar-split-plugins | - | 是 | 是 | 0 | A | git branch -d |
| `feat/todo-eta-column-20261127` | origin/feat/todo-eta-column-20261127 | - | 否 | 否 | 2 | C | 保持 |
| `fix-boot-review-followup` | origin/fix-boot-review-followup | - | 否 | 是 | 1 | B | 保持 |
| `fix/chat-elapsed-footer-20261122` | origin/fix/chat-elapsed-footer-20261122 | - | 是 | 否 | 0 | A | git branch -d |
| `fix/chat-window-history-edge-20261124` | origin/fix/chat-window-history-edge-20261124 | - | 是 | 否 | 0 | A | git branch -d |
| `fix/chat-window-tail-20261124` | origin/fix/chat-window-tail-20261124 | - | 是 | 否 | 0 | A | git branch -d |
| `fix/client-boot-degradation` | origin/fix/client-boot-degradation | - | 否 | 否 | 1 | C | 保持 |
| `fix/client-test-types` | origin/fix/client-test-types | - | 否 | 否 | 1 | C | 保持 |
| `fix/conv-windowing` | - | - | 是 | 是 | 0 | B | 保持 |
| `fix/explicit-enter-send-20261112` | - | - | 是 | 是 | 0 | C | 保持 |
| `fix/fleet-entry-dedup-20261123` | origin/fix/fleet-entry-dedup-20261123 | - | 是 | 是 | 0 | A | git branch -d |
| `fix/header-actions-release-20261123` | origin/fix/header-actions-release-20261123 | - | 是 | 是 | 0 | C | 保持 |
| `fix/history-scroll-20261126` | origin/fix/history-scroll-20261126 | [behind 1] | 否 | 是 | 1 | B | 保持 |
| `fix/inline-file-path-links-20261125` | origin/fix/inline-file-path-links-20261125 | - | 是 | 是 | 0 | C | 保持 |
| `fix/mac-draft-model-selection-20261125` | origin/fix/mac-draft-model-selection-20261125 | - | 是 | 否 | 0 | A | git branch -d |
| `fix/mac-session-gui-20261125` | origin/master | [behind 44] | 是 | 是 | 0 | A | git branch -d |
| `fix/mainline-resolve-20261122` | - | - | 否 | 是 | 15 | B | 保持 |
| `fix/netopt-closeout-20261123` | origin/fix/netopt-closeout-20261123 | - | 是 | 是 | 0 | A | git branch -d |
| `fix/release-tests-copilot-20261126` | origin/master | [behind 44] | 是 | 是 | 0 | A | git branch -d |
| `fix/sidebar-alias-bundles-20261125` | origin/fix/sidebar-alias-bundles-20261125 | - | 是 | 是 | 0 | A | git branch -d |
| `fix/sidebar-new-session-20261123` | origin/fix/sidebar-new-session-20261123 | - | 是 | 否 | 0 | A | git branch -d |
| `fix/wechat-dictation-state` | origin/fix/wechat-dictation-state | - | 是 | 是 | 0 | A | git branch -d |
| `maintained/dsh-0.2.2` | origin/maintained/dsh-0.2.2 | [behind 6] | 是 | 否 | 0 | C | 保持 |
| `master` | origin/master | - | 是 | 否 | 0 | C | 保持 |
| `merge/sidebar-split-20261127` | origin/merge/sidebar-split-20261127 | - | 是 | 否 | 0 | A | git branch -d |
| `netopt/integration-20261123` | origin/master | [behind 100] | 是 | 是 | 0 | B | 保持 |
| `release/dsh-0.2.3-final-20261123` | - | - | 否 | 是 | 3 | B | 保持 |
| `release/dsh-closeout-20261123` | - | - | 是 | 是 | 0 | A | git branch -d |
| `release/wechat-dictation-20261116` | - | - | 是 | 是 | 0 | C | 保持 |
| `save/20261122-mac-core-manifests` | - | - | 否 | 否 | 1 | C | 保持 |

## 3. B 类明细（保留，不处置）

### 3.1 未合并提交

**`feat-instant-composer`** — `/Users/xbugs/projects/deepseek-harness/.agents/worktrees/feat-instant-composer`

- `841fded8b8 chore(release): align client fixtures and package versions for the fork build`
- `25c8d94916 feat(client-ui-conversation): keep composer editable and fail safely when disconnected`
- `dcd11d027a feat(client-ui-workspace): select reusable blank session synchronously on startSession`
- `d1d2d31347 feat(client-modules,client-web): split core and deferred boot batches for early mount`
- `887e18a715 feat(client-web): add persistent editable draft composer to boot page`
- `bd36a62ece test(session): cover cascade cancellation and record the decision`
- `67d22a105f fix(session): cascade a stopped turn into its jobs and subagents`

**`fix-boot-review-followup`** — `/Users/xbugs/projects/deepseek-harness/.agents/worktrees/fix-boot-review-followup`

- `2724b00952 fix(client-web): address boot degradation review feedback`

**`feat/acp-unified-mainchat-20261123`** — `/Users/xbugs/projects/worktrees/dsh-acp-unified-20261123-core`

- `f7c66753fd feat(acp): integrate external execution in main chat`

**`chore/complete-release-20261125`** — `/Users/xbugs/Projects/worktrees/dsh-complete-release-20261125`

- `c63067d78c release(dsh): 0.2.4`
- 未提交文件：`scripts/check-workspace-constraints.ts`, `scripts/gen-config-catalog.ts`, `scripts/verify-client-packages.ts`, `scripts/verify-product-use.ts`, `tsdown.config.ts`, `（另 3 个 .spec.ts）`

**`fix/history-scroll-20261126`** — `/Users/xbugs/Projects/worktrees/dsh-history-scroll-20261126`

- `e71776cd8f fix(ui-chat): re-anchor the bounded history window on order growth`

**`feat/sidebar-minimal-nav-plugins`** — `/Users/xbugs/projects/worktrees/dsh-sidebar-b`

- `faf653df76 feat(ui-sidebar): keep the plugins entry in the minimal navigation`
- `da0c273f0c feat(ui-sidebar): gate minimal functional navigation behind a build flag`

**`feat/sidebar-minimal-nav`** — `/Users/xbugs/projects/worktrees/dsh-sidebar-minimal`

- `565bc173ee feat(ui-sidebar): keep the Plugins row in the minimal navigation`
- `da0c273f0c feat(ui-sidebar): gate minimal functional navigation behind a build flag`

**`feat/sidebar-nav-trim-20261124`** — `/Users/xbugs/projects/worktrees/dsh-sidebar-new-session-20261123`

- `556e2648f5 feat(ui-sidebar): move context insights into the header row`

**`release/dsh-0.2.3-final-20261123`** — `/Users/xbugs/projects/worktrees/dsh-release-final-20261123`

- `b987aa9f7a feat(ui-sidebar): top-row navigation, ambient glyph motion`
- `57acee382d feat(ui-sidebar): two-tone animated navigation glyphs`
- `43dc4b15ce feat(ui-sidebar): animate the global navigation glyphs`

### 3.2 未提交改动（已跟踪文件）

**`feat/session-recovery-20261123`** — `/Users/xbugs/projects/dsh-session-recovery-20261123`

- `docs/persistence-catalog.md`
- `docs/persistence-catalog.zh.md`
- `docs/persistence-catalog.i18n.yaml`
- `docs/persistence-schema.json`
- `packages/api/session-controller/README.md`
- `packages/api/session-controller/README.zh.md`
- `packages/api/session-controller/package.json`
- `packages/api/session-controller/src/commands.ts`
- `packages/api/session-controller/src/types.ts`
- `packages/api/session-controller/tsconfig.host.json`
- `packages/core/session/src/known-event-types.ts`
- `pnpm-lock.yaml`

**`netopt/integration-20261123`** — `/Users/xbugs/projects/netopt-20261123/core`

- `UU docs/config-catalog.md`
- `UU docs/config-catalog.zh.md`
- `UU packages/api/session-controller/README.i18n.yaml`
- `UU README.md/README.zh.md`
- `packages/api/session-controller/src/**（12 文件）`
- `packages/client/web/tests/deferred-boot.client.spec.ts`

**`fix/conv-windowing`** — `/Users/xbugs/projects/worktrees/dsh-conv-windowing`

- `packages/client/ui-conversation/src/client/contract/snapshot.ts`
- `.../conversation/assembler.ts`
- `.../conversation/assembly.ts`
- `.../client/index.ts`
- `.../skeleton/DefaultConversationViews.tsx`

## 4. 外部仓库（项目目录，去重）

| 路径 | HEAD | 脏文件 | 未合并提交 | upstream | 最近提交 |
|---|---|---|---|---|---|
| `~/projects/dsh-a2ui` | main | 0（已跟踪 0） | 0 | origin/main | 2026-11-13 |
| `~/projects/dsh-achievements` | main | 0（已跟踪 0） | - | origin/main | 2026-11-28 |
| `~/projects/dsh-client-ui-sidebar` | main | 0（已跟踪 0） | - | origin/main | 2026-11-27 |
| `~/projects/dsh-copilot-acp-subscription-ux-20261125` | HEAD | 2（已跟踪 0） | - | none | 2026-11-25 |
| `~/projects/dsh-copilot-acp-unified-20261123` | feat/unified-mainchat-20261123 | 0（已跟踪 0） | - | origin/feat/unified-mainchat-20261122 | 2026-11-28 |
| `~/projects/dsh-nas-stack` | fix/home-independent-node-modules-20261128 | 4（已跟踪 2） | 3 | none | 2026-11-28 |
| `~/projects/dsh-ops-center` | main | 0（已跟踪 0） | 0 | origin/main | 2026-11-22 |
| `~/projects/dsh-plantuml` | main | 1（已跟踪 0） | 7 | gitea/main | 2026-11-18 |
| `~/projects/dsh-plantuml-public` | main | 0（已跟踪 0） | 0 | origin/main | 2026-11-22 |
| `~/projects/dsh-plugin-workbench` | main | 0（已跟踪 0） | - | origin/main | 2026-11-28 |
| `~/projects/dsh-session-fts` | main | 0（已跟踪 0） | 1 | origin/main | 2026-11-28 |
| `~/projects/dsh-session-fts-compact-20261122` | fix/compact-search-20261122 | 0（已跟踪 0） | 0 | none | 2026-11-22 |
| `~/projects/dsh-session-memory` | main | 0（已跟踪 0） | 0 | origin/main | 2026-11-23 |
| `~/projects/dsh-task-center` | master | 0（已跟踪 0） | 0 | origin/master | 2026-11-24 |
| `~/projects/magpie-ultrafast-capability-20261125` | HEAD | 0（已跟踪 0） | - | none | 2026-11-18 |
| `~/projects/work-dsh-422-runtime-source-20261122` | fix/work-422 | 1（已跟踪 0） | - | none | 2026-11-23 |
| `~/projects/worktrees/dsh-board-toolbar-20261123` | fix/board-toolbar-layout-20261123 | 0（已跟踪 0） | 0 | none | 2026-11-23 |
| `~/projects/worktrees/dsh-complete-gui-20261125` | fix/mac-session-gui-20261125 | 0（已跟踪 0） | 0 | origin/master | 2026-11-25 |
| `~/projects/worktrees/dsh-complete-release-20261125` | chore/complete-release-20261125 | 16（已跟踪 8） | 1 | origin/master | 2026-11-25 |
| `~/projects/worktrees/dsh-history-scroll-20261126` | fix/history-scroll-20261126 | 0（已跟踪 0） | 1 | origin/fix/history-scroll-20261126 | 2026-11-27 |
| `~/projects/worktrees/dsh-inline-file-link-20261125` | fix/inline-file-path-links-20261125 | 395（已跟踪 0） | 0 | origin/fix/inline-file-path-links-20261125 | 2026-11-25 |
| `~/projects/worktrees/dsh-open-latency-agy-20261126` | fix/open-latency-agy-20261126 | 0（已跟踪 0） | 0 | none | 2026-11-26 |
| `~/projects/worktrees/dsh-release-docs-agy-20261126` | docs/release-gates-agy-20261126 | 0（已跟踪 0） | 0 | origin/master | 2026-11-25 |
| `~/projects/worktrees/dsh-release-tests-copilot-20261126` | fix/release-tests-copilot-20261126 | 0（已跟踪 0） | 0 | origin/master | 2026-11-25 |
| `~/projects/worktrees/dsh-session-fts-0311-mainline-20261124` | HEAD | 0（已跟踪 0） | - | none | 2026-11-24 |
| `~/projects/worktrees/dsh-session-fts-admitted-peer-20261124` | fix/admitted-peer-contract-20261124 | 2（已跟踪 0） | 0 | origin/fix/admitted-peer-contract-20261124 | 2026-11-24 |
| `~/projects/worktrees/dsh-session-fts-auth-compat-20261124` | fix/connection-admit-compat-20261124 | 2（已跟踪 0） | 0 | origin/fix/connection-admit-compat-20261124 | 2026-11-24 |
| `~/projects/worktrees/dsh-session-fts-auth-mainline-20261124` | HEAD | 0（已跟踪 0） | - | none | 2026-11-24 |
| `~/projects/worktrees/dsh-session-fts-core023-20261123` | compat/core-0.2.3-20261123 | 0（已跟踪 0） | 0 | origin/compat/core-0.2.3-20261123 | 2026-11-23 |
| `~/projects/worktrees/dsh-session-memory-core023-20261123` | compat/core-0.2.3-20261123 | 0（已跟踪 0） | 0 | origin/compat/core-0.2.3-20261123 | 2026-11-23 |
| `~/projects/worktrees/dsh-sidebar-nav-icons-20261128` | feat/sidebar-nav-icons-20261128 | 1（已跟踪 0） | 1 | origin/master | 2026-11-28 |
| `~/projects/worktrees/dsh-task-center-0215-mainline-20261124` | HEAD | 0（已跟踪 0） | - | none | 2026-11-24 |
| `~/projects/worktrees/dsh-task-center-0216-mainline-20261124` | HEAD | 0（已跟踪 0） | - | none | 2026-11-24 |
| `~/projects/worktrees/dsh-task-center-auth-mainline-20261124` | HEAD | 0（已跟踪 0） | - | none | 2026-11-24 |
| `~/projects/worktrees/dsh-task-center-release-20261123` | release/task-center-0.2.13-20261123 | 6（已跟踪 5） | 0 | none | 2026-11-23 |
| `~/projects/worktrees/dsh-taskcenter-admitted-peer-20261124` | fix/admitted-peer-contract-20261124 | 3（已跟踪 0） | 0 | origin/fix/admitted-peer-contract-20261124 | 2026-11-24 |
| `~/projects/worktrees/dsh-taskcenter-auth-compat-20261124` | fix/connection-admit-compat-20261124 | 3（已跟踪 0） | 0 | origin/fix/connection-admit-compat-20261124 | 2026-11-24 |
| `~/projects/worktrees/dsh-taskcenter-board-peer-20261124` | fix/vendor-board-peer-20261124 | 2（已跟踪 0） | 0 | origin/fix/vendor-board-peer-20261124 | 2026-11-24 |
| `~/projects/worktrees/dsh-taskcenter-closeout-20261123` | fix/taskcenter-closeout-20261123 | 1（已跟踪 0） | 0 | origin/fix/taskcenter-closeout-20261123 | 2026-11-23 |
| `~/projects/worktrees/fleet-dsh-output` | fix/agy-empty-output | 0（已跟踪 0） | 4 | none | 2026-11-06 |
| `~/projects/worktrees/fleet-dsh-tasks` | feat/dsh-task-delivery | 0（已跟踪 0） | 2 | origin/main | 2026-11-06 |
| `~/projects/worktrees/hermes-dependency-followup-20261125` | fix/pydantic-requirements-pair-20261125 | 0（已跟踪 0） | 1 | origin/fix/pydantic-requirements-pair-20261125 | 2026-11-25 |
| `~/projects/worktrees/sidebar-alias-bundles-20261125` | fix/sidebar-alias-bundles-20261125 | 0（已跟踪 0） | 0 | origin/fix/sidebar-alias-bundles-20261125 | 2026-11-25 |
| `~/projects/worktrees/sidebar-followup-release-20261125` | master | 1（已跟踪 0） | 0 | origin/master | 2026-11-25 |
| `~/projects/worktrees/workbench-dsh-app` | feat/dsh-standalone-app | 0（已跟踪 0） | 13 | origin/main | 2026-11-06 |
| `~/projects/worktrees/workbench-dsh-integration` | HEAD | 0（已跟踪 0） | - | none | 2026-11-06 |
| `~/projects/worktrees/workbench-dsh-release` | feat/dsh-standalone-release | 0（已跟踪 0） | 7 | none | 2026-11-06 |
| `~/projects/worktrees/workbench-dsh-runtime` | feat/dsh-runtime | 0（已跟踪 0） | 4 | origin/main | 2026-11-06 |
| `~/projects/worktrees/workbench-dsh-services` | feat/dsh-application-services | 0（已跟踪 0） | 4 | origin/main | 2026-11-06 |

去重后共 49 个独立仓库（已排除 monorepo 注册工作树）；其中含未提交改动的：`dsh-nas-stack`（2 个已跟踪文件）、`dsh-plantuml`（1）、`dsh-copilot-acp-subscription-ux-20261125`（2 个未跟踪）、`dsh-session-fts`（1 个本地领先提交）。上述仓库均为独立远端，不在本次 monorepo 清理范围内，仅登记。

## 5. 统计与清理计划

- 工作树：A 17 / B 12 / C 7（合计 36）
- 本地分支：A 21 / B 14 / C 12（合计 47）
- A 类 worktree 磁盘占用合计约 30.6 GB（以 `du -sh` 实测）
- 清理动作：`worktree prune` 2 条记录、`worktree remove --force` 15 个目录、`branch -d` 21 条已合并分支；B/C 类 0 改动

### A 类分支（待删除，均为已合并）

```
chore/liveshare-owner-endpoint-classification-20261125
docs/release-gates-agy-20261126
feat-session-search
feat/chat-async-dispatch-20261123
feat/conversation-view-tabs
feat/openai-process-folding
feat/session-recovery-closeout-20261123
feat/sidebar-split-plugins
fix/chat-elapsed-footer-20261122
fix/chat-window-history-edge-20261124
fix/chat-window-tail-20261124
fix/fleet-entry-dedup-20261123
fix/mac-draft-model-selection-20261125
fix/mac-session-gui-20261125
fix/netopt-closeout-20261123
fix/release-tests-copilot-20261126
fix/sidebar-alias-bundles-20261125
fix/sidebar-new-session-20261123
fix/wechat-dictation-state
merge/sidebar-split-20261127
release/dsh-closeout-20261123
```

### 保留基线（清理后）

| 分支 | 用途 |
|---|---|
| `master` | 唯一开发主干，始终对齐 `origin/master` |
| `release/*` | 仅发布快照：`release/dsh-0.2.3-final-20261123`（活跃） |
| `maintained/dsh-0.2.2` | 0.2.2 维护线指针（远端存在，已并入 master） |
| B 类特性分支 | 有未合并提交/未提交改动，清理完成后按 PR 收口 |

### 防止改动丢失的口径

1. 任何特性改动必须从 `origin/master` 开分支（`git fetch && git worktree add -b <type>/<name> ...`），禁止在主检出直接开发。
2. 分支合并进 `master` 后才允许部署；未合并分支只做本地验证，不进入发布链路。
3. 合并后立即 `git worktree remove` + `git branch -d`，分支生命周期与 PR 生命周期一致。
4. 每日检查 `git worktree list` 与 `git branch --no-merged origin/master`，B 类超过 3 天未推进则收口或放弃。

### 回滚

- 所有被删分支的 tip 均存在于 `origin/master`（`--merged` 校验），重建：`git branch <name> <sha>`。
- 被删 worktree 可从 `origin` 重新 `git worktree add`；未跟踪构建产物重新构建即可。
- prunable 记录仅删除 `.git/worktrees/*` 管理文件，不删除对象。
