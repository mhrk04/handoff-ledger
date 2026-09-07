export const SAFE_FIELDS = ["order_id", "risk_score", "transaction_status"] as const;
export const FORBIDDEN_FIELDS = ["name", "email", "address"] as const;

export type SafeField = (typeof SAFE_FIELDS)[number];
export type HandoffStatus = "active" | "revoked" | "redeemed";
export type Decision = "accepted" | "denied";

export interface CaseData {
  name: string;
  email: string;
  order_id: string;
  address: string;
  risk_score: number;
  transaction_status: string;
}

export interface HandoffPolicy {
  handoffId: string;
  caseId: string;
  recipientDid: string;
  allowedFields: string[];
  purpose: string;
  expiresAt: number;
  status: HandoffStatus;
}

export interface AuditEvent {
  id: string;
  handoffId: string;
  action: "created" | "redeemed" | "denied" | "revoked";
  decision: Decision;
  requestedFields: string[];
  disclosedFields: string[];
  reason?: string;
  purpose: string;
  timestamp: number;
}

export interface HandoffResponse {
  ok: boolean;
  status: Decision;
  disclosed?: Record<string, unknown>;
  reason?: string;
  auditId: string;
}

export interface RuntimeIdentity {
  tenantDid: string;
  agentDid: string;
  mode: "live" | "mock";
}
