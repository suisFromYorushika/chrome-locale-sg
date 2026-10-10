import { DEFAULTS, normalizeSettings, scriptRegistrations, shouldApply, isPreset,
  languageHeader, MAIN_ID, BRIDGE_ID, settingsFromStorage, SETTINGS_SCHEMA } from './settings.js';
import { makeRules, RULE_IDS } from './rules.js';

// 单队列把保存、授权变更、启动恢复串行化，避免快速开关造成两个 API 状态交叉。
export function createEngine(api) {
  let tail = Promise.resolve();
  const serial = task => {
    const result = tail.then(task, task);
    tail = result.catch(() => {});
    return result;
  };
  async function read() {
    const data = await api.storage.local.get(['settings', 'applyStatus', 'settingsSchema']);
    return { settings: settingsFromStorage(data), applyStatus: data.applyStatus ?? null };
  }
  const origins = async () => (await api.permissions.getAll()).origins ?? [];
  async function install(settings, granted) {
    const rules = makeRules(settings, granted);
    await api.declarativeNetRequest.updateDynamicRules({ removeRuleIds: RULE_IDS, addRules: rules });
    const desired = scriptRegistrations(settings, granted);
    const current = (await api.scripting.getRegisteredContentScripts())
      .filter(s => [MAIN_ID, BRIDGE_ID].includes(s.id));
    const remove = current.filter(s => !desired.some(d => d.id === s.id)).map(s => s.id);
    if (remove.length) await api.scripting.unregisterContentScripts({ ids: remove });
    const add = desired.filter(s => !current.some(c => c.id === s.id));
    const update = desired.filter(s => current.some(c => c.id === s.id));
    if (update.length) await api.scripting.updateContentScripts(update);
    if (add.length) await api.scripting.registerContentScripts(add);
    return { state: 'applied', mode: isPreset(settings) ? 'preset' : 'async-custom',
      ruleCount: rules.length, registrationCount: desired.length, checkedAt: Date.now(),
      header: settings.enabled && rules.length ? languageHeader(settings) : null };
  }

  // 此函数会被序列化进入 MAIN，不引用模块闭包。
  function applyInPage(settings, permitted) {
    const controller = globalThis[Symbol.for('chrome-locale-sg.controller.v1')];
    let address = location.href;
    if (!/^https?:/.test(address)) {
      // 对继承源的 about:blank/srcdoc 尽力处理；不追溯或绕过不透明 sandbox。
      try { if (/^https?:/.test(globalThis.origin)) address = `${globalThis.origin}/`; } catch {}
    }
    let enabled = false;
    try {
      const url = new URL(address);
      const domainMatch = d => url.hostname === d || url.hostname.endsWith(`.${d}`);
      const allowed = permitted.some(pattern => {
        const m = /^(\*|https?):\/\/([^/]+)\/\*$/.exec(pattern);
        if (!m || !['http:', 'https:'].includes(url.protocol)) return false;
        return (m[1] === '*' || `${m[1]}:` === url.protocol) && (m[2] === '*' ||
          (m[2].startsWith('*.') ? domainMatch(m[2].slice(2)) : url.hostname === m[2]));
      });
      enabled = settings.enabled && allowed &&
        (!settings.include.length || settings.include.some(domainMatch)) && !settings.exclude.some(domainMatch);
    } catch {}
    return controller?.configure({ ...settings, enabled }, 'async/live') ?? null;
  }
  async function syncTarget(target, settings, granted, installCore = true) {
    if (installCore && settings.enabled) {
      await api.scripting.executeScript({ target, world: 'MAIN', files: ['content/main.js'] });
    }
    return api.scripting.executeScript({ target, world: 'MAIN', func: applyInPage, args: [settings, granted] });
  }
  async function publish(settings, granted) {
    const tabs = await api.tabs.query({});
    let synced = 0, failed = 0;
    await Promise.all(tabs.filter(t => t.id !== undefined && t.url &&
      /^https?:/.test(t.url)).map(async tab => {
      try {
        await syncTarget({ tabId: tab.id, allFrames: true }, settings, granted);
        if (settings.enabled) await api.scripting.executeScript({ target: { tabId: tab.id, allFrames: true },
          world: 'ISOLATED', files: ['content/bridge.js'] });
        synced++;
      } catch { failed++; }
    }));
    return { synced, failed, refreshRequired: true };
  }
  async function reconcile() {
    const { settings } = await read(), granted = await origins();
    try {
      const state = await install(settings, granted);
      await api.storage.local.set({ settings, settingsSchema: SETTINGS_SCHEMA, applyStatus: state });
      return state;
    } catch (error) {
      await api.storage.local.set({ applyStatus: { state: 'error', error: String(error.message ?? error) } });
      throw error;
    }
  }
  return {
    startup: () => serial(async () => {
      const state = await reconcile();
      const { settings } = await read();
      // 启动/更新时已经存在的网页也主动同步；不强制刷新，以免丢失表单内容。
      const live = await publish(settings, await origins());
      await api.storage.local.set({ applyStatus: { ...state, live } });
      return { ...state, live };
    }),
    syncTab: tabId => serial(async () => {
      const tab = await api.tabs.get(tabId);
      if (!/^https?:/.test(tab.url ?? '') || tab.discarded) return null;
      const { settings } = await read(), granted = await origins();
      await syncTarget({ tabId, allFrames: true }, settings, granted);
      if (settings.enabled) await api.scripting.executeScript({ target: { tabId, allFrames: true },
        world: 'ISOLATED', files: ['content/bridge.js'] });
      return { synchronized: true };
    }),
    status: () => serial(async () => {
      const saved = await read();
      const [grantedOrigins, rules, scripts] = await Promise.all([origins(),
        api.declarativeNetRequest.getDynamicRules(), api.scripting.getRegisteredContentScripts()]);
      return { ...saved, grantedOrigins, rules, scripts };
    }),
    save: input => serial(async () => {
      const settings = normalizeSettings(input), previous = (await read()).settings;
      const granted = await origins();
      // desired 先落盘：后台被系统中止时，下一次启动按此设置恢复，不假装跨 API 原子事务。
      try {
        await api.storage.local.set({ settings, settingsSchema: SETTINGS_SCHEMA, applyStatus: { state: 'applying' } });
        const state = await install(settings, granted);
        const live = await publish(settings, granted);
        await api.storage.local.set({ applyStatus: { ...state, live } });
        return { settings, ...state, live };
      } catch (error) {
        let rollbackError = null;
        try {
          await api.storage.local.set({ settings: previous, settingsSchema: SETTINGS_SCHEMA });
          const state = await install(previous, granted);
          await publish(previous, granted);
          await api.storage.local.set({ applyStatus: { ...state, rolledBack: true } });
        } catch (rollback) {
          rollbackError = String(rollback.message ?? rollback);
          await api.storage.local.set({ applyStatus: { state: 'error', error: rollbackError } }).catch(() => {});
        }
        throw new Error(`保存失败：${error.message ?? error}。${rollbackError ?
          `回滚也失败：${rollbackError}。请禁用扩展后重新加载。` : '已回滚到上一次设置。'}`);
      }
    }),
    permissionsChanged: () => serial(async () => {
      const state = await reconcile();
      const { settings } = await read();
      await publish(settings, await origins());
      return state;
    }),
    syncDocument: sender => serial(async () => {
      if (sender.tab?.id === undefined || !sender.documentId) throw new Error('缺少文档身份。');
      const { settings } = await read(), granted = await origins();
      let address = sender.url ?? '';
      if (!/^https?:/.test(address) && /^https?:/.test(sender.origin ?? '')) address = `${sender.origin}/`;
      const enabled = shouldApply(settings, granted, address);
      return syncTarget({ tabId: sender.tab.id, documentIds: [sender.documentId] },
        { ...settings, enabled }, granted, enabled);
    }),
  };
}
