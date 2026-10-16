// 页面在不具备同源权限的 iframe 中运行；这里只传递演示上下文和已声明的跳转。
export function cleanContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, item]) =>
    /^[A-Za-z][\w-]*$/.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key) &&
    (typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item))));
}

export function flowEntries(model) {
  if (model.flows?.length) return model.flows.filter(flow => model.nodes.some(node => node.id === flow.entry));
  return model.modules.map(module => ({
    id: module.id, title: module.title,
    entry: model.nodes.some(node => node.id === module.entry) ? module.entry : model.nodes.find(node => node.module === module.id && node.kind !== 'note' && node.overview !== false)?.id
  })).filter(flow => flow.entry);
}

export function thumbnailHTML(html) {
  return html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?(?:refresh|content-security-policy)\b[^>]*>/gi, '').replace(/<base\b[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

// 此函数会内嵌到原型页面，不引用模块内变量。
export function pageBridge(config) {
  let context = {...config.context};
  const send = (type, data = {}) => parent.postMessage({yuanxing: config.token, type, ...data}, '*');
  const query = selector => { try { return document.querySelector(selector); } catch { return null; } };
  const queryAll = selector => { try { return [...document.querySelectorAll(selector)]; } catch { return []; } };
  const valueOf = element => element.type === 'checkbox' ? element.checked : element.value;
  function collect() {
    for (const element of queryAll('[data-yx-bind]')) {
      if (element.type === 'radio' && !element.checked) continue;
      context[element.dataset.yxBind] = valueOf(element);
    }
    return context;
  }
  function paint() {
    for (const element of queryAll('[data-yx-text]')) element.textContent = String(context[element.dataset.yxText] ?? '');
    for (const element of queryAll('[data-yx-visible]')) element.hidden = String(context[element.dataset.yxVisible] ?? '') !== element.dataset.yxValue;
  }
  function measure() {
    const positions = {};
    for (const annotation of config.annotations) {
      const element = query(annotation.selector);
      if (!element || element.closest('[hidden]')) continue;
      const rect = element.getBoundingClientRect(), offset = annotation.offset || [.5, .5];
      if (rect.width && rect.height) positions[annotation.id] = [(rect.x + rect.width * offset[0]) / config.width, (rect.y + rect.height * offset[1]) / config.height];
    }
    send('measure', {positions});
  }
  function sync() { collect(); paint(); send('context', {context}); measure(); }
  function localAction(element) {
    const action = element.dataset.yxAction, targets = queryAll(element.dataset.yxTarget || '');
    if (action === 'show' || action === 'hide' || action === 'toggle') {
      for (const target of targets) target.hidden = action === 'toggle' ? !target.hidden : action === 'hide';
    } else if (action === 'tab') {
      for (const target of queryAll(element.dataset.yxGroup || '[data-yx-panel]')) target.hidden = !targets.includes(target);
      for (const sibling of element.parentElement?.querySelectorAll('[data-yx-action="tab"]') || []) {
        sibling.classList.toggle('active', sibling === element);
        sibling.setAttribute('aria-selected', String(sibling === element));
      }
    } else if (action === 'set' && element.dataset.yxKey) {
      context[element.dataset.yxKey] = element.dataset.yxValue ?? '';
    }
    // 不重新读取旧表单值，以免覆盖 set 操作刚设置的上下文。
    paint(); send('context', {context}); measure();
  }
  document.addEventListener('click', event => {
    const clicked = event.target.closest?.('button,a,input,[data-yx-action],[data-yx-id]') || event.target;
    if (clicked.disabled || clicked.getAttribute?.('aria-disabled') === 'true') return;
    collect();
    const matches = config.edges.filter(edge => edge.selector && (() => { try { return !!event.target.closest(edge.selector); } catch { return false; } })());
    if (matches.length) {
      const form = clicked.closest?.('form');
      if (form && clicked.type === 'submit' && !form.checkValidity()) { event.preventDefault(); form.reportValidity(); return; }
      event.preventDefault(); event.stopImmediatePropagation();
      send('follow', {ids: matches.map(edge => edge.id), context}); return;
    }
    const action = event.target.closest?.('[data-yx-action]');
    if (action) { event.preventDefault(); localAction(action); }
    if (event.target.closest?.('a[href]')) event.preventDefault();
  }, true);
  document.addEventListener('submit', event => event.preventDefault());
  document.addEventListener('input', sync);
  document.addEventListener('change', sync);
  document.addEventListener('scroll', measure, true);
  for (const element of queryAll('[data-yx-bind]')) {
    const key = element.dataset.yxBind;
    if (!(key in context)) continue;
    if (element.type === 'checkbox') element.checked = !!context[key];
    else if (element.type === 'radio') element.checked = element.value === String(context[key]);
    else element.value = String(context[key]);
  }
  paint(); measure();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(document.body);
  window.addEventListener('load', measure, {once: true});
}

export function prototypeDocument(html, config) {
  const data = JSON.stringify({...config, context: cleanContext(config.context)}).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'">`;
  // CSP 必须早于输入内容；移除输入自己的 CSP、base 和页面自动跳转。
  html = html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?(?:refresh|content-security-policy)\b[^>]*>/gi, '').replace(/<base\b[^>]*>/gi, '');
  if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, match => match + policy);
  else if (/<html\b[^>]*>/i.test(html)) html = html.replace(/<html\b[^>]*>/i, match => match + `<head>${policy}</head>`);
  else html = `<!doctype html><html><head>${policy}</head><body>${html}</body></html>`;
  const bridge = `<script>(${pageBridge.toString()})(${data});</script>`;
  return /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, bridge + '</body>') : html + bridge;
}
