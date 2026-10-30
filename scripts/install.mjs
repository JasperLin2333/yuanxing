#!/usr/bin/env node
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {copySkill} from './distribution.mjs';

const RECORD='.yuanxing-install.json';
const usage=`安装：node scripts/install.mjs --target <宿主的Skills目录>/yuanxing
检查：node scripts/install.mjs --target <安装目录> --check
更新：node scripts/install.mjs --target <安装目录> --update [--backup <备份目录>] [--force]`;
const source=path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function options(args){
  const result={};
  for(let i=0;i<args.length;i++){
    const key=args[i].replace(/^--/,'');
    if(['check','update','force'].includes(key))result[key]=true;
    else if(['target','backup'].includes(key)){if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`缺少 --${key} 的值`);result[key]=args[++i];}
    else throw new Error('未知参数：'+args[i]);
  }
  return result;
}
async function exists(file){try{await fs.lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
// 安装记录本身不参与摘要，用于判断安装后是否被手动修改。
async function digest(root){
  const files={};
  async function walk(dir,relative){
    for(const item of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      const key=relative?relative+'/'+item.name:item.name,file=path.join(dir,item.name);
      if(!relative&&item.name===RECORD)continue;
      if(item.isSymbolicLink())files[key]='link:'+await fs.readlink(file);
      else if(item.isDirectory())await walk(file,key);
      else files[key]=createHash('sha256').update(await fs.readFile(file)).digest('hex');
    }
  }
  await walk(root,'');return files;
}
function compare(expected,actual){
  const keys=[...new Set([...Object.keys(expected),...Object.keys(actual)])].sort();
  return {added:keys.filter(k=>!(k in expected)),changed:keys.filter(k=>k in expected&&k in actual&&expected[k]!==actual[k]),missing:keys.filter(k=>!(k in actual))};
}
const same=diff=>!diff.added.length&&!diff.changed.length&&!diff.missing.length;
function describe(diff){
  if(same(diff))return '  无差异';
  return [['新增',diff.added],['修改',diff.changed],['缺失',diff.missing]].filter(([,list])=>list.length).map(([name,list])=>`  ${name} ${list.length}：${list.slice(0,20).join('、')}${list.length>20?' 等':''}`).join('\n');
}
async function version(root){return (await fs.readFile(path.join(root,'SKILL.md'),'utf8')).match(/^  version:\s*["']?([^"'\n]+)/m)?.[1]||'未知';}
// 完整组装后再替换；更新时放在目标旁边，保证同一文件系统内重命名。
async function stage(temporary){
  await fs.rm(temporary,{recursive:true,force:true});await fs.mkdir(temporary,{recursive:true});
  try{
    await copySkill(source,temporary);
    const files=await digest(temporary);
    await fs.writeFile(path.join(temporary,RECORD),JSON.stringify({version:await version(temporary),installedAt:new Date().toISOString(),files},null,2)+'\n',{flag:'wx'});
    return files;
  }catch(error){await fs.rm(temporary,{recursive:true,force:true});throw error;}
}
// 只读检查在系统临时目录组装，不在宿主的 Skills 目录写入任何文件。
async function inspect(target){
  const stat=await fs.lstat(target);
  if(stat.isSymbolicLink())throw new Error('目标是符号链接，请直接维护它指向的源码，不通过安装脚本更新');
  if(!stat.isDirectory())throw new Error('目标不是目录');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yuanxing-check-'));
  try{
    const packed=await stage(path.join(dir,'yuanxing')),actual=await digest(target);let record=null;
    try{record=JSON.parse(await fs.readFile(path.join(target,RECORD),'utf8'));}catch(error){if(error.code!=='ENOENT')throw new Error('安装记录无法读取：'+error.message);}
    return {actual,record,toPackage:compare(packed,actual),local:record?.files?compare(record.files,actual):null,sourceVersion:await version(source)};
  }finally{await fs.rm(dir,{recursive:true,force:true});}
}
function report(target,state){
  console.log(`安装位置：${target}
已安装版本：${state.record?.version||'未知（没有安装记录）'}　源码版本：${state.sourceVersion}
与当前源码打包结果：
${describe(state.toPackage)}
安装后本地改动：
${state.local?describe(state.local):'  没有安装记录，无法区分本地改动与旧版本差异'}`);
}
function timestamp(){return new Date().toISOString().replace(/[-:]/g,'').replace(/\..+$/,'').replace('T','-');}

async function install(target){
  if(await exists(target))throw new Error('目标已存在；先用 --check 查看差异，再用 --update 备份后更新');
  const temporary=target+'.install-'+process.pid;await stage(temporary);
  try{await fs.rename(temporary,target);}finally{await fs.rm(temporary,{recursive:true,force:true});}
  console.log(`已安装 ${target}`);
}
async function update(target,{backup,force}){
  if(!await exists(target))return install(target);
  const state=await inspect(target),localChanged=state.local?!same(state.local):!same(state.toPackage);
  if(same(state.toPackage)){
    // 内容已与源码一致时只补写或刷新安装记录，不替换文件。
    if(!state.local||!same(state.local)){const temporary=target+'.install-'+process.pid;try{await stage(temporary);await fs.copyFile(path.join(temporary,RECORD),path.join(target,RECORD));}finally{await fs.rm(temporary,{recursive:true,force:true});}}
    console.log(`已是最新：${target}`);return;
  }
  if(localChanged&&!force){
    report(target,state);
    throw new Error(state.record?'安装目录在安装后被修改；核对上方差异并保存需要的内容后，再加 --force 更新（仍会先备份）':'旧安装没有记录，无法确认差异来源；核对上方差异后，再加 --force 更新（仍会先备份）');
  }
  // 默认备份放在 Skills 目录外，避免宿主把备份当成第二个同名 Skill 加载。
  const saved=path.resolve(backup||path.join(os.homedir(),'.yuanxing-backups',`yuanxing-${timestamp()}`));
  if(saved===target||saved.startsWith(target+path.sep))throw new Error('备份目录不能位于安装目录内');
  if(await exists(saved))throw new Error('备份目录已存在：'+saved);
  await fs.mkdir(path.dirname(saved),{recursive:true});await fs.cp(target,saved,{recursive:true,errorOnExist:true,force:false,verbatimSymlinks:true});
  if(!same(compare(state.actual,await digest(saved))))throw new Error('备份与原安装不一致，已停止更新：'+saved);
  const temporary=target+'.install-'+process.pid,previous=target+'.previous-'+process.pid;
  try{
    await stage(temporary);await fs.rename(target,previous);
    try{await fs.rename(temporary,target);}catch(error){await fs.rename(previous,target);throw error;}
    await fs.rm(previous,{recursive:true,force:true});
  }finally{await fs.rm(temporary,{recursive:true,force:true});}
  console.log(`已更新 ${target}（${state.record?.version||'未知版本'} → ${state.sourceVersion}）\n原安装已备份到 ${saved}`);
}

try{
  const flags=options(process.argv.slice(2));
  if(!flags.target)console.log(usage);
  else{
    const target=path.resolve(flags.target);
    if(path.basename(target)!=='yuanxing')throw new Error('目标 Skill 目录名应为 yuanxing');
    if(flags.check){if(await exists(target))report(target,await inspect(target));else console.log(`尚未安装：${target}`);}
    else if(flags.update)await update(target,flags);
    else await install(target);
  }
}catch(error){console.error(error.message);process.exitCode=1;}
