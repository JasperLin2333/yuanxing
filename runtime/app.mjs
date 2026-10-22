import {handoffAncestors,handoffClean,collectHandoff,handoffDocument,handoffPrompt,createDOMPicker} from './handoff.mjs';
import {clone,uid,escapeHTML as esc,validate,moduleNodes,orderedModuleNodes,canvasSections,overviewEdges,removeConnections,removeNodes,removeCanvasNodes,reconnectEdge,createLineBranch,lineBranchSplit,connectNodes,nodesInRect,canvasSelection,snapNodeGroup,moveCanvasNodes,routeConnections,placeConnectionLabels,isBranch,History,markdown,expandHTML,readDescription,eligibleEdges,nextContext,connectionSides,connectionPoint,connectionPath,connectionDirections,adjustConnectionSegment,canvasNodeWidth,canvasNodeHeight,canvasNodeType,thumbnailLayout,wheelZoomFactor,zoomCamera,restoreView,mergeProject,recycleNodes,recycleCanvasNodes,moveRecycleNodes,cutCanvasSelection,imagePasteTarget,replaceCanvasImage,canvasClipboardAssets,canvasPreviewSignature} from './core.mjs';
import {requirementText,canvasExplanation,writeCanvasExplanation,connectionTarget,previewConnection,connectionDisplayPath,alignCanvasNodes,distributeCanvasNodes,nudgeCanvasNodes,copyCanvasSelection,pasteCanvasSelection} from './core.mjs';
import {createLibrary,libraryStyles,reconcileCanvasCards} from './library.mjs';
import {prototypeDocument,thumbnailHTML,flowEntries,cleanContext,createPreviewQueue,bindNativeDocument} from './player.mjs';
import {createProjectExtension} from './extension.mjs';
import {createDocumentView} from './document.mjs';
import {mountDocumentPrototype} from './document-player.mjs';
const $=s=>document.querySelector(s), boot=globalThis.YUANXING_BOOT||{};
const apiBase=boot.basePath||'';
let baseModel,conflictData=null,pendingRuntimeVersion=null,loadedRuntimeVersion=boot.runtimeVersion;
let bundle,model,revision,token=boot.token,readonly=!!boot.readonly,dirty=false,saving=false,conflict=false,timer,saveFlight=null;
let moduleId,selected=null,current=null,mode=null,linkCaptureTarget=null,replaceImage=null,pendingImageReplacement=null;
let insertPoint=null,cancelConnection=null,exporting=false,exportCloseTimer,noticeTimer=null;
let flowContext={},spacePressed=false,activeCanvasGesture=null;
let flowClipboard=null,pasteCount=0,gestureFrame=null,lineFrame=null,lastLinesSignature=null,lastSectionsSignature=null,lineTextContext=null;
let nodeOpenAfter=0,recycleOpen=false,sourceRefreshFlight=false;
const canvasPreviews=new WeakMap();
let previewObserver=null;
const previewQueue=createPreviewQueue({request:callback=>requestAnimationFrame(callback),cancel:id=>cancelAnimationFrame(id)});
function stopPreviews(){previewObserver?.disconnect();previewObserver=null;previewQueue.clear();}
function updatePreview(card,n){
  if(!card.isConnected||current)return;
  const signature=canvasPreviewSignature(n,bundle);
  if(canvasPreviews.get(card)!==signature){card.querySelector('.node-thumb')?.remove();if(!isBranch(n)){const thumb=document.createElement('div');thumb.className='node-thumb';frameFor(n,thumb,400/n.width);card.append(thumb);}canvasPreviews.set(card,signature);}
  else{const frame=card.querySelector('iframe'),image=card.querySelector('.node-thumb>img');if(frame)frame.title=n.title;if(image)image.alt=n.title;}
}
function observePreviews(nodes){
  const byId=new Map(nodes.map(n=>[n.id,n]));
  if(typeof IntersectionObserver==='undefined'){for(const card of $('#nodes').children)previewQueue.add(card,()=>updatePreview(card,byId.get(card.dataset.id)));return;}
  previewObserver=new IntersectionObserver(entries=>{for(const entry of entries){const card=entry.target,n=byId.get(card.dataset.id);if(!n)continue;if(entry.isIntersecting)previewQueue.add(card,()=>updatePreview(card,n));else{previewQueue.remove(card);card.querySelector('.node-thumb')?.remove();canvasPreviews.delete(card);}}},{root:$('#canvas-viewport'),rootMargin:'240px'});
  for(const card of $('#nodes').children)previewObserver.observe(card);
}
let devMode=false,devPicker=null,devElement=null,devSnapshot=null,devOriginal=null;
let annotationEditor=null,annotationEditorId=null,annotationEditorNew=false;
let linesHidden=false,viewReady=false,viewTimer;
let zoomSensitivity=3.5;try{const saved=Number(localStorage.getItem('yuanxing-zoom-sensitivity'));if(saved>=.5&&saved<=6)zoomSensitivity=Math.round(saved*10)/10;}catch{}
let camera={x:30,y:30,scale:0.8},pageScale=1,noteFit=true,cameras={},positions={},frames={},missing=new Set(),inputGroup=null;
const history=new History();
let experience=boot.view==='prototype',activeFlow=null,experienceReturn=null;
let documentMode=boot.view==='document',documentFrameScope=null;
let imagePreviewStack=[];
const originalReadonly=readonly;
const projectExtension=createProjectExtension({getState:()=>documentFrameScope||({model,frames,current,mode,pageScale,experience,n:node(current)}),node,openNode,measure,visibleRect,renderOverlays,renderInspector,download,exitExperience});
document.body.classList.toggle('declarative-pages',!!projectExtension?.declarative);
const library=createLibrary({getModel:()=>model,getModule:()=>moduleId,getCurrent:()=>current,getSelected:()=>selected,getRecycleOpen:()=>recycleOpen,openRecycle,readonly,locateNode,selectModule,addModule,removeModule,moveModule});
const libraryStyle=document.createElement('style');libraryStyle.textContent=libraryStyles+(projectExtension?.styles||'');document.head.append(libraryStyle);
installControlTooltips();
const pendingImages=new Set(),pendingDescriptionNodes=new Set(),richText=text=>markdown(text,bundle?.images||{});
const documentView=createDocumentView({root:$('#document-view'),model:()=>model,bundle:()=>bundle,readonly:originalReadonly,change:fn=>edit(fn),changeText:fn=>editField(fn),markdown:richText,read:readDescription,explanation:explanationText,writeExplanation,notice,
  async upload(file){const job=uploadImage(file);pendingImages.add(job);try{const image=await job;bundle.images??={};bundle.images[image.path]=image.src;return image;}finally{pendingImages.delete(job);}},
  mountPrototype:(n,viewport,block)=>mountDocumentPrototype({model:()=>model,bundle:()=>bundle,extension:projectExtension,scope(state,fn){const previous=documentFrameScope;documentFrameScope=state;try{return fn();}finally{documentFrameScope=previous;}}},n,viewport,block)
});
function openDocument(){if(documentMode)return;if(experience)exitExperience();if(devMode)toggleDeveloperMode(false);closeAnnotationEditor();cancelConnection?.();saveCanvasCamera();stopPreviews();$('#nodes').replaceChildren();$('#page-stage').replaceChildren();frames={};documentMode=true;documentView.enter();renderAll();}
let panels={sidebar:true,inspector:!matchMedia('(max-width:720px)').matches};
try{const saved=JSON.parse(localStorage.getItem('yuanxing-panels')||'null');if(saved)for(const key of Object.keys(panels))if(typeof saved[key]==='boolean')panels[key]=saved[key];}catch{/* 文件分享页可能禁用本地偏好存储。 */}
function renderPanels(){
  const layout=$('.layout');for(const [key,open] of Object.entries(panels)){layout.classList.toggle(`${key}-collapsed`,!open);$('#'+key).hidden=!open;const button=document.querySelector(`[data-action="panel-${key}"]`),label=(open?'收起':'展开')+(key==='sidebar'?'模块目录':'页面说明');button.setAttribute('aria-expanded',String(open));button.setAttribute('aria-label',label);button.title=label;}
}
function togglePanel(key){if(panels[key]&&$('#'+key).contains(document.activeElement))document.querySelector(`[data-action="panel-${key}"]`).focus();panels[key]=!panels[key];renderPanels();try{localStorage.setItem('yuanxing-panels',JSON.stringify(panels));}catch{}resizePage();}
function installControlTooltips(){
  const tip=document.createElement('div');tip.id='control-tooltip';tip.className='control-tooltip';tip.setAttribute('role','tooltip');tip.hidden=true;document.body.append(tip);let target=null,timer=null,nativeTitle=null;
  const hide=()=>{clearTimeout(timer);tip.hidden=true;if(target){if(nativeTitle!==null&&!target.hasAttribute('title'))target.setAttribute('title',nativeTitle);const refs=(target.getAttribute('aria-describedby')||'').split(/\s+/).filter(id=>id&&id!==tip.id);if(refs.length)target.setAttribute('aria-describedby',refs.join(' '));else target.removeAttribute('aria-describedby');}target=null;nativeTitle=null;};
  document.addEventListener('pointerover',event=>{const button=event.target.closest('button,summary,select');if(button===target)return;hide();if(!button)return;const label=(button.getAttribute('title')||button.getAttribute('aria-label')||button.querySelector('span')?.textContent||button.textContent||'').replace(/\s+/g,' ').trim();if(!label)return;target=button;nativeTitle=button.getAttribute('title');button.removeAttribute('title');timer=setTimeout(()=>{if(!target?.isConnected){hide();return;}const layer=target.closest('dialog[open]')||document.body;if(tip.parentNode!==layer)layer.append(tip);tip.textContent=label;tip.hidden=false;const r=target.getBoundingClientRect(),width=tip.offsetWidth,height=tip.offsetHeight;tip.style.left=Math.max(8,Math.min(innerWidth-width-8,r.left+(r.width-width)/2))+'px';tip.style.top=Math.max(8,r.bottom+height+12<innerHeight?r.bottom+8:r.top-height-8)+'px';const refs=new Set((target.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean));refs.add(tip.id);target.setAttribute('aria-describedby',[...refs].join(' '));},280);},true);
  document.addEventListener('pointerout',event=>{if(target&&!target.contains(event.relatedTarget))hide();},true);
  document.addEventListener('pointerdown',hide,true);document.addEventListener('keydown',hide,true);document.addEventListener('scroll',hide,true);window.addEventListener('blur',hide);
}
function node(id){return model.nodes.find(n=>n.id===id);} function outgoing(id){const edges=model.edges.filter(e=>e.from===id&&!e.diagram),doc=current===id&&frames[id]?.isConnected?frames[id].contentDocument:null;return doc&&projectExtension?.outgoing?projectExtension.outgoing(edges,doc,id):edges;}
function nodeResource(n){return n.kind==='image'?bundle.images?.[n.path]||bundle.resources[n.id]:bundle.resources[n.id];}
const recycleCameraKey='@recycle';
function activeCanvasNodes(){return recycleOpen?recycleCanvasNodes(model):moduleNodes(model,moduleId);}
function activeCameraKey(){return recycleOpen?recycleCameraKey:moduleId;}
function saveCanvasCamera(){cameras[activeCameraKey()]=clone(camera);}
function moveActiveNodes(m,positions){return recycleOpen?moveRecycleNodes(m,positions):moveCanvasNodes(m,moduleId,positions);}
function selectedNodeIds(){return selected?.type==='nodes'?selected.ids:selected?.type==='node'?[selected.id]:[];}
function selectNodes(ids){
  const visible=new Set(activeCanvasNodes().map(n=>n.id));ids=[...new Set(ids)].filter(id=>visible.has(id));
  const before=selectedNodeIds();if((selected?.type==='node'||selected?.type==='nodes'||!selected)&&before.length===ids.length&&before.every((id,i)=>id===ids[i]))return;
  selected=ids.length>1?{type:'nodes',ids}:ids.length?{type:'node',id:ids[0]}:null;
  sidebar();renderInspector();highlightCards();drawLines();
}
function selectCanvasNode(event,n,card){
  if(spacePressed||event.button===1)return;if(event.button!==0)return;$('#canvas-viewport').focus({preventScroll:true});
  const ids=[n.id];
  if(event.shiftKey&&!readonly){event.preventDefault();event.stopPropagation();const before=selectedNodeIds(),remove=ids.every(id=>before.includes(id));selectNodes(remove?before.filter(id=>!ids.includes(id)):[...before,...ids]);return;}
  if(!selectedNodeIds().includes(n.id))selectNodes(ids);dragNode(event,n,card);
}
function deleteSelectedNodes(ids=selectedNodeIds()){
  if(readonly||!ids.length)return;activeCanvasGesture?.();closeAnnotationEditor();
  edit(m=>{moveRecycleNodes(m,[]);if(recycleOpen)removeNodes(m,ids);else removeCanvasNodes(m,moduleId,ids);selected=null;current=null;});$('#canvas-viewport').focus({preventScroll:true});
}
function deleteIconButton(label,onclick){const button=document.createElement('button');button.className='tool-icon danger';button.title=label;button.setAttribute('aria-label',label);button.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';button.onclick=onclick;return button;}
function nodeDeleteButton(ids=selectedNodeIds()){const refs=recycleOpen?[]:ids.filter(id=>node(id)?.module!==moduleId),branches=ids.length&&ids.every(id=>isBranch(node(id)));return deleteIconButton(refs.length===ids.length?'移除当前画布引用':branches?'移除分叉点并接回连线':ids.length>1?'删除选中节点及其标记':'删除节点及其标记',()=>deleteSelectedNodes(ids));}
function viewKey(){return `yuanxing-view:${readonly?'share':'edit'}:${location.pathname}:${model.title}`;}
function saveView(){if(experience||!viewReady||!model||!moduleId)return;try{localStorage.setItem(viewKey(),JSON.stringify({moduleId,current:recycleOpen?null:current,camera:recycleOpen?cameras[moduleId]||{x:30,y:30,scale:.8}:camera,cameras:{...cameras,[activeCameraKey()]:camera},flowContext,linesHidden}));}catch{/* 存储不可用时仍可查看和编辑。 */}}
function rememberView(){if(!viewReady)return;clearTimeout(viewTimer);viewTimer=setTimeout(saveView,100);}
function renderLineVisibility(){const button=document.querySelector('[data-action="toggle-lines"]'),label=linesHidden?'显示连线':'隐藏连线';button.setAttribute('aria-label',label);button.title=label;button.setAttribute('aria-pressed',String(linesHidden));$('#lines').toggleAttribute('hidden',linesHidden);$('#canvas-world').classList.toggle('lines-hidden',linesHidden);button.hidden=!!current||recycleOpen;selectionTools();if(!linesHidden&&!current)drawLines();}
function selectionTools(){$('#canvas-world').classList.toggle('multi-selecting',selectedNodeIds().length>1);updateAnnotationButton();document.querySelector('[data-action="delete-edge"]').hidden=readonly||!!current||recycleOpen||linesHidden||selected?.type!=='edge'||!model.edges.some(e=>e.id===selected.id);}
const connectionKey=edge=>[edge.from,edge.to,edge.condition||edge.label,edge.fromSide,edge.toSide].join('\0');
function deleteSelectedConnection(){
  const id=selected?.type==='edge'?selected.id:selected?.type==='annotation'?model.annotations.find(a=>a.id===selected.id)?.edge:null;if(readonly||!id)return;
  const visible=overviewEdges(model),edge=visible.find(e=>e.id===id),ids=edge?visible.filter(e=>connectionKey(e)===connectionKey(edge)).map(e=>e.id):[id];
  if(!model.edges.some(e=>ids.includes(e.id)))return;
  edit(m=>{removeConnections(m,ids);selected=null;});
  if(!current)$('#canvas-viewport').focus({preventScroll:true});
}
function closeNotice(){clearTimeout(noticeTimer);noticeTimer=null;$('#message').hidden=true;}
function notice(text,actions=[],kind='info'){
  closeNotice();const message=$('#message');message.dataset.kind=kind;message.hidden=false;message.replaceChildren(document.createTextNode(text));
  for(const [label,fn] of actions){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=fn;message.append(b);}
  const close=document.createElement('button');close.type='button';close.className='message-close';close.textContent='×';close.title='关闭提示';close.setAttribute('aria-label','关闭提示');close.onclick=closeNotice;message.append(close);
  if(kind!=='save')noticeTimer=setTimeout(closeNotice,5000);
}
function updateHistoryButtons(){document.querySelector('[data-action="undo"]').disabled=!history.past.length;}
function edit(fn,render=true,group=null){if(readonly)return;history.push(model,{group});fn(model);dirty=true;updateHistoryButtons();scheduleSave();if(render)renderAll();}
function editField(fn){if(readonly)return;if(inputGroup!==document.activeElement){history.push(model);inputGroup=document.activeElement;}fn(model);dirty=true;updateHistoryButtons();scheduleSave();}
function scheduleSave(){clearTimeout(timer);timer=setTimeout(save,600);}
function showCollaborationConflict(data,snapshot,baseline){
  conflict=true;conflictData={base:clone(baseline),local:clone(snapshot),remote:clone(data.model),revision:data.revision,conflicts:data.conflicts};
  const backup=()=>download(JSON.stringify({...conflictData,local:model},null,2),'工作台双方修改.json','application/json');
  notice('同一内容被同时修改：'+data.conflicts.slice(0,3).join('、')+'。请选择冲突内容，其他独立修改会一起保留。',[
    ['保留我的冲突项',()=>resolveCollaborationConflict('local')],['采用外部冲突项',()=>resolveCollaborationConflict('remote')],['导出双方修改',backup]
  ],'save');
}
function resolveCollaborationConflict(prefer){
  if(!conflictData)return;const data=conflictData,chosen=mergeProject(data.base,model,data.remote,{prefer});
  const errors=validate(chosen.model);if(errors.length){notice('合并后存在关联冲突：'+errors.join('；'),[['导出双方修改',()=>download(JSON.stringify({...data,local:model},null,2),'工作台双方修改.json','application/json')]],'save');return;}
  history.push(model);model=chosen.model;baseModel=clone(data.remote);revision=data.revision;conflict=false;conflictData=null;dirty=true;renderAll();scheduleSave();
}
async function save(){
  if(saveFlight)return saveFlight;
  if(originalReadonly||!dirty||conflict)return;
  const errors=validate(model);if(errors.length){updateHistoryButtons();notice(errors.join('；'),[],'save');return;}
  saving=true;const snapshot=clone(model),baseline=clone(baseModel);saveFlight=(async()=>{
  try{const r=await fetch(apiBase+'/api/project',{method:'PUT',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({revision,model:snapshot,baseModel:baseline})});const data=await r.json();
    if(r.status===409&&data.model&&data.conflicts){showCollaborationConflict(data,snapshot,baseline);return;}
    if(r.status===409){conflict=true;throw new Error('项目已被外部修改，当前编辑内容仍保留。');}if(!r.ok)throw new Error(data.error||'保存失败');
    const saved=data.model||snapshot,combined=mergeProject(snapshot,model,saved);revision=data.revision;baseModel=clone(saved);
    if(combined.conflicts.length){showCollaborationConflict({model:saved,revision,conflicts:combined.conflicts},model,snapshot);return;}
    const changed=JSON.stringify(model)!==JSON.stringify(combined.model);model=combined.model;dirty=JSON.stringify(model)!==JSON.stringify(saved);updateHistoryButtons();if(changed){history.clear();renderAll();}if($('#message').dataset.kind==='save')$('#message').hidden=true;if(dirty)scheduleSave();
  }
  catch(error){updateHistoryButtons();const backup=['导出我的修改',()=>download(JSON.stringify(model,null,2),'工作台未保存修改.json','application/json')];notice(error.message,conflict?[backup,['重新载入',()=>{if(confirm('重新载入会替换当前编辑内容。请先导出需要保留的修改。'))reload();}]]:[['重试',save],backup],'save');}
  finally{saving=false;saveFlight=null;}
  })();return saveFlight;
}
async function reload(render=true){const r=await fetch(apiBase+'/api/project');if(!r.ok)throw new Error(await r.text());bundle=await r.json();model=bundle.model;baseModel=clone(model);flowContext=clone(model.contextDefaults||{});revision=bundle.revision;dirty=conflict=false;conflictData=null;history.clear();updateHistoryButtons();$('#message').hidden=true;moduleId=model.modules.some(m=>m.id===moduleId)?moduleId:model.entryModule||model.modules[0]?.id;if(render)renderAll();}
function sidebar(){
  $('#project-title').textContent=model.title;$('#module-title').textContent=recycleOpen?'回收站':model.modules.find(m=>m.id===moduleId)?.title||'';
  library.renderSidebar($('#sidebar'));
}
function openRecycle(){activeCanvasGesture?.();cancelConnection?.();closeAnnotationEditor();saveCanvasCamera();current=null;selected=null;mode=null;recycleOpen=true;camera=clone(cameras[recycleCameraKey]||{x:30,y:30,scale:.55});renderAll();$('#canvas-viewport').focus({preventScroll:true});}
function moveModule(id,beforeId){if(readonly||id===beforeId)return;edit(m=>{const from=m.modules.findIndex(v=>v.id===id);if(from<0)return;const [item]=m.modules.splice(from,1),at=beforeId?m.modules.findIndex(v=>v.id===beforeId):-1;m.modules.splice(at<0?m.modules.length:at,0,item);});}
function removeModule(id){
  if(readonly||!model.modules.some(m=>m.id===id))return;activeCanvasGesture?.();cancelConnection?.();closeAnnotationEditor();
  edit(m=>{
    const removed=new Set(m.nodes.filter(n=>n.module===id).map(n=>n.id));removeNodes(m,[...removed]);
    m.modules=m.modules.filter(v=>v.id!==id);if(m.groups)m.groups=m.groups.filter(g=>g.module!==id);
    delete m.referencePositions?.[id];
    if(!m.modules.length)m.modules.push({id:uid('module'),title:'新模块'});
    if(m.entryModule===id)m.entryModule=m.modules[0].id;
    if(current&&removed.has(current)){current=null;mode=null;linkCaptureTarget=null;}
    if(selected?.type==='node'&&removed.has(selected.id)||selected?.type==='edge'&&!m.edges.some(e=>e.id===selected.id)||selected?.type==='annotation'&&!m.annotations.some(a=>a.id===selected.id))selected=null;
    if(selected?.type==='nodes'){const ids=selected.ids.filter(value=>!removed.has(value));selected=ids.length>1?{type:'nodes',ids}:ids.length?{type:'node',id:ids[0]}:null;}
  });
}
function fitSelection(ids=selectedNodeIds()){if(current||!ids.length)return;const ns=activeCanvasNodes().filter(n=>ids.includes(n.id));if(!ns.length)return;const v=$('#canvas-viewport'),left=Math.min(...ns.map(n=>n.x)),top=Math.min(...ns.map(n=>n.y)),width=Math.max(...ns.map(n=>n.x+canvasNodeWidth(n)))-left,height=Math.max(...ns.map(n=>n.y+canvasNodeHeight(n)))-top,headroom=0;camera.scale=Math.max(.08,Math.min(1.2,(v.clientWidth-96)/width,(v.clientHeight-headroom-120)/height));camera.x=(v.clientWidth-width*camera.scale)/2-left*camera.scale;camera.y=headroom+(v.clientHeight-headroom-height*camera.scale)/2-top*camera.scale;transform();}
function locateNode(id){let n=node(id);if(n?.overview===false)n=node(n.overviewAlias);if(!n||n.overview===false||isBranch(n))return;closeAnnotationEditor();if(moduleId!==n.module)selectModule(n.module);else if(current||recycleOpen)selectModule(n.module);selectNodes([n.id]);fitSelection();}
function selectAnnotation(id){const a=model.annotations.find(v=>v.id===id);if(!a)return;const target=a.node||model.edges.find(e=>e.id===a.edge)?.from;if(target){const n=node(target);if(n&&moduleId!==n.module)selectModule(n.module);if(current!==target)openNode(target);}selected={type:'annotation',id};if(!panels.inspector)togglePanel('inspector');renderInspector();renderOverlays();openAnnotationEditor(id);}
function closeAnnotationEditor(){
  const id=annotationEditorId,removeNew=annotationEditorNew;annotationEditor?.remove();annotationEditor=null;annotationEditorId=null;annotationEditorNew=false;inputGroup=null;
  if(removeNew&&model.annotations.some(a=>a.id===id)){edit(m=>{m.annotations=m.annotations.filter(a=>a.id!==id);selected=current?{type:'node',id:current}:null;},false);renderInspector();renderOverlays();}
}
function positionAnnotationEditor(){if(!annotationEditor)return;const a=model.annotations.find(v=>v.id===annotationEditorId);if(!a||a.node&&a.node!==current){closeAnnotationEditor();return;}const pin=$('#page-stage').querySelector(`[data-pin="${annotationEditorId}"]`);if(!pin){annotationEditor.hidden=true;return;}const point=pin.getBoundingClientRect(),viewport=$('#page-viewport').getBoundingClientRect();if(point.bottom<viewport.top||point.top>viewport.bottom||point.right<viewport.left||point.left>viewport.right){annotationEditor.hidden=true;return;}annotationEditor.hidden=false;const width=Math.max(160,Math.min(340,viewport.width-24));annotationEditor.style.width=width+'px';let left=point.right+12;if(left+width>viewport.right-12)left=point.left-width-12;annotationEditor.style.left=Math.max(viewport.left+12,Math.min(left,viewport.right-width-12))+'px';const height=annotationEditor.offsetHeight;annotationEditor.style.top=Math.max(viewport.top+12,Math.min(point.top,viewport.bottom-height-12))+'px';}
function openAnnotationEditor(id,{isNew=false}={}){
  const a=model.annotations.find(v=>v.id===id);if(!a)return;if(annotationEditorId===id&&annotationEditor){positionAnnotationEditor();annotationEditor.querySelector('textarea')?.focus();return;}
  closeAnnotationEditor();annotationEditorId=id;annotationEditorNew=isNew;annotationEditor=document.createElement('div');annotationEditor.className='annotation-editor';annotationEditor.setAttribute('role','dialog');annotationEditor.setAttribute('aria-label','标记说明');
  if(readonly){const text=document.createElement('div');text.className='markdown';text.innerHTML=richText(a.text);annotationEditor.append(text);const close=document.createElement('button');close.textContent='关闭';close.onclick=closeAnnotationEditor;annotationEditor.append(close);}
  else{
    const input=document.createElement('textarea');input.rows=3;input.placeholder='输入说明';input.setAttribute('aria-label','标记说明');input.value=a.text||'';annotationEditor.append(input);
    const footer=document.createElement('footer'),remove=deleteIconButton('删除标记',()=>{annotationEditorNew=false;deleteAnnotation(id);}),spacer=document.createElement('span'),cancel=document.createElement('button'),save=document.createElement('button');spacer.className='spacer';cancel.className='annotation-editor-cancel';cancel.textContent='取消';cancel.onclick=closeAnnotationEditor;save.className='annotation-editor-save';save.textContent='保存';
    const commit=()=>{const owner=model.annotations.find(v=>v.id===id);if(owner&&owner.text!==input.value)edit(m=>{m.annotations.find(v=>v.id===id).text=input.value;},false);annotationEditorNew=false;closeAnnotationEditor();renderInspector();renderOverlays();};save.onclick=commit;
    input.onkeydown=event=>{if(event.key==='Escape'||event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();event.stopPropagation();if(event.key==='Escape')closeAnnotationEditor();else commit();}};footer.append(remove,spacer,cancel,save);annotationEditor.append(footer);
  }
  document.body.append(annotationEditor);positionAnnotationEditor();if(!readonly)requestAnimationFrame(()=>annotationEditor?.querySelector('textarea')?.focus());
}
const contextIcons={left:'M4 4v16M8 7h12M8 17h8',centerX:'M12 3v18M4 7h16M7 17h10',right:'M20 4v16M4 7h12M8 17h8',top:'M4 4h16M7 8v12M17 8v8',centerY:'M3 12h18M7 4v16M17 7v10',bottom:'M4 20h16M7 4v12M17 8v8',spaceX:'M3 4v16M21 4v16M9 7v10M15 7v10M3 12h18',spaceY:'M4 3h16M4 21h16M7 9h10M7 15h10M12 3v18',focus:'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5',open:'M14 3h7v7M21 3 10 14M21 14v7H3V3h7'};
function contextButton(icon,label,fn){const button=document.createElement('button');button.className='tool-icon';button.title=label;button.setAttribute('aria-label',label);button.innerHTML=`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${contextIcons[icon]||contextIcons.focus}"/></svg>`;button.onclick=fn;return button;}
function copySelection(){const ids=selectedNodeIds();if(!ids.length||readonly)return null;flowClipboard=copyCanvasSelection(model,moduleId,ids,{recycle:recycleOpen});Object.assign(flowClipboard,canvasClipboardAssets(flowClipboard,bundle));pasteCount=0;return flowClipboard;}
function writeCanvasClipboard(event,clipboard){
  if(!event.clipboardData||!clipboard?.nodes?.length)return false;
  try{event.clipboardData.setData('text/plain','YUANXING_SELECTION\n'+JSON.stringify(clipboard));event.preventDefault();return true;}catch{notice('未能写入剪贴板，请重试。');return false;}
}
function pasteSelection(clipboard=flowClipboard,point=null){if(readonly||!clipboard?.nodes?.length)return;const errors=validate({version:1,title:'复制内容',modules:[{id:'clipboard',title:'复制内容'}],nodes:clipboard.nodes.map(n=>{const value={...n,module:'clipboard'};delete value.section;return value;}),edges:clipboard.edges||[],annotations:clipboard.annotations||[],rules:clipboard.rules||{}});if(errors.length){notice('无法粘贴流程：'+errors.join('；'));return;}pasteCount++;let target=point||defaultInsertPoint();const size=[Math.max(...clipboard.nodes.map(n=>n.x+canvasNodeWidth(n))),Math.max(...clipboard.nodes.map(n=>n.y+canvasNodeHeight(n)))],existing=activeCanvasNodes();target=[target[0]+(pasteCount-1)*24,target[1]+(pasteCount-1)*24];if(existing.some(n=>target[0]<n.x+canvasNodeWidth(n)+24&&target[0]+size[0]+24>n.x&&target[1]<n.y+canvasNodeHeight(n)+24&&target[1]+size[1]+24>n.y))target=[target[0],Math.max(...existing.map(n=>n.y+canvasNodeHeight(n)+64))];edit(m=>{const ids=pasteCanvasSelection(m,moduleId,clipboard,target,{recycle:recycleOpen});ids.forEach((id,i)=>{const source=clipboard.nodes[i];if(source&&clipboard.resources?.[source.id])bundle.resources[id]=clipboard.resources[source.id];});Object.assign(bundle.images,clipboard.images||{});Object.assign(bundle.fragments,clipboard.fragments||{});const visible=ids.filter(id=>recycleOpen||m.nodes.find(n=>n.id===id)?.overview!==false);selected=visible.length>1?{type:'nodes',ids:visible}:visible.length?{type:'node',id:visible[0]}:null;current=null;});fitSelection();}
function duplicateSelection(){const ns=activeCanvasNodes().filter(n=>selectedNodeIds().includes(n.id));if(!ns.length)return;const copy=copySelection();pasteSelection(copy,[Math.max(...ns.map(n=>n.x+canvasNodeWidth(n)))+64,Math.min(...ns.map(n=>n.y))]);}
function selectionControls(pane){
  const ids=selectedNodeIds();if(readonly||!ids.length||current||recycleOpen)return;
  const toolGroup=(label,className)=>{const section=document.createElement('section');section.className='context-tool-group';const heading=document.createElement('span');heading.className='context-tool-label';heading.textContent=label;const row=document.createElement('div');row.className=`context-tools ${className}`;row.setAttribute('role','group');row.setAttribute('aria-label',label);section.append(heading,row);pane.append(section);return row;};
  if(ids.length>1){
    const align=toolGroup('对齐','align-tools');for(const [mode,icon,label] of [['left','left','左对齐'],['center-x','centerX','水平居中对齐'],['right','right','右对齐'],['top','top','顶部对齐'],['center-y','centerY','垂直居中对齐'],['bottom','bottom','底部对齐']])align.append(contextButton(icon,label,()=>edit(m=>alignCanvasNodes(m,moduleId,ids,mode))));
    const distribute=toolGroup('等间距','distribute-tools');for(const [axis,icon,label] of [['x','spaceX','横向等间距'],['y','spaceY','纵向等间距']]){const button=contextButton(icon,label,()=>edit(m=>distributeCanvasNodes(m,moduleId,ids,axis)));button.disabled=ids.length<3;distribute.append(button);}
  }
}
function addModule(){
  if(readonly)return;activeCanvasGesture?.();cancelConnection?.();saveCanvasCamera();recycleOpen=false;inputGroup=null;
  const id=uid('module');let title='新模块',number=2;while(model.modules.some(m=>m.title===title))title=`新模块 ${number++}`;
  edit(m=>{m.modules.push({id,title});moduleId=id;current=null;selected=null;mode=null;linkCaptureTarget=null;insertPoint=null;flowContext=clone(m.contextDefaults||{});camera={x:30,y:30,scale:.8};});
  if(!panels.inspector)togglePanel('inspector');const input=$('#inspector input');input?.focus();input?.select();
}
function selectModule(id){closeAnnotationEditor();saveCanvasCamera();recycleOpen=false;moduleId=id;current=null;selected=null;mode=null;flowContext=clone(model.contextDefaults||{});camera=clone(cameras[id]||{x:30,y:30,scale:.8});renderAll();if(!cameras[id])fit();}
function transform(){ $('#canvas-world').style.transform=`translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`;$('#canvas-world').style.setProperty('--port-scale',1/camera.scale);document.querySelectorAll('#lines marker').forEach(positionArrow);document.querySelectorAll('#lines .edge-endpoint-control').forEach(positionEndpoint);document.querySelectorAll('#lines .edge-fork,#lines .edge-fork-hit,#lines .edge-fork-plus,#lines .edge-fork-stem').forEach(positionFork);document.querySelectorAll('#lines .edge-bend').forEach(positionBend);const percent=Math.round((current?pageScale:camera.scale)*100),control=$('#zoom-label');$('#zoom-current').textContent=percent+'%';control.value=[...control.options].some(o=>o.value===String(percent))?String(percent):'custom';rememberView();positionAnnotationEditor();}
function visibleRect(frame,el){
  const doc=frame.contentDocument,win=frame.contentWindow;
  let r=el.getBoundingClientRect(),left=Math.max(0,r.left),top=Math.max(0,r.top),right=Math.min(win.innerWidth,r.right),bottom=Math.min(win.innerHeight,r.bottom);
  for(let parent=el;parent;parent=parent.parentElement){const style=win.getComputedStyle(parent);if(style.visibility==='hidden'||style.display==='none'||Number(style.opacity)===0)return null;if(parent!==el){const clip=parent.getBoundingClientRect();if(/hidden|auto|scroll|clip/.test(style.overflowX)){left=Math.max(left,clip.left);right=Math.min(right,clip.right);}if(/hidden|auto|scroll|clip/.test(style.overflowY)){top=Math.max(top,clip.top);bottom=Math.min(bottom,clip.bottom);}}}
  if(right<=left||bottom<=top)return null;
  const hit=doc.elementFromPoint((left+right)/2,(top+bottom)/2);if(!hit||!el.contains(hit))return null;
  return {x:left,y:top,width:right-left,height:bottom-top};
}
function measure(frame,n){const doc=frame.contentDocument;if(!doc)return;
  const map={};
  for(const e of outgoing(n.id))if(e.selector){

    try{const el=doc.querySelector(e.selector);if(el){if(projectExtension?.skipMeasurement?.(el)){missing.delete(e.id);continue;}const r=visibleRect(frame,el);if(r){map[e.id]=[r.x/n.width,r.y/n.height,r.width/n.width,r.height/n.height];missing.delete(e.id);}else if(!e.prototypeAction&&!el.getBoundingClientRect().width)missing.add(e.id);}else if(!e.prototypeAction)missing.add(e.id);}catch{if(!e.prototypeAction)missing.add(e.id);}
  }
  for(const a of model.annotations.filter(a=>a.node===n.id&&a.selector)){try{const el=doc.querySelector(a.selector);if(el){const r=el.getBoundingClientRect(),off=a.offset||[.5,.5];if(r.width&&r.height){map[a.id]=[(r.x+r.width*off[0])/n.width,(r.y+r.height*off[1])/n.height];missing.delete(a.id);}else missing.add(a.id);}else missing.add(a.id);}catch{missing.add(a.id);}}
  positions[n.id]=map;
}
function fitNoteThumbnail(box,n){
  box.style.width=n.width+'px';box.style.maxHeight='none';const fit=()=>{const layout=thumbnailLayout(n.width,Math.max(n.height,box.scrollHeight),canvasNodeWidth(n)-2,canvasNodeHeight(n)-43);Object.assign(box.style,{position:'absolute',left:layout.left+'px',top:layout.top+'px',transform:`scale(${layout.scale})`,transformOrigin:'0 0'});};fit();requestAnimationFrame(()=>{if(box.isConnected)fit();});for(const img of box.querySelectorAll('img'))if(!img.complete)img.addEventListener('load',fit,{once:true});
}
function frameFor(n,container,scale,onload){
  const thumbnail=container.classList.contains('node-thumb'),layout=thumbnail?thumbnailLayout(n.width,n.height,canvasNodeWidth(n)-2,canvasNodeHeight(n)-43):null;if(layout)scale=layout.scale;
  if(n.kind==='note'){const box=document.createElement('div');box.className='note-preview markdown';box.innerHTML=richText(n.description);container.append(box);if(thumbnail)fitNoteThumbnail(box,n);else if(container.id==='page-stage')prepareNote(box,n);onload?.();return;}
  if(n.kind==='image'){const img=document.createElement('img');img.alt=n.title;img.src=nodeResource(n)||'';container.append(img);onload?.();return;}
  const frame=document.createElement('iframe');frame.title=n.title;frame.className='page-frame';frame.tabIndex=thumbnail?-1:0;
  frame.style.width=n.width+'px';frame.style.height=n.height+'px';frame.style.transform=`scale(${scale})`;if(layout){frame.style.left=layout.left+'px';frame.style.top=layout.top+'px';}
  const html=expandHTML(bundle.resources[n.id]||'<p>页面资源不存在</p>',bundle.fragments||{});
  if(thumbnail||projectExtension?.declarative||devMode){frame.setAttribute('sandbox','allow-same-origin');frame.tabIndex=thumbnail||!experience?-1:0;frame.srcdoc=thumbnailHTML(devMode&&devSnapshot?.id===n.id?devSnapshot.html:html);if(!thumbnail)frames[n.id]=frame;}
  else{
    frame.setAttribute('sandbox','allow-scripts');frame.dataset.bridge=uid('frame');frames[n.id]=frame;
    frame.srcdoc=prototypeDocument(html,{token:frame.dataset.bridge,width:n.width,height:n.height,context:flowContext,edges:outgoing(n.id).map(({id,selector})=>({id,selector})),annotations:model.annotations.filter(a=>a.node===n.id&&a.selector).map(({id,selector,offset})=>({id,selector,offset}))});
  }
  frame.onload=()=>{if(!frame.isConnected)return;frame.dataset.yxReady='true';if(projectExtension?.declarative&&!devMode)projectExtension.layout?.(frame.contentDocument,n);if(thumbnail||projectExtension?.declarative)measure(frame,n);onload?.(frame);};container.append(frame);
}
function canvas(){
  devPicker?.destroy();devPicker=null;devElement=null;devOriginal=null;renderHandoffTools();
  stopPreviews();const ns=activeCanvasNodes(),host=$('#nodes');missing.clear();frames={};$('#page-stage').replaceChildren();
  reconcileCanvasCards(host,ns,(n,existing)=>{
    const card=existing||document.createElement('article');card.className=`node ${isBranch(n)?'branch':''} ${n.reference?'reference':''} ${selectedNodeIds().includes(n.id)?'selected':''}`;card.classList.toggle('node-mobile',canvasNodeType(n)==='mobile');card.classList.toggle('node-recycled',recycleOpen);card.dataset.id=n.id;card.style.width=canvasNodeWidth(n)+'px';card.style.height=canvasNodeHeight(n)+'px';card.style.left=n.x+'px';card.style.top=n.y+'px';
    card.onclick=event=>event.stopPropagation();card.ondragstart=event=>event.preventDefault();
    card.onpointerdown=event=>{if(!event.target.closest('button'))selectCanvasNode(event,n,card);};
    card.ondblclick=event=>{event.stopPropagation();if(event.button!==0||spacePressed||event.shiftKey||event.target.closest('button')||performance.now()<nodeOpenAfter)return;event.preventDefault();activeCanvasGesture?.();openNode(n.id);};
    let header=card.querySelector('.node-header');if(!header){header=document.createElement('div');header.className='node-header';card.prepend(header);}header.title=n.title;header.innerHTML=`<span>${esc(n.title)}</span>${recycleOpen?`<span class="ref-label">${esc(model.modules.find(m=>m.id===n.module)?.title||'')}</span>`:n.reference?'<span class="ref-label">关联页面</span>':''}`;
    if(n.kind==='image'&&!readonly){const replace=document.createElement('button');replace.className='node-image-actions';replace.type='button';replace.textContent='替换图片';replace.title='替换图片（也可粘贴新图）';replace.onclick=event=>{event.stopPropagation();selectNodes([n.id]);chooseImageReplacement(n.id);};header.append(replace);}
    card.querySelectorAll('.node-port').forEach(port=>port.remove());
    if(!readonly&&!recycleOpen)for(const side of connectionSides){const port=document.createElement('button');port.className='node-port';port.dataset.side=side;port.setAttribute('aria-label',`从「${n.title}」${{top:'上',right:'右',bottom:'下',left:'左'}[side]}侧拖动连线`);port.title='拖到另一个页面';port.onpointerdown=event=>dragConnection(event,n,side);port.onclick=event=>event.stopPropagation();card.append(port);}
    return card;
  });
  observePreviews(ns);drawLines();transform();
}
function renderSections(){const sections=recycleOpen?[]:canvasSections(model,moduleId),signature=JSON.stringify(sections);if(signature===lastSectionsSignature)return;lastSectionsSignature=signature;const host=$('#canvas-sections');host.replaceChildren();for(const section of sections){const box=document.createElement('div');box.className='canvas-section';Object.assign(box.style,{left:section.x+'px',top:section.y+'px',width:section.width+'px',height:section.height+'px'});const title=document.createElement('strong');title.textContent=section.title;box.append(title);host.append(box);}}
function highlightCards(){const ids=new Set(selectedNodeIds());document.querySelectorAll('.node').forEach(c=>c.classList.toggle('selected',ids.has(c.dataset.id)));}
function drawLines(){
  if(lineFrame!==null)return;lineFrame=requestAnimationFrame(()=>{lineFrame=null;paintLines();});
}
function paintLines(){
  if(cancelConnection||current)return;
  renderSections();const svg=$('#lines');if(recycleOpen){if(svg.childNodes.length)svg.replaceChildren();lastLinesSignature=null;return;}if(linesHidden)return;
  const ns=activeCanvasNodes(),edges=overviewEdges(model),signature=JSON.stringify([moduleId,ns.map(n=>[n.id,n.x,n.y,canvasNodeWidth(n),canvasNodeHeight(n),n.title,n.presentation]),edges,selected,model.annotations.map(a=>[a.id,a.edge])]);
  if(signature===lastLinesSignature)return;
  if(!svg.yuanxingLayers||!svg.childNodes.length){
    svg.innerHTML='<defs>'+[['arrow','var(--wire-color)'],['arrow-active','var(--green)']].map(([id,color])=>`<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${8/camera.scale}" markerHeight="${8/camera.scale}" markerUnits="userSpaceOnUse" orient="auto"><path d="M1 1L9 5L1 9Z" fill="${color}"/></marker>`).join('')+'</defs>';
    const layers=Array.from({length:3},()=>document.createElementNS('http://www.w3.org/2000/svg','g'));svg.append(...layers);svg.yuanxingLayers={paths:layers[0],labels:layers[1],controls:layers[2],views:new Map()};
  }
  const {paths:pathsLayer,labels:labelLayer,controls:controlsLayer,views}=svg.yuanxingLayers,kept=new Set();labelLayer.replaceChildren();controlsLayer.replaceChildren();
  const grouped=new Map();for(const e of edges){const key=connectionKey(e);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(e);}
  const routes=new Map(routeConnections(ns,[...grouped.values()].map(edges=>edges[0]),{scope:moduleId}).map(line=>[connectionKey(line.edge),line]));
  const textContext=lineTextContext??=document.createElement('canvas').getContext('2d');textContext.font=`12px ${getComputedStyle(svg).fontFamily}`;
  const labels=placeConnectionLabels([...routes.values()],ns,text=>textContext.measureText(text).width);
  for(const edges of grouped.values()){const e=edges.find(v=>v.id===selected?.id)||edges[0],line=routes.get(connectionKey(e));if(!line)continue;
    const {from,to,fromSide,toSide,start,end,route}=line;
    const select=()=>{selected={type:'edge',id:e.id};$('#canvas-viewport').focus({preventScroll:true});highlightCards();renderInspector();drawLines();};
    const key=edges[0].id;kept.add(key);let view=views.get(key);
    if(!view){view={path:document.createElementNS('http://www.w3.org/2000/svg','path'),hit:document.createElementNS('http://www.w3.org/2000/svg','path')};view.path.classList.add('flow');view.hit.classList.add('flow-hit');pathsLayer.append(view.hit,view.path);views.set(key,view);}
    const {path,hit}=view,active=edges.some(e=>selected?.id===e.id||model.annotations.find(a=>a.id===selected?.id)?.edge===e.id),display=connectionDisplayPath(route.points,8,ns);
    path.dataset.edge=hit.dataset.edge=e.id;path.classList.toggle('selected',active);path.setAttribute('d',display);path.setAttribute('marker-end',isBranch(to)?'none':`url(#${active?'arrow-active':'arrow'})`);path.onclick=hit.onclick=select;
    hit.setAttribute('d',display);hit.setAttribute('tabindex','0');hit.setAttribute('role','button');hit.setAttribute('aria-label',(e.condition||e.label||'连线')+'，双击编辑名称');
    path.onpointerenter=hit.onpointerenter=()=>{path.classList.add('hovered');if(!isBranch(to))path.setAttribute('marker-end','url(#arrow-active)');};path.onpointerleave=hit.onpointerleave=()=>{path.classList.remove('hovered');if(!isBranch(to))path.setAttribute('marker-end',`url(#${active?'arrow-active':'arrow'})`);};
    path.ondblclick=hit.ondblclick=event=>editConnectionLabel(e.id,event);hit.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();select();editConnectionLabel(e.id,event);}};
    const placement=labels.get(line.edge.id);
    if(placement){const {box,rows,leader}=placement,group=document.createElementNS('http://www.w3.org/2000/svg','g');group.classList.add('edge-label');group.dataset.edge=e.id;group.onclick=select;group.ondblclick=event=>editConnectionLabel(e.id,event);if(!readonly)group.onpointerdown=event=>dragEdgeLabel(event,e.id,box);
      if(leader){const pointer=document.createElementNS('http://www.w3.org/2000/svg','path');pointer.classList.add('label-leader');pointer.setAttribute('d',leader);labelLayer.append(pointer);}
      const background=document.createElementNS('http://www.w3.org/2000/svg','rect');for(const key of ['x','y','width','height'])background.setAttribute(key,box[key]);group.append(background);
      const label=document.createElementNS('http://www.w3.org/2000/svg','text');label.classList.add('label');label.dataset.edge=e.id;rows.forEach((text,i)=>{const row=document.createElementNS('http://www.w3.org/2000/svg','tspan');row.setAttribute('x',box.x+6);row.setAttribute('y',box.y+16+i*18);row.textContent=text;label.append(row);});group.append(label);labelLayer.append(group);
    }
    if(!readonly&&selected?.type==='edge'&&selected.id===e.id){
      const geometry=document.createElementNS('http://www.w3.org/2000/svg','g');geometry.classList.add('edge-geometry-controls');
      for(let i=0;i<route.points.length-1;i++){
        const a=route.points[i],b=route.points[i+1];if(Math.hypot(b[0]-a[0],b[1]-a[1])<30)continue;
        const segment=document.createElementNS('http://www.w3.org/2000/svg','g'),area=document.createElementNS('http://www.w3.org/2000/svg','path'),control=document.createElementNS('http://www.w3.org/2000/svg','rect');
        segment.classList.add('edge-segment-control');area.classList.add('edge-segment-hit');area.setAttribute('d',`M${a.join(',')} L${b.join(',')}`);
        control.classList.add('edge-bend');segment.style.cursor=a[1]===b[1]?'ns-resize':'ew-resize';Object.assign(control.dataset,{x:(a[0]+b[0])/2,y:(a[1]+b[1])/2});positionBend(control);
        const title=document.createElementNS('http://www.w3.org/2000/svg','title');title.textContent='拖动调整折线';segment.append(title,area,control);
        segment.onpointerdown=event=>dragEdgeSegment(event,e.id,route.points,i);segment.onclick=event=>event.stopPropagation();segment.ondblclick=event=>editConnectionLabel(e.id,event);geometry.append(segment);
      }
      const split=lineBranchSplit(route.points);
      if(split){const {point,side}=split,fork=document.createElementNS('http://www.w3.org/2000/svg','g');fork.classList.add('edge-fork-control');fork.setAttribute('role','button');fork.setAttribute('tabindex','0');fork.setAttribute('aria-label','拖到目标页面新增分支，也可点击后选择目标');
        const title=document.createElementNS('http://www.w3.org/2000/svg','title');title.textContent='拖到目标页面新增分支；也可点击后选目标，Esc 取消';fork.append(title);
        for(const className of ['edge-fork-stem','edge-fork-hit','edge-fork','edge-fork-plus']){const handle=document.createElementNS('http://www.w3.org/2000/svg',['edge-fork-plus','edge-fork-stem'].includes(className)?'path':'circle');handle.classList.add(className);Object.assign(handle.dataset,{x:point[0],y:point[1],side});positionFork(handle);fork.append(handle);}
        const begin=event=>{const fixed={id:'draft-fork',kind:'note',presentation:'branch',x:point[0]-8,y:point[1]-8};dragConnection(event,fixed,side,null,'to',{edgeId:e.id,point,route:{points:route.points,edgeIds:edges.map(edge=>edge.id),from:from.id,fromSide,toSide,module:moduleId,labelPosition:placement?[placement.box.x,placement.box.y]:undefined}});};
        fork.onpointerdown=begin;fork.onclick=event=>event.stopPropagation();fork.onkeydown=event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();begin(event);}};geometry.append(fork);
      }controlsLayer.append(geometry);
      for(const endpoint of ['from','to']){
        const source=endpoint==='from',point=source?start:end,side=source?fromSide:toSide,handle=document.createElementNS('http://www.w3.org/2000/svg','g'),label=source?'拖动起点，更换来源节点':'拖动终点，更换目标节点';
        handle.classList.add('edge-endpoint-control');Object.assign(handle.dataset,{edge:e.id,endpoint,x:point[0],y:point[1],side,branch:String(isBranch(source?from:to))});handle.setAttribute('role','button');handle.setAttribute('tabindex','0');handle.setAttribute('aria-label',label);
        for(const className of ['edge-endpoint-hit','edge-endpoint']){const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');circle.classList.add(className);handle.append(circle);}positionEndpoint(handle);
        const begin=event=>{handle.classList.add('active');dragConnection(event,source?to:from,source?toSide:fromSide,e,endpoint);};handle.onpointerdown=begin;handle.onclick=event=>event.stopPropagation();handle.onkeydown=event=>{if(['Enter',' '].includes(event.key))begin(event);};
        const title=document.createElementNS('http://www.w3.org/2000/svg','title');title.textContent=label;handle.append(title);controlsLayer.append(handle);
      }
    }
  }
  for(const [key,view] of views)if(!kept.has(key)){view.path.remove();view.hit.remove();views.delete(key);}lastLinesSignature=signature;
}
function edgeGeometryGesture(event,id,update){
  if(readonly||event.button!==0||spacePressed)return;event.preventDefault();event.stopPropagation();activeCanvasGesture?.();
  const start=canvasPoint(event),before=clone(model),visible=overviewEdges(model),edge=visible.find(v=>v.id===id),related=new Set(visible.filter(v=>edge&&connectionKey(v)===connectionKey(edge)).map(v=>v.id));let moved=false;
  const move=e=>{
    const point=canvasPoint(e);if(!moved&&Math.hypot(point[0]-start[0],point[1]-start[1])*camera.scale<3)return;
    const owners=model.edges.filter(v=>related.has(v.id)),next=owners.map(owner=>clone(owner));
    for(const owner of next)if(update(owner,point,start)===false)return;
    if(next.every((owner,i)=>JSON.stringify(owner)===JSON.stringify(owners[i])))return;
    if(!moved){history.push(model);moved=true;}next.forEach((owner,i)=>Object.assign(owners[i],owner));selected={type:'edge',id};drawLines();
  };
  const end=e=>{if(e?.type==='pointerup')move(e);document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',end);document.removeEventListener('pointercancel',cancel);activeCanvasGesture=null;if(moved){dirty=true;updateHistoryButtons();scheduleSave();renderInspector();}};
  const cancel=()=>{end();if(moved){model=before;history.past.pop();updateHistoryButtons();drawLines();}};
  activeCanvasGesture=()=>end();document.addEventListener('pointermove',move);document.addEventListener('pointerup',end);document.addEventListener('pointercancel',cancel);
}
function dragEdgeLabel(event,id,box){edgeGeometryGesture(event,id,(edge,p,start)=>edge.labelPosition=[box.x+p[0]-start[0],box.y+p[1]-start[1]]);}
function dragEdgeSegment(event,id,points,index){
  const axis=points[index][1]===points[index+1][1]?1:0;
  edgeGeometryGesture(event,id,(edge,p,start)=>{const display=overviewEdges(model).find(e=>e.id===id),waypoints=adjustConnectionSegment(activeCanvasNodes(),display,points,index,p[axis]-start[axis]);if(!waypoints)return false;edge.waypoints=waypoints;});
}
function positionArrow(marker){marker.setAttribute('markerWidth',8/camera.scale);marker.setAttribute('markerHeight',8/camera.scale);}
function positionEndpoint(handle){
  const vector={top:[0,-1],right:[1,0],bottom:[0,1],left:[-1,0]}[handle.dataset.side],offset=(handle.dataset.branch==='true'?20:-7)/camera.scale,x=Number(handle.dataset.x)+vector[0]*offset,y=Number(handle.dataset.y)+vector[1]*offset;
  for(const [selector,radius] of [['.edge-endpoint-hit',12],['.edge-endpoint',4]]){const circle=handle.querySelector(selector);circle.setAttribute('cx',x);circle.setAttribute('cy',y);circle.setAttribute('r',radius/camera.scale);}
}
function positionFork(handle){
  const px=Number(handle.dataset.x),py=Number(handle.dataset.y),unit=1/camera.scale,horizontal=['left','right'].includes(handle.dataset.side),x=px+(horizontal?0:28*unit),y=py-(horizontal?28*unit:0);
  if(handle.classList.contains('edge-fork-stem')){handle.setAttribute('d',`M${px},${py} L${x},${y}`);return;}
  if(handle.classList.contains('edge-fork-plus')){handle.setAttribute('d',`M${x-4*unit},${y} H${x+4*unit} M${x},${y-4*unit} V${y+4*unit}`);return;}
  handle.setAttribute('cx',x);handle.setAttribute('cy',y);handle.setAttribute('r',(handle.classList.contains('edge-fork-hit')?14:9)*unit);
}
function positionBend(handle){const size=8/camera.scale;handle.setAttribute('x',Number(handle.dataset.x)-size/2);handle.setAttribute('y',Number(handle.dataset.y)-size/2);handle.setAttribute('width',size);handle.setAttribute('height',size);}
function canvasPoint(event){const r=$('#canvas-viewport').getBoundingClientRect();return [(event.clientX-r.left-camera.x)/camera.scale,(event.clientY-r.top-camera.y)/camera.scale];}
function dragConnection(event,fixed,fixedSide,edge=null,endpoint='to',fork=null){
  if(spacePressed||readonly||event.button!==undefined&&event.button!==0)return;
  event.preventDefault();event.stopPropagation();closeMenus();cancelConnection?.();activeCanvasGesture?.();
  const svg=$('#lines'),preview=document.createElementNS('http://www.w3.org/2000/svg','path');preview.classList.add('connection-preview');preview.setAttribute('marker-end','url(#arrow-active)');svg.append(preview);$('#canvas-world').classList.add('connecting');
  const pointerId=event.pointerId,start=Number.isFinite(event.clientX)?[event.clientX,event.clientY]:null;let dragged=false,destination=null,candidate=null,frame=null,lastEvent=null;
  const accepts=e=>pointerId===undefined||e.pointerId===undefined||e.pointerId===pointerId;
  const paint=e=>{
    if(!accepts(e))return;
    if(start&&Math.hypot(e.clientX-start[0],e.clientY-start[1])>4)dragged=true;
    const ns=activeCanvasNodes(),point=canvasPoint(e),el=document.elementFromPoint(e.clientX,e.clientY),card=el?.closest('.node'),port=el?.closest('.node-port');
    const target=connectionTarget(ns,point,{exclude:[fixed.id],tolerance:24/camera.scale,side:port&&card?port.dataset.side:null});
    destination=target?.node||null;
    document.querySelectorAll('.node.connection-target').forEach(n=>{n.classList.remove('connection-target');delete n.dataset.connectionSide;});
    if(target){const card=document.querySelector(`.node[data-id="${target.node.id}"]`);if(card){card.classList.add('connection-target');card.dataset.connectionSide=target.side;}}
    const loose={id:'draft-pointer',kind:'note',presentation:'branch',x:point[0]-8,y:point[1]-8};
    const targetSide=target?.side||connectionDirections({},fixed,loose)[1];candidate=previewConnection(ns,fixed,fixedSide,target?.node||loose,targetSide,{endpoint,branch:!!fork});
    preview.setAttribute('d',connectionDisplayPath(candidate?.route.points||[],8,ns));preview.classList.toggle('blocked',!!candidate?.route.blocked);
  };
  const move=e=>{if(!accepts(e))return;if(start&&Math.hypot(e.clientX-start[0],e.clientY-start[1])>4)dragged=true;lastEvent=e;if(frame===null)frame=requestAnimationFrame(()=>{frame=null;paint(lastEvent);});};
  const cleanup=()=>{if(frame!==null)cancelAnimationFrame(frame);document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',release);document.removeEventListener('pointerdown',pick,true);document.removeEventListener('pointercancel',cancel);preview.remove();document.querySelectorAll('.edge-endpoint-control.active').forEach(handle=>handle.classList.remove('active'));$('#canvas-world').classList.remove('connecting');document.querySelectorAll('.connection-target').forEach(n=>{n.classList.remove('connection-target');delete n.dataset.connectionSide;});cancelConnection=null;};
  const cancel=e=>{if(e&&!accepts(e))return;cleanup();drawLines();};
  const finish=e=>{
    if(!accepts(e))return;paint(e);const chosen=destination,line=candidate;cleanup();
    if(!chosen||!line||line.route.blocked||!e.target.closest('#canvas-viewport')){drawLines();return;}
    const duplicate=!edge&&!fork&&overviewEdges(model).find(v=>v.from===line.edge.from&&v.to===line.edge.to&&v.fromSide===line.fromSide&&v.toSide===line.toSide);
    if(duplicate){selected={type:'edge',id:duplicate.id};renderInspector();drawLines();return;}
    if(edge&&edge[endpoint]===chosen.id&&edge[endpoint+'Side']===(endpoint==='from'?line.fromSide:line.toSide)){drawLines();return;}
    const next=clone(model);let changedId;
    if(fork){const result=createLineBranch(next,fork.edgeId,chosen.id,fork.point,line.toSide,{...fork.route,branchSide:line.fromSide});changedId=result?.edgeId;}
    else if(edge){if(reconnectEdge(next,edge.id,endpoint,chosen.id,endpoint==='from'?line.fromSide:line.toSide,fixedSide))changedId=edge.id;}
    else changedId=connectNodes(next,line.edge.from,line.edge.to,line.fromSide,line.toSide);
    if(!changedId){drawLines();return;}
    edit(()=>{model=next;selected={type:'edge',id:changedId};});$('#canvas-viewport').focus({preventScroll:true});
  };
  const release=e=>{if(!accepts(e))return;if(fork&&start&&!dragged&&Math.hypot(e.clientX-start[0],e.clientY-start[1])<=4)return;finish(e);};
  const pick=e=>{if(e.button!==0||!accepts(e))return;e.preventDefault();e.stopImmediatePropagation();finish(e);};
  cancelConnection=cancel;document.addEventListener('pointermove',move);document.addEventListener('pointerup',release);if(fork)document.addEventListener('pointerdown',pick,true);document.addEventListener('pointercancel',cancel);if(start)paint(event);
}
function editConnectionLabel(id,event){
  if(readonly)return;event.preventDefault();event.stopPropagation();const edge=model.edges.find(e=>e.id===id);if(!edge)return;
  document.querySelector('#edge-label-editor')?.blur();const branch=node(edge.to),target=isBranch(branch)?branch:edge,input=document.createElement('input'),rect=event.currentTarget?.getBoundingClientRect();
  input.id='edge-label-editor';input.setAttribute('aria-label','连线名称');input.value=isBranch(branch)?branch.title:edge.condition||(['继续'].includes(edge.label)?'':edge.label||'');
  Object.assign(input.style,{left:Math.max(8,Math.min(innerWidth-248,Number.isFinite(event.clientX)?event.clientX:rect?.left||8))+'px',top:Math.max(8,Math.min(innerHeight-48,Number.isFinite(event.clientY)?event.clientY:rect?.top||8))+'px'});
  let closed=false;const close=save=>{if(closed)return;closed=true;const value=input.value.trim();input.remove();if(save&&value!==(isBranch(branch)?branch.title:edge.condition||(['继续'].includes(edge.label)?'':edge.label||'')))edit(()=>{if(isBranch(target))target.title=value;else{target.label=value;if(target.condition!==undefined)target.condition=value;}});};
  input.onblur=()=>close(true);input.onpointerdown=e=>e.stopPropagation();input.onkeydown=e=>{e.stopPropagation();if(e.key==='Escape'||e.key==='Enter'){e.preventDefault();close(e.key==='Enter');$('#canvas-viewport').focus({preventScroll:true});}};document.body.append(input);input.focus();input.select();
}
function drawAlignmentGuides(guides=[]){
  const host=$('#alignment-guides');host.replaceChildren();
  for(const guide of guides){const line=document.createElementNS('http://www.w3.org/2000/svg','line');line.classList.add('alignment-guide');const vertical=guide.axis==='x';line.setAttribute('x1',vertical?guide.position:guide.start);line.setAttribute('y1',vertical?guide.start:guide.position);line.setAttribute('x2',vertical?guide.position:guide.end);line.setAttribute('y2',vertical?guide.end:guide.position);host.append(line);}
}
function dragNode(event,n,card){
  if(readonly||event.button!==0)return;event.stopPropagation();activeCanvasGesture?.();
  const start={x:event.clientX,y:event.clientY},nodes=activeCanvasNodes().map(item=>({...item})),ids=selectedNodeIds().includes(n.id)?selectedNodeIds():[n.id],cards=new Map([...document.querySelectorAll('.node')].map(el=>[el.dataset.id,el]));
  let moved=false;
  const move=e=>{
    if(e.pointerId!==event.pointerId)return;if(Math.hypot(e.clientX-start.x,e.clientY-start.y)<3&&!moved)return;e.preventDefault();if(!moved){history.push(model);moved=true;if(e.type==='pointermove')card.setPointerCapture(event.pointerId);}
    const delta=[(e.clientX-start.x)/camera.scale,(e.clientY-start.y)/camera.scale],snapped=snapNodeGroup(nodes,ids,delta,e.altKey?0:8/camera.scale);
    moveActiveNodes(model,snapped.positions);const actual=new Map(activeCanvasNodes().map(n=>[n.id,n]));
    for(const position of snapped.positions){const el=cards.get(position.id),n=actual.get(position.id);if(el&&n){el.style.left=n.x+'px';el.style.top=n.y+'px';}}
    const accepted=snapped.positions.every(p=>actual.get(p.id)?.x===p.x&&actual.get(p.id)?.y===p.y);
    cancelAnimationFrame(gestureFrame);gestureFrame=requestAnimationFrame(()=>{paintLines();drawAlignmentGuides(accepted?snapped.guides:[]);});
  };
  const end=e=>{if(e&&e.pointerId!==event.pointerId)return;if(e?.type==='pointerup')move(e);cancelAnimationFrame(gestureFrame);document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',end);document.removeEventListener('pointercancel',end);drawAlignmentGuides();activeCanvasGesture=null;if(card.hasPointerCapture(event.pointerId))card.releasePointerCapture(event.pointerId);if(moved){nodeOpenAfter=performance.now()+300;dirty=true;scheduleSave();updateHistoryButtons();drawLines();}};
  activeCanvasGesture=()=>end();document.addEventListener('pointermove',move);document.addEventListener('pointerup',end);document.addEventListener('pointercancel',end);
}
function renderImagePreview(){
  const entry=imagePreviewStack.at(-1),n=node(entry?.id);if(!n)return;
  const stage=$('#image-preview-stage'),viewport=$('#image-preview-viewport');stage.replaceChildren();stage.style.width=n.width+'px';$('#image-preview-title').textContent=n.title;
  const image=document.createElement('img');image.src=nodeResource(n);image.alt=n.title;image.width=n.width;image.height=n.height;image.draggable=false;stage.append(image);
  const groups=new Map();
  for(const edge of eligibleEdges(outgoing(n.id),flowContext)){
    if(!edge.rect||edge.imagePath&&edge.imagePath!==n.path)continue;
    const key=edge.rect.join(',');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(edge);
  }
  for(const edges of groups.values()){
    const [x,y,width,height]=edges[0].rect,button=document.createElement('button');button.className='hotspot';button.type='button';button.setAttribute('aria-label',edges.map(edge=>edge.label||node(edge.to)?.title||'继续').join(' / '));
    Object.assign(button.style,{left:x*100+'%',top:y*100+'%',width:width*100+'%',height:height*100+'%'});button.onclick=()=>follow(edges);stage.append(button);
  }
  viewport.scrollTop=entry.scrollTop;viewport.scrollLeft=entry.scrollLeft;
}
function openImagePreview(n,returnContext=flowContext){
  const previous=imagePreviewStack.at(-1),viewport=$('#image-preview-viewport');
  if(previous){previous.scrollTop=viewport.scrollTop;previous.scrollLeft=viewport.scrollLeft;}
  imagePreviewStack.push({id:n.id,returnContext:clone(returnContext),scrollTop:0,scrollLeft:0});
  renderImagePreview();const dialog=$('#image-preview-dialog');if(!dialog.open)dialog.showModal();
}
function dismissImagePreview(){
  imagePreviewStack=[];const dialog=$('#image-preview-dialog');if(dialog.open)dialog.close();$('#image-preview-stage').replaceChildren();
}
function backFromImagePreview(){
  const entry=imagePreviewStack.pop();if(!entry)return;flowContext=entry.returnContext;
  if(imagePreviewStack.length)renderImagePreview();else dismissImagePreview();
}
function openNode(id,fromFlow=false,{asPage=false,returnContext=flowContext}={}){
  const n=node(id);if(!n)return;
  if(experience&&n.kind==='image'&&current&&!asPage){openImagePreview(n,returnContext);return;}
  if(imagePreviewStack.length){dismissImagePreview();if(id===current)return;}
  if(id!==current)closeAnnotationEditor();
  if(!recycleOpen&&n.module!==moduleId&&!activeCanvasNodes().some(v=>v.id===id)){saveCanvasCamera();moduleId=n.module;camera=clone(cameras[moduleId]||{x:30,y:30,scale:.8});}
  if(isBranch(n)){selected={type:'node',id};renderInspector();highlightCards();return;}
  if(!fromFlow)flowContext=clone(model.contextDefaults||{});current=id;selected={type:'node',id};mode=null;renderAll();
}
function annotationTarget(){return current||(selected?.type==='node'?selected.id:null);}
function updateAnnotationButton(){const trigger=$('#annotate-trigger'),target=node(current),active=mode==='annotate',label=active?'取消打点':'打点说明';trigger.hidden=readonly||!current;trigger.disabled=readonly||!target||isBranch(target);trigger.setAttribute('aria-pressed',String(active));trigger.setAttribute('aria-label',label);trigger.title=label;}
function startAnnotation(id=annotationTarget()){
  if(readonly||!node(id)||isBranch(node(id)))return;
  if(current!==id)openNode(id);
  const active=mode==='annotate';linkCaptureTarget=null;mode=active?null:'annotate';renderOverlays();
}
function travel(edge){if(projectExtension?.travel?.(edge))return;const returnContext=clone(flowContext);flowContext=nextContext(flowContext,edge);openNode(edge.to,true,{returnContext});}
function follow(edges){const edge=eligibleEdges(edges,flowContext)[0];if(!edge){notice('请从对应流程入口进入后再继续。');return;}travel(edge);}
function prepareNote(box,n){
  box.style.width=n.width+'px';box.style.minHeight=n.height+'px';
  for(const img of box.querySelectorAll('img'))if(!img.complete)img.addEventListener('load',()=>{if(box.isConnected&&current===n.id)sizeNote();},{once:true});
  sizeNote();
}
function sizeNote(){
  const n=node(current),stage=$('#page-stage'),box=stage.querySelector('.note-preview');if(n?.kind!=='note'||!box)return;
  const height=Math.max(n.height,box.scrollHeight),viewport=$('#page-viewport');
  if(noteFit)pageScale=Math.max(.03,Math.min(1,(viewport.clientWidth-48)/n.width,(viewport.clientHeight-99)/height));
  stage.style.width=n.width*pageScale+'px';stage.style.height=height*pageScale+'px';box.style.transform=`scale(${pageScale})`;renderOverlays();transform();
}
function resizePage(){
  if(documentMode)return;
  if(!current){transform();return;}const n=node(current);if(n.kind==='note'){sizeNote();return;}
  const stage=$('#page-stage');pageScale=Math.min(1,Math.max(.2,($('#page-viewport').clientWidth-48)/n.width));stage.style.width=n.width*pageScale+'px';stage.style.height=n.height*pageScale+'px';const frame=stage.querySelector('iframe');if(frame)frame.style.transform=`scale(${pageScale})`;renderOverlays();transform();
}
function viewer(){
  devPicker?.destroy();devPicker=null;devElement=null;devOriginal=null;renderHandoffTools();
  stopPreviews();$('#nodes').replaceChildren();const n=node(current);$('#viewer-title').textContent=n.title;const stage=$('#page-stage');stage.replaceChildren();frames={};positions={};
  stage.tabIndex=n.kind==='note'?0:-1;stage.classList.toggle('note-stage',n.kind==='note');stage.classList.toggle('mobile-page',canvasNodeType(n)==='mobile');stage.classList.toggle('native-prototype',!!(experience&&projectExtension?.nativeInteraction&&n.kind==='html'));noteFit=true;
  const avail=$('#page-viewport').clientWidth-48;pageScale=Math.min(1,Math.max(.2,avail/n.width));stage.style.width=n.width*pageScale+'px';stage.style.height=n.height*pageScale+'px';
  frameFor(n,stage,pageScale,frame=>{if(frame&&projectExtension?.declarative&&!devMode){projectExtension.mount?.(frame.contentDocument,n);if(experience&&projectExtension.nativeInteraction)bindNativeDocument(frame.contentDocument,{getEdges:()=>outgoing(n.id),follow,onInput:(event,type)=>projectExtension.nativeInput?.(event,type),onKeyDown:event=>projectExtension.nativeKeyDown?.(event)});measure(frame,n);}if(frame&&devMode&&frames[current]===frame){devPicker=createDOMPicker(frame.contentDocument,{onSelect:element=>{devElement=element;renderHandoffTools();},onExit:()=>toggleDeveloperMode(false)});renderHandoffTools();}renderOverlays();if(!$('#inspector').contains(document.activeElement))renderInspector();});
  stage.onwheel=null;stage.onpointerdown=null;projectExtension?.bindStage?.({stage});
}
window.addEventListener('message',event=>{
  if(devMode&&devOriginal?.id===current&&event.source===devOriginal.frame.contentWindow&&event.data?.yuanxing===devOriginal.frame.dataset.bridge&&event.data?.type==='handoff-snapshot'&&typeof event.data.html==='string'){
    devSnapshot={id:current,html:event.data.html};mountHandoffPreview();return;
  }
  const frame=frames[current],message=event.data;
  if(!frame||event.source!==frame.contentWindow||message?.yuanxing!==frame.dataset.bridge)return;
  if(message.type==='measure'){
    const expected=new Set(model.annotations.filter(a=>a.node===current).map(a=>a.id));
    positions[current]=Object.fromEntries(Object.entries(message.positions||{}).filter(([id,point])=>expected.has(id)&&Array.isArray(point)&&point.length===2&&point.every(Number.isFinite)));renderOverlays();
  }else if(message.type==='context')flowContext={...flowContext,...cleanContext(message.context)};
  else if(message.type==='follow'&&Array.isArray(message.ids)){
    flowContext={...flowContext,...cleanContext(message.context)};const edges=outgoing(current).filter(edge=>message.ids.includes(edge.id));if(edges.length)follow(edges);
  }
});
function renderOverlays(){
  updateAnnotationButton();if(!current)return;
  const n=node(current),stage=$('#page-stage');if(devMode){stage.querySelectorAll('.hotspot,.pin,.capture,.prototype-text-input,.prototype-artifact-resizer').forEach(el=>el.remove());return;}if(experience&&projectExtension?.nativeInteraction&&n.kind==='html'){stage.querySelectorAll('.hotspot,.pin,.capture,.prototype-text-input,.prototype-artifact-resizer').forEach(el=>el.remove());return;}if(projectExtension?.renderOverlays)projectExtension.renderOverlays({n,stage,frame:frames[current],current,mode,pageScale},()=>renderPageHotspots(n,stage));
  else{stage.querySelectorAll('.hotspot,.pin,.capture').forEach(el=>el.remove());renderPageHotspots(n,stage);}
  if(experience)return;
  const ann=model.annotations.filter(a=>a.node===current);ann.forEach((a,i)=>{const point=positions[current]?.[a.id]||(!a.selector?a.point:null);if(a.imagePath&&a.imagePath!==n.path){missing.add(a.id);return;}if(a.imagePath)missing.delete(a.id);if(!point)return;const b=document.createElement('button');b.className=`pin ${point[1]*stage.clientHeight<36?'below':''} ${selected?.id===a.id?'selected':''}`;b.dataset.pin=a.id;b.textContent=i+1;b.setAttribute('aria-label',`${readonly?'查看':'编辑'}标记 ${i+1}`);b.title=`${readonly?'查看':'编辑'}标记 ${i+1}`;b.style.left=point[0]*100+'%';b.style.top=point[1]*100+'%';b.onclick=()=>selectAnnotation(a.id);stage.append(b);});
  if(mode){const cover=document.createElement('div');cover.className='capture';cover.onpointerdown=capturePoint;stage.append(cover);}
  positionAnnotationEditor();
}
function renderPageHotspots(n,stage){
  const groups=new Map();
  for(const edge of eligibleEdges(outgoing(n.id),flowContext)){
    if(edge.imagePath&&edge.imagePath!==n.path)continue;
    const rect=positions[current]?.[edge.id]||(!edge.selector?edge.rect:null);if(!rect)continue;
    const key=edge.selector||JSON.stringify(rect);if(!groups.has(key))groups.set(key,{rect,edges:[]});groups.get(key).edges.push(edge);
  }
  for(const {rect,edges} of [...groups.values()].sort((a,b)=>b.rect[2]*b.rect[3]-a.rect[2]*a.rect[3])){
    const [x,y,w,h]=rect,button=document.createElement('button');button.className='hotspot';button.setAttribute('aria-label',edges.map(edge=>edge.label||'继续').join(' / '));button.title=edges.map(edge=>edge.condition||edge.label||'继续').join(' / ');button.style.cssText=`left:${x*100}%;top:${y*100}%;width:${w*100}%;height:${h*100}%;z-index:2`;button.onclick=()=>follow(edges);projectExtension?.decorateHotspot?.(button,edges,frames[current]);stage.append(button);
  }
}
function renderExperience(){
  document.body.classList.toggle('experience',experience);readonly=originalReadonly||experience;
  const flows=flowEntries(model),select=$('#experience-flow');select.replaceChildren();
  for(const flow of flows){const option=document.createElement('option');option.value=flow.id;option.textContent=flow.title;select.append(option);}
  if(!flows.some(flow=>flow.id===activeFlow))activeFlow=flows.find(flow=>node(flow.entry)?.module===moduleId)?.id||flows[0]?.id;
  select.value=activeFlow||'';$('#experience-tools').hidden=!experience||flows.length<2;
  $('#experience-start').disabled=!flows.length;
  $('#experience-start').title=flows.length?'从流程入口体验完整原型':'请先添加原型页面';
  $('#experience-start').setAttribute('aria-pressed',String(experience));
  $('#experience-exit').setAttribute('aria-pressed',String(!experience&&!documentMode));
  $('#document-start').setAttribute('aria-pressed',String(documentMode));
}
function startExperience(id){
  if(documentMode){documentMode=false;documentView.leave();}
  const flows=flowEntries(model),flow=flows.find(flow=>flow.id===id)||flows.find(flow=>node(flow.entry)?.module===moduleId)||flows[0];
  if(!flow){notice('请先添加原型页面。');return;}
  if(!experience){
    activeCanvasGesture?.();cancelConnection?.();closeAnnotationEditor();saveCanvasCamera();saveView();
    experienceReturn={moduleId,recycleOpen,camera:clone(camera),selected:clone(selected),flowContext:clone(flowContext)};
  }
  dismissImagePreview();activeFlow=flow.id;experience=true;flowContext={...clone(model.contextDefaults||{}),...cleanContext(flow.context)};
  mode=null;linkCaptureTarget=null;recycleOpen=false;closeAnnotationEditor();openNode(flow.entry,true,{asPage:true});
  $('#page-viewport').scrollTop=0;$('#page-viewport').scrollLeft=0;
}
function exitExperience(){
  if(documentMode){documentMode=false;documentView.leave();renderAll();return;}
  dismissImagePreview();
  if(!experience){if(current){current=null;selected=null;mode=null;renderAll();}return;}
  const hadCanvas=!!experienceReturn;experience=false;readonly=originalReadonly;
  if(experienceReturn){
    moduleId=experienceReturn.moduleId;recycleOpen=experienceReturn.recycleOpen;camera=clone(experienceReturn.camera);
    selected=experienceReturn.selected;flowContext=experienceReturn.flowContext;
  }else{recycleOpen=false;selected=null;flowContext=clone(model.contextDefaults||{});}
  experienceReturn=null;current=null;mode=null;linkCaptureTarget=null;renderAll();if(!hadCanvas)fit();
  $('#canvas-viewport').focus({preventScroll:true});
}
function capturePoint(event){
  const stage=$('#page-stage'),r=stage.getBoundingClientRect();const point=[Math.min(1,Math.max(0,(event.clientX-r.x)/r.width)),Math.min(1,Math.max(0,(event.clientY-r.y)/r.height))];
  if(mode==='annotate'){
    const n=node(current),frame=frames[current];let anchor={point};
    if(n.kind==='html'&&frame?.contentDocument){let el=frame.contentDocument.elementFromPoint(point[0]*n.width,point[1]*n.height);if(el){let target=el.closest('[data-prototype-anchor], [id]');if(target&&target.tagName!=='HTML'&&target.tagName!=='BODY'){const b=target.getBoundingClientRect();anchor={point,selector:target.id?`#${CSS.escape(target.id)}`:`[data-prototype-anchor="${target.getAttribute('data-prototype-anchor')}"]`,offset:[(point[0]*n.width-b.x)/b.width,(point[1]*n.height-b.y)/b.height]};}}}
    if(n.kind==='image')anchor.imagePath=n.path;
    edit(m=>{const a={id:uid('annotation'),node:current,text:'',...anchor};m.annotations.push(a);selected={type:'annotation',id:a.id};},false);if(n.kind==='html'&&frame)measure(frame,n);mode=null;renderOverlays();renderInspector();if(!panels.inspector)togglePanel('inspector');openAnnotationEditor(selected.id,{isNew:true});return;
  }
  const start=point,box=document.createElement('div');box.className='rubber';stage.append(box);event.currentTarget.setPointerCapture(event.pointerId);const cover=event.currentTarget;
  const move=e=>{const p=[Math.min(1,Math.max(0,(e.clientX-r.x)/r.width)),Math.min(1,Math.max(0,(e.clientY-r.y)/r.height))];box.style.cssText=`left:${Math.min(start[0],p[0])*100}%;top:${Math.min(start[1],p[1])*100}%;width:${Math.abs(p[0]-start[0])*100}%;height:${Math.abs(p[1]-start[1])*100}%`;};
  const end=e=>{cover.removeEventListener('pointermove',move);cover.removeEventListener('pointerup',end);box.remove();const p=[Math.min(1,Math.max(0,(e.clientX-r.x)/r.width)),Math.min(1,Math.max(0,(e.clientY-r.y)/r.height))],rect=[Math.min(start[0],p[0]),Math.min(start[1],p[1]),Math.abs(p[0]-start[0]),Math.abs(p[1]-start[1])];mode=null;renderOverlays();if(rect[2]<.005||rect[3]<.005){notice('请拖出按钮或交互区域。');return;}const id=linkCaptureTarget,n=node(current),anchor={rect};linkCaptureTarget=null;if(!model.edges.some(v=>v.id===id))return;if(n.kind==='image')anchor.imagePath=n.path;edit(m=>{const owner=m.edges.find(v=>v.id===id);delete owner.selector;delete owner.imagePath;delete owner.trigger;Object.assign(owner,anchor);selected={type:'edge',id};},false);if(n.kind==='html'&&frames[current])measure(frames[current],n);renderOverlays();renderInspector();};cover.addEventListener('pointermove',move);cover.addEventListener('pointerup',end);
}
function field(label,value,oninput,area=false){const box=document.createElement('label');box.textContent=label;const input=document.createElement(area?'textarea':'input');input.value=value||'';if(area)input.rows=6;input.oninput=()=>oninput(input.value);input.onblur=()=>inputGroup=null;box.append(input);return box;}
function explanationText(owner){return requirementText(model,owner);}
function canvasText(owner){return canvasExplanation(model,owner);}
function writeExplanation(owner,text){owner.description=text;delete owner.rule;}
function updateNote(n){if(n.kind!=='note')return;const thumb=document.querySelector(`.node[data-id="${n.id}"] .note-preview`);if(thumb){thumb.innerHTML=richText(n.description);fitNoteThumbnail(thumb,n);}const page=$('#page-stage .note-preview');if(current===n.id&&page){page.innerHTML=richText(n.description);prepareNote(page,n);}}
function descriptionField(n){
  const box=document.createElement('div');box.className='description-field';
  const label=document.createElement('span');label.className='field-label';label.textContent=n.kind==='note'?'说明正文':'核心说明';box.append(label);
  const editor=document.createElement('div');editor.className='rich-editor markdown';editor.contentEditable='true';editor.setAttribute('role','textbox');editor.setAttribute('aria-label','页面说明');editor.setAttribute('aria-multiline','true');editor.dataset.placeholder='输入说明';editor.innerHTML=richText(canvasText(n));
  editor.oninput=()=>{const target=node(n.id);if(!target)return;editField(()=>writeCanvasExplanation(target,readDescription(editor)));updateNote(target);};
  editor.onblur=()=>{inputGroup=null;if(!editor.dataset.uploading){const target=node(n.id);editor.innerHTML=target?richText(canvasText(target)):'';}};
  editor.onpaste=event=>{event.preventDefault();event.stopPropagation();if(editor.dataset.uploading)return;const images=clipboardImages(event);if(images.length){pasteDescriptionImages(images,n.id,editor);return;}const range=editorRange(editor);range.deleteContents();const text=document.createTextNode(event.clipboardData?.getData('text/plain')||'');range.insertNode(text);range.setStartAfter(text);range.collapse(true);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);editor.oninput();};
  box.append(editor);return box;
}
function editorRange(editor){const selection=getSelection();if(selection.rangeCount&&editor.contains(selection.getRangeAt(0).commonAncestorContainer))return selection.getRangeAt(0).cloneRange();const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);return range;}
function nodeTypeField(n){
  const label=document.createElement('label');label.textContent='节点类型';const select=document.createElement('select');select.setAttribute('aria-label','节点类型');for(const [value,title] of [['pc','PC'],['mobile','移动端']]){const option=document.createElement('option');option.value=value;option.textContent=title;select.append(option);}select.value=canvasNodeType(n);select.onchange=()=>edit(m=>{m.nodes.find(v=>v.id===n.id).canvasType=select.value;});label.append(select);return label;
}
function renderInspector(){
  selectionTools();const pane=$('#inspector');pane.replaceChildren();const heading=document.createElement('header');heading.className='inspector-header';const h=document.createElement('h2');h.textContent=selected?.type==='edge'?'连线说明':'页面说明';heading.append(h);pane.append(heading);
  if(selected?.type==='nodes'){h.textContent=`已选 ${selected.ids.length} 个节点`;selectionControls(pane);if(!readonly)heading.append(nodeDeleteButton());return;}
  if(!selected&&recycleOpen){h.textContent='回收站';pane.insertAdjacentHTML('beforeend','<p class="hint">选中内容后可复制或剪切，再到模块画布粘贴。</p>');return;}
  if(!selected){h.textContent='模块设置';const m=model.modules.find(m=>m.id===moduleId);if(m&&!readonly)pane.append(field('模块名称',m.title,value=>{editField(()=>m.title=value);sidebar();}));return;}
  const annotation=selected.type==='annotation'?model.annotations.find(a=>a.id===selected.id):null;
  const edgeId=selected.type==='edge'?selected.id:annotation?.edge;
  if(edgeId){
    const e=model.edges.find(e=>e.id===edgeId);if(!e)return;h.textContent='连线说明';pane.insertAdjacentHTML('beforeend',`<p class="edge-summary">${esc(node(e.from)?.title)} <span aria-hidden="true">→</span> ${esc(node(e.to)?.title)}</p>`);
    if(readonly)pane.insertAdjacentHTML('beforeend',`<p>${esc(e.condition||e.label)}</p><div class="markdown">${richText(canvasText(e))}</div>`);
    else{const branch=node(e.to);pane.append(field('操作名称',isBranch(branch)?branch.title:e.condition||e.label,value=>{editField(()=>{if(isBranch(branch))branch.title=value;else{e.label=value;if(e.condition!==undefined)e.condition=value;}});drawLines();}));pane.append(field('说明正文',canvasText(e),value=>editField(()=>writeCanvasExplanation(e,value)),true));


      if(projectExtension?.bindHotspots!==false&&!e.diagram&&!isBranch(node(e.from))){const bind=document.createElement('button');bind.textContent=e.selector||e.rect?'重新绑定点击区域':'绑定点击区域';bind.onclick=()=>{openNode(e.from);selected={type:'edge',id:e.id};linkCaptureTarget=e.id;mode='link';renderOverlays();renderInspector();};pane.append(bind);}
      heading.append(deleteIconButton('删除连线及其标记',deleteSelectedConnection));
    }
    pointExplanations(pane,null,e.id);return;
  }
  const n=node(annotation?.node||selected.id);if(!n)return;
  if(!readonly){if(selected.type==='node')selectionControls(pane);if(!isBranch(n))pane.append(nodeTypeField(n));pane.append(field(isBranch(n)?'分支名称':'页面名称',n.title,value=>{editField(()=>n.title=value);sidebar();const title=document.querySelector(`.node[data-id="${n.id}"] .node-header span`);if(title)title.textContent=value;if(current===n.id)$('#viewer-title').textContent=value;if(isBranch(n))drawLines();}));pane.append(isBranch(n)?field('说明正文',canvasText(n),value=>editField(()=>writeCanvasExplanation(n,value)),true):descriptionField(n));
    heading.append(nodeDeleteButton([n.id]));
  }else pane.insertAdjacentHTML('beforeend',`<strong>${esc(n.title)}</strong><div class="markdown">${richText(canvasText(n))}</div>`);
  const lost=[...missing].filter(id=>outgoing(n.id).some(e=>e.id===id)||model.annotations.some(a=>a.node===n.id&&a.id===id));if(lost.length&&!readonly)pane.insertAdjacentHTML('beforeend','<p class="missing">页面已变化，部分标记暂未显示。</p>');

  pointExplanations(pane,n.id);
}
function deleteAnnotation(id){closeAnnotationEditor();edit(m=>{const a=m.annotations.find(v=>v.id===id);m.annotations=m.annotations.filter(v=>v.id!==id);selected=a?.edge?{type:'edge',id:a.edge}:a?{type:'node',id:a.node}:null;});}
function pointExplanations(pane,nodeId,edgeId){
  const list=model.annotations.filter(a=>edgeId?a.edge===edgeId:a.node===nodeId);if(!list.length)return;
  const section=document.createElement('section');section.className='page-point-explanations';const title=document.createElement('h3');title.textContent='标记说明';section.append(title);
  list.forEach((a,i)=>{
    const row=document.createElement('div');row.className=`point-summary ${selected?.id===a.id?'selected':''}`;row.dataset.annotation=a.id;
    const button=document.createElement('button');button.className='point-summary-main';button.title=`${readonly?'查看':'编辑'}标记 ${i+1}`;button.innerHTML=`<span class="number">${i+1}</span><div class="markdown">${richText(a.text)||'<p>输入说明</p>'}</div>`;button.onclick=()=>selectAnnotation(a.id);row.append(button);
    if(!readonly)row.append(deleteIconButton(`删除标记 ${i+1}`,()=>deleteAnnotation(a.id)));section.append(row);
  });pane.append(section);
}
function renderAll(){renderExperience();delete model.lockedPositions;if(annotationEditorId&&(!current||selected?.type!=='annotation'||selected.id!==annotationEditorId||!model.annotations.some(a=>a.id===annotationEditorId)))closeAnnotationEditor();closeMenus();cancelConnection?.();if(!model.modules.some(m=>m.id===moduleId)){moduleId=model.modules.some(m=>m.id===model.entryModule)?model.entryModule:model.modules[0]?.id;current=null;selected=null;if(!recycleOpen)camera=clone(cameras[moduleId]||{x:30,y:30,scale:.8});}if(current&&!node(current)){current=null;mode=null;}document.body.classList.toggle('readonly',readonly);document.body.classList.toggle('document-mode',documentMode);$('#document-view').hidden=!documentMode;if(documentMode){renderPanels();sidebar();$('#viewer').hidden=true;$('#canvas-viewport').hidden=true;$('#recycle-empty').hidden=true;$('#canvas-add-trigger').hidden=true;$('#canvas-add-divider').hidden=true;updateHistoryButtons();documentView.render();return;}renderPanels();renderLineVisibility();sidebar();$('#viewer').hidden=!current;$('#canvas-viewport').hidden=!!current;$('#canvas-viewport').setAttribute('aria-label',recycleOpen?'回收站画布':'模块概览画布');$('#recycle-empty').hidden=!recycleOpen||!!current||!!recycleNodes(model).length;$('#canvas-add-trigger').hidden=!!current||recycleOpen;$('#canvas-add-divider').hidden=!!current||recycleOpen;$('#viewer-image-trigger').hidden=readonly||node(current)?.kind!=='image';document.querySelector('#viewer [data-action="overview"]').textContent=recycleOpen?'← 返回回收站':'← 返回概览';updateHistoryButtons();if(current)viewer();else canvas();renderInspector();rememberView();}
function fit(){if(current){if(node(current).kind==='note'){noteFit=true;sizeNote();$('#page-viewport').scrollTop=0;}else viewer();return;}const ns=activeCanvasNodes(),v=$('#canvas-viewport');if(!ns.length)return;const bounds=[...ns.map(n=>({x:n.x,y:n.y,width:canvasNodeWidth(n),height:canvasNodeHeight(n)})),...(recycleOpen?[]:canvasSections(model,moduleId))],minX=Math.min(...bounds.map(n=>n.x)),minY=Math.min(...bounds.map(n=>n.y)),maxX=Math.max(...bounds.map(n=>n.x+n.width)),maxY=Math.max(...bounds.map(n=>n.y+n.height));camera.scale=Math.max(.08,Math.min(1,(v.clientWidth-60)/(maxX-minX),(v.clientHeight-110)/(maxY-minY)));camera.x=(v.clientWidth-(maxX-minX)*camera.scale)/2-minX*camera.scale;camera.y=32-minY*camera.scale;transform();}
function zoom(factor,event){
  if(current){const n=node(current);pageScale=Math.max(n.kind==='note' ? .03 : .08,Math.min(2.5,pageScale*factor));if(n.kind==='note'){noteFit=false;sizeNote();return;}const stage=$('#page-stage');stage.style.width=n.width*pageScale+'px';stage.style.height=n.height*pageScale+'px';const frame=stage.querySelector('iframe');if(frame)frame.style.transform=`scale(${pageScale})`;renderOverlays();transform();return;}
  const v=$('#canvas-viewport'),rect=v.getBoundingClientRect(),anchor=event?[event.clientX-rect.left,event.clientY-rect.top]:[v.clientWidth/2,v.clientHeight/2];camera=zoomCamera(camera,camera.scale*factor,anchor);transform();
}

function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function exportFile(scope,view='review'){if(exporting)return;if(conflict)return;exporting=true;closeMenus();const trigger=$('#export-trigger');trigger.disabled=true;trigger.firstChild.textContent='导出中… ';try{if(pendingImages.size)await Promise.all([...pendingImages]);if(saveFlight)await saveFlight;await save();if(dirty){if($('#message').hidden)notice('修改尚未保存，请重试。',[['重试',save]],'save');return;}const r=await fetch(apiBase+'/api/export',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({module:scope==='module'?moduleId:null,entryModule:moduleId,view})});if(!r.ok){notice((await r.json()).error);return;}download(await r.text(),`${model.title}-${scope==='module'?model.modules.find(m=>m.id===moduleId)?.title+'-':''}${view==='prototype'?'独立原型':view==='document'?'需求文档':'评审工作台'}.html`,'text/html');}finally{exporting=false;trigger.disabled=false;trigger.firstChild.textContent='导出 HTML ';}}
const imageTypes=['image/png','image/jpeg','image/webp'];
function clipboardImages(event){const files=[...(event.clipboardData?.files||[])];return files.length?files:[...(event.clipboardData?.items||[])].filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);}
async function uploadImage(file){
  if(!imageTypes.includes(file.type))throw new Error('请选择 PNG、JPEG 或 WebP 图片。');
  const src=await new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(fr.result);fr.onerror=()=>reject(new Error('图片无法读取'));fr.readAsDataURL(file);});
  const dim=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve([image.naturalWidth,image.naturalHeight]);image.onerror=()=>reject(new Error('图片无法打开'));image.src=src;});
  const r=await fetch(apiBase+'/api/image',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({name:file.name,type:file.type,data:src})}),data=await r.json();if(!r.ok)throw new Error(data.error||'上传失败');return {src,path:data.path,width:dim[0],height:dim[1]};
}
function pasteDescriptionImages(files,id,editor=null){
  if(readonly)return;if(pendingDescriptionNodes.has(id)){notice('图片正在上传，完成后可继续粘贴。',[],'image');return;}
  const target=node(id);if(!target)return;const before=canvasText(target),beforeHTML=editor?.innerHTML;let marker;
  pendingDescriptionNodes.add(id);
  if(editor){const range=editorRange(editor);marker=document.createElement('span');marker.dataset.uploadPending='true';marker.className='image-uploading';marker.contentEditable='false';marker.textContent='图片上传中…';range.deleteContents();range.insertNode(marker);editor.dataset.uploading='true';editor.contentEditable='false';}
  const job=(async()=>{try{
    const uploaded=[];for(const file of files){const image=await uploadImage(file);uploaded.push(image);bundle.images??={};bundle.images[image.path]=image.src;}
    const owner=node(id);if(!owner)throw new Error('页面已删除。');if(canvasText(owner)!==before)throw new Error('说明已发生变化，请重新粘贴图片。');
    let text;
    if(editor){const fragment=document.createDocumentFragment();fragment.append(document.createElement('br'));for(const image of uploaded){const img=document.createElement('img');img.alt='说明图片';img.src=image.src;img.dataset.assetPath=image.path;fragment.append(img,document.createElement('br'));}marker.replaceWith(fragment);text=readDescription(editor);}
    else text=[before,...uploaded.map(image=>`![说明图片](${image.path})`)].filter(Boolean).join('\n\n');
    inputGroup=null;edit(()=>writeCanvasExplanation(owner,text),false);updateNote(owner);
    if($('#message').dataset.kind==='image')$('#message').hidden=true;
    if(editor?.isConnected){editor.innerHTML=richText(text);const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);}
    else if(selected?.id===id)renderInspector();
  }catch(error){if(editor)editor.innerHTML=beforeHTML;notice('图片未粘贴：'+error.message,[],'image');}
  finally{pendingDescriptionNodes.delete(id);if(editor){delete editor.dataset.uploading;editor.contentEditable='true';}}})();
  pendingImages.add(job);job.finally(()=>pendingImages.delete(job));return job;
}
function defaultInsertPoint(){const v=$('#canvas-viewport'),center=[(v.clientWidth/2-camera.x)/camera.scale-200,(v.clientHeight/2-camera.y)/camera.scale-145],candidates=[center],ns=activeCanvasNodes();
  const left=(24-camera.x)/camera.scale,top=(32-camera.y)/camera.scale,right=(v.clientWidth-24-camera.x)/camera.scale,bottom=(v.clientHeight-80-camera.y)/camera.scale;
  for(let y=top;y+290<=bottom;y+=354)for(let x=left;x+400<=right;x+=460)candidates.push([x,y]);
  return candidates.find(([x,y])=>ns.every(n=>x+424<=n.x||x>=n.x+canvasNodeWidth(n)+24||y+314<=n.y||y>=n.y+canvasNodeHeight(n)+24))||center;
}
function upload(files,{replacement=null,expectedPath}={}){if(readonly)return;const targetModule=replacement?node(replacement)?.module:moduleId,point=insertPoint||defaultInsertPoint(),originalPath=expectedPath??node(replacement)?.path;insertPoint=null;
  const job=(async()=>{const uploaded=[];for(const file of replacement?[...files].slice(0,1):files){if(!imageTypes.includes(file.type)){notice('请选择 PNG、JPEG 或 WebP 图片。');continue;}try{uploaded.push({...await uploadImage(file),title:file.name||'截图'});}catch(error){notice('图片未添加：'+error.message);}}if(!uploaded.length)return;
    if(!model.modules.some(m=>m.id===targetModule))throw new Error('目标模块已删除。');
    let offsetY=0;const columns=Math.min(3,uploaded.length),items=[];for(let i=0;i<uploaded.length;i+=columns){const row=uploaded.slice(i,i+columns),height=canvasNodeHeight({kind:'image'});row.forEach((image,column)=>items.push({...image,x:column*464,y:offsetY}));offsetY+=height+64;}
    const area={x:point[0],y:point[1],width:columns*464-64,height:offsetY-64},ns=moduleNodes(model,targetModule);if(!replacement&&ns.some(n=>area.x<n.x+canvasNodeWidth(n)+24&&area.x+area.width+24>n.x&&area.y<n.y+canvasNodeHeight(n)+24&&area.y+area.height+24>n.y))area.y=Math.max(area.y,...ns.map(n=>n.y+canvasNodeHeight(n)+64));
    if(replacement&&(node(replacement)?.kind!=='image'||node(replacement).path!==originalPath))throw new Error('当前图片已改变，请重新选择后替换。');
    edit(m=>{if(replacement){const n=node(replacement),data=uploaded[0];bundle.images??={};bundle.images[n.path]=nodeResource(n);if(!replaceCanvasImage(m,n.id,data,originalPath))throw new Error('无法替换该图片。');bundle.images[data.path]=data.src;bundle.resources[n.id]=data.src;}else{const ids=[];for(const image of items){const id=uid('image');m.nodes.push({id,module:targetModule,title:image.title,kind:'image',path:image.path,width:image.width,height:image.height,x:area.x+image.x,y:area.y+image.y,description:''});bundle.resources[id]=image.src;ids.push(id);}if(moduleId===targetModule){selected=ids.length>1?{type:'nodes',ids}:{type:'node',id:ids[0]};current=null;}}});if(!replacement&&moduleId===targetModule)fitSelection();$('#image-input').value='';
  })().catch(error=>notice((replacement?'图片未替换：':'图片未添加：')+error.message));pendingImages.add(job);job.finally(()=>pendingImages.delete(job));return job;
}
function chooseImageReplacement(id){
  if(readonly||node(id)?.kind!=='image')return;replaceImage=id;closeMenus();const input=$('#image-input');input.value='';input.multiple=false;input.click();
}
function closeMenus(){clearTimeout(exportCloseTimer);$('#export-options').hidden=true;$('#export-trigger').setAttribute('aria-expanded','false');$('#canvas-add-menu').hidden=true;$('#node-image-menu').hidden=true;document.querySelectorAll('[aria-controls="node-image-menu"]').forEach(button=>button.setAttribute('aria-expanded','false'));$('#canvas-add-trigger').setAttribute('aria-expanded','false');}
function dismissZoomSettings(event){if(!event.target.closest('.zoom-settings'))document.querySelector('.zoom-settings').open=false;}
function imageMenu(id,event,trigger){
  if(readonly||node(id)?.kind!=='image')return;closeMenus();const menu=$('#node-image-menu'),r=trigger?.getBoundingClientRect();menu.dataset.node=id;menu.hidden=false;
  menu.style.left=Math.max(8,Math.min(event?.clientX??(r.right-menu.offsetWidth),innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,Math.min(event?.clientY??(r.bottom+4),innerHeight-menu.offsetHeight-8))+'px';
  if(trigger){trigger.setAttribute('aria-expanded','true');menu.querySelector('button').focus({preventScroll:true});}
}
function exportMenu(open=true){if(readonly||exporting)return;closeMenus();$('#export-options').hidden=!open;$('#export-trigger').setAttribute('aria-expanded',String(open));}
function canvasMenu(event){if(readonly||current||recycleOpen)return;closeMenus();insertPoint=event?canvasPoint(event):defaultInsertPoint();const menu=$('#canvas-add-menu'),r=$('#canvas-add-trigger').getBoundingClientRect();menu.hidden=false;menu.style.left=Math.max(8,Math.min(event?.clientX??r.left,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,Math.min(event?.clientY??r.top-menu.offsetHeight-8,innerHeight-menu.offsetHeight-8))+'px';$('#canvas-add-trigger').setAttribute('aria-expanded','true');}
function addNote(){if(readonly)return;const point=insertPoint||defaultInsertPoint();insertPoint=null;edit(m=>{const id=uid('note');m.nodes.push({id,module:moduleId,title:'流程说明',kind:'note',width:640,height:320,x:point[0],y:point[1],description:''});selected={type:'node',id};});if(panels.inspector){const input=$('#inspector input');input?.focus();input?.select();}}
function toggleDeveloperMode(force){
  const next=force??!devMode,id=current,frame=frames[id],doc=frame?.contentDocument;
  devSnapshot=next&&doc?{id,html:handoffClean(doc.documentElement).outerHTML}:null;
  devMode=next;devPicker?.destroy();devPicker=null;devElement=null;mode=null;closeAnnotationEditor();$('#handoff-menu').open=false;
  document.body.classList.toggle('handoff-mode',devMode);document.querySelector('[data-action="developer-mode"]').setAttribute('aria-pressed',String(devMode));
  if(next&&frame?.dataset.yxReady==='true'&&node(id)?.kind==='html'){
    devOriginal={id,frame};frame.hidden=true;renderOverlays();
    mountHandoffPreview();if(!doc&&frame.dataset.bridge)frame.contentWindow.postMessage({yuanxing:frame.dataset.bridge,type:'handoff-snapshot'},'*');
  }else if(!next&&devOriginal?.id===id&&devOriginal.frame.isConnected){
    frames[id]?.remove();frames[id]=devOriginal.frame;frames[id].hidden=false;devOriginal=null;renderOverlays();
  }else if(current)viewer();else renderAll();renderHandoffTools();
}
function mountHandoffPreview(){
  devPicker?.destroy();devPicker=null;devElement=null;if(frames[current]&&frames[current]!==devOriginal?.frame)frames[current].remove();
  frameFor(node(current),$('#page-stage'),pageScale,inspection=>{if(!devMode||frames[current]!==inspection)return;devPicker=createDOMPicker(inspection.contentDocument,{onSelect:element=>{devElement=element;renderHandoffTools();},onExit:()=>toggleDeveloperMode(false)});renderHandoffTools();});
}
function renderHandoffTools(){
  const bar=$('#handoff-tools');bar.hidden=!devMode||!current;if(bar.hidden)return;
  const crumbs=$('#handoff-breadcrumbs');crumbs.replaceChildren();
  if(!devElement){const hint=document.createElement('span');hint.textContent=node(current)?.kind==='html'?'点击要交付的区域，可通过层级选择扩大范围。':'当前为图片或说明，请打开 HTML 页面提取。';crumbs.append(hint);}
  else for(const element of handoffAncestors(devElement)){const button=document.createElement('button');button.textContent=element.tagName.toLowerCase()+(element.id?'#'+element.id:element.classList.length?'.'+element.classList[0]:'');button.disabled=element===devElement;button.onclick=()=>devPicker.select(element);crumbs.append(button);}
  for(const action of ['handoff-copy','handoff-download','handoff-html'])document.querySelector('[data-action="'+action+'"]').disabled=!devElement;
}
function selectedHandoff(){
  if(!devMode||!devElement)throw new Error('请先选择一个 UI 区域。');const n=node(current);
  return {snippet:collectHandoff(devElement),context:{project:model.title,module:model.modules.find(m=>m.id===n.module)?.title||n.module,title:n.title,id:n.id,path:'artifact/'+n.path,description:explanationText(n),annotations:model.annotations.filter(a=>a.node===n.id),...projectExtension?.handoffContext?.(n)}};
}
async function copyHandoff(text){
  if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(text);return;}catch{}}
  const field=document.createElement('textarea');field.value=text;field.style.cssText='position:fixed;opacity:0';document.body.append(field);field.select();try{if(!document.execCommand('copy'))throw new Error('复制失败，请下载片段 HTML。');}finally{field.remove();}
}
async function action(name){
  switch(name){case 'document':openDocument();break;case 'export-document':await exportFile('all','document');break;case 'developer-mode':toggleDeveloperMode();break;case 'handoff-copy':{const {snippet,context}=selectedHandoff();await copyHandoff(handoffPrompt(snippet,context));break;}case 'handoff-html':await copyHandoff(selectedHandoff().snippet.html);break;case 'handoff-download':{const {snippet,context}=selectedHandoff();download(handoffDocument(snippet,context),(context.title+'-片段.html').replace(/[\\/:*?"<>|]/g,'-'),'text/html');break;}case 'experience':if(devMode)toggleDeveloperMode(false);if(!experience)startExperience();break;case 'experience-exit':exitExperience();break;case 'export-prototype':await exportFile('all','prototype');break;case 'image':replaceImage=null;closeMenus();$('#image-input').multiple=true;$('#image-input').click();break;case 'replace-image':chooseImageReplacement($('#node-image-menu').dataset.node);break;case 'replace-current-image':chooseImageReplacement(current);break;case 'confirm-image-replacement':{const pending=pendingImageReplacement;if(readonly||!pending)break;$('#image-replace-dialog').close();pendingImageReplacement=null;if(node(pending.id)?.path!==pending.path){notice('当前图片已改变，请重新粘贴后替换。');break;}await upload(pending.files,{replacement:pending.id,expectedPath:pending.path});break;}case 'cancel-image-replacement':$('#image-replace-dialog').close();pendingImageReplacement=null;break;case 'note':addNote();break;case 'canvas-menu':canvasMenu();break;case 'export-menu':exportMenu();break;
    case 'undo':if(!readonly&&history.past.length){model=history.undo(model);dirty=true;selected=null;updateHistoryButtons();scheduleSave();renderAll();}break;
    case 'fit':fit();break;case 'zoom-in':zoom(1.15);break;case 'zoom-out':zoom(1/1.15);break;
    case 'panel-sidebar':togglePanel('sidebar');break;case 'panel-inspector':togglePanel('inspector');break;
    case 'toggle-lines':cancelConnection?.();linesHidden=!linesHidden;if(linesHidden&&selected?.type==='edge'){selected=null;renderInspector();drawLines();}renderLineVisibility();rememberView();break;
    case 'delete-edge':deleteSelectedConnection();break;
    case 'annotate':startAnnotation();break;
    case 'image-preview-back':backFromImagePreview();break;
    case 'overview':current=null;selected=null;mode=null;renderAll();$('#canvas-viewport').focus({preventScroll:true});break;
    case 'export-module':await exportFile('module');break;case 'export-all':await exportFile('all');break;
  }
}
document.addEventListener('click',event=>{const target=event.target.closest('[data-action]');if(target&&!(readonly&&['image','note','annotate','canvas-menu','export-menu','undo','export-module','export-all'].includes(target.dataset.action)))action(target.dataset.action).catch(error=>notice(error.message));});
$('#export-menu').addEventListener('pointerenter',()=>exportMenu());$('#export-menu').addEventListener('pointerleave',()=>{exportCloseTimer=setTimeout(()=>{if(!$('#export-menu').contains(document.activeElement))closeMenus();},160);});
document.addEventListener('pointerdown',event=>{if(!event.target.closest('#export-menu,#canvas-add-menu,#canvas-add-trigger,#node-image-menu,[aria-controls="node-image-menu"]')){closeMenus();insertPoint=null;}});
document.addEventListener('pointerdown',dismissZoomSettings,true);
document.addEventListener('focusout',event=>{if(event.target.closest('#export-menu')&&!$('#export-menu').contains(event.relatedTarget))closeMenus();});
for(const [triggerId,menuId,open] of [['export-trigger','export-options',exportMenu],['canvas-add-trigger','canvas-add-menu',canvasMenu]]){const trigger=$('#'+triggerId),menu=$('#'+menuId);trigger.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();open();const items=menu.querySelectorAll('button');items[event.key==='ArrowUp'?items.length-1:0]?.focus();}});menu.addEventListener('keydown',event=>{const items=[...menu.querySelectorAll('button')],index=items.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}if(event.key==='Escape'){event.preventDefault();closeMenus();trigger.focus();}});}
$('#node-image-menu').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();const trigger=document.querySelector('[aria-controls="node-image-menu"][aria-expanded="true"]');closeMenus();(trigger||$('#canvas-viewport')).focus({preventScroll:true});}});
document.addEventListener('focusout',event=>{if(event.target.closest('#node-image-menu')&&!$('#node-image-menu').contains(event.relatedTarget))closeMenus();});
$('#image-input').onchange=()=>{const replacement=replaceImage;replaceImage=null;upload([...$('#image-input').files],{replacement});};
$('#image-replace-dialog').addEventListener('close',()=>{if(!$('#image-replace-dialog').open)pendingImageReplacement=null;});
$('#image-input').addEventListener('cancel',()=>{replaceImage=null;$('#image-input').value='';});
document.addEventListener('copy',event=>{if(documentMode||readonly||current||$('#image-replace-dialog').open||event.target.closest('input,textarea,select,[contenteditable]'))return;writeCanvasClipboard(event,copySelection());});
document.addEventListener('cut',event=>{
  if(documentMode||readonly||current||$('#image-replace-dialog').open||event.target.closest('input,textarea,select,[contenteditable]'))return;activeCanvasGesture?.();const ids=selectedNodeIds(),clipboard=copySelection();
  if(!writeCanvasClipboard(event,clipboard))return;
  edit(m=>{cutCanvasSelection(m,moduleId,ids,{recycle:recycleOpen});selected=null;});$('#canvas-viewport').focus({preventScroll:true});
});
document.addEventListener('paste',event=>{
  if(documentMode||readonly||$('#image-replace-dialog').open||event.target.closest('input,textarea,select,[contenteditable]'))return;
  const text=event.clipboardData?.getData('text/plain')||'';if(text.startsWith('YUANXING_SELECTION\n')){event.preventDefault();try{pasteSelection(JSON.parse(text.slice('YUANXING_SELECTION\n'.length)));}catch(error){notice('无法粘贴流程：'+error.message);}return;}
  const images=clipboardImages(event);if(!images.length)return;const target=imagePasteTarget(model,current,selected);
  if(target){event.preventDefault();if(images.length!==1){notice('替换图片时请每次粘贴一张图片。');return;}if(!imageTypes.includes(images[0].type)){notice('请选择 PNG、JPEG 或 WebP 图片。');return;}pendingImageReplacement={id:target.id,path:target.path,files:images};$('#image-replace-description').textContent=`是否使用粘贴的新图片覆盖「${target.title||'当前图片'}」？`;$('#image-replace-dialog').showModal();return;}
  if(!recycleOpen){event.preventDefault();if(node(current)?.kind==='note')pasteDescriptionImages(images,current);else{insertPoint=null;upload(images);}}
});
$('#workspace').ondragover=event=>{if(!documentMode&&!readonly&&!(recycleOpen&&!current)&&event.dataTransfer.types.includes('Files'))event.preventDefault();};$('#workspace').ondrop=event=>{if(!documentMode&&!readonly&&!(recycleOpen&&!current)&&event.dataTransfer.files.length){event.preventDefault();if(node(current)?.kind==='note')pasteDescriptionImages([...event.dataTransfer.files],current);else{insertPoint=current?null:canvasPoint(event);upload([...event.dataTransfer.files]);}}};
$('#canvas-viewport').oncontextmenu=event=>{if(readonly)return;const card=event.target.closest('.node');if(card){if(node(card.dataset.id)?.kind==='image'){event.preventDefault();selectNodes([card.dataset.id]);imageMenu(card.dataset.id,event);}return;}if(event.target.closest('path,text,circle,.edge-label'))return;event.preventDefault();canvasMenu(event);};
$('#page-viewport').oncontextmenu=event=>{if(!readonly&&node(current)?.kind==='image'){event.preventDefault();imageMenu(current,event);}};
$('#canvas-viewport').onpointerdown=event=>{
  const explicitPan=spacePressed||event.button===1,pan=readonly||explicitPan;
  if(![0,1].includes(event.button)||!explicitPan&&event.target.closest('.node,path,text,circle,.edge-label'))return;
  event.preventDefault();const viewport=event.currentTarget,start={x:event.clientX,y:event.clientY,cx:camera.x,cy:camera.y},origin=canvasPoint(event),previous=selected,base=event.shiftKey?selectedNodeIds():[],nodes=activeCanvasNodes().filter(n=>!linesHidden||!isBranch(n));
  viewport.focus({preventScroll:true});viewport.setPointerCapture(event.pointerId);let moved=false,box=null;
  if(!pan){box=document.createElementNS('http://www.w3.org/2000/svg','rect');box.classList.add('selection-box');$('#alignment-guides').append(box);}
  const move=e=>{
    if(Math.hypot(e.clientX-start.x,e.clientY-start.y)<3&&!moved)return;moved=true;
    if(pan){camera.x=start.cx+e.clientX-start.x;camera.y=start.cy+e.clientY-start.y;transform();return;}
    const point=canvasPoint(e);for(const [key,value] of Object.entries({x:Math.min(origin[0],point[0]),y:Math.min(origin[1],point[1]),width:Math.abs(origin[0]-point[0]),height:Math.abs(origin[1]-point[1])}))box.setAttribute(key,value);
    selectNodes([...base,...nodesInRect(nodes,origin,point)]);
  };
  const end=e=>{if(e?.type==='pointerup')move(e);viewport.removeEventListener('pointermove',move);viewport.removeEventListener('pointerup',end);viewport.removeEventListener('pointercancel',cancel);box?.remove();activeCanvasGesture=null;if(viewport.hasPointerCapture(event.pointerId))viewport.releasePointerCapture(event.pointerId);if(!moved&&!event.shiftKey&&(!pan||readonly&&!explicitPan))selectNodes([]);};
  const cancel=()=>{end();selected=previous;renderInspector();highlightCards();drawLines();};
  activeCanvasGesture=cancel;viewport.addEventListener('pointermove',move);viewport.addEventListener('pointerup',end);viewport.addEventListener('pointercancel',cancel);
};
$('#canvas-viewport').addEventListener('wheel',event=>{event.preventDefault();if(event.ctrlKey||event.metaKey)zoom(wheelZoomFactor(event.deltaY,zoomSensitivity,event.deltaMode),event);else{camera.x-=event.deltaX;camera.y-=event.deltaY;transform();}},{passive:false});
$('#image-preview-dialog').addEventListener('cancel',event=>{event.preventDefault();backFromImagePreview();});
document.addEventListener('keydown',event=>{if(devMode&&event.key==='Escape'){event.preventDefault();toggleDeveloperMode(false);return;}if(!event.defaultPrevented&&event.key==='Escape'){if($('#image-preview-dialog').open){event.preventDefault();backFromImagePreview();return;}if(experience){event.preventDefault();exitExperience();return;}}if(event.defaultPrevented||$('#image-replace-dialog').open)return;if(event.key==='Escape'){closeAnnotationEditor();closeMenus();cancelConnection?.();mode=null;linkCaptureTarget=null;renderOverlays();}if(event.target.closest('input,textarea,select,[contenteditable]'))return;
  if(documentMode){if((event.ctrlKey||event.metaKey)&&!event.shiftKey&&event.key.toLowerCase()==='z'&&!readonly){event.preventDefault();action('undo');}return;}
  if(event.code==='Space'&&!current&&!event.target.closest('button,summary')){event.preventDefault();spacePressed=true;return;}
  if(event.key==='Escape'&&!current){activeCanvasGesture?.();selectNodes([]);return;}
  if(!readonly&&!current&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){event.preventDefault();selectNodes(activeCanvasNodes().filter(n=>!linesHidden||!isBranch(n)).map(n=>n.id));return;}
  if(!readonly&&!current&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='d'){event.preventDefault();duplicateSelection();return;}
  if(!readonly&&!current&&selectedNodeIds().length&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();const amount=event.shiftKey?10:1,delta={ArrowLeft:[-amount,0],ArrowRight:[amount,0],ArrowUp:[0,-amount],ArrowDown:[0,amount]}[event.key];edit(m=>{if(recycleOpen)moveRecycleNodes(m,activeCanvasNodes().filter(n=>selectedNodeIds().includes(n.id)).map(n=>({id:n.id,x:n.x+delta[0],y:n.y+delta[1]})));else nudgeCanvasNodes(m,moduleId,selectedNodeIds(),...delta);},true,`nudge:${activeCameraKey()}:${selectedNodeIds().join(',')}`);return;}
  if(!current&&event.key.toLowerCase()==='f'&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();if(selectedNodeIds().length)fitSelection();else fit();return;}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(!panels.sidebar)togglePanel('sidebar');library.focusSearch();return;}
  if(!readonly&&!current&&selectedNodeIds().length&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&['Delete','Backspace'].includes(event.key)){event.preventDefault();deleteSelectedNodes();return;}
  if((event.ctrlKey||event.metaKey)&&!event.shiftKey&&event.key.toLowerCase()==='z'&&!readonly){event.preventDefault();activeCanvasGesture?.();action('undo');return;}if(!readonly&&!current&&!linesHidden&&selected?.type==='edge'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&['Delete','Backspace'].includes(event.key)){event.preventDefault();deleteSelectedConnection();}});
window.addEventListener('beforeunload',event=>{saveView();const draft=annotationEditor?.querySelector('textarea');if(dirty||pendingImages.size||draft&&draft.value!==(model.annotations.find(a=>a.id===annotationEditorId)?.text||'')){event.preventDefault();event.returnValue='';}});
window.addEventListener('blur',()=>cancelConnection?.());
window.addEventListener('resize',resizePage);
$('#page-viewport').addEventListener('scroll',positionAnnotationEditor,{passive:true});
$('#page-viewport').addEventListener('wheel',event=>{if(event.ctrlKey||event.metaKey){event.preventDefault();event.stopPropagation();zoom(wheelZoomFactor(event.deltaY,zoomSensitivity,event.deltaMode),event);}},{passive:false,capture:true});
$('#zoom-label').onchange=event=>{const percent=Number(event.target.value);if(percent>0)zoom(percent/100/(current?pageScale:camera.scale));};
const sensitivity=$('#zoom-sensitivity');sensitivity.value=zoomSensitivity;$('#zoom-sensitivity-value').value=zoomSensitivity.toFixed(1)+'×';
sensitivity.oninput=()=>{zoomSensitivity=Number(sensitivity.value);$('#zoom-sensitivity-value').value=zoomSensitivity.toFixed(1)+'×';try{localStorage.setItem('yuanxing-zoom-sensitivity',String(zoomSensitivity));}catch{}};

document.addEventListener('pointerdown',event=>{if(annotationEditor&&!event.target.closest('.annotation-editor,.pin,.point-summary,.capture,[data-action="annotate"]'))closeAnnotationEditor();});
document.addEventListener('keyup',event=>{if(event.code==='Space')spacePressed=false;});
window.addEventListener('blur',()=>{spacePressed=false;activeCanvasGesture?.();});
$('#experience-flow').onchange=event=>startExperience(event.target.value);
const projectSelect=$('#project-select');
if(boot.projects?.length){
  $('#project-title').hidden=true;projectSelect.hidden=false;
  for(const project of boot.projects){const option=document.createElement('option');option.value=project.id;option.textContent=project.title;projectSelect.append(option);}
  projectSelect.value=boot.projectId;
  projectSelect.onchange=async()=>{
    const target=boot.projects.find(item=>item.id===projectSelect.value);if(!target||target.id===boot.projectId)return;
    projectSelect.disabled=true;activeCanvasGesture?.();closeAnnotationEditor();clearTimeout(timer);
    try{if(pendingImages.size||pendingDescriptionNodes.size)throw new Error('图片正在保存，请稍后切换项目。');await save();if(dirty||saving||conflict)throw new Error('当前修改尚未保存，请先处理保存提示。');saveView();location.assign(target.url);}
    catch(error){projectSelect.value=boot.projectId;projectSelect.disabled=false;notice(error.message,[],'save');}
  };
} else projectSelect.hidden=true;
function runtimeUpdateBlocked(){
  if(typeof documentView!=='undefined'&&documentMode&&documentView.isBusy())return true;
  if(devMode||conflict||experience||exporting||dirty||saving||pendingImages.size||activeCanvasGesture||cancelConnection||annotationEditorId)return true;
  if(document.activeElement?.matches('input,textarea,select,[contenteditable]')||document.querySelector('dialog[open]'))return true;
  for(const frame of current&&frames[current]?[frames[current]]:[]){
    const doc=frame.isConnected&&frame.contentDocument;if(!doc){if(frame.isConnected)return true;continue;}
    if(doc.activeElement?.matches('input,textarea,select,[contenteditable="true"]')||doc.querySelector('dialog[open],[data-current-stage="running"],[data-mobile-stage="running"],[data-upload-state="uploading"]'))return true;
    if([...doc.querySelectorAll('input,textarea,select')].some(el=>{if(el.closest?.('[hidden],template'))return false;return el.type==='checkbox'||el.type==='radio'?el.checked!==el.defaultChecked:el.tagName==='SELECT'?[...el.options].some(o=>o.selected!==o.defaultSelected):el.value!==el.defaultValue;}))return true;
    if(doc.querySelector('[data-prototype-attachments] [data-mobile-attachment],.sixbot-mobile__selections [data-mobile-attachment]'))return true;
    if([...doc.querySelectorAll('.sixbot-composer__input,.sixbot-mobile__input')].some(el=>el.textContent?.trim()||el.querySelector?.('[data-mobile-skill],.sixbot-skill-token,.sixbot-query-token')))return true;
  }return false;
}
function reloadUpdatedWorkbench(){
  if(runtimeUpdateBlocked())return false;
  try{
    saveCanvasCamera();saveView();const viewport=$('#page-viewport');
    sessionStorage.setItem('yuanxing-runtime-return:'+location.pathname,JSON.stringify({moduleId,current,selected,camera,cameras,flowContext,linesHidden,recycleOpen,view:typeof documentMode!=='undefined'&&documentMode?'document':'review',documentScroll:$('#document-view')?.scrollTop||0,scroll:[viewport?.scrollLeft||0,viewport?.scrollTop||0]}));
  }catch{return false;}
  location.reload();return true;
}
function restoreRuntimeView(){
  try{
    const key='yuanxing-runtime-return:'+location.pathname,value=sessionStorage.getItem(key);if(!value)return;const saved=JSON.parse(value);sessionStorage.removeItem(key);
    if(!model.modules.some(m=>m.id===saved.moduleId))return;
    moduleId=saved.moduleId;current=model.nodes.some(n=>n.id===saved.current)?saved.current:null;selected=saved.selected;
    if(selected?.type==='node'&&!node(selected.id)||selected?.type==='nodes'&&selected.ids.some(id=>!node(id)))selected=null;
    camera=saved.camera;cameras=saved.cameras;flowContext=saved.flowContext;linesHidden=saved.linesHidden;recycleOpen=saved.recycleOpen;if(saved.view==='document'&&typeof documentView!=='undefined'){documentMode=true;documentView.enter();}renderAll();
    requestAnimationFrame(()=>{const viewport=$('#page-viewport');if(viewport){viewport.scrollLeft=saved.scroll[0];viewport.scrollTop=saved.scroll[1];if(saved.view==='document'&&$('#document-view'))$('#document-view').scrollTop=saved.documentScroll||0;}});
  }catch{/* 无法恢复时仍保留普通视图偏好。 */}
}
async function refreshSources(){
  if(readonly||document.hidden||dirty||saving||conflict||sourceRefreshFlight||pendingImages.size||activeCanvasGesture||cancelConnection||annotationEditorId)return;
  if(runtimeUpdateBlocked())return;
  const requestedRevision=revision;sourceRefreshFlight=true;
  try{
    const metadata=await fetch(apiBase+'/api/project/status');if(!metadata.ok)return;const status=await metadata.json();
    if(dirty||saving||revision!==requestedRevision||pendingImages.size||activeCanvasGesture||cancelConnection||annotationEditorId)return;
    if(status.runtimeVersion&&loadedRuntimeVersion&&status.runtimeVersion!==loadedRuntimeVersion){if(pendingRuntimeVersion!==status.runtimeVersion){pendingRuntimeVersion=status.runtimeVersion;return;}reloadUpdatedWorkbench();return;}
    pendingRuntimeVersion=null;
    if(status.revision===revision&&status.sourceVersion===bundle.sourceVersion)return;
    const r=await fetch(apiBase+'/api/project');if(!r.ok)return;const next=await r.json();
    // 请求发出后可能发生剪切、粘贴及保存；旧响应不能替换更新后的本地状态。
    if(dirty||saving||revision!==requestedRevision||pendingImages.size||activeCanvasGesture||cancelConnection||annotationEditorId||runtimeUpdateBlocked()||document.activeElement?.matches('input,textarea,[contenteditable]'))return;
    if(next.revision!==revision){model=next.model;baseModel=clone(model);revision=next.revision;history.clear();bundle=next;selected=null;if(!node(current))current=null;renderAll();}
    else {next.images={...bundle.images,...next.images};const changed=next.sourcesSignature!==bundle.sourcesSignature,currentChanged=current&&canvasPreviewSignature(node(current),next)!==canvasPreviewSignature(node(current),bundle);bundle=next;if(changed){positions={};missing.clear();if(documentMode)documentView.render();else if(current){if(currentChanged)viewer();renderInspector();}else canvas();}}
  }catch{/* 本地服务暂不可用，已编辑内容留在内存，保存操作负责提示与重试。 */}
  finally{sourceRefreshFlight=false;}
}
try{if(boot.bundle){bundle=boot.bundle;model=bundle.model;flowContext=clone(model.contextDefaults||{});baseModel=clone(model);}else await reload(false);loadedRuntimeVersion??=bundle.runtimeVersion;let restored=null;try{restored=restoreView(model,JSON.parse(localStorage.getItem(viewKey())||'null'));}catch{}moduleId=restored?.moduleId||model.entryModule||model.modules[0]?.id;current=restored?.current||null;selected=current?{type:'node',id:current}:null;if(restored){camera=restored.camera||camera;cameras=restored.cameras;flowContext=restored.flowContext;linesHidden=restored.linesHidden;}if(documentMode){documentView.enter();renderAll();}else if(experience)startExperience(boot.flow);else{renderAll();if(!current&&!restored?.camera)fit();}viewReady=true;restoreRuntimeView();saveView();if(!readonly){setInterval(refreshSources,3500);}}catch(error){notice('无法打开工作台：'+error.message,[['重试',()=>location.reload()]]);}
