import { effectiveMatches, parsePattern, languageHeader } from './settings.js';

// 本扩展仅管理自己的两个动态规则；不启用静态规则，避免总开关失效。
export const RULE_IDS = [6101, 6102];
export function makeRules(settings, origins) {
  const matches = effectiveMatches(settings, origins);
  if (!settings.enabled || !matches.length) return [];
  const hosts = [...new Set(matches.map(p => parsePattern(p).host))];
  const domains = hosts.includes('*') ? {} : { requestDomains: hosts };
  const initiators = hosts.includes('*') ? {} : { initiatorDomains: hosts };
  const action = {
    type: 'modifyHeaders',
    requestHeaders: [{ header: 'Accept-Language', operation: 'set', value: languageHeader(settings) }],
  };
  const excludedRequests = settings.exclude.length ? { excludedRequestDomains: settings.exclude } : {};
  const excludedInitiators = settings.exclude.length ? { excludedInitiatorDomains: settings.exclude } : {};
  return [
    { id: RULE_IDS[0], priority: 1, action,
      condition: { regexFilter: '^https?://', resourceTypes: ['main_frame', 'sub_frame'],
        ...domains, ...excludedRequests } },
    { id: RULE_IDS[1], priority: 1, action,
      condition: { regexFilter: '^https?://', excludedResourceTypes: ['main_frame', 'sub_frame'],
        ...initiators, ...excludedRequests, ...excludedInitiators } },
  ];
}
