import type { ResearchProduct } from "@aihot/contracts/research";

type AnyRecord = Record<string, unknown>;

function record(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {};
}

function finite(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The Xiyou tools return {status, cost_credits, data}; tool errors are kept out of evidence. */
export function xiyouData(response: unknown): AnyRecord {
  const outer = record(response);
  // Direct MCP deployments may expose either the OpenAPI envelope or its `data` member as
  // structuredContent. Accept both without guessing alternate field names inside the payload.
  const payload = Object.hasOwn(outer, "data") ? record(outer.data) : outer;
  if (payload.error === true) throw new Error(string(payload.message) ?? "Xiyou returned an error");
  const status = finite(outer.status);
  if (status !== null && status >= 400) throw new Error(string(payload.message) ?? `Xiyou status ${status}`);
  return payload;
}

export function emptyProduct(asin: string): ResearchProduct {
  return {
    asin,
    title: null,
    amazonUrl: `https://www.amazon.com/dp/${encodeURIComponent(asin)}`,
    imageUrl: null,
    price: null,
    currency: null,
    stars: null,
    ratings: null,
    orders30d: null,
    totalTrafficScore7d: null,
    trafficGrowthRate7d: null,
  };
}

export function keywordProducts(response: unknown): ResearchProduct[] {
  const list = xiyouData(response).list;
  if (!Array.isArray(list)) return [];
  const products = new Map<string, ResearchProduct>();
  for (const itemValue of list) {
    const item = record(itemValue);
    const info = record(item.asinInfo);
    const asin = (string(item.asin) ?? string(info.asin))?.toUpperCase();
    if (!asin || products.has(asin)) continue;
    const traffic = record(record(item.trafficSummary).traffic);
    products.set(asin, {
      ...emptyProduct(asin),
      title: string(info.title),
      amazonUrl: string(info.amazonUrl) ?? `https://www.amazon.com/dp/${encodeURIComponent(asin)}`,
      imageUrl: string(info.picUrl),
      price: finite(info.price),
      currency: string(info.currency),
      stars: finite(info.stars),
      ratings: finite(info.ratings),
      totalTrafficScore7d: finite(traffic.total),
      trafficGrowthRate7d: finite(traffic.totalGrowthRate),
    });
    if (products.size === 5) break;
  }
  return [...products.values()];
}

export function mergeProductInfo(products: ResearchProduct[], response: unknown): ResearchProduct[] {
  const entities = xiyouData(response).entities;
  if (!Array.isArray(entities)) return products;
  const byAsin = new Map(entities.map((value) => {
    const item = record(value);
    return [string(item.asin)?.toUpperCase(), item] as const;
  }));
  return products.map((product) => {
    const item = byAsin.get(product.asin);
    if (!item) return product;
    return {
      ...product,
      title: string(item.title) ?? product.title,
      amazonUrl: string(item.amazonUrl) ?? product.amazonUrl,
      imageUrl: string(item.bigPicUrl) ?? string(item.smallPicUrl) ?? product.imageUrl,
      price: finite(item.price) ?? product.price,
      currency: string(item.currency) ?? product.currency,
      stars: finite(item.stars) ?? product.stars,
      ratings: finite(item.ratings) ?? product.ratings,
    };
  });
}

export function mergeOrders(products: ResearchProduct[], response: unknown): ResearchProduct[] {
  const entities = xiyouData(response).entities;
  if (!Array.isArray(entities)) return products;
  const byAsin = new Map(entities.map((value) => {
    const item = record(value);
    return [string(item.asin)?.toUpperCase(), finite(item.orders)] as const;
  }));
  return products.map((product) => ({ ...product, orders30d: byAsin.get(product.asin) ?? product.orders30d }));
}

export function mergeTraffic(products: ResearchProduct[], response: unknown): ResearchProduct[] {
  const entities = xiyouData(response).entities;
  if (!Array.isArray(entities)) return products;
  const byAsin = new Map(entities.map((value) => {
    const item = record(value);
    return [string(item.asin)?.toUpperCase(), item] as const;
  }));
  return products.map((product) => {
    const item = byAsin.get(product.asin);
    return item ? {
      ...product,
      totalTrafficScore7d: finite(item.totalTrafficScore) ?? product.totalTrafficScore7d,
      trafficGrowthRate7d: finite(item.totalTrafficScoreGrowthRate) ?? product.trafficGrowthRate7d,
    } : product;
  });
}

export function keywordMetrics(response: unknown): Record<string, unknown> {
  const list = xiyouData(response).list;
  const item = Array.isArray(list) ? record(list[0]) : {};
  const aba = record(item.abaReport);
  const cpc = record(item.costPerClick);
  return {
    searchTerm: string(item.searchTerm),
    weeklySearchVolume: finite(aba.weeklySearchVolume),
    searchFrequencyRank: finite(aba.searchFrequencyRank),
    reportFromDate: string(aba.reportFromDate),
    reportToDate: string(aba.reportToDate),
    competitiveDifficulty: finite(item.competitiveDifficulty),
    clickConversionRate: finite(item.clickConversionRate),
    costPerClick: finite(cpc.value),
  };
}
