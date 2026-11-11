import test from 'node:test';
import assert from 'node:assert/strict';
import {flowchartSVG} from '../scripts/flowchart.mjs';
import {validateDocument,pruneDocument} from '../runtime/document.mjs';

test('HTML 内的 SVG 为唯一绘图源，保留文字、分支与固有尺寸',()=>{
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1510 150"><defs><marker id="arrow"/></defs><text>已有速览</text><path marker-end="url(#arrow)" d="M0 0H20"/></svg>';
  assert.deepEqual(flowchartSVG('<!doctype html><html><body>'+svg+'</body></html>'),{svg,width:1510,height:150});
  assert.throws(()=>flowchartSVG('<svg viewBox="0 0 0 100"></svg>'),/viewBox/);
  assert.throws(()=>flowchartSVG(svg+svg),/一个/);
  assert.throws(()=>flowchartSVG('<svg viewBox="0 0 10 10"><image href="https://example.com/a.png"/></svg>'),/自包含/);
});

test('文档图片映射校验节点和比例，删除节点后原 PNG 可回退',()=>{
  const m={nodes:[{id:'flow',kind:'html'}],edges:[],document:{version:1,blocks:[{id:'prd',type:'source',path:'需求.md',imageFrames:{'../artifact/assets/图.png':{node:'flow',frameScale:.8}}}]}};
  assert.deepEqual(validateDocument(m),[]);m.document.blocks[0].imageFrames['../artifact/assets/图.png'].frameScale=0;
  assert(validateDocument(m).some(v=>v.includes('外框比例')));m.document.blocks[0].imageFrames['../artifact/assets/图.png'].frameScale=.8;
  m.nodes=[];assert(validateDocument(m).some(v=>v.includes('图片画布引用')));pruneDocument(m);assert.deepEqual(m.document.blocks[0].imageFrames,{});assert.deepEqual(validateDocument(m),[]);
});
