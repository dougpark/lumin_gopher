/**
 * LUMIN GOPHER - Core Service v1.0
 * The quiet worker bridging the home lab to the master index.
 */

import Bun from "bun";
import { Hono } from "hono";
import { watch } from "node:fs"; // Bun supports the standard FS watch API
import path from "node:path";
import { enrichQueue } from "./workers/enrichment";
import { tagFileWithOllama } from "./workers/tagger";
import { logEvent, querySummary, queryTimeseries, queryRecentErrors, queryEventsByRange, queryRecentEvents, queryQueueStatus } from "./db/db";
import { logSystemMetrics, collectSnapshot } from "./workers/sysmetrics";
import { fetchPinboardPopular, todayFileExists } from "./workers/pinboard";
import { fetchFeedbinStarred } from "./workers/feedbin";
import { runFullTextFetch } from "./workers/fulltext";
import { getEmailStats } from "./workers/emailStats";
import { deleteArchivedEmail, getArchivedEmailAttachment, getArchivedEmailDetail, listArchivedEmails } from "./workers/emailViewer.ts";

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
const EMAIL_DASHBOARD_PATH = path.join(import.meta.dir, "client", "email.html");
const EMAIL_VIEWER_PATH = path.join(import.meta.dir, "client", "emailviewer.html");
const SYSTEM_HEALTH_PATH = path.join(import.meta.dir, "client", "system-health.html");
const SIDEBAR_SCRIPT_PATH = path.join(import.meta.dir, "client", "assets", "sidebar.js");
const SIDEBAR_NAV_PATH = path.join(import.meta.dir, "client", "assets", "sidebar-nav.json");

const app = new Hono();

// Health endpoint (used by Docker healthcheck)
app.get("/stats", (c) => {
    return c.json({
        status: "online",
        agent: "Lumin Gopher",
        location: "Fort Worth Linux Box",
        uptime: `${Math.floor(process.uptime())}s`,
        nerd_radar_active: true
    });
});

// Metrics: summary counts
app.get("/api/metrics/summary", (c) => {
    const summary = querySummary();
    const queue = queryQueueStatus();
    return c.json({ ...summary, ...queue, uptime_seconds: Math.floor(process.uptime()) });
});

// Metrics: timeseries (1-hour buckets)
app.get("/api/metrics/timeseries", (c) => {
    const hours = Math.min(parseInt(c.req.query("hours") ?? "48", 10), 168);
    const type = c.req.query("type") ?? undefined;
    const status = c.req.query("status") ?? undefined;
    const sinceMs = Date.now() - hours * 60 * 60 * 1000;
    return c.json(queryTimeseries(sinceMs, type, status));
});

// Metrics: recent errors
app.get("/api/metrics/recent-errors", (c) => {
    const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);
    const rows = queryRecentErrors(limit).map(r => ({
        ...r,
        details: r.details ? JSON.parse(r.details) : null
    }));
    return c.json(rows);
});

// Metrics: events for a specific hour (drill-down)
app.get("/api/metrics/events", (c) => {
    const from = parseInt(c.req.query("from") ?? "0", 10);
    const to = parseInt(c.req.query("to") ?? "0", 10);
    if (!from || !to || to <= from) return c.json({ error: "Invalid range" }, 400);
    const type = c.req.query("type") ?? undefined;
    const status = c.req.query("status") ?? undefined;
    const rows = queryEventsByRange(from, to, type, status).map(r => ({
        ...r,
        details: r.details ? JSON.parse(r.details) : null
    }));
    return c.json(rows);
});

// Metrics: recent events (last N, newest first)
app.get("/api/metrics/recent-events", (c) => {
    const limit = Math.min(parseInt(c.req.query("limit") ?? "100", 10), 500);
    const type = c.req.query("type") ?? undefined;
    const status = c.req.query("status") ?? undefined;
    const rows = queryRecentEvents(limit, type, status).map(r => ({
        ...r,
        details: r.details ? JSON.parse(r.details) : null
    }));
    return c.json(rows);
});

// Metrics: latest system snapshot (live collection every request)
app.get("/api/metrics/system", async (c) => {
    const snap = await collectSnapshot();
    return c.json(snap);
});

// Main Dashboard
app.get("/", (c) => {
    return new Response(Bun.file(DASHBOARD_PATH), {
        headers: { "Content-Type": "text/html" }
    });
});

// note.html
app.get("/note", (c) => {
    return new Response(Bun.file("public/note.html"), {
        headers: { "Content-Type": "text/html" }
    });
});

// Email stats dashboard
app.get("/email", (c) => {
    return new Response(Bun.file(EMAIL_DASHBOARD_PATH), {
        headers: { "Content-Type": "text/html" }
    });
});

// Email archive viewer
app.get("/email/viewer", (c) => {
    return new Response(Bun.file(EMAIL_VIEWER_PATH), {
        headers: { "Content-Type": "text/html" }
    });
});

// System health dashboard
app.get("/system-health", (c) => {
    return new Response(Bun.file(SYSTEM_HEALTH_PATH), {
        headers: { "Content-Type": "text/html" }
    });
});

// Email stats JSON endpoint
app.get("/email/stats", (c) => {
    try {
        const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);
        return c.json(getEmailStats(limit));
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return c.json({ status: "error", message }, 500);
    }
});

// Email archive viewer list endpoint
app.get("/email/viewer/list", (c) => {
    try {
        const limit = Math.min(parseInt(c.req.query("limit") ?? "25", 10), 100);
        const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10), 0);
        const q = (c.req.query("q") ?? "").trim();
        const sender = (c.req.query("sender") ?? "").trim();
        const dateFrom = (c.req.query("dateFrom") ?? "").trim();
        const dateTo = (c.req.query("dateTo") ?? "").trim();

        return c.json(listArchivedEmails({
            limit,
            offset,
            q: q || undefined,
            sender: sender || undefined,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
        }));
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return c.json({ status: "error", message }, 500);
    }
});

// Email archive delete endpoint
app.delete("/email/viewer/item/:id", (c) => {
    try {
        const id = c.req.param("id").trim();
        if (!id) {
            return c.json({ status: "error", message: "Invalid email id." }, 400);
        }

        const result = deleteArchivedEmail(id);
        if (result.status === "not_found") {
            return c.json(result, 404);
        }

        if (result.status === "error") {
            return c.json(result, 500);
        }

        return c.json(result);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return c.json({ status: "error", message }, 500);
    }
});

// Email attachment streaming endpoint
app.get("/email/viewer/item/:id/attachment/:index", async (c) => {
    try {
        const id = c.req.param("id");
        const index = parseInt(c.req.param("index"), 10);
        if (Number.isNaN(index) || index < 0 || index > 99) {
            return c.json({ status: "error", message: "Invalid attachment index." }, 400);
        }

        const attachment = await getArchivedEmailAttachment(id, index);
        if (!attachment) {
            return c.json({ status: "not_found", message: "Attachment not found." }, 404);
        }

        const safe = attachment.filename.replace(/[^\w\-. ()\[\]]/g, "_");
        return new Response(attachment.buffer, {
            headers: {
                "Content-Type": attachment.contentType,
                "Content-Disposition": `inline; filename="${safe}"`,
                "Content-Length": String(attachment.buffer.length),
                "Cache-Control": "private, max-age=3600",
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return c.json({ status: "error", message }, 500);
    }
});

// Email archive viewer detail endpoint
app.get("/email/viewer/item/:id", async (c) => {
    try {
        const id = c.req.param("id");
        const detail = await getArchivedEmailDetail(id);

        if (!detail) {
            return c.json({ status: "not_found", message: "Archived email not found." }, 404);
        }

        return c.json({ status: "ok", email: detail });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return c.json({ status: "error", message }, 500);
    }
});

// Shared client assets for sidebar navigation
app.get("/assets/sidebar.js", (c) => {
    return new Response(Bun.file(SIDEBAR_SCRIPT_PATH), {
        headers: { "Content-Type": "application/javascript; charset=utf-8" }
    });
});

app.get("/assets/sidebar-nav.json", (c) => {
    return new Response(Bun.file(SIDEBAR_NAV_PATH), {
        headers: { "Content-Type": "application/json; charset=utf-8" }
    });
});

const server = Bun.serve({
    port: PORT,
    hostname: "0.0.0.0", // <--- CRITICAL for Docker mapping
    fetch: app.fetch,
}); // end Bun server

console.log(`🚀 Gopher Dashboard online at ${LOCAL_HOST}:${PORT}`);


/**
 *  
 * Schedulers and Background Tasks
 * System Metrics - ever 5 minutes
 * AI Enrichment Cycle - every 30 minutes
 * Pinboard Popular Scrape - every 24h
 * Feedbin Starred Entries - every 30 minutes
 * Full Text Fetch - every 1h
 * 
 **/



// System Metrics - every 5 minutes
const SYSMETRICS_INTERVAL = 5 * 60 * 1000;
setInterval(() => {
    logSystemMetrics().catch(err => console.error(`[SysMetrics] ${err}`));
}, SYSMETRICS_INTERVAL);

// AI Enrichment Cycle - every 30 minutes
const FORAGE_INTERVAL = 30 * 60 * 1000;
let enrichRunning = false;
async function runEnrichment(): Promise<void> {
    if (enrichRunning) {
        console.log(`[Enrichment] Skipping — previous run still in progress.`);
        return;
    }
    enrichRunning = true;
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] 🔍 Gopher is heading out to enrich queue...`);
    try {
        await enrichQueue();
        console.log(`[${new Date().toLocaleTimeString()}] ✅ Enrichment cycle complete.`);
    } finally {
        enrichRunning = false;
    }
}

setInterval(() => {
    runEnrichment().catch(err => console.error(`[Enrichment] ${err}`));
}, FORAGE_INTERVAL);

// Run enrichment immediately on startup to drain any backlog
runEnrichment().catch(err => console.error(`[Enrichment] Startup run failed: ${err}`));
logSystemMetrics().catch(err => console.error(`[SysMetrics] Startup run failed: ${err}`));
logEvent("system", "info", { event: "startup", model: process.env.OLLAMA_MODEL ?? "gemma4:e4b" });


// Pinboard Popular daily scrape (v1)
const PINBOARD_INTERVAL = 24 * 60 * 60 * 1000; // 24h

let pinboardRunning = false;
async function runPinboardScrape(): Promise<void> {
    if (pinboardRunning) {
        console.log(`[Pinboard] Skipping — previous run still in progress.`);
        return;
    }
    pinboardRunning = true;
    try {
        await fetchPinboardPopular();
    } finally {
        pinboardRunning = false;
    }
}

setInterval(() => {
    runPinboardScrape().catch(err => console.error(`[Pinboard] ${err}`));
}, PINBOARD_INTERVAL);

// Run on startup only if today's file doesn't already exist
if (!todayFileExists()) {
    runPinboardScrape().catch(err => console.error(`[Pinboard] Startup run failed: ${err}`));
} else {
    console.log(`[Pinboard] Today's file already exists — skipping startup scrape.`);
}

// Feedbin Starred Entries — every 30 minutes
const FEEDBIN_INTERVAL = 30 * 60 * 1000; // 30 min

let feedbinRunning = false;
async function runFeedbinFetch(): Promise<void> {
    if (feedbinRunning) {
        console.log(`[Feedbin] Skipping — previous run still in progress.`);
        return;
    }
    feedbinRunning = true;
    try {
        await fetchFeedbinStarred();
    } finally {
        feedbinRunning = false;
    }
}

setInterval(() => {
    runFeedbinFetch().catch(err => console.error(`[Feedbin] ${err}`));
}, FEEDBIN_INTERVAL);

// Always run on startup to pick up any new starred items immediately
runFeedbinFetch().catch(err => console.error(`[Feedbin] Startup run failed: ${err}`));

// Full Text Fetch — drains Lumin queue every 1h
const FULLTEXT_INTERVAL = 1 * 60 * 60 * 1000; // 1h

let fulltextRunning = false;
async function runFullTextCycle(): Promise<void> {
    if (fulltextRunning) {
        console.log(`[FullText] Skipping — previous cycle still running.`);
        return;
    }
    fulltextRunning = true;
    try {
        await runFullTextFetch();
    } finally {
        fulltextRunning = false;
    }
}

setInterval(() => {
    runFullTextCycle().catch(err => console.error(`[FullText] ${err}`));
}, FULLTEXT_INTERVAL);

// Run immediately on startup
runFullTextCycle().catch(err => console.error(`[FullText] Startup run failed: ${err}`));

console.log("--------------------------------------------------");
console.log("Hello! The Gopher is now watching the lab.");
console.log("--------------------------------------------------");

/** 
 * Goals:
 * Cron job 30 minutes (completion of each step triggers next step)
 * -> AI Enrichment
 * -> Full Text Fetch
 * -> AI Synthesis
 * -> Feedbin Starred Entries
 * 
 * Cron job every 5 minutes on the 4th minute :04, :09, :14, etc
 * -> System Metrics
 * 
 * Cron job every 24h at 3:17am
 * -> Pinboard Popular Scrape
 * -> Day One Import (future)
 * -> Weather Data Fetch (future)
 * -> Calendar Events Fetch (future)
 * 
 * Ex. Bun.cron
 * Bun.cron("0,30 * * * *", async () => {
    await runLuminPipeline();
    });
**/

/** future scheduling logic
 *  not production code
 * 
 * 
 * 
 // Define your jobs with individual error handling
async function runLuminPipeline() {
    console.log(`[${new Date().toLocaleTimeString()}] Starting Pipeline...`);

    // 1. Pull Bookmarks
    try {
        await pullLuminBookmarks();
        console.log("✅ Step 1: Lumin Bookmarks Pulled");
    } catch (err) {
        console.error(`❌ Step 1 Failed: ${err.message}`);
        // Optionally return or continue depending on your logic
    }

    // 2. Full Text Scrape
    try {
        await runTextScraper();
        console.log("✅ Step 2: Scrape Complete");
    } catch (err) {
        console.error(`❌ Step 2 Failed: ${err.message}`);
        // We continue even if some scrapes failed
    }

    // 3. AI Synthesis
    try {
        await runAISynthesis();
        console.log("✅ Step 3: Synthesis Complete");
    } catch (err) {
        console.error(`❌ Step 3 Failed: ${err.message}`);
    }

    console.log("--- Pipeline Finished ---");
}

// Trigger the sequence every 30 minutes
Bun.cron("0,30 * * * *", async () => {
    await runLuminPipeline();
});
 * 
 * 
 * 
 * 
 */