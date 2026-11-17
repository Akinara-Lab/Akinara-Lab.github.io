import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SakuraTree, PetalFall, windUniforms } from './tree.js';
import { buildScenery, groundHeight } from './scenery.js';
import { loadStats, loadLive } from './stats.js';

// --- commits -> age --------------------------------------------------------
// Every commit adds to the tree, early ones more than late ones, and the tree
// never quite finishes: age = c^P / (c^P + K), always below 1.
const P = 0.6;
const K = 17;
const ageOf = (commits) => {
  const x = Math.pow(Math.max(0, commits), P);
  return x / (x + K);
};
const commitsOf = (age) => Math.pow((K * age) / (1 - age), 1 / P);

const STAGES = [
  [0.03, 'tane', 'seed'],
  [0.16, 'me', 'sprout'],
  [0.5, 'wakagi', 'young tree'],
  [0.72, 'seiboku', 'grown tree'],
  [0.87, 'koboku', 'old tree'],
  [2, 'shinboku', 'sacred tree'],
];

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const query = new URLSearchParams(location.search);
// ?still shows the finished tree at once (used for the preview image)
const reducedMotion = query.has('still') || matchMedia('(prefers-reduced-motion: reduce)').matches;

function start() {
  performance.mark('scene-start');
  const canvas = $('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(0x000000, 0.016);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.minDistance = 5;
  controls.maxDistance = 42;
  controls.maxPolarAngle = Math.PI * 0.6;
  controls.autoRotate = false; // starts once the tree has grown in
  controls.autoRotateSpeed = 0.45;
  controls.target.set(0, 3, 0);

  let idleTimer = 0;
  controls.addEventListener('start', () => {
    touched = true;
    controls.autoRotate = false;
    clearTimeout(idleTimer);
    document.body.classList.add('touched');
  });
  controls.addEventListener('end', () => {
    if (reducedMotion) return;
    idleTimer = setTimeout(() => (controls.autoRotate = true), 7000);
  });

  // world
  const scenery = buildScenery(scene);
  const tree = new SakuraTree(7);
  const treeBase = groundHeight(0, 0) - 0.06;
  tree.group.position.set(0, treeBase, 0);
  scene.add(tree.group);
  const petals = new PetalFall(tree);
  scene.add(petals.mesh);
  if (reducedMotion) windUniforms.uWind.value = 0.25;
  if (query.has('still')) document.body.classList.add('still');

  // post-processing
  const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.5, 0.75, 0.8);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // Starting view: far enough away for the tree as it stands today, and
  // further back on tall, narrow screens so the island still fits.
  let touched = false;
  let maxPixelRatio = 2;
  function frameCamera(age) {
    if (touched) return;
    const dist = (15 + 6 * age) * Math.max(1, Math.pow(1.25 / camera.aspect, 0.8));
    camera.position.set(0.72, 0.11, 0.69).normalize().multiplyScalar(dist).add(controls.target);
  }

  // --- info panel ------------------------------------------------------------
  // The panel folds down to a small chip so the scene can be watched
  // undisturbed. The choice is remembered for the next visit.
  const panel = $('panel');
  const toggle = $('panel-toggle');
  let panelOpen = true;
  let panelShift = 1; // 1 = scene moved aside for the open panel, 0 = centred
  function setPanel(open, remember) {
    panelOpen = open;
    panel.classList.toggle('collapsed', !open);
    document.body.classList.toggle('calm', !open);
    const label = open ? 'Hide details' : 'Show details';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    if (!remember) return;
    try {
      localStorage.setItem('panel', open ? 'open' : 'closed');
    } catch {
      /* private mode: the choice just is not remembered */
    }
  }
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    setPanel(!panelOpen, true);
  });
  panel.addEventListener('click', () => {
    if (!panelOpen) setPanel(true, true);
  });
  // ?calm opens the page with the panel already folded
  let startFolded = query.has('calm');
  try {
    if (!query.has('still') && localStorage.getItem('panel') === 'closed') startFolded = true;
  } catch {
    /* storage blocked: start with the panel open */
  }
  if (startFolded) {
    setPanel(false, false);
    panelShift = 0;
  }

  // on wide screens, move the scene a little to the right of the info panel
  // and on phones a little above it; with the panel folded it sits centred
  function applyViewOffset() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w > 900) camera.setViewOffset(w, h, -w * 0.05 * panelShift, 0, w, h);
    else if (h > w) camera.setViewOffset(w, h, 0, h * 0.07 * panelShift, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    camera.aspect = w / h;
    applyViewOffset();
    scenery.setPixelSize(h * pr * 0.11);
  }
  window.addEventListener('resize', resize);
  resize();
  frameCamera(0.4);

  // --- growth --------------------------------------------------------------
  let total = 0; // commits today
  let age = 0;
  let tween = null;
  function growTo(commits, seconds) {
    const to = ageOf(commits);
    if (reducedMotion || seconds <= 0) {
      age = to;
      tween = null;
      applyAge();
      return;
    }
    tween = { from: age, to, t: 0, dur: seconds };
  }

  let shownStage = -1;
  function applyAge() {
    tree.setAge(age);
    scenery.setAge(age, tree);
    $('commits').textContent = fmt(Math.min(total, commitsOf(age)));
    $('blossoms').textContent = fmt(tree.blossoms);
    const stage = STAGES.findIndex((s) => age < s[0]);
    if (stage !== shownStage) {
      shownStage = stage;
      const [, reading, meaning] = STAGES[stage];
      $('stage-name').textContent = meaning;
      $('stage-text').textContent = reading;
    }
  }

  const slider = $('rewind');
  // the tree follows the slider directly, frame by frame
  slider.addEventListener('input', () => {
    tween = null;
    age = ageOf(Number(slider.value));
    applyAge();
    $('rewind-label').textContent = Number(slider.value) >= total ? 'today' : `commit ${fmt(slider.value)}`;
  });

  function setTotal(commits, repos, animateSeconds) {
    const atEnd = Number(slider.value) >= Number(slider.max);
    total = commits;
    slider.max = String(Math.max(1, commits));
    if (atEnd) {
      slider.value = slider.max;
      growTo(commits, animateSeconds);
      frameCamera(ageOf(commits));
    }
    if (repos && repos.length) {
      $('repos').replaceChildren(
        ...repos.slice(0, 6).map((r) => {
          const a = document.createElement('a');
          a.href = r.url;
          a.rel = 'noopener';
          a.append(r.name, Object.assign(document.createElement('span'), { textContent: fmt(r.commits) }));
          return a;
        }),
      );
    }
  }

  applyAge();
  (async () => {
    const snapshot = await loadStats();
    let hidden = 0;
    if (snapshot) {
      hidden = snapshot.privateCommits || 0;
      slider.value = slider.max;
      setTotal(snapshot.commits, snapshot.repos, 6);
      if (snapshot.preview) {
        $('rewind-label').textContent = 'preview';
        return;
      }
    }
    try {
      const live = await loadLive();
      if (live.commits + hidden > total) setTotal(live.commits + hidden, live.repos, snapshot ? 2.5 : 6);
    } catch {
      /* the snapshot is good enough */
    }
  })();

  // --- loop ----------------------------------------------------------------
  // If the device cannot keep up, trade sharpness and shadows for frame rate.
  let quality = 0;
  let slowFrames = 0;
  let frames = 0;
  function watchFrameRate(dt) {
    if (dt > 0.045) slowFrames++;
    if (++frames < 90) return;
    if (slowFrames > 60 && quality < 2) {
      quality++;
      maxPixelRatio = quality === 1 ? 1.25 : 1;
      if (quality === 2) scenery.setShadows(false);
      resize();
    }
    frames = slowFrames = 0;
  }

  let firstFrame = false;
  let last = performance.now();
  let time = 0;
  const look = new THREE.Vector3();
  function frame(now) {
    watchFrameRate((now - last) / 1000);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;

    if (tween) {
      tween.t = Math.min(1, tween.t + dt / tween.dur);
      const e = tween.t < 0.5 ? 4 * tween.t ** 3 : 1 - Math.pow(-2 * tween.t + 2, 3) / 2;
      age = tween.from + (tween.to - tween.from) * e;
      if (tween.t >= 1) {
        tween = null;
        if (!touched && !reducedMotion) controls.autoRotate = true;
      }
      applyAge();
    }

    // glide the scene to the centre when the panel folds, and back
    const shiftGoal = panelOpen ? 1 : 0;
    if (panelShift !== shiftGoal) {
      panelShift += (shiftGoal - panelShift) * (reducedMotion ? 1 : 1 - Math.exp(-dt * 3));
      if (Math.abs(shiftGoal - panelShift) < 0.002) panelShift = shiftGoal;
      applyViewOffset();
    }

    // keep the crown in frame as the tree gets taller
    look.set(0, treeBase + 0.5 + tree.height * 0.4, 0);
    controls.target.lerp(look, reducedMotion ? 1 : 1 - Math.exp(-dt * 2));

    windUniforms.uTime.value = time;
    scenery.update(time);
    petals.update(dt, time);
    controls.update();
    composer.render(dt);
    if (!firstFrame) {
      firstFrame = true;
      performance.mark('scene-first-frame');
      document.body.classList.add('ready');
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  if (query.has('debug')) {
    window.__dbg = { renderer, scene, camera, composer, controls, tree, bloom, setAge: (a) => { age = a; tween = null; applyAge(); } };
  }
}

try {
  start();
} catch (err) {
  console.error(err);
  document.body.classList.add('no-webgl');
}
