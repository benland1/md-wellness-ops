const B="http://localhost:3111"; let cookie="";
const J=async(p,d,noauth)=>{const r=await fetch(B+p,{method:d?"POST":"GET",headers:{"content-type":"application/json",...(cookie&&!noauth?{cookie}:{})},body:d?JSON.stringify(d):undefined});const sc=r.headers.get("set-cookie");if(sc)cookie=sc.split(";")[0];return {s:r.status,j:await r.json()}};
const ok=(c,m)=>{console.log((c?"PASS ":"FAIL ")+m); if(!c)process.exitCode=1};
let r=await J("/api/state"); ok(r.s===401,"state requires auth");
r=await J("/api/setup",{code:"bad",password:"longpassword1"}); ok(r.s===403,"bad setup code rejected");
r=await J("/api/setup",{code:"testcode",password:"short"}); ok(r.s===400,"short pw rejected");
r=await J("/api/setup",{code:"testcode",password:"longpassword1"}); ok(r.s===200&&cookie,"setup ok");
r=await J("/api/setup",{code:"testcode",password:"longpassword2"}); ok(r.s===400,"second setup blocked");
let D=(await J("/api/state")).j; ok(D.products.length===101,"101 products");
const act=async(a,p)=>{const x=await J("/api/act",{a,...p}); if(x.s!==200)console.log("  ->",x.j); else D=x.j; return x};
await act("account.save",{acct:{company:"Apex Clinic",name:"Dana",email:"dana@apex.test",type:"client",discount:10,terms:15,shipTo:{line1:"1 Main",city:"Austin",state:"TX",zip:"78701"}}});
const a=D.accounts[0]; ok(a&&a.token.length>=20,"account w/ token");
// portal
r=await J("/api/p/"+a.token,null,true); ok(r.s===200&&r.j.products.length===101&&!JSON.stringify(r.j).includes('"cost"'),"portal loads, no cost leaked");
const p0=D.products[0]; ok(Math.abs(r.j.products[0].p[0]-Math.round(p0.w[0]*0.9*100)/100)<0.001,"discount applied "+r.j.products[0].p[0]);
r=await J("/api/p/"+a.token+"/order",{items:[{pid:"v04",qty:30,pkg:"clientlabel"},{pid:"v05",qty:10,pkg:"unlabeled"}],shipTo:{line1:"1 Main",city:"Austin"},notes:"rush"},true);
ok(r.s===200&&r.j.num==="SO-1001","portal order "+JSON.stringify(r.j));
// expected: v04 t3 42.34*.9=38.11 +0.75 =38.86*30=1165.8 + 250 setup; v05 t2 53.54*.9=48.19*10=481.9 => 1897.70
ok(Math.abs(r.j.total-1897.70)<0.01,"total math 1897.70 = "+r.j.total);
r=await J("/api/p/badtokenbadtoken/order",{items:[]},true); ok(r.s===404,"bad token 404");
r=await J("/api/p/"+a.token+"/order",{items:[{pid:"v04",qty:-5}],shipTo:{line1:"x",city:"y"}},true); ok(r.s===400,"neg qty rejected");
// public
D=(await J("/api/state")).j;
r=await J("/api/p/"+D.settings.publicToken+"/order",{items:[{pid:"n01",qty:5}],shipTo:{line1:"9 Elm",city:"Reno"},contact:{name:"Lee",email:"lee@new.test",company:"NewCo"}},true);
ok(r.s===200&&r.j.link,"public order creates lead "+r.j.num);
D=(await J("/api/state")).j; ok(D.accounts.length===2&&D.accounts[0].pending,"lead pending");
const o1=D.orders.find(o=>o.num==="SO-1001"), o2=D.orders.find(o=>o.num==="SO-1002");
await act("order.status",{id:o1.id,status:"confirmed"}); await act("order.status",{id:o2.id,status:"confirmed"});
await act("po.create",{orderIds:[o1.id,o2.id],extra:{n01:20},discount:0});
let po=D.pos[0]; ok(po.num==="PO-2001"&&po.lines.length===3,"po created lines="+po.lines.length);
const l=po.lines.find(x=>x.pid==="n01"); ok(l.qty===25&&l.need===5&&l.extra===20,"extra stock merged");
ok(Math.abs(po.total-(16.5*30+18.48*10+30.21*25))<0.01,"po total "+po.total);
r=await J("/api/m/"+po.token,null,true); ok(r.s===404,"draft PO link inactive");
await act("po.status",{id:po.id,status:"sent"}); ok(D.orders.find(o=>o.id===o1.id).status==="ordered","orders -> ordered");
r=await J("/api/m/"+po.token,{ack:true,by:"Sam",lines:[{pid:"v04",lot:"L-778",exp:"2028-01-01"},{pid:"v05",lot:"L-779"},{pid:"n01",lot:"L-780"}]},true); ok(r.s===200&&r.j.po.status==="confirmed","mfr ack -> confirmed");
r=await J("/api/m/"+po.token,{status:"shipped",carrier:"UPS",tracking:"1Z999"},true); ok(r.j.po.status==="shipped","mfr shipped");
await act("po.status",{id:po.id,status:"received"});
let oo=D.orders.find(o=>o.id===o1.id); ok(oo.status==="received"&&oo.items[0].lots[0].lot==="L-778","received + lot propagated");
await act("order.pay",{id:o1.id,amount:1000,method:"ACH"}); await act("order.update",{id:o1.id,patch:{shipping:45}});
oo=D.orders.find(o=>o.id===o1.id); ok(oo.paid===1000&&Math.abs(oo.total-1942.70)<0.01,"pay+shipping "+oo.total);
await act("order.status",{id:o1.id,status:"shipped",carrier:"FedEx",tracking:"7788"});
r=await J("/api/p/"+a.token,null,true); ok(r.j.orders[0].tracking==="7788"&&r.j.orders[0].items[0].lots[0].lot==="L-778","client sees tracking+lot");
r=await act("order.del",{id:o1.id}); ok(r.s===400,"cannot delete order on PO");
await act("po.pay",{id:po.id,amount:500}); ok(D.pos[0].paid===500,"po payment");
r=await fetch(B+"/api/act",{method:"POST",headers:{"content-type":"application/json",cookie,origin:"https://evil.test"},body:"{}"}); ok(r.status===403,"cross-origin POST blocked");
r=await J("/api/login",{password:"wrong"},true); ok(r.s===403,"wrong pw");
for(const p of ["/admin","/o/"+a.token,"/po/"+po.token]){const x=await fetch(B+p);const t=await x.text();ok(x.status===200&&t.includes("<div id=\"app\">"),"page "+p.slice(0,6)+" "+t.length)}
