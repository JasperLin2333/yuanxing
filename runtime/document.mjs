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
export function extractDocumentSource(text,section,omitHeading=false) {
  if (!section) return text;
  const lines=text.split('\n'),headings=[];let fence;
  for(let i=0;i<lines.length;i++){
    const marker=lines[i].match(/^\s{0,3}(`{3,}|~{3,})/);
    if(marker){if(!fence)fence=marker[1][0];else if(fence===marker[1][0])fence=null;continue;}
    const heading=!fence&&lines[i].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if(heading)headings.push({line:i,level:heading[1].length,title:heading[2]});
  }
  const matches=headings.filter(h=>h.title===section);
  if(matches.length!==1)throw new Error(matches.length?'需求正文标题重复：'+section:'需求正文标题不存在：'+section);
  const start=matches[0],end=headings.find(h=>h.line>start.line&&h.level<=start.level)?.line??lines.length;
  return lines.slice(start.line+(omitHeading?1:0),end).join('\n').trim();
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

export function createDocumentView(host) {
  const root = host.root, cache = new Map();
  let selectedEditor, dragged, active = false, signature = '', resizing = false;
  const el = (tag,className,text) => { const node=document.createElement(tag); if(className)node.className=className; if(text!==undefined)node.textContent=text; return node; };
  const button = (label,run,className='') => { const node=el('button',className,label); node.type='button'; node.onclick=run; return node; };
  const changed = callback => host.change(model => { ensureDocument(model); callback(model); });
  const fieldChanged = callback => host.changeText(model => { ensureDocument(model); callback(model); });
  const protoNodes = () => host.model().nodes.filter(n => n.kind !== 'note' && (n.overview !== false || n.canvas === false));
  const titleOf = block => host.model().nodes.find(n => n.id === block.node)?.title || '原型页面';
  function insert(type,containerId,beforeId) {
    if (type === 'image') { pickImages(containerId,beforeId); return; }
    changed(model => {
      const owner=documentContainer(model,containerId),block=newDocumentBlock(type,protoNodes()[0]?.id);
      if (block.type === 'prototype' && !block.node) { host.notice('请先添加一个原型页面。'); return; }
      const index=beforeId?owner.blocks.findIndex(v=>v.id===beforeId):owner.blocks.length;
      owner.blocks.splice(index<0?owner.blocks.length:index,0,block);
    });
  }
  async function appendImages(files,containerId,beforeId) {
    try{for(const file of files){const image=await host.upload(file);changed(model=>{const owner=documentContainer(model,containerId)||ensureDocument(model);const block={id:docId('image'),type:'image',path:image.path,alt:file.name};const index=beforeId?owner.blocks.findIndex(v=>v.id===beforeId):-1;owner.blocks.splice(index<0?owner.blocks.length:index,0,block);});}}catch(error){host.notice(error.message);}
  }
  function pickImages(containerId,beforeId) {
    const input=el('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';input.multiple=true;
    input.onchange=()=>appendImages(input.files,containerId,beforeId);input.click();
  }
  root.addEventListener('dragover',event=>{if(!host.readonly&&event.dataTransfer.types.includes('Files'))event.preventDefault();});
  root.addEventListener('drop',event=>{if(!event.dataTransfer.files.length)return;event.preventDefault();event.stopPropagation();if(!host.readonly)appendImages(event.dataTransfer.files,event.target.closest('[data-doc-container]')?.dataset.docContainer||'@document');});
  function addControl(containerId,beforeId) {
    const select=el('select','doc-insert');select.setAttribute('aria-label','插入文档内容');
    for(const [value,label] of [['','＋ 插入'],['text','正文'],['heading','标题'],['columns','分栏'],['table','表格'],['image','图片']]){const option=el('option','',label);option.value=value;select.append(option);}
    select.onchange=()=>{if(select.value)insert(select.value,containerId,beforeId);select.value='';};return select;
  }
  function textEditor(value,onchange,format='paragraph',placeholder='输入需求说明…') {
    const editor=el(format.startsWith('heading')?'h'+(Number(format.at(-1))+1):format==='quote'?'blockquote':'div','doc-text markdown');
    editor.innerHTML=host.markdown(value);editor.dataset.placeholder=placeholder;
    if(!host.readonly){editor.contentEditable='true';editor.setAttribute('role','textbox');editor.setAttribute('aria-label',placeholder);editor.setAttribute('aria-multiline','true');editor.onfocus=()=>selectedEditor=editor;
      editor.oninput=()=>onchange(host.read(editor));
      editor.onpaste=event=>{
        event.preventDefault();const files=[...(event.clipboardData?.files||[])].filter(file=>file.type.startsWith('image/'));
        if(files.length){const range=editorSelection(editor),marker=el('span','image-uploading','图片上传中…');marker.contentEditable='false';marker.dataset.uploadPending='true';range.deleteContents();range.insertNode(marker);editor.contentEditable='false';
          (async()=>{try{const images=[];for(const file of files)images.push(await host.upload(file));if(!editor.isConnected)return;const fragment=document.createDocumentFragment();for(const image of images){const img=el('img');img.src=image.src;img.dataset.assetPath=image.path;img.alt='需求图片';fragment.append(img,el('br'));}marker.replaceWith(fragment);editor.oninput();}catch(error){marker.remove();host.notice(error.message);}finally{editor.contentEditable='true';}})();
        }else{const range=editorSelection(editor),text=document.createTextNode(event.clipboardData?.getData('text/plain')||'');range.deleteContents();range.insertNode(text);range.setStartAfter(text);range.collapse(true);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);editor.oninput();}
      };
    }
    return editor;
  }
  function editorSelection(editor){const selection=getSelection();if(selection.rangeCount&&editor.contains(selection.getRangeAt(0).commonAncestorContainer))return selection.getRangeAt(0).cloneRange();const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);return range;}
  function moveAdjacent(id,direction) {
    changed(model=>{const found=docLocate(model,id);if(!found)return;const to=found.index+direction;if(to<0||to>=found.owner.blocks.length)return;found.owner.blocks.splice(found.index,1);found.owner.blocks.splice(to,0,found.block);});
  }
  function duplicate(id){changed(model=>{const found=docLocate(model,id);if(!found)return;const copy=docCopy(found.block);const reset=block=>{block.id=docId('block');if(block.type==='columns')block.columns.forEach(c=>c.id=docId('column'));if(block.type==='table')block.rows.forEach(r=>{r.id=docId('row');r.cells.forEach(c=>c.id=docId('cell'));});};walkDocument([copy],reset);found.owner.blocks.splice(found.index+1,0,copy);});}
  function tools(block,containerId) {
    const bar=el('div','doc-block-tools');
    const grip=button('⠿',()=>{},'doc-grip');grip.title='拖动内容';grip.setAttribute('aria-label','拖动内容');grip.draggable=true;
    grip.ondragstart=event=>{dragged=block.id;event.dataTransfer.setData('application/x-yuanxing-document',block.id);event.dataTransfer.effectAllowed='move';event.stopPropagation();};grip.ondragend=()=>{dragged=null;root.querySelectorAll('.doc-drop-target').forEach(v=>v.classList.remove('doc-drop-target'));};bar.append(grip,addControl(containerId,block.id));
    const menu=el('details','doc-block-menu'),summary=el('summary','','⋯');summary.setAttribute('aria-label','内容操作');menu.append(summary);
    const actions=el('div','doc-block-actions');actions.append(button('上移',()=>moveAdjacent(block.id,-1)),button('下移',()=>moveAdjacent(block.id,1)),button('复制',()=>duplicate(block.id)),button('删除',()=>changed(model=>removeDocumentBlock(model,block.id))));menu.append(actions);bar.append(menu);return bar;
  }
  function list(owner,containerId,depth=0) {
    const box=el('div','doc-block-list');box.dataset.docContainer=containerId;
    box.ondragover=event=>{if(!dragged)return;event.preventDefault();event.stopPropagation();};
    box.ondrop=event=>{if(!dragged)return;event.preventDefault();event.stopPropagation();const before=event.target.closest('.doc-block')?.dataset.docBlock;changed(model=>moveDocumentBlock(model,dragged,containerId,owner.blocks.some(b=>b.id===before)?before:undefined));dragged=null;};
    for(const block of owner.blocks)box.append(renderBlock(block,containerId,depth));
    if(!host.readonly)box.append(addControl(containerId));
    return box;
  }
  function resizeColumns(event,block,index,grid,widths) {
    if(host.readonly||event.button!==0)return;event.preventDefault();event.stopPropagation();resizing=true;
    const initial=widths.slice(),sum=initial.reduce((a,b)=>a+b,0),rect=grid.getBoundingClientRect(),start=event.clientX;
    const move=e=>{if(e.pointerId!==event.pointerId)return;const delta=(e.clientX-start)/rect.width*sum,pair=initial[index]+initial[index+1],left=Math.min(pair-sum*.1,Math.max(sum*.1,initial[index]+delta));const next=initial.slice();next[index]=left;next[index+1]=pair-left;grid.style.gridTemplateColumns=next.map(n=>n+'fr').join(' ');
      fieldChanged(model=>{const target=findDocumentBlock(model,block.id);if(target.type==='columns')target.columns.forEach((column,i)=>column.width=next[i]);else target.widths=next;});};
    const end=e=>{if(e&&e.pointerId!==event.pointerId)return;document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',end);document.removeEventListener('pointercancel',end);resizing=false;signature='';render();};document.addEventListener('pointermove',move);document.addEventListener('pointerup',end);document.addEventListener('pointercancel',end);
  }
  function rowGrid(block,owners,widths,depth) {
    const grid=el('div','doc-grid');grid.style.gridTemplateColumns=widths.map(n=>n+'fr').join(' ');
    owners.forEach((owner,index)=>{const cell=el('div','doc-cell');cell.append(list(owner,owner.id,depth+1));if(!host.readonly&&index<owners.length-1){const handle=el('div','doc-column-resizer');handle.setAttribute('role','separator');handle.setAttribute('aria-label','调整列宽');handle.setAttribute('aria-orientation','vertical');handle.tabIndex=0;handle.onpointerdown=event=>resizeColumns(event,block,index,grid,widths);handle.onkeydown=event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const next=widths.slice(),amount=event.key==='ArrowLeft'?-2:2;if(next[index]+amount<10||next[index+1]-amount<10)return;changed(model=>{const target=findDocumentBlock(model,block.id);if(target.type==='columns'){target.columns[index].width+=amount;target.columns[index+1].width-=amount;}else{next[index]+=amount;next[index+1]-=amount;target.widths=next;}});};cell.append(handle);}grid.append(cell);});return grid;
  }
  function renderBlock(block,containerId,depth) {
    const article=el('section','doc-block doc-'+block.type);article.dataset.docBlock=block.id;
    if(!host.readonly)article.append(tools(block,containerId));
    if(block.type==='text') {
      if(!host.readonly){const format=el('select','doc-format');format.setAttribute('aria-label','正文样式');for(const [value,label] of [['paragraph','正文'],['heading1','一级标题'],['heading2','二级标题'],['heading3','三级标题'],['quote','引用']]){const option=el('option','',label);option.value=value;format.append(option);}format.value=block.format||'paragraph';format.onchange=()=>changed(model=>findDocumentBlock(model,block.id).format=format.value);article.append(format);}
      article.append(textEditor(block.text,value=>fieldChanged(model=>findDocumentBlock(model,block.id).text=value),block.format));
    } else if(block.type==='description') {
      if(block.rule){const body=el('div','doc-text markdown');body.innerHTML=host.markdown(host.model().rules[block.rule]);article.append(body);return article;}
      const target=block.edge?host.model().edges.find(e=>e.id===block.edge):host.model().nodes.find(n=>n.id===block.node);
      if(target)article.append(textEditor(host.explanation(target),value=>fieldChanged(model=>{const owner=block.edge?model.edges.find(e=>e.id===block.edge):model.nodes.find(n=>n.id===block.node);if(owner)host.writeExplanation(owner,value);}), 'paragraph','输入详细需求说明…'));
    } else if(block.type==='source') {
      const body=el('div','doc-text markdown doc-source');body.innerHTML=host.markdown(host.bundle().documentSources?.[documentSourceKey(block)]||'');article.append(body);
    } else if(block.type==='image') {
      const image=el('img','doc-image');image.alt=block.alt||'';image.src=host.bundle().images?.[block.path]||'';article.append(image);
    } else if(block.type==='prototype') {
      const bar=el('div','doc-prototype-bar');
      bar.append(el('span','',block.title||titleOf(block)));
      article.append(bar);
      const node=host.model().nodes.find(n=>n.id===block.node),key=JSON.stringify([block.node,block.selector,block.height,host.bundle().sourcesSignature,host.bundle().resources?.[block.node],host.model().edges.filter(e=>e.from===block.node)]);
      let cached=cache.get(block.id);
      if(!cached||cached.key!==key){cached?.dispose?.();const viewport=el('div','doc-prototype-viewport');cached={key,viewport,...(node?host.mountPrototype(node,viewport,block):{})};cache.set(block.id,cached);}
      article.append(cached.viewport);
    } else if(block.type==='columns') {
      article.append(rowGrid(block,block.columns,block.columns.map(c=>c.width||100/block.columns.length),depth));
    } else if(block.type==='table') {
      const table=el('div','doc-table-grid');table.setAttribute('role','table');
      for(const row of block.rows){const line=rowGrid(block,row.cells,block.widths||row.cells.map(()=>100/row.cells.length),depth);line.setAttribute('role','row');table.append(line);}
      if(!host.readonly){const controls=el('div','doc-table-tools');controls.append(button('＋ 行',()=>changed(model=>{const target=findDocumentBlock(model,block.id);target.rows.push({id:docId('row'),cells:target.rows[0].cells.map(()=>({id:docId('cell'),blocks:[newDocumentBlock('text')]}))});})),button('＋ 列',()=>changed(model=>{const target=findDocumentBlock(model,block.id);target.rows.forEach(row=>row.cells.push({id:docId('cell'),blocks:[newDocumentBlock('text')]}));target.widths=target.rows[0].cells.map(()=>100/target.rows[0].cells.length);})),button('删除末行',()=>changed(model=>{const target=findDocumentBlock(model,block.id);if(target.rows.length>1)target.rows.pop();})),button('删除末列',()=>changed(model=>{const target=findDocumentBlock(model,block.id);if(target.rows[0].cells.length>1){target.rows.forEach(row=>row.cells.pop());target.widths=target.rows[0].cells.map(()=>100/target.rows[0].cells.length);}})));table.append(controls);}article.append(table);
    }
    return article;
  }
  function render() {
    if(!active)return;
    const model=host.model(),doc=model.document||defaultDocument(model),next=JSON.stringify([doc,model.nodes.map(n=>[n.id,n.title,n.description,n.rule]),model.rules,model.edges,host.bundle().sourcesSignature]);
    if(signature===next)return;signature=next;
    const scroll=root.scrollTop,used=new Set();walkDocument(doc.blocks,block=>used.add(block.id));for(const [id,entry] of cache)if(!used.has(id)){entry.dispose?.();cache.delete(id);}
    root.replaceChildren();
    const toolbar=el('div','doc-toolbar');
    if(!host.readonly){toolbar.append(addControl('@document'));for(const [label,command] of [['加粗','bold'],['斜体','italic'],['项目符号','insertUnorderedList'],['编号列表','insertOrderedList']]){const control=button(label,()=>{if(selectedEditor?.isConnected){selectedEditor.focus();document.execCommand(command);selectedEditor.oninput();}});control.onmousedown=event=>event.preventDefault();toolbar.append(control);}}
    const paper=el('article','doc-paper'),heading=el('h1','doc-title',doc.title||model.title);
    if(!host.readonly){heading.contentEditable='true';heading.setAttribute('aria-label','需求文档标题');heading.oninput=()=>fieldChanged(model=>model.document.title=heading.textContent);heading.onpaste=event=>{event.preventDefault();document.execCommand('insertText',false,event.clipboardData?.getData('text/plain')||'');};}
    paper.append(heading,list(doc,'@document'));root.append(toolbar,paper);root.scrollTop=scroll;
  }
  return {render,enter(){active=true;signature='';render();},leave(){active=false;for(const entry of cache.values())entry.dispose?.();cache.clear();root.replaceChildren();signature='';},isBusy(){return resizing||root.contains(document.activeElement)&&document.activeElement?.matches('[contenteditable],input,select')||[...cache.values()].some(entry=>entry.isBusy?.());}};
}
