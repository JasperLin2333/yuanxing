// 更新说明随项目保存；界面只维护本机的已读状态。
export function updateSignature(updates){
  let hash=2166136261;
  for(const char of JSON.stringify(updates||[])){hash^=char.codePointAt(0);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(16);
}

export function createUpdates({getModel,openNode,leaveCurrent,storage,location=globalThis.location}){
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
      const row=document.createElement('li'),text=document.createElement('span');text.textContent=item.text;row.append(text);
      const target=model.nodes.find(node=>node.id===item.node);
      if(target){const link=document.createElement('button');link.type='button';link.className='updates-link';link.textContent='查看'+(item.label||target.title);link.onclick=()=>{dialog.close();leaveCurrent();openNode(target.id);};row.append(link);}
      list.append(row);
    }
    dialog.showModal();try{(storage||globalThis.localStorage).setItem(key(),updateSignature(model.updates||[]));}catch{}refresh();
  }
  trigger.addEventListener('click',show);
  document.getElementById('updates-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation();});
  return {refresh};
}
