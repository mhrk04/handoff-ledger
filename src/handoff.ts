import { randomUUID } from "node:crypto";
import {
  CaseData,
  FORBIDDEN_FIELDS,
  HandoffPolicy,
  HandoffResponse,
  SAFE_FIELDS,
  AuditEvent,
  SafeField,
} from "./types.js";

export const DEMO_CASE: CaseData = {
  name: "Amir Rahman",
  email: "amir@example.com",
  order_id: "ORD-123",
  address: "Kuala Lumpur",
  risk_score: 92,
  transaction_status: "flagged",
};

export class HandoffPolicyEngine {
  private readonly policies = new Map<string, HandoffPolicy>();
  private readonly audit = new Map<string, AuditEvent[]>();

  constructor(private readonly now: () => number = () => Math.floor(Date.now() / 1000)) {}

  create(input: {
    caseId: string;
    recipientDid: string;
    allowedFields: string[];
    purpose: string;
    expiresAt: number;
    handoffId?: string;
  }): HandoffPolicy {
    const allowed = [...new Set(input.allowedFields)];
    if (!input.recipientDid || !input.purpose || !input.caseId) throw new Error("invalid handoff metadata");
    if (allowed.length === 0 || allowed.some((field) => !SAFE_FIELDS.includes(field as SafeField))) {
      throw new Error("allowedFields must contain only safe fields");
    }
    if (allowed.some((field) => FORBIDDEN_FIELDS.includes(field as (typeof FORBIDDEN_FIELDS)[number]))) {
      throw new Error("PII fields cannot be approved for handoff");
    }
    if (input.expiresAt <= this.now()) throw new Error("handoff must expire in the future");

    const policy: HandoffPolicy = {
      handoffId: input.handoffId ?? randomUUID(),
      caseId: input.caseId,
      recipientDid: input.recipientDid,
      allowedFields: allowed,
      purpose: input.purpose,
      expiresAt: input.expiresAt,
      status: "active",
    };
    this.policies.set(policy.handoffId, policy);
    this.append(policy, {
      action: "created",
      decision: "accepted",
      requestedFields: policy.allowedFields,
      disclosedFields: [],
    });
    return policy;
  }

  redeem(handoffId: string, callerDid: string, requestedFields: string[], data: CaseData): HandoffResponse {
    const policy = this.policies.get(handoffId);
    if (!policy) return this.denied(handoffId, requestedFields, "handoff_not_found");

    const deny = (reason: string) => this.denied(handoffId, requestedFields, reason, policy);
    if (callerDid !== policy.recipientDid) return deny("recipient_mismatch");
    if (policy.status === "revoked") return deny("handoff_revoked");
    if (policy.status === "redeemed") return deny("handoff_already_redeemed");
    if (this.now() >= policy.expiresAt) return deny("handoff_expired");
    if (requestedFields.some((field) => !policy.allowedFields.includes(field))) return deny("field_not_authorized");
    if (requestedFields.some((field) => !SAFE_FIELDS.includes(field as SafeField))) return deny("field_not_safe");

    const disclosed = Object.fromEntries(requestedFields.map((field) => [field, data[field as keyof CaseData]]));
    policy.status = "redeemed";
    const auditId = this.append(policy, {
      action: "redeemed",
      decision: "accepted",
      requestedFields,
      disclosedFields: requestedFields,
    });
    return { ok: true, status: "accepted", disclosed, auditId };
  }

  revoke(handoffId: string): HandoffResponse {
    const policy = this.policies.get(handoffId);
    if (!policy) return this.denied(handoffId, [], "handoff_not_found");
    if (policy.status === "redeemed") return this.denied(handoffId, [], "handoff_already_redeemed", policy);
    policy.status = "revoked";
    const auditId = this.append(policy, {
      action: "revoked",
      decision: "accepted",
      requestedFields: [],
      disclosedFields: [],
    });
    return { ok: true, status: "accepted", auditId };
  }

  auditFor(handoffId: string): AuditEvent[] {
    return this.audit.get(handoffId) ?? [];
  }

  policy(handoffId: string): HandoffPolicy | undefined {
    return this.policies.get(handoffId);
  }

  private denied(handoffId: string, requestedFields: string[], reason: string, policy?: HandoffPolicy): HandoffResponse {
    const auditId = this.append(policy ?? {
      handoffId,
      caseId: "unknown",
      recipientDid: "unknown",
      allowedFields: [],
      purpose: "unknown",
      expiresAt: 0,
      status: "active",
    }, {
      action: "denied",
      decision: "denied",
      requestedFields,
      disclosedFields: [],
      reason,
    });
    return { ok: false, status: "denied", reason, auditId };
  }

  private append(policy: HandoffPolicy, event: Omit<AuditEvent, "id" | "handoffId" | "purpose" | "timestamp">): string {
    const id = randomUUID();
    const full: AuditEvent = {
      id,
      handoffId: policy.handoffId,
      purpose: policy.purpose,
      timestamp: this.now(),
      ...event,
    };
    this.audit.set(policy.handoffId, [...(this.audit.get(policy.handoffId) ?? []), full]);
    return id;
  }
}
