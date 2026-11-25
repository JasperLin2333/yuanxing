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

export const updateStamp=({date,time})=>time?date+' '+time:date;
export const orderedUpdates=updates=>[...(updates||[])].sort((a,b)=>updateStamp(b).localeCompare(updateStamp(a)));

function changeText(text){
  if(text===undefined)return '（当时未记录）';
  if(text==='')return '（无正文）';
  const longest=(text.match(/~+/g)||[]).reduce((length,run)=>Math.max(length,run.length),2);
  const fence='~'.repeat(longest+1);
  return fence+'markdown\n'+text+'\n'+fence;
}

function formatChange(change){
  return ['### '+(change.title||'变更内容'),'**改前**',changeText(change.before),'**改后**',changeText(change.after)].join('\n\n');
}

function combinedChanges(updates){
  const entries=[];
  for(const update of [...updates].reverse()){
    const changes=update.changes||[];
    for(const change of changes){
      const unambiguousTitle=change.title&&changes.filter(item=>!item.key&&item.title===change.title).length===1;
      const candidates=entries.filter(entry=>{
        if(entry.update===update)return false;
        if(change.key)return entry.change.key===change.key;
        return unambiguousTitle&&!entry.change.key&&entry.change.title===change.title
          &&change.before!==undefined&&entry.change.after===change.before;
      });
      const previous=candidates.length===1?candidates[0]:null;
      if(previous&&previous.change.before!==undefined&&change.after!==undefined){
        previous.change={...change,before:previous.change.before};
        previous.update=update;
      }else entries.push({change,update});
    }
  }
  return entries.map(entry=>entry.change).filter(change=>change.before===undefined||change.before!==change.after);
}

export function formatUpdatesMarkdown(title,updates,{combine=false,baseline}={}){
  if(!updates.length)return '';
  const lines=['# '+title+'变更记录'];
  if(combine){
    lines.push('变更范围：'+(baseline?updateStamp(baseline)+'之后（'+baseline.text+'）':'全部记录')+' → '+updateStamp(updates[0]));
    const changes=combinedChanges(updates);
    if(changes.length)lines.push(...changes.map(formatChange));
    const summaries=updates.filter(update=>!update.changes?.length);
    if(summaries.length)lines.push('## 仅记录了摘要的更新',...summaries.map(update=>'- '+updateStamp(update)+' '+update.text));
    if(!changes.length&&!summaries.length)lines.push('所选范围的正文没有净变化。');
  }else{
    for(const update of updates){
      lines.push('## '+updateStamp(update),update.text);
      if(update.changes?.length)lines.push(...update.changes.map(formatChange));
      else lines.push('（本次仅记录了更新摘要）');
    }
  }
  return lines.join('\n\n')+'\n';
}

export function createUpdates({getModel,copy,storage,location=globalThis.location}){
  const trigger=document.getElementById('updates-trigger'),dot=document.getElementById('updates-dot'),dialog=document.getElementById('updates-dialog'),body=document.getElementById('updates-content');
  const range=document.getElementById('updates-range'),baseline=document.getElementById('updates-baseline'),copyRange=document.getElementById('updates-copy-range');
  const feedback=document.getElementById('updates-copy-status'),manual=document.getElementById('updates-copy-text');
  let copyRequest=0;
  const entries=()=>getModel()?.updates||[];
  const key=()=>`yuanxing-updates-read:${location.pathname}:${getModel()?.title||''}`;
  function refresh(){
    const updates=entries();let read=false;try{read=(storage||globalThis.localStorage).getItem(key())===updateSignature(updates);}catch{}
    const unread=updates.length>0&&!read;dot.hidden=!unread;trigger.setAttribute('aria-label',unread?'更新说明，有未读更新':'更新说明');
  }
  function resetCopy(){
    feedback.textContent='';
    manual.hidden=true;
    manual.value='';
  }
  async function copyRecord(markdown){
    const request=++copyRequest;
    resetCopy();
    try{
      await copy(markdown,dialog);
      if(dialog.open&&request===copyRequest)feedback.textContent='已复制变更记录';
    }catch{
      if(!dialog.open||request!==copyRequest)return;
      manual.hidden=false;
      manual.value=markdown;
      manual.select();
      feedback.textContent='请按 Ctrl+C 或 ⌘C 复制已选中的文字';
    }
  }
  function prepareRange(model,updates){
    range.hidden=updates.length<2;
    const option=(value,label)=>{
      const el=document.createElement('option');
      el.value=value;
      el.textContent=label;
      return el;
    };
    baseline.replaceChildren(option('','选择上次交付'),...updates.slice(1).map((item,index)=>option(String(index+1),updateStamp(item)+' · '+item.text)),option('all','全部变更'));
    baseline.value='';
    copyRange.disabled=true;
    copyRange.onclick=()=>{
      if(!baseline.value)return;
      const index=baseline.value==='all'?updates.length:Number(baseline.value);
      return copyRecord(formatUpdatesMarkdown(model.title,updates.slice(0,index),{combine:true,baseline:updates[index]}));
    };
  }
  function show(){
    const model=getModel();if(!model)return;body.replaceChildren();
    ++copyRequest;
    resetCopy();
    const updates=orderedUpdates(model.updates);
    prepareRange(model,updates);
    if(!updates.length){const empty=document.createElement('p');empty.className='updates-empty';empty.textContent='暂无更新说明';body.append(empty);}
    let section,list,lastDate;
    for(const item of updates){
      if(item.date!==lastDate){section=document.createElement('section');const heading=document.createElement('h3');heading.textContent=item.date;list=document.createElement('ul');section.append(heading,list);body.append(section);lastDate=item.date;}
      const row=document.createElement('li'),head=document.createElement('div'),text=document.createElement('span');
      head.className='updates-item-head';text.className='updates-text';text.textContent=item.text;head.append(text);row.append(head);
      if(item.time){const time=document.createElement('time');time.className='updates-time';time.dateTime=item.time;time.textContent=item.time;text.prepend(time);}
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
      const copyButton=document.createElement('button');
      copyButton.type='button';
      copyButton.className='updates-copy';
      copyButton.textContent='复制本次';
      copyButton.onclick=()=>copyRecord(formatUpdatesMarkdown(model.title,[item]));
      head.append(copyButton);
      list.append(row);
    }
    dialog.showModal();try{(storage||globalThis.localStorage).setItem(key(),updateSignature(model.updates||[]));}catch{}refresh();
  }
  baseline.addEventListener('change',()=>{copyRange.disabled=!baseline.value;});
  trigger.addEventListener('click',show);
  document.getElementById('updates-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation();});
  return {refresh};
}
