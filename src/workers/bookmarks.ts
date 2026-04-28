/**
 * Lumin Bookmark Ingest — shared module
 * Source-agnostic batch ingest to POST /v1/posts/batch.
 * Used by any worker that wants to save bookmarks to Lumin.
 *
 * Auth: LUMIN_BOOKMARK_TOKEN (per-user Bearer token)
 * Dedup: handled by Lumin — 409/skipped_duplicates, no local tracking needed.
 */

import { logEvent } from "../db/db";

const LUMIN_API_URL = process.env.LUMIN_API_URL ?? "";
const LUMIN_BOOKMARK_TOKEN = process.env.LUMIN_BOOKMARK_TOKEN ?? "";
const BATCH_SIZE = 50;
const MAX_RETRIES = 2;

// ── Types ────────────────────────────────────────────────────────────────────

export interface BookmarkItem {
    url: string;
    title: string;
    short_description?: string;
    tag_list?: string[];
    is_public?: boolean;
}

interface BatchResponse {
    inserted: number;
    skipped_duplicates: number;
    invalid: { index: number; reason: string }[];
}

// ── Core ─────────────────────────────────────────────────────────────────────

async function postBatch(items: BookmarkItem[]): Promise<BatchResponse> {
    const endpoint = `${LUMIN_API_URL}/v1/posts/batch`;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
        try {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${LUMIN_BOOKMARK_TOKEN}`,
                },
                body: JSON.stringify({ items }),
                signal: AbortSignal.timeout(15_000),
            });

            // 409 = all items already exist — not an error, just duplicates
            if (res.status === 409) {
                return { inserted: 0, skipped_duplicates: items.length, invalid: [] };
            }

            // Other 4xx = bad payload, not retryable
            if (res.status >= 400 && res.status < 500) {
                const body = await res.text().catch(() => "");
                throw Object.assign(new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`), { retryable: false });
            }

            if (!res.ok) {
                throw Object.assign(new Error(`HTTP ${res.status}`), { retryable: true });
            }

            return await res.json() as BatchResponse;

        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            const retryable = (err as { retryable?: boolean }).retryable !== false;

            if (!retryable || attempt > MAX_RETRIES) {
                throw error;
            }
            lastError = error;
            console.warn(`[Bookmarks] Batch attempt ${attempt} failed — retrying. ${error.message}`);
        }
    }

    throw lastError;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function ingestBookmarks(items: BookmarkItem[], source: string): Promise<void> {
    if (!LUMIN_BOOKMARK_TOKEN || !LUMIN_API_URL) {
        console.log(`[Bookmarks] Skipping — LUMIN_BOOKMARK_TOKEN or LUMIN_API_URL not set.`);
        return;
    }

    console.log(`[Bookmarks:${source}] Ingesting ${items.length} items in batches of ${BATCH_SIZE}...`);

    const batches: BookmarkItem[][] = [];
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
        batches.push(items.slice(i, i + BATCH_SIZE));
    }

    let totalInserted = 0;
    let totalSkipped = 0;

    for (let i = 0; i < batches.length; i++) {
        try {
            const result = await postBatch(batches[i]);
            totalInserted += result.inserted;
            totalSkipped += result.skipped_duplicates;

            const invalidCount = result.invalid?.length ?? 0;
            console.log(
                `[Bookmarks:${source}] Batch ${i + 1}/${batches.length}: ` +
                `inserted=${result.inserted} skipped=${result.skipped_duplicates}` +
                (invalidCount > 0 ? ` invalid=${invalidCount}` : "")
            );

            if (result.invalid?.length) {
                for (const inv of result.invalid) {
                    console.warn(`[Bookmarks:${source}] Invalid item[${inv.index}]: ${inv.reason}`);
                }
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[Bookmarks:${source}] Batch ${i + 1}/${batches.length} failed — abandoning. ${msg}`);
            await logEvent("system", "error", {
                event: "bookmark_ingest_batch_failed",
                source,
                batch: i + 1,
                error: msg,
            });
        }
    }

    if (totalInserted > 0 || totalSkipped > 0) {
        console.log(`[Bookmarks:${source}] Done — inserted=${totalInserted} skipped=${totalSkipped}`);
        await logEvent("system", "success", {
            event: "bookmark_ingest",
            source,
            inserted: totalInserted,
            skipped: totalSkipped,
            batches: batches.length,
        });
    }
}
