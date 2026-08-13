# API reference

Base URL: `http://localhost:5000` in development. When the API also serves the
dashboard (single-origin mode) every path below is prefixed with `/api`; `/health`
stays at the root either way.

## The envelope

All responses are JSON, and every one has the same outer shape. Success, from
`ApiResponse`:

```json
{ "success": true, "statusCode": 200, "message": "Calls fetched", "data": { … } }
```

Failure, from `ApiError`:

```json
{
  "success": false,
  "statusCode": 400,
  "code": "bad_request",
  "message": "Invalid query parameters",
  "errors": [{ "path": "stage", "message": "Invalid enum value..." }],
  "requestId": "b3f1c2e0-..."
}
```

**Every JSON sample in this document shows what appears under `data`.** The
envelope is omitted for brevity, not because it is absent.

`code` is the stable value to branch on; `message` is for humans. `requestId` is
echoed in the `x-request-id` response header and appears in the server logs, so a
user-reported failure can be traced to one request.

Health endpoints are the deliberate exception: `/health/live` and `/health/ready`
return a flat body, because load balancers and uptime checkers match on it
directly and are not consumers of the application API.

| Code                 | Status | Meaning                                          |
| -------------------- | ------ | ------------------------------------------------ |
| `bad_request`        | 400    | Validation failed; see `errors`                  |
| `validation_error`   | 400    | A Zod failure that reached the handler unwrapped |
| `not_found`          | 404    | No such call, or no such route                   |
| `payload_too_large`  | 413    | Transcript or body exceeded its limit            |
| `rate_limited`       | 429    | Too many requests                                |
| `llm_not_configured` | 503    | Server has no `GROQ_API_KEY`; reads still work   |
| `upstream_error`     | 502    | The model provider failed after retries          |
| `internal_error`     | 500    | Unhandled; details are withheld in production    |

---

## `GET /calls`

Paginated, filtered call list. **Transcripts are excluded** — fetch one call for
that.

| Parameter               | Type                                                          | Default      | Notes                                         |
| ----------------------- | ------------------------------------------------------------- | ------------ | --------------------------------------------- |
| `page`                  | int ≥ 1                                                       | 1            |                                               |
| `pageSize`              | int 1–500                                                     | 20           | Capped by `MAX_PAGE_SIZE` (100)               |
| `q`                     | string                                                        | —            | Matches lead name, telecaller name or call id |
| `stage`                 | enum                                                          | —            | `greeting` … `next_step_confirmed`            |
| `action`                | enum                                                          | —            | `confirm_site_visit`, `mark_cold`, …          |
| `outcome`               | enum                                                          | —            | `committed_with_date`, `declined`, …          |
| `telecaller`            | string                                                        | —            | Exact name                                    |
| `location`              | string                                                        | —            | Exact preferred-location name                 |
| `minScore` / `maxScore` | 0–5                                                           | —            | Overall score bounds                          |
| `flagged`               | `true`/`false`                                                | —            | `true` returns only rows repaired at import   |
| `sort`                  | `occurredAt` \| `overallScore` \| `durationSec` \| `leadName` | `occurredAt` |                                               |
| `order`                 | `asc` \| `desc`                                               | `desc`       |                                               |

```json
{
  "data": [
    {
      "id": "ckl1...",
      "callId": "CALL_0029",
      "telecallerName": "Deepa Venkatesh",
      "leadName": "Murugesan M",
      "occurredAt": "2026-04-15T11:53:00.000Z",
      "durationSec": 122,
      "overallScore": 5,
      "unitConfiguration": "3BHK",
      "budget": { "min_lakhs": 63, "max_lakhs": 73 },
      "timeline": "immediate",
      "preferredLocations": ["Sholinganallur"],
      "siteVisitOutcome": "committed_with_date",
      "lastStageReached": "next_step_confirmed",
      "recommendedNextAction": "confirm_site_visit",
      "summary": "Discussed 3BHK in Sholinganallur…",
      "validationStatus": "valid",
      "source": "seed"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 150,
    "totalPages": 8,
    "hasNext": true,
    "hasPrev": false
  }
}
```

`budget` is either `{min_lakhs, max_lakhs}` or the string `"not_discussed"` — the
two are kept distinguishable on purpose.

---

## `GET /calls/:id`

Accepts the business key (`CALL_0052`) or the database id. Returns everything
above plus:

```json
{
  "transcript": "[00:00-00:06] Agent: \"Vanakkam sir…\"",
  "qualityScores": {
    "discovery": { "score": 4, "reason": "Asked budget, timeline and unit, but not location." },
    "pitch": { "score": 3, "reason": "…" },
    "objection_handling": { "score": 3, "reason": "…" },
    "next_step": { "score": 4, "reason": "…" }
  },
  "analysis": {
    "model": "llama-3.1-8b-instant",
    "promptVersion": "legacy",
    "promptTokens": 0,
    "completionTokens": 0,
    "costUsd": 0,
    "latencyMs": 0,
    "analyzedAt": "2026-04-08T08:34:00.000Z",
    "warnings": ["summary has 3 sentence(s); the prompt requires exactly 2"],
    "repairNotes": [
      {
        "field": "extraction.unit_configuration",
        "from": "2BHK | 3BHK | 4BHK | villa | plot | not_discussed",
        "to": "not_discussed",
        "rule": "enum spec echoed verbatim; treated as no answer"
      }
    ]
  }
}
```

`promptVersion: "legacy"` marks analyses that predate prompt versioning; their
token counts are `0` because the original pipeline discarded the usage block.

---

## `GET /leaderboard`

Query: `minCalls` (int ≥ 1, default 1) hides telecallers with too few calls to
rank.

```json
{
  "data": [
    {
      "rank": 1,
      "telecallerName": "Deepa Venkatesh",
      "callCount": 16,
      "avgOverall": 3.36,
      "dimensionAverages": {
        "discovery": 3.81,
        "pitch": 3.56,
        "objection_handling": 2.56,
        "next_step": 3.5
      },
      "siteVisitsCommitted": 12,
      "commitRate": 75
    }
  ],
  "dimensions": [{ "key": "discovery", "label": "Discovery" }]
}
```

Ranked by `avgOverall`, tie-broken by `callCount` so one lucky call cannot
outrank a consistent performer.

---

## `GET /analytics`

Aggregates for the dashboard in one round trip: `totals`, `dimensionAverages`,
`scoreDistribution`, `stageFunnel`, `actionMix`, `timelineMix`, `unitMix`,
`topLocations`.

```json
{
  "totals": {
    "calls": 150,
    "telecallers": 12,
    "avgOverall": 2.91,
    "totalCostUsd": 0,
    "totalTokens": 0,
    "flaggedForReprocessing": 19,
    "siteVisitCommitRate": 58.7
  }
}
```

---

## `POST /upload`

Analyzes a transcript and stores it. **Rate limited to 10/hour per IP** — each
uncached call costs a model request.

```json
{
  "transcript": "[00:00-00:05] Agent: Vanakkam sir…",
  "telecallerName": "Suresh Kumar",
  "leadName": "Meenakshi",
  "durationSec": 107,
  "persist": true
}
```

Only `transcript` is required (min 20 characters, must contain at least one
`[mm:ss-mm:ss] Speaker:` line). `persist: false` analyzes without writing.

Checks run cheapest-first so bad input never reaches the model: body shape →
character limit → transcript format → duplicate lookup by transcript hash →
analysis.

- `201` — analyzed and stored
- `200` — `duplicate: true` (a call with this transcript already exists) or
  `persist: false`
- `400` / `413` / `429` / `503` / `502` — see the error table above

```json
{ "call": { "…": "same shape as GET /calls/:id" }, "cached": false, "duplicate": false }
```

---

## Health

| Endpoint            | Purpose                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health/live`  | Process liveness. Never touches the database, so a transient DB blip cannot get the container killed.                                 |
| `GET /health/ready` | Readiness: checks the database, reports whether the LLM is configured. Also the dashboard's wake-up ping on sleeping free-tier hosts. |
| `GET /health/stats` | Call count, cache entries and hit count, active model and prompt version.                                                             |

`/health/live` and `/health/ready` are **not** enveloped — this is the literal
body, so an uptime checker can match on it:

```json
{
  "status": "ready",
  "checks": { "database": "ok", "llm": "not_configured" },
  "uptimeSec": 42
}
```

`/health/stats` is a normal application endpoint, so it is enveloped like the
rest and its payload sits under `data`.
