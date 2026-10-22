import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {defaultDocument,ensureDocument,findDocumentBlock,newDocumentBlock,moveDocumentBlock,walkDocument,extractDocumentSource,documentSourceKey} from '../runtime/document.mjs';
import {clone,validate,removeNodes,removeConnections,exportSubset,mergeProject,descriptionImagePaths,markdown,readDescription,requirementText,canvasExplanation,writeCanvasExplanation} from '../runtime/core.mjs';
import {documentPrototypeLayout} from '../runtime/document-player.mjs';
import {createCompatibilityBundle} from '../runtime/compatibility.mjs';
import {createStore,standalone,createHandler} from '../runtime/server.mjs';
import {Readable} from 'node:stream';
import {run} from '../scripts/yuanxing.mjs';

const sample=()=>({version:1,title:'客户分配',modules:[{id:'main',title:'分配客户',entry:'list'},{id:'other',title:'独立功能',entry:'other'}],nodes:[
  {id:'list',module:'main',title:'客户列表',kind:'html',path:'pages/list.html',width:1280,height:800,x:0,y:0,description:'选择客户后分配。'},
  {id:'detail',module:'main',title:'分配表单',kind:'html',path:'pages/detail.html',width:1280,height:800,x:500,y:0,description:'填写负责成员。'},
  {id:'other',module:'other',title:'独立页面',kind:'html',path:'pages/other.html',width:1280,height:800,x:0,y:0,description:'独立说明。'}
],edges:[{id:'open',from:'list',to:'detail',label:'分配',selector:'#open'}],annotations:[]});
async function project(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'yuanxing-document-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'artifact/pages'),{recursive:true});await fs.mkdir(path.join(root,'artifact/assets'));const model=sample();ensureDocument(model);model.document.blocks.unshift({id:'intro',type:'text',format:'heading1',text:'本次需求'});await fs.writeFile(path.join(root,'artifact/workbench.json'),JSON.stringify(model));for(const node of model.nodes)await fs.writeFile(path.join(root,'artifact',node.path),'<main><button id="open">分配</button><input id="name"><script>document.querySelector("#name").value="顾言";</script></main>');return {root,model};}

test('旧项目打开文档时保持源数据不变，页面与说明引用同一个对象',()=>{
  const model=sample(),before=JSON.stringify(model),doc=defaultDocument(model);assert.equal(JSON.stringify(model),before);
  assert(!doc.blocks.some(b=>b.type==='table'));let page,description;walkDocument(doc.blocks,block=>{if(block.node==='detail'&&block.type==='prototype')page=block;if(block.node==='detail'&&block.type==='description')description=block;});assert(page&&description);assert(doc.blocks.indexOf(page)<doc.blocks.indexOf(description));assert(!('text' in description));
  ensureDocument(model);model.nodes[1].description='修改后规则';assert(!JSON.stringify(model.document).includes('填写负责成员'));assert.deepEqual(validate(model),[]);
});
test('正文能跨单元格编排，同时拒绝将分栏拖入自己的子内容',()=>{
  const model=sample();model.document={version:1,blocks:[newDocumentBlock('columns')]};const columns=model.document.blocks[0],left=columns.columns[0],right=columns.columns[1],id=left.blocks[0].id;
  left.blocks[0].text='业务条件';assert.equal(moveDocumentBlock(model,id,right.id),true);assert.equal(left.blocks.length,0);assert.equal(right.blocks.at(-1).text,'业务条件');assert.equal(moveDocumentBlock(model,columns.id,right.id),false);assert.deepEqual(validate(model),[]);
});
test('正文、编排和页面描述的独立修改通过共同基线合并',()=>{
  const base=sample();base.document={version:1,blocks:[{id:'intro',type:'text',text:'原说明'},{id:'page',type:'prototype',node:'list'}]};const local=clone(base),remote=clone(base);local.document.blocks[0].text='人工补充规则';remote.nodes[0].description='AI 更新页面说明';remote.document.blocks.push({id:'next',type:'text',text:'后续操作'});
  const result=mergeProject(base,local,remote);assert.deepEqual(result.conflicts,[]);assert.equal(result.model.document.blocks[0].text,'人工补充规则');assert.equal(result.model.document.blocks[2].text,'后续操作');assert.equal(result.model.nodes[0].description,'AI 更新页面说明');
  remote.document.blocks[0].text='另一份说明';assert(mergeProject(base,local,remote).conflicts.includes('document/blocks/intro/text'));
});
test('正文加粗、斜体和编号列表可保存再读取，业务文字被当作文本转义',()=>{
  const text=value=>({nodeType:3,textContent:value}),element=(tag,children)=>({nodeType:1,tagName:tag,childNodes:children,children:children.filter(n=>n.nodeType===1),hasAttribute:()=>false});
  const root=element('DIV',[element('P',[element('B',[text('重要规则')]),text('与'),element('I',[text('补充说明')])]),element('OL',[element('LI',[text('选择客户')]),element('LI',[text('确认结果')])])]);
  const saved=readDescription(root),html=markdown(saved);assert(saved.includes('**重要规则**'));assert(saved.includes('*补充说明*'));assert(saved.includes('1. 选择客户'));assert.match(html,/<strong>重要规则<\/strong>/);assert.match(html,/<em>补充说明<\/em>/);assert.match(html,/<ol><li>选择客户<\/li><li>确认结果<\/li><\/ol>/);assert(!markdown('<script>unexpected()</script>').includes('<script>'));
});
test('文档校验发现失效引用、重复标识、列数及非法图片路径',()=>{
  const model=sample();model.document={version:1,blocks:[{id:'bad',type:'prototype',node:'missing'},{id:'bad',type:'text',text:'正文'},{id:'image',type:'image',path:'../private.png'},newDocumentBlock('table')]};model.document.blocks[3].rows[1].cells.pop();const errors=validate(model).join('；');assert.match(errors,/不存在/);assert.match(errors,/重复/);assert.match(errors,/列数/);assert.match(errors,/图片/);
  model.document={version:1,blocks:[null,{id:'broken',type:'columns',columns:null}]};assert(validate(model).length>0);
});
test('删除源页面和操作后清除文档引用，模块导出只保留其实际页面',()=>{
  const model=sample();ensureDocument(model);model.document.blocks.push({id:'operation',type:'description',edge:'open'});removeConnections(model,['open']);assert(!findDocumentBlock(model,'operation'));removeNodes(model,['detail']);let ids=[];walkDocument(model.document.blocks,b=>ids.push(b.node));assert(!ids.includes('detail'));assert.deepEqual(validate(model),[]);
  const subset=exportSubset(model,'main');ids=[];walkDocument(subset.document.blocks,b=>ids.push(b.node));assert(!ids.includes('other'));assert.deepEqual(validate(subset),[]);
});
test('文档正文和独立图片的本地资源参与加载与导出',async t=>{
  const {root,model}=await project(t);model.document.blocks.push({id:'picture',type:'image',path:'assets/diagram.png',alt:'范围示意'},{id:'text-image',type:'text',text:'![说明](assets/diagram.png)'});await fs.writeFile(path.join(root,'artifact/assets/diagram.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nm9sAAAAASUVORK5CYII=','base64'));await fs.writeFile(path.join(root,'artifact/workbench.json'),JSON.stringify(model));assert.deepEqual(descriptionImagePaths(model),['assets/diagram.png']);const bundle=await(await createStore(root)).load();assert.match(bundle.images['assets/diagram.png'],/^data:image\/png/);
  const html=await standalone(bundle,{view:'document'});assert(html.includes('YUANXING_BOOT={"readonly":true,"view":"document"'));assert(html.includes('data:image/png;base64,'));
});
test('三种离线导出携带同一文档、页面源和可独立读取的研发数据，脚本语法有效',async t=>{
  const {root}=await project(t),bundle=await(await createStore(root)).load();bundle.model.document.blocks.push({id:'literal',type:'text',text:'原文 </script><script>unexpected()</script> 必须作为数据保留'});
  for(const view of ['review','prototype','document']){const html=await standalone(bundle,{view}),payload=JSON.parse(html.match(/<script id="yuanxing-artifact" type="application\/json">([\s\S]*?)<\/script>/)[1]);assert.deepEqual(payload.yuanxing.document,bundle.model.document);assert.equal(payload.manifest.requirements.length,2);assert.equal(Object.keys(payload.files).length,3);assert(!html.includes(root));
    for(const [,attrs,source] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/type="(?:application\/json|text\/plain)"/.test(attrs)){const parsed=spawnSync(process.execPath,['--check','--input-type',attrs.includes('module')?'module':'commonjs'],{input:source,encoding:'utf8'});assert.equal(parsed.status,0,parsed.stderr);}
  }
});
test('document CLI 使用独立输出并保护已有文件，开发入口提供文档模块',async t=>{
  const {root}=await project(t);await run(['export','--root',root,'--view','document']);assert((await fs.stat(path.join(root,'dist/document.html'))).size>1000);await assert.rejects(run(['export','--root',root,'--view','document']),/已存在/);
  const handler=createHandler(await createStore(root),'session');for(const url of ['/document.mjs','/document-player.mjs']){const request=Readable.from([]);Object.assign(request,{method:'GET',url,headers:{host:'localhost:4318'}});let status,body;await handler(request,{writeHead(code){status=code;},end(value){body=value;}});assert.equal(status,200);assert(body.includes('export function'));}
});

test('画布摘要修改不覆盖完整规则，详细正文修改也不抹去摘要',()=>{
  const model=sample(),node=model.nodes[0];model.rules={permission:'只有管理员可以分配。'};node.rule='permission';
  assert.equal(canvasExplanation(model,node),'选择客户后分配。\n\n只有管理员可以分配。');
  writeCanvasExplanation(node,'从列表发起客户分配。');assert.equal(canvasExplanation(model,node),'从列表发起客户分配。');assert.equal(requirementText(model,node),'选择客户后分配。\n\n只有管理员可以分配。');
  node.description='选择客户后进入分配表单。';assert.equal(canvasExplanation(model,node),'从列表发起客户分配。');assert(requirementText(model,node).includes('只有管理员'));
  const note={kind:'note',description:'流程说明'};writeCanvasExplanation(note,'补充说明');assert.equal(note.description,'补充说明');
  const base=clone(model),local=clone(base),remote=clone(base);writeCanvasExplanation(local.nodes[0],'人工摘要');remote.nodes[0].description='AI 补充完整规则';const merged=mergeProject(base,local,remote);assert.deepEqual(merged.conflicts,[]);assert.equal(merged.model.nodes[0].summary,'人工摘要');assert.equal(merged.model.nodes[0].description,'AI 补充完整规则');
});

test('引用章节包含子节，忽略代码中的伪标题并拒绝失效或重名定位',()=>{
  const text='# 需求\n## 背景\n原背景\n## 分配\n规则\n### 确认\n选成员\n```text\n## 伪标题\n```\n## 其他\n未选内容';
  const selected=extractDocumentSource(text,'分配');assert(selected.includes('选成员'));assert(selected.includes('## 伪标题'));assert(!selected.includes('未选内容'));assert(!extractDocumentSource(text,'分配',true).startsWith('## 分配'));
  assert.throws(()=>extractDocumentSource(text,'不存在'),/不存在/);assert.throws(()=>extractDocumentSource('## 重复\na\n## 重复\nb','重复'),/重复/);
  assert.match(markdown(selected),/<h2>分配<\/h2>/);assert.match(markdown(selected),/<h3>确认<\/h3>/);
});

test('引用正文与图片变化更新版本，离线及基础交付保留所选规则且不泄露未选章节',async t=>{
  const {root,model}=await project(t),file=path.join(root,'需求.md');
  await fs.writeFile(file,'# 需求\n## 分配\n只有管理员可分配。\n![规则](artifact/assets/rule.png)\n## 未选\n私有未选内容');
  const image=path.join(root,'artifact/assets/rule.png');await fs.writeFile(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nm9sAAAAASUVORK5CYII=','base64'));
  model.document={version:1,blocks:[{id:'requirements',type:'source',path:'需求.md',section:'分配',nodes:['list']}]};await fs.writeFile(path.join(root,'artifact/workbench.json'),JSON.stringify(model));
  const store=await createStore(root),first=await store.load(),status1=await store.status();assert(first.documentSources[documentSourceKey(model.document.blocks[0])].includes('只有管理员'));assert(Object.keys(first.images).some(key=>key.startsWith('assets/source-')));
  const payload=createCompatibilityBundle(first);assert(payload.manifest.requirements.flatMap(r=>r.logic).some(l=>l.text.includes('只有管理员')));assert(!JSON.stringify(payload).includes('私有未选内容'));
  const copied={...model.document.blocks[0],id:'copied-reference'};assert.equal(first.documentSources[documentSourceKey(copied)],first.documentSources[documentSourceKey(model.document.blocks[0])]);
  const html=await standalone(first,{view:'document'});assert(html.includes('只有管理员'));assert(!html.includes('私有未选内容'));assert(!html.includes(root));assert(html.includes('data:image/png;base64,'));
  await fs.writeFile(file,(await fs.readFile(file,'utf8')).replace('只有管理员','具备权限的管理员'));const second=await store.load();assert.notEqual(second.sourcesSignature,first.sourcesSignature);assert.notEqual((await store.status()).sourceVersion,status1.sourceVersion);
  const beforeImage=(await store.status()).sourceVersion;await fs.appendFile(image,Buffer.from([0]));assert.notEqual((await store.status()).sourceVersion,beforeImage);
});

test('正文引用保护项目边界，失效章节阻止导出，单模块不携带其他模块专属正文',async t=>{
  const {root,model}=await project(t);model.document={version:1,blocks:[{id:'owned',type:'source',path:'需求.md',section:'分配',nodes:['list']},{id:'other-owned',type:'source',path:'需求.md',section:'其他',nodes:['other']}]};
  const subset=exportSubset(model,'main');assert(findDocumentBlock(subset,'owned'));assert(!findDocumentBlock(subset,'other-owned'));assert.deepEqual(validate(subset),[]);
  model.document.blocks[0].path='../outside.md';assert(validate(model).some(error=>error.includes('路径')));model.document.blocks=[{id:'bad',type:'source',path:'需求.md',section:'不存在'}];await fs.writeFile(path.join(root,'需求.md'),'## 其他\n内容');await fs.writeFile(path.join(root,'artifact/workbench.json'),JSON.stringify(model));await assert.rejects((await createStore(root)).load(),/不存在/);
  await fs.symlink(path.join(root,'..'),path.join(root,'outside'));model.document.blocks[0].path='outside/secret.md';await fs.writeFile(path.join(root,'artifact/workbench.json'),JSON.stringify(model));await assert.rejects((await createStore(root)).load(),/越界|ENOENT/);
});

test('页面和组件自动按宽度与比例显示，仍兼容已有视口数据',()=>{
  const node={width:1280,height:800},page=documentPrototypeLayout(node,642);assert.equal(page.scale,.5);assert.equal(page.height,400);assert.equal(page.width,640);
  const component=documentPrototypeLayout(node,402,[100,200,176,100]);assert.equal(component.width,200);assert.equal(component.height,124);assert.equal(component.left,-88);assert.equal(component.top,-188);
  assert.equal(documentPrototypeLayout(node,642,null,480).height,480);
});
