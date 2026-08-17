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

One tool, `review`. It is the most expensive thing in a session — every lens is an agent and every finding costs another — so it is a **pre-release audit, not a per-commit check**. A full run on a real change took minutes and a double-digit number of agents in our own use; budget for that, and use `depth: quick` when you want a cheap look at a small change.

Describe the target the way you would brief a colleague who has the repository but not the context:

```
Review the uncommitted changes in src/policy.ts and src/index.ts (run git diff).
They add an origin gate that must follow the session's approval stance: a session
with approval policy 'never' passes silently, an 'ask' session is prompted once
per origin, and a grant must never leak to another session.
```

The tool returns confirmed findings — file, line, what is wrong, the failure scenario, and a suggested fix — plus the titles of findings that were **refuted**, so you can see what the verification stage filtered out rather than wondering what it missed.

```
review { target: "...", depth: "quick" }
```

`quick` caps the run at two lenses, four verified findings, and one verifier — roughly a third of the cost. **Verification runs at both depths**: a cheaper review looks at less rather than trusting more, because reporting an unverified claim is the failure this plugin exists to avoid.

The bundled `adversarial-review` skill teaches the agent when a review is worth its cost and how to act on the two categories differently.

### What this has not been measured against

The evidence here is that the method finds real defects — 49 confirmed across the sibling plugins, several reproduced by a verifier writing a script. What has **not** been measured is whether it beats simply asking the model to review the same diff: no A/B, no false-positive rate against a baseline. Treat the refutation stage as a design argument backed by observed refusals (14 findings dropped), not as a proven improvement over the obvious alternative.

## Configuration

```yaml
- id: review
  name: dsh-review
  config:
    subagentProvider: spawn   # which composed provider runs the children
    lenses: []                # [] runs every built-in lens
    verifiersPerFinding: 1    # raise for a stricter panel; all must confirm
    maxFindings: 12           # verification budget, worst severities first
    maxConcurrentChildren: 8  # cap on children running at once
    maxDepth: 2               # delegation-depth cap for review children
    registerSkill: true
```

Lenses: `correctness`, `lifecycle`, `contract`, `security`. Each is one child agent, and each finding costs `verifiersPerFinding` more — a review is the most expensive tool in a session, which is why the skill tells the model to use it deliberately.

## Design notes

- **Silence is reported, not implied.** A lens that ran and found nothing is listed as such, separately from one that failed — otherwise a caller cannot tell coverage from absence, which the plugin's own first quick run made obvious.
- **Failures are contained per child.** A finder that dies costs its lens and is reported as a coverage gap; a verifier that dies refutes its finding, because a claim nobody verified is exactly what this plugin exists not to print.
- **Verification is unanimous.** With `verifiersPerFinding > 1`, one refutation is enough to drop a finding — the asymmetry is deliberate.
- **The budget cuts the least severe.** Findings are verified worst-first, and anything cut is reported as dropped rather than silently omitted.
- **Fan-out is bounded.** Every child start passes through one limiter, so a large budget queues instead of firing hundreds of agents at once — an overload would otherwise arrive disguised as a review that refuted everything.

### Dogfooding

`dsh-review` reviewed its own source and found three defects, which are fixed and pinned by tests: a zero `dedupeThreshold` merged every finding in a file (distinct defects silently discarded as duplicates), the verifier fan-out had no concurrency bound, and `maxDepth` was the one numeric config never validated at load. It also refuted two findings, one of which was a genuine false positive about a value the entry point already validates.

## Family

| Plugin | What it gives your agent |
| --- | --- |
| [dsh-preview](https://github.com/Viger1/dsh-preview) | 👁 Eyes — verify what it builds: open, read, screenshot, self-check |
| [dsh-pilot](https://github.com/Viger1/dsh-pilot) | ✋ Hands — operate any page by accessibility refs, with a native permission model |
| **dsh-review** (this repo) | 🔍 Judgement — find defects, then try to refute each one before reporting it |
| [dsh-design](https://github.com/Viger1/dsh-design) | 🎨 Taste — constrain the choices, then measure whether the result kept them |

## License

MIT © Viger1
