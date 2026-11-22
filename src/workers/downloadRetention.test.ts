import { afterAll, afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cleanupDownloads, logDownloadCleanup } from "./downloadRetention";

const directory = mkdtempSync(path.join(tmpdir(), "gopher-download-retention-"));
afterEach(() => {
    for (const entry of readdirSync(directory)) rmSync(path.join(directory, entry), { recursive: true, force: true });
});
afterAll(() => rmdirSync(directory));

function file(name: string): void {
    writeFileSync(path.join(directory, name), "test");
}

test("removes only matching valid downloads older than the 30-day UTC cutoff", () => {
    const names = [
        "feedbin_starred_2026-10-21.json",
        "feedbin_starred_2026-10-22.json",
        "feedbin_starred_2026-11-21.json",
        "feedbin_starred_2026-02-30.json",
        "feedbin_starred_2026-01-01.json.bak",
        "pinboard_popular_2026-01-01.json",
        "gopher.sqlite",
    ];
    names.forEach(file);
    mkdirSync(path.join(directory, "feedbin_starred_2026-01-01.json"));
    symlinkSync(path.join(directory, "gopher.sqlite"), path.join(directory, "feedbin_starred_2026-01-02.json"));

    expect(cleanupDownloads(directory, "feedbin", new Date("2026-11-21T23:59:00Z"))).toEqual({ removed: 1, errors: [] });
    expect(existsSync(path.join(directory, names[0]))).toBe(false);
    for (const name of names.slice(1)) expect(existsSync(path.join(directory, name))).toBe(true);
    expect(existsSync(path.join(directory, "feedbin_starred_2026-01-01.json"))).toBe(true);
    expect(existsSync(path.join(directory, "feedbin_starred_2026-01-02.json"))).toBe(true);
});

test("pinboard cleanup does not remove feedbin files", () => {
    file("pinboard_popular_2026-10-21.json");
    file("feedbin_starred_2026-10-21.json");
    expect(cleanupDownloads(directory, "popular", new Date("2026-11-21T00:00:00Z")).removed).toBe(1);
    expect(existsSync(path.join(directory, "feedbin_starred_2026-10-21.json"))).toBe(true);
});

test("cleanup errors are reported without interrupting the worker", () => {
    const events: { status: string; details?: Record<string, unknown> }[] = [];
    logDownloadCleanup(path.join(directory, "missing"), "feedbin", (_type, status, details) => events.push({ status, details }));
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("error");
    expect(events[0].details?.errors).toBeArray();
});
