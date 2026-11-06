const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1600, height: 1200 } });
  await p.setContent('<div style="width:1600px;height:1200px;background:linear-gradient(160deg,#9cc3e6 0%,#d9e7f2 38%,#6f7d5a 39%,#8a9466 60%,#555 61%,#3d3d3d 100%);position:relative"><div style="position:absolute;left:520px;top:640px;width:420px;height:150px;background:#1f5fa8;border-radius:40px 60px 20px 20px;transform:rotate(-14deg)"></div><div style="position:absolute;left:0;top:720px;width:1600px;height:14px;background:repeating-linear-gradient(90deg,#fff 0 60px,#ef1d34 60px 120px)"></div></div>');
  await p.screenshot({ path: process.argv[2], type: 'jpeg', quality: 85 }); await b.close(); })();
