/**
 * Feedbin Starred Entries Worker
 * Fetches the user's starred entries from Feedbin and writes a dated JSON file
 * to data/feedbin_starred_YYYY-MM-DD.json.
 *
 * V1: fetch + write JSON only.
 * V2: ingest into Lumin bookmark API (waiting on Lumin).
 *
 * Auth: HTTP Basic (FEEDBIN_USER / FEEDBIN_PASSWORD)
 * API docs: https://github.com/feedbin/feedbin-api
 */

import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { logEvent } from "../db/db";

const DATA_DIR = path.join(import.meta.dir, "..", "..", "data");
const FEEDBIN_API = "https://api.feedbin.com/v2";
const ENTRY_BATCH_SIZE = 100; // Feedbin max per request

const FEEDBIN_USER = process.env.FEEDBIN_USER ?? "";
const FEEDBIN_PASSWORD = process.env.FEEDBIN_PASSWORD ?? "";

// ── Helpers ──────────────────────────────────────────────────────────────────

function basicAuthHeader(): string {
    return "Basic " + Buffer.from(`${FEEDBIN_USER}:${FEEDBIN_PASSWORD}`).toString("base64");
}

export function todayFeedbinFilePath(): string {
    const date = new Date().toISOString().slice(0, 10);
    return path.join(DATA_DIR, `feedbin_starred_${date}.json`);
}

export function todayFeedbinFileExists(): boolean {
    return existsSync(todayFeedbinFilePath());
}

// ── Types ────────────────────────────────────────────────────────────────────

interface FeedbinEntry {
    id: number;
    feed_id: number;
    title: string | null;
    url: string;
    author: string | null;
    summary: string | null;
    published: string;
    created_at: string;
}

// ── API calls ────────────────────────────────────────────────────────────────

async function getStarredIds(): Promise<number[]> {
    const res = await fetch(`${FEEDBIN_API}/starred_entries.json`, {
        headers: {
            Authorization: basicAuthHeader(),
            "Content-Type": "application/json; charset=utf-8",
        },
        signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 401) throw new Error("Feedbin auth failed — check FEEDBIN_USER and FEEDBIN_PASSWORD");
    if (!res.ok) throw new Error(`Feedbin starred IDs: HTTP ${res.status}`);

    return res.json() as Promise<number[]>;
}

async function getEntries(ids: number[]): Promise<FeedbinEntry[]> {
    const idParam = ids.join(",");
    const res = await fetch(`${FEEDBIN_API}/entries.json?ids=${idParam}`, {
        headers: {
            Authorization: basicAuthHeader(),
            "Content-Type": "application/json; charset=utf-8",
        },
        signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) throw new Error(`Feedbin entries batch: HTTP ${res.status}`);

    return res.json() as Promise<FeedbinEntry[]>;
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function fetchFeedbinStarred(): Promise<void> {
    if (!FEEDBIN_USER || !FEEDBIN_PASSWORD) {
        console.log(`[Feedbin] Skipping — FEEDBIN_USER or FEEDBIN_PASSWORD not set.`);
        return;
    }

    const fetchedAt = new Date().toISOString();
    const outPath = todayFeedbinFilePath();

    console.log(`[Feedbin] Fetching starred entry IDs...`);

    let starredIds: number[];
    try {
        starredIds = await getStarredIds();
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Feedbin] Failed to fetch starred IDs: ${msg}`);
        await logEvent("system", "error", { event: "feedbin_starred_ids_failed", error: msg });
        return;
    }

    console.log(`[Feedbin] ${starredIds.length} starred entries found. Fetching details...`);

    // Chunk into batches of 100 (Feedbin limit)
    const batches: number[][] = [];
    for (let i = 0; i < starredIds.length; i += ENTRY_BATCH_SIZE) {
        batches.push(starredIds.slice(i, i + ENTRY_BATCH_SIZE));
    }

    const allEntries: FeedbinEntry[] = [];
    for (let i = 0; i < batches.length; i++) {
        try {
            const entries = await getEntries(batches[i]);
            allEntries.push(...entries);
            console.log(`[Feedbin] Batch ${i + 1}/${batches.length}: fetched ${entries.length} entries.`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[Feedbin] Batch ${i + 1}/${batches.length} failed: ${msg}`);
            await logEvent("system", "error", { event: "feedbin_entries_batch_failed", batch: i + 1, error: msg });
            // Continue — partial results are still useful
        }
    }

    if (allEntries.length === 0) {
        console.warn(`[Feedbin] No entries retrieved.`);
        await logEvent("system", "error", { event: "feedbin_no_entries", starred_count: starredIds.length });
        return;
    }

    // Sort newest first by published date
    allEntries.sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime());

    const payload = {
        fetched_at: fetchedAt,
        source: "feedbin-starred",
        count: allEntries.length,
        items: allEntries.map(e => ({
            id: e.id,
            feed_id: e.feed_id,
            title: e.title,
            url: e.url,
            author: e.author,
            summary: e.summary,
            published: e.published,
            created_at: e.created_at,
        })),
    };

    writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf-8");
    console.log(`[Feedbin] Wrote ${allEntries.length} starred entries → ${outPath}`);

    await logEvent("system", "success", {
        event: "feedbin_starred_fetched",
        count: allEntries.length,
        file: path.basename(outPath),
    });
}

// Allow direct execution: bun run src/workers/feedbin.ts
if (import.meta.main) {
    fetchFeedbinStarred()
        .then(() => process.exit(0))
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
}
