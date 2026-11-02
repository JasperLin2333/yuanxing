import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import vm from 'node:vm';
import {createStore,createHandler,standalone} from '../runtime/server.mjs';
import {clone,copyCanvasSelection,canvasClipboardAssets,pasteCanvasSelection,validate,History,moduleNodes,recycleCanvasNodes,canvasNodeWidth,canvasNodeHeight} from '../runtime/core.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nm9sAAAAASUVORK5CYII=','base64');
const sourceModel=()=>({version:1,title:'来源',modules:[{id:'a',title:'来源模块'}],nodes:[
  {id:'page',module:'a',title:'页面',kind:'html',path:'pages/source.html',width:800,height:600,x:0,y:0,sources:['artifact/pages/source.html']},
  {id:'image',module:'a',title:'截图',kind:'image',path:'assets/source.png',width:400,height:300,x:800,y:0},
  {id:'note',module:'a',title:'说明',kind:'note',width:600,height:400,x:1600,y:0,description:'文字与 ![截图](assets/source.png)'}
],edges:[{id:'next',from:'page',to:'image',label:'打开',selector:'#go'},{id:'hotspot',from:'image',to:'note',label:'继续',rect:[0,0,.5,.5],imagePath:'assets/source.png'}],annotations:[{id:'pin',node:'image',text:'截图标记',point:[.5,.5],imagePath:'assets/source.png'}]});
const targetModel=()=>({version:1,title:'目标',modules:[{id:'b',title:'目标模块'}],nodes:[],edges:[],annotations:[]});
async function projects(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yuanxing-import-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const source=path.join(dir,'source'),target=path.join(dir,'target');for(const root of [source,target]){await fs.mkdir(path.join(root,'artifact/assets'),{recursive:true});await fs.mkdir(path.join(root,'artifact/pages'),{recursive:true});}
  await fs.mkdir(path.join(source,'artifact/components'));await fs.writeFile(path.join(source,'artifact/workbench.json'),JSON.stringify(sourceModel()));await fs.writeFile(path.join(target,'artifact/workbench.json'),JSON.stringify(targetModel()));
  await fs.writeFile(path.join(source,'artifact/assets/source.png'),png);await fs.writeFile(path.join(target,'artifact/assets/source.png'),Buffer.concat([png,Buffer.from('different')]));
  await fs.writeFile(path.join(source,'artifact/components/part.html'),'<p>组件内容</p>');await fs.writeFile(path.join(source,'artifact/pages/source.html'),'<main><!-- include:components/part.html --><img src="../assets/source.png"><button id="go">前往</button><script>window.example=1</script></main>');
  const a=await createStore(source),b=await createStore(target),bundle=await a.load(),clipboard=copyCanvasSelection(bundle.model,'a',['page','image','note']);Object.assign(clipboard,canvasClipboardAssets(clipboard,bundle),{projectKey:bundle.projectKey,sourceExtension:false});return {dir,source,target,a,b,bundle,clipboard};
}

test('跨项目粘贴完整复制普通 HTML、截图、说明图片及其关系，保存和重开均可用',async t=>{
  const {a,b,clipboard}=await projects(t),prepared=await b.importClipboard(clipboard);assert.notEqual(prepared.projectKey,clipboard.projectKey);assert.equal(prepared.imported,true);
  const html=prepared.nodes.find(n=>n.id==='page'),image=prepared.nodes.find(n=>n.id==='image'),note=prepared.nodes.find(n=>n.id==='note');assert.match(html.path,/^imports\//);assert(!html.sources);assert.notEqual(image.path,'assets/source.png');assert(note.description.includes(image.path));assert.equal(prepared.edges.find(e=>e.id==='hotspot').imagePath,image.path);assert.equal(prepared.annotations[0].imagePath,image.path);
  const base=await b.readModel(),ids=pasteCanvasSelection(base.model,'b',prepared,[100,100]);assert.equal(ids.length,3);assert.deepEqual(validate(base.model),[]);await b.save(base.model,base.revision);const loaded=await b.load(),copied=loaded.model.nodes.find(n=>n.kind==='html');assert(loaded.resources[copied.id].includes('组件内容'));assert(loaded.resources[copied.id].includes('window.example=1'));assert(loaded.images[image.path]);assert.match(await standalone(loaded),/^<!doctype html>/i);
  const again=await b.importClipboard(clipboard);assert.notEqual(again.nodes.find(n=>n.kind==='html').path,html.path);assert.equal((await a.load()).model.nodes.length,3);
});

test('无法完整迁移的专用页面和无效图片会被拦截，失败时清理本次文件',async t=>{
  const {b,target,clipboard}=await projects(t),before=(await fs.readdir(path.join(target,'artifact/assets'))).sort(),special=clone(clipboard);special.sourceExtension=true;await assert.rejects(b.importClipboard(special),/项目专用交互/);
  const invalid=clone(clipboard);invalid.nodes.push({...clone(invalid.nodes[1]),id:'bad-image',path:'assets/bad.png'});invalid.resources['bad-image']='data:image/png;base64,AAAA';await assert.rejects(b.importClipboard(invalid),/图片内容不正确/);assert.deepEqual((await fs.readdir(path.join(target,'artifact/assets'))).sort(),before);assert.equal((await b.load()).model.nodes.length,0);
  const relative=clone(clipboard);relative.resources.page='<img src="../assets/source.png">';await assert.rejects(b.importClipboard(relative),/未内嵌的资源/);assert.deepEqual((await fs.readdir(path.join(target,'artifact/assets'))).sort(),before);
  const extension=path.join(target,'extension');await fs.mkdir(extension);await fs.writeFile(path.join(extension,'extension.json'),JSON.stringify({entry:'index.mjs',files:['index.mjs'],declarative:true}));await fs.writeFile(path.join(extension,'index.mjs'),'export function createProjectExtension(){return null;}');const customized=await createStore(target,{extension});await assert.rejects(customized.importClipboard(clipboard),/项目专用交互/);
});

test('跨项目导入接口需要有效会话令牌',async t=>{
  const {b,clipboard}=await projects(t),handler=createHandler(b,'secret'),request=Readable.from([JSON.stringify(clipboard)]);Object.assign(request,{method:'POST',url:'/api/clipboard/import',headers:{host:'localhost:4318'}});let status;await handler(request,{writeHead(value){status=value;},end(){}});assert.equal(status,403);assert.equal((await b.load()).model.nodes.length,0);
  const authorized=Readable.from([JSON.stringify(clipboard)]);Object.assign(authorized,{method:'POST',url:'/api/clipboard/import',headers:{host:'localhost:4318',authorization:'Bearer secret'}});let body;await handler(authorized,{writeHead(value){status=value;},end(value){body=value;}});assert.equal(status,200);assert.equal(JSON.parse(body).projectKey,(await b.load()).projectKey);assert.equal((await b.load()).model.nodes.length,0);
});

test('跨项目素材导入期间切换模块或进入体验，完成后仍写入原目标且不重绘当前页面',async()=>{
  const app=await fs.readFile(new URL('../runtime/app.mjs',import.meta.url),'utf8'),source=app.slice(app.indexOf('function importClipboardSelection('),app.indexOf('function duplicateSelection('));let respond,renders=0;const model=targetModel();model.modules.push({id:'other',title:'其他模块'});
  const clipboard={projectKey:'old',sourceExtension:false,nodes:[{id:'note',module:'old',title:'说明',kind:'note',width:100,height:100,x:0,y:0,description:'内容'}],edges:[],annotations:[],rules:{}},prepared={...clone(clipboard),projectKey:'target',imported:true};
  const state={model,boot:{projectKey:'target'},bundle:{projectKey:'target',resources:{},images:{},fragments:{}},moduleId:'b',recycleOpen:false,readonly:false,originalReadonly:false,documentMode:false,current:null,selected:null,flowClipboard:null,pasteCount:0,pendingModelRender:false,pendingImages:new Set(),apiBase:'',token:'test',validate,moduleNodes,recycleCanvasNodes,canvasNodeWidth,canvasNodeHeight,pasteCanvasSelection,history:new History(),updateHistoryButtons(){},scheduleSave(){},renderAll(){renders++;},fitSelection(){},defaultInsertPoint:()=>[100,100],notice(){},fetch:()=>new Promise(resolve=>respond=resolve)};
  const edit=app.slice(app.indexOf('function edit(fn,'),app.indexOf('function editField('));const context=vm.createContext(state);vm.runInContext(edit+source,context);const flight=context.pasteSelection(clipboard,[100,100]);state.moduleId='other';state.readonly=true;state.current='正在体验';respond({ok:true,json:async()=>prepared});await flight;
  assert.equal(state.model.nodes.length,1);assert.equal(state.model.nodes[0].module,'b');assert.equal(state.current,'正在体验');assert.equal(renders,0);assert.equal(state.pendingModelRender,true);
});
