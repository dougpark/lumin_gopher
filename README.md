# 🐿️ Lumin Gopher

> A local AI agent that bridges your home lab to the [Lumin](https://d11.me) master index. It watches a local folder for new files, enriches RSS queue items with AI-generated tags and summaries, and keeps the remote index up to date — all powered by a local Ollama instance running on your own hardware.

---

## Features

### 📂 Local File Watcher
Monitors a `watch_folder/` directory using the Linux kernel's `inotify`. When a new file is dropped in, the Gopher automatically extracts its content and sends it to Ollama for AI enrichment.

**Supported file types:**
| Category | Extensions |
|---|---|
| Plain text & code | `.txt`, `.md`, `.ts`, `.js`, `.json`, `.csv`, `.yaml`, `.sql`, `.sh`, and more |
| Documents | `.pdf` (via `unpdf`), `.docx` (via `mammoth`) |
| Fallback | Any unknown/binary type — uses filename only |

The first 1,000 characters of extractable content are sent to Ollama alongside the filename for more accurate results.

---

### 🤖 AI File Tagging (`src/tagger.ts`)
For each detected file, calls a local Ollama model to generate:
- **5 relevant tags**
- **A 2-sentence summary**

Results are logged to the console, ready to be forwarded to the Lumin API.

---

### 📡 RSS AI Enrichment (`src/enrichment.ts`)
Polls the Lumin remote API every **30 minutes** to fetch unprocessed RSS items and enriches them with AI. On startup, an immediate drain run clears any existing backlog before the first interval fires.

**Workflow:**
1. `GET /api/ai/queue?limit=20` — fetch a batch of unprocessed items
2. For each item, send `title` + `description` to Ollama → receive `ai_tags` + `ai_summary`
3. `PATCH /api/ai/items` — push the full enriched batch back in one request
4. If the batch was full (20 items), immediately fetch the next batch (drain loop)
5. Sleep until the next 30-minute interval

**Failure handling:** A per-item fail counter tracks consecutive Ollama errors across cycles. After **3 failures** on the same item, it is patched with `ai_tags: ["ai:error"]`, permanently removing it from the queue so it never clogs future batches.

---

### 🌐 Management Dashboard (`http://aistation.local:3030`)

| Route | Description |
|---|---|
| `/` | Live status dashboard (HTML) |
| `/stats` | JSON health endpoint used by Docker healthcheck |

---

## Architecture

```
lumin_gopher/
├── src/
│   ├── index.ts        # Entry point — watcher, web server, interval timer
│   ├── tagger.ts       # File drop AI tagging (extract → Ollama → log)
│   └── enrichment.ts   # RSS queue polling (fetch → Ollama → PATCH API)
├── watch_folder/       # Drop files here to trigger AI tagging
├── docker-compose.yml
├── .env
└── package.json
```

**Runtime:** [Bun.js](https://bun.sh) inside Docker (`oven/bun:latest`)  
**AI:** Local [Ollama](https://ollama.com) — communicates over `host.docker.internal`  
**Remote API:** `https://d11.me/api` (Lumin master index)

---

## Getting Started

### Prerequisites
- Docker with the NVIDIA container toolkit (if using a GPU-accelerated Ollama model)
- [Ollama](https://ollama.com) running on the host with your chosen model pulled
- A Lumin API token with `ai:process` scope

### 1. Clone and configure

```bash
git clone https://github.com/dougpark/lumin_gopher.git
cd lumin_gopher
```

Create a `.env` file:

```env
LUMIN_API_URL=https://d11.me/api
LUMIN_API_TOKEN=your_token_here
OLLAMA_HOST=http://host.docker.internal:11434
OLLAMA_MODEL=gemma4:e4b
```

> **Mint a Lumin API token** (requires an existing session token):
> ```bash
> curl -s -X POST https://d11.me/api/v1/tokens \
>   -H "Authorization: Bearer <your-session-token>" \
>   -H "Content-Type: application/json" \
>   -d '{"name": "ai-daemon", "scopes": ["ai:process"]}'
> ```

### 2. Tune the host kernel (one-time)

The recursive file watcher requires a higher inotify watch limit:

```bash
echo "fs.inotify.max_user_watches=524288" | sudo tee /etc/sysctl.d/99-inotify.conf
sudo sysctl -p /etc/sysctl.d/99-inotify.conf
```

### 3. Start

```bash
docker compose up -d
```

`bun install` runs automatically inside the container on every start. Check status:

```bash
docker ps          # shows health: healthy / starting
docker compose logs -f
```

### 4. Drop a file

```bash
cp my-document.pdf watch_folder/
```

The Gopher will detect it within seconds and log AI-generated tags and a summary to the console.

---

## Configuration Reference

| Variable | Default | Description |
|---|---|---|
| `LUMIN_API_URL` | `https://d11.me/api` | Base URL for the Lumin remote API |
| `LUMIN_API_TOKEN` | — | Bearer token with `ai:process` scope |
| `OLLAMA_HOST` | `http://host.docker.internal:11434` | Ollama API endpoint reachable from Docker |
| `OLLAMA_MODEL` | `gemma4:e4b` | Ollama model name to use for all AI calls |

---

## Docker Compose Details

| Setting | Value |
|---|---|
| Restart policy | `unless-stopped` — survives crashes and host reboots |
| Healthcheck | `GET /stats` every 30s, 3 retries |
| Logging | `json-file`, 10MB × 3 files |
| Networking | `host.docker.internal` mapped to host gateway |

---

## License

Private — Fort Worth Linux Lab 🤠
