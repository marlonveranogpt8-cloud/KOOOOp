import type { MapId, MapObstacle } from '../shared/gameData.ts';

/**
 * Frame-rate independent exponential damping toward target.
 */
export function dampScalar(current: number, target: number, lambda: number, dt: number): number {
  const safeDt = Math.max(0, Math.min(dt, 0.1));
  if (lambda <= 0) return current;
  return current + (target - current) * (1 - Math.exp(-lambda * safeDt));
}

/**
 * Frame-rate independent shortest-arc angular damping (radians).
 */
export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  const safeDt = Math.max(0, Math.min(dt, 0.1));
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (lambda <= 0) return current;
  return current + diff * (1 - Math.exp(-lambda * safeDt));
}

/**
 * Computes ground contact shadow scale and opacity based on actor elevation above ground.
 */
export function computeContactShadowTransform(heightAboveGround: number): {
  scale: number;
  opacity: number;
} {
  const h = Math.max(0, heightAboveGround);
  const scale = Math.max(0.42, 1.0 - h * 0.085);
  const opacity = Math.max(0.14, 0.44 * (1.0 - Math.min(1, h * 0.14)));
  return { scale, opacity };
}

/**
 * Advances local actionTimer smoothly between 25Hz server snapshots so swings,
 * dashes, and skill animations progress smoothly at 60-144Hz.
 */
export function advanceActionTimer(
  actionState: string,
  actionTimer: number,
  dt: number
): number {
  if (actionTimer <= 0) return 0;
  if (
    actionState === 'idle' ||
    actionState === 'move' ||
    actionState === 'jump' ||
    actionState === 'guard'
  ) {
    return actionTimer;
  }
  return Math.max(0, actionTimer - Math.max(0, Math.min(dt, 0.05)));
}

/**
 * Computes smooth dual-frequency harmonic trauma-squared camera shake offsets.
 */
export function computeTraumaShake(
  trauma: number,
  elapsedSec: number
): { x: number; y: number; z: number; roll: number } {
  const t = Math.max(0, Math.min(1.2, trauma));
  if (t <= 0.001) return { x: 0, y: 0, z: 0, roll: 0 };
  const mag = t * t;
  const w1 = elapsedSec * 41.0;
  const w2 = elapsedSec * 57.0;
  return {
    x: (Math.sin(w1) * 0.65 + Math.cos(w2 * 0.77) * 0.35) * mag * 0.48,
    y: (Math.cos(w1 * 1.13) * 0.6 + Math.sin(w2) * 0.4) * mag * 0.36,
    z: (Math.sin(w2 * 0.91) * 0.7 + Math.cos(w1 * 0.63) * 0.3) * mag * 0.42,
    roll: Math.sin(w1 * 0.85) * mag * 0.032,
  };
}

/**
 * Computes horizontal pull-in fraction [0.25, 1.0] along the ray from lookTarget to camPos
 * against arena AABB obstacles so the camera smoothly glides clear of pillars/walls.
 */
export function computeObstacleCameraPullIn(
  lookX: number,
  lookY: number,
  lookZ: number,
  destX: number,
  destY: number,
  destZ: number,
  obstacles: MapObstacle[],
  mapId: MapId,
  getTerrainHeight: (mapId: MapId, x: number, z: number) => number
): number {
  let minT = 1.0;
  const dx = destX - lookX;
  const dy = destY - lookY;
  const dz = destZ - lookZ;

  for (const obs of obstacles) {
    const pad = 0.55;
    const minX = obs.x - (obs.halfW + pad);
    const maxX = obs.x + (obs.halfW + pad);
    const minZ = obs.z - (obs.halfD + pad);
    const maxZ = obs.z + (obs.halfD + pad);
    const baseY = getTerrainHeight(mapId, obs.x, obs.z);
    const minY = baseY - 0.5;
    const maxY = baseY + obs.topY + pad;

    let tEnter = 0.0;
    let tExit = 1.0;

    if (Math.abs(dx) < 1e-6) {
      if (lookX < minX || lookX > maxX) continue;
    } else {
      const tx1 = (minX - lookX) / dx;
      const tx2 = (maxX - lookX) / dx;
      tEnter = Math.max(tEnter, Math.min(tx1, tx2));
      tExit = Math.min(tExit, Math.max(tx1, tx2));
    }

    if (Math.abs(dy) < 1e-6) {
      if (lookY < minY || lookY > maxY) continue;
    } else {
      const ty1 = (minY - lookY) / dy;
      const ty2 = (maxY - lookY) / dy;
      tEnter = Math.max(tEnter, Math.min(ty1, ty2));
      tExit = Math.min(tExit, Math.max(ty1, ty2));
    }

    if (Math.abs(dz) < 1e-6) {
      if (lookZ < minZ || lookZ > maxZ) continue;
    } else {
      const tz1 = (minZ - lookZ) / dz;
      const tz2 = (maxZ - lookZ) / dz;
      tEnter = Math.max(tEnter, Math.min(tz1, tz2));
      tExit = Math.min(tExit, Math.max(tz1, tz2));
    }

    if (tEnter <= tExit && tEnter > 0.05 && tEnter < minT) {
      minT = Math.max(0.32, tEnter - 0.06);
    }
  }

  return minT;
}

export interface LockedCameraRig {
  camX: number;
  camY: number;
  camZ: number;
  lookX: number;
  lookY: number;
  lookZ: number;
  yaw: number;
  elevationDeg: number;
}

/**
 * Computes the MLBB-style angled isometric top-down MOBA camera tracking the player
 * while subtly biasing framing toward the center of the arena (0,0) and balancing
 * front/rear visibility with zero back-edge cutoff.
 */
export function computeLockedTopDownCamera(
  playerX: number,
  playerY: number,
  playerZ: number,
  isFlying = false,
  pitchRad = 1.01, // ~57.9 deg crisp angled MOBA pitch
  distance = 17.6,
  isPortrait = false
): LockedCameraRig {
  const effectiveDist = (isFlying ? distance + 2.8 : distance) + (isPortrait ? 3.4 : 0);
  const centerBias = isPortrait ? 0.16 : 0.24;
  const maxBiasX = isPortrait ? 2.6 : 6.0;
  const maxBiasZ = isPortrait ? 3.8 : 5.4;
  const rawOffsetX = -playerX * centerBias;
  const rawOffsetZ = -playerZ * centerBias;
  const biasOffsetX = Math.max(-maxBiasX, Math.min(maxBiasX, rawOffsetX));
  const biasOffsetZ = Math.max(-maxBiasZ, Math.min(maxBiasZ, rawOffsetZ));
  const rearFramingZ = isPortrait ? 1.15 : 0.95;

  const lookX = playerX + biasOffsetX;
  const lookY = playerY + 1.0;
  const lookZ = playerZ + biasOffsetZ + rearFramingZ;
  const horiz = Math.cos(pitchRad) * effectiveDist;
  const vert = Math.sin(pitchRad) * effectiveDist;
  return {
    camX: lookX,
    camY: lookY + vert,
    camZ: lookZ + horiz,
    lookX,
    lookY,
    lookZ,
    yaw: Math.PI,
    elevationDeg: (pitchRad * 180) / Math.PI,
  };
}

/**
 * Projects world (x, z) coordinates onto normalized [4..96]% coordinates for the top-left MOBA minimap.
 */
export function projectToMinimapPercent(
  x: number,
  z: number,
  arenaRadius: number
): { leftPct: number; topPct: number } {
  const safeR = Math.max(10, arenaRadius);
  const nx = Math.max(-1, Math.min(1, x / safeR));
  const nz = Math.max(-1, Math.min(1, z / safeR));
  return {
    leftPct: 50 + nx * 44,
    topPct: 50 + nz * 44,
  };
}

/**
 * Deliberate touch/cursor threshold before a skill or M1 press enters manual hold-drag aiming.
 * Ensures quick taps always trigger instant nearest-enemy auto-aim without accidental drags.
 */
export const SKILL_DRAG_DISTANCE_PX = 15;
export const SKILL_HOLD_TIME_MS = 160;

export function shouldEnterDragAim(dragDistancePx: number, holdElapsedMs: number): boolean {
  return dragDistancePx >= SKILL_DRAG_DISTANCE_PX || holdElapsedMs >= SKILL_HOLD_TIME_MS;
}

/**
 * Applies damage to a destructible map structure and reports whether it broke.
 */
export function applyObstacleDamage(
  currentHp: number,
  damage: number
): { hp: number; destroyed: boolean } {
  const nextHp = Math.max(0, Math.round(currentHp - Math.max(0, damage)));
  return {
    hp: nextHp,
    destroyed: nextHp <= 0,
  };
}

/**
 * Selects the nearest alive opponent within maxRange from a reference origin.
 */
export function selectNearestTarget<T extends { playerId: string; x: number; z: number; isKO?: boolean }>(
  originX: number,
  originZ: number,
  selfId: string,
  candidates: T[],
  maxRange: number
): T | null {
  let best: T | null = null;
  let bestDist = maxRange;
  for (const c of candidates) {
    if (c.playerId === selfId || c.isKO) continue;
    const d = Math.hypot(c.x - originX, c.z - originZ);
    if (d <= bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/**
 * Converts a normalized drag/swipe vector (screen-space right = +dx, screen-space up = -dy)
 * into a clamped world-space ground aim point relative to the player.
 */
export function computeSwipeAimPoint(
  playerX: number,
  playerZ: number,
  normDragX: number,
  normDragY: number,
  maxRange: number
): { x: number; z: number; yaw: number } {
  const mag = Math.hypot(normDragX, normDragY);
  if (mag < 0.05) {
    return { x: playerX, z: playerZ - maxRange * 0.65, yaw: Math.PI };
  }
  const nx = normDragX / mag;
  const nz = normDragY / mag; // screen down (+dy) maps to +Z; screen up (-dy) maps to -Z
  const clampedFrac = Math.min(1, mag);
  const dist = Math.max(2.0, clampedFrac * maxRange);
  const aimX = playerX + nx * dist;
  const aimZ = playerZ + nz * dist;
  return {
    x: aimX,
    z: aimZ,
    yaw: Math.atan2(nx, nz),
  };
}

/**
 * Computes Storm Zone active state and shrinking radius based on matchTime (triggers at 60s).
 */
export function computeStormRadiusAtTime(
  matchTime: number,
  maxRadius: number,
  isTrainingMode = false
): { active: boolean; radius: number } {
  if (isTrainingMode || matchTime < 60.0) {
    return { active: false, radius: maxRadius };
  }
  const elapsed = matchTime - 60.0;
  return {
    active: true,
    radius: Math.max(4.0, maxRadius - 0.85 * elapsed),
  };
}

/**
 * Sanitizes incoming room chat text: strips ASCII control characters, collapses
 * whitespace runs, trims, and caps length at 160 characters. Returns null if empty.
 */
export function sanitizeChatText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Computes the world-space forward direction vector of a Three.js CircleGeometry(1, seg, -theta, 2*theta)
 * after rotateX(-PI/2), rotateY(coneRotateYAfterX), and group rotation.y = castYaw.
 * At castYaw = 0 (forward = +Z), coneRotateYAfterX = -PI/2 yields { x: 0, z: 1 }.
 */
export function computeConeForwardVector(
  coneRotateYAfterX: number,
  castYaw: number
): { x: number; z: number } {
  // Circle center starts at +X (1, 0, 0). rotateX(-PI/2) keeps (1, 0, 0).
  // rotateY(a) sends (1, 0, 0) -> (cos(a), 0, -sin(a)).
  const lx = Math.cos(coneRotateYAfterX);
  const lz = -Math.sin(coneRotateYAfterX);
  // Group rotateY(castYaw) sends (lx, 0, lz) -> (lx*cos(yaw) + lz*sin(yaw), 0, -lx*sin(yaw) + lz*cos(yaw)).
  const c = Math.cos(castYaw);
  const s = Math.sin(castYaw);
  return {
    x: Number((lx * c + lz * s).toFixed(6)),
    z: Number((-lx * s + lz * c).toFixed(6)),
  };
}

/**
 * Maps server countdown remaining seconds (up to 5.0s) into integer 5..1 or 0 ('FIGHT!').
 */
export function computeCountdownStep(countdown: number): number {
  if (!Number.isFinite(countdown) || countdown <= 0) return 0;
  return Math.max(1, Math.min(5, Math.ceil(countdown)));
}



