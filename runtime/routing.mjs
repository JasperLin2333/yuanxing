import './libavoid.min.js';
import './libavoid-routing.js';

// 只计算路径。页面、控件绑定、手动折线和批注均不写回。
export const canvasCardSize={width:400,height:290,header:40};
export const mobileCardSize={width:240,height:560,header:40};
export function nodeCardType(n){return n.canvasType==='pc'||n.canvasType==='mobile'?n.canvasType:n.kind==='html'&&(n.render?.template?.startsWith('mobile')||n.width<=480&&n.height>n.width)?'mobile':'pc';}
export const nodeCardSize=n=>nodeCardType(n)==='mobile'?mobileCardSize:canvasCardSize;

const routingSessions=new Map();
const routingVectors={top:[0,-1],right:[1,0],bottom:[0,1],left:[-1,0]};
const routingDirs={top:1,bottom:2,left:4,right:8};
const routingHits=(a,b,r)=>a[0]===b[0]?a[0]>r.x&&a[0]<r.x+r.w&&Math.max(a[1],b[1])>r.y&&Math.min(a[1],b[1])<r.y+r.h:a[1]>r.y&&a[1]<r.y+r.h&&Math.max(a[0],b[0])>r.x&&Math.min(a[0],b[0])<r.x+r.w;
const routingManual=line=>Array.isArray(line.edge.waypoints);

function routingResult(points,engine){
  const out=[];
  for(const point of points){
    const p=[...point],previous=out.at(-1);
    if(previous){for(let axis=0;axis<2;axis++)if(Math.abs(p[axis]-previous[axis])<1e-6)p[axis]=previous[axis];if(p[0]===previous[0]&&p[1]===previous[1])continue;}
    out.push(p);
    while(out.length>2){const [a,b,c]=out.slice(-3);if((a[0]===b[0]&&b[0]===c[0]||a[1]===b[1]&&b[1]===c[1])&&(b[0]-a[0])*(c[0]-b[0])+(b[1]-a[1])*(c[1]-b[1])>=0)out.splice(-2,1);else break;}
  }
  let segment=out.slice(0,2),longest=0;
  for(let i=1;i<out.length;i++){const a=out[i-1],b=out[i],length=Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1]);if(length>longest){longest=length;segment=[a,b];}}
  return {points:out,path:out.map((p,i)=>(i?'L':'M')+p.join(',')).join(' '),label:[(segment[0][0]+segment[1][0])/2+8,(segment[0][1]+segment[1][1])/2-8],engine};
}

function routingConstraint(n,point,side){const clamp=v=>Math.max(0,Math.min(1,v)),size=nodeCardSize(n);return {x:clamp((point[0]-n.x)/size.width),y:clamp((point[1]-n.y)/size.height),dir:routingDirs[side]};}
export function connectionJetty(point,other,side,flexible=false){
  const v=routingVectors[side],distance=(other[0]-point[0])*v[0]+(other[1]-point[1])*v[1];
  return flexible&&distance>0?Math.min(32,distance/2):32;
}
function routingFree(point,side,length=32){const v=routingVectors[side];return {x:point[0]+v[0]*length,y:point[1]+v[1]*length};}
function routingSignature(line){return JSON.stringify([line.edge.from,line.edge.to,line.fromSide,line.toSide,line.start,line.end,line.edge.waypoints??null]);}
export function validConnectionShape(points,fromSide,toSide){
  const ps=points.filter((p,i)=>!i||p[0]!==points[i-1][0]||p[1]!==points[i-1][1]);if(ps.length<2)return false;
  const a=routingVectors[fromSide],b=routingVectors[toSide],first=ps[1],last=ps.at(-2),start=ps[0],end=ps.at(-1);
  if(a&&(first[0]-start[0])*a[0]+(first[1]-start[1])*a[1]<=0||b&&(last[0]-end[0])*b[0]+(last[1]-end[1])*b[1]<=0)return false;
  for(let i=1;i<ps.length;i++){
    const p=ps[i-1],q=ps[i];if(p[0]!==q[0]&&p[1]!==q[1])return false;
    if(i>1){const prev=ps[i-2];if((p[0]-prev[0])*(q[0]-p[0])+(p[1]-prev[1])*(q[1]-p[1])<0)return false;}
    for(let j=1;j<i-1;j++){
      const u=ps[j-1],v=ps[j],horizontal=p[1]===q[1],otherHorizontal=u[1]===v[1];
      if(horizontal===otherHorizontal){const axis=horizontal?0:1,fixed=1-axis;if(p[fixed]===u[fixed]&&Math.max(Math.min(p[axis],q[axis]),Math.min(u[axis],v[axis]))<=Math.min(Math.max(p[axis],q[axis]),Math.max(u[axis],v[axis])))return false;}
      else{const h=horizontal?[p,q]:[u,v],w=horizontal?[u,v]:[p,q];if(w[0][0]>=Math.min(h[0][0],h[1][0])&&w[0][0]<=Math.max(h[0][0],h[1][0])&&h[0][1]>=Math.min(w[0][1],w[1][1])&&h[0][1]<=Math.max(w[0][1],w[1][1]))return false;}
    }
  }
  return true;
}
function routingClear(route,vertices,line){return !route.blocked&&validConnectionShape(route.points,line?.fromSide,line?.toSide)&&route.points.slice(1).every((p,i)=>!vertices.some(v=>routingHits(route.points[i],p,v)));}
// 每条线独立求路；不交换端口，不把其他连线当作障碍。
function routingAuto(line,vertices,fallbackRoute){
  let route;
  if(globalThis.Avoid?.Router&&globalThis.AvoidRouting?.computeRoutes){
    const Avoid=globalThis.Avoid,solver=Object.create(Avoid),scale=1000;
    solver.Router=function(flag){const router=new Avoid.Router(flag);router.setRoutingParameter(Avoid.RoutingParameter.segmentPenalty,24*scale);return router;};
    const fromBranch=line.from.presentation==='branch',toBranch=line.to.presentation==='branch';
    const flexible=fromBranch||toBranch,sourceLength=connectionJetty(line.start,line.end,line.fromSide,flexible),targetLength=connectionJetty(line.end,line.start,line.toSide,flexible);
    const free=(p,side,length)=>{const v=routingFree(p,side,length);return {x:v.x*scale,y:v.y*scale};};
    const edge={id:line.edge.id,...(fromBranch?{sourcePoint:free(line.start,line.fromSide,sourceLength)}:{source:line.from.id,sourceConstraint:routingConstraint(line.from,line.start,line.fromSide),sourceJetty:sourceLength*scale}),...(toBranch?{targetPoint:free(line.end,line.toSide,targetLength)}:{target:line.to.id,targetConstraint:routingConstraint(line.to,line.end,line.toSide),targetJetty:targetLength*scale})};
    const scaled=vertices.map(v=>({...v,x:v.x*scale,y:v.y*scale,w:v.w*scale,h:v.h*scale}));
    const solved=globalThis.AvoidRouting.computeRoutes(solver,scaled,[edge],{shapeBufferDistance:16*scale,idealNudgingDistance:0});
    if(solved[edge.id]){
      const points=[line.start,...solved[edge.id].map(p=>[p.x/scale,p.y/scale]),line.end];
      // 分叉点不占卡片空间，接回其精确坐标。
      if(fromBranch){const p=routingFree(line.start,line.fromSide,sourceLength);points.splice(1,0,[p.x,p.y]);}
      if(toBranch){const p=routingFree(line.end,line.toSide,targetLength);points.splice(-1,0,[p.x,p.y]);}
      for(const p of points)for(let axis=0;axis<2;axis++)for(const end of [line.start,line.end])if(Math.abs(p[axis]-end[axis])<.001)p[axis]=end[axis];
      route=routingResult(points,'libavoid');
    }
  }
  if(!route||!routingClear(route,vertices,line))route={...fallbackRoute(line),engine:'fallback'};
  if(!routingClear(route,vertices,line))return {points:[],path:'',label:line.start,blocked:true};
  return route;
}

export function solveConnections(nodes,lines,{scope,manualRoute,fallbackRoute}={}){
  const vertices=nodes.filter(n=>n.presentation!=='branch').map(n=>({id:n.id,x:n.x,y:n.y,w:nodeCardSize(n).width,h:nodeCardSize(n).height}));
  const key=scope||nodes.map(n=>n.id).sort().join('|'),previous=routingSessions.get(key),routes=new Map(),signatures=new Map();
  for(const line of lines){
    const signature=routingSignature(line);signatures.set(line.edge.id,signature);
    if(routingManual(line)){
      const manual=manualRoute(line);
      // 手调路线仍然有效时原样保留；节点挡住路线时只修复这条线，不覆盖保存的折点。
      line.route=routingClear(manual,vertices,line)?manual:{...routingAuto(line,vertices,fallbackRoute),manual:true,repaired:true};
    }else{
      const cached=previous?.routes.get(line.edge.id);
      line.route=cached&&!cached.blocked&&previous.signatures.get(line.edge.id)===signature&&routingClear(cached,vertices,line)?cached:routingAuto(line,vertices,fallbackRoute);
    }
    routes.set(line.edge.id,line.route);
  }
  routingSessions.set(key,{routes,signatures});
  if(routingSessions.size>32)routingSessions.delete(routingSessions.keys().next().value);
  return lines;
}

export function clearRoutingSessions(){routingSessions.clear();}
