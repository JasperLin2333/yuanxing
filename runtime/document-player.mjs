import {prototypeDocument,thumbnailHTML,bindNativeDocument,cleanContext,bindDocumentCanvasGestures} from './player.mjs';
import {expandHTML,eligibleEdges,nextContext,wheelZoomFactor} from './core.mjs';

export function documentPrototypeLayout(node,availableWidth,rect,height,{maxWidth=960,maxHeight=560,frameScale=1}={}) {
  const contentWidth=rect?rect[2]+24:node.width,contentHeight=rect?rect[3]+24:node.height;
  const available=Math.max(80,availableWidth-2),baseWidth=Math.min(maxWidth,available);
  const baseHeight=Math.max(120,Math.min(maxHeight,height??(contentHeight*Math.min(1,baseWidth/contentWidth)+52)));
  frameScale=Math.max(Math.max(.2,Math.min(240,baseWidth)/baseWidth,120/baseHeight),Math.min(2,available/baseWidth,frameScale));
  const width=baseWidth*frameScale,viewHeight=baseHeight*frameScale;
  const scale=Math.min(1,Math.max(16,width-32)/contentWidth,Math.max(16,viewHeight-52)/contentHeight);
  return {scale,width,height:viewHeight,frameScale,contentWidth,contentHeight,left:rect?-rect[0]+12:0,top:rect?-rect[1]+12:0};
}
export function constrainDocumentCamera(camera,layout){
  const scale=Math.max(layout.scale/2,Math.min(Math.max(2.5,layout.scale),camera.scale));
  const axis=(offset,content,available)=>content<=available?(available-content)/2:Math.max(available-content-16,Math.min(16,offset));
  return {scale,x:axis(camera.x,layout.contentWidth*scale,layout.width),y:axis(camera.y,layout.contentHeight*scale,layout.height-36)};
}
// 每个文档嵌入项拥有自己的播放上下文，翻页和输入不会改写文档或其他嵌入项。
export function mountDocumentPrototype(host, initialNode, viewport, block) {
  let node=initialNode,context={...host.model().contextDefaults},frame,stage,focusRect,disposed=false,pageScale=1,layout,camera,fitted=true,tools,zoomLabel,hand=false,space=false,drag=null,unbindFrame;
  let frameScale=block.frameScale??1,savedFrameScale=frameScale,frameDrag=null;
  const bridgeToken=globalThis.crypto.randomUUID();
  const paint=()=>{
    if(!stage||!layout)return;
    camera=constrainDocumentCamera(camera,layout);pageScale=camera.scale;
    stage.style.transform=`translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`;
    if(zoomLabel)zoomLabel.textContent=Math.round(camera.scale*100)+'%';
    viewport.classList.toggle('doc-canvas-pan',hand||space);
    viewport.classList.toggle('doc-canvas-dragging',!!drag);
    viewport.classList.toggle('doc-canvas-resizing',!!frameDrag);
  };
  const fit=()=>{fitted=true;camera={scale:layout.scale,x:0,y:0};paint();};
  const resize=()=>{
    if(!stage||!viewport.isConnected)return;
    const old=layout;
    layout=documentPrototypeLayout(node,viewport.parentElement?.clientWidth||viewport.clientWidth,focusRect,block.height,{maxHeight:Math.min(560,Math.max(240,(window.innerHeight||800)-160)),frameScale});
    stage.style.width=layout.contentWidth+'px';stage.style.height=layout.contentHeight+'px';
    viewport.style.width=(layout.width+2)+'px';viewport.style.height=(layout.height+2)+'px';
    const content=stage.firstElementChild;if(content){content.style.left=layout.left+'px';content.style.top=layout.top+'px';}
    if(fitted||!camera)fit();else{if(old){camera.x+=(layout.width-old.width)/2;camera.y+=(layout.height-old.height)/2;}paint();}
  };
  const changeFrameScale=value=>{frameScale=value;fitted=true;resize();frameScale=layout.frameScale;};
  const finishFrameResize=(cancel=false)=>{
    if(!frameDrag)return;const before=frameDrag.before,id=frameDrag.id;frameDrag=null;
    if(cancel){frameScale=before;fitted=true;resize();}else if(frameScale!==before)host.resizeFrame?.(frameScale);
    if(viewport.hasPointerCapture?.(id))viewport.releasePointerCapture(id);paint();
  };
  const frameResizeMove=event=>{
    if(!frameDrag||event.pointerId!==frameDrag.id)return;event.preventDefault();
    const dx=(event.clientX-frameDrag.x)*2/frameDrag.width,dy=(event.clientY-frameDrag.y)/frameDrag.height;
    changeFrameScale(frameDrag.scale*(1+(Math.abs(dx)>Math.abs(dy)?dx:dy)));
  };
  const frameResizeEnd=event=>{if(frameDrag?.id===event.pointerId)finishFrameResize(event.type==='pointercancel'||event.type==='lostpointercapture');};
  viewport.addEventListener('pointermove',frameResizeMove);viewport.addEventListener('pointerup',frameResizeEnd);viewport.addEventListener('pointercancel',frameResizeEnd);viewport.addEventListener('lostpointercapture',frameResizeEnd);
  const zoom=(factor,anchor=[layout.width/2,(layout.height-36)/2])=>{
    const scale=Math.max(layout.scale/2,Math.min(2.5,camera.scale*factor)),ratio=scale/camera.scale;
    camera={scale,x:anchor[0]-(anchor[0]-camera.x)*ratio,y:anchor[1]-(anchor[1]-camera.y)*ratio};fitted=false;paint();
  };
  const gesture=(data,inside=false)=>{
    if(disposed||!layout)return;
    if(data.action==='zoom'&&[data.delta,data.x,data.y].every(Number.isFinite)){
      const rect=viewport.getBoundingClientRect(),origin=inside?frame.getBoundingClientRect():rect;
      zoom(wheelZoomFactor(data.delta,1,data.mode),[origin.left-rect.left+data.x*(inside?pageScale:1),origin.top-rect.top+data.y*(inside?pageScale:1)]);
    }else if(data.action==='space'){space=data.value;paint();}
    else if(data.action==='pan'&&[data.dx,data.dy].every(Number.isFinite)){fitted=false;camera.x+=data.dx*(inside?pageScale:1);camera.y+=data.dy*(inside?pageScale:1);paint();}
    else if(data.action==='scroll'&&[data.dx,data.dy].every(Number.isFinite)){const unit=data.mode===1?16:data.mode===2?(window.innerHeight||800):1;viewport.closest('#document-view')?.scrollBy({left:data.dx*unit,top:data.dy*unit});}
  };
  const control=(text,label,action)=>{const button=document.createElement('button');button.type='button';button.textContent=text;button.title=label;button.setAttribute('aria-label',label);button.onclick=action;tools.append(button);return button;};
  const mountControls=()=>{
    tools=document.createElement('div');tools.className='doc-canvas-controls';tools.setAttribute('role','group');tools.setAttribute('aria-label','原型查看');
    const pan=control('拖动','拖动画布（再次点击退出）',()=>{hand=!hand;pan.setAttribute('aria-pressed',String(hand));paint();});pan.setAttribute('aria-pressed',String(hand));
    control('−','缩小',()=>zoom(1/1.25));zoomLabel=document.createElement('span');zoomLabel.className='doc-canvas-scale';tools.append(zoomLabel);
    control('+','放大',()=>zoom(1.25));control('适应','适应画布',fit);viewport.append(tools);
    const hint=document.createElement('span');hint.className='doc-canvas-hint';hint.textContent='空格拖动 · ⌘/Ctrl + 滚轮缩放';viewport.append(hint);
    const handle=document.createElement('button');handle.type='button';handle.className='doc-canvas-resize';handle.title='拖动等比调整画布外框大小';handle.setAttribute('aria-label',handle.title);
    handle.innerHTML='<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 11 11 3M7 11l4-4M11 11h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    handle.onpointerdown=event=>{
      if(disposed||frameDrag||event.button!==0||!layout)return;event.preventDefault();event.stopPropagation();
      frameDrag={id:event.pointerId,x:event.clientX,y:event.clientY,width:layout.width,height:layout.height,scale:layout.frameScale,before:frameScale};viewport.setPointerCapture(event.pointerId);paint();
    };
    handle.onkeydown=event=>{
      if(!['ArrowUp','ArrowLeft','ArrowDown','ArrowRight','Home'].includes(event.key))return;event.preventDefault();event.stopPropagation();
      const before=frameScale;changeFrameScale(event.key==='Home'?1:frameScale+(['ArrowUp','ArrowLeft'].includes(event.key)?-.05:.05));if(frameScale!==before)host.resizeFrame?.(frameScale);
    };
    viewport.append(handle);
  };
  const panDown=event=>{
    if(event.target.closest?.('.doc-canvas-controls,.doc-canvas-resize')||event.button!==0||!(hand||space))return;
    event.preventDefault();event.stopPropagation();drag={id:event.pointerId,x:event.clientX,y:event.clientY};viewport.setPointerCapture(event.pointerId);paint();
  };
  const panMove=event=>{if(!drag||drag.id!==event.pointerId)return;event.preventDefault();fitted=false;camera.x+=event.clientX-drag.x;camera.y+=event.clientY-drag.y;drag.x=event.clientX;drag.y=event.clientY;paint();};
  const panEnd=()=>{drag=null;paint();};
  viewport.addEventListener('pointerdown',panDown,true);viewport.addEventListener('pointermove',panMove);viewport.addEventListener('pointerup',panEnd);viewport.addEventListener('pointercancel',panEnd);
  const wheel=event=>{if(!(event.ctrlKey||event.metaKey))return;event.preventDefault();event.stopPropagation();const rect=viewport.getBoundingClientRect();zoom(wheelZoomFactor(event.deltaY,1,event.deltaMode),[event.clientX-rect.left,event.clientY-rect.top]);};
  viewport.addEventListener('wheel',wheel,{passive:false});
  const key=event=>{if(event.code!=='Space'||event.type==='keydown'&&event.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;space=event.type==='keydown';if(space&&viewport.matches(':hover'))event.preventDefault();paint();};
  const blur=()=>{space=false;drag=null;finishFrameResize(true);paint();};
  window.addEventListener('keydown',key);window.addEventListener('keyup',key);window.addEventListener('blur',blur);
  const navigate=id=>{if(disposed)return;const target=host.model().nodes.find(n=>n.id===id&&n.kind!=='note');if(target){node=target;render();}};
  // 扩展拥有长期绑定到本嵌入项的宿主；异步回调也不会跳到画布或其他预览。
  const extension=host.createExtension?.({
    getState:()=>({model:host.model(),n:node,current:node.id,frames:frame?{[node.id]:frame}:{},frame,pageScale,experience:true,mode:null}),
    openNode:navigate,measure:resize,renderOverlays:resize,renderInspector:()=>{},exitExperience:()=>navigate(initialNode.id)
  })??host.extension;
  const outgoing=()=>host.model().edges.filter(edge=>edge.from===node.id&&!edge.diagram);
  const scoped=fn=>host.scope?host.scope({n:node,current:node.id,frames:{[node.id]:frame},frame,pageScale,experience:true,model:host.model()},fn):fn();
  const follow=edges=>{const edge=eligibleEdges(edges,context)[0];if(!edge)return;if(scoped(()=>extension?.travel?.(edge)))return;context=nextContext(context,edge);navigate(edge.to);};
  const setFocus=rect=>{if(Array.isArray(rect)&&rect.length===4&&rect.every(Number.isFinite)&&rect[2]>0&&rect[3]>0){const changed=JSON.stringify(focusRect)!==JSON.stringify(rect);focusRect=rect;if(changed)fitted=true;resize();}};
  const componentBounds=()=>{
    if(node.id!==initialNode.id||!block.selector||!frame?.contentDocument)return;
    try{const target=frame.contentDocument.querySelector(block.selector);if(target){const rect=target.getBoundingClientRect();setFocus([rect.x+frame.contentWindow.scrollX,rect.y+frame.contentWindow.scrollY,rect.width,rect.height]);}else showComponentMessage();}catch{showComponentMessage();}
  };
  const showComponentMessage=()=>{let message=viewport.querySelector('.doc-component-message');if(!message){message=document.createElement('p');message.className='doc-component-message';message.textContent='组件暂时无法显示。';viewport.append(message);}};
  let componentObserver;
  function render(){
    unbindFrame?.();unbindFrame=null;frame=null;focusRect=null;fitted=true;camera=null;componentObserver?.disconnect();viewport.replaceChildren();stage=document.createElement('div');stage.className='doc-prototype-stage';viewport.append(stage);mountControls();
    if(node.kind==='image'){
      const image=document.createElement('img');image.alt=node.title;image.src=host.bundle().resources[node.id];image.style.width=node.width+'px';image.style.height=node.height+'px';stage.append(image);
      for(const edge of eligibleEdges(outgoing(),context))if(edge.rect){const control=document.createElement('button');control.className='doc-image-hotspot';control.setAttribute('aria-label',edge.label||'继续');const [x,y,w,h]=edge.rect;Object.assign(control.style,{left:x*100+'%',top:y*100+'%',width:w*100+'%',height:h*100+'%'});control.onclick=()=>follow([edge]);stage.append(control);}
      resize();return;
    }
    const html=expandHTML(host.bundle().resources[node.id]||'',host.bundle().fragments||{});
    frame=document.createElement('iframe');frame.title=node.title;frame.style.width=node.width+'px';frame.style.height=node.height+'px';frame.style.transformOrigin='0 0';
    if(extension?.declarative){frame.setAttribute('sandbox','allow-same-origin');frame.srcdoc=thumbnailHTML(html);}
    else{frame.setAttribute('sandbox','allow-scripts');frame.srcdoc=prototypeDocument(html,{token:bridgeToken,width:node.width,height:node.height,context,edges:outgoing().map(({id,selector})=>({id,selector})),annotations:[],documentCanvas:true,focusSelector:node.id===initialNode.id?block.selector:undefined});}
    const mountedFrame=frame;
    frame.onload=()=>{
      if(disposed||frame!==mountedFrame||!frame.isConnected)return;
      if(extension?.declarative){unbindFrame=bindDocumentCanvasGestures(frame.contentDocument,data=>gesture(data,true),{frame:true});scoped(()=>{extension.layout?.(frame.contentDocument,node);extension.mount?.(frame.contentDocument,node);});
        bindNativeDocument(frame.contentDocument,{getEdges:()=>scoped(()=>extension.outgoing?extension.outgoing(outgoing(),frame.contentDocument,node.id):outgoing()),follow,onInput:(event,type)=>scoped(()=>extension.nativeInput?.(event,type)),onKeyDown:event=>scoped(()=>extension.nativeKeyDown?.(event))});
        componentBounds();if(block.selector&&typeof MutationObserver!=='undefined'){componentObserver=new MutationObserver(componentBounds);componentObserver.observe(frame.contentDocument.body,{subtree:true,attributes:true,childList:true});}
      }
      resize();
    };
    stage.append(frame);resize();
  }
  const message=event=>{
    if(disposed||!frame||event.source!==frame.contentWindow||event.data?.yuanxing!==bridgeToken)return;
    const data=event.data;
    if(data.type==='document-canvas')gesture(data,true);
    if(data.type==='context')context={...context,...cleanContext(data.context)};
    if(data.type==='follow'&&Array.isArray(data.ids)){context={...context,...cleanContext(data.context)};follow(outgoing().filter(edge=>data.ids.includes(edge.id)));}
    if(data.type==='component-bounds'){if(data.missing)showComponentMessage();else setFocus(data.rect);}
  };
  window.addEventListener('message',message);
  const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(resize):null;window.addEventListener('resize',resize);
  const refresh=()=>queueMicrotask(()=>{if(disposed)return;observer?.disconnect();observer?.observe(viewport.parentElement||viewport);resize();});
  render();
  refresh();
  return {refresh,fit,zoom,updateBlock(next){block=next;const value=block.frameScale??1;if(value!==savedFrameScale){savedFrameScale=value;changeFrameScale(value);}},dispose(){finishFrameResize(true);disposed=true;unbindFrame?.();viewport.removeEventListener('pointermove',frameResizeMove);viewport.removeEventListener('pointerup',frameResizeEnd);viewport.removeEventListener('pointercancel',frameResizeEnd);viewport.removeEventListener('lostpointercapture',frameResizeEnd);viewport.removeEventListener('pointerdown',panDown,true);viewport.removeEventListener('pointermove',panMove);viewport.removeEventListener('pointerup',panEnd);viewport.removeEventListener('pointercancel',panEnd);viewport.removeEventListener('wheel',wheel);window.removeEventListener('keydown',key);window.removeEventListener('keyup',key);window.removeEventListener('blur',blur);observer?.disconnect();componentObserver?.disconnect();extension?.dispose?.();window.removeEventListener('message',message);window.removeEventListener('resize',resize);},isBusy(){if(frameDrag)return true;try{const doc=frame?.contentDocument;return document.activeElement===frame||!!doc?.activeElement?.matches('input,textarea,select,[contenteditable="true"]');}catch{return document.activeElement===frame;}}};
}
