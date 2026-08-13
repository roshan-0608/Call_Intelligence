# AI usage

Disclosure of which models this project _uses_, and which AI tools were used to
_build_ it.

## The model the pipeline runs on

- **Provider:** Groq (OpenAI-compatible chat completions endpoint)
- **Model:** `llama-3.1-8b-instant`, temperature 0.2, `response_format: json_object`
- **Configurable** via `LLM_MODEL`; pricing per model lives in
  `shared/src/llm/cost.ts`

### Providers and models tried

| Attempt                       | Outcome                             |
| ----------------------------- | ----------------------------------- |
| `gemini-1.5-flash-latest`     | 404 — deprecated during the project |
| `gemini-2.0-flash`            | Free-tier quota exhausted           |
| `llama3-70b-8192` (Groq)      | Decommissioned during the project   |
| `llama-3.1-8b-instant` (Groq) | In use                              |

Two models retired underneath this project within weeks. That is why the model
name is configuration rather than a constant, and why a 404 from the provider now
produces "the configured model was not found; providers retire models" instead of
a generic error.

### Usage on the dataset

- 150 transcripts, one analysis call each, plus a small number of retries
- Stayed inside the free tier
- **Token counts were not recorded**, because the original pipeline discarded the
  provider's `usage` block. That history is unrecoverable. New analyses record
  tokens, cost, latency and repair count per call, and the dashboard shows them.

## AI tools used to build this

**Original build.** ChatGPT, roughly 60–70% AI-assisted: prompt design, Express
setup, debugging rate limits and model deprecations, the retry and cache code.

**Rewrite.** Claude Code (Opus), working from a review of the original. It
produced the monorepo, the Zod contract, the API, the dashboard, the eval harness
and the tests, under my direction on scope and technical choices (SQLite +
Prisma, full frontend rewrite, TypeScript end-to-end).

The 14 golden-set labels were produced by reading each transcript against the
rubric, deliberately without looking at the model's answer for that call first —
otherwise the labels anchor to the output being tested. The adjudication rules
are written down in [the golden-set notes](../backend/src/eval/README.md) so a
reviewer can disagree with a rule rather than guess at intent.

## How the prompt evolved

Three versions, all runnable and comparable via
`npm run eval -- --prompt v1,v2,v3,v4`. Full write-up in
[prompt-engineering.md](prompt-engineering.md).

1. **v1** — plain instruction, no schema. Prose wrappers, markdown fences,
   invented field names.
2. **v2** — output shape and allowed values pinned. Parsing became reliable;
   enum discipline and score consistency did not.
3. **v3** — field spec generated from the Zod schema, rules written against the
   specific defects found in the shipped data, JSON mode on.

v1 and v2 are reconstructions from these notes — the original texts were not
version-controlled. They exist so the improvement can be measured rather than
asserted.

## AI suggestions rejected

**Multiple LLM calls per transcript.** Rejected for the original build: higher
latency and cost for no measured gain. Still one call — but the eval now shows
_where_ a second call might pay for itself (`timeline`, `site_visit_outcome`), so
the next attempt would be a measurement, not a guess.

**MongoDB.** Rejected. The access patterns are relational — calls belong to
telecallers, locations belong to calls, the leaderboard is a group-by. SQLite via
Prisma gives that with zero setup and ports to Postgres unchanged.

**Streamlit for the UI.** Rejected. Fine for a prototype, but the point of the
dashboard is that it looks and behaves like a product.

**Hand-editing the 19 invalid rows.** Rejected during the rewrite. It would have
produced a clean dataset and erased the evidence of the failure the project is
now built around. They are repaired by documented rules, flagged in the database,
and shown as repaired in the UI.

**Deleting the `prefers-reduced-motion` CSS block** while debugging charts that
rendered frozen at 4% height. It was a plausible suspect and would have "fixed"
nothing — the real cause was a rAF ticker throttled in a background tab.
Removing an accessibility feature on a hunch is how accessibility features
disappear.

## What was verified rather than assumed

- 90 automated tests, including HTTP-level contract tests
- `npm run validate:dataset` — every row in the dataset checked against the schema
- `npm run eval -- --offline` — measured field agreement, reproducible with no API key
- The dashboard was opened in a real browser and screenshotted in both themes;
  three rendering bugs were found that way (missing bars, frozen animation,
  full-width filter selects) and none of them would have shown up in a test
