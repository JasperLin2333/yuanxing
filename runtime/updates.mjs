// 更新说明随项目保存；界面只维护本机的已读状态。
export function updateSignature(updates){
  let hash=2166136261;
  for(const char of JSON.stringify(updates||[])){hash^=char.codePointAt(0);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(16);
}

export function diffSegments(before='',after=''){
  const a=[...String(before??'')],b=[...String(after??'')];
  if(!a.length||!b.length)return {beforeParts:a.length?[{text:a.join(''),changed:false}]:[],afterParts:b.length?[{text:b.join(''),changed:false}]:[]};
  let prefix=0;
  while(prefix<a.length&&prefix<b.length&&a[prefix]===b[prefix])prefix++;
  let suffix=0;
  while(suffix<a.length-prefix&&suffix<b.length-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
  const hasContext=prefix>0||suffix>0;
  const build=(chars)=>{
    const head=chars.slice(0,prefix).join(''),mid=chars.slice(prefix,chars.length-suffix).join(''),tail=suffix?chars.slice(chars.length-suffix).join(''):'';
    return [{text:head,changed:false},{text:mid,changed:hasContext&&mid.length>0},{text:tail,changed:false}].filter(part=>part.text);
  };
  return {beforeParts:build(a),afterParts:build(b)};
}

function renderDiffText(container,parts){
  for(const part of parts){const node=document.createElement(part.changed?'mark':'span');node.textContent=part.text;container.append(node);}
}

export function createUpdates({getModel,storage,location=globalThis.location}){
  const trigger=document.getElementById('updates-trigger'),dot=document.getElementById('updates-dot'),dialog=document.getElementById('updates-dialog'),body=document.getElementById('updates-content');
  const entries=()=>getModel()?.updates||[];
  const key=()=>`yuanxing-updates-read:${location.pathname}:${getModel()?.title||''}`;
  function refresh(){
    const updates=entries();let read=false;try{read=(storage||globalThis.localStorage).getItem(key())===updateSignature(updates);}catch{}
    const unread=updates.length>0&&!read;dot.hidden=!unread;trigger.setAttribute('aria-label',unread?'更新说明，有未读更新':'更新说明');
  }
  function show(){
    const model=getModel();if(!model)return;body.replaceChildren();
    const updates=[...(model.updates||[])].sort((a,b)=>b.date.localeCompare(a.date));
    if(!updates.length){const empty=document.createElement('p');empty.className='updates-empty';empty.textContent='暂无更新说明';body.append(empty);}
    let section,list,lastDate;
    for(const item of updates){
      if(item.date!==lastDate){section=document.createElement('section');const heading=document.createElement('h3');heading.textContent=item.date;list=document.createElement('ul');section.append(heading,list);body.append(section);lastDate=item.date;}
      const row=document.createElement('li'),head=document.createElement('div'),text=document.createElement('span');
      head.className='updates-item-head';text.className='updates-text';text.textContent=item.text;head.append(text);row.append(head);
      if(Array.isArray(item.changes)&&item.changes.length){
        const toggle=document.createElement('button');toggle.type='button';toggle.className='updates-diff-toggle';toggle.setAttribute('aria-expanded','false');toggle.textContent='查看变更';
        const box=document.createElement('div');box.className='updates-diff-box';box.hidden=true;
        for(const change of item.changes){
          const card=document.createElement('div');card.className='updates-diff-item';
          if(change.title){const title=document.createElement('div');title.className='updates-diff-title';title.textContent=change.title;card.append(title);}
          const {beforeParts,afterParts}=diffSegments(change.before,change.after);
          if(beforeParts.length){
            const line=document.createElement('div');line.className='updates-diff-row is-before';
            const sign=document.createElement('span');sign.className='updates-diff-sign';sign.textContent='−';
            const content=document.createElement('div');content.className='updates-diff-text';
            renderDiffText(content,beforeParts);line.append(sign,content);card.append(line);
          }
          if(afterParts.length){
            const line=document.createElement('div');line.className='updates-diff-row is-after';
            const sign=document.createElement('span');sign.className='updates-diff-sign';sign.textContent='＋';
            const content=document.createElement('div');content.className='updates-diff-text';
            renderDiffText(content,afterParts);line.append(sign,content);card.append(line);
          }
          box.append(card);
        }
        toggle.onclick=()=>{const next=!box.hidden;box.hidden=next;toggle.setAttribute('aria-expanded',String(!next));toggle.textContent=next?'查看变更':'收起变更';};
        head.append(toggle);row.append(box);
      }
      list.append(row);
    }
    dialog.showModal();try{(storage||globalThis.localStorage).setItem(key(),updateSignature(model.updates||[]));}catch{}refresh();
  }
  trigger.addEventListener('click',show);
  document.getElementById('updates-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation();});
  return {refresh};
}
