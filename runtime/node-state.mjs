// 独立保存删除状态；展示标记不再决定新格式节点的生命周期。
export function isDeletedNode(model,node){
  if(typeof node?.deleted==='boolean')return node.deleted;
  return model?.nodeStateVersion===undefined&&node?.overview===false&&node.canvas!==false&&!node.overviewAlias&&!(node.kind==='note'&&node.presentation==='branch');
}
export function upgradeNodeState(model){
  if(model&&typeof model==='object'&&model.nodeStateVersion===undefined&&Array.isArray(model.nodes)){
    for(const node of model.nodes)if(node&&node.deleted===undefined&&isDeletedNode(model,node))node.deleted=true;
    model.nodeStateVersion=1;
  }
  return model;
}
export function migrateNodeState(model){return upgradeNodeState(JSON.parse(JSON.stringify(model)));}
