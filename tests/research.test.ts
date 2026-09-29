import assert from "node:assert/strict";
import test from "node:test";
import { unwrapMcpToolResult } from "@aihot/backend/providers/xiyou-mcp";
import { emptyProduct, keywordMetrics, keywordProducts, mergeOrders, mergeProductInfo, mergeTraffic } from "@aihot/backend/research/xiyou-data";
import { xiyouRequests } from "@aihot/backend/research/xiyou-requests";
import { supportedFindings, textNumbersSupported } from "@aihot/backend/research/report-validation";
import type { ResearchEvidence } from "@aihot/contracts/research";

const response = (data: unknown) => ({ status: 200, cost_credits: 1, data });

test("unwrapMcpToolResult prefers structured content and parses text JSON", () => {
  assert.deepEqual(unwrapMcpToolResult({ structuredContent: { ok: true }, content: [] }), { ok: true });
  assert.deepEqual(unwrapMcpToolResult({ content: [{ type: "text", text: '{"ok":true}' }] }), { ok: true });
});

test("keywordProducts keeps five unique real ASINs in provider order", () => {
  const list = ["B000000001", "B000000002", "B000000001", "B000000003", "B000000004", "B000000005", "B000000006"].map((asin, index) => ({
    asin,
    asinInfo: { asin, title: `Product ${index}`, amazonUrl: `https://www.amazon.com/dp/${asin}`, price: 20 + index, currency: "USD", stars: 4.2, ratings: 10 + index, picUrl: "https://example.com/a.jpg" },
    trafficSummary: { traffic: { total: 100 - index, totalGrowthRate: "0.1" } },
  }));
  const products = keywordProducts(response({ list }));
  assert.deepEqual(products.map((item) => item.asin), ["B000000001", "B000000002", "B000000003", "B000000004", "B000000005"]);
  assert.equal(products[0]?.totalTrafficScore7d, 100);
  assert.equal(keywordProducts({ list }).length, 5, "direct structuredContent is accepted too");
});

test("product enrichment preserves missing values and rejects non-finite strings", () => {
  let products = [emptyProduct("B000000001"), emptyProduct("B000000002")];
  products = mergeProductInfo(products, response({ entities: [
    { asin: "B000000001", title: "One", price: "19.99", currency: "USD", stars: "4.4", ratings: 88, amazonUrl: "https://www.amazon.com/dp/B000000001" },
    { asin: "B000000002", title: "Two", price: "NaN", currency: "USD", stars: null, ratings: null },
  ] }));
  products = mergeOrders(products, response({ entities: [{ asin: "B000000001", orders: 123 }] }));
  products = mergeTraffic(products, response({ entities: [{ asin: "B000000001", totalTrafficScore: 456, totalTrafficScoreGrowthRate: 0.25 }] }));
  assert.deepEqual([products[0]?.price, products[0]?.orders30d, products[0]?.totalTrafficScore7d, products[0]?.trafficGrowthRate7d], [19.99, 123, 456, 0.25]);
  assert.equal(products[1]?.price, null);
  assert.equal(products[1]?.orders30d, null);
});

test("keywordMetrics preserves the supplied data window", () => {
  assert.deepEqual(keywordMetrics(response({ list: [{
    searchTerm: "portable blender",
    abaReport: { weeklySearchVolume: 1200, searchFrequencyRank: 321, reportFromDate: "2026-09-13", reportToDate: "2026-09-19" },
    competitiveDifficulty: 57,
    clickConversionRate: "0.12",
    costPerClick: { value: "1.35" },
  }] })), {
    searchTerm: "portable blender",
    weeklySearchVolume: 1200,
    searchFrequencyRank: 321,
    reportFromDate: "2026-09-13",
    reportToDate: "2026-09-19",
    competitiveDifficulty: 57,
    clickConversionRate: 0.12,
    costPerClick: 1.35,
  });
});

test("XYDC requests match the five live MCP input shapes", () => {
  const asins = ["B000000001", "B000000002"];
  assert.deepEqual(xiyouRequests.keywordProducts("portable blender"), {
    searchTerm: "portable blender",
    country: "US",
    page: 1,
    pageSize: 5,
    period: "last7days",
    sort: { field: "traffic", order: "desc" },
  });
  assert.deepEqual(xiyouRequests.keywordInfo("portable blender"), { country: "US", searchTerms: ["portable blender"] });
  assert.deepEqual(xiyouRequests.asinInfo(asins), { entities: asins.map((asin) => ({ country: "US", asin })) });
  assert.deepEqual(xiyouRequests.orders(asins), { asins, country: "US" });
  assert.deepEqual(xiyouRequests.traffic(asins), { entities: asins.map((asin) => ({ country: "US", asin })) });
});

test("report findings require real citations and numbers copied from cited evidence", () => {
  const evidence: ResearchEvidence[] = [{
    id: "E1",
    provider: "xiyou",
    tool: "get_asin_orders_last_30_days",
    subject: "orders",
    asin: null,
    metrics: { products: [{ asin: "B000000001", orders30d: 123 }] },
    dataWindow: "近 30 天",
    queriedAt: "2026-09-29T00:00:00.000Z",
    sourceUrl: null,
  }];
  const accepted = supportedFindings([
    { title: "订单样本", explanation: "B000000001 的订单指标为 123。", evidenceIds: ["E1"] },
    { title: "虚构数字", explanation: "订单指标为 999。", evidenceIds: ["E1"] },
    { title: "不存在的引用", explanation: "没有数字。", evidenceIds: ["E9"] },
  ], evidence);
  assert.deepEqual(accepted.map((item) => item.title), ["订单样本"]);
  assert.equal(textNumbersSupported("样本订单指标为 123，窗口为 30 天。", evidence), true);
  assert.equal(textNumbersSupported("样本订单指标为 999。", evidence), false);
});
