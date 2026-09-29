import { stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { createResearchRun } from "@aihot/backend/research/create";
import { runResearch } from "@aihot/backend/research/run";

const raw = (data: unknown) => ({ status: 200, cost_credits: 1, data });
const calledTools: string[] = [];
const authHeaders: Array<string | undefined> = [];
const provider = await stub((_hit, request) => {
  authHeaders.push(request.headers.authorization);
  const rpc = JSON.parse(request.body) as { id?: number; method?: string; params?: { name?: string } };
  if (rpc.method === "initialize") return { jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "test", version: "1" } } };
  if (rpc.method === "notifications/initialized") return {};
  const name = rpc.params?.name ?? "";
  calledTools.push(name);
  const data = name === "get_keyword_asin_analysis"
    ? raw({ list: [
      { asin: "B000000001", asinInfo: { asin: "B000000001", title: "One", price: 19.99, currency: "USD", stars: 4.4, ratings: 80 }, trafficSummary: { traffic: { total: 500, totalGrowthRate: "0.1" } } },
      { asin: "B000000002", asinInfo: { asin: "B000000002", title: "Two", price: 24.99, currency: "USD", stars: 4.2, ratings: 60 }, trafficSummary: { traffic: { total: 300, totalGrowthRate: "-0.1" } } },
    ] })
    : name === "get_keyword_info"
      ? raw({ list: [{ searchTerm: "portable blender", abaReport: { weeklySearchVolume: 1200, searchFrequencyRank: 321, reportFromDate: "2026-09-13", reportToDate: "2026-09-19" }, competitiveDifficulty: 57, clickConversionRate: "0.12", costPerClick: { value: "1.35" } }] })
      : name === "get_asin_info"
        ? raw({ entities: [
          { asin: "B000000001", title: "One", amazonUrl: "https://www.amazon.com/dp/B000000001", price: "19.99", currency: "USD", stars: "4.4", ratings: 80 },
          { asin: "B000000002", title: "Two", amazonUrl: "https://www.amazon.com/dp/B000000002", price: "24.99", currency: "USD", stars: "4.2", ratings: 60 },
        ] })
        : name === "get_asin_orders_last_30_days"
          ? raw({ entities: [{ asin: "B000000001", orders: 123 }, { asin: "B000000002", orders: 75 }] })
          : raw({ entities: [
            { asin: "B000000001", totalTrafficScore: 500, totalTrafficScoreGrowthRate: 0.1 },
            { asin: "B000000002", totalTrafficScore: 300, totalTrafficScoreGrowthRate: -0.1 },
          ] });
  return { jsonrpc: "2.0", id: rpc.id, result: { structuredContent: data } };
});

process.env.XIYOU_MCP_URL = provider.url;
process.env.XIYOU_MCP_TOKEN = "test-token";

after(async () => {
  await stopBoss();
  await provider.close();
  await closeDb();
});

test("creating the same research command twice returns one run", async () => {
  const suffix = tag();
  const input = { inputType: "asin" as const, query: "b000000001", idempotencyKey: suffix, actor: "test" };
  const first = await createResearchRun(input);
  const second = await createResearchRun(input);
  assert.equal(second.id, first.id);
  assert.equal(first.query, "B000000001");
  const [count] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM research_runs WHERE idempotency_key = ${`test:${suffix}`}`;
  assert.equal(count?.count, 1);
  await sql`DELETE FROM pgboss.job WHERE data->>'runId' = ${first.id}`;
  await sql`DELETE FROM research_runs WHERE id = ${first.id}`;
});

test("a keyword research run saves five evidence steps and reopens without another paid call", async () => {
  const suffix = tag();
  const runId = `research-${suffix}`;
  const subject = `research:${runId}`;
  await sql`
    INSERT INTO research_runs (id, input_type, query, original_task, marketplace, created_by, idempotency_key)
    VALUES (${runId}, 'keyword', 'portable blender', 'portable blender', 'US', 'test', ${`test:${suffix}`})`;
  const before = provider.hits();
  const modelCalls = config.modelCallsEnabled;
  config.modelCallsEnabled = false;
  try {
    const result = await runResearch(runId);
    assert.equal(result.status, "partial", "the deterministic fallback marks the report partial");
    assert.equal(result.products, 2);
    assert.ok(authHeaders.every((value) => value === "Bearer test-token"));
    assert.deepEqual(calledTools, [
      "get_keyword_asin_analysis",
      "get_keyword_info",
      "get_asin_info",
      "get_asin_orders_last_30_days",
      "get_asin_traffic",
    ]);
    assert.equal(provider.hits() - before, 15, "each tool uses initialize, initialized and tools/call");

    const [stored] = await sql<{ evidence: number; products: unknown[]; report: { findings: unknown[] } }[]>`
      SELECT (SELECT count(*)::int FROM research_evidence WHERE run_id = r.id) AS evidence, products, report
      FROM research_runs r WHERE id = ${runId}`;
    assert.equal(stored?.evidence, 5);
    assert.equal(stored?.products.length, 2);
    assert.ok(stored?.report.findings.length);
    const receipts = await sql<{ status: string; request: unknown }[]>`SELECT status, request FROM receipts WHERE subject = ${subject} ORDER BY id`;
    assert.deepEqual(receipts.map((row) => row.status), ["completed", "completed", "completed", "completed", "completed"]);
    assert.ok(receipts.every((row) => !JSON.stringify(row.request).includes("test-token")), "the bearer token is not persisted");

    const hits = provider.hits();
    const reopened = await runResearch(runId);
    assert.equal(reopened.status, "partial");
    assert.equal(provider.hits(), hits, "opening a completed report never calls the provider");
  } finally {
    config.modelCallsEnabled = modelCalls;
    await sql`DELETE FROM research_runs WHERE id = ${runId}`;
    await sql`DELETE FROM receipts WHERE subject = ${subject}`;
  }
});
