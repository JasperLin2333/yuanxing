#!/usr/bin/env node
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

// HTML 内的 SVG 是绘图源，PNG 只供普通 Markdown 阅读器使用。
export function flowchartSVG(html){
  const matches=[...html.matchAll(/<svg\b[\s\S]*?<\/svg\s*>/gi)];
  if(matches.length!==1)throw new Error('流程图 HTML 应包含一个完整的内嵌 SVG');
  const svg=matches[0][0],viewBox=svg.match(/\bviewBox\s*=\s*["']\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*["']/i);
  if(!viewBox||![viewBox[1],viewBox[2]].every(value=>Number(value)>0))throw new Error('SVG 需要从 0 0 开始的有效 viewBox');
  if(/<script\b|<foreignObject\b|(?:href|src)\s*=\s*["'](?!#)|url\(\s*["']?(?!#)[^\s"')]/i.test(svg))throw new Error('流程图 SVG 需自包含，使用原生文字、图形和本地样式');
  return {svg,width:Number(viewBox[1]),height:Number(viewBox[2])};
}
export async function renderFlowchart(input,output,{scale=2,font,renderer}={}){
  if(!/\.html?$/i.test(input)||!/\.png$/i.test(output)||!Number.isFinite(scale)||scale<=0||scale>4)throw new Error('请提供 HTML 输入、PNG 输出及大于 0 且不超过 4 的倍率');
  const {svg,width,height}=flowchartSVG(await fs.readFile(input,'utf8'));
  let Resvg;
  try{({Resvg}=createRequire(import.meta.url)(renderer?path.resolve(renderer):'@resvg/resvg-js'));}
  catch{throw new Error('生成 PNG 需要 @resvg/resvg-js；可用 --renderer 指向环境已有或本次临时安装的模块目录');}
  await fs.mkdir(path.dirname(path.resolve(output)),{recursive:true});
  const rendered=new Resvg(svg,{background:'#ffffff',fitTo:{mode:'width',value:Math.round(width*scale)},font:{loadSystemFonts:true,...(font?{fontFiles:[font]}:{})}}).render();
  await fs.writeFile(output,rendered.asPng());
  return {output:path.resolve(output),width:rendered.width,height:rendered.height};
}
async function main(){
  const args=process.argv.slice(2);if(!args.length||args.includes('--help')){console.log('node scripts/flowchart.mjs --input <流程图.html> --output <流程图.png> [--scale 2] [--font <字体文件>] [--renderer <resvg模块目录>]');return;}
  const flags={};for(let i=0;i<args.length;i+=2){if(!['--input','--output','--scale','--font','--renderer'].includes(args[i])||!args[i+1])throw new Error('流程图参数不正确');flags[args[i].slice(2)]=args[i+1];}
  if(!flags.input||!flags.output)throw new Error('请指定 --input 和 --output');
  const result=await renderFlowchart(flags.input,flags.output,{scale:Number(flags.scale||2),font:flags.font,renderer:flags.renderer});console.log(`流程图：${result.output}（${result.width}×${result.height}）`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
