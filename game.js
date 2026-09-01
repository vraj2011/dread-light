(function () {
  const strip = document.getElementById('blood-strip');
  if (!strip) return;
  const n = Math.floor(window.innerWidth / 16) + 2;
  for (let i = 0; i < n; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'drip';
    const bh = 1 + Math.random() * 18;
    const tw = 3 + Math.random() * 9;
    const th = 6 + Math.random() * 16;
    const op = (0.35 + Math.random() * 0.55).toFixed(2);
    wrap.innerHTML =
      `<div class="drip-body" style="height:${bh.toFixed(1)}px;opacity:${op}"></div>` +
      (Math.random() > 0.4
        ? `<div class="drip-tip" style="width:${tw.toFixed(1)}px;height:${th.toFixed(1)}px;opacity:${op}"></div>`
        : '');
    strip.appendChild(wrap);
  }
})();

let audioCtx;
let lives = 2;
let gameActive = false;
let currentLevel = 1;
let mouseX, mouseY, cx, cy;
let creatures = [];
let levelConfig = null;
let animId = null;
let lastTime = 0;
let ambientNodes = null;
let heartbeatTO = null;
let currentHeartbeatSource = null;
let successSoundNode = null;

const audioCache = {};
const preloadedBuffers = {};
const audioUrls = {
  ambient: 'audio/ambient.mp3',
  heartbeat: 'audio/heartbeat.mp3',
  creature: 'audio/creature.mp3',
  jumpscare: 'audio/jumpscare.mp3',
  success: 'audio/success.mp3'
};

let audioLoadPromise = null;
function loadAudioFiles() {
  const promises = Object.keys(audioUrls).map(async key => {
    try {
      const r = await fetch(audioUrls[key] + '?t=' + Date.now());
      if (r.ok) {
        preloadedBuffers[key] = await r.arrayBuffer();
      }
    } catch(e) { console.error('Audio load error:', e); }
  });
  return Promise.all(promises);
}
audioLoadPromise = loadAudioFiles();
const BEAM_REACH = 380, BEAM_HALF = 14 * Math.PI / 180;
const DETECT_HALF = 12 * Math.PI / 180;
const CREATURE_CLOSE = 120;
let currentAimNeeded = 0.75;

const darkC = document.getElementById('darkness');
const dCtx = darkC.getContext('2d');
const scoreEl = document.getElementById('scoreVal');
const livesEl = document.getElementById('livesContainer');
const startScr = document.getElementById('startScreen');
const overScr = document.getElementById('gameOver');
const jumpEl = document.getElementById('jumpscare');
const finalEl = document.getElementById('finalScore');
const interScr = document.getElementById('intermissionScreen');
const interTxt = document.getElementById('intermissionText');

function resize() {
  darkC.width = window.innerWidth;
  darkC.height = window.innerHeight;
  cx = window.innerWidth / 2;
  cy = window.innerHeight / 2;
  mouseX = mouseX || cx;
  mouseY = mouseY || cy;
}
window.addEventListener('resize', resize);
resize();

const GHOST_NAMES = ['', 'THE CRAWLER', 'SHADOW WRAITH', 'THE BANSHEE', 'THE PENITENT', 'THE DOLL', 'THE JESTER', 'THE DROWNED'];

const GHOST_MSGS = [
  '',
  'it crawled right up to you.',
  'you never even saw it.',
  'her scream was the last thing you heard.',
  'your sins finally caught up.',
  'she just wanted to play.',
  'everyone floats down here.',
  'she never left the water.',
];

const GHOST_LOOK = {
  1: { filter: 'contrast(2.2) brightness(0.4) saturate(0)',                       glow: 'rgba(150,150,150,.6)', border: '#333333', nameCol: '#999999' },
  2: { filter: 'contrast(2.4) brightness(0.22) saturate(0) grayscale(1)',         glow: 'rgba(15,15,15,.9)',    border: '#222222', nameCol: '#888888' },
  3: { filter: 'contrast(1.8) brightness(0.5) saturate(1.4) hue-rotate(90deg)',  glow: 'rgba(20,180,20,.6)',   border: '#104a10', nameCol: '#44bb44' },
  4: { filter: 'contrast(1.6) brightness(0.55) saturate(0.8) sepia(0.5)',        glow: 'rgba(200,170,80,.6)',  border: '#5a4a10', nameCol: '#ccaa44' },
  5: { filter: 'contrast(2.0) brightness(0.45) saturate(0.3) hue-rotate(340deg)',glow: 'rgba(200,50,50,.7)',   border: '#6a1010', nameCol: '#cc3030' },
  6: { filter: 'contrast(1.5) brightness(0.5) saturate(1.8) hue-rotate(180deg)', glow: 'rgba(0,150,180,.7)',   border: '#0a4a5a', nameCol: '#33aacc' },
  7: { filter: 'contrast(1.9) brightness(0.35) saturate(1.2) hue-rotate(200deg)',glow: 'rgba(40,80,180,.7)',   border: '#1a2a6a', nameCol: '#5577dd' },
};

const TOTAL_GHOSTS = GHOST_NAMES.length - 1;
const NIGHTS = TOTAL_GHOSTS;
const NIGHT_NAMES = ['night one', 'night two', 'night three', 'night four', 'night five', 'night six', 'the final night'];

function getLevelConfig(level) {
  let night = Math.ceil(level / 8);
  if (night > NIGHTS) night = NIGHTS;

  let ghostPool = night;
  if (ghostPool > TOTAL_GHOSTS) ghostPool = TOTAL_GHOSTS;

  const pos = (level - 1) % 8;

  const nightSpeeds = [
    { base: 50,   step: 16 },
    { base: 128,  step: 20 },
    { base: 240,  step: 28 },
    { base: 380,  step: 38 },
    { base: 560,  step: 50 },
    { base: 810,  step: 64 },
    { base: 1140, step: 84 },
  ];

  const nightGhosts = [
    [1, 1, 1, 1, 1, 1, 1, 2],
    [2, 2, 2, 2, 2, 2, 2, 3],
    [2, 2, 3, 3, 3, 3, 3, 3],
    [3, 3, 3, 3, 3, 3, 4, 4],
    [3, 3, 4, 4, 4, 4, 4, 5],
    [4, 4, 4, 4, 5, 5, 5, 5],
    [4, 5, 5, 5, 5, 6, 6, 7],
  ];

  const nightAim = [
    [0.80, 0.80, 0.78, 0.78, 0.76, 0.76, 0.74, 0.72],
    [0.90, 0.90, 0.88, 0.88, 0.86, 0.86, 0.84, 0.82],
    [1.00, 1.00, 0.98, 0.96, 0.94, 0.92, 0.90, 0.88],
    [1.05, 1.05, 1.03, 1.01, 0.99, 0.97, 0.95, 0.93],
    [1.15, 1.15, 1.13, 1.11, 1.09, 1.07, 1.05, 1.03],
    [1.30, 1.30, 1.28, 1.26, 1.24, 1.22, 1.20, 1.18],
    [1.50, 1.50, 1.48, 1.46, 1.44, 1.42, 1.40, 1.38],
  ];

  const ns = nightSpeeds[night - 1] || nightSpeeds[6];
  const speed = ns.base + pos * ns.step;

  const ghostCountTable = nightGhosts[night - 1] || nightGhosts[6];
  let ghostCount = ghostCountTable[pos];
  if (ghostCount > ghostPool) ghostCount = ghostPool;

  const aimTable = nightAim[night - 1] || nightAim[6];
  const aimWindow = aimTable[pos];

  return { night, ghostPool, ghostCount, speed, aimWindow };
}

function loadProgress() {
  try {
    const raw = localStorage.getItem('dreadlight_progress');
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object' && typeof p.highestUnlocked === 'number' && Array.isArray(p.completed)) {
        return p;
      }
    }
  } catch(e) {}
  return { highestUnlocked: 1, completed: [] };
}

function saveProgress() {
  localStorage.setItem('dreadlight_progress', JSON.stringify(progress));
}
let progress = loadProgress();


const caughtEl       = document.getElementById('ghost-caught');
const caughtImgEl    = document.getElementById('caught-ghost-img');
const caughtNameEl   = document.getElementById('caught-name');
const caughtCountEl  = document.getElementById('caught-countdown');

document.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });
document.addEventListener('touchmove', e => {
  e.preventDefault();
  if (e.touches[0]) { mouseX = e.touches[0].clientX; mouseY = e.touches[0].clientY; }
}, { passive: false });
document.addEventListener('touchstart', e => {
  if (e.touches[0]) { mouseX = e.touches[0].clientX; mouseY = e.touches[0].clientY; }
}, { passive: false });

function renderFlashlight() {
  const w = darkC.width, h = darkC.height;
  dCtx.clearRect(0, 0, w, h);
  dCtx.globalCompositeOperation = 'source-over';
  dCtx.fillStyle = 'rgba(0,0,0,0.58)';
  dCtx.fillRect(0, 0, w, h);
  dCtx.globalCompositeOperation = 'destination-out';

  const angle = Math.atan2(mouseY - cy, mouseX - cx);
  let flicker = 0;
  const aliveCreatures = creatures.filter(c => c.alive);
  if (aliveCreatures.length > 0) {
    const closestDist = Math.min(...aliveCreatures.map(c => c.dist));
    const prox = Math.max(0, 1 - closestDist / 200);
    flicker = prox * 0.12 * (Math.sin(performance.now() * 0.03) + Math.sin(performance.now() * 0.07) * 0.5);
  }
  const reach = BEAM_REACH * (1 - flicker);
  const half = BEAM_HALF * (1 + flicker * 0.3);

  dCtx.beginPath();
  dCtx.moveTo(cx, cy);
  dCtx.arc(cx, cy, reach, angle - half, angle + half);
  dCtx.closePath();

  const gr = dCtx.createRadialGradient(cx, cy, 8, cx, cy, reach);
  gr.addColorStop(0,    'rgba(255,252,220,1)');
  gr.addColorStop(0.2,  'rgba(255,235,160,1)');
  gr.addColorStop(0.55, 'rgba(245,200,100,0.88)');
  gr.addColorStop(0.78, 'rgba(220,160,50,0.55)');
  gr.addColorStop(0.92, 'rgba(180,110,20,0.2)');
  gr.addColorStop(1,    'rgba(140,70,0,0)');
  dCtx.fillStyle = gr;
  dCtx.fill();

  dCtx.beginPath();
  dCtx.arc(cx, cy, 150, 0, Math.PI * 2);
  const ag = dCtx.createRadialGradient(cx, cy, 0, cx, cy, 150);
  ag.addColorStop(0,    'rgba(255,245,185,1.0)');
  ag.addColorStop(0.4,  'rgba(245,200,100,0.55)');
  ag.addColorStop(0.75, 'rgba(210,145,30,0.2)');
  ag.addColorStop(1,    'rgba(170,90,0,0)');
  dCtx.fillStyle = ag;
  dCtx.fill();

  dCtx.globalCompositeOperation = 'source-over';
}

function spawnCreatures() {
  creatures = [];
  document.querySelectorAll('.ghost-reveal').forEach(e => e.remove());
  
  const cfg = levelConfig || getLevelConfig(currentLevel);
  const count = cfg.ghostCount;
  const pool = cfg.ghostPool;
  
  for (let i = 0; i < count; i++) {
    const ang = ((Math.PI * 2) / count) * i + (Math.random() * 0.5);
    const dist = 580 + (Math.random() * 370); // start them way off screen
    
    const revealEl = document.createElement('div');
    revealEl.className = 'ghost-reveal';
    revealEl.style.cssText = 'position:fixed;z-index:150;display:none;width:70px;height:70px;transform:translate(-50%,-50%);pointer-events:none;';
    
    const img = document.createElement('img');
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;filter:contrast(1.5) brightness(0.35);box-shadow:inset 0 0 20px rgba(0,0,0,0.8),0 0 20px rgba(180,0,0,0.4);';
    img.onerror = function() { this.onerror = null; this.src = 'images/jumpscare.jpg'; };
    
    const gType = 1 + Math.floor(Math.random() * pool);
    img.src = 'images/ghost_level_' + gType + '.jpg';
    revealEl.appendChild(img);
    document.body.appendChild(revealEl);
    
    creatures.push({
      x: Math.cos(ang) * dist, 
      y: Math.sin(ang) * dist,
      speed: cfg.speed,
      wanderAng: 0, 
      wanderT: 0, 
      speedBurst: 1,
      dist, 
      alive: true, 
      aimTime: 0,
      audio: createCreatureAudio(),
      revealEl,
      gType
    });
  }
  currentAimNeeded = cfg.aimWindow;
  scheduleHeartbeat();
}

function updateCreature(dt) {
  creatures.forEach(c => {
    if (!c.alive) return;
    c.wanderT -= dt;
    if (c.wanderT <= 0) {
      c.wanderT = 0.1 + Math.random() * 0.3;
      const maxAng = Math.min(0.8, 0.4 + currentLevel * 0.15) * Math.PI;
      c.wanderAng = (Math.random() - 0.5) * 2 * maxAng;
      c.speedBurst = 1.5 + Math.random() * (1 + currentLevel * 0.3);
    }
    const toPlayer = Math.atan2(-c.y, -c.x);
    const moveAng = toPlayer + c.wanderAng;
    const spd = c.speed * c.speedBurst;
    
    c.x += Math.cos(moveAng) * spd * dt;
    c.y += Math.sin(moveAng) * spd * dt;
    c.dist = Math.sqrt(c.x * c.x + c.y * c.y);
  });
}


function createCreatureAudio() {
  if (!audioCtx) return;
  const gain = audioCtx.createGain(); gain.gain.value = 0;
  const pan = audioCtx.createStereoPanner(); pan.pan.value = 0;
  gain.connect(pan); pan.connect(audioCtx.destination);

  if (audioCache.creature) {
    const s = audioCtx.createBufferSource();
    s.buffer = audioCache.creature;
    s.loop = true;
    s.connect(gain);
    s.start();
    return { gain, pan, oscs: [s], subs: [] };
  }

  const o1 = audioCtx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 75;
  const g1 = audioCtx.createGain(); g1.gain.value = 0.12;
  o1.connect(g1); g1.connect(gain); o1.start();

  const o2 = audioCtx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 32;
  const g2 = audioCtx.createGain(); g2.gain.value = 0.08;
  o2.connect(g2); g2.connect(gain); o2.start();

  const bufSz = audioCtx.sampleRate * 2;
  const nb = audioCtx.createBuffer(1, bufSz, audioCtx.sampleRate);
  const nd = nb.getChannelData(0);
  for (let i = 0; i < bufSz; i++) nd[i] = (Math.random() * 2 - 1);
  const ns = audioCtx.createBufferSource(); ns.buffer = nb; ns.loop = true;
  const flt = audioCtx.createBiquadFilter();
  flt.type = 'lowpass'; flt.frequency.value = 350; flt.Q.value = 2;
  const gn = audioCtx.createGain(); gn.gain.value = 0.04;
  ns.connect(flt); flt.connect(gn); gn.connect(gain); ns.start();

  const lfo = audioCtx.createOscillator(); lfo.frequency.value = 0.4;
  const lg = audioCtx.createGain(); lg.gain.value = 12;
  lfo.connect(lg); lg.connect(o1.frequency); lfo.start();

  const wail = audioCtx.createOscillator(); wail.type = 'triangle'; wail.frequency.value = 550;
  const wailGain = audioCtx.createGain(); wailGain.gain.value = 0;
  wail.connect(wailGain); wailGain.connect(gain); wail.start();
  const wLfo = audioCtx.createOscillator(); wLfo.frequency.value = 0.6;
  const wLfoGain = audioCtx.createGain(); wLfoGain.gain.value = 40;
  wLfo.connect(wLfoGain); wLfoGain.connect(wail.frequency); wLfo.start();

  return { gain, pan, oscs: [o1, o2, ns, lfo, wail, wLfo], subs: [g1, g2, gn, flt], wailGain };
}

function updateCreatureAudio() {
  const t = audioCtx.currentTime;
  creatures.forEach(c => {
    if (!c.alive || !c.audio) return;
    const maxD = 800;
    const volScale = audioCache.creature ? 1.0 : 0.35;
    const vol = Math.max(0, Math.min(volScale, (1 - c.dist / maxD) * volScale));
    c.audio.gain.gain.setTargetAtTime(vol, t, 0.08);
    const ang = Math.atan2(c.y, c.x);
    const panVal = Math.max(-1, Math.min(1, Math.sin(ang) * 1.3));
    c.audio.pan.pan.setTargetAtTime(panVal, t, 0.05);
    
    if (!audioCache.creature && c.audio.subs.length > 0) {
      const rumble = Math.max(0, 1 - c.dist / 300) * 0.2;
      c.audio.subs[1].gain.setTargetAtTime(rumble, t, 0.1);
      const freq = 350 + Math.max(0, 1 - c.dist / 400) * 600;
      c.audio.subs[3].frequency.setTargetAtTime(freq, t, 0.15);
      
      if (c.audio.wailGain) {
        const wailVol = Math.max(0, 1 - c.dist / 450) * 0.12 * Math.min(1, currentLevel / 3);
        c.audio.wailGain.gain.setTargetAtTime(wailVol, t, 0.2);
      }
    }
  });
}

function fadeCreatureAudio(c) {
  if (!c || !c.audio) return;
  const t = audioCtx.currentTime;
  c.audio.gain.gain.setTargetAtTime(0, t, 0.12);
  const ca = c.audio;
  c.audio = null;
  setTimeout(() => { ca.oscs.forEach(o => { try { o.stop(); } catch (e) { } }); }, 600);
}

function scheduleHeartbeat() {
  if (!gameActive || !audioCtx) return;
  const aliveCreatures = creatures.filter(c => c.alive);
  if (aliveCreatures.length === 0) return;
  
  const closestDist = Math.min(...aliveCreatures.map(c => c.dist));
  const maxD = 700;
  const intensity = Math.max(0, 1 - closestDist / maxD);
  if (intensity < 0.03) { heartbeatTO = setTimeout(scheduleHeartbeat, 1500); return; }
  const interval = 1100 - intensity * 800;
  const now = audioCtx.currentTime;

  if (audioCache.heartbeat) {
    const g = audioCtx.createGain();
    g.gain.value = intensity * 0.8;
    g.connect(audioCtx.destination);
    const s = audioCtx.createBufferSource();
    s.buffer = audioCache.heartbeat;
    s.playbackRate.value = 1.0 + (intensity * 0.3);
    s.connect(g);
    s.start(now);
    currentHeartbeatSource = s;
  } else {
    beatPulse(now, 55, intensity * 0.12, 0.12);
    beatPulse(now + 0.11, 42, intensity * 0.08, 0.09);
  }
  
  heartbeatTO = setTimeout(scheduleHeartbeat, Math.max(250, interval));
}

function stopHeartbeat() {
  clearTimeout(heartbeatTO);
  if (currentHeartbeatSource) {
    try { currentHeartbeatSource.stop(); } catch (e) {}
    currentHeartbeatSource = null;
  }
}

function beatPulse(t, freq, vol, dur) {
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(t); o.stop(t + dur + 0.01);
}

function startAmbient() {
  if (!audioCtx) return;
  if (ambientNodes) stopAmbient();
  const g = audioCtx.createGain(); 
  g.connect(audioCtx.destination);

  if (audioCache.ambient) {
    g.gain.value = 0.5;
    const s = audioCtx.createBufferSource();
    s.buffer = audioCache.ambient;
    s.loop = true;
    s.connect(g);
    s.start();
    ambientNodes = { g, o: s };
    return;
  }

  g.gain.value = 0.035;
  const o = audioCtx.createOscillator(); o.type = 'sine'; o.frequency.value = 42;
  o.connect(g); o.start();
  const lfo = audioCtx.createOscillator(); lfo.frequency.value = 0.25;
  const lg = audioCtx.createGain(); lg.gain.value = 6;
  lfo.connect(lg); lg.connect(o.frequency); lfo.start();
  ambientNodes = { g, o, lfo };
}

function stopAmbient() {
  if (!ambientNodes) return;
  try { ambientNodes.o.stop(); if(ambientNodes.lfo) ambientNodes.lfo.stop(); } catch (e) { }
  ambientNodes = null;
}

function stopSuccessSound() {
  if (!successSoundNode) return;
  try { successSoundNode.stop(); } catch(e) {}
  successSoundNode = null;
}

function playSuccessSound() {
  if (!audioCtx) return;
  stopSuccessSound();
  const t = audioCtx.currentTime;
  if (audioCache.success) {
    const s = audioCtx.createBufferSource();
    s.buffer = audioCache.success;
    s.connect(audioCtx.destination);
    s.start(t);
    successSoundNode = s;
    return;
  }
  const dur = 3.5;
  const master = audioCtx.createGain();
  master.connect(audioCtx.destination);
  master.gain.setValueAtTime(0, t);
  master.gain.linearRampToValueAtTime(0.18, t + 0.3);
  master.gain.setValueAtTime(0.18, t + dur - 0.6);
  master.gain.linearRampToValueAtTime(0, t + dur);

  const freqs = [260, 330, 390, 520];
  freqs.forEach((f, i) => {
    const o = audioCtx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * 0.5, t);
    o.frequency.linearRampToValueAtTime(f, t + 0.4 + i * 0.2);
    o.frequency.setValueAtTime(f, t + 0.4 + i * 0.2);
    o.frequency.linearRampToValueAtTime(f * 1.5, t + dur - 0.4);
    const og = audioCtx.createGain();
    og.gain.setValueAtTime(0, t + i * 0.18);
    og.gain.linearRampToValueAtTime(0.25, t + i * 0.18 + 0.25);
    o.connect(og); og.connect(master);
    o.start(t + i * 0.18); o.stop(t + dur);
  });

  const pulse = audioCtx.createOscillator();
  pulse.type = 'triangle';
  pulse.frequency.setValueAtTime(80, t);
  pulse.frequency.linearRampToValueAtTime(160, t + dur);
  const pg = audioCtx.createGain(); pg.gain.setValueAtTime(0.08, t); pg.gain.linearRampToValueAtTime(0, t + dur);
  pulse.connect(pg); pg.connect(master);
  pulse.start(t); pulse.stop(t + dur);

  successSoundNode = master;
}

function playJumpscareSound() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  
  if (audioCache.jumpscare) {
    const s = audioCtx.createBufferSource();
    s.buffer = audioCache.jumpscare;
    s.connect(audioCtx.destination);
    s.start(t);
    return;
  }

  const g = audioCtx.createGain(); g.connect(audioCtx.destination);
  g.gain.setValueAtTime(0.5, t); g.gain.linearRampToValueAtTime(0, t + 1);
  [180, 330, 500, 666].forEach(f => {
    const o = audioCtx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, t);
    o.frequency.linearRampToValueAtTime(f * 0.4, t + 1);
    o.connect(g); o.start(t); o.stop(t + 1);
  });

  const b = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = audioCtx.createBufferSource(); s.buffer = b;
  const ng = audioCtx.createGain();
  ng.gain.setValueAtTime(0.5, t); ng.gain.linearRampToValueAtTime(0, t + 0.6);
  s.connect(ng); ng.connect(audioCtx.destination);
  s.start(t); s.stop(t + 0.7);
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function checkDetection(dt) {
  creatures.forEach(c => {
    if (!c.alive) return;
    const cAng = Math.atan2(c.y, c.x);
    const fAng = Math.atan2(mouseY - cy, mouseX - cx);
    const diff = Math.abs(normalizeAngle(fAng - cAng));
    
    if (diff < DETECT_HALF && c.dist < 650) {
      c.aimTime += dt;
      if (c.aimTime >= currentAimNeeded) {
        c.alive = false;
        fadeCreatureAudio(c);
        playSuccessSound();
        c.revealEl.style.display = 'none';
        
        const allDead = creatures.every(x => !x.alive);
        
        if (allDead) {
          successEncounter();
        }
      }
    } else {
      c.aimTime = Math.max(0, c.aimTime - dt * 0.6);
    }
    
    if (c.alive && c.aimTime > 0) {
      const showDist = Math.min(c.dist, 250);
      let sx = cx + Math.cos(cAng) * showDist;
      let sy = cy + Math.sin(cAng) * showDist;
      sx = Math.max(80, Math.min(window.innerWidth - 80, sx));
      sy = Math.max(80, Math.min(window.innerHeight - 80, sy));
      
      c.revealEl.style.left = sx + 'px';
      c.revealEl.style.top = sy + 'px';
      c.revealEl.style.display = 'block';
      c.revealEl.style.opacity = Math.min(0.6, (c.aimTime / currentAimNeeded) * 0.6).toString();
    } else if (c.alive) {
      c.revealEl.style.opacity = '0';
      c.revealEl.style.display = 'none';
    }
  });
}

function navigateOut(url) {
  document.body.style.transition = 'opacity 0.7s ease';
  document.body.style.opacity = '0';
  setTimeout(() => { window.location.href = url; }, 750);
}

const LEVEL_TAUNTS = [
  '',
  'that was nothing. the dark barely noticed you.',
  'two down. the crawler is still hungry.',
  'still breathing. bold of you.',
  'four. they remember your face now.',
  'halfway through night one. getting brave, aren\'t we.',
  'six levels. your hands are shaking. i can tell.',
  'almost done with night one. don\'t get comfortable.',
  'night one is over. you survived nothing. wait for what\'s next.',
  'the shadow wraith knows you\'re here.',
  'you can\'t see it. it can see you.',
  'level eleven. sleep deprived yet?',
  'level twelve — easy, right? wait until night three. you\'ll cry.',
  'the banshee heard that. all of it.',
  'fourteen. she\'s been screaming for you.',
  'almost halfway through night two. your luck is running out.',
  'sixteen done. the dark is thicker now. you feel it.',
  'night two is behind you. it\'s still behind you.',
  'the penitent doesn\'t forgive. it just waits.',
  'nineteen levels. your sins are stacking up.',
  'twenty. you should go to sleep.',
  'the flashlight won\'t save you forever.',
  'twenty-two. it prayed over your chair while you were away.',
  'almost through night three. your blood pressure is showing.',
  'night three done. you look pale.',
  'the doll found your photograph.',
  'twenty-six. she\'s been watching since level one.',
  'you thought you were safe for a second. that second is gone.',
  'twenty-eight. it smiled at you. you didn\'t see it.',
  'halfway. the game is tired of being nice.',
  'thirty. stop. breathe. it won\'t help.',
  'night four is dead. night five is awake.',
  'the jester doesn\'t laugh because it\'s funny.',
  'thirty-three. you survived. it let you.',
  'the corridor behind you isn\'t empty.',
  'thirty-five. you\'re not winning. you\'re just not dead yet.',
  'night five done. the jester took notes.',
  'the drowned doesn\'t need air.',
  'thirty-eight. the water is rising. you can\'t hear it yet.',
  'your footsteps echo. hers don\'t.',
  'forty levels. nothing about this was luck.',
  'she never left the water. the water is everywhere now.',
  'forty-two. you\'re breathing too loud.',
  'the final night knows your name.',
  'forty-four. this is not the end. this is the throat of the end.',
  'almost. the dark is personal now.',
  'forty-six. go back. you won\'t though.',
  'every ghost you cleared remembers.',
  'forty-eight. night six is dead. good luck.',
  'they are all awake now.',
  'fifty. the dark laughed.',
  'your torch is dimmer than it was on level one. or is it?',
  'fifty-two. the last night has been watching since you started.',
  'three left. don\'t think about that.',
  'fifty-four. you\'ve come too far to stop and too far to survive.',
  'one more. one. the drowned is right behind you.',
  'you finished it. somehow. go outside.',
];

function getLevelTaunt(lvl) {
  if (lvl >= 1 && lvl <= 56) return LEVEL_TAUNTS[lvl];
  return 'you\'re still here. that\'s either brave or stupid.';
}

function successEncounter() {
  stopHeartbeat();
  stopAmbient();
  if (!progress.completed.includes(currentLevel)) {
    progress.completed.push(currentLevel);
  }
  if (currentLevel >= progress.highestUnlocked) {
    progress.highestUnlocked = currentLevel + 1;
  }
  saveProgress();
  const cleared = currentLevel;
  currentLevel++;
  levelConfig = getLevelConfig(currentLevel);
  scoreEl.textContent = 'LVL ' + currentLevel;
  document.body.classList.add('shake');
  setTimeout(function() { document.body.classList.remove('shake'); }, 400);
  gameActive = false;
  cancelAnimationFrame(animId);
  document.body.classList.remove('game-running');

  if (cleared % 8 === 0) {
    const nextNight = Math.ceil(currentLevel / 8);
    setTimeout(() => {
      if (nextNight > NIGHTS) {
        navigateOut('index.html?v=3');
      } else {
        navigateOut('night.html?n=' + nextNight);
      }
    }, 3800);
    return;
  }

  const nextLvlEl = document.getElementById('interNextLvl');
  if (nextLvlEl) nextLvlEl.textContent = 'LEVEL ' + currentLevel;
  interTxt.textContent = getLevelTaunt(cleared);
  interScr.style.display = 'flex';
}

function showCaughtScreen(killer) {
  const gType = (killer && killer.gType) ? killer.gType : 1;
  const look  = GHOST_LOOK[gType] || GHOST_LOOK[3];

  caughtImgEl.src = `images/ghost_level_${gType}.jpg`;
  caughtImgEl.onerror = function() { this.onerror = null; this.src = 'images/jumpscare.jpg'; };

  caughtImgEl.style.filter      = look.filter;
  caughtImgEl.style.borderColor = look.border;
  caughtImgEl.style.boxShadow   = '0 0 55px ' + look.glow + ', 0 0 110px ' + look.glow.replace(/[\d.]+\)$/, '0.3)') + ', inset 0 0 35px rgba(0,0,0,.85)';

  caughtNameEl.textContent      = GHOST_NAMES[gType] || '???';
  caughtNameEl.style.color      = look.nameCol;
  caughtNameEl.style.textShadow = '0 0 35px ' + look.glow + ', 3px 3px 0 #050000';

  document.getElementById('caught-msg').textContent = GHOST_MSGS[gType] || 'it found you.';

  caughtEl.style.display = 'flex';

  let t = 3;
  caughtCountEl.textContent = 'back in ' + t + '...';
  const cd = setInterval(() => {
    t--;
    if (t <= 0) { clearInterval(cd); caughtEl.style.display = 'none'; }
    else caughtCountEl.textContent = 'back in ' + t + '...';
  }, 1000);
}

function failEncounter(killer) {
  creatures.forEach(c => {
    c.alive = false;
    fadeCreatureAudio(c);
  });
  stopHeartbeat();

  lives--;
  livesEl.textContent = '❤️'.repeat(Math.max(0, lives));

  if (lives <= 0) { triggerGameOver(); return; }

  playJumpscareSound();
  document.body.classList.add('shake');
  setTimeout(() => document.body.classList.remove('shake'), 500);

  showCaughtScreen(killer);

  setTimeout(() => { spawnCreatures(); startAmbient(); }, 3200);
}

function triggerGameOver() {
  gameActive = false;
  stopAmbient();
  creatures.forEach(c => fadeCreatureAudio(c));
  stopHeartbeat();
  cancelAnimationFrame(animId);
  
  jumpEl.innerHTML = ''; 
  jumpEl.style.flexWrap = 'wrap';
  jumpEl.style.justifyContent = 'center';
  jumpEl.style.alignContent = 'center';
  jumpEl.style.gap = '20px';
  jumpEl.style.padding = '20px';

  if (creatures.length > 1) {
    creatures.forEach(c => {
      const img = document.createElement('img');
      img.src = `images/ghost_level_${c.gType || 1}.jpg`;
      img.onerror = function() { this.onerror = null; this.src = 'images/jumpscare.jpg'; };
      
      let flexBasis = '40%';
      if (creatures.length >= 5) flexBasis = '28%';
      
      img.style.position = 'relative';
      img.style.flex = `0 1 ${flexBasis}`;
      img.style.width = '100%';
      img.style.maxWidth = flexBasis;
      img.style.aspectRatio = '1 / 1';
      img.style.objectFit = 'cover';
      img.style.borderRadius = '50%';
      img.style.filter = 'contrast(2) brightness(0.8)';
      img.style.animationDelay = `${Math.random() * 0.15}s`;
      jumpEl.appendChild(img);
    });
  } else {
    jumpEl.style.padding = '0';
    jumpEl.style.gap = '0';
    const img = document.createElement('img');
    const type = creatures[0] ? (creatures[0].gType || 1) : 1;
    img.src = `images/ghost_level_${type}.jpg`;
    img.onerror = function() { this.onerror = null; this.src = 'images/jumpscare.jpg'; };
    jumpEl.appendChild(img);
  }

  jumpEl.style.display = 'flex';
  playJumpscareSound();
  document.body.classList.remove('game-running');
  setTimeout(() => {
    jumpEl.style.display = 'none';
    finalEl.textContent = 'reached level ' + currentLevel;
    overScr.style.display = 'flex';
  }, 1500);
}

function gameLoop(ts) {
  if (!gameActive) return;
  const dt = Math.min(0.1, (ts - lastTime) / 1000);
  lastTime = ts;
  updateCreature(dt);
  updateCreatureAudio();
  checkDetection(dt);
  renderFlashlight();
  const killer = creatures.find(c => c.alive && c.dist < CREATURE_CLOSE);
  if (killer) failEncounter(killer);
  animId = requestAnimationFrame(gameLoop);
}

function generateScene() {
  document.querySelectorAll('.scene-crack,.scene-scratch,.scene-stain,.dust').forEach(e => e.remove());
  const w = window.innerWidth, h = window.innerHeight, sc = document.getElementById('scene');
  for (let i = 0; i < 12; i++) {
    const el = document.createElement('div'); el.className = 'scene-crack';
    el.style.left = Math.random() * w + 'px'; el.style.top = Math.random() * h + 'px';
    el.style.height = (30 + Math.random() * 100) + 'px';
    el.style.transform = `rotate(${-30 + Math.random() * 60}deg)`;
    sc.appendChild(el);
  }
  for (let i = 0; i < 8; i++) {
    const el = document.createElement('div'); el.className = 'scene-scratch';
    el.style.left = Math.random() * w + 'px'; el.style.top = Math.random() * h + 'px';
    el.style.width = (30 + Math.random() * 90) + 'px';
    el.style.transform = `rotate(${-20 + Math.random() * 40}deg)`;
    sc.appendChild(el);
  }
  for (let i = 0; i < 4; i++) {
    const el = document.createElement('div'); el.className = 'scene-stain';
    el.style.left = Math.random() * w + 'px'; el.style.top = Math.random() * h + 'px';
    el.style.width = (30 + Math.random() * 60) + 'px'; el.style.height = (20 + Math.random() * 50) + 'px';
    sc.appendChild(el);
  }
  for (let i = 0; i < 20; i++) {
    const el = document.createElement('div'); el.className = 'dust';
    el.style.left = Math.random() * w + 'px'; el.style.top = Math.random() * h + 'px';
    el.style.animationDuration = (5 + Math.random() * 8) + 's';
    el.style.animationDelay = Math.random() * 6 + 's';
    document.body.appendChild(el);
  }
}

async function startGame(lvl) {
  currentLevel = lvl;
  levelConfig = getLevelConfig(lvl);
  currentAimNeeded = levelConfig.aimWindow;
  stopSuccessSound();
  stopAmbient();
  stopHeartbeat();
  lives = 2;

  livesEl.textContent = '❤️❤️';
  scoreEl.textContent = 'LVL ' + currentLevel;
  startScr.style.display = 'none'; overScr.style.display = 'none';
  jumpEl.style.display = 'none'; interScr.style.display = 'none';
  document.querySelectorAll('.ghost-reveal').forEach(e => e.remove());
  document.body.classList.add('game-running');
  gameActive = true;

  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    await audioLoadPromise;
    const decodes = Object.keys(preloadedBuffers).map(async (key) => {
      try { audioCache[key] = await audioCtx.decodeAudioData(preloadedBuffers[key].slice(0)); }
      catch(e) {}
    });
    await Promise.all(decodes);
  }

  if (audioCtx.state === 'suspended') audioCtx.resume();
  startAmbient();
  generateScene();
  mouseX = cx; mouseY = cy;
  renderFlashlight();
  lastTime = performance.now();
  setTimeout(function() { if (gameActive) spawnCreatures(); }, 2500);
  animId = requestAnimationFrame(gameLoop);
}

document.getElementById('restartBtn').addEventListener('click', function() {
  overScr.style.display = 'none';
  startScr.style.display = 'flex';
  buildNightCards();
});

document.getElementById('nextLevelBtn').addEventListener('click', function() {
  interScr.style.display = 'none';
  startGame(currentLevel);
});

document.getElementById('quitBtn').addEventListener('click', function() {
  interScr.style.display = 'none';
  startScr.style.display = 'flex';
  buildNightCards();
});

function buildNightCards() {
  const grid = document.getElementById('level-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (let n = 0; n < NIGHTS; n++) {
    const nightNum = n + 1;
    const firstLvl = n * 8 + 1;
    const unlocked = firstLvl <= progress.highestUnlocked;
    let allDone = true;
    for (let i = 0; i < 8; i++) {
      if (!progress.completed.includes(n * 8 + i + 1)) { allDone = false; break; }
    }

    const card = document.createElement('div');
    card.className = 'night-card' + (unlocked ? '' : ' night-card--locked') + (allDone ? ' night-card--done' : '');
    card.innerHTML =
      `<span class="nc-num">${NIGHT_NAMES[n]}</span>` +
      `<span class="nc-ghost">${GHOST_NAMES[nightNum]}</span>` +
      (allDone ? '<span class="nc-check">✓</span>' : '') +
      (!unlocked ? '<span class="nc-lock">🔒</span>' : '');

    if (unlocked) {
      card.addEventListener('click', () => navigateOut('night.html?n=' + nightNum));
    }
    grid.appendChild(card);
  }
}

(function() {
  const lvl = parseInt(localStorage.getItem('dreadlight_autostart'));
  if (lvl >= 1) {
    localStorage.removeItem('dreadlight_autostart');
    startGame(lvl);
  } else {
    buildNightCards();
  }
})();

renderFlashlight();
