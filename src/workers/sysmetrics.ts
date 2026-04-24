/**
 * System Metrics Worker
 * Collects CPU, RAM, disk, GPU, and Ollama model data every 5 minutes.
 * Stores a summary event in SQLite and caches the latest snapshot in memory.
 */

import si from "systeminformation";
import { logEvent } from "../db/db";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://host.docker.internal:11434";

export interface DiskInfo {
    mount: string;
    used: number;
    size: number;
    use: number; // percent
}

export interface GpuInfo {
    utilization: number;   // %
    temperature: number;   // °C
    memUsed: number;       // MiB
    memTotal: number;      // MiB
    memUse: number;        // %
    powerDraw: number;     // W
    fanSpeed: number;      // %
}

export interface OllamaModel {
    name: string;
    size: number;          // bytes
    processor: string;
    vram: number;          // bytes
}

export interface SystemSnapshot {
    collectedAt: number;
    cpu: { load: number };
    ram: { used: number; total: number; use: number };
    disks: DiskInfo[];
    gpu: GpuInfo | null;
    ollama: OllamaModel[];
}

let lastSnapshot: SystemSnapshot | null = null;

export function getLastSnapshot(): SystemSnapshot | null {
    return lastSnapshot;
}

async function collectCpu(): Promise<{ load: number }> {
    const load = await si.currentLoad();
    return { load: parseFloat(load.currentLoad.toFixed(1)) };
}

async function collectRam(): Promise<{ used: number; total: number; use: number }> {
    const mem = await si.mem();
    const use = mem.total > 0 ? parseFloat(((mem.active / mem.total) * 100).toFixed(1)) : 0;
    return { used: mem.active, total: mem.total, use };
}

async function collectDisks(): Promise<DiskInfo[]> {
    const targets = ["/", "/mnt/world"];
    const all = await si.fsSize();
    return targets
        .map(mount => all.find(d => d.mount === mount))
        .filter((d): d is si.Systeminformation.FsSizeData => d !== undefined)
        .map(d => ({
            mount: d.mount,
            used: d.used,
            size: d.size,
            use: parseFloat(d.use.toFixed(1))
        }));
}

export function collectGpu(): GpuInfo | null {
    try {
        const proc = Bun.spawnSync([
            "nvidia-smi",
            "--query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw,fan.speed",
            "--format=csv,noheader,nounits"
        ]);
        if (proc.exitCode !== 0) return null;
        const line = new TextDecoder().decode(proc.stdout).trim();
        const parts = line.split(",").map(s => parseFloat(s.trim()));
        if (parts.length < 6 || parts.some(isNaN)) return null;
        const [utilization, temperature, memUsed, memTotal, powerDraw, fanSpeed] = parts;
        const memUse = memTotal > 0 ? parseFloat(((memUsed / memTotal) * 100).toFixed(1)) : 0;
        return { utilization, temperature, memUsed, memTotal, memUse, powerDraw, fanSpeed };
    } catch {
        return null;
    }
}

async function collectOllama(): Promise<OllamaModel[]> {
    try {
        const res = await fetch(`${OLLAMA_HOST}/api/ps`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return [];
        const data = await res.json() as { models?: { name: string; size: number; details?: { processor?: string }; size_vram?: number }[] };
        return (data.models ?? []).map(m => ({
            name: m.name,
            size: m.size ?? 0,
            // Ollama doesn't expose a 'processor' field — derive from whether VRAM = total size
            processor: (m.size_vram ?? 0) >= (m.size ?? 1) ? "100% GPU" : (m.size_vram ?? 0) > 0 ? "GPU+CPU" : "100% CPU",
            vram: m.size_vram ?? 0
        }));
    } catch {
        return [];
    }
}

/** Collect a fresh snapshot without logging to SQLite. */
export async function collectSnapshot(): Promise<SystemSnapshot> {
    const [cpu, ram, disks, ollama] = await Promise.all([
        collectCpu(),
        collectRam(),
        collectDisks(),
        collectOllama()
    ]);
    const gpu = collectGpu();
    return { collectedAt: Date.now(), cpu, ram, disks, gpu, ollama };
}

export async function logSystemMetrics(): Promise<void> {
    try {
        const snapshot = await collectSnapshot();
        lastSnapshot = snapshot;
        const { cpu, ram, gpu, ollama } = snapshot;
        logEvent("system_metrics", "info", {
            cpu_load: cpu.load,
            ram_use: ram.use,
            gpu_load: gpu?.utilization ?? null,
            gpu_vram_use: gpu?.memUse ?? null,
            ollama_models: ollama.map(m => m.name)
        });
    } catch (err) {
        logEvent("system_metrics", "error", { error: String(err) });
    }
}
