/**
 * AI Enrichment Module
 * Fetches unprocessed RSS items and bookmarks from the remote API, enriches
 * each with Ollama-generated tags and a summary, and patches results back in
 * one batch. Includes a per-item failure counter: after 3 failures the item is
 * patched with ai_tags: ["ai:error"] so it is removed from future queues permanently.
 */

import { logEvent } from "../db/db";
import { collectGpu } from "./sysmetrics";

const LUMIN_API_URL = process.env.LUMIN_API_URL ?? "https://d11.me/api";
const LUMIN_API_TOKEN = process.env.LUMIN_API_TOKEN ?? "";
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://host.docker.internal:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e4b";

const FAIL_THRESHOLD = 3;
// Key is composite "source:id" to prevent collision between rss id 42 and bookmark id 42
const failCounts = new Map<string, number>();

// ── Types ────────────────────────────────────────────────────────────────────

interface QueueItem {
    source: "rss" | "bookmark";
    id: number;
    url: string;
    title: string;
    body: string;
    tags: string[];
    created_at: string;
    context: {
        feed_name?: string;
        user_id?: number;
    };
}

interface EnrichmentResult {
    source: "rss" | "bookmark";
    id: number;
    ai_tags?: string[];
    ai_summary?: string;
}

interface QueueResponse {
    items: QueueItem[];
    count: number;
    total_pending: number;
    source_breakdown: { rss: number; bookmarks: number };
}

// ── Core processor ───────────────────────────────────────────────────────────

async function processItemWithOllama(item: QueueItem): Promise<EnrichmentResult | null> {
    const sourceLabel = item.source === "bookmark" ? "bookmark archivist" : "RSS feed archivist";
    const prompt =
        `You are a ${sourceLabel}. Given the article title and description below, ` +
        `generate exactly 5 relevant lowercase tags and a clean 2-sentence summary. ` +
        `Respond ONLY with valid JSON using this exact structure: ` +
        `{"ai_tags": ["tag1", "tag2", "tag3", "tag4", "tag5"], "ai_summary": "First sentence. Second sentence."}\n\n` +
        `Title: ${item.title}\n` +
        `Description: ${item.body || "(none)"}`;

    const failKey = `${item.source}:${item.id}`;
    const eventType = item.source === "bookmark" ? "bookmark_enrichment" : "rss_enrichment";
    const contextDetails = {
        item_id: item.id,
        source: item.source,
        feed_name: item.context?.feed_name,
        title: item.title,
        url: item.url,
    };

    try {
        const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                prompt,
                stream: false,
                format: "json"
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama HTTP ${response.status}`);
        }

        const data = await response.json() as { response: string };
        const raw = JSON.parse(data.response) as Record<string, unknown>;

        const ai_tags = Array.isArray(raw.ai_tags) ? (raw.ai_tags as string[]) : undefined;
        const ai_summary = typeof raw.ai_summary === "string" ? raw.ai_summary.slice(0, 2000) : undefined;

        if (!ai_tags && !ai_summary) {
            throw new Error(`Ollama returned JSON with no usable fields: ${JSON.stringify(raw)}`);
        }

        // Reset fail count on success
        failCounts.delete(failKey);

        // Capture GPU state immediately after inference while it's still warm
        const gpu = collectGpu();

        logEvent(eventType, "success", {
            ...contextDetails,
            ai_tags,
            gpu_load: gpu?.utilization ?? null,
            gpu_vram_mib: gpu ? `${gpu.memUsed}/${gpu.memTotal}` : null,
            gpu_temp_c: gpu?.temperature ?? null
        });

        return { source: item.source, id: item.id, ai_tags, ai_summary };

    } catch (err) {
        const fails = (failCounts.get(failKey) ?? 0) + 1;
        failCounts.set(failKey, fails);
        console.warn(`[Enrichment] ${item.source}:${item.id} failed (attempt ${fails}/${FAIL_THRESHOLD}): ${err}`);

        if (fails >= FAIL_THRESHOLD) {
            failCounts.delete(failKey);
            console.warn(`[Enrichment] ${item.source}:${item.id} hit fail threshold — marking as ai:error`);
            logEvent(eventType, "sentinel", contextDetails);
            return { source: item.source, id: item.id, ai_tags: ["ai:error"] };
        }

        logEvent(eventType, "error", { ...contextDetails, error: String(err) });
        return null;
    }
}

// ── PATCH ────────────────────────────────────────────────────────────────────

async function patchResults(results: EnrichmentResult[]): Promise<void> {
    const res = await fetch(`${LUMIN_API_URL}/ai/items`, {
        method: "PATCH",
        headers: {
            "Authorization": `Bearer ${LUMIN_API_TOKEN}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(results)
    });

    if (!res.ok) {
        console.error(`[Enrichment] PATCH failed: HTTP ${res.status} — ${await res.text()}`);
        logEvent("api_error", "error", { endpoint: "PATCH /ai/items", status: res.status });
        return;
    }

    const { updated } = await res.json() as { updated: number };
    console.log(`[Enrichment] Updated ${updated} item(s).`);
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function enrichQueue(): Promise<void> {
    const authHeaders = { "Authorization": `Bearer ${LUMIN_API_TOKEN}` };

    while (true) {
        let data: QueueResponse;

        try {
            const res = await fetch(`${LUMIN_API_URL}/ai/queue?source=all&limit=20`, {
                headers: authHeaders
            });

            if (!res.ok) {
                console.error(`[Enrichment] Queue fetch failed: HTTP ${res.status}`);
                logEvent("api_error", "error", { endpoint: "GET /ai/queue", status: res.status });
                return;
            }

            data = await res.json() as QueueResponse;
        } catch (err) {
            console.error(`[Enrichment] Queue fetch error: ${err}`);
            logEvent("api_error", "error", { endpoint: "GET /ai/queue", error: String(err) });
            return;
        }

        if (data.count === 0) {
            console.log(`[Enrichment] Queue empty — nothing to process.`);
            return;
        }

        console.log(`[Enrichment] Processing ${data.count} item(s) — RSS: ${data.source_breakdown?.rss ?? 0}, Bookmarks: ${data.source_breakdown?.bookmarks ?? 0} total pending.`);

        const results: EnrichmentResult[] = [];
        for (const item of data.items) {
            const result = await processItemWithOllama(item);
            if (result !== null) {
                results.push(result);
            }
        }

        if (results.length > 0) {
            await patchResults(results);
        }

        logEvent("enrichment_cycle", "info", {
            items_fetched: data.count,
            items_patched: results.length,
            total_pending: data.total_pending ?? null,
            source_breakdown: data.source_breakdown ?? null
        });

        // If we got a full batch there may be more — drain immediately
        if (data.count < 20) break;
    }
}

// Backward-compat alias — remove once all callers are updated
export const enrichRssQueue = enrichQueue;
