// Shared pricing engine — used by the server and the dashboard so both compute identical numbers.
const SELL_TIERS = [1, 10, 25, 250, 1000, 2500, 5000];
const COST_TIERS = [25, 250, 500, 1000, 2500, 5000];
// Which manufacturer cost tier backs each wholesale tier. Conservative: 1+/10+/25+ are bought at the 25+ MOQ price,
// 250+ (250–999 units) at the 250+ price even though 500+ might apply.
const SELL_TO_COST = [0, 0, 0, 1, 3, 4, 5];
const PRICING_DEFAULTS = { floor: 10, proj: 5 };
const rc = (n) => Math.round((Number(n) || 0) * 100) / 100;
const ceilc = (n) => Math.ceil(Math.round(n * 1e6) / 1e4) / 100;
const tierAt = (qty, tiers) => { let i = 0; tiers.forEach((t, k) => { if (qty >= t) i = k; }); return i; };
const blank = (v) => v == null || v === "" || Number.isNaN(Number(v));
// 6 cost tiers: 25/250/500 from the manufacturer sheet, 1000/2500/5000 projected unless entered.
// Projection: equal steps below the 500+ price, each `proj`% of the 500+ price (default 5% ≈ half the 9.1% the
// manufacturer gives from 250+ to 500+), so 1000+ = 95%, 2500+ = 90%, 5000+ = 85% of the 500+ price.
function costs(p, set) {
  const b = Number(p.cost[2]) || 0, x = p.cx || [], step = (set && set.proj != null ? set.proj : PRICING_DEFAULTS.proj) / 100;
  return [rc(p.cost[0]), rc(p.cost[1]), rc(b), ...[1, 2, 3].map((k) => (blank(x[k - 1]) ? rc(b * (1 - step * k)) : rc(x[k - 1])))];
}
const projected = (p, ci) => ci >= 3 && blank((p.cx || [])[ci - 3]);
const discFor = (a, ti) => { if (!a) return 0; const t = a.tierDisc; return t && !blank(t[ti]) ? Number(t[ti]) : Number(a.discount) || 0; };
const floorPrice = (cost, floor) => ceilc(cost / (1 - Math.min(90, Math.max(0, floor)) / 100));
// Price a product at a wholesale tier for a discount. A discount can never take the price below the margin floor
// (cost ÷ (1 − floor)). If the list price itself is already under the floor, the discount is ignored for that tier.
function sellInfo(p, ti, disc, set) {
  const list = rc(p.w[ti]), cost = costs(p, set)[SELL_TO_COST[ti]], fl = floorPrice(cost, set.floor), want = rc(list * (1 - (disc || 0) / 100));
  const listUnder = list < fl;
  let price = want, held = false;
  if (disc > 0 && want < Math.min(list, fl)) { price = Math.min(list, fl); held = true; }
  return { list, cost, floor: fl, want, price, held, listUnder, loss: list < cost, margin: price ? (price - cost) / price : 0, proj: projected(p, SELL_TO_COST[ti]) };
}
// Largest discount on a tier that keeps this product at or above the floor.
const maxSafe = (p, ti, set) => { const i = sellInfo(p, ti, 0, set); return i.list > 0 ? Math.max(0, Math.floor((1 - i.floor / i.list) * 1000) / 10) : 0; };
// Estimated manufacturer cost per unit for a client order line before it is on a PO.
const estCost = (p, qty, set) => { const ci = tierAt(Math.max(qty, COST_TIERS[0]), COST_TIERS); return { unit: costs(p, set)[ci], ci, proj: projected(p, ci) }; };
