import './libavoid.min.js';
import './libavoid-routing.js';

// 只计算路径。页面、控件绑定、手动折线和批注均不写回。
export const canvasCardSize={width:400,height:290,header:40};
export const mobileCardSize={width:240,height:560,header:40};
export function nodeCardType(n){return n.canvasType==='pc'||n.canvasType==='mobile'?n.canvasType:n.kind==='html'&&(n.render?.template?.startsWith('mobile')||n.width<=480&&n.height>n.width)?'mobile':'pc';}
export const nodeCardSize=n=>nodeCardType(n)==='mobile'?mobileCardSize:canvasCardSize;

const routingSessions=new Map();
const routingVectors={top:[0,-1],right:[1,0],bottom:[0,1],left:[-1,0]};
const routingIsPoint=p=>Array.isArray(p)&&p.length===2&&Number.isFinite(p[0])&&Number.isFinite(p[1]);
const routingHits=(a,b,r)=>a[0]===b[0]?a[0]>r.x&&a[0]<r.x+r.w&&Math.max(a[1],b[1])>r.y&&Math.min(a[1],b[1])<r.y+r.h:a[1]>r.y&&a[1]<r.y+r.h&&Math.max(a[0],b[0])>r.x&&Math.min(a[0],b[0])<r.x+r.w;
const routingManual=line=>Array.isArray(line.edge.waypoints);
const routingCurveTangent=(side,a,b)=>{const o=side==='left'||side==='right'?Math.abs(a[0]-b[0]):side==='top'||side==='bottom'?Math.abs(a[1]-b[1]):0,d=Math.hypot(b[0]-a[0],b[1]-a[1]);return Math.abs(o)<2?Math.min(150,d):Math.min(Math.max(o,100),d);};
const routingPointInside=(p,b)=>b&&p[0]>b.x&&p[0]<b.x+b.w&&p[1]>b.y&&p[1]<b.y+b.h;
const routingCompact=points=>{
  const out=[];
  for(const point of points){
    const p=[point[0],point[1]],previous=out.at(-1);
    if(previous){
      for(let axis=0;axis<2;axis++)if(Math.abs(p[axis]-previous[axis])<1e-6)p[axis]=previous[axis];
      if(p[0]===previous[0]&&p[1]===previous[1])continue;
    }
    out.push(p);
    while(out.length>2){
      const [a,b,c]=out.slice(-3);
      if((a[0]===b[0]&&b[0]===c[0]||a[1]===b[1]&&b[1]===c[1])&&(b[0]-a[0])*(c[0]-b[0])+(b[1]-a[1])*(c[1]-b[1])>=0)out.splice(-2,1);
      else break;
    }
  }
  return out;
};

function routingResult(points,engine,extra={}){
  const out=routingCompact(points);
  let segment=out.slice(0,2),longest=0;
  for(let i=1;i<out.length;i++){const a=out[i-1],b=out[i],length=Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1]);if(length>longest){longest=length;segment=[a,b];}}
  const labelAnchor=segment.length===2?[(segment[0][0]+segment[1][0])/2+8,(segment[0][1]+segment[1][1])/2-8]:[out[0][0]+8,out[0][1]-8];
  return {points:out,path:out.map((p,i)=>(i?'L':'M')+p.join(',')).join(' '),label:labelAnchor,engine,...extra};
}

export function connectionJetty(point,other,side,flexible=false){
  const v=routingVectors[side],distance=(other[0]-point[0])*v[0]+(other[1]-point[1])*v[1];
  return flexible&&distance>0?Math.min(36,distance/2):distance>0&&distance<72?Math.max(12,distance/2):36;
}
function routingSignature(line){
  return JSON.stringify([line.edge.from,line.edge.to,line.edge.lineType||'polyline',line.edge.fromAnchor||null,line.edge.toAnchor||null,line.fromSide,line.toSide,line.start,line.end,line.edge.waypoints??null]);
}

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

// 飞书直线与三次贝塞尔曲线求解（不含阻塞失败）。
export function routingStraight(start,end){
  const a=[start[0],start[1]],b=[end[0],end[1]];
  return {points:[a,b],samplePoints:[a,b],path:`M${a.join(',')} L${b.join(',')}`,label:[(a[0]+b[0])/2+8,(a[1]+b[1])/2-8],lineType:'straight',engine:'feishu'};
}

function routingBisectorFrame(r,prev,next){
  const a=Math.hypot(prev[0]-r[0],prev[1]-r[1]),s=Math.hypot(next[0]-r[0],next[1]-r[1]);
  if(a<1e-6||s<1e-6)return null;
  const c=a/(a+s),d=[prev[0]+(next[0]-prev[0])*c,prev[1]+(next[1]-prev[1])*c],h=[r[0]-d[0],r[1]-d[1]],u=Math.hypot(h[0],h[1]);
  if(u<1e-6){const chord=[next[0]-prev[0],next[1]-prev[1]],cl=Math.hypot(chord[0],chord[1]);return cl<1e-6?null:[chord[0]/cl,chord[1]/cl];}
  const p=[h[0]/u,h[1]/u];return [-p[1],p[0]];
}

export function routingCurve(start,end,fromSide,toSide,waypoints=[]){
  const anchors=[start,...(Array.isArray(waypoints)?waypoints.filter(routingIsPoint):[]),end].map(p=>[p[0],p[1]]);
  const vFrom=routingVectors[fromSide]||[1,0],vTo=routingVectors[toSide]||[-1,0],factor=0.4;
  const startLen=routingCurveTangent(fromSide,anchors[0],anchors[1])*factor,endLen=routingCurveTangent(toSide,anchors.at(-1),anchors.at(-2))*factor;
  const startCF=[vFrom[0]*startLen,vFrom[1]*startLen],endCT=[vTo[0]*endLen,vTo[1]*endLen];
  const curveTo=anchors.map(()=>[0,0]),curveFrom=anchors.map(()=>[0,0]);
  curveFrom[0]=startCF;curveTo[anchors.length-1]=endCT;
  if(anchors.length>2){
    const segLengths=[];for(let i=1;i<anchors.length;i++)segLengths.push(Math.hypot(anchors[i][0]-anchors[i-1][0],anchors[i][1]-anchors[i-1][1]));
    const scales=[];
    for(let i=0;i<segLengths.length-1;i++){let o=segLengths[i],n=segLengths[i+1];if(o<n)n=o+(n-o)/2;else o=n+(o-n)/2;scales.push([o*factor,n*factor]);}
    const roughOut=[[0,0]],roughIn=[[0,0]];
    for(let i=1;i<anchors.length-1;i++){
      const r=anchors[i],prev=anchors[i-1],next=anchors[i+1],vert=routingBisectorFrame(r,prev,next)||[0,0],h=scales[i-1];
      const d1=Math.hypot(r[0]+vert[0]-prev[0],r[1]+vert[1]-prev[1])+Math.hypot(r[0]-vert[0]-next[0],r[1]-vert[1]-next[1]);
      const d2=Math.hypot(r[0]+vert[0]-next[0],r[1]+vert[1]-next[1])+Math.hypot(r[0]-vert[0]-prev[0],r[1]-vert[1]-prev[1]);
      const s=d1<=d2?1:-1;roughIn.push([vert[0]*s*h[0],vert[1]*s*h[0]]);roughOut.push([vert[0]*(-s)*h[1],vert[1]*(-s)*h[1]]);
    }
    roughOut[0]=startCF;roughIn.push(endCT);
    for(let i=1;i<anchors.length-1;i++){
      const r=anchors[i],prev=anchors[i-1],next=anchors[i+1],h=scales[i-1];
      const pGuide=[prev[0]+roughOut[i-1][0],prev[1]+roughOut[i-1][1]],nGuide=[next[0]+roughIn[i+1][0],next[1]+roughIn[i+1][1]];
      const vert=routingBisectorFrame(r,pGuide,nGuide)||routingBisectorFrame(r,prev,next)||[0,0];
      const d1=Math.hypot(r[0]+vert[0]-prev[0],r[1]+vert[1]-prev[1])+Math.hypot(r[0]-vert[0]-next[0],r[1]-vert[1]-next[1]);
      const d2=Math.hypot(r[0]+vert[0]-next[0],r[1]+vert[1]-next[1])+Math.hypot(r[0]-vert[0]-prev[0],r[1]-vert[1]-prev[1]);
      const s=d1<=d2?1:-1;curveTo[i]=[vert[0]*s*h[0],vert[1]*s*h[0]];curveFrom[i]=[vert[0]*(-s)*h[1],vert[1]*(-s)*h[1]];
    }
  }
  const bezier=[anchors[0]];
  let path=`M${anchors[0].join(',')}`;
  const samplePoints=[anchors[0]],spanMidpoints=[];
  let bestSpan=null,bestLen=-1;
  for(let i=0;i<anchors.length-1;i++){
    const p0=anchors[i],p3=anchors[i+1],c0=[p0[0]+curveFrom[i][0],p0[1]+curveFrom[i][1]],c1=[p3[0]+curveTo[i+1][0],p3[1]+curveTo[i+1][1]];
    bezier.push(c0,c1,p3);path+=` C${c0.join(',')} ${c1.join(',')} ${p3.join(',')}`;
    const evalCubic=t=>{const m=1-t;return [m*m*m*p0[0]+3*m*m*t*c0[0]+3*m*t*t*c1[0]+t*t*t*p3[0],m*m*m*p0[1]+3*m*m*t*c0[1]+3*m*t*t*c1[1]+t*t*t*p3[1]];};
    const mid=evalCubic(0.5);spanMidpoints.push(mid);
    const len=Math.hypot(p3[0]-p0[0],p3[1]-p0[1]);if(len>bestLen){bestLen=len;bestSpan=mid;}
    for(let k=1;k<=16;k++)samplePoints.push(evalCubic(k/16));
  }
  const labelPt=bestSpan||anchors[0];
  return {points:bezier,samplePoints,anchors,spanMidpoints,path,label:[labelPt[0]+8,labelPt[1]-8],lineType:'curve',engine:'feishu',...(waypoints.length?{manual:true}:{})};
}

// 正交障碍网格 A* 寻路，作为多节点遮挡时的兜底绕行。
function routingObstacleGrid(start,end,obstacles,fromVector,toVector){
  const xs=[...new Set([start[0],end[0],...obstacles.flatMap(r=>[r.x-20,r.x+r.w+20])])].sort((a,b)=>a-b);
  const ys=[...new Set([start[1],end[1],...obstacles.flatMap(r=>[r.y-20,r.y+r.h+20])])].sort((a,b)=>a-b);
  const width=xs.length,source=ys.indexOf(start[1])*width+xs.indexOf(start[0]),target=ys.indexOf(end[1])*width+xs.indexOf(end[0]);
  if(source<0||target<0)return null;
  const point=id=>[xs[id%width],ys[Math.floor(id/width)]],heap=[],distances=new Map(),parents=new Map();
  const push=item=>{let i=heap.length;heap.push(item);while(i){const p=(i-1)>>1;if(heap[p].score<=item.score)break;heap[i]=heap[p];i=p;}heap[i]=item;};
  const pop=()=>{const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].score<heap[c].score)c++;if(heap[c].score>=last.score)break;heap[i]=heap[c];i=c;}heap[i]=last;}return first;};
  const axis=fromVector[0]?0:1,key=source*2+axis;distances.set(key,0);push({id:source,axis,key,cost:0,score:0});
  while(heap.length){
    const state=pop();if(state.cost!==distances.get(state.key))continue;const u=point(state.id);
    if(state.id===target){const points=[];let k=state.key;while(k!==undefined){points.push(point(Math.floor(k/2)));k=parents.get(k);}return points.reverse();}
    const x=state.id%width,y=Math.floor(state.id/width);
    for(const [nx,ny,nextAxis] of [[x-1,y,0],[x+1,y,0],[x,y-1,1],[x,y+1,1]]){
      if(nx<0||nx>=width||ny<0||ny>=ys.length)continue;const id=ny*width+nx,v=point(id);
      if(state.id===source&&(v[0]-u[0])*fromVector[0]+(v[1]-u[1])*fromVector[1]<0||id===target&&(u[0]-v[0])*toVector[0]+(u[1]-v[1])*toVector[1]<0||obstacles.some(r=>routingHits(u,v,r)))continue;
      const cost=state.cost+Math.abs(v[0]-u[0])+Math.abs(v[1]-u[1])+(nextAxis===state.axis?0:28),nextKey=id*2+nextAxis;
      if(cost>=(distances.get(nextKey)??Infinity))continue;distances.set(nextKey,cost);parents.set(nextKey,state.key);push({id,axis:nextAxis,key:nextKey,cost,score:cost+Math.abs(v[0]-end[0])+Math.abs(v[1]-end[1])});
    }
  }
  return null;
}

// 飞书风格 O(1) 双节点正交布线 + 多障碍平滑避让，永不因被遮挡返回失败。
export function routingFeishuOrthogonal(start,end,fromSide,toSide,fromBounds=null,toBounds=null,otherObstacles=[],flexible=false){
  const a=routingVectors[fromSide]||[1,0],b=routingVectors[toSide]||[-1,0],P=36;
  const xGapMid=fromBounds&&toBounds?(fromBounds.x+fromBounds.w<toBounds.x?(fromBounds.x+fromBounds.w+toBounds.x)/2:toBounds.x+toBounds.w<fromBounds.x?(toBounds.x+toBounds.w+fromBounds.x)/2:null):null;
  const yGapMid=fromBounds&&toBounds?(fromBounds.y+fromBounds.h<toBounds.y?(fromBounds.y+fromBounds.h+toBounds.y)/2:toBounds.y+toBounds.h<fromBounds.y?(toBounds.y+toBounds.h+fromBounds.y)/2:null):null;
  const jettyLen=(pt,side,otherPt,otherBox)=>{
    const v=routingVectors[side],d=(otherPt[0]-pt[0])*v[0]+(otherPt[1]-pt[1])*v[1];
    if(flexible&&d>0)return Math.min(P,d/2);
    if(d>0&&otherBox){const gap=side==='right'?otherBox.x-pt[0]:side==='left'?pt[0]-(otherBox.x+otherBox.w):side==='bottom'?otherBox.y-pt[1]:pt[1]-(otherBox.y+otherBox.h);if(gap>0&&gap<P*2)return Math.max(12,gap/2);}
    return d>0&&d<P*2&&!otherBox?Math.max(12,d/2):P;
  };
  const s=[start[0]+a[0]*jettyLen(start,fromSide,end,toBounds),start[1]+a[1]*jettyLen(start,fromSide,end,toBounds)];
  const t=[end[0]+b[0]*jettyLen(end,toSide,start,fromBounds),end[1]+b[1]*jettyLen(end,toSide,start,fromBounds)];
  const endObstacles=[fromBounds,toBounds].filter(Boolean),allObstacles=[...endObstacles,...otherObstacles];
  const minX=endObstacles.length?Math.min(...endObstacles.map(r=>r.x)):Math.min(start[0],end[0]);
  const minY=endObstacles.length?Math.min(...endObstacles.map(r=>r.y)):Math.min(start[1],end[1]);
  const maxX=endObstacles.length?Math.max(...endObstacles.map(r=>r.x+r.w)):Math.max(start[0],end[0]);
  const maxY=endObstacles.length?Math.max(...endObstacles.map(r=>r.y+r.h)):Math.max(start[1],end[1]);
  const needWindA=!!fromBounds&&!routingPointInside(end,fromBounds)&&(end[0]-start[0])*a[0]+(end[1]-start[1])*a[1]<=0;
  const needWindB=!!toBounds&&!routingPointInside(start,toBounds)&&(start[0]-end[0])*b[0]+(start[1]-end[1])*b[1]<=0;
  const midX=xGapMid!==null&&!needWindA&&!needWindB?xGapMid:(s[0]+t[0])/2;
  const midY=yGapMid!==null&&!needWindA&&!needWindB?yGapMid:(s[1]+t[1])/2;
  const candidates=[];
  if(!needWindA&&!needWindB){
    if(Math.abs(start[0]-end[0])<1e-6||Math.abs(start[1]-end[1])<1e-6)candidates.push([start,end]);
    candidates.push([start,[end[0],start[1]],end],[start,[start[0],end[1]],end],[start,[midX,start[1]],[midX,end[1]],end],[start,[start[0],midY],[end[0],midY],end]);
  }
  candidates.push([start,s,t,end],[start,s,[t[0],s[1]],t,end],[start,s,[s[0],t[1]],t,end]);
  const xs=[...new Set([s[0],t[0],midX,(s[0]+t[0])/2,...(xGapMid!==null?[xGapMid]:[]),minX-P,maxX+P,...otherObstacles.flatMap(r=>[r.x-20,r.x+r.w+20])])];
  const ys=[...new Set([s[1],t[1],midY,(s[1]+t[1])/2,...(yGapMid!==null?[yGapMid]:[]),minY-P,maxY+P,...otherObstacles.flatMap(r=>[r.y-20,r.y+r.h+20])])];
  for(const x of xs)candidates.push([start,s,[x,s[1]],[x,t[1]],t,end]);
  for(const y of ys)candidates.push([start,s,[s[0],y],[t[0],y],t,end]);
  const wrapX=[...new Set([s[0],t[0],...(xGapMid!==null?[xGapMid]:[]),minX-P,maxX+P])];
  const wrapY=[...new Set([s[1],t[1],...(yGapMid!==null?[yGapMid]:[]),minY-P,maxY+P])];
  for(const x of wrapX)for(const y of wrapY){
    candidates.push([start,s,[x,s[1]],[x,y],[t[0],y],t,end],[start,s,[s[0],y],[x,y],[x,t[1]],t,end]);
  }
  let bestClean=null,bestCleanScore=Infinity,bestAny=null,bestAnyScore=Infinity;
  for(const candidate of candidates){
    const pts=routingCompact(candidate);
    if(!validConnectionShape(pts,fromSide,toSide))continue;
    let endHits=0,otherHits=0,len=0;
    for(let i=1;i<pts.length;i++){
      const u=pts[i-1],v=pts[i];len+=Math.abs(v[0]-u[0])+Math.abs(v[1]-u[1]);
      for(const r of endObstacles)if(routingHits(u,v,r))endHits++;
      for(const r of otherObstacles)if(routingHits(u,v,r))otherHits++;
    }
    const baseScore=len+(pts.length-2)*28;
    const anyScore=endHits*1e6+otherHits*1e4+baseScore;
    if(anyScore<bestAnyScore){bestAny={pts,endHits,otherHits};bestAnyScore=anyScore;}
    if(!endHits&&!otherHits&&baseScore<bestCleanScore){bestClean=pts;bestCleanScore=baseScore;}
  }
  if(!bestClean&&allObstacles.length){
    const detour=routingObstacleGrid(s,t,allObstacles,a,b);
    if(detour){
      const pts=routingCompact([start,...detour,end]);
      if(validConnectionShape(pts,fromSide,toSide)&&pts.slice(1).every((p,i)=>!allObstacles.some(r=>routingHits(pts[i],p,r))))bestClean=pts;
    }
  }
  if(bestClean)return routingResult(bestClean,'feishu');
  const pts=bestAny?.pts||routingCompact([start,s,[t[0],s[1]],t,end]);
  return routingResult(pts,'feishu',{...(bestAny&&bestAny.otherHits+bestAny.endHits>0?{overlaps:true}:{})});
}

// 飞书 kF：松手后合并长度 < 2px 的微小折弯，保持首尾朝向并简化共线冗余点。
export function simplifyOrthogonalPoints(points,fromSide,toSide){
  const list=routingCompact(points);
  if(list.length<=2)return list;
  const fromAxis=fromSide==='left'||fromSide==='right'?'h':'v';
  const toAxis=toSide==='left'||toSide==='right'?'h':'v';
  const pts=list.map(p=>[p[0],p[1]]);
  const dirs=()=>{const d=[];for(let i=0;i<pts.length-1;i++)d.push(Math.abs(pts[i][1]-pts[i+1][1])<=Math.abs(pts[i][0]-pts[i+1][0])?'h':'v');return d;};
  for(let i=0;i<pts.length-1&&pts.length>2;){
    const d=dirs(),h=d[i],l=pts[i],c=pts[i+1],prev=pts[Math.max(0,i-1)],next=pts[Math.min(pts.length-1,i+2)];
    const shortSeg=(h==='h'&&Math.abs(l[0]-c[0])<2)||(h==='v'&&Math.abs(l[1]-c[1])<2);
    const smallStub=(h==='h'&&Math.abs(l[0]-c[0])<36)||(h==='v'&&Math.abs(l[1]-c[1])<36);
    const hasStart=Boolean(fromSide),hasEnd=Boolean(toSide),both=hasStart&&hasEnd;
    if(i===0&&shortSeg&&h!==fromAxis&&(!both||smallStub)){
      if(h==='h')prev[0]=next[0];else prev[1]=next[1];
      pts.splice(1,1);continue;
    }
    if(i===pts.length-2&&shortSeg&&h!==toAxis&&(!both||smallStub)){
      if(h==='h')next[0]=prev[0];else next[1]=prev[1];
      pts.splice(i,1);continue;
    }
    if(i>=1&&i<=pts.length-3&&shortSeg&&(!both||smallStub)){
      if(hasStart&&i===1&&fromAxis!==h)next[h==='h'?0:1]=prev[h==='h'?0:1];
      else if(hasEnd&&i===pts.length-3)prev[h==='h'?0:1]=next[h==='h'?0:1];
      else prev[h==='h'?0:1]=next[h==='h'?0:1];
      pts.splice(i,2);i=Math.max(0,i-1);continue;
    }
    i++;
  }
  const finalDirs=dirs();
  if(finalDirs.length){
    if(fromSide&&finalDirs[0]!==fromAxis)pts.splice(1,0,[pts[0][0],pts[0][1]]);
    if(toSide&&finalDirs.at(-1)!==toAxis)pts.splice(pts.length-1,0,[pts.at(-1)[0],pts.at(-1)[1]]);
  }
  return routingCompact(pts);
}

// 飞书 mB：单侧节点移动时尽量保持用户已调的中间折点不动，只伸缩贴近端点的首/尾垂直对齐坐标。
export function adaptManualPolylineOnNodeMove(points,start,end,fromSide,toSide){
  if(!Array.isArray(points)||points.length<3)return null;
  const pts=points.map(p=>[p[0],p[1]]);
  pts[0]=[start[0],start[1]];pts[pts.length-1]=[end[0],end[1]];
  const fromH=fromSide==='left'||fromSide==='right',toH=toSide==='left'||toSide==='right';
  if(fromH)pts[1][1]=start[1];else pts[1][0]=start[0];
  if(toH)pts[pts.length-2][1]=end[1];else pts[pts.length-2][0]=end[0];
  const cleaned=simplifyOrthogonalPoints(pts,fromSide,toSide);
  return validConnectionShape(cleaned,fromSide,toSide)?cleaned:null;
}

// 飞书 m_7328：拖动线段时，自动与相邻拐点或端点对齐吸附（默认阈值 5/scale）。
export function routingNearestAlignment(points,index,axis,delta,threshold=5){
  if(!Array.isArray(points)||!points[index]||!points[index+1]||!threshold)return {delta,guide:null};
  const base=points[index][axis]+delta,candidates=[];
  for(let i=0;i<points.length;i++){
    if(i===index||i===index+1)continue;
    candidates.push(points[i][axis]);
  }
  let bestDelta=0,bestDist=threshold,target=null;
  for(const coord of candidates){const dist=Math.abs(coord-base);if(dist<bestDist){bestDist=dist;bestDelta=coord-base;target=coord;}}
  if(target===null)return {delta,guide:null};
  const minOther=Math.min(points[index][1-axis],points[index+1][1-axis],...points.filter(p=>p[axis]===target).map(p=>p[1-axis]));
  const maxOther=Math.max(points[index][1-axis],points[index+1][1-axis],...points.filter(p=>p[axis]===target).map(p=>p[1-axis]));
  return {delta:delta+bestDelta,guide:{axis:axis===0?'x':'y',position:target,start:minOther-24,end:maxOther+24}};
}

// 飞书 m_16376：2 点直连变 6 点 U 形，首尾按 36/16 引线拆弯，中间自由平移，不因穿过节点而失败。
export function routingSplitSegment(points,index,delta,fromSide,toSide){
  if(!Array.isArray(points)||points.length<2||index<0||index>=points.length-1||!Number.isFinite(delta))return null;
  const a=points[index],b=points[index+1],horizontal=a[1]===b[1],axis=horizontal?1:0,perp=1-axis;
  const segLen=Math.abs(b[perp]-a[perp]);if(segLen<1)return null;
  const stub=len=>len>=108?36:len>=48?16:Math.max(6,Math.floor(len/3));
  let next;
  if(points.length===2){
    const sLen=stub(segLen),sign=b[perp]>=a[perp]?1:-1,s1=[...a],s2=[...a],s3=[...b],s4=[...b];
    s1[perp]=a[perp]+sign*sLen;s2[perp]=s1[perp];s2[axis]=a[axis]+delta;
    s3[perp]=b[perp]-sign*sLen;s3[axis]=b[axis]+delta;s4[perp]=s3[perp];
    next=[a,s1,s2,s3,s4,b];
  }else if(index===0){
    const sLen=stub(segLen),sign=b[perp]>=a[perp]?1:-1,q=[...a],qMoved=[...a],bMoved=[...b];
    q[perp]=a[perp]+sign*sLen;qMoved[perp]=q[perp];qMoved[axis]=a[axis]+delta;bMoved[axis]=b[axis]+delta;
    next=[a,q,qMoved,bMoved,...points.slice(2)];
  }else if(index===points.length-2){
    const sLen=stub(segLen),sign=b[perp]>=a[perp]?1:-1,q=[...b],qMoved=[...b],aMoved=[...a];
    q[perp]=b[perp]-sign*sLen;qMoved[perp]=q[perp];qMoved[axis]=b[axis]+delta;aMoved[axis]=a[axis]+delta;
    next=[...points.slice(0,-2),aMoved,qMoved,q,b];
  }else{
    next=points.map(p=>[p[0],p[1]]);next[index][axis]+=delta;next[index+1][axis]+=delta;
    let curIdx=index;
    const vFrom=routingVectors[fromSide],vTo=routingVectors[toSide];
    if(curIdx===1&&next.length>=3&&vFrom&&(next[1][0]-next[0][0])*vFrom[0]+(next[1][1]-next[0][1])*vFrom[1]<=8){
      const s0=[next[0][0]+vFrom[0]*24,next[0][1]+vFrom[1]*24],mid=Math.round((next[0][perp]+next[2][perp])/2);
      const jog1=[...s0],jog2=[...s0];jog1[perp]=mid;jog2[perp]=mid;jog2[axis]=next[2][axis];
      next=[next[0],s0,jog1,jog2,...next.slice(2)];curIdx+=3;
    }
    const lastIdx=next.length-1;
    if(curIdx===lastIdx-2&&next.length>=3&&vTo&&(next[lastIdx-1][0]-next[lastIdx][0])*vTo[0]+(next[lastIdx-1][1]-next[lastIdx][1])*vTo[1]<=8){
      const t0=[next[lastIdx][0]+vTo[0]*24,next[lastIdx][1]+vTo[1]*24],mid=Math.round((next[lastIdx][perp]+next[lastIdx-2][perp])/2);
      const prevA=next[lastIdx-2],jog1=[...t0],jog2=[...t0];jog1[perp]=mid;jog2[perp]=mid;jog2[axis]=prevA[axis];
      next=[...next.slice(0,-2),jog2,jog1,t0,next[lastIdx]];
    }
  }
  const out=next.filter((p,i)=>i===0||i===next.length-1||p[0]!==next[i-1][0]||p[1]!==next[i-1][1]);
  return out.length>=2?out:null;
}

const routingRouteClear=(route,vertices,line)=>{
  if(!route||route.blocked||route.overlaps)return false;
  if(!validConnectionShape(route.points,line?.fromSide,line?.toSide))return false;
  return route.points.slice(1).every((p,i)=>!vertices.some(v=>routingHits(route.points[i],p,v)));
};

function routingAuto(line,vertices,fallbackRoute){
  const kind=line.edge.lineType||'polyline';
  if(kind==='straight')return routingStraight(line.start,line.end);
  if(kind==='curve')return routingCurve(line.start,line.end,line.fromSide,line.toSide,line.edge.waypoints||[]);
  if(fallbackRoute)return {...fallbackRoute(line),lineType:'polyline',engine:'feishu'};
  const fromB=vertices.find(v=>v.id===line.from.id)||null,toB=vertices.find(v=>v.id===line.to.id)||null;
  const others=vertices.filter(v=>v.id!==line.from.id&&v.id!==line.to.id);
  return routingFeishuOrthogonal(line.start,line.end,line.fromSide,line.toSide,fromB,toB,others,line.from.presentation==='branch'||line.to.presentation==='branch');
}

export function solveConnections(nodes,lines,{scope,manualRoute,fallbackRoute}={}){
  const vertices=nodes.filter(n=>n.presentation!=='branch').map(n=>({id:n.id,x:n.x,y:n.y,w:nodeCardSize(n).width,h:nodeCardSize(n).height}));
  const key=scope||nodes.map(n=>n.id).sort().join('|'),previous=routingSessions.get(key),routes=new Map(),signatures=new Map();
  for(const line of lines){
    const signature=routingSignature(line),kind=line.edge.lineType||'polyline';signatures.set(line.edge.id,signature);
    if(kind==='straight'){
      line.route=routingStraight(line.start,line.end);
    }else if(kind==='curve'){
      line.route=routingCurve(line.start,line.end,line.fromSide,line.toSide,line.edge.waypoints||[]);
    }else if(routingManual(line)){
      const manual=manualRoute(line);
      // 飞书手调折线只要自身形态合法就永久保留，允许自由穿过卡片，不被其他节点移动抹掉。
      line.route=validConnectionShape(manual.points,line.fromSide,line.toSide)?{...manual,lineType:'polyline',manual:true}:{...routingAuto(line,vertices,fallbackRoute),manual:true,repaired:true};
    }else{
      const cached=previous?.routes.get(line.edge.id);
      line.route=cached&&previous.signatures.get(line.edge.id)===signature&&routingRouteClear(cached,vertices,line)?cached:routingAuto(line,vertices,fallbackRoute);
    }
    routes.set(line.edge.id,line.route);
  }
  routingSessions.set(key,{routes,signatures});
  if(routingSessions.size>32)routingSessions.delete(routingSessions.keys().next().value);
  return lines;
}

export function clearRoutingSessions(){routingSessions.clear();}
