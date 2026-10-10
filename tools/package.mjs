import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeZip } from './zip.mjs';
await import('./check.mjs');
const root=fileURLToPath(new URL('../',import.meta.url));
const {version}=JSON.parse(await readFile(path.join(root,'extension/manifest.json'),'utf8'));
const entries=[],hashes=[];
async function collect(dir){for(const f of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,f.name);if(f.isDirectory())await collect(p);else {
 const data=await readFile(p),name=path.relative(root,p).split(path.sep).join('/');
 entries.push({name,data});hashes.push(`${createHash('sha256').update(data).digest('hex')}  ${name}`);
}}}
await collect(path.join(root,'extension'));entries.sort((a,b)=>a.name.localeCompare(b.name));
const out=path.join(root,`dist/Chrome-Locale-SG-v${version}.zip`);
await mkdir(path.dirname(out),{recursive:true});const zip=makeZip(entries);await writeFile(out,zip);
await writeFile(path.join(root,'dist/Chrome-Locale-SG.zip'),zip);
await writeFile(path.join(root,'dist/SHA256SUMS.txt'),`${createHash('sha256').update(zip).digest('hex')}  ${path.basename(out)}\n`);
await writeFile(path.join(root,'dist/FILES-SHA256SUMS.txt'),hashes.sort().join('\n')+'\n');
console.log(`已生成 ${out}；只含正式扩展，解压后选择 extension 目录。`);
