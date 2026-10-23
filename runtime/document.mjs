// 需求文档保存编排，页面、详细说明和已有 Markdown 正文保持各自唯一来源。
const docCopy = value => JSON.parse(JSON.stringify(value));
const docId = prefix => `${prefix}-${globalThis.crypto.randomUUID()}`;
export function walkDocument(blocks, visit) {
  if (!Array.isArray(blocks)) return;
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    visit(block);
    if (block.type === 'columns' && Array.isArray(block.columns)) for (const column of block.columns) walkDocument(column?.blocks, visit);
    if (block.type === 'table' && Array.isArray(block.rows)) for (const row of block.rows) if (Array.isArray(row?.cells)) for (const cell of row.cells) walkDocument(cell?.blocks, visit);
  }
}
export function defaultDocument(model) {
  const blocks = [];
  for (const module of model.modules) {
    const nodes = model.nodes.filter(n => n.module === module.id && n.overview !== false && n.canvas !== false && n.presentation !== 'branch');
    if (!nodes.length) continue;
    if (model.modules.length > 1) blocks.push({id:`doc-heading:${module.id}`,type:'text',format:'heading1',text:module.title});
    for (const node of nodes) {
      blocks.push({id:`doc-title:${node.id}`,type:'text',format:'heading2',text:node.title});
      if (node.kind !== 'note') blocks.push({id:`doc-page:${node.id}`,type:'prototype',node:node.id});
      blocks.push({id:`doc-detail:${node.id}`,type:'description',node:node.id});
    }
  }
  return {version:1,blocks};
}
export function documentSourceBlocks(model) {
  const blocks=[];walkDocument(model.document?.blocks,block=>{if(block.type==='source')blocks.push(block);});return blocks;
}
export const documentSourceKey = block => JSON.stringify([block.path,block.section||'',!!block.omitHeading]);
// 按完整标题定位，包含子章节；代码块中的 # 不参与分节。
export function documentSourceRange(text,section,omitHeading=false) {
  const lines=text.split('\n'),headings=[];let fence;
  for(let i=0;i<lines.length;i++){
    const marker=lines[i].match(/^\s{0,3}(`{3,}|~{3,})/);
    if(marker){if(!fence)fence=marker[1][0];else if(fence===marker[1][0])fence=null;continue;}
    const heading=!fence&&lines[i].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if(heading)headings.push({line:i,level:heading[1].length,title:heading[2]});
  }
  if(!section)return {start:0,end:text.length,text,headings};
  const matches=headings.filter(h=>h.title===section);
  if(matches.length!==1)throw new Error(matches.length?'需求正文标题重复：'+section:'需求正文标题不存在：'+section);
  const start=matches[0],end=headings.find(h=>h.line>start.line&&h.level<=start.level)?.line??lines.length;
  const first=start.line+(omitHeading?1:0),raw=lines.slice(first,end).join('\n'),selected=raw.trim();
  const offset=lines.slice(0,first).reduce((length,line)=>length+line.length+1,0)+raw.length-raw.trimStart().length;
  return {start:offset,end:offset+selected.length,text:selected,headings};
}
export const extractDocumentSource=(text,section,omitHeading=false)=>documentSourceRange(text,section,omitHeading).text;
// 直接编辑只替换实际文字所在行或单元格，保留其余 Markdown、章节及原有空白。
export function patchDocumentSource(text,block,{line,column,before,value}) {
  const range=documentSourceRange(text,block.section,block.omitHeading),lines=range.text.split('\n');
  if(!Number.isInteger(line)||line<0||line>=lines.length||typeof before!=='string'||typeof value!=='string'||/[\r\n]/.test(value)||value.length>65536)throw new Error('文字修改位置或内容不正确');
  const raw=lines[line],parts=column===undefined?null:raw.split('|');let field,prefix,suffix;
  if(parts){if(!Number.isInteger(column)||column<0||column>=parts.length-2||value.includes('|'))throw new Error('表格文字修改不正确');field=parts[column+1];}
  else field=raw;
  const match=parts?field.match(/^(\s*)(.*?)(\s*)$/):field.match(/^(#{1,6}\s+)(.+?)(\s*#*\s*)$/)||field.match(/^(\s*(?:(?:[-*]|\d+\.)\s+)?)(.*?)(\s*)$/);
  [,prefix,field,suffix]=match;
  if(field.replace(/\u00a0/g,' ').trim()!==before.replace(/\u00a0/g,' ').trim()){const error=new Error('这段文字已在别处修改，当前输入已保留，请让 AI 合并。');error.status=409;throw error;}
  if(parts){parts[column+1]=prefix+value+suffix;lines[line]=parts.join('|');}else lines[line]=prefix+value+suffix;
  const globalLine=text.slice(0,range.start).split('\n').length-1+line,heading=range.headings.find(item=>item.line===globalLine);
  if(heading&&!value.trim())throw new Error('章节标题不能为空');
  return {text:text.slice(0,range.start)+lines.join('\n')+text.slice(range.end),rename:heading&&heading.title!==value?{before:heading.title,after:value}:null};
}
export function ensureDocument(model) { return model.document ||= defaultDocument(model); }
export function findDocumentBlock(model, id) {
  let found;
  walkDocument(model.document?.blocks, block => { if (block.id === id) found = block; });
  return found;
}
export function documentContainer(model, id = '@document') {
  if (id === '@document') return ensureDocument(model);
  let found;
  walkDocument(model.document?.blocks, block => {
    if (block.type === 'columns') found ||= block.columns.find(column => column.id === id);
    if (block.type === 'table') for (const row of block.rows) found ||= row.cells.find(cell => cell.id === id);
  });
  return found;
}
function docLocate(model, id) {
  let found;
  const scan = owner => {
    const index = owner.blocks.findIndex(block => block.id === id);
    if (index >= 0) found = {owner,index,block:owner.blocks[index]};
    for (const block of owner.blocks) {
      if (block.type === 'columns') block.columns.forEach(scan);
      if (block.type === 'table') block.rows.forEach(row => row.cells.forEach(scan));
    }
  };
  scan(ensureDocument(model));
  return found;
}
export function moveDocumentBlock(model, id, containerId, beforeId) {
  const source = docLocate(model,id), target = documentContainer(model,containerId);
  if (!source || !target || beforeId === id) return false;
  const descendants = new Set();
  walkDocument([source.block], block => {
    if (block.type === 'columns') block.columns.forEach(column => descendants.add(column.id));
    if (block.type === 'table') block.rows.forEach(row => row.cells.forEach(cell => descendants.add(cell.id)));
  });
  if (descendants.has(containerId)) return false;
  if (beforeId && !target.blocks.some(block => block.id === beforeId)) return false;
  source.owner.blocks.splice(source.index,1);
  const index = beforeId ? target.blocks.findIndex(block => block.id === beforeId) : target.blocks.length;
  target.blocks.splice(index,0,source.block);
  return true;
}
export function removeDocumentBlock(model,id) {
  const found = docLocate(model,id);
  if (found) found.owner.blocks.splice(found.index,1);
}
export function newDocumentBlock(type, node) {
  const text = () => ({id:docId('text'),type:'text',text:''});
  if (type === 'columns') return {id:docId('columns'),type,columns:[{id:docId('column'),width:50,blocks:[text()]},{id:docId('column'),width:50,blocks:[text()]}]};
  if (type === 'table') return {id:docId('table'),type,widths:[50,50],rows:Array.from({length:2},() => ({id:docId('row'),cells:Array.from({length:2},() => ({id:docId('cell'),blocks:[text()]}))}))};
  if (type === 'prototype') return {id:docId('prototype'),type:'prototype',...(node ? {node} : {})};
  return {id:docId('text'),type:'text',text:'',...(type === 'heading' ? {format:'heading1'} : {})};
}
export function pruneDocument(model) {
  if (!model.document) return;
  const nodes = new Set(model.nodes.map(n => n.id)), edges = new Set(model.edges.map(e => e.id));
  const prune = owner => {
    owner.blocks = owner.blocks.filter(block => (!block.nodes?.length||block.nodes.some(id=>nodes.has(id)))&&(!['prototype','description'].includes(block.type) || (block.rule ? typeof model.rules?.[block.rule]==='string' : block.edge ? edges.has(block.edge) : nodes.has(block.node))));
    for (const block of owner.blocks) {
      if(block.nodes)block.nodes=block.nodes.filter(id=>nodes.has(id));
      if (block.type === 'columns') block.columns.forEach(prune);
      if (block.type === 'table') block.rows.forEach(row => row.cells.forEach(prune));
    }
  };
  prune(model.document);
}
export function documentAssetPaths(model) {
  const paths = [];
  walkDocument(model.document?.blocks, block => {
    if (block.type === 'image') paths.push(block.path);
    if (block.type === 'text') for (const match of String(block.text || '').matchAll(/`[^`]*`|!\[[^\]\n]*\]\(([^)\n]+)\)/g)) if (match[1]) paths.push(match[1]);
  });
  return paths;
}
export function validateDocument(model) {
  if (model.document === undefined) return [];
  const errors = [], ids = new Set(), nodes = new Map(model.nodes.map(n => [n.id,n])), edges = new Set(model.edges.map(e => e.id));
  const claim = item => { if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) errors.push('文档内容标识重复或为空'); else ids.add(item.id); };
  const children = (owner,depth=0) => {
    if (depth > 12 || !Array.isArray(owner?.blocks)) { errors.push('文档内容或嵌套层级不正确'); return; }
    for (const block of owner.blocks) {
      claim(block); if (!block) continue;
      if (block.type === 'text') {
        if (typeof block.text !== 'string' || block.format !== undefined && !['paragraph','heading1','heading2','heading3','quote'].includes(block.format)) errors.push('文档正文格式不正确');
      } else if (block.type === 'prototype' || block.type === 'description') {
        if (block.type === 'prototype' ? !nodes.has(block.node) || nodes.get(block.node).kind === 'note' : block.rule ? typeof model.rules?.[block.rule]!=='string' : block.edge ? !edges.has(block.edge) : !nodes.has(block.node)) errors.push('文档引用的页面或操作不存在');
        if (block.selector !== undefined && (typeof block.selector !== 'string' || !block.selector.trim() || block.selector.length > 1000)) errors.push('文档组件选择器不正确');
        if (block.height !== undefined && (!Number.isFinite(block.height) || block.height < 120 || block.height > 20000)) errors.push('文档原型高度不正确');
        if (block.frameScale !== undefined && (!Number.isFinite(block.frameScale) || block.frameScale < .2 || block.frameScale > 2)) errors.push('文档原型外框比例不正确');
      } else if (block.type === 'source') {
        if(typeof block.path!=='string'||! /^(?!\/|\w+:)[^\\\u0000-\u001f]+\.md$/i.test(block.path)||block.path.split('/').some(v=>!v||v==='.'||v==='..'))errors.push('需求正文路径不正确');
        if(block.section!==undefined&&(typeof block.section!=='string'||!block.section.trim()))errors.push('需求正文标题不正确');
        if(block.omitHeading!==undefined&&typeof block.omitHeading!=='boolean')errors.push('需求正文标题设置不正确');
      } else if (block.type === 'image') {
        if (typeof block.path !== 'string' || !/^assets\/[^?#\\\u0000-\u001f]+\.(png|jpe?g|webp)$/i.test(block.path) || block.path.split('/').some(v => !v || v === '.' || v === '..')) errors.push('文档图片路径不正确');
      } else if (block.type === 'columns') {
        if (!Array.isArray(block.columns) || block.columns.length < 2 || block.columns.length > 4) errors.push('文档分栏格式不正确');
        else for (const column of block.columns) { claim(column); if (!column) continue; if (column.width !== undefined && (!Number.isFinite(column.width) || column.width < 5 || column.width > 95)) errors.push('文档列宽不正确'); children(column,depth+1); }
      } else if (block.type === 'table') {
        if (!Array.isArray(block.rows) || !block.rows.length || !Array.isArray(block.rows[0]?.cells) || !block.rows[0].cells.length) { errors.push('文档表格格式不正确'); continue; }
        const count = block.rows[0].cells.length;
        if (block.widths !== undefined && (!Array.isArray(block.widths) || block.widths.length !== count || block.widths.some(v => !Number.isFinite(v) || v <= 0))) errors.push('文档表格列宽不正确');
        for (const row of block.rows) { claim(row); if (!Array.isArray(row?.cells) || row.cells.length !== count) { errors.push('文档表格列数不一致'); continue; } for (const cell of row.cells) { claim(cell); children(cell,depth+1); } }
      } else errors.push('文档内容类型不正确');
      if(block.nodes!==undefined&&(!Array.isArray(block.nodes)||block.nodes.some(id=>!nodes.has(id))))errors.push('需求正文关联页面不存在');
    }
  };
  if (model.document?.version !== 1) return ['文档数据版本不正确'];
  if (model.document.title !== undefined && typeof model.document.title !== 'string') errors.push('文档标题不正确');
  children(model.document);
  return errors;
}

// 从已渲染正文建立目录，包含引用 PRD 中的标题；原型 iframe 的内部标题不参与。
export function createDocumentOutline({root,paper,nav,toolbar}) {
  let entries=[],current=null,pending=null,disposed=false;
  const offset=()=> (toolbar?.offsetHeight||0)+20;
  function mark(entry) {
    if(current===entry)return;current=entry;
    for(const item of entries){if(item===entry)item.control.setAttribute('aria-current','location');else item.control.removeAttribute('aria-current');}
    if(entry&&nav.clientHeight){const rect=entry.control.getBoundingClientRect(),bounds=nav.getBoundingClientRect();if(rect.top<bounds.top)nav.scrollTop+=rect.top-bounds.top;else if(rect.bottom>bounds.bottom)nav.scrollTop+=rect.bottom-bounds.bottom;}
  }
  function track() {
    if(disposed||!entries.length)return;
    const line=root.getBoundingClientRect().top+offset()+4;
    let selected=entries[0],nearest=-Infinity;
    for(const entry of entries){const top=entry.target.getBoundingClientRect().top;if(top<=line&&top>=nearest){selected=entry;nearest=top;}}
    if(root.scrollTop>0&&root.scrollTop+root.clientHeight>=root.scrollHeight-2)selected=entries.at(-1);
    mark(selected);
  }
  const schedule=()=>{if(disposed||pending!==null)return;pending=requestAnimationFrame(()=>{pending=null;track();});};
  const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(schedule):null;
  root.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);observer?.observe(paper);
  return {
    update(){
      if(disposed)return;
      const scroll=nav.scrollTop;
      const headings=[...paper.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(heading=>!heading.classList.contains('doc-title')&&heading.textContent.trim());
      const levels=headings.map(heading=>Number(heading.dataset.docHeadingLevel)||Number(heading.tagName.slice(1))),base=Math.min(...levels);
      nav.replaceChildren();current=null;
      entries=headings.map((target,index)=>{
        const control=document.createElement('button');control.type='button';control.className='doc-outline-link';control.textContent=target.textContent.trim();control.title=control.textContent;control.style.paddingLeft=(12+Math.min(4,levels[index]-base)*14)+'px';
        target.id='yuanxing-document-heading-'+index;control.setAttribute('aria-controls',target.id);
        const entry={target,control};
        control.onclick=()=>{const top=target.getBoundingClientRect().top-root.getBoundingClientRect().top+root.scrollTop-offset();root.scrollTo({top:Math.max(0,top),behavior:'instant'});mark(entry);};
        nav.append(control);return entry;
      });
      if(!entries.length){const empty=document.createElement('p');empty.className='doc-outline-empty';empty.textContent='暂无章节标题';nav.append(empty);}
      track();nav.scrollTop=scroll;
    },
    refresh(){current=null;schedule();},
    dispose(){disposed=true;observer?.disconnect();if(pending!==null)cancelAnimationFrame(pending);root.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);}
  };
}

export function createDocumentView(host) {
  const root=host.root,cache=new Map(),bindings=new Set(),drafts=new Map();
  let active=false,signature='',outline,sourceTimer,sourceFlight;
  let outlineOpen=typeof matchMedia!=='function'||!matchMedia('(max-width:700px)').matches;
  const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const fieldChanged=callback=>host.changeText(model=>{ensureDocument(model);callback(model);});
  const titleOf=block=>host.model().nodes.find(node=>node.id===block.node)?.title||'原型页面';
  const reportSourceError=error=>host.notice(error.message,[['重试',()=>flushSources().catch(reportSourceError)]],'save');
  function flushSources(){
    clearTimeout(sourceTimer);if(sourceFlight)return sourceFlight;
    sourceFlight=(async()=>{
      while(drafts.size){
        const [binding,value]=drafts.entries().next().value;
        if(value===binding.before){drafts.delete(binding);continue;}
        const result=await host.saveSource({id:binding.id,key:binding.key,version:binding.version,line:binding.line,column:binding.column,before:binding.before,value});
        for(const item of new Set([...bindings,...drafts.keys()]))if(item.version===result.beforeVersions[item.key]){item.key=result.keyChanges[item.key]||item.key;item.version=result.documentSourceVersions[item.key];}
        binding.before=value;if(drafts.get(binding)===value)drafts.delete(binding);
      }
    })().finally(()=>{sourceFlight=null;if(!active&&!drafts.size)clearView();});return sourceFlight;
  }
  function pasteText(event,editor,inline=false){
    event.preventDefault();let value=event.clipboardData?.getData('text/plain')||'';if(inline)value=value.replace(/[\r\n]+/g,' ');
    const selection=getSelection(),range=selection.rangeCount?selection.getRangeAt(0):document.createRange();
    if(!selection.rangeCount){range.selectNodeContents(editor);range.collapse(false);}
    range.deleteContents();const text=document.createTextNode(value);range.insertNode(text);range.setStartAfter(text);range.collapse(true);selection.removeAllRanges();selection.addRange(range);editor.oninput();
  }
  function editable(editor,oninput,{inline=false}={}){
    if(host.readonly)return;
    editor.contentEditable='true';editor.setAttribute('role','textbox');editor.setAttribute('aria-label','直接编辑文字');editor.setAttribute('aria-multiline',String(!inline));
    editor.oninput=()=>{oninput();outline?.update();};editor.onpaste=event=>pasteText(event,editor,inline);
    if(inline){editor.onbeforeinput=event=>{if(['insertParagraph','insertLineBreak'].includes(event.inputType))event.preventDefault();};editor.onkeydown=event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();editor.blur();}};}
  }
  function textEditor(value,onchange,format='paragraph'){
    const editor=el(format.startsWith('heading')?'h'+(Number(format.at(-1))+1):format==='quote'?'blockquote':'div','doc-text markdown');editor.innerHTML=host.markdown(value);
    if(format.startsWith('heading'))editor.dataset.docHeadingLevel=format.at(-1);
    editable(editor,()=>onchange(host.read(editor)));return editor;
  }
  function sourceBody(block){
    const body=el('div','doc-text markdown doc-source'),key=documentSourceKey(block);body.innerHTML=(host.sourceMarkdown||host.markdown)(host.bundle().documentSources?.[key]||'');
    if(!host.readonly&&host.saveSource)for(const editor of body.querySelectorAll('[data-source-line]')){
      const binding={id:block.id,key,version:host.bundle().documentSourceVersions?.[key],line:Number(editor.dataset.sourceLine),column:editor.dataset.sourceColumn===undefined?undefined:Number(editor.dataset.sourceColumn),before:host.read(editor)};bindings.add(binding);
      editable(editor,()=>{drafts.set(binding,host.read(editor));clearTimeout(sourceTimer);sourceTimer=setTimeout(()=>flushSources().catch(reportSourceError),550);},{inline:true});
      editor.onblur=()=>{if(drafts.has(binding))flushSources().catch(reportSourceError);};
    }
    return body;
  }
  function list(owner,containerId){const box=el('div','doc-block-list');box.dataset.docContainer=containerId;for(const block of owner.blocks)box.append(renderBlock(block));return box;}
  function rowGrid(owners,widths){const grid=el('div','doc-grid');grid.style.gridTemplateColumns=widths.map(width=>width+'fr').join(' ');for(const owner of owners){const cell=el('div','doc-cell');cell.append(list(owner,owner.id));grid.append(cell);}return grid;}
  function renderBlock(block){
    const article=el('section','doc-block doc-'+block.type);article.dataset.docBlock=block.id;
    if(block.type==='text')article.append(textEditor(block.text,value=>fieldChanged(model=>findDocumentBlock(model,block.id).text=value),block.format));
    else if(block.type==='description'){
      if(block.rule)article.append(textEditor(host.model().rules[block.rule],value=>fieldChanged(model=>model.rules[block.rule]=value)));
      else{const target=block.edge?host.model().edges.find(edge=>edge.id===block.edge):host.model().nodes.find(node=>node.id===block.node);if(target)article.append(textEditor(host.explanation(target),value=>fieldChanged(model=>{const owner=block.edge?model.edges.find(edge=>edge.id===block.edge):model.nodes.find(node=>node.id===block.node);if(owner)host.writeExplanation(owner,value);})));}
    }else if(block.type==='source')article.append(sourceBody(block));
    else if(block.type==='image'){const image=el('img','doc-image');image.alt=block.alt||'';image.src=host.bundle().images?.[block.path]||'';article.append(image);}
    else if(block.type==='prototype'){
      const bar=el('div','doc-prototype-bar');bar.append(el('span','',block.title||titleOf(block)));article.append(bar);
      const node=host.model().nodes.find(node=>node.id===block.node),key=JSON.stringify([block.node,block.selector,block.height,host.bundle().sourcesSignature,host.bundle().resources?.[block.node],host.model().edges.filter(edge=>edge.from===block.node)]);
      let cached=cache.get(block.id);if(!cached||cached.key!==key){cached?.dispose?.();const viewport=el('div','doc-prototype-viewport');cached={key,viewport,...(node?host.mountPrototype(node,viewport,block,{resizeFrame:host.readonly?undefined:value=>fieldChanged(model=>{const target=findDocumentBlock(model,block.id);if(target)target.frameScale=value;})}):{})};cache.set(block.id,cached);}
      cached.updateBlock?.(block);
      article.append(cached.viewport);cached.refresh?.();
    }else if(block.type==='columns')article.append(rowGrid(block.columns,block.columns.map(column=>column.width||100/block.columns.length)));
    else if(block.type==='table'){const table=el('div','doc-table-grid');table.setAttribute('role','table');for(const row of block.rows){const line=rowGrid(row.cells,block.widths||row.cells.map(()=>100/row.cells.length));line.setAttribute('role','row');table.append(line);}article.append(table);}
    return article;
  }
  function render(){
    if(!active||drafts.size||sourceFlight)return;
    const model=host.model(),doc=model.document||defaultDocument(model),next=JSON.stringify([doc,model.nodes.map(node=>[node.id,node.title,node.description,node.rule]),model.rules,model.edges,host.bundle().sourcesSignature,host.bundle().documentSourceVersions]);
    if(signature===next)return;signature=next;
    const scroll=root.scrollTop,outlineScroll=root.querySelector('.doc-outline-list')?.scrollTop||0,used=new Set();walkDocument(doc.blocks,block=>used.add(block.id));for(const [id,entry] of cache)if(!used.has(id)){entry.dispose?.();cache.delete(id);}
    outline?.dispose();bindings.clear();root.replaceChildren();
    const sidebar=el('aside','doc-outline'),nav=el('nav','doc-outline-list');sidebar.id='yuanxing-document-outline';sidebar.setAttribute('aria-label','需求文档目录');nav.setAttribute('aria-label','章节定位');sidebar.append(el('div','doc-outline-title','目录'),nav);sidebar.hidden=!outlineOpen;root.classList.toggle('doc-outline-collapsed',!outlineOpen);
    const main=el('div','doc-main'),paper=el('article','doc-paper'),heading=el('h1','doc-title',doc.title||model.title);
    editable(heading,()=>fieldChanged(model=>model.document.title=heading.textContent),{inline:true});
    paper.append(heading,list(doc,'@document'));main.append(paper);root.append(sidebar,main);root.scrollTop=scroll;
    outline=createDocumentOutline({root,paper,nav});outline.update();nav.scrollTop=outlineScroll;
  }
  function clearView(){outline?.dispose();outline=null;bindings.clear();for(const entry of cache.values())entry.dispose?.();cache.clear();root.replaceChildren();signature='';}
  return {render,flush:flushSources,hasPendingChanges:()=>!!drafts.size||!!sourceFlight,isOutlineOpen:()=>outlineOpen,
    toggleOutline(){outlineOpen=!outlineOpen;root.classList.toggle('doc-outline-collapsed',!outlineOpen);const sidebar=root.querySelector('.doc-outline');if(sidebar)sidebar.hidden=!outlineOpen;outline?.refresh();},
    enter(){active=true;if(drafts.size||sourceFlight){outline?.refresh();return;}signature='';render();},leave(){active=false;clearTimeout(sourceTimer);if(drafts.size||sourceFlight){flushSources().catch(reportSourceError);return;}clearView();},
    isBusy(){return !!drafts.size||!!sourceFlight||root.contains(document.activeElement)&&document.activeElement?.matches('[contenteditable],input,select')||[...cache.values()].some(entry=>entry.isBusy?.());}
  };
}
