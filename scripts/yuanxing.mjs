#!/usr/bin/env node
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createStore,standalone,serve} from '../runtime/server.mjs';
import {validate,exportIssues} from '../runtime/core.mjs';
import {inlineHTML} from '../runtime/resources.mjs';

const home=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const help=`元形 · 用自然语言完成原型设计与流程评审

node scripts/yuanxing.mjs init <目录> [--template blank|iteration] [--name 名称]
node scripts/yuanxing.mjs add --root <目录> --source <HTML或图片> [--title 名称] [--id 标识] [--module 标识] [--width 1280 --height 800]
node scripts/yuanxing.mjs connect --root <目录> --from <页面> --to <页面> --selector <CSS选择器> [--label 操作]
node scripts/yuanxing.mjs connect --root <目录> --from <页面> --to <页面> --rect x,y,w,h [--label 操作]
node scripts/yuanxing.mjs check --root <目录>
node scripts/yuanxing.mjs serve --root <目录> [--port 4318] [--open]
node scripts/yuanxing.mjs export --root <目录> --view review|prototype [--module 标识] [--flow 标识] [--out 文件.html] [--replace]

--rect 使用 0～1 的相对坐标。只表达画布关系时使用 --diagram。
HTML 支持本地 CSS、图片和普通 JavaScript；外部服务与工程模块需先适配。
`;

function options(args){
  const result={_:[]};
  for(let i=0;i<args.length;i++){
    const value=args[i];if(!value.startsWith('--')){result._.push(value);continue;}
    const key=value.slice(2);if(['open','replace','diagram'].includes(key))result[key]=true;
    else{if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`缺少 --${key} 的值`);result[key]=args[++i];}
  }return result;
}
function required(flags,key){if(!flags[key])throw new Error(`请指定 --${key}`);return flags[key];}
function identifier(value){if(!/^[a-zA-Z][\w-]*$/.test(value))throw new Error('标识只能包含字母、数字、下划线或连字符，并以字母开头');return value;}
async function exists(target){try{await fs.lstat(target);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
function sameOrInside(root,target){return target===root||target.startsWith(root+path.sep);}

export async function run(args){
  const [command,...rest]=args;
  if(!command||['help','--help','-h'].includes(command)){console.log(help);return;}
  const flags=options(rest);
  if(command==='init'){
    const root=path.resolve(flags._[0]||required(flags,'root')),template=flags.template||'blank';
    if(await exists(root))throw new Error('目标目录已存在，请选择新目录');
    if(!['blank','iteration'].includes(template))throw new Error('模板应为 blank 或 iteration');
    if(template==='iteration')await fs.cp(path.join(home,'examples/product-iteration'),root,{recursive:true,errorOnExist:true,force:false});
    else{
      await fs.mkdir(path.join(root,'artifact/pages'),{recursive:true});await fs.mkdir(path.join(root,'artifact/assets'));
      await fs.writeFile(path.join(root,'artifact/workbench.json'),JSON.stringify({version:1,title:flags.name||'我的原型',entryModule:'main',modules:[{id:'main',title:'主要流程'}],nodes:[],edges:[],annotations:[]},null,2)+'\n',{flag:'wx'});
    }
    if(template==='iteration'&&flags.name){const file=path.join(root,'artifact/workbench.json'),model=JSON.parse(await fs.readFile(file,'utf8'));model.title=flags.name;await fs.writeFile(file,JSON.stringify(model,null,2)+'\n');}
    console.log(`已创建 ${root}`);return;
  }
  const root=path.resolve(required(flags,'root')),store=await createStore(root);
  if(command==='serve'){
    const port=Number(flags.port||4318);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('端口应为 1～65535');
    await serve(root,{port,open:!!flags.open});return;
  }
  if(command==='check'){
    const bundle=await store.load(),errors=exportIssues(bundle.model);if(errors.length)throw new Error(errors.join('；'));
    console.log(`结构与资源检查通过：${bundle.model.nodes.length} 个页面，${bundle.model.edges.length} 条关系`);return;
  }
  if(command==='export'){
    const view=flags.view||'review';if(!['review','prototype'].includes(view))throw new Error('视图应为 review 或 prototype');
    const bundle=await store.load();
    if(flags.module&&!bundle.model.modules.some(m=>m.id===flags.module))throw new Error('模块不存在');
    if(flags.flow&&!bundle.model.flows?.some(flow=>flow.id===flags.flow))throw new Error('体验流程不存在');
    const out=path.resolve(flags.out||path.join(root,'dist',view==='prototype'?'prototype.html':'workbench.html'));
    if(sameOrInside(path.join(root,'artifact'),out)||!out.toLowerCase().endsWith('.html'))throw new Error('导出应为 artifact 目录以外的 HTML 文件');
    if(await exists(out)){const stat=await fs.lstat(out);if(stat.isSymbolicLink()||!stat.isFile()||!flags.replace)throw new Error('输出已存在；确认是生成文件后使用 --replace');}
    const html=await standalone(bundle,{module:flags.module,entryModule:flags.module,view,flow:flags.flow});
    await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,html,{flag:flags.replace?'w':'wx'});
    console.log(`已生成 ${out}`);return;
  }
  const {model,revision}=await store.readModel();
  if(command==='add'){
    const source=await fs.realpath(path.resolve(required(flags,'source'))),extension=path.extname(source).toLowerCase();
    const kind=['.html','.htm'].includes(extension)?'html':['.png','.jpg','.jpeg','.webp'].includes(extension)?'image':null;
    if(!kind)throw new Error('请选择 HTML、PNG、JPEG 或 WebP 文件');
    const id=identifier(flags.id||'page-'+randomUUID()),moduleId=flags.module||model.modules[0]?.id;
    if(model.nodes.some(n=>n.id===id))throw new Error('页面标识已存在');
    if(!model.modules.some(m=>m.id===moduleId))throw new Error('模块不存在');
    let content=await fs.readFile(source),width=Number(flags.width||1280),height=Number(flags.height||800);
    if(kind==='html')content=await inlineHTML(content.toString('utf8'),source,path.dirname(source));
    else if(extension==='.png'&&content.length>=24&&!flags.width&&!flags.height){width=content.readUInt32BE(16);height=content.readUInt32BE(20);}
    else if(!flags.width||!flags.height)throw new Error('JPEG / WebP 图片请指定 --width 和 --height');
    const relative=`${kind==='html'?'pages':'assets'}/${id}${kind==='html'?'.html':extension}`,target=path.join(store.artifact,relative),siblings=model.nodes.filter(n=>n.module===moduleId);
    model.nodes.push({id,module:moduleId,title:flags.title||path.basename(source,path.extname(source)),kind,path:relative,width,height,x:siblings.length?Math.max(...siblings.map(n=>n.x+440)):60,y:60,description:''});
    const module=model.modules.find(m=>m.id===moduleId);module.entry??=id;
    const errors=validate(model);if(errors.length)throw new Error(errors.join('；'));
    await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,content,{flag:'wx'});
    try{await store.save(model,revision);}catch(error){await fs.unlink(target);throw error;}
    console.log(`已添加 ${id}`);return;
  }
  if(command==='connect'){
    const from=required(flags,'from'),to=required(flags,'to');if(!flags.selector&&!flags.rect&&!flags.diagram)throw new Error('可操作跳转需指定 --selector 或 --rect；画布关系使用 --diagram');
    const edge={id:identifier(flags.id||'edge-'+randomUUID()),from,to,label:flags.label||'继续',...(flags.diagram?{diagram:true}:{}),...(flags.selector?{selector:flags.selector}:{}),...(flags.rect?{rect:flags.rect.split(',').map(Number)}:{}),...(flags.when?{when:JSON.parse(flags.when)}:{}),...(flags.set?{setContext:JSON.parse(flags.set)}:{})};
    if(flags.rect){const source=model.nodes.find(n=>n.id===from);if(source?.kind==='image')edge.imagePath=source.path;}
    model.edges.push(edge);const errors=validate(model);if(errors.length)throw new Error(errors.join('；'));await store.save(model,revision);console.log(`已连接 ${from} → ${to}`);return;
  }
  throw new Error(`未知命令：${command}`);
}
if(process.argv[1]&&await fs.realpath(process.argv[1]).catch(()=>'')===fileURLToPath(import.meta.url))run(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
