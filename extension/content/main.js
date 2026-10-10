/* MAIN 世界：不读取 Chrome 扩展 API，不使用 DOM 脚本节点、eval 或远程代码。 */
(() => {
  'use strict';
  const KEY = Symbol.for('chrome-locale-sg.controller.v1');
  if (Object.prototype.hasOwnProperty.call(globalThis, KEY)) return;
  const getDesc = Object.getOwnPropertyDescriptor;
  const define = Object.defineProperty;
  const apply = Reflect.apply;
  const construct = Reflect.construct;
  const ProxyConstructor = Proxy;
  const warnings = new Set();
  const patches = [];
  let config = null;
  let started = null;
  const originalIntl = globalThis.Intl;
  const nativeDateTimeFormat = originalIntl?.DateTimeFormat;
  const nativeNumberFormat = originalIntl?.NumberFormat;
  const baseline = {
    language: navigator.language,
    languages: Array.from(navigator.languages),
    dateLocale: new nativeDateTimeFormat().resolvedOptions().locale,
    numberLocale: new nativeNumberFormat().resolvedOptions().locale,
    timeZone: new nativeDateTimeFormat().resolvedOptions().timeZone,
  };
  const same = (a, b) => Boolean(a && b && a.value === b.value && a.get === b.get &&
    a.set === b.set && a.writable === b.writable && a.enumerable === b.enumerable &&
    a.configurable === b.configurable);

  function addPatch(object, key, replacement) {
    const original = getDesc(object, key);
    patches.push({ object, key, original, replacement, installed: false });
  }
  const navigatorPrototype = globalThis.Navigator?.prototype;
  for (const property of ['language', 'languages']) {
    const descriptor = navigatorPrototype && getDesc(navigatorPrototype, property);
    if (!descriptor?.configurable || typeof descriptor.get !== 'function' ||
        Object.prototype.hasOwnProperty.call(navigator, property)) {
      warnings.add(`navigator.${property} 不是可安全替换的原型 getter，已跳过。`);
      continue;
    }
    const getter = new ProxyConstructor(descriptor.get, {
      apply(target, receiver, args) {
        // 先验证原生 receiver，不能把非法调用悄悄变成成功。
        const native = apply(target, receiver, args);
        if (!config || receiver !== navigator) return native;
        return property === 'language' ? config.primary : config.languages;
      },
    });
    addPatch(navigatorPrototype, property, { ...descriptor, get: getter });
  }

  const names = ['DateTimeFormat', 'NumberFormat', 'Collator', 'PluralRules',
    'RelativeTimeFormat', 'ListFormat', 'DisplayNames', 'Segmenter', 'DurationFormat'];
  function localeArguments(args) {
    // 不枚举、读取或正规化显式 locale：保留 getter/Proxy 的副作用顺序和原生异常。
    // []、任意对象、Intl.Locale 和所有显式标签原样透传。
    if (!config || (args.length && args[0] !== undefined)) return args;
    const copy = Array.from(args);
    copy[0] = config.primary;
    return copy;
  }
  for (const name of names) {
    const descriptor = getDesc(originalIntl, name);
    if (!descriptor) continue; // 老版本没有 DurationFormat 等接口时不创建假接口。
    if (!descriptor.configurable || typeof descriptor.value !== 'function') {
      warnings.add(`Intl.${name} 不可安全替换，已跳过。`);
      continue;
    }
    const wrapper = new ProxyConstructor(descriptor.value, {
      apply(target, receiver, args) { return apply(target, receiver, localeArguments(args)); },
      construct(target, args, newTarget) { return construct(target, localeArguments(args), newTarget); },
    });
    // Proxy 自然保留 name/length/prototype/静态方法；不修改原生 prototype.constructor。
    addPatch(originalIntl, name, { ...descriptor, value: wrapper });
  }

  function configure(next, source = 'async') {
    if (!next?.enabled) {
      config = null;
      for (const patch of patches) {
        if (!patch.installed) continue;
        try {
          if (same(getDesc(patch.object, patch.key), patch.replacement)) {
            define(patch.object, patch.key, patch.original);
          } else warnings.add(`${patch.key} 已被其他脚本改写；关闭时没有覆盖第三方改动，请刷新。`);
        } catch { warnings.add(`${patch.key} 无法还原，请刷新网页。`); }
        patch.installed = false;
      }
      return status();
    }
    try {
      const primary = originalIntl.getCanonicalLocales(next.primary)[0];
      const desired = [primary, ...next.fallbacks];
      const languages = config && desired.length === config.languages.length &&
        desired.every((value, index) => value === config.languages[index])
        ? config.languages : Object.freeze(desired);
      // 保留真实原生返回值，不伪造 resolvedOptions 中的 locale 或时区。
      new nativeDateTimeFormat(primary);
      new nativeNumberFormat(primary);
      config = Object.freeze({ primary, languages });
      started ??= source;
      for (const patch of patches) {
        const current = getDesc(patch.object, patch.key);
        if (patch.installed && same(current, patch.replacement)) continue;
        if (!same(current, patch.original)) {
          warnings.add(`${patch.key} 与初始化时不同，疑似扩展冲突；未强行覆盖。`);
          continue;
        }
        try { define(patch.object, patch.key, patch.replacement); patch.installed = true; }
        catch { warnings.add(`${patch.key} 无法替换，已跳过。`); }
      }
    } catch { warnings.add('配置不兼容，此文档未能应用；请恢复默认语言并刷新。'); }
    return status();
  }
  function status() {
    return { enabled: Boolean(config), source: started, primary: config?.primary ?? null,
      warnings: Array.from(warnings), baseline: { ...baseline, languages: [...baseline.languages] },
      installed: patches.filter(x => x.installed).map(x => x.key) };
  }
  define(globalThis, KEY, { value: Object.freeze({ configure, status }),
    enumerable: false, writable: false, configurable: false });
})();
