// 展示数据引用静态研发 JSON 中已有的字符串，保持 manifest/files 原样可读。
const anchorSize=96;
function anchors(text){
  const positions=new Set([0]);
  for(const match of text.matchAll(/[<>\n]|data:/g)){positions.add(match.index);positions.add(match.index+match[0].length);}
  return [...positions].sort((a,b)=>a-b);
}
function commonLength(a,start,b,offset){
  const limit=Math.min(a.length-start,b.length-offset);let length=anchorSize;
  while(length+1024<=limit&&a.slice(start+length,start+length+1024)===b.slice(offset+length,offset+length+1024))length+=1024;
  while(length<limit&&a[start+length]===b[offset+length])length++;
  return length;
}
export function compactExportBoot(boot,artifact){
  const files=Object.entries(artifact.files),index=new Map();
  for(let file=0;file<files.length;file++){
    const text=files[file][1];
    for(const start of anchors(text)){
      if(start+anchorSize>text.length)continue;
      const key=text.slice(start,start+anchorSize),matches=index.get(key);
      if(!matches)index.set(key,[[file,start]]);
      else if(matches.length<4&&!matches.some(ref=>ref[0]===file))matches.push([file,start]);
    }
  }
  const bundle={...boot.bundle},entries=[];
  for(const section of ['resources','fragments','images']){
    const values={...bundle[section]};
    for(const [key,text] of Object.entries(values)){
      if(typeof text!=='string'||text.length<4096)continue;
      const parts=[];let cursor=0;
      for(const start of anchors(text)){
        if(start<cursor||start+anchorSize>text.length)continue;
        const matches=index.get(text.slice(start,start+anchorSize));if(!matches)continue;
        let best=null,length=0;
        for(const [file,offset] of matches){const size=commonLength(text,start,files[file][1],offset);if(size>length){length=size;best=[file,offset,size];}}
        if(start>cursor)parts.push(text.slice(cursor,start));parts.push(best);cursor=start+length;
      }
      if(!parts.length)continue;if(cursor<text.length)parts.push(text.slice(cursor));
      if(JSON.stringify(parts).length+key.length+section.length+40>=text.length*.9)continue;
      entries.push([section,key,parts]);values[key]='';
    }
    bundle[section]=values;
  }
  return entries.length?{...boot,bundle,sharedStrings:{version:1,files:files.map(([name])=>name),entries}}:boot;
}

// 自包含函数：同时用于离线启动和 Node 的无浏览器还原验证。
export function restoreExportBoot(boot,artifact){
  const shared=boot.sharedStrings;if(!shared)return boot;
  if(shared.version!==1||!artifact?.files)throw new Error('离线共享数据缺失或版本不支持');
  const bundle={...boot.bundle};
  for(const section of ['resources','fragments','images'])bundle[section]={...bundle[section]};
  for(const [section,key,parts] of shared.entries){
    if(!['resources','fragments','images'].includes(section))throw new Error('离线共享数据分组无效');
    const text=parts.map(part=>{
      if(typeof part==='string')return part;
      const [file,start,length]=part,source=artifact.files[shared.files[file]];
      if(typeof source!=='string'||!Number.isInteger(start)||!Number.isInteger(length)||start<0||length<0||start+length>source.length)throw new Error('离线共享资源引用无效');
      return source.slice(start,start+length);
    }).join('');
    Object.defineProperty(bundle[section],key,{value:text,enumerable:true,writable:true,configurable:true});
  }
  const restored={...boot,bundle};delete restored.sharedStrings;return restored;
}
