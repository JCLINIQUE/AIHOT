/**
 * Stable request builders for the five XYDC tools used by the MVP. Keep these field names aligned
 * with the live MCP schemas; the underlying OpenAPI uses different shapes for product info/traffic
 * (`entities`) and recent orders (`asins` + `country`).
 */
export const xiyouRequests = {
  keywordProducts(searchTerm: string): Record<string, unknown> {
    return {
      searchTerm,
      country: "US",
      page: 1,
      pageSize: 5,
      period: "last7days",
      sort: { field: "traffic", order: "desc" },
    };
  },

  keywordInfo(searchTerm: string): Record<string, unknown> {
    return { country: "US", searchTerms: [searchTerm] };
  },

  asinInfo(asins: string[]): Record<string, unknown> {
    return { entities: asins.map((asin) => ({ country: "US", asin })) };
  },

  orders(asins: string[]): Record<string, unknown> {
    return { asins, country: "US" };
  },

  traffic(asins: string[]): Record<string, unknown> {
    return { entities: asins.map((asin) => ({ country: "US", asin })) };
  },
};
