import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Readable} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {createStore,standalone,createHandler,loadProjectExtension} from '../runtime/server.mjs';
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'yuanxing-extension-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'artifact/pages'),{recursive:true});await fs.mkdir(path.join(root,'extension'));
  const model={version:1,title:'项目扩展测试',modules:[{id:'main',title:'主流程',entry:'home'}],nodes:[{id:'home',module:'main',kind:'html',title:'首页',path:'pages/home.html',width:1280,height:800,x:60,y:60}],edges:[],annotations:[]};
  await fs.writeFile(path.join(root,'artifact/workbench.json'),JSON.stringify(model));await fs.writeFile(path.join(root,'artifact/pages/home.html'),'<button id="go" onclick="run()">继续</button><script>function run(){}</script>');
  await fs.writeFile(path.join(root,'extension/extension.json'),JSON.stringify({entry:'index.mjs',files:['state.mjs','index.mjs'],declarative:true}));
  await fs.writeFile(path.join(root,'extension/state.mjs'),'export const state={title:"本地专用标记"};\n');
  await fs.writeFile(path.join(root,'extension/index.mjs'),'import {state} from "./state.mjs";\nexport function createProjectExtension(){return {declarative:true,title:state.title};}\n');
  return {root,extension:path.join(root,'extension')};
}
async function request(handler,url,method='GET',data){
  const req=Readable.from(data?[JSON.stringify(data)]:[]);Object.assign(req,{method,url,headers:{host:'localhost:4318',authorization:'Bearer session'}});let status,body;
  await handler(req,{writeHead(code){status=code;},end(value){body=value;}});return {status,body};
}
test('项目扩展由显式参数载入；通用项目保留原生脚本，声明式项目移除页面脚本',async t=>{
  const f=await fixture(t),plain=await createStore(f.root),project=await createStore(f.root,{extension:f.extension});
  assert((await plain.load()).resources.home.includes('<script>'));const bundle=await project.load();assert(!bundle.resources.home.includes('<script>'));assert(!bundle.resources.home.includes('onclick='));assert.equal(project.extension.declarative,true);
  const handler=createHandler(project,'session');const entry=await request(handler,'/extension.mjs');assert.equal(entry.status,200);assert(entry.body.includes('from "/project-extension/state.mjs"'));
  assert.equal((await request(handler,'/project-extension/state.mjs')).status,200);assert.equal((await request(handler,'/project-extension/extension.json')).status,404);assert.equal((await request(handler,'/project-extension/../artifact/workbench.json')).status,404);
  assert(!(await request(createHandler(plain,'session'),'/extension.mjs')).body.includes('本地专用标记'));
});
test('配置的项目扩展和依赖可离线内嵌，默认导出不携带专用扩展',async t=>{
  const f=await fixture(t),store=await createStore(f.root,{extension:f.extension}),bundle=await store.load();
  const handler=createHandler(store,'session'),result=await request(handler,'/api/export','POST',{view:'prototype',extension:'/cannot-override-server-config'});assert.equal(result.status,200);
  const html=result.body;assert(html.includes('本地专用标记'));assert(!html.includes('from "./state.mjs"'));assert(!/<script\b[^>]*\bsrc=/.test(html));assert(!html.includes(f.root));
  for(const [,attributes,source] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g))if(attributes.includes('module')){const parsed=spawnSync(process.execPath,['--check','--input-type=module'],{input:source,encoding:'utf8'});assert.equal(parsed.status,0,parsed.stderr);}
  assert(!(await standalone(bundle)).includes('本地专用标记'));
});
test('扩展清单限制依赖顺序和目录边界，符号链接不能读取目录外文件',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.extension,'extension.json'),JSON.stringify({entry:'index.mjs',files:['index.mjs','state.mjs']}));await assert.rejects(loadProjectExtension(f.extension),/顺序|末尾/);
  await fs.writeFile(path.join(f.extension,'extension.json'),JSON.stringify({entry:'escape.mjs',files:['escape.mjs']}));await fs.writeFile(path.join(f.root,'outside.mjs'),'export const secret="outside";');await fs.symlink(path.join(f.root,'outside.mjs'),path.join(f.extension,'escape.mjs'));await assert.rejects(loadProjectExtension(f.extension),/越界/);
});
