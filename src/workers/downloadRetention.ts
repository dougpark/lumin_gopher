import { readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import type { EventStatus, EventType } from "../db/db";

type DownloadSource = "feedbin" | "popular";

const prefixes: Record<DownloadSource, string> = {
    feedbin: "feedbin_starred_",
    popular: "pinboard_popular_",
};
const DAY_MS = 24 * 60 * 60 * 1000;

export function cleanupDownloads(directory: string, source: DownloadSource, now = new Date()): {
    removed: number;
    errors: string[];
} {
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const cutoff = new Date(today - 30 * DAY_MS).toISOString().slice(0, 10);
    const prefix = prefixes[source];
    let removed = 0;
    const errors: string[] = [];

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.startsWith(prefix)) continue;
        const suffix = entry.name.slice(prefix.length);
        const match = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(suffix);
        if (!match) continue;

        const date = new Date(`${match[1]}T00:00:00.000Z`);
        if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== match[1] || match[1] >= cutoff) continue;

        try {
            unlinkSync(path.join(directory, entry.name));
            removed++;
        } catch (error) {
            errors.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    return { removed, errors };
}

export function logDownloadCleanup(
    directory: string,
    source: DownloadSource,
    logEvent: (type: EventType, status: EventStatus, details?: Record<string, unknown>) => void
): void {
    let removed = 0;
    let errors: string[] = [];
    try {
        ({ removed, errors } = cleanupDownloads(directory, source));
    } catch (error) {
        errors = [error instanceof Error ? error.message : String(error)];
    }

    console.log(`[${source}] Download cleanup removed ${removed} file(s).`);
    for (const error of errors) console.error(`[${source}] Download cleanup failed: ${error}`);
    try {
        logEvent(source, errors.length ? "error" : "info", {
            event: "download_cleanup",
            removed,
            ...(errors.length ? { errors } : {}),
        });
    } catch (error) {
        console.error(`[${source}] Could not log download cleanup: ${error}`);
    }
}
