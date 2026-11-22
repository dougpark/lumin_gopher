import { afterEach, describe, expect, test } from "bun:test";
import { runWithWolfStatus } from "./wolfStatus";

const originalFetch = globalThis.fetch;
const originalUrl = process.env.WOLF_URL;
const originalToken = process.env.WOLF_STATUS_TOKEN;
const originalJobId = process.env.WOLF_JOB_ID;

interface ReportedEvent {
    eventId: string;
    runId: string;
    sequence: number;
    type: string;
    occurredAt: string;
    outcome?: string;
    metrics?: Record<string, { value: number; unit: string }>;
}

function setFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
    globalThis.fetch = Object.assign(handler, { preconnect: originalFetch.preconnect });
}

afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({
        WOLF_URL: originalUrl, WOLF_STATUS_TOKEN: originalToken, WOLF_JOB_ID: originalJobId
    })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

describe("Wolfdrive run reporting", () => {
    test("sends a start and completion with counts and matching run identity", async () => {
        process.env.WOLF_URL = "http://wolfdrive.test/";
        process.env.WOLF_STATUS_TOKEN = "test-token";
        process.env.WOLF_JOB_ID = "gopher-enrichment";
        const reports: { url: string; authorization: string | null; event: ReportedEvent }[] = [];
        setFetch(async (input, init) => {
            reports.push({
                url: String(input),
                authorization: new Headers(init?.headers).get("Authorization"),
                event: JSON.parse(String(init?.body))
            });
            return new Response("{}", { status: 201 });
        });

        await runWithWolfStatus(async summary => {
            summary.bookmarks = 3;
            summary.newsItems = 7;
        });

        expect(reports).toHaveLength(2);
        expect(reports[0]!.url).toBe("http://wolfdrive.test/api/status/v1/jobs/gopher-enrichment/events");
        expect(reports[0]!.authorization).toBe("Bearer test-token");
        const start = reports[0]!.event;
        const finish = reports[1]!.event;
        expect(start).toMatchObject({ type: "started", sequence: 0 });
        expect(finish).toMatchObject({
            type: "completed", sequence: 1, runId: start.runId, outcome: "succeeded",
            metrics: { bookmarks: { value: 3, unit: "items" }, newsItems: { value: 7, unit: "items" } }
        });
        expect(start.eventId).not.toBe(finish.eventId);
        expect(Date.parse(finish.occurredAt)).toBeGreaterThanOrEqual(Date.parse(start.occurredAt));
    });

    test("reports failure with partial counts when work throws", async () => {
        process.env.WOLF_URL = "http://wolfdrive.test";
        process.env.WOLF_STATUS_TOKEN = "test-token";
        process.env.WOLF_JOB_ID = "gopher";
        const events: ReportedEvent[] = [];
        setFetch(async (_input, init) => {
            events.push(JSON.parse(String(init?.body)));
            return new Response("{}", { status: 201 });
        });
        await expect(runWithWolfStatus(async summary => {
            summary.bookmarks = 2;
            throw new Error("worker failed");
        })).rejects.toThrow("worker failed");
        expect(events[1]).toMatchObject({ outcome: "failed", metrics: { bookmarks: { value: 2 } } });
    });

    test("reporting failure does not prevent work or the completion attempt", async () => {
        process.env.WOLF_URL = "http://wolfdrive.test";
        process.env.WOLF_STATUS_TOKEN = "test-token";
        process.env.WOLF_JOB_ID = "gopher";
        let attempts = 0;
        setFetch(async () => {
            attempts++;
            throw new Error("offline");
        });
        const result = await runWithWolfStatus(async summary => { summary.newsItems = 1; });
        expect(result.newsItems).toBe(1);
        expect(attempts).toBe(2);
    });

    test("reports an explicitly failed worker result", async () => {
        process.env.WOLF_URL = "http://wolfdrive.test";
        process.env.WOLF_STATUS_TOKEN = "test-token";
        process.env.WOLF_JOB_ID = "gopher";
        const events: ReportedEvent[] = [];
        setFetch(async (_input, init) => {
            events.push(JSON.parse(String(init?.body)));
            return new Response("{}", { status: 201 });
        });
        await runWithWolfStatus(async summary => { summary.failed = true; });
        expect(events[1]?.outcome).toBe("failed");
    });
});
