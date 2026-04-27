# Ingest Guidelines

**"link the data, don't move it"**
- large files stay on Gopher server
- only metadata and text content is sent to Lumin, with links back to the source for reference

## Provide web server to Archive Multimedia Content
- host photos, audio, and video files on the Gopher server with unique URLs
- include these URLs in the Lumin entries to allow users to access the original multimedia content without bloating the Lumin database

## The v1 source list

| Source | Key fields | Link-back | AI value |
|---|---|---|---|
| `link` | url, title, description, tags | url | medium |
| `email` | subject, from, body, thread_id | `message://` | high |
| `file` | path, hash, mime, node |  | high |
| `journal` | title, body, mood, location | `dayone://` or file path | high |
| `calendar` | title, start, end, attendees, notes | iCal UID | low |
| `highlight` | text, note, book, author, chapter | Readwise URL | medium |
| `task` | title, project, completed_at, notes | app deep link | low |
| `photo` | path, lat, lng, captured_at, EXIF |  or R2 thumb | low |
| `health` | metric, value, unit, device | Apple Health export | low |

-- Lumin provides Links and RSS News directly and we poll their APIs for AI Enchacements and return the results.
-- Gopher will be the initiator on other sources, watching for new data and pushing it to Lumin as it arrives. The "link the data, don't move it" principle means that Gopher will host any large files (photos, attachments) and just send metadata + links to Lumin.

That's a manageable v1 surface. Each maps cleanly to `records` + one extension table. The Watchdog logic for `journal`, `highlight`, and `task` is simpler than `email` or `health` — good first movers after links.

---

## The "generic envelope" escape hatch

Rather than trying to enumerate every source before v1 ships, consider a `custom` origin type that accepts any `metadata_json` payload with just `title`, `raw_id`, and `source_node` required. Any source that doesn't have a first-class extension table yet can submit as `custom`. This gives you a working ingest path for any new source immediately, with the option to graduate it to a typed extension table later when the schema stabilizes.


## Lumin API
- not defined yet, but will likely be a REST API with endpoints for creating and updating records, as well as fetching metadata for enrichment purposes
- the API should be designed to handle high volumes of data and support batch operations for efficiency
- authentication and security measures should be implemented to protect user data and prevent unauthorized access
- Bearer token authentication is a common choice for API security, where the client includes a token in the Authorization header of each request to authenticate with the server. The server can then validate the token and grant access to the requested resources if the token is valid.




------------
initial plan
------------



Read [](file:///home/dougpark/Production/lumin_gopher/docs/_ingest.md)

Good context. Here's the design thinking:

---

## Core Architecture: The Connector Pipeline

The key insight is that all 10 sources are just different **input shapes** feeding the same **pipeline stages**. Design around the pipeline, not the sources.

```
Source A ─┐
Source B ─┤→ [Normalize] → [Enrich] → [Store Assets] → [Sync Queue] → Lumin API
Source C ─┘
```

---

### Stage 1: Connectors (one per source)

Each source gets a single file — a **connector** — that implements a common interface with three responsibilities:

- **Trigger**: how it wakes up (`watch()` for file drops, `poll()` for APIs/RSS, webhook for email)
- **Normalize**: maps source-specific fields into a shared internal envelope
- **Asset extraction**: identifies any large objects that need local hosting

The connector emits a normalized record. It knows nothing about AI or Lumin.

---

### Stage 2: The Normalized Envelope

A single shared shape that every connector outputs:

```
{
  source:      "email" | "photo" | "link" | ...
  raw_id:      string          // dedup key — message-id, file hash, URL, etc.
  title:       string
  body_text:   string          // what goes to Ollama
  link_back:   string          // deep link or URL back to source
  metadata:    {}              // source-specific (EXIF, attendees, mood, etc.)
  assets:      []              // large files to host locally
}
```

The `custom` escape hatch from your doc maps perfectly here — any unlisted source just fills `title`, `raw_id`, and skips the typed fields.

---

### Stage 3: AI Enrichment (already built, make it generic)

Your current enrichment worker is RSS-specific. Generalize it: accept the envelope's `title + body_text`, return `ai_tags + ai_summary`. The AI loop doesn't care about the source.

Sources with **low AI value** (calendar, task, health) from your doc can skip enrichment entirely — the connector sets a flag.

---

### Stage 4: Local Asset Storage

A simple `assets/` directory served by Gopher's existing Bun web server, organized by source:

```
/assets/photos/2026/04/abc123.jpg  →  http://aistation.local:3030/assets/...
/assets/email/attachments/...
```

The connector stores the file, sets `asset.publicUrl` in the envelope. Only that URL goes to Lumin — the blob never leaves your server.

---

### Stage 5: Sync Queue → Lumin

A SQLite-backed outbox table: normalized records waiting to be POSTed to Lumin. This decouples ingest speed from API availability — if Lumin is unreachable, records queue up and drain later. Retry logic lives here, not in the connectors.

---

## The Source Trigger Matrix

From your doc, the 9 sources break into three trigger types:

| Trigger | Sources |
|---|---|
| **File watch** (inotify, already built) | `file`, `photo`, `journal` (if file-based), `health` (Apple export) |
| **API poll** (interval, already built) | `link` (RSS already works), `highlight` (Readwise), `task` (Todoist etc.) |
| **Push / webhook** | `email` (IMAP idle or webhook), `calendar` (CalDAV subscription) |

You already have both file-watch and API-poll infrastructure. The only new trigger type is push/webhook for email and calendar.

---

## What to Build Next (priority order)

1. **Define the envelope type** in db.ts — the common record schema
2. **Refactor the existing RSS worker** into the generic pipeline (it's already 80% there)
3. **Add `file` connector** — your file watcher already calls `tagFileWithOllama`, just normalize its output into the envelope
4. **Asset server route** — one `GET /assets/*` static-file route in index.ts
5. **Sync queue** — an `outbox` SQLite table with retry logic
6. **Add each remaining connector** one at a time — they're isolated by design

The `custom` escape hatch means you can wire up any source immediately without a typed connector — just push the envelope directly.

The envelope handles it cleanly — but the key is **one field**: `source`. Lumin never needs separate API endpoints per source type.

---

## How It Works

Gopher sends one shape to one endpoint:

```
POST /api/records
{
  source:    "photo",
  title:     "Sunset at the lake",
  body_text: "...",
  link_back: "http://aistation.local:3030/assets/photos/abc123.jpg",
  metadata:  { lat: 32.7, lng: -97.3, captured_at: "...", exif: {...} },
  ai_tags:   ["landscape", "golden-hour"],
  ai_summary: "..."
}
```

Lumin receives it, stores `metadata` as opaque JSON, and tags the record with `source: "photo"`. At render time, Lumin's frontend does:

```
if source == "photo"    → render PhotoCard   (image, map pin, EXIF strip)
if source == "email"    → render EmailCard   (from/subject/thread view)
if source == "highlight"→ render QuoteCard   (pullquote, book, author)
if source == "health"   → render MetricCard  (chart, unit, device)
```

---

## Why This Is the Right Call

**One API, typed by `source`** is the standard pattern (Slack calls it "block types", Notion calls it "block types" too). The alternative — separate endpoints per source — creates API sprawl and forces Lumin to add a new route every time Gopher adds a connector. With the envelope approach, Lumin adds a new **renderer**, not a new **API contract**.

The only thing Lumin needs to know is: *"for `source: photo`, the `metadata` object will have `lat`, `lng`, `captured_at`"*. That's a shared schema contract between Gopher and Lumin, documented per source type — not enforced by the API.

---

## The One Tradeoff

Since `metadata` is opaque JSON, Lumin's database can't query inside it without parsing. If Lumin ever needs to filter records by EXIF lens model or email sender, those fields need to be promoted to top-level columns on the Lumin side. 

**Rule of thumb:** anything Lumin needs to **search or filter** → top-level field. Anything Lumin only needs to **display** → stays in `metadata`.

For v1, `source`, `title`, `ai_tags`, `link_back`, and timestamps are enough top-level fields for every useful filter. Everything else is display-only and belongs in the JSON blob.

Exactly. Each source owns its `metadata` schema completely — Gopher defines it, Lumin reads it, the API never validates it.

The practical way to manage this is a **source schema registry**: a single shared doc (or TypeScript type file used by both codebases) that defines what each blob looks like:

```
source: "photo"
metadata: {
  lat, lng, altitude,
  captured_at,
  device, lens, focal_length, iso, aperture,
  album, location_name,
  asset_url, thumb_url
}

source: "email"  
metadata: {
  from, to, cc,
  subject, thread_id,
  has_attachments, attachment_urls[],
  folder, labels[]
}

source: "health"
metadata: {
  metric,        // "steps" | "heart_rate" | "sleep" | ...
  value, unit,
  device,
  interval_start, interval_end,
  source_app     // "Apple Health" | "Garmin" | ...
}
```

Since both Gopher (writes) and Lumin (reads) are your own codebases, you can version this informally — just add fields freely. The only discipline needed is **never remove or rename** a field once Lumin is rendering it, because old records in the database won't have the new shape. Additive-only changes are always safe.

The real leverage here is that a `health` blob can carry a full week of data points in one record if you want, or one data point per record — you choose the granularity per source without any API negotiation. That's the payoff of owning both ends.

Yes, it needs a proper status field. The `ai:error` tag hack works but it pollutes tag data and makes Lumin have to check tag content to understand record health — that's the wrong layer for error signaling.

---

## The Right Shape

Add `status` and optionally `error` to the envelope top-level:

```
status:  "complete" | "partial" | "failed" | "pending"
error:   "ollama_timeout" | "parse_error" | "fetch_failed" | null
```

**`complete`** — everything worked, full enrichment present  
**`partial`** — record ingested successfully but enrichment failed (this is your current RSS problem — the item *is* stored, the AI just didn't work)  
**`failed`** — the source itself failed, record may be incomplete  
**`pending`** — ingested but enrichment hasn't run yet (useful if you decouple ingest from AI)

---

## What Lumin Does With This

- `complete` → normal render
- `partial` → render the record but show a subtle "AI unavailable" indicator, don't show empty tag/summary fields
- `failed` → show in an admin error queue for review
- `pending` → show a loading state if the UI is live, or just wait

This also gives Lumin a retry hook — it can call back to Gopher (or Gopher can re-queue) any record with `status: "partial"` without needing to re-ingest the source data.

---

## The Current RSS Sentinel in This Model

Your `ai:error` sentinel becomes: ingest the item as `status: "partial"`, `error: "ollama_max_retries"`, send it to Lumin immediately with whatever metadata you have. Lumin knows it's real data with failed enrichment — not a corrupted record, not a fake tag. The distinction matters when Lumin eventually adds filtering or admin views.