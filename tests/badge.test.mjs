import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, settingsFromStorage } from '../extension/lib/settings.js';
import { indicatorState, createIndicator } from '../extension/lib/badge.js';
const all=['http://*/*','https://*/*'];
const address='https://example.com/';
const state={state:'applied',ruleCount:2,registrationCount:2};
const actual={href:address,language:'zh-SG',languages:['zh-SG','en-US'],date:'zh-SG',number:'zh-SG',controller:{enabled:true,warnings:[]}};
const classify=(s=DEFAULTS,origins=all,url=address,status=state,probe=actual)=>indicatorState(s,origins,url,status,probe);
test('只有真实值与规则状态都符合才显示绿色',()=>{
 assert.equal(classify(),'active');
 assert.equal(classify(DEFAULTS,all,address,state,null),'pending');
 assert.equal(classify(DEFAULTS,all,address,state,{...actual,date:'zh-CN'}),'mismatch');
 assert.equal(classify(DEFAULTS,all,address,{...state,ruleCount:0}),'mismatch');
 assert.equal(classify(DEFAULTS,all,address,state,{...actual,controller:null}),'pending');
});
test('关闭、排除、未授权与受限页面各自区分',()=>{
 assert.equal(classify({...DEFAULTS,enabled:false}),'off');
 assert.equal(classify({...DEFAULTS,exclude:['example.com']}),'excluded');
 assert.equal(classify({...DEFAULTS,include:['other.com']}),'excluded');
 assert.equal(classify(DEFAULTS,[]),'permission');
 assert.equal(classify(DEFAULTS,all,'chrome://extensions'),'restricted');
 assert.equal(indicatorState(DEFAULTS,all,undefined,state,actual),'restricted');
});
test('保存进行中、失败和过期文档不会显示绿灯',()=>{
 assert.equal(classify(DEFAULTS,all,address,{state:'applying'}),'pending');
 assert.equal(classify({...DEFAULTS,enabled:false},all,address,{state:'error'}),'error');
 assert.equal(classify(DEFAULTS,all,address,state,{...actual,href:'https://old.example/'}),'pending');
});
test('迁移旧默认组合且保留开关和网站排除',()=>{
 const s=settingsFromStorage({settings:{...DEFAULTS,enabled:false,fallbacks:['zh-CN','en-US'],exclude:['example.com']}});
 assert.deepEqual(s.fallbacks,['en-US']);assert.equal(s.enabled,false);assert.deepEqual(s.exclude,['example.com']);
});
test('不覆盖用户自定义组合，schema 2 以后不再偷偷迁移',()=>{
 assert.deepEqual(settingsFromStorage({settings:{...DEFAULTS,fallbacks:['ja-JP']}}).fallbacks,['ja-JP']);
 assert.deepEqual(settingsFromStorage({settingsSchema:2,settings:{...DEFAULTS,fallbacks:['zh-CN','en-US']}}).fallbacks,['zh-CN','en-US']);
});
test('真实页面读取完成前发生关闭：异步旧结果不能涂绿',async()=>{
 let resolveProbe,settings={...DEFAULTS};const badges=[];
 const api={
  action:Object.fromEntries(['setIcon','setBadgeText','setBadgeBackgroundColor','setBadgeTextColor','setTitle'].map(name=>[name,async x=>{if(name==='setBadgeText')badges.push(x.text)}])),
  storage:{local:{get:async()=>({settings:structuredClone(settings),settingsSchema:2,applyStatus:state})}},
  permissions:{getAll:async()=>({origins:all})},
  tabs:{get:async()=>({url:address}),query:async()=>[{id:1}]},
  scripting:{executeScript:async()=>new Promise(resolve=>{resolveProbe=resolve})},
 };
 const indicator=createIndicator(api);const old=indicator.refreshTab(1);
 await new Promise(resolve=>setImmediate(resolve));
 settings.enabled=false;await indicator.refreshTab(1);resolveProbe([{result:actual}]);await old;
 assert.equal(badges.at(-1),'关');assert.equal(badges.includes('开'),false);
});
