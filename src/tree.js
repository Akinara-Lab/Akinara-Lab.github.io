// The blue cherry tree: a deterministic skeleton that is revealed by a single
// "age" value between 0 and 1. The same seed always gives the same tree, so the
// tree a visitor sees today is the younger self of the tree they see next year.
import * as THREE from 'three';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One entry per branching level, trunk first.
//   len/segs  length and number of segments
//   time      share of the tree's life this level needs to grow out
//   wander    random bending per segment
//   up/out    pull upwards (negative = drooping) and away from the trunk
//   side      side shoots along the branch (from sideFrom of its length on),
//             forks = [min, max] shoots at the tip
//   spread    how far the forks lean away from the parent's direction
//   radial    tube resolution, flowers = blossoms per node, cloud = their scatter
const LEVELS = [
  { len: 2.7, segs: 8, time: 0.1, wander: 0.07, up: 0.1, out: 0, side: 2, sideFrom: 0.5, forks: [3, 4], spread: [0.6, 0.95], radial: 10, flowers: 2, cloud: 0.1 },
  { len: 2.8, segs: 7, time: 0.15, wander: 0.14, up: 0.02, out: 0.05, side: 2, forks: [2, 3], spread: [0.45, 0.8], radial: 8, flowers: 3, cloud: 0.16 },
  { len: 2.1, segs: 6, time: 0.17, wander: 0.18, up: -0.01, out: 0.06, side: 2, forks: [2, 2], spread: [0.45, 0.85], radial: 6, flowers: 4, cloud: 0.22 },
  { len: 1.5, segs: 5, time: 0.19, wander: 0.22, up: -0.04, out: 0.05, side: 2, forks: [2, 2], spread: [0.5, 0.9], radial: 5, flowers: 4, cloud: 0.26 },
  { len: 1.0, segs: 4, time: 0.2, wander: 0.26, up: -0.07, out: 0.03, side: 1, forks: [2, 2], spread: [0.5, 0.95], radial: 4, flowers: 4, cloud: 0.28 },
  { len: 0.62, segs: 3, time: 0.19, wander: 0.3, up: -0.1, out: 0, side: 0, forks: [0, 0], spread: [0, 0], radial: 3, flowers: 4, cloud: 0.28 },
];

const R_TIP = 0.012;
const radiusAt = (age, vigor) => R_TIP + vigor * 0.42 * Math.pow(age, 0.95);

// Blossoms only sit on young wood: fully there below R_BLOOM_0, gone above R_BLOOM_1.
const R_BLOOM_0 = 0.05;
const R_BLOOM_1 = 0.085;
const BLOOM_TIME = 0.035;

const smooth = (t) => t * t * (3 - 2 * t);

// ---------------------------------------------------------------------------
// Wind. Bark and blossoms use the same low-frequency offset so they move together.
export const windUniforms = { uTime: { value: 0 }, uWind: { value: 1 } };

const SWAY_GLSL = /* glsl */ `
uniform float uTime;
uniform float uWind;
vec3 swayOffset( vec3 p ) {
  float h = clamp( p.y / 8.0, 0.0, 1.6 );
  float a = sin( uTime * 0.9 + p.x * 0.35 + p.z * 0.27 ) + 0.5 * sin( uTime * 1.7 + p.x * 0.9 - p.z * 0.6 );
  float b = cos( uTime * 0.7 + p.z * 0.4 - p.x * 0.2 );
  return vec3( a * 0.075, -abs( a ) * 0.012, b * 0.055 ) * h * h * uWind;
}
`;

function addSway(material, instanced) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWind = windUniforms.uWind;
    shader.vertexShader = SWAY_GLSL + shader.vertexShader;
    if (instanced) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        /* glsl */ `
        vec4 mvPosition = vec4( transformed, 1.0 );
        vec3 swayOrigin = instanceMatrix[ 3 ].xyz;
        mvPosition = instanceMatrix * mvPosition;
        mvPosition.xyz += swayOffset( swayOrigin );
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;
        `,
      );
    } else {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n transformed += swayOffset( transformed );',
      );
    }
  };
  material.customProgramCacheKey = () => (instanced ? 'sway-instanced' : 'sway');
  return material;
}

// ---------------------------------------------------------------------------
// Skeleton

function buildSkeleton(seed) {
  const rnd = mulberry32(seed);
  const R = (a, b) => a + (b - a) * rnd();
  const branches = [];

  const perpendicular = (dir) => {
    const v = new THREE.Vector3();
    do {
      v.set(R(-1, 1), R(-1, 1), R(-1, 1));
      v.addScaledVector(dir, -v.dot(dir));
    } while (v.lengthSq() < 1e-3);
    return v.normalize();
  };

  const grow = (start, dir, level, birth, vigor, lenScale) => {
    const L = LEVELS[level];
    const segs = L.segs;
    const step = (L.len * lenScale * R(0.85, 1.15)) / segs;
    const dt = (L.time * lenScale) / segs;
    const pts = [start.clone()];
    const births = [birth];
    const d = dir.clone();
    const p = start.clone();
    const out = new THREE.Vector3();

    for (let i = 1; i <= segs; i++) {
      d.addScaledVector(perpendicular(d), L.wander * R(0.3, 1));
      d.y += L.up;
      out.set(p.x, 0, p.z);
      if (out.lengthSq() > 0.01) d.addScaledVector(out.normalize(), L.out);
      d.normalize();
      p.addScaledVector(d, step);
      pts.push(p.clone());
      births.push(birth + dt * i);
    }
    branches.push({ pts, births, level, vigor });
    if (level + 1 >= LEVELS.length) return;

    for (let s = 0; s < L.side; s++) {
      const i = 1 + Math.floor(R(L.sideFrom ?? 0.2, 0.95) * (segs - 1));
      const axis = pts[i].clone().sub(pts[i - 1]).normalize();
      const cd = axis.clone().addScaledVector(perpendicular(axis), R(0.7, 1.2)).normalize();
      grow(pts[i], cd, level + 1, births[i] + R(0.01, 0.04), vigor * R(0.5, 0.7), R(0.6, 0.85));
    }

    const n = L.forks[0] + Math.floor(rnd() * (L.forks[1] - L.forks[0] + 1));
    const base = perpendicular(d);
    const turn = R(0, Math.PI * 2);
    for (let f = 0; f < n; f++) {
      const side = base.clone().applyAxisAngle(d, turn + (f / n) * Math.PI * 2 + R(-0.4, 0.4));
      const cd = d.clone().addScaledVector(side, R(L.spread[0], L.spread[1])).normalize();
      grow(p, cd, level + 1, births[segs], vigor * (f === 0 ? 0.92 : R(0.7, 0.88)), f === 0 ? 1 : R(0.8, 1));
    }
  };

  grow(new THREE.Vector3(), new THREE.Vector3(R(-0.1, 0.1), 1, R(-0.1, 0.1)).normalize(), 0, 0, 1, 1);

  let last = 0;
  for (const b of branches) last = Math.max(last, b.births[b.births.length - 1]);
  for (const b of branches) b.births = b.births.map((t) => t / last);
  return branches;
}

// Rotation-minimising frames, so the tubes do not twist.
function computeFrames(pts) {
  const n = pts.length;
  const T = [];
  for (let i = 0; i < n; i++) {
    T.push(pts[Math.min(n - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)]).normalize());
  }
  const nrm = Math.abs(T[0].x) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  nrm.addScaledVector(T[0], -nrm.dot(T[0])).normalize();
  const axis = new THREE.Vector3();
  const N = [];
  const B = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      axis.crossVectors(T[i - 1], T[i]);
      const s = axis.length();
      if (s > 1e-6) nrm.applyAxisAngle(axis.divideScalar(s), Math.atan2(s, T[i - 1].dot(T[i])));
      nrm.addScaledVector(T[i], -nrm.dot(T[i])).normalize();
    }
    N.push(nrm.clone());
    B.push(new THREE.Vector3().crossVectors(T[i], nrm));
  }
  return { N, B };
}

// ---------------------------------------------------------------------------
// Blossom geometry: the five petals of the AKINARA mark around +Y. Each petal
// is a teardrop that points at the centre without touching it and ends in a
// rounded tip between two shoulders.

const PETAL_OUTLINE = [
  [0.1, 0],
  [0.52, -0.2],
  [0.8, -0.29],
  [0.87, -0.15],
  [0.97, -0.1],
  [1, 0],
  [0.97, 0.1],
  [0.87, 0.15],
  [0.8, 0.29],
  [0.52, 0.2],
];

function petalInto(pos, col, idx, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const base = pos.length / 3;
  for (const [u, v] of PETAL_OUTLINE) {
    pos.push(u * c - v * s, 0.32 * Math.pow(u, 1.6), u * s + v * c);
    const t = Math.min(1, u * 1.25);
    col.push(0.5 + 0.5 * t, 0.62 + 0.38 * t, 0.65 + 0.35 * t);
  }
  for (let k = 1; k < PETAL_OUTLINE.length - 1; k++) idx.push(base, base + k + 1, base + k);
}

function makeGeometry(petals) {
  const pos = [];
  const col = [];
  const idx = [];
  for (let p = 0; p < petals; p++) petalInto(pos, col, idx, (p / petals) * Math.PI * 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export const flowerGeometry = makeGeometry(5);
export const petalGeometry = makeGeometry(1);

// akinara.de: cyan #20ecf3 and teal #24888c, with lighter tints for depth
const PALETTE = [0xf2ffff, 0xa6f7fa, 0x20ecf3, 0x1bc4ca, 0x24888c, 0xffffff].map((h) => new THREE.Color(h));
const PALETTE_WEIGHTS = [0.14, 0.22, 0.38, 0.14, 0.08, 0.04];

export function blossomColor(rnd, target = new THREE.Color()) {
  let x = rnd();
  let i = 0;
  while (i < PALETTE.length - 1 && x > PALETTE_WEIGHTS[i]) x -= PALETTE_WEIGHTS[i++];
  const other = PALETTE[Math.min(PALETTE.length - 2, Math.floor(rnd() * 4))];
  return target.copy(PALETTE[i]).lerp(other, rnd() * 0.35);
}

export function blossomMaterial() {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.55,
    metalness: 0,
    emissive: 0x20ecf3,
    emissiveIntensity: 0.22,
  });
}

// ---------------------------------------------------------------------------

export class SakuraTree {
  constructor(seed = 7) {
    this.group = new THREE.Group();
    this.age = -1;
    this.blossoms = 0;
    this.height = 0;

    const branches = buildSkeleton(seed);
    this.branches = branches;
    const rnd = mulberry32(seed ^ 0x9e3779b9);
    const R = (a, b) => a + (b - a) * rnd();

    // --- bark -------------------------------------------------------------
    let vertexCount = 0;
    let indexCount = 0;
    let nodeCount = 0;
    for (const b of branches) {
      const L = LEVELS[b.level];
      b.radial = L.radial;
      b.nodeOffset = nodeCount;
      b.vertexOffset = vertexCount;
      nodeCount += b.pts.length;
      vertexCount += b.pts.length * L.radial;
      indexCount += (b.pts.length - 1) * L.radial * 6;
    }
    this.nodeRadius = new Float32Array(nodeCount);

    const position = new Float32Array(vertexCount * 3);
    const normal = new Float32Array(vertexCount * 3);
    const color = new Float32Array(vertexCount * 3);
    const index = new Uint32Array(indexCount);
    let io = 0;
    for (const b of branches) {
      const { N, B } = computeFrames(b.pts);
      const n = b.pts.length;
      const rad = b.radial;
      b.dirs = new Float32Array(n * rad * 3);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < rad; j++) {
          const th = (j / rad) * Math.PI * 2;
          const c = Math.cos(th);
          const s = Math.sin(th);
          const o = (i * rad + j) * 3;
          b.dirs[o] = c * N[i].x + s * B[i].x;
          b.dirs[o + 1] = c * N[i].y + s * B[i].y;
          b.dirs[o + 2] = c * N[i].z + s * B[i].z;
          const vo = b.vertexOffset * 3 + o;
          normal[vo] = b.dirs[o];
          normal[vo + 1] = b.dirs[o + 1];
          normal[vo + 2] = b.dirs[o + 2];
          const shade = R(0.72, 1.12);
          color[vo] = shade;
          color[vo + 1] = shade;
          color[vo + 2] = shade;
        }
      }
      for (let i = 0; i < n - 1; i++) {
        for (let j = 0; j < rad; j++) {
          const a = b.vertexOffset + i * rad + j;
          const bb = b.vertexOffset + i * rad + ((j + 1) % rad);
          index[io++] = a;
          index[io++] = bb;
          index[io++] = a + rad;
          index[io++] = bb;
          index[io++] = bb + rad;
          index[io++] = a + rad;
        }
      }
    }
    const barkGeometry = new THREE.BufferGeometry();
    this.barkPosition = new THREE.BufferAttribute(position, 3);
    this.barkPosition.setUsage(THREE.DynamicDrawUsage);
    barkGeometry.setAttribute('position', this.barkPosition);
    barkGeometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    barkGeometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
    barkGeometry.setIndex(new THREE.BufferAttribute(index, 1));
    barkGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 5, 0), 14);

    this.bark = new THREE.Mesh(
      barkGeometry,
      addSway(new THREE.MeshStandardMaterial({ color: 0x6a6a6a, roughness: 0.92, metalness: 0, vertexColors: true }), false),
    );
    this.bark.castShadow = true;
    this.bark.receiveShadow = true;
    this.bark.frustumCulled = false;
    this.group.add(this.bark);

    // --- blossoms ---------------------------------------------------------
    const slots = [];
    const dir = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const x = new THREE.Vector3();
    const z = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    branches.forEach((b) => {
      const L = LEVELS[b.level];
      for (let i = 1; i < b.pts.length; i++) {
        for (let k = 0; k < L.flowers; k++) {
          dir.set(R(-1, 1), R(-1, 1), R(-1, 1));
          if (dir.lengthSq() < 0.01) dir.set(0, 1, 0);
          dir.normalize();
          const along = rnd();
          tmp.lerpVectors(b.pts[i - 1], b.pts[i], along).addScaledVector(dir, L.cloud * Math.cbrt(rnd()));
          // the blossom faces away from the twig, a little towards the sky
          dir.addScaledVector(up, 0.45).normalize();
          x.set(R(-1, 1), R(-1, 1), R(-1, 1));
          x.addScaledVector(dir, -x.dot(dir));
          if (x.lengthSq() < 1e-4) x.set(1, 0, 0).addScaledVector(dir, -dir.x);
          x.normalize();
          z.crossVectors(x, dir);
          slots.push({
            node: b.nodeOffset + i,
            birth: THREE.MathUtils.lerp(b.births[i - 1], b.births[i], along) + R(0, 0.02),
            scale: 0.115 * R(0.7, 1.3),
            m: [x.x, x.y, x.z, dir.x, dir.y, dir.z, z.x, z.y, z.z, tmp.x, tmp.y, tmp.z],
          });
        }
      }
    });
    // oldest first: the blossoms that exist at a given age are then a prefix
    slots.sort((a, b) => a.birth - b.birth);
    this.slotCount = slots.length;
    this.slotNode = new Uint32Array(slots.length);
    this.slotBirth = new Float32Array(slots.length);
    this.slotScale = new Float32Array(slots.length);
    this.slotBasis = new Float32Array(slots.length * 12);
    this.slotSize = new Float32Array(slots.length);
    slots.forEach((s, i) => {
      this.slotNode[i] = s.node;
      this.slotBirth[i] = s.birth;
      this.slotScale[i] = s.scale;
      this.slotBasis.set(s.m, i * 12);
    });

    this.flowers = new THREE.InstancedMesh(flowerGeometry, addSway(blossomMaterial(), true), slots.length);
    this.flowers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const c = new THREE.Color();
    for (let i = 0; i < slots.length; i++) this.flowers.setColorAt(i, blossomColor(rnd, c));
    this.flowers.castShadow = true;
    this.flowers.frustumCulled = false;
    this.group.add(this.flowers);

    // --- shimenawa, the rope that marks a sacred tree ----------------------
    this.rope = new THREE.Group();
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.17, 8, 28),
      new THREE.MeshStandardMaterial({ color: 0xe6e6e6, roughness: 0.9 }),
    );
    torus.rotation.x = Math.PI / 2;
    torus.castShadow = true;
    this.rope.add(torus);
    const paper = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide, emissive: 0x20ecf3, emissiveIntensity: 0.08 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.5;
      const shide = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.95), paper);
      shide.position.set(Math.cos(a) * 1.18, -0.6, Math.sin(a) * 1.18);
      shide.rotation.y = -a + Math.PI / 2;
      this.rope.add(shide);
    }
    this.rope.visible = false;
    this.group.add(this.rope);
  }

  setAge(age) {
    age = Math.min(1, Math.max(0, age));
    if (Math.abs(age - this.age) < 1e-6) return;
    this.age = age;
    const pos = this.barkPosition.array;
    const radii = this.nodeRadius;
    let top = 0;

    for (const b of this.branches) {
      const { pts, births, vigor, radial, dirs } = b;
      const n = pts.length;
      let tx = pts[0].x;
      let ty = pts[0].y;
      let tz = pts[0].z;
      let o = b.vertexOffset * 3;
      for (let i = 0; i < n; i++) {
        let r = 0;
        if (births[i] <= age) {
          tx = pts[i].x;
          ty = pts[i].y;
          tz = pts[i].z;
          r = radiusAt(age - births[i], vigor);
          if (b.level === 0) r *= 1 + 0.75 * Math.exp(-ty * 2.2); // root flare
        } else if (i > 0 && births[i - 1] <= age) {
          const t = (age - births[i - 1]) / (births[i] - births[i - 1]);
          tx += (pts[i].x - tx) * t;
          ty += (pts[i].y - ty) * t;
          tz += (pts[i].z - tz) * t;
          r = R_TIP * 0.5;
        }
        radii[b.nodeOffset + i] = r;
        if (r > 0 && ty > top) top = ty;
        const d = i * radial * 3;
        for (let j = 0; j < radial; j++) {
          const q = d + j * 3;
          pos[o++] = tx + dirs[q] * r;
          pos[o++] = ty + dirs[q + 1] * r;
          pos[o++] = tz + dirs[q + 2] * r;
        }
      }
    }
    this.barkPosition.needsUpdate = true;
    // a young tree is also a smaller tree
    const scale = 0.5 + 0.5 * Math.pow(age, 0.7);
    this.group.scale.setScalar(scale);
    this.height = top * scale;

    const m = this.flowers.instanceMatrix.array;
    const basis = this.slotBasis;
    let born = 0;
    for (let hi = this.slotCount; born < hi; ) {
      const mid = (born + hi) >> 1;
      if (this.slotBirth[mid] < age) born = mid + 1;
      else hi = mid;
    }
    this.flowers.count = born;
    let visible = 0;
    for (let s = 0; s < born; s++) {
      const a = age - this.slotBirth[s];
      let k = 0;
      if (a > 0) {
        const r = radii[this.slotNode[s]];
        const grown = a >= BLOOM_TIME ? 1 : smooth(a / BLOOM_TIME);
        const young = r <= R_BLOOM_0 ? 1 : r >= R_BLOOM_1 ? 0 : 1 - smooth((r - R_BLOOM_0) / (R_BLOOM_1 - R_BLOOM_0));
        k = grown * young;
        if (k > 0.35) visible++;
        k *= this.slotScale[s];
      }
      this.slotSize[s] = k;
      const o = s * 16;
      const q = s * 12;
      m[o] = basis[q] * k;
      m[o + 1] = basis[q + 1] * k;
      m[o + 2] = basis[q + 2] * k;
      m[o + 3] = 0;
      m[o + 4] = basis[q + 3] * k;
      m[o + 5] = basis[q + 4] * k;
      m[o + 6] = basis[q + 5] * k;
      m[o + 7] = 0;
      m[o + 8] = basis[q + 6] * k;
      m[o + 9] = basis[q + 7] * k;
      m[o + 10] = basis[q + 8] * k;
      m[o + 11] = 0;
      m[o + 12] = basis[q + 9];
      m[o + 13] = basis[q + 10];
      m[o + 14] = basis[q + 11];
      m[o + 15] = 1;
    }
    this.flowers.instanceMatrix.needsUpdate = true;
    this.blossoms = visible;

    // rope around the trunk once it is thick enough to carry one
    const trunk = this.branches[0];
    const i = 3;
    const r = radii[trunk.nodeOffset + i];
    const show = THREE.MathUtils.smoothstep(r, 0.1, 0.16);
    this.rope.visible = show > 0.01;
    if (this.rope.visible) {
      this.rope.position.copy(trunk.pts[i]);
      this.rope.scale.setScalar(r * 1.08 * (0.6 + 0.4 * show));
    }
  }

  // Position of a random open blossom (in the tree's local space), or null.
  randomBlossom(target) {
    for (let tries = 0; tries < 16; tries++) {
      const s = Math.floor(Math.random() * this.flowers.count);
      if (this.slotSize[s] > 0.05) {
        return target.set(this.slotBasis[s * 12 + 9], this.slotBasis[s * 12 + 10], this.slotBasis[s * 12 + 11]);
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Petals drifting down from the crown.

export class PetalFall {
  constructor(tree, count = 240) {
    this.tree = tree;
    this.count = count;
    this.mesh = new THREE.InstancedMesh(petalGeometry, blossomMaterial(), count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) this.mesh.setColorAt(i, blossomColor(Math.random, c));
    this.p = [];
    for (let i = 0; i < count; i++) {
      this.p.push({ pos: new THREE.Vector3(), alive: false, wait: Math.random() * 9, phase: Math.random() * 6.28, spin: 0.6 + Math.random() * 2, fall: 0.3 + Math.random() * 0.35, size: 0.09 + Math.random() * 0.06 });
    }
    this.dummy = new THREE.Object3D();
    this.floor = -9;
  }

  update(dt, time) {
    const active = Math.min(this.count, Math.floor(this.tree.blossoms / 18));
    const d = this.dummy;
    for (let i = 0; i < this.count; i++) {
      const p = this.p[i];
      if (!p.alive) {
        p.wait -= dt;
        if (i < active && p.wait <= 0 && this.tree.randomBlossom(p.pos)) {
          p.pos.multiplyScalar(this.tree.group.scale.x).add(this.tree.group.position);
          p.alive = true;
        }
      }
      if (p.alive) {
        const sway = Math.sin(time * 1.3 + p.phase);
        p.pos.x += (0.22 + 0.35 * sway) * dt;
        p.pos.z += (0.1 + 0.3 * Math.cos(time * 0.9 + p.phase * 1.7)) * dt;
        p.pos.y -= p.fall * (1 + 0.4 * sway) * dt;
        if (p.pos.y < this.floor) {
          p.alive = false;
          p.wait = Math.random() * 4;
        }
        d.position.copy(p.pos);
        d.rotation.set(time * p.spin + p.phase, time * p.spin * 0.7, p.phase + sway);
        d.scale.setScalar(p.size);
      } else {
        d.scale.setScalar(0);
      }
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
