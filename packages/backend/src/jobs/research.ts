import type { PgBoss } from "pg-boss";
import { runResearch } from "../research/run.ts";
import { ensureQueue, QUEUES } from "./queue.ts";

export async function registerResearchJobs(boss: PgBoss) {
  await ensureQueue(QUEUES.research);
  await boss.work<{ runId: string }>(QUEUES.research, { localConcurrency: 2, pollingIntervalSeconds: 2 }, async ([job]) => {
    if (!job) return;
    return runResearch(job.data.runId);
  });
}
