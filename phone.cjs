"use strict";
// Optional HTTPS front door. The existing desktop service remains on loopback.
const https = require("node:https");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const { DatabaseSync } = require("node:sqlite");
const { dataDirectory, migrateLegacyData } = require("./data-dir.cjs");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const token = () => crypto.randomBytes(24).toString("base64url");
function devices(filename, now = Date.now) {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, expires INTEGER); CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, digest TEXT UNIQUE, created INTEGER, expires INTEGER)");
  return {
    invite(ttl = 600000) {
      const code = token();
      db.prepare("DELETE FROM invites WHERE expires <= ?").run(now());
      db.prepare("INSERT INTO invites VALUES (?,?)").run(hash(code), now()+ttl);
      return code;
    },
    redeem(code) {
      const at = now(), secret = token(), id = crypto.randomUUID();
      db.exec("BEGIN IMMEDIATE");
      try {
        const invite = db.prepare("DELETE FROM invites WHERE hash=? AND expires>? RETURNING hash").get(hash(code), at);
        if (invite) db.prepare("INSERT INTO devices VALUES (?,?,?,?)").run(id,hash(secret),at,at+30*86400000);
        db.exec("COMMIT");
        return invite ? secret : null;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    valid(secret) { return !!db.prepare("SELECT id FROM devices WHERE digest=? AND expires>?").get(hash(secret), now()); },
    list() { return db.prepare("SELECT id,created,expires FROM devices ORDER BY created").all(); },
    revoke(id) { return db.prepare("DELETE FROM devices WHERE id=?").run(id).changes; },
    clearInvites() { db.prepare("DELETE FROM invites").run(); },
    revokeAll() { db.prepare("DELETE FROM invites").run(); return db.prepare("DELETE FROM devices").run().changes; },
    close() { db.close(); }
  };
}
const pairPage = '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pair with Spark</title><main><h1>Pair with Spark</h1><form method="post" action="/pair"><label>Code from your computer <input name="code" required maxlength="64" autocomplete="off"></label><button>Pair this device</button></form></main>';
function gatewayHandler({origin, registry, desktopPort=4173}) {
  const authority = new URL(origin).host;
  return async (req,res) => {
    const reply = (status,text) => { res.writeHead(status,{"Content-Type":"text/plain; charset=utf-8"}); res.end(text); };
    res.setHeader("Cache-Control","no-store");
    res.setHeader("Referrer-Policy","no-referrer");
    if(req.headers.host!==authority || req.headers["sec-fetch-site"]==="cross-site" || (req.headers.origin && req.headers.origin!==origin)) return reply(403,"Unrecognized origin.");
    if(!["GET","HEAD"].includes(req.method) && req.headers.origin!==origin) return reply(403,"Same-origin requests required.");
    if(req.url==="/pair" && req.method==="POST"){
      let body=""; for await(const chunk of req){body+=chunk;if(body.length>256)return reply(413,"Code too long.");}
      const secret=registry.redeem(new URLSearchParams(body).get("code")||"");
      if(!secret)return reply(403,"Invalid or expired code. Generate another on your computer.");
      res.writeHead(303,{"Set-Cookie":"__Host-spark="+secret+"; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000",Location:"/"});return res.end();
    }
    const match=(req.headers.cookie||"").match(/(?:^|;\s*)__Host-spark=([A-Za-z0-9_-]{32})(?:;|$)/);
    if(!match || !registry.valid(match[1])){
      if(req.method==="GET" && ["/","/pair"].includes(req.url)){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":"default-src 'none'; form-action 'self'; frame-ancestors 'none'"});return res.end(pairPage);}
      return reply(401,"Pair this device first.");
    }
    // Forward only needed request headers. Never forward the pairing cookie.
    const headers={};for(const key of ["content-type","content-length","range"])if(req.headers[key])headers[key]=req.headers[key];
    const upstream=http.request({hostname:"127.0.0.1",port:desktopPort,path:req.url,method:req.method,headers},incoming=>{res.writeHead(incoming.statusCode,incoming.headers);incoming.on("error",()=>res.destroy());incoming.pipe(res);});
    upstream.on("error",()=>{if(!res.headersSent)reply(502,"Start Spark on the computer, then retry.");else res.destroy();});
    res.on("close",()=>upstream.destroy());req.pipe(upstream);
  };
}
if(require.main===module){
  const directory=dataDirectory();migrateLegacyData(directory);fs.mkdirSync(directory,{recursive:true});
  const registry=devices(path.join(directory,"pairing.sqlite"));
  const command=process.argv[2]||"serve";
  if(command==="pair") console.log("One-use pairing code (10 minutes):",registry.invite());
  else if(command==="devices") console.table(registry.list());
  else if(command==="revoke") console.log("Devices revoked:",registry.revoke(process.argv[3]||""));
  else if(command==="serve"){
    const bind=process.env.SPARK_PHONE_BIND||"", address=process.env.SPARK_PHONE_ORIGIN||"";
    if(!net.isIPv4(bind)||!(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(bind)))throw Error("Set SPARK_PHONE_BIND to a specific LAN or private VPN IPv4 address.");
    const url=new URL(address);if(url.protocol!=="https:"||url.origin!==address)throw Error("Set SPARK_PHONE_ORIGIN to the exact HTTPS origin with no trailing slash.");
    const handler=gatewayHandler({origin:url.origin,registry});
    https.createServer({key:fs.readFileSync(process.env.SPARK_PHONE_KEY),cert:fs.readFileSync(process.env.SPARK_PHONE_CERT)},(req,res)=>handler(req,res).catch(()=>res.destroy())).listen(Number(url.port)||443,bind,()=>console.log("Open",url.origin,"on the phone. Run node phone.cjs pair on this computer."));
  } else throw Error("Use serve, pair, devices, or revoke DEVICE_ID.");
  if(command!=="serve")registry.close();
}
module.exports={devices,gatewayHandler};
