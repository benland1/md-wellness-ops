import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
const B="http://localhost:3111"; const b=await chromium.launch(); const pg=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
const errs=[]; pg.on("pageerror",e=>errs.push("PAGEERR "+e.message));
await pg.goto(B+"/admin"); await pg.fill("#au-pw","longpassword1"); await pg.click("button[type=submit]"); await pg.waitForSelector(".board");
await pg.click('.side [data-v="accounts"]'); await pg.waitForTimeout(300); await pg.screenshot({path:"/tmp/u_accounts.png"});
await pg.click('tr.click:has-text("Apex")'); await pg.waitForSelector("#a-slug"); await pg.waitForTimeout(300); await pg.screenshot({path:"/tmp/u_modal.png"});
const href=await pg.evaluate(()=>document.querySelector(".mbody .linkbox").textContent);
const p2=await b.newPage(); p2.on("pageerror",e=>errs.push("PORTAL "+e.message)); await p2.goto(href.replace("http://localhost:3111",B)); await p2.waitForSelector(".prow"); await p2.screenshot({path:"/tmp/u_portal.png"});
console.log(href, errs.join("\n")||"no page errors"); await b.close();
