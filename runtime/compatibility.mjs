// 从同一份项目生成可被研发读取的 manifest/files；不改写页面源与原生播放数据。
import {expandHTML} from './core.mjs';
import {defaultDocument,walkDocument,documentSourceKey} from './document.mjs';
import {packExportArtifact} from './export-data.mjs';
const compatEscape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const compatDecode = value => value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi,entity=>{const named={'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'};if(named[entity.toLowerCase()])return named[entity.toLowerCase()];const number=entity[2].toLowerCase()==='x'?parseInt(entity.slice(3,-1),16):parseInt(entity.slice(2,-1),10);return number>0&&number<=0x10ffff?String.fromCodePoint(number):entity;});
function compatElements(html) {
  const result=[],stack=[],voids=new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
  const tokens=/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][\w:-]*(?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?\s*\/?>/gi;
  let match;
  while((match=tokens.exec(html))){const raw=match[0];if(raw.startsWith('<!'))continue;const closing=/^<\//.test(raw),name=raw.match(/^<\/?([\w:-]+)/)[1].toLowerCase();
    if(closing){const index=stack.findLastIndex(node=>node.tag===name);if(index>=0)stack.splice(index);continue;}
    const attrs=new Map();const body=raw.slice(raw.match(/^<[\w:-]+/)[0].length,raw.length-1);for(const attribute of body.matchAll(/([^\s=<>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))attrs.set(attribute[1].toLowerCase(),compatDecode(attribute[2]??attribute[3]??attribute[4]??''));
    const node={tag:name,attrs,start:match.index,end:tokens.lastIndex,parent:stack.at(-1),children:[]};node.parent?.children.push(node);result.push(node);
    if(name==='script'||name==='style'||name==='textarea'||name==='title'){const end=new RegExp('</'+name+'\\s*>','gi');end.lastIndex=tokens.lastIndex;const last=end.exec(html);if(last)tokens.lastIndex=end.lastIndex;continue;}
    if(!voids.has(name)&&!raw.endsWith('/>'))stack.push(node);
  }
  return result;
}
const compatCSSUnescape = value => value.replace(/\\([\da-f]{1,6}\s?|.)/gi,(_,char)=>/^[\da-f]{1,6}\s?$/i.test(char)?String.fromCodePoint(parseInt(char,16)):char);
function compatSelectorParts(selector) {
  const parts=[];let text='',quote='',depth=0,pending=' ';
  const flush=()=>{if(text.trim()){parts.push({text:text.trim(),relation:pending});text='';pending=' ';}};
  for(let i=0;i<selector.length;i++){const char=selector[i];if(char==='\\'){text+=char+(selector[++i]||'');continue;}if(quote){text+=char;if(char===quote)quote='';continue;}if(char==='"'||char==="'"){quote=char;text+=char;continue;}if(char==='['||char==='('){depth++;text+=char;continue;}if(char===']'||char===')'){depth--;text+=char;continue;}if(!depth&&(char==='>'||/\s/.test(char))){flush();if(char==='>')pending='>';continue;}if(!depth&&/[,+~]/.test(char))return null;text+=char;}
  flush();return depth||quote||!parts.length?null:parts;
}
function compatCompound(node,selector) {
  let rest=selector,match;
  const name=rest.match(/^(\*|[a-z][\w-]*)/i);if(name){if(name[1]!=='*'&&name[1].toLowerCase()!==node.tag)return false;rest=rest.slice(name[0].length);}
  while(rest){
    if((match=rest.match(/^([.#])((?:\\.|[\w-])+)/))){const value=compatCSSUnescape(match[2]);if(match[1]==='#'?node.attrs.get('id')!==value:!(node.attrs.get('class')||'').split(/\s+/).includes(value))return false;}
    else if((match=rest.match(/^\[\s*([\w:-]+)\s*(?:(\^=|\$=|\*=|~=|\|=|=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*(i)?)?\s*\]/i))){const actual=node.attrs.get(match[1].toLowerCase());if(actual===undefined)return false;if(match[2]){let a=actual,v=compatCSSUnescape(match[3]??match[4]??match[5]??'');if(match[6]){a=a.toLowerCase();v=v.toLowerCase();}const checks={'=':()=>a===v,'^=':()=>a.startsWith(v),'$=':()=>a.endsWith(v),'*=':()=>a.includes(v),'~=':()=>a.split(/\s+/).includes(v),'|=':()=>a===v||a.startsWith(v+'-')};if(!checks[match[2]]())return false;}}
    else if((match=rest.match(/^:(first-child|last-child|nth-child|nth-of-type)(?:\(\s*(\d+|odd|even)\s*\))?/i))){const siblings=node.parent?.children||[node],filtered=match[1]==='nth-of-type'?siblings.filter(n=>n.tag===node.tag):siblings,index=filtered.indexOf(node)+1,expected=match[1]==='first-child'?'1':match[1]==='last-child'?String(filtered.length):match[2];if(!expected||!(expected==='odd'?index%2===1:expected==='even'?index%2===0:index===Number(expected)))return false;}
    else return null;
    rest=rest.slice(match[0].length);
  }
  return true;
}
function compatMatches(node,parts,index=parts.length-1) {
  const own=compatCompound(node,parts[index].text);if(own!==true)return own;if(index===0)return true;
  if(parts[index].relation==='>')return node.parent?compatMatches(node.parent,parts,index-1):false;
  for(let parent=node.parent;parent;parent=parent.parent)if(compatMatches(parent,parts,index-1)===true)return true;
  return false;
}
export function compatibleSelectorTargets(html,selector) {
  const parts=typeof selector==='string'?compatSelectorParts(selector):null;
  if(!parts)return {supported:false,elements:[]};
  // 先检查语法，避免一个早期不匹配的简单选择器掩盖后续不支持的语法。
  for(const part of parts){let rest=part.text.replace(/^(\*|[a-z][\w-]*)/i,'');rest=rest.replace(/([.#])((?:\\.|[\w-])+)|\[\s*[\w:-]+\s*(?:(?:\^=|\$=|\*=|~=|\|=|=)\s*(?:"[^"]*"|'[^']*'|[^\]\s]+)\s*i?)?\s*\]|:(?:first-child|last-child)|:(?:nth-child|nth-of-type)\(\s*(?:\d+|odd|even)\s*\)/gi,'');if(rest)return {supported:false,elements:[]};}
  try{return {supported:true,elements:compatElements(html).filter(node=>compatMatches(node,parts)===true)};}catch{return {supported:false,elements:[]};}
}
function compatUpdateTags(html,marks) {
  const edits=[...marks.entries()].map(([node,attributes])=>{
    let tag=html.slice(node.start,node.end);
    for(const [name,value] of Object.entries(attributes)){tag=tag.replace(new RegExp('\\s'+name+'(?:\\s*=\\s*(?:"[^"]*"|\'[^\']*\'|[^\\s>]+))?','gi'),'');tag=tag.replace(/\/?>(?=$)/,ending=>` ${name}="${compatEscape(value)}"${ending}`);}
    return {start:node.start,end:node.end,tag};
  }).sort((a,b)=>b.start-a.start);
  for(const edit of edits)html=html.slice(0,edit.start)+edit.tag+html.slice(edit.end);
  return html;
}
function compatLocalActions(defaults) {
  let context={...defaults};const all=selector=>{try{return [...document.querySelectorAll(selector)];}catch{return [];}};
  const paint=()=>{for(const element of all('[data-yx-text]'))element.textContent=String(context[element.dataset.yxText]??'');for(const element of all('[data-yx-visible]'))element.hidden=String(context[element.dataset.yxVisible]??'')!==element.dataset.yxValue;};
  for(const element of all('[data-yx-bind]')){const key=element.dataset.yxBind;if(!(key in context))continue;if(element.type==='checkbox')element.checked=!!context[key];else if(element.type==='radio')element.checked=element.value===String(context[key]);else element.value=String(context[key]);}
  for(const element of all('[data-yx-initial-visible]'))element.hidden=String(context[element.dataset.yxInitialVisible]??'')!==element.dataset.yxValue;
  document.addEventListener('input',event=>{const element=event.target;if(element.dataset?.yxBind){context[element.dataset.yxBind]=element.type==='checkbox'?element.checked:element.value;paint();}});
  document.addEventListener('click',event=>{const element=event.target.closest?.('[data-yx-action]');if(!element||element.disabled)return;const action=element.dataset.yxAction,targets=all(element.dataset.yxTarget||'');if(['show','hide','toggle'].includes(action)){event.preventDefault();for(const target of targets)target.hidden=action==='toggle'?!target.hidden:action==='hide';}else if(action==='tab'){event.preventDefault();for(const target of all(element.dataset.yxGroup||'[data-yx-panel]'))target.hidden=!targets.includes(target);for(const sibling of element.parentElement.querySelectorAll('[data-yx-action="tab"]')){sibling.classList.toggle('active',sibling===element);sibling.setAttribute('aria-selected',String(sibling===element));}}else if(action==='set'&&element.dataset.yxKey){context[element.dataset.yxKey]=element.dataset.yxValue||'';paint();}});
  paint();
}
function compatPageHtml(html,marks,defaults) {
  html=compatUpdateTags(html,marks);
  const handlers=[];
  const elements=compatElements(html),handlerMarks=new Map();
  for(const element of elements){const own=[...element.attrs].filter(([name])=>/^on[a-z]+$/.test(name));if(!own.length)continue;const id='handler-'+handlers.length;handlerMarks.set(element,{'data-yuanxing-handler':id});for(const [name,code] of own)handlers.push({id,event:name.slice(2),code});}
  html=compatUpdateTags(html,handlerMarks);
  // 重新定位后逐标签删除内联处理器，不触碰 script/style 的文本。
  const removals=compatElements(html).map(element=>({element,tag:html.slice(element.start,element.end).replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'')})).sort((a,b)=>b.element.start-a.element.start);
  for(const {element,tag} of removals)html=html.slice(0,element.start)+tag+html.slice(element.end);
  let script=handlers.map(({id,event,code})=>`document.querySelector('[data-yuanxing-handler="${id}"]').addEventListener(${JSON.stringify(event)},function(event){const result=(function(event){${code}\n}).call(this,event);if(result===false)event.preventDefault();});`).join('\n');
  if(/data-yx-(?:action|bind|text|visible|initial-visible)/.test(html))script+=`\n(${compatLocalActions.toString()})(${JSON.stringify(defaults||{}).replace(/</g,'\\u003c')});`;
  if(script){const addition='<script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>';html=/<\/body\s*>/i.test(html)?html.replace(/<\/body\s*>/i,addition+'</body>'):html+addition;}
  return html;
}

function compatDocumentText(model,documentSources={}) {
  const general=[],byNode=new Map();
  const targets=blocks=>{const ids=new Set();walkDocument(blocks,block=>{if(block.node)ids.add(block.node);if(block.edge){const source=model.edges.find(edge=>edge.id===block.edge)?.from;if(source)ids.add(source);}});return [...ids];};
  const collect=(blocks,context=[])=>{
    for(const block of blocks||[]){
      const text=block.type==='text'?block.text:block.type==='source'?documentSources[documentSourceKey(block)]:block.type==='description'&&block.rule?model.rules?.[block.rule]:'';
      const associated=block.nodes?.length?block.nodes:context;
      if(text?.trim()){if(associated.length)for(const id of associated){const texts=byNode.get(id)||[];if(!texts.includes(text))texts.push(text);byNode.set(id,texts);}else if(!general.includes(text))general.push(text);}
      if(block.type==='columns'){const own=targets(block.columns.flatMap(column=>column.blocks));for(const column of block.columns)collect(column.blocks,own.length?own:context);}
      if(block.type==='table')for(const row of block.rows){const own=targets(row.cells.flatMap(cell=>cell.blocks));for(const cell of row.cells)collect(cell.blocks,own.length?own:context);}
    }
  };
  collect(model.document?.blocks);
  return {general,byNode};
}
export function createCompatibilityBundle(bundle) {
  const model=bundle.model,nodes=model.nodes.filter(n=>n.kind!=='note'),byId=new Map(nodes.map(n=>[n.id,n])),edges=model.edges.filter(e=>!e.diagram&&byId.has(e.from)&&byId.has(e.to)),adjacent=new Map(nodes.map(n=>[n.id,new Set()]));
  for(const edge of edges){adjacent.get(edge.from).add(edge.to);adjacent.get(edge.to).add(edge.from);}
  const components=[],seen=new Set();for(const node of nodes){if(seen.has(node.id))continue;const ids=[],queue=[node.id];while(queue.length){const id=queue.shift();if(seen.has(id))continue;seen.add(id);ids.push(id);queue.push(...adjacent.get(id));}components.push(ids);}
  const manifest={requirements:[]},files={},bindings=[],limitations=[],documentText=compatDocumentText(model,bundle.documentSources);
  for(const ids of components){const group=new Set(ids),pages=nodes.filter(n=>group.has(n.id)),entries=[...(model.experiences||[]),...(model.flows||[])],entry=entries.find(flow=>group.has(flow.entry))?.entry||model.modules.map(m=>m.entry).find(id=>group.has(id))||pages[0].id,groupEdges=edges.filter(e=>group.has(e.from));
    const moduleIds=new Set(pages.map(n=>n.module)),requirement={id:'req-'+Buffer.from(pages[0].id).toString('hex'),title:moduleIds.size===1?model.modules.find(m=>m.id===pages[0].module)?.title||model.title:model.title,states:[],transitions:groupEdges.map((edge,i)=>({id:'T'+(i+1),to:edge.to,text:edge.condition||edge.label||byId.get(edge.to).title})),logic:[]};
    const transitionIds=new Map(groupEdges.map((edge,i)=>[edge.id,'T'+(i+1)]));
    for(const node of pages){const filename='states/'+Buffer.from(node.id).toString('hex')+'.html';requirement.states.push({id:node.id,html:filename,...(node.id===entry?{initial:true}:{}),desc:node.title});
      let html=node.kind==='image'?`<main style="position:relative;width:${node.width}px;height:${node.height}px"><img src="${compatEscape(bundle.resources[node.id])}" alt="${compatEscape(node.title)}" style="width:100%;height:100%">${groupEdges.filter(e=>e.from===node.id&&e.rect).map(edge=>{const [x,y,w,h]=edge.rect;return `<button type="button" data-yuanxing-edge="${compatEscape(edge.id)}" aria-label="${compatEscape(edge.label||'继续')}" style="position:absolute;left:${x*100}%;top:${y*100}%;width:${w*100}%;height:${h*100}%;border:0;background:transparent"></button>`;}).join('')}</main>`:expandHTML(bundle.resources[node.id]||'',bundle.fragments||{});
      const elements=compatElements(html),marks=new Map(),logicByElement=new Map(),edgeByElement=new Map();
      const addLogic=(element,text)=>{if(!text?.trim())return;const key=element?.start??'unassigned',item=logicByElement.get(key)||{element,texts:[]};if(!item.texts.includes(text))item.texts.push(text);logicByElement.set(key,item);};
      const root=elements.find(e=>e.tag==='main')||elements.find(e=>e.tag==='body')||elements[0];
      addLogic(root,[node.rule?model.rules?.[node.rule]:'',node.description].filter(Boolean).join('\n\n'));
      for(const text of documentText.byNode.get(node.id)||[])addLogic(root,text);
      for(const edge of groupEdges.filter(e=>e.from===node.id)){
        const selector=node.kind==='image'&&edge.rect?`[data-yuanxing-edge="${edge.id}"]`:edge.selector;
        const result=selector?compatibleSelectorTargets(html,selector):{supported:false,elements:[]};
        if(!result.supported||!result.elements.length){limitations.push({type:result.supported?'missing-control':'selector-adaptation',node:node.id,edge:edge.id,selector:selector||null});addLogic(root,`${edge.label||'操作'} → ${byId.get(edge.to).title}${edge.description?'\n'+edge.description:''}`);continue;}
        for(const matched of result.elements){const element=elements.find(e=>e.start===matched.start);const list=edgeByElement.get(element.start)||{element,edges:[]};list.edges.push(edge);edgeByElement.set(element.start,list);addLogic(element,[edge.rule?model.rules?.[edge.rule]:'',edge.description].filter(Boolean).join('\n\n'));}
        bindings.push({requirement:requirement.id,node:node.id,edge:edge.id,transition:transitionIds.get(edge.id),selector,when:edge.when||{},setContext:edge.setContext||{}});
      }
      for(const annotation of model.annotations.filter(a=>a.node===node.id||a.edge&&groupEdges.some(e=>e.id===a.edge&&e.from===node.id))){const result=annotation.selector?compatibleSelectorTargets(html,annotation.selector):null;const element=result?.elements[0];addLogic(element?elements.find(e=>e.start===element.start):root,annotation.text);}
      for(const {element,edges:targetEdges} of edgeByElement.values()){
        const conditional=targetEdges.length>1||targetEdges.some(e=>Object.keys(e.when||{}).length);
        if(conditional){marks.set(element,{'data-yuanxing-transition-ids':targetEdges.map(e=>transitionIds.get(e.id)).join(' ')});addLogic(element,targetEdges.map(e=>`${e.condition||e.label||'操作'}${Object.keys(e.when||{}).length?'（'+Object.entries(e.when).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join('，')+'）':''} → ${byId.get(e.to).title}`).join('\n'));limitations.push({type:'conditional-transition',node:node.id,edges:targetEdges.map(e=>e.id)});}
        else marks.set(element,{'data-transition-id':transitionIds.get(targetEdges[0].id)});
      }
      for(const {element,texts} of logicByElement.values()){const id='L'+(requirement.logic.length+1);requirement.logic.push({id,text:texts.join('\n\n')});if(element)marks.set(element,{...marks.get(element),'data-logic-id':id});}
      files[filename]=compatPageHtml(html,marks,{...model.contextDefaults,...node.initialContext});
      // 基础研发格式没有跨状态上下文协议，完整条件与原始节点仍保留在 yuanxing.model。
      if(node.initialContext&&groupEdges.some(edge=>edge.to===node.id))limitations.push({type:'initial-context-flow',node:node.id});
    }
    if(documentText.general.length)requirement.logic.push({id:'L'+(requirement.logic.length+1),text:documentText.general.join('\n\n')});
    manifest.requirements.push(requirement);
  }
  return {manifest,files,yuanxing:{version:1,model,document:model.document||defaultDocument(model),documentSources:bundle.documentSources||{},images:bundle.images||{},bindings,limitations}};
}

export function compatibilityDataTag(bundle,payload=createCompatibilityBundle(bundle)) {
  const json=JSON.stringify(packExportArtifact(payload)).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  return `<script id="yuanxing-artifact" type="application/json">${json}</script>`;
}
