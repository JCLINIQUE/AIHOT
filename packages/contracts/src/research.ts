export type ResearchInputType = "keyword" | "asin";
export type ResearchRunStatus = "queued" | "running" | "completed" | "partial" | "failed";

export interface ResearchProduct {
  asin: string;
  title: string | null;
  amazonUrl: string | null;
  imageUrl: string | null;
  price: number | null;
  currency: string | null;
  stars: number | null;
  ratings: number | null;
  orders30d: number | null;
  totalTrafficScore7d: number | null;
  trafficGrowthRate7d: number | null;
}

export interface ResearchFinding {
  title: string;
  explanation: string;
  evidenceIds: string[];
}

export interface ResearchReport {
  title: string;
  executiveSummary: string;
  findings: ResearchFinding[];
  nextSteps: string[];
  gaps: string[];
  sourceNote: string;
}

export interface ResearchEvidence {
  id: string;
  provider: "xiyou";
  tool: string;
  subject: string;
  asin: string | null;
  metrics: Record<string, unknown>;
  dataWindow: string | null;
  queriedAt: string;
  sourceUrl: string | null;
}

export interface ResearchRunSummary {
  id: string;
  inputType: ResearchInputType;
  query: string;
  marketplace: "US";
  status: ResearchRunStatus;
  step: string | null;
  productCount: number;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

export interface ResearchRunDetail extends ResearchRunSummary {
  originalTask: string;
  progress: Record<string, unknown>;
  products: ResearchProduct[];
  report: ResearchReport | null;
  evidence: ResearchEvidence[];
}
