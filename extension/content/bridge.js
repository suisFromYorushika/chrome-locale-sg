// ISOLATED 世界：页面不能发特权设置消息，只有本脚本通知后台同步当前 documentId。
(() => {
  const key = '__chromeLocaleSGBridgeV1';
  if (globalThis[key]) return;
  globalThis[key] = true;
  const sync = () => chrome.runtime.sendMessage({ type: 'SYNC_DOCUMENT' }).catch(() => {});
  sync();
  addEventListener('pageshow', event => { if (event.persisted) sync(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) sync();
  });
})();
