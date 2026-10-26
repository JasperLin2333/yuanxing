import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {inlineHTML} from './resources.mjs';
import {promisify} from 'node:util';
import {compatibilityDataTag,createCompatibilityBundle} from './compatibility.mjs';
import {compactExportBoot,restoreExportBoot,decodeExportArtifact} from './export-data.mjs';
import {safePath} from './paths.mjs';
export {safePath} from './paths.mjs';
import {documentSourceBlocks,documentSourceKey,extractDocumentSource,patchDocumentSource} from './document.mjs';
import {clone,validate,exportSubset,expandHTML,importManifest,exportIssues,descriptionImagePaths,recycleNodes,removeNodes,mergeProject} from './core.mjs';
const exec=promisify(execFile),tool=path.dirname(fileURLToPath(import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');
const inside=(root,target)=>target===root||target.startsWith(root+path.sep);
// 版本探测只读文件元数据，不重复读取和编码页面、图片。ctime 同时覆盖保留 mtime 的替换。
async function fingerprint(target){
  try{
    const stat=await fs.lstat(target,{bigint:true});
    if(stat.isDirectory()){
      const names=(await fs.readdir(target)).filter(name=>!['__pycache__','.workbench-snapshots','workbench.json','workbench.json.lock','workbench.json.lock.recover'].includes(name)&&!name.endsWith('.tmp')).sort();
      return sha(JSON.stringify(await Promise.all(names.map(async name=>[name,await fingerprint(path.join(target,name))]))));
    }
    return sha([stat.mode,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs,stat.isSymbolicLink()?await fs.readlink(target):''].join(':'));
  }catch(error){if(error.code==='ENOENT')return 'missing';throw error;}
}
// 扩展必须由启动参数明确指定；只提供清单内的脚本，不暴露项目目录。
export async function loadProjectExtension(directory){
  if(!directory)return null;
  const root=await fs.realpath(path.resolve(directory)),config=JSON.parse(await fs.readFile(await safePath(root,'extension.json'),'utf8'));
  if(!Array.isArray(config.files)||!config.files.length||new Set(config.files).size!==config.files.length||!config.files.includes(config.entry)||config.files.some(file=>typeof file!=='string'||!/^\w[\w/-]*\.mjs$/.test(file)||file.includes('..')))throw new Error('项目扩展清单不正确');
  const previous=new Set();
  for(const file of config.files){
    const source=await fs.readFile(await safePath(root,file),'utf8');
    for(const match of source.matchAll(/^import\s+[^\n]*?from\s*['"]([^'"]+)['"]/gm)){
      const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(file),match[1]));
      if(!match[1].startsWith('./')||!previous.has(dependency))throw new Error('扩展依赖必须在清单中按引用顺序列出');
    }
    if(/^import\s*['"]|\bimport\s*\(/m.test(source))throw new Error('项目扩展不支持动态或外部导入');
    previous.add(file);
  }
  if(config.files.at(-1)!==config.entry)throw new Error('扩展入口必须位于清单末尾');
  return {root,entry:config.entry,files:config.files,declarative:config.declarative===true};
}
async function extensionSource(extension,file,basePath=""){
  const source=await fs.readFile(await safePath(extension.root,file),'utf8');
  return source.replace(/\bfrom\s*(['"])(\.\/[^'"]+)\1/g,(match,quote,relative)=>`from ${quote}${basePath}/project-extension/${path.posix.normalize(path.posix.join(path.posix.dirname(file),relative))}${quote}`);
}
function freeze(text){return text.replace(/<script\b[\s\S]*?<\/script\s*>/gi,'').replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'').replace(/contenteditable="true"/g,'contenteditable="false"');}
function assertDeclarativeOffline(text,label){
  if(/<(?:script|iframe|object|embed)\b/i.test(text)||/@import\b/i.test(text)||/\s(?:src|href)\s*=\s*["'](?!data:|#)(?:https?:|\/\/|file:)/i.test(text)||/url\(\s*["']?(?!data:|#)(?:https?:|\/\/|file:|\.\.?\/)/i.test(text))throw new Error(`${label} 含未内嵌的资源或可执行内容`);
  const urls=[...text.matchAll(/\s(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map(m=>m[1]);
  if(urls.some(u=>!u.startsWith('#')&&!u.startsWith('data:')))throw new Error(`${label} 含未内嵌的资源`);
}
function assertOffline(text,label,declarative=false){
  if(declarative)return assertDeclarativeOffline(text,label);
  if(declarative&&/<script\b/i.test(text))throw new Error(`${label} 含可执行内容`);
  if(/<(?:iframe|object|embed)\b/i.test(text)||/@import\b/i.test(text)||/<script\b[^>]*\bsrc\s*=/i.test(text)||/\s(?:src|href)\s*=\s*["'](?:https?:|\/\/|file:)/i.test(text))throw new Error(`${label} 含未内嵌的资源`);
}
export async function createStore(root,{builder,validator,extension}={}){
  const projectExtension=await loadProjectExtension(extension);
  root=await fs.realpath(root);const artifact=await fs.realpath(path.join(root,'artifact')),modelFile=path.join(artifact,'workbench.json');if(!inside(root,artifact))throw new Error('artifact 目录越界');let building,buildSig,queue=Promise.resolve();
  async function readModel(){try{const raw=await fs.readFile(await safePath(artifact,'workbench.json'),'utf8');return {model:JSON.parse(raw),revision:sha(raw)};}catch(error){if(error.code!=='ENOENT')throw error;const manifest=JSON.parse(await fs.readFile(await safePath(artifact,'manifest.json'),'utf8'));const model=importManifest(manifest);for(const r of manifest.requirements||[])for(const s of r.states||[]){const html=await fs.readFile(await safePath(artifact,s.html),'utf8');for(const t of r.transitions||[])if(html.includes(`data-transition-id="${t.id}"`))model.edges.push({id:`${r.id}:${s.id}:${t.id}`,from:`${r.id}:${s.id}`,to:`${r.id}:${t.to}`,label:t.id,selector:`[data-transition-id="${t.id}"]`});}return {model,revision:'import'};}}
  const renderInputs=model=>model.nodes.filter(n=>n.kind!=='note').map(n=>({id:n.id,path:n.path,render:n.render}));
  // 同一份构建输入同时用于失效判断和轻量资源版本，包含同目录辅助脚本及参考图片。
  async function buildInputs(model){return sha(JSON.stringify([renderInputs(model),await Promise.all([...(builder?[path.dirname(await safePath(root,builder))]:[]),...['components','modules','assets'].map(dir=>path.join(artifact,dir)),...(projectExtension?[projectExtension.root]:[])].map(fingerprint))]));}
  async function documentInputs(model){
    const files=new Set(),sources=new Map();
    for(const block of documentSourceBlocks(model)){
      const file=await safePath(root,block.path);files.add(file);
      if(!sources.has(block.path))sources.set(block.path,await fs.readFile(file,'utf8'));
      const text=extractDocumentSource(sources.get(block.path),block.section,block.omitHeading);
      for(const match of text.matchAll(/`[^`]*`|!\[[^\]\n]*\]\(([^)\n]+)\)/g))if(match[1])files.add(await safePath(root,path.posix.normalize(path.posix.join(path.posix.dirname(block.path),match[1]))));
    }
    return Promise.all([...files].map(fingerprint));
  }
  async function sourceVersion(model){return sha(JSON.stringify([await fingerprint(artifact),await buildInputs(model),await documentInputs(model)]));}
  async function runtimeVersion(){return sha(JSON.stringify(await Promise.all([tool,...(projectExtension?[projectExtension.root]:[])].map(fingerprint))));}
  async function status(){const {model,revision}=await readModel();return {revision,sourceVersion:await sourceVersion(model),runtimeVersion:await runtimeVersion()};}
  async function buildIfNeeded(model){
    if(!builder)return;const previous=building,job=(async()=>{
      if(previous)await previous;
      const script=await safePath(root,builder),sig=await buildInputs(model);if(sig===buildSig)return;
      await exec('python3',[script],{cwd:root,maxBuffer:2*1024*1024});buildSig=sig;
    })();building=job;try{await job;}finally{if(building===job)building=null;}
  }
  async function load(){const {model,revision}=await readModel(),errors=validate(model);if(errors.length)throw new Error(errors.join('；'));await buildIfNeeded(model);const resources={},fragments={},images={},documentSources={},documentSourceVersions={};
    async function readImage(relative){const file=await safePath(artifact,relative),mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[path.extname(file).toLowerCase()];if(!mime)throw new Error('图片格式不支持');return `data:${mime};base64,${(await fs.readFile(file)).toString('base64')}`;}
    async function addFragment(key,trail=[]){if(trail.includes(key))throw new Error('组件循环引用');if(fragments[key]!==undefined)return;const file=await safePath(artifact,key),input=await fs.readFile(file,'utf8'),text=projectExtension?.declarative?freeze(input):await inlineHTML(input,file,artifact);fragments[key]=text;for(const match of text.matchAll(/<!--\s*include:([^>]+?)\s*-->/g))await addFragment(match[1],[...trail,key]);}
    for(const n of model.nodes){if(n.kind==='note')continue;const file=await safePath(artifact,n.path);if(n.kind==='image'){resources[n.id]=await readImage(n.path);}else{const input=await fs.readFile(file,'utf8');resources[n.id]=projectExtension?.declarative?freeze(input):await inlineHTML(input,file,artifact);for(const match of resources[n.id].matchAll(/<!--\s*include:([^>]+?)\s*-->/g))await addFragment(match[1]);assertOffline(expandHTML(resources[n.id],fragments),n.title,projectExtension?.declarative);}}
    for(const relative of descriptionImagePaths(model)){try{images[relative]=await readImage(relative);}catch(error){throw new Error(`说明图片无法读取：${relative}（${error.code==='ENOENT'?'文件不存在':error.message}）`);}}
    const sourceFiles=new Map();
    for(const block of documentSourceBlocks(model)){
      if(!sourceFiles.has(block.path))sourceFiles.set(block.path,await fs.readFile(await safePath(root,block.path),'utf8'));
      let text=extractDocumentSource(sourceFiles.get(block.path),block.section,block.omitHeading);
      documentSourceVersions[documentSourceKey(block)]=sha(text);
      const replacements=new Map();
      for(const match of text.matchAll(/`[^`]*`|!\[[^\]\n]*\]\(([^)\n]+)\)/g))if(match[1]){
        const relative=path.posix.normalize(path.posix.join(path.posix.dirname(block.path),match[1]));
        const file=await safePath(root,relative),mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[path.extname(file).toLowerCase()];
        if(!mime)throw new Error('需求正文图片格式不支持');
        const key='assets/source-'+sha(relative).slice(0,20)+path.extname(file).toLowerCase();images[key]=`data:${mime};base64,${(await fs.readFile(file)).toString('base64')}`;replacements.set(match[0],match[0].replace('('+match[1]+')','('+key+')'));
      }
      text=text.replace(/`[^`]*`|!\[[^\]\n]*\]\(([^)\n]+)\)/g,match=>replacements.get(match)||match);documentSources[documentSourceKey(block)]=text;
    }
    return {model,revision,runtimeVersion:await runtimeVersion(),resources,fragments,images,documentSources,documentSourceVersions,sourcesSignature:sha(JSON.stringify(resources)+JSON.stringify(fragments)+JSON.stringify(images)+JSON.stringify(documentSources)),sourceVersion:await sourceVersion(model)};
  }
  async function transaction(operation){const previous=queue;let release;queue=new Promise(resolve=>release=resolve);await previous;try{return await operation();}finally{release();}}
  function assertRevision(actual,revision,required=false){if((required||revision!==undefined)&&actual.revision!==revision){const error=new Error('项目已被外部修改');error.status=409;throw error;}}
  function assertModel(model){const errors=validate(model);if(errors.length)throw new Error(errors.join('；'));}
  async function writeModel(model,revision){const raw=JSON.stringify(model,null,2)+'\n',tmp=modelFile+'.'+randomUUID()+'.tmp';await fs.writeFile(tmp,raw,{flag:'wx'});try{assertRevision(await readModel(),revision);await fs.rename(tmp,modelFile);}finally{await fs.rm(tmp,{force:true});}return {revision:sha(raw)};}
  async function materializeCopies(model){for(const node of model.nodes.filter(n=>n.kind==='html'&&n.copySourcePath)){const target=await safePath(artifact,node.path,true);try{await fs.access(target);continue;}catch(error){if(error.code!=='ENOENT')throw error;}const source=await safePath(artifact,node.copySourcePath);await fs.copyFile(source,target,1);}}
  async function withProjectLock(operation){return transaction(async()=>{
    // CLI 与网页使用同一把项目锁；不覆盖其他写入方的锁。
    let lock;for(let attempt=0;attempt<80;attempt++){
      try{lock=await fs.open(modelFile+'.lock','wx');break;}
      catch(error){if(error.code!=='EEXIST')throw error;
        let recovery;
        try{recovery=await fs.open(modelFile+'.lock.recover','wx');const owner=JSON.parse(await fs.readFile(modelFile+'.lock','utf8'));if(Number.isInteger(owner.pid)&&owner.pid>0){try{process.kill(owner.pid,0);}catch(check){if(check.code==='ESRCH')await fs.rm(modelFile+'.lock',{force:true});}}}catch{}
        finally{if(recovery){await recovery.close();await fs.rm(modelFile+'.lock.recover',{force:true});}}
        await new Promise(resolve=>setTimeout(resolve,25));
      }
    }
    if(!lock){const error=new Error('其他编辑正在保存，请稍后重试。');error.status=423;throw error;}
    try{
      await lock.writeFile(JSON.stringify({pid:process.pid}));
      return await operation();
    }finally{await lock.close();await fs.rm(modelFile+'.lock',{force:true});}
  });}
  async function save(model,revision,baseModel){assertModel(model);return withProjectLock(async()=>{
      const actual=await readModel();let next=model;
      if(actual.revision!==revision){
        if(!baseModel)assertRevision(actual,revision,true);
        assertModel(baseModel);const merged=mergeProject(baseModel,model,actual.model),issues=validate(merged.model);
        if(merged.conflicts.length||issues.length){const error=new Error('同一内容被同时修改，双方修改均已保留。');Object.assign(error,{status:409,details:{revision:actual.revision,model:actual.model,conflicts:merged.conflicts.length?merged.conflicts:issues}});throw error;}
        next=merged.model;
      }
      assertModel(next);await materializeCopies(next);
      const saved=sha(JSON.stringify(next,null,2)+'\n')===actual.revision?{revision:actual.revision}:await writeModel(next,actual.revision);
      return {...saved,model:next};
  });}
  async function saveDocumentSource(change){return withProjectLock(async()=>{
    const conflict=()=>Object.assign(new Error('这段需求已在别处修改，当前输入已保留，请让 AI 合并。'),{status:409});
    const actual=await readModel(),block=documentSourceBlocks(actual.model).find(item=>item.id===change.id);
    if(!block||documentSourceKey(block)!==change.key)throw conflict();
    const file=await safePath(root,block.path),original=await fs.readFile(file,'utf8'),selected=extractDocumentSource(original,block.section,block.omitHeading);
    if(sha(selected)!==change.version)throw conflict();
    const aliases=new Map();
    for(const match of selected.matchAll(/`[^`]*`|!\[[^\]\n]*\]\(([^)\n]+)\)/g))if(match[1]){const relative=path.posix.normalize(path.posix.join(path.posix.dirname(block.path),match[1]));aliases.set('assets/source-'+sha(relative).slice(0,20)+path.extname(relative).toLowerCase(),match[1]);}
    const restore=value=>typeof value==='string'?value.replace(/!\[([^\]\n]*)\]\(([^)\n]+)\)/g,(all,alt,url)=>aliases.has(url)?`![${alt}](${aliases.get(url)})`:all):value;
    const patched=patchDocumentSource(original,block,{...change,before:restore(change.before),value:restore(change.value)}),next=clone(actual.model),beforeVersions={},documentSources={},documentSourceVersions={},keyChanges={};
    const prior=documentSourceBlocks(actual.model).filter(item=>item.path===block.path),after=documentSourceBlocks(next).filter(item=>item.path===block.path);
    for(const item of prior)beforeVersions[documentSourceKey(item)]=sha(extractDocumentSource(original,item.section,item.omitHeading));
    for(const item of after){
      const oldKey=documentSourceKey(item);if(patched.rename&&item.section===patched.rename.before)item.section=patched.rename.after;
      const key=documentSourceKey(item);keyChanges[oldKey]=key;
      let text=extractDocumentSource(patched.text,item.section,item.omitHeading);documentSourceVersions[key]=sha(text);
      const replacements=new Map();
      for(const match of text.matchAll(/`[^`]*`|!\[[^\]\n]*\]\(([^)\n]+)\)/g))if(match[1]){
        const relative=path.posix.normalize(path.posix.join(path.posix.dirname(item.path),match[1])),image=await safePath(root,relative);
        if(!/\.(png|jpe?g|webp)$/i.test(image))throw new Error('需求正文图片格式不支持');
        const alias='assets/source-'+sha(relative).slice(0,20)+path.extname(image).toLowerCase();replacements.set(match[0],match[0].replace('('+match[1]+')','('+alias+')'));
      }
      documentSources[key]=text.replace(/`[^`]*`|!\[[^\]\n]*\]\(([^)\n]+)\)/g,match=>replacements.get(match)||match);
    }
    const tmp=file+'.'+randomUUID()+'.tmp';let revision=actual.revision;
    try{
      await fs.writeFile(tmp,patched.text,{flag:'wx',mode:(await fs.stat(file)).mode});
      assertRevision(await readModel(),actual.revision);if(await fs.readFile(file,'utf8')!==original)throw conflict();
      await fs.rename(tmp,file);
      try{if(JSON.stringify(next)!==JSON.stringify(actual.model))revision=(await writeModel(next,actual.revision)).revision;}
      catch(error){if(await fs.readFile(file,'utf8')===patched.text)await fs.writeFile(file,original);throw error;}
    }finally{await fs.rm(tmp,{force:true});}
    return {model:next,revision,documentSources,documentSourceVersions,beforeVersions,keyChanges};
  });}
  async function upload({type,data}){const allowed={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'};if(!allowed[type]||typeof data!=='string'||!data.startsWith(`data:${type};base64,`))throw new Error('图片格式不支持');const bytes=Buffer.from(data.split(',')[1],'base64');const valid=type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='image/jpeg'?bytes[0]===255&&bytes[1]===216:bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';if(!valid)throw new Error('图片内容不正确');await fs.mkdir(path.join(artifact,'assets'),{recursive:true});const relative=`assets/${randomUUID()}.${allowed[type]}`;await fs.writeFile(await safePath(artifact,relative,true),bytes,{flag:'wx'});return {path:relative};}
  async function check(){const {model}=await readModel(),errors=validate(model);if(errors.length)throw new Error(errors.join('；'));if(validator)await exec('python3',[await safePath(root,validator),'--validate'],{cwd:root,maxBuffer:2*1024*1024});}
  return {root,artifact,load,status,readModel,save,saveDocumentSource,upload,check,extension:projectExtension};
}
export async function standalone(bundle,{module,entryModule,view='review',flow,extension}={}){
  const projectExtension=typeof extension==='string'?await loadProjectExtension(extension):extension;
  if(!['review','prototype','document'].includes(view))throw new Error('导出视图不正确');
  const source=clone(bundle.model),recycled=recycleNodes(source).map(n=>n.id);
  if(recycled.length)removeNodes(source,recycled);
  const model=exportSubset(source,module);if(entryModule&&model.modules.some(m=>m.id===entryModule))model.entryModule=entryModule;
  const errors=exportIssues(model);if(errors.length)throw new Error(errors.join('；'));
  const resources=Object.fromEntries(model.nodes.filter(n=>bundle.resources[n.id]).map(n=>[n.id,bundle.resources[n.id]]));
  const images={};for(const relative of descriptionImagePaths(model)){if(!bundle.images?.[relative])throw new Error(`说明图片未载入：${relative}`);images[relative]=bundle.images[relative];}
  const documentSources={};for(const block of documentSourceBlocks(model)){const key=documentSourceKey(block),text=bundle.documentSources?.[key];if(text===undefined)throw new Error('需求正文未载入：'+block.path);documentSources[key]=text;for(const match of text.matchAll(/!\[[^\]\n]*\]\((assets\/[^)\n]+)\)/g)){if(!bundle.images?.[match[1]])throw new Error('需求正文图片未载入');images[match[1]]=bundle.images[match[1]];}}
  for(const n of model.nodes.filter(n=>n.kind==='html'))assertOffline(expandHTML(resources[n.id],bundle.fragments),n.title);
  const fragments={},add=key=>{if(fragments[key]!==undefined)return;fragments[key]=bundle.fragments[key];for(const m of fragments[key].matchAll(/<!--\s*include:([^>]+?)\s*-->/g))add(m[1]);};for(const text of Object.values(resources))for(const m of text.matchAll(/<!--\s*include:([^>]+?)\s*-->/g))add(m[1]);
  const strip=text=>text.replace(/^import[^\n]+\n/gm,''),inline=text=>text.replace(/<\/script/gi,'<\\/script');
  const css=await fs.readFile(path.join(tool,'style.css'),'utf8'),documentCode=strip(await fs.readFile(path.join(tool,'document.mjs'),'utf8')),documentPlayer=strip(await fs.readFile(path.join(tool,'document-player.mjs'),'utf8')),core=strip(await fs.readFile(path.join(tool,'core.mjs'),'utf8')),routing=strip(await fs.readFile(path.join(tool,'routing.mjs'),'utf8')),player=strip(await fs.readFile(path.join(tool,'player.mjs'),'utf8')),handoff=strip(await fs.readFile(path.join(tool,'handoff.mjs'),'utf8')),library=strip(await fs.readFile(path.join(tool,'library.mjs'),'utf8')),app=strip(await fs.readFile(path.join(tool,'app.mjs'),'utf8'));
  const extensionCode=projectExtension?(await Promise.all(projectExtension.files.map(async file=>fs.readFile(await safePath(projectExtension.root,file),'utf8')))).map(strip).join('\n'):strip(await fs.readFile(path.join(tool,'extension.mjs'),'utf8'));
  const vendors=(await Promise.all(['libavoid.min.js','libavoid-routing.js','fflate.min.js'].map(name=>fs.readFile(path.join(tool,name),'utf8')))).join('\n');
  const licenses=(await Promise.all(['LIBAVOID-LICENSE','DRAWIO-LICENSE','DRAWIO-NOTICE','FFLATE-LICENSE','THIRD-PARTY-README.md'].map(name=>fs.readFile(path.join(tool,name),'utf8')))).join('\n\n');
  const exportBundle={model,resources,fragments,images,documentSources},compatible=createCompatibilityBundle(exportBundle);
  const data=JSON.stringify(compactExportBoot({readonly:true,view,flow,bundle:exportBundle},compatible)).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const restore=`if(globalThis.YUANXING_BOOT.sharedStrings)globalThis.YUANXING_BOOT=(${restoreExportBoot.toString()})(globalThis.YUANXING_BOOT,(${decodeExportArtifact.toString()})(JSON.parse(document.getElementById('yuanxing-artifact').textContent)));`;
  let html=await fs.readFile(path.join(tool,'index.html'),'utf8');html=html.replace('<link rel="stylesheet" href="/style.css">',()=>`<style>${css}</style>`).replace('<!-- routing-vendor -->',()=>`<script>${inline(vendors)}</script><script type="text/plain" id="third-party-licenses">${inline(licenses)}</script>`).replace('<script type="module" src="/app.mjs"></script>',()=>`<script>globalThis.YUANXING_BOOT=${data};</script><script type="module">${inline([restore,routing,documentCode,core,player,documentPlayer,handoff,library,extensionCode,'const esc=escapeHTML;',app].join('\n'))}</script>`);
  html=html.replace('</head>',()=>compatibilityDataTag(exportBundle,compatible)+'</head>');
  return html;
}
async function body(req){const parts=[];let bytes=0;for await(const part of req){const buffer=Buffer.isBuffer(part)?part:Buffer.from(part);bytes+=buffer.length;if(bytes>64*1024*1024)throw new Error('图片或数据过大');parts.push(buffer);}return JSON.parse(Buffer.concat(parts,bytes).toString('utf8')||'{}');}
export function createHandler(store,token,{basePath="",projectId,projects}={}){return async(req,res)=>{
  const send=(status,data,type='application/json')=>{res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});res.end(type==='application/json'?JSON.stringify(data):data);};
  try{const url=new URL(req.url,'http://localhost');const host=req.headers.host||'';if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))return send(403,{error:'仅允许本机访问'});
    if(['PUT','POST'].includes(req.method)){if(req.headers.authorization!==`Bearer ${token}`||req.headers.origin&&new URL(req.headers.origin).host!==host)return send(403,{error:'请求来源不正确'});}
    if(req.method==='GET'&&url.pathname==='/api/project')return send(200,await store.load());
    if(req.method==='GET'&&url.pathname==='/api/project/status')return send(200,await store.status());
    if(req.method==='PUT'&&url.pathname==='/api/project'){const data=await body(req);return send(200,await store.save(data.model,data.revision,data.baseModel));}
    if(req.method==='POST'&&url.pathname==='/api/image')return send(200,await store.upload(await body(req)));
    if(req.method==='PUT'&&url.pathname==='/api/document/source')return send(200,await store.saveDocumentSource(await body(req)));
    if(req.method==='POST'&&url.pathname==='/api/export'){await store.check();return send(200,await standalone(await store.load(),{...await body(req),extension:store.extension}),'text/html');}
    if(req.method==='GET'&&url.pathname==='/'){const runtimeVersion=(await store.status()).runtimeVersion;let html=await fs.readFile(path.join(tool,'index.html'),'utf8');html=html.replace('<script type="module" src="/app.mjs">',`<script>globalThis.YUANXING_BOOT={...${JSON.stringify({token,basePath,projectId,projects,runtimeVersion}).replace(/</g,"\\u003c")}};</script><script type="module" src="/app.mjs">`);if(basePath)html=html.replace('href="/style.css"',`href="${basePath}/style.css"`).replace('src="/app.mjs"',`src="${basePath}/app.mjs"`);return send(200,html,'text/html');}
    if(req.method==='GET'&&url.pathname==='/extension.mjs')return send(200,store.extension?await extensionSource(store.extension,store.extension.entry,basePath):await fs.readFile(path.join(tool,'extension.mjs'),'utf8'),'text/javascript');
    if(req.method==='GET'&&url.pathname.startsWith('/project-extension/')){const file=url.pathname.slice('/project-extension/'.length);if(!store.extension?.files.includes(file))return send(404,{error:'扩展资源不存在'});return send(200,await extensionSource(store.extension,file,basePath),'text/javascript');}
    if(req.method==='GET'&&['/app.mjs','/document.mjs','/document-player.mjs','/handoff.mjs','/core.mjs','/routing.mjs','/library.mjs','/player.mjs','/style.css','/libavoid.min.js','/libavoid-routing.js'].includes(url.pathname))return send(200,await fs.readFile(path.join(tool,url.pathname.slice(1)),'utf8'),url.pathname.endsWith('.css')?'text/css':'text/javascript');
    send(404,{error:'入口不存在'});
  }catch(error){const detail=String(error.stderr||'').match(/ValueError:\s*([\s\S]*)/)?.[1]?.trim();send(error.status||400,{error:detail||error.message,...error.details});}
};}
export function gracefulShutdown(server){const stop=()=>{server.close(()=>process.exit(0));server.closeIdleConnections?.();};process.once('SIGTERM',stop);process.once('SIGINT',stop);return server;}
export async function serve(root,{port=4318,open=false,builder,validator,extension,sessionToken}={}){
  const store=await createStore(root,{builder,validator,extension});await store.load();
  const token=sessionToken||randomBytes(24).toString('hex'),server=gracefulShutdown(createServer(createHandler(store,token)));
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'端口已占用，请指定 --port。':error.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>{
    const url=`http://127.0.0.1:${server.address().port}`;console.log(`元形工作台：${url}`);
    if(open){const command=process.platform==='darwin'?'open':process.platform==='win32'?'cmd':'xdg-open',args=process.platform==='win32'?['/c','start','',url]:[url];execFile(command,args,error=>{if(error)console.log(`请在浏览器打开 ${url}`);});}
  });return server;
}
