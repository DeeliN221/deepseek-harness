---
description: "通过轻量兼容组合包，将规范的 Files 侧边栏行安装到 dsh web profile。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-client-sidebar-files

[English](README.md) | 中文

## 概述

使用此兼容组合包，可将 Files 侧边栏行添加到 dsh web profile。随发行版提供的 profile 默认不包含此组合包；可通过 `dsh plugin` 为指定 profile 添加或移除它。规范的 `ui-sidebar-files` 包负责浏览器行为，本包仅提供 profile patch。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 安装到 profile

对使用 dsh web 客户端的 profile 运行以下命令：

```text
dsh plugin --profile <name> add @deepseek-ai/dsh-client-sidebar-files
dsh plugin --profile <name> remove @deepseek-ai/dsh-client-sidebar-files
```

内置组合包从 dsh 安装目录解析。profile reconcile 会读取本包的 `dsh.bundle.patch` 声明并应用该行；缺少此声明的包不能作为 profile 层安装。

### 你会获得什么

此层插入由 `@deepseek-ai/dsh-client-ui-sidebar-files` 提供的 `ui-sidebar-files` 行。该规范包负责 Files 页面及预览旁显示的工作区导航器。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`cordis.patch.yml` 按 id 插入一行，并指定规范 UI 包。本别名不含浏览器实现；其包依赖会让规范包对 profile 可用。

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 插入规范 Files 侧边栏行。 |
| [`ui-sidebar-files`](../ui-sidebar-files/README.zh.md) | 说明浏览器功能及其行为。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [规范 Files 侧边栏包](../ui-sidebar-files/README.zh.md)
- [Profile 约定](../../boot/app-boot/README.zh.md)
- [随附 profile 的组合](../../../apps/cli/composition.md)

-----

<a id="model-experience"></a>
## 模型体验

无，因为本组合包仅声明一条 profile 补丁，侧边栏行与全部浏览器侧行为由规范 UI 包负责。

#### KV Cache 影响

无；本组合包不提供面向模型的内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 此行仅适用于包含规范 UI 包的 dsh web profile。
- 本兼容包不实现 Files 页面或工作区导航器。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
