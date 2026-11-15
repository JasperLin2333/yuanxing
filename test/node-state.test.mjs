import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {migrateNodeState,isDeletedNode,clone,validate,moduleNodes,recycleNodes,copyCanvasSelection,pasteCanvasSelection,mergeProject,History,restoreView} from '../runtime/core.mjs';
import {createStore,standalone} from '../runtime/server.mjs';
import {flowEntries} from '../runtime/player.mjs';
import {defaultDocument} from '../runtime/document.mjs';
import {searchCanvasPages} from '../runtime/library.mjs';
import {locateProject} from '../runtime/locate.mjs';
const page=(id,extra={})=>({id,module:'main',title:id,kind:'html',path:'pages/'+id+'.html',width:800,height:600,x:0,y:0,...extra});
const fixture=()=>({version:1,title:'节点状态',modules:[{id:'main',title:'流程',entry:'home'}],nodes:[page('home'),page('old-trash',{overview:false}),page('internal',{overview:false,canvas:false}),page('alias',{overview:false,overviewAlias:'home'})],edges:[{id:'to-internal',from:'home',to:'internal',selector:'#internal'},{id:'to-alias',from:'internal',to:'alias',selector:'#alias'},{id:'to-trash',from:'home',to:'old-trash',selector:'#trash'}],annotations:[]});
test('旧状态一次性迁移，保留内部状态和代表页关系，重复迁移不改变含义',()=>{
  const old=fixture(),before=clone(old),next=migrateNodeState(old);
  assert.deepEqual(old,before);assert.equal(next.nodeStateVersion,1);
  assert.deepEqual(recycleNodes(next).map(n=>n.id),['old-trash']);
  for(const id of ['home','internal','alias'])assert.equal(isDeletedNode(next,next.nodes.find(n=>n.id===id)),false);
  assert.deepEqual(migrateNodeState(next),next);
  next.nodes.push(page('new-hidden',{overview:false}));assert(!recycleNodes(next).some(n=>n.id==='new-hidden'));
  next.nodes.find(n=>n.id==='old-trash').deleted=false;assert.equal(recycleNodes(migrateNodeState(next)).length,0);
});
test('新格式隐藏与删除独立，已删除页面不进入目录、搜索、文档默认编排或播放入口',()=>{
  const model={...fixture(),nodeStateVersion:1};model.nodes.push(page('deleted-visible',{deleted:true}),page('deleted-internal',{deleted:true,canvas:false}));
  assert.deepEqual(recycleNodes(model).map(n=>n.id),['deleted-visible','deleted-internal']);
  assert.deepEqual(moduleNodes(model,'main').map(n=>n.id),['home']);
  assert.deepEqual(searchCanvasPages(model,'deleted'),[]);assert(defaultDocument(model).blocks.every(block=>!block.node?.startsWith('deleted')));
  model.experiences=[{id:'bad',title:'已删除入口',entry:'deleted-visible'},{id:'hidden',title:'隐藏入口',entry:'old-trash'}];
  assert.deepEqual(flowEntries(model).map(flow=>flow.id),['hidden']);
  assert.equal(restoreView(model,{current:'deleted-visible'}).current,null);
  model.nodeStateVersion=2;assert(validate(model).includes('节点状态版本不支持'));model.nodeStateVersion=1;model.nodes[0].deleted='yes';assert(validate(model).some(error=>error.includes('删除状态')));
});
test('读取旧项目和定位不写迁移文件，正常保存后新隐藏状态不被重新判断为删除',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'yuanxing-node-state-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'artifact/pages'),{recursive:true});const old=fixture(),file=path.join(root,'artifact/workbench.json'),raw=JSON.stringify(old,null,2)+'\n';await fs.writeFile(file,raw);
  for(const node of old.nodes)await fs.writeFile(path.join(root,'artifact',node.path),'<button id="internal">内部</button>');
  const store=await createStore(root),loaded=await store.load();assert.equal(loaded.model.nodeStateVersion,1);assert.equal(await fs.readFile(file,'utf8'),raw);
  assert.equal((await locateProject(root,{query:'old-trash'})).pages.length,0);assert.equal((await locateProject(root,{query:'alias'})).pages[0].id,'alias');assert.equal(await fs.readFile(file,'utf8'),raw);
  loaded.model.nodes.push(page('new-hidden',{kind:'note',path:undefined,overview:false}));await store.save(loaded.model,loaded.revision,loaded.model);
  const saved=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(saved.nodeStateVersion,1);assert.equal(saved.nodes.find(n=>n.id==='old-trash').deleted,true);
  assert(!recycleNodes((await store.readModel()).model).some(n=>n.id==='new-hidden'));
});
test('旧共同基线与已迁移编辑可合并，隐藏、删除、独立文案修改互不覆盖',()=>{
  const base=fixture(),local=migrateNodeState(base),remote=clone(base);local.nodes[0].overview=false;remote.nodes[0].description='外部修改';
  const merged=mergeProject(base,local,remote);assert.deepEqual(merged.conflicts,[]);assert.equal(merged.model.nodes[0].overview,false);assert.equal(merged.model.nodes[0].description,'外部修改');
  assert.deepEqual(recycleNodes(merged.model).map(n=>n.id),['old-trash']);
  local.nodes.find(n=>n.id==='old-trash').deleted=false;assert.equal(recycleNodes(mergeProject(base,local,remote).model).length,0);
});
test('跨版本复制保留内部状态，复制到删除区与恢复后可撤销',()=>{
  const source=migrateNodeState(fixture()),target=fixture(),clipboard=copyCanvasSelection(source,'main',['home']);
  const history=new History();history.push(target);const ids=pasteCanvasSelection(target,'main',clipboard);
  assert.equal(clipboard.nodeStateVersion,1);assert.equal(ids.length,2);assert.deepEqual(recycleNodes(target).map(n=>n.id),['old-trash']);assert(target.nodes.some(n=>n.id===ids[1]&&n.overviewAlias===ids[0]));
  assert.deepEqual(history.undo(target),fixture());
  const deleted=pasteCanvasSelection(target,'main',clipboard,[100,100],{recycle:true});assert(deleted.every(id=>recycleNodes(target).some(n=>n.id===id)));
  const recovered=copyCanvasSelection(target,'main',deleted,{recycle:true}),restored=pasteCanvasSelection(target,'main',recovered);
  assert(restored.every(id=>moduleNodes(target,'main').some(n=>n.id===id)));assert(recovered.nodes.every(n=>!n.deleted&&n.canvas!==false&&n.overview!==false));assert.deepEqual(validate(target),[]);
});
test('未知节点状态版本的粘贴先提示并拒绝导入，不改目标文件或输入',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'yuanxing-clipboard-state-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'artifact'),{recursive:true});const target={version:1,nodeStateVersion:1,title:'目标',modules:[{id:'main',title:'主流程'}],nodes:[],edges:[],annotations:[]},file=path.join(root,'artifact/workbench.json'),raw=JSON.stringify(target);
  await fs.writeFile(file,raw);const clipboard={nodeStateVersion:2,nodes:[page('unknown',{kind:'note',path:undefined,description:'未来版本内容'})],edges:[],annotations:[]},before=structuredClone(clipboard),notices=[];
  const source=await fs.readFile(new URL('../runtime/app.mjs',import.meta.url),'utf8'),start=source.indexOf('function pasteSelection('),end=source.indexOf('function duplicateSelection()',start);
  assert(start>=0&&end>start);const paste=new Function('validate','model','originalReadonly','recycleOpen','moduleId','notice',source.slice(start,end)+'\nreturn pasteSelection;')(validate,target,false,false,'main',message=>notices.push(message));
  assert.doesNotThrow(()=>paste(clipboard,null,{module:'main',bin:false}));assert.equal(notices.length,1);assert.match(notices[0],/节点状态版本/);assert.equal(target.nodes.length,0);
  const store=await createStore(root);await assert.rejects(store.importClipboard(clipboard),/节点状态版本/);assert.equal(await fs.readFile(file,'utf8'),raw);assert.deepEqual(await fs.readdir(path.join(root,'artifact')),['workbench.json']);assert.deepEqual(clipboard,before);
  for(const nodeStateVersion of [undefined,1]){const input={...clipboard,nodeStateVersion},imported=await store.importClipboard(input);assert.equal(imported.nodeStateVersion,1);assert.equal(imported.nodes[0].id,'unknown');}
});
test('三种离线视图保留新隐藏和旧内部页面，排除显式及旧格式删除页面且不改原编排',async()=>{
  for(const legacy of [true,false]){
    const model=legacy?fixture():migrateNodeState(fixture());if(!legacy)model.nodes.push(page('new-hidden',{overview:false}),page('deleted-visible',{deleted:true}),page('deleted-branch',{kind:'note',presentation:'branch',deleted:true,description:'discarded-branch-detail'}),page('deleted-hidden',{canvas:false,deleted:true}));
    if(!legacy)model.edges.push({id:'branch-in',from:'home',to:'deleted-branch',diagram:true},{id:'branch-out',from:'deleted-branch',to:'internal',diagram:true});
    const resources=Object.fromEntries(model.nodes.map(n=>[n.id,'<p>'+n.id+'</p>'])),bundle={model,resources,fragments:{},images:{}},before=clone(bundle);
    for(const view of ['review','prototype','document']){
      const html=await standalone(bundle,{view}),saved=JSON.parse(html.match(/globalThis\.YUANXING_BOOT=([\s\S]*?);<\/script>/)[1]).bundle.model;
      assert.doesNotMatch(html,/discarded-branch-detail/);assert.equal(saved.nodeStateVersion,1);assert(saved.nodes.some(n=>n.id==='internal'));assert(saved.nodes.some(n=>n.id==='alias'));
      if(!legacy)assert(saved.nodes.some(n=>n.id==='new-hidden'));
      assert(!saved.nodes.some(n=>['old-trash','deleted-visible','deleted-branch','deleted-hidden'].includes(n.id)));assert(!saved.edges.some(e=>e.to==='old-trash'));assert.deepEqual(validate(saved),[]);
    }
    assert.deepEqual(bundle,before);
  }
});
