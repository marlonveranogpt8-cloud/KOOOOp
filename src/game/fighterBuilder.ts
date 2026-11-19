import * as THREE from 'three';
import {
  ArenaActorState,
  FIGHTER_BY_ID,
  FighterId,
  MapId,
  SkinId,
  getFighterSkinMeta,
  getMapTerrainHeight,
} from '../shared/gameData.ts';
import { AWAKENING_CONFIG } from '../shared/awakeningConfig.ts';
import {
  computeContactShadowTransform,
  dampAngle,
  dampScalar,
} from './combatMath.ts';

export type EyeState = 'normal' | 'fierce' | 'shock' | 'ko';

export interface FighterPose {
  x: number;
  y: number;
  z: number;
  rotY: number;
  leanX: number;
  leanZ: number;
  hipY: number;
  torsoPitch: number;
  torsoYaw: number;
  torsoRoll: number;
  headPitch: number;
  headYaw: number;
  armLAngle: [number, number, number];
  elbowL: number;
  armRAngle: [number, number, number];
  elbowR: number;
  legLAngle: [number, number, number];
  kneeL: number;
  legRAngle: [number, number, number];
  kneeR: number;
  squash: number;
  eyeState: EyeState;
  auraOpacity: number;
  bodyOpacity: number;
}

export const DEFAULT_POSE: FighterPose = {
  x: 0,
  y: 0,
  z: 0,
  rotY: 0,
  leanX: 0,
  leanZ: 0,
  hipY: 0,
  torsoPitch: 0,
  torsoYaw: 0,
  torsoRoll: 0,
  headPitch: 0,
  headYaw: 0,
  armLAngle: [-0.2, 0, -0.22],
  elbowL: -0.35,
  armRAngle: [-0.2, 0, 0.22],
  elbowR: -0.35,
  legLAngle: [0.04, 0, -0.05],
  kneeL: 0.08,
  legRAngle: [-0.04, 0, 0.05],
  kneeR: 0.08,
  squash: 1.0,
  eyeState: 'fierce',
  auraOpacity: 0.35,
  bodyOpacity: 1.0,
};

export interface FighterRig {
  id: FighterId;
  skinId: SkinId;
  isLocalPlayer: boolean;
  root: THREE.Group;
  leanPivot: THREE.Group;
  squashGroup: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  elbowL: THREE.Group;
  armR: THREE.Group;
  elbowR: THREE.Group;
  legL: THREE.Group;
  kneeL: THREE.Group;
  legR: THREE.Group;
  kneeR: THREE.Group;
  eyeTex: THREE.CanvasTexture & { userData: { drawState: (s: EyeState) => boolean } };
  auraRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  heroInnerRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | null;
  outlineMaterial: THREE.MeshBasicMaterial | null;
  cowboyHat: THREE.Group | null;
  glassesGlint: THREE.Group | null;
  crownHalo: THREE.Group | null;
  wingL: THREE.Group | null;
  wingR: THREE.Group | null;
  roninWindRing: THREE.Mesh | null;
  companionGroup: THREE.Group | null;
  companionTail: THREE.Mesh | null;
  teardrops: THREE.Mesh[] | null;
  goldenShield: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial> | null;
  shieldShards: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number }> | null;
  dissolveCloud: THREE.Points | null;
  bodyMaterials: THREE.Material[];
  standardMaterials: Array<{
    mat: THREE.MeshStandardMaterial;
    baseEmissive: number;
    baseIntensity: number;
  }>;
  hairTufts: THREE.Mesh[] | null;
  hitFlashTimer: number;
  lastPoseTime: number;
  staffGroup: THREE.Group | null;
  sashRibbons: THREE.Mesh[] | null;
  coatTail: THREE.Mesh | null;
  idBadge: THREE.Mesh | null;
  tailwindRibbons: THREE.Mesh[] | null;
  tailwindExtraRibbons: THREE.Mesh[] | null;
  magmaVeins: THREE.Mesh[] | null;
  frenzyFlameShell: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null;
  deadeyeRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | null;
  voidWisps: THREE.Mesh[] | null;
  jmHandGlows: THREE.Mesh[] | null;
  contactShadow: THREE.Mesh;
  overheadSprite: THREE.Sprite;
  overheadCanvas: HTMLCanvasElement;
  overheadCtx: CanvasRenderingContext2D;
  overheadTex: THREE.CanvasTexture;
  lastBarKey: string;
  smoothedPose: FighterPose | null;
  walkPhase: number;
  landingSquash: number;
  lastSpeed: number;
  awakenedParts: THREE.Object3D[];
  awakenedOrbiters: THREE.Object3D[];
  silencedRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  snareMarkRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  transformFlashTime: number;
}

export function triggerFighterHitFlash(rig: FighterRig, duration = 0.13): void {
  rig.hitFlashTimer = Math.max(rig.hitFlashTimer, duration);
}

function createPlaidTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#d97706';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = 'rgba(124, 45, 18, 0.55)';
  for (let i = 0; i < 128; i += 32) {
    ctx.fillRect(i, 0, 14, 128);
    ctx.fillRect(0, i, 128, 14);
  }
  ctx.fillStyle = 'rgba(254, 243, 199, 0.35)';
  for (let i = 20; i < 128; i += 32) {
    ctx.fillRect(i, 0, 4, 128);
    ctx.fillRect(0, i, 128, 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createBadgeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 96, 128);
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(0, 0, 96, 26);
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('JM', 48, 19);
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.arc(48, 62, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(18, 92, 60, 8);
  ctx.fillRect(26, 106, 44, 6);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createAnimeEyeTexture(irisColor: string) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  let currentState: EyeState | '' = '';

  const drawState = (state: EyeState): boolean => {
    if (state === currentState) return false;
    currentState = state;
    ctx.clearRect(0, 0, 128, 128);

    if (state === 'ko') {
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(28, 34);
      ctx.lineTo(100, 94);
      ctx.moveTo(100, 34);
      ctx.lineTo(28, 94);
      ctx.stroke();
      return true;
    }

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(64, 64, 46, state === 'shock' ? 48 : 42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#0f172a';
    ctx.stroke();

    const irisR = state === 'shock' ? 16 : 26;
    ctx.fillStyle = irisColor;
    ctx.beginPath();
    ctx.arc(64, 66, irisR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#090d16';
    ctx.beginPath();
    ctx.arc(64, 68, irisR * 0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(52, 52, state === 'shock' ? 6 : 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(76, 78, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(64, 58, 48, Math.PI * 1.05, Math.PI * 1.95);
    ctx.lineWidth = state === 'fierce' ? 12 : 8;
    ctx.stroke();
    return true;
  };

  drawState('fierce');
  const tex = new THREE.CanvasTexture(c) as THREE.CanvasTexture & {
    userData: { drawState: (s: EyeState) => boolean };
  };
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData = { drawState };
  return tex;
}

function createMiniNameSprite(label: string, bgColor: string, borderColor: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 48;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bgColor;
  ctx.fillRect(10, 6, 140, 34);
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 6, 140, 34);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 80, 24);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
  );
  sp.scale.set(0.82, 0.25, 1);
  return sp;
}

export function createArticulatedFighter(
  id: FighterId,
  scene: THREE.Scene,
  skinId: SkinId = 'ascended',
  isLocalPlayer = false
): FighterRig {
  const cfg = FIGHTER_BY_ID[id];
  const skinMeta = getFighterSkinMeta(id, skinId);
  const skinAccentHex = new THREE.Color(skinMeta.accentColor).getHex();
  const root = new THREE.Group();
  scene.add(root);

  // Soft contact shadow grounded under fighter
  const contactShadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.64, 20),
    new THREE.MeshBasicMaterial({
      color: 0x050814,
      transparent: true,
      opacity: 0.44,
      depthWrite: false,
    })
  );
  contactShadow.rotation.x = -Math.PI * 0.5;
  contactShadow.position.y = 0.03;
  contactShadow.renderOrder = 4;
  root.add(contactShadow);

  const leanPivot = new THREE.Group();
  root.add(leanPivot);

  const squashGroup = new THREE.Group();
  leanPivot.add(squashGroup);

  const isObsidianDamen = id === 'damen' && skinId === 'special';
  const isSadPrime = id === 'prime' && skinId === 'special';
  const isBeggarMarjohn = id === 'marjohn' && skinId === 'special';
  const isMonarchJm = id === 'jm' && skinId === 'special';
  const isSeraphJm = id === 'jm' && skinId === 'ascended';
  const isDuoKhen = id === 'khen' && skinId === 'special';
  const isPhantomKhen = id === 'khen' && skinId === 'ascended';
  const isRoninMarjohn = id === 'marjohn' && skinId === 'ascended';
  const isOutlawDamen = id === 'damen' && skinId === 'ascended';
  const isJuggernautPrime = id === 'prime' && skinId === 'ascended';

  const skinMat = new THREE.MeshStandardMaterial({
    color: isObsidianDamen ? 0x0c0c10 : isBeggarMarjohn ? 0xe5c29f : 0xfde2c4,
    roughness: isObsidianDamen ? 0.48 : 0.58,
  });
  const blackRobeMat = new THREE.MeshStandardMaterial({
    color: isSeraphJm
      ? 0xf1f5f9
      : isMonarchJm
      ? 0x0b0f19
      : isSadPrime
      ? 0x1f2430
      : isRoninMarjohn
      ? 0x0f2544
      : isBeggarMarjohn
      ? 0x57534e
      : isDuoKhen
      ? 0x1e293b
      : isPhantomKhen
      ? 0x130d24
      : 0x111827,
    roughness: isSeraphJm ? 0.36 : 0.68,
    metalness: isSeraphJm ? 0.18 : 0.05,
  });
  const goldTrimMat = new THREE.MeshStandardMaterial({
    color: isObsidianDamen ? 0xef4444 : isBeggarMarjohn ? 0x78716c : 0xfacc15,
    emissive: isObsidianDamen ? 0x991b1b : isBeggarMarjohn ? 0x1c1917 : 0xb45309,
    emissiveIntensity: isBeggarMarjohn ? 0.05 : 0.32,
    metalness: isBeggarMarjohn ? 0.25 : 0.82,
    roughness: isBeggarMarjohn ? 0.72 : 0.24,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: skinAccentHex,
    emissive: skinAccentHex,
    emissiveIntensity: isBeggarMarjohn ? 0.08 : skinId === 'ascended' ? 0.55 : 0.4,
    roughness: 0.32,
    metalness: 0.35,
  });
  const barkMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.85 });

  const hips = new THREE.Group();
  hips.position.y = 0.92;
  squashGroup.add(hips);

  const torso = new THREE.Group();
  hips.add(torso);

  let coatTail: THREE.Mesh | null = null;
  let idBadge: THREE.Mesh | null = null;
  let sashRibbons: THREE.Mesh[] | null = null;
  let wingL: THREE.Group | null = null;
  let wingR: THREE.Group | null = null;
  let roninWindRing: THREE.Mesh | null = null;
  let companionGroup: THREE.Group | null = null;
  let companionTail: THREE.Mesh | null = null;
  let teardrops: THREE.Mesh[] | null = null;

  if (id === 'damen') {
    const shirtMat = isObsidianDamen
      ? new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.55 })
      : isOutlawDamen
      ? new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.62 })
      : new THREE.MeshStandardMaterial({ map: createPlaidTexture(), roughness: 0.78 });
    const shirt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.235, 0.2, 0.58, 12),
      shirtMat
    );
    shirt.position.y = 0.29;
    shirt.castShadow = true;
    torso.add(shirt);

    const leatherMat = new THREE.MeshStandardMaterial({
      color: isObsidianDamen ? 0x111116 : isOutlawDamen ? 0x78350f : 0x5c3317,
      roughness: isObsidianDamen ? 0.45 : 0.68,
    });
    const coatBack = new THREE.Mesh(
      new THREE.CylinderGeometry(0.268, 0.26, 0.62, 12, 1, false, Math.PI * 0.22, Math.PI * 1.56),
      leatherMat
    );
    coatBack.position.y = 0.3;
    coatBack.castShadow = true;
    torso.add(coatBack);

    if (isOutlawDamen) {
      // High collar duster silhouette
      const highCollar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.26, 0.25, 0.16, 12, 1, true, Math.PI * 0.4, Math.PI * 1.2),
        goldTrimMat
      );
      highCollar.position.set(0, 0.6, -0.02);
      torso.add(highCollar);
    }

    if (isObsidianDamen) {
      // Streetwear silver chains across chest
      const chainMat = new THREE.MeshStandardMaterial({ color: 0xd4d4d8, metalness: 0.9, roughness: 0.2 });
      const chain1 = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.014, 6, 18, Math.PI), chainMat);
      chain1.position.set(0, 0.44, 0.15);
      chain1.rotation.z = Math.PI;
      torso.add(chain1);
    }

    [-0.12, 0.12].forEach((lx) => {
      const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.36, 0.045), leatherMat);
      lapel.position.set(lx, 0.38, 0.2);
      lapel.rotation.z = lx < 0 ? -0.18 : 0.18;
      torso.add(lapel);
    });
    const gunBelt = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.24, 0.08, 14), leatherMat);
    gunBelt.position.y = 0.03;
    torso.add(gunBelt);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.085, 0.05), goldTrimMat);
    buckle.position.set(0, 0.03, 0.225);
    torso.add(buckle);

    coatTail = new THREE.Mesh(new THREE.BoxGeometry(isOutlawDamen ? 0.54 : 0.46, isOutlawDamen ? 0.62 : 0.5, 0.06), leatherMat);
    coatTail.position.set(0, -0.19, -0.18);
    coatTail.rotation.x = 0.18;
    torso.add(coatTail);
  } else {
    const chestScale = isJuggernautPrime ? 1.24 : id === 'prime' ? 1.14 : isSadPrime ? 1.18 : 1.0;
    const robeChest = new THREE.Mesh(
      new THREE.CylinderGeometry(0.255 * chestScale, 0.21 * chestScale, 0.6, 12),
      blackRobeMat
    );
    robeChest.position.y = 0.3;
    robeChest.castShadow = true;
    torso.add(robeChest);

    if (isSadPrime) {
      // Oversized hoodie front pocket + white drawstrings
      const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.08), new THREE.MeshStandardMaterial({ color: 0x2b3242, roughness: 0.78 }));
      pocket.position.set(0, 0.15, 0.21);
      torso.add(pocket);
      const stringMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.5 });
      [-0.06, 0.06].forEach((dx) => {
        const ds = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.24, 6), stringMat);
        ds.position.set(dx, 0.43, 0.25);
        torso.add(ds);
      });
    } else if (isBeggarMarjohn) {
      // Stitched patches over tattered shirt
      const patchMatA = new THREE.MeshStandardMaterial({ color: 0x78716c, roughness: 0.92 });
      const patchMatB = new THREE.MeshStandardMaterial({ color: 0x3f6212, roughness: 0.9 });
      const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.11, 0.02), patchMatA);
      p1.position.set(-0.1, 0.36, 0.24);
      p1.rotation.z = 0.18;
      const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.02), patchMatB);
      p2.position.set(0.11, 0.2, 0.23);
      p2.rotation.z = -0.2;
      torso.add(p1, p2);
    } else if (isDuoKhen) {
      // Casual JM jacket + white tee front
      const tee = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.44, 0.08), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.55 }));
      tee.position.set(0, 0.34, 0.19);
      const jacketTrim = new THREE.Mesh(new THREE.CylinderGeometry(0.265, 0.225, 0.56, 12, 1, false, Math.PI * 0.25, Math.PI * 1.5), new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.48 }));
      jacketTrim.position.y = 0.3;
      torso.add(tee, jacketTrim);
    } else {
      // Sculpted chest plate / gi armor layer
      const chestPlateMat =
        id === 'prime'
          ? accentMat
          : isSeraphJm
          ? goldTrimMat
          : isMonarchJm
          ? new THREE.MeshStandardMaterial({ color: 0x1e1b2e, roughness: 0.38, metalness: 0.5 })
          : new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.45, metalness: 0.35 });
      const chestPlate = new THREE.Mesh(
        new THREE.BoxGeometry(0.36 * chestScale, 0.32, 0.12),
        chestPlateMat
      );
      chestPlate.position.set(0, 0.37, 0.16);
      chestPlate.castShadow = true;
      torso.add(chestPlate);

      if (isJuggernautPrime) {
        const coreReactor = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.08, 0),
          new THREE.MeshBasicMaterial({ color: 0xfef08a })
        );
        coreReactor.position.set(0, 0.37, 0.24);
        torso.add(coreReactor);
      }

      const trimCollar = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.024, 8, 20), goldTrimMat);
      trimCollar.rotation.x = Math.PI * 0.42;
      trimCollar.position.set(0, 0.56, 0.03);
      torso.add(trimCollar);
    }

    // Waist belt
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.232, 0.236, 0.085, 14), isBeggarMarjohn ? barkMat : accentMat);
    belt.position.y = 0.03;
    torso.add(belt);
    if (!isSadPrime && !isBeggarMarjohn) {
      const beltCore = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.05), goldTrimMat);
      beltCore.position.set(0, 0.03, 0.225);
      torso.add(beltCore);
    }

    if (!isSadPrime && !isBeggarMarjohn && !isDuoKhen) {
      const robeSkirt = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.31, 0.44, 14), blackRobeMat);
      robeSkirt.position.y = -0.16;
      robeSkirt.castShadow = true;
      hips.add(robeSkirt);

      const skirtGoldHem = new THREE.Mesh(new THREE.TorusGeometry(0.305, 0.018, 8, 24), goldTrimMat);
      skirtGoldHem.rotation.x = Math.PI * 0.5;
      skirtGoldHem.position.y = -0.37;
      hips.add(skirtGoldHem);
    }

    if (id === 'jm') {
      if (isSeraphJm) {
        // Celestial feathered energy wings mounted to torso back!
        const featherMat = new THREE.MeshBasicMaterial({
          color: 0xfef08a,
          transparent: true,
          opacity: 0.88,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        });
        const whiteWingMat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: 0xfde047,
          emissiveIntensity: 0.35,
          roughness: 0.25,
        });
        wingL = new THREE.Group();
        wingL.position.set(-0.14, 0.46, -0.2);
        wingR = new THREE.Group();
        wingR.position.set(0.14, 0.46, -0.2);
        for (let f = 0; f < 4; f++) {
          const fl = new THREE.Mesh(new THREE.BoxGeometry(0.55 - f * 0.08, 0.11, 0.025), f % 2 === 0 ? whiteWingMat : featherMat);
          fl.position.set(-0.28 - f * 0.04, 0.22 - f * 0.14, -0.05);
          fl.rotation.z = 0.48 - f * 0.24;
          wingL.add(fl);
          const fr = fl.clone();
          fr.position.x = -fl.position.x;
          fr.rotation.z = -fl.rotation.z;
          wingR.add(fr);
        }
        torso.add(wingL, wingR);
      } else if (isMonarchJm) {
        // Golden Monarch dark trench coat tail & popped collar + radiant gold ribbons
        const monarchCollar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.24, 0.23, 0.16, 12, 1, true, Math.PI * 0.35, Math.PI * 1.3),
          goldTrimMat
        );
        monarchCollar.position.set(0, 0.59, -0.02);
        torso.add(monarchCollar);
        coatTail = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.65, 0.05), blackRobeMat);
        coatTail.position.set(0, -0.2, -0.2);
        coatTail.rotation.x = 0.2;
        torso.add(coatTail);
      } else {
        // Classic JM lanyard + ID badge
        const innerCollar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.16, 0.17, 0.12, 12),
          new THREE.MeshStandardMaterial({ color: 0x7dd3fc, roughness: 0.5 })
        );
        innerCollar.position.set(0, 0.58, 0.02);
        torso.add(innerCollar);
        const lanyardMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.6, roughness: 0.3 });
        const strapL = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.34, 0.015), lanyardMat);
        strapL.position.set(-0.06, 0.41, 0.225);
        strapL.rotation.z = -0.22;
        const strapR = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.34, 0.015), lanyardMat);
        strapR.position.set(0.06, 0.41, 0.225);
        strapR.rotation.z = 0.22;
        torso.add(strapL, strapR);

        idBadge = new THREE.Mesh(
          new THREE.BoxGeometry(0.11, 0.16, 0.015),
          new THREE.MeshStandardMaterial({ map: createBadgeTexture(), roughness: 0.35 })
        );
        idBadge.position.set(0, 0.21, 0.245);
        torso.add(idBadge);
      }

      const ribbonL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.65, 0.015), goldTrimMat);
      ribbonL.position.set(-0.14, -0.32, -0.22);
      const ribbonR = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.65, 0.015), goldTrimMat);
      ribbonR.position.set(0.14, -0.32, -0.22);
      torso.add(ribbonL, ribbonR);
      sashRibbons = [ribbonL, ribbonR];
    } else if (id === 'marjohn') {
      if (isRoninMarjohn) {
        const scarfL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.85, 0.02), accentMat);
        scarfL.position.set(-0.14, -0.22, -0.24);
        const scarfR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.85, 0.02), accentMat);
        scarfR.position.set(0.14, -0.22, -0.24);
        torso.add(scarfL, scarfR);
        sashRibbons = [scarfL, scarfR];

        roninWindRing = new THREE.Mesh(
          new THREE.TorusGeometry(0.58, 0.022, 8, 28, Math.PI * 1.55),
          new THREE.MeshBasicMaterial({
            color: 0x38bdf8,
            transparent: true,
            opacity: 0.82,
            blending: THREE.AdditiveBlending,
          })
        );
        roninWindRing.position.set(0, 0.34, 0);
        roninWindRing.rotation.x = Math.PI * 0.42;
        torso.add(roninWindRing);
      } else if (!isBeggarMarjohn) {
        const scarfL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.58, 0.016), accentMat);
        scarfL.position.set(-0.11, -0.26, -0.22);
        const scarfR = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.58, 0.016), accentMat);
        scarfR.position.set(0.11, -0.26, -0.22);
        torso.add(scarfL, scarfR);
        sashRibbons = [scarfL, scarfR];
      }
    } else if (id === 'khen') {
      if (isPhantomKhen) {
        // Jagged void shoulder mantle
        const mantle = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.32, 6, 1, true), blackRobeMat);
        mantle.position.set(0, 0.48, 0);
        torso.add(mantle);
      }
      if (!isDuoKhen) {
        const scarfL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.58, 0.016), accentMat);
        scarfL.position.set(-0.11, -0.26, -0.22);
        const scarfR = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.58, 0.016), accentMat);
        scarfR.position.set(0.11, -0.26, -0.22);
        torso.add(scarfL, scarfR);
        sashRibbons = [scarfL, scarfR];
      }
    }
  }

  // Head & Multi-Layered Sculpted Anime Hair
  const head = new THREE.Group();
  head.position.y = 0.78;
  torso.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 14), skinMat);
  skull.castShadow = true;
  head.add(skull);

  if (isSadPrime || isPhantomKhen) {
    // Hood pulled up cleanly framing face
    const hoodMat = isSadPrime
      ? new THREE.MeshStandardMaterial({ color: 0x1f2430, roughness: 0.78, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({ color: 0x1e1b4b, roughness: 0.55, side: THREE.DoubleSide });
    const hood = new THREE.Mesh(
      new THREE.SphereGeometry(0.285, 14, 12, Math.PI * 0.15, Math.PI * 1.7, 0, Math.PI * 0.72),
      hoodMat
    );
    hood.rotation.x = -0.18;
    hood.position.set(0, 0.02, -0.02);
    head.add(hood);
  }

  const hairColor =
    isSeraphJm
      ? 0xfef9c3
      : isMonarchJm
      ? 0x090d16
      : isSadPrime
      ? 0x090d16
      : isObsidianDamen
      ? 0x050507
      : id === 'prime'
      ? 0x1f1218
      : id === 'khen'
      ? 0x1e1b4b
      : id === 'damen'
      ? 0x291d12
      : 0x0f172a;
  const hairMat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.5 });
  const hairCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.256, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.64),
    hairMat
  );
  hairCap.rotation.x = -0.24;
  head.add(hairCap);

  const hairTufts: THREE.Mesh[] = [];
  for (let h = 0; h < 11; h++) {
    const isOuter = h >= 7;
    const spike = new THREE.Mesh(
      new THREE.ConeGeometry(isOuter ? 0.058 : 0.076, isOuter ? 0.29 : 0.25, 6),
      h % 3 === 1 && !isSadPrime && !isBeggarMarjohn ? accentMat : hairMat
    );
    const ang = (h / 11) * Math.PI * 2;
    const r = isOuter ? 0.19 : 0.16;
    spike.position.set(Math.cos(ang) * r, isOuter ? 0.14 : 0.18, Math.sin(ang) * r);
    spike.rotation.z = -Math.cos(ang) * (isOuter ? 0.85 : 0.62);
    spike.rotation.x = Math.sin(ang) * (isOuter ? 0.85 : 0.62);
    spike.userData = { baseRx: spike.rotation.x, baseRz: spike.rotation.z, idx: h };
    head.add(spike);
    hairTufts.push(spike);
  }
  [-0.08, 0, 0.08].forEach((bx, bi) => {
    const isEmoSweep = (isSadPrime || isObsidianDamen) && bi === 0;
    const bang = new THREE.Mesh(
      new THREE.ConeGeometry(isEmoSweep ? 0.085 : 0.052, isEmoSweep ? 0.28 : 0.18, 5),
      bi === 1 && !isSadPrime && !isObsidianDamen && !isBeggarMarjohn ? accentMat : hairMat
    );
    bang.position.set(isEmoSweep ? -0.075 : bx, isEmoSweep ? 0.11 : 0.14, 0.22);
    bang.rotation.x = isEmoSweep ? 2.65 : 2.45;
    bang.rotation.z = isEmoSweep ? -0.35 : bx * 1.4;
    bang.userData = { baseRx: bang.rotation.x, baseRz: bang.rotation.z, idx: bi + 12 };
    head.add(bang);
    hairTufts.push(bang);
  });

  const eyeIrisHex = isObsidianDamen
    ? '#ef4444'
    : isSadPrime
    ? '#60a5fa'
    : isMonarchJm
    ? '#fde047'
    : skinMeta.accentColor;
  const eyeTex = createAnimeEyeTexture(eyeIrisHex);
  const eyeMat = new THREE.MeshBasicMaterial({ map: eyeTex, transparent: true });
  const eyeL = new THREE.Mesh(new THREE.PlaneGeometry(0.085, 0.085), eyeMat);
  eyeL.position.set(-0.082, 0.01, 0.232);
  eyeL.rotation.y = -0.22;
  const eyeR = new THREE.Mesh(new THREE.PlaneGeometry(0.085, 0.085), eyeMat);
  eyeR.position.set(0.082, 0.01, 0.232);
  eyeR.rotation.y = 0.22;
  head.add(eyeL, eyeR);

  if (isObsidianDamen || isMonarchJm) {
    // Bright glowing eye accents
    const glowMat = new THREE.MeshBasicMaterial({
      color: isObsidianDamen ? 0xef4444 : 0xfef08a,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
    });
    const egL = new THREE.Mesh(new THREE.CircleGeometry(0.036, 12), glowMat);
    egL.position.set(-0.082, 0.01, 0.242);
    const egR = new THREE.Mesh(new THREE.CircleGeometry(0.036, 12), glowMat);
    egR.position.set(0.082, 0.01, 0.242);
    head.add(egL, egR);
  }

  if (isSadPrime) {
    // Falling animated teardrop particles under eyes!
    teardrops = [];
    const tearMat = new THREE.MeshBasicMaterial({
      color: 0x60a5fa,
      transparent: true,
      opacity: 0.9,
    });
    for (let td = 0; td < 4; td++) {
      const drop = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), tearMat);
      drop.scale.set(0.8, 1.4, 0.8);
      drop.position.set(td % 2 === 0 ? -0.08 : 0.08, -0.03 - td * 0.05, 0.245);
      drop.userData = { side: td % 2 === 0 ? -0.08 : 0.08, phase: td * 0.45 };
      head.add(drop);
      teardrops.push(drop);
    }
  }

  let cowboyHat: THREE.Group | null = null;
  if (id === 'damen') {
    cowboyHat = new THREE.Group();
    cowboyHat.position.set(0, 0.22, 0);
    const hatColor = isObsidianDamen ? 0x050507 : isOutlawDamen ? 0x291508 : 0x111827;
    const hatBlack = new THREE.MeshStandardMaterial({ color: hatColor, roughness: 0.72 });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(isOutlawDamen ? 0.5 : 0.46, isOutlawDamen ? 0.52 : 0.48, 0.025, 22), hatBlack);
    brim.scale.set(1.0, 1.0, 1.15);
    brim.castShadow = true;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.22, 0.2, 16), hatBlack);
    crown.position.y = 0.1;
    crown.castShadow = true;
    const hatBand = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.032, 16), goldTrimMat);
    hatBand.position.y = 0.025;
    cowboyHat.add(brim, crown, hatBand);
    head.add(cowboyHat);
  }

  let glassesGlint: THREE.Group | null = null;
  if (id === 'khen' && !isDuoKhen) {
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.3 });
    const lensMat = new THREE.MeshStandardMaterial({
      color: isPhantomKhen ? 0xf0abfc : 0xe9d5ff,
      emissive: isPhantomKhen ? 0xc026d3 : 0xa855f7,
      emissiveIntensity: isPhantomKhen ? 0.95 : 0.28,
      transparent: true,
      opacity: isPhantomKhen ? 0.88 : 0.58,
    });
    if (isPhantomKhen) {
      // Sleek cyber-void visor across eyes
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.075, 0.06), lensMat);
      visor.position.set(0, 0.015, 0.24);
      head.add(visor);
    } else {
      [-0.084, 0.084].forEach((gx) => {
        const rim = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.065, 0.015), frameMat);
        rim.position.set(gx, 0.015, 0.246);
        const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.092, 0.048), lensMat);
        lens.position.set(gx, 0.015, 0.255);
        head.add(rim, lens);
      });
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.014, 0.015), frameMat);
      bridge.position.set(0, 0.022, 0.248);
      head.add(bridge);
    }

    glassesGlint = new THREE.Group();
    glassesGlint.position.set(0.085, 0.02, 0.265);
    glassesGlint.visible = false;
    const glintMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
    });
    glassesGlint.add(
      new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.035), glintMat),
      new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.5), glintMat)
    );
    head.add(glassesGlint);
  }

  function createLimb(isArm: boolean, side: number) {
    const rootPivot = new THREE.Group();
    const upperLen = isArm ? 0.27 : 0.4;
    const lowerLen = isArm ? 0.26 : 0.39;
    const limbBulk = isJuggernautPrime ? 1.16 : 1.0;
    const radTop = (isArm ? 0.074 : 0.105) * limbBulk;
    const radMid = (isArm ? 0.065 : 0.088) * limbBulk;
    const radBot = (isArm ? 0.056 : 0.076) * limbBulk;

    let limbMat = blackRobeMat;
    if (isBeggarMarjohn || (isRoninMarjohn && isArm)) {
      limbMat = skinMat;
    } else if (!isArm && id === 'damen') {
      limbMat = new THREE.MeshStandardMaterial({
        color: isObsidianDamen ? 0x09090b : 0x1d4ed8,
        roughness: 0.75,
      });
    } else if (isArm && id === 'damen') {
      limbMat = new THREE.MeshStandardMaterial({
        color: isObsidianDamen ? 0x111116 : isOutlawDamen ? 0x78350f : 0x5c3317,
        roughness: 0.68,
      });
    } else if (!isArm && isDuoKhen) {
      limbMat = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.7 });
    }

    const upperMesh = new THREE.Mesh(new THREE.CylinderGeometry(radTop, radMid, upperLen, 10), limbMat);
    upperMesh.position.y = -upperLen * 0.5;
    upperMesh.castShadow = true;
    rootPivot.add(upperMesh);

    if (isArm && !isSadPrime && !isBeggarMarjohn && !isDuoKhen) {
      const pauldron = new THREE.Mesh(
        new THREE.BoxGeometry(id === 'prime' ? 0.22 : 0.16, 0.11, id === 'prime' ? 0.24 : 0.17),
        id === 'damen'
          ? new THREE.MeshStandardMaterial({ color: isObsidianDamen ? 0x18181b : 0x78350f, roughness: 0.6 })
          : accentMat
      );
      pauldron.position.set(side * 0.03, -0.02, 0);
      pauldron.rotation.z = side * -0.22;
      pauldron.castShadow = true;
      rootPivot.add(pauldron);
      if (isJuggernautPrime) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.18, 6), goldTrimMat);
        spike.position.set(side * 0.08, 0.07, 0);
        spike.rotation.z = side * -0.45;
        rootPivot.add(spike);
      }
    }

    if (!isBeggarMarjohn) {
      const jointGuard = new THREE.Mesh(
        new THREE.BoxGeometry(radMid * 2.15, radMid * 1.45, radMid * 2.2),
        id === 'damen' ? goldTrimMat : accentMat
      );
      jointGuard.position.set(0, -upperLen, isArm ? -0.02 : 0.03);
      rootPivot.add(jointGuard);
    }

    const midPivot = new THREE.Group();
    midPivot.position.y = -upperLen;
    rootPivot.add(midPivot);

    const lowerMesh = new THREE.Mesh(new THREE.CylinderGeometry(radMid, radBot, lowerLen, 10), limbMat);
    lowerMesh.position.y = -lowerLen * 0.5;
    lowerMesh.castShadow = true;
    midPivot.add(lowerMesh);

    if (!isArm && id === 'damen') {
      const chapMat = new THREE.MeshStandardMaterial({
        color: isObsidianDamen ? 0x18181b : 0x78350f,
        roughness: 0.72,
      });
      const chapUpper = new THREE.Mesh(new THREE.BoxGeometry(0.045, upperLen * 0.9, 0.11), chapMat);
      chapUpper.position.set(side * 0.088, -upperLen * 0.5, 0);
      rootPivot.add(chapUpper);
      const chapLower = new THREE.Mesh(new THREE.BoxGeometry(0.045, lowerLen * 0.9, 0.1), chapMat);
      chapLower.position.set(side * 0.082, -lowerLen * 0.5, 0);
      midPivot.add(chapLower);
    }

    const endMount = new THREE.Group();
    endMount.position.y = -lowerLen;
    midPivot.add(endMount);

    if (isArm) {
      if (id === 'prime' && !isSadPrime) {
        const gauntletSize = isJuggernautPrime ? 0.21 : 0.17;
        const gauntlet = new THREE.Mesh(
          new THREE.BoxGeometry(gauntletSize, gauntletSize * 1.25, gauntletSize * 1.05),
          accentMat
        );
        gauntlet.position.y = 0.02;
        gauntlet.castShadow = true;
        endMount.add(gauntlet);
      } else {
        if (!isBeggarMarjohn && !isSadPrime) {
          const bracer = new THREE.Mesh(new THREE.CylinderGeometry(radBot * 1.28, radBot * 1.18, 0.12, 8), accentMat);
          bracer.position.y = 0.07;
          endMount.add(bracer);
        }
        endMount.add(new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 10), skinMat));
      }
    } else if (id === 'jm' || isDuoKhen) {
      const sneaker = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.11, 0.28),
        new THREE.MeshStandardMaterial({ color: isMonarchJm ? 0x090d16 : 0xffffff, roughness: 0.35 })
      );
      sneaker.position.set(0, -0.04, 0.05);
      sneaker.castShadow = true;
      const soleTrim = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.03, 0.29), goldTrimMat);
      soleTrim.position.set(0, -0.09, 0.05);
      endMount.add(sneaker, soleTrim);
    } else if (id === 'prime' && !isSadPrime) {
      const greave = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.26, 0.26), accentMat);
      greave.position.set(0, 0.04, 0.03);
      greave.castShadow = true;
      endMount.add(greave);
    } else if (isBeggarMarjohn) {
      // Simple sandals
      const sandal = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.24), barkMat);
      sandal.position.set(0, -0.06, 0.04);
      endMount.add(sandal);
    } else {
      const boot = new THREE.Mesh(
        new THREE.BoxGeometry(0.155, 0.16, 0.27),
        new THREE.MeshStandardMaterial({ color: id === 'damen' && !isObsidianDamen ? 0x451a03 : 0x090d16, roughness: 0.55 })
      );
      boot.position.set(0, -0.03, 0.04);
      boot.castShadow = true;
      const bootTrim = new THREE.Mesh(new THREE.BoxGeometry(0.165, 0.035, 0.16), accentMat);
      bootTrim.position.set(0, 0.04, 0);
      endMount.add(boot, bootTrim);
    }

    return { rootPivot, midPivot, endMount };
  }

  const armLObj = createLimb(true, -1);
  armLObj.rootPivot.position.set(-0.31, 0.52, 0);
  torso.add(armLObj.rootPivot);

  const armRObj = createLimb(true, 1);
  armRObj.rootPivot.position.set(0.31, 0.52, 0);
  torso.add(armRObj.rootPivot);

  const legLObj = createLimb(false, -1);
  legLObj.rootPivot.position.set(-0.13, -0.04, 0);
  hips.add(legLObj.rootPivot);

  const legRObj = createLimb(false, 1);
  legRObj.rootPivot.position.set(0.13, -0.04, 0);
  hips.add(legRObj.rootPivot);

  let staffGroup: THREE.Group | null = null;
  if (id === 'marjohn') {
    if (isBeggarMarjohn) {
      // Tin begging cup in left hand + humble wooden walking cane
      const tinMat = new THREE.MeshStandardMaterial({ color: 0xa3a3a3, metalness: 0.78, roughness: 0.35 });
      const tinCup = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.068, 0.14, 12, 1, false), tinMat);
      tinCup.position.set(0, -0.02, 0.1);
      armLObj.endMount.add(tinCup);
    }
    staffGroup = new THREE.Group();
    armRObj.endMount.add(staffGroup);
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, isBeggarMarjohn ? 1.65 : 2.25, 10),
      new THREE.MeshStandardMaterial({ color: isBeggarMarjohn ? 0x78350f : 0x0f172a, metalness: isBeggarMarjohn ? 0.1 : 0.65, roughness: 0.38 })
    );
    shaft.rotation.x = Math.PI * 0.5;
    staffGroup.add(shaft);

    if (!isBeggarMarjohn) {
      const tipColor = isRoninMarjohn ? 0x38bdf8 : 0x2dd4bf;
      const tealTipMat = new THREE.MeshStandardMaterial({
        color: tipColor,
        emissive: tipColor,
        emissiveIntensity: isRoninMarjohn ? 0.95 : 0.65,
        roughness: 0.25,
        metalness: 0.35,
      });
      const cap1 = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.035, 0.18, 10), tealTipMat);
      cap1.rotation.x = Math.PI * 0.5;
      cap1.position.z = 1.12;
      const cap2 = cap1.clone();
      cap2.position.z = -1.12;
      staffGroup.add(cap1, cap2);

      const windRibbonMat = new THREE.MeshBasicMaterial({
        color: tipColor,
        transparent: true,
        opacity: 0.82,
        side: THREE.DoubleSide,
      });
      const ribbon1 = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.85), windRibbonMat);
      ribbon1.position.set(0, -0.42, 1.08);
      const ribbon2 = ribbon1.clone();
      ribbon2.position.set(0, -0.42, -1.08);
      staffGroup.add(ribbon1, ribbon2);
    }
  } else if (id === 'damen') {
    [armLObj.endMount, armRObj.endMount].forEach((mount) => {
      const rev = new THREE.Group();
      const barrelMat = isObsidianDamen
        ? new THREE.MeshStandardMaterial({ color: 0x18181b, metalness: 0.85, roughness: 0.25 })
        : goldTrimMat;
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.065, 0.3), barrelMat);
      barrel.position.set(0, -0.02, 0.15);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.13, 0.06), barkMat);
      grip.position.set(0, -0.07, 0.02);
      grip.rotation.x = 0.25;
      rev.add(barrel, grip);
      if (isObsidianDamen) {
        const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.04), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
        sight.position.set(0, 0.02, 0.27);
        rev.add(sight);
      }
      mount.add(rev);
    });
  } else if (id === 'khen') {
    [armLObj.endMount, armRObj.endMount].forEach((mount) => {
      const dag = new THREE.Group();
      const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 8), goldTrimMat);
      hilt.rotation.x = Math.PI * 0.5;
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.025, 0.025), goldTrimMat);
      guard.position.z = 0.08;
      const blade = new THREE.Mesh(
        new THREE.ConeGeometry(isPhantomKhen ? 0.045 : 0.036, isPhantomKhen ? 0.52 : 0.44, 4),
        accentMat
      );
      blade.rotation.x = Math.PI * 0.5;
      blade.position.z = isPhantomKhen ? 0.34 : 0.3;
      dag.add(hilt, guard, blade);
      mount.add(dag);
    });
  }

  // Khen "JM & Khen Duo" Special Skin: Companion Human-Dog Khen alongside casual JM!
  if (isDuoKhen) {
    // Mini JM label over main character
    const jmTag = createMiniNameSprite('JM', 'rgba(15, 23, 42, 0.88)', '#38bdf8');
    jmTag.position.set(0, 1.98, 0);
    squashGroup.add(jmTag);

    companionGroup = new THREE.Group();
    companionGroup.position.set(-0.92, 0, -0.25);
    squashGroup.add(companionGroup);

    const furMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.72 });
    const bellyMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.75 });
    const dogCollarMat = new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0x7e22ce, emissiveIntensity: 0.4, roughness: 0.4 });

    const dogBody = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.14, 0.42, 10), furMat);
    dogBody.position.y = 0.52;
    dogBody.castShadow = true;
    const dogBelly = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.3, 0.09), bellyMat);
    dogBelly.position.set(0, 0.5, 0.12);
    const dogCollar = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 6, 16), dogCollarMat);
    dogCollar.rotation.x = Math.PI * 0.5;
    dogCollar.position.y = 0.73;

    const dogHead = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), furMat);
    dogHead.position.y = 0.92;
    dogHead.castShadow = true;
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.12), bellyMat);
    snout.position.set(0, 0.88, 0.17);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 8), new THREE.MeshStandardMaterial({ color: 0x090d16 }));
    nose.position.set(0, 0.9, 0.235);

    const earL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.08), barkMat);
    earL.position.set(-0.18, 0.9, 0.02);
    earL.rotation.z = 0.22;
    const earR = earL.clone();
    earR.position.x = 0.18;
    earR.rotation.z = -0.22;

    const dogEyeL = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), new THREE.MeshBasicMaterial({ color: 0x090d16 }));
    dogEyeL.position.set(-0.07, 0.95, 0.16);
    const dogEyeR = dogEyeL.clone();
    dogEyeR.position.x = 0.07;

    [-0.08, 0.08].forEach((lx) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.34, 8), furMat);
      leg.position.set(lx, 0.17, 0);
      leg.castShadow = true;
      companionGroup!.add(leg);
    });
    companionTail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.26, 8), furMat);
    companionTail.position.set(0, 0.44, -0.18);
    companionTail.rotation.x = -0.7;

    const khenTag = createMiniNameSprite('KHEN', 'rgba(88, 28, 135, 0.9)', '#e879f9');
    khenTag.position.set(0, 1.32, 0);

    companionGroup.add(
      dogBody,
      dogBelly,
      dogCollar,
      dogHead,
      snout,
      nose,
      earL,
      earR,
      dogEyeL,
      dogEyeR,
      companionTail,
      khenTag
    );
  }

  // Ground Hero / Aura Ring (Pinned flat to ground floor so leaning/walking never clips!)
  const auraRing = new THREE.Mesh(
    new THREE.RingGeometry(isLocalPlayer ? 0.64 : 0.45, isLocalPlayer ? 1.06 : 0.88, 36),
    new THREE.MeshBasicMaterial({
      color: skinAccentHex,
      transparent: true,
      opacity: isLocalPlayer ? 0.88 : 0.46,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    })
  );
  auraRing.rotation.x = -Math.PI * 0.5;
  auraRing.position.y = 0.09;
  auraRing.renderOrder = 8;
  root.add(auraRing);

  let heroInnerRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | null = null;
  if (isLocalPlayer) {
    heroInnerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.54, 36),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -5,
        polygonOffsetUnits: -5,
      })
    );
    heroInnerRing.rotation.x = -Math.PI * 0.5;
    heroInnerRing.position.y = 0.102;
    heroInnerRing.renderOrder = 9;
    root.add(heroInnerRing);
  }

  let crownHalo: THREE.Group | null = null;
  if (id === 'jm') {
    crownHalo = new THREE.Group();
    crownHalo.position.set(0, 1.95, -0.18);
    crownHalo.visible = isSeraphJm;
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    crownHalo.add(
      new THREE.Mesh(new THREE.RingGeometry(0.65, 0.76, 36), haloMat),
      new THREE.Mesh(new THREE.RingGeometry(0.42, 0.47, 28), haloMat)
    );
    for (let sp = 0; sp < 8; sp++) {
      const ray = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.48), haloMat);
      const a = (sp / 8) * Math.PI * 2;
      ray.position.set(Math.cos(a) * 0.92, Math.sin(a) * 0.92, 0);
      ray.rotation.z = a - Math.PI * 0.5;
      crownHalo.add(ray);
    }
    leanPivot.add(crownHalo);
  }

  // Inverted-hull colored silhouette outline for local player (must happen BEFORE adding outlineMat to bodyMaterials)
  let outlineMaterial: THREE.MeshBasicMaterial | null = null;
  if (isLocalPlayer) {
    outlineMaterial = new THREE.MeshBasicMaterial({
      color: skinAccentHex,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    const sourceMeshes: THREE.Mesh[] = [];
    squashGroup.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (
        m.isMesh &&
        m.geometry &&
        !(m.material instanceof THREE.MeshBasicMaterial) &&
        !(m instanceof THREE.Sprite)
      ) {
        sourceMeshes.push(m);
      }
    });
    for (const src of sourceMeshes) {
      const outlineMesh = new THREE.Mesh(src.geometry, outlineMaterial);
      outlineMesh.scale.setScalar(1.075);
      outlineMesh.castShadow = false;
      outlineMesh.receiveShadow = false;
      src.add(outlineMesh);
    }
  }

  const bodyMaterials: THREE.Material[] = [];
  const standardMaterials: Array<{
    mat: THREE.MeshStandardMaterial;
    baseEmissive: number;
    baseIntensity: number;
  }> = [];
  const seenStd = new Set<THREE.MeshStandardMaterial>();
  root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (
      m.isMesh &&
      m.material &&
      m !== auraRing &&
      m !== heroInnerRing &&
      m !== contactShadow &&
      m.material !== outlineMaterial
    ) {
      const mat = m.material as THREE.Material;
      if (!bodyMaterials.includes(mat)) {
        mat.transparent = true;
        bodyMaterials.push(mat);
      }
      if (mat instanceof THREE.MeshStandardMaterial && !seenStd.has(mat)) {
        seenStd.add(mat);
        standardMaterials.push({
          mat,
          baseEmissive: mat.emissive.getHex(),
          baseIntensity: mat.emissiveIntensity,
        });
      }
    }
  });

  // Golden shield dome for Guard/Parry & Damen shield-shatter KO
  const goldenShield = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.15, 1),
    new THREE.MeshBasicMaterial({
      color: cfg.hex,
      transparent: true,
      opacity: 0,
      wireframe: true,
      blending: THREE.AdditiveBlending,
    })
  );
  goldenShield.position.y = 1.05;
  goldenShield.visible = false;
  leanPivot.add(goldenShield);

  let shieldShards: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number }> | null = null;
  if (id === 'damen') {
    shieldShards = [];
    for (let sh = 0; sh < 18; sh++) {
      const frag = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.15 + (sh % 3) * 0.05, 0),
        new THREE.MeshBasicMaterial({
          color: sh % 2 === 0 ? 0xfacc15 : 0xfef08a,
          transparent: true,
          opacity: 0.92,
          blending: THREE.AdditiveBlending,
        })
      );
      frag.visible = false;
      scene.add(frag);
      const phi = Math.acos(1 - 2 * ((sh + 0.5) / 18));
      const theta = Math.PI * (1 + Math.sqrt(5)) * sh;
      shieldShards.push({
        mesh: frag,
        vx: Math.sin(phi) * Math.cos(theta) * (4.0 + (sh % 3) * 1.4),
        vy: Math.abs(Math.cos(phi)) * 4.5 + 1.8,
        vz: Math.sin(phi) * Math.sin(theta) * (4.0 + (sh % 3) * 1.4),
      });
    }
  }

  let dissolveCloud: THREE.Points | null = null;
  if (id === 'khen') {
    const dGeo = new THREE.BufferGeometry();
    const dCount = 72;
    const dPos = new Float32Array(dCount * 3);
    const dSeeds = [];
    for (let i = 0; i < dCount; i++) {
      const ang = (i / dCount) * Math.PI * 6;
      const r = 0.15 + (i % 7) * 0.06;
      const sy = (i / dCount) * 1.85;
      dSeeds.push({
        x: Math.cos(ang) * r,
        y: sy,
        z: Math.sin(ang) * r,
        speed: 1.4 + (i % 5) * 0.45,
        drift: Math.cos(ang) * 0.65,
      });
    }
    dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
    dissolveCloud = new THREE.Points(
      dGeo,
      new THREE.PointsMaterial({
        color: 0xc084fc,
        size: 0.19,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
      })
    );
    dissolveCloud.userData = { seeds: dSeeds };
    dissolveCloud.visible = false;
    scene.add(dissolveCloud);
  }

  // Character-Specific Passive Rig Visuals
  let tailwindRibbons: THREE.Mesh[] | null = null;
  let tailwindExtraRibbons: THREE.Mesh[] | null = null;
  if (id === 'marjohn') {
    tailwindRibbons = [];
    tailwindExtraRibbons = [];
    const mounts: Array<{ parent: THREE.Object3D; y: number; r: number }> = [
      { parent: armLObj.midPivot, y: -0.14, r: 0.11 },
      { parent: armRObj.midPivot, y: -0.14, r: 0.11 },
      { parent: legLObj.midPivot, y: -0.18, r: 0.13 },
      { parent: legRObj.midPivot, y: -0.18, r: 0.13 },
      { parent: torso, y: 0.28, r: 0.34 },
    ];
    mounts.forEach((m) => {
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(m.r, 0.018, 6, 18, Math.PI * 1.45),
        new THREE.MeshBasicMaterial({
          color: 0x2dd4bf,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        })
      );
      band.position.y = m.y;
      band.rotation.x = Math.PI * 0.42;
      band.visible = false;
      m.parent.add(band);
      tailwindRibbons!.push(band);

      const extraBand = new THREE.Mesh(
        new THREE.TorusGeometry(m.r * 1.32, 0.015, 6, 18, Math.PI * 1.6),
        new THREE.MeshBasicMaterial({
          color: 0x99f6e4,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        })
      );
      extraBand.position.y = m.y + 0.04;
      extraBand.rotation.x = -Math.PI * 0.38;
      extraBand.visible = false;
      m.parent.add(extraBand);
      tailwindExtraRibbons!.push(extraBand);
    });
  }

  let magmaVeins: THREE.Mesh[] | null = null;
  let frenzyFlameShell: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null = null;
  if (id === 'prime') {
    magmaVeins = [];
    const veinSpecs: Array<{ parent: THREE.Object3D; w: number; h: number; d: number; pos: [number, number, number]; rz: number }> = [
      { parent: torso, w: 0.03, h: 0.42, d: 0.03, pos: [-0.1, 0.3, 0.23], rz: 0.28 },
      { parent: torso, w: 0.03, h: 0.42, d: 0.03, pos: [0.1, 0.3, 0.23], rz: -0.28 },
      { parent: torso, w: 0.36, h: 0.03, d: 0.03, pos: [0, 0.36, -0.22], rz: 0.14 },
      { parent: armLObj.endMount, w: 0.17, h: 0.032, d: 0.18, pos: [0, 0.04, 0], rz: 0 },
      { parent: armRObj.endMount, w: 0.17, h: 0.032, d: 0.18, pos: [0, 0.04, 0], rz: 0 },
    ];
    veinSpecs.forEach((vs) => {
      const vein = new THREE.Mesh(
        new THREE.BoxGeometry(vs.w, vs.h, vs.d),
        new THREE.MeshBasicMaterial({
          color: 0xfb923c,
          transparent: true,
          opacity: 0.1,
          blending: THREE.AdditiveBlending,
        })
      );
      vein.position.set(vs.pos[0], vs.pos[1], vs.pos[2]);
      vein.rotation.z = vs.rz;
      vs.parent.add(vein);
      magmaVeins!.push(vein);
    });

    frenzyFlameShell = new THREE.Mesh(
      new THREE.SphereGeometry(0.95, 14, 12),
      new THREE.MeshBasicMaterial({
        color: 0xf97316,
        transparent: true,
        opacity: 0,
        wireframe: true,
        blending: THREE.AdditiveBlending,
      })
    );
    frenzyFlameShell.position.y = 1.05;
    frenzyFlameShell.visible = false;
    leanPivot.add(frenzyFlameShell);
  }

  let deadeyeRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | null = null;
  if (id === 'damen') {
    deadeyeRing = new THREE.Mesh(
      new THREE.RingGeometry(4.88, 5.02, 48),
      new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    );
    deadeyeRing.rotation.x = -Math.PI * 0.5;
    deadeyeRing.position.y = 0.056;
    deadeyeRing.renderOrder = 5;
    root.add(deadeyeRing);
  }

  let voidWisps: THREE.Mesh[] | null = null;
  if (id === 'khen') {
    voidWisps = [];
    for (let w = 0; w < 4; w++) {
      const wisp = new THREE.Mesh(
        new THREE.PlaneGeometry(0.14, 0.55),
        new THREE.MeshBasicMaterial({
          color: w % 2 === 0 ? 0xa855f7 : 0x581c87,
          transparent: true,
          opacity: 0.45,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        })
      );
      const a = (w / 4) * Math.PI * 2;
      wisp.position.set(Math.cos(a) * 0.42, 0.9, Math.sin(a) * 0.42);
      root.add(wisp);
      voidWisps.push(wisp);
    }
  }

  let jmHandGlows: THREE.Mesh[] | null = null;
  if (id === 'jm') {
    jmHandGlows = [armLObj.endMount, armRObj.endMount].map((mount) => {
      const g = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 10, 10),
        new THREE.MeshBasicMaterial({
          color: 0xfef9c3,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
        })
      );
      g.visible = false;
      mount.add(g);
      return g;
    });
  }

  // Awakening Signature 3D Silhouettes & Orbiters (hidden until actor.awakened === true)
  const awakenedParts: THREE.Object3D[] = [];
  const awakenedOrbiters: THREE.Object3D[] = [];
  const awkHex =
    id === 'marjohn'
      ? 0x22d3ee
      : id === 'prime'
      ? 0xf43f5e
      : id === 'damen'
      ? 0xfacc15
      : id === 'khen'
      ? 0xa855f7
      : 0xfef08a;
  const awkSecHex =
    id === 'marjohn'
      ? 0x99f6e4
      : id === 'prime'
      ? 0xfef08a
      : id === 'damen'
      ? 0xffffff
      : id === 'khen'
      ? 0xf43f5e
      : 0x38bdf8;

  const awakenedHalo = new THREE.Mesh(
    new THREE.RingGeometry(0.95, 1.18, 40),
    new THREE.MeshBasicMaterial({
      color: awkHex,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  awakenedHalo.rotation.x = -Math.PI * 0.5;
  awakenedHalo.position.y = 0.14;
  awakenedHalo.visible = false;
  root.add(awakenedHalo);
  awakenedParts.push(awakenedHalo);

  if (id === 'marjohn') {
    const orbRing = new THREE.Group();
    orbRing.position.y = 1.05;
    orbRing.visible = false;
    const cycloneHalo = new THREE.Mesh(
      new THREE.TorusGeometry(0.92, 0.032, 8, 32),
      new THREE.MeshBasicMaterial({
        color: awkHex,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    cycloneHalo.rotation.x = Math.PI * 0.44;
    orbRing.add(cycloneHalo);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const miniFunnel = new THREE.Mesh(
        new THREE.ConeGeometry(0.18, 0.56, 10, 1, true),
        new THREE.MeshBasicMaterial({
          color: i % 2 === 0 ? awkHex : awkSecHex,
          transparent: true,
          opacity: 0.82,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      miniFunnel.rotation.x = Math.PI;
      miniFunnel.position.set(Math.cos(a) * 0.92, (i - 1) * 0.16, Math.sin(a) * 0.92);
      orbRing.add(miniFunnel);
    }
    leanPivot.add(orbRing);
    awakenedParts.push(orbRing);
    awakenedOrbiters.push(orbRing);

    if (staffGroup) {
      const halberdTip = new THREE.Mesh(
        new THREE.ConeGeometry(0.11, 0.55, 6),
        new THREE.MeshBasicMaterial({
          color: 0x5eead4,
          transparent: true,
          opacity: 0.92,
          blending: THREE.AdditiveBlending,
        })
      );
      halberdTip.position.set(0, 1.15, 0);
      halberdTip.visible = false;
      staffGroup.add(halberdTip);
      awakenedParts.push(halberdTip);
    }
  } else if (id === 'prime') {
    const spikeGroup = new THREE.Group();
    spikeGroup.position.set(0, 0.36, -0.22);
    spikeGroup.visible = false;
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -1 : 1;
      const idx = i % 3;
      const spike = new THREE.Mesh(
        new THREE.ConeGeometry(0.085, 0.48 + idx * 0.12, 6),
        new THREE.MeshBasicMaterial({
          color: idx === 1 ? awkSecHex : awkHex,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
        })
      );
      spike.position.set(side * (0.2 + idx * 0.08), 0.14 + idx * 0.12, -0.05);
      spike.rotation.z = -side * (0.35 + idx * 0.22);
      spike.rotation.x = -0.35;
      spikeGroup.add(spike);
    }
    torso.add(spikeGroup);
    awakenedParts.push(spikeGroup);
    awakenedOrbiters.push(spikeGroup);
  } else if (id === 'damen') {
    const revolverHalo = new THREE.Group();
    revolverHalo.position.set(0, 0.42, -0.34);
    revolverHalo.visible = false;
    const gunMat = new THREE.MeshBasicMaterial({
      color: awkHex,
      transparent: true,
      opacity: 0.94,
      blending: THREE.AdditiveBlending,
    });
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI * 0.42 + (i / 5) * Math.PI * 0.84;
      const gunHolder = new THREE.Group();
      gunHolder.position.set(Math.sin(a) * 0.72, Math.cos(a) * 0.56, 0);
      gunHolder.rotation.z = -a;
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.24, 0.07), gunMat);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.11, 0.09), gunMat);
      grip.position.set(0, -0.11, -0.04);
      grip.rotation.x = 0.45;
      gunHolder.add(barrel, grip);
      revolverHalo.add(gunHolder);
    }
    torso.add(revolverHalo);
    awakenedParts.push(revolverHalo);
    awakenedOrbiters.push(revolverHalo);
  } else if (id === 'khen') {
    const shadowSpikes = new THREE.Group();
    shadowSpikes.position.set(0, 1.0, 0);
    shadowSpikes.visible = false;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const blade = new THREE.Mesh(
        new THREE.ConeGeometry(0.07, 0.52, 4),
        new THREE.MeshBasicMaterial({
          color: i % 2 === 0 ? awkHex : awkSecHex,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
        })
      );
      blade.position.set(Math.cos(a) * 0.84, (i % 2 === 0 ? 0.18 : -0.12), Math.sin(a) * 0.84);
      blade.rotation.z = Math.PI * 0.5;
      blade.rotation.y = -a;
      shadowSpikes.add(blade);
    }
    leanPivot.add(shadowSpikes);
    awakenedParts.push(shadowSpikes);
    awakenedOrbiters.push(shadowSpikes);
  } else if (id === 'jm') {
    const dragonCore = new THREE.Group();
    dragonCore.position.set(0, 0.34, 0.24);
    dragonCore.visible = false;
    const coreGem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.14, 0),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.96,
        blending: THREE.AdditiveBlending,
      })
    );
    const coreRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.24, 0.024, 6, 20),
      new THREE.MeshBasicMaterial({
        color: awkSecHex,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
      })
    );
    dragonCore.add(coreGem, coreRing);
    torso.add(dragonCore);
    awakenedParts.push(dragonCore);
    awakenedOrbiters.push(dragonCore);
  }

  const silencedRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.68, 0.035, 6, 24),
    new THREE.MeshBasicMaterial({
      color: 0xc084fc,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  silencedRing.rotation.x = Math.PI * 0.5;
  silencedRing.position.y = 1.68;
  silencedRing.visible = false;
  root.add(silencedRing);

  const snareMarkRing = new THREE.Mesh(
    new THREE.RingGeometry(0.75, 0.92, 6),
    new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  snareMarkRing.rotation.x = -Math.PI * 0.5;
  snareMarkRing.position.y = 0.13;
  snareMarkRing.visible = false;
  root.add(snareMarkRing);

  // Crisp 2x High-DPI 3D Overhead Health & Nameplate Sprite
  const barCanvas = document.createElement('canvas');
  barCanvas.width = 360;
  barCanvas.height = 96;
  const barCtx = barCanvas.getContext('2d')!;
  const barTex = new THREE.CanvasTexture(barCanvas);
  barTex.colorSpace = THREE.SRGBColorSpace;
  const barSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: barTex,
      transparent: true,
      depthTest: false,
    })
  );
  barSprite.position.set(0, 2.38, 0);
  barSprite.scale.set(1.92, 0.52, 1);
  root.add(barSprite);

  return {
    id,
    skinId,
    isLocalPlayer,
    root,
    leanPivot,
    squashGroup,
    hips,
    torso,
    head,
    armL: armLObj.rootPivot,
    elbowL: armLObj.midPivot,
    armR: armRObj.rootPivot,
    elbowR: armRObj.midPivot,
    legL: legLObj.rootPivot,
    kneeL: legLObj.midPivot,
    legR: legRObj.rootPivot,
    kneeR: legRObj.midPivot,
    eyeTex,
    auraRing,
    heroInnerRing,
    outlineMaterial,
    cowboyHat,
    glassesGlint,
    crownHalo,
    wingL,
    wingR,
    roninWindRing,
    companionGroup,
    companionTail,
    teardrops,
    goldenShield,
    shieldShards,
    dissolveCloud,
    bodyMaterials,
    standardMaterials,
    hairTufts,
    hitFlashTimer: 0,
    lastPoseTime: 0,
    staffGroup,
    sashRibbons,
    coatTail,
    idBadge,
    tailwindRibbons,
    tailwindExtraRibbons,
    magmaVeins,
    frenzyFlameShell,
    deadeyeRing,
    voidWisps,
    jmHandGlows,
    contactShadow,
    overheadSprite: barSprite,
    overheadCanvas: barCanvas,
    overheadCtx: barCtx,
    overheadTex: barTex,
    lastBarKey: '',
    smoothedPose: null,
    walkPhase: 0,
    landingSquash: 1.0,
    lastSpeed: 0,
    awakenedParts,
    awakenedOrbiters,
    silencedRing,
    snareMarkRing,
    transformFlashTime: 0,
  };
}

export function disposeFighterRig(rig: FighterRig, scene: THREE.Scene): void {
  scene.remove(rig.root);
  if (rig.dissolveCloud) {
    scene.remove(rig.dissolveCloud);
    rig.dissolveCloud.geometry.dispose();
    (rig.dissolveCloud.material as THREE.Material).dispose();
  }
  if (rig.shieldShards) {
    for (const sh of rig.shieldShards) {
      scene.remove(sh.mesh);
      sh.mesh.geometry.dispose();
      (sh.mesh.material as THREE.Material).dispose();
    }
  }
  const seenMats = new Set<THREE.Material>();
  rig.root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if (m.material) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if (!seenMats.has(mat)) {
          seenMats.add(mat);
          mat.dispose();
        }
      }
    }
  });
  rig.eyeTex.dispose();
  rig.overheadTex.dispose();
}

export function poseFighter(
  rig: FighterRig,
  pose: FighterPose,
  mapId: MapId | null,
  time: number,
  poseLambda = 24
): void {
  const dt = rig.lastPoseTime > 0 ? Math.min(0.05, Math.max(0.001, time - rig.lastPoseTime)) : 0.016;
  rig.lastPoseTime = time;

  if (!rig.smoothedPose) {
    rig.smoothedPose = {
      ...pose,
      armLAngle: [...pose.armLAngle],
      armRAngle: [...pose.armRAngle],
      legLAngle: [...pose.legLAngle],
      legRAngle: [...pose.legRAngle],
    };
  } else {
    const sp = rig.smoothedPose;
    sp.x = pose.x;
    sp.y = pose.y;
    sp.z = pose.z;
    sp.rotY = dampAngle(sp.rotY, pose.rotY, poseLambda + 6, dt);
    sp.leanX = dampScalar(sp.leanX, pose.leanX, poseLambda, dt);
    sp.leanZ = dampScalar(sp.leanZ, pose.leanZ, poseLambda, dt);
    sp.hipY = dampScalar(sp.hipY, pose.hipY, poseLambda, dt);
    sp.torsoPitch = dampScalar(sp.torsoPitch, pose.torsoPitch, poseLambda, dt);
    sp.torsoYaw = dampScalar(sp.torsoYaw, pose.torsoYaw, poseLambda, dt);
    sp.torsoRoll = dampScalar(sp.torsoRoll, pose.torsoRoll, poseLambda, dt);
    sp.headPitch = dampScalar(sp.headPitch, pose.headPitch, poseLambda, dt);
    sp.headYaw = dampScalar(sp.headYaw, pose.headYaw, poseLambda, dt);
    for (let i = 0; i < 3; i++) {
      sp.armLAngle[i] = dampScalar(sp.armLAngle[i], pose.armLAngle[i], poseLambda + 4, dt);
      sp.armRAngle[i] = dampScalar(sp.armRAngle[i], pose.armRAngle[i], poseLambda + 4, dt);
      sp.legLAngle[i] = dampScalar(sp.legLAngle[i], pose.legLAngle[i], poseLambda, dt);
      sp.legRAngle[i] = dampScalar(sp.legRAngle[i], pose.legRAngle[i], poseLambda, dt);
    }
    sp.elbowL = dampScalar(sp.elbowL, pose.elbowL, poseLambda + 4, dt);
    sp.elbowR = dampScalar(sp.elbowR, pose.elbowR, poseLambda + 4, dt);
    sp.kneeL = dampScalar(sp.kneeL, pose.kneeL, poseLambda, dt);
    sp.kneeR = dampScalar(sp.kneeR, pose.kneeR, poseLambda, dt);
    sp.squash = dampScalar(sp.squash, pose.squash, 22, dt);
    sp.auraOpacity = dampScalar(sp.auraOpacity, pose.auraOpacity, 14, dt);
    sp.bodyOpacity = pose.bodyOpacity;
    sp.eyeState = pose.eyeState;
  }

  rig.landingSquash = dampScalar(rig.landingSquash, 1.0, 14, dt);
  const sp = rig.smoothedPose;

  const groundY = mapId ? getMapTerrainHeight(mapId, sp.x, sp.z) : 0;
  rig.root.position.set(sp.x, groundY + sp.y, sp.z);
  rig.root.rotation.set(0, sp.rotY, 0);
  rig.leanPivot.rotation.set(sp.leanX, 0, sp.leanZ);

  const sy = Math.max(0.55, Math.min(1.4, sp.squash * rig.landingSquash));
  const sxz = 1 / Math.sqrt(Math.max(0.45, sy));
  rig.squashGroup.scale.set(sxz, sy, sxz);

  rig.hips.position.y = 0.92 + sp.hipY;
  rig.torso.rotation.set(sp.torsoPitch, sp.torsoYaw, sp.torsoRoll);
  rig.head.rotation.set(
    sp.headPitch - sp.torsoPitch * 0.65,
    sp.headYaw - sp.torsoYaw * 0.75,
    -sp.torsoRoll * 0.5
  );

  rig.armL.rotation.set(sp.armLAngle[0], sp.armLAngle[1], sp.armLAngle[2]);
  rig.elbowL.rotation.x = sp.elbowL;
  rig.armR.rotation.set(sp.armRAngle[0], sp.armRAngle[1], sp.armRAngle[2]);
  rig.elbowR.rotation.x = sp.elbowR;

  rig.legL.rotation.set(sp.legLAngle[0], sp.legLAngle[1], sp.legLAngle[2]);
  rig.kneeL.rotation.x = sp.kneeL;
  rig.legR.rotation.set(sp.legRAngle[0], sp.legRAngle[1], sp.legRAngle[2]);
  rig.kneeR.rotation.x = sp.kneeR;

  if (rig.eyeTex.userData.drawState(sp.eyeState)) {
    rig.eyeTex.needsUpdate = true;
  }

  const vis = sp.bodyOpacity > 0.02;
  rig.auraRing.visible = vis;
  rig.auraRing.position.y = -sp.y + 0.09;
  rig.auraRing.material.opacity = rig.isLocalPlayer
    ? Math.max(0.84, sp.auraOpacity)
    : Math.max(0.32, sp.auraOpacity);
  rig.auraRing.scale.setScalar(1.0 + Math.sin(time * 9.0) * 0.06);
  if (rig.heroInnerRing) {
    rig.heroInnerRing.visible = vis;
    rig.heroInnerRing.position.y = -sp.y + 0.102;
    rig.heroInnerRing.material.opacity = vis ? 0.8 + Math.sin(time * 7.5) * 0.16 : 0;
    rig.heroInnerRing.scale.setScalar(1.0 + Math.cos(time * 9.0) * 0.04);
  }
  if (rig.deadeyeRing) {
    rig.deadeyeRing.position.y = -sp.y + 0.082;
  }
  if (rig.outlineMaterial) {
    rig.outlineMaterial.opacity = sp.bodyOpacity * 0.92;
  }

  rig.squashGroup.visible = vis;
  rig.contactShadow.visible = vis;
  const shadowMeta = computeContactShadowTransform(sp.y);
  rig.contactShadow.position.y = -sp.y + 0.025;
  rig.contactShadow.scale.setScalar(shadowMeta.scale);
  (rig.contactShadow.material as THREE.MeshBasicMaterial).opacity = shadowMeta.opacity * sp.bodyOpacity;

  rig.bodyMaterials.forEach((m) => {
    m.opacity = sp.bodyOpacity;
  });

  if (rig.hitFlashTimer > 0) {
    rig.hitFlashTimer = Math.max(0, rig.hitFlashTimer - dt);
    const flash = Math.min(1, rig.hitFlashTimer / 0.11);
    for (const entry of rig.standardMaterials) {
      entry.mat.emissive.setHex(0xffffff);
      entry.mat.emissiveIntensity = 0.85 * flash + entry.baseIntensity * (1 - flash);
    }
  } else if (rig.transformFlashTime > 0) {
    const tf = Math.min(1, rig.transformFlashTime / 0.8);
    const tfHex =
      rig.id === 'marjohn'
        ? 0x22d3ee
        : rig.id === 'prime'
        ? 0xf43f5e
        : rig.id === 'damen'
        ? 0xfacc15
        : rig.id === 'khen'
        ? 0xa855f7
        : 0xfef08a;
    for (const entry of rig.standardMaterials) {
      entry.mat.emissive.setHex(tfHex);
      entry.mat.emissiveIntensity = entry.baseIntensity + 1.15 * tf;
    }
    const pulseScale = 1.0 + Math.sin(time * 28) * 0.08 * tf;
    rig.squashGroup.scale.multiplyScalar(pulseScale);
  } else {
    for (const entry of rig.standardMaterials) {
      if (entry.mat.emissive.getHex() !== entry.baseEmissive) {
        entry.mat.emissive.setHex(entry.baseEmissive);
      }
      entry.mat.emissiveIntensity = entry.baseIntensity;
    }
  }

  for (const orb of rig.awakenedOrbiters) {
    if (!orb.visible) continue;
    if (rig.id === 'marjohn' || rig.id === 'khen') {
      orb.rotation.y = time * (rig.id === 'khen' ? 4.8 : 3.4);
    } else if (rig.id === 'damen') {
      orb.rotation.z = Math.sin(time * 2.2) * 0.12;
    } else if (rig.id === 'jm') {
      orb.rotation.z = time * 3.8;
    } else if (rig.id === 'prime') {
      const s = 1.0 + Math.sin(time * 14) * 0.08;
      orb.scale.set(s, s, s);
    }
  }

  if (rig.silencedRing.visible) {
    rig.silencedRing.rotation.z = time * 4.5;
  }
  if (rig.snareMarkRing.visible) {
    rig.snareMarkRing.rotation.z = -time * 3.6;
  }

  if (rig.hairTufts) {
    const sway = Math.sin(time * 9.5 + sp.x) * 0.08 + Math.min(0.22, Math.abs(sp.leanX) * 0.45);
    for (const tuft of rig.hairTufts) {
      const { baseRx, baseRz, idx } = tuft.userData as { baseRx: number; baseRz: number; idx: number };
      tuft.rotation.x = baseRx + sway * Math.cos(idx * 0.7);
      tuft.rotation.z = baseRz + Math.sin(time * 8 + idx) * 0.05;
    }
  }

  if (rig.wingL && rig.wingR) {
    const flare = sp.y > 0.3 ? 0.42 : Math.sin(time * 4.5) * 0.12;
    rig.wingL.rotation.y = -0.25 - flare;
    rig.wingR.rotation.y = 0.25 + flare;
    rig.wingL.rotation.z = Math.sin(time * 5.2) * 0.08;
    rig.wingR.rotation.z = -Math.sin(time * 5.2) * 0.08;
  }

  if (rig.roninWindRing) {
    rig.roninWindRing.rotation.z = time * 4.2;
  }

  if (rig.teardrops) {
    for (const drop of rig.teardrops) {
      const { side, phase } = drop.userData as { side: number; phase: number };
      const cycle = (time * 1.45 + phase) % 1.0;
      drop.position.set(side, -0.02 - cycle * 0.18, 0.245);
      (drop.material as THREE.MeshBasicMaterial).opacity = Math.sin(cycle * Math.PI) * 0.92;
    }
  }

  if (rig.companionGroup) {
    rig.companionGroup.position.y = Math.abs(Math.sin(time * 7.2)) * 0.06;
    rig.companionGroup.rotation.x = sp.leanX * 0.65;
    if (rig.companionTail) {
      rig.companionTail.rotation.z = Math.sin(time * 16) * 0.45;
    }
  }

  if (rig.sashRibbons) {
    const flutter = Math.sin(time * 10 + sp.x) * 0.24;
    rig.sashRibbons[0].rotation.x = 0.28 + flutter + Math.max(0, sp.y * 0.12);
    rig.sashRibbons[1].rotation.x = 0.28 - flutter + Math.max(0, sp.y * 0.12);
  }
  if (rig.coatTail) {
    rig.coatTail.rotation.x = 0.24 + Math.sin(time * 9 + sp.z) * 0.18;
  }
  if (rig.idBadge) {
    rig.idBadge.rotation.x = -sp.leanX * 0.8 + Math.sin(time * 7) * 0.08;
  }
}

export function getStancePose(id: FighterId, time: number): FighterPose {
  const breathe = Math.sin(time * 3.4) * 0.025;
  if (id === 'marjohn') {
    return {
      ...DEFAULT_POSE,
      hipY: -0.1 + breathe,
      torsoPitch: 0.14,
      armLAngle: [-0.88, 0.48, -0.18],
      elbowL: -1.05,
      armRAngle: [-0.42, -0.35, 0.32],
      elbowR: -0.92,
      legLAngle: [-0.28, 0, -0.09],
      kneeL: 0.52,
      legRAngle: [0.32, 0, 0.09],
      kneeR: 0.42,
      auraOpacity: 0.42,
    };
  }
  if (id === 'prime') {
    return {
      ...DEFAULT_POSE,
      hipY: -0.18 + breathe,
      torsoPitch: 0.24,
      armLAngle: [-0.95, 0.35, -0.35],
      elbowL: -1.45,
      armRAngle: [-0.85, -0.35, 0.35],
      elbowR: -1.35,
      legLAngle: [-0.36, 0, -0.14],
      kneeL: 0.65,
      legRAngle: [0.4, 0, 0.14],
      kneeR: 0.52,
      auraOpacity: 0.48,
    };
  }
  if (id === 'damen') {
    return {
      ...DEFAULT_POSE,
      hipY: -0.08 + breathe,
      torsoPitch: 0.06,
      armLAngle: [-0.95, 0.15, -0.32],
      elbowL: -1.15,
      armRAngle: [-0.95, -0.15, 0.32],
      elbowR: -1.15,
      legLAngle: [-0.22, 0, -0.1],
      kneeL: 0.36,
      legRAngle: [0.24, 0, 0.1],
      kneeR: 0.32,
      auraOpacity: 0.38,
    };
  }
  if (id === 'khen') {
    return {
      ...DEFAULT_POSE,
      hipY: -0.12 + breathe,
      torsoPitch: 0.16,
      armLAngle: [-0.65, 0.32, -0.35],
      elbowL: -1.42,
      armRAngle: [-0.65, -0.32, 0.35],
      elbowR: -1.42,
      legLAngle: [-0.3, 0, -0.1],
      kneeL: 0.48,
      legRAngle: [0.34, 0, 0.1],
      kneeR: 0.44,
      auraOpacity: 0.45,
    };
  }
  return {
    ...DEFAULT_POSE,
    hipY: -0.11 + breathe,
    torsoPitch: 0.15,
    armLAngle: [-0.75, 0.25, -0.28],
    elbowL: -1.35,
    armRAngle: [-0.55, -0.25, 0.28],
    elbowR: -1.25,
    legLAngle: [-0.28, 0, -0.09],
    kneeL: 0.48,
    legRAngle: [0.32, 0, 0.09],
    kneeR: 0.38,
    auraOpacity: 0.48,
  };
}

function updateOverheadBar(rig: FighterRig, actor: ArenaActorState): void {
  if (actor.isKO) {
    rig.overheadSprite.visible = false;
    return;
  }
  rig.overheadSprite.visible = true;
  const isSilenced = (actor.silencedTimer ?? 0) > 0.05;
  const isMarked = (actor.snareMarkedTimer ?? 0) > 0.05;
  const key = `${actor.name}|${actor.hp}|${actor.mana}|${actor.stagger}|${actor.shieldActive ? 1 : 0}|${actor.parryWindow ? 1 : 0}|${actor.isStunned ? 1 : 0}|${actor.actionState === 'whiff' ? 1 : 0}|${actor.isOverdrive ? 1 : 0}|${actor.awakened ? 1 : 0}|${isSilenced ? 1 : 0}|${isMarked ? 1 : 0}|${rig.isLocalPlayer ? 1 : 0}`;
  if (rig.lastBarKey === key) return;
  rig.lastBarKey = key;

  const ctx = rig.overheadCtx;
  ctx.save();
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.clearRect(0, 0, 180, 48);

  ctx.fillStyle = actor.awakened
    ? 'rgba(255, 251, 235, 0.98)'
    : rig.isLocalPlayer
    ? 'rgba(255, 255, 255, 0.96)'
    : 'rgba(248, 250, 252, 0.92)';
  ctx.fillRect(6, 2, 168, 42);
  ctx.strokeStyle = actor.isStunned
    ? '#e11d48'
    : actor.awakened
    ? '#f59e0b'
    : actor.actionState === 'whiff'
    ? '#ea580c'
    : actor.parryWindow
    ? '#d97706'
    : actor.isOverdrive
    ? '#ca8a04'
    : rig.isLocalPlayer
    ? FIGHTER_BY_ID[actor.fighterId].color
    : actor.shieldActive
    ? '#0284c7'
    : 'rgba(100, 116, 139, 0.6)';
  ctx.lineWidth = actor.awakened || actor.parryWindow || actor.isStunned || actor.isOverdrive || rig.isLocalPlayer ? 2.5 : 1.5;
  ctx.strokeRect(6, 2, 168, 42);

  ctx.fillStyle = isSilenced
    ? '#7e22ce'
    : actor.isStunned
    ? '#be123c'
    : actor.actionState === 'whiff'
    ? '#c2410c'
    : '#0f172a';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'left';
  const label = isSilenced
    ? 'SILENCED!'
    : actor.isStunned
    ? 'STUNNED!'
    : actor.actionState === 'whiff'
    ? 'OPEN!'
    : `${actor.awakened ? '★ ' : ''}${actor.name.slice(0, 11)}`;
  ctx.fillText(label, 12, 16);
  ctx.textAlign = 'right';
  ctx.fillStyle = actor.awakened ? '#b45309' : '#334155';
  ctx.fillText(`${actor.hp}`, 168, 16);

  const hpPct = Math.max(0, Math.min(1, actor.hp / Math.max(1, actor.maxHp)));
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(12, 21, 156, 8);
  ctx.fillStyle = actor.awakened ? '#f59e0b' : hpPct > 0.55 ? '#16a34a' : hpPct > 0.28 ? '#d97706' : '#e11d48';
  ctx.fillRect(12, 21, Math.round(156 * hpPct), 8);

  // Stagger buildup bar (crimson/amber) on bottom strip
  const stagPct = Math.max(0, Math.min(1, actor.stagger / 100));
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(12, 33, 156, 5);
  ctx.fillStyle = actor.isStunned ? '#e11d48' : isMarked ? '#eab308' : '#f59e0b';
  ctx.fillRect(12, 33, Math.round(156 * stagPct), 5);
  ctx.restore();

  rig.overheadTex.needsUpdate = true;
}

export function computeActorPose(
  actor: ArenaActorState,
  rig: FighterRig,
  time: number,
  matchTime: number
): FighterPose {
  updateOverheadBar(rig, actor);

  const isAwakened = Boolean(actor.awakened) && !actor.isKO;
  for (const part of rig.awakenedParts) {
    part.visible = isAwakened;
  }
  rig.silencedRing.visible = !actor.isKO && (actor.silencedTimer ?? 0) > 0.05;
  rig.snareMarkRing.visible = !actor.isKO && (actor.snareMarkedTimer ?? 0) > 0.05;
  rig.transformFlashTime = !actor.isKO ? (actor.awakeningTransformTimer ?? 0) : 0;

  const base = getStancePose(actor.fighterId, time);
  if (rig.skinId === 'special' && actor.fighterId === 'prime') {
    base.torsoPitch += 0.14;
    base.headPitch += 0.18;
  } else if (rig.skinId === 'special' && actor.fighterId === 'marjohn') {
    base.torsoPitch += 0.2;
    base.armLAngle = [-1.15, 0.2, -0.1];
    base.elbowL = -0.35;
  }
  base.x = actor.x;
  base.y = actor.y;
  base.z = actor.z;
  base.rotY = actor.rotY;

  if (actor.isKO) {
    const koAge = actor.koTime !== null ? Math.max(0, matchTime - actor.koTime) : 1.0;
    const style = actor.koStyle;
    const killerId = actor.koByFighterId;

    // Hide active passives on KO
    if (rig.tailwindRibbons) rig.tailwindRibbons.forEach((r) => (r.visible = false));
    if (rig.tailwindExtraRibbons) rig.tailwindExtraRibbons.forEach((r) => (r.visible = false));
    if (rig.frenzyFlameShell) rig.frenzyFlameShell.visible = false;
    if (rig.deadeyeRing) rig.deadeyeRing.visible = false;
    if (rig.voidWisps) rig.voidWisps.forEach((w) => (w.visible = false));
    if (rig.jmHandGlows) rig.jmHandGlows.forEach((g) => (g.visible = false));
    rig.awakenedParts.forEach((p) => (p.visible = false));
    rig.silencedRing.visible = false;
    rig.snareMarkRing.visible = false;

    if (style === 'launch') {
      // Prime Launch KO: punted skyward spinning & vanishing after apex
      const skyY = Math.max(0.1, koAge * 13.8 - 5.2 * koAge * koAge);
      const fade = koAge > 0.9 ? Math.max(0, 1 - (koAge - 0.9) / 0.35) : 1;
      return {
        ...base,
        y: actor.y + skyY,
        leanX: -koAge * 7.2,
        torsoRoll: koAge * 4.5,
        armLAngle: [-1.8, 0, -0.8],
        armRAngle: [-1.8, 0, 0.8],
        legLAngle: [0.4, 0, -0.25],
        legRAngle: [-0.3, 0, 0.25],
        eyeState: 'ko',
        auraOpacity: 0,
        bodyOpacity: fade,
      };
    }

    if (style === 'shatter') {
      // Damen Shatter KO: freeze mid-motion for 0.24s, then shatter into shards
      const frozen = koAge < 0.24;
      if (rig.shieldShards) {
        const shT = Math.max(0, koAge - 0.22);
        rig.shieldShards.forEach((sh) => {
          if (!frozen && shT < 1.45) {
            sh.mesh.visible = true;
            sh.mesh.position.set(
              actor.x + sh.vx * shT,
              Math.max(0.1, 1.1 + sh.vy * shT - 6.5 * shT * shT),
              actor.z + sh.vz * shT
            );
            sh.mesh.rotation.set(shT * 7, shT * 5, shT * 6);
            (sh.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - shT / 1.4);
          } else {
            sh.mesh.visible = false;
          }
        });
      }
      return {
        ...base,
        y: actor.y + (frozen ? 0.18 : 0.1),
        leanX: -0.22,
        torsoYaw: 0.35,
        armLAngle: [-0.9, 0.2, -0.5],
        armRAngle: [-0.9, -0.2, 0.5],
        eyeState: 'shock',
        auraOpacity: frozen ? 0.85 : 0,
        bodyOpacity: frozen ? 0.92 : 0,
      };
    }

    if (style === 'dissolve') {
      // Khen Dissolve KO: unravel into drifting violet smoke particles
      const dP = Math.min(1, koAge / 1.25);
      if (rig.dissolveCloud) {
        rig.dissolveCloud.visible = dP < 1;
        (rig.dissolveCloud.material as THREE.PointsMaterial).opacity = Math.sin(dP * Math.PI) * 0.95;
        const arr = rig.dissolveCloud.geometry.attributes.position.array as Float32Array;
        const seeds = rig.dissolveCloud.userData.seeds as Array<{
          x: number;
          y: number;
          z: number;
          speed: number;
          drift: number;
        }>;
        const groundY = rig.root.position.y - actor.y;
        for (let i = 0; i < seeds.length; i++) {
          const sd = seeds[i];
          arr[i * 3] = actor.x + sd.x + sd.drift * dP * 1.4;
          arr[i * 3 + 1] = groundY + sd.y + dP * sd.speed * 2.2;
          arr[i * 3 + 2] = actor.z + sd.z + Math.sin(i + dP * 6) * 0.45 * dP;
        }
        rig.dissolveCloud.geometry.attributes.position.needsUpdate = true;
      }
      return {
        ...base,
        y: actor.y + dP * 0.65,
        leanX: -0.3 - dP * 0.2,
        armLAngle: [-1.1, 0, -0.6],
        armRAngle: [-1.1, 0, 0.6],
        eyeState: 'ko',
        auraOpacity: 0,
        bodyOpacity: Math.max(0, 1 - dP),
      };
    }

    // Collapse KO (Marjohn wind-tatter inward crumple OR JM collapse under golden light pillar)
    const u = Math.min(1, koAge / 0.85);
    const fadeOut = koAge > 0.65 ? Math.max(0, 1 - (koAge - 0.65) / 0.45) : 1;
    const isJmCollapse = killerId === 'jm';
    return {
      ...base,
      y: isJmCollapse ? 0.1 : 0.14 * (1 - u * 0.3),
      leanX: isJmCollapse ? 0.55 * u : 0.35 + (1.38 - 0.35) * u,
      hipY: isJmCollapse ? -0.34 * u : -0.18 * u,
      squash: isJmCollapse ? 1 - u * 0.12 : 1 - u * 0.34,
      armLAngle: isJmCollapse ? [-0.35, 0.4, -0.4] : [-0.8 * u, 0.6 * u, -0.25],
      armRAngle: isJmCollapse ? [-0.35, -0.4, 0.4] : [-0.8 * u, -0.6 * u, 0.25],
      legLAngle: [0.35, 0, -0.14],
      kneeL: 1.25,
      legRAngle: [0.25, 0, 0.14],
      kneeR: 1.15,
      eyeState: 'ko',
      auraOpacity: 0,
      bodyOpacity: fadeOut,
    };
  }

  if (rig.dissolveCloud) rig.dissolveCloud.visible = false;
  if (rig.shieldShards) rig.shieldShards.forEach((s) => (s.mesh.visible = false));

  if (actor.damagePhase === 'DAMAGED') {
    base.torsoPitch += 0.07;
    base.auraOpacity *= 0.88;
  } else if (actor.damagePhase === 'SEVERELY DAMAGED') {
    base.torsoPitch += 0.15;
    base.hipY -= 0.04;
    base.torsoRoll += Math.sin(time * 6.5) * 0.05;
    base.auraOpacity *= Math.sin(time * 22) > -0.3 ? 0.72 : 0.22;
  } else if (actor.damagePhase === 'CRITICAL') {
    base.torsoPitch += 0.24;
    base.hipY -= 0.09;
    base.kneeL += 0.22;
    base.kneeR += 0.22;
    base.torsoRoll += Math.sin(time * 9.0) * 0.08;
    base.auraOpacity *= Math.sin(time * 32) > 0 ? 0.55 : 0.12;
  }

  if (actor.isOverdrive) {
    base.auraOpacity = Math.max(base.auraOpacity, 0.78 + Math.sin(time * 18) * 0.2);
  }

  // Character-Specific Passive Visuals + Frenzy Intensification
  const inFrenzy = Boolean(actor.frenzyInside);
  if (inFrenzy) {
    base.auraOpacity = Math.max(base.auraOpacity, 0.72 + Math.sin(time * 16) * 0.22);
    rig.auraRing.material.color.setHex(
      actor.fighterId === 'marjohn' ? 0x5eead4 : actor.fighterId === 'prime' ? 0xfb923c : FIGHTER_BY_ID[actor.fighterId].hex
    );
  } else {
    rig.auraRing.material.color.setHex(
      actor.fighterId === 'marjohn' ? 0x2dd4bf : FIGHTER_BY_ID[actor.fighterId].hex
    );
  }

  if (rig.tailwindRibbons && rig.tailwindExtraRibbons) {
    const stacks = actor.passiveStacks;
    for (let i = 0; i < rig.tailwindRibbons.length; i++) {
      const show = i < stacks;
      const rib = rig.tailwindRibbons[i];
      const ex = rig.tailwindExtraRibbons[i];
      rib.visible = show;
      ex.visible = show && inFrenzy;
      if (show) {
        rib.rotation.z = time * (5.5 + stacks * 1.6 + (inFrenzy ? 5 : 0)) + i * 1.1;
        const mat = rib.material as THREE.MeshBasicMaterial;
        mat.opacity = inFrenzy ? 0.96 : 0.65 + stacks * 0.06;
        mat.color.setHex(inFrenzy ? 0x99f6e4 : 0x2dd4bf);
      }
      if (ex.visible) {
        ex.rotation.z = -time * (9.0 + stacks * 1.8) + i * 0.8;
      }
    }
  }

  if (rig.magmaVeins) {
    const missing = Math.max(0, 1 - actor.hp / Math.max(1, actor.maxHp));
    const armoredSwing = actor.actionState === 'attack' || actor.actionState === 'skill';
    const heat = Math.min(1, missing * 1.25 + (armoredSwing ? 0.35 : 0) + (inFrenzy ? 0.3 : 0));
    rig.magmaVeins.forEach((v, idx) => {
      const mat = v.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.08 + heat * 0.92;
      mat.color.setHex(heat > 0.65 ? 0xfef08a : idx >= 3 ? 0xf43f5e : 0xfb923c);
    });
    if (rig.frenzyFlameShell) {
      rig.frenzyFlameShell.visible = inFrenzy || armoredSwing;
      if (rig.frenzyFlameShell.visible) {
        rig.frenzyFlameShell.material.opacity = inFrenzy ? 0.34 + Math.sin(time * 20) * 0.12 : 0.18;
        rig.frenzyFlameShell.rotation.y = time * 4.5;
        rig.frenzyFlameShell.scale.setScalar(1.0 + Math.sin(time * 16) * 0.07);
      }
    }
  }

  if (rig.deadeyeRing) {
    rig.deadeyeRing.visible = true;
    const pulse = 0.5 + 0.5 * Math.sin(time * (inFrenzy ? 10 : 4.5));
    rig.deadeyeRing.material.opacity = inFrenzy ? 0.42 + pulse * 0.32 : 0.14 + pulse * 0.12;
    rig.deadeyeRing.material.color.setHex(inFrenzy ? 0xfef08a : 0xf59e0b);
    rig.deadeyeRing.scale.setScalar(inFrenzy ? 1.02 + pulse * 0.04 : 1.0);
  }

  if (rig.voidWisps) {
    rig.voidWisps.forEach((w, i) => {
      w.visible = true;
      const spd = inFrenzy ? 8.5 : 3.6;
      const a = time * spd + (i / rig.voidWisps!.length) * Math.PI * 2;
      w.position.set(Math.cos(a) * (inFrenzy ? 0.56 : 0.42), 0.85 + Math.sin(time * 6 + i) * 0.15, Math.sin(a) * (inFrenzy ? 0.56 : 0.42));
      w.rotation.y = -a;
      (w.material as THREE.MeshBasicMaterial).opacity = inFrenzy ? 0.88 : 0.42;
    });
  }

  if (rig.jmHandGlows) {
    const regenPulse = inFrenzy && actor.hp < actor.maxHp * 0.4 ? 0.45 + 0.55 * Math.max(0, Math.sin(time * Math.PI * 2)) : 0;
    const activeGlow = actor.counterFlowActive || regenPulse > 0.1;
    rig.jmHandGlows.forEach((g) => {
      g.visible = activeGlow;
      if (activeGlow) {
        (g.material as THREE.MeshBasicMaterial).opacity = actor.counterFlowActive ? 0.88 : regenPulse * 0.65;
        g.scale.setScalar(actor.counterFlowActive ? 1.18 + Math.sin(time * 14) * 0.15 : 0.9 + regenPulse * 0.35);
      }
    });
    if (regenPulse > 0.25) {
      base.auraOpacity = Math.max(base.auraOpacity, regenPulse * 0.95);
      rig.auraRing.material.color.setHex(0xfef08a);
    }
  }

  if (rig.goldenShield) {
    if (actor.shieldActive) {
      rig.goldenShield.visible = true;
      const parryHex =
        actor.fighterId === 'marjohn'
          ? 0x99f6e4
          : actor.fighterId === 'khen'
          ? 0xe879f9
          : 0xfef08a;
      const guardHex =
        actor.fighterId === 'marjohn' ? 0x2dd4bf : FIGHTER_BY_ID[actor.fighterId].hex;
      rig.goldenShield.material.color.setHex(actor.parryWindow ? parryHex : guardHex);
      rig.goldenShield.material.opacity = actor.parryWindow ? 0.9 : actor.fighterId === 'marjohn' ? 0.38 : 0.5;
      rig.goldenShield.scale.setScalar(actor.parryWindow ? 1.15 : 0.98);
      rig.goldenShield.rotation.y = time * (actor.parryWindow ? 9.0 : actor.fighterId === 'marjohn' ? 5.5 : 2.6);
    } else {
      rig.goldenShield.visible = false;
    }
  }

  if (isAwakened) {
    const awkHex = AWAKENING_CONFIG.AWAKENED_KITS[actor.fighterId].auraPrimaryHex;
    base.auraOpacity = Math.max(base.auraOpacity, 0.88 + Math.sin(time * 12) * 0.12);
    rig.auraRing.material.color.setHex(awkHex);
    if (rig.wingL && rig.wingR) {
      rig.wingL.visible = true;
      rig.wingR.visible = true;
    }
  }

  if (rig.crownHalo) {
    rig.crownHalo.visible =
      rig.skinId === 'ascended' ||
      isAwakened ||
      actor.actionState === 'ultimate' ||
      actor.isOverdrive ||
      actor.counterFlowActive;
    if (rig.crownHalo.visible) {
      const isSkyMeteor = actor.fighterId === 'jm' && actor.abilitySlot === 5;
      rig.crownHalo.rotation.z = time * (isSkyMeteor ? 7.5 : isAwakened ? 5.2 : actor.counterFlowActive || actor.isOverdrive ? 3.8 : 1.4);
      rig.crownHalo.scale.setScalar(isSkyMeteor ? 1.55 : isAwakened ? 1.28 : actor.counterFlowActive ? 1.16 : 0.92);
    }
  }
  if (rig.staffGroup) {
    rig.staffGroup.rotation.y =
      actor.actionState === 'guard' || actor.actionState === 'skill' || (actor.actionState === 'attack' && actor.comboStep === 3)
        ? time * 18
        : 0;
  }

  const speed = Math.hypot(actor.vx, actor.vz);
  const dtStep = rig.lastPoseTime > 0 ? Math.min(0.05, Math.max(0.001, time - rig.lastPoseTime)) : 0.016;
  rig.lastSpeed = dampScalar(rig.lastSpeed, speed, 16, dtStep);
  if (actor.actionState === 'move' && rig.lastSpeed > 0.45 && actor.grounded && !actor.isFlying) {
    rig.walkPhase += Math.max(2.5, rig.lastSpeed * 1.45) * dtStep;
  }

  if (actor.isFlying) {
    base.hipY += Math.sin(time * 6.5) * 0.07;
    base.leanX = Math.min(0.28, rig.lastSpeed * 0.032);
    base.torsoPitch = 0.18;
    base.armLAngle = [-0.65, 0.35, -0.48];
    base.armRAngle = [-0.65, -0.35, 0.48];
    base.legLAngle = [-0.32, 0, -0.1];
    base.kneeL = 0.68;
    base.legRAngle = [0.28, 0, 0.1];
    base.kneeR = 0.42;
    base.auraOpacity = Math.max(base.auraOpacity, 0.85);
  } else if (!actor.grounded) {
    base.hipY += 0.05;
    base.torsoPitch += 0.18;
    base.armLAngle = [-1.15, 0.2, -0.45];
    base.armRAngle = [-1.15, -0.2, 0.45];
    base.legLAngle = [-0.55, 0, -0.08];
    base.kneeL = 0.95;
    base.legRAngle = [0.22, 0, 0.08];
    base.kneeR = 0.65;
  } else if (actor.actionState === 'move' && rig.lastSpeed > 0.5) {
    const stride = Math.min(1, rig.lastSpeed / 6.8);
    const ph = rig.walkPhase;
    const s = Math.sin(ph);
    base.hipY = -0.14 + Math.abs(Math.cos(ph)) * 0.07 * stride;
    base.torsoPitch += 0.26 * stride;
    base.leanX += 0.12 * stride;
    base.armLAngle = [s * 0.65 * stride - 0.35, 0, -0.22];
    base.armRAngle = [-s * 0.65 * stride - 0.35, 0, 0.22];
    base.legLAngle = [-s * 0.78 * stride, 0, -0.07];
    base.kneeL = Math.max(0.14, s * 0.85 * stride + 0.35);
    base.legRAngle = [s * 0.78 * stride, 0, 0.07];
    base.kneeR = Math.max(0.14, -s * 0.85 * stride + 0.35);
  }

  const prog = actor.actionDuration > 0 ? 1 - actor.actionTimer / actor.actionDuration : 0;
  const swingEnv = Math.sin(Math.min(1, Math.max(0, prog)) * Math.PI);

  if (actor.actionState === 'attack') {
    const step = actor.comboStep || 1;
    if (actor.fighterId === 'damen') {
      base.armRAngle = [-1.54, -0.06, 0.1];
      base.elbowR = -0.08;
      base.armLAngle = [-0.85, 0.25, -0.35];
      base.torsoYaw = -0.28 * swingEnv;
      base.auraOpacity = 0.82;
    } else if (actor.fighterId === 'marjohn') {
      // Sweeping Wind-Staff Tornado Poke thrust!
      base.torsoYaw = (prog < 0.35 ? -0.55 : 0.82) * swingEnv;
      base.torsoPitch += 0.22 * swingEnv;
      base.armRAngle = [-1.62, -0.18, 0.24];
      base.elbowR = -0.15;
      base.armLAngle = [-1.25, 0.45, -0.2];
      base.auraOpacity = 0.88;
    } else if (actor.fighterId === 'jm' && actor.isFlying) {
      // Flying JM fires energy bolts rapidly forward/down!
      base.armLAngle = [-1.45, 0.2, -0.15];
      base.armRAngle = [-1.45, -0.2, 0.15];
      base.elbowL = -0.15;
      base.elbowR = -0.15;
      base.auraOpacity = 0.94;
    } else if (actor.fighterId === 'jm' && step === 3) {
      // JM 3rd Hit: Mini Kamehameha twin-palm energy beam!
      base.torsoPitch = -0.12;
      base.armLAngle = [-1.58, 0.32, -0.06];
      base.armRAngle = [-1.58, -0.32, 0.06];
      base.elbowL = -0.08;
      base.elbowR = -0.08;
      base.auraOpacity = 0.98;
    } else if (actor.fighterId === 'jm' && step === 4) {
      // JM 4th Hit: High-Speed Dash Punch launcher!
      base.leanX = 0.42 * swingEnv;
      base.torsoYaw = -0.72 * swingEnv;
      base.armRAngle = [-1.65, -0.1, 0.15];
      base.elbowR = -0.05;
      base.armLAngle = [0.55, 0.2, -0.35];
      base.auraOpacity = 1.0;
    } else if (actor.fighterId === 'prime' && step === 4) {
      // Prime 4th Hit: Armored Ground Slam overhead wind-up -> floor smash!
      const isWindup = prog < 0.48;
      base.torsoPitch = isWindup ? -0.36 : 0.72;
      base.armLAngle = [isWindup ? -2.85 : -1.25, 0.25, -0.2];
      base.armRAngle = [isWindup ? -2.85 : -1.25, -0.25, 0.2];
      base.elbowL = -0.2;
      base.elbowR = -0.2;
      base.squash = isWindup ? 1.12 : 0.84;
      base.auraOpacity = 1.0;
    } else if (actor.fighterId === 'khen' && step === 4) {
      // Khen 4th Hit: Low Damaging Dash Lunge dual slice!
      base.leanX = 0.46;
      base.torsoPitch = 0.42;
      base.armLAngle = [0.65, 0.45, -0.75];
      base.armRAngle = [0.65, -0.45, 0.75];
      base.squash = 0.88;
      base.auraOpacity = 1.0;
    } else if (step === 1 || step === 3) {
      base.torsoYaw = (prog < 0.35 ? -0.4 : 0.75) * swingEnv;
      base.torsoPitch += 0.24 * swingEnv;
      base.armRAngle = [-1.75 * swingEnv - 0.3, -0.2, 0.35];
      base.elbowR = -0.2;
      base.armLAngle = [-0.7, 0.3, -0.35];
      base.auraOpacity = 0.82;
    } else {
      base.torsoYaw = (prog < 0.35 ? 0.5 : -0.85) * swingEnv;
      base.torsoPitch += 0.28 * swingEnv;
      base.armLAngle = [-1.85 * swingEnv - 0.2, 0.25, -0.35];
      base.elbowL = -0.18;
      base.armRAngle = [-0.75, -0.3, 0.35];
      base.auraOpacity = 0.88;
    }
  } else if (actor.actionState === 'headlock') {
    const shake = Math.sin(time * 28) * 0.14;
    base.hipY -= 0.12;
    base.torsoPitch = 0.35;
    base.torsoYaw = shake;
    base.armLAngle = [-1.52, 0.55, -0.25];
    base.armRAngle = [-1.52, -0.55, 0.25];
    base.elbowL = -0.95;
    base.elbowR = -0.95;
    base.eyeState = 'shock';
    base.auraOpacity = 0.92;
  } else if (actor.actionState === 'grab') {
    base.leanX = 0.32 * swingEnv;
    base.torsoPitch = 0.28;
    base.armLAngle = [-1.52, 0.35, -0.28];
    base.armRAngle = [-1.52, -0.35, 0.28];
    base.elbowL = -0.35;
    base.elbowR = -0.35;
    base.auraOpacity = 0.85;
  } else if (actor.actionState === 'whiff') {
    base.eyeState = 'shock';
    base.hipY -= 0.1;
    base.leanX = 0.26;
    base.torsoPitch = 0.42;
    base.torsoRoll = Math.sin(time * 22) * 0.12;
    base.armLAngle = [-0.3, 0, -0.75];
    base.armRAngle = [-0.3, 0, 0.75];
    base.auraOpacity = 0.35;
  } else if (actor.actionState === 'clash') {
    base.leanX = 0.22;
    base.hipY -= 0.14;
    base.armLAngle = [-1.55, 0.45, -0.2];
    base.armRAngle = [-1.55, -0.45, 0.2];
    base.elbowL = -0.8;
    base.elbowR = -0.8;
    base.auraOpacity = 1.0;
  } else if (actor.actionState === 'guard') {
    base.hipY -= 0.08;
    base.armLAngle = [-1.45, 0.55, -0.15];
    base.elbowL = -1.25;
    base.armRAngle = [-1.45, -0.55, 0.15];
    base.elbowR = -1.25;
    base.auraOpacity = actor.parryWindow ? 0.95 : 0.65;
  } else if (actor.actionState === 'dash') {
    base.leanX = 0.48;
    base.torsoPitch = 0.38;
    base.armLAngle = [0.68, 0, -0.32];
    base.armRAngle = [0.68, 0, 0.32];
    base.squash = 0.9;
    base.auraOpacity = 0.95;
  } else if (actor.actionState === 'skill') {
    base.torsoYaw = Math.sin(prog * Math.PI * 2) * 0.85;
    base.armLAngle = [-1.55, 0.4, -0.45];
    base.armRAngle = [-1.55, -0.4, 0.45];
    base.elbowL = -0.25;
    base.elbowR = -0.25;
    base.auraOpacity = 0.94;
  } else if (actor.actionState === 'ultimate') {
    if (actor.fighterId === 'jm' && actor.abilitySlot === 5) {
      // JM Secret Solar Meteor sky-charge: floating heroically with both arms cradling fireball overhead!
      base.hipY += 0.08 + Math.sin(time * 8) * 0.05;
      base.torsoPitch = -0.28;
      base.headPitch = -0.18;
      base.torsoYaw = Math.sin(time * 4) * 0.08;
      base.armLAngle = [-2.85, 0.25, -0.35];
      base.armRAngle = [-2.85, -0.25, 0.35];
      base.elbowL = -0.25;
      base.elbowR = -0.25;
      base.legLAngle = [-0.25, 0, -0.1];
      base.kneeL = 0.45;
      base.legRAngle = [0.35, 0, 0.1];
      base.kneeR = 0.65;
      base.auraOpacity = 1.0;
    } else {
      base.torsoPitch = actor.fighterId === 'jm' ? -0.12 : 0.28;
      base.torsoYaw = 0.55 * swingEnv;
      base.armLAngle = [-1.62, 0.1, -0.12];
      base.armRAngle = [-1.62, -0.1, 0.12];
      base.elbowL = -0.12;
      base.elbowR = -0.12;
      base.auraOpacity = 1.0;
    }
  } else if (actor.actionState === 'stagger') {
    base.eyeState = 'shock';
    if (actor.isStunned) {
      base.hipY -= 0.24;
      base.torsoPitch = 0.45;
      base.torsoRoll = Math.sin(time * 10) * 0.16;
      base.headPitch = 0.35;
      base.kneeL = 0.7;
      base.kneeR = 0.7;
      base.armLAngle = [-0.2, 0, -0.65];
      base.armRAngle = [-0.2, 0, 0.65];
    } else {
      base.leanX = -0.42 * swingEnv;
      base.torsoPitch = -0.35 * swingEnv;
      base.armLAngle = [-1.1 * swingEnv - 0.2, 0, -0.6];
      base.armRAngle = [-1.1 * swingEnv - 0.2, 0, 0.6];
      base.squash = 1.0 - 0.12 * swingEnv;
    }
  }

  return base;
}
