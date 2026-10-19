import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {clone,mergeProject,validate} from '../runtime/core.mjs';
import {createStore} from '../runtime/server.mjs';
import {run} from '../scripts/yuanxing.mjs';
const fixture=()=>({version:1,title:'协作项目',entryModule:'main',modules:[{id:'main',title:'主要流程',entry:'one'}],nodes:[{id:'one',module:'main',title:'客户列表',description:'原文案',kind:'html',path:'pages/one.html',width:1280,height:800,x:60,y:60}],edges:[],annotations:[]});
async function project(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'yuanxing-collaboration-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'artifact/pages'),{recursive:true});const file=path.join(root,'artifact/workbench.json');await fs.writeFile(file,JSON.stringify(fixture(),null,2)+'\n');await fs.writeFile(path.join(root,'artifact/pages/one.html'),'<h1>客户列表</h1>');return {root,file,store:await createStore(root)};}
test('人调整位置、AI 改文案及其他页面，按字段合并并保留新增项',()=>{
 const base=fixture(),local=clone(base),remote=clone(base);local.nodes[0].x=240;remote.nodes[0].description='AI 新文案';remote.nodes.push({...clone(remote.nodes[0]),id:'two'});
 const result=mergeProject(base,local,remote);assert.deepEqual(result.conflicts,[]);assert.equal(result.model.nodes[0].x,240);assert.equal(result.model.nodes[0].description,'AI 新文案');assert.equal(result.model.nodes.length,2);assert.equal(base.nodes[0].x,60);
});
test('同字段及删除对修改产生冲突，双方选择可还原，不静默覆盖',()=>{
 const base=fixture(),local=clone(base),remote=clone(base);local.nodes[0].title='我的标题';remote.nodes[0].title='AI 标题';
 assert.deepEqual(mergeProject(base,local,remote).conflicts,['nodes/one/title']);assert.equal(mergeProject(base,local,remote,{prefer:'remote'}).model.nodes[0].title,'AI 标题');assert.equal(local.nodes[0].title,'我的标题');
 remote.nodes=[];assert.deepEqual(mergeProject(base,local,remote).conflicts,['nodes/one']);assert.equal(mergeProject(base,local,remote).model.nodes.length,1);assert.equal(mergeProject(base,local,remote,{prefer:'remote'}).model.nodes.length,0);
});
test('不同属性的删除与新增合并，坐标数组的同时修改保留冲突',()=>{
 const base=fixture();base.nodes[0].point=[1,2];const local=clone(base),remote=clone(base);delete local.nodes[0].description;remote.nodes[0].extra='新增';
 const result=mergeProject(base,local,remote);assert.deepEqual(result.conflicts,[]);assert(!('description' in result.model.nodes[0]));assert.equal(result.model.nodes[0].extra,'新增');
 local.nodes[0].point=[3,2];remote.nodes[0].point=[1,4];assert(mergeProject(base,local,remote).conflicts.includes('nodes/one/point'));
});
test('网页与独立 AI 保存使用共同基线，跨进程锁下可合并独立编辑',async t=>{
 const {root,file,store}=await project(t),other=await createStore(root),base=await store.readModel(),local=clone(base.model),remote=clone(base.model);local.nodes[0].x=400;remote.nodes[0].description='AI 内容';
 const results=await Promise.all([store.save(local,base.revision,base.model),other.save(remote,base.revision,base.model)]);assert.equal(results.length,2);
 const saved=JSON.parse(await fs.readFile(file));assert.equal(saved.nodes[0].x,400);assert.equal(saved.nodes[0].description,'AI 内容');assert(!(await fs.readdir(path.dirname(file))).some(n=>n.endsWith('.lock')||n.endsWith('.tmp')));
});
test('同一字段同时保存返回双方版本及冲突位置，磁盘保留先保存的版本',async t=>{
 const {store}=await project(t),base=await store.readModel(),local=clone(base.model),remote=clone(base.model);local.title='网页标题';remote.title='外部标题';await store.save(remote,base.revision,base.model);
 await assert.rejects(store.save(local,base.revision,base.model),e=>e.status===409&&e.details.model.title==='外部标题'&&e.details.conflicts[0]==='title');assert.equal((await store.readModel()).model.title,'外部标题');assert.equal(local.title,'网页标题');
});
test('AI apply 基于原始快照合并已发生的网页修改',async t=>{
 const {root,store}=await project(t),base=await store.readModel(),raw=JSON.stringify(base.model,null,2)+'\n',next=clone(base.model),local=clone(base.model);next.nodes[0].description='AI 方案';local.nodes[0].y=320;await store.save(local,base.revision,base.model);
 const baseline=path.join(root,'base.json'),changed=path.join(root,'changed.json');await fs.writeFile(baseline,raw);await fs.writeFile(changed,JSON.stringify(next));await run(['apply','--root',root,'--base',baseline,'--model',changed]);
 const saved=await store.readModel();assert.equal(saved.model.nodes[0].y,320);assert.equal(saved.model.nodes[0].description,'AI 方案');
});
const app=await fs.readFile(new URL('../runtime/app.mjs',import.meta.url),'utf8');
function runtimeContext(){
 const storage=new Map(),viewport={scrollLeft:10,scrollTop:20},state={devMode:false,conflict:false,experience:false,exporting:false,dirty:false,saving:false,pendingImages:new Set(),activeCanvasGesture:null,cancelConnection:null,annotationEditorId:null,frames:{},moduleId:'main',current:'one',selected:{type:'node',id:'one'},camera:{x:8,y:9,scale:.6},cameras:{},flowContext:{},linesHidden:true,recycleOpen:false,model:fixture(),document:{activeElement:null,querySelector:()=>null},sessionStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)},location:{pathname:'/p/test/',reload(){state.reloaded=(state.reloaded||0)+1;}},saveCanvasCamera(){},saveView(){},$:()=>viewport,node:id=>state.model.nodes.find(n=>n.id===id),requestAnimationFrame:fn=>fn(),renderAll(){state.rendered=true;}};
 const context=vm.createContext(state);vm.runInContext(app.slice(app.indexOf('function runtimeUpdateBlocked(){'),app.indexOf('async function refreshSources(){')),context);return {state:context,storage,viewport};
}
test('自动重载避开未保存编辑、拖动、弹窗和完整原型体验，空闲时保存位置',()=>{
 const {state,storage}=runtimeContext();for(const key of ['dirty','saving','conflict','experience','exporting','activeCanvasGesture','annotationEditorId']){state[key]=true;assert.equal(state.reloadUpdatedWorkbench(),false);state[key]=false;}
 state.document.activeElement={matches:()=>true};assert.equal(state.reloadUpdatedWorkbench(),false);state.document.activeElement=null;
 state.document.querySelector=()=>({});assert.equal(state.reloadUpdatedWorkbench(),false);state.document.querySelector=()=>null;
 assert.equal(state.reloadUpdatedWorkbench(),true);assert.equal(state.reloaded,1);assert.equal(storage.size,1);
 state.camera={};state.current=null;state.restoreRuntimeView();assert.equal(state.current,'one');assert.equal(state.camera.scale,.6);assert.equal(state.rendered,true);assert.equal(storage.size,0);
});
test('原型内仍在执行、上传或输入未提交时不自动重载，存储失败也不重载',()=>{
 const {state}=runtimeContext(),doc={activeElement:null,querySelector:()=>({}),querySelectorAll:()=>[]};state.frames={one:{isConnected:true,contentDocument:doc}};assert.equal(state.reloadUpdatedWorkbench(),false);
 doc.querySelector=()=>null;doc.querySelectorAll=()=>[{type:'text',value:'尚未提交',defaultValue:''}];assert.equal(state.reloadUpdatedWorkbench(),false);
 state.frames={};state.sessionStorage.setItem=()=>{throw Error('无法存储');};assert.equal(state.reloadUpdatedWorkbench(),false);assert(!state.reloaded);
});
test('保存响应返回前的新编辑保留，AI 的独立文案也合入且继续保存',async()=>{
 let respond;const baseline=fixture(),snapshot=clone(baseline),state={baseModel:clone(baseline),model:snapshot,revision:'v1',saveFlight:null,originalReadonly:false,dirty:true,conflict:false,saving:false,apiBase:'',token:'test',clone,mergeProject,validate,history:{clear(){},push(){}},updateHistoryButtons(){},notice(){},download(){},renderAll(){},scheduleSave(){state.scheduled=true;},$:()=>({dataset:{},hidden:false}),fetch:()=>new Promise(resolve=>respond=resolve)};
 const context=vm.createContext(state);vm.runInContext(app.slice(app.indexOf('async function save(){'),app.indexOf('async function reload(',app.indexOf('async function save(){'))),context);
 const pending=context.save();context.model.nodes[0].x=880;const saved=clone(baseline);saved.nodes[0].description='AI 修改';respond({ok:true,status:200,json:async()=>({revision:'v2',model:saved})});await pending;
 assert.equal(context.model.nodes[0].x,880);assert.equal(context.model.nodes[0].description,'AI 修改');assert.equal(context.baseModel.nodes[0].x,60);assert.equal(context.dirty,true);assert.equal(state.scheduled,true);
});
test('并发新增模块保留各自插入位置，同一列表被不同方式重排提示冲突',()=>{
 const base=fixture();base.modules=[{id:'a'},{id:'b'},{id:'c'}];const local=clone(base),remote=clone(base);local.modules.splice(1,0,{id:'new'});remote.modules[0].title='新标题';
 assert.deepEqual(mergeProject(base,local,remote).model.modules.map(m=>m.id),['a','new','b','c']);local.modules=[base.modules[1],base.modules[0],base.modules[2]];remote.modules.reverse();assert(mergeProject(base,local,remote).conflicts.includes('modules/@order'));
});
test('前端代码版本变化触发自动重载，编辑中的更新等待空闲，普通内容变化仍同步',async()=>{
 const source=app.slice(app.indexOf('async function refreshSources(){'),app.indexOf('try{if(boot.bundle)'));
 const model=fixture(),state={readonly:false,document:{hidden:false,activeElement:null},dirty:false,saving:false,conflict:false,sourceRefreshFlight:false,pendingImages:new Set(),activeCanvasGesture:null,cancelConnection:null,annotationEditorId:null,revision:'v1',bundle:{sourceVersion:'sources',runtimeVersion:'old'},loadedRuntimeVersion:'old',pendingRuntimeVersion:null,apiBase:'',model,baseModel:clone(model),clone,current:null,selected:null,history:{clear(){}},renderAll(){state.renders=(state.renders||0)+1;},runtimeUpdateBlocked:()=>state.busy,reloadUpdatedWorkbench(){state.reloads=(state.reloads||0)+1;},fetch:async()=>({ok:true,json:async()=>({revision:'v1',sourceVersion:'sources',runtimeVersion:'new'})})};
 const context=vm.createContext(state);vm.runInContext(source,context);state.busy=true;await context.refreshSources();assert(!state.reloads);state.busy=false;await context.refreshSources();assert(!state.reloads);await context.refreshSources();assert.equal(state.reloads,1);
});
test('服务监视保持保存令牌、仅首次打开页面，后端更新可自动重启而不重复开页',async()=>{
 const cli=await fs.readFile(new URL('../scripts/yuanxing.mjs',import.meta.url),'utf8'),source=cli.slice(cli.indexOf("  if(command==='serve'&&!process.env.YUANXING_WATCH_CHILD){"),cli.indexOf("  if(command==='init'){"));
 const events={},handlers={},output=[],opened=[],spawned=[];const child={stdout:{on(event,fn){handlers[event]=fn;}},once(event,fn){events[event]=fn;},kill(){}};
 const state={command:'serve',flags:{open:true},args:['serve','--root','/tmp/项目','--open'],sessionToken:'unchanged-token',process:{env:{},execPath:'node',platform:'darwin',stdout:{write:data=>output.push(data)},once(){},removeListener(){}},spawn:(...values)=>(spawned.push(values),child),fileURLToPath:()=>'/skill/scripts/yuanxing.mjs',execFile:(...values)=>opened.push(values),randomBytes(){throw Error('已有令牌不应重新生成');},console};
 // 仅执行启动编排，使用假的子进程，不启动服务或浏览器。
 const fn=vm.runInContext('(async function(){'+source.replace('import.meta.url',"'file:///skill/scripts/yuanxing.mjs'")+'})',vm.createContext(state));await fn();
 assert(spawned[0][1].includes('--watch'));assert(!spawned[0][1].includes('--open'));assert.equal(spawned[0][2].env.YUANXING_SESSION_TOKEN,'unchanged-token');handlers.data('元形工作台：http://127.0.0.1:4318\n');handlers.data('元形工作台：http://127.0.0.1:4318\n');assert.equal(opened.length,1);
});

test('两个真实 AI 进程从同一基线同时保存，独立变更均保留',async t=>{
 const {root,store}=await project(t),base=await store.readModel(),left=clone(base.model),right=clone(base.model);left.nodes[0].x=720;right.nodes[0].description='另一个进程';
 const baseline=path.join(root,'base.json'),a=path.join(root,'left.json'),b=path.join(root,'right.json');await fs.writeFile(baseline,JSON.stringify(base.model,null,2)+'\n');await fs.writeFile(a,JSON.stringify(left));await fs.writeFile(b,JSON.stringify(right));
 await fs.writeFile(path.join(root,'artifact/workbench.json.lock'),JSON.stringify({pid:2147483647}));
 const cli=fileURLToPath(new URL('../scripts/yuanxing.mjs',import.meta.url));await Promise.all([a,b].map(file=>promisify(execFile)(process.execPath,[cli,'apply','--root',root,'--base',baseline,'--model',file])));
 const actual=(await store.readModel()).model;assert.equal(actual.nodes[0].x,720);assert.equal(actual.nodes[0].description,'另一个进程');
});
test('冲突选择只决定冲突项，冲突提示后继续编辑的独立内容也保留',()=>{
 const baseline=fixture(),local=clone(baseline),remote=clone(baseline);local.nodes[0].title='我的标题';remote.nodes[0].title='AI 标题';remote.nodes[0].description='AI 文案';
 const message={dataset:{}},state={clone,mergeProject,validate,model:local,baseModel:clone(baseline),revision:'old',conflict:false,conflictData:null,dirty:true,history:{push(){}},notice(text,actions){state.actions=actions;},download(){},renderAll(){},scheduleSave(){state.scheduled=true;}};
 const context=vm.createContext(state);vm.runInContext(app.slice(app.indexOf('function showCollaborationConflict('),app.indexOf('async function save(){')),context);
 context.showCollaborationConflict({model:remote,revision:'remote',conflicts:['nodes/one/title']},local,baseline);context.model.nodes[0].x=1000;context.resolveCollaborationConflict('remote');assert.equal(context.model.nodes[0].title,'AI 标题');assert.equal(context.model.nodes[0].description,'AI 文案');assert.equal(context.model.nodes[0].x,1000);assert.equal(context.conflict,false);assert.equal(context.dirty,true);
});
