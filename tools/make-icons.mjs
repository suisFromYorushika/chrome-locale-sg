// 简单可复现的代码原生工具栏图标；PNG 无外部依赖，不需要远程图像服务。
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { png } from './png.mjs';
const out=fileURLToPath(new URL('../extension/icons/',import.meta.url));await mkdir(out,{recursive:true});
const glyphs={S:['111','100','111','001','111'],G:['111','100','101','101','111']};
const colors={active:[33,187,126],pending:[239,173,54],idle:[137,150,157],error:[224,77,79]};
function render(size,state){
 const scale=4,n=size*scale,raw=new Uint8Array(n*n*4);
 const dot=colors[state];
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const xx=(x+.5)/n*32, yy=(y+.5)/n*32;
  let color=null;
  const ax=Math.max(4-xx,0,xx-28),ay=Math.max(4-yy,0,yy-28);
  if(xx>=1&&xx<=31&&yy>=1&&yy<=31&&ax*ax+ay*ay<=9)color=[24,83,77];
  const gx=Math.floor((xx-5)/3),gy=Math.floor((yy-10)/3);
  if(gy>=0&&gy<5&&gx>=0&&gx<7){const g=gx<3?'S':gx>3?'G':null;const col=gx<3?gx:gx-4;if(g&&glyphs[g][gy][col]==='1')color=[239,250,245];}
  if(dot){const d=(xx-26)**2+(yy-6)**2;if(d<35)color=[250,253,251];if(d<21)color=dot;}
  if(color){const i=(y*n+x)*4;raw.set([...color,255],i);}
 }
 const small=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++)for(let c=0;c<4;c++){
  let v=0;for(let sy=0;sy<scale;sy++)for(let sx=0;sx<scale;sx++)v+=raw[(((y*scale+sy)*n)+(x*scale+sx))*4+c];small[(y*size+x)*4+c]=Math.round(v/(scale*scale));
 }
 return png(size,size,small);
}
for(const size of [16,32,48,128])await writeFile(`${out}/base-${size}.png`,render(size));
for(const state of Object.keys(colors))for(const size of [16,32])await writeFile(`${out}/${state}-${size}.png`,render(size,state));
console.log('已生成 SG 图标及四种状态灯（12 个 PNG）。');
