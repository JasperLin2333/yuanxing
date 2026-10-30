import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('../scripts/install.mjs',import.meta.url));
const install=(...args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
async function temporary(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yuanxing-install-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
const read=file=>fs.readFile(file,'utf8');

test('安装写入记录；检查只读，未改动的安装可直接更新',async t=>{
  const dir=await temporary(t),target=path.join(dir,'skills','yuanxing');
  assert.equal(install('--target',target).status,0);
  const record=JSON.parse(await read(path.join(target,'.yuanxing-install.json')));assert(record.files['SKILL.md']);assert(!('.yuanxing-install.json' in record.files));
  const before=await fs.readdir(path.dirname(target)),checked=install('--target',target,'--check');
  assert.equal(checked.status,0,checked.stderr);assert.match(checked.stdout,/与当前源码打包结果：\n  无差异/);assert.match(checked.stdout,/安装后本地改动：\n  无差异/);
  assert.deepEqual(await fs.readdir(path.dirname(target)),before,'检查不在 Skills 目录留下文件');
  const updated=install('--target',target,'--update');assert.equal(updated.status,0,updated.stderr);assert.match(updated.stdout,/已是最新/);
  assert.notEqual(install('--target',target).status,0,'普通安装不覆盖已有目录');
});

test('有本地改动时拒绝更新；--force 先备份并核对，再整体替换',async t=>{
  const dir=await temporary(t),target=path.join(dir,'skills','yuanxing'),backup=path.join(dir,'backup','yuanxing');
  assert.equal(install('--target',target).status,0);
  await fs.appendFile(path.join(target,'SKILL.md'),'\n本机补充\n');await fs.writeFile(path.join(target,'notes.md'),'私人笔记');await fs.rm(path.join(target,'references/workbench.md'));
  const checked=install('--target',target,'--check');assert.equal(checked.status,0);assert.match(checked.stdout,/新增 1：notes\.md/);assert.match(checked.stdout,/修改 1：SKILL\.md/);assert.match(checked.stdout,/缺失 1：references\/workbench\.md/);
  const refused=install('--target',target,'--update','--backup',backup);assert.notEqual(refused.status,0);assert.match(refused.stderr,/--force/);
  assert.equal(await read(path.join(target,'notes.md')),'私人笔记');assert(!await fs.stat(backup).catch(()=>false),'拒绝时不创建备份');
  const forced=install('--target',target,'--update','--force','--backup',backup);assert.equal(forced.status,0,forced.stderr);assert.match(forced.stdout,/已备份到/);
  assert.equal(await read(path.join(backup,'notes.md')),'私人笔记');assert.match(await read(path.join(backup,'SKILL.md')),/本机补充/);
  assert(!await fs.stat(path.join(target,'notes.md')).catch(()=>false));assert((await fs.stat(path.join(target,'references/workbench.md'))).isFile());assert.doesNotMatch(await read(path.join(target,'SKILL.md')),/本机补充/);
  assert.deepEqual((await fs.readdir(path.dirname(target))).sort(),['yuanxing'],'不留下临时或旧目录');
  assert.match(install('--target',target,'--check').stdout,/安装后本地改动：\n  无差异/);
  await fs.writeFile(path.join(target,'notes.md'),'再次修改');const reused=install('--target',target,'--update','--force','--backup',backup);
  assert.notEqual(reused.status,0,'不覆盖已有备份');assert.match(reused.stderr,/备份目录已存在/);assert.equal(await read(path.join(target,'notes.md')),'再次修改');
});

test('没有安装记录的旧安装：内容一致时补写记录，存在差异时需确认',async t=>{
  const dir=await temporary(t),target=path.join(dir,'skills','yuanxing');
  assert.equal(install('--target',target).status,0);await fs.rm(path.join(target,'.yuanxing-install.json'));
  assert.match(install('--target',target,'--check').stdout,/没有安装记录/);
  assert.match(install('--target',target,'--update').stdout,/已是最新/);assert((await fs.stat(path.join(target,'.yuanxing-install.json'))).isFile());
  await fs.rm(path.join(target,'.yuanxing-install.json'));await fs.appendFile(path.join(target,'SKILL.md'),'\n旧版本内容\n');
  const refused=install('--target',target,'--update','--backup',path.join(dir,'b1'));assert.notEqual(refused.status,0);assert.match(refused.stderr,/没有记录/);
  assert.notEqual(install('--target',path.join(dir,'skills','other')).status,0,'目录名必须是 yuanxing');
  assert.notEqual(install('--target',target,'--update','--force','--backup',path.join(target,'inside')).status,0,'备份不能放进安装目录');
});
