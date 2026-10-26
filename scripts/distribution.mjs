import {promises as fs} from 'node:fs';
import path from 'node:path';

const RENAMED=new Map(['LICENSE','LIBAVOID-LICENSE','DRAWIO-LICENSE','DRAWIO-NOTICE','FFLATE-LICENSE'].map(name=>[name,name+'.txt']));
const supported=new Set(['generic','skillhub','workbuddy']);
async function exists(file){try{await fs.access(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
function references(text){
  for(const [from,to] of [...RENAMED].sort((a,b)=>b[0].length-a[0].length))text=text.replace(new RegExp('(?<![\\w.-])'+from+'(?![\\w.-])','g'),to);
  return text;
}
export function marketplaceSkill(markdown,target){
  if(!supported.has(target))throw new Error('未知发布通道：'+target);
  if(target==='generic')return markdown;
  const version=markdown.match(/^  version:\s*["']?([^"'\n]+)/m)?.[1],author=markdown.match(/^  author:\s*(.+)/m)?.[1];
  if(!version||!author)throw new Error('Skill 缺少 metadata.version 或 metadata.author');
  const common={version,display_name:'元形 · AI 产品原型工作台'};
  const fields=target==='workbuddy'?{...common,display_name_en:'Yuanxing',description_zh:'通过自然语言组织流程画布、完整原型和交互式需求文档，导出离线 HTML',description_en:'Design connected prototypes and flexible interactive requirements documents; export offline HTML.',author}:{slug:'yuanxing',...common,displayName:common.display_name,summary:'复用截图和 HTML，用自然语言编排流程、完整原型与交互式需求文档'};
  return markdown.replace(/^---\n/,()=>`---\n${Object.entries(fields).map(([key,value])=>key+': '+JSON.stringify(value)).join('\n')}\n`);
}

// 明确列出运行所需文件，官网、测试和个人项目不会随目录增长进入技能包。
export async function copySkill(source,destination,{target='generic'}={}){
  if(!supported.has(target))throw new Error('未知发布通道：'+target);
  const market=target!=='generic';
  async function copy(relative){
    let original=path.join(source,relative);
    if(!await exists(original)&&RENAMED.has(path.basename(relative)))original+='.txt';
    const stat=await fs.lstat(original);if(stat.isSymbolicLink())throw new Error('发布资源不能是符号链接：'+relative);
    if(stat.isDirectory()){
      for(const name of await fs.readdir(original))if(!name.endsWith('.test.mjs')&&!name.startsWith('.'))await copy(path.posix.join(relative,name));
      return;
    }
    const output=market?(RENAMED.get(path.basename(original))||path.basename(original)):path.basename(original);
    const file=path.join(destination,path.dirname(relative),output);await fs.mkdir(path.dirname(file),{recursive:true});
    let data=await fs.readFile(original);
    if(relative==='SKILL.md')data=Buffer.from(marketplaceSkill(data.toString(),target));
    if(market&&(relative.endsWith('.md')||relative==='runtime/server.mjs'))data=Buffer.from(references(data.toString()));
    await fs.writeFile(file,data,{flag:'wx'});
  }
  for(const item of ['SKILL.md','LICENSE','THIRD_PARTY_NOTICES.md','agents','references','runtime','scripts/yuanxing.mjs','scripts/install.mjs','scripts/distribution.mjs'])await copy(item);
  const exampleRoot=path.join(source,'examples/product-iteration'),packed=path.join(source,'assets/iteration.json');
  let example;
  if(await exists(exampleRoot)){
    example={};async function walk(dir,relative=''){for(const item of await fs.readdir(dir,{withFileTypes:true})){const key=relative?relative+'/'+item.name:item.name;if(item.isDirectory())await walk(path.join(dir,item.name),key);else if(item.isFile())example[key]=(await fs.readFile(path.join(dir,item.name))).toString('base64');}}await walk(exampleRoot);
  }else example=JSON.parse(await fs.readFile(packed,'utf8'));
  await fs.mkdir(path.join(destination,'assets'),{recursive:true});await fs.writeFile(path.join(destination,'assets/iteration.json'),JSON.stringify(example),{flag:'wx'});
}
