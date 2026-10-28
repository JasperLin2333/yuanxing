import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {randomBytes} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {compactExportBoot,restoreExportBoot,packExportArtifact,decodeExportArtifact} from '../runtime/export-data.mjs';
import {createCompatibilityBundle} from '../runtime/compatibility.mjs';
import {standalone} from '../runtime/server.mjs';

function fixture(){
  const image='data:image/png;base64,'+randomBytes(64000).toString('base64');
  const style='<style>/* 公共样式 😀 */'+'.row{display:flex;color:#135;color:var(--tone)}\n'.repeat(200)+'</style>';
  const content='<section>'+Array.from({length:80},(_,i)=>`<div class="row" data-row="${i}">客户 ${i}：已确认 &amp; 保留原文</div>`).join('')+'</section>';
  const model={version:1,title:'大文件导出',modules:[{id:'main',title:'客户',entry:'one'}],nodes:['one','two'].map(id=>({id,module:'main',kind:'html',path:`pages/${id}.html`,title:id,width:1280,height:800,x:0,y:0})),edges:[{id:'next',from:'one',to:'two',selector:'#next',label:'继续'}],annotations:[]};
  const page=id=>`<!doctype html><html><head><!-- include:style --></head><body><main><img src="${image}">${content}<button id="next" onclick="this.textContent='已选择'">继续 ${id}</button><script>const literal='</script-safe> 😀 &quot;';</script></main></body></html>`;
  return {model,resources:{one:page('一'),two:page('二')},fragments:{style},images:{},documentSources:{}};
}

test('共享引用无损还原图片、公共片段、原始事件及 Unicode，不修改源或静态研发数据',()=>{
  const bundle=fixture(),boot={readonly:true,view:'review',bundle},artifact=createCompatibilityBundle(bundle),before=JSON.stringify({boot,artifact});
  const packed=compactExportBoot(boot,artifact);
  assert(packed.sharedStrings.entries.length>=3);assert(JSON.stringify(packed).length<JSON.stringify(boot).length*.15);
  assert.deepEqual(restoreExportBoot(packed,artifact),boot);assert.equal(JSON.stringify({boot,artifact}),before);
  assert.deepEqual(restoreExportBoot(JSON.parse(JSON.stringify(packed)),JSON.parse(JSON.stringify(artifact))),boot);
});

test('无匹配的大页面仍保存原文，小页面和旧导出保持原格式',()=>{
  const boot={readonly:true,bundle:{resources:{small:'<main>原型</main>',large:randomBytes(12000).toString('hex')},fragments:{},images:{}}};
  assert.equal(compactExportBoot(boot,{files:{'states/other.html':'<main>其他页面</main>'}}),boot);
  assert.equal(restoreExportBoot(boot,null),boot);
});

test('共享片段只能引用完整范围，缺失的来源、版本及越界引用明确报错',()=>{
  const bundle=fixture(),artifact=createCompatibilityBundle(bundle),packed=compactExportBoot({bundle},artifact);
  assert.throws(()=>restoreExportBoot(packed,null),/缺失/);
  const invalid=structuredClone(packed);invalid.sharedStrings.entries[0][2]=[[0,-1,10]];
  assert.throws(()=>restoreExportBoot(invalid,artifact),/引用无效/);
  invalid.sharedStrings.entries[0][2]=[[99999,0,10]];assert.throws(()=>restoreExportBoot(invalid,artifact),/引用无效/);
  invalid.sharedStrings.version=2;assert.throws(()=>restoreExportBoot(invalid,artifact),/版本/);
});

test('大数据默认压缩且原图、事件、正文及 Unicode 可静态无损还原，小数据与无收益数据不膨胀',()=>{
  const expected=createCompatibilityBundle(fixture()),before=JSON.stringify(expected),packed=packExportArtifact(expected);
  assert.equal(packed.encoding,'gzip-base64');assert(Buffer.byteLength(JSON.stringify(packed))<Buffer.byteLength(before));
  assert.deepEqual(decodeExportArtifact(JSON.parse(JSON.stringify(packed)),gunzipSync),expected);assert.equal(JSON.stringify(expected),before);
  const small={files:{'one.html':'<main>原文 </script> 😀 &quot;</main>'}};assert.equal(packExportArtifact(small),small);assert.equal(decodeExportArtifact(small),small);
  const random={data:randomBytes(72000).toString('base64')};assert.equal(packExportArtifact(random),random);
  assert.throws(()=>decodeExportArtifact({encoding:'unknown',data:''},gunzipSync),/编码/);
  assert.throws(()=>decodeExportArtifact(packed,null),/解压器/);
  assert.throws(()=>decodeExportArtifact({encoding:'gzip-base64',data:'aW52YWxpZA=='},gunzipSync));
});

test('三个视图真实执行内嵌解压器和启动还原，无网络及原生解压 API 仍保留完整页面',async()=>{
  const bundle=fixture(),expected=createCompatibilityBundle(bundle);
  for(const view of ['review','prototype','document']){
    const html=await standalone(bundle,{view});
    const artifactText=html.match(/<script id="yuanxing-artifact" type="application\/json">([\s\S]*?)<\/script>/)[1];
    const artifact=JSON.parse(artifactText);assert.equal(artifact.encoding,'gzip-base64');assert.deepEqual(decodeExportArtifact(artifact,gunzipSync),expected);
    const bootScript=html.match(/<script>(globalThis\.YUANXING_BOOT=[\s\S]*?);<\/script>/)[1];
    const moduleScript=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
    const end="JSON.parse(document.getElementById('yuanxing-artifact').textContent)));";
    assert(moduleScript.includes(end));const prelude=moduleScript.slice(0,moduleScript.indexOf(end)+end.length);
    const context=vm.createContext({atob,TextDecoder,document:{getElementById:id=>{assert.equal(id,'yuanxing-artifact');return {textContent:artifactText};}}});
    const vendorScript=html.match(/<script>([\s\S]*?)<\/script>/)[1];vm.runInContext(vendorScript,context);
    assert.equal(typeof context.fflate.gunzipSync,'function');assert.equal(context.DecompressionStream,undefined);
    vm.runInContext(bootScript,context);assert(context.YUANXING_BOOT.sharedStrings);
    vm.runInContext(prelude,context);assert.deepEqual(JSON.parse(JSON.stringify(context.YUANXING_BOOT)),{readonly:true,view,bundle});
    for(const [,attrs,source] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){
      if(/application\/json|text\/plain/.test(attrs))continue;
      const result=spawnSync(process.execPath,['--check',...(attrs.includes('module')?['--input-type=module']:[])],{input:source,encoding:'utf8'});
      assert.equal(result.status,0,result.stderr);
    }
  }
});


test('离线分享可以重新导出三种视图并完整保留内嵌数据',async()=>{
  const {offlineExportHTML}=await import('../runtime/core.mjs');
  const boot={readonly:true,view:'review',flow:'old',sharedStrings:['保留中文','<&'],bundle:{title:'示例'}};
  const source='<!doctype html><html><head><script id="yuanxing-artifact" type="application/json">{"files":{"a":"正文"}}</script></head><body><script>globalThis.YUANXING_BOOT='+JSON.stringify(boot).replace(/</g,'\\u003c')+';</script><script type="module">export const hello=1;</script></body></html>';
  for(const view of ['review','document','prototype']){const result=offlineExportHTML(source,view),data=JSON.parse(result.match(/globalThis\.YUANXING_BOOT=([\s\S]*?);<\/script>/)[1]);assert.equal(data.view,view);assert.equal(data.flow,null);assert.deepEqual(data.sharedStrings,boot.sharedStrings);assert.match(result,/<script id="yuanxing-artifact" type="application\/json">\{"files":\{"a":"正文"\}\}<\/script>/);assert.match(result,/export const hello=1/);assert.equal(JSON.parse(offlineExportHTML(result,'review').match(/globalThis\.YUANXING_BOOT=([\s\S]*?);<\/script>/)[1]).view,'review');}
  assert.throws(()=>offlineExportHTML(source,'unknown'),/视图/);assert.throws(()=>offlineExportHTML('<html></html>','review'),/缺失/);
});


test('真实生成的离线文件再次导出时保留压缩资源与研发读取数据',async()=>{
  const {offlineExportHTML}=await import('../runtime/core.mjs');const source=await standalone(fixture(),{view:'review'});
  const artifact=source.match(/<script id="yuanxing-artifact" type="application\/json">([\s\S]*?)<\/script>/)[1];
  for(const view of ['review','document','prototype']){const output=offlineExportHTML(source,view),boot=JSON.parse(output.match(/globalThis\.YUANXING_BOOT=([\s\S]*?);<\/script>/)[1]);assert.equal(boot.view,view);assert.equal(output.match(/<script id="yuanxing-artifact" type="application\/json">([\s\S]*?)<\/script>/)[1],artifact);}
});
