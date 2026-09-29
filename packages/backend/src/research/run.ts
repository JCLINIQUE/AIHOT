import { z } from "zod";
import type { ResearchEvidence, ResearchProduct, ResearchReport } from "@aihot/contracts/research";
import { sql } from "../db.ts";
import { modelFor } from "../editorial/models.ts";
import { promptText, promptVersion } from "../editorial/prompts.ts";
import { chatJson } from "../providers/llm.ts";
import { callXiyouTool } from "../providers/xiyou-mcp.ts";
import { completeReceipt, rejectReceivedResponse } from "../providers/receipts.ts";
import { emptyProduct, keywordMetrics, keywordProducts, mergeOrders, mergeProductInfo, mergeTraffic } from "./xiyou-data.ts";
import { xiyouRequests } from "./xiyou-requests.ts";
import { supportedFindings, textNumbersSupported } from "./report-validation.ts";

const ReportSchema = z.object({
  title: z.string().min(1).max(120),
  executiveSummary: z.string().min(1).max(800),
  findings: z.array(z.object({ title: z.string().min(1).max(120), explanation: z.string().min(1).max(800), evidenceIds: z.array(z.string()).max(5) })).max(3),
  nextSteps: z.array(z.string().min(1).max(300)).max(2),
  gaps: z.array(z.string().min(1).max(200)).max(6),
  sourceNote: z.string().min(1).max(400),
});

interface RunRow {
  id: string;
  input_type: "keyword" | "asin";
  query: string;
  original_task: string;
  products: ResearchProduct[];
  status: string;
}

interface StoredEvidence {
  evidence_key: string;
  tool: string;
  subject: string;
  asin: string | null;
  metrics: Record<string, unknown>;
  data_window: string | null;
  queried_at: Date;
  source_url: string | null;
}

const TOOL = {
  keywordProducts: "get_keyword_asin_analysis",
  keywordInfo: "get_keyword_info",
  asinInfo: "get_asin_info",
  orders: "get_asin_orders_last_30_days",
  traffic: "get_asin_traffic",
} as const;

async function setState(runId: string, step: string, progress: Record<string, unknown>, products?: ResearchProduct[]) {
  await sql`
    UPDATE research_runs SET status = 'running', step = ${step}, progress = progress || ${sql.json(progress as never)},
      products = coalesce(${products ? sql.json(products as never) : null}::jsonb, products), started_at = coalesce(started_at, now()), updated_at = now(), error = NULL
    WHERE id = ${runId}`;
}

async function storedEvidence(runId: string): Promise<StoredEvidence[]> {
  return sql<StoredEvidence[]>`
    SELECT evidence_key, tool, subject, asin, metrics, data_window, queried_at, source_url
    FROM research_evidence WHERE run_id = ${runId} ORDER BY id`;
}

async function capture(
  run: RunRow,
  tool: string,
  args: Record<string, unknown>,
  opts: { subject: string; dataWindow: string | null; metrics: (response: unknown) => Record<string, unknown>; asin?: string | null; sourceUrl?: string | null },
): Promise<{ response: unknown | null; metrics: Record<string, unknown>; evidenceId: string }> {
  const existing = (await storedEvidence(run.id)).find((item) => item.tool === tool);
  if (existing) return { response: null, metrics: existing.metrics, evidenceId: existing.evidence_key };
  const countRows = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM research_evidence WHERE run_id = ${run.id}`;
  const evidenceId = `E${(countRows[0]?.count ?? 0) + 1}`;
  const called = await callXiyouTool(run.id, tool, args);
  let normalized: Record<string, unknown>;
  try {
    normalized = opts.metrics(called.response);
  } catch (error) {
    await rejectReceivedResponse(called.receiptId, `unusable Xiyou response: ${String(error).slice(0, 500)}`);
    throw error;
  }
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO research_evidence (run_id, evidence_key, provider, tool, subject, asin, request, metrics, data_window, source_url, receipt_id)
      VALUES (${run.id}, ${evidenceId}, 'xiyou', ${tool}, ${opts.subject}, ${opts.asin ?? null}, ${tx.json(args as never)},
              ${tx.json(normalized as never)}, ${opts.dataWindow}, ${opts.sourceUrl ?? null}, ${called.receiptId})`;
    await completeReceipt(tx, called.receiptId);
  });
  return { response: called.response, metrics: normalized, evidenceId };
}

function evidenceForReport(rows: StoredEvidence[]): ResearchEvidence[] {
  return rows.map((row) => {
    return {
      id: row.evidence_key,
      provider: "xiyou",
      tool: row.tool,
      subject: row.subject,
      asin: row.asin,
      metrics: row.metrics ?? {},
      dataWindow: row.data_window,
      queriedAt: row.queried_at.toISOString(),
      sourceUrl: row.source_url,
    };
  });
}

function fallbackReport(run: RunRow, products: ResearchProduct[], evidence: ResearchEvidence[]): ResearchReport {
  const ids = (tool: string) => evidence.filter((item) => item.tool === tool).map((item) => item.id);
  const orders = products.filter((item) => item.orders30d !== null).sort((a, b) => b.orders30d! - a.orders30d!);
  const traffic = products.filter((item) => item.totalTrafficScore7d !== null).sort((a, b) => b.totalTrafficScore7d! - a.totalTrafficScore7d!);
  const findings: ResearchReport["findings"] = [];
  const orderEvidence = ids(TOOL.orders);
  const trafficEvidence = ids(TOOL.traffic).length ? ids(TOOL.traffic) : ids(TOOL.keywordProducts);
  if (orders[0] && orderEvidence.length) findings.push({ title: "近期订单指标最高的样本", explanation: `${orders[0].title ?? orders[0].asin} 的近 30 天订单指标为 ${orders[0].orders30d}。这只代表当前样本，不能外推整个市场。`, evidenceIds: orderEvidence });
  if (traffic[0] && trafficEvidence.length && findings.length < 3) findings.push({ title: "近 7 天流量得分领先的样本", explanation: `${traffic[0].title ?? traffic[0].asin} 的近 7 天总流量得分为 ${traffic[0].totalTrafficScore7d}。流量得分不是访客数。`, evidenceIds: trafficEvidence });
  return {
    title: `${run.query} · Amazon US 商品调研`,
    executiveSummary: `已收集 ${products.length} 个商品样本的可用指标。当前证据适合筛选下一步核查对象，不足以直接形成上架或利润判断。`,
    findings: findings.slice(0, 3),
    nextSteps: ["补充采购、履约、广告和退货成本后再计算利润空间。", "核实 TikTok 商品与内容数据，再判断是否存在跨平台增长。"],
    gaps: ["TikTok 数据尚未接入", "没有评论正文", "没有公司采购与履约成本"],
    sourceNote: "指标来自西柚 MCP 的 Amazon US 数据；不同工具是同一供应商的不同数据维度。",
  };
}

async function generateReport(run: RunRow, products: ResearchProduct[], evidence: ResearchEvidence[]): Promise<{ report: ResearchReport; receiptId: number | null; fallback: boolean }> {
  let receiptId: number | null = null;
  try {
    const result = await chatJson({
      model: await modelFor("research"),
      purpose: "research_brief",
      subject: `research:${run.id}`,
      promptVersion: promptVersion("research-brief"),
      system: promptText("research-brief"),
      user: JSON.stringify({ inputType: run.input_type, query: run.query, marketplace: "US", products, evidence }),
      schema: ReportSchema,
      maxTokens: 1800,
      temperature: 0.2,
    });
    receiptId = result.receiptId;
    const report = result.data as ResearchReport;
    const uncitedProse = [report.title, report.executiveSummary, ...report.nextSteps, ...report.gaps, report.sourceNote].join("\n");
    if (!textNumbersSupported(uncitedProse, evidence)) return { report: fallbackReport(run, products, evidence), receiptId, fallback: true };
    const findings = supportedFindings(report.findings, evidence);
    if (findings.length !== report.findings.length) return { report: fallbackReport(run, products, evidence), receiptId, fallback: true };
    report.findings = findings;
    return { report, receiptId, fallback: false };
  } catch {
    return { report: fallbackReport(run, products, evidence), receiptId, fallback: true };
  }
}

/** Executes the fixed Amazon US MVP workflow. Optional data failures produce a partial report. */
export async function runResearch(runId: string): Promise<{ status: string; products: number; errors: string[] }> {
  const [run] = await sql<RunRow[]>`SELECT id, input_type, query, original_task, products, status FROM research_runs WHERE id = ${runId}`;
  if (!run) return { status: "missing", products: 0, errors: [] };
  if (run.status === "completed" || run.status === "partial") return { status: run.status, products: run.products?.length ?? 0, errors: [] };
  const errors: string[] = [];
  let products = Array.isArray(run.products) ? run.products : [];
  try {
    await setState(run.id, "targets", { targets: "running" });
    if (!products.length && run.input_type === "keyword") {
      const found = await capture(run, TOOL.keywordProducts, xiyouRequests.keywordProducts(run.query), {
        subject: "查询关键词近 7 天的代表竞争商品", dataWindow: "近 7 天", metrics: (response) => ({ products: keywordProducts(response) }),
      });
      products = (found.metrics.products as ResearchProduct[] | undefined) ?? (found.response ? keywordProducts(found.response) : []);
    } else if (!products.length) {
      products = [emptyProduct(run.query)];
    }
    if (!products.length) throw new Error("没有查到相关商品，请换一个更具体的英文关键词");
    await setState(run.id, "metrics", { targets: "done", metrics: "running" }, products);

    const optional = async (label: string, task: () => Promise<void>) => {
      try { await task(); } catch (error) { errors.push(`${label}: ${String(error instanceof Error ? error.message : error).slice(0, 300)}`); }
    };
    if (run.input_type === "keyword") {
      await optional("关键词指标", async () => {
        await capture(run, TOOL.keywordInfo, xiyouRequests.keywordInfo(run.query), { subject: "查询关键词最近一周的市场指标", dataWindow: "最近一周", metrics: keywordMetrics });
      });
    }
    const asins = products.map((item) => item.asin);
    const singleAsin = asins.length === 1 ? asins[0]! : null;
    const singleUrl = singleAsin ? products[0]?.amazonUrl ?? `https://www.amazon.com/dp/${encodeURIComponent(singleAsin)}` : null;
    await optional("商品信息", async () => {
      const result = await capture(run, TOOL.asinInfo, xiyouRequests.asinInfo(asins), { subject: "补齐商品标题、价格、评分和链接", dataWindow: "查询时快照", asin: singleAsin, sourceUrl: singleUrl, metrics: (response) => ({ products: mergeProductInfo(products, response) }) });
      products = (result.metrics.products as ResearchProduct[] | undefined) ?? (result.response ? mergeProductInfo(products, result.response) : products);
      await setState(run.id, "metrics", { productInfo: "done" }, products);
    });
    await optional("订单指标", async () => {
      const result = await capture(run, TOOL.orders, xiyouRequests.orders(asins), { subject: "查询商品近 30 天订单指标", dataWindow: "近 30 天", asin: singleAsin, sourceUrl: singleUrl, metrics: (response) => ({ products: mergeOrders(products, response) }) });
      products = (result.metrics.products as ResearchProduct[] | undefined) ?? (result.response ? mergeOrders(products, result.response) : products);
      await setState(run.id, "metrics", { orders: "done" }, products);
    });
    await optional("流量指标", async () => {
      const result = await capture(run, TOOL.traffic, xiyouRequests.traffic(asins), { subject: "查询商品近 7 天流量得分", dataWindow: "近 7 天", asin: singleAsin, sourceUrl: singleUrl, metrics: (response) => ({ products: mergeTraffic(products, response) }) });
      products = (result.metrics.products as ResearchProduct[] | undefined) ?? (result.response ? mergeTraffic(products, result.response) : products);
      await setState(run.id, "metrics", { traffic: "done" }, products);
    });

    await setState(run.id, "report", { metrics: "done", report: "running", errors }, products);
    const evidence = evidenceForReport(await storedEvidence(run.id));
    if (!evidence.length) throw new Error("未取得任何可用商品指标，请检查 MCP 连接和账号额度");
    const generated = await generateReport(run, products, evidence);
    const status = errors.length || generated.fallback ? "partial" : "completed";
    await sql.begin(async (tx) => {
      await tx`
        UPDATE research_runs SET status = ${status}, step = 'done', products = ${tx.json(products as never)}, report = ${tx.json(generated.report as never)},
          prompt_version = ${promptVersion("research-brief")}, progress = progress || ${tx.json({ report: generated.fallback ? "fallback" : "done", errors } as never)},
          error = ${errors.length ? errors.join("; ").slice(0, 2000) : null}, finished_at = now(), updated_at = now()
        WHERE id = ${run.id}`;
      if (generated.receiptId) await completeReceipt(tx, generated.receiptId);
    });
    return { status, products: products.length, errors };
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 2000);
    await sql`UPDATE research_runs SET status = 'failed', step = 'failed', error = ${message}, progress = progress || ${sql.json({ failed: true } as never)}, finished_at = now(), updated_at = now() WHERE id = ${run.id}`;
    return { status: "failed", products: products.length, errors: [message] };
  }
}
