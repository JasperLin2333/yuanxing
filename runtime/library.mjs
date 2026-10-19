// 页面目录与模块管理界面，业务修改由工作台传入的回调完成。
import {recycleNodes} from './core.mjs';
const librarySvgNS='http://www.w3.org/2000/svg';
const libraryIconPaths={
  plus:['M12 5v14M5 12h14'],
  search:['M20 20l-4-4','M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z'],
  module:['M3 6h7l2 2h9v12H3Z','M3 6V4h7l2 2'],
  delete:['M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7'],
  grip:['M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01']
};
function libraryElement(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
function libraryIcon(name){const svg=document.createElementNS(librarySvgNS,'svg');for(const [key,value] of Object.entries({width:'16',height:'16',viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':name==='grip'?'3':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(key,value);for(const d of libraryIconPaths[name]||[]){const path=document.createElementNS(librarySvgNS,'path');path.setAttribute('d',d);svg.append(path);}return svg;}
function libraryButton(label,onclick,className=''){const b=libraryElement('button',className,label);b.type='button';if(label)b.title=label;b.onclick=onclick;return b;}
function libraryIconButton(name,label,onclick,className=''){const b=libraryButton(undefined,onclick,`library-icon ${className}`);b.title=label;b.setAttribute('aria-label',label);b.append(libraryIcon(name));return b;}
const libraryIsPage=n=>!(n.kind==='note'&&n.presentation==='branch');
const libraryCompareNodes=(a,b)=>(a.y||0)-(b.y||0)||(a.x||0)-(b.x||0);
const librarySearchable=(value,query)=>String(value||'').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());

// 保留仍在画布上的节点 DOM；移动已有 iframe 会让浏览器重新加载原型。
export function reconcileCanvasCards(host,nodes,render){
  const existing=new Map([...host.children].map(card=>[card.dataset.id,card])),wanted=new Set(nodes.map(n=>n.id));
  for(const [id,card] of existing)if(!wanted.has(id))card.remove();
  for(const n of nodes){const card=render(n,existing.get(n.id));if(card.parentNode!==host)host.append(card);}
}

export function searchCanvasPages(model,query){
  if(!query.trim())return [];
  const byId=new Map(model.nodes.map(n=>[n.id,n])),rank=new Map(model.modules.map((m,i)=>[m.id,i])),matches=new Map();
  for(const n of model.nodes){
    if(!libraryIsPage(n)||!librarySearchable(n.title,query))continue;
    const target=n.overview===false?byId.get(n.overviewAlias):n;
    if(target&&target.overview!==false&&libraryIsPage(target)&&rank.has(target.module))matches.set(target.id,target);
  }
  return [...matches.values()].sort((a,b)=>rank.get(a.module)-rank.get(b.module)||libraryCompareNodes(a,b));
}

export function createLibrary({getModel,getModule,getCurrent,getSelected,getRecycleOpen,openRecycle,readonly=false,locateNode,selectModule,removeModule,moveModule,addModule}){
  let sidebarQuery='',dragging=null,sidebar=null;
  const model=()=>getModel(),moduleId=()=>{const value=getModule?.();return typeof value==='object'?value?.id:value;};
  const currentId=()=>{const value=getCurrent?.();return typeof value==='object'?value?.id:value;};
  const moduleTitle=id=>model().modules.find(m=>m.id===id)?.title||'未归属模块';
  const selectedIds=()=>{const selection=getSelected?.();return selection?.type==='nodes'?selection.ids:selection?.type==='node'?[selection.id]:[];};
  function pageRow(n){
    const row=libraryElement('div','library-page'),main=libraryButton(undefined,()=>locateNode?.(n.id),'library-page-main');main.title=`定位「${n.title||'未命名页面'}」`;
    const title=libraryElement('span','library-page-title',n.title||'未命名页面');main.append(title);
    const metadata=libraryElement('span','library-page-meta',moduleTitle(n.module));
    main.append(metadata);row.append(main);
    const active=model().nodes.find(item=>item.id===currentId())?.overviewAlias||currentId();row.classList.toggle('active',active===n.id||selectedIds().includes(n.id));return row;
  }
  function sidebarResults(host){
    host.replaceChildren();const query=sidebarQuery.trim();if(!query)return;
    const nodes=searchCanvasPages(model(),query);
    for(const n of nodes)host.append(pageRow(n));
    if(!nodes.length)host.append(libraryElement('p','library-empty','未找到相关页面'));
  }
  function renderSidebar(nav){
    sidebar=nav;
    const oldSearch=nav.querySelector('.library-search'),retainFocus=oldSearch===document.activeElement,selection=retainFocus?[oldSearch.selectionStart,oldSearch.selectionEnd]:null;
    nav.replaceChildren();const tools=libraryElement('div','library-sidebar-tools');
    const search=libraryElement('input','library-search');search.type='search';search.placeholder='搜索页面';search.setAttribute('aria-label','按名称搜索全部页面');search.value=sidebarQuery;
    const commands=libraryElement('div','library-sidebar-commands');commands.append(libraryElement('span','library-module-heading','模块'));
    if(!readonly&&addModule)commands.append(libraryIconButton('plus','新增模块',()=>{sidebarQuery='';addModule();}));
    const searchWrap=libraryElement('div','library-search-wrap');searchWrap.append(libraryIcon('search'),search);tools.append(searchWrap,commands);nav.append(tools);
    const results=libraryElement('div','library-sidebar-results'),modules=libraryElement('div','library-modules');nav.append(results,modules);
    const updateSearch=()=>{sidebarQuery=search.value;modules.hidden=!!sidebarQuery.trim();sidebarResults(results);};search.oninput=updateSearch;search.onsearch=updateSearch;modules.hidden=!!sidebarQuery.trim();sidebarResults(results);
    for(const m of model().modules){
      const group=libraryElement('div','library-module'),row=libraryElement('div','library-module-row');row.dataset.module=m.id;
      if(!readonly&&moveModule){
        const handle=libraryIconButton('grip','调整模块顺序（↑ / ↓）',()=>{},'library-module-handle');handle.draggable=true;
        handle.ondragstart=event=>{dragging=m.id;nav.classList.add('library-dragging');event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',m.id);};
        handle.ondragend=()=>{dragging=null;nav.classList.remove('library-dragging');nav.querySelectorAll('.library-drop-before').forEach(el=>el.classList.remove('library-drop-before'));};
        handle.onkeydown=event=>{const list=model().modules,index=list.findIndex(item=>item.id===m.id);if(event.key==='ArrowUp'&&index>0){event.preventDefault();moveModule(m.id,list[index-1].id);}else if(event.key==='ArrowDown'&&index<list.length-1){event.preventDefault();moveModule(m.id,list[index+2]?.id||null);}};
        row.append(handle);
        row.ondragover=event=>{if(dragging&&dragging!==m.id){event.preventDefault();event.dataTransfer.dropEffect='move';row.classList.add('library-drop-before');}};
        row.ondragleave=event=>{if(!row.contains(event.relatedTarget))row.classList.remove('library-drop-before');};
        row.ondrop=event=>{event.preventDefault();if(dragging&&dragging!==m.id){const id=dragging;dragging=null;moveModule(id,m.id);}nav.classList.remove('library-dragging');row.classList.remove('library-drop-before');};
      }
      const title=libraryButton(undefined,()=>selectModule(m.id),`module ${m.id===moduleId()&&!getRecycleOpen?.()?'active':''}`);title.append(libraryIcon('module'),libraryElement('span','library-module-title',m.title));title.title=`切换到「${m.title}」模块`;row.append(title);
      const own=model().nodes.filter(n=>n.module===m.id);
      if(!readonly&&removeModule)row.append(libraryIconButton('delete',`删除「${m.title}」模块`,()=>removeModule(m.id),'danger library-module-delete'));
      group.append(row);
      if(m.id===moduleId()){
        const nodes=own.filter(n=>n.overview!==false&&libraryIsPage(n)).slice().sort(libraryCompareNodes);let section;
        for(const n of nodes){if(n.section&&n.section!==section){section=n.section;const name=m.sections?.find(s=>s.id===section)?.title;if(name)group.append(libraryElement('div','state-section',name));}else if(!n.section)section=null;
          const page=libraryElement('div','library-sidebar-page'),b=libraryButton(n.title,()=>locateNode?.(n.id),`state ${currentId()===n.id||selectedIds().includes(n.id)?'active':''}`);b.title=`定位「${n.title}」`;page.append(b);group.append(page);
        }
      }
      modules.append(group);
    }
    if(!readonly&&moveModule){const end=libraryElement('div','library-end-drop','移到最后');end.ondragover=event=>{if(dragging){event.preventDefault();event.dataTransfer.dropEffect='move';}};end.ondrop=event=>{event.preventDefault();if(dragging){const id=dragging;dragging=null;moveModule(id,null);}nav.classList.remove('library-dragging');};modules.append(end);}
    if(openRecycle){const footer=libraryElement('div','library-sidebar-footer'),button=libraryButton(undefined,openRecycle,`library-recycle ${getRecycleOpen?.()?'active':''}`),count=recycleNodes(model()).length;button.title='回收站：查看未显示在画布上的内容';button.append(libraryIcon('delete'),libraryElement('span','','回收站'),libraryElement('span','library-recycle-count',String(count)));footer.append(button);nav.append(footer);}
    if(retainFocus){search.focus({preventScroll:true});if(search.type==='search')search.setSelectionRange(...selection);}
  }
  function focusSearch(){const search=sidebar?.querySelector('.library-search');search?.focus();search?.select();}
  return {renderSidebar,focusSearch};
}

export const libraryStyles=`
#sidebar .library-sidebar-tools{position:sticky;top:0;z-index:3;padding:0 0 12px;background:var(--surface);box-shadow:0 -16px 0 var(--surface)}
.library-search-wrap{display:flex;align-items:center;gap:8px;height:32px;padding:0 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--subtle)}
.library-search-wrap:hover{border-color:var(--subtle)}
.library-search-wrap:focus-within{border-color:var(--green);outline:2px solid var(--selected);outline-offset:1px}
.library-search-wrap>svg{flex:none}
#sidebar .library-search{flex:1;min-width:0;min-height:28px;height:28px;margin:0;padding:4px 0;border:0;background:transparent;color:var(--ink);font-size:13px;line-height:20px;outline:none}
.library-sidebar-commands{display:flex;align-items:center;gap:8px;margin-top:12px}
#sidebar .library-sidebar-commands button{width:auto;display:inline-flex;align-items:center;justify-content:center;font-size:13px}
.library-module-heading{flex:1;padding:4px 8px;color:var(--muted);font-size:12px;font-weight:600}
.library-icon{display:inline-flex!important;align-items:center;justify-content:center;flex:none;width:28px!important;height:28px;min-height:28px;padding:4px!important;border:1px solid transparent;border-radius:var(--radius);color:var(--muted)}
.library-icon.danger{color:var(--danger)}
.library-module{margin:0 0 4px}
.library-module-row{display:flex;align-items:center;gap:4px;padding:0;border-top:2px solid transparent}
#sidebar .library-module-row .module{display:flex;align-items:center;justify-content:flex-start;flex:1;gap:8px;min-width:0;min-height:32px;width:auto;padding:5px 8px;font-size:13px;line-height:20px;font-weight:600;text-align:left}
.library-module-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.library-module-row .module>svg{flex:none;color:var(--subtle)}
.library-module-row .module.active>svg{color:var(--selected-ink)}
.library-module-handle{width:16px!important;padding:2px!important;cursor:grab;opacity:0}
.library-module-delete{opacity:0}
.library-module-row:hover .library-module-handle,.library-module-row:focus-within .library-module-handle,.library-module-row:hover .library-module-delete,.library-module-row:focus-within .library-module-delete{opacity:1}
.library-module-row.library-drop-before{border-top-color:var(--green)}
.library-sidebar-page{display:flex;align-items:center;min-width:0;margin-left:20px;padding-left:12px;border-left:1px solid var(--line)}
#sidebar .library-sidebar-page .state{flex:1;min-width:0;min-height:32px;width:auto;padding:5px 8px;font-size:13px;line-height:20px;text-align:left;overflow-wrap:anywhere}
.library-end-drop{display:none;margin-top:12px;padding:8px;border:1px dashed var(--border);border-radius:var(--radius);color:var(--muted);text-align:center;font-size:12px}
.library-dragging .library-end-drop{display:block}
.library-page{display:flex;align-items:center;margin-bottom:4px;border-radius:var(--radius)}
#sidebar .library-page-main{display:block;flex:1;min-width:0;width:100%;padding:8px;text-align:left;white-space:normal}
.library-page-title{display:block;overflow:hidden;text-overflow:ellipsis;font-size:13px;line-height:20px;white-space:normal}
.library-page-meta{display:block;margin-top:4px;color:var(--muted);font-size:12px;line-height:18px}
.library-page.active{background:var(--selected)}
.library-page.active .library-page-title{color:var(--selected-ink)}
.library-empty{margin:0;padding:24px 8px;color:var(--muted);text-align:center;font-size:12px}
#sidebar{display:flex;flex-direction:column;overflow:hidden}
#sidebar .library-sidebar-tools{flex:none}
.library-modules,.library-sidebar-results{flex:1;min-height:0;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--border) transparent}
.library-sidebar-results:empty{display:none}
.library-sidebar-footer{flex:none;margin:12px -12px -16px;padding:8px 12px 12px;border-top:1px solid var(--line);background:var(--surface)}
#sidebar .library-recycle{display:flex;align-items:center;gap:8px;width:100%;padding:5px 8px;color:var(--muted)}
#sidebar .library-recycle.active{background:var(--selected);color:var(--selected-ink)}
.library-recycle-count{margin-left:auto;font-size:12px;font-variant-numeric:tabular-nums}
`;
