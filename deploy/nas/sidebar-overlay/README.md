# Existing NAS sidebar overlay

This directory records an existing NAS-only compact navigation customization and its Bot Team entry correction. It is deployment source for that customization, not a change to the default sidebar. Do not apply it to work, new installations, or the shared `packages/client/ui-sidebar/src/client/SidebarRoot.tsx`.

## Recorded source

`SidebarRoot.js` is the complete readable emitted module captured from the existing overlay's `lib/types/client/SidebarRoot.js`, with one corrected navigation declaration. It retains the existing imports and JSX-runtime calls; it is a traceable snapshot, not a standalone runnable package or a replacement for the upstream TypeScript source. Its CSS and other imports belong to the existing overlay and are not changed by this correction.

The historical deployment receipt dated 2026-11-21 identifies compact-sidebar overlay commit `80684d747a9595c2fcf65800ddb023d1ab336411`, branch `fix/unified-search-20261122`. That receipt describes a CSS-only overlay which deliberately preserved the pre-existing minimal-navigation JavaScript. It does not prove that commit first introduced the navigation whitelist. Subsequent NAS deployments explicitly retained the local sidebar.

At upstream commit `202740aea419e626d4f1eb91ed0fefa864cbe5e1`, the default sidebar source has no `NAV_PANEL_IDS` whitelist. Therefore the correction is deliberately isolated here and does not alter upstream navigation behavior.

## Behavior change

The retained NAS customization listed only task-center and task-board navigation entries, plus the context header entry. Bot Team successfully registered `sidebar.panellist` with id `bot-team`, but the local whitelist excluded it. Adding `bot-team` preserves the customization and exposes the already registered Bot Team page.

`provenance.json` records SHA256 values of both the original and corrected readable module, and the original and corrected actual client bundle. It also records the exact unique before/after declarations for the bundle. No private profile, account, token, credential or browser state is included.

## Applying to the existing overlay

Deployment is explicit and performed by the NAS deployment owner after this source is merged. This directory does not automatically change production.

1. Verify both existing file hashes against `provenance.json`. A mismatch requires review of the current overlay; do not blindly overwrite a changed file.
2. Preserve rollback copies. Under the existing deployment coordination/lock, replace only the unique `originalDeclaration` with `correctedDeclaration` in `lib/client.js`. Verify the resulting SHA256 equals `existingClientBundle.correctedSha256`.
3. Keep the readable emitted module in sync by applying its corresponding unique declaration replacement and verifying `sourceSnapshot.correctedSha256`. Do not replace unrelated files or rebuild the twelve core packages.
4. Retain the existing CSS, locale files, package identity, runtime bindings and profile keys. Existing source maps were generated before this deployment-only correction; the declaration changes columns on that generated line, so a future rebuild must regenerate source maps rather than claiming their generated positions remain exact.
5. Use the deployment owner's normal client reload/cache invalidation mechanism and verify the actual served response includes the corrected declaration. Reopen the existing NAS page and check the sidebar's Bot Team entry opens the Bot Team welcome/management page. The built-in fleet tab is a separate feature.

## Validation already performed

A separate browser context intercepted only the sidebar-containing HTTP response and added `bot-team` to the whitelist. No server files or profile settings were changed. With default motion at 390×844, the Bot Team entry appeared and opened the actual welcome page with Bot management and Create Bot controls. No page errors occurred, no bots were created, and no model was invoked.
