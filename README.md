# dsh-review

**Packaged multi-agent adversarial code review for DeepSeek Harness.**

Status: **design phase.** The workflow below is not yet a plugin — it is the method this repo exists to package, already used in anger on its two sibling plugins.

## The problem

dsh ships the primitives for multi-agent work — subagents, workflows, ralph loops — but nothing that packages them into a review you can trust. Run naive parallel reviewers over a diff and you get a wall of plausible-sounding findings, most of them wrong; triaging them costs more than the review saved. "AI code review produces too many false positives" is the reason people stop using it.

## The method

Two stages, and the second is the one that matters:

1. **Find** — several reviewers in parallel, each with a distinct lens (correctness, lifecycle/concurrency, API-contract conformance, security), each reporting findings with a concrete failure scenario rather than a style opinion.
2. **Verify adversarially** — every finding gets its own verifier whose job is to *refute* it: read the real code, reproduce if possible, and default to "not real" when the evidence is ambiguous. Only survivors are reported.

Measured on this repo's two sibling plugins ([dsh-preview](https://github.com/Viger1/dsh-preview), [dsh-pilot](https://github.com/Viger1/dsh-pilot)): **73 agents, 49 confirmed findings, 14 refuted.** Two of the confirmed ones were only established because a verifier wrote a script and reproduced the failure — including a defect where the agent silently clicked the wrong same-named button on shadow-DOM pages.

## Planned surface

- A `review` tool that takes a target (working-tree diff, a path, a commit range) and runs find → verify, returning confirmed findings with file, line, failure scenario, and suggested fix.
- Deployment-configured lens set and verifier count, so a quick check and a pre-release audit are the same tool with different budgets.
- A skill teaching the model when a review is worth running and how to act on findings.
- Optional: emit findings in a form a CI job can post.

## Family

| Plugin | What it gives your agent |
| --- | --- |
| [dsh-preview](https://github.com/Viger1/dsh-preview) | 👁 Eyes — verify what it builds: open, read, screenshot, self-check |
| [dsh-pilot](https://github.com/Viger1/dsh-pilot) | ✋ Hands — operate any page by accessibility refs, with a native permission model |
| **dsh-review** (this repo) | 🔍 Judgement — find defects, then try to refute each one before reporting it |

## License

MIT © Viger1
