/**
 * Pinboard Popular Scraper
 * Fetches https://pinboard.in/popular daily and writes a dated JSON file
 * to data/pinboard_popular_YYYY-MM-DD.json.
 *
 * V1: scrape + write only. No enrichment, no Lumin feed.
 */

import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { logEvent } from "../db/db";

const DATA_DIR = path.join(import.meta.dir, "..", "..", "data");
const POPULAR_URL = "https://pinboard.in/popular";

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
