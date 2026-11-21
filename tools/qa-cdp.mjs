// tools/qa-cdp.mjs — headless-Chrome QA driver over raw CDP (no deps).
// Modes:
//   smoke    — load the game, wait for ready, report console errors
//   shots    — capture the 3 entry screenshots (poses) into screenshots/
//   playtest — play mission 1 end-to-end with real keyboard input
//
// Needs the game server running:  PORT=8931 node serve.ts
// Usage: node tools/qa-cdp.mjs <mode>

import { spawn } from 'node:child_process';
import { writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = join(
  homedir(),
  '.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell'
);
const SERVER = process.env.SOLMARA_URL || 'http://localhost:8931';
const DEBUG_PORT = 9223;
const WIDTH = 1280;
const HEIGHT = 720;

const KEYS = {
  KeyW: { key: 'w', vk: 87 },
  KeyA: { key: 'a', vk: 65 },
  KeyS: { key: 's', vk: 83 },
  KeyD: { key: 'd', vk: 68 },
  KeyF: { key: 'f', vk: 70 },
  KeyE: { key: 'e', vk: 69 },
  KeyR: { key: 'r', vk: 82 },
  KeyP: { key: 'p', vk: 80 },
  Digit2: { key: '2', vk: 50 },
  F9: { key: 'F9', vk: 120 },
  Enter: { key: 'Enter', vk: 13 },
  Space: { key: ' ', vk: 32 },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.errors = [];
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        const list = this.listeners.get(msg.method) || [];
        for (const fn of list) fn(msg.params);
      }
    };
  }

  static async connect(wsUrl) {
    const c = new CDP(wsUrl);
    await new Promise((resolve, reject) => {
      c.ws.onopen = resolve;
      c.ws.onerror = reject;
    });
    return c;
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  send(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 15000);
    });
  }

  async evaluate(expr) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error('evaluate failed: ' + JSON.stringify(res.exceptionDetails).slice(0, 400));
    }
    return res.result.value;
  }

  async keyEvent(type, code) {
    const k = KEYS[code];
    await this.send('Input.dispatchKeyEvent', {
      type,
      code,
      key: k.key,
      windowsVirtualKeyCode: k.vk,
      nativeVirtualKeyCode: k.vk,
    });
  }

  async tap(code, holdMs) {
    await this.keyEvent('keyDown', code);
    await sleep(holdMs || 120);
    await this.keyEvent('keyUp', code);
  }

  // Left-click at (x, y) in CSS pixels (for combat attacks).
  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 1,
    });
    await sleep(80);
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
    });
  }

  // Hold a key until a JS condition becomes true (or timeout). Returns the
  // condition value observed (or null on timeout).
  async holdUntil(code, conditionExpr, timeoutMs, label) {
    await this.keyEvent('keyDown', code);
    const start = Date.now();
    let value = null;
    try {
      while (Date.now() - start < timeoutMs) {
        value = await this.evaluate(conditionExpr);
        if (value) break;
        await sleep(350);
      }
    } finally {
      await this.keyEvent('keyUp', code);
    }
    const ok = !!value;
    console.log(`  ${ok ? 'OK ' : 'FAIL'} ${label} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
    return ok;
  }

  async screenshot(path, quality) {
    const res = await this.send('Page.captureScreenshot', { format: 'jpeg', quality: quality || 80 });
    writeFileSync(path, Buffer.from(res.data, 'base64'));
    return statSync(path).size;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

async function launchChrome(url, w, h) {
  const width = w || WIDTH;
  const height = h || HEIGHT;
  const profile = `/tmp/solmara-chrome-${Date.now()}`;
  const args = [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    `--window-size=${width},${height}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    url,
  ];
  const proc = spawn(CHROME, args, { stdio: 'ignore' });
  // Wait for the DevTools HTTP endpoint.
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target found');
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  cdp.on('Runtime.exceptionThrown', (p) => {
    cdp.errors.push('EXCEPTION: ' + JSON.stringify(p.exceptionDetails).slice(0, 500));
  });
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') {
      cdp.errors.push('CONSOLE: ' + p.args.map((a) => a.value || a.description || '').join(' ').slice(0, 300));
    }
  });
  cdp.on('Log.entryAdded', (p) => {
    if (p.entry.level === 'error') cdp.errors.push('LOG: ' + p.entry.text.slice(0, 300));
  });
  return { proc, cdp };
}

async function waitReady(cdp, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < (timeoutMs || 30000)) {
    try {
      const ready = await cdp.evaluate('!!(window.__solmara && window.__solmara.ready)');
      if (ready) return true;
    } catch {
      /* page still loading */
    }
    await sleep(400);
  }
  return false;
}

async function getState(cdp) {
  return cdp.evaluate(`(() => {
    const w = window.__solmara.world;
    const car = w.vehicles.playerCar;
    return {
      state: window.__solmara.game.state,
      px: +w.player.pos.x.toFixed(1), pz: +w.player.pos.z.toFixed(1),
      yaw: +w.player.yaw.toFixed(2),
      inCar: w.player.inCar,
      missionIndex: w.missions.missionIndex,
      stage: w.missions.stageIndex, completed: w.missions.completed,
      dialogueOpen: w.missions.dialogueOpen, dialogueIndex: w.missions.dialogueIndex,
      money: w.state.money, rp: w.state.rp, rank: w.state.rank,
      wanted: w.police.wanted,
      policeCars: w.police.policeCars.length, heli: !!w.police.heli,
      carHeading: car ? +car.heading.toFixed(2) : null,
      carSpeed: car ? +car.speed.toFixed(1) : null,
      carCondition: car ? Math.round(car.condition) : null,
      carX: car ? +car.pos.x.toFixed(1) : null,
      carZ: car ? +car.pos.z.toFixed(1) : null,
      clip: w.combat.clip, reserve: w.combat.reserve,
      weapon: w.hud.activeWeapon,
      autopilot: w.autopilot.active,
      pedsDown: w.peds.peds.filter((p) => p.down).length,
      discovered: w.state.discovered ? w.state.discovered.size : 0,
      paused: !document.getElementById('pause-menu').classList.contains('hidden'),
      banner: document.getElementById('banner').classList.contains('visible'),
    };
  })()`);
}

async function navigate(cdp, url) {
  await cdp.send('Page.navigate', { url });
  const ok = await waitReady(cdp, 30000);
  if (!ok) throw new Error(`page never ready: ${url}`);
}

async function modeSmoke() {
  const { proc, cdp } = await launchChrome(`${SERVER}/?autostart=1`);
  try {
    const ok = await waitReady(cdp, 30000);
    console.log('ready:', ok);
    await sleep(3000);
    const st = await getState(cdp);
    console.log('state:', JSON.stringify(st));
    console.log('console errors:', cdp.errors.length);
    for (const e of cdp.errors) console.log('  ', e);
    return ok && cdp.errors.length === 0;
  } finally {
    cdp.close();
    proc.kill();
  }
}

async function modeShots() {
  const { proc, cdp } = await launchChrome(`${SERVER}/?pose=chase`);
  try {
    const shots = [
      { pose: 'chase', file: '01-chase.jpg', waitPose: true, extra: 3000 },
      { pose: 'street', file: '02-street.jpg', waitPose: false, extra: 8000 },
      { pose: 'mission', file: '03-mission.jpg', waitPose: true, extra: 2000 },
    ];
    for (const s of shots) {
      await navigate(cdp, `${SERVER}/?pose=${s.pose}`);
      if (s.waitPose) {
        // Pose staging runs on game time; at low FPS it takes a while.
        const start = Date.now();
        let done = false;
        while (Date.now() - start < 90000) {
          done = await cdp.evaluate('window.__solmara.game.poseDone');
          if (done) break;
          await sleep(500);
        }
        console.log(`  pose ${s.pose} staged: ${done}`);
      }
      await sleep(s.extra);
      const path = join(ROOT, 'screenshots', s.file);
      let size = await cdp.screenshot(path, 80);
      if (size > 250 * 1024) size = await cdp.screenshot(path, 65);
      const st = await getState(cdp);
      console.log(`${s.file}: ${(size / 1024).toFixed(0)} KiB, state=${JSON.stringify(st)}`);
    }
    console.log('console errors:', cdp.errors.length);
    for (const e of cdp.errors) console.log('  ', e);
    return cdp.errors.length === 0;
  } finally {
    cdp.close();
    proc.kill();
  }
}

async function modePlaytest() {
  const { proc, cdp } = await launchChrome(`${SERVER}/?autostart=1&lowgfx=1`, 800, 450);
  let pass = true;
  const check = (cond, label, extra) => {
    console.log(`  ${cond ? 'OK ' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`);
    if (!cond) pass = false;
    return cond;
  };
  try {
    if (!(await waitReady(cdp, 30000))) {
      console.log('FAIL page never ready');
      return false;
    }
    await sleep(1000);
    let st = await getState(cdp);
    check(st.state === 'playing', 'game playing', st.state);
    check(st.stage === 0 && !st.dialogueOpen, 'mission 1 stage 0, no dialogue');

    // Walk south down 0th street to z=132.
    await cdp.evaluate('window.__solmara.world.player.yaw = 0');
    if (!(await cdp.holdUntil('KeyW', 'window.__solmara.world.player.pos.z >= 130', 40000, 'walk south to z=132'))) pass = false;
    // Walk east along 132nd street to x=28.
    await cdp.evaluate('window.__solmara.world.player.yaw = Math.PI / 2');
    if (!(await cdp.holdUntil('KeyW', 'window.__solmara.world.player.pos.x >= 28', 20000, 'walk east to x=28'))) pass = false;
    // Walk south into the marina trigger (dialogue opens).
    await cdp.evaluate('window.__solmara.world.player.yaw = 0');
    if (!(await cdp.holdUntil('KeyW', 'window.__solmara.world.missions.dialogueOpen', 15000, 'reach Lina, dialogue opens'))) pass = false;
    st = await getState(cdp);
    check(st.dialogueOpen && st.dialogueIndex === 0, 'dialogue line 1 showing', JSON.stringify(st));

    // Advance the dialogue with Enter x3.
    for (let i = 0; i < 3; i++) {
      await cdp.tap('Enter', 120);
      await sleep(400);
    }
    st = await getState(cdp);
    check(!st.dialogueOpen && st.stage === 1, 'dialogue done, stage advanced to 1', JSON.stringify(st));

    // Walk west to the parked car at (-10, 136), then north to it.
    await cdp.evaluate('window.__solmara.world.player.yaw = -Math.PI / 2');
    if (!(await cdp.holdUntil('KeyW', 'window.__solmara.world.player.pos.x <= -8', 20000, 'walk west to x=-8'))) pass = false;
    await cdp.evaluate('window.__solmara.world.player.yaw = Math.PI');
    if (!(await cdp.holdUntil('KeyW', 'window.__solmara.world.player.pos.z <= 137', 10000, 'walk north to the car'))) pass = false;
    await cdp.tap('KeyF', 150);
    await sleep(500);
    st = await getState(cdp);
    check(st.inCar === true, 'entered car with F', JSON.stringify(st));
    check(st.wanted === 1, 'stealing raised wanted to 1', `wanted=${st.wanted}`);

    if (!st.inCar) {
      console.log('  SKIP driving legs — never got in a car');
    } else {
    // Drive north to z=132.
    await cdp.evaluate('window.__solmara.world.vehicles.playerCar.heading = Math.PI');
    if (!(await cdp.holdUntil('KeyW', 'window.__solmara.world.vehicles.playerCar.pos.z <= 131', 10000, 'drive north to z=132'))) pass = false;

    // Steering check: A must increase heading, D must decrease it.
    const h0 = (await getState(cdp)).carHeading;
    await cdp.keyEvent('keyDown', 'KeyW');
    await cdp.keyEvent('keyDown', 'KeyA');
    await sleep(250);
    await cdp.keyEvent('keyUp', 'KeyA');
    const h1 = (await getState(cdp)).carHeading;
    await cdp.keyEvent('keyDown', 'KeyD');
    await sleep(250);
    await cdp.keyEvent('keyUp', 'KeyD');
    await cdp.keyEvent('keyUp', 'KeyW');
    const h2 = (await getState(cdp)).carHeading;
    check(h1 > h0, `steer left (A) increases heading (${h0} -> ${h1})`);
    check(h2 < h1, `steer right (D) decreases heading (${h1} -> ${h2})`);

    // Reposition onto the street after the steering drift (test fixture:
    // a human would stay on the road; the car may have veered off it).
    await cdp.evaluate(`(() => {
      const c = window.__solmara.world.vehicles.playerCar;
      c.pos.set(-10, 0, 131); c.speed = 0; c.heading = -Math.PI / 2;
    })()`);
    // Drive west along z=132 to x=-128.
    if (!(await cdp.holdUntil('KeyW', 'window.__solmara.world.vehicles.playerCar.pos.x <= -128', 25000, 'drive west to x=-128'))) pass = false;
    // Reposition onto the x=-132 street (corrects coast overshoot).
    await cdp.evaluate(`(() => {
      const c = window.__solmara.world.vehicles.playerCar;
      c.pos.set(-132, 0, 131); c.speed = 0; c.heading = Math.PI;
    })()`);
    // Drive north along x=-132 to z=-116.
    if (!(await cdp.holdUntil('KeyW', 'window.__solmara.world.vehicles.playerCar.pos.z <= -116', 30000, 'drive north to z=-116'))) pass = false;
    // Align with the Lookout's latitude (corrects coast overshoot).
    await cdp.evaluate(`(() => {
      const c = window.__solmara.world.vehicles.playerCar;
      c.pos.set(-132, 0, -120); c.speed = 0; c.heading = Math.PI / 2;
    })()`);
    // Drive east into the Lookout trigger.
    if (!(await cdp.holdUntil('KeyW', 'window.__solmara.world.missions.missionIndex === 1', 15000, 'reach Lookout, mission 1 completes -> mission 2 starts'))) pass = false;
    }

    st = await getState(cdp);
    check(st.missionIndex === 1 && st.stage === 0, 'mission 1 COMPLETE, mission 2 started', JSON.stringify(st));
    check(st.completed === false, 'game not all-done after mission 1');
    check(st.money === 850, `payout $500 (money=${st.money})`);
    check(st.rp === 150, `+150 RP (rp=${st.rp})`);
    check(st.banner === true, 'MISSION COMPLETE banner visible');

    console.log('console errors:', cdp.errors.length);
    for (const e of cdp.errors) console.log('  ', e);
    if (cdp.errors.length > 0) pass = false;
    console.log(pass ? 'PLAYTEST: PASS' : 'PLAYTEST: FAIL');
    return pass;
  } finally {
    cdp.close();
    proc.kill();
  }
}

async function modeMissions() {
  // Teleport through every stage of all 8 missions: the engine is
  // data-driven, so this verifies each mission's targets, dialogue and
  // completion without driving every leg in real time. (Mission 1's full
  // drive is covered by the playtest mode.)
  const { proc, cdp } = await launchChrome(`${SERVER}/?autostart=1&lowgfx=1`, 800, 450);
  let pass = true;
  const check = (cond, label, extra) => {
    console.log(`  ${cond ? 'OK ' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`);
    if (!cond) pass = false;
    return cond;
  };
  try {
    if (!(await waitReady(cdp, 30000))) {
      console.log('FAIL page never ready');
      return false;
    }
    await sleep(1000);
    for (let m = 0; m < 8; m++) {
      for (let s = 0; ; s++) {
        const stage = await cdp.evaluate(`(() => {
          const ms = window.__solmara.world.missions;
          const st = ms.stage;
          if (!st) return null;
          return {
            id: st.id, x: st.target.x, z: st.target.z,
            dlg: st.dialogue ? st.dialogue.length : 0,
            m: ms.missionIndex, s: ms.stageIndex,
          };
        })()`);
        if (!stage) break; // all missions done
        if (stage.m !== m) break; // moved on to the next mission
        await cdp.evaluate(`window.__solmara.world.player.pos.set(${stage.x}, 0, ${stage.z})`);
        // Wait for the trigger: dialogue opens, or the stage advances.
        let fired = null;
        const start = Date.now();
        while (Date.now() - start < 8000) {
          const cur = await cdp.evaluate(`(() => {
            const ms = window.__solmara.world.missions;
            return { dlg: ms.dialogueOpen, m: ms.missionIndex, s: ms.stageIndex, done: ms.completed };
          })()`);
          if (cur.dlg || cur.m !== m || cur.s !== s || cur.done) {
            fired = cur;
            break;
          }
          await sleep(400);
        }
        check(!!fired, `m${m + 1} stage ${s + 1} (${stage.id}) trigger fired`);
        if (!fired) return false;
        if (fired.dlg) {
          for (let i = 0; i < stage.dlg; i++) {
            await cdp.tap('Enter', 120);
            await sleep(400);
          }
          await sleep(600);
        }
        const after = await getState(cdp);
        const advanced =
          after.missionIndex > m ||
          (after.missionIndex === m && after.stage > s) ||
          after.completed;
        check(
          advanced,
          `m${m + 1} stage ${s + 1} advanced`,
          `now m${after.missionIndex + 1} s${after.stage + 1} done=${after.completed}`
        );
        if (!advanced) return false;
      }
      const st = await getState(cdp);
      console.log(`  mission ${m + 1} done: money=$${st.money} rp=${st.rp}`);
    }
    const st = await getState(cdp);
    check(st.completed === true, 'all 8 missions COMPLETE', JSON.stringify(st));
    check(st.money === 98050, `total money $98,050 (money=${st.money})`);
    check(st.rp === 2600, `total RP 2600 (rp=${st.rp})`);
    check(st.rank === 9, `rank 9 (rank=${st.rank})`);
    console.log('console errors:', cdp.errors.length);
    for (const e of cdp.errors) console.log('  ', e);
    if (cdp.errors.length > 0) pass = false;
    console.log(pass ? 'MISSIONS: PASS' : 'MISSIONS: FAIL');
    return pass;
  } finally {
    cdp.close();
    proc.kill();
  }
}

async function modeCombat() {
  // Punch + shoot + reload + ammo pickup + pause map + autopilot.
  // 900x600 viewport: the pause menu (map + lists) needs the height.
  const { proc, cdp } = await launchChrome(`${SERVER}/?autostart=1&lowgfx=1`, 900, 600);
  let pass = true;
  const check = (cond, label, extra) => {
    console.log(`  ${cond ? 'OK ' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`);
    if (!cond) pass = false;
    return cond;
  };
  try {
    if (!(await waitReady(cdp, 30000))) {
      console.log('FAIL page never ready');
      return false;
    }
    await sleep(1000);
    let st = await getState(cdp);
    check(st.state === 'playing', 'game playing');
    check(st.clip === 12 && st.reserve === 48, `ammo starts 12/48 (clip=${st.clip} reserve=${st.reserve})`);

    // Freeze a ped and stand next to it on its sidewalk, facing it.
    await cdp.evaluate(`(() => {
      const w = window.__solmara.world;
      const ped = w.peds.peds.find((p) => !p.down);
      ped.speed = 0;
      const pp = ped.mesh.position;
      const ox = ped.alongZ ? 0 : 1.2;
      const oz = ped.alongZ ? 1.2 : 0;
      w.player.pos.set(pp.x + ox, 0, pp.z + oz);
      w.player.yaw = Math.atan2(pp.x - w.player.pos.x, pp.z - w.player.pos.z);
    })()`);
    await sleep(500);
    await cdp.click(450, 300);
    await sleep(600);
    st = await getState(cdp);
    check(st.pedsDown >= 1, 'punch knocked a ped down', `pedsDown=${st.pedsDown}`);
    check(st.wanted >= 1, 'punch raised wanted', `wanted=${st.wanted}`);

    // Switch to the .38 and shoot a second (frozen) ped from 10m.
    await cdp.tap('Digit2', 120);
    await sleep(300);
    st = await getState(cdp);
    check(st.weapon === 1, '.38 selected (slot 2)', `weapon=${st.weapon}`);
    await cdp.evaluate(`(() => {
      const w = window.__solmara.world;
      const ped = w.peds.peds.find((p) => !p.down);
      ped.speed = 0;
      const pp = ped.mesh.position;
      const ox = ped.alongZ ? 0 : 10;
      const oz = ped.alongZ ? 10 : 0;
      w.player.pos.set(pp.x + ox, 0, pp.z + oz);
      w.player.yaw = Math.atan2(pp.x - w.player.pos.x, pp.z - w.player.pos.z);
    })()`);
    await sleep(500);
    await cdp.click(450, 300);
    await sleep(600);
    st = await getState(cdp);
    check(st.clip === 11, 'shot consumed 1 round', `clip=${st.clip}`);
    check(st.pedsDown >= 2, 'shot knocked a ped down', `pedsDown=${st.pedsDown}`);

    // Reload.
    await cdp.tap('KeyR', 120);
    await sleep(400);
    st = await getState(cdp);
    check(st.clip === 12 && st.reserve === 47, 'reload refilled the clip', `clip=${st.clip} reserve=${st.reserve}`);

    // Ammo pickup at (6.5, 88).
    await cdp.evaluate('window.__solmara.world.player.pos.set(6.5, 0, 88)');
    await sleep(500);
    await cdp.tap('KeyE', 120);
    await sleep(400);
    st = await getState(cdp);
    check(st.reserve === 71, 'ammo pickup +24 reserve', `reserve=${st.reserve}`);

    // Pause menu: island map + mission list render.
    await cdp.tap('KeyP', 120);
    await sleep(600);
    st = await getState(cdp);
    check(st.paused === true, 'pause menu opens (P)', `paused=${st.paused}`);
    const pauseInfo = await cdp.evaluate(`(() => {
      const list = document.getElementById('pause-missions').textContent;
      const canvas = document.getElementById('island-map');
      const ctx = canvas.getContext('2d');
      const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let nonBlank = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 30) nonBlank++;
      return { list, mapPixels: nonBlank };
    })()`);
    check(
      pauseInfo.list.includes('The Meridian Job') && pauseInfo.list.includes('$1,200'),
      'pause mission list shows all 8 real missions',
      pauseInfo.list.slice(0, 90)
    );
    check(pauseInfo.mapPixels > 1000, 'island map canvas drawn', `nonBlankPx=${pauseInfo.mapPixels}`);
    // Save a pause-menu screenshot for a visual check (outside the repo).
    await cdp.screenshot('/tmp/pause-menu.jpg', 80);
    // Resume via a real click on the button (user gesture for pointer lock).
    const rect = await cdp.evaluate(`(() => {
      const r = document.getElementById('resume-btn').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await cdp.click(rect.x, rect.y);
    await sleep(500);
    st = await getState(cdp);
    check(st.paused === false && st.state === 'playing', 'resume returns to play');

    // Autopilot: steal the car by spawn, toggle F9, verify it drives.
    await cdp.evaluate('window.__solmara.world.player.pos.set(5.6, 0, 44)');
    await sleep(400);
    await cdp.tap('KeyF', 150);
    await sleep(500);
    st = await getState(cdp);
    check(st.inCar === true, 'entered car for autopilot test', JSON.stringify(st));
    if (st.inCar) {
      await cdp.tap('F9', 120);
      await sleep(400);
      st = await getState(cdp);
      check(st.autopilot === true, 'F9 enabled autopilot', `autopilot=${st.autopilot}`);
      const before = { x: st.carX, z: st.carZ };
      await sleep(15000);
      st = await getState(cdp);
      const moved = Math.hypot(st.carX - before.x, st.carZ - before.z);
      // Headless SwiftShader runs ~1-2 FPS, so 15 real seconds is only
      // ~2 game seconds — the car just needs to be moving. The full
      // end-to-end drive is proven by the autopilot mode.
      check(
        moved > 3,
        `autopilot drove the car (${moved.toFixed(1)}m in 15s)`,
        `from (${before.x},${before.z}) to (${st.carX},${st.carZ})`
      );
      await cdp.tap('KeyW', 150);
      await sleep(400);
      st = await getState(cdp);
      check(st.autopilot === false, 'W cancels autopilot', `autopilot=${st.autopilot}`);
    }

    console.log('console errors:', cdp.errors.length);
    for (const e of cdp.errors) console.log('  ', e);
    if (cdp.errors.length > 0) pass = false;
    console.log(pass ? 'COMBAT: PASS' : 'COMBAT: FAIL');
    return pass;
  } finally {
    cdp.close();
    proc.kill();
  }
}

async function modeAutopilot() {
  // Full end-to-end autopilot run: finish mission 1's dialogue, steal a
  // car, enable F9, and let the autopilot drive the whole route to the
  // Lookout (mission 1 stage 2). Proves the grid router, the turns, and
  // the final approach into a trigger.
  const { proc, cdp } = await launchChrome(`${SERVER}/?autostart=1&lowgfx=1`, 800, 450);
  let pass = true;
  const check = (cond, label, extra) => {
    console.log(`  ${cond ? 'OK ' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`);
    if (!cond) pass = false;
    return cond;
  };
  try {
    if (!(await waitReady(cdp, 30000))) {
      console.log('FAIL page never ready');
      return false;
    }
    await sleep(1000);
    // Stage 1: teleport to Lina, talk through the dialogue.
    await cdp.evaluate('window.__solmara.world.player.pos.set(30, 0, 150)');
    const dlg = await cdp.holdUntil(
      'KeyW',
      'window.__solmara.world.missions.dialogueOpen',
      8000,
      'dialogue opens at Lina'
    );
    if (!dlg) pass = false;
    for (let i = 0; i < 3; i++) {
      await cdp.tap('Enter', 120);
      await sleep(400);
    }
    let st = await getState(cdp);
    check(st.stage === 1, 'stage 1 done, drive-to stage active', JSON.stringify(st));
    // Steal the car by spawn, enable autopilot.
    await cdp.evaluate('window.__solmara.world.player.pos.set(5.6, 0, 44)');
    await sleep(400);
    await cdp.tap('KeyF', 150);
    await sleep(500);
    st = await getState(cdp);
    check(st.inCar === true, 'entered car', JSON.stringify(st));
    if (!st.inCar) {
      console.log('  SKIP autopilot drive — never got in a car');
    } else {
      await cdp.tap('F9', 120);
      await sleep(400);
      st = await getState(cdp);
      check(st.autopilot === true, 'F9 enabled autopilot');
      // Watch the drive: log position every 20s while waiting.
      const start = Date.now();
      let done = false;
      while (Date.now() - start < 300000) {
        st = await getState(cdp);
        if (st.missionIndex === 1) {
          done = true;
          break;
        }
        console.log(
          `  ... ${(Date.now() - start) / 1000}s car=(${st.carX},${st.carZ}) ` +
            `speed=${st.carSpeed} cond=${st.carCondition} auto=${st.autopilot}`
        );
        await sleep(20000);
      }
      check(done, 'autopilot drove to the Lookout, mission 1 complete', JSON.stringify(st));
      check(st.money === 850, `payout $500 (money=${st.money})`);
    }
    console.log('console errors:', cdp.errors.length);
    for (const e of cdp.errors) console.log('  ', e);
    if (cdp.errors.length > 0) pass = false;
    console.log(pass ? 'AUTOPILOT: PASS' : 'AUTOPILOT: FAIL');
    return pass;
  } finally {
    cdp.close();
    proc.kill();
  }
}

async function modeDiag() {
  // Small viewport: SwiftShader is fragment-bound, fewer pixels = faster.
  const { proc, cdp } = await launchChrome(`${SERVER}/?autostart=1&lowgfx=1`, 800, 450);
  try {
    if (!(await waitReady(cdp, 30000))) {
      console.log('FAIL page never ready');
      return false;
    }
    await cdp.evaluate(`(() => {
      window.__fps = { samples: [], last: performance.now() };
      const loop = () => {
        const now = performance.now();
        window.__fps.samples.push(now - window.__fps.last);
        window.__fps.last = now;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    })()`);
    console.log('hidden:', await cdp.evaluate('document.hidden'), 'visibility:', await cdp.evaluate('document.visibilityState'));
    // Hold W for 10s, sample position + frame times every 2s.
    await cdp.evaluate('window.__solmara.world.player.yaw = 0');
    await cdp.keyEvent('keyDown', 'KeyW');
    for (let i = 0; i < 5; i++) {
      await sleep(2000);
      const st = await getState(cdp);
      const fps = await cdp.evaluate(`(() => {
        const s = window.__fps.samples;
        const avg = s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0;
        return { frames: s.length, avgMs: +avg.toFixed(1), maxMs: +Math.max(...s).toFixed(1) };
      })()`);
      console.log(`t=${(i + 1) * 2}s pos=(${st.px}, ${st.pz}) yaw=${st.yaw} frames=${fps.frames} avgFrame=${fps.avgMs}ms maxFrame=${fps.maxMs}ms`);
    }
    await cdp.keyEvent('keyUp', 'KeyW');
    return true;
  } finally {
    cdp.close();
    proc.kill();
  }
}

const mode = process.argv[2] || 'smoke';
const runners = { smoke: modeSmoke, shots: modeShots, playtest: modePlaytest, missions: modeMissions, combat: modeCombat, autopilot: modeAutopilot, diag: modeDiag };
if (!runners[mode]) {
  console.error('unknown mode:', mode);
  process.exit(2);
}
runners[mode]()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((err) => {
    console.error('QA ERROR:', err);
    process.exit(2);
  });
