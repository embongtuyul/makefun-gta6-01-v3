// islandmap.js — the pause-menu full island map: district regions with
// names + control %, streets, sea + beach, the player's position, the
// mission marker, police blips, and discovered districts (visited ones
// glow brighter and carry a star).

import { STREETS, DISTRICT_REGIONS } from './city.js';

// Map covers x [-220, 220], z [-220, 260] so the sea shows at the bottom.
const X0 = -220;
const X1 = 220;
const Z0 = -220;
const Z1 = 260;

export function drawIslandMap(canvas, world) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const scale = Math.min(W / (X1 - X0), H / (Z1 - Z0));
  const ox = (W - (X1 - X0) * scale) / 2;
  const oy = (H - (Z1 - Z0) * scale) / 2;
  const mx = (x) => ox + (x - X0) * scale;
  const mz = (z) => oy + (z - Z0) * scale;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#10151f';
  ctx.fillRect(0, 0, W, H);

  // District regions.
  const discovered = world.state.discovered || new Set();
  for (const r of DISTRICT_REGIONS) {
    const visited = discovered.has(r.name);
    ctx.globalAlpha = visited ? 0.85 : 0.38;
    ctx.fillStyle = r.color;
    ctx.fillRect(mx(r.x0), mz(r.z0), (r.x1 - r.x0) * scale, (r.z1 - r.z0) * scale);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx(r.x0), mz(r.z0), (r.x1 - r.x0) * scale, (r.z1 - r.z0) * scale);
  }
  // Sand + sea over the bottom strip (Boardwalk keeps its tint underneath).
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = '#c9b183';
  ctx.fillRect(mx(X0), mz(192), (X1 - X0) * scale, (238 - 192) * scale);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#1d5a78';
  ctx.fillRect(mx(X0), mz(238), (X1 - X0) * scale, (Z1 - 238) * scale + 2);
  // Park block.
  ctx.fillStyle = '#2f7a3f';
  ctx.fillRect(mx(-80), mz(-80), 28 * scale, 28 * scale);
  // Streets.
  ctx.strokeStyle = '#4a5568';
  ctx.lineWidth = 2;
  for (const s of STREETS) {
    ctx.beginPath();
    ctx.moveTo(mx(s), mz(Z0));
    ctx.lineTo(mx(s), mz(238));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mx(X0), mz(s));
    ctx.lineTo(mx(X1), mz(s));
    ctx.stroke();
  }
  // District labels: name + control %, star when visited.
  ctx.textAlign = 'center';
  for (const r of DISTRICT_REGIONS) {
    const cx = mx((r.x0 + r.x1) / 2);
    const cy = mz((r.z0 + r.z1) / 2);
    const visited = discovered.has(r.name);
    ctx.fillStyle = visited ? '#ffffff' : 'rgba(255,255,255,0.75)';
    ctx.font = 'bold 11px Arial';
    ctx.fillText((visited ? '★ ' : '') + r.name.toUpperCase(), cx, cy - 1);
    ctx.fillStyle = '#9fd4e8';
    ctx.font = '10px Arial';
    ctx.fillText(`CONTROL ${r.control}%`, cx, cy + 12);
  }
  // Route line + mission marker.
  const px = mx(world.player.pos.x);
  const pz = mz(world.player.pos.z);
  const t = world.missions.target;
  if (t) {
    const tx = mx(t.x);
    const tz = mz(t.z);
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(px, pz);
    ctx.lineTo(tx, tz);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.moveTo(tx, tz - 7);
    ctx.lineTo(tx + 7, tz);
    ctx.lineTo(tx, tz + 7);
    ctx.lineTo(tx - 7, tz);
    ctx.closePath();
    ctx.fill();
  }
  // Police blips.
  for (const car of world.police.policeCars) {
    ctx.fillStyle = '#ff4444';
    ctx.beginPath();
    ctx.arc(mx(car.pos.x), mz(car.pos.z), 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Player arrow.
  const heading = world.vehicles.playerCar
    ? world.vehicles.playerCar.heading
    : world.player.yaw;
  ctx.save();
  ctx.translate(px, pz);
  ctx.rotate(-heading);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 9);
  ctx.lineTo(-6, -6);
  ctx.lineTo(0, -2);
  ctx.lineTo(6, -6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  // North marker + discovered count.
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 12px Arial';
  ctx.textAlign = 'left';
  ctx.fillText('N ▲', 8, 16);
  ctx.textAlign = 'right';
  ctx.font = '10px Arial';
  ctx.fillStyle = '#9fd4e8';
  ctx.fillText(`DISCOVERED ${discovered.size}/${DISTRICT_REGIONS.length}`, W - 8, 16);
}
