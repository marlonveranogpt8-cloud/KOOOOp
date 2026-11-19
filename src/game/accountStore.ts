export interface UserAccount {
  username: string;
  coins: number;
  wins: number;
  kills: number;
  matchesPlayed: number;
  createdAt: number;
  lastLoginAt: number;
}

export interface AccountStoreState {
  activeUsername: string | null;
  accounts: Record<string, UserAccount>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CoinRewardBreakdown {
  base: number;
  winBonus: number;
  koBonus: number;
  damageBonus: number;
  total: number;
}

export const ACCOUNT_STORAGE_KEY = 'koopal_clash_accounts_v1';
export const STARTING_COINS = 100;

function getDefaultStorage(): StorageLike | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, 14);
}

export function normalizeAccountKey(raw: string): string {
  return normalizeUsername(raw).toLowerCase();
}

export function loadAccountStore(storage: StorageLike | null = getDefaultStorage()): AccountStoreState {
  if (!storage) {
    return { activeUsername: null, accounts: {} };
  }
  try {
    const raw = storage.getItem(ACCOUNT_STORAGE_KEY);
    if (!raw) return { activeUsername: null, accounts: {} };
    const parsed = JSON.parse(raw) as Partial<AccountStoreState>;
    const accounts: Record<string, UserAccount> = {};
    if (parsed.accounts && typeof parsed.accounts === 'object') {
      for (const [k, acc] of Object.entries(parsed.accounts)) {
        if (!acc || typeof acc.username !== 'string') continue;
        const cleanName = normalizeUsername(acc.username);
        if (!cleanName) continue;
        accounts[k.toLowerCase()] = {
          username: cleanName,
          coins: Number.isFinite(acc.coins) ? Math.max(0, Math.round(acc.coins)) : STARTING_COINS,
          wins: Number.isFinite(acc.wins) ? Math.max(0, Math.round(acc.wins)) : 0,
          kills: Number.isFinite(acc.kills) ? Math.max(0, Math.round(acc.kills)) : 0,
          matchesPlayed: Number.isFinite(acc.matchesPlayed) ? Math.max(0, Math.round(acc.matchesPlayed)) : 0,
          createdAt: Number.isFinite(acc.createdAt) ? acc.createdAt : Date.now(),
          lastLoginAt: Number.isFinite(acc.lastLoginAt) ? acc.lastLoginAt : Date.now(),
        };
      }
    }
    const activeKey =
      typeof parsed.activeUsername === 'string' ? parsed.activeUsername.trim().toLowerCase() : null;
    const activeAccount = activeKey && accounts[activeKey] ? accounts[activeKey].username : null;
    return {
      activeUsername: activeAccount,
      accounts,
    };
  } catch {
    return { activeUsername: null, accounts: {} };
  }
}

export function saveAccountStore(
  store: AccountStoreState,
  storage: StorageLike | null = getDefaultStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage quota errors
  }
}

export function getActiveAccount(store: AccountStoreState): UserAccount | null {
  if (!store.activeUsername) return null;
  const key = normalizeAccountKey(store.activeUsername);
  return store.accounts[key] ?? null;
}

export function loginOrCreateAccount(
  store: AccountStoreState,
  rawUsername: string,
  now = Date.now(),
  storage: StorageLike | null = getDefaultStorage()
): { store: AccountStoreState; account: UserAccount; created: boolean } | null {
  const cleanName = normalizeUsername(rawUsername);
  if (!cleanName) return null;
  const key = cleanName.toLowerCase();
  const existing = store.accounts[key];
  const account: UserAccount = existing
    ? {
        ...existing,
        username: cleanName,
        lastLoginAt: now,
      }
    : {
        username: cleanName,
        coins: STARTING_COINS,
        wins: 0,
        kills: 0,
        matchesPlayed: 0,
        createdAt: now,
        lastLoginAt: now,
      };
  const nextStore: AccountStoreState = {
    activeUsername: account.username,
    accounts: {
      ...store.accounts,
      [key]: account,
    },
  };
  saveAccountStore(nextStore, storage);
  return { store: nextStore, account, created: !existing };
}

export function logoutAccount(
  store: AccountStoreState,
  storage: StorageLike | null = getDefaultStorage()
): AccountStoreState {
  const nextStore: AccountStoreState = {
    ...store,
    activeUsername: null,
  };
  saveAccountStore(nextStore, storage);
  return nextStore;
}

export function calculateMatchCoinReward(input: {
  won: boolean;
  kills: number;
  damageDealt: number;
  isTrainingMode: boolean;
}): CoinRewardBreakdown {
  if (input.isTrainingMode) {
    return { base: 0, winBonus: 0, koBonus: 0, damageBonus: 0, total: 0 };
  }
  const base = 15;
  const winBonus = input.won ? 45 : 0;
  const koBonus = Math.max(0, Math.round(input.kills)) * 12;
  const damageBonus = Math.min(20, Math.floor(Math.max(0, input.damageDealt) / 45));
  return {
    base,
    winBonus,
    koBonus,
    damageBonus,
    total: base + winBonus + koBonus + damageBonus,
  };
}

export function recordMatchReward(
  store: AccountStoreState,
  username: string | null | undefined,
  reward: CoinRewardBreakdown,
  won: boolean,
  kills: number,
  storage: StorageLike | null = getDefaultStorage()
): { store: AccountStoreState; account: UserAccount | null } {
  if (!username) return { store, account: null };
  const cleanName = normalizeUsername(username);
  if (!cleanName) return { store, account: null };
  const key = cleanName.toLowerCase();
  const baseAcc: UserAccount = store.accounts[key] ?? {
    username: cleanName,
    coins: STARTING_COINS,
    wins: 0,
    kills: 0,
    matchesPlayed: 0,
    createdAt: Date.now(),
    lastLoginAt: Date.now(),
  };
  const updated: UserAccount = {
    ...baseAcc,
    coins: baseAcc.coins + Math.max(0, Math.round(reward.total)),
    wins: baseAcc.wins + (won ? 1 : 0),
    kills: baseAcc.kills + Math.max(0, Math.round(kills)),
    matchesPlayed: baseAcc.matchesPlayed + 1,
    lastLoginAt: Date.now(),
  };
  const nextStore: AccountStoreState = {
    activeUsername: store.activeUsername ?? updated.username,
    accounts: {
      ...store.accounts,
      [key]: updated,
    },
  };
  saveAccountStore(nextStore, storage);
  return { store: nextStore, account: updated };
}
