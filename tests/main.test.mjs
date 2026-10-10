import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const main = readFileSync(new URL('../extension/content/main.js', import.meta.url), 'utf8');
const preset = readFileSync(new URL('../extension/content/preset.js', import.meta.url), 'utf8');
function realm(before = '') {
  const ctx = vm.createContext({});
  vm.runInContext(`
    class Navigator {}
    const navigator = new Navigator(); globalThis.Navigator = Navigator; globalThis.navigator = navigator;
    const nativeLanguages = Object.freeze(['zh', 'en-US', 'zh-CN']);
    for (const key of ['language','languages']) Object.defineProperty(Navigator.prototype, key, {
      configurable:true, enumerable:true, get() {
        if(this !== navigator) throw new TypeError('Illegal invocation');
        return key === 'language' ? 'zh' : nativeLanguages;
      }
    });
    globalThis.native = Object.fromEntries(Object.getOwnPropertyNames(Intl).map(k=>[k,Intl[k]]));
    globalThis.beforeNavigator = Object.getOwnPropertyDescriptor(Navigator.prototype,'language');
    globalThis.savedPrototype = Intl.DateTimeFormat.prototype;
    globalThis.savedMethod = Intl.DateTimeFormat.supportedLocalesOf;
    ${before}
  `, ctx);
  vm.runInContext(main, ctx);
  const run = code => vm.runInContext(code, ctx);
  run(`globalThis.controller = globalThis[Symbol.for('chrome-locale-sg.controller.v1')];`);
  return { run, enable: () => vm.runInContext(preset, ctx), ctx };
}
const json = (r, code) => JSON.parse(r.run(`JSON.stringify(${code})`));
test('默认 Navigator 与 Intl，冻结语言数组、保持 getter brand check', () => {
  const r = realm(); r.enable();
  assert.equal(r.run('navigator.language'), 'zh-SG');
  assert.deepEqual(json(r, 'navigator.languages'), ['zh-SG','en-US']);
  assert.equal(r.run('Object.isFrozen(navigator.languages)'), true);
  assert.equal(r.run('navigator.languages === navigator.languages'), true);
  assert.equal(r.run('Intl.DateTimeFormat().resolvedOptions().locale'), 'zh-SG');
  assert.equal(r.run('new Intl.NumberFormat().resolvedOptions().locale'), 'zh-SG');
  assert.equal(r.run(`(()=>{try{Object.getOwnPropertyDescriptor(Navigator.prototype,'language').get.call({});return false}catch(e){return e instanceof TypeError}})()`), true);
});
test('显式 locale、列表和 Intl.Locale 原样透传', () => {
  const r = realm(); r.enable();
  for (const locale of [`'en-US'`, `'ja-JP'`, `['en-GB', 'ja-JP']`, `new Intl.Locale('fr-FR')`, `'zh-SG-u-nu-hanidec'`]) {
    for (const name of ['DateTimeFormat', 'NumberFormat']) {
      assert.equal(r.run(`JSON.stringify(new Intl.${name}(${locale}).resolvedOptions())`),
        r.run(`JSON.stringify(new native.${name}(${locale}).resolvedOptions())`));
    }
  }
});
test('静态方法、原型、name、length、子类及 instanceof 保持', () => {
  const r = realm(); r.enable();
  for (const expr of ['Intl.DateTimeFormat.prototype === savedPrototype',
    'Intl.DateTimeFormat.supportedLocalesOf === savedMethod',
    'Intl.DateTimeFormat.name === native.DateTimeFormat.name',
    'Intl.DateTimeFormat.length === native.DateTimeFormat.length',
    'new Intl.DateTimeFormat() instanceof Intl.DateTimeFormat',
    'new Intl.DateTimeFormat() instanceof native.DateTimeFormat',
    `(()=>{class D extends Intl.DateTimeFormat{}; const d=new D();return d instanceof D && d.resolvedOptions().locale==='zh-SG'})()`]) {
    assert.equal(r.run(expr), true, expr);
  }
});
test('原生 prototype.constructor 入口保留，不伪造无痕', () => {
  const r = realm(); r.enable();
  assert.equal(r.run('Intl.DateTimeFormat.prototype.constructor === native.DateTimeFormat'), true);
  assert.equal(r.run('Intl.DateTimeFormat.prototype.constructor === Intl.DateTimeFormat'), false);
});
test('只补省略和 undefined；[] 不强行读取或二次正规化', () => {
  const r = realm(); r.enable();
  assert.equal(r.run('new Intl.NumberFormat(undefined).resolvedOptions().locale'), 'zh-SG');
  assert.equal(r.run('new Intl.NumberFormat([]).resolvedOptions().locale'), r.run('new native.NumberFormat([]).resolvedOptions().locale'));
  const code = constructor => `(()=>{let count=0; const locales={get length(){count++; return 1},get 0(){count++;return 'en-US'}};new ${constructor}(locales);return count})()`;
  assert.equal(r.run(code('Intl.DateTimeFormat')), r.run(code('native.DateTimeFormat')));
});
test('原生异常类型、非 new 行为和方法非法 receiver 保持', () => {
  const r = realm(); r.enable();
  for (const name of ['DateTimeFormat', 'NumberFormat', 'Collator', 'PluralRules', 'RelativeTimeFormat', 'ListFormat', 'DisplayNames', 'Segmenter']) {
    for (const invocation of [`(null)`, `('not_a_locale')`, `('en-US',null)`]) {
      const result = constructor => r.run(`(()=>{try{new ${constructor}${invocation};return 'ok'}catch(e){return e.name}})()`);
      assert.equal(result(`Intl.${name}`), result(`native.${name}`), `${name}${invocation}`);
    }
    const call = constructor => r.run(`(()=>{try{${constructor}('en-US');return 'ok'}catch(e){return e.name}})()`);
    assert.equal(call(`Intl.${name}`), call(`native.${name}`));
  }
  assert.equal(r.run(`(()=>{try{Intl.NumberFormat.prototype.resolvedOptions.call({});return false}catch(e){return e.name==='TypeError'}})()`),true);
});
test('可选 Intl API 与 options 透传，不更改时区', () => {
  const r = realm(); r.enable();
  for (const name of ['Collator', 'PluralRules', 'RelativeTimeFormat', 'ListFormat', 'Segmenter']) {
    assert.equal(r.run(`new Intl.${name}().resolvedOptions().locale`), r.run(`new native.${name}('zh-SG').resolvedOptions().locale`));
  }
  assert.equal(r.run(`new Intl.DisplayNames(undefined,{type:'region'}).of('SG')`), r.run(`new native.DisplayNames('zh-SG',{type:'region'}).of('SG')`));
  assert.equal(r.run('new Intl.DateTimeFormat().resolvedOptions().timeZone'), r.run('controller.status().baseline.timeZone'));
  assert.equal(r.run(`new Intl.DateTimeFormat(undefined,{timeZone:'UTC'}).resolvedOptions().timeZone`), 'UTC');
});
test('禁用还原精确描述符，缓存包装器回到原生默认，已有实例不重算', () => {
  const r = realm(); r.enable();
  r.run('globalThis.cached = Intl.DateTimeFormat; globalThis.existing = new Intl.DateTimeFormat(); controller.configure({enabled:false})');
  assert.equal(r.run('navigator.language'), 'zh');
  assert.equal(r.run('Intl.DateTimeFormat === native.DateTimeFormat'), true);
  assert.equal(r.run('Object.getOwnPropertyDescriptor(Navigator.prototype,"language").get === beforeNavigator.get'), true);
  assert.equal(r.run('new cached().resolvedOptions().locale'), r.run('new native.DateTimeFormat().resolvedOptions().locale'));
  assert.equal(r.run('existing.resolvedOptions().locale'), 'zh-SG');
  r.enable(); assert.equal(r.run('navigator.language'),'zh-SG');
});
test('重复注入幂等，运行期语言更新没有多层包装', () => {
  const r = realm(); r.enable(); r.run('globalThis.first = Intl.DateTimeFormat');
  vm.runInContext(main,r.ctx); r.enable();
  assert.equal(r.run('first === Intl.DateTimeFormat'),true);
  r.run(`controller.configure({enabled:true,primary:'ja-JP',fallbacks:['en-US']})`);
  assert.equal(r.run('new Intl.DateTimeFormat().resolvedOptions().locale'),'ja-JP');
  assert.deepEqual(json(r,'navigator.languages'),['ja-JP','en-US']);
});
test('不破坏不可配置属性和网页自有属性', () => {
  const r = realm(`Object.defineProperty(Navigator.prototype,'language',{configurable:false}); Object.defineProperty(navigator,'languages',{value:['custom'],configurable:true});`);
  r.enable();
  assert.equal(r.run('navigator.language'),'zh');
  assert.deepEqual(json(r,'navigator.languages'),['custom']);
  assert.equal(r.run('controller.status().warnings.length'),2);
});
test('第三方在注入后更换接口，关闭不覆盖第三方', () => {
  const r = realm(); r.enable();
  r.run(`globalThis.thirdParty = function ThirdParty(){}; Intl.DateTimeFormat=thirdParty;controller.configure({enabled:false})`);
  assert.equal(r.run('Intl.DateTimeFormat === thirdParty'),true);
  assert.equal(r.run('controller.status().warnings.length > 0'),true);
});
test('同一配置重复同步不更换 navigator.languages 数组身份', () => {
  const r=realm();r.enable();r.run('globalThis.oldLanguages=navigator.languages');r.enable();
  assert.equal(r.run('oldLanguages===navigator.languages'),true);
});
