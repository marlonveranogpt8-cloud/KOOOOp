import { AWAKENING_CONFIG, getAwakenedAbility } from '../shared/awakeningConfig.ts';
import type {
  AbilitySlot,
  ArenaActorState,
  ArenaPickup,
  ArenaZoneKind,
  ArenaZoneState,
  AwakeningBannerState,
  AwakeningCutsceneState,
  AwakeningDebugAction,
  AwakeningOrbState,
  ClashState,
  CombatEvent,
  FighterId,
  HeadlockState,
  KoCause,
  MapId,
  MatchAwakeningPhase,
  ObstacleState,
  ProjectileState,
  RoomState,
  TelegraphKind,
  TelegraphState,
} from '../shared/gameData.ts';
import {
  FIGHTER_BY_ID,
  MAP_BY_ID,
  findObstacleAtPoint,
  getDamagePhase,
  getMapTerrainHeight,
  getObstacleSupportY,
  resolveObstacleCollisions,
} from '../shared/gameData.ts';
import {
  ClashTugState,
  applyAwakeningSurge,
  createClashTugState,
  findFarthestValidOrbPair,
  registerClashMash,
  shouldSpawnAwakeningOrbs,
  stepClashTugOfWar,
} from '../game/awakeningLogic.ts';

export interface AwakeningActor extends ArenaActorState {
  moveX: number;
  moveZ: number;
  aimYaw: number;
  aimPitch: number;
  isFlying: boolean;
  flightRemaining: number;
  flightMax: number;
  flightCooldown: number;
  speedBoostTimer: number;
  superArmor: boolean;
  dashCooldown: number;
  dashMaxCooldown: number;
  targetId: string | null;
  windupTriggered: boolean;
  landedCurrentAction: boolean;
  pendingHoldHeavy: boolean;
  pendingComboLink: boolean;
  lastM1At: number;
  lastHitAt: number;
  lastDamagedAt: number;
  lastAbilitySlot: AbilitySlot | null;
  lastAbilityAt: number;
  iframeTimer: number;
  parryStartedAt: number;
  prevBlockHeld: boolean;
  clashCooldown: number;
  frenzyInside: boolean;
  overdriveAnnounced: boolean;
  lastOriginX: number;
  lastOriginY: number;
  lastOriginZ: number;
  lastCastSlot: AbilitySlot | null;
  pendingAimX: number | null;
  pendingAimZ: number | null;
  pendingHoldVariant: boolean;
  stage2Slot: AbilitySlot | null;
  stage2Timer: number;
  stage2Label: string;
  stage2PendingCooldown: number;
  rushFatigue: number;
  rushFatigueDecayTimer: number;
  empoweredM1Ready: boolean;
  perfectEvadeTimer: number;
  evadeRewardedThisDash: boolean;
  dashEruptedThisDash: boolean;
  dashRechargeTimer: number;
  activeTelegraphId: string | null;
  awakened: boolean;
  awakeningTransformTimer: number;
  silencedTimer: number;
  snareMarkedTimer: number;
}

export interface AwakeningRoomState {
  roomCode: string;
  phase: RoomState['phase'];
  mapId: MapId;
  isSoloPractice: boolean;
  isTrainingMode: boolean;
  matchTime: number;
  actors: AwakeningActor[];
  initialActorCount: number;
  obstacles: ObstacleState[];
  zones: Array<ArenaZoneState & { tickTimer: number; hitCooldowns: Record<string, number> }>;
  projectiles: Array<
    ProjectileState & {
      age: number;
      maxAge: number;
      maxRange?: number;
      damage: number;
      staggerDamage: number;
      knockback: number;
      hitIds: Set<string>;
      pierceObstacles?: boolean;
      isVortex?: boolean;
    }
  >;
  telegraphs: Array<TelegraphState & { elapsed: number; windup: number }>;
  activeClash: ClashState | null;
  activeHeadlock: HeadlockState | null;
  pickups: ArenaPickup[];
  stormActive: boolean;
  stormRadius: number;
  awakeningPhase: MatchAwakeningPhase;
  awakeningOrbs: AwakeningOrbState[];
  awakeningBanner: AwakeningBannerState | null;
  awakeningCutscene: (AwakeningCutsceneState & {
    tug: ClashTugState;
    botMashTimer: number;
    hasSyncedAudio: boolean;
    lastAudioSyncAt: number;
  }) | null;
  awakeningDelayedHits: Array<{
    remaining: number;
    run: () => void;
  }>;
}

export interface AwakeningHostHelpers {
  makeId: (prefix: string) => string;
  pushEvent: (room: AwakeningRoomState, ev: Omit<CombatEvent, 'id' | 't'>) => void;
  spawnZone: (
    room: AwakeningRoomState,
    owner: AwakeningActor,
    kind: ArenaZoneKind,
    x: number,
    y: number,
    z: number,
    radius: number,
    duration: number,
    colorHex: number,
    endX?: number,
    endZ?: number
  ) => ArenaZoneState;
  spawnTelegraph: (
    room: AwakeningRoomState,
    actor: AwakeningActor,
    kind: TelegraphKind,
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
    radius: number,
    length: number,
    angleHalf: number,
    windup: number,
    colorHex: number
  ) => void;
  clearActorTelegraph: (room: AwakeningRoomState, actor: AwakeningActor) => void;
  findNearestTarget: (room: AwakeningRoomState, actor: AwakeningActor, maxRange: number) => AwakeningActor | null;
  findPreferredTarget: (room: AwakeningRoomState, actor: AwakeningActor, maxRange: number) => AwakeningActor | null;
  clampAimPoint: (
    room: AwakeningRoomState,
    actor: AwakeningActor,
    rawX: number,
    rawZ: number,
    maxRange: number
  ) => { x: number; z: number };
  computeDynamicDamage: (
    actor: AwakeningActor,
    target: AwakeningActor,
    baseDamage: number,
    slot: AbilitySlot
  ) => { dmg: number; isBackstab: boolean; isCrit: boolean; staggerBonus: number };
  applyHit: (
    room: AwakeningRoomState,
    attacker: AwakeningActor,
    target: AwakeningActor,
    damage: number,
    staggerDamage: number,
    knockback: number,
    dirX: number,
    dirZ: number,
    colorHex: number,
    isHeavy: boolean,
    isPull?: boolean,
    isUltimate?: boolean,
    isCrit?: boolean,
    isBackstab?: boolean
  ) => boolean;
  damageObstacle: (
    room: AwakeningRoomState,
    obs: ObstacleState,
    dmg: number,
    hitX: number,
    hitY: number,
    hitZ: number,
    colorHex: number
  ) => void;
  damageObstaclesInArea: (
    room: AwakeningRoomState,
    x: number,
    z: number,
    radius: number,
    dmg: number,
    colorHex: number
  ) => void;
  eliminateActor: (
    room: AwakeningRoomState,
    attacker: AwakeningActor | null,
    target: AwakeningActor,
    cause: KoCause
  ) => void;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function resetRoomAwakeningState(room: AwakeningRoomState): void {
  room.awakeningPhase = 'PRE_AWAKENING';
  room.awakeningOrbs = [];
  room.awakeningBanner = null;
  room.awakeningCutscene = null;
  room.awakeningDelayedHits = [];
}

export function spawnAwakeningOrbs(
  room: AwakeningRoomState,
  helpers: AwakeningHostHelpers,
  force = false
): void {
  if (!force && room.awakeningPhase !== 'PRE_AWAKENING') return;
  const arenaRadius = MAP_BY_ID[room.mapId].arenaRadius;
  const [ptA, ptB] = findFarthestValidOrbPair(room.mapId, room.obstacles, arenaRadius);

  room.awakeningPhase = 'ORBS_ACTIVE';
  room.awakeningOrbs = [
    { id: helpers.makeId('aorb'), x: ptA.x, y: ptA.y, z: ptA.z, active: true, fadeTimer: 0 },
    { id: helpers.makeId('aorb'), x: ptB.x, y: ptB.y, z: ptB.z, active: true, fadeTimer: 0 },
  ];
  room.awakeningBanner = {
    id: helpers.makeId('aban'),
    text: 'AWAKENING ORBS HAVE APPEARED',
    subtext: 'Reach a crystal to unlock your Awakened Form!',
    colorHex: 0x38bdf8,
    remaining: AWAKENING_CONFIG.BANNER_DURATION_SEC,
  };
  helpers.pushEvent(room, {
    kind: 'awakeningOrbsSpawn',
    x: 0,
    y: 1.5,
    z: 0,
    colorHex: 0x38bdf8,
    callout: 'AWAKENING ORBS HAVE APPEARED',
  });
}

export function awakenActorImmediate(
  room: AwakeningRoomState,
  actor: AwakeningActor,
  helpers: AwakeningHostHelpers,
  showBanner = true
): void {
  if (actor.awakened || actor.isKO) return;
  applyAwakeningSurge(actor);
  actor.awakeningTransformTimer = AWAKENING_CONFIG.FIRST_TRANSFORM_LOCK_SEC;
  actor.iframeTimer = Math.max(actor.iframeTimer, AWAKENING_CONFIG.FIRST_TRANSFORM_LOCK_SEC);
  actor.silencedTimer = 0;

  const kit = AWAKENING_CONFIG.AWAKENED_KITS[actor.fighterId];
  if (showBanner) {
    room.awakeningBanner = {
      id: helpers.makeId('aban'),
      text: `${actor.name.toUpperCase()} HAS AWAKENED`,
      subtext: kit.awakenedTitle,
      colorHex: kit.auraPrimaryHex,
      remaining: AWAKENING_CONFIG.BANNER_DURATION_SEC,
    };
  }
  helpers.pushEvent(room, {
    kind: 'awakeningTransform',
    attackerId: actor.playerId,
    fighterId: actor.fighterId,
    x: actor.x,
    y: actor.y + 1.1,
    z: actor.z,
    colorHex: kit.auraPrimaryHex,
    hitStopMs: 65,
    callout: `${actor.name.toUpperCase()} HAS AWAKENED!`,
  });
}

export function beginAwakeningCutscene(
  room: AwakeningRoomState,
  p1: AwakeningActor,
  p2: AwakeningActor,
  helpers: AwakeningHostHelpers
): void {
  if (room.awakeningPhase === 'CUTSCENE') return;

  // Apply Awakening surge cleanly to both if either wasn't awakened yet
  if (!p1.awakened) applyAwakeningSurge(p1);
  if (!p2.awakened) applyAwakeningSurge(p2);

  // Consume any remaining crystals
  for (const orb of room.awakeningOrbs) {
    orb.active = false;
    orb.fadeTimer = 0;
  }

  // Clear in-progress clashes/headlocks/telegraphs/projectiles cleanly
  room.activeClash = null;
  room.activeHeadlock = null;
  room.telegraphs = [];
  room.projectiles = [];
  room.awakeningDelayedHits = [];
  room.awakeningPhase = 'CUTSCENE';

  // Ensure sudden death storm doesn't shrink onto the cutscene choreography
  if (room.stormActive && room.stormRadius < 15.0) {
    room.stormRadius = 15.0;
  }

  // Position fighters at opposite ends of open center lane facing each other
  const startDist = AWAKENING_CONFIG.WALK_START_HALF_DISTANCE;
  p1.x = -startDist;
  p1.z = 0;
  p1.y = getObstacleSupportY(room.mapId, p1.x, 0, p1.z, 0.45, room.obstacles);
  p1.vx = 0;
  p1.yVel = 0;
  p1.vz = 0;
  p1.grounded = true;
  p1.isFlying = false;
  p1.rotY = Math.PI * 0.5;

  p2.x = startDist;
  p2.z = 0;
  p2.y = getObstacleSupportY(room.mapId, p2.x, 0, p2.z, 0.45, room.obstacles);
  p2.vx = 0;
  p2.yVel = 0;
  p2.vz = 0;
  p2.grounded = true;
  p2.isFlying = false;
  p2.rotY = -Math.PI * 0.5;

  for (const act of [p1, p2]) {
    act.actionState = 'move';
    act.actionTimer = 0;
    act.actionDuration = 0;
    act.abilitySlot = null;
    act.shieldActive = false;
    act.parryWindow = false;
    act.blockHeld = false;
    act.superArmor = false;
    act.silencedTimer = 0;
    act.iframeTimer = 30.0;
    act.moveX = 0;
    act.moveZ = 0;
  }

  const csId = helpers.makeId('cutscene');
  room.awakeningCutscene = {
    id: csId,
    p1Id: p1.playerId,
    p2Id: p2.playerId,
    p1Name: p1.name,
    p2Name: p2.name,
    p1FighterId: p1.fighterId,
    p2FighterId: p2.fighterId,
    clockSec: 0,
    clashBalance: 0,
    p1Taps: 0,
    p2Taps: 0,
    p1Overdrive: 1,
    p2Overdrive: 1,
    outcome: null,
    fadeMusicOut: false,
    resolved: false,
    tug: createClashTugState(),
    botMashTimer: 0,
    hasSyncedAudio: false,
    lastAudioSyncAt: Date.now(),
  };

  helpers.pushEvent(room, {
    kind: 'awakeningCutsceneStart',
    attackerId: p1.playerId,
    targetId: p2.playerId,
    x: 0,
    y: 1.5,
    z: 0,
    colorHex: 0xfacc15,
    callout: 'AWAKENED CLASH!',
  });
}

export function cancelCutsceneGracefully(
  room: AwakeningRoomState,
  helpers: AwakeningHostHelpers
): void {
  if (!room.awakeningCutscene) return;
  room.awakeningCutscene = null;
  if (room.awakeningPhase === 'CUTSCENE') {
    room.awakeningPhase = 'AWAKENED_DUEL';
  }
  for (const act of room.actors) {
    if (!act.isKO) {
      act.iframeTimer = Math.min(act.iframeTimer, 0.25);
      act.actionState = act.grounded ? 'idle' : 'jump';
    }
  }
  helpers.pushEvent(room, {
    kind: 'awakeningClashEnd',
    x: 0,
    y: 1.2,
    z: 0,
    colorHex: 0xf43f5e,
    callout: 'CLASH INTERRUPTED',
  });
}

export function resolveCutsceneClash(
  room: AwakeningRoomState,
  helpers: AwakeningHostHelpers,
  skipped = false
): void {
  const cs = room.awakeningCutscene;
  if (!cs || cs.resolved) return;
  cs.resolved = true;

  const p1 = room.actors.find((a) => a.playerId === cs.p1Id && !a.isKO);
  const p2 = room.actors.find((a) => a.playerId === cs.p2Id && !a.isKO);
  if (!p1 || !p2) {
    cancelCutsceneGracefully(room, helpers);
    return;
  }

  let outcome = cs.tug.outcome;
  if (!outcome) {
    if (skipped && cs.p1Taps === 0 && cs.p2Taps === 0) {
      outcome = 'tie';
    } else if (Math.abs(cs.tug.balance) < 0.02 && cs.p1Taps === cs.p2Taps) {
      outcome = 'tie';
    } else {
      outcome = cs.tug.balance <= 0 ? (cs.p1Taps >= cs.p2Taps || cs.tug.balance < -0.02 ? 'p1' : 'p2') : 'p2';
    }
  }
  cs.outcome = outcome;
  cs.fadeMusicOut = skipped;

  // Release invulnerability so knockback & clash damage land cleanly
  p1.iframeTimer = 0;
  p2.iframeTimer = 0;
  p1.shieldActive = false;
  p2.shieldActive = false;

  if (outcome === 'tie') {
    p1.vx = -AWAKENING_CONFIG.CLASH_KNOCKBACK * 0.85;
    p1.vz = 0;
    p1.yVel = 4.6;
    p1.grounded = false;
    p1.actionState = 'stagger';
    p1.actionTimer = 0.45;
    p1.actionDuration = 0.45;

    p2.vx = AWAKENING_CONFIG.CLASH_KNOCKBACK * 0.85;
    p2.vz = 0;
    p2.yVel = 4.6;
    p2.grounded = false;
    p2.actionState = 'stagger';
    p2.actionTimer = 0.45;
    p2.actionDuration = 0.45;

    helpers.pushEvent(room, {
      kind: 'awakeningClashEnd',
      x: 0,
      y: 1.4,
      z: 0,
      colorHex: 0xffffff,
      hitStopMs: AWAKENING_CONFIG.CLASH_HITSTOP_MS,
      damage: 0,
      callout: 'EVEN CLASH — STANDOFF!',
    });
  } else {
    const winner = outcome === 'p1' ? p1 : p2;
    const loser = outcome === 'p1' ? p2 : p1;
    const dirX = loser.x >= winner.x ? 1 : -1;
    const dmg = Math.max(AWAKENING_CONFIG.CLASH_DAMAGE, Math.round(loser.maxHp * 0.16));

    winner.actionState = 'idle';
    winner.actionTimer = 0;
    winner.iframeTimer = 0.35;
    winner.damageDealt += dmg;

    loser.hp = Math.max(0, loser.hp - dmg);
    loser.damagePhase = getDamagePhase(loser.hp, loser.maxHp, loser.isKO);
    loser.lastDamagedAt = room.matchTime;
    loser.vx = dirX * AWAKENING_CONFIG.CLASH_KNOCKBACK;
    loser.vz = 0;
    loser.yVel = AWAKENING_CONFIG.CLASH_UPWARD_VEL;
    loser.grounded = false;
    loser.actionState = 'stagger';
    loser.actionTimer = 0.72;
    loser.actionDuration = 0.72;

    helpers.pushEvent(room, {
      kind: 'awakeningClashEnd',
      attackerId: winner.playerId,
      targetId: loser.playerId,
      fighterId: winner.fighterId,
      x: (winner.x + loser.x) * 0.5,
      y: 1.45,
      z: 0,
      dirX,
      dirZ: 0,
      colorHex: AWAKENING_CONFIG.AWAKENED_KITS[winner.fighterId].auraPrimaryHex,
      damage: dmg,
      hitStopMs: AWAKENING_CONFIG.CLASH_HITSTOP_MS,
      callout: `${winner.name.toUpperCase()} OVERPOWERS!`,
    });

    if (loser.hp <= 0) {
      helpers.eliminateActor(room, winner, loser, 'clash');
    }
  }

  room.awakeningPhase = 'AWAKENED_DUEL';
  room.awakeningCutscene = null;
}

export function handleAwakeningMash(
  room: AwakeningRoomState,
  playerId: string,
  helpers: AwakeningHostHelpers,
  explicitSide?: 'p1' | 'p2'
): void {
  const cs = room.awakeningCutscene;
  if (!cs || cs.resolved) return;
  if (cs.clockSec < AWAKENING_CONFIG.TIMELINE.CLASH_START_AT - 0.15) return;

  let side: 'p1' | 'p2' | null = null;
  if (explicitSide && (room.isSoloPractice || room.isTrainingMode)) {
    side = explicitSide;
  } else if (playerId === cs.p1Id) {
    side = 'p1';
  } else if (playerId === cs.p2Id) {
    side = 'p2';
  }
  if (!side) return;

  registerClashMash(cs.tug, side, cs.tug.elapsed);
  cs.clashBalance = Number(cs.tug.balance.toFixed(3));
  cs.p1Taps = cs.tug.p1Taps;
  cs.p2Taps = cs.tug.p2Taps;
  cs.p1Overdrive = Number(cs.tug.p1OverdriveMult.toFixed(2));
  cs.p2Overdrive = Number(cs.tug.p2OverdriveMult.toFixed(2));

  if (cs.tug.resolved) {
    resolveCutsceneClash(room, helpers, false);
  }
}

export function syncCutsceneAudioClock(
  room: AwakeningRoomState,
  playerId: string,
  clockSec: number,
  helpers: AwakeningHostHelpers
): void {
  const cs = room.awakeningCutscene;
  if (!cs || cs.resolved) return;
  // Authority from P1 (or first connected human) keeps server state tightly aligned to audio.currentTime
  const p1 = room.actors.find((a) => a.playerId === cs.p1Id);
  const acceptFrom = p1 && !p1.isBot ? cs.p1Id : cs.p2Id;
  if (playerId !== acceptFrom && playerId !== cs.p1Id) return;
  if (Number.isFinite(clockSec) && clockSec >= cs.clockSec - 0.1 && clockSec <= 30) {
    cs.clockSec = Math.max(cs.clockSec, clockSec);
    cs.hasSyncedAudio = true;
    cs.lastAudioSyncAt = Date.now();
    if (cs.clockSec >= AWAKENING_CONFIG.TIMELINE.CLASH_END_AT) {
      resolveCutsceneClash(room, helpers, false);
    }
  }
}

/**
 * Returns true if the room is currently in CUTSCENE (caller should pause matchTimer & standard combat loop).
 */
export function tickAwakeningRoom(
  room: AwakeningRoomState,
  dt: number,
  helpers: AwakeningHostHelpers
): boolean {
  if (room.awakeningBanner) {
    room.awakeningBanner.remaining -= dt;
    if (room.awakeningBanner.remaining <= 0) {
      room.awakeningBanner = null;
    }
  }

  // Fade out leftover orbs (e.g. if opponent died before collecting 2nd orb)
  for (const orb of room.awakeningOrbs) {
    if (!orb.active && orb.fadeTimer > 0) {
      orb.fadeTimer = Math.max(0, orb.fadeTimer - dt);
    }
  }
  if (room.awakeningOrbs.length > 0 && room.awakeningOrbs.every((o) => !o.active && o.fadeTimer <= 0)) {
    room.awakeningOrbs = [];
  }

  // Decrement per-actor awakening timers
  for (const a of room.actors) {
    if (a.awakeningTransformTimer > 0) a.awakeningTransformTimer = Math.max(0, a.awakeningTransformTimer - dt);
    if (a.silencedTimer > 0) a.silencedTimer = Math.max(0, a.silencedTimer - dt);
    if (a.snareMarkedTimer > 0) a.snareMarkedTimer = Math.max(0, a.snareMarkedTimer - dt);
  }

  // Delayed impact tasks (e.g., Khen mirage echo strikes)
  for (let i = room.awakeningDelayedHits.length - 1; i >= 0; i--) {
    const t = room.awakeningDelayedHits[i];
    t.remaining -= dt;
    if (t.remaining <= 0) {
      room.awakeningDelayedHits.splice(i, 1);
      t.run();
    }
  }

  // Check Cutscene state
  if (room.awakeningPhase === 'CUTSCENE') {
    const cs = room.awakeningCutscene;
    if (!cs) {
      room.awakeningPhase = 'AWAKENED_DUEL';
      return false;
    }
    const p1 = room.actors.find((a) => a.playerId === cs.p1Id);
    const p2 = room.actors.find((a) => a.playerId === cs.p2Id);
    if (!p1 || !p2 || p1.isKO || p2.isKO) {
      cancelCutsceneGracefully(room, helpers);
      return false;
    }

    // Fallback server clock progression if no client audio heartbeat arrived recently (e.g. muted/bot/headless test)
    const sinceSyncMs = Date.now() - cs.lastAudioSyncAt;
    if (!cs.hasSyncedAudio || sinceSyncMs > 320) {
      cs.clockSec += dt;
    }

    // Choreography positioning during 0:00-0:12 walk and 0:15-0:18 clash
    const T = AWAKENING_CONFIG.TIMELINE;
    if (cs.clockSec < T.PANEL_1_AT) {
      const u = clamp(cs.clockSec / Math.max(0.1, T.PANEL_1_AT), 0, 1);
      const halfDist =
        AWAKENING_CONFIG.WALK_START_HALF_DISTANCE +
        (AWAKENING_CONFIG.WALK_MEET_HALF_DISTANCE - AWAKENING_CONFIG.WALK_START_HALF_DISTANCE) * u;
      p1.x = -halfDist;
      p1.z = 0;
      p1.rotY = Math.PI * 0.5;
      p1.actionState = 'move';
      p1.vx = 1.4;
      p1.vz = 0;

      p2.x = halfDist;
      p2.z = 0;
      p2.rotY = -Math.PI * 0.5;
      p2.actionState = 'move';
      p2.vx = -1.4;
      p2.vz = 0;
    } else if (cs.clockSec < T.CLASH_START_AT) {
      p1.actionState = 'idle';
      p2.actionState = 'idle';
      p1.vx = 0;
      p2.vx = 0;
    } else {
      const sepHalf = AWAKENING_CONFIG.CLASH_SEPARATION_DISTANCE * 0.5;
      p1.x = -sepHalf;
      p1.z = 0;
      p1.rotY = Math.PI * 0.5;
      p1.actionState = 'ultimate';
      p1.vx = 0;

      p2.x = sepHalf;
      p2.z = 0;
      p2.rotY = -Math.PI * 0.5;
      p2.actionState = 'ultimate';
      p2.vx = 0;

      // Bot auto-mash simulation (~7 taps/s with jitter)
      for (const [side, actor] of [
        ['p1', p1],
        ['p2', p2],
      ] as const) {
        if (actor.isBot && !actor.isDummy) {
          const chance = dt * AWAKENING_CONFIG.BOT_MASH_RATE_HZ * (1 - AWAKENING_CONFIG.BOT_MASH_JITTER * 0.5 + Math.random() * AWAKENING_CONFIG.BOT_MASH_JITTER);
          if (Math.random() < chance) {
            registerClashMash(cs.tug, side, cs.tug.elapsed);
          }
        }
      }

      const outcome = stepClashTugOfWar(cs.tug, dt, T.CLASH_END_AT - T.CLASH_START_AT);
      cs.clashBalance = Number(cs.tug.balance.toFixed(3));
      cs.p1Taps = cs.tug.p1Taps;
      cs.p2Taps = cs.tug.p2Taps;
      cs.p1Overdrive = Number(cs.tug.p1OverdriveMult.toFixed(2));
      cs.p2Overdrive = Number(cs.tug.p2OverdriveMult.toFixed(2));

      if (outcome || cs.clockSec >= T.CLASH_END_AT) {
        resolveCutsceneClash(room, helpers, false);
      }
    }

    return true;
  }

  // Check spawn condition during PRE_AWAKENING
  const aliveActors = room.actors.filter((a) => !a.isKO && !a.isDummy);
  if (
    shouldSpawnAwakeningOrbs({
      isTrainingMode: room.isTrainingMode,
      phase: room.awakeningPhase,
      initialActorCount: room.initialActorCount,
      aliveCount: aliveActors.length,
      matchTime: room.matchTime,
    })
  ) {
    spawnAwakeningOrbs(room, helpers);
  }

  // If 1 or fewer alive while orbs active -> fade leftover orbs cleanly
  if (room.awakeningPhase === 'ORBS_ACTIVE' && aliveActors.length <= 1) {
    for (const orb of room.awakeningOrbs) {
      if (orb.active) {
        orb.active = false;
        orb.fadeTimer = AWAKENING_CONFIG.ORB_FADEOUT_SEC;
      }
    }
    return false;
  }

  // Check orb pickups during ORBS_ACTIVE
  if (room.awakeningPhase === 'ORBS_ACTIVE' && room.awakeningOrbs.length > 0) {
    const pickupsThisFrame: Array<{ actor: AwakeningActor; orb: AwakeningOrbState }> = [];
    const claimedOrbIds = new Set<string>();
    const claimedActorIds = new Set<string>();

    for (const orb of room.awakeningOrbs) {
      if (!orb.active) continue;
      for (const actor of aliveActors) {
        if (actor.awakened || claimedActorIds.has(actor.playerId) || claimedOrbIds.has(orb.id)) continue;
        const distXZ = Math.hypot(actor.x - orb.x, actor.z - orb.z);
        const distY = Math.abs(actor.y + 0.9 - orb.y);
        if (distXZ <= AWAKENING_CONFIG.ORB_PICKUP_RADIUS && distY <= 3.2) {
          claimedOrbIds.add(orb.id);
          claimedActorIds.add(actor.playerId);
          pickupsThisFrame.push({ actor, orb });
        }
      }
    }

    if (pickupsThisFrame.length > 0) {
      const alreadyAwakenedActor = aliveActors.find((a) => a.awakened) ?? null;

      for (const { actor, orb } of pickupsThisFrame) {
        orb.active = false;
        orb.fadeTimer = 0;
        helpers.pushEvent(room, {
          kind: 'awakeningPickup',
          attackerId: actor.playerId,
          fighterId: actor.fighterId,
          x: orb.x,
          y: orb.y,
          z: orb.z,
          colorHex: AWAKENING_CONFIG.AWAKENED_KITS[actor.fighterId].auraPrimaryHex,
        });
      }

      if (pickupsThisFrame.length >= 2) {
        // Simultaneous same-frame pickup -> both awaken & immediately run cutscene
        const a1 = pickupsThisFrame[0].actor;
        const a2 = pickupsThisFrame[1].actor;
        awakenActorImmediate(room, a1, helpers, false);
        awakenActorImmediate(room, a2, helpers, false);
        const ordered = a1.slotIndex <= a2.slotIndex ? [a1, a2] : [a2, a1];
        beginAwakeningCutscene(room, ordered[0], ordered[1], helpers);
        return true;
      }

      const collector = pickupsThisFrame[0].actor;
      if (alreadyAwakenedActor && alreadyAwakenedActor.playerId !== collector.playerId) {
        // 2nd survivor grabbed remaining orb -> awaken & launch Cutscene!
        awakenActorImmediate(room, collector, helpers, false);
        const ordered =
          alreadyAwakenedActor.slotIndex <= collector.slotIndex
            ? [alreadyAwakenedActor, collector]
            : [collector, alreadyAwakenedActor];
        beginAwakeningCutscene(room, ordered[0], ordered[1], helpers);
        return true;
      } else {
        // 1st survivor -> immediate transform flash, hunt the other before they reach orb #2!
        awakenActorImmediate(room, collector, helpers, true);
      }
    }
  }

  return false;
}

export function handleAwakeningDebug(
  room: AwakeningRoomState,
  action: AwakeningDebugAction,
  helpers: AwakeningHostHelpers
): void {
  const nonDummy = room.actors.filter((a) => !a.isDummy && !a.isKO);
  const p1 = nonDummy[0] ?? room.actors[0];
  const p2 = nonDummy[1] ?? room.actors[1];

  if (action === 'spawnOrbs') {
    spawnAwakeningOrbs(room, helpers, true);
    return;
  }
  if (action === 'awakenP1' && p1) {
    awakenActorImmediate(room, p1, helpers, true);
    return;
  }
  if (action === 'awakenP2' && p2) {
    awakenActorImmediate(room, p2, helpers, true);
    return;
  }
  if (action === 'triggerCutscene' && p1 && p2) {
    beginAwakeningCutscene(room, p1, p2, helpers);
    return;
  }
  if (action === 'setTime89') {
    room.matchTime = 89.0;
    return;
  }
  if (action === 'resetCooldowns') {
    for (const a of room.actors) {
      for (let i = 0; i < a.cooldowns.length; i++) a.cooldowns[i] = 0;
      a.dashCooldown = 0;
      a.grabCooldown = 0;
      a.flightCooldown = 0;
      a.flightRemaining = a.flightMax;
      a.mana = a.maxMana;
      a.stamina = a.maxStamina;
      a.silencedTimer = 0;
    }
  }
}

export function setupAwakenedAbilityWindup(
  room: AwakeningRoomState,
  actor: AwakeningActor,
  slot: 0 | 2 | 3 | 4 | 6,
  castDirX: number,
  castDirZ: number,
  clampedAim: { x: number; z: number } | null,
  helpers: AwakeningHostHelpers
): void {
  const kit = AWAKENING_CONFIG.AWAKENED_KITS[actor.fighterId];
  const ab = getAwakenedAbility(actor.fighterId, slot);
  if (!ab) return;
  const specColor = kit.auraPrimaryHex;
  const aimDest = clampedAim ?? {
    x: actor.x + castDirX * Math.min(ab.aimRange ?? 8.5, 7.5),
    z: actor.z + castDirZ * Math.min(ab.aimRange ?? 8.5, 7.5),
  };

  if (slot === 0) {
    const isSingleRanged =
      actor.fighterId === 'damen' ||
      actor.fighterId === 'marjohn' ||
      (actor.fighterId === 'jm' && actor.isFlying);
    if (isSingleRanged) {
      actor.comboStep = ((actor.comboStep % 3) + 1) as 1 | 2 | 3;
    } else {
      if (room.matchTime - actor.lastM1At <= 1.6) {
        actor.comboStep = ((actor.comboStep % 4) + 1) as 1 | 2 | 3 | 4;
      } else {
        actor.comboStep = 1;
      }
    }
    actor.lastM1At = room.matchTime;
    const is4th = !isSingleRanged && actor.comboStep === 4;
    actor.m1Variant = is4th ? 'heavy' : 'light';
    actor.pendingHoldHeavy = is4th;
    if (actor.fighterId === 'prime' && is4th) {
      actor.superArmor = true;
    }
    actor.actionState = 'attack';
    actor.actionDuration = ab.duration;
    actor.actionTimer = ab.duration;
    if (!isSingleRanged) {
      actor.vx = castDirX * (is4th ? 16.0 : 6.2);
      actor.vz = castDirZ * (is4th ? 16.0 : 6.2);
    }
    helpers.pushEvent(room, {
      kind: 'cast',
      attackerId: actor.playerId,
      fighterId: actor.fighterId,
      x: actor.x,
      y: actor.y + 1.1,
      z: actor.z,
      dirX: castDirX,
      dirZ: castDirZ,
      colorHex: specColor,
      abilitySlot: 0,
      comboStep: actor.comboStep,
      m1Variant: actor.m1Variant,
    });
    return;
  }

  actor.actionState = slot >= 4 ? 'ultimate' : 'skill';
  actor.actionDuration = ab.duration;
  actor.actionTimer = ab.duration;

  if (actor.fighterId === 'marjohn') {
    if (slot === 2) {
      const dx = aimDest.x - actor.x;
      const dz = aimDest.z - actor.z;
      const d = Math.max(0.1, Math.hypot(dx, dz));
      actor.yVel = 8.4;
      actor.grounded = false;
      actor.vx = (dx / d) * Math.min(22.0, d / Math.max(0.16, ab.windup));
      actor.vz = (dz / d) * Math.min(22.0, d / Math.max(0.16, ab.windup));
      helpers.spawnTelegraph(room, actor, 'circle', aimDest.x, 0, aimDest.z, castDirX, castDirZ, ab.range, 0, 0, ab.windup, specColor);
    } else if (slot === 3 || slot === 4) {
      helpers.spawnTelegraph(room, actor, 'circle', aimDest.x, 0, aimDest.z, castDirX, castDirZ, ab.range, 0, 0, ab.windup, specColor);
    } else if (slot === 6) {
      helpers.spawnTelegraph(room, actor, 'line', actor.x, 0, actor.z, castDirX, castDirZ, 4.4, 14.0, 0, ab.windup, specColor);
    }
  } else if (actor.fighterId === 'prime') {
    if (slot === 2) {
      actor.superArmor = true;
      actor.iframeTimer = Math.max(actor.iframeTimer, 0.35);
      actor.vx = castDirX * AWAKENING_CONFIG.PRIME_RUSH_SPEED;
      actor.vz = castDirZ * AWAKENING_CONFIG.PRIME_RUSH_SPEED;
      helpers.spawnTelegraph(room, actor, 'line', actor.x, 0, actor.z, castDirX, castDirZ, 2.5, 9.5, 0, ab.windup, specColor);
    } else if (slot === 3 || slot === 6) {
      actor.superArmor = true;
      helpers.spawnTelegraph(room, actor, 'cone', actor.x, 0, actor.z, castDirX, castDirZ, 0, ab.range, 0.52, ab.windup, specColor);
    } else if (slot === 4) {
      actor.yVel = 7.8;
      actor.grounded = false;
      helpers.spawnTelegraph(room, actor, 'circle', aimDest.x, 0, aimDest.z, castDirX, castDirZ, ab.range, 0, 0, ab.windup, specColor);
    }
  } else if (actor.fighterId === 'damen') {
    if (slot === 2) {
      actor.iframeTimer = Math.max(actor.iframeTimer, 0.38);
      const rx = Math.hypot(actor.moveX, actor.moveZ) > 0.1 ? actor.moveX : -castDirX;
      const rz = Math.hypot(actor.moveX, actor.moveZ) > 0.1 ? actor.moveZ : -castDirZ;
      const mag = Math.max(0.01, Math.hypot(rx, rz));
      actor.vx = (rx / mag) * 18.0;
      actor.vz = (rz / mag) * 18.0;
    } else if (slot >= 3) {
      helpers.spawnTelegraph(room, actor, 'cone', actor.x, 0, actor.z, castDirX, castDirZ, 0, ab.range, 0.46, ab.windup, specColor);
    }
  } else if (actor.fighterId === 'khen') {
    if (slot === 2) {
      actor.iframeTimer = Math.max(actor.iframeTimer, 0.25);
      helpers.spawnTelegraph(room, actor, 'circle', aimDest.x, 0, aimDest.z, castDirX, castDirZ, 3.4, 0, 0, ab.windup, specColor);
    } else if (slot === 4) {
      helpers.spawnTelegraph(room, actor, 'line', actor.x, 0, actor.z, castDirX, castDirZ, 3.0, 11.5, 0, ab.windup, specColor);
    } else if (slot === 6) {
      actor.iframeTimer = Math.max(actor.iframeTimer, ab.duration);
      helpers.spawnTelegraph(room, actor, 'circle', aimDest.x, 0, aimDest.z, castDirX, castDirZ, AWAKENING_CONFIG.KHEN_OMNISLASH_RADIUS, 0, 0, ab.windup, specColor);
    }
  } else if (actor.fighterId === 'jm') {
    if (slot === 3) {
      helpers.spawnTelegraph(room, actor, 'circle', actor.x, 0, actor.z, castDirX, castDirZ, AWAKENING_CONFIG.JM_DIVINE_NOVA_RADIUS, 0, 0, ab.windup, specColor);
    } else if (slot === 4 || slot === 6) {
      helpers.spawnTelegraph(room, actor, 'line', actor.x, 0, actor.z, castDirX, castDirZ, ab.aimRadius ?? 3.0, ab.range, 0, ab.windup, specColor);
    }
  }

  helpers.pushEvent(room, {
    kind: 'cast',
    attackerId: actor.playerId,
    fighterId: actor.fighterId,
    x: actor.x,
    y: actor.y + 1.05,
    z: actor.z,
    dirX: castDirX,
    dirZ: castDirZ,
    colorHex: specColor,
    abilitySlot: slot,
    callout: slot >= 4 ? `${ab.name.toUpperCase()}!` : undefined,
  });
}

export function executeAwakenedAbilityImpact(
  room: AwakeningRoomState,
  actor: AwakeningActor,
  slot: 0 | 2 | 3 | 4 | 6,
  helpers: AwakeningHostHelpers
): void {
  const kit = AWAKENING_CONFIG.AWAKENED_KITS[actor.fighterId];
  const ab = getAwakenedAbility(actor.fighterId, slot);
  if (!ab) return;
  helpers.clearActorTelegraph(room, actor);

  const fx = Math.sin(actor.rotY);
  const fz = Math.cos(actor.rotY);
  const arenaRadius = MAP_BY_ID[room.mapId].arenaRadius;
  const color = kit.auraPrimaryHex;
  const aimPt =
    actor.pendingAimX !== null && actor.pendingAimZ !== null
      ? { x: actor.pendingAimX, z: actor.pendingAimZ }
      : { x: actor.x + fx * Math.min(ab.aimRange ?? 6.5, 6.5), z: actor.z + fz * Math.min(ab.aimRange ?? 6.5, 6.5) };

  // ====================== 1. MARJOHN (Calamity Wind Sovereign) ======================
  if (actor.fighterId === 'marjohn') {
    if (slot === 0) {
      // Gale Cleave Volley: piercing crescent storm blade; 3rd hit pulls inward
      const pull = actor.comboStep === 3;
      room.projectiles.push({
        id: helpers.makeId('proj'),
        ownerId: actor.playerId,
        fighterId: 'marjohn',
        kind: 'windBlade',
        x: actor.x + fx * 0.9,
        y: actor.y + 1.05,
        z: actor.z + fz * 0.9,
        vx: fx * AWAKENING_CONFIG.MARJOHN_BLADE_SPEED,
        vz: fz * AWAKENING_CONFIG.MARJOHN_BLADE_SPEED,
        rotY: actor.rotY,
        colorHex: color,
        originX: actor.x,
        originY: actor.y + 1.05,
        originZ: actor.z,
        isOverdrive: true,
        age: 0,
        maxAge: 0.65,
        maxRange: AWAKENING_CONFIG.MARJOHN_BLADE_RANGE,
        damage: ab.damage + (pull ? 4 : 0),
        staggerDamage: ab.staggerDamage,
        knockback: pull ? -9.5 : ab.knockback,
        hitIds: new Set(),
      });
      actor.landedCurrentAction = true;
      return;
    }
    if (slot === 2) {
      // Thunderhead Vault: Blink overhead + wider cyclone slam + lightning strike
      const safe = resolveObstacleCollisions(room.mapId, aimPt.x, actor.y, aimPt.z, 0.48, room.obstacles);
      actor.x = safe.x;
      actor.z = safe.z;
      actor.y = getObstacleSupportY(room.mapId, safe.x, 0, safe.z, 0.42, room.obstacles);
      actor.yVel = 0;
      actor.grounded = true;
      helpers.damageObstaclesInArea(room, safe.x, safe.z, ab.range, ab.damage * 1.5, color);
      helpers.pushEvent(room, {
        kind: 'lightning',
        attackerId: actor.playerId,
        fighterId: 'marjohn',
        x: safe.x,
        y: actor.y + 0.2,
        z: safe.z,
        radius: ab.range,
        colorHex: 0x38bdf8,
        hitStopMs: 65,
        abilitySlot: 2,
        callout: 'THUNDERHEAD VAULT!',
      });
      for (const t of room.actors) {
        if (t.playerId === actor.playerId || t.isKO) continue;
        const d = Math.hypot(t.x - safe.x, t.z - safe.z);
        if (d <= ab.range && Math.abs(t.y - actor.y) <= 3.5) {
          const calc = helpers.computeDynamicDamage(actor, t, ab.damage, 2);
          if (helpers.applyHit(room, actor, t, calc.dmg, ab.staggerDamage + calc.staggerBonus, ab.knockback, d > 0.05 ? (t.x - safe.x) / d : fx, d > 0.05 ? (t.z - safe.z) / d : fz, color, true, false, false, calc.isCrit, calc.isBackstab)) {
            actor.landedCurrentAction = true;
            t.yVel = Math.max(t.yVel, 7.8);
            t.grounded = false;
          }
        }
      }
      return;
    }
    if (slot === 3) {
      // Maelstrom Prison: Twin orbiting tornadoes trap & shred + launch
      helpers.spawnZone(room, actor, 'maelstromTornado', aimPt.x, 0, aimPt.z, AWAKENING_CONFIG.MARJOHN_MAELSTROM_RADIUS, AWAKENING_CONFIG.MARJOHN_MAELSTROM_DURATION, color);
      helpers.pushEvent(room, {
        kind: 'shockwave',
        attackerId: actor.playerId,
        fighterId: 'marjohn',
        x: aimPt.x,
        y: 0.25,
        z: aimPt.z,
        radius: AWAKENING_CONFIG.MARJOHN_MAELSTROM_RADIUS,
        colorHex: color,
        abilitySlot: 3,
        callout: 'MAELSTROM PRISON!',
      });
      for (const t of room.actors) {
        if (t.playerId === actor.playerId || t.isKO) continue;
        const d = Math.hypot(t.x - aimPt.x, t.z - aimPt.z);
        if (d <= ab.range) {
          const calc = helpers.computeDynamicDamage(actor, t, ab.damage * 0.65, 3);
          if (helpers.applyHit(room, actor, t, calc.dmg, 24, 6.0, d > 0.05 ? (t.x - aimPt.x) / d : fx, d > 0.05 ? (t.z - aimPt.z) / d : fz, color, true, true)) {
            actor.landedCurrentAction = true;
          }
        }
      }
      return;
    }
    if (slot === 4) {
      // Empowered Tempest: Larger funnel with faster suction
      helpers.damageObstaclesInArea(room, aimPt.x, aimPt.z, ab.range, ab.damage * 1.6, color);
      helpers.pushEvent(room, {
        kind: 'shockwave',
        attackerId: actor.playerId,
        fighterId: 'marjohn',
        x: aimPt.x,
        y: 0.25,
        z: aimPt.z,
        radius: ab.range,
        colorHex: color,
        abilitySlot: 4,
        hitStopMs: 85,
        callout: 'EMPOWERED TEMPEST!',
      });
      for (const t of room.actors) {
        if (t.playerId === actor.playerId || t.isKO) continue;
        const d = Math.hypot(t.x - aimPt.x, t.z - aimPt.z);
        if (d <= ab.range) {
          const calc = helpers.computeDynamicDamage(actor, t, ab.damage, 4);
          if (helpers.applyHit(room, actor, t, calc.dmg, ab.staggerDamage, ab.knockback, d > 0.05 ? (t.x - aimPt.x) / d : fx, d > 0.05 ? (t.z - aimPt.z) / d : fz, color, true, false, true, calc.isCrit, calc.isBackstab)) {
            actor.landedCurrentAction = true;
            t.yVel = Math.max(t.yVel, 8.6);
            t.grounded = false;
          }
        }
      }
      return;
    }
    if (slot === 6) {
      // Category-5 World Ender: Massive moving typhoon crossing arena, dragging & detonating upward
      room.projectiles.push({
        id: helpers.makeId('proj'),
        ownerId: actor.playerId,
        fighterId: 'marjohn',
        kind: 'tornadoVortex',
        x: actor.x + fx * 1.4,
        y: actor.y + 1.0,
        z: actor.z + fz * 1.4,
        vx: fx * AWAKENING_CONFIG.MARJOHN_CAT5_SPEED,
        vz: fz * AWAKENING_CONFIG.MARJOHN_CAT5_SPEED,
        rotY: actor.rotY,
        colorHex: color,
        originX: actor.x,
        originY: actor.y + 1.0,
        originZ: actor.z,
        isOverdrive: true,
        isVortex: true,
        pierceObstacles: true,
        age: 0,
        maxAge: 2.3,
        maxRange: 18.0,
        damage: ab.damage,
        staggerDamage: ab.staggerDamage,
        knockback: ab.knockback,
        hitIds: new Set(),
      });
      helpers.pushEvent(room, {
        kind: 'lightning',
        attackerId: actor.playerId,
        fighterId: 'marjohn',
        x: actor.x + fx * 2.0,
        y: actor.y + 0.5,
        z: actor.z + fz * 2.0,
        radius: 6.0,
        colorHex: 0x22d3ee,
        abilitySlot: 6,
        hitStopMs: 95,
        callout: 'CATEGORY-5 WORLD ENDER!',
      });
      actor.landedCurrentAction = true;
      return;
    }
  }

  // ====================== 2. PRIME (Unbound Core Asura) ======================
  if (actor.fighterId === 'prime') {
    if (slot === 0) {
      // Overdrive 4-Hit Barrage: shockwave cone + Super Armor on 4th slam
      const is4th = actor.comboStep === 4;
      actor.superArmor = false;
      helpers.damageObstaclesInArea(room, actor.x + fx * 1.8, actor.z + fz * 1.8, ab.range, is4th ? 38 : 18, color);
      helpers.pushEvent(room, {
        kind: 'shockwave',
        attackerId: actor.playerId,
        fighterId: 'prime',
        x: actor.x + fx * 1.4,
        y: actor.y + 0.25,
        z: actor.z + fz * 1.4,
        dirX: fx,
        dirZ: fz,
        radius: is4th ? 4.8 : 3.2,
        colorHex: color,
        abilitySlot: 0,
        comboStep: actor.comboStep || undefined,
        m1Variant: is4th ? 'heavy' : 'light',
      });
      for (const t of room.actors) {
        if (t.playerId === actor.playerId || t.isKO) continue;
        const dx = t.x - actor.x;
        const dz = t.z - actor.z;
        const d = Math.hypot(dx, dz);
        if (d <= ab.range && Math.abs(t.y - actor.y) <= 2.8) {
          if (d > 0.1 && (dx / d) * fx + (dz / d) * fz < ab.arcCos && !is4th) continue;
          const calc = helpers.computeDynamicDamage(actor, t, ab.damage + (is4th ? 8 : 0), 0);
          if (helpers.applyHit(room, actor, t, calc.dmg, ab.staggerDamage + calc.staggerBonus, ab.knockback * (is4th ? 1.45 : 1), d > 0.05 ? dx / d : fx, d > 0.05 ? dz / d : fz, color, is4th, false, false, calc.isCrit, calc.isBackstab)) {
            actor.landedCurrentAction = true;
            actor.mana = clamp(actor.mana + 18, 0, actor.maxMana);
          }
        }
      }
      return;
    }
    if (slot === 2) {
      // Comet Breaker: grab first enemy in dash path, slam forward & shatter buildings for bonus DMG!
      const startX = actor.x;
      const startZ = actor.z;
      let grabVictim: AwakeningActor | null = null;
      let wallShattered = false;
      for (let step = 1; step <= 8; step++) {
        const sx = clamp(startX + fx * (step * 1.15), -arenaRadius + 1, arenaRadius - 1);
        const sz = clamp(startZ + fz * (step * 1.15), -arenaRadius + 1, arenaRadius - 1);
        const obs = findObstacleAtPoint(room.mapId, sx, 0.8, sz, room.obstacles);
        if (obs && obs.destructible) {
          helpers.damageObstacle(room, obs, 999, sx, 1.5, sz, color);
          wallShattered = true;
        }
        if (!grabVictim) {
          for (const t of room.actors) {
            if (t.playerId === actor.playerId || t.isKO) continue;
            if (Math.hypot(t.x - sx, t.z - sz) <= 2.2) {
              grabVictim = t;
              break;
            }
          }
        }
        actor.x = sx;
        actor.z = sz;
      }
      const postSafe = resolveObstacleCollisions(room.mapId, actor.x, actor.y, actor.z, 0.48, room.obstacles);
      actor.x = postSafe.x;
      actor.z = postSafe.z;
      if (grabVictim) {
        grabVictim.x = clamp(actor.x + fx * 1.35, -arenaRadius + 1, arenaRadius - 1);
        grabVictim.z = clamp(actor.z + fz * 1.35, -arenaRadius + 1, arenaRadius - 1);
        const dmg = ab.damage + (wallShattered ? AWAKENING_CONFIG.PRIME_WALL_SHATTER_BONUS_DMG : 0);
        const calc = helpers.computeDynamicDamage(actor, grabVictim, dmg, 2);
        helpers.applyHit(room, actor, grabVictim, calc.dmg, ab.staggerDamage, ab.knockback, fx, fz, color, true, false, false, true, false);
        actor.landedCurrentAction = true;
      }
      helpers.pushEvent(room, {
        kind: 'cometGrab',
        attackerId: actor.playerId,
        targetId: grabVictim?.playerId,
        fighterId: 'prime',
        x: actor.x,
        y: actor.y + 1.0,
        z: actor.z,
        originX: startX,
        originY: actor.y + 1.0,
        originZ: startZ,
        dirX: fx,
        dirZ: fz,
        colorHex: color,
        abilitySlot: 2,
        hitStopMs: 75,
        callout: wallShattered ? 'WALL SHATTER SLAM!' : 'COMET BREAKER!',
      });
      return;
    }
    if (slot === 3) {
      // Tectonic Eruption: 3 branching magma fissures erupting sequentially
      const branches = [-0.42, 0, 0.42];
      branches.forEach((off, bIdx) => {
        const ang = actor.rotY + off;
        const bx = Math.sin(ang);
        const bz = Math.cos(ang);
        room.awakeningDelayedHits.push({
          remaining: bIdx * 0.11,
          run: () => {
            const cx = actor.x + bx * 5.2;
            const cz = actor.z + bz * 5.2;
            helpers.spawnZone(room, actor, 'magmaBranch', cx, 0, cz, 3.2, AWAKENING_CONFIG.PRIME_FISSURE_DURATION, 0xf97316, actor.x + bx * 10.5, actor.z + bz * 10.5);
            helpers.damageObstaclesInArea(room, cx, cz, 3.8, 35, 0xf97316);
            helpers.pushEvent(room, {
              kind: 'shockwave',
              attackerId: actor.playerId,
              fighterId: 'prime',
              x: cx,
              y: 0.25,
              z: cz,
              radius: 3.4,
              colorHex: 0xf97316,
              abilitySlot: 3,
            });
            for (const t of room.actors) {
              if (t.playerId === actor.playerId || t.isKO) continue;
              const dx = t.x - actor.x;
              const dz = t.z - actor.z;
              const along = dx * bx + dz * bz;
              const perp = Math.abs(dx * -bz + dz * bx);
              if (along >= 0.4 && along <= AWAKENING_CONFIG.PRIME_FISSURE_BRANCH_LENGTH && perp <= 2.3) {
                const calc = helpers.computeDynamicDamage(actor, t, ab.damage * 0.65, 3);
                if (helpers.applyHit(room, actor, t, calc.dmg, 24, 9.0, bx, bz, 0xf97316, true)) {
                  actor.landedCurrentAction = true;
                }
              }
            }
          },
        });
      });
      return;
    }
    if (slot === 4) {
      // Empowered Avalanche: massive molten crater slam
      const safe = resolveObstacleCollisions(room.mapId, aimPt.x, actor.y, aimPt.z, 0.48, room.obstacles);
      actor.x = safe.x;
      actor.z = safe.z;
      helpers.damageObstaclesInArea(room, safe.x, safe.z, ab.range, ab.damage * 1.7, color);
      helpers.pushEvent(room, {
        kind: 'shockwave',
        attackerId: actor.playerId,
        fighterId: 'prime',
        x: safe.x,
        y: 0.25,
        z: safe.z,
        radius: ab.range,
        colorHex: color,
        abilitySlot: 4,
        hitStopMs: 90,
        callout: 'EMPOWERED AVALANCHE!',
      });
      for (const t of room.actors) {
        if (t.playerId === actor.playerId || t.isKO) continue;
        const d = Math.hypot(t.x - safe.x, t.z - safe.z);
        if (d <= ab.range) {
          const calc = helpers.computeDynamicDamage(actor, t, ab.damage, 4);
          if (helpers.applyHit(room, actor, t, calc.dmg, ab.staggerDamage, ab.knockback, d > 0.05 ? (t.x - safe.x) / d : fx, d > 0.05 ? (t.z - safe.z) / d : fz, color, true, false, true, calc.isCrit, calc.isBackstab)) {
            actor.landedCurrentAction = true;
          }
        }
      }
      return;
    }
    if (slot === 6) {
      // Hundred-Fist Meteor Barrage: rapid cone punches + devastating final haymaker
      [0, 0.14, 0.28].forEach((delay, idx) => {
        const isFinal = idx === 2;
        room.awakeningDelayedHits.push({
          remaining: delay,
          run: () => {
            const pfx = Math.sin(actor.rotY);
            const pfz = Math.cos(actor.rotY);
            helpers.damageObstaclesInArea(room, actor.x + pfx * 3.5, actor.z + pfz * 3.5, 5.2, isFinal ? 95 : 30, color);
            helpers.pushEvent(room, {
              kind: 'shockwave',
              attackerId: actor.playerId,
              fighterId: 'prime',
              x: actor.x + pfx * (isFinal ? 2.8 : 2.0),
              y: actor.y + 1.0,
              z: actor.z + pfz * (isFinal ? 2.8 : 2.0),
              dirX: pfx,
              dirZ: pfz,
              radius: isFinal ? 5.6 : 3.6,
              colorHex: isFinal ? 0xfef08a : color,
              abilitySlot: 6,
              hitStopMs: isFinal ? 95 : 25,
              callout: isFinal ? 'ASURA HAYMAKER!' : undefined,
            });
            for (const t of room.actors) {
              if (t.playerId === actor.playerId || t.isKO) continue;
              const dx = t.x - actor.x;
              const dz = t.z - actor.z;
              const d = Math.hypot(dx, dz);
              if (d <= ab.range && (d < 1.2 || (dx / d) * pfx + (dz / d) * pfz >= ab.arcCos)) {
                const baseD = isFinal ? ab.damage * 0.52 : ab.damage * 0.25;
                const calc = helpers.computeDynamicDamage(actor, t, baseD, 6);
                if (helpers.applyHit(room, actor, t, calc.dmg, isFinal ? 40 : 14, isFinal ? ab.knockback : 3.2, pfx, pfz, color, isFinal, false, isFinal, calc.isCrit, calc.isBackstab)) {
                  actor.landedCurrentAction = true;
                }
              }
            }
          },
        });
      });
      return;
    }
  }

  // ====================== 3. DAMEN (High Noon Arsenal) ======================
  if (actor.fighterId === 'damen') {
    if (slot === 0) {
      // Akimbo Sun-Fire: twin fast golden tracers with slight aim-assist
      const tgt = helpers.findNearestTarget(room, actor, ab.range);
      let baseYaw = actor.rotY;
      if (tgt) {
        const ang = Math.atan2(tgt.x - actor.x, tgt.z - actor.z);
        const diff = Math.atan2(Math.sin(ang - baseYaw), Math.cos(ang - baseYaw));
        if (Math.abs(diff) <= 0.45) {
          baseYaw = ang;
          actor.rotY = ang;
        }
      }
      for (const spread of [-0.06, 0.06]) {
        const ang = baseYaw + spread;
        room.projectiles.push({
          id: helpers.makeId('proj'),
          ownerId: actor.playerId,
          fighterId: 'damen',
          kind: 'magnum',
          x: actor.x + Math.sin(ang) * 0.85,
          y: actor.y + 1.15,
          z: actor.z + Math.cos(ang) * 0.85,
          vx: Math.sin(ang) * AWAKENING_CONFIG.DAMEN_TRACER_SPEED,
          vz: Math.cos(ang) * AWAKENING_CONFIG.DAMEN_TRACER_SPEED,
          rotY: ang,
          colorHex: 0xfef08a,
          originX: actor.x,
          originY: actor.y + 1.15,
          originZ: actor.z,
          isOverdrive: true,
          age: 0,
          maxAge: 0.56,
          maxRange: AWAKENING_CONFIG.DAMEN_TRACER_RANGE,
          damage: ab.damage,
          staggerDamage: ab.staggerDamage,
          knockback: ab.knockback,
          hitIds: new Set(),
        });
      }
      actor.landedCurrentAction = true;
      return;
    }
    if (slot === 2) {
      // Phantom Gun-Kata Roll: 360° ring of piercing golden shots
      const count = AWAKENING_CONFIG.DAMEN_ROLL_RING_SHOTS;
      for (let i = 0; i < count; i++) {
        const ang = actor.rotY + (i / count) * Math.PI * 2;
        room.projectiles.push({
          id: helpers.makeId('proj'),
          ownerId: actor.playerId,
          fighterId: 'damen',
          kind: 'magnum',
          x: actor.x + Math.sin(ang) * 0.8,
          y: actor.y + 1.1,
          z: actor.z + Math.cos(ang) * 0.8,
          vx: Math.sin(ang) * 28.0,
          vz: Math.cos(ang) * 28.0,
          rotY: ang,
          colorHex: 0xfef08a,
          originX: actor.x,
          originY: actor.y + 1.1,
          originZ: actor.z,
          isOverdrive: true,
          age: 0,
          maxAge: 0.45,
          maxRange: 11.5,
          damage: ab.damage,
          staggerDamage: ab.staggerDamage,
          knockback: ab.knockback,
          hitIds: new Set(),
        });
      }
      helpers.pushEvent(room, {
        kind: 'shockwave',
        attackerId: actor.playerId,
        fighterId: 'damen',
        x: actor.x,
        y: actor.y + 0.9,
        z: actor.z,
        colorHex: 0xfacc15,
        abilitySlot: 2,
        callout: 'GUN-KATA RING!',
      });
      actor.landedCurrentAction = true;
      return;
    }
    if (slot === 3) {
      // Constellation Snare: 3 wide solar chains pull foes together & mark for bonus gunshot DMG
      for (const spread of [-0.26, 0, 0.26]) {
        const ang = actor.rotY + spread;
        room.projectiles.push({
          id: helpers.makeId('proj'),
          ownerId: actor.playerId,
          fighterId: 'damen',
          kind: 'lasso',
          x: actor.x + Math.sin(ang) * 0.9,
          y: actor.y + 1.05,
          z: actor.z + Math.cos(ang) * 0.9,
          vx: Math.sin(ang) * 32.0,
          vz: Math.cos(ang) * 32.0,
          rotY: ang,
          colorHex: 0xfacc15,
          originX: actor.x,
          originY: actor.y + 1.05,
          originZ: actor.z,
          isOverdrive: true,
          age: 0,
          maxAge: 0.52,
          maxRange: 15.0,
          damage: ab.damage,
          staggerDamage: ab.staggerDamage,
          knockback: ab.knockback,
          hitIds: new Set(),
        });
      }
      return;
    }
    if (slot === 4) {
      // Empowered High Noon: 9-shot instant golden spread
      for (const spread of [-0.48, -0.36, -0.24, -0.12, 0, 0.12, 0.24, 0.36, 0.48]) {
        const ang = actor.rotY + spread;
        room.projectiles.push({
          id: helpers.makeId('proj'),
          ownerId: actor.playerId,
          fighterId: 'damen',
          kind: 'magnum',
          x: actor.x + Math.sin(ang) * 0.9,
          y: actor.y + 1.15,
          z: actor.z + Math.cos(ang) * 0.9,
          vx: Math.sin(ang) * 33.0,
          vz: Math.cos(ang) * 33.0,
          rotY: ang,
          colorHex: 0xfef08a,
          originX: actor.x,
          originY: actor.y + 1.15,
          originZ: actor.z,
          isOverdrive: true,
          age: 0,
          maxAge: 0.62,
          maxRange: 16.5,
          damage: ab.damage,
          staggerDamage: ab.staggerDamage,
          knockback: ab.knockback,
          hitIds: new Set(),
        });
      }
      helpers.pushEvent(room, {
        kind: 'shockwave',
        attackerId: actor.playerId,
        fighterId: 'damen',
        x: actor.x,
        y: actor.y + 0.3,
        z: actor.z,
        dirX: fx,
        dirZ: fz,
        colorHex: 0xfacc15,
        abilitySlot: 4,
        callout: 'HIGH NOON OVERDRIVE!',
      });
      actor.landedCurrentAction = true;
      return;
    }
    if (slot === 6) {
      // Infinite Arsenal: Bullet Hell — semi-circle of spectral golden guns firing piercing railguns!
      const spreads = [-0.42, -0.28, -0.14, 0, 0.14, 0.28, 0.42];
      spreads.forEach((spread, idx) => {
        const ang = actor.rotY + spread;
        room.projectiles.push({
          id: helpers.makeId('proj'),
          ownerId: actor.playerId,
          fighterId: 'damen',
          kind: 'solarRailgun',
          x: actor.x + Math.sin(ang) * 1.1 - fx * (0.4 + Math.abs(idx - 3) * 0.2),
          y: actor.y + 1.3 + (idx % 2) * 0.35,
          z: actor.z + Math.cos(ang) * 1.1 - fz * (0.4 + Math.abs(idx - 3) * 0.2),
          vx: Math.sin(ang) * 42.0,
          vz: Math.cos(ang) * 42.0,
          rotY: ang,
          colorHex: 0xfef08a,
          originX: actor.x,
          originY: actor.y + 1.3,
          originZ: actor.z,
          isOverdrive: true,
          pierceObstacles: true,
          age: 0,
          maxAge: 0.58,
          maxRange: AWAKENING_CONFIG.DAMEN_RAILGUN_RANGE,
          damage: Math.round(ab.damage * 0.48),
          staggerDamage: 24,
          knockback: ab.knockback,
          hitIds: new Set(),
        });
      });
      helpers.pushEvent(room, {
        kind: 'beam',
        attackerId: actor.playerId,
        fighterId: 'damen',
        x: actor.x + fx * 1.2,
        y: actor.y + 1.25,
        z: actor.z + fz * 1.2,
        dirX: fx,
        dirZ: fz,
        colorHex: 0xfacc15,
        abilitySlot: 6,
        hitStopMs: 85,
        callout: 'INFINITE ARSENAL: BULLET HELL!',
      });
      actor.landedCurrentAction = true;
      return;
    }
  }

  // ====================== 4. KHEN (Eclipse Phantom Monarch) ======================
  if (actor.fighterId === 'khen') {
    if (slot === 0) {
      // Mirage 4-Hit Blitz: immediate dagger strike + shadow clone repeats strike 0.15s later!
      const is4th = actor.comboStep === 4;
      const sx = actor.x + fx * 1.1;
      const sz = actor.z + fz * 1.1;
      helpers.damageObstaclesInArea(room, sx, sz, 3.0, 18, color);
      for (const t of room.actors) {
        if (t.playerId === actor.playerId || t.isKO) continue;
        const dx = t.x - actor.x;
        const dz = t.z - actor.z;
        const d = Math.hypot(dx, dz);
        if (d <= ab.range && Math.abs(t.y - actor.y) <= 2.4) {
          const calc = helpers.computeDynamicDamage(actor, t, ab.damage + (is4th ? 5 : 0), 0);
          if (helpers.applyHit(room, actor, t, calc.dmg, ab.staggerDamage, ab.knockback, d > 0.05 ? dx / d : fx, d > 0.05 ? dz / d : fz, color, is4th, false, false, calc.isCrit, calc.isBackstab)) {
            actor.landedCurrentAction = true;
            actor.mana = clamp(actor.mana + 14, 0, actor.maxMana);
          }
        }
      }
      // Schedule 0.15s Mirage Clone Echo
      room.awakeningDelayedHits.push({
        remaining: AWAKENING_CONFIG.KHEN_MIRAGE_ECHO_DELAY_SEC,
        run: () => {
          helpers.pushEvent(room, {
            kind: 'shockwave',
            attackerId: actor.playerId,
            fighterId: 'khen',
            x: sx,
            y: actor.y + 0.9,
            z: sz,
            dirX: fx,
            dirZ: fz,
            radius: 2.8,
            colorHex: 0xc084fc,
            abilitySlot: 0,
          });
          for (const t of room.actors) {
            if (t.playerId === actor.playerId || t.isKO) continue;
            if (Math.hypot(t.x - sx, t.z - sz) <= 3.0 && Math.abs(t.y - actor.y) <= 2.4) {
              helpers.applyHit(room, actor, t, Math.round(ab.damage * 0.55), 8, 2.5, fx, fz, 0xc084fc, false);
            }
          }
        },
      });
      return;
    }
    if (slot === 2) {
      // Zero-Point Blink: high-speed blink slicing enemies & leaving delayed-detonation Shadow Rift
      const ox = actor.x;
      const oz = actor.z;
      helpers.spawnZone(room, actor, 'shadowRift', ox, 0, oz, 3.6, AWAKENING_CONFIG.KHEN_SHADOW_RIFT_DURATION, color);
      const safe = resolveObstacleCollisions(room.mapId, aimPt.x, actor.y, aimPt.z, 0.48, room.obstacles);
      actor.x = safe.x;
      actor.z = safe.z;
      helpers.damageObstaclesInArea(room, safe.x, safe.z, 3.8, ab.damage * 1.4, color);
      helpers.pushEvent(room, {
        kind: 'shockwave',
        attackerId: actor.playerId,
        fighterId: 'khen',
        x: safe.x,
        y: actor.y + 0.9,
        z: safe.z,
        originX: ox,
        originY: actor.y + 0.9,
        originZ: oz,
        dirX: fx,
        dirZ: fz,
        colorHex: color,
        abilitySlot: 2,
        callout: 'ZERO-POINT BLINK!',
      });
      for (const t of room.actors) {
        if (t.playerId === actor.playerId || t.isKO) continue;
        const d = Math.hypot(t.x - safe.x, t.z - safe.z);
        if (d <= 3.8) {
          const calc = helpers.computeDynamicDamage(actor, t, ab.damage, 2);
          if (helpers.applyHit(room, actor, t, calc.dmg, ab.staggerDamage, ab.knockback, fx, fz, color, true)) {
            actor.landedCurrentAction = true;
          }
        }
      }
      return;
    }
    if (slot === 3) {
      // Abyssal Cross-Slash: wide X void waves that silence enemy skills for 1.5s!
      for (const off of [-0.18, 0.18]) {
        const ang = actor.rotY + off;
        room.projectiles.push({
          id: helpers.makeId('proj'),
          ownerId: actor.playerId,
          fighterId: 'khen',
          kind: 'crescent',
          x: actor.x + Math.sin(ang) * 0.95,
          y: actor.y + 1.15,
          z: actor.z + Math.cos(ang) * 0.95,
          vx: Math.sin(ang) * 26.0,
          vz: Math.cos(ang) * 26.0,
          rotY: ang,
          colorHex: color,
          originX: actor.x,
          originY: actor.y + 1.15,
          originZ: actor.z,
          isComboLink: true,
          isOverdrive: true,
          age: 0,
          maxAge: 0.62,
          maxRange: 15.0,
          damage: ab.damage * 0.72,
          staggerDamage: ab.staggerDamage,
          knockback: ab.knockback,
          hitIds: new Set(),
        });
      }
      helpers.pushEvent(room, {
        kind: 'silence',
        attackerId: actor.playerId,
        fighterId: 'khen',
        x: actor.x + fx * 1.4,
        y: actor.y + 1.0,
        z: actor.z + fz * 1.4,
        dirX: fx,
        dirZ: fz,
        colorHex: color,
        abilitySlot: 3,
        callout: 'ABYSSAL CROSS-SLASH!',
      });
      return;
    }
    if (slot === 4) {
      // Empowered Phantom Blitz: wider X-corridor, resets Dash cooldown on hit!
      const ox = actor.x;
      const oz = actor.z;
      let anyHit = false;
      for (const t of room.actors) {
        if (t.playerId === actor.playerId || t.isKO) continue;
        const dx = t.x - ox;
        const dz = t.z - oz;
        const along = dx * fx + dz * fz;
        const perp = Math.abs(dx * -fz + dz * fx);
        if (along > -0.6 && along <= 11.5 && perp <= 3.0) {
          const calc = helpers.computeDynamicDamage(actor, t, ab.damage, 4);
          if (helpers.applyHit(room, actor, t, calc.dmg, ab.staggerDamage, ab.knockback, fx, fz, color, true, false, true, calc.isCrit, calc.isBackstab)) {
            anyHit = true;
            actor.landedCurrentAction = true;
          }
        }
      }
      if (anyHit) {
        actor.dashCooldown = 0;
      }
      const safe = resolveObstacleCollisions(room.mapId, actor.x + fx * 8.5, actor.y, actor.z + fz * 8.5, 0.48, room.obstacles);
      actor.x = safe.x;
      actor.z = safe.z;
      helpers.damageObstaclesInArea(room, ox + fx * 5.0, oz + fz * 5.0, 5.5, 65, color);
      helpers.pushEvent(room, {
        kind: 'shockwave',
        attackerId: actor.playerId,
        fighterId: 'khen',
        x: ox + fx * 5.0,
        y: actor.y + 0.5,
        z: oz + fz * 5.0,
        originX: ox,
        originY: actor.y + 1.0,
        originZ: oz,
        dirX: fx,
        dirZ: fz,
        colorHex: color,
        abilitySlot: 4,
        callout: anyHit ? 'BLITZ — DASH RESET!' : 'EMPOWERED PHANTOM BLITZ!',
      });
      return;
    }
    if (slot === 6) {
      // Thousand-Shadow Omnislash: untargetable clone slices across wide zone then detonates center!
      const cx = aimPt.x;
      const cz = aimPt.z;
      const rad = AWAKENING_CONFIG.KHEN_OMNISLASH_RADIUS;
      helpers.pushEvent(room, {
        kind: 'omnislash',
        attackerId: actor.playerId,
        fighterId: 'khen',
        x: cx,
        y: 1.0,
        z: cz,
        radius: rad,
        colorHex: 0xa855f7,
        abilitySlot: 6,
        hitStopMs: 85,
        callout: 'THOUSAND-SHADOW OMNISLASH!',
      });
      [0, 0.16, 0.34].forEach((delay, idx) => {
        const isDetonation = idx === 2;
        room.awakeningDelayedHits.push({
          remaining: delay,
          run: () => {
            helpers.damageObstaclesInArea(room, cx, cz, rad, isDetonation ? 105 : 28, color);
            helpers.pushEvent(room, {
              kind: 'shockwave',
              attackerId: actor.playerId,
              fighterId: 'khen',
              x: cx,
              y: 0.4,
              z: cz,
              radius: isDetonation ? rad : rad * 0.65,
              colorHex: isDetonation ? 0xe879f9 : color,
              abilitySlot: 6,
              hitStopMs: isDetonation ? 100 : 20,
            });
            for (const t of room.actors) {
              if (t.playerId === actor.playerId || t.isKO) continue;
              const d = Math.hypot(t.x - cx, t.z - cz);
              if (d <= rad) {
                const dmg = isDetonation ? ab.damage * 0.52 : ab.damage * 0.25;
                const calc = helpers.computeDynamicDamage(actor, t, dmg, 6);
                if (helpers.applyHit(room, actor, t, calc.dmg, isDetonation ? 40 : 12, isDetonation ? ab.knockback : -4.5, d > 0.05 ? (t.x - cx) / d : fx, d > 0.05 ? (t.z - cz) / d : fz, color, isDetonation, !isDetonation, isDetonation, calc.isCrit, calc.isBackstab)) {
                  actor.landedCurrentAction = true;
                }
              }
            }
            if (isDetonation) {
              const safe = resolveObstacleCollisions(room.mapId, cx, actor.y, cz, 0.48, room.obstacles);
              actor.x = safe.x;
              actor.z = safe.z;
            }
          },
        });
      });
      return;
    }
  }

  // ====================== 5. JM (Celestial Dragon Ascendant) ======================
  if (actor.fighterId === 'jm') {
    if (slot === 0) {
      // Ascendant 4-Hit: golden waves on every hit, twin rapid bolts when flying
      if (actor.isFlying) {
        for (const off of [-0.08, 0.08]) {
          const ang = actor.rotY + off;
          room.projectiles.push({
            id: helpers.makeId('proj'),
            ownerId: actor.playerId,
            fighterId: 'jm',
            kind: 'jmBolt',
            x: actor.x + Math.sin(ang) * 0.9,
            y: actor.y + 1.15,
            z: actor.z + Math.cos(ang) * 0.9,
            vx: Math.sin(ang) * 26.0,
            vy: -4.2,
            vz: Math.cos(ang) * 26.0,
            rotY: ang,
            colorHex: 0xfef08a,
            originX: actor.x,
            originY: actor.y + 1.15,
            originZ: actor.z,
            isOverdrive: true,
            age: 0,
            maxAge: 0.78,
            maxRange: 19.0,
            damage: ab.damage * 0.65,
            staggerDamage: 14,
            knockback: 4.5,
            hitIds: new Set(),
          });
        }
        actor.landedCurrentAction = true;
        return;
      }

      const isFinisher = actor.comboStep === 4;
      room.projectiles.push({
        id: helpers.makeId('proj'),
        ownerId: actor.playerId,
        fighterId: 'jm',
        kind: 'jmBeam',
        x: actor.x + fx * 1.0,
        y: actor.y + 1.15,
        z: actor.z + fz * 1.0,
        vx: fx * AWAKENING_CONFIG.JM_WAVE_SPEED,
        vz: fz * AWAKENING_CONFIG.JM_WAVE_SPEED,
        rotY: actor.rotY,
        colorHex: 0xfef08a,
        originX: actor.x,
        originY: actor.y + 1.15,
        originZ: actor.z,
        isOverdrive: true,
        age: 0,
        maxAge: 0.34,
        maxRange: isFinisher ? 8.5 : 5.8,
        damage: ab.damage + (isFinisher ? 5 : 0),
        staggerDamage: ab.staggerDamage,
        knockback: isFinisher ? ab.knockback * 1.8 : ab.knockback,
        hitIds: new Set(),
      });
      actor.landedCurrentAction = true;
      return;
    }
    if (slot === 2) {
      // Instant Transmission Palm: teleport directly behind nearest/targeted enemy + point-blank shockwave
      const tgt = helpers.findPreferredTarget(room, actor, 18.0);
      if (tgt) {
        const tFwdX = Math.sin(tgt.rotY);
        const tFwdZ = Math.cos(tgt.rotY);
        const bx = tgt.x - tFwdX * 1.45;
        const bz = tgt.z - tFwdZ * 1.45;
        const safe = resolveObstacleCollisions(room.mapId, bx, tgt.y, bz, 0.48, room.obstacles);
        actor.x = safe.x;
        actor.z = safe.z;
        actor.y = tgt.y;
        actor.rotY = Math.atan2(tgt.x - actor.x, tgt.z - actor.z);
      } else {
        const safe = resolveObstacleCollisions(room.mapId, aimPt.x, actor.y, aimPt.z, 0.48, room.obstacles);
        actor.x = safe.x;
        actor.z = safe.z;
      }
      const pfx = Math.sin(actor.rotY);
      const pfz = Math.cos(actor.rotY);
      helpers.pushEvent(room, {
        kind: 'shockwave',
        attackerId: actor.playerId,
        fighterId: 'jm',
        x: actor.x + pfx * 1.0,
        y: actor.y + 1.0,
        z: actor.z + pfz * 1.0,
        radius: 4.0,
        colorHex: 0xfef08a,
        abilitySlot: 2,
        hitStopMs: 60,
        callout: 'INSTANT TRANSMISSION!',
      });
      for (const t of room.actors) {
        if (t.playerId === actor.playerId || t.isKO) continue;
        const d = Math.hypot(t.x - actor.x, t.z - actor.z);
        if (d <= 4.0) {
          const calc = helpers.computeDynamicDamage(actor, t, ab.damage, 2);
          if (helpers.applyHit(room, actor, t, calc.dmg, ab.staggerDamage, ab.knockback, pfx, pfz, 0xfef08a, true, false, false, true, true)) {
            actor.landedCurrentAction = true;
          }
        }
      }
      return;
    }
    if (slot === 3) {
      // Divine Sanctuary Nova: radiant pillar blasting rushers outward + restoring burst of Chi
      const rad = AWAKENING_CONFIG.JM_DIVINE_NOVA_RADIUS;
      actor.mana = clamp(actor.mana + AWAKENING_CONFIG.JM_DIVINE_NOVA_CHI_GAIN, 0, actor.maxMana);
      helpers.spawnZone(room, actor, 'divineNova', actor.x, 0, actor.z, rad, 2.4, 0xfef08a);
      helpers.damageObstaclesInArea(room, actor.x, actor.z, rad, 45, 0xfef08a);
      helpers.pushEvent(room, {
        kind: 'shockwave',
        attackerId: actor.playerId,
        fighterId: 'jm',
        x: actor.x,
        y: actor.y + 0.25,
        z: actor.z,
        radius: rad,
        colorHex: 0xfef08a,
        abilitySlot: 3,
        hitStopMs: 65,
        callout: 'DIVINE SANCTUARY NOVA!',
      });
      for (const t of room.actors) {
        if (t.playerId === actor.playerId || t.isKO) continue;
        const d = Math.hypot(t.x - actor.x, t.z - actor.z);
        if (d <= rad) {
          const calc = helpers.computeDynamicDamage(actor, t, ab.damage, 3);
          if (helpers.applyHit(room, actor, t, calc.dmg, ab.staggerDamage, ab.knockback, d > 0.05 ? (t.x - actor.x) / d : fx, d > 0.05 ? (t.z - actor.z) / d : fz, 0xfef08a, true)) {
            actor.landedCurrentAction = true;
          }
        }
      }
      return;
    }
    if (slot === 4) {
      // Empowered Solar Dragon Beam
      helpers.pushEvent(room, {
        kind: 'beam',
        attackerId: actor.playerId,
        fighterId: 'jm',
        x: actor.x + fx * 1.1,
        y: actor.y + 1.25,
        z: actor.z + fz * 1.1,
        dirX: fx,
        dirZ: fz,
        colorHex: 0xfef08a,
        hitStopMs: 95,
        abilitySlot: 4,
        callout: 'SOLAR DRAGON BEAM+',
      });
      for (const t of room.actors) {
        if (t.playerId === actor.playerId || t.isKO) continue;
        const dx = t.x - actor.x;
        const dz = t.z - actor.z;
        const along = dx * fx + dz * fz;
        const perp = Math.abs(dx * -fz + dz * fx);
        if (along > 0 && along <= ab.range && perp <= 2.9 && Math.abs(t.y - actor.y) <= (actor.isFlying ? 9.5 : 3.2)) {
          const calc = helpers.computeDynamicDamage(actor, t, ab.damage, 4);
          if (helpers.applyHit(room, actor, t, calc.dmg, ab.staggerDamage, ab.knockback, fx, fz, 0xfef08a, true, false, true, calc.isCrit, calc.isBackstab)) {
            actor.landedCurrentAction = true;
          }
        }
      }
      return;
    }
    if (slot === 6) {
      // Super Kamehameha: Sovereign Roar — colossal golden-blue beam crossing arena & vaporizing buildings!
      helpers.pushEvent(room, {
        kind: 'beam',
        attackerId: actor.playerId,
        fighterId: 'jm',
        x: actor.x + fx * 1.2,
        y: actor.y + 1.3,
        z: actor.z + fz * 1.2,
        dirX: fx,
        dirZ: fz,
        radius: AWAKENING_CONFIG.JM_KAMEHAMEHA_WIDTH,
        colorHex: 0x38bdf8,
        hitStopMs: 110,
        abilitySlot: 6,
        callout: 'SUPER KAMEHAMEHA: SOVEREIGN ROAR!',
      });
      // Vaporize any destructible building along beam corridor!
      for (const obs of room.obstacles) {
        if (obs.destroyed || !obs.destructible) continue;
        const dx = obs.x - actor.x;
        const dz = obs.z - actor.z;
        const along = dx * fx + dz * fz;
        const perp = Math.abs(dx * -fz + dz * fx);
        if (along > -1.0 && along <= AWAKENING_CONFIG.JM_KAMEHAMEHA_RANGE && perp <= AWAKENING_CONFIG.JM_KAMEHAMEHA_WIDTH + Math.max(obs.halfW, obs.halfD)) {
          helpers.damageObstacle(room, obs, 999, obs.x, obs.topY * 0.5, obs.z, 0xfef08a);
        }
      }
      for (const t of room.actors) {
        if (t.playerId === actor.playerId || t.isKO) continue;
        const dx = t.x - actor.x;
        const dz = t.z - actor.z;
        const along = dx * fx + dz * fz;
        const perp = Math.abs(dx * -fz + dz * fx);
        if (along > 0 && along <= AWAKENING_CONFIG.JM_KAMEHAMEHA_RANGE && perp <= AWAKENING_CONFIG.JM_KAMEHAMEHA_WIDTH) {
          const calc = helpers.computeDynamicDamage(actor, t, ab.damage, 6);
          if (helpers.applyHit(room, actor, t, calc.dmg, ab.staggerDamage, ab.knockback, fx, fz, 0x38bdf8, true, false, true, true, calc.isBackstab)) {
            actor.landedCurrentAction = true;
          }
        }
      }
      return;
    }
  }
}

export function tickAwakenedZoneBehavior(
  room: AwakeningRoomState,
  z: AwakeningRoomState['zones'][number],
  owner: AwakeningActor,
  dt: number,
  helpers: AwakeningHostHelpers
): void {
  if (z.kind === 'maelstromTornado') {
    for (const target of room.actors) {
      if (target.playerId === z.ownerId || target.isKO) continue;
      const dx = z.x - target.x;
      const dz = z.z - target.z;
      const d = Math.hypot(dx, dz);
      if (d <= z.radius && d > 0.25) {
        target.vx += (dx / d) * AWAKENING_CONFIG.MARJOHN_MAELSTROM_PULL * dt;
        target.vz += (dz / d) * AWAKENING_CONFIG.MARJOHN_MAELSTROM_PULL * dt;
      }
    }
    if (z.tickTimer >= 0.45) {
      z.tickTimer = 0;
      for (const target of room.actors) {
        if (target.playerId === z.ownerId || target.isKO) continue;
        if (Math.hypot(target.x - z.x, target.z - z.z) <= z.radius) {
          helpers.applyHit(room, owner, target, 4, 8, 2.0, 0, 0, z.colorHex, false, true);
        }
      }
    }
    if (z.remaining <= dt * 1.5 && !z.triggered) {
      z.triggered = true;
      for (const target of room.actors) {
        if (target.playerId === z.ownerId || target.isKO) continue;
        if (Math.hypot(target.x - z.x, target.z - z.z) <= z.radius) {
          helpers.applyHit(room, owner, target, 12, 22, 6.0, 0, 1, z.colorHex, true);
          target.yVel = Math.max(target.yVel, 8.8);
          target.grounded = false;
        }
      }
    }
  } else if (z.kind === 'shadowRift' && !z.triggered && z.remaining <= 0.25) {
    z.triggered = true;
    helpers.pushEvent(room, {
      kind: 'shockwave',
      attackerId: owner.playerId,
      fighterId: 'khen',
      x: z.x,
      y: 0.3,
      z: z.z,
      radius: z.radius,
      colorHex: 0xa855f7,
    });
    for (const target of room.actors) {
      if (target.playerId === z.ownerId || target.isKO) continue;
      const d = Math.hypot(target.x - z.x, target.z - z.z);
      if (d <= z.radius) {
        helpers.applyHit(room, owner, target, 14, 24, 7.5, d > 0.05 ? (target.x - z.x) / d : 0, d > 0.05 ? (target.z - z.z) / d : 1, 0xa855f7, true);
      }
    }
  } else if (z.kind === 'magmaBranch') {
    if (z.tickTimer >= 0.48) {
      z.tickTimer = 0;
      for (const target of room.actors) {
        if (target.playerId === z.ownerId || target.isKO) continue;
        if (Math.hypot(target.x - z.x, target.z - z.z) <= z.radius) {
          helpers.applyHit(room, owner, target, 4, 8, 1.5, 0, 0, 0xf97316, false);
        }
      }
    }
  } else if (z.kind === 'divineNova') {
    if (Math.hypot(owner.x - z.x, owner.z - z.z) <= z.radius && !owner.isKO) {
      owner.hp = Math.min(owner.maxHp, owner.hp + 7.5 * dt);
    }
  }
}
