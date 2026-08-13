# Decisions

Every non-obvious choice, its alternatives, and what I would change. Decisions
1–5 are from the original build and still hold; 6–16 come from the rewrite.

---

## 1. One LLM call per transcript

**Decision.** A single call returns extraction, four scores with rationales,
stage, next action and summary.

**Alternatives.** Separate calls per task; a chain with a verification pass.

**Why.** Lower latency, fewer tokens, and one place where the output contract
lives. On 150 calls the difference between one call and five is the difference
between staying inside a free tier and not.

**What I would change.** The eval shows `timeline` and `site_visit_outcome` are
where accuracy is lost, and both hinge on a couple of transcript lines. A second
focused call for just those fields is the first thing I would test — measurably,
against the golden set, rather than on principle.

---

## 2. Groq with `llama-3.1-8b-instant`

**Decision.** Groq's OpenAI-compatible endpoint, 8B model, temperature 0.2.

**Alternatives.** Gemini (tried; `gemini-1.5-flash-latest` returned 404 after
deprecation, then the free quota ran out), `llama3-70b-8192` (decommissioned
mid-project), OpenAI (cost).

**Why.** Free tier, fast inference, and an OpenAI-compatible shape that makes the
provider swappable.

**What I would change.** Two models retired underneath this project in a matter
of weeks, so the model name is configuration (`LLM_MODEL`), pricing is a lookup
table, and a 404 from the provider now produces "the configured model was not
found; providers retire models" instead of a generic failure. The 70B model is
worth an eval run to price the accuracy difference.

---

## 3. A JSON file as the dataset, PostgreSQL as the store

**Decision.** `backend/src/data/calls.seed.json` is the committed dataset;
PostgreSQL (hosted on Neon) is what the API reads. SQLite was used throughout
development.

**Alternatives.** JSON file as the live store (the original design); MongoDB;
staying on SQLite in production.

**Why.** The JSON file makes the dataset reviewable in a diff and lets the whole
project be rebuilt from scratch. But a file cannot answer "page 3 of calls sorted
by score, filtered to one telecaller" without loading everything, and it loses
uploads on restart. Prisma gives real queries, migrations and a seed path.

Production is Postgres rather than SQLite for one concrete reason: the host's
filesystem is ephemeral, so a SQLite file is deleted on every restart. That is
tolerable for the 150 seeded calls (they reload) and not tolerable for a call a
user uploads.

**What this cost.** Almost nothing, and that was the point. The switch was one
line — `provider = "sqlite"` to `"postgresql"` — plus regenerating migrations,
because the schema deliberately avoided anything engine-specific: no native
enums, no arrays, no Json columns. Enum-like columns are plain strings validated
by Zod. A schema that had leaned on Postgres enums would have needed a rewrite;
this one needed a word.

**What I would change.** Nothing at this scale. Neon's free tier sleeps when idle
and wakes on the next connection, which adds a second or so to the first request
after a quiet period — acceptable, and cheaper than the alternatives that either
delete free databases after 30 days or require a manual click to wake.

---

## 4. Persistent, version-aware caching

**Decision.** An `AnalysisCache` table keyed on
`sha256(normalized transcript) + model + prompt version + temperature`.

**Alternatives.** The original in-process `Map`; Redis; no caching.

**Why.** Two bugs in the original: the cache died with the process (and on
free-tier hosting the process sleeps between visitors, so it was almost always
cold), and the key was the transcript alone — so after changing the prompt it
would keep serving analyses produced by the old one. Encoding model and prompt
version means a prompt bump is a cache miss by construction.

**What I would change.** Redis if this ever ran more than one instance. The table
also needs a TTL or LRU bound before it grows unbounded.

---

## 5. Send the whole transcript

**Decision.** No trimming or chunking.

**Why.** The decisive moments — the objection, the visit ask, the commitment —
are usually at the end. Trimming saves tokens by removing the part that matters.
These calls are 24–151 seconds, comfortably inside the context window.

**Tradeoff.** Larger payloads and a hard limit: `MAX_TRANSCRIPT_CHARS` rejects
oversized uploads with an explanation rather than sending them and failing.

---

## 6. Validate model output before it can reach storage

**Decision.** One Zod schema (`shared/src/schema.ts`) is the authority.
The pipeline validates, the API validates, the seeder refuses violations.

**Alternatives.** Trust the model (the original approach); TypeScript types only,
which vanish at runtime.

**Why.** The original wrote 19 invalid rows out of 150 into its own dataset and
nobody noticed — including me, when I first reviewed it. Types cannot catch this;
only a runtime check at the boundary can. Details in
[prompt-engineering.md](prompt-engineering.md).

**Notable detail.** `budget_range.min_lakhs` is `.positive()`, not `.min(0)`.
Told never to return null, the model started reporting "not discussed" as
`{min_lakhs: 0, max_lakhs: 0}` — a statement that is simply false. Rejecting the
fake zero forces the honest sentinel.

---

## 7. Repair round-trip instead of a blind retry

**Decision.** When output parses but fails validation, send one follow-up
containing the model's own response plus the validator's error paths, then
re-validate. Budget: one repair.

**Alternatives.** Blind retry; fail immediately; accept partial data.

**Why.** At temperature 0.2 a blind retry mostly reproduces the same mistake.
Showing the model `extraction.unit_configuration: Invalid enum value` usually
fixes it in one turn. `meta.repairsUsed` records the rate so it stays visible.

---

## 8. One retry policy, aware of which failures are retryable

**Decision.** A single `withRetry` with exponential backoff and full jitter.
Retry 429/408/5xx, honour `Retry-After`, fail fast on 400/401/403/404.

**Alternatives.** The original: two nested loops (2 attempts inside the pipeline,
3 around it) retrying everything.

**Why.** Nested retries multiply — up to six calls per transcript — and retrying
a 401 cannot succeed. A wrong API key used to look exactly like a rate limit; now
it says so.

---

## 9. Keep the invalid rows, repair them deterministically, flag them

**Decision.** The 19 bad rows are imported through documented repair rules
(`shared/src/legacy.ts`), stored as `validationStatus: 'repaired'` with
the list of changes, and surfaced in the UI.

**Alternatives.** Hand-edit the JSON; drop the rows; re-run the pipeline over
them and commit the new output.

**Why.** Hand-editing would erase the evidence of the failure this project is
about. Dropping them would quietly shrink the dataset. Every repair is a pure
function with a stated rule, visible on the call detail page, and
`npm run process-calls -- --repair` re-analyzes exactly those rows.

---

## 10. Label the objective fields; measure the scores differently

**Decision.** The golden set labels extraction and routing fields. The 0–5 scores
are measured for **consistency across re-runs** and **rubric-rule compliance**,
not against labels.

**Why.** One annotator's "this pitch is a 4" is not ground truth, and scoring the
model against my own subjective numbers would produce a real-looking percentage
that means nothing. Consistency is measurable and is the property the leaderboard
actually depends on. Reasoning in
[the golden-set notes](../backend/src/eval/README.md).

**What I would change.** Three independent annotators on 50 calls, reporting
inter-annotator agreement first. If humans cannot agree, the rubric is the
problem, not the model.

---

## 11. Aggregate in SQL, not in the browser

**Decision.** Leaderboard and analytics are `groupBy`/`aggregate` queries;
`overallScore` is a denormalized column.

**Alternatives.** The original: fetch every call and reduce in React.

**Why.** Client-side aggregation silently ranked only what happened to be loaded,
sorted stringified numbers (`"4.25" > "10.00"`), and made server-side sorting by
score impossible. The denormalized column is what lets the database sort and
paginate by score.

---

## 12. A portable lowercase search column

**Decision.** A `searchText` column holding lowercased
`leadName + telecallerName + callId`, queried with `contains`.

**Alternatives.** Prisma's `mode: 'insensitive'`; raw SQL `LOWER()`; full-text
search.

**Why.** `mode: 'insensitive'` is PostgreSQL-only, and SQLite's `LIKE` is
case-insensitive only for ASCII. Either way, search would have silently changed
behaviour on migration. A pre-lowercased column behaves identically on both.

**What I would change.** Postgres full-text search once transcript search is
wanted; this column only covers names and ids.

---

## 13. Resolve chart colours at runtime

**Decision.** `useChartColors` reads the CSS custom properties off the document
root and passes concrete values to Recharts, re-reading on theme change.

**Alternatives.** Hard-coded hex per chart; `fill="var(--token)"`.

**Why.** `var()` does not resolve in SVG _presentation attributes_, which is how
Recharts emits colour — the bars rendered black on a dark background. Hard-coding
hex would have duplicated the palette and broken dark mode. This keeps
`index.css` as the single source of colour.

**Also.** Bar animation is disabled. Recharts drives it with a rAF ticker, which
browsers throttle in background tabs, so bars could be captured frozen at 4% of
their height in a screenshot or a headless test.

---

## 14. Rate-limit and bound the upload endpoint

**Decision.** 10 uploads/hour per IP, a 1MB body cap, a transcript character
limit, a format check before any model call, and a duplicate lookup by transcript
hash.

**Alternatives.** The original: unauthenticated, unbounded, unmetered.

**Why.** Every upload spends money. A loop over the old endpoint would drain the
API quota with no cap. The checks are ordered cheapest-first so that malformed or
duplicate input never reaches the provider.

**What I would change.** Real authentication. Rate limiting by IP is a speed
bump, not access control; this is a demo, and it says so.

---

## 15. Two deployment shapes, one codebase

**Decision.** The API serves the built dashboard when `frontend/dist` is present
in production. In that mode the API moves under `/api`; otherwise it owns the
root.

**Alternatives.** Always split (Render + Vercel only); always single-origin; ship
a Docker image.

**Why.** Both shapes are legitimate — split is the free-tier deploy, single-origin
puts the whole app on one host with no CORS — and they disagree about who owns
`/calls/:id`. The
dashboard has a client-side route there and the API has an endpoint there. Serving
both at the root means a browser deep link renders raw JSON. Moving the API under
`/api` in single-origin mode resolves it, and the frontend already defaults its
base URL to `/api`, so no frontend change was needed.

`/health` stays mounted at the root in both modes, because platform probes are
configured against `/health/live` and cannot know about a prefix.

**What I would change.** Nothing yet, but the switch is a real branch in
behaviour, so it is driven by one explicit env var (`SERVE_WEB`) with three
documented values rather than inferred from several signals. `auto` means
"production only" on purpose: a stale `frontend/dist` must not silently change
routing during development.

---

## 16. Conventional layout, and one response shape

**Decision.** The backend follows the widely-used Node layout — `controllers/`,
`routes/`, `models/`, `middlewares/`, `utils/`, `db/`, with `index.ts` as the
entry point and `app.ts` holding the Express setup. Every success response is
built by `ApiResponse` and every failure by `ApiError`.

**Alternatives.** Handlers inline in route files (the previous structure);
returning bare DTOs with no envelope.

**Why.** Two reasons, and the second is the substantive one:

1. It is the layout most Node reviewers expect, so nobody has to learn this
   project's private arrangement to find the request logic.
2. Splitting routes from controllers made the duplication visible.
   `COMMITTED_OUTCOMES` had been defined twice — once in the leaderboard handler
   and once in analytics — so changing what "the lead committed" means would have
   silently applied to one and not the other. It now lives in `constants.ts`.

The envelope earns its keep by making the client boring: `services/api.ts`
unwraps `data` in exactly one place, validating the envelope and the payload
together, so no component ever reaches into a response shape. It also leaves room
to add a top-level field later without colliding with a payload key.

**Where the convention is deliberately not followed.** `models/call.model.ts`
does not define a schema class, because Prisma generates the row types from
`prisma/schema.prisma`; the file holds what the generator cannot know — query
includes, row shapes, and how a validated analysis becomes column values. And
health probes skip the envelope, because platform uptime checks expect a flat
body.

**A note on `asyncHandler`.** Express 5 already forwards rejected promises to the
error middleware, which is the bug `asyncHandler` classically existed to fix. It
is kept because it makes every controller uniform and would still be correct on
Express 4 — but it is documented as thin rather than presented as load-bearing.

---

## Limitations

- **The golden set is 14 calls (9%).** Enough to expose a systematic failure, not
  enough for a tight confidence interval on any single field.
- **Live eval numbers for v3 are not in the repo** — running them needs an API
  key. The offline baseline needs nothing and is reproducible from committed data.
- **Token cost is zero for the seed rows.** The original pipeline discarded the
  provider's `usage` block, so that history cannot be recovered; new analyses
  record it.
- **Scores are model judgements.** They are reviewable — every score ships its
  rationale next to the transcript — but they are not calibrated against human
  raters.
- **In-memory rate limiting** resets on restart and is per-instance.
- **Free-tier hosting sleeps.** The first request can take up to a minute; the
  dashboard pings `/health/ready` and shows skeletons rather than looking broken.
- **`preferred_locations` still contains junk** in the legacy rows — `"prime
area"`, `"school nearby"`. The v3 prompt addresses it; the flagged rows need a
  repair run to clear it.
