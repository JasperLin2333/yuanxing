import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Readable} from 'node:stream';
import {run} from '../scripts/yuanxing.mjs';
import {readWorkspace,registerProject,createWorkspaceHandler} from '../runtime/workspace.mjs';
import {flowEntries,createPreviewQueue} from '../runtime/player.mjs';
import {validate,exportSubset,removeNodes,moduleNodes,recycleNodes} from '../runtime/core.mjs';

async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yuanxing-projects-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
async function request(handler,url,{method='GET',data,host='localhost:4318',token='session'}={}){
  const req=Readable.from(data?[JSON.stringify(data)]:[]);Object.assign(req,{url,method,headers:{host,authorization:'Bearer '+token}});let status,body,headers;
  await handler(req,{writeHead(code,value){status=code;headers=value;},end(value){body=value;}});return {status,headers,body,json:()=>JSON.parse(body)};
}
test('多项目在独立 URL 读写和导出，过期版本与其他项目均受保护',async t=>{
  const dir=await fixture(t),file=path.join(dir,'workspace.json');
  for(const id of ['a','b']){
    const root=path.join(dir,id),extension=path.join(root,'extension');await run(['init',root,'--template','iteration','--name',id]);await fs.mkdir(extension);
    await fs.writeFile(path.join(extension,'extension.json'),JSON.stringify({entry:'index.mjs',files:['dep.mjs','index.mjs']}));
    await fs.writeFile(path.join(extension,'dep.mjs'),`export const project='${id}';`);await fs.writeFile(path.join(extension,'index.mjs'),"import {project} from './dep.mjs';\nexport function createProjectExtension(){return {project};}");
    await registerProject(file,{id,root,extension});
  }
  const handler=createWorkspaceHandler(file,'session');
  assert.equal((await request(handler,'/')).headers.Location,'/p/a/');
  assert.equal((await request(handler,'/p/a/',{host:'evil.example'})).status,403);
  const index=await request(handler,'/p/b/');assert(index.body.includes('"projectId":"b"'));assert(index.body.includes('/p/b/app.mjs'));
  assert.equal((await request(handler,'/api/projects')).json().projects.length,2);
  assert((await request(handler,'/p/a/extension.mjs')).body.includes('/p/a/project-extension/dep.mjs'));
  assert((await request(handler,'/p/b/project-extension/dep.mjs')).body.includes("project='b'"));
  const a=(await request(handler,'/p/a/api/project')).json(),b=(await request(handler,'/p/b/api/project')).json();
  a.model.title='甲的修改';assert.equal((await request(handler,'/p/a/api/project',{method:'PUT',data:a})).status,200);
  assert.equal((await request(handler,'/p/a/api/project',{method:'PUT',data:a})).status,409);
  assert.equal((await request(handler,'/p/b/api/project')).json().model.title,b.model.title);
  const exported=await request(handler,'/p/b/api/export',{method:'POST',data:{view:'prototype'}});assert.equal(exported.status,200);assert(exported.body.includes('"title":"b"'));assert(!exported.body.includes('甲的修改'));
  assert.equal((await request(handler,'/p/missing/api/project')).status,404);
  await assert.rejects(registerProject(file,{id:'a',root:path.join(dir,'b')}),/其他目录/);
  await assert.rejects(registerProject(file,{id:'c',root:path.join(dir,'b')}),/已经登记/);
  assert.equal((await readWorkspace(file)).projects.length,2);
});
test('模块默认合成一个完整原型；平台入口可跨模块，删除与子集导出清理引用',()=>{
  const model={version:1,title:'产品',entryModule:'a',modules:[{id:'a',title:'A',entry:'one'},{id:'b',title:'B',entry:'two'}],nodes:[{id:'one',kind:'html',path:'one.html',module:'a',x:0,y:0,width:1280,height:800},{id:'two',kind:'html',path:'two.html',module:'b',x:500,y:0,width:390,height:844}],edges:[],annotations:[]};
  assert.deepEqual(flowEntries(model),[{id:'product',title:'产品',entry:'one'}]);
  model.experiences=[{id:'pc',title:'PC',entry:'one'},{id:'mobile',title:'移动端',entry:'two'}];assert.equal(flowEntries(model).length,2);assert.deepEqual(validate(model),[]);
  assert.deepEqual(exportSubset(model,'a').experiences,[model.experiences[0]]);
  removeNodes(model,['two']);assert.equal(model.experiences.length,1);assert.deepEqual(validate(model),[]);
  model.experiences.push({id:'missing',title:'错误',entry:'gone'});assert(validate(model).length>0);
});
test('大量缩略图分帧创建，离屏取消且切换画布不运行过期预览',()=>{
  const callbacks=new Map();let serial=0,mounted=[];const queue=createPreviewQueue({request:fn=>{callbacks.set(++serial,fn);return serial;},cancel:id=>callbacks.delete(id),batch:3});
  for(let i=0;i<100;i++)queue.add(i,()=>mounted.push(i));assert.equal(callbacks.size,1);
  queue.remove(1);const tick=()=>{const [id,fn]=callbacks.entries().next().value;callbacks.delete(id);fn();};tick();assert.deepEqual(mounted,[0,2,3]);assert.equal(callbacks.size,1);
  queue.clear();assert.equal(callbacks.size,0);queue.add('next',()=>mounted.push('next'));tick();assert.equal(mounted.at(-1),'next');assert.equal(mounted.length,4);
});

test('交互内部状态保留在完整原型和导出中，不进入用户画布或回收站',()=>{
  const model={version:1,title:'产品',modules:[{id:'a',title:'模块'}],nodes:[{id:'home',kind:'html',module:'a',width:100,height:100,x:0,y:0,path:'home.html'},{id:'result',kind:'html',module:'a',width:100,height:100,x:0,y:0,path:'result.html',overview:false,canvas:false}],edges:[{id:'submit',from:'home',to:'result',selector:'#submit'}],annotations:[]};
  assert.deepEqual(validate(model),[]);assert.deepEqual(moduleNodes(model,'a').map(n=>n.id),['home']);assert.equal(recycleNodes(model).length,0);assert.equal(exportSubset(model,'a').nodes.length,2);
});
