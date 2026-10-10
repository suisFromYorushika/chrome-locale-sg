import { BASE, TOKEN } from './config.js';
const results = [];
const observations = {};
const defaults = {enabled:true,primary:'zh-SG',fallbacks:['en-US'],include:[],exclude:[]};
const expectedHeader='zh-SG,en-US;q=0.9';
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function message(type, extra={}) {
  const r=await chrome.runtime.sendMessage({type,...extra});
  if(!r?.ok)throw Error(r?.error??'后台无响应');return r.data;
}
async function check(name, fn) {
  try {const value=await fn(); if(value===false)throw Error('断言失败');results.push({name,status:'pass'});}
  catch(error){results.push({name,status:'fail',error:error.message});}
  document.querySelector('pre').textContent=JSON.stringify({results,observations},null,2);
}
function equal(a,b) {if(JSON.stringify(a)!==JSON.stringify(b))throw Error(`实际 ${JSON.stringify(a)}；预期 ${JSON.stringify(b)}`);}
async function evalPage(tabId,func,args=[]) {return (await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},world:'MAIN',func,args}))[0]?.result;}
async function waitPage(tab) {
  for(let i=0;i<90;i++){
    try{if(await evalPage(tab.id,()=>Boolean(window.__ready)))return tab;}catch{}
    await sleep(100);
  }throw Error('测试页面加载超时');
}
async function open(host='127.0.0.1',path='/fixture') {
  const url=new URL(path,BASE);url.hostname=host;url.searchParams.set('r',crypto.randomUUID());
  return waitPage(await chrome.tabs.create({url:url.href,active:true}));
}
async function reload(tab) {await evalPage(tab.id,()=>{window.__ready=false});await chrome.tabs.reload(tab.id,{bypassCache:true});return waitPage(tab);}
async function snap(tab) {
  return evalPage(tab.id,()=>({early:window.__early,header:window.__requestHeader,echo:window.__echo,
    worker:window.__worker,frames:window.__frames,blank:window.__immediateBlank,
    language:navigator.language,languages:Array.from(navigator.languages),
    date:new Intl.DateTimeFormat().resolvedOptions().locale,number:new Intl.NumberFormat().resolvedOptions().locale,
    zone:new Intl.DateTimeFormat().resolvedOptions().timeZone,
    controller:globalThis[Symbol.for('chrome-locale-sg.controller.v1')]?.status()??null}));
}
async function readyLocale(tab,locale) {
  for(let i=0;i<50;i++){const s=await snap(tab);if(s.language===locale&&s.date===locale)return s;await sleep(100);}
  return snap(tab);
}
async function save(settings) {return message('SET_SETTINGS',{settings});}
async function badge(tab, text) {
  for(let i=0;i<50;i++) { if(await chrome.action.getBadgeText({tabId:tab.id})===text)return; await sleep(100); }
  equal(await chrome.action.getBadgeText({tabId:tab.id}),text);
}
const stage = await fetch(`${BASE}/phase`).then(r=>r.json());
try {
  await message('GET_STATUS');
  if(stage.phase===1){
    await check('新安装默认启用、仅两个语言且全站授权',async()=>{
      const s=await message('GET_STATUS');equal(s.settings,defaults);
      equal(s.grantedOrigins.includes('http://*/*')&&s.grantedOrigins.includes('https://*/*'),true);
    });
    const tab=await open(); const first=await snap(tab);
    observations.first=first;
    await check('实际生效后图标为绿色开',async()=>{await badge(tab,'开');equal(await chrome.action.getBadgeBackgroundColor({tabId:tab.id}),[20,122,81,255]);});
    await check('页面被改写时图标不假报运行',async()=>{
      await evalPage(tab.id,()=>{Intl.DateTimeFormat=Intl.DateTimeFormat.prototype.constructor});
      await message('REFRESH_BADGE',{tabId:tab.id});await badge(tab,'!');await reload(tab);await badge(tab,'开');
    });
    const baseline=first.controller?.baseline;
    if(!baseline)throw Error('真实页面上没有控制器，MV3 注入未生效');
    await chrome.storage.local.set({labBaseline:baseline,labUA:first.early.ua});
    await check('首段 inline 脚本 navigator.language',()=>equal(first.early.language,'zh-SG'));
    await check('首段 inline 脚本 navigator.languages',()=>equal(first.early.languages,['zh-SG','en-US']));
    await check('Intl.DateTimeFormat 默认 locale',()=>equal(first.early.date,'zh-SG'));
    await check('Intl.NumberFormat 默认 locale',()=>equal(first.early.number,'zh-SG'));
    await check('真实主文档 HTTP Accept-Language',()=>equal(first.header,expectedHeader));
    await check('真实 fetch HTTP Accept-Language',()=>equal(first.echo.acceptLanguage,expectedHeader));
    await check('系统时区保持 Asia/Singapore',()=>{equal(first.zone,baseline.timeZone);equal(first.zone,'Asia/Singapore')});
    await check('User-Agent 未改变',()=>equal(first.early.ua,first.worker.ua));
    await check('Worker 保留原始语言（已知边界）',()=>{equal(first.worker.language,baseline.language);equal(first.worker.date,baseline.dateLocale)});
    for(let i=0;i<30;i++){const s=await snap(tab);if(s.frames.same&&s.frames.cross)break;await sleep(100)}
    const frames=(await snap(tab)).frames; observations.frames=frames;
    for(const name of ['same','cross'])await check(`${name==='same'?'同源':'已授权跨源'} iframe 最早脚本和请求头`,()=>{
      equal(frames[name]?.early.language,'zh-SG');equal(frames[name]?.early.date,'zh-SG');equal(frames[name]?.header,expectedHeader);
    });
    await check('显式 en-US / ja-JP / Locale / Unicode 扩展保留',async()=>{
      equal(await evalPage(tab.id,()=>{
        const native=Intl.DateTimeFormat.prototype.constructor;
        const nativeN=Intl.NumberFormat.prototype.constructor;
        return [
          new Intl.DateTimeFormat('en-US').resolvedOptions().locale===new native('en-US').resolvedOptions().locale,
          new Intl.NumberFormat('ja-JP').resolvedOptions().locale===new nativeN('ja-JP').resolvedOptions().locale,
          new Intl.DateTimeFormat(new Intl.Locale('en-GB')).resolvedOptions().locale===new native('en-GB').resolvedOptions().locale,
          new Intl.NumberFormat('zh-SG-u-nu-hanidec').format(123)===new nativeN('zh-SG-u-nu-hanidec').format(123),
          new Intl.DateTimeFormat(undefined,{timeZone:'UTC'}).resolvedOptions().timeZone==='UTC',
        ].every(Boolean);
      }),true);
    });
    await check('原型、静态方法、子类与异常兼容',async()=>equal(await evalPage(tab.id,()=>{
      const C=Intl.DateTimeFormat, N=C.prototype.constructor;
      class D extends C{};const d=new D();
      let illegal=false,invalid=false;try{Object.getOwnPropertyDescriptor(Navigator.prototype,'language').get.call({})}catch(e){illegal=e instanceof TypeError}
      try{new C(null)}catch(e){invalid=e instanceof TypeError}
      return C.prototype===N.prototype&&C.supportedLocalesOf===N.supportedLocalesOf&&d instanceof D&&d instanceof N&&illegal&&invalid;
    }),true));
    await check('刷新网页后仍在首段脚本生效',async()=>{await reload(tab);equal((await snap(tab)).early.language,'zh-SG')});
    await check('新建普通网页标签自动生效',async()=>{const fresh=await open();equal((await snap(fresh)).early.language,'zh-SG');await chrome.tabs.remove(fresh.id)});
    await save({...defaults,enabled:false});
    await check('总开关关闭后图标显示关',()=>badge(tab,'关'));
    await check('关闭后已加载页面实时还原 getter 和 Intl',async()=>{const s=await snap(tab);equal(s.language,baseline.language);equal(s.date,baseline.dateLocale)});
    await check('关闭后移除全部 DNR 与脚本注册',async()=>{const s=await message('GET_STATUS');equal(s.rules,[]);equal(s.scripts,[])});
    await reload(tab);const off=await snap(tab); observations.disabled=off;
    await chrome.storage.local.set({labNativeHeader:off.header});
    await check('关闭并刷新后原生语言和真实请求头还原',()=>{equal(off.early.language,baseline.language);if(off.header===expectedHeader)throw Error('请求头仍为扩展目标值')});
    await check('禁用期间新标签页保留原生值',async()=>{const fresh=await open();equal((await snap(fresh)).early.language,baseline.language);await chrome.tabs.remove(fresh.id)});
    await save(defaults);await reload(tab);
    await check('再次开启后首段脚本和请求头恢复',async()=>{const s=await snap(tab);equal(s.early.language,'zh-SG');equal(s.header,expectedHeader)});
    await save({...defaults,primary:'ja-JP',fallbacks:['zh-SG','en-US']});await reload(tab);
    await check('自定义语言编辑真实同步 JS 与 HTTP',async()=>{const s=await readyLocale(tab,'ja-JP');observations.custom=s;equal(s.language,'ja-JP');equal(s.date,'ja-JP');equal(s.number,'ja-JP');equal(s.header,'ja-JP,zh-SG;q=0.9,en-US;q=0.8')});
    await save({...defaults,fallbacks:['en-US','ja-JP']});await reload(tab);
    await check('单独编辑后备列表真实生效',async()=>{const s=await readyLocale(tab,'zh-SG');equal(s.languages,['zh-SG','en-US','ja-JP']);equal(s.header,'zh-SG,en-US;q=0.9,ja-JP;q=0.8')});
    await save({...defaults,include:['localhost']});await reload(tab);
    await check('启用域名白名单：未列网站 JS 和主请求头原生',async()=>{const s=await snap(tab);equal(s.language,baseline.language);equal(s.header,off.header)});
    const local=await open('localhost');
    await check('启用域名白名单：列出的网站生效',async()=>{const s=await snap(local);equal(s.early.language,'zh-SG');equal(s.header,expectedHeader)});
    await save({...defaults,exclude:['localhost']});await reload(local);
    await check('排除网站图标显示不运行',()=>badge(local,'—'));
    await check('排除网站 JS 与请求头同时还原',async()=>{const s=await snap(local);equal(s.early.language,baseline.language);equal(s.header,off.header)});
    await chrome.tabs.remove(local.id);await save(defaults);await reload(tab);
    await check('已排除网站发起请求不会误触发资源规则',async()=>{
      await save({...defaults,exclude:['localhost']});const excluded=await open('localhost');
      const s=await snap(excluded);equal(s.echo.acceptLanguage,off.header);await chrome.tabs.remove(excluded.id);await save(defaults);
    });
    const strict=await open('127.0.0.1','/csp');
    await check('限制性 CSP 页面 MAIN 注入',async()=>{const s=await snap(strict);equal(s.early.language,'zh-SG');equal(s.early.date,'zh-SG')});await chrome.tabs.remove(strict.id);
    await check('浏览器受限页图标不假报生效',async()=>{
      const restricted=await chrome.tabs.create({url:'chrome://version',active:false});await badge(restricted,'—');await chrome.tabs.remove(restricted.id);
    });
    await check('没有 debugger 权限或远程代码权限',()=>{
      const m=chrome.runtime.getManifest();equal(m.permissions.includes('debugger'),false);equal(Boolean(m.externally_connectable),false);
    });
    await save({...defaults,primary:'ja-JP',fallbacks:['zh-SG','en-US']});
  }else{
    const {labBaseline:baseline,labNativeHeader:nativeHeader}=await chrome.storage.local.get(['labBaseline','labNativeHeader']);
    const s=await message('GET_STATUS');const tab=await open();
    const launched=(await chrome.tabs.query({})).find(t=>t.url?.includes('/fixture?launch=true'));
    if(!launched)throw Error('未找到浏览器启动时自动加载的网页');
    await waitPage(launched);observations.automaticStartup=await snap(launched);
    if(stage.phase===2){
      await check('完全重启：自定义配置持久化',()=>equal(s.settings.primary,'ja-JP'));
      await check('完全重启：自定义 JS 最终生效',async()=>{const v=await readyLocale(tab,'ja-JP');observations.restartCustom=v;equal(v.language,'ja-JP');equal(v.date,'ja-JP')});
      await check('完全重启：第一笔 HTTP 请求头持久化',async()=>equal((await snap(tab)).header,'ja-JP,zh-SG;q=0.9,en-US;q=0.8'));
      await save(defaults);
    }else if(stage.phase===3){
      const v=await snap(tab);observations.restartPreset=v;
      await check('完全重启：预设在首段 inline 脚本生效',()=>{equal(v.early.language,'zh-SG');equal(v.early.date,'zh-SG');equal(v.early.number,'zh-SG')});
      await check('完全重启：预设请求头持久化',()=>equal(v.header,expectedHeader));
      await check('打开浏览器自动生效：首个网页无需打开 Popup 或刷新',async()=>{
        const cold=await readyLocale(launched,'zh-SG');observations.automaticStartup=cold;
        equal(cold.language,'zh-SG');equal(cold.languages,['zh-SG','en-US']);equal(cold.date,'zh-SG');
        const echo=await evalPage(launched.id,()=>fetch('/echo',{cache:'no-store'}).then(r=>r.json()));equal(echo.acceptLanguage,expectedHeader);
      });
      const cold=observations.automaticStartup;
      results.push({name:'启动导航最早 inline 脚本和第一笔主文档请求',
        status:cold.early.language==='zh-SG'&&cold.header===expectedHeader?'pass':'limitation',
        ...(cold.early.language==='zh-SG'&&cold.header===expectedHeader?{}:{detail:'命令行加载的临时测试扩展可能晚于首个导航；原始首读已如实保留，之后自动补同步，未算最早阶段成功。'})});
      await check('重启后启动网页图标自动显示开',()=>badge(launched,'开'));
      await save({...defaults,enabled:false});
    }else if(stage.phase===4){
      const v=await snap(tab);observations.restartDisabled=v;
      await check('完全重启：禁用状态持久化',()=>{equal(s.settings.enabled,false);equal(s.rules,[]);equal(s.scripts,[])});
      await check('重启后关闭状态图标显示关',()=>badge(launched,'关'));
      await check('完全重启：禁用时 JS 和 HTTP 原生',()=>{equal(v.early.language,baseline.language);equal(v.early.date,baseline.dateLocale);equal(v.header,nativeHeader)});
    }
  }
}catch(error){results.push({name:'测试流程',status:'fail',error:error.stack??error.message})}
const report={phase:stage.phase,userAgent:navigator.userAgent,results,observations};
document.querySelector('pre').textContent=JSON.stringify(report,null,2);
await fetch(`${BASE}/results/${TOKEN}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});
