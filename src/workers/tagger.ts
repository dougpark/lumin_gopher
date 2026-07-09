/**
 * File Tagger Module
 * Extracts text content from dropped files and calls local Ollama
 * to generate 5 tags and a 2-sentence summary.
 */

import Bun from "bun";
import path from "node:path";
import { logEvent } from "../db/db";
import { extractFileContent } from "./fileContent.ts";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://host.docker.internal:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e4b";

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
