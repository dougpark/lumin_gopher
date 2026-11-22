export const SCHEDULED_JOBS = [
    { id: "system-metrics", name: "System metrics", schedule: "Every 5 minutes", itemLabel: "snapshots" },
    { id: "enrichment", name: "RSS and bookmark enrichment", schedule: "Every 30 minutes", itemLabel: "items attempted" },
    { id: "pinboard-popular", name: "Pinboard Popular scrape", schedule: "Every 24 hours", itemLabel: "items scraped" },
    { id: "feedbin-starred", name: "Feedbin starred entries", schedule: "Every 30 minutes", itemLabel: "entries fetched" },
    { id: "full-text", name: "Full-text fetch", schedule: "Every hour", itemLabel: "items processed" },
] as const;
