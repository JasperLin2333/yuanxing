import test from 'node:test';
import assert from 'node:assert/strict';
import {documentPrototypeLayout,constrainDocumentCamera,mountDocumentPrototype} from '../runtime/document-player.mjs';
import {bindDocumentCanvasGestures,prototypeDocument} from '../runtime/player.mjs';
import vm from 'node:vm';
import {createDocumentView,validateDocument} from '../runtime/document.mjs';

// 只模拟挂载接口与事件分发，不启动浏览器。
function environment(t){
  const listeners=new Map(),cleanups=[],originals={document:globalThis.document,window:globalThis.window,ResizeObserver:globalThis.ResizeObserver};
  const emitter=()=>{const handlers=new Map();return {addEventListener(type,fn){if(!handlers.has(type))handlers.set(type,new Set());handlers.get(type).add(fn);},removeEventListener(type,fn){handlers.get(type)?.delete(fn);},dispatch(type,data={}){let stopped=false;const event={target:this,preventDefault(){this.prevented=true;},stopPropagation(){},stopImmediatePropagation(){stopped=true;},...data,type};for(const fn of handlers.get(type)||[]){fn(event);if(stopped)break;}return event;}};};
  const element=tag=>({...emitter(),
    classList:{toggle(){}},closest(){return null;},matches(){return false;},getBoundingClientRect(){return {left:0,top:0};},setPointerCapture(){},tagName:tag.toUpperCase(),style:{},dataset:{},children:[],attrs:{},isConnected:true,clientWidth:1400,
    append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}},
    replaceChildren(){for(const child of this.children)child.isConnected=false;this.children=[];},
    get firstElementChild(){return this.children[0];},
    setAttribute(key,value){this.attrs[key]=value;},querySelector(){return null;},querySelectorAll(){return [];},
    ...(tag==='iframe'?{contentWindow:{scrollX:0,scrollY:0},contentDocument:{}}:{})
  });
  globalThis.document={createElement:element};
  globalThis.window={innerHeight:800,
    addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},
    removeEventListener(name,fn){listeners.get(name)?.delete(fn);}
  };
  globalThis.ResizeObserver=undefined;
  t.after(()=>{for(const cleanup of cleanups)cleanup();for(const [key,value] of Object.entries(originals)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  return {viewport(){const parent=element('article'),viewport=element('div');parent.append(viewport);return viewport;},
    message(event){for(const fn of listeners.get('message')||[])fn(event);},cleanup:fn=>cleanups.push(fn)};
}
const model=()=>({nodes:[{id:'one',title:'页面一',kind:'html',width:1280,height:800},{id:'two',title:'页面二',kind:'html',width:1280,height:800}],edges:[{id:'next',from:'one',to:'two',selector:'#next'}],contextDefaults:{role:'admin'}});
function frameOf(viewport){return viewport.firstElementChild.firstElementChild;}
function loadFrame(frame){
  const listeners={};frame.contentDocument={addEventListener(name,fn){const previous=listeners[name];listeners[name]=previous?event=>{previous(event);fn(event);}:fn;},removeEventListener(){}};frame.onload();
  return {listeners,click(selector){const control={contains:other=>other===control,closest:()=>null};listeners.click({target:{closest:value=>value===selector?control:null},preventDefault(){}});}};
}

test('长图完整适应有边界画布，缩放复位只变换原内容，热点位置不变',t=>{
  const env=environment(t),viewport=env.viewport(),m=model();m.nodes[0]={...m.nodes[0],kind:'image',width:1258,height:1148};m.edges[0].rect=[.315,.882,.213,.06];
  const mounted=mountDocumentPrototype({model:()=>m,bundle:()=>({resources:{one:'agreement.png',two:'<main>结果</main>'}})},m.nodes[0],viewport,{});env.cleanup(()=>mounted.dispose());
  const stage=viewport.firstElementChild,image=stage.firstElementChild,hotspot=stage.children[1],size=[viewport.style.width,viewport.style.height],initial=stage.style.transform;
  assert.equal(parseFloat(stage.style.width),1258);assert.equal(parseFloat(viewport.style.height),562);
  const layout=documentPrototypeLayout(m.nodes[0],1400);assert(layout.scale*1148<=layout.height-52);assert(layout.scale*1258<layout.width);
  assert.equal(hotspot.style.top,'88.2%');assert.equal(hotspot.style.left,'31.5%');
  mounted.zoom(2);assert.notEqual(stage.style.transform,initial);assert.deepEqual([viewport.style.width,viewport.style.height],size);assert.equal(frameOf(viewport),image);
  mounted.fit();assert.equal(stage.style.transform,initial);assert.equal(frameOf(viewport),image);
  const narrow=documentPrototypeLayout(m.nodes[0],402);assert(narrow.width<=400);assert(narrow.height<=560);
});

test('拖动与缩放都有边界，适应后完整可见且不落入控制栏',()=>{
  const layout=documentPrototypeLayout({width:1280,height:800},642),fit=constrainDocumentCamera({scale:layout.scale,x:0,y:0},layout);
  assert(fit.x>=16);assert(fit.y>=8);assert(fit.y+800*fit.scale<=layout.height-36);
  const far=constrainDocumentCamera({scale:100,x:-1e6,y:1e6},layout);assert.equal(far.scale,2.5);assert(far.x+1280*far.scale>=layout.width-16);assert.equal(far.y,16);
  assert.equal(constrainDocumentCamera({scale:0,x:0,y:0},layout).scale,layout.scale/2);
});

test('项目局部操作交给自己的播放器，输入和尺寸切换不重建 iframe',t=>{
  const env=environment(t),viewport=env.viewport(),m=model(),travelled=[],inputs=[];let api;
  const mounted=mountDocumentPrototype({model:()=>m,bundle:()=>({resources:{one:'<input><button>选择</button>'}}),createExtension:host=>{
    api=host;return {declarative:true,outgoing:()=>[{id:'local',from:'one',to:'one',selector:'#local',prototypeAction:true}],travel(edge){travelled.push(edge);return true;},nativeInput(event,type){inputs.push([event.target.value,type,host.getState().current]);}};
  }},m.nodes[0],viewport,{});env.cleanup(()=>mounted.dispose());
  const frame=frameOf(viewport),doc=loadFrame(frame);frame.contentDocument.draft='保留输入';doc.click('#local');
  assert.equal(travelled.length,1);assert(travelled[0].prototypeAction);assert.equal(frameOf(viewport),frame);
  doc.listeners.input({target:{value:'填写内容'}});assert.deepEqual(inputs,[['填写内容','input','one']]);
  mounted.zoom(1.25);mounted.fit();assert.equal(frameOf(viewport),frame);assert.equal(frame.contentDocument.draft,'保留输入');assert.equal(api.getState().frame,frame);
  doc.click('#next');assert.equal(frameOf(viewport),frame,'扩展只暴露的局部操作不会误触全局跳转');
});

test('每个嵌入项独立创建扩展，普通跳转与异步回调留在原嵌入项',async t=>{
  const env=environment(t),first=env.viewport(),second=env.viewport(),m=model(),apis=[];
  const host={model:()=>m,bundle:()=>({resources:{one:'<button>下一页</button>',two:'<input>'}}),createExtension:api=>{apis.push(api);return {declarative:true};}};
  const a=mountDocumentPrototype(host,m.nodes[0],first,{}),b=mountDocumentPrototype(host,m.nodes[0],second,{});env.cleanup(()=>{a.dispose();b.dispose();});
  const beforeSecond=frameOf(second);loadFrame(frameOf(first)).click('#next');assert.equal(apis[0].getState().current,'two');assert.equal(apis[1].getState().current,'one');assert.equal(frameOf(second),beforeSecond);
  await Promise.resolve();apis[1].openNode('two');assert.equal(apis[1].getState().current,'two');assert.equal(apis[1].getState().frames.two,frameOf(second));assert.equal(apis[0].getState().current,'two');
  a.dispose();const last=frameOf(first);apis[0].openNode('one');assert.equal(frameOf(first),last,'销毁后的回调不再挂载页面');
});

test('截图热点也调用项目操作，旧 iframe 的加载和消息不改变当前页',t=>{
  const env=environment(t),viewport=env.viewport(),m=model(),handled=[];m.nodes.unshift({id:'agreement',title:'协议',kind:'image',width:1258,height:1148});m.edges.push({id:'agree',from:'agreement',to:'one',rect:[.3,.8,.2,.1],agreementAction:'agree'});let api;
  const mounted=mountDocumentPrototype({model:()=>m,bundle:()=>({resources:{one:'<input>',two:'<input>'}}),createExtension:host=>{
    api=host;return {declarative:true,travel(edge){if(!edge.agreementAction)return false;handled.push(edge.agreementAction);host.openNode(edge.to);return true;}};
  }},m.nodes[0],viewport,{});env.cleanup(()=>mounted.dispose());
  viewport.firstElementChild.children[1].onclick();assert.deepEqual(handled,['agree']);assert.equal(api.getState().current,'one');
  const old=frameOf(viewport);api.openNode('two');old.onload();assert.equal(api.getState().current,'two');
  env.message({source:old.contentWindow,data:{type:'follow',ids:['next']}});assert.equal(api.getState().current,'two');
});

test('隔离页面注入相同手势绑定，普通滚轮保留内部列表并续接外层文档',()=>{
  const handlers=new Map(),messages=[],win={addEventListener(){},removeEventListener(){},getComputedStyle:()=>({overflowY:'auto',overflowX:'hidden'})};
  const doc={defaultView:win,addEventListener(name,fn){if(!handlers.has(name))handlers.set(name,[]);handlers.get(name).push(fn);},removeEventListener(name,fn){handlers.set(name,handlers.get(name).filter(item=>item!==fn));}};
  const dispose=bindDocumentCanvasGestures(doc,data=>messages.push(data),{frame:true});
  const list={nodeType:1,scrollHeight:500,clientHeight:100,scrollTop:50,scrollWidth:100,clientWidth:100,parentElement:null};
  const wheel=(extra={})=>{const event={target:list,deltaX:0,deltaY:40,deltaMode:0,preventDefault(){this.prevented=true;},stopImmediatePropagation(){},...extra};handlers.get('wheel')[0](event);return event;};
  assert(!wheel().prevented);assert.equal(messages.length,0);
  list.scrollTop=400;assert(wheel().prevented);assert.equal(messages.at(-1).action,'scroll');
  assert(wheel({ctrlKey:true,clientX:30,clientY:40}).prevented);assert.equal(messages.at(-1).action,'zoom');
  dispose();assert.equal(handlers.get('wheel').length,0);
  const html=prototypeDocument('<body><input></body>',{token:'token',width:1280,height:800,context:{},edges:[],annotations:[],documentCanvas:true});
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];assert.equal(scripts.length,2);for(const script of scripts)new vm.Script(script[1]);
  assert(html.includes("type:'document-canvas'"));
});

test('查看区拖动和缩放不改变文档尺寸，普通滚轮保持默认行为，销毁移除手势',t=>{
  const env=environment(t),viewport=env.viewport(),m=model();m.nodes[0].kind='image';
  const mounted=mountDocumentPrototype({model:()=>m,bundle:()=>({resources:{one:'page.png'}})},m.nodes[0],viewport,{});env.cleanup(()=>mounted.dispose());
  const stage=viewport.firstElementChild,size=[viewport.style.width,viewport.style.height];mounted.zoom(2);
  const tools=viewport.children[1];tools.children[0].onclick();
  viewport.dispatch('pointerdown',{button:0,pointerId:1,clientX:300,clientY:300});const before=stage.style.transform;
  viewport.dispatch('pointermove',{pointerId:1,clientX:230,clientY:260});assert.notEqual(stage.style.transform,before);viewport.dispatch('pointerup');
  assert.deepEqual([viewport.style.width,viewport.style.height],size);assert(!viewport.dispatch('wheel',{deltaY:30}).prevented);
  assert(viewport.dispatch('wheel',{ctrlKey:true,deltaY:-100,clientX:200,clientY:100}).prevented);
  const last=stage.style.transform;mounted.dispose();viewport.dispatch('wheel',{ctrlKey:true,deltaY:-100});assert.equal(stage.style.transform,last);
});

const resizeHandle=viewport=>viewport.children.find(child=>child.className==='doc-canvas-resize');
function startResize(viewport,id=9){resizeHandle(viewport).onpointerdown({button:0,pointerId:id,clientX:800,clientY:600,preventDefault(){},stopPropagation(){}});}

test('外框可等比缩为二分之一或三分之一，内容适应新空间且比例保持一致',()=>{
  const node={width:1280,height:800},full=documentPrototypeLayout(node,1400);
  for(const frameScale of [.5,1/3]){
    const resized=documentPrototypeLayout(node,1400,null,undefined,{frameScale});
    assert.equal(resized.width,full.width*frameScale);assert.equal(resized.height,full.height*frameScale);
    assert(resized.scale*node.width<=resized.width-32);assert(resized.scale*node.height<=resized.height-52);
  }
  const narrow=documentPrototypeLayout(node,360,null,undefined,{frameScale:2});assert(narrow.width<=358);assert(narrow.height>=120);
  const tiny=documentPrototypeLayout(node,1400,null,undefined,{frameScale:.001});assert(tiny.width>=240);assert(tiny.height>=120);
});

test('拖动外框缩小实际文档占位，松手后保存一次，原 iframe 和输入保持不变',t=>{
  const env=environment(t),viewport=env.viewport(),m=model(),saved=[];
  const mounted=mountDocumentPrototype({model:()=>m,bundle:()=>({resources:{one:'<input>'}}),resizeFrame:value=>saved.push(value)},m.nodes[0],viewport,{});env.cleanup(()=>mounted.dispose());
  const frame=frameOf(viewport),width=parseFloat(viewport.style.width)-2,height=parseFloat(viewport.style.height)-2;frame.contentDocument.draft='已填写内容';
  startResize(viewport);assert(mounted.isBusy());viewport.dispatch('pointermove',{pointerId:9,clientX:800,clientY:600-height/2});
  assert.equal(parseFloat(viewport.style.width)-2,width/2);assert.equal(parseFloat(viewport.style.height)-2,height/2);assert.deepEqual(saved,[]);
  viewport.dispatch('pointerup',{pointerId:9});assert.deepEqual(saved,[.5]);assert(!mounted.isBusy());
  mounted.updateBlock({frameScale:.5});assert.equal(frameOf(viewport),frame);assert.equal(frame.contentDocument.draft,'已填写内容');
  mounted.updateBlock({frameScale:1/3});assert.equal(parseFloat(viewport.style.height)-2,height/3);assert.equal(frameOf(viewport),frame);
  resizeHandle(viewport).onkeydown({key:'Home',preventDefault(){},stopPropagation(){}});assert.equal(parseFloat(viewport.style.height)-2,height);assert.equal(saved.at(-1),1);
});

test('取消外框调整恢复原尺寸，独立预览及只读原文保持不变',t=>{
  const env=environment(t),first=env.viewport(),second=env.viewport(),m=model(),block={},before=JSON.stringify(m);
  const host={model:()=>m,bundle:()=>({resources:{one:'<input>'}})},a=mountDocumentPrototype(host,m.nodes[0],first,block),b=mountDocumentPrototype(host,m.nodes[0],second,{});env.cleanup(()=>{a.dispose();b.dispose();});
  const size=[first.style.width,first.style.height];startResize(first);first.dispatch('pointermove',{pointerId:9,clientX:800,clientY:450});
  assert.notDeepEqual([first.style.width,first.style.height],size);assert.deepEqual([second.style.width,second.style.height],size);
  first.dispatch('pointercancel',{pointerId:9});assert.deepEqual([first.style.width,first.style.height],size);assert.deepEqual(block,{});assert.equal(JSON.stringify(m),before);
  startResize(first);first.dispatch('pointermove',{pointerId:9,clientX:800,clientY:450});first.dispatch('pointerup',{pointerId:9});assert.notEqual(first.style.height,size[1]);assert.deepEqual(block,{});
});

test('文档保存外框比例并复用缓存，重绘和撤销都不重建原型',t=>{
  const env=environment(t),root=env.viewport(),m=model();m.document={version:1,blocks:[{id:'preview',type:'prototype',node:'one'}]};
  let viewport,mounts=0,saves=0;const bundle={resources:{one:'<input>'}};
  const view=createDocumentView({root,model:()=>m,bundle:()=>bundle,changeText:fn=>{fn(m);saves++;},mountPrototype(node,target,block,options){mounts++;viewport=target;return mountDocumentPrototype({model:()=>m,bundle:()=>bundle,...options},node,target,block);}});env.cleanup(()=>view.leave());view.enter();
  const frame=frameOf(viewport),height=parseFloat(viewport.style.height)-2;startResize(viewport);viewport.dispatch('pointermove',{pointerId:9,clientX:800,clientY:600-height/2});viewport.dispatch('pointerup',{pointerId:9});
  assert.equal(m.document.blocks[0].frameScale,.5);assert.equal(saves,1);assert.deepEqual(validateDocument(m),[]);view.render();assert.equal(mounts,1);assert.equal(frameOf(viewport),frame);
  delete m.document.blocks[0].frameScale;view.render();assert.equal(mounts,1);assert.equal(parseFloat(viewport.style.height)-2,height);assert.equal(frameOf(viewport),frame);
  m.document.blocks[0].frameScale=NaN;assert(validateDocument(m).some(error=>error.includes('外框比例')));
});
