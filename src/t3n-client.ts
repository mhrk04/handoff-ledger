import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  T3nClient,
  TenantClient,
  createEthAuthInput,
  eth_get_address,
  fetchTrustedManifest,
  getNodeUrl,
  loadWasmComponent,
  metamask_sign,
  setEnvironment,
} from "@terminal3/t3n-sdk";
import { DEMO_CASE } from "./handoff.js";
import { requiredEnv } from "./env.js";
import type { CaseData } from "./types.js";

export const CASE_ID = "case-001";
export const contractTail = (): string => process.env.CONTRACT_TAIL ?? "handoff-ledger";
export const contractVersion = (): string => process.env.CONTRACT_VERSION ?? "0.1.0";
const environment = (): "sandbox" | "testnet" | "production" => (process.env.T3N_ENV ?? "testnet") as "sandbox" | "testnet" | "production";

export interface Authenticated {
  client: T3nClient;
  did: string;
}

export interface LiveContext {
  tenant: Authenticated;
  user: Authenticated;
  agent: Authenticated;
  tenantClient: TenantClient;
  contractName: string;
  contractVersion: string;
  contractId: number;
}

export function maskDid(did: string): string {
  return did.length > 18 ? `${did.slice(0, 12)}…${did.slice(-6)}` : did;
}

async function authenticate(key: string): Promise<Authenticated> {
  const env = environment();
  setEnvironment(env);
  const baseUrl = getNodeUrl();
  const trustAnchor = await fetchTrustedManifest(env, { baseUrl });
  const wasmComponent = await loadWasmComponent();
  const address = eth_get_address(key);
  const client = new T3nClient({
    baseUrl,
    trustAnchor,
    wasmComponent,
    handlers: { EthSign: metamask_sign(address, undefined, key) },
  });
  await client.handshake();
  const did = (await client.authenticate(createEthAuthInput(address))).value;
  return { client, did };
}

export async function createLiveContext(): Promise<LiveContext> {
  const tenantKey = requiredEnv("T3N_API_KEY");
  const userKey = requiredEnv("USER_KEY");
  const agentKey = requiredEnv("AGENT_KEY");
  const tenant = await authenticate(tenantKey);
  const user = await authenticate(userKey);
  const agent = await authenticate(agentKey);
  if (tenant.did === agent.did) throw new Error("AGENT_KEY resolved to the tenant DID; use a separate agent key");
  const baseUrl = getNodeUrl();
  const tenantClient = new TenantClient({
    environment: environment(),
    endpoint: baseUrl,
    baseUrl,
    t3n: tenant.client,
    tenantDid: tenant.did,
  });
  return {
    tenant,
    user,
    agent,
    tenantClient,
    contractName: tenantClient.canonicalName(contractTail()),
    contractVersion: contractVersion(),
    contractId: 0,
  };
}

export async function registerContract(ctx: LiveContext): Promise<LiveContext> {
  const wasmPath = "contract/target/wasm32-wasip2/release/handoff_ledger.wasm";
  const wasm = await readFile(wasmPath);
  const registered = await ctx.tenantClient.contracts.register({
    tail: contractTail(),
    version: ctx.contractVersion,
    wasm,
  });
  return { ...ctx, contractId: registered.contract_id, contractName: registered.name };
}

async function createMap(ctx: LiveContext, tail: string): Promise<void> {
  try {
    await ctx.tenantClient.maps.create({
      tail,
      visibility: "private",
      writers: { only: [ctx.contractId] },
      readers: { only: [ctx.contractId] },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already|exist|duplicate/i.test(message)) throw error;
  }
}

export async function provision(ctx: LiveContext): Promise<LiveContext> {
  if (!ctx.contractId) throw new Error("contractId is required before provisioning maps");
  await createMap(ctx, "case-data");
  await createMap(ctx, "handoffs");
  await createMap(ctx, "audit");
  await ctx.tenantClient.maps.entrySet("case-data", CASE_ID, JSON.stringify(DEMO_CASE));
  await ctx.user.client.updateAgentAuth(ctx.agent.did, {
    scriptName: ctx.contractName,
    versionReq: `=${ctx.contractVersion}`,
    functions: ["redeem-handoff"],
    allowedHosts: [],
  });
  return ctx;
}

export async function execute<T = unknown>(ctx: LiveContext, actor: Authenticated, functionName: string, input: unknown): Promise<T> {
  return actor.client.executeAndDecode<T>({
    contract_id: ctx.contractName,
    contract_version: ctx.contractVersion,
    function_name: functionName,
    input,
  });
}

export async function createLiveHandoff(ctx: LiveContext, expiresInSeconds = 600): Promise<unknown> {
  return execute(ctx, ctx.tenant, "create-handoff", {
    handoff_id: randomUUID(),
    case_id: CASE_ID,
    recipient_did: ctx.agent.did,
    allowed_fields: ["order_id", "risk_score", "transaction_status"],
    purpose: "fraud_review",
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
  });
}

export async function redeemLiveHandoff(ctx: LiveContext, handoffId: string, requestedFields: string[]): Promise<unknown> {
  return execute(ctx, ctx.agent, "redeem-handoff", { handoff_id: handoffId, requested_fields: requestedFields });
}

export async function revokeLiveHandoff(ctx: LiveContext, handoffId: string): Promise<unknown> {
  return execute(ctx, ctx.tenant, "revoke-handoff", { handoff_id: handoffId });
}

export async function getLiveAudit(ctx: LiveContext, handoffId: string): Promise<unknown> {
  return execute(ctx, ctx.tenant, "get-audit", { handoff_id: handoffId });
}

export function sampleCase(): CaseData {
  return { ...DEMO_CASE };
}
