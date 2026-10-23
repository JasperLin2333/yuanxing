#!/usr/bin/env node
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';

const home=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const help=`元形 · 用自然语言完成原型设计与流程评审

node scripts/yuanxing.mjs init <目录> [--template blank|iteration] [--name 名称]
node scripts/yuanxing.mjs add --root <目录> --source <HTML或图片> [--title 名称] [--id 标识] [--module 标识] [--width 1280 --height 800]
node scripts/yuanxing.mjs connect --root <目录> --from <页面> --to <页面> --selector <CSS选择器> [--label 操作]
node scripts/yuanxing.mjs connect --root <目录> --from <页面> --to <页面> --rect x,y,w,h [--label 操作]
node scripts/yuanxing.mjs workspace add --workspace <工作区.json> --root <项目目录> --id <项目标识> [--name 名称]
node scripts/yuanxing.mjs workspace list --workspace <工作区.json>
node scripts/yuanxing.mjs serve --workspace <工作区.json> [--project 标识] [--open]
node scripts/yuanxing.mjs apply --root <目录> --base <修改前JSON> --model <修改后JSON>
node scripts/yuanxing.mjs locate --root <目录> [--query 关键词或页面标识] [--module 模块标识] [--limit 6] [--json]
node scripts/yuanxing.mjs check --root <目录>
node scripts/yuanxing.mjs serve --root <目录> [--port 4318] [--open]
node scripts/yuanxing.mjs export --root <目录> --view review|prototype|document [--module 标识] [--flow 标识] [--out 文件.html] [--replace]

--rect 使用 0～1 的相对坐标。只表达画布关系时使用 --diagram。
HTML 支持本地 CSS、图片和普通 JavaScript；外部服务与工程模块需先适配。
serve / export / check 可加 --extension <扩展目录>、--builder <项目内Python脚本>、--validator <项目内校验脚本>。
`;

function options(args){
  const result={_:[]};
  for(let i=0;i<args.length;i++){
    const value=args[i];if(!value.startsWith('--')){result._.push(value);continue;}
    const key=value.slice(2);if(['open','replace','diagram','json'].includes(key))result[key]=true;
    else{if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`缺少 --${key} 的值`);result[key]=args[++i];}
  }return result;
}
function required(flags,key){if(!flags[key])throw new Error(`请指定 --${key}`);return flags[key];}
function identifier(value){if(!/^[a-zA-Z][\w-]*$/.test(value))throw new Error('标识只能包含字母、数字、下划线或连字符，并以字母开头');return value;}
async function exists(target){try{await fs.lstat(target);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
function sameOrInside(root,target){return target===root||target.startsWith(root+path.sep);}

export async function run(args,{sessionToken}={}){
  const [command,...rest]=args;
  if(!command||['help','--help','-h'].includes(command)){console.log(help);return;}
  const flags=options(rest);
  if(command==='locate'){
    const {locateProject,formatLocateResult}=await import('../runtime/locate.mjs');
    const result=await locateProject(path.resolve(required(flags,'root')),{query:flags.query,module:flags.module,limit:flags.limit===undefined?6:Number(flags.limit)});
    console.log(flags.json?JSON.stringify(result,null,2):formatLocateResult(result));return result;
  }
  if(command==='serve'&&!process.env.YUANXING_WATCH_CHILD){
    const port=Number(flags.port||4318);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('端口应为 1～65535');
    const child=spawn(process.execPath,['--watch','--watch-preserve-output',fileURLToPath(import.meta.url),...args.filter(arg=>arg!=='--open')],{env:{...process.env,YUANXING_WATCH_CHILD:'1',YUANXING_SESSION_TOKEN:sessionToken||randomBytes(24).toString('hex')},stdio:['inherit','pipe','inherit']});
    let opened=false,output='';child.stdout.on('data',data=>{process.stdout.write(data);output=(output+data).slice(-4096);const url=output.match(/元形(?:工作区|工作台)：(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if(flags.open&&!opened&&url){opened=true;const command=process.platform==='darwin'?'open':process.platform==='win32'?'cmd':'xdg-open';execFile(command,process.platform==='win32'?['/c','start','',url]:[url],error=>{if(error)console.log('请在浏览器打开 '+url);});}});
    const stop=()=>child.kill('SIGTERM');process.once('SIGINT',stop);process.once('SIGTERM',stop);
    child.once('exit',code=>{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);process.exitCode=code||0;});child.once('error',error=>{console.error(error.message);process.exitCode=1;});return child;
  }
  if(command==='init'){
    const root=path.resolve(flags._[0]||required(flags,'root')),template=flags.template||'blank';
    if(await exists(root))throw new Error('目标目录已存在，请选择新目录');
    if(!['blank','iteration'].includes(template))throw new Error('模板应为 blank 或 iteration');
    if(template==='iteration'){
      const sample=path.join(home,'examples/product-iteration');
      if(await exists(sample))await fs.cp(sample,root,{recursive:true,errorOnExist:true,force:false});
      else{
        const files=JSON.parse(await fs.readFile(path.join(home,'assets/iteration.json'),'utf8'));
        for(const [relative,data] of Object.entries(files)){
          const file=path.resolve(root,relative);if(!sameOrInside(root,file)||file===root)throw new Error('示例资源路径不正确');
          await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,Buffer.from(data,'base64'),{flag:'wx'});
        }
      }
    }
    else{
      await fs.mkdir(path.join(root,'artifact/pages'),{recursive:true});await fs.mkdir(path.join(root,'artifact/assets'));
      await fs.writeFile(path.join(root,'artifact/workbench.json'),JSON.stringify({version:1,title:flags.name||'我的原型',entryModule:'main',modules:[{id:'main',title:'主要流程'}],nodes:[],edges:[],annotations:[]},null,2)+'\n',{flag:'wx'});
    }
    if(template==='iteration'&&flags.name){const file=path.join(root,'artifact/workbench.json'),model=JSON.parse(await fs.readFile(file,'utf8'));model.title=flags.name;await fs.writeFile(file,JSON.stringify(model,null,2)+'\n');}
    console.log(`已创建 ${root}`);return;
  }
  if(command==='workspace'){
    const {readWorkspace,registerProject}=await import('../runtime/workspace.mjs');
    const file=path.resolve(required(flags,'workspace'));
    if(flags._[0]==='list'){console.log(JSON.stringify(await readWorkspace(file),null,2));return;}
    if(flags._[0]!=='add')throw new Error('工作区操作应为 add 或 list');
    const item=await registerProject(file,{id:required(flags,'id'),title:flags.name,root:required(flags,'root'),builder:flags.builder,validator:flags.validator,extension:flags.extension});console.log(`已登记 ${item.title}（${item.id}）`);return;
  }
  if(command==='serve'&&flags.workspace){
    const {serveWorkspace}=await import('../runtime/workspace.mjs');
    const port=Number(flags.port||4318);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('端口应为 1～65535');
    return serveWorkspace(path.resolve(flags.workspace),{port,open:!!flags.open,project:flags.project,sessionToken});
  }
  const root=path.resolve(required(flags,'root'));
  const {createStore,standalone,serve}=await import('../runtime/server.mjs');
  const {validate,exportIssues}=await import('../runtime/core.mjs');
  const store=await createStore(root,{builder:flags.builder,validator:flags.validator,extension:flags.extension});
  if(command==='serve'){
    const port=Number(flags.port||4318);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('端口应为 1～65535');
    await serve(root,{port,open:!!flags.open,builder:flags.builder,validator:flags.validator,extension:flags.extension,sessionToken});return;
  }
  if(command==='check'){
    await store.check();const bundle=await store.load(),errors=exportIssues(bundle.model);if(errors.length)throw new Error(errors.join('；'));
    console.log(`结构与资源检查通过：${bundle.model.nodes.length} 个页面，${bundle.model.edges.length} 条关系`);return;
  }
  if(command==='export'){
    const {flowEntries}=await import('../runtime/player.mjs');
    await store.check();const view=flags.view||'review';if(!['review','prototype','document'].includes(view))throw new Error('视图应为 review、prototype 或 document');
    const bundle=await store.load();
    if(flags.module&&!bundle.model.modules.some(m=>m.id===flags.module))throw new Error('模块不存在');
    if(flags.flow&&!flowEntries(bundle.model).some(flow=>flow.id===flags.flow))throw new Error('体验流程不存在');
    const out=path.resolve(flags.out||path.join(root,'dist',view==='prototype'?'prototype.html':view==='document'?'document.html':'workbench.html'));
    if(sameOrInside(path.join(root,'artifact'),out)||!out.toLowerCase().endsWith('.html'))throw new Error('导出应为 artifact 目录以外的 HTML 文件');
    if(await exists(out)){const stat=await fs.lstat(out);if(stat.isSymbolicLink()||!stat.isFile()||!flags.replace)throw new Error('输出已存在；确认是生成文件后使用 --replace');}
    const html=await standalone(bundle,{module:flags.module,entryModule:flags.module,view,flow:flags.flow,extension:store.extension});
    await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,html,{flag:flags.replace?'w':'wx'});
    console.log(`已生成 ${out}`);return;
  }
  if(command==='apply'){
    const baseRaw=await fs.readFile(path.resolve(required(flags,'base')),'utf8'),base=JSON.parse(baseRaw),next=JSON.parse(await fs.readFile(path.resolve(required(flags,'model')),'utf8'));
    try{const saved=await store.save(next,createHash('sha256').update(baseRaw).digest('hex'),base);console.log('已合并保存 '+saved.revision);}
    catch(error){if(error.details)console.error(JSON.stringify({base,local:next,...error.details},null,2));throw error;}return;
  }
  const {model,revision}=await store.readModel(),base=JSON.parse(JSON.stringify(model));
  if(command==='add'){
    const source=await fs.realpath(path.resolve(required(flags,'source'))),extension=path.extname(source).toLowerCase();
    const kind=['.html','.htm'].includes(extension)?'html':['.png','.jpg','.jpeg','.webp'].includes(extension)?'image':null;
    if(!kind)throw new Error('请选择 HTML、PNG、JPEG 或 WebP 文件');
    const id=identifier(flags.id||'page-'+randomUUID()),moduleId=flags.module||model.modules[0]?.id;
    if(model.nodes.some(n=>n.id===id))throw new Error('页面标识已存在');
    if(!model.modules.some(m=>m.id===moduleId))throw new Error('模块不存在');
    let content=await fs.readFile(source),width=Number(flags.width||1280),height=Number(flags.height||800);
    if(kind==='html'){const {inlineHTML}=await import('../runtime/resources.mjs');content=await inlineHTML(content.toString('utf8'),source,path.dirname(source));}
    else if(extension==='.png'&&content.length>=24&&!flags.width&&!flags.height){width=content.readUInt32BE(16);height=content.readUInt32BE(20);}
    else if(!flags.width||!flags.height)throw new Error('JPEG / WebP 图片请指定 --width 和 --height');
    const relative=`${kind==='html'?'pages':'assets'}/${id}${kind==='html'?'.html':extension}`,target=path.join(store.artifact,relative),siblings=model.nodes.filter(n=>n.module===moduleId);
    model.nodes.push({id,module:moduleId,title:flags.title||path.basename(source,path.extname(source)),kind,path:relative,width,height,x:siblings.length?Math.max(...siblings.map(n=>n.x+440)):60,y:60,description:''});
    const module=model.modules.find(m=>m.id===moduleId);module.entry??=id;
    const errors=validate(model);if(errors.length)throw new Error(errors.join('；'));
    await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,content,{flag:'wx'});
    try{await store.save(model,revision,base);}catch(error){await fs.unlink(target);throw error;}
    console.log(`已添加 ${id}`);return;
  }
  if(command==='connect'){
    const from=required(flags,'from'),to=required(flags,'to');if(!flags.selector&&!flags.rect&&!flags.diagram)throw new Error('可操作跳转需指定 --selector 或 --rect；画布关系使用 --diagram');
    const edge={id:identifier(flags.id||'edge-'+randomUUID()),from,to,label:flags.label||'继续',...(flags.diagram?{diagram:true}:{}),...(flags.selector?{selector:flags.selector}:{}),...(flags.rect?{rect:flags.rect.split(',').map(Number)}:{}),...(flags.when?{when:JSON.parse(flags.when)}:{}),...(flags.set?{setContext:JSON.parse(flags.set)}:{})};
    if(flags.rect){const source=model.nodes.find(n=>n.id===from);if(source?.kind==='image')edge.imagePath=source.path;}
    model.edges.push(edge);const errors=validate(model);if(errors.length)throw new Error(errors.join('；'));await store.save(model,revision,base);console.log(`已连接 ${from} → ${to}`);return;
  }
  throw new Error(`未知命令：${command}`);
}
if(process.argv[1]&&await fs.realpath(process.argv[1]).catch(()=>'')===fileURLToPath(import.meta.url))run(process.argv.slice(2),{sessionToken:process.env.YUANXING_SESSION_TOKEN}).catch(error=>{console.error(error.message);process.exitCode=1;});
