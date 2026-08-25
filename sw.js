const CACHE='savemoney-v5';
const ASSETS=['./','./index.html','./styles.css?v=10','./blockchain-vault.css?v=1','./app.js?v=9','./dwolla-bank-verify.js?v=1','./dwolla-transfer-test.js?v=3','./payment-methods.js?v=1','./funding-options.js?v=2','./blockchain-vault.js?v=1','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  if(new URL(e.request.url).pathname.startsWith('/api/'))return;
  e.respondWith(fetch(e.request).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return resp;}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))));
});