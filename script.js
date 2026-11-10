'use strict';
/* =========================================================
   TV VARMINHO — somos todos um.
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

/* ---------- áudio ----------
   O único som da emissora é a fala sem nexo do apresentador do jornal
   (o vídeo do Guizo toca com o próprio áudio). */
const Sound = {
  ctx: null, master: null,
  vol: Math.max(0, Math.min(10, +store.get('tvv-vol', 6) || 6)), muted: false,
  init() {
    if (this.ctx) { this.ctx.resume && this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    this.ctx = new C();
    this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    this.apply();
  },
  level() { return this.muted ? 0 : this.vol / 10; },
  apply() { if (this.master) this.master.gain.setTargetAtTime(this.level() * 0.6, this.ctx.currentTime, 0.02); },
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
  }
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
  comunicacao: { title: 'COMUNICAÇÃO', dur: 66000, mount: mountComunicacao,
    info: 'Telejornal com William Bonantos. Pessoas desaparecidas, previsão do tempo e reportagens.' },
  emissao: { title: 'EMISSÃO VOCÊ', dur: 68000, mount: mountEmissao,
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
  setStatic(true);
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
  else if (!k || k === 'bumper') html = `<b>TV VARMINHO</b>Somos todos um.<small>Transmitindo da Torre, em Varminho.</small>`;
  else html = `<b>${esc(nowTitle())}</b>${esc(PROGRAMS[k].info)}<small>Classificação: livre para todos os espectadores dignos.</small>`;
  openOverlay(`<div class="info">${html}</div>`, 'info');
  infoT = setTimeout(() => { if (S.overlay === 'info') closeOverlay(); }, 5000);
}

/* ---------- transmissão ---------- */
function killScene() {
  if (S.life) { S.life.kill(); S.life = null; } setStatic(false);
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
}
function mute() { Sound.muted = !Sound.muted; Sound.apply(); showVol(); syncMedia(); }

/* ---------- ligar / desligar ---------- */
function vinheta(done) {
  killScene();
  const life = S.life = Life();
  scene.className = 'scene';
  scene.innerHTML = `<div class="vinheta">${LOGO}<div class="vin-title">TV VARMINHO</div><div class="vin-tag">somos todos um</div></div>`;
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
    setTimeout(() => { if (sess !== S.session) return; closeOverlay(); done(); }, 2000);
  };
  f.addEventListener('submit', e => { e.preventDefault(); finish(inp.value.trim().toUpperCase() || 'VOCÊ'); });
  f.querySelector('.skip').addEventListener('click', () => finish('VOCÊ'));
}

function powerOn() {
  Sound.init();
  S.on = true; S.ready = false;
  const sess = ++S.session;
  led.classList.add('on');
  screenEl.classList.remove('off', 'off-anim');
  screenEl.classList.add('on-anim');
  setTimeout(() => screenEl.classList.remove('on-anim'), 650);
  setStatic(true);
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

/* Sequência de quadros: todas as imagens empilhadas, a câmera passeia
   continuamente e os cortes só trocam qual imagem está no ar. */
function frames(el, files, cls = '') {
  el.innerHTML = `<div class="shot seq ${cls}">
      ${files.map(f => `<img src="img/programas/${f}" alt="" draggable="false">`).join('')}
      <div class="legenda"></div>
    </div>`;
  const imgs = [...el.querySelectorAll('.seq img')], cap = el.querySelector('.legenda');
  return {
    imgs,
    show(i, text = '') { imgs.forEach((im, k) => im.classList.toggle('on', k === i)); cap.innerHTML = text; }
  };
}

/* ---------- COMUNICAÇÃO ---------- */
/* Pessoas desaparecidas: o letreiro do rodapé lista todos os nomes;
   quem tiver foto aparece no quadro ao lado do apresentador.
   Para incluir uma foto: salve em img/programas/desaparecidos/ e preencha "foto". */
const DESAPARECIDOS = [
  { nome: '', foto: 'desaparecidos/garota.webp' },
  { nome: 'DARA ALICE VENTURINI' }, { nome: 'VICENTE SANTOS' }, { nome: 'JERSON DA SILVA' },
  { nome: 'MORATO VERTALER' }, { nome: 'EDIMEIA SOARES' }, { nome: 'ERIBERTO VIAMÃO' },
  { nome: 'LUDISMILA SOARES' }, { nome: 'REGINA CRUZES' }, { nome: 'RAUL CRUZES' }, { nome: 'JOHN NOBLE' }
];

/* Reportagem que o jornal exibe (img/programas/guizo.mp4) — único vídeo com som */
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
  const f = frames(el, ['comunicacao.webp', 'previsao.webp']);
  const comFoto = DESAPARECIDOS.filter(p => p.foto);
  const nomes = DESAPARECIDOS.filter(p => p.nome).map(p => p.nome);
  el.querySelector('.seq').insertAdjacentHTML('beforeend', `
    <div class="sumido"><img alt=""><b></b><span>DESAPARECIDA</span></div>
    <div class="tempo-tit">PREVISÃO DO TEMPO · VARMINHO</div>
    <div class="letreiro"><span class="tag">DESAPARECIDOS</span><div class="corre"><span>${nomes.join(' &nbsp;•&nbsp; ')} &nbsp;•&nbsp; </span></div></div>`);
  const card = el.querySelector('.sumido'), seq = el.querySelector('.seq');
  // William Bonantos fala, mas ninguém entende o que ele diz (o único som além do vídeo)
  const voice = Sound.babble(); life.add(() => voice.stop());
  let n = 0;
  const showCard = () => {
    if (!comFoto.length) return;
    const p = comFoto[n++ % comFoto.length];
    card.querySelector('img').src = 'img/programas/' + p.foto;
    card.querySelector('b').textContent = p.nome || '';
    card.querySelector('span').textContent = p.genero === 'm' ? 'DESAPARECIDO' : 'DESAPARECIDA';
    card.classList.add('on');
  };
  (async () => {
    await life.sleep(600);
    while (life.alive) {
      // apresentador + foto de desaparecida
      f.show(0); seq.classList.remove('tempo');
      voice.talk(true); await life.sleep(1200);
      showCard(); await life.sleep(7500);
      card.classList.remove('on'); await life.sleep(800);
      // previsão do tempo (ele continua falando por cima)
      f.show(1); seq.classList.add('tempo'); await life.sleep(8000);
      f.show(0); seq.classList.remove('tempo'); await life.sleep(3500);
      voice.talk(false); await life.sleep(700);
      // reportagem
      flashStatic(140);
      seq.classList.add('video');
      await playReport(el, life, 'guizo.mp4');
      if (!life.alive) return;
      seq.classList.remove('video');
      voice.talk(true); await life.sleep(rand(5000, 7000));
      voice.talk(false); await life.sleep(1200);
    }
  })();
}

/* ---------- EMISSÃO VOCÊ ---------- */
function mountEmissao(el, life) {
  const f = frames(el, ['emissao.webp', 'emissao/rosto.webp', 'emissao/passando-mal.webp',
    'emissao/panela.webp', 'emissao/pratos.webp', 'emissao/pratos-garota.webp']);
  const garota = f.imgs[5];
  const pisca = ms => { garota.classList.add('on'); life.timeout(() => garota.classList.remove('on'), ms); };
  const ROTEIRO = [
    [0, '', 9000],
    [1, '', 3500],
    [0, '', 3000],
    [2, '', 6000],
    [3, 'ESSES SÃO OS INGREDIENTES<br>DA NOSSA RECEITA<i>!!!</i>', 5000],
    [4, 'HUMMM<i>!!</i>... ESPERO QUE GOSTEM<i>!!...</i>', 7000]
  ];
  (async () => {
    await life.sleep(300);
    while (life.alive) {
      for (const [i, txt, ms] of ROTEIRO) {
        if (!life.alive) return;
        f.show(i, txt);
        if (i === 4) {
          // do nada, a foto da garota pisca no mesmo lugar
          life.timeout(() => pisca(rand(120, 220)), rand(1500, 3000));
          if (Math.random() < 0.6) life.timeout(() => pisca(rand(80, 160)), rand(4200, 6200));
        }
        await life.sleep(ms);
      }
    }
  })();
}

/* ---------- ATIVIDADE FÍSICA ---------- */
function mountAtividade(el) { shot(el, 'atividade.webp', 'top'); }

/* ---------- BASEBALL abcdefghjklmpqrtuvwxyz ---------- */
function mountRaposinha(el) { shot(el, 'raposinha.webp'); }

/* ---------- INTERVALO: GINZU 8001 ---------- */
/* Quadros do comercial, na ordem da transmissão original.
   A faca e os itens (dedo, osso, olho, orelha) são camadas recortadas da
   imagem em alta (img/programas/ginzu/), que vão aparecendo uma a uma. */
const GINZU = [
  { cena: 'rapo', items: 0, cap: 'CANSADO DE SER ENGANADO<i>?!?!...</i>', ms: 2400 },
  { cena: 'zoom', items: 0, cap: 'AMEAÇADO OU MORTO<i>?!?!...</i>', ms: 2400 },
  { cena: 'faca', items: 0, cap: 'A NOVA <b>GUINZU 8001</b> É<br>PERFEITA PARA O COMBATE<i>!!</i>', ms: 3600 },
  { cena: 'faca', items: 1, cap: 'ELA É CAPAZ DE CORTAR DEDOS<i>!!!</i>', ms: 2400 },
  { cena: 'faca', items: 2, cap: 'FATIAR OSSOS<i>!!!</i>', ms: 1800 },
  { cena: 'faca', items: 3, cap: 'PERFURAR OLHOS<i>!!</i>', ms: 1800 },
  { cena: 'faca', items: 4, cap: 'MUTILAR ORELHAS<i>!!</i>', ms: 2600 }
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
  life.timeout(opts.onEnd, 3000);
}

/* ---------- O CHAMADO (03:33) ---------- */
function mountChamado(el, life) {
  el.innerHTML = `<div class="shot chamado-shot"><img src="img/programas/chamado.webp" alt="" draggable="false"><div class="tint"></div></div>`;
  document.body.classList.add('chamado'); life.add(() => document.body.classList.remove('chamado'));
  S.chamadoBlocks = 1;
}
