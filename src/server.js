// MD Wellness Operations — single-file Bun server (built by build.js; do not edit dist directly)
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, copyFileSync, readdirSync, unlinkSync } from "node:fs";

const ASSETS = /*__ASSETS__*/ {};
const VOL = Bun.env.RAILWAY_VOLUME_MOUNT_PATH || "";
const DIR = Bun.env.DATA_DIR || VOL || "/data";
const DURABLE = !!(Bun.env.DATA_DIR || VOL);
const SETUP_CODE = Bun.env.SETUP_CODE || "";
const FILE = DIR + "/db.json";
const TIERS = [1, 10, 25, 250, 1000, 2500, 5000];
const COST_TIERS = [25, 250, 500];
const O_FLOW = ["new", "confirmed", "ordered", "received", "shipped", "delivered"];
const P_FLOW = ["draft", "sent", "confirmed", "production", "shipped", "received"];
const PACK = {
  unlabeled: { name: "Unlabeled", per: 0, setup: 0, waive: 0 },
  mdwellness: { name: "MD Wellness Label", per: 0, setup: 0, waive: 0 },
  clientlabel: { name: "Client Custom Label", per: 0.75, setup: 250, waive: 250 },
  custombottle: { name: "Custom Bottle + Label", per: 2.5, setup: 500, waive: 0 },
};

const gunzip = (b64) => Bun.gunzipSync(Buffer.from(b64, "base64"));
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const rid = (n = 6) => randomBytes(n).toString("hex");
const tok = () => randomBytes(18).toString("base64url");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const now = () => new Date().toISOString();
const str = (v, max = 300) => (v == null ? "" : String(v)).slice(0, max).trim();
const num = (v, min = 0, max = 1e9) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0; };
const addr = (a) => { a = a || {}; return { name: str(a.name), line1: str(a.line1), line2: str(a.line2), city: str(a.city, 80), state: str(a.state, 40), zip: str(a.zip, 20), country: str(a.country, 60) }; };

// ---------- store ----------
let S;
function seed() {
  const cat = JSON.parse(new TextDecoder().decode(gunzip(ASSETS.catalog)));
  return {
    v: 1, auth: null, sessions: {}, ctr: { so: 1000, po: 2000 },
    settings: {
      company: { name: "MD Wellness", email: "support@mdwellness.com", phone: "", line1: "2278 Froude St", line2: "", city: "San Diego", state: "CA", zip: "92107", country: "USA", site: "mdwellness.com" },
      mfr: { name: "", contact: "", email: "", phone: "", line1: "", line2: "", city: "", state: "", zip: "", country: "", terms: 30, notes: "All products supplied unlabeled / bulk. Certificate of Analysis (COA) required for each lot. Temperature-controlled shipping required." },
      terms: 0, publicLink: true, publicToken: tok(), webhook: "", moq: 25,
      invoiceNote: "All products are sold for research purposes only. Pricing valid for 30 days.",
    },
    products: cat.P.map((p) => ({ id: p[0], f: cat.F[p[1]], c: cat.C[p[2]], n: p[3], cost: p.slice(4, 7), w: p.slice(7, 14), on: true })),
    accounts: [], orders: [], pos: [],
  };
}
function load() {
  mkdirSync(DIR, { recursive: true });
  if (existsSync(FILE)) S = JSON.parse(readFileSync(FILE, "utf8"));
  else { S = seed(); save(); }
}
let lastBackup = "";
function save() {
  const tmp = FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(S));
  renameSync(tmp, FILE);
  const day = now().slice(0, 10);
  if (day !== lastBackup) {
    lastBackup = day;
    try {
      copyFileSync(FILE, `${DIR}/backup-${day}.json`);
      const old = readdirSync(DIR).filter((f) => f.startsWith("backup-")).sort();
      while (old.length > 21) unlinkSync(DIR + "/" + old.shift());
    } catch {}
  }
}

// ---------- domain logic ----------
const prod = (id) => S.products.find((p) => p.id === id);
const acct = (id) => S.accounts.find((a) => a.id === id);
const order = (id) => S.orders.find((o) => o.id === id);
const po = (id) => S.pos.find((p) => p.id === id);
const tierIdx = (qty, tiers) => { let i = 0; tiers.forEach((t, k) => { if (qty >= t) i = k; }); return i; };
const priceFor = (p, qty, disc) => r2(p.w[tierIdx(qty, TIERS)] * (1 - (disc || 0) / 100));
const costFor = (p, qty) => p.cost[tierIdx(qty, COST_TIERS)];
const ev = (doc, m) => { (doc.ev = doc.ev || []).push({ t: now(), m }); };

function buildItems(raw, disc, allowOverride) {
  if (!Array.isArray(raw) || !raw.length) throw new E("Add at least one product.");
  if (raw.length > 150) throw new E("Too many lines.");
  const seen = new Set();
  return raw.map((r) => {
    const p = prod(str(r.pid, 12));
    const qty = Math.floor(num(r.qty, 0, 1e6));
    if (!p || (!p.on && !allowOverride)) throw new E("A product on this order is no longer available.");
    if (qty < 1) throw new E("Quantities must be at least 1.");
    const pkg = PACK[r.pkg] ? r.pkg : "unlabeled";
    if (seen.has(p.id + pkg)) throw new E("Duplicate line for " + p.n);
    seen.add(p.id + pkg);
    const k = PACK[pkg];
    const unit = allowOverride && r.unit != null && r.unit !== "" ? r2(num(r.unit)) : priceFor(p, qty, disc);
    return { pid: p.id, n: p.n, f: p.f, qty, unit, pkg, per: k.per, setup: k.setup && !(k.waive && qty >= k.waive) ? k.setup : 0, lots: [] };
  });
}
function totals(o) {
  let sub = 0, setup = 0, units = 0;
  o.items.forEach((i) => { sub += (i.unit + i.per) * i.qty; setup += i.setup; units += i.qty; });
  o.sub = r2(sub); o.setup = r2(setup); o.units = units;
  o.total = r2(sub + setup + (o.shipping || 0) + (o.adjust || 0));
  o.paid = r2((o.pay || []).reduce((s, p) => s + p.amount, 0));
}
function poTotals(p) {
  let sub = 0;
  p.lines.forEach((l) => { l.qty = l.need + l.extra; sub += r2(l.unit * l.qty); });
  p.sub = r2(sub); p.total = r2(sub + (p.shipping || 0));
  p.paid = r2((p.pay || []).reduce((s, x) => s + x.amount, 0));
}
function createOrder(a, body, source, admin) {
  const items = buildItems(body.items, a.discount, admin);
  const o = {
    id: rid(), num: "SO-" + ++S.ctr.so, accountId: a.id, source, status: "new", created: now(), ts: { new: now() },
    items, shipTo: addr(body.shipTo || a.shipTo), ref: str(body.ref, 60),
    notes: str(body.notes, 2000), internal: "", shipping: 0, adjust: 0, adjustNote: "", pay: [], poId: null,
    carrier: "", tracking: "", terms: a.terms != null ? a.terms : S.settings.terms, ev: [],
  };
  totals(o);
  ev(o, source === "link" ? "Order submitted through order link" : "Order entered manually");
  S.orders.unshift(o);
  return o;
}
function setOrderStatus(o, status, why) {
  if (o.status === status) return;
  o.status = status;
  o.ts = o.ts || {};
  if (status !== "cancelled") {
    const i = O_FLOW.indexOf(status);
    O_FLOW.forEach((s, k) => { if (k > i) delete o.ts[s]; });
    o.ts[status] = now();
  }
  ev(o, why || "Status changed to " + status);
}
function setPoStatus(p, status) {
  if (p.status === status) return;
  p.status = status;
  p.ts = p.ts || {};
  const i = P_FLOW.indexOf(status);
  P_FLOW.forEach((s, k) => { if (k > i) delete p.ts[s]; });
  if (i >= 0) p.ts[status] = now();
  ev(p, "Status changed to " + status);
  const linked = S.orders.filter((o) => o.poId === p.id && o.status !== "cancelled");
  if (i >= 1 && i < 5) linked.forEach((o) => { if (o.status === "confirmed" || o.status === "new") setOrderStatus(o, "ordered", `Placed with manufacturer on ${p.num}`); });
  if (status === "received") {
    syncLots(p);
    linked.forEach((o) => { if (["new", "confirmed", "ordered"].includes(o.status)) setOrderStatus(o, "received", `Goods received from manufacturer (${p.num})`); });
  }
}
function syncLots(p) {
  S.orders.filter((o) => o.poId === p.id).forEach((o) => o.items.forEach((it) => {
    const l = p.lines.find((x) => x.pid === it.pid);
    it.lots = l && l.lot ? [{ lot: l.lot, exp: l.exp || "", po: p.num }] : [];
  }));
}
function createPO(body) {
  const ids = Array.isArray(body.orderIds) ? body.orderIds : [];
  const os = ids.map(order).filter((o) => o && !o.poId && o.status !== "cancelled");
  const extra = body.extra || {};
  const need = {};
  os.forEach((o) => o.items.forEach((i) => { need[i.pid] = (need[i.pid] || 0) + i.qty; }));
  Object.keys(extra).forEach((pid) => { if (prod(pid) && num(extra[pid]) > 0 && !need[pid]) need[pid] = 0; });
  const pids = Object.keys(need);
  if (!pids.length) throw new E("Select at least one order or add stock quantities.");
  const disc = num(body.discount, 0, 100);
  const p = {
    id: rid(), num: "PO-" + ++S.ctr.po, token: tok(), status: "draft", created: now(), ts: { draft: now() }, discount: disc,
    lines: pids.map((pid) => {
      const pr = prod(pid), x = Math.floor(num(extra[pid], 0, 1e6)), qty = need[pid] + x;
      return { pid, n: pr.n, f: pr.f, need: need[pid], extra: x, qty, unit: r2(costFor(pr, qty) * (1 - disc / 100)), lot: "", exp: "" };
    }).filter((l) => l.qty > 0),
    notes: str(body.notes, 2000) || S.settings.mfr.notes, shipping: 0, pay: [], expected: "", carrier: "", tracking: "",
    terms: S.settings.mfr.terms, shipTo: { ...S.settings.company }, ev: [], ack: null,
  };
  poTotals(p);
  ev(p, `Purchase order created from ${os.length} client order${os.length === 1 ? "" : "s"}`);
  os.forEach((o) => { o.poId = p.id; ev(o, `Added to manufacturer ${p.num}`); });
  S.pos.unshift(p);
  return p;
}
function addPay(doc, b) {
  const amount = r2(num(b.amount, -1e7, 1e7));
  if (!amount) throw new E("Enter a payment amount.");
  doc.pay = doc.pay || [];
  doc.pay.push({ id: rid(4), date: str(b.date, 10) || now().slice(0, 10), amount, method: str(b.method, 30), ref: str(b.ref, 80) });
  ev(doc, `Payment recorded: $${amount.toFixed(2)}${b.method ? " via " + str(b.method, 30) : ""}`);
}
function hook(o, a) {
  const u = S.settings.webhook;
  if (!u || !/^https:\/\//.test(u)) return;
  fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "order.created", number: o.num, account: a.name, company: a.company, email: a.email, total: o.total, units: o.units, items: o.items.map((i) => ({ name: i.n, format: i.f, qty: i.qty, unit: i.unit })) }) }).catch(() => {});
}

class E extends Error {}

const ACT = {
  "account.save"(b) {
    const x = b.acct || {};
    let a = x.id && acct(x.id);
    if (!a) { a = { id: rid(), token: tok(), created: now(), active: true }; S.accounts.unshift(a); }
    if (!str(x.name) && !str(x.company)) throw new E("Give the account a name or company.");
    Object.assign(a, { name: str(x.name), company: str(x.company), email: str(x.email).toLowerCase(), phone: str(x.phone, 40), type: ["client", "partner", "vendor"].includes(x.type) ? x.type : "client", discount: num(x.discount, 0, 90), terms: Math.floor(num(x.terms, 0, 365)), shipTo: addr(x.shipTo), notes: str(x.notes, 2000), active: x.active !== false, pending: false });
  },
  "account.rotate"(b) { const a = acct(b.id); if (a) a.token = tok(); },
  "account.del"(b) {
    if (S.orders.some((o) => o.accountId === b.id)) throw new E("This account has orders. Turn its link off instead of deleting it.");
    S.accounts = S.accounts.filter((a) => a.id !== b.id);
  },
  "order.create"(b) { const a = acct(b.accountId); if (!a) throw new E("Choose an account."); createOrder(a, b, "manual", true); },
  "order.update"(b) {
    const o = order(b.id); if (!o) throw new E("Order not found.");
    const x = b.patch || {};
    if (x.items) { if (o.poId) throw new E("This order is already on a purchase order. Remove it from the PO to change items."); o.items = buildItems(x.items, acct(o.accountId)?.discount, true); ev(o, "Line items edited"); }
    if (x.shipTo) o.shipTo = addr(x.shipTo);
    ["notes", "internal", "adjustNote", "ref", "carrier", "tracking"].forEach((k) => { if (k in x) o[k] = str(x[k], 2000); });
    if ("shipping" in x) o.shipping = r2(num(x.shipping, 0, 1e6));
    if ("adjust" in x) o.adjust = r2(num(x.adjust, -1e6, 1e6));
    if ("terms" in x) o.terms = Math.floor(num(x.terms, 0, 365));
    totals(o);
  },
  "order.status"(b) {
    const o = order(b.id); if (!o) throw new E("Order not found.");
    if (![...O_FLOW, "cancelled"].includes(b.status)) throw new E("Unknown status.");
    if (b.carrier != null) o.carrier = str(b.carrier, 40);
    if (b.tracking != null) o.tracking = str(b.tracking, 80);
    setOrderStatus(o, b.status, b.status === "shipped" ? `Shipped${o.carrier ? " via " + o.carrier : ""}${o.tracking ? " · " + o.tracking : ""}` : null);
  },
  "order.pay"(b) { const o = order(b.id); if (!o) throw new E("Order not found."); addPay(o, b); totals(o); },
  "order.unpay"(b) { const o = order(b.id); if (o) { o.pay = o.pay.filter((p) => p.id !== b.payId); ev(o, "Payment removed"); totals(o); } },
  "order.unlink"(b) { const o = order(b.id); if (o && o.poId) { const p = po(o.poId); o.poId = null; o.items.forEach((i) => (i.lots = [])); if (p) { p.lines.forEach((l) => { const q = o.items.filter((i) => i.pid === l.pid).reduce((s, i) => s + i.qty, 0); l.need = Math.max(0, l.need - q); }); p.lines = p.lines.filter((l) => l.need + l.extra > 0); poTotals(p); ev(p, `${o.num} removed`); } ev(o, "Removed from purchase order"); if (o.status === "ordered") setOrderStatus(o, "confirmed"); } },
  "order.del"(b) { const o = order(b.id); if (!o) return; if (o.poId) throw new E("Remove this order from its purchase order first."); S.orders = S.orders.filter((x) => x.id !== b.id); },
  "po.create"(b) { createPO(b); },
  "po.update"(b) {
    const p = po(b.id); if (!p) throw new E("PO not found.");
    const x = b.patch || {};
    ["notes", "expected", "carrier", "tracking"].forEach((k) => { if (k in x) p[k] = str(x[k], 2000); });
    if ("shipping" in x) p.shipping = r2(num(x.shipping, 0, 1e6));
    if ("terms" in x) p.terms = Math.floor(num(x.terms, 0, 365));
    if (Array.isArray(x.lines)) x.lines.forEach((u) => {
      const l = p.lines.find((y) => y.pid === u.pid); if (!l) return;
      if ("lot" in u) l.lot = str(u.lot, 60);
      if ("exp" in u) l.exp = str(u.exp, 10);
      if (p.status === "draft" && "extra" in u) l.extra = Math.floor(num(u.extra, 0, 1e6));
      if ("unit" in u) l.unit = r2(num(u.unit, 0, 1e6));
    });
    poTotals(p); syncLots(p);
  },
  "po.status"(b) { const p = po(b.id); if (!p) throw new E("PO not found."); if (![...P_FLOW, "cancelled"].includes(b.status)) throw new E("Unknown status."); setPoStatus(p, b.status); },
  "po.pay"(b) { const p = po(b.id); if (!p) throw new E("PO not found."); addPay(p, b); poTotals(p); },
  "po.unpay"(b) { const p = po(b.id); if (p) { p.pay = p.pay.filter((x) => x.id !== b.payId); ev(p, "Payment removed"); poTotals(p); } },
  "po.del"(b) {
    const p = po(b.id); if (!p) return;
    if (p.status !== "draft" && p.status !== "cancelled") throw new E("Only draft or cancelled POs can be deleted.");
    S.orders.forEach((o) => { if (o.poId === p.id) { o.poId = null; o.items.forEach((i) => (i.lots = [])); ev(o, `${p.num} deleted — needs a new purchase order`); if (o.status === "ordered") setOrderStatus(o, "confirmed"); } });
    S.pos = S.pos.filter((x) => x.id !== p.id);
  },
  "product.save"(b) {
    const x = b.p || {}; let p = prod(x.id);
    if (!p) { if (!str(x.n)) throw new E("Name the product."); p = { id: "x" + rid(3), cost: [0, 0, 0], w: [0, 0, 0, 0, 0, 0, 0], on: true }; S.products.push(p); }
    Object.assign(p, { n: str(x.n, 120) || p.n, f: str(x.f, 60) || p.f || "Other", c: str(x.c, 80) || p.c || "Other", on: x.on !== false });
    if (Array.isArray(x.cost) && x.cost.length === 3) p.cost = x.cost.map((v) => r2(num(v)));
    if (Array.isArray(x.w) && x.w.length === 7) p.w = x.w.map((v) => r2(num(v)));
  },
  "settings.save"(b) {
    const x = b.s || {}, s = S.settings;
    const flat = (src, keys) => { const o = {}; keys.forEach((k) => (o[k] = str((src || {})[k], k === "notes" ? 2000 : 200))); return o; };
    s.company = flat(x.company, ["name", "email", "phone", "line1", "line2", "city", "state", "zip", "country", "site"]);
    s.mfr = { ...flat(x.mfr, ["name", "contact", "email", "phone", "line1", "line2", "city", "state", "zip", "country", "notes"]), terms: Math.floor(num(x.mfr?.terms, 0, 365)) };
    s.terms = Math.floor(num(x.terms, 0, 365)); s.moq = Math.floor(num(x.moq, 1, 1e5)); s.publicLink = !!x.publicLink;
    s.webhook = /^https:\/\//.test(str(x.webhook, 500)) ? str(x.webhook, 500) : ""; s.invoiceNote = str(x.invoiceNote, 2000);
  },
  "settings.rotatePublic"() { S.settings.publicToken = tok(); },
};

// ---------- http ----------
const SEC = { "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow", "strict-transport-security": "max-age=31536000" };
const CSP = "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const json = (d, status = 200, extra = {}) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...SEC, ...extra } });
const page = (name) => new Response(Buffer.from(ASSETS[name], "base64"), { headers: { "content-type": "text/html; charset=utf-8", "content-encoding": "gzip", "cache-control": "no-cache", "content-security-policy": CSP, ...SEC } });
const hits = new Map();
function limited(key, max, ms) {
  const t = Date.now(), a = (hits.get(key) || []).filter((x) => t - x < ms);
  a.push(t); hits.set(key, a);
  if (hits.size > 5000) hits.clear();
  return a.length > max;
}
const ipOf = (req, srv) => (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || srv.requestIP(req)?.address || "?";
const cookie = (req) => (req.headers.get("cookie") || "").match(/(?:^|;\s*)mdw_s=([\w-]+)/)?.[1];
function authed(req) {
  const c = cookie(req); if (!c) return false;
  const s = S.sessions[sha(c)]; if (!s) return false;
  if (s < Date.now()) { delete S.sessions[sha(c)]; return false; }
  return true;
}
const hashPw = (pw, salt) => scryptSync(pw, salt, 32).toString("hex");
function newSession(req) {
  const t = tok(), secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  Object.keys(S.sessions).forEach((k) => { if (S.sessions[k] < Date.now()) delete S.sessions[k]; });
  S.sessions[sha(t)] = Date.now() + 30 * 864e5; save();
  return { "set-cookie": `mdw_s=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure ? "; Secure" : ""}` };
}
const adminState = () => ({ settings: S.settings, products: S.products, accounts: S.accounts, orders: S.orders, pos: S.pos, durable: DURABLE, tiers: TIERS, costTiers: COST_TIERS, pack: PACK, now: now() });
function portalData(a) {
  const disc = a ? a.discount || 0 : 0, c = S.settings.company;
  return {
    brand: { name: c.name, email: c.email, phone: c.phone, site: c.site }, tiers: TIERS, pack: PACK, note: S.settings.invoiceNote,
    account: a ? { name: a.name, company: a.company, email: a.email, phone: a.phone, type: a.type, discount: disc, shipTo: a.shipTo } : null,
    products: S.products.filter((p) => p.on).map((p) => ({ id: p.id, f: p.f, c: p.c, n: p.n, p: p.w.map((v) => r2(v * (1 - disc / 100))) })),
    orders: a ? S.orders.filter((o) => o.accountId === a.id).slice(0, 40).map((o) => ({ num: o.num, created: o.created, status: o.status, ts: o.ts, total: o.total, paid: o.paid, units: o.units, ref: o.ref, carrier: o.carrier, tracking: o.tracking, items: o.items.map((i) => ({ n: i.n, f: i.f, qty: i.qty, unit: i.unit, per: i.per, setup: i.setup, pkg: i.pkg, lots: i.lots })), sub: o.sub, setup: o.setup, shipping: o.shipping, adjust: o.adjust })) : [],
  };
}
async function body(req) {
  if (!(req.headers.get("content-type") || "").includes("application/json")) throw new E("Bad request.");
  const t = await req.text();
  if (t.length > 400000) throw new E("Request too large.");
  return JSON.parse(t || "{}");
}

async function handle(req, srv) {
  const url = new URL(req.url), path = url.pathname, m = req.method, ip = ipOf(req, srv);
  if (m === "GET") {
    if (path === "/health") return json({ ok: true, durable: DURABLE });
    if (path === "/") return new Response(null, { status: 302, headers: { location: "/admin" } });
    if (path === "/admin") return page("admin");
    if (path === "/order" || /^\/(o|po)\/[\w-]{10,}$/.test(path)) return page("portal");
    if (path === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n");
  }
  if (!path.startsWith("/api/")) return new Response("Not found", { status: 404, headers: SEC });
  if (m === "POST") {
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== (req.headers.get("x-forwarded-host") || req.headers.get("host"))) return json({ error: "Bad origin." }, 403);
  }
  // --- session ---
  if (path === "/api/session" && m === "GET") return json({ setup: !S.auth, authed: authed(req) });
  if (path === "/api/setup" && m === "POST") {
    if (limited("s" + ip, 8, 9e5)) return json({ error: "Too many attempts. Try again in 15 minutes." }, 429);
    const b = await body(req);
    if (S.auth) return json({ error: "Already set up." }, 400);
    const a = Buffer.from(sha(str(b.code))), c = Buffer.from(sha(SETUP_CODE));
    if (!SETUP_CODE || !timingSafeEqual(a, c)) return json({ error: "That setup code is not right." }, 403);
    if (str(b.password, 200).length < 10) return json({ error: "Use at least 10 characters." }, 400);
    const salt = rid(16); S.auth = { salt, hash: hashPw(String(b.password), salt) };
    return json({ ok: true }, 200, newSession(req));
  }
  if (path === "/api/login" && m === "POST") {
    if (limited("l" + ip, 8, 9e5)) return json({ error: "Too many attempts. Try again in 15 minutes." }, 429);
    const b = await body(req);
    if (!S.auth) return json({ error: "Not set up yet." }, 400);
    const h = Buffer.from(hashPw(String(b.password || ""), S.auth.salt)), g = Buffer.from(S.auth.hash);
    if (!timingSafeEqual(h, g)) return json({ error: "Wrong password." }, 403);
    hits.delete("l" + ip);
    return json({ ok: true }, 200, newSession(req));
  }
  // --- public: order links ---
  let mm;
  if ((mm = path.match(/^\/api\/p\/([\w-]{10,})(\/order)?$/))) {
    const t = mm[1], pub = S.settings.publicLink && t === S.settings.publicToken;
    const a = pub ? null : S.accounts.find((x) => x.token === t && x.active);
    if (!pub && !a) return json({ error: "This order link is not active. Please contact MD Wellness." }, 404);
    if (m === "GET" && !mm[2]) return json(portalData(a));
    if (m === "POST" && mm[2]) {
      if (limited("o" + ip, 12, 36e5)) return json({ error: "Too many orders from this connection. Please try again later." }, 429);
      const b = await body(req);
      if (b.hp) return json({ ok: true, num: "SO-0" });
      const sh = addr(b.shipTo);
      if (!sh.line1 || !sh.city) throw new E("Please enter a shipping address.");
      buildItems(b.items, 0, false);
      let who = a;
      if (!who) {
        const c = b.contact || {}, email = str(c.email).toLowerCase();
        if (!str(c.name) || !/^\S+@\S+\.\S+$/.test(email)) throw new E("Please enter your name and a valid email.");
        who = S.accounts.find((x) => x.email === email && x.pending);
        if (!who) { who = { id: rid(), token: tok(), created: now(), active: true, pending: true, type: "client", discount: 0, terms: S.settings.terms, notes: "Came in through the new-client link.", shipTo: addr(b.shipTo) }; S.accounts.unshift(who); }
        Object.assign(who, { name: str(c.name), company: str(c.company), email, phone: str(c.phone, 40) });
      }
      const o = createOrder(who, b, "link", false);
      save(); hook(o, who);
      return json({ ok: true, num: o.num, total: o.total, link: pub ? "/o/" + who.token : null });
    }
  }
  // --- public: manufacturer PO link ---
  if ((mm = path.match(/^\/api\/m\/([\w-]{10,})$/))) {
    const p = S.pos.find((x) => x.token === mm[1] && x.status !== "draft" && x.status !== "cancelled");
    if (!p) return json({ error: "This purchase order link is not active." }, 404);
    const view = () => ({ brand: S.settings.company, mfr: S.settings.mfr, po: { num: p.num, status: p.status, ts: p.ts, created: p.created, lines: p.lines, sub: p.sub, shipping: p.shipping, total: p.total, notes: p.notes, expected: p.expected, carrier: p.carrier, tracking: p.tracking, shipTo: p.shipTo, terms: p.terms, ack: p.ack, discount: p.discount } });
    if (m === "GET") return json(view());
    if (m === "POST") {
      if (limited("m" + ip, 40, 36e5)) return json({ error: "Too many updates. Try again later." }, 429);
      const b = await body(req);
      if (p.status === "received") throw new E("This order has already been received.");
      if (b.ack && !p.ack) { p.ack = { t: now(), by: str(b.by, 80) }; ev(p, `Acknowledged by manufacturer${b.by ? " (" + str(b.by, 80) + ")" : ""}`); if (p.status === "sent") setPoStatus(p, "confirmed"); }
      if (b.expected != null) p.expected = str(b.expected, 10);
      if (Array.isArray(b.lines)) b.lines.forEach((u) => { const l = p.lines.find((y) => y.pid === u.pid); if (l) { l.lot = str(u.lot, 60); l.exp = str(u.exp, 10); } });
      if (b.status === "production" && ["sent", "confirmed"].includes(p.status)) setPoStatus(p, "production");
      if (b.status === "shipped" && ["sent", "confirmed", "production"].includes(p.status)) { p.carrier = str(b.carrier, 40); p.tracking = str(b.tracking, 80); setPoStatus(p, "shipped"); }
      if (b.lines || b.expected != null) ev(p, "Manufacturer updated lots / dates");
      syncLots(p); save();
      return json(view());
    }
  }
  // --- admin ---
  if (!authed(req)) return json({ error: "Please sign in." }, 401);
  if (path === "/api/state" && m === "GET") return json(adminState());
  if (path === "/api/backup" && m === "GET") return json({ ...S, auth: undefined, sessions: undefined });
  if (path === "/api/logout" && m === "POST") { delete S.sessions[sha(cookie(req))]; save(); return json({ ok: true }, 200, { "set-cookie": "mdw_s=; Path=/; Max-Age=0" }); }
  if (path === "/api/password" && m === "POST") {
    const b = await body(req);
    if (hashPw(String(b.current || ""), S.auth.salt) !== S.auth.hash) throw new E("Current password is wrong.");
    if (str(b.next, 200).length < 10) throw new E("Use at least 10 characters.");
    const salt = rid(16); S.auth = { salt, hash: hashPw(String(b.next), salt) }; S.sessions = {};
    return json({ ok: true }, 200, newSession(req));
  }
  if (path === "/api/act" && m === "POST") {
    const b = await body(req), fn = ACT[b.a];
    if (!fn) throw new E("Unknown action.");
    fn(b); save();
    return json(adminState());
  }
  return json({ error: "Not found." }, 404);
}

load();
Bun.serve({
  port: Number(Bun.env.PORT) || 3000,
  hostname: "0.0.0.0",
  async fetch(req, srv) {
    try { return await handle(req, srv); }
    catch (e) {
      if (e instanceof E) return json({ error: e.message }, 400);
      console.error(e);
      return json({ error: "Something went wrong on our side." }, 500);
    }
  },
});
console.log("MD Wellness Operations up. durable=" + DURABLE + " dir=" + DIR);
