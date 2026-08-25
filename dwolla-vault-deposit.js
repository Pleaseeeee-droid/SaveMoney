(()=>{
  const originalOpenAction=openAction;
  openAction=function(id,type){
    originalOpenAction(id,type);
    if(type!=='add')return;
    const v=vaults.find(x=>x.id===id);
    if(!v)return;
    const description=document.querySelector('#actionDescription');
    const submit=document.querySelector('#actionSubmit');
    if(description)description.textContent=`Start a Dwolla sandbox bank deposit for “${v.name}”. The vault balance will not change until the transfer is confirmed processed. No real money will move.`;
    if(submit)submit.textContent='Start Dwolla deposit';
  };

  const form=document.querySelector('#actionForm');
  if(!form)return;

  form.addEventListener('submit',async e=>{
    if(activeAction?.type!=='add')return;
    e.preventDefault();
    e.stopImmediatePropagation();

    const v=vaults.find(x=>x.id===activeAction.id);
    const amount=Number(document.querySelector('#actionAmount')?.value);
    const submit=document.querySelector('#actionSubmit');
    if(!v||!Number.isFinite(amount)||amount<=0)return;

    submit.disabled=true;
    submit.textContent='Starting Dwolla deposit…';

    try{
      const response=await fetch('/api/create-vault-checkout',{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          Authorization:`Bearer ${authSession?.accessToken||''}`
        },
        body:JSON.stringify({vaultId:v.id,amount})
      });
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.error||'Could not create Dwolla vault deposit.');

      document.querySelector('#actionDialog')?.close();
      activeAction=null;
      alert(`${money(amount)} Dwolla sandbox deposit started for “${v.name}”. Status: ${data.status||'created'}. It is not credited to the vault yet; SaveMoney will only credit it after Dwolla confirms processing. No real money moved.`);
    }catch(error){
      alert(error.message);
    }finally{
      submit.disabled=false;
      submit.textContent='Start Dwolla deposit';
    }
  },true);
})();
