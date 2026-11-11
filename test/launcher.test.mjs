import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {Readable} from 'node:stream';
import {configureLauncher,launchArguments,launchIdentity,openWorkbench,probeWorkbench} from '../runtime/launcher.mjs';
import {desktopScript} from '../runtime/desktop.mjs';
import {createWorkspaceHandler,registerProject} from '../runtime/workspace.mjs';
import {standalone,createStore} from '../runtime/server.mjs';
import {run} from '../scripts/yuanxing.mjs';

async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yuanxing-launch-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
test('启动目标保留路径、扩展和工作区，不写入项目或随包文件',async t=>{
  const dir=await fixture(t),root=path.join(dir,'产品 with spaces'),home=path.join(dir,'local');
  await run(['init',root]);const file=path.join(root,'artifact/workbench.json'),before=await fs.readFile(file,'utf8');
  const configured=await configureLauncher({root,port:'4531',builder:'scripts/build.py'},{home});
  assert.deepEqual(await configureLauncher({}, {home}),configured);assert.equal(await fs.readFile(file,'utf8'),before);
  const changedPort=await configureLauncher({port:'4532'},{home});assert.equal(changedPort.port,4532);assert.equal(changedPort.root,configured.root);assert.equal(changedPort.builder,configured.builder);
  assert.equal((await configureLauncher({}, {home})).port,4532);await assert.rejects(configureLauncher({port:'0'},{home}),/端口/);
  assert.deepEqual(launchArguments(configured),['serve','--root',await fs.realpath(root),'--port','4531','--builder','scripts/build.py']);
  const alias=path.join(dir,'project-alias');await fs.symlink(root,alias);assert.equal(launchIdentity({root:alias}),launchIdentity({root}));
  await assert.rejects(configureLauncher({root,workspace:'elsewhere'},{home}),/只能指定一个/);
  await assert.rejects(configureLauncher({root,port:'0'},{home}),/端口/);
  await assert.rejects(configureLauncher({}, {home:path.join(dir,'unset')}),/尚未设置/);
});
test('迭代并发调用仅启动并开页一次；后续复用不开页；其他端口服务保持不动',async t=>{
  const home=await fixture(t),target={root:home,port:4318};let status=null,starts=0,opened=[];
  const options={home,browser:'once',probe:async()=>status,start:async()=>{starts++;await new Promise(resolve=>setTimeout(resolve,20));status={app:'yuanxing',identity:launchIdentity(target)};},openURL:async url=>opened.push(url)};
  const results=await Promise.all([openWorkbench(target,options),openWorkbench(target,options)]);
  assert.equal(starts,1);assert.deepEqual(results.map(item=>item.reused).sort(),[false,true]);assert.deepEqual(results.map(item=>item.browserOpened).sort(),[false,true]);assert.deepEqual(opened,['http://127.0.0.1:4318/']);
  const repeated=await openWorkbench(target,options);assert.equal(repeated.reused,true);assert.equal(repeated.browserOpened,false);assert.equal(opened.length,1);
  await openWorkbench(target,{...options,browser:false});assert.equal(opened.length,1);
  status={occupied:true};await assert.rejects(openWorkbench(target,options),/其他服务/);assert.equal(starts,1);
  status={app:'yuanxing',identity:launchIdentity({root:home+'other'})};await assert.rejects(openWorkbench(target,options),/其他服务/);
  assert.equal(opened.length,1);
  assert.deepEqual((await fs.readdir(home)).filter(name=>name.endsWith('.lock')),[]);
});
test('不打开浏览器可启动服务；显式打开可重新开页；服务重启后迭代仍可自动开页',async t=>{
  const home=await fixture(t),target={root:home,port:4318};let status=null,starts=0,opened=[];
  const options={home,probe:async()=>status,start:async()=>{starts++;status={app:'yuanxing',identity:launchIdentity(target)};},openURL:async url=>opened.push(url)};
  const hidden=await openWorkbench(target,{...options,browser:false});assert.equal(hidden.reused,false);assert.equal(hidden.browserOpened,false);assert.equal(opened.length,0);
  const reused=await openWorkbench(target,{...options,browser:'once'});assert.equal(reused.browserOpened,false);assert.equal(opened.length,0);
  const manual=await openWorkbench(target,options);assert.equal(manual.reused,true);assert.equal(manual.browserOpened,true);assert.equal(starts,1);assert.equal(opened.length,1);
  await openWorkbench(target,options);assert.equal(opened.length,2);assert.equal(starts,1);
  status=null;const restarted=await openWorkbench(target,{...options,browser:'once'});assert.equal(restarted.reused,false);assert.equal(restarted.browserOpened,true);assert.equal(starts,2);assert.equal(opened.length,3);
});
test('探测只接受元形的启动身份，普通本机网页不能冒充可复用工作台',async t=>{
  let value={app:'yuanxing',identity:'local-project'};
  const server=http.createServer((req,res)=>{assert.equal(req.url,'/api/launcher');res.end(JSON.stringify(value));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const port=server.address().port;assert.equal((await probeWorkbench(port)).identity,'local-project');value={hello:'world'};assert.deepEqual(await probeWorkbench(port),{occupied:true});
});
test('工作区记住已打开项目，入口校验已移除项目且项目指定仅影响本次打开',async t=>{
  const dir=await fixture(t),file=path.join(dir,'workspace.json');
  for(const id of ['a','b']){const root=path.join(dir,id);await run(['init',root]);await registerProject(file,{id,root});}
  const handler=createWorkspaceHandler(file,'session');
  async function request(url,cookie){const req=Readable.from([]);Object.assign(req,{method:'GET',url,headers:{host:'localhost:4318',cookie}});const headers={};let body;await handler(req,{setHeader:(k,v)=>headers[k]=v,writeHead:(code,values)=>Object.assign(headers,values),end:value=>body=value});return {headers,body};}
  const info=JSON.parse((await request('/api/launcher')).body);assert.equal(info.identity,launchIdentity({workspace:file}));
  const opened=await request('/p/b/'),cookie=opened.headers['Set-Cookie'].split(';')[0];assert.equal((await request('/',cookie)).headers.Location,'/p/b/');
  assert.equal((await request('/',cookie.replace('=b','=gone'))).headers.Location,'/p/a/');
  const options={home:path.join(dir,'home'),browser:'once',probe:async()=>info,openURL:async()=>assert.fail('复用工作区时不应因指定项目开页')};
  const result=await openWorkbench({workspace:file,port:4318},{...options,project:'b'});assert.equal(result.url,'http://127.0.0.1:4318/p/b/');assert.equal(result.browserOpened,false);
  await assert.rejects(openWorkbench({workspace:file,port:4318},{...options,project:'gone'}),/项目不存在/);
});
test('三个离线视图都有同一个启动入口；链接不携带项目数据，文件仍保持只读',async t=>{
  const dir=await fixture(t),root=path.join(dir,'project');await run(['init',root,'--template','iteration']);const bundle=await (await createStore(root)).load();
  for(const view of ['review','document','prototype']){
    const html=await standalone(bundle,{view});
    assert.match(html,/<a id="workbench-launch"[^>]*href="yuanxing:\/\/open"/);assert(html.indexOf('id="updates-trigger"')<html.indexOf('id="workbench-launch"'));assert(html.indexOf('id="workbench-launch"')<html.indexOf('id="export-menu"'));
    assert.match(html,/"readonly":true/);assert.match(html,/\.offline-share \.workbench-launch\{display:inline-flex\}/);
  }
});
test('原生启动入口只执行固定命令，不把网页 URL 当作文件、参数或脚本执行',()=>{
  const mac=desktopScript('darwin',{node:'/path with spaces/node',cli:"/path's tool/yuanxing.mjs"});assert.match(mac,/on run/);assert.match(mac,/on open location/);assert.equal((mac.match(/do shell script/g)||[]).length,1);assert.doesNotMatch(mac,/do shell script.*incomingURL/);
  const windows=desktopScript('win32',{node:'C:\\Program Files\\node.exe',cli:'C:\\元形\\yuanxing.mjs'});assert.match(windows,/& 'C:/);assert.doesNotMatch(windows,/WScript.Arguments|%1|\$args/);
});
