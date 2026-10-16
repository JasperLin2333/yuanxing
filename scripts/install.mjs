#!/usr/bin/env node
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const source=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const i=process.argv.indexOf('--target');
if(i<0||!process.argv[i+1]){console.log('安装：node scripts/install.mjs --target <宿主的Skills目录>/yuanxing');process.exit(0);}
const target=path.resolve(process.argv[i+1]);
try{
  if(path.basename(target)!=='yuanxing')throw new Error('目标 Skill 目录名应为 yuanxing');
  try{await fs.lstat(target);throw new Error('目标已存在，请保留原安装并选择其他安装位置');}catch(error){if(error.code!=='ENOENT')throw error;}
  // 先在旁边完整组装，避免安装中断留下半份 Skill。
  const temporary=target+'.install-'+process.pid;await fs.mkdir(temporary,{recursive:true});
  try{
    for(const item of ['SKILL.md','README.md','LICENSE','THIRD_PARTY_NOTICES.md','assets','agents','references','runtime','scripts','examples'])await fs.cp(path.join(source,item),path.join(temporary,item),{recursive:true,filter:file=>!file.endsWith('.test.mjs')});
    await fs.rename(temporary,target);console.log(`已安装 ${target}`);
  }finally{await fs.rm(temporary,{recursive:true,force:true});}
}catch(error){console.error(error.message);process.exitCode=1;}
