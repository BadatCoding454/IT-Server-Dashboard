'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createServer,alerts,elapsedFormat}=require('./server');
test('API returns real host metrics and safely serves assets', async()=>{
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  let res=await fetch(`${base}/api/status`);assert.equal(res.status,200);assert.equal(res.headers.get('x-content-type-options'),'nosniff');let s=await res.json();assert.equal(typeof s.server,'string');assert.ok(s.cpu.usage>=0&&s.cpu.usage<=100);assert.ok(s.memory.usage>=0&&s.memory.usage<=100);assert.equal(typeof s.uptime.days,'number');
  res=await fetch(`${base}/api/alerts`);assert.equal(res.status,200);assert.ok(Array.isArray(await res.json()));
  res=await fetch(`${base}/api/uptime`);assert.equal(res.status,200);assert.equal(typeof (await res.json()).minutes,'number');
  res=await fetch(`${base}/dashboard.js`);assert.equal(res.status,200);assert.match(await res.text(),/textContent/);
  assert.equal((await fetch(`${base}/../server.js`)).status,404);
  assert.equal((await fetch(`${base}/api/status`,{method:'POST'})).status,405);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('alert thresholds and uptime decomposition',()=>{
 const mock={cpu:{usage:90},memory:{usage:85},disk:{usage:40},timestamp:'2026-11-05T00:00:00Z'};
 assert.deepEqual(alerts(mock).map(a=>a.type),['critical','warning']);
 assert.deepEqual(elapsedFormat(90061),{days:1,hours:1,minutes:1});
});
