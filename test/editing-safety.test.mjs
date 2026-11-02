import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {clone,mergeProject,validate,isBranch,History,canvasExplanation,writeCanvasExplanation,overviewEdges,canvasNodeWidth,canvasNodeHeight,routeConnections,placeConnectionLabels,connectionDisplayPath} from '../runtime/core.mjs';

const app=await readFile(new URL('../runtime/app.mjs',import.meta.url),'utf8');
const section=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)));
const fixture=()=>({version:1,title:'项目',modules:[{id:'m',title:'模块'}],nodes:[{id:'a',module:'m',title:'页面 A',kind:'note',width:800,height:600,x:0,y:0,description:''},{id:'b',module:'m',title:'页面 B',kind:'note',width:800,height:600,x:1000,y:0,description:''},{id:'fork',module:'m',title:'分支',kind:'note',presentation:'branch',width:16,height:16,x:650,y:600,description:'原说明'}],edges:[{id:'edge',from:'a',to:'b',label:'原名称',summary:'原说明',fromSide:'right',toSide:'left'},{id:'branch-edge',from:'a',to:'fork',label:'',diagram:true}],annotations:[]});
function element(tag='div'){
  const el={tag,children:[],childNodes:[],dataset:{},style:{},attrs:{},textContent:'',classList:{add(){},remove(){},toggle(){}},append(...items){for(const item of items){this.children.push(item);this.childNodes.push(item);item.parent=this;}},replaceChildren(){this.children=[];this.childNodes=[];},insertAdjacentHTML(){},setAttribute(key,value){this.attrs[key]=value;},focus(){},select(){},remove(){this.removed=true;if(this.parent){this.parent.children=this.parent.children.filter(item=>item!==this);this.parent.childNodes=this.parent.childNodes.filter(item=>item!==this);}}};return el;
}

test('同一输入框跨过自动保存后，连线、分支、页面及模块的后续输入仍保存',async()=>{
  const cases=[
    {name:'操作名称',selected:{type:'edge',id:'edge'},value:m=>m.edges[0].label,set:(m,v)=>m.edges[0].label=v},
    {name:'说明正文',selected:{type:'edge',id:'edge'},value:m=>m.edges[0].summary,set:(m,v)=>m.edges[0].summary=v},
    {name:'操作名称',selected:{type:'edge',id:'branch-edge'},value:m=>m.nodes[2].title,set:(m,v)=>m.nodes[2].title=v},
    {name:'说明正文',selected:{type:'node',id:'fork'},value:m=>m.nodes[2].description,set:(m,v)=>m.nodes[2].description=v},
    {name:'页面名称',selected:{type:'node',id:'a'},value:m=>m.nodes[0].title,set:(m,v)=>m.nodes[0].title=v},
    {name:'模块名称',selected:null,value:m=>m.modules[0].title,set:(m,v)=>m.modules[0].title=v}
  ];
  for(const example of cases){
    const pane=element(),message={dataset:{},hidden:true},initial=fixture(),notices=[];
    const state={model:clone(initial),baseModel:clone(initial),revision:'v1',readonly:false,originalReadonly:false,dirty:true,saving:false,conflict:false,conflictData:null,saveFlight:null,connectionLabelEditor:null,pendingModelRender:false,inputGroup:null,selected:example.selected,moduleId:'m',recycleOpen:false,current:null,clone,mergeProject,validate,isBranch,canvasExplanation,writeCanvasExplanation,history:new History(),updateHistoryButtons(){},scheduleSave(){},flushModelRender(){},renderAll(){throw new Error('普通保存不应重绘输入框');},selectionTools(){},selectionControls(){},nodeTypeField(){return element();},descriptionField(){return element();},nodeDeleteButton(){return element();},deleteIconButton(){return element();},deleteSelectedConnection(){},pointExplanations(){},drawLines(){},sidebar(){},esc:value=>value||'',canvasText:value=>canvasExplanation(state.model,value),projectExtension:null,missing:new Set(),outgoing:()=>[],document:{activeElement:null,createElement:element,querySelector:()=>null},$:key=>key==='#inspector'?pane:message,apiBase:'',token:'test',async fetch(url,options){return {ok:true,status:200,json:async()=>({revision:'v2',model:JSON.parse(options.body).model})};},notice(text){notices.push(text);},download(){}};
    state.node=id=>state.model.nodes.find(n=>n.id===id);
    const context=vm.createContext(state);vm.runInContext(section('function editField(','function scheduleSave(')+section('function showCollaborationConflict(','async function save(){')+section('async function save(){','async function reload(')+section('function field(','function explanationText(')+section('function renderInspector(){','function deleteAnnotation('),context);context.renderInspector();
    const input=pane.children.find(item=>item.textContent===example.name).children[0];state.document.activeElement=input;
    await context.save();input.value='第一段';input.oninput();await context.save();input.value='第一段和后续内容';input.oninput();await context.save();
    assert.equal(example.value(state.model),'第一段和后续内容',example.name);assert.equal(state.dirty,false);assert.deepEqual(notices,[]);
    const remote=clone(state.model);example.set(remote,'外部修改');state.model=remote;state.baseModel=clone(remote);input.value='我的后续修改';input.oninput();assert.equal(state.conflict,true,example.name);assert.equal(example.value(state.model),'我的后续修改');assert.equal(example.value(state.conflictData.remote),'外部修改');
  }
});

test('输入框保持焦点时外部修改同一字段，再输入会保留双方并允许选择',()=>{
  for(const prefer of ['local','remote']){
    const persisted=fixture();persisted.edges[0].label='外部名称';const model=clone(persisted);model.nodes[1].description='尚未保存的独立修改';let noticeText='';
    const state={model,baseModel:clone(persisted),revision:'v2',readonly:false,dirty:false,conflict:false,conflictData:null,inputGroup:null,timer:null,clone,mergeProject,validate,history:new History(),document:{activeElement:{}},updateHistoryButtons(){},clearTimeout(){},setTimeout(){},save(){},renderAll(){},download(){},notice(text){noticeText=text;}};
    const context=vm.createContext(state);vm.runInContext(section('function editField(','async function save(){'),context);const read=m=>m.edges.find(e=>e.id==='edge')?.label,write=(m,value)=>{m.edges.find(e=>e.id==='edge').label=value;};
    context.editInspectedValue(read,write,'edges/edge/label','我的输入','原名称');assert.equal(state.conflict,true);assert.match(noticeText,/同时修改/);assert.equal(state.model.edges[0].label,'我的输入');assert.equal(state.conflictData.remote.edges[0].label,'外部名称');
    context.editInspectedValue(read,write,'edges/edge/label','我的后续输入','我的输入');context.resolveCollaborationConflict(prefer);assert.equal(state.conflict,false);assert.equal(state.model.edges[0].label,prefer==='local'?'我的后续输入':'外部名称');assert.equal(state.model.nodes[1].description,'尚未保存的独立修改');assert.equal(state.baseModel.nodes[1].description,'');assert.equal(state.dirty,true);
  }
});

test('并行合并不打断当前原型，撤销本地操作时保留外部独立修改',async()=>{
  const baseline=fixture(),local=clone(baseline);local.nodes[0].title='本地修改';const saved=clone(local);saved.nodes[1].description='外部修改';const history=new History();history.push(baseline);let renders=0;
  const state={model:local,baseModel:clone(baseline),revision:'v1',saveFlight:null,connectionLabelEditor:null,pendingModelRender:false,originalReadonly:false,dirty:true,conflict:false,saving:false,experience:true,documentMode:false,current:'a',busy:false,apiBase:'',token:'test',clone,mergeProject,validate,history,updateHistoryButtons(){},scheduleSave(){},runtimeUpdateBlocked:()=>state.busy,renderAll(){renders++;},notice(text){throw new Error(text);},download(){},$:()=>({dataset:{},hidden:true}),fetch:async()=>({ok:true,status:200,json:async()=>({revision:'v2',model:saved})})};
  const context=vm.createContext(state);vm.runInContext(section('async function save(){','async function reload(')+section('function flushModelRender(){',"document.addEventListener('focusout'"),context);await context.save();
  assert.equal(renders,0);assert.equal(state.pendingModelRender,true);const undone=history.undo(state.model);assert.equal(undone.nodes[0].title,'页面 A');assert.equal(undone.nodes[1].description,'外部修改');
  state.experience=false;assert.equal(context.flushModelRender(),false);state.current=null;state.busy=true;assert.equal(context.flushModelRender(),false);state.busy=false;assert.equal(context.flushModelRender(),true);assert.equal(renders,1);
});

test('行内编辑等待输入法选词，保存响应等待编辑结束并保留同字段冲突',async()=>{
  const base=fixture(),remote=clone(base);remote.edges[0].label='外部名称';let input,conflictInfo;
  const state={model:clone(base),baseModel:clone(base),revision:'v1',readonly:false,originalReadonly:false,dirty:true,saving:false,conflict:false,saveFlight:null,connectionLabelEditor:null,pendingModelRender:false,clone,mergeProject,validate,isBranch,history:new History(),apiBase:'',token:'test',innerWidth:1000,innerHeight:800,updateHistoryButtons(){},flushModelRender(){},scheduleSave(){},renderAll(){},notice(text){throw new Error(text);},download(){},$:()=>({dataset:{},focus(){}}),document:{querySelector:()=>null,createElement:element,body:{append(el){input=el;}}},fetch:async()=>({ok:true,status:200,json:async()=>({revision:'v2',model:remote})}),showCollaborationConflict(data,local,baseline){conflictInfo={data,local:clone(local),baseline:clone(baseline)};state.conflict=true;}};
  state.node=id=>state.model.nodes.find(n=>n.id===id);state.edit=fn=>{fn(state.model);state.dirty=true;};
  const context=vm.createContext(state);vm.runInContext(section('async function save(){','async function reload(')+section('function editConnectionLabel(','function drawAlignmentGuides('),context);
  const event={clientX:100,clientY:100,preventDefault(){},stopPropagation(){}};const flight=context.save();context.editConnectionLabel('edge',event);input.value='我的名称';
  input.onkeydown({...event,key:'Enter',isComposing:true});assert.equal(input.removed,undefined);assert.equal(state.model.edges[0].label,'原名称');await new Promise(resolve=>setImmediate(resolve));assert.equal(state.saving,true);
  input.onkeydown({...event,key:'Enter',isComposing:false});await flight;assert.equal(input.removed,true);assert.equal(conflictInfo.local.edges[0].label,'我的名称');assert.equal(conflictInfo.data.model.edges[0].label,'外部名称');assert(conflictInfo.data.conflicts.includes('edges/edge/label'));
});

test('需求正文保存返回时也等待连线行内编辑，并保留双方的同字段修改',async()=>{
  const base=fixture(),remote=clone(base);remote.edges[0].label='外部名称';let input,respond,started,conflictInfo;const ready=new Promise(resolve=>started=resolve);
  const state={model:clone(base),baseModel:clone(base),bundle:{documentSources:{},documentSourceVersions:{}},revision:'v1',readonly:false,originalReadonly:false,dirty:false,saving:false,conflict:false,saveFlight:null,connectionLabelEditor:null,pendingModelRender:false,clone,mergeProject,validate,isBranch,history:new History(),apiBase:'',token:'test',innerWidth:1000,innerHeight:800,save:async()=>{},updateHistoryButtons(){},flushModelRender(){},scheduleSave(){},renderAll(){},notice(text){throw new Error(text);},download(){},$:()=>({dataset:{},focus(){}}),document:{querySelector:()=>null,createElement:element,body:{append(el){input=el;}}},fetch:()=>{started();return new Promise(resolve=>respond=resolve);},showCollaborationConflict(data,local,baseline){conflictInfo={data,local:clone(local),baseline:clone(baseline)};state.conflict=true;}};
  state.node=id=>state.model.nodes.find(n=>n.id===id);state.edit=fn=>{fn(state.model);state.dirty=true;};const context=vm.createContext(state);vm.runInContext(section('async function saveDocumentText(','function sidebar(')+section('function editConnectionLabel(','function drawAlignmentGuides('),context);
  const flight=context.saveDocumentText({});await ready;const event={clientX:100,clientY:100,preventDefault(){},stopPropagation(){}};context.editConnectionLabel('edge',event);input.value='我的名称';respond({ok:true,json:async()=>({model:remote,revision:'v2',documentSources:{},documentSourceVersions:{},keyChanges:{}})});await new Promise(resolve=>setImmediate(resolve));assert.equal(state.model.edges[0].label,'原名称');
  input.onkeydown({...event,key:'Enter'});await flight;assert.equal(conflictInfo.local.edges[0].label,'我的名称');assert.equal(conflictInfo.data.model.edges[0].label,'外部名称');assert(conflictInfo.data.conflicts.includes('edges/edge/label'));
});

test('行内连线名称草稿会触发离开页面保护',()=>{
  let handler;const state={window:{addEventListener(name,fn){if(name==='beforeunload')handler=fn;}},saveView(){},annotationEditor:null,annotationEditorId:null,connectionLabelEditor:{input:{value:'未提交'},initial:'旧名称'},documentView:{hasPendingChanges:()=>false},pendingImages:new Set(),model:{annotations:[]},dirty:false,conflict:false};
  const line=app.slice(app.indexOf("window.addEventListener('beforeunload'"),app.indexOf('\n',app.indexOf("window.addEventListener('beforeunload'")));vm.runInContext(line,vm.createContext(state));let prevented=false;handler({preventDefault(){prevented=true;}});assert.equal(prevented,true);
  state.connectionLabelEditor.input.value='旧名称';prevented=false;handler({preventDefault(){prevented=true;}});assert.equal(prevented,false);
});

test('首次选择连线后保留文字与文本行元素，双击处理仍绑定原元素',()=>{
  const model=fixture();model.edges=model.edges.slice(0,1);model.nodes=model.nodes.slice(0,2);const svg=element(),viewport=element();Object.defineProperty(svg,'innerHTML',{set(){svg.childNodes=[element()];}});let edited=null;
  const state={model,current:null,camera:{scale:1},cancelConnection:null,recycleOpen:false,linesHidden:false,moduleId:'m',selected:null,readonly:true,lastLinesSignature:null,lineTextContext:null,renderSections(){},activeCanvasNodes:()=>model.nodes,overviewEdges,canvasNodeWidth,canvasNodeHeight,routeConnections,placeConnectionLabels,connectionDisplayPath,isBranch,connectionKey:edge=>[edge.from,edge.to,edge.condition||edge.label,edge.fromSide,edge.toSide].join('\0'),$:key=>key==='#lines'?svg:viewport,highlightCards(){},renderInspector(){},drawLines(){},editConnectionLabel:id=>edited=id,getComputedStyle:()=>({fontFamily:'sans-serif'}),document:{createElement:()=>({getContext:()=>({measureText:text=>({width:text.length*12})})}),createElementNS:()=>element()}};
  const context=vm.createContext(state);vm.runInContext(section('function paintLines(){','function edgeGeometryGesture('),context);context.paintLines();const group=svg.yuanxingLayers.views.get('edge').labelGroup,row=svg.yuanxingLayers.views.get('edge').label.childNodes[0];group.onclick();context.paintLines();
  assert.equal(svg.yuanxingLayers.views.get('edge').labelGroup,group);assert.equal(svg.yuanxingLayers.views.get('edge').label.childNodes[0],row);group.ondblclick({});assert.equal(edited,'edge');
  model.edges[0].label='';context.paintLines();assert.equal(group.removed,true);assert.equal(svg.yuanxingLayers.views.get('edge').labelGroup,null);
});

test('连线和分支说明粘贴图片写入光标位置，上传期间外部改动不会被覆盖',async()=>{
  for(const type of ['edge','node'])for(const changed of [false,true]){
    const model=fixture(),owner=type==='edge'?model.edges[0]:model.nodes[2],id=owner.id,key=type==='edge'?'summary':'description';owner[key]='A-B';let finish,noticeText='',previousText;const state={model,readonly:false,pendingImages:new Set(),pendingDescriptionNodes:new Set(),bundle:{images:{}},inputGroup:null,selected:{type,id},document:{createElement:element},clipboardImages:event=>event.clipboardData.files,canvasText:value=>canvasExplanation(state.model,value),writeCanvasExplanation,uploadImage:()=>new Promise(resolve=>finish=resolve),notice(text){noticeText=text;},renderInspector(){},$:()=>({dataset:{}})};
    state.node=id=>state.model.nodes.find(item=>item.id===id);state.edit=(fn,render,group,options)=>{assert.equal(options.background,true);fn(state.model);};const context=vm.createContext(state);vm.runInContext(section('function field(','function explanationText(')+section('function pasteTextAreaImages(','function defaultInsertPoint('),context);
    const input=context.field('说明正文','A-B',(value,previous)=>{previousText=previous;owner[key]=value;},true).children[0];Object.assign(input,{selectionStart:1,selectionEnd:2,disabled:false,isConnected:true});const event={clipboardData:{files:[{type:'image/png'}]},preventDefault(){},stopPropagation(){}};const flight=context.pasteTextAreaImages(event,type,id,input);assert.equal(input.disabled,true);state.readonly=true;if(changed)owner[key]='外部说明';finish({path:'assets/new.png',src:'data:image/png;base64,abc'});await flight;
    assert.equal(input.disabled,false);if(changed){assert.equal(owner[key],'外部说明');assert.match(noticeText,/说明已发生变化/);}else{const expected='A\n\n![说明图片](assets/new.png)\n\nB';assert.equal(owner[key],expected);assert.equal(input.value,expected);assert.equal(state.bundle.images['assets/new.png'],'data:image/png;base64,abc');input.value+='继续';input.oninput();assert.equal(previousText,expected);assert.equal(owner[key],expected+'继续');}
  }
});

test('切换项目等待需求正文保存，正文保存失败时停留在原项目',async()=>{
  for(const fail of [false,true]){
    let config,complete,assigned='',message='';const gate=new Promise((resolve,reject)=>complete=()=>fail?reject(new Error('正文冲突')):resolve()),elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{append(){},hidden:false});return elements.get(id);};
    const state={boot:{projects:[{id:'one',title:'一',url:'/one/'},{id:'two',title:'二',url:'/two/'}],projectId:'one'},$:get,createSelect(options){config=options;return {element:{},setDisabled(){},setValue(){}};},activeCanvasGesture:null,closeAnnotationEditor(){},clearTimeout(){},timer:null,documentView:{flush:()=>gate},pendingImages:new Set(),pendingDescriptionNodes:new Set(),saveFlight:null,save:async()=>{},dirty:false,saving:false,conflict:false,saveView(){},location:{assign:url=>assigned=url},notice:text=>message=text};
    vm.runInContext(section("const projectHost=",'function runtimeUpdateBlocked(){'),vm.createContext(state));const flight=config.onChange('two');await Promise.resolve();assert.equal(assigned,'');complete();await flight;if(fail){assert.equal(assigned,'');assert.match(message,/正文冲突/);}else assert.equal(assigned,'/two/');
  }
});
