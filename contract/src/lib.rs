#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

extern crate alloc;

use alloc::{string::String, vec::Vec};
use serde::{Deserialize, Serialize};
#[cfg(target_arch = "wasm32")]
use alloc::format;
#[cfg(target_arch = "wasm32")]
use serde_json::{Map, Value};

pub const CONTRACT_VERSION: &str = "0.1.0";
const CASE_MAP: &str = "case-data";
const HANDOFF_MAP: &str = "handoffs";
const AUDIT_MAP: &str = "audit";
const SAFE_FIELDS: [&str; 3] = ["order_id", "risk_score", "transaction_status"];
const FORBIDDEN_FIELDS: [&str; 3] = ["name", "email", "address"];

wit_bindgen::generate!({
    world: "handoff-ledger",
    path: "wit",
    additional_derives: [serde::Deserialize, serde::Serialize],
    generate_all,
});

#[derive(Debug, Deserialize, Serialize, Clone)]
struct Handoff {
    handoff_id: String,
    case_id: String,
    recipient_did: String,
    allowed_fields: Vec<String>,
    purpose: String,
    expires_at: u64,
    status: String,
}

#[derive(Debug, Deserialize)]
struct CreateRequest {
    handoff_id: String,
    case_id: String,
    recipient_did: String,
    allowed_fields: Vec<String>,
    purpose: String,
    expires_at: u64,
}

#[derive(Debug, Deserialize)]
struct RedeemRequest {
    handoff_id: String,
    requested_fields: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct HandoffIdRequest {
    handoff_id: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
struct AuditEvent {
    id: String,
    handoff_id: String,
    action: String,
    decision: String,
    requested_fields: Vec<String>,
    disclosed_fields: Vec<String>,
    purpose: String,
    timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

#[derive(Debug, Serialize)]
struct AuditResult {
    handoff_id: String,
    events: Vec<AuditEvent>,
}

fn valid_fields(fields: &[String]) -> bool {
    !fields.is_empty()
        && fields.iter().all(|field| SAFE_FIELDS.contains(&field.as_str()))
        && !fields.iter().any(|field| FORBIDDEN_FIELDS.contains(&field.as_str()))
}

fn caller_did() -> Result<String, String> {
    #[cfg(target_arch = "wasm32")]
    {
        let raw = host::tenant::tenant_context::calling_user_did()
            .ok_or_else(|| "missing_caller_identity".to_string())?;
        return Ok(format!("did:t3n:{}", hex::encode(raw)));
    }
    #[cfg(not(target_arch = "wasm32"))]
    Err("caller identity is only available in wasm".to_string())
}

#[cfg(target_arch = "wasm32")]
fn map_name(tail: &str) -> String {
    format!("z:{}:{}", hex::encode(host::tenant::tenant_context::tenant_did()), tail)
}

#[cfg(target_arch = "wasm32")]
fn get_json<T: for<'de> Deserialize<'de>>(map: &str, key: &str) -> Result<Option<T>, String> {
    let raw = host::interfaces::kv_store::get(&map_name(map), key.as_bytes())?;
    match raw {
        Some(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

#[cfg(target_arch = "wasm32")]
fn put_json<T: Serialize>(map: &str, key: &str, value: &T) -> Result<(), String> {
    let raw = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    host::interfaces::kv_store::put(&map_name(map), key.as_bytes(), &raw)
}

#[cfg(target_arch = "wasm32")]
fn append_audit(
    handoff_id: &str,
    purpose: &str,
    action: &str,
    decision: &str,
    requested_fields: Vec<String>,
    disclosed_fields: Vec<String>,
    reason: Option<String>,
) -> Result<String, String> {
    let seq = host::tenant::tenant_context::seq_no();
    let id = format!("{}-{}", handoff_id, seq);
    let mut events: Vec<AuditEvent> = get_json(AUDIT_MAP, handoff_id)?.unwrap_or_default();
    events.push(AuditEvent {
        id: id.clone(),
        handoff_id: handoff_id.to_string(),
        action: action.to_string(),
        decision: decision.to_string(),
        requested_fields,
        disclosed_fields,
        purpose: purpose.to_string(),
        timestamp: host::tenant::tenant_context::cluster_timestamp_secs(),
        reason,
    });
    put_json(AUDIT_MAP, handoff_id, &events)?;
    Ok(id)
}

#[cfg(target_arch = "wasm32")]
fn denied(
    handoff_id: &str,
    requested_fields: Vec<String>,
    reason: &str,
    policy: Option<&Handoff>,
) -> Result<Vec<u8>, String> {
    let purpose = policy.map(|p| p.purpose.as_str()).unwrap_or("unknown");
    let audit_id = append_audit(
        handoff_id,
        purpose,
        "denied",
        "denied",
        requested_fields,
        Vec::new(),
        Some(reason.to_string()),
    )?;
    serde_json::to_vec(&serde_json::json!({
        "ok": false,
        "status": "denied",
        "reason": reason,
        "auditId": audit_id,
    }))
    .map_err(|e| e.to_string())
}

fn input_bytes(req: &exports::z::handoff_ledger::contracts::GenericInput) -> Result<&[u8], String> {
    req.input.as_deref().ok_or_else(|| "missing_input".to_string())
}

struct Component;

#[cfg(target_arch = "wasm32")]
impl exports::z::handoff_ledger::contracts::Guest for Component {
    fn create_handoff(
        req: exports::z::handoff_ledger::contracts::GenericInput,
    ) -> Result<Vec<u8>, String> {
        let parsed: CreateRequest = serde_json::from_slice(input_bytes(&req)?)
            .map_err(|e| format!("bad_create_input:{e}"))?;
        if parsed.handoff_id.is_empty()
            || parsed.case_id.is_empty()
            || parsed.recipient_did.is_empty()
            || parsed.purpose.is_empty()
            || !valid_fields(&parsed.allowed_fields)
        {
            return Err("invalid_handoff_policy".to_string());
        }
        let now = host::tenant::tenant_context::cluster_timestamp_secs();
        if parsed.expires_at <= now {
            return Err("handoff_must_expire_in_future".to_string());
        }
        let policy = Handoff {
            handoff_id: parsed.handoff_id,
            case_id: parsed.case_id,
            recipient_did: parsed.recipient_did,
            allowed_fields: parsed.allowed_fields,
            purpose: parsed.purpose,
            expires_at: parsed.expires_at,
            status: "active".to_string(),
        };
        put_json(HANDOFF_MAP, &policy.handoff_id, &policy)?;
        let audit_id = append_audit(
            &policy.handoff_id,
            &policy.purpose,
            "created",
            "accepted",
            policy.allowed_fields.clone(),
            Vec::new(),
            None,
        )?;
        serde_json::to_vec(&serde_json::json!({ "ok": true, "handoff": policy, "auditId": audit_id }))
            .map_err(|e| e.to_string())
    }

    fn redeem_handoff(
        req: exports::z::handoff_ledger::contracts::GenericInput,
    ) -> Result<Vec<u8>, String> {
        let parsed: RedeemRequest = serde_json::from_slice(input_bytes(&req)?)
            .map_err(|e| format!("bad_redeem_input:{e}"))?;
        let policy: Handoff = match get_json(HANDOFF_MAP, &parsed.handoff_id)? {
            Some(value) => value,
            None => return denied(&parsed.handoff_id, parsed.requested_fields, "handoff_not_found", None),
        };
        let requested = parsed.requested_fields;
        if caller_did()? != policy.recipient_did {
            return denied(&policy.handoff_id, requested, "recipient_mismatch", Some(&policy));
        }
        if policy.status == "revoked" {
            return denied(&policy.handoff_id, requested, "handoff_revoked", Some(&policy));
        }
        if policy.status == "redeemed" {
            return denied(&policy.handoff_id, requested, "handoff_already_redeemed", Some(&policy));
        }
        if host::tenant::tenant_context::cluster_timestamp_secs() >= policy.expires_at {
            return denied(&policy.handoff_id, requested, "handoff_expired", Some(&policy));
        }
        if requested.iter().any(|field| !policy.allowed_fields.contains(field)) {
            return denied(&policy.handoff_id, requested, "field_not_authorized", Some(&policy));
        }
        if requested.iter().any(|field| !SAFE_FIELDS.contains(&field.as_str())) {
            return denied(&policy.handoff_id, requested, "field_not_safe", Some(&policy));
        }
        let case: Value = get_json(CASE_MAP, &policy.case_id)?
            .ok_or_else(|| "case_not_found".to_string())?;
        let case_object = case.as_object().ok_or_else(|| "case_not_object".to_string())?;
        let mut disclosed = Map::new();
        for field in &requested {
            if let Some(value) = case_object.get(field) {
                disclosed.insert(field.clone(), value.clone());
            }
        }
        let mut redeemed = policy.clone();
        redeemed.status = "redeemed".to_string();
        put_json(HANDOFF_MAP, &redeemed.handoff_id, &redeemed)?;
        let audit_id = append_audit(
            &redeemed.handoff_id,
            &redeemed.purpose,
            "redeemed",
            "accepted",
            requested.clone(),
            requested,
            None,
        )?;
        serde_json::to_vec(&serde_json::json!({
            "ok": true,
            "status": "accepted",
            "disclosed": disclosed,
            "auditId": audit_id,
        }))
        .map_err(|e| e.to_string())
    }

    fn revoke_handoff(
        req: exports::z::handoff_ledger::contracts::GenericInput,
    ) -> Result<Vec<u8>, String> {
        let parsed: HandoffIdRequest = serde_json::from_slice(input_bytes(&req)?)
            .map_err(|e| format!("bad_revoke_input:{e}"))?;
        let policy: Handoff = match get_json(HANDOFF_MAP, &parsed.handoff_id)? {
            Some(value) => value,
            None => return denied(&parsed.handoff_id, Vec::new(), "handoff_not_found", None),
        };
        if policy.status == "redeemed" {
            return denied(&policy.handoff_id, Vec::new(), "handoff_already_redeemed", Some(&policy));
        }
        let mut revoked = policy.clone();
        revoked.status = "revoked".to_string();
        put_json(HANDOFF_MAP, &revoked.handoff_id, &revoked)?;
        let audit_id = append_audit(
            &revoked.handoff_id,
            &revoked.purpose,
            "revoked",
            "accepted",
            Vec::new(),
            Vec::new(),
            None,
        )?;
        serde_json::to_vec(&serde_json::json!({ "ok": true, "status": "accepted", "auditId": audit_id }))
            .map_err(|e| e.to_string())
    }

    fn get_audit(
        req: exports::z::handoff_ledger::contracts::GenericInput,
    ) -> Result<Vec<u8>, String> {
        let parsed: HandoffIdRequest = serde_json::from_slice(input_bytes(&req)?)
            .map_err(|e| format!("bad_audit_input:{e}"))?;
        let events: Vec<AuditEvent> = get_json(AUDIT_MAP, &parsed.handoff_id)?.unwrap_or_default();
        serde_json::to_vec(&AuditResult { handoff_id: parsed.handoff_id, events })
            .map_err(|e| e.to_string())
    }
}

#[cfg(target_arch = "wasm32")]
export!(Component);

#[cfg(test)]
mod tests {
    use super::{valid_fields, CONTRACT_VERSION};

    #[test]
    fn safe_fields_are_the_only_approved_fields() {
        assert!(valid_fields(&vec!["order_id".into(), "risk_score".into()]));
        assert!(!valid_fields(&vec!["email".into()]));
        assert!(!valid_fields(&vec!["order_id".into(), "address".into()]));
    }

    #[test]
    fn version_is_semver() {
        assert_eq!(CONTRACT_VERSION, "0.1.0");
        assert_eq!(CONTRACT_VERSION.split('.').count(), 3);
    }
}
