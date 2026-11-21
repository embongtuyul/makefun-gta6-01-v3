// city.js — builds the open world: street grid, buildings, neon signs,
// beach + sea, palms, skyline, golden-hour sky. Exports collision boxes
// and district lookup. Mission-marker areas are kept clear of buildings
// and furniture by design (see CLEAR_ZONES).

import * as THREE from 'three';
import { mulberry32, rand, randInt, pick } from './utils.js';

export const STREETS = [-176, -132, -88, -44, 0, 44, 88, 132, 176];
export const WORLD_BOUND = 220;
export const BEACH_Z = 192;
export const SEA_Z = 238;

// Keep these areas free of buildings and street furniture. Mission
// triggers live here; nothing may block or wedge the player.
export const CLEAR_ZONES = [
  { x: 30, z: 150, r: 16 }, // Marina plaza — mission 1 meet point
  { x: -120, z: -120, r: 16 }, // Lookout plaza — mission 1 destination
  { x: 0, z: 30, r: 8 }, // Player spawn
];

const SHOP_NAMES = [
  'SOLMARA', 'CAFÉ LUNA', 'TACO MAR', 'HOTEL BRISA', 'NEON PALM',
  'PIZZA SOL', 'BAR CORAL', 'SURF SHOP', 'DISCO MAR', 'LA PLAYA',
  'MOTEL VISTA', 'CLUB AZUL', 'AREPA BAR', 'KINO SOL', 'MARISCOS',
];
const NEON_COLORS = ['#ff5ea8', '#37e6ff', '#ffd23f', '#ff7a2f', '#8dff5e', '#c77dff'];
const BUILDING_TINTS = [0xf2e3c6, 0xe8a87c, 0x7fb5a8, 0xd9c9a3, 0xe07856, 0x9aa5b1, 0xc9b8d4];

const DISTRICTS = [
  { name: 'The Boardwalk', flavour: 'Salt air and neon nights', control: 62, test: (x, z) => z >= 186 },
  { name: 'The Marina', flavour: 'Boats, bait, and back-room deals', control: 55, test: (x, z) => z >= 140 },
  { name: 'Mirador Hills', flavour: 'Old money above the bay', control: 48, test: (x, z) => x < -88 && z < -88 },
  { name: 'Palm Court', flavour: 'Glass towers, quiet streets', control: 71, test: (x, z) => x >= 88 && z < -88 },
  { name: 'Old Marina', flavour: 'Fishing boats and back rooms', control: 55, test: (x, z) => x < -88 },
  { name: 'Solmar Strand', flavour: 'Hotels, clubs, all-night light', control: 66, test: (x, z) => x >= 88 },
  { name: 'Downtown Solmara', flavour: "The city's beating heart", control: 58, test: () => true },
];

// The same districts as exact rectangles (verified against the test
// order above), for the pause-menu island map. x/z in world metres.
export const DISTRICT_REGIONS = [
  { name: 'Mirador Hills', control: 48, color: '#5a6a8a', x0: -220, z0: -220, x1: -88, z1: -88 },
  { name: 'Downtown Solmara', control: 58, color: '#6a5a7a', x0: -88, z0: -220, x1: 88, z1: 140 },
  { name: 'Palm Court', control: 71, color: '#3a7a6a', x0: 88, z0: -220, x1: 220, z1: -88 },
  { name: 'Old Marina', control: 55, color: '#7a6a4a', x0: -220, z0: -88, x1: -88, z1: 140 },
  { name: 'Solmar Strand', control: 66, color: '#8a5a4a', x0: 88, z0: -88, x1: 220, z1: 140 },
  { name: 'The Marina', control: 55, color: '#4a7a8a', x0: -220, z0: 140, x1: 220, z1: 186 },
  { name: 'The Boardwalk', control: 62, color: '#a08a3a', x0: -220, z0: 186, x1: 220, z1: 240 },
];

function inClearZone(x, z, pad) {
  for (const c of CLEAR_ZONES) {
    const dx = x - c.x;
    const dz = z - c.z;
    if (dx * dx + dz * dz < (c.r + (pad || 0)) * (c.r + (pad || 0))) return true;
  }
  return false;
}

function makeWindowTexture(rng, litRatio) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#241f1c';
  g.fillRect(0, 0, 128, 256);
  const cols = 5;
  const rows = 11;
  const ww = 18;
  const wh = 14;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = 8 + col * 23;
      const y = 10 + r * 22;
      if (rng() < litRatio) {
        const warm = randInt(rng, 0, 2);
        g.fillStyle = warm === 0 ? '#ffd27a' : warm === 1 ? '#ffe9b0' : '#ffb066';
        g.fillRect(x, y, ww, wh);
      } else {
        g.fillStyle = '#2c3a55';
        g.fillRect(x, y, ww, wh);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeNeonTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 128);
  g.font = 'bold 58px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 22;
  g.fillStyle = color;
  g.fillText(text, 256, 64);
  g.fillText(text, 256, 64);
  g.shadowBlur = 0;
  g.fillStyle = '#ffffff';
  g.font = 'bold 54px Arial, sans-serif';
  g.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeDashTexture() {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 32, 64);
  g.fillStyle = '#e8c33a';
  g.fillRect(14, 8, 4, 30);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class City {
  constructor(scene) {
    this.scene = scene;
    this.rng = mulberry32(20261121);
    this.colliders = [];
    this.trafficLights = [];
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.build();
  }

  districtAt(x, z) {
    for (const d of DISTRICTS) {
      if (d.test(x, z)) return d;
    }
    return DISTRICTS[DISTRICTS.length - 1];
  }

  build() {
    this.buildSky();
    this.buildGround();
    this.buildBlocks();
    this.buildBeach();
    this.buildSkyline();
    this.buildStreetlights();
    this.buildTrafficLights();
    this.buildPlazas();
    this.buildPark();
  }

  buildSky() {
    // Gradient dome: dusky blue zenith -> warm orange horizon.
    const geo = new THREE.SphereGeometry(700, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x2c4a7c) },
        mid: { value: new THREE.Color(0xff9a5c) },
        bottom: { value: new THREE.Color(0xffc98a) },
      },
      vertexShader:
        'varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'varying vec3 vPos; uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;' +
        'void main() { float h = normalize(vPos).y; vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.55, h)) : mix(bottom, mid, smoothstep(-0.08, 0.12, h)); gl_FragColor = vec4(c, 1.0); }',
    });
    this.group.add(new THREE.Mesh(geo, mat));
    // Low sun disc in the west.
    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(46, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe9b8, fog: false })
    );
    sun.position.set(-520, 105, 150);
    sun.lookAt(0, 20, 0);
    this.group.add(sun);
  }

  buildGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1100, 1100),
      new THREE.MeshLambertMaterial({ color: 0x4a4642 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    const roadMat = new THREE.MeshLambertMaterial({ color: 0x33302e });
    const walkMat = new THREE.MeshLambertMaterial({ color: 0x98918a });
    const dashTex = makeDashTexture();
    for (const s of STREETS) {
      // Road along Z (constant x) and along X (constant z).
      for (const alongZ of [true, false]) {
        const road = new THREE.Mesh(new THREE.PlaneGeometry(10, 452), roadMat);
        road.rotation.x = -Math.PI / 2;
        if (!alongZ) road.rotation.z = Math.PI / 2;
        road.position.set(alongZ ? s : 0, 0.02, alongZ ? 0 : s);
        road.receiveShadow = true;
        this.group.add(road);
        for (const side of [-1, 1]) {
          const walk = new THREE.Mesh(new THREE.PlaneGeometry(3, 452), walkMat);
          walk.rotation.x = -Math.PI / 2;
          if (!alongZ) walk.rotation.z = Math.PI / 2;
          walk.position.set(
            alongZ ? s + side * 6.5 : side * 6.5,
            0.03,
            alongZ ? side * 0 + 0 : s + side * 6.5
          );
          // Fix the swapped axis for the X-running sidewalk.
          if (!alongZ) walk.position.set(0, 0.03, s + side * 6.5);
          walk.receiveShadow = true;
          this.group.add(walk);
        }
        const dash = new THREE.Mesh(
          new THREE.PlaneGeometry(1.2, 452),
          new THREE.MeshBasicMaterial({ map: dashTex.clone(), transparent: true })
        );
        dash.material.map.repeat.set(1, 56);
        dash.material.map.needsUpdate = true;
        dash.rotation.x = -Math.PI / 2;
        if (!alongZ) dash.rotation.z = Math.PI / 2;
        dash.position.set(alongZ ? s : 0, 0.05, alongZ ? 0 : s);
        this.group.add(dash);
      }
    }
  }

  buildBlocks() {
    const rng = this.rng;
    const winTexA = makeWindowTexture(mulberry32(11), 0.55);
    const winTexB = makeWindowTexture(mulberry32(23), 0.35);
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x2b2724 });
    const slabMat = new THREE.MeshLambertMaterial({ color: 0x6f6a61 });
    const mats = [];
    for (const tint of BUILDING_TINTS) {
      mats.push(
        new THREE.MeshLambertMaterial({ map: rng() < 0.5 ? winTexA : winTexB, color: tint })
      );
    }
    let signCount = 0;
    for (let ix = 0; ix < STREETS.length - 1; ix++) {
      for (let iz = 0; iz < STREETS.length - 1; iz++) {
        const x0 = STREETS[ix] + 8;
        const x1 = STREETS[ix + 1] - 8;
        const z0 = STREETS[iz] + 8;
        const z1 = STREETS[iz + 1] - 8;
        const cx = (x0 + x1) / 2;
        const cz = (z0 + z1) / 2;
        if (cz > 176) continue; // beach rows
        if (ix === 2 && iz === 2) continue; // central park block (-66, -66)
        if (inClearZone(cx, cz, 14)) continue;
        const slab = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + 2, z1 - z0 + 2), slabMat);
        slab.rotation.x = -Math.PI / 2;
        slab.position.set(cx, 0.015, cz);
        slab.receiveShadow = true;
        this.group.add(slab);
        const nBuild = randInt(rng, 1, 3);
        for (let b = 0; b < nBuild; b++) {
          const w = rand(rng, 9, 15);
          const d = rand(rng, 9, 15);
          const bx = rand(rng, x0 + w / 2, x1 - w / 2);
          const bz = rand(rng, z0 + d / 2, z1 - d / 2);
          if (inClearZone(bx, bz, 10)) continue;
          const distCenter = Math.sqrt(bx * bx + bz * bz);
          const hMax = distCenter < 90 ? 46 : distCenter < 150 ? 30 : 18;
          const h = rand(rng, 8, hMax);
          const mat = pick(rng, mats);
          const mesh = new THREE.Mesh(boxGeo, mat);
          mesh.scale.set(w, h, d);
          mesh.position.set(bx, h / 2, bz);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.group.add(mesh);
          const roof = new THREE.Mesh(boxGeo, roofMat);
          roof.scale.set(w + 0.6, 0.5, d + 0.6);
          roof.position.set(bx, h + 0.25, bz);
          this.group.add(roof);
          if (rng() < 0.3) {
            const tank = new THREE.Mesh(
              new THREE.CylinderGeometry(1.2, 1.2, 2.4, 8),
              new THREE.MeshLambertMaterial({ color: 0x8a7a68 })
            );
            tank.position.set(bx + w / 4, h + 1.4, bz);
            tank.castShadow = true;
            this.group.add(tank);
          }
          this.colliders.push({
            minX: bx - w / 2, maxX: bx + w / 2,
            minZ: bz - d / 2, maxZ: bz + d / 2,
          });
          // Neon sign on the street-facing side.
          if (rng() < 0.4 && signCount < 26) {
            signCount++;
            const name = SHOP_NAMES[signCount % SHOP_NAMES.length];
            const color = pick(rng, NEON_COLORS);
            const tex = makeNeonTexture(name, color);
            const sign = new THREE.Mesh(
              new THREE.PlaneGeometry(9, 2.2),
              new THREE.MeshBasicMaterial({ map: tex, transparent: true })
            );
            // Face the nearest street.
            const faceX = Math.abs(bx - STREETS[ix]) < Math.abs(bx - STREETS[ix + 1]);
            const onXSide = rng() < 0.5;
            if (onXSide) {
              sign.position.set(bx + (faceX ? -1 : 1) * (w / 2 + 0.15), rand(rng, 5, 9), bz);
              sign.rotation.y = faceX ? -Math.PI / 2 : Math.PI / 2;
            } else {
              sign.position.set(bx, rand(rng, 5, 9), bz + (bz > cz ? 1 : -1) * (d / 2 + 0.15));
              sign.rotation.y = bz > cz ? 0 : Math.PI;
            }
            this.group.add(sign);
          }
        }
      }
    }
  }

  buildBeach() {
    const sand = new THREE.Mesh(
      new THREE.PlaneGeometry(1100, 60),
      new THREE.MeshLambertMaterial({ color: 0xe8d3a0 })
    );
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(0, 0.04, BEACH_Z + 26);
    sand.receiveShadow = true;
    this.group.add(sand);
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(1400, 400),
      new THREE.MeshLambertMaterial({ color: 0x2a7fa8, transparent: true, opacity: 0.92 })
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, 0.02, SEA_Z + 200);
    this.group.add(sea);
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(460, 6),
      new THREE.MeshLambertMaterial({ color: 0x8a6a4a })
    );
    board.rotation.x = -Math.PI / 2;
    board.position.set(0, 0.05, BEACH_Z - 3);
    board.receiveShadow = true;
    this.group.add(board);
    // Palms along the boardwalk + beach.
    const rng = this.rng;
    for (let x = -210; x <= 210; x += 14) {
      if (rng() < 0.25) continue;
      this.addPalm(x + rand(rng, -4, 4), BEACH_Z + rand(rng, 2, 30));
    }
    // Beach umbrellas.
    const umbMat = new THREE.MeshLambertMaterial({ color: 0xff5e7a });
    const umbMat2 = new THREE.MeshLambertMaterial({ color: 0x37c8ff });
    for (let i = 0; i < 10; i++) {
      const x = rand(rng, -180, 180);
      const z = BEACH_Z + rand(rng, 12, 40);
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 2.4, 6),
        new THREE.MeshLambertMaterial({ color: 0xffffff })
      );
      pole.position.set(x, 1.2, z);
      this.group.add(pole);
      const top = new THREE.Mesh(
        new THREE.ConeGeometry(1.8, 0.7, 8),
        i % 2 ? umbMat : umbMat2
      );
      top.position.set(x, 2.6, z);
      top.castShadow = true;
      this.group.add(top);
    }
  }

  addPalm(x, z) {
    const rng = this.rng;
    const g = new THREE.Group();
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5a3a });
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x3f8f4f });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 6, 6), trunkMat);
    trunk.position.y = 3;
    trunk.rotation.z = rand(rng, -0.12, 0.12);
    trunk.castShadow = true;
    g.add(trunk);
    for (let i = 0; i < 8; i++) {
      const frond = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 3.4), leafMat);
      const a = (i / 8) * Math.PI * 2;
      frond.position.set(Math.cos(a) * 1.4, 6.1, Math.sin(a) * 1.4);
      frond.rotation.y = -a + Math.PI / 2;
      frond.rotation.x = 0.5;
      frond.castShadow = true;
      g.add(frond);
    }
    g.position.set(x, 0, z);
    this.group.add(g);
  }

  buildSkyline() {
    const mat = new THREE.MeshLambertMaterial({ color: 0x6b4a5a });
    const volcano = new THREE.Mesh(new THREE.ConeGeometry(190, 130, 24), mat);
    volcano.position.set(-330, 0, -330);
    this.group.add(volcano);
    const glow = new THREE.Mesh(
      new THREE.ConeGeometry(30, 22, 12),
      new THREE.MeshBasicMaterial({ color: 0xff7a2f })
    );
    glow.position.set(-330, 118, -330);
    this.group.add(glow);
    const hillMat = new THREE.MeshLambertMaterial({ color: 0x5a4a6a });
    for (const [x, z, r, h] of [[320, -280, 150, 70], [380, 120, 170, 80], [-140, -420, 200, 90]]) {
      const hill = new THREE.Mesh(new THREE.ConeGeometry(r, h, 16), hillMat);
      hill.position.set(x, 0, z);
      this.group.add(hill);
    }
    // Distant city silhouette ring.
    const silMat = new THREE.MeshLambertMaterial({ color: 0x4a3a4a });
    const rng = mulberry32(99);
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const r = 400 + rng() * 80;
      const h = 20 + rng() * 55;
      const b = new THREE.Mesh(new THREE.BoxGeometry(18 + rng() * 14, h, 18), silMat);
      b.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r);
      this.group.add(b);
    }
  }

  buildStreetlights() {
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x2e2a28 });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe6a0 });
    for (const s of STREETS) {
      for (const t of [-176, -88, 0, 88, 176]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7, 6), poleMat);
        pole.position.set(s + 6.8, 3.5, t + 6.8);
        this.group.add(pole);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 0.5), lampMat);
        lamp.position.set(s + 6.2, 7, t + 6.8);
        this.group.add(lamp);
      }
    }
  }

  buildTrafficLights() {
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    const spots = [
      [0, 0], [0, -88], [0, 88], [-88, 0], [88, 0], [-88, -88], [88, 88], [-44, 44],
    ];
    for (const [x, z] of spots) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 5.5, 6), poleMat);
      pole.position.y = 2.75;
      g.add(pole);
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.8, 0.5), poleMat);
      box.position.y = 5.6;
      g.add(box);
      const lamps = [];
      for (let i = 0; i < 3; i++) {
        const lamp = new THREE.Mesh(
          new THREE.SphereGeometry(0.22, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0x331111 })
        );
        lamp.position.set(0, 6.15 - i * 0.55, 0.28);
        g.add(lamp);
        lamps.push(lamp);
      }
      g.position.set(x + 6.2, 0, z + 6.2);
      this.group.add(g);
      this.trafficLights.push({ lamps, phase: Math.random() * 12 });
    }
  }

  buildPlazas() {
    // Marina plaza (mission 1 meet) + Lookout plaza (mission 1 destination).
    const plazaMat = new THREE.MeshLambertMaterial({ color: 0xb8a888 });
    for (const c of [CLEAR_ZONES[0], CLEAR_ZONES[1]]) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(c.r - 2, 28), plazaMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(c.x, 0.04, c.z);
      disc.receiveShadow = true;
      this.group.add(disc);
      // Palms ring the plaza, well outside the trigger radius.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.4;
        this.addPalm(c.x + Math.cos(a) * (c.r - 1), c.z + Math.sin(a) * (c.r - 1));
      }
    }
    // Marina pier + a couple of boats.
    const pier = new THREE.Mesh(
      new THREE.BoxGeometry(6, 0.5, 60),
      new THREE.MeshLambertMaterial({ color: 0x8a6a4a })
    );
    pier.position.set(30, 0.3, 215);
    this.group.add(pier);
    const boatMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const boatMat2 = new THREE.MeshLambertMaterial({ color: 0xffd23f });
    for (const [x, z, m] of [[18, 225, boatMat], [44, 228, boatMat2], [30, 240, boatMat]]) {
      const hull = new THREE.Mesh(new THREE.BoxGeometry(3, 1.2, 8), m);
      hull.position.set(x, 0.5, z);
      this.group.add(hull);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 3), m);
      cabin.position.set(x, 1.6, z - 1);
      this.group.add(cabin);
    }
  }

  buildPark() {
    // Central park block: grass, cone trees, benches + bins (with colliders).
    // Far from every mission marker, so furniture here is safe.
    const cx = -66;
    const cz = -66;
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(28, 28),
      new THREE.MeshLambertMaterial({ color: 0x5a8f4a })
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(cx, 0.03, cz);
    grass.receiveShadow = true;
    this.group.add(grass);
    const rng = this.rng;
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6a4a2a });
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x2f7a3f });
    for (let i = 0; i < 9; i++) {
      const x = cx + rand(rng, -12, 12);
      const z = cz + rand(rng, -12, 12);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 2, 6), trunkMat);
      trunk.position.set(x, 1, z);
      this.group.add(trunk);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(2.2, 5, 8), leafMat);
      cone.position.set(x, 4.5, z);
      cone.castShadow = true;
      this.group.add(cone);
    }
    const benchMat = new THREE.MeshLambertMaterial({ color: 0x7a5a3a });
    const binMat = new THREE.MeshLambertMaterial({ color: 0x3a7a4a });
    for (const [bx, bz] of [[-72, -60], [-60, -72], [-70, -70], [-62, -62]]) {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.7), benchMat);
      bench.position.set(bx, 0.45, bz);
      bench.castShadow = true;
      this.group.add(bench);
      this.colliders.push({ minX: bx - 1.1, maxX: bx + 1.1, minZ: bz - 0.35, maxZ: bz + 0.35 });
      const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.35, 0.9, 8), binMat);
      bin.position.set(bx + 1.8, 0.45, bz);
      this.group.add(bin);
      this.colliders.push({ minX: bx + 1.4, maxX: bx + 2.2, minZ: bz - 0.4, maxZ: bz + 0.4 });
    }
  }

  update(dt, t) {
    // Traffic lights cycle: green 5s -> yellow 1.5s -> red 5s -> repeat.
    for (const tl of this.trafficLights) {
      const phase = (t + tl.phase) % 11.5;
      const red = phase >= 6.5;
      const yellow = phase >= 5 && phase < 6.5;
      tl.lamps[0].material.color.setHex(red ? 0xff2222 : 0x331111);
      tl.lamps[1].material.color.setHex(yellow ? 0xffcc22 : 0x332211);
      tl.lamps[2].material.color.setHex(!red && !yellow ? 0x22ff55 : 0x113311);
    }
  }
}
