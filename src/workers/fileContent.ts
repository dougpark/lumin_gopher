import Bun from "bun";
import path from "node:path";
import { getDocumentProxy, extractText } from "unpdf";
import mammoth from "mammoth";

const TEN_MB = 10 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
    ".txt", ".md", ".markdown", ".ts", ".js", ".json", ".csv",
    ".html", ".htm", ".xml", ".yaml", ".yml", ".toml", ".log",
    ".sh", ".bash", ".py", ".rb", ".rs", ".go", ".c", ".cpp",
    ".h", ".css", ".scss", ".sql"
]);

const TEXT_MIME_TYPES = new Set([
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/json",
    "application/xml",
    "text/html",
    "application/x-yaml",
    "text/yaml",
    "application/yaml",
    "text/xml"
]);

const PDF_MIME_TYPES = new Set(["application/pdf"]);
const DOCX_MIME_TYPES = new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

function normalizeMimeType(fileType: string | null | undefined): string {
    return (fileType ?? "").split(";", 1)[0].trim().toLowerCase();
}

function isTextLikeExtension(ext: string): boolean {
    return TEXT_EXTENSIONS.has(ext);
}

function isTextLikeMimeType(mimeType: string): boolean {
    return mimeType.startsWith("text/") || TEXT_MIME_TYPES.has(mimeType);
}

function isPdf(ext: string, mimeType: string): boolean {
    return ext === ".pdf" || PDF_MIME_TYPES.has(mimeType);
}

function isDocx(ext: string, mimeType: string): boolean {
    return ext === ".docx" || DOCX_MIME_TYPES.has(mimeType);
}

export interface FileValidationResult {
    accepted: boolean;
    reason?: string;
    extension: string;
    mimeType: string;
}

export function validatePhase1AiFile(fileName: string, fileType: string | null | undefined, fileSize: number): FileValidationResult {
    const extension = path.extname(fileName).toLowerCase();
    const mimeType = normalizeMimeType(fileType);

    if (!Number.isFinite(fileSize) || fileSize < 0) {
        return { accepted: false, reason: "Rejected: invalid file size", extension, mimeType };
    }

    if (fileSize > TEN_MB) {
        return { accepted: false, reason: "Rejected: file size exceeds 10MB", extension, mimeType };
    }

    if (isPdf(extension, mimeType) || isDocx(extension, mimeType) || isTextLikeExtension(extension) || isTextLikeMimeType(mimeType)) {
        return { accepted: true, extension, mimeType };
    }

    if (mimeType.startsWith("image/") || mimeType.startsWith("audio/") || mimeType.startsWith("video/")) {
        return { accepted: false, reason: "Rejected: media files are deferred to Phase 2", extension, mimeType };
    }

    return { accepted: false, reason: "Rejected: file type not supported", extension, mimeType };
}

export async function extractFileContentFromBuffer(fileName: string, fileType: string | null | undefined, buffer: ArrayBuffer, maxChars = 1000): Promise<string | null> {
    const extension = path.extname(fileName).toLowerCase();
    const mimeType = normalizeMimeType(fileType);

    if (isTextLikeExtension(extension) || isTextLikeMimeType(mimeType)) {
        const text = new TextDecoder().decode(buffer);
        return text.slice(0, maxChars);
    }

    if (isPdf(extension, mimeType)) {
        const pdf = await getDocumentProxy(new Uint8Array(buffer));
        const { text } = await extractText(pdf, { mergePages: true });
        return text.slice(0, maxChars);
    }

    if (isDocx(extension, mimeType)) {
        const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
        return value.slice(0, maxChars);
    }

    return null;
}

export async function extractFileContent(filePath: string, maxChars = 1000): Promise<string | null> {
    const file = Bun.file(filePath);
    const buffer = await file.arrayBuffer();
    return extractFileContentFromBuffer(path.basename(filePath), file.type || null, buffer, maxChars);
}