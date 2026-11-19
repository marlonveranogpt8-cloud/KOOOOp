import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  ArenaActorState,
  ArenaSnapshot,
  CombatEvent,
  FIGHTER_BY_ID,
  FighterId,
  MAP_BY_ID,
  MapId,
  RoomState,
  SkinId,
  getMapTerrainHeight,
  getObstacleSupportY,
  resolveObstacleCollisions,
} from '../shared/gameData.ts';
import {
  FighterRig,
  computeActorPose,
  createArticulatedFighter,
  disposeFighterRig,
  poseFighter,
  triggerFighterHitFlash,
} from '../game/fighterBuilder.ts';
import { BuiltMapScene, buildArenaMap, detectSoftwareWebGL } from '../game/mapBuilder.ts';
import {
  advanceActionTimer,
  computeLockedTopDownCamera,
  computeTraumaShake,
  dampScalar,
} from '../game/combatMath.ts';
import { AimPreviewState, VFXManager } from '../game/vfxManager.ts';
import { soundEngine } from '../game/soundEngine.ts';
import { AWAKENING_CONFIG } from '../shared/awakeningConfig.ts';

const _projVec = new THREE.Vector3();

export interface OrbScreenIndicator {
  id: string;
  xPct: number;
  yPct: number;
  angleDeg: number;
  distMeters: number;
  onScreen: boolean;
}

export interface LocalControlState {
  moveX: number;
  moveZ: number;
  blockHeld: boolean;
  jumpTriggerSeq: number;
}

export interface DamagePopup {
  id: string;
  xPct: number;
  yPct: number;
  amount: number;
  label?: string;
  color: string;
  isBig: boolean;
}

export interface HitFlashInfo {
  id: string;
  direction: 'left' | 'right' | 'top' | 'bottom' | 'all';
}

export type ScreenTintKind =
  | 'high-noon-amber'
  | 'avalanche-red'
  | 'eclipse-vignette'
  | 'phantom-desat'
  | 'solar-white-gold';

export interface ScreenTintInfo {
  id: string;
  kind: ScreenTintKind;
  durationMs: number;
}

interface CinematicCamState {
  mode: 'wide_storm' | 'low_beam' | 'punch_in' | 'high_noon' | 'ko_slow';
  focusX: number;
  focusY: number;
  focusZ: number;
  remaining: number;
  duration: number;
}

interface ArenaViewportProps {
  mapId: MapId;
  roomPhase?: RoomState['phase'];
  roomCountdown?: number;
  playerId: string;
  targetId: string | null;
  lockOnEnabled?: boolean;
  snapshot: ArenaSnapshot | null;
  pendingEvents: CombatEvent[];
  onConsumeEvents: () => void;
  cameraYawRef?: React.MutableRefObject<number>;
  aimPitchRef?: React.MutableRefObject<number>;
  clockOffsetMsRef: React.MutableRefObject<number>;
  jitterMsRef: React.MutableRefObject<number>;
  localControlRef: React.MutableRefObject<LocalControlState>;
  aimPreviewRef?: React.MutableRefObject<AimPreviewState>;
  onCanvasAttack?: (shiftHeld: boolean) => void;
  onCancelAim?: () => void;
  onSpawnDamagePopup?: (popup: DamagePopup) => void;
  onHitFlash?: (flash: HitFlashInfo) => void;
  onScreenTint?: (tint: ScreenTintInfo) => void;
  onOrbIndicators?: (indicators: OrbScreenIndicator[]) => void;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

export const ArenaViewport: React.FC<ArenaViewportProps> = ({
  mapId,
  roomPhase = 'combat',
  roomCountdown = 0,
  playerId,
  targetId,
  lockOnEnabled = true,
  snapshot,
  pendingEvents,
  onConsumeEvents,
  cameraYawRef,
  aimPitchRef,
  clockOffsetMsRef,
  jitterMsRef,
  localControlRef,
  aimPreviewRef,
  onCanvasAttack,
  onCancelAim,
  onSpawnDamagePopup,
  onHitFlash,
  onScreenTint,
  onOrbIndicators,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const snapshotRef = useRef<ArenaSnapshot | null>(snapshot);
  const snapshotBufferRef = useRef<ArenaSnapshot[]>([]);
  const roomPhaseRef = useRef<RoomState['phase']>(roomPhase);
  const roomCountdownRef = useRef<number>(roomCountdown);
  const targetIdRef = useRef<string | null>(targetId);
  const lockOnEnabledRef = useRef<boolean>(lockOnEnabled);
  const playerIdRef = useRef<string>(playerId);
  const vfxRef = useRef<VFXManager | null>(null);
  const actorRigsRef = useRef<Map<string, FighterRig>>(new Map());
  const shakeRef = useRef<number>(0);
  const hitStopUntilRef = useRef<number>(0);
  const slowMoUntilRef = useRef<number>(0);
  const stormDarkenTimerRef = useRef<number>(0);
  const cinematicCamRef = useRef<CinematicCamState | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const aimPreviewPropRef = useRef(aimPreviewRef);
  const onCanvasAttackRef = useRef(onCanvasAttack);
  const onCancelAimRef = useRef(onCancelAim);
  const onSpawnPopupRef = useRef(onSpawnDamagePopup);
  const onHitFlashRef = useRef(onHitFlash);
  const onScreenTintRef = useRef(onScreenTint);
  const onOrbIndicatorsRef = useRef(onOrbIndicators);

  // Locked angled top-down camera orientation (fixed yaw = Math.PI, pitch = ~57 deg)
  const lockedYawRef = useRef<number>(Math.PI);

  roomPhaseRef.current = roomPhase;
  roomCountdownRef.current = roomCountdown;
  aimPreviewPropRef.current = aimPreviewRef;
  onCanvasAttackRef.current = onCanvasAttack;
  onCancelAimRef.current = onCancelAim;
  onSpawnPopupRef.current = onSpawnDamagePopup;
  onHitFlashRef.current = onHitFlash;
  onScreenTintRef.current = onScreenTint;
  onOrbIndicatorsRef.current = onOrbIndicators;
  lockOnEnabledRef.current = lockOnEnabled;

  // Client-side prediction state for local player
  const predRef = useRef<{
    initialized: boolean;
    x: number;
    y: number;
    z: number;
    vx: number;
    yVel: number;
    vz: number;
    grounded: boolean;
    rotY: number;
    lastJumpSeq: number;
  }>({
    initialized: false,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    yVel: 0,
    vz: 0,
    grounded: true,
    rotY: 0,
    lastJumpSeq: 0,
  });

  snapshotRef.current = snapshot;
  targetIdRef.current = targetId;
  playerIdRef.current = playerId;

  // Push incoming snapshots into ring buffer + reconcile local prediction
  useEffect(() => {
    if (!snapshot) return;
    const buf = snapshotBufferRef.current;
    if (buf.length === 0 || buf[buf.length - 1].serverTime < snapshot.serverTime) {
      buf.push(snapshot);
      if (buf.length > 24) buf.shift();
    }

    const meServer = snapshot.actors.find((a) => a.playerId === playerIdRef.current);
    if (meServer) {
      const pred = predRef.current;
      if (
        !pred.initialized ||
        meServer.isKO ||
        meServer.actionState === 'clash' ||
        meServer.actionState === 'headlock' ||
        snapshot.awakeningPhase === 'CUTSCENE'
      ) {
        pred.initialized = true;
        pred.x = meServer.x;
        pred.y = meServer.y;
        pred.z = meServer.z;
        pred.vx = meServer.vx;
        pred.yVel = meServer.yVel;
        pred.vz = meServer.vz;
        pred.grounded = meServer.grounded;
        pred.rotY = meServer.rotY;
      } else {
        const horizErr = Math.hypot(meServer.x - pred.x, meServer.z - pred.z);
        const vertErr = Math.abs(meServer.y - pred.y);
        if (horizErr > 2.2) {
          pred.x = meServer.x;
          pred.z = meServer.z;
        } else if (horizErr > 0.06) {
          const pull = horizErr > 0.7 ? 1 - Math.exp(-11.5 * 0.04) : 1 - Math.exp(-5.0 * 0.04);
          pred.x = THREE.MathUtils.lerp(pred.x, meServer.x, pull);
          pred.z = THREE.MathUtils.lerp(pred.z, meServer.z, pull);
        }
        if (vertErr > 1.8) {
          pred.y = meServer.y;
          pred.yVel = meServer.yVel;
          pred.grounded = meServer.grounded;
        } else if (vertErr > 0.08 && meServer.grounded && pred.grounded) {
          pred.y = THREE.MathUtils.lerp(pred.y, meServer.y, 1 - Math.exp(-10.5 * 0.04));
        }
      }
    }
  }, [snapshot]);

  // Dispatch server combat events into 3D VFX, Audio, Hit-Stop, Cinematic Camera Cuts, Damage Popups & Screen Tints
  useEffect(() => {
    if (pendingEvents.length === 0) return;
    const vfx = vfxRef.current;
    const cam = cameraRef.current;

    for (const ev of pendingEvents) {
      if (vfx) vfx.handleEvent(ev, mapId);

      // Scaled hit-stop on EVERY connecting hit (1-3 frames) plus heavy move stops
      let stopMs = ev.hitStopMs ?? 0;
      if (ev.kind === 'hit') {
        const dmg = ev.damage ?? 0;
        const scaledStop =
          ev.abilitySlot === 4 || ev.abilitySlot === 5
            ? 82
            : dmg >= 22 || ev.isCrit
            ? 62
            : dmg >= 12
            ? 38
            : 20;
        stopMs = Math.max(stopMs, scaledStop);
      } else if (ev.kind === 'parry' || ev.kind === 'stun' || ev.kind === 'clashWin') {
        stopMs = Math.max(stopMs, 55);
      } else if (ev.kind === 'beam') {
        stopMs = Math.max(stopMs, 75);
      }
      if (stopMs > 0) {
        const stopDur = Math.min(130, stopMs);
        hitStopUntilRef.current = Math.max(hitStopUntilRef.current, performance.now() + stopDur);
      }

      if (ev.kind === 'cast') {
        if (ev.abilitySlot === 6) {
          shakeRef.current = Math.max(shakeRef.current, 0.56);
          if (ev.fighterId === 'damen') {
            soundEngine.play('railgunShot');
          } else {
            soundEngine.play('overdrive');
          }
          cinematicCamRef.current = {
            mode: 'wide_storm',
            focusX: ev.x,
            focusY: ev.y,
            focusZ: ev.z,
            remaining: 0.78,
            duration: 0.78,
          };
          onScreenTintRef.current?.({
            id: `${ev.id}-awaken-ult`,
            kind: 'solar-white-gold',
            durationMs: 550,
          });
        } else if (ev.abilitySlot === 4) {
          shakeRef.current = Math.max(shakeRef.current, 0.42);
          if (ev.fighterId === 'marjohn') {
            stormDarkenTimerRef.current = 1.5;
            cinematicCamRef.current = {
              mode: 'wide_storm',
              focusX: ev.x,
              focusY: ev.y,
              focusZ: ev.z,
              remaining: 1.0,
              duration: 1.0,
            };
          } else if (ev.fighterId === 'prime') {
            cinematicCamRef.current = {
              mode: 'punch_in',
              focusX: ev.x,
              focusY: ev.y,
              focusZ: ev.z,
              remaining: 0.72,
              duration: 0.72,
            };
            onScreenTintRef.current?.({
              id: `${ev.id}-tint`,
              kind: 'avalanche-red',
              durationMs: 650,
            });
          } else if (ev.fighterId === 'damen') {
            cinematicCamRef.current = {
              mode: 'high_noon',
              focusX: ev.x,
              focusY: ev.y,
              focusZ: ev.z,
              remaining: 0.84,
              duration: 0.84,
            };
            onScreenTintRef.current?.({
              id: `${ev.id}-tint`,
              kind: 'high-noon-amber',
              durationMs: 780,
            });
          } else if (ev.fighterId === 'khen') {
            cinematicCamRef.current = {
              mode: 'punch_in',
              focusX: ev.x,
              focusY: ev.y,
              focusZ: ev.z,
              remaining: 0.7,
              duration: 0.7,
            };
            onScreenTintRef.current?.({
              id: `${ev.id}-tint`,
              kind: 'phantom-desat',
              durationMs: 680,
            });
          } else if (ev.fighterId === 'jm') {
            cinematicCamRef.current = {
              mode: 'low_beam',
              focusX: ev.x,
              focusY: ev.y,
              focusZ: ev.z,
              remaining: 0.85,
              duration: 0.85,
            };
            onScreenTintRef.current?.({
              id: `${ev.id}-tint`,
              kind: 'solar-white-gold',
              durationMs: 720,
            });
          }
        } else if (
          ev.fighterId === 'khen' &&
          ev.abilitySlot === 0 &&
          ev.m1Variant === 'heavy'
        ) {
          onScreenTintRef.current?.({
            id: `${ev.id}-eclipse`,
            kind: 'eclipse-vignette',
            durationMs: 520,
          });
        }
      } else if (ev.kind === 'hit') {
        soundEngine.playFighterHit(ev.fighterId, Boolean(ev.isCrit));
        if (ev.targetId) {
          const targetRig = actorRigsRef.current.get(ev.targetId);
          if (targetRig) triggerFighterHitFlash(targetRig, ev.isCrit ? 0.16 : 0.12);
        }
        const dmg = ev.damage ?? 0;
        const hitShake =
          ev.abilitySlot === 4 || ev.abilitySlot === 5
            ? 0.68
            : dmg >= 22 || ev.isCrit
            ? 0.52
            : dmg >= 12
            ? 0.30
            : 0.16;
        shakeRef.current = Math.max(shakeRef.current, hitShake);
      } else if (ev.kind === 'parry') {
        soundEngine.play('parry');
        shakeRef.current = Math.max(shakeRef.current, 0.46);
      } else if (ev.kind === 'evade') {
        soundEngine.play('evade');
        shakeRef.current = Math.max(shakeRef.current, 0.24);
        slowMoUntilRef.current = Math.max(slowMoUntilRef.current, performance.now() + 180);
      } else if (ev.kind === 'trap') {
        soundEngine.play('trap');
      } else if (ev.kind === 'trapTrigger') {
        soundEngine.play('trapTrigger');
        shakeRef.current = Math.max(shakeRef.current, 0.42);
      } else if (ev.kind === 'block') {
        soundEngine.play('block');
      } else if (ev.kind === 'grab') {
        soundEngine.play('grab');
        if (ev.targetId) {
          const targetRig = actorRigsRef.current.get(ev.targetId);
          if (targetRig) triggerFighterHitFlash(targetRig, 0.14);
        }
        shakeRef.current = Math.max(shakeRef.current, ev.rpsOutcome === 'weak_to_grab' ? 0.54 : 0.36);
      } else if (ev.kind === 'headlockBreak') {
        soundEngine.play('parry');
        shakeRef.current = Math.max(shakeRef.current, 0.35);
      } else if (ev.kind === 'whiff') {
        soundEngine.play('whiff');
      } else if (ev.kind === 'stun') {
        soundEngine.play('stun');
        shakeRef.current = Math.max(shakeRef.current, 0.48);
      } else if (ev.kind === 'comboLink') {
        soundEngine.play('comboLink');
        shakeRef.current = Math.max(shakeRef.current, 0.34);
      } else if (ev.kind === 'overdrive') {
        soundEngine.play('overdrive');
        shakeRef.current = Math.max(shakeRef.current, 0.45);
      } else if (ev.kind === 'clashStart' || ev.kind === 'clashWin') {
        soundEngine.play('clash');
        if (ev.kind === 'clashWin' && ev.targetId) {
          const targetRig = actorRigsRef.current.get(ev.targetId);
          if (targetRig) triggerFighterHitFlash(targetRig, 0.18);
        }
        shakeRef.current = Math.max(shakeRef.current, ev.kind === 'clashWin' ? 0.72 : 0.48);
      } else if (ev.kind === 'hazardHit') {
        soundEngine.play('hazard');
        if (ev.targetId) {
          const targetRig = actorRigsRef.current.get(ev.targetId);
          if (targetRig) triggerFighterHitFlash(targetRig, 0.15);
        }
        shakeRef.current = Math.max(shakeRef.current, 0.65);
      } else if (ev.kind === 'dash') {
        soundEngine.play('dash');
      } else if (ev.kind === 'jump') {
        soundEngine.play('jump');
      } else if (ev.kind === 'pickup') {
        soundEngine.play('pickup');
      } else if (ev.kind === 'shockwave') {
        soundEngine.play('shockwave');
        shakeRef.current = Math.max(shakeRef.current, ev.abilitySlot === 4 ? 0.72 : 0.38);
        if (ev.abilitySlot === 4) {
          slowMoUntilRef.current = Math.max(slowMoUntilRef.current, performance.now() + 340);
        }
      } else if (ev.kind === 'beam') {
        soundEngine.play('beam');
        shakeRef.current = Math.max(shakeRef.current, 0.66);
        slowMoUntilRef.current = Math.max(slowMoUntilRef.current, performance.now() + 380);
      } else if (ev.kind === 'fireballCharge') {
        soundEngine.play('overdrive');
        shakeRef.current = Math.max(shakeRef.current, 0.36);
        cinematicCamRef.current = {
          mode: 'wide_storm',
          focusX: ev.x,
          focusY: ev.y,
          focusZ: ev.z,
          remaining: 1.35,
          duration: 1.35,
        };
      } else if (ev.kind === 'fireballLaunch') {
        soundEngine.play('whoosh');
        soundEngine.play('beam');
        shakeRef.current = Math.max(shakeRef.current, 0.44);
      } else if (ev.kind === 'fireballImpact') {
        soundEngine.play('shockwave');
        soundEngine.play('heavy');
        shakeRef.current = Math.max(shakeRef.current, 0.86);
        hitStopUntilRef.current = Math.max(hitStopUntilRef.current, performance.now() + 95);
        slowMoUntilRef.current = Math.max(slowMoUntilRef.current, performance.now() + 420);
      } else if (ev.kind === 'obstacleBreak') {
        soundEngine.play('heavy');
        soundEngine.play('shockwave');
        shakeRef.current = Math.max(shakeRef.current, 0.56);
      } else if (ev.kind === 'awakeningOrbsSpawn') {
        soundEngine.play('orbSpawnRumble');
        shakeRef.current = Math.max(shakeRef.current, 0.52);
        onScreenTintRef.current?.({
          id: `${ev.id}-orb-edge-flash`,
          kind: 'solar-white-gold',
          durationMs: 420,
        });
      } else if (ev.kind === 'awakeningPickup') {
        soundEngine.play('orbPickupChime');
        shakeRef.current = Math.max(shakeRef.current, 0.36);
      } else if (ev.kind === 'awakeningTransform') {
        soundEngine.play('awakeningTransform');
        shakeRef.current = Math.max(shakeRef.current, 0.65);
        hitStopUntilRef.current = Math.max(hitStopUntilRef.current, performance.now() + 90);
        onScreenTintRef.current?.({
          id: `${ev.id}-transform-flash`,
          kind: 'solar-white-gold',
          durationMs: 420,
        });
      } else if (ev.kind === 'awakeningCutsceneStart') {
        shakeRef.current = Math.max(shakeRef.current, 0.32);
      } else if (ev.kind === 'awakeningClashEnd') {
        soundEngine.play('clashBoom');
        soundEngine.play('knockbackImpact');
        shakeRef.current = Math.max(shakeRef.current, 0.96);
        hitStopUntilRef.current = Math.max(
          hitStopUntilRef.current,
          performance.now() + AWAKENING_CONFIG.CLASH_HITSTOP_MS
        );
        onScreenTintRef.current?.({
          id: `${ev.id}-clash-end`,
          kind: 'solar-white-gold',
          durationMs: 460,
        });
      } else if (ev.kind === 'lightning') {
        soundEngine.play('thunderStrike');
        shakeRef.current = Math.max(shakeRef.current, 0.56);
      } else if (ev.kind === 'silence') {
        soundEngine.play('silence');
      } else if (ev.kind === 'cometGrab') {
        soundEngine.play('heavy');
        shakeRef.current = Math.max(shakeRef.current, 0.64);
      } else if (ev.kind === 'omnislash') {
        soundEngine.play('clash');
        shakeRef.current = Math.max(shakeRef.current, 0.68);
      } else if (ev.kind === 'ko') {
        soundEngine.play('ko');
        shakeRef.current = Math.max(shakeRef.current, 0.8);
        slowMoUntilRef.current = Math.max(slowMoUntilRef.current, performance.now() + 480);
        cinematicCamRef.current = {
          mode: 'ko_slow',
          focusX: ev.x,
          focusY: ev.y,
          focusZ: ev.z,
          remaining: 0.78,
          duration: 0.78,
        };
      }

      // Project 3D hit location into 2D screen coordinates for small, offset floating damage numbers
      if (
        cam &&
        onSpawnPopupRef.current &&
        (ev.damage || ev.callout) &&
        (ev.kind === 'hit' ||
          ev.kind === 'grab' ||
          ev.kind === 'block' ||
          ev.kind === 'clashWin' ||
          ev.kind === 'hazardHit')
      ) {
        const groundY = getMapTerrainHeight(mapId, ev.x, ev.z);
        _projVec.set(ev.x, groundY + ev.y + 0.85, ev.z);
        _projVec.project(cam);
        if (_projVec.z >= -1 && _projVec.z <= 1) {
          const sideJitter = (Math.random() < 0.5 ? -1 : 1) * (2.6 + Math.random() * 1.8);
          const xPct = Math.max(8, Math.min(92, (_projVec.x * 0.5 + 0.5) * 100 + sideJitter));
          const yPct = Math.max(10, Math.min(82, (-_projVec.y * 0.5 + 0.5) * 100 - 2.0));
          const colorStr = `#${ev.colorHex.toString(16).padStart(6, '0')}`;
          const tag = ev.isBackstab
            ? 'BACKSTAB'
            : ev.isCounter
            ? 'PUNISH'
            : ev.isCrit
            ? 'CRIT'
            : ev.kind === 'block'
            ? 'BLOCKED'
            : undefined;
          onSpawnPopupRef.current({
            id: ev.id,
            xPct,
            yPct,
            amount: ev.damage ?? 0,
            label: tag,
            color: colorStr,
            isBig: Boolean(ev.isCrit || ev.isBackstab || ev.isCounter || (ev.damage ?? 0) >= 22),
          });
        }
      }

      // Directional hit-flash indicator when the local player takes damage
      if (
        onHitFlashRef.current &&
        ev.targetId === playerIdRef.current &&
        (ev.kind === 'hit' || ev.kind === 'grab' || ev.kind === 'hazardHit' || ev.kind === 'clashWin')
      ) {
        let direction: HitFlashInfo['direction'] = 'all';
        if (ev.dirX !== undefined && ev.dirZ !== undefined && cameraYawRef) {
          const yaw = cameraYawRef.current;
          // Incoming vector toward player vs camera right/forward
          const camRightX = -Math.cos(yaw);
          const camRightZ = Math.sin(yaw);
          const camFwdX = Math.sin(yaw);
          const camFwdZ = Math.cos(yaw);
          const sideDot = -(ev.dirX * camRightX + ev.dirZ * camRightZ);
          const fwdDot = -(ev.dirX * camFwdX + ev.dirZ * camFwdZ);
          if (Math.abs(sideDot) > Math.abs(fwdDot)) {
            direction = sideDot > 0 ? 'right' : 'left';
          } else {
            direction = fwdDot > 0 ? 'top' : 'bottom';
          }
        }
        onHitFlashRef.current({ id: ev.id, direction });
      }
    }
    onConsumeEvents();
  }, [pendingEvents, mapId, onConsumeEvents, cameraYawRef]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    snapshotBufferRef.current = [];
    predRef.current.initialized = false;

    const isSoftwareGl = detectSoftwareWebGL();
    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Critical for mobile high-DPR displays: lock canvas CSS display size to viewport
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.25, 290);
    camera.position.set(0, 15, 11);
    cameraRef.current = camera;

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmrem.dispose();

    const hemiLight = new THREE.HemisphereLight(
      mapId === 'shibuya'
        ? 0xf8fafc
        : mapId === 'meadow'
        ? 0xfef3c7
        : mapId === 'temple'
        ? 0xfdba74
        : 0xc084fc,
      mapId === 'shibuya' ? 0x64748b : 0x1e293b,
      mapId === 'shibuya' ? 1.05 : 0.85
    );
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff1d6, 1.38);
    sunLight.position.set(28, 46, 24);
    sunLight.castShadow = !isSoftwareGl;
    sunLight.shadow.mapSize.set(1024, 1024);
    sunLight.shadow.camera.left = -42;
    sunLight.shadow.camera.right = 42;
    sunLight.shadow.camera.top = 42;
    sunLight.shadow.camera.bottom = -42;
    sunLight.shadow.camera.near = 2;
    sunLight.shadow.camera.far = 120;
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.02;
    scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(0x7dd3fc, 0.45);
    rimLight.position.set(-18, 12, -20);
    scene.add(rimLight);

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const builtMap: BuiltMapScene = buildArenaMap(mapId, scene, maxAniso);
    const vfx = new VFXManager(scene);
    vfxRef.current = vfx;
    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const actorRigs = actorRigsRef.current;
    actorRigs.clear();
    const smoothedActors = new Map<string, ArenaActorState>();
    const prevGroundedMap = new Map<string, boolean>();
    const localActionTimers = new Map<string, { serverTimer: number; localTimer: number }>();
    const footstepTimersMap = new Map<string, number>();
    let lastOrbEmitMs = 0;
    let hadOrbIndicators = false;
    let cutsceneFilterActive = false;

    const lockRingGeom = new THREE.RingGeometry(0.95, 1.15, 28);
    const lockRingMat = new THREE.MeshBasicMaterial({
      color: 0xf43f5e,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const lockRing = new THREE.Mesh(lockRingGeom, lockRingMat);
    lockRing.rotation.x = -Math.PI * 0.5;
    lockRing.renderOrder = 8;
    lockRing.visible = false;
    scene.add(lockRing);

    const aspectRef = { current: 1 };
    const baseFovRef = { current: 52 };
    let smoothedFov = 52;
    let lastW = 0;
    let lastH = 0;
    const resize = () => {
      const w = Math.max(1, container.clientWidth || window.visualViewport?.width || window.innerWidth);
      const h = Math.max(1, container.clientHeight || window.visualViewport?.height || window.innerHeight);
      lastW = w;
      lastH = h;
      const aspect = w / h;
      aspectRef.current = aspect;
      camera.aspect = aspect;
      // Wider vertical FOV on narrow/portrait phones so horizontal arena stays visible
      const baseFov = aspect < 0.85 ? 64 : aspect < 1.3 ? 54 : 48;
      baseFovRef.current = baseFov;
      smoothedFov = baseFov;
      camera.fov = baseFov;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 1.5));
      renderer.setSize(w, h, false);
    };

    const handleContextLost = (e: Event) => {
      e.preventDefault();
    };
    const handleContextRestored = () => {
      resize();
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    // Locked top-down view: canvas click triggers M1 attack / right-click cancels aim (no orbit rotation)
    let pointerClick: {
      pointerId: number;
      startX: number;
      startY: number;
      button: number;
    } | null = null;

    const onCanvasPointerDown = (e: PointerEvent) => {
      if (pointerClick !== null) return;
      soundEngine.unlock();
      pointerClick = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        button: e.button,
      };
    };

    const onCanvasPointerUp = (e: PointerEvent) => {
      if (!pointerClick || pointerClick.pointerId !== e.pointerId) return;
      const dist = Math.hypot(e.clientX - pointerClick.startX, e.clientY - pointerClick.startY);
      const btn = pointerClick.button;
      pointerClick = null;
      if (dist < 14 && e.type !== 'pointercancel') {
        if (btn === 2) {
          onCancelAimRef.current?.();
        } else if (btn === 0) {
          if (aimPreviewPropRef.current?.current?.active) {
            onCancelAimRef.current?.();
          } else {
            onCanvasAttackRef.current?.(e.shiftKey);
          }
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', onCanvasPointerDown);
    renderer.domElement.addEventListener('pointerup', onCanvasPointerUp);
    renderer.domElement.addEventListener('pointercancel', onCanvasPointerUp);

    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    resize();

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(container);
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);
    document.addEventListener('fullscreenchange', resize);

    const camPos = new THREE.Vector3(0, 8, 16);
    const camLook = new THREE.Vector3(0, 1.2, 0);
    const destPos = new THREE.Vector3();
    const destLook = new THREE.Vector3();
    let camInitialized = false;

    const mapSpec = MAP_BY_ID[mapId];
    const arenaRadius = mapSpec.arenaRadius;
    const baseSkyColor = new THREE.Color(mapSpec.skyHex);
    const baseFogColor = new THREE.Color(mapSpec.fogHex);
    const stormSkyColor = new THREE.Color(0x0b2229);
    const stormFogColor = new THREE.Color(0x0f2f38);

    let frameId = 0;
    let active = true;
    let lastMs = performance.now();
    let visualElapsed = 0;

    function afterDraw(cb: () => void) {
      if (!active) return;
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        let polls = 0;
        const poll = () => {
          if (!active) {
            if (sync) gl.deleteSync(sync);
            return;
          }
          polls += 1;
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED && polls < 40) {
            frameId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            frameId = window.setTimeout(cb, 80);
          }
        };
        frameId = window.setTimeout(poll, 5);
      } else {
        frameId = window.setTimeout(cb, 80);
      }
    }

    const tick = () => {
      if (!active) return;
      if (
        (container.clientWidth > 0 && Math.abs(container.clientWidth - lastW) > 1) ||
        (container.clientHeight > 0 && Math.abs(container.clientHeight - lastH) > 1)
      ) {
        resize();
      }
      const now = performance.now();
      const rawDt = Math.min((now - lastMs) / 1000, 0.05);
      lastMs = now;
      const isHitStopped = now < hitStopUntilRef.current;
      const isSlowMo = !isHitStopped && now < slowMoUntilRef.current;
      const dt = isHitStopped ? rawDt * 0.08 : isSlowMo ? rawDt * 0.34 : rawDt;
      visualElapsed += dt;
      const elapsed = visualElapsed;

      // Storm sky darkening for Marjohn's Tempest Typhoon
      if (stormDarkenTimerRef.current > 0) {
        stormDarkenTimerRef.current = Math.max(0, stormDarkenTimerRef.current - rawDt);
        const rem = stormDarkenTimerRef.current;
        const rampIn = rem > 1.2 ? (1.5 - rem) / 0.3 : 1;
        const rampOut = rem < 0.45 ? rem / 0.45 : 1;
        const stormAmt = Math.max(0, Math.min(1, Math.min(rampIn, rampOut)));
        if (scene.background instanceof THREE.Color) {
          scene.background.copy(baseSkyColor).lerp(stormSkyColor, stormAmt * 0.86);
        }
        if (scene.fog) {
          scene.fog.color.copy(baseFogColor).lerp(stormFogColor, stormAmt * 0.86);
        }
      } else {
        if (scene.background instanceof THREE.Color && !scene.background.equals(baseSkyColor)) {
          scene.background.copy(baseSkyColor);
        }
        if (scene.fog && !scene.fog.color.equals(baseFogColor)) {
          scene.fog.color.copy(baseFogColor);
        }
      }

      builtMap.update(dt, elapsed);
      vfx.update(dt);

      const latestSnap = snapshotRef.current;
      const buf = snapshotBufferRef.current;

      if (latestSnap) {
        builtMap.syncObstacles(latestSnap.obstacles, vfx);
        vfx.syncProjectiles(latestSnap.projectiles, mapId, dt);
        vfx.syncPickups(latestSnap.pickups, mapId, elapsed);
        vfx.syncAwakeningOrbs(latestSnap.awakeningOrbs ?? [], mapId, elapsed);
        vfx.syncBattleEvent(latestSnap.battleEvent, mapId, elapsed);
        vfx.syncZones(latestSnap.zones ?? [], mapId, elapsed);
        vfx.syncTelegraphs(latestSnap.telegraphs ?? [], mapId, elapsed);
        vfx.syncStormRing(latestSnap.stormActive, latestSnap.stormRadius, mapId, elapsed);
        vfx.syncChargingFireballs(latestSnap.actors, mapId, elapsed);
        vfx.syncAimPreview(aimPreviewPropRef.current?.current, mapId, elapsed);
        const csState = latestSnap.awakeningCutscene ?? null;
        const csP1 = csState ? smoothedActors.get(csState.p1Id) ?? latestSnap.actors.find((a) => a.playerId === csState.p1Id) : undefined;
        const csP2 = csState ? smoothedActors.get(csState.p2Id) ?? latestSnap.actors.find((a) => a.playerId === csState.p2Id) : undefined;
        vfx.syncCutsceneClashVfx(csState, csP1, csP2, mapId, elapsed, rawDt);

        // Adaptive interpolation render time in synchronized server epoch ms
        const interpDelayMs = Math.max(60, Math.min(155, 65 + jitterMsRef.current * 1.6));
        const estimatedServerNow = Date.now() + clockOffsetMsRef.current;
        const renderServerTime = estimatedServerNow - interpDelayMs;

        let snapA: ArenaSnapshot = latestSnap;
        let snapB: ArenaSnapshot = latestSnap;
        let alpha = 1;

        if (buf.length >= 2) {
          for (let i = 0; i < buf.length - 1; i++) {
            if (buf[i].serverTime <= renderServerTime && buf[i + 1].serverTime >= renderServerTime) {
              snapA = buf[i];
              snapB = buf[i + 1];
              const span = Math.max(1, snapB.serverTime - snapA.serverTime);
              alpha = (renderServerTime - snapA.serverTime) / span;
              break;
            }
          }
          if (renderServerTime > buf[buf.length - 1].serverTime) {
            snapA = buf[buf.length - 2];
            snapB = buf[buf.length - 1];
            alpha = 1;
          } else if (renderServerTime < buf[0].serverTime) {
            snapA = buf[0];
            snapB = buf[0];
            alpha = 0;
          }
        }

        // Advance local client-side prediction at 60fps for zero-lag control feel
        const myLatest = latestSnap.actors.find((a) => a.playerId === playerIdRef.current);
        const pred = predRef.current;
        const ctrl = localControlRef.current;
        const isGravityBoost = latestSnap.battleEvent?.kind === 'gravity';
        const isSkySolarCharge =
          Boolean(myLatest && myLatest.actionState === 'ultimate' && myLatest.abilitySlot === 5);
        if (
          myLatest &&
          !myLatest.isKO &&
          myLatest.actionState !== 'clash' &&
          myLatest.actionState !== 'headlock' &&
          latestSnap.awakeningPhase !== 'CUTSCENE' &&
          pred.initialized
        ) {
          if (isSkySolarCharge) {
            pred.vx = 0;
            pred.vz = 0;
            pred.yVel = 0;
            pred.grounded = false;
            pred.x = THREE.MathUtils.lerp(pred.x, myLatest.x, Math.min(1, dt * 12));
            pred.z = THREE.MathUtils.lerp(pred.z, myLatest.z, Math.min(1, dt * 12));
            pred.y = THREE.MathUtils.lerp(pred.y, Math.max(myLatest.y, Math.min(7.2, pred.y + dt * 11.5)), Math.min(1, dt * 14));
            pred.rotY = lerpAngle(pred.rotY, myLatest.rotY, Math.min(1, dt * 14));
          } else {
            if (ctrl.jumpTriggerSeq !== pred.lastJumpSeq) {
              pred.lastJumpSeq = ctrl.jumpTriggerSeq;
              if (pred.grounded && myLatest.actionState !== 'stagger' && !myLatest.isFlying) {
                pred.yVel = isGravityBoost ? 13.6 : 10.8;
                pred.grounded = false;
              }
            }
            const canMove =
              myLatest.actionState === 'idle' ||
              myLatest.actionState === 'move' ||
              myLatest.actionState === 'jump' ||
              myLatest.actionState === 'guard' ||
              myLatest.actionState === 'whiff';
            const baseSpeed =
              FIGHTER_BY_ID[myLatest.fighterId].moveSpeed *
              (myLatest.isOverdrive ? 1.18 : 1.0) *
              ((myLatest.speedBoostTimer ?? 0) > 0 ? 1.24 : 1.0) *
              (myLatest.fighterId === 'marjohn' ? 1 + myLatest.passiveStacks * 0.04 : 1.0);
            const speed =
              baseSpeed *
              (myLatest.actionState === 'whiff'
                ? 0.44
                : myLatest.actionState === 'guard' || ctrl.blockHeld
                ? 0.36
                : myLatest.isFlying
                ? 1.12
                : pred.grounded
                ? 1.0
                : myLatest.fighterId === 'marjohn'
                ? 1.04
                : 0.92);

            if (canMove && (Math.abs(ctrl.moveX) > 0.06 || Math.abs(ctrl.moveZ) > 0.06)) {
              const blend = !pred.grounded && myLatest.fighterId === 'marjohn' ? 0.72 : 0.55;
              pred.vx = pred.vx * (1 - blend) + ctrl.moveX * speed * blend;
              pred.vz = pred.vz * (1 - blend) + ctrl.moveZ * speed * blend;
              if (myLatest.actionState !== 'guard' && myLatest.actionState !== 'whiff' && !ctrl.blockHeld) {
                pred.rotY = lerpAngle(pred.rotY, Math.atan2(ctrl.moveX, ctrl.moveZ), Math.min(1, dt * 14));
              }
            } else if (
              myLatest.actionState === 'dash' ||
              myLatest.actionState === 'stagger' ||
              myLatest.actionState === 'grab'
            ) {
              pred.vx = myLatest.vx;
              pred.vz = myLatest.vz;
              pred.rotY = myLatest.rotY;
            } else {
              pred.vx *= Math.exp(-10.0 * dt);
              pred.vz *= Math.exp(-10.0 * dt);
            }

            pred.x += pred.vx * dt;
            pred.z += pred.vz * dt;
            const resolved = resolveObstacleCollisions(
              mapId,
              pred.x,
              pred.y,
              pred.z,
              0.48,
              latestSnap.obstacles
            );
            pred.x = resolved.x;
            pred.z = resolved.z;

            const supportY = getObstacleSupportY(
              mapId,
              pred.x,
              pred.y,
              pred.z,
              0.42,
              latestSnap.obstacles
            );
            if (myLatest.isFlying) {
              const hoverY = supportY + 4.35;
              pred.y += (hoverY - pred.y) * Math.min(1, dt * 6.5);
              pred.yVel = 0;
              pred.grounded = false;
            } else {
              const baseGrav = isGravityBoost ? 18.5 : 26.0;
              const grav = myLatest.fighterId === 'marjohn' && pred.yVel < 0 ? baseGrav * 0.68 : baseGrav;
              if (pred.y > supportY || pred.yVel > 0) {
                pred.y += pred.yVel * dt;
                pred.yVel -= grav * dt;
                const postSup = getObstacleSupportY(
                  mapId,
                  pred.x,
                  pred.y,
                  pred.z,
                  0.42,
                  latestSnap.obstacles
                );
                if (pred.y <= postSup) {
                  pred.y = postSup;
                  pred.yVel = 0;
                  pred.grounded = true;
                } else {
                  pred.grounded = false;
                }
              } else {
                pred.y = supportY;
                pred.yVel = 0;
                pred.grounded = true;
              }
            }

            const r = Math.hypot(pred.x, pred.z);
            if (r > arenaRadius) {
              pred.x = (pred.x / r) * arenaRadius;
              pred.z = (pred.z / r) * arenaRadius;
            }
          }
        }

        const presentIds = new Set<string>();
        for (const aLatest of latestSnap.actors) {
          presentIds.add(aLatest.playerId);
          const skinId: SkinId = (aLatest.skinId ?? 'ascended') as SkinId;
          const isLocal = aLatest.playerId === playerIdRef.current;
          let rig = actorRigs.get(aLatest.playerId);
          if (
            !rig ||
            rig.id !== aLatest.fighterId ||
            rig.skinId !== skinId ||
            rig.isLocalPlayer !== isLocal
          ) {
            if (rig) disposeFighterRig(rig, scene);
            rig = createArticulatedFighter(aLatest.fighterId as FighterId, scene, skinId, isLocal);
            actorRigs.set(aLatest.playerId, rig);
          }

          let sm = smoothedActors.get(aLatest.playerId);
          if (!sm) {
            sm = { ...aLatest };
            smoothedActors.set(aLatest.playerId, sm);
          }

          if (
            aLatest.playerId === playerIdRef.current &&
            !aLatest.isKO &&
            aLatest.actionState !== 'clash' &&
            aLatest.actionState !== 'headlock' &&
            latestSnap.awakeningPhase !== 'CUTSCENE' &&
            pred.initialized
          ) {
            sm.x = pred.x;
            sm.y = pred.y;
            sm.z = pred.z;
            sm.vx = pred.vx;
            sm.yVel = pred.yVel;
            sm.vz = pred.vz;
            sm.grounded = pred.grounded;
            sm.rotY =
              aLatest.actionState === 'attack' ||
              aLatest.actionState === 'skill' ||
              aLatest.actionState === 'ultimate' ||
              aLatest.actionState === 'grab' ||
              aLatest.actionState === 'dash'
                ? aLatest.rotY
                : pred.rotY;
          } else {
            // Interpolate remote player cleanly between bracketing buffered server snapshots
            const aPrev = snapA.actors.find((x) => x.playerId === aLatest.playerId) ?? aLatest;
            const aNext = snapB.actors.find((x) => x.playerId === aLatest.playerId) ?? aLatest;
            let targetX = THREE.MathUtils.lerp(aPrev.x, aNext.x, alpha);
            let targetY = THREE.MathUtils.lerp(aPrev.y, aNext.y, alpha);
            let targetZ = THREE.MathUtils.lerp(aPrev.z, aNext.z, alpha);
            const targetRot = lerpAngle(aPrev.rotY, aNext.rotY, alpha);

            const extraSec = Math.max(0, Math.min(0.11, (renderServerTime - snapB.serverTime) / 1000));
            if (extraSec > 0.005 && !aLatest.isKO && aLatest.actionState !== 'clash' && aLatest.actionState !== 'headlock') {
              targetX += aNext.vx * extraSec;
              targetZ += aNext.vz * extraSec;
              targetY = Math.max(0, targetY + aNext.yVel * extraSec);
            }

            const blend = 1 - Math.exp(-24 * dt);
            sm.x = THREE.MathUtils.lerp(sm.x, targetX, blend);
            sm.y = THREE.MathUtils.lerp(sm.y, targetY, blend);
            sm.z = THREE.MathUtils.lerp(sm.z, targetZ, blend);
            sm.rotY = lerpAngle(sm.rotY, targetRot, blend);
            sm.vx = aLatest.vx;
            sm.yVel = aLatest.yVel;
            sm.vz = aLatest.vz;
            sm.grounded = aLatest.grounded;
          }

          sm.name = aLatest.name;
          sm.skinId = aLatest.skinId;
          sm.hp = aLatest.hp;
          sm.maxHp = aLatest.maxHp;
          sm.mana = aLatest.mana;
          sm.maxMana = aLatest.maxMana;
          sm.stamina = aLatest.stamina;
          sm.maxStamina = aLatest.maxStamina;
          sm.stagger = aLatest.stagger;
          sm.isStunned = aLatest.isStunned;
          sm.isOverdrive = aLatest.isOverdrive;
          sm.frenzyInside = aLatest.frenzyInside;
          sm.passiveStacks = aLatest.passiveStacks;
          sm.counterFlowActive = aLatest.counterFlowActive;
          sm.stage2Slot = aLatest.stage2Slot;
          sm.stage2Timer = aLatest.stage2Timer;
          sm.stage2Label = aLatest.stage2Label;
          sm.rushFatigue = aLatest.rushFatigue;
          sm.empoweredM1Ready = aLatest.empoweredM1Ready;
          sm.perfectEvadeTimer = aLatest.perfectEvadeTimer;
          sm.comboCount = aLatest.comboCount;
          sm.comboResetRemaining = aLatest.comboResetRemaining;
          sm.comboStep = aLatest.comboStep;
          sm.m1Variant = aLatest.m1Variant;
          sm.grabCooldown = aLatest.grabCooldown;
          sm.whiffTimer = aLatest.whiffTimer;
          sm.damagePhase = aLatest.damagePhase;
          sm.actionState = aLatest.actionState;
          sm.abilitySlot = aLatest.abilitySlot;
          const prevActionEntry = localActionTimers.get(aLatest.playerId);
          let nextLocalTimer = aLatest.actionTimer;
          if (!prevActionEntry || Math.abs(prevActionEntry.serverTimer - aLatest.actionTimer) > 0.001) {
            nextLocalTimer = aLatest.actionTimer;
          } else {
            nextLocalTimer = advanceActionTimer(aLatest.actionState, prevActionEntry.localTimer, dt);
          }
          localActionTimers.set(aLatest.playerId, {
            serverTimer: aLatest.actionTimer,
            localTimer: nextLocalTimer,
          });
          sm.actionTimer = nextLocalTimer;
          sm.actionDuration = aLatest.actionDuration;
          sm.shieldActive = aLatest.shieldActive;
          sm.parryWindow = aLatest.parryWindow;
          sm.blockHeld = aLatest.blockHeld;
          sm.dashCooldown = aLatest.dashCooldown;
          sm.dashMaxCooldown = aLatest.dashMaxCooldown;
          sm.dashCharges = aLatest.dashCharges;
          sm.dashMaxCharges = aLatest.dashMaxCharges;
          sm.dashRechargeRemaining = aLatest.dashRechargeRemaining;
          sm.isFlying = aLatest.isFlying;
          sm.flightRemaining = aLatest.flightRemaining;
          sm.flightMax = aLatest.flightMax;
          sm.flightCooldown = aLatest.flightCooldown;
          sm.speedBoostTimer = aLatest.speedBoostTimer;
          sm.superArmor = aLatest.superArmor;
          sm.awakened = aLatest.awakened;
          sm.awakeningTransformTimer = aLatest.awakeningTransformTimer;
          sm.silencedTimer = aLatest.silencedTimer;
          sm.snareMarkedTimer = aLatest.snareMarkedTimer;
          sm.cooldowns = aLatest.cooldowns;
          sm.isKO = aLatest.isKO;
          sm.koTime = aLatest.koTime;
          sm.koStyle = aLatest.koStyle;
          sm.koCause = aLatest.koCause;
          sm.koByFighterId = aLatest.koByFighterId;
          sm.wins = aLatest.wins;

          const worldBaseY = getMapTerrainHeight(mapId, sm.x, sm.z);
          vfx.setActorPosition(sm.playerId, sm.x, worldBaseY + sm.y, sm.z);

          // Awakened Footstep VFX
          if (sm.awakened && !sm.isKO && sm.grounded && Math.hypot(sm.vx, sm.vz) > 1.75) {
            const nextStep = (footstepTimersMap.get(sm.playerId) ?? 0) - dt;
            if (nextStep <= 0) {
              footstepTimersMap.set(sm.playerId, AWAKENING_CONFIG.FOOTSTEP_INTERVAL_SEC);
              const auraHex = AWAKENING_CONFIG.AWAKENED_KITS[sm.fighterId]?.auraPrimaryHex ?? 0x38bdf8;
              vfx.spawnPuffs(sm.x, worldBaseY + sm.y + 0.08, sm.z, auraHex, 2, 0.35, 0.65, 0.18, 0.55, 0.32, 0.42);
              vfx.spawnSparks(sm.x, worldBaseY + sm.y + 0.12, sm.z, auraHex, 2, 0.45, 4, 0.22);
            } else {
              footstepTimersMap.set(sm.playerId, nextStep);
            }
          }

          // Landing squash + dust puffs & jump stretch
          const wasGrounded = prevGroundedMap.get(sm.playerId);
          if (wasGrounded === false && sm.grounded && !sm.isKO) {
            rig.landingSquash = 0.78;
            vfx.spawnPuffs(sm.x, worldBaseY + sm.y + 0.12, sm.z, 0xcbd5e1, 4, 0.9, 0.9, 0.25, 0.85, 0.35, 0.38);
          } else if (wasGrounded === true && !sm.grounded && sm.yVel > 2.0 && !sm.isKO) {
            rig.landingSquash = 1.16;
          }
          prevGroundedMap.set(sm.playerId, sm.grounded);

          const pose = computeActorPose(sm, rig, elapsed, latestSnap.matchTime);
          poseFighter(rig, pose, mapId, elapsed);
        }

        // Headlock struggle sparks
        if (latestSnap.activeHeadlock && Math.random() < 0.32) {
          const hl = latestSnap.activeHeadlock;
          const hlGround = getMapTerrainHeight(mapId, hl.x, hl.z);
          vfx.spawnSparks(hl.x, hlGround + hl.y + 1.0, hl.z, 0xfacc15, 3, 1.1, 10, 0.22);
        }

        for (const [id, rig] of actorRigs.entries()) {
          if (!presentIds.has(id)) {
            disposeFighterRig(rig, scene);
            actorRigs.delete(id);
            smoothedActors.delete(id);
            prevGroundedMap.delete(id);
            localActionTimers.delete(id);
            footstepTimersMap.delete(id);
          }
        }

        // Clash Slow-Mo Dramatic Camera Cut OR Third-Person Centered Combat Camera
        const activeClash = latestSnap.activeClash;
        const clashInvolvesMe =
          activeClash &&
          (activeClash.playerAId === playerIdRef.current || activeClash.playerBId === playerIdRef.current);

        const mySm = smoothedActors.get(playerIdRef.current);
        const focusActor =
          mySm && !mySm.isKO
            ? mySm
            : Array.from(smoothedActors.values()).find((a) => !a.isKO) ?? mySm;

        const isAwakeningCutscene =
          latestSnap.awakeningPhase === 'CUTSCENE' && Boolean(latestSnap.awakeningCutscene);
        if (isAwakeningCutscene !== cutsceneFilterActive) {
          cutsceneFilterActive = isAwakeningCutscene;
          container.style.filter = isAwakeningCutscene
            ? 'contrast(1.2) saturate(0.84) brightness(0.95) hue-rotate(-6deg)'
            : '';
        }

        if (isAwakeningCutscene && latestSnap.awakeningCutscene) {
          const cs = latestSnap.awakeningCutscene;
          const clock = cs.clockSec;
          lockRing.visible = false;
          if (clock < AWAKENING_CONFIG.TIMELINE.CLASH_START_AT) {
            // 0:00 - 0:15: Slow dramatic orbit + push-in toward center walk
            const t = Math.max(0, Math.min(1, clock / AWAKENING_CONFIG.TIMELINE.WALK_FADE_END));
            const orbit = (t - 0.5) * 0.42;
            const radius = THREE.MathUtils.lerp(15.0, 10.6, t);
            const camY = THREE.MathUtils.lerp(4.4, 2.75, t);
            destPos.set(Math.sin(orbit) * radius, camY, Math.cos(orbit) * radius);
            destLook.set(0, 1.35, 0);
          } else {
            // 0:15 - 0:18: Dramatic side-angle Clash framing
            destPos.set(0, 3.1, 11.8);
            destLook.set(THREE.MathUtils.clamp(cs.clashBalance * 1.4, -1.4, 1.4), 1.3, 0);
          }
          const camDamp = 1 - Math.exp(-8.5 * rawDt);
          camPos.lerp(destPos, camDamp);
          camLook.lerp(destLook, camDamp);
          const clashRumble = clock >= AWAKENING_CONFIG.TIMELINE.CLASH_START_AT ? 0.14 : 0;
          const shakeMag = Math.max(shakeRef.current, clashRumble);
          if (shakeMag > 0.01) {
            shakeRef.current *= Math.exp(-9 * rawDt);
            const sh = computeTraumaShake(shakeMag, elapsed);
            camera.position.set(camPos.x + sh.x, camPos.y + sh.y, camPos.z + sh.z);
          } else {
            camera.position.copy(camPos);
          }
          camera.lookAt(camLook);
        } else if (clashInvolvesMe && activeClash) {
          const clashA = smoothedActors.get(activeClash.playerAId);
          const clashB = smoothedActors.get(activeClash.playerBId);
          const yaw = clashA && clashB ? Math.atan2(clashB.x - clashA.x, clashB.z - clashA.z) : 0;
          const sideAngle = yaw + Math.PI * 0.45;
          const groundMid = getMapTerrainHeight(mapId, activeClash.x, activeClash.z);
          destPos.set(
            activeClash.x + Math.sin(sideAngle) * 5.6,
            groundMid + activeClash.y + 1.15,
            activeClash.z + Math.cos(sideAngle) * 5.6
          );
          destLook.set(activeClash.x, groundMid + activeClash.y, activeClash.z);
          lockRing.visible = false;

          const camDamp = 1 - Math.exp(-12 * rawDt);
          camPos.lerp(destPos, camDamp);
          camLook.lerp(destLook, camDamp);
          camera.position.copy(camPos);
          camera.lookAt(camLook);
        } else if (focusActor) {
          let lockedEnemy: ArenaActorState | undefined;
          const aliveEnemies = Array.from(smoothedActors.values()).filter(
            (a) => a.playerId !== focusActor.playerId && !a.isKO
          );
          if (targetIdRef.current) {
            lockedEnemy = aliveEnemies.find((a) => a.playerId === targetIdRef.current);
          }
          if (!lockedEnemy && aliveEnemies.length > 0) {
            lockedEnemy = aliveEnemies.reduce((best, cand) => {
              const db = Math.hypot(best.x - focusActor.x, best.z - focusActor.z);
              const dc = Math.hypot(cand.x - focusActor.x, cand.z - focusActor.z);
              return dc < db ? cand : best;
            }, aliveEnemies[0]);
          }

          const actorGroundY = getMapTerrainHeight(mapId, focusActor.x, focusActor.z);
          const isSkyMeteor = focusActor.actionState === 'ultimate' && focusActor.abilitySlot === 5;
          const actorWorldY =
            actorGroundY +
            (isSkyMeteor
              ? Math.min(focusActor.y * 0.45, 3.4)
              : focusActor.isFlying
              ? focusActor.y * 0.88
              : focusActor.y * 0.65);
          const isPortrait = aspectRef.current < 0.9;

          if (lockedEnemy) {
            const enemyGroundY = getMapTerrainHeight(mapId, lockedEnemy.x, lockedEnemy.z);
            lockRing.visible = true;
            lockRing.position.set(lockedEnemy.x, enemyGroundY + lockedEnemy.y + 0.095, lockedEnemy.z);
            lockRing.rotation.z = elapsed * 2.5;
          } else {
            lockRing.visible = false;
          }

          // MLBB-Style Angled Isometric MOBA Camera (~57.9 deg pitch, balanced front/rear visibility + center bias)
          let camDist = (isPortrait ? 21.2 : 17.6) + (isSkyMeteor ? 3.2 : 0);
          let focusX = focusActor.x;
          let focusY = actorWorldY;
          let focusZ = focusActor.z;

          const cin = cinematicCamRef.current;
          if (cin) {
            cin.remaining -= rawDt;
            if (cin.remaining <= 0) {
              cinematicCamRef.current = null;
            } else {
              const p = 1 - cin.remaining / Math.max(0.01, cin.duration);
              const env = Math.sin(p * Math.PI);
              if (cin.mode === 'wide_storm') {
                camDist += 3.2 * env;
              } else if (cin.mode === 'low_beam' || cin.mode === 'punch_in' || cin.mode === 'high_noon') {
                camDist -= 1.8 * env;
              } else if (cin.mode === 'ko_slow') {
                camDist -= 2.2 * env;
                const koGround = getMapTerrainHeight(mapId, cin.focusX, cin.focusZ);
                focusX = THREE.MathUtils.lerp(focusX, cin.focusX, 0.35 * env);
                focusY = THREE.MathUtils.lerp(focusY, koGround + cin.focusY, 0.35 * env);
                focusZ = THREE.MathUtils.lerp(focusZ, cin.focusZ, 0.35 * env);
              }
            }
          }

          const lockedRig = computeLockedTopDownCamera(
            focusX,
            focusY,
            focusZ,
            focusActor.isFlying,
            1.01,
            camDist,
            isPortrait
          );

          if (roomPhaseRef.current === 'countdown') {
            const cdRem = Math.max(0, Math.min(5.0, roomCountdownRef.current || 0));
            const p = 1 - cdRem / 5.0;
            const orbitAngle = Math.PI * 0.25 + p * Math.PI * 0.82;
            const orbitRadius = (isPortrait ? 23.0 : 19.5) - p * 2.5;
            const centerFocus = Math.min(1, p * 1.15);
            const introCamX = Math.sin(orbitAngle) * orbitRadius;
            const introCamY = focusY + (isPortrait ? 13.5 : 10.5) + (1 - p) * 3.8;
            const introCamZ = Math.cos(orbitAngle) * orbitRadius;
            const introLookX = THREE.MathUtils.lerp(0, focusX, centerFocus);
            const introLookY = focusY + 1.15;
            const introLookZ = THREE.MathUtils.lerp(0, focusZ, centerFocus);

            const settleRaw = Math.max(0, Math.min(1, (p - 0.62) / 0.34));
            const settle = settleRaw * settleRaw * (3 - 2 * settleRaw);
            destPos.set(
              THREE.MathUtils.lerp(introCamX, lockedRig.camX, settle),
              THREE.MathUtils.lerp(introCamY, lockedRig.camY, settle),
              THREE.MathUtils.lerp(introCamZ, lockedRig.camZ, settle)
            );
            destLook.set(
              THREE.MathUtils.lerp(introLookX, lockedRig.lookX, settle),
              THREE.MathUtils.lerp(introLookY, lockedRig.lookY, settle),
              THREE.MathUtils.lerp(introLookZ, lockedRig.lookZ, settle)
            );
          } else {
            destPos.set(lockedRig.camX, lockedRig.camY, lockedRig.camZ);
            destLook.set(lockedRig.lookX, lockedRig.lookY, lockedRig.lookZ);
          }

          if (!camInitialized) {
            camPos.copy(destPos);
            camLook.copy(destLook);
            camInitialized = true;
          } else {
            const camDamp = 1 - Math.exp(-12.5 * rawDt);
            camPos.lerp(destPos, camDamp);
            camLook.lerp(destLook, camDamp);
          }

          // Smooth speed/dash/ultimate FOV kick
          const focusSpeed = Math.hypot(focusActor.vx, focusActor.vz);
          const fovBoost =
            focusActor.actionState === 'dash'
              ? 4.4
              : focusActor.actionState === 'ultimate'
              ? 3.4
              : focusSpeed > 9.5
              ? 2.0
              : 0;
          const targetFov = baseFovRef.current + fovBoost;
          smoothedFov = dampScalar(smoothedFov, targetFov, 9.5, rawDt);
          if (Math.abs(camera.fov - smoothedFov) > 0.05) {
            camera.fov = smoothedFov;
            camera.updateProjectionMatrix();
          }

          let shakeRoll = 0;
          if (shakeRef.current > 0.01) {
            shakeRef.current *= Math.exp(-9 * rawDt);
            const shake = computeTraumaShake(shakeRef.current, elapsed);
            shakeRoll = shake.roll;
            camera.position.set(camPos.x + shake.x, camPos.y + shake.y, camPos.z + shake.z);
          } else {
            shakeRef.current = 0;
            camera.position.copy(camPos);
          }
          camera.lookAt(camLook);
          if (Math.abs(shakeRoll) > 0.0002) {
            camera.rotation.z += shakeRoll;
          }
          if (cameraYawRef) {
            cameraYawRef.current = lockedYawRef.current;
          }
          if (aimPitchRef) {
            aimPitchRef.current = -0.65;
          }
        }
      }

      // Throttled 2D screen-edge projection for active Awakening Orbs
      if (onOrbIndicatorsRef.current && latestSnap) {
        const activeOrbs = (latestSnap.awakeningOrbs ?? []).filter((o) => o.active);
        if (activeOrbs.length > 0 && now - lastOrbEmitMs >= 75) {
          lastOrbEmitMs = now;
          hadOrbIndicators = true;
          const meActor = smoothedActors.get(playerIdRef.current);
          const indicators: OrbScreenIndicator[] = activeOrbs.map((orb) => {
            const groundY = getMapTerrainHeight(mapId, orb.x, orb.z);
            _projVec.set(orb.x, groundY + orb.y + 0.5, orb.z).project(camera);
            const behind = _projVec.z > 1;
            let sx = _projVec.x;
            let sy = _projVec.y;
            if (behind) {
              sx = -sx;
              sy = -sy;
            }
            const onScreen = !behind && Math.abs(sx) <= 0.88 && Math.abs(sy) <= 0.85;
            const rawPctX = (sx * 0.5 + 0.5) * 100;
            const rawPctY = (-sy * 0.5 + 0.5) * 100;
            let clampedX = rawPctX;
            let clampedY = rawPctY;
            if (!onScreen) {
              const vx = rawPctX - 50;
              const vy = rawPctY - 50;
              const scale = Math.max(Math.abs(vx) / 42, Math.abs(vy) / 38, 1);
              clampedX = 50 + vx / scale;
              clampedY = 50 + vy / scale;
            }
            const angleDeg = (Math.atan2(rawPctY - 50, rawPctX - 50) * 180) / Math.PI;
            const distMeters = meActor ? Math.round(Math.hypot(orb.x - meActor.x, orb.z - meActor.z)) : 0;
            return {
              id: orb.id,
              xPct: Math.max(6, Math.min(94, clampedX)),
              yPct: Math.max(10, Math.min(88, clampedY)),
              angleDeg,
              distMeters,
              onScreen,
            };
          });
          onOrbIndicatorsRef.current(indicators);
        } else if (activeOrbs.length === 0 && hadOrbIndicators) {
          hadOrbIndicators = false;
          onOrbIndicatorsRef.current([]);
        }
      }

      renderer.render(scene, camera);
      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };
    tick();

    return () => {
      active = false;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      container.style.filter = '';
      ro?.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('scroll', resize);
      document.removeEventListener('fullscreenchange', resize);
      renderer.domElement.removeEventListener('pointerdown', onCanvasPointerDown);
      renderer.domElement.removeEventListener('pointerup', onCanvasPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onCanvasPointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      cameraRef.current = null;
      for (const rig of actorRigs.values()) {
        disposeFighterRig(rig, scene);
      }
      actorRigs.clear();
      smoothedActors.clear();
      prevGroundedMap.clear();
      localActionTimers.clear();
      footstepTimersMap.clear();
      lockRingGeom.dispose();
      lockRingMat.dispose();
      envTex.dispose();
      builtMap.dispose();
      vfx.dispose();
      vfxRef.current = null;
      renderer.dispose();
    };
  }, [mapId, clockOffsetMsRef, jitterMsRef, localControlRef, cameraYawRef, aimPitchRef]);

  return (
    <div
      ref={mountRef}
      data-testid="arena-canvas"
      onContextMenu={(e) => e.preventDefault()}
      className="fixed inset-0 w-full h-full z-0 bg-slate-100 touch-none-select"
    />
  );
};
