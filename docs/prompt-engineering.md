# Prompt engineering log

How the prompt got from "return the result as JSON" to the current version, and
how each problem was found. The versions are runnable and comparable:

```bash
npm run eval -- --prompt v1,v2,v3,v4 --write
```

## v1 — plain instruction, no contract

`shared/src/prompts/v1.ts`

A prose description of what to extract, ending in "Return the result as JSON."
No field names, no allowed values, no scoring anchors.

**What went wrong.** Everything structural. Prose wrapped around the JSON,
markdown fences, invented field names (`budget` instead of `budget_range`), free
text where an enum belonged (`"maybe in six months"` for `timeline`), and scores
with no rationale. Roughly half the responses needed hand-inspection.

**Reconstruction note.** The original v1 text was not kept under version control;
this file is a faithful reconstruction from the notes in
[ai-usage.md](ai-usage.md) ("Initial → wrong output format"). It exists so the
improvement can be measured rather than asserted.

## v2 — schema pinned, rubric missing

`shared/src/prompts/v2.ts`

Added an explicit output shape with the allowed values listed per field.

**What this fixed.** Field names and structure stopped drifting. Parsing became
reliable enough to run over 150 calls unattended.

**What it did not fix.** Two things, both invisible without measurement:

1. **Enum discipline.** Listing options as `A | B | C` invites the model to
   answer `"A | B"` when the call touched both. It also, on one call, invited it
   to answer with the entire option list.
2. **Score consistency.** With no anchors, "how good was this pitch" drifts
   between runs, which makes a leaderboard built on those scores meaningless.

## v3 — the production prompt

`shared/src/prompts/v3.ts`

Three changes, each traceable to a defect found in the shipped v1 dataset by
`npm run validate:dataset` and `npm run eval -- --offline`.

### 1. The field spec is generated from the schema

`analysisJsonSpec()` in `shared/src/schema.ts` builds the prompt's field
list from the same Zod enums that validate the response. Before, the prompt and
the validator were two hand-maintained copies of the same list — and copies drift.

### 2. Rules written against the observed failures

| Observed in the data                                               | Rule added                                                                                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `"2BHK \| 3BHK"` (6 rows), full enum spec echoed (1 row)           | "Every enum field takes EXACTLY ONE value. Never join options with `\|`, `/`, `or` or commas… Do not repeat the list of options as your answer." |
| Call stages appearing in `site_visit_outcome` (2 rows)             | "`site_visit_outcome` describes ONLY whether a site visit was agreed. Never put a call stage in this field."                                     |
| `{min_lakhs: 0, max_lakhs: 0}` (9 rows)                            | Schema rejects non-positive budgets, so "not discussed" has to be said explicitly.                                                               |
| Agent's quoted starting price recorded as the lead's budget        | "A figure quoted only by the agent as the project's starting price is NOT the lead's budget."                                                    |
| Agent's pitched configuration recorded as the lead's preference    | "unit_configuration: what the lead wants to buy. Ignore what the agent pitched if the lead stated a different preference."                       |
| A deflection (`"we'll see, I'll call you"`) scored as a commitment | Explicit mapping: agreed-with-date / agreed-no-date / refused-or-deflected / never-asked / line-dropped.                                         |

### 3. JSON mode instead of a regex

v3 runs with `response_format: { type: 'json_object' }`, so the response arrives
as bare JSON. The v1 implementation stripped markdown fences with
`text.replace(/```json/g, '')` — a workaround for a problem the API can just not
have. The fence-stripping code survives as a documented fallback for v1 and v2,
which do not use JSON mode.

## What the measurement actually showed

The failure modes above were not guesses. Running the golden set against the
shipped dataset produced a clear pattern (full output in
[eval-results.md](eval-results.md)):

- **`timeline` agreed on only 35.7%** of calls, and **8 of the 9 disagreements
  were the model answering `6_to_12_months`** — including for calls where no
  timeframe was mentioned at all. It had learned a default.
- **`site_visit_outcome` agreed on 42.9%**, failing in one direction: it read
  soft deflections as firm commitments. A dashboard that over-reports commitments
  is worse than one that reports nothing.
- **`budget_range` agreed on 71.4%**, and the misses were the agent's quoted
  starting price recorded as the lead's budget — plus one call where a figure
  appeared that is nowhere in the transcript.
- **`preferred_locations` agreed on 85.7%**, with junk entries like
  `"school nearby"` and `"prime area"` extracted as if they were places.

Each bullet became a rule in v3. Whether the rules worked is a question for
`npm run eval` with an API key, not for this document.

## Validation as part of the prompt loop

The prompt is not the only defence. When a response parses but fails schema
validation, the pipeline sends one follow-up containing the model's own output
and the validator's error paths (`buildRepairMessage`), then re-validates. This
matters because a blind retry at temperature 0.2 tends to reproduce the same
mistake, while being shown `extraction.unit_configuration: Invalid enum value`
usually fixes it in one turn.

Cost of the repair pass: one extra call on the affected transcripts only, and
`meta.repairsUsed` records how often it was needed so the rate is visible rather
than hidden.

## What the v3 run actually showed

v3 was then run live against the same golden set (14 calls, 28,230 tokens,
$0.0015, ~10s median latency). The result is worth stating plainly because it is
not the result the rules above were predicting.

**What v3 fixed, unambiguously:**

|                                 | legacy | v3        |
| ------------------------------- | ------ | --------- |
| Schema-valid on first try       | 35.7%  | **100%**  |
| Repair round-trips needed       | 9      | **0**     |
| Summary exactly two sentences   | 92.9%  | **100%**  |
| `budget_range` agreement        | 71.4%  | **92.9%** |
| `timeline` agreement            | 35.7%  | **64.3%** |
| `preferred_locations` agreement | 85.7%  | **92.9%** |

The `timeline` default-to-`6_to_12_months` habit is gone, the agent's quoted
starting price is no longer recorded as the lead's budget, and junk locations like
`"school nearby"` stopped appearing. Schema validity is the headline: zero invalid
rows, zero repair round-trips.

**What got worse:**

|                           | legacy    | v3        |
| ------------------------- | --------- | --------- |
| `site_visit_outcome`      | 42.9%     | 28.6%     |
| `last_stage_reached`      | 57.1%     | 21.4%     |
| `recommended_next_action` | 78.6%     | 64.3%     |
| `unit_configuration`      | 57.1%     | 50.0%     |
| **Aggregate**             | **61.2%** | **59.2%** |

Aggregate accuracy did **not** improve. On 98 field comparisons a 2-point
difference is two fields — noise. The per-field swings are large enough to be real
signal, and they have three separate causes, which matters because only two of
them are the model's fault.

### Cause 1 — a gap in my own rule (`unit_configuration`)

All seven misses are the same shape: the lead never states a configuration, the
agent pitches one all call, and the model reports the agent's. The v3 rule reads:

> unit_configuration: what the lead wants to buy. Ignore what the agent pitched
> **if the lead stated a different preference**.

It never says what to do when the lead states _nothing_. The model filled the gap
the only way it could. Fix is one clause: "If the lead never states a
configuration, answer `not_discussed`, even if the agent pitched one throughout."

### Cause 2 — an ambiguous rubric, not a wrong answer (`last_stage_reached`)

Nearly every miss is v3 saying `next_step_confirmed` where the label says
`close_attempt`, for calls where the lead agreed to visit but gave no date. The
rule says "only use `next_step_confirmed` when the lead explicitly agreed to a
specific next step" — and "I'll come, I'll confirm the date later" is genuinely
arguable either way. Eleven identical disagreements are one underspecified rule,
not eleven errors. This one is a **labelling problem to resolve before it is a
model problem**: the rubric needs to state whether agreement without a date
counts, and then both the prompt and the labels need to follow it.

### Cause 3 — real model weakness (`site_visit_outcome`)

This one is the model. It reads "I'll come one day, I'll check my schedule" as
`committed_with_date` (five calls), and reads outright deflections — "we'll see,
I'll call you when I'm free" — as commitments (two calls). The v3 prompt has an
explicit five-way mapping for exactly this field and it did not take. A dashboard
that over-reports commitments is worse than one that reports nothing, so this is
the most important thing to fix and the least likely to yield to another
paragraph of prompt.

## v4, and the measurement problem it exposed

`shared/src/prompts/v4.ts` is v3 with exactly one clause added and nothing else
touched — the `unit_configuration` gap above:

> Only the lead's own words count. If the lead never states a configuration,
> answer `"not_discussed"` — even if the agent pitched 2BHK, 3BHK, a villa or a
> plot repeatedly throughout the call.
>
> A lead answering an unrelated question (for example "just exploring options"
> when asked about unit type) has NOT stated a configuration.

Only one rule changed on purpose: editing two at once makes the next measurement
uninterpretable, because you cannot tell which edit moved which number.

**The targeted field improved:** `unit_configuration` went from 50.0% to 57.1%
(7 → 8 of 14). `site_visit_outcome` also rose a call, which the edit does not
explain.

**But v3 was re-run in the same session, and scored differently than the first
time:**

| Field                     | v3, run 1         | v3, run 2         |
| ------------------------- | ----------------- | ----------------- |
| `preferred_locations`     | 92.9% (13/14)     | 85.7% (12/14)     |
| `recommended_next_action` | 64.3% (9/14)      | 57.1% (8/14)      |
| **Aggregate**             | **59.2%** (58/98) | **57.1%** (56/98) |

Same prompt, same transcripts, same labels, same model — two fields flipped,
because the pipeline runs at temperature 0.2 and the model is not deterministic.

That reframes everything above. Run-to-run noise on this golden set is roughly
**±2 fields out of 98**. The v3→v4 aggregate difference is **3 fields**. The noise
floor and the effect size are the same order of magnitude, so:

- The **validity** results are solid — 35.7% → 100% is a 9-row change that reproduced
  identically across both runs, far outside the noise.
- The **per-field accuracy** results with large deltas (`timeline` +28.6,
  `budget_range` +21.5, `last_stage_reached` −35.7) are almost certainly real signal.
- The **aggregate ranking of v3 vs v4 is not measurable** from single runs. Reporting
  "v4 is worse, 54.1% vs 57.1%" would be reading noise as a result.

This is the most useful thing the harness has produced, and it was invisible until
the same prompt was run twice. It is also a mistake this project had already built
the fix for and not used: `--consistency N` exists precisely to run each call N
times and report the spread, and every number above came from a single pass.

### What this changes about the plan

The next step is no longer "write more rules." It is, in order:

1. ~~**Fix the `unit_configuration` clause**~~ — done in v4. The targeted field rose
   50.0% → 57.1%; the aggregate change is inside the noise floor.
2. **Fix the measurement before tuning anything else.** Every number here is a
   single pass, and a single pass cannot resolve a 3-field difference. Run
   `npm run eval -- --prompt v3,v4 --consistency 5` and compare means with
   spreads. Roughly 140 calls, about $0.015 — cheaper than drawing a wrong
   conclusion and building on it.
3. **Resolve the stage ambiguity in the rubric**, then re-label those calls. Until
   that is settled, `last_stage_reached` accuracy is not measuring the model at all
   — it is measuring a disagreement about what the label means.
4. **Try few-shot examples for the deflection cases**, since a paragraph of
   instruction demonstrably did not work. Two labelled examples of "committed" vs
   "deflected" is the cheapest remaining experiment.
5. **Then try the 70B model** on the unchanged prompt, to separate "the prompt is
   unclear" from "the 8B model cannot make this distinction."
6. **Grow the golden set** to 40–50 calls. At n=14, one call is 7 percentage points
   on a field, which is why every per-field number here is coarse.

## What I would try next

- **Two-pass extraction for the fields that fail most.** `timeline` and
  `site_visit_outcome` both depend on a single line of the transcript. A focused
  second call, given only the closing turns, would probably beat a rule in a
  1,500-token prompt.
- **Few-shot examples for the deflection cases.** The distinction between "I'll
  come one day" and "I'll call you when I'm free" is subtle enough that two
  labelled examples may outperform a paragraph of instruction.
- **A stronger model on the same prompt.** `llama-3.3-70b-versatile` costs about
  10× more per token and the harness can compare them directly
  (`LLM_MODEL=llama-3.3-70b-versatile npm run eval`). Worth knowing the price of
  the accuracy before choosing.
- **Score calibration.** Before trusting the 0–5 scores, run
  `--consistency 5` and check the spread. If the same call scores 2.5 and 4.0 on
  re-runs, the rubric needs tighter anchors, not the leaderboard more features.
