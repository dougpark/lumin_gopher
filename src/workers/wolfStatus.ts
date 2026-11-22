import type { EnrichmentSummary } from "./enrichment";

type StatusEvent = {
    eventId: string;
    runId: string;
    sequence: number;
    type: "started" | "completed";
    occurredAt: string;
    source: string;
    outcome?: "succeeded" | "failed";
    metrics?: Record<string, { value: number; unit: string }>;
};

async function sendEvent(url: string, token: string, event: StatusEvent): Promise<void> {
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(event),
            signal: AbortSignal.timeout(3000)
        });
        if (!response.ok) {
            console.error(`[WolfStatus] ${event.type} report failed: HTTP ${response.status}`);
        }
    } catch (error) {
        console.error(`[WolfStatus] ${event.type} report failed: ${error instanceof Error ? error.name : "request error"}`);
    }
}

export async function runWithWolfStatus(
    work: (summary: EnrichmentSummary) => Promise<unknown>
): Promise<EnrichmentSummary> {
    const summary: EnrichmentSummary = { bookmarks: 0, newsItems: 0, failed: false };
    const baseUrl = process.env.WOLF_URL?.trim();
    const token = process.env.WOLF_STATUS_TOKEN?.trim();
    const jobId = process.env.WOLF_JOB_ID?.trim();
    const url = baseUrl && token && jobId
        ? `${baseUrl.replace(/\/+$/, "")}/api/status/v1/jobs/${encodeURIComponent(jobId)}/events`
        : null;
    const runId = crypto.randomUUID();
    const started: StatusEvent = {
        eventId: crypto.randomUUID(), runId, sequence: 0, type: "started",
        occurredAt: new Date().toISOString(), source: "lumin-gopher"
    };

    if (url && token) {
        await sendEvent(url, token, started);
    } else {
        console.warn("[WolfStatus] Reporting disabled: WOLF_URL, WOLF_STATUS_TOKEN, and WOLF_JOB_ID are required.");
    }

    try {
        await work(summary);
    } catch (error) {
        summary.failed = true;
        throw error;
    } finally {
        const completed: StatusEvent = {
            eventId: crypto.randomUUID(), runId, sequence: 1, type: "completed",
            occurredAt: new Date().toISOString(), source: "lumin-gopher",
            outcome: summary.failed ? "failed" : "succeeded",
            metrics: {
                bookmarks: { value: summary.bookmarks, unit: "items" },
                newsItems: { value: summary.newsItems, unit: "items" }
            }
        };
        if (url && token) await sendEvent(url, token, completed);
    }
    return summary;
}
