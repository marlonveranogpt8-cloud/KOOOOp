import { User, signInWithPopup, signOut } from 'firebase/auth';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  OperationType,
  auth,
  db,
  googleProvider,
  handleFirestoreError,
} from '../firebase.ts';
import type { FighterId, MapId } from '../shared/gameData.ts';
import { STARTING_COINS } from './accountStore.ts';

import {
  ADMIN_EMAIL,
  MAX_MATCH_HISTORY,
  computeFavoriteFighterFromHistory,
  isAdminEmail,
  type CloudMatchHistoryEntry,
  type CloudUserProfile,
  type OnlineStatus,
} from './userLogic.ts';

export {
  ADMIN_EMAIL,
  MAX_MATCH_HISTORY,
  computeFavoriteFighterFromHistory,
  isAdminEmail,
  type CloudMatchHistoryEntry,
  type CloudUserProfile,
  type OnlineStatus,
};

function toMillis(val: unknown, fallback = Date.now()): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (val && typeof (val as { toMillis?: () => number }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  return fallback;
}

const VALID_FIGHTERS: FighterId[] = ['marjohn', 'prime', 'damen', 'khen', 'jm'];

function sanitizeFighter(f: unknown): FighterId {
  return VALID_FIGHTERS.includes(f as FighterId) ? (f as FighterId) : 'prime';
}

function sanitizeDisplayName(raw: string | null | undefined, email: string): string {
  const base = (raw || email.split('@')[0] || 'Fighter').trim().replace(/\s+/g, ' ');
  return (base || 'Fighter').slice(0, 64);
}

function parseMatchHistory(raw: unknown): CloudMatchHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_MATCH_HISTORY).map((item) => {
    const rec = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    return {
      matchId: String(rec.matchId || '').slice(0, 64),
      mapId: (['shibuya', 'meadow', 'temple', 'obsidian'].includes(String(rec.mapId))
        ? String(rec.mapId)
        : 'shibuya') as MapId,
      fighterId: sanitizeFighter(rec.fighterId),
      won: Boolean(rec.won),
      kills: Number.isFinite(Number(rec.kills)) ? Math.max(0, Math.round(Number(rec.kills))) : 0,
      damageDealt: Number.isFinite(Number(rec.damageDealt))
        ? Math.max(0, Math.round(Number(rec.damageDealt)))
        : 0,
      coinsEarned: Number.isFinite(Number(rec.coinsEarned))
        ? Math.max(0, Math.round(Number(rec.coinsEarned)))
        : 0,
      mode: String(rec.mode || 'arena').slice(0, 24),
      timestampMs: Number.isFinite(Number(rec.timestampMs)) ? Number(rec.timestampMs) : Date.now(),
    };
  });
}

export function normalizeCloudUserDoc(id: string, data: Record<string, unknown>): CloudUserProfile {
  const email = String(data.email || '').slice(0, 160);
  const statusRaw = String(data.onlineStatus || 'offline');
  const onlineStatus: OnlineStatus =
    statusRaw === 'online' || statusRaw === 'in-match' || statusRaw === 'offline'
      ? statusRaw
      : 'offline';
  return {
    uid: String(data.uid || id).slice(0, 128),
    email,
    displayName: sanitizeDisplayName(typeof data.displayName === 'string' ? data.displayName : null, email),
    photoURL: String(data.photoURL || '').slice(0, 512),
    role: data.role === 'admin' ? 'admin' : 'player',
    onlineStatus,
    coins: Number.isFinite(Number(data.coins)) ? Math.max(0, Math.round(Number(data.coins))) : STARTING_COINS,
    wins: Number.isFinite(Number(data.wins)) ? Math.max(0, Math.round(Number(data.wins))) : 0,
    losses: Number.isFinite(Number(data.losses)) ? Math.max(0, Math.round(Number(data.losses))) : 0,
    totalKOs: Number.isFinite(Number(data.totalKOs)) ? Math.max(0, Math.round(Number(data.totalKOs))) : 0,
    matchesPlayed: Number.isFinite(Number(data.matchesPlayed))
      ? Math.max(0, Math.round(Number(data.matchesPlayed)))
      : 0,
    favoriteFighter: sanitizeFighter(data.favoriteFighter),
    matchHistory: parseMatchHistory(data.matchHistory),
    banned: Boolean(data.banned),
    createdAtMs: toMillis(data.createdAt),
    lastLoginMs: toMillis(data.lastLogin),
  };
}

export async function upsertCloudUserOnLogin(user: User): Promise<CloudUserProfile> {
  if (!db) {
    throw new Error('Firebase Firestore is not configured.');
  }
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  const email = (user.email || `${user.uid}@koopal.local`).slice(0, 160);
  const displayName = sanitizeDisplayName(user.displayName, email);
  const photoURL = (user.photoURL || '').slice(0, 512);

  let existingSnap;
  try {
    existingSnap = await getDoc(ref);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }

  if (!existingSnap.exists()) {
    const createPayload = {
      uid: user.uid,
      email,
      displayName,
      photoURL,
      role: 'player' as const,
      onlineStatus: 'online' as const,
      coins: STARTING_COINS,
      wins: 0,
      losses: 0,
      totalKOs: 0,
      matchesPlayed: 0,
      favoriteFighter: 'prime' as FighterId,
      matchHistory: [],
      banned: false,
      createdAt: serverTimestamp(),
      lastLogin: serverTimestamp(),
    };
    try {
      await setDoc(ref, createPayload);
      const freshSnap = await getDoc(ref);
      return freshSnap.exists()
        ? normalizeCloudUserDoc(user.uid, freshSnap.data())
        : normalizeCloudUserDoc(user.uid, { ...createPayload, createdAt: Date.now(), lastLogin: Date.now() });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  } else {
    try {
      await updateDoc(ref, {
        displayName,
        photoURL,
        email,
        onlineStatus: 'online',
        lastLogin: serverTimestamp(),
      });
      const freshSnap = await getDoc(ref);
      return freshSnap.exists()
        ? normalizeCloudUserDoc(user.uid, freshSnap.data())
        : normalizeCloudUserDoc(user.uid, existingSnap.data());
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }
}

export async function signInWithGoogleCloud(): Promise<CloudUserProfile> {
  if (!auth || !db) {
    throw new Error('Firebase configuration missing.');
  }
  const cred = await signInWithPopup(auth, googleProvider);
  return upsertCloudUserOnLogin(cred.user);
}

export async function syncCloudPresence(
  uid: string,
  onlineStatus: OnlineStatus,
  favoriteFighter?: FighterId
): Promise<void> {
  if (!db || !auth?.currentUser || auth.currentUser.uid !== uid) return;
  const path = `users/${uid}`;
  const ref = doc(db, 'users', uid);
  const payload: Record<string, unknown> = {
    onlineStatus,
    lastLogin: serverTimestamp(),
  };
  if (favoriteFighter) {
    payload.favoriteFighter = sanitizeFighter(favoriteFighter);
  }
  try {
    await updateDoc(ref, payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function signOutCloudUser(uid?: string): Promise<void> {
  if (uid && db && auth?.currentUser?.uid === uid) {
    try {
      await updateDoc(doc(db, 'users', uid), {
        onlineStatus: 'offline',
        lastLogin: serverTimestamp(),
      });
    } catch {
      // ignore offline update failure during signOut
    }
  }
  if (auth) {
    await signOut(auth);
  }
}

export async function commitMatchResultToCloud(
  profile: CloudUserProfile,
  entry: CloudMatchHistoryEntry
): Promise<CloudUserProfile> {
  if (!db || !auth?.currentUser || auth.currentUser.uid !== profile.uid) {
    return profile;
  }
  if (profile.banned) return profile;

  const nextHistory = [entry, ...profile.matchHistory].slice(0, MAX_MATCH_HISTORY);
  const fav = computeFavoriteFighterFromHistory(nextHistory, entry.fighterId);
  const earned = Math.max(0, Math.min(200, Math.round(entry.coinsEarned)));
  const kills = Math.max(0, Math.min(30, Math.round(entry.kills)));

  const path = `users/${profile.uid}`;
  try {
    await updateDoc(doc(db, 'users', profile.uid), {
      onlineStatus: 'online',
      coins: profile.coins + earned,
      wins: profile.wins + (entry.won ? 1 : 0),
      losses: profile.losses + (entry.won ? 0 : 1),
      totalKOs: profile.totalKOs + kills,
      matchesPlayed: profile.matchesPlayed + 1,
      favoriteFighter: fav,
      matchHistory: nextHistory,
      lastLogin: serverTimestamp(),
    });
    return {
      ...profile,
      onlineStatus: 'online',
      coins: profile.coins + earned,
      wins: profile.wins + (entry.won ? 1 : 0),
      losses: profile.losses + (entry.won ? 0 : 1),
      totalKOs: profile.totalKOs + kills,
      matchesPlayed: profile.matchesPlayed + 1,
      favoriteFighter: fav,
      matchHistory: nextHistory,
      lastLoginMs: Date.now(),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export function subscribeOwnCloudUser(
  uid: string,
  onProfile: (profile: CloudUserProfile) => void
): () => void {
  if (!db) return () => {};
  const path = `users/${uid}`;
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (snap.exists()) {
        onProfile(normalizeCloudUserDoc(snap.id, snap.data()));
      }
    },
    (err) => {
      handleFirestoreError(err, OperationType.GET, path);
    }
  );
}

export function subscribeAllUsersForAdmin(
  onUsers: (users: CloudUserProfile[]) => void,
  onError?: (err: unknown) => void
): () => void {
  if (!db) return () => {};
  const path = 'users';
  return onSnapshot(
    collection(db, 'users'),
    (snap) => {
      const list = snap.docs
        .map((d) => normalizeCloudUserDoc(d.id, d.data()))
        .sort((a, b) => b.lastLoginMs - a.lastLoginMs);
      onUsers(list);
    },
    (err) => {
      if (onError) onError(err);
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

export async function adminUpdateUserCoins(targetUid: string, nextCoins: number): Promise<void> {
  if (!db) return;
  const clamped = Math.max(0, Math.min(10000000, Math.round(nextCoins)));
  const path = `users/${targetUid}`;
  try {
    await updateDoc(doc(db, 'users', targetUid), {
      coins: clamped,
      lastLogin: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function adminSetUserBanned(targetUid: string, banned: boolean): Promise<void> {
  if (!db) return;
  const path = `users/${targetUid}`;
  try {
    await updateDoc(doc(db, 'users', targetUid), {
      banned,
      lastLogin: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function adminResetUserStats(targetUid: string): Promise<void> {
  if (!db) return;
  const path = `users/${targetUid}`;
  try {
    await updateDoc(doc(db, 'users', targetUid), {
      coins: STARTING_COINS,
      wins: 0,
      losses: 0,
      totalKOs: 0,
      matchesPlayed: 0,
      favoriteFighter: 'prime',
      matchHistory: [],
      lastLogin: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}
