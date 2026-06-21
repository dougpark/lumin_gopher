import { Database } from "bun:sqlite";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { simpleParser } from "mailparser";
import sanitizeHtml from "sanitize-html";

type ParsedAttachment = {
    filename?: string | null;
    contentType: string;
    size: number;
    cid?: string | null;
    content?: Buffer;
};

export interface EmailAttachmentContent {
    filename: string;
    contentType: string;
    buffer: Buffer;
}

export interface DeleteArchivedEmailResult {
    status: "ok" | "not_found" | "partial_file_delete_failed" | "error";
    id: string;
    message: string;
    file_deleted: boolean;
}

const EMAIL_DB_PATH = process.env.EMAIL_DB_PATH ?? "/app/emaildata/db.sqlite";
const EMAIL_STORAGE_ROOT = process.env.EMAIL_STORAGE_ROOT ?? "/app/emaildata/";

export interface EmailViewerListParams {
    q?: string;
    sender?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
    offset?: number;
}

export interface ArchivedEmailListItem {
    id: string;
    source_type: string;
    created_at: string | null;
    processed_at: string | null;
    sender: string | null;
    subject: string | null;
    storage_path: string | null;
    has_metadata: boolean;
    has_attachments: boolean;
}

export interface ArchivedEmailListResponse {
    status: "ok";
    generated_at: number;
    total: number;
    limit: number;
    offset: number;
    items: ArchivedEmailListItem[];
}

export interface EmailHeaderEntry {
    name: string;
    value: string;
}

export interface EmailAttachmentSummary {
    filename: string | null;
    content_type: string;
    size: number;
    content_id: string | null;
}

export interface ArchivedEmailDetail {
    id: string;
    source_type: string;
    created_at: string | null;
    processed_at: string | null;
    sender: string | null;
    subject: string | null;
    storage_path: string | null;
    metadata: Record<string, string[]>;
    rendered: {
        content_available: boolean;
        content_error: string | null;
        subject: string | null;
        from: string | null;
        to: string | null;
        cc: string | null;
        date: string | null;
        text: string | null;
        html: string | null;
        headers: EmailHeaderEntry[];
        attachments: EmailAttachmentSummary[];
    };
}

interface EmailArchiveRow {
    id: string;
    source_type: string;
    created_at: string | null;
    processed_at: string | null;
    sender: string | null;
    subject: string | null;
    storage_path: string | null;
    metadata: string | null;
}

function openReadOnlyEmailDb(): Database {
    const db = new Database(EMAIL_DB_PATH, { readonly: true });
    db.exec("PRAGMA query_only = ON;");
    db.exec("PRAGMA busy_timeout = 5000;");
    return db;
}

function openReadWriteEmailDb(): Database {
    const db = new Database(EMAIL_DB_PATH);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA busy_timeout = 5000;");
    return db;
}

function normalizeLimit(limit?: number): number {
    return Math.max(1, Math.min(limit ?? 25, 100));
}

function normalizeOffset(offset?: number): number {
    return Math.max(0, offset ?? 0);
}

function parseMetadata(raw: string | null): Record<string, string[]> {
    if (!raw) return {};

    try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const normalized: Record<string, string[]> = {};

        for (const [key, value] of Object.entries(parsed)) {
            if (Array.isArray(value)) {
                normalized[key] = value.map((entry) => String(entry));
                continue;
            }

            if (value !== null && value !== undefined) {
                normalized[key] = [String(value)];
            }
        }

        return normalized;
    } catch {
        return {};
    }
}

function buildHeaderEntries(metadata: Record<string, string[]>): EmailHeaderEntry[] {
    return Object.entries(metadata)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => ({
            name,
            value: value.join("\n")
        }));
}

function resolveStoragePath(storagePath: string | null): string | null {
    if (!storagePath) return null;

    const root = path.resolve(EMAIL_STORAGE_ROOT);
    const pathSegments = storagePath
        .split(/[\\/]+/)
        .filter(Boolean);

    if (pathSegments.length === 0) {
        return null;
    }

    const normalizedStoragePath = path.join(...pathSegments.slice(1));
    const resolved = path.resolve(root, normalizedStoragePath);

    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error("Storage path escapes email data root");
    }

    return resolved;
}

function sanitizeEmailHtml(html: string): string {
    return sanitizeHtml(html, {
        allowedTags: [
            "a", "article", "aside", "b", "blockquote", "br", "code", "div", "em", "figcaption", "figure",
            "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "li", "main", "ol", "p", "pre", "section",
            "small", "span", "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul"
        ],
        allowedAttributes: {
            a: ["href", "name", "target", "rel"],
            td: ["colspan", "rowspan"],
            th: ["colspan", "rowspan"],
            '*': ["style"]
        },
        allowedSchemes: ["http", "https", "mailto"],
        transformTags: {
            a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" })
        },
        allowedStyles: {
            '*': {
                color: [/^.*$/],
                'background-color': [/^.*$/],
                'font-weight': [/^.*$/],
                'font-style': [/^.*$/],
                'text-decoration': [/^.*$/],
                'text-align': [/^.*$/],
                'padding-left': [/^.*$/],
                'padding-right': [/^.*$/],
                'margin-left': [/^.*$/],
                'margin-right': [/^.*$/],
                width: [/^.*$/],
                'max-width': [/^.*$/],
                border: [/^.*$/],
                'border-collapse': [/^.*$/]
            }
        }
    });
}

function normalizeFilterDate(value: string, isEndOfDay: boolean): string {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return isEndOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`;
    }

    return value;
}

function buildListQuery(params: EmailViewerListParams): { whereSql: string; values: string[] } {
    const where: string[] = [];
    const values: string[] = [];

    if (params.q) {
        where.push("(COALESCE(subject, '') LIKE ? OR COALESCE(sender, '') LIKE ?)");
        const like = `%${params.q}%`;
        values.push(like, like);
    }

    if (params.sender) {
        where.push("COALESCE(sender, '') LIKE ?");
        values.push(`%${params.sender}%`);
    }

    if (params.dateFrom) {
        where.push("COALESCE(processed_at, created_at) >= ?");
        values.push(normalizeFilterDate(params.dateFrom, false));
    }

    if (params.dateTo) {
        where.push("COALESCE(processed_at, created_at) <= ?");
        values.push(normalizeFilterDate(params.dateTo, true));
    }

    return {
        whereSql: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
        values
    };
}

export function listArchivedEmails(params: EmailViewerListParams = {}): ArchivedEmailListResponse {
    const db = openReadOnlyEmailDb();
    const limit = normalizeLimit(params.limit);
    const offset = normalizeOffset(params.offset);
    const { whereSql, values } = buildListQuery(params);

    try {
        const countSql = `
            SELECT COUNT(*) AS total
            FROM email_archive_items
            ${whereSql}
        `;
        const totalRow = db.query<{ total: number }, string[]>(countSql).get(...values);

        const listSql = `
            SELECT
                id,
                source_type,
                created_at,
                processed_at,
                sender,
                subject,
                storage_path,
                metadata IS NOT NULL AS has_metadata,
                (metadata LIKE '%multipart/mixed%') AS has_attachments
            FROM email_archive_items
            ${whereSql}
            ORDER BY COALESCE(processed_at, created_at) DESC, id DESC
            LIMIT ?
            OFFSET ?
        `;
        const rows = db.query<ArchivedEmailListItem, (string | number)[]>(listSql).all(...values, limit, offset);

        return {
            status: "ok",
            generated_at: Date.now(),
            total: totalRow?.total ?? 0,
            limit,
            offset,
            items: rows
        };
    } finally {
        db.close();
    }
}

export function deleteArchivedEmail(id: string): DeleteArchivedEmailResult {
    const emailId = id.trim();
    if (!emailId) {
        return {
            status: "error",
            id,
            message: "Invalid email id.",
            file_deleted: false,
        };
    }

    const db = openReadWriteEmailDb();
    let resolvedPath: string | null = null;

    try {
        const removeRecordTx = db.transaction((targetId: string) => {
            const row = db.query<{ storage_path: string | null }, [string]>(`
                SELECT storage_path
                FROM email_archive_items
                WHERE id = ?
                LIMIT 1
            `).get(targetId);

            if (!row) {
                return null;
            }

            db.query(`DELETE FROM email_archive_items WHERE id = ?`).run(targetId);
            return row;
        });

        const row = removeRecordTx(emailId);
        if (!row) {
            return {
                status: "not_found",
                id: emailId,
                message: "Archived email not found.",
                file_deleted: false,
            };
        }

        if (row.storage_path) {
            resolvedPath = resolveStoragePath(row.storage_path);
        }
    } catch (error) {
        return {
            status: "error",
            id: emailId,
            message: error instanceof Error ? error.message : "Delete failed.",
            file_deleted: false,
        };
    } finally {
        db.close();
    }

    if (!resolvedPath) {
        return {
            status: "ok",
            id: emailId,
            message: "Archived email deleted. No file path was recorded.",
            file_deleted: false,
        };
    }

    if (!existsSync(resolvedPath)) {
        return {
            status: "ok",
            id: emailId,
            message: "Archived email deleted. File was already missing.",
            file_deleted: false,
        };
    }

    try {
        unlinkSync(resolvedPath);
        return {
            status: "ok",
            id: emailId,
            message: "Archived email and file deleted.",
            file_deleted: true,
        };
    } catch (error) {
        return {
            status: "partial_file_delete_failed",
            id: emailId,
            message: error instanceof Error ? error.message : "Email record deleted, but file delete failed.",
            file_deleted: false,
        };
    }
}

export async function getArchivedEmailAttachment(id: string, index: number): Promise<EmailAttachmentContent | null> {
    const db = openReadOnlyEmailDb();

    let storagePath: string | null = null;
    try {
        const row = db.query<{ storage_path: string | null }, [string]>(
            `SELECT storage_path FROM email_archive_items WHERE id = ? LIMIT 1`
        ).get(id);
        storagePath = row?.storage_path ?? null;
    } finally {
        db.close();
    }

    const resolvedPath = resolveStoragePath(storagePath);
    if (!resolvedPath || !existsSync(resolvedPath)) return null;

    const raw = await Bun.file(resolvedPath).arrayBuffer();
    const parsed = await simpleParser(Buffer.from(raw));

    const attachment = parsed.attachments[index] as ParsedAttachment | undefined;
    if (!attachment || !attachment.content) return null;

    return {
        filename: attachment.filename || `attachment-${index}`,
        contentType: attachment.contentType || "application/octet-stream",
        buffer: attachment.content,
    };
}

export async function getArchivedEmailDetail(id: string): Promise<ArchivedEmailDetail | null> {
    const db = openReadOnlyEmailDb();

    try {
        const row = db.query<EmailArchiveRow, [string]>(`
            SELECT
                id,
                source_type,
                created_at,
                processed_at,
                sender,
                subject,
                storage_path,
                metadata
            FROM email_archive_items
            WHERE id = ?
            LIMIT 1
        `).get(id);

        if (!row) {
            return null;
        }

        const metadata = parseMetadata(row.metadata);
        const headers = buildHeaderEntries(metadata);

        const detail: ArchivedEmailDetail = {
            id: row.id,
            source_type: row.source_type,
            created_at: row.created_at,
            processed_at: row.processed_at,
            sender: row.sender,
            subject: row.subject,
            storage_path: row.storage_path,
            metadata,
            rendered: {
                content_available: false,
                content_error: null,
                subject: row.subject,
                from: row.sender,
                to: null,
                cc: null,
                date: row.created_at,
                text: null,
                html: null,
                headers,
                attachments: []
            }
        };

        const resolvedPath = resolveStoragePath(row.storage_path);
        if (!resolvedPath) {
            detail.rendered.content_error = "No storage path recorded for this email.";
            return detail;
        }

        if (!existsSync(resolvedPath)) {
            detail.rendered.content_error = resolvedPath;
            // "Archived .eml file is missing from storage.";
            return detail;
        }

        try {
            const raw = await Bun.file(resolvedPath).arrayBuffer();
            const parsed = await simpleParser(Buffer.from(raw));
            const html = typeof parsed.html === "string" ? sanitizeEmailHtml(parsed.html) : null;

            detail.rendered = {
                content_available: true,
                content_error: null,
                subject: parsed.subject ?? row.subject,
                from: parsed.from?.text ?? row.sender,
                to: parsed.to?.text ?? null,
                cc: parsed.cc?.text ?? null,
                date: parsed.date ? parsed.date.toISOString() : row.created_at,
                text: parsed.text ?? null,
                html,
                headers,
                attachments: parsed.attachments.map((attachment: ParsedAttachment) => ({
                    filename: attachment.filename ?? null,
                    content_type: attachment.contentType,
                    size: attachment.size,
                    content_id: attachment.cid ?? null
                }))
            };
        } catch (error) {
            detail.rendered.content_error = error instanceof Error ? error.message : "Unable to parse archived email.";
        }

        return detail;
    } finally {
        db.close();
    }
}