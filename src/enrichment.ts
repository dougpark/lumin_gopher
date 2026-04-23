/**
 * AI Enrichment Module
 * Fetches unprocessed RSS items from the remote API, enriches each with
 * Ollama-generated tags and a summary, and patches results back in one batch.
 * Includes a per-item failure counter: after 3 failures the item is patched with
 * ai_tags: ["ai:error"] so it is removed from future queues permanently.
 */

const LUMIN_API_URL = process.env.LUMIN_API_URL ?? "https://d11.me/api";
const LUMIN_API_TOKEN = process.env.LUMIN_API_TOKEN ?? "";
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://host.docker.internal:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e4b";

const FAIL_THRESHOLD = 3;
const failCounts = new Map<number, number>();

interface QueueItem {
    id: number;
    url: string;
    title: string;
    summary: string;
    tag_list: string;
    published_at: string;
    feed_name: string;
}

interface EnrichmentResult {
    id: number;
    ai_tags?: string[];
    ai_summary?: string;
}

async function processItemWithOllama(item: QueueItem): Promise<EnrichmentResult | null> {
    const prompt =
        `You are an RSS feed archivist. Given the article title and description below, ` +
        `generate exactly 5 relevant lowercase tags and a clean 2-sentence summary. ` +
        `Respond ONLY with valid JSON using this exact structure: ` +
        `{"ai_tags": ["tag1", "tag2", "tag3", "tag4", "tag5"], "ai_summary": "First sentence. Second sentence."}\n\n` +
        `Title: ${item.title}\n` +
        `Description: ${item.summary || "(none)"}`;

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
        failCounts.delete(item.id);

        return { id: item.id, ai_tags, ai_summary };

    } catch (err) {
        const fails = (failCounts.get(item.id) ?? 0) + 1;
        failCounts.set(item.id, fails);
        console.warn(`[Enrichment] Item ${item.id} failed (attempt ${fails}/${FAIL_THRESHOLD}): ${err}`);

        if (fails >= FAIL_THRESHOLD) {
            failCounts.delete(item.id);
            console.warn(`[Enrichment] Item ${item.id} hit fail threshold — marking as ai:error`);
            // Return sentinel so item is stamped and removed from future queues
            return { id: item.id, ai_tags: ["ai:error"] };
        }

        return null;
    }
}

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
        return;
    }

    const { updated } = await res.json() as { updated: number };
    console.log(`[Enrichment] Updated ${updated} item(s).`);
}

export async function enrichRssQueue(): Promise<void> {
    const authHeaders = { "Authorization": `Bearer ${LUMIN_API_TOKEN}` };

    while (true) {
        let data: { items: QueueItem[]; count: number };

        try {
            const res = await fetch(`${LUMIN_API_URL}/ai/queue?limit=20`, {
                headers: authHeaders
            });

            if (!res.ok) {
                console.error(`[Enrichment] Queue fetch failed: HTTP ${res.status}`);
                return;
            }

            data = await res.json() as { items: QueueItem[]; count: number };
        } catch (err) {
            console.error(`[Enrichment] Queue fetch error: ${err}`);
            return;
        }

        if (data.count === 0) {
            console.log(`[Enrichment] Queue empty — nothing to process.`);
            return;
        }

        console.log(`[Enrichment] Processing ${data.count} item(s)...`);

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

        // If we got a full batch there may be more — drain immediately
        if (data.count < 20) break;
    }
}
