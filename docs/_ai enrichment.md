
---

## AI Enrichment API

The AI API is designed for an external daemon (e.g. a Linux host running a local LLM via Ollama) to pull unprocessed RSS items, enrich them with AI-generated tags and a summary, and push the results back. Both endpoints live under `/api/ai/` and require a named API token with the `ai:process` scope.

### Setup — create a daemon token

Use your session token to mint a named API token scoped to `ai:process`:

```bash
curl -s -X POST https://d11.me/api/v1/tokens \
  -H "Authorization: Bearer <your-session-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "ai-daemon", "scopes": ["ai:process"]}'
```

Response (raw token shown **once** — save it immediately):

```json
{
  "token": "a3f8...64hex...chars",
  "id": 7,
  "name": "ai-daemon",
  "scopes": ["ai:process"],
  "expires_at": null,
  "created_at": "2026-04-22T10:00:00Z",
  "notice": "Save this token now — it will not be shown again."
}
```

Use this token as the `Bearer` credential for all `/api/ai/*` requests.

---

### Endpoints

#### `GET /api/ai/queue`

Returns a batch of RSS items that have not yet been processed by AI (`ai_processed_at IS NULL`) and are not yet expired. Items are returned oldest-first so the daemon processes in chronological order.

**Query parameters:**

| Parameter | Type | Default | Constraints | Description |
|---|---|---|---|---|
| `limit` | integer | `20` | 1–50 | Max items to return per request |

**Request:**

```bash
curl -H "Authorization: Bearer <ai-daemon-token>" \
  "https://d11.me/api/ai/queue?limit=10"
```

**Response:**

```json
{
  "items": [
    {
      "id": 101,
      "url": "https://example.com/article",
      "title": "Some Article Title",
      "summary": "Original RSS feed description text.",
      "tag_list": "[\"tech:01\",\"news:02\"]",
      "published_at": "2026-04-22T08:30:00Z",
      "feed_name": "Hacker News"
    }
  ],
  "count": 1
}
```

**Field notes:**
- `summary` — the raw description from the RSS feed (may be HTML-stripped or empty)
- `tag_list` — JSON-encoded array of colon-suffixed tags auto-assigned during ingest (e.g. `"tech:01"` means tag `tech`, sort position `01`)
- Items with `expires_at` in the past are excluded automatically

---

#### `PATCH /api/ai/items`

Writes AI-generated tags and/or a summary back for a batch of items. Stamped with `ai_processed_at = now()` so items are not returned by `/api/ai/queue` again.

**Request body:** JSON array of item update objects. Maximum 50 items per request.

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `id` | integer | Yes | Positive integer matching an `rss_items` row | Item ID from `/api/ai/queue` |
| `ai_tags` | string[] | No | Array of lowercase tag strings | AI-generated topic tags (additive alongside existing tags) |
| `ai_summary` | string | No | Max 2000 characters | Clean AI-generated summary |

Either `ai_tags` or `ai_summary` (or both) may be provided per item. Omitted fields are stored as `NULL`.

**Request:**

```bash
curl -s -X PATCH https://d11.me/api/ai/items \
  -H "Authorization: Bearer <ai-daemon-token>" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "id": 101,
      "ai_tags": ["cloudflare", "workers", "performance"],
      "ai_summary": "Cloudflare announces a new feature for Workers that improves cold start performance by 40%."
    },
    {
      "id": 102,
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
| `400` | `{ "error": "Each item must have a positive integer id" }` | `id` missing, not an integer, or < 1 |
| `400` | `{ "error": "ai_tags must be an array" }` | `ai_tags` present but not an array |
| `400` | `{ "error": "ai_summary must be a string" }` | `ai_summary` present but not a string |
| `400` | `{ "error": "ai_summary too long (max 2000 chars)" }` | `ai_summary` exceeds 2000 characters |
| `403` | `{ "error": "Forbidden", "hint": "..." }` | Token missing or lacks `ai:process` scope |

---

### Daemon workflow

The recommended polling loop:

1. `GET /api/ai/queue?limit=20` — fetch a batch
2. For each item, run your LLM to generate tags and a summary
3. `PATCH /api/ai/items` — push results back in one batch request
4. Repeat until `count` in the queue response is `0`, then sleep and poll again in 30 minutes.

Once `ai_summary` or `ai_tags` are written back, `news.html` will immediately prefer the AI output over the original feed data for any visitor who loads the page.

---

### Python daemon example

```python
import httpx, time, os, json

BASE    = "https://d11.me/api/ai"
HEADERS = {"Authorization": f"Bearer {os.environ['D11_AI_TOKEN']}"}

def process_item(item: dict) -> dict:
    """Replace with your actual LLM call."""
    return {
        "id": item["id"],
        "ai_tags": ["example", "tag"],
        "ai_summary": f"AI summary of: {item['title']}",
    }

while True:
    r = httpx.get(f"{BASE}/queue", params={"limit": 20}, headers=HEADERS, timeout=30)
    r.raise_for_status()
    data = r.json()

    if data["count"] == 0:
        time.sleep(60)
        continue

    results = [process_item(item) for item in data["items"]]

    patch = httpx.patch(f"{BASE}/items", json=results, headers=HEADERS, timeout=30)
    patch.raise_for_status()
    print(f"Updated {patch.json()['updated']} items")
```
