import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ResearchInputType } from "@aihot/contracts/research";
import { actorOf } from "@aihot/backend/admin/auth";
import { createResearchRun } from "@aihot/backend/research/create";
import { listResearchRuns, researchRunDetail } from "@aihot/backend/research/read";
import { sendProblem } from "../http/respond.ts";
import { adminHandler } from "./admin-auth.ts";

const page = (req: FastifyRequest) => Math.max(1, Number((req.query as Record<string, string | undefined>).page) || 1);
const id = (req: FastifyRequest) => (req.params as { id: string }).id;
const notFound = (req: FastifyRequest, reply: FastifyReply) => sendProblem(req, reply, { status: 404, code: "not_found", detail: "Research run not found." });

export function registerAdminResearch(app: FastifyInstance) {
  app.get("/api/admin/research-runs", adminHandler(async (req) => listResearchRuns(page(req))));
  app.get("/api/admin/research-runs/:id", adminHandler(async (req, reply) => (await researchRunDetail(id(req))) ?? notFound(req, reply)));
  app.post("/api/admin/research-runs", adminHandler(async (req, reply, admin) => {
    const body = (req.body ?? {}) as { inputType?: ResearchInputType; query?: string };
    const run = await createResearchRun({
      inputType: body.inputType as ResearchInputType,
      query: String(body.query ?? ""),
      idempotencyKey: String(req.headers["idempotency-key"] ?? ""),
      actor: actorOf(admin),
    });
    return reply.code(202).send(run);
  }));
}
