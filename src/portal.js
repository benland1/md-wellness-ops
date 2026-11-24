const parts = location.pathname.split("/").filter(Boolean), MODE = parts[0] === "po" ? "po" : "order", TOKEN = parts[1] || "";
let P = null, M = null;
const S = { tab: "shop", q: "", f: "All", cart: {}, open: {}, done: null, busy: false, form: null };
const app = () => $("#app");
const top = (sub, right) => h`<header class="ptop"><div class="brand"><b>${(P || M).brand.name}</b><span class="eyebrow">${sub}</span></div><div class="row">${right || ""}</div></header>`;
const fail = (msg) => { app().innerHTML = h`<div class="pwrap"><div class="card empty" style="margin-top:80px"><h2>Link not available</h2><p class="dim" style="margin-top:8px">${msg}</p></div></div>`.s; };

// ---------- order portal ----------
const price = (p, qty) => p.p[tierIdx(Math.max(1, qty), P.tiers)];
function calc() {
  let sub = 0, setup = 0, units = 0;
  const lines = Object.keys(S.cart).map((id) => { const l = S.cart[id], p = P.products.find((x) => x.id === id), k = P.pack[l.pkg], unit = price(p, l.qty), su = k.setup && !(k.waive && l.qty >= k.waive) ? k.setup : 0; sub += (unit + k.per) * l.qty; setup += su; units += l.qty; return { id, p, l, k, unit, su, tot: (unit + k.per) * l.qty }; });
  return { lines, sub, setup, units, total: sub + setup };
}
function keep() { const f = {}; $$("[data-f]").forEach((e) => (f[e.dataset.f] = e.value)); S.form = { ...(S.form || {}), ...f }; }
const fv = (k, d) => (S.form && S.form[k] != null ? S.form[k] : d || "");
const fin = (k, label, d, attrs) => h`<label class="f"><span>${label}</span><input data-f="${k}" id="f-${k}" value="${fv(k, d)}" ${raw(attrs || "")}></label>`;
function shop() {
  const q = S.q.toLowerCase(), fs = ["All", ...new Set(P.products.map((p) => p.f))];
  const list = P.products.filter((p) => (S.f === "All" || p.f === S.f) && (!q || (p.n + " " + p.c).toLowerCase().includes(q)));
  const cats = [...new Set(list.map((p) => p.c))], c = calc(), a = P.account, s = (a && a.shipTo) || {};
  return h`<div class="shop"><section><div class="row wrap tools"><div class="chips">${fs.map((f) => h`<button class="chip ${S.f === f ? "on" : ""}" data-a="f" data-v="${f}">${f}</button>`)}</div><input id="pq" class="search" placeholder="Search ${P.products.length} products…" value="${S.q}"></div>
  <p class="faint sm tiernote">Prices drop automatically as quantity goes up: ${P.tiers.map((t) => int(t) + "+").join(" · ")} units per product.${a && a.discount ? h` Your account discount of <b class="gold">${a.discount}%</b> is already applied.` : ""}</p>
  ${cats.map((cat) => h`<h3 class="cat">${cat}</h3><div class="plist">${list.filter((p) => p.c === cat).map((p) => { const l = S.cart[p.id], qty = l ? l.qty : 0, ti = tierIdx(Math.max(1, qty), P.tiers); return h`<div class="prow ${qty ? "in" : ""}"><div class="grow"><div class="pn">${p.n}</div><div class="faint sm">${p.f} · <button class="lnk" data-a="breaks" data-id="${p.id}">${S.open[p.id] ? "hide price breaks" : "price breaks"}</button></div>${S.open[p.id] || qty ? h`<div class="breaks">${P.tiers.map((t, i) => h`<span class="${qty && i === ti ? "on" : ""}"><i>${int(t)}+</i><b class="num">${money(p.p[i])}</b></span>`)}</div>` : ""}</div><div class="pp"><div class="num pu">${money(price(p, qty))}</div><div class="faint sm">${qty ? "per unit" : "from " + money(p.p[6])}</div></div><input class="qty num" type="number" min="0" inputmode="numeric" placeholder="Qty" data-qty="${p.id}" value="${qty || ""}" aria-label="Quantity for ${p.n}"></div>`; })}</div>`)}${list.length ? "" : h`<div class="card empty">No products match.</div>`}</section>
  <aside class="cart card" id="cart"><h2>Your order</h2>${c.lines.length ? h`<div class="clines">${c.lines.map((x) => h`<div class="cline"><div class="row between"><b>${x.p.n}</b><button class="lnk faint" data-a="rm" data-id="${x.id}" aria-label="Remove">×</button></div><div class="faint sm">${x.p.f} · ${int(x.l.qty)} × ${money(x.unit + x.k.per)}</div><div class="row between" style="margin-top:6px"><select data-pkg="${x.id}" aria-label="Packaging">${Object.keys(P.pack).map((k) => h`<option value="${k}" ${x.l.pkg === k ? raw("selected") : ""}>${P.pack[k].name}${P.pack[k].per ? " +" + money(P.pack[k].per) + "/unit" : ""}</option>`)}</select><span class="num nowrap">${money(x.tot)}</span></div>${x.su ? h`<div class="faint sm">+ ${money(x.su)} one-time setup${x.k.waive ? " (waived at " + x.k.waive + "+ units)" : ""}</div>` : ""}</div>`)}</div>
  <div class="tot"><div><span>${int(c.units)} units</span><span class="num">${money(c.sub)}</span></div>${c.setup ? h`<div><span>Setup fees</span><span class="num">${money(c.setup)}</span></div>` : ""}<div class="g"><span>Estimated total</span><span class="num">${money(c.total)}</span></div><div class="faint sm"><span>Shipping is added when your order is confirmed.</span></div></div>
  <div class="stack cform">${a ? "" : h`<h3>Your details</h3><div class="grid g2">${fin("cname", "Your name *", "", 'autocomplete="name"')}${fin("company", "Company", "", 'autocomplete="organization"')}${fin("email", "Email *", "", 'type="email" autocomplete="email"')}${fin("phone", "Phone", "", 'autocomplete="tel"')}</div>`}<h3>Ship to</h3>${fin("sname", "Recipient / company", s.name || (a ? a.company || a.name : ""))}${fin("line1", "Address *", s.line1, 'autocomplete="address-line1"')}${fin("line2", "Suite / unit", s.line2)}<div class="grid g3">${fin("city", "City *", s.city)}${fin("state", "State", s.state)}${fin("zip", "ZIP", s.zip)}</div>${fin("ref", "Your PO / reference number (optional)", "")}<label class="f"><span>Notes (optional)</span><textarea data-f="notes" placeholder="Label artwork, timing, special instructions…">${fv("notes")}</textarea></label><input data-f="hp" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true"><button class="btn pri big" data-a="submit" ${S.busy ? raw("disabled") : ""}>${S.busy ? "Sending…" : "Submit order"}</button><p class="faint sm">${P.note}</p></div>` : h`<p class="dim" style="margin-top:8px">Enter a quantity next to any product to start your order.</p>`}</aside></div>
  ${c.lines.length ? h`<a class="mbar" href="#cart"><span>${int(c.units)} units · <b class="num">${money(c.total)}</b></span><span>Review order ↓</span></a>` : ""}`;
}
function history() {
  return P.orders.length ? h`<div class="hist">${P.orders.map((o) => h`<div class="card"><div class="row between wrap"><div><span class="eyebrow">${dty(o.created)}${o.ref ? " · PO " + o.ref : ""}</span><h2 class="mono" style="margin-top:6px">${o.num}</h2></div><div class="right"><div class="num" style="font-size:18px;color:var(--bone)">${money(o.total)}</div>${o.status === "cancelled" ? pill("cancelled", "Cancelled") : o.total - o.paid > 0.005 && o.status !== "new" ? h`<span class="faint sm">${money(o.total - o.paid)} due</span>` : o.status !== "new" ? h`<span class="sm" style="color:var(--sage)">Paid</span>` : ""}</div></div>${o.status === "cancelled" ? "" : steps(O_FLOW, O_LABEL, o.status, o.ts)}${o.tracking ? h`<p class="track">${o.carrier} tracking: ${trackUrl(o.carrier, o.tracking) ? h`<a class="mono" href="${trackUrl(o.carrier, o.tracking)}" target="_blank" rel="noopener">${o.tracking}</a>` : h`<span class="mono">${o.tracking}</span>`}</p>` : ""}<table class="lines"><tbody>${o.items.map((i) => h`<tr><td>${i.n}<div class="faint sm">${i.f} · ${P.pack[i.pkg].name}${i.lots.length ? h` · <span class="gold mono">Lot ${i.lots.map((l) => l.lot).join(", ")}</span>` : ""}</div></td><td class="right num nowrap">${int(i.qty)} × ${money(i.unit + i.per)}</td></tr>`)}</tbody></table>${o.setup || o.shipping || o.adjust ? h`<p class="faint sm right">${[o.setup ? "setup " + money(o.setup) : "", o.shipping ? "shipping " + money(o.shipping) : "", o.adjust ? "adjustment " + money(o.adjust) : ""].filter(Boolean).join(" · ")}</p>` : ""}</div>`)}</div>` : h`<div class="card empty">Your orders will appear here with live status and tracking.</div>`;
}
function rOrder() {
  const a = P.account;
  if (S.done) { app().innerHTML = h`${top("Wholesale ordering")}<div class="pwrap"><div class="card okcard"><div class="check">✓</div><h1>Order ${S.done.num} received</h1><p class="dim">Thank you${a ? ", " + (a.name || a.company) : ""}. We'll review and confirm it shortly. Estimated total <b class="num">${money(S.done.total)}</b> before shipping.</p>${S.done.link ? h`<div class="linkbox mono">${location.origin + S.done.link}</div><p class="faint sm">This is your private link. Save it to track this order and reorder without re-entering your details.</p><div class="row" style="justify-content:center"><a class="btn pri" href="${S.done.link}">Open my order page</a></div>` : h`<div class="row" style="justify-content:center"><button class="btn pri" data-a="tab" data-v="hist">Track this order</button><button class="btn" data-a="tab" data-v="shop">Place another</button></div>`}</div></div>`.s; return; }
  const ae = document.activeElement, fid = ae && (ae.id || (ae.dataset.qty && "q-" + ae.dataset.qty));
  app().innerHTML = h`${top("Wholesale ordering", a ? h`<span class="dim who">${a.company || a.name}</span>` : "")}<div class="pwrap"><div class="phero"><h1>${S.tab === "shop" ? (a ? "Build your order" : "Start a wholesale order") : "Your orders"}</h1>${a ? h`<div class="chips"><button class="chip ${S.tab === "shop" ? "on" : ""}" data-a="tab" data-v="shop">Place an order</button><button class="chip ${S.tab === "hist" ? "on" : ""}" data-a="tab" data-v="hist">Your orders <span class="num">${P.orders.length}</span></button></div>` : ""}</div>${S.tab === "shop" ? shop() : history()}<footer class="pfoot faint sm">${P.brand.name}${P.brand.email ? h` · <a href="mailto:${P.brand.email}">${P.brand.email}</a>` : ""}${P.brand.site ? " · " + P.brand.site : ""}</footer></div>`.s;
  if (fid) { const e = fid.startsWith("q-") ? $(`[data-qty="${fid.slice(2)}"]`) : document.getElementById(fid); if (e) { e.focus(); try { const n = e.value.length; e.setSelectionRange(n, n); } catch {} } }
}
async function submit() {
  keep(); const f = S.form || {}, c = calc(); if (!c.lines.length || S.busy) return;
  if (!P.account && (!f.cname || !/^\S+@\S+\.\S+$/.test(f.email || ""))) return toast("Please enter your name and a valid email.", true);
  if (!f.line1 || !f.city) return toast("Please enter a shipping address.", true);
  S.busy = true; rOrder();
  try {
    const r = await api(`/api/p/${TOKEN}/order`, { items: c.lines.map((x) => ({ pid: x.id, qty: x.l.qty, pkg: x.l.pkg })), shipTo: { name: f.sname, line1: f.line1, line2: f.line2, city: f.city, state: f.state, zip: f.zip }, contact: { name: f.cname, company: f.company, email: f.email, phone: f.phone }, ref: f.ref, notes: f.notes, hp: f.hp });
    S.done = r; S.cart = {}; S.form = null;
    if (P.account) P = await api("/api/p/" + TOKEN);
  } catch (e) { toast(e.message, true); }
  S.busy = false; rOrder(); window.scrollTo(0, 0);
}

// ---------- manufacturer PO ----------
function rPO() {
  const p = M.po, b = M.brand, done = p.status === "received", i = P_FLOW.indexOf(p.status);
  app().innerHTML = h`${top("Purchase order", h`<button class="btn sm noprint" data-a="print">Print</button>`)}<div class="pwrap narrow"><div class="phero"><div><span class="eyebrow">For ${M.mfr.name || "manufacturer"} · issued ${dty(p.ts.sent || p.created)}</span><h1 class="mono">${p.num}</h1></div>${pill(p.status, P_LABEL[p.status])}</div>
  ${steps(P_FLOW.slice(1), P_LABEL, p.status, p.ts)}
  <div class="card noprint mact">${done ? h`<b>Received by ${b.name}. Thank you.</b>` : !p.ack ? h`<div class="grow"><b>Please acknowledge this order</b><p class="dim sm">Confirms you've received it and accept the quantities and pricing.</p></div><input id="m-by" placeholder="Your name" style="max-width:180px"><button class="btn pri" data-a="mack">Acknowledge PO</button>` : h`<div class="grow"><b>Acknowledged ${dty(p.ack.t)}${p.ack.by ? " by " + p.ack.by : ""}</b><p class="dim sm">${i < 4 ? "Add lot numbers below, then post tracking when it ships." : "Shipped — thank you."}</p></div>${i < 3 ? h`<button class="btn" data-a="mprod">Mark in production</button>` : ""}`}</div>
  <div class="grid g3 pcols"><div><div class="eyebrow">Buyer</div><p><b>${b.name}</b><br>${b.email}${b.phone ? h`<br>${b.phone}` : ""}</p></div><div><div class="eyebrow">Ship to</div><p>${addrLines({ ...p.shipTo, name: p.shipTo.name }).map((l) => h`${l}<br>`)}</p></div><div><div class="eyebrow">Terms</div><p>Net ${p.terms} days${p.expected ? h`<br>Target date ${dty(p.expected)}` : ""}</p></div></div>
  <div class="tablewrap"><table><thead><tr><th>Product</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Amount</th><th class="noprint">Lot #</th><th class="noprint">Expiry</th></tr></thead><tbody>${p.lines.map((l) => h`<tr><td>${l.n}<div class="faint sm">${l.f}${l.lot ? h`<span class="printonly"> · Lot ${l.lot}</span>` : ""}</div></td><td class="right num">${int(l.qty)}</td><td class="right num">${money(l.unit)}</td><td class="right num">${money(l.unit * l.qty)}</td><td class="noprint"><input class="mono lot" data-lot="${l.pid}" value="${l.lot}" placeholder="Lot #" ${done ? raw("disabled") : ""}></td><td class="noprint"><input type="date" class="exp" data-exp="${l.pid}" value="${l.exp}" ${done ? raw("disabled") : ""}></td></tr>`)}</tbody></table></div>
  <div class="tot"><div><span>Subtotal</span><span class="num">${money(p.sub)}</span></div>${p.shipping ? h`<div><span>Freight / fees</span><span class="num">${money(p.shipping)}</span></div>` : ""}<div class="g"><span>Total</span><span class="num">${money(p.total)}</span></div></div>
  ${p.notes ? h`<div class="card" style="margin-top:20px"><div class="eyebrow">Notes</div><p class="dim" style="white-space:pre-wrap;margin-top:8px">${p.notes}</p></div>` : ""}
  ${done ? "" : h`<div class="card noprint stack" style="margin-top:20px"><h3>Production & shipping</h3><div class="grid g2"><label class="f"><span>Estimated ship date</span><input type="date" id="m-exp" value="${p.expected}"></label><div class="row" style="align-items:flex-end"><button class="btn" data-a="msave">Save lots & date</button></div></div>${i < 4 ? h`<div class="row wrap"><input id="m-carrier" placeholder="Carrier (UPS, FedEx…)" style="max-width:190px" value="${p.carrier}"><input id="m-track" class="grow mono" placeholder="Tracking number" value="${p.tracking}"><button class="btn pri" data-a="mship">Mark shipped</button></div>` : h`<p class="dim">Shipped via ${p.carrier} <span class="mono">${p.tracking}</span></p>`}</div>`}
  <footer class="pfoot faint sm">${b.name} · ${b.email}</footer></div>`.s;
}
const lotsNow = () => M.po.lines.map((l) => ({ pid: l.pid, lot: $(`[data-lot="${l.pid}"]`)?.value || "", exp: $(`[data-exp="${l.pid}"]`)?.value || "" }));
async function mpost(data, msg) { try { M = await api("/api/m/" + TOKEN, data); toast(msg); rPO(); } catch (e) { toast(e.message, true); } }

const ACT = {
  f: (d) => { keep(); S.f = d.v; rOrder(); },
  tab: (d) => { keep(); S.tab = d.v; S.done = null; rOrder(); window.scrollTo(0, 0); },
  breaks: (d) => { keep(); S.open[d.id] = !S.open[d.id]; rOrder(); },
  rm: (d) => { keep(); delete S.cart[d.id]; rOrder(); },
  submit, print: () => window.print(),
  mack: () => mpost({ ack: true, by: $("#m-by").value }, "Acknowledged — thank you"),
  mprod: () => mpost({ status: "production", lines: lotsNow() }, "Marked in production"),
  msave: () => mpost({ lines: lotsNow(), expected: $("#m-exp").value }, "Saved"),
  mship: () => { if (!$("#m-track").value.trim()) return toast("Enter a tracking number.", true); mpost({ status: "shipped", carrier: $("#m-carrier").value, tracking: $("#m-track").value, lines: lotsNow(), expected: $("#m-exp").value }, "Marked shipped"); },
};
document.addEventListener("click", (e) => { const b = e.target.closest("[data-a]"); if (b && ACT[b.dataset.a]) { e.preventDefault(); ACT[b.dataset.a](b.dataset); } });
document.addEventListener("input", (e) => { const t = e.target; if (t.id === "pq") { keep(); S.q = t.value; rOrder(); } });
document.addEventListener("change", (e) => {
  const d = e.target.dataset;
  if (d.qty) { keep(); const q = Math.min(1e6, Math.max(0, Math.floor(Number(e.target.value) || 0))); if (q) S.cart[d.qty] = { qty: q, pkg: S.cart[d.qty]?.pkg || "unlabeled" }; else delete S.cart[d.qty]; rOrder(); }
  else if (d.pkg) { keep(); S.cart[d.pkg].pkg = e.target.value; rOrder(); }
});
(async () => {
  if (!TOKEN) return fail("Please use the order link you were sent.");
  try { if (MODE === "po") { M = await api("/api/m/" + TOKEN); rPO(); } else { P = await api("/api/p/" + TOKEN); rOrder(); } }
  catch (e) { fail(e.message); }
})();
