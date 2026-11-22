# Maintained deployment overlays

These patches preserve executable local overrides on top of this fork's native history, including the unified-search, compact-brand and composer-menu source commits. They are maintained patch inputs with exact base and result SHA256 values; they are not a claim that rebuilding TypeScript alone reproduces every deployed byte.

The manifest names each npm package, base artifact and changed file. Published npm bases use version 0.2.2-rc.1. Four corrected base artifacts already contain earlier Host/UI changes and must be supplied from the retained release artifacts; their hashes are checked. No profile, personal policy, credential, session, model cache or lock configuration is stored here. Licenses remain those of this repository and the original packages.

Run `python3 replay.py <package-name> <base.tgz> <new-output-directory> [original-build-root]`. Sidebar source-map comments use a placeholder instead of the operator's private home path; supply the original build root as the fourth argument for exact replay. The output directory must not exist. Replay reads regular files named by the manifest, verifies each baseline digest, applies the patch and verifies every result digest. It does not install packages, edit a profile or restart a service. Capture verification independently matched every result to the deployed file bytes on 2026-11-22.

A package without changed files matches its named base at the code surfaces inspected; that does not assert its corrected base was an unmodified official release. Runtime package versions, pins and candidate source versions remain separately recorded in the deployment inventory.
