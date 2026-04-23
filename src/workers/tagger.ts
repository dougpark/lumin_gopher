/**
 * File Tagger Module
 * Extracts text content from dropped files and calls local Ollama
 * to generate 5 tags and a 2-sentence summary.
 */

import Bun from "bun";
import path from "node:path";
import { getDocumentProxy, extractText } from "unpdf";
import mammoth from "mammoth";
import { logEvent } from "../db/db";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://host.docker.internal:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e4b";

const TEXT_EXTENSIONS = new Set([
    ".txt", ".md", ".markdown", ".ts", ".js", ".json", ".csv",
    ".html", ".htm", ".xml", ".yaml", ".yml", ".toml", ".log",
    ".sh", ".bash", ".py", ".rb", ".rs", ".go", ".c", ".cpp",
    ".h", ".css", ".scss", ".sql"
]);

async function extractFileContent(filePath: string): Promise<string | null> {
    const ext = path.extname(filePath).toLowerCase();

    if (TEXT_EXTENSIONS.has(ext)) {
        const text = await Bun.file(filePath).text();
        return text.slice(0, 1000);
    }

    if (ext === ".pdf") {
        const buffer = await Bun.file(filePath).arrayBuffer();
        const pdf = await getDocumentProxy(new Uint8Array(buffer));
        const { text } = await extractText(pdf, { mergePages: true });
        return text.slice(0, 1000);
    }

    if (ext === ".docx") {
        const buffer = await Bun.file(filePath).arrayBuffer();
        const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
        return value.slice(0, 1000);
    }

    // Unknown/binary format — fall back to filename only
    return null;
}

export async function tagFileWithOllama(watchPath: string, filename: string): Promise<void> {
    const filePath = path.join(watchPath, filename);
    let contentSnippet: string | null = null;

    try {
        contentSnippet = await extractFileContent(filePath);
    } catch (err) {
        console.warn(`[Tagger] Could not extract content from "${filename}", using filename only: ${err}`);
    }

    const contentClause = contentSnippet
        ? `\n\nHere are the first 1000 characters of the file contents:\n<content>\n${contentSnippet}\n</content>`
        : "";

    const prompt =
        `You are a file archivist. Given the filename "${filename}"${contentClause}, ` +
        `generate exactly 5 relevant tags and a 2-sentence summary describing what this file contains. ` +
        `Respond ONLY with valid JSON using this exact structure: ` +
        `{"tags": ["tag1", "tag2", "tag3", "tag4", "tag5"], "summary": "First sentence. Second sentence."}`;

    try {
        const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
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
            console.error(`[Tagger] HTTP ${response.status} - ${await response.text()}`);
            return;
        }

        const data = await response.json() as { response: string };
        const raw = JSON.parse(data.response) as Record<string, unknown>;

        const tags = Array.isArray(raw.tags) ? (raw.tags as string[]).join(", ") : null;
        const summary = typeof raw.summary === "string" ? raw.summary : null;

        if (tags) console.log(`[Tagger] Tags:    ${tags}`);
        if (summary) console.log(`[Tagger] Summary: ${summary}`);

        if (!tags && !summary) {
            const msg = `Ollama returned no usable fields for "${filename}": ${JSON.stringify(raw)}`;
            console.warn(`[Tagger] ${msg}`);
            logEvent("file_drop", "error", { filename, error: msg });
            return;
        }

        logEvent("file_drop", "success", {
            filename,
            tags: tags ?? "",
            summary: summary ?? ""
        });

    } catch (err) {
        console.error(`[Tagger] Failed to tag "${filename}": ${err}`);
        logEvent("file_drop", "error", { filename, error: String(err) });
    }
}
