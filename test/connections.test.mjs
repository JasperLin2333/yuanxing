import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {clone,connectionPoint,connectionDirections,connectionTarget,connectionDisplayPath,previewConnection,routeConnections,overviewEdges,createLineBranch,lineBranchSplit,connectNodes,reconnectEdge,isBranch,moveCanvasNodes,snapNodePosition,validate,canvasNodeWidth,canvasNodeHeight,placeConnectionLabels} from '../runtime/core.mjs';

const source=await readFile(new URL('../runtime/app.mjs',import.meta.url),'utf8');
const page=(id,x,y)=>({id,module:'flow',kind:'note',title:id,x,y,width:1280,height:800,description:''});
const fixture=()=>({version:1,title:'连线',modules:[{id:'flow',title:'流程'}],nodes:[page('a',0,0),page('b',1000,0),page('c',1000,700)],edges:[{id:'ab',from:'a',to:'b',fromSide:'right',toSide:'left',label:'打开',selector:'#open'}],annotations:[]});
const splitLine=model=>{const line=routeConnections(model.nodes,overviewEdges(model),{scope:'split-fixture'})[0],split=lineBranchSplit(line.route.points);return {line,split,route:{points:line.route.points,from:line.from.id,fromSide:line.fromSide,toSide:line.toSide,edgeIds:[line.edge.id],module:'flow'}};};

test('吸附在端点附近生效，卡片内部选择最近一侧，排除来源并适应缩放',()=>{
  const nodes=fixture().nodes;
  assert.equal(connectionTarget(nodes,[982,145],{exclude:['a']}).node.id,'b');assert.equal(connectionTarget(nodes,[982,145],{exclude:['a']}).side,'left');
  assert.equal(connectionTarget(nodes,[975,145],{exclude:['a']}),null);
  assert.equal(connectionTarget(nodes,[975,145],{exclude:['a'],tolerance:48}).node.id,'b');
  assert.equal(connectionTarget(nodes,[1390,270]).side,'right');assert.equal(connectionTarget(nodes,[400,145],{exclude:['a']}),null);
});
test('普通连线、改接起点和分叉的预览与最终路径一致',()=>{
  const m=fixture();
  for(const endpoint of ['from','to']){
    const line=previewConnection(m.nodes,m.nodes[0],'right',m.nodes[1],'left',{endpoint});
    const saved=routeConnections(m.nodes,[{...line.edge,id:'saved'}],{scope:'saved-'+endpoint})[0];assert.deepEqual(saved.route.points,line.route.points);
  }
  const {split,route}=splitLine(m),draft={id:'draft',kind:'note',presentation:'branch',x:split.point[0]-8,y:split.point[1]-8};
  const preview=previewConnection(m.nodes,draft,split.side,m.nodes[2],'left',{branch:true});
  const result=createLineBranch(m,'ab','c',split.point,'left',{...route,branchSide:preview.fromSide});
  const saved=routeConnections(m.nodes,overviewEdges(m),{scope:'saved-fork'}).find(l=>l.edge.id===result.edgeId);
  assert.deepEqual(saved.route.points,preview.route.points);assert.deepEqual(validate(m),[]);
});
test('圆角只改变显示，保留端点，短线无溢出，贴住节点时保留安全直角',()=>{
  const points=[[0,0],[100,0],[100,100]],before=clone(points),rounded=connectionDisplayPath(points);
  assert.match(rounded,/^M0,0 L92,0 Q100,0 100,8 L100,100$/);assert.deepEqual(points,before);
  assert.equal(connectionDisplayPath([[0,0],[2,0],[2,2]],8),'M0,0 L1,0 Q2,0 2,1 L2,2');
  assert(!connectionDisplayPath(points,8,[page('touch',-300,1)]).includes('Q'));
  assert.equal(connectionDisplayPath([]),'');assert(!connectionDisplayPath([[0,0],[0,0],[1,0]]).includes('NaN'));
});
test('共用一条可见线的不同按钮一并分叉，保留实际跳转、条件与标记',()=>{
  const m=fixture();m.edges.push({...clone(m.edges[0]),id:'other-button',selector:'#other',when:{role:'admin'}});m.annotations.push({id:'memo',edge:'other-button',text:'保留说明'});
  const before=clone(m),{split,route}=splitLine(m);route.edgeIds=['ab','other-button'];
  const result=createLineBranch(m,'ab','c',split.point,'left',route);assert(result);assert.equal(m.nodes.filter(isBranch).length,1);
  for(const id of route.edgeIds){const edge=m.edges.find(e=>e.id===id),old=before.edges.find(e=>e.id===id);for(const key of ['from','to','selector','when','label'])assert.deepEqual(edge[key],old[key]);assert.equal(edge.canvasFrom,result.groupId);}
  assert.deepEqual(m.annotations,before.annotations);assert.deepEqual(m.nodes.slice(0,3),before.nodes);assert.deepEqual(validate(m),[]);
  const invalid=clone(before);invalid.edges.push({id:'unrelated',from:'a',to:'c'});const untouched=clone(invalid);assert.equal(createLineBranch(invalid,'ab','c',split.point,'left',{...route,edgeIds:['ab','unrelated']}),null);assert.deepEqual(invalid,untouched);
});
test('分叉支持从实际指定线段拆分；移动对齐端点且拒绝把分叉拖进页面',()=>{
  const path=[[400,145],[700,145],[700,500],[1000,500]],point=[700,400],split=lineBranchSplit(path,point);assert.deepEqual(split.point,point);assert.equal(split.side,'bottom');
  const m=fixture(),original=splitLine(m),result=createLineBranch(m,'ab','c',original.split.point,'left',original.route),branch=m.nodes.find(n=>n.id===result.groupId),oldNodes=clone(m.nodes.filter(n=>!isBranch(n))),before=clone(branch);
  const snapped=snapNodePosition(branch,[branch.x+3,141],m.nodes.filter(n=>n.id!==branch.id));assert.equal(snapped.y,137);assert(snapped.guides.length);
  assert.deepEqual(moveCanvasNodes(m,'flow',[{id:branch.id,x:100,y:100}]),[]);assert.deepEqual(branch,before);
  assert.deepEqual(moveCanvasNodes(m,'flow',[{id:branch.id,x:branch.x,y:branch.y+80}]),[branch.id]);assert.equal(branch.y,before.y+80);assert.deepEqual(m.nodes.filter(n=>!isBranch(n)),oldNodes);assert.deepEqual(validate(m),[]);
});

function controllerFixture(){
  const model=fixture(),listeners=new Map(),frames=new Map();let frameId=0;
  const classList=()=>{const names=new Set();return {add:n=>names.add(n),remove:n=>names.delete(n),contains:n=>names.has(n),toggle(n,on){if(on)names.add(n);else names.delete(n);}};};
  const element=()=>({dataset:{},attrs:{},style:{},classList:classList(),setAttribute(k,v){this.attrs[k]=v;},append(){},remove(){this.removed=true;},focus(){}});
  const svg=element(),world=element(),viewport=element(),cards=new Map(model.nodes.map(n=>[n.id,element()]));
  const state={model,selected:null,spacePressed:false,readonly:false,camera:{scale:1},cancelConnection:null,activeCanvasGesture:null,connectionTarget,connectionDisplayPath,previewConnection,connectionPoint,connectionDirections,overviewEdges,createLineBranch,connectNodes,reconnectEdge,clone,
    activeCanvasNodes:()=>state.model.nodes,canvasPoint:e=>[e.clientX,e.clientY],closeMenus(){},renderInspector(){},drawLines(){},writes:0,undo:[],edit(fn){state.undo.push(clone(state.model));fn(state.model);state.writes++;},
    requestAnimationFrame(fn){frames.set(++frameId,fn);return frameId;},cancelAnimationFrame(id){frames.delete(id);},
    $:selector=>selector==='#lines'?svg:selector==='#canvas-world'?world:viewport,
    document:{createElementNS:element,elementFromPoint:()=>({closest:()=>null}),querySelector:selector=>cards.get(selector.match(/data-id="([^"]+)"/)?.[1]),querySelectorAll:()=>[...cards.values()],addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name,fn){if(listeners.get(name)===fn)listeners.delete(name);}}};
  vm.runInContext(source.slice(source.indexOf('function dragConnection('),source.indexOf('function editConnectionLabel(')),vm.createContext(state));
  const event=(type,x,y,extra={})=>({type,clientX:x,clientY:y,pointerId:1,button:0,target:{closest:selector=>selector==='#canvas-viewport'?viewport:null},preventDefault(){},stopPropagation(){},stopImmediatePropagation(){},...extra});
  const beginFork=()=>{const {split,route}=splitLine(state.model),fixed={id:'draft-fork',kind:'note',presentation:'branch',x:split.point[0]-8,y:split.point[1]-8};state.dragConnection(event('pointerdown',split.point[0],split.point[1]-28),fixed,split.side,null,'to',{edgeId:'ab',point:split.point,route});return {split,fixed};};
  return {state,listeners,event,beginFork};
}
test('分叉既能拖拽松手提交，也能点击再选目标；取消与无目标不写入数据',()=>{
  for(const mode of ['drag','click','cancel','outside']){
    const {state:s,listeners,event,beginFork}=controllerFixture(),before=clone(s.model),{split}=beginFork();
    if(mode==='drag'){listeners.get('pointermove')(event('pointermove',1000,845));listeners.get('pointerup')(event('pointerup',1000,845));}
    if(mode==='click'){listeners.get('pointerup')(event('pointerup',split.point[0],split.point[1]-28));assert(s.cancelConnection);listeners.get('pointerdown')(event('pointerdown',1000,845));}
    if(mode==='cancel')s.cancelConnection();
    if(mode==='outside')listeners.get('pointerup')(event('pointerup',3000,3000));
    if(['drag','click'].includes(mode)){assert.equal(s.writes,1);assert.equal(s.model.nodes.filter(isBranch).length,1);assert.deepEqual(s.undo[0],before);assert.deepEqual(validate(s.model),[]);}
    else{assert.equal(s.writes,0);assert.deepEqual(s.model,before);}
    assert.equal(s.cancelConnection,null);assert.equal(listeners.size,0);
  }
});
test('扩展已有分叉不再插入连接点；重复连线与原地改接不增加记录或丢失折点',()=>{
  const {state:s,listeners,event,beginFork}=controllerFixture();beginFork();listeners.get('pointerup')(event('pointerup',1000,845));const branch=s.model.nodes.find(isBranch),edge=overviewEdges(s.model).find(e=>e.from===branch.id&&e.to==='c');
  s.dragConnection(event('pointerdown',branch.x+8,branch.y+8),branch,edge.fromSide);listeners.get('pointerup')(event('pointerup',1000,845));assert.equal(s.writes,1);assert.equal(s.model.nodes.filter(isBranch).length,1);
  s.model.nodes.push(page('d',1700,700));s.dragConnection(event('pointerdown',branch.x+8,branch.y+8),branch,'right');listeners.get('pointerup')(event('pointerup',1700,845));assert.equal(s.writes,2);assert.equal(s.model.nodes.filter(isBranch).length,1);
  const display=overviewEdges(s.model).find(e=>e.id==='ab'),original=clone(s.model.edges.find(e=>e.id==='ab'));
  s.dragConnection(event('pointerdown',1000,145),branch,display.fromSide,display);listeners.get('pointerup')(event('pointerup',1000,145));assert.equal(s.writes,2);assert.deepEqual(s.model.edges.find(e=>e.id==='ab'),original);
});
test('更新一条连线时保留 SVG 和其他路径对象，移除连线只移除对应视图',()=>{
  let writes=0;const element=()=>({dataset:{},style:{},attrs:{},childNodes:[],classList:{add(){},remove(){},toggle(){}},setAttribute(k,v){this.attrs[k]=v;},append(...children){for(const child of children){this.childNodes.push(child);child.parent=this;}},replaceChildren(){this.childNodes=[];},remove(){this.parent.childNodes=this.parent.childNodes.filter(n=>n!==this);}});
  const svg=element();Object.defineProperty(svg,'innerHTML',{set(){writes++;svg.childNodes=[element()];}});
  const m=fixture();m.edges[0].label='';m.nodes.push(page('d',0,1400),page('e',1000,1400));m.edges.push({id:'de',from:'d',to:'e',fromSide:'right',toSide:'left'});
  const s={model:m,current:null,camera:{scale:1},cancelConnection:null,recycleOpen:false,linesHidden:false,moduleId:'flow',selected:null,readonly:true,lastLinesSignature:null,lineTextContext:null,renderSections(){},activeCanvasNodes:()=>m.nodes,overviewEdges,canvasNodeWidth,canvasNodeHeight,routeConnections,placeConnectionLabels,connectionDisplayPath,isBranch,
    connectionKey:e=>[e.from,e.to,e.condition||e.label,e.fromSide,e.toSide].join('\0'),$:()=>svg,getComputedStyle:()=>({fontFamily:'sans-serif'}),document:{createElement:()=>({getContext:()=>({measureText:()=>({width:12})})}),createElementNS:element}};
  vm.runInContext(source.slice(source.indexOf('function paintLines(){'),source.indexOf('function edgeGeometryGesture(')),vm.createContext(s));s.paintLines();
  const first=svg.yuanxingLayers.views.get('ab'),other=svg.yuanxingLayers.views.get('de'),original=other.path.attrs.d;
  m.nodes[0].y=100;s.paintLines();assert.equal(writes,1);assert.equal(svg.yuanxingLayers.views.get('ab').path,first.path);assert.equal(svg.yuanxingLayers.views.get('de').path,other.path);assert.equal(other.path.attrs.d,original);
  m.edges=m.edges.filter(e=>e.id!=='ab');s.paintLines();assert.equal(svg.yuanxingLayers.views.has('ab'),false);assert.equal(svg.yuanxingLayers.views.get('de').path,other.path);assert.equal(writes,1);
});
test('直接编辑名称只在保存时写入，Esc 放弃，按钮绑定与流程条件保留',()=>{
  for(const save of [true,false]){
    const model=fixture(),before=clone(model);let input,writes=0;
    const event={clientX:200,clientY:200,preventDefault(){},stopPropagation(){}};
    const state={model,readonly:false,node:id=>model.nodes.find(n=>n.id===id),isBranch,innerWidth:1000,innerHeight:800,$:()=>({focus(){}}),edit(fn){writes++;fn(model);},document:{querySelector:()=>null,body:{append(el){input=el;}},createElement:()=>({style:{},setAttribute(){},focus(){},select(){},remove(){}})}};
    vm.runInContext(source.slice(source.indexOf('function editConnectionLabel('),source.indexOf('function drawAlignmentGuides(')),vm.createContext(state));state.editConnectionLabel('ab',event);input.value='查看详情';input.onkeydown({...event,key:save?'Enter':'Escape'});
    assert.equal(writes,save?1:0);assert.equal(model.edges[0].label,save?'查看详情':'打开');assert.equal(model.edges[0].selector,'#open');assert.deepEqual(model.nodes,before.nodes);
  }
});
