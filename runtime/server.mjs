import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {inlineHTML} from './resources.mjs';
import {validate,exportSubset,expandHTML,importManifest,exportIssues,descriptionImagePaths} from './core.mjs';
const tool=path.dirname(fileURLToPath(import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');
const inside=(root,target)=>target===root||target.startsWith(root+path.sep);
export async function safePath(root,relative,writing=false){
  if(typeof relative!=='string'||path.isAbsolute(relative)||relative.includes('\\')||relative.split('/').includes('..'))throw new Error('资源路径越界');
  const target=path.resolve(root,relative);if(!inside(root,target))throw new Error('资源路径越界');
  const canonicalRoot=await fs.realpath(root),real=await fs.realpath(writing?path.dirname(target):target);if(!inside(canonicalRoot,real))throw new Error('资源符号链接越界');
  if(writing)try{if(!inside(canonicalRoot,await fs.realpath(target)))throw new Error('资源符号链接越界');}catch(error){if(error.code!=='ENOENT')throw error;}
  return target;
}
// 版本探测只读文件元数据，不重复读取和编码页面、图片。ctime 同时覆盖保留 mtime 的替换。
async function fingerprint(target){
  try{
    const stat=await fs.lstat(target,{bigint:true});
    if(stat.isDirectory()){
      const names=(await fs.readdir(target)).filter(name=>!['__pycache__','.workbench-snapshots','workbench.json'].includes(name)&&!name.endsWith('.tmp')).sort();
      return sha(JSON.stringify(await Promise.all(names.map(async name=>[name,await fingerprint(path.join(target,name))]))));
    }
    return sha([stat.mode,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs,stat.isSymbolicLink()?await fs.readlink(target):''].join(':'));
  }catch(error){if(error.code==='ENOENT')return 'missing';throw error;}
}
function assertOffline(text,label){
  if(/<(?:iframe|object|embed)\b/i.test(text)||/@import\b/i.test(text)||/<script\b[^>]*\bsrc\s*=/i.test(text)||/\s(?:src|href)\s*=\s*["'](?:https?:|\/\/|file:)/i.test(text))throw new Error(`${label} 含未内嵌的资源`);
}
export async function createStore(root){
  root=await fs.realpath(root);const artifact=await fs.realpath(path.join(root,'artifact')),modelFile=path.join(artifact,'workbench.json');if(!inside(root,artifact))throw new Error('artifact 目录越界');let queue=Promise.resolve();
  async function readModel(){try{const raw=await fs.readFile(await safePath(artifact,'workbench.json'),'utf8');return {model:JSON.parse(raw),revision:sha(raw)};}catch(error){if(error.code!=='ENOENT')throw error;const manifest=JSON.parse(await fs.readFile(await safePath(artifact,'manifest.json'),'utf8'));const model=importManifest(manifest);for(const r of manifest.requirements||[])for(const s of r.states||[]){const html=await fs.readFile(await safePath(artifact,s.html),'utf8');for(const t of r.transitions||[])if(html.includes(`data-transition-id="${t.id}"`))model.edges.push({id:`${r.id}:${s.id}:${t.id}`,from:`${r.id}:${s.id}`,to:`${r.id}:${t.to}`,label:t.id,selector:`[data-transition-id="${t.id}"]`});}return {model,revision:'import'};}}
  async function sourceVersion(){return fingerprint(artifact);}
  async function status(){const {revision}=await readModel();return {revision,sourceVersion:await sourceVersion()};}
  async function load(){const {model,revision}=await readModel(),errors=validate(model);if(errors.length)throw new Error(errors.join('；'));const resources={},fragments={},images={};
    async function readImage(relative){const file=await safePath(artifact,relative),mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[path.extname(file).toLowerCase()];if(!mime)throw new Error('图片格式不支持');return `data:${mime};base64,${(await fs.readFile(file)).toString('base64')}`;}
    async function addFragment(key,trail=[]){if(trail.includes(key))throw new Error('组件循环引用');if(fragments[key]!==undefined)return;const file=await safePath(artifact,key),text=await inlineHTML(await fs.readFile(file,'utf8'),file,artifact);fragments[key]=text;for(const match of text.matchAll(/<!--\s*include:([^>]+?)\s*-->/g))await addFragment(match[1],[...trail,key]);}
    for(const n of model.nodes){if(n.kind==='note')continue;const file=await safePath(artifact,n.path);if(n.kind==='image'){resources[n.id]=await readImage(n.path);}else{resources[n.id]=await inlineHTML(await fs.readFile(file,'utf8'),file,artifact);for(const match of resources[n.id].matchAll(/<!--\s*include:([^>]+?)\s*-->/g))await addFragment(match[1]);assertOffline(expandHTML(resources[n.id],fragments),n.title);}}
    for(const relative of descriptionImagePaths(model)){try{images[relative]=await readImage(relative);}catch(error){throw new Error(`说明图片无法读取：${relative}（${error.code==='ENOENT'?'文件不存在':error.message}）`);}}
    return {model,revision,resources,fragments,images,sourcesSignature:sha(JSON.stringify(resources)+JSON.stringify(fragments)+JSON.stringify(images)),sourceVersion:await sourceVersion(model)};
  }
  async function transaction(operation){const previous=queue;let release;queue=new Promise(resolve=>release=resolve);await previous;try{return await operation();}finally{release();}}
  function assertRevision(actual,revision,required=false){if((required||revision!==undefined)&&actual.revision!==revision){const error=new Error('项目已被外部修改');error.status=409;throw error;}}
  function assertModel(model){const errors=validate(model);if(errors.length)throw new Error(errors.join('；'));}
  async function writeModel(model,revision){const raw=JSON.stringify(model,null,2)+'\n',tmp=modelFile+'.'+randomUUID()+'.tmp';await fs.writeFile(tmp,raw,{flag:'wx'});try{assertRevision(await readModel(),revision);await fs.rename(tmp,modelFile);}finally{await fs.rm(tmp,{force:true});}return {revision:sha(raw)};}
  async function materializeCopies(model){for(const node of model.nodes.filter(n=>n.kind==='html'&&n.copySourcePath)){const target=await safePath(artifact,node.path,true);try{await fs.access(target);continue;}catch(error){if(error.code!=='ENOENT')throw error;}const source=await safePath(artifact,node.copySourcePath);await fs.copyFile(source,target,1);}}
  async function save(model,revision){return transaction(async()=>{assertModel(model);const actual=await readModel();assertRevision(actual,revision,true);if(sha(JSON.stringify(model,null,2)+'\n')===actual.revision)return {revision:actual.revision};await materializeCopies(model);return writeModel(model,actual.revision);});}
  async function upload({type,data}){const allowed={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'};if(!allowed[type]||typeof data!=='string'||!data.startsWith(`data:${type};base64,`))throw new Error('图片格式不支持');const bytes=Buffer.from(data.split(',')[1],'base64');const valid=type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='image/jpeg'?bytes[0]===255&&bytes[1]===216:bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';if(!valid)throw new Error('图片内容不正确');await fs.mkdir(path.join(artifact,'assets'),{recursive:true});const relative=`assets/${randomUUID()}.${allowed[type]}`;await fs.writeFile(await safePath(artifact,relative,true),bytes,{flag:'wx'});return {path:relative};}
  async function check(){const {model}=await readModel(),errors=validate(model);if(errors.length)throw new Error(errors.join('；'));}
  return {root,artifact,load,status,readModel,save,upload,check};
}
export async function standalone(bundle,{module,entryModule,view='review',flow}={}){
  if(!['review','prototype'].includes(view))throw new Error('导出视图不正确');
  const model=exportSubset(bundle.model,module);if(entryModule&&model.modules.some(m=>m.id===entryModule))model.entryModule=entryModule;
  const errors=exportIssues(model);if(errors.length)throw new Error(errors.join('；'));
  const resources=Object.fromEntries(model.nodes.filter(n=>bundle.resources[n.id]).map(n=>[n.id,bundle.resources[n.id]]));
  const images={};for(const relative of descriptionImagePaths(model)){if(!bundle.images?.[relative])throw new Error(`说明图片未载入：${relative}`);images[relative]=bundle.images[relative];}
  for(const n of model.nodes.filter(n=>n.kind==='html'))assertOffline(expandHTML(resources[n.id],bundle.fragments),n.title);
  const fragments={},add=key=>{if(fragments[key]!==undefined)return;fragments[key]=bundle.fragments[key];for(const m of fragments[key].matchAll(/<!--\s*include:([^>]+?)\s*-->/g))add(m[1]);};for(const text of Object.values(resources))for(const m of text.matchAll(/<!--\s*include:([^>]+?)\s*-->/g))add(m[1]);
  const strip=text=>text.replace(/^import[^\n]+\n/gm,''),inline=text=>text.replace(/<\/script/gi,'<\\/script');
  const css=await fs.readFile(path.join(tool,'style.css'),'utf8'),core=strip(await fs.readFile(path.join(tool,'core.mjs'),'utf8')),routing=strip(await fs.readFile(path.join(tool,'routing.mjs'),'utf8')),player=strip(await fs.readFile(path.join(tool,'player.mjs'),'utf8')),library=strip(await fs.readFile(path.join(tool,'library.mjs'),'utf8')),app=strip(await fs.readFile(path.join(tool,'app.mjs'),'utf8'));
  const vendors=(await Promise.all(['libavoid.min.js','libavoid-routing.js'].map(name=>fs.readFile(path.join(tool,'vendor',name),'utf8')))).join('\n');
  const licenses=(await Promise.all(['LIBAVOID-LICENSE','DRAWIO-LICENSE','DRAWIO-NOTICE','README.md'].map(name=>fs.readFile(path.join(tool,'vendor',name),'utf8')))).join('\n\n');
  const data=JSON.stringify({readonly:true,view,flow,bundle:{model,resources,fragments,images}}).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  let html=await fs.readFile(path.join(tool,'index.html'),'utf8');html=html.replace('<link rel="stylesheet" href="/style.css">',()=>`<style>${css}</style>`).replace('<!-- routing-vendor -->',()=>`<script>${inline(vendors)}</script><script type="text/plain" id="third-party-licenses">${inline(licenses)}</script>`).replace('<script type="module" src="/app.mjs"></script>',()=>`<script>globalThis.YUANXING_BOOT=${data};</script><script type="module">${inline([routing,core,player,library,'const esc=escapeHTML;',app].join('\n'))}</script>`);
  return html;
}
async function body(req){const parts=[];let bytes=0;for await(const part of req){const buffer=Buffer.isBuffer(part)?part:Buffer.from(part);bytes+=buffer.length;if(bytes>64*1024*1024)throw new Error('图片或数据过大');parts.push(buffer);}return JSON.parse(Buffer.concat(parts,bytes).toString('utf8')||'{}');}
export function createHandler(store,token){return async(req,res)=>{
  const send=(status,data,type='application/json')=>{res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});res.end(type==='application/json'?JSON.stringify(data):data);};
  try{const url=new URL(req.url,'http://localhost');const host=req.headers.host||'';if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))return send(403,{error:'仅允许本机访问'});
    if(['PUT','POST'].includes(req.method)){if(req.headers.authorization!==`Bearer ${token}`||req.headers.origin&&new URL(req.headers.origin).host!==host)return send(403,{error:'请求来源不正确'});}
    if(req.method==='GET'&&url.pathname==='/api/project')return send(200,await store.load());
    if(req.method==='GET'&&url.pathname==='/api/project/status')return send(200,await store.status());
    if(req.method==='PUT'&&url.pathname==='/api/project'){const data=await body(req);return send(200,await store.save(data.model,data.revision));}
    if(req.method==='POST'&&url.pathname==='/api/image')return send(200,await store.upload(await body(req)));
    if(req.method==='POST'&&url.pathname==='/api/export'){await store.check();return send(200,await standalone(await store.load(),await body(req)),'text/html');}
    if(req.method==='GET'&&url.pathname==='/'){let html=await fs.readFile(path.join(tool,'index.html'),'utf8');html=html.replace('<script type="module" src="/app.mjs">',`<script>globalThis.YUANXING_BOOT={token:${JSON.stringify(token)}};</script><script type="module" src="/app.mjs">`);return send(200,html,'text/html');}
    if(req.method==='GET'&&['/app.mjs','/core.mjs','/routing.mjs','/library.mjs','/player.mjs','/style.css','/vendor/libavoid.min.js','/vendor/libavoid-routing.js'].includes(url.pathname))return send(200,await fs.readFile(path.join(tool,url.pathname.slice(1)),'utf8'),url.pathname.endsWith('.css')?'text/css':'text/javascript');
    send(404,{error:'入口不存在'});
  }catch(error){const detail=String(error.stderr||'').match(/ValueError:\s*([\s\S]*)/)?.[1]?.trim();send(error.status||400,{error:detail||error.message});}
};}
export async function serve(root,{port=4318,open=false}={}){
  const store=await createStore(root);await store.load();
  const token=randomBytes(24).toString('hex'),server=createServer(createHandler(store,token));
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'端口已占用，请指定 --port。':error.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>{
    const url=`http://127.0.0.1:${server.address().port}`;console.log(`元形工作台：${url}`);
    if(open){const command=process.platform==='darwin'?'open':process.platform==='win32'?'cmd':'xdg-open',args=process.platform==='win32'?['/c','start','',url]:[url];execFile(command,args,error=>{if(error)console.log(`请在浏览器打开 ${url}`);});}
  });return server;
}
