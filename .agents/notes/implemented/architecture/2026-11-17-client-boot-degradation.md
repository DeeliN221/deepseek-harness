# Agent Note: Client boot degradation

Status: implemented

English | [中文](2026-11-17-client-boot-degradation.zh.md)

## Problem

Browser boot audited the complete client roster and rejected startup when any entry was not active. An installed plugin whose bundle failed to import, whose `apply` threw, or whose services never arrived therefore produced a boot page and no application.

Third-party plugins make that case routine. Cordis waits for an injected service without a timeout, so one missing provider leaves every consumer pending: a client `uiConversation` that never provided its service left ten built-in consumers pending, and the page could not mount at all. The one surface that turns a plugin off — Settings → Plugins — is part of the application that failed to mount, so the user had no path back inside the page.

Host startup already separates entries the application cannot run without from entries it merely prefers ([required startup ids](../../../../packages/boot/app-boot/src/index.ts)); the browser half had no such split.

## Decision

Boot reports instead of rejecting, and the shell mounts over whatever did not activate. The [client plugin loading model](2026-07-23-client-plugin-loading-model.md) owns module arrival, Cordis lifecycle, and HMR; this note owns which failures stop the mount.

| Piece | Owner | Behavior |
| --- | --- | --- |
| `auditEntries` | [`boot-client.ts`](../../../../packages/client/web/src/boot-client.ts) | Returns one failure per non-active entry with its reason: import error, missing services, or fiber state |
| `REQUIRED_CLIENT_ENTRY_IDS` | [`boot-client.ts`](../../../../packages/client/web/src/boot-client.ts) | `connection`, `ui-layout`, `ui-renderer` — the Host connection, the layout that contributes `root`, and the renderer that owns the React root |
| `fatalFailures` | [`boot-client.ts`](../../../../packages/client/web/src/boot-client.ts) | Selects the failures that still stop the mount |
| `renderBootNotice` | [`boot-notice.ts`](../../../../packages/client/web/src/boot-notice.ts) | Page-local, dismissible notice outside the React mount point naming every skipped row and its reason |

`bootClient` returns the complete failure list; `AppWebEntry.run` throws only for a required failure and otherwise mounts, then renders the notice. The boot page keeps reporting progress and no longer projects per-entry failures, because those are no longer fatal.

A skipped row stays in the Loader tree and stays inert: Cordis never activates a fiber whose import failed or whose services never arrive, and a consumer of a service nobody provides stays pending indefinitely. Because the entry is retained, a provider that arrives through live graph synchronization later in the session activates its consumers; the notice is rendered once per page load and does not follow them.

## Alternatives considered

**Keep strict boot and add a recovery link to the boot page.** The boot page has no RPC: fetching the plugin-manager API from a framework-free page would duplicate the settings surface, and the page still could not render a conversation.

**Treat every row as optional.** A missing `connection`, `ui-layout`, or `ui-renderer` would then mount a shell that can neither reach the Host nor draw anything, which reports less than the boot page's named failure. The split keeps the diagnosable failure for these three and degrades everywhere else.

**Refuse to publish a boot graph whose services have no provider on the Host.** Service provision is a runtime fact: `apply` may register late, and a plugin can legitimately activate after its consumers. The Host cannot know, so it cannot decide.

**Time out pending entries during the audit.** Cordis `PENDING` is a durable state, not slowness; a timeout would add timer policy to the boot path and still produce the same report.

## Consequences

The shell, the settings that disable plugins, and the agent conversation survive any third-party client plugin, which is the point: a broken plugin costs its own features, not the page.

Three costs come with it. The required set is policy, not detection — a shell-critical entry added later degrades instead of failing loudly unless it is also added to `REQUIRED_CLIENT_ENTRY_IDS`. A skipped row's consumers remain `pending` in the Loader, so a late provider silently turns them on while the notice still lists them. And a page that mounts with a broken chat plugin looks intact until the notice is read, so the notice must stay visible and out of the way rather than auto-dismiss.

The regression tests are `packages/client/web/tests/boot-client.client.spec.ts` (audit, required selection, report text), `boot.client.spec.ts` (an optional failure mounts and shows the notice; a required failure still fails), and `boot-notice.client.spec.ts` (rendering and dismissal).
