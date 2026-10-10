import { settingsFromStorage, shouldApply, patternMatches, domainMatches } from './settings.js';

export const INDICATORS = Object.freeze({
  active: { icon: 'active', text: '开', color: '#147A51', title: '此页已生效：语言与 Intl 已核对，请求头规则已注册' },
  off: { icon: 'idle', text: '关', color: '#69777B', title: '总开关已关闭' },
  excluded: { icon: 'idle', text: '—', color: '#69777B', title: '此网站不在启用范围内' },
  restricted: { icon: 'idle', text: '—', color: '#69777B', title: '此页受限或未提供地址；普通网站仍自动生效' },
  permission: { icon: 'pending', text: '权', color: '#A36A0B', title: '当前网站访问权被限制，请在 Chrome 中恢复授权' },
  pending: { icon: 'pending', text: '…', color: '#A36A0B', title: '等待此页注入或检测；可刷新网页' },
  mismatch: { icon: 'error', text: '!', color: '#B83838', title: '此页检测值不一致；请检查冲突或刷新' },
  error: { icon: 'error', text: '!', color: '#B83838', title: '扩展同步出错，请打开面板查看' },
});

export function indicatorState(settings, origins, address, applyStatus, actual) {
  if (applyStatus?.state === 'error') return 'error';
  if (applyStatus?.state === 'applying') return 'pending';
  if (!settings.enabled) return 'off';
  let url;
  try { url = new URL(address); } catch { return 'restricted'; }
  if (!['http:', 'https:'].includes(url.protocol)) return 'restricted';
  if (settings.exclude.some(d => domainMatches(url.hostname, d)) ||
      (settings.include.length && !settings.include.some(d => domainMatches(url.hostname, d)))) return 'excluded';
  if (!origins.some(p => patternMatches(p, address))) return 'permission';
  if (!actual || !applyStatus || applyStatus.state !== 'applied') return 'pending';
  if (actual.href !== address || !actual.controller?.enabled) return 'pending';
  if (actual.language !== settings.primary ||
      JSON.stringify(actual.languages) !== JSON.stringify([settings.primary, ...settings.fallbacks]) ||
      actual.date !== settings.primary || actual.number !== settings.primary || actual.controller.warnings.length ||
      applyStatus.ruleCount !== 2 || applyStatus.registrationCount !== 2) return 'mismatch';
  return 'active';
}

export function createIndicator(api) {
  const revisions = new Map();
  const writes = new Map();
  async function paint(tabId, state, revision) {
    // 同一标签的异步 paint 串行执行；过时读取不能把已关闭/新导航的状态涂绿。
    const prior = writes.get(tabId) ?? Promise.resolve();
    const task = prior.catch(() => {}).then(async () => {
      if (revision !== revisions.get(tabId)) return;
      const value = INDICATORS[state], target = tabId === undefined ? {} : { tabId };
      await Promise.all([
        api.action.setIcon({ ...target, path: { 16: `icons/${value.icon}-16.png`, 32: `icons/${value.icon}-32.png` } }),
        api.action.setBadgeText({ ...target, text: value.text }),
        api.action.setBadgeBackgroundColor({ ...target, color: value.color }),
        api.action.setBadgeTextColor({ ...target, color: '#FFFFFF' }),
        api.action.setTitle({ ...target, title: `Chrome Locale SG · ${value.title}` }),
      ]);
    });
    writes.set(tabId, task);
    try { await task; } finally { if (writes.get(tabId) === task) writes.delete(tabId); }
  }
  async function refreshTab(tabId, { loading = false } = {}) {
    const revision = (revisions.get(tabId) ?? 0) + 1; revisions.set(tabId, revision);
    try {
      const [tab, data, permissions] = await Promise.all([api.tabs.get(tabId),
        api.storage.local.get(['settings','settingsSchema','applyStatus']),api.permissions.getAll()]);
      const settings = settingsFromStorage(data), origins = permissions.origins ?? [];
      let actual = null;
      const preliminary = indicatorState(settings, origins, tab.url, data.applyStatus, null);
      if (!loading && !tab.discarded && preliminary === 'pending' && shouldApply(settings, origins, tab.url)) {
        try {
          const output = await api.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'MAIN',
            func: () => ({ href: location.href, language: navigator.language, languages: [...navigator.languages],
              date: new Intl.DateTimeFormat().resolvedOptions().locale,
              number: new Intl.NumberFormat().resolvedOptions().locale,
              controller: globalThis[Symbol.for('chrome-locale-sg.controller.v1')]?.status() ?? null }) });
          actual = output[0]?.result ?? null;
        } catch { /* 导航中或浏览器保护页保持待检测，不宣称运行成功。 */ }
      }
      const state = indicatorState(settings, origins, tab.url, data.applyStatus, actual);
      await paint(tabId, state, revision);
      return state;
    } catch {
      try { await paint(tabId, 'error', revision); } catch { /* 标签已关闭。 */ }
      return 'error';
    }
  }
  async function refreshAll() {
    const revision = (revisions.get(undefined) ?? 0) + 1; revisions.set(undefined, revision);
    const data = await api.storage.local.get(['settings','settingsSchema','applyStatus']);
    const settings = settingsFromStorage(data);
    await paint(undefined, data.applyStatus?.state === 'error' ? 'error' : settings.enabled ? 'pending' : 'off', revision);
    const tabs = await api.tabs.query({});
    await Promise.all(tabs.filter(t => t.id !== undefined).map(t => refreshTab(t.id)));
  }
  return { refreshTab, refreshAll, forget: tabId => { revisions.delete(tabId); writes.delete(tabId); } };
}
