// pedestrians.js — sidewalk walkers. They stroll along the streets,
// turn at the world edge, and get knocked down if a car hits them
// (which raises the wanted level — see police.js).

import * as THREE from 'three';
import { mulberry32, rand, randInt, pick, dist2D } from './utils.js';
import { STREETS } from './city.js';

const SHIRT_COLORS = [0xe8e8e8, 0xff8c2f, 0x37c8c8, 0xc23b2e, 0x8a4fb5, 0x3aa655, 0xe8d44d, 0x5a6a8a];
const PANTS_COLORS = [0x2a2f45, 0x3a3a3a, 0x5a4a3a, 0x2f4a5a];

export class Pedestrians {
  constructor(world) {
    this.world = world;
    this.rng = mulberry32(4242);
    this.peds = [];
    this.spawn();
  }

  buildMesh(shirt, pants, skin) {
    const g = new THREE.Group();
    const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
    const pantsMat = new THREE.MeshLambertMaterial({ color: pants });
    const skinMat = new THREE.MeshLambertMaterial({ color: skin });
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.75, 0.24), pantsMat);
    legL.position.set(-0.13, 0.38, 0);
    const legR = legL.clone();
    legR.position.x = 0.13;
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.68, 0.32), shirtMat);
    torso.position.y = 1.1;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), skinMat);
    head.position.y = 1.64;
    for (const m of [legL, legR, torso, head]) {
      m.castShadow = true;
      g.add(m);
    }
    g.userData.legL = legL;
    g.userData.legR = legR;
    return g;
  }

  spawn() {
    const rng = this.rng;
    for (let i = 0; i < 22; i++) {
      const alongZ = rng() < 0.5;
      const street = pick(rng, STREETS);
      const side = rng() < 0.5 ? 1 : -1;
      const dir = rng() < 0.5 ? 1 : -1;
      const mesh = this.buildMesh(
        pick(rng, SHIRT_COLORS),
        pick(rng, PANTS_COLORS),
        pick(rng, [0xd9a077, 0xb07a4f, 0x8a5a3a, 0xf0c8a0])
      );
      const ped = {
        mesh,
        alongZ,
        street,
        side,
        dir,
        along: rand(rng, -200, 200),
        speed: rand(rng, 1.1, 1.9),
        phase: rand(rng, 0, 6.28),
        down: false,
        downTimer: 0,
      };
      this.place(ped);
      this.world.scene.add(mesh);
      this.peds.push(ped);
    }
  }

  place(ped) {
    // Sidewalk offset: 6.5m from the street centre line.
    if (ped.alongZ) {
      ped.mesh.position.set(ped.street + ped.side * 6.5, 0, ped.along);
      ped.mesh.rotation.y = ped.dir > 0 ? 0 : Math.PI;
    } else {
      ped.mesh.position.set(ped.along, 0, ped.street + ped.side * 6.5);
      ped.mesh.rotation.y = ped.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
  }

  update(dt) {
    for (const ped of this.peds) {
      if (ped.down) {
        ped.downTimer -= dt;
        if (ped.downTimer <= 0) {
          ped.down = false;
          ped.mesh.rotation.x = 0;
          ped.mesh.position.y = 0;
        }
        continue;
      }
      ped.along += ped.dir * ped.speed * dt;
      if (ped.along > 208 || ped.along < -208) {
        ped.dir *= -1;
        ped.along = Math.max(-208, Math.min(208, ped.along));
      }
      ped.phase += dt * 7;
      const swing = Math.sin(ped.phase) * 0.5;
      ped.mesh.userData.legL.rotation.x = swing;
      ped.mesh.userData.legR.rotation.x = -swing;
      this.place(ped);
    }
  }

  // Knock one ped down for `seconds` (no gore — they get up after).
  // Shared by car hits and combat. Returns true when it knocked down.
  knockDown(ped, seconds) {
    if (ped.down) return false;
    ped.down = true;
    ped.downTimer = seconds;
    ped.mesh.rotation.x = Math.PI / 2;
    ped.mesh.position.y = 0.3;
    return true;
  }

  // Returns peds hit by a car at (x, z) moving at speed. Knocked-down
  // peds stay down for 6s, then get up.
  checkCarHit(x, z, speed) {
    if (Math.abs(speed) < 3) return [];
    const hit = [];
    for (const ped of this.peds) {
      if (ped.down) continue;
      const p = ped.mesh.position;
      if (dist2D(x, z, p.x, p.z) < 2.2) {
        this.knockDown(ped, 6);
        hit.push(ped);
      }
    }
    return hit;
  }

  // Nearest standing ped within `maxDist` of (x, z) whose direction from
  // the player is within `maxAngle` radians of the forward vector
  // (fx, fz). Used by combat.
  nearestInCone(x, z, fx, fz, maxDist, maxAngle) {
    let best = null;
    let bestD = maxDist;
    for (const ped of this.peds) {
      if (ped.down) continue;
      const p = ped.mesh.position;
      const dx = p.x - x;
      const dz = p.z - z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > bestD || d < 0.01) continue;
      const dot = (dx * fx + dz * fz) / d;
      if (dot < Math.cos(maxAngle)) continue;
      best = ped;
      bestD = d;
    }
    return best;
  }
}
