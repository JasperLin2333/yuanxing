import test from 'node:test';
import assert from 'node:assert/strict';
import {markdown,readDescription} from '../runtime/core.mjs';
import {documentImportantSelection,toggleDocumentImportant,patchDocumentSource,stripImportantMarkdown,applySourceImportant,collectSourceImportant,validateDocument,createDocumentView,documentSourceKey} from '../runtime/document.mjs';

// 内存 DOM 只覆盖文字选区与节点操作，不启动浏览器。
function fixture(){
  const decode=text=>text.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
  const parseHtml=(html,root)=>{
    root.childNodes=[];
    const stack=[root],voids=new Set(['BR','IMG','HR']);
    const tokens=/(<\/?[a-z0-9]+(?:\s+[^>]*)?>)/gi;
    let last=0,match;
    const pushText=raw=>{if(raw)stack.at(-1).append(new Text(decode(raw)));};
    while((match=tokens.exec(html))){
      pushText(html.slice(last,match.index));
      const tag=match[1];
      if(tag.startsWith('</')){if(stack.length>1)stack.pop();}
      else{
        const name=tag.match(/^<([a-z0-9]+)/i)[1].toUpperCase();
        const el=new Element(name);
        for(const attr of tag.slice(name.length+1,-1).matchAll(/([a-z0-9:-]+)(?:="([^"]*)")?/gi))el.setAttribute(attr[1],decode(attr[2]??''));
        stack.at(-1).append(el);
        if(!voids.has(name)&&!tag.endsWith('/>'))stack.push(el);
      }
      last=match.index+tag.length;
    }
    pushText(html.slice(last));
  };
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
    constructor(tag){super(1);this.tagName=tag.toUpperCase();this.childNodes=[];this.attrs={};this.dataset={};this.style={};this.classList={toggle(){},contains:name=>String(this.className||'').split(/\s+/).includes(name)};this.scrollTop=0;this.clientHeight=0;this.scrollHeight=0;}
    get children(){return this.childNodes.filter(node=>node.nodeType===1);}
    get firstChild(){return this.childNodes[0]||null;}
    get textContent(){return this.childNodes.map(node=>node.textContent).join('');}
    set textContent(value){this.childNodes=[];if(value!==undefined&&value!=='')this.append(new Text(String(value)));}
    set innerHTML(html){parseHtml(String(html||''),this);}
    setAttribute(key,value){
      this.attrs[key]=String(value);
      if(key.startsWith('data-')){
        const prop=key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
        this.dataset[prop]=String(value);
      }
    }
    getAttribute(key){return this.attrs[key]??null;}
    removeAttribute(key){delete this.attrs[key];}
    hasAttribute(key){return Object.hasOwn(this.attrs,key);}
    scrollTo(){}
    matches(selector){return selector.split(',').some(part=>{part=part.trim();return part==='[data-source-line]'?this.hasAttribute('data-source-line'):part.toUpperCase()===this.tagName;});}
    insertBefore(node,reference){node.remove();const index=reference?this.childNodes.indexOf(reference):this.childNodes.length;assert(index>=0);this.childNodes.splice(index,0,node);node.parentNode=this;return node;}
    append(...nodes){for(const node of nodes)this.insertBefore(node,null);}
    replaceChildren(...nodes){this.childNodes=[];this.append(...nodes);}
    addEventListener(){}
    removeEventListener(){}
    getBoundingClientRect(){return {top:0,bottom:0,left:0,right:0,width:0,height:0};}
    contains(node){return node===this||this.childNodes.some(child=>child===node||child.contains?.(node));}
    querySelectorAll(selector){
      const matches=[];
      const check=node=>{
        if(selector==='[data-yuanxing-important="true"]')return node.getAttribute?.('data-yuanxing-important')==='true';
        if(selector==='[data-source-line]')return node.hasAttribute?.('data-source-line');
        if(selector==='img[data-asset-path]')return node.tagName==='IMG'&&node.hasAttribute?.('data-asset-path');
        if(selector==='h1,h2,h3,h4,h5,h6')return /^H[1-6]$/.test(node.tagName||'');
        if(selector.startsWith('.'))return String(node.className||'').split(/\s+/).includes(selector.slice(1));
        return false;
      };
      const visit=node=>{for(const child of node.childNodes||[]){if(child.nodeType===1&&check(child))matches.push(child);visit(child);}};
      visit(this);return matches;
    }
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  }
  const text=value=>new Text(value),el=(tag,...children)=>{const item=doc.createElement(tag);item.append(...children);return item;};
  function select(editor,start,startOffset,end,endOffset){
    const all=[];const visit=node=>{if(node.nodeType===3)all.push(node);else node.childNodes.forEach(visit);};visit(editor);const first=all.indexOf(start),last=all.indexOf(end);assert(first>=0&&last>=first);
    return {startContainer:start,startOffset,endContainer:end,endOffset,collapsed:start===end&&startOffset===endOffset,intersectsNode:node=>all.indexOf(node)>=first&&all.indexOf(node)<=last};
  }
  return {doc,Element,el,text,select};
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

test('行内代码标记可序列化并在剥离重点后写回纯净源文档',()=>{
  const {el,text,select}=fixture(),code=text('ABC'),editor=el('div',el('p',el('code',code)));
  toggleDocumentImportant(editor,select(editor,code,1,code,2));
  const saved=readDescription(editor);assert.equal(saved,'`A`<span style="color:#d92d20">`B`</span>`C`');
  assert.equal(readDescription(editor,{important:false}),'`ABC`');
  assert.match(markdown(saved),/<code>A<\/code><span class="yx-important"[^>]*><code>B<\/code><\/span><code>C<\/code>/);
  const source='## 功能\n- `ABC`\n- 其他规则\n';
  const patched=patchDocumentSource(source,{section:'功能'},{line:1,before:saved,value:saved.replace('C','D')});
  assert.equal(patched.text,'## 功能\n- `ABD`\n- 其他规则\n');
});

test('引用正文重点说明保存到 source.important，支持局部标红、行内代码与重复词区分',()=>{
  const {el,select}=fixture();
  const raw='## 功能\n- 仅限**业务规则**生效\n- 非业务规则不生效\n- 编码 `ABC` 校验\n| 字段 | 说明 |\n| --- | --- |\n| 状态 | 禁用时只读 |\n```text\n业务规则\n```';
  const body=el('div');
  body.innerHTML=markdown(raw,{},{sourceLines:true});
  const lines=body.querySelectorAll('[data-source-line]');
  const firstLi=lines[1],strongText=firstLi.children[0].firstChild;
  toggleDocumentImportant(firstLi,select(firstLi,strongText,0,strongText,4));
  const codeLi=lines[3],codeText=codeLi.children[0].firstChild;
  toggleDocumentImportant(codeLi,select(codeLi,codeText,1,codeText,2));
  const td=lines[7];
  toggleDocumentImportant(td,select(td,td.firstChild,3,td.firstChild,5));
  const collected=collectSourceImportant(body,readDescription);
  assert.equal(collected.length,3);
  assert(!collected.includes('业务规则'));
  assert(collected.includes('只读'));
  const applied=applySourceImportant(raw,collected);
  assert(!applied.startsWith('## <span'));
  assert(!applied.includes('```\n<span'));
  assert.equal(applySourceImportant(raw,collected).match(/<span style="color:#d92d20">/g).length,3);
  const reRendered=el('div');reRendered.innerHTML=markdown(applied,{},{sourceLines:true});
  assert.deepEqual(collectSourceImportant(reRendered,readDescription),collected);
  assert.equal(reRendered.querySelectorAll('[data-source-line]')[2].querySelector('[data-yuanxing-important="true"]'),null);
  assert.match(markdown(applied),/<code>A<\/code><span class="yx-important"[^>]*><code>B<\/code><\/span><code>C<\/code>/);
  toggleDocumentImportant(td,select(td,td.children[0].firstChild,0,td.children[0].firstChild,2));
  assert(!collectSourceImportant(body,readDescription).includes('只读'));
});

test('写回源 Markdown 时剥离重点标签并可清理历史残留标记',()=>{
  const legacy='## 规则\r\n**<span style="color:#d92d20">第一句。</span>****<span style="color:#d92d20">第二句。</span>**\r\n';
  assert.equal(stripImportantMarkdown('**<span style="color:#d92d20">第一句。</span>****<span style="color:#d92d20">第二句。</span>**'),'**第一句。第二句。**');
  const cleaned=patchDocumentSource(legacy,{section:'规则'},{line:1,before:'**第一句。第二句。**',value:'**<span style="color:#d92d20">第一句。</span>第二句。**'});
  assert.equal(cleaned.text,'## 规则\r\n**第一句。第二句。**\r\n');
});

test('validateDocument 校验 source.important 的合法与非法配置',()=>{
  const base={version:1,title:'测试',modules:[{id:'m1',title:'模块'}],nodes:[],edges:[],annotations:[]};
  const makeModel=important=>({...base,document:{version:1,blocks:[{id:'s1',type:'source',path:'需求.md',section:'规则',...(important===undefined?{}:{important})}]}});
  assert.deepEqual(validateDocument(makeModel(['仅限管理员操作'])),[]);
  assert(validateDocument(makeModel('仅限管理员')).some(msg=>msg.includes('重点说明')));
  assert(validateDocument(makeModel(['  '])).some(msg=>msg.includes('重点说明')));
  assert(validateDocument(makeModel(['含\n换行'])).some(msg=>msg.includes('重点说明')));
});

test('工作台引用正文标红与取消重点不写回源文档，编辑文字或清理遗留标记才写回干净正文',async t=>{
  const {doc,el,select}=fixture();
  const previousDocument=globalThis.document,previousWindow=globalThis.window;
  globalThis.document=doc;
  globalThis.window={addEventListener(){},removeEventListener(){}};
  t.after(()=>{globalThis.document=previousDocument;globalThis.window=previousWindow;});
  const saveCalls=[];
  const model={
    version:1,title:'测试',modules:[{id:'m1',title:'模块'}],nodes:[],edges:[],annotations:[],
    document:{version:1,blocks:[
      {id:'src-clean',type:'source',path:'需求.md',section:'干净节'},
      {id:'src-legacy',type:'source',path:'需求.md',section:'遗留节'}
    ]}
  };
  const keyClean=documentSourceKey(model.document.blocks[0]);
  const keyLegacy=documentSourceKey(model.document.blocks[1]);
  const bundle={
    sourcesSignature:'sig1',
    documentSources:{
      [keyClean]:'## 干净节\n必须遵守业务边界。',
      [keyLegacy]:'## 遗留节\n**<span style="color:#d92d20">旧重点</span>**补充说明'
    },
    documentSourceVersions:{[keyClean]:'v1',[keyLegacy]:'v2'}
  };
  const root=el('div');
  const view=createDocumentView({
    root,
    model:()=>model,
    bundle:()=>bundle,
    readonly:false,
    changeText:fn=>fn(model),
    changeStructure:fn=>fn(model),
    markdown:text=>markdown(text),
    sourceMarkdown:text=>markdown(text,{},{sourceLines:true}),
    read:readDescription,
    explanation:()=>'',
    writeExplanation(){},
    notice(){},
    saveSource:async change=>{
      saveCalls.push(change);
      return {beforeVersions:{[change.key]:bundle.documentSourceVersions[change.key]},keyChanges:{[change.key]:change.key},documentSourceVersions:{[change.key]:'v-next'}};
    },
    mountPrototype:()=>({})
  });
  view.enter();
  const blocks=root.querySelectorAll('.doc-source');
  const cleanP=blocks[0].querySelectorAll('[data-source-line]')[1];
  toggleDocumentImportant(cleanP,select(cleanP,cleanP.firstChild,4,cleanP.firstChild,8));
  cleanP.oninput();
  assert.deepEqual(model.document.blocks[0].important,['业务边界']);
  await view.flush();
  assert.equal(saveCalls.length,0);

  // 取消干净块的重点也不写源文档
  const markedSpan=cleanP.querySelector('[data-yuanxing-important="true"]');
  toggleDocumentImportant(cleanP,select(cleanP,markedSpan.firstChild,0,markedSpan.firstChild,4));
  cleanP.oninput();
  assert.equal('important' in model.document.blocks[0],false);
  await view.flush();
  assert.equal(saveCalls.length,0);

  // 重新标红并修改文字时，源文档仅接收不含 <span> 的净文本
  const targetText=cleanP.childNodes[1];
  toggleDocumentImportant(cleanP,select(cleanP,targetText,0,targetText,4));
  cleanP.oninput();
  cleanP.querySelector('[data-yuanxing-important="true"]').firstChild.data='操作边界';
  cleanP.oninput();
  await view.flush();
  assert.equal(saveCalls.length,1);
  assert.equal(saveCalls[0].value,'必须遵守操作边界。');
  assert.deepEqual(model.document.blocks[0].important,['操作边界']);

  // 对历史遗留含 <span> 的原行取消重点时，写回纯净 Markdown 以清理原文件
  const legacyP=blocks[2].querySelectorAll('[data-source-line]')[1];
  const legacySpan=legacyP.querySelector('[data-yuanxing-important="true"]');
  toggleDocumentImportant(legacyP,select(legacyP,legacySpan.firstChild,0,legacySpan.firstChild,3));
  legacyP.oninput();
  await view.flush();
  assert.equal(saveCalls.length,2);
  assert.equal(saveCalls[1].value,'**旧重点**补充说明');
});
