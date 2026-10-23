import {promises as fs} from 'node:fs';
import path from 'node:path';

const inside=(root,target)=>target===root||target.startsWith(root+path.sep);
// 供定位与服务共用，元数据查询无需载入运行时或布线引擎。
export async function safePath(root,relative,writing=false){
  if(typeof relative!=='string'||path.isAbsolute(relative)||relative.includes('\\')||relative.split('/').includes('..'))throw new Error('资源路径越界');
  const target=path.resolve(root,relative);if(!inside(root,target))throw new Error('资源路径越界');
  const canonicalRoot=await fs.realpath(root),real=await fs.realpath(writing?path.dirname(target):target);if(!inside(canonicalRoot,real))throw new Error('资源符号链接越界');
  if(writing)try{if(!inside(canonicalRoot,await fs.realpath(target)))throw new Error('资源符号链接越界');}catch(error){if(error.code!=='ENOENT')throw error;}
  return target;
}
