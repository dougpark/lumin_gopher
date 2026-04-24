
## AI Enrichment API

The AI API is designed for an external daemon (e.g. a Linux host running a local LLM via Ollama) to pull unprocessed RSS items and bookmarks, enrich them with AI-generated tags and a summary, and push the results back. Both endpoints live under `/api/ai/` and require a named API token with an `ai:process` scope.

Three scopes are available:
- `ai:process` — legacy; grants access to both RSS items and bookmarks
- `ai:process:rss` — RSS items only
- `ai:process:bookmarks` — bookmarks only (subject to per-user privacy gate)

### Setup — create a daemon token

Use your session token to mint a named API token scoped to `ai:process:rss` and `ai:process:bookmarks`:

```bash
curl -s -X POST https://d11.me/api/v1/tokens \
  -H "Authorization: Bearer <your-session-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "ai-daemon", "scopes": ["ai:process:rss", "ai:process:bookmarks"]}'
```

Response (raw token shown **once** — save it immediately):

```json
{
  "token": "a3f8...64hex...chars",
  "id": 7,
  "name": "ai-daemon",
  "scopes": ["ai:process:rss", "ai:process:bookmarks"],
  "expires_at": null,
  "created_at": "2026-04-22T10:00:00Z",
  "notice": "Save this token now — it will not be shown again."
}
```

Use this token as the `Bearer` credential for all `/api/ai/*` requests.

---

### Endpoints

#### `GET /api/ai/queue`

Returns a batch of items (RSS and/or bookmarks) that have not yet been processed by AI (`ai_processed_at IS NULL`). RSS items must not be expired. Items are returned oldest-first.

**Query parameters:**

| Parameter | Type | Default | Constraints | Description |
|---|---|---|---|---|
| `source` | string | `all` | `rss`, `bookmarks`, `all` | Which source(s) to include (further limited by token scopes) |
| `limit` | integer | `20` | 1–50 | Max items to return per request |
| `offset` | integer | `0` | ≥ 0 | Pagination offset |
| `force` | boolean | `false` | `true` | Include already-processed items |

**Request:**

```bash
curl -H "Authorization: Bearer <ai-daemon-token>" \
  "https://d11.me/api/ai/queue?source=all&limit=10"
```

**Response:**

```json
{
  "items": [
    {
      "source": "rss",
      "id": 101,
      "url": "https://example.com/article",
      "title": "Some Article Title",
      "body": "Original RSS feed description text.",
      "tags": ["tech", "news"],
      "created_at": "2026-04-22T08:30:00Z",
      "context": { "feed_name": "Hacker News" }
    },
    {
      "source": "bookmark",
      "id": 42,
      "url": "https://example.com/post",
      "title": "A saved bookmark",
      "body": "User's manually written description.",
      "tags": ["reading", "tools"],
      "created_at": "2026-04-20T14:00:00Z",
      "context": { "user_id": 3 }
    }
  ],
  "count": 2,
  "total_pending": 342,
  "source_breakdown": { "rss": 290, "bookmarks": 52 }
}
```

**Field notes:**
- `source` — `"rss"` or `"bookmark"`; use this in the PATCH request to route writes correctly
- `body` — the text to summarize: `summary` for RSS items, `short_description` for bookmarks
- `tags` — normalized existing tags (colon sort-suffixes stripped, lowercased, deduplicated)
- `created_at` — `published_at` for RSS items, `created_at` for bookmarks
- `context` — RSS: `{ feed_name }`, bookmark: `{ user_id }`
- `total_pending` — total unprocessed items across both sources (respects `force`)
- `source_breakdown` — per-source pending counts
- Bookmark items are only returned if `is_public = 1` OR the bookmark owner has `ai_allow_private = 1`

---

#### `PATCH /api/ai/items`

Writes AI-generated tags and/or a summary back for a batch of items. Stamped with `ai_processed_at = now()` so items are not returned by `/api/ai/queue` again (unless `force=true`).

**Request body:** JSON array of item update objects. Maximum 50 items per request.

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `source` | string | Yes | `"rss"` or `"bookmark"` | Routes the write to the correct table |
| `id` | integer | Yes | Positive integer matching a row in the source table | Item ID from `/api/ai/queue` |
| `ai_tags` | string[] | No | Array of lowercase tag strings | AI-generated topic tags (additive alongside existing tags) |
| `ai_summary` | string | No | Max 2000 characters | Clean AI-generated summary |

Either `ai_tags` or `ai_summary` (or both) may be provided per item. Omitted fields are stored as `NULL`.

The token must hold the scope matching each item's `source`: `ai:process:rss` for RSS items, `ai:process:bookmarks` for bookmarks. The legacy `ai:process` scope covers both. If any item in the batch fails scope validation, the entire batch is rejected.

**Request:**

```bash
curl -s -X PATCH https://d11.me/api/ai/items \
  -H "Authorization: Bearer <ai-daemon-token>" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "source": "rss",
      "id": 101,
      "ai_tags": ["cloudflare", "workers", "performance"],
      "ai_summary": "Cloudflare announces a new feature for Workers that improves cold start performance by 40%."
    },
    {
      "source": "bookmark",
      "id": 42,
      "ai_tags": ["rust", "webassembly"],
      "ai_summary": "A tutorial on compiling Rust to WASM and running it in the browser."
    }
  ]'
```

**Response:**

```json
{ "updated": 2 }
```

**Error responses:**

| Status | Body | Cause |
|---|---|---|
| `400` | `{ "error": "Body must be a non-empty array" }` | Body is not an array or is empty |
| `400` | `{ "error": "Batch too large — max 50 items" }` | Array length > 50 |
| `400` | `{ "error": "Each item must have source 'rss' or 'bookmark'" }` | `source` missing or invalid |
| `400` | `{ "error": "Each item must have a positive integer id" }` | `id` missing, not an integer, or < 1 |
| `400` | `{ "error": "ai_tags must be an array" }` | `ai_tags` present but not an array |
| `400` | `{ "error": "ai_summary must be a string" }` | `ai_summary` present but not a string |
| `400` | `{ "error": "ai_summary too long (max 2000 chars)" }` | `ai_summary` exceeds 2000 characters |
| `403` | `{ "error": "Forbidden", "hint": "..." }` | Token missing or lacks required scope |
| `403` | `{ "error": "Token lacks ai:process:rss scope" }` | RSS item in batch but token only has bookmarks scope |
| `403` | `{ "error": "Token lacks ai:process:bookmarks scope" }` | Bookmark item in batch but token only has RSS scope |

---

### Daemon workflow

The recommended polling loop:

1. `GET /api/ai/queue?source=all&limit=20` — fetch a batch of RSS items and bookmarks
2. For each item, run your LLM to generate tags and a summary
3. `PATCH /api/ai/items` — push results back in one batch request (include `source` per item)
4. Repeat until `count` in the queue response is `0`, then sleep and poll again

Once `ai_summary` or `ai_tags` are written back, the UI will immediately surface the AI output alongside the original data for any visitor who loads the page.

---

### Bun.js daemon example

```js
// daemon.js — run with: bun daemon.js
const BASE    = "https://d11.me/api/ai"
const HEADERS = {
  "Authorization": `Bearer ${process.env.D11_AI_TOKEN}`,
  "Content-Type": "application/json",
}

/** Replace with your actual LLM call. */
function processItem(item) {
  return {
    source: item.source,   // required — routes write to rss_items or bookmarks
    id: item.id,
    ai_tags: ["example", "tag"],
    ai_summary: `AI summary of: ${item.title}`,
  }
}

while (true) {
  const data = await fetch(`${BASE}/queue?source=all&limit=20`, { headers: HEADERS }).then(r => r.json())

  if (data.count === 0) {
    await Bun.sleep(60_000)
    continue
  }

  const results = data.items.map(processItem)

  const { updated } = await fetch(`${BASE}/items`, {
    method: "PATCH",
    headers: HEADERS,
    body: JSON.stringify(results),
  }).then(r => r.json())

  console.log(`Updated ${updated} items (${data.source_breakdown.rss} rss, ${data.source_breakdown.bookmarks} bookmarks pending)`)
}
```

---

## Security notes

- **Tokens are never stored in plain text.** Plain tokens (session and API) are shown exactly once and then discarded. Only SHA-256 hashes are stored in D1.
- **`TOKEN_SECRET`** is a Wrangler secret (not in `[vars]`), never committed to source control.
- All `/api/bookmarks/*` and `/api/v1/*` routes require a valid Bearer token.
- API tokens (`api_tokens` table) are separate from session tokens and can be revoked individually without affecting the browser session.
- Token management endpoints (`POST /api/v1/tokens`, `DELETE /api/v1/tokens/:id`) require the session token — an API token cannot mint or revoke other tokens.
- Public bookmarks are readable by anyone via the redirect endpoint; private bookmarks return 404 to unauthenticated callers.
- AI daemon tokens should use `ai:process:rss` and/or `ai:process:bookmarks` scopes — do not grant `*` scope to automated processes.
