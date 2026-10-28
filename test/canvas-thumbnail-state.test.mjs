import test from 'node:test';
import assert from 'node:assert/strict';
import {initialNodeContext} from '../runtime/core.mjs';
import {initializeCanvasThumbnail} from '../runtime/library.mjs';

function fixture(){
  const name={dataset:{yxBind:'name'},value:'原值'},unchanged={dataset:{yxBind:'absent'},value:'保留'},checkbox={dataset:{yxBind:'agree'},type:'checkbox',checked:false},radioA={dataset:{yxBind:'role'},type:'radio',value:'admin',checked:false},radioB={dataset:{yxBind:'role'},type:'radio',value:'member',checked:true};
  const initial={dataset:{yxInitialVisible:'dialog',yxValue:'open'},hidden:true},visible={dataset:{yxVisible:'role',yxValue:'admin'},hidden:true},text={dataset:{yxText:'name'},textContent:''};
  const groups={'[data-yx-bind]':[name,unchanged,checkbox,radioA,radioB],'[data-yx-initial-visible]':[initial],'[data-yx-visible]':[visible],'[data-yx-text]':[text]};
  return {name,unchanged,checkbox,radioA,radioB,initial,visible,text,doc:{querySelectorAll:selector=>groups[selector]||[]}};
}
test('同一页面的缩略图按节点初值显示对应状态，同时保留未绑定字段',()=>{
  const defaults={name:'默认客户',role:'member',agree:false,dialog:'closed'},first=fixture(),second=fixture();
  initializeCanvasThumbnail(first.doc,initialNodeContext(defaults,{initialContext:{name:'顾客甲',role:'admin',agree:true,dialog:'open'}}));
  initializeCanvasThumbnail(second.doc,initialNodeContext(defaults,{}));
  assert.equal(first.name.value,'顾客甲');assert.equal(first.unchanged.value,'保留');assert.equal(first.checkbox.checked,true);assert.equal(first.radioA.checked,true);assert.equal(first.radioB.checked,false);assert.equal(first.initial.hidden,false);assert.equal(first.visible.hidden,false);assert.equal(first.text.textContent,'顾客甲');
  assert.equal(second.name.value,'默认客户');assert.equal(second.checkbox.checked,false);assert.equal(second.radioA.checked,false);assert.equal(second.radioB.checked,true);assert.equal(second.initial.hidden,true);assert.equal(second.visible.hidden,true);assert.equal(second.text.textContent,'默认客户');
  assert.deepEqual(defaults,{name:'默认客户',role:'member',agree:false,dialog:'closed'});
});

test('仅画布缩略图加载时执行静态初始化，打开页面交给原播放器',async()=>{
  const {readFile}=await import('node:fs/promises'),{default:vm}=await import('node:vm');
  const source=await readFile(new URL('../runtime/app.mjs',import.meta.url),'utf8'),code=source.slice(source.indexOf('function frameFor('),source.indexOf('function canvas(){'));
  const calls=[],state={model:{contextDefaults:{name:'默认'}},bundle:{resources:{one:'<main></main>'},fragments:{}},experience:false,devMode:false,projectExtension:null,frames:{},flowContext:{},uid:()=> 'token',thumbnailLayout:()=>({scale:.4,left:0,top:0}),canvasNodeWidth:()=>400,canvasNodeHeight:()=>300,expandHTML:x=>x,thumbnailHTML:x=>x,prototypeDocument:x=>x,initialNodeContext,initializeCanvasThumbnail:(doc,context)=>calls.push([doc,context]),measure(){},outgoing:()=>[],document:{createElement:()=>({style:{},dataset:{},contentDocument:{},isConnected:true,setAttribute(){}})}};
  vm.runInContext(code,vm.createContext(state));const node={id:'one',kind:'html',title:'页面',width:1000,height:800,initialContext:{name:'节点'}};
  const makeContainer=thumbnail=>({classList:{contains:()=>thumbnail},append(frame){this.frame=frame;}}),thumb=makeContainer(true),viewer=makeContainer(false);
  state.frameFor(node,thumb,1);thumb.frame.onload();assert.equal(calls.length,1);assert.equal(calls[0][0],thumb.frame.contentDocument);assert.equal(calls[0][1].name,'节点');
  state.model.annotations=[];state.frameFor(node,viewer,1);viewer.frame.onload();assert.equal(calls.length,1);
});
