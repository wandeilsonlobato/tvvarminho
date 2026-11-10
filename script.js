'use strict';
/* =========================================================
   TV VARMINHO — sempre com você.
   ========================================================= */

/* ---------- utilidades ---------- */
const $ = s => document.querySelector(s);
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sem armazenamento */ } }
};
const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const LOGO = '<svg class="logo" viewBox="0 0 536 536" aria-hidden="true"><use href="#logo"/></svg>';

/* Ciclo de vida de um canal: tudo que ele cria é limpo ao trocar de canal */
function Life() {
  const touts = [], ints = [], fns = [];
  let alive = true, rafId = 0;
  return {
    get alive() { return alive; },
    timeout(f, ms) { const id = setTimeout(() => { if (alive) f(); }, ms); touts.push(id); return id; },
    interval(f, ms) { const id = setInterval(() => { if (alive) f(); }, ms); ints.push(id); return id; },
    raf(f) { const loop = ts => { if (!alive) return; f(ts); rafId = requestAnimationFrame(loop); }; rafId = requestAnimationFrame(loop); },
    sleep(ms) { return new Promise(r => this.timeout(r, ms)); },
    add(fn) { if (typeof fn === 'function') fns.push(fn); },
    kill() {
      alive = false; touts.forEach(clearTimeout); ints.forEach(clearInterval); cancelAnimationFrame(rafId);
      fns.forEach(f => { try { f(); } catch (e) { /* ok */ } });
    }
  };
}

/* ---------- áudio (WebAudio, tudo sintetizado) ---------- */
const Sound = {
  ctx: null, master: null, noise: null,
  vol: Math.max(0, Math.min(10, +store.get('tvv-vol', 6) || 6)), muted: false,
  init() {
    if (this.ctx) { this.ctx.resume && this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    this.ctx = new C();
    this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2, b = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = b.getChannelData(0);
    for (let k = 0; k < len; k++) d[k] = Math.random() * 2 - 1;
    this.noise = b; this.apply();
  },
  level() { return this.muted ? 0 : this.vol / 10; },
  apply() { if (this.master) this.master.gain.setTargetAtTime(this.level() * 0.6, this.ctx.currentTime, 0.02); },
  noiseSrc() { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; return s; },
  static(dur = 0.35, lvl = 0.4) {
    if (!this.ctx) return;
    const s = this.noiseSrc(), g = this.ctx.createGain(), t = this.ctx.currentTime;
    g.gain.setValueAtTime(lvl, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(g).connect(this.master); s.start(t); s.stop(t + dur + 0.05);
  },
  staticLoop(lvl = 0.1) {
    if (!this.ctx) return () => {};
    const s = this.noiseSrc(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    f.type = 'highpass'; f.frequency.value = 800; g.gain.value = lvl;
    s.connect(f).connect(g).connect(this.master); s.start();
    return () => { try { s.stop(); } catch (e) { /* ok */ } g.disconnect(); };
  },
  tone(freq, dur = 0.2, type = 'square', lvl = 0.15, when = 0, detune = 0) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(), t = this.ctx.currentTime + when;
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lvl, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  },
  hum() {
    if (!this.ctx) return () => {};
    const g = this.ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(0.16, this.ctx.currentTime, 1.5);
    const os = [55, 110.7, 166.1].map((f, k) => { const o = this.ctx.createOscillator(); o.type = k ? 'sine' : 'sawtooth'; o.frequency.value = f; o.connect(g); o.start(); return o; });
    const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain(); lfo.frequency.value = 0.33; lg.gain.value = 0.07;
    lfo.connect(lg).connect(g.gain); lfo.start(); g.connect(this.master);
    return () => { [...os, lfo].forEach(o => { try { o.stop(); } catch (e) { /* ok */ } }); g.disconnect(); };
  },
  babble(base = 115) {
    if (!this.ctx) return { talk() {}, stop() {} };
    const o = this.ctx.createOscillator(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = base; f.type = 'bandpass'; f.Q.value = 6; f.frequency.value = 700; g.gain.value = 0;
    o.connect(f).connect(g).connect(this.master); o.start();
    let on = false;
    const id = setInterval(() => {
      const t = this.ctx.currentTime;
      if (on && Math.random() > 0.18) {
        f.frequency.setTargetAtTime(rand(300, 2200), t, 0.02);
        o.frequency.setTargetAtTime(rand(base * 0.85, base * 1.25), t, 0.05);
        g.gain.setTargetAtTime(rand(0.08, 0.22), t, 0.01);
      } else g.gain.setTargetAtTime(0, t, 0.02);
    }, 90);
    return { talk(v) { on = v; }, stop() { clearInterval(id); try { o.stop(); } catch (e) { /* ok */ } g.disconnect(); } };
  },
  crowd() {
    if (!this.ctx) return () => {};
    const s = this.noiseSrc(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = 0.6; g.gain.value = 0.05;
    s.connect(f).connect(g).connect(this.master); s.start();
    return () => { try { s.stop(); } catch (e) { /* ok */ } g.disconnect(); };
  },
  whistle() { for (let i = 0; i < 4; i++) this.tone(i % 2 ? 3100 : 2850, 0.08, 'sine', 0.07, i * 0.08); },
  splat() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.noiseSrc(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    f.type = 'lowpass'; f.frequency.value = 380; g.gain.setValueAtTime(0.8, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    s.connect(f).connect(g).connect(this.master); s.start(t); s.stop(t + 0.8);
    const o = this.ctx.createOscillator(), og = this.ctx.createGain();
    o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.5);
    og.gain.setValueAtTime(0.3, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(og).connect(this.master); o.start(t); o.stop(t + 0.55);
  },
  boom() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, s = this.noiseSrc(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    f.type = 'lowpass'; f.frequency.value = 220; g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    s.connect(f).connect(g).connect(this.master); s.start(t); s.stop(t + 1.5);
  }
};

/* ---------- voz sintetizada do navegador ---------- */
const TTS = {
  voice: null, ok: 'speechSynthesis' in window,
  init() {
    if (!this.ok) return;
    const choose = () => {
      const vs = speechSynthesis.getVoices();
      this.voice = vs.find(v => /pt[-_]BR/i.test(v.lang)) || vs.find(v => /^pt/i.test(v.lang)) || null;
    };
    choose(); speechSynthesis.onvoiceschanged = choose;
  },
  say(text, { rate = 1, pitch = 0.6, cancel = false } = {}) {
    if (!this.ok || Sound.level() === 0) return;
    if (cancel) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pt-BR'; if (this.voice) u.voice = this.voice;
    u.rate = rate; u.pitch = pitch; u.volume = Math.min(1, Sound.level() * 1.2);
    speechSynthesis.speak(u);
  },
  stop() { if (this.ok) speechSynthesis.cancel(); }
};

/* ---------- elementos ---------- */
const screenEl = $('#screen'), content = $('#content'), scene = $('#scene'), staticCv = $('#static');
const osd = $('#osd'), overlay = $('#overlay'), sub = $('#subliminal'), clockEl = $('#clock');
const volbar = $('#volbar'), led = $('#led'), ir = $('#ir');

/* ---------- estado ---------- */
const S = {
  on: false, ready: false, session: 0, life: null,
  current: null, queue: [], chamadoBlocks: 0, forced333: false,
  name: store.get('tvv-nome', ''), overlay: null
};

/* ---------- programação: uma única emissora, sem grade fixa ---------- */
const PROGRAMS = {
  comunicacao: { title: 'COMUNICAÇÃO', dur: 100000, mount: mountComunicacao,
    info: 'Telejornal com William Bonantos. Notícias de Varminho, previsão do tempo e o quadro "Quem Ainda Está Assistindo?".' },
  emissao: { title: 'EMISSÃO VOCÊ', dur: 70000, mount: mountEmissao,
    info: 'Culinária com Joana Traga e seu fiel companheiro, Ruivo Zezé.' },
  atividade: { title: 'ATIVIDADE FÍSICA', dur: 50000, mount: mountAtividade,
    info: 'Transmissão esportiva ao vivo. AAA contra ZZZ. As regras podem mudar durante a partida.' },
  raposinha: { title: 'BASEBALL abcdefghjklmpqrtuvwxyz', dur: 31500, mount: mountRaposinha,
    info: 'Desenho animado. Raposinha defende as bolas de beisebol da Terra contra ameaças espaciais.' },
  ginzu: { title: 'INTERVALO COMERCIAL', mount: mountGinzu, info: 'Uma mensagem de nossos patrocinadores.' },
  bumper: { title: '', mount: mountBumper, info: '' },
  chamado: { title: '', mount: mountChamado, info: '' }
};
const ROTATION = ['comunicacao', 'emissao', 'atividade', 'raposinha'];
function shuffled(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}
function peekNext() {
  if (!S.queue.length) {
    S.queue = shuffled(ROTATION);
    if (S.queue[0] === S.current) S.queue.push(S.queue.shift());
  }
  return S.queue[0];
}
function takeNext() { peekNext(); return S.queue.shift(); }

/* ---------- chiado (só na hora de ligar e nos cortes) ---------- */
const sctx = staticCv.getContext('2d');
const simg = sctx.createImageData(200, 150);
let staticVisible = false, staticT = 0;
function drawStatic() {
  const d = simg.data;
  for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255 | 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  sctx.putImageData(simg, 0, 0);
  const y = (performance.now() / 8) % 180 - 20;
  sctx.fillStyle = 'rgba(255,255,255,.09)'; sctx.fillRect(0, y, 200, 14);
}
(function staticLoop() { if (staticVisible) drawStatic(); requestAnimationFrame(staticLoop); })();
function setStatic(v) { staticVisible = v; staticCv.classList.toggle('show', v); }
function flashStatic(ms = 300) {
  setStatic(true); Sound.static(ms / 1000 + 0.05, 0.3);
  clearTimeout(staticT); staticT = setTimeout(() => setStatic(false), ms);
}

/* ---------- OSD / volume / overlays ---------- */
let osdT = 0, volT = 0, infoT = 0;
function showOSD(html, ms = 2500, cls = '') {
  osd.className = 'osd show ' + cls; osd.innerHTML = html;
  clearTimeout(osdT); osdT = setTimeout(() => osd.classList.remove('show'), ms);
}
function showVol() {
  volbar.innerHTML = `<label>${Sound.muted ? 'MUDO' : 'VOL'}</label>` +
    Array.from({ length: 10 }, (_, k) => `<i class="${!Sound.muted && k < Sound.vol ? 'on' : ''}"></i>`).join('');
  volbar.classList.add('show');
  clearTimeout(volT); volT = setTimeout(() => volbar.classList.remove('show'), 1800);
}
function openOverlay(html, name) { overlay.innerHTML = html; overlay.className = 'overlay show'; S.overlay = name; }
function closeOverlay() { overlay.innerHTML = ''; overlay.className = 'overlay'; S.overlay = null; clearTimeout(infoT); }

function nowTitle() {
  const k = S.current;
  if (k === 'chamado') return '████████████';
  if (k === 'ginzu') return 'INTERVALO COMERCIAL';
  if (k === 'bumper' || !k) return 'VINHETA';
  return PROGRAMS[k].title;
}
function renderGuide() {
  const nx = PROGRAMS[peekNext()].title;
  openOverlay(`<div class="guide"><h2>PROGRAMAÇÃO · TV VARMINHO</h2><p class="sub">sujeita a alteração sem aviso</p>
    <div class="row cur"><span class="h">AGORA</span><span class="t">${esc(nowTitle())}</span></div>
    <div class="row"><span class="h">A SEGUIR</span><span class="t">${esc(nx)}</span></div>
    <div class="row"><span class="h">DEPOIS</span><span class="t">ELE DECIDE</span></div>
    <div class="row"><span class="h">03:33</span><span class="t">████████████</span></div>
    <p class="foot">NÃO HÁ GRADE FIXA. HÁ APENAS O SINAL.</p></div>`, 'guide');
}
function toggleGuide() { if (S.overlay === 'guide') closeOverlay(); else renderGuide(); }

function showInfo() {
  const k = S.current;
  let html;
  if (k === 'chamado') html = `<b>████████</b>Você já sabe o que é.<small>Classificação: para quem entende.</small>`;
  else if (!k || k === 'bumper') html = `<b>TV VARMINHO</b>Sempre com você.<small>Transmitindo da Torre, em Varminho.</small>`;
  else html = `<b>${esc(nowTitle())}</b>${esc(PROGRAMS[k].info)}<small>Classificação: livre para todos os espectadores dignos.</small>`;
  openOverlay(`<div class="info">${html}</div>`, 'info');
  infoT = setTimeout(() => { if (S.overlay === 'info') closeOverlay(); }, 5000);
}

/* ---------- transmissão ---------- */
function killScene() {
  if (S.life) { S.life.kill(); S.life = null; }
  TTS.stop(); setStatic(false);
}
function mountKey(key, opts = {}) {
  killScene();
  const life = S.life = Life();
  scene.innerHTML = '';
  scene.className = 'scene p-' + key;
  PROGRAMS[key].mount(scene, life, opts);
  return life;
}
function afterChange() { if (S.overlay === 'guide') renderGuide(); if (S.overlay === 'info') closeOverlay(); }

function playProgram(key) {
  S.current = key;
  const life = mountKey(key);
  flashStatic(140);
  showOSD(`<small>${esc(PROGRAMS[key].title)}</small>`, 3500);
  life.timeout(playBreak, PROGRAMS[key].dur);
  afterChange();
}
function playBreak() {
  S.current = 'ginzu';
  flashStatic(140);
  mountKey('ginzu', { onEnd: playBumper });
  showOSD('<small>INTERVALO</small>', 1800);
  afterChange();
}
function playBumper() {
  const nx = takeNext();
  S.current = 'bumper';
  mountKey('bumper', { next: nx, onEnd: () => playProgram(nx) });
  afterChange();
}
function playChamado(isOver) {
  S.current = 'chamado';
  const life = mountKey('chamado');
  flashStatic(300);
  life.interval(() => { if (isOver()) playBumper(); }, 1000);
  afterChange();
}
function startBroadcast() { playProgram(S.queue.length ? takeNext() : 'comunicacao'); }

/* vídeos na tela seguem o volume do controle */
function syncMedia() {
  scene.querySelectorAll('video').forEach(v => { v.volume = Math.min(1, Sound.level()); v.muted = Sound.level() === 0; });
}
function vol(d) {
  Sound.muted = false;
  Sound.vol = Math.max(0, Math.min(10, Sound.vol + d));
  store.set('tvv-vol', Sound.vol); Sound.apply(); showVol(); syncMedia();
  if (Sound.vol === 0) TTS.stop();
}
function mute() { Sound.muted = !Sound.muted; Sound.apply(); showVol(); syncMedia(); if (Sound.muted) TTS.stop(); }

/* ---------- ligar / desligar ---------- */
function vinheta(done) {
  killScene();
  const life = S.life = Life();
  scene.className = 'scene';
  scene.innerHTML = `<div class="vinheta">${LOGO}<div class="vin-title">TV VARMINHO</div><div class="vin-tag">sempre com você</div></div>`;
  [523, 659, 784, 1047].forEach((f, k) => Sound.tone(f, 0.5, 'triangle', 0.12, k * 0.18));
  Sound.tone(1108, 1.1, 'sine', 0.06, 0.8, -35);
  life.timeout(done, 3300);
}

function askName(done) {
  const sess = S.session;
  openOverlay(`<form class="ask" autocomplete="off"><h2>BOA NOITE, TELESPECTADOR.</h2>
    <p>Para melhor atendê-lo, a TV Varminho gostaria de saber o seu nome.</p>
    <input maxlength="24" aria-label="Seu nome" spellcheck="false">
    <div class="ask-btns"><button type="submit">CONFIRMAR</button><button type="button" class="skip">prefiro não dizer</button></div></form>`, 'ask');
  const f = overlay.querySelector('form'), inp = f.querySelector('input');
  setTimeout(() => inp.focus(), 60);
  const finish = n => {
    if (sess !== S.session) return;
    S.name = n; store.set('tvv-nome', n);
    overlay.innerHTML = `<div class="ask"><h2>OBRIGADO, ${esc(n)}.</h2><p>Nós já sabíamos.</p></div>`;
    Sound.tone(220, 0.8, 'sine', 0.1);
    setTimeout(() => { if (sess !== S.session) return; closeOverlay(); done(); }, 2000);
  };
  f.addEventListener('submit', e => { e.preventDefault(); finish(inp.value.trim().toUpperCase() || 'VOCÊ'); });
  f.querySelector('.skip').addEventListener('click', () => finish('VOCÊ'));
}

function powerOn() {
  Sound.init(); TTS.init();
  S.on = true; S.ready = false;
  const sess = ++S.session;
  led.classList.add('on');
  screenEl.classList.remove('off', 'off-anim');
  screenEl.classList.add('on-anim');
  setTimeout(() => screenEl.classList.remove('on-anim'), 650);
  Sound.tone(60, 0.5, 'sine', 0.25);
  setStatic(true); Sound.static(0.7, 0.3);
  setTimeout(() => {
    if (sess !== S.session) return;
    setStatic(false);
    vinheta(() => {
      const go = () => {
        if (sess !== S.session) return;
        S.ready = true;
        screenEl.classList.add('is-live');
        if (new URLSearchParams(location.search).has('333')) { const t0 = Date.now(); playChamado(() => Date.now() - t0 > 60000); }
        else if (isThreeThirtyThree()) { S.forced333 = true; playChamado(() => !isThreeThirtyThree()); }
        else startBroadcast();
      };
      if (S.name) go(); else askName(go);
    });
  }, 700);
}

function powerOff() {
  S.on = false; S.ready = false; S.session++;
  killScene(); closeOverlay();
  S.current = null;
  document.body.classList.remove('chamado');
  led.classList.remove('on');
  screenEl.classList.remove('is-live');
  screenEl.classList.add('off-anim');
  Sound.tone(900, 0.15, 'sine', 0.08);
  setTimeout(() => {
    if (S.on) return;
    screenEl.classList.remove('off-anim'); screenEl.classList.add('off');
    scene.innerHTML = '';
  }, 430);
}
function power() {
  if (S.on && S.current === 'chamado' && S.chamadoBlocks > 0) {
    S.chamadoBlocks--;
    showOSD('<small>NÃO DESVIE O OLHAR.</small>', 1800, 'center warn');
    Sound.tone(110, 0.4, 'sawtooth', 0.15);
    return;
  }
  if (S.on) powerOff(); else powerOn();
}

/* ---------- controle remoto e teclado ---------- */
function act(a) {
  ir.classList.add('blink'); setTimeout(() => ir.classList.remove('blink'), 90);
  if (a === 'power') return power();
  if (!S.on || !S.ready || S.overlay === 'ask') return;
  switch (a) {
    case 'volup': vol(1); break;
    case 'voldn': vol(-1); break;
    case 'mute': mute(); break;
    case 'guide': toggleGuide(); break;
    case 'info': if (S.overlay === 'info') closeOverlay(); else showInfo(); break;
    case 'esc': if (S.overlay) closeOverlay(); break;
  }
}
document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => act(b.dataset.act)));
$('#tvPower').addEventListener('click', power);

const KEYS = { ArrowUp: 'volup', ArrowRight: 'volup', ArrowDown: 'voldn', ArrowLeft: 'voldn', p: 'power', m: 'mute', g: 'guide', i: 'info', Escape: 'esc' };
addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input,textarea')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const a = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (!a) return;
  e.preventDefault();
  const btn = document.querySelector(`.remote [data-act="${a}"]`);
  if (btn) { btn.classList.add('pressed'); setTimeout(() => btn.classList.remove('pressed'), 120); }
  act(a);
});

/* ---------- relógio, 3h33 e subliminares ---------- */
function isThreeThirtyThree() { const d = new Date(); return d.getHours() === 3 && d.getMinutes() === 33; }
function tickClock() {
  const d = new Date();
  const eerie = S.on && Math.random() < 0.03;
  clockEl.textContent = eerie ? '03:33' : pad(d.getHours()) + ':' + pad(d.getMinutes());
  clockEl.classList.toggle('eerie', eerie);
  if (isThreeThirtyThree()) {
    if (S.on && S.ready && !S.forced333 && S.current !== 'chamado') {
      S.forced333 = true;
      playChamado(() => !isThreeThirtyThree());
      showOSD('<small>SINAL PRIORITÁRIO</small>', 2500, 'center');
    }
  } else S.forced333 = false;
}
tickClock(); setInterval(tickClock, 1000);

function subliminals() {
  const nome = esc(S.name || 'VOCÊ');
  return ['VOCÊ ENTENDEU O SINAL?', `${nome}, VOCÊ AINDA ESTÁ ASSISTINDO?`, 'DARA ALICE VENTURINI<br>DESAPARECIDA',
    'VENHA CONHECER<br>NOSSOS ESTÚDIOS', '6º ANDAR', 'NÃO DESLIGUE', 'ELE ESTÁ AQUI', LOGO];
}
function flashSub() {
  sub.innerHTML = pick(subliminals());
  sub.className = 'subliminal show' + (Math.random() < 0.4 ? ' inv' : '');
  setTimeout(() => { sub.className = 'subliminal'; }, 90);
}
(function schedSub() {
  setTimeout(() => {
    if (S.on && S.ready && !reduced && S.current !== 'chamado' && !S.overlay) flashSub();
    schedSub();
  }, rand(18000, 50000));
})();

/* =========================================================
   PROGRAMAS
   Cada programa é a imagem original da transmissão (img/programas/),
   parada, com a câmera passeando devagar para os lados. O som continua.
   ========================================================= */
function shot(el, file, cls = '') {
  el.innerHTML = `<div class="shot ${cls}"><img src="img/programas/${file}" alt="" draggable="false"></div>`;
  return el.querySelector('.shot');
}

/* ---------- COMUNICAÇÃO ---------- */
const VIEWERS = ['BENEDITO ARAÚJO', 'CARLA MENDES', 'DARA ALICE VENTURINI', 'EDIMEIA SOARES', 'ERIBERTO VIAMÃO', 'FÁTIMA ROCHA',
  'GUILHERME SANTOS', 'HELENA DUARTE', 'IVONE CASTRO', 'JERSON DA SILVA', 'LUDISMILA SOARES', 'MORATO VERTALER',
  'NATÁLIA PIRES', 'OTÁVIO LIMA', 'REGINA CRUZES', 'SEBASTIÃO MOURA', 'TEREZA ALVES', 'VICENTE SANTOS', 'ZÉLIA RAMOS'];

/* Reportagem que o jornal exibe (img/programas/guizo.mp4) */
function playReport(el, life, file) {
  return new Promise(resolve => {
    const box = document.createElement('div');
    box.className = 'report';
    box.innerHTML = `<video src="img/programas/${file}" playsinline preload="auto"></video>`;
    el.appendChild(box);
    const v = box.querySelector('video');
    const done = () => { if (!box.isConnected) return; v.pause(); box.remove(); resolve(); };
    life.add(() => { v.pause(); v.removeAttribute('src'); v.load(); box.remove(); });
    v.addEventListener('ended', () => { flashStatic(140); done(); });
    v.addEventListener('error', done);
    syncMedia();
    v.play().catch(() => { v.muted = true; v.play().catch(done); });
  });
}

function mountComunicacao(el, life) {
  shot(el, 'comunicacao.webp');
  // William Bonantos fala, mas ninguém entende o que ele diz
  const voice = Sound.babble(); life.add(() => voice.stop());
  (async () => {
    await life.sleep(800);
    while (life.alive) {
      voice.talk(true); await life.sleep(rand(7000, 9000));
      voice.talk(false); await life.sleep(800);
      // o jornal chama a reportagem
      flashStatic(140);
      await playReport(el, life, 'guizo.mp4');
      if (!life.alive) return;
      voice.talk(true); await life.sleep(rand(4000, 6000));
      voice.talk(false); await life.sleep(1500);
      // quadro fixo: "Quem Ainda Está Assistindo?"
      TTS.say('quem ainda está assistindo?', { rate: 0.8, pitch: 0.3 });
      await life.sleep(2600);
      const me = S.name || 'VOCÊ';
      const names = [...new Set([...VIEWERS, me])].sort((a, b) => a.localeCompare(b, 'pt'));
      for (const nm of names) {
        if (!life.alive) return;
        const isMe = nm === me;
        TTS.say(nm.toLowerCase(), { rate: isMe ? 0.7 : 1.05, pitch: isMe ? 0.3 : 0.5 });
        await life.sleep(isMe ? 3800 : 1200);
      }
      TTS.say(`obrigado por continuar assistindo, ${me.toLowerCase()}.`, { rate: 0.85, pitch: 0.4 });
      await life.sleep(4500);
    }
  })();
}

/* ---------- EMISSÃO VOCÊ ---------- */
const JOANA_LINES = [
  'Bom diaaa, meu querido! Bom dia, minha querida!',
  'Hoje no Emissão Você a gente vai fazer um macarrão muito especial.',
  'Zezé, dá bom dia pro pessoal!',
  '[silêncio]',
  'Ele tá tímido hoje. Ele tá sempre tímido.',
  'Primeiro a gente separa os ingredientes. Bem fresquinhos.',
  'Os olhinhos dão textura, viu? Não precisa ter medo.',
  'Hmm... tá ótimo. Tá... ótimo.'
];
function mountEmissao(el, life) {
  shot(el, 'emissao.webp');
  (async () => {
    await life.sleep(700);
    while (life.alive) {
      for (const line of JOANA_LINES) {
        if (!life.alive) return;
        if (!line.startsWith('[')) TTS.say(line, { rate: 1.08, pitch: 1.5 });
        await life.sleep(Math.max(3000, line.length * 75));
      }
      await life.sleep(2500);
    }
  })();
}

/* ---------- ATIVIDADE FÍSICA ---------- */
function mountAtividade(el, life) {
  shot(el, 'atividade.webp', 'top');
  const NARR = ['e ele chuta a bola', 'a outra bola também', 'o juiz marca tudo', 'gol talvez', 'que partida emocionante',
    'ninguém respira', 'os dois goleiros defendem a mesma trave', 'a torcida sorri', 'a regra mudou de novo'];
  life.interval(() => { TTS.say(pick(NARR), { rate: 0.75, pitch: 0.2 }); }, 6500);
  life.interval(() => { if (Math.random() < 0.4) Sound.whistle(); }, 9000);
  life.add(Sound.crowd());
}

/* ---------- BASEBALL abcdefghjklmpqrtuvwxyz ---------- */
function mountRaposinha(el, life) {
  shot(el, 'raposinha.webp');
  [523, 587, 659, 523, 784, 740, 523, 494].forEach((f, k) => Sound.tone(f, 0.15, 'square', 0.06, k * 0.17, rand(-40, 40)));
  life.timeout(() => TTS.say('No próximo episódio: Raposinha morre!', { rate: 1.1, pitch: 1.3 }), PROGRAMS.raposinha.dur - 6000);
}

/* ---------- INTERVALO: GINZU 8001 ---------- */
/* Quadros do comercial, na ordem da transmissão original.
   A faca e os itens (dedo, osso, olho, orelha) são camadas recortadas da
   imagem em alta (img/programas/ginzu/), que vão aparecendo uma a uma. */
const GINZU = [
  { cena: 'rapo', items: 0, cap: 'CANSADO DE SER ENGANADO<i>?!?!...</i>', fala: 'Cansado de ser enganado?!', ms: 2400 },
  { cena: 'zoom', items: 0, cap: 'AMEAÇADO OU MORTO<i>?!?!...</i>', fala: 'Ameaçado ou morto?!', ms: 2400 },
  { cena: 'faca', items: 0, cap: 'A NOVA <b>GUINZU 8001</b> É<br>PERFEITA PARA O COMBATE<i>!!</i>', fala: 'A nova Guinzu 8001 é perfeita para o combate!', ms: 3600 },
  { cena: 'faca', items: 1, cap: 'ELA É CAPAZ DE CORTAR DEDOS<i>!!!</i>', fala: 'Ela é capaz de cortar dedos!', ms: 2400 },
  { cena: 'faca', items: 2, cap: 'FATIAR OSSOS<i>!!!</i>', fala: 'Fatiar ossos!', ms: 1800 },
  { cena: 'faca', items: 3, cap: 'PERFURAR OLHOS<i>!!</i>', fala: 'Perfurar olhos!', ms: 1800 },
  { cena: 'faca', items: 4, cap: 'MUTILAR ORELHAS<i>!!</i>', fala: 'Mutilar orelhas!', ms: 2600 }
];
const GINZU_ITEMS = ['dedo', 'osso', 'olho', 'orelha'];
function mountGinzu(el, life, opts = {}) {
  el.innerHTML = `<div class="shot gz">
      <div class="gz-cam">
        <img class="gz-rapo" src="img/programas/raposinha.webp" alt="" draggable="false">
        <img class="gz-faca" src="img/programas/ginzu/faca.webp" alt="" draggable="false">
        ${GINZU_ITEMS.map(k => `<img class="gz-item" data-k="${k}" src="img/programas/ginzu/${k}.webp" alt="" draggable="false">`).join('')}
      </div>
      <div class="gz-cap"></div>
    </div>`;
  const rapo = el.querySelector('.gz-rapo'), faca = el.querySelector('.gz-faca'), cap = el.querySelector('.gz-cap');
  const items = [...el.querySelectorAll('.gz-item')];
  (async () => {
    do {
      for (const q of GINZU) {
        if (!life.alive) return;
        const isRapo = q.cena !== 'faca';
        rapo.classList.toggle('on', isRapo);
        rapo.classList.toggle('zoom', q.cena === 'zoom');
        faca.classList.toggle('on', !isRapo);
        items.forEach((im, i) => im.classList.toggle('on', !isRapo && i < q.items));
        cap.innerHTML = q.cap;
        Sound.tone(pick([196, 220, 247]), 0.15, 'square', 0.1);
        TTS.say(q.fala, { rate: 1.25, pitch: 0.5, cancel: true });
        await life.sleep(q.ms);
      }
      await life.sleep(800);
      if (opts.onEnd && life.alive) { opts.onEnd(); return; }
    } while (life.alive);
  })();
}

/* ---------- vinheta "A SEGUIR" ---------- */
function mountBumper(el, life, opts) {
  el.innerHTML = `<div class="vinheta bumper">${LOGO}<div class="b-label">A SEGUIR</div><div class="b-title">${esc(PROGRAMS[opts.next].title)}</div></div>`;
  [784, 659, 523].forEach((f, k) => Sound.tone(f, 0.35, 'triangle', 0.1, k * 0.15));
  life.timeout(opts.onEnd, 3000);
}

/* ---------- O CHAMADO (03:33) ---------- */
function mountChamado(el, life) {
  el.innerHTML = `<div class="shot chamado-shot"><img src="img/programas/chamado.webp" alt="" draggable="false"><div class="tint"></div></div>`;
  document.body.classList.add('chamado'); life.add(() => document.body.classList.remove('chamado'));
  S.chamadoBlocks = 1;
  life.add(Sound.hum());
}
