// Spark: the assistant's face. A warm glowing drop with eyes that shows what the assistant does.
// Usage: <mf-spark state="thinking" size="40"></mf-spark>, or el.setState('done').
// States: idle (breathes, blinks), thinking, working, done, error, waiting. Size 24 to 160 px.
// Colors can be changed with CSS variables on the element: --spark-acc, --spark-soft, --spark-ink.
// No libraries; respects prefers-reduced-motion.
(() => {
  if (customElements.get('mf-spark')) return;
  const STATES = ['idle', 'thinking', 'working', 'done', 'error', 'waiting'];
  let uid = 0;

  const CSS = `
:host { display: inline-block; width: var(--s, 40px); height: var(--s, 40px); flex: none; vertical-align: middle; line-height: 0;
  --acc: var(--spark-acc, #e2602b); --soft: var(--spark-soft, #fbe6da); --ink: var(--spark-ink, #141414); --ok: var(--spark-ok, #1f9d55); }
svg { width: 100%; height: 100%; overflow: visible; display: block; }
svg * { transform-box: fill-box; transform-origin: center; }
.all, .breath { transform-box: view-box; transform-origin: 50% 88%; }
.all { transition: transform .5s cubic-bezier(.2,.8,.2,1); }
.breath { animation: breath 3.4s ease-in-out infinite; }
@keyframes breath { 50% { transform: scale(1.03, .98); } }
.glow { animation: glow 3.4s ease-in-out infinite; }
@keyframes glow { 50% { opacity: .55; transform: scale(1.06); } }
.eye { transition: transform .09s ease; }
:host(.blink) .eye { transform: scaleY(.12); }
.look { transition: transform .4s ease; }
.fx, .happy { opacity: 0; transition: opacity .3s ease; }
.eyes { transition: opacity .2s; }
.core { transition: filter .4s; }
/* thinking */
:host([state=thinking]) .fx-think { opacity: 1; }
:host([state=thinking]) .look { transform: translate(3px, -3px); }
.fx-think circle { animation: dot 1.1s infinite ease-in-out; }
.fx-think circle:nth-child(2) { animation-delay: .15s; } .fx-think circle:nth-child(3) { animation-delay: .3s; }
@keyframes dot { 50% { transform: translateY(-3px); opacity: .35; } }
/* working */
:host([state=working]) .fx-work { opacity: 1; }
:host([state=working]) .all { animation: bob .9s ease-in-out infinite; }
:host([state=working]) .glow { animation-duration: .9s; }
@keyframes bob { 50% { transform: translateY(-2px) rotate(-2deg); } }
.orbit { transform-box: view-box; transform-origin: 50px 58px; animation: spin 2.2s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
/* done */
:host([state=done]) .fx-done, :host([state=done]) .happy { opacity: 1; }
:host([state=done]) .eyes { opacity: 0; }
:host([state=done]) .all { animation: jump 1.2s cubic-bezier(.3,.7,.3,1) 2; }
:host([state=done]) .glow { animation-duration: .6s; }
@keyframes jump { 0%, 60%, 100% { transform: none; } 15% { transform: scale(1.06, .92); } 35% { transform: translateY(-9px) scale(.97, 1.04); } }
.sp { animation: tw 1.2s ease-in-out infinite; }
.sp:nth-child(2) { animation-delay: .3s; } .sp:nth-child(3) { animation-delay: .6s; }
@keyframes tw { 0%, 100% { transform: scale(.4); opacity: .2; } 50% { transform: scale(1.1); opacity: 1; } }
/* error */
:host([state=error]) .fx-error { opacity: 1; }
:host([state=error]) .all { transform: rotate(-8deg); }
:host([state=error]) .look { transform: translate(-3px, 1px); }
:host([state=error]) .core { filter: saturate(.35) brightness(1.05); }
.fx-error { animation: wob 1.6s ease-in-out infinite; }
@keyframes wob { 50% { transform: rotate(10deg); } }
/* waiting */
:host([state=waiting]) .fx-wait { opacity: 1; }
:host([state=waiting]) .all { transform: translateY(-2px) scale(1.04); }
.ring { animation: ring 1.6s ease-out infinite; }
.ring:nth-child(2) { animation-delay: .8s; }
@keyframes ring { 0% { transform: scale(.7); opacity: .7; } 100% { transform: scale(1.35); opacity: 0; } }
/* tiny sizes: no side effects, only the face and the glow */
:host(.xs) .fx-think, :host(.xs) .fx-done, :host(.xs) .fx-error, :host(.xs) .shadow { display: none; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }`;

  const svg = (id) => `<svg viewBox="0 0 100 100" aria-hidden="true">
  <defs>
    <radialGradient id="${id}a" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fff6ee"/><stop offset=".45" style="stop-color:var(--soft)"/><stop offset="1" style="stop-color:var(--acc)"/></radialGradient>
    <radialGradient id="${id}b"><stop offset=".55" style="stop-color:var(--acc)" stop-opacity=".35"/><stop offset="1" style="stop-color:var(--acc)" stop-opacity="0"/></radialGradient>
  </defs>
  <ellipse class="shadow" cx="50" cy="93" rx="16" ry="3" style="fill:var(--acc)" opacity=".15"/>
  <circle class="glow" cx="50" cy="56" r="44" fill="url(#${id}b)"/>
  <g class="fx fx-wait"><circle class="ring" cx="50" cy="58" r="30" fill="none" style="stroke:var(--acc)" stroke-width="2.5"/><circle class="ring" cx="50" cy="58" r="30" fill="none" style="stroke:var(--acc)" stroke-width="2.5"/></g>
  <g class="all"><g class="breath">
    <path class="core" d="M50 20 q22 22 22 38 a22 22 0 0 1 -44 0 q0 -16 22 -38z" fill="url(#${id}a)"/>
    <path d="M38 50 q2 -8 8 -12" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity=".7"/>
    <g class="look">
      <g class="eyes"><ellipse class="eye" cx="43" cy="60" rx="3.8" ry="5.2" style="fill:var(--ink)"/><ellipse class="eye" cx="57" cy="60" rx="3.8" ry="5.2" style="fill:var(--ink)"/></g>
      <g class="happy" style="stroke:var(--ink)" stroke-width="3.2" stroke-linecap="round" fill="none"><path d="M38.5 62 q4.5 -6 9 0"/><path d="M52.5 62 q4.5 -6 9 0"/></g>
    </g>
    <path d="M47 69 q3 2.5 6 0" style="stroke:var(--ink)" stroke-width="2.2" stroke-linecap="round" fill="none"/>
  </g></g>
  <g class="fx fx-think" style="fill:var(--ink)"><circle cx="68" cy="24" r="2.8"/><circle cx="75" cy="24" r="2.8"/><circle cx="82" cy="24" r="2.8"/></g>
  <g class="fx fx-work"><g class="orbit"><circle cx="50" cy="20" r="3.4" style="fill:var(--acc)"/><circle cx="83" cy="66" r="2.8" style="fill:var(--ok)"/><circle cx="18" cy="70" r="2.4" style="fill:var(--acc)"/></g></g>
  <g class="fx fx-done"><path class="sp" d="M14 26 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" style="fill:var(--acc)"/><path class="sp" d="M84 20 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6z" style="fill:var(--ok)"/><path class="sp" d="M88 54 l1.3 3.2 3.2 1.3 -3.2 1.3 -1.3 3.2 -1.3 -3.2 -3.2 -1.3 3.2 -1.3z" style="fill:var(--acc)"/></g>
  <g class="fx fx-error"><text x="70" y="30" font-family="system-ui, sans-serif" font-weight="800" font-size="22" style="fill:var(--acc)">?</text></g>
</svg>`;

  class Spark extends HTMLElement {
    static get observedAttributes() { return ['size', 'state']; }
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${CSS}</style>${svg(`spk${++uid}`)}`;
    }
    connectedCallback() {
      if (!this.hasAttribute('state')) this.setAttribute('state', 'idle');
      this.applySize();
      this.setAttribute('role', 'img');
      if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', 'Помощник');
      const blink = () => {
        if (!this.isConnected) return;
        this.classList.add('blink');
        setTimeout(() => this.classList.remove('blink'), 140);
        this.timer = setTimeout(blink, 2400 + Math.random() * 3600);
      };
      this.timer = setTimeout(blink, 600 + Math.random() * 2400);
    }
    disconnectedCallback() { clearTimeout(this.timer); }
    attributeChangedCallback(name) { if (name === 'size') this.applySize(); }
    applySize() {
      const s = Math.max(24, Math.min(160, Number(this.getAttribute('size')) || 40));
      this.style.setProperty('--s', `${s}px`);
      this.classList.toggle('xs', s < 34);
    }
    setState(name) { this.setAttribute('state', STATES.includes(name) ? name : 'idle'); return this; }
    get state() { return this.getAttribute('state') || 'idle'; }
  }
  customElements.define('mf-spark', Spark);
  window.MFSpark = { STATES, html: (state = 'idle', size = 40, extra = '') => `<mf-spark state="${state}" size="${size}" ${extra}></mf-spark>` };
})();
