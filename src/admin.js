let D = null;
const V = { view: "overview", open: null, modal: null, oFilter: "open", oq: "", poOff: {}, poExtra: {}, poDisc: 0, money: "recv", tq: "", cq: "", cf: "All", aq: "" };
const NAV = [["overview", "Overview"], ["orders", "Orders"], ["purchasing", "Purchasing"], ["accounts", "Accounts & links"], ["money", "Money"], ["trace", "Traceability"], ["catalog", "Catalog"], ["settings", "Settings"]];
const ICON = { overview: "M3 12l9-8 9 8M5 10v10h14V10", orders: "M4 6h16M4 12h16M4 18h10", purchasing: "M3 7l9-4 9 4-9 4-9-4zm0 5l9 4 9-4M3 17l9 4 9-4", accounts: "M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1m2 7a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1", money: "M12 3v18M17 7H9.5a2.5 2.5 0 000 5h5a2.5 2.5 0 010 5H6", trace: "M3 12a2 2 0 104 0 2 2 0 00-4 0zm7 0a2 2 0 104 0 2 2 0 00-4 0zm7 0a2 2 0 104 0 2 2 0 00-4 0zM7 12h3m4 0h3", catalog: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z", settings: "M12 9a3 3 0 100 6 3 3 0 000-6zm8 3l2-1-2-4-2 1-2-1V4h-4v3l-2 1-2-1-2 4 2 1v2l-2 1 2 4 2-1 2 1v3h4v-3l2-1 2 1 2-4-2-1z" };
const svg = (k) => h`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${ICON[k]}"/></svg>`;

// ---------- derived ----------
const acct = (id) => D.accounts.find((a) => a.id === id) || { name: "Unknown", company: "" };
const aName = (a) => a.company || a.name || "Unnamed";
const order = (id) => D.orders.find((o) => o.id === id);
const po = (id) => D.pos.find((p) => p.id === id);
const prod = (id) => D.products.find((p) => p.id === id);
const bal = (d) => Math.round((d.total - d.paid) * 100) / 100;
const live = (o) => o.status !== "cancelled";
const invoiced = (o) => live(o) && o.status !== "new";
const addDays = (iso, n) => { const d = new Date(iso); d.setDate(d.getDate() + (n || 0)); return d.toISOString().slice(0, 10); };
const due = (o) => addDays(o.ts.confirmed || o.created, o.terms);
const pDue = (p) => addDays(p.ts.sent || p.created, p.terms);
const overdue = (o) => invoiced(o) && bal(o) > 0.005 && due(o) < today();
const pOwed = (p) => !["draft", "cancelled"].includes(p.status);
const needsPO = () => D.orders.filter((o) => o.status === "confirmed" && !o.poId);
// Profit for one client order: revenue = order total; cost = manufacturer unit cost (actual PO cost once placed,
// otherwise the catalog tier for the order quantity, projected past 500), your packaging cost, a share of PO freight, your shipping cost.
function econ(o) {
  const p = o.poId && po(o.poId), placed = !!p && !["draft", "cancelled"].includes(p.status), pc = D.settings.packCost || {};
  let mfg = 0, pack = 0, proj = false;
  const lines = o.items.map((i) => {
    const l = p && p.lines.find((x) => x.pid === i.pid), pr = prod(i.pid);
    let unit = 0, src = "No cost on file";
    if (l) { unit = l.unit; src = p.num + (placed ? "" : " draft"); if (l.proj) { proj = true; src += " · projected"; } }
    else if (pr) { const e = estCost(pr, i.qty, D.settings); unit = e.unit; src = "Catalog " + int(D.costTiers[e.ci]) + "+" + (e.proj ? " · projected" : ""); if (e.proj) proj = true; }
    const k = pc[i.pkg] || { per: 0, setup: 0 }, pk = k.per * i.qty + (k.setup || 0);
    const rev = (i.unit + i.per) * i.qty + i.setup, cost = unit * i.qty + pk;
    mfg += unit * i.qty; pack += pk;
    return { i, unit, src, rev, cost, profit: rev - cost, margin: rev ? (rev - cost) / rev : 0 };
  });
  const tu = p ? p.lines.reduce((x, l) => x + l.qty, 0) : 0, freight = tu ? ((p.shipping || 0) * o.units) / tu : 0;
  const cost = mfg + pack + freight + (o.shipCost || 0), profit = o.total - cost;
  return { lines, mfg, pack, freight, ship: o.shipCost || 0, cost, profit, margin: o.total ? profit / o.total : 0, est: !placed, proj };
}
const pct = (m) => (Math.round(m * 1000) / 10).toFixed(1).replace(/\.0$/, "") + "%";
const profitCell = (o) => { const e = econ(o); return h`<span class="num ${e.profit < 0 ? "bad" : ""}" title="${e.est ? "Estimated — not yet on a sent PO" : "Based on actual PO cost"}">${e.est ? "~" : ""}${money(e.profit)}</span> <span class="faint sm num">${pct(e.margin)}</span>`; };
// Pricing safety across the catalog for one discount setup (an account, or a bare discount).
function safety(a) {
  const ps = D.products.filter((p) => p.on);
  return D.tiers.map((t, ti) => {
    const d = discFor(a, ti); let held = [], min = 1, safe = 100, under = 0, by = null;
    ps.forEach((p) => { const x = sellInfo(p, ti, d, D.settings); if (x.held) held.push({ p, x }); min = Math.min(min, x.margin); if (x.listUnder) under++; else { const m = maxSafe(p, ti, D.settings); if (m < safe) { safe = m; by = p; } } });
    return { t, ti, d, held, min, safe, under, by };
  });
}
const heldCount = (a) => safety(a).reduce((s, r) => s + r.held.length, 0);
function catalogRisk() {
  const out = [];
  D.products.filter((p) => p.on).forEach((p) => D.tiers.forEach((t, ti) => { const x = sellInfo(p, ti, 0, D.settings); if (x.listUnder) out.push({ p, ti, x }); }));
  return out;
}
function stock() {
  const s = {};
  D.pos.filter((p) => p.status === "received").forEach((p) => p.lines.forEach((l) => (s[l.pid] = (s[l.pid] || 0) + l.qty)));
  D.orders.filter((o) => ["shipped", "delivered"].includes(o.status)).forEach((o) => o.items.forEach((i) => (s[i.pid] = (s[i.pid] || 0) - i.qty)));
  return s;
}
const link = (path) => location.origin + path;
const aLink = (a) => link("/o/" + a.token);
const discLabel = (a) => ((a.tierDisc || []).some((v) => v != null) ? "by tier" : a.discount ? a.discount + "%" : "—");
const typePill = (a) => h`<span class="pill plain">${a.pending ? "New lead" : a.type === "partner" ? "Partner" : a.type === "vendor" ? "Vendor" : "Client"}</span>`;
const payState = (d) => (bal(d) <= 0.005 && d.total > 0 ? pill("paid", "Paid") : d.paid > 0 ? pill("ordered", "Part paid") : null);

// ---------- actions ----------
async function act(a, payload, msg) {
  try { D = await api("/api/act", { a, ...payload }); if (msg) toast(msg); render(); return true; }
  catch (e) { if (e.status === 401) return boot(); toast(e.message, true); return false; }
}
function readAcct() {
  const a = V.modal.a, f = (k) => val("a-" + k);
  Object.assign(a, { name: f("name"), company: f("company"), email: f("email"), phone: f("phone"), type: f("type"), discount: Number(f("discount")) || 0, terms: f("terms"), notes: f("notes"), active: f("active"), shipTo: { name: f("sname"), line1: f("line1"), line2: f("line2"), city: f("city"), state: f("state"), zip: f("zip"), country: f("country") } });
  if (V.modal.tiers) a.tierDisc = D.tiers.map((_, i) => { const v = val("a-td" + i); return v === "" || v == null ? null : Math.min(90, Math.max(0, Number(v) || 0)); });
  return a;
}
const val = (id) => { const e = document.getElementById(id); return e ? (e.type === "checkbox" ? e.checked : e.value) : undefined; };
const go = (view) => { V.view = view; V.open = null; location.hash = view; render(); window.scrollTo(0, 0); };
const A = {
  nav: (d) => go(d.v),
  open: (d) => { V.open = { t: d.t, id: d.id }; render(); },
  close: () => { V.open = null; V.modal = null; render(); },
  closeModal: () => { V.modal = null; render(); },
  oFilter: (d) => { V.oFilter = d.v; render(); },
  money: (d) => { V.money = d.v; render(); },
  cf: (d) => { V.cf = d.v; render(); },
  copy: (d) => copy(d.text, d.msg),
  ostatus: (d) => act("order.status", { id: d.id, status: d.s }, "Order " + O_LABEL[d.s].toLowerCase()),
  ocancel: (d) => confirm("Cancel this order?") && act("order.status", { id: d.id, status: "cancelled" }, "Order cancelled"),
  oship: (d) => act("order.status", { id: d.id, status: "shipped", carrier: val("o-carrier"), tracking: val("o-tracking") }, "Marked shipped"),
  odel: (d) => confirm("Delete this order permanently? This cannot be undone.") && act("order.del", { id: d.id }, "Order deleted").then((ok) => ok && A.close()),
  ounlink: (d) => confirm("Remove this order from its purchase order?") && act("order.unlink", { id: d.id }, "Removed from PO"),
  opay: (d) => act("order.pay", { id: d.id, amount: val("pay-amt"), date: val("pay-date"), method: val("pay-method"), ref: val("pay-ref") }, "Payment recorded"),
  ounpay: (d) => confirm("Remove this payment?") && act("order.unpay", { id: d.id, payId: d.pay }),
  ppay: (d) => act("po.pay", { id: d.id, amount: val("pay-amt"), date: val("pay-date"), method: val("pay-method"), ref: val("pay-ref") }, "Payment recorded"),
  punpay: (d) => confirm("Remove this payment?") && act("po.unpay", { id: d.id, payId: d.pay }),
  pstatus: (d) => {
    const p = po(d.id);
    if (d.s === "received" && p.lines.some((l) => !l.lot) && !confirm("Some lines have no lot number yet. Lot numbers are what make each unit traceable. Receive anyway?")) return;
    act("po.status", { id: d.id, status: d.s }, "PO " + P_LABEL[d.s].toLowerCase());
  },
  ptransit: (d) => act("po.update", { id: d.id, patch: { carrier: val("p-carrier"), tracking: val("p-tracking") } }).then((ok) => ok && act("po.status", { id: d.id, status: "shipped" }, "Marked in transit")),
  pcancel: (d) => confirm("Cancel this purchase order?") && act("po.status", { id: d.id, status: "cancelled" }, "PO cancelled"),
  pdel: (d) => confirm("Delete this purchase order? Its client orders go back to 'needs ordering'.") && act("po.del", { id: d.id }, "PO deleted").then((ok) => ok && A.close()),
  pcreate: async () => {
    const ids = needsPO().filter((o) => !V.poOff[o.id]).map((o) => o.id);
    const before = new Set(D.pos.map((p) => p.id));
    if (await act("po.create", { orderIds: ids, extra: V.poExtra, discount: V.poDisc }, "Purchase order created")) {
      V.poExtra = {}; V.poOff = {}; const n = D.pos.find((p) => !before.has(p.id)); if (n) V.open = { t: "po", id: n.id }; render();
    }
  },
  paddstock: () => { const pid = val("stock-pid"), q = Math.floor(Number(val("stock-qty")) || 0); if (pid && q > 0) { V.poExtra[pid] = (V.poExtra[pid] || 0) + q; render(); } },
  acctNew: () => { V.modal = { t: "acct", a: { type: "client", discount: 0, terms: D.settings.terms, active: true, shipTo: {} } }; render(); },
  acctEdit: (d) => { const a = JSON.parse(JSON.stringify(D.accounts.find((x) => x.id === d.id))); V.modal = { t: "acct", a, tiers: (a.tierDisc || []).some((v) => v != null) }; render(); },
  acctSave: async () => {
    const x = readAcct();
    if (!V.modal.tiers) x.tierDisc = null;
    if (await act("account.save", { acct: x }, "Account saved")) { V.modal = null; render(); }
  },
  tierToggle: () => { readAcct(); V.modal.tiers = !V.modal.tiers; if (!V.modal.tiers) V.modal.a.tierDisc = null; render(); },
  acctDel: (d) => confirm("Delete this account?") && act("account.del", { id: d.id }, "Account deleted").then((ok) => { if (ok) { V.modal = null; render(); } }),
  acctRotate: (d) => confirm("Create a new link for this account? The old link stops working immediately.") && act("account.rotate", { id: d.id }, "New link created").then(() => { V.modal = null; render(); }),
  pubRotate: () => confirm("Create a new public link? The old one stops working.") && act("settings.rotatePublic", {}, "New public link created"),
  orderNew: (d) => { V.modal = { t: "order", accountId: d.id || "", lines: [] }; render(); },
  olAdd: () => { const pid = val("ol-pid"), qty = Math.floor(Number(val("ol-qty")) || 0); if (!pid || qty < 1) return toast("Pick a product and quantity", true); V.modal.accountId = val("ol-acct"); V.modal.lines.push({ pid, qty, pkg: val("ol-pkg") }); render(); },
  olDel: (d) => { V.modal.lines.splice(Number(d.i), 1); render(); },
  orderSave: async () => {
    const m = V.modal, a = D.accounts.find((x) => x.id === val("ol-acct"));
    if (!a) return toast("Choose an account", true);
    if (await act("order.create", { accountId: a.id, items: m.lines, notes: val("ol-notes"), ref: val("ol-ref"), shipTo: a.shipTo }, "Order created")) { V.modal = null; V.open = { t: "order", id: D.orders[0].id }; render(); }
  },
  prodEdit: (d) => { V.modal = { t: "prod", p: d.id ? JSON.parse(JSON.stringify(prod(d.id))) : { n: "", f: "10mL Vial", c: "", cost: [0, 0, 0], cx: [null, null, null], w: [0, 0, 0, 0, 0, 0, 0], on: true } }; render(); },
  prodSave: async () => {
    const p = V.modal.p;
    const x = { id: p.id, n: val("p-n"), f: val("p-f"), c: val("p-c"), on: val("p-on"), cost: [0, 1, 2].map((i) => val("p-c" + i)), cx: [0, 1, 2].map((i) => val("p-x" + i)), w: [0, 1, 2, 3, 4, 5, 6].map((i) => val("p-w" + i)) };
    if (await act("product.save", { p: x }, "Product saved")) { V.modal = null; render(); }
  },
  setSave: () => {
    const g = (p, keys) => Object.fromEntries(keys.map((k) => [k, val(p + k)]));
    const AK = ["name", "email", "phone", "line1", "line2", "city", "state", "zip", "country"];
    act("settings.save", { s: { company: g("c-", [...AK, "site"]), mfr: g("m-", [...AK, "contact", "terms", "notes"]), terms: val("s-terms"), moq: val("s-moq"), publicLink: val("s-public"), floor: val("s-floor"), proj: val("s-proj"), packCost: Object.fromEntries(["mdwellness", "clientlabel", "custombottle"].map((k) => [k, { per: val("pc-" + k + "-per"), setup: val("pc-" + k + "-setup") }])), webhook: val("s-webhook"), invoiceNote: val("s-note") } }, "Settings saved");
  },
  pwSave: async () => { try { await api("/api/password", { current: val("pw-cur"), next: val("pw-new") }); toast("Password changed"); render(); } catch (e) { toast(e.message, true); } },
  logout: async () => { await api("/api/logout", {}); boot(); },
  backup: async () => { const d = await api("/api/backup"); dl("mdwellness-backup-" + today() + ".json", JSON.stringify(d, null, 1), "application/json"); },
  doc: (d) => { V.modal = { t: "doc", kind: d.kind, id: d.id }; render(); },
  print: () => window.print(),
  csv: (d) => exportCsv(d.v),
};
function dl(name, text, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
function exportCsv(kind) {
  const q = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  let rows;
  if (kind === "recv") rows = [["Order", "Account", "Invoice date", "Due", "Status", "Total", "Paid", "Balance"], ...D.orders.filter(invoiced).map((o) => [o.num, aName(acct(o.accountId)), (o.ts.confirmed || o.created).slice(0, 10), due(o), O_LABEL[o.status], o.total, o.paid, bal(o)])];
  else if (kind === "pay") rows = [["PO", "Manufacturer", "Sent", "Due", "Status", "Total", "Paid", "Balance"], ...D.pos.filter(pOwed).map((p) => [p.num, D.settings.mfr.name, (p.ts.sent || p.created).slice(0, 10), pDue(p), P_LABEL[p.status], p.total, p.paid, bal(p)])];
  else rows = [["Order", "Date", "Account", "Status", "Product", "Format", "Packaging", "Qty", "Unit", "Line total", "Lot", "PO", "Carrier", "Tracking"], ...D.orders.flatMap((o) => o.items.map((i) => [o.num, o.created.slice(0, 10), aName(acct(o.accountId)), O_LABEL[o.status], i.n, i.f, D.pack[i.pkg].name, i.qty, i.unit + i.per, ((i.unit + i.per) * i.qty + i.setup).toFixed(2), i.lots.map((l) => l.lot).join(" "), o.poId ? po(o.poId)?.num : "", o.carrier, o.tracking]))];
  dl("mdwellness-" + kind + "-" + today() + ".csv", rows.map((r) => r.map(q).join(",")).join("\n"), "text/csv");
}

// ---------- views ----------
const kpi = (label, value, sub, cls) => h`<div class="card kpi"><div class="eyebrow">${label}</div><div class="kv num ${cls || ""}">${value}</div><div class="faint ks">${sub}</div></div>`;
const head = (title, sub, actions) => h`<div class="head"><div><h1>${title}</h1><p class="dim">${sub}</p></div><div class="row wrap">${actions || ""}</div></div>`;

function vOverview() {
  const os = D.orders.filter(live), open = os.filter((o) => o.status !== "delivered");
  const recv = os.filter(invoiced).reduce((s, o) => s + Math.max(0, bal(o)), 0), payb = D.pos.filter(pOwed).reduce((s, p) => s + Math.max(0, bal(p)), 0);
  const d30 = new Date(Date.now() - 30 * 864e5).toISOString();
  const recent = os.filter((o) => invoiced(o) && (o.ts.confirmed || o.created) > d30), rev = recent.reduce((s, o) => s + o.total, 0), cost = recent.reduce((s, o) => s + econ(o).cost, 0);
  const todo = [];
  const add = (n, text, v, cls) => n && todo.push(h`<button class="todo" data-a="nav" data-v="${v}"><span class="tn num ${cls || ""}">${n}</span><span>${text}</span><span class="faint">→</span></button>`);
  const cnt = (s) => os.filter((o) => o.status === s).length;
  add(cnt("new"), "new order" + (cnt("new") === 1 ? "" : "s") + " waiting for your review", "orders", "gold");
  add(needsPO().length, "confirmed order" + (needsPO().length === 1 ? "" : "s") + " not yet placed with the manufacturer", "purchasing", "gold");
  add(D.pos.filter((p) => p.status === "draft").length, "draft PO to send to the manufacturer", "purchasing");
  add(D.pos.filter((p) => p.status === "shipped").length, "inbound shipment to receive", "purchasing");
  add(cnt("received"), "order" + (cnt("received") === 1 ? "" : "s") + " ready to ship to the client", "orders");
  add(os.filter(overdue).length, "overdue client invoice" + (os.filter(overdue).length === 1 ? "" : "s"), "money", "bad");
  add(D.accounts.filter((a) => a.pending).length, "new lead from the public order link to review", "accounts");
  const risk = catalogRisk(), loss = risk.filter((r) => r.x.loss);
  if (loss.length) add(loss.length, "list price" + (loss.length === 1 ? " is" : "s are") + " below manufacturer cost — you lose money at that tier", "catalog", "bad");
  else if (risk.length) add(risk.length, "list price" + (risk.length === 1 ? " is" : "s are") + " under your " + D.settings.floor + "% margin floor", "catalog");
  const col = (s) => { const list = os.filter((o) => o.status === s).slice(0, s === "delivered" ? 4 : 30); return h`<div class="col"><div class="colh"><span>${O_LABEL[s]}</span><span class="num faint">${cnt(s)}</span></div>${list.length ? list.map((o) => h`<button class="ocard" data-a="open" data-t="order" data-id="${o.id}"><div class="row between"><b class="mono">${o.num}</b><span class="num">${money(o.total)}</span></div><div class="oc-a">${aName(acct(o.accountId))}</div><div class="row between faint oc-m"><span>${int(o.units)} units</span><span>${overdue(o) ? h`<span class="bad">overdue</span>` : dt(o.ts[s] || o.created)}</span></div></button>`) : h`<div class="colempty">—</div>`}</div>`; };
  return h`${head("Overview", "Every order, from client request to manufacturer to delivery.", h`<button class="btn" data-a="nav" data-v="accounts">Share an order link</button><button class="btn pri" data-a="orderNew">New order</button>`)}
  ${!D.durable ? h`<div class="banner">Storage volume is not attached — data will not survive a restart. Attach a volume to this service in Railway.</div>` : ""}
  <div class="grid g4">${kpi("Open orders", int(open.length), int(open.reduce((s, o) => s + o.units, 0)) + " units in the pipeline")}${kpi("Clients owe you", money(recv), os.filter(overdue).length ? os.filter(overdue).length + " overdue" : "nothing overdue", os.filter(overdue).length ? "bad" : "")}${kpi("You owe manufacturer", money(payb), D.pos.filter((p) => pOwed(p) && bal(p) > 0).length + " open PO(s)")}${kpi("Last 30 days", money(rev), rev ? "profit " + money(rev - cost) + " · " + pct((rev - cost) / rev) + " margin" : "no confirmed orders yet")}</div>
  <div class="sec"><h2>Needs your attention</h2></div>
  ${todo.length ? h`<div class="todos">${todo}</div>` : h`<div class="card empty">You're all caught up.</div>`}
  <div class="sec"><h2>Pipeline</h2><span class="faint">client order → manufacturer → your dock → client</span></div>
  <div class="board">${O_FLOW.map(col)}</div>`;
}

function vOrders() {
  const q = V.oq.toLowerCase(), f = V.oFilter;
  const list = D.orders.filter((o) => (f === "all" ? true : f === "open" ? live(o) && o.status !== "delivered" : f === "unpaid" ? invoiced(o) && bal(o) > 0.005 : o.status === f)).filter((o) => !q || (o.num + " " + aName(acct(o.accountId)) + " " + acct(o.accountId).name + " " + o.tracking + " " + o.ref + " " + o.items.map((i) => i.n).join(" ")).toLowerCase().includes(q));
  const chips = [["open", "Open"], ...O_FLOW.map((s) => [s, O_LABEL[s]]), ["unpaid", "Unpaid"], ["cancelled", "Cancelled"], ["all", "All"]];
  const n = (k) => (k === "all" || k === "open" || k === "unpaid" ? "" : D.orders.filter((o) => o.status === k).length || "");
  return h`${head("Orders", "Client, partner and vendor orders.", h`<button class="btn" data-a="csv" data-v="orders">Export CSV</button><button class="btn pri" data-a="orderNew">New order</button>`)}
  <div class="row wrap tools"><div class="chips">${chips.map(([k, l]) => h`<button class="chip ${f === k ? "on" : ""}" data-a="oFilter" data-v="${k}">${l}${n(k) ? h` <span class="num">${n(k)}</span>` : ""}</button>`)}</div><input id="oq" class="search" placeholder="Search order, client, product, tracking…" value="${V.oq}"></div>
  <div class="tablewrap">${list.length ? h`<table><thead><tr><th>Order</th><th>Date</th><th>Account</th><th class="right">Units</th><th class="right">Total</th><th class="right">Profit</th><th class="right">Balance</th><th>Status</th><th>Mfr PO</th></tr></thead><tbody>${list.map((o) => { const p = o.poId && po(o.poId); return h`<tr class="click" data-a="open" data-t="order" data-id="${o.id}"><td class="mono nowrap"><b>${o.num}</b></td><td class="nowrap dim">${dt(o.created)}</td><td>${aName(acct(o.accountId))}${o.source === "link" ? h` <span class="faint" title="Came in through an order link">↗</span>` : ""}</td><td class="right num">${int(o.units)}</td><td class="right num">${money(o.total)}</td><td class="right nowrap">${profitCell(o)}</td><td class="right num ${overdue(o) ? "bad" : bal(o) <= 0.005 ? "faint" : ""}">${invoiced(o) ? money(bal(o)) : "—"}</td><td>${pill(o.status, O_LABEL[o.status])}</td><td class="mono dim">${p ? p.num : o.status === "confirmed" ? h`<span class="gold">needed</span>` : "—"}</td></tr>`; })}</tbody></table>` : h`<div class="empty">${D.orders.length ? "No orders match." : h`No orders yet. Share an order link from <a href="#accounts" data-a="nav" data-v="accounts">Accounts & links</a>, or add one yourself.`}</div>`}</div>`;
}

function vPurchasing() {
  const ready = needsPO(), sel = ready.filter((o) => !V.poOff[o.id]), need = {};
  sel.forEach((o) => o.items.forEach((i) => (need[i.pid] = (need[i.pid] || 0) + i.qty)));
  Object.keys(V.poExtra).forEach((pid) => { if (V.poExtra[pid] > 0 && !need[pid]) need[pid] = 0; });
  const st = stock(), moq = D.settings.moq;
  const lines = Object.keys(need).map((pid) => { const p = prod(pid), x = V.poExtra[pid] || 0, qty = need[pid] + x, ti = tierAt(qty, D.costTiers), unit = Math.round(costs(p, D.settings)[ti] * (1 - V.poDisc / 100) * 100) / 100; return { pid, p, need: need[pid], x, qty, ti, unit, proj: projected(p, ti), tot: unit * qty }; }).filter((l) => l.p);
  const total = lines.reduce((s, l) => s + l.tot, 0), short = lines.filter((l) => l.qty < moq).length;
  const mfr = D.settings.mfr.name;
  return h`${head("Purchasing", "Turn confirmed client orders into purchase orders for your manufacturer.", "")}
  ${!mfr ? h`<div class="banner soft">Add your manufacturer's name and email in <a href="#settings" data-a="nav" data-v="settings">Settings</a> so it prints on every PO.</div>` : ""}
  <div class="card build"><div class="row between wrap"><div><h2>Ready to order</h2><p class="dim">${ready.length ? "Tick the client orders to combine. Quantities are added up per product and priced at your manufacturer tier." : "No confirmed orders are waiting. Confirm an order and it shows up here."}</p></div></div>
  ${ready.length ? h`<div class="picks">${ready.map((o) => h`<label class="pick"><input type="checkbox" data-pick="${o.id}" ${V.poOff[o.id] ? "" : raw("checked")}><b class="mono">${o.num}</b><span class="grow">${aName(acct(o.accountId))}</span><span class="num dim">${int(o.units)} units</span><span class="num">${money(o.total)}</span></label>`)}</div>` : ""}
  ${lines.length ? h`<div class="tablewrap flat"><table><thead><tr><th>Product</th><th class="right">For orders</th><th class="right">+ For stock</th><th class="right">Order qty</th><th>Tier</th><th class="right">Unit cost</th><th class="right">Line cost</th></tr></thead><tbody>${lines.map((l) => h`<tr><td>${l.p.n}<div class="faint sm">${l.p.f}${(st[l.pid] || 0) > 0 ? h` · <span class="gold">${int(st[l.pid])} on hand</span>` : ""}</div></td><td class="right num">${int(l.need)}</td><td class="right"><input class="qty num" type="number" min="0" data-extra="${l.pid}" value="${l.x || ""}" placeholder="0"></td><td class="right num"><b>${int(l.qty)}</b>${l.qty < moq ? h`<div class="bad sm">below MOQ ${moq} · <button class="lnk" data-a="moq" data-pid="${l.pid}" data-n="${moq - l.qty}">add ${moq - l.qty}</button></div>` : ""}</td><td class="dim nowrap">${int(D.costTiers[l.ti])}+${l.proj ? h` <span class="projtag" title="Projected — not on your manufacturer's sheet">proj</span>` : ""}</td><td class="right num">${money(l.unit)}</td><td class="right num">${money(l.tot)}</td></tr>`)}</tbody></table></div>
  <div class="row between wrap buildfoot"><div class="row wrap"><label class="row sm dim">Manufacturer discount % <input id="po-disc" class="qty num" type="number" min="0" max="100" value="${V.poDisc || ""}" placeholder="0"></label></div><div class="row wrap"><span class="dim">${lines.length} product${lines.length === 1 ? "" : "s"} · ${int(lines.reduce((s, l) => s + l.qty, 0))} units</span><span class="bigtot num">${money(total)}</span><button class="btn pri" data-a="pcreate">Create purchase order</button></div></div>${lines.some((l) => l.proj) ? h`<p class="gold sm">Lines marked <span class="projtag">proj</span> use a projected cost (${D.settings.proj}% steps below the 500+ price). Confirm the price with your manufacturer — you can edit any unit cost on the draft PO before sending.</p>` : ""}${short ? h`<p class="bad sm">${short} line${short === 1 ? " is" : "s are"} below the manufacturer minimum of ${moq} units per product. Add stock units or combine with another order.</p>` : ""}` : ""}
  <details class="stockadd"><summary>Add a product for stock</summary><div class="row wrap"><select id="stock-pid" style="max-width:420px">${prodOptions()}</select><input id="stock-qty" class="qty num" type="number" min="1" placeholder="Qty"><button class="btn sm" data-a="paddstock">Add</button></div></details></div>
  <div class="sec"><h2>Purchase orders</h2><button class="btn sm" data-a="csv" data-v="pay">Export CSV</button></div>
  <div class="tablewrap">${D.pos.length ? h`<table><thead><tr><th>PO</th><th>Created</th><th>For orders</th><th class="right">Units</th><th class="right">Total</th><th class="right">Balance</th><th>Expected</th><th>Status</th></tr></thead><tbody>${D.pos.map((p) => { const os = D.orders.filter((o) => o.poId === p.id); return h`<tr class="click" data-a="open" data-t="po" data-id="${p.id}"><td class="mono"><b>${p.num}</b></td><td class="dim nowrap">${dt(p.created)}</td><td class="mono dim">${os.length ? os.map((o) => o.num).join(", ") : "stock"}</td><td class="right num">${int(p.lines.reduce((s, l) => s + l.qty, 0))}</td><td class="right num">${money(p.total)}</td><td class="right num ${bal(p) <= 0.005 ? "faint" : ""}">${pOwed(p) ? money(bal(p)) : "—"}</td><td class="dim nowrap">${dt(p.expected) || "—"}</td><td>${pill(p.status, P_LABEL[p.status])}${p.ack ? h` <span class="sage" title="Acknowledged by manufacturer">✓</span>` : ""}</td></tr>`; })}</tbody></table>` : h`<div class="empty">No purchase orders yet.</div>`}</div>`;
}
A.moq = (d) => { V.poExtra[d.pid] = (V.poExtra[d.pid] || 0) + Number(d.n); render(); };
const prodOptions = (selId) => { const by = {}; D.products.filter((p) => p.on).forEach((p) => (by[p.f] = by[p.f] || []).push(p)); return h`<option value="">Choose a product…</option>${Object.keys(by).map((f) => h`<optgroup label="${f}">${by[f].map((p) => h`<option value="${p.id}" ${p.id === selId ? raw("selected") : ""}>${p.n}</option>`)}</optgroup>`)}`; };

function vAccounts() {
  const q = V.aq.toLowerCase(), s = D.settings;
  const list = D.accounts.filter((a) => !q || (a.name + " " + a.company + " " + a.email).toLowerCase().includes(q));
  return h`${head("Accounts & links", "Each client, partner and vendor gets a private order link. Orders they submit land in Orders automatically.", h`<button class="btn pri" data-a="acctNew">New account</button>`)}
  <div class="card publink"><div class="grow"><div class="eyebrow">New-client link</div><h3>One link for anyone who isn't set up yet</h3><p class="dim">They enter their details and build an order at standard wholesale pricing. Their account appears here as a new lead. ${s.publicLink ? "" : h`<b class="bad">Currently off</b> — turn it on in Settings.`}</p>${s.publicLink ? h`<div class="linkbox mono">${link("/o/" + s.publicToken)}</div>` : ""}</div>${s.publicLink ? h`<div class="row wrap"><button class="btn pri" data-a="copy" data-text="${link("/o/" + s.publicToken)}" data-msg="Link copied">Copy link</button><button class="btn ghost sm" data-a="pubRotate">Reset</button></div>` : ""}</div>
  <div class="row tools"><input id="aq" class="search" placeholder="Search accounts…" value="${V.aq}"></div>
  <div class="tablewrap">${list.length ? h`<table><thead><tr><th>Account</th><th>Type</th><th class="right">Discount</th><th class="right">Orders</th><th class="right">Lifetime</th><th class="right">Profit</th><th class="right">Owes</th><th>Order link</th></tr></thead><tbody>${list.map((a) => { const os = D.orders.filter((o) => o.accountId === a.id && live(o)); return h`<tr class="click" data-a="acctEdit" data-id="${a.id}"><td><b>${aName(a)}</b><div class="faint sm">${[a.company ? a.name : "", a.email].filter(Boolean).join(" · ")}</div></td><td>${typePill(a)}</td><td class="right num nowrap">${discLabel(a)}${heldCount(a) ? h` <span class="gold" title="Some prices are held at your margin floor">◆</span>` : ""}</td><td class="right num">${os.length}</td><td class="right num">${money(os.filter(invoiced).reduce((x, o) => x + o.total, 0))}</td><td class="right num">${money(os.filter(invoiced).reduce((x, o) => x + econ(o).profit, 0))}</td><td class="right num">${money(os.filter(invoiced).reduce((x, o) => x + Math.max(0, bal(o)), 0))}</td><td class="nowrap">${a.active ? h`<button class="btn sm" data-a="copy" data-text="${aLink(a)}" data-msg="Order link copied">Copy link</button> <button class="btn sm ghost" data-a="orderNew" data-id="${a.id}">+ Order</button>` : h`<span class="faint">link off</span>`}</td></tr>`; })}</tbody></table>` : h`<div class="empty">${D.accounts.length ? "No accounts match." : "No accounts yet. Create one to get a private order link you can text or email."}</div>`}</div>`;
}

function vMoney() {
  const os = D.orders.filter(invoiced), ps = D.pos.filter(pOwed);
  const recv = os.reduce((s, o) => s + Math.max(0, bal(o)), 0), over = os.filter(overdue).reduce((s, o) => s + bal(o), 0), payb = ps.reduce((s, p) => s + Math.max(0, bal(p)), 0);
  const cashIn = D.orders.reduce((s, o) => s + o.paid, 0), cashOut = D.pos.reduce((s, p) => s + p.paid, 0);
  const tabs = [["recv", "Receivables"], ["pay", "Payables"], ["sum", "Profit summary"]];
  let bodyH;
  if (V.money === "recv") {
    const rows = os.slice().sort((a, b) => (bal(b) > 0.005) - (bal(a) > 0.005) || due(a).localeCompare(due(b)));
    bodyH = h`<div class="tablewrap">${rows.length ? h`<table><thead><tr><th>Invoice</th><th>Client</th><th>Invoiced</th><th>Due</th><th class="right">Total</th><th class="right">Paid</th><th class="right">Balance</th><th></th></tr></thead><tbody>${rows.map((o) => h`<tr class="click" data-a="open" data-t="order" data-id="${o.id}"><td class="mono"><b>${o.num}</b></td><td>${aName(acct(o.accountId))}</td><td class="dim nowrap">${dt(o.ts.confirmed || o.created)}</td><td class="nowrap ${overdue(o) ? "bad" : "dim"}">${dt(due(o))}</td><td class="right num">${money(o.total)}</td><td class="right num dim">${money(o.paid)}</td><td class="right num"><b>${money(bal(o))}</b></td><td>${overdue(o) ? pill("over", "Overdue") : payState(o) || pill("confirmed", "Open")}</td></tr>`)}</tbody></table>` : h`<div class="empty">Confirmed orders show up here as invoices.</div>`}</div>`;
  } else if (V.money === "pay") {
    bodyH = h`<div class="tablewrap">${ps.length ? h`<table><thead><tr><th>PO</th><th>Manufacturer</th><th>Sent</th><th>Due</th><th class="right">Total</th><th class="right">Paid</th><th class="right">Balance</th><th></th></tr></thead><tbody>${ps.map((p) => h`<tr class="click" data-a="open" data-t="po" data-id="${p.id}"><td class="mono"><b>${p.num}</b></td><td>${D.settings.mfr.name || "Manufacturer"}</td><td class="dim nowrap">${dt(p.ts.sent || p.created)}</td><td class="nowrap ${bal(p) > 0.005 && pDue(p) < today() ? "bad" : "dim"}">${dt(pDue(p))}</td><td class="right num">${money(p.total)}</td><td class="right num dim">${money(p.paid)}</td><td class="right num"><b>${money(bal(p))}</b></td><td>${bal(p) > 0.005 && pDue(p) < today() ? pill("over", "Due") : payState(p) || pill("confirmed", "Open")}</td></tr>`)}</tbody></table>` : h`<div class="empty">Purchase orders you've sent show up here as bills.</div>`}</div>`;
  } else {
    const by = {};
    os.forEach((o) => { const k = (o.ts.confirmed || o.created).slice(0, 7), m = (by[k] = by[k] || { rev: 0, cost: 0, n: 0 }); m.rev += o.total; m.cost += econ(o).cost; m.n++; });
    const keys = Object.keys(by).sort().slice(-12), max = Math.max(1, ...keys.map((k) => by[k].rev));
    bodyH = keys.length ? h`<div class="card"><div class="bars">${keys.map((k) => { const m = by[k]; return h`<div class="barcol" title="${k}: ${money(m.rev)} revenue, ${money(m.cost)} cost"><div class="barv num">${money(m.rev - m.cost).replace(/\.\d+$/, "")}</div><div class="bar" style="height:${Math.max(3, (m.rev / max) * 140)}px"><div class="barc" style="height:${m.rev ? (m.cost / m.rev) * 100 : 0}%"></div></div><div class="eyebrow">${new Date(k + "-15").toLocaleDateString("en-US", { month: "short" })}</div></div>`; })}</div><div class="row legend faint sm"><span><i class="lg g"></i>Gross profit</span><span><i class="lg c"></i>Costs</span><span>Number above each bar is gross profit</span></div></div>
    <div class="tablewrap"><table><thead><tr><th>Month</th><th class="right">Orders</th><th class="right">Revenue</th><th class="right">Costs</th><th class="right">Profit</th><th class="right">Margin</th></tr></thead><tbody>${keys.slice().reverse().map((k) => { const m = by[k]; return h`<tr><td>${new Date(k + "-15").toLocaleDateString("en-US", { month: "long", year: "numeric" })}</td><td class="right num">${m.n}</td><td class="right num">${money(m.rev)}</td><td class="right num dim">${money(m.cost)}</td><td class="right num"><b>${money(m.rev - m.cost)}</b></td><td class="right num">${pct(m.rev ? (m.rev - m.cost) / m.rev : 0)}</td></tr>`; })}</tbody></table></div><p class="faint sm">Revenue is the order total (products, setup fees and shipping you charge). Costs are the manufacturer's price — the actual PO unit cost once the order is on a sent PO, otherwise the tier on your manufacturer price sheet (projected above 500 units) — plus your packaging costs, a share of PO freight and your own shipping cost.</p>` : h`<div class="card empty">Confirm an order to start the profit summary.</div>`;
  }
  return h`${head("Money", "What clients owe you, what you owe the manufacturer, and what's left over.", h`<button class="btn" data-a="csv" data-v="${V.money === "pay" ? "pay" : "recv"}">Export CSV</button>`)}
  <div class="grid g4">${kpi("Clients owe you", money(recv), os.filter((o) => bal(o) > 0.005).length + " open invoice(s)")}${kpi("Overdue", money(over), os.filter(overdue).length + " invoice(s) past due", over ? "bad" : "")}${kpi("You owe manufacturer", money(payb), ps.filter((p) => bal(p) > 0.005).length + " open bill(s)")}${kpi("Cash collected − paid", money(cashIn - cashOut), money(cashIn) + " in · " + money(cashOut) + " out")}</div>
  <div class="chips tabs">${tabs.map(([k, l]) => h`<button class="chip ${V.money === k ? "on" : ""}" data-a="money" data-v="${k}">${l}</button>`)}</div>${bodyH}`;
}

function chain(o, i) {
  const p = o.poId && po(o.poId), l = p && p.lines.find((x) => x.pid === i.pid), lot = i.lots[0] || (l && l.lot ? { lot: l.lot, exp: l.exp } : null);
  const node = (done, label, main, sub, a) => h`<div class="tn-node ${done ? "done" : ""}" ${a ? raw(a) : ""}><div class="eyebrow">${label}</div><b class="${done ? "" : "faint"}">${main}</b><span class="faint sm">${sub || raw("&nbsp;")}</span></div>`;
  const rcv = p && p.status === "received";
  return h`<div class="tchain">${node(!!p && p.status !== "draft", "Manufacturer PO", p ? p.num : "Not ordered", p ? P_LABEL[p.status] + (p.ts.sent ? " · " + dt(p.ts.sent) : "") : "", p ? `data-a="open" data-t="po" data-id="${esc(p.id)}"` : "")}${node(!!lot, "Lot", lot ? lot.lot : "No lot yet", lot && lot.exp ? "exp " + dty(lot.exp) : "")}${node(rcv || O_FLOW.indexOf(o.status) >= 3, "Received", rcv ? dt(p.ts.received) : O_FLOW.indexOf(o.status) >= 3 ? dt(o.ts.received) || "From stock" : "Pending", rcv ? "at " + D.settings.company.name : "")}${node(O_FLOW.indexOf(o.status) >= 4, "Shipped to client", o.ts.shipped ? dt(o.ts.shipped) : "Pending", [o.carrier, o.tracking].filter(Boolean).join(" "))}${node(o.status === "delivered", "Delivered", o.ts.delivered ? dt(o.ts.delivered) : "Pending", aName(acct(o.accountId)))}</div>`;
}
function vTrace() {
  const q = V.tq.toLowerCase().trim();
  const rows = D.orders.filter(live).flatMap((o) => o.items.map((i) => ({ o, i }))).filter(({ o, i }) => { if (!q) return true; const p = o.poId && po(o.poId), l = p && p.lines.find((x) => x.pid === i.pid); return [o.num, aName(acct(o.accountId)), i.n, o.tracking, p && p.num, l && l.lot, ...i.lots.map((x) => x.lot)].filter(Boolean).join(" ").toLowerCase().includes(q); });
  return h`${head("Traceability", "Follow any unit from the manufacturer's lot to the client's door — or start from a lot number and see everyone who received it.", h`<button class="btn" data-a="csv" data-v="orders">Export full trace CSV</button>`)}
  <div class="row tools"><input id="tq" class="search big" placeholder="Search a lot number, order, PO, client, product or tracking number…" value="${V.tq}"></div>
  ${rows.length ? rows.slice(0, 60).map(({ o, i }) => h`<div class="card trow"><div class="row between wrap"><div><b>${i.n}</b> <span class="faint">${i.f} · ${int(i.qty)} units</span></div><button class="lnk mono" data-a="open" data-t="order" data-id="${o.id}">${o.num} · ${aName(acct(o.accountId))}</button></div>${chain(o, i)}</div>`) : h`<div class="card empty">${q ? "Nothing matches that search." : "Orders appear here as soon as they come in."}</div>`}${rows.length > 60 ? h`<p class="faint sm">Showing the first 60 of ${rows.length}. Narrow the search to see more.</p>` : ""}`;
}

function vCatalog() {
  const q = V.cq.toLowerCase(), st = stock(), fs = ["All", ...new Set(D.products.map((p) => p.f))];
  const risk = (p) => { let lo = 1, lt = 0, safe = 100; D.tiers.forEach((t, ti) => { const x = sellInfo(p, ti, 0, D.settings); if (x.margin < lo) { lo = x.margin; lt = ti; } safe = Math.min(safe, maxSafe(p, ti, D.settings)); }); return { lo, lt, safe }; };
  const fl = D.settings.floor / 100, under = (p) => risk(p).lo < fl - 1e-9;
  const list = D.products.filter((p) => (V.cf === "All" || (V.cf === "Below floor" ? under(p) : p.f === V.cf)) && (!q || (p.n + " " + p.c).toLowerCase().includes(q)));
  const nUnder = D.products.filter((p) => p.on && under(p)).length;
  return h`${head("Catalog", "Manufacturer cost from your price sheet (25+ / 250+ / 500+, projected to 5,000+) against your wholesale tiers.", h`<button class="btn pri" data-a="prodEdit">Add product</button>`)}
  ${nUnder ? h`<div class="banner soft">${nUnder} product${nUnder === 1 ? " has" : "s have"} a list price under your ${D.settings.floor}% margin floor at some tier${D.products.some((p) => p.on && risk(p).lo < 0) ? h` — <b>including at least one sold below cost</b>` : ""}. Discounts are switched off for those tiers automatically. <button class="lnk" data-a="cf" data-v="Below floor">Show them</button></div>` : ""}
  <div class="row wrap tools"><div class="chips">${[...fs, "Below floor"].map((f) => h`<button class="chip ${V.cf === f ? "on" : ""}" data-a="cf" data-v="${f}">${f}${f === "Below floor" && nUnder ? h` <span class="num">${nUnder}</span>` : ""}</button>`)}</div><input id="cq" class="search" placeholder="Search products…" value="${V.cq}"></div>
  <div class="tablewrap"><table><thead><tr><th>Product</th><th class="right">Cost 25+</th><th class="right">Cost 500+</th><th class="right">Cost 5,000+</th><th class="right">Sell 25+</th><th class="right">Sell 250+</th><th class="right">Sell 5,000+</th><th class="right">Lowest margin</th><th class="right">Max safe (all tiers)</th><th class="right">On hand</th></tr></thead><tbody>${list.map((p) => { const c = costs(p, D.settings), r = risk(p); return h`<tr class="click ${p.on ? "" : "off"}" data-a="prodEdit" data-id="${p.id}"><td>${p.n}<div class="faint sm">${p.f} · ${p.c}${p.on ? "" : " · hidden from links"}</div></td><td class="right num dim">${money(c[0])}</td><td class="right num dim">${money(c[2])}</td><td class="right num dim">${money(c[5])}${projected(p, 5) ? h`<div><span class="projtag">proj</span></div>` : ""}</td><td class="right num">${money(p.w[2])}</td><td class="right num">${money(p.w[3])}</td><td class="right num">${money(p.w[6])}</td><td class="right num ${r.lo < 0 ? "bad" : r.lo < fl - 1e-9 ? "gold" : ""}">${pct(r.lo)}<div class="faint sm">at ${int(D.tiers[r.lt])}+</div></td><td class="right num">${r.safe}%</td><td class="right num ${st[p.id] > 0 ? "gold" : "faint"}">${int(st[p.id] || 0)}</td></tr>`; })}</tbody></table></div>
  <p class="faint sm">Lowest margin is the thinnest tier at list price. Max safe discount is the largest single discount that keeps every tier of that product above your ${D.settings.floor}% floor. Costs above 500 units are projected at ${D.settings.proj}% steps below the 500+ price unless you enter the real price on the product.</p>`;
}

const fld = (id, label, value, attrs) => h`<label class="f"><span>${label}</span><input id="${id}" value="${value == null ? "" : value}" ${raw(attrs || "")}></label>`;
const addrFields = (pre, a) => h`<div class="grid g2">${fld(pre + "line1", "Address", a.line1)}${fld(pre + "line2", "Suite / unit", a.line2)}</div><div class="grid g4">${fld(pre + "city", "City", a.city)}${fld(pre + "state", "State", a.state)}${fld(pre + "zip", "ZIP", a.zip)}${fld(pre + "country", "Country", a.country)}</div>`;
function vSettings() {
  const s = D.settings, c = s.company, m = s.mfr;
  return h`${head("Settings", "Your company details, your manufacturer, and how order links behave.", h`<button class="btn pri" data-a="setSave">Save settings</button>`)}
  <div class="grid g2 setgrid"><div class="card stack"><h3>Your company</h3><p class="faint sm">Printed on invoices, packing slips and purchase orders. Also the ship-to address on manufacturer POs.</p><div class="grid g2">${fld("c-name", "Company name", c.name)}${fld("c-site", "Website", c.site)}${fld("c-email", "Email", c.email)}${fld("c-phone", "Phone", c.phone)}</div>${addrFields("c-", c)}</div>
  <div class="card stack"><h3>Your manufacturer</h3><p class="faint sm">Every purchase order is addressed to them.</p><div class="grid g2">${fld("m-name", "Manufacturer name", m.name)}${fld("m-contact", "Contact person", m.contact)}${fld("m-email", "Email", m.email)}${fld("m-phone", "Phone", m.phone)}</div>${addrFields("m-", m)}<div class="grid g2">${fld("m-terms", "Payment terms (days after PO sent)", m.terms, 'type="number" min="0"')}${fld("s-moq", "Minimum units per product", s.moq, 'type="number" min="1"')}</div><label class="f"><span>Standard note printed on every PO</span><textarea id="m-notes">${m.notes}</textarea></label></div>
  <div class="card stack"><h3>Pricing protection</h3><p class="faint sm">Applies to every discount, on order links and on orders you enter yourself.</p><div class="grid g2">${fld("s-floor", "Minimum margin on any discounted price %", s.floor, 'type="number" min="0" max="60" step="0.5"')}${fld("s-proj", "Projected cost step per tier above 500 units %", s.proj, 'type="number" min="0" max="15" step="0.5"')}</div><p class="faint sm">With a ${s.proj}% step, the manufacturer cost is assumed to be ${100 - s.proj}% of the 500+ price at 1,000+, ${100 - 2 * s.proj}% at 2,500+ and ${100 - 3 * s.proj}% at 5,000+. Your sheet shows a 9.1% drop from 250+ to 500+, so ${s.proj}% per step is deliberately cautious. Set the margin to 0 to only block selling below cost.</p>
  <h3 style="margin-top:6px">Your packaging costs</h3><p class="faint sm">What labels and custom bottles cost you, so they're counted against profit. Leave 0 if the manufacturer's price already includes them.</p><div class="pcgrid"><span></span><span class="eyebrow">Per unit $</span><span class="eyebrow">Setup per order line $</span>${["mdwellness", "clientlabel", "custombottle"].map((k) => h`<span class="dim">${D.pack[k].name}</span><input id="pc-${k}-per" type="number" step="0.01" min="0" value="${(s.packCost || {})[k]?.per || ""}" placeholder="0.00"><input id="pc-${k}-setup" type="number" step="0.01" min="0" value="${(s.packCost || {})[k]?.setup || ""}" placeholder="0.00">`)}</div></div>
  <div class="card stack"><h3>Order links & invoices</h3>${fld("s-terms", "Default client payment terms (days after confirmation, 0 = due on receipt)", s.terms, 'type="number" min="0"')}<label class="row"><input type="checkbox" id="s-public" ${s.publicLink ? raw("checked") : ""}> <span>Allow the new-client link (anyone with it can submit an order request)</span></label><label class="f"><span>Note printed on invoices and shown on order links</span><textarea id="s-note">${s.invoiceNote}</textarea></label>${fld("s-webhook", "New-order webhook (optional https URL — e.g. an n8n webhook that emails or texts you)", s.webhook, 'placeholder="https://"')}</div>
  <div class="card stack"><h3>Security & backup</h3><div class="grid g2">${fld("pw-cur", "Current password", "", 'type="password" autocomplete="current-password"')}${fld("pw-new", "New password (10+ characters)", "", 'type="password" autocomplete="new-password"')}</div><div class="row wrap"><button class="btn" data-a="pwSave">Change password</button><button class="btn" data-a="backup">Download full backup</button><button class="btn ghost" data-a="logout">Sign out</button></div><p class="faint sm">Storage: ${D.durable ? "persistent volume attached, with a daily automatic backup kept for 3 weeks." : "NOT persistent — attach a volume."}</p></div></div>`;
}

// ---------- drawers ----------
const payBlock = (d, t) => h`<div class="blk"><div class="row between"><h3>Payments</h3><span class="num ${bal(d) > 0.005 ? "" : "sage"}">${bal(d) > 0.005 ? money(bal(d)) + " due" : d.total > 0 ? "Paid in full" : ""}</span></div>${(d.pay || []).map((p) => h`<div class="row payrow"><span class="dim">${dty(p.date)}</span><span class="grow">${[p.method, p.ref].filter(Boolean).join(" · ") || "Payment"}</span><b class="num">${money(p.amount)}</b><button class="lnk faint" data-a="${t === "order" ? "ounpay" : "punpay"}" data-id="${d.id}" data-pay="${p.id}" title="Remove">×</button></div>`)}<div class="payadd"><input id="pay-amt" class="num" type="number" step="0.01" placeholder="Amount" value="${bal(d) > 0.005 ? bal(d).toFixed(2) : ""}"><input id="pay-date" type="date" value="${today()}"><select id="pay-method">${["ACH", "Wire", "Check", "Card", "Zelle", "Cash", "Other"].map((m) => h`<option>${m}</option>`)}</select><input id="pay-ref" placeholder="Reference #"><button class="btn sm" data-a="${t === "order" ? "opay" : "ppay"}" data-id="${d.id}">Record</button></div></div>`;
const log = (d) => h`<div class="blk"><h3>Activity</h3><div class="log">${(d.ev || []).slice().reverse().map((e) => h`<div><span class="faint mono">${new Date(e.t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span> ${e.m}</div>`)}</div></div>`;

function profitBlock(o) {
  const e = econ(o), neg = e.profit < 0;
  return h`<div class="blk"><div class="row between"><h3>Profit on this order</h3><span class="profit num ${neg ? "bad" : "gold"}">${e.est ? "~" : ""}${money(e.profit)} <span class="faint">· ${pct(e.margin)}</span></span></div>
  <div class="tablewrap flat"><table class="lines"><thead><tr><th>Product</th><th class="right">Sell</th><th class="right">Cost</th><th>Cost from</th><th class="right">Profit</th></tr></thead><tbody>${e.lines.map((l) => h`<tr><td>${l.i.n}<div class="faint sm">${int(l.i.qty)} units</div></td><td class="right num">${money(l.i.unit + l.i.per)}</td><td class="right num">${money(l.unit)}</td><td class="sm ${l.src.includes("projected") ? "gold" : "dim"}">${l.src}</td><td class="right num ${l.profit < 0 ? "bad" : ""}">${money(l.profit)}<div class="faint sm">${pct(l.margin)}</div></td></tr>`)}</tbody></table></div>
  <div class="tot"><div><span>Revenue (order total)</span><span class="num">${money(o.total)}</span></div><div><span>Manufacturer cost</span><span class="num">−${money(e.mfg)}</span></div>${e.pack ? h`<div><span>Your packaging cost</span><span class="num">−${money(e.pack)}</span></div>` : ""}${e.freight ? h`<div><span>Share of PO freight</span><span class="num">−${money(e.freight)}</span></div>` : ""}<div><span>Your shipping cost</span><input class="num qty" type="number" step="0.01" min="0" data-opatch="shipCost" value="${o.shipCost || ""}" placeholder="0.00"></div><div class="g"><span>Profit</span><span class="num ${neg ? "bad" : ""}">${money(e.profit)}</span></div></div>
  ${e.est ? h`<p class="faint sm">Estimated until this order is on a sent purchase order, then it uses the actual PO cost.${e.proj ? " Some lines use a projected manufacturer cost above 500 units." : ""}</p>` : ""}${neg ? h`<p class="bad sm">This order loses money. Check the line costs above.</p>` : ""}</div>`;
}
function dOrder(o) {
  const a = acct(o.accountId), p = o.poId && po(o.poId), i = O_FLOW.indexOf(o.status);
  let next = "";
  if (o.status === "new") next = h`<div class="next"><div><b>New order — review it</b><p class="dim sm">Confirming creates the invoice and queues it for a manufacturer PO.</p></div><div class="row"><button class="btn danger sm" data-a="ocancel" data-id="${o.id}">Decline</button><button class="btn pri" data-a="ostatus" data-id="${o.id}" data-s="confirmed">Confirm order</button></div></div>`;
  else if (o.status === "confirmed" && !p) next = h`<div class="next"><div><b>Needs to be placed with the manufacturer</b><p class="dim sm">Or ship it from stock you already have.</p></div><div class="row"><button class="btn sm" data-a="ostatus" data-id="${o.id}" data-s="received">Fulfil from stock</button><button class="btn pri" data-a="nav" data-v="purchasing">Create PO</button></div></div>`;
  else if (p && i < 3) next = h`<div class="next"><div><b>On ${p.num} — ${P_LABEL[p.status].toLowerCase()}</b><p class="dim sm">${p.expected ? "Expected " + dty(p.expected) : "This order moves forward when the PO is received."}</p></div><button class="btn pri" data-a="open" data-t="po" data-id="${p.id}">Open ${p.num}</button></div>`;
  else if (o.status === "received") next = h`<div class="next col"><div><b>Ready to ship to ${aName(a)}</b></div><div class="row wrap"><select id="o-carrier" style="width:120px">${["UPS", "FedEx", "USPS", "DHL", "Courier", "Pickup"].map((c) => h`<option ${o.carrier === c ? raw("selected") : ""}>${c}</option>`)}</select><input id="o-tracking" class="grow mono" placeholder="Tracking number" value="${o.tracking}"><button class="btn pri" data-a="oship" data-id="${o.id}">Mark shipped</button></div></div>`;
  else if (o.status === "shipped") next = h`<div class="next"><div><b>In transit to client</b><p class="dim sm mono">${o.carrier} ${trackUrl(o.carrier, o.tracking) ? h`<a href="${trackUrl(o.carrier, o.tracking)}" target="_blank" rel="noopener">${o.tracking}</a>` : o.tracking}</p></div><button class="btn pri" data-a="ostatus" data-id="${o.id}" data-s="delivered">Mark delivered</button></div>`;
  return h`<div class="dh"><div><div class="eyebrow">${o.source === "link" ? "Via order link" : "Entered manually"} · ${dty(o.created)}${o.ref ? " · Client PO " + o.ref : ""}</div><h2><span class="mono">${o.num}</span> · ${aName(a)}</h2></div><div class="row">${pill(o.status, O_LABEL[o.status])}<button class="btn ghost sm" data-a="close" aria-label="Close">✕</button></div></div>
  ${o.status === "cancelled" ? "" : steps(O_FLOW, O_LABEL, o.status, o.ts)}${next}
  <div class="blk"><div class="row between"><h3>Items</h3><span class="faint sm">${int(o.units)} units</span></div><table class="lines"><tbody>${o.items.map((it) => h`<tr><td>${it.n}<div class="faint sm">${it.f} · ${D.pack[it.pkg].name}${it.lots.length ? h` · <span class="gold mono">Lot ${it.lots.map((l) => l.lot).join(", ")}</span>` : ""}</div></td><td class="right num nowrap">${int(it.qty)} × ${money(it.unit + it.per)}</td><td class="right num">${money((it.unit + it.per) * it.qty)}</td></tr>`)}</tbody></table>
  <div class="tot"><div><span>Products</span><span class="num">${money(o.sub)}</span></div>${o.setup ? h`<div><span>Packaging setup fees</span><span class="num">${money(o.setup)}</span></div>` : ""}<div><span>Shipping charged</span><input class="num qty" type="number" step="0.01" min="0" data-opatch="shipping" value="${o.shipping || ""}" placeholder="0.00"></div><div><span>Adjustment (+/−)</span><input class="num qty" type="number" step="0.01" data-opatch="adjust" value="${o.adjust || ""}" placeholder="0.00"></div><div class="g"><span>Total</span><span class="num">${money(o.total)}</span></div></div></div>
  ${profitBlock(o)}
  ${payBlock(o, "order")}
  <div class="blk"><h3>Track & trace</h3>${o.items.map((it) => h`<div class="faint sm" style="margin-top:8px">${it.n}</div>${chain(o, it)}`)}</div>
  <div class="blk grid g2"><div><h3>Ship to</h3><p class="dim">${addrLines(o.shipTo).map((l) => h`${l}<br>`)}</p><p class="faint sm">${[a.name, a.email, a.phone].filter(Boolean).join(" · ")}</p></div><div><h3>Client note</h3><p class="dim">${o.notes || "—"}</p><label class="f" style="margin-top:10px"><span>Internal note (never shown to the client)</span><textarea data-opatch="internal">${o.internal}</textarea></label></div></div>
  <div class="blk row wrap"><button class="btn sm" data-a="doc" data-kind="invoice" data-id="${o.id}">Invoice</button><button class="btn sm" data-a="doc" data-kind="slip" data-id="${o.id}">Packing slip</button><span class="grow"></span><select class="statussel" data-ostatus="${o.id}" aria-label="Set status manually"><option value="">Set status manually…</option>${[...O_FLOW, "cancelled"].map((s) => h`<option value="${s}">${O_LABEL[s]}</option>`)}</select>${p && p.status === "draft" ? h`<button class="btn sm ghost" data-a="ounlink" data-id="${o.id}">Remove from PO</button>` : ""}<button class="btn sm ghost danger" data-a="odel" data-id="${o.id}">Delete</button></div>
  ${log(o)}`;
}

function dPO(p) {
  const os = D.orders.filter((o) => o.poId === p.id), m = D.settings.mfr, url = link("/po/" + p.token), i = P_FLOW.indexOf(p.status);
  const mail = "mailto:" + encodeURIComponent(m.email || "") + "?subject=" + encodeURIComponent(`${D.settings.company.name} Purchase Order ${p.num}`) + "&body=" + encodeURIComponent(`Hi ${m.contact || ""},\n\nPlease find our purchase order ${p.num} here:\n${url}\n\nYou can acknowledge it, add lot numbers and post tracking from that page.\n\nTotal: ${money(p.total)} · ${int(p.lines.reduce((s, l) => s + l.qty, 0))} units\n\nThank you,\n${D.settings.company.name}`);
  let next = "";
  if (p.status === "draft") next = h`<div class="next"><div><b>Draft — check quantities and costs, then send</b><p class="dim sm">Sending moves its client orders to "In production".</p></div><button class="btn pri" data-a="pstatus" data-id="${p.id}" data-s="sent">Mark as sent</button></div>`;
  else if (i >= 1 && i < 4) next = h`<div class="next col"><div><b>${p.ack ? "Acknowledged by manufacturer" + (p.ack.by ? " (" + p.ack.by + ")" : "") : "Waiting on the manufacturer"}</b><p class="dim sm">When they ship, record the inbound tracking.</p></div><div class="row wrap">${p.status === "sent" ? h`<button class="btn sm" data-a="pstatus" data-id="${p.id}" data-s="confirmed">Confirmed</button>` : ""}${i < 3 ? h`<button class="btn sm" data-a="pstatus" data-id="${p.id}" data-s="production">In production</button>` : ""}<input id="p-carrier" style="width:110px" placeholder="Carrier" value="${p.carrier}"><input id="p-tracking" class="grow mono" placeholder="Inbound tracking" value="${p.tracking}"><button class="btn pri sm" data-a="ptransit" data-id="${p.id}">In transit</button></div></div>`;
  else if (p.status === "shipped") next = h`<div class="next"><div><b>Inbound${p.carrier ? " via " + p.carrier : ""}</b><p class="dim sm mono">${trackUrl(p.carrier, p.tracking) ? h`<a href="${trackUrl(p.carrier, p.tracking)}" target="_blank" rel="noopener">${p.tracking}</a>` : p.tracking || "Enter lot numbers below, then receive."}</p></div><button class="btn pri" data-a="pstatus" data-id="${p.id}" data-s="received">Receive goods</button></div>`;
  return h`<div class="dh"><div><div class="eyebrow">Purchase order · ${dty(p.created)}</div><h2><span class="mono">${p.num}</span> · ${m.name || "Manufacturer"}</h2></div><div class="row">${pill(p.status, P_LABEL[p.status])}<button class="btn ghost sm" data-a="close" aria-label="Close">✕</button></div></div>
  ${p.status === "cancelled" ? "" : steps(P_FLOW, P_LABEL, p.status, p.ts)}${next}
  ${p.status !== "draft" && p.status !== "cancelled" ? h`<div class="blk share"><div class="grow"><div class="eyebrow">Manufacturer link</div><div class="linkbox mono">${url}</div><p class="faint sm">They can view the PO, acknowledge it, enter lot numbers and post tracking. No login needed.</p></div><div class="row wrap"><button class="btn sm pri" data-a="copy" data-text="${url}" data-msg="Manufacturer link copied">Copy link</button><a class="btn sm" href="${mail}">Email it</a></div></div>` : ""}
  <div class="blk"><div class="row between"><h3>Lines</h3><span class="faint sm">Lot numbers flow through to every client order on this PO</span></div><div class="tablewrap flat"><table class="lines"><thead><tr><th>Product</th><th class="right">Qty</th><th class="right">Unit cost</th><th>Lot #</th><th>Expiry</th></tr></thead><tbody>${p.lines.map((l) => h`<tr><td>${l.n}<div class="faint sm">${l.f}${l.extra ? " · " + int(l.need) + " for orders + " + int(l.extra) + " stock" : ""}</div></td><td class="right num">${int(l.qty)}</td><td class="right"><input class="qty num" type="number" step="0.01" data-pline="${l.pid}" data-k="unit" value="${l.unit}">${l.proj ? h`<div><span class="projtag" title="Projected cost — confirm with your manufacturer">proj</span></div>` : ""}</td><td><input class="mono lot" data-pline="${l.pid}" data-k="lot" value="${l.lot}" placeholder="—"></td><td><input type="date" class="exp" data-pline="${l.pid}" data-k="exp" value="${l.exp}"></td></tr>`)}</tbody></table></div>
  <div class="tot"><div><span>Products${p.discount ? " (after " + p.discount + "% discount)" : ""}</span><span class="num">${money(p.sub)}</span></div><div><span>Freight / fees</span><input class="num qty" type="number" step="0.01" min="0" data-ppatch="shipping" value="${p.shipping || ""}" placeholder="0.00"></div><div class="g"><span>Total</span><span class="num">${money(p.total)}</span></div></div></div>
  <div class="blk grid g2"><label class="f"><span>Expected arrival</span><input type="date" data-ppatch="expected" value="${p.expected}"></label><label class="f"><span>Payment terms (days)</span><input type="number" min="0" data-ppatch="terms" value="${p.terms}"></label><label class="f" style="grid-column:1/-1"><span>Notes to manufacturer</span><textarea data-ppatch="notes">${p.notes}</textarea></label></div>
  <div class="blk"><h3>Client orders on this PO</h3>${os.length ? os.map((o) => h`<button class="row linkrow" data-a="open" data-t="order" data-id="${o.id}"><b class="mono">${o.num}</b><span class="grow">${aName(acct(o.accountId))}</span><span class="num dim">${int(o.units)} units</span>${pill(o.status, O_LABEL[o.status])}</button>`) : h`<p class="faint">Stock order — not tied to a client order.</p>`}</div>
  ${p.status === "draft" ? "" : payBlock(p, "po")}
  <div class="blk row wrap"><button class="btn sm" data-a="doc" data-kind="po" data-id="${p.id}">Print / save PO</button><span class="grow"></span><select class="statussel" data-pstatus="${p.id}" aria-label="Set status manually"><option value="">Set status manually…</option>${P_FLOW.map((s) => h`<option value="${s}">${P_LABEL[s]}</option>`)}</select>${p.status === "draft" || p.status === "cancelled" ? h`<button class="btn sm ghost danger" data-a="pdel" data-id="${p.id}">Delete</button>` : h`<button class="btn sm ghost danger" data-a="pcancel" data-id="${p.id}">Cancel PO</button>`}</div>
  ${log(p)}`;
}

// ---------- modals ----------
function mAcct() {
  const a = V.modal.a, s = a.shipTo || {};
  return h`<div class="mh"><h2>${a.id ? "Edit account" : "New account"}</h2><button class="btn ghost sm" data-a="closeModal">✕</button></div>
  ${a.id && a.active ? h`<div class="share inm"><div class="grow"><div class="eyebrow">Private order link</div><div class="linkbox mono">${aLink(a)}</div></div><button class="btn sm pri" data-a="copy" data-text="${aLink(a)}" data-msg="Order link copied">Copy</button></div>` : ""}
  ${a.pending ? h`<div class="banner soft">New lead from the public link. Saving marks them as reviewed.</div>` : ""}
  <div class="stack"><div class="grid g2">${fld("a-company", "Company", a.company)}${fld("a-name", "Contact name", a.name)}${fld("a-email", "Email", a.email, 'type="email"')}${fld("a-phone", "Phone", a.phone)}</div>
  <div class="grid g2"><label class="f"><span>Type</span><select id="a-type">${[["client", "Client"], ["partner", "Partner"], ["vendor", "Vendor"]].map(([k, l]) => h`<option value="${k}" ${a.type === k ? raw("selected") : ""}>${l}</option>`)}</select></label>${fld("a-terms", "Payment terms (days)", a.terms, 'type="number" min="0"')}</div>
  <div class="pricebox"><div class="row between wrap"><h3>Pricing & discount</h3><button class="btn sm" data-a="tierToggle">${V.modal.tiers ? "Use one discount for all tiers" : "Set a different discount per tier"}</button></div>
  <p class="faint sm">Discounts come off your wholesale list price. Protected by your ${D.settings.floor}% margin floor: if a discount would push any product below it, that price is held at the floor instead, so you never sell at a loss.</p>
  <div class="grid ${V.modal.tiers ? "g4" : "g2"}">${fld("a-discount", V.modal.tiers ? "Default %" : "Discount on all tiers %", a.discount || "", 'type="number" min="0" max="90" step="0.5" placeholder="0"')}${V.modal.tiers ? D.tiers.map((t, i) => fld("a-td" + i, int(t) + "+ units %", (a.tierDisc || [])[i], `type="number" min="0" max="90" step="0.5" placeholder="${a.discount || 0}"`)) : ""}</div>
  <div id="safety">${safetyHTML(a)}</div></div>
  <h3>Default ship-to</h3>${fld("a-sname", "Ship-to name", s.name)}${addrFields("a-", s)}
  <label class="f"><span>Internal notes</span><textarea id="a-notes">${a.notes || ""}</textarea></label>
  <label class="row"><input type="checkbox" id="a-active" ${a.active !== false ? raw("checked") : ""}> <span>Order link is active</span></label></div>
  <div class="mf">${a.id ? h`<button class="btn ghost sm danger" data-a="acctDel" data-id="${a.id}">Delete</button><button class="btn ghost sm" data-a="acctRotate" data-id="${a.id}">Reset link</button>` : ""}<span class="grow"></span><button class="btn" data-a="closeModal">Cancel</button><button class="btn pri" data-a="acctSave">Save account</button></div>`;
}
function safetyHTML(a) {
  const rows = safety(a), held = rows.reduce((x, r) => x + r.held.length, 0), any = rows.some((r) => r.d > 0), fl = D.settings.floor;
  return h`<div class="safesum ${held ? "warn" : "ok"}">${!any ? h`No discount — every product sells at list price.` : held ? h`<b>${held} price${held === 1 ? " is" : "s are"} held at your ${fl}% floor.</b> The discount would have taken ${held === 1 ? "it" : "them"} below. Raise the floor in Settings or lower the discount on the tiers marked below.` : h`<b>Safe.</b> Every product stays at or above your ${fl}% margin floor at every tier.`}</div>
  <div class="tablewrap flat"><table class="safetbl"><thead><tr><th>Tier</th><th class="right">Discount</th><th class="right">Max safe</th><th class="right">Lowest margin</th><th>Status</th></tr></thead><tbody>${rows.map((r) => h`<tr><td class="nowrap">${int(r.t)}+${r.ti >= 4 ? h` <span class="projtag" title="Uses projected manufacturer cost">proj</span>` : ""}</td><td class="right num">${r.d ? r.d + "%" : "—"}</td><td class="right num ${r.d > r.safe ? "bad" : "dim"}">${r.safe}%${r.by ? h`<div class="faint sm limby">${r.by.n.split(" – ")[0]} ${r.by.f.replace("15mL ", "").replace("10mL ", "")}</div>` : ""}</td><td class="right num ${r.min < fl / 100 - 1e-9 ? "bad" : ""}">${pct(r.min)}</td><td class="sm">${r.held.length ? h`<span class="gold">${r.held.length} held at floor</span>` : r.d ? h`<span class="sage">✓ safe</span>` : h`<span class="faint">list price</span>`}${r.under ? h` <span class="faint" title="List price already under the floor for ${r.under} product(s) — see Catalog">· ${r.under} under floor at list</span>` : ""}</td></tr>`)}</tbody></table></div>
  ${held ? h`<details class="heldlist"><summary>See the ${held} held price${held === 1 ? "" : "s"}</summary><table class="lines"><thead><tr><th>Product</th><th>Tier</th><th class="right">Discount would give</th><th class="right">Charged</th><th class="right">Cost</th></tr></thead><tbody>${rows.flatMap((r) => r.held.map(({ p, x }) => h`<tr><td>${p.n}<div class="faint sm">${p.f}</div></td><td class="nowrap">${int(r.t)}+</td><td class="right num bad">${money(x.want)}</td><td class="right num">${money(x.price)}</td><td class="right num dim">${money(x.cost)}${x.proj ? h` <span class="projtag">proj</span>` : ""}</td></tr>`)).slice(0, 120)}</tbody></table></details>` : ""}
  <p class="faint sm">"Max safe" is the largest discount on that tier that keeps every product above the floor, and the product that sets that limit. Tiers marked proj use your projected manufacturer cost.</p>`;
}
function mOrder() {
  const m = V.modal, a = D.accounts.find((x) => x.id === m.accountId);
  let total = 0;
  const rows = m.lines.map((l, i) => { const p = prod(l.pid), k = D.pack[l.pkg], ti = tierAt(l.qty, D.tiers), si = sellInfo(p, ti, discFor(a, ti), D.settings), unit = si.price, setup = k.setup && !(k.waive && l.qty >= k.waive) ? k.setup : 0, t = (unit + k.per) * l.qty + setup; total += t; return h`<tr><td>${p.n}<div class="faint sm">${p.f} · ${k.name}${setup ? " · + " + money(setup) + " setup" : ""}${si.held ? h` · <span class="gold">held at ${D.settings.floor}% floor</span>` : ""}</div></td><td class="right num nowrap">${int(l.qty)} × ${money(unit + k.per)}</td><td class="right num">${money(t)}</td><td><button class="lnk faint" data-a="olDel" data-i="${i}">×</button></td></tr>`; });
  return h`<div class="mh"><h2>New order</h2><button class="btn ghost sm" data-a="closeModal">✕</button></div>
  <div class="stack"><div class="grid g2"><label class="f"><span>Account</span><select id="ol-acct"><option value="">Choose…</option>${D.accounts.map((x) => h`<option value="${x.id}" ${x.id === m.accountId ? raw("selected") : ""}>${aName(x)}${x.discount ? " (" + x.discount + "% off)" : ""}</option>`)}</select></label>${fld("ol-ref", "Client's PO / reference (optional)", "")}</div>
  <div class="addline"><select id="ol-pid">${prodOptions()}</select><input id="ol-qty" class="num" type="number" min="1" placeholder="Qty"><select id="ol-pkg">${Object.keys(D.pack).map((k) => h`<option value="${k}">${D.pack[k].name}</option>`)}</select><button class="btn" data-a="olAdd">Add</button></div>
  ${rows.length ? h`<table class="lines"><tbody>${rows}</tbody></table><div class="tot"><div class="g"><span>Total</span><span class="num">${money(total)}</span></div></div>` : h`<p class="faint">Add products above. Prices follow the wholesale tier for each quantity, less this account's discount, never below your ${D.settings.floor}% margin floor.</p>`}
  <label class="f"><span>Note</span><textarea id="ol-notes"></textarea></label></div>
  <div class="mf"><span class="grow"></span><button class="btn" data-a="closeModal">Cancel</button><button class="btn pri" data-a="orderSave" ${rows.length ? "" : raw("disabled")}>Create order</button></div>`;
}
function mProd() {
  const p = V.modal.p;
  return h`<div class="mh"><h2>${p.id ? "Edit product" : "Add product"}</h2><button class="btn ghost sm" data-a="closeModal">✕</button></div>
  <div class="stack">${fld("p-n", "Name & strength", p.n)}<div class="grid g2">${fld("p-f", "Format", p.f, 'list="fmts"')}${fld("p-c", "Category", p.c, 'list="cats"')}</div><datalist id="fmts">${[...new Set(D.products.map((x) => x.f))].map((f) => h`<option value="${f}">`)}</datalist><datalist id="cats">${[...new Set(D.products.map((x) => x.c))].map((f) => h`<option value="${f}">`)}</datalist>
  <h3>Manufacturer cost per unit</h3><p class="faint sm">25+ / 250+ / 500+ come from your manufacturer's price sheet. Leave 1,000+ and up blank to use the projected cost shown, or enter the real price once your manufacturer quotes it.</p><div class="grid g3">${D.costTiers.slice(0, 3).map((t, i) => fld("p-c" + i, int(t) + "+ units", p.cost[i], 'type="number" step="0.01" min="0"'))}${D.costTiers.slice(3).map((t, k) => fld("p-x" + k, int(t) + "+ units (blank = projected)", (p.cx || [])[k], `type="number" step="0.01" min="0" placeholder="${p.id ? costs(p, D.settings)[k + 3].toFixed(2) + " projected" : "projected"}"`))}</div>
  <h3>Wholesale price per unit</h3><div class="grid g4">${D.tiers.map((t, i) => fld("p-w" + i, int(t) + "+ units", p.w[i], 'type="number" step="0.01" min="0"'))}</div>
  <label class="row"><input type="checkbox" id="p-on" ${p.on !== false ? raw("checked") : ""}> <span>Show on order links</span></label></div>
  <div class="mf"><span class="grow"></span><button class="btn" data-a="closeModal">Cancel</button><button class="btn pri" data-a="prodSave">Save product</button></div>`;
}
function mDoc() {
  const { kind, id } = V.modal, c = D.settings.company, isPO = kind === "po", d = isPO ? po(id) : order(id), a = isPO ? null : acct(d.accountId), m = D.settings.mfr;
  const title = isPO ? "Purchase Order" : kind === "slip" ? "Packing Slip" : "Invoice";
  const lines = isPO ? d.lines.map((l) => ({ n: l.n, f: l.f + (l.lot ? " · Lot " + l.lot : ""), qty: l.qty, unit: l.unit, tot: l.unit * l.qty })) : d.items.map((i) => ({ n: i.n, f: i.f + " · " + D.pack[i.pkg].name + (i.lots.length ? " · Lot " + i.lots.map((l) => l.lot + (l.exp ? " (exp " + l.exp + ")" : "")).join(", ") : ""), qty: i.qty, unit: i.unit + i.per, tot: (i.unit + i.per) * i.qty }));
  const price = kind !== "slip";
  return h`<div class="mh noprint"><h2>${title} ${d.num}</h2><div class="row"><button class="btn pri" data-a="print">Print / save as PDF</button><button class="btn ghost sm" data-a="closeModal">✕</button></div></div>
  <div class="paper" id="paper"><div class="p-top"><div><div class="p-brand">${c.name}</div><div class="p-sm">${addrLines(c).slice(1).map((l) => h`${l}<br>`)}${c.email}${c.phone ? " · " + c.phone : ""}</div></div><div class="p-right"><div class="p-title">${title}</div><div class="p-num">${d.num}</div><div class="p-sm">${dty(isPO ? d.ts.sent || d.created : d.ts.confirmed || d.created)}${!isPO && kind === "invoice" ? h`<br>Due ${dty(due(d))}` : ""}${!isPO && d.ref ? h`<br>Your PO: ${d.ref}` : ""}</div></div></div>
  <div class="p-cols"><div><div class="p-lab">${isPO ? "Supplier" : "Bill to"}</div>${isPO ? h`<b>${m.name || "Manufacturer"}</b><br>${[m.contact, ...addrLines(m).slice(1), m.email].filter(Boolean).map((l) => h`${l}<br>`)}` : h`<b>${aName(a)}</b><br>${[a.company ? a.name : "", a.email, a.phone].filter(Boolean).map((l) => h`${l}<br>`)}`}</div><div><div class="p-lab">Ship to</div>${isPO ? h`<b>${c.name}</b><br>${addrLines(c).slice(1).map((l) => h`${l}<br>`)}` : addrLines(d.shipTo).map((l, k) => (k ? h`${l}<br>` : h`<b>${l}</b><br>`))}</div><div><div class="p-lab">${isPO ? "Terms" : "Shipment"}</div>${isPO ? h`Net ${d.terms} days${d.expected ? h`<br>Needed by ${dty(d.expected)}` : ""}` : h`${d.carrier || "—"}<br>${d.tracking}`}</div></div>
  <table class="p-table"><thead><tr><th>Item</th><th class="right">Qty</th>${price ? h`<th class="right">Unit</th><th class="right">Amount</th>` : ""}</tr></thead><tbody>${lines.map((l) => h`<tr><td><b>${l.n}</b><div class="p-sm">${l.f}</div></td><td class="right">${int(l.qty)}</td>${price ? h`<td class="right">${money(l.unit)}</td><td class="right">${money(l.tot)}</td>` : ""}</tr>`)}</tbody></table>
  ${price ? h`<div class="p-tot">${isPO ? h`<div><span>Subtotal</span><span>${money(d.sub)}</span></div>${d.shipping ? h`<div><span>Freight / fees</span><span>${money(d.shipping)}</span></div>` : ""}` : h`<div><span>Subtotal</span><span>${money(d.sub)}</span></div>${d.setup ? h`<div><span>Packaging setup</span><span>${money(d.setup)}</span></div>` : ""}${d.shipping ? h`<div><span>Shipping</span><span>${money(d.shipping)}</span></div>` : ""}${d.adjust ? h`<div><span>Adjustment</span><span>${money(d.adjust)}</span></div>` : ""}`}<div class="p-g"><span>Total</span><span>${money(d.total)}</span></div>${!isPO && d.paid ? h`<div><span>Paid</span><span>${money(d.paid)}</span></div><div class="p-g"><span>Balance due</span><span>${money(bal(d))}</span></div>` : ""}</div>` : h`<div class="p-sm" style="margin-top:14px">Total units: ${int(d.units)}</div>`}
  <div class="p-note">${isPO ? d.notes : kind === "slip" ? d.notes : D.settings.invoiceNote}</div></div>`;
}

// ---------- shell ----------
function render() {
  if (!D) return;
  const ae = document.activeElement, fid = ae && ae.id, sel = fid && ae.selectionStart;
  const views = { overview: vOverview, orders: vOrders, purchasing: vPurchasing, accounts: vAccounts, money: vMoney, trace: vTrace, catalog: vCatalog, settings: vSettings };
  const badge = { orders: D.orders.filter((o) => o.status === "new").length, purchasing: needsPO().length, accounts: D.accounts.filter((a) => a.pending).length };
  const sy = $("#drawer .dbody")?.scrollTop;
  $("#app").innerHTML = h`<aside class="side"><div class="brand"><b>MD Wellness</b><span class="eyebrow">Operations</span></div><nav class="nav">${NAV.map(([k, l]) => h`<button class="${V.view === k ? "on" : ""}" data-a="nav" data-v="${k}">${svg(k)}<span>${l}</span>${badge[k] ? h`<i class="num">${badge[k]}</i>` : ""}</button>`)}</nav><div class="sidefoot faint sm">${D.settings.company.site}</div></aside><main class="main">${(views[V.view] || vOverview)()}</main>
  <div id="drawer" class="${V.open ? "show" : ""}">${V.open ? h`<div class="scrim" data-a="close"></div><div class="dbody">${V.open.t === "order" ? (order(V.open.id) ? dOrder(order(V.open.id)) : "") : po(V.open.id) ? dPO(po(V.open.id)) : ""}</div>` : ""}</div>
  <div id="modal" class="${V.modal ? "show" : ""} ${V.modal?.t === "doc" ? "docm" : ""}">${V.modal ? h`<div class="scrim" data-a="closeModal"></div><div class="mbody">${{ acct: mAcct, order: mOrder, prod: mProd, doc: mDoc }[V.modal.t]()}</div>` : ""}</div>`.s;
  if (sy) { const b = $("#drawer .dbody"); if (b) b.scrollTop = sy; }
  if (fid) { const e = document.getElementById(fid); if (e) { e.focus(); try { e.setSelectionRange(sel, sel); } catch {} } }
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-a]"); if (!b || b.disabled) return; if (b.tagName === "A" && b.getAttribute("href")?.startsWith("#")) e.preventDefault(); if (e.target.closest("input,select,textarea,label.pick") && !b.matches("button")) return; const fn = A[b.dataset.a]; if (fn) { e.stopPropagation(); fn(b.dataset, b, e); } });
document.addEventListener("input", (e) => {
  const t = e.target, map = { oq: "oq", aq: "aq", tq: "tq", cq: "cq" };
  if (map[t.id]) { V[map[t.id]] = t.value; render(); }
  else if (V.modal && V.modal.t === "acct" && (t.id === "a-discount" || t.id.startsWith("a-td"))) { readAcct(); $("#safety").innerHTML = safetyHTML(V.modal.a).s; if (t.id === "a-discount") $$("[id^=a-td]").forEach((x) => (x.placeholder = t.value || 0)); }
});
document.addEventListener("change", (e) => {
  const t = e.target, d = t.dataset;
  if (d.pick) { V.poOff[d.pick] = !t.checked; render(); }
  else if (d.extra) { V.poExtra[d.extra] = Math.max(0, Math.floor(Number(t.value) || 0)); render(); }
  else if (t.id === "po-disc") { V.poDisc = Math.min(100, Math.max(0, Number(t.value) || 0)); render(); }
  else if (d.opatch) act("order.update", { id: V.open.id, patch: { [d.opatch]: t.value } }, "Saved");
  else if (d.ppatch) act("po.update", { id: V.open.id, patch: { [d.ppatch]: t.value } }, "Saved");
  else if (d.pline) act("po.update", { id: V.open.id, patch: { lines: [{ pid: d.pline, [d.k]: t.value }] } }, "Saved");
  else if (d.ostatus && t.value) act("order.status", { id: d.ostatus, status: t.value }, "Status updated");
  else if (d.pstatus && t.value) act("po.status", { id: d.pstatus, status: t.value }, "Status updated");
  else if (t.id === "ol-acct" && V.modal) { V.modal.accountId = t.value; render(); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && (V.modal || V.open)) { if (V.modal) V.modal = null; else V.open = null; render(); } });
window.addEventListener("hashchange", () => { const v = location.hash.slice(1); if (NAV.some((n) => n[0] === v) && v !== V.view) { V.view = v; V.open = null; render(); } });

function authScreen(setup, err) {
  $("#app").innerHTML = h`<div class="auth"><form class="card stack" id="authf"><div class="brand"><b>MD Wellness</b><span class="eyebrow">Operations</span></div><h2>${setup ? "Set up your dashboard" : "Sign in"}</h2>${setup ? h`<p class="dim">Enter the one-time setup code, then choose the password you'll use from now on.</p>${fld("au-code", "Setup code", "", 'autocomplete="off" required')}` : ""}${fld("au-pw", setup ? "Choose a password (10+ characters)" : "Password", "", `type="password" required autocomplete="${setup ? "new-password" : "current-password"}"`)}${setup ? fld("au-pw2", "Repeat password", "", 'type="password" required autocomplete="new-password"') : ""}${err ? h`<p class="bad">${err}</p>` : ""}<button class="btn pri" type="submit">${setup ? "Create dashboard" : "Sign in"}</button></form></div>`.s;
  $("#authf").onsubmit = async (e) => {
    e.preventDefault();
    if (setup && val("au-pw") !== val("au-pw2")) return authScreen(true, "Passwords don't match.");
    try { await api(setup ? "/api/setup" : "/api/login", { code: val("au-code"), password: val("au-pw") }); boot(); } catch (x) { authScreen(setup, x.message); }
  };
  (setup ? $("#au-code") : $("#au-pw")).focus();
}
async function boot() {
  D = null;
  try {
    const s = await api("/api/session");
    if (!s.authed) return authScreen(s.setup);
    D = await api("/api/state");
    const v = location.hash.slice(1); if (NAV.some((n) => n[0] === v)) V.view = v;
    render();
  } catch (e) { $("#app").innerHTML = h`<div class="auth"><div class="card">Can't reach the server. <a href="">Retry</a></div></div>`.s; }
}
setInterval(async () => {
  if (!D || V.modal || document.hidden || ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
  try { const n = await api("/api/state"), was = D.orders.length; const same = JSON.stringify([n.orders, n.pos, n.accounts]) === JSON.stringify([D.orders, D.pos, D.accounts]); D = n; if (!same) { render(); if (n.orders.length > was) toast("New order received"); } } catch (e) { if (e.status === 401) boot(); }
}, 20000);
boot();
