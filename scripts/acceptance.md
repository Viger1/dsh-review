# Acceptance run

The unit tests drive the orchestration through an injected child runner, so they prove the wiring without spending a model call. This is the check that the whole thing works against a real harness and real agents — run it before a release, and after any change to the prompts or the lens set.

## Run it

From a profile that has `dsh-review` and a runner bundle composed (`headless` is the cheapest):

```sh
dsh plugin --profile headless add /absolute/path/to/dsh-review
```

Then, from the plugin directory:

```sh
dsh --profile headless "Use the review tool on tests/fixtures/planted-defects.ts. Describe the target as: a shopping-cart module where total() must sum any-length item arrays then apply a percentage discount, couponDiscount() converts a coupon code to a discount percentage, and loadCart() reads a user's cart file from disk by id. Report the confirmed count, the merged count, the refuted count, and which lenses found each defect."
```

## What a passing run looks like

All three planted defects confirmed, none refuted:

| Defect | Severity | What the reviewer should say |
| --- | --- | --- |
| `total` loop bound | critical | `i <= items.length` reads one past the end; **every** input throws, including `[]` |
| `loadCart` path traversal | critical | `userId` is interpolated unvalidated; a concrete escape such as `loadCart('../secret')` reaching `/var/secret.json` |
| `couponDiscount` unknown code | major | returns `undefined`, so arithmetic on it yields `NaN` |

Recorded runs, for comparison:

| Run | Raw findings | Merged | Confirmed | Refuted | Lens failures |
| --- | --- | --- | --- | --- | --- |
| Before dedupe | 8 | — | 8 (3 real defects, grouped by hand) | 0 | 0 |
| After dedupe | 12 | 9 | 3 | 0 | 0 |

## Reading the result

- **Fewer than three confirmed** — the finders are missing a defect class. Check whether the target description still names the intent of each function; a finder that does not know what `total` is *for* cannot call the loop bound wrong.
- **More than three confirmed** — read them before assuming false positives. The recorded runs surfaced a genuine fourth issue (`couponDiscount` throws on `undefined` input) that was not planted deliberately.
- **Anything refuted** — read the verifier's reasoning. Refutations are the point of the plugin, but a refutation of one of the three planted defects means the verify stage is too aggressive.
- **`merged` near zero with several lenses running** — deduplication is not matching; the same defect will be reported several times and cost several verifications.
