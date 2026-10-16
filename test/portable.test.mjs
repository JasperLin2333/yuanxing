import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {createStore,standalone,createHandler,safePath} from '../runtime/server.mjs';
import {validate,exportSubset,removeNodes,eligibleEdges,History,clone} from '../runtime/core.mjs';
import {flowEntries,cleanContext,prototypeDocument,thumbnailHTML,pageBridge} from '../runtime/player.mjs';
import {inlineHTML} from '../runtime/resources.mjs';
import {run} from '../scripts/yuanxing.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
async function temporary(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yuanxing-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
async function sample(t){const dir=await temporary(t),project=path.join(dir,'项目 with spaces');await fs.cp(path.join(root,'examples/product-iteration'),project,{recursive:true});return project;}

test('案例共用旧截图，根据角色进入不同分支，批注不改变跳转',async t=>{
  const store=await createStore(await sample(t)),bundle=await store.load(),model=bundle.model;
  assert.deepEqual(validate(model),[]);assert.equal(model.nodes.filter(n=>n.kind==='image').length,1);
  assert.equal(eligibleEdges(model.edges.filter(e=>e.from==='list'),{role:'admin'})[0].to,'assign');
  assert.equal(eligibleEdges(model.edges.filter(e=>e.from==='list'),{role:'member'})[0].to,'permission');
  const before=JSON.stringify(model.edges);model.annotations[0].text='改为管理员权限';assert.equal(JSON.stringify(model.edges),before);
  assert(bundle.resources.list.startsWith('data:image/png;base64,'));assert.equal(flowEntries(model).length,2);
});

test('从同一来源导出两种离线单文件，所有脚本都能静态解析',async t=>{
  const bundle=await(await createStore(await sample(t))).load();
  for(const view of ['review','prototype']){
    const html=await standalone(bundle,{view});
    assert(!/<script\b[^>]*\bsrc=|<link\b[^>]*href="\//i.test(html));
    const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m=>!m[1].includes('text/plain'));
    assert.equal(scripts.length,3);
    for(const [,attrs,source] of scripts){const result=spawnSync(process.execPath,['--check',...(attrs.includes('module')?['--input-type=module']:[])],{input:source,encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
    assert(html.includes(`"view":"${view}"`));assert(html.includes('普通成员访问'));assert(html.includes('GNU LESSER GENERAL PUBLIC LICENSE'));assert(html.includes('Apache License'));
  }
});

test('文件版本冲突不覆盖外部变更，移动与撤销保留批注和手动布局',async t=>{
  const store=await createStore(await sample(t)),first=await store.readModel(),changed=clone(first.model);
  changed.nodes[0].x=-120;changed.annotations[0].text='用户补充';await store.save(changed,first.revision);
  await assert.rejects(store.save(first.model,first.revision),/外部修改/);
  const latest=await store.readModel();assert.equal(latest.model.nodes[0].x,-120);assert.equal(latest.model.annotations[0].text,'用户补充');
  const history=new History();history.push(latest.model);const edited=clone(latest.model);edited.nodes[0].x=999;
  const undone=history.undo(edited);assert.equal(undone.nodes[0].x,-120);assert.equal(undone.annotations[0].text,'用户补充');
});

test('删除入口清理流程引用，模块导出不携带无关流程',async t=>{
  const model=(await(await createStore(await sample(t))).readModel()).model;
  model.modules.push({id:'other',title:'其他模块',entry:'outside'});model.nodes.push({id:'outside',module:'other',title:'无关页面',kind:'note',width:640,height:320,x:0,y:0});model.flows.push({id:'outside-flow',title:'其他任务',entry:'outside'});
  assert.equal(exportSubset(model,'assignment').flows.length,2);
  removeNodes(model,['list']);assert(!model.flows.some(f=>f.entry==='list'));assert.notEqual(model.modules[0].entry,'list');assert(model.nodes.some(n=>n.id===model.modules[0].entry));assert.deepEqual(validate(model),[]);
});

test('页面脚本隔离，输入材料不能通过 closing script 注入导出外层',()=>{
  const html=prototypeDocument('<html><head><meta http-equiv="refresh" content="0;url=https://example.com"></head><body><input id="x"><script>document.querySelector("#x").value="ok";</script></body></html>',{token:'x',width:1280,height:800,context:{value:'</script><script>bad()</script>'},edges:[],annotations:[]});
  assert(!html.includes('http-equiv="refresh"'));assert(html.includes("connect-src 'none'"));assert(html.includes("script-src 'unsafe-inline'"));assert(html.includes('document.querySelector("#x")'));
  const bridge=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];assert(!bridge.includes('</script>'));new vm.Script(bridge);
  assert(prototypeDocument('<!doctype html><html><body>页面</body></html>',{context:{},edges:[],annotations:[]}).startsWith('<!doctype html>'));
  assert(prototypeDocument('<main>片段</main>',{context:{},edges:[],annotations:[]}).startsWith('<!doctype html>'));
  assert(!thumbnailHTML(html).includes('<script'));assert.deepEqual(cleanContext(JSON.parse('{"__proto__":"x","role":"admin","bad":[],"count":2}')),{role:'admin',count:2});
});

test('本地 CSS、图片与脚本内嵌，脚本中的 HTML 字符串不被当成资源路径',async t=>{
  const dir=await temporary(t);await fs.writeFile(path.join(dir,'pixel.png'),Buffer.from([137,80,78,71]));await fs.writeFile(path.join(dir,'base.css'),'body{background:url("pixel.png")}');await fs.writeFile(path.join(dir,'logic.js'),'const sample = \'<img src="dynamic.png">\';');
  const html=await inlineHTML('<link rel="stylesheet" href="base.css"><img src="pixel.png"><script src="logic.js"></script>',path.join(dir,'index.html'),dir);
  assert(!html.includes('<link'));assert(html.includes('data:image/png;base64,'));assert(html.includes('src="dynamic.png"'));assert(!html.includes('src="logic.js"'));
  await assert.rejects(inlineHTML('<img src="https://example.com/private.png">',path.join(dir,'index.html'),dir),/项目内/);
  await assert.rejects(inlineHTML('<script type="module">import x from "x"</script>',path.join(dir,'index.html'),dir),/模块/);
});

test('拒绝资源路径与符号链接越界',async t=>{
  const dir=await temporary(t),inside=path.join(dir,'inside');await fs.mkdir(inside);await fs.writeFile(path.join(dir,'secret.txt'),'secret');await fs.symlink(path.join(dir,'secret.txt'),path.join(inside,'escape.txt'));
  await assert.rejects(safePath(inside,'../secret.txt'),/越界/);await assert.rejects(safePath(inside,'escape.txt'),/越界/);
});

test('CLI 从空目录建项目、导入现有 HTML、连接并导出，保护输入原件',async t=>{
  const dir=await temporary(t),project=path.join(dir,'new'),input=path.join(dir,'input.html'),original='<html><body><button id="go">继续</button><script>document.title="保留本地脚本";</script></body></html>';
  await fs.writeFile(input,original);await run(['init',project,'--name','独立项目']);await run(['add','--root',project,'--source',input,'--id','first']);await run(['add','--root',project,'--source',input,'--id','second']);
  await run(['connect','--root',project,'--from','first','--to','second','--selector','#go']);await run(['check','--root',project]);await run(['export','--root',project,'--view','prototype']);
  assert.equal(await fs.readFile(input,'utf8'),original);assert((await fs.readFile(path.join(project,'dist/prototype.html'),'utf8')).includes('保留本地脚本'));
  await assert.rejects(run(['init',project]),/已存在/);await assert.rejects(run(['export','--root',project,'--view','prototype']),/已存在/);
  await assert.rejects(run(['connect','--root',project,'--from','first','--to','second']),/可操作跳转/);
});

test('本地 API 限制来源与会话令牌，不接受来自外部网页的写入',async t=>{
  const handler=createHandler(await createStore(await sample(t)),'test-token');
  async function request(host,authorization,origin){const req=Readable.from([JSON.stringify({})]);Object.assign(req,{method:'PUT',url:'/api/project',headers:{host,authorization,origin}});let status,body;await handler(req,{writeHead(value){status=value;},end(value){body=value;}});return{status,body};}
  assert.equal((await request('evil.example','Bearer test-token')).status,403);assert.equal((await request('localhost:4318','Bearer wrong')).status,403);assert.equal((await request('localhost:4318','Bearer test-token','https://evil.example')).status,403);
});

test('安装包脱离源码目录后可真实执行命令；符号链接和空格路径不会跳过入口',async t=>{
  const dir=await temporary(t),target=path.join(dir,'skills','yuanxing'),project=path.join(dir,'独立项目 with spaces');
  const installed=spawnSync(process.execPath,[path.join(root,'scripts/install.mjs'),'--target',target],{encoding:'utf8'});assert.equal(installed.status,0,installed.stderr);
  const alias=path.join(dir,'skill-link');await fs.symlink(target,alias,'dir');
  for(const args of [['init',project,'--template','iteration'],['check','--root',project],['export','--root',project,'--view','prototype']]){
    const result=spawnSync(process.execPath,[path.join(alias,'scripts/yuanxing.mjs'),...args],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert(result.stdout.trim().length>0,'CLI 没有执行入口');
  }
  assert((await fs.stat(path.join(project,'dist/prototype.html'))).size>1000);
  const again=spawnSync(process.execPath,[path.join(root,'scripts/install.mjs'),'--target',target],{encoding:'utf8'});assert.notEqual(again.status,0);assert((await fs.stat(path.join(target,'SKILL.md'))).isFile());
});

function bridgeFixture(){
  const listeners={},messages=[],targets=new Map(),fields=[];
  const doc={body:{},querySelector:selector=>targets.get(selector)||null,querySelectorAll:selector=>selector==='[data-yx-bind]'?fields:selector==='[data-yx-text]'?[...(targets.get('texts')||[])]:selector==='[data-yx-visible]'?[]:targets.has(selector)?[targets.get(selector)]:[],addEventListener:(type,handler)=>listeners[type]=handler};
  const context=vm.createContext({document:doc,window:{addEventListener(){}},parent:{postMessage:message=>messages.push(message)}});
  return {listeners,messages,targets,fields,run(config){vm.runInContext(`(${pageBridge.toString()})(${JSON.stringify({token:'frame',width:1280,height:800,annotations:[],edges:[],context:{},...config})})`,context);}};
}
test('真实运行页面桥：跨页输入恢复，点击提交携带当前字段',()=>{
  const f=bridgeFixture(),field={dataset:{yxBind:'assignee'},value:'',type:'select-one'},button={disabled:false,type:'button',getAttribute:()=>null,closest:selector=>selector==='#confirm'?button:null};f.fields.push(field);f.run({context:{assignee:'许安'},edges:[{id:'confirm',selector:'#confirm'}]});
  assert.equal(field.value,'许安');field.value='顾言';f.listeners.input();f.listeners.click({target:button,preventDefault(){},stopImmediatePropagation(){}});
  const follow=f.messages.find(message=>message.type==='follow');assert.deepEqual([...follow.ids],['confirm']);assert.equal(follow.context.assignee,'顾言');
});
test('真实运行页面桥：声明式局部弹窗与普通批注相互独立',()=>{
  const f=bridgeFixture(),panel={hidden:true},button={dataset:{yxAction:'show',yxTarget:'#dialog'},disabled:false,getAttribute:()=>null,closest:selector=>selector==='[data-yx-action]'?button:null};f.targets.set('#dialog',panel);f.run({});f.listeners.click({target:button,preventDefault(){}});assert.equal(panel.hidden,false);assert(!f.messages.some(message=>message.type==='follow'));
});
