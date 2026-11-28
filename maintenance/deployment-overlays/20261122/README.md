# Maintained deployment overlays

These patches preserve executable local overrides on top of this fork's native history, including the unified-search, compact-brand and composer-menu source commits. They are maintained patch inputs with exact base and result SHA256 values; they are not a claim that rebuilding TypeScript alone reproduces every deployed byte.

The manifest names each npm package, base artifact and changed file. Published npm bases use version 0.2.2-rc.1. Four corrected base artifacts already contain earlier Host/UI changes and must be supplied from the retained release artifacts; their hashes are checked. No profile, personal policy, credential, session, model cache or lock configuration is stored here. Licenses remain those of this repository and the original packages.

Run `python3 replay.py <package-name> <base.tgz> <new-output-directory> [original-build-root]`. Sidebar source-map comments use a placeholder instead of the operator's private home path; supply the original build root as the fourth argument for exact replay. The output directory must not exist. Replay reads regular files named by the manifest, verifies each baseline digest, applies the patch and verifies every result digest. It does not install packages, edit a profile or restart a service. Capture verification independently matched every result to the deployed file bytes on 2026-11-22.

A package without changed files matches its named base at the code surfaces inspected; that does not assert its corrected base was an unmodified official release. Runtime package versions, pins and candidate source versions remain separately recorded in the deployment inventory.

## Shared-DSH_HOME mode (attachment-local) — upstreamed 2026-11-28

`dsh-attachment-local.patch` exists only because a shared `DSH_HOME` can already be private while another UID owns it, where the unconditional `chmod 0o700` needs `CAP_FOWNER`. That mode check is now in `packages/attachment/attachment-local/src/store.ts` (`ensureDurableDirectory` only chmods a directory whose mode is wider than private), so a build from this branch needs no patched copy: enable the stock `attachment-local` and drop the overlay insert from the profile.

Deployment hazard this overlay created, hit on 2026-11-28: a patched copy replays outside the pnpm store, so it has no `node_modules` of its own. Copying `DSH_HOME` to another host (or excluding `node_modules`) then left `sharp` unresolvable, and every image upload failed with `Cannot find module 'sharp'` while plain text chat kept working. Any overlay package deployed as a directory must resolve its declared runtime dependencies at the deployed path, and the deployment check must upload one image through `POST /api/session/uploadFileBinary?mediaType=…` rather than only loading the host.
