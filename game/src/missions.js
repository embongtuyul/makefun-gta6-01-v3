// missions.js — data-driven mission system: a stage state machine with
// generous triggers and a dialogue box. Triggers fire on proximity OR
// E OR Enter (multiple conditions), NPCs never collide, and trigger
// areas are kept clear of furniture (see city.js CLEAR_ZONES).
//
// All 8 story missions are implemented end-to-end. Completing a mission
// advances to the next one; only after mission 8 does the game go free
// roam. Only the current stage's NPC is visible at any time.

import * as THREE from 'three';
import { dist2D } from './utils.js';

export const MISSIONS = [
  {
    id: 'm1-welcome',
    title: 'WELCOME TO SOLMARA',
    next: 'NEXT: The Meridian Job',
    payout: 500,
    rp: 150,
    stages: [
      {
        id: 'meet-lina',
        objective: 'Meet Lina at the Marina',
        hint: 'Follow the yellow marker — walk up to Lina',
        target: { x: 30, z: 150 },
        radius: 5, // proximity trigger
        interactRadius: 8, // E / Enter trigger
        npc: { name: 'Lina', x: 30, z: 150, shirt: 0xe8722a, pants: 0x2a2f45, skin: 0xd9a077 },
        dialogue: [
          { name: 'LINA', text: "You made it. Solmara chews up newcomers — stick with me and you'll eat well." },
          { name: 'LINA', text: "My cousin left a car up at the Lookout, north-west hills. Bring it back in one piece." },
          { name: 'LINA', text: 'Drive careful. The Meridian crew watches that road. Go — I will keep the engine warm here.' },
        ],
      },
      {
        id: 'drive-lookout',
        objective: 'Drive to the Lookout',
        hint: 'Grab a car with F — or walk it, your call',
        target: { x: -120, z: -120 },
        radius: 7,
        interactRadius: 10,
        dialogue: null,
      },
    ],
  },
  {
    id: 'm2-meridian',
    title: 'THE MERIDIAN JOB',
    next: 'NEXT: Ember Run',
    payout: 1200,
    rp: 200,
    stages: [
      {
        id: 'meet-marco',
        objective: 'Meet Marco in Downtown',
        hint: 'Marco waits at the 44th Street crossing',
        target: { x: 44, z: -44 },
        radius: 5,
        interactRadius: 8,
        npc: { name: 'Marco', x: 44, z: -44, shirt: 0x3a6ea5, pants: 0x3a3a3a, skin: 0xb07a4f },
        dialogue: [
          { name: 'MARCO', text: 'Lina sent you? Good. The Meridian crew left a package in Palm Court — papers, nothing hot.' },
          { name: 'MARCO', text: 'Pick it up at the north-east corner and bring it down to the Boardwalk. Quick and quiet.' },
          { name: 'MARCO', text: 'Twelve hundred when the package is in my hands. Go.' },
        ],
      },
      {
        id: 'pickup-package',
        objective: 'Pick up the package in Palm Court',
        hint: 'North-east corner of the city — follow the marker',
        target: { x: 132, z: -132 },
        radius: 7,
        interactRadius: 10,
        dialogue: null,
      },
      {
        id: 'deliver-boardwalk',
        objective: 'Deliver the package to the Boardwalk',
        hint: 'South end of the city, by the sea',
        target: { x: 0, z: 190 },
        radius: 7,
        interactRadius: 10,
        dialogue: [
          { name: 'MARCO (PHONE)', text: 'Package received. Clean work — the Meridian crew will remember your name.' },
          { name: 'MARCO (PHONE)', text: 'Your cut is in. There is more where that came from.' },
        ],
      },
    ],
  },
  {
    id: 'm3-ember',
    title: 'EMBER RUN',
    next: 'NEXT: Boardwalk Heat',
    payout: 2500,
    rp: 250,
    stages: [
      {
        id: 'meet-ember',
        objective: 'Meet Ember in Mirador Hills',
        hint: 'North-west hills, past the volcano road',
        target: { x: -132, z: -132 },
        radius: 5,
        interactRadius: 8,
        npc: { name: 'Ember', x: -132, z: -132, shirt: 0xc23b2e, pants: 0x2a2f45, skin: 0xf0c8a0 },
        dialogue: [
          { name: 'EMBER', text: 'You drive fast? Good. I need a courier who does not ask questions.' },
          { name: 'EMBER', text: 'Take the east road all the way to Solmar Strand. If the cops light up, do not stop.' },
          { name: 'EMBER', text: 'When the heat is off, come back up to the Lookout. Twenty-five hundred, cash.' },
        ],
      },
      {
        id: 'drive-strand',
        objective: 'Drive to Solmar Strand',
        hint: 'East side of the city — keep moving',
        target: { x: 176, z: 44 },
        radius: 7,
        interactRadius: 10,
        dialogue: null,
      },
      {
        id: 'escape-lookout',
        objective: 'Lose the heat — return to the Lookout',
        hint: 'Back north-west, to the hills',
        target: { x: -120, z: -120 },
        radius: 7,
        interactRadius: 10,
        dialogue: [
          { name: 'EMBER (PHONE)', text: 'You made it out clean. The Strand drop is done and nobody saw your face.' },
          { name: 'EMBER (PHONE)', text: 'Twenty-five hundred, as promised. Drive safe.' },
        ],
      },
    ],
  },
  {
    id: 'm4-boardwalk',
    title: 'BOARDWALK HEAT',
    next: 'NEXT: The Volcano Club',
    payout: 4000,
    rp: 300,
    stages: [
      {
        id: 'meet-rosa',
        objective: 'Meet Rosa on the Boardwalk',
        hint: 'East end of the Boardwalk, by the sea',
        target: { x: 88, z: 190 },
        radius: 5,
        interactRadius: 8,
        npc: { name: 'Rosa', x: 88, z: 190, shirt: 0xff8c2f, pants: 0x5a4a3a, skin: 0xd9a077 },
        dialogue: [
          { name: 'ROSA', text: 'The Boardwalk is mine, but the Old Marina crew keeps testing me.' },
          { name: 'ROSA', text: 'Go out west and remind them who runs the shore. Then come back through Downtown.' },
          { name: 'ROSA', text: 'Four thousand. And Rosa does not forget a favour.' },
        ],
      },
      {
        id: 'drive-old-marina',
        objective: 'Drive to the Old Marina',
        hint: 'Far west side of the city',
        target: { x: -176, z: 88 },
        radius: 7,
        interactRadius: 10,
        dialogue: null,
      },
      {
        id: 'return-downtown',
        objective: 'Return through Downtown',
        hint: 'Back to the city centre',
        target: { x: 0, z: 0 },
        radius: 7,
        interactRadius: 10,
        dialogue: [
          { name: 'ROSA (PHONE)', text: 'The Old Marina crew got the message. The Boardwalk is quiet tonight.' },
          { name: 'ROSA (PHONE)', text: 'Four thousand, in your pocket. You are good people.' },
        ],
      },
    ],
  },
  {
    id: 'm5-volcano',
    title: 'THE VOLCANO CLUB',
    next: 'NEXT: Salt & Chrome',
    payout: 7500,
    rp: 350,
    stages: [
      {
        id: 'meet-vico',
        objective: 'Meet Vico in Palm Court',
        hint: 'North-east corner — the glass towers',
        target: { x: 132, z: -132 },
        radius: 5,
        interactRadius: 8,
        npc: { name: 'Vico', x: 132, z: -132, shirt: 0x8a4fb5, pants: 0x2a2f45, skin: 0x8a5a3a },
        dialogue: [
          { name: 'VICO', text: 'The Volcano Club opens tonight, and I need a driver the cops do not know yet.' },
          { name: 'VICO', text: 'First, pick up my guest from Mirador Hills. Then bring them to the club in Downtown.' },
          { name: 'VICO', text: 'Seventy-five hundred. Dress code is: do not get caught.' },
        ],
      },
      {
        id: 'drive-mirador',
        objective: 'Pick up the guest in Mirador Hills',
        hint: 'Far north-west corner of the city',
        target: { x: -176, z: -176 },
        radius: 7,
        interactRadius: 10,
        dialogue: null,
      },
      {
        id: 'club-downtown',
        objective: 'Drive the guest to the Volcano Club',
        hint: 'Downtown, south-east of the centre',
        target: { x: 44, z: 44 },
        radius: 7,
        interactRadius: 10,
        dialogue: [
          { name: 'VICO (PHONE)', text: 'The guest is inside and the club is jumping. You drive like the road owes you money.' },
          { name: 'VICO (PHONE)', text: 'Seventy-five hundred. The Volcano Club remembers its friends.' },
        ],
      },
    ],
  },
  {
    id: 'm6-salt-chrome',
    title: 'SALT & CHROME',
    next: 'NEXT: The Last Ferry',
    payout: 12000,
    rp: 400,
    stages: [
      {
        id: 'meet-sal',
        objective: 'Meet Sal in the Old Marina',
        hint: 'West side, by the fishing boats',
        target: { x: -176, z: 44 },
        radius: 5,
        interactRadius: 8,
        npc: { name: 'Sal', x: -176, z: 44, shirt: 0x37c8c8, pants: 0x3a3a3a, skin: 0xb07a4f },
        dialogue: [
          { name: 'SAL', text: 'Twelve thousand for one night of work. A chrome shipment is coming into Solmar Strand.' },
          { name: 'SAL', text: 'Fetch it from the east side and bring it to the west Boardwalk. No questions, no stops.' },
          { name: 'SAL', text: 'The sea pays those who move fast. Go.' },
        ],
      },
      {
        id: 'fetch-strand',
        objective: 'Fetch the shipment in Solmar Strand',
        hint: 'East side of the city',
        target: { x: 176, z: -44 },
        radius: 7,
        interactRadius: 10,
        dialogue: null,
      },
      {
        id: 'deliver-west-boardwalk',
        objective: 'Deliver to the west Boardwalk',
        hint: 'South-west end, by the sea',
        target: { x: -88, z: 190 },
        radius: 7,
        interactRadius: 10,
        dialogue: [
          { name: 'SAL (PHONE)', text: 'Chrome is in. The buyer is happy and the sea is calm.' },
          { name: 'SAL (PHONE)', text: 'Twelve thousand. You are becoming a legend on this shore.' },
        ],
      },
    ],
  },
  {
    id: 'm7-ferry',
    title: 'THE LAST FERRY',
    next: 'NEXT: King of the Shore',
    payout: 20000,
    rp: 450,
    stages: [
      {
        id: 'meet-captain',
        objective: 'Meet the Captain at the Marina',
        hint: 'The pier, where Lina first found you',
        target: { x: 30, z: 150 },
        radius: 5,
        interactRadius: 8,
        npc: { name: 'Captain', x: 30, z: 150, shirt: 0x2a4a6a, pants: 0x2a2f45, skin: 0xf0c8a0 },
        dialogue: [
          { name: 'CAPTAIN', text: 'The last ferry leaves at dawn, and one passenger still needs collecting.' },
          { name: 'CAPTAIN', text: 'Palm Court, north-east. Bring them to the east Boardwalk before the sun comes up.' },
          { name: 'CAPTAIN', text: 'Twenty thousand. The sea does not wait, and neither do I.' },
        ],
      },
      {
        id: 'drive-palm-court',
        objective: 'Collect the passenger in Palm Court',
        hint: 'North-east, near the coast road',
        target: { x: 88, z: -176 },
        radius: 7,
        interactRadius: 10,
        dialogue: null,
      },
      {
        id: 'ferry-boardwalk',
        objective: 'Deliver the passenger to the ferry',
        hint: 'East Boardwalk — the ferry waits',
        target: { x: 176, z: 190 },
        radius: 7,
        interactRadius: 10,
        dialogue: [
          { name: 'CAPTAIN (PHONE)', text: 'The passenger is aboard. The ferry pulls out with the tide.' },
          { name: 'CAPTAIN (PHONE)', text: 'Twenty thousand. Fair winds, kid. The shore is almost yours.' },
        ],
      },
    ],
  },
  {
    id: 'm8-king',
    title: 'KING OF THE SHORE',
    next: 'FINAL MISSION',
    payout: 50000,
    rp: 500,
    stages: [
      {
        id: 'meet-lina-lookout',
        objective: 'Meet Lina at the Lookout',
        hint: 'Where it all started — the north-west hills',
        target: { x: -120, z: -120 },
        radius: 5,
        interactRadius: 8,
        npc: { name: 'Lina', x: -120, z: -120, shirt: 0xe8722a, pants: 0x2a2f45, skin: 0xd9a077 },
        dialogue: [
          { name: 'LINA', text: 'Look at you. From a nobody off the ferry to the name on every street in Solmara.' },
          { name: 'LINA', text: 'One last drive. Through Downtown, down to the Boardwalk, where the whole city can see you.' },
          { name: 'LINA', text: 'Fifty thousand. And the shore itself. Go claim it.' },
        ],
      },
      {
        id: 'drive-downtown',
        objective: 'Drive through Downtown',
        hint: 'The city centre — let them see you',
        target: { x: 0, z: -88 },
        radius: 7,
        interactRadius: 10,
        dialogue: null,
      },
      {
        id: 'crown-boardwalk',
        objective: 'Reach the Boardwalk — claim the shore',
        hint: 'South end, by the sea. The finish line.',
        target: { x: 0, z: 190 },
        radius: 7,
        interactRadius: 10,
        dialogue: [
          { name: 'LINA (PHONE)', text: 'The whole Boardwalk is watching. Solmara has a new king.' },
          { name: 'LINA (PHONE)', text: 'Fifty thousand. The shore is yours now — every street, every sunset.' },
        ],
      },
    ],
  },
];

export class Missions {
  constructor(world) {
    this.world = world;
    this.missionIndex = 0;
    this.stageIndex = 0;
    this.completed = false;
    this.dialogueOpen = false;
    this.dialogueIndex = 0;
    this.npcMeshes = [];
    this.buildMarker();
    this.buildNpcs();
  }

  get mission() {
    return MISSIONS[this.missionIndex];
  }

  get stage() {
    if (this.completed) return null;
    return this.mission.stages[this.stageIndex];
  }

  get target() {
    const s = this.stage;
    return s ? s.target : null;
  }

  buildMarker() {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd23f, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
    });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.18, 24), mat);
    disc.position.y = 0.12;
    g.add(disc);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffe066, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 46, 10, 1, true), beamMat);
    beam.position.y = 23;
    g.add(beam);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 3.1, 32),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.14;
    g.add(ring);
    this.markerDisc = disc;
    this.markerRing = ring;
    this.marker = g;
    this.world.scene.add(g);
    this.updateMarkerPosition();
  }

  buildNpcs() {
    for (let mIdx = 0; mIdx < MISSIONS.length; mIdx++) {
      for (let sIdx = 0; sIdx < MISSIONS[mIdx].stages.length; sIdx++) {
        const s = MISSIONS[mIdx].stages[sIdx];
        if (!s.npc) continue;
        const npc = s.npc;
        const g = new THREE.Group();
        const shirt = new THREE.MeshLambertMaterial({ color: npc.shirt });
        const pants = new THREE.MeshLambertMaterial({ color: npc.pants });
        const skin = new THREE.MeshLambertMaterial({ color: npc.skin });
        const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.75, 0.24), pants);
        legL.position.set(-0.13, 0.38, 0);
        const legR = legL.clone();
        legR.position.x = 0.13;
        const torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.68, 0.32), shirt);
        torso.position.y = 1.1;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), skin);
        head.position.y = 1.64;
        const hair = new THREE.Mesh(
          new THREE.SphereGeometry(0.24, 10, 8, 0, Math.PI * 2, 0, 1.2),
          new THREE.MeshLambertMaterial({ color: 0x2a1a10 })
        );
        hair.position.y = 1.68;
        for (const mesh of [legL, legR, torso, head, hair]) {
          mesh.castShadow = true;
          g.add(mesh);
        }
        g.position.set(npc.x, 0, npc.z);
        g.rotation.y = Math.PI; // face north, toward the player's approach
        this.world.scene.add(g);
        this.npcMeshes.push({
          mesh: g, baseY: 0, phase: Math.random() * 6,
          missionIndex: mIdx, stageIndex: sIdx,
        });
      }
    }
    this.updateNpcVisibility();
  }

  // Only the current stage's NPC is visible — later missions' contacts
  // should not be standing around the city before their time.
  updateNpcVisibility() {
    for (const n of this.npcMeshes) {
      n.mesh.visible =
        !this.completed &&
        n.missionIndex === this.missionIndex &&
        n.stageIndex === this.stageIndex;
    }
  }

  updateMarkerPosition() {
    const t = this.target;
    if (!t) {
      this.marker.visible = false;
      this.updateNpcVisibility();
      return;
    }
    this.marker.visible = true;
    this.marker.position.set(t.x, 0, t.z);
    this.updateNpcVisibility();
  }

  // Called on E or Enter. Advances dialogue if open, else tries the trigger.
  tryInteract() {
    if (this.dialogueOpen) {
      this.advanceDialogue();
      return true;
    }
    const s = this.stage;
    if (!s) return false;
    const p = this.world.player.pos;
    if (dist2D(p.x, p.z, s.target.x, s.target.z) <= s.interactRadius) {
      this.fireTrigger();
      return true;
    }
    return false;
  }

  fireTrigger() {
    const s = this.stage;
    if (!s) return;
    if (s.dialogue && s.dialogue.length > 0) {
      this.dialogueOpen = true;
      this.dialogueIndex = 0;
      this.showDialogueLine();
      this.world.hud.setPrompt(null);
      this.world.audio.blip();
    } else {
      this.advanceStage();
    }
  }

  showDialogueLine() {
    const s = this.stage;
    const line = s.dialogue[this.dialogueIndex];
    this.world.hud.showDialogue(line.name, line.text, this.dialogueIndex + 1, s.dialogue.length);
  }

  advanceDialogue() {
    const s = this.stage;
    this.dialogueIndex++;
    if (this.dialogueIndex >= s.dialogue.length) {
      this.dialogueOpen = false;
      this.world.hud.hideDialogue();
      this.advanceStage();
    } else {
      this.showDialogueLine();
      this.world.audio.blip();
    }
  }

  advanceStage() {
    this.stageIndex++;
    if (this.stageIndex >= this.mission.stages.length) {
      this.completeMission();
      return;
    }
    this.updateMarkerPosition();
    this.world.audio.blip();
  }

  completeMission() {
    const m = this.mission;
    this.world.state.money += m.payout;
    this.world.state.stats.missionsDone++;
    this.world.state.stats.cashEarned += m.payout;
    this.world.addRP(m.rp);
    this.world.hud.showBanner('MISSION COMPLETE', `${m.title}  ·  $${m.payout}  ·  +${m.rp} RP`);
    this.world.audio.jingle();
    // Advance to the next mission; only after the last one is the game
    // over into free roam.
    if (this.missionIndex + 1 < MISSIONS.length) {
      this.missionIndex++;
      this.stageIndex = 0;
      this.updateMarkerPosition();
      return;
    }
    this.completed = true;
    this.marker.visible = false;
    this.updateNpcVisibility();
  }

  update(dt, t) {
    // Marker pulse + ring spin.
    if (this.marker.visible) {
      const pulse = 1 + Math.sin(t * 3) * 0.08;
      this.markerDisc.scale.set(pulse, 1, pulse);
      this.markerRing.rotation.z += dt * 0.8;
    }
    // NPC idle bob.
    for (const n of this.npcMeshes) {
      n.phase += dt * 1.5;
      n.mesh.position.y = n.baseY + Math.sin(n.phase) * 0.03;
    }
    if (this.completed || this.dialogueOpen) return;
    const s = this.stage;
    if (!s) return;
    // Proximity trigger (generous radius).
    const p = this.world.player.pos;
    if (dist2D(p.x, p.z, s.target.x, s.target.z) <= s.radius) {
      this.fireTrigger();
    }
  }

  // HUD snapshot for the mission card.
  hudState() {
    if (this.completed) {
      return {
        title: 'KING OF THE SHORE',
        stageText: 'ALL 8 MISSIONS DONE',
        objective: 'The city is yours. Free roam — every street, every sunset.',
        next: 'SOLMARA — FREE ROAM',
      };
    }
    return {
      title: this.mission.title,
      stageText: `MISSION ${this.missionIndex + 1}/8 · STAGE ${this.stageIndex + 1}/${this.mission.stages.length}`,
      objective: this.stage.objective,
      next: this.mission.next,
    };
  }
}
