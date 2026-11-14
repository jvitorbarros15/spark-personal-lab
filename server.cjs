'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ROOT = path.resolve(__dirname, 'dist');
const HOST = '127.0.0.1';
const PORT = 4173;
const TYPES = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.json':'application/json; charset=utf-8'};
function createServer() {
  return http.createServer((req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cache-Control','no-store');
    if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405, {'Allow':'GET, HEAD'});res.end('Method not allowed');return;}
    let pathname;
    try { pathname = decodeURIComponent((req.url || '/').split('?')[0]); } catch {res.writeHead(400);res.end('Invalid URL');return;}
    // Reject traversal and Windows path syntax before resolving the filesystem path.
    if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').some(part=>part==='..') || pathname.includes(':')) {res.writeHead(403);res.end('Forbidden');return;}
    const target = path.resolve(ROOT, '.' + (pathname==='/'?'/index.html':pathname));
    if (target!==ROOT && !target.startsWith(ROOT+path.sep)) {res.writeHead(403);res.end('Forbidden');return;}
    fs.realpath(target, (error, realTarget) => {
      if (error) {res.writeHead(404);res.end('Not found');return;}
      if (!realTarget.startsWith(ROOT+path.sep)) {res.writeHead(403);res.end('Forbidden');return;}
      fs.stat(realTarget, (err,stat) => {
        if (err || !stat.isFile()) {res.writeHead(404);res.end('Not found');return;}
        res.writeHead(200, {'Content-Type':TYPES[path.extname(realTarget)]||'application/octet-stream','Content-Length':stat.size});
        if(req.method==='HEAD') {res.end();return;}
        const stream=fs.createReadStream(realTarget);stream.on('error',()=>res.destroy());stream.pipe(res);
      });
    });
  });
}
if (require.main===module) {
  const server=createServer();
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'Port 4173 is already in use. If Spark is already running, open http://127.0.0.1:4173. Otherwise close the app using that port and try again.':error.message);process.exitCode=1;});
  server.listen(PORT,HOST,()=>{
    const url=`http://${HOST}:${PORT}`;
    console.log(`Spark is ready at ${url}\nKeep this window open. Press Ctrl+C to stop.`);
    if(process.argv.includes('--open')) {
      let command,args;
      if(process.platform==='win32'){command='cmd';args=['/c','start','',url];}
      else if(process.platform==='darwin'){command='open';args=[url];}
      else {command='xdg-open';args=[url];}
      const browser=spawn(command,args,{stdio:'ignore',windowsHide:true});
      browser.on('error',()=>console.log('Open the address above in your browser.'));
      browser.unref();
    }
  });
}
module.exports={createServer};
