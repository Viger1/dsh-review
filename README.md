# dsh-review

**Packaged multi-agent adversarial code review for DeepSeek Harness.**

English | [中文](README.zh.md)

Status: **M0** — the `review` tool works end to end.

## The problem

dsh ships the primitives for multi-agent work — subagents, workflows, ralph loops — but nothing that packages them into a review you can trust. Run naive parallel reviewers over a diff and you get a wall of plausible-sounding findings, most of them wrong; triaging them costs more than the review saved. "AI code review produces too many false positives" is the reason people stop using it.

## The method

Two stages, and the second is the one that matters:

1. **Find** — several reviewers in parallel, each with a distinct lens (correctness, lifecycle/concurrency, API-contract conformance, security), each reporting findings with a concrete failure scenario rather than a style opinion.
2. **Verify adversarially** — every finding gets its own verifier whose job is to *refute* it: read the real code, reproduce if possible, and default to "not real" when the evidence is ambiguous. Only survivors are reported.

Measured on this repo's two sibling plugins ([dsh-preview](https://github.com/Viger1/dsh-preview), [dsh-pilot](https://github.com/Viger1/dsh-pilot)): **73 agents, 49 confirmed findings, 14 refuted.** Two of the confirmed ones were only established because a verifier wrote a script and reproduced the failure — including a defect where the agent silently clicked the wrong same-named button on shadow-DOM pages.

## Install

```sh
dsh plugin --profile web add dsh-review
```

Requires a composed subagent provider (the stock `spawn` provider in `dsh-base` is the default) and Node `^22.19 || >=24`.

## Use

One tool, `review`. Describe the target the way you would brief a colleague who has the repository but not the context:

```
Review the uncommitted changes in src/policy.ts and src/index.ts (run git diff).
They add an origin gate that must follow the session's approval stance: a session
with approval policy 'never' passes silently, an 'ask' session is prompted once
per origin, and a grant must never leak to another session.
```

The tool returns confirmed findings — file, line, what is wrong, the failure scenario, and a suggested fix — plus the titles of findings that were **refuted**, so you can see what the verification stage filtered out rather than wondering what it missed.

The bundled `adversarial-review` skill teaches the agent when a review is worth its cost and how to act on the two categories differently.

## Configuration

```yaml
- id: review
  name: dsh-review
  config:
    subagentProvider: spawn   # which composed provider runs the children
    lenses: []                # [] runs every built-in lens
    verifiersPerFinding: 1    # raise for a stricter panel; all must confirm
    maxFindings: 12           # verification budget, worst severities first
    maxDepth: 2               # delegation-depth cap for review children
    registerSkill: true
```

Lenses: `correctness`, `lifecycle`, `contract`, `security`. Each is one child agent, and each finding costs `verifiersPerFinding` more — a review is the most expensive tool in a session, which is why the skill tells the model to use it deliberately.

## Design notes

- **Failures are contained per child.** A finder that dies costs its lens and is reported as a coverage gap; a verifier that dies refutes its finding, because a claim nobody verified is exactly what this plugin exists not to print.
- **Verification is unanimous.** With `verifiersPerFinding > 1`, one refutation is enough to drop a finding — the asymmetry is deliberate.
- **The budget cuts the least severe.** Findings are verified worst-first, and anything cut is reported as dropped rather than silently omitted.

## Family

| Plugin | What it gives your agent |
| --- | --- |
| [dsh-preview](https://github.com/Viger1/dsh-preview) | 👁 Eyes — verify what it builds: open, read, screenshot, self-check |
| [dsh-pilot](https://github.com/Viger1/dsh-pilot) | ✋ Hands — operate any page by accessibility refs, with a native permission model |
| **dsh-review** (this repo) | 🔍 Judgement — find defects, then try to refute each one before reporting it |

## License

MIT © Viger1
