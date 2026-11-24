import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
const B="http://localhost:3111"; const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1440,height:900}}); const pg=await ctx.newPage();
const errs=[]; pg.on("pageerror",e=>errs.push("PAGEERR "+e.message)); pg.on("console",m=>{if(m.type()==="error"&&!m.text().includes("fonts.g")&&!m.text().includes("ERR_"))errs.push("CONSOLE "+m.text())});
const shot=async(n,full)=>{await pg.waitForTimeout(250);await pg.screenshot({path:`/tmp/s_${n}.png`,fullPage:!!full})};
await pg.goto(B+"/admin"); await pg.waitForSelector("#au-pw"); await shot("login");
await pg.fill("#au-pw","longpassword1"); await pg.click("button[type=submit]"); await pg.waitForSelector(".board"); await shot("overview");
await pg.click('[data-v="orders"]'); await shot("orders");
await pg.click('tr.click'); await pg.waitForSelector(".dbody"); await shot("orderdrawer");
await pg.evaluate(()=>document.querySelector(".dbody").scrollTo(0,700)); await shot("orderdrawer2");
await pg.click('[data-kind="invoice"]'); await pg.waitForSelector("#paper"); await shot("invoice");
await pg.keyboard.press("Escape"); await pg.keyboard.press("Escape");
// add a new confirmed order to see purchasing builder
await pg.click('[data-v="accounts"]'); await shot("accounts");
await pg.click('[data-a="orderNew"][data-id]'); await pg.waitForSelector("#ol-pid"); await pg.selectOption("#ol-pid","v07"); await pg.fill("#ol-qty","12"); await pg.click('[data-a="olAdd"]'); await shot("neworder");
await pg.click('[data-a="orderSave"]'); await pg.waitForSelector(".dbody"); await pg.click('[data-s="confirmed"]'); await pg.waitForTimeout(300); await shot("confirmed");
await pg.keyboard.press("Escape"); await pg.click('.side [data-v="purchasing"]'); await shot("purchasing",true);
await pg.click('table tr.click'); await pg.waitForSelector(".dbody"); await shot("podrawer");
await pg.keyboard.press("Escape");
for (const v of ["money","trace","catalog","settings"]) { await pg.click(`.side [data-v="${v}"]`); await shot(v); }
await pg.click('.side [data-v="money"]'); await pg.click('[data-a="money"][data-v="sum"]'); await shot("money_sum");
const st=await pg.evaluate(async()=>{const d=await (await fetch("/api/state")).json();return {a:d.accounts.find(x=>!x.pending).token,p:d.pos[0].token,pub:d.settings.publicToken}});
const p2=await ctx.newPage(); p2.on("pageerror",e=>errs.push("PORTAL PAGEERR "+e.message));
await p2.goto(B+"/o/"+st.a); await p2.waitForSelector(".prow"); await p2.fill('[data-qty="v04"]',"300"); await p2.keyboard.press("Tab"); await p2.waitForTimeout(200); await p2.fill('[data-qty="v22"]',"25"); await p2.keyboard.press("Tab"); await p2.waitForTimeout(300); await p2.screenshot({path:"/tmp/s_portal.png"});
await p2.click('[data-a="tab"][data-v="hist"]'); await p2.waitForTimeout(200); await p2.screenshot({path:"/tmp/s_portal_hist.png"});
await p2.goto(B+"/po/"+st.p); await p2.waitForSelector(".tablewrap"); await p2.screenshot({path:"/tmp/s_mfr.png",fullPage:true});
await p2.setViewportSize({width:390,height:800}); await p2.goto(B+"/o/"+st.pub); await p2.waitForSelector(".prow"); await p2.fill('[data-qty="v01"]',"10"); await p2.keyboard.press("Tab"); await p2.waitForTimeout(300); await p2.screenshot({path:"/tmp/s_mobile.png"});
await pg.setViewportSize({width:390,height:800}); await pg.click('[data-v="overview"]'); await shot("admin_mobile");
console.log(errs.length?errs.join("\n"):"no page errors"); await b.close();
