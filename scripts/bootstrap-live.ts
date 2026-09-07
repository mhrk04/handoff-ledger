import { readFile, writeFile } from "node:fs/promises";
import { loadEnv } from "../src/env.js";
import {
  createLiveContext,
  contractVersion,
  provision,
  registerContract,
  maskDid,
} from "../src/t3n-client.js";

loadEnv();
const statePath = ".handoff-ledger.live.json";

type LocalState = { tenantDid: string; contractName: string; contractVersion: string; contractId: number };

async function previous(): Promise<LocalState | undefined> {
  try {
    return JSON.parse(await readFile(statePath, "utf8")) as LocalState;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  let ctx = await createLiveContext();
  const saved = await previous();
  if (saved && saved.tenantDid === ctx.tenant.did && saved.contractVersion === contractVersion()) {
    ctx = { ...ctx, contractName: saved.contractName, contractVersion: saved.contractVersion, contractId: saved.contractId };
    console.log("Using the existing local contract registration.");
  } else {
    ctx = await registerContract(ctx);
    await writeFile(statePath, JSON.stringify({ tenantDid: ctx.tenant.did, contractName: ctx.contractName, contractVersion: ctx.contractVersion, contractId: ctx.contractId }, null, 2));
  }
  await provision(ctx);
  console.log(JSON.stringify({
    status: "ready",
    tenantDid: maskDid(ctx.tenant.did),
    userDid: maskDid(ctx.user.did),
    agentDid: maskDid(ctx.agent.did),
    contractName: ctx.contractName,
    contractVersion: ctx.contractVersion,
    contractId: ctx.contractId,
    maps: ["case-data", "handoffs", "audit"],
    grant: "redeem-handoff only",
  }, null, 2));
}

main().catch((error) => {
  console.error(`LIVE BOOTSTRAP FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
