// autopilot.js — F9 autopilot: drives the player's car along the street
// grid to the active mission marker (or wanders between intersections
// when there is no mission). Any driving input cancels it.
//
// Routing: the city is a 44m street grid, so the route is L-shaped —
// drive along the current street to the target's row/column, then turn
// onto it. The final approach (from the intersection nearest the
// target, or within 12m) goes straight to the marker; every target is
// on a street, a plaza, or the boardwalk, so that leg is always clear.

import { STREETS } from './city.js';
import { dist2D } from './utils.js';

const ON_STREET = 5.5; // metres from a street centre line: "on" it
const FINAL_DIST = 12; // drive straight to the target inside this
const ARRIVE_DIST = 6; // inside the 7m mission trigger radius
const CRUISE_SPEED = 20;
const TURN_SPEED = 8;

function nearestStreet(v) {
  let best = STREETS[0];
  for (const s of STREETS) {
    if (Math.abs(s - v) < Math.abs(best - v)) best = s;
  }
  return best;
}

export class Autopilot {
  constructor(world) {
    this.world = world;
    this.active = false;
    this.wanderTarget = null;
    this.stuckTimer = 0;
    this.reverseTimer = 0;
  }

  toggle() {
    const w = this.world;
    if (!w.player.inCar) {
      w.hud.notice('AUTOPILOT NEEDS A CAR — steal one with F', 2);
      return;
    }
    if (this.active) {
      this.deactivate('AUTOPILOT OFF');
    } else {
      this.active = true;
      this.wanderTarget = null;
      this.stuckTimer = 0;
      this.reverseTimer = 0;
      w.hud.notice('AUTOPILOT ON — any driving key cancels', 2);
    }
  }

  deactivate(msg) {
    if (!this.active) return;
    this.active = false;
    if (msg) this.world.hud.notice(msg, 1.5);
  }

  // The destination: the mission marker, or a wandering intersection.
  destination(car) {
    const t = this.world.missions.target;
    if (t) return t;
    if (
      !this.wanderTarget ||
      dist2D(car.pos.x, car.pos.z, this.wanderTarget.x, this.wanderTarget.z) < 10
    ) {
      const sx = STREETS[Math.floor(Math.random() * STREETS.length)];
      const sz = STREETS[Math.floor(Math.random() * STREETS.length)];
      this.wanderTarget = { x: sx, z: sz };
    }
    return this.wanderTarget;
  }

  waypoint(car, t) {
    const nx = nearestStreet(car.pos.x);
    const nz = nearestStreet(car.pos.z);
    const tx = nearestStreet(t.x);
    const tz = nearestStreet(t.z);
    const dTarget = dist2D(car.pos.x, car.pos.z, t.x, t.z);
    const atTargetCorner =
      Math.abs(car.pos.x - tx) <= ON_STREET && Math.abs(car.pos.z - tz) <= ON_STREET;
    // Final approach: close to the target, or standing on the
    // intersection nearest it — drive straight in.
    if (dTarget < FINAL_DIST || atTargetCorner) return { x: t.x, z: t.z };
    const onXStreet = Math.abs(car.pos.x - nx) <= ON_STREET;
    const onZStreet = Math.abs(car.pos.z - nz) <= ON_STREET;
    if (!onXStreet && !onZStreet) {
      // Off the grid (plaza/sidewalk): hop to the nearest intersection.
      return { x: nx, z: nz };
    }
    if (onXStreet && !onZStreet) {
      // On a north-south street: run along it to the target's row.
      return { x: nx, z: tz };
    }
    if (onZStreet && !onXStreet) {
      // On an east-west street: run along it to the target's column.
      return { x: tx, z: nz };
    }
    // At an intersection: take the leg that is still open.
    if (nx !== tx) return { x: tx, z: nz };
    return { x: nx, z: tz };
  }

  // Synthetic key set for this frame (replaces the player's input).
  keys(car, dt) {
    const keys = new Set();
    if (!this.active || !car) return keys;
    const t = this.destination(car);
    const dTarget = dist2D(car.pos.x, car.pos.z, t.x, t.z);
    // Arrived: stop and switch off (inside the trigger radius).
    if (dTarget < ARRIVE_DIST && Math.abs(car.speed) < 2) {
      this.deactivate('AUTOPILOT — ARRIVED');
      return keys;
    }
    const wp = this.waypoint(car, t);
    const dx = wp.x - car.pos.x;
    const dz = wp.z - car.pos.z;
    const desired = Math.atan2(dx, dz);
    let diff = desired - car.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    // Stuck rescue: if throttle is on but the car barely moves for
    // 2.5s, reverse out for a second with opposite steering.
    if (this.reverseTimer > 0) {
      this.reverseTimer -= dt;
      keys.add('KeyS');
      if (diff > 0) keys.add('KeyD');
      else if (diff < 0) keys.add('KeyA');
      return keys;
    }
    if (Math.abs(car.speed) < 1.5) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 2.5) {
        this.stuckTimer = 0;
        this.reverseTimer = 1;
        return keys;
      }
    } else {
      this.stuckTimer = 0;
    }
    // Steering: A grows the heading (left turn), D shrinks it.
    if (diff > 0.08) keys.add('KeyA');
    else if (diff < -0.08) keys.add('KeyD');
    // Throttle: cruise on straights, slow for turns and the approach.
    const targetSpeed =
      dTarget < FINAL_DIST ? 6 : Math.abs(diff) > 0.6 ? TURN_SPEED : CRUISE_SPEED;
    if (car.speed < targetSpeed) keys.add('KeyW');
    else if (car.speed > targetSpeed + 3) keys.add('KeyS');
    return keys;
  }
}
