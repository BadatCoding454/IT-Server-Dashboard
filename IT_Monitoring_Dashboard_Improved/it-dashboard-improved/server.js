"use strict";
// Read-only local system monitoring service; Node >=20, no third-party dependencies.
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.API_KEY || '';
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw Error('Invalid PORT');
if (HOST !== '127.0.0.1' && HOST !== '::1' && !API_KEY) throw Error('API_KEY is required when binding outside loopback');
const root = __dirname;
const paths = { '/': 'index.html', '/index.html': 'index.html', '/dashboard.js': 'dashboard.js', '/styles.css': 'styles.css' };
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8' };
let previousCpu = os.cpus().reduce((a,c)=>({idle:a.idle+c.times.idle,total:a.total+Object.values(c.times).reduce((x,y)=>x+y,0)}),{idle:0,total:0});
function cpuUsage() {
 const next = os.cpus().reduce((a,c)=>({idle:a.idle+c.times.idle,total:a.total+Object.values(c.times).reduce((x,y)=>x+y,0)}),{idle:0,total:0});
 const elapsed = next.total-previousCpu.total;
 const value = elapsed>0 ? (1-(next.idle-previousCpu.idle)/elapsed)*100 : 0;
 previousCpu=next;
 return Math.round(Math.min(100,Math.max(0,value))*10)/10;
}
async function diskStats() {
 try {const result=await fs.statfs(process.platform==='win32'?process.env.SystemDrive+'\\':'/'); const total=result.blocks*result.bsize; const free=result.bavail*result.bsize; return {usage:total?Math.round((1-free/total)*1000)/10:0,totalBytes:total,freeBytes:free};}
 catch {return {usage:null,totalBytes:null,freeBytes:null};}
}
const elapsedFormat = (secs)=>({days:Math.floor(secs/86400),hours:Math.floor(secs%86400/3600),minutes:Math.floor(secs%3600/60)});
async function service(name) {
 if (process.platform!=='linux') return 'unavailable';
 try {const {stdout}=await execFileAsync('systemctl',['is-active',name],{timeout:1500});return stdout.trim()==='active'?'running':'stopped';}
 catch (e) {return e.code===1||e.code===3?'stopped':'unavailable';}
}
async function status() {
 const total=os.totalmem(), free=os.freemem(), disk=await diskStats();
 const [ssh,nginx,ufw]=await Promise.all([service('ssh'),service('nginx'),service('ufw')]);
 return {server:os.hostname(),cpu:{usage:cpuUsage(),cores:os.cpus().length},memory:{usage:Math.round((1-free/total)*1000)/10,usedBytes:total-free,totalBytes:total},disk,uptime:elapsedFormat(os.uptime()),uptimeSeconds:Math.floor(os.uptime()),operatingSystem:{platform:os.platform(),release:os.release()},services:{ssh,nginx,firewall:ufw},timestamp:new Date().toISOString()};
}
function alerts(s) {
 const rules=[['CPU',s.cpu.usage],['Memory',s.memory.usage],['Disk',s.disk.usage]];
 return rules.filter(([,usage])=>typeof usage==='number'&&usage>=80).map(([label,usage])=>{const type=usage>=90?'critical':'warning';return {type,title:`${label} usage elevated`,message:`${label} utilization is ${usage}%.`,severity:type==='critical'?'Critical':'Warning',timestamp:s.timestamp};});
}
function headers(type) {return {'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"};}
function send(res,code,data){res.writeHead(code,headers('application/json; charset=utf-8'));res.end(JSON.stringify(data));}
function createServer(){return http.createServer(async(req,res)=>{
 try {
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(req.method!=='GET'){send(res,405,{error:'Method not allowed'});return;}
  if (pathname.startsWith('/api/')) {
    if(API_KEY&&req.headers['x-api-key']!==API_KEY){send(res,401,{error:'Unauthorized'});return;}
    if(!['/api/status','/api/uptime','/api/alerts'].includes(pathname)){send(res,404,{error:'Not found'});return;}
    const s=await status();send(res,200,pathname==='/api/status'?s:pathname==='/api/alerts'?alerts(s):s.uptime);return;
  }
  const file=paths[pathname];if(!file){send(res,404,{error:'Not found'});return;}
  const buffer=await fs.readFile(path.join(root,file));res.writeHead(200,headers(MIME[path.extname(file)]));res.end(buffer);
 } catch(e){console.error('Request failed:',e); if(!res.headersSent)send(res,500,{error:'Internal server error'});else res.end();}
});}
if(require.main===module) createServer().listen(PORT,HOST,()=>console.log(`Dashboard: http://${HOST}:${PORT}`));
module.exports={createServer,alerts,elapsedFormat};
