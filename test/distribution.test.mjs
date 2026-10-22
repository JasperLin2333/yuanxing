import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {copySkill} from '../scripts/distribution.mjs';
import {documentSourceKey} from '../runtime/document.mjs';
const source=fileURLToPath(new URL('../',import.meta.url));
const sourceVersion=JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8')).version;
for(const target of ['generic','skillhub','workbuddy'])test(`${target} 发布包不含开发材料，脱离源目录仍能创建、检查和离线导出`,async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yuanxing-package-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const skill=path.join(dir,'yuanxing');await copySkill(source,skill,{target});
  const files=[];async function walk(root,relative=''){for(const item of await fs.readdir(root,{withFileTypes:true})){const key=relative?relative+'/'+item.name:item.name;if(item.isDirectory())await walk(path.join(root,item.name),key);else files.push(key);}}await walk(skill);
  assert(!files.some(file=>file.includes('.test.')||file.startsWith('demo/')||file.startsWith('examples/')||file==='index.html'||file==='assets/site.js'));
  assert(files.every(file=>file.split('/').length<=2),'市场包仅含根目录与一层资源目录');
  const markdown=await fs.readFile(path.join(skill,'SKILL.md'),'utf8');assert(markdown.includes(`version: "${sourceVersion}"`));
  if(target==='generic')assert(!markdown.includes('displayName:'));if(target==='workbuddy')assert(markdown.includes('description_zh:'));
  const project=path.join(dir,'产品 with spaces');
  for(const args of [['init',project,'--template','iteration'],['check','--root',project],['export','--root',project,'--view','prototype'],['export','--root',project,'--view','document']]){
    const result=spawnSync(process.execPath,[path.join(skill,'scripts/yuanxing.mjs'),...args],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  }
  const html=await fs.readFile(path.join(project,'dist/prototype.html'),'utf8');assert(html.includes('GNU LESSER GENERAL PUBLIC LICENSE'));assert(html.includes('Apache License'));assert(!html.includes('<script type="module" src="/app.mjs"'));
  const documentHtml=await fs.readFile(path.join(project,'dist/document.html'),'utf8');assert(documentHtml.includes('"view":"document"'));const data=JSON.parse(documentHtml.match(/<script id="yuanxing-artifact" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  const referenced=data.yuanxing.document.blocks.filter(block=>block.type==='source');assert(referenced.length>0);assert.deepEqual(Object.keys(data.yuanxing.documentSources).sort(),[...new Set(referenced.map(documentSourceKey))].sort());for(const block of referenced){assert((await fs.stat(path.join(project,block.path))).isFile());assert(data.yuanxing.documentSources[documentSourceKey(block)].trim());}
});
