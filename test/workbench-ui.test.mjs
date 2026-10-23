import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const app=await readFile(new URL('../runtime/app.mjs',import.meta.url),'utf8');
const documentSource=await readFile(new URL('../runtime/document.mjs',import.meta.url),'utf8');

test('导出菜单只有三种完整产物，导出等待文字保存并始终包含整个项目',async()=>{
  const index=await readFile(new URL('../runtime/index.html',import.meta.url),'utf8'),menu=index.match(/<div id="export-options"[\s\S]*?<\/div>/)[0];
  assert.deepEqual([...menu.matchAll(/data-action="([^"]+)"/g)].map(match=>match[1]),['export-all','export-document','export-prototype']);
  const calls=[],elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{firstChild:{textContent:''},hidden:true});return elements.get(id);};
  const state={exporting:false,conflict:false,dirty:false,$:get,closeMenus(){},documentView:{async flush(){calls.push('文字保存');}},pendingImages:new Set(),saveFlight:null,async save(){calls.push('编排保存');},apiBase:'',token:'session',moduleId:'main',model:{title:'项目'},async fetch(url,options){calls.push(JSON.parse(options.body));return {ok:true,text:async()=>'<html></html>'};},download(){},notice(){}};
  const context=vm.createContext(state);vm.runInContext(app.slice(app.indexOf('async function exportFile('),app.indexOf('\nconst imageTypes=')),context);
  for(const view of ['review','document','prototype']){calls.length=0;await context.exportFile(view);assert.deepEqual(calls.slice(0,2),['文字保存','编排保存']);assert.equal(calls[2].module,null);assert.equal(calls[2].view,view);}
  state.documentView.flush=async()=>{throw new Error('原文冲突');};calls.length=0;await assert.rejects(context.exportFile('document'),/原文冲突/);assert.equal(calls.length,0);assert.equal(get('#export-trigger').disabled,false);
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
  const state={active:true,sourceTimer:null,sourceFlight:null,drafts,bindings,clearTimeout(){},host:{async saveSource(change){requests.push(change);if(requests.length===1){await gate;return {beforeVersions:{'old-key':'v0'},keyChanges:{'old-key':'new-key'},documentSourceVersions:{'new-key':'v1'}};}return {beforeVersions:{'new-key':'v1'},keyChanges:{'new-key':'new-key'},documentSourceVersions:{'new-key':'v2'}};}}};
  const context=vm.createContext(state),source=documentSource.slice(documentSource.indexOf('  function flushSources(){'),documentSource.indexOf('  function pasteText('));vm.runInContext(source,context);
  const flight=context.flushSources();drafts.set(binding,'继续修订');complete();await flight;assert.equal(requests.length,2);assert.equal(requests[1].key,'new-key');assert.equal(requests[1].version,'v1');assert.equal(requests[1].before,'第一处修改');assert.equal(binding.before,'继续修订');assert.equal(drafts.size,0);
  drafts.set(binding,'未保存输入');state.host.saveSource=async()=>{throw new Error('源文件冲突');};await assert.rejects(context.flushSources(),/源文件冲突/);assert.equal(drafts.get(binding),'未保存输入');
});
