import { finishJobRun, startJobRun } from "../db/db";

export interface JobRunOutcome {
    processedCount: number;
    status?: "succeeded" | "failed" | "skipped";
    error?: string;
}

export async function runTrackedJob(
    jobId: string,
    action: () => Promise<JobRunOutcome | void>
): Promise<void> {
    const runId = startJobRun(jobId);

    try {
        const outcome = await action();
        finishJobRun(
            runId,
            outcome?.status ?? "succeeded",
            outcome?.processedCount ?? 0,
            outcome?.error
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        finishJobRun(runId, "failed", 0, message);
        throw error;
    }
}
