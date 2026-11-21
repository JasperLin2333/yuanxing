import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {exportDocumentMarkdown} from '../runtime/document.mjs';
const app=await readFile(new URL('../runtime/app.mjs',import.meta.url),'utf8');
const documentSource=await readFile(new URL('../runtime/document.mjs',import.meta.url),'utf8');

test('导出菜单仅提供导出工作台与导出需求文档(.md)，并等待文字保存',async()=>{
  const index=await readFile(new URL('../runtime/index.html',import.meta.url),'utf8'),menu=index.match(/<div id="export-options"[\s\S]*?<\/div>/)[0];
  assert.deepEqual([...menu.matchAll(/data-action="([^"]+)"/g)].map(match=>match[1]),['export-all','export-document']);
  const calls=[],elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{firstChild:{textContent:''},hidden:true});return elements.get(id);};
  const model={title:'项目',modules:[{id:'main',title:'主流程'}],nodes:[{id:'p1',module:'main',title:'列表',kind:'html'}],edges:[],document:{version:1,title:'项目需求文档',blocks:[{id:'b1',type:'text',format:'heading1',text:'1. 概述'},{id:'b2',type:'source',path:'需求/prd.md',section:'2. 详情'},{id:'b3',type:'prototype',node:'p1'},{id:'b4',type:'table',rows:[{id:'r1',cells:[{id:'c1',blocks:[{id:'t1',type:'text',text:'字段'}]},{id:'c2',blocks:[{id:'t2',type:'text',text:'说明'}]}]},{id:'r2',cells:[{id:'c3',blocks:[{id:'t3',type:'text',text:'名称'}]},{id:'c4',blocks:[{id:'t4',type:'text',text:'必填'}]}]}]}]}};
  const bundle={documentSources:{[JSON.stringify(['需求/prd.md','2. 详情',false])]:'## 2. 详情\n\n<span style="color:#d92d20">重点要求</span>\n\n![图1](assets/source-1.png)'},documentImagePaths:{[JSON.stringify(['需求/prd.md','2. 详情',false])]:{'assets/source-1.png':'../artifact/assets/demo.png'}}};
  const state={exporting:false,conflict:false,dirty:false,readonly:false,originalReadonly:false,$:get,closeMenus(){},documentView:{async flush(){calls.push('文字保存');}},pendingImages:new Set(),saveFlight:null,async save(){calls.push('编排保存');},apiBase:'',token:'session',moduleId:'main',model,bundle,explanationText:()=>'',exportDocumentMarkdown,async fetch(url,options){calls.push(JSON.parse(options.body));return {ok:true,text:async()=>'<html>工作台</html>'};},download(content,name,type){calls.push(['download',content,name,type]);},notice(){}};
  const context=vm.createContext(state);vm.runInContext(app.slice(app.indexOf('async function exportFile('),app.indexOf('\nconst imageTypes=')),context);

  await context.exportFile('review');
  assert.deepEqual(calls.slice(0,2),['文字保存','编排保存']);
  assert.equal(calls[2].module,null);assert.equal(calls[2].view,'review');
  assert.deepEqual(calls[3],['download','<html>工作台</html>','项目-完整评审台.html','text/html']);

  calls.length=0;
  await context.exportFile('document');
  assert.deepEqual(calls.slice(0,2),['文字保存','编排保存']);
  assert.equal(calls.length,3);
  assert.equal(calls[2][0],'download');
  assert.equal(calls[2][2],'项目-需求文档.md');
  assert.equal(calls[2][3],'text/markdown;charset=utf-8');
  assert.match(calls[2][1],/^# 项目需求文档\n\n## 1\. 概述\n\n## 2\. 详情\n\n重点要求\n\n!\[图1\]\(\.\.\/artifact\/assets\/demo\.png\)\n\n\| 字段 \| 说明 \|\n\| --- \| --- \|\n\| 名称 \| 必填 \|\n$/);

  state.documentView.flush=async()=>{throw new Error('原文冲突');};calls.length=0;await assert.rejects(context.exportFile('document'),/原文冲突/);assert.equal(calls.length,0);assert.equal(get('#export-trigger').disabled,false);
});

test('离线分享支持导出离线工作台 HTML 或需求文档 MD，且不连接服务器',async()=>{
  const calls=[],trigger={firstChild:{textContent:''}},state={exporting:false,conflict:false,readonly:true,originalReadonly:true,offlineSource:'完整离线源码',model:{title:'示例',modules:[],nodes:[],edges:[],document:{version:1,title:'示例PRD',blocks:[{id:'t',type:'text',text:'正文内容'}]}},bundle:{},explanationText:()=>'',exportDocumentMarkdown,$:()=>trigger,closeMenus(){},offlineExportHTML(source,view){calls.push([source,view]);return '离线 HTML';},download(content,name,type){calls.push([content,name,type]);},fetch(){throw new Error('离线导出不得联网');}};
  const context=vm.createContext(state);vm.runInContext(app.slice(app.indexOf('async function exportFile('),app.indexOf('\nconst imageTypes=')),context);
  await context.exportFile('review');
  assert.deepEqual(calls[0],['完整离线源码','review']);
  assert.deepEqual(calls[1],['离线 HTML','示例-完整评审台.html','text/html']);
  assert.equal(trigger.disabled,false);

  calls.length=0;
  await context.exportFile('document');
  assert.deepEqual(calls[0],['# 示例PRD\n\n正文内容\n','示例-需求文档.md','text/markdown;charset=utf-8']);
  assert.equal(trigger.disabled,false);
});

test('需求文档使用同一个顶栏侧栏按钮，折叠目录不改画布偏好，文档没有结构编辑控件',()=>{
  const elements=new Map(),get=key=>{if(!elements.has(key))elements.set(key,{classList:{toggle(){}},attrs:{},setAttribute(name,value){this.attrs[name]=value;}});return elements.get(key);};let open=true,writes=0;
  const state={documentMode:true,panels:{sidebar:true,inspector:true},documentView:{isOutlineOpen:()=>open,toggleOutline(){open=!open;}},$:get,document:{querySelector:get},localStorage:{setItem(){writes++;}},resizePage(){throw new Error('文档折叠不触发画布缩放');}};
  const context=vm.createContext(state);vm.runInContext(app.slice(app.indexOf('function renderPanels('),app.indexOf('function installControlTooltips(')),context);context.renderPanels();context.togglePanel('sidebar');
  const control=get('[data-action="panel-sidebar"]');assert.equal(open,false);assert.equal(control.attrs['aria-controls'],'yuanxing-document-outline');assert.equal(control.attrs['aria-expanded'],'false');assert.equal(state.panels.sidebar,true);assert.equal(writes,0);
  state.documentMode=false;context.renderPanels();assert.equal(control.attrs['aria-controls'],'sidebar');assert.equal(control.attrs['aria-expanded'],'true');
  assert.doesNotMatch(documentSource.slice(documentSource.indexOf('export function createDocumentView(')),/doc-toolbar|doc-format|doc-grip|draggable|addControl|doc-column-resizer/);
});

test('连续文字修订逐次保存，保存期间的新输入和引用改名均保留；失败时保留草稿',async()=>{
  const binding={id:'source',key:'old-key',version:'v0',before:'原文'},drafts=new Map([[binding,'第一处修改']]),bindings=new Set([binding]);let complete;const gate=new Promise(resolve=>complete=resolve),requests=[];
  const state={active:true,sourceTimer:null,sourceFlight:null,sourceStructureChanged:false,drafts,bindings,clearTimeout(){},host:{async saveSource(change){requests.push(change);if(requests.length===1){await gate;return {beforeVersions:{'old-key':'v0'},keyChanges:{'old-key':'new-key'},documentSourceVersions:{'new-key':'v1'}};}return {beforeVersions:{'new-key':'v1'},keyChanges:{'new-key':'new-key'},documentSourceVersions:{'new-key':'v2'}};}}};
  const context=vm.createContext(state),source=documentSource.slice(documentSource.indexOf('  function flushSources(){'),documentSource.indexOf('  function pasteText('));vm.runInContext(source,context);
  const flight=context.flushSources();drafts.set(binding,'继续修订');complete();await flight;assert.equal(requests.length,2);assert.equal(requests[1].key,'new-key');assert.equal(requests[1].version,'v1');assert.equal(requests[1].before,'第一处修改');assert.equal(binding.before,'继续修订');assert.equal(drafts.size,0);
  drafts.set(binding,'未保存输入');state.host.saveSource=async()=>{throw new Error('源文件冲突');};await assert.rejects(context.flushSources(),/源文件冲突/);assert.equal(drafts.get(binding),'未保存输入');
});

test('删除引用正文行后，排队的下一行编辑使用更新后的行号',async()=>{
  const removed={id:'first',key:'source',version:'v0',line:1,before:'原文',editor:{}};
  const following={id:'first',key:'source',version:'v0',line:2,before:'后续段落'};
  const drafts=new Map([[removed,null],[following,'修改后的段落']]);
  const requests=[];
  let rendered=false;
  const state={
    active:true,sourceTimer:null,sourceFlight:null,sourceStructureChanged:false,
    drafts,bindings:new Set([removed,following]),clearTimeout(){},
    render(){rendered=true;},
    host:{async saveSource(change){
      requests.push(change);
      if(change.removeLine)return {
        beforeVersions:{source:'v0'},keyChanges:{source:'source'},documentSourceVersions:{source:'v1'},
        sourceLineShifts:{source:{removed:1,offset:0}},
      };
      return {beforeVersions:{source:'v1'},keyChanges:{source:'source'},documentSourceVersions:{source:'v2'}};
    }},
  };
  const context=vm.createContext(state);
  vm.runInContext(documentSource.slice(documentSource.indexOf('  function flushSources(){'),documentSource.indexOf('  function pasteText(')),context);
  await context.flushSources();
  assert.equal(requests[0].removeLine,true);
  assert.equal(requests[1].line,1);
  assert.equal(requests[1].version,'v1');
  assert.equal(requests[1].before,'后续段落');
  assert.equal(drafts.size,0);
  assert.equal(rendered,true);
});

test('画布图片节点不显示替换图片按钮；进入详情把缩放工具栏移入顶栏右侧；快速上手弹窗可开关',async()=>{
  const index=await readFile(new URL('../runtime/index.html',import.meta.url),'utf8');
  assert.match(index,/<div id="viewer-actions" class="viewer-actions"><button id="viewer-image-trigger"/);
  assert.doesNotMatch(app,/node-image-actions/);

  const detach=item=>{if(item.parentNode){const i=item.parentNode.children.indexOf(item);if(i>=0)item.parentNode.children.splice(i,1);}};
  const el=(tag='div')=>{const node={tag,children:[],style:{},dataset:{},className:'',attrs:{},classList:{toggle(){},add(){},remove(){}},
    append(...items){for(const item of items)if(item&&typeof item==='object'){detach(item);item.parentNode=this;this.children.push(item);}},
    prepend(...items){for(const item of [...items].reverse())if(item&&typeof item==='object'){detach(item);item.parentNode=this;this.children.unshift(item);}},
    insertBefore(item,ref){detach(item);const idx=this.children.indexOf(ref);item.parentNode=this;if(idx>=0)this.children.splice(idx,0,item);else this.children.push(item);},
    replaceChildren(){this.children=[];},setAttribute(k,v){this.attrs[k]=v;},querySelectorAll(){return [];},querySelector(s){return s==='.zoom-settings'?zoomSettings:null;},
    focus(){},showModal(){this.open=true;},close(){this.open=false;}};return node;};
  const zoomSettings={open:true},zoomTools=el('div'),viewerActions=el('div'),workspace=el('section'),docView=el('section'),handoffMenu=el('details'),guideDialog=el('dialog');
  workspace.append(docView,zoomTools);
  const elements=new Map([['#document-view',docView],['#viewer',el('div')],['#canvas-viewport',el('div')],['#recycle-empty',el('p')],['#viewer-image-trigger',el('button')],['#viewer-actions',viewerActions],['#workspace',workspace],['#handoff-menu',handoffMenu],['#guide-dialog',guideDialog],['#viewer [data-action="overview"]',el('button')]]);
  const get=sel=>{if(!elements.has(sel))elements.set(sel,el());return elements.get(sel);};
  const state={
    pendingModelRender:false,updatesView:{refresh(){}},renderExperience(){},model:{modules:[{id:'m',title:'主模块'}],nodes:[{id:'img1',module:'m',kind:'image',title:'截图'}]},
    annotationEditorId:null,closeAnnotationEditor(){},closeMenus(){},cancelConnection:null,moduleId:'m',current:'img1',selected:null,mode:null,recycleOpen:false,
    cameras:{},camera:{x:0,y:0,scale:1},clone:v=>JSON.parse(JSON.stringify(v)),readonly:false,originalReadonly:false,documentMode:false,
    document:{body:{classList:{toggle(){}}},querySelector:s=>s==='.zoom-tools'?zoomTools:get(s)},$:get,
    renderPanels(){},renderLineVisibility(){},sidebar(){},recycleNodes:()=>[],node:id=>state.model.nodes.find(n=>n.id===id),
    updateHistoryButtons(){},viewer(){},canvas(){},renderInspector(){},rememberView(){},
  };
  const context=vm.createContext(state);
  vm.runInContext(app.slice(app.indexOf('function renderAll('),app.indexOf('function fit(')),context);
  vm.runInContext(app.slice(app.indexOf('async function action('),app.indexOf("document.addEventListener('click'")),context);

  context.renderAll();
  assert.equal(zoomTools.parentNode,viewerActions);
  assert.equal(viewerActions.children[0],zoomTools);
  assert.equal(zoomSettings.open,false);

  state.current=null;
  context.renderAll();
  assert.equal(zoomTools.parentNode,workspace);
  assert.equal(workspace.children[0],zoomTools);

  handoffMenu.open=true;
  await context.action('open-guide');
  assert.equal(handoffMenu.open,false);
  assert.equal(guideDialog.open,true);
  await context.action('close-guide');
  assert.equal(guideDialog.open,false);
});
