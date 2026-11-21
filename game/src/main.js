// main.js — bootstrap + game loop: renderer, golden-hour lighting,
// third-person / chase cameras, input, start + pause menus, screenshot
// poses (?pose=street|mission|chase) and the debug handle window.__solmara.

import * as THREE from 'three';
import { City } from './city.js';
import { Player } from './player.js';
import { Vehicles } from './vehicles.js';
import { Pedestrians } from './pedestrians.js';
import { Missions, MISSIONS } from './missions.js';
import { Police } from './police.js';
import { Combat } from './combat.js';
import { Autopilot } from './autopilot.js';
import { drawIslandMap } from './islandmap.js';
import { HUD } from './hud.js';
import { AudioSys } from './audio.js';
import { clamp, damp } from './utils.js';

const params = new URLSearchParams(window.location.search);
const POSE = params.get('pose') || null;
const AUTOSTART = params.get('autostart') === '1' || !!POSE;
// ?lowgfx=1: no shadows/antialias, pixel ratio 1 — for software renderers
// (headless QA) and low-end machines. Game logic is identical.
const LOWGFX = params.get('lowgfx') === '1';

class Game {
  constructor() {
    this.state = 'menu'; // menu | playing | paused
    this.t = 0;
    this.shakeT = 0;
    this.shakeMag = 0;
    this.hintUntil = 0;
    this.lastStage = 0;
    this.poseTimer = 0;
    this.poseDone = false;
    this.ready = false;

    this.renderer = new THREE.WebGLRenderer({ antialias: !LOWGFX });
    this.renderer.setPixelRatio(LOWGFX ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = !LOWGFX;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    document.getElementById('game-container').appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xe8905a, 130, 520);
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1500);
    this.camera.position.set(0, 4, 18);

    // Golden-hour sun: low in the west, long shadows.
    const sun = new THREE.DirectionalLight(0xffb066, 2.6);
    sun.position.set(-140, 75, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -180;
    sun.shadow.camera.right = 180;
    sun.shadow.camera.top = 180;
    sun.shadow.camera.bottom = -180;
    sun.shadow.camera.far = 500;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x8a5a3b, 0.85));

    // Shared world object handed to every system.
    this.world = {
      scene: this.scene,
      camera: this.camera,
      state: {
        money: 350, rp: 0, rank: 1, gameMinutes: 17 * 60 + 40,
        stats: { carsStolen: 0, pedsHit: 0, missionsDone: 0, cashEarned: 0 },
        discovered: new Set(), // district names the player has visited
      },
      input: { keys: new Set() },
      addRP: (n) => this.addRP(n),
      onCrash: (speed) => this.onCrash(speed),
    };
    const w = this.world;
    w.city = new City(this.scene);
    w.player = new Player(w);
    w.vehicles = new Vehicles(w);
    w.peds = new Pedestrians(w);
    w.audio = new AudioSys();
    w.hud = new HUD(w);
    w.missions = new Missions(w);
    w.police = new Police(w);
    w.combat = new Combat(w);
    w.autopilot = new Autopilot(w);

    this.bindInput();
    this.bindMenus();
    window.addEventListener('resize', () => this.onResize());
    window.__solmara = { world: w, game: this, version: 'v3-chunkB' };

    if (AUTOSTART) {
      this.startGame(false);
      this.applyPose();
    }
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  addRP(n) {
    const st = this.world.state;
    st.rp += n;
    while (st.rp >= st.rank * 300) {
      st.rank++;
    }
  }

  onCrash(speed) {
    this.shakeT = 0.35;
    this.shakeMag = Math.min(0.45, speed * 0.02);
    this.world.audio.crash();
    if (speed > 12) {
      let dmg = (speed - 12) * 0.8;
      const p = this.world.player;
      const absorbed = Math.min(p.armour, dmg);
      p.armour -= absorbed;
      dmg -= absorbed;
      p.health -= dmg;
      this.world.hud.damageFlash();
    }
  }

  bindInput() {
    const keys = this.world.input.keys;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      keys.add(e.code);
      if (this.state === 'menu' && (e.code === 'Enter' || e.code === 'Space')) {
        this.startGame(true);
        return;
      }
      if (this.state !== 'playing') return;
      // Any driving input cancels the autopilot.
      if (
        this.world.autopilot.active &&
        (e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' ||
          e.code === 'KeyD' || e.code === 'Space')
      ) {
        this.world.autopilot.deactivate('AUTOPILOT OFF');
      }
      if (e.code === 'F9') {
        this.world.autopilot.toggle();
      }
      if (e.code === 'KeyR') {
        this.world.combat.reload();
      }
      if (e.code === 'Enter' || e.code === 'KeyE') {
        // Mission trigger first; if nothing takes the key, try an ammo pickup.
        if (!this.world.missions.tryInteract()) {
          this.world.combat.tryPickup();
        }
      }
      if (e.code === 'KeyF' && !this.world.missions.dialogueOpen) {
        const w = this.world;
        if (w.player.inCar) {
          w.autopilot.deactivate();
          w.vehicles.exitCar(w.player);
        } else {
          const car = w.vehicles.tryEnter(w.player);
          if (car) {
            w.state.stats.carsStolen++;
            w.police.addWanted(1);
            w.hud.setPrompt(null);
          }
        }
      }
      if (e.code.startsWith('Digit')) {
        const n = parseInt(e.code.slice(5), 10);
        if (n >= 1 && n <= 5) this.world.hud.setWeapon(n - 1);
      }
      if (e.code === 'KeyP') this.pauseGame();
    });
    window.addEventListener('keyup', (e) => keys.delete(e.code));
    window.addEventListener('blur', () => keys.clear());
    // Left click attacks on foot (punch / shoot with the selected weapon).
    this.renderer.domElement.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (this.state === 'playing') this.world.combat.attack();
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement && this.state === 'playing') {
        this.world.player.look(e.movementX, e.movementY);
      }
    });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.state === 'playing' && !AUTOSTART) {
        this.pauseGame();
      }
    });
  }

  bindMenus() {
    document.getElementById('play-btn').addEventListener('click', () => this.startGame(true));
    document.getElementById('resume-btn').addEventListener('click', () => this.resumeGame());
    document.getElementById('restart-btn').addEventListener('click', () => window.location.reload());
  }

  startGame(lockPointer) {
    this.state = 'playing';
    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('pause-menu').classList.add('hidden');
    this.world.audio.init();
    if (lockPointer) {
      // Pointer lock can fail without a user gesture (headless QA);
      // swallow the rejection — the game plays fine without it.
      const p = this.renderer.domElement.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    }
  }

  pauseGame() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.fillPauseStats();
    document.getElementById('pause-menu').classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  resumeGame() {
    this.state = 'playing';
    document.getElementById('pause-menu').classList.add('hidden');
    const p = this.renderer.domElement.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  }

  fillPauseStats() {
    const st = this.world.state;
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    set('stat-money', `$${st.money}`);
    set('stat-cars', String(st.stats.carsStolen));
    set('stat-peds', String(st.stats.pedsHit));
    set('stat-missions', `${st.stats.missionsDone}/8`);
    set('stat-earned', `$${st.stats.cashEarned}`);
    set('stat-rank', `RANK ${st.rank} · ${st.rp} RP`);
    // Story mission list, rendered from the real mission data.
    const list = document.getElementById('pause-missions');
    if (list) {
      const m = this.world.missions;
      const small = new Set(['to', 'of', 'the', 'and']);
      const titleCase = (t) =>
        t.toLowerCase().split(' ').map((word, i) =>
          i > 0 && small.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
      list.innerHTML = MISSIONS.map((mission, i) => {
        let cls = 'mission-locked';
        let mark = '🔒';
        if (i < m.missionIndex || m.completed) {
          cls = 'mission-done';
          mark = '✓';
        } else if (i === m.missionIndex) {
          cls = 'mission-current';
          mark = '▶';
        }
        return `<div class="${cls}">${i + 1}. ${titleCase(mission.title)} — <b>$${mission.payout.toLocaleString()}</b> ${mark}</div>`;
      }).join('');
    }
    // Full island map.
    const canvas = document.getElementById('island-map');
    if (canvas) drawIslandMap(canvas, this.world);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // Screenshot poses: deterministic scene setups for real captures.
  applyPose() {
    const w = this.world;
    if (POSE === 'street') {
      // Spawn view: on foot, looking down the street toward the marina.
      w.player.pos.set(0, 0, 24);
      w.player.yaw = 0;
      w.player.pitch = -0.08;
    } else if (POSE === 'mission') {
      // Dialogue open with Lina at the marina.
      w.player.pos.set(30, 0, 145.5);
      w.player.yaw = 0;
      w.player.pitch = -0.05;
      this.poseTimer = 0.6;
    } else if (POSE === 'chase') {
      // Player driving south in the southbound lane, wanted 3,
      // police + helicopter in pursuit.
      w.missions.stageIndex = 1;
      this.lastStage = 1; // no "grab a car" hint — already driving
      w.missions.updateMarkerPosition();
      w.player.pos.set(2.4, 0, 46);
      const car = w.vehicles.tryEnter(w.player);
      if (car) {
        car.heading = 0;
        car.speed = 16;
        car.pos.set(2.4, 0, 46);
      }
      w.police.addWanted(3);
      this.poseTimer = 1.2;
    }
  }

  runPoseStep() {
    const w = this.world;
    if (POSE === 'mission' && !this.poseDone) {
      this.poseDone = true;
      w.missions.fireTrigger();
    } else if (POSE === 'chase' && !this.poseDone) {
      this.poseDone = true;
      // Stage the pursuit for the shot: one cruiser pulling alongside
      // ahead (visible in frame), one right behind the player.
      const car = w.vehicles.playerCar;
      if (car) {
        const fx = Math.sin(car.heading);
        const fz = Math.cos(car.heading);
        const rx = Math.cos(car.heading);
        const rz = -Math.sin(car.heading);
        w.police.policeCars.forEach((pc, i) => {
          if (i === 0) {
            pc.pos.set(car.pos.x + fx * 11 - rx * 4.5, 0, car.pos.z + fz * 11 - rz * 4.5);
          } else {
            pc.pos.set(car.pos.x - fx * (12 + i * 6) + rx * 3, 0, car.pos.z - fz * (12 + i * 6) + rz * 3);
          }
          pc.heading = car.heading;
          pc.speed = 18;
        });
        // Put the helicopter ahead of the car, hovering over the road in
        // the camera's view.
        if (w.police.heli) {
          w.police.heliFollowOffset = { x: 2, z: 48, y: 20 };
        }
      }
    }
  }

  updatePrompts() {
    const w = this.world;
    if (w.missions.dialogueOpen || this.state !== 'playing') {
      w.hud.setPrompt(null);
      return;
    }
    // Timed notices (combat, autopilot) take priority over hints.
    if (w.hud.noticeTimer > 0) {
      w.hud.setPrompt(w.hud.noticeText);
      return;
    }
    // Stage-change hint (6s).
    if (w.missions.stageIndex !== this.lastStage) {
      this.lastStage = w.missions.stageIndex;
      const s = w.missions.stage;
      if (s) {
        w.hud.setPrompt(s.hint);
        this.hintUntil = this.t + 6;
        return;
      }
    }
    if (this.t < this.hintUntil) return;
    const p = w.player.pos;
    if (!w.player.inCar) {
      const car = w.vehicles.nearestParked(p.x, p.z, 4.5);
      if (car) {
        w.hud.setPrompt('F — STEAL CAR');
        return;
      }
    }
    const s = w.missions.stage;
    if (s && s.dialogue) {
      const d = Math.hypot(p.x - s.target.x, p.z - s.target.z);
      if (d <= s.interactRadius) {
        w.hud.setPrompt('E — TALK');
        return;
      }
    }
    w.hud.setPrompt(null);
  }

  updateCamera(dt) {
    const w = this.world;
    const car = w.vehicles.playerCar;
    let desired;
    let lookAt;
    if (car) {
      // Chase camera behind the car — high and far enough that the car
      // reads as a car, not a roof filling the frame.
      const back = new THREE.Vector3(-Math.sin(car.heading), 0, -Math.cos(car.heading));
      desired = new THREE.Vector3(
        car.pos.x + back.x * 10.5,
        4.6,
        car.pos.z + back.z * 10.5
      );
      lookAt = new THREE.Vector3(
        car.pos.x + Math.sin(car.heading) * 9,
        1.6,
        car.pos.z + Math.cos(car.heading) * 9
      );
      const speed01 = clamp(Math.abs(car.speed) / 38, 0, 1);
      const targetFov = 62 + speed01 * 10;
      if (Math.abs(this.camera.fov - targetFov) > 0.4) {
        this.camera.fov = damp(this.camera.fov, targetFov, 4, dt);
        this.camera.updateProjectionMatrix();
      }
    } else {
      // Third-person follow behind the player's view direction.
      const p = w.player;
      const cp = Math.cos(p.pitch);
      const sp = Math.sin(p.pitch);
      const fx = Math.sin(p.yaw) * cp;
      const fy = sp;
      const fz = Math.cos(p.yaw) * cp;
      const target = new THREE.Vector3(p.pos.x, p.pos.y + 1.7, p.pos.z);
      desired = new THREE.Vector3(
        target.x - fx * 6.5,
        Math.max(0.6, target.y - fy * 6.5 + 0.9),
        target.z - fz * 6.5
      );
      lookAt = new THREE.Vector3(target.x + fx * 4, target.y + fy * 4, target.z + fz * 4);
      if (Math.abs(this.camera.fov - 62) > 0.4) {
        this.camera.fov = damp(this.camera.fov, 62, 4, dt);
        this.camera.updateProjectionMatrix();
      }
    }
    const lambda = car ? 5 : 9;
    this.camera.position.x = damp(this.camera.position.x, desired.x, lambda, dt);
    this.camera.position.y = damp(this.camera.position.y, desired.y, lambda, dt);
    this.camera.position.z = damp(this.camera.position.z, desired.z, lambda, dt);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const m = this.shakeMag * (this.shakeT / 0.35);
      this.camera.position.x += (Math.random() - 0.5) * m;
      this.camera.position.y += (Math.random() - 0.5) * m;
    }
    this.camera.lookAt(lookAt);
  }

  checkDeath() {
    const p = this.world.player;
    if (p.health > 0) return;
    // Wasted: respawn at the spawn point, hospital bill, wanted cleared.
    this.world.autopilot.deactivate();
    p.health = 100;
    p.armour = 0;
    p.pos.set(0, 0, 30);
    p.yaw = 0;
    if (p.inCar) {
      this.world.vehicles.exitCar(p);
      p.pos.set(0, 0, 30);
    }
    this.world.state.money = Math.max(0, this.world.state.money - 100);
    this.world.police.clearWanted();
    this.world.hud.showBanner('WASTED', 'Hospital bill: $100 — back on your feet');
  }

  frame() {
    // dt clamp 0.1s: the game stays at full speed down to 10 FPS, which
    // keeps it playable on slow/software renderers; steps stay small
    // enough that nothing tunnels through the (thick) colliders.
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (this.state === 'playing') {
      this.t += dt;
      const w = this.world;
      if (this.poseTimer > 0) {
        this.poseTimer -= dt;
        if (this.poseTimer <= 0) this.runPoseStep();
      }
      const frozen = w.missions.dialogueOpen;
      let input = frozen ? { keys: new Set() } : w.input;
      // Autopilot drives the car (replaces the player's input).
      if (!frozen && w.autopilot.active && w.player.inCar && w.vehicles.playerCar) {
        input = { keys: w.autopilot.keys(w.vehicles.playerCar, dt) };
      }
      // Chase pose: hold W virtually so the car is actually racing.
      if (POSE === 'chase' && !frozen) {
        const keys = new Set(w.input.keys);
        keys.add('KeyW');
        input = { keys };
      }
      w.city.update(dt, this.t);
      w.player.update(dt, input);
      w.vehicles.update(dt, input, w.player);
      w.peds.update(dt);
      w.missions.update(dt, this.t);
      w.police.update(dt, this.t);
      w.combat.update(dt);
      // Pedestrian hits while driving.
      const car = w.vehicles.playerCar;
      if (car && Math.abs(car.speed) > 3) {
        const hit = w.peds.checkCarHit(car.pos.x, car.pos.z, car.speed);
        if (hit.length > 0) {
          w.state.stats.pedsHit += hit.length;
          w.police.addWanted(1);
        }
      }
      w.audio.engine(car ? clamp(Math.abs(car.speed) / 38, 0, 1) : 0, !!car);
      this.updatePrompts();
      this.checkDeath();
      w.hud.update(dt);
      this.updateCamera(dt);
    }
    this.renderer.render(this.scene, this.camera);
    if (!this.ready) {
      this.ready = true;
      window.__solmara.ready = true;
    }
  }
}

new Game();
