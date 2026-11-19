import * as THREE from 'three';
import {
  AbilityAimKind,
  ArenaActorState,
  ArenaPickup,
  ArenaZoneState,
  AwakeningCutsceneState,
  AwakeningOrbState,
  BattlefieldEventState,
  CombatEvent,
  FighterId,
  MapId,
  ProjectileState,
  TelegraphState,
  getMapTerrainHeight,
} from '../shared/gameData.ts';
import { AWAKENING_CONFIG } from '../shared/awakeningConfig.ts';

export interface AimPreviewState {
  active: boolean;
  cancelled: boolean;
  aimKind: AbilityAimKind;
  originX: number;
  originY?: number;
  originZ: number;
  aimX: number;
  aimZ: number;
  radius: number;
  range: number;
  colorHex: number;
}

interface GlowHaloItem {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
  baseScale: number;
  peakOpacity: number;
}

interface ShockwaveItem {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  age: number;
  maxAge: number;
  startScale: number;
  maxRadius: number;
  reverse?: boolean;
}

interface SlashItem {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
  spinSpeed: number;
  growSpeed: number;
}

interface CoreFlashItem {
  mesh: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
  peakScale: number;
}

interface FunnelItem {
  mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
  spinSpeed: number;
  startScaleX: number;
  endScaleX: number;
  scaleY: number;
  baseY: number;
}

interface TracerItem {
  mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
  startScaleX: number;
}

interface SparkItem {
  mesh: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  life: number;
  maxLife: number;
  orientToVel: boolean;
}

interface PuffItem {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  startScale: number;
  endScale: number;
  baseOpacity: number;
}

interface CrackItem {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
}

interface CasingItem {
  mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  floorY: number;
}

interface VortexDebrisItem {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  centerX: number;
  centerY: number;
  centerZ: number;
  angle: number;
  radius: number;
  inwardSpeed: number;
  angularSpeed: number;
  heightOffset: number;
  life: number;
  maxLife: number;
}

interface GhostItem {
  mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  baseOpacity: number;
}

interface BeamItem {
  mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  coilA: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>;
  coilB: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
}

interface PillarItem {
  mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
  baseScale: number;
}

interface StormCloudItem {
  group: THREE.Group;
  life: number;
  maxLife: number;
}

interface GlyphItem {
  group: THREE.Group;
  life: number;
  maxLife: number;
}

interface TetherItem {
  mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
}

interface SpellSigilItem {
  group: THREE.Group;
  life: number;
  maxLife: number;
  baseScale: number;
}

interface DelayedTask {
  delay: number;
  run: () => void;
}

interface PickupVisual {
  group: THREE.Group;
  orb: THREE.Mesh;
  ring: THREE.Mesh;
}

interface AwakeningOrbVisual {
  group: THREE.Group;
  crystal: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshStandardMaterial>;
  ringA: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  ringB: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  column: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  haloSprite: THREE.Sprite;
  labelSprite: THREE.Sprite;
  pointLight: THREE.PointLight;
  particles: Array<{ mesh: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshBasicMaterial>; phase: number; radius: number; speed: number }>;
}

const _tmpV1 = new THREE.Vector3();
const _tmpV2 = new THREE.Vector3();
const _tmpDir = new THREE.Vector3();
const _upVec = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();

function createHelixTubeGeometry(turns: number, radius: number, length: number): THREE.TubeGeometry {
  const pts: THREE.Vector3[] = [];
  const segs = 48;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const ang = t * Math.PI * 2 * turns;
    pts.push(new THREE.Vector3(Math.cos(ang) * radius, Math.sin(ang) * radius, t * length));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  return new THREE.TubeGeometry(curve, 52, 0.14, 6, false);
}

export class VFXManager {
  private scene: THREE.Scene;
  private shockwaves: ShockwaveItem[] = [];
  private slashes: SlashItem[] = [];
  private coreFlashes: CoreFlashItem[] = [];
  private funnels: FunnelItem[] = [];
  private tracers: TracerItem[] = [];
  private sparks: SparkItem[] = [];
  private puffs: PuffItem[] = [];
  private cracks: CrackItem[] = [];
  private casings: CasingItem[] = [];
  private vortexDebris: VortexDebrisItem[] = [];
  private ghosts: GhostItem[] = [];
  private beams: BeamItem[] = [];
  private pillars: PillarItem[] = [];
  private stormClouds: StormCloudItem[] = [];
  private markGlyphs: GlyphItem[] = [];
  private spellSigils: SpellSigilItem[] = [];
  private tethers: TetherItem[] = [];
  private glowHalos: GlowHaloItem[] = [];
  private delayedTasks: DelayedTask[] = [];
  private elapsedTime = 0;

  private projMeshes = new Map<string, THREE.Mesh>();
  private projMaterials = new Map<string, THREE.MeshBasicMaterial>();
  private lassoTetherMat: THREE.MeshBasicMaterial;
  private projTethers = new Map<string, THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>>();
  private chargingFireballs = new Map<
    string,
    { group: THREE.Group; core: THREE.Mesh; aura: THREE.Mesh; halo: THREE.Mesh }
  >();
  private actorPositions = new Map<string, { x: number; y: number; z: number }>();
  private pickupVisuals = new Map<string, PickupVisual>();
  private awakeningOrbVisuals = new Map<string, AwakeningOrbVisual>();
  private isMobileDevice =
    typeof window !== 'undefined' && (window.innerWidth <= 900 || navigator.maxTouchPoints > 0);
  private zoneVisuals = new Map<
    string,
    {
      group: THREE.Group;
      ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
      disc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
      extra: THREE.Mesh;
    }
  >();
  private telegraphVisuals = new Map<
    string,
    {
      group: THREE.Group;
      border: THREE.Mesh;
      fill: THREE.Mesh;
      rune: THREE.Mesh;
      kind: TelegraphState['kind'];
    }
  >();

  // Cutscene 3D Clash Beams & Collision Core
  private cutsceneClashGroup: THREE.Group;
  private cutsceneP1Beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private cutsceneP2Beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private cutsceneCore: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private cutsceneCoreRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private clashSparkTimer = 0;

  // Aiming preview reticle (Hold-Drag)
  private aimGroup: THREE.Group;
  private aimPointRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private aimPointInner: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private aimPointDisc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private aimLineStrip: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private aimLineArrow: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
  private aimLineOriginRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private aimConeWedge: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private aimDropLine: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;

  // Battlefield Event 3D zone visual
  private eventGroup: THREE.Group;
  private eventOuterRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private eventInnerDisc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;

  // 2-Minute Shrinking Storm Barrier visual
  private stormGroup: THREE.Group;
  private stormWall: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private stormRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;

  private shockCursor = 0;
  private slashCursor = 0;
  private flashCursor = 0;
  private funnelCursor = 0;
  private tracerCursor = 0;
  private sparkCursor = 0;
  private puffCursor = 0;
  private crackCursor = 0;
  private casingCursor = 0;
  private debrisCursor = 0;
  private ghostCursor = 0;
  private beamCursor = 0;
  private pillarCursor = 0;
  private cloudCursor = 0;
  private glyphCursor = 0;
  private sigilCursor = 0;
  private tetherCursor = 0;
  private lightCursor = 0;

  // Shared Geometries (disposed cleanly on dispose())
  private sharedGeos: THREE.BufferGeometry[] = [];
  private bulletGeo: THREE.SphereGeometry;
  private magnumGeo: THREE.CylinderGeometry;
  private lassoGeo: THREE.TorusGeometry;
  private crescentGeo: THREE.RingGeometry;
  private tornadoGeo: THREE.CylinderGeometry;
  private jmBeamGeo: THREE.CylinderGeometry;
  private jmBoltGeo: THREE.SphereGeometry;
  private solarFireballGeo: THREE.SphereGeometry;
  private solarAuraGeo: THREE.SphereGeometry;
  private solarHaloGeo: THREE.TorusGeometry;
  private pickupOrbGeo: THREE.OctahedronGeometry;
  private pickupRingGeo: THREE.RingGeometry;
  private tetherGeo: THREE.CylinderGeometry;
  private zoneRingGeo: THREE.RingGeometry;
  private zoneDiscGeo: THREE.CircleGeometry;
  private runeOctGeo: THREE.RingGeometry;
  private decoySilhouetteGeo: THREE.CylinderGeometry;
  private tripwireBarGeo: THREE.CylinderGeometry;
  private unitPlaneGeo: THREE.PlaneGeometry;
  private coneWedgeGeo: THREE.CircleGeometry;
  private orbCrystalGeo: THREE.OctahedronGeometry;
  private orbRingGeo: THREE.TorusGeometry;
  private orbColumnGeo: THREE.CylinderGeometry;
  private orbParticleGeo: THREE.OctahedronGeometry;
  private solarRailgunGeo: THREE.CylinderGeometry;
  private windBladeGeo: THREE.RingGeometry;
  private orbLabelTex: THREE.CanvasTexture | null = null;
  private orbGlowTex: THREE.CanvasTexture | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.bulletGeo = new THREE.SphereGeometry(0.16, 8, 8);
    this.magnumGeo = new THREE.CylinderGeometry(0.11, 0.16, 1.8, 8);
    this.magnumGeo.rotateX(Math.PI * 0.5);
    this.lassoGeo = new THREE.TorusGeometry(0.58, 0.065, 8, 22);
    this.crescentGeo = new THREE.RingGeometry(0.7, 1.22, 18, 1, -Math.PI * 0.48, Math.PI * 0.96);
    this.tornadoGeo = new THREE.CylinderGeometry(0.95, 0.24, 2.2, 14, 1, true);
    this.tornadoGeo.translate(0, 0.55, 0);
    this.jmBeamGeo = new THREE.CylinderGeometry(0.32, 0.42, 2.5, 12);
    this.jmBeamGeo.rotateX(Math.PI * 0.5);
    this.jmBoltGeo = new THREE.SphereGeometry(0.28, 10, 8);
    this.solarFireballGeo = new THREE.SphereGeometry(1.65, 20, 16);
    this.solarAuraGeo = new THREE.SphereGeometry(2.15, 18, 14);
    this.solarHaloGeo = new THREE.TorusGeometry(2.45, 0.12, 8, 32);
    this.pickupOrbGeo = new THREE.OctahedronGeometry(0.32, 0);
    this.pickupRingGeo = new THREE.RingGeometry(0.42, 0.55, 20);
    this.tetherGeo = new THREE.CylinderGeometry(0.035, 0.035, 1.0, 6);
    this.tetherGeo.rotateX(Math.PI * 0.5);
    this.zoneRingGeo = new THREE.RingGeometry(0.84, 1.0, 36);
    this.zoneDiscGeo = new THREE.CircleGeometry(0.84, 36);
    this.runeOctGeo = new THREE.RingGeometry(0.62, 0.78, 8);
    this.decoySilhouetteGeo = new THREE.CylinderGeometry(0.26, 0.34, 1.65, 10);
    this.tripwireBarGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.0, 8);
    this.tripwireBarGeo.rotateX(Math.PI * 0.5);
    this.unitPlaneGeo = new THREE.PlaneGeometry(1.0, 1.0);
    this.unitPlaneGeo.rotateX(-Math.PI * 0.5);
    this.unitPlaneGeo.translate(0, 0, 0.5);
    this.coneWedgeGeo = new THREE.CircleGeometry(1.0, 24, -0.38, 0.76);
    this.coneWedgeGeo.rotateX(-Math.PI * 0.5);
    this.coneWedgeGeo.rotateY(-Math.PI * 0.5);

    const ringGeo = new THREE.RingGeometry(0.82, 1.0, 32);
    const slashGeo = new THREE.RingGeometry(0.9, 1.45, 24, 1, 0, Math.PI * 0.95);
    const flashGeo = new THREE.OctahedronGeometry(0.42, 0);
    const funnelGeo = new THREE.CylinderGeometry(1.1, 0.24, 2.1, 20, 1, true);
    funnelGeo.translate(0, 1.05, 0);
    const tracerGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.0, 6);
    tracerGeo.rotateX(Math.PI * 0.5);
    const sparkGeo = new THREE.ConeGeometry(0.06, 0.65, 5);
    sparkGeo.translate(0, 0.32, 0);
    const puffGeo = new THREE.SphereGeometry(0.32, 9, 8);
    const crackGeo = new THREE.PlaneGeometry(0.18, 1.8);
    crackGeo.rotateX(-Math.PI * 0.5);
    const casingGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.11, 6);
    const debrisGeo = new THREE.BoxGeometry(0.14, 0.04, 0.22);
    const ghostGeo = new THREE.CylinderGeometry(0.24, 0.3, 1.6, 8);
    const beamGeo = new THREE.CylinderGeometry(0.4, 0.4, 16.0, 16, 1, true);
    beamGeo.rotateX(Math.PI * 0.5);
    beamGeo.translate(0, 0, 8.0);
    const coilGeoA = createHelixTubeGeometry(3.2, 0.85, 16.0);
    const coilGeoB = createHelixTubeGeometry(3.2, 0.85, 16.0);
    coilGeoB.rotateZ(Math.PI);
    const pillarGeo = new THREE.CylinderGeometry(0.45, 0.82, 8.5, 14, 1, true);
    pillarGeo.translate(0, 4.25, 0);
    const cloudPuffGeo = new THREE.DodecahedronGeometry(2.4, 1);
    const glyphRingGeo = new THREE.RingGeometry(0.42, 0.54, 4);
    const aimArrowGeo = new THREE.ConeGeometry(0.75, 1.3, 4);
    aimArrowGeo.rotateX(Math.PI * 0.5);
    const glowHaloGeo = new THREE.SphereGeometry(1.1, 10, 8);

    this.lassoTetherMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.orbCrystalGeo = new THREE.OctahedronGeometry(0.68, 0);
    this.orbRingGeo = new THREE.TorusGeometry(1.18, 0.055, 8, 28);
    this.orbColumnGeo = new THREE.CylinderGeometry(0.65, 1.05, 14.0, 16, 1, true);
    this.orbColumnGeo.translate(0, 7.0, 0);
    this.orbParticleGeo = new THREE.OctahedronGeometry(0.11, 0);
    this.solarRailgunGeo = new THREE.CylinderGeometry(0.16, 0.24, 5.2, 8);
    this.solarRailgunGeo.rotateX(Math.PI * 0.5);
    this.windBladeGeo = new THREE.RingGeometry(1.05, 1.65, 22, 1, -Math.PI * 0.45, Math.PI * 0.9);

    if (typeof document !== 'undefined') {
      const lblCanvas = document.createElement('canvas');
      lblCanvas.width = 512;
      lblCanvas.height = 128;
      const ctx = lblCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, 512, 128);
        ctx.font = '900 58px "Bangers", "Impact", "Arial Black", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.shadowColor = 'rgba(56, 189, 248, 0.95)';
        ctx.shadowBlur = 18;
        ctx.strokeStyle = '#09090b';
        ctx.lineWidth = 10;
        ctx.strokeText('AWAKENING', 256, 66);
        const grad = ctx.createLinearGradient(0, 26, 0, 102);
        grad.addColorStop(0, '#fef08a');
        grad.addColorStop(0.5, '#ffffff');
        grad.addColorStop(1, '#38bdf8');
        ctx.fillStyle = grad;
        ctx.fillText('AWAKENING', 256, 66);
      }
      this.orbLabelTex = new THREE.CanvasTexture(lblCanvas);
      this.orbLabelTex.needsUpdate = true;

      const glowCanvas = document.createElement('canvas');
      glowCanvas.width = 128;
      glowCanvas.height = 128;
      const gCtx = glowCanvas.getContext('2d');
      if (gCtx) {
        const rad = gCtx.createRadialGradient(64, 64, 4, 64, 64, 62);
        rad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
        rad.addColorStop(0.32, 'rgba(250, 204, 21, 0.65)');
        rad.addColorStop(0.68, 'rgba(56, 189, 248, 0.25)');
        rad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        gCtx.fillStyle = rad;
        gCtx.fillRect(0, 0, 128, 128);
      }
      this.orbGlowTex = new THREE.CanvasTexture(glowCanvas);
      this.orbGlowTex.needsUpdate = true;
    }

    // Cutscene 3D Clash group (shown during 0:15 - 0:18 tug-of-war clash)
    this.cutsceneClashGroup = new THREE.Group();
    this.cutsceneClashGroup.visible = false;
    const clashBeamGeo = new THREE.CylinderGeometry(0.38, 0.54, 1.0, 14, 1, true);
    clashBeamGeo.rotateZ(Math.PI * 0.5);
    this.cutsceneP1Beam = new THREE.Mesh(
      clashBeamGeo,
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.86,
        side: THREE.FrontSide,
        blending: THREE.NormalBlending,
        depthWrite: false,
      })
    );
    this.cutsceneP2Beam = new THREE.Mesh(
      clashBeamGeo,
      new THREE.MeshBasicMaterial({
        color: 0xf43f5e,
        transparent: true,
        opacity: 0.86,
        side: THREE.FrontSide,
        blending: THREE.NormalBlending,
        depthWrite: false,
      })
    );
    const clashCoreGeo = new THREE.SphereGeometry(0.78, 16, 14);
    this.cutsceneCore = new THREE.Mesh(
      clashCoreGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.94,
        blending: THREE.NormalBlending,
        depthWrite: false,
      })
    );
    const clashRingGeo = new THREE.TorusGeometry(1.5, 0.16, 8, 28);
    this.cutsceneCoreRing = new THREE.Mesh(
      clashRingGeo,
      new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        transparent: true,
        opacity: 0.92,
        blending: THREE.NormalBlending,
        depthWrite: false,
      })
    );
    this.cutsceneClashGroup.add(this.cutsceneP1Beam, this.cutsceneP2Beam, this.cutsceneCore, this.cutsceneCoreRing);
    scene.add(this.cutsceneClashGroup);

    this.sharedGeos.push(
      this.bulletGeo,
      this.magnumGeo,
      this.lassoGeo,
      this.crescentGeo,
      this.tornadoGeo,
      this.jmBeamGeo,
      this.jmBoltGeo,
      this.solarFireballGeo,
      this.solarAuraGeo,
      this.solarHaloGeo,
      this.pickupOrbGeo,
      this.pickupRingGeo,
      this.tetherGeo,
      this.zoneRingGeo,
      this.zoneDiscGeo,
      this.runeOctGeo,
      this.decoySilhouetteGeo,
      this.tripwireBarGeo,
      this.unitPlaneGeo,
      this.coneWedgeGeo,
      this.orbCrystalGeo,
      this.orbRingGeo,
      this.orbColumnGeo,
      this.orbParticleGeo,
      this.solarRailgunGeo,
      this.windBladeGeo,
      clashBeamGeo,
      clashCoreGeo,
      clashRingGeo,
      ringGeo,
      slashGeo,
      flashGeo,
      funnelGeo,
      tracerGeo,
      sparkGeo,
      puffGeo,
      crackGeo,
      casingGeo,
      debrisGeo,
      ghostGeo,
      beamGeo,
      coilGeoA,
      coilGeoB,
      pillarGeo,
      cloudPuffGeo,
      glyphRingGeo,
      aimArrowGeo,
      glowHaloGeo
    );

    for (let i = 0; i < 16; i++) {
      const mesh = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      mesh.rotation.x = -Math.PI * 0.5;
      mesh.visible = false;
      scene.add(mesh);
      this.shockwaves.push({ mesh, age: 0, maxAge: 0.5, startScale: 0.5, maxRadius: 5 });
    }

    for (let i = 0; i < 18; i++) {
      const mesh = new THREE.Mesh(
        slashGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      mesh.visible = false;
      scene.add(mesh);
      this.slashes.push({ mesh, life: 0, maxLife: 0.24, spinSpeed: 0, growSpeed: 0.8 });
    }

    for (let i = 0; i < 14; i++) {
      const mesh = new THREE.Mesh(
        flashGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      mesh.visible = false;
      scene.add(mesh);
      this.coreFlashes.push({ mesh, life: 0, maxLife: 0.14, peakScale: 1.5 });
    }

    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(
        funnelGeo,
        new THREE.MeshBasicMaterial({
          color: 0x2dd4bf,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      mesh.visible = false;
      scene.add(mesh);
      this.funnels.push({
        mesh,
        life: 0,
        maxLife: 0.5,
        spinSpeed: 14,
        startScaleX: 0.8,
        endScaleX: 2.2,
        scaleY: 1.4,
        baseY: 0,
      });
    }

    for (let i = 0; i < 14; i++) {
      const mesh = new THREE.Mesh(
        tracerGeo,
        new THREE.MeshBasicMaterial({
          color: 0xfef08a,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      mesh.visible = false;
      scene.add(mesh);
      this.tracers.push({ mesh, life: 0, maxLife: 0.2, startScaleX: 1.0 });
    }

    for (let i = 0; i < 26; i++) {
      const mesh = new THREE.Mesh(
        sparkGeo,
        new THREE.MeshBasicMaterial({
          color: 0xfef08a,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      mesh.visible = false;
      scene.add(mesh);
      this.sparks.push({
        mesh,
        vx: 0,
        vy: 0,
        vz: 0,
        gravity: 14,
        life: 0,
        maxLife: 0.32,
        orientToVel: true,
      });
    }

    for (let i = 0; i < 14; i++) {
      const mesh = new THREE.Mesh(
        puffGeo,
        new THREE.MeshBasicMaterial({
          color: 0xcbd5e1,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        })
      );
      mesh.visible = false;
      scene.add(mesh);
      this.puffs.push({
        mesh,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 0.55,
        startScale: 0.5,
        endScale: 1.6,
        baseOpacity: 0.5,
      });
    }

    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(
        crackGeo,
        new THREE.MeshBasicMaterial({
          color: 0xf97316,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        })
      );
      mesh.visible = false;
      scene.add(mesh);
      this.cracks.push({ mesh, life: 0, maxLife: 0.85 });
    }

    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      metalness: 0.9,
      roughness: 0.22,
      transparent: true,
      opacity: 1,
    });
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(casingGeo, brassMat.clone());
      mesh.visible = false;
      scene.add(mesh);
      this.casings.push({ mesh, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0.65, floorY: 0 });
    }
    brassMat.dispose();

    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(
        debrisGeo,
        new THREE.MeshBasicMaterial({
          color: 0x5eead4,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
        })
      );
      mesh.visible = false;
      scene.add(mesh);
      this.vortexDebris.push({
        mesh,
        centerX: 0,
        centerY: 0,
        centerZ: 0,
        angle: 0,
        radius: 3,
        inwardSpeed: 5,
        angularSpeed: 9,
        heightOffset: 0.5,
        life: 0,
        maxLife: 0.45,
      });
    }

    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(
        ghostGeo,
        new THREE.MeshBasicMaterial({
          color: 0x2dd4bf,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      mesh.visible = false;
      scene.add(mesh);
      this.ghosts.push({ mesh, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0.3, baseOpacity: 0.55 });
    }

    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(
        beamGeo,
        new THREE.MeshBasicMaterial({
          color: 0xfef9c3,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      const coilA = new THREE.Mesh(
        coilGeoA,
        new THREE.MeshBasicMaterial({
          color: 0xfacc15,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      const coilB = new THREE.Mesh(
        coilGeoB,
        new THREE.MeshBasicMaterial({
          color: 0xfef08a,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      mesh.add(coilA, coilB);
      mesh.visible = false;
      scene.add(mesh);
      this.beams.push({ mesh, coilA, coilB, life: 0, maxLife: 0.65 });
    }

    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(
        pillarGeo,
        new THREE.MeshBasicMaterial({
          color: 0xfacc15,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      mesh.visible = false;
      scene.add(mesh);
      this.pillars.push({ mesh, life: 0, maxLife: 0.55, baseScale: 1.0 });
    }

    for (let i = 0; i < 3; i++) {
      const group = new THREE.Group();
      for (let c = 0; c < 6; c++) {
        const ang = (c / 6) * Math.PI * 2;
        const puff = new THREE.Mesh(
          cloudPuffGeo,
          new THREE.MeshBasicMaterial({
            color: 0x0f172a,
            transparent: true,
            opacity: 0.72,
            depthWrite: false,
          })
        );
        puff.position.set(Math.cos(ang) * 4.5, (c % 2) * 1.1, Math.sin(ang) * 4.5);
        puff.scale.set(1.4, 0.55, 1.4);
        group.add(puff);
      }
      group.visible = false;
      scene.add(group);
      this.stormClouds.push({ group, life: 0, maxLife: 1.6 });
    }

    for (let i = 0; i < 4; i++) {
      const group = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({
        color: 0xc084fc,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const r1 = new THREE.Mesh(glyphRingGeo, mat);
      const r2 = new THREE.Mesh(glyphRingGeo, mat.clone());
      r2.rotation.z = Math.PI * 0.25;
      r2.scale.setScalar(0.68);
      group.add(r1, r2);
      group.visible = false;
      scene.add(group);
      this.markGlyphs.push({ group, life: 0, maxLife: 0.85 });
    }

    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(
        this.tetherGeo,
        new THREE.MeshBasicMaterial({
          color: 0xfacc15,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      mesh.visible = false;
      scene.add(mesh);
      this.tethers.push({ mesh, life: 0, maxLife: 0.35 });
    }

    for (let i = 0; i < 6; i++) {
      const group = new THREE.Group();
      const mat1 = new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const outer = new THREE.Mesh(this.runeOctGeo, mat1);
      outer.rotation.x = -Math.PI * 0.5;
      const inner = new THREE.Mesh(glyphRingGeo, mat1.clone());
      inner.rotation.x = -Math.PI * 0.5;
      inner.scale.setScalar(0.92);
      group.add(outer, inner);
      group.visible = false;
      scene.add(group);
      this.spellSigils.push({ group, life: 0, maxLife: 0.55, baseScale: 2.2 });
    }

    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(
        glowHaloGeo,
        new THREE.MeshBasicMaterial({
          color: 0xfacc15,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      mesh.visible = false;
      scene.add(mesh);
      this.glowHalos.push({ mesh, life: 0, maxLife: 0.25, baseScale: 1.5, peakOpacity: 0.45 });
    }

    this.eventGroup = new THREE.Group();
    this.eventOuterRing = new THREE.Mesh(
      new THREE.RingGeometry(0.88, 1.0, 48),
      new THREE.MeshBasicMaterial({
        color: 0xf43f5e,
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.eventOuterRing.rotation.x = -Math.PI * 0.5;
    this.eventInnerDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.88, 48),
      new THREE.MeshBasicMaterial({
        color: 0xf43f5e,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.eventInnerDisc.rotation.x = -Math.PI * 0.5;
    this.eventGroup.add(this.eventOuterRing, this.eventInnerDisc);
    this.eventGroup.visible = false;
    scene.add(this.eventGroup);

    // 2-Minute Shrinking Storm Barrier Wall & Perimeter Ring
    this.stormGroup = new THREE.Group();
    this.stormWall = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 4.4, 64, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xf43f5e,
        transparent: true,
        opacity: 0.24,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.stormWall.position.y = 2.2;
    this.stormRing = new THREE.Mesh(
      new THREE.RingGeometry(0.94, 1.0, 64),
      new THREE.MeshBasicMaterial({
        color: 0xfb7185,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.stormRing.rotation.x = -Math.PI * 0.5;
    this.stormRing.position.y = 0.14;
    this.stormGroup.add(this.stormWall, this.stormRing);
    this.stormGroup.visible = false;
    scene.add(this.stormGroup);

    // Pre-allocated Hold-Drag Ground Aim Reticle (Mobile Legends-style)
    this.aimGroup = new THREE.Group();
    this.aimPointRing = new THREE.Mesh(
      this.zoneRingGeo,
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      })
    );
    this.aimPointRing.rotation.x = -Math.PI * 0.5;
    this.aimPointInner = new THREE.Mesh(
      this.runeOctGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      })
    );
    this.aimPointInner.rotation.x = -Math.PI * 0.5;
    this.aimPointDisc = new THREE.Mesh(
      this.zoneDiscGeo,
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    );
    this.aimPointDisc.rotation.x = -Math.PI * 0.5;
    this.aimLineStrip = new THREE.Mesh(
      this.unitPlaneGeo,
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    );
    this.aimLineArrow = new THREE.Mesh(
      aimArrowGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.aimLineOriginRing = new THREE.Mesh(
      this.zoneRingGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    );
    this.aimLineOriginRing.rotation.x = -Math.PI * 0.5;
    this.aimConeWedge = new THREE.Mesh(
      this.coneWedgeGeo,
      new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        transparent: true,
        opacity: 0.38,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    );
    this.aimGroup.add(
      this.aimPointRing,
      this.aimPointInner,
      this.aimPointDisc,
      this.aimLineStrip,
      this.aimLineArrow,
      this.aimLineOriginRing,
      this.aimConeWedge
    );
    this.aimGroup.visible = false;
    scene.add(this.aimGroup);

    this.aimDropLine = new THREE.Mesh(
      this.tetherGeo,
      new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.aimDropLine.visible = false;
    scene.add(this.aimDropLine);
  }

  public spawnPointLightFlash(x: number, y: number, z: number, colorHex: number, intensity = 7.5, duration = 0.26, distance = 14): void {
    const halo = this.glowHalos[this.lightCursor % this.glowHalos.length];
    this.lightCursor++;
    const scale = THREE.MathUtils.clamp(distance * 0.14, 1.1, 3.4);
    const peakOpacity = THREE.MathUtils.clamp(intensity * 0.048, 0.24, 0.52);
    halo.mesh.position.set(x, y, z);
    halo.mesh.scale.setScalar(scale);
    halo.mesh.material.color.setHex(colorHex);
    halo.mesh.material.opacity = peakOpacity;
    halo.mesh.visible = true;
    halo.baseScale = scale;
    halo.peakOpacity = peakOpacity;
    halo.life = duration;
    halo.maxLife = duration;
  }

  public setActorPosition(playerId: string, x: number, y: number, z: number): void {
    this.actorPositions.set(playerId, { x, y, z });
  }

  // LAYER 1: CORE FLASH
  public spawnCoreFlash(x: number, y: number, z: number, colorHex: number, peakScale = 1.6, duration = 0.14): void {
    const fl = this.coreFlashes[this.flashCursor % this.coreFlashes.length];
    this.flashCursor++;
    fl.mesh.position.set(x, y, z);
    fl.mesh.rotation.set(Math.random() * 2, Math.random() * 2, Math.random() * 2);
    fl.mesh.scale.setScalar(0.35);
    fl.mesh.material.color.setHex(colorHex);
    fl.mesh.material.opacity = 1.0;
    fl.mesh.visible = true;
    fl.life = duration;
    fl.maxLife = duration;
    fl.peakScale = peakScale;
  }

  // LAYER 2: SHAPE LAYER HELPERS
  public spawnShockwave(
    x: number,
    y: number,
    z: number,
    colorHex: number,
    maxRadius = 6.0,
    duration = 0.48,
    tiltX = -Math.PI * 0.5,
    reverse = false
  ): void {
    const sw = this.shockwaves[this.shockCursor % this.shockwaves.length];
    this.shockCursor++;
    sw.mesh.position.set(x, y + 0.08, z);
    sw.mesh.rotation.set(tiltX, 0, Math.random() * Math.PI);
    sw.mesh.material.color.setHex(colorHex);
    sw.mesh.material.opacity = 0.9;
    sw.startScale = reverse ? maxRadius : 0.45;
    sw.mesh.scale.setScalar(sw.startScale);
    sw.mesh.visible = true;
    sw.age = 0.001;
    sw.maxAge = duration;
    sw.maxRadius = maxRadius;
    sw.reverse = reverse;
  }

  public spawnSlash(
    x: number,
    y: number,
    z: number,
    rotY: number,
    colorHex: number,
    scale = 1.3,
    tilt = Math.PI * 0.42,
    spinSpeed = 0,
    rollZ = (Math.random() - 0.5) * 0.55,
    duration = 0.24
  ): void {
    const sl = this.slashes[this.slashCursor % this.slashes.length];
    this.slashCursor++;
    sl.mesh.position.set(x, y, z);
    sl.mesh.rotation.set(tilt, rotY, rollZ);
    sl.mesh.scale.setScalar(scale);
    sl.mesh.material.color.setHex(colorHex);
    sl.mesh.material.opacity = 0.96;
    sl.mesh.visible = true;
    sl.life = duration;
    sl.maxLife = duration;
    sl.spinSpeed = spinSpeed;
    sl.growSpeed = scale * 0.85;
  }

  public spawnFunnel(
    x: number,
    y: number,
    z: number,
    colorHex: number,
    startScaleX: number,
    endScaleX: number,
    scaleY: number,
    duration = 0.48,
    spinSpeed = 16
  ): void {
    const fn = this.funnels[this.funnelCursor % this.funnels.length];
    this.funnelCursor++;
    fn.mesh.position.set(x, y, z);
    fn.mesh.scale.set(startScaleX, scaleY, startScaleX);
    fn.mesh.material.color.setHex(colorHex);
    fn.mesh.material.opacity = 0.82;
    fn.mesh.visible = true;
    fn.life = duration;
    fn.maxLife = duration;
    fn.spinSpeed = spinSpeed;
    fn.startScaleX = startScaleX;
    fn.endScaleX = endScaleX;
    fn.scaleY = scaleY;
    fn.baseY = y;
  }

  public spawnTracer(
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
    colorHex: number,
    thickness = 1.0,
    duration = 0.22
  ): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.08) return;
    const tr = this.tracers[this.tracerCursor % this.tracers.length];
    this.tracerCursor++;
    tr.mesh.position.set((x1 + x2) * 0.5, (y1 + y2) * 0.5, (z1 + z2) * 0.5);
    _tmpV1.set(x1, y1, z1);
    _tmpV2.set(x2, y2, z2);
    tr.mesh.lookAt(_tmpV2);
    tr.mesh.scale.set(thickness, thickness, len);
    tr.mesh.material.color.setHex(colorHex);
    tr.mesh.material.opacity = 0.94;
    tr.mesh.visible = true;
    tr.life = duration;
    tr.maxLife = duration;
    tr.startScaleX = thickness;
  }

  public spawnPillar(x: number, y: number, z: number, colorHex: number, scale = 1.0, duration = 0.45): void {
    const clampedScale = Math.min(scale, 1.45);
    const pl = this.pillars[this.pillarCursor % this.pillars.length];
    this.pillarCursor++;
    pl.mesh.position.set(x, y, z);
    pl.mesh.scale.set(clampedScale, 1.0, clampedScale);
    pl.mesh.material.color.setHex(colorHex);
    pl.mesh.material.opacity = 0.32;
    pl.mesh.visible = true;
    pl.life = duration;
    pl.maxLife = duration;
    pl.baseScale = clampedScale;
  }

  public spawnBeam(x: number, y: number, z: number, dirX: number, dirZ: number, colorHex: number): void {
    const b = this.beams[this.beamCursor % this.beams.length];
    this.beamCursor++;
    b.mesh.position.set(x, y, z);
    b.mesh.rotation.set(0, Math.atan2(dirX, dirZ), 0);
    b.mesh.material.color.setHex(0xfef9c3);
    b.mesh.material.opacity = 0.68;
    b.coilA.material.color.setHex(colorHex);
    b.coilB.material.color.setHex(0xffffff);
    b.coilA.material.opacity = 0.72;
    b.coilB.material.opacity = 0.65;
    b.mesh.scale.set(1.15, 1.15, 1.0);
    b.mesh.visible = true;
    b.life = 0.58;
    b.maxLife = 0.58;
  }

  public spawnGhost(
    x: number,
    y: number,
    z: number,
    colorHex: number,
    vx = 0,
    vy = 0,
    vz = 0,
    duration = 0.28,
    opacity = 0.6
  ): void {
    const g = this.ghosts[this.ghostCursor % this.ghosts.length];
    this.ghostCursor++;
    g.mesh.position.set(x, y + 0.85, z);
    g.mesh.material.color.setHex(colorHex);
    g.mesh.material.opacity = opacity;
    g.mesh.scale.setScalar(1.0);
    g.mesh.visible = true;
    g.vx = vx;
    g.vy = vy;
    g.vz = vz;
    g.life = duration;
    g.maxLife = duration;
    g.baseOpacity = opacity;
  }

  // LAYER 3: DISSIPATION HELPERS
  public spawnSparks(
    x: number,
    y: number,
    z: number,
    colorHex: number,
    count = 8,
    speedBoost = 1.0,
    gravity = 14,
    duration = 0.32
  ): void {
    const clampedCount = this.isMobileDevice ? Math.min(count, 4) : Math.min(count, 8);
    for (let i = 0; i < clampedCount; i++) {
      const sp = this.sparks[this.sparkCursor % this.sparks.length];
      this.sparkCursor++;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const spd = (5 + Math.random() * 7.5) * speedBoost;
      sp.vx = Math.sin(phi) * Math.cos(theta) * spd;
      sp.vy = Math.abs(Math.cos(phi)) * spd + 1.4;
      sp.vz = Math.sin(phi) * Math.sin(theta) * spd;
      sp.gravity = gravity;
      sp.mesh.position.set(x, y, z);
      _tmpV1.set(sp.vx, sp.vy, sp.vz).normalize();
      sp.mesh.quaternion.setFromUnitVectors(_upVec, _tmpV1);
      sp.mesh.scale.setScalar(0.85 + Math.random() * 0.45);
      sp.mesh.material.color.setHex(colorHex);
      sp.mesh.material.opacity = 1.0;
      sp.mesh.visible = true;
      sp.life = duration;
      sp.maxLife = duration;
      sp.orientToVel = true;
    }
  }

  public spawnPuffs(
    x: number,
    y: number,
    z: number,
    colorHex: number,
    count = 6,
    spread = 0.8,
    riseSpeed = 1.8,
    startScale = 0.55,
    endScale = 1.65,
    duration = 0.55,
    opacity = 0.55
  ): void {
    const clampedCount = this.isMobileDevice ? Math.min(count, 3) : Math.min(count, 5);
    for (let i = 0; i < clampedCount; i++) {
      const pf = this.puffs[this.puffCursor % this.puffs.length];
      this.puffCursor++;
      const ang = Math.random() * Math.PI * 2;
      const spd = (0.5 + Math.random() * 1.4) * spread;
      pf.vx = Math.cos(ang) * spd;
      pf.vy = riseSpeed * (0.65 + Math.random() * 0.7);
      pf.vz = Math.sin(ang) * spd;
      pf.mesh.position.set(x + (Math.random() - 0.5) * 0.5, y + Math.random() * 0.35, z + (Math.random() - 0.5) * 0.5);
      pf.mesh.scale.setScalar(startScale);
      pf.mesh.material.color.setHex(colorHex);
      pf.mesh.material.opacity = opacity;
      pf.mesh.visible = true;
      pf.life = duration;
      pf.maxLife = duration;
      pf.startScale = startScale;
      pf.endScale = endScale;
      pf.baseOpacity = opacity;
    }
  }

  public spawnCracks(x: number, groundY: number, z: number, colorHex: number, count = 5, lengthScale = 1.0, duration = 0.85): void {
    for (let i = 0; i < count; i++) {
      const cr = this.cracks[this.crackCursor % this.cracks.length];
      this.crackCursor++;
      const ang = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.45;
      const dist = 0.75 * lengthScale;
      cr.mesh.position.set(x + Math.sin(ang) * dist, groundY + 0.05, z + Math.cos(ang) * dist);
      cr.mesh.rotation.set(0, ang, 0);
      cr.mesh.scale.set(0.8 + Math.random() * 0.6, 1, lengthScale * (0.7 + Math.random() * 0.5));
      cr.mesh.material.color.setHex(colorHex);
      cr.mesh.material.opacity = 0.92;
      cr.mesh.visible = true;
      cr.life = duration;
      cr.maxLife = duration;
    }
  }

  public spawnCasings(x: number, y: number, z: number, floorY: number, rightX: number, rightZ: number, count = 2): void {
    for (let i = 0; i < count; i++) {
      const cs = this.casings[this.casingCursor % this.casings.length];
      this.casingCursor++;
      cs.mesh.position.set(x, y, z);
      cs.vx = rightX * (2.6 + Math.random() * 1.4) + (Math.random() - 0.5) * 1.2;
      cs.vy = 3.2 + Math.random() * 1.8;
      cs.vz = rightZ * (2.6 + Math.random() * 1.4) + (Math.random() - 0.5) * 1.2;
      cs.floorY = floorY + 0.05;
      cs.life = 0.68;
      cs.maxLife = 0.68;
      (cs.mesh.material as THREE.MeshStandardMaterial).opacity = 1;
      cs.mesh.visible = true;
    }
  }

  public spawnVortexDebris(x: number, y: number, z: number, radius: number, colorHex: number, count = 14): void {
    for (let i = 0; i < count; i++) {
      const db = this.vortexDebris[this.debrisCursor % this.vortexDebris.length];
      this.debrisCursor++;
      db.centerX = x;
      db.centerY = y;
      db.centerZ = z;
      db.angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      db.radius = radius * (0.65 + Math.random() * 0.45);
      db.inwardSpeed = (db.radius / 0.44) * 0.85;
      db.angularSpeed = 9 + Math.random() * 6;
      db.heightOffset = 0.25 + Math.random() * 1.65;
      db.life = 0.44;
      db.maxLife = 0.44;
      db.mesh.material.color.setHex(i % 2 === 0 ? colorHex : 0xa7f3d0);
      db.mesh.material.opacity = 0.92;
      db.mesh.visible = true;
    }
  }

  private spawnStormClouds(x: number, y: number, z: number): void {
    const sc = this.stormClouds[this.cloudCursor % this.stormClouds.length];
    this.cloudCursor++;
    sc.group.position.set(x, y + 10.5, z);
    sc.group.scale.setScalar(1.2);
    sc.life = 1.6;
    sc.maxLife = 1.6;
    sc.group.visible = true;
  }

  private spawnMarkGlyph(x: number, y: number, z: number): void {
    const mg = this.markGlyphs[this.glyphCursor % this.markGlyphs.length];
    this.glyphCursor++;
    mg.group.position.set(x, y + 0.95, z);
    mg.group.scale.setScalar(0.5);
    mg.life = 0.85;
    mg.maxLife = 0.85;
    mg.group.visible = true;
  }

  public spawnRubbleBurst(x: number, groundY: number, z: number, radius = 3.0, colorHex = 0x94a3b8): void {
    this.spawnCoreFlash(x, groundY + 1.2, z, 0xfef08a, 2.4, 0.18);
    this.spawnShockwave(x, groundY + 0.08, z, colorHex, Math.max(4.5, radius * 2.2), 0.48);
    this.spawnShockwave(x, groundY + 0.14, z, 0xfb923c, Math.max(3.2, radius * 1.5), 0.36);
    this.spawnCracks(x, groundY, z, 0x334155, 6, Math.max(1.2, radius * 0.65), 1.45);
    this.spawnPuffs(x, groundY + 0.65, z, 0x64748b, 8, 2.0, 2.8, 0.7, 2.6, 0.72, 0.62);
    this.spawnSparks(x, groundY + 1.1, z, colorHex, 20, 1.45, 16, 0.45);
  }

  public spawnSpellSigil(x: number, groundY: number, z: number, colorHex: number, scale = 2.6, duration = 0.55): void {
    const sg = this.spellSigils[this.sigilCursor % this.spellSigils.length];
    this.sigilCursor++;
    sg.group.position.set(x, groundY + 0.12, z);
    sg.group.scale.setScalar(scale * 0.55);
    sg.baseScale = scale;
    sg.life = duration;
    sg.maxLife = duration;
    sg.group.children.forEach((c, idx) => {
      const mat = (c as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.color.setHex(idx === 0 ? colorHex : 0xffffff);
      mat.opacity = 0.92;
    });
    sg.group.visible = true;
  }

  private spawnTether(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, colorHex: number, duration = 0.35): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.1) return;
    const th = this.tethers[this.tetherCursor % this.tethers.length];
    this.tetherCursor++;
    th.mesh.position.set((x1 + x2) * 0.5, (y1 + y2) * 0.5, (z1 + z2) * 0.5);
    th.mesh.lookAt(x2, y2, z2);
    th.mesh.scale.set(1.4, 1.4, len);
    th.mesh.material.color.setHex(colorHex);
    th.mesh.material.opacity = 0.95;
    th.mesh.visible = true;
    th.life = duration;
    th.maxLife = duration;
  }

  private spawnComboLinkBridge(ev: CombatEvent, mapId: MapId): void {
    if (ev.originX === undefined || ev.originZ === undefined) return;
    const originGround = getMapTerrainHeight(mapId, ev.originX, ev.originZ);
    const destGround = getMapTerrainHeight(mapId, ev.x, ev.z);
    const ox = ev.originX;
    const oy = (ev.originY ?? 1.0) + originGround;
    const oz = ev.originZ;
    const dx = ev.x;
    const dy = ev.y + destGround;
    const dz = ev.z;
    const dist = Math.hypot(dx - ox, dz - oz);
    if (dist < 0.35) return;

    const fId = ev.fighterId;
    const bridgeColor =
      fId === 'marjohn'
        ? 0x5eead4
        : fId === 'prime'
        ? 0xfb923c
        : fId === 'damen'
        ? 0xfef08a
        : fId === 'khen'
        ? 0xc084fc
        : 0xfef9c3;

    // Continuous streaking bridge trail connecting origin -> destination
    this.spawnTracer(ox, oy, oz, dx, dy, dz, bridgeColor, 2.2, 0.32);
    const steps = Math.min(7, Math.max(3, Math.ceil(dist * 1.2)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const mx = THREE.MathUtils.lerp(ox, dx, t);
      const my = THREE.MathUtils.lerp(oy, dy, t);
      const mz = THREE.MathUtils.lerp(oz, dz, t);
      if (fId === 'prime') {
        this.spawnCracks(mx, destGround, mz, 0xf97316, 1, 0.65, 0.7);
        this.spawnSparks(mx, my, mz, 0xfb923c, 2, 0.7, 8, 0.35);
      } else if (fId === 'khen') {
        this.spawnSparks(mx, my, mz, 0xa855f7, 3, 0.8, 4, 0.3);
        if (i % 2 === 0) this.spawnShockwave(mx, my - 0.6, mz, 0x7e22ce, 1.6, 0.28, Math.PI * 0.5);
      } else {
        this.spawnPuffs(mx, my, mz, bridgeColor, 1, 0.4, 1.2, 0.35, 0.9, 0.38, 0.48);
        this.spawnSparks(mx, my, mz, bridgeColor, 2, 0.65, 6, 0.28);
      }
    }
  }

  private handleCastEvent(ev: CombatEvent, mapId: MapId): void {
    const groundY = getMapTerrainHeight(mapId, ev.x, ev.z);
    const wy = groundY + ev.y;
    const fx = ev.dirX ?? 0;
    const fz = ev.dirZ ?? 1;
    const yaw = Math.atan2(fx, fz);
    const rightX = -fz;
    const rightZ = fx;
    const fId = ev.fighterId;
    const slot = ev.abilitySlot ?? 0;

    if (ev.isComboLink) {
      this.spawnComboLinkBridge(ev, mapId);
    }

    // GUARD CASTS
    if (slot === 1) {
      if (fId === 'marjohn') {
        this.spawnCoreFlash(ev.x, wy, ev.z, 0x5eead4, 1.1, 0.14);
        this.spawnShockwave(ev.x, wy - 0.4, ev.z, 0x2dd4bf, 2.2, 0.32);
      } else if (fId === 'prime') {
        this.spawnCoreFlash(ev.x, wy, ev.z, 0xf43f5e, 1.2, 0.12);
      } else if (fId === 'khen') {
        this.spawnSlash(ev.x + fx * 0.45, wy, ev.z + fz * 0.45, yaw, 0xa855f7, 0.85, Math.PI * 0.12, 0, 0.78, 0.26);
        this.spawnSlash(ev.x + fx * 0.45, wy, ev.z + fz * 0.45, yaw, 0xe879f9, 0.85, Math.PI * 0.12, 0, -0.78, 0.26);
      } else {
        this.spawnCoreFlash(ev.x, wy, ev.z, ev.colorHex, 1.1, 0.12);
      }
      return;
    }

    // M1 CASTS (Unique per fighter & 4-hit combos!)
    if (slot === 0) {
      const step = ev.comboStep ?? 1;
      const isHeavy = ev.m1Variant === 'heavy' || step === 4;
      const hitX = ev.x + fx * 1.15;
      const hitZ = ev.z + fz * 1.15;

      if (fId === 'marjohn') {
        // Tornado Poke cast: swirling teal gust + mist
        this.spawnCoreFlash(ev.x + fx * 0.75, wy, ev.z + fz * 0.75, 0x99f6e4, 1.35, 0.14);
        this.spawnFunnel(ev.x + fx * 0.7, wy - 0.65, ev.z + fz * 0.7, 0x2dd4bf, 0.45, 0.85, 0.9, 0.28, 22);
        this.spawnSparks(hitX, wy, hitZ, 0x5eead4, 7, 1.0, 4, 0.28);
        this.spawnPuffs(hitX, wy - 0.2, hitZ, 0x99f6e4, 3, 0.8, 1.2, 0.3, 1.0, 0.36, 0.42);
      } else if (fId === 'prime') {
        // Heavy Punch x3 -> 4th-hit Armored Ground Slam!
        const fiery = step === 4 ? 0xfef08a : 0xfb923c;
        this.spawnCoreFlash(ev.x + fx * 0.7, wy, ev.z + fz * 0.7, fiery, step === 4 ? 2.4 : 1.25, 0.14);
        this.spawnGhost(ev.x + fx * 0.4, groundY + ev.y - 0.9, ev.z + fz * 0.4, 0xf43f5e, fx * 2, 0, fz * 2, 0.24, 0.44);
        this.spawnSparks(hitX, wy, hitZ, 0xfb923c, step === 4 ? 18 : 7, 1.2, 10, 0.34);
        if (step >= 3) {
          this.spawnCracks(hitX, groundY, hitZ, 0xf97316, step === 4 ? 6 : 2, step === 4 ? 1.5 : 0.7, 0.85);
        }
        if (step === 4) {
          this.spawnShockwave(ev.x, groundY, ev.z, 0xf43f5e, 4.4, 0.38);
          this.spawnPuffs(hitX, groundY + 0.35, hitZ, 0x475569, 7, 1.4, 2.4, 0.45, 1.8, 0.6, 0.58);
          this.spawnPointLightFlash(ev.x, groundY + 1.0, ev.z, 0xf97316, 7.0, 0.24, 12);
        }
      } else if (fId === 'damen') {
        // Nerfed Outlaw Gun (1.0s CD, 10.2m strict max range)
        const barrelX = ev.x + fx * 0.85;
        const barrelZ = ev.z + fz * 0.85;
        const endX = ev.x + fx * 10.0;
        const endZ = ev.z + fz * 10.0;
        this.spawnCoreFlash(barrelX, wy, barrelZ, 0xfef08a, 1.35, 0.1);
        this.spawnTracer(barrelX, wy, barrelZ, endX, wy, endZ, 0xfacc15, 0.95, 0.16);
        this.spawnCasings(ev.x + rightX * 0.35, wy, ev.z + rightZ * 0.35, groundY, rightX, rightZ, 1);
        this.spawnPuffs(barrelX, wy, barrelZ, 0xe2e8f0, 2, 0.6, 1.4, 0.22, 0.8, 0.4, 0.35);
      } else if (fId === 'khen') {
        // 3 Dagger Slashes -> 4th-hit Damaging Dash Lunge slicing straight forward!
        this.spawnCoreFlash(ev.x + fx * 0.7, wy, ev.z + fz * 0.7, step === 4 ? 0xf0abfc : 0xa855f7, step === 4 ? 2.2 : 1.15, 0.12);
        this.spawnSlash(hitX, wy, hitZ, yaw + 0.35, 0xa855f7, step === 4 ? 2.0 : 1.25, Math.PI * 0.28, -22, 0.65);
        this.spawnSlash(hitX, wy, hitZ, yaw - 0.35, 0x7e22ce, step === 4 ? 1.85 : 1.1, -Math.PI * 0.28, 22, -0.65);
        this.spawnGhost(ev.x, groundY + ev.y - 0.9, ev.z, 0x7e22ce, -fx * 1.6, 0, -fz * 1.6, 0.24, 0.5);
        if (step === 4) {
          this.spawnTracer(ev.x, wy, ev.z, ev.x + fx * 4.5, wy, ev.z + fz * 4.5, 0xe879f9, 1.8, 0.24);
          this.spawnShockwave(hitX, wy - 0.45, hitZ, 0xa855f7, 4.4, 0.34);
          this.spawnPointLightFlash(hitX, wy, hitZ, 0xa855f7, 6.5, 0.22, 11);
        }
        this.spawnPuffs(hitX, wy, hitZ, 0x2e1065, step === 4 ? 5 : 2, 0.8, 1.2, 0.35, 1.2, 0.45, 0.5);
      } else {
        // JM: Ground 4-Hit (Strike -> Strike -> Mini Kamehameha -> Dash Punch Launch) or Aerial Solar Bolt!
        const isAirBolt = ev.y > 1.2 && step === 1;
        if (isAirBolt) {
          this.spawnCoreFlash(ev.x + fx * 0.7, wy, ev.z + fz * 0.7, 0xfef9c3, 1.35, 0.11);
          this.spawnSparks(ev.x + fx * 0.7, wy, ev.z + fz * 0.7, 0xfacc15, 6, 0.9, 2, 0.24);
        } else if (step === 3) {
          // 3rd Hit: Mini Energy Beam (Kamehameha)
          this.spawnCoreFlash(ev.x + fx * 0.75, wy, ev.z + fz * 0.75, 0xffffff, 2.0, 0.16);
          this.spawnTracer(ev.x + fx * 0.8, wy, ev.z + fz * 0.8, ev.x + fx * 6.5, wy, ev.z + fz * 6.5, 0xfef08a, 2.2, 0.24);
          this.spawnShockwave(ev.x + fx * 0.8, wy, ev.z + fz * 0.8, 0xfacc15, 2.6, 0.26, Math.PI * 0.5);
          this.spawnSparks(hitX, wy, hitZ, 0xfef9c3, 12, 1.2, 4, 0.3);
          this.spawnPointLightFlash(ev.x + fx * 1.2, wy, ev.z + fz * 1.2, 0xfacc15, 6.5, 0.2, 11);
        } else if (step === 4) {
          // 4th Hit: High-Speed Dash Punch Launch
          this.spawnCoreFlash(ev.x + fx * 0.7, wy, ev.z + fz * 0.7, 0xffffff, 2.4, 0.15);
          this.spawnGhost(ev.x, groundY + ev.y - 0.9, ev.z, 0xfacc15, fx * 2.4, 0, fz * 2.4, 0.24, 0.52);
          this.spawnSlash(hitX, wy, hitZ, yaw, 0xfacc15, 2.0, Math.PI * 0.42, 18);
          this.spawnShockwave(hitX, groundY, hitZ, 0xfef08a, 4.8, 0.4);
          this.spawnPillar(hitX, groundY, hitZ, 0xfacc15, 0.85, 0.38);
          this.spawnSparks(hitX, wy, hitZ, 0xfef08a, 16, 1.3, 6, 0.34);
          this.spawnPointLightFlash(hitX, wy, hitZ, 0xfef08a, 7.5, 0.25, 13);
        } else {
          this.spawnCoreFlash(ev.x + fx * 0.7, wy, ev.z + fz * 0.7, 0xfef9c3, 1.2, 0.12);
          this.spawnGhost(ev.x, groundY + ev.y - 0.9, ev.z, 0xfacc15, fx * 1.8, 0, fz * 1.8, 0.2, 0.45);
          this.spawnSlash(hitX, wy, hitZ, yaw, 0xfacc15, 1.2, Math.PI * 0.42, 16);
          this.spawnSparks(hitX, wy, hitZ, 0xfef08a, 6, 1.0, 6, 0.3);
        }
      }
      return;
    }

    // RESTORED CHARACTER SKILL CAST (Slot 2)
    if (slot === 2) {
      this.spawnSpellSigil(ev.x, groundY, ev.z, ev.colorHex, 2.3, 0.42);
      this.spawnCoreFlash(ev.x, wy, ev.z, ev.colorHex, 1.6, 0.14);
      this.spawnSparks(ev.x, wy, ev.z, ev.colorHex, 10, 1.1, 6, 0.32);
      return;
    }

    // SKILL WINDUP / CAST (Slot 3)
    if (slot === 3) {
      this.spawnSpellSigil(ev.x, groundY, ev.z, ev.colorHex, 2.7, 0.52);
      if (fId === 'marjohn') {
        // Cyclone Vortex: 360° azure/teal vortex spiral sucking in loose debris/leaves
        this.spawnCoreFlash(ev.x, wy, ev.z, 0x5eead4, 1.7, 0.16);
        this.spawnFunnel(ev.x, groundY + ev.y - 0.95, ev.z, ev.isComboLink ? 0x99f6e4 : 0x14b8a6, 0.85, 3.2, 1.65, 0.48, 22);
        this.spawnVortexDebris(ev.x, groundY + ev.y - 0.9, ev.z, ev.isComboLink ? 5.2 : 4.2, 0x2dd4bf, ev.isComboLink ? 22 : 14);
        this.spawnPuffs(ev.x, wy - 0.4, ev.z, 0x99f6e4, 6, 1.6, 1.2, 0.4, 1.4, 0.48, 0.42);
      } else if (fId === 'prime') {
        // Crater Slam fire-trail leap arc
        this.spawnCoreFlash(ev.x, wy, ev.z, 0xfb923c, 1.6, 0.14);
        this.spawnTracer(ev.x, wy, ev.z, ev.x + fx * 3.0, wy + 1.8, ev.z + fz * 3.0, 0xf97316, 1.8, 0.25);
        this.spawnSparks(ev.x, wy, ev.z, 0xfb923c, 10, 1.2, 12, 0.35);
      } else if (fId === 'damen') {
        this.spawnCoreFlash(ev.x + fx * 0.7, wy, ev.z + fz * 0.7, 0xfacc15, 1.4, 0.12);
      } else if (fId === 'khen') {
        this.spawnCoreFlash(ev.x + fx * 0.6, wy, ev.z + fz * 0.6, 0xc084fc, 1.5, 0.12);
      } else if (fId === 'jm') {
        // Heel Drop leap trail
        const bright = ev.counterFlow || ev.isComboLink;
        this.spawnCoreFlash(ev.x, wy, ev.z, bright ? 0xffffff : 0xfacc15, bright ? 2.0 : 1.4, 0.14);
        this.spawnTracer(ev.x, wy, ev.z, ev.x + fx * 2.8, wy + 2.0, ev.z + fz * 2.8, 0xfef08a, bright ? 2.2 : 1.4, 0.26);
      }
      return;
    }

    // ULTIMATE WINDUP / CAST (Slot 4)
    if (slot === 4) {
      this.spawnSpellSigil(ev.x, groundY, ev.z, ev.colorHex, 3.8, 0.72);
      if (fId === 'marjohn') {
        // Tempest Typhoon: storm clouds gather overhead + funnel build-up
        this.spawnStormClouds(ev.x, wy, ev.z);
        this.spawnCoreFlash(ev.x, wy, ev.z, 0x99f6e4, 2.2, 0.22);
        this.spawnFunnel(ev.x, groundY, ev.z, 0x14b8a6, 0.9, 2.6, 2.8, 0.45, 24);
      } else if (fId === 'prime') {
        // Avalanche Blow: molten gauntlets ignite + fissures begin
        this.spawnCoreFlash(ev.x, wy, ev.z, 0xf43f5e, 2.3, 0.24);
        this.spawnSparks(ev.x, wy, ev.z, 0xfb923c, 16, 1.4, 10, 0.42);
      } else if (fId === 'damen') {
        // High Noon Fan: golden sun-flare windup
        this.spawnCoreFlash(ev.x, wy + 0.5, ev.z, 0xfef08a, 2.2, 0.25);
        this.spawnShockwave(ev.x, groundY, ev.z, 0xf59e0b, 3.8, 0.38);
      } else if (fId === 'khen') {
        // Phantom Blitz: converging dark-violet afterimage silhouettes race inward!
        this.spawnCoreFlash(ev.x, wy, ev.z, 0xa855f7, 2.0, 0.2);
        for (let i = 0; i < 6; i++) {
          const ang = (i / 6) * Math.PI * 2;
          const sx = ev.x + Math.cos(ang) * 4.5;
          const sz = ev.z + Math.sin(ang) * 4.5;
          this.spawnGhost(sx, groundY, sz, i % 2 === 0 ? 0xa855f7 : 0x3b0764, -Math.cos(ang) * 10, 0, -Math.sin(ang) * 10, 0.4, 0.72);
        }
      } else if (fId === 'jm') {
        // Solar Dragon Beam charge-up
        this.spawnCoreFlash(ev.x + fx * 0.7, wy, ev.z + fz * 0.7, 0xffffff, 2.4, 0.3);
        this.spawnSparks(ev.x, wy, ev.z, 0xfef9c3, 16, 1.2, -4, 0.4);
      }
      return;
    }

    // AWAKENING SKILL 4 CAST (Slot 6)
    if (slot === 6) {
      this.spawnSpellSigil(ev.x, groundY, ev.z, ev.colorHex, 4.6, 0.85);
      this.spawnPointLightFlash(ev.x, groundY + ev.y + 1.0, ev.z, ev.colorHex, 9.5, 0.36, 18);
      this.spawnCoreFlash(ev.x, wy, ev.z, 0xffffff, 2.8, 0.24);
      this.spawnShockwave(ev.x, groundY + 0.1, ev.z, ev.colorHex, 7.6, 0.55);
      if (fId === 'marjohn') {
        this.spawnStormClouds(ev.x, wy, ev.z);
        this.spawnFunnel(ev.x, groundY, ev.z, 0x22d3ee, 1.3, 4.8, 3.6, 0.55, 28);
      } else if (fId === 'prime') {
        this.spawnCracks(ev.x, groundY, ev.z, 0xf43f5e, 7, 2.2, 1.0);
        this.spawnSparks(ev.x, wy, ev.z, 0xfef08a, 16, 1.5, 10, 0.45);
      } else if (fId === 'damen') {
        for (let i = -3; i <= 3; i++) {
          const ang = yaw + i * 0.14;
          this.spawnCoreFlash(ev.x + Math.sin(ang) * 1.4, wy + 0.6, ev.z + Math.cos(ang) * 1.4, 0xfacc15, 1.4, 0.18);
        }
      } else if (fId === 'khen') {
        this.spawnPuffs(ev.x, wy, ev.z, 0x581c87, 6, 2.0, 1.8, 0.5, 2.0, 0.55, 0.65);
      } else if (fId === 'jm') {
        this.spawnPillar(ev.x, groundY, ev.z, 0xfef08a, 1.6, 0.65);
      }
    }
  }

  private spawnFighterSignatureHit(
    fighterId: FighterId | undefined,
    x: number,
    y: number,
    z: number,
    yaw: number,
    colorHex: number,
    isHeavy: boolean,
    ev: CombatEvent
  ): void {
    // 1. RPS Counter: Strike Beats Grab -> sharp gold "clash spark" burst!
    if (ev.rpsOutcome === 'strike_beats_grab') {
      this.spawnCoreFlash(x, y, z, 0xfef08a, 2.2, 0.15);
      this.spawnSlash(x, y, z, yaw, 0xfacc15, 1.5, Math.PI * 0.2, 24, 0.7);
      this.spawnSlash(x, y, z, yaw, 0xffffff, 1.5, Math.PI * 0.2, -24, -0.7);
      this.spawnSparks(x, y, z, 0xfef08a, 22, 1.5, 10, 0.35);
      return;
    }

    // Khen Predator's Mark glyph + stamina sparkle on backstab/stun!
    if (fighterId === 'khen' && ev.staminaRefund) {
      this.spawnMarkGlyph(x, y, z);
      this.spawnSparks(x, y, z, 0xe879f9, 10, 1.1, -3, 0.38);
    }

    if (fighterId === 'marjohn') {
      this.spawnCoreFlash(x, y, z, 0x99f6e4, isHeavy ? 1.9 : 1.1, 0.12);
      this.spawnSlash(x, y, z, yaw, 0x2dd4bf, isHeavy ? 1.9 : 1.35, Math.PI * 0.48, 16);
      this.spawnShockwave(x, Math.max(0, y - 0.9), z, 0x5eead4, isHeavy ? 4.8 : 2.6, 0.38);
      this.spawnSparks(x, y, z, 0x5eead4, isHeavy ? 14 : 7, 1.1, 6, 0.3);
      this.spawnPuffs(x, y, z, 0x99f6e4, isHeavy ? 5 : 2, 0.9, 1.3, 0.3, 1.1, 0.38, 0.4);
      return;
    }
    if (fighterId === 'prime') {
      this.spawnCoreFlash(x, y, z, 0xfef08a, isHeavy ? 2.1 : 1.3, 0.13);
      this.spawnShockwave(x, Math.max(0, y - 1.0), z, 0xf43f5e, isHeavy ? 6.0 : 3.2, 0.42);
      this.spawnSparks(x, y, z, 0xfb923c, isHeavy ? 18 : 9, 1.4, 14, 0.35);
      this.spawnPuffs(x, y, z, 0x334155, isHeavy ? 5 : 2, 1.0, 2.2, 0.4, 1.5, 0.55, 0.5);
      if (isHeavy) {
        this.spawnPillar(x, Math.max(0, y - 1.0), z, 0xf43f5e, 1.15, 0.48);
        this.spawnCracks(x, Math.max(0, y - 1.1), z, 0xf97316, 4, 1.1, 0.75);
      }
      return;
    }
    if (fighterId === 'damen') {
      this.spawnCoreFlash(x, y, z, 0xfef08a, isHeavy ? 1.8 : 1.0, 0.1);
      this.spawnSlash(x, y, z, yaw, 0xfef08a, isHeavy ? 1.55 : 0.9, Math.PI * 0.15, 22);
      this.spawnSparks(x, y, z, 0xfacc15, isHeavy ? 16 : 8, 1.35, 12, 0.3);
      this.spawnPuffs(x, y, z, 0xe2e8f0, isHeavy ? 3 : 1, 0.6, 1.4, 0.22, 0.9, 0.38, 0.35);
      return;
    }
    if (fighterId === 'khen') {
      this.spawnCoreFlash(x, y, z, 0xf0abfc, isHeavy ? 1.9 : 1.15, 0.11);
      this.spawnSlash(x, y, z, yaw + 0.5, 0xa855f7, isHeavy ? 1.75 : 1.25, Math.PI * 0.25, -20);
      this.spawnSlash(x, y, z, yaw - 0.5, 0xe879f9, isHeavy ? 1.75 : 1.25, -Math.PI * 0.25, 20);
      this.spawnSparks(x, y, z, 0xc084fc, isHeavy ? 15 : 8, 1.2, 8, 0.32);
      this.spawnPuffs(x, y, z, 0x2e1065, isHeavy ? 4 : 2, 0.8, 1.4, 0.3, 1.15, 0.42, 0.48);
      return;
    }
    // JM Solar Martial Arts
    this.spawnCoreFlash(x, y, z, 0xffffff, isHeavy ? 2.1 : 1.25, 0.12);
    this.spawnSlash(x, y, z, yaw, 0xfacc15, isHeavy ? 1.85 : 1.3, Math.PI * 0.42, 14);
    this.spawnShockwave(x, Math.max(0, y - 0.9), z, 0xfef08a, isHeavy ? 5.2 : 2.5, 0.38);
    this.spawnSparks(x, y, z, colorHex, isHeavy ? 16 : 8, 1.2, 6, 0.32);
  }

  public handleEvent(ev: CombatEvent, mapId: MapId): void {
    const groundY = getMapTerrainHeight(mapId, ev.x, ev.z);
    const yaw = Math.atan2(ev.dirX ?? 0, ev.dirZ ?? 1);

    if (ev.kind === 'cast') {
      this.handleCastEvent(ev, mapId);
      return;
    }

    if (ev.kind === 'hit') {
      this.spawnFighterSignatureHit(ev.fighterId, ev.x, groundY + ev.y, ev.z, yaw, ev.colorHex, Boolean(ev.isCrit), ev);
      if (ev.isCrit || (ev.damage ?? 0) >= 18) {
        this.spawnPointLightFlash(ev.x, groundY + ev.y + 0.4, ev.z, ev.colorHex, 6.8, 0.22, 12);
      }
      return;
    }

    if (ev.kind === 'grab') {
      // RPS: GRAB BEATS PARRY -> heavy downward impact crunch ring + counter-flash on "Weak to Grab"!
      this.spawnPointLightFlash(ev.x, groundY + ev.y + 0.4, ev.z, ev.rpsOutcome === 'weak_to_grab' ? 0xf43f5e : 0xfacc15, 7.2, 0.24, 12);
      if (ev.rpsOutcome === 'weak_to_grab') {
        this.spawnCoreFlash(ev.x, groundY + ev.y, ev.z, 0xffffff, 2.4, 0.16);
        this.spawnShockwave(ev.x, groundY + ev.y, ev.z, 0xf43f5e, 6.2, 0.42, Math.PI * 0.5);
        this.spawnSlash(ev.x, groundY + ev.y, ev.z, yaw, 0xfef08a, 1.6, Math.PI * 0.12, 20, 0.65);
        this.spawnSlash(ev.x, groundY + ev.y, ev.z, yaw, 0xf43f5e, 1.6, Math.PI * 0.12, -20, -0.65);
      }
      this.spawnCoreFlash(ev.x, groundY + ev.y, ev.z, ev.isCrit ? 0xf97316 : 0xfacc15, 1.7, 0.14);
      this.spawnShockwave(ev.x, groundY + Math.max(0, ev.y - 0.9), ev.z, ev.isCrit ? 0xf43f5e : 0xfacc15, ev.isCrit ? 5.6 : 3.2, 0.38);
      this.spawnCracks(ev.x, groundY, ev.z, ev.isCrit ? 0xf43f5e : 0xf59e0b, ev.isCrit ? 5 : 2, 0.95, 0.7);
      this.spawnSparks(ev.x, groundY + ev.y, ev.z, 0xfef08a, 14, 1.3, 14, 0.32);
      return;
    }

    if (ev.kind === 'headlockBreak') {
      this.spawnCoreFlash(ev.x, groundY + ev.y, ev.z, 0x38bdf8, 2.1, 0.16);
      this.spawnShockwave(ev.x, groundY + Math.max(0, ev.y - 0.8), ev.z, 0x38bdf8, 5.2, 0.38);
      this.spawnShockwave(ev.x, groundY + ev.y, ev.z, 0xffffff, 3.4, 0.28, Math.PI * 0.5);
      this.spawnSparks(ev.x, groundY + ev.y, ev.z, 0x7dd3fc, 16, 1.4, 8, 0.35);
      this.spawnPointLightFlash(ev.x, groundY + ev.y + 0.4, ev.z, 0x38bdf8, 6.8, 0.24, 12);
      return;
    }

    if (ev.kind === 'parry') {
      // RPS: PARRY BEATS STRIKE -> bright deflection shockwave in parrying character's color!
      const parryColor =
        ev.fighterId === 'marjohn'
          ? 0x2dd4bf
          : ev.fighterId === 'khen'
          ? 0xa855f7
          : ev.fighterId === 'prime'
          ? 0xf43f5e
          : ev.colorHex;
      this.spawnPointLightFlash(ev.x, groundY + ev.y + 0.5, ev.z, parryColor, 8.0, 0.26, 13);
      this.spawnCoreFlash(ev.x, groundY + ev.y, ev.z, 0xffffff, 2.2, 0.15);
      this.spawnShockwave(ev.x, groundY + Math.max(0, ev.y - 0.9), ev.z, parryColor, 5.8, 0.42);
      this.spawnShockwave(ev.x, groundY + ev.y, ev.z, 0xffffff, 3.6, 0.3, Math.PI * 0.5);
      this.spawnSparks(ev.x, groundY + ev.y, ev.z, parryColor, 18, 1.4, 8, 0.36);
      if (ev.fighterId === 'khen') {
        // X-shaped void-crack burst
        this.spawnSlash(ev.x, groundY + ev.y, ev.z, yaw, 0xa855f7, 1.45, Math.PI * 0.15, 0, 0.78);
        this.spawnSlash(ev.x, groundY + ev.y, ev.z, yaw, 0xe879f9, 1.45, Math.PI * 0.15, 0, -0.78);
      } else if (ev.fighterId === 'jm' || ev.counterFlow) {
        // Dragon Counter: upward-arcing dragon chi-flare clearly charging Counter-Flow
        this.spawnPillar(ev.x, groundY, ev.z, 0xfacc15, 0.85, 0.48);
        this.spawnTracer(ev.x, groundY + 0.4, ev.z, ev.x, groundY + 4.2, ev.z, 0xfef08a, 1.8, 0.32);
      }
      return;
    }

    if (ev.kind === 'evade') {
      this.spawnCoreFlash(ev.x, groundY + ev.y, ev.z, 0xffffff, 2.0, 0.14);
      this.spawnShockwave(ev.x, groundY + Math.max(0, ev.y - 0.8), ev.z, ev.colorHex, 4.6, 0.36);
      this.spawnShockwave(ev.x, groundY + ev.y, ev.z, 0x99f6e4, 2.8, 0.28, Math.PI * 0.5);
      this.spawnSparks(ev.x, groundY + ev.y, ev.z, ev.colorHex, 14, 1.3, 4, 0.34);
      this.spawnGhost(ev.x, groundY, ev.z, ev.colorHex, 0, 0.6, 0, 0.34, 0.62);
      return;
    }

    if (ev.kind === 'trap') {
      this.spawnCoreFlash(ev.x, groundY + ev.y, ev.z, ev.colorHex, 1.35, 0.14);
      this.spawnShockwave(ev.x, groundY + 0.1, ev.z, ev.colorHex, 3.2, 0.34, -Math.PI * 0.5, true);
      this.spawnSparks(ev.x, groundY + ev.y, ev.z, ev.colorHex, 10, 0.9, 8, 0.32);
      return;
    }

    if (ev.kind === 'trapTrigger') {
      this.spawnCoreFlash(ev.x, groundY + ev.y, ev.z, 0xffffff, 2.4, 0.18);
      this.spawnShockwave(ev.x, groundY + 0.12, ev.z, ev.colorHex, 6.2, 0.44);
      this.spawnPillar(ev.x, groundY, ev.z, ev.colorHex, 0.95, 0.42);
      this.spawnSparks(ev.x, groundY + ev.y, ev.z, ev.colorHex, 18, 1.4, 10, 0.38);
      return;
    }

    if (ev.kind === 'whiff') {
      // Whiff Telegraph Visuals
      if (ev.fighterId === 'marjohn' && ev.whiffSlot === 3) {
        // Cyclone Vortex whiff: visibly "unwound" deflating vortex puff!
        this.spawnShockwave(ev.x, groundY + 0.5, ev.z, 0x94a3b8, 3.6, 0.45, -Math.PI * 0.5, true);
        this.spawnPuffs(ev.x, groundY + 0.7, ev.z, 0x99f6e4, 6, 1.4, 0.6, 0.65, 0.15, 0.5, 0.45);
      } else if (ev.fighterId === 'damen' && ev.whiffSlot === 3) {
        // Solar Lasso whiff: fizzles out mid-air!
        this.spawnSparks(ev.x, groundY + ev.y, ev.z, 0xf59e0b, 8, 0.65, 16, 0.3);
        this.spawnPuffs(ev.x, groundY + ev.y, ev.z, 0x475569, 3, 0.5, 0.8, 0.35, 0.8, 0.4, 0.38);
      } else {
        this.spawnPuffs(ev.x, groundY + ev.y, ev.z, 0xfb923c, 4, 0.9, 1.1, 0.35, 0.9, 0.4, 0.42);
      }
      return;
    }

    if (ev.kind === 'dash') {
      const fId = ev.fighterId;
      if (ev.originX !== undefined && ev.originZ !== undefined) {
        const origGround = getMapTerrainHeight(mapId, ev.originX, ev.originZ);
        const oy = origGround + (ev.originY ?? 0.9);
        const dy = groundY + ev.y;
        const fx = ev.dirX ?? 0;
        const fz = ev.dirZ ?? 1;

        if (fId === 'marjohn') {
          // Cloud Vault: streaking cloud-trail dash + mist afterimage
          this.spawnTracer(ev.originX, oy, ev.originZ, ev.x, dy, ev.z, 0x99f6e4, 1.8, 0.28);
          this.spawnPuffs(ev.originX, oy, ev.originZ, 0xccfbf1, 5, 0.9, 1.4, 0.4, 1.3, 0.48, 0.5);
          this.spawnGhost(ev.originX, origGround, ev.originZ, 0x2dd4bf, 0, 0, 0, 0.32, 0.55);
        } else if (fId === 'prime') {
          // Meteor Charge: scorched ground-streak + trailing embers + heat shockwave
          this.spawnCoreFlash(ev.originX, oy, ev.originZ, 0xfb923c, 1.4, 0.14);
          this.spawnCracks(ev.originX + fx * 1.4, origGround, ev.originZ + fz * 1.4, 0xf97316, 3, 1.25, 0.8);
          this.spawnSparks(ev.x, dy, ev.z, 0xfb923c, 12, 1.1, 10, 0.36);
        } else if (fId === 'damen') {
          // Outlaw Roll: low dust-kickup + brief gold streak
          this.spawnPuffs(ev.originX, origGround + 0.25, ev.originZ, 0xd6d3d1, 5, 1.0, 0.9, 0.3, 1.0, 0.42, 0.45);
          this.spawnTracer(ev.originX, oy - 0.3, ev.originZ, ev.x, dy - 0.3, ev.z, 0xfacc15, 0.9, 0.2);
        } else if (fId === 'khen') {
          // Shadow Blink: space-tear ripple at BOTH origin & destination!
          this.spawnCoreFlash(ev.originX, oy, ev.originZ, 0x1e1b4b, 1.8, 0.16);
          this.spawnShockwave(ev.originX, oy, ev.originZ, 0xa855f7, 3.2, 0.36, Math.PI * 0.5);
          this.spawnCoreFlash(ev.x, dy, ev.z, 0xc084fc, 1.8, 0.16);
          this.spawnShockwave(ev.x, dy, ev.z, 0xe879f9, 3.2, 0.36, Math.PI * 0.5);
          this.spawnTracer(ev.originX, oy, ev.originZ, ev.x, dy, ev.z, 0x7e22ce, 1.4, 0.24);
          this.spawnGhost(ev.originX, origGround, ev.originZ, 0x581c87, 0, 0, 0, 0.3, 0.65);
        } else {
          // JM Flash Step: explosive gold origin burst + comet blur
          this.spawnCoreFlash(ev.originX, oy, ev.originZ, 0xfef08a, 1.9, 0.14);
          this.spawnTracer(ev.originX, oy, ev.originZ, ev.x, dy, ev.z, 0xfacc15, 2.0, 0.26);
          this.spawnSparks(ev.originX, oy, ev.originZ, 0xfef9c3, 10, 1.2, 4, 0.3);
        }
      } else {
        this.spawnGhost(ev.x, groundY + Math.max(0, ev.y - 0.9), ev.z, ev.colorHex, 0, 0, 0, 0.28, 0.55);
      }
      return;
    }

    if (ev.kind === 'lasso') {
      // Solar Lasso Hit: light-rope tether back to Damen + tightening golden snare ring!
      if (ev.originX !== undefined && ev.originZ !== undefined) {
        const og = getMapTerrainHeight(mapId, ev.originX, ev.originZ);
        this.spawnTether(ev.originX, og + (ev.originY ?? 1.0), ev.originZ, ev.x, groundY + ev.y, ev.z, 0xfacc15, 0.36);
      }
      this.spawnCoreFlash(ev.x, groundY + ev.y, ev.z, 0xfef08a, 1.6, 0.14);
      this.spawnShockwave(ev.x, groundY + ev.y, ev.z, 0xfacc15, 2.8, 0.32, -Math.PI * 0.5, true);
      this.spawnSparks(ev.x, groundY + ev.y, ev.z, 0xf59e0b, 12, 1.0, 8, 0.34);
      return;
    }

    if (ev.kind === 'shockwave') {
      const fId = ev.fighterId;
      const slot = ev.abilitySlot;
      const fx = ev.dirX ?? 0;
      const fz = ev.dirZ ?? 1;

      if (ev.isComboLink) {
        this.spawnComboLinkBridge(ev, mapId);
      }

      if (fId === 'marjohn' && slot === 4) {
        // Tempest Typhoon impact: massive edge-reaching teal funnel + wind-shear lightning streaks!
        this.spawnCoreFlash(ev.x, groundY + 1.4, ev.z, 0x99f6e4, 2.8, 0.22);
        this.spawnFunnel(ev.x, groundY, ev.z, 0x2dd4bf, 1.4, 5.8, 4.2, 0.65, 26);
        this.spawnShockwave(ev.x, groundY, ev.z, 0x14b8a6, 12.5, 0.62);
        for (let l = 0; l < 6; l++) {
          const ang = (l / 6) * Math.PI * 2 + Math.random() * 0.4;
          this.spawnTracer(
            ev.x,
            groundY + 1.2,
            ev.z,
            ev.x + Math.cos(ang) * 9.5,
            groundY + 0.4 + Math.random() * 2.4,
            ev.z + Math.sin(ang) * 9.5,
            0xccfbf1,
            1.6,
            0.3
          );
        }
        this.spawnVortexDebris(ev.x, groundY + 0.4, ev.z, 7.5, 0x5eead4, 20);
      } else if (fId === 'prime' && slot === 3) {
        // Crater Slam impact: radiating ground crack lines + erupting flame jets + ash smoke
        this.spawnCoreFlash(ev.x, groundY + 0.6, ev.z, 0xfef08a, 2.2, 0.16);
        this.spawnShockwave(ev.x, groundY, ev.z, 0xf43f5e, 6.4, 0.48);
        this.spawnCracks(ev.x, groundY, ev.z, 0xf97316, 6, 1.8, 0.95);
        for (let j = 0; j < 6; j++) {
          const a = (j / 6) * Math.PI * 2;
          this.spawnPillar(ev.x + Math.cos(a) * 2.2, groundY, ev.z + Math.sin(a) * 2.2, 0xfb923c, 0.35, 0.38);
        }
        this.spawnPuffs(ev.x, groundY + 0.4, ev.z, 0x475569, 8, 1.8, 2.8, 0.55, 2.0, 0.65, 0.55);
      } else if (fId === 'prime' && slot === 4) {
        // Avalanche Blow impact: arena-wide fissures + volcanic pillar + falling ember rain!
        this.spawnCoreFlash(ev.x, groundY + 1.2, ev.z, 0xffffff, 3.0, 0.24);
        this.spawnPillar(ev.x, groundY, ev.z, 0xf43f5e, 2.4, 0.68);
        this.spawnShockwave(ev.x, groundY, ev.z, 0xfb923c, 11.5, 0.6);
        this.spawnCracks(ev.x, groundY, ev.z, 0xfef08a, 8, 2.8, 1.2);
        this.spawnSparks(ev.x, groundY + 4.5, ev.z, 0xfb923c, 28, 1.4, 18, 0.72);
        this.spawnPuffs(ev.x, groundY + 0.6, ev.z, 0x334155, 10, 2.2, 3.4, 0.7, 2.4, 0.75, 0.6);
      } else if (fId === 'damen' && slot === 4) {
        // High Noon Fan burst: 5 staggered golden tracer rays + sun flare
        this.spawnCoreFlash(ev.x, groundY + 1.2, ev.z, 0xfef08a, 2.4, 0.2);
        for (const sp of [-0.34, -0.17, 0, 0.17, 0.34]) {
          const ang = Math.atan2(fx, fz) + sp;
          this.spawnTracer(
            ev.x + Math.sin(ang) * 0.9,
            groundY + 1.15,
            ev.z + Math.cos(ang) * 0.9,
            ev.x + Math.sin(ang) * 14.5,
            groundY + 1.15,
            ev.z + Math.cos(ang) * 14.5,
            0xfef08a,
            1.4,
            0.24
          );
        }
        this.spawnShockwave(ev.x, groundY, ev.z, 0xfacc15, 6.2, 0.44);
      } else if (fId === 'khen' && slot === 4) {
        // Phantom Blitz impact: reality-ripple + void-burst + multiple X-cuts
        this.spawnCoreFlash(ev.x, groundY + 1.1, ev.z, 0xe879f9, 1.45, 0.22);
        this.spawnShockwave(ev.x, groundY, ev.z, 0xa855f7, 8.2, 0.52);
        this.spawnSlash(ev.x + fx * 1.5, groundY + 1.1, ev.z + fz * 1.5, yaw, 0xe879f9, 2.1, Math.PI * 0.15, 24, 0.75);
        this.spawnSlash(ev.x + fx * 1.5, groundY + 1.1, ev.z + fz * 1.5, yaw, 0x7e22ce, 2.1, Math.PI * 0.15, -24, -0.75);
        this.spawnPuffs(ev.x, groundY + 0.7, ev.z, 0x1e1b4b, 8, 2.0, 2.0, 0.6, 2.0, 0.62, 0.6);
      } else if (fId === 'prime' && slot === 0) {
        // Prime 4th-hit Armored Ground Slam AOE ring!
        this.spawnPointLightFlash(ev.x, groundY + 1.0, ev.z, 0xf43f5e, 7.6, 0.25, 13);
        this.spawnCoreFlash(ev.x, groundY + 0.5, ev.z, 0xfef08a, 2.1, 0.15);
        this.spawnShockwave(ev.x, groundY, ev.z, 0xf43f5e, 4.6, 0.36);
        this.spawnShockwave(ev.x, groundY + 0.08, ev.z, 0xfb923c, 3.2, 0.28);
        this.spawnCracks(ev.x, groundY, ev.z, 0xf97316, 6, 1.4, 0.85);
        this.spawnPuffs(ev.x, groundY + 0.35, ev.z, 0x475569, 6, 1.5, 2.2, 0.45, 1.7, 0.55, 0.52);
      } else if (fId === 'jm' && slot === 3) {
        // Heel Drop impact: golden crater shockwave + cracks + Meteor link falling-star flash!
        this.spawnPointLightFlash(ev.x, groundY + 0.8, ev.z, 0xfacc15, 7.8, 0.26, 13);
        this.spawnCoreFlash(ev.x, groundY + 0.5, ev.z, ev.isComboLink ? 0xffffff : 0xfef08a, ev.isComboLink ? 2.6 : 1.9, 0.18);
        this.spawnShockwave(ev.x, groundY, ev.z, 0xfacc15, ev.isComboLink ? 7.8 : 6.0, 0.48);
        this.spawnCracks(ev.x, groundY, ev.z, 0xfef08a, 5, 1.4, 0.8);
        if (ev.isComboLink) {
          this.spawnPillar(ev.x, groundY, ev.z, 0xfef9c3, 1.1, 0.42);
        }
      } else {
        this.spawnPointLightFlash(ev.x, groundY + Math.max(0.6, ev.y), ev.z, ev.colorHex, 7.4, 0.26, 14);
        this.spawnCoreFlash(ev.x, groundY + Math.max(0.4, ev.y), ev.z, ev.colorHex, 1.6, 0.15);
        this.spawnShockwave(ev.x, groundY + Math.max(0, ev.y - 0.1), ev.z, ev.colorHex, 6.8, 0.5);
        this.spawnShockwave(ev.x, groundY + Math.max(0, ev.y - 0.05), ev.z, 0xffffff, 4.4, 0.32);
      }
      return;
    }

    if (ev.kind === 'beam') {
      // JM Solar Dragon Beam
      this.spawnPointLightFlash(ev.x, groundY + ev.y + 0.5, ev.z, 0xfacc15, 9.5, 0.38, 18);
      this.spawnCoreFlash(ev.x, groundY + ev.y, ev.z, 0xffffff, 2.8, 0.25);
      this.spawnBeam(ev.x, groundY + ev.y, ev.z, ev.dirX ?? 0, ev.dirZ ?? 1, ev.colorHex);
      this.spawnShockwave(ev.x, groundY, ev.z, 0xfef9c3, 7.2, 0.55);
      this.spawnSparks(ev.x, groundY + ev.y, ev.z, 0xfacc15, 22, 1.6, 4, 0.45);
      return;
    }

    if (ev.kind === 'stun') {
      this.spawnCoreFlash(ev.x, groundY + ev.y, ev.z, 0xfacc15, 1.9, 0.16);
      this.spawnPillar(ev.x, groundY, ev.z, 0xfacc15, 0.85);
      this.spawnShockwave(ev.x, groundY, ev.z, 0xf43f5e, 4.8);
      return;
    }

    if (ev.kind === 'comboLink' || ev.kind === 'overdrive') {
      this.spawnComboLinkBridge(ev, mapId);
      this.spawnCoreFlash(ev.x, groundY + ev.y, ev.z, 0xffffff, 1.8, 0.16);
      this.spawnPillar(ev.x, groundY, ev.z, ev.colorHex, 1.15);
      this.spawnShockwave(ev.x, groundY, ev.z, ev.colorHex, 5.8);
      return;
    }

    if (ev.kind === 'clashStart' || ev.kind === 'clashWin') {
      this.spawnCoreFlash(ev.x, groundY + ev.y, ev.z, 0xffffff, 2.8, 0.2);
      this.spawnShockwave(ev.x, groundY + Math.max(0, ev.y - 1.0), ev.z, 0xfacc15, ev.kind === 'clashWin' ? 8.2 : 4.8);
      this.spawnSparks(ev.x, groundY + ev.y, ev.z, 0xfef08a, 24, 1.5);
      if (ev.kind === 'clashWin') {
        this.spawnPillar(ev.x, groundY, ev.z, ev.colorHex, 1.4);
      }
      return;
    }

    if (ev.kind === 'hazardHit') {
      this.spawnCoreFlash(ev.x, groundY + 1.0, ev.z, 0xffffff, 2.8, 0.2);
      this.spawnPillar(ev.x, groundY, ev.z, 0xfacc15, 2.6);
      this.spawnShockwave(ev.x, groundY, ev.z, 0xfacc15, 7.5);
      this.spawnSparks(ev.x, groundY + 1.0, ev.z, 0xfacc15, 24, 1.5);
      this.spawnCracks(ev.x, groundY, ev.z, 0xfacc15, 6, 1.8, 1.0);
      return;
    }

    if (ev.kind === 'block') {
      this.spawnCoreFlash(ev.x, groundY + ev.y, ev.z, ev.colorHex, 0.9, 0.1);
      this.spawnSparks(ev.x, groundY + ev.y, ev.z, ev.colorHex, 6, 0.8);
      return;
    }

    if (ev.kind === 'jump') {
      this.spawnShockwave(ev.x, groundY + Math.max(0, ev.y - 0.1), ev.z, ev.colorHex, 1.9, 0.3);
      this.spawnPuffs(ev.x, groundY + ev.y, ev.z, 0xcbd5e1, 3, 0.6, 0.8, 0.25, 0.75, 0.35, 0.35);
      return;
    }

    if (ev.kind === 'pickup') {
      this.spawnCoreFlash(ev.x, groundY + ev.y, ev.z, ev.colorHex, 1.3, 0.14);
      this.spawnSparks(ev.x, groundY + ev.y, ev.z, ev.colorHex, ev.staminaRefund ? 12 : 10, 1.0, 4, 0.34);
      this.spawnShockwave(ev.x, groundY + Math.max(0, ev.y - 0.5), ev.z, ev.colorHex, 2.8, 0.36);
      return;
    }

    if (ev.kind === 'fireballCharge') {
      this.spawnSpellSigil(ev.x, groundY, ev.z, 0xfacc15, 4.2, 1.15);
      this.spawnCoreFlash(ev.x, groundY + 1.2, ev.z, 0xfef9c3, 2.8, 0.25);
      this.spawnPillar(ev.x, groundY, ev.z, 0xfacc15, 1.4, 0.65);
      this.spawnShockwave(ev.x, groundY, ev.z, 0xfacc15, 6.2, 0.55);
      this.spawnSparks(ev.x, groundY + 1.5, ev.z, 0xfef08a, 24, 1.4, -6, 0.55);
      return;
    }

    if (ev.kind === 'fireballLaunch') {
      this.spawnCoreFlash(ev.x, groundY + ev.y, ev.z, 0xffffff, 3.4, 0.22);
      this.spawnShockwave(ev.x, groundY + ev.y, ev.z, 0xfacc15, 7.2, 0.42, Math.PI * 0.5);
      this.spawnSparks(ev.x, groundY + ev.y, ev.z, 0xfef08a, 28, 1.8, 8, 0.48);
      return;
    }

    if (ev.kind === 'fireballImpact') {
      const rad = ev.radius ?? 6.2;
      this.spawnPointLightFlash(ev.x, groundY + 1.5, ev.z, 0xfacc15, 11.0, 0.48, 22);
      this.spawnCoreFlash(ev.x, groundY + 1.0, ev.z, 0xffffff, 4.4, 0.28);
      this.spawnPillar(ev.x, groundY, ev.z, 0xfacc15, 2.8, 0.78);
      this.spawnShockwave(ev.x, groundY, ev.z, 0xfef08a, rad * 1.45, 0.62);
      this.spawnShockwave(ev.x, groundY + 0.3, ev.z, 0xf97316, rad * 2.1, 0.75);
      this.spawnCracks(ev.x, groundY, ev.z, 0xfacc15, 10, 3.0, 1.35);
      this.spawnSparks(ev.x, groundY + 1.2, ev.z, 0xfef08a, 38, 1.9, 14, 0.68);
      this.spawnPuffs(ev.x, groundY + 0.8, ev.z, 0xf97316, 12, 2.6, 3.2, 0.9, 3.2, 0.85, 0.62);
      return;
    }

    if (ev.kind === 'ko') {
      const killerId = ev.fighterId;
      this.spawnCoreFlash(ev.x, groundY + ev.y, ev.z, 0xffffff, 3.2, 0.24);
      if (killerId === 'prime' || ev.koStyle === 'launch') {
        // Prime KO - Launch: fiery rocket trail + delayed apex explosion puff!
        this.spawnSparks(ev.x, groundY + ev.y, ev.z, 0xfb923c, 22, 1.5, -6, 0.65);
        this.spawnShockwave(ev.x, groundY, ev.z, 0xf43f5e, 7.5, 0.5);
        this.delayedTasks.push({
          delay: 0.88,
          run: () => {
            const apexY = groundY + 9.2;
            this.spawnCoreFlash(ev.x, apexY, ev.z, 0xfef08a, 3.0, 0.22);
            this.spawnShockwave(ev.x, apexY, ev.z, 0xf97316, 6.5, 0.45, Math.PI * 0.5);
            this.spawnPuffs(ev.x, apexY, ev.z, 0x475569, 9, 1.8, 1.4, 0.7, 2.3, 0.65, 0.65);
            this.spawnSparks(ev.x, apexY, ev.z, 0xfb923c, 20, 1.6, 12, 0.5);
          },
        });
      } else if (killerId === 'damen' || ev.koStyle === 'shatter') {
        // Damen KO - Shatter: freeze flash, then burst ring when shards scatter at 0.24s
        this.spawnShockwave(ev.x, groundY + 1.0, ev.z, 0xfef08a, 4.5, 0.25, Math.PI * 0.5);
        this.delayedTasks.push({
          delay: 0.24,
          run: () => {
            this.spawnCoreFlash(ev.x, groundY + 1.1, ev.z, 0xfef08a, 2.8, 0.18);
            this.spawnShockwave(ev.x, groundY, ev.z, 0xfacc15, 8.8, 0.52);
            this.spawnSparks(ev.x, groundY + 1.1, ev.z, 0xfef08a, 24, 1.5, 10, 0.45);
          },
        });
      } else if (killerId === 'khen' || ev.koStyle === 'dissolve') {
        // Khen KO - Dissolve: violet reality tear & drifting violet smoke
        this.spawnShockwave(ev.x, groundY, ev.z, 0xa855f7, 8.2, 0.55);
        this.spawnPuffs(ev.x, groundY + 0.8, ev.z, 0x7e22ce, 12, 1.4, 2.2, 0.5, 1.9, 0.85, 0.62);
        this.spawnSparks(ev.x, groundY + 1.0, ev.z, 0xc084fc, 18, 1.2, -3, 0.55);
      } else if (killerId === 'jm') {
        // JM KO - Collapse: downward pillar of golden light + fading golden motes!
        this.spawnPillar(ev.x, groundY, ev.z, 0xfef08a, 1.85, 0.85);
        this.spawnShockwave(ev.x, groundY, ev.z, 0xfacc15, 9.5, 0.58);
        this.spawnSparks(ev.x, groundY + 0.8, ev.z, 0xfef9c3, 24, 1.1, -5, 0.72);
      } else {
        // Marjohn KO - Collapse: wind-tatter outward peel before vanishing
        this.spawnFunnel(ev.x, groundY, ev.z, 0x2dd4bf, 1.6, 0.4, 2.0, 0.55, 22);
        this.spawnShockwave(ev.x, groundY, ev.z, 0x5eead4, 8.2, 0.5);
        this.spawnPuffs(ev.x, groundY + 0.9, ev.z, 0x99f6e4, 10, 1.6, 1.8, 0.45, 1.6, 0.65, 0.55);
        this.spawnSparks(ev.x, groundY + 1.0, ev.z, 0x2dd4bf, 18, 1.3, 4, 0.48);
      }
      return;
    }

    if (ev.kind === 'awakeningOrbsSpawn') {
      this.spawnPointLightFlash(ev.x, groundY + 2.5, ev.z, 0x38bdf8, 12.0, 0.55, 24);
      this.spawnShockwave(ev.x, groundY + 0.15, ev.z, 0xfacc15, 10.5, 0.72);
      this.spawnShockwave(ev.x, groundY + 0.25, ev.z, 0x38bdf8, 7.2, 0.55);
      return;
    }

    if (ev.kind === 'awakeningPickup') {
      this.spawnCoreFlash(ev.x, groundY + 1.4, ev.z, 0xffffff, 3.0, 0.26);
      this.spawnShockwave(ev.x, groundY + 0.15, ev.z, ev.colorHex, 7.5, 0.52);
      this.spawnPillar(ev.x, groundY, ev.z, ev.colorHex, 1.5, 0.75);
      this.spawnSparks(ev.x, groundY + 1.4, ev.z, 0xfef08a, 16, 1.5, 4, 0.5);
      return;
    }

    if (ev.kind === 'awakeningTransform') {
      this.spawnPointLightFlash(ev.x, groundY + 1.8, ev.z, ev.colorHex, 11.0, 0.48, 22);
      this.spawnCoreFlash(ev.x, groundY + 1.4, ev.z, 0xffffff, 3.8, 0.3);
      this.spawnPillar(ev.x, groundY, ev.z, ev.colorHex, 2.2, 0.82);
      this.spawnShockwave(ev.x, groundY + 0.15, ev.z, ev.colorHex, 9.6, 0.65);
      this.spawnShockwave(ev.x, groundY + 0.2, ev.z, 0xfef08a, 6.2, 0.48);
      this.spawnSparks(ev.x, groundY + 1.3, ev.z, ev.colorHex, 16, 1.6, 6, 0.55);
      this.spawnCracks(ev.x, groundY, ev.z, ev.colorHex, 6, 1.8, 1.1);
      return;
    }

    if (ev.kind === 'awakeningCutsceneStart') {
      this.spawnShockwave(0, 0.2, 0, 0xffffff, 14.0, 0.8);
      this.spawnPillar(0, 0, 0, 0xfef08a, 2.5, 0.9);
      return;
    }

    if (ev.kind === 'awakeningClashEnd') {
      this.spawnPointLightFlash(ev.x, groundY + 1.6, ev.z, 0xffffff, 14.0, 0.55, 28);
      this.spawnCoreFlash(ev.x, groundY + 1.6, ev.z, 0xffffff, 5.0, 0.35);
      this.spawnShockwave(ev.x, groundY + 0.2, ev.z, 0xffffff, 16.0, 0.72);
      this.spawnShockwave(ev.x, groundY + 0.25, ev.z, ev.colorHex, 12.0, 0.6);
      this.spawnSparks(ev.x, groundY + 1.5, ev.z, 0xfef08a, 18, 1.8, 10, 0.62);
      this.spawnCracks(ev.x, groundY, ev.z, 0xfef08a, 8, 2.8, 1.25);
      return;
    }

    if (ev.kind === 'lightning') {
      this.spawnPointLightFlash(ev.x, groundY + 1.4, ev.z, 0x38bdf8, 10.0, 0.32, 18);
      this.spawnTracer(ev.x, groundY + 15.0, ev.z, ev.x, groundY + 0.1, ev.z, 0xe0f2fe, 4.2, 0.28);
      this.spawnCoreFlash(ev.x, groundY + 0.8, ev.z, 0xffffff, 2.8, 0.2);
      this.spawnShockwave(ev.x, groundY + 0.1, ev.z, 0x22d3ee, ev.radius ?? 5.0, 0.45);
      this.spawnCracks(ev.x, groundY, ev.z, 0x38bdf8, 5, 1.5, 0.9);
      this.spawnSparks(ev.x, groundY + 0.8, ev.z, 0x7dd3fc, 14, 1.5, 12, 0.42);
      return;
    }

    if (ev.kind === 'silence') {
      this.spawnMarkGlyph(ev.x, groundY + 1.1, ev.z);
      this.spawnShockwave(ev.x, groundY + 0.8, ev.z, 0xa855f7, 3.8, 0.36, -Math.PI * 0.5, true);
      this.spawnSparks(ev.x, groundY + 1.1, ev.z, 0xe879f9, 10, 1.1, 4, 0.4);
      return;
    }

    if (ev.kind === 'cometGrab') {
      this.spawnPointLightFlash(ev.x, groundY + 1.2, ev.z, 0xf43f5e, 9.0, 0.32, 16);
      this.spawnCoreFlash(ev.x, groundY + 1.0, ev.z, 0xfef08a, 3.2, 0.22);
      this.spawnPillar(ev.x, groundY, ev.z, 0xf43f5e, 1.7, 0.55);
      this.spawnCracks(ev.x, groundY, ev.z, 0xf97316, 6, 2.0, 1.0);
      this.spawnRubbleBurst(ev.x, groundY, ev.z, ev.radius ?? 3.6, 0xf43f5e);
      return;
    }

    if (ev.kind === 'omnislash') {
      const r = ev.radius ?? 6.5;
      this.spawnPointLightFlash(ev.x, groundY + 1.4, ev.z, 0xa855f7, 10.5, 0.4, 20);
      this.spawnPillar(ev.x, groundY, ev.z, 0xc084fc, 1.8, 0.65);
      this.spawnShockwave(ev.x, groundY + 0.12, ev.z, 0xa855f7, r * 1.4, 0.58);
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + 0.25;
        const ox = ev.x + Math.cos(ang) * (r * 0.35);
        const oz = ev.z + Math.sin(ang) * (r * 0.35);
        this.spawnSlash(ox, groundY + 1.1 + (i % 2) * 0.4, oz, ang, i % 2 === 0 ? 0xe879f9 : 0x9333ea, 2.2, Math.PI * 0.15, (i % 2 === 0 ? 1 : -1) * 26, (i % 2 === 0 ? 0.8 : -0.8));
      }
      this.spawnPuffs(ev.x, groundY + 0.8, ev.z, 0x1e1b4b, 6, 2.2, 2.0, 0.6, 2.1, 0.65, 0.6);
      return;
    }

    if (ev.kind === 'obstacleBreak') {
      this.spawnRubbleBurst(ev.x, groundY, ev.z, ev.radius ?? 2.8, ev.colorHex ?? 0x94a3b8);
    }
  }

  public syncBattleEvent(ev: BattlefieldEventState | null, mapId: MapId, elapsed: number): void {
    if (!ev || ev.kind === 'surge') {
      this.eventGroup.visible = false;
      return;
    }
    this.eventGroup.visible = true;
    const groundY = getMapTerrainHeight(mapId, ev.x, ev.z);
    this.eventGroup.position.set(ev.x, groundY + 0.14, ev.z);
    const pulse = 1.0 + Math.sin(elapsed * 6.5) * 0.04;
    this.eventGroup.scale.setScalar(ev.radius * pulse);
    this.eventOuterRing.material.color.setHex(ev.colorHex);
    this.eventInnerDisc.material.color.setHex(ev.colorHex);

    if (ev.kind === 'hazard') {
      this.eventOuterRing.material.opacity = 0.92;
      this.eventInnerDisc.material.opacity = ev.telegraphRemaining > 0 ? 0.25 + Math.sin(elapsed * 20) * 0.14 : 0.05;
    } else if (ev.kind === 'gravity') {
      this.eventOuterRing.material.opacity = 0.42;
      this.eventInnerDisc.material.opacity = 0.06;
    } else {
      this.eventOuterRing.material.opacity = 0.8;
      this.eventInnerDisc.material.opacity = 0.16;
    }
  }

  public syncZones(zones: ArenaZoneState[], mapId: MapId, elapsed: number): void {
    const activeIds = new Set<string>();
    for (const z of zones) {
      activeIds.add(z.id);
      let vis = this.zoneVisuals.get(z.id);
      if (!vis) {
        const group = new THREE.Group();
        const ring = new THREE.Mesh(
          this.zoneRingGeo,
          new THREE.MeshBasicMaterial({
            color: z.colorHex,
            transparent: true,
            opacity: 0.82,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          })
        );
        ring.rotation.x = -Math.PI * 0.5;
        const disc = new THREE.Mesh(
          this.zoneDiscGeo,
          new THREE.MeshBasicMaterial({
            color: z.colorHex,
            transparent: true,
            opacity: 0.18,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          })
        );
        disc.rotation.x = -Math.PI * 0.5;
        const extraGeo =
          z.kind === 'solarTripwire'
            ? this.tripwireBarGeo
            : z.kind === 'voidDecoy'
            ? this.decoySilhouetteGeo
            : this.zoneRingGeo;
        const extra = new THREE.Mesh(
          extraGeo,
          new THREE.MeshBasicMaterial({
            color: z.kind === 'voidDecoy' ? 0xc084fc : z.colorHex,
            transparent: true,
            opacity: z.kind === 'voidDecoy' ? 0.62 : 0.9,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        );
        if (z.kind !== 'solarTripwire' && z.kind !== 'voidDecoy') {
          extra.rotation.x = -Math.PI * 0.5;
          extra.scale.setScalar(0.55);
        }
        group.add(ring, disc, extra);
        this.scene.add(group);
        vis = { group, ring, disc, extra };
        this.zoneVisuals.set(z.id, vis);
      }

      const groundY = getMapTerrainHeight(mapId, z.x, z.z);
      const fade = Math.min(1, z.remaining / 0.6);
      const pulse = 1 + Math.sin(elapsed * 7.5 + z.x) * 0.05;

      if (z.kind === 'solarTripwire' && z.endX !== undefined && z.endZ !== undefined) {
        const endGround = getMapTerrainHeight(mapId, z.endX, z.endZ);
        const mx = (z.x + z.endX) * 0.5;
        const mz = (z.z + z.endZ) * 0.5;
        const my = (groundY + endGround) * 0.5 + z.y + 0.45;
        const len = Math.max(0.2, Math.hypot(z.endX - z.x, z.endZ - z.z));
        vis.group.position.set(mx, my, mz);
        vis.ring.position.set(z.x - mx, -0.32, z.z - mz);
        vis.ring.scale.setScalar(0.45);
        vis.disc.position.set(z.endX - mx, -0.32, z.endZ - mz);
        vis.disc.scale.setScalar(0.45);
        vis.extra.position.set(0, 0, 0);
        vis.extra.lookAt(z.endX, my, z.endZ);
        vis.extra.scale.set(1.4, 1.4, len);
        (vis.extra.material as THREE.MeshBasicMaterial).opacity = (0.65 + Math.sin(elapsed * 18) * 0.25) * fade;
        vis.ring.material.opacity = 0.85 * fade;
        vis.disc.material.opacity = 0.85 * fade;
      } else if (z.kind === 'voidDecoy') {
        vis.group.position.set(z.x, groundY + z.y + 0.08, z.z);
        vis.ring.scale.setScalar(z.radius * 0.5 * pulse);
        vis.disc.scale.setScalar(z.radius * 0.5);
        vis.extra.position.set(0, 0.85 + Math.sin(elapsed * 8) * 0.1, 0);
        vis.extra.rotation.y = elapsed * 4.0;
        (vis.extra.material as THREE.MeshBasicMaterial).opacity = 0.62 * fade;
        vis.ring.material.opacity = 0.72 * fade;
        vis.disc.material.opacity = 0.2 * fade;
      } else {
        vis.group.position.set(z.x, groundY + z.y + 0.09, z.z);
        vis.ring.scale.setScalar(z.radius * pulse);
        vis.disc.scale.setScalar(z.radius);
        const spinRate =
          z.kind === 'galeSnare'
            ? -5.0
            : z.kind === 'maelstromTornado' || z.kind === 'cat5Typhoon'
            ? -8.5
            : z.kind === 'shadowRift'
            ? 6.4
            : 3.2;
        vis.extra.rotation.z = elapsed * spinRate;
        vis.extra.scale.setScalar(z.radius * (0.45 + Math.sin(elapsed * 6) * 0.08));
        vis.ring.material.opacity = z.kind === 'cat5Typhoon' ? 0.92 * fade : 0.78 * fade;
        vis.disc.material.opacity =
          (z.kind === 'moltenFissure' || z.kind === 'magmaBranch'
            ? 0.34
            : z.kind === 'divineNova'
            ? 0.28
            : z.kind === 'shadowRift'
            ? 0.24
            : 0.16) * fade;
        (vis.extra.material as THREE.MeshBasicMaterial).opacity =
          (z.kind === 'cat5Typhoon' || z.kind === 'maelstromTornado' ? 0.8 : 0.55) * fade;
      }
    }

    for (const [id, vis] of this.zoneVisuals.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(vis.group);
        vis.ring.material.dispose();
        vis.disc.material.dispose();
        (vis.extra.material as THREE.Material).dispose();
        this.zoneVisuals.delete(id);
      }
    }
  }

  public syncStormRing(active: boolean, radius: number, _mapId: MapId, elapsed: number): void {
    if (!active) {
      this.stormGroup.visible = false;
      return;
    }
    this.stormGroup.visible = true;
    this.stormGroup.scale.set(radius, 1, radius);
    this.stormWall.rotation.y = elapsed * 0.45;
    this.stormWall.material.opacity = 0.2 + Math.sin(elapsed * 7.5) * 0.06;
    this.stormRing.material.opacity = 0.85 + Math.sin(elapsed * 12.0) * 0.14;
  }

  public syncChargingFireballs(actors: ArenaActorState[], mapId: MapId, elapsed: number): void {
    const activeIds = new Set<string>();
    for (const actor of actors) {
      const isCharging =
        actor.fighterId === 'jm' &&
        !actor.isKO &&
        actor.actionState === 'ultimate' &&
        actor.abilitySlot === 5 &&
        actor.y > 1.8;
      if (!isCharging) continue;
      activeIds.add(actor.playerId);

      let vis = this.chargingFireballs.get(actor.playerId);
      if (!vis) {
        const group = new THREE.Group();
        const core = new THREE.Mesh(
          this.solarFireballGeo,
          new THREE.MeshBasicMaterial({
            color: 0xfef9c3,
            transparent: true,
            opacity: 0.98,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        );
        const aura = new THREE.Mesh(
          this.solarAuraGeo,
          new THREE.MeshBasicMaterial({
            color: 0xfacc15,
            transparent: true,
            opacity: 0.55,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        );
        const halo = new THREE.Mesh(
          this.solarHaloGeo,
          new THREE.MeshBasicMaterial({
            color: 0xf97316,
            transparent: true,
            opacity: 0.78,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        );
        group.add(core, aura, halo);
        this.scene.add(group);
        vis = { group, core, aura, halo };
        this.chargingFireballs.set(actor.playerId, vis);
      }

      const groundY = getMapTerrainHeight(mapId, actor.x, actor.z);
      vis.group.position.set(actor.x, groundY + actor.y + 2.55, actor.z);
      const prog = actor.actionDuration > 0 ? Math.min(1, (actor.actionDuration - actor.actionTimer) / 1.25) : 1;
      const sc = 0.35 + prog * 1.1 + Math.sin(elapsed * 22) * 0.06;
      vis.group.scale.setScalar(sc);
      vis.halo.rotation.x = elapsed * 6.5;
      vis.halo.rotation.y = elapsed * 4.5;
      if (Math.random() < 0.55) {
        this.spawnSparks(actor.x, groundY + actor.y + 2.55, actor.z, 0xfef08a, 1, 0.7, -4, 0.25);
      }
    }

    for (const [id, vis] of this.chargingFireballs.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(vis.group);
        (vis.core.material as THREE.Material).dispose();
        (vis.aura.material as THREE.Material).dispose();
        (vis.halo.material as THREE.Material).dispose();
        this.chargingFireballs.delete(id);
      }
    }
  }

  public syncTelegraphs(telegraphs: TelegraphState[], mapId: MapId, elapsed: number): void {
    const activeIds = new Set<string>();
    for (const tel of telegraphs) {
      activeIds.add(tel.id);
      let vis = this.telegraphVisuals.get(tel.id);
      if (vis && vis.kind !== tel.kind) {
        this.scene.remove(vis.group);
        (vis.border.material as THREE.Material).dispose();
        (vis.fill.material as THREE.Material).dispose();
        (vis.rune.material as THREE.Material).dispose();
        this.telegraphVisuals.delete(tel.id);
        vis = undefined;
      }
      if (!vis) {
        const group = new THREE.Group();
        const borderMat = new THREE.MeshBasicMaterial({
          color: tel.colorHex === 0xfacc15 ? 0xfacc15 : 0xf43f5e,
          transparent: true,
          opacity: 0.94,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        });
        const fillMat = new THREE.MeshBasicMaterial({
          color: tel.colorHex,
          transparent: true,
          opacity: 0.36,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        });
        const runeMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.72,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -3,
          polygonOffsetUnits: -3,
        });
        let border: THREE.Mesh;
        let fill: THREE.Mesh;
        const rune = new THREE.Mesh(this.runeOctGeo, runeMat);
        rune.rotation.x = -Math.PI * 0.5;
        if (tel.kind === 'circle') {
          border = new THREE.Mesh(this.zoneRingGeo, borderMat);
          border.rotation.x = -Math.PI * 0.5;
          fill = new THREE.Mesh(this.zoneDiscGeo, fillMat);
          fill.rotation.x = -Math.PI * 0.5;
        } else if (tel.kind === 'line') {
          border = new THREE.Mesh(this.unitPlaneGeo, borderMat);
          borderMat.opacity = 0.28;
          fill = new THREE.Mesh(this.unitPlaneGeo, fillMat);
          fillMat.opacity = 0.55;
          rune.visible = false;
        } else {
          border = new THREE.Mesh(this.coneWedgeGeo, borderMat);
          borderMat.opacity = 0.28;
          fill = new THREE.Mesh(this.coneWedgeGeo, fillMat);
          fillMat.opacity = 0.5;
          rune.visible = false;
        }
        group.add(border, fill, rune);
        this.scene.add(group);
        vis = { group, border, fill, rune, kind: tel.kind };
        this.telegraphVisuals.set(tel.id, vis);
      }

      const groundY = getMapTerrainHeight(mapId, tel.x, tel.z);
      vis.group.position.set(tel.x, groundY + tel.y + 0.12, tel.z);
      const yaw = Math.atan2(tel.dirX, tel.dirZ);
      const pulse = 0.8 + Math.sin(elapsed * 26) * 0.2;

      if (tel.kind === 'circle') {
        vis.border.scale.setScalar(tel.radius);
        vis.fill.scale.setScalar(Math.max(0.15, tel.radius * tel.progress));
        vis.rune.visible = true;
        vis.rune.scale.setScalar(tel.radius * 0.88);
        vis.rune.rotation.z = elapsed * 2.8;
        (vis.border.material as THREE.MeshBasicMaterial).opacity = 0.94 * pulse;
        (vis.fill.material as THREE.MeshBasicMaterial).opacity = 0.2 + tel.progress * 0.36;
        (vis.rune.material as THREE.MeshBasicMaterial).opacity = 0.5 + tel.progress * 0.4;
      } else if (tel.kind === 'line') {
        vis.group.rotation.set(0, yaw, 0);
        const w = Math.max(1.2, tel.radius * 2);
        vis.border.scale.set(w, 1, tel.length);
        vis.fill.scale.set(w * 0.92, 1, Math.max(0.4, tel.length * tel.progress));
        (vis.border.material as THREE.MeshBasicMaterial).opacity = 0.3 * pulse;
        (vis.fill.material as THREE.MeshBasicMaterial).opacity = 0.26 + tel.progress * 0.42;
      } else {
        vis.group.rotation.set(0, yaw, 0);
        vis.border.scale.setScalar(tel.length);
        vis.fill.scale.setScalar(Math.max(0.4, tel.length * tel.progress));
        (vis.border.material as THREE.MeshBasicMaterial).opacity = 0.28 * pulse;
        (vis.fill.material as THREE.MeshBasicMaterial).opacity = 0.24 + tel.progress * 0.4;
      }
    }

    for (const [id, vis] of this.telegraphVisuals.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(vis.group);
        (vis.border.material as THREE.Material).dispose();
        (vis.fill.material as THREE.Material).dispose();
        (vis.rune.material as THREE.Material).dispose();
        this.telegraphVisuals.delete(id);
      }
    }
  }

  public syncAimPreview(aim: AimPreviewState | undefined, mapId: MapId, elapsed: number): void {
    if (!aim || !aim.active || aim.aimKind === 'none') {
      this.aimGroup.visible = false;
      this.aimDropLine.visible = false;
      return;
    }

    this.aimGroup.visible = true;
    const color = aim.cancelled ? 0xf43f5e : aim.colorHex;
    const pulse = 1 + Math.sin(elapsed * 11) * 0.04;

    this.aimPointRing.visible = false;
    this.aimPointInner.visible = false;
    this.aimPointDisc.visible = false;
    this.aimLineStrip.visible = false;
    this.aimLineArrow.visible = false;
    this.aimLineOriginRing.visible = false;
    this.aimConeWedge.visible = false;

    const aimGroundY = getMapTerrainHeight(mapId, aim.aimX, aim.aimZ);
    const originGroundY = getMapTerrainHeight(mapId, aim.originX, aim.originZ);
    if ((aim.originY ?? 0) > 0.65) {
      const ox = aim.originX;
      const oy = originGroundY + (aim.originY ?? 0) + 0.6;
      const oz = aim.originZ;
      const tx = aim.aimX;
      const ty = aimGroundY + 0.18;
      const tz = aim.aimZ;
      const dist = Math.hypot(tx - ox, ty - oy, tz - oz);
      if (dist > 0.2) {
        this.aimDropLine.visible = true;
        this.aimDropLine.position.set((ox + tx) * 0.5, (oy + ty) * 0.5, (oz + tz) * 0.5);
        this.aimDropLine.lookAt(tx, ty, tz);
        this.aimDropLine.scale.set(1.2, 1.2, dist);
        this.aimDropLine.material.color.setHex(color);
      } else {
        this.aimDropLine.visible = false;
      }
    } else {
      this.aimDropLine.visible = false;
    }

    if (aim.aimKind === 'point') {
      this.aimGroup.position.set(aim.aimX, aimGroundY + 0.16, aim.aimZ);
      this.aimGroup.rotation.set(0, 0, 0);
      this.aimPointRing.visible = true;
      this.aimPointInner.visible = true;
      this.aimPointDisc.visible = true;
      this.aimPointRing.scale.setScalar(aim.radius * pulse);
      this.aimPointInner.scale.setScalar(aim.radius * 0.85);
      this.aimPointInner.rotation.z = elapsed * 2.4;
      this.aimPointDisc.scale.setScalar(aim.radius);
      this.aimPointRing.material.color.setHex(color);
      this.aimPointInner.material.color.setHex(aim.cancelled ? 0xfda4af : 0xffffff);
      this.aimPointDisc.material.color.setHex(color);
      this.aimPointRing.material.opacity = aim.cancelled ? 0.55 : 0.96;
      this.aimPointDisc.material.opacity = aim.cancelled ? 0.12 : 0.28;
    } else if (aim.aimKind === 'line') {
      const dx = aim.aimX - aim.originX;
      const dz = aim.aimZ - aim.originZ;
      const yaw = Math.hypot(dx, dz) > 0.05 ? Math.atan2(dx, dz) : 0;
      this.aimGroup.position.set(aim.originX, originGroundY + 0.16, aim.originZ);
      this.aimGroup.rotation.set(0, yaw, 0);
      this.aimLineStrip.visible = true;
      this.aimLineArrow.visible = true;
      this.aimLineOriginRing.visible = true;
      this.aimLineStrip.scale.set(aim.radius * 2, 1, aim.range);
      this.aimLineArrow.position.set(0, 0.25, aim.range);
      this.aimLineArrow.scale.set(aim.radius * 0.65, 0.4, 1.1);
      this.aimLineArrow.material.color.setHex(color);
      this.aimLineOriginRing.scale.setScalar(1.35 * pulse);
      this.aimLineStrip.material.color.setHex(color);
      this.aimLineStrip.material.opacity = aim.cancelled ? 0.16 : 0.42;
      this.aimLineOriginRing.material.color.setHex(color);
    } else if (aim.aimKind === 'cone') {
      const dx = aim.aimX - aim.originX;
      const dz = aim.aimZ - aim.originZ;
      const yaw = Math.hypot(dx, dz) > 0.05 ? Math.atan2(dx, dz) : 0;
      this.aimGroup.position.set(aim.originX, originGroundY + 0.16, aim.originZ);
      this.aimGroup.rotation.set(0, yaw, 0);
      this.aimConeWedge.visible = true;
      this.aimConeWedge.scale.setScalar(aim.range * pulse);
      this.aimConeWedge.material.color.setHex(color);
      this.aimConeWedge.material.opacity = aim.cancelled ? 0.14 : 0.38;
    }
  }

  public syncPickups(pickups: ArenaPickup[], mapId: MapId, elapsed: number): void {
    const seen = new Set<string>();
    for (const pk of pickups) {
      seen.add(pk.id);
      let vis = this.pickupVisuals.get(pk.id);
      if (!vis) {
        const group = new THREE.Group();
        const hex = pk.kind === 'health' ? 0x10b981 : 0x38bdf8;
        const orbMat = new THREE.MeshStandardMaterial({
          color: hex,
          emissive: hex,
          emissiveIntensity: 0.9,
          roughness: 0.2,
          metalness: 0.35,
        });
        const orb = new THREE.Mesh(this.pickupOrbGeo, orbMat);
        const ring = new THREE.Mesh(
          this.pickupRingGeo,
          new THREE.MeshBasicMaterial({
            color: hex,
            transparent: true,
            opacity: 0.72,
            side: THREE.DoubleSide,
          })
        );
        ring.rotation.x = -Math.PI * 0.5;
        ring.position.y = -0.52;
        group.add(orb, ring);
        this.scene.add(group);
        vis = { group, orb, ring };
        this.pickupVisuals.set(pk.id, vis);
      }

      const groundY = getMapTerrainHeight(mapId, pk.x, pk.z);
      vis.group.position.set(pk.x, groundY + pk.y, pk.z);
      vis.orb.visible = pk.active;
      vis.orb.rotation.y = elapsed * 2.4;
      vis.orb.position.y = Math.sin(elapsed * 3.4 + pk.x) * 0.14;
      (vis.ring.material as THREE.MeshBasicMaterial).opacity = pk.active ? 0.75 : 0.18;
    }

    for (const [id, vis] of this.pickupVisuals.entries()) {
      if (!seen.has(id)) {
        this.scene.remove(vis.group);
        (vis.orb.material as THREE.Material).dispose();
        (vis.ring.material as THREE.Material).dispose();
        this.pickupVisuals.delete(id);
      }
    }
  }

  private getProjectileMaterial(kind: ProjectileState['kind'], colorHex: number, boosted: boolean): THREE.MeshBasicMaterial {
    const resolvedColor =
      kind === 'crescent' && boosted
        ? 0xe879f9
        : kind === 'windBlade'
        ? 0x22d3ee
        : kind === 'solarRailgun'
        ? 0xfef08a
        : kind === 'tornadoVortex'
        ? 0x38bdf8
        : kind === 'solarFireball'
        ? 0xfef08a
        : kind === 'jmBeam'
        ? 0xfef9c3
        : colorHex;
    const key = `${kind}:${resolvedColor}`;
    let mat = this.projMaterials.get(key);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        color: resolvedColor,
        transparent: true,
        opacity: kind === 'tornado' || kind === 'tornadoVortex' ? 0.86 : 0.96,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this.projMaterials.set(key, mat);
    }
    return mat;
  }

  public syncProjectiles(projectiles: ProjectileState[], mapId: MapId, dt: number): void {
    const activeIds = new Set(projectiles.map((p) => p.id));
    for (const [id, mesh] of this.projMeshes.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(mesh);
        this.projMeshes.delete(id);
      }
    }
    for (const [id, tMesh] of this.projTethers.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(tMesh);
        this.projTethers.delete(id);
      }
    }

    for (const p of projectiles) {
      let mesh = this.projMeshes.get(p.id);
      if (!mesh) {
        const geo =
          p.kind === 'solarFireball'
            ? this.solarFireballGeo
            : p.kind === 'tornado' || p.kind === 'tornadoVortex'
            ? this.tornadoGeo
            : p.kind === 'jmBeam'
            ? this.jmBeamGeo
            : p.kind === 'jmBolt'
            ? this.jmBoltGeo
            : p.kind === 'lasso'
            ? this.lassoGeo
            : p.kind === 'crescent'
            ? this.crescentGeo
            : p.kind === 'windBlade'
            ? this.windBladeGeo
            : p.kind === 'solarRailgun'
            ? this.solarRailgunGeo
            : p.kind === 'magnum'
            ? this.magnumGeo
            : this.bulletGeo;
        const boosted = Boolean(p.isComboLink || p.isOverdrive);
        const mat = this.getProjectileMaterial(p.kind, p.colorHex, boosted);
        mesh = new THREE.Mesh(geo, mat);
        if (p.kind === 'lasso' || p.kind === 'crescent' || p.kind === 'windBlade') {
          mesh.rotation.x = Math.PI * 0.5;
        }
        if (p.kind === 'crescent' && boosted) {
          mesh.scale.set(1.85, 1.85, 1.5);
        } else if (p.kind === 'tornadoVortex') {
          mesh.scale.set(2.3, 2.2, 2.3);
        }
        this.scene.add(mesh);
        this.projMeshes.set(p.id, mesh);
      }
      const pGroundY = getMapTerrainHeight(mapId, p.x, p.z);
      const py = Math.max(0.25, p.y);
      mesh.position.set(p.x, p.kind === 'solarFireball' ? py : pGroundY + py - 0.1, p.z);
      if (p.kind === 'solarFireball') {
        mesh.scale.setScalar(1.25 + Math.sin(this.elapsedTime * 30) * 0.1);
        if (Math.random() < 0.45) {
          this.spawnPuffs(p.x, py, p.z, 0xf97316, 1, 0.9, 1.8, 0.65, 1.8, 0.32, 0.48);
          this.spawnSparks(p.x, py, p.z, 0xfef08a, 1, 0.9, 6, 0.26);
        }
      } else if (p.kind === 'tornado' || p.kind === 'tornadoVortex') {
        const isCat5 = p.kind === 'tornadoVortex';
        mesh.rotation.y += dt * (isCat5 ? 24 : 18);
        const pulse = (isCat5 ? 2.25 : 0.95) + Math.sin(this.elapsedTime * 25) * 0.14;
        mesh.scale.set(pulse, isCat5 ? 2.15 : 1.05, pulse);
        if (Math.random() < (isCat5 ? 0.65 : 0.38)) {
          this.spawnSparks(p.x, pGroundY + py + 0.45, p.z, isCat5 ? 0x22d3ee : 0x5eead4, 1, 1.2, 2, 0.24);
        }
      } else if (p.kind === 'jmBeam') {
        mesh.rotation.y = p.rotY;
        const pulse = 0.95 + Math.sin(this.elapsedTime * 40) * 0.15;
        mesh.scale.set(pulse, pulse, 1.15);
        if (Math.random() < 0.5) {
          this.spawnSparks(p.x, pGroundY + py, p.z, 0xfef08a, 1, 0.8, 4, 0.22);
        }
      } else if (p.kind === 'jmBolt') {
        mesh.scale.setScalar(1.0 + Math.sin(this.elapsedTime * 35) * 0.15);
        if (Math.random() < 0.35) {
          this.spawnSparks(p.x, pGroundY + py, p.z, 0xfacc15, 1, 0.6, 2, 0.18);
        }
      } else if (p.kind === 'crescent' || p.kind === 'windBlade') {
        mesh.rotation.z = -p.rotY + Math.PI * 0.5;
        if (Math.random() < 0.32) {
          this.spawnPuffs(p.x, pGroundY + py, p.z, p.kind === 'windBlade' ? 0x22d3ee : 0x7e22ce, 1, 0.25, 0.5, 0.25, 0.75, 0.22, 0.4);
        }
      } else if (p.kind === 'magnum' || p.kind === 'solarRailgun') {
        mesh.rotation.y = p.rotY;
        if (p.kind === 'solarRailgun' && Math.random() < 0.45) {
          this.spawnSparks(p.x, pGroundY + py, p.z, 0xfacc15, 1, 0.8, 2, 0.18);
        }
      } else if (p.kind === 'lasso') {
        mesh.rotation.z += dt * 12;
        let tether = this.projTethers.get(p.id);
        if (!tether) {
          tether = new THREE.Mesh(this.tetherGeo, this.lassoTetherMat);
          this.scene.add(tether);
          this.projTethers.set(p.id, tether);
        }
        const ownerPos = this.actorPositions.get(p.ownerId);
        const ox = ownerPos?.x ?? p.originX ?? p.x;
        const oy = (ownerPos?.y ?? 0) + 1.05;
        const oz = ownerPos?.z ?? p.originZ ?? p.z;
        const dist = Math.hypot(p.x - ox, pGroundY + py - oy, p.z - oz);
        if (dist > 0.1) {
          tether.visible = true;
          tether.position.set((ox + p.x) * 0.5, (oy + pGroundY + py) * 0.5, (oz + p.z) * 0.5);
          tether.lookAt(p.x, pGroundY + py, p.z);
          tether.scale.set(1.1, 1.1, dist);
        }
      }
    }
  }

  public syncAwakeningOrbs(orbs: AwakeningOrbState[], mapId: MapId, elapsed: number): void {
    const activeIds = new Set<string>();
    const maxParticles = this.isMobileDevice
      ? AWAKENING_CONFIG.MAX_ORB_COLUMN_PARTICLES_MOBILE
      : AWAKENING_CONFIG.MAX_ORB_COLUMN_PARTICLES_DESKTOP;

    for (const orb of orbs) {
      if (!orb.active && orb.fadeTimer <= 0) continue;
      activeIds.add(orb.id);
      let vis = this.awakeningOrbVisuals.get(orb.id);
      if (!vis) {
        const group = new THREE.Group();
        const crystalMat = new THREE.MeshStandardMaterial({
          color: 0xfef08a,
          emissive: 0x38bdf8,
          emissiveIntensity: 1.65,
          roughness: 0.15,
          metalness: 0.5,
          transparent: true,
          opacity: 0.96,
        });
        const crystal = new THREE.Mesh(this.orbCrystalGeo, crystalMat);
        const ringAMat = new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.86,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const ringA = new THREE.Mesh(this.orbRingGeo, ringAMat);
        const ringBMat = new THREE.MeshBasicMaterial({
          color: 0xfacc15,
          transparent: true,
          opacity: 0.86,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const ringB = new THREE.Mesh(this.orbRingGeo, ringBMat);
        ringB.rotation.x = Math.PI * 0.5;

        const columnMat = new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.24,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const column = new THREE.Mesh(this.orbColumnGeo, columnMat);
        column.position.y = -AWAKENING_CONFIG.ORB_HOVER_HEIGHT;

        const haloSprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: this.orbGlowTex ?? undefined,
            color: 0xfef08a,
            transparent: true,
            opacity: 0.82,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        );
        haloSprite.scale.set(3.2, 3.2, 1);

        const labelSprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: this.orbLabelTex ?? undefined,
            transparent: true,
            opacity: 0.98,
            depthTest: false,
            depthWrite: false,
          })
        );
        labelSprite.position.set(0, 1.95, 0);
        labelSprite.scale.set(4.1, 1.05, 1);
        labelSprite.renderOrder = 25;

        const pointLight = new THREE.PointLight(0x38bdf8, 4.2, 14, 1.6);
        pointLight.position.set(0, 0.4, 0);

        const particles: AwakeningOrbVisual['particles'] = [];
        for (let i = 0; i < maxParticles; i++) {
          const pMat = new THREE.MeshBasicMaterial({
            color: i % 2 === 0 ? 0xfef08a : 0x38bdf8,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const pMesh = new THREE.Mesh(this.orbParticleGeo, pMat);
          group.add(pMesh);
          particles.push({
            mesh: pMesh,
            phase: i / maxParticles,
            radius: 0.45 + (i % 3) * 0.22,
            speed: 0.55 + (i % 4) * 0.14,
          });
        }

        group.add(column, crystal, ringA, ringB, haloSprite, labelSprite, pointLight);
        this.scene.add(group);
        vis = { group, crystal, ringA, ringB, column, haloSprite, labelSprite, pointLight, particles };
        this.awakeningOrbVisuals.set(orb.id, vis);
      }

      const groundY = getMapTerrainHeight(mapId, orb.x, orb.z);
      const bob = Math.sin(elapsed * 2.8 + orb.x) * AWAKENING_CONFIG.ORB_BOB_AMPLITUDE;
      vis.group.position.set(orb.x, groundY + orb.y + bob, orb.z);

      const fade = orb.active
        ? 1
        : Math.max(0, Math.min(1, orb.fadeTimer / Math.max(0.01, AWAKENING_CONFIG.ORB_FADEOUT_SEC)));

      vis.crystal.rotation.y = elapsed * AWAKENING_CONFIG.ORB_ROTATION_SPEED;
      vis.crystal.rotation.x = Math.sin(elapsed * 1.4) * 0.25;
      vis.crystal.material.opacity = 0.96 * fade;

      vis.ringA.rotation.x = elapsed * 1.6;
      vis.ringA.rotation.y = elapsed * 1.1;
      vis.ringA.material.opacity = 0.85 * fade;

      vis.ringB.rotation.y = -elapsed * 1.8;
      vis.ringB.rotation.z = elapsed * 1.2;
      vis.ringB.material.opacity = 0.85 * fade;

      const pulse = 1 + Math.sin(elapsed * 5.2) * 0.12;
      vis.column.material.opacity = (0.18 + Math.sin(elapsed * 4.5) * 0.06) * fade;
      vis.column.scale.set(pulse, 1, pulse);

      (vis.haloSprite.material as THREE.SpriteMaterial).opacity = (0.72 + Math.sin(elapsed * 6.0) * 0.16) * fade;
      vis.haloSprite.scale.setScalar((3.1 + Math.sin(elapsed * 4.5) * 0.35) * (0.7 + fade * 0.3));

      (vis.labelSprite.material as THREE.SpriteMaterial).opacity = fade;
      const labelPulse = 1 + Math.sin(elapsed * 4.2) * 0.07;
      vis.labelSprite.scale.set(4.1 * labelPulse, 1.05 * labelPulse, 1);
      vis.pointLight.intensity = (3.8 + Math.sin(elapsed * 5.0) * 0.9) * fade;

      for (const pt of vis.particles) {
        const t = (elapsed * pt.speed + pt.phase) % 1;
        const ang = t * Math.PI * 4 + pt.phase * 12;
        pt.mesh.position.set(
          Math.cos(ang) * pt.radius,
          -AWAKENING_CONFIG.ORB_HOVER_HEIGHT + t * 8.5,
          Math.sin(ang) * pt.radius
        );
        pt.mesh.rotation.y = elapsed * 5;
        pt.mesh.scale.setScalar((1 - t * 0.45) * (0.8 + fade * 0.3));
        pt.mesh.material.opacity = Math.sin(t * Math.PI) * 0.9 * fade;
      }
    }

    for (const [id, vis] of this.awakeningOrbVisuals.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(vis.group);
        vis.crystal.material.dispose();
        vis.ringA.material.dispose();
        vis.ringB.material.dispose();
        vis.column.material.dispose();
        (vis.haloSprite.material as THREE.Material).dispose();
        (vis.labelSprite.material as THREE.Material).dispose();
        for (const pt of vis.particles) pt.mesh.material.dispose();
        this.awakeningOrbVisuals.delete(id);
      }
    }
  }

  public syncCutsceneClashVfx(
    cutscene: AwakeningCutsceneState | null,
    p1: ArenaActorState | undefined,
    p2: ArenaActorState | undefined,
    mapId: MapId,
    elapsed: number,
    dt: number
  ): void {
    const showClash =
      Boolean(cutscene) &&
      cutscene!.clockSec >= AWAKENING_CONFIG.TIMELINE.CLASH_START_AT &&
      !cutscene!.resolved;

    if (!showClash || !cutscene) {
      this.cutsceneClashGroup.visible = false;
      return;
    }

    const kit1 = AWAKENING_CONFIG.AWAKENED_KITS[cutscene.p1FighterId];
    const kit2 = AWAKENING_CONFIG.AWAKENED_KITS[cutscene.p2FighterId];
    const p1Color = kit1.auraPrimaryHex;
    const p2Color =
      cutscene.p1FighterId === cutscene.p2FighterId ? kit2.auraSecondaryHex : kit2.auraPrimaryHex;

    const halfSep = AWAKENING_CONFIG.CLASH_SEPARATION_DISTANCE * 0.5;
    const p1X = p1?.x ?? -halfSep;
    const p2X = p2?.x ?? halfSep;
    const p1Z = p1?.z ?? 0;
    const p2Z = p2?.z ?? 0;
    const groundMid = getMapTerrainHeight(mapId, (p1X + p2X) * 0.5, (p1Z + p2Z) * 0.5);
    const beamY = groundMid + 1.25;

    const clashX = THREE.MathUtils.lerp(p1X, p2X, (cutscene.clashBalance + 1) * 0.5);
    const clashZ = THREE.MathUtils.lerp(p1Z, p2Z, (cutscene.clashBalance + 1) * 0.5);

    this.cutsceneClashGroup.visible = true;
    const len1 = Math.max(0.6, Math.hypot(clashX - p1X, clashZ - p1Z));
    const len2 = Math.max(0.6, Math.hypot(p2X - clashX, p2Z - clashZ));
    const yaw = Math.atan2(p2Z - p1Z, p2X - p1X);

    const pulse1 = 1.0 + Math.sin(elapsed * 32) * 0.14 + Math.min(0.45, cutscene.p1Overdrive * 0.3);
    const pulse2 = 1.0 + Math.cos(elapsed * 34) * 0.14 + Math.min(0.45, cutscene.p2Overdrive * 0.3);

    this.cutsceneP1Beam.material.color.setHex(p1Color);
    this.cutsceneP1Beam.position.set((p1X + clashX) * 0.5, beamY, (p1Z + clashZ) * 0.5);
    this.cutsceneP1Beam.rotation.set(0, -yaw, 0);
    this.cutsceneP1Beam.scale.set(len1, pulse1, pulse1);

    this.cutsceneP2Beam.material.color.setHex(p2Color);
    this.cutsceneP2Beam.position.set((p2X + clashX) * 0.5, beamY, (p2Z + clashZ) * 0.5);
    this.cutsceneP2Beam.rotation.set(0, -yaw, 0);
    this.cutsceneP2Beam.scale.set(len2, pulse2, pulse2);

    this.cutsceneCore.position.set(clashX, beamY, clashZ);
    const coreScale = 0.85 + Math.sin(elapsed * 28) * 0.18;
    this.cutsceneCore.scale.setScalar(coreScale);

    this.cutsceneCoreRing.position.set(clashX, beamY, clashZ);
    this.cutsceneCoreRing.rotation.y = yaw + Math.PI * 0.5;
    this.cutsceneCoreRing.rotation.z = elapsed * 12;
    this.cutsceneCoreRing.scale.setScalar(0.9 + Math.cos(elapsed * 24) * 0.15);

    this.clashSparkTimer -= dt;
    if (this.clashSparkTimer <= 0) {
      this.clashSparkTimer = 0.09;
      this.spawnSparks(clashX, beamY, clashZ, 0xfef08a, 4, 1.4, 8, 0.25);
    }
  }

  public update(dt: number): void {
    this.elapsedTime += dt;
    // Delayed choreographed bursts (Launch apex puff, Shatter burst)
    for (let i = this.delayedTasks.length - 1; i >= 0; i--) {
      const task = this.delayedTasks[i];
      task.delay -= dt;
      if (task.delay <= 0) {
        this.delayedTasks.splice(i, 1);
        task.run();
      }
    }

    for (const fl of this.coreFlashes) {
      if (!fl.mesh.visible) continue;
      fl.life -= dt;
      if (fl.life <= 0) fl.mesh.visible = false;
      else {
        const u = 1 - fl.life / fl.maxLife;
        const s = u < 0.35 ? THREE.MathUtils.lerp(0.4, fl.peakScale, u / 0.35) : THREE.MathUtils.lerp(fl.peakScale, 0.1, (u - 0.35) / 0.65);
        fl.mesh.scale.setScalar(s);
        fl.mesh.material.opacity = (1 - u) * 0.95;
      }
    }

    for (const sw of this.shockwaves) {
      if (!sw.mesh.visible) continue;
      sw.age += dt;
      if (sw.age >= sw.maxAge) {
        sw.mesh.visible = false;
      } else {
        const u = sw.age / sw.maxAge;
        const sc = sw.reverse ? sw.startScale * (1 - u * 0.88) : sw.startScale + u * sw.maxRadius;
        sw.mesh.scale.setScalar(sc);
        sw.mesh.material.opacity = (1 - u) * 0.44;
      }
    }

    for (const sl of this.slashes) {
      if (!sl.mesh.visible) continue;
      sl.life -= dt;
      if (sl.life <= 0) sl.mesh.visible = false;
      else {
        const u = sl.life / sl.maxLife;
        sl.mesh.rotation.z += sl.spinSpeed * dt;
        sl.mesh.scale.addScalar(sl.growSpeed * dt);
        sl.mesh.material.opacity = u * 0.96;
      }
    }

    for (const fn of this.funnels) {
      if (!fn.mesh.visible) continue;
      fn.life -= dt;
      if (fn.life <= 0) fn.mesh.visible = false;
      else {
        const u = 1 - fn.life / fn.maxLife;
        const sx = THREE.MathUtils.lerp(fn.startScaleX, fn.endScaleX, u);
        fn.mesh.scale.set(sx, fn.scaleY, sx);
        fn.mesh.rotation.y += fn.spinSpeed * dt;
        fn.mesh.material.opacity = (1 - u) * 0.84;
      }
    }

    for (const tr of this.tracers) {
      if (!tr.mesh.visible) continue;
      tr.life -= dt;
      if (tr.life <= 0) tr.mesh.visible = false;
      else {
        const u = tr.life / tr.maxLife;
        tr.mesh.scale.x = tr.startScaleX * u;
        tr.mesh.scale.y = tr.startScaleX * u;
        tr.mesh.material.opacity = u * 0.94;
      }
    }

    for (const sp of this.sparks) {
      if (!sp.mesh.visible) continue;
      sp.life -= dt;
      if (sp.life <= 0) {
        sp.mesh.visible = false;
      } else {
        sp.mesh.position.x += sp.vx * dt;
        sp.mesh.position.y += sp.vy * dt;
        sp.mesh.position.z += sp.vz * dt;
        sp.vy -= sp.gravity * dt;
        if (sp.orientToVel) {
          _tmpDir.set(sp.vx, sp.vy, sp.vz);
          if (_tmpDir.lengthSq() > 0.001) {
            _tmpDir.normalize();
            _quat.setFromUnitVectors(_upVec, _tmpDir);
            sp.mesh.quaternion.copy(_quat);
          }
        }
        sp.mesh.material.opacity = sp.life / sp.maxLife;
      }
    }

    for (const pf of this.puffs) {
      if (!pf.mesh.visible) continue;
      pf.life -= dt;
      if (pf.life <= 0) {
        pf.mesh.visible = false;
      } else {
        const u = 1 - pf.life / pf.maxLife;
        pf.mesh.position.x += pf.vx * dt;
        pf.mesh.position.y += pf.vy * dt;
        pf.mesh.position.z += pf.vz * dt;
        pf.mesh.scale.setScalar(THREE.MathUtils.lerp(pf.startScale, pf.endScale, u));
        pf.mesh.material.opacity = (1 - u) * pf.baseOpacity;
      }
    }

    for (const cr of this.cracks) {
      if (!cr.mesh.visible) continue;
      cr.life -= dt;
      if (cr.life <= 0) cr.mesh.visible = false;
      else cr.mesh.material.opacity = (cr.life / cr.maxLife) * 0.9;
    }

    for (const cs of this.casings) {
      if (!cs.mesh.visible) continue;
      cs.life -= dt;
      if (cs.life <= 0) {
        cs.mesh.visible = false;
      } else {
        cs.mesh.position.x += cs.vx * dt;
        cs.mesh.position.y += cs.vy * dt;
        cs.mesh.position.z += cs.vz * dt;
        cs.vy -= 18 * dt;
        if (cs.mesh.position.y < cs.floorY) {
          cs.mesh.position.y = cs.floorY;
          cs.vy = Math.abs(cs.vy) * 0.4;
          cs.vx *= 0.65;
          cs.vz *= 0.65;
        }
        cs.mesh.rotation.x += dt * 16;
        cs.mesh.rotation.z += dt * 12;
        (cs.mesh.material as THREE.MeshStandardMaterial).opacity = Math.min(1, (cs.life / cs.maxLife) * 1.4);
      }
    }

    for (const db of this.vortexDebris) {
      if (!db.mesh.visible) continue;
      db.life -= dt;
      if (db.life <= 0) {
        db.mesh.visible = false;
      } else {
        db.angle += db.angularSpeed * dt;
        db.radius = Math.max(0.2, db.radius - db.inwardSpeed * dt);
        db.mesh.position.set(
          db.centerX + Math.cos(db.angle) * db.radius,
          db.centerY + db.heightOffset + (1 - db.life / db.maxLife) * 0.65,
          db.centerZ + Math.sin(db.angle) * db.radius
        );
        db.mesh.rotation.set(db.angle, db.angle * 0.7, 0);
        db.mesh.material.opacity = (db.life / db.maxLife) * 0.9;
      }
    }

    for (const g of this.ghosts) {
      if (!g.mesh.visible) continue;
      g.life -= dt;
      if (g.life <= 0) g.mesh.visible = false;
      else {
        g.mesh.position.x += g.vx * dt;
        g.mesh.position.y += g.vy * dt;
        g.mesh.position.z += g.vz * dt;
        g.mesh.material.opacity = (g.life / g.maxLife) * g.baseOpacity;
      }
    }

    for (const b of this.beams) {
      if (!b.mesh.visible) continue;
      b.life -= dt;
      if (b.life <= 0) b.mesh.visible = false;
      else {
        const u = b.life / b.maxLife;
        b.mesh.material.opacity = u * 0.65;
        b.mesh.scale.set(0.65 + u * 0.65, 0.65 + u * 0.65, 1);
        b.coilA.rotation.z += dt * 12;
        b.coilB.rotation.z += dt * 12;
        b.coilA.material.opacity = u * 0.7;
        b.coilB.material.opacity = u * 0.62;
      }
    }

    for (const pl of this.pillars) {
      if (!pl.mesh.visible) continue;
      pl.life -= dt;
      if (pl.life <= 0) pl.mesh.visible = false;
      else {
        const u = pl.life / pl.maxLife;
        pl.mesh.material.opacity = u * 0.28;
        pl.mesh.scale.x = pl.baseScale * (0.7 + u * 0.35);
        pl.mesh.scale.z = pl.baseScale * (0.7 + u * 0.35);
      }
    }

    for (const sc of this.stormClouds) {
      if (!sc.group.visible) continue;
      sc.life -= dt;
      if (sc.life <= 0) sc.group.visible = false;
      else {
        sc.group.rotation.y += dt * 0.85;
        const u = Math.sin((sc.life / sc.maxLife) * Math.PI);
        sc.group.children.forEach((c) => {
          ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = u * 0.72;
        });
      }
    }

    for (const mg of this.markGlyphs) {
      if (!mg.group.visible) continue;
      mg.life -= dt;
      if (mg.life <= 0) mg.group.visible = false;
      else {
        const u = 1 - mg.life / mg.maxLife;
        mg.group.rotation.z += dt * 5;
        mg.group.scale.setScalar(0.5 + u * 0.75);
        mg.group.children.forEach((c) => {
          ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (1 - u) * 0.92;
        });
      }
    }

    for (const sg of this.spellSigils) {
      if (!sg.group.visible) continue;
      sg.life -= dt;
      if (sg.life <= 0) sg.group.visible = false;
      else {
        const u = 1 - sg.life / sg.maxLife;
        sg.group.rotation.y += dt * 3.4;
        sg.group.scale.setScalar(sg.baseScale * (0.55 + u * 0.55));
        sg.group.children.forEach((c) => {
          ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (1 - u) * 0.88;
        });
      }
    }

    for (const th of this.tethers) {
      if (!th.mesh.visible) continue;
      th.life -= dt;
      if (th.life <= 0) th.mesh.visible = false;
      else {
        const u = th.life / th.maxLife;
        th.mesh.material.opacity = u * 0.95;
        th.mesh.scale.x = 0.6 + u * 0.8;
        th.mesh.scale.y = 0.6 + u * 0.8;
      }
    }

    for (const halo of this.glowHalos) {
      if (!halo.mesh.visible) continue;
      halo.life -= dt;
      if (halo.life <= 0) {
        halo.mesh.visible = false;
      } else {
        const u = halo.life / halo.maxLife;
        halo.mesh.scale.setScalar(halo.baseScale * (1.25 - u * 0.35));
        halo.mesh.material.opacity = u * halo.peakOpacity;
      }
    }
  }

  public dispose(): void {
    this.delayedTasks = [];
    this.actorPositions.clear();

    const removeAndDisposeMats = (items: Array<{ mesh: THREE.Mesh }>) => {
      for (const item of items) {
        this.scene.remove(item.mesh);
        if (Array.isArray(item.mesh.material)) item.mesh.material.forEach((m) => m.dispose());
        else (item.mesh.material as THREE.Material).dispose();
      }
    };

    removeAndDisposeMats(this.shockwaves);
    removeAndDisposeMats(this.slashes);
    removeAndDisposeMats(this.coreFlashes);
    removeAndDisposeMats(this.funnels);
    removeAndDisposeMats(this.tracers);
    removeAndDisposeMats(this.sparks);
    removeAndDisposeMats(this.puffs);
    removeAndDisposeMats(this.cracks);
    removeAndDisposeMats(this.casings);
    removeAndDisposeMats(this.vortexDebris);
    removeAndDisposeMats(this.ghosts);
    removeAndDisposeMats(this.pillars);
    removeAndDisposeMats(this.tethers);

    for (const b of this.beams) {
      this.scene.remove(b.mesh);
      b.mesh.material.dispose();
      b.coilA.material.dispose();
      b.coilB.material.dispose();
    }
    for (const sc of this.stormClouds) {
      this.scene.remove(sc.group);
      sc.group.children.forEach((c) => ((c as THREE.Mesh).material as THREE.Material).dispose());
    }
    for (const mg of this.markGlyphs) {
      this.scene.remove(mg.group);
      mg.group.children.forEach((c) => ((c as THREE.Mesh).material as THREE.Material).dispose());
    }
    for (const sg of this.spellSigils) {
      this.scene.remove(sg.group);
      sg.group.children.forEach((c) => ((c as THREE.Mesh).material as THREE.Material).dispose());
    }
    for (const vis of this.chargingFireballs.values()) {
      this.scene.remove(vis.group);
      (vis.core.material as THREE.Material).dispose();
      (vis.aura.material as THREE.Material).dispose();
      (vis.halo.material as THREE.Material).dispose();
    }
    this.chargingFireballs.clear();

    this.scene.remove(this.eventGroup);
    this.eventOuterRing.geometry.dispose();
    this.eventOuterRing.material.dispose();
    this.eventInnerDisc.geometry.dispose();
    this.eventInnerDisc.material.dispose();

    this.scene.remove(this.stormGroup);
    this.stormWall.geometry.dispose();
    this.stormWall.material.dispose();
    this.stormRing.geometry.dispose();
    this.stormRing.material.dispose();

    this.scene.remove(this.aimGroup);
    this.aimPointRing.material.dispose();
    this.aimPointInner.material.dispose();
    this.aimPointDisc.material.dispose();
    this.aimLineStrip.material.dispose();
    this.aimLineArrow.material.dispose();
    this.aimLineOriginRing.material.dispose();
    this.aimConeWedge.material.dispose();

    this.scene.remove(this.aimDropLine);
    this.aimDropLine.material.dispose();

    removeAndDisposeMats(this.glowHalos);
    this.glowHalos = [];

    for (const vis of this.zoneVisuals.values()) {
      this.scene.remove(vis.group);
      vis.ring.material.dispose();
      vis.disc.material.dispose();
      (vis.extra.material as THREE.Material).dispose();
    }
    this.zoneVisuals.clear();

    for (const vis of this.telegraphVisuals.values()) {
      this.scene.remove(vis.group);
      (vis.border.material as THREE.Material).dispose();
      (vis.fill.material as THREE.Material).dispose();
      (vis.rune.material as THREE.Material).dispose();
    }
    this.telegraphVisuals.clear();

    for (const mesh of this.projMeshes.values()) {
      this.scene.remove(mesh);
    }
    this.projMeshes.clear();

    for (const mat of this.projMaterials.values()) {
      mat.dispose();
    }
    this.projMaterials.clear();
    this.lassoTetherMat.dispose();

    for (const tMesh of this.projTethers.values()) {
      this.scene.remove(tMesh);
    }
    this.projTethers.clear();

    for (const vis of this.pickupVisuals.values()) {
      this.scene.remove(vis.group);
      (vis.orb.material as THREE.Material).dispose();
      (vis.ring.material as THREE.Material).dispose();
    }
    this.pickupVisuals.clear();

    for (const vis of this.awakeningOrbVisuals.values()) {
      this.scene.remove(vis.group);
      vis.crystal.material.dispose();
      vis.ringA.material.dispose();
      vis.ringB.material.dispose();
      vis.column.material.dispose();
      (vis.haloSprite.material as THREE.Material).dispose();
      (vis.labelSprite.material as THREE.Material).dispose();
      for (const pt of vis.particles) pt.mesh.material.dispose();
    }
    this.awakeningOrbVisuals.clear();

    this.scene.remove(this.cutsceneClashGroup);
    this.cutsceneP1Beam.material.dispose();
    this.cutsceneP2Beam.material.dispose();
    this.cutsceneCore.material.dispose();
    this.cutsceneCoreRing.material.dispose();

    this.orbLabelTex?.dispose();
    this.orbLabelTex = null;
    this.orbGlowTex?.dispose();
    this.orbGlowTex = null;

    for (const geo of this.sharedGeos) {
      geo.dispose();
    }
    this.sharedGeos = [];
  }
}
