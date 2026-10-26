(()=>{
  const hash=new URLSearchParams(location.hash.replace(/^#/,''));
  const query=new URLSearchParams(location.search);
  const token=hash.get('access_token');
  const isRecovery=hash.get('type')==='recovery';
  const failure=hash.get('error_code')||query.get('error_code');
  if(!isRecovery&&!failure)return;
  // Keep recovery credentials out of URL history and never save them to localStorage.
  history.replaceState(null,'',location.pathname);
  const style=document.createElement('style');
  style.textContent=`#passwordRecoveryScreen{position:fixed;inset:0;z-index:99999;overflow:auto;background:#07101c;display:grid;place-items:center;padding:22px}
    #passwordRecoveryScreen .resetCard{width:min(430px,100%);padding:28px;border-radius:18px;border:1px solid #29445e;background:#0c1929;color:#f5f7fb;font-family:system-ui,sans-serif}
    #passwordRecoveryScreen label{display:block;margin:18px 0 0;font-size:14px;font-weight:600}
    #passwordRecoveryScreen input{display:block;width:100%;padding:12px;margin-top:8px;box-sizing:border-box;border-radius:9px;border:1px solid #456078;background:#071421;color:white;font:inherit}
    #passwordRecoveryScreen button,#passwordRecoveryScreen a{display:block;width:100%;box-sizing:border-box;margin-top:18px;padding:12px;border-radius:10px;background:#52e0b0;color:#032018;border:0;text-align:center;font-weight:800;text-decoration:none;font-size:15px;cursor:pointer}
    #passwordRecoveryScreen p{color:#bbccda;line-height:1.5}
    #passwordRecoveryScreen .resetError{color:#ffb3bf}`;
  document.head.appendChild(style);
  const screen=document.createElement('section');
  screen.id='passwordRecoveryScreen';
  screen.innerHTML=`<div class="resetCard"><h1>Reset SaveMoney password</h1>
    <p id="passwordResetInfo">Choose a new password to regain access to your existing vaults.</p>
    <form id="passwordRecoveryForm">
      <label>New password<input id="passwordRecoveryNew" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label>
      <label>Confirm password<input id="passwordRecoveryConfirm" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label>
      <p class="resetError" id="passwordRecoveryError" role="alert" hidden></p>
      <button id="passwordRecoverySubmit" type="submit">Save new password</button>
    </form>
    <a id="passwordRecoveryBack" href="/" hidden>Return to sign in</a>
  </div>`;
  document.body.appendChild(screen);
  const form=screen.querySelector('#passwordRecoveryForm');
  const info=screen.querySelector('#passwordResetInfo');
  const error=screen.querySelector('#passwordRecoveryError');
  const link=screen.querySelector('#passwordRecoveryBack');
  if(!token||failure){
    form.hidden=true;
    info.textContent='This recovery link has expired or is invalid. Go back to Supabase Authentication → Users and send a NEW password recovery email.';
    link.hidden=false;
    return;
  }
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    error.hidden=true;
    const password=screen.querySelector('#passwordRecoveryNew').value;
    const confirmation=screen.querySelector('#passwordRecoveryConfirm').value;
    if(password!==confirmation){error.textContent='Passwords do not match.';error.hidden=false;return;}
    if(password.length<12){error.textContent='Use at least 12 characters.';error.hidden=false;return;}
    const submit=screen.querySelector('#passwordRecoverySubmit');
    submit.disabled=true;submit.textContent='Saving…';
    try{
      const response=await fetch('/api/auth-login?mode=recovery',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        body:JSON.stringify({password})
      });
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.error||'Password update failed.');
      form.hidden=true;
      info.textContent='Password updated. You can now sign in to SaveMoney with your email and new password.';
      link.hidden=false;
    }catch(err){error.textContent=err.message;error.hidden=false;}
    finally{submit.disabled=false;submit.textContent='Save new password';}
  });
})();
