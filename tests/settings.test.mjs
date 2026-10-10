import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeSettings, domainName, shouldApply, effectiveMatches,
  scriptRegistrations, languageHeader, isPreset } from '../extension/lib/settings.js';
import { makeRules } from '../extension/lib/rules.js';
const all = ['http://*/*', 'https://*/*'];
const settings = extra => normalizeSettings({ ...DEFAULTS, ...extra });

test('默认语言、请求头和持久化 document_start MAIN 注册一致', () => {
  const s = settings({});
  assert.equal(languageHeader(s), 'zh-SG,en-US;q=0.9');
  const scripts = scriptRegistrations(s, all);
  assert.equal(scripts.length, 2);
  assert.equal(scripts[0].world, 'MAIN');
  assert.deepEqual(scripts[0].js, ['content/main.js', 'content/preset.js']);
  for (const r of scripts) {
    assert.equal(r.runAt, 'document_start'); assert.equal(r.allFrames, true);
    assert.equal(r.persistAcrossSessions, true); assert.equal(r.matchOriginAsFallback, true);
  }
});
test('可编辑语言正规化、去重，并保留顺序', () => {
  const s = settings({ primary: 'ZH-sg', fallbacks: ['zh-cn', 'zh-SG', 'en-us', 'zh-CN'] });
  assert.deepEqual(s.fallbacks, ['zh-CN', 'en-US']); assert.equal(isPreset(s), false);
});
test('非法、过多和完全不支持的语言不入库', () => {
  for (const primary of ['', 'en_US', 'xx-YY', 'en\r\nx-hack:yes']) {
    assert.throws(() => settings({ primary }));
  }
  assert.throws(() => settings({ fallbacks: Array(9).fill('en-US') }));
});
test('自定义语言不错误预注入出厂配置', () => {
  const s = settings({ primary: 'ja-JP' });
  assert.equal(isPreset(s), false);
  assert.deepEqual(scriptRegistrations(s, all)[0].js, ['content/main.js']);
});
test('禁用或未授权时没有脚本和请求头规则', () => {
  assert.deepEqual(scriptRegistrations(settings({ enabled: false }), all), []);
  assert.deepEqual(makeRules(settings({ enabled: false }), all), []);
  assert.deepEqual(makeRules(DEFAULTS, []), []);
  assert.deepEqual(scriptRegistrations(DEFAULTS, []), []);
});
test('域名支持国际化、子域名，不接受路径端口和头注入', () => {
  assert.equal(domainName('HTTPS://例子.测试/'), 'xn--fsqu00a.xn--0zwm56d');
  assert.equal(domainName('*.example.com'), 'example.com');
  for (const domain of ['https://example.com/a', 'foo:9999', 'https://a.com?x=1', '*', 'a..com', '-bad.com']) {
    assert.throws(() => domainName(domain));
  }
});
test('域名后缀边界、include/exclude 和授权相交', () => {
  const s = settings({ include: ['example.com'], exclude: ['private.example.com'] });
  for (const url of ['https://example.com/', 'http://x.example.com/a']) assert.equal(shouldApply(s, all, url), true);
  for (const url of ['https://evil-example.com', 'https://private.example.com', 'https://x.private.example.com', 'chrome://newtab']) {
    assert.equal(shouldApply(s, all, url), false);
  }
  assert.equal(shouldApply(s, ['https://other.com/*'], 'https://example.com'), false);
  assert.deepEqual(effectiveMatches(s, ['https://*/*']), ['https://*.example.com/*']);
  assert.deepEqual(effectiveMatches(s, ['https://*.sub.example.com/*']), ['https://*.sub.example.com/*']);
});
test('DNR 文档按目的域名，资源按发起域名；排除不误改其他网站', () => {
  const s = settings({ include: ['example.com'], exclude: ['skip.example.com'] });
  const [documents, resources] = makeRules(s, all);
  assert.deepEqual(documents.condition.requestDomains, ['example.com']);
  assert.deepEqual(resources.condition.initiatorDomains, ['example.com']);
  assert.deepEqual(resources.condition.excludedInitiatorDomains, ['skip.example.com']);
  assert.deepEqual(resources.condition.excludedRequestDomains, ['skip.example.com']);
  for (const r of [documents, resources]) {
    assert.equal(r.action.type, 'modifyHeaders');
    assert.deepEqual(r.action.requestHeaders, [{ header: 'Accept-Language', operation: 'set', value: languageHeader(s) }]);
  }
});
test('0.2 默认仅两个语言，全站无白名单且启用', () => {
  assert.deepEqual(DEFAULTS.fallbacks, ['en-US']);
  assert.equal(DEFAULTS.enabled, true);
  assert.deepEqual(DEFAULTS.include, []);
  assert.deepEqual(DEFAULTS.exclude, []);
  assert.equal(isPreset(DEFAULTS), true);
});
