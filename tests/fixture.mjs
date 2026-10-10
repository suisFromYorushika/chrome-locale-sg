export function fixture({ header, origin, crossOrigin, frame = false, name = 'top', nonce = false, debuggerProbe = false }) {
  const attr = nonce ? ' nonce="locale-sg-test"' : '';
  const capture = `({language:navigator.language,languages:Array.from(navigator.languages),date:new Intl.DateTimeFormat().resolvedOptions().locale,number:new Intl.NumberFormat().resolvedOptions().locale,zone:new Intl.DateTimeFormat().resolvedOptions().timeZone,ua:navigator.userAgent})`;
  if (frame) return `<!doctype html><html lang="zh"><head><script${attr}>window.__early=${capture};window.__requestHeader=${JSON.stringify(header)};parent.postMessage({labFrame:${JSON.stringify(name)},early:__early,header:__requestHeader},'*');</script></head><body>iframe ${name}</body></html>`;
  return `<!doctype html><html lang="zh-SG"><head><meta charset="utf-8"><script${attr}>
window.__early=${capture}; window.__requestHeader=${JSON.stringify(header)};
window.__frames={};addEventListener('message',e=>{if(e.data?.labFrame)window.__frames[e.data.labFrame]=e.data});
</script><title>Chrome Locale SG · 本地验收</title></head><body style="font:16px -apple-system,sans-serif;padding:32px;background:#f1f8f5;color:#153d30">
<h1>Chrome Locale SG · 本地验收</h1><p>${debuggerProbe ? "调试能力探测：本轮主动使用 chrome.debugger，只访问本机。" : "此页面仅访问本机，不使用浏览器调试协议。"}</p><pre id="output"></pre>
<iframe src="${origin}/frame?name=same" title="同源 iframe"></iframe>
<iframe src="${crossOrigin}/frame?name=cross" title="跨源 iframe"></iframe>
<script${attr}>
(async()=>{
 const capture=()=>${capture};
 const blank=document.createElement('iframe');document.body.append(blank);
 window.__immediateBlank={language:blank.contentWindow.navigator.language,date:new blank.contentWindow.Intl.DateTimeFormat().resolvedOptions().locale};
 const docScript='parent.postMessage({labFrame:"srcdoc",early:{language:navigator.language,date:new Intl.DateTimeFormat().resolvedOptions().locale}},"*")';
 const srcdoc=document.createElement('iframe');srcdoc.srcdoc='<script>'+docScript+'<'+ '/script>';document.body.append(srcdoc);
 const sandbox=document.createElement('iframe');sandbox.sandbox='allow-scripts';sandbox.srcdoc='<script>'+docScript.replace('srcdoc','sandbox')+'<'+ '/script>';document.body.append(sandbox);
 window.__worker=await new Promise(resolve=>{const url=URL.createObjectURL(new Blob(['postMessage('+${JSON.stringify(capture)}+')'],{type:'text/javascript'}));const worker=new Worker(url);worker.onmessage=e=>{resolve(e.data);worker.terminate();URL.revokeObjectURL(url)};worker.onerror=()=>resolve({error:'worker blocked'});setTimeout(()=>resolve({error:'worker timeout'}),1500)});
 window.__echo=await fetch('/echo',{cache:'no-store'}).then(r=>r.json());
 window.__late=capture();window.__ready=true;
 document.querySelector('#output').textContent=JSON.stringify({firstScript:__early,requestHeader:__requestHeader,fetch:__echo,worker:__worker,immediateBlank:__immediateBlank},null,2);
})();
</script></body></html>`;
}
