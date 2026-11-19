import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer, WebSocket as WsClient } from 'ws';
import {
  advanceActionTimer,
  applyObstacleDamage,
  computeConeForwardVector,
  computeContactShadowTransform,
  computeCountdownStep,
  computeLockedTopDownCamera,
  computeObstacleCameraPullIn,
  computeStormRadiusAtTime,
  computeSwipeAimPoint,
  computeTraumaShake,
  dampAngle,
  dampScalar,
  projectToMinimapPercent,
  sanitizeChatText,
  selectNearestTarget,
  shouldEnterDragAim,
} from './combatMath.ts';
import {
  canEnterArena,
  computeFavoriteFighterFromHistory,
  isAdminEmail,
} from './userLogic.ts';
import { GameRoomEngine } from '../server/gameRoomEngine.ts';
import type { ServerMessage } from '../shared/gameData.ts';
import {
  calculateMatchCoinReward,
  loadAccountStore,
  loginOrCreateAccount,
  logoutAccount,
  recordMatchReward,
  type StorageLike,
} from './accountStore.ts';
import {
  FIGHTERS,
  FIGHTER_BY_ID,
  FIGHTER_SKINS,
  MAPS,
  SKIN_ORDER,
  createInitialObstacleStates,
  getDamagePhase,
  getMapTerrainHeight,
  pointHitsObstacle,
  resolveObstacleCollisions,
  type MapObstacle,
} from '../shared/gameData.ts';

function makeMemoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem(k) {
      return data.get(k) ?? null;
    },
    setItem(k, v) {
      data.set(k, v);
    },
  };
}

test('dampScalar converges monotonically toward target regardless of step subdivision', () => {
  const singleStep = dampScalar(0, 10, 12, 0.05);
  let threeSteps = 0;
  for (let i = 0; i < 3; i++) {
    threeSteps = dampScalar(threeSteps, 10, 12, 0.05 / 3);
  }
  assert.ok(Math.abs(singleStep - threeSteps) < 1e-6);
  assert.ok(singleStep > 0 && singleStep < 10);
});

test('dampAngle wraps cleanly across +/- PI boundary', () => {
  const start = Math.PI - 0.1;
  const target = -Math.PI + 0.1;
  const next = dampAngle(start, target, 20, 0.016);
  assert.ok(next > start);
});

test('computeContactShadowTransform shrinks and softens shadow with elevation', () => {
  const grounded = computeContactShadowTransform(0);
  const airborne = computeContactShadowTransform(4);
  assert.equal(grounded.scale, 1);
  assert.ok(airborne.scale < grounded.scale);
  assert.ok(airborne.opacity < grounded.opacity);
  assert.ok(airborne.opacity >= 0.14);
});

test('advanceActionTimer advances active attack timers smoothly without underflowing', () => {
  assert.ok(Math.abs(advanceActionTimer('attack', 0.25, 0.016) - 0.234) < 1e-9);
  assert.equal(advanceActionTimer('attack', 0.01, 0.05), 0);
  assert.equal(advanceActionTimer('idle', 0.5, 0.016), 0.5);
});

test('computeTraumaShake decays cleanly to zero at zero trauma', () => {
  const zero = computeTraumaShake(0, 1.5);
  assert.deepEqual(zero, { x: 0, y: 0, z: 0, roll: 0 });
  const low = computeTraumaShake(0.2, 2.0);
  const high = computeTraumaShake(0.8, 2.0);
  assert.ok(
    Math.hypot(high.x, high.y, high.z) > Math.hypot(low.x, low.y, low.z)
  );
});

test('computeObstacleCameraPullIn pulls camera closer when an obstacle blocks line of sight', () => {
  const obstacles: MapObstacle[] = [
    {
      id: 'test-pillar',
      kind: 'pillar',
      x: 0,
      z: 6,
      halfW: 1.5,
      halfD: 1.5,
      topY: 5,
      colorHex: 0x334155,
      roofColorHex: 0x475569,
    },
  ];
  const t = computeObstacleCameraPullIn(
    0,
    1.5,
    0,
    0,
    1.5,
    12,
    obstacles,
    'temple',
    getMapTerrainHeight
  );
  assert.ok(t < 1.0 && t >= 0.32);
});

test('computeLockedTopDownCamera provides MLBB isometric pitch (~58deg), center bias, and balanced rear framing', () => {
  const edge = computeLockedTopDownCamera(18, 0, -10, false);
  assert.ok(edge.elevationDeg >= 55 && edge.elevationDeg <= 61);
  assert.equal(edge.yaw, Math.PI);
  // Biased toward center (0,0) in X and Z, plus rear (+Z) framing compensation
  assert.ok(edge.lookX > 0 && edge.lookX < 18);
  assert.ok(edge.lookZ > -10 && edge.lookZ < 0);
  assert.ok(edge.camZ > edge.lookZ && edge.camY > edge.lookY);
  assert.ok(edge.camY < 17.2);
  const flying = computeLockedTopDownCamera(18, 4, -10, true);
  assert.ok(flying.camY > edge.camY);
  const portrait = computeLockedTopDownCamera(20, 0, 10, false, undefined, undefined, true);
  assert.ok(Math.abs(portrait.lookX - 20) <= 2.61);
});

test('projectToMinimapPercent projects world positions cleanly onto [6..94]% bounds', () => {
  assert.deepEqual(projectToMinimapPercent(0, 0, 38), { leftPct: 50, topPct: 50 });
  const east = projectToMinimapPercent(38, 0, 38);
  assert.equal(east.leftPct, 94);
  const clamped = projectToMinimapPercent(-999, 999, 38);
  assert.equal(clamped.leftPct, 6);
  assert.equal(clamped.topPct, 94);
});

test('admin gate strictly allows sullenshades@gmail.com and computes favorite fighter from history', () => {
  assert.equal(isAdminEmail('sullenshades@gmail.com'), true);
  assert.equal(isAdminEmail('  SullenShades@Gmail.com '), true);
  assert.equal(isAdminEmail('other@gmail.com'), false);
  assert.equal(isAdminEmail(null), false);

  const fav = computeFavoriteFighterFromHistory(
    [
      { matchId: '1', mapId: 'shibuya', fighterId: 'damen', won: true, kills: 2, damageDealt: 100, coinsEarned: 80, mode: 'arena', timestampMs: 1 },
      { matchId: '2', mapId: 'temple', fighterId: 'jm', won: true, kills: 3, damageDealt: 140, coinsEarned: 90, mode: 'arena', timestampMs: 2 },
      { matchId: '3', mapId: 'shibuya', fighterId: 'damen', won: false, kills: 1, damageDealt: 70, coinsEarned: 40, mode: 'arena', timestampMs: 3 },
    ],
    'prime'
  );
  assert.equal(fav, 'damen');
  assert.equal(computeFavoriteFighterFromHistory([], 'khen'), 'khen');
});

test('shouldEnterDragAim enforces 15px move or 160ms hold threshold so quick taps stay auto-aim', () => {
  assert.equal(shouldEnterDragAim(0, 40), false);
  assert.equal(shouldEnterDragAim(14.9, 159), false);
  assert.equal(shouldEnterDragAim(15, 30), true);
  assert.equal(shouldEnterDragAim(2, 160), true);
});

test('selectNearestTarget chooses closest alive foe within range', () => {
  const list = [
    { playerId: 'p1', x: 0, z: 0, isKO: false },
    { playerId: 'p2', x: 9, z: 0, isKO: false },
    { playerId: 'p3', x: 3, z: 4, isKO: false }, // dist 5
    { playerId: 'p4', x: 1, z: 0, isKO: true },  // KO ignored
  ];
  const hit = selectNearestTarget(0, 0, 'p1', list, 10);
  assert.equal(hit?.playerId, 'p3');
  assert.equal(selectNearestTarget(0, 0, 'p1', list, 4), null);
});

test('computeSwipeAimPoint maps swipe direction to clamped world coordinates', () => {
  const upAim = computeSwipeAimPoint(2, 5, 0, -1, 10);
  assert.ok(upAim.z < 5 && Math.hypot(upAim.x - 2, upAim.z - 5) <= 10.01);
  const farAim = computeSwipeAimPoint(0, 0, 2, 0, 10);
  assert.ok(Math.abs(farAim.x - 10) < 1e-6);
});

test('computeStormRadiusAtTime activates at 60s and shrinks in combat only', () => {
  assert.deepEqual(computeStormRadiusAtTime(59.9, 38, false), { active: false, radius: 38 });
  const at60 = computeStormRadiusAtTime(60.0, 38, false);
  const at75 = computeStormRadiusAtTime(75.0, 38, false);
  assert.equal(at60.active, true);
  assert.equal(at60.radius, 38);
  assert.ok(at75.radius < at60.radius);
  assert.deepEqual(computeStormRadiusAtTime(90.0, 38, true), { active: false, radius: 38 });
});

test('destructible obstacles block until destroyed and then allow free movement & projectiles', () => {
  const obsList = createInitialObstacleStates('shibuya');
  assert.ok(obsList.length >= 4);
  const target = obsList[0];
  assert.equal(target.destroyed, false);
  assert.equal(pointHitsObstacle('shibuya', target.x, 1.0, target.z, obsList), true);

  const half = applyObstacleDamage(target.hp, 45);
  assert.equal(half.destroyed, false);
  target.hp = half.hp;
  target.destroyed = half.destroyed;
  assert.equal(pointHitsObstacle('shibuya', target.x, 1.0, target.z, obsList), true);

  const broke = applyObstacleDamage(target.hp, 999);
  assert.equal(broke.destroyed, true);
  target.hp = broke.hp;
  target.destroyed = broke.destroyed;
  assert.equal(pointHitsObstacle('shibuya', target.x, 1.0, target.z, obsList), false);

  const pos = resolveObstacleCollisions('shibuya', target.x, 0, target.z, 0.5, obsList);
  assert.equal(pos.x, target.x);
  assert.equal(pos.z, target.z);
});

test('accountStore persists accounts, coin rewards, and logout/re-login cleanly', () => {
  const storage = makeMemoryStorage();
  let store = loadAccountStore(storage);
  assert.equal(store.activeUsername, null);

  const res = loginOrCreateAccount(store, 'AlexBrawler', 1000, storage);
  assert.ok(res);
  store = res.store;
  assert.equal(res.created, true);
  assert.equal(res.account.coins, 100);

  const reward = calculateMatchCoinReward({
    won: true,
    kills: 2,
    damageDealt: 180,
    isTrainingMode: false,
  });
  assert.ok(reward.total >= 80);

  const updated = recordMatchReward(store, res.account.username, reward, true, 2, storage);
  store = updated.store;
  assert.equal(updated.account?.coins, 100 + reward.total);
  assert.equal(updated.account?.wins, 1);

  store = logoutAccount(store, storage);
  assert.equal(store.activeUsername, null);

  const reloaded = loadAccountStore(storage);
  assert.equal(reloaded.accounts.alexbrawler.coins, 100 + reward.total);
});

test('shared gameData speed tiers (10/9/9/7/7), Shibuya map, keybind hints, and M1 balance are valid', () => {
  assert.equal(FIGHTERS.length, 5);
  assert.equal(MAPS.length, 4);
  assert.ok(MAPS.some((m) => m.id === 'shibuya'));

  // Exact Speed Tiers
  assert.equal(FIGHTER_BY_ID.prime.moveSpeed, 10);
  assert.equal(FIGHTER_BY_ID.jm.moveSpeed, 9);
  assert.equal(FIGHTER_BY_ID.khen.moveSpeed, 9);
  assert.equal(FIGHTER_BY_ID.marjohn.moveSpeed, 7);
  assert.equal(FIGHTER_BY_ID.damen.moveSpeed, 7);

  // Snappier melee M1 vs measured ranged M1
  assert.ok(FIGHTER_BY_ID.jm.abilities[0].cooldown < 0.5);
  assert.ok(FIGHTER_BY_ID.prime.abilities[0].cooldown < 0.5);
  assert.ok(FIGHTER_BY_ID.khen.abilities[0].cooldown < 0.5);
  assert.equal(FIGHTER_BY_ID.damen.abilities[0].cooldown, 0.8);
  assert.equal(FIGHTER_BY_ID.marjohn.abilities[0].cooldown, 0.9);

  // Keybind hints match M1, F, 1, 2, 3
  for (const f of FIGHTERS) {
    assert.equal(f.abilities[0].keyHint, 'M1');
    assert.equal(f.abilities[1].keyHint, 'F');
    assert.equal(f.abilities[2].keyHint, '1');
    assert.equal(f.abilities[3].keyHint, '2');
    assert.equal(f.abilities[4].keyHint, '3');
    for (const s of SKIN_ORDER) {
      assert.ok(FIGHTER_SKINS[f.id][s].name.length > 0);
    }
  }

  for (const m of MAPS) {
    assert.ok(m.arenaRadius >= 37);
  }
  assert.equal(getDamagePhase(100, 100, false), 'NORMAL');
  assert.equal(getDamagePhase(60, 100, false), 'DAMAGED');
  assert.equal(getDamagePhase(30, 100, false), 'SEVERELY DAMAGED');
  assert.equal(getDamagePhase(10, 100, false), 'CRITICAL');
  assert.equal(getDamagePhase(0, 100, true), 'DEFEATED');
});

test('computeConeForwardVector aligns -PI/2 cone rotation with +Z cast yaw across all directions', () => {
  const angles = [0, Math.PI / 2, -Math.PI / 2, Math.PI, 0.7, -1.25];
  for (const yaw of angles) {
    const fixed = computeConeForwardVector(-Math.PI / 2, yaw);
    const expectedX = Math.sin(yaw);
    const expectedZ = Math.cos(yaw);
    assert.ok(
      Math.hypot(fixed.x - expectedX, fixed.z - expectedZ) < 1e-5,
      `yaw=${yaw} expected (${expectedX}, ${expectedZ}), got (${fixed.x}, ${fixed.z})`
    );
    // Verify the old +PI/2 sign pointed 180 degrees opposite
    const oldBuggy = computeConeForwardVector(Math.PI / 2, yaw);
    assert.ok(Math.hypot(oldBuggy.x + expectedX, oldBuggy.z + expectedZ) < 1e-5);
  }
});

test('sanitizeChatText strips control chars, collapses whitespace, caps length, and rejects blank input', () => {
  assert.equal(sanitizeChatText(''), null);
  assert.equal(sanitizeChatText('   \n\t  '), null);
  assert.equal(sanitizeChatText(12345), null);
  assert.equal(sanitizeChatText('  Hello\u0007   world!\n\nGG '), 'Hello world! GG');
  const long = 'a'.repeat(240);
  assert.equal(sanitizeChatText(long)?.length, 160);
});

test('computeCountdownStep maps 5s countdown values into 5..1 or 0 for FIGHT', () => {
  assert.equal(computeCountdownStep(5.0), 5);
  assert.equal(computeCountdownStep(4.05), 5);
  assert.equal(computeCountdownStep(4.0), 4);
  assert.equal(computeCountdownStep(3.2), 4);
  assert.equal(computeCountdownStep(1.0), 1);
  assert.equal(computeCountdownStep(0.01), 1);
  assert.equal(computeCountdownStep(0), 0);
  assert.equal(computeCountdownStep(-0.4), 0);
});

test('canEnterArena enforces mandatory Google login in live config and blocks banned or disconnected accounts', () => {
  assert.equal(
    canEnterArena({
      isPlaceholderConfig: false,
      hasCloudUser: false,
      hasLocalAccount: true,
      isBanned: false,
      connectionStatus: 'connected',
    }).allowed,
    false
  );
  assert.equal(
    canEnterArena({
      isPlaceholderConfig: false,
      hasCloudUser: true,
      hasLocalAccount: false,
      isBanned: false,
      connectionStatus: 'connected',
    }).allowed,
    true
  );
  assert.equal(
    canEnterArena({
      isPlaceholderConfig: true,
      hasCloudUser: false,
      hasLocalAccount: true,
      isBanned: false,
      connectionStatus: 'connected',
    }).allowed,
    true
  );
  assert.equal(
    canEnterArena({
      isPlaceholderConfig: false,
      hasCloudUser: true,
      hasLocalAccount: true,
      isBanned: true,
      connectionStatus: 'connected',
    }).allowed,
    false
  );
  assert.equal(
    canEnterArena({
      isPlaceholderConfig: false,
      hasCloudUser: true,
      hasLocalAccount: true,
      isBanned: false,
      connectionStatus: 'connecting',
    }).allowed,
    false
  );
});

test('GameRoomEngine broadcasts room:chat messages, replays chatHistory on join, and starts a 5s fight countdown', async () => {
  const engine = new GameRoomEngine();
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => engine.handleConnection(ws));

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const url = `ws://127.0.0.1:${addr.port}`;

  const connectClient = async () => {
    const ws = new WsClient(url);
    const msgs: ServerMessage[] = [];
    ws.on('message', (raw) => {
      msgs.push(JSON.parse(String(raw)) as ServerMessage);
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    const waitFor = async <T extends ServerMessage['type']>(type: T) => {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const hit = msgs.find((m) => m.type === type);
        if (hit) return hit as Extract<ServerMessage, { type: T }>;
        await new Promise((r) => setTimeout(r, 15));
      }
      throw new Error(`Timed out waiting for ${type}`);
    };
    return { ws, msgs, waitFor };
  };

  let c1: Awaited<ReturnType<typeof connectClient>> | null = null;
  let c2: Awaited<ReturnType<typeof connectClient>> | null = null;
  try {
    c1 = await connectClient();
    c1.ws.send(JSON.stringify({ type: 'room:create', playerName: 'HostOne' }));
    const joined1 = await c1.waitFor('room:joined');
    assert.deepEqual(joined1.chatHistory ?? [], []);

    // Send a chat message before second player joins so chatHistory replay is verified
    c1.ws.send(JSON.stringify({ type: 'room:chat', text: '  GLHF   everyone! ' }));
    const chat1 = await c1.waitFor('room:chat');
    assert.equal(chat1.message.text, 'GLHF everyone!');
    assert.equal(chat1.message.senderName, 'HostOne');

    c2 = await connectClient();
    c2.ws.send(JSON.stringify({ type: 'room:join', roomCode: joined1.room.roomCode, playerName: 'GuestTwo' }));
    const joined2 = await c2.waitFor('room:joined');
    assert.equal(joined2.chatHistory?.length, 1);
    assert.equal(joined2.chatHistory?.[0].text, 'GLHF everyone!');

    // Wait past 300ms rate limit and verify live broadcast back to c1 & c2
    await new Promise((r) => setTimeout(r, 340));
    c1.msgs.length = 0;
    c2.msgs.length = 0;
    c2.ws.send(JSON.stringify({ type: 'room:chat', text: 'Ready up!' }));
    const [b1, b2] = await Promise.all([c1.waitFor('room:chat'), c2.waitFor('room:chat')]);
    assert.equal(b1.message.text, 'Ready up!');
    assert.equal(b2.message.senderName, 'GuestTwo');

    // Start match and confirm 5-second countdown begins
    c1.ws.send(JSON.stringify({ type: 'room:selectFighter', fighterId: 'damen' }));
    c1.ws.send(JSON.stringify({ type: 'room:selectSkin', skinId: 'obsidian' }));
    c2.ws.send(JSON.stringify({ type: 'room:selectFighter', fighterId: 'jm' }));
    c2.ws.send(JSON.stringify({ type: 'room:selectSkin', skinId: 'crimson' }));
    await new Promise((r) => setTimeout(r, 60));
    c1.msgs.length = 0;
    c1.ws.send(JSON.stringify({ type: 'room:startNow' }));

    const deadline = Date.now() + 3000;
    let countdownState: Extract<ServerMessage, { type: 'room:state' }>['room'] | null = null;
    while (Date.now() < deadline && !countdownState) {
      for (const m of c1.msgs) {
        if (m.type === 'room:state' && m.room.phase === 'countdown') {
          countdownState = m.room;
          break;
        }
      }
      if (!countdownState) await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(countdownState, 'expected room to enter countdown phase');
    assert.ok(countdownState.countdown >= 4.5 && countdownState.countdown <= 5.01);
  } finally {
    c1?.ws.close();
    c2?.ws.close();
    engine.dispose();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
