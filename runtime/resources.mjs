import {promises as fs} from 'node:fs';
import path from 'node:path';

const mimeTypes = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.ico':'image/x-icon'};
export async function inlineHTML(html, file, root) {
  const canonicalRoot = await fs.realpath(root);
  async function local(value, from) {
    if (/^(?:data:|#)/i.test(value)) return null;
    if (/^(?:[a-z][\w+.-]*:|\/\/|\/)/i.test(value)) throw new Error(`原型资源需保存在项目内：${value}`);
    const target = await fs.realpath(path.resolve(path.dirname(from), decodeURIComponent(value.split(/[?#]/)[0])));
    if (target !== canonicalRoot && !target.startsWith(canonicalRoot + path.sep)) throw new Error(`资源路径越界：${value}`);
    return target;
  }
  async function dataURL(value, from) {
    const target = await local(value, from); if (!target) return value;
    const mime = mimeTypes[path.extname(target).toLowerCase()];
    if (!mime) throw new Error(`不支持的资源类型：${value}`);
    return `data:${mime};base64,${(await fs.readFile(target)).toString('base64')}`;
  }
  async function replaceAsync(text, pattern, fn) {
    const matches = [...text.matchAll(pattern)], replacements = await Promise.all(matches.map(fn));
    for (let i = matches.length - 1; i >= 0; i--) text = text.slice(0, matches[i].index) + replacements[i] + text.slice(matches[i].index + matches[i][0].length);
    return text;
  }
  async function css(text, from, trail = []) {
    if (/@import\b/i.test(text)) throw new Error('请将 CSS @import 合并到本地样式文件');
    return replaceAsync(text, /url\(\s*(["']?)([^)'"\s]+)\1\s*\)/gi, async match => `url("${await dataURL(match[2], from)}")`);
  }
  const scripts=[];
  html = await replaceAsync(html, /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, async match => {
    const src=match[1].match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if(/\btype\s*=\s*["']module["']/i.test(match[1]))throw new Error('请先将模块脚本组装成自包含 HTML，再加入原型');
    let script=match[0];
    if(src){const target=await local(src[1],file);if(!target||!/\.(?:js|mjs)$/i.test(target))throw new Error('脚本需使用项目内的 JavaScript 文件');const source=await fs.readFile(target,'utf8');if(/^\s*(?:import|export)\s/m.test(source))throw new Error('请先将模块脚本组装成自包含 HTML，再加入原型');script=`<script>${source.replace(/<\/script/gi,'<\\/script')}</script>`;}
    const index=scripts.push(script)-1;return `<!-- YX-INLINE-SCRIPT-${index} -->`;
  });
  html = await replaceAsync(html, /<link\b(?=[^>]*\brel\s*=\s*["']stylesheet["'])[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi, async match => {
    const target = await local(match[1], file); if (!target) throw new Error('样式表路径不正确');
    return `<style>${await css(await fs.readFile(target, 'utf8'), target)}</style>`;
  });
  html = await replaceAsync(html, /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, async match => `<style>${await css(match[1], file)}</style>`);
  html = await replaceAsync(html, /\b(src|poster)\s*=\s*(["'])([^"']+)\2/gi, async match => `${match[1]}=${match[2]}${await dataURL(match[3], file)}${match[2]}`);
  html = await replaceAsync(html, /\bstyle\s*=\s*(["'])([^"']*)\1/gi, async match => `style=${match[1]}${(await css(match[2], file)).replace(/"/g, '&quot;')}${match[1]}`);
  if (/\bsrcset\s*=|<iframe\b|<object\b|<embed\b|<link\b|@import\b|<script\b[^>]*\bsrc\s*=/i.test(html)) throw new Error('原型仍有未内嵌的资源，请使用本地 CSS、图片和普通 JavaScript');
  return html.replace(/<!-- YX-INLINE-SCRIPT-(\d+) -->/g,(_,index)=>scripts[Number(index)]);
}
