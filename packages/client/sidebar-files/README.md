---
description: "Install the canonical Files sidebar row into a dsh web profile through a small compatibility bundle."
kind: "package-bundle"
---

# @deepseek-ai/dsh-client-sidebar-files

English | [中文](README.zh.md)

## Summary

Add the Files sidebar row to a dsh web profile with this compatibility bundle. Shipped profiles do not include the bundle by default; add or remove it from a named profile with `dsh plugin`. The canonical `ui-sidebar-files` package owns the browser behavior, while this package contributes its profile patch.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Install into a profile

Run these commands for a profile that uses the dsh web client:

```text
dsh plugin --profile <name> add @deepseek-ai/dsh-client-sidebar-files
dsh plugin --profile <name> remove @deepseek-ai/dsh-client-sidebar-files
```

An in-box bundle resolves from the dsh installation. Profile reconciliation reads this package's `dsh.bundle.patch` declaration and applies the row; a package without that declaration is not an installable profile layer.

### What you get

The layer inserts the `ui-sidebar-files` row supplied by `@deepseek-ai/dsh-client-ui-sidebar-files`. That canonical package owns the Files page and the workspace navigator shown beside previews.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`cordis.patch.yml` inserts one row by id and names the canonical UI package. The alias contains no browser implementation; its package dependency makes the canonical package available to the profile.

| File | Responsibility |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Inserts the canonical Files sidebar row. |
| [`ui-sidebar-files`](../ui-sidebar-files/README.md) | Documents the browser feature and its behavior. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Canonical Files sidebar package](../ui-sidebar-files/README.md)
- [Profile contract](../../boot/app-boot/README.md)
- [Shipped profile composition](../../../apps/cli/composition.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as the compatibility bundle only declares a profile patch and the canonical UI package owns the sidebar row and every browser-side behavior.

#### KV Cache effect

None; this bundle contributes no model-facing content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The row is useful only in a dsh web profile that includes the canonical UI package.
- This compatibility package does not implement the Files page or the workspace navigator.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
