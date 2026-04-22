/**
 * LUMIN GOPHER - Core Service v1.0
 * The quiet worker bridging the home lab to the master index.
 */

import Bun from "bun";

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