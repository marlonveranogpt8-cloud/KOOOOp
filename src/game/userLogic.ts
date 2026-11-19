import type { FighterId, MapId } from '../shared/gameData.ts';

export const ADMIN_EMAIL = 'sullenshades@gmail.com';
export const MAX_MATCH_HISTORY = 15;

export function isAdminEmail(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase() === ADMIN_EMAIL;
}

export type OnlineStatus = 'online' | 'in-match' | 'offline';

export interface CloudMatchHistoryEntry {
  matchId: string;
  mapId: MapId;
  fighterId: FighterId;
  won: boolean;
  kills: number;
  damageDealt: number;
  coinsEarned: number;
  mode: string;
  timestampMs: number;
}

export interface CloudUserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: 'player' | 'admin';
  onlineStatus: OnlineStatus;
  coins: number;
  wins: number;
  losses: number;
  totalKOs: number;
  matchesPlayed: number;
  favoriteFighter: FighterId;
  matchHistory: CloudMatchHistoryEntry[];
  banned: boolean;
  createdAtMs: number;
  lastLoginMs: number;
}

export function computeFavoriteFighterFromHistory(
  history: CloudMatchHistoryEntry[],
  fallback: FighterId
): FighterId {
  if (history.length === 0) return fallback;
  const counts = new Map<FighterId, number>();
  for (const h of history) {
    counts.set(h.fighterId, (counts.get(h.fighterId) ?? 0) + 1);
  }
  let top = fallback;
  let topCount = -1;
  for (const [fid, count] of counts.entries()) {
    if (count > topCount) {
      topCount = count;
      top = fid;
    }
  }
  return top;
}

export interface ArenaEntryGateParams {
  isPlaceholderConfig: boolean;
  hasCloudUser: boolean;
  hasLocalAccount: boolean;
  isBanned: boolean;
  connectionStatus?: 'connecting' | 'connected' | 'disconnected';
}

export function canEnterArena(params: ArenaEntryGateParams): {
  allowed: boolean;
  reason: string | null;
} {
  if (params.isBanned) {
    return {
      allowed: false,
      reason: 'This account is currently flagged/suspended.',
    };
  }
  const signedIn = params.isPlaceholderConfig
    ? params.hasCloudUser || params.hasLocalAccount
    : params.hasCloudUser;
  if (!signedIn) {
    return {
      allowed: false,
      reason: 'Sign in with Google required to play.',
    };
  }
  if (params.connectionStatus && params.connectionStatus !== 'connected') {
    return {
      allowed: false,
      reason: 'Connecting to arena server...',
    };
  }
  return { allowed: true, reason: null };
}

