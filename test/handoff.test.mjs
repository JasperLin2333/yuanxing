import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import vm from 'node:vm';
import {collectHandoff,handoffAncestors,handoffDocument,handoffPrompt,createDOMPicker} from '../runtime/handoff.mjs';
const escape=value=>String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
class Element{
 constructor(tag,doc,attrs={},text=''){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.attrs={...attrs};this.children=[];this._text=text;this.nodeType=1;this.style={};this.value=attrs.value||'';this.checked=false;this.selected=false;}
 get attributes(){return Object.entries(this.attrs).map(([name,value])=>({name,value}));}get id(){return this.attrs.id||'';}get classList(){return (this.attrs.class||'').split(/\s+/).filter(Boolean);}
 get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}set textContent(v){this._text=v;this.children=[];}
 get innerHTML(){return escape(this._text)+this.children.map(n=>n.outerHTML).join('');}get outerHTML(){return '<'+this.tagName.toLowerCase()+this.attributes.map(a=>' '+a.name+'="'+escape(a.value)+'"').join('')+'>'+this.innerHTML+'</'+this.tagName.toLowerCase()+'>';}
 getAttribute(k){return this.attrs[k]??null;}hasAttribute(k){return k in this.attrs;}setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}
 append(...items){for(const item of items){item.parentElement=this;this.children.push(item);}}remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);this.parentElement=null;}
 matches(selector){return selector.split(',').some(part=>{part=part.trim().replace('\\:',':');return part.startsWith('[')?this.hasAttribute(part.slice(1,-1)):part.toUpperCase()===this.tagName;});}
 querySelectorAll(selector){return this.children.flatMap(n=>[...(selector==='*'||n.matches(selector)?[n]:[]),...n.querySelectorAll(selector)]);}closest(selector){for(let n=this;n;n=n.parentElement)if(n.matches(selector))return n;return null;}contains(other){return this===other||this.children.some(n=>n.contains(other));}
 cloneNode(deep){const copy=new Element(this.tagName,this.ownerDocument,this.attrs,this._text);copy.value=this.value;copy.checked=this.checked;copy.selected=this.selected;if(deep)for(const n of this.children)copy.append(n.cloneNode(true));return copy;}
 getBoundingClientRect(){return {left:10,top:20,width:200,height:80};}
}
function fixture(){
 const listeners={},events={};const doc={defaultView:{CSS:{escape:v=>v},addEventListener:(name,fn)=>events[name]=fn,removeEventListener:name=>delete events[name]},createElement:tag=>new Element(tag,doc),addEventListener:(name,fn)=>listeners[name]=fn,removeEventListener:name=>delete listeners[name],querySelectorAll:selector=>doc.documentElement.querySelectorAll(selector),getElementById:id=>[doc.documentElement,...doc.documentElement.querySelectorAll('*')].find(n=>n.id===id)};
 const html=new Element('html',doc),head=new Element('head',doc),body=new Element('body',doc,{class:'ec-page'});doc.documentElement=html;doc.body=body;html.append(head,body);head.append(new Element('style',doc,{},'.dialog{color:green}'));
 const main=new Element('main',doc,{id:'workspace'}),selected=new Element('section',doc,{class:'dialog','data-ec-component':'Modal',onclick:'bad()'}),button=new Element('button',doc,{id:'submit'},'确认'),sibling=new Element('aside',doc,{},'无关区域');body.append(main);main.append(selected,sibling);selected.append(button,new Element('script',doc,{},'bad()'));
 return {doc,selected,button,main,sibling,listeners,events};
}
test('局部提取包含祖先布局、组件、样式和挂载位置，排除兄弟区域且不改源 DOM',()=>{
 const {doc,selected}=fixture(),before=doc.documentElement.outerHTML,snippet=collectHandoff(selected);
 assert.deepEqual(snippet.components,['Modal']);assert(snippet.selector.includes('main#workspace'));assert(snippet.contextHTML.includes('id="workspace"'));assert(!snippet.contextHTML.includes('无关区域'));assert(!snippet.html.includes('onclick'));assert(!snippet.html.includes('<script'));assert(snippet.styles.includes('.dialog'));
 assert.equal(doc.documentElement.outerHTML,before);assert.deepEqual(handoffAncestors(selected).map(n=>n.tagName),['BODY','MAIN','SECTION']);
});
test('提取保留选区表单值与 SVG 符号依赖，整 body 导出不嵌套 body',()=>{
 const {doc,selected}=fixture(),input=new Element('input',doc,{value:'旧值'});input.value='新值';selected.append(input);
 const symbol=new Element('symbol',doc,{id:'icon'}),svg=new Element('svg',doc),use=new Element('use',doc,{href:'#icon'});svg.append(use);selected.append(svg);doc.body.append(symbol);
 const snippet=collectHandoff(selected),html=handoffDocument(snippet,{title:'片段'});assert(html.includes('value="新值"'));assert(snippet.svgDefs.includes('id="icon"'));assert(!snippet.dependencies.includes('#icon'));
 const body=handoffDocument(collectHandoff(doc.body));assert.equal((body.match(/<body/g)||[]).length,1);
});
test('交付提示包含源文件和业务上下文，代码中的反引号不会打断代码块',()=>{
 const {selected}=fixture(),snippet=collectHandoff(selected);snippet.html+='```';const text=handoffPrompt(snippet,{project:'销售台',module:'客户',title:'分配客户',id:'assign',path:'artifact/states/assign.html',sources:['src/customer.html'],description:'只能分配自己名下客户',annotations:[{text:'需确认负责人'}]});
 for(const value of ['src/customer.html','只能分配自己名下客户','需确认负责人','main#workspace','Modal','````html'])assert(text.includes(value));
});
test('拾取阻止产品操作，可扩大到父级，退出后移除监听和高亮',()=>{
 const {doc,button,main,events,listeners}=fixture(),selected=[];let exited=0,prevented=0,stopped=0;const before=doc.documentElement.outerHTML,picker=createDOMPicker(doc,{onSelect:n=>selected.push(n),onExit:()=>exited++});
 events.click({target:button,preventDefault(){prevented++;},stopImmediatePropagation(){stopped++;}});assert.equal(selected[0],button);assert.equal(prevented,1);assert.equal(stopped,1);picker.select(main);assert.equal(selected[1],main);
 events.keydown({key:'Escape',preventDefault(){},stopImmediatePropagation(){}});assert.equal(exited,1);picker.destroy();assert.deepEqual(Object.keys(events),[]);assert.deepEqual(Object.keys(listeners),[]);assert.equal(doc.documentElement.outerHTML,before);
});
test('开发交付模式默认关闭，开关保留原 iframe，退出恢复原页面而非重建',async()=>{
 const app=await fs.readFile(new URL('../runtime/app.mjs',import.meta.url),'utf8'),elements=new Map(),original={dataset:{yxReady:'true'},isConnected:true,hidden:false,contentDocument:null,contentWindow:{postMessage(){}}},inspection={remove(){this.removed=true;}};
 const get=id=>{if(!elements.has(id))elements.set(id,{open:true,hidden:false,setAttribute(){}});return elements.get(id);};
 const state={devMode:false,current:'one',frames:{one:original},devPicker:null,devElement:null,devOriginal:null,devSnapshot:null,mode:null,node:()=>({id:'one',kind:'html'}),$:get,document:{body:{classList:{toggle(){}}},querySelector:get},closeAnnotationEditor(){},renderOverlays(){},renderHandoffTools(){},mountHandoffPreview(){state.frames.one=inspection;},viewer(){throw Error('不应重建原页面');},renderAll(){throw Error('不应重建画布');},handoffClean(){}};
 const context=vm.createContext(state);vm.runInContext(app.slice(app.indexOf('function toggleDeveloperMode('),app.indexOf('function mountHandoffPreview(')),context);assert.equal(context.devMode,false);context.toggleDeveloperMode();assert.equal(context.devMode,true);assert.equal(original.hidden,true);assert.equal(context.devOriginal.frame,original);context.toggleDeveloperMode();assert.equal(context.devMode,false);assert.equal(context.frames.one,original);assert.equal(original.hidden,false);assert(inspection.removed);
});
test('退出拾取不会保留遮罩，普通产品点击与提取状态隔离',async()=>{
 const {doc,button,events}=fixture(),before=doc.documentElement.outerHTML,picker=createDOMPicker(doc,{});let blocked=0;events.pointerdown({target:button,preventDefault(){blocked++;},stopImmediatePropagation(){}});assert.equal(blocked,1);picker.destroy();assert(!events.pointerdown);assert.equal(doc.documentElement.outerHTML,before);
});
