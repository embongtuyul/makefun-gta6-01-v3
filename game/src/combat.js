// combat.js — on-foot combat: fists (punch) and the .38 revolver.
// Click / left mouse attacks with the selected weapon (slots 1–2 only;
// SMG/12G/AR-9 stay LOCKED). Ammo pickups around the city refill the
// reserve with E. Hitting a pedestrian raises the wanted level.

import * as THREE from 'three';
import { dist2D } from './utils.js';

const PUNCH_RANGE = 2.6;
const PUNCH_ANGLE = 0.9; // ~52-degree half-angle: generous, fist-sized
const GUN_RANGE = 40;
const GUN_ANGLE = 0.07; // ~4-degree half-angle: hit-scan, needs aim
const CLIP_SIZE = 12;
const RESERVE_MAX = 96;
const PUNCH_COOLDOWN = 0.45;

// Ammo boxes sit on sidewalks / intersections — always reachable.
const PICKUP_SPOTS = [
  { x: 6.5, z: 88 },
  { x: -44, z: 6.5 },
  { x: 88, z: -44 },
  { x: -88, z: 132 },
  { x: 132, z: 44 },
];

export class Combat {
  constructor(world) {
    this.world = world;
    this.clip = 12;
    this.reserve = 48;
    this.punchCooldown = 0;
    this.flashTimer = 0;
    this.tracerTimer = 0;
    this.pickups = [];
    this.buildPickups();
    this.buildEffects();
  }

  buildPickups() {
    const geo = new THREE.BoxGeometry(0.5, 0.35, 0.35);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd23f });
    const bandMat = new THREE.MeshBasicMaterial({ color: 0xff7a2f });
    for (const s of PICKUP_SPOTS) {
      const g = new THREE.Group();
      const box = new THREE.Mesh(geo, mat);
      box.position.y = 0.7;
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.37), bandMat);
      band.position.y = 0.7;
      g.add(box);
      g.add(band);
      g.position.set(s.x, 0, s.z);
      this.world.scene.add(g);
      this.pickups.push({ group: g, x: s.x, z: s.z, taken: false, phase: Math.random() * 6 });
    }
  }

  buildEffects() {
    // Muzzle flash: a small additive sphere, shown for one blink.
    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffd23f, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    this.flash.visible = false;
    this.world.scene.add(this.flash);
    // Tracer: a 2-point line from the muzzle to the hit point.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.tracer = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9 })
    );
    this.tracer.visible = false;
    this.tracer.frustumCulled = false;
    this.world.scene.add(this.tracer);
  }

  // The player's forward vector on the ground plane.
  forward() {
    const p = this.world.player;
    return { x: Math.sin(p.yaw), z: Math.cos(p.yaw) };
  }

  // Left mouse click while playing on foot.
  attack() {
    const w = this.world;
    if (w.player.inCar || w.missions.dialogueOpen) return;
    const slot = w.hud.activeWeapon;
    if (slot === 0) this.punch();
    else if (slot === 1) this.shoot();
    else w.hud.notice('WEAPON LOCKED — slots 1–2 only, for now', 1.6);
  }

  punch() {
    if (this.punchCooldown > 0) return;
    this.punchCooldown = PUNCH_COOLDOWN;
    const w = this.world;
    const p = w.player;
    p.punchT = 0.25; // the player mesh swings its arm
    w.audio.punch();
    const f = this.forward();
    const ped = w.peds.nearestInCone(p.pos.x, p.pos.z, f.x, f.z, PUNCH_RANGE, PUNCH_ANGLE);
    if (ped) {
      w.peds.knockDown(ped, 3);
      w.police.addWanted(1);
      w.state.stats.pedsHit++;
    }
  }

  shoot() {
    const w = this.world;
    if (this.clip <= 0) {
      w.audio.dryFire();
      w.hud.notice('CLICK — press R to RELOAD', 1.5);
      return;
    }
    this.clip--;
    w.audio.shot();
    const p = w.player;
    const f = this.forward();
    const origin = new THREE.Vector3(p.pos.x + f.x * 0.8, 1.4, p.pos.z + f.z * 0.8);
    const ped = w.peds.nearestInCone(p.pos.x, p.pos.z, f.x, f.z, GUN_RANGE, GUN_ANGLE);
    let end;
    if (ped) {
      const pp = ped.mesh.position;
      end = new THREE.Vector3(pp.x, 1.2, pp.z);
      w.peds.knockDown(ped, 6);
      w.police.addWanted(1);
      w.state.stats.pedsHit++;
    } else {
      end = new THREE.Vector3(p.pos.x + f.x * GUN_RANGE, 1.4, p.pos.z + f.z * GUN_RANGE);
    }
    this.flash.position.copy(origin);
    this.flash.visible = true;
    this.flashTimer = 0.06;
    const pos = this.tracer.geometry.attributes.position;
    pos.setXYZ(0, origin.x, origin.y, origin.z);
    pos.setXYZ(1, end.x, end.y, end.z);
    pos.needsUpdate = true;
    this.tracer.visible = true;
    this.tracerTimer = 0.08;
    if (this.clip === 0) w.hud.notice('MAGAZINE EMPTY — press R to RELOAD', 2);
  }

  reload() {
    const w = this.world;
    if (this.clip >= CLIP_SIZE || this.reserve <= 0) return;
    const take = Math.min(CLIP_SIZE - this.clip, this.reserve);
    this.clip += take;
    this.reserve -= take;
    w.audio.reload();
    w.hud.notice(`RELOADED — ${this.clip}/${this.reserve}`, 1.2);
  }

  // E near an ammo box (called when no mission trigger takes the key).
  tryPickup() {
    const w = this.world;
    const p = w.player.pos;
    for (const pk of this.pickups) {
      if (pk.taken) continue;
      if (dist2D(p.x, p.z, pk.x, pk.z) <= 3) {
        pk.taken = true;
        pk.group.visible = false;
        this.reserve = Math.min(RESERVE_MAX, this.reserve + 24);
        w.audio.blip();
        w.hud.notice('+24 .38 AMMO', 1.5);
        return true;
      }
    }
    return false;
  }

  update(dt) {
    if (this.punchCooldown > 0) this.punchCooldown -= dt;
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) this.flash.visible = false;
    }
    if (this.tracerTimer > 0) {
      this.tracerTimer -= dt;
      if (this.tracerTimer <= 0) this.tracer.visible = false;
    }
    for (const pk of this.pickups) {
      if (pk.taken) continue;
      pk.phase += dt * 2;
      pk.group.position.y = Math.sin(pk.phase) * 0.1;
      pk.group.rotation.y += dt * 1.2;
    }
  }
}
