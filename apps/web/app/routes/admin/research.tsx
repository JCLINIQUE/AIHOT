import { SITE } from "@aihot/industry/site";
import type { ResearchInputType, ResearchRunSummary } from "@aihot/contracts/research";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { Route } from "./+types/research";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { bj } from "../../features/admin/format";
import { AdminPage, Badge, Button, Card, DataTable, Empty, Input, Pager } from "../../features/admin/ui";

interface Data {
  page: number;
  hasMore: boolean;
  rows: ResearchRunSummary[];
}

export async function loader({ request }: Route.LoaderArgs) {
  const page = Math.max(1, Number(new URL(request.url).searchParams.get("page")) || 1);
  return adminGet<Data>(request, `/api/admin/research-runs?page=${page}`);
}

export const meta: Route.MetaFunction = () => [{ title: `商品调研 · ${SITE.name} 后台` }];

const statusLabel: Record<string, string> = { queued: "排队中", running: "进行中", completed: "已完成", partial: "部分完成", failed: "失败" };
const statusTone = (status: string) => status === "completed" ? "ok" : status === "failed" ? "bad" : status === "partial" ? "warn" : "accent";

export default function Research({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const { run, pending } = useAdminAction();
  const [inputType, setInputType] = useState<ResearchInputType>("asin");
  const [query, setQuery] = useState("");

  return (
    <AdminPage title="商品调研" subtitle="输入一个 Amazon US ASIN 或英文商品关键词，后台会收集近期指标并生成一份带证据的内部简报。">
      <Card className="mb-6" title="新建调研" right={<span>Amazon US · 西柚数据</span>}>
        <form
          className="max-w-3xl"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!query.trim()) return;
            const result = await run<ResearchRunSummary>("POST", "/api/admin/research-runs", { inputType, query }, { label: "create-research", revalidate: false });
            if (result?.id) navigate(`/admin/research/${result.id}`);
          }}
        >
          <div className="mb-3 flex gap-1.5">
            {(["asin", "keyword"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={inputType === value}
                onClick={() => { setInputType(value); setQuery(""); }}
                className={`rounded-control px-3 py-1.5 text-[13px] ring-1 ${inputType === value ? "bg-ink text-bg ring-ink" : "bg-surface text-ink-2 ring-line-strong"}`}
              >
                {value === "asin" ? "单个 ASIN" : "英文关键词"}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={inputType === "asin" ? "例如 B0XXXXXXXX" : "例如 portable blender"}
              aria-label={inputType === "asin" ? "Amazon ASIN" : "英文商品关键词"}
              autoComplete="off"
            />
            <Button type="submit" tone="primary" busy={pending === "create-research"} disabled={!query.trim()}>开始调研</Button>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-4">
            ASIN 模式只研究这个商品；关键词模式按近 7 天竞争流量取最多 5 个代表商品。首版尚未接入 TikTok、评论正文和公司成本。
          </p>
        </form>
      </Card>

      <Card title="历史记录" pad={false}>
        {loaderData.rows.length ? (
          <DataTable
            rows={loaderData.rows}
            rowKey={(row) => row.id}
            onRowClick={(row) => navigate(`/admin/research/${row.id}`)}
            columns={[
              { key: "query", label: "研究对象", render: (row) => <div className="min-w-[260px]"><div className="font-medium text-ink">{row.query}</div><div className="mt-0.5 text-[11.5px] text-ink-4">{row.inputType === "asin" ? "ASIN" : "关键词"} · Amazon US</div></div> },
              { key: "status", label: "状态", render: (row) => <Badge tone={statusTone(row.status)}>{statusLabel[row.status] ?? row.status}</Badge> },
              { key: "products", label: "商品", align: "right", render: (row) => row.productCount || "—" },
              { key: "by", label: "发起人", render: (row) => <span className="whitespace-nowrap">{row.createdBy}</span> },
              { key: "at", label: "创建时间", render: (row) => <span className="num whitespace-nowrap">{bj(row.createdAt, true)}</span> },
            ]}
          />
        ) : <Empty>还没有调研。先用一个 ASIN 跑通第一份报告。</Empty>}
      </Card>
      <Pager page={loaderData.page} hasMore={loaderData.hasMore} />
    </AdminPage>
  );
}
