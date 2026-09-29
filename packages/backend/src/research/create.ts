import { createId } from "@paralleldrive/cuid2";
import type { ResearchInputType, ResearchRunSummary } from "@aihot/contracts/research";
import { sql } from "../db.ts";
import { enqueue, QUEUES } from "../jobs/queue.ts";
import { researchRunDetail } from "./read.ts";

function normalizedInput(type: ResearchInputType, input: string): string {
  const value = input.trim().replace(/\s+/g, " ");
  if (type === "asin") {
    const asin = value.toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) throw Object.assign(new Error("ASIN 必须是 10 位字母或数字"), { statusCode: 400 });
    return asin;
  }
  if (value.length < 2 || value.length > 120) throw Object.assign(new Error("关键词长度需要在 2–120 个字符之间"), { statusCode: 400 });
  return value;
}

export async function createResearchRun(input: { inputType: ResearchInputType; query: string; idempotencyKey: string; actor: string }): Promise<ResearchRunSummary> {
  if (input.inputType !== "keyword" && input.inputType !== "asin") throw Object.assign(new Error("inputType 必须是 keyword 或 asin"), { statusCode: 400 });
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) throw Object.assign(new Error("缺少有效的 Idempotency-Key"), { statusCode: 400 });
  const query = normalizedInput(input.inputType, input.query);
  const idempotencyKey = `${input.actor}:${input.idempotencyKey}`;
  let id = "";
  await sql.begin(async (tx) => {
    const candidate = createId();
    const [created] = await tx<{ id: string }[]>`
      INSERT INTO research_runs (id, input_type, query, original_task, marketplace, created_by, idempotency_key, status, step, progress)
      VALUES (${candidate}, ${input.inputType}, ${query}, ${query}, 'US', ${input.actor}, ${idempotencyKey}, 'queued', 'queued', ${tx.json({ queued: true } as never)})
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`;
    if (created) {
      id = created.id;
      await enqueue(QUEUES.research, { runId: id }, { singletonKey: id }, tx);
      return;
    }
    const [existing] = await tx<{ id: string }[]>`SELECT id FROM research_runs WHERE idempotency_key = ${idempotencyKey}`;
    if (!existing) throw new Error("Research idempotency conflict was not resolved");
    id = existing.id;
  });
  const run = await researchRunDetail(id);
  if (!run) throw new Error("Research run was not created");
  return run;
}
