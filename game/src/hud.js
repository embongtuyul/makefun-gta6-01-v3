// hud.js — every HUD element: mission card, clock/money/wanted stars,
// rank + RP, weapon slots, health/armour, canvas minimap with route
// line, district label, prompts, dialogue box, banners, radio.

import { clamp } from './utils.js';
import { STREETS, WORLD_BOUND } from './city.js';

const RADIO_TRACKS = [
  'Marisol Vega — Golden Hour Drive',
  'Los Corales — Marea Alta',
  'Kip Sorrento — Arepa Lights',
  'DJ Palma — Sunset Over Solmar',
  'The Volcanos — Ember Sky',
];

export class HUD {
  constructor(world) {
    this.world = world;
    this.el = {};
    const ids = [
      'mission-title', 'mission-stage', 'mission-objective', 'mission-next',
      'clock', 'money', 'stars', 'wanted-label',
      'rank-text', 'rp-fill', 'rp-text',
      'health-fill', 'health-text', 'armour-fill', 'armour-text',
      'district-name', 'district-flavour', 'district-control',
      'speed-box', 'speed-text', 'condition-fill', 'condition-text',
      'prompt', 'dialogue', 'dialogue-name', 'dialogue-text', 'dialogue-progress',
      'banner', 'banner-title', 'banner-sub', 'radio-text', 'damage-flash',
      'weapon-slots', 'autopilot-ind',
    ];
    for (const id of ids) this.el[id] = document.getElementById(id);
    this.mapCanvas = document.getElementById('minimap');
    this.mapCtx = this.mapCanvas.getContext('2d');
    this.bannerTimer = 0;
    this.radioTimer = 0;
    this.radioIndex = 0;
    this.damageOpacity = 0;
    this.activeWeapon = 0;
    // Timed notice shown in the prompt slot (combat, autopilot).
    this.noticeText = null;
    this.noticeTimer = 0;
    this.buildWeaponSlots();
  }

  // Show a short message in the prompt slot for `seconds`.
  notice(text, seconds) {
    this.noticeText = text;
    this.noticeTimer = seconds || 1.5;
  }

  buildWeaponSlots() {
    const slots = [
      { key: '1', name: 'FISTS', ammo: '∞' },
      { key: '2', name: '.38', ammo: '12/48' },
      { key: '3', name: 'SMG', ammo: 'LOCKED' },
      { key: '4', name: '12G', ammo: 'LOCKED' },
      { key: '5', name: 'AR-9', ammo: 'LOCKED' },
    ];
    this.el['weapon-slots'].innerHTML = slots
      .map(
        (s, i) =>
          `<div class="weapon-slot${i === 0 ? ' active' : ''}" data-i="${i}">` +
          `<span class="w-key">${s.key}</span><span class="w-name">${s.name}</span>` +
          `<span class="w-ammo">${s.ammo}</span></div>`
      )
      .join('');
    this.ammoNodes = Array.from(this.el['weapon-slots'].querySelectorAll('.w-ammo'));
  }

  setWeapon(i) {
    this.activeWeapon = i;
    const nodes = this.el['weapon-slots'].querySelectorAll('.weapon-slot');
    nodes.forEach((n, j) => n.classList.toggle('active', j === i));
  }

  showDialogue(name, text, index, total) {
    this.el['dialogue-name'].textContent = name;
    this.el['dialogue-text'].textContent = text;
    this.el['dialogue-progress'].textContent = `${index}/${total}  ·  ENTER ▸`;
    this.el.dialogue.classList.add('visible');
  }

  hideDialogue() {
    this.el.dialogue.classList.remove('visible');
  }

  showBanner(title, sub) {
    this.el['banner-title'].textContent = title;
    this.el['banner-sub'].textContent = sub || '';
    this.el.banner.classList.add('visible');
    this.bannerTimer = 4;
  }

  setPrompt(text) {
    this.el.prompt.textContent = text || '';
    this.el.prompt.classList.toggle('visible', !!text);
  }

  flashWanted() {
    this.el.stars.classList.add('flash');
    setTimeout(() => this.el.stars.classList.remove('flash'), 1200);
  }

  damageFlash() {
    this.damageOpacity = 0.45;
  }

  update(dt) {
    const w = this.world;
    const st = w.state;
    // Clock: 1 game-minute per 2.5 real seconds.
    st.gameMinutes += dt / 2.5;
    const hh = Math.floor(st.gameMinutes / 60) % 24;
    const mm = Math.floor(st.gameMinutes % 60);
    this.el.clock.textContent = `DAY 1 · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    this.el.money.textContent = `$${st.money}`;
    const wanted = w.police.wanted;
    let stars = '';
    for (let i = 0; i < 5; i++) stars += i < wanted ? '★' : '☆';
    this.el.stars.textContent = stars;
    this.el.stars.classList.toggle('hot', wanted > 0);
    this.el['wanted-label'].textContent = wanted === 0 ? 'CLEAN' : `WANTED ${wanted}`;
    this.el['wanted-label'].classList.toggle('hot', wanted > 0);
    // Rank + RP.
    this.el['rank-text'].textContent = `RANK ${st.rank}`;
    const rpMax = st.rank * 300;
    const rpInRank = st.rp - (st.rank - 1) * 300;
    this.el['rp-fill'].style.width = `${clamp((rpInRank / 300) * 100, 0, 100)}%`;
    this.el['rp-text'].textContent = `${rpInRank}/300 RP`;
    void rpMax;
    // Vitals.
    this.el['health-fill'].style.width = `${clamp(w.player.health, 0, 100)}%`;
    this.el['health-text'].textContent = `HEALTH ${Math.round(w.player.health)}`;
    this.el['armour-fill'].style.width = `${clamp(w.player.armour, 0, 100)}%`;
    this.el['armour-text'].textContent = `ARMOUR ${Math.round(w.player.armour)}`;
    // Mission card.
    const m = w.missions.hudState();
    this.el['mission-title'].textContent = m.title;
    this.el['mission-stage'].textContent = m.stageText;
    this.el['mission-objective'].textContent = m.objective;
    this.el['mission-next'].textContent = m.next;
    // District.
    const d = w.city.districtAt(w.player.pos.x, w.player.pos.z);
    this.el['district-name'].textContent = d.name.toUpperCase();
    this.el['district-flavour'].textContent = d.flavour;
    this.el['district-control'].textContent = `CONTROL ${d.control}%`;
    if (w.state.discovered) w.state.discovered.add(d.name);
    // Live .38 ammo in the weapon slots.
    if (w.combat && this.ammoNodes[1]) {
      this.ammoNodes[1].textContent = `${w.combat.clip}/${w.combat.reserve}`;
    }
    // Autopilot indicator.
    if (this.el['autopilot-ind']) {
      this.el['autopilot-ind'].classList.toggle(
        'visible',
        !!(w.autopilot && w.autopilot.active)
      );
    }
    // Notice countdown (the prompt slot shows the notice while it runs).
    if (this.noticeTimer > 0) this.noticeTimer -= dt;
    // Driving readout.
    const car = w.vehicles.playerCar;
    if (car) {
      this.el['speed-box'].classList.add('visible');
      this.el['speed-text'].textContent = `${Math.round(Math.abs(car.speed) * 3.6)} KM/H`;
      this.el['condition-fill'].style.width = `${clamp(car.condition, 0, 100)}%`;
      this.el['condition-text'].textContent = `CONDITION ${Math.round(car.condition)}%`;
    } else {
      this.el['speed-box'].classList.remove('visible');
    }
    // Radio track rotation.
    this.radioTimer += dt;
    if (this.radioTimer > 45) {
      this.radioTimer = 0;
      this.radioIndex = (this.radioIndex + 1) % RADIO_TRACKS.length;
    }
    this.el['radio-text'].textContent = `RADIO SOLMAR 101.3 — ${RADIO_TRACKS[this.radioIndex]}`;
    // Banner auto-hide.
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.el.banner.classList.remove('visible');
    }
    // Damage vignette fade.
    if (this.damageOpacity > 0) {
      this.damageOpacity = Math.max(0, this.damageOpacity - dt * 0.8);
      this.el['damage-flash'].style.opacity = String(this.damageOpacity);
    }
    this.drawMinimap();
  }

  drawMinimap() {
    const ctx = this.mapCtx;
    const S = 180;
    const scale = S / (WORLD_BOUND * 2 + 40);
    const toMapX = (x) => (x + WORLD_BOUND + 20) * scale;
    const toMapZ = (z) => (z + WORLD_BOUND + 20) * scale;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#141a26';
    ctx.fillRect(0, 0, S, S);
    // Sea + beach (bottom of the map).
    ctx.fillStyle = '#1d5a78';
    ctx.fillRect(0, toMapZ(238), S, S - toMapZ(238));
    ctx.fillStyle = '#c9b183';
    ctx.fillRect(0, toMapZ(192), S, toMapZ(238) - toMapZ(192));
    // Park.
    ctx.fillStyle = '#2f7a3f';
    ctx.fillRect(toMapX(-80), toMapZ(-80), 28 * scale, 28 * scale);
    // Roads.
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 3;
    for (const s of STREETS) {
      ctx.beginPath();
      ctx.moveTo(toMapX(s), 0);
      ctx.lineTo(toMapX(s), S);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, toMapZ(s));
      ctx.lineTo(S, toMapZ(s));
      ctx.stroke();
    }
    const w = this.world;
    const px = toMapX(w.player.pos.x);
    const pz = toMapZ(w.player.pos.z);
    // Route line to the mission target.
    const t = w.missions.target;
    if (t) {
      const tx = toMapX(t.x);
      const tz = toMapZ(t.z);
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(px, pz);
      ctx.lineTo(tx, tz);
      ctx.stroke();
      ctx.setLineDash([]);
      // Mission marker diamond (pulsing).
      const pulse = 5 + Math.sin(performance.now() / 300) * 1.5;
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.moveTo(tx, tz - pulse);
      ctx.lineTo(tx + pulse, tz);
      ctx.lineTo(tx, tz + pulse);
      ctx.lineTo(tx - pulse, tz);
      ctx.closePath();
      ctx.fill();
    }
    // Police blips.
    const flash = Math.floor(performance.now() / 400) % 2 === 0;
    for (const car of w.police.policeCars) {
      ctx.fillStyle = flash ? '#ff4444' : '#4488ff';
      ctx.beginPath();
      ctx.arc(toMapX(car.pos.x), toMapZ(car.pos.z), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Player arrow.
    const heading = w.vehicles.playerCar
      ? w.vehicles.playerCar.heading
      : w.player.yaw;
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-heading); // canvas rotates clockwise; map north is -z
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 7);
    ctx.lineTo(-5, -5);
    ctx.lineTo(0, -2);
    ctx.lineTo(5, -5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // North marker.
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px Arial';
    ctx.fillText('N', 6, 14);
  }
}
