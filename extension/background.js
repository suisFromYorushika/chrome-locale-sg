import { createEngine } from './lib/engine.js';
import { createIndicator } from './lib/badge.js';
const engine = createEngine(chrome);
const indicator = createIndicator(chrome);
const report = error => console.warn('Chrome Locale SG：', error.message ?? String(error));
async function withIndicator(work, sender = null) {
  try { return await work; }
  finally {
    try {
      if (sender?.tab && sender.frameId === 0) await indicator.refreshTab(sender.tab.id);
      else if (!sender) await indicator.refreshAll();
    } catch (error) { report(error); }
  }
}
chrome.runtime.onInstalled.addListener(() => withIndicator(engine.startup()).catch(report));
chrome.runtime.onStartup.addListener(() => withIndicator(engine.startup()).catch(report));
chrome.permissions.onAdded.addListener(() => withIndicator(engine.permissionsChanged()).catch(report));
chrome.permissions.onRemoved.addListener(() => withIndicator(engine.permissionsChanged()).catch(report));
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'complete' && /^https?:/.test(tab.url ?? '')) {
    // Chrome 正在启动或扩展刚加载时，首个导航可能先于注册完成；自动补同步，不偷偷重载网页。
    engine.syncTab(tabId).catch(report).finally(() => indicator.refreshTab(tabId).catch(report));
  } else if (change.status || change.url) {
    indicator.refreshTab(tabId, { loading: change.status === 'loading' }).catch(report);
  }
});
chrome.tabs.onActivated.addListener(({ tabId }) => indicator.refreshTab(tabId).catch(report));
chrome.tabs.onRemoved.addListener(tabId => indicator.forget(tabId));
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  let work;
  if (message?.type === 'SYNC_DOCUMENT' && sender.tab && sender.documentId) {
    work = withIndicator(engine.syncDocument(sender), sender);
  } else {
    if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
    if (message?.type === 'GET_STATUS') work = engine.status();
    if (message?.type === 'SET_SETTINGS') work = withIndicator(engine.save(message.settings));
    if (message?.type === 'RECONCILE') work = withIndicator(engine.permissionsChanged());
    if (message?.type === 'REFRESH_BADGE' && Number.isInteger(message.tabId)) work = indicator.refreshTab(message.tabId);
  }
  if (!work) return false;
  work.then(data => respond({ ok: true, data }), error => respond({ ok: false, error: error.message }));
  return true;
});
// 后台可休眠。注册脚本和请求头规则持久化，图标表示最近一次网页核对，不表示后台进程常驻。
withIndicator(engine.startup()).catch(report);
