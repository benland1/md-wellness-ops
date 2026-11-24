const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Raw(s);
const flat = (v) => (Array.isArray(v) ? v.map(flat).join("") : v instanceof Raw ? v.s : v === false || v == null ? "" : esc(v));
const h = (s, ...v) => new Raw(s.reduce((a, x, i) => a + x + (i < v.length ? flat(v[i]) : ""), ""));
const money = (n) => (n < 0 ? "-" : "") + "$" + Math.abs(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (n) => (Number(n) || 0).toLocaleString("en-US");
const dt = (s) => (s ? new Date(s.length === 10 ? s + "T12:00:00" : s).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const dty = (s) => (s ? new Date(s.length === 10 ? s + "T12:00:00" : s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const O_FLOW = ["new", "confirmed", "ordered", "received", "shipped", "delivered"];
const O_LABEL = { new: "Submitted", confirmed: "Confirmed", ordered: "In production", received: "Ready to ship", shipped: "Shipped", delivered: "Delivered", cancelled: "Cancelled" };
const P_FLOW = ["draft", "sent", "confirmed", "production", "shipped", "received"];
const P_LABEL = { draft: "Draft", sent: "Sent", confirmed: "Confirmed", production: "In production", shipped: "In transit", received: "Received", cancelled: "Cancelled" };
const pill = (st, label) => h`<span class="pill st-${st}">${label}</span>`;
const steps = (flow, labels, status, ts) => { const i = flow.indexOf(status); return h`<div class="steps">${flow.map((s, k) => h`<div class="step ${k <= i ? "done" : ""} ${k === i ? "cur" : ""}"><b>${labels[s]}</b><i>${dt((ts || {})[s]) || raw("&nbsp;")}</i></div>`)}</div>`; };
const addrLines = (a) => (a ? [a.name, a.line1, a.line2, [a.city, a.state, a.zip].filter(Boolean).join(", "), a.country].filter(Boolean) : []);
let toastT;
function toast(msg, err) { let t = $(".toast"); if (!t) { t = document.createElement("div"); document.body.appendChild(t); } t.className = "toast" + (err ? " err" : ""); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), err ? 5000 : 2600); }
async function api(path, data) {
  const r = await fetch(path, data ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) } : {});
  const j = await r.json().catch(() => ({ error: "Server unavailable." }));
  if (!r.ok) { const e = new Error(j.error || "Request failed."); e.status = r.status; throw e; }
  return j;
}
async function copy(text, msg) { try { await navigator.clipboard.writeText(text); toast(msg || "Copied"); } catch { toast("Select the link and copy it manually", true); } }
const tierIdx = (qty, tiers) => { let i = 0; tiers.forEach((t, k) => { if (qty >= t) i = k; }); return i; };
const trackUrl = (c, t) => { c = (c || "").toLowerCase(); t = encodeURIComponent(t || ""); return !t ? "" : c.includes("ups") ? "https://www.ups.com/track?tracknum=" + t : c.includes("fedex") ? "https://www.fedex.com/fedextrack/?trknbr=" + t : c.includes("usps") ? "https://tools.usps.com/go/TrackConfirmAction?tLabels=" + t : c.includes("dhl") ? "https://www.dhl.com/us-en/home/tracking.html?tracking-id=" + t : ""; };
