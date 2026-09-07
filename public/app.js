const $ = (id) => document.getElementById(id);
const result = $("result");
const show = (value) => { result.textContent = JSON.stringify(value, null, 2); loadAudit(); };
async function call(path, body) { const response = await fetch(path, { method: body ? "POST" : "GET", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "request failed"); return data; }
async function loadState() { const state = await call("/api/state"); $("mode").textContent = state.runtime; $("tenantDid").textContent = state.tenantDid; $("agentDid").textContent = state.agentDid; $("purpose").textContent = state.purpose; $("piiStatus").textContent = state.piiStatus; $("handoffId").textContent = state.handoffId || "no handoff"; $("mechanics").textContent = JSON.stringify({ runtime: state.runtime, contract: state.mechanics.contract, version: state.mechanics.version, contractId: state.mechanics.contractId, wasm: state.mechanics.wasm, maps: state.mechanics.maps, authorization: state.mechanics.authorization, calls: state.mechanics.calls }, null, 2); }
async function loadAudit() { const events = await call("/api/audit"); $("audit").innerHTML = events.length ? events.map((event) => { const fields = event.requestedFields ?? event.requested_fields ?? []; const timestamp = event.timestamp ?? event.timestamp_secs ?? 0; const reason = event.reason; return `<div class="event"><time>${new Date(timestamp * 1000).toLocaleTimeString()}</time><span><b>${event.action}</b> · ${fields.join(", ") || "no fields"}${reason ? ` · ${reason}` : ""}</span><strong class="${event.decision}">${event.decision}</strong></div>`; }).join("") : '<p class="muted">Create a handoff to begin.</p>'; }
async function run(path, body) { try { const data = await call(path, body); show(data); await loadState(); } catch (error) { result.textContent = `ERROR: ${error.message}`; } }
$("create").onclick = () => run("/api/handoff", { expiresInSeconds: 600 });
$("redeem").onclick = () => run("/api/redeem", { requestedFields: ["order_id", "risk_score", "transaction_status"] });
$("attack").onclick = () => run("/api/attack", {});
$("revoke").onclick = () => run("/api/revoke", {});
$("retry").onclick = () => run("/api/redeem", { requestedFields: ["order_id"] });
loadState().then(loadAudit).catch((error) => { result.textContent = `ERROR: ${error.message}`; });
