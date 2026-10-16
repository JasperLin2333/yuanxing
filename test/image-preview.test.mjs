import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {eligibleEdges,nextContext} from '../runtime/core.mjs';

const source=await readFile(new URL('../runtime/app.mjs',import.meta.url),'utf8');
const controller=source.slice(source.indexOf('function renderImagePreview(){'),source.indexOf('function annotationTarget(){'));
const navigation=source.slice(source.indexOf('function travel(edge){'),source.indexOf('function prepareNote('));
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(current='home'){
  const elements=new Map(),listeners={};
  const element=()=>({style:{},children:[],open:false,scrollTop:0,scrollLeft:0,replaceChildren(){this.children=[];},append(child){this.children.push(child);},setAttribute(name,value){this[name]=value;},showModal(){this.open=true;},close(){this.open=false;},addEventListener(name,fn){listeners[name]=fn;}});
  const $=selector=>{if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);};
  const nodes=[{id:'home',module:'main',kind:'html'},{id:'other',module:'main',kind:'html'},...['first','second'].map(id=>({id,module:'images',kind:'image',title:id,path:id+'.png',width:800,height:1600}))];
  const page={input:'尚未发送的内容',scrollTop:420},state={$,clone,eligibleEdges,nextContext,current,experience:true,imagePreviewStack:[],flowContext:{role:'admin'},moduleId:'main',recycleOpen:false,cameras:{},camera:{},selected:{type:'node',id:current},mode:null,model:{nodes,edges:[],contextDefaults:{}},
    document:{createElement:element,addEventListener(name,fn){listeners[name]=fn;}},node:id=>nodes.find(n=>n.id===id),nodeResource:n=>'data:image/png;base64,'+n.id,outgoing:id=>state.model.edges.filter(edge=>edge.from===id),projectExtension:null,
    closeAnnotationEditor(){},activeCanvasNodes:()=>nodes.filter(n=>n.module==='main'),saveCanvasCamera(){},isBranch:()=>false,renderAll(){state.renders++;},renders:0,renderInspector(){},highlightCards(){},notice(){},exitExperience(){state.exited=true;},frames:{[current]:page}};
  const context=vm.createContext(state);vm.runInContext(controller+navigation,context);
  return {state,$,page,context,listeners};
}
test('不同来源页打开同一图片均可返回，来源页面保持挂载及输入、滚动状态',()=>{
  for(const origin of ['home','other']){
    const {state:s,$,page}=fixture(origin);s.openNode('first',true);
    assert.equal($('#image-preview-dialog').open,true);assert.equal(s.current,origin);assert.equal(s.moduleId,'main');assert.equal(s.renders,0);assert.equal(s.frames[origin],page);
    assert.equal($('#image-preview-stage').children[0].src,'data:image/png;base64,first');
    s.backFromImagePreview();assert.equal($('#image-preview-dialog').open,false);assert.equal(s.current,origin);assert.equal(s.renders,0);assert.equal(s.frames[origin],page);assert.equal(page.input,'尚未发送的内容');assert.equal(page.scrollTop,420);
  }
});
test('图片热点支持连续跳转、分支过滤和逐层返回，恢复每层流程上下文及滚动位置',()=>{
  const {state:s,$}=fixture();s.model.edges=[
    {id:'next',from:'first',to:'second',rect:[.1,.2,.3,.4],imagePath:'first.png',setContext:{step:'second'}},
    {id:'old',from:'first',to:'home',rect:[0,0,1,1],imagePath:'old.png'},
    {id:'hidden',from:'first',to:'home',rect:[0,0,1,1],when:{role:'member'}}
  ];
  s.travel({to:'first',setContext:{step:'first'}});let children=$('#image-preview-stage').children;assert.equal(children.length,2);assert.equal(children[1].style.left,'10%');
  $('#image-preview-viewport').scrollTop=320;children[1].onclick();assert.equal($('#image-preview-title').textContent,'second');assert.equal(s.flowContext.step,'second');assert.equal(s.current,'home');
  s.backFromImagePreview();assert.equal($('#image-preview-title').textContent,'first');assert.equal($('#image-preview-viewport').scrollTop,320);assert.equal(s.flowContext.step,'first');
  s.backFromImagePreview();assert.equal($('#image-preview-dialog').open,false);assert.deepEqual(clone(s.flowContext),{role:'admin'});assert.equal(s.renders,0);
});
test('图片热点返回来源页时复用页面，指向其他页面时继续导航并清空预览',()=>{
  const {state:s,$}=fixture();s.openNode('first',true);s.openNode('home',true);assert.equal(s.current,'home');assert.equal(s.renders,0);assert.equal($('#image-preview-dialog').open,false);
  s.openNode('first',true);s.openNode('other',true);assert.equal(s.current,'other');assert.equal(s.renders,1);assert.equal(s.imagePreviewStack.length,0);assert.equal($('#image-preview-dialog').open,false);
});
test('画布预览及以图片为产品入口仍能正常打开页面',()=>{
  const {state:s,$}=fixture();s.experience=false;s.openNode('first');assert.equal(s.current,'first');assert.equal(s.renders,1);assert.equal($('#image-preview-dialog').open,false);
  s.experience=true;s.openNode('second',true,{asPage:true});assert.equal(s.current,'second');assert.equal(s.renders,2);assert.equal($('#image-preview-dialog').open,false);
});
test('Esc 先返回图片，后退出完整原型；图片上的分支选择优先处理 Esc',()=>{
  const {state:s,$,context,listeners}=fixture();
  const start=source.indexOf("$('#image-preview-dialog').addEventListener('cancel'"),end=source.indexOf("window.addEventListener('beforeunload'",start);assert(end>start);
  vm.runInContext(source.slice(start,end),context);
  const key=()=>({key:'Escape',defaultPrevented:false,target:{closest:()=>null},preventDefault(){this.defaultPrevented=true;}});
  s.openNode('first',true);listeners.keydown(key());assert.equal($('#image-preview-dialog').open,false);assert.equal(s.exited,undefined);
  listeners.keydown(key());assert.equal(s.exited,true);s.exited=false;
  s.openNode('first',true);$('#branch-dialog').open=true;
  Object.assign(s,{readonly:true,closeMenus(){},cancelConnection:null,renderOverlays(){}});
  const event=key();listeners.keydown(event);assert.equal(event.defaultPrevented,false);assert.equal($('#image-preview-dialog').open,true);assert.equal(s.exited,false);
  $('#branch-dialog').open=false;listeners.cancel(event);assert.equal($('#image-preview-dialog').open,false);assert.equal(event.defaultPrevented,true);
});
