import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import vm from 'node:vm';
import {clone,validate,exportSubset,exportIssues,moduleNodes,orderedModuleNodes,canvasSections,overviewEdges,removeConnections,removeNodes,compactCanvas,reconnectEdge,createLineBranch,lineBranchSplit,connectNodes,snapNodePosition,nodesInRect,canvasSelection,snapNodeGroup,moveCanvasNodes,routeConnections,placeConnectionLabels,connectionDirections,adaptCanvasLayout,isBranch,canvasNodeWidth,canvasNodeHeight,autoLayout,History,markdown,expandHTML,descriptionImagePaths,readDescription,eligibleEdges,nextContext,connectionPoint,connectionPath,connectionRoute,restoreView} from '../runtime/core.mjs';
import {createStore,createHandler,standalone,safePath} from '../runtime/server.mjs';
import {copyCanvasSelection,pasteCanvasSelection,alignCanvasNodes,distributeCanvasNodes,nudgeCanvasNodes,recycleNodes,recycleCanvasNodes,moveRecycleNodes,cutCanvasSelection,imagePasteTarget,replaceCanvasImage,canvasClipboardAssets,canvasPreviewSignature} from '../runtime/core.mjs';
import {reconcileCanvasCards} from '../runtime/library.mjs';

const fixture=()=>({version:1,title:'测试项目',modules:[{id:'a',title:'模块甲',entry:'one'},{id:'b',title:'模块乙',entry:'two'},{id:'c',title:'模块丙',entry:'unused'}],nodes:[{id:'one',module:'a',title:'第一页',kind:'html',path:'states/one.html',width:1280,height:800,x:60,y:60},{id:'two',module:'b',title:'第二页',kind:'html',path:'states/two.html',width:375,height:812,x:60,y:60},{id:'unused',module:'c',title:'无关页面',kind:'note',width:640,height:320,x:60,y:60}],edges:[{id:'go',from:'one',to:'two',label:'下一步',selector:'#go'}],annotations:[{id:'pin',node:'one',point:[.3,.5],text:'原文案 → 新文案'},{id:'unrelated',node:'unused',text:'其他说明'}]});
test('普通提示五秒后消失，新提示重置计时，并支持手动关闭',async()=>{
  const app=await fs.readFile(new URL('../runtime/app.mjs',import.meta.url),'utf8'),source=app.slice(app.indexOf('function closeNotice(){'),app.indexOf('function updateHistoryButtons(){'));
  const timers=new Map(),message={dataset:{},hidden:true,children:[],replaceChildren(...children){this.children=children;},append(child){this.children.push(child);}};let serial=0;
  const state={noticeTimer:null,$:()=>message,document:{createTextNode:text=>({textContent:text}),createElement:()=>({setAttribute(key,value){this[key]=value;}})},setTimeout:(fn,delay)=>{timers.set(++serial,{fn,delay});return serial;},clearTimeout:id=>timers.delete(id)};
  vm.runInContext(source,vm.createContext(state));state.notice('没有可用通道');assert.equal(message.hidden,false);assert.equal(timers.size,1);assert.equal([...timers.values()][0].delay,5000);
  state.notice('另一条提示');assert.equal(timers.size,1);assert.equal(message.children[0].textContent,'另一条提示');[...timers.values()][0].fn();assert.equal(message.hidden,true);assert.equal(timers.size,0);
  state.notice('再次提示');const close=message.children.at(-1);assert.equal(close['aria-label'],'关闭提示');close.onclick();assert.equal(message.hidden,true);assert.equal(timers.size,0);
  let retried=false;state.notice('保存失败',[['重试',()=>retried=true]],'save');assert.equal(timers.size,0);message.children[1].onclick();assert.equal(retried,true);message.children.at(-1).onclick();assert.equal(message.hidden,true);
});
test('点击画布或面板外部收起灵敏度，调整滑杆及点击设置图标保持原有行为',async()=>{
  const app=await fs.readFile(new URL('../runtime/app.mjs',import.meta.url),'utf8'),source=app.slice(app.indexOf('function dismissZoomSettings('),app.indexOf('function imageMenu(')),settings={open:true};
  const context=vm.createContext({document:{querySelector:()=>settings}});vm.runInContext(source,context);
  context.dismissZoomSettings({target:{closest:()=>settings}});assert.equal(settings.open,true);
  context.dismissZoomSettings({target:{closest:()=>null}});assert.equal(settings.open,false);
  // 捕获阶段先于画布节点的 stopPropagation 执行，点空白或节点均能关闭。
  assert.match(app,/addEventListener\('pointerdown',dismissZoomSettings,true\)/);
});
test('剪贴板只携带所选页面及嵌套组件、说明图片，粘贴后资源可立即展开',()=>{
  const m=fixture();m.nodes[0].description='![参考](assets/used.png)';const clipboard=copyCanvasSelection(m,'a',['one']);const bundle={resources:{one:'<!-- include:components/main.html -->',two:'其他页面'},fragments:{'components/main.html':'<h1>标题</h1><!-- include:components/style.html -->','components/style.html':'<style>p{color:green}</style>','components/unrelated.html':'x'.repeat(100000)},images:{'assets/used.png':'data:image/png;base64,used','assets/unused.png':'data:image/png;base64,unused'}},before=clone(bundle),assets=canvasClipboardAssets(clipboard,bundle);
  assert.deepEqual(Object.keys(assets.resources),['one']);assert.deepEqual(Object.keys(assets.fragments),['components/main.html','components/style.html']);assert.deepEqual(Object.keys(assets.images),['assets/used.png']);assert.deepEqual(bundle,before);
  const ids=pasteCanvasSelection(m,'c',{...clipboard,...assets});assert.equal(ids.length,1);assert.match(expandHTML(assets.resources.one,assets.fragments),/<h1>标题<\/h1><style>/);assert(JSON.stringify(assets).length<JSON.stringify(bundle).length/20);
});
test('缩略图只随自身内容、尺寸和直接依赖变化，其他资源与位置不引起重建',()=>{
  const m=fixture(),n=m.nodes[0],bundle={resources:{one:'<!-- include:used -->'},fragments:{used:'<p>正文</p>',other:'其他'},images:{}},key=canvasPreviewSignature(n,bundle);
  assert.equal(canvasPreviewSignature({...n,x:900,y:-800,title:'改名'},bundle),key);bundle.fragments.other='其他新内容';assert.equal(canvasPreviewSignature(n,bundle),key);bundle.fragments.used='<p>新正文</p>';assert.notEqual(canvasPreviewSignature(n,bundle),key);assert.notEqual(canvasPreviewSignature({...n,canvasType:'mobile'},bundle),canvasPreviewSignature(n,bundle));
});
test('剪切和粘贴只移除或新增对应卡片，已有 iframe DOM 保持原位',()=>{
  let appended=0,removed=0;const host={children:[],append(card){appended++;if(card.parentNode)card.remove();this.children.push(card);card.parentNode=this;}},render=(n,card)=>card||{dataset:{id:n.id},frame:{id:n.id},parentNode:null,remove(){removed++;host.children.splice(host.children.indexOf(this),1);this.parentNode=null;}};
  const nodes=[{id:'a'},{id:'b'},{id:'c'}];reconcileCanvasCards(host,nodes,render);const kept=host.children[1],frame=kept.frame;assert.equal(appended,3);
  reconcileCanvasCards(host,nodes.slice(1),render);assert.equal(removed,1);assert.equal(appended,3);assert.equal(host.children[0],kept);assert.equal(kept.frame,frame);
  reconcileCanvasCards(host,[...nodes.slice(1),{id:'pasted'}],render);assert.equal(appended,4);assert.equal(removed,1);assert.equal(host.children[0],kept);assert.equal(kept.frame,frame);
});
async function sourceRefreshFixture(){
  const app=await fs.readFile(new URL('../runtime/app.mjs',import.meta.url),'utf8'),source=app.slice(app.indexOf('async function refreshSources(){'),app.indexOf('try{if(boot.bundle)'));let respond,started,requests=0,renders=0;const ready=new Promise(resolve=>started=resolve);
  const state={readonly:false,dirty:false,saving:false,sourceRefreshFlight:false,annotationEditorId:null,pendingImages:new Set(),activeCanvasGesture:null,cancelConnection:null,revision:'before',model:fixture(),bundle:{sourcesSignature:'before',images:{}},selected:null,current:null,positions:{},missing:new Set(),history:{clear(){}},node:()=>null,renderAll:()=>renders++,canvas:()=>renders++,viewer:()=>renders++,renderInspector(){},document:{activeElement:null},fetch:url=>{if(url.endsWith('/status'))return Promise.resolve({ok:true,json:async()=>({revision:'external',sourceVersion:'external'})});requests++;return new Promise(resolve=>{respond=resolve;started();});}};
  const context=vm.createContext(state);vm.runInContext(source+'globalThis.runRefresh=refreshSources;',context);
  return {context,ready,run:()=>context.runRefresh(),respond:value=>respond({ok:true,json:async()=>value}),requests:()=>requests,renders:()=>renders};
}
test('刷新请求晚于剪切粘贴和保存返回时，不能把新节点回退成旧状态',async()=>{
  const f=await sourceRefreshFixture(),m=f.context.model;m.nodes.push({...clone(m.nodes[0]),id:'hidden',overview:false});const stale=clone(m),flight=f.run();await f.ready;await f.run();assert.equal(f.requests(),1);
  const clipboard=cutCanvasSelection(m,'a',['hidden'],{recycle:true}),ids=pasteCanvasSelection(m,'c',clipboard);f.context.revision='after-save';f.respond({revision:'before',model:stale,sourcesSignature:'old'});await flight;
  assert.equal(f.context.model,m);assert(m.nodes.some(n=>n.id===ids[0]));assert(!m.nodes.some(n=>n.id==='hidden'));assert.equal(f.context.revision,'after-save');assert.equal(f.renders(),0);assert.equal(f.context.sourceRefreshFlight,false);
});
test('本地正在编辑或保存时忽略刷新响应，空闲时仍接收外部更新',async()=>{
  for(const key of ['dirty','saving']){const f=await sourceRefreshFixture(),before=f.context.model,flight=f.run();await f.ready;f.context[key]=true;f.respond({revision:'external',model:fixture()});await flight;assert.equal(f.context.model,before);assert.equal(f.renders(),0);}
  const f=await sourceRefreshFixture(),next=fixture(),flight=f.run();await f.ready;f.respond({revision:'external',model:next});await flight;assert.equal(f.context.model,next);assert.equal(f.context.revision,'external');assert.equal(f.renders(),1);
});
test('资源未变化时只探测版本，不下载项目；后台页面暂停探测',async()=>{
  const f=await sourceRefreshFixture(),urls=[];f.context.bundle.sourceVersion='unchanged';
  f.context.fetch=async url=>{urls.push(url);return {ok:true,json:async()=>({revision:'before',sourceVersion:'unchanged'})};};
  await f.run();await f.run();assert.deepEqual(urls,['/api/project/status','/api/project/status']);assert.equal(f.renders(),0);
  f.context.document.hidden=true;await f.run();assert.equal(urls.length,2);
});
test('标记编辑期间不刷新，响应返回前打开标记也不能覆盖草稿',async()=>{
  const initial=await sourceRefreshFixture();initial.context.annotationEditorId='pin';await initial.run();assert.equal(initial.requests(),0);assert.equal(initial.renders(),0);
  const f=await sourceRefreshFixture(),before=f.context.model,flight=f.run();await f.ready;f.context.annotationEditorId='pin';f.respond({revision:'external',model:fixture()});await flight;
  assert.equal(f.context.model,before);assert.equal(f.context.revision,'before');assert.equal(f.renders(),0);
});
test('版本探测等待期间的本地保存阻止后续下载，普通输入框也不会被外部更新重建',async()=>{
  const f=await sourceRefreshFixture();let respond,downloads=0;
  f.context.fetch=url=>url.endsWith('/status')?new Promise(resolve=>respond=resolve):(downloads++,Promise.resolve({ok:true,json:async()=>({})}));
  const flight=f.run();f.context.revision='local-save';respond({ok:true,json:async()=>({revision:'external',sourceVersion:'new'})});await flight;assert.equal(downloads,0);
  const typing=await sourceRefreshFixture(),before=typing.context.model,request=typing.run();await typing.ready;typing.context.document.activeElement={matches:()=>true};typing.respond({revision:'external',model:fixture()});await request;assert.equal(typing.context.model,before);assert.equal(typing.renders(),0);
});
test('资源版本变化但内容相同时推进探测基线，避免每次轮询重复下载',async()=>{
  const f=await sourceRefreshFixture(),flight=f.run();await f.ready;f.respond({revision:'before',model:fixture(),sourceVersion:'new',sourcesSignature:'before',images:{}});await flight;
  assert.equal(f.context.bundle.sourceVersion,'new');assert.equal(f.renders(),0);
});
test('连线绘制同帧合并，相同几何不重建，隐藏连线时不计算路径',async()=>{
  const app=await fs.readFile(new URL('../runtime/app.mjs',import.meta.url),'utf8'),draw=app.slice(app.indexOf('function drawLines(){'),app.indexOf('function edgeGeometryGesture(')),sections=app.slice(app.indexOf('function renderSections(){'),app.indexOf('function highlightCards('));
  let queued=[],writes=0,routes=0,sectionWrites=0;const svg={childNodes:[],set innerHTML(value){writes++;this.childNodes=[value];},append(...items){this.childNodes.push(...items);},replaceChildren(){this.childNodes=[];}},sectionHost={replaceChildren(){sectionWrites++;},append(){}},element=()=>({classList:{add(){},toggle(){}},dataset:{},setAttribute(){},append(){}});
  const state={lineFrame:null,lastLinesSignature:null,lastSectionsSignature:null,lineTextContext:null,cancelConnection:null,current:null,recycleOpen:false,linesHidden:false,moduleId:'a',selected:null,model:fixture(),readonly:false,requestAnimationFrame:fn=>(queued.push(fn),queued.length),$:selector=>selector==='#lines'?svg:sectionHost,activeCanvasNodes:()=>[state.model.nodes[0]],canvasSections:()=>[],overviewEdges:()=>[],canvasNodeWidth,canvasNodeHeight,routeConnections:()=>{routes++;return [];},placeConnectionLabels:()=>new Map(),getComputedStyle:()=>({fontFamily:'sans-serif'}),document:{createElement:()=>({getContext:()=>({measureText:()=>({width:10})})}),createElementNS:element}};
  vm.runInContext(sections+draw,vm.createContext(state));const flush=()=>{const jobs=queued;queued=[];jobs.forEach(fn=>fn());};
  state.drawLines();state.drawLines();state.drawLines();assert.equal(queued.length,1);flush();assert.equal(writes,1);assert.equal(routes,1);assert.equal(sectionWrites,1);
  state.drawLines();flush();assert.equal(writes,1);assert.equal(routes,1);assert.equal(sectionWrites,1);
  state.model.nodes[0].x++;state.drawLines();flush();assert.equal(writes,2);assert.equal(routes,2);
  state.linesHidden=true;state.model.nodes[0].x++;state.drawLines();flush();assert.equal(writes,2);assert.equal(routes,2);
  state.linesHidden=false;state.drawLines();flush();assert.equal(writes,3);assert.equal(routes,3);
});
test('粘贴覆盖只面向已打开或单独选中的图片，多选和其他页面不覆盖',()=>{
  const m=fixture();m.nodes[0].kind='image';m.nodes[0].path='assets/old.png';const target=m.nodes[0];
  assert.equal(imagePasteTarget(m,'one',{type:'annotation',id:'pin'}),target);assert.equal(imagePasteTarget(m,null,{type:'node',id:'one'}),target);
  assert.equal(imagePasteTarget(m,'two',{type:'node',id:'one'}),null);assert.equal(imagePasteTarget(m,null,{type:'nodes',ids:['one','two']}),null);assert.equal(imagePasteTarget(m,null,null),null);
  target.overview=false;assert.equal(imagePasteTarget(m,null,{type:'node',id:'one'}),target);
});
test('替换图片保留节点身份、位置、类型、说明和连线，旧图标记保留原图关联并支持撤销',()=>{
  const m=fixture();Object.assign(m.nodes[0],{kind:'image',path:'assets/old.png',canvasType:'mobile',description:'原说明'});Object.assign(m.edges[0],{rect:[.1,.2,.2,.1],waypoints:[[500,300]],labelPosition:[600,330]});delete m.edges[0].selector;
  const before=clone(m),h=new History();h.push(m);assert.equal(replaceCanvasImage(m,'one',{path:'assets/new.png',width:900,height:6000},'assets/old.png'),true);
  assert.deepEqual(m.nodes[0],{...before.nodes[0],path:'assets/new.png',width:900,height:6000});assert.deepEqual(m.nodes.slice(1),before.nodes.slice(1));assert.deepEqual(m.edges,[{...before.edges[0],imagePath:'assets/old.png'}]);assert.deepEqual(m.annotations,[{...before.annotations[0],imagePath:'assets/old.png'},before.annotations[1]]);assert.deepEqual(validate(m),[]);
  assert.deepEqual(h.undo(m),before);
});
test('覆盖目标已变化、被删除或新图片无效时不改动任何节点和标记',()=>{
  const m=fixture();m.nodes[0].kind='image';m.nodes[0].path='assets/changed.png';const before=clone(m),image={path:'assets/new.png',width:600,height:800};
  assert.equal(replaceCanvasImage(m,'one',image,'assets/old.png'),false);assert.equal(replaceCanvasImage(m,'missing',image),false);assert.equal(replaceCanvasImage(m,'two',image),false);assert.equal(replaceCanvasImage(m,'one',{...image,path:'../new.png'}),false);assert.equal(replaceCanvasImage(m,'one',{...image,height:0}),false);assert.deepEqual(m,before);
});
test('回收站收纳隐藏原型、图片和说明，排除可见内容与分叉点',()=>{
  const m=fixture();m.nodes.push({...clone(m.nodes[0]),id:'hidden-page',overview:false,overviewAlias:'one'},{...clone(m.nodes[1]),id:'hidden-image',kind:'image',overview:false},{...clone(m.nodes[2]),id:'hidden-note',overview:false},{...clone(m.nodes[2]),id:'hidden-branch',presentation:'branch',overview:false});
  const before=clone(m);assert.deepEqual(recycleNodes(m).map(n=>n.id),['hidden-page','hidden-image','hidden-note']);assert.deepEqual(m,before);
});
test('回收站网格完整排列混合卡片，拖动只保存独立位置，移除一项不挪动其余内容',()=>{
  const m=fixture();for(let i=0;i<9;i++)m.nodes.push({...clone(m.nodes[i%2]),id:`hidden-${i}`,overview:false,x:60,y:60});
  const before=clone(m),cards=recycleCanvasNodes(m);assert.equal(cards.length,9);assertNoNodeOverlap(cards);assert.deepEqual(m,before);
  moveRecycleNodes(m,[{id:cards[0].id,x:-500,y:1000}]);assert.deepEqual(m.nodes,before.nodes);assert.deepEqual(recycleCanvasNodes(m).slice(1),cards.slice(1));
  const positions=new Map(recycleCanvasNodes(m).map(n=>[n.id,[n.x,n.y]]));cutCanvasSelection(m,'a',[cards[2].id],{recycle:true});
  for(const n of recycleCanvasNodes(m))assert.deepEqual([n.x,n.y],positions.get(n.id));assert.deepEqual(validate(m),[]);
});
test('复制回收站内容在目标画布变为正常节点，保留原件、说明、图片和所选内部关系',()=>{
  const m=fixture();m.nodes.push({...clone(m.nodes[0]),id:'hidden-a',overview:false,overviewAlias:'one',description:'原页面说明'},{...clone(m.nodes[1]),id:'hidden-b',kind:'image',path:'assets/example.png',overview:false});m.edges.push({id:'hidden-link',from:'hidden-a',to:'hidden-b',label:'查看图片'});m.annotations.push({id:'hidden-pin',node:'hidden-a',point:[.1,.2],text:'原批注'});
  const before=clone(m),clipboard=copyCanvasSelection(m,'a',['hidden-a','hidden-b'],{recycle:true});assert.equal(clipboard.nodes.length,2);assert(clipboard.nodes.every(n=>n.overview!==false&&!n.overviewAlias));assert.deepEqual(m,before);
  const ids=pasteCanvasSelection(m,'c',clipboard,[600,700]);assert.equal(ids.length,2);assert.deepEqual(m.nodes.slice(0,before.nodes.length),before.nodes);assert(ids.every(id=>moduleNodes(m,'c').some(n=>n.id===id)));
  assert.equal(m.nodes.find(n=>n.id===ids[0]).description,'原页面说明');assert.equal(m.nodes.find(n=>n.id===ids[1]).path,'assets/example.png');assert(m.edges.some(e=>e.from===ids[0]&&e.to===ids[1]));assert(m.annotations.some(a=>a.node===ids[0]&&a.text==='原批注'));assert.deepEqual(validate(m),[]);
});
test('剪切普通画布节点连同隐藏状态写入剪贴板，粘贴到另一模块保留内部连线、批注与撤销',()=>{
  const m=fixture();m.nodes.push({...clone(m.nodes[0]),id:'hidden',overview:false,overviewAlias:'one'});m.edges.push({id:'inner',from:'one',to:'hidden',selector:'#expand',label:'展开'});m.annotations.push({id:'hidden-pin',node:'hidden',text:'状态批注'});
  const before=clone(m),h=new History();h.push(m);const clipboard=cutCanvasSelection(m,'a',['one']);assert.equal(clipboard.nodes.length,2);assert(!m.nodes.some(n=>['one','hidden'].includes(n.id)));assert(m.nodes.some(n=>n.id==='two'));assert(m.nodes.some(n=>n.id==='unused'));assert.deepEqual(validate(m),[]);
  assert.deepEqual(h.undo(m),before);const ids=pasteCanvasSelection(m,'b',clipboard,[800,1000]);assert.equal(ids.length,2);assert.equal(m.nodes.find(n=>n.id===ids[1]).overviewAlias,ids[0]);assert(m.edges.some(e=>e.from===ids[0]&&e.to===ids[1]&&e.selector==='#expand'));assert(m.annotations.some(a=>a.node===ids[1]&&a.text==='状态批注'));assert.deepEqual(validate(m),[]);
});
test('剪切回收站仅移走所选原件，其他状态与可见页面保留，粘贴后正常显示且可撤销',()=>{
  const m=fixture();m.nodes.push({...clone(m.nodes[0]),id:'hidden-a',overview:false,overviewAlias:'one'},{...clone(m.nodes[1]),id:'hidden-b',overview:false});m.annotations.push({id:'hidden-pin',node:'hidden-a',text:'原标记'});
  const before=clone(m),h=new History();h.push(m);const clipboard=cutCanvasSelection(m,'b',['hidden-a'],{recycle:true});assert.equal(clipboard.nodes.length,1);assert.deepEqual(m.nodes,before.nodes.filter(n=>n.id!=='hidden-a'));assert.equal(recycleNodes(m).length,1);assert.deepEqual(h.undo(m),before);
  const cut=clone(m),ids=pasteCanvasSelection(cut,'b',clipboard,[1000,700]);assert.equal(ids.length,1);assert(moduleNodes(cut,'b').some(n=>n.id===ids[0]));assert(cut.annotations.some(a=>a.node===ids[0]&&a.text==='原标记'));assert.deepEqual(validate(cut),[]);
});
test('剪切当前画布引用只移除引用关系，保留来源节点及其说明',()=>{
  const m=fixture(),source=clone(m.nodes[1]),pin=clone(m.annotations);const clipboard=cutCanvasSelection(m,'a',['two']);assert.equal(clipboard.nodes.length,1);assert.deepEqual(m.nodes.find(n=>n.id==='two'),source);assert.deepEqual(m.annotations,pin);assert(!moduleNodes(m,'a').some(n=>n.id==='two'));assert.deepEqual(validate(m),[]);
});
test('剪切页面不挪动其他页面或默认定位的跨模块引用',()=>{
  const m=fixture();m.nodes.push({...clone(m.nodes[0]),id:'keeper',x:800,y:600});m.nodes[0].x=3000;m.edges.push({id:'keep-two',from:'keeper',to:'two',label:'查看'},{id:'keep-note',from:'keeper',to:'unused',label:'说明'});
  const before=moduleNodes(m,'a').filter(n=>n.id!=='one').map(n=>({id:n.id,x:n.x,y:n.y}));cutCanvasSelection(m,'a',['one']);assert.deepEqual(moduleNodes(m,'a').map(n=>({id:n.id,x:n.x,y:n.y})),before);assert.deepEqual(validate(m),[]);
});
test('粘贴到回收站仍隐藏且独立摆放，不修改来源，非法位置拒绝保存',()=>{
  const m=fixture();m.nodes.push({...clone(m.nodes[0]),id:'hidden',overview:false,overviewAlias:'one'});const before=clone(m),clipboard=copyCanvasSelection(m,'a',['one']),ids=pasteCanvasSelection(m,'b',clipboard,[1400,-500],{recycle:true});assert.equal(ids.length,2);assert.deepEqual(m.nodes.slice(0,before.nodes.length),before.nodes);
  assert(ids.every(id=>recycleCanvasNodes(m).some(n=>n.id===id&&n.overview===false&&!n.overviewAlias)));assert(!moduleNodes(m,'a').some(n=>ids.includes(n.id)));assert.deepEqual(validate(m),[]);m.recyclePositions[ids[0]].x=Infinity;assert(validate(m).includes('回收站画布位置不正确'));
});
async function temporary(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ec-yuanxing-'));try{return await fn(dir);}finally{await fs.rm(dir,{recursive:true,force:true});}}
test('历史编组不会随复制或粘贴重新带回，页面仍可临时多选复制',()=>{
  const source=fixture();source.nodes[1].module='a';source.groups=[{id:'old-group',module:'a',title:'旧组',nodes:['one','two']}];const original=clone(source);
  const clipboard=copyCanvasSelection(source,'a',['one','two']);assert.equal(clipboard.groups,undefined);assert.deepEqual(source,original);
  clipboard.groups=clone(source.groups);const target=fixture(),before=clone(target.nodes);const ids=pasteCanvasSelection(target,'a',clipboard,[700,500]);
  assert.equal(ids.length,2);assert.equal(target.groups,undefined);assert.deepEqual(target.nodes.slice(0,before.length),before);
});

async function setup(root,model=fixture()){await fs.mkdir(path.join(root,'artifact/states'),{recursive:true});await fs.writeFile(path.join(root,'artifact/workbench.json'),JSON.stringify(model));await fs.writeFile(path.join(root,'artifact/states/one.html'),'<button id="go">下一步</button><script>throw Error("不得执行")</script>');await fs.writeFile(path.join(root,'artifact/states/two.html'),'<p>固定结果</p>');return createStore(root);}
async function request(handler,method,url,data,headers={}){const req=Readable.from(data?[JSON.stringify(data)]:[]);Object.assign(req,{method,url,headers:{host:'127.0.0.1:4318',...headers}});const res={writeHead(status,h){this.status=status;this.headers=h;},end(value){this.value=value;}};await handler(req,res);return res;}
test('中文与表情在任意请求分块边界保存后均保持原文',()=>temporary(async root=>{
  const store=await setup(root),handler=createHandler(store,'secret'),original='中文标题 🧩，标记说明与换行\n保持完整';
  for(let offset=0;offset<Buffer.byteLength(original);offset++){
    const data=await store.readModel();data.model.title=original;const bytes=Buffer.from(JSON.stringify(data)),start=bytes.indexOf(Buffer.from(original.slice(0,2))),cut=start+offset;
    const req=Readable.from([bytes.subarray(0,cut),bytes.subarray(cut)]);Object.assign(req,{method:'PUT',url:'/api/project',headers:{host:'localhost',authorization:'Bearer secret'}});
    const res={writeHead(status){this.status=status;},end(text){this.text=text;}};await handler(req,res);assert.equal(res.status,200,res.text);assert.equal((await store.readModel()).model.title,original);
  }
}));
test('轻量接口不携带资源，位置保存不改变资源版本，文件替换和缺失都能被探测',()=>temporary(async root=>{
  const store=await setup(root),bundle=await store.load(),before=await store.status();assert.equal(before.sourceVersion,bundle.sourceVersion);assert(Buffer.byteLength(JSON.stringify(before))<256);
  const response=await request(createHandler(store,'secret'),'GET','/api/project/status');assert.equal(response.status,200);assert.deepEqual(JSON.parse(response.value),before);
  const edit=await store.readModel();edit.model.nodes[0].x+=20;await store.save(edit.model,edit.revision);const moved=await store.status();assert.notEqual(moved.revision,before.revision);assert.equal(moved.sourceVersion,before.sourceVersion);
  const file=path.join(root,'artifact/states/one.html'),stat=await fs.stat(file);await fs.writeFile(file,'<button id="go">已更新</button>');await fs.utimes(file,stat.atime,stat.mtime);assert.notEqual((await store.status()).sourceVersion,before.sourceVersion);
  const changed=await store.status();await fs.rm(file);assert.notEqual((await store.status()).sourceVersion,changed.sourceVersion);await assert.rejects(store.load(),/ENOENT/);
}));
test('辅助脚本、参考图片和组件变化触发重建，无变化不重建，并发加载只构建一次',()=>temporary(async root=>{
  await setup(root);await fs.mkdir(path.join(root,'scripts'));await fs.mkdir(path.join(root,'artifact/assets'));await fs.mkdir(path.join(root,'artifact/components'));
  const helper=path.join(root,'scripts/helper.py'),image=path.join(root,'artifact/assets/reference.png'),component=path.join(root,'artifact/components/part.html');await fs.writeFile(helper,"value='版本一'\n");await fs.writeFile(image,'参考一');await fs.writeFile(component,'组件一');
  await fs.writeFile(path.join(root,'scripts/build.py'),"import sys\nsys.dont_write_bytecode=True\nfrom pathlib import Path\nfrom helper import value\nr=Path(__file__).resolve().parents[1]\nc=r/'calls.txt'\nc.write_text(str(int(c.read_text())+1) if c.exists() else '1')\n(r/'artifact/states/one.html').write_text('<button id=\"go\">'+value+(r/'artifact/assets/reference.png').read_text()+(r/'artifact/components/part.html').read_text()+'</button>')\n");
  const store=await createStore(root,{builder:'scripts/build.py'});await Promise.all([store.load(),store.load()]);assert.equal(await fs.readFile(path.join(root,'calls.txt'),'utf8'),'1');const first=await store.status();await store.load();assert.equal(await fs.readFile(path.join(root,'calls.txt'),'utf8'),'1');
  await fs.writeFile(helper,"value='版本二'\n");assert.notEqual((await store.status()).sourceVersion,first.sourceVersion);assert.match((await store.load()).resources.one,/版本二/);
  await fs.writeFile(image,'参考二');assert.match((await store.load()).resources.one,/参考二/);await fs.writeFile(component,'组件二');assert.match((await store.load()).resources.one,/组件二/);assert.equal(await fs.readFile(path.join(root,'calls.txt'),'utf8'),'4');
}));
test('撤销历史按数量和容量淘汰旧状态，超大状态不会突破预算',()=>{
  const h=new History({maxEntries:3,maxBytes:1024});for(let i=0;i<10;i++)h.push({i});assert.equal(h.past.length,3);assert.equal(h.undo({i:10}).i,9);assert.equal(h.undo({}).i,8);assert.equal(h.undo({}).i,7);const current={i:10};assert.equal(h.undo(current),current);
  const bounded=new History({maxEntries:100,maxBytes:100});for(let i=0;i<20;i++)bounded.push({i,text:'x'.repeat(15)});assert(bounded.bytes<=100);assert(bounded.past.length<20);bounded.push({text:'x'.repeat(100)});assert.equal(bounded.bytes,0);assert.equal(bounded.past.length,0);
});
test('连续微移整组撤销，超时、换选择或其他编辑会拆分历史',()=>{
  let time=0;const h=new History({now:()=>time}),m={x:0};for(let i=0;i<20;i++){h.push(m,{group:'nodes:a'});m.x++;time+=20;}assert.equal(h.past.length,1);assert.equal(h.undo(m).x,0);assert.equal(m.x,20);
  h.push(m,{group:'nodes:a'});m.x++;time+=400;h.push(m,{group:'nodes:a'});m.x++;h.push(m,{group:'nodes:b'});m.x++;h.push(m);m.x++;assert.equal(h.past.length,4);h.clear();assert.equal(h.past.length,0);assert.equal(h.bytes,0);
});
function layoutFixture(){
  const ids=['root','split','admin','member','purchase','blocked','auth','guide-a','guide-b','detached'];
  return {version:1,title:'流程排布',modules:[{id:'flow',title:'流程',entry:'root'}],nodes:ids.map((id,i)=>({id,module:'flow',title:id,kind:id==='split'?'note':'html',...(id==='split'?{presentation:'branch'}:{path:`states/${id}.html`}),width:id==='split'?16:1280,height:id==='split'?16:800,x:id==='detached'?6000:60+i%2*700,y:id==='detached'?60:60+i*400,description:'原说明'})),edges:[['to-split','root','split'],['to-auth','root','auth'],['to-admin','split','admin'],['to-member','split','member'],['to-purchase','admin','purchase'],['member-blocked','member','blocked'],['purchase-blocked','purchase','blocked'],['guide-a','auth','guide-a'],['guide-b','auth','guide-b']].map(([id,from,to])=>({id,from,to,label:id,fromSide:'bottom',toSide:'top'})),annotations:[]};
}
function assertNoNodeOverlap(nodes){for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j];assert.ok(a.x+canvasNodeWidth(a)<=b.x||b.x+canvasNodeWidth(b)<=a.x||a.y+canvasNodeHeight(a)<=b.y||b.y+canvasNodeHeight(b)<=a.y,`节点重叠：${a.id} / ${b.id}`);}}
function assertClearRoute(route,nodes){for(let i=1;i<route.points.length;i++){const [a,b]=[route.points[i-1],route.points[i]];assert.ok(a[0]===b[0]||a[1]===b[1]);for(const n of nodes){const right=n.x+canvasNodeWidth(n),bottom=n.y+canvasNodeHeight(n),hit=a[0]===b[0]?a[0]>n.x&&a[0]<right&&Math.max(a[1],b[1])>n.y&&Math.min(a[1],b[1])<bottom:a[1]>n.y&&a[1]<bottom&&Math.max(a[0],b[0])>n.x&&Math.min(a[0],b[0])<right;assert.ok(!hit,`连线穿过页面 ${n.id}: ${route.path}`);}}}

test('首页已有两支时向右再接技能页，保留所有页面位置、旧线方向与撤销导出',()=>{
  const m=fixture();m.nodes.forEach(n=>{n.module='a';n.width=1280;n.height=800;});Object.assign(m.nodes[0],{x:60,y:400});Object.assign(m.nodes[1],{x:660,y:60});Object.assign(m.nodes[2],{x:660,y:740});m.edges[0].fromSide='right';m.edges[0].toSide='left';connectNodes(m,'one','unused','right','left');
  m.nodes.push({...clone(m.nodes[1]),id:'added',x:1260,y:60});const before=clone(m),history=new History();history.push(m);const id=connectNodes(m,'two','added','right','left');assert.ok(id);assert.deepEqual(m.nodes,before.nodes);assert.deepEqual(m.edges.slice(0,-1),before.edges);assert.equal(m.nodes.some(isBranch),false);assert.deepEqual(validate(m),[]);
  assert.deepEqual(history.undo(m),before);assert.deepEqual(exportSubset(m,'a').nodes,m.nodes);
  reconnectEdge(m,id,'to','unused','top','right');assert.deepEqual(m.nodes,before.nodes);assert.deepEqual(m.edges.slice(0,-1),before.edges);
});
test('四个方向可任意组合连接，绕开两端页面和中间页面，不改手选端点',()=>{
  const base={module:'a',kind:'note',title:'页面',width:1280,height:800},nodes=[{...base,id:'a',x:60,y:260},{...base,id:'b',x:1100,y:300},{...base,id:'block',x:580,y:200}];
  for(const fromSide of ['top','right','bottom','left'])for(const toSide of ['top','right','bottom','left']){const edge={id:'link',from:'a',to:'b',fromSide,toSide},before=clone(edge),[line]=routeConnections(nodes,[edge]);assertClearRoute(line.route,nodes);assert.deepEqual(edge,before);assert.deepEqual(line.start,connectionPoint(nodes[0],fromSide));assert.deepEqual(line.end,connectionPoint(nodes[1],toSide));}
});
test('同侧新增普通连线不重新分配原有端口或通道，线与线可以交叉重合',()=>{
  const base={module:'a',kind:'note',title:'页面',width:1280,height:800},nodes=[{...base,id:'home',x:60,y:450},{...base,id:'skill',x:660,y:60},{...base,id:'mode',x:660,y:840},{...base,id:'added',x:1260,y:60}],edges=[{id:'a',from:'home',to:'skill',fromSide:'right',toSide:'left'},{id:'c',from:'skill',to:'added',fromSide:'right',toSide:'left'}],before=clone({nodes,edges});
  const initial=routeConnections(nodes,edges,{scope:'same-side-stable'}),stable=clone(initial[0]);
  edges.push({id:'b',from:'home',to:'mode',fromSide:'right',toSide:'left'});
  const lines=routeConnections(nodes,edges,{scope:'same-side-stable'});
  assert.deepEqual(lines[0],stable);assert.deepEqual(lines[0].start,lines[2].start);for(const line of lines)assertClearRoute(line.route,nodes);
  assert.deepEqual(nodes,before.nodes);assert.deepEqual(edges.slice(0,2),before.edges);assert.deepEqual(routeConnections(nodes,edges,{scope:'same-side-stable'}),lines);
});
test('简单折线被多重障碍封住时可连续转弯绕行',()=>{
  const obstacles=[{x:-100,y:-80,width:300,height:40},{x:-100,y:40,width:300,height:40},{x:260,y:-200,width:60,height:300}],route=connectionRoute([0,0],[600,0],'right','left',obstacles);
  assert.ok(route.points.length>=6);for(let i=1;i<route.points.length;i++){const [a,b]=[route.points[i-1],route.points[i]];assert.ok(a[0]===b[0]||a[1]===b[1]);for(const r of obstacles){const hit=a[0]===b[0]?a[0]>r.x&&a[0]<r.x+r.width&&Math.max(a[1],b[1])>r.y&&Math.min(a[1],b[1])<r.y+r.height:a[1]>r.y&&a[1]<r.y+r.height&&Math.max(a[0],b[0])>r.x&&Math.min(a[0],b[0])<r.x+r.width;assert.ok(!hit,route.path);}}
});
test('未指定方向时按节点间距选择端点，右上方页面仍可采用左右连接',()=>{
  const from={id:'from',kind:'note',x:60,y:400,width:1280,height:800},right={...from,id:'right',x:660,y:150},below={...from,id:'below',y:900};assert.deepEqual(connectionDirections({},from,right),['right','left']);assert.deepEqual(connectionDirections({},from,below),['bottom','top']);assert.deepEqual(connectionDirections({fromSide:'top',toSide:'right'},from,right),['top','right']);
});
test('拖动吸附边缘与中心只调整当前节点，按 Alt 时可保留自由位置',()=>{
  const n={id:'moving',kind:'note',x:100,y:100,width:1280,height:800},other={...n,id:'other',x:660,y:450},before=clone([n,other]),snapped=snapNodePosition(n,[655,447],[n,other],8);assert.equal(snapped.x,660);assert.equal(snapped.y,450);assert.equal(snapped.guides.length,2);assert.deepEqual(snapNodePosition(n,[655,447],[n,other],0),{x:655,y:447,guides:[]});assert.deepEqual([n,other],before);
});
test('不同源尺寸采用等大卡片，拖动吸附按统一边界计算',()=>{
  const moving={id:'short',kind:'note',x:60,y:60,width:640,height:320},other={...moving,id:'tall',x:660,y:450,width:1280,height:800},before=clone([moving,other]);
  for(const [near,expected] of [[447,450],[452,450],[457,450]]){const result=snapNodePosition(moving,[655,near],[other],8);assert.equal(result.x,660);assert.equal(result.y,expected);assert.equal(result.guides.length,2);}
  assert.deepEqual(snapNodePosition(moving,[660,450],[other],0),{x:660,y:450,guides:[]});assert.deepEqual([moving,other],before);
});
test('框选支持两个拖动方向，零面积不选择；Shift 可加选和移出选择',()=>{
  const m=fixture();m.nodes[1].x=580;m.nodes[2].y=1200;const before=clone(m);
  assert.deepEqual(nodesInRect(m.nodes,[0,0],[1000,400]),['one','two']);assert.deepEqual(nodesInRect(m.nodes,[1000,400],[0,0]),['one','two']);assert.deepEqual(nodesInRect(m.nodes,[100,100],[100,100]),[]);
  assert.deepEqual(canvasSelection(['one'],'two',true),['one','two']);assert.deepEqual(canvasSelection(['one','two'],'one',true),['two']);assert.deepEqual(canvasSelection(['one'],'one',true),[]);assert.deepEqual(canvasSelection(['one','two'],'unused'),['unused']);assert.deepEqual(m,before);
});
test('批量拖动保持相对间距并整体吸附，未选节点不移动，整组可一次撤销',()=>{
  const m=fixture();m.nodes.forEach(n=>{n.module='a';n.width=1280;n.height=800;});Object.assign(m.nodes[1],{x:580,y:60});Object.assign(m.nodes[2],{x:1100,y:650});const before=clone(m),history=new History();history.push(m);
  const result=snapNodeGroup(moduleNodes(m,'a'),['one','two'],[3,587]);assert.equal(result.positions[0].y,650);assert.equal(result.positions[1].x-result.positions[0].x,520);assert.equal(result.positions[1].y-result.positions[0].y,0);moveCanvasNodes(m,'a',result.positions);
  assert.deepEqual(m.nodes[2],before.nodes[2]);assert.deepEqual(m.edges,before.edges);assert.deepEqual(history.undo(m),before);assert.deepEqual(validate(m),[]);
  const boundary=snapNodeGroup(before.nodes,['one','two'],[-2000,-2000],0);assert.deepEqual(boundary.positions.map(({x,y})=>[x,y]),[[-1940,-1940],[-1420,-1940]]);
});
test('自由画布允许负坐标吸附、微移、对齐、等间距和粘贴，仍拒绝无效坐标',()=>{
  const m=fixture();m.nodes.forEach(n=>Object.assign(n,{module:'a',width:1280,height:800}));Object.assign(m.nodes[0],{x:-900,y:-700});Object.assign(m.nodes[1],{x:-200,y:-300});Object.assign(m.nodes[2],{x:700,y:-500});
  const snap=snapNodePosition(m.nodes[1],[-903,-702],[m.nodes[0]]);assert.equal(snap.x,-900);assert.equal(snap.y,-700);assert.equal(snap.guides.length,2);
  distributeCanvasNodes(m,'a',['one','two','unused'],'x');assert.deepEqual(m.nodes.map(n=>n.x),[-900,-100,700]);
  alignCanvasNodes(m,'a',['one','two','unused'],'top');assert.deepEqual(m.nodes.map(n=>n.y),[-700,-700,-700]);
  nudgeCanvasNodes(m,'a',['one','two'],-200,-300);assert.deepEqual(m.nodes.slice(0,2).map(n=>[n.x,n.y]),[[-1100,-1000],[-300,-1000]]);
  const clipboard=copyCanvasSelection(m,'a',['one','two']),ids=pasteCanvasSelection(m,'a',clipboard,[-2000,-1500]);assert.deepEqual(ids.map(id=>{const n=m.nodes.find(n=>n.id===id);return [n.x,n.y]}),[[-2000,-1500],[-1200,-1500]]);
  const before=clone(m);assert.deepEqual(moveCanvasNodes(m,'a',[{id:'one',x:NaN,y:-1}]),[]);assert.deepEqual(m,before);assert.deepEqual(validate(m),[]);
});
test('成组拖动跨模块引用只修改当前画布，移动本模块节点也不带走未选引用',()=>{
  const m=fixture(),view=moduleNodes(m,'a'),reference=view.find(n=>n.reference),original=clone(m.nodes[1]);
  moveCanvasNodes(m,'a',[{id:'one',x:1800,y:600}]);assert.deepEqual(m.nodes[1],original);const pinned=moduleNodes(m,'a').find(n=>n.reference);assert.equal(pinned.x,reference.x);assert.equal(pinned.y,reference.y);
  const start=moduleNodes(m,'a'),result=snapNodeGroup(start,['one','two'],[100,200],0);moveCanvasNodes(m,'a',result.positions);assert.deepEqual(m.nodes[1],original);assert.deepEqual(m.referencePositions.a.two,{x:reference.x+100,y:reference.y+200});assert.equal(m.nodes[0].x,1900);assert.deepEqual(validate(m),[]);
});
test('负坐标下批量位置保存后可重新载入，连线与离线分享保留相同坐标',()=>temporary(async root=>{
  const store=await setup(root),before=await store.readModel(),m=before.model,start=moduleNodes(m,'a'),result=snapNodeGroup(start,['one','two'],[-1800,-2000],0);moveCanvasNodes(m,'a',result.positions);const routes=routeConnections(moduleNodes(m,'a'),overviewEdges(m));assert.ok(routes.some(line=>line.route.points.some(point=>point[0]<0&&point[1]<0)));assert.deepEqual(validate(m),[]);await store.save(m,before.revision);const loaded=await store.load();assert.deepEqual(loaded.model,m);
  const html=await standalone(loaded),boot=JSON.parse(html.match(/globalThis\.YUANXING_BOOT=([\s\S]*?);<\/script>/)[1]);assert.deepEqual(boot.bundle.model.nodes,m.nodes);assert.deepEqual(boot.bundle.model.referencePositions,m.referencePositions);assert.deepEqual(boot.bundle.model.edges,m.edges);
}));
test('横向主线和两个分支的长说明分别放置，全文保留且不覆盖页面',()=>{
  const base={module:'a',kind:'note',title:'页面',width:1280,height:800},nodes=[{...base,id:'auth',x:60,y:200},{...base,id:'branch',presentation:'branch',title:'分支条件',x:580,y:337},{...base,id:'query',x:760,y:0},{...base,id:'task',x:760,y:410}],edges=[{id:'main',from:'auth',to:'branch',fromSide:'right',toSide:'left',label:''},{id:'query',from:'branch',to:'query',fromSide:'right',toSide:'left',condition:'授权成功，继续，此前选择「开始查询」，保留所有分支说明内容'},{id:'task',from:'branch',to:'task',fromSide:'right',toSide:'left',condition:'授权成功，继续，此前选择「新建任务」'}],before=clone({nodes,edges}),lines=routeConnections(nodes,edges);
  const measured=text=>Array.from(text).length*15,labels=placeConnectionLabels(lines,nodes,measured),overlap=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y,boxes=[...labels.values()].map(l=>l.box);
  assert.equal(labels.size,3);assert.ok([...labels.values()].some(l=>l.rows.length>1));
  for(let i=0;i<boxes.length;i++){for(let j=i+1;j<boxes.length;j++)assert.ok(!overlap(boxes[i],boxes[j]));for(const n of nodes)assert.ok(!overlap(boxes[i],{x:n.x,y:n.y,width:canvasNodeWidth(n),height:canvasNodeHeight(n)}));}
  for(const line of lines){const layout=labels.get(line.edge.id),text=isBranch(line.to)?line.to.title:line.edge.condition;assert.equal(layout.rows.join(''),text);assert.ok(layout.box.width>=Math.max(...layout.rows.map(measured))+12);}
  assert.deepEqual({nodes,edges},before);assert.deepEqual(placeConnectionLabels(lines,nodes,measured),labels);
});
test('新增或移除其他连线不挪动原有说明，用户可手动调整文字位置',()=>{
  const base={module:'a',kind:'note',title:'页面',width:1280,height:800},nodes=[{...base,id:'from',x:60,y:60},{...base,id:'to',x:800,y:60}],edge={id:'first',from:'from',to:'to',fromSide:'right',toSide:'left',condition:'已有条件'},before=clone(edge);
  const first=placeConnectionLabels(routeConnections(nodes,[edge]),nodes).get('first');
  const extra={id:'extra',from:'from',to:'to',fromSide:'bottom',toSide:'bottom',condition:'新增的很长的条件说明'};
  assert.deepEqual(placeConnectionLabels(routeConnections(nodes,[extra,edge]),nodes).get('first'),first);
  edge.labelPosition=[500,500];const moved=placeConnectionLabels(routeConnections(nodes,[edge,extra]),nodes).get('first');assert.equal(moved.box.x,500);assert.equal(moved.box.y,500);assert.equal(moved.manual,true);delete edge.labelPosition;assert.deepEqual(edge,before);
});
test('非法节点、热点和规则引用不会进入保存',()=>{const m=fixture();assert.deepEqual(validate(m),[]);m.edges[0].to='missing';m.annotations[0].point=[3,.5];m.nodes[0].path='../secret';assert.equal(validate(m).length,3);});
test('模块导出包含跨模块目标，移除无关内容，保留批注',()=>{const m=exportSubset(fixture(),'a');assert.deepEqual(m.nodes.map(n=>n.id),['one','two']);assert.equal(m.annotations.length,1);assert.equal(m.entryModule,'a');assert.equal(validate(m).length,0);});
test('引用节点只呈现同一内容，不改变目标页面的编排位置',()=>{const m=fixture(),nodes=moduleNodes(m,'a');assert.equal(nodes[1].reference,true);assert.equal(m.nodes[1].x,60);assert.ok(nodes[1].x>nodes[0].x+400);});
test('引用页面可单独保存模块内位置，不改动原页面位置',()=>{const m=fixture();m.referencePositions={a:{two:{x:700,y:520}}};const r=moduleNodes(m,'a').find(n=>n.reference);assert.equal(r.x,700);assert.equal(r.y,520);assert.equal(m.nodes[1].x,60);assert.equal(exportSubset(m,'a').referencePositions.a.two.y,520);});
test('去掉页脚提示后，横竖页面的连线端点仍贴合节点边缘',()=>{for(const n of fixture().nodes){const bottom=connectionPoint(n,'bottom'),top=connectionPoint(n,'top');assert.deepEqual(top,[n.x+canvasNodeWidth(n)/2,n.y]);assert.deepEqual(bottom,[n.x+canvasNodeWidth(n)/2,n.y+canvasNodeHeight(n)]);assert.equal(connectionPoint(n,'right')[0],n.x+canvasNodeWidth(n));const line=connectionPath(bottom,top,'bottom','top');assert.ok(line.startsWith(`M${bottom.join(',')} L`));assert.ok(line.endsWith(top.join(',')));assert.ok(!line.includes('NaN'));}});
test('对齐连线优先直线，遇到节点时以水平和垂直折线避让',()=>{assert.equal(connectionPath([0,0],[200,0],'right','left'),'M0,0 L200,0');const obstacle={x:80,y:-40,width:40,height:80},route=connectionRoute([0,0],[200,0],'right','left',[obstacle]);assert.ok(!/[CQ]/.test(route.path));for(let i=1;i<route.points.length;i++){const a=route.points[i-1],b=route.points[i];assert.ok(a[0]===b[0]||a[1]===b[1]);if(a[1]===b[1]&&Math.max(a[0],b[0])>80&&Math.min(a[0],b[0])<120)assert.ok(Math.abs(a[1])>=40);}assert.deepEqual(route.points[0],[0,0]);assert.deepEqual(route.points.at(-1),[200,0]);});
test('刷新恢复模块、页面、流程选择和画布位置；过期或错误位置安全回退',()=>{const m=fixture();m.entryModule='a';m.contextDefaults={entry:'query'};const camera={x:-100,y:80,scale:.5},saved={moduleId:'b',current:'two',camera,cameras:{a:camera,b:{scale:'错误'}},flowContext:{entry:'task'},linesHidden:true};const result=restoreView(m,saved);assert.equal(result.current,'two');assert.equal(result.moduleId,'b');assert.deepEqual(result.camera,camera);assert.deepEqual(result.cameras,{a:camera});assert.equal(result.flowContext.entry,'task');assert.equal(result.linesHidden,true);const fallback=restoreView(m,{moduleId:'deleted',current:'missing',camera:{x:Infinity,y:0,scale:0},flowContext:[]});assert.equal(fallback.moduleId,'a');assert.equal(fallback.current,null);assert.equal(fallback.camera,null);assert.deepEqual(fallback.flowContext,{entry:'query'});});
test('手动连接和终点方向随保存、撤销、导出保留，非法方向拒绝保存',()=>{const m=fixture(),history=new History();m.edges.push({id:'manual',from:'one',to:'two',label:'提交',trigger:'next',fromSide:'right',toSide:'left',description:'数据处理规则'});assert.deepEqual(validate(m),[]);history.push(m);m.edges[1].to='unused';m.edges[1].toSide='top';const before=history.undo(m);assert.equal(before.edges[1].to,'two');assert.equal(m.edges[1].to,'unused');assert.equal(exportSubset(before,'a').edges[1].toSide,'left');m.edges[1].toSide='center';assert.match(validate(m).join(','),/连线端点不正确/);});
test('替换截图后，旧批注和热点必须重新定位才可分享',()=>{const m=fixture();m.nodes[0].kind='image';m.nodes[0].path='assets/new.png';m.annotations[0].imagePath='assets/old.png';m.edges[0].imagePath='assets/old.png';m.edges[0].rect=[.1,.2,.2,.1];delete m.edges[0].selector;assert.equal(exportIssues(m).length,2);for(const item of [m.annotations[0],m.edges[0]])item.imagePath='assets/new.png';assert.equal(exportIssues(m).length,0);});
test('概览不展示通用导航，页面演示与导出仍保留跳转',()=>{const m=fixture();m.edges[0].navigation=true;assert.equal(overviewEdges(m).length,0);assert.equal(moduleNodes(m,'a').length,1);assert.equal(exportSubset(m,'a').edges.length,1);});
test('非主流程连线和重复模式不进入概览，仍可从页面内操作并离线分享',()=>{const m=fixture();m.edges[0].overview=false;assert.deepEqual(overviewEdges(m),[]);assert.equal(moduleNodes(m,'a').length,1);assert.equal(exportSubset(m,'a').edges.length,1);delete m.edges[0].overview;m.nodes[1].overview=false;assert.equal(overviewEdges(m).length,0);assert.equal(moduleNodes(m,'b').length,0);assert.equal(exportSubset(m,'a').nodes.length,2);m.nodes[1].overview='隐藏';assert.match(validate(m).join('；'),/页面概览设置不正确/);});
test('重复页面合并到一个概览节点，保留实际交互状态并消除自环',()=>{const m=fixture();m.nodes.push({...m.nodes[0],id:'same',overview:false,overviewAlias:'one'});m.edges.push({id:'select',from:'one',to:'same',label:'选择技能'},{id:'close',from:'same',to:'two',label:'收起下拉'});assert.deepEqual(validate(m),[]);const edges=overviewEdges(m);assert.equal(edges.some(e=>e.id==='select'),false);assert.equal(edges.find(e=>e.id==='close').from,'one');assert.equal(m.edges.find(e=>e.id==='close').from,'same');assert.equal(exportSubset(m,'a').nodes.some(n=>n.id==='same'),true);m.nodes.at(-1).overviewAlias='missing';assert.match(validate(m).join(','),/概览引用不正确/);});
test('共享页面沿用之前的选择，中间开通操作不会丢失入口',()=>{
  const branches=[{id:'query',when:{entry:'query'}},{id:'task',when:{entry:'task'}}],defaults={entry:'query'};
  let context=nextContext(defaults,{setContext:{entry:'task'}});context=nextContext(context,{label:'开通成功'});
  assert.deepEqual(eligibleEdges(branches,context).map(e=>e.id),['task']);assert.deepEqual(eligibleEdges(branches,defaults).map(e=>e.id),['query']);assert.deepEqual(defaults,{entry:'query'});
  assert.deepEqual(eligibleEdges([{id:'open'},{id:'blocked',when:{paid:false}}],{paid:true}).map(e=>e.id),['open']);
});
test('条件分支在模块导出中全部保留，错误条件不能保存',()=>{
  const m=fixture();m.contextDefaults={entry:'query'};m.edges[0].when={entry:'query'};m.edges.push({id:'other',from:'one',to:'unused',label:'继续',when:{entry:'task'},setContext:{paid:true}});
  const shared=exportSubset(m,'a');assert.equal(shared.nodes.length,3);assert.deepEqual(shared.contextDefaults,m.contextDefaults);assert.equal(shared.edges.length,2);assert.deepEqual(validate(m),[]);
  m.edges[0].when={entry:['query']};m.contextDefaults=[];assert.equal(validate(m).length,2);
});
test('竖屏状态重新编排不发生上下重叠',()=>{const m=fixture();m.nodes[0].module='b';m.nodes[0].width=375;m.nodes[0].height=812;m.modules[1].entry='one';const result=autoLayout(m,'b');assert.ok(result.nodes[1].y-result.nodes[0].y>=canvasNodeHeight(m.nodes[0]));});
test('批注和位置的撤销保留前后内容',()=>{const m=fixture(),history=new History();history.push(m);m.nodes[0].x=800;m.annotations[0].text='修改后';const old=history.undo(m);assert.equal(old.nodes[0].x,60);assert.equal(old.annotations[0].text,fixture().annotations[0].text);assert.equal(m.annotations[0].text,'修改后');});
test('删除所选连线只移除对应关系和连线批注，保留页面、另一分支且可撤销',()=>{
  const m=fixture(),history=new History();m.edges.push({id:'branch',from:'one',to:'unused',label:'非管理员'});m.annotations.push({id:'edge-note',edge:m.edges[0].id,text:'连线说明'});
  const before=clone(m),deleted=m.edges[0].id;history.push(m);removeConnections(m,[deleted]);
  assert.deepEqual(m.nodes,before.nodes);assert.deepEqual(m.modules,before.modules);assert.equal(m.edges.length,1);assert.equal(m.edges[0].id,'branch');assert.equal(m.annotations.some(a=>a.edge===deleted),false);assert.deepEqual(m.annotations,before.annotations.filter(a=>a.edge!==deleted));assert.deepEqual(validate(m),[]);
  const restored=history.undo(m);assert.deepEqual(restored,before);const removed=m;assert.deepEqual(removed.nodes,before.nodes);assert.equal(removed.edges.some(e=>e.id===deleted),false);assert.equal(removed.edges[0].id,'branch');
});
test('连线起点和终点可分别改动；换来源清理旧热点，换目标保留原控件且可撤销',()=>{
  const m=fixture(),history=new History(),edge=m.edges[0];edge.rect=[.1,.2,.2,.1];edge.imagePath='assets/old.png';edge.condition='已购买';edge.description='原说明';const before=clone(m),id=edge.id;
  history.push(m);assert.equal(reconnectEdge(m,id,'to','unused','left','bottom'),true);assert.equal(edge.from,'one');assert.equal(edge.selector,before.edges[0].selector);assert.equal(edge.to,'unused');assert.equal(edge.toSide,'left');assert.equal(edge.fromSide,'bottom');
  history.push(m);assert.equal(reconnectEdge(m,id,'from','two','right'),true);assert.equal(edge.from,'two');assert.equal(edge.to,'unused');for(const field of ['selector','rect','imagePath'])assert.equal(field in edge,false);assert.equal(edge.trigger,'next');assert.equal(edge.condition,'已购买');assert.equal(edge.description,'原说明');assert.deepEqual(m.nodes,before.nodes);
  const restored=history.undo(m);assert.equal(restored.edges[0].from,'one');assert.equal(restored.edges[0].selector,before.edges[0].selector);assert.equal(m.edges[0].from,'two');const stable=clone(m);assert.equal(reconnectEdge(m,id,'from','unused','left'),false);assert.deepEqual(m,stable);
});
test('删除节点保留其余手动位置，不再自动补位，支持撤销',()=>{
  const m=fixture();m.nodes.forEach(n=>n.module='a');m.nodes[0].x=60;m.nodes[0].y=60;m.nodes[1].x=60;m.nodes[1].y=455;m.nodes[2].x=1380;m.nodes[2].y=1640;
  const before=clone(m),history=new History();history.push(m);removeNodes(m,['two']);assert.equal(m.nodes.length,2);assert.deepEqual(m.nodes,before.nodes.filter(n=>n.id!=='two'));assert.equal(m.edges.length,0);assert.deepEqual(validate(m),[]);
  assert.deepEqual(history.undo(m),before);
});
test('收拢引用节点只改模块内位置，不移动来源模块中的页面',()=>{
  const m=fixture();m.nodes[1].x=1800;m.nodes[1].y=2200;m.referencePositions={a:{two:{x:1800,y:2200}}};const original=clone(m.nodes[1]);compactCanvas(m,'a');assert.deepEqual(m.nodes[1],original);const ref=moduleNodes(m,'a').find(n=>n.id==='two');assert.equal(ref.x,540);assert.equal(ref.y,450);assert.equal(m.referencePositions.a.two.y,450);
});
test('分叉在线上显示为共用连接点，不成为页面节点或演示操作',()=>{
  const m=fixture(),branch={id:'unpaid',module:'a',kind:'note',presentation:'branch',title:'未购买套餐',width:200,height:56,x:160,y:430};m.nodes.push(branch);
  m.edges.push({id:'unpaid-in',from:'one',to:'unpaid',label:'',diagram:true},{id:'admin',from:'unpaid',to:'two',label:'管理员',diagram:true},{id:'member',from:'unpaid',to:'unused',label:'非管理员',diagram:true});
  assert.equal(isBranch(branch),true);assert.equal(canvasNodeWidth(branch),16);assert.equal(canvasNodeHeight(branch),16);for(const side of ['top','right','bottom','left'])assert.deepEqual(connectionPoint(branch,side),[168,438]);assert.deepEqual(validate(m),[]);assert.equal(overviewEdges(m).filter(e=>e.from==='unpaid').length,2);assert.equal(eligibleEdges(m.edges).some(e=>e.diagram),false);assert.equal(exportSubset(m,'a').nodes.some(isBranch),true);assert.equal(restoreView(m,{moduleId:'a',current:'unpaid'}).current,null);
  assert.equal(reconnectEdge(m,'admin','from','one','bottom'),true);assert.equal(m.edges.find(e=>e.id==='admin').diagram,undefined);
});
test('从现有连线拖出同组分支，保留产品控件绑定，重复扩展共用主线并支持撤销',()=>{
  const m=fixture(),history=new History(),before=clone(m);history.push(m);const result=createLineBranch(m,'go','unused',[260,430],'top');assert.ok(result);assert.equal(m.nodes.filter(isBranch).length,1);assert.equal(m.edges.find(e=>e.id==='go').from,'one');assert.equal(m.edges.find(e=>e.id==='go').selector,'#go');assert.equal(m.edges.find(e=>e.id==='go').canvasFrom,result.groupId);
  const groupEdges=overviewEdges(m).filter(e=>e.from===result.groupId);assert.equal(groupEdges.length,2);assert.deepEqual(new Set(groupEdges.map(e=>e.to)),new Set(['two','unused']));assert.deepEqual(validate(m),[]);const next=createLineBranch(m,result.edgeId,'one',[500,500],'right');assert.equal(next.groupId,result.groupId);assert.equal(m.nodes.filter(isBranch).length,1);assert.equal(m.edges.filter(e=>e.to===result.groupId).length,1);assert.deepEqual(validate(exportSubset(m,'a')),[]);assert.deepEqual(history.undo(m),before);
});
test('线上分支入口位于实际线段中间，忽略文字偏移并支持负坐标',()=>{
  const split=lineBranchSplit([[-500,-200],[-100,-200],[-100,0]]);
  assert.deepEqual(split.point,[-300,-200]);assert.equal(split.side,'right');
  assert.deepEqual(split.before,[[-500,-200],[-300,-200]]);assert.deepEqual(split.after,[[-300,-200],[-100,-200],[-100,0]]);
  assert.equal(lineBranchSplit([[0,0],[1,1]]),null);assert.equal(lineBranchSplit([[0,0],[0,0]]),null);
});
test('点击线上新增分支保留原路径、页面位置、交互绑定和其他连线，撤销一次恢复',()=>{
  const compact=points=>{const out=[];for(const p of points){if(out.at(-1)?.every((v,i)=>v===p[i]))continue;out.push(p);while(out.length>2){const [a,b,c]=out.slice(-3);if((a[0]===b[0]&&b[0]===c[0]||a[1]===b[1]&&b[1]===c[1])&&(b[0]-a[0])*(c[0]-b[0])+(b[1]-a[1])*(c[1]-b[1])>=0)out.splice(-2,1);else break;}}return out;};
  for(const manual of [false,true]){
    const m=fixture();m.nodes.forEach(n=>n.module='a');Object.assign(m.nodes[0],{x:-600,y:-300});Object.assign(m.nodes[1],{x:300,y:-100});Object.assign(m.nodes[2],{x:300,y:700});
    const edge=m.edges.find(e=>e.id==='go');Object.assign(edge,{fromSide:'right',toSide:'left',when:{mode:'query'},rect:[0,0,.1,.1],labelPosition:[30,-300]});
    if(manual)edge.waypoints=[[-150,-80],[150,-80],[150,120]];
    const before=clone(m),history=new History();history.push(m);
    const line=routeConnections(m.nodes,overviewEdges(m),{scope:'branch-preserve-'+manual}).find(l=>l.edge.id===edge.id),split=lineBranchSplit(line.route.points);
    const result=createLineBranch(m,edge.id,'unused',split.point,'left',{points:line.route.points,from:line.from.id,fromSide:line.fromSide,toSide:line.toSide});
    assert.ok(result);assert.deepEqual(m.nodes.slice(0,before.nodes.length),before.nodes);
    for(const key of ['from','to','selector','rect','when','label','labelPosition'])assert.deepEqual(edge[key],before.edges.find(e=>e.id===edge.id)[key]);
    assert.deepEqual(m.edges.filter(e=>before.edges.some(old=>old.id===e.id)&&e.id!==edge.id),before.edges.filter(e=>e.id!==edge.id));
    const routes=routeConnections(m.nodes,overviewEdges(m),{scope:'branch-preserve-'+manual}),trunk=routes.find(l=>l.edge.to===result.groupId),suffix=routes.find(l=>l.edge.id===edge.id);
    assert.deepEqual(compact([...trunk.route.points,...suffix.route.points]),compact(line.route.points));
    assert.equal([...trunk.edge.waypoints,...suffix.edge.waypoints].some(p=>p.every((v,i)=>v===split.point[i])),false);
    assert.deepEqual(validate(m),[]);assert.deepEqual(history.undo(m),before);
  }
});
test('在已有支线上也可从所选线段中间分叉，原分叉点不移动；无效输入不写入模型',()=>{
  const m=fixture();m.nodes.forEach((n,i)=>{n.module='a';n.x=i*800;n.y=0;});const initial=createLineBranch(m,'go','unused',[600,430]),beforeNodes=clone(m.nodes),before=clone(m);
  assert.equal(createLineBranch(m,'go','unused',[0,0],'top',{points:[[0,0],[10,10]],fromSide:'bottom',toSide:'top'}),null);assert.deepEqual(m,before);
  const line=routeConnections(m.nodes,overviewEdges(m),{scope:'branch-again'}).find(l=>l.edge.id===initial.edgeId),split=lineBranchSplit(line.route.points);
  const result=createLineBranch(m,initial.edgeId,'one',split.point,'top',{points:line.route.points,from:line.from.id,fromSide:line.fromSide,toSide:line.toSide});
  assert.notEqual(result.groupId,initial.groupId);assert.deepEqual(m.nodes.slice(0,beforeNodes.length),beforeNodes);assert.deepEqual(validate(m),[]);
});
test('节点挂到线组分叉点时保留原始页面绑定，改回普通来源时解除挂接',()=>{
  const m=fixture(),result=createLineBranch(m,'go','unused',[200,400]),edge=m.edges.find(e=>e.id==='go');assert.equal(reconnectEdge(m,'go','from',result.groupId,'left'),true);assert.equal(edge.selector,'#go');assert.equal(overviewEdges(m).find(e=>e.id==='go').from,result.groupId);assert.equal(reconnectEdge(m,'go','from','unused','right'),true);assert.equal(edge.canvasFrom,undefined);assert.equal(edge.selector,undefined);assert.equal(edge.from,'unused');
});
test('模块分区按讲解顺序排列目录与画布，标题边界完整且分区之间不混排',()=>{
  const m=fixture();m.modules[0].sections=[{id:'mine',title:'我的技能'},{id:'market',title:'技能市场'},{id:'link',title:'联动'}];m.nodes.forEach(n=>n.module='a');Object.assign(m.nodes[0],{section:'market',x:80,y:600});Object.assign(m.nodes[1],{section:'mine',x:80,y:120});Object.assign(m.nodes[2],{section:'link',x:80,y:1800});
  assert.deepEqual(orderedModuleNodes(m,'a').map(n=>n.id),['two','one','unused']);const sections=canvasSections(m,'a');assert.deepEqual(sections.map(s=>s.id),['mine','market','link']);assert.equal(sections[0].y,62);assert.equal(sections[0].width,448);assert.deepEqual(validate(m),[]);const saved=exportSubset(m,'a');assert.deepEqual(saved.modules[0].sections,m.modules[0].sections);m.nodes[0].section='missing';assert.match(validate(m).join(','),/页面分区不存在/);
});
test('连线驱动页面排布：分支并排、下游顺延、共用结果在所有前置页面之后',()=>{
  const m=layoutFixture(),before=clone(m),n=id=>m.nodes.find(n=>n.id===id);adaptCanvasLayout(m,'flow',{seeds:['root'],edgeId:'to-auth'});
  assert.equal(n('admin').y,n('member').y);assert.equal(n('guide-a').y,n('guide-b').y);assert.ok(n('auth').y>n('root').y);assert.ok(n('blocked').y>=n('purchase').y+canvasNodeHeight(n('purchase')));assert.ok(n('blocked').y>=n('member').y+canvasNodeHeight(n('member')));assertNoNodeOverlap(m.nodes);assert.deepEqual(n('detached'),before.nodes.find(n=>n.id==='detached'));
  for(const original of before.nodes){const actual=n(original.id);assert.equal(actual.path,original.path);assert.equal(actual.description,original.description);}assert.deepEqual(validate(m),[]);const settled=clone(m);adaptCanvasLayout(m,'flow',{seeds:['root']});assert.deepEqual(m,settled);
});
test('改接起点后页面跟随新关系，改线和移动位置一起撤销',()=>{
  const m=layoutFixture(),history=new History(),before=clone(m);history.push(m);reconnectEdge(m,'to-auth','from','member','bottom');adaptCanvasLayout(m,'flow',{seeds:['root','member','auth'],edgeId:'to-auth'});
  const member=m.nodes.find(n=>n.id==='member'),auth=m.nodes.find(n=>n.id==='auth');assert.ok(auth.y>=member.y+canvasNodeHeight(member));assertNoNodeOverlap(m.nodes);assert.deepEqual(history.undo(m),before);
});
test('新增线组分支会重新分配兄弟节点空间；含回连时仍能稳定排布',()=>{
  const m=layoutFixture();m.edges.find(e=>e.id==='to-auth').selector='#start';const result=createLineBranch(m,'to-auth','detached',[600,400]);adaptCanvasLayout(m,'flow',{edgeId:result.edgeId,seeds:[result.groupId]});assert.equal(m.edges.find(e=>e.id==='to-auth').selector,'#start');assertNoNodeOverlap(m.nodes);
  m.edges.push({id:'back',from:'blocked',to:'admin',label:'返回'});adaptCanvasLayout(m,'flow',{edgeId:'back'});assertNoNodeOverlap(m.nodes);assert.ok(m.nodes.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)));const settled=clone(m);adaptCanvasLayout(m,'flow',{edgeId:'back'});assert.deepEqual(m,settled);assert.deepEqual(validate(m),[]);
});
test('排布只保存本模块的引用位置，不修改来源页面和隐藏状态',()=>{
  const m=fixture(),original=clone(m.nodes[1]);m.nodes.push({...clone(m.nodes[0]),id:'hidden',overview:false,overviewAlias:'one',x:2300,y:4000});const hidden=clone(m.nodes.at(-1));adaptCanvasLayout(m,'a',{edgeId:'go'});
  assert.deepEqual(m.nodes[1],original);assert.deepEqual(m.nodes.at(-1),hidden);const reference=moduleNodes(m,'a').find(n=>n.id==='two');assert.ok(reference.y>m.nodes[0].y);assert.equal(m.referencePositions.a.two.y,reference.y);assertNoNodeOverlap(moduleNodes(m,'a'));assert.deepEqual(validate(m),[]);
});
test('自动排布保留业务分区顺序，下方板块整体顺延且保持内部相对位置',()=>{
  const m=fixture();m.nodes.forEach(n=>n.module='a');m.modules[0].sections=[{id:'mine',title:'我的技能'},{id:'market',title:'市场'}];Object.assign(m.nodes[0],{section:'mine',x:80,y:120});Object.assign(m.nodes[1],{section:'mine',x:560,y:120});Object.assign(m.nodes[2],{section:'market',x:80,y:900});adaptCanvasLayout(m,'a',{edgeId:'go'});
  assert.ok(m.nodes[2].y>=m.nodes[1].y+canvasNodeHeight(m.nodes[1])+180);assert.equal(m.nodes[2].x,80);const sections=canvasSections(m,'a');assert.ok(sections[1].y>sections[0].y+sections[0].height);assertNoNodeOverlap(m.nodes);
});
test('横向及反向连接按起点方向排布，移动端尺寸与连接方向一并适配',()=>{
  for(const direction of ['right','left','top','bottom']){const m=fixture();m.nodes[1].module='a';m.edges[0].fromSide=direction;adaptCanvasLayout(m,'a',{edgeId:'go'});const [from,to]=m.nodes;
    if(direction==='right')assert.ok(to.x>=from.x+canvasNodeWidth(from));if(direction==='left')assert.ok(to.x+canvasNodeWidth(to)<=from.x);if(direction==='bottom')assert.ok(to.y>=from.y+canvasNodeHeight(from));if(direction==='top')assert.ok(to.y+canvasNodeHeight(to)<=from.y);assertNoNodeOverlap(moduleNodes(m,'a'));assert.equal(m.edges[0].selector,'#go');
  }
});
test('说明安全渲染列表、加粗和表格',()=>{const html=markdown('**规则**\n- 条目\n|字段|说明|\n|---|---|\n|值|<script>危险</script>|');assert.match(html,/<strong>规则/);assert.match(html,/<table>/);assert.ok(!html.includes('<script>'));});
test('说明图片只使用内嵌项目图片，保留相对引用且不执行注入',()=>{
  const src='data:image/png;base64,aGVsbG8=',images={'assets/picture.png':src};
  const html=markdown('原说明\n![参考"图](assets/picture.png)',images);
  assert.match(html,/<img src="data:image\/png;base64,/);assert.match(html,/alt="参考&quot;图"/);assert.match(html,/data-asset-path="assets\/picture.png"/);
  assert.ok(!markdown('![外部](https://example.invalid/x.png)',images).includes('<img'));
  assert.ok(!markdown('![注入](assets/picture.png)',{'assets/picture.png':'data:image/png;base64,a" onerror="alert(1)'}).includes('<img'));
  assert.ok(!markdown('`![示例](assets/picture.png)`',images).includes('<img'));
});
test('说明编辑的段落、图片和格式转回可继续维护的正文',()=>{
  const text=value=>({nodeType:3,textContent:value});
  const el=(tag,childNodes=[],attrs={})=>({nodeType:1,tagName:tag,childNodes,get children(){return this.childNodes.filter(c=>c.nodeType===1);},hasAttribute:key=>key in attrs,getAttribute:key=>attrs[key]??null,querySelectorAll(selector){return this.children.flatMap(c=>[...(c.tagName===selector.toUpperCase()?[c]:[]),...c.querySelectorAll(selector)]);}});
  const root=el('DIV',[text('第一段'),el('DIV',[el('STRONG',[text('第二段')])]),el('P',[el('IMG',[],{'data-asset-path':'assets/reference.png',alt:'参考图'})]),el('UL',[el('LI',[text('说明一')]),el('LI',[text('说明二')])]),el('SPAN',[text('上传中')],{'data-upload-pending':'true'})]);
  const result=readDescription(root);assert.match(result,/第一段\n\n\*\*第二段\*\*/);assert.match(result,/!\[参考图\]\(assets\/reference.png\)/);assert.match(result,/- 说明一\n- 说明二/);assert.ok(!result.includes('上传中'));
});
test('说明图片与文字保存于原节点，模块分享只内嵌所需图片',()=>temporary(async root=>{
  const store=await setup(root),src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVAAAAABJRU5ErkJggg==';
  const image=await store.upload({type:'image/png',data:src}),unused=await store.upload({type:'image/png',data:src}),before=await store.readModel();
  before.model.nodes[0].description=`管理员开通套餐\n\n![参考图](${image.path})`;before.model.nodes[2].description=`![其他图片](${unused.path})`;
  await store.save(before.model,before.revision);const saved=await store.load();
  assert.equal(saved.model.nodes.length,3);assert.deepEqual(saved.model.edges,fixture().edges);assert.equal(saved.images[image.path],src);assert.equal(saved.model.nodes[0].description,before.model.nodes[0].description);
  const html=await standalone(saved,{module:'a'}),data=JSON.parse(html.match(/globalThis\.YUANXING_BOOT=([\s\S]*?);<\/script>/)[1]);
  assert.deepEqual(Object.keys(data.bundle.images),[image.path]);assert.equal(data.bundle.images[image.path],src);assert.match(markdown(data.bundle.model.nodes[0].description,data.bundle.images),/<img src="data:/);
  await assert.rejects(standalone({...saved,images:{}},{module:'a'}),/说明图片未载入/);
}));
test('说明图片引用覆盖页面、操作、批注和共用规则并校验路径',()=>{
  const m=fixture();m.nodes[0].description='![图](assets/page.png)';m.edges[0].description='![图](assets/page.png)\n![操作](assets/edge.jpg)';m.annotations[0].text='![批注](assets/pin.webp)';m.rules={rule:'![规则](assets/rule.png)'};
  assert.deepEqual(descriptionImagePaths(m),['assets/page.png','assets/edge.jpg','assets/pin.webp','assets/rule.png']);assert.deepEqual(validate(m),[]);
  m.nodes[0].description='![越界](assets/../../private.png)';assert.ok(validate(m).some(error=>error.includes('说明图片')));
  m.nodes[0].description='`![代码示例](https://example.invalid/a.png)`';assert.ok(!descriptionImagePaths(m).some(path=>path.startsWith('https:')));
});
test('缺失的说明图片不会被静默导出',()=>temporary(async root=>{const m=fixture();m.nodes[2].description='![参考图](assets/missing.png)';const store=await setup(root,m);await assert.rejects(store.load(),/说明图片无法读取/);}));
test('公共组件嵌套展开与循环、缺失校验',()=>{assert.equal(expandHTML('<!-- include:a -->',{a:'A<!-- include:b -->',b:'B'}),'AB');assert.throws(()=>expandHTML('<!-- include:a -->',{a:'<!-- include:a -->'}));assert.throws(()=>expandHTML('<!-- include:a -->',{}));});
test('原子保存使用版本核对，过期写入保留已有数据',()=>temporary(async root=>{const store=await setup(root);const before=await store.readModel();const next=clone(before.model);next.annotations[0].text='已保存';const saved=await store.save(next,before.revision);assert.notEqual(saved.revision,before.revision);await assert.rejects(store.save(before.model,before.revision),e=>e.status===409);assert.equal((await store.readModel()).model.annotations[0].text,'已保存');assert.equal((await fs.readdir(path.join(root,'artifact'))).filter(n=>n.endsWith('.tmp')).length,0);}));
test('同时提交相同版本，仅一份成功',()=>temporary(async root=>{const store=await setup(root),before=await store.readModel(),a=clone(before.model),b=clone(before.model);a.title='甲';b.title='乙';const results=await Promise.allSettled([store.save(a,before.revision),store.save(b,before.revision)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);}));
test('源码变化刷新资源，编排和批注位置不变',()=>temporary(async root=>{const store=await setup(root),a=await store.load();await fs.writeFile(path.join(root,'artifact/states/one.html'),'<button id="go">修改后的页面</button>');const b=await store.load();assert.notEqual(a.sourcesSignature,b.sourcesSignature);assert.deepEqual(a.model.annotations,b.model.annotations);assert.deepEqual(a.model.nodes,b.model.nodes);assert.ok(a.resources.one.includes('<script>'));}));
test('图片上传保存到项目，并能内嵌至分享',()=>temporary(async root=>{const store=await setup(root);const data='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVAAAAABJRU5ErkJggg==';const uploaded=await store.upload({type:'image/png',data});assert.match(uploaded.path,/^assets\/.+\.png$/);const {model,revision}=await store.readModel();model.nodes.push({id:'image',module:'a',title:'截图',kind:'image',path:uploaded.path,width:1,height:1,x:400,y:100});await store.save(model,revision);assert.equal((await store.load()).resources.image,data);await assert.rejects(store.upload({type:'image/png',data:'data:image/png;base64,aHRtbA=='}));}));
test('越界路径及符号链接拒绝读取',()=>temporary(async root=>{const store=await setup(root);await assert.rejects(safePath(store.artifact,'../secret'));await fs.symlink(os.tmpdir(),path.join(store.artifact,'outside'));await assert.rejects(safePath(store.artifact,'outside','yes'));}));
test('接口按本机 Host 与会话令牌限制写入，不启动网络服务',()=>temporary(async root=>{const store=await setup(root),handler=createHandler(store,'secret'),data=await store.readModel();assert.equal((await request(handler,'PUT','/api/project',data)).status,403);assert.equal((await request(handler,'GET','/api/project',null,{host:'evil.example'})).status,403);assert.equal((await request(handler,'PUT','/api/project',data,{authorization:'Bearer secret',origin:'https://evil.example'})).status,403);assert.equal((await request(handler,'PUT','/api/project',data,{authorization:'Bearer secret'})).status,200);}));
test('单文件分享无外部资产，内容只读，说明注入安全',()=>temporary(async root=>{const store=await setup(root);const bundle=await store.load();bundle.model.annotations[0].text='</script><img src="https://example.invalid/x">';const html=await standalone(bundle,{module:'a'});assert.match(html,/"readonly":true/);assert.ok(!/<script[^>]+src=/.test(html));assert.ok(!/<link[^>]+href=["'](?!data:)/.test(html));assert.ok(!html.includes('<img src="https://example.invalid'));assert.match(html,/const esc=escapeHTML/);assert.ok(!html.includes('其他说明'));}));
test('旧 manifest 的页面、逻辑和实际转移来源可导入',()=>temporary(async root=>{await fs.mkdir(path.join(root,'artifact/states'),{recursive:true});await fs.writeFile(path.join(root,'artifact/manifest.json'),JSON.stringify({requirements:[{id:'r',title:'旧页面',states:[{id:'a',html:'states/a.html',initial:true},{id:'b',html:'states/b.html'}],transitions:[{id:'T1',to:'b'}],logic:[{id:'L1',text:'旧规则'}]}]}));await fs.writeFile(path.join(root,'artifact/states/a.html'),'<button data-transition-id="T1">继续</button>');await fs.writeFile(path.join(root,'artifact/states/b.html'),'<p>结果</p>');const store=await createStore(root),bundle=await store.load();assert.equal(bundle.model.edges[0].from,'r:a');assert.equal(bundle.model.annotations[0].text,'旧规则');assert.equal(validate(bundle.model).length,0);}));
