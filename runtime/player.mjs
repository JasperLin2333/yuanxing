// 页面在不具备同源权限的 iframe 中运行；这里只传递演示上下文和已声明的跳转。
export function cleanContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, item]) =>
    /^[A-Za-z][\w-]*$/.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key) &&
    (typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item))));
}

export function flowEntries(model) {
  const playable=node=>node&&node.kind!=='note';
  const explicit=model.experiences?.length?model.experiences:model.flows;
  if (explicit?.length) return explicit.filter(flow => playable(model.nodes.find(node => node.id === flow.entry)));
  const module=model.modules.find(item=>item.id===model.entryModule)||model.modules[0];
  const entry=model.nodes.find(node=>node.id===module?.entry&&playable(node))||model.nodes.find(node=>node.module===module?.id&&node.overview!==false&&playable(node))||model.nodes.find(node=>node.overview!==false&&playable(node));
  return entry?[{id:'product',title:model.title||'完整原型',entry:entry.id}]:[];
}

// 缩略预览分帧挂载，取消离屏任务，不让回收站同时创建大量 iframe。
export function createPreviewQueue({request,cancel,batch=3}){
  const jobs=new Map();let frame=null;
  const tick=()=>{frame=null;for(const key of [...jobs.keys()].slice(0,batch)){const run=jobs.get(key);jobs.delete(key);run();}if(jobs.size)frame=request(tick);};
  return {add(key,run){jobs.set(key,run);if(frame===null)frame=request(tick);},remove(key){jobs.delete(key);},clear(){jobs.clear();if(frame!==null)cancel(frame);frame=null;}};
}

export function thumbnailHTML(html) {
  return html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?(?:refresh|content-security-policy)\b[^>]*>/gi, '').replace(/<base\b[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

// 声明式扩展在真实页面 DOM 上处理操作，不以父页面的透明控件覆盖产品。
export function bindNativeDocument(doc,{getEdges,follow,onInput,onKeyDown}){
  doc.addEventListener('click',event=>{
    const target=event.target?.closest?.('button,input,select,textarea,a,[role="button"],[contenteditable="true"]');
    if(target?.disabled||target?.getAttribute?.('aria-disabled')==='true')return;
    const matches=[];
    for(const edge of getEdges())if(edge.selector){try{const element=event.target.closest(edge.selector);if(element)matches.push({edge,element});}catch{/* 忽略已失效的选择器，交由项目检查报告。 */}}
    if(!matches.length)return;
    const nearest=matches.reduce((a,b)=>a.element.contains(b.element)?b:a).element;
    if(nearest.disabled||nearest.getAttribute?.('aria-disabled')==='true')return;
    const form=nearest.closest?.('form');
    if(nearest.type==='submit'&&form&&!form.checkValidity()){event.preventDefault();form.reportValidity();return;}
    event.preventDefault();follow(matches.filter(item=>item.element===nearest).map(item=>item.edge));
  });
  doc.addEventListener('submit',event=>event.preventDefault());
  doc.addEventListener('input',event=>onInput?.(event,'input'));
  doc.addEventListener('change',event=>onInput?.(event,'change'));
  doc.addEventListener('keydown',event=>onKeyDown?.(event));
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
    if (config.focusSelector) {
      const target=query(config.focusSelector),rect=target?.getBoundingClientRect();
      send('component-bounds',rect?{rect:[rect.x+window.scrollX,rect.y+window.scrollY,rect.width,rect.height]}:{missing:true});
    }
  }
  window.addEventListener('message',event=>{
    if(event.source!==parent||event.data?.yuanxing!==config.token||event.data?.type!=='handoff-snapshot')return;
    const copy=document.documentElement.cloneNode(true),originals=[document.documentElement,...document.documentElement.querySelectorAll('*')],nodes=[copy,...copy.querySelectorAll('*')];
    nodes.forEach((n,i)=>{if(n.matches('script,iframe,object,embed')){n.remove();return;}for(const a of [...n.attributes])if(/^on/i.test(a.name))n.removeAttribute(a.name);
      if(n.tagName==='INPUT'&&n.type!=='file'){n.setAttribute('value',originals[i].value);if(originals[i].checked)n.setAttribute('checked','');else n.removeAttribute('checked');}
      if(n.tagName==='TEXTAREA')n.textContent=originals[i].value;if(n.tagName==='OPTION'){if(originals[i].selected)n.setAttribute('selected','');else n.removeAttribute('selected');}
    });send('handoff-snapshot',{html:copy.outerHTML});
  });
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
  if (config.focusSelector && typeof MutationObserver !== 'undefined') new MutationObserver(measure).observe(document.body,{subtree:true,childList:true,attributes:true});
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
