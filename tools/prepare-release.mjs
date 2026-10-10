// 仅在本地准备审核材料，不建仓库、不联网、不推送、不创建 Release。
import { cp, mkdtemp, readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const parent=await mkdtemp(path.join(os.tmpdir(),'chrome-locale-sg-release-'));
const source=path.join(parent,'source');await mkdir(source);
const include=['extension','tests','tools','README.md','package.json','.gitignore','docs/验收记录.md'];
for(const name of include)await cp(path.join(root,name),path.join(source,name),{recursive:true});
const prohibited=[
 ['本机用户路径',/(?:\/Users\/|\/home\/|[A-Z]:\\Users\\|x-coredata:\/\/)/],
 ['个人身份',/\b[\w.+-]+@(?:gmail|qq)\.com\b/i],
 ['家庭配置',/192\.168\.0\./],
 ['凭据',/github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];
const files=[];
async function inspect(dir){for(const item of await readdir(dir,{withFileTypes:true})){
 const absolute=path.join(dir,item.name);if(item.isDirectory()){await inspect(absolute);continue;}
 const relative=path.relative(source,absolute).split(path.sep).join('/'),data=await readFile(absolute);
 if(!relative.endsWith('.png'))for(const [reason,pattern] of prohibited)if(pattern.test(data.toString('utf8')))throw Error(`发布审核不通过：${relative}（${reason}），未上传任何内容。`);
 files.push({path:relative,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
}}
await inspect(source);
const manifest=JSON.parse(await readFile(path.join(source,'extension/manifest.json'),'utf8'));
const assetNames=[`Chrome-Locale-SG-v${manifest.version}.zip`,'SHA256SUMS.txt','FILES-SHA256SUMS.txt'];
await mkdir(path.join(parent,'assets'));for(const name of assetNames)await cp(path.join(root,'dist',name),path.join(parent,'assets',name));
const notes=path.join(parent,'release-notes.md');
await writeFile(notes,`# Chrome Locale SG ${manifest.version}

- 默认语言精简为 zh-SG、en-US，Accept-Language 为 zh-SG,en-US;q=0.9。
- 新安装默认开启、默认所有 HTTP / HTTPS 网站。
- 浏览器启动与导航完成自动同步；工具栏状态灯和中文角标显示当前页实际状态。
- 保留显式语言和原生时区；正式版没有调试权限、遥测或远程代码。
- 旧默认组合自动迁移，保留用户自定义设置。

## 安装
下载版本 ZIP 并解压，在每份 Chrome Profile 的 chrome://extensions 开启开发者模式，加载其中的 extension 文件夹，并固定到工具栏。另一台电脑同样安装；无需 Node。

GitHub Release 不提供 Chrome 商店式自动安装/更新。新版本改为全站访问权限，旧安装升级可能需要重新确认权限。

## 验证与限制
实际验收结果见源码中的 docs/验收记录.md。启动最早请求存在竞态；自动补同步不会倒改已经发出的请求。Worker、原生 toLocaleString 等限制见 README。
`);
const result={version:manifest.version,source,notes,assets:assetNames.map(x=>path.join(parent,'assets',x)),files:files.sort((a,b)=>a.path.localeCompare(b.path)),published:false};
await writeFile(path.join(root,'release-prep.json'),JSON.stringify(result,null,2)+'\n');
console.log(`已在本机准备 ${files.length} 个干净源码文件及 ${assetNames.length} 个 Release 附件。`);
console.log(`审核目录：${source}`);console.log('未创建远端仓库、未上传、未发布；需要确认仓库可见性。');
