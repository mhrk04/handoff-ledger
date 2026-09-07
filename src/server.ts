import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HandoffPolicyEngine, DEMO_CASE } from "./handoff.js";
import { loadEnv } from "./env.js";
import {
  createLiveContext,
  createLiveHandoff,
  contractTail,
  getLiveAudit,
  maskDid,
  redeemLiveHandoff,
  revokeLiveHandoff,
  type LiveContext,
} from "./t3n-client.js";
import { SAFE_FIELDS } from "./types.js";

loadEnv();
const mode = process.env.MODE === "live" ? "live" : "mock";
const port = Number(process.env.PORT ?? 3000);
const publicDir = join(fileURLToPath(new URL(".", import.meta.url)), "../public");
const mockTenantDid = "did:t3n:1111111111111111111111111111111111111111";
const mockAgentDid = "did:t3n:2222222222222222222222222222222222222222";
const mock = new HandoffPolicyEngine();
let live: Promise<LiveContext> | undefined;
let activeHandoffId = "";

function liveContext(): Promise<LiveContext> {
  return (live ??= createLiveContext());
}

async function body(request: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("request body must be an object");
  return parsed as Record<string, unknown>;
}

function json(response: import("node:http").ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/0x[a-f0-9]{20,}/gi, "[redacted]").slice(0, 400);
}

async function state(): Promise<unknown> {
  if (mode === "mock") {
    return {
      mode,
      runtime: "local deterministic mock",
      tenantDid: maskDid(mockTenantDid),
      agentDid: maskDid(mockAgentDid),
      allowedFields: SAFE_FIELDS,
      purpose: "fraud_review",
      piiStatus: "sealed in case-data map; never sent to Fraud Agent",
      handoffId: activeHandoffId || null,
      mechanics: {
        contract: "local policy engine",
        maps: ["in-memory case-data", "in-memory handoffs", "in-memory audit"],
        authorization: "local test policy",
        calls: { create: "tenant", redeem: "agent", revoke: "tenant", audit: "tenant" },
      },
    };
  }
  const ctx = await liveContext();
  let registration: { contractId?: number; contractName?: string; contractVersion?: string } = {};
  try {
    registration = JSON.parse(await readFile(".handoff-ledger.live.json", "utf8")) as typeof registration;
  } catch {
    // Registration metadata is optional until live bootstrap completes.
  }
  return {
    mode,
    runtime: `T3N ${process.env.T3N_ENV ?? "testnet"}`,
    tenantDid: maskDid(ctx.tenant.did),
    agentDid: maskDid(ctx.agent.did),
    allowedFields: SAFE_FIELDS,
    purpose: "fraud_review",
    piiStatus: "sealed in tenant-private case-data map; never sent to Fraud Agent",
    handoffId: activeHandoffId || null,
    mechanics: {
      contract: `z:${maskDid(ctx.tenant.did).replace("did:t3n:", "")}:${contractTail()}`,
      version: registration.contractVersion ?? ctx.contractVersion,
      contractId: registration.contractId ?? "lookup after bootstrap",
      wasm: "Rust/WASM TEE contract",
      maps: ["case-data · private", "handoffs · private", "audit · private"],
      authorization: {
        grantor: maskDid(ctx.user.did),
        recipient: maskDid(ctx.agent.did),
        functions: ["redeem-handoff"],
      },
      calls: { create: "Support tenant DID", redeem: "Fraud agent DID", revoke: "Support tenant DID", audit: "Support tenant DID" },
    },
  };
}

async function createHandoff(expiresInSeconds = 600): Promise<unknown> {
  if (mode === "mock") {
    const policy = mock.create({
      caseId: "case-001",
      recipientDid: mockAgentDid,
      allowedFields: [...SAFE_FIELDS],
      purpose: "fraud_review",
      expiresAt: Math.floor(Date.now() / 1000) + expiresInSeconds,
    });
    activeHandoffId = policy.handoffId;
    return { ok: true, handoff: policy, audit: mock.auditFor(activeHandoffId) };
  }
  const ctx = await liveContext();
  const result = await createLiveHandoff(ctx, expiresInSeconds) as { handoff?: { handoff_id?: string } };
  activeHandoffId = result.handoff?.handoff_id ?? activeHandoffId;
  return { ...result, audit: activeHandoffId ? await auditEvents(ctx, activeHandoffId) : [] };
}

async function auditEvents(ctx: LiveContext, handoffId: string): Promise<unknown[]> {
  const result = await getLiveAudit(ctx, handoffId) as { events?: unknown[] };
  return result.events ?? [];
}

async function redeem(requestedFields: string[]): Promise<unknown> {
  if (!activeHandoffId) await createHandoff();
  if (mode === "mock") {
    const result = mock.redeem(activeHandoffId, mockAgentDid, requestedFields, DEMO_CASE);
    return { ...result, audit: mock.auditFor(activeHandoffId) };
  }
  const ctx = await liveContext();
  const result = await redeemLiveHandoff(ctx, activeHandoffId, requestedFields);
  return { result, audit: await auditEvents(ctx, activeHandoffId) };
}

async function revoke(): Promise<unknown> {
  if (!activeHandoffId) await createHandoff();
  if (mode === "mock") {
    const result = mock.revoke(activeHandoffId);
    return { ...result, audit: mock.auditFor(activeHandoffId) };
  }
  const ctx = await liveContext();
  const result = await revokeLiveHandoff(ctx, activeHandoffId);
  return { result, audit: await auditEvents(ctx, activeHandoffId) };
}

async function api(path: string, request: import("node:http").IncomingMessage): Promise<unknown> {
  if (request.method === "GET" && path === "/api/state") return state();
  if (request.method === "GET" && path === "/api/audit") {
    if (!activeHandoffId) return [];
    return mode === "mock" ? mock.auditFor(activeHandoffId) : auditEvents(await liveContext(), activeHandoffId);
  }
  if (request.method === "POST" && path === "/api/handoff") {
    const input = await body(request);
    return createHandoff(Number(input.expiresInSeconds ?? 600));
  }
  if (request.method === "POST" && path === "/api/redeem") {
    const input = await body(request);
    const fields = Array.isArray(input.requestedFields) ? input.requestedFields.filter((field): field is string => typeof field === "string") : [...SAFE_FIELDS];
    return redeem(fields);
  }
  if (request.method === "POST" && path === "/api/attack") {
    await createHandoff();
    return redeem(["order_id", "email", "address"]);
  }
  if (request.method === "POST" && path === "/api/revoke") return revoke();
  if (request.method === "POST" && path === "/api/reset") {
    activeHandoffId = "";
    return state();
  }
  throw Object.assign(new Error("not found"), { status: 404 });
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname.startsWith("/api/")) return json(response, await api(url.pathname, request));
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!/^[\w./-]+$/.test(file) || file.includes("..")) throw Object.assign(new Error("not found"), { status: 404 });
    const content = await readFile(join(publicDir, file));
    const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
    response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    response.end(content);
  } catch (error) {
    json(response, { ok: false, error: errorMessage(error) }, (error as { status?: number }).status ?? 500);
  }
});

server.listen(port, () => console.log(`Handoff Ledger ${mode} mode: http://localhost:${port}`));
