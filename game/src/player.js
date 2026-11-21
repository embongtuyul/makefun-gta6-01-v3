// player.js — the on-foot character: third-person movement, mouse look,
// jumping, collision against buildings and cars, simple walk animation.

import * as THREE from 'three';
import { clamp, damp, collideCircleBoxes } from './utils.js';

const WALK_SPEED = 6;
const SPRINT_SPEED = 9.5;
const JUMP_VELOCITY = 8.5;
const GRAVITY = 22;
const PLAYER_RADIUS = 0.55;

export class Player {
  constructor(world) {
    this.world = world;
    this.pos = new THREE.Vector3(0, 0, 30); // spawn on 0th street
    this.yaw = 0; // facing +z (south, toward the marina)
    this.pitch = -0.12;
    this.vy = 0;
    this.onGround = true;
    this.inCar = false;
    this.moving = false;
    this.walkPhase = 0;
    this.punchT = 0; // >0 while a punch swing is playing (set by combat)
    this.health = 100;
    this.armour = 40;
    this.group = this.buildMesh();
    world.scene.add(this.group);
  }

  buildMesh() {
    const g = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: 0xd9a077 });
    const shirt = new THREE.MeshLambertMaterial({ color: 0x2f8f83 }); // teal shirt
    const pants = new THREE.MeshLambertMaterial({ color: 0x2a2f45 });
    const hair = new THREE.MeshLambertMaterial({ color: 0x1c1410 });
    // Legs
    this.legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.8, 0.26), pants);
    this.legL.position.set(-0.14, 0.4, 0);
    this.legR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.8, 0.26), pants);
    this.legR.position.set(0.14, 0.4, 0);
    // Torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), shirt);
    torso.position.y = 1.16;
    // Arms
    this.armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.66, 0.22), shirt);
    this.armL.position.set(-0.42, 1.16, 0);
    this.armR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.66, 0.22), shirt);
    this.armR.position.set(0.42, 1.16, 0);
    // Head + cap
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), skin);
    head.position.y = 1.72;
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.27, 0.12, 12),
      new THREE.MeshLambertMaterial({ color: 0xffd23f })
    );
    cap.position.y = 1.88;
    const brim = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.04, 0.24),
      new THREE.MeshLambertMaterial({ color: 0xffd23f })
    );
    brim.position.set(0, 1.86, 0.26);
    for (const m of [this.legL, this.legR, torso, this.armL, this.armR, head, cap, brim]) {
      m.castShadow = true;
      g.add(m);
    }
    return g;
  }

  // Mouse look: dx > 0 (mouse right) turns the view right (yaw decreases).
  look(dx, dy) {
    this.yaw -= dx * 0.0024;
    this.pitch = clamp(this.pitch - dy * 0.0022, -0.55, 0.45);
  }

  update(dt, input) {
    if (this.inCar) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const keys = input.keys;
    const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = sprint ? SPRINT_SPEED : WALK_SPEED;
    let fwd = 0;
    let strafe = 0;
    if (keys.has('KeyW')) fwd += 1;
    if (keys.has('KeyS')) fwd -= 1;
    if (keys.has('KeyD')) strafe += 1;
    if (keys.has('KeyA')) strafe -= 1;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // Forward is (sin yaw, cos yaw); right is (cos yaw, -sin yaw).
    let mx = sin * fwd + cos * strafe;
    let mz = cos * fwd - sin * strafe;
    const len = Math.sqrt(mx * mx + mz * mz);
    this.moving = len > 0.01;
    if (this.moving) {
      mx /= len;
      mz /= len;
      this.pos.x += mx * speed * dt;
      this.pos.z += mz * speed * dt;
      this.walkPhase += dt * (sprint ? 13 : 9);
    }
    // Jump + gravity.
    if (keys.has('Space') && this.onGround) {
      this.vy = JUMP_VELOCITY;
      this.onGround = false;
    }
    this.pos.y += this.vy * dt;
    this.vy -= GRAVITY * dt;
    if (this.pos.y <= 0) {
      this.pos.y = 0;
      this.vy = 0;
      this.onGround = true;
    }
    // Collide with buildings and parked cars.
    const boxes = this.world.city.colliders;
    const res = collideCircleBoxes(this.pos.x, this.pos.z, PLAYER_RADIUS, boxes);
    this.pos.x = res.x;
    this.pos.z = res.z;
    for (const car of this.world.vehicles.parked) {
      const dx = this.pos.x - car.pos.x;
      const dz = this.pos.z - car.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const min = PLAYER_RADIUS + 1.6;
      if (d < min && d > 1e-4) {
        this.pos.x = car.pos.x + (dx / d) * min;
        this.pos.z = car.pos.z + (dz / d) * min;
      }
    }
    // World bounds.
    this.pos.x = clamp(this.pos.x, -218, 218);
    this.pos.z = clamp(this.pos.z, -218, 234);
    // Walk swing animation.
    const swing = this.moving ? Math.sin(this.walkPhase) * 0.55 : 0;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.8;
    this.armR.rotation.x = swing * 0.8;
    // Punch swing overrides the right arm (peaks mid-swing).
    if (this.punchT > 0) {
      this.punchT -= dt;
      const k = Math.sin((Math.max(this.punchT, 0) / 0.25) * Math.PI);
      this.armR.rotation.x = -1.6 * k;
    }
    const bob = this.moving ? Math.abs(Math.sin(this.walkPhase)) * 0.06 : 0;
    this.group.position.set(this.pos.x, this.pos.y + bob, this.pos.z);
    // Face movement direction when moving, else face camera yaw.
    if (this.moving) {
      const targetYaw = Math.atan2(mx, mz);
      this.group.rotation.y = damp(this.group.rotation.y, targetYaw, 12, dt);
      // Keep the angle continuous: damp across the wrap is handled by atan2 range.
      if (Math.abs(this.group.rotation.y - targetYaw) > Math.PI) {
        this.group.rotation.y = targetYaw;
      }
    } else {
      this.group.rotation.y = this.yaw;
    }
  }
}
