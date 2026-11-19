"use strict";
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { devices, gatewayHandler } = require("./phone.cjs");
const listen = server => new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
async function main(){
  const registry=devices(":memory:");
  const desktop=http.createServer((req,res)=>{assert.equal(req.headers.cookie,undefined);res.end("local workspace");});
  await listen(desktop);
  const origin="https://spark.internal:4443";
  const handler=gatewayHandler({origin,registry,desktopPort:desktop.address().port});
  const gateway=http.createServer((req,res)=>handler(req,res).catch(()=>res.destroy()));
  await listen(gateway);
  const request=(route,method="GET",headers={},body="")=>new Promise((resolve,reject)=>{
    const req=http.request({hostname:"127.0.0.1",port:gateway.address().port,path:route,method,headers:{host:"spark.internal:4443",...headers}},res=>{
      let data="";res.on("data",chunk=>data+=chunk);res.on("end",()=>resolve({status:res.statusCode,headers:res.headers,data}));
    });req.on("error",reject);req.end(body);
  });
  try{
    assert.equal((await request("/api/state")).status,401);
    const code=registry.invite();
    assert.equal((await request("/pair","POST",{origin:"https://other.example"},"code="+code)).status,403);
    const result=await request("/pair","POST",{origin},"code="+code);
    assert.equal(result.status,303);
    assert.equal((await request("/pair","POST",{origin},"code="+code)).status,403);
    const [cookie]=result.headers["set-cookie"][0].split(";");
    assert.match(result.headers["set-cookie"][0],/Secure; HttpOnly; SameSite=Strict/);
    assert.equal((await request("/api/state","GET",{cookie})).data,"local workspace");
    assert.equal((await request("/api/chat","POST",{cookie})).status,403);
    registry.revoke(registry.list()[0].id);
    assert.equal((await request("/api/state","GET",{cookie})).status,401);
    const html=fs.readFileSync(path.join(__dirname,"dist/index.html"),"utf8");
    for(const id of ["footer","nav","search","content","record-form","toast"])assert.ok(html.includes('id="'+id+'"'));
    const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,"dist/manifest.webmanifest")));
    for(const icon of manifest.icons)assert.ok(fs.existsSync(path.join(__dirname,"dist",icon.src)));
    assert.ok(!html.includes("record-dialog")&&html.includes('class="rd-btn"'));
    for(const id of ["dash","card-hero","card-charts","card-numbers","card-timeline","card-comp","card-research","card-details","card-links","drawer","drawer-close","outputs-panel","validation-panel","math-panel","research-panel","papers-panel"])assert.ok(html.includes('id="'+id+'"'),"dashboard element "+id);
    assert.ok(!html.includes("entry-nav")&&!/\sstyle=/.test(html),"no section nav and no inline style attributes (CSP)");
    const order=["card-hero","card-charts","card-numbers","card-comp","card-timeline","card-details","card-research","card-links"].map(id=>fs.readFileSync(path.join(__dirname,"dist/assets/style.css"),"utf8").includes("."+({"card-hero":"c-hero","card-charts":"c-charts","card-numbers":"c-numbers","card-comp":"c-comp","card-timeline":"c-timeline","card-details":"c-details","card-research":"c-research","card-links":"c-links"})[id]+" { order:"));
    assert.ok(order.every(Boolean),"phone stacks the cards in priority order");
    const css=fs.readFileSync(path.join(__dirname,"dist/assets/style.css"),"utf8");
    assert.match(css,/@media \(max-width: 900px\)[\s\S]*\.dash-main,\s*\.dash-side \{\s*display: contents;/);
    assert.match(css,/@media \(max-width: 760px\)[\s\S]*\.kpi \{\s*min-height: 44px;/);
    console.log("PASS: pairing, one-use codes, device revocation, origin guards, manifest icons and required page elements.");
  }finally{gateway.close();desktop.close();registry.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
