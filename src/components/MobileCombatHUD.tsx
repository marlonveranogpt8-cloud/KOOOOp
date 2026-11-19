import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Coins,
  Crosshair,
  Feather,
  Flame,
  Hand,
  Lock,
  LockOpen,
  LogOut,
  RotateCcw,
  Shield,
  ShieldCheck,
  Sparkles,
  Swords,
  Trophy,
  Volume2,
  VolumeX,
  Wind,
  Zap,
} from 'lucide-react';
import {
  AbilitySlot,
  ArenaActorState,
  ArenaSnapshot,
  CombatMoveType,
  FIGHTER_BY_ID,
  FighterId,
  JM_SECRET_ABILITY,
  KoCause,
  MAP_BY_ID,
  RoomChatMessage,
  RoomState,
  TrainingConfig,
  isJtinsullenTag,
} from '../shared/gameData.ts';
import { soundEngine } from '../game/soundEngine.ts';
import { AWAKENING_CONFIG, getAwakenedAbility } from '../shared/awakeningConfig.ts';
import {
  SKILL_HOLD_TIME_MS,
  computeCountdownStep,
  computeSwipeAimPoint,
  selectNearestTarget,
  shouldEnterDragAim,
} from '../game/combatMath.ts';
import type { CoinRewardBreakdown, UserAccount } from '../game/accountStore.ts';
import type { CloudUserProfile } from '../game/firebaseUsers.ts';
import { ArenaMinimap } from './ArenaMinimap.tsx';
import { FullscreenControls } from './FullscreenControls.tsx';
import { RoomChatBox } from './RoomChatBox.tsx';
import type { DamagePopup, HitFlashInfo, OrbScreenIndicator } from './ArenaViewport.tsx';
import type { AimPreviewState } from '../game/vfxManager.ts';

const LIGHT_TEXT_BY_FIGHTER: Record<FighterId, string> = {
  jm: '#b45309',
  marjohn: '#0369a1',
  prime: '#be123c',
  damen: '#b45309',
  khen: '#7e22ce',
};

interface MobileCombatHUDProps {
  room: RoomState;
  playerId: string;
  account?: UserAccount | null;
  cloudUser?: CloudUserProfile | null;
  isAdmin?: boolean;
  lastCoinReward?: CoinRewardBreakdown | null;
  pingMs: number | null;
  snapshot: ArenaSnapshot | null;
  targetId: string | null;
  lockOnEnabled: boolean;
  cameraYawRef: React.MutableRefObject<number>;
  aimPreviewRef?: React.MutableRefObject<AimPreviewState>;
  cancelAimTriggerSeq?: number;
  damagePopups: DamagePopup[];
  hitFlash: HitFlashInfo | null;
  orbIndicators?: OrbScreenIndicator[];
  chatMessages: RoomChatMessage[];
  unreadChatCount: number;
  chatOpen: boolean;
  onToggleChat: () => void;
  onSendChat: (text: string) => void;
  onSelectTarget: (targetId: string | null) => void;
  onToggleLockOn: () => void;
  onMoveInput: (moveX: number, moveZ: number) => void;
  onJump: () => void;
  onToggleFlight: () => void;
  onDash: () => void;
  onGrab: () => void;
  onClashPick: (clashId: string, choice: CombatMoveType) => void;
  onBlockHoldChange: (held: boolean) => void;
  onCastAbility: (
    slot: AbilitySlot,
    holdHeavy?: boolean,
    aimPayload?: { aimX?: number; aimZ?: number; isHoldVariant?: boolean }
  ) => void;
  onAimUpdate?: (aimX: number, aimZ: number) => void;
  onTrainingConfig?: (cfg: Partial<TrainingConfig>) => void;
  onOpenAdminMonitor?: () => void;
  onRematch: () => void;
  onLeave: () => void;
}

const KO_CAUSE_LABELS: Record<KoCause, string> = {
  parry: 'Counter Execution',
  ultimate: 'Ultimate Finish',
  combo: 'Combo Obliteration',
  clash: 'Clash Breaker KO',
  grab: 'Grab Slam KO',
  ring: 'Storm Ring KO',
  normal: 'Arena KO',
};

function getAbilitySpec(fighterId: FighterId, slot: AbilitySlot, awakened = false) {
  if (slot === 5) return JM_SECRET_ABILITY;
  if (awakened || slot === 6) {
    const aw = getAwakenedAbility(fighterId, slot);
    if (aw) {
      return {
        ...aw,
        manaCost: aw.chiCost,
        staminaCost: 0,
      };
    }
  }
  const fallbackIdx = slot === 6 ? 4 : slot;
  return FIGHTER_BY_ID[fighterId].abilities[fallbackIdx] ?? FIGHTER_BY_ID[fighterId].abilities[0];
}

function getPassiveSummary(actor: ArenaActorState): { label: string; active: boolean } {
  if (actor.fighterId === 'jm') {
    if (actor.isFlying) {
      return { label: `SKY FLIGHT ${(actor.flightRemaining ?? 0).toFixed(1)}s`, active: true };
    }
    if ((actor.flightCooldown ?? 0) > 0.05) {
      return { label: `FLIGHT CD ${(actor.flightCooldown ?? 0).toFixed(1)}s`, active: false };
    }
    return { label: 'SKY FLIGHT READY', active: true };
  }
  if (actor.fighterId === 'damen') {
    if ((actor.speedBoostTimer ?? 0) > 0.05) {
      return { label: `QUICK-DRAW ${(actor.speedBoostTimer ?? 0).toFixed(1)}s`, active: true };
    }
    return { label: 'QUICK-DRAW STEP', active: false };
  }
  if (actor.fighterId === 'marjohn') {
    return {
      label: actor.passiveStacks > 0 ? `GALE DRIFT ×${actor.passiveStacks}` : 'GALE DRIFT',
      active: !actor.grounded || actor.passiveStacks > 0,
    };
  }
  if (actor.fighterId === 'prime') {
    if (actor.superArmor) {
      return { label: 'SUPER ARMOR!', active: true };
    }
    return { label: 'JUGGERNAUT -15% KB', active: false };
  }
  if ((actor.speedBoostTimer ?? 0) > 0.05) {
    return { label: `SHADOW SPD ${(actor.speedBoostTimer ?? 0).toFixed(1)}s`, active: true };
  }
  return { label: 'BACKSTAB +20%', active: true };
}

export const MobileCombatHUD: React.FC<MobileCombatHUDProps> = ({
  room,
  playerId,
  account = null,
  cloudUser = null,
  isAdmin = false,
  lastCoinReward = null,
  pingMs,
  snapshot,
  targetId,
  lockOnEnabled,
  cameraYawRef,
  aimPreviewRef,
  cancelAimTriggerSeq = 0,
  damagePopups,
  hitFlash,
  orbIndicators = [],
  chatMessages,
  unreadChatCount,
  chatOpen,
  onToggleChat,
  onSendChat,
  onSelectTarget,
  onToggleLockOn,
  onMoveInput,
  onJump,
  onToggleFlight,
  onDash,
  onGrab,
  onClashPick,
  onBlockHoldChange,
  onCastAbility,
  onAimUpdate,
  onTrainingConfig,
  onOpenAdminMonitor,
  onRematch,
  onLeave,
}) => {
  const [muted, setMuted] = useState(soundEngine.muted);
  const [trailHp, setTrailHp] = useState<number>(100);
  const [hpShakeKey, setHpShakeKey] = useState<number>(0);
  const [mashPulseKey, setMashPulseKey] = useState<number>(0);
  const [isCompactScreen, setIsCompactScreen] = useState(false);
  const [isNarrowPortrait, setIsNarrowPortrait] = useState(false);
  const lastCountdownStepRef = useRef<number | null>(null);
  const prevPhaseRef = useRef<RoomState['phase']>(room.phase);
  const [aimOverlay, setAimOverlay] = useState<{
    slot: AbilitySlot;
    label: string;
    cancelled: boolean;
    cx: number;
    cy: number;
  } | null>(null);

  const prevHpRef = useRef<number | null>(null);
  const [knobOffset, setKnobOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const joyPointerId = useRef<number | null>(null);
  const joyCenter = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const joyVec = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const keysPressed = useRef<Set<string>>(new Set());
  const blockPointerId = useRef<number | null>(null);
  const jumpPointerId = useRef<number | null>(null);
  const attackPointerId = useRef<number | null>(null);
  const m1SwipeRef = useRef<{
    pointerId: number;
    cx: number;
    cy: number;
    downAt: number;
    aimMode: boolean;
    maxDragDist: number;
    cancelled: boolean;
    aimX: number;
    aimZ: number;
    shiftHeld: boolean;
  } | null>(null);

  // Tap vs Hold-Drag aiming controller for Skills & Ultimates
  const aimKnobRef = useRef<HTMLDivElement | null>(null);
  const aimGestureRef = useRef<{
    slot: AbilitySlot;
    pointerId: number;
    cx: number;
    cy: number;
    downAt: number;
    holdMode: boolean;
    maxDragDist: number;
    cancelled: boolean;
    aimX: number;
    aimZ: number;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);

  // Keyboard hold-to-aim tracking (hold skill key >= 150ms to project live 3D floor aim outline)
  const kbAimRef = useRef<{
    slot: AbilitySlot;
    code: string;
    holdMode: boolean;
    cancelled: boolean;
    aimX: number;
    aimZ: number;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);

  const myActor = snapshot?.actors.find((a) => a.playerId === playerId) ?? null;
  const mySpec = myActor ? FIGHTER_BY_ID[myActor.fighterId] : FIGHTER_BY_ID.jm;
  const showSecretSolar = Boolean(
    myActor && myActor.fighterId === 'jm' && isJtinsullenTag(myActor.name)
  );

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const targetIdRef = useRef(targetId);
  targetIdRef.current = targetId;
  const lockOnEnabledRef = useRef(lockOnEnabled);
  lockOnEnabledRef.current = lockOnEnabled;
  const myActorRef = useRef(myActor);
  myActorRef.current = myActor;
  const showSecretSolarRef = useRef(showSecretSolar);
  showSecretSolarRef.current = showSecretSolar;
  const onCastAbilityRef = useRef(onCastAbility);
  onCastAbilityRef.current = onCastAbility;
  const onAimUpdateRef = useRef(onAimUpdate);
  onAimUpdateRef.current = onAimUpdate;
  const isHost = room.hostId === playerId;
  const activeClash = snapshot?.activeClash ?? null;
  const clashInvolvesMe =
    activeClash && (activeClash.playerAId === playerId || activeClash.playerBId === playerId);
  const myClashChoice =
    clashInvolvesMe && activeClash
      ? activeClash.playerAId === playerId
        ? activeClash.choiceA
        : activeClash.choiceB
      : null;
  const activeHeadlock = snapshot?.activeHeadlock ?? null;
  const headlockInvolvesMe =
    activeHeadlock && (activeHeadlock.grabberId === playerId || activeHeadlock.victimId === playerId);

  // Smooth delayed white HP damage trail + impact shake when taking a hit
  useEffect(() => {
    if (!myActor) return;
    if (prevHpRef.current !== null && myActor.hp < prevHpRef.current - 2) {
      setHpShakeKey((k) => k + 1);
    }
    prevHpRef.current = myActor.hp;

    if (myActor.hp > trailHp) {
      setTrailHp(myActor.hp);
      return;
    }
    if (myActor.hp < trailHp) {
      const t = setTimeout(() => {
        setTrailHp((prev) => Math.max(myActor.hp, prev - Math.max(1, (prev - myActor.hp) * 0.25)));
      }, 65);
      return () => clearTimeout(t);
    }
  }, [myActor?.hp, trailHp]);

  // Play escalating countdown ticks (5-4-3-2-1) and fightHorn on combat start
  useEffect(() => {
    if (room.phase === 'countdown') {
      const step = computeCountdownStep(room.countdown);
      if (step > 0 && lastCountdownStepRef.current !== step) {
        lastCountdownStepRef.current = step;
        soundEngine.playCountdownTick(step);
      }
    } else if (room.phase === 'combat' && prevPhaseRef.current === 'countdown') {
      lastCountdownStepRef.current = null;
      soundEngine.play('fightHorn');
    } else if (room.phase !== 'combat') {
      lastCountdownStepRef.current = null;
    }
    prevPhaseRef.current = room.phase;
  }, [room.phase, room.countdown]);

  // Responsive viewport detection (including visualViewport for mobile keyboard/toolbar transitions)
  useEffect(() => {
    const check = () => {
      const vw = window.visualViewport?.width ?? window.innerWidth;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      setIsCompactScreen(vw < 900 || vh < 540);
      setIsNarrowPortrait(vw < 430);
    };
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    window.visualViewport?.addEventListener('resize', check);
    document.addEventListener('fullscreenchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
      window.visualViewport?.removeEventListener('resize', check);
      document.removeEventListener('fullscreenchange', check);
    };
  }, []);

  const computeKeyboardAimCoords = (slot: AbilitySlot) => {
    const actorsList = snapshotRef.current?.actors ?? [];
    const actor = actorsList.find((a) => a.playerId === playerId);
    if (!actor) return null;
    const ab = getAbilitySpec(actor.fighterId, slot, actor.awakened);
    const aimRange = ab.aimRange ?? 8.5;

    let dirX = Math.sin(actor.rotY);
    let dirZ = Math.cos(actor.rotY);
    let reach = ab.aimKind === 'point' ? Math.min(aimRange, 6.2) : aimRange;

    let aimTarget: ArenaActorState | null = null;
    if (lockOnEnabledRef.current) {
      if (targetIdRef.current) {
        aimTarget =
          actorsList.find((a) => a.playerId === targetIdRef.current && !a.isKO) ?? null;
      }
      if (!aimTarget) {
        aimTarget = selectNearestTarget(
          actor.x,
          actor.z,
          actor.playerId,
          actorsList,
          Math.max(aimRange + 4.5, 15.5)
        );
      }
    }

    const keys = keysPressed.current;
    let kx = 0;
    let ky = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) kx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) kx += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) ky -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) ky += 1;

    if (kx !== 0 || ky !== 0) {
      const len = Math.hypot(kx, ky);
      const sx = kx / len;
      const sy = ky / len;
      const yaw = cameraYawRef.current;
      const forward = -sy;
      const right = sx;
      dirX = forward * Math.sin(yaw) + right * -Math.cos(yaw);
      dirZ = forward * Math.cos(yaw) + right * Math.sin(yaw);
    } else if (aimTarget) {
      const tdx = aimTarget.x - actor.x;
      const tdz = aimTarget.z - actor.z;
      const dist = Math.hypot(tdx, tdz);
      if (dist > 0.08) {
        dirX = tdx / dist;
        dirZ = tdz / dist;
        if (ab.aimKind === 'point') {
          reach = Math.max(1.5, Math.min(aimRange, dist));
        }
      }
    }

    return {
      actor,
      ab,
      aimRange,
      aimX: actor.x + dirX * reach,
      aimZ: actor.z + dirZ * reach,
    };
  };

  const cancelActiveAim = () => {
    if (aimGestureRef.current) {
      if (aimGestureRef.current.timer) clearTimeout(aimGestureRef.current.timer);
      aimGestureRef.current = null;
      setAimOverlay(null);
    }
    if (m1SwipeRef.current) {
      m1SwipeRef.current = null;
      setAimOverlay(null);
    }
    if (kbAimRef.current) {
      if (kbAimRef.current.timer) clearTimeout(kbAimRef.current.timer);
      kbAimRef.current.cancelled = true;
      kbAimRef.current.holdMode = false;
    }
    if (aimPreviewRef) {
      aimPreviewRef.current.active = false;
      aimPreviewRef.current.cancelled = false;
    }
  };

  useEffect(() => {
    if (cancelAimTriggerSeq > 0) {
      cancelActiveAim();
    }
  }, [cancelAimTriggerSeq]);

  // Reset all active touch/keyboard holds on blur, visibility loss, KO, or leaving combat
  const releaseAllControlsRef = useRef<(sendNeutral?: boolean) => void>(() => {});
  releaseAllControlsRef.current = (sendNeutral = true) => {
    if (joyPointerId.current !== null || joyVec.current.x !== 0 || joyVec.current.y !== 0) {
      joyPointerId.current = null;
      joyVec.current = { x: 0, y: 0 };
      setKnobOffset({ x: 0, y: 0 });
    }
    keysPressed.current.clear();
    if (blockPointerId.current !== null) {
      blockPointerId.current = null;
      onBlockHoldChange(false);
    }
    jumpPointerId.current = null;
    attackPointerId.current = null;
    if (kbAimRef.current?.timer) clearTimeout(kbAimRef.current.timer);
    kbAimRef.current = null;
    cancelActiveAim();
    if (sendNeutral) {
      onMoveInput(0, 0);
      onBlockHoldChange(false);
    }
  };

  useEffect(() => {
    if (room.phase !== 'combat' || myActor?.isKO) {
      releaseAllControlsRef.current(true);
    }
  }, [room.phase, myActor?.isKO]);

  // Global pointerup/pointercancel/blur safety net so lost mobile touches NEVER stay stuck
  useEffect(() => {
    const onGlobalPointerEnd = (e: PointerEvent) => {
      if (joyPointerId.current === e.pointerId) {
        joyPointerId.current = null;
        joyVec.current = { x: 0, y: 0 };
        setKnobOffset({ x: 0, y: 0 });
        onMoveInput(0, 0);
      }
      if (blockPointerId.current === e.pointerId) {
        blockPointerId.current = null;
        onBlockHoldChange(false);
      }
      if (jumpPointerId.current === e.pointerId) {
        jumpPointerId.current = null;
      }
      if (attackPointerId.current === e.pointerId) {
        attackPointerId.current = null;
      }
      if (m1SwipeRef.current?.pointerId === e.pointerId) {
        const g = m1SwipeRef.current;
        m1SwipeRef.current = null;
        setAimOverlay(null);
        if (aimPreviewRef) aimPreviewRef.current.active = false;
        if (e.type !== 'pointercancel' && !g.cancelled) {
          if (g.aimMode) {
            onCastAbility(0, g.shiftHeld, { aimX: g.aimX, aimZ: g.aimZ });
          } else {
            onCastAbility(0, g.shiftHeld);
          }
        }
      }
      if (aimGestureRef.current?.pointerId === e.pointerId) {
        const g = aimGestureRef.current;
        if (g.timer) clearTimeout(g.timer);
        aimGestureRef.current = null;
        setAimOverlay(null);
        if (aimPreviewRef) aimPreviewRef.current.active = false;
        if (e.type !== 'pointercancel' && !g.cancelled) {
          if (g.holdMode) {
            onCastAbility(g.slot, false, { aimX: g.aimX, aimZ: g.aimZ, isHoldVariant: true });
          } else {
            onCastAbility(g.slot, false);
          }
        }
      }
    };
    const onWindowBlur = () => releaseAllControlsRef.current(true);
    const onVisChange = () => {
      if (document.hidden) releaseAllControlsRef.current(true);
    };

    window.addEventListener('pointerup', onGlobalPointerEnd);
    window.addEventListener('pointercancel', onGlobalPointerEnd);
    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('visibilitychange', onVisChange);
    return () => {
      window.removeEventListener('pointerup', onGlobalPointerEnd);
      window.removeEventListener('pointercancel', onGlobalPointerEnd);
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }, [aimPreviewRef, onBlockHoldChange, onCastAbility, onMoveInput]);

  // Stream movement vector at 25Hz
  useEffect(() => {
    const computeAndSend = () => {
      if (room.phase !== 'combat' || myActor?.isKO) return;
      let sx = joyVec.current.x;
      let sy = joyVec.current.y;

      const keys = keysPressed.current;
      let kx = 0;
      let ky = 0;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) kx -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) kx += 1;
      if (keys.has('KeyW') || keys.has('ArrowUp')) ky -= 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) ky += 1;
      if (kx !== 0 || ky !== 0) {
        const len = Math.hypot(kx, ky);
        sx = kx / len;
        sy = ky / len;
      }

      const yaw = cameraYawRef.current;
      const forward = -sy;
      const right = sx;
      const moveX = forward * Math.sin(yaw) + right * -Math.cos(yaw);
      const moveZ = forward * Math.cos(yaw) + right * Math.sin(yaw);
      onMoveInput(moveX, moveZ);

      const ka = kbAimRef.current;
      if (ka && ka.holdMode && !ka.cancelled) {
        const coords = computeKeyboardAimCoords(ka.slot);
        if (coords) {
          ka.aimX = coords.aimX;
          ka.aimZ = coords.aimZ;
          if (aimPreviewRef) {
            aimPreviewRef.current = {
              active: true,
              cancelled: false,
              aimKind: coords.ab.aimKind ?? 'point',
              originX: coords.actor.x,
              originY: coords.actor.y,
              originZ: coords.actor.z,
              aimX: coords.aimX,
              aimZ: coords.aimZ,
              radius: coords.ab.aimRadius ?? 3.0,
              range: coords.aimRange,
              colorHex: ka.slot === 5 ? 0xfacc15 : FIGHTER_BY_ID[coords.actor.fighterId].hex,
            };
          }
          if (
            ka.slot === 5 &&
            coords.actor.actionState === 'ultimate' &&
            coords.actor.abilitySlot === 5 &&
            onAimUpdateRef.current
          ) {
            onAimUpdateRef.current(coords.aimX, coords.aimZ);
          }
        }
      }
    };

    const id = setInterval(computeAndSend, 40);
    return () => clearInterval(id);
  }, [room.phase, myActor?.isKO, cameraYawRef, aimPreviewRef, onMoveInput]);

  const triggerM1 = (shiftHeld = false) => {
    if (!myActor || myActor.isKO) return;
    if (clashInvolvesMe && activeClash && !myClashChoice) {
      onClashPick(activeClash.id, 'strike');
      return;
    }
    onCastAbility(0, shiftHeld);
  };

  const triggerM1Ref = useRef(triggerM1);
  triggerM1Ref.current = triggerM1;

  // Keyboard shortcuts (WASD move, Space Jump, E JM Sky Flight, Q Dash, Tab Lock-On, M1/J Attack, F Guard, G Grab+Headlock Mash, 1/2/3 Skills+Ult, R/4 Awakened Skill 4, O Secret)
  useEffect(() => {
    const startKeyboardAimOrCast = (slot: AbilitySlot, code: string) => {
      const actor = myActorRef.current;
      if (!actor || actor.isKO) return;
      const isStage2 = slot === 3 && actor.stage2Slot === 3 && (actor.stage2Timer ?? 0) > 0;
      const ab = getAbilitySpec(actor.fighterId, slot, actor.awakened);
      const supportsAim = !isStage2 && Boolean(ab.aimKind && ab.aimKind !== 'none');
      if (!supportsAim) {
        onCastAbilityRef.current(slot);
        return;
      }

      if (kbAimRef.current?.timer) clearTimeout(kbAimRef.current.timer);
      const init = computeKeyboardAimCoords(slot);
      const initAimX = init?.aimX ?? actor.x + Math.sin(actor.rotY) * (ab.aimRange ?? 8.0);
      const initAimZ = init?.aimZ ?? actor.z + Math.cos(actor.rotY) * (ab.aimRange ?? 8.0);

      const timer = setTimeout(() => {
        const cur = kbAimRef.current;
        if (!cur || cur.code !== code || cur.cancelled) return;
        cur.holdMode = true;
        const fresh = computeKeyboardAimCoords(slot);
        if (fresh) {
          cur.aimX = fresh.aimX;
          cur.aimZ = fresh.aimZ;
          if (aimPreviewRef) {
            aimPreviewRef.current = {
              active: true,
              cancelled: false,
              aimKind: fresh.ab.aimKind ?? 'point',
              originX: fresh.actor.x,
              originY: fresh.actor.y,
              originZ: fresh.actor.z,
              aimX: fresh.aimX,
              aimZ: fresh.aimZ,
              radius: fresh.ab.aimRadius ?? 3.0,
              range: fresh.aimRange,
              colorHex: slot === 5 ? 0xfacc15 : FIGHTER_BY_ID[fresh.actor.fighterId].hex,
            };
          }
        }
      }, SKILL_HOLD_TIME_MS);

      kbAimRef.current = {
        slot,
        code,
        holdMode: false,
        cancelled: false,
        aimX: initAimX,
        aimZ: initAimZ,
        timer,
      };
    };

    const releaseKeyboardAim = (code: string) => {
      const cur = kbAimRef.current;
      if (!cur || cur.code !== code) return;
      if (cur.timer) clearTimeout(cur.timer);
      const slot = cur.slot;
      const holdMode = cur.holdMode;
      const cancelled = cur.cancelled;
      const aimX = cur.aimX;
      const aimZ = cur.aimZ;
      kbAimRef.current = null;
      if (aimPreviewRef) {
        aimPreviewRef.current.active = false;
        aimPreviewRef.current.cancelled = false;
      }
      if (cancelled) return;
      if (holdMode) {
        onCastAbilityRef.current(slot, false, { aimX, aimZ, isHoldVariant: true });
      } else {
        onCastAbilityRef.current(slot, false);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;
      if (e.repeat) return;
      keysPressed.current.add(e.code);
      if (room.phase !== 'combat') return;

      if (clashInvolvesMe && activeClash && !myClashChoice) {
        if (e.code === 'KeyJ') {
          onClashPick(activeClash.id, 'strike');
          return;
        }
        if (e.code === 'KeyG') {
          onClashPick(activeClash.id, 'grab');
          return;
        }
        if (e.code === 'KeyF') {
          onClashPick(activeClash.id, 'parry');
          return;
        }
      }

      if (e.code === 'Escape') {
        cancelActiveAim();
      } else if (e.code === 'Tab') {
        e.preventDefault();
        onToggleLockOn();
      } else if (e.code === 'Space') {
        e.preventDefault();
        onJump();
      } else if (e.code === 'KeyE') {
        if (myActorRef.current?.fighterId === 'jm') {
          onToggleFlight();
        }
      } else if (e.code === 'KeyR') {
        if (myActorRef.current?.awakened) {
          startKeyboardAimOrCast(6, e.code);
        }
      } else if (e.code === 'KeyQ') {
        e.preventDefault();
        cancelActiveAim();
        onDash();
      } else if (e.code === 'KeyJ') {
        triggerM1Ref.current(e.shiftKey);
      } else if (e.code === 'KeyG') {
        if (snapshotRef.current?.activeHeadlock) {
          const hl = snapshotRef.current.activeHeadlock;
          if (hl.grabberId === playerId || hl.victimId === playerId) {
            soundEngine.unlock();
            soundEngine.play('grabMash');
            setMashPulseKey((k) => k + 1);
          }
        }
        onGrab();
      } else if (e.code === 'KeyF') {
        onBlockHoldChange(true);
        onCastAbilityRef.current(1);
      } else if (e.code === 'Digit1') {
        startKeyboardAimOrCast(2, e.code);
      } else if (e.code === 'Digit2') {
        startKeyboardAimOrCast(3, e.code);
      } else if (e.code === 'Digit3') {
        startKeyboardAimOrCast(4, e.code);
      } else if (e.code === 'Digit4') {
        if (myActorRef.current?.awakened) {
          startKeyboardAimOrCast(6, e.code);
        } else if (showSecretSolarRef.current) {
          startKeyboardAimOrCast(5, e.code);
        }
      } else if (e.code === 'KeyO' && showSecretSolarRef.current) {
        startKeyboardAimOrCast(5, e.code);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysPressed.current.delete(e.code);
      if (e.code === 'KeyF') {
        onBlockHoldChange(false);
      }
      if (
        e.code === 'Digit1' ||
        e.code === 'Digit2' ||
        e.code === 'Digit3' ||
        e.code === 'KeyO' ||
        e.code === 'Digit4' ||
        e.code === 'KeyR'
      ) {
        releaseKeyboardAim(e.code);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    room.phase,
    clashInvolvesMe,
    activeClash,
    myClashChoice,
    aimPreviewRef,
    onToggleLockOn,
    onJump,
    onToggleFlight,
    onDash,
    onGrab,
    onClashPick,
    onBlockHoldChange,
  ]);

  const maxJoyRadius = isNarrowPortrait ? 28 : isCompactScreen ? 34 : 46;

  const handleJoyDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (joyPointerId.current !== null) return;
    soundEngine.unlock();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore synthetic pointer
    }
    joyPointerId.current = e.pointerId;
    const rect = e.currentTarget.getBoundingClientRect();
    joyCenter.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    updateJoy(e.clientX, e.clientY);
  };

  const updateJoy = (cx: number, cy: number) => {
    const dx = cx - joyCenter.current.x;
    const dy = cy - joyCenter.current.y;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, maxJoyRadius);
    const nx = dist > 0.01 ? (dx / dist) * (clamped / maxJoyRadius) : 0;
    const ny = dist > 0.01 ? (dy / dist) * (clamped / maxJoyRadius) : 0;
    joyVec.current = { x: nx, y: ny };
    setKnobOffset({ x: nx * maxJoyRadius, y: ny * maxJoyRadius });
  };

  const handleJoyMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (joyPointerId.current !== e.pointerId) return;
    updateJoy(e.clientX, e.clientY);
  };

  const handleJoyUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (joyPointerId.current !== e.pointerId) return;
    joyPointerId.current = null;
    joyVec.current = { x: 0, y: 0 };
    setKnobOffset({ x: 0, y: 0 });
    onMoveInput(0, 0);
  };

  // Hold-Drag vs Tap aiming helpers for Slots 2, 3, 4, 6 & Secret Slot 5
  const lastAimUpdateSentRef = useRef<number>(0);
  const updateAimGestureCoords = (clientX: number, clientY: number) => {
    const g = aimGestureRef.current;
    const actor = snapshot?.actors.find((a) => a.playerId === playerId);
    if (!g || !actor) return;
    const ab = getAbilitySpec(actor.fighterId, g.slot, actor.awakened);
    const maxR = 52;
    const dx = clientX - g.cx;
    const dy = clientY - g.cy;
    const dist = Math.hypot(dx, dy);
    g.maxDragDist = Math.max(g.maxDragDist, dist);

    const clampedDist = Math.min(dist, maxR);
    const kx = dist > 0.1 ? (dx / dist) * clampedDist : 0;
    const ky = dist > 0.1 ? (dy / dist) * clampedDist : 0;
    if (aimKnobRef.current) {
      aimKnobRef.current.style.transform = `translate(${kx}px, ${ky}px)`;
    }

    const nowCancelled = g.maxDragDist >= 28 && dist < 12;
    if (nowCancelled !== g.cancelled) {
      g.cancelled = nowCancelled;
      setAimOverlay((prev) => (prev ? { ...prev, cancelled: nowCancelled } : prev));
    }

    const aimRange = ab.aimRange ?? 8.5;
    if (dist >= 15) {
      const mag = Math.min(1, dist / maxR);
      const nx = dx / dist;
      const ny = dy / dist;
      const yaw = cameraYawRef.current;
      const forward = -ny;
      const right = nx;
      const wx = forward * Math.sin(yaw) + right * -Math.cos(yaw);
      const wz = forward * Math.cos(yaw) + right * Math.sin(yaw);
      const reach = ab.aimKind === 'point' ? aimRange * mag : aimRange;
      g.aimX = actor.x + wx * reach;
      g.aimZ = actor.z + wz * reach;
    } else {
      const defaultDist = ab.aimKind === 'point' ? 3.2 : aimRange;
      g.aimX = actor.x + Math.sin(actor.rotY) * defaultDist;
      g.aimZ = actor.z + Math.cos(actor.rotY) * defaultDist;
    }

    if (
      g.slot === 5 &&
      actor.actionState === 'ultimate' &&
      actor.abilitySlot === 5 &&
      onAimUpdate &&
      performance.now() - lastAimUpdateSentRef.current >= 45
    ) {
      lastAimUpdateSentRef.current = performance.now();
      onAimUpdate(g.aimX, g.aimZ);
    }

    if (aimPreviewRef) {
      aimPreviewRef.current = {
        active: g.holdMode,
        cancelled: g.cancelled,
        aimKind: ab.aimKind ?? 'point',
        originX: actor.x,
        originY: actor.y,
        originZ: actor.z,
        aimX: g.aimX,
        aimZ: g.aimZ,
        radius: ab.aimRadius ?? 3.0,
        range: aimRange,
        colorHex: g.slot === 5 ? 0xfacc15 : FIGHTER_BY_ID[actor.fighterId].hex,
      };
    }
  };

  const handleAbilityPointerDown = (slot: AbilitySlot, e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    soundEngine.unlock();
    const actor = snapshot?.actors.find((a) => a.playerId === playerId);
    const isStage2 = slot === 3 && actor?.stage2Slot === 3 && (actor?.stage2Timer ?? 0) > 0;
    const ab = actor ? getAbilitySpec(actor.fighterId, slot, actor.awakened) : null;
    const supportsAim =
      !isStage2 &&
      (slot === 2 || slot === 3 || slot === 4 || slot === 5 || slot === 6) &&
      ab?.aimKind &&
      ab.aimKind !== 'none';

    if (!supportsAim || !actor) {
      onCastAbility(slot);
      return;
    }

    if (aimGestureRef.current?.timer) {
      clearTimeout(aimGestureRef.current.timer);
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore synthetic pointer
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const defaultDist = ab.aimKind === 'point' ? 3.2 : ab.aimRange ?? 9.0;
    const initAimX = actor.x + Math.sin(actor.rotY) * defaultDist;
    const initAimZ = actor.z + Math.cos(actor.rotY) * defaultDist;

    const enterHold = () => {
      const g = aimGestureRef.current;
      if (!g || g.holdMode) return;
      g.holdMode = true;
      setAimOverlay({
        slot,
        label: ab.holdAimLabel ?? ab.name,
        cancelled: g.cancelled,
        cx,
        cy,
      });
      if (aimPreviewRef) {
        aimPreviewRef.current = {
          active: true,
          cancelled: g.cancelled,
          aimKind: ab.aimKind ?? 'point',
          originX: actor.x,
          originY: actor.y,
          originZ: actor.z,
          aimX: g.aimX,
          aimZ: g.aimZ,
          radius: ab.aimRadius ?? 3.0,
          range: ab.aimRange ?? 8.5,
          colorHex: slot === 5 ? 0xfacc15 : FIGHTER_BY_ID[actor.fighterId].hex,
        };
      }
    };

    const timer = setTimeout(enterHold, SKILL_HOLD_TIME_MS);
    aimGestureRef.current = {
      slot,
      pointerId: e.pointerId,
      cx,
      cy,
      downAt: performance.now(),
      holdMode: false,
      maxDragDist: 0,
      cancelled: false,
      aimX: initAimX,
      aimZ: initAimZ,
      timer,
    };
  };

  const handleAbilityPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const g = aimGestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const dist = Math.hypot(e.clientX - g.cx, e.clientY - g.cy);
    const elapsed = performance.now() - g.downAt;
    if (!g.holdMode && shouldEnterDragAim(dist, elapsed)) {
      if (g.timer) {
        clearTimeout(g.timer);
        g.timer = null;
      }
      g.holdMode = true;
      const actor = snapshot?.actors.find((a) => a.playerId === playerId);
      const ab = actor ? getAbilitySpec(actor.fighterId, g.slot) : null;
      setAimOverlay({
        slot: g.slot,
        label: ab?.holdAimLabel ?? ab?.name ?? 'Aim',
        cancelled: g.cancelled,
        cx: g.cx,
        cy: g.cy,
      });
    }
    updateAimGestureCoords(e.clientX, e.clientY);
  };

  const handleAbilityPointerUp = (e: React.PointerEvent<HTMLButtonElement>, isCancel = false) => {
    const g = aimGestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (g.timer) {
      clearTimeout(g.timer);
      g.timer = null;
    }
    aimGestureRef.current = null;
    setAimOverlay(null);
    if (aimPreviewRef) {
      aimPreviewRef.current.active = false;
    }
    if (isCancel || g.cancelled) return;
    if (g.holdMode) {
      onCastAbility(g.slot, false, {
        aimX: g.aimX,
        aimZ: g.aimZ,
        isHoldVariant: true,
      });
    } else {
      onCastAbility(g.slot, false);
    }
  };

  const cycleTarget = () => {
    if (!snapshot) return;
    const enemies = snapshot.actors.filter((a) => a.playerId !== playerId && !a.isKO);
    if (enemies.length === 0) {
      onSelectTarget(null);
      return;
    }
    const idx = enemies.findIndex((e) => e.playerId === targetId);
    const next = enemies[(idx + 1) % enemies.length];
    onSelectTarget(next.playerId);
  };

  const actors = snapshot?.actors ?? [];
  const otherActors = actors.filter((a) => a.playerId !== playerId);
  const winnerActor = room.winnerId ? actors.find((a) => a.playerId === room.winnerId) : null;

  const myHpPct = myActor ? Math.max(0, Math.min(100, (myActor.hp / myActor.maxHp) * 100)) : 100;
  const myTrailPct = myActor ? Math.max(myHpPct, Math.min(100, (trailHp / myActor.maxHp) * 100)) : 100;
  const myMpPct = myActor ? Math.max(0, Math.min(100, (myActor.mana / myActor.maxMana) * 100)) : 100;
  const myStamPct = myActor ? Math.max(0, Math.min(100, (myActor.stamina / myActor.maxStamina) * 100)) : 100;
  const myStagPct = myActor ? Math.max(0, Math.min(100, myActor.stagger)) : 0;
  const passiveInfo = myActor ? getPassiveSummary(myActor) : null;
  const battleEvent = snapshot?.battleEvent ?? null;

  const isFourHitCombo =
    myActor?.fighterId === 'jm' || myActor?.fighterId === 'prime' || myActor?.fighterId === 'khen';
  const m1NextStep = myActor
    ? isFourHitCombo
      ? ((myActor.comboStep % 4) + 1) as 1 | 2 | 3 | 4
      : 1
    : 1;
  const m1ActiveName =
    myActor?.fighterId === 'jm' && myActor.isFlying
      ? 'BOLT'
      : mySpec.m1Combo.stepNames[(m1NextStep - 1) % mySpec.m1Combo.stepNames.length].split(' ')[0];
  const m1SubLabel =
    myActor?.fighterId === 'jm' && myActor.isFlying
      ? 'AIR BOLT · SWIPE'
      : myActor?.fighterId === 'marjohn'
      ? 'TORNADO · SWIPE'
      : myActor?.fighterId === 'damen'
      ? '0.8s · SWIPE'
      : m1NextStep === 4
      ? 'FINISHER 4/4'
      : `HIT ${m1NextStep}/4`;

  const comboHits = myActor?.comboCount ?? 0;
  const comboMultiplier = 1 + Math.min(1.5, comboHits * 0.1);
  const comboTimeLeft = myActor?.comboResetRemaining ?? 0;
  const comboTimerPct = comboHits > 0 ? Math.max(0, Math.min(100, (comboTimeLeft / 2.0) * 100)) : 0;
  const isFrenzyMode = Boolean(myActor?.frenzyInside || battleEvent?.kind === 'frenzy');
  const roundWinnerPlayer = room.roundWinnerId
    ? room.players.find((p) => p.playerId === room.roundWinnerId) ?? null
    : null;
  const nextMapSpec = MAP_BY_ID[room.mapId];
  const matchTime = snapshot?.matchTime ?? 0;
  const stormActive = Boolean(snapshot?.stormActive);
  const stormRadius = snapshot?.stormRadius ?? MAP_BY_ID[room.mapId].arenaRadius;
  const outsideStorm = Boolean(
    stormActive &&
      myActor &&
      !myActor.isKO &&
      Math.hypot(myActor.x, myActor.z) > stormRadius
  );
  const ringInSec = Math.max(0, Math.ceil(60 - matchTime));
  const ringCountdownLabel = `${Math.floor(ringInSec / 60)}:${String(ringInSec % 60).padStart(2, '0')}`;
  const isCutsceneActive = room.phase === 'combat' && snapshot?.awakeningPhase === 'CUTSCENE';

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      className={`fixed inset-0 w-full h-[100dvh] z-10 pointer-events-none select-none overflow-hidden flex-col justify-between p-1.5 sm:p-3 safe-area-pad ${
        isCutsceneActive ? 'hidden' : 'flex'
      }`}
    >
      {/* AWAKENED SUBTLE SCREEN-EDGE AURA VIGNETTE */}
      {myActor?.awakened && !myActor.isKO && (
        <div
          data-testid="awakened-vignette"
          aria-hidden="true"
          className="fixed inset-0 z-15 pointer-events-none animate-awakening-vignette"
          style={{
            boxShadow: `inset 0 0 72px 10px ${AWAKENING_CONFIG.AWAKENED_KITS[myActor.fighterId].auraPrimaryCss}55`,
          }}
        />
      )}

      {/* AWAKENING EVENT BANNER (ORBS APPEARED / PLAYER AWAKENED) */}
      {snapshot?.awakeningBanner && snapshot.awakeningBanner.remaining > 0 && (
        <div
          key={snapshot.awakeningBanner.id}
          data-testid="awakening-banner"
          className="fixed top-20 sm:top-24 left-1/2 z-40 pointer-events-none animate-awakening-banner max-w-[92vw]"
        >
          <div
            className="rounded-2xl bg-slate-950/92 border-2 px-5 py-2.5 text-center shadow-[0_0_32px_rgba(250,204,21,0.5)]"
            style={{
              borderColor: `#${snapshot.awakeningBanner.colorHex.toString(16).padStart(6, '0')}`,
            }}
          >
            <div className="font-manga text-xl sm:text-3xl tracking-wider text-amber-300 leading-none">
              {snapshot.awakeningBanner.text}
            </div>
            {snapshot.awakeningBanner.subtext && (
              <div className="text-[10px] sm:text-xs font-display font-bold uppercase tracking-widest text-sky-200 mt-1">
                {snapshot.awakeningBanner.subtext}
              </div>
            )}
          </div>
        </div>
      )}

      {/* EDGE-OF-SCREEN AWAKENING ORB DIRECTIONAL ARROW INDICATORS */}
      {room.phase === 'combat' &&
        snapshot?.awakeningPhase !== 'CUTSCENE' &&
        orbIndicators.map((ind) =>
          ind.onScreen ? null : (
            <div
              key={ind.id}
              data-testid="orb-edge-indicator"
              className="fixed z-25 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center gap-1 rounded-full bg-slate-950/90 border-2 border-cyan-400 px-2 py-1 shadow-[0_0_16px_rgba(56,189,248,0.7)]"
              style={{ left: `${ind.xPct}%`, top: `${ind.yPct}%` }}
            >
              <span
                className="inline-block text-amber-300 text-xs font-black leading-none"
                style={{ transform: `rotate(${ind.angleDeg}deg)` }}
              >
                ➤
              </span>
              <span className="font-display font-bold text-[9px] text-cyan-200 uppercase whitespace-nowrap">
                ORB {ind.distMeters}m
              </span>
            </div>
          )
        )}

      {/* STORM ZONE OUTSIDE-RING RED EDGE WARNING */}
      {outsideStorm && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-20 pointer-events-none animate-storm-edge"
          style={{
            boxShadow: 'inset 0 0 72px 18px rgba(244, 63, 94, 0.72)',
            background: 'radial-gradient(circle, transparent 58%, rgba(225, 29, 72, 0.34) 100%)',
          }}
        />
      )}

      {/* DIRECTIONAL HIT-FLASH VIGNETTE */}
      {hitFlash && (
        <div
          key={hitFlash.id}
          className="fixed inset-0 z-20 pointer-events-none animate-hit-flash"
          style={{
            background:
              hitFlash.direction === 'left'
                ? 'linear-gradient(90deg, rgba(244,63,94,0.68) 0%, transparent 32%)'
                : hitFlash.direction === 'right'
                ? 'linear-gradient(270deg, rgba(244,63,94,0.68) 0%, transparent 32%)'
                : hitFlash.direction === 'top'
                ? 'linear-gradient(180deg, rgba(244,63,94,0.62) 0%, transparent 30%)'
                : hitFlash.direction === 'bottom'
                ? 'linear-gradient(0deg, rgba(244,63,94,0.62) 0%, transparent 30%)'
                : 'radial-gradient(circle, transparent 52%, rgba(244,63,94,0.62) 100%)',
          }}
        />
      )}

      {/* COMPACT FLOATING DAMAGE NUMBERS (Light Crisp Pill) */}
      {damagePopups.map((p) => (
        <div
          key={p.id}
          className="fixed z-25 pointer-events-none animate-dmg-float flex flex-col items-center"
          style={{ left: `${p.xPct}%`, top: `${p.yPct}%` }}
        >
          {p.label && (
            <span
              className="font-display font-bold text-[8px] sm:text-[9px] tracking-wider px-1.5 py-0.2 rounded bg-white/95 border border-slate-300 shadow-sm uppercase whitespace-nowrap"
              style={{ color: p.color === '#facc15' || p.color === '#38bdf8' ? '#0f172a' : p.color }}
            >
              {p.label}
            </span>
          )}
          {p.amount > 0 && (
            <span
              className={`font-display font-bold font-mono-num px-1.5 rounded-md bg-white/90 border border-slate-300 shadow-sm ${
                p.isBig ? 'text-sm sm:text-base text-rose-700' : 'text-xs sm:text-sm text-slate-950'
              }`}
            >
              -{p.amount}
            </span>
          )}
        </div>
      ))}

      {/* MLBB TOP BAR: TOP-LEFT MINIMAP + PLAYER BAR | TOP-RIGHT KOs, COINS, ADMIN & QUICK MENU */}
      <div className="w-full flex items-start justify-between gap-1.5 sm:gap-2 pointer-events-none">
        <div className="flex items-start gap-1.5 sm:gap-2 flex-1 min-w-0 pointer-events-auto">
          {/* Top-Left Live Tactical Minimap */}
          {snapshot && (
            <ArenaMinimap
              mapId={room.mapId}
              playerId={playerId}
              targetId={targetId}
              actors={snapshot.actors}
              obstacles={snapshot.obstacles}
              pickups={snapshot.pickups}
              awakeningOrbs={snapshot.awakeningOrbs ?? []}
              stormActive={stormActive}
              stormRadius={stormRadius}
              compact={isNarrowPortrait || isCompactScreen}
            />
          )}

          {/* Compact Player Vitals Card + Combo Counter */}
          {myActor && (
            <div className="flex flex-col gap-1 shrink-0">
              <div
                key={hpShakeKey}
                className={`rounded-xl bg-white/95 border shadow-lg ${
                  hpShakeKey > 0 ? 'animate-hp-shake' : ''
                } ${
                  myActor.awakened
                    ? 'border-amber-400 ring-2 ring-amber-300/90 shadow-[0_0_20px_rgba(250,204,21,0.45)]'
                    : myActor.isOverdrive
                    ? 'border-rose-500 ring-1 ring-rose-400'
                    : myActor.isStunned
                    ? 'border-amber-500 ring-1 ring-amber-400'
                    : 'border-slate-200'
                } ${
                  isNarrowPortrait
                    ? 'w-[136px] px-1.5 py-1'
                    : isCompactScreen
                    ? 'w-[168px] px-2 py-1'
                    : 'w-[216px] sm:w-[244px] px-2.5 py-1.5'
                }`}
              >
                <div className="flex items-center justify-between gap-1 text-[10px] sm:text-xs">
                  <div className="flex items-center gap-1 min-w-0 flex-1 overflow-hidden">
                    {cloudUser?.photoURL ? (
                      <img
                        src={cloudUser.photoURL}
                        alt={cloudUser.displayName}
                        referrerPolicy="no-referrer"
                        className={`rounded-md object-cover border border-slate-300 shrink-0 ${
                          isNarrowPortrait ? 'w-4 h-4' : 'w-5 h-5'
                        }`}
                      />
                    ) : (
                      <span
                        className={`rounded-md font-display font-bold text-slate-950 border border-slate-900/15 flex items-center justify-center shrink-0 shadow-xs ${
                          isNarrowPortrait ? 'w-4 h-4 text-[8px]' : 'w-5 h-5 text-[10px]'
                        }`}
                        style={{ backgroundColor: mySpec.color }}
                      >
                        {mySpec.name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <span
                      className="font-display font-bold tracking-wide truncate"
                      style={{ color: LIGHT_TEXT_BY_FIGHTER[myActor.fighterId] }}
                    >
                      {mySpec.name}
                    </span>
                    {!isNarrowPortrait && !room.isSoloPractice && !room.isTrainingMode && (
                      <span
                        className="flex items-center gap-0.5 shrink-0"
                        title={`Round Wins: ${myActor.wins}/${room.winsToWin}`}
                      >
                        {Array.from({ length: room.winsToWin }).map((_, idx) => (
                          <span
                            key={idx}
                            className={`w-1.5 h-1.5 rounded-xs rotate-45 border ${
                              idx < myActor.wins
                                ? 'bg-amber-500 border-amber-700'
                                : 'bg-slate-200 border-slate-400'
                            }`}
                          />
                        ))}
                      </span>
                    )}
                  </div>
                  <span data-testid="player-hp-text" className="font-mono-num font-bold text-slate-900 shrink-0">
                    {myActor.hp}/{myActor.maxHp}
                  </span>
                </div>

                {(myActor.awakened ||
                  (myActor.silencedTimer ?? 0) > 0.05 ||
                  myActor.isOverdrive ||
                  myActor.isStunned ||
                  (!myActor.isStunned && myActor.whiffTimer > 0) ||
                  myActor.superArmor ||
                  myActor.isFlying ||
                  (myActor.perfectEvadeTimer ?? 0) > 0 ||
                  myActor.parryWindow ||
                  myActor.shieldActive) && (
                  <div className="flex flex-wrap items-center gap-1 mt-0.5">
                    {myActor.awakened && (
                      <span
                        data-testid="awakened-badge"
                        className="px-1.5 py-0.2 rounded bg-gradient-to-r from-amber-400 to-yellow-300 text-slate-950 border border-amber-600 font-display font-bold text-[8px] leading-tight shrink-0"
                      >
                        ★ AWAKENED
                      </span>
                    )}
                    {(myActor.silencedTimer ?? 0) > 0.05 && (
                      <span className="px-1 rounded bg-purple-600 text-white font-bold text-[8px]">SILENCED</span>
                    )}
                    {myActor.isOverdrive && (
                      <span className="px-1 rounded bg-rose-600 text-white font-display font-bold text-[8px]">
                        OD
                      </span>
                    )}
                    {myActor.isStunned && (
                      <span className="px-1 rounded bg-amber-400 text-slate-950 font-bold text-[8px]">STUN</span>
                    )}
                    {!myActor.isStunned && myActor.whiffTimer > 0 && (
                      <span className="px-1 rounded bg-orange-500 text-white font-bold text-[8px]">OPEN</span>
                    )}
                    {myActor.superArmor && (
                      <span className="px-1 rounded bg-orange-400 text-slate-950 font-bold text-[8px]">ARMOR</span>
                    )}
                    {myActor.isFlying && (
                      <span className="px-1 rounded bg-amber-300 text-slate-950 font-bold text-[8px]">FLY</span>
                    )}
                    {(myActor.perfectEvadeTimer ?? 0) > 0 && (
                      <span className="px-1 rounded bg-emerald-500 text-white font-bold text-[8px]">EVADE</span>
                    )}
                    {myActor.parryWindow && (
                      <span className="px-1 rounded bg-amber-400 text-slate-950 font-bold text-[8px]">PARRY</span>
                    )}
                    {!myActor.parryWindow && myActor.shieldActive && (
                      <span className="px-1 rounded bg-sky-500 text-white font-bold text-[8px]">GUARD</span>
                    )}
                  </div>
                )}

                {/* Skewed HP Bar + Delayed Damage Trail */}
                <div className="relative h-2 sm:h-2.5 w-full bg-slate-200 rounded-sm overflow-hidden my-1 -skew-x-6 border border-slate-300">
                  <div
                    className="absolute inset-y-0 left-0 bg-rose-300 transition-all duration-150"
                    style={{ width: `${myTrailPct}%` }}
                  />
                  <div
                    className="relative h-full transition-all duration-75"
                    style={{
                      width: `${myHpPct}%`,
                      backgroundColor:
                        myActor.isOverdrive
                          ? '#e11d48'
                          : myHpPct > 55
                          ? '#16a34a'
                          : myHpPct > 28
                          ? '#d97706'
                          : '#e11d48',
                    }}
                  />
                </div>

                {/* Stamina + Chi Dual Resource Bars */}
                <div className="grid grid-cols-2 gap-1.5 items-center">
                  <div className="flex items-center gap-1">
                    <div className="h-1.5 flex-1 bg-slate-200 rounded-full overflow-hidden border border-slate-300">
                      <div
                        className="h-full transition-all duration-75"
                        style={{
                          width: `${myStamPct}%`,
                          backgroundColor: myStamPct < 20 ? '#e11d48' : '#f59e0b',
                        }}
                      />
                    </div>
                    <span className="font-mono-num text-[8px] font-bold text-amber-700 shrink-0">
                      {Math.round(myActor.stamina)}S
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div
                      className={`h-1.5 flex-1 bg-slate-200 rounded-full overflow-hidden border ${
                        myActor.awakened ? 'border-amber-400 shadow-[0_0_8px_rgba(56,189,248,0.45)]' : 'border-slate-300'
                      }`}
                    >
                      <div
                        className={`h-full transition-all duration-75 ${
                          myActor.awakened ? 'bg-gradient-to-r from-sky-400 via-cyan-400 to-amber-300' : 'bg-sky-500'
                        }`}
                        style={{ width: `${myMpPct}%` }}
                      />
                    </div>
                    <span data-testid="player-chi-text" className="font-mono-num text-[8px] font-bold text-sky-700 shrink-0">
                      {Math.round(myActor.mana)}C
                    </span>
                  </div>
                </div>

                {/* Stagger Meter + Passive Readout */}
                <div className="mt-1 flex items-center justify-between gap-1 text-[8px]">
                  <div className="flex items-center gap-1 flex-1 min-w-0">
                    <span className="text-slate-600 font-bold shrink-0">STAG</span>
                    <div className="h-1 flex-1 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full transition-all duration-75"
                        style={{
                          width: `${myStagPct}%`,
                          backgroundColor: myStagPct >= 75 ? '#e11d48' : '#ea580c',
                        }}
                      />
                    </div>
                  </div>
                  {passiveInfo && (
                    <span
                      className={`font-bold truncate ${
                        passiveInfo.active ? 'text-amber-700' : 'text-slate-600'
                      }`}
                    >
                      {passiveInfo.label}
                    </span>
                  )}
                </div>
              </div>

              {/* Persistent Combo Counter Widget */}
              {room.phase === 'combat' && !myActor.isKO && comboHits > 0 && (
                <div
                  className={`pointer-events-none rounded-xl border px-2 py-0.5 bg-white/95 shadow-md transition-colors ${
                    isNarrowPortrait ? 'w-[126px]' : isCompactScreen ? 'w-[160px]' : 'w-[208px] sm:w-[232px]'
                  } ${
                    isFrenzyMode
                      ? 'border-rose-500 animate-frenzy-combo-pulse'
                      : comboHits >= 5
                      ? 'border-amber-500'
                      : 'border-sky-500'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-baseline gap-1 min-w-0">
                      <span
                        key={comboHits}
                        className="font-display font-bold font-mono-num text-xs sm:text-sm text-amber-600 animate-combo-pop leading-none"
                      >
                        {comboMultiplier.toFixed(1)}×
                      </span>
                      <span className="font-display font-bold text-[10px] text-slate-900 font-mono-num truncate">
                        {comboHits} HIT{comboHits > 1 ? 'S' : ''}
                      </span>
                    </div>
                    <span className="text-[9px] font-display font-bold uppercase text-sky-700 shrink-0">
                      {isFrenzyMode ? 'FRENZY' : `${comboTimeLeft.toFixed(1)}s`}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1 w-full bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-sky-600 transition-all duration-75"
                      style={{ width: `${comboTimerPct}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Opponent Compact Cards */}
          <div className="hidden sm:flex items-center gap-1 flex-1 min-w-0 overflow-x-auto no-scrollbar">
            {otherActors.map((a) => {
              const spec = FIGHTER_BY_ID[a.fighterId];
              const isTarget = a.playerId === targetId;
              const hpPct = Math.max(0, Math.round((a.hp / a.maxHp) * 100));
              const stagPct = Math.max(0, Math.min(100, a.stagger));
              return (
                <button
                  key={a.playerId}
                  type="button"
                  onClick={() => !a.isKO && onSelectTarget(a.playerId)}
                  className={`ui-interactive shrink-0 min-w-[98px] max-w-[132px] rounded-lg px-2 py-1 border text-left cursor-pointer shadow-sm ${
                    a.isKO
                      ? 'bg-slate-100 border-slate-200 opacity-50'
                      : isTarget
                      ? 'bg-white border-rose-500 ring-1 ring-rose-300'
                      : 'bg-white/95 border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 text-[9px] leading-tight">
                    <span className="font-bold text-slate-900 truncate">{a.name}</span>
                    <span className="font-mono-num font-bold text-slate-800">{a.hp}</span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-200 rounded-sm overflow-hidden my-0.5">
                    <div
                      className="h-full transition-all duration-100"
                      style={{ width: `${hpPct}%`, backgroundColor: spec.color }}
                    />
                  </div>
                  <div className="h-0.5 w-full bg-slate-200 rounded-full overflow-hidden mb-0.5">
                    <div
                      className="h-full transition-all duration-100"
                      style={{
                        width: `${stagPct}%`,
                        backgroundColor: a.isStunned ? '#e11d48' : '#d97706',
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[8px] leading-none">
                    <span className="font-display font-bold" style={{ color: LIGHT_TEXT_BY_FIGHTER[a.fighterId] }}>
                      {spec.name}
                    </span>
                    <span className="font-bold text-slate-500 truncate">
                      {a.isStunned ? 'STUN!' : a.isOverdrive ? 'OD' : `${a.kills}KO`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Top-Right KOs + Synced Coins + Admin + Menu Controls */}
        <div
          className={`flex flex-col items-end gap-1 shrink-0 pointer-events-auto ${
            isNarrowPortrait ? 'max-w-[168px]' : ''
          }`}
        >
          <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap justify-end">
            {myActor && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/95 border border-slate-200 shadow-xs font-mono-num text-[10px] font-bold text-rose-700">
                <Swords className="w-3 h-3 text-rose-600" />
                <span>{myActor.kills} KO</span>
              </div>
            )}

            {(cloudUser || account) && (
              <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-100 border border-amber-300 shadow-xs font-mono-num text-[10px] font-bold text-amber-900">
                <Coins className="w-3 h-3 text-amber-600" />
                <span>{cloudUser?.coins ?? account?.coins ?? 0}</span>
              </div>
            )}

            {isAdmin && onOpenAdminMonitor && (
              <button
                type="button"
                data-testid="admin-monitor-btn"
                onClick={() => {
                  soundEngine.unlock();
                  soundEngine.play('uiClick');
                  onOpenAdminMonitor();
                }}
                className="ui-interactive min-h-[30px] sm:min-h-[34px] px-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-amber-300 border border-slate-950 text-[10px] font-display font-bold flex items-center gap-1 cursor-pointer shadow-xs"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Admin</span>
              </button>
            )}

            {pingMs !== null && (
              <div className="hidden lg:flex items-center px-2 py-1 rounded-lg bg-white/95 border border-slate-200 shadow-xs font-mono-num text-[10px] font-bold text-emerald-700">
                {pingMs}ms
              </div>
            )}

            <RoomChatBox
              messages={chatMessages}
              playerId={playerId}
              unreadCount={unreadChatCount}
              isOpen={chatOpen}
              inMatch
              onToggleOpen={onToggleChat}
              onSendMessage={onSendChat}
            />

            <FullscreenControls compact lockLandscape />

            <button
              type="button"
              onClick={() => {
                soundEngine.unlock();
                soundEngine.play('uiClick');
                onToggleLockOn();
              }}
              title="Toggle Camera Lock-On (Tab)"
              className={`ui-interactive ${
                isNarrowPortrait ? 'min-h-[30px] min-w-[30px] px-1.5' : 'min-h-[34px] min-w-[34px] px-2'
              } rounded-lg border text-xs font-semibold flex items-center gap-1 cursor-pointer shadow-xs ${
                lockOnEnabled
                  ? 'bg-sky-50 border-sky-400 text-sky-900'
                  : 'bg-white/95 border-slate-300 text-slate-700'
              }`}
            >
              {lockOnEnabled ? <Lock className="w-3.5 h-3.5 text-sky-600" /> : <LockOpen className="w-3.5 h-3.5 text-slate-500" />}
              <span className="hidden sm:inline">{lockOnEnabled ? 'Lock' : 'Free'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                soundEngine.unlock();
                soundEngine.play('uiClick');
                cycleTarget();
              }}
              title="Switch Target"
              className={`ui-interactive ${
                isNarrowPortrait ? 'min-h-[30px] min-w-[30px] px-1.5' : 'min-h-[34px] min-w-[34px] px-2'
              } rounded-lg bg-white/95 hover:bg-slate-100 border border-slate-300 text-xs font-semibold text-slate-800 flex items-center gap-1 cursor-pointer shadow-xs`}
            >
              <Crosshair className="w-3.5 h-3.5 text-rose-600" />
              <span className="hidden sm:inline">Target</span>
            </button>

            <button
              type="button"
              onClick={() => {
                soundEngine.unlock();
                const nextMuted = soundEngine.toggleMute();
                setMuted(nextMuted);
                if (!nextMuted) soundEngine.play('uiClick');
              }}
              title="Toggle Audio"
              className={`ui-interactive ${
                isNarrowPortrait ? 'min-h-[30px] min-w-[30px]' : 'min-h-[34px] min-w-[34px]'
              } rounded-lg bg-white/95 hover:bg-slate-100 border border-slate-300 text-slate-800 flex items-center justify-center cursor-pointer shadow-xs`}
            >
              {muted ? <VolumeX className="w-3.5 h-3.5 text-slate-500" /> : <Volume2 className="w-3.5 h-3.5 text-amber-600" />}
            </button>

            <button
              type="button"
              data-testid="exit-match-btn"
              onClick={() => {
                soundEngine.unlock();
                soundEngine.play('transitionWhoosh');
                onLeave();
              }}
              title="Exit Match Back to Menu"
              className={`ui-interactive ${
                isNarrowPortrait ? 'min-h-[30px] px-2 text-[10px]' : 'min-h-[34px] px-2.5 text-[11px]'
              } rounded-lg bg-rose-600 hover:bg-rose-500 border border-rose-700 font-display font-bold text-white flex items-center gap-1 shadow-md cursor-pointer whitespace-nowrap`}
            >
              <LogOut className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-white" />
              <span className="sm:hidden">EXIT</span>
              <span className="hidden sm:inline">EXIT / LEAVE</span>
            </button>
          </div>

          {room.isTrainingMode && room.trainingConfig && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={!isHost}
                onClick={() => {
                  soundEngine.unlock();
                  soundEngine.play('uiClick');
                  onTrainingConfig?.({ dummyEnabled: !room.trainingConfig?.dummyEnabled });
                }}
                className={`ui-interactive px-2 py-1 rounded-lg border text-[10px] font-mono-num font-bold cursor-pointer shadow-xs ${
                  room.trainingConfig.dummyEnabled
                    ? 'bg-emerald-50 border-emerald-400 text-emerald-800'
                    : 'bg-white/95 border-slate-300 text-slate-600'
                }`}
              >
                Dummy: {room.trainingConfig.dummyEnabled ? 'ON' : 'OFF'}
              </button>
              <button
                type="button"
                disabled={!isHost}
                onClick={() => {
                  soundEngine.unlock();
                  soundEngine.play('uiClick');
                  onTrainingConfig?.({ zeroCooldowns: !room.trainingConfig?.zeroCooldowns });
                }}
                className={`ui-interactive px-2 py-1 rounded-lg border text-[10px] font-mono-num font-bold cursor-pointer shadow-xs ${
                  room.trainingConfig.zeroCooldowns
                    ? 'bg-amber-50 border-amber-400 text-amber-800'
                    : 'bg-white/95 border-slate-300 text-slate-600'
                }`}
              >
                Zero CD: {room.trainingConfig.zeroCooldowns ? 'ON' : 'OFF'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* TOP-EDGE RING TIMER & BATTLEFIELD EVENT BAR (Never Blocks Center Arena or Left Combo Card) */}
      {room.phase === 'combat' && (
        <div
          data-testid="ring-timer-bar"
          className={`fixed left-1/2 -translate-x-1/2 z-15 pointer-events-none flex flex-col items-center gap-1 max-w-[94vw] ${
            isNarrowPortrait ? 'top-[126px]' : isCompactScreen ? 'top-[54px]' : 'top-2.5'
          }`}
        >
          <div className="flex items-center gap-1.5 flex-wrap justify-center">
            {room.isTrainingMode ? (
              <div className="px-2.5 py-0.5 rounded-lg border bg-white/95 border-emerald-400 font-mono-num text-[10px] sm:text-xs font-bold text-emerald-800 shadow-sm whitespace-nowrap">
                TRAINING AREA · {MAP_BY_ID[room.mapId].name.toUpperCase()}
              </div>
            ) : (
              <div
                className={`px-2.5 py-0.5 rounded-lg border font-mono-num text-[10px] sm:text-xs font-bold shadow-sm ${
                  stormActive
                    ? 'bg-rose-600 border-rose-700 text-white'
                    : ringInSec <= 15
                    ? 'bg-amber-100 border-amber-400 text-amber-900'
                    : 'bg-white/95 border-slate-300 text-slate-900'
                }`}
              >
                {stormActive
                  ? `STORM · ${Math.round(stormRadius)}m`
                  : `RING ${ringCountdownLabel}`}
              </div>
            )}

            {!room.isSoloPractice && !room.isTrainingMode && !battleEvent && (
              <div className="text-[10px] sm:text-xs font-mono-num font-semibold text-slate-800 bg-white/95 border border-slate-300 px-2.5 py-0.5 rounded-lg shadow-sm">
                R{room.roundNumber} · {MAP_BY_ID[room.mapId].name} · FT{room.winsToWin}
              </div>
            )}
          </div>

          {outsideStorm && (
            <div className="px-3 py-0.5 rounded-lg bg-rose-600 border border-white text-[10px] sm:text-xs font-display font-bold uppercase tracking-wider text-white shadow-lg">
              OUTSIDE SAFE ZONE — RETURN TO RING!
            </div>
          )}

          {battleEvent && (
            <div
              className="px-2.5 py-0.5 rounded-lg bg-white/95 border text-center shadow-sm flex items-center gap-2"
              style={{ borderColor: `#${battleEvent.colorHex.toString(16).padStart(6, '0')}` }}
            >
              <span className="font-display font-bold text-[10px] tracking-wider uppercase text-slate-900">
                {battleEvent.title}
              </span>
              <span className="font-mono-num text-[10px] font-bold text-rose-600">
                {(battleEvent.telegraphRemaining > 0
                  ? battleEvent.telegraphRemaining
                  : battleEvent.remaining
                ).toFixed(1)}
                s
              </span>
            </div>
          )}
        </div>
      )}

      {/* CENTER-SCREEN REACTION HEADLOCK STRUGGLE BUTTON (Easy Tap/Click Reaction Time) */}
      {room.phase === 'combat' && headlockInvolvesMe && activeHeadlock && (() => {
        const isGrabber = activeHeadlock.grabberId === playerId;
        const myMashes = isGrabber ? activeHeadlock.grabberMashes : activeHeadlock.victimMashes;
        const foeMashes = isGrabber ? activeHeadlock.victimMashes : activeHeadlock.grabberMashes;
        const pct = Math.max(0, Math.min(100, (activeHeadlock.remaining / Math.max(0.1, activeHeadlock.duration)) * 100));
        const totalMashes = Math.max(1, myMashes + foeMashes);
        const myRatioPct = myMashes === foeMashes ? 50 : Math.round((myMashes / totalMashes) * 100);
        return (
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-35 pointer-events-auto w-[236px] sm:w-[290px] rounded-2xl bg-white/95 border-2 border-amber-500 px-3.5 py-2.5 shadow-2xl text-center animate-modal-pop">
            <div className="flex items-center justify-between text-[11px] font-display font-bold uppercase">
              <span className={isGrabber ? 'text-amber-700' : 'text-rose-700'}>
                {isGrabber ? 'HEADLOCK! KEEP CONTROL' : 'TRAPPED! BREAK FREE'}
              </span>
              <span className="font-mono-num text-slate-900">{activeHeadlock.remaining.toFixed(1)}s</span>
            </div>
            <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden my-1.5">
              <div className="h-full bg-amber-500 transition-all duration-75" style={{ width: `${pct}%` }} />
            </div>

            <button
              key={mashPulseKey}
              type="button"
              data-testid="center-grab-mash-btn"
              onPointerDown={(e) => {
                e.preventDefault();
                soundEngine.unlock();
                soundEngine.play('grabMash');
                setMashPulseKey((k) => k + 1);
                onGrab();
              }}
              onContextMenu={(e) => e.preventDefault()}
              className="touch-none-select animate-grab-mash w-full min-h-[56px] sm:min-h-[64px] my-1 rounded-xl bg-gradient-to-b from-amber-300 via-amber-400 to-orange-500 hover:from-amber-200 hover:to-orange-400 border-2 border-slate-900 shadow-lg text-slate-950 font-display font-bold text-base sm:text-lg tracking-wider flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition-transform"
            >
              <Hand className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" />
              <span>MASH GRAB! [G]</span>
            </button>

            <div className="mt-1.5 space-y-1">
              <div className="h-1.5 w-full bg-rose-200 rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-emerald-500 transition-all duration-75"
                  style={{ width: `${myRatioPct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono-num font-bold">
                <span className={myMashes >= foeMashes ? 'text-emerald-700' : 'text-rose-600'}>
                  YOU: {myMashes}
                </span>
                <span className="text-slate-400">TUG OF WAR</span>
                <span className="text-slate-700">FOE: {foeMashes}</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* CLASH QTE SHOWDOWN OVERLAY */}
      {room.phase === 'combat' && clashInvolvesMe && activeClash && (
        <div className="fixed inset-0 z-40 pointer-events-auto bg-slate-900/45 flex items-center justify-center p-3">
          <div className="w-full max-w-md rounded-2xl bg-white border-2 border-amber-500 p-4 shadow-2xl text-center">
            <div className="font-display text-xs uppercase tracking-widest text-amber-700 font-bold">
              Ultimate Intercept · Rock-Paper-Scissors Clash
            </div>
            <h3 className="font-display text-2xl sm:text-3xl font-bold text-slate-950 mt-0.5">
              CLASH SHOWDOWN!
            </h3>
            <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden my-2.5">
              <div
                className="h-full bg-amber-500 transition-all duration-75"
                style={{ width: `${Math.max(0, (activeClash.remaining / activeClash.maxTime) * 100)}%` }}
              />
            </div>

            {myClashChoice ? (
              <div className="py-3 font-display font-bold text-lg text-emerald-700">
                LOCKED IN: {myClashChoice.toUpperCase()} — RESOLVING...
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.unlock();
                    soundEngine.play('uiSelect');
                    onClashPick(activeClash.id, 'strike');
                  }}
                  className="min-h-[60px] rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-display font-bold p-2 flex flex-col items-center justify-center cursor-pointer active:scale-95 transition"
                >
                  <Swords className="w-5 h-5 mb-0.5" />
                  <span className="text-xs sm:text-sm">STRIKE (J)</span>
                  <span className="text-[9px] text-rose-100">Beats Grab</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.unlock();
                    soundEngine.play('uiSelect');
                    onClashPick(activeClash.id, 'grab');
                  }}
                  className="min-h-[60px] rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display font-bold p-2 flex flex-col items-center justify-center cursor-pointer active:scale-95 transition"
                >
                  <Hand className="w-5 h-5 mb-0.5" />
                  <span className="text-xs sm:text-sm">GRAB (G)</span>
                  <span className="text-[9px] text-slate-900">Beats Parry</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.unlock();
                    soundEngine.play('uiSelect');
                    onClashPick(activeClash.id, 'parry');
                  }}
                  className="min-h-[60px] rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-display font-bold p-2 flex flex-col items-center justify-center cursor-pointer active:scale-95 transition"
                >
                  <Shield className="w-5 h-5 mb-0.5" />
                  <span className="text-xs sm:text-sm">PARRY (F)</span>
                  <span className="text-[9px] text-sky-100">Beats Strike</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* PRE-MATCH 5-4-3-2-1 FIGHT! CUTSCENE BANNER & LINEUP REVEAL */}
      {(room.phase === 'countdown' || (room.phase === 'combat' && snapshot && snapshot.matchTime <= 0.85)) && (() => {
        const step = room.phase === 'countdown' ? computeCountdownStep(room.countdown) : 0;
        const isFightWord = room.phase === 'combat' || step === 0;
        const cdPct = room.phase === 'countdown' ? Math.max(0, Math.min(100, (room.countdown / 5.0) * 100)) : 0;
        return (
          <div
            data-testid="prematch-reveal"
            className="fixed top-14 sm:top-16 left-1/2 -translate-x-1/2 z-30 pointer-events-none flex flex-col items-center gap-1.5 max-w-[92vw]"
          >
            <div className="px-4 py-2 sm:px-6 sm:py-2.5 rounded-2xl bg-white/95 border-2 border-amber-400 shadow-2xl text-center min-w-[230px] sm:min-w-[300px]">
              <div className="text-[9px] sm:text-xs font-bold uppercase tracking-widest text-amber-700">
                {room.isTrainingMode
                  ? 'Training Area · Get Ready'
                  : room.isSoloPractice
                  ? 'Vs. Bot · Arena Introduction'
                  : `Round ${room.roundNumber} · ${MAP_BY_ID[room.mapId].name} · FT${room.winsToWin}`}
              </div>

              {isFightWord ? (
                <div
                  key="fight-word"
                  data-testid="cutscene-countdown-value"
                  className="animate-fight-slam font-display text-4xl sm:text-6xl font-bold tracking-wider text-amber-600 mt-0.5 leading-none"
                >
                  FIGHT!
                </div>
              ) : (
                <div key={`cd-${step}`} className="mt-0.5 flex flex-col items-center">
                  <div
                    data-testid="cutscene-countdown-value"
                    className="animate-countdown-slam font-display font-mono-num text-4xl sm:text-6xl font-bold tracking-tight text-slate-950 leading-none"
                  >
                    {step}
                  </div>
                  <div className="text-[10px] sm:text-xs font-display font-bold uppercase tracking-widest text-slate-500 mt-0.5">
                    {step >= 4
                      ? 'Arena Overview'
                      : step >= 2
                      ? 'Locking Fighters'
                      : 'Prepare for Clash'}
                  </div>
                </div>
              )}

              {room.phase === 'countdown' && (
                <div className="mt-2 h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 transition-all duration-75"
                    style={{ width: `${cdPct}%` }}
                  />
                </div>
              )}
            </div>

            {actors.length > 0 && room.phase === 'countdown' && (
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                {actors.map((a) => {
                  const sp = FIGHTER_BY_ID[a.fighterId];
                  return (
                    <div
                      key={a.playerId}
                      className="px-2 py-0.5 rounded-lg bg-white/95 border border-slate-200 shadow-sm flex items-center gap-1.5 text-[10px] sm:text-[11px]"
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: sp.color }}
                      />
                      <span className="font-bold text-slate-900">{a.name}</span>
                      <span
                        className="font-display font-bold"
                        style={{ color: LIGHT_TEXT_BY_FIGHTER[a.fighterId] }}
                      >
                        {sp.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* MULTIPLAYER ROUND END OVERLAY */}
      {room.phase === 'roundEnd' && (
        <div className="fixed inset-0 z-40 pointer-events-none bg-slate-900/45 flex items-center justify-center p-3">
          <div className="w-full max-w-md rounded-2xl bg-white border border-amber-400 p-4 sm:p-5 shadow-2xl text-center">
            <div className="text-[11px] font-bold uppercase tracking-widest text-amber-700">
              Round {Math.max(1, room.roundNumber - 1)} Complete
            </div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-950 mt-1">
              {roundWinnerPlayer
                ? `${roundWinnerPlayer.name} (${FIGHTER_BY_ID[roundWinnerPlayer.fighterId].name}) Scores!`
                : 'Round Draw'}
            </h2>
            <div className="mt-3 space-y-1.5 text-left">
              {[...room.players]
                .sort((a, b) => b.wins - a.wins)
                .map((p) => {
                  const sp = FIGHTER_BY_ID[p.fighterId];
                  return (
                    <div
                      key={p.playerId}
                      className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 px-3 py-1.5 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-bold text-slate-900 truncate">{p.name}</span>
                        <span
                          className="font-display font-bold"
                          style={{ color: LIGHT_TEXT_BY_FIGHTER[p.fighterId] }}
                        >
                          {sp.name}
                        </span>
                      </div>
                      <span className="font-mono-num font-bold text-amber-700 shrink-0">
                        {p.wins} / {room.winsToWin} WINS
                      </span>
                    </div>
                  );
                })}
            </div>
            <div className="mt-3 text-xs text-sky-700 font-semibold">
              Next Arena: {nextMapSpec.name} · Fighters Locked · {Math.max(1, Math.ceil(room.countdown))}s
            </div>
          </div>
        </div>
      )}

      {/* SPECTATOR NOTICE */}
      {room.phase === 'combat' && myActor?.isKO && (
        <div className="mx-auto bg-white/95 border border-rose-400 rounded-xl px-4 py-2 text-xs font-semibold text-rose-700 shadow-md pointer-events-none">
          {myActor.koCause ? `${KO_CAUSE_LABELS[myActor.koCause]} — ` : ''}Spectating remaining fighters
        </div>
      )}

      {/* VICTORY OVERLAY (Light Theme + Persistent Coins Earned Breakdown) */}
      {room.phase === 'victory' && (
        <div className="fixed inset-0 z-40 pointer-events-auto bg-slate-900/50 flex items-center justify-center p-3">
          <div className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 p-5 shadow-2xl text-center">
            <div className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-amber-100 text-amber-600 mb-2">
              <Trophy className="w-5 h-5" />
            </div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-amber-700">
              {room.isTrainingMode
                ? 'Training Complete'
                : room.isSoloPractice
                ? 'Match Complete'
                : `Series Champion · First to ${room.winsToWin} Wins`}
            </div>
            <h2 className="font-display text-2xl sm:text-4xl font-bold text-slate-950 mt-1">
              {winnerActor
                ? `${winnerActor.name} (${FIGHTER_BY_ID[winnerActor.fighterId].name}) WINS!`
                : 'DRAW'}
            </h2>

            {lastCoinReward && lastCoinReward.total > 0 && (
              <div
                data-testid="victory-coin-reward"
                className="mt-3 rounded-xl bg-amber-50 border border-amber-300 px-3 py-2 flex items-center justify-between gap-2 text-xs"
              >
                <div className="flex items-center gap-2 font-display font-bold text-amber-900">
                  <Coins className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>+{lastCoinReward.total} COINS EARNED</span>
                </div>
                <div className="font-mono-num text-[10px] text-amber-800 flex items-center gap-2 flex-wrap justify-end">
                  <span>Match +{lastCoinReward.base}</span>
                  {lastCoinReward.winBonus > 0 && <span>Win +{lastCoinReward.winBonus}</span>}
                  {lastCoinReward.koBonus > 0 && <span>KO +{lastCoinReward.koBonus}</span>}
                  {lastCoinReward.damageBonus > 0 && <span>DMG +{lastCoinReward.damageBonus}</span>}
                  {account && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-200 font-bold text-amber-950">
                      Total: {account.coins}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="mt-3 space-y-1.5 text-left max-h-[38dvh] overflow-y-auto">
              {[...actors]
                .sort((a, b) => b.wins - a.wins || Number(a.isKO) - Number(b.isKO) || b.damageDealt - a.damageDealt)
                .map((a) => {
                  const sp = FIGHTER_BY_ID[a.fighterId];
                  return (
                    <div
                      key={a.playerId}
                      className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 truncate">{a.name}</span>
                          <span
                            className="font-display font-bold"
                            style={{ color: LIGHT_TEXT_BY_FIGHTER[a.fighterId] }}
                          >
                            {sp.name}
                          </span>
                        </div>
                        {a.isKO && a.koCause && (
                          <div className="text-[10px] text-rose-600 font-medium mt-0.5">
                            Defeated via {KO_CAUSE_LABELS[a.koCause]}
                          </div>
                        )}
                      </div>
                      <div className="font-mono-num text-slate-700 flex items-center gap-2.5 shrink-0">
                        {!room.isSoloPractice && !room.isTrainingMode && (
                          <span className="text-amber-700 font-bold">
                            {a.wins}/{room.winsToWin}W
                          </span>
                        )}
                        <span>{a.kills} KO</span>
                        <span>{a.parryCount} PRY</span>
                        <span>{a.damageDealt} DMG</span>
                      </div>
                    </div>
                  );
                })}
            </div>

            <div className="mt-4 flex items-center gap-2.5">
              {isHost && (
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.unlock();
                    soundEngine.play('transitionWhoosh');
                    onRematch();
                  }}
                  className="flex-1 min-h-[44px] rounded-xl bg-amber-400 hover:bg-amber-300 border border-amber-500 text-slate-950 font-display font-bold text-sm sm:text-base flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>REMATCH</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  soundEngine.unlock();
                  soundEngine.play('transitionWhoosh');
                  onLeave();
                }}
                className="min-h-[44px] px-4 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-900 font-semibold text-xs sm:text-sm cursor-pointer"
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MLBB-STYLE SEPARATED COMBAT CONTROLS: BOTTOM-LEFT JOYSTICK | BOTTOM-CENTER UTILITY ROW | BOTTOM-RIGHT CURVED ARC */}
      {room.phase === 'combat' && myActor && !myActor.isKO && (
        <div className="w-full relative flex items-end justify-between pb-1 sm:pb-2 pointer-events-none">
          {/* BOTTOM-LEFT: Virtual Movement Joystick */}
          <div className="pointer-events-auto pl-0.5 sm:pl-3">
            <div
              data-testid="movement-joystick"
              onPointerDown={handleJoyDown}
              onPointerMove={handleJoyMove}
              onPointerUp={handleJoyUp}
              onPointerCancel={handleJoyUp}
              onLostPointerCapture={handleJoyUp}
              onContextMenu={(e) => e.preventDefault()}
              className={`touch-none-select relative rounded-full bg-white/85 border-2 border-slate-400 flex items-center justify-center shadow-lg ${
                isNarrowPortrait ? 'w-[66px] h-[66px]' : isCompactScreen ? 'w-[86px] h-[86px]' : 'w-32 h-32 sm:w-36 sm:h-36'
              }`}
            >
              <div
                className={`rounded-full border border-slate-300 pointer-events-none ${
                  isNarrowPortrait ? 'w-5 h-5' : isCompactScreen ? 'w-8 h-8' : 'w-12 h-12'
                }`}
              />
              <div
                className={`absolute rounded-full bg-amber-400 border-2 border-slate-900 shadow-md pointer-events-none transition-transform duration-75 ${
                  isNarrowPortrait ? 'w-7 h-7' : isCompactScreen ? 'w-9 h-9' : 'w-14 h-14'
                }`}
                style={{
                  transform: `translate(${knobOffset.x}px, ${knobOffset.y}px)`,
                }}
              />
            </div>
          </div>

          {/* BOTTOM-CENTER: Dedicated Circular Tactical Utility Row (Dash Q, Guard F, Grab G, Jump SPC, Fly R) */}
          <div
            data-testid="utility-bar"
            className={`pointer-events-auto fixed bottom-1.5 sm:bottom-3 z-20 flex items-center ${
              isNarrowPortrait
                ? 'left-[45%] -translate-x-1/2 gap-1'
                : 'left-1/2 -translate-x-1/2 gap-1.5 sm:gap-2.5'
            }`}
          >
            {/* Dash [Q] */}
            <button
              type="button"
              data-testid="dash-btn"
              onPointerDown={(e) => {
                e.preventDefault();
                soundEngine.unlock();
                cancelActiveAim();
                onDash();
              }}
              onContextMenu={(e) => e.preventDefault()}
              className={`ui-interactive touch-none-select relative rounded-full border-2 flex flex-col items-center justify-center cursor-pointer shadow-lg ${
                isNarrowPortrait ? 'w-8 h-8' : isCompactScreen ? 'w-11 h-11' : 'w-14 h-14'
              } ${
                (myActor.dashCooldown ?? 0) <= 0.05 && myActor.stamina >= 14
                  ? 'bg-sky-500 border-sky-700 text-white'
                  : 'bg-slate-100/95 border-slate-300 text-slate-400 opacity-90'
              }`}
            >
              <span
                data-testid="keybind-Q"
                className="absolute -top-1 -left-1 px-1 py-0.2 rounded-md bg-slate-900 text-white border border-white font-mono-num text-[7px] sm:text-[8px] font-bold leading-tight shadow-xs"
              >
                Q
              </span>
              <Wind className={isNarrowPortrait ? 'w-3 h-3' : 'w-3.5 h-3.5 sm:w-4 sm:h-4'} />
              <span className="text-[7px] sm:text-[8px] font-bold leading-none mt-0.5">DASH</span>
              {(myActor.dashCooldown ?? 0) > 0.05 && (
                <span className="absolute inset-0 rounded-full bg-white/85 flex items-center justify-center font-mono-num text-[10px] font-bold text-sky-700">
                  {myActor.dashCooldown.toFixed(1)}
                </span>
              )}
            </button>

            {/* Guard / Parry [F] */}
            <button
              type="button"
              data-testid="guard-btn"
              onPointerDown={(e) => {
                e.preventDefault();
                if (blockPointerId.current !== null) return;
                soundEngine.unlock();
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  // ignore synthetic pointer
                }
                blockPointerId.current = e.pointerId;
                onBlockHoldChange(true);
                onCastAbility(1);
              }}
              onPointerUp={(e) => {
                if (blockPointerId.current === e.pointerId) {
                  blockPointerId.current = null;
                  onBlockHoldChange(false);
                }
              }}
              onPointerCancel={(e) => {
                if (blockPointerId.current === e.pointerId) {
                  blockPointerId.current = null;
                  onBlockHoldChange(false);
                }
              }}
              onLostPointerCapture={(e) => {
                if (blockPointerId.current === e.pointerId) {
                  blockPointerId.current = null;
                  onBlockHoldChange(false);
                }
              }}
              onContextMenu={(e) => e.preventDefault()}
              className={`ui-interactive touch-none-select relative rounded-full border-2 flex flex-col items-center justify-center cursor-pointer shadow-lg ${
                isNarrowPortrait ? 'w-8 h-8' : isCompactScreen ? 'w-11 h-11' : 'w-14 h-14'
              } ${
                myActor.parryWindow
                  ? 'bg-amber-400 border-amber-700 text-slate-950 shadow-xl'
                  : myActor.shieldActive
                  ? 'bg-sky-500 border-sky-700 text-white shadow-lg'
                  : 'bg-white/95 border-sky-500 text-sky-900'
              }`}
            >
              <span
                data-testid="keybind-F"
                className="absolute -top-1 -left-1 px-1 py-0.2 rounded-md bg-slate-900 text-white border border-white font-mono-num text-[7px] sm:text-[8px] font-bold leading-tight shadow-xs"
              >
                F
              </span>
              <Shield className={isNarrowPortrait ? 'w-3 h-3' : 'w-3.5 h-3.5 sm:w-4 sm:h-4'} />
              <span className="text-[7px] sm:text-[8px] font-bold leading-none mt-0.5">
                {myActor.parryWindow ? 'PRY' : 'GRD'}
              </span>
            </button>

            {/* Grab / Headlock Mash [G] */}
            <button
              type="button"
              data-testid="grab-btn"
              onPointerDown={(e) => {
                e.preventDefault();
                soundEngine.unlock();
                onGrab();
              }}
              onContextMenu={(e) => e.preventDefault()}
              className={`ui-interactive touch-none-select relative rounded-full border-2 flex flex-col items-center justify-center cursor-pointer shadow-lg ${
                isNarrowPortrait ? 'w-8 h-8' : isCompactScreen ? 'w-11 h-11' : 'w-14 h-14'
              } ${
                headlockInvolvesMe
                  ? 'bg-amber-400 border-slate-900 text-slate-950 shadow-xl'
                  : myActor.grabCooldown <= 0.05 && myActor.stamina >= 18
                  ? 'bg-orange-500 border-orange-700 text-white'
                  : 'bg-slate-100/95 border-slate-300 text-slate-400 opacity-90'
              }`}
            >
              <span
                data-testid="keybind-G"
                className="absolute -top-1 -left-1 px-1 py-0.2 rounded-md bg-slate-900 text-white border border-white font-mono-num text-[7px] sm:text-[8px] font-bold leading-tight shadow-xs"
              >
                G
              </span>
              <Hand className={isNarrowPortrait ? 'w-3 h-3' : 'w-3.5 h-3.5 sm:w-4 sm:h-4'} />
              <span className="text-[7px] sm:text-[8px] font-bold leading-none mt-0.5">
                {headlockInvolvesMe ? 'MASH' : 'GRAB'}
              </span>
              {!headlockInvolvesMe && myActor.grabCooldown > 0.05 && (
                <span className="absolute inset-0 rounded-full bg-white/85 flex items-center justify-center font-mono-num text-[10px] font-bold text-orange-700">
                  {myActor.grabCooldown.toFixed(1)}
                </span>
              )}
            </button>

            {/* Jump [SPC] */}
            <button
              type="button"
              data-testid="jump-btn"
              onPointerDown={(e) => {
                e.preventDefault();
                soundEngine.unlock();
                jumpPointerId.current = e.pointerId;
                onJump();
              }}
              onPointerUp={(e) => {
                if (jumpPointerId.current === e.pointerId) {
                  jumpPointerId.current = null;
                }
              }}
              onPointerCancel={(e) => {
                if (jumpPointerId.current === e.pointerId) {
                  jumpPointerId.current = null;
                }
              }}
              onContextMenu={(e) => e.preventDefault()}
              className={`ui-interactive touch-none-select relative rounded-full border-2 flex flex-col items-center justify-center shadow-lg cursor-pointer bg-emerald-500 hover:bg-emerald-400 border-emerald-700 text-white ${
                isNarrowPortrait ? 'w-8 h-8' : isCompactScreen ? 'w-11 h-11' : 'w-14 h-14'
              }`}
            >
              <span className="hidden sm:inline-block absolute -top-1 -left-1 px-1 py-0.2 rounded-md bg-slate-900 text-white border border-white font-mono-num text-[7px] font-bold leading-tight shadow-xs">
                SPC
              </span>
              <ArrowUp className={isNarrowPortrait ? 'w-3.5 h-3.5' : 'w-4 h-4 sm:w-5 sm:h-5'} />
              <span className="text-[7px] sm:text-[8px] font-bold leading-none mt-0.5">JMP</span>
            </button>

            {/* Dedicated JM Sky Flight Toggle [E] */}
            {myActor.fighterId === 'jm' && (
              <button
                type="button"
                data-testid="fly-btn"
                onPointerDown={(e) => {
                  e.preventDefault();
                  soundEngine.unlock();
                  onToggleFlight();
                }}
                onContextMenu={(e) => e.preventDefault()}
                className={`ui-interactive touch-none-select relative rounded-full border-2 flex flex-col items-center justify-center shadow-lg cursor-pointer ${
                  isNarrowPortrait ? 'w-8 h-8' : isCompactScreen ? 'w-11 h-11' : 'w-14 h-14'
                } ${
                  myActor.isFlying
                    ? 'bg-yellow-300 border-amber-700 text-slate-950 ring-2 ring-amber-300'
                    : (myActor.flightCooldown ?? 0) <= 0.05
                    ? 'bg-amber-400 hover:bg-amber-300 border-amber-600 text-slate-950'
                    : 'bg-slate-100/95 border-slate-300 text-slate-400 opacity-90'
                }`}
              >
                <span
                  data-testid="keybind-E"
                  className="absolute -top-1 -left-1 px-1 py-0.2 rounded-md bg-slate-900 text-white border border-white font-mono-num text-[7px] sm:text-[8px] font-bold leading-tight shadow-xs"
                >
                  E
                </span>
                <Feather className={isNarrowPortrait ? 'w-3 h-3' : 'w-3.5 h-3.5 sm:w-4 sm:h-4'} />
                <span className="text-[7px] sm:text-[8px] font-bold leading-none mt-0.5">
                  {myActor.isFlying ? `${(myActor.flightRemaining ?? 0).toFixed(1)}s` : 'FLY'}
                </span>
                {!myActor.isFlying && (myActor.flightCooldown ?? 0) > 0.05 && (
                  <span className="absolute inset-0 rounded-full bg-white/85 flex items-center justify-center font-mono-num text-[10px] font-bold text-amber-800">
                    {(myActor.flightCooldown ?? 0).toFixed(1)}
                  </span>
                )}
              </button>
            )}
          </div>

          {/* BOTTOM-RIGHT: Large Primary M1 Anchor + Curved MOBA Skill Arc (1 / 2 / 3 + Secret O) */}
          <div
            data-testid="moba-skill-arc"
            className={`pointer-events-auto relative shrink-0 mr-0.5 sm:mr-3 ${
              isNarrowPortrait
                ? 'w-[122px] h-[120px]'
                : isCompactScreen
                ? 'w-[160px] h-[150px]'
                : 'w-[224px] h-[206px]'
            }`}
          >
            {/* Floating Hold-Drag Aim Wheel */}
            {aimOverlay && (
              <div
                className="fixed z-40 pointer-events-none"
                style={{ left: aimOverlay.cx - 56, top: aimOverlay.cy - 56, width: 112, height: 112 }}
              >
                <div
                  className={`w-full h-full rounded-full border-2 flex items-center justify-center ${
                    aimOverlay.cancelled
                      ? 'bg-rose-100/80 border-rose-500'
                      : 'bg-white/80 border-sky-500'
                  }`}
                >
                  <div
                    className={`w-6 h-6 rounded-full border text-[7px] font-bold flex items-center justify-center ${
                      aimOverlay.cancelled
                        ? 'border-rose-500 text-rose-700 bg-rose-200/80'
                        : 'border-slate-400 text-slate-600'
                    }`}
                  >
                    ✕
                  </div>
                  <div
                    ref={aimKnobRef}
                    className={`absolute w-8 h-8 rounded-full border-2 border-white shadow-lg ${
                      aimOverlay.cancelled ? 'bg-rose-500' : 'bg-sky-500'
                    }`}
                  />
                </div>
                <div
                  className={`text-center text-[9px] font-display font-bold mt-1 px-1.5 py-0.5 rounded bg-white border shadow-sm whitespace-nowrap ${
                    aimOverlay.cancelled
                      ? 'text-rose-700 border-rose-400'
                      : 'text-sky-700 border-sky-400'
                  }`}
                >
                  {aimOverlay.cancelled ? 'RELEASE TO CANCEL' : `AIM: ${aimOverlay.label.toUpperCase()}`}
                </div>
              </div>
            )}

            {/* Secret Jtinsullen JM Ability: Solar Meteor (above Ult) */}
            {showSecretSolar && (() => {
              const ab = JM_SECRET_ABILITY;
              const cd = myActor.cooldowns[5] ?? 0;
              const notEnoughMana = myActor.mana < ab.manaCost;
              const notEnoughStamina = myActor.stamina < ab.staminaCost;
              const ready = cd <= 0.05 && !notEnoughMana && !notEnoughStamina;
              return (
                <button
                  type="button"
                  onPointerDown={(e) => handleAbilityPointerDown(5, e)}
                  onPointerMove={handleAbilityPointerMove}
                  onPointerUp={(e) => handleAbilityPointerUp(e, false)}
                  onPointerCancel={(e) => handleAbilityPointerUp(e, true)}
                  onLostPointerCapture={(e) => handleAbilityPointerUp(e, true)}
                  onContextMenu={(e) => e.preventDefault()}
                  className={`ui-interactive touch-none-select absolute right-0 -top-9 rounded-full border-2 flex items-center gap-1 px-2.5 py-1 cursor-pointer shadow-lg ${
                    ready
                      ? 'bg-gradient-to-r from-yellow-300 via-amber-400 to-orange-400 border-slate-900 text-slate-950'
                      : 'bg-white/90 border-slate-300 text-slate-400 opacity-85'
                  }`}
                >
                  <span className="px-1 rounded bg-slate-900 text-white font-mono-num text-[8px] font-bold">
                    O
                  </span>
                  <Flame className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-[9px] font-display font-bold uppercase whitespace-nowrap">
                    {cd > 0.05 ? `${cd.toFixed(1)}s` : 'METEOR'}
                  </span>
                </button>
              );
            })()}

            {/* Curved Arc Skills: Slot 2 (Key 1), Slot 3 (Key 2), Slot 4 Ultimate (Key 3), + Awakened Skill 4 (Slot 6, Key R/4) */}
            {([2, 3, 4] as const).map((slot) => {
              const ab = getAbilitySpec(myActor.fighterId, slot, myActor.awakened);
              const keyBadge = slot === 2 ? '1' : slot === 3 ? '2' : '3';
              const cd = myActor.cooldowns[slot] ?? 0;
              const cdPct = Math.min(100, Math.max(0, (cd / Math.max(0.5, ab.cooldown)) * 100));
              const isStage2 = slot === 3 && myActor.stage2Slot === 3 && (myActor.stage2Timer ?? 0) > 0;
              const isSilenced = (myActor.silencedTimer ?? 0) > 0.05;
              const effectiveManaCost = isStage2
                ? 0
                : slot === 3 && myActor.counterFlowActive
                ? Math.floor(ab.manaCost * 0.5)
                : ab.manaCost;
              const effectiveStamCost = myActor.awakened ? 0 : isStage2 ? 10 : ab.staminaCost;
              const notEnoughMana = myActor.mana < effectiveManaCost;
              const notEnoughStamina = myActor.stamina < effectiveStamCost;
              const ready = cd <= 0.05 && !notEnoughMana && !notEnoughStamina && !isSilenced;
              const icon =
                slot === 2 ? (
                  <Zap className={isNarrowPortrait ? 'w-3.5 h-3.5' : 'w-4 h-4 sm:w-5 sm:h-5'} />
                ) : slot === 3 ? (
                  <Sparkles className={isNarrowPortrait ? 'w-3.5 h-3.5' : 'w-4 h-4 sm:w-5 sm:h-5'} />
                ) : (
                  <Trophy className={isNarrowPortrait ? 'w-4 h-4' : 'w-4 h-4 sm:w-5 sm:h-5'} />
                );
              const isJmCounterSkill =
                myActor.fighterId === 'jm' && myActor.counterFlowActive && (slot === 3 || slot === 4);
              const shortWord = isStage2
                ? myActor.stage2Label || 'STAGE 2'
                : ab.name.split(' ')[0];

              // Curved arc offsets around bottom-right M1 circle
              const posStyle: React.CSSProperties = isNarrowPortrait
                ? slot === 2
                  ? { right: 68, bottom: 4 }
                  : slot === 3
                  ? { right: 54, bottom: 56 }
                  : { right: 4, bottom: 72 }
                : isCompactScreen
                ? slot === 2
                  ? { right: 86, bottom: 6 }
                  : slot === 3
                  ? { right: 70, bottom: 68 }
                  : { right: 4, bottom: 86 }
                : slot === 2
                ? { right: 118, bottom: 10 }
                : slot === 3
                ? { right: 94, bottom: 88 }
                : { right: 10, bottom: 114 };

              return (
                <button
                  key={slot}
                  type="button"
                  data-testid={`skill-btn-${slot}`}
                  style={posStyle}
                  onPointerDown={(e) => handleAbilityPointerDown(slot, e)}
                  onPointerMove={handleAbilityPointerMove}
                  onPointerUp={(e) => handleAbilityPointerUp(e, false)}
                  onPointerCancel={(e) => handleAbilityPointerUp(e, true)}
                  onLostPointerCapture={(e) => handleAbilityPointerUp(e, true)}
                  onContextMenu={(e) => e.preventDefault()}
                  className={`ui-interactive touch-none-select absolute rounded-full border-2 flex flex-col items-center justify-center cursor-pointer shadow-lg ${
                    isNarrowPortrait
                      ? 'w-[42px] h-[42px]'
                      : isCompactScreen
                      ? 'w-[52px] h-[52px]'
                      : 'w-[68px] h-[68px]'
                  } ${
                    isStage2 && ready
                      ? 'bg-emerald-500 border-emerald-700 text-white ring-2 ring-emerald-200'
                      : ready
                      ? slot === 4
                        ? `bg-amber-400 border-amber-600 text-slate-950 ${
                            isJmCounterSkill ? 'animate-counter-flow-glow' : 'animate-ready-glow'
                          }`
                        : myActor.awakened
                        ? 'bg-gradient-to-b from-amber-50 to-sky-100 border-amber-400 text-slate-950'
                        : isJmCounterSkill
                        ? 'bg-amber-50 border-amber-500 text-amber-950 animate-counter-flow-glow'
                        : 'bg-white/95 border-amber-500 text-slate-900'
                      : 'bg-slate-100/95 border-slate-300 text-slate-400 opacity-85 brightness-90'
                  }`}
                >
                  <span
                    data-testid={`keybind-${keyBadge}`}
                    className="absolute -top-1 -left-1 px-1.5 py-0.2 rounded-md bg-slate-900 text-white border border-white font-mono-num text-[8px] font-bold leading-tight shadow-xs"
                  >
                    {keyBadge}
                  </span>
                  {icon}
                  <span className="text-[7px] sm:text-[9px] font-display font-bold leading-none mt-0.5 max-w-[58px] truncate">
                    {shortWord}
                  </span>
                  {cd > 0.05 && (
                    <span
                      className="absolute inset-0 rounded-full overflow-hidden flex items-center justify-center"
                      style={{
                        background: `conic-gradient(rgba(15,23,42,0.72) ${cdPct * 3.6}deg, rgba(255,255,255,0.82) ${cdPct * 3.6}deg)`,
                      }}
                    >
                      <span className="relative font-mono-num text-[11px] sm:text-sm font-bold text-amber-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                        {cd.toFixed(1)}
                      </span>
                    </span>
                  )}
                </button>
              );
            })}

            {/* Awakened Skill 4 (Slot 6, Key R / 4) Sliding Out onto Outer Arc Edge */}
            {myActor.awakened && (() => {
              const ab4 = getAbilitySpec(myActor.fighterId, 6, true);
              const cd = myActor.cooldowns[6] ?? 0;
              const cdPct = Math.min(100, Math.max(0, (cd / Math.max(0.5, ab4.cooldown)) * 100));
              const isSilenced = (myActor.silencedTimer ?? 0) > 0.05;
              const notEnoughMana = myActor.mana < ab4.manaCost;
              const ready = cd <= 0.05 && !notEnoughMana && !isSilenced;
              const posStyle4: React.CSSProperties = isNarrowPortrait
                ? { right: 98, bottom: 58 }
                : isCompactScreen
                ? { right: 132, bottom: 68 }
                : { right: 174, bottom: 86 };

              return (
                <button
                  key="skill-6-awakened"
                  type="button"
                  data-testid="skill-btn-6"
                  style={posStyle4}
                  onPointerDown={(e) => handleAbilityPointerDown(6, e)}
                  onPointerMove={handleAbilityPointerMove}
                  onPointerUp={(e) => handleAbilityPointerUp(e, false)}
                  onPointerCancel={(e) => handleAbilityPointerUp(e, true)}
                  onLostPointerCapture={(e) => handleAbilityPointerUp(e, true)}
                  onContextMenu={(e) => e.preventDefault()}
                  className={`animate-skill4-enter ui-interactive touch-none-select absolute rounded-full border-2 flex flex-col items-center justify-center cursor-pointer shadow-xl ${
                    isNarrowPortrait
                      ? 'w-[44px] h-[44px]'
                      : isCompactScreen
                      ? 'w-[54px] h-[54px]'
                      : 'w-[70px] h-[70px]'
                  } ${
                    ready
                      ? 'bg-gradient-to-br from-amber-300 via-yellow-400 to-cyan-300 border-white text-slate-950 animate-ready-glow'
                      : 'bg-slate-200/95 border-slate-400 text-slate-500 opacity-85 brightness-90'
                  }`}
                >
                  <span
                    data-testid="keybind-R"
                    className="absolute -top-1 -left-1 px-1.5 py-0.2 rounded-md bg-slate-950 text-amber-300 border border-amber-300 font-mono-num text-[8px] font-bold leading-tight shadow-xs"
                  >
                    R
                  </span>
                  <Flame className={isNarrowPortrait ? 'w-4 h-4' : 'w-5 h-5'} />
                  <span className="text-[7px] sm:text-[9px] font-display font-bold leading-none mt-0.5 max-w-[60px] truncate uppercase">
                    {ab4.name.split(' ')[0]}
                  </span>
                  {cd > 0.05 && (
                    <span
                      className="absolute inset-0 rounded-full overflow-hidden flex items-center justify-center"
                      style={{
                        background: `conic-gradient(rgba(15,23,42,0.78) ${cdPct * 3.6}deg, rgba(255,255,255,0.8) ${cdPct * 3.6}deg)`,
                      }}
                    >
                      <span className="relative font-mono-num text-[11px] sm:text-sm font-bold text-amber-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                        {cd.toFixed(1)}
                      </span>
                    </span>
                  )}
                </button>
              );
            })()}

            {/* Corner-Anchored Large Circular Primary M1 Attack Button */}
            <button
              type="button"
              data-testid="m1-attack-btn"
              onPointerDown={(e) => {
                e.preventDefault();
                soundEngine.unlock();
                attackPointerId.current = e.pointerId;
                const isRangedM1 =
                  myActor.fighterId === 'damen' ||
                  myActor.fighterId === 'marjohn' ||
                  (myActor.fighterId === 'jm' && myActor.isFlying);
                if (!isRangedM1) {
                  triggerM1(e.shiftKey);
                  return;
                }
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  // ignore synthetic pointer
                }
                const rect = e.currentTarget.getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;
                const maxRange =
                  myActor.fighterId === 'jm' ? 16.0 : myActor.fighterId === 'damen' ? 10.2 : 8.5;
                m1SwipeRef.current = {
                  pointerId: e.pointerId,
                  cx,
                  cy,
                  downAt: performance.now(),
                  aimMode: false,
                  maxDragDist: 0,
                  cancelled: false,
                  aimX: myActor.x + Math.sin(myActor.rotY) * maxRange,
                  aimZ: myActor.z + Math.cos(myActor.rotY) * maxRange,
                  shiftHeld: e.shiftKey,
                };
              }}
              onPointerMove={(e) => {
                const g = m1SwipeRef.current;
                if (!g || g.pointerId !== e.pointerId) return;
                const dx = e.clientX - g.cx;
                const dy = e.clientY - g.cy;
                const dist = Math.hypot(dx, dy);
                const elapsed = performance.now() - g.downAt;
                g.maxDragDist = Math.max(g.maxDragDist, dist);
                const maxR = 48;
                if (!g.aimMode && shouldEnterDragAim(dist, elapsed)) {
                  g.aimMode = true;
                  setAimOverlay({
                    slot: 0,
                    label: m1ActiveName,
                    cancelled: false,
                    cx: g.cx,
                    cy: g.cy,
                  });
                }
                if (!g.aimMode) return;
                const clamped = Math.min(dist, maxR);
                const kx = dist > 0.1 ? (dx / dist) * clamped : 0;
                const ky = dist > 0.1 ? (dy / dist) * clamped : 0;
                if (aimKnobRef.current) {
                  aimKnobRef.current.style.transform = `translate(${kx}px, ${ky}px)`;
                }
                const nowCancelled = g.maxDragDist >= 28 && dist < 10;
                if (nowCancelled !== g.cancelled) {
                  g.cancelled = nowCancelled;
                  setAimOverlay((prev) => (prev ? { ...prev, cancelled: nowCancelled } : prev));
                }
                const maxRange =
                  myActor.fighterId === 'jm' ? 16.0 : myActor.fighterId === 'damen' ? 10.2 : 8.5;
                const aimPt = computeSwipeAimPoint(myActor.x, myActor.z, dx / maxR, dy / maxR, maxRange);
                g.aimX = aimPt.x;
                g.aimZ = aimPt.z;
                if (aimPreviewRef) {
                  aimPreviewRef.current = {
                    active: true,
                    cancelled: g.cancelled,
                    aimKind: 'line',
                    originX: myActor.x,
                    originY: myActor.y,
                    originZ: myActor.z,
                    aimX: g.aimX,
                    aimZ: g.aimZ,
                    radius: 1.2,
                    range: maxRange,
                    colorHex: mySpec.hex,
                  };
                }
              }}
              onPointerUp={(e) => {
                attackPointerId.current = null;
                const g = m1SwipeRef.current;
                if (!g || g.pointerId !== e.pointerId) return;
                m1SwipeRef.current = null;
                setAimOverlay(null);
                if (aimPreviewRef) aimPreviewRef.current.active = false;
                if (!g.cancelled) {
                  if (g.aimMode) {
                    onCastAbility(0, g.shiftHeld, { aimX: g.aimX, aimZ: g.aimZ });
                  } else {
                    triggerM1(g.shiftHeld);
                  }
                }
              }}
              onPointerCancel={(e) => {
                attackPointerId.current = null;
                if (m1SwipeRef.current?.pointerId === e.pointerId) {
                  m1SwipeRef.current = null;
                  setAimOverlay(null);
                  if (aimPreviewRef) aimPreviewRef.current.active = false;
                }
              }}
              onContextMenu={(e) => e.preventDefault()}
              className={`ui-interactive touch-none-select absolute right-0 bottom-0 rounded-full border-2 border-slate-900 flex flex-col items-center justify-center shadow-xl cursor-pointer ${
                isNarrowPortrait ? 'w-[54px] h-[54px]' : isCompactScreen ? 'w-[68px] h-[68px]' : 'w-[92px] h-[92px]'
              }`}
              style={{ backgroundColor: mySpec.color, color: '#090d16' }}
            >
              <span
                data-testid="keybind-M1"
                className="absolute -top-1 left-0 px-1.5 py-0.2 rounded-md bg-slate-900 text-white border border-white font-mono-num text-[8px] sm:text-[9px] font-bold leading-tight shadow-xs"
              >
                M1
              </span>
              <Swords className={isNarrowPortrait || isCompactScreen ? 'w-4 h-4 sm:w-5 sm:h-5' : 'w-6 h-6 sm:w-7 sm:h-7'} />
              <span className="font-display font-bold text-[8px] sm:text-[11px] uppercase mt-0.5 leading-none max-w-[46px] sm:max-w-none truncate">
                {m1ActiveName}
              </span>
              <span className="font-mono-num text-[6px] sm:text-[8px] font-bold mt-0.5 opacity-90 max-w-[46px] sm:max-w-none truncate">
                {isNarrowPortrait ? (m1SubLabel.includes('SWIPE') ? 'SWIPE' : m1SubLabel) : m1SubLabel}
              </span>
              {myActor.cooldowns[0] > 0.05 && (
                <span className="absolute inset-0 rounded-full bg-white/80 flex items-center justify-center font-mono-num text-xs sm:text-sm font-bold text-slate-950">
                  {myActor.cooldowns[0].toFixed(1)}
                </span>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
