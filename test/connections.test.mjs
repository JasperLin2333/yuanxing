import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {clone,looseConnectionSide,connectionPoint,connectionDirections,connectionTarget,connectionDisplayPath,previewConnection,routeConnections,overviewEdges,createLineBranch,lineBranchSplit,connectNodes,reconnectEdge,isBranch,moveCanvasNodes,snapNodePosition,validate,canvasNodeWidth,canvasNodeHeight,placeConnectionLabels} from '../runtime/core.mjs';

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
  const state={model,selected:null,spacePressed:false,readonly:false,camera:{scale:1},cancelConnection:null,activeCanvasGesture:null,connectionTarget,looseConnectionSide,notices:[],notice(text){state.notices.push(text);},connectionDisplayPath,previewConnection,connectionPoint,connectionDirections,overviewEdges,createLineBranch,connectNodes,reconnectEdge,clone,
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
    assert.equal(s.notices.length,mode==='outside'?1:0,mode);
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

test('落在页面内部且不靠近端点时，选面向来源的一侧；靠近端点仍吸附到端点',()=>{
  const nodes=[page('a',0,0),page('b',1000,0),page('c',1000,700),page('d',0,700)],a=nodes[0];
  assert.equal(connectionTarget(nodes,[1200,145],{exclude:['a'],toward:a}).side,'left');
  assert.equal(connectionTarget(nodes,[1200,145],{exclude:['a'],toward:a}).node.id,'b');
  assert.equal(connectionTarget(nodes,[200,845],{exclude:['a'],toward:a}).side,'top');assert.equal(connectionTarget(nodes,[200,845],{exclude:['a'],toward:a}).node.id,'d');
  assert.equal(connectionTarget(nodes,[1200,145],{exclude:['a']}).node.id,'b');
  assert.equal(connectionTarget(nodes,[1390,145],{exclude:['a'],toward:a,tolerance:32}).side,'right');
  assert.equal(connectionTarget(nodes,[1200,145],{exclude:['a'],toward:a,side:'bottom'}).side,'bottom');
});
test('游离端朝向只在主方向明显改变时切换，不在对角线附近来回跳',()=>{
  const fixed=page('a',0,0);
  assert.equal(looseConnectionSide(fixed,[700,145]),'left');assert.equal(looseConnectionSide(fixed,[200,700]),'top');
  let side=looseConnectionSide(fixed,[700,300]);assert.equal(side,'left');
  const flips=new Set();for(let y=300;y<=420;y+=4){const next=looseConnectionSide(fixed,[700,y],side);if(next!==side)flips.add(y);side=next;}
  assert(flips.size<=1,'对角线附近至多切换一次');
  assert.equal(looseConnectionSide(fixed,[200,-300],'left'),'bottom');
});
test('页面挡住路径时仍给出示意线且不提交；被挡连线不会消失',()=>{
  const nodes=[page('a',0,0),page('b',1000,0),page('cover',350,0)];
  const line=routeConnections(nodes,[{id:'ab',from:'a',to:'b',fromSide:'right',toSide:'left'}],{scope:'overlay'})[0];
  assert.equal(line.route.blocked,true);assert.deepEqual(line.route.points,[]);
  assert(line.route.overlay.length>=2);assert.deepEqual(line.route.overlay[0],line.start);assert.deepEqual(line.route.overlay.at(-1),line.end);
  const preview=previewConnection(nodes,nodes[0],'right',nodes[1],'left');assert.equal(preview.route.blocked,true);assert(preview.route.overlay.length>=2);
});
test('拖线松手：空白处与被挡方向取消并提示，轻点端口不提示，改接来源清绑定时提示',()=>{
  let c=controllerFixture(),s=c.state,before=clone(s.model);
  s.dragConnection(c.event('pointerdown',400,145),s.model.nodes[0],'right');c.listeners.get('pointermove')(c.event('pointermove',700,600));c.listeners.get('pointerup')(c.event('pointerup',700,600));
  assert.equal(s.writes,0);assert.deepEqual(s.model,before);assert.equal(s.notices.length,1);assert.match(s.notices[0],/连接点/);
  c=controllerFixture();s=c.state;s.dragConnection(c.event('pointerdown',400,145),s.model.nodes[0],'right');c.listeners.get('pointerup')(c.event('pointerup',400,145));assert.equal(s.notices.length,0);assert.equal(s.writes,0);
  c=controllerFixture();s=c.state;const edge=overviewEdges(s.model)[0];
  s.dragConnection(c.event('pointerdown',0,145),s.model.nodes[1],'left',edge,'from');c.listeners.get('pointermove')(c.event('pointermove',1200,845));c.listeners.get('pointerup')(c.event('pointerup',1200,845));
  assert.equal(s.writes,1);assert.equal(s.model.edges[0].from,'c');assert.equal(s.model.edges[0].selector,undefined);assert.equal(s.notices.length,1);assert.match(s.notices[0],/绑定已清除/);
});
test('选中连线只常显两端把手（线段把手悬停才出现），端口悬浮即现，拖线时候选页面都显示连接点',async()=>{
  const css=await readFile(new URL('../runtime/style.css',import.meta.url),'utf8');
  assert.match(css,/\.node:hover \.node-port/);assert.match(css,/\.connecting \.node:not\(\.branch\) \.node-port\{opacity:\.35;visibility:visible\}/);
  assert(!/\.edge-endpoint\{[^}]*opacity:0/.test(css));assert.match(css,/\.edge-bend\{[^}]*opacity:0/);assert.match(css,/\.edge-segment-control:hover \.edge-bend\{opacity:1/);assert.match(css,/path\.flow\.blocked/);
});
test('移动主干来源页面时，分叉点和主干折点一起平移，分支目标不被带动',()=>{
  const m=fixture(),original=splitLine(m),result=createLineBranch(m,'ab','c',original.split.point,'left',original.route),branch=m.nodes.find(n=>n.id===result.groupId);
  const trunk=m.edges.find(e=>e.to===branch.id),before={branch:[branch.x,branch.y],b:[m.nodes[1].x,m.nodes[1].y],c:[m.nodes[2].x,m.nodes[2].y],way:clone(trunk.waypoints||[])};
  const moved=moveCanvasNodes(m,'flow',[{id:'a',x:0,y:100}]);
  assert(moved.includes('a')&&moved.includes(branch.id));assert.deepEqual([branch.x,branch.y],[before.branch[0],before.branch[1]+100]);
  assert.deepEqual([m.nodes[1].x,m.nodes[1].y],before.b);assert.deepEqual([m.nodes[2].x,m.nodes[2].y],before.c);
  assert.deepEqual(trunk.waypoints||[],before.way.map(([x,y])=>[x,y+100]));assert.deepEqual(validate(m),[]);
  const other=moveCanvasNodes(m,'flow',[{id:'b',x:1000,y:60}]);assert.deepEqual(other,['b']);
});
test('选中连线的「＋」默认收起，靠近线时才显示并贴着最近的一点',async()=>{
  const css=await readFile(new URL('../runtime/style.css',import.meta.url),'utf8');
  assert.match(css,/\.edge-fork-control\{[^}]*opacity:0/);assert.match(css,/\.edge-fork-control\.active/);
  assert(source.includes('lineBranchSplit(route.points,canvasPoint(event))'));
  const near=lineBranchSplit([[0,0],[100,0],[100,200]],[100,150]);assert.deepEqual(near.point,[100,150]);assert.equal(near.side,'bottom');
});
