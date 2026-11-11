import {promises as fs,realpathSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const exec=promisify(execFile);
const entry=fileURLToPath(new URL('../scripts/yuanxing.mjs',import.meta.url));
export const launcherHome=()=>path.join(os.homedir(),'.yuanxing');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function canonical(value){try{return realpathSync(path.resolve(value));}catch(error){if(error.code==='ENOENT')return path.resolve(value);throw error;}}
export function launchIdentity(target){
  const data=target.workspace?{workspace:canonical(target.workspace)}:
    {root:canonical(target.root),builder:target.builder||null,validator:target.validator||null,extension:target.extension?canonical(target.extension):null};
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}
export function launchArguments(target){
  const args=['serve',target.workspace?'--workspace':'--root',target.workspace||target.root,'--port',String(target.port)];
  if(!target.workspace)for(const key of ['builder','validator','extension'])if(target[key])args.push('--'+key,target[key]);
  return args;
}
export async function configureLauncher(flags={}, {home=launcherHome()}={}){
  const file=path.join(home,'launcher.json');
  let previous;try{previous=JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(flags.root&&flags.workspace)throw new Error('--root 与 --workspace 只能指定一个');
  if(!flags.root&&!flags.workspace){
    if(!previous)throw new Error('尚未设置工作台，请先用 open --root <项目> 或 open --workspace <工作区.json> 打开一次。');
    if(!flags.port&&!flags.builder&&!flags.validator&&!flags.extension)return previous;
    const target={...previous};
    if(flags.port!==undefined){target.port=Number(flags.port);if(!Number.isInteger(target.port)||target.port<1||target.port>65535)throw new Error('端口应为 1～65535');}
    if(target.workspace&&(flags.builder||flags.validator||flags.extension))throw new Error('工作区的扩展与构建脚本由项目登记配置');
    for(const key of ['builder','validator'])if(flags[key])target[key]=flags[key];
    if(flags.extension)target.extension=await fs.realpath(path.resolve(flags.extension));
    await fs.mkdir(home,{recursive:true});
    const temporary=file+'.'+process.pid+'.tmp';
    await fs.writeFile(temporary,JSON.stringify(target,null,2)+'\n',{mode:0o600});await fs.rename(temporary,file);
    return target;
  }
  const target={version:1,port:Number(flags.port||4318)};
  if(!Number.isInteger(target.port)||target.port<1||target.port>65535)throw new Error('端口应为 1～65535');
  if(flags.workspace){
    target.workspace=await fs.realpath(path.resolve(flags.workspace));
    const {readWorkspace}=await import('./workspace.mjs');await readWorkspace(target.workspace);
  }else{
    target.root=await fs.realpath(path.resolve(flags.root));
    await fs.access(path.join(target.root,'artifact','workbench.json'));
    for(const key of ['builder','validator'])if(flags[key])target[key]=flags[key];
    if(flags.extension)target.extension=await fs.realpath(path.resolve(flags.extension));
  }
  await fs.mkdir(home,{recursive:true});
  const temporary=file+'.'+process.pid+'.tmp';
  await fs.writeFile(temporary,JSON.stringify(target,null,2)+'\n',{mode:0o600});await fs.rename(temporary,file);
  return target;
}
export function probeWorkbench(port){
  return new Promise(resolve=>{
    const req=http.get({hostname:'127.0.0.1',port,path:'/api/launcher',timeout:700},res=>{
      let body='';res.on('data',data=>{body+=data;if(body.length>8192)req.destroy();});
      res.on('end',()=>{try{const value=JSON.parse(body);resolve(res.statusCode===200&&value.app==='yuanxing'?value:{occupied:true});}catch{resolve({occupied:true});}});res.on('error',()=>resolve({occupied:true}));
    });
    req.on('timeout',()=>req.destroy());req.on('error',error=>resolve(error.code==='ECONNREFUSED'?null:{occupied:true}));
  });
}
export async function openBrowser(url){
  if(process.platform==='darwin')await exec('open',[url]);
  else if(process.platform==='win32')await exec('rundll32.exe',['url.dll,FileProtocolHandler',url]);
  else await exec('xdg-open',[url]);
}
// 锁只串行化启动，不关闭或替换已经运行的工作台。
async function lockLauncher(home){
  const lock=path.join(home,'launch.lock');await fs.mkdir(home,{recursive:true});
  for(let attempt=0;attempt<200;attempt++){
    try{await fs.mkdir(lock);await fs.writeFile(path.join(lock,'pid'),String(process.pid));return ()=>fs.rm(lock,{recursive:true,force:true});}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const pid=Number(await fs.readFile(path.join(lock,'pid'),'utf8').catch(()=>0));
      let alive=true;try{if(pid)process.kill(pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}
      const age=Date.now()-(await fs.stat(lock).catch(()=>({mtimeMs:Date.now()}))).mtimeMs;
      if(!alive||!pid&&age>30000){await fs.rm(lock,{recursive:true,force:true});continue;}
      await delay(100);
    }
  }
  throw new Error('另一个工作台正在启动，请稍后重试。');
}
export async function openWorkbench(target,{home=launcherHome(),browser=true,project,probe=probeWorkbench,start,openURL=openBrowser}={}){
  const release=await lockLauncher(home),identity=launchIdentity(target);
  let startedChild;
  try{
    let status=await probe(target.port),reused=!!status;
    if(status&&(status.app!=='yuanxing'||status.identity!==identity))throw new Error('端口已由其他服务或工作台占用，请使用 --port 指定其他端口；当前服务保持运行。');
    if(!status){
      if(start)await start(target);
      else{
        const log=await fs.open(path.join(home,'workbench.log'),'a',0o600);
        try{
          const child=spawn(process.execPath,[entry,...launchArguments(target)],{detached:true,stdio:['ignore',log.fd,log.fd],cwd:os.homedir()});
          await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});startedChild=child;child.unref();
        }finally{await log.close();}
      }
      const deadline=Date.now()+30000;
      while(Date.now()<deadline){
        status=await probe(target.port);if(status)break;await delay(250);
      }
      if(status?.app!=='yuanxing'||status.identity!==identity)throw new Error('工作台未能启动，请查看 '+path.join(home,'workbench.log'));
    }
    let suffix='/';
    if(project){if(!status.projects?.some(item=>item.id===project))throw new Error('启动项目不存在');suffix=`/p/${project}/`;}
    const url=`http://127.0.0.1:${target.port}${suffix}`;
    // Agent 迭代用 once 模式：仅本次新启动时开页；显式打开仍可唤起浏览器。
    const browserOpened=browser===true||browser==='once'&&!reused;
    if(browserOpened)await openURL(url);
    return {url,reused,browserOpened,...(startedChild?{pid:startedChild.pid}:{})};
  }catch(error){
    // 只清理本次创建且未成功启动的进程，不影响原有服务或已打开的工作台。
    if(startedChild&&(await probe(target.port))?.identity!==identity)startedChild.kill('SIGTERM');
    throw error;
  }finally{await release();}
}
