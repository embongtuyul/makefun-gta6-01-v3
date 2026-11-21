// police.js — wanted level, pursuing police cars, helicopter search.
// Stars rise on crime (stealing a car, hitting a pedestrian); at 2+
// stars police cars chase, at 3+ a helicopter circles overhead.

import * as THREE from 'three';
import { clamp, dist2D, angleLerp } from './utils.js';
import { Car } from './vehicles.js';
import { STREETS } from './city.js';

export class Police {
  constructor(world) {
    this.world = world;
    this.wanted = 0;
    this.policeCars = [];
    this.heli = null;
    this.heliAngle = 0;
    this.heliFollowOffset = null; // chase-pose staging: hover at a fixed offset from the player
    this.decayTimer = 0;
    this.sinceCrime = 999;
  }

  addWanted(n) {
    const before = this.wanted;
    this.wanted = clamp(this.wanted + n, 0, 5);
    this.sinceCrime = 0;
    this.decayTimer = 0;
    if (this.wanted >= 2 && before < 2) this.world.hud.flashWanted();
  }

  clearWanted() {
    this.wanted = 0;
    this.removeAll();
  }

  removeAll() {
    for (const c of this.policeCars) this.world.scene.remove(c.group);
    this.policeCars = [];
    if (this.heli) {
      this.world.scene.remove(this.heli.group);
      this.heli = null;
    }
  }

  spawnPoliceCar() {
    const p = this.world.player.pos;
    // Spawn on a nearby street, 45-60m from the player.
    let best = null;
    let bestD = 1e9;
    for (const s of STREETS) {
      const d = Math.abs(s - p.x);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    const dir = Math.random() < 0.5 ? 1 : -1;
    const car = new Car(0xffffff, true);
    car.isPolice = true;
    car.stuckTimer = 0;
    car.pos.set(best + 2.4, 0, p.z + dir * 50);
    car.heading = dir > 0 ? Math.PI : 0;
    car.syncMesh(0);
    this.world.scene.add(car.group);
    this.policeCars.push(car);
  }

  spawnHeli() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x1a2a4a });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x9fd4e8 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 4.6), bodyMat);
    body.castShadow = true;
    g.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.0, 1.6), glassMat);
    cabin.position.set(0, 0.3, 1.4);
    g.add(cabin);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 4.5), bodyMat);
    tail.position.set(0, 0.3, -4.2);
    g.add(tail);
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.08, 0.35), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    rotor.position.y = 1.1;
    g.add(rotor);
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff2222 })
    );
    beacon.position.y = -1;
    g.add(beacon);
    this.world.scene.add(g);
    this.heli = { group: g, rotor, beacon };
  }

  update(dt, t) {
    this.sinceCrime += dt;
    // Decay: one star per 25s without fresh crime.
    if (this.wanted > 0 && this.sinceCrime > 25) {
      this.decayTimer += dt;
      if (this.decayTimer >= 25) {
        this.decayTimer = 0;
        this.sinceCrime = 0;
        this.wanted = Math.max(0, this.wanted - 1);
      }
    }
    // Maintain the right number of pursuit cars.
    const want = this.wanted >= 2 ? Math.min(this.wanted - 1, 3) : 0;
    while (this.policeCars.length < want) this.spawnPoliceCar();
    while (this.policeCars.length > want) {
      const c = this.policeCars.pop();
      this.world.scene.remove(c.group);
    }
    if (this.wanted >= 3 && !this.heli) this.spawnHeli();
    if (this.wanted < 3 && this.heli) {
      this.world.scene.remove(this.heli.group);
      this.heli = null;
    }
    const player = this.world.player;
    const target = player.pos;
    const playerCar = this.world.vehicles.playerCar;
    for (const car of this.policeCars) {
      // Pursuit steering: turn toward the player, accelerate.
      const dx = target.x - car.pos.x;
      const dz = target.z - car.pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz) || 0.001;
      const desired = Math.atan2(dx, dz);
      car.heading = angleLerp(car.heading, desired, Math.min(1, 1.6 * dt));
      const wantSpeed = dist > 8 ? 30 : 12;
      car.speed += (wantSpeed - car.speed) * Math.min(1, 1.2 * dt);
      car.pos.x += Math.sin(car.heading) * car.speed * dt;
      car.pos.z += Math.cos(car.heading) * car.speed * dt;
      // Building collision: bounce.
      for (const b of this.world.city.colliders) {
        const cx = clamp(car.pos.x, b.minX, b.maxX);
        const cz = clamp(car.pos.z, b.minZ, b.maxZ);
        const ox = car.pos.x - cx;
        const oz = car.pos.z - cz;
        if (ox * ox + oz * oz < 1.9 * 1.9) {
          car.speed *= -0.3;
          const d = Math.sqrt(ox * ox + oz * oz) || 0.001;
          car.pos.x = cx + (ox / d) * 1.95;
          car.pos.z = cz + (oz / d) * 1.95;
          break;
        }
      }
      // Ram the player's car.
      if (playerCar) {
        const d = dist2D(car.pos.x, car.pos.z, playerCar.pos.x, playerCar.pos.z);
        if (d < 3.6 && d > 0.01) {
          playerCar.condition = Math.max(0, playerCar.condition - 0.35);
          const nx = (playerCar.pos.x - car.pos.x) / d;
          const nz = (playerCar.pos.z - car.pos.z) / d;
          playerCar.pos.x += nx * 0.35;
          playerCar.pos.z += nz * 0.35;
          car.speed *= 0.6;
        }
      }
      // Stuck rescue: teleport back onto a road near the player.
      if (Math.abs(car.speed) < 2 && dist > 15) {
        car.stuckTimer += dt;
        if (car.stuckTimer > 2.5) {
          car.stuckTimer = 0;
          car.pos.set(target.x + 30, 0, target.z + 30);
          car.heading = Math.atan2(target.x - car.pos.x, target.z - car.pos.z);
        }
      } else {
        car.stuckTimer = 0;
      }
      // Flashing light bar.
      const phase = Math.floor(t * 6) % 2 === 0;
      car.lightRed.material.color.setHex(phase ? 0xff2222 : 0x550000);
      car.lightBlue.material.color.setHex(phase ? 0x000055 : 0x3355ff);
      car.syncMesh(dt);
    }
    // Helicopter circles above the player — or holds a staged offset.
    if (this.heli) {
      if (this.heliFollowOffset) {
        const o = this.heliFollowOffset;
        this.heli.group.position.set(target.x + o.x, o.y, target.z + o.z);
        this.heli.group.rotation.y = Math.atan2(
          target.x - this.heli.group.position.x,
          target.z - this.heli.group.position.z
        );
        this.heli.rotor.rotation.y += dt * 22;
        this.heli.beacon.visible = Math.floor(t * 2) % 2 === 0;
        return;
      }
      this.heliAngle += dt * 0.35;
      const hx = target.x + Math.cos(this.heliAngle) * 26;
      const hz = target.z + Math.sin(this.heliAngle) * 26;
      this.heli.group.position.set(hx, 42, hz);
      this.heli.group.rotation.y = -this.heliAngle + Math.PI / 2;
      this.heli.rotor.rotation.y += dt * 22;
      this.heli.beacon.visible = Math.floor(t * 2) % 2 === 0;
    }
  }
}
