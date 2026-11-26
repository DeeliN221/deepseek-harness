---
description: "Install the canonical Terminal sidebar row into a dsh web profile through a small compatibility bundle."
kind: "package-bundle"
---

# @deepseek-ai/dsh-client-sidebar-terminal

English | [中文](README.zh.md)

## Summary

Add the Terminal sidebar row to a dsh web profile with this compatibility bundle. Shipped profiles do not include the bundle by default; add or remove it from a named profile with `dsh plugin`. The canonical `ui-sidebar-terminal` package owns the browser behavior, while this package contributes its profile patch.

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
dsh plugin --profile <name> add @deepseek-ai/dsh-client-sidebar-terminal
dsh plugin --profile <name> remove @deepseek-ai/dsh-client-sidebar-terminal
```

An in-box bundle resolves from the dsh installation. Profile reconciliation reads this package's `dsh.bundle.patch` declaration and applies the row; a package without that declaration is not an installable profile layer.

### What you get

The layer inserts the `ui-sidebar-terminal` row supplied by `@deepseek-ai/dsh-client-ui-sidebar-terminal`. That canonical package owns interactive terminal tabs in the right sidebar.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`cordis.patch.yml` inserts one row by id and names the canonical UI package. The alias contains no browser implementation; its package dependency makes the canonical package available to the profile.

| File | Responsibility |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Inserts the canonical Terminal sidebar row. |
| [`ui-sidebar-terminal`](../ui-sidebar-terminal/README.md) | Documents the browser feature and its behavior. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Canonical Terminal sidebar package](../ui-sidebar-terminal/README.md)
- [Profile contract](../../boot/app-boot/README.md)
- [Shipped profile composition](../../../apps/cli/composition.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as the compatibility bundle only declares a profile patch and the canonical UI package owns the terminal row and every browser-side behavior.

#### KV Cache effect

None; this bundle contributes no model-facing content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The row is useful only in a dsh web profile that includes the canonical UI package.
- This compatibility package does not implement terminal tabs or shell execution.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
