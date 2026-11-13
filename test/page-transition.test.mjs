import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// 在 DOM 事件模型中验证页面交接，不启动浏览器或服务。
test('完整原型切页时保留旧画面直到新页面可用，过期页面不得接管',async()=>{
  const app=await readFile(new URL('../runtime/app.mjs',import.meta.url),'utf8');
  const frameSource=app.slice(app.indexOf('function frameFor('),app.indexOf('function canvas(){'));
  const viewerSource=app.slice(app.indexOf('function viewer(){'),app.indexOf("window.addEventListener('message'",app.indexOf('function viewer(){')));
  const makeElement=()=>({style:{},dataset:{},children:[],classList:{contains:()=>false,toggle(){}},isConnected:false,
    append(child){child.parent=this;child.isConnected=true;this.children.push(child);},
    remove(){this.isConnected=false;this.parent.children=this.parent.children.filter(item=>item!==this);},
    replaceChildren(){for(const child of this.children)child.isConnected=false;this.children=[];},
    querySelector(){return this.children.find(child=>child.className==='page-frame'&&child.dataset.yxReady==='true')||null;},
    setAttribute(){},removeAttribute(){},contentDocument:{}});
  const stage=makeElement(),old=makeElement();old.className='page-frame';old.dataset.yxReady='true';stage.append(old);
  const nodes={first:{id:'first',title:'页面一',kind:'html',width:1280,height:800},second:{id:'second',title:'页面二',kind:'html',width:1280,height:800},third:{id:'third',title:'页面三',kind:'html',width:1280,height:800}};
  const mounted=[],elements={'#page-stage':stage,'#nodes':makeElement(),'#viewer-title':{},'#page-viewport':{clientWidth:1400},'#inspector':{contains:()=>false}};
  const state={experience:true,current:'second',devMode:false,devPicker:null,frames:{},positions:{},model:{annotations:[]},bundle:{resources:{},fragments:{}},flowContext:{},
    node:id=>nodes[id],$:selector=>elements[selector],document:{activeElement:null,createElement:makeElement},
    projectExtension:{declarative:true,nativeInteraction:true,nodeNativeInteraction:true,layout(){},mount(_doc,n){mounted.push(n.id);}},
    stopPreviews(){},renderHandoffTools(){},expandHTML:value=>value,thumbnailHTML:value=>value,measure(){},cleanContext:x=>x,bindNativeDocument(){},renderOverlays(){},renderInspector(){},canvasNodeType:()=>'',outgoing:()=>[],eligibleEdges:()=>[],follow(){}};
  const context=vm.createContext(state);vm.runInContext(frameSource+'\n'+viewerSource,context);
  context.viewer();const pending=stage.children.at(-1);
  assert.equal(stage.children[0],old);assert.equal(old.style.pointerEvents,'none');assert.equal(old.inert,true);assert.equal(pending.style.opacity,'0');assert.equal(pending.inert,true);assert.equal(pending.tabIndex,-1);
  context.current='third';context.viewer();const latest=stage.children.at(-1);
  assert.equal(pending.isConnected,false);assert.equal(stage.children[0],old);
  pending.onload();assert.deepEqual(mounted,[]);assert.equal(stage.children[0],old);
  latest.onload();assert.deepEqual(mounted,['third']);assert.deepEqual(stage.children,[latest]);assert.equal(latest.style.opacity,'');assert.equal(latest.style.pointerEvents,'');assert.equal(latest.inert,false);assert.equal(latest.tabIndex,0);
});
