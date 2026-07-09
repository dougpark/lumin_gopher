/**
 * AI Enrichment Module
 * Fetches unprocessed RSS items, bookmarks, and files from the remote API, enriches
 * each with Ollama-generated tags and a summary, and patches results back in
 * one batch. Includes a per-item failure counter: after 3 failures the item is
 * patched with ai_tags: ["ai:error"] so it is removed from future queues permanently.
 */

import { logEvent } from "../db/db";
import { extractFileContentFromBuffer, validatePhase1AiFile } from "./fileContent.ts";
import { collectGpu, collectStationPower } from "./sysmetrics";

const LUMIN_API_URL = process.env.LUMIN_API_URL ?? "https://d11.me/api";
const LUMIN_API_TOKEN = process.env.LUMIN_API_TOKEN ?? "";
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://host.docker.internal:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e4b"; const RSS_MAX_AGE_MS = parseInt(process.env.RSS_MAX_AGE_DAYS ?? "7", 10) * 86_400_000;
const ENABLE_BOOKMARK_QUEUE = process.env.AI_ENABLE_BOOKMARK_QUEUE !== "0";
const FAIL_THRESHOLD = 3;
const failCounts = new Map<string, number>();

// ── Types ────────────────────────────────────────────────────────────────────

interface RssQueueItem {
    source: "rss";
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

interface BookmarkQueueItem {
    source: "bookmark";
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

interface FileQueueItem {
    source: "file";
    file_id: string;
    file_name: string;
    file_type: string;
    file_size: number;
    file_path: string;
    tags: string[];
    summary: string;
    created_at: string;
    context: {
        owner_user_id?: number;
        attachment_id?: number;
    };
}

type QueueItem = RssQueueItem | BookmarkQueueItem | FileQueueItem;

type EnrichmentResult =
    | {
        source: "rss" | "bookmark";
        id: number;
        ai_tags?: string[];
        ai_summary?: string;
    }
    | {
        source: "file";
        file_id: string;
        ai_tags?: string[];
        ai_summary?: string;
    };

interface QueueResponse {
    items: QueueItem[];
    count: number;
    total_pending: number;
    source_breakdown: { rss: number; bookmarks: number; file: number };
}

type QueueSourceParam = "all" | "rss" | "bookmarks" | "file";

// ── Core processor ───────────────────────────────────────────────────────────

function getFailKey(item: QueueItem): string {
    return item.source === "file" ? `file:${item.file_id}` : `${item.source}:${item.id}`;
}

function getEventType(item: QueueItem): "rss_enrichment" | "bookmark_enrichment" | "file_enrichment" {
    if (item.source === "bookmark") return "bookmark_enrichment";
    if (item.source === "file") return "file_enrichment";
    return "rss_enrichment";
}

function buildPrompt(item: RssQueueItem | BookmarkQueueItem): string {
    const sourceLabel = item.source === "bookmark" ? "bookmark archivist" : "RSS feed archivist";
    return (
        `You are a ${sourceLabel}. Given the article title and description below, ` +
        `generate exactly 5 relevant lowercase tags and a clean 5-sentence summary. ` +
        `Respond ONLY with valid JSON using this exact structure: ` +
        `{"ai_tags": ["tag1", "tag2", "tag3", "tag4", "tag5"], "ai_summary": "First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence."}\n\n` +
        `Title: ${item.title}\n` +
        `Description: ${item.body || "(none)"}`
    );
}

function buildFilePrompt(item: FileQueueItem, contentSnippet: string): string {
    return (
        `You are a file archivist. Given the file metadata and extracted content below, ` +
        `generate exactly 5 relevant lowercase tags and a clean 5-sentence summary. ` +
        `Respond ONLY with valid JSON using this exact structure: ` +
        `{"ai_tags": ["tag1", "tag2", "tag3", "tag4", "tag5"], "ai_summary": "First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence."}\n\n` +
        `File name: ${item.file_name}\n` +
        `File type: ${item.file_type || "(unknown)"}\n` +
        `File size bytes: ${item.file_size}\n` +
        `Existing tags: ${(item.tags ?? []).join(", ") || "(none)"}\n` +
        `Human summary: ${item.summary || "(none)"}\n` +
        `Extracted content:\n<content>\n${contentSnippet || "(none)"}\n</content>`
    );
}

async function processItemWithOllama(item: QueueItem): Promise<EnrichmentResult | null> {
    const failKey = getFailKey(item);
    const eventType = getEventType(item);
    const contextDetails = item.source === "file"
        ? {
            file_id: item.file_id,
            source: item.source,
            file_name: item.file_name,
            file_type: item.file_type,
            file_size: item.file_size,
            attachment_id: item.context?.attachment_id,
            owner_user_id: item.context?.owner_user_id,
        }
        : {
            item_id: item.id,
            source: item.source,
            feed_name: item.context?.feed_name,
            title: item.title,
            url: item.url,
        };

    try {
        let prompt: string;

        if (item.source === "file") {
            const validation = validatePhase1AiFile(item.file_name, item.file_type, item.file_size);
            if (!validation.accepted) {
                logEvent(eventType, "sentinel", { ...contextDetails, reason: validation.reason });
                return { source: "file", file_id: item.file_id, ai_tags: ["ai:error"], ai_summary: validation.reason };
            }

            const fileResponse = await fetch(item.file_path);
            if (!fileResponse.ok) {
                throw new Error(`File download HTTP ${fileResponse.status}`);
            }

            const fileBuffer = await fileResponse.arrayBuffer();
            const contentSnippet = await extractFileContentFromBuffer(item.file_name, item.file_type, fileBuffer);
            if (!contentSnippet) {
                throw new Error(`No extractable text for ${item.file_name}`);
            }
            prompt = buildFilePrompt(item, contentSnippet);
        } else {
            prompt = buildPrompt(item);
        }

        const inferenceStart = Date.now();
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

        // Capture GPU + station power immediately after inference while still warm
        const inferenceSecs = (Date.now() - inferenceStart) / 1000;
        const gpu = collectGpu();
        const stationWatts = await collectStationPower();
        const stationWh = stationWatts !== null
            ? parseFloat(((stationWatts * inferenceSecs) / 3600).toFixed(4))
            : null;

        logEvent(eventType, "success", {
            ...contextDetails,
            ai_tags,
            ai_summary,
            inference_secs: parseFloat(inferenceSecs.toFixed(1)),
            gpu_load: gpu?.utilization ?? null,
            gpu_vram_mib: gpu ? `${gpu.memUsed}/${gpu.memTotal}` : null,
            gpu_temp_c: gpu?.temperature ?? null,
            station_watts: stationWatts,
            station_wh: stationWh
        });

        if (item.source === "file") {
            return { source: "file", file_id: item.file_id, ai_tags, ai_summary };
        }

        return { source: item.source, id: item.id, ai_tags, ai_summary };

    } catch (err) {
        const fails = (failCounts.get(failKey) ?? 0) + 1;
        failCounts.set(failKey, fails);
        const itemLabel = item.source === "file" ? `${item.source}:${item.file_id}` : `${item.source}:${item.id}`;
        console.warn(`[Enrichment] ${itemLabel} failed (attempt ${fails}/${FAIL_THRESHOLD}): ${err}`);

        if (fails >= FAIL_THRESHOLD) {
            failCounts.delete(failKey);
            console.warn(`[Enrichment] ${itemLabel} hit fail threshold — marking as ai:error`);
            logEvent(eventType, "sentinel", contextDetails);
            if (item.source === "file") {
                return { source: "file", file_id: item.file_id, ai_tags: ["ai:error"] };
            }
            return { source: item.source, id: item.id, ai_tags: ["ai:error"] };
        }

        logEvent(eventType, "error", { ...contextDetails, error: String(err) });
        return null;
    }
}

// ── PATCH ────────────────────────────────────────────────────────────────────

async function patchResults(results: EnrichmentResult[]): Promise<{ ok: boolean; updated: number }> {
    const res = await fetch(`${LUMIN_API_URL}/ai/items`, {
        method: "PATCH",
        headers: {
            "Authorization": `Bearer ${LUMIN_API_TOKEN}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(results)
    });

    if (!res.ok) {
        const body = await res.text();
        console.error(`[Enrichment] PATCH failed: HTTP ${res.status} — ${body}`);
        logEvent("api_error", "error", {
            endpoint: "PATCH /ai/items",
            status: res.status,
            attempted: results.length,
            body: body.slice(0, 500)
        });
        return { ok: false, updated: 0 };
    }

    const { updated } = await res.json() as { updated: number };
    console.log(`[Enrichment] PATCH ok — attempted=${results.length}, updated=${updated}.`);
    return { ok: true, updated };
}

async function fetchQueueSource(
    source: QueueSourceParam,
    limit: number,
    authHeaders: Record<string, string>
): Promise<{ ok: true; data: QueueResponse } | { ok: false; status: number; body: string }> {
    const res = await fetch(`${LUMIN_API_URL}/ai/queue?source=${source}&limit=${limit}`, {
        headers: authHeaders
    });

    if (!res.ok) {
        return {
            ok: false,
            status: res.status,
            body: await res.text()
        };
    }

    const data = await res.json() as QueueResponse;
    return { ok: true, data };
}

async function fetchQueueWithFallback(
    limit: number,
    authHeaders: Record<string, string>
): Promise<QueueResponse | null> {
    const primary = await fetchQueueSource("all", limit, authHeaders);
    if (primary.ok) {
        return primary.data;
    }

    // Auth failures should fail fast; fallback will not help.
    if (primary.status === 401 || primary.status === 403) {
        console.error(`[Enrichment] Queue fetch failed: HTTP ${primary.status}`);
        logEvent("api_error", "error", { endpoint: "GET /ai/queue", status: primary.status });
        return null;
    }

    console.warn(`[Enrichment] Queue fetch source=all failed: HTTP ${primary.status}. Falling back to per-source polling.`);
    logEvent("api_error", "error", {
        endpoint: "GET /ai/queue",
        status: primary.status,
        source: "all",
        fallback: true,
        body: primary.body.slice(0, 500)
    });

    const merged: QueueResponse = {
        items: [],
        count: 0,
        total_pending: 0,
        source_breakdown: { rss: 0, bookmarks: 0, file: 0 }
    };

    let remaining = limit;
    let successCount = 0;

    const sources: QueueSourceParam[] = ENABLE_BOOKMARK_QUEUE
        ? ["rss", "bookmarks", "file"]
        : ["rss", "file"];

    for (const source of sources) {
        if (remaining <= 0) break;

        const partial = await fetchQueueSource(source, remaining, authHeaders);
        if (!partial.ok) {
            console.warn(`[Enrichment] Queue fetch source=${source} failed: HTTP ${partial.status} — ${partial.body.slice(0, 200)}`);
            logEvent("api_error", "error", {
                endpoint: "GET /ai/queue",
                status: partial.status,
                source,
                body: partial.body.slice(0, 500)
            });
            continue;
        }

        successCount++;
        merged.items.push(...partial.data.items);
        merged.total_pending += partial.data.total_pending ?? 0;
        merged.source_breakdown.rss += partial.data.source_breakdown?.rss ?? 0;
        merged.source_breakdown.bookmarks += partial.data.source_breakdown?.bookmarks ?? 0;
        merged.source_breakdown.file += partial.data.source_breakdown?.file ?? 0;
        remaining = Math.max(0, limit - merged.items.length);
    }

    merged.count = merged.items.length;

    if (successCount === 0) {
        return null;
    }

    return merged;
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function enrichQueue(): Promise<void> {
    const authHeaders = { "Authorization": `Bearer ${LUMIN_API_TOKEN}` };

    if (!ENABLE_BOOKMARK_QUEUE) {
        console.log(`[Enrichment] Bookmark source disabled via AI_ENABLE_BOOKMARK_QUEUE=0.`);
    }

    while (true) {
        let data: QueueResponse | null = null;
        try {
            data = await fetchQueueWithFallback(20, authHeaders);
        } catch (err) {
            console.error(`[Enrichment] Queue fetch error: ${err}`);
            logEvent("api_error", "error", { endpoint: "GET /ai/queue", error: String(err) });
            return;
        }
        if (!data) return;

        if (data.count === 0) {
            console.log(`[Enrichment] Queue empty — nothing to process.`);
            logEvent("enrichment_cycle", "info", {
                items_fetched: 0,
                items_patched: 0,
                total_pending: 0,
                source_breakdown: data.source_breakdown ?? null
            });
            return;
        }

        console.log(`[Enrichment] Processing ${data.count} item(s) — RSS: ${data.source_breakdown?.rss ?? 0}, Bookmarks: ${data.source_breakdown?.bookmarks ?? 0}, Files: ${data.source_breakdown?.file ?? 0} total pending.`);

        const sampleIds = data.items.slice(0, 3).map(item => {
            if (item.source === "file") return `file:${item.file_id}`;
            return `${item.source}:${item.id}`;
        });
        if (sampleIds.length > 0) {
            console.log(`[Enrichment] Batch sample IDs: ${sampleIds.join(", ")}`);
        }

        const results: EnrichmentResult[] = [];
        let staleCount = 0;
        for (const item of data.items) {
            // Skip old RSS items — bookmarks are user-saved and have no expiry
            if (item.source === "rss" && RSS_MAX_AGE_MS > 0) {
                const ageMs = Date.now() - new Date(item.created_at).getTime();
                if (ageMs > RSS_MAX_AGE_MS) {
                    console.log(`[Enrichment] Skipping stale RSS item ${item.id} (${Math.round(ageMs / 86_400_000)}d old): ${item.title}`);
                    logEvent("rss_enrichment", "sentinel", {
                        item_id: item.id,
                        source: item.source,
                        feed_name: item.context?.feed_name,
                        title: item.title,
                        url: item.url,
                        reason: "stale",
                        age_days: Math.round(ageMs / 86_400_000)
                    });
                    results.push({ source: item.source, id: item.id, ai_tags: ["ai:stale"] });
                    staleCount++;
                    continue;
                }
            }
            const result = await processItemWithOllama(item);
            if (result !== null) {
                results.push(result);
            }
        }
        if (staleCount > 0) {
            console.log(`[Enrichment] Marked ${staleCount} stale RSS item(s) as ai:stale.`);
        }

        let patchUpdated = 0;
        if (results.length > 0) {
            const patchResult = await patchResults(results);
            patchUpdated = patchResult.updated;

            // Stop this cycle on failed patch to avoid reprocessing the same queue slice in a tight loop.
            if (!patchResult.ok) {
                return;
            }

            // Guardrail: if the API accepted the request but updated nothing, avoid hammering the same batch.
            if (patchUpdated === 0) {
                console.warn(`[Enrichment] PATCH returned updated=0 for attempted=${results.length}; stopping cycle to avoid repeat loop.`);
                logEvent("api_error", "error", {
                    endpoint: "PATCH /ai/items",
                    attempted: results.length,
                    updated: 0,
                    reason: "no_progress"
                });
                return;
            }
        }

        // Adjust pending count by how many were actually updated by the API.
        const adjustedPending = Math.max(0, (data.total_pending ?? 0) - patchUpdated);
        logEvent("enrichment_cycle", "info", {
            items_fetched: data.count,
            items_attempted: results.length,
            items_patched: patchUpdated,
            total_pending: adjustedPending,
            source_breakdown: data.source_breakdown ?? null
        });

        // If we got a full batch there may be more — drain immediately
        if (data.count < 20) break;
    }
}

// Backward-compat alias — remove once all callers are updated
export const enrichRssQueue = enrichQueue;
