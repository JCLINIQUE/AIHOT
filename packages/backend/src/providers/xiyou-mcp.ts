// Remote Xiyou MCP client for Amazon research. Credentials stay in the worker process; requests are
// persisted through the normal paid-request receipts before research evidence is written.
import { credential } from "../config.ts";
import { paidRequest, ProviderRejectedError } from "./receipts.ts";

const PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: string | number | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

function endpoint(): URL {
  const raw = credential("integrations", "XIYOU_MCP_URL");
  if (!raw) throw new Error("XIYOU_MCP_URL is not configured");
  const url = new URL(raw);
  if (!/^https?:$/.test(url.protocol)) throw new Error("XIYOU_MCP_URL must use HTTP or HTTPS");
  if (url.username || url.password) throw new Error("XIYOU_MCP_URL must not contain credentials; use XIYOU_MCP_TOKEN");
  return url;
}

function headers(sessionId?: string): Record<string, string> {
  const token = credential("integrations", "XIYOU_MCP_TOKEN");
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": PROTOCOL_VERSION,
    ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

function responseMessages(text: string, contentType: string): JsonRpcResponse[] {
  if (!text.trim()) return [];
  if (!contentType.includes("text/event-stream")) return [JSON.parse(text) as JsonRpcResponse];
  const messages: JsonRpcResponse[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (data && data !== "[DONE]") messages.push(JSON.parse(data) as JsonRpcResponse);
  }
  return messages;
}

function isConnectFailure(error: unknown): boolean {
  const code = (error as { cause?: { code?: string } })?.cause?.code ?? (error as { code?: string })?.code;
  return ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "CERT_HAS_EXPIRED"].includes(code ?? "");
}

async function post(body: unknown, sessionId?: string): Promise<{ messages: JsonRpcResponse[]; sessionId?: string }> {
  const url = endpoint();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: headers(sessionId),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    if (isConnectFailure(error)) throw new ProviderRejectedError(`Xiyou MCP connection failed: ${String(error)}`, null, true);
    // A timeout or reset after sending may already have consumed Credits. The receipt marks that
    // outcome unknown and prevents an automatic repeat.
    throw error;
  }
  const text = await res.text();
  if (!res.ok) {
    throw new ProviderRejectedError(`Xiyou MCP HTTP ${res.status}: ${text.slice(0, 500)}`, res.status, res.status === 429 || res.status >= 500);
  }
  return {
    messages: responseMessages(text, res.headers.get("content-type") ?? ""),
    sessionId: res.headers.get("mcp-session-id") ?? sessionId,
  };
}

function rpcResult(messages: JsonRpcResponse[], id: number): unknown {
  const message = [...messages].reverse().find((item) => item.id === id);
  if (!message) throw new ProviderRejectedError("Xiyou MCP returned no matching JSON-RPC response", null, true);
  if (message.error) throw new ProviderRejectedError(`Xiyou MCP ${message.error.code ?? "error"}: ${message.error.message ?? "request failed"}`, null, false);
  return message.result;
}

function parseTextResult(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return { text: trimmed };
  }
}

/** Removes MCP's transport envelope, preserving the provider's structured response. */
export function unwrapMcpToolResult(result: unknown): unknown {
  const value = result as { isError?: boolean; structuredContent?: unknown; content?: Array<{ type?: string; text?: string }> } | null;
  if (!value || typeof value !== "object") return value;
  if (value.isError) {
    const message = value.content?.map((item) => item.text).filter(Boolean).join("\n") || "Xiyou MCP tool failed";
    throw new ProviderRejectedError(message.slice(0, 1000), null, false);
  }
  if (value.structuredContent !== undefined) return value.structuredContent;
  const texts = value.content?.filter((item) => item.type === "text" && typeof item.text === "string").map((item) => item.text!) ?? [];
  if (texts.length === 1) return parseTextResult(texts[0]!);
  if (texts.length > 1) return texts.map(parseTextResult);
  return value;
}

async function callRemoteTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const initialized = await post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "aihot-product-research", version: "0.1.0" } },
  });
  rpcResult(initialized.messages, 1);
  await post({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }, initialized.sessionId);
  const called = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }, initialized.sessionId);
  return unwrapMcpToolResult(rpcResult(called.messages, 2));
}

export interface XiyouCallResult {
  response: unknown;
  receiptId: number;
  reused: boolean;
}

export async function callXiyouTool(runId: string, name: string, args: Record<string, unknown>): Promise<XiyouCallResult> {
  const receipt = await paidRequest(
    {
      service: "xiyou-mcp",
      purpose: `research.${name}`,
      subject: `research:${runId}`,
      identity: { runId, name, args },
      requestSummary: { name, args },
    },
    async () => ({ response: await callRemoteTool(name, args), cost: null }),
  );
  return { response: receipt.response, receiptId: receipt.receiptId, reused: receipt.reused };
}
