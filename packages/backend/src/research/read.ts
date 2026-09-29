import type { ResearchEvidence, ResearchReport, ResearchRunDetail, ResearchRunSummary } from "@aihot/contracts/research";
import { sql } from "../db.ts";

interface RunRow {
  id: string;
  input_type: "keyword" | "asin";
  query: string;
  original_task: string;
  marketplace: "US";
  status: ResearchRunSummary["status"];
  step: string | null;
  progress: Record<string, unknown>;
  products: ResearchRunDetail["products"];
  report: ResearchReport | null;
  created_by: string;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  error: string | null;
}

function summary(row: RunRow): ResearchRunSummary {
  return {
    id: row.id,
    inputType: row.input_type,
    query: row.query,
    marketplace: row.marketplace,
    status: row.status,
    step: row.step,
    productCount: Array.isArray(row.products) ? row.products.length : 0,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    error: row.error,
  };
}

export async function listResearchRuns(page = 1): Promise<{ page: number; hasMore: boolean; rows: ResearchRunSummary[] }> {
  const limit = 30;
  const rows = await sql<RunRow[]>`
    SELECT id, input_type, query, original_task, marketplace, status, step, progress, products, report,
           created_by, created_at, started_at, finished_at, error
    FROM research_runs ORDER BY created_at DESC LIMIT ${limit + 1} OFFSET ${(Math.max(1, page) - 1) * limit}`;
  return { page: Math.max(1, page), hasMore: rows.length > limit, rows: rows.slice(0, limit).map(summary) };
}

export async function researchRunDetail(id: string): Promise<ResearchRunDetail | null> {
  const [row] = await sql<RunRow[]>`
    SELECT id, input_type, query, original_task, marketplace, status, step, progress, products, report,
           created_by, created_at, started_at, finished_at, error
    FROM research_runs WHERE id = ${id}`;
  if (!row) return null;
  const evidenceRows = await sql<{
    evidence_key: string; provider: "xiyou"; tool: string; subject: string; asin: string | null;
    metrics: Record<string, unknown>; data_window: string | null; queried_at: Date; source_url: string | null;
  }[]>`
    SELECT evidence_key, provider, tool, subject, asin, metrics, data_window, queried_at, source_url
    FROM research_evidence WHERE run_id = ${id} ORDER BY id`;
  const evidence: ResearchEvidence[] = evidenceRows.map((item) => ({
    id: item.evidence_key,
    provider: item.provider,
    tool: item.tool,
    subject: item.subject,
    asin: item.asin,
    metrics: item.metrics,
    dataWindow: item.data_window,
    queriedAt: item.queried_at.toISOString(),
    sourceUrl: item.source_url,
  }));
  return { ...summary(row), originalTask: row.original_task, progress: row.progress ?? {}, products: row.products ?? [], report: row.report, evidence };
}
