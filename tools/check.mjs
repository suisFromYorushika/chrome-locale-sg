import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../extension/',import.meta.url));
async function walk(dir){const out=[];for(const item of await readdir(dir,{withFileTypes:true})){const name=path.join(dir,item.name);if(item.isDirectory())out.push(...await walk(name));else out.push(name)}return out}
const files=await walk(root);
const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
assert.equal(manifest.manifest_version,3);
assert.equal(manifest.minimum_chrome_version,'119');
assert.deepEqual([...manifest.permissions].sort(),['storage','scripting','activeTab','declarativeNetRequestWithHostAccess'].sort());
assert.deepEqual(manifest.host_permissions,['http://*/*','https://*/*']);
assert.equal(manifest.externally_connectable,undefined);
assert.equal(manifest.web_accessible_resources,undefined);
assert.match(manifest.content_security_policy.extension_pages,/connect-src 'none'/);
assert.equal(manifest.optional_host_permissions,undefined);
for(const file of Object.values(manifest.icons))await stat(path.join(root,file));
for(const file of Object.values(manifest.action.default_icon))await stat(path.join(root,file));
for(const ref of [manifest.background.service_worker,manifest.action.default_popup,'content/main.js','content/preset.js','content/bridge.js'])await stat(path.join(root,ref));
for(const file of files){
 if(file.endsWith('.png')) { const bytes=await readFile(file);assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');continue; }
 const text=await readFile(file,'utf8');
 assert.doesNotMatch(text,/chrome\s*\.\s*debugger|remote-debugging|devtools-protocol|puppeteer|playwright|WebSocket\s*\(|XMLHttpRequest\s*\(|\bfetch\s*\(|\beval\s*\(|new\s+Function\s*\(/i,file);
 if(file.endsWith('.js')){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});assert.equal(result.status,0,`${file}\n${result.stderr}`)}
 if(file.endsWith('.html')){
  assert.doesNotMatch(text,/<script[^>]+src=["']https?:/i);
  assert.doesNotMatch(text,/\son(?:click|load|change)\s*=/i);
 }
}
console.log(`正式扩展 ${files.length} 个文件：语法、Manifest、权限声明、无外连/调试接口扫描全部通过。`);
