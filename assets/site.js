document.querySelectorAll('[data-copy]').forEach(button=>{
  button.addEventListener('click',async()=>{
    const target=document.getElementById(button.dataset.copy);
    const status=document.querySelector('.copy-status');
    if(!target||!status)return;
    try{
      if(!navigator.clipboard?.writeText)throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(target.textContent.trim());
      status.textContent='已复制，可以粘贴到你的 AI 助手或终端。';
    }catch{
      const selection=window.getSelection(),range=document.createRange();
      range.selectNodeContents(target);selection?.removeAllRanges();selection?.addRange(range);
      status.textContent='请复制已选中的文字。';
    }
  });
});
