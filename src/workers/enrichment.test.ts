import { afterEach, expect, mock, test } from "bun:test";

mock.module("../db/db", () => ({ logEvent: () => {} }));
mock.module("./sysmetrics", () => ({ collectGpu: () => null, collectStationPower: async () => null }));

const originalMaxAge = process.env.RSS_MAX_AGE_DAYS;
const originalBookmarkQueue = process.env.AI_ENABLE_BOOKMARK_QUEUE;
process.env.RSS_MAX_AGE_DAYS = "7";
process.env.AI_ENABLE_BOOKMARK_QUEUE = "1";
const { enrichQueue } = await import("./enrichment");
if (originalMaxAge === undefined) delete process.env.RSS_MAX_AGE_DAYS;
else process.env.RSS_MAX_AGE_DAYS = originalMaxAge;
if (originalBookmarkQueue === undefined) delete process.env.AI_ENABLE_BOOKMARK_QUEUE;
else process.env.AI_ENABLE_BOOKMARK_QUEUE = originalBookmarkQueue;
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function setFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
    globalThis.fetch = Object.assign(handler, { preconnect: originalFetch.preconnect });
}

function item(source: "rss" | "bookmark", id: number, createdAt = new Date().toISOString()) {
    return { source, id, url: "https://example.test", title: "Test", body: "Description", tags: [], created_at: createdAt, context: {} };
}

function queue(items: ReturnType<typeof item>[]) {
    return { items, count: items.length, total_pending: items.length, source_breakdown: { rss: 0, bookmarks: 0, file: 0 } };
}

test("counts successful news and bookmark inference across batches, excluding stale and failed items", async () => {
    const old = "2000-01-01T00:00:00Z";
    const batches = [
        queue([item("bookmark", 1), item("rss", 2), ...Array.from({ length: 18 }, (_, i) => item("rss", i + 10, old))]),
        queue([item("bookmark", 3)])
    ];
    let inference = 0;
    setFetch(async (input, init) => {
        const url = String(input);
        if (url.includes("/ai/queue")) return Response.json(batches.shift());
        if (url.includes("/api/generate")) {
            inference++;
            if (inference === 3) return new Response("unavailable", { status: 503 });
            return Response.json({ response: JSON.stringify({ ai_tags: ["tag"], ai_summary: "summary" }) });
        }
        if (url.includes("/ai/items")) return Response.json({ updated: JSON.parse(String(init?.body)).length });
        throw new Error(`Unexpected request: ${url}`);
    });

    expect(await enrichQueue()).toEqual({ bookmarks: 1, newsItems: 1, failed: true });
    expect(inference).toBe(3);
    expect(batches).toHaveLength(0);
});

test("retains inference counts when write-back fails", async () => {
    setFetch(async input => {
        const url = String(input);
        if (url.includes("/ai/queue")) return Response.json(queue([item("bookmark", 100)]));
        if (url.includes("/api/generate")) return Response.json({ response: JSON.stringify({ ai_tags: ["tag"] }) });
        if (url.includes("/ai/items")) return new Response("failure", { status: 500 });
        throw new Error(`Unexpected request: ${url}`);
    });
    expect(await enrichQueue()).toEqual({ bookmarks: 1, newsItems: 0, failed: true });
});

test("an empty queue is a successful run", async () => {
    setFetch(async () => Response.json(queue([])));
    expect(await enrichQueue()).toEqual({ bookmarks: 0, newsItems: 0, failed: false });
});

test("a partial queue fallback is reported as failed", async () => {
    setFetch(async input => {
        const source = new URL(String(input)).searchParams.get("source");
        if (source === "all" || source === "rss") return new Response("unavailable", { status: 503 });
        return Response.json(queue([]));
    });
    expect(await enrichQueue()).toEqual({ bookmarks: 0, newsItems: 0, failed: true });
});

test("an inference error sentinel is not counted as a successful result", async () => {
    let patched: unknown = null;
    setFetch(async (input, init) => {
        const url = String(input);
        if (url.includes("/ai/queue")) return Response.json(queue([item("bookmark", 200)]));
        if (url.includes("/api/generate")) return new Response("unavailable", { status: 503 });
        if (url.includes("/ai/items")) {
            patched = JSON.parse(String(init?.body));
            return Response.json({ updated: 1 });
        }
        throw new Error(`Unexpected request: ${url}`);
    });
    for (let attempt = 0; attempt < 3; attempt++) {
        expect(await enrichQueue()).toEqual({ bookmarks: 0, newsItems: 0, failed: true });
    }
    expect(patched).toEqual([{ source: "bookmark", id: 200, ai_tags: ["ai:error"] }]);
});
