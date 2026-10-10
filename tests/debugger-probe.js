// 仅在用户允许考虑调试方案后运行的能力探测；不在正式发布目录中。
import { BASE,TOKEN } from './config.js';
const results=[],observations={detachEvents:[]};
chrome.debugger.onDetach.addListener((source,reason)=>observations.detachEvents.push({tabId:source.tabId,reason}));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const disabled={enabled:false,primary:'zh-SG',fallbacks:['en-US'],include:[],exclude:[]};
const msg=async(type,extra={})=>{const r=await chrome.runtime.sendMessage({type,...extra});if(!r?.ok)throw Error(r?.error);return r.data};
const check=(name,pass,error)=>results.push({name,status:pass?'pass':'fail',...(error?{error}: {})});
let target=null;
async function get(tabId){return(await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:async()=>{
 const baseline={language:navigator.language,languages:[...navigator.languages],date:new Intl.DateTimeFormat().resolvedOptions().locale,
 number:new Intl.NumberFormat().resolvedOptions().locale,empty:new Intl.DateTimeFormat([]).resolvedOptions().locale,
 zone:new Intl.DateTimeFormat().resolvedOptions().timeZone,ua:navigator.userAgent,
 constructorNative:Intl.DateTimeFormat.prototype.constructor===Intl.DateTimeFormat,
 dateString:new Date('2026-10-10T00:00:00Z').toLocaleString(),dateSG:new Date('2026-10-10T00:00:00Z').toLocaleString('zh-SG'),
 explicitEN:new Intl.DateTimeFormat('en-US').resolvedOptions().locale,explicitJA:new Intl.NumberFormat('ja-JP').resolvedOptions().locale};
 baseline.worker=await new Promise(resolve=>{const u=URL.createObjectURL(new Blob(['postMessage({language:navigator.language,date:new Intl.DateTimeFormat().resolvedOptions().locale})'],{type:'text/javascript'}));const w=new Worker(u);w.onmessage=e=>{resolve(e.data);w.terminate();URL.revokeObjectURL(u)};setTimeout(()=>resolve({timeout:true}),1500)});return baseline;
}}))[0].result}
try{
 await msg('SET_SETTINGS',{settings:disabled});
 const tab=await chrome.tabs.create({url:`${BASE}/fixture`,active:true});
 for(let i=0;i<50;i++){try{if((await chrome.tabs.get(tab.id)).status==='complete')break}catch{}await sleep(100)}
 observations.before=await get(tab.id);target={tabId:tab.id};
 await chrome.debugger.attach(target,'1.3');check('chrome.debugger 可以附加本机测试标签',true);
 try{await chrome.debugger.sendCommand(target,'Emulation.setLocaleOverride',{locale:'zh-SG'});observations.setLocale={success:true};}
 catch(e){observations.setLocale={success:false,error:e.message};}
 observations.after=await get(tab.id);
 check('原生 Locale override 能力实测',observations.setLocale.success,observations.setLocale.error);
 if(observations.setLocale.success){
  check('原生 Intl 与空 locale 列表都使用 zh-SG',observations.after.date==='zh-SG'&&observations.after.number==='zh-SG'&&observations.after.empty==='zh-SG');
  check('构造函数身份没有 JS 包装',observations.after.constructorNative);
  check('原生 Date.toLocaleString 使用 zh-SG',observations.after.dateString===observations.after.dateSG);
  check('显式语言仍保留',observations.after.explicitEN==='en-US'&&observations.after.explicitJA==='ja-JP');
  check('不改变 User-Agent 或原生时区',observations.after.ua===observations.before.ua&&observations.after.zone===observations.before.zone);
  const second=await chrome.tabs.create({url:`${BASE}/fixture?same-origin=unattached`,active:false});
  await sleep(1000);observations.unattachedSameOrigin=await get(second.id);await chrome.tabs.remove(second.id);
  await chrome.tabs.reload(tab.id);await sleep(700);observations.afterReload=await get(tab.id);
  check('附加后刷新保持原生 Intl zh-SG',observations.afterReload.date==='zh-SG'&&observations.afterReload.constructorNative);
  observations.targetsBeforeDetach=(await chrome.debugger.getTargets()).filter(t=>t.tabId===tab.id).map(t=>({attached:t.attached,type:t.type}));
  await chrome.debugger.sendCommand(target,'Emulation.setLocaleOverride',{locale:''});await chrome.debugger.detach(target);target=null;
  observations.afterDetach=await get(tab.id);
  check('清除原生覆盖并解除附加后恢复原始 Locale',observations.afterDetach.date===observations.before.date&&observations.afterDetach.empty===observations.before.empty);
  check('解除后 navigator、时区和 User-Agent 保持原生',observations.afterDetach.language===observations.before.language&&observations.afterDetach.zone===observations.before.zone&&observations.afterDetach.ua===observations.before.ua);
 }
 await fetch(`${BASE}/results/${TOKEN}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phase:1,results,observations})});
 document.querySelector('pre').textContent=JSON.stringify({results,observations},null,2);
 // 不隐藏警告；正常完成时已清除覆盖并解除附加，随后由测试工具关闭独立进程。
}catch(e){results.push({name:'调试能力探测流程',status:'fail',error:e.stack??e.message});await fetch(`${BASE}/results/${TOKEN}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phase:1,results,observations})})}
