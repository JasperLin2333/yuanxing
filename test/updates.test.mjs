import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createUpdates,diffSegments,formatUpdatesMarkdown,orderedUpdates} from '../runtime/updates.mjs';
import {clone,mergeProject,validate,removeNodes} from '../runtime/core.mjs';
import {createHandler,standalone} from '../runtime/server.mjs';
import {run} from '../scripts/yuanxing.mjs';

function fixture(){return {version:1,title:'协作项目',entryModule:'main',modules:[{id:'main',title:'主流程',entry:'one'}],nodes:[{id:'one',module:'main',title:'客户列表',kind:'html',path:'pages/one.html',width:1280,height:800,x:0,y:0}],edges:[],annotations:[]};}
function element(tag='div'){
  return {tag,children:[],attrs:{},handlers:{},hidden:false,textContent:'',append(...items){this.children.push(...items);},prepend(item){this.children.unshift(item);},replaceChildren(...items){this.children=items;},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,v){this.handlers[k]=v;},showModal(){this.open=true;},close(){this.open=false;},select(){this.selected=true;}};
}

test('工作台按日期展示并复制更新说明，保留折叠对照、已读标记和手动复制入口',async()=>{
  const ids=Object.fromEntries(['trigger','dot','dialog','content','close','range','baseline','copy-range','copy-status','copy-text'].map(id=>['updates-'+id,element()]));
  const oldDocument=globalThis.document;globalThis.document={getElementById:id=>ids[id],createElement:tag=>element(tag)};
  try{
    const model=fixture(),storageMap=new Map(),storage={getItem:k=>storageMap.get(k),setItem:(k,v)=>storageMap.set(k,v)};
    let copyAvailable=true;
    const copied=[];
    const ui=createUpdates({getModel:()=>model,copy:async text=>{if(!copyAvailable)throw new Error('剪贴板不可用');copied.push(text);},storage,location:{pathname:'/p/one/'}});
    ui.refresh();assert.equal(ids['updates-dot'].hidden,true);ids['updates-trigger'].handlers.click();assert.equal(ids['updates-content'].children[0].textContent,'暂无更新说明');ids['updates-dialog'].close();
    model.updates=[
      {id:'a',date:'2026-01-01',text:'旧变更'},
      {id:'b',date:'2026-10-28',text:'新变更 <无 HTML>',node:'one',label:'客户列表',changes:[{title:'3.1 超时规则',before:'等待 60 秒后丢弃。',after:'等待 5 分钟后兜底。'}]}
    ];ui.refresh();assert.equal(ids['updates-dot'].hidden,false);
    ids['updates-trigger'].handlers.click();assert.equal(ids['updates-dot'].hidden,true);const sections=ids['updates-content'].children;assert.equal(sections[0].children[0].textContent,'2026-10-28');
    const row=sections[0].children[1].children[0],head=row.children[0],diffBox=row.children[1];
    assert.equal(head.children[0].textContent,'新变更 <无 HTML>');
    const toggle=head.children[1];assert.equal(toggle.textContent,'查看变更');assert.equal(diffBox.hidden,true);
    toggle.onclick();assert.equal(diffBox.hidden,false);assert.equal(toggle.textContent,'收起变更');
    const diffItem=diffBox.children[0];assert.equal(diffItem.children[0].textContent,'3.1 超时规则');
    const beforeMarks=diffItem.children[1].children[1].children.filter(c=>c.tag==='mark').map(c=>c.textContent);
    const afterMarks=diffItem.children[2].children[1].children.filter(c=>c.tag==='mark').map(c=>c.textContent);
    assert.deepEqual(beforeMarks,['60 秒后丢弃']);assert.deepEqual(afterMarks,['5 分钟后兜底']);
    toggle.onclick();assert.equal(diffBox.hidden,true);assert.equal(toggle.textContent,'查看变更');
    await head.children[2].onclick();
    assert.match(copied[0],/等待 60 秒后丢弃。/);
    assert.doesNotMatch(copied[0],/旧变更/);
    const baseline=ids['updates-baseline'],rangeButton=ids['updates-copy-range'];
    assert.equal(rangeButton.disabled,true);
    baseline.value='1';baseline.handlers.change();
    assert.equal(rangeButton.disabled,false);
    await rangeButton.onclick();
    assert.match(copied[1],/2026-01-01之后（旧变更） → 2026-10-28/);
    copyAvailable=false;
    await rangeButton.onclick();
    assert.equal(ids['updates-copy-text'].hidden,false);
    assert.equal(ids['updates-copy-text'].selected,true);
    assert.equal(ids['updates-copy-text'].value,copied[1]);
    model.updates[1].text='修订后的变更';ui.refresh();assert.equal(ids['updates-dot'].hidden,false);
    model.title='另一个项目';ui.refresh();assert.equal(ids['updates-dot'].hidden,false);
    model.nodes=[];ids['updates-trigger'].handlers.click();assert.equal(ids['updates-content'].children[0].children[1].children[0].children[0].children.length,3);
    const plain=diffSegments('全新说明','另一句');assert.equal(plain.beforeParts[0].changed,false);assert.equal(plain.afterParts[0].changed,false);
  }finally{globalThis.document=oldDocument;}
});

test('区间复制保留起止原文，历史逐次保留，新增后撤回不出现在净变化中',()=>{
  const first={date:'2026-11-25',time:'09:00',text:'第一批',changes:[
    {key:'approval',title:'提交规则',before:'原文\n- 允许提交',after:'中间稿'},
    {key:'draft',title:'临时规则',before:'',after:'暂用文案'},
    {title:'展示规则',before:'折叠',after:'展开一次'},
    {title:'待补充的旧记录',after:'既有摘要'}
  ]};
  const last={date:'2026-11-25',time:'10:30:04',text:'第二批',changes:[
    {key:'approval',title:'3.1 提交条件',before:'中间稿',after:'终版\n\n| 权限 | 行为 |\n| --- | --- |\n| 有 | 提交 |'},
    {key:'draft',title:'临时规则',before:'暂用文案',after:''},
    {title:'展示规则',before:'展开一次',after:'默认展开'}
  ]};
  const summary={date:'2026-11-24',text:'旧摘要'};
  const updates=orderedUpdates([first,summary,last]);
  assert.deepEqual(updates,[last,first,summary]);
  const combined=formatUpdatesMarkdown('协作项目',updates,{combine:true});
  assert.match(combined,/3\.1 提交条件/);
  assert.match(combined,/原文\n- 允许提交/);
  assert.match(combined,/\| 有 \| 提交 \|/);
  assert.match(combined,/折叠[\s\S]*默认展开/);
  assert.match(combined,/待补充的旧记录[\s\S]*当时未记录/);
  assert.match(combined,/仅记录了摘要的更新[\s\S]*旧摘要/);
  assert.doesNotMatch(combined,/中间稿|展开一次|暂用文案|临时规则/);
  const historical=formatUpdatesMarkdown('协作项目',[first]);
  assert.match(historical,/09:00[\s\S]*中间稿[\s\S]*临时规则[\s\S]*（无正文）/);
  assert.equal(first.changes[0].after,'中间稿');
});

test('更新说明可与旧项目兼容，并发新增逐项合并，删除页面保留历史并校验对比格式',()=>{
  const base=fixture(),local=clone(base),remote=clone(base);assert.deepEqual(validate(base),[]);
  local.updates=[{id:'u1',date:'2026-10-28',text:'更新一',node:'one',changes:[{title:'规则',before:'旧',after:'新'}]}];remote.updates=[{id:'u2',date:'2026-10-28',text:'更新二'}];
  const result=mergeProject(base,local,remote);assert.deepEqual(result.conflicts,[]);assert.equal(result.model.updates.length,2);assert.deepEqual(validate(result.model),[]);
  removeNodes(result.model,['one']);assert.equal(result.model.updates.length,2);assert.deepEqual(validate(result.model),[]);
  result.model.updates.push({id:'u3',date:'2026-10-28',text:'空对比',changes:[{title:'x',before:' ',after:''}]});assert(validate(result.model).includes('更新说明格式不正确'));
  result.model.updates.pop();result.model.updates.push({id:'u1',date:'bad',text:''});assert(validate(result.model).includes('更新说明格式不正确'));
});

test('三种离线视图包含项目更新记录而不依赖项目扩展',async()=>{
  const model=fixture();model.updates=[{id:'u1',date:'2026-10-28',text:'这次更新',node:'one'}];
  const bundle={model,resources:{one:'<main>页面</main>'},fragments:{},images:{},documentSources:{}};
  for(const view of ['review','document','prototype']){const html=await standalone(bundle,{view});const boot=JSON.parse(html.match(/<script>globalThis\.YUANXING_BOOT=([\s\S]*?);<\/script>/)[1]);assert.deepEqual(boot.bundle.model.updates,model.updates);assert.match(html,/id="updates-trigger"/);assert.match(html,/id="updates-copy-range"/);assert.match(html,/function formatUpdatesMarkdown/);}
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
  const first=await run(['updates','add','--root',root,'--text','旧的变更','--date','2026-01-02','--section','1.1 背景','--before','原规则','--after','新规则']);assert.match(first.id,/^update-2026-01-02-[0-9a-f]{6}$/);
  assert.deepEqual(first.changes,[{title:'1.1 背景',before:'原规则',after:'新规则'}]);
  await run(['updates','add','--root',root,'--text','  新增页面说明  ','--date','2026-10-29','--node',node,'--label','打开页面','--id','update-new']);
  const saved=JSON.parse(await fs.readFile(file,'utf8'));assert.deepEqual(saved.updates.map(u=>u.id),['update-new',first.id]);assert.deepEqual(saved.updates[0],{id:'update-new',date:'2026-10-29',text:'新增页面说明',node,label:'打开页面'});
  assert.deepEqual({...saved,updates:undefined},{...before,updates:undefined});assert.deepEqual(validate(saved),[]);
  await assert.rejects(run(['updates','add','--root',root,'--text','重复','--id','update-new']),/已存在/);
  await assert.rejects(run(['updates','add','--root',root,'--text','页面','--node','missing']),/关联页面不存在/);
  await assert.rejects(run(['updates','add','--root',root,'--text','日期','--date','2026-02-30']),/日期/);
  await assert.rejects(run(['updates','add','--root',root,'--text','   ']),/不能为空/);
  await assert.rejects(run(['updates','add','--root',root,'--text','章节','--section','1.1 背景']),/--section 需搭配/);
  const listed=await run(['updates','list','--root',root,'--json']);assert.deepEqual(listed.map(u=>u.date),['2026-10-29','2026-01-02']);
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).updates.length,2);
  const addition=await run(['updates','add','--root',root,'--text','新增规则','--date','2026-10-29','--time','10:30:05','--section','新增','--key','approval','--before','','--after','新增的原文']);
  assert.equal(addition.time,'10:30:05');
  assert.deepEqual(addition.changes,[{title:'新增',key:'approval',before:'',after:'新增的原文'}]);
});
