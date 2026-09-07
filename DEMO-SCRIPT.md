# Handoff Ledger — 3-minute demo script

## Before recording

Run the live dashboard:

```bash
MODE=live npm run dev
```

Open `http://localhost:3000`. Keep the browser at 100% zoom. Do not show the terminal, `.env`, private keys, or full DIDs.

If the testnet rate limit appears, wait about one minute and continue. The live smoke test has already verified the same flow.

## 0:00–0:20 — Problem

**Screen:** Dashboard title and identity cards.

**Say:**

“When one AI agent hands a customer case to another, the easiest implementation is to forward the entire context. That silently exposes fields the next agent never needed. Handoff Ledger makes the transfer scoped, time-limited, revocable, and auditable.”

## 0:20–0:40 — Architecture and identities

**Screen:** Show the masked Support/Tenant DID, Fraud Agent DID, purpose, and PII boundary.

**Say:**

“This demo uses three T3N identities: the Support tenant, a separate data-owner session that authorizes access, and a separate Fraud Agent. The browser only talks to our local server. Keys stay server-side. The Rust contract runs as a T3N WASM contract and reads a private tenant map.”

## 0:40–1:10 — Create scoped handoff

**Action:** Click `1 · Create approved handoff`.

**Screen:** Show the result and allowed fields.

**Say:**

“The Support Agent creates a handoff for the purpose fraud review. It is bound to the Fraud Agent DID and expires in ten minutes. The only approved fields are order ID, risk score, and transaction status. The case also contains a name, email, and address, but those fields are not part of this permission.”

## 1:10–1:35 — Redeem allowed fields

**Action:** Click `2 · Redeem allowed fields`.

**Screen:** Highlight the `disclosed` object.

**Say:**

“The Fraud Agent redeems the handoff using its own authenticated session. The result contains exactly the three approved fields: ORD-123, risk score 92, and flagged transaction status. The name, email, and address are not returned.”

## 1:35–1:55 — Unauthorized request

**Action:** Click `3 · Attempt email + address`.

**Screen:** Highlight `field_not_authorized` and the denied audit event.

**Say:**

“Now the Fraud Agent requests email and address. The contract denies the request with field not authorized. This is enforced inside the contract, not by a UI filter. The audit ledger records the requested field names and the denial, but never records the raw values.”

## 1:55–2:20 — Revoke and retry

**Action:** Click `1 · Create approved handoff`, then `4 · Revoke permission`, then `Retry after revoke`.

**Screen:** Highlight `handoff_revoked`.

**Say:**

“Finally, Support creates another handoff and revokes it before redemption. The same Fraud Agent retries with an otherwise allowed field, but the contract denies it because the handoff is revoked. A leaked agent key does not override the user’s permission.”

## 2:20–2:40 — Audit ledger

**Screen:** Scroll or frame the audit timeline.

**Say:**

“Every step is visible in the sanitized ledger: created, accepted redemption, unauthorized request denied, revoked, and retry denied. The ledger contains purpose, field names, decisions, timestamps, and identifiers—never customer PII.”

## 2:40–3:00 — Closing pitch

**Screen:** Dashboard overview with both masked identities and the audit timeline.

**Say:**

“Handoff Ledger gives every AI-agent data transfer a cryptographic permission boundary. Agents can collaborate, but they cannot silently share user data. This demo uses synthetic data and Terminal 3’s tenant maps, agent authorization, Rust WASM contract, and audit path.”

## Recording checklist

- Keep the final video under 3:00.
- Use the live dashboard, not mock mode.
- Do not show `.env`, terminal output containing credentials, or unmasked DIDs.
- Make sure the `disclosed` object visibly contains only the three approved fields.
- Make sure `field_not_authorized` and `handoff_revoked` are readable.
- Upload as Unlisted or Public on YouTube and test the link in an incognito window.
