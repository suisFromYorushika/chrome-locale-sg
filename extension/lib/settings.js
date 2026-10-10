export const DEFAULTS = Object.freeze({
  enabled: true,
  primary: 'zh-SG',
  fallbacks: Object.freeze(['en-US']),
  include: Object.freeze([]),
  exclude: Object.freeze([]),
});
export const SETTINGS_KEY = 'settings';
export const SETTINGS_SCHEMA = 2;

// 仅迁移 0.1.x 的默认语言组合；保留总开关、范围和用户自定义语言。
export function settingsFromStorage(data) {
  const value = data.settings ?? DEFAULTS;
  if ((data.settingsSchema ?? 1) < SETTINGS_SCHEMA && value.primary === 'zh-SG' &&
      JSON.stringify(value.fallbacks) === JSON.stringify(['zh-CN', 'en-US'])) {
    return normalizeSettings({ ...value, fallbacks: ['en-US'] });
  }
  return normalizeSettings(value);
}
export const MAIN_ID = 'locale-sg-main';
export const BRIDGE_ID = 'locale-sg-bridge';

export function canonicalLocale(value) {
  if (typeof value !== 'string' || value.length > 100 || !value.trim()) {
    throw new Error('语言必须是非空 BCP 47 标签，例如 zh-SG。');
  }
  try { return Intl.getCanonicalLocales(value.trim())[0]; }
  catch { throw new Error(`无效的语言标签：${value}`); }
}

export function domainName(value) {
  if (typeof value !== 'string') throw new Error('网站必须填写域名。');
  let input = value.trim().toLowerCase().replace(/^\*\./, '');
  if (!input || input.length > 255) throw new Error('域名为空或过长。');
  if (!input.includes('://')) input = `https://${input}`;
  let url;
  try { url = new URL(input); } catch { throw new Error(`无效域名：${value}`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.port || url.search || url.hash || url.pathname !== '/' ||
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(url.hostname) ||
      url.hostname.split('.').some(x => !x || x.startsWith('-') || x.endsWith('-'))) {
    throw new Error(`只接受域名，不要端口、路径或通配符：${value}`);
  }
  return url.hostname;
}

export function normalizeSettings(input) {
  if (!input || typeof input !== 'object' || typeof input.enabled !== 'boolean') {
    throw new Error('设置格式不正确。');
  }
  const primary = canonicalLocale(input.primary);
  if (!Array.isArray(input.fallbacks) || input.fallbacks.length > 8) {
    throw new Error('最多填写 8 个后备语言。');
  }
  const fallbacks = [...new Set(input.fallbacks.map(canonicalLocale))].filter(x => x !== primary);
  const list = value => {
    if (!Array.isArray(value) || value.length > 50) throw new Error('每个网站列表最多 50 项。');
    return [...new Set(value.map(domainName))].sort();
  };
  // 防止“合法但完全不支持”的标签让 navigator 与 Intl 不一致。
  for (const name of ['DateTimeFormat', 'NumberFormat']) {
    if (!Intl[name].supportedLocalesOf([primary], { localeMatcher: 'lookup' }).length) {
      throw new Error(`本 Chrome 的 Intl.${name} 不支持 ${primary}。`);
    }
  }
  return { enabled: input.enabled, primary, fallbacks,
    include: list(input.include), exclude: list(input.exclude) };
}

export function isPreset(settings) {
  return settings.primary === DEFAULTS.primary &&
    JSON.stringify(settings.fallbacks) === JSON.stringify(DEFAULTS.fallbacks);
}
export function languageHeader(settings) {
  return [settings.primary, ...settings.fallbacks]
    .map((locale, i) => i === 0 ? locale : `${locale};q=${(1 - i / 10).toFixed(1)}`).join(',');
}
export function domainMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}
export function domainPattern(domain) {
  return /^(?:\d+\.){3}\d+$/.test(domain) || domain === 'localhost'
    ? `*://${domain}/*` : `*://*.${domain}/*`;
}
export function parsePattern(pattern) {
  const match = /^(\*|https?|file):\/\/([^/]+)\/\*$/.exec(pattern);
  if (!match || !['*', 'http', 'https'].includes(match[1])) return null;
  const host = match[2];
  return { scheme: match[1], host: host.replace(/^\*\./, ''), sub: host.startsWith('*.') };
}
export function patternMatches(pattern, address) {
  try {
    const p = parsePattern(pattern), url = new URL(address);
    if (!p || !['http:', 'https:'].includes(url.protocol)) return false;
    return (p.scheme === '*' || `${p.scheme}:` === url.protocol) &&
      (p.host === '*' || (p.sub ? domainMatches(url.hostname, p.host) : url.hostname === p.host));
  } catch { return false; }
}
export function effectiveMatches(settings, origins) {
  const result = [];
  for (const origin of origins) {
    const p = parsePattern(origin);
    if (!p) continue;
    if (!settings.include.length) { result.push(origin); continue; }
    for (const domain of settings.include) {
      if (p.host === '*' || (p.sub && domainMatches(domain, p.host))) {
        result.push(domainPattern(domain).replace('*:', `${p.scheme}:`));
      } else if (domainMatches(p.host, domain)) result.push(origin);
    }
  }
  return [...new Set(result)].sort();
}
export function shouldApply(settings, origins, address) {
  try {
    return settings.enabled &&
      effectiveMatches(settings, origins).some(p => patternMatches(p, address)) &&
      !settings.exclude.some(d => domainMatches(new URL(address).hostname, d));
  } catch { return false; }
}
export function scriptRegistrations(settings, origins) {
  const matches = effectiveMatches(settings, origins);
  if (!settings.enabled || !matches.length) return [];
  const common = {
    matches, excludeMatches: settings.exclude.map(domainPattern),
    runAt: 'document_start', allFrames: true, matchOriginAsFallback: true,
    persistAcrossSessions: true,
  };
  return [
    { ...common, id: MAIN_ID, world: 'MAIN',
      js: ['content/main.js', ...(isPreset(settings) ? ['content/preset.js'] : [])] },
    { ...common, id: BRIDGE_ID, world: 'ISOLATED', js: ['content/bridge.js'] },
  ];
}
