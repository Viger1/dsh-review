# Adversarial review

Run the `review` tool when correctness matters more than speed: before claiming non-trivial work is done, when the user asks for a review or an audit, and after a change to code that is hard to test directly (concurrency, permissions, protocol handling, anything with a trust boundary).

## Describe the target properly

The finders open the repository themselves; they see only what your `target` string tells them to look at. A good target names:

- **Where the code is** — paths, or a command like `git diff main...HEAD` for them to run.
- **What the change is trying to do** — "correct" is relative to intent, and a finder that does not know the intent invents one.
- **Which contracts must hold** — the library semantics, the calling convention, the invariant this code is supposed to preserve.

Weak: `review my changes`. Strong: `Review the uncommitted changes in src/policy.ts and src/index.ts (run git diff). They add an origin gate that must follow the session's approval stance: a session with approval policy 'never' must pass silently, an 'ask' session must be prompted once per origin, and a grant must never leak to another session.`

## Choosing lenses

Omit `lenses` to run the deployment's default set. Narrow it when you already know the risk: `security` alone for an input-handling change, `lifecycle` for teardown or concurrency work. Running fewer lenses is cheaper and faster; running all of them is the default because a defect rarely announces which lens will catch it.

## Acting on the result

- **Confirmed findings** survived an agent that was told to refute them. Treat each as real: read the cited code, fix it, and say what you changed.
- **Refuted findings** are listed so you know they were considered. Do not act on them, and do not re-report them as risks.
- **Failed lenses** are a coverage gap, not a clean bill of health — say so if you report the review to the user.
- **Dropped findings** mean the budget cut off lower-severity claims; raise `maxFindings` if you need them.

A review reporting nothing confirmed is a real result worth stating plainly. Do not manufacture concerns to fill the silence.

## Cost, and choosing a depth

Every lens is one child agent, and every finding gets its own verifier — a review is the most expensive tool in the session by a wide margin, in both money and wall time. It is a pre-release audit, not something to run on every commit.

- `depth: "quick"` — two lenses, four verified findings, one verifier. Use it for a routine look at a small change, or when you are unsure whether a full review is warranted.
- default full depth — the deployment's configured panel. Use it before a release, for a change touching concurrency, permissions, or a protocol, and whenever the user asks for a review or an audit.

Verification happens at both depths. If you need it cheaper still, narrow `lenses` to the risk you actually care about rather than asking for findings you will not verify.

Prefer one well-described review over several vague ones: the target description decides what the finders read, and a vague target wastes the whole fan-out.
