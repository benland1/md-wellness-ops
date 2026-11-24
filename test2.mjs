const B="http://localhost:3111"; let cookie="";
const J=async(p,d,noauth)=>{const r=await fetch(B+p,{method:d?"POST":"GET",headers:{"content-type":"application/json",...(cookie&&!noauth?{cookie}:{})},body:d?JSON.stringify(d):undefined});const sc=r.headers.get("set-cookie");if(sc)cookie=sc.split(";")[0];return {s:r.status,j:await r.json()}};
const ok=(c,m)=>{console.log((c?"PASS ":"FAIL ")+m); if(!c)process.exitCode=1};
await J("/api/login",{password:"longpassword1"});
let D=(await J("/api/state")).j; const act=async(a,p)=>{const x=await J("/api/act",{a,...p}); if(x.s!==200)console.log("  ->",x.j); else D=x.j; return x};
ok(D.settings.floor===10&&D.settings.proj===5&&D.costTiers.length===6,"defaults floor 10 proj 5, 6 cost tiers");
await act("account.save",{acct:{company:"Deep Discount Co",name:"Z",email:"z@z.test",discount:40,shipTo:{line1:"1",city:"X"}}});
const a=D.accounts.find(x=>x.company==="Deep Discount Co");
let r=(await J("/api/p/"+a.token,null,true)).j; const P=(id)=>r.products.find(p=>p.id===id).p;
ok(P("v04")[6]===11.82,"Sema 10mg @5000 held at floor 11.82 (40% would be 8.17): "+P("v04")[6]);
ok(P("v04")[0]===34.02,"Sema 10mg @1+ normal 40% off = 34.02: "+P("v04")[0]);
ok(P("v14")[2]===43.96,"Epitalon vial @25+ list under cost -> discount ignored, 43.96: "+P("v14")[2]);
ok(P("v14")[0]===47.70,"Epitalon vial @1+ list under floor -> 47.70: "+P("v14")[0]);
// every price >= cost*... check across all products/tiers: never below cost at mapped tier
const prod=Object.fromEntries(D.products.map(p=>[p.id,p])); const M=[0,0,0,1,3,4,5];
let worst=1e9, bad=0; for(const x of r.products){const p=prod[x.id]; const b=p.cost[2]; const c=[...p.cost,...[1,2,3].map(k=>Math.round(b*(1-0.05*k)*100)/100)]; x.p.forEach((v,i)=>{const fl=Math.min(p.w[i], Math.ceil(c[M[i]]/0.9*100-1e-6)/100); if(v<fl-0.001)bad++; worst=Math.min(worst,(v-c[M[i]])/v)})}
ok(bad===0,"no discounted price below min(list, floor) across all 101x7");
console.log("   lowest margin anywhere at 40% discount:",(worst*100).toFixed(1)+"% (Epitalon list price)");
// per-tier discounts
await act("account.save",{acct:{...a,discount:0,tierDisc:[50,null,null,null,null,null,0]}});
r=(await J("/api/p/"+a.token,null,true)).j;
ok(P("v04")[0]===28.35&&P("v04")[1]===49.52&&P("v04")[6]===13.62,"tier discounts: 50% on 1+, none elsewhere: "+P("v04").join(","));
// order through link uses held price
let o=await J("/api/p/"+a.token+"/order",{items:[{pid:"v04",qty:5000}],shipTo:{line1:"1",city:"X"}},true);
await act("account.save",{acct:{...a,discount:40,tierDisc:null}});
o=await J("/api/p/"+a.token+"/order",{items:[{pid:"v04",qty:5000}],shipTo:{line1:"1",city:"X"}},true);
ok(Math.abs(o.j.total-59100)<0.01,"5000 units @ held 11.82 = 59,100: "+o.j.total);
// PO with projected cost
D=(await J("/api/state")).j; const oo=D.orders.find(x=>x.num===o.j.num); await act("order.status",{id:oo.id,status:"confirmed"});
await act("po.create",{orderIds:[oo.id]}); const line=D.pos[0].lines[0];
ok(line.unit===10.63&&line.proj===true,"PO 5000 units projected cost 10.63 flagged: "+line.unit+" "+line.proj);
// floor 0 -> break-even only
await act("settings.save",{s:{...D.settings,floor:0}});
r=(await J("/api/p/"+a.token,null,true)).j; ok(P("v04")[6]===10.63,"floor 0 -> held at cost 10.63: "+P("v04")[6]);
// real 5k cost entered overrides projection
const p4=D.products.find(p=>p.id==="v04"); await act("product.save",{p:{...p4,cx:[null,null,9.5]}});
r=(await J("/api/p/"+a.token,null,true)).j; ok(P("v04")[6]===9.5,"entered 5k cost 9.50 replaces projection: "+P("v04")[6]);
await act("product.save",{p:{...p4,cx:[null,null,null]}}); await act("settings.save",{s:{...D.settings,floor:10}});
ok(D.settings.floor===10,"floor restored");
