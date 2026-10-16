import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {clone,routeConnections,canvasNodeHeight,History,validate,connectionPoint,adjustConnectionSegment,createLineBranch,lineBranchSplit,overviewEdges,placeConnectionLabels,reconnectEdge,canvasNodeWidth,thumbnailLayout,wheelZoomFactor,zoomCamera,canvasNodeType} from './core.mjs';
import {clearRoutingSessions,validConnectionShape} from './routing.mjs';
import {createHandler,standalone} from './server.mjs';

const page=(id,x,y,width=1280,height=800)=>({id,module:'flow',title:id,kind:'note',x,y,width,height,description:'原说明'});
function clearNodes(lines,nodes){for(const l of lines)for(let i=1;i<l.route.points.length;i++){const a=l.route.points[i-1],b=l.route.points[i];assert.ok(a[0]===b[0]||a[1]===b[1],'每段必须水平或垂直');for(const n of nodes){const hit=a[0]===b[0]?a[0]>n.x&&a[0]<n.x+canvasNodeWidth(n)&&Math.max(a[1],b[1])>n.y&&Math.min(a[1],b[1])<n.y+canvasNodeHeight(n):a[1]>n.y&&a[1]<n.y+canvasNodeHeight(n)&&Math.max(a[0],b[0])>n.x&&Math.min(a[0],b[0])<n.x+canvasNodeWidth(n);assert.ok(!hit,`路径穿过 ${n.id}`);}}}
test('混合尺寸页面独立避障，保留指定端口、原始位置和业务关系',()=>{
  clearRoutingSessions();
  const nodes=[page('admin',920,500),page('purchase',1440,500,1436,974),page('blocked',1960,800,640,320),page('auth',1960,60,1258,1148),page('rates',1440,1120,3072,2048)];
  const edges=[['a','admin','blocked'],['b','purchase','blocked'],['c','purchase','auth'],['d','purchase','rates']].map(([id,from,to])=>({id,from,to})),original=clone({nodes,edges});
  const lines=routeConnections(nodes,edges,{scope:'mixed'});
  assert.ok(lines.every(l=>l.route.engine==='libavoid'));clearNodes(lines,nodes);for(const l of lines){assert.deepEqual(l.start,connectionPoint(l.from,l.fromSide));assert.deepEqual(l.end,connectionPoint(l.to,l.toSide));}assert.deepEqual({nodes,edges},original);
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
  const lines=routeConnections(nodes,edges,{scope:'mixed-directions'});assert.ok(lines.every(l=>l.route.engine==='libavoid'));clearNodes(lines,nodes);for(const l of lines){assert.deepEqual(l.start,connectionPoint(l.from,l.fromSide));assert.deepEqual(l.end,connectionPoint(l.to,l.toSide));}
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
  const scripts=[...html.split('<script type="module">')[0].matchAll(/<script(?![^>]*type="text\/plain")[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
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


test('拖线段只保存有效的手动路径，穿过节点的拖动被拒绝',()=>{
  const nodes=[page('a',0,0),page('b',1000,0),page('block',500,400)],edge={id:'ab',from:'a',to:'b',fromSide:'right',toSide:'left'},original=clone({nodes,edge});
  const line=routeConnections(nodes,[edge],{scope:'drag-test'})[0],points=[[400,165],[460,165],[460,330],[940,330],[940,165],[1000,165]];
  const valid=adjustConnectionSegment(nodes,edge,points,2,-30);assert.ok(valid);const manual=routeConnections(nodes,[{...edge,waypoints:valid}])[0];assert.equal(manual.route.manual,true);assert.equal(manual.route.repaired,undefined);clearNodes([manual],nodes);
  assert.equal(adjustConnectionSegment(nodes,edge,points,2,200),null);assert.deepEqual({nodes,edge},original);
});

test('节点移动挡住手动折线时只修复该线，不改写保存折点或其他线',()=>{
  clearRoutingSessions();const nodes=[page('a',0,0),page('b',1100,0),page('c',0,1000),page('d',1100,1000),page('block',600,600)],edges=[{id:'ab',from:'a',to:'b',fromSide:'right',toSide:'left',waypoints:[[500,165],[500,360],[1000,360],[1000,165]]},{id:'cd',from:'c',to:'d',fromSide:'right',toSide:'left'}],original=clone(edges);
  const first=routeConnections(nodes,edges,{scope:'manual-block'}),stable=clone(first[1]);assert.equal(first[0].route.repaired,undefined);
  nodes.at(-1).y=300;const moved=routeConnections(nodes,edges,{scope:'manual-block'});assert.equal(moved[0].route.repaired,true);assert.equal(moved[0].route.blocked,undefined);clearNodes(moved,nodes);assert.deepEqual(moved[1],stable);assert.deepEqual(edges,original);
});

test('新增线上分支保留原线几何、其他连线和原标签位置',()=>{
  const model={version:1,title:'分支',modules:[{id:'flow',title:'流程'}],nodes:[page('a',0,0),page('b',1100,0),page('c',0,1000),page('d',1100,1000)],edges:[{id:'ab',from:'a',to:'b',fromSide:'right',toSide:'left',condition:'原条件'},{id:'cd',from:'c',to:'d',fromSide:'right',toSide:'left',condition:'其他条件'}],annotations:[]};
  const before=clone(model),lines=routeConnections(model.nodes,model.edges,{scope:'fork-stable'}),source=lines[0],other=clone(lines[1]),labels=placeConnectionLabels(lines,model.nodes),box=labels.get('ab').box,split=lineBranchSplit(source.route.points);
  const fork=createLineBranch(model,'ab','d',split.point,'top',{points:source.route.points,from:'a',fromSide:'right',toSide:'left',labelPosition:[box.x,box.y]});assert.ok(fork);
  const after=routeConnections(model.nodes,overviewEdges(model),{scope:'fork-stable'});assert.deepEqual(after.find(l=>l.edge.id==='cd'),other);assert.deepEqual(model.nodes.slice(0,before.nodes.length),before.nodes);assert.deepEqual(model.edges.find(e=>e.id==='ab').labelPosition,[box.x,box.y]);assert.deepEqual(placeConnectionLabels(after,model.nodes).get('cd'),labels.get('cd'));clearNodes(after,model.nodes.filter(n=>n.presentation!=='branch'));assert.deepEqual(validate(model),[]);
});

test('改接端点只清除当前线的旧折点，其他线和说明保留',()=>{
  const model={nodes:[page('a',0,0),page('b',1000,0),page('c',1000,700)],edges:[{id:'ab',from:'a',to:'b',fromSide:'right',toSide:'left',waypoints:[[500,165]],labelPosition:[500,140]},{id:'ac',from:'a',to:'c',waypoints:[[600,500]]}]},other=clone(model.edges[1]);
  assert.equal(reconnectEdge(model,'ab','to','c','left'),true);assert.equal(model.edges[0].waypoints,undefined);assert.deepEqual(model.edges[0].labelPosition,[500,140]);assert.deepEqual(model.edges[1],other);
});

test('端点被重叠节点包围而无通道时不返回穿过节点的假路线',()=>{
  const nodes=[page('a',0,0),page('b',1000,0),page('cover',0,0)],edge={id:'ab',from:'a',to:'b',fromSide:'right',toSide:'left'};nodes[2].x=350;
  const line=routeConnections(nodes,[edge])[0];assert.equal(line.route.blocked,true);assert.equal(line.route.path,'');assert.deepEqual(line.route.points,[]);
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
