# dsh-review

[English](README.md) | 中文

**为 DeepSeek Harness 打包好的多代理对抗式代码审查。**

状态：**M0** —— `review` 工具已端到端可用。

## 要解决的问题

dsh 自带了多代理所需的原语——子代理、workflow、ralph 循环——但没有把它们打包成一个**结论可信**的审查。朴素地并行跑几个审查代理，你会得到一大堆听起来很有道理的发现，其中大部分是错的；甄别它们花的时间比审查省下的还多。「AI 代码审查误报太多」正是大家用几次就放弃的原因。

## 方法

两个阶段，**第二个才是关键**：

1. **找问题** —— 多个 finder 并行，每个带一个独立视角（正确性、生命周期/并发、API 契约、安全），每条发现必须给出具体的失败场景，而不是风格意见。
2. **对抗式验证** —— 每条发现都派一个专属的验证者，它的任务是**推翻**这条发现：读真实代码、能复现就复现，证据模糊时默认判为「不成立」。只有活下来的才会被报告。

在两个同系插件（[dsh-preview](https://github.com/Viger1/dsh-preview)、[dsh-pilot](https://github.com/Viger1/dsh-pilot)）上的实测数据：**73 个 agent、49 条确认、14 条被驳回**。其中两条是验证者写脚本实机复现才得以确认的——包括一个在 shadow DOM 页面上会静默点错同名按钮的缺陷。

## 安装

```sh
dsh plugin --profile web add dsh-review
```

需要已组合的子代理 provider（`dsh-base` 自带的 `spawn` 即默认值），Node `^22.19 || >=24`。

## 使用

只有一个工具 `review`。描述目标时，把它当成一位「有代码仓库但不了解背景」的同事来交代：

```
审查 src/policy.ts 与 src/index.ts 的未提交改动（跑 git diff）。
它们新增了域名门控，必须跟随会话的审批状态：审批策略为 never 的会话静默放行、
ask 的会话每个 origin 询问一次，且授权绝不能泄漏到其他会话。
```

工具返回确认的缺陷——文件、行号、问题所在、失败场景、修复建议——**以及被驳回的发现标题**，让你看得见验证阶段过滤掉了什么，而不用猜它漏了什么。

内置的 `adversarial-review` 技能会教模型：什么时候值得付出这个代价，以及确认项与驳回项要区别对待。

## 配置

```yaml
- id: review
  name: dsh-review
  config:
    subagentProvider: spawn   # 由哪个已组合的 provider 运行子代理
    lenses: []                # [] 表示运行全部内置视角
    verifiersPerFinding: 1    # 调高即更严格；必须全部确认才通过
    maxFindings: 12           # 验证预算，按严重度从高到低
    maxConcurrentChildren: 8  # 同时运行的子代理上限
    maxDepth: 2               # 审查子代理的委派深度上限
    registerSkill: true
```

视角：`correctness`、`lifecycle`、`contract`、`security`。每个视角是一个子代理，每条发现再乘以 `verifiersPerFinding` 个验证者——审查是一次会话里最贵的工具，所以技能里明确要求模型审慎使用。

## 设计要点

- **故障按子代理隔离**：finder 挂了只损失它那个视角，并作为「覆盖缺口」如实报告；验证者挂了则该发现按驳回处理——因为「没人验证过的断言」正是这个插件存在的意义所在（绝不输出）。
- **验证要求全票通过**：`verifiersPerFinding > 1` 时，一票否决即丢弃。这个不对称是刻意的。
- **预算优先砍最轻的**：按严重度从高到低验证，被砍掉的会明确报告为 dropped，而不是静默省略。
- **扇出有界**：所有子代理启动都过同一个限流器，预算再大也只会排队，而不是一次拉起几百个 agent——否则过载会伪装成「一条都没确认」的审查结果。

### 自审记录

`dsh-review` 审查了自己的源码，找出三个缺陷（均已修复并有测试锁定）：`dedupeThreshold` 为 0 时会把同一文件内所有发现合并（不同缺陷被当作重复静默丢弃）、验证阶段的扇出没有并发上限、`maxDepth` 是唯一没在加载时校验的数值配置。同时它驳回了两条，其中一条确实是误报——入口早已校验过那个值。

## 同系插件

| 插件 | 给 agent 的能力 |
| --- | --- |
| [dsh-preview](https://github.com/Viger1/dsh-preview) | 👁 眼睛——验证自己写的页面：打开、读取、截图、自检 |
| [dsh-pilot](https://github.com/Viger1/dsh-pilot) | ✋ 手——按无障碍 ref 操作任意页面，带原生权限模型 |
| **dsh-review**（本仓库） | 🔍 判断力——找出缺陷，并在报告前逐条尝试推翻它 |
| [dsh-design](https://github.com/Viger1/dsh-design) | 🎨 品味——先约束选择，再实测结果有没有守住 |

## 协议

MIT © Viger1
