#!/usr/bin/env node
// 生成可提交到 SkillHub 的发布包。
// SkillHub 不接受无扩展名文件，因此这里为许可文件补 .txt，并同步文档内的引用。
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'dist', 'skillhub');
const stage = path.join(out, 'yuanxing');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.idea', '.vscode', '__pycache__']);
const SKIP_FILES = new Set(['.gitignore', '.gitattributes', '.nojekyll', '.DS_Store']);

// SkillHub 不接受位图文件，图标改由平台的 iconUrl 单独管理；
// pack.mjs 自身是发布工具，不进入发布包。
const SKIP_PATHS = new Set(['assets/icon.png', 'assets/icon.svg', 'scripts/pack.mjs']);

// 无扩展名文件在包内的新名字
const RENAMED = new Map([
  ['LICENSE', 'LICENSE.txt'],
  ['LIBAVOID-LICENSE', 'LIBAVOID-LICENSE.txt'],
  ['DRAWIO-LICENSE', 'DRAWIO-LICENSE.txt'],
  ['DRAWIO-NOTICE', 'DRAWIO-NOTICE.txt'],
]);

// 需要把引用同步改成新名字的文档
const DOCS = new Set(['README.md', 'THIRD_PARTY_NOTICES.md']);

function rewriteReferences(text) {
  let result = text;
  for (const [from, to] of RENAMED) {
    result = result.split(`](${from})`).join(`](${to})`);
    result = result.split(`vendor/${from}`).join(`vendor/${to}`);
    result = result.split(`\`${from}\``).join(`\`${to}\``);
  }
  return result;
}

async function copy(from, relative = '') {
  for (const entry of await fs.readdir(from, {withFileTypes: true})) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await copy(path.join(from, entry.name), relative ? `${relative}/${entry.name}` : entry.name);
      continue;
    }
    if (SKIP_FILES.has(entry.name)) continue;
    const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
    if (SKIP_PATHS.has(relativePath)) continue;
    const targetName = RENAMED.get(entry.name) || entry.name;
    const destination = path.join(stage, relative ? `${relative}/${targetName}` : targetName);
    await fs.mkdir(path.dirname(destination), {recursive: true});
    let data = await fs.readFile(path.join(from, entry.name));
    if (DOCS.has(relativePath)) {
      data = Buffer.from(rewriteReferences(data.toString('utf8')), 'utf8');
    }
    await fs.writeFile(destination, data);
  }
}

await fs.rm(out, {recursive: true, force: true});
await fs.mkdir(stage, {recursive: true});
await copy(root);

const zipPath = path.join(out, 'yuanxing.zip');
const zipped = spawnSync('zip', ['-qr', zipPath, 'yuanxing'], {cwd: out, encoding: 'utf8'});
if (zipped.status !== 0) {
  console.error(zipped.stderr || '打包失败');
  process.exit(1);
}

const files = [];
async function walk(dir, relative = '') {
  for (const entry of await fs.readdir(dir, {withFileTypes: true})) {
    if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative ? `${relative}/${entry.name}` : entry.name);
    else files.push(relative ? `${relative}/${entry.name}` : entry.name);
  }
}
await walk(stage);

console.log(`发布目录：${stage}`);
console.log(`压缩包：${zipPath}`);
console.log(`文件数：${files.length}`);
console.log('发布：skillhub publish "' + stage + '" --host "https://api.skillhub.cn" --changelog "..."');
