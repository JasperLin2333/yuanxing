import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {clone,routeConnections,canvasNodeHeight,History,validate,connectionPoint,connectionTarget,adjustConnectionSegment,adjustConnectionCurvePoint,simplifyConnectionWaypoints,connectionSegmentSnap,moveCanvasNodes,connectionDisplayPath,connectionPathSamples,connectionPathPointAt,connectionPathProject,connectionCrossArcs,reverseConnection,createLineBranch,lineBranchSplit,overviewEdges,placeConnectionLabels,reconnectEdge,canvasNodeWidth,thumbnailLayout,wheelZoomFactor,zoomCamera,canvasNodeType} from './core.mjs';
import {clearRoutingSessions,validConnectionShape} from './routing.mjs';
import {createHandler,standalone} from './server.mjs';

const page=(id,x,y,width=1280,height=800)=>({id,module:'flow',title:id,kind:'note',x,y,width,height,description:'原说明'});
function clearNodes(lines,nodes){for(const l of lines)for(let i=1;i<l.route.points.length;i++){const a=l.route.points[i-1],b=l.route.points[i];assert.ok(a[0]===b[0]||a[1]===b[1],'每段必须水平或垂直');for(const n of nodes){const hit=a[0]===b[0]?a[0]>n.x&&a[0]<n.x+canvasNodeWidth(n)&&Math.max(a[1],b[1])>n.y&&Math.min(a[1],b[1])<n.y+canvasNodeHeight(n):a[1]>n.y&&a[1]<n.y+canvasNodeHeight(n)&&Math.max(a[0],b[0])>n.x&&Math.min(a[0],b[0])<n.x+canvasNodeWidth(n);assert.ok(!hit,`路径穿过 ${n.id}`);}}}
test('混合尺寸页面独立避障，保留指定端口、原始位置和业务关系',()=>{
  clearRoutingSessions();
  const nodes=[page('admin',920,500),page('purchase',1440,500,1436,974),page('blocked',1960,800,640,320),page('auth',1960,60,1258,1148),page('rates',1440,1120,3072,2048)];
  const edges=[['a','admin','blocked'],['b','purchase','blocked'],['c','purchase','auth'],['d','purchase','rates']].map(([id,from,to])=>({id,from,to})),original=clone({nodes,edges});
  const lines=routeConnections(nodes,edges,{scope:'mixed'});
  assert.ok(lines.every(l=>l.route.engine==='feishu'));clearNodes(lines,nodes);for(const l of lines){assert.deepEqual(l.start,connectionPoint(l.from,l.fromSide));assert.deepEqual(l.end,connectionPoint(l.to,l.toSide));}assert.deepEqual({nodes,edges},original);
});

test('移动一组页面只更新受影响路径，新障碍挡路时重新避让',()=>{
  clearRoutingSessions();const nodes=[page('a',60,60),page('b',1100,60),page('c',60,1200),page('d',1100,1200)],edges=[{id:'ab',from:'a',to:'b'},{id:'cd',from:'c',to:'d'}];
  const first=routeConnections(nodes,edges,{scope:'incremental'}),stable=clone(first[1].route);
  nodes[0].y=160;const moved=routeConnections(nodes,edges,{scope:'incremental'});assert.deepEqual(moved[1].route,stable);clearNodes(moved,nodes);
  nodes.push(page('obstacle',600,140,640,320));const blocked=routeConnections(nodes,edges,{scope:'incremental'});assert.deepEqual(blocked[1].route,stable);clearNodes(blocked,nodes);
});

test('同侧多条线允许交叉，不换端口，独立计算与批量计算结果相同',()=>{
  clearRoutingSessions();const nodes=[page('home',60,1180,375,812),page('picker',600,1180,375,812),page('filled',1140,1180,375,812)];
  const edges=[['open','home','picker'],['close','picker','home'],['sales','picker','home'],['opportunity','picker','home'],['submit','home','filled']].map(([id,from,to])=>({id,from,to}));
  const lines=routeConnections(nodes,edges,{scope:'mixed-directions'});assert.ok(lines.every(l=>l.route.engine==='feishu'));clearNodes(lines,nodes);for(const l of lines){assert.deepEqual(l.start,connectionPoint(l.from,l.fromSide));assert.deepEqual(l.end,connectionPoint(l.to,l.toSide));}
  for(const l of lines)assert.deepEqual(routeConnections(nodes,[l.edge],{scope:'independent-'+l.edge.id})[0].route,l.route);
});

test('手调折点保留，刷新与撤销后仍能重算其他路径',()=>{
  clearRoutingSessions();const nodes=[page('a',60,60),page('b',760,60)],edges=[{id:'manual',from:'a',to:'b',fromSide:'right',toSide:'left',waypoints:[[500,205],[500,440],[700,440]],labelPosition:[520,460]}],original=clone(edges);
  const first=routeConnections(nodes,edges);assert.equal(first[0].route.manual,true);assert.deepEqual(edges,original);
  const repeated=routeConnections(nodes,edges);assert.deepEqual(repeated[0].route,first[0].route);
});

test('单文件仅内嵌布线引擎并可独立执行，导出数据和路径与编辑端一致',async()=>{
  const model={version:1,title:'离线',entryModule:'flow',modules:[{id:'flow',title:'流程'}],nodes:[page('a',60,60),page('b',700,60)],edges:[{id:'ab',from:'a',to:'b'}],annotations:[]};
  const html=await standalone({model,resources:{},fragments:{},images:{}});assert.ok(!/<script[^>]+src=/.test(html));assert.ok(!html.includes("Eclipse Public License"));assert.match(html,/GNU LESSER GENERAL PUBLIC LICENSE/);
  const scripts=[...html.split('<script type="module">')[0].matchAll(/<script(?![^>]*type="(?:text\/plain|application\/json)")[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  const context=vm.createContext({console,setTimeout,clearTimeout,URL,performance,document:{}});vm.runInContext('globalThis.window=globalThis;globalThis.self=globalThis;',context);for(const code of scripts)vm.runInContext(code,context);
  assert.ok(context.Avoid.Router);assert.equal(typeof context.AvoidRouting.computeRoutes,'function');assert.equal(context.ELK,undefined);assert.equal(context.YUANXING_BOOT.bundle.model.title,model.title);
  const module=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];assert.ok(!/^import /m.test(module));
  const shared=module.slice(0,module.indexOf('const $=s=>document.querySelector(s)')).replace(/^export /gm,'');
  vm.runInContext(shared+'\nglobalThis.offlineRoutes=routeConnections(YUANXING_BOOT.bundle.model.nodes,YUANXING_BOOT.bundle.model.edges);',context);
  clearRoutingSessions();assert.deepEqual(JSON.parse(JSON.stringify(context.offlineRoutes.map(l=>l.route.points))),routeConnections(model.nodes,model.edges).map(l=>l.route.points));
});

test('本地接口提供固定依赖路径，不能借依赖入口读取其他文件',async()=>{
  const handler=createHandler({},'token');
  for(const url of ['/routing.mjs','/libavoid.min.js','/libavoid-routing.js']){const req={method:'GET',url,headers:{host:'127.0.0.1:4318'}},res={writeHead(status){this.status=status;},end(text){this.text=text;}};await handler(req,res);assert.equal(res.status,200);assert.ok(res.text.length>100);}
  const req={method:'GET',url:'/../../AGENTS.md',headers:{host:'127.0.0.1:4318'}},res={writeHead(status){this.status=status;},end(){}};await handler(req,res);assert.equal(res.status,404);
});


test('飞书自由拖线段：支持跨越卡片、对齐吸附与微抖动归并，无故不返回 null',()=>{
  const nodes=[page('a',0,0),page('b',1000,0),page('block',500,400)],edge={id:'ab',from:'a',to:'b',fromSide:'right',toSide:'left'},original=clone({nodes,edge});
  const points=[[400,165],[460,165],[460,330],[940,330],[940,165],[1000,165]];
  const valid=adjustConnectionSegment(nodes,edge,points,2,-30);assert.ok(valid);const manual=routeConnections(nodes,[{...edge,waypoints:valid}])[0];assert.equal(manual.route.manual,true);assert.equal(manual.route.repaired,undefined);clearNodes([manual],nodes);
  const across=adjustConnectionSegment(nodes,edge,points,2,200);assert.ok(across);assert.equal(across[1][1],530);assert.deepEqual({nodes,edge},original);
  const snap=connectionSegmentSnap([[400,145],[460,145],[460,248],[940,248],[940,145],[1000,145]],2,-100,5);assert.equal(snap.delta,-103);assert.ok(snap.guide);
  const clean=simplifyConnectionWaypoints(nodes,edge,[[400,145],[460,145],[460,146],[940,146],[940,145],[1000,145]]);assert.deepEqual(clean,[]);
});

test('无关节点移动或单侧端点移动时，保留飞书手调中间折点不重新覆写',()=>{
  clearRoutingSessions();const model={version:1,title:'t',modules:[{id:'flow',title:'f'}],nodes:[page('a',0,0),page('b',1100,0),page('c',0,1000),page('d',1100,1000),page('block',600,600)],edges:[{id:'ab',from:'a',to:'b',fromSide:'right',toSide:'left',waypoints:[[500,145],[500,360],[1000,360],[1000,145]]},{id:'cd',from:'c',to:'d',fromSide:'right',toSide:'left'}],annotations:[]};
  const original=clone(model.edges);
  const first=routeConnections(model.nodes,model.edges,{scope:'manual-block'}),stable=clone(first[1]);assert.equal(first[0].route.repaired,undefined);
  model.nodes.at(-1).y=300;const movedBlock=routeConnections(model.nodes,model.edges,{scope:'manual-block'});assert.equal(movedBlock[0].route.repaired,undefined);assert.equal(movedBlock[0].route.blocked,undefined);assert.deepEqual(movedBlock[1],stable);assert.deepEqual(model.edges,original);
  moveCanvasNodes(model,'flow',[{id:'a',x:0,y:60}]);assert.deepEqual(model.edges[0].waypoints.slice(1,3),[[500,360],[1000,360]]);assert.equal(model.edges[0].waypoints[0][1],205);
});

test('新增线上分支保留原线几何、其他连线和原标签位置',()=>{
  const model={version:1,title:'分支',modules:[{id:'flow',title:'流程'}],nodes:[page('a',0,0),page('b',1100,0),page('c',0,1000),page('d',1100,1000)],edges:[{id:'ab',from:'a',to:'b',fromSide:'right',toSide:'left',condition:'原条件',labelT:.35},{id:'cd',from:'c',to:'d',fromSide:'right',toSide:'left',condition:'其他条件'}],annotations:[]};
  const before=clone(model),lines=routeConnections(model.nodes,model.edges,{scope:'fork-stable'}),source=lines[0],other=clone(lines[1]),labels=placeConnectionLabels(lines,model.nodes),split=lineBranchSplit(source.route.points);
  const fork=createLineBranch(model,'ab','d',split.point,'top',{points:source.route.points,from:'a',fromSide:'right',toSide:'left',labelT:.35});assert.ok(fork);
  const after=routeConnections(model.nodes,overviewEdges(model),{scope:'fork-stable'});assert.deepEqual(after.find(l=>l.edge.id==='cd'),other);assert.deepEqual(model.nodes.slice(0,before.nodes.length),before.nodes);assert.equal(model.edges.find(e=>e.id==='ab').labelT,.35);assert.equal(model.edges.find(e=>e.id==='ab').labelPosition,undefined);assert.deepEqual(placeConnectionLabels(after,model.nodes).get('cd'),labels.get('cd'));clearNodes(after,model.nodes.filter(n=>n.presentation!=='branch'));assert.deepEqual(validate(model),[]);
});

test('改接端点只清除当前线的旧折点，其他线和说明保留',()=>{
  const model={nodes:[page('a',0,0),page('b',1000,0),page('c',1000,700)],edges:[{id:'ab',from:'a',to:'b',fromSide:'right',toSide:'left',waypoints:[[500,165]],labelPosition:[500,140]},{id:'ac',from:'a',to:'c',waypoints:[[600,500]]}]},other=clone(model.edges[1]);
  assert.equal(reconnectEdge(model,'ab','to','c','left'),true);assert.equal(model.edges[0].waypoints,undefined);assert.deepEqual(model.edges[0].labelPosition,[500,140]);assert.deepEqual(model.edges[1],other);
});

test('页面接近或重叠时仍生成完整连续的飞书绕行折线，永不阻塞隐藏',()=>{
  const nodes=[page('a',0,0),page('b',1000,0),page('cover',350,0)],edge={id:'ab',from:'a',to:'b',fromSide:'right',toSide:'left'};
  const line=routeConnections(nodes,[edge])[0];assert.equal(line.route.blocked,undefined);assert.ok(line.route.points.length>=2);assert.ok(validConnectionShape(line.route.points,'right','left'));assert.ok(line.route.path.startsWith('M'));
});


test('PC保留原卡片，移动端采用统一竖屏卡片，长图默认PC且可手动切换',()=>{
  const nodes=[page('pc',0,0),{...page('mobile',1000,0,375,812),kind:'html',render:{template:'mobile-host'}},{...page('detail',2000,0,375,812),kind:'html',render:{template:'detail'}},{...page('long',3000,0,600,8000),kind:'image'},page('note',4000,0,640,320)],before=clone(nodes);
  for(const n of nodes){const mobile=n.kind==='html',width=mobile?240:400,height=mobile?560:290;assert.equal(canvasNodeType(n),mobile?'mobile':'pc');assert.equal(canvasNodeWidth(n),width);assert.equal(canvasNodeHeight(n),height);const preview=thumbnailLayout(n.width,n.height,width-2,height-43);assert(preview.width<=width-2+.0001&&preview.height<=height-43+.0001);assert(preview.left>=-.0001&&preview.top>=-.0001);assert(Math.abs(preview.width/preview.height-n.width/n.height)<.0001);}
  const line=routeConnections(nodes,[{id:'pc-mobile',from:'pc',to:'mobile',fromSide:'right',toSide:'left'}])[0];clearNodes([line],nodes);assert.deepEqual(line.start,[400,145]);assert.deepEqual(line.end,[1000,280]);assert.deepEqual(nodes,before);
  const image={...nodes[3],canvasType:'mobile'};assert.equal(canvasNodeWidth(image),240);assert.equal(canvasNodeHeight(image),560);assert.equal(image.width,600);assert.equal(image.height,8000);assert.equal(image.x,3000);
  const explicitPC={...nodes[1],canvasType:'pc'};assert.equal(canvasNodeWidth(explicitPC),400);assert.equal(canvasNodeHeight(explicitPC),290);
});

test('拖动一条直线能形成整洁折线，首尾沿指定方向进入且不会产生折返尾巴',()=>{
  const nodes=[page('a',0,0),page('b',1000,0)],edge={id:'ab',from:'a',to:'b',fromSide:'right',toSide:'left'},line=routeConnections(nodes,[edge],{scope:'end-drag'})[0];
  for(const delta of [-100,100]){const waypoints=adjustConnectionSegment(nodes,edge,line.route.points,0,delta);assert.ok(waypoints);const result=routeConnections(nodes,[{...edge,waypoints}],{scope:'clean-end-'+delta})[0];assert.equal(result.route.repaired,undefined);assert(validConnectionShape(result.route.points,'right','left'));clearNodes([result],nodes);assert(result.route.points.length<=6);}
});

test('已保存的折返尾巴只修复当前线，拒绝回头、交叉自身和错误朝向',()=>{
  assert.equal(validConnectionShape([[0,0],[30,0],[-10,0],[-10,100],[100,100],[100,0]],'right','bottom'),false);
  assert.equal(validConnectionShape([[0,0],[100,0],[100,100],[50,100],[50,-10]],'right','top'),false);
  const nodes=[page('a',0,0),page('b',1000,0)],edge={id:'ab',from:'a',to:'b',fromSide:'right',toSide:'left',waypoints:[[440,145],[420,145],[420,500],[1100,500],[1100,145],[970,145]]},before=clone(edge);
  const result=routeConnections(nodes,[edge])[0];assert.equal(result.route.repaired,true);assert(validConnectionShape(result.route.points,'right','left'));clearNodes([result],nodes);assert.deepEqual(edge,before);
});

test('触控板灵敏度可提高和降低，缩放以光标为中心且受上下限约束',()=>{
  const slow=wheelZoomFactor(-10,.5),normal=wheelZoomFactor(-10,2),fast=wheelZoomFactor(-10,4);assert(slow>1&&normal>slow&&fast>normal);assert.equal(wheelZoomFactor(0,2),1);assert(wheelZoomFactor(10,2)<1);assert(Math.abs(wheelZoomFactor(-1,2,1)-wheelZoomFactor(-16,2))<1e-9);
  const camera={x:-80,y:120,scale:.8},anchor=[230,360],before=anchor.map((v,i)=>(v-(i?camera.y:camera.x))/camera.scale),next=zoomCamera(camera,1.5,anchor);assert.deepEqual(anchor.map((v,i)=>(v-(i?next.y:next.x))/next.scale),before);assert.equal(zoomCamera(camera,100,anchor).scale,2.5);assert.equal(zoomCamera(camera,.001,anchor).scale,.08);
});

test('直线与三次贝塞尔曲线路由、曲线加拐点、自由锚点比例定位与模型校验',()=>{
  const pc=page('a',0,0),mobile={...page('b',800,200,375,812),kind:'html',path:'screens/b.html',render:{template:'mobile-host'}};
  const model={version:1,title:'飞书线形',modules:[{id:'flow',title:'流程'}],nodes:[pc,mobile],edges:[
    {id:'s',from:'a',to:'b',fromSide:'right',toSide:'left',lineType:'straight',fromAnchor:[1,.25],toAnchor:[0,.75],label:'直连'},
    {id:'c',from:'a',to:'b',fromSide:'right',toSide:'left',lineType:'curve',condition:'曲线跳转'}
  ],annotations:[]};
  assert.deepEqual(validate(model),[]);
  const routes=routeConnections(model.nodes,model.edges,{scope:'feishu-types'});
  assert.deepEqual(routes[0].start,[400,290*.25]);assert.deepEqual(routes[0].end,[800,200+560*.75]);
  assert.equal(connectionDisplayPath(routes[0].route.points,8,model.nodes,'straight'),`M400,${290*.25} L800,${200+560*.75}`);
  assert.match(connectionDisplayPath(routes[1].route.points,8,model.nodes,'curve'),/^M[\d.,-]+ C[\d.,-]+ [\d.,-]+ [\d.,-]+$/);
  const inserted=adjustConnectionCurvePoint([],0,[600,120],true);assert.deepEqual(inserted,[[600,120]]);
  model.edges[1].waypoints=inserted;
  const curved=routeConnections(model.nodes,[model.edges[1]],{scope:'feishu-curve'})[0];
  assert.equal(curved.route.points.length,7);assert.equal(curved.route.anchors.length,3);assert.equal(curved.route.spanMidpoints.length,2);
  assert.ok(curved.route.samplePoints.length>20);
  const labels=placeConnectionLabels([curved],model.nodes);assert.ok(labels.get('c').rows.length>=1);
  const bad=clone(model);bad.edges[0].lineType='zigzag';bad.edges[0].fromAnchor=[1.5,0];bad.edges[1].labelT=1.5;
  const errs=validate(bad).join(',');assert.match(errs,/连线样式不正确/);assert.match(errs,/连线锚点位置不正确/);assert.match(errs,/连线文字沿线位置不正确/);
});

test('连线文字居中贴合在线上，沿线投影平滑滑动且自动回收旧脱离位置',()=>{
  const nodes=[page('a',0,0),page('b',1000,0)];
  const edge={id:'ab',from:'a',to:'b',fromSide:'right',toSide:'left',condition:'线上文字'};
  const lines=routeConnections(nodes,[edge],{scope:'feishu-label'});
  const centered=placeConnectionLabels(lines,nodes).get('ab');
  assert.equal(centered.leader,null);assert.equal(centered.t,.5);
  assert.ok(Math.abs((centered.box.x+centered.box.width/2)-700)<1e-6);
  assert.ok(Math.abs((centered.box.y+centered.box.height/2)-145)<1e-6);
  const samples=connectionPathSamples(lines[0].route.points,8,nodes,'polyline');
  const proj=connectionPathProject(samples,[550,240]);
  assert.ok(Math.abs(proj.point[1]-145)<1e-6);assert.ok(Math.abs(proj.t-.25)<1e-6);
  assert.deepEqual(connectionPathPointAt(samples,.25).point,[550,145]);
  edge.labelPosition=[550,260];
  const migrated=placeConnectionLabels(lines,nodes).get('ab');
  assert.equal(migrated.leader,null);assert.equal(migrated.manual,true);
  assert.ok(Math.abs((migrated.box.y+migrated.box.height/2)-145)<1e-6);
  const contourInside=connectionTarget(nodes,[1004,220],{exclude:['a']});
  assert.equal(contourInside.snapped,'contour');assert.deepEqual(contourInside.point,[1000,220]);
});

test('跨线自动生成平滑半圆跳弧并合并邻近交叉，线型/箭头校验与反转方向完整工作',()=>{
  const crossLines=[
    {edge:{id:'v1',lineType:'straight'},route:{lineType:'straight',points:[[200,0],[200,200]]}},
    {edge:{id:'v2',lineType:'straight'},route:{lineType:'straight',points:[[210,0],[210,200]]}},
    {edge:{id:'h',lineType:'polyline'},route:{lineType:'polyline',points:[[0,100],[400,100]]}}
  ];
  const cross=connectionCrossArcs(crossLines,[]);
  assert.ok(cross.has('h'));
  const path=connectionDisplayPath(crossLines[2].route.points,8,[],'polyline',cross.get('h'));
  assert.match(path,/A6,6 0 0,[01] 200,94 L210,94 A6,6 0 0,[01] 216,100/);
  const nearEnd=connectionCrossArcs([
    {edge:{id:'v',lineType:'straight'},route:{lineType:'straight',points:[[8,0],[8,200]]}},
    {edge:{id:'h',lineType:'straight'},route:{lineType:'straight',points:[[0,100],[400,100]]}}
  ],[]);
  assert.equal(nearEnd.has('h'),false);
  const m={version:1,title:'t',modules:[{id:'flow',title:'flow'}],nodes:[page('a',0,0),page('b',800,0),{id:'br',module:'flow',kind:'note',presentation:'branch',title:'',width:16,height:16,x:400,y:200,description:''}],edges:[{id:'ab',from:'a',to:'b',fromSide:'right',toSide:'left',fromAnchor:[1,.25],toAnchor:[0,.75],waypoints:[[500,50],[600,150]],label:'跳转',selector:'#go',labelT:.25,lineStyle:'dashed',arrow:'both'},{id:'bbr',from:'a',to:'br',fromSide:'bottom',toSide:'left',label:''}],annotations:[]};
  assert.deepEqual(validate(m),[]);
  const flipped=reverseConnection(m,'ab');
  assert.deepEqual(flipped,{reversed:1,cleared:true});
  assert.equal(m.edges[0].from,'b');assert.equal(m.edges[0].to,'a');
  assert.equal(m.edges[0].fromSide,'left');assert.equal(m.edges[0].toSide,'right');
  assert.deepEqual(m.edges[0].fromAnchor,[0,.75]);assert.deepEqual(m.edges[0].toAnchor,[1,.25]);
  assert.deepEqual(m.edges[0].waypoints,[[600,150],[500,50]]);
  assert.equal(m.edges[0].labelT,.75);assert.equal(m.edges[0].selector,undefined);
  assert.equal(reverseConnection(m,'bbr'),null);
  m.edges[0].lineStyle='dotted';m.edges[0].arrow='double';
  const bad=validate(m).join(',');assert.match(bad,/连线线型不正确/);assert.match(bad,/连线箭头不正确/);
});
