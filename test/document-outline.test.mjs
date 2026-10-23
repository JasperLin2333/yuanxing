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
  const outline=f.create();assert.deepEqual(f.nav.children.map(control=>control.textContent),['功能详情','确认规则','确认规则']);assert.deepEqual(f.nav.children.map(control=>control.style.paddingLeft),['12px','40px','40px']);
  assert.notEqual(f.nav.children[1].attrs['aria-controls'],f.nav.children[2].attrs['aria-controls']);
  f.headings[1].textContent='功能范围';f.headings.splice(2,1);outline.update();assert.deepEqual(f.nav.children.map(control=>control.textContent),['功能范围','确认规则']);
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
