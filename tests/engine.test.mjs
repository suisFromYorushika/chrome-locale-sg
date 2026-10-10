import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../extension/lib/engine.js';
import { DEFAULTS } from '../extension/lib/settings.js';
function mock() {
  const state = { storage: {}, rules: [], scripts: [], origins: ['http://*/*','https://*/*'], fail: 0, calls: [] };
  const copy = structuredClone;
  const api = {
    storage: { local: {
      get: async () => copy(state.storage),
      set: async value => Object.assign(state.storage, copy(value)),
    } },
    permissions: { getAll: async () => ({ origins: state.origins }) },
    declarativeNetRequest: {
      getDynamicRules: async () => copy(state.rules),
      updateDynamicRules: async ({ addRules }) => { state.calls.push('dnr'); state.rules = copy(addRules); },
    },
    scripting: {
      getRegisteredContentScripts: async () => copy(state.scripts),
      registerContentScripts: async scripts => { if(state.fail-- > 0)throw Error('injected failure');state.scripts.push(...copy(scripts)); },
      updateContentScripts: async scripts => { if(state.fail-- > 0)throw Error('injected failure'); for(const s of scripts){state.scripts=state.scripts.filter(x=>x.id!==s.id);state.scripts.push(copy(s));} },
      unregisterContentScripts: async ({ids}) => {state.scripts=state.scripts.filter(s=>!ids.includes(s.id));},
      executeScript: async details => { state.calls.push(details); return []; },
    },
    tabs: { get: async id => ({ id, url: 'https://example.com' }), query: async () => [{ id: 1, url: 'https://example.com' }, { id: 2, url: 'chrome://extensions' }] },
  };
  return { api, state, engine: createEngine(api) };
}
test('启动写入默认值，开关同时改变脚本与规则', async () => {
  const { engine, state } = mock();
  await engine.startup(); assert.equal(state.storage.settings.enabled,true);
  assert.equal(state.rules.length,2); assert.equal(state.scripts.length,2);
  await engine.save({...DEFAULTS,enabled:false});
  assert.equal(state.rules.length,0); assert.equal(state.scripts.length,0);
  assert.equal(state.storage.applyStatus.state,'applied');
  await engine.save({...DEFAULTS}); assert.equal(state.rules.length,2);
});
test('更改首选与后备后，DNR 和注册模式同步更新', async () => {
  const {engine,state}=mock(); await engine.startup();
  await engine.save({...DEFAULTS,primary:'ja-JP',fallbacks:['zh-SG']});
  assert.equal(state.rules[0].action.requestHeaders[0].value,'ja-JP,zh-SG;q=0.9');
  assert.equal(state.scripts[0].js.includes('content/preset.js'),false);
  assert.equal(state.storage.applyStatus.mode,'async-custom');
});
test('注册失败时回滚 storage、DNR 与脚本，不假报成功', async () => {
  const {engine,state}=mock(); await engine.startup(); state.fail=1;
  await assert.rejects(engine.save({...DEFAULTS,primary:'ja-JP'}),/已回滚/);
  assert.equal(state.storage.settings.primary,'zh-SG');
  assert.equal(state.rules[0].action.requestHeaders[0].value.startsWith('zh-SG,'),true);
  assert.equal(state.scripts[0].js.includes('content/preset.js'),true);
});
test('权限撤销移除全部注册与规则', async () => {
  const {engine,state}=mock(); await engine.startup(); state.origins=[];
  await engine.permissionsChanged(); assert.deepEqual(state.rules,[]); assert.deepEqual(state.scripts,[]);
});
test('快速并发保存按提交顺序应用', async () => {
  const {engine,state}=mock(); await engine.startup();
  await Promise.all([engine.save({...DEFAULTS,enabled:false}),engine.save({...DEFAULTS,primary:'en-US'}),engine.save({...DEFAULTS})]);
  assert.equal(state.storage.settings.primary,'zh-SG'); assert.equal(state.storage.settings.enabled,true);
  assert.equal(state.scripts.length,2);
});
test('进程被中断后的新 engine 按已持久化目标恢复', async () => {
  const {api,state}=mock(); state.storage.settings={...DEFAULTS,enabled:false}; state.storage.applyStatus={state:'applying'};
  state.rules=[{id:6101}]; state.scripts=[{id:'locale-sg-main'}];
  await createEngine(api).startup(); assert.deepEqual(state.rules,[]); assert.deepEqual(state.scripts,[]);
  assert.equal(state.storage.applyStatus.state,'applied');
});
test('文档使用 documentId 精确定位，不注入导航后的另一文档', async () => {
  const {engine,state}=mock();await engine.startup();
  await engine.syncDocument({tab:{id:4},documentId:'document-a',url:'https://example.com'});
  const calls=state.calls.filter(c=>typeof c==='object');
  assert.deepEqual(calls.at(-1).target,{tabId:4,documentIds:['document-a']});
  assert.equal(calls.at(-1).world,'MAIN');
});

test('启动主动同步已打开标签，不要求用户打开 Popup', async () => {
  const {engine,state}=mock();await engine.startup();
  assert.equal(state.storage.applyStatus.live.synced,1);
  assert.equal(state.calls.some(c=>c?.target?.tabId===1&&c.world==='MAIN'),true);
});
test('导航完成补同步当前标签，处理早于注册加载的启动页面',async()=>{
  const {engine,state}=mock();await engine.startup();state.calls=[];await engine.syncTab(1);
  assert.equal(state.calls.some(c=>c?.files?.includes('content/main.js')),true);
  assert.equal(state.calls.some(c=>c?.world==='MAIN'&&c.args?.[0]?.primary==='zh-SG'),true);
});
