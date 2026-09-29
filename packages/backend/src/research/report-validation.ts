import type { ResearchEvidence, ResearchFinding } from "@aihot/contracts/research";

const NUMBER = /-?\d+(?:\.\d+)?/g;

function tokens(value: unknown): Set<string> {
  return new Set((JSON.stringify(value).match(NUMBER) ?? []).map((item) => Number(item).toString()));
}

function evidenceTokens(evidence: ResearchEvidence[]): Set<string> {
  return tokens(evidence.map((item) => ({ subject: item.subject, metrics: item.metrics, dataWindow: item.dataWindow })));
}

export function textNumbersSupported(text: string, evidence: ResearchEvidence[]): boolean {
  const supported = evidenceTokens(evidence);
  return [...tokens(text)].every((number) => supported.has(number));
}

/** Keeps only findings whose citations exist and whose written numbers occur in the cited evidence. */
export function supportedFindings(findings: ResearchFinding[], evidence: ResearchEvidence[]): ResearchFinding[] {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  return findings.filter((finding) => {
    if (!finding.evidenceIds.length || finding.evidenceIds.some((id) => !byId.has(id))) return false;
    const cited = finding.evidenceIds.map((id) => {
      const item = byId.get(id)!;
      return { subject: item.subject, metrics: item.metrics, dataWindow: item.dataWindow };
    });
    const supported = tokens(cited);
    const claimed = tokens(`${finding.title}\n${finding.explanation}`);
    return [...claimed].every((number) => supported.has(number));
  });
}
