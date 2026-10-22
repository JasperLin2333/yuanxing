import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createCompatibilityBundle,compatibleSelectorTargets,compatibilityDataTag} from '../runtime/compatibility.mjs';

function fixture(){return {model:{version:1,title:'订单确认',contextDefaults:{role:'member'},modules:[{id:'main',title:'确认订单',entry:'one'},{id:'second',title:'操作结果'}],nodes:[{id:'one',module:'main',title:'确认页',kind:'html',path:'pages/one.html',description:'确认后进入结果页。',width:1280,height:800,x:0,y:0},{id:'two',module:'second',title:'结果页',kind:'html',path:'pages/two.html',width:1280,height:800,x:500,y:0}],edges:[{id:'confirm',from:'one',to:'two',selector:'[data-yx-id="confirm"]',label:'确认',description:'保存选择后继续。'}],annotations:[{id:'rule',node:'one',selector:'#choice',text:'选项是本次操作的必要输入。'}]},resources:{one:'<main><input id="choice"><button data-yx-id="confirm" data-ec-component="Button">确认</button></main>',two:'<main>完成</main>'},fragments:{},images:{}};}
test('研发读取入口中的基本字段、跨模块流程、控件和说明保持对应，源不变',()=>{
  const source=fixture(),before=JSON.stringify(source),payload=createCompatibilityBundle(source);assert.equal(JSON.stringify(source),before);assert.equal(payload.manifest.requirements.length,1);const requirement=payload.manifest.requirements[0];assert.equal(requirement.states.filter(s=>s.initial).length,1);assert.equal(requirement.transitions[0].to,'two');const html=payload.files[requirement.states[0].html];assert.match(html,/data-transition-id="T1"/);assert.match(html,/data-ec-component="Button"/);assert(requirement.logic.some(l=>l.text.includes('必要输入')));assert(requirement.logic.some(l=>l.text.includes('保存选择')));
});
test('条件分支保留所有条件和目标，基础格式不伪造唯一跳转',()=>{
  const source=fixture();source.model.edges[0].when={role:'admin'};source.model.edges.push({id:'member',from:'one',to:'two',selector:'[data-yx-id="confirm"]',when:{role:'member'},setContext:{approved:false},label:'查看结果'});const payload=createCompatibilityBundle(source),requirement=payload.manifest.requirements[0],html=payload.files[requirement.states[0].html];assert.equal(requirement.transitions.length,2);assert(!html.includes('data-transition-id='));assert.match(html,/data-yuanxing-transition-ids="T1 T2"/);assert.equal(payload.yuanxing.bindings.length,2);assert.deepEqual(payload.yuanxing.bindings[1].setContext,{approved:false});assert(requirement.logic.some(l=>l.text.includes('role="admin"')&&l.text.includes('role="member"')));assert.equal(payload.yuanxing.limitations[0].type,'conditional-transition');
});
test('选择器解析保留层级与属性值，跳过脚本、注释中的伪 HTML',()=>{
  const html='<SCRIPT>const fake="<button id=\"ghost\">";</SCRIPT><!-- <button id="ghost"> --><MAIN class="form"><div><BUTTON id="save" data-label="a > b" class="primary">保存</BUTTON><button>取消</button></div></MAIN>';
  assert.equal(compatibleSelectorTargets(html,'#ghost').elements.length,0);assert.equal(compatibleSelectorTargets(html,'main.form > div > button.primary[data-label="a > b"]:first-child').elements.length,1);assert.equal(compatibleSelectorTargets(html,'main button:nth-of-type(2)').elements.length,1);assert.equal(compatibleSelectorTargets(html,'button:has(span)').supported,false);
});
test('一个控件选择器可以命中多处真实元素，所有副本都获得相同转移标记',()=>{
  const source=fixture();source.resources.one='<button data-yx-id="confirm">顶部确认</button><button data-yx-id="confirm">底部确认</button>';const payload=createCompatibilityBundle(source),html=payload.files[payload.manifest.requirements[0].states[0].html];assert.equal([...html.matchAll(/data-transition-id="T1"/g)].length,2);
});
test('不支持或失效的选择器记录具体差异，并完整保留原生连线',()=>{
  const source=fixture();source.model.edges[0].selector='button:has(span)';const payload=createCompatibilityBundle(source);assert.equal(payload.yuanxing.limitations[0].type,'selector-adaptation');assert.equal(payload.yuanxing.model.edges[0].selector,'button:has(span)');assert.equal(payload.manifest.requirements[0].transitions[0].to,'two');
  source.model.edges[0].selector='#missing';assert.equal(createCompatibilityBundle(source).yuanxing.limitations[0].type,'missing-control');
});
test('截图热点转换为比例按钮并关联实际目标，图像内嵌在页面中',()=>{
  const source=fixture();source.model.nodes[0].kind='image';source.model.nodes[0].path='assets/old.png';delete source.model.edges[0].selector;source.model.edges[0].rect=[.1,.2,.3,.1];source.resources.one='data:image/png;base64,aGVsbG8=';const payload=createCompatibilityBundle(source),html=payload.files[payload.manifest.requirements[0].states[0].html];assert.match(html,/left:10%;top:20%;width:30%;height:10%/);assert.match(html,/data-transition-id="T1"/);assert(html.includes(source.resources.one));
});
test('独立页面分别拥有入口；纯画布关系不成为可执行转移',()=>{
  const source=fixture();source.model.edges[0].diagram=true;const payload=createCompatibilityBundle(source);assert.equal(payload.manifest.requirements.length,2);assert(payload.manifest.requirements.every(r=>r.states.filter(s=>s.initial).length===1&&r.transitions.length===0));
});
test('内联事件转为局部监听，声明式组件有本地行为，原脚本字符串保持不变',()=>{
  const source=fixture();source.resources.one='<main><button id="open" onclick="this.textContent=\'已打开\'" data-yx-action="show" data-yx-target="#panel">打开</button><div id="panel" hidden>内容</div><script>const literal=\'<button onclick="keep()">\';</script></main>';source.model.edges=[];const payload=createCompatibilityBundle(source),html=payload.files[payload.manifest.requirements[0].states[0].html];assert(!html.match(/<button id="open"[^>]*\sonclick=/));assert(html.includes('const literal=\'<button onclick="keep()">\''));assert(html.includes("addEventListener(\"click\""));assert(html.includes('compatLocalActions'));
  for(const [,script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)){const result=spawnSync(process.execPath,['--check'],{input:script,encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
});
test('JSON 数据块无须执行脚本即可提取，正文的结束标签不会逃出数据块',()=>{
  const source=fixture();source.model.document={version:1,blocks:[{id:'business',type:'text',text:'原文 </script><script>keepAsText()</script>'}]};const tag=compatibilityDataTag(source);assert.equal([...tag.matchAll(/<\/script>/g)].length,1);const payload=JSON.parse(tag.replace(/^<script[^>]*>/,'').replace(/<\/script>$/,''));assert.equal(payload.yuanxing.document.blocks[0].text,source.model.document.blocks[0].text);assert.equal(payload.manifest.requirements[0].states[0].id,'one');
});
test('自由正文进入基础逻辑字段，对照表格内的需求说明关联到同一行的页面',()=>{
  const source=fixture();source.model.document={version:1,blocks:[{id:'goal',type:'text',text:'本次目标：完成订单确认。'},{id:'table',type:'table',rows:[{id:'row',cells:[{id:'left',blocks:[{id:'page',type:'prototype',node:'one'}]},{id:'right',blocks:[{id:'detail',type:'text',text:'每次只能确认一份订单，确认期间保留当前选择。'}]}]}]}]};const payload=createCompatibilityBundle(source),requirement=payload.manifest.requirements[0],html=payload.files[requirement.states[0].html];assert(requirement.logic.some(logic=>logic.text.includes('本次目标')));const detail=requirement.logic.find(logic=>logic.text.includes('每次只能确认'));assert(detail);assert(html.includes(`data-logic-id="${detail.id}"`));assert.equal(source.model.nodes[0].description,'确认后进入结果页。');
});
