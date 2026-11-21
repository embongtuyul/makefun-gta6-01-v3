// vehicles.js — parked cars to steal, moving traffic, arcade driving.
// Steering convention: heading grows counter-clockwise on the map, so
// A (left) increases heading and D (right) decreases it. Verified in
// the playtest (see tools/qa-cdp.mjs).

import * as THREE from 'three';
import { mulberry32, rand, randInt, pick, clamp, damp, dist2D } from './utils.js';
import { STREETS, CLEAR_ZONES } from './city.js';

const CAR_COLORS = [
  0xc23b2e, 0x2e6fc2, 0xe8d44d, 0x3aa655, 0xe8e8e8, 0x2a2d34,
  0x8a4fb5, 0xff8c2f, 0x37c8c8, 0xb5b5b5, 0x7a3b2e, 0x4d7a2f,
];
const MAX_SPEED = 38; // m/s (~137 km/h)
const MAX_REVERSE = 9;
const ACCEL = 13;
const BRAKE = 22;
const DRAG = 0.35;

function nearClearZone(x, z, pad) {
  for (const c of CLEAR_ZONES) {
    if (dist2D(x, z, c.x, c.z) < c.r + pad) return true;
  }
  return false;
}

export class Car {
  constructor(color, police) {
    this.color = color;
    this.police = !!police;
    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.speed = 0;
    this.steerVisual = 0;
    this.condition = 100;
    this.group = this.buildMesh();
  }

  buildMesh() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: this.police ? 0xf2f2f2 : this.color });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x1a1d22 });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x9fd4e8 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.62, 4.3), bodyMat);
    body.position.y = 0.58;
    body.castShadow = true;
    g.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.1), this.police ? darkMat : glassMat);
    cabin.position.set(0, 1.12, -0.25);
    cabin.castShadow = true;
    g.add(cabin);
    // Headlights (front, +z) and taillights.
    const hlMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
    const tlMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
    for (const s of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.1), hlMat);
      hl.position.set(s * 0.62, 0.62, 2.16);
      g.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.1), tlMat);
      tl.position.set(s * 0.62, 0.66, -2.16);
      g.add(tl);
    }
    if (this.police) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.18, 0.4), darkMat);
      bar.position.set(0, 1.48, -0.25);
      g.add(bar);
      this.lightRed = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.22, 0.42),
        new THREE.MeshBasicMaterial({ color: 0xff2222 })
      );
      this.lightRed.position.set(-0.4, 1.5, -0.25);
      g.add(this.lightRed);
      this.lightBlue = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.22, 0.42),
        new THREE.MeshBasicMaterial({ color: 0x2244ff })
      );
      this.lightBlue.position.set(0.4, 1.5, -0.25);
      g.add(this.lightBlue);
    }
    // Wheels: steer group (front) -> spin group -> mesh.
    this.wheels = [];
    this.steerGroups = [];
    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x151515 });
    for (const [wx, wz, front] of [[-0.88, 1.4, true], [0.88, 1.4, true], [-0.88, -1.4, false], [0.88, -1.4, false]]) {
      const steer = new THREE.Group();
      steer.position.set(wx, 0.36, wz);
      const spin = new THREE.Group();
      const mesh = new THREE.Mesh(wheelGeo, wheelMat);
      mesh.rotation.z = Math.PI / 2;
      mesh.castShadow = true;
      spin.add(mesh);
      steer.add(spin);
      g.add(steer);
      this.wheels.push(spin);
      if (front) this.steerGroups.push(steer);
    }
    return g;
  }

  syncMesh(dt) {
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.group.rotation.y = this.heading;
    const spin = (this.speed * dt) / 0.36;
    for (const w of this.wheels) w.rotation.x += spin;
    for (const s of this.steerGroups) s.rotation.y = this.steerVisual;
  }
}

export class Vehicles {
  constructor(world) {
    this.world = world;
    this.parked = [];
    this.traffic = [];
    this.playerCar = null;
    this.rng = mulberry32(777);
    this.headlight = new THREE.SpotLight(0xfff2c0, 60, 45, 0.5, 0.5, 1.2);
    this.headlightTarget = new THREE.Object3D();
    this.spawnParked();
    this.spawnTraffic();
  }

  spawnParked() {
    const rng = this.rng;
    const spots = [
      // Guaranteed car near spawn (street x=0, just south of spawn).
      { x: 5.6, z: 46, heading: 0 },
      { x: -5.6, z: -30, heading: Math.PI },
      { x: 38.4, z: 100, heading: 0 },
      { x: 49.6, z: -60, heading: Math.PI },
      { x: -38.4, z: 60, heading: 0 },
      { x: -49.6, z: -140, heading: Math.PI },
      { x: 100, z: 5.6, heading: Math.PI / 2 },
      { x: -100, z: -5.6, heading: -Math.PI / 2 },
      { x: 60, z: 93.6, heading: Math.PI / 2 },
      { x: -140, z: 38.4, heading: -Math.PI / 2 },
      { x: 140, z: -93.6, heading: Math.PI / 2 },
      { x: 10, z: -91, heading: 0 },
      { x: -10, z: 136, heading: Math.PI },
      { x: 170, z: 50, heading: 0 },
    ];
    for (const s of spots) {
      if (nearClearZone(s.x, s.z, 4)) continue;
      const car = new Car(pick(rng, CAR_COLORS), false);
      car.pos.set(s.x, 0, s.z);
      car.heading = s.heading;
      car.syncMesh(0);
      this.world.scene.add(car.group);
      this.parked.push(car);
    }
  }

  spawnTraffic() {
    const rng = this.rng;
    for (let i = 0; i < 14; i++) {
      const alongZ = rng() < 0.5;
      const street = pick(rng, STREETS);
      const dir = rng() < 0.5 ? 1 : -1;
      const lane = dir > 0 ? 2.4 : -2.4;
      const car = new Car(pick(rng, CAR_COLORS), false);
      car.isTraffic = true;
      car.trafficAxis = alongZ ? 'z' : 'x';
      car.trafficStreet = street;
      car.trafficDir = dir;
      car.trafficSpeed = rand(rng, 7, 11);
      const along = rand(rng, -210, 210);
      if (alongZ) {
        car.pos.set(street + lane, 0, along);
        car.heading = dir > 0 ? 0 : Math.PI;
      } else {
        car.pos.set(along, 0, street + lane);
        car.heading = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
      car.syncMesh(0);
      this.world.scene.add(car.group);
      this.traffic.push(car);
    }
  }

  nearestParked(x, z, maxDist) {
    let best = null;
    let bestD = maxDist;
    for (const car of this.parked) {
      if (car === this.playerCar) continue;
      const d = dist2D(x, z, car.pos.x, car.pos.z);
      if (d < bestD) {
        bestD = d;
        best = car;
      }
    }
    return best;
  }

  tryEnter(player) {
    const car = this.nearestParked(player.pos.x, player.pos.z, 4.5);
    if (!car) return null;
    this.playerCar = car;
    player.inCar = true;
    // Headlights follow the player's car.
    this.headlight.position.set(0, 1.1, 2);
    this.headlightTarget.position.set(0, 0, 16);
    car.group.add(this.headlight);
    car.group.add(this.headlightTarget);
    this.headlight.target = this.headlightTarget;
    return car;
  }

  exitCar(player) {
    const car = this.playerCar;
    if (!car) return;
    car.group.remove(this.headlight);
    car.group.remove(this.headlightTarget);
    // Place the player on the driver's side (left of heading).
    const rx = Math.cos(car.heading);
    const rz = -Math.sin(car.heading);
    player.pos.set(car.pos.x - rx * 2.4, 0, car.pos.z - rz * 2.4);
    player.yaw = car.heading;
    player.inCar = false;
    this.playerCar = null;
  }

  update(dt, input, player) {
    // Traffic flows along its street, wraps at the world edge.
    for (const car of this.traffic) {
      if (car.trafficAxis === 'z') {
        car.pos.z += car.trafficDir * car.trafficSpeed * dt;
        if (car.pos.z > 225) car.pos.z = -225;
        if (car.pos.z < -225) car.pos.z = 225;
      } else {
        car.pos.x += car.trafficDir * car.trafficSpeed * dt;
        if (car.pos.x > 225) car.pos.x = -225;
        if (car.pos.x < -225) car.pos.x = 225;
      }
      car.speed = car.trafficSpeed;
      car.syncMesh(dt);
    }
    const car = this.playerCar;
    if (!car) return;
    const keys = input.keys;
    const stalled = car.condition <= 0;
    if (!stalled) {
      if (keys.has('KeyW')) car.speed += ACCEL * dt;
      if (keys.has('KeyS')) {
        if (car.speed > 0.5) car.speed -= BRAKE * dt;
        else car.speed -= ACCEL * 0.6 * dt;
      }
    }
    // Drag + rolling resistance.
    car.speed -= car.speed * DRAG * dt;
    if (!keys.has('KeyW') && !keys.has('KeyS')) car.speed = damp(car.speed, 0, 0.6, dt);
    if (keys.has('Space')) car.speed = damp(car.speed, 0, 4, dt); // handbrake
    car.speed = clamp(car.speed, -MAX_REVERSE, stalled ? 0 : MAX_SPEED);
    // Steering: A = left (heading grows), D = right (heading shrinks).
    const steerInput = (keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0);
    const speedFactor = 1 - (Math.abs(car.speed) / MAX_SPEED) * 0.55;
    const maxSteer = 0.5 * speedFactor;
    car.steerVisual = damp(car.steerVisual, steerInput * maxSteer, 10, dt);
    car.heading += car.steerVisual * (car.speed / 2.8) * dt;
    car.pos.x += Math.sin(car.heading) * car.speed * dt;
    car.pos.z += Math.cos(car.heading) * car.speed * dt;
    // Collide with buildings: bounce back + damage.
    const boxes = this.world.city.colliders;
    let hit = false;
    for (const b of boxes) {
      const cx = clamp(car.pos.x, b.minX, b.maxX);
      const cz = clamp(car.pos.z, b.minZ, b.maxZ);
      const dx = car.pos.x - cx;
      const dz = car.pos.z - cz;
      if (dx * dx + dz * dz < 1.9 * 1.9) {
        hit = true;
        if (Math.abs(car.speed) > 4) {
          car.condition = Math.max(0, car.condition - 8);
          this.world.onCrash(Math.abs(car.speed));
        }
        car.speed = -car.speed * 0.3;
        const d = Math.sqrt(dx * dx + dz * dz) || 0.001;
        car.pos.x = cx + (dx / d) * 1.95;
        car.pos.z = cz + (dz / d) * 1.95;
        break;
      }
    }
    // Bump traffic cars (radius 3.0: adjacent-lane passing must not collide).
    for (const t of this.traffic) {
      const d = dist2D(car.pos.x, car.pos.z, t.pos.x, t.pos.z);
      if (d < 3.0 && d > 0.01) {
        if (Math.abs(car.speed) > 3) {
          car.condition = Math.max(0, car.condition - 5);
          this.world.onCrash(Math.abs(car.speed));
        }
        car.speed *= 0.4;
        const push = (3.0 - d) / 2;
        const nx = (car.pos.x - t.pos.x) / d;
        const nz = (car.pos.z - t.pos.z) / d;
        car.pos.x += nx * push;
        car.pos.z += nz * push;
        t.pos.x -= nx * push;
        t.pos.z -= nz * push;
      }
    }
    car.pos.x = clamp(car.pos.x, -218, 218);
    car.pos.z = clamp(car.pos.z, -218, 234);
    car.syncMesh(dt);
    // Keep the player glued to the car.
    player.pos.copy(car.pos);
    player.yaw = car.heading;
  }
}
