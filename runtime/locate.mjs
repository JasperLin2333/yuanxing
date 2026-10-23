import {promises as fs} from 'node:fs';
import path from 'node:path';
import {safePath} from './paths.mjs';
import {walkDocument,extractDocumentSource} from './document.mjs';

// 只读取编排与命中的正文位置，不构建页面、展开图片或执行项目扩展。
export async function locateProject(root,{query='',module,limit=6}={}) {
  if(!Number.isInteger(limit)||limit<1||limit>30)throw new Error('定位结果数量应为 1～30');
  root=await fs.realpath(root);
  const model=JSON.parse(await fs.readFile(await safePath(root,'artifact/workbench.json'),'utf8'));
  if(!Array.isArray(model.modules)||!Array.isArray(model.nodes))throw new Error('工作台数据格式不正确');
  if(module&&!model.modules.some(item=>item.id===module))throw new Error('模块不存在');
  const normalize=text=>String(text||'').normalize('NFKC').toLowerCase(),terms=normalize(query).trim().split(/\s+/).filter(Boolean);
  const matches=text=>terms.every(term=>normalize(text).includes(term));
  const modules=new Map(model.modules.map(item=>[item.id,item]));
  if(!terms.length&&!module)return {title:model.title,modules:model.modules.map(item=>({id:item.id,title:item.title,pages:model.nodes.filter(node=>node.module===item.id).length}))};
  const blocks=[];walkDocument(model.document?.blocks,block=>blocks.push(block));
  const sectionNodes=new Set();
  for(const block of blocks)if(terms.length&&block.type==='source'&&matches(block.section))for(const id of block.nodes||[])sectionNodes.add(id);
  const candidates=model.nodes.filter(node=>!module||node.module===module);
  let found=candidates.filter(node=>!terms.length||sectionNodes.has(node.id)||matches([node.id,node.title,node.module,modules.get(node.module)?.title].join(' ')));
  let matchedBy='名称与章节';
  if(!found.length){found=candidates.filter(node=>matches([node.summary,node.description,model.rules?.[node.rule]].join(' ')));matchedBy='说明正文';}
  const exact=normalize(query).trim(),rank=node=>(normalize(node.id)===exact?1000:0)+(terms.length&&matches(node.title)?100:0)+(sectionNodes.has(node.id)?50:0);
  found.sort((a,b)=>rank(b)-rank(a));
  const selected=found.slice(0,limit),ids=new Set(selected.map(node=>node.id));
  const editingSources=node=>{
    const declared=node.sources??modules.get(node.module)?.sources;
    if(declared!==undefined){if(!Array.isArray(declared)||declared.some(file=>typeof file!=='string'))throw new Error('编辑源位置格式不正确');return declared;}
    return node.kind==='html'&&!node.render?['artifact/'+node.path]:[];
  };
  const requirements=[],texts=new Map(),seen=new Set();
  for(const block of blocks){
    const associated=block.nodes?.some(id=>ids.has(id))||ids.has(block.node)||block.edge&&(model.edges||[]).some(edge=>edge.id===block.edge&&ids.has(edge.from));
    if(block.type==='source'&&(associated||terms.length&&matches(block.section))){
      const key=JSON.stringify([block.path,block.section]);if(seen.has(key))continue;seen.add(key);
      if(!texts.has(block.path))texts.set(block.path,await fs.readFile(await safePath(root,block.path),'utf8'));
      const text=texts.get(block.path),section=extractDocumentSource(text,block.section),start=text.indexOf(section),startLine=text.slice(0,start).split('\n').length;
      requirements.push({path:block.path,...(block.section?{section:block.section}:{}),startLine,endLine:startLine+section.split('\n').length-1});
    }else if(block.type==='description'&&associated)requirements.push({path:'artifact/workbench.json',...(block.edge?{edge:block.edge}:{node:block.node}),field:'description',...(block.rule?{rule:block.rule}:{})});
  }
  let sourceGuide;try{await fs.access(await safePath(root,'README.md'));sourceGuide='README.md';}catch(error){if(error.code!=='ENOENT')throw error;}
  return {title:model.title,query,totalMatches:found.length,truncated:found.length>selected.length,matchedBy,
    pages:selected.map(node=>({id:node.id,title:node.title,module:node.module,preview:node.path?'artifact/'+node.path:undefined,editingSources:editingSources(node),...(node.render?{render:node.render}:{}),...(node.summary?{summary:node.summary}:{})})),requirements,...(sourceGuide?{sourceGuide}:{})};
}

// 默认仅输出可用于下一步编辑的定位信息；完整元数据由 --json 按需获取。
export function formatLocateResult(result){
  const line=value=>String(value??'').replace(/\s+/g,' ').trim();
  if(!result.pages)return [line(result.title),...result.modules.map(item=>`${item.id} · ${line(item.title)}（${item.pages} 个页面）`)].join('\n');
  const lines=[`${line(result.title)}${result.query?' · '+line(result.query):''}（${result.pages.length}/${result.totalMatches}）`];
  if(result.pages.length)lines.push('页面：',...result.pages.map(page=>`${page.id} · ${line(page.title)} [${page.module}]`));
  else lines.push('未找到关联页面；可在本项目用 rg 搜索关键词。');
  const sources=new Map(),unknown=[];
  for(const page of result.pages){
    if(!page.editingSources.length)unknown.push(page.id);
    for(const source of page.editingSources){if(!sources.has(source))sources.set(source,new Set());sources.get(source).add(page.id);}
  }
  if(sources.size)lines.push('编辑源：',...[...sources].map(([source,ids])=>`${source} [${[...ids].join(', ')}]`));
  if(unknown.length)lines.push('编辑源未明确：'+unknown.join(', ')+(result.sourceGuide?'；查 '+result.sourceGuide:''));
  if(result.requirements.length)lines.push('需求：',...result.requirements.map(item=>item.startLine?`${item.path}:${item.startLine}-${item.endLine}${item.section?' · '+line(item.section):''}`:`${item.path} · ${item.rule?'规则 '+item.rule:(item.edge?'连线 '+item.edge:'节点 '+item.node)+' 的 '+item.field}`));
  if(result.truncated)lines.push('结果已截断；用 --module 或更具体关键词收窄。');
  return lines.join('\n');
}
