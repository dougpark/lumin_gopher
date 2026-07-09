# ai-files.md
- use the Lumin API to get a list of files that need ai enrichment
- uses same api as RSS and Bookmarks
- uses the same LUMIN_API_TOKEN with `ai:process` scope
- use same schedule

# Filter before sending to LLM
- do not send unsupported binary files (e.g. .exe, .dll, .bin, .iso, etc.)
- do not send: .zip, .tar, .dmg, etc.
- do not send files larger than 10MB
- acceptable file types: .txt, .md, .csv, .json, .xml, .html, .jpg, .jpeg, .png, .gif, webp, .mp3, .wav, .mp4, .mov, .avi, .mkv

- requires preprocessing text extraction for: .pdf, .docx, .pptx, .xlsx // implement in version 2

- rejected files should complete normally with a log message indicating the reason for rejection, and should not be retried in future queue requests.
- rejected files should be returned in the queue response with a `rejected_reason` in the ai_summary field, e.g. `ai_summary: "Rejected: file type not supported"` or `ai_summary: "Rejected: file size exceeds 10MB"`.


## AI Enrichment API

The AI API is designed for an external daemon (e.g. a Linux host running a local LLM via Ollama) to pull unprocessed RSS items, bookmarks, and files, enrich them with AI-generated tags and a summary, and push the results back. Queue and patch endpoints live under `/api/ai/` and require a named API token with an `ai:process*` scope.

Four scopes are available:
- `ai:process` — legacy; grants access to RSS items, bookmarks, and files
- `ai:process:rss` — RSS items only
- `ai:process:bookmarks` — bookmarks only (subject to per-user privacy gate)
- `ai:process:files` — file items only (attachments table)

### Setup — create a daemon token

Use your session token to mint a named API token scoped to `ai:process:rss`, `ai:process:bookmarks`, and `ai:process:files`:

```bash
curl -s -X POST https://d11.me/api/v1/tokens \
  -H "Authorization: Bearer <your-session-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "ai-daemon", "scopes": ["ai:process:rss", "ai:process:bookmarks", "ai:process:files"]}'
```

Response (raw token shown **once** — save it immediately):

```json
{
  "token": "a3f8...64hex...chars",
  "id": 7,
  "name": "ai-daemon",
  "scopes": ["ai:process:rss", "ai:process:bookmarks", "ai:process:files"],
  "expires_at": null,
  "created_at": "2026-04-22T10:00:00Z",
  "notice": "Save this token now — it will not be shown again."
}
```

Use this token as the `Bearer` credential for all `/api/ai/*` requests.

---

### Endpoints

#### `GET /api/ai/queue`

Returns a batch of items (RSS, bookmarks, and/or files) that have not yet been processed by AI (`ai_processed_at IS NULL`). RSS items must not be expired. Items are returned oldest-first.

**Query parameters:**

| Parameter | Type | Default | Constraints | Description |
|---|---|---|---|---|
| `source` | string | `all` | `rss`, `bookmarks`, `file`, `all` | Which source(s) to include (further limited by token scopes) |
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
    },
    {
      "source": "file",
      "file_id": "att_0c7f9d1f9f524bb5b136f52be6a92cd0",
      "file_name": "Q2-report.pdf",
      "file_type": "application/pdf",
      "file_size": 834219,
      "file_path": "https://d11.me/api/ai/files/download?t=<signed-token>",
      "tags": ["finance", "quarterly"],
      "summary": "Internal quarterly report",
      "created_at": "2026-04-21T09:10:00Z",
      "context": { "owner_user_id": 3, "attachment_id": 777 }
    }
  ],
  "count": 3,
  "total_pending": 354,
  "source_breakdown": { "rss": 290, "bookmarks": 52, "file": 12 }
}
```

**Field notes:**
- `source` — `"rss"`, `"bookmark"`, or `"file"`; use this in the PATCH request to route writes correctly
- `body` — the text to summarize: `summary` for RSS items, `short_description` for bookmarks
- File items use `summary` and include `file_path` (an expiring signed URL)
- `tags` — normalized existing tags (colon sort-suffixes stripped, lowercased, deduplicated)
- `created_at` — `published_at` for RSS items, `created_at` for bookmarks and files
- `context` — RSS: `{ feed_name }`, bookmark: `{ user_id }`, file: `{ owner_user_id, attachment_id }`
- `total_pending` — total unprocessed items across all selected sources (respects `force`)
- `source_breakdown` — per-source pending counts
- Bookmark items are only returned if `is_public = 1` OR the bookmark owner has `ai_allow_private = 1`

**File-only request example:**

```bash
curl -H "Authorization: Bearer <ai-daemon-token>" \
  "https://d11.me/api/ai/queue?source=file&limit=10"
```

---

#### `GET /api/ai/files/download`

Downloads a file object via the signed `file_path` URL returned by `GET /api/ai/queue`.

- Authentication is the signed `t` query token itself.
- No `Authorization` header is required.
- Tokens are short-lived and intended for daemon fetch use.

**Request:**

```bash
curl -L "https://d11.me/api/ai/files/download?t=<signed-token-from-file_path>" \
  -o downloaded-file.bin
```

---

#### `PATCH /api/ai/items`

Writes AI-generated tags and/or a summary back for a batch of items. Stamped with `ai_processed_at = now()` so items are not returned by `/api/ai/queue` again (unless `force=true`).

**Request body:** JSON array of item update objects. Maximum 50 items per request.

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `source` | string | Yes | `"rss"`, `"bookmark"`, or `"file"` | Routes the write to the correct table |
| `id` | integer | Conditionally | Required for `rss` and `bookmark` | Item ID from `/api/ai/queue` |
| `file_id` | string | Conditionally | Required for `file`; non-empty attachment slug | File ID from `/api/ai/queue` |
| `ai_tags` | string[] | No | Array of lowercase tag strings | AI-generated topic tags (additive alongside existing tags) |
| `ai_summary` | string | No | Max 2000 characters | Clean AI-generated summary |

Either `ai_tags` or `ai_summary` (or both) may be provided per item. Omitted fields are stored as `NULL`.

The token must hold the scope matching each item's `source`: `ai:process:rss` for RSS items, `ai:process:bookmarks` for bookmarks, and `ai:process:files` for files. The legacy `ai:process` scope covers all three. If any item in the batch fails scope validation, the entire batch is rejected.

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
    },
    {
      "source": "file",
      "file_id": "att_0c7f9d1f9f524bb5b136f52be6a92cd0",
      "ai_tags": ["finance", "report", "q2"],
      "ai_summary": "Quarterly report with revenue and cost breakdowns."
    }
  ]'
```

**Response:**

```json
{ "updated": 3 }
```

**Error responses:**

| Status | Body | Cause |
|---|---|---|
| `400` | `{ "error": "Body must be a non-empty array" }` | Body is not an array or is empty |
| `400` | `{ "error": "Batch too large — max 50 items" }` | Array length > 50 |
| `400` | `{ "error": "Each item must have source 'rss', 'bookmark', or 'file'" }` | `source` missing or invalid |
| `400` | `{ "error": "Each rss/bookmark item must have a positive integer id" }` | `id` missing, not an integer, or < 1 for rss/bookmark items |
| `400` | `{ "error": "File items must include a non-empty string file_id" }` | `file_id` missing or invalid for file items |
| `400` | `{ "error": "ai_tags must be an array" }` | `ai_tags` present but not an array |
| `400` | `{ "error": "ai_summary must be a string" }` | `ai_summary` present but not a string |
| `400` | `{ "error": "ai_summary too long (max 2000 chars)" }` | `ai_summary` exceeds 2000 characters |
| `403` | `{ "error": "Forbidden", "hint": "..." }` | Token missing or lacks required scope |
| `403` | `{ "error": "Token lacks ai:process:rss scope" }` | RSS item in batch but token only has bookmarks scope |
| `403` | `{ "error": "Token lacks ai:process:bookmarks scope" }` | Bookmark item in batch but token only has RSS scope |
| `403` | `{ "error": "Token lacks ai:process:files scope" }` | File item in batch but token lacks files scope |

---

### Daemon workflow

The recommended polling loop:

1. `GET /api/ai/queue?source=all&limit=20` — fetch a batch of RSS items, bookmarks, and files
2. For `source=file`, fetch bytes using `file_path` (signed URL), then run your LLM
3. For non-file sources, run your LLM directly on queue payload fields
4. `PATCH /api/ai/items` — push results back in one batch request (include `source` per item)
5. Repeat until `count` in the queue response is `0`, then sleep and poll again

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
async function processItem(item) {
  if (item.source === "file") {
    // Example: pull file bytes for preprocessing (OCR, text extraction, etc.)
    const fileRes = await fetch(item.file_path)
    const fileBytes = await fileRes.arrayBuffer()
    const size = fileBytes.byteLength

    return {
      source: "file",
      file_id: item.file_id,
      ai_tags: ["file", "processed"],
      ai_summary: `Processed ${item.file_name} (${size} bytes).`,
    }
  }

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

  const results = await Promise.all(data.items.map(processItem))

  const { updated } = await fetch(`${BASE}/items`, {
    method: "PATCH",
    headers: HEADERS,
    body: JSON.stringify(results),
  }).then(r => r.json())

  console.log(
    `Updated ${updated} items (${data.source_breakdown.rss} rss, ${data.source_breakdown.bookmarks} bookmarks, ${data.source_breakdown.file} files pending)`
  )
}
```

# Processing
- get the list of files from the queue endpoint
- for each file, download the file bytes using the signed `file_path` URL
- filter for valid file types and sizes (reject unsupported types and files > 10MB)
- run the file bytes through your LLM to generate tags and a summary
- record all necessary metadata (source, id/file_id, ai_tags, ai_summary) for each processed file
- update gopher stats for new source type of files (e.g. `ai_files_processed`, `ai_files_rejected`, etc.)
- send the results back to the API using the `PATCH /api/ai/items` endpoint