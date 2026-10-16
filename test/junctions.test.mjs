import test from 'node:test';
import assert from 'node:assert/strict';
import {clone,History,validate,isBranch,overviewEdges,routeConnections,lineBranchSplit,createLineBranch,connectNodes,removeConnections,removeNodes,removeCanvasNodes,normalizeBranchJunctions} from '../runtime/core.mjs';

const page=(id,x,y)=>({id,module:'flow',kind:'note',title:id,x,y,width:1280,height:800,description:''});
function fixture(){return {version:1,title:'分叉删除',modules:[{id:'flow',title:'流程'}],nodes:[page('a',0,0),page('b',1000,0),page('c',1000,700),page('d',1800,700)],edges:[{id:'ab',from:'a',to:'b',fromSide:'right',toSide:'left',label:'技能',selector:'#skills',when:{role:'admin'},setContext:{opened:true},description:'原操作说明'}],annotations:[{id:'old-note',edge:'ab',text:'原连线标记'}]};}
function fork(model,edgeId='ab',target='c',edgeIds=[edgeId]){
  const line=routeConnections(model.nodes,overviewEdges(model),{scope:'junction-test'}).find(line=>line.edge.id===edgeId),split=lineBranchSplit(line.route.points);assert(split);
  return createLineBranch(model,edgeId,target,split.point,'left',{points:line.route.points,from:line.from.id,fromSide:line.fromSide,toSide:line.toSide,edgeIds});
}
const productFields=edge=>Object.fromEntries(Object.entries(edge).filter(([key])=>!['canvasFrom','waypoints','fromSide','toSide'].includes(key)));

test('删除新增支线自动收拢连接点，主跳转、按钮条件与标记保留，一次撤销恢复',()=>{
  const m=fixture(),original=clone(m),added=fork(m),history=new History(),beforeDelete=clone(m);history.push(m);
  removeConnections(m,[added.edgeId]);assert.equal(m.nodes.some(isBranch),false);assert.equal(m.edges.length,1);assert.equal(m.edges[0].canvasFrom,undefined);assert.deepEqual(productFields(m.edges[0]),productFields(original.edges[0]));assert.deepEqual(m.nodes,original.nodes);assert.deepEqual(m.annotations,original.annotations);assert.deepEqual(validate(m),[]);assert.deepEqual(history.undo(m),beforeDelete);
});
test('直接删除分叉点只接回前后连线，原主链与其他分支均保留',()=>{
  for(const remove of [removeNodes,(model,ids)=>removeCanvasNodes(model,'flow',ids)]){
    const m=fixture(),original=clone(m),added=fork(m);remove(m,[added.groupId]);
    assert.equal(m.nodes.some(isBranch),false);assert.equal(m.edges.length,2);assert.deepEqual(productFields(m.edges.find(e=>e.id==='ab')),productFields(original.edges[0]));
    const branch=m.edges.find(e=>e.id===added.edgeId);assert.equal(branch.from,'a');assert.equal(branch.to,'c');assert.equal(branch.diagram,true);assert.deepEqual(m.nodes,original.nodes);assert.deepEqual(validate(m),[]);
  }
});
test('多个分支只删指定支线，剩两个方向保留连接点，剩一个方向才收拢',()=>{
  const m=fixture(),first=fork(m),third=connectNodes(m,first.groupId,'d','right','left');removeConnections(m,[first.edgeId]);assert.equal(m.nodes.filter(isBranch).length,1);assert(m.edges.some(e=>e.id==='ab'));assert(m.edges.some(e=>e.id===third));
  removeConnections(m,[third]);assert.equal(m.nodes.some(isBranch),false);assert.deepEqual(m.edges.map(e=>e.id),['ab']);assert.deepEqual(validate(m),[]);
});
test('同一可见主线的多个真实按钮一并恢复，不丢失独立条件与跳转',()=>{
  const m=fixture();m.edges.push({...clone(m.edges[0]),id:'ab-member',selector:'#skills-member',when:{role:'member'}});const original=clone(m),added=fork(m,'ab','c',['ab','ab-member']);removeConnections(m,[added.edgeId]);
  assert.equal(m.nodes.some(isBranch),false);assert.equal(m.edges.length,2);for(const old of original.edges){const edge=m.edges.find(e=>e.id===old.id);assert.deepEqual(productFields(edge),productFields(old));assert.equal(edge.canvasFrom,undefined);}assert.deepEqual(validate(m),[]);
});
test('删除上游分叉后下游分叉仍可用，后续收拢不留下隐藏的 from 或 canvasFrom 引用',()=>{
  const m=fixture(),first=fork(m),second=fork(m,first.edgeId,'d');removeNodes(m,[first.groupId]);
  assert.equal(m.nodes.filter(isBranch).length,1);assert(m.nodes.some(n=>n.id===second.groupId));assert(m.edges.some(e=>e.id==='ab'));assert(!m.edges.some(e=>e.from===first.groupId||e.to===first.groupId||e.canvasFrom===first.groupId));assert.deepEqual(validate(m),[]);
  removeConnections(m,[second.edgeId]);assert.equal(m.nodes.some(isBranch),false);assert(m.edges.some(e=>e.id==='ab'));assert(m.edges.some(e=>e.id===first.edgeId&&e.from==='a'&&e.to==='c'));assert.deepEqual(validate(m),[]);
});
test('移除分叉时保留名称、说明、点位标记和主线标记',()=>{
  const m=fixture(),added=fork(m),branch=m.nodes.find(n=>n.id===added.groupId),trunk=m.edges.find(e=>e.to===branch.id);branch.title='条件分支';branch.description='原分叉说明';trunk.description='原主线说明';m.annotations.push({id:'point-note',node:branch.id,point:[.5,.5],text:'点位说明'},{id:'trunk-note',edge:trunk.id,text:'主线说明'});
  removeNodes(m,[branch.id]);assert.equal(m.nodes.some(isBranch),false);for(const id of ['old-note','point-note','trunk-note'])assert(m.annotations.some(a=>a.id===id&&m.edges.some(e=>e.id===a.edge)));assert(m.annotations.some(a=>a.text.includes('原分叉说明')&&a.text.includes('条件分支')&&a.text.includes('原主线说明')));assert.deepEqual(validate(m),[]);
});
test('旧数据已残留的无用分叉可以收拢，丢失主线时仍按实际按钮来源接回',()=>{
  for(const missingTrunk of [false,true]){
    const m=fixture(),original=clone(m),added=fork(m);
    m.edges=m.edges.filter(e=>e.id!==added.edgeId&&(!missingTrunk||e.to!==added.groupId));
    assert.deepEqual(normalizeBranchJunctions(m),[added.groupId]);assert.equal(m.edges.length,1);assert.deepEqual(productFields(m.edges[0]),productFields(original.edges[0]));assert.deepEqual(validate(m),[]);
  }
});
test('截图坏例：分叉与页面间距不足固定引线长度时，直接折入目标且不绕到页面下方',()=>{
  const branch={id:'joint',module:'flow',kind:'note',presentation:'branch',title:'',x:641.7616813851845,y:158.60095320623918,width:16,height:16,description:''},target=page('target',680.7516990415554,396.5379609316981);
  const [line]=routeConnections([branch,target],[{id:'bad-case',from:branch.id,to:target.id,fromSide:'bottom',toSide:'left'}],{scope:'screenshot-bad-case'});
  assert.equal(line.route.blocked,undefined);assert.equal(line.route.points.length,3);assert.deepEqual(line.route.points,[line.start,[line.start[0],line.end[1]],line.end]);assert.equal(Math.max(...line.route.points.map(p=>p[1])),line.end[1]);
});
