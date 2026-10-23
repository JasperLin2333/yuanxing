import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {locateProject,formatLocateResult} from '../runtime/locate.mjs';
import {run} from '../scripts/yuanxing.mjs';

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'yuanxing-locate-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'artifact'));
  const model={version:1,title:'客户分配',modules:[{id:'assignment',title:'分配客户'},{id:'settings',title:'设置',sources:['source/settings.html']}],nodes:[
    {id:'list',module:'assignment',title:'客户列表',kind:'html',path:'pages/list.html',description:'权限检查',summary:'发起分配'},
    {id:'assign',module:'assignment',title:'分配表单',kind:'html',path:'generated/assign.html',render:{view:'assign'},sources:['source/assign.html']},
    {id:'settings',module:'settings',title:'设置首页',kind:'html',path:'generated/settings.html',render:{view:'settings'}}
  ],edges:[],annotations:[],document:{version:1,blocks:[{id:'rule',type:'source',path:'需求.md',section:'分配规则',nodes:['list','assign']},{id:'other',type:'source',path:'需求.md',section:'设置',nodes:['settings']}]}};
  await fs.writeFile(path.join(root,'artifact/workbench.json'),JSON.stringify(model));await fs.writeFile(path.join(root,'需求.md'),'# 客户分配\n\n## 分配规则\n仅管理员可分配。\n### 取消\n保留原状态。\n\n## 设置\n未选择章节的正文。\n');
  return {root,model};
}
test('概览与定位只读元数据，不依赖预览文件、构建器或扩展',async t=>{
  const {root}=await fixture(t),before=await fs.readFile(path.join(root,'artifact/workbench.json'),'utf8');
  const overview=await locateProject(root);assert.deepEqual(overview.modules.map(item=>item.pages),[2,1]);assert(!('pages' in overview));
  const result=await run(['locate','--root',root,'--query','assign','--builder','missing.py','--extension','missing-extension']);assert.equal(result.pages[0].id,'assign');assert.deepEqual(result.pages[0].editingSources,['source/assign.html']);assert.equal(await fs.readFile(path.join(root,'artifact/workbench.json'),'utf8'),before);assert(!await fs.stat(path.join(root,'dist')).catch(()=>false));
});
test('同时给出正确编辑源与最新正文行号，不把无关正文送入结果',async t=>{
  const {root}=await fixture(t);const first=await locateProject(root,{query:'分配客户'});assert.deepEqual(first.pages.find(page=>page.id==='list').editingSources,['artifact/pages/list.html']);assert.deepEqual(first.requirements,[{path:'需求.md',section:'分配规则',startLine:3,endLine:6}]);assert(!JSON.stringify(first).includes('仅管理员'));assert(!JSON.stringify(first).includes('未选择章节'));
  const file=path.join(root,'需求.md');await fs.writeFile(file,'新增说明\n'+await fs.readFile(file,'utf8'));assert.equal((await locateProject(root,{query:'assign'})).requirements[0].startLine,4);
  const settings=await locateProject(root,{module:'settings'});assert.deepEqual(settings.pages[0].editingSources,['source/settings.html']);assert.equal(settings.requirements.length,1);assert.equal(settings.requirements[0].section,'设置');
});
test('结果限制、正文兜底与未知生成来源保持明确',async t=>{
  const {root,model}=await fixture(t);const limited=await locateProject(root,{query:'分配客户',limit:1});assert.equal(limited.totalMatches,2);assert.equal(limited.pages.length,1);assert.equal(limited.truncated,true);
  const fallback=await locateProject(root,{query:'权限检查'});assert.equal(fallback.matchedBy,'说明正文');assert.equal(fallback.pages[0].id,'list');assert.deepEqual((await locateProject(root,{query:'不存在'})).pages,[]);
  delete model.nodes[1].sources;await fs.writeFile(path.join(root,'artifact/workbench.json'),JSON.stringify(model));assert.deepEqual((await locateProject(root,{query:'assign'})).pages[0].editingSources,[]);
  await assert.rejects(locateProject(root,{limit:0}),/数量/);await assert.rejects(locateProject(root,{module:'missing'}),/不存在/);
});
test('正文定位遵守项目边界并暴露失效章节',async t=>{
  const {root,model}=await fixture(t);model.document.blocks[0].section='已删除';await fs.writeFile(path.join(root,'artifact/workbench.json'),JSON.stringify(model));await assert.rejects(locateProject(root,{query:'assign'}),/标题不存在/);
  model.document.blocks[0].path='../outside.md';await fs.writeFile(path.join(root,'artifact/workbench.json'),JSON.stringify(model));await assert.rejects(locateProject(root,{query:'assign'}),/越界/);
});

test('精简结果保留页面、去重编辑源及正文行号，不输出渲染配置或预览副本',async t=>{
  const {root,model}=await fixture(t);model.nodes[0].sources=['source/shared.html'];model.nodes[1].sources=['source/shared.html'];model.nodes[1].render.large='不应读入上下文'.repeat(1000);
  await fs.writeFile(path.join(root,'artifact/workbench.json'),JSON.stringify(model));
  const result=await locateProject(root,{query:'分配客户'}),text=formatLocateResult(result);
  for(const page of result.pages)assert(text.includes(page.id));
  assert.equal(text.split('source/shared.html').length-1,1);assert(text.includes('需求.md:3-6'));
  assert(!text.includes('不应读入上下文'));assert(!text.includes('generated/assign.html'));
  assert(text.length<JSON.stringify(result).length/10);assert(result.pages.some(page=>page.render?.large),'完整元数据保持可获取');
});

test('help、locate 和空项目创建脱离服务与布线引擎运行，--json 保留结构化输出',async t=>{
  const {root}=await fixture(t),minimal=await fs.mkdtemp(path.join(os.tmpdir(),'yuanxing-light-cli-'));t.after(()=>fs.rm(minimal,{recursive:true,force:true}));
  const source=fileURLToPath(new URL('../',import.meta.url));
  for(const relative of ['scripts/yuanxing.mjs','runtime/locate.mjs','runtime/document.mjs','runtime/paths.mjs']){const target=path.join(minimal,relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(source,relative),target);}
  const cli=path.join(minimal,'scripts/yuanxing.mjs');
  for(const args of [['help'],['locate','--root',root,'--query','assign'],['init',path.join(minimal,'new-project')]]){
    const result=spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert(result.stdout.trim());
  }
  const result=spawnSync(process.execPath,[cli,'locate','--root',root,'--query','assign','--json'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);const data=JSON.parse(result.stdout);assert.equal(data.pages[0].id,'assign');assert.deepEqual(data.pages[0].editingSources,['source/assign.html']);
  const missing=spawnSync(process.execPath,[cli,'locate'],{encoding:'utf8'});assert.notEqual(missing.status,0);assert.match(missing.stderr,/--root/);
});
