/**
 * LUMIN GOPHER - Core Service v1.0
 * The quiet worker bridging the home lab to the master index.
 */

import Bun from "bun";
import { watch } from "node:fs"; // Bun supports the standard FS watch API
import path from "node:path";
import { enrichQueue } from "./workers/enrichment";
import { tagFileWithOllama } from "./workers/tagger";
import { logEvent, querySummary, queryTimeseries, queryRecentErrors, queryEventsByRange, queryQueueStatus } from "./db/db";
import { logSystemMetrics, collectSnapshot } from "./workers/sysmetrics";

/**
 * LUMIN GOPHER - Folder Watcher Feature
 */

// This points to the directory where index.ts lives (e.g., /app/src)
const PROJECT_ROOT = path.join(import.meta.dir, "..");
const INBOX_PATH = process.env.INBOX_PATH ?? path.join(PROJECT_ROOT, "inbox");
const ARCHIVE_PATH = process.env.ARCHIVE_PATH ?? path.join(PROJECT_ROOT, "archive");
const PORT = parseInt(process.env.PORT ?? "3030", 10);
const LOCAL_HOST = process.env.LOCAL_HOST ?? "http://localhost";
console.log(`[System] Gopher is watching: ${INBOX_PATH}`);

// Ensure the directory exists  so the watcher doesn't crash on startup
import { mkdirSync, existsSync } from "node:fs";
if (!existsSync(INBOX_PATH)) {
    mkdirSync(INBOX_PATH, { recursive: true });
    console.log(`[System] Created inbox directory: ${INBOX_PATH}`);
}
if (!existsSync(ARCHIVE_PATH)) {
    mkdirSync(ARCHIVE_PATH, { recursive: true });
    console.log(`[System] Created archive directory: ${ARCHIVE_PATH}`);
}

/**
 * THE WATCHER
 * This uses the kernel's inotify (on Linux) to listen for changes.
 */
watch(INBOX_PATH, { recursive: true }, (event, filename) => {
    if (filename) {
        const timestamp = new Date().toLocaleTimeString();

        // 'rename' usually covers both new files and deletions
        // 'change' covers edits to existing files
        console.log(`[${timestamp}] 📂 File System Event: ${event.toUpperCase()}`);
        console.log(`[${timestamp}] 📄 File: ${INBOX_PATH}/${filename}`);

        if (event === "rename") {
            console.log(`[${timestamp}] ⚡ Gopher Alert: A new artifact has been discovered or moved!`);
            tagFileWithOllama(INBOX_PATH, filename);
        }
    }
});

console.log(`[System] Gopher is now eyes-on: ${INBOX_PATH}`);



// 1. Start the Management UI (The "Web Server")
const DASHBOARD_PATH = path.join(import.meta.dir, "client", "dashboard.html");

const server = Bun.serve({
    port: PORT,
    hostname: "0.0.0.0", // <--- CRITICAL for Docker mapping
    async fetch(req) {
        const url = new URL(req.url);

        // Health endpoint (used by Docker healthcheck)
        if (url.pathname === "/stats") {
            return Response.json({
                status: "online",
                agent: "Lumin Gopher",
                location: "Fort Worth Linux Box",
                uptime: `${Math.floor(process.uptime())}s`,
                nerd_radar_active: true
            });
        }

        // Metrics: summary counts
        if (url.pathname === "/api/metrics/summary") {
            const summary = querySummary();
            const queue = queryQueueStatus();
            return Response.json({ ...summary, ...queue, uptime_seconds: Math.floor(process.uptime()) });
        }

        // Metrics: timeseries (1-hour buckets)
        if (url.pathname === "/api/metrics/timeseries") {
            const hours = Math.min(parseInt(url.searchParams.get("hours") ?? "48", 10), 168);
            const type = url.searchParams.get("type") ?? undefined;
            const status = url.searchParams.get("status") ?? undefined;
            const sinceMs = Date.now() - hours * 60 * 60 * 1000;
            return Response.json(queryTimeseries(sinceMs, type, status));
        }

        // Metrics: recent errors
        if (url.pathname === "/api/metrics/recent-errors") {
            const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 100);
            const rows = queryRecentErrors(limit).map(r => ({
                ...r,
                details: r.details ? JSON.parse(r.details) : null
            }));
            return Response.json(rows);
        }

        // Metrics: events for a specific hour (drill-down)
        if (url.pathname === "/api/metrics/events") {
            const from = parseInt(url.searchParams.get("from") ?? "0", 10);
            const to = parseInt(url.searchParams.get("to") ?? "0", 10);
            if (!from || !to || to <= from) return Response.json({ error: "Invalid range" }, { status: 400 });
            const type = url.searchParams.get("type") ?? undefined;
            const status = url.searchParams.get("status") ?? undefined;
            const rows = queryEventsByRange(from, to, type, status).map(r => ({
                ...r,
                details: r.details ? JSON.parse(r.details) : null
            }));
            return Response.json(rows);
        }

        // Metrics: latest system snapshot (live collection every request)
        if (url.pathname === "/api/metrics/system") {
            const snap = await collectSnapshot();
            return Response.json(snap);
        }

        // Main Dashboard
        if (url.pathname === "/") {
            return new Response(Bun.file(DASHBOARD_PATH), {
                headers: { "Content-Type": "text/html" }
            });
        }

        return new Response("Not found", { status: 404 });
    },
});

console.log(`🚀 Gopher Dashboard online at ${LOCAL_HOST}:${PORT}`);

// 2. The "Nerd Radar" Timer (The "Chrono-Task")
// Runs every 30 minutes (1,800,000 ms)
const FORAGE_INTERVAL = 30 * 60 * 1000;
const SYSMETRICS_INTERVAL = 5 * 60 * 1000;

setInterval(() => {
    logSystemMetrics().catch(err => console.error(`[SysMetrics] ${err}`));
}, SYSMETRICS_INTERVAL);

setInterval(async () => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] 🔍 Gopher is heading out to enrich queue...`);
    await enrichQueue();
    console.log(`[${timestamp}] ✅ Enrichment cycle complete.`);
}, FORAGE_INTERVAL);

// Run enrichment immediately on startup to drain any backlog
enrichQueue().catch(err => console.error(`[Enrichment] Startup run failed: ${err}`));
logSystemMetrics().catch(err => console.error(`[SysMetrics] Startup run failed: ${err}`));
logEvent("system", "info", { event: "startup", model: process.env.OLLAMA_MODEL ?? "gemma4:e4b" });

console.log("--------------------------------------------------");
console.log("Hello! The Gopher is now watching the lab.");
console.log("--------------------------------------------------");