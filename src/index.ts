/**
 * LUMIN GOPHER - Core Service v1.0
 * The quiet worker bridging the home lab to the master index.
 */

import Bun from "bun";
import { watch } from "node:fs"; // Bun supports the standard FS watch API
import path from "node:path";

/**
 * LUMIN GOPHER - Folder Watcher Feature
 */

// This points to the directory where index.ts lives (e.g., /app/src)
const PROJECT_ROOT = path.join(import.meta.dir, "..");
const WATCH_PATH = path.join(PROJECT_ROOT, "watch_folder"); // <-- This is the folder Gopher will monitor
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e4b"; // Default to a specific model if not set in .env

console.log(`[System] Gopher is watching: ${WATCH_PATH}`);

// Ensure the directory exists so the watcher doesn't crash on startup
import { mkdirSync, existsSync } from "node:fs";
if (!existsSync(WATCH_PATH)) {
    mkdirSync(WATCH_PATH);
    console.log(`[System] Created watcher directory: ${WATCH_PATH}`);
}

/**
 * OLLAMA TAGGING
 * Calls local Ollama to generate 5 tags and a 2-sentence summary for a discovered file.
 */
async function tagFileWithOllama(filename: string): Promise<void> {
    const prompt = `You are a file archivist. Given the filename "${filename}", generate exactly 5 relevant tags and a 2-sentence summary describing what this file likely contains or represents. Respond ONLY with valid JSON using this exact structure: {"tags": ["tag1", "tag2", "tag3", "tag4", "tag5"], "summary": "First sentence. Second sentence."}`;

    try {
        const response = await fetch("http://host.docker.internal:11434/api/generate", {
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
            console.error(`[Ollama] HTTP ${response.status} - ${await response.text()}`);
            return;
        }

        const data = await response.json() as { response: string };
        const result = JSON.parse(data.response) as { tags: string[]; summary: string };

        console.log(`[Ollama] Tags:    ${result.tags.join(", ")}`);
        console.log(`[Ollama] Summary: ${result.summary}`);
    } catch (err) {
        console.error(`[Ollama] Failed to tag "${filename}": ${err}`);
    }
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
            tagFileWithOllama(filename);
        }
    }
});

console.log(`[System] Gopher is now eyes-on: ${WATCH_PATH}`);



// 1. Start the Management UI (The "Web Server")
const server = Bun.serve({
    port: 3030,
    hostname: "0.0.0.0", // <--- CRITICAL for Docker mapping
    fetch(req) {
        const url = new URL(req.url);

        // Simple routing for your stats page
        if (url.pathname === "/stats") {
            return Response.json({
                status: "online",
                agent: "Lumin Gopher",
                location: "Fort Worth Linux Box",
                uptime: `${Math.floor(process.uptime())}s`,
                nerd_radar_active: true
            });
        }

        // Main Dashboard View
        return new Response(`
      <body style="font-family: sans-serif; background: #F0F2F5; padding: 40px; color: #1F1F1F;">
        <h1 style="color: #4285F4;">Lumin Gopher</h1>
        <p>Status: <strong>Active and Scouting</strong></p>
        <hr style="border: 1px solid #E3E3E3;" />
        <p>Next RSS forage in: <span id="timer">...</span></p>
        <a href="/stats" style="color: #4285F4; text-decoration: none;">View JSON Stats</a>
      </body>
    `, {
            headers: { "Content-Type": "text/html" },
        });
    },
});

console.log(`🚀 Gopher Dashboard online at http://aistation.local:${server.port}`);

// 2. The "Nerd Radar" Timer (The "Chrono-Task")
// Runs every 30 minutes (1,800,000 ms)
const FORAGE_INTERVAL = 30 * 60 * 1000;

setInterval(async () => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] 🔍 Gopher is heading out to forage RSS feeds...`);

    // This is where your fetch logic to Cloudflare will eventually go
    // await forageFeeds();

    console.log(`[${timestamp}] ✅ Foraging complete. Signal stabilized.`);
}, FORAGE_INTERVAL);

// 3. The "Hello World" Startup log
console.log("--------------------------------------------------");
console.log("Hello, Doug. The Gopher is now watching the lab.");
console.log("Systems: Web Server [OK] | Interval Timer [OK]");
console.log("--------------------------------------------------");