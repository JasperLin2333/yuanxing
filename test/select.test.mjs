import test from 'node:test';
import assert from 'node:assert/strict';
import {createSelect,closeSelects} from '../runtime/select.mjs';

function domFixture(){
  const saved=Object.fromEntries(['document','window','innerWidth','innerHeight'].map(key=>[key,globalThis[key]]));
  const listeners=()=>{const events=new Map();return {addEventListener(type,fn){if(!events.has(type))events.set(type,new Set());events.get(type).add(fn);},removeEventListener(type,fn){events.get(type)?.delete(fn);},emit(type,event){for(const fn of [...events.get(type)||[]])fn(event);}};};
  const doc=listeners(),win=listeners();
  class Element{
    constructor(){this.children=[];this.attrs={};this.dataset={};this.style={};this.events=listeners();this.offsetWidth=160;this.offsetHeight=100;this.parentNode=null;}
    append(...items){for(const item of items){item.parentNode=this;this.children.push(item);}}
    replaceChildren(...items){for(const child of this.children)child.parentNode=null;this.children=[];this.append(...items);}
    remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}}
    get isConnected(){return this===doc.body||!!this.parentNode?.isConnected;}
    get firstElementChild(){return this.children[0];}get lastElementChild(){return this.children.at(-1);}
    contains(item){return item===this||this.children.some(child=>child.contains(item));}
    setAttribute(key,value){this.attrs[key]=String(value);}getAttribute(key){return this.attrs[key]??null;}
    addEventListener(...args){this.events.addEventListener(...args);}
    emit(type,props={}){const event={target:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...props};this.events.emit(type,event);return event;}
    focus(){doc.activeElement=this;doc.emit('focusin',{target:this});}
    getBoundingClientRect(){return {left:30,top:220,bottom:252,width:120};}
  }
  doc.createElement=()=>new Element();doc.body=new Element();doc.activeElement=doc.body;
  Object.assign(globalThis,{document:doc,window:win,innerWidth:500,innerHeight:300});
  return {doc,restore(){closeSelects();for(const [key,value] of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}};
}

test('统一选择器支持键盘切换、选中状态、失焦关闭和动态更新',()=>{
  const f=domFixture();try{
    const changes=[],select=createSelect({label:'节点类型',options:[{value:'pc',label:'PC'},{value:'mobile',label:'移动端'}],value:'pc',onChange:value=>changes.push(value)});f.doc.body.append(select.element);
    assert.equal(select.trigger.getAttribute('aria-expanded'),'false');assert.equal(select.trigger.children[0].textContent,'PC');assert.equal(select.trigger.getAttribute('aria-label'),'节点类型：PC');
    assert(select.trigger.emit('keydown',{key:'ArrowDown'}).defaultPrevented);
    let menu=f.doc.body.children.at(-1);assert.equal(menu.getAttribute('role'),'listbox');assert.equal(select.trigger.getAttribute('aria-expanded'),'true');assert.equal(f.doc.activeElement,menu.children[0]);assert.equal(menu.children[0].getAttribute('aria-selected'),'true');
    assert(menu.emit('keydown',{key:'ArrowDown'}).defaultPrevented);assert.equal(f.doc.activeElement,menu.children[1]);menu.children[1].emit('click');
    assert.deepEqual(changes,['mobile']);assert.equal(select.trigger.children[0].textContent,'移动端');assert.equal(select.trigger.getAttribute('aria-label'),'节点类型：移动端');assert.equal(select.trigger.getAttribute('aria-expanded'),'false');assert.equal(f.doc.activeElement,select.trigger);
    select.trigger.emit('click');menu=f.doc.body.children.at(-1);assert.equal(menu.children[1].getAttribute('aria-selected'),'true');const escape=menu.emit('keydown',{key:'Escape'});assert(escape.stopped);assert.equal(f.doc.activeElement,select.trigger);assert.equal(select.trigger.getAttribute('aria-expanded'),'false');
    select.setOptions([{value:'100',label:'100%'},{value:'200',label:'200%'}]);select.setValue('79','79%');assert.equal(select.trigger.children[0].textContent,'79%');
    select.trigger.emit('click');f.doc.emit('pointerdown',{target:f.doc.body});assert.equal(select.trigger.getAttribute('aria-expanded'),'false');
    select.setDisabled(true);select.trigger.emit('click');assert.equal(select.trigger.getAttribute('aria-expanded'),'false');assert.equal(select.trigger.disabled,true);
  }finally{f.restore();}
});
