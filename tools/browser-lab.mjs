import http from 'node:http';
import { cp, mkdir, readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fixture } from '../tests/fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2);const arg=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
const browser=arg('--chrome');const headless=args.includes('--headless');
const debuggerProbe=args.includes('--debugger-probe');
const outputName=debuggerProbe?'debugger-probe':'browser';
const token=randomBytes(20).toString('hex');
const reports=[];const requests=[];let phase=1,finishPhase=null;
const server=http.createServer(async(req,res)=>{
  const origin=`http://${req.headers.host}`,url=new URL(req.url,origin);
  res.setHeader('Cache-Control','no-store');res.setHeader('Access-Control-Allow-Origin','*');
  const json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data))};
  if(url.pathname==='/phase')return json({phase});
  if(url.pathname===`/results/${token}`&&req.method==='POST'){
    let body='';for await(const part of req){body+=part;if(body.length>1000000){res.writeHead(413);return res.end()}}
    try{const report=JSON.parse(body);reports.push(report);json({ok:true});finishPhase?.(report)}catch{res.writeHead(400);res.end()}return;
  }
  requests.push({phase,path:url.pathname,host:req.headers.host,acceptLanguage:req.headers['accept-language']??null});
  if(url.pathname==='/echo')return json({acceptLanguage:req.headers['accept-language']??null});
  if(['/','/fixture','/frame','/csp'].includes(url.pathname)){
    res.setHeader('Content-Type','text/html; charset=utf-8');
    if(url.pathname==='/csp')res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'nonce-locale-sg-test'; style-src 'unsafe-inline'; connect-src 'self'; frame-src http://127.0.0.1:* http://localhost:* about:; worker-src blob:");
    const cross=new URL(origin);cross.hostname=cross.hostname==='localhost'?'127.0.0.1':'localhost';
    return res.end(fixture({header:req.headers['accept-language']??null,origin,crossOrigin:cross.origin,frame:url.pathname==='/frame',name:url.searchParams.get('name'),nonce:url.pathname==='/csp',debuggerProbe}));
  }
  res.writeHead(404);res.end('Not found');
});
await new Promise(resolve=>server.listen(Number(arg('--port')??0),'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
console.log(`本机验收页：${base}/fixture`);
if(!browser){console.log('手动模式：用已经加载正式扩展的 Chrome 打开以上地址；结束按 Ctrl+C。');}
else{
 const dir=await mkdtemp(path.join(os.tmpdir(),'chrome-locale-sg-lab-'));
 const extension=path.join(dir,'extension');await cp(path.join(root,'extension'),extension,{recursive:true});
 const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
 manifest.name+=debuggerProbe?'（调试能力探测）':'（本地测试副本）';
 if(debuggerProbe)manifest.permissions.push('debugger');
 if(debuggerProbe)manifest.host_permissions=['http://127.0.0.1/*','http://localhost/*'];
 manifest.content_security_policy.extension_pages=`script-src 'self'; object-src 'none'; connect-src ${base}`;
 // 仅测试副本自动打开 extension runner；正式发行目录不含测试工具或新增权限。
 await writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest,null,2));
 await mkdir(path.join(extension,'lab'));
 await cp(path.join(root,debuggerProbe?'tests/debugger-probe.js':'tests/browser-runner.js'),path.join(extension,'lab/runner.js'));
 await writeFile(path.join(extension,'lab/config.js'),`export const BASE=${JSON.stringify(base)};export const TOKEN=${JSON.stringify(token)};`);
 await writeFile(path.join(extension,'lab/runner.html'),'<!doctype html><html lang="zh-SG"><meta charset="utf-8"><title>Chrome Locale SG 浏览器测试</title><h1>无调试协议 · 浏览器测试</h1><pre>测试中…</pre><script type="module" src="runner.js"></script></html>');
 const background=await readFile(path.join(extension,'background.js'),'utf8');
 await writeFile(path.join(extension,'background.js'),background+`\n(async()=>{const s=await chrome.storage.session.get('labOpened');if(!s.labOpened){await chrome.storage.session.set({labOpened:true});await chrome.tabs.create({url:chrome.runtime.getURL('lab/runner.html')})}})();\n`);
 const flags=[`--user-data-dir=${path.join(dir,'profile')}`,`--load-extension=${extension}`,'--no-first-run','--no-default-browser-check',...(headless?['--headless=new']:[]),`${base}/fixture?launch=true`];
 if(flags.some(x=>/debugging|enable-automation|disable-infobars/.test(x)))throw Error('测试启动参数违规');
 await mkdir(path.join(root,'test-results'),{recursive:true});
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 let child;
 const stop=async()=>{
   if(!child)return;
   const pid=child.pid;
   if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));try{process.kill(-pid,'SIGTERM')}catch{}await Promise.race([exited,sleep(10000)]);}
   // 只检查、停止本次启动的独立进程组，不触碰用户的日常 Chrome。
   for(let i=0;i<30;i++){try{process.kill(-pid,0)}catch{return}await sleep(100)}
   try{process.kill(-pid,'SIGKILL');console.warn('测试进程组需强制结束，重启结果需审慎解释。')}catch{}
 };
 const metadata={runAt:new Date().toISOString(),browser,flags,profile:path.join(dir,'profile'),
   mode:headless?'headless':'headed',noDebugProtocol:!debuggerProbe,testCopyPermissions:manifest.host_permissions,
   fixtureIsProductionBundle:false,debuggerProbe,notes:'正式运行代码被复制到隔离测试副本；正常回归保持正式版网站权限，只增加测试页、本机回报 CSP 与启动入口；调试探测另有 debugger 权限且限制为 loopback。'};
 try{
   for(phase=1;phase<=(debuggerProbe?1:4);phase++){
     const promise=new Promise((resolve,reject)=>{
       const timeout=setTimeout(()=>reject(Error(`第 ${phase} 阶段超过 150 秒`)),150000);
       finishPhase=report=>{clearTimeout(timeout);resolve(report)};
     });
     const log=createWriteStream(path.join(root,`test-results/${debuggerProbe?'debugger':'chrome'}-phase-${phase}.log`));
     child=spawn(browser,flags,{detached:true,stdio:['ignore','ignore','pipe']});child.stderr.pipe(log);
     child.on('error',error=>console.error(error));
     const report=await promise;
     console.log(`第 ${phase} 阶段：${report.results.filter(x=>x.status==='pass').length} 通过，${report.results.filter(x=>x.status==='fail').length} 失败`);
     for(const fail of report.results.filter(x=>x.status==='fail'))console.log(`${fail.name}: ${fail.error}`);
     if(arg('--hold-seconds')&&phase===1){console.log('保留测试窗口供人工检查提示条。');await sleep(Number(arg('--hold-seconds'))*1000)}
     await sleep(700);await stop();await sleep(800);
     if(report.results.some(x=>x.status==='fail'))break;
   }
 }catch(error){metadata.harnessError=error.message;console.error(error.message)}
 finally{
   await stop();
   const manifestHash=createHash('sha256').update(await readFile(path.join(root,'extension/manifest.json'))).digest('hex');
   const output={...metadata,productionManifestSHA256:manifestHash,reports,requests};
   await writeFile(path.join(root,`test-results/${outputName}.json`),JSON.stringify(output,null,2));
   await new Promise(r=>server.close(r));
 }
 const failed=metadata.harnessError||reports.length!==(debuggerProbe?1:4)||reports.some(r=>r.results.some(t=>t.status==='fail'));
 console.log(`证据：${path.join(root,`test-results/${outputName}.json`)}`);
 console.log(`测试临时目录保留在 ${dir}，未删除。`);
 process.exitCode=failed?1:0;
}
