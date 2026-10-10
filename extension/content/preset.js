// 只在配置精确等于出厂语言组合、且站点在授权和启用范围内时注册本文件。
// 与 main.js 属于同一 registration，文件顺序明确，不需要唤醒后台或读取异步 storage。
globalThis[Symbol.for('chrome-locale-sg.controller.v1')]?.configure({
  enabled: true, primary: 'zh-SG', fallbacks: ['en-US'],
}, 'document_start/preset');
