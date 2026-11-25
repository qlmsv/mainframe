// Spark: the assistant's face. Vega, a glowing star that shows what the assistant does.
// Usage: <mf-spark state="thinking" size="40"></mf-spark>, or el.setState('done').
// States: idle (breathes, twinkles), thinking, working, done, error, waiting. Size 24 to 160 px.
// Colors can be changed with CSS variables on the element: --spark-acc, --spark-soft, --spark-ink.
// No libraries; respects prefers-reduced-motion.
(() => {
  if (customElements.get('mf-spark')) return;
  const STATES = ['idle', 'thinking', 'working', 'done', 'error', 'waiting'];
  let uid = 0;

  const CSS = `
:host { display: inline-block; width: var(--s, 40px); height: var(--s, 40px); flex: none; vertical-align: middle; line-height: 0;
  --acc: var(--spark-acc, #e2602b); --soft: var(--spark-soft, #f08a55); --ink: var(--spark-ink, #f6a77c); --ok: var(--spark-ok, #1f9d55); }
svg { width: 100%; height: 100%; overflow: visible; display: block; }
svg * { transform-box: fill-box; transform-origin: center; }
.all, .spin, .rays, .orbit { transform-box: view-box; transform-origin: 50px 50px; }
.all { transition: transform .5s cubic-bezier(.2,.8,.2,1); }
.spin { animation: breath 3.4s ease-in-out infinite; }
@keyframes breath { 50% { transform: scale(.95); } }
.rays { transform: rotate(45deg); }
.glow { animation: glow 3.4s ease-in-out infinite; }
@keyframes glow { 50% { opacity: .55; transform: scale(1.08); } }
:host(.blink) .spin { transform: scale(1.1, .8); }
.fx { opacity: 0; transition: opacity .3s ease; }
.core { transition: filter .4s; }
/* thinking: turns slowly, three dots */
:host([state=thinking]) .fx-think { opacity: 1; }
:host([state=thinking]) .spin { animation: turn 2.4s ease-in-out infinite; }
@keyframes turn { 0% { transform: rotate(0) scale(.96); } 50% { transform: rotate(45deg) scale(.9); } 100% { transform: rotate(90deg) scale(.96); } }
.fx-think circle { animation: dot 1.1s infinite ease-in-out; }
.fx-think circle:nth-child(2) { animation-delay: .15s; } .fx-think circle:nth-child(3) { animation-delay: .3s; }
@keyframes dot { 50% { transform: translateY(-3px); opacity: .35; } }
/* working: spins fast, sparks around */
:host([state=working]) .fx-work { opacity: 1; }
:host([state=working]) .spin { animation: whirl 1s linear infinite; }
@keyframes whirl { 0% { transform: rotate(0) scale(1); } 50% { transform: rotate(45deg) scale(1.08); } 100% { transform: rotate(90deg) scale(1); } }
:host([state=working]) .glow { animation-duration: .9s; }
.orbit { animation: spinr 2.2s linear infinite; }
@keyframes spinr { to { transform: rotate(360deg); } }
/* done: bursts with light */
:host([state=done]) .fx-done { opacity: 1; }
:host([state=done]) .all { animation: pop 1.2s cubic-bezier(.3,.7,.3,1) 2; }
:host([state=done]) .glow { animation-duration: .6s; }
@keyframes pop { 0%, 70%, 100% { transform: scale(1); } 20% { transform: scale(.82); } 42% { transform: scale(1.16); } }
.sp { animation: tw 1.2s ease-in-out infinite; }
.sp:nth-child(2) { animation-delay: .3s; } .sp:nth-child(3) { animation-delay: .6s; }
@keyframes tw { 0%, 100% { transform: scale(.4); opacity: .2; } 50% { transform: scale(1.1); opacity: 1; } }
/* error: dims and leans, question mark */
:host([state=error]) .fx-error { opacity: 1; }
:host([state=error]) .all { transform: rotate(-10deg) scale(.86); }
:host([state=error]) .core { filter: saturate(.3) brightness(.85); }
.fx-error { animation: wob 1.6s ease-in-out infinite; }
@keyframes wob { 50% { transform: rotate(10deg); } }
/* waiting: steady light, soft rings */
:host([state=waiting]) .fx-wait { opacity: 1; }
.ring { animation: ring 1.6s ease-out infinite; }
.ring:nth-child(2) { animation-delay: .8s; }
@keyframes ring { 0% { transform: scale(.5); opacity: .8; } 100% { transform: scale(1.35); opacity: 0; } }
/* tiny sizes: no side effects, only the star and the glow */
:host(.xs) .fx-think, :host(.xs) .fx-done, :host(.xs) .fx-error { display: none; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }`;

  const svg = (id) => `<svg viewBox="0 0 100 100" aria-hidden="true">
  <defs>
    <radialGradient id="${id}g"><stop offset="0" style="stop-color:var(--acc)" stop-opacity=".55"/><stop offset=".5" style="stop-color:var(--acc)" stop-opacity=".16"/><stop offset="1" style="stop-color:var(--acc)" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}c"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#fff1e6"/><stop offset="1" style="stop-color:var(--soft)"/></radialGradient>
  </defs>
  <circle class="glow" cx="50" cy="50" r="46" fill="url(#${id}g)"/>
  <g class="fx fx-wait"><circle class="ring" cx="50" cy="50" r="34" fill="none" style="stroke:var(--acc)" stroke-width="2.5"/><circle class="ring" cx="50" cy="50" r="34" fill="none" style="stroke:var(--acc)" stroke-width="2.5"/></g>
  <g class="all"><g class="spin">
    <path class="rays" d="M50 25 52.8 47.2 75 50 52.8 52.8 50 75 47.2 52.8 25 50 47.2 47.2z" style="fill:var(--ink)" opacity=".6"/>
    <path class="core" d="M50 10C52 38 55 45 90 50C55 55 52 62 50 90C48 62 45 55 10 50C45 45 48 38 50 10z" fill="url(#${id}c)"/>
    <circle cx="50" cy="50" r="7" fill="#fff"/>
  </g></g>
  <g class="fx fx-think" style="fill:var(--ink)"><circle cx="72" cy="14" r="3.2"/><circle cx="81" cy="14" r="3.2"/><circle cx="90" cy="14" r="3.2"/></g>
  <g class="fx fx-work"><g class="orbit"><circle cx="50" cy="3" r="3.4" fill="#ffb020"/><circle cx="93" cy="62" r="2.8" style="fill:var(--ok)"/><circle cx="9" cy="72" r="2.4" style="fill:var(--acc)"/></g></g>
  <g class="fx fx-done"><path class="sp" d="M10 12 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill="#ffb020"/><path class="sp" d="M88 8 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6z" style="fill:var(--ok)"/><path class="sp" d="M90 80 l1.3 3.2 3.2 1.3 -3.2 1.3 -1.3 3.2 -1.3 -3.2 -3.2 -1.3 3.2 -1.3z" style="fill:var(--acc)"/></g>
  <g class="fx fx-error"><text x="74" y="22" font-family="system-ui, sans-serif" font-weight="800" font-size="22" fill="#d9302a">?</text></g>
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
