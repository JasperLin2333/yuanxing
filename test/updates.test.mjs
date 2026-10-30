import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createUpdates} from '../runtime/updates.mjs';
import {clone,mergeProject,validate,removeNodes} from '../runtime/core.mjs';
import {createHandler,standalone} from '../runtime/server.mjs';
import {run} from '../scripts/yuanxing.mjs';

function fixture(){return {version:1,title:'协作项目',entryModule:'main',modules:[{id:'main',title:'主流程',entry:'one'}],nodes:[{id:'one',module:'main',title:'客户列表',kind:'html',path:'pages/one.html',width:1280,height:800,x:0,y:0}],edges:[],annotations:[]};}
function element(tag='div'){
  return {tag,children:[],attrs:{},handlers:{},hidden:false,textContent:'',append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,v){this.handlers[k]=v;},showModal(){this.open=true;},close(){this.open=false;}};
}

test('工作台按日期展示更新、可定位页面，已读状态随内容变化且不跨项目',()=>{
  const ids=Object.fromEntries(['updates-trigger','updates-dot','updates-dialog','updates-content','updates-close'].map(id=>[id,element()]));
  const oldDocument=globalThis.document;globalThis.document={getElementById:id=>ids[id],createElement:tag=>element(tag)};
  try{
    const model=fixture(),storageMap=new Map(),storage={getItem:k=>storageMap.get(k),setItem:(k,v)=>storageMap.set(k,v)},calls=[];
    const ui=createUpdates({getModel:()=>model,storage,location:{pathname:'/p/one/'},leaveCurrent:()=>calls.push('离开当前视图'),openNode:id=>calls.push(id)});
    ui.refresh();assert.equal(ids['updates-dot'].hidden,true);ids['updates-trigger'].handlers.click();assert.equal(ids['updates-content'].children[0].textContent,'暂无更新说明');ids['updates-dialog'].close();
    model.updates=[{id:'a',date:'2026-01-01',text:'旧变更'},{id:'b',date:'2026-10-28',text:'新变更 <无 HTML>',node:'one',label:'客户列表'}];ui.refresh();assert.equal(ids['updates-dot'].hidden,false);
    ids['updates-trigger'].handlers.click();assert.equal(ids['updates-dot'].hidden,true);const sections=ids['updates-content'].children;assert.equal(sections[0].children[0].textContent,'2026-10-28');assert.equal(sections[0].children[1].children[0].children[0].textContent,'新变更 <无 HTML>');
    const link=sections[0].children[1].children[0].children[1];assert.equal(link.textContent,'查看客户列表');link.onclick();assert.deepEqual(calls,['离开当前视图','one']);
    model.updates[1].text='修订后的变更';ui.refresh();assert.equal(ids['updates-dot'].hidden,false);
    model.title='另一个项目';ui.refresh();assert.equal(ids['updates-dot'].hidden,false);
    model.nodes=[];ids['updates-trigger'].handlers.click();assert.equal(ids['updates-content'].children[0].children[1].children[0].children.length,1);
  }finally{globalThis.document=oldDocument;}
});

test('更新说明可与旧项目兼容，并发新增逐项合并，删除页面保留历史',()=>{
  const base=fixture(),local=clone(base),remote=clone(base);assert.deepEqual(validate(base),[]);
  local.updates=[{id:'u1',date:'2026-10-28',text:'更新一',node:'one'}];remote.updates=[{id:'u2',date:'2026-10-28',text:'更新二'}];
  const result=mergeProject(base,local,remote);assert.deepEqual(result.conflicts,[]);assert.equal(result.model.updates.length,2);assert.deepEqual(validate(result.model),[]);
  removeNodes(result.model,['one']);assert.equal(result.model.updates.length,2);assert.deepEqual(validate(result.model),[]);
  result.model.updates.push({id:'u1',date:'bad',text:''});assert(validate(result.model).includes('更新说明格式不正确'));
});

test('三种离线视图包含项目更新记录而不依赖项目扩展',async()=>{
  const model=fixture();model.updates=[{id:'u1',date:'2026-10-28',text:'这次更新',node:'one'}];
  const bundle={model,resources:{one:'<main>页面</main>'},fragments:{},images:{},documentSources:{}};
  for(const view of ['review','document','prototype']){const html=await standalone(bundle,{view});const boot=JSON.parse(html.match(/<script>globalThis\.YUANXING_BOOT=([\s\S]*?);<\/script>/)[1]);assert.deepEqual(boot.bundle.model.updates,model.updates);assert.match(html,/id="updates-trigger"/);assert.match(html,/function createUpdates/);}
});

test('本地工作台可以读取更新说明模块',async()=>{
  const response={writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;}};
  await createHandler({},'token')({method:'GET',url:'/updates.mjs',headers:{host:'127.0.0.1'}},response);
  assert.equal(response.status,200);assert.match(response.headers['Content-Type'],/^text\/javascript/);assert.match(response.body,/function createUpdates/);
});

test('命令行追加更新说明：校验页面、日期与标识，只改 updates 并保留其他内容',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yuanxing-updates-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const root=path.join(dir,'项目');await run(['init',root,'--template','iteration']);
  const file=path.join(root,'artifact/workbench.json'),before=JSON.parse(await fs.readFile(file,'utf8')),node=before.nodes[0].id;
  const first=await run(['updates','add','--root',root,'--text','旧的变更','--date','2026-01-02']);assert.match(first.id,/^update-2026-01-02-[0-9a-f]{6}$/);
  await run(['updates','add','--root',root,'--text','  新增页面说明  ','--date','2026-10-29','--node',node,'--label','打开页面','--id','update-new']);
  const saved=JSON.parse(await fs.readFile(file,'utf8'));assert.deepEqual(saved.updates.map(u=>u.id),['update-new',first.id]);assert.deepEqual(saved.updates[0],{id:'update-new',date:'2026-10-29',text:'新增页面说明',node,label:'打开页面'});
  assert.deepEqual({...saved,updates:undefined},{...before,updates:undefined});assert.deepEqual(validate(saved),[]);
  await assert.rejects(run(['updates','add','--root',root,'--text','重复','--id','update-new']),/已存在/);
  await assert.rejects(run(['updates','add','--root',root,'--text','页面','--node','missing']),/关联页面不存在/);
  await assert.rejects(run(['updates','add','--root',root,'--text','日期','--date','2026-02-30']),/日期/);
  await assert.rejects(run(['updates','add','--root',root,'--text','   ']),/不能为空/);
  const listed=await run(['updates','list','--root',root,'--json']);assert.deepEqual(listed.map(u=>u.date),['2026-10-29','2026-01-02']);
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).updates.length,2);
});
