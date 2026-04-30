/**
 * Full Text Fetch Worker
 * Drains the Lumin full-text queue by fetching page content via Jina Reader
 * and writing results back to Lumin.
 *
 * V1: fetch + write full text only.
 * V2: AI synthesis (separate pipeline, separate token).
 *
 * Flow per cycle:
 *   loop:
 *     GET  {LUMIN_API_URL}/ft/queue?limit=10  → items needing full text
 *     if count === 0 → done
 *     fetch each URL via Jina in parallel (Promise.allSettled)
 *     PATCH {LUMIN_API_URL}/ft/items          → write results back
 *     wait 2s → repeat
 */

import { logEvent } from "../db/db";

const LUMIN_API_URL = process.env.LUMIN_API_URL ?? "https://d11.me/api";
const LUMIN_FULL_TEXT_TOKEN = process.env.LUMIN_FULL_TEXT_TOKEN ?? "";
const JINA_API_KEY = process.env.JINA_API_KEY ?? "";
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 2_000;

// ── Types ────────────────────────────────────────────────────────────────────

interface QueueItem {
    id: number;
    url: string;
    title: string | null;
}

interface QueueResponse {
    count: number;
    total_pending: number;
    items: QueueItem[];
}

interface FtResult {
    id: number;
    full_text?: string;
    status: "completed" | "fetch_failed";
}

interface PatchResponse {
    updated: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function luminHeaders() {
    return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LUMIN_FULL_TEXT_TOKEN}`,
    };
}

async function fetchQueue(): Promise<QueueResponse> {
    const res = await fetch(`${LUMIN_API_URL}/ft/queue?limit=${BATCH_SIZE}`, {
        headers: luminHeaders(),
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Queue fetch HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json() as Promise<QueueResponse>;
}

async function fetchJina(item: QueueItem): Promise<FtResult> {
    const jinaUrl = `https://r.jina.ai/${item.url}`;
    try {
        const res = await fetch(jinaUrl, {
            headers: {
                "X-Return-Format": "text",
                "Authorization": `Bearer ${JINA_API_KEY}`,
            },
            signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`Jina HTTP ${res.status}`);
        const full_text = await res.text();
        console.log(`  ✓ [${item.id}] "${item.title ?? item.url}" (${full_text.length} chars)`);
        return { id: item.id, full_text, status: "completed" };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  ✕ [${item.id}] "${item.title ?? item.url}": ${msg}`);
        return { id: item.id, status: "fetch_failed" };
    }
}

async function patchResults(results: FtResult[]): Promise<PatchResponse> {
    const res = await fetch(`${LUMIN_API_URL}/ft/items`, {
        method: "PATCH",
        headers: luminHeaders(),
        body: JSON.stringify(results),
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Patch HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json() as Promise<PatchResponse>;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function runFullTextFetch(): Promise<void> {
    if (!LUMIN_FULL_TEXT_TOKEN) {
        console.log(`[FullText] Skipping — LUMIN_FULL_TEXT_TOKEN not set.`);
        return;
    }
    if (!JINA_API_KEY) {
        console.log(`[FullText] Skipping — JINA_API_KEY not set.`);
        return;
    }

    const cycleStart = Date.now();
    let totalProcessed = 0;
    let totalCompleted = 0;
    let totalFailed = 0;
    let batchNum = 0;

    console.log(`[FullText] Starting full-text fetch cycle...`);

    while (true) {
        // 1. Pull next batch from queue
        let queue: QueueResponse;
        try {
            queue = await fetchQueue();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[FullText] Queue fetch failed — aborting cycle. ${msg}`);
            logEvent("full_text", "error", { event: "fulltext_queue_failed", error: msg });
            return;
        }

        if (queue.count === 0) {
            console.log(`[FullText] Queue empty — cycle complete.`);
            break;
        }

        batchNum++;
        console.log(`[FullText] Batch ${batchNum}: ${queue.count} items (${queue.total_pending} total pending)`);

        // 2. Fetch full text for each item in parallel
        const settled = await Promise.allSettled(queue.items.map(fetchJina));
        const results: FtResult[] = settled
            .filter((r): r is PromiseFulfilledResult<FtResult> => r.status === "fulfilled")
            .map(r => r.value);

        const completed = results.filter(r => r.status === "completed").length;
        const failed = results.filter(r => r.status === "fetch_failed").length;

        // 3. Write results back to Lumin
        if (results.length > 0) {
            try {
                const patched = await patchResults(results);
                console.log(`[FullText] Batch ${batchNum}: wrote ${patched.updated} results back.`);
                logEvent("full_text", "success", {
                    event: "fulltext_batch",
                    batch: batchNum,
                    completed,
                    failed,
                    updated: patched.updated,
                    total_pending: queue.total_pending,
                });
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[FullText] Batch ${batchNum} patch failed: ${msg}`);
                logEvent("full_text", "error", { event: "fulltext_patch_failed", batch: batchNum, error: msg });
                // Don't abort — try next batch
            }
        }

        totalProcessed += results.length;
        totalCompleted += completed;
        totalFailed += failed;

        // 4. Wait before next batch
        await sleep(BATCH_DELAY_MS);
    }

    if (totalProcessed > 0) {
        const elapsedSecs = ((Date.now() - cycleStart) / 1000).toFixed(1);
        console.log(
            `[FullText] Cycle done in ${elapsedSecs}s — ` +
            `processed=${totalProcessed} completed=${totalCompleted} failed=${totalFailed}`
        );
        logEvent("full_text", "success", {
            event: "fulltext_cycle_complete",
            processed: totalProcessed,
            completed: totalCompleted,
            failed: totalFailed,
            elapsed_secs: parseFloat(elapsedSecs),
        });
    } else {
        console.log(`[FullText] Nothing to process.`);
    }
}

// Allow direct execution: bun run src/workers/fulltext.ts
if (import.meta.main) {
    runFullTextFetch()
        .then(() => process.exit(0))
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
}
