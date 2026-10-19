// 开发交付只读 DOM；默认不启用，不改变页面和编排源文件。
export function handoffAncestors(element){const result=[];for(let n=element;n&&n.tagName?.toLowerCase()!=='html';n=n.parentElement)result.unshift(n);return result;}
export function handoffSelector(element){
  const escape=value=>element.ownerDocument.defaultView?.CSS?.escape(value)||String(value).replace(/[^a-zA-Z0-9_-]/g,c=>'\\'+c);
  const parts=[];for(let n=element;n&&n.tagName?.toLowerCase()!=='html';n=n.parentElement){
    const tag=n.tagName.toLowerCase();if(n.id){parts.unshift(tag+'#'+escape(n.id));break;}
    const siblings=[...(n.parentElement?.children||[])].filter(v=>v.tagName===n.tagName),classes=[...n.classList].filter(c=>!c.startsWith('yx-handoff-')).map(c=>'.'+escape(c)).join('');
    parts.unshift(tag+classes+(siblings.length>1?':nth-of-type('+(siblings.indexOf(n)+1)+')':''));
  }return parts.join(' > ');
}
export function handoffClean(element){
  const copy=element.cloneNode(true);
  const originals=[element,...element.querySelectorAll('*')],copies=[copy,...copy.querySelectorAll('*')];
  for(let index=0;index<copies.length;index++){const n=copies[index],original=originals[index];
    if(n.matches('script,iframe,object,embed,link,base,meta,[data-yx-handoff-overlay]')){n.remove();continue;}
    for(const a of [...n.attributes])if(/^on/i.test(a.name)||a.name.startsWith('data-yx-handoff')||/^(href|src|action|formaction)$/i.test(a.name)&&/^\s*javascript:/i.test(a.value))n.removeAttribute(a.name);
    if(n.hasAttribute('contenteditable'))n.setAttribute('contenteditable','false');
    const tag=n.tagName.toLowerCase();if(tag==='input'&&n.type!=='file'){n.setAttribute('value',original.value??original.getAttribute('value')??'');if(original.checked)n.setAttribute('checked','');else n.removeAttribute('checked');}
    if(tag==='textarea')n.textContent=original.value??original.textContent;if(tag==='option'){if(original.selected)n.setAttribute('selected','');else n.removeAttribute('selected');}
  }return copy;
}
export function collectHandoff(element){
  const doc=element.ownerDocument,copy=handoffClean(element),dependencies=new Set(),symbols=new Map();
  for(const use of [copy,...copy.querySelectorAll('use')].filter(n=>n.tagName.toLowerCase()==='use')){const href=use.getAttribute('href')||use.getAttribute('xlink:href');if(href?.startsWith('#')){const symbol=doc.getElementById(href.slice(1));if(symbol&&!element.contains(symbol))symbols.set(href,handoffClean(symbol).outerHTML);}}
  for(const n of [copy,...copy.querySelectorAll('[src],[href],[xlink\\:href]')])for(const a of ['src','href','xlink:href']){const value=n.getAttribute(a);if(value&&!value.startsWith('data:')&&!value.startsWith('#'))dependencies.add(value);}
  const styles=[...doc.querySelectorAll('style')].filter(n=>!n.hasAttribute('data-yx-handoff-overlay')).map(n=>n.outerHTML).join('\n');
  const components=[...new Set([element,...element.querySelectorAll('[data-ec-component]')].map(n=>n.getAttribute('data-ec-component')).filter(Boolean))];
  // 浅拷贝祖先容器，保留 class、布局上下文，避免把兄弟页面区域一起交付。
  let contextual=copy.cloneNode(true);for(const ancestor of handoffAncestors(element).slice(0,-1).reverse()){
    if(ancestor.tagName.toLowerCase()==='body')continue;const shell=handoffClean(ancestor.cloneNode(false));shell.append(contextual);contextual=shell;
  }
  return {html:copy.outerHTML,contextHTML:copy.tagName.toLowerCase()==='body'?copy.innerHTML:contextual.outerHTML,htmlAttributes:[...doc.documentElement.attributes].filter(a=>!/^on/i.test(a.name)).map(a=>[a.name,a.value]),bodyAttributes:[...doc.body.attributes].filter(a=>!/^on/i.test(a.name)).map(a=>[a.name,a.value]),styles,svgDefs:symbols.size?'<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden"><defs>'+[...symbols.values()].join('')+'</defs></svg>':'',selector:handoffSelector(element),components,dependencies:[...dependencies]};
}
const handoffEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function handoffDocument(snippet,context={}){
  const body=(snippet.bodyAttributes||[]).filter(([key])=>!/^on/i.test(key)&&key!=='contenteditable').map(([key,value])=>' '+key+'="'+handoffEscape(value)+'"').join('');
  const root=(snippet.htmlAttributes?.length?snippet.htmlAttributes:[['lang','zh-CN']]).filter(([key])=>!/^on/i.test(key)&&key!=='contenteditable').map(([key,value])=>' '+key+'="'+handoffEscape(value)+'"').join('');
  return '<!doctype html><html'+root+'><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+handoffEscape(context.title||'局部 UI 片段')+'</title>'+snippet.styles+'</head><body'+body+'>'+snippet.svgDefs+snippet.contextHTML+'</body></html>';
}
export function handoffPrompt(snippet,context){
  const fence=text=>{const length=Math.max(2,...(String(text).match(/`+/g)||[]).map(v=>v.length))+1;return '`'.repeat(length);};
  const code=(text,language)=>fence(text)+language+'\n'+text+'\n'+fence(text);
  return ['# 局部 UI 改动交付','',`项目：${context.project}\n模块：${context.module}\n页面：${context.title}\n页面标识：${context.id}`,
    `预览文件：${context.path}`,'编辑源文件：\n'+(context.sources?.length?context.sources.map(v=>'- '+v).join('\n'):'- 沿用预览文件；若为生成产物，先追溯源模块，勿直接覆盖生成文件。'),
    '挂载位置：'+snippet.selector,'组件：'+(snippet.components.join('、')||'未标记'),
    '页面与逻辑说明：\n'+(context.description||'未填写'),
    '关联标记：\n'+(context.annotations?.map(a=>'- '+a.text).join('\n')||'无'),
    '当前选区 DOM：\n'+code(snippet.html,'html'),'相关页面样式：\n'+code(snippet.styles,'html'),
    snippet.svgDefs?'SVG 依赖：\n'+code(snippet.svgDefs,'html'):'',
    snippet.dependencies.length?'需核对的资源依赖：\n'+snippet.dependencies.map(v=>'- '+v).join('\n'):'',
    '仅修改选区对应的源模块，保留其他区域及既有交互；片段提供 UI 参考，不代表业务逻辑或生产代码已实现。'].filter(Boolean).join('\n\n');
}
export function createDOMPicker(doc,{onSelect,onExit}={}){
  let selected;const overlay=doc.createElement('div');overlay.setAttribute('data-yx-handoff-overlay','');overlay.style.cssText='position:fixed;pointer-events:none;border:2px solid #16a36a;background:#16a36a15;z-index:2147483647;box-sizing:border-box;display:none';doc.documentElement.append(overlay);
  const valid=n=>n?.nodeType===1&&!n.closest('[data-yx-handoff-overlay]')&&!n.matches('html,head,script,style,meta,link');
  const paint=n=>{if(!valid(n))return;const r=n.getBoundingClientRect();Object.assign(overlay.style,{display:'block',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});};
  const select=n=>{if(!valid(n))return;selected=n;paint(n);onSelect?.(n);};
  const move=e=>{if(!selected)paint(e.target);},click=e=>{if(!valid(e.target))return;e.preventDefault();e.stopImmediatePropagation();select(e.target);},key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();onExit?.();}},scroll=()=>{if(selected)paint(selected);};
  // window 捕获先于产品页面的 document 点击处理，拾取时不触发业务操作。
  const down=e=>{if(valid(e.target)){e.preventDefault();e.stopImmediatePropagation();}};
  const events=doc.defaultView||doc;events.addEventListener('pointerdown',down,true);events.addEventListener('click',click,true);events.addEventListener('keydown',key,true);doc.addEventListener('pointermove',move,true);doc.addEventListener('scroll',scroll,true);
  return {select,destroy(){events.removeEventListener('pointerdown',down,true);events.removeEventListener('click',click,true);events.removeEventListener('keydown',key,true);doc.removeEventListener('pointermove',move,true);doc.removeEventListener('scroll',scroll,true);overlay.remove();}};
}
