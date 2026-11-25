// Spark: the assistant's face. Некит, a little cat that shows what the assistant does ("не кот, не кит").
// Usage: <mf-spark state="thinking" size="40"></mf-spark>, or el.setState('done').
// States: idle (breathes, blinks, tail sways), thinking, working, done, error, waiting. Size 24 to 160 px.
// Below 34 px only the head is drawn, so the cat stays readable. Glow color: --spark-acc; dots: --spark-ink.
// No libraries; respects prefers-reduced-motion.
(() => {
  if (customElements.get('mf-spark')) return;
  const STATES = ['idle', 'thinking', 'working', 'done', 'error', 'waiting'];
  let uid = 0;

  const CSS = `
:host { display: inline-block; width: var(--s, 40px); height: var(--s, 40px); flex: none; vertical-align: middle; line-height: 0;
  --acc: var(--spark-acc, #e2602b); --ink: var(--spark-ink, #f6a77c); }
svg { width: 100%; height: 100%; overflow: visible; display: block; }
svg * { transform-box: fill-box; transform-origin: center; }
.all, .hpos { transform-box: view-box; transform-origin: 0 0; }
.hpos { transform: translate(50px, 44px) scale(.84) translate(-50px, -50px); transition: transform .4s; }
.glow { animation: glow 3.4s ease-in-out infinite; }
@keyframes glow { 50% { opacity: .55; transform: scale(1.06); } }
.torso { animation: breath 3.4s ease-in-out infinite; }
@keyframes breath { 50% { transform: scale(1.04, .97); } }
.head { transition: transform .4s; }
.tail { transform-origin: 10% 80%; animation: sway 3s ease-in-out infinite; }
@keyframes sway { 50% { transform: rotate(-14deg); } }
.ear { transition: transform .35s; }
.ear.el { transform-origin: 85% 90%; } .ear.er { transform-origin: 15% 90%; }
.eyes { transition: opacity .2s; } .eh, .ee { opacity: 0; }
.look { transition: transform .3s; }
.eo { transition: transform .1s; }
:host(.blink) .eo { transform: scaleY(.12); }
.blush { opacity: .4; transition: opacity .3s; }
.fx { opacity: 0; transition: opacity .3s ease; }
/* thinking: eyes up, paw at the chin, three dots */
:host([state=thinking]) .fx-think { opacity: 1; }
:host([state=thinking]) .look { transform: translate(2px, -3px); }
:host([state=thinking]) .head { transform: rotate(-6deg); }
:host([state=thinking]) .pr { opacity: 0; }
.dots circle { animation: dot 1.1s infinite ease-in-out; }
.dots circle:nth-child(2) { animation-delay: .15s; } .dots circle:nth-child(3) { animation-delay: .3s; }
@keyframes dot { 50% { transform: translateY(-3px); opacity: .35; } }
/* working: taps the keys with both paws */
:host([state=working]) .fx-work { opacity: 1; }
:host([state=working]) .look { transform: translateY(2.5px); }
:host([state=working]) .pl { animation: tap .36s ease-in-out infinite; }
:host([state=working]) .pr { animation: tap .36s ease-in-out -.18s infinite; }
@keyframes tap { 50% { transform: translateY(-4px); } }
:host([state=working]) .head { animation: nod .72s ease-in-out infinite; }
@keyframes nod { 50% { transform: translateY(1.5px); } }
/* done: happy arcs for eyes, bounces, tail up, sparkles */
:host([state=done]) .eo { opacity: 0; } :host([state=done]) .eh { opacity: 1; }
:host([state=done]) .fx-done { opacity: 1; }
:host([state=done]) .all { animation: hop 1s cubic-bezier(.3,.7,.3,1) 2; }
@keyframes hop { 0%, 70%, 100% { transform: translateY(0); } 35% { transform: translateY(-7px); } }
:host([state=done]) .tail { animation-duration: .5s; }
.sp { animation: tw 1.2s ease-in-out infinite; }
.sp:nth-child(2) { animation-delay: .3s; } .sp:nth-child(3) { animation-delay: .6s; }
@keyframes tw { 0%, 100% { transform: scale(.4); opacity: .2; } 50% { transform: scale(1.1); opacity: 1; } }
/* error: shy, ears pressed down, looks down, blushes, a drop of sweat */
:host([state=error]) .fx-error { opacity: 1; }
:host([state=error]) .ear.el { transform: rotate(-42deg); } :host([state=error]) .ear.er { transform: rotate(42deg); }
:host([state=error]) .eo { opacity: 0; } :host([state=error]) .ee { opacity: 1; }
:host([state=error]) .blush { opacity: .85; }
:host([state=error]) .head { transform: translateY(2px) rotate(4deg); }
:host([state=error]) .tail { animation: none; transform: rotate(30deg); }
/* waiting: looks at you, blinks slowly, head tilted */
:host([state=waiting]) .head { transform: rotate(8deg); }
:host([state=waiting]) .eo { animation: slow 3s ease-in-out infinite; }
@keyframes slow { 0%, 60%, 100% { transform: scaleY(1); } 70%, 78% { transform: scaleY(.12); } }
:host([state=waiting]) .tail { animation-duration: 1.8s; }
/* tiny sizes: only the head, a bit bigger */
:host(.xs) .bodyg, :host(.xs) .fx-think, :host(.xs) .fx-done, :host(.xs) .fx-error { display: none; }
:host(.xs) .hpos { transform: translate(50px, 54px) scale(1.12) translate(-50px, -50px); }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }`;

  const svg = (id) => `<svg viewBox="0 0 100 100" aria-hidden="true">
  <defs>
    <radialGradient id="${id}g"><stop offset="0" style="stop-color:var(--acc)" stop-opacity=".5"/><stop offset=".55" style="stop-color:var(--acc)" stop-opacity=".14"/><stop offset="1" style="stop-color:var(--acc)" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}f" cx="38%" cy="30%" r="80%"><stop offset="0" stop-color="#ffc79c"/><stop offset=".55" stop-color="#f39256"/><stop offset="1" stop-color="#d9602a"/></radialGradient>
  </defs>
  <circle class="glow" cx="50" cy="52" r="46" fill="url(#${id}g)"/>
  <g class="all">
    <g class="bodyg">
      <path class="tail" d="M64 90C80 95 90 86 87 72C86 67 82 65 80 67" fill="none" stroke="url(#${id}f)" stroke-width="7" stroke-linecap="round"/>
      <ellipse class="torso" cx="50" cy="83" rx="20" ry="14" fill="url(#${id}f)"/>
      <ellipse cx="50" cy="87" rx="10" ry="8.5" fill="#fff1e6"/>
      <g class="fx fx-work"><rect x="27" y="92" width="46" height="7" rx="2.5" fill="#3a3d44"/><path d="M32 95.5h4M39 95.5h4M46 95.5h8M57 95.5h4M64 95.5h4" stroke="#6b6f78" stroke-width="1.6" stroke-linecap="round"/></g>
      <ellipse class="paw pl" cx="41" cy="94" rx="6" ry="4.2" fill="#ffe0c8"/>
      <ellipse class="paw pr" cx="59" cy="94" rx="6" ry="4.2" fill="#ffe0c8"/>
    </g>
    <g class="hpos"><g class="head">
      <g class="ear el"><path d="M21 44Q18 22 24 12Q27 9 31 12L47 27Z" fill="url(#${id}f)"/><path d="M27 35Q26 24 28 18L39 28Z" fill="#ffb4a2"/></g>
      <g class="ear er"><path d="M79 44Q82 22 76 12Q73 9 69 12L53 27Z" fill="url(#${id}f)"/><path d="M73 35Q74 24 72 18L61 28Z" fill="#ffb4a2"/></g>
      <ellipse class="face" cx="50" cy="52" rx="32" ry="27" fill="url(#${id}f)"/>
      <path d="M50 26v7M43 27l1.6 5.6M57 27l-1.6 5.6" stroke="#c4541f" stroke-width="2.6" stroke-linecap="round"/>
      <ellipse cx="50" cy="65" rx="12.5" ry="8.5" fill="#fff1e6"/>
      <g class="blush"><ellipse cx="31" cy="62" rx="4.5" ry="2.6" fill="#ff6f6f"/><ellipse cx="69" cy="62" rx="4.5" ry="2.6" fill="#ff6f6f"/></g>
      <g class="eyes eo"><g class="look"><ellipse cx="38.5" cy="52" rx="5" ry="6.4" fill="#1b1410"/><ellipse cx="61.5" cy="52" rx="5" ry="6.4" fill="#1b1410"/><circle cx="40.3" cy="49.6" r="1.9" fill="#fff"/><circle cx="63.3" cy="49.6" r="1.9" fill="#fff"/></g></g>
      <path class="eyes eh" d="M33 54Q38.5 46 44 54M56 54Q61.5 46 67 54" fill="none" stroke="#1b1410" stroke-width="3.2" stroke-linecap="round"/>
      <path class="eyes ee" d="M33.5 53Q38.5 57 43.5 53M56.5 53Q61.5 57 66.5 53" fill="none" stroke="#1b1410" stroke-width="3" stroke-linecap="round"/>
      <path d="M46.6 60.5h6.8q.6 0 .2.6l-3 3.2q-.6.6-1.2 0l-3-3.2q-.4-.6.2-.6z" fill="#ff7d86"/>
      <path class="mouth" d="M44.5 66q2.7 3 5.5.2q2.8 2.8 5.5-.2" stroke="#1b1410" stroke-width="1.8" stroke-linecap="round" fill="none"/>
      <path d="M28 60 13 57M28 65 13 66M72 60 87 57M72 65 87 66" stroke="#fff1e6" stroke-width="1.6" stroke-linecap="round" opacity=".85"/>
      <path class="fx fx-error" d="M80 30q-4 6 0 8q4-2 0-8z" fill="#8fd3ff"/>
    </g></g>
    <ellipse class="fx fx-think chin" cx="62" cy="73" rx="6" ry="4.6" fill="#ffe0c8"/>
  </g>
  <g class="fx fx-think dots" style="fill:var(--ink)"><circle cx="76" cy="12" r="3.2"/><circle cx="85" cy="12" r="3.2"/><circle cx="94" cy="12" r="3.2"/></g>
  <g class="fx fx-done"><path class="sp" d="M10 14 l2.2 5.5 5.5 2.2 -5.5 2.2 -2.2 5.5 -2.2 -5.5 -5.5 -2.2 5.5 -2.2z" fill="#ffb020"/><path class="sp" d="M90 10 l1.8 4.5 4.5 1.8 -4.5 1.8 -1.8 4.5 -1.8 -4.5 -4.5 -1.8 4.5 -1.8z" fill="#1f9d55"/><path class="sp" d="M92 78 l1.5 3.8 3.8 1.5 -3.8 1.5 -1.5 3.8 -1.5 -3.8 -3.8 -1.5 3.8 -1.5z" fill="#f6a77c"/></g>
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
