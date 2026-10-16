#!/usr/bin/env node
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {copySkill} from './distribution.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const index=process.argv.indexOf('--target'),target=index<0?'skillhub':process.argv[index+1];
if(!['generic','skillhub','workbuddy'].includes(target))throw new Error('发布通道应为 generic、skillhub 或 workbuddy');
const out=path.join(root,'dist',target),stage=path.join(out,'yuanxing'),temporary=out+'.pack-'+process.pid;
try{
  await fs.mkdir(path.join(temporary,'yuanxing'),{recursive:true});await copySkill(root,path.join(temporary,'yuanxing'),{target});
  const result=spawnSync('zip',['-qr','yuanxing.zip','yuanxing'],{cwd:temporary,encoding:'utf8'});
  if(result.status!==0)throw new Error(result.stderr||'打包需要 zip 命令');
  await fs.mkdir(path.dirname(out),{recursive:true});await fs.rm(out,{recursive:true,force:true});await fs.rename(temporary,out);
  console.log(`发布目录：${stage}\n压缩包：${path.join(out,'yuanxing.zip')}`);
}finally{await fs.rm(temporary,{recursive:true,force:true});}
