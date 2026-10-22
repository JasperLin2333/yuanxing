// 编辑端、离线分享端与校验共用的数据操作。
import {solveConnections,canvasCardSize,nodeCardSize,nodeCardType,connectionJetty} from './routing.mjs';
import {validateDocument,pruneDocument,documentAssetPaths} from './document.mjs';
export const clone = value => JSON.parse(JSON.stringify(value));
export const uid = prefix => `${prefix}-${globalThis.crypto.randomUUID()}`;
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isFlowContext = value => value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.entries(value).every(([key,item])=>/^[A-Za-z][\w-]*$/.test(key)&&(['string','boolean'].includes(typeof item)||typeof item==='number'&&Number.isFinite(item)));
export const eligibleEdges = (edges,context={}) => edges.filter(edge=>!edge.diagram&&Object.entries(edge.when||{}).every(([key,value])=>context[key]===value));
export const nextContext = (context,edge) => ({...context,...edge.setContext});
export const connectionSides = ['top','right','bottom','left'];
export const isBranch = node => node?.kind==='note'&&node.presentation==='branch';
export const canvasNodeType = node => nodeCardType(node);
export const canvasNodeWidth = node => isBranch(node)?16:nodeCardSize(node).width;
export const canvasNodeHeight = node => isBranch(node)?16:nodeCardSize(node).height;
export function imagePasteTarget(model,current,selection){
  const id=current||(selection?.type==='node'?selection.id:null),target=model.nodes.find(n=>n.id===id);
  return target?.kind==='image'?target:null;
}
export function replaceCanvasImage(model,id,image,expectedPath){
  const target=model.nodes.find(n=>n.id===id);
  if(target?.kind!=='image'||expectedPath!==undefined&&target.path!==expectedPath||!isImagePath(image?.path)||![image.width,image.height].every(v=>Number.isFinite(v)&&v>0&&v<=20000))return false;
  for(const item of [...model.annotations,...model.edges])if((item.node||item.from)===id&&!item.selector&&(item.point||item.rect))item.imagePath??=target.path;
  Object.assign(target,{path:image.path,width:image.width,height:image.height});return true;
}
export function connectionPoint(node,side,offset=0) {
  const width=canvasNodeWidth(node),height=canvasNodeHeight(node);
  if(isBranch(node))return [node.x+width/2,node.y+height/2];
  const horizontal=side==='top'||side==='bottom',size=horizontal?width:height,shift=Math.max(-size/2+20,Math.min(size/2-20,offset));
  return {top:[node.x+width/2+shift,node.y],right:[node.x+width,node.y+height/2+shift],bottom:[node.x+width/2+shift,node.y+height],left:[node.x,node.y+height/2+shift]}[side];
}
export function connectionDirections(edge,from,to){
  const dx=to.x+canvasNodeWidth(to)/2-from.x-canvasNodeWidth(from)/2,dy=to.y+canvasNodeHeight(to)/2-from.y-canvasNodeHeight(from)/2;
  const xGap=Math.max(to.x-from.x-canvasNodeWidth(from),from.x-to.x-canvasNodeWidth(to)),yGap=Math.max(to.y-from.y-canvasNodeHeight(from),from.y-to.y-canvasNodeHeight(to));
  const horizontal=xGap>=0&&(yGap<0||Math.abs(dx)/(canvasNodeWidth(from)+canvasNodeWidth(to))>=Math.abs(dy)/(canvasNodeHeight(from)+canvasNodeHeight(to)));
  const side=horizontal?(dx<0?'left':'right'):(dy<0?'top':'bottom'),opposite={top:'bottom',bottom:'top',left:'right',right:'left'};
  return [edge.fromSide||side,edge.toSide||opposite[side]];
}
export function connectionTarget(nodes,point,{exclude=[],tolerance=24,side=null}={}){
  const excluded=new Set(exclude);let best=null;
  for(const n of nodes){
    if(excluded.has(n.id))continue;
    const inside=point[0]>=n.x&&point[0]<=n.x+canvasNodeWidth(n)&&point[1]>=n.y&&point[1]<=n.y+canvasNodeHeight(n);
    for(const candidate of side?[side]:connectionSides){
      const anchor=connectionPoint(n,candidate),distance=Math.hypot(anchor[0]-point[0],anchor[1]-point[1]);if(!inside&&distance>tolerance)continue;
      const score=distance-(inside?1e6:0);if(!best||score<best.score)best={node:n,side:candidate,point:anchor,distance,score};
    }
  }
  return best;
}
// 预览与提交使用同一组节点、端口及避障计算；游离端点只在预览期间存在。
export function previewConnection(nodes,fixed,fixedSide,target,targetSide,{endpoint='to',branch=false}={}){
  if(!fixed||!target||fixed.id===target.id)return null;
  const movingFrom=endpoint==='from',from=movingFrom?target:fixed,to=movingFrom?fixed:target;
  const edge={id:'connection-preview',from:from.id,to:to.id,fromSide:movingFrom?targetSide:branch?connectionDirections({},fixed,target)[0]:fixedSide,toSide:movingFrom?fixedSide:targetSide};
  const byId=new Map(nodes.map(n=>[n.id,n]));byId.set(fixed.id,fixed);byId.set(target.id,target);
  return routeConnections([...byId.values()],[edge],{scope:'connection-preview'})[0]||null;
}
export function connectionDisplayPath(points,radius=8,nodes=[]){
  if(!points?.length)return '';
  let path='M'+points[0].join(',');
  for(let i=1;i<points.length-1;i++){
    const a=points[i-1],b=points[i],c=points[i+1],before=Math.hypot(b[0]-a[0],b[1]-a[1]),after=Math.hypot(c[0]-b[0],c[1]-b[1]);
    let r=Math.max(0,Math.min(radius,before/2,after/2));
    if(!before||!after||a[0]===b[0]&&b[0]===c[0]||a[1]===b[1]&&b[1]===c[1])r=0;
    if(!r){path+=' L'+b.join(',');continue;}
    const start=b.map((v,axis)=>v+(a[axis]-v)/before*r),end=b.map((v,axis)=>v+(c[axis]-v)/after*r),box={x:Math.min(start[0],end[0]),y:Math.min(start[1],end[1]),right:Math.max(start[0],end[0]),bottom:Math.max(start[1],end[1])};
    const blocked=nodes.some(n=>!isBranch(n)&&box.x<n.x+canvasNodeWidth(n)&&box.right>n.x&&box.y<n.y+canvasNodeHeight(n)&&box.bottom>n.y);
    path+=blocked?' L'+b.join(','):' L'+start.join(',')+' Q'+b.join(',')+' '+end.join(',');
  }
  return points.length>1?path+' L'+points.at(-1).join(','):path;
}
// 建线只改变关系；用户摆好的页面和已选端点不参与自动排布。
export function connectNodes(model,from,to,fromSide,toSide){
  if(from===to||![from,to].every(id=>model.nodes.some(n=>n.id===id))||![fromSide,toSide].every(side=>connectionSides.includes(side)))return null;
  const diagram=[from,to].some(id=>isBranch(model.nodes.find(n=>n.id===id))),id=uid('edge');
  model.edges.push({id,from,to,fromSide,toSide,label:diagram?'':'继续',trigger:'next',description:'',...(diagram?{diagram:true}:{})});return id;
}
export function snapNodePosition(node,point,others,tolerance=8){
  const result={x:point[0],y:point[1],guides:[]},matches=[];if(tolerance<=0)return result;
  if(isBranch(node)){
    for(const [axis,index] of [['x',0],['y',1]]){
      let nearest=null;for(const other of others)if(other.id!==node.id)for(const side of connectionSides){const anchor=connectionPoint(other,side),delta=anchor[index]-(result[axis]+8);if(Math.abs(delta)<=tolerance&&(!nearest||Math.abs(delta)<Math.abs(nearest.delta)))nearest={anchor,delta};}
      if(nearest){result[axis]+=nearest.delta;const cross=1-index;result.guides.push({axis,position:result[axis]+8,start:Math.min(point[cross]+8,nearest.anchor[cross])-16,end:Math.max(point[cross]+8,nearest.anchor[cross])+16});}
    }
    return result;
  }
  for(const [axis,size] of [['x',canvasNodeWidth],['y',canvasNodeHeight]]){
    const cross=axis==='x'?'y':'x';let nearest=null;
    for(const other of others)if(other.id!==node.id&&!isBranch(other))for(const fraction of [0,.5,1]){
      const line=other[axis]+size(other)*fraction,delta=line-(result[axis]+size(node)*fraction),distance=Math.abs(other[cross]-result[cross]);
      if(Math.abs(delta)<=tolerance&&(!nearest||Math.abs(delta)<Math.abs(nearest.delta)||Math.abs(delta)===Math.abs(nearest.delta)&&distance<nearest.distance))nearest={delta,line,other,distance};
    }
    if(nearest){result[axis]+=nearest.delta;matches.push({axis,...nearest});}
  }
  for(const {axis,line,other} of matches){const cross=axis==='x'?'y':'x',size=axis==='x'?canvasNodeHeight:canvasNodeWidth;result.guides.push({axis,position:line,start:Math.min(result[cross],other[cross])-20,end:Math.max(result[cross]+size(node),other[cross]+size(other))+20});}
  return result;
}
export function nodesInRect(nodes,start,end){
  const left=Math.min(start[0],end[0]),top=Math.min(start[1],end[1]),right=Math.max(start[0],end[0]),bottom=Math.max(start[1],end[1]);
  if(left===right||top===bottom)return [];
  return nodes.filter(n=>n.x<right&&n.x+canvasNodeWidth(n)>left&&n.y<bottom&&n.y+canvasNodeHeight(n)>top).map(n=>n.id);
}
export function canvasSelection(ids,id,additive=false){
  if(!additive)return [id];const selected=new Set(ids);if(selected.has(id))selected.delete(id);else selected.add(id);return [...selected];
}
export function snapNodeGroup(nodes,ids,delta,tolerance=8){
  const selected=new Set(ids),members=nodes.filter(n=>selected.has(n.id)),moving=new Set(members.map(n=>n.id)),others=nodes.filter(n=>!moving.has(n.id));
  if(!members.length)return {positions:[],guides:[]};
  const [dx,dy]=delta,best={};
  for(const n of members){const snapped=snapNodePosition(n,[n.x+dx,n.y+dy],others,tolerance);
    for(const guide of snapped.guides){const axis=guide.axis,correction=snapped[axis]-(n[axis]+(axis==='x'?dx:dy));
      if(!best[axis]||Math.abs(correction)<Math.abs(best[axis].correction))best[axis]={correction,guide};
    }
  }
  const moveX=dx+(best.x?.correction||0),moveY=dy+(best.y?.correction||0);
  return {positions:members.map(n=>({id:n.id,x:n.x+moveX,y:n.y+moveY})),guides:Object.values(best).map(item=>item.guide)};
}
export function moveCanvasNodes(model,moduleId,positions){
  const visible=moduleNodes(model,moduleId),byId=new Map(visible.map(n=>[n.id,n])),deltas=new Map();
  // 默认引用位置依赖本模块边界；移动前固定其画布坐标，避免未选引用被带着走。
  for(const n of visible.filter(n=>n.reference)){model.referencePositions??={};model.referencePositions[moduleId]??={};model.referencePositions[moduleId][n.id]??={x:n.x,y:n.y};}
  for(const position of positions){const n=byId.get(position.id);if(!n||![position.x,position.y].every(value=>Number.isFinite(value)))continue;
    const dx=position.x-n.x,dy=position.y-n.y;if(!dx&&!dy)continue;deltas.set(n.id,[dx,dy]);
    if(isBranch(n)&&positions.length===1){
      const center=[position.x+8,position.y+8],blocked=visible.some(other=>other.id!==n.id&&!isBranch(other)&&center[0]>other.x-12&&center[0]<other.x+canvasNodeWidth(other)+12&&center[1]>other.y-12&&center[1]<other.y+canvasNodeHeight(other)+12);
      const next=visible.map(other=>other.id===n.id?{...other,x:position.x,y:position.y}:other),incident=overviewEdges(model).filter(edge=>edge.from===n.id||edge.to===n.id);
      if(blocked||routeConnections(next,incident,{scope:'branch-move-preview'}).some(line=>line.route.blocked)){deltas.delete(n.id);continue;}
    }
    if(n.reference)model.referencePositions[moduleId][n.id]={x:position.x,y:position.y};
    else Object.assign(model.nodes.find(owner=>owner.id===n.id),{x:position.x,y:position.y});
  }
  // 整组平移时，组内手动折点和文字一起平移；单独移动端点时保留手动经过点。
  for(const edge of overviewEdges(model)){const a=deltas.get(edge.from),b=deltas.get(edge.to);if(!a||!b||a[0]!==b[0]||a[1]!==b[1])continue;const owner=model.edges.find(e=>e.id===edge.id);
    if(Array.isArray(owner.waypoints))owner.waypoints=owner.waypoints.map(([x,y])=>[x+a[0],y+a[1]]);
    if(Array.isArray(owner.labelPosition))owner.labelPosition=[owner.labelPosition[0]+a[0],owner.labelPosition[1]+a[1]];
  }
  return [...deltas.keys()];
}
const selectedCanvasNodes=(model,moduleId,ids)=>{const byId=new Map(moduleNodes(model,moduleId).map(n=>[n.id,n]));return [...new Set(ids)].map(id=>byId.get(id)).filter(Boolean);};
export function alignCanvasNodes(model,moduleId,ids,mode){
  const modes={left:['x',canvasNodeWidth,0],'center-x':['x',canvasNodeWidth,.5],right:['x',canvasNodeWidth,1],top:['y',canvasNodeHeight,0],'center-y':['y',canvasNodeHeight,.5],bottom:['y',canvasNodeHeight,1]},setting=modes[mode],nodes=selectedCanvasNodes(model,moduleId,ids);
  if(!setting||nodes.length<2)return [];const [axis,size,fraction]=setting,anchor=nodes[0][axis]+size(nodes[0])*fraction;
  return moveCanvasNodes(model,moduleId,nodes.map(n=>({id:n.id,x:n.x,y:n.y,[axis]:anchor-size(n)*fraction})));
}
export function distributeCanvasNodes(model,moduleId,ids,axis){
  if(!['x','y'].includes(axis))return [];const size=axis==='x'?canvasNodeWidth:canvasNodeHeight,nodes=selectedCanvasNodes(model,moduleId,ids).sort((a,b)=>a[axis]-b[axis]||a.id.localeCompare(b.id));
  if(nodes.length<3)return [];const first=nodes[0],last=nodes.at(-1),gap=(last[axis]+size(last)-first[axis]-nodes.reduce((total,n)=>total+size(n),0))/(nodes.length-1),positions=[];let cursor=first[axis];
  nodes.forEach((n,i)=>{positions.push({id:n.id,x:n.x,y:n.y,[axis]:i===nodes.length-1?last[axis]:cursor});cursor+=size(n)+gap;});
  return moveCanvasNodes(model,moduleId,positions);
}
export function nudgeCanvasNodes(model,moduleId,ids,dx,dy){
  if(![dx,dy].every(Number.isFinite))return [];const nodes=selectedCanvasNodes(model,moduleId,ids);if(!nodes.length)return [];
  return moveCanvasNodes(model,moduleId,nodes.map(n=>({id:n.id,x:n.x+dx,y:n.y+dy})));
}
export function copyCanvasSelection(model,moduleId,ids,{recycle=false}={}){
  const wanted=new Set(ids),visible=(recycle?recycleCanvasNodes(model):moduleNodes(model,moduleId)).filter(n=>wanted.has(n.id));if(!visible.length)return {nodes:[],edges:[],annotations:[],rules:{}};
  const visibleById=new Map(visible.map(n=>[n.id,n])),hidden=recycle?[]:model.nodes.filter(n=>n.overview===false&&visibleById.has(n.overviewAlias)).map(n=>({...n,x:visibleById.get(n.overviewAlias).x,y:visibleById.get(n.overviewAlias).y})),nodes=[...visible,...hidden];
  const selected=new Set(nodes.map(n=>n.id)),origin=[Math.min(...visible.map(n=>n.x)),Math.min(...visible.map(n=>n.y))],shift=point=>[point[0]-origin[0],point[1]-origin[1]];
  // 复制真实状态链，不用概览中的代表页面替换按钮和分支目标。
  const edges=model.edges.filter(e=>!e.navigation&&selected.has(e.from)&&selected.has(e.to)).map(e=>{const edge=clone(e);if(edge.canvasFrom&&!selected.has(edge.canvasFrom))delete edge.canvasFrom;if(recycle){delete edge.waypoints;delete edge.labelPosition;}else{if(edge.waypoints)edge.waypoints=edge.waypoints.map(shift);if(edge.labelPosition)edge.labelPosition=shift(edge.labelPosition);}return edge;});
  const edgeIds=new Set(edges.map(e=>e.id)),annotations=clone(model.annotations.filter(a=>a.edge?edgeIds.has(a.edge):selected.has(a.node))),used=new Set([...nodes,...edges].map(item=>item.rule).filter(Boolean));
  return {nodes:nodes.map(n=>{const copy=clone(n);copy.x-=origin[0];copy.y-=origin[1];delete copy.reference;if(recycle){delete copy.overview;delete copy.overviewAlias;}else if(copy.overviewAlias&&!selected.has(copy.overviewAlias))delete copy.overviewAlias;return copy;}),edges,annotations,rules:Object.fromEntries([...used].filter(id=>typeof model.rules?.[id]==='string').map(id=>[id,model.rules[id]]))};
}
export function canvasClipboardAssets(clipboard,bundle){
  const resources={},fragments={},images={};
  const collect=text=>{for(const match of String(text||'').matchAll(/<!--\s*include:([^>]+?)\s*-->/g)){const key=match[1];if(Object.hasOwn(fragments,key)||bundle.fragments?.[key]===undefined)continue;fragments[key]=bundle.fragments[key];collect(fragments[key]);}};
  for(const n of clipboard.nodes){const resource=n.kind==='image'?bundle.images?.[n.path]||bundle.resources?.[n.id]:bundle.resources?.[n.id];if(resource!==undefined){resources[n.id]=resource;if(n.kind==='html')collect(resource);}}
  for(const path of descriptionImagePaths(clipboard))if(bundle.images?.[path])images[path]=bundle.images[path];
  return {resources,fragments,images};
}
export function canvasPreviewSignature(n,bundle){
  const resource=n.kind==='image'?bundle.images?.[n.path]||bundle.resources?.[n.id]:bundle.resources?.[n.id];
  const content=n.kind==='note'?markdown(n.description,bundle.images||{}):n.kind==='html'?expandHTML(resource||'<p>页面资源不存在</p>',bundle.fragments||{}):resource||'';
  return JSON.stringify([n.kind,n.width,n.height,canvasNodeWidth(n),canvasNodeHeight(n),content]);
}
export function cutCanvasSelection(model,moduleId,ids,{recycle=false}={}){
  const clipboard=copyCanvasSelection(model,moduleId,ids,{recycle});if(!clipboard.nodes.length)return clipboard;
  const removed=clipboard.nodes.map(n=>n.id);moveRecycleNodes(model,[]);
  // 剪切可能改变画布边界或引用顺序，先固定未选引用，保留它们的位置。
  for(const module of model.modules)moveCanvasNodes(model,module.id,[]);
  if(recycle)removeNodes(model,removed);else removeCanvasNodes(model,moduleId,removed);
  return clipboard;
}
export function pasteCanvasSelection(model,moduleId,clipboard,point=[80,80],{recycle=false}={}){
  if(!model.modules.some(m=>m.id===moduleId)||!Array.isArray(clipboard?.nodes)||!clipboard.nodes.length)return [];
  const source=clone(clipboard),coordinates=Array.isArray(point)?point:[point?.x,point?.y],origin=coordinates.every(Number.isFinite)?coordinates:[80,80],nodeIds=new Map(source.nodes.map(n=>[n.id,uid(isBranch(n)?'branch':'node')])),edgeIds=new Map(),rules=new Map();
  model.rules??={};for(const [id,text] of Object.entries(source.rules||{})){if(typeof text!=='string')continue;const next=uid('rule');rules.set(id,next);model.rules[next]=text;}
  const remapRule=item=>{if(item.rule){if(rules.has(item.rule))item.rule=rules.get(item.rule);else delete item.rule;}},shift=([x,y])=>[x+origin[0],y+origin[1]];
  if(recycle)moveRecycleNodes(model,[]);
  const nodes=source.nodes.map(n=>{
    const next={...n,id:nodeIds.get(n.id),module:recycle&&model.modules.some(m=>m.id===n.module)?n.module:moduleId,x:n.x+origin[0],y:n.y+origin[1]};delete next.reference;
    if(next.overviewAlias){if(nodeIds.has(next.overviewAlias))next.overviewAlias=nodeIds.get(next.overviewAlias);else delete next.overviewAlias;}delete next.section;
    if(next.kind==='html'&&next.render&&/^canvas-states\/[\w-]+\.html$/.test(next.path)){next.path=`canvas-states/${next.id}.html`;delete next.copySourcePath;}
    else if(next.kind==='html'&&!next.render){next.copySourcePath=next.path;const slash=next.path.lastIndexOf('/');next.path=(slash<0?'':next.path.slice(0,slash+1))+next.id+'.html';}
    if(recycle){next.overview=false;delete next.overviewAlias;model.recyclePositions??={};model.recyclePositions[next.id]={x:next.x,y:next.y};}
    remapRule(next);return next;
  });
  const edges=(source.edges||[]).filter(e=>nodeIds.has(e.from)&&nodeIds.has(e.to)).map(e=>{const id=uid('edge');edgeIds.set(e.id,id);const next={...e,id,from:nodeIds.get(e.from),to:nodeIds.get(e.to)};if(next.canvasFrom){if(nodeIds.has(next.canvasFrom))next.canvasFrom=nodeIds.get(next.canvasFrom);else delete next.canvasFrom;}if(next.waypoints)next.waypoints=next.waypoints.map(shift);if(next.labelPosition)next.labelPosition=shift(next.labelPosition);remapRule(next);return next;});
  const annotations=(source.annotations||[]).filter(a=>a.edge?edgeIds.has(a.edge):nodeIds.has(a.node)).map(a=>{const next={...a,id:uid('annotation')};if(next.node)next.node=nodeIds.get(next.node);if(next.edge)next.edge=edgeIds.get(next.edge);return next;});
  model.nodes.push(...nodes);model.edges.push(...edges);model.annotations.push(...annotations);
  const module=model.modules.find(m=>m.id===moduleId);module.entry??=nodes.find(n=>n.overview!==false&&!isBranch(n))?.id;return nodes.map(n=>n.id);
}
export function reconnectEdge(model,id,endpoint,nodeId,side,fixedSide) {
  const edge=model.edges.find(e=>e.id===id),destination=model.nodes.find(n=>n.id===nodeId);
  if(!edge||!destination||!['from','to'].includes(endpoint)||!connectionSides.includes(side)||edge[endpoint==='from'?'to':'from']===nodeId)return false;
  if(endpoint==='from'&&isBranch(destination)&&!isBranch(model.nodes.find(n=>n.id===edge.from)))edge.canvasFrom=nodeId;
  else {if(endpoint==='from'){delete edge.canvasFrom;if(edge.from!==nodeId){delete edge.selector;delete edge.rect;delete edge.imagePath;edge.trigger='next';}}edge[endpoint]=nodeId;}
  delete edge.waypoints;
  edge[endpoint+'Side']=side;
  if(connectionSides.includes(fixedSide))edge[endpoint==='from'?'toSide':'fromSide']=fixedSide;
  if(isBranch(model.nodes.find(n=>n.id===edge.from))||isBranch(model.nodes.find(n=>n.id===edge.to)))edge.diagram=true;
  else delete edge.diagram;
  normalizeBranchJunctions(model);
  return true;
}
// 控件位于实际折线的最长线段中间，不采用已偏移的文字位置。
export function lineBranchSplit(points,near=null){
  if(!Array.isArray(points)||points.length<2||!points.every(isCanvasPoint))return null;
  let index=0,longest=0,distance=Infinity,chosen;
  for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1];if(a[0]!==b[0]&&a[1]!==b[1])return null;const length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!length)continue;
    if(near&&isCanvasPoint(near)){const point=a.map((v,axis)=>Math.max(Math.min(v,b[axis]),Math.min(Math.max(v,b[axis]),near[axis]))),d=Math.hypot(point[0]-near[0],point[1]-near[1]);if(d<distance){distance=d;index=i;chosen=point;longest=length;}}
    else if(length>longest){index=i;longest=length;}
  }
  if(!longest)return null;
  const a=points[index],b=points[index+1],point=chosen||[(a[0]+b[0])/2,(a[1]+b[1])/2],side=b[0]===a[0]?(b[1]>a[1]?'bottom':'top'):(b[0]>a[0]?'right':'left');
  return {point,side,before:[...points.slice(0,index+1).map(p=>[...p]),point],after:[point,...points.slice(index+1).map(p=>[...p])]};
}
export function createLineBranch(model,edgeId,targetId,point,targetSide='top',route=null) {
  const edge=model.edges.find(e=>e.id===edgeId),target=model.nodes.find(n=>n.id===targetId);
  if(!edge||!target||!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite)||!connectionSides.includes(targetSide))return null;
  const split=route&&lineBranchSplit(route.points,point);if(route&&(!split||split.point.some((v,i)=>Math.abs(v-point[i])>1e-6)||![route.fromSide,route.toSide].every(side=>connectionSides.includes(side))||route.branchSide&&!connectionSides.includes(route.branchSide)||route.from&&!model.nodes.some(n=>n.id===route.from)||route.module&&!model.modules.some(m=>m.id===route.module)))return null;
  const related=route?.edgeIds?model.edges.filter(e=>route.edgeIds.includes(e.id)):[edge],display=new Map(overviewEdges(model).map(e=>[e.id,e])),shown=display.get(edgeId),key=e=>e&&JSON.stringify([e.from,e.to,e.condition||e.label,e.fromSide,e.toSide]);
  if(!related.includes(edge)||related.some(e=>key(display.get(e.id))!==key(shown)))return null;
  let group=!split&&[edge.to,edge.canvasFrom,edge.from].map(id=>model.nodes.find(n=>n.id===id)).find(isBranch);
  if(group?.id===targetId)return null;
  if(!group){const origin=model.nodes.find(n=>n.id===edge.from),destination=model.nodes.find(n=>n.id===edge.to);if(!origin||!destination)return null;
    group={id:uid('branch'),module:route?.module||origin.module,title:split?'':'分支条件',kind:'note',presentation:'branch',width:16,height:16,x:point[0]-8,y:point[1]-8,description:''};model.nodes.push(group);
    const [heading,arrival]=route?[route.fromSide,route.toSide]:connectionDirections(edge,origin,destination),opposite={top:'bottom',bottom:'top',left:'right',right:'left'},trunk={id:uid('edge'),from:route?.from||edge.canvasFrom||edge.from,to:group.id,fromSide:heading,toSide:opposite[split?.side||heading],label:'',diagram:true,description:''};
    if(split){trunk.waypoints=split.before.slice(1,-1);for(const item of related){item.waypoints=split.after.slice(1,-1).map(p=>[...p]);item.fromSide=split.side;item.toSide=arrival;if(!item.labelPosition&&isCanvasPoint(route.labelPosition))item.labelPosition=[...route.labelPosition];}}
    model.edges.push(trunk);for(const item of related)item.canvasFrom=group.id;
  }
  const id=uid('edge');model.edges.push({id,from:group.id,to:targetId,fromSide:route?.branchSide||connectionDirections({},group,target)[0],toSide:targetSide,label:'',description:'',diagram:true});
  return {edgeId:id,groupId:group.id};
}
export function orderedModuleNodes(model,moduleId){
  const sections=model.modules.find(m=>m.id===moduleId)?.sections||[],rank=new Map(sections.map((s,i)=>[s.id,i]));
  return model.nodes.filter(n=>n.module===moduleId&&n.overview!==false&&!isBranch(n)).sort((a,b)=>(rank.get(a.section)??sections.length)-(rank.get(b.section)??sections.length)||a.y-b.y||a.x-b.x);
}
export function canvasSections(model,moduleId){
  const nodes=orderedModuleNodes(model,moduleId),sections=model.modules.find(m=>m.id===moduleId)?.sections||[];
  if(!nodes.length)return [];
  const left=Math.min(...nodes.map(n=>n.x))-24,right=Math.max(...nodes.map(n=>n.x+canvasNodeWidth(n)))+24;
  return sections.map(section=>{const members=nodes.filter(n=>n.section===section.id);if(!members.length)return null;const top=Math.min(...members.map(n=>n.y))-58,bottom=Math.max(...members.map(n=>n.y+canvasNodeHeight(n)))+24;return {...section,x:left,y:top,width:right-left,height:bottom-top};}).filter(Boolean);
}
const segmentHits=(u,v,r)=>u[0]===v[0]?u[0]>r.x&&u[0]<r.x+r.width&&Math.max(u[1],v[1])>r.y&&Math.min(u[1],v[1])<r.y+r.height:u[1]>r.y&&u[1]<r.y+r.height&&Math.max(u[0],v[0])>r.x&&Math.min(u[0],v[0])<r.x+r.width;
// 简单折线无路可走时，在障碍边缘的正交网格上找路。
function obstacleRoute(start,end,obstacles,fromVector,toVector){
  const xs=[...new Set([start[0],end[0],...obstacles.flatMap(r=>[r.x-16,r.x+r.width+16])])].sort((a,b)=>a-b),ys=[...new Set([start[1],end[1],...obstacles.flatMap(r=>[r.y-16,r.y+r.height+16])])].sort((a,b)=>a-b);
  const width=xs.length,source=ys.indexOf(start[1])*width+xs.indexOf(start[0]),target=ys.indexOf(end[1])*width+xs.indexOf(end[0]),point=id=>[xs[id%width],ys[Math.floor(id/width)]],heap=[],distances=new Map(),parents=new Map();
  const push=item=>{let i=heap.length;heap.push(item);while(i){const p=(i-1)>>1;if(heap[p].score<=item.score)break;heap[i]=heap[p];i=p;}heap[i]=item;};
  const pop=()=>{const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].score<heap[c].score)c++;if(heap[c].score>=last.score)break;heap[i]=heap[c];i=c;}heap[i]=last;}return first;};
  const axis=fromVector[0]?0:1,key=source*2+axis;distances.set(key,0);push({id:source,axis,key,cost:0,score:0});
  while(heap.length){const state=pop();if(state.cost!==distances.get(state.key))continue;const u=point(state.id);
    if(state.id===target){const points=[];let k=state.key;while(k!==undefined){points.push(point(Math.floor(k/2)));k=parents.get(k);}return points.reverse();}
    const x=state.id%width,y=Math.floor(state.id/width);
    for(const [nx,ny,nextAxis] of [[x-1,y,0],[x+1,y,0],[x,y-1,1],[x,y+1,1]]){
      if(nx<0||nx>=width||ny<0||ny>=ys.length)continue;const id=ny*width+nx,v=point(id);
      if(state.id===source&&(v[0]-u[0])*fromVector[0]+(v[1]-u[1])*fromVector[1]<0||id===target&&(u[0]-v[0])*toVector[0]+(u[1]-v[1])*toVector[1]<0||obstacles.some(r=>segmentHits(u,v,r)))continue;
      const cost=state.cost+Math.abs(v[0]-u[0])+Math.abs(v[1]-u[1])+(nextAxis===state.axis?0:24),key=id*2+nextAxis;
      if(cost>=(distances.get(key)??Infinity))continue;distances.set(key,cost);parents.set(key,state.key);push({id,axis:nextAxis,key,cost,score:cost+Math.abs(v[0]-end[0])+Math.abs(v[1]-end[1])});
    }
  }
  return null;
}
export function connectionRoute(start,end,fromSide,toSide,obstacles=[],flexible=false) {
  const vectors={top:[0,-1],right:[1,0],bottom:[0,1],left:[-1,0]},a=vectors[fromSide],b=vectors[toSide],sourceLength=connectionJetty(start,end,fromSide,flexible),targetLength=connectionJetty(end,start,toSide,flexible);
  const s=[start[0]+a[0]*sourceLength,start[1]+a[1]*sourceLength],t=[end[0]+b[0]*targetLength,end[1]+b[1]*targetLength];
  const candidates=[[start,s,t,end],[start,s,[t[0],s[1]],t,end],[start,s,[s[0],t[1]],t,end]];
  if(start[0]===end[0]||start[1]===end[1])candidates.push([start,end]);
  const midX=(s[0]+t[0])/2,midY=(s[1]+t[1])/2;
  const xs=[midX,midX-24,midX+24,...obstacles.flatMap(r=>[r.x-16,r.x+r.width+16])],ys=[midY,midY-24,midY+24,...obstacles.flatMap(r=>[r.y-16,r.y+r.height+16])];
  for(const x of xs)candidates.push([start,s,[x,s[1]],[x,t[1]],t,end]);
  for(const y of ys)candidates.push([start,s,[s[0],y],[t[0],y],t,end]);
  const compact=points=>{const out=[];for(const p of points){const last=out.at(-1);if(last&&last[0]===p[0]&&last[1]===p[1])continue;out.push(p);while(out.length>2){const [u,v,w]=out.slice(-3);if((u[0]===v[0]&&v[0]===w[0]||u[1]===v[1]&&v[1]===w[1])&&(v[0]-u[0])*(w[0]-v[0])+(v[1]-u[1])*(w[1]-v[1])>=0)out.splice(-2,1);else break;}}return out;};
  let best=null,bestScore=Infinity;
  for(const candidate of candidates){const points=compact(candidate);if(points.length<2)continue;const first=points[1],last=points.at(-2);if((first[0]-start[0])*a[0]+(first[1]-start[1])*a[1]<=0||(last[0]-end[0])*b[0]+(last[1]-end[1])*b[1]<=0)continue;
    let length=0,crossings=0,valid=true;
    for(let i=1;i<points.length;i++){const u=points[i-1],v=points[i];if(u[0]!==v[0]&&u[1]!==v[1]){valid=false;break;}length+=Math.abs(v[0]-u[0])+Math.abs(v[1]-u[1]);for(const r of obstacles)if(segmentHits(u,v,r))crossings++;}
    const score=crossings*1e6+length+(points.length-2)*24;if(valid&&score<bestScore){best=points;bestScore=score;}
  }
  if(!best||best.some((v,i)=>i&&obstacles.some(r=>segmentHits(best[i-1],v,r)))){const detour=obstacleRoute(s,t,obstacles,a,b);if(detour)best=compact([start,...detour,end]);}
  const points=best||compact([start,s,[t[0],s[1]],t,end]);
  if(points.slice(1).some((p,i)=>obstacles.some(r=>segmentHits(points[i],p,r))))return {points:[],path:'',label:start,blocked:true};
  let segment=[points[0],points[1]],longest=0;for(let i=1;i<points.length;i++){const u=points[i-1],v=points[i],length=Math.abs(u[0]-v[0])+Math.abs(u[1]-v[1]);if(length>longest){segment=[u,v];longest=length;}}
  return {points,path:points.map((p,i)=>(i?'L':'M')+p.join(',')).join(' '),label:[(segment[0][0]+segment[1][0])/2+8,(segment[0][1]+segment[1][1])/2-8]};
}
export const connectionPath = (...args) => connectionRoute(...args).path;
const isCanvasPoint=point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite);
function manualConnectionRoute(start,end,fromSide,toSide,waypoints,fromBranch=false,toBranch=false){
  const vectors={top:[0,-1],right:[1,0],bottom:[0,1],left:[-1,0]},a=vectors[fromSide],b=vectors[toSide];
  const stub=(p,v,near)=>{const delta=[near[0]-p[0],near[1]-p[1]],distance=delta[0]*v[0]+delta[1]*v[1];return distance>=0&&distance<32&&delta[0]*v[1]===delta[1]*v[0]?[...near]:[p[0]+v[0]*32,p[1]+v[1]*32];};
  const s=fromBranch?start:stub(start,a,waypoints[0]||end),t=toBranch?end:stub(end,b,waypoints.at(-1)||start),points=fromBranch?[start]:[start,s];
  const append=(target,axis)=>{const previous=points.at(-1);if(previous[0]!==target[0]&&previous[1]!==target[1])points.push(axis==='x'?[target[0],previous[1]]:[previous[0],target[1]]);if(points.at(-1)[0]!==target[0]||points.at(-1)[1]!==target[1])points.push([...target]);};
  for(const point of waypoints.filter(isCanvasPoint)){const before=points.at(-2),last=points.at(-1);append(point,before?(last[1]===before[1]?'x':'y'):(a[0]?'x':'y'));}
  // 末段从用户选定的目标侧进入，端口与页面位置每次重新计算。
  append(t,b[0]?'y':'x');append(end,b[0]?'x':'y');
  let segment=[start,s],longest=0;for(let i=1;i<points.length;i++){const u=points[i-1],v=points[i],length=Math.abs(v[0]-u[0])+Math.abs(v[1]-u[1]);if(length>longest){segment=[u,v];longest=length;}}
  return {points,path:points.map((p,i)=>(i?'L':'M')+p.join(',')).join(' '),label:[(segment[0][0]+segment[1][0])/2+8,(segment[0][1]+segment[1][1])/2-8],manual:true};
}
export function routeConnections(nodes,edges,options={}){
  const byId=new Map(nodes.map(n=>[n.id,n])),obstacles=nodes.filter(n=>!isBranch(n)).map(n=>({x:n.x,y:n.y,width:canvasNodeWidth(n),height:canvasNodeHeight(n)}));
  const lines=edges.filter(e=>byId.has(e.from)&&byId.has(e.to)&&!(byId.get(e.from).reference&&byId.get(e.to).reference)).map(edge=>{const from=byId.get(edge.from),to=byId.get(edge.to),[fromSide,toSide]=connectionDirections(edge,from,to);return {edge,from,to,fromSide,toSide,start:connectionPoint(from,fromSide),end:connectionPoint(to,toSide)};});
  return solveConnections(nodes,lines,{...options,manualRoute:line=>manualConnectionRoute(line.start,line.end,line.fromSide,line.toSide,line.edge.waypoints,isBranch(line.from),isBranch(line.to)),fallbackRoute:line=>connectionRoute(line.start,line.end,line.fromSide,line.toSide,obstacles,isBranch(line.from)||isBranch(line.to))});
}
// 无效的拖动不写入折点，保留上一个可用位置。
export function adjustConnectionSegment(nodes,edge,points,index,delta){
  if(!edge||!Number.isFinite(delta)||!points[index]||!points[index+1])return null;
  const a=points[index],b=points[index+1],axis=a[1]===b[1]?1:0,first=[...a],last=[...b],from=nodes.find(n=>n.id===edge.from),to=nodes.find(n=>n.id===edge.to);if(!from||!to)return null;
  const [fromSide,toSide]=connectionDirections(edge,from,to),vectors={top:[0,-1],right:[1,0],bottom:[0,1],left:[-1,0]};
  // 拖动首尾线段时保留向外的短引线，不能把端点拉成折返的尾巴。
  if(index===0){const v=vectors[fromSide];first[0]+=v[0]*32;first[1]+=v[1]*32;}
  if(index===points.length-2){const v=vectors[toSide];last[0]+=v[0]*32;last[1]+=v[1]*32;}
  first[axis]+=delta;last[axis]+=delta;
  const waypoints=[...points.slice(1,index),first,last,...points.slice(index+2,-1)];
  const line=routeConnections(nodes,[{...edge,waypoints}],{scope:'manual-segment-preview'})[0];
  return line?.route.manual&&!line.route.repaired&&!line.route.blocked?waypoints:null;
}
export function thumbnailLayout(width,height,boxWidth=canvasCardSize.width-2,boxHeight=canvasCardSize.height-canvasCardSize.header-3){
  const scale=Math.min(boxWidth/width,boxHeight/height);return {scale,width:width*scale,height:height*scale,left:(boxWidth-width*scale)/2,top:(boxHeight-height*scale)/2};
}
export function wheelZoomFactor(delta,sensitivity=3.5,mode=0){const pixels=delta*(mode===1?16:mode===2?800:1);return Math.exp(Math.max(-.7,Math.min(.7,-pixels*.003*sensitivity)));}
export function zoomCamera(camera,scale,anchor){const next=Math.max(.08,Math.min(2.5,scale)),ratio=next/camera.scale;return {scale:next,x:anchor[0]-(anchor[0]-camera.x)*ratio,y:anchor[1]-(anchor[1]-camera.y)*ratio};}
// 文字按实际宽高放到线段旁，只避开节点；新建其他连线不挪动原有文字。
export function placeConnectionLabels(lines,nodes,measure=text=>Array.from(text).reduce((width,char)=>width+(/[^\x00-\xff]/.test(char)?12:7),0)){
  const result=new Map(),occupied=nodes.map(n=>({x:n.x-6,y:n.y-6,width:canvasNodeWidth(n)+12,height:canvasNodeHeight(n)+12}));
  const overlaps=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
  const wrap=(text,width)=>String(text).split('\n').flatMap(paragraph=>{const rows=[];let row='';for(const char of paragraph){if(row&&measure(row+char)>width){rows.push(row);row='';}row+=char;}rows.push(row);return rows;});
  const labelled=lines.map(line=>({...line,text:isBranch(line.to)?line.to.title:line.edge.condition||(line.edge.label?.trim()==='继续'?'':line.edge.label||'')})).filter(line=>line.text&&!line.route.blocked);
  for(const line of labelled){
    const segments=line.route.points.slice(1).map((end,i)=>{const start=line.route.points[i];return {start,end,horizontal:start[1]===end[1],length:Math.abs(end[0]-start[0])+Math.abs(end[1]-start[1])};}).filter(s=>s.length);
    if(isCanvasPoint(line.edge.labelPosition)){
      const rows=wrap(line.text,220),box={x:line.edge.labelPosition[0],y:line.edge.labelPosition[1],width:Math.max(...rows.map(measure))+12,height:rows.length*18+8},center=[box.x+box.width/2,box.y+box.height/2];let anchor=line.route.label,distance=Infinity;
      for(const segment of segments){const point=segment.horizontal?[Math.max(Math.min(segment.start[0],segment.end[0]),Math.min(Math.max(segment.start[0],segment.end[0]),center[0])),segment.start[1]]:[segment.start[0],Math.max(Math.min(segment.start[1],segment.end[1]),Math.min(Math.max(segment.start[1],segment.end[1]),center[1]))],d=Math.abs(point[0]-center[0])+Math.abs(point[1]-center[1]);if(d<distance){distance=d;anchor=point;}}
      const point=[Math.max(box.x,Math.min(box.x+box.width,anchor[0])),Math.max(box.y,Math.min(box.y+box.height,anchor[1]))],leader=distance>Math.max(box.width,box.height)/2+24?`M${anchor.join(',')} L${point[0]},${anchor[1]} L${point.join(',')}`:null;
      result.set(line.edge.id,{box,rows,anchor,leader,manual:true});continue;
    }
    let best=null;
    for(const maxWidth of [220,140,88]){
      const rows=wrap(line.text,maxWidth),width=Math.max(...rows.map(measure))+12,height=rows.length*18+8;
      for(const segment of segments)for(const fraction of [.5,.25,.75])for(const shift of [0,-24,24,-48,48,-96,96])for(const side of [-1,1]){
        const anchor=segment.start.map((v,axis)=>v+(segment.end[axis]-v)*fraction),box=segment.horizontal?{x:anchor[0]-width/2+shift,y:anchor[1]+(side<0?-height-8:8),width,height}:{x:anchor[0]+(side<0?-width-8:8),y:anchor[1]-height/2+shift,width,height};
        if(occupied.some(other=>overlaps(box,other)))continue;
        const score=Math.abs(shift)+rows.length*14+(segment.horizontal?0:16)+Math.abs(fraction-.5)*32;
        if(!best||score<best.score)best={box,rows,anchor,shift,score};
      }
    }
    // 极密画布仍保留完整正文，在空闲处标注，并用短折线指回原连接。
    if(!best){const rows=wrap(line.text,140),width=Math.max(...rows.map(measure))+12,height=rows.length*18+8,anchor=[line.route.label[0]-8,line.route.label[1]+8],base={x:anchor[0]-width/2,y:anchor[1]-height-8,width,height};
      for(let distance=24;distance<=384&&!best;distance+=24)for(const [dx,dy] of [[0,-distance],[0,distance],[-distance,0],[distance,0]]){const box={...base,x:base.x+dx,y:base.y+dy};if(!occupied.some(other=>overlaps(box,other))){best={box,rows,anchor,shift:distance};break;}}
      best??={box:{...base,x:Math.max(0,...occupied.map(r=>r.x+r.width))+24},rows,anchor,shift:Infinity};
    }
    const {box,rows,anchor,shift}=best;
    const point=[Math.max(box.x,Math.min(box.x+box.width,anchor[0])),Math.max(box.y,Math.min(box.y+box.height,anchor[1]))];
    const leader=Math.abs(shift)>24?`M${anchor.join(',')} L${point[0]},${anchor[1]} L${point.join(',')}`:null;
    result.set(line.edge.id,{box,rows,anchor,leader});
  }
  return result;
}
export function restoreView(model,saved) {
  if(!saved||typeof saved!=='object')return null;
  const validCamera=value=>value&&[value.x,value.y,value.scale].every(Number.isFinite)&&value.scale>0&&value.scale<=4;
  const moduleId=model.modules.some(m=>m.id===saved.moduleId)?saved.moduleId:model.entryModule||model.modules[0]?.id;
  const current=model.nodes.some(n=>n.id===saved.current&&!isBranch(n))?saved.current:null;
  return {moduleId,current,camera:validCamera(saved.camera)&&moduleId===saved.moduleId?saved.camera:null,cameras:Object.fromEntries(model.modules.filter(m=>validCamera(saved.cameras?.[m.id])).map(m=>[m.id,saved.cameras[m.id]])),flowContext:isFlowContext(saved.flowContext)?saved.flowContext:clone(model.contextDefaults||{}),linesHidden:saved.linesHidden===true};
}
export const isImagePath = value => typeof value==='string' && /^assets\/[^?#\\\u0000-\u001f]+\.(png|jpe?g|webp)$/i.test(value) && value.split('/').every(part=>part&&part!=='.'&&part!=='..');
export function requirementText(model,owner) {
  const own=String(owner.description||'').trim(),rule=String(model.rules?.[owner.rule]||'').trim();
  return !rule||own===rule||own.includes(rule)?own:[own,rule].filter(Boolean).join('\n\n');
}
export const canvasExplanation = (model,owner) => owner.kind==='note'?requirementText(model,owner):owner.summary??requirementText(model,owner);
export function writeCanvasExplanation(owner,text) {if(owner.kind==='note'){owner.description=text;delete owner.rule;}else owner.summary=text;}
const imagePattern = /`[^`]*`|!\[([^\]\n]*)\]\(([^)\n]+)\)/g;
export function descriptionImagePaths(model) {
  const texts=[...model.nodes.flatMap(n=>[n.description,n.summary]),...model.edges.flatMap(e=>[e.description,e.summary]),...model.annotations.map(a=>a.text),...Object.values(model.rules||{})];
  return [...new Set([...texts.flatMap(text=>[...String(text||'').matchAll(imagePattern)].filter(m=>m[2]!==undefined).map(m=>m[2])),...documentAssetPaths(model)])];
}
export function expandHTML(text, fragments, trail=[]) {
  return text.replace(/<!--\s*include:([^>]+?)\s*-->/g,(_,key)=>{
    if(trail.includes(key))throw new Error(`组件循环引用：${key}`);
    if(fragments[key]===undefined)throw new Error(`组件不存在：${key}`);
    return expandHTML(fragments[key],fragments,[...trail,key]);
  });
}
export function validate(model) {
  const errors = [], ids = new Set(), modules = new Set();
  if (model.version !== 1 || !Array.isArray(model.modules) || !Array.isArray(model.nodes) || !Array.isArray(model.edges) || !Array.isArray(model.annotations)) return ['工作台数据格式不正确'];
  if(model.contextDefaults!==undefined&&!isFlowContext(model.contextDefaults))errors.push('流程默认条件不正确');
  for (const m of model.modules) { if (!m.id || modules.has(m.id)) errors.push('模块标识重复或为空'); modules.add(m.id);if(m.sections!==undefined&&(!Array.isArray(m.sections)||new Set(m.sections.map(s=>s.id)).size!==m.sections.length||m.sections.some(s=>!s.id||typeof s.title!=='string')))errors.push(`画布分区格式不正确：${m.title}`); }
  for (const n of model.nodes) {
    if (!n.id || ids.has(n.id)) errors.push(`页面标识重复：${n.id}`);
    ids.add(n.id);
    if (!modules.has(n.module)) errors.push(`页面所属模块不存在：${n.title}`);
    if (!['html','image','note'].includes(n.kind)) errors.push(`页面类型不正确：${n.title}`);
    if (![n.width,n.height].every(v => Number.isFinite(v) && v > 0 && v <= 20000)) errors.push(`页面尺寸不正确：${n.title}`);
    if(n.canvasType!==undefined&&!['pc','mobile'].includes(n.canvasType))errors.push(`节点类型不正确：${n.title}`);
    if (![n.x,n.y].every(Number.isFinite)) errors.push(`画布位置不正确：${n.title}`);
    if (n.rule && typeof model.rules?.[n.rule]!=='string') errors.push(`页面规则不存在：${n.title}`);
    if(n.summary!==undefined&&typeof n.summary!=='string')errors.push(`页面核心说明不正确：${n.title}`);
    if(n.canvas!==undefined&&typeof n.canvas!=='boolean')errors.push(`页面画布设置不正确：${n.title}`);
    if(n.overview!==undefined&&typeof n.overview!=='boolean')errors.push(`页面概览设置不正确：${n.title}`);
    if(n.presentation!==undefined&&(n.presentation!=='branch'||n.kind!=='note'))errors.push(`分支节点格式不正确：${n.title}`);
    if(n.section&&!model.modules.find(m=>m.id===n.module)?.sections?.some(s=>s.id===n.section))errors.push(`页面分区不存在：${n.title}`);
    if (n.kind !== 'note' && (typeof n.path !== 'string' || /(^\/|\\|(^|\/)\.\.(\/|$)|^\w+:)/.test(n.path))) errors.push(`资源路径不正确：${n.title}`);
  }
  if(model.recyclePositions!==undefined&&(model.recyclePositions===null||typeof model.recyclePositions!=='object'||Array.isArray(model.recyclePositions)||Object.entries(model.recyclePositions).some(([id,p])=>!ids.has(id)||!p||![p.x,p.y].every(Number.isFinite))))errors.push('回收站画布位置不正确');
  const edgeIds = new Set();
  for(const n of model.nodes)if(n.overviewAlias&&(!ids.has(n.overviewAlias)||n.overviewAlias===n.id||model.nodes.find(v=>v.id===n.overviewAlias)?.overview===false))errors.push(`重复页面的概览引用不正确：${n.title}`);
  for (const e of model.edges) {
    if (!e.id || edgeIds.has(e.id)) errors.push('连线标识重复或为空'); edgeIds.add(e.id);
    if (!ids.has(e.from) || !ids.has(e.to)) errors.push(`连线目标不存在：${e.label}`);
    if(e.rule && typeof model.rules?.[e.rule]!=='string')errors.push(`操作规则不存在：${e.label}`);
    if(e.summary!==undefined&&typeof e.summary!=='string')errors.push(`操作核心说明不正确：${e.label}`);
    if((e.when!==undefined&&!isFlowContext(e.when))||(e.setContext!==undefined&&!isFlowContext(e.setContext)))errors.push(`操作条件不正确：${e.label}`);
    if(['fromSide','toSide'].some(key=>e[key]!==undefined&&!connectionSides.includes(e[key])))errors.push(`连线端点不正确：${e.label}`);
    if(e.overview!==undefined&&typeof e.overview!=='boolean')errors.push(`连线概览设置不正确：${e.label}`);
    if(e.diagram!==undefined&&typeof e.diagram!=='boolean')errors.push(`画布连线设置不正确：${e.label}`);
    if(e.waypoints!==undefined&&(!Array.isArray(e.waypoints)||e.waypoints.some(point=>!isCanvasPoint(point))))errors.push(`手动折点不正确：${e.label}`);
    if(e.labelPosition!==undefined&&!isCanvasPoint(e.labelPosition))errors.push(`连线文字位置不正确：${e.label}`);
    if(e.canvasFrom&&!isBranch(model.nodes.find(n=>n.id===e.canvasFrom)))errors.push(`连线分叉点不存在：${e.label}`);
    if (e.rect && (!Array.isArray(e.rect) || e.rect.length !== 4 || !e.rect.every(Number.isFinite) || e.rect[0] < 0 || e.rect[1] < 0 || e.rect[2] <= 0 || e.rect[3] <= 0 || e.rect[0]+e.rect[2] > 1.001 || e.rect[1]+e.rect[3] > 1.001)) errors.push(`交互区域不正确：${e.label}`);
  }
  const annotationIds = new Set();
  for (const a of model.annotations) {
    if (!a.id || annotationIds.has(a.id)) errors.push('批注标识重复或为空'); annotationIds.add(a.id);
    if (a.edge ? !edgeIds.has(a.edge) : !ids.has(a.node)) errors.push('批注关联对象不存在');
    if (a.point && (a.point.length !== 2 || !a.point.every(v=>Number.isFinite(v) && v>=0 && v<=1))) errors.push('批注坐标不正确');
  }
  if(model.groups!==undefined){
    if(!Array.isArray(model.groups))errors.push('编组格式不正确');
    else {const groupIds=new Set();for(const group of model.groups){if(!group.id||groupIds.has(group.id)||!modules.has(group.module)||!Array.isArray(group.nodes)||group.nodes.length<2||new Set(group.nodes).size!==group.nodes.length||group.nodes.some(id=>!ids.has(id)))errors.push('编组关联页面不正确');groupIds.add(group.id);}}
  }
  for(const field of ["flows","experiences"])if(model[field]!==undefined){
    const seen=new Set();if(!Array.isArray(model[field]))errors.push('体验流程格式不正确');
    else for(const flow of model[field]){if(!flow.id||seen.has(flow.id)||typeof flow.title!=='string'||!ids.has(flow.entry)||isBranch(model.nodes.find(n=>n.id===flow.entry))||flow.context!==undefined&&!isFlowContext(flow.context))errors.push('体验流程入口或条件不正确');seen.add(flow.id);}
  }
  errors.push(...validateDocument(model));
  if(descriptionImagePaths(model).some(path=>!isImagePath(path)))errors.push('说明图片需使用项目 assets 目录中的 PNG、JPEG 或 WebP 文件');
  return errors;
}
export function overviewEdges(model) {
  const visible=new Set(model.nodes.filter(n=>n.overview!==false&&n.canvas!==false).map(n=>n.id));
  const aliases=new Map(model.nodes.filter(n=>n.overviewAlias).map(n=>[n.id,n.overviewAlias]));
  return model.edges.filter(e=>!e.navigation&&e.overview!==false).map(e=>e.canvasFrom||aliases.has(e.from)||aliases.has(e.to)?{...e,from:e.canvasFrom||aliases.get(e.from)||e.from,to:aliases.get(e.to)||e.to}:e).filter(e=>e.from!==e.to&&visible.has(e.from)&&visible.has(e.to));
}
function dropConnections(model,ids) {
  const removed=new Set(ids);
  model.edges=model.edges.filter(edge=>!removed.has(edge.id));
  model.annotations=model.annotations.filter(annotation=>!removed.has(annotation.edge));
}
// 分叉只改变画布结构。移除连接点时接回其前后关系，不删除实际页面跳转。
export function dissolveBranch(model,id){
  const branch=model.nodes.find(n=>n.id===id);if(!isBranch(branch))return false;
  const from=edge=>edge.canvasFrom||edge.from,incoming=model.edges.filter(e=>e.to===id&&from(e)!==id),outgoing=model.edges.filter(e=>from(e)===id&&e.to!==id),byId=new Map(model.nodes.map(n=>[n.id,n]));
  const resolve=value=>byId.get(value)?.overviewAlias||value;
  const heads=[...new Map(incoming.map(e=>[from(e),e])).values()];
  if(!heads.length){const sources=[...new Set(outgoing.filter(e=>e.canvasFrom===id&&e.from!==id).map(e=>resolve(e.from)))];if(sources.length===1)heads.push({from:sources[0]});else if(model.edges.some(e=>e.from===id))return false;}
  const headFor=edge=>heads.find(e=>resolve(from(e))===resolve(edge.from))||heads[0];
  if(outgoing.some(edge=>heads.some(head=>from(head)===edge.to)))return false;
  const notes=[branch.title,model.rules?.[branch.rule]||branch.description,...incoming.flatMap(e=>[e.condition||e.label,model.rules?.[e.rule]||e.description])].filter(text=>typeof text==='string'&&text.trim());
  for(const edge of outgoing){
    const old=clone(edge),head=headFor(old),origin=head&&from(head);
    const attach=(target,parent)=>{
      const source=parent&&from(parent);
      if(target.from===id)target.from=source;
      if(target.canvasFrom===id){if(isBranch(byId.get(source)))target.canvasFrom=source;else delete target.canvasFrom;}
      if(parent){
        if(parent.fromSide)target.fromSide=parent.fromSide;else delete target.fromSide;
        if(Array.isArray(parent.waypoints)||Array.isArray(old.waypoints))target.waypoints=[...(parent.waypoints||[]).map(p=>[...p]),[branch.x+8,branch.y+8],...(old.waypoints||[]).map(p=>[...p])];
        else delete target.waypoints;
      }else{delete target.fromSide;delete target.waypoints;}
    };
    attach(edge,head);
    if(old.from===id)for(const parent of heads)if(from(parent)!==origin){const extra={...clone(old),id:uid('edge')};attach(extra,parent);model.edges.push(extra);}
  }
  // 下游再次分叉后，实际边的 from 仍可能引用上游连接点。
  const fallback=heads[0]&&from(heads[0]);
  for(const edge of model.edges)if(edge.from===id&&edge.canvasFrom!==id&&edge.canvasFrom)edge.from=fallback;
  const removedEdges=new Set(incoming.map(e=>e.id)),successor=outgoing[0];
  for(const annotation of model.annotations||[]){
    if(annotation.node!==id&&!removedEdges.has(annotation.edge))continue;
    if(successor){annotation.edge=successor.id;delete annotation.node;delete annotation.point;delete annotation.selector;delete annotation.offset;}
  }
  if(successor){const retained=new Set([successor.condition,successor.label,...(model.annotations||[]).filter(a=>a.edge===successor.id).map(a=>a.text)]);const text=[...new Set(notes)].filter(note=>!retained.has(note)).join('\n\n');if(text){model.annotations??=[];model.annotations.push({id:uid('annotation'),edge:successor.id,text});}}
  model.edges=model.edges.filter(e=>!removedEdges.has(e.id));model.nodes=model.nodes.filter(n=>n.id!==id);
  model.annotations=(model.annotations||[]).filter(a=>a.node!==id&&!removedEdges.has(a.edge));
  for(const positions of Object.values(model.referencePositions||{}))delete positions[id];if(model.recyclePositions)delete model.recyclePositions[id];
  if(model.groups)model.groups=model.groups.map(group=>({...group,nodes:group.nodes.filter(value=>value!==id)})).filter(group=>group.nodes.length>1);
  return true;
}
export function normalizeBranchJunctions(model){
  const removed=[];let changed=true;
  while(changed){changed=false;const byId=new Map(model.nodes.map(n=>[n.id,n])),resolve=id=>byId.get(id)?.overviewAlias||id;
    for(const branch of model.nodes.filter(isBranch)){
      const incoming=model.edges.filter(e=>e.to===branch.id),outgoing=model.edges.filter(e=>(e.canvasFrom||e.from)===branch.id),sources=new Set(incoming.map(e=>resolve(e.canvasFrom||e.from))),targets=new Set(outgoing.map(e=>resolve(e.to)));
      const empty=!branch.title?.trim()&&!branch.description?.trim()&&!branch.rule&&!(model.annotations||[]).some(a=>a.node===branch.id);
      const redundant=sources.size===1&&targets.size===1||!outgoing.length&&empty||!incoming.length&&outgoing.some(e=>e.canvasFrom===branch.id&&e.from!==branch.id);
      if(redundant&&dissolveBranch(model,branch.id)){removed.push(branch.id);changed=true;break;}
    }
  }
  return removed;
}
export function removeConnections(model,ids){dropConnections(model,ids);normalizeBranchJunctions(model);pruneDocument(model);}
export function compactCanvas(model,moduleId) {
  const nodes=moduleNodes(model,moduleId);
  for(const [axis,size,gap] of [['x',canvasNodeWidth,80],['y',canvasNodeHeight,100]]){
    const groups=[];
    for(const n of [...nodes].sort((a,b)=>a[axis]-b[axis])){
      const last=groups.at(-1),end=n[axis]+size(n);
      if(last&&n[axis]<=last.end){last.nodes.push(n);last.end=Math.max(last.end,end);}
      else groups.push({start:n[axis],end,nodes:[n]});
    }
    let removed=0,previous=null;
    for(const group of groups){
      if(previous===null)removed=Math.max(0,group.start-60);
      else removed+=Math.max(0,group.start-previous-gap);
      for(const n of group.nodes){const value=n[axis]-removed;
        if(n.reference){model.referencePositions??={};model.referencePositions[moduleId]??={};const position=model.referencePositions[moduleId][n.id]??={x:n.x,y:n.y};position[axis]=value;n[axis]=value;}
        else n[axis]=value;
      }
      previous=group.end;
    }
  }
}
export function removeNodes(model,ids) {
  const removed=new Set(ids);
  for(const id of ids)if(isBranch(model.nodes.find(n=>n.id===id))){dissolveBranch(model,id);removed.delete(id);}
  dropConnections(model,model.edges.filter(e=>removed.has(e.from)||removed.has(e.to)||removed.has(e.canvasFrom)).map(e=>e.id));
  model.annotations=model.annotations.filter(a=>!removed.has(a.node));model.nodes=model.nodes.filter(n=>!removed.has(n.id));
  for(const n of model.nodes)if(removed.has(n.overviewAlias))delete n.overviewAlias;
  for(const positions of Object.values(model.referencePositions||{}))for(const id of removed)delete positions[id];
  for(const id of removed)if(model.recyclePositions)delete model.recyclePositions[id];
  if(model.groups)model.groups=model.groups.map(group=>({...group,nodes:group.nodes.filter(id=>!removed.has(id))})).filter(group=>group.nodes.length>1);
  for(const module of model.modules)if(removed.has(module.entry)){const entry=model.nodes.find(n=>n.module===module.id&&n.overview!==false&&!isBranch(n))?.id;if(entry)module.entry=entry;else delete module.entry;}
  for(const field of ["flows","experiences"])if(model[field])model[field]=model[field].filter(flow=>model.nodes.some(n=>n.id===flow.entry));
  for(const module of model.modules)if(module.entry&&!model.nodes.some(n=>n.id===module.entry))delete module.entry;
  normalizeBranchJunctions(model);
  pruneDocument(model);
}
export function removeCanvasNodes(model,moduleId,ids){
  const selected=new Set(ids),byId=new Map(model.nodes.map(n=>[n.id,n])),references=new Set(model.nodes.filter(n=>n.module!==moduleId&&selected.has(n.id)).map(n=>n.id));
  const resolve=id=>byId.get(id)?.overviewAlias||id;
  const relations=model.edges.filter(e=>(byId.get(e.from)?.module===moduleId||byId.get(e.canvasFrom)?.module===moduleId)&&(references.has(resolve(e.from))||references.has(resolve(e.to))||references.has(e.from)||references.has(e.to))).map(e=>e.id);
  removeConnections(model,relations);
  for(const id of references)if(model.referencePositions?.[moduleId])delete model.referencePositions[moduleId][id];
  if(model.groups)model.groups=model.groups.map(group=>group.module===moduleId?{...group,nodes:group.nodes.filter(id=>!references.has(id))}:group).filter(group=>group.nodes.length>1);
  removeNodes(model,model.nodes.filter(n=>n.module===moduleId&&selected.has(n.id)).map(n=>n.id));
}
export function moduleNodes(model, moduleId) {
  const own = model.nodes.filter(n => n.module === moduleId&&n.overview!==false&&n.canvas!==false), ownIds = new Set(own.map(n=>n.id));
  const refs = [...new Set(overviewEdges(model).filter(e=>ownIds.has(e.from) && !ownIds.has(e.to)).map(e=>e.to))];
  let y=60;const x=Math.max(500,...own.map(n=>n.x+canvasNodeWidth(n)+80));
  return [...own, ...refs.map(id=>{const n=model.nodes.find(n=>n.id===id),position=model.referencePositions?.[moduleId]?.[id],r={...n,x:position?.x??x,y:position?.y??y,reference:true};y+=canvasNodeHeight(n)+70;return r;})];
}
export function recycleNodes(model){
  const rank=new Map(model.modules.map((m,i)=>[m.id,i]));
  return model.nodes.filter(n=>n.overview===false&&n.canvas!==false&&!isBranch(n)&&rank.has(n.module)).sort((a,b)=>rank.get(a.module)-rank.get(b.module)||(a.y||0)-(b.y||0)||(a.x||0)-(b.x||0));
}
export function recycleCanvasNodes(model){
  const nodes=recycleNodes(model),result=[];let y=60;
  for(let i=0;i<nodes.length;i+=4){const row=nodes.slice(i,i+4);row.forEach((n,column)=>{const p=model.recyclePositions?.[n.id];result.push({...n,x:p?.x??60+column*464,y:p?.y??y});});y+=Math.max(...row.map(canvasNodeHeight))+80;}
  return result;
}
export function moveRecycleNodes(model,positions){
  const nodes=recycleCanvasNodes(model);if(!nodes.length)return [];
  model.recyclePositions??={};for(const n of nodes)model.recyclePositions[n.id]??={x:n.x,y:n.y};
  const ids=new Set(nodes.map(n=>n.id)),moved=[];
  for(const p of positions)if(ids.has(p.id)&&[p.x,p.y].every(Number.isFinite)){model.recyclePositions[p.id]={x:p.x,y:p.y};moved.push(p.id);}
  return moved;
}
export function exportSubset(model, moduleId) {
  const result=clone(model);delete result.lockedPositions;
  if (!moduleId) return result;
  const keep = new Set(model.nodes.filter(n=>n.module===moduleId).map(n=>n.id));
  let changed = true;
  while (changed) { changed=false; for (const e of model.edges) if(keep.has(e.from)||keep.has(e.canvasFrom))for(const id of [e.from,e.to,e.canvasFrom].filter(Boolean))if(!keep.has(id)){keep.add(id);changed=true;} }
  result.nodes=result.nodes.filter(n=>keep.has(n.id));
  result.edges=result.edges.filter(e=>keep.has(e.from) && keep.has(e.to));
  const edgeIds=new Set(result.edges.map(e=>e.id));
  result.annotations=result.annotations.filter(a=>a.edge ? edgeIds.has(a.edge) : keep.has(a.node));
  const ms=new Set(result.nodes.map(n=>n.module));
  result.modules=result.modules.filter(m=>m.id===moduleId||ms.has(m.id)); result.entryModule=moduleId;
  for(const field of ["flows","experiences"])if(result[field])result[field]=result[field].filter(flow=>keep.has(flow.entry));
  const moduleIds=new Set(result.modules.map(m=>m.id));
  if(result.groups)result.groups=result.groups.filter(g=>moduleIds.has(g.module)).map(g=>({...g,nodes:g.nodes.filter(id=>keep.has(id))})).filter(g=>g.nodes.length>1);
  if(result.recyclePositions)result.recyclePositions=Object.fromEntries(Object.entries(result.recyclePositions).filter(([id])=>keep.has(id)));
  if(result.referencePositions)result.referencePositions=Object.fromEntries(Object.entries(result.referencePositions).filter(([id])=>moduleIds.has(id)).map(([id,positions])=>[id,Object.fromEntries(Object.entries(positions).filter(([nodeId])=>keep.has(nodeId)))]));
  if(result.rules){const used=new Set([...result.nodes,...result.edges].map(v=>v.rule).filter(Boolean));result.rules=Object.fromEntries(Object.entries(result.rules).filter(([id])=>used.has(id)));}
  pruneDocument(result);
  return result;
}
export function exportIssues(model){
  const errors=validate(model);
  for(const a of [...model.annotations,...model.edges]){const n=model.nodes.find(n=>n.id===(a.node||a.from));if(a.imagePath&&n&&n.path!==a.imagePath)errors.push(a.from?`请重新设置截图交互区域：${n.title}`:`请删除旧截图标记后重新打点：${n.title}`);}
  return errors;
}
export function autoLayout(model, moduleId) {
  const result=clone(model);adaptCanvasLayout(result,moduleId);return result;
}
// 只整理改线涉及的可见流程。分区、引用位置与产品页面来源分别保留。
export function adaptCanvasLayout(model,moduleId,{seeds=[],edgeId,direction}={}) {
  const nodes=moduleNodes(model,moduleId).map(n=>({...n})),byId=new Map(nodes.map(n=>[n.id,n]));
  const original=new Map(nodes.map(n=>[n.id,{x:n.x,y:n.y}])),sections=model.modules.find(m=>m.id===moduleId)?.sections||[];
  const sectionIds=new Set(sections.map(s=>s.id)),section=n=>sectionIds.has(n.section)?n.section:'';
  const edges=overviewEdges(model).filter(e=>byId.has(e.from)&&byId.has(e.to)&&!(byId.get(e.from).reference&&byId.get(e.to).reference)&&section(byId.get(e.from))===section(byId.get(e.to)));
  const adjacent=new Map(nodes.map(n=>[n.id,new Set()]));for(const e of edges){adjacent.get(e.from).add(e.to);adjacent.get(e.to).add(e.from);}
  const aliases=new Map(model.nodes.filter(n=>n.overviewAlias).map(n=>[n.id,n.overviewAlias])),wanted=new Set(seeds.map(id=>aliases.get(id)||id));
  const changed=edges.find(e=>e.id===edgeId);if(changed){wanted.add(changed.from);wanted.add(changed.to);}
  const seen=new Set(),components=[];
  for(const n of nodes)if(!seen.has(n.id)){const ids=[],queue=[n.id];seen.add(n.id);while(queue.length){const id=queue.shift();ids.push(id);for(const other of adjacent.get(id))if(!seen.has(other)){seen.add(other);queue.push(other);}}components.push(ids);}
  const chosen=components.filter(ids=>ids.length>1&&(!wanted.size||ids.some(id=>wanted.has(id)))),active=new Set(chosen.flat());
  const reserved=nodes.filter(n=>!active.has(n.id)),rect=n=>({x:n.x,y:n.y,width:canvasNodeWidth(n),height:canvasNodeHeight(n)});
  const overlap=(a,b,gap=64)=>a.x<b.x+b.width+gap&&a.x+a.width+gap>b.x&&a.y<b.y+b.height+gap&&a.y+a.height+gap>b.y;
  // 闭环先合成一组，后面的层级计算只处理无环图。
  for(const ids of chosen){
    const idSet=new Set(ids),links=edges.filter(e=>idSet.has(e.from)&&idSet.has(e.to)),outs=new Map(ids.map(id=>[id,[]]));for(const e of links)outs.get(e.from).push(e.to);
    let serial=0;const indices=new Map(),low=new Map(),stack=[],onStack=new Set(),groups=[];
    function visit(id){indices.set(id,serial);low.set(id,serial++);stack.push(id);onStack.add(id);for(const to of outs.get(id)){if(!indices.has(to)){visit(to);low.set(id,Math.min(low.get(id),low.get(to)));}else if(onStack.has(to))low.set(id,Math.min(low.get(id),indices.get(to)));}if(low.get(id)===indices.get(id)){const members=[];let item;do{item=stack.pop();onStack.delete(item);members.push(item);}while(item!==id);groups.push({members,parents:new Set(),children:new Set(),rank:0,center:0});}}
    ids.forEach(id=>{if(!indices.has(id))visit(id);});const groupFor=new Map(groups.flatMap((g,i)=>g.members.map(id=>[id,i])));
    for(const e of links){const a=groupFor.get(e.from),b=groupFor.get(e.to);if(a!==b){groups[a].children.add(b);groups[b].parents.add(a);}}
    const roots=groups.map((g,i)=>i).filter(i=>!groups[i].parents.size),rootIds=new Set(roots.flatMap(i=>groups[i].members));
    const rootLinks=links.filter(e=>rootIds.has(e.from)&&!isBranch(byId.get(e.from))&&groupFor.get(e.from)!==groupFor.get(e.to));
    const first=rootLinks.find(e=>e.id===edgeId)||rootLinks[0];
    const heading=connectionSides.includes(direction)?direction:first?.fromSide||'bottom',horizontal=['left','right'].includes(heading),reverse=['left','top'].includes(heading),gap=120;
    const breadth=n=>horizontal?canvasNodeHeight(n):canvasNodeWidth(n),length=n=>horizontal?canvasNodeWidth(n):canvasNodeHeight(n),oldCenter=n=>horizontal?n.y+canvasNodeHeight(n)/2:n.x+canvasNodeWidth(n)/2;
    for(const g of groups){g.members.sort((a,b)=>oldCenter(byId.get(a))-oldCenter(byId.get(b))||a.localeCompare(b));g.breadth=g.members.reduce((sum,id)=>sum+breadth(byId.get(id)),0)+gap*(g.members.length-1);g.length=Math.max(...g.members.map(id=>length(byId.get(id))));g.old=g.members.reduce((sum,id)=>sum+oldCenter(byId.get(id)),0)/g.members.length;g.tree=[];}
    const degree=groups.map(g=>g.parents.size),queue=[...roots],order=[];
    while(queue.length){const i=queue.shift();order.push(i);for(const child of groups[i].children){groups[child].rank=Math.max(groups[child].rank,groups[i].rank+1);if(--degree[child]===0)queue.push(child);}}
    for(const i of order){const g=groups[i];if(g.parents.size){const parent=[...g.parents].sort((a,b)=>groups[b].rank-groups[a].rank||groups[a].old-groups[b].old)[0];groups[parent].tree.push(i);}}
    function span(i){const g=groups[i];g.tree.sort((a,b)=>groups[a].old-groups[b].old||a-b);g.span=Math.max(g.breadth,g.tree.reduce((sum,child)=>sum+span(child),0)+gap*Math.max(0,g.tree.length-1));return g.span;}
    function position(i,left){const g=groups[i];g.center=left+g.span/2;let x=g.center-(g.tree.reduce((sum,child)=>sum+groups[child].span,0)+gap*Math.max(0,g.tree.length-1))/2;for(const child of g.tree){position(child,x);x+=groups[child].span+gap;}}
    let cursor=0;for(const root of roots.sort((a,b)=>groups[a].old-groups[b].old)){span(root);position(root,cursor);cursor+=groups[root].span+gap;}
    const layers=[];for(const i of order)(layers[groups[i].rank]??=[]).push(i);
    const offsets=[],extents=[];let along=0;
    for(let rank=0;rank<layers.length;rank++){const layer=layers[rank]||[];offsets[rank]=along;extents[rank]=Math.max(0,...layer.map(i=>groups[i].length));along+=extents[rank]+gap;
      layer.sort((a,b)=>groups[a].center-groups[b].center);let end=-Infinity;
      for(const i of layer){const g=groups[i],desired=g.parents.size>1?[...g.parents].reduce((sum,p)=>sum+groups[p].center,0)/g.parents.size:g.center;g.center=Math.max(desired,end+gap+g.breadth/2);end=g.center+g.breadth/2;}
    }
    const proposed=[];
    for(const g of groups){let across=g.center-g.breadth/2;for(const id of g.members){const n=byId.get(id),depth=offsets[g.rank]+(extents[g.rank]-length(n))/2,b=across;let x=horizontal?depth:b,y=horizontal?b:depth;if(reverse){if(horizontal)x=along-gap-x-canvasNodeWidth(n);else y=along-gap-y-canvasNodeHeight(n);}proposed.push({...n,x,y});across+=breadth(n)+gap;}}
    const minX=Math.min(...proposed.map(n=>n.x)),minY=Math.min(...proposed.map(n=>n.y)),baseX=Math.min(...ids.map(id=>original.get(id).x)),baseY=Math.min(...ids.map(id=>original.get(id).y));
    for(const n of proposed){n.x+=baseX-minX;n.y+=baseY-minY;}
    const obstacles=reserved.filter(n=>section(n)===section(proposed[0])),candidates=[[0,0]];
    for(const n of obstacles){candidates.push([Math.max(0,n.x+canvasNodeWidth(n)+100-baseX),0],[0,Math.max(0,n.y+canvasNodeHeight(n)+100-baseY)]);}
    candidates.push([Math.max(0,...obstacles.map(n=>n.x+canvasNodeWidth(n)+100-baseX)),0],[0,Math.max(0,...obstacles.map(n=>n.y+canvasNodeHeight(n)+100-baseY))]);
    candidates.sort((a,b)=>a[0]**2+a[1]**2-(b[0]**2+b[1]**2));const shift=candidates.find(([dx,dy])=>proposed.every(n=>obstacles.every(other=>!overlap({...rect(n),x:n.x+dx,y:n.y+dy},rect(other)))))||[0,0];
    for(const n of proposed){const target=byId.get(n.id);target.x=Math.round(n.x+shift[0]);target.y=Math.round(n.y+shift[1]);reserved.push(target);}
    for(const e of links){const owner=model.edges.find(v=>v.id===e.id),back=groups[groupFor.get(e.to)].rank<=groups[groupFor.get(e.from)].rank;owner.fromSide=back?(horizontal?'top':'left'):heading;owner.toSide=back?(horizontal?'top':'left'):{bottom:'top',top:'bottom',left:'right',right:'left'}[heading];}
  }
  // 下一个业务板块整体顺延，保留板块内部的手动位置关系。
  let bottom=null;for(const s of sections){const members=nodes.filter(n=>n.section===s.id);if(!members.length)continue;const top=Math.min(...members.map(n=>n.y));if(bottom!==null&&top<bottom+180){const dy=bottom+180-top;for(const n of members)n.y+=dy;}bottom=Math.max(...members.map(n=>n.y+canvasNodeHeight(n)));}
  const moved=[];for(const n of nodes){if(n.x!==original.get(n.id).x||n.y!==original.get(n.id).y)moved.push(n.id);if(n.reference){model.referencePositions??={};model.referencePositions[moduleId]??={};model.referencePositions[moduleId][n.id]={x:n.x,y:n.y};}else{const owner=model.nodes.find(v=>v.id===n.id);owner.x=n.x;owner.y=n.y;}}
  return {moved};
}
export class History {
  constructor({maxEntries=100,maxBytes=8*1024*1024,now=Date.now}={}){this.past=[];this.maxEntries=maxEntries;this.maxBytes=maxBytes;this.now=now;this.sizes=new WeakMap();this.group=null;}
  get bytes(){return this.past.reduce((sum,snapshot)=>sum+(this.sizes.get(snapshot)||0),0);}
  push(model,{group=null}={}){
    const time=this.now();if(group&&this.group?.id===group&&this.past.at(-1)===this.group.snapshot&&time-this.group.time<350){this.group.time=time;return;}
    const text=JSON.stringify(model),snapshot=JSON.parse(text);this.sizes.set(snapshot,text.length*2);this.past.push(snapshot);
    while(this.past.length>1&&(this.past.length>this.maxEntries||this.bytes>this.maxBytes))this.past.shift();
    // 单个状态已超过预算时也不无限保留；此时仍可继续编辑和保存。
    if(this.bytes>this.maxBytes)this.past=[];
    this.group=group&&this.past.length?{id:group,time,snapshot}:null;
  }
  undo(model){this.group=null;return this.past.length?this.past.pop():model;}
  clear(){this.past=[];this.group=null;}
}
export function markdown(text, images={}) {
  const lines=String(text||'').split('\n'); let out='',list=null,table=false;
  const inline=s=>{
    let result='',last=0;
    for(const m of s.matchAll(/!\[([^\]\n]*)\]\(([^)\n]+)\)|`([^`]+)`|\*\*(.+?)\*\*|\*([^*\n]+)\*/g)){
      result+=escapeHTML(s.slice(last,m.index));
      if(m[2]!==undefined){const src=images[m[2]];result+=isImagePath(m[2])&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(src||'')?`<img src="${escapeHTML(src)}" alt="${escapeHTML(m[1])}" data-asset-path="${escapeHTML(m[2])}">`:`<span class="missing-image">${escapeHTML(m[1]||'图片')}（图片未载入）</span>`;}
      else if(m[3]!==undefined)result+=`<code>${escapeHTML(m[3])}</code>`;
      else if(m[4]!==undefined)result+=`<strong>${inline(m[4])}</strong>`;
      else result+=`<em>${inline(m[5])}</em>`;
      last=m.index+m[0].length;
    }
    return result+escapeHTML(s.slice(last));
  };
  for(let i=0;i<lines.length;i++) {
    const line=lines[i];
    if(/^\s*\|.*\|\s*$/.test(line)) {
      if(!table){out+='<table>';table=true;}
      if(/^\s*\|[\s:|\-]+\|\s*$/.test(line))continue;
      const header=/^\s*\|[\s:|\-]+\|\s*$/.test(lines[i+1]||'');
      out+='<tr>'+line.trim().slice(1,-1).split('|').map(c=>`<${header?'th':'td'}>${inline(c.trim())}</${header?'th':'td'}>`).join('')+'</tr>';continue;
    }
    if(table){out+='</table>';table=false;}
    const item=line.match(/^\s*(?:([-*])\s+|(\d+)\.\s+)(.*)$/);
    if(item){const tag=item[2]?'ol':'ul';if(list!==tag){if(list)out+=`</${list}>`;out+=`<${tag}>`;list=tag;}out+=`<li>${inline(item[3])}</li>`;continue;}
    if(list){out+=`</${list}>`;list=null;}
    const heading=line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if(heading){const level=heading[1].length;out+=`<h${level}>${inline(heading[2])}</h${level}>`;continue;}
    out+=line?`<p>${inline(line)}</p>`:'<br>';
  }
  return out+(list?`</${list}>`:'')+(table?'</table>':'');
}
// 说明编辑区只序列化文字、基础格式与已上传图片，不保留外部粘贴的 HTML。
export function readDescription(root) {
  const children=el=>[...el.childNodes].reduce((text,child)=>{const block=child.nodeType===1&&['P','DIV','UL','OL','TABLE','H1','H2','H3','H4','H5','H6'].includes(child.tagName);return text+(block&&text&&!text.endsWith('\n')?'\n\n':'')+read(child);},'');
  function read(el){
    if(el.nodeType===3)return el.textContent.replace(/\u00a0/g,' ');
    if(el.nodeType!==1||el.hasAttribute('data-upload-pending'))return '';
    const tag=el.tagName;
    if(tag==='IMG'){const path=el.getAttribute('data-asset-path');return isImagePath(path)?`![${(el.getAttribute('alt')||'图片').replace(/[\[\]\n]/g,'')}](${path})`:'';}
    if(tag==='BR')return '\n';
    if(tag==='STRONG'||tag==='B')return `**${children(el)}**`;
    if(tag==='EM'||tag==='I')return `*${children(el)}*`;
    if(tag==='CODE')return '`'+children(el)+'`';
    if(/^H[1-6]$/.test(tag))return '#'.repeat(Number(tag[1]))+' '+children(el)+'\n\n';
    if(tag==='UL'||tag==='OL')return [...el.children].map((li,index)=>(tag==='OL'?`${index+1}. `:'- ')+children(li).trim()).join('\n')+'\n\n';
    if(tag==='TABLE'){
      const rows=[...el.querySelectorAll('tr')].map(tr=>[...tr.children].map(td=>children(td).trim().replace(/\n/g,' ')));
      return rows.map((cells,i)=>'|'+cells.join('|')+'|\n'+(i===0?'|'+cells.map(()=>'---').join('|')+'|\n':'')).join('')+'\n';
    }
    const value=children(el);return tag==='P'||tag==='DIV'?value+'\n\n':value;
  }
  return children(root).replace(/\n{3,}/g,'\n\n').trim();
}
export function importManifest(manifest) {
  const model={version:1,title:'原型工作台',modules:[],nodes:[],edges:[],annotations:[]};
  for(const r of manifest.requirements||[]) {
    model.modules.push({id:r.id,title:r.title,entry:`${r.id}:${(r.states.find(s=>s.initial)||r.states[0]).id}`});
    r.states.forEach((s,i)=>model.nodes.push({id:`${r.id}:${s.id}`,module:r.id,title:s.desc||s.id,kind:'html',path:s.html,width:1280,height:800,x:60,y:60+i*360,description:s.desc||''}));
    // 转移来源须从源 HTML 的标记读取，不能猜测每条线的起点。
    for(const l of r.logic||[]) model.annotations.push({id:`${r.id}:${l.id}`,node:model.modules.at(-1).entry,text:l.text});
  }
  return model;
}

// 按共同基线合并；有标识的列表逐项、逐字段处理，坐标数组与正文保持整体。
export function mergeProject(base,local,remote,{prefer='local'}={}){
  const conflicts=[],equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b),copy=value=>value===undefined?undefined:clone(value);
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  function merge(b,l,r,path){
    if(equal(l,r))return copy(l);if(equal(l,b))return copy(r);if(equal(r,b))return copy(l);
    if(object(b)&&object(l)&&object(r)){
      const result={};for(const key of new Set([...Object.keys(b),...Object.keys(r),...Object.keys(l)])){
        const value=merge(b[key],l[key],r[key],path.concat(key));if(value!==undefined)Object.defineProperty(result,key,{value,writable:true,enumerable:true,configurable:true});
      }return result;
    }
    const keyed=values=>Array.isArray(values)&&values.every(v=>object(v)&&typeof v.id==='string')&&new Set(values.map(v=>v.id)).size===values.length;
    if(keyed(b)&&keyed(l)&&keyed(r)){
      const bm=new Map(b.map(v=>[v.id,v])),lm=new Map(l.map(v=>[v.id,v])),rm=new Map(r.map(v=>[v.id,v]));
      const order=values=>values.map(v=>v.id).filter(id=>bm.has(id)),bo=order(b),lo=order(l),ro=order(r);
      // 只比较两侧都保留的基线项，删除本身不算重排。
      const common=bo.filter(id=>lm.has(id)&&rm.has(id)),relative=ids=>ids.filter(id=>common.includes(id));
      const localReordered=!equal(relative(lo),relative(bo)),remoteReordered=!equal(relative(ro),relative(bo));
      if(localReordered&&remoteReordered&&!equal(relative(lo),relative(ro)))conflicts.push(path.concat('@order').join('/'));
      const primary=localReordered&&(!remoteReordered||prefer==='local')?l:r,secondary=primary===l?r:l;
      const ids=primary.map(v=>v.id),otherIds=secondary.map(v=>v.id);
      for(let i=0;i<otherIds.length;i++)if(!ids.includes(otherIds[i])){const next=otherIds.slice(i+1).find(id=>ids.includes(id));ids.splice(next===undefined?ids.length:ids.indexOf(next),0,otherIds[i]);}
      const result=[];
      for(const id of ids){const value=merge(bm.get(id),lm.get(id),rm.get(id),path.concat(id));if(value!==undefined)result.push(value);}return result;
    }
    conflicts.push(path.join('/'));return copy(prefer==='remote'?r:l);
  }
  return {model:merge(base,local,remote,[]),conflicts};
}
