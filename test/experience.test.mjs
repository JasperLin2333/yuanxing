import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import vm from 'node:vm';
import {mergeProject} from '../runtime/core.mjs';
const app=await fs.readFile(new URL('../runtime/app.mjs',import.meta.url),'utf8');
const player=await fs.readFile(new URL('../runtime/player.mjs',import.meta.url),'utf8');
const entries=app.includes('function flowEntries(model){')?app.slice(app.indexOf('function flowEntries(model){'),app.indexOf('function renderExperience(){')):player.slice(player.indexOf('export function flowEntries('),player.indexOf('export function thumbnailHTML(')).replaceAll('export ','');
const controller=app.slice(app.indexOf('function renderExperience(){'),app.indexOf('function capturePoint('));
const clone=value=>JSON.parse(JSON.stringify(value));
function setup(originalReadonly=false){
  const elements=new Map(),classes=new Set(),stored=[];
  const element=()=>({hidden:false,disabled:false,attrs:{},dataset:{},children:[],replaceChildren(){this.children=[];},append(child){this.children.push(child);},setAttribute(key,value){this.attrs[key]=value;},focus(){},scrollTop:90,scrollLeft:30});
  const $=selector=>{if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);};
  const state={apiBase:"",clone,cleanContext:value=>clone(value||{}),$,originalReadonly,readonly:originalReadonly,experience:false,documentMode:false,documentView:{leave(){}},experienceReturn:null,activeFlow:null,activeCanvasGesture:null,cancelConnection:null,
    model:{title:'项目',contextDefaults:{role:'admin'},modules:[{id:'a',title:'模块甲',entry:'one'},{id:'b',title:'模块乙',entry:'two'}],nodes:[{id:'one',module:'a',kind:'html'},{id:'two',module:'b',kind:'image'}],flows:[{id:'first',title:'第一条流程',entry:'one'},{id:'second',title:'第二条流程',entry:'two',context:{role:'member'}}]},
    moduleId:'a',current:null,recycleOpen:false,camera:{x:-123,y:234,scale:.63},cameras:{},selected:{type:'node',id:'one'},flowContext:{before:'keep'},mode:null,linkCaptureTarget:null,
    viewReady:true,linesHidden:false,location:{pathname:'/'},localStorage:{setItem(key,value){stored.push({key,value});}},
    document:{body:{classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);}}},createElement:element},
    fit(){state.fitted=true;},dismissImagePreview(){state.previewDismissed=true;},closeAnnotationEditor(){},notice(message){state.lastNotice=message;},saveCanvasCamera(){state.cameras[state.moduleId]=clone(state.camera);},
    node(id){return state.model.nodes.find(n=>n.id===id);},openNode(id){state.current=id;state.moduleId=state.node(id).module;state.renderAll();},
    renderAll(){state.renderExperience();},activeCameraKey(){return state.moduleId;}};
  const context=vm.createContext(state);vm.runInContext(entries+controller+app.slice(app.indexOf('function viewKey(){'),app.indexOf('function rememberView(){')),context);
  return {state,context,$,classes,stored};
}
test('三种视图入口常驻；体验及切换平台后仍能恢复原画布',()=>{
  const {state:s,$,classes,stored}=setup(),before=clone({model:s.model,camera:s.camera,selected:s.selected,flowContext:s.flowContext});
  s.renderExperience();assert.equal($('#experience-start').hidden,false);assert.equal($('#experience-exit').hidden,false);
  assert.equal($('#document-start').attrs['aria-pressed'],'false');s.documentMode=true;s.renderExperience();assert.equal($('#document-start').attrs['aria-pressed'],'true');assert.equal($('#experience-exit').attrs['aria-pressed'],'false');s.documentMode=false;
  s.startExperience();assert.equal(s.current,'one');assert.equal(s.readonly,true);assert(classes.has('experience'));assert.equal($('#experience-start').attrs['aria-pressed'],'true');assert.equal($('#experience-exit').attrs['aria-pressed'],'false');assert.equal($('#page-viewport').scrollTop,0);
  const count=stored.length;s.saveView();assert.equal(stored.length,count,'体验过程不能覆盖编辑端保存的视图');
  s.camera={x:999,y:999,scale:1};s.startExperience('second');assert.equal(s.current,'two');assert.equal(s.flowContext.role,'member');s.startExperience(s.activeFlow);
  s.exitExperience();assert.equal(s.experience,false);assert.equal(s.readonly,false);assert.equal(s.current,null);assert.equal(s.moduleId,'a');assert.deepEqual(s.camera,before.camera);assert.deepEqual(s.selected,before.selected);assert.deepEqual(s.flowContext,before.flowContext);assert.deepEqual(s.model,before.model);assert(!classes.has('experience'));assert.equal($('#experience-exit').attrs['aria-pressed'],'true');
  s.saveView();assert.equal(stored.length,count+1);
});
test('空项目保留切换位置并禁用完整原型；离线分享返回画布后仍只读',()=>{
  const {$,state:s}=setup();s.model.nodes=[];s.renderExperience();assert.equal($('#experience-start').hidden,false);assert.equal($('#experience-start').disabled,true);s.startExperience();assert.equal(s.experience,false);assert.equal(s.readonly,false);assert.equal(s.lastNotice,'请先添加原型页面。');
  const share=setup(true).state;share.startExperience();share.exitExperience();assert.equal(share.readonly,true);share.experience=true;share.experienceReturn=null;share.exitExperience();assert.equal(share.fitted,true);assert.equal(share.readonly,true);
});
test('进入完整原型不阻断进入前的自动保存，离线分享不能写入项目',async()=>{
  for(const originalReadonly of [false,true]){
    const {state:s,context}=setup(originalReadonly);let writes=0;
    Object.assign(s,{baseModel:clone(s.model),mergeProject,dirty:true,conflict:false,saveFlight:null,saving:false,revision:'old',token:'session',validate:()=>[],updateHistoryButtons(){},scheduleSave(){},fetch:async(url,options)=>{writes++;assert.equal(url,'/api/project');assert.equal(options.method,'PUT');assert.deepEqual(JSON.parse(options.body).model,s.model);return {ok:true,status:200,json:async()=>({revision:'new'})};}});
    const save=app.slice(app.indexOf('async function save(){'),app.indexOf('async function reload('));vm.runInContext(save,context);s.startExperience();await s.save();assert.equal(writes,originalReadonly?0:1);if(!originalReadonly){assert.equal(s.dirty,false);assert.equal(s.revision,'new');}
  }
});
