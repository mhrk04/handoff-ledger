# Security boundary

Handoff Ledger is a focused demonstration of a permission boundary for agent-to-agent data transfer.

- `T3N_API_KEY` authenticates the tenant-side Support/orchestrator session.
- `USER_KEY` authenticates the data-owner session that signs the agent grant.
- `AGENT_KEY` authenticates the separate Fraud Agent session.
- The server reads DIDs from authenticated sessions. No DID is derived or hardcoded for the live path.
- The browser never receives private keys or unmasked DIDs.
- The private `case-data` map is readable by the contract, not by the browser or Fraud Agent directly.
- The Fraud Agent grant allows only `redeem-handoff` for this contract.
- The contract checks recipient DID, purpose metadata, expiry, revocation, one-time redemption, and requested fields.
- Audit records contain field names, identifiers, decisions, timestamps, and reasons—not customer values.

The sample customer and employer data is synthetic. This is not production identity, KYC, payment, or fraud infrastructure. It has no real customer data, external APIs, LLM, or production key-management integration.

Known MVP ceilings: the demo stores a single case and in-memory UI state, uses one-time redemption, has no key rotation UI, and uses a simple local HTTP server. Production use would need independent security review, durable application state, key custody, rate limits, replay-resistant operational controls, and a formal privacy/compliance review.
