import { Database } from "bun:sqlite";

const EMAIL_DB_PATH = process.env.EMAIL_DB_PATH ?? "/app/emaildata/db.sqlite";

export interface EmailProcessingActivity {
    processed_at: string;
    emails_processed: number;
}

export interface LastRunStats {
    last_run: string | null;
    last_status: string | null;
    emails_fetched: number;
    emails_ingested: number;
    total_archived: number;
    message: string | null;
}

export interface EmailStatsResponse {
    status: "ok";
    generated_at: number;
    database: {
        path: string;
        readonly: boolean;
        journal_mode: string;
    };
    summary: {
        most_recent_processed_at: string | null;
        most_recent_emails_processed: number;
        total_emails_processed_to_date: number;
    };
    last_run: LastRunStats;
    recent_activity: EmailProcessingActivity[];
}

function openReadOnlyEmailDb(): { db: Database; journalMode: string } {
    const db = new Database(EMAIL_DB_PATH, { readonly: true });

    // Keep reads deterministic and safe under concurrent writers.
    db.exec("PRAGMA query_only = ON;");
    db.exec("PRAGMA busy_timeout = 5000;");

    let journalMode = "unknown";
    try {
        // In read-only mode this may not change state, but it confirms WAL intent.
        const row = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode = WAL;").get();
        if (row?.journal_mode) {
            journalMode = row.journal_mode;
        }
    } catch {
        const row = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode;").get();
        if (row?.journal_mode) {
            journalMode = row.journal_mode;
        }
    }

    return { db, journalMode };
}

export function getRecentEmailProcessingActivity(limit = 20): EmailProcessingActivity[] {
    const { db } = openReadOnlyEmailDb();
    try {
        const safeLimit = Math.max(1, Math.min(limit, 100));
        return db.query<EmailProcessingActivity, [number]>(`
            SELECT
                processed_at,
                COUNT(*) AS emails_processed
            FROM email_archive_items
            WHERE processed_at IS NOT NULL
            GROUP BY processed_at
            ORDER BY processed_at DESC
            LIMIT ?
        `).all(safeLimit);
    } finally {
        db.close();
    }
}

export function getEmailStats(limit = 20): EmailStatsResponse {
    const { db, journalMode } = openReadOnlyEmailDb();
    try {
        const safeLimit = Math.max(1, Math.min(limit, 100));

        let lastRun: LastRunStats = {
            last_run: null,
            last_status: null,
            emails_fetched: 0,
            emails_ingested: 0,
            total_archived: 0,
            message: null,
        };

        try {
            const row = db.query<{
                last_run: string | null;
                last_status: string | null;
                emails_fetched: number;
                emails_ingested: number;
                total_archived: number;
                message: string | null;
            }, []>(`
                SELECT
                    last_run,
                    last_status,
                    emails_fetched,
                    emails_ingested,
                    total_archived,
                    message
                FROM system_status
                ORDER BY last_run DESC
                LIMIT 1
            `).get();

            if (row) {
                lastRun = {
                    last_run: row.last_run,
                    last_status: row.last_status,
                    emails_fetched: row.emails_fetched ?? 0,
                    emails_ingested: row.emails_ingested ?? 0,
                    total_archived: row.total_archived ?? 0,
                    message: row.message,
                };
            }
        } catch {
            // Keep endpoint backward compatible even if system_status is unavailable.
        }

        const totalRow = db.query<{ total: number }, []>(`
            SELECT COUNT(*) AS total
            FROM email_archive_items
            WHERE processed_at IS NOT NULL
        `).get();

        const recentActivity = db.query<EmailProcessingActivity, [number]>(`
            SELECT
                processed_at,
                COUNT(*) AS emails_processed
            FROM email_archive_items
            WHERE processed_at IS NOT NULL
            GROUP BY processed_at
            ORDER BY processed_at DESC
            LIMIT ?
        `).all(safeLimit);

        const latest = recentActivity.length > 0 ? recentActivity[0] : null;

        return {
            status: "ok",
            generated_at: Date.now(),
            database: {
                path: EMAIL_DB_PATH,
                readonly: true,
                journal_mode: journalMode,
            },
            summary: {
                most_recent_processed_at: latest?.processed_at ?? null,
                most_recent_emails_processed: latest?.emails_processed ?? 0,
                total_emails_processed_to_date: totalRow?.total ?? 0,
            },
            last_run: lastRun,
            recent_activity: recentActivity,
        };
    } finally {
        db.close();
    }
}
