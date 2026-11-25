// The widgets as a Telegram Mini App: the same HTML design (src/widgets.js) opened by a web_app
// button, full screen and dark, for chats where Telegram does not allow HTML widgets yet.
// The page itself carries no data. The data comes from POST /w/api, and only for the owner: the
// Mini App's initData is checked with the bot token (HMAC, see the Telegram docs), max 24 hours old.
import crypto from 'node:crypto';

// initData → the Telegram user, or null when the signature or the age does not fit.
export function verifyInitData(initData, botToken, { maxAgeSec = 86400, now = Date.now() } = {}) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(String(initData));
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete('hash');
  const check = [...params].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', key).update(check).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  const age = now / 1000 - Number(params.get('auth_date') || 0);
  if (!(age >= -300 && age <= maxAgeSec)) return null;
  try { return JSON.parse(params.get('user') || 'null'); } catch { return null; }
}

// For tests and the local check: initData signed with a given token.
export function signInitData(fields, botToken) {
  const params = new URLSearchParams(Object.entries(fields).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const check = [...params].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', crypto.createHmac('sha256', key).update(check).digest('hex'));
  return params.toString();
}

// The widget's TelegramWidget API, played by the Mini App: request() goes to /w/api with initData,
// the first data comes on open, «activated» fires when the app comes back to the screen.
const SHIM = (kind) => `const __tg=window.Telegram&&Telegram.WebApp;
try{__tg.ready();__tg.expand();__tg.requestFullscreen&&__tg.isVersionAtLeast&&__tg.isVersionAtLeast('8.0')&&__tg.requestFullscreen();__tg.setHeaderColor&&__tg.setHeaderColor('#0f1115');__tg.setBackgroundColor&&__tg.setBackgroundColor('#0f1115');__tg.setBottomBarColor&&__tg.setBottomBarColor('#0f1115')}catch(e){}
const __H={};
window.TelegramWidget={chatData:'{}',isActive:true,HapticFeedback:__tg&&__tg.HapticFeedback,
onEvent(n,f){(__H[n]=__H[n]||[]).push(f)},ready(){},
request(q){return fetch('/w/api',{method:'POST',headers:{'content-type':'application/json','x-mf-client':'1'},body:JSON.stringify({q,initData:__tg?__tg.initData:''})})
.then(r=>r.json()).then(j=>{if(j.error){document.getElementById('err').textContent=j.error;throw new Error(j.error)}document.getElementById('err').textContent='';return{result:j.data}})}};
const __fire=(n)=>(__H[n]||[]).forEach(f=>{try{f()}catch(e){}});
document.addEventListener('visibilitychange',()=>{TelegramWidget.isActive=!document.hidden;if(!document.hidden)__fire('activated')});
// The page's CSP has no 'unsafe-inline': onclick="spin()" attributes do not run by themselves.
// One listener reads them and calls the named function: name(arg, …) with numbers, 'strings' and this.
document.addEventListener('click',(e)=>{const el=e.target.closest('[onclick]');if(!el)return;const m=/^\\s*(\\w+)\\((.*)\\)\\s*;?\\s*$/.exec(el.getAttribute('onclick')||'');if(!m||typeof window[m[1]]!=='function')return;
const a=m[2].trim()?m[2].split(',').map(x=>x.trim()).map(x=>x==='this'?el:/^-?\\d+(\\.\\d+)?$/.test(x)?Number(x):x.replace(/^['"]|['"]$/g,'')):[];window[m[1]](...a)});
window.addEventListener('load',()=>TelegramWidget.request('${kind}').then(a=>{TelegramWidget.chatData=a.result||'{}';__fire('chatDataChanged')},()=>{}));`;

// Dark, full screen, a bit larger than in a message bubble.
const LOOK = `:root{--t:#f2f3f5!important;--m:#9aa0aa!important;--c:rgba(255,255,255,.08)!important;color-scheme:dark}
html,body{background:#0f1115;min-height:100%}body{font-size:15px;-webkit-text-size-adjust:100%}
.w{max-width:520px;margin:0 auto;padding:calc(14px + var(--tg-content-safe-area-inset-top,0px) + var(--tg-safe-area-inset-top,0px)) 16px 28px}
.btn{padding:9px 12px;font-size:14px}.l{padding:8px 0}
#err{color:#e5484d;font:13px system-ui;text-align:center;padding:8px 16px}`;

// The page: the widget's own HTML with the shim before its script, every script with the nonce.
export function miniPage(widgetHtml, kind, nonce) {
  return String(widgetHtml)
    .replace('<head>', `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="dark"><title>Некит</title><script nonce="${nonce}" src="https://telegram.org/js/telegram-web-app.js"></script>`)
    .replace('</style>', `${LOOK}</style>`)
    .replace('<body>', '<body><div id="err"></div>')
    .replace('<script>', `<script nonce="${nonce}">${SHIM(kind)}\n`)
    .replace(/<script>/g, `<script nonce="${nonce}">`);
}

export const miniCsp = (nonce) => [
  "default-src 'none'", `script-src 'nonce-${nonce}' https://telegram.org`, "style-src 'unsafe-inline'",
  "img-src 'self' data:", "connect-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors https://web.telegram.org https://*.telegram.org",
].join('; ');
