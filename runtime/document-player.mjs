import {prototypeDocument,thumbnailHTML,bindNativeDocument,cleanContext} from './player.mjs';
import {expandHTML,eligibleEdges,nextContext} from './core.mjs';

export function documentPrototypeLayout(node,availableWidth,rect,height) {
  const width=rect?rect[2]+24:node.width,fullHeight=rect?rect[3]+24:node.height;
  const scale=Math.min(1,Math.max(.05,(availableWidth-2)/width));
  return {scale,width:width*scale,height:Math.max(120,height??fullHeight*scale),contentHeight:fullHeight*scale,left:rect?(-rect[0]+12)*scale:0,top:rect?(-rect[1]+12)*scale:0};
}
// 每个文档嵌入项拥有自己的播放上下文，翻页和输入不会改写文档或其他嵌入项。
export function mountDocumentPrototype(host, initialNode, viewport, block) {
  let node=initialNode,context={...host.model().contextDefaults},frame,stage,focusRect,disposed=false;
  const extension=host.extension,bridgeToken=globalThis.crypto.randomUUID();
  const resize=()=>{
    if(!stage||!viewport.isConnected)return;
    const layout=documentPrototypeLayout(node,viewport.clientWidth,focusRect,block.height);
    stage.style.width=layout.width+'px';stage.style.height=layout.contentHeight+'px';viewport.style.height=(layout.height+2)+'px';
    const content=stage.firstElementChild;if(content){content.style.transform=`scale(${layout.scale})`;content.style.left=layout.left+'px';content.style.top=layout.top+'px';}
  };
  const outgoing=()=>host.model().edges.filter(edge=>edge.from===node.id&&!edge.diagram);
  const scoped=fn=>host.scope?host.scope({n:node,current:node.id,frames:{[node.id]:frame},frame,experience:true,model:host.model()},fn):fn();
  const follow=edges=>{const edge=eligibleEdges(edges,context)[0];if(!edge)return;context=nextContext(context,edge);const target=host.model().nodes.find(n=>n.id===edge.to&&n.kind!=='note');if(target){node=target;render();}};
  const setFocus=rect=>{if(Array.isArray(rect)&&rect.length===4&&rect.every(Number.isFinite)&&rect[2]>0&&rect[3]>0){focusRect=rect;resize();}};
  const componentBounds=()=>{
    if(node.id!==initialNode.id||!block.selector||!frame?.contentDocument)return;
    try{const target=frame.contentDocument.querySelector(block.selector);if(target){const rect=target.getBoundingClientRect();setFocus([rect.x+frame.contentWindow.scrollX,rect.y+frame.contentWindow.scrollY,rect.width,rect.height]);}else showComponentMessage();}catch{showComponentMessage();}
  };
  const showComponentMessage=()=>{let message=viewport.querySelector('.doc-component-message');if(!message){message=document.createElement('p');message.className='doc-component-message';message.textContent='组件暂时无法显示。';viewport.append(message);}};
  let componentObserver;
  function render(){
    frame=null;focusRect=null;componentObserver?.disconnect();viewport.replaceChildren();stage=document.createElement('div');stage.className='doc-prototype-stage';viewport.append(stage);
    if(node.kind==='image'){
      const image=document.createElement('img');image.alt=node.title;image.src=host.bundle().resources[node.id];image.style.width=node.width+'px';image.style.height=node.height+'px';stage.append(image);
      for(const edge of eligibleEdges(outgoing(),context))if(edge.rect){const control=document.createElement('button');control.className='doc-image-hotspot';control.setAttribute('aria-label',edge.label||'继续');const [x,y,w,h]=edge.rect;Object.assign(control.style,{left:x*100+'%',top:y*100+'%',width:w*100+'%',height:h*100+'%'});control.onclick=()=>follow([edge]);stage.append(control);}
      resize();return;
    }
    const html=expandHTML(host.bundle().resources[node.id]||'',host.bundle().fragments||{});
    frame=document.createElement('iframe');frame.title=node.title;frame.style.width=node.width+'px';frame.style.height=node.height+'px';frame.style.transformOrigin='0 0';
    if(extension?.declarative){frame.setAttribute('sandbox','allow-same-origin');frame.srcdoc=thumbnailHTML(html);}
    else{frame.setAttribute('sandbox','allow-scripts');frame.srcdoc=prototypeDocument(html,{token:bridgeToken,width:node.width,height:node.height,context,edges:outgoing().map(({id,selector})=>({id,selector})),annotations:[],focusSelector:node.id===initialNode.id?block.selector:undefined});}
    frame.onload=()=>{
      if(disposed||!frame.isConnected)return;
      if(extension?.declarative){scoped(()=>{extension.layout?.(frame.contentDocument,node);extension.mount?.(frame.contentDocument,node);});
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
    if(data.type==='context')context={...context,...cleanContext(data.context)};
    if(data.type==='follow'&&Array.isArray(data.ids)){context={...context,...cleanContext(data.context)};follow(outgoing().filter(edge=>data.ids.includes(edge.id)));}
    if(data.type==='component-bounds'){if(data.missing)showComponentMessage();else setFocus(data.rect);}
  };
  window.addEventListener('message',message);
  const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(resize):null;observer?.observe(viewport);
  render();
  return {dispose(){disposed=true;observer?.disconnect();componentObserver?.disconnect();window.removeEventListener('message',message);},isBusy(){try{const doc=frame?.contentDocument;return document.activeElement===frame||!!doc?.activeElement?.matches('input,textarea,select,[contenteditable="true"]');}catch{return document.activeElement===frame;}}};
}
