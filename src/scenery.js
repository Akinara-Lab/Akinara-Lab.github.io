// Everything around the tree: the floating island, torii, lantern, small
// shrine, sky and lights. Colours follow akinara.de: black, #121212, #313131,
// grey #b8b8b8, white, cyan #20ecf3 and teal #24888c.
import * as THREE from 'three';
import { mulberry32, flowerGeometry, blossomMaterial, blossomColor } from './tree.js';

const smoothstep = THREE.MathUtils.smoothstep;

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y) => vnoise(x, y) * 0.5 + vnoise(x * 2.1, y * 2.1) * 0.25 + vnoise(x * 4.3, y * 4.3) * 0.125;

const edgeRadius = (theta) => 7.2 * (0.86 + 0.28 * fbm(Math.cos(theta) * 1.3 + 5, Math.sin(theta) * 1.3 + 5));

export function groundHeight(x, z) {
  const r = Math.hypot(x, z);
  const t = r / edgeRadius(Math.atan2(z, x));
  const h = 0.5 * (fbm(x * 0.3 + 10, z * 0.3 + 10) - 0.45) + 0.4 * Math.exp((-r * r) / 5);
  const d = smoothstep(t, 0.72, 1);
  return h - 0.9 * d * d;
}

function island() {
  const group = new THREE.Group();
  const SEGS = 96;

  // top: moss, fading to bare rock at the rim
  {
    const RINGS = 20;
    const pos = [];
    const col = [];
    const idx = [];
    const moss = new THREE.Color(0x103f41);
    const mossLight = new THREE.Color(0x24888c);
    const rock = new THREE.Color(0x3a3a3a);
    const c = new THREE.Color();
    for (let i = 0; i <= RINGS; i++) {
      for (let j = 0; j < SEGS; j++) {
        const th = (j / SEGS) * Math.PI * 2;
        const r = (edgeRadius(th) * i) / RINGS;
        const x = Math.cos(th) * r;
        const z = Math.sin(th) * r;
        pos.push(x, groundHeight(x, z), z);
        c.copy(moss).lerp(mossLight, fbm(x * 0.9 + 3, z * 0.9 + 3) * 1.1);
        c.lerp(rock, smoothstep(i / RINGS, 0.8, 0.98));
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < RINGS; i++) {
      for (let j = 0; j < SEGS; j++) {
        const a = i * SEGS + j;
        const b = i * SEGS + ((j + 1) % SEGS);
        idx.push(a, b, a + SEGS, b, b + SEGS, a + SEGS);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const top = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    top.receiveShadow = true;
    group.add(top);
  }

  // underside: a tapering mass of faceted rock
  {
    const LAYERS = 12;
    const DEPTH = 7.5;
    const pos = [];
    const col = [];
    const idx = [];
    const light = new THREE.Color(0x3a3a3a);
    const dark = new THREE.Color(0x0c0c0c);
    const c = new THREE.Color();
    for (let k = 0; k <= LAYERS; k++) {
      const t = k / LAYERS;
      for (let j = 0; j < SEGS; j++) {
        const th = (j / SEGS) * Math.PI * 2;
        const cx = Math.cos(th);
        const sz = Math.sin(th);
        const e = edgeRadius(th);
        const rough = (fbm(cx * 2.2 + 3 + k * 0.41, sz * 2.2 + 7 + k * 0.41) - 0.45) * 0.7 * Math.min(1, t * 3);
        const f = Math.pow(1 - t, 0.5) * (1 + rough);
        const yEdge = groundHeight(cx * e, sz * e);
        pos.push(cx * e * f, yEdge * (1 - t) - DEPTH * Math.pow(t, 1.15), sz * e * f);
        c.copy(light).lerp(dark, Math.min(1, t * 1.3 + hash2(j, k) * 0.25));
        col.push(c.r, c.g, c.b);
      }
    }
    for (let k = 0; k < LAYERS; k++) {
      for (let j = 0; j < SEGS; j++) {
        const a = k * SEGS + j;
        const b = k * SEGS + ((j + 1) % SEGS);
        idx.push(a, b, a + SEGS, b, b + SEGS, a + SEGS);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true })));
  }
  return group;
}

function torii() {
  const g = new THREE.Group();
  // a stone torii: pale grey with a dark cap
  const red = new THREE.MeshStandardMaterial({ color: 0xc4c4c4, roughness: 0.85 });
  const black = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 });
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };

  for (const side of [-1, 1]) {
    const post = add(new THREE.CylinderGeometry(0.13, 0.17, 3.3, 14), red, side * 1.32, 1.65, 0);
    post.rotation.z = side * 0.035;
    add(new THREE.CylinderGeometry(0.24, 0.27, 0.34, 14), black, side * 1.37, 0.17, 0);
  }
  add(new THREE.BoxGeometry(3.5, 0.2, 0.14), red, 0, 2.5, 0); // nuki
  add(new THREE.BoxGeometry(0.16, 0.5, 0.1), red, 0, 2.85, 0); // gakuzuka
  add(new THREE.BoxGeometry(3.7, 0.17, 0.24), red, 0, 3.18, 0); // shimaki

  // kasagi: the top beam, swept upwards at both ends
  const beam = (w, y0, h, lift) => {
    const s = new THREE.Shape();
    s.moveTo(-w, y0 + lift);
    s.quadraticCurveTo(0, y0 - lift * 0.35, w, y0 + lift);
    s.lineTo(w + 0.06, y0 + h + lift * 1.25);
    s.quadraticCurveTo(0, y0 + h - lift * 0.3, -w - 0.06, y0 + h + lift * 1.25);
    s.closePath();
    return s;
  };
  const kasagi = add(new THREE.ExtrudeGeometry(beam(2.15, 0, 0.26, 0.2), { depth: 0.34, bevelEnabled: false, curveSegments: 16 }), red, 0, 3.27, -0.17);
  kasagi.castShadow = true;
  add(new THREE.ExtrudeGeometry(beam(2.24, 0.25, 0.08, 0.22), { depth: 0.46, bevelEnabled: false, curveSegments: 16 }), black, 0, 3.27, -0.23);
  return g;
}

function lantern() {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0x8c8c8c, roughness: 1, flatShading: true });
  const glow = new THREE.MeshBasicMaterial({ color: 0xeafeff });
  const add = (geo, mat, y) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.castShadow = mat !== glow;
    g.add(m);
    return m;
  };
  add(new THREE.CylinderGeometry(0.34, 0.4, 0.18, 6), stone, 0.09);
  add(new THREE.CylinderGeometry(0.1, 0.13, 0.85, 6), stone, 0.6);
  add(new THREE.CylinderGeometry(0.34, 0.2, 0.12, 6), stone, 1.08);
  add(new THREE.BoxGeometry(0.3, 0.3, 0.3), glow, 1.29);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const post = add(new THREE.BoxGeometry(0.05, 0.32, 0.05), stone, 1.29);
    post.position.x = x * 0.17;
    post.position.z = z * 0.17;
  }
  const roof = add(new THREE.ConeGeometry(0.52, 0.34, 6), stone, 1.62);
  roof.rotation.y = Math.PI / 6;
  add(new THREE.SphereGeometry(0.075, 8, 6), stone, 1.84);

  const light = new THREE.PointLight(0xe6feff, 11, 11, 2);
  light.position.y = 1.3;
  g.add(light);
  g.userData.light = light;
  return g;
}

// hokora: a miniature shrine on a stone plinth
function hokora() {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0x6e6e6e, roughness: 1, flatShading: true });
  const wood = new THREE.MeshStandardMaterial({ color: 0x3d3d3d, roughness: 0.85 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.6 });
  const red = new THREE.MeshStandardMaterial({ color: 0xc4c4c4, roughness: 0.85 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xc8fbfd });
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = mat !== glow;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(1.15, 0.22, 0.95), stone, 0, 0.11, 0);
  add(new THREE.BoxGeometry(0.9, 0.2, 0.72), stone, 0, 0.32, 0);
  add(new THREE.BoxGeometry(0.62, 0.62, 0.5), wood, 0, 0.73, 0);
  add(new THREE.BoxGeometry(0.26, 0.36, 0.02), glow, 0, 0.7, 0.26);
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.05, 0.62, 0.05), red, s * 0.31, 0.73, 0.26);
  for (const s of [-1, 1]) {
    const slab = add(new THREE.BoxGeometry(0.62, 0.06, 0.86), roofMat, s * 0.25, 1.18, 0);
    slab.rotation.z = -s * 0.62;
  }
  add(new THREE.BoxGeometry(0.1, 0.08, 0.94), red, 0, 1.36, 0);
  return g;
}

function moonTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const halo = x.createRadialGradient(128, 128, 30, 128, 128, 128);
  halo.addColorStop(0, 'rgba(160,246,250,0.42)');
  halo.addColorStop(0.3, 'rgba(32,236,243,0.14)');
  halo.addColorStop(0.6, 'rgba(36,136,140,0.06)');
  halo.addColorStop(1, 'rgba(36,136,140,0)');
  x.fillStyle = halo;
  x.fillRect(0, 0, 256, 256);
  const disc = x.createRadialGradient(112, 112, 4, 128, 128, 46);
  disc.addColorStop(0, '#ffffff');
  disc.addColorStop(0.8, '#e9feff');
  disc.addColorStop(1, 'rgba(220,254,255,0)');
  x.fillStyle = disc;
  x.beginPath();
  x.arc(128, 128, 46, 0, Math.PI * 2);
  x.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function stars(rnd) {
  const N = 1400;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize().multiplyScalar(90 + rnd() * 40);
    pos.set([v.x, v.y, v.z], i * 3);
    const b = 0.25 + Math.pow(rnd(), 3) * 1.2;
    col.set([b * (0.85 + rnd() * 0.15), b, b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false }));
}

function fireflies(rnd, uniforms) {
  const N = 110;
  const pos = new Float32Array(N * 3);
  const seed = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 1.5 + rnd() * 7.5;
    pos.set([Math.cos(a) * r, 0.3 + rnd() * 7, Math.sin(a) * r], i * 3);
    seed.set([rnd(), rnd(), rnd()], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  const m = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aSeed;
      uniform float uTime;
      uniform float uSize;
      varying float vAlpha;
      varying float vWarm;
      void main() {
        vec3 p = position;
        p.x += sin( uTime * ( 0.15 + 0.2 * aSeed.x ) + aSeed.y * 6.28 ) * 1.3;
        p.y += sin( uTime * ( 0.2 + 0.25 * aSeed.y ) + aSeed.z * 6.28 ) * 0.6;
        p.z += cos( uTime * ( 0.13 + 0.2 * aSeed.z ) + aSeed.x * 6.28 ) * 1.3;
        vec4 mv = modelViewMatrix * vec4( p, 1.0 );
        vAlpha = 0.35 + 0.65 * abs( sin( uTime * ( 0.5 + aSeed.x ) + aSeed.y * 20.0 ) );
        vWarm = step( 0.8, aSeed.z );
        gl_PointSize = uSize * ( 0.5 + aSeed.z ) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      varying float vWarm;
      void main() {
        float d = length( gl_PointCoord - 0.5 );
        float a = smoothstep( 0.5, 0.0, d );
        vec3 c = mix( vec3( 0.125, 0.925, 0.953 ), vec3( 1.0 ), vWarm );
        gl_FragColor = vec4( c * 1.6, a * a * vAlpha );
      }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}

// Blossoms that have already fallen. Sorted by "birth", so growing the carpet
// is just a matter of raising the instance count.
function carpet(rnd) {
  const N = 1500;
  const items = [];
  for (let i = 0; i < N; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 0.35 + Math.abs(rnd() + rnd() + rnd() - 1.5) * 4.6;
    items.push({ x: Math.cos(a) * r + 0.4, z: Math.sin(a) * r, birth: Math.max(0.06 + 0.9 * Math.pow(rnd(), 0.8) * (0.35 + (0.65 * r) / 5), r / 5.5 - 0.08), spin: rnd() * 6.28, tilt: (rnd() - 0.5) * 0.5, size: 0.07 + rnd() * 0.05 });
  }
  items.sort((a, b) => a.birth - b.birth);
  const mesh = new THREE.InstancedMesh(flowerGeometry, blossomMaterial(), N);
  const d = new THREE.Object3D();
  const c = new THREE.Color();
  items.forEach((it, i) => {
    d.position.set(it.x, groundHeight(it.x, it.z) + 0.02, it.z);
    d.rotation.set(it.tilt, it.spin, it.tilt * 0.6);
    d.scale.set(it.size, it.size * 0.35, it.size);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
    mesh.setColorAt(i, blossomColor(rnd, c));
  });
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.count = 0;
  const births = items.map((it) => it.birth);
  return {
    mesh,
    setAge(age) {
      let lo = 0;
      let hi = N;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (births[mid] <= age) lo = mid + 1;
        else hi = mid;
      }
      mesh.count = lo;
    },
  };
}

export function buildScenery(scene) {
  const rnd = mulberry32(4242);
  const R = (a, b) => a + (b - a) * rnd();
  const place = (obj, x, z, rotY = 0, sink = 0.04) => {
    obj.position.set(x, groundHeight(x, z) - sink, z);
    obj.rotation.y = rotY;
    scene.add(obj);
    return obj;
  };

  scene.add(island());
  place(torii(), 0.2, 4.5, 0.06);
  const lamp = place(lantern(), 3.7, 0.9, 0.4);
  place(hokora(), -3.2, 0.9, 0.75, 0.02);

  // stepping stones from the gate to the tree
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8c8c8c, roughness: 1, flatShading: true });
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(R(0.3, 0.42), R(0.34, 0.46), 0.09, 7), stoneMat);
    s.receiveShadow = true;
    s.scale.z = R(0.75, 1);
    place(s, 0.2 + R(-0.25, 0.25) + i * 0.02, 5.4 - i * 0.72, R(0, 3), -0.02);
  }

  // boulders on the island and a few drifting next to it
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 1, flatShading: true });
  for (const [x, z, s] of [[-2.2, 3.4, 0.55], [4.4, -1.3, 0.7], [-4.3, -1.9, 0.9], [1.6, -3.9, 0.6], [4.2, 2.1, 0.35]]) {
    const r = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), rockMat);
    r.castShadow = true;
    r.receiveShadow = true;
    r.scale.y = 0.65;
    place(r, x, z, R(0, 6), s * 0.25);
  }
  const floaters = [];
  for (let i = 0; i < 9; i++) {
    const a = R(0, Math.PI * 2);
    const d = R(8.5, 13);
    const r = new THREE.Mesh(new THREE.IcosahedronGeometry(R(0.25, 0.9), 0), rockMat);
    r.position.set(Math.cos(a) * d, R(-5, 1.5), Math.sin(a) * d);
    r.rotation.set(R(0, 6), R(0, 6), R(0, 6));
    r.userData = { y: r.position.y, phase: R(0, 6), speed: R(0.2, 0.5) };
    scene.add(r);
    floaters.push(r);
  }

  const fallen = carpet(rnd);
  scene.add(fallen.mesh);

  // sky
  scene.add(stars(rnd));
  // the moon hangs low behind the tree; its light comes from a little higher up
  const moonDir = new THREE.Vector3(-0.857, 0.2, -0.51).normalize();
  const lightDir = new THREE.Vector3(-0.857, 0.62, -0.51).normalize();
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTexture(), color: 0xc6d2d3, fog: false, depthWrite: false, transparent: true }));
  moon.position.copy(moonDir).multiplyScalar(110);
  moon.scale.setScalar(34);
  scene.add(moon);

  const flyUniforms = { uTime: { value: 0 }, uSize: { value: 60 } };
  scene.add(fireflies(rnd, flyUniforms));

  // lights
  scene.add(new THREE.HemisphereLight(0xb8b8b8, 0x070707, 0.9));
  const moonLight = new THREE.DirectionalLight(0xffffff, 2.6);
  moonLight.position.copy(lightDir).multiplyScalar(30);
  moonLight.castShadow = true;
  moonLight.shadow.mapSize.set(2048, 2048);
  Object.assign(moonLight.shadow.camera, { left: -12, right: 12, top: 14, bottom: -8, near: 5, far: 60 });
  moonLight.shadow.bias = -0.0004;
  moonLight.shadow.normalBias = 0.04;
  scene.add(moonLight);
  const fill = new THREE.DirectionalLight(0xa8a8a8, 1.0);
  fill.position.set(12, 6, 8);
  scene.add(fill);
  const crown = new THREE.PointLight(0x20ecf3, 0, 16, 1.6);
  scene.add(crown);

  return {
    fallen,
    setAge(age, tree) {
      fallen.setAge(age);
      crown.position.set(0, tree.group.position.y + tree.height * 0.72, 0);
      crown.intensity = Math.min(5, tree.blossoms / 800);
    },
    setShadows(on) {
      moonLight.castShadow = on;
    },
    setPixelSize(px) {
      flyUniforms.uSize.value = px;
    },
    update(time) {
      flyUniforms.uTime.value = time;
      lamp.userData.light.intensity = 11 * (0.9 + 0.07 * Math.sin(time * 9.1) + 0.05 * Math.sin(time * 23.7));
      for (const r of floaters) {
        r.position.y = r.userData.y + Math.sin(time * r.userData.speed + r.userData.phase) * 0.35;
        r.rotation.y += 0.0012;
      }
    },
  };
}
