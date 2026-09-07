import assert from "node:assert/strict";
import { loadEnv } from "../src/env.js";
import {
  createLiveContext,
  createLiveHandoff,
  getLiveAudit,
  redeemLiveHandoff,
  revokeLiveHandoff,
  provision,
  registerContract,
} from "../src/t3n-client.js";

loadEnv();

function handoffId(value: unknown): string {
  const id = (value as { handoff?: { handoff_id?: unknown } })?.handoff?.handoff_id;
  if (typeof id !== "string") throw new Error("live create response did not contain handoff.handoff_id");
  return id;
}

async function bootstrapIfNeeded() {
  let ctx = await createLiveContext();
  try {
    const state = JSON.parse(await (await import("node:fs/promises")).readFile(".handoff-ledger.live.json", "utf8")) as { tenantDid: string; contractName: string; contractVersion: string; contractId: number };
    if (state.tenantDid === ctx.tenant.did) {
      ctx = { ...ctx, contractName: state.contractName, contractVersion: state.contractVersion, contractId: state.contractId };
      await provision(ctx);
      return ctx;
    }
  } catch {
    // First live run: register below.
  }
  ctx = await registerContract(ctx);
  await provision(ctx);
  return ctx;
}

async function main(): Promise<void> {
  const ctx = await bootstrapIfNeeded();
  assert.notEqual(ctx.tenant.did, ctx.agent.did, "agent DID must differ from tenant DID");
  const created = await createLiveHandoff(ctx);
  const firstId = handoffId(created);
  const redeemed = await redeemLiveHandoff(ctx, firstId, ["order_id", "risk_score", "transaction_status"]) as { disclosed?: Record<string, unknown>; ok?: boolean };
  assert.equal(redeemed.ok, true);
  assert.deepEqual(redeemed.disclosed, { order_id: "ORD-123", risk_score: 92, transaction_status: "flagged" });
  assert.equal("email" in (redeemed.disclosed ?? {}), false);

  const revoked = await createLiveHandoff(ctx);
  const secondId = handoffId(revoked);
  await revokeLiveHandoff(ctx, secondId);
  const denied = await redeemLiveHandoff(ctx, secondId, ["order_id"]) as { ok?: boolean; reason?: string };
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, "handoff_revoked");

  const audit = await getLiveAudit(ctx, secondId);
  assert.equal(JSON.stringify(audit).includes("amir@example.com"), false);
  console.log(JSON.stringify({ status: "live smoke passed", tenantDid: ctx.tenant.did.slice(0, 16) + "…", agentDid: ctx.agent.did.slice(0, 16) + "…", firstHandoff: firstId, revokedHandoff: secondId, auditEntries: (audit as { events?: unknown[] })?.events?.length ?? "available" }, null, 2));
}

main().catch((error) => {
  console.error(`LIVE SMOKE FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
