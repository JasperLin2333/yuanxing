// 分享文件仅保留查看能力。对编辑器源码做显式裁剪；源码结构变化时停止导出，避免悄悄带入编辑功能。
function replaceExact(source,from,to='',expected=1){
  const count=source.split(from).length-1;
  if(count!==expected)throw new Error(`离线代码裁剪失配（预期 ${expected} 处，实际 ${count} 处）：${from.slice(0,90)}`);
  return source.split(from).join(to);
}
function removeSection(source,begin,end){
  const start=source.indexOf(begin),stop=source.indexOf(end,start+begin.length);
  if(start<0||stop<0||source.indexOf(begin,start+1)>=0)throw new Error('离线代码裁剪区间失配：'+begin);
  return source.slice(0,start)+source.slice(stop);
}
function apply(source,changes){for(const change of changes)source=replaceExact(source,...change);return source;}
export function offlineCore(source){
  source=removeSection(source,'export function recycleNodes(model){','export function exportSubset(model, moduleId) {');
  source=apply(source,[
    ['(model,moduleId,ids,{recycle=false}={})','(model,moduleId,ids)',2],
    ['(model,moduleId,clipboard,point=[80,80],{recycle=false}={})','(model,moduleId,clipboard,point=[80,80])'],
    ['(recycle?recycleCanvasNodes(model):moduleNodes(model,moduleId))','moduleNodes(model,moduleId)'],
    ['hidden=recycle?[]:model.nodes','hidden=model.nodes'],
    ['if(recycle){delete edge.waypoints;delete edge.labelPosition;}else{if(edge.waypoints)edge.waypoints=edge.waypoints.map(shift);if(edge.labelPosition)edge.labelPosition=shift(edge.labelPosition);}','if(edge.waypoints)edge.waypoints=edge.waypoints.map(shift);if(edge.labelPosition)edge.labelPosition=shift(edge.labelPosition);'],
    ['if(recycle){delete copy.overview;delete copy.overviewAlias;}else if(copy.overviewAlias','if(copy.overviewAlias'],
    ['copyCanvasSelection(model,moduleId,ids,{recycle})','copyCanvasSelection(model,moduleId,ids)'],
    ['if(recycle)removeNodes(model,removed);else removeCanvasNodes(model,moduleId,removed);','removeCanvasNodes(model,moduleId,removed);'],
    ['  if(recycle)moveRecycleNodes(model,[]);\n',''],
    ['moveRecycleNodes(model,[]);',''],
    ['module:recycle&&model.modules.some(m=>m.id===n.module)?n.module:moduleId','module:moduleId'],
    ['    if(recycle){next.overview=false;delete next.overviewAlias;model.recyclePositions??={};model.recyclePositions[next.id]={x:next.x,y:next.y};}\n',''],
    ["  if(model.recyclePositions!==undefined&&(model.recyclePositions===null||typeof model.recyclePositions!=='object'||Array.isArray(model.recyclePositions)||Object.entries(model.recyclePositions).some(([id,p])=>!ids.has(id)||!p||![p.x,p.y].every(Number.isFinite))))errors.push('回收站画布位置不正确');\n",''],
    ['  for(const id of removed)if(model.recyclePositions)delete model.recyclePositions[id];\n',''],
    ['if(model.recyclePositions)delete model.recyclePositions[id];',''],
    ['  if(result.recyclePositions)result.recyclePositions=Object.fromEntries(Object.entries(result.recyclePositions).filter(([id])=>keep.has(id)));\n','']
  ]);
  return assertNoEditorCode(source,'core');
}
export function offlineLibrary(source){
  source=apply(source,[
    [',getRecycleOpen,openRecycle,',','],
    ['&&!getRecycleOpen?.()',''],
    ["    if(openRecycle){const footer=libraryElement('div','library-sidebar-footer'),button=libraryButton(undefined,openRecycle,`library-recycle ${getRecycleOpen?.()?'active':''}`),count=recycleNodes(model()).length;button.title='回收站：查看未显示在画布上的内容';button.append(libraryIcon('delete'),libraryElement('span','','回收站'),libraryElement('span','library-recycle-count',String(count)));footer.append(button);nav.append(footer);}\n",'']
  ]);
  source=source.replace(/^.*library-recycle.*\n/gm,'');
  return assertNoEditorCode(source,'library');
}
export function offlineApp(source){
  source=apply(source,[
    ['nodeOpenAfter=0,recycleOpen=false,sourceRefreshFlight=false','nodeOpenAfter=0,sourceRefreshFlight=false'],
    [',getRecycleOpen:()=>recycleOpen,openRecycle,',','],
    ["const recycleCameraKey='@recycle';\n",''],
    ['recycleOpen?recycleCanvasNodes(model):moduleNodes(model,moduleId)','moduleNodes(model,moduleId)'],
    ['recycleOpen?recycleCameraKey:moduleId','moduleId'],
    ['recycleOpen?moveRecycleNodes(m,positions):moveCanvasNodes(m,moduleId,positions)','moveCanvasNodes(m,moduleId,positions)'],
    ['moveRecycleNodes(m,[]);if(recycleOpen)removeNodes(m,ids);else removeCanvasNodes(m,moduleId,ids);','removeCanvasNodes(m,moduleId,ids);'],
    ['recycleOpen?[]:ids.filter','ids.filter'],
    ['current:recycleOpen?null:current,camera:recycleOpen?cameras[moduleId]||{x:30,y:30,scale:.8}:camera','current,camera'],
    ["recycleOpen?'回收站':model.modules.find(m=>m.id===moduleId)?.title||''","model.modules.find(m=>m.id===moduleId)?.title||''"],
    ["function openRecycle(){activeCanvasGesture?.();cancelConnection?.();closeAnnotationEditor();saveCanvasCamera();current=null;selected=null;mode=null;recycleOpen=true;camera=clone(cameras[recycleCameraKey]||{x:30,y:30,scale:.55});renderAll();$('#canvas-viewport').focus({preventScroll:true});}\n",''],
    [',{recycle:recycleOpen}','',3],
    ['recycleOpen||m.nodes.find','m.nodes.find'],
    ["card.classList.toggle('node-recycled',recycleOpen);",''],
    ['recycleOpen?`<span class="ref-label">${esc(model.modules.find(m=>m.id===n.module)?.title||\'\')}</span>`:n.reference','n.reference'],
    ['recycleOpen?[]:canvasSections(model,moduleId)','canvasSections(model,moduleId)',2],
    ["if(recycleOpen){if(svg.childNodes.length)svg.replaceChildren();lastLinesSignature=null;return;}",''],
    ['moduleId,recycleOpen,camera:','moduleId,camera:'],
    ['recycleOpen=experienceReturn.recycleOpen;',''],
    ["  if(!selected&&recycleOpen){h.textContent='回收站';pane.insertAdjacentHTML('beforeend','<p class=\"hint\">选中内容后可复制或剪切，再到模块画布粘贴。</p>');return;}\n",''],
    ["$('#recycle-empty').hidden=true;",''],
    ["$('#recycle-empty').hidden=!recycleOpen||!!current||!!recycleNodes(model).length;",''],
    ["recycleOpen?'回收站画布':'模块概览画布'","'模块概览画布'"],
    ["recycleOpen?'← 返回回收站':'← 返回概览'","'← 返回概览'"],
    ['if(!recycleOpen){event.preventDefault();if(node(current)?.kind===\'note\')pasteDescriptionImages(images,current);else{insertPoint=null;upload(images);}}',"event.preventDefault();if(node(current)?.kind==='note')pasteDescriptionImages(images,current);else{insertPoint=null;upload(images);}"],
    ['&&!(recycleOpen&&!current)','',2],
    ['if(recycleOpen)moveRecycleNodes(m,activeCanvasNodes().filter(n=>selectedNodeIds().includes(n.id)).map(n=>({id:n.id,x:n.x+delta[0],y:n.y+delta[1]})));else nudgeCanvasNodes(m,moduleId,selectedNodeIds(),...delta);','nudgeCanvasNodes(m,moduleId,selectedNodeIds(),...delta);'],
    [',linesHidden,recycleOpen,view:',',linesHidden,view:'],
    ['recycleOpen=saved.recycleOpen;',''],
    ['if(!recycleOpen)camera=','camera='],
    ['!recycleOpen&&',''],
    ['&&!recycleOpen',''],
    ['||recycleOpen','',7],
    ['recycleOpen=false;','',4]
  ]);
  return assertNoEditorCode(source,'app');
}
export function offlineStyles(source){
  source=apply(source,[["/* 回收站复用模块画布。 */\n",''],["#recycle-empty{position:absolute;top:45%;left:0;right:0;margin:0;color:var(--muted);text-align:center;pointer-events:none}\n",''],[".node-recycled .ref-label{max-width:132px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n",'']]);
  return assertNoEditorCode(source,'style');
}
export function offlineIndex(source){return assertNoEditorCode(replaceExact(source,'<p id="recycle-empty" hidden>暂无未显示的内容</p>'), 'index');}
export function offlinePlayer(source){return assertNoEditorCode(replaceExact(source,'// 缩略预览分帧挂载，取消离屏任务，不让回收站同时创建大量 iframe。','// 缩略预览分帧挂载，并取消离屏任务。'),'player');}
function assertNoEditorCode(source,name){if(/recycl|回收站/i.test(source))throw new Error('离线代码仍包含回收站实现：'+name);return source;}
