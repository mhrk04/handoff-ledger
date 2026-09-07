import assert from "node:assert/strict";
import { HandoffPolicyEngine } from "../src/handoff.js";
import { DEMO_CASE } from "../src/handoff.js";

const tenantDid = "did:t3n:1111111111111111111111111111111111111111";
const agentDid = "did:t3n:2222222222222222222222222222222222222222";
assert.notEqual(tenantDid, agentDid, "agent DID must differ from tenant DID");

let now = 1_000;
const engine = new HandoffPolicyEngine(() => now);
const policy = engine.create({
  handoffId: "approved",
  caseId: "case-001",
  recipientDid: agentDid,
  allowedFields: ["order_id", "risk_score", "transaction_status"],
  purpose: "fraud_review",
  expiresAt: 1_600,
});
const approved = engine.redeem(policy.handoffId, agentDid, ["order_id", "risk_score", "transaction_status"], DEMO_CASE);
assert.equal(approved.ok, true);
assert.deepEqual(approved.disclosed, { order_id: "ORD-123", risk_score: 92, transaction_status: "flagged" });
assert.equal("email" in (approved.disclosed ?? {}), false);

const attack = engine.create({ ...policy, handoffId: "attack", expiresAt: 1_600 });
const unauthorized = engine.redeem(attack.handoffId, agentDid, ["email", "address"], DEMO_CASE);
assert.equal(unauthorized.ok, false);
assert.equal(unauthorized.reason, "field_not_authorized");

const expired = engine.create({ ...policy, handoffId: "expired", expiresAt: 1_100 });
now = 1_100;
assert.equal(engine.redeem(expired.handoffId, agentDid, ["order_id"], DEMO_CASE).reason, "handoff_expired");

now = 1_000;
const revoked = engine.create({ ...policy, handoffId: "revoked", expiresAt: 1_600 });
assert.equal(engine.revoke(revoked.handoffId).ok, true);
assert.equal(engine.redeem(revoked.handoffId, agentDid, ["order_id"], DEMO_CASE).reason, "handoff_revoked");

const replay = engine.redeem(policy.handoffId, agentDid, ["order_id"], DEMO_CASE);
assert.equal(replay.reason, "handoff_already_redeemed");
assert.equal(engine.redeem(policy.handoffId, tenantDid, ["order_id"], DEMO_CASE).reason, "recipient_mismatch");

const audit = JSON.stringify(engine.auditFor(policy.handoffId));
for (const secret of [DEMO_CASE.name, DEMO_CASE.email, DEMO_CASE.address]) assert.equal(audit.includes(secret), false);
console.log("PASS: approved, unauthorized, expired, revoked, replay, recipient binding, audit redaction, and DID separation");
