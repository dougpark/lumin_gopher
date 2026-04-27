/**
 * Pinboard Popular Scraper
 * Fetches https://pinboard.in/popular daily, writes a dated JSON file,
 * and ingests items into Lumin via the RSS ingest API.
 *
 * V1: scrape + write JSON
 * V2: POST items to Lumin RSS ingest endpoint
 */

import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { logEvent } from "../db/db";

const DATA_DIR = path.join(import.meta.dir, "..", "..", "data");
const POPULAR_URL = "https://pinboard.in/popular";

const LUMIN_API_URL = process.env.LUMIN_API_URL ?? "";
const LUMIN_RSS_INGEST_TOKEN = process.env.LUMIN_RSS_INGEST_TOKEN ?? "";
const INGEST_BATCH_SIZE = 50;
const INGEST_MAX_RETRIES = 2;

export function todayFilePath(): string {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return path.join(DATA_DIR, `pinboard_popular_${date}.json`);
}

export function todayFileExists(): boolean {
    return existsSync(todayFilePath());
}

interface PopularItem {
    title: string;
    url: string;
    count: number;
    scraped_at: string;
}

function parsePopularItems(html: string, scrapedAt: string): PopularItem[] {
    // Two-pass flat approach — avoids block-matching fragility.
    //
    // Pass 1: collect all bookmark_title <a> tags → title + url
    // Pass 2: collect all bookmark_count <a> tags → count
    // Zip them together (they appear in the same document order).

    const titleTagRe = /<a\b([^>]*\bclass="[^"]*bookmark_title[^"]*"[^>]*)>([^<]+)<\/a>/g;
    const hrefExtractRe = /\bhref="([^"]+)"/;

    const titles: { title: string; url: string }[] = [];
    let m: RegExpExecArray | null;

    while ((m = titleTagRe.exec(html)) !== null) {
        const attrs = m[1];
        const title = m[2].trim();
        const hrefMatch = hrefExtractRe.exec(attrs);
        if (hrefMatch) {
            titles.push({ title, url: hrefMatch[1] });
        }
    }

    const counts: number[] = [];
    const countTagRe = /<a\b[^>]*\bclass="bookmark_count"[^>]*>(\d+)<\/a>/g;
    while ((m = countTagRe.exec(html)) !== null) {
        counts.push(parseInt(m[1], 10));
    }

    const len = Math.min(titles.length, counts.length);
    const items: PopularItem[] = [];
    for (let i = 0; i < len; i++) {
        items.push({
            title: titles[i].title,
            url: titles[i].url,
            count: counts[i],
            scraped_at: scrapedAt,
        });
    }

    return items;
}

export async function fetchPinboardPopular(): Promise<void> {
    const scrapedAt = new Date().toISOString();
    const outPath = todayFilePath();

    console.log(`[Pinboard] Fetching ${POPULAR_URL}`);

    let html: string;
    try {
        const res = await fetch(POPULAR_URL, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (compatible; lumin-gopher/1.0; +https://github.com/dougpark/lumin_gopher)",
            },
            signal: AbortSignal.timeout(15_000),
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }

        html = await res.text();
        console.log(`[Pinboard] Fetched ${html.length} characters`);

    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Pinboard] Fetch failed: ${msg}`);
        await logEvent("system", "error", { event: "pinboard_fetch_failed", error: msg });
        return;
    }

    const items = parsePopularItems(html, scrapedAt);

    if (items.length === 0) {
        console.warn(`[Pinboard] Parsed 0 items — page structure may have changed.`);
        await logEvent("system", "error", {
            event: "pinboard_parse_empty",
            note: "Zero items parsed; check HTML structure",
        });
        return;
    }

    const payload = {
        scraped_at: scrapedAt,
        source: POPULAR_URL,
        count: items.length,
        items,
    };

    writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf-8");
    console.log(`[Pinboard] Wrote ${items.length} items → ${outPath}`);

    await logEvent("system", "success", {
        event: "pinboard_popular_scraped",
        count: items.length,
        file: path.basename(outPath),
    });

    // V2: ingest into Lumin
    if (!LUMIN_RSS_INGEST_TOKEN || !LUMIN_API_URL) {
        console.log(`[Pinboard] Skipping Lumin ingest — LUMIN_RSS_INGEST_TOKEN or LUMIN_API_URL not set.`);
        return;
    }
    await ingestToLumin(items);
}

// ── Lumin RSS Ingest ─────────────────────────────────────────────────────────

interface LuminIngestItem {
    url: string;
    title: string;
    summary?: string;
    published_at: string;
    guid?: string;
}

interface LuminIngestEnvelope {
    source: string;
    scraped_at: string;
    items: LuminIngestItem[];
}

async function postBatch(envelope: LuminIngestEnvelope): Promise<void> {
    const endpoint = `${LUMIN_API_URL}/v1/rss/posts`;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= INGEST_MAX_RETRIES + 1; attempt++) {
        try {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${LUMIN_RSS_INGEST_TOKEN}`,
                },
                body: JSON.stringify(envelope),
                signal: AbortSignal.timeout(15_000),
            });

            if (!res.ok) {
                const body = await res.text().catch(() => "");
                throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
            }

            return; // success
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            if (attempt <= INGEST_MAX_RETRIES) {
                console.warn(`[Pinboard] Ingest batch attempt ${attempt} failed — retrying. ${lastError.message}`);
            }
        }
    }

    throw lastError;
}

async function ingestToLumin(items: PopularItem[]): Promise<void> {
    console.log(`[Pinboard] Ingesting ${items.length} items to Lumin in batches of ${INGEST_BATCH_SIZE}...`);

    const scrapedAt = items[0]?.scraped_at ?? new Date().toISOString();

    const lumItems: LuminIngestItem[] = items.map(item => ({
        url: item.url,
        title: item.title,
        published_at: item.scraped_at,
        guid: item.url,
    }));

    const batches: LuminIngestItem[][] = [];
    for (let i = 0; i < lumItems.length; i += INGEST_BATCH_SIZE) {
        batches.push(lumItems.slice(i, i + INGEST_BATCH_SIZE));
    }

    let totalIngested = 0;
    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const envelope: LuminIngestEnvelope = {
            source: POPULAR_URL,
            scraped_at: scrapedAt,
            items: batch,
        };
        try {
            await postBatch(envelope);
            totalIngested += batch.length;
            console.log(`[Pinboard] Batch ${i + 1}/${batches.length} sent (${batch.length} items).`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[Pinboard] Batch ${i + 1}/${batches.length} failed after ${INGEST_MAX_RETRIES + 1} attempts — abandoning. ${msg}`);
            await logEvent("system", "error", {
                event: "pinboard_ingest_batch_failed",
                batch: i + 1,
                error: msg,
            });
        }
    }

    if (totalIngested > 0) {
        console.log(`[Pinboard] Lumin ingest complete — ${totalIngested}/${items.length} items sent.`);
        await logEvent("system", "success", {
            event: "pinboard_ingest",
            count: totalIngested,
            batches: batches.length,
        });
    }
}

// Allow direct execution: bun run src/workers/pinboard.ts
if (import.meta.main) {
    fetchPinboardPopular()
        .then(() => process.exit(0))
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
}
