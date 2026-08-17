# Contributing

English | [中文](#贡献指南)

Contributions are welcome. This is a small, focused plugin, so a little coordination up front saves everyone time.

## Before you write code

**Open an issue first** for anything beyond a typo or an obvious bug fix — a new tool, a config field, a behavior change, a new dependency. A short description of the problem you hit is enough. It avoids the case where a finished PR turns out to conflict with the plugin's design.

Bug reports are always welcome without an issue-first discussion: include your OS, Node version, browser channel, the plugin config you used, and what the agent did versus what you expected.

## Pull requests

- Base on `main`; keep one PR to one concern.
- `corepack pnpm install && corepack pnpm run build` must pass (CI checks this).
- Say in the PR body **what you changed and how you verified it** — a real run against a real page beats "looks right". Screenshots or the agent transcript are ideal.
- Match the surrounding code: named exports only (no default export in this plugin), every tunable is a `Config` field rather than a constant, every registration goes through `ctx.effect` / `ctx.on` so unloading unwinds it, and tool presenters stay pure functions of their arguments.
- New model-facing text (tool descriptions, error messages) is part of the interface: write it for the model, state what to do next, and keep it terse.

## Packaging: the harness's modules are peer dependencies

A dsh plugin must declare `@deepseek-ai/*` runtime modules — `dsh-tools`, `dsh-skill`, `dsh-subagent`, `schemastery`, `cordis` — as **`peerDependencies` with `*`**, never as `dependencies`. Keep a matching `devDependencies` entry so the plugin still builds and tests locally.

This is not a style preference. Declaring them as dependencies installs a **second copy** into the user's profile. The loader then resolves the harness's own service rows against that copy while the in-box agent loop keeps its originals, and because the tool scheduler is looked up by a module-level `Symbol`, the lookup misses. Every tool call then fails — including built-in ones like `bash`:

```
dsh: UNKNOWN: Cannot read properties of undefined (reading 'prepare')
```

The user sees a completely broken harness and has no reason to suspect a plugin. This repo shipped that bug in 0.1.0 and fixed it in 0.1.1; the official plugin-authoring docs do not mention it yet, and the community has hit it repeatedly ([#2731](https://github.com/deepseek-ai/deepseek-harness/discussions/2731), [#1849](https://github.com/deepseek-ai/deepseek-harness/discussions/1849), [#1337](https://github.com/deepseek-ai/deepseek-harness/discussions/1337)).

**Unit tests and CI cannot catch it.** A linked checkout resolves its own dependencies, so the duplicate never appears; the failure only shows up when the published package is installed into a clean profile and a tool is actually called. Before releasing, verify that path:

```sh
pnpm pack
dsh plugin --profile <a throwaway profile> add ./<package>-<version>.tgz
ls ~/.dsh/profiles/<name>/node_modules/@deepseek-ai   # must be empty
dsh --profile <name> "run echo ok"                    # a built-in tool must still work
```

---

## Security

Do not open a public issue for a security problem (sandbox escape, credential exposure, subagent escape or credential exposure). Use GitHub's private vulnerability reporting on this repository instead.

---

# 贡献指南

欢迎贡献。这是一个小而专注的插件，动手前稍作沟通能省下双方的时间。

## 写代码之前

除了错别字和显而易见的 bug 修复，**请先开一个 issue**——新工具、新配置项、行为变更、新依赖都算。简单描述你遇到的问题即可，避免辛苦写完的 PR 与插件设计冲突。

Bug 报告随时欢迎，不需要先讨论：请附上操作系统、Node 版本、浏览器渠道、你使用的插件配置，以及 agent 实际行为与你的预期。

## 提交 PR

- 基于 `main`；一个 PR 只做一件事。
- 必须能通过 `corepack pnpm install && corepack pnpm run build`（CI 会检查）。
- 在 PR 描述里说明**你改了什么、如何验证的**——真实页面上的实跑远胜过"看着没问题"，附截图或 agent 对话记录最佳。
- 与现有代码保持一致：只用具名导出（本插件没有 default export）、可调项一律做成 `Config` 字段而非常量、所有注册走 `ctx.effect` / `ctx.on` 以便卸载时自动回收、工具的展示函数保持为参数的纯函数。
- 面向模型的文本（工具描述、错误信息）属于接口的一部分：为模型而写，说清下一步该做什么，保持简洁。

## 打包：harness 的模块必须是 peer 依赖

dsh 插件必须把 `@deepseek-ai/*` 运行时模块——`dsh-tools`、`dsh-skill`、`dsh-subagent`、`schemastery`、`cordis`——声明为 **`peerDependencies` 且版本写 `*`**，绝不能放进 `dependencies`。同时在 `devDependencies` 里保留一份，本地才能编译和测试。

这不是风格偏好。放进 dependencies 会在用户的 profile 里装出**第二份副本**：加载器随后把 harness 自己的服务行解析到副本上，而内置的 agent loop 仍用原本那份；由于工具调度器是通过模块顶层的 `Symbol` 查找的，这一查就落空。此后**所有**工具调用都会失败，包括 `bash` 这样的内置工具：

```
dsh: UNKNOWN: Cannot read properties of undefined (reading 'prepare')
```

用户看到的是整个 harness 瘫痪，而且完全没有理由怀疑到插件头上。本仓库在 0.1.0 犯过这个错，0.1.1 已修复；官方的插件开发文档目前尚未提及此事，社区则反复踩中（[#2731](https://github.com/deepseek-ai/deepseek-harness/discussions/2731)、[#1849](https://github.com/deepseek-ai/deepseek-harness/discussions/1849)、[#1337](https://github.com/deepseek-ai/deepseek-harness/discussions/1337)）。

**单元测试和 CI 都发现不了它。** 本地链接安装的插件从自己的 checkout 解析依赖，副本根本不会出现；只有把已发布的包装进干净 profile 并真正调用一次工具，问题才会暴露。发版前请走一遍这条路径：

```sh
pnpm pack
dsh plugin --profile <一次性 profile> add ./<包名>-<版本>.tgz
ls ~/.dsh/profiles/<名字>/node_modules/@deepseek-ai   # 必须为空
dsh --profile <名字> "运行 echo ok"                    # 内置工具必须仍然可用
```

---

## 安全问题

请**不要**为安全问题（沙箱逃逸、凭证泄漏、子代理逃逸、凭证泄漏）开公开 issue，改用本仓库的 GitHub 私密漏洞报告功能。
