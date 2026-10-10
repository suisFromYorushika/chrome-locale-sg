import { normalizeSettings, domainName, domainPattern, isPreset, shouldApply } from '../lib/settings.js';
const $ = id => document.getElementById(id);
let tab = null, snapshot = null, saved = null, busy = false;
const notify = (text, kind = '') => { $('notice').textContent = text; $('notice').className = kind; };
async function request(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...extra });
  if (!response?.ok) throw new Error(response?.error ?? '后台未响应，请在扩展管理页重新加载。');
  return response.data;
}
function fill(settings) {
  saved = settings;
  $('enabled').checked = settings.enabled;
  $('enabled-label').textContent = settings.enabled ? '启用' : '禁用';
  $('primary').value = settings.primary;
  $('fallbacks').value = settings.fallbacks.join(', ');
  $('include').value = settings.include.join('\n');
  $('exclude').value = settings.exclude.join('\n');
  $('timing').textContent = isPreset(settings) ? '默认组合：文档开始时同步注入。' :
    '自定义组合：配置异步下发，网页最早的脚本可能先读到原始值。';
}
const lines = id => $(id).value.split(/[,，\n]/).map(s => s.trim()).filter(Boolean);
function form() {
  return normalizeSettings({ enabled: $('enabled').checked, primary: $('primary').value,
    fallbacks: lines('fallbacks'), include: lines('include'), exclude: lines('exclude') });
}
async function load() {
  snapshot = await request('GET_STATUS');
  fill(snapshot.settings);
  $('permissions-summary').textContent = snapshot.grantedOrigins.includes('http://*/*') && snapshot.grantedOrigins.includes('https://*/*') ? '· 全站访问' : `· ${snapshot.grantedOrigins.length} 项授权`;
  const st = snapshot.applyStatus;
  if (st?.state === 'error') notify(`同步失败：${st.error}`, 'error');
  else if (!snapshot.settings.enabled) notify('已禁用；请求头规则已移除，已加载页面建议刷新。');
  else if (!snapshot.scripts.length) notify('网站访问被限制或范围无匹配：请检查 Chrome 授权及启用网站列表。', 'warn');
  else notify('脚本和请求头规则已同步；页面实际值请看下方。');
  $('v-header').textContent = snapshot.rules.length ? `${snapshot.rules.length} 条已注册（不是实测请求头）` : '无规则';
}
async function probe() {
  if (!tab?.id) return;
  for (const id of ['v-language', 'v-languages', 'v-date', 'v-number', 'v-zone']) $(id).textContent = '—';
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, world: 'MAIN',
      func: () => ({ language: navigator.language, languages: Array.from(navigator.languages),
        date: new Intl.DateTimeFormat().resolvedOptions().locale,
        number: new Intl.NumberFormat().resolvedOptions().locale,
        zone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
        controller: globalThis[Symbol.for('chrome-locale-sg.controller.v1')]?.status() ?? null }) });
    const v = results[0]?.result;
    if (!v) throw new Error('页面尚未就绪。');
    $('v-language').textContent = v.language;
    $('v-languages').textContent = JSON.stringify(v.languages);
    $('v-date').textContent = v.date;
    $('v-number').textContent = v.number;
    $('v-zone').textContent = v.zone;
    const warnings = [...(v.controller?.warnings ?? [])];
    if (snapshot && shouldApply(saved, snapshot.grantedOrigins, tab.url)) {
      if (v.language !== saved.primary || JSON.stringify(v.languages) !== JSON.stringify([saved.primary, ...saved.fallbacks]) ||
          v.date !== saved.primary || v.number !== saved.primary) {
        warnings.push('实测值与目标不完全一致：请刷新，检查网站授权、Intl 支持和其他语言扩展。');
      }
    }
    $('diagnostics').textContent = warnings.join(' ') || '图标代表最近一次顶层网页核对，不要求后台常驻；请求头实测见本地验收页。';
    await request('REFRESH_BADGE', { tabId: tab.id });
  } catch (error) {
    $('diagnostics').textContent = `无法读取此页面：${error.message}。Chrome 内部页、商店及其他受限页面不支持。`;
  }
}
async function saveSettings(settings) {
  if (busy) return;
  busy = true; $('save').disabled = true; $('enabled').disabled = true;
  try {
    const result = await request('SET_SETTINGS', { settings });
    await load(); await probe();
    notify(`已保存并同步${result.live.failed ? `；${result.live.failed} 个标签页未能立即注入` : ''}。请刷新页面清除旧对象。`, result.live.failed ? 'warn' : '');
  } catch (error) { if (saved) fill(saved); notify(error.message, 'error'); }
  finally { busy = false; $('save').disabled = false; $('enabled').disabled = false; }
}
$('settings-form').addEventListener('submit', event => {
  event.preventDefault();
  try { saveSettings(form()); } catch (error) { notify(error.message, 'error'); }
});
$('enabled').addEventListener('change', () => {
  // 总开关只修改已保存设置，不偷偷保存用户尚未提交的其他编辑。
  if (saved) saveSettings({ ...saved, enabled: $('enabled').checked });
});
async function grant(origins) {
  try {
    // 必须在按钮的 user gesture 中直接调用；此前不 await。
    const accepted = await chrome.permissions.request({ origins });
    if (!accepted) { notify('未授予权限，原有授权保持不变。', 'warn'); return; }
    await request('RECONCILE'); await load(); await probe();
    notify('授权已同步，刷新网页后使用完整的新语言环境。');
  } catch (error) { notify(error.message, 'error'); }
}
$('grant-current').addEventListener('click', () => {
  try {
    const url = new URL(tab?.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('此页面不能授权，请打开普通 HTTP / HTTPS 网页。');
    grant([domainPattern(domainName(url.hostname))]);
  } catch (error) { notify(error.message, 'error'); }
});
$('grant-list').addEventListener('click', () => {
  try {
    const domains = lines('include').map(domainName);
    if (!domains.length) throw new Error('请先填写启用网站；如需全站授权，使用下方专门按钮。');
    grant([...new Set(domains.map(domainPattern))]);
  } catch (error) { notify(error.message, 'error'); }
});
$('grant-all').addEventListener('click', () => grant(['http://*/*', 'https://*/*']));
$('probe').addEventListener('click', () => probe());
$('refresh').addEventListener('click', async () => {
  try {
    if (!tab?.id || !/^https?:/.test(tab.url ?? '')) throw new Error('请先打开普通网页。');
    await chrome.tabs.reload(tab.id);
    notify('已请求刷新；加载完成后点“重新检测”。');
  } catch (error) { notify(error.message, 'error'); }
});
(async () => {
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    $('page').textContent = tab?.url ?? '未取得网页地址';
    await load(); await probe();
  } catch (error) { notify(error.message, 'error'); }
})();
