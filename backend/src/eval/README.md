# Golden set

Hand-written labels for a sample of calls, used by `npm run eval` to measure the
pipeline instead of asserting that it works.

## What is labelled, and what is not

**Labelled — the objective fields.** `unit_configuration`, `budget_range`,
`timeline`, `preferred_locations`, `site_visit_outcome`,
`last_stage_reached`, `recommended_next_action`. Each of these has a right
answer that two careful readers of the transcript would agree on.

**Not labelled — the 0–5 quality scores.** One annotator's "this pitch is a 4"
is not ground truth, so scoring is measured differently:

- **self-consistency** — the same transcript analyzed N times at the production
  temperature; the harness reports the spread. A rubric that yields ±1.5 on
  re-runs cannot support the leaderboard built on top of it.
- **soft-rule compliance** — the share of analyses that satisfy rules the schema
  cannot express (summary is exactly two sentences, a site visit is not
  recommended when none was asked for).

Claiming a scoring accuracy number against self-authored labels would be
circular. Consistency and rule compliance are the parts that can be measured
honestly.

## Label provenance

Labels were produced by reading each transcript against the v3 rubric in
`shared/src/prompts/v3.ts`, **without looking at the model's output for
that call first** — otherwise the labels anchor to the answer being tested.
Adjudication rules applied consistently:

- A price the _agent_ quotes as the project's starting price is not the lead's
  budget. Only a figure the lead names or accepts counts; otherwise
  `not_discussed`.
- `unit_configuration` records what the **lead** said they want. If the lead
  never states a configuration, it is `not_discussed` even when the agent
  pitched one all call.
- `preferred_locations` holds buying preferences only — not the lead's
  workplace, and not areas only the agent proposed.
- "I'll come one day, I'll check my schedule and tell you" is
  `committed_no_date`. "We'll see, I'll call you when I'm free" is a deflection,
  so `declined`.
- `next_step_confirmed` requires the lead to agree to something specific. A
  visit agreed with no date is `close_attempt`.

These are judgement calls; they are written down so a reviewer can disagree with
the rule rather than guess at the labeller's intent.

## Sample

14 calls out of 150 (9%), chosen to span every `site_visit_outcome`, both
truncated and complete calls, and 6 of the 19 rows the importer had to repair.
Small enough to hand-label carefully, large enough to catch a systematic
extraction failure. It is not large enough for a tight confidence interval on
any single field — treat per-field percentages as indicative, and the aggregate
as the headline.

## Statistical power — read this before trusting a number

The pipeline runs at temperature 0.2, so the model is not deterministic. Running
the identical prompt over this golden set twice produced a **2-field difference
out of 98 comparisons**. With 14 calls, one call is 7 percentage points on a
single field.

Consequences:

- A single `npm run eval` pass cannot resolve a difference of a few fields. Use
  `--consistency N` and compare means with spreads.
- Large per-field deltas (20+ points) and the validity metrics are outside the
  noise and can be read directly.
- Small aggregate differences between prompt versions cannot. Do not rank two
  prompts on one pass.

Growing this set to 40–50 calls is the other half of the fix.

## Adding labels

Append to `labels.json` and re-run `npm run eval -- --offline`. Every field is
required; `budget_range` is either `{ "min_lakhs": n, "max_lakhs": n }` or the
string `"not_discussed"`.
