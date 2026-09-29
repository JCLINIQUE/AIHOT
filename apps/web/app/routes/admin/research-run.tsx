import { SITE } from "@aihot/industry/site";
import type { ResearchEvidence, ResearchRunDetail } from "@aihot/contracts/research";
import { useEffect } from "react";
import { Link, useRevalidator } from "react-router";
import type { Route } from "./+types/research-run";
import { adminGet } from "../../lib/admin.server";
import { bj, money, num, pct } from "../../features/admin/format";
import { AdminPage, Badge, ButtonLink, Card, DataTable, Json, KV } from "../../features/admin/ui";

export async function loader({ request, params }: Route.LoaderArgs) {
  return adminGet<ResearchRunDetail>(request, `/api/admin/research-runs/${encodeURIComponent(params.runId)}`);
}

export const meta: Route.MetaFunction = ({ loaderData }) => [{ title: `${loaderData?.query ?? "商品调研"} · ${SITE.name} 后台` }];

const statusLabel: Record<string, string> = { queued: "排队中", running: "进行中", completed: "已完成", partial: "部分完成", failed: "失败" };
const statusTone = (status: string) => status === "completed" ? "ok" : status === "failed" ? "bad" : status === "partial" ? "warn" : "accent";

function metric(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return num(value, Number.isInteger(value) ? 0 : 2);
  return String(value);
}

function Evidence({ evidence }: { evidence: ResearchEvidence }) {
  return (
    <details id={`evidence-${evidence.id}`} className="scroll-mt-24 rounded-control bg-bg-sunk/65 ring-1 ring-line">
      <summary className="cursor-pointer px-3 py-2.5 text-[13px] font-medium text-ink">
        [{evidence.id}] {evidence.subject}
      </summary>
      <div className="space-y-3 border-t border-line px-3 py-3">
        <KV items={[
          ["来源", "西柚 MCP / Amazon US"],
          ["数据窗口", evidence.dataWindow ?? "未披露"],
          ["查询时间", bj(evidence.queriedAt, true)],
          ["商品", evidence.asin ?? "多个商品或关键词"],
          ["原商品页", evidence.sourceUrl ? <a className="text-accent" href={evidence.sourceUrl} target="_blank" rel="noreferrer">打开 Amazon</a> : "—"],
        ]} />
        <Json value={evidence.metrics} collapsed={false} label="保存的指标快照" />
      </div>
    </details>
  );
}

export default function ResearchRun({ loaderData: run }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  const active = run.status === "queued" || run.status === "running";
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => revalidator.revalidate(), 3000);
    return () => window.clearInterval(timer);
  }, [active, revalidator]);

  return (
    <AdminPage
      title={run.report?.title ?? run.query}
      subtitle={`${run.inputType === "asin" ? "ASIN" : "关键词"} · Amazon US · 创建于 ${bj(run.createdAt, true)}`}
      actions={<><Badge tone={statusTone(run.status)}>{statusLabel[run.status] ?? run.status}</Badge><ButtonLink to="/admin/research">返回调研</ButtonLink></>}
    >
      {active && (
        <Card className="mb-5" title="正在调研">
          <div className="flex items-center gap-3 text-[13px] text-ink-2"><span className="size-4 animate-spin rounded-full border-2 border-accent border-r-transparent" /><span>当前阶段：{run.step ?? "排队"}。页面会自动更新，离开后任务仍会继续。</span></div>
        </Card>
      )}
      {run.status === "failed" && (
        <Card className="mb-5" title="调研失败"><p className="text-[13px] text-hot">{run.error ?? "未能取得商品数据"}</p></Card>
      )}
      {run.status === "partial" && (
        <Card className="mb-5" title="部分完成"><p className="text-[13px] text-amber">部分数据或模型步骤未完成；现有指标与证据已保留。{run.error ? ` ${run.error}` : ""}</p></Card>
      )}

      {run.report && (
        <div className="mb-6 space-y-5">
          <Card title="结论"><p className="text-[15px] leading-7 text-ink">{run.report.executiveSummary}</p></Card>
          {run.report.findings.length > 0 && (
            <Card title="主要发现">
              <div className="space-y-4">
                {run.report.findings.map((finding, index) => (
                  <div key={`${finding.title}-${index}`} className="border-b border-line pb-4 last:border-0 last:pb-0">
                    <h3 className="text-[14px] font-semibold text-ink">{finding.title}</h3>
                    <p className="mt-1 text-[13.5px] leading-6 text-ink-2">{finding.explanation}</p>
                    <div className="mt-1.5 flex gap-2 text-[12px]">{finding.evidenceIds.map((id) => <a key={id} href={`#evidence-${id}`} className="text-accent">[{id}]</a>)}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {run.products.length > 0 && (
        <Card className="mb-6" title="商品对比" right={<span>订单：近 30 天 · 流量得分：近 7 天</span>} pad={false}>
          <DataTable
            rows={run.products}
            rowKey={(product) => product.asin}
            columns={[
              { key: "product", label: "商品", render: (product) => <div className="min-w-[300px]"><div className="font-medium text-ink">{product.title ?? product.asin}</div><div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-ink-4"><span className="font-mono">{product.asin}</span>{product.amazonUrl && <a href={product.amazonUrl} target="_blank" rel="noreferrer" className="text-accent">Amazon</a>}</div></div> },
              { key: "price", label: "价格", align: "right", render: (product) => product.price === null ? "—" : money(product.price, product.currency ?? "USD") },
              { key: "rating", label: "评分", align: "right", render: (product) => product.stars === null ? "—" : `${num(product.stars, 1)} / ${num(product.ratings)}` },
              { key: "orders", label: "订单指标", align: "right", render: (product) => metric(product.orders30d) },
              { key: "traffic", label: "流量得分", align: "right", render: (product) => metric(product.totalTrafficScore7d) },
              { key: "growth", label: "流量变化", align: "right", render: (product) => product.trafficGrowthRate7d === null ? "—" : pct(product.trafficGrowthRate7d) },
            ]}
          />
        </Card>
      )}

      {run.report && (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <Card title="下一步验证"><ol className="list-decimal space-y-2 pl-5 text-[13.5px] leading-6 text-ink-2">{run.report.nextSteps.map((item) => <li key={item}>{item}</li>)}</ol></Card>
          <Card title="证据缺口"><ul className="list-disc space-y-2 pl-5 text-[13.5px] leading-6 text-ink-2">{run.report.gaps.map((item) => <li key={item}>{item}</li>)}</ul></Card>
        </div>
      )}

      {run.evidence.length > 0 && (
        <Card title="证据清单" right={<span>{run.report?.sourceNote ?? "保存的内部快照"}</span>}>
          <div className="space-y-3">{run.evidence.map((evidence) => <Evidence key={evidence.id} evidence={evidence} />)}</div>
        </Card>
      )}
      {!active && !run.report && run.status !== "failed" && <p className="text-[13px] text-ink-3">还没有生成报告。</p>}
    </AdminPage>
  );
}
