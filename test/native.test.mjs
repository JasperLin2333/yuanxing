import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import vm from 'node:vm';
import {bindNativeDocument} from '../runtime/player.mjs';
function fixture(){
  const listeners={},followed=[],inputs=[];let edges=[];
  const doc={addEventListener:(name,handler)=>listeners[name]=handler};
  bindNativeDocument(doc,{getEdges:()=>edges,follow:value=>followed.push(value),onInput:(event,type)=>inputs.push([event.target,type])});
  return {listeners,followed,inputs,setEdges:value=>edges=value};
}
test('原生点击命中实际控件，动态菜单不依赖过期的热点坐标；内层操作不会触发父行',()=>{
  const f=fixture(),row={contains:other=>other===button,closest:()=>null},button={contains:other=>other===button,closest:()=>null},target={closest:s=>s==='#remove'?button:s==='#row'?row:null};let prevented=0;
  f.setEdges([{id:'row',selector:'#row'},{id:'delete',selector:'#remove'}]);f.listeners.click({target,preventDefault(){prevented++;}});assert.deepEqual(f.followed[0].map(e=>e.id),['delete']);assert.equal(prevented,1);
  f.setEdges([{id:'new-menu',selector:'#remove'},{id:'other-role',selector:'#remove'}]);f.listeners.click({target,preventDefault(){}});assert.deepEqual(f.followed[1].map(e=>e.id),['new-menu','other-role']);
});
test('未绑定输入保留原生行为；禁用控件不跳转；表单校验失败时不提交',()=>{
  const f=fixture();let prevented=0,reported=0;const field={closest:()=>null};f.listeners.click({target:field,preventDefault(){prevented++;}});f.listeners.input({target:field});f.listeners.change({target:field});assert.equal(prevented,0);assert.deepEqual(f.inputs,[[field,'input'],[field,'change']]);
  const button={disabled:true,closest:()=>null,contains:()=>true};f.setEdges([{id:'submit',selector:'#submit'}]);f.listeners.click({target:{closest:()=>button},preventDefault(){}});assert.equal(f.followed.length,0);
  button.disabled=false;button.type='submit';button.closest=()=>({checkValidity:()=>false,reportValidity(){reported++;}});f.listeners.click({target:{closest:()=>button},preventDefault(){prevented++;}});assert.equal(reported,1);assert.equal(f.followed.length,0);
});
test('完整原型跳过外层热点与替身表单，评审仍保留原有打点机制',async()=>{
  const source=await fs.readFile(new URL('../runtime/app.mjs',import.meta.url),'utf8'),controller=source.slice(source.indexOf('function renderOverlays(){'),source.indexOf('function renderPageHotspots('));let removed=0,overlays=0;
  const stage={querySelectorAll:()=>[{remove(){removed++;}}]},state={devMode:false,updateAnnotationButton(){},current:'home',node:()=>({kind:'html'}),$:()=>stage,experience:true,projectExtension:{declarative:true,nativeInteraction:true,renderOverlays(){overlays++;}},frames:{},mode:null,pageScale:.65};
  vm.runInContext(controller,vm.createContext(state));state.renderOverlays();assert.equal(removed,1);assert.equal(overlays,0);
});

test('打开节点时真实控件不被代理层覆盖，批注和打点仍可用',async()=>{
  const source=await fs.readFile(new URL('../runtime/app.mjs',import.meta.url),'utf8'),controller=source.slice(source.indexOf('function renderOverlays(){'),source.indexOf('function renderPageHotspots('));
  let projectOverlays=0,removed=0,positioned=0;const appended=[];
  const stage={clientHeight:800,querySelectorAll:()=>[{remove(){removed++;}}],append:el=>appended.push(el)};
  const document={createElement:()=>({style:{},dataset:{},setAttribute(){}})};
  const state={document,devMode:false,updateAnnotationButton(){},current:'form',node:()=>({kind:'html'}),$:()=>stage,experience:false,projectExtension:{declarative:true,nativeInteraction:true,nodeNativeInteraction:true,renderOverlays(){projectOverlays++;}},frames:{},mode:'annotate',pageScale:1,model:{annotations:[{id:'a',node:'form',point:[.4,.5]}]},positions:{},missing:new Set(),readonly:false,selected:null,capturePoint(){},positionAnnotationEditor(){positioned++;}};
  vm.runInContext(controller,vm.createContext(state));state.renderOverlays();
  assert.equal(removed,1);assert.equal(projectOverlays,0);assert.equal(appended.length,2);assert.match(appended[0].className,/pin/);assert.equal(appended[1].className,'capture');assert.equal(positioned,1);
});
test('旧声明式扩展未声明节点原生交互时仍使用原来的代理层',async()=>{
  const source=await fs.readFile(new URL('../runtime/app.mjs',import.meta.url),'utf8'),controller=source.slice(source.indexOf('function renderOverlays(){'),source.indexOf('function renderPageHotspots('));
  let overlays=0;const stage={querySelectorAll:()=>[],append(){}},state={devMode:false,updateAnnotationButton(){},current:'home',node:()=>({kind:'html'}),$:()=>stage,experience:false,projectExtension:{declarative:true,nativeInteraction:true,renderOverlays(){overlays++;}},frames:{},mode:null,pageScale:1,model:{annotations:[]},positionAnnotationEditor(){}};
  vm.runInContext(controller,vm.createContext(state));state.renderOverlays();assert.equal(overlays,1);
});
