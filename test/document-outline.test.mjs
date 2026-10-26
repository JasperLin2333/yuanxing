import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocumentOutline} from '../runtime/document.mjs';

function fixture(t){
  const keys=['document','window','requestAnimationFrame','cancelAnimationFrame','ResizeObserver'],before=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));
  const rootEvents=new Map(),windowEvents=new Map(),frames=new Map(),outlines=[];let serial=0;
  const root={scrollTop:0,clientHeight:600,scrollHeight:1800,getBoundingClientRect:()=>({top:50}),addEventListener:(name,fn)=>rootEvents.set(name,fn),removeEventListener:name=>rootEvents.delete(name),scrollTo(options){this.scrollTop=Math.max(0,Math.min(1200,options.top));rootEvents.get('scroll')?.();}};
  const nav={children:[],scrollTop:0,clientHeight:180,replaceChildren(){this.children=[];},append(child){this.children.push(child);},getBoundingClientRect:()=>({top:0,bottom:180})};
  globalThis.document={createElement:()=>({style:{},attrs:{},setAttribute(key,value){this.attrs[key]=value;},removeAttribute(key){delete this.attrs[key];},getBoundingClientRect(){const top=nav.children.indexOf(this)*32-nav.scrollTop;return {top,bottom:top+32};}})};
  globalThis.window={addEventListener:(name,fn)=>windowEvents.set(name,fn),removeEventListener:name=>windowEvents.delete(name)};
  globalThis.requestAnimationFrame=fn=>{frames.set(++serial,fn);return serial;};globalThis.cancelAnimationFrame=id=>frames.delete(id);globalThis.ResizeObserver=undefined;
  const headings=[],paper={querySelectorAll:()=>headings};
  const heading=(text,level,top,{title=false,logicalLevel}={})=>({textContent:text,tagName:'H'+level,dataset:logicalLevel?{docHeadingLevel:String(logicalLevel)}:{},classList:{contains:name=>title&&name==='doc-title'},getBoundingClientRect:()=>({top:50+top-root.scrollTop})});
  t.after(()=>{for(const outline of outlines)outline.dispose();for(const key of keys){if(before[key]===undefined)delete globalThis[key];else globalThis[key]=before[key];}});
  return {root,nav,headings,heading,rootEvents,windowEvents,frames,create(){const outline=createDocumentOutline({root,paper,nav,toolbar:{offsetHeight:48}});outlines.push(outline);outline.update();return outline;},flush(){const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn());}};
}

test('目录包含正文与引用章节的实际标题，层级和重名目标各自保留，修改后可刷新',t=>{
  const f=fixture(t);f.headings.push(f.heading('文档标题',1,0,{title:true}),f.heading('功能详情',2,100,{logicalLevel:1}),f.heading('确认规则',3,400),f.heading('确认规则',3,700),f.heading('   ',2,800));
  const outline=f.create();assert.deepEqual(f.nav.children.map(control=>control.textContent),['功能详情','确认规则','确认规则']);assert.deepEqual(f.nav.children.map(control=>control.style.paddingLeft),['12px','26px','26px']);
  assert.notEqual(f.nav.children[1].attrs['aria-controls'],f.nav.children[2].attrs['aria-controls']);
  f.headings[1].textContent='功能范围';f.headings.splice(2,1);outline.update();assert.deepEqual(f.nav.children.map(control=>control.textContent),['功能范围','确认规则']);
});

test('自建目录标题与引用 PRD 混排时，同级章节保持相同缩进',t=>{
  const f=fixture(t);f.headings.push(
    f.heading('1 需求目标',2,100),
    f.heading('2 功能模块清单',2,200),
    f.heading('3 需求详情',2,300,{logicalLevel:1}),
    f.heading('3.1 首次使用与套餐校验',3,400,{logicalLevel:2}),
    f.heading('3.1.1 首次介绍弹窗',4,500,{logicalLevel:3}),
    f.heading('3.1.2 套餐校验与用户协议',4,600),
    f.heading('3.1.3 激活状态与套餐失效',4,700)
  );
  f.create();assert.deepEqual(f.nav.children.map(control=>control.style.paddingLeft),['12px','12px','12px','26px','40px','40px','40px']);
});

test('点击目录仅滚动需求正文，并给固定工具栏留出空间；滚动时更新当前章节',t=>{
  const f=fixture(t);f.headings.push(f.heading('背景',1,120),f.heading('功能',1,600),f.heading('验收条件',2,1400));f.create();
  f.nav.children[1].onclick();assert.equal(f.root.scrollTop,532);f.flush();assert.equal(f.nav.children[1].attrs['aria-current'],'location');assert.equal(f.nav.children[0].attrs['aria-current'],undefined);
  f.root.scrollTop=100;f.rootEvents.get('scroll')();f.flush();assert.equal(f.nav.children[0].attrs['aria-current'],'location');
  f.root.scrollTop=1200;f.rootEvents.get('scroll')();f.flush();assert.equal(f.nav.children[2].attrs['aria-current'],'location');
});

test('长目录跟随当前章节，连续滚动合并刷新；退出后释放监听并取消待执行刷新',t=>{
  const f=fixture(t);for(let i=0;i<12;i++)f.headings.push(f.heading('章节'+i,1,100+i*120));const outline=f.create();
  f.root.scrollTop=1100;f.rootEvents.get('scroll')();f.rootEvents.get('scroll')();assert.equal(f.frames.size,1);f.flush();assert(f.nav.scrollTop>0);
  f.windowEvents.get('resize')();assert.equal(f.frames.size,1);outline.dispose();assert.equal(f.frames.size,0);assert.equal(f.rootEvents.size,0);assert.equal(f.windowEvents.size,0);
});

test('恢复阅读章节及段内位置，章节前插入内容或重编号后仍定位原内容',t=>{
  const f=fixture(t);f.headings.push(f.heading('3.4.1 回复规范',4,120),f.heading('3.4.2 请求处理规则',4,600));const outline=f.create();
  f.root.scrollTop=650;f.nav.scrollTop=24;const position=outline.capture();assert.equal(position.heading,'3.4.2 请求处理规则');assert.equal(position.offset,-50);
  f.headings[1]=f.heading('3.4.5 请求处理规则',4,900);outline.update();f.root.scrollTop=0;outline.restore(position);assert.equal(f.root.scrollTop,950);assert.equal(f.nav.scrollTop,24);assert.equal(f.nav.children[1].attrs['aria-current'],'location');
});

test('重名章节按原出现位置恢复；章节删除及损坏坐标安全回退',t=>{
  const f=fixture(t);f.headings.push(f.heading('规则',3,120),f.heading('规则',3,600));const outline=f.create();f.root.scrollTop=620;
  const position=outline.capture();assert.equal(position.occurrence,1);f.root.scrollTop=0;outline.restore(position);assert.equal(f.root.scrollTop,620);
  f.headings.length=0;outline.update();f.root.scrollTop=0;outline.restore(position);assert.equal(f.root.scrollTop,620);outline.restore({scrollTop:'invalid'});assert.equal(f.root.scrollTop,620);
});
