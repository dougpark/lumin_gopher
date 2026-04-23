# save enough data to show a status dashboard

### each api call should save the following to a local SQLite database:
- timestamp
- type (file_drop, rss_enrichment, etc.)
- status (success, error, etc.)
- details (JSON blob for any extra info, like error messages or generated tags)


### create a new dashbord route at `/` and client 
dashboard.html that shows a live-updating status dashboard based on this data. Use Tailwind for styling and make it look nice!

### goal is to show a timeseries graph showing the last 48 hours of activity, with filters for type and status. This will help you monitor the health of the Gopher and quickly identify any issues with AI processing or file drops.

### be able to see counts
- total items processed, by hour, day, week
- success vs error rates
- recent error messages for debugging




Created 5 todos

Starting: *Create src/db.ts SQLite module* (1/5)

Created [](file:///home/dougpark/Production/lumin_gopher/src/db.ts)

Checked [](file:///home/dougpark/Production/lumin_gopher/src/db.ts), no problems found

Starting: *Instrument tagger.ts and enrichment.ts* (2/5)

Now instrument both modules simultaneously: 

Replacing 42 lines with 65 lines in [](file:///home/dougpark/Production/lumin_gopher/src/tagger.ts), [](file:///home/dougpark/Production/lumin_gopher/src/enrichment.ts)


```

```

```

```


Searched for text `PATCH failed` (`**/src/enrichment.ts`), 1 result

Read [](file:///home/dougpark/Production/lumin_gopher/src/enrichment.ts#103-103), lines 103 to 125

The PATCH block got mangled — let me fix it: 

Read [](file:///home/dougpark/Production/lumin_gopher/src/enrichment.ts#100-100), lines 100 to 118

Replacing 7 lines with 9 lines in [](file:///home/dougpark/Production/lumin_gopher/src/enrichment.ts)


```

```
Now add the `enrichment_cycle` log at the end of each drain iteration, and the queue fetch error logEvent: 

Read [](file:///home/dougpark/Production/lumin_gopher/src/enrichment.ts#130-130), lines 130 to 163

Replacing 8 lines with 13 lines in [](file:///home/dougpark/Production/lumin_gopher/src/enrichment.ts)


```

```


Checked [](file:///home/dougpark/Production/lumin_gopher/src/enrichment.ts), [](file:///home/dougpark/Production/lumin_gopher/src/tagger.ts), 7 problems found

The `import { logEvent }` in enrichment.ts landed after the `const` declarations where ES module imports must be at the top. Let me fix:  

Read [](file:///home/dougpark/Production/lumin_gopher/src/enrichment.ts#1-1), lines 1 to 18

The import got lost — the replacement injected it after the `const` block but Bun handles top-level `const` before `import` oddly. Let me do a clean fix — move the import to the very top:  

Replacing 14 lines with 14 lines in [](file:///home/dougpark/Production/lumin_gopher/src/enrichment.ts)

Searched for text `import { logEvent } from` (`**/src/enrichment.ts`), no results

Searched for text `logEvent` (`**/src/enrichment.ts`), 7 results

The import statement never made it in. The `const` declarations at the top of the file are treated as module-level before `import` in Bun's ESM. I need to add the import at the very start of the file: 

Read [](file:///home/dougpark/Production/lumin_gopher/src/enrichment.ts#1-1), lines 1 to 15

Replacing 3 lines with 5 lines in [](file:///home/dougpark/Production/lumin_gopher/src/enrichment.ts)


```

```


Checked [](file:///home/dougpark/Production/lumin_gopher/src/enrichment.ts), no problems found

Starting: *Add 3 metrics API routes to index.ts* (3/5)

Now add the 3 API routes to index.ts:  

Read [](file:///home/dougpark/Production/lumin_gopher/src/index.ts#1-1), lines 1 to 20

Read [](file:///home/dougpark/Production/lumin_gopher/src/index.ts#50-50), lines 50 to 100

Replacing 34 lines with 58 lines in [](file:///home/dougpark/Production/lumin_gopher/src/index.ts)


```

```
Also add a startup `logEvent`: 

Replacing 2 lines with 3 lines in [](file:///home/dougpark/Production/lumin_gopher/src/index.ts)


```

```


Checked [](file:///home/dougpark/Production/lumin_gopher/src/index.ts), no problems found

Starting: *Create src/dashboard.html* (4/5)

Now the dashboard:  

Create File

Now the dashboard:  

Created [](file:///home/dougpark/Production/lumin_gopher/src/dashboard.html)

Starting: *Add data volume to docker-compose.yml* (5/5)

Replacing 2 lines with 3 lines in [](file:///home/dougpark/Production/lumin_gopher/docker-compose.yml)


```

```


Completed: *Add data volume to docker-compose.yml* (5/5)

Checked [](file:///home/dougpark/Production/lumin_gopher/src/index.ts), [](file:///home/dougpark/Production/lumin_gopher/src/db.ts), [](file:///home/dougpark/Production/lumin_gopher/src/tagger.ts), [](file:///home/dougpark/Production/lumin_gopher/src/enrichment.ts), no problems found

All clean. Here's everything that was built:

**New files:**
- db.ts — `bun:sqlite` module; `events` table with 3 indexes; `logEvent()`, `querySummary()`, `queryTimeseries()`, `queryRecentErrors()` exports
- dashboard.html — full Gemini-Modern dashboard with stat cards, Chart.js 48h bar chart with type/status filters, recent errors table, 60s auto-refresh

**Modified files:**
- tagger.ts — `logEvent('file_drop', ...)` on success and error paths
- enrichment.ts — `logEvent` on per-item success/error/sentinel, cycle summary, and API failures
- index.ts — 3 new routes (`/api/metrics/summary`, `/api/metrics/timeseries`, `/api/metrics/recent-errors`); `/` now serves `dashboard.html`; startup event logged
- docker-compose.yml — `./data:/app/data` bind mount so `gopher.sqlite` survives `docker compose down`

Do a `docker compose down && docker compose up -d` and visit `http://aistation.local:3030`.

Made changes.