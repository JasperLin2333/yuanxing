import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {createStore,createHandler,gracefulShutdown} from './server.mjs';

const validId=id=>typeof id==='string'&&/^[a-zA-Z][\w-]*$/.test(id);
export async function readWorkspace(file){
  file=path.resolve(file);const config=JSON.parse(await fs.readFile(file,'utf8'));
  if(config.version!==1||!Array.isArray(config.projects)||!config.projects.length)throw new Error('工作区需至少登记一个项目');
  const ids=new Set(),roots=new Set(),projects=[];
  for(const item of config.projects){
    if(!validId(item.id)||ids.has(item.id)||typeof item.root!=='string')throw new Error('项目标识重复或配置不正确');
    const root=await fs.realpath(path.resolve(path.dirname(file),item.root));
    if(roots.has(root))throw new Error('同一项目不能重复登记');
    ids.add(item.id);roots.add(root);
    projects.push({...item,root,extension:item.extension?path.resolve(root,item.extension):undefined});
  }
  if(config.defaultProject&&!ids.has(config.defaultProject))throw new Error('默认项目不存在');
  return {...config,projects,defaultProject:config.defaultProject||projects[0].id};
}

// 项目登记由 Agent 完成；工作台只提供切换。文件不放在 Skill 安装目录中。
export async function registerProject(file,{id,title,root,builder,validator,extension}){
  if(!validId(id))throw new Error('请指定字母开头的项目 --id');
  file=path.resolve(file);root=await fs.realpath(path.resolve(root));
  const store=await createStore(root,{builder,validator,extension});await store.readModel();
  await fs.mkdir(path.dirname(file),{recursive:true});
  const lock=await fs.open(file+'.lock','wx').catch(error=>{if(error.code==='EEXIST')throw new Error('工作区正在更新，请稍后重试');throw error;});
  const tmp=file+'.'+randomUUID()+'.tmp';
  try{
    let config;try{config=JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;config={version:1,defaultProject:id,projects:[]};}
    if(config.projects.length)await readWorkspace(file);
    const previous=config.projects.find(item=>item.id===id);
    if(previous&&await fs.realpath(path.resolve(path.dirname(file),previous.root))!==root)throw new Error('项目标识已被其他目录使用');
    for(const item of config.projects)if(item.id!==id&&await fs.realpath(path.resolve(path.dirname(file),item.root))===root)throw new Error('此项目已经登记为 '+item.id);
    const item={id,title:title||previous?.title||(await store.readModel()).model.title,root:path.relative(path.dirname(file),root)||'.'};
    for(const [key,value] of Object.entries({builder,validator,extension:extension?path.relative(root,path.resolve(extension)):undefined}))if(value)item[key]=value;else if(previous?.[key])item[key]=previous[key];
    if(previous)config.projects[config.projects.indexOf(previous)]=item;else config.projects.push(item);
    await fs.writeFile(tmp,JSON.stringify(config,null,2)+'\n',{flag:'wx'});await fs.rename(tmp,file);
    return item;
  }finally{await fs.rm(tmp,{force:true});await lock.close();await fs.rm(file+'.lock',{force:true});}
}

export function createWorkspaceHandler(file,token,{project}={}){
  const stores=new Map();
  return async(req,res)=>{
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    try{
      if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host||''))return send(403,{error:'仅允许本机访问'});
      const config=await readWorkspace(file),url=new URL(req.url,'http://localhost');
      const projects=config.projects.map(({id,title})=>({id,title:title||id,url:`/p/${id}/`}));
      if(req.method==='GET'&&url.pathname==='/api/projects')return send(200,{projects});
      if(req.method==='GET'&&url.pathname==='/'){
        const id=project||config.defaultProject;if(!projects.some(item=>item.id===id))throw new Error('启动项目不存在');
        res.writeHead(302,{Location:`/p/${id}/`,'Cache-Control':'no-store'});res.end();return;
      }
      const match=url.pathname.match(/^\/p\/([a-zA-Z][\w-]*)\/(.*)$/),item=match&&config.projects.find(item=>item.id===match[1]);
      if(!item)return send(404,{error:'项目入口不存在'});
      const key=JSON.stringify(item);if(!stores.has(key))stores.set(key,createStore(item.root,item));
      const store=await stores.get(key),basePath=`/p/${item.id}`;
      req.url='/'+match[2]+url.search;
      return createHandler(store,token,{basePath,projectId:item.id,projects})(req,res);
    }catch(error){send(error.status||400,{error:error.message});}
  };
}

export async function serveWorkspace(file,{port=4318,open=false,project,sessionToken}={}){
  const config=await readWorkspace(file);if(project&&!config.projects.some(item=>item.id===project))throw new Error('启动项目不存在');
  const server=gracefulShutdown(createServer(createWorkspaceHandler(file,sessionToken||randomBytes(24).toString('hex'),{project})));
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'端口已占用，请指定 --port。':error.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>{
    const url=`http://127.0.0.1:${server.address().port}`;console.log(`元形工作区：${url}`);
    if(open){const command=process.platform==='darwin'?'open':process.platform==='win32'?'cmd':'xdg-open';execFile(command,process.platform==='win32'?['/c','start','',url]:[url],error=>{if(error)console.log(`请在浏览器打开 ${url}`);});}
  });return server;
}
