/**
 * Database Module
 * Local SQLite event log for all Gopher activity.
 * Used to power the metrics dashboard.
 */

import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";

export type EventType =
    | "file_drop"
    | "rss_enrichment"
    | "bookmark_enrichment"
    | "enrichment_cycle"
    | "api_error"
    | "system"
    | "system_metrics";

export type EventStatus = "success" | "error" | "sentinel" | "info";

const DATA_DIR = path.join(import.meta.dir, "..", "..", "data");
const DB_PATH = path.join(DATA_DIR, "gopher.sqlite");

if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

db.run(`
    CREATE TABLE IF NOT EXISTS events (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        type      TEXT    NOT NULL,
        status    TEXT    NOT NULL,
        details   TEXT
    )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events (timestamp)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_events_type      ON events (type)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_events_status    ON events (status)`);

const insertStmt = db.prepare(
    `INSERT INTO events (timestamp, type, status, details) VALUES (?, ?, ?, ?)`
);

export function logEvent(
    type: EventType,
    status: EventStatus,
    details?: Record<string, unknown>
): void {
    insertStmt.run(Date.now(), type, status, details ? JSON.stringify(details) : null);
}

// ── Query helpers used by the metrics API ────────────────────────────────────

export interface EventRow {
    id: number;
    timestamp: number;
    type: string;
    status: string;
    details: string | null;
}

export function queryRecentErrors(limit: number): EventRow[] {
    return db.query<EventRow, [string, number]>(
        `SELECT id, timestamp, type, status, details
         FROM events
         WHERE status = 'error'
         ORDER BY timestamp DESC
         LIMIT ?`
    ).all("error", limit);
}

export function queryQueueStatus(): { total_pending: number | null; rss_pending: number | null; bookmarks_pending: number | null; last_cycle_at: number | null } {
    const row = db.query<{ timestamp: number; details: string | null }, []>(
        `SELECT timestamp, details FROM events
         WHERE type = 'enrichment_cycle' AND status = 'info'
         ORDER BY timestamp DESC LIMIT 1`
    ).get();
    if (!row) return { total_pending: null, rss_pending: null, bookmarks_pending: null, last_cycle_at: null };
    const d = row.details ? JSON.parse(row.details) as Record<string, unknown> : {};
    const breakdown = d.source_breakdown as { rss?: number; bookmarks?: number } | null ?? null;
    return {
        total_pending: typeof d.total_pending === "number" ? d.total_pending : null,
        rss_pending: breakdown?.rss ?? null,
        bookmarks_pending: breakdown?.bookmarks ?? null,
        last_cycle_at: row.timestamp
    };
}

export function queryEventsByRange(fromMs: number, toMs: number, type?: string, status?: string): EventRow[] {
    let sql = `SELECT id, timestamp, type, status, details
               FROM events
               WHERE timestamp >= ? AND timestamp < ?`;
    const params: (string | number)[] = [fromMs, toMs];
    if (type) { sql += ` AND type = ?`; params.push(type); }
    if (status) { sql += ` AND status = ?`; params.push(status); }
    sql += ` ORDER BY timestamp ASC`;
    return db.query<EventRow, typeof params>(sql).all(...params);
}

export function queryTimeseries(sinceMs: number, type?: string, status?: string): { bucket: number; count: number }[] {
    let sql = `
        SELECT (timestamp / 3600000) * 3600000 AS bucket, COUNT(*) AS count
        FROM events
        WHERE timestamp >= ?`;
    const params: (string | number)[] = [sinceMs];

    if (type) { sql += ` AND type = ?`; params.push(type); }
    if (status) { sql += ` AND status = ?`; params.push(status); }

    sql += ` GROUP BY bucket ORDER BY bucket ASC`;

    return db.query<{ bucket: number; count: number }, typeof params>(sql).all(...params);
}

export function querySummary(): {
    total: number;
    success: number;
    error: number;
    sentinel: number;
    last_24h: number;
    last_7d: number;
    last_4w: number;
} {
    const now = Date.now();
    const h24 = now - 24 * 60 * 60 * 1000;
    const d7 = now - 7 * 24 * 60 * 60 * 1000;
    const w4 = now - 28 * 24 * 60 * 60 * 1000;

    const row = db.query<{
        total: number; success: number; error: number; sentinel: number;
        last_24h: number; last_7d: number; last_4w: number;
    }, [number, number, number]>(`
        SELECT
            COUNT(*)                                               AS total,
            SUM(CASE WHEN status = 'success'  THEN 1 ELSE 0 END)  AS success,
            SUM(CASE WHEN status = 'error'    THEN 1 ELSE 0 END)  AS error,
            SUM(CASE WHEN status = 'sentinel' THEN 1 ELSE 0 END)  AS sentinel,
            SUM(CASE WHEN timestamp >= ?      THEN 1 ELSE 0 END)  AS last_24h,
            SUM(CASE WHEN timestamp >= ?      THEN 1 ELSE 0 END)  AS last_7d,
            SUM(CASE WHEN timestamp >= ?      THEN 1 ELSE 0 END)  AS last_4w
        FROM events
    `).get(h24, d7, w4);

    return row ?? { total: 0, success: 0, error: 0, sentinel: 0, last_24h: 0, last_7d: 0, last_4w: 0 };
}
