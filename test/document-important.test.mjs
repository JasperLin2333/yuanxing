import test from 'node:test';
import assert from 'node:assert/strict';
import {markdown,readDescription} from '../runtime/core.mjs';
import {documentImportantSelection,toggleDocumentImportant,patchDocumentSource} from '../runtime/document.mjs';

// 内存 DOM 只覆盖文字选区与节点操作，不启动浏览器。
function fixture(){
  const doc={createElement:tag=>new Element(tag),createRange:()=>({setStart(node,offset){this.startContainer=node;this.startOffset=offset;},setEnd(node,offset){this.endContainer=node;this.endOffset=offset;}})};
  class Node {
    constructor(type){this.nodeType=type;this.parentNode=null;this.ownerDocument=doc;}
    get nextSibling(){const siblings=this.parentNode?.childNodes||[],i=siblings.indexOf(this);return siblings[i+1]||null;}
    remove(){if(this.parentNode){const siblings=this.parentNode.childNodes;siblings.splice(siblings.indexOf(this),1);this.parentNode=null;}}
  }
  class Text extends Node {
    constructor(value){super(3);this.data=value;}
    get textContent(){return this.data;}
    splitText(index){const after=new Text(this.data.slice(index));this.data=this.data.slice(0,index);this.parentNode.insertBefore(after,this.nextSibling);return after;}
  }
  class Element extends Node {
    constructor(tag){super(1);this.tagName=tag.toUpperCase();this.childNodes=[];this.attrs={};}
    get children(){return this.childNodes.filter(node=>node.nodeType===1);}
    get firstChild(){return this.childNodes[0]||null;}
    get textContent(){return this.childNodes.map(node=>node.textContent).join('');}
    setAttribute(key,value){this.attrs[key]=value;}
    getAttribute(key){return this.attrs[key]??null;}
    hasAttribute(key){return Object.hasOwn(this.attrs,key);}
    insertBefore(node,reference){node.remove();const index=reference?this.childNodes.indexOf(reference):this.childNodes.length;assert(index>=0);this.childNodes.splice(index,0,node);node.parentNode=this;return node;}
    append(...nodes){for(const node of nodes)this.insertBefore(node,null);}
    contains(node){return node===this||this.childNodes.some(child=>child===node||child.contains?.(node));}
    querySelector(selector){if(selector!=='[data-yuanxing-important="true"]')return null;let match=null;const visit=node=>{for(const child of node.childNodes||[]){if(child.getAttribute?.('data-yuanxing-important')==='true')match||=child;visit(child);}};visit(this);return match;}
  }
  const text=value=>new Text(value),el=(tag,...children)=>{const item=doc.createElement(tag);item.append(...children);return item;};
  function select(editor,start,startOffset,end,endOffset){
    const all=[];const visit=node=>{if(node.nodeType===3)all.push(node);else node.childNodes.forEach(visit);};visit(editor);const first=all.indexOf(start),last=all.indexOf(end);assert(first>=0&&last>=first);
    return {startContainer:start,startOffset,endContainer:end,endOffset,collapsed:start===end&&startOffset===endOffset,intersectsNode:node=>all.indexOf(node)>=first&&all.indexOf(node)<=last};
  }
  return {el,text,select};
}

test('重点说明可作为安全的 Markdown 行内标记显示，其他 HTML 仍转义',()=>{
  const source='普通 <span style="color:#d92d20">**重点**及`规则`</span> <img src=x onerror=alert(1)>';
  const html=markdown(source,{}, {sourceLines:true});
  assert.match(html,/<span class="yx-important" data-yuanxing-important="true"><strong>重点<\/strong>及<code>规则<\/code><\/span>/);
  assert.match(html,/data-source-line="0"/);assert(!html.includes('<img src=x'));assert(html.includes('&lt;img'));
  assert(!markdown('<span style="color:red" onclick="alert(1)">不可信</span>').includes('<span style='));
});

test('选中正文局部可标红、局部取消，保留粗体及未选文字',()=>{
  const {el,text,select}=fixture(),front=text('前面'),body=text('业务规则'),back=text('后面'),editor=el('div',el('p',front,el('strong',body),back));
  let selection=select(editor,body,1,body,3);assert.equal(documentImportantSelection(editor,selection).marked,false);
  let next=toggleDocumentImportant(editor,selection);
  const opening='<span style="color:#d92d20">',closing='</span>';
  assert.equal(readDescription(editor),`前面**业${opening}务规${closing}则**后面`);
  selection=select(editor,next.startContainer,0,next.endContainer,1);assert.equal(documentImportantSelection(editor,selection).marked,true);
  next=toggleDocumentImportant(editor,selection);
  assert.equal(readDescription(editor),`前面**业务${opening}规${closing}则**后面`);
  assert.equal(editor.textContent,'前面业务规则后面');assert.equal(next.startContainer.textContent,'务');
});

test('跨加粗文字选中时，混合已有重点会统一标红，再次选中可取消',()=>{
  const {el,text,select}=fixture(),a=text('开始'),b=text('规则'),c=text('结束'),marker=el('span',b);marker.setAttribute('data-yuanxing-important','true');
  const editor=el('div',el('p',a,el('strong',marker),c));let range=select(editor,a,1,c,1);
  assert.equal(documentImportantSelection(editor,range).marked,false);let selected=toggleDocumentImportant(editor,range);
  assert.equal(editor.textContent,'开始规则结束');assert.equal((readDescription(editor).match(/<span style=/g)||[]).length,3);
  range=select(editor,selected.startContainer,0,selected.endContainer,1);assert.equal(documentImportantSelection(editor,range).marked,true);toggleDocumentImportant(editor,range);
  assert.equal(readDescription(editor),'开始**规则**结束');
});

test('行内代码标记可往返，源文档仅写回对应行',()=>{
  const {el,text,select}=fixture(),code=text('ABC'),editor=el('div',el('p',el('code',code)));
  toggleDocumentImportant(editor,select(editor,code,1,code,2));
  const saved=readDescription(editor);assert.equal(saved,'`A`<span style="color:#d92d20">`B`</span>`C`');
  assert.match(markdown(saved),/<code>A<\/code><span class="yx-important"[^>]*><code>B<\/code><\/span><code>C<\/code>/);
  const source='## 功能\n- `ABC`\n- 其他规则\n';const patched=patchDocumentSource(source,{section:'功能'},{line:1,before:'`ABC`',value:saved});
  assert.equal(patched.text,'## 功能\n- '+saved+'\n- 其他规则\n');
});
