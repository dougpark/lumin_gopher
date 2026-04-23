/**
 * LUMIN GOPHER - Core Service v1.0
 * The quiet worker bridging the home lab to the master index.
 */

import Bun from "bun";
import { watch } from "node:fs"; // Bun supports the standard FS watch API
import path from "node:path";
import { enrichRssQueue } from "./enrichment";
import { tagFileWithOllama } from "./tagger";
import { logEvent, querySummary, queryTimeseries, queryRecentErrors } from "./db";

/**
 * LUMIN GOPHER - Folder Watcher Feature
 */

// This points to the directory where index.ts lives (e.g., /app/src)
const PROJECT_ROOT = path.join(import.meta.dir, "..");
const WATCH_PATH = path.join(PROJECT_ROOT, "watch_folder"); // <-- This is the folder Gopher will monitor
console.log(`[System] Gopher is watching: ${WATCH_PATH}`);

// Ensure the directory exists so the watcher doesn't crash on startup
import { mkdirSync, existsSync } from "node:fs";
if (!existsSync(WATCH_PATH)) {
    mkdirSync(WATCH_PATH);
    console.log(`[System] Created watcher directory: ${WATCH_PATH}`);
}

/**
 * THE WATCHER
 * This uses the kernel's inotify (on Linux) to listen for changes.
 */
watch(WATCH_PATH, { recursive: true }, (event, filename) => {
    if (filename) {
        const timestamp = new Date().toLocaleTimeString();

        // 'rename' usually covers both new files and deletions
        // 'change' covers edits to existing files
        console.log(`[${timestamp}] 📂 File System Event: ${event.toUpperCase()}`);
        console.log(`[${timestamp}] 📄 File: ${WATCH_PATH}/${filename}`);

        if (event === "rename") {
            console.log(`[${timestamp}] ⚡ Gopher Alert: A new artifact has been discovered or moved!`);
            tagFileWithOllama(WATCH_PATH, filename);
        }
    }
});

console.log(`[System] Gopher is now eyes-on: ${WATCH_PATH}`);



// 1. Start the Management UI (The "Web Server")
const DASHBOARD_PATH = path.join(import.meta.dir, "dashboard.html");

const server = Bun.serve({
    port: 3030,
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
            return Response.json({ ...summary, uptime_seconds: Math.floor(process.uptime()) });
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

        // Main Dashboard
        if (url.pathname === "/") {
            return new Response(Bun.file(DASHBOARD_PATH), {
                headers: { "Content-Type": "text/html" }
            });
        }

        return new Response("Not found", { status: 404 });
    },
});

console.log(`🚀 Gopher Dashboard online at http://aistation.local:${server.port}`);

// 2. The "Nerd Radar" Timer (The "Chrono-Task")
// Runs every 30 minutes (1,800,000 ms)
const FORAGE_INTERVAL = 30 * 60 * 1000;

setInterval(async () => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] 🔍 Gopher is heading out to enrich RSS queue...`);
    await enrichRssQueue();
    console.log(`[${timestamp}] ✅ Enrichment cycle complete.`);
}, FORAGE_INTERVAL);

// 3. The "Hello World" Startup log
// Run enrichment immediately on startup to drain any backlog
enrichRssQueue().catch(err => console.error(`[Enrichment] Startup run failed: ${err}`));
logEvent("system", "info", { event: "startup", model: process.env.OLLAMA_MODEL ?? "gemma4:e4b" });

console.log("--------------------------------------------------");
console.log("Hello, Doug. The Gopher is now watching the lab.");
console.log("Systems: Web Server [OK] | Interval Timer [OK] | Enrichment [OK]");
console.log("--------------------------------------------------");