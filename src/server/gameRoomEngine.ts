import { WebSocket } from 'ws';
import type {
  AbilitySlot,
  ArenaActorState,
  ArenaPickup,
  ArenaSnapshot,
  ArenaZoneKind,
  ArenaZoneState,
  AwakeningBannerState,
  AwakeningOrbState,
  BattlefieldEventKind,
  BattlefieldEventState,
  ClashState,
  ClientMessage,
  CombatEvent,
  CombatMoveType,
  HeadlockState,
  KoCause,
  MapId,
  MatchAwakeningPhase,
  ObstacleState,
  ProjectileState,
  RoomChatMessage,
  RoomPlayer,
  RoomState,
  ServerMessage,
  SkinId,
  TelegraphKind,
  TelegraphState,
  TrainingConfig,
} from '../shared/gameData.ts';
import {
  FIGHTER_BY_ID,
  FIGHTERS,
  JM_SECRET_ABILITY,
  MAPS,
  MAP_BY_ID,
  SKIN_ORDER,
  createInitialObstacleStates,
  findObstacleAtPoint,
  getDamagePhase,
  getMapPickupSpawns,
  getMapTerrainHeight,
  getObstacleSupportY,
  isJtinsullenTag,
  resolveObstacleCollisions,
} from '../shared/gameData.ts';
import { AWAKENING_CONFIG, getAwakenedAbility } from '../shared/awakeningConfig.ts';
import { applyObstacleDamage, sanitizeChatText } from '../game/combatMath.ts';
import { computeAbilityResourceCost } from '../game/awakeningLogic.ts';
import {
  AwakeningActor,
  AwakeningHostHelpers,
  AwakeningRoomState,
  cancelCutsceneGracefully,
  executeAwakenedAbilityImpact,
  handleAwakeningDebug,
  handleAwakeningMash,
  resetRoomAwakeningState,
  resolveCutsceneClash,
  setupAwakenedAbilityWindup,
  syncCutsceneAudioClock,
  tickAwakenedZoneBehavior,
  tickAwakeningRoom,
} from './awakeningEngine.ts';

const STANDALONE_DASH_COOLDOWN = 1.5;

interface ConnectedClient {
  ws: WebSocket;
  playerId: string | null;
  roomCode: string | null;
}

interface InternalPlayer extends RoomPlayer {
  reconnectToken: string;
  disconnectedAt: number | null;
}

interface InternalActor extends AwakeningActor {}

interface InternalProjectile extends ProjectileState {
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

interface InternalZone extends ArenaZoneState {
  tickTimer: number;
  hitCooldowns: Record<string, number>;
}

interface InternalTelegraph extends TelegraphState {
  elapsed: number;
  windup: number;
}

interface InternalPickup extends ArenaPickup {
  respawnTimer: number;
}

interface InternalBattleEvent extends BattlefieldEventState {
  hazardDetonated: boolean;
}

interface RoomInstance extends AwakeningRoomState {
  roomCode: string;
  hostId: string;
  phase: RoomState['phase'];
  mapId: MapId;
  isSoloPractice: boolean;
  isTrainingMode: boolean;
  trainingConfig: TrainingConfig;
  countdown: number;
  matchTime: number;
  roundNumber: number;
  winsToWin: number;
  roundWinnerId: string | null;
  victoryDelayTimer: number;
  winnerId: string | null;
  players: InternalPlayer[];
  actors: InternalActor[];
  initialActorCount: number;
  projectiles: InternalProjectile[];
  zones: InternalZone[];
  telegraphs: InternalTelegraph[];
  pickups: InternalPickup[];
  obstacles: ObstacleState[];
  battleEvent: InternalBattleEvent | null;
  nextEventAt: number;
  eventRotationIdx: number;
  activeClash: ClashState | null;
  activeHeadlock: HeadlockState | null;
  stormActive: boolean;
  stormRadius: number;
  stormMaxRadius: number;
  stormTickTimer: number;
  lastInputSeq: Record<string, number>;
  pendingEvents: CombatEvent[];
  eventSeq: number;
  lastEmptyAt: number;
  chatHistory: RoomChatMessage[];
  lastChatAt: Record<string, number>;
  awakeningPhase: MatchAwakeningPhase;
  awakeningOrbs: AwakeningOrbState[];
  awakeningBanner: AwakeningBannerState | null;
  awakeningCutscene: AwakeningRoomState['awakeningCutscene'];
  awakeningDelayedHits: AwakeningRoomState['awakeningDelayedHits'];
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function normalizeAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

function makeRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export class GameRoomEngine {
  private rooms = new Map<string, RoomInstance>();
  private clients = new Map<WebSocket, ConnectedClient>();
  private playerSockets = new Map<string, WebSocket>();
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private lastTickMs = Date.now();

  constructor() {
    this.tickInterval = setInterval(() => this.tick(), 40);
  }

  public dispose(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  public handleConnection(ws: WebSocket): void {
    this.clients.set(ws, { ws, playerId: null, roomCode: null });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as ClientMessage;
        this.handleMessage(ws, msg);
      } catch {
        this.send(ws, { type: 'room:error', message: 'Invalid message payload.' });
      }
    });

    ws.on('close', () => {
      this.handleDisconnect(ws);
    });
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private broadcastRoomState(room: RoomInstance): void {
    const state = this.serializeRoom(room);
    for (const p of room.players) {
      const sock = this.playerSockets.get(p.playerId);
      if (sock) this.send(sock, { type: 'room:state', room: state });
    }
  }

  private serializeRoom(room: RoomInstance): RoomState {
    return {
      roomCode: room.roomCode,
      hostId: room.hostId,
      phase: room.phase,
      mapId: room.mapId,
      isSoloPractice: room.isSoloPractice,
      isTrainingMode: room.isTrainingMode,
      trainingConfig: { ...room.trainingConfig },
      countdown: Number(room.countdown.toFixed(1)),
      matchTime: Number(room.matchTime.toFixed(2)),
      roundNumber: room.roundNumber,
      winsToWin: room.winsToWin,
      roundWinnerId: room.roundWinnerId,
      winnerId: room.winnerId,
      players: room.players.map((p) => ({
        playerId: p.playerId,
        slotIndex: p.slotIndex,
        name: p.name,
        fighterId: p.fighterId,
        skinId: p.skinId,
        ready: p.ready,
        connected: p.connected,
        wins: p.wins,
        isBot: p.isBot,
        isDummy: p.isDummy,
      })),
    };
  }

  private handleMessage(ws: WebSocket, msg: ClientMessage): void {
    if (msg.type === 'net:ping') {
      this.send(ws, {
        type: 'net:pong',
        clientSendTime: msg.clientSendTime,
        serverTime: Date.now(),
      });
      return;
    }

    const client = this.clients.get(ws);
    if (!client) return;

    if (msg.type === 'room:create') {
      this.leaveCurrentRoom(ws, true);
      let code = makeRoomCode();
      while (this.rooms.has(code)) code = makeRoomCode();

      const playerId = makeId('p');
      const reconnectToken = makeId('tok');
      const name = (msg.playerName || 'Player 1').trim().slice(0, 14) || 'Player 1';
      const defaultFighter = FIGHTERS[0].id;

      const isTrainingMode = Boolean(msg.isTrainingMode);
      const isSolo = Boolean(msg.isSoloPractice) && !isTrainingMode;
      const room: RoomInstance = {
        roomCode: code,
        hostId: playerId,
        phase: 'lobby',
        mapId: 'shibuya',
        isSoloPractice: isSolo,
        isTrainingMode,
        trainingConfig: { dummyEnabled: false, zeroCooldowns: false },
        countdown: 2.0,
        matchTime: 0,
        roundNumber: 1,
        winsToWin: isSolo || isTrainingMode ? 1 : 3,
        roundWinnerId: null,
        victoryDelayTimer: 0,
        winnerId: null,
        players: [
          {
            playerId,
            slotIndex: 0,
            name,
            fighterId: defaultFighter,
            skinId: 'ascended',
            ready: false,
            connected: true,
            wins: 0,
            reconnectToken,
            disconnectedAt: null,
          },
        ],
        actors: [],
        initialActorCount: 1,
        projectiles: [],
        zones: [],
        telegraphs: [],
        pickups: [],
        obstacles: createInitialObstacleStates('shibuya'),
        battleEvent: null,
        nextEventAt: 11.0,
        eventRotationIdx: 0,
        activeClash: null,
        activeHeadlock: null,
        stormActive: false,
        stormRadius: MAP_BY_ID.shibuya.arenaRadius,
        stormMaxRadius: MAP_BY_ID.shibuya.arenaRadius,
        stormTickTimer: 0,
        lastInputSeq: {},
        pendingEvents: [],
        eventSeq: 0,
        lastEmptyAt: Date.now(),
        chatHistory: [],
        lastChatAt: {},
        awakeningPhase: 'PRE_AWAKENING',
        awakeningOrbs: [],
        awakeningBanner: null,
        awakeningCutscene: null,
        awakeningDelayedHits: [],
      };

      this.rooms.set(code, room);
      client.playerId = playerId;
      client.roomCode = code;
      this.playerSockets.set(playerId, ws);

      this.send(ws, {
        type: 'room:joined',
        playerId,
        reconnectToken,
        room: this.serializeRoom(room),
        chatHistory: room.chatHistory,
      });
      return;
    }

    if (msg.type === 'room:join') {
      const code = (msg.roomCode || '').trim().toUpperCase();
      const room = this.rooms.get(code);
      if (!room) {
        this.send(ws, { type: 'room:error', message: `Room "${code}" not found.` });
        return;
      }

      if (msg.reconnectToken) {
        const existing = room.players.find((p) => p.reconnectToken === msg.reconnectToken);
        if (existing) {
          this.leaveCurrentRoom(ws, true);
          existing.connected = true;
          existing.disconnectedAt = null;
          client.playerId = existing.playerId;
          client.roomCode = room.roomCode;
          this.playerSockets.set(existing.playerId, ws);

          this.send(ws, {
            type: 'room:joined',
            playerId: existing.playerId,
            reconnectToken: existing.reconnectToken,
            room: this.serializeRoom(room),
            chatHistory: room.chatHistory,
          });
          this.broadcastRoomState(room);
          if (room.phase === 'combat' || room.phase === 'countdown' || room.phase === 'roundEnd') {
            this.send(ws, {
              type: 'game:snapshot',
              snapshot: this.buildSnapshot(room),
              events: [],
            });
          }
          return;
        }
      }

      if (room.phase !== 'lobby') {
        this.send(ws, { type: 'room:error', message: 'Match already in progress in that room.' });
        return;
      }
      if (room.players.length >= 5) {
        this.send(ws, { type: 'room:error', message: 'Room is full (5/5 players).' });
        return;
      }

      this.leaveCurrentRoom(ws, true);
      const usedSlots = new Set(room.players.map((p) => p.slotIndex));
      let nextSlot = 0;
      while (usedSlots.has(nextSlot) && nextSlot < 5) nextSlot++;

      const usedFighters = new Set(room.players.map((p) => p.fighterId));
      const freeFighter =
        FIGHTERS.find((f) => !usedFighters.has(f.id))?.id ?? FIGHTERS[nextSlot % FIGHTERS.length].id;

      const playerId = makeId('p');
      const reconnectToken = makeId('tok');
      const name = (msg.playerName || `Player ${nextSlot + 1}`).trim().slice(0, 14) || `Player ${nextSlot + 1}`;

      room.players.push({
        playerId,
        slotIndex: nextSlot,
        name,
        fighterId: freeFighter,
        skinId: 'ascended',
        ready: false,
        connected: true,
        wins: 0,
        reconnectToken,
        disconnectedAt: null,
      });
      room.players.sort((a, b) => a.slotIndex - b.slotIndex);

      client.playerId = playerId;
      client.roomCode = room.roomCode;
      this.playerSockets.set(playerId, ws);

      this.send(ws, {
        type: 'room:joined',
        playerId,
        reconnectToken,
        room: this.serializeRoom(room),
        chatHistory: room.chatHistory,
      });
      this.broadcastRoomState(room);
      return;
    }

    if (!client.roomCode || !client.playerId) return;
    const room = this.rooms.get(client.roomCode);
    if (!room) return;
    const player = room.players.find((p) => p.playerId === client.playerId);
    if (!player) return;

    if (msg.type === 'room:leave') {
      this.leaveCurrentRoom(ws, true);
      return;
    }

    if (msg.type === 'room:chat') {
      const now = Date.now();
      const prevAt = room.lastChatAt[player.playerId] ?? 0;
      if (now - prevAt < 300) return;
      const cleanText = sanitizeChatText(msg.text);
      if (!cleanText) return;
      room.lastChatAt[player.playerId] = now;
      const chatMsg: RoomChatMessage = {
        id: makeId('chat'),
        senderId: player.playerId,
        senderName: player.name,
        fighterId: player.fighterId,
        text: cleanText,
        timestamp: now,
      };
      room.chatHistory.push(chatMsg);
      if (room.chatHistory.length > 60) {
        room.chatHistory.shift();
      }
      for (const p of room.players) {
        const sock = this.playerSockets.get(p.playerId);
        if (sock) this.send(sock, { type: 'room:chat', message: chatMsg });
      }
      return;
    }

    if (msg.type === 'room:selectFighter') {
      if (room.phase !== 'lobby') return;
      if (FIGHTER_BY_ID[msg.fighterId]) {
        player.fighterId = msg.fighterId;
        this.broadcastRoomState(room);
      }
      return;
    }

    if (msg.type === 'room:selectSkin') {
      if (room.phase !== 'lobby') return;
      if (SKIN_ORDER.includes(msg.skinId)) {
        player.skinId = msg.skinId;
        this.broadcastRoomState(room);
      }
      return;
    }

    if (msg.type === 'room:selectMap') {
      if (room.phase !== 'lobby') return;
      if (player.playerId !== room.hostId) return;
      if (MAP_BY_ID[msg.mapId]) {
        room.mapId = msg.mapId;
        this.broadcastRoomState(room);
      }
      return;
    }

    if (msg.type === 'room:setReady') {
      if (room.phase !== 'lobby') return;
      player.ready = Boolean(msg.ready);
      this.broadcastRoomState(room);
      this.checkAutoStart(room);
      return;
    }

    if (msg.type === 'room:startNow') {
      if (room.phase !== 'lobby') return;
      if (player.playerId !== room.hostId) return;
      if (!room.isSoloPractice && !room.isTrainingMode && room.players.length < 2) {
        this.send(ws, {
          type: 'room:error',
          message: 'Wait for at least 2 players to join, or start a Vs. Bot / Training room.',
        });
        return;
      }
      this.startCountdown(room);
      return;
    }

    if (msg.type === 'room:rematch') {
      if (room.phase !== 'victory') return;
      if (player.playerId !== room.hostId) return;
      room.phase = 'lobby';
      room.winnerId = null;
      room.roundWinnerId = null;
      room.roundNumber = 1;
      room.matchTime = 0;
      room.actors = [];
      room.projectiles = [];
      room.zones = [];
      room.telegraphs = [];
      room.pickups = [];
      room.battleEvent = null;
      room.activeClash = null;
      room.activeHeadlock = null;
      room.stormActive = false;
      room.stormMaxRadius = MAP_BY_ID[room.mapId].arenaRadius;
      room.stormRadius = room.stormMaxRadius;
      room.stormTickTimer = 0;
      room.pendingEvents = [];
      room.lastInputSeq = {};
      resetRoomAwakeningState(room);
      for (const p of room.players) {
        p.ready = false;
        p.wins = 0;
      }
      this.broadcastRoomState(room);
      return;
    }

    if (msg.type === 'game:awakeningMash') {
      if (room.phase !== 'combat') return;
      handleAwakeningMash(room, player.playerId, this.getAwakeningHelpers(), msg.side);
      return;
    }

    if (msg.type === 'game:awakeningSkip') {
      if (room.phase !== 'combat' || !AWAKENING_CONFIG.ALLOW_SKIP) return;
      resolveCutsceneClash(room, this.getAwakeningHelpers(), true);
      return;
    }

    if (msg.type === 'game:cutsceneSync') {
      if (room.phase !== 'combat') return;
      syncCutsceneAudioClock(room, player.playerId, msg.clockSec, this.getAwakeningHelpers());
      return;
    }

    if (msg.type === 'game:debug') {
      if (room.phase !== 'combat') return;
      handleAwakeningDebug(room, msg.action, this.getAwakeningHelpers());
      return;
    }

    if (msg.type === 'game:input') {
      if (room.phase !== 'combat' || room.awakeningPhase === 'CUTSCENE') return;
      const actor = room.actors.find((a) => a.playerId === player.playerId);
      if (!actor || actor.isKO) return;

      if (typeof msg.seq === 'number' && Number.isFinite(msg.seq)) {
        room.lastInputSeq[player.playerId] = Math.max(room.lastInputSeq[player.playerId] ?? 0, msg.seq);
      }

      const mag = Math.hypot(msg.moveX, msg.moveZ);
      if (mag > 1) {
        actor.moveX = msg.moveX / mag;
        actor.moveZ = msg.moveZ / mag;
      } else {
        actor.moveX = Number.isFinite(msg.moveX) ? msg.moveX : 0;
        actor.moveZ = Number.isFinite(msg.moveZ) ? msg.moveZ : 0;
      }
      if (typeof msg.aimYaw === 'number' && Number.isFinite(msg.aimYaw)) {
        actor.aimYaw = msg.aimYaw;
      }
      if (typeof msg.aimPitch === 'number' && Number.isFinite(msg.aimPitch)) {
        actor.aimPitch = clamp(msg.aimPitch, -1.35, 0.55);
      }
      if (msg.targetId !== undefined) {
        actor.targetId = msg.targetId;
      }
      if (msg.blockHeld !== undefined) {
        actor.blockHeld = Boolean(msg.blockHeld);
      }
      return;
    }

    if (msg.type === 'game:toggleFlight') {
      if (room.phase !== 'combat' || room.awakeningPhase === 'CUTSCENE') return;
      const actor = room.actors.find((a) => a.playerId === player.playerId);
      if (!actor || actor.isKO || actor.fighterId !== 'jm') return;
      if (actor.actionState === 'stagger' || actor.actionState === 'clash' || actor.actionState === 'headlock') return;
      if (actor.isFlying) {
        actor.isFlying = false;
        actor.flightCooldown = room.isTrainingMode && room.trainingConfig.zeroCooldowns ? 0 : 10.0;
        actor.grounded = false;
      } else if (actor.flightCooldown <= 0.05 && actor.flightRemaining > 0.05) {
        actor.isFlying = true;
        actor.grounded = false;
        if (actor.actionState === 'idle' || actor.actionState === 'move') {
          actor.actionState = 'jump';
        }
      }
      return;
    }

    if (msg.type === 'game:trainingConfig') {
      if (!room.isTrainingMode || player.playerId !== room.hostId) return;
      if (typeof msg.dummyEnabled === 'boolean') {
        room.trainingConfig.dummyEnabled = msg.dummyEnabled;
      }
      if (typeof msg.zeroCooldowns === 'boolean') {
        room.trainingConfig.zeroCooldowns = msg.zeroCooldowns;
      }
      if (room.phase === 'combat' || room.phase === 'countdown') {
        this.syncTrainingDummy(room);
        if (room.trainingConfig.zeroCooldowns) {
          for (const a of room.actors) {
            if (a.isBot) continue;
            a.cooldowns = [0, 0, 0, 0, 0, 0, 0];
            a.dashCooldown = 0;
            a.grabCooldown = 0;
            a.flightCooldown = 0;
            a.flightRemaining = a.flightMax;
            a.mana = a.maxMana;
            a.stamina = a.maxStamina;
          }
        }
      }
      this.broadcastRoomState(room);
      return;
    }

    if (msg.type === 'game:jump') {
      if (room.phase !== 'combat' || room.awakeningPhase === 'CUTSCENE') return;
      const actor = room.actors.find((a) => a.playerId === player.playerId);
      if (!actor || actor.isKO) return;
      if (typeof msg.seq === 'number' && Number.isFinite(msg.seq)) {
        room.lastInputSeq[player.playerId] = Math.max(room.lastInputSeq[player.playerId] ?? 0, msg.seq);
      }
      this.tryJump(room, actor);
      return;
    }

    if (msg.type === 'game:dash') {
      if (room.phase !== 'combat' || room.awakeningPhase === 'CUTSCENE') return;
      const actor = room.actors.find((a) => a.playerId === player.playerId);
      if (!actor || actor.isKO) return;
      if (typeof msg.seq === 'number' && Number.isFinite(msg.seq)) {
        room.lastInputSeq[player.playerId] = Math.max(room.lastInputSeq[player.playerId] ?? 0, msg.seq);
      }
      this.tryDash(room, actor, msg.moveX, msg.moveZ, msg.aimYaw);
      return;
    }

    if (msg.type === 'game:grab') {
      if (room.phase !== 'combat' || room.awakeningPhase === 'CUTSCENE') return;
      const actor = room.actors.find((a) => a.playerId === player.playerId);
      if (!actor || actor.isKO) return;
      if (typeof msg.seq === 'number' && Number.isFinite(msg.seq)) {
        room.lastInputSeq[player.playerId] = Math.max(room.lastInputSeq[player.playerId] ?? 0, msg.seq);
      }
      if (msg.targetId !== undefined) actor.targetId = msg.targetId;
      this.tryGrab(room, actor);
      return;
    }

    if (msg.type === 'game:clashPick') {
      if (room.phase !== 'combat' || !room.activeClash) return;
      if (room.activeClash.id !== msg.clashId) return;
      const validChoice: CombatMoveType =
        msg.choice === 'strike' || msg.choice === 'grab' || msg.choice === 'parry' ? msg.choice : 'strike';
      if (room.activeClash.playerAId === player.playerId && !room.activeClash.choiceA) {
        room.activeClash.choiceA = validChoice;
      } else if (room.activeClash.playerBId === player.playerId && !room.activeClash.choiceB) {
        room.activeClash.choiceB = validChoice;
      }
      if (room.activeClash.choiceA && room.activeClash.choiceB) {
        this.resolveClash(room);
      }
      return;
    }

    if (msg.type === 'game:aimUpdate') {
      if (room.phase !== 'combat' || room.awakeningPhase === 'CUTSCENE') return;
      const actor = room.actors.find((a) => a.playerId === player.playerId);
      if (!actor || actor.isKO) return;
      if (actor.actionState === 'ultimate' && actor.abilitySlot === 5 && !actor.windupTriggered) {
        if (typeof msg.aimX === 'number' && Number.isFinite(msg.aimX) && typeof msg.aimZ === 'number' && Number.isFinite(msg.aimZ)) {
          const clamped = this.clampAimPoint(room, actor, msg.aimX, msg.aimZ, JM_SECRET_ABILITY.aimRange ?? 17.5);
          actor.pendingAimX = clamped.x;
          actor.pendingAimZ = clamped.z;
          const adx = clamped.x - actor.x;
          const adz = clamped.z - actor.z;
          if (Math.hypot(adx, adz) > 0.15) {
            actor.rotY = Math.atan2(adx, adz);
          }
          if (actor.activeTelegraphId) {
            const tel = room.telegraphs.find((t) => t.id === actor.activeTelegraphId);
            if (tel) {
              tel.x = clamped.x;
              tel.z = clamped.z;
            }
          }
        }
      }
      return;
    }

    if (msg.type === 'game:ability') {
      if (room.phase !== 'combat' || room.awakeningPhase === 'CUTSCENE') return;
      const actor = room.actors.find((a) => a.playerId === player.playerId);
      if (!actor || actor.isKO) return;
      if (typeof msg.seq === 'number' && Number.isFinite(msg.seq)) {
        room.lastInputSeq[player.playerId] = Math.max(room.lastInputSeq[player.playerId] ?? 0, msg.seq);
      }
      if (typeof msg.aimYaw === 'number' && Number.isFinite(msg.aimYaw)) {
        actor.aimYaw = msg.aimYaw;
      }
      if (typeof msg.aimPitch === 'number' && Number.isFinite(msg.aimPitch)) {
        actor.aimPitch = clamp(msg.aimPitch, -1.35, 0.55);
      }
      if (msg.targetId !== undefined) {
        actor.targetId = msg.targetId;
      }
      const aimX = typeof msg.aimX === 'number' && Number.isFinite(msg.aimX) ? msg.aimX : undefined;
      const aimZ = typeof msg.aimZ === 'number' && Number.isFinite(msg.aimZ) ? msg.aimZ : undefined;
      this.tryActivateAbility(
        room,
        actor,
        msg.slot,
        Boolean(msg.holdHeavy),
        aimX,
        aimZ,
        Boolean(msg.isHoldVariant)
      );
    }
  }

  private handleDisconnect(ws: WebSocket): void {
    const client = this.clients.get(ws);
    if (!client) return;
    this.leaveCurrentRoom(ws, false);
    this.clients.delete(ws);
  }

  private leaveCurrentRoom(ws: WebSocket, explicit: boolean): void {
    const client = this.clients.get(ws);
    if (!client || !client.roomCode || !client.playerId) return;
    const room = this.rooms.get(client.roomCode);
    const playerId = client.playerId;
    client.roomCode = null;
    client.playerId = null;

    if (this.playerSockets.get(playerId) === ws) {
      this.playerSockets.delete(playerId);
    }
    if (!room) return;

    const idx = room.players.findIndex((p) => p.playerId === playerId);
    if (idx === -1) return;

    if (
      room.awakeningPhase === 'CUTSCENE' &&
      room.awakeningCutscene &&
      (room.awakeningCutscene.p1Id === playerId || room.awakeningCutscene.p2Id === playerId)
    ) {
      cancelCutsceneGracefully(room, this.getAwakeningHelpers());
    }

    if (explicit || room.phase === 'lobby') {
      room.players.splice(idx, 1);
      room.actors = room.actors.filter((a) => a.playerId !== playerId);
      if (room.players.length === 0) {
        this.rooms.delete(room.roomCode);
        return;
      }
      if (room.hostId === playerId) {
        room.hostId = room.players[0].playerId;
      }
      if (!room.isSoloPractice && !room.isTrainingMode && room.phase !== 'lobby' && room.phase !== 'victory' && room.players.length < 2) {
        room.phase = 'victory';
        room.winnerId = room.players[0].playerId;
      }
      this.broadcastRoomState(room);
    } else {
      room.players[idx].connected = false;
      room.players[idx].disconnectedAt = Date.now();
      this.broadcastRoomState(room);
    }
  }

  private checkAutoStart(room: RoomInstance): void {
    if (room.phase !== 'lobby') return;
    const minPlayers = room.isSoloPractice || room.isTrainingMode ? 1 : 2;
    if (room.players.length < minPlayers) return;
    const allReady = room.players.every((p) => p.ready);
    if (allReady) {
      this.startCountdown(room);
    }
  }

  private createActorFromParticipant(
    room: RoomInstance,
    p: RoomPlayer,
    x: number,
    z: number,
    rotY: number
  ): InternalActor {
    const spec = FIGHTER_BY_ID[p.fighterId];
    const maxHp = p.isDummy ? 9999 : spec.maxHp;
    return {
      playerId: p.playerId,
      slotIndex: p.slotIndex,
      name: p.name,
      fighterId: p.fighterId,
      skinId: p.skinId ?? 'ascended',
      isBot: p.isBot,
      isDummy: p.isDummy,
      x,
      y: 0,
      z,
      vx: 0,
      yVel: 0,
      vz: 0,
      grounded: true,
      rotY,
      hp: maxHp,
      maxHp,
      mana: p.isDummy ? 0 : 45,
      maxMana: spec.maxMana,
      stamina: spec.maxStamina,
      maxStamina: spec.maxStamina,
      stagger: 0,
      isStunned: false,
      isOverdrive: false,
      passiveStacks: 0,
      counterFlowActive: false,
      comboCount: 0,
      comboStep: 0,
      m1Variant: 'light',
      grabCooldown: 0,
      damagePhase: 'NORMAL',
      actionState: 'idle',
      abilitySlot: null,
      actionTimer: 0,
      actionDuration: 0,
      whiffTimer: 0,
      cooldowns: [0, 0, 0, 0, 0, 0, 0],
      dashCooldown: 0,
      dashMaxCooldown: STANDALONE_DASH_COOLDOWN,
      dashCharges: 1,
      dashMaxCharges: 1,
      dashRechargeRemaining: 0,
      isFlying: false,
      flightRemaining: p.fighterId === 'jm' ? 7.0 : 0,
      flightMax: p.fighterId === 'jm' ? 7.0 : 0,
      flightCooldown: 0,
      speedBoostTimer: 0,
      superArmor: false,
      shieldActive: false,
      parryWindow: false,
      blockHeld: false,
      awakened: false,
      awakeningTransformTimer: 0,
      silencedTimer: 0,
      snareMarkedTimer: 0,
      isKO: false,
      koTime: null,
      koStyle: spec.koStyle,
      wins: p.wins,
      kills: 0,
      parryCount: 0,
      damageDealt: 0,
      moveX: 0,
      moveZ: 0,
      aimYaw: rotY,
      aimPitch: -0.35,
      targetId: null,
      windupTriggered: false,
      landedCurrentAction: false,
      pendingHoldHeavy: false,
      pendingComboLink: false,
      lastM1At: -10,
      lastHitAt: -10,
      lastDamagedAt: -10,
      lastAbilitySlot: null,
      lastAbilityAt: -10,
      iframeTimer: 0,
      parryStartedAt: -10,
      prevBlockHeld: false,
      clashCooldown: 0,
      frenzyInside: false,
      overdriveAnnounced: false,
      lastOriginX: x,
      lastOriginY: 0,
      lastOriginZ: z,
      lastCastSlot: null,
      pendingAimX: null,
      pendingAimZ: null,
      pendingHoldVariant: false,
      stage2Slot: null,
      stage2Timer: 0,
      stage2Label: '',
      stage2PendingCooldown: 0,
      rushFatigue: 0,
      rushFatigueDecayTimer: 0,
      empoweredM1Ready: false,
      perfectEvadeTimer: 0,
      evadeRewardedThisDash: false,
      dashEruptedThisDash: false,
      dashRechargeTimer: 0,
      activeTelegraphId: null,
    };
  }

  private syncTrainingDummy(room: RoomInstance): void {
    const existingIdx = room.actors.findIndex((a) => a.isDummy);
    if (room.trainingConfig.dummyEnabled) {
      if (existingIdx === -1) {
        const dummyPlayer: RoomPlayer = {
          playerId: 'training-dummy',
          slotIndex: 1,
          name: 'Target Dummy',
          fighterId: 'prime',
          skinId: 'ascended',
          ready: true,
          connected: true,
          wins: 0,
          isBot: true,
          isDummy: true,
        };
        room.actors.push(this.createActorFromParticipant(room, dummyPlayer, 0, -4.5, 0));
      }
    } else if (existingIdx !== -1) {
      const dummyId = room.actors[existingIdx].playerId;
      room.actors.splice(existingIdx, 1);
      if (
        room.activeHeadlock &&
        (room.activeHeadlock.grabberId === dummyId || room.activeHeadlock.victimId === dummyId)
      ) {
        room.activeHeadlock = null;
      }
      if (
        room.activeClash &&
        (room.activeClash.playerAId === dummyId || room.activeClash.playerBId === dummyId)
      ) {
        room.activeClash = null;
      }
      room.telegraphs = room.telegraphs.filter((t) => t.ownerId !== dummyId);
      room.zones = room.zones.filter((z) => z.ownerId !== dummyId);
    }
  }

  private startCountdown(room: RoomInstance): void {
    room.phase = 'countdown';
    room.countdown = 5.0;
    room.matchTime = 0;
    room.victoryDelayTimer = 0;
    room.roundWinnerId = null;
    room.winnerId = null;
    room.projectiles = [];
    room.zones = [];
    room.telegraphs = [];
    room.battleEvent = null;
    room.nextEventAt = 10.5;
    room.eventRotationIdx = 0;
    room.activeClash = null;
    room.activeHeadlock = null;
    room.stormActive = false;
    room.stormMaxRadius = MAP_BY_ID[room.mapId].arenaRadius;
    room.stormRadius = room.stormMaxRadius;
    room.stormTickTimer = 0;
    room.pendingEvents = [];
    room.lastInputSeq = {};
    resetRoomAwakeningState(room);
    room.obstacles = createInitialObstacleStates(room.mapId);

    room.pickups = getMapPickupSpawns(room.mapId).map((sp) => ({
      id: sp.id,
      kind: sp.kind,
      x: sp.x,
      y: getObstacleSupportY(room.mapId, sp.x, 5.0, sp.z, 0.2, room.obstacles) + 0.65,
      z: sp.z,
      active: true,
      respawnTimer: 0,
    }));

    const participants: RoomPlayer[] = [...room.players];
    if (room.isSoloPractice) {
      const playerFighter = room.players[0]?.fighterId ?? 'jm';
      const dummyFighter = FIGHTERS.find((f) => f.id !== playerFighter)?.id ?? 'prime';
      participants.push({
        playerId: 'bot-dummy',
        slotIndex: 1,
        name: `${FIGHTER_BY_ID[dummyFighter].name} (Bot)`,
        fighterId: dummyFighter,
        skinId: 'ascended',
        ready: true,
        connected: true,
        wins: 0,
        isBot: true,
      });
    } else if (room.isTrainingMode && room.trainingConfig.dummyEnabled) {
      participants.push({
        playerId: 'training-dummy',
        slotIndex: 1,
        name: 'Target Dummy',
        fighterId: 'prime',
        skinId: 'ascended',
        ready: true,
        connected: true,
        wins: 0,
        isBot: true,
        isDummy: true,
      });
    }

    const total = participants.length;
    const spawnRadius = total === 1 ? 0 : total === 2 ? 5.2 : 8.5;
    room.actors = participants.map((p, idx) => {
      if (p.isDummy) {
        return this.createActorFromParticipant(room, p, 0, -5.0, 0);
      }
      const angle = (idx / total) * Math.PI * 2 - Math.PI * 0.35;
      const rawX = total === 1 ? 0 : Math.cos(angle) * spawnRadius;
      const rawZ = total === 1 ? 4.0 : Math.sin(angle) * spawnRadius;
      const safe = resolveObstacleCollisions(room.mapId, rawX, 0, rawZ, 0.75, room.obstacles);
      const rotY = total === 1 ? Math.PI : Math.atan2(-safe.x, -safe.z);
      return this.createActorFromParticipant(room, p, safe.x, safe.z, rotY);
    });
    room.initialActorCount = room.actors.filter((a) => !a.isDummy).length;
    this.broadcastRoomState(room);
    this.broadcastSnapshot(room);
  }

  private damageObstacle(room: RoomInstance, obs: ObstacleState, dmg: number, hitX: number, hitY: number, hitZ: number, colorHex: number): void {
    if (obs.destroyed || !obs.destructible || dmg <= 0) return;
    const next = applyObstacleDamage(obs.hp, dmg);
    obs.hp = next.hp;
    obs.destroyed = next.destroyed;
    if (obs.destroyed) {
      this.pushEvent(room, {
        kind: 'obstacleBreak',
        x: obs.x,
        y: obs.topY * 0.45,
        z: obs.z,
        radius: Math.max(obs.halfW, obs.halfD),
        colorHex: obs.roofColorHex,
        callout: 'STRUCTURE SHATTERED!',
      });
    } else {
      this.pushEvent(room, {
        kind: 'block',
        x: hitX,
        y: Math.max(0.6, hitY),
        z: hitZ,
        colorHex,
      });
    }
  }

  private damageObstaclesInArea(room: RoomInstance, x: number, z: number, radius: number, dmg: number, colorHex: number): void {
    for (const obs of room.obstacles) {
      if (obs.destroyed || !obs.destructible) continue;
      const cx = clamp(x, obs.x - obs.halfW, obs.x + obs.halfW);
      const cz = clamp(z, obs.z - obs.halfD, obs.z + obs.halfD);
      if (Math.hypot(x - cx, z - cz) <= radius) {
        this.damageObstacle(room, obs, dmg, cx, obs.topY * 0.45, cz, colorHex);
      }
    }
  }

  private pushEvent(room: RoomInstance, ev: Omit<CombatEvent, 'id' | 't'>): void {
    room.eventSeq++;
    room.pendingEvents.push({
      id: `ev-${room.eventSeq}`,
      t: room.matchTime,
      ...ev,
    });
  }

  private findNearestTarget(room: RoomInstance, actor: InternalActor, maxRange: number): InternalActor | null {
    const alive = room.actors.filter((a) => a.playerId !== actor.playerId && !a.isKO);
    if (alive.length === 0) return null;
    let best: InternalActor | null = null;
    let bestDist = maxRange;
    for (const candidate of alive) {
      const d = Math.hypot(candidate.x - actor.x, candidate.z - actor.z);
      if (d < bestDist) {
        bestDist = d;
        best = candidate;
      }
    }
    return best;
  }

  private findPreferredTarget(room: RoomInstance, actor: InternalActor, maxRange: number): InternalActor | null {
    const alive = room.actors.filter((a) => a.playerId !== actor.playerId && !a.isKO);
    if (alive.length === 0) return null;

    if (actor.targetId) {
      const locked = alive.find((a) => a.playerId === actor.targetId);
      if (locked && Math.hypot(locked.x - actor.x, locked.z - actor.z) <= maxRange) {
        return locked;
      }
    }

    return this.findNearestTarget(room, actor, maxRange);
  }

  private tryJump(room: RoomInstance, actor: InternalActor): void {
    if (
      actor.isKO ||
      actor.actionState === 'stagger' ||
      actor.actionState === 'clash' ||
      actor.actionState === 'headlock'
    ) {
      return;
    }
    if (actor.fighterId === 'jm' && actor.isFlying) return;
    if (!actor.grounded) return;
    const isGravityBoost = room.battleEvent?.kind === 'gravity';
    actor.yVel = isGravityBoost ? 13.6 : 10.8;
    actor.grounded = false;
    if (actor.actionState === 'idle' || actor.actionState === 'move') {
      actor.actionState = 'jump';
    }
    this.pushEvent(room, {
      kind: 'jump',
      attackerId: actor.playerId,
      fighterId: actor.fighterId,
      x: actor.x,
      y: actor.y + 0.1,
      z: actor.z,
      colorHex: FIGHTER_BY_ID[actor.fighterId].hex,
    });
  }

  // Universal Standalone Dash (Shift / HUD Dash button) with separate 1.5s cooldown & dodge i-frames
  private tryDash(
    room: RoomInstance,
    actor: InternalActor,
    rawMoveX?: number,
    rawMoveZ?: number,
    rawAimYaw?: number
  ): void {
    if (
      actor.isKO ||
      actor.actionState === 'stagger' ||
      actor.actionState === 'clash' ||
      actor.actionState === 'headlock' ||
      actor.actionState === 'whiff'
    ) {
      return;
    }
    if (actor.dashCooldown > 0.01) return;
    const dashStamina = 14;
    if (actor.stamina < dashStamina) return;

    this.clearActorTelegraph(room, actor);
    actor.stamina = clamp(actor.stamina - dashStamina, 0, actor.maxStamina);
    actor.dashCooldown = STANDALONE_DASH_COOLDOWN;
    actor.shieldActive = false;
    actor.parryWindow = false;
    actor.blockHeld = false;
    actor.superArmor = false;
    actor.abilitySlot = null;

    const mx = typeof rawMoveX === 'number' && Number.isFinite(rawMoveX) ? rawMoveX : actor.moveX;
    const mz = typeof rawMoveZ === 'number' && Number.isFinite(rawMoveZ) ? rawMoveZ : actor.moveZ;
    let dashYaw = typeof rawAimYaw === 'number' && Number.isFinite(rawAimYaw) ? rawAimYaw : actor.rotY;
    if (Math.hypot(mx, mz) > 0.08) {
      dashYaw = Math.atan2(mx, mz);
    }
    actor.rotY = dashYaw;

    const fx = Math.sin(dashYaw);
    const fz = Math.cos(dashYaw);
    const originX = actor.x;
    const originY = actor.y;
    const originZ = actor.z;

    actor.actionState = 'dash';
    actor.actionDuration = 0.22;
    actor.actionTimer = 0.22;
    actor.windupTriggered = true;
    actor.landedCurrentAction = true;
    actor.iframeTimer = 0.24;
    actor.evadeRewardedThisDash = false;
    actor.dashEruptedThisDash = false;
    actor.vx = fx * 25.0;
    actor.vz = fz * 25.0;

    this.pushEvent(room, {
      kind: 'dash',
      attackerId: actor.playerId,
      fighterId: actor.fighterId,
      x: actor.x,
      y: actor.y + 0.9,
      z: actor.z,
      originX,
      originY: originY + 0.9,
      originZ,
      dirX: fx,
      dirZ: fz,
      colorHex: FIGHTER_BY_ID[actor.fighterId].hex,
      frenzyInside: actor.frenzyInside,
    });
  }

  // RPS Layer & 3-Second Interactive Headlock Mash Struggle!
  private tryGrab(room: RoomInstance, actor: InternalActor): void {
    // If already locked in active 3-second headlock, pressing Grab mashes the struggle counter!
    if (
      room.activeHeadlock &&
      (room.activeHeadlock.grabberId === actor.playerId || room.activeHeadlock.victimId === actor.playerId)
    ) {
      if (room.activeHeadlock.grabberId === actor.playerId) {
        room.activeHeadlock.grabberMashes += 1;
      } else {
        room.activeHeadlock.victimMashes += 1;
      }
      return;
    }

    if (
      actor.isKO ||
      actor.actionState === 'stagger' ||
      actor.actionState === 'clash' ||
      actor.actionState === 'headlock' ||
      actor.actionState === 'whiff'
    ) {
      return;
    }
    if (actor.grabCooldown > 0.01) return;
    const grabStaminaCost = 16;
    if (actor.stamina < grabStaminaCost) return;
    if (
      actor.actionTimer > 0.08 &&
      actor.actionState !== 'idle' &&
      actor.actionState !== 'move' &&
      actor.actionState !== 'jump'
    ) {
      return;
    }

    actor.stamina = clamp(actor.stamina - grabStaminaCost, 0, actor.maxStamina);
    actor.grabCooldown = 15.0;
    actor.shieldActive = false;
    actor.parryWindow = false;
    actor.blockHeld = false;

    const target = this.findPreferredTarget(room, actor, 6.0);
    if (target) {
      actor.rotY = Math.atan2(target.x - actor.x, target.z - actor.z);
    }

    actor.actionState = 'grab';
    actor.abilitySlot = null;
    actor.actionDuration = 0.34;
    actor.actionTimer = 0.34;
    actor.windupTriggered = false;
    actor.landedCurrentAction = false;
    actor.vx = Math.sin(actor.rotY) * 10.5;
    actor.vz = Math.cos(actor.rotY) * 10.5;
  }

  private executeGrabImpact(room: RoomInstance, actor: InternalActor): void {
    if (room.activeHeadlock) return;
    const fx = Math.sin(actor.rotY);
    const fz = Math.cos(actor.rotY);
    const spec = FIGHTER_BY_ID[actor.fighterId];

    for (const target of room.actors) {
      if (
        target.playerId === actor.playerId ||
        target.isKO ||
        target.actionState === 'clash' ||
        target.actionState === 'headlock'
      ) {
        continue;
      }
      if (Math.abs(target.y - actor.y) > 2.2) continue;
      const dx = target.x - actor.x;
      const dz = target.z - actor.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 3.35) continue;
      if (dist > 0.1 && (dx / dist) * fx + (dz / dist) * fz < 0.05) continue;

      const dirX = dist > 0.05 ? dx / dist : fx;
      const dirZ = dist > 0.05 ? dz / dist : fz;

      // RPS Rule: Strike beats Grab! If target is actively swinging/casting strike, grabber gets stuffed!
      if (target.actionState === 'attack' || target.actionState === 'skill') {
        actor.actionState = 'stagger';
        actor.actionTimer = 0.6;
        actor.actionDuration = 0.6;
        actor.vx = -dirX * 7.0;
        actor.vz = -dirZ * 7.0;
        actor.landedCurrentAction = true;
        this.pushEvent(room, {
          kind: 'hit',
          attackerId: target.playerId,
          targetId: actor.playerId,
          fighterId: target.fighterId,
          x: actor.x,
          y: actor.y + 1.2,
          z: actor.z,
          dirX: -dirX,
          dirZ: -dirZ,
          colorHex: FIGHTER_BY_ID[target.fighterId].hex,
          damage: 8,
          isCounter: true,
          rpsOutcome: 'strike_beats_grab',
        });
        actor.hp = Math.max(0, actor.hp - 8);
        actor.damagePhase = getDamagePhase(actor.hp, actor.maxHp, actor.isKO);
        if (actor.hp <= 0) this.eliminateActor(room, target, actor, 'normal');
        return;
      }

      // RPS Rule: Grab beats Block/Parry -> enters 3.0-second Interactive Headlock Mash!
      const wasParryWindow = target.parryWindow;
      const brokeGuard = target.shieldActive || target.actionState === 'guard' || wasParryWindow;
      this.clearActorTelegraph(room, actor);
      this.clearActorTelegraph(room, target);

      target.shieldActive = false;
      target.parryWindow = false;
      target.blockHeld = false;
      target.superArmor = false;
      target.isStunned = false;
      target.abilitySlot = null;
      actor.abilitySlot = null;
      actor.landedCurrentAction = true;

      actor.rotY = Math.atan2(dirX, dirZ);
      target.x = actor.x + dirX * 0.72;
      target.z = actor.z + dirZ * 0.72;
      target.y = actor.y;
      target.rotY = actor.rotY + Math.PI;
      actor.vx = 0;
      actor.vz = 0;
      actor.yVel = 0;
      target.vx = 0;
      target.vz = 0;
      target.yVel = 0;

      actor.actionState = 'headlock';
      actor.actionDuration = 3.0;
      actor.actionTimer = 3.0;
      target.actionState = 'headlock';
      target.actionDuration = 3.0;
      target.actionTimer = 3.0;

      room.activeHeadlock = {
        id: makeId('hl'),
        grabberId: actor.playerId,
        victimId: target.playerId,
        remaining: 3.0,
        duration: 3.0,
        grabberMashes: brokeGuard ? 3 : 1,
        victimMashes: 0,
        x: (actor.x + target.x) * 0.5,
        y: actor.y + 1.15,
        z: (actor.z + target.z) * 0.5,
      };

      this.pushEvent(room, {
        kind: 'grab',
        attackerId: actor.playerId,
        targetId: target.playerId,
        fighterId: actor.fighterId,
        x: target.x,
        y: target.y + 1.2,
        z: target.z,
        dirX,
        dirZ,
        colorHex: spec.hex,
        isCrit: brokeGuard,
        hitStopMs: brokeGuard ? 65 : 40,
        rpsOutcome: wasParryWindow ? 'weak_to_grab' : brokeGuard ? 'grab_beats_parry' : undefined,
      });
      return;
    }
  }

  private resolveHeadlock(room: RoomInstance): void {
    const hl = room.activeHeadlock;
    if (!hl) return;
    room.activeHeadlock = null;

    const grabber = room.actors.find((a) => a.playerId === hl.grabberId);
    const victim = room.actors.find((a) => a.playerId === hl.victimId);
    if (!grabber || !victim) return;

    const dx = victim.x - grabber.x;
    const dz = victim.z - grabber.z;
    const d = Math.max(0.01, Math.hypot(dx, dz));
    const dirX = dx / d;
    const dirZ = dz / d;

    if (hl.grabberMashes >= hl.victimMashes) {
      // Grabber wins headlock: Heavy Slam!
      const dmg = 24;
      grabber.actionState = grabber.grounded ? 'idle' : 'jump';
      grabber.actionTimer = 0;
      grabber.mana = clamp(grabber.mana + 18, 0, grabber.maxMana);
      if (room.matchTime - grabber.lastHitAt <= 2.0) {
        grabber.comboCount += 1;
      } else {
        grabber.comboCount = 1;
      }
      grabber.lastHitAt = room.matchTime;
      attackerAddDamage(grabber, dmg);

      victim.hp = Math.max(0, victim.hp - dmg);
      victim.damagePhase = getDamagePhase(victim.hp, victim.maxHp, victim.isKO);
      victim.lastDamagedAt = room.matchTime;
      const kbMult = victim.fighterId === 'prime' ? 0.85 : 1.0;
      victim.vx = dirX * 13.5 * kbMult;
      victim.vz = dirZ * 13.5 * kbMult;
      victim.yVel = 6.2;
      victim.grounded = false;
      victim.actionState = 'stagger';
      victim.actionTimer = 0.72;
      victim.actionDuration = 0.72;
      this.addStagger(room, grabber, victim, 40);

      this.pushEvent(room, {
        kind: 'grab',
        attackerId: grabber.playerId,
        targetId: victim.playerId,
        fighterId: grabber.fighterId,
        x: victim.x,
        y: victim.y + 1.15,
        z: victim.z,
        dirX,
        dirZ,
        colorHex: FIGHTER_BY_ID[grabber.fighterId].hex,
        damage: dmg,
        isCrit: true,
        comboHit: grabber.comboCount,
        hitStopMs: 80,
      });

      if (victim.hp <= 0) {
        this.eliminateActor(room, grabber, victim, 'grab');
      }
    } else {
      // Victim out-mashed grabber: Clean break-free with ZERO damage!
      grabber.actionState = 'whiff';
      grabber.whiffTimer = 0.32;
      grabber.actionTimer = 0;
      grabber.vx = -dirX * 9.5;
      grabber.vz = -dirZ * 9.5;

      victim.actionState = victim.grounded ? 'idle' : 'jump';
      victim.actionTimer = 0;
      victim.iframeTimer = Math.max(victim.iframeTimer, 0.35);
      victim.vx = dirX * 9.5;
      victim.vz = dirZ * 9.5;

      this.pushEvent(room, {
        kind: 'headlockBreak',
        attackerId: victim.playerId,
        targetId: grabber.playerId,
        fighterId: victim.fighterId,
        x: (grabber.x + victim.x) * 0.5,
        y: victim.y + 1.15,
        z: (grabber.z + victim.z) * 0.5,
        dirX,
        dirZ,
        colorHex: FIGHTER_BY_ID[victim.fighterId].hex,
        hitStopMs: 45,
      });
    }
  }

  private clampAimPoint(
    room: RoomInstance,
    actor: InternalActor,
    rawX: number,
    rawZ: number,
    maxRange: number
  ): { x: number; z: number } {
    const dx = rawX - actor.x;
    const dz = rawZ - actor.z;
    const d = Math.hypot(dx, dz);
    let x = rawX;
    let z = rawZ;
    if (d > maxRange && d > 0.001) {
      x = actor.x + (dx / d) * maxRange;
      z = actor.z + (dz / d) * maxRange;
    }
    const arenaLimit = MAP_BY_ID[room.mapId].arenaRadius - 0.6;
    const r = Math.hypot(x, z);
    if (r > arenaLimit && r > 0.001) {
      x = (x / r) * arenaLimit;
      z = (z / r) * arenaLimit;
    }
    return { x: Number(x.toFixed(2)), z: Number(z.toFixed(2)) };
  }

  private spawnZone(
    room: RoomInstance,
    owner: InternalActor,
    kind: ArenaZoneKind,
    x: number,
    y: number,
    z: number,
    radius: number,
    duration: number,
    colorHex: number,
    endX?: number,
    endZ?: number
  ): InternalZone {
    room.zones = room.zones.filter((zn) => !(zn.ownerId === owner.playerId && zn.kind === kind));
    const zone: InternalZone = {
      id: makeId('zone'),
      ownerId: owner.playerId,
      fighterId: owner.fighterId,
      kind,
      x,
      y,
      z,
      endX,
      endZ,
      radius,
      remaining: duration,
      maxDuration: duration,
      colorHex,
      tickTimer: 0,
      hitCooldowns: {},
    };
    room.zones.push(zone);
    this.pushEvent(room, {
      kind: 'trap',
      attackerId: owner.playerId,
      fighterId: owner.fighterId,
      x,
      y: y + 0.15,
      z,
      colorHex,
    });
    return zone;
  }

  private clearActorTelegraph(room: RoomInstance, actor: InternalActor): void {
    if (!actor.activeTelegraphId) return;
    room.telegraphs = room.telegraphs.filter((t) => t.id !== actor.activeTelegraphId);
    actor.activeTelegraphId = null;
  }

  private spawnTelegraph(
    room: RoomInstance,
    actor: InternalActor,
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
  ): void {
    this.clearActorTelegraph(room, actor);
    const id = makeId('tel');
    actor.activeTelegraphId = id;
    room.telegraphs.push({
      id,
      ownerId: actor.playerId,
      fighterId: actor.fighterId,
      kind,
      x,
      y,
      z,
      dirX,
      dirZ,
      radius,
      length,
      angleHalf,
      progress: 0,
      colorHex,
      elapsed: 0,
      windup: Math.max(0.1, windup),
    });
  }

  private executeStage2Skill(room: RoomInstance, actor: InternalActor): void {
    const spec = FIGHTER_BY_ID[actor.fighterId];
    const ab = spec.abilities[3];
    const pendingCd = actor.stage2PendingCooldown > 0 ? actor.stage2PendingCooldown : ab.cooldown;
    actor.stage2Slot = null;
    actor.stage2Timer = 0;
    actor.stage2Label = '';
    actor.stage2PendingCooldown = 0;
    actor.cooldowns[3] = pendingCd;
    actor.stamina = clamp(actor.stamina - 10, 0, actor.maxStamina);
    actor.lastAbilitySlot = 3;
    actor.lastAbilityAt = room.matchTime;
    actor.lastCastSlot = 3;

    if (actor.fighterId === 'marjohn') {
      // Stage 2: SKYBURST LAUNCH — detonates active Gale Snare (or self) upward!
      const snare = room.zones.find((z) => z.ownerId === actor.playerId && z.kind === 'galeSnare');
      const cx = snare ? snare.x : actor.x;
      const cz = snare ? snare.z : actor.z;
      const cy = snare ? snare.y : actor.y;
      if (snare) {
        room.zones = room.zones.filter((z) => z.id !== snare.id);
      }
      actor.actionState = 'skill';
      actor.actionDuration = 0.34;
      actor.actionTimer = 0.34;
      actor.windupTriggered = true;
      actor.landedCurrentAction = true;
      this.pushEvent(room, {
        kind: 'trapTrigger',
        attackerId: actor.playerId,
        fighterId: 'marjohn',
        x: cx,
        y: cy + 0.3,
        z: cz,
        colorHex: spec.hex,
        abilitySlot: 3,
        callout: 'SKYBURST LAUNCH!',
      });
      this.pushEvent(room, {
        kind: 'shockwave',
        attackerId: actor.playerId,
        fighterId: 'marjohn',
        x: cx,
        y: cy + 0.15,
        z: cz,
        colorHex: spec.hex,
        abilitySlot: 3,
        isComboLink: true,
      });
      for (const target of room.actors) {
        if (target.playerId === actor.playerId || target.isKO) continue;
        const d = Math.hypot(target.x - cx, target.z - cz);
        if (d <= 4.1) {
          const calc = this.computeDynamicDamage(actor, target, 21, 3);
          const hit = this.applyHit(
            room,
            actor,
            target,
            calc.dmg,
            32 + calc.staggerBonus,
            5.0,
            d > 0.05 ? (target.x - cx) / d : 0,
            d > 0.05 ? (target.z - cz) / d : 1,
            spec.hex,
            true,
            false,
            false,
            calc.isCrit,
            calc.isBackstab
          );
          if (hit) {
            target.yVel = Math.max(target.yVel, 9.2);
            target.grounded = false;
          }
        }
      }
      return;
    }

    if (actor.fighterId === 'prime') {
      // Stage 2: CRATER SLAM — leaps forward and slams down leaving Molten Fissure!
      const foe = this.findPreferredTarget(room, actor, 10.0);
      if (foe) {
        actor.rotY = Math.atan2(foe.x - actor.x, foe.z - actor.z);
      }
      const fx = Math.sin(actor.rotY);
      const fz = Math.cos(actor.rotY);
      actor.actionState = 'skill';
      actor.actionDuration = ab.duration;
      actor.actionTimer = ab.duration;
      actor.abilitySlot = 3;
      actor.windupTriggered = false;
      actor.landedCurrentAction = false;
      actor.pendingHoldVariant = true; // marks impact to execute Crater Slam + Molten Fissure
      actor.pendingAimX = null;
      actor.pendingAimZ = null;
      actor.yVel = 6.8;
      actor.grounded = false;
      actor.vx = fx * 9.5;
      actor.vz = fz * 9.5;
      this.spawnTelegraph(
        room,
        actor,
        'circle',
        actor.x + fx * 2.2,
        actor.y,
        actor.z + fz * 2.2,
        fx,
        fz,
        4.2,
        0,
        0,
        ab.windup,
        spec.hex
      );
      this.pushEvent(room, {
        kind: 'cast',
        attackerId: actor.playerId,
        fighterId: 'prime',
        x: actor.x,
        y: actor.y + 1.0,
        z: actor.z,
        dirX: fx,
        dirZ: fz,
        colorHex: spec.hex,
        abilitySlot: 3,
        isComboLink: true,
        callout: 'CRATER SLAM!',
      });
      return;
    }

    if (actor.fighterId === 'khen') {
      // Stage 2: SHADOW SWAP — instant void teleport to Void Anchor with burst!
      const anchor = room.zones.find((z) => z.ownerId === actor.playerId && z.kind === 'voidAnchor');
      if (!anchor) return;
      const originX = actor.x;
      const originY = actor.y;
      const originZ = actor.z;
      room.zones = room.zones.filter((z) => z.id !== anchor.id);
      const safe = resolveObstacleCollisions(room.mapId, anchor.x, actor.y, anchor.z, 0.48, room.obstacles);
      actor.x = safe.x;
      actor.z = safe.z;
      actor.y = anchor.y;
      actor.yVel = 0;
      actor.grounded = true;
      actor.iframeTimer = Math.max(actor.iframeTimer, 0.22);
      actor.actionState = 'skill';
      actor.actionDuration = 0.28;
      actor.actionTimer = 0.28;
      actor.windupTriggered = true;
      actor.landedCurrentAction = true;

      this.pushEvent(room, {
        kind: 'trapTrigger',
        attackerId: actor.playerId,
        fighterId: 'khen',
        x: actor.x,
        y: actor.y + 1.0,
        z: actor.z,
        originX,
        originY: originY + 1.0,
        originZ,
        colorHex: spec.hex,
        abilitySlot: 3,
        isComboLink: true,
        callout: 'SHADOW SWAP!',
      });
      this.pushEvent(room, {
        kind: 'shockwave',
        attackerId: actor.playerId,
        fighterId: 'khen',
        x: actor.x,
        y: actor.y + 0.15,
        z: actor.z,
        originX,
        originY: originY + 0.9,
        originZ,
        colorHex: spec.hex,
        abilitySlot: 3,
        isComboLink: true,
      });

      for (const target of room.actors) {
        if (target.playerId === actor.playerId || target.isKO) continue;
        const d = Math.hypot(target.x - actor.x, target.z - actor.z);
        if (d <= 3.4) {
          const calc = this.computeDynamicDamage(actor, target, 16, 3);
          this.applyHit(
            room,
            actor,
            target,
            calc.dmg,
            24 + calc.staggerBonus,
            8.0,
            d > 0.05 ? (target.x - actor.x) / d : 0,
            d > 0.05 ? (target.z - actor.z) / d : 1,
            spec.hex,
            true,
            false,
            false,
            calc.isCrit,
            calc.isBackstab
          );
        }
      }
    }
  }

  private tryActivateAbility(
    room: RoomInstance,
    actor: InternalActor,
    slot: AbilitySlot,
    holdHeavy = false,
    rawAimX?: number,
    rawAimZ?: number,
    isHoldVariant = false
  ): void {
    if (room.awakeningPhase === 'CUTSCENE') return;
    if (actor.isKO || actor.actionState === 'clash' || actor.actionState === 'whiff' || actor.actionState === 'headlock') return;
    if (actor.actionState === 'stagger') return;
    if (actor.silencedTimer > 0 && slot >= 2) return;
    if (slot === 6 && !actor.awakened) return;

    // Stage 2 Multi-Stage Skill execution (e.g. Skyburst Launch, Crater Slam, Shadow Swap)
    if (!actor.awakened && slot === 3 && actor.stage2Slot === 3 && actor.stage2Timer > 0 && actor.cooldowns[3] <= 0.01) {
      if (actor.stamina >= 10) {
        this.executeStage2Skill(room, actor);
      }
      return;
    }

    // Combo-into-Skill Cancel: allow cancelling M1 step 2/3/4 (or late M1) directly into Skill 1/2/4!
    const canCancelM1IntoSkill =
      actor.actionState === 'attack' &&
      (slot === 2 || slot === 3 || slot === 6) &&
      (actor.comboStep >= 2 || actor.actionTimer <= 0.16);

    if (
      !canCancelM1IntoSkill &&
      actor.actionTimer > 0.08 &&
      actor.actionState !== 'idle' &&
      actor.actionState !== 'move' &&
      actor.actionState !== 'jump'
    ) {
      return;
    }

    if (slot === 5 && (actor.fighterId !== 'jm' || !isJtinsullenTag(actor.name))) {
      return;
    }

    if (actor.cooldowns[slot] > 0.01) return;

    const spec = FIGHTER_BY_ID[actor.fighterId];
    const awAb =
      actor.awakened && (slot === 0 || slot === 2 || slot === 3 || slot === 4 || slot === 6)
        ? getAwakenedAbility(actor.fighterId, slot as 0 | 2 | 3 | 4 | 6)
        : null;
    const baseIdx = slot === 6 ? 4 : slot === 5 ? 4 : slot;
    const ab = awAb
      ? {
          ...awAb,
          manaCost: awAb.chiCost,
          staminaCost: 0,
        }
      : slot === 5
      ? JM_SECRET_ABILITY
      : spec.abilities[baseIdx];

    const { reqMana, reqStam } = computeAbilityResourceCost(
      { manaCost: ab.manaCost, staminaCost: ab.staminaCost },
      {
        awakened: actor.awakened,
        counterFlowActive: actor.counterFlowActive,
        slot,
        holdHeavy,
      }
    );

    if (actor.mana < reqMana || actor.stamina < reqStam) return;

    actor.mana = clamp(actor.mana - reqMana, 0, actor.maxMana);
    actor.stamina = clamp(actor.stamina - reqStam, 0, actor.maxStamina);

    // Check Clash Trigger against nearby incoming Ultimate!
    if (slot === 1 || slot === 0) {
      const ultAttacker = room.actors.find(
        (other) =>
          other.playerId !== actor.playerId &&
          !other.isKO &&
          other.actionState === 'ultimate' &&
          !other.windupTriggered &&
          other.abilitySlot !== 5 &&
          actor.clashCooldown <= 0 &&
          other.clashCooldown <= 0 &&
          Math.hypot(other.x - actor.x, other.z - actor.z) <= 6.8
      );
      if (ultAttacker && !room.activeClash) {
        this.startClash(room, ultAttacker, actor);
        return;
      }
    }

    let clampedAim: { x: number; z: number } | null = null;
    if (rawAimX !== undefined && rawAimZ !== undefined) {
      clampedAim = this.clampAimPoint(
        room,
        actor,
        rawAimX,
        rawAimZ,
        slot === 0 ? Math.max(ab.range, 16.0) : (ab.aimRange ?? 9.5)
      );
    }

    const searchRange =
      slot === 0
        ? actor.fighterId === 'jm' && actor.isFlying
          ? 18.0
          : actor.fighterId === 'damen'
          ? 11.5
          : actor.fighterId === 'marjohn'
          ? 9.0
          : 5.5
        : Math.max(ab.range + 4.0, 14.5);

    const target =
      slot === 0
        ? this.findNearestTarget(room, actor, searchRange)
        : this.findPreferredTarget(room, actor, searchRange);

    if (clampedAim && (slot === 0 || slot === 2 || slot === 3 || slot === 4 || slot === 5)) {
      const adx = clampedAim.x - actor.x;
      const adz = clampedAim.z - actor.z;
      if (Math.hypot(adx, adz) > 0.15) {
        actor.rotY = Math.atan2(adx, adz);
      }
    } else if (slot === 0 && actor.fighterId === 'jm' && actor.isFlying) {
      // Flying JM tap auto-aims nearest enemy or moves in input/facing direction
      actor.rotY = target
        ? Math.atan2(target.x - actor.x, target.z - actor.z)
        : Math.abs(actor.moveX) > 0.1 || Math.abs(actor.moveZ) > 0.1
        ? Math.atan2(actor.moveX, actor.moveZ)
        : actor.rotY;
    } else if (target) {
      actor.rotY = Math.atan2(target.x - actor.x, target.z - actor.z);
    } else if (
      (slot === 0 || slot === 2 || slot === 3 || slot === 4) &&
      (Math.abs(actor.moveX) > 0.1 || Math.abs(actor.moveZ) > 0.1)
    ) {
      actor.rotY = Math.atan2(actor.moveX, actor.moveZ);
    }

    // Cooldown calculation (Restored Slot 2 Skills + Multi-stage Slot 3 + 0.5s JM Air M1 cadence)
    let cd = ab.cooldown;
    if (slot === 0 && actor.fighterId === 'jm' && actor.isFlying) {
      cd = 0.5;
    } else if (slot === 0 && actor.fighterId === 'khen' && actor.frenzyInside) {
      cd = ab.cooldown * 0.85;
    }

    const zeroCdActive = room.isTrainingMode && room.trainingConfig.zeroCooldowns && !actor.isBot;

    const opensStage2 =
      !actor.awakened &&
      slot === 3 &&
      ((actor.fighterId === 'prime' && !isHoldVariant) ||
        actor.fighterId === 'marjohn' ||
        actor.fighterId === 'khen');

    if (opensStage2) {
      actor.cooldowns[3] = zeroCdActive ? 0 : 0.3;
      actor.stage2Slot = 3;
      actor.stage2Timer = actor.fighterId === 'marjohn' ? 3.8 : actor.fighterId === 'khen' ? 3.4 : 2.5;
      actor.stage2Label = ab.stage2Label ?? 'FOLLOW-UP';
      actor.stage2PendingCooldown = zeroCdActive ? 0 : cd;
    } else {
      const krenFrenzyCd = actor.fighterId === 'khen' && actor.frenzyInside && slot >= 2 ? 0.75 : 1.0;
      actor.cooldowns[slot] = zeroCdActive ? 0 : cd * krenFrenzyCd;
      if (slot === 3) {
        actor.stage2Slot = null;
        actor.stage2Timer = 0;
        actor.stage2Label = '';
      }
    }

    // Detect Combo Links (Slot 2 Skill <-> Slot 3 Skill or M1 Cancel -> Skill)
    const linkAge = room.matchTime - actor.lastAbilityAt;
    let isComboLink = false;
    if (
      slot === 3 &&
      linkAge <= 1.8 &&
      actor.lastAbilitySlot === 2 &&
      (actor.fighterId === 'marjohn' || actor.fighterId === 'khen' || actor.fighterId === 'jm')
    ) {
      isComboLink = true;
    } else if (
      slot === 2 &&
      linkAge <= 1.8 &&
      actor.lastAbilitySlot === 3 &&
      (actor.fighterId === 'prime' || actor.fighterId === 'damen')
    ) {
      isComboLink = true;
    } else if (canCancelM1IntoSkill && slot === 3) {
      isComboLink = true;
    }

    const linkOriginX = actor.lastOriginX;
    const linkOriginY = actor.lastOriginY;
    const linkOriginZ = actor.lastOriginZ;
    actor.lastOriginX = actor.x;
    actor.lastOriginY = actor.y;
    actor.lastOriginZ = actor.z;
    actor.lastCastSlot = slot;

    if (isComboLink) {
      this.pushEvent(room, {
        kind: 'comboLink',
        attackerId: actor.playerId,
        fighterId: actor.fighterId,
        x: actor.x,
        y: actor.y + 1.15,
        z: actor.z,
        originX: linkOriginX,
        originY: linkOriginY + 1.0,
        originZ: linkOriginZ,
        dirX: Math.sin(actor.rotY),
        dirZ: Math.cos(actor.rotY),
        colorHex: spec.hex,
        abilitySlot: slot,
        isComboLink: true,
        frenzyInside: actor.frenzyInside,
      });
    }

    actor.pendingComboLink = isComboLink;
    actor.pendingAimX = clampedAim ? clampedAim.x : null;
    actor.pendingAimZ = clampedAim ? clampedAim.z : null;
    actor.pendingHoldVariant = Boolean(isHoldVariant && clampedAim);
    actor.lastAbilitySlot = slot;
    actor.lastAbilityAt = room.matchTime;
    actor.abilitySlot = slot;
    actor.windupTriggered = false;
    actor.landedCurrentAction = false;
    actor.shieldActive = false;
    actor.parryWindow = false;
    actor.pendingHoldHeavy = false;
    actor.superArmor = false;

    const castDirX = Math.sin(actor.rotY);
    const castDirZ = Math.cos(actor.rotY);

    if (awAb && (slot === 0 || slot === 2 || slot === 3 || slot === 4 || slot === 6)) {
      setupAwakenedAbilityWindup(
        room,
        actor,
        slot as 0 | 2 | 3 | 4 | 6,
        castDirX,
        castDirZ,
        clampedAim,
        this.getAwakeningHelpers()
      );
      return;
    }

    if (slot === 0) {
      const isSingleHitRanged =
        actor.fighterId === 'damen' ||
        actor.fighterId === 'marjohn' ||
        (actor.fighterId === 'jm' && actor.isFlying);

      if (isSingleHitRanged) {
        actor.comboStep = 1;
      } else {
        // Advance 4-hit M1 chain for JM Ground, Prime, Khen!
        if (room.matchTime - actor.lastM1At <= 1.55) {
          actor.comboStep = ((actor.comboStep % 4) + 1) as 1 | 2 | 3 | 4;
        } else {
          actor.comboStep = 1;
        }
      }
      actor.lastM1At = room.matchTime;

      const is4thFinisher = !isSingleHitRanged && actor.comboStep === 4;
      const is3rdBeam = actor.fighterId === 'jm' && !actor.isFlying && actor.comboStep === 3;
      actor.m1Variant = is4thFinisher || (holdHeavy && actor.comboStep >= 3) ? 'heavy' : 'light';
      actor.pendingHoldHeavy = is4thFinisher;

      // Prime Juggernaut Armor passive during 4th-hit Ground Slam wind-up!
      if (actor.fighterId === 'prime' && is4thFinisher) {
        actor.superArmor = true;
      }

      const dur =
        actor.fighterId === 'jm' && actor.isFlying
          ? 0.24
          : is4thFinisher
          ? 0.28
          : is3rdBeam
          ? 0.26
          : ab.duration;

      actor.actionState = 'attack';
      actor.actionDuration = dur;
      actor.actionTimer = dur;

      if (!isSingleHitRanged) {
        if (actor.fighterId === 'khen' && is4thFinisher) {
          actor.vx = castDirX * 15.8;
          actor.vz = castDirZ * 15.8;
        } else if (actor.fighterId === 'jm' && is4thFinisher) {
          actor.vx = castDirX * 16.5;
          actor.vz = castDirZ * 16.5;
        } else if (actor.fighterId === 'prime' && is4thFinisher) {
          actor.vx = castDirX * 4.5;
          actor.vz = castDirZ * 4.5;
          actor.yVel = Math.max(actor.yVel, 3.6);
          actor.grounded = false;
        } else {
          actor.vx = castDirX * 5.2;
          actor.vz = castDirZ * 5.2;
        }
      }

      if (actor.fighterId === 'prime' && is4thFinisher) {
        this.spawnTelegraph(
          room,
          actor,
          'circle',
          actor.x,
          actor.y,
          actor.z,
          castDirX,
          castDirZ,
          3.8,
          0,
          0,
          ab.windup + 0.08,
          spec.hex
        );
      }

      this.pushEvent(room, {
        kind: 'cast',
        attackerId: actor.playerId,
        fighterId: actor.fighterId,
        x: actor.x,
        y: actor.y + 1.1,
        z: actor.z,
        dirX: castDirX,
        dirZ: castDirZ,
        colorHex: spec.hex,
        abilitySlot: 0,
        comboStep: actor.comboStep,
        m1Variant: actor.m1Variant,
        frenzyInside: actor.frenzyInside,
      });
    } else if (slot === 1) {
      actor.actionState = 'guard';
      actor.actionDuration = ab.duration;
      actor.actionTimer = ab.duration;
      actor.shieldActive = true;
      actor.parryWindow = true;
      actor.parryStartedAt = room.matchTime;
      this.pushEvent(room, {
        kind: 'cast',
        attackerId: actor.playerId,
        fighterId: actor.fighterId,
        x: actor.x,
        y: actor.y + 1.05,
        z: actor.z,
        dirX: castDirX,
        dirZ: castDirZ,
        colorHex: spec.hex,
        abilitySlot: 1,
        frenzyInside: actor.frenzyInside,
      });
    } else if (slot === 2) {
      // Restored Character Slot 2 Signature Skills (no longer overwritten by generic Dash!)
      actor.actionState = 'skill';
      actor.actionDuration = ab.duration;
      actor.actionTimer = ab.duration;

      const aimDest = clampedAim ?? {
        x: actor.x + castDirX * Math.min(ab.aimRange ?? 6.5, 5.8),
        z: actor.z + castDirZ * Math.min(ab.aimRange ?? 6.5, 5.8),
      };

      if (actor.fighterId === 'marjohn') {
        // Cloud Vault: vault up & arc toward aim/forward landing before slamming down
        const dx = aimDest.x - actor.x;
        const dz = aimDest.z - actor.z;
        const d = Math.max(0.1, Math.hypot(dx, dz));
        const travelSpd = Math.min(18.0, d / Math.max(0.18, ab.windup));
        actor.yVel = 7.4;
        actor.grounded = false;
        actor.vx = (dx / d) * travelSpd;
        actor.vz = (dz / d) * travelSpd;
        this.spawnTelegraph(
          room,
          actor,
          'circle',
          aimDest.x,
          getMapTerrainHeight(room.mapId, aimDest.x, aimDest.z),
          aimDest.z,
          castDirX,
          castDirZ,
          3.8,
          0,
          0,
          ab.windup,
          spec.hex
        );
      } else if (actor.fighterId === 'prime') {
        // Meteor Charge: blazing bull rush along line
        actor.superArmor = true;
        actor.vx = castDirX * 16.5;
        actor.vz = castDirZ * 16.5;
        this.spawnTelegraph(
          room,
          actor,
          'line',
          actor.x,
          getMapTerrainHeight(room.mapId, actor.x, actor.z),
          actor.z,
          castDirX,
          castDirZ,
          2.1,
          7.5,
          0,
          ab.windup,
          spec.hex
        );
      } else if (actor.fighterId === 'damen') {
        // Outlaw Roll: evasive roll with brief i-frames + Deadeye Fan Shot
        actor.iframeTimer = Math.max(actor.iframeTimer, 0.24);
        const rollDirX = Math.hypot(actor.moveX, actor.moveZ) > 0.1 ? actor.moveX : -castDirX;
        const rollDirZ = Math.hypot(actor.moveX, actor.moveZ) > 0.1 ? actor.moveZ : -castDirZ;
        const rMag = Math.max(0.01, Math.hypot(rollDirX, rollDirZ));
        actor.vx = (rollDirX / rMag) * 14.0;
        actor.vz = (rollDirZ / rMag) * 14.0;
      } else if (actor.fighterId === 'khen') {
        // Shadow Blink: telegraph arrival zone before void warp
        this.spawnTelegraph(
          room,
          actor,
          'circle',
          aimDest.x,
          getMapTerrainHeight(room.mapId, aimDest.x, aimDest.z),
          aimDest.z,
          castDirX,
          castDirZ,
          3.2,
          0,
          0,
          ab.windup,
          spec.hex
        );
      } else if (actor.fighterId === 'jm') {
        // Flash Step: golden blink corridor
        this.spawnTelegraph(
          room,
          actor,
          'line',
          actor.x,
          getMapTerrainHeight(room.mapId, actor.x, actor.z),
          actor.z,
          castDirX,
          castDirZ,
          2.2,
          7.5,
          0,
          ab.windup,
          spec.hex
        );
      }

      this.pushEvent(room, {
        kind: 'cast',
        attackerId: actor.playerId,
        fighterId: actor.fighterId,
        x: actor.x,
        y: actor.y + 1.0,
        z: actor.z,
        originX: isComboLink ? linkOriginX : undefined,
        originY: isComboLink ? linkOriginY + 1.0 : undefined,
        originZ: isComboLink ? linkOriginZ : undefined,
        dirX: castDirX,
        dirZ: castDirZ,
        colorHex: spec.hex,
        abilitySlot: 2,
        isComboLink,
        frenzyInside: actor.frenzyInside,
      });
    } else if (slot === 3) {
      actor.actionState = 'skill';
      actor.actionDuration = ab.duration;
      actor.actionTimer = ab.duration;
      if (actor.fighterId === 'prime') {
        if (actor.pendingHoldVariant && clampedAim) {
          const d = Math.max(0.1, Math.hypot(clampedAim.x - actor.x, clampedAim.z - actor.z));
          actor.yVel = 7.2;
          actor.grounded = false;
          actor.vx = ((clampedAim.x - actor.x) / d) * Math.min(14.5, d / Math.max(0.2, ab.windup));
          actor.vz = ((clampedAim.z - actor.z) / d) * Math.min(14.5, d / Math.max(0.2, ab.windup));
          this.spawnTelegraph(
            room,
            actor,
            'circle',
            clampedAim.x,
            actor.y,
            clampedAim.z,
            castDirX,
            castDirZ,
            4.2,
            0,
            0,
            ab.windup,
            spec.hex
          );
        } else {
          // Stage 1 Magma Uppercut step
          actor.vx = castDirX * 8.2;
          actor.vz = castDirZ * 8.2;
        }
      } else if (actor.fighterId === 'jm' && !actor.pendingHoldVariant) {
        actor.yVel = 6.2;
        actor.grounded = false;
        actor.vx = castDirX * 6.8;
        actor.vz = castDirZ * 6.8;
      }

      this.pushEvent(room, {
        kind: 'cast',
        attackerId: actor.playerId,
        fighterId: actor.fighterId,
        x: actor.x,
        y: actor.y + 1.0,
        z: actor.z,
        originX: isComboLink ? linkOriginX : undefined,
        originY: isComboLink ? linkOriginY + 1.0 : undefined,
        originZ: isComboLink ? linkOriginZ : undefined,
        dirX: castDirX,
        dirZ: castDirZ,
        colorHex: spec.hex,
        abilitySlot: 3,
        isComboLink,
        frenzyInside: actor.frenzyInside,
        counterFlow: actor.counterFlowActive,
      });
    } else if (slot === 4) {
      actor.actionState = 'ultimate';
      actor.actionDuration = ab.duration;
      actor.actionTimer = ab.duration;

      const aimPt = clampedAim ?? {
        x: actor.x + castDirX * (actor.fighterId === 'prime' ? 2.2 : 3.2),
        z: actor.z + castDirZ * (actor.fighterId === 'prime' ? 2.2 : 3.2),
      };

      if (actor.fighterId === 'marjohn') {
        this.spawnTelegraph(room, actor, 'circle', aimPt.x, actor.y, aimPt.z, castDirX, castDirZ, 5.2, 0, 0, ab.windup, spec.hex);
      } else if (actor.fighterId === 'prime') {
        this.spawnTelegraph(room, actor, 'circle', aimPt.x, actor.y, aimPt.z, castDirX, castDirZ, 4.5, 0, 0, ab.windup, spec.hex);
      } else if (actor.fighterId === 'damen') {
        this.spawnTelegraph(room, actor, 'cone', actor.x, actor.y, actor.z, castDirX, castDirZ, 0, 14.5, 0.38, ab.windup, spec.hex);
      } else if (actor.fighterId === 'khen') {
        this.spawnTelegraph(room, actor, 'line', actor.x, actor.y, actor.z, castDirX, castDirZ, 2.2, 9.5, 0, ab.windup, spec.hex);
      } else if (actor.fighterId === 'jm') {
        this.spawnTelegraph(room, actor, 'line', actor.x, actor.y, actor.z, castDirX, castDirZ, 2.3, 15.0, 0, ab.windup, spec.hex);
      }

      this.pushEvent(room, {
        kind: 'cast',
        attackerId: actor.playerId,
        fighterId: actor.fighterId,
        x: actor.x,
        y: actor.y + 1.0,
        z: actor.z,
        dirX: castDirX,
        dirZ: castDirZ,
        colorHex: spec.hex,
        abilitySlot: 4,
        frenzyInside: actor.frenzyInside,
        counterFlow: actor.counterFlowActive,
      });
      this.pushEvent(room, {
        kind: 'shockwave',
        attackerId: actor.playerId,
        fighterId: actor.fighterId,
        x: actor.x,
        y: actor.y + 0.15,
        z: actor.z,
        dirX: castDirX,
        dirZ: castDirZ,
        colorHex: spec.hex,
        abilitySlot: 4,
        callout: `${ab.name.toUpperCase()} — DODGE OR CLASH!`,
      });
      if (actor.fighterId === 'marjohn' && !actor.pendingHoldVariant) {
        actor.vx = castDirX * 14.5;
        actor.vz = castDirZ * 14.5;
      }
    } else if (slot === 5) {
      // JM Secret Jtinsullen Ultimate: Solar Meteor Sky Charge & Aim!
      const aimPt =
        clampedAim ??
        (target
          ? this.clampAimPoint(room, actor, target.x, target.z, ab.aimRange ?? 17.5)
          : this.clampAimPoint(room, actor, actor.x + castDirX * 5.0, actor.z + castDirZ * 5.0, ab.aimRange ?? 17.5));
      actor.pendingAimX = aimPt.x;
      actor.pendingAimZ = aimPt.z;
      actor.actionState = 'ultimate';
      actor.actionDuration = ab.duration;
      actor.actionTimer = ab.duration;
      actor.iframeTimer = Math.max(actor.iframeTimer, ab.windup + 0.18);
      actor.vx = 0;
      actor.vz = 0;
      actor.yVel = 0;
      actor.grounded = false;

      const aimGroundY = getMapTerrainHeight(room.mapId, aimPt.x, aimPt.z);
      this.spawnTelegraph(
        room,
        actor,
        'circle',
        aimPt.x,
        aimGroundY,
        aimPt.z,
        castDirX,
        castDirZ,
        ab.aimRadius ?? 6.2,
        0,
        0,
        ab.windup,
        0xfacc15
      );
      this.pushEvent(room, {
        kind: 'fireballCharge',
        attackerId: actor.playerId,
        fighterId: 'jm',
        x: actor.x,
        y: actor.y + 2.2,
        z: actor.z,
        dirX: castDirX,
        dirZ: castDirZ,
        colorHex: 0xfacc15,
        abilitySlot: 5,
        callout: 'SOLAR METEOR CHARGING!',
      });
    }
  }

  private startClash(room: RoomInstance, a: InternalActor, b: InternalActor): void {
    const midX = (a.x + b.x) * 0.5;
    const midZ = (a.z + b.z) * 0.5;
    const midY = Math.max(a.y, b.y);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d = Math.max(0.01, Math.hypot(dx, dz));
    const nx = dx / d;
    const nz = dz / d;

    a.x = midX - nx * 1.15;
    a.z = midZ - nz * 1.15;
    b.x = midX + nx * 1.15;
    b.z = midZ + nz * 1.15;
    a.rotY = Math.atan2(nx, nz);
    b.rotY = Math.atan2(-nx, -nz);

    [a, b].forEach((act) => {
      this.clearActorTelegraph(room, act);
      act.vx = 0;
      act.vz = 0;
      act.actionState = 'clash';
      act.actionTimer = 2.4;
      act.actionDuration = 2.4;
      act.abilitySlot = null;
      act.shieldActive = false;
      act.parryWindow = false;
      act.clashCooldown = 8.0;
    });

    const clashId = makeId('clash');
    room.activeClash = {
      id: clashId,
      playerAId: a.playerId,
      playerBId: b.playerId,
      remaining: 2.35,
      maxTime: 2.35,
      choiceA: null,
      choiceB: null,
      x: midX,
      y: midY + 1.1,
      z: midZ,
    };

    this.pushEvent(room, {
      kind: 'clashStart',
      attackerId: a.playerId,
      targetId: b.playerId,
      x: midX,
      y: midY + 1.1,
      z: midZ,
      colorHex: 0xfacc15,
      hitStopMs: 90,
      callout: 'CLASH SHOWDOWN!',
    });
  }

  private resolveClash(room: RoomInstance): void {
    const clash = room.activeClash;
    if (!clash) return;
    room.activeClash = null;

    const a = room.actors.find((x) => x.playerId === clash.playerAId);
    const b = room.actors.find((x) => x.playerId === clash.playerBId);
    if (!a || !b) return;

    const cA: CombatMoveType = clash.choiceA ?? 'strike';
    const cB: CombatMoveType = clash.choiceB ?? 'strike';

    // Strike > Grab > Parry > Strike
    let winner = a;
    let loser = b;
    if (cA === cB) {
      const scoreA = a.stamina + a.comboCount * 5;
      const scoreB = b.stamina + b.comboCount * 5;
      if (scoreB > scoreA) {
        winner = b;
        loser = a;
      }
    } else if (
      (cB === 'strike' && cA === 'grab') ||
      (cB === 'grab' && cA === 'parry') ||
      (cB === 'parry' && cA === 'strike')
    ) {
      winner = b;
      loser = a;
    }

    const dx = loser.x - winner.x;
    const dz = loser.z - winner.z;
    const d = Math.max(0.01, Math.hypot(dx, dz));
    const nx = dx / d;
    const nz = dz / d;

    const dmg = 26;
    winner.actionState = 'idle';
    winner.actionTimer = 0;
    winner.mana = clamp(winner.mana + 25, 0, winner.maxMana);
    winner.stamina = clamp(winner.stamina + 25, 0, winner.maxStamina);
    winner.damageDealt += dmg;
    winner.comboCount += 1;

    loser.hp = Math.max(0, loser.hp - dmg);
    loser.damagePhase = getDamagePhase(loser.hp, loser.maxHp, loser.isKO);
    loser.lastDamagedAt = room.matchTime;
    loser.vx = nx * 13.5;
    loser.vz = nz * 13.5;
    loser.yVel = 6.0;
    loser.grounded = false;
    loser.actionState = 'stagger';
    loser.actionTimer = 0.85;
    loser.actionDuration = 0.85;
    this.addStagger(room, winner, loser, 42);

    this.pushEvent(room, {
      kind: 'clashWin',
      attackerId: winner.playerId,
      targetId: loser.playerId,
      fighterId: winner.fighterId,
      x: clash.x,
      y: clash.y,
      z: clash.z,
      dirX: nx,
      dirZ: nz,
      colorHex: FIGHTER_BY_ID[winner.fighterId].hex,
      damage: dmg,
      isCrit: true,
      hitStopMs: 110,
      callout: `${FIGHTER_BY_ID[winner.fighterId].name} WINS CLASH!`,
    });

    if (loser.hp <= 0) {
      this.eliminateActor(room, winner, loser, 'clash');
    }
  }

  private addStagger(room: RoomInstance, attacker: InternalActor, target: InternalActor, amount: number): void {
    if (target.isKO || target.isStunned) return;
    let mult = 1.0;
    if (target.actionState === 'whiff') mult *= 1.4;
    // Prime Blaze Fury armor grants light stagger resistance during swings
    if (target.fighterId === 'prime' && (target.actionState === 'attack' || target.actionState === 'skill')) {
      mult *= 0.8;
    }
    target.stagger = clamp(target.stagger + Math.round(amount * mult), 0, 100);
    if (target.stagger >= 100) {
      target.stagger = 100;
      target.isStunned = true;
      target.actionState = 'stagger';
      target.actionTimer = 1.65;
      target.actionDuration = 1.65;
      target.shieldActive = false;
      target.parryWindow = false;
      this.pushEvent(room, {
        kind: 'stun',
        attackerId: attacker.playerId,
        targetId: target.playerId,
        fighterId: target.fighterId,
        x: target.x,
        y: target.y + 1.5,
        z: target.z,
        colorHex: 0xfacc15,
        callout: 'STUNNED! PUNISH!',
      });
    }
  }

  private computeDynamicDamage(
    actor: InternalActor,
    target: InternalActor,
    baseDamage: number,
    slot: AbilitySlot
  ): { dmg: number; isBackstab: boolean; isCrit: boolean; staggerBonus: number } {
    let mult = 1.0;
    let isBackstab = false;
    let isCrit = false;
    let staggerBonus = 0;

    // 1. Overdrive (<28% HP comeback boost)
    if (actor.isOverdrive) {
      mult += 0.22;
    }

    // 2. Frenzy Zone buff (+25% DMG)
    if (actor.frenzyInside) {
      mult += 0.25;
    }

    // 3. Airborne bonus during Gravity Surge
    if (!actor.grounded) {
      mult += 0.15;
    }

    // 4. Whiff / Stunned Punish Multiplier
    if (target.actionState === 'whiff') {
      mult += 0.35;
      isCrit = true;
      staggerBonus += 14;
    } else if (target.isStunned) {
      mult += 0.28;
      isCrit = true;
    }

    // 5. Backstab / Flank Angle Bonus
    const dx = target.x - actor.x;
    const dz = target.z - actor.z;
    const dist = Math.max(0.01, Math.hypot(dx, dz));
    const atkX = dx / dist;
    const atkZ = dz / dist;
    const tgtFwdX = Math.sin(target.rotY);
    const tgtFwdZ = Math.cos(target.rotY);
    const alignment = atkX * tgtFwdX + atkZ * tgtFwdZ;
    if (alignment > 0.45) {
      isBackstab = true;
      isCrit = true;
      mult += 0.3;
      staggerBonus += 12;
    } else if (alignment > -0.25) {
      mult += 0.12;
      staggerBonus += 5;
    }

    // 6. Character Passives
    if (actor.fighterId === 'marjohn') {
      mult += actor.passiveStacks * 0.04;
    } else if (actor.fighterId === 'prime') {
      const missingPct = 1 - actor.hp / Math.max(1, actor.maxHp);
      mult += Math.min(0.2, missingPct * 0.28);
    } else if (actor.fighterId === 'damen') {
      if (actor.frenzyInside) {
        mult += 0.15;
      }
    } else if (actor.fighterId === 'khen') {
      // Khen Shadow Backstab Passive: +20% bonus damage when striking from behind!
      if (isBackstab) {
        mult += 0.2;
        actor.stamina = clamp(actor.stamina + 10, 0, actor.maxStamina);
      }
    } else if (actor.fighterId === 'jm' && actor.counterFlowActive && (slot === 2 || slot === 3 || slot === 4 || slot === 5)) {
      mult += 0.35;
      isCrit = true;
      actor.counterFlowActive = false;
    }

    // 7. Combo Link & M1 4-Hit Scaling
    if (actor.pendingComboLink) {
      mult += 0.22;
      isCrit = true;
      staggerBonus += FIGHTER_BY_ID[actor.fighterId].comboLink.bonusStagger;
    }
    if (slot === 0 && actor.comboStep === 4) {
      mult += 0.45;
      isCrit = true;
      staggerBonus += 18;
    } else if (slot === 0 && actor.comboStep === 3) {
      mult += 0.2;
    }

    return {
      dmg: Math.max(1, Math.round(baseDamage * mult)),
      isBackstab,
      isCrit,
      staggerBonus,
    };
  }

  private executeAbilityImpact(room: RoomInstance, actor: InternalActor): void {
    if (actor.abilitySlot === null) return;
    const spec = FIGHTER_BY_ID[actor.fighterId];
    const slot = actor.abilitySlot;
    if (actor.awakened && (slot === 0 || slot === 2 || slot === 3 || slot === 4 || slot === 6)) {
      executeAwakenedAbilityImpact(room, actor, slot as 0 | 2 | 3 | 4 | 6, this.getAwakeningHelpers());
      return;
    }
    const ab = slot === 5 ? JM_SECRET_ABILITY : spec.abilities[slot === 6 ? 4 : slot];
    this.clearActorTelegraph(room, actor);

    const fx = Math.sin(actor.rotY);
    const fz = Math.cos(actor.rotY);

    // JM Secret Jtinsullen Solar Meteor Launch!
    if (actor.fighterId === 'jm' && slot === 5) {
      const aimX = actor.pendingAimX ?? actor.x + fx * 5.0;
      const aimZ = actor.pendingAimZ ?? actor.z + fz * 5.0;
      const targetGroundY = getMapTerrainHeight(room.mapId, aimX, aimZ);
      const startY = actor.y + 2.4;
      const flightTime = 0.34;
      const dx = aimX - actor.x;
      const dz = aimZ - actor.z;
      const dy = targetGroundY + 0.35 - startY;
      const rotAim = Math.hypot(dx, dz) > 0.05 ? Math.atan2(dx, dz) : actor.rotY;

      room.projectiles.push({
        id: makeId('proj'),
        ownerId: actor.playerId,
        fighterId: 'jm',
        kind: 'solarFireball',
        x: actor.x,
        y: startY,
        z: actor.z,
        vx: dx / flightTime,
        vy: dy / flightTime,
        vz: dz / flightTime,
        rotY: rotAim,
        colorHex: 0xfacc15,
        originX: actor.x,
        originY: startY,
        originZ: actor.z,
        targetX: aimX,
        targetY: targetGroundY + 0.35,
        targetZ: aimZ,
        isOverdrive: true,
        age: 0,
        maxAge: flightTime + 0.04,
        damage: ab.damage,
        staggerDamage: ab.staggerDamage,
        knockback: ab.knockback,
        hitIds: new Set(),
      });

      this.pushEvent(room, {
        kind: 'fireballLaunch',
        attackerId: actor.playerId,
        fighterId: 'jm',
        x: actor.x,
        y: startY,
        z: actor.z,
        dirX: fx,
        dirZ: fz,
        colorHex: 0xfacc15,
        abilitySlot: 5,
        callout: 'SOLAR METEOR!',
      });
      actor.landedCurrentAction = true;
      return;
    }

    // Check melee-to-melee Clash between two simultaneous melee attackers!
    if ((slot === 0 || slot === 3) && actor.fighterId !== 'damen' && actor.clashCooldown <= 0 && !room.activeClash) {
      const clashingOther = room.actors.find(
        (other) =>
          other.playerId !== actor.playerId &&
          !other.isKO &&
          other.fighterId !== 'damen' &&
          other.clashCooldown <= 0 &&
          (other.actionState === 'attack' || other.actionState === 'skill') &&
          !other.windupTriggered &&
          Math.hypot(other.x - actor.x, other.z - actor.z) <= 3.1
      );
      if (clashingOther) {
        this.startClash(room, actor, clashingOther);
        return;
      }
    }

    // RESTORED SLOT 2 CHARACTER SKILLS
    if (slot === 2) {
      const arenaRadius = MAP_BY_ID[room.mapId].arenaRadius;
      const aimDest =
        actor.pendingAimX !== null && actor.pendingAimZ !== null
          ? { x: actor.pendingAimX, z: actor.pendingAimZ }
          : { x: actor.x + fx * 5.2, z: actor.z + fz * 5.2 };

      if (actor.fighterId === 'marjohn') {
        // Cloud Vault Slam: radial cyclone slam at landing point!
        const safe = resolveObstacleCollisions(room.mapId, aimDest.x, actor.y, aimDest.z, 0.48, room.obstacles);
        const r = Math.hypot(safe.x, safe.z);
        actor.x = r > arenaRadius ? (safe.x / r) * arenaRadius : safe.x;
        actor.z = r > arenaRadius ? (safe.z / r) * arenaRadius : safe.z;
        actor.yVel = Math.min(0, actor.yVel);
        this.damageObstaclesInArea(room, actor.x, actor.z, 4.1, ab.damage * 1.4, spec.hex);
        this.pushEvent(room, {
          kind: 'shockwave',
          attackerId: actor.playerId,
          fighterId: 'marjohn',
          x: actor.x,
          y: actor.y + 0.15,
          z: actor.z,
          dirX: fx,
          dirZ: fz,
          colorHex: spec.hex,
          abilitySlot: 2,
          isComboLink: actor.pendingComboLink,
        });
        for (const target of room.actors) {
          if (target.playerId === actor.playerId || target.isKO) continue;
          if (Math.abs(target.y - actor.y) > 2.8) continue;
          const dx = target.x - actor.x;
          const dz = target.z - actor.z;
          const dist = Math.hypot(dx, dz);
          if (dist <= 3.9) {
            const dirX = dist > 0.05 ? dx / dist : fx;
            const dirZ = dist > 0.05 ? dz / dist : fz;
            const calc = this.computeDynamicDamage(actor, target, ab.damage, 2);
            if (this.applyHit(room, actor, target, calc.dmg, ab.staggerDamage + calc.staggerBonus, ab.knockback, dirX, dirZ, spec.hex, true, false, false, calc.isCrit, calc.isBackstab)) {
              actor.landedCurrentAction = true;
              target.yVel = Math.max(target.yVel, 6.4);
              target.grounded = false;
            }
          }
        }
        return;
      }

      if (actor.fighterId === 'prime') {
        // Meteor Charge: armored bull rush smash along lane!
        const originX = actor.x - fx * 1.4;
        const originZ = actor.z - fz * 1.4;
        this.damageObstaclesInArea(room, actor.x + fx * 2.0, actor.z + fz * 2.0, 3.6, ab.damage * 1.6, spec.hex);
        this.pushEvent(room, {
          kind: 'shockwave',
          attackerId: actor.playerId,
          fighterId: 'prime',
          x: actor.x,
          y: actor.y + 0.25,
          z: actor.z,
          dirX: fx,
          dirZ: fz,
          colorHex: spec.hex,
          abilitySlot: 2,
          isComboLink: actor.pendingComboLink,
        });
        // Check Molten Fissure Steam Eruption!
        const fissure = room.zones.find(
          (z) =>
            z.ownerId === actor.playerId &&
            z.kind === 'moltenFissure' &&
            Math.hypot(actor.x - z.x, actor.z - z.z) <= z.radius + 1.2
        );
        if (fissure) {
          room.zones = room.zones.filter((z) => z.id !== fissure.id);
          this.pushEvent(room, {
            kind: 'trapTrigger',
            attackerId: actor.playerId,
            fighterId: 'prime',
            x: fissure.x,
            y: fissure.y + 0.35,
            z: fissure.z,
            colorHex: 0xfb923c,
            abilitySlot: 2,
          });
        }
        for (const target of room.actors) {
          if (target.playerId === actor.playerId || target.isKO) continue;
          if (Math.abs(target.y - actor.y) > 2.5) continue;
          const dx = target.x - originX;
          const dz = target.z - originZ;
          const along = dx * fx + dz * fz;
          const perp = Math.abs(dx * -fz + dz * fx);
          if (along >= -0.4 && along <= 6.6 && perp <= 2.4) {
            const calc = this.computeDynamicDamage(actor, target, ab.damage + (fissure ? 6 : 0), 2);
            if (this.applyHit(room, actor, target, calc.dmg, ab.staggerDamage + calc.staggerBonus, ab.knockback, fx, fz, spec.hex, true, false, false, calc.isCrit, calc.isBackstab)) {
              actor.landedCurrentAction = true;
            }
          }
        }
        return;
      }

      if (actor.fighterId === 'damen') {
        // Outlaw Roll -> Deadeye Fan Shot (wide crisp 3-shot burst!)
        actor.empoweredM1Ready = true;
        for (const spread of [-0.14, 0, 0.14]) {
          const ang = actor.rotY + spread;
          room.projectiles.push({
            id: makeId('proj'),
            ownerId: actor.playerId,
            fighterId: 'damen',
            kind: 'magnum',
            x: actor.x + Math.sin(ang) * 0.85,
            y: actor.y + 1.15,
            z: actor.z + Math.cos(ang) * 0.85,
            vx: Math.sin(ang) * 27,
            vz: Math.cos(ang) * 27,
            rotY: ang,
            colorHex: 0xfef08a,
            originX: actor.x,
            originY: actor.y + 1.15,
            originZ: actor.z,
            isComboLink: actor.pendingComboLink,
            isOverdrive: actor.isOverdrive,
            age: 0,
            maxAge: 0.50,
            maxRange: 12.0,
            damage: 13,
            staggerDamage: 18,
            knockback: 7.2,
            hitIds: new Set(),
          });
        }
        this.pushEvent(room, {
          kind: 'shockwave',
          attackerId: actor.playerId,
          fighterId: 'damen',
          x: actor.x,
          y: actor.y + 0.9,
          z: actor.z,
          dirX: fx,
          dirZ: fz,
          colorHex: 0xfacc15,
          abilitySlot: 2,
          isComboLink: actor.pendingComboLink,
        });
        actor.landedCurrentAction = true;
        return;
      }

      if (actor.fighterId === 'khen') {
        // Shadow Blink: leave Void Decoy at origin, warp to destination & slash!
        const originX = actor.x;
        const originY = actor.y;
        const originZ = actor.z;
        this.spawnZone(room, actor, 'voidDecoy', originX, originY, originZ, 1.75, 2.8, spec.hex);
        const safe = resolveObstacleCollisions(room.mapId, aimDest.x, actor.y, aimDest.z, 0.48, room.obstacles);
        const r = Math.hypot(safe.x, safe.z);
        actor.x = r > arenaRadius ? (safe.x / r) * arenaRadius : safe.x;
        actor.z = r > arenaRadius ? (safe.z / r) * arenaRadius : safe.z;
        actor.iframeTimer = Math.max(actor.iframeTimer, 0.22);
        this.damageObstaclesInArea(room, actor.x, actor.z, 3.6, ab.damage * 1.3, spec.hex);
        this.pushEvent(room, {
          kind: 'shockwave',
          attackerId: actor.playerId,
          fighterId: 'khen',
          x: actor.x,
          y: actor.y + 0.9,
          z: actor.z,
          originX,
          originY: originY + 0.9,
          originZ,
          dirX: fx,
          dirZ: fz,
          colorHex: spec.hex,
          abilitySlot: 2,
          isComboLink: true,
        });
        for (const target of room.actors) {
          if (target.playerId === actor.playerId || target.isKO) continue;
          const dx = target.x - actor.x;
          const dz = target.z - actor.z;
          const dist = Math.hypot(dx, dz);
          if (dist <= 3.3 && Math.abs(target.y - actor.y) <= 2.4) {
            const calc = this.computeDynamicDamage(actor, target, ab.damage, 2);
            if (this.applyHit(room, actor, target, calc.dmg, ab.staggerDamage + calc.staggerBonus, ab.knockback, dist > 0.05 ? dx / dist : fx, dist > 0.05 ? dz / dist : fz, spec.hex, true, false, false, calc.isCrit, calc.isBackstab)) {
              actor.landedCurrentAction = true;
            }
          }
        }
        return;
      }

      if (actor.fighterId === 'jm') {
        // Flash Step: golden blink along corridor (can also dive diagonally if JM is airborne!)
        const originX = actor.x;
        const originY = actor.y;
        const originZ = actor.z;
        const safe = resolveObstacleCollisions(room.mapId, aimDest.x, actor.y, aimDest.z, 0.48, room.obstacles);
        const r = Math.hypot(safe.x, safe.z);
        actor.x = r > arenaRadius ? (safe.x / r) * arenaRadius : safe.x;
        actor.z = r > arenaRadius ? (safe.z / r) * arenaRadius : safe.z;
        if (actor.isFlying && actor.pendingAimX !== null) {
          actor.y = Math.max(getObstacleSupportY(room.mapId, actor.x, actor.y, actor.z, 0.42, room.obstacles) + 0.2, actor.y * 0.4);
        }
        this.damageObstaclesInArea(room, actor.x, actor.z, 3.6, ab.damage * 1.35, spec.hex);
        this.pushEvent(room, {
          kind: 'shockwave',
          attackerId: actor.playerId,
          fighterId: 'jm',
          x: actor.x,
          y: actor.y + 0.9,
          z: actor.z,
          originX,
          originY: originY + 0.9,
          originZ,
          dirX: fx,
          dirZ: fz,
          colorHex: spec.hex,
          abilitySlot: 2,
          isComboLink: true,
        });
        const segX = actor.x - originX;
        const segZ = actor.z - originZ;
        const segLen = Math.max(0.1, Math.hypot(segX, segZ));
        const sDirX = segX / segLen;
        const sDirZ = segZ / segLen;
        for (const target of room.actors) {
          if (target.playerId === actor.playerId || target.isKO) continue;
          const dx = target.x - originX;
          const dz = target.z - originZ;
          const along = dx * sDirX + dz * sDirZ;
          const perp = Math.abs(dx * -sDirZ + dz * sDirX);
          if (along >= -0.8 && along <= segLen + 1.8 && perp <= 2.35 && Math.abs(target.y - actor.y) <= 4.5) {
            const calc = this.computeDynamicDamage(actor, target, ab.damage, 2);
            if (this.applyHit(room, actor, target, calc.dmg, ab.staggerDamage + calc.staggerBonus, ab.knockback, sDirX, sDirZ, spec.hex, true, false, false, calc.isCrit, calc.isBackstab)) {
              actor.landedCurrentAction = true;
            }
          }
        }
        return;
      }
    }

    // SIGNATURE M1 PATTERNS (slot === 0)
    if (slot === 0) {
      // 1. MARJOHN: Ranged Tornado Poke (steady mid-range ~7.6m projectile)
      if (actor.fighterId === 'marjohn') {
        room.projectiles.push({
          id: makeId('proj'),
          ownerId: actor.playerId,
          fighterId: 'marjohn',
          kind: 'tornado',
          x: actor.x + fx * 0.95,
          y: actor.y + 0.95,
          z: actor.z + fz * 0.95,
          vx: fx * 11.5,
          vz: fz * 11.5,
          rotY: actor.rotY,
          colorHex: spec.hex,
          originX: actor.x,
          originY: actor.y + 0.95,
          originZ: actor.z,
          isOverdrive: actor.isOverdrive,
          age: 0,
          maxAge: 0.72,
          maxRange: 7.6,
          damage: 12,
          staggerDamage: 15,
          knockback: 4.5,
          hitIds: new Set(),
        });
        actor.landedCurrentAction = true;
        return;
      }

      // 2. DAMEN: Gun (strict 10.2m range cap, moderate bullet speed 19.0 so dodges matter!)
      if (actor.fighterId === 'damen') {
        const isDeadeye = Boolean(actor.empoweredM1Ready);
        if (isDeadeye) actor.empoweredM1Ready = false;
        room.projectiles.push({
          id: makeId('proj'),
          ownerId: actor.playerId,
          fighterId: 'damen',
          kind: isDeadeye ? 'magnum' : 'bullet',
          x: actor.x + fx * 0.85,
          y: actor.y + 1.15,
          z: actor.z + fz * 0.85,
          vx: fx * (isDeadeye ? 22.5 : 19.0),
          vz: fz * (isDeadeye ? 22.5 : 19.0),
          rotY: actor.rotY,
          colorHex: isDeadeye ? 0xfef08a : spec.hex,
          originX: actor.x,
          originY: actor.y + 1.15,
          originZ: actor.z,
          isOverdrive: isDeadeye || actor.isOverdrive,
          age: 0,
          maxAge: 0.64,
          maxRange: 10.2,
          damage: isDeadeye ? 20 : 14,
          staggerDamage: isDeadeye ? 26 : 16,
          knockback: isDeadeye ? 7.2 : 3.8,
          hitIds: new Set(),
        });
        actor.landedCurrentAction = true;
        return;
      }

      // 3. JM AIRBORNE (Sky Flight Active): Fires golden energy bolts along swipe-aim or auto-aim at nearest opponent!
      if (actor.fighterId === 'jm' && actor.isFlying) {
        let dirX = fx * Math.cos(actor.aimPitch);
        let dirY = Math.sin(actor.aimPitch);
        let dirZ = fz * Math.cos(actor.aimPitch);
        if (actor.pendingAimX !== null && actor.pendingAimZ !== null) {
          const groundY = getMapTerrainHeight(room.mapId, actor.pendingAimX, actor.pendingAimZ) + 0.9;
          const tx = actor.pendingAimX - actor.x;
          const ty = groundY - (actor.y + 1.1);
          const tz = actor.pendingAimZ - actor.z;
          const len = Math.max(0.01, Math.hypot(tx, ty, tz));
          dirX = tx / len;
          dirY = ty / len;
          dirZ = tz / len;
          actor.rotY = Math.atan2(tx, tz);
        } else {
          const tgt = this.findNearestTarget(room, actor, 18.0);
          if (tgt) {
            const tx = tgt.x - actor.x;
            const ty = tgt.y + 1.0 - (actor.y + 1.1);
            const tz = tgt.z - actor.z;
            const len = Math.max(0.01, Math.hypot(tx, ty, tz));
            dirX = tx / len;
            dirY = ty / len;
            dirZ = tz / len;
            actor.rotY = Math.atan2(tx, tz);
          } else {
            const len = Math.max(0.01, Math.hypot(dirX, dirY, dirZ));
            dirX /= len;
            dirY /= len;
            dirZ /= len;
          }
        }
        const boltSpeed = 21.5;
        room.projectiles.push({
          id: makeId('proj'),
          ownerId: actor.playerId,
          fighterId: 'jm',
          kind: 'jmBolt',
          x: actor.x + dirX * 0.85,
          y: actor.y + 1.15 + dirY * 0.4,
          z: actor.z + dirZ * 0.85,
          vx: dirX * boltSpeed,
          vy: dirY * boltSpeed,
          vz: dirZ * boltSpeed,
          rotY: actor.rotY,
          colorHex: 0xfacc15,
          originX: actor.x,
          originY: actor.y + 1.15,
          originZ: actor.z,
          isOverdrive: actor.isOverdrive,
          age: 0,
          maxAge: 0.90,
          maxRange: 17.5,
          damage: 11,
          staggerDamage: 14,
          knockback: 4.5,
          hitIds: new Set(),
        });
        actor.landedCurrentAction = true;
        return;
      }

      // 4. JM GROUND 3rd Hit: Mini Energy Beam (Kamehameha)
      if (actor.fighterId === 'jm' && actor.comboStep === 3) {
        room.projectiles.push({
          id: makeId('proj'),
          ownerId: actor.playerId,
          fighterId: 'jm',
          kind: 'jmBeam',
          x: actor.x + fx * 1.05,
          y: actor.y + 1.15,
          z: actor.z + fz * 1.05,
          vx: fx * 20.0,
          vz: fz * 20.0,
          rotY: actor.rotY,
          colorHex: 0xfacc15,
          originX: actor.x,
          originY: actor.y + 1.15,
          originZ: actor.z,
          isOverdrive: actor.isOverdrive,
          age: 0,
          maxAge: 0.46,
          maxRange: 8.8,
          damage: 13,
          staggerDamage: 18,
          knockback: 6.2,
          hitIds: new Set(),
        });
        this.pushEvent(room, {
          kind: 'beam',
          attackerId: actor.playerId,
          fighterId: 'jm',
          x: actor.x + fx * 0.9,
          y: actor.y + 1.15,
          z: actor.z + fz * 0.9,
          dirX: fx,
          dirZ: fz,
          colorHex: 0xfacc15,
          abilitySlot: 0,
          comboStep: 3,
        });
        actor.landedCurrentAction = true;
        return;
      }

      // 5. PRIME 4th Hit: Armored AoE Ground Slam shockwave ring around him!
      if (actor.fighterId === 'prime' && actor.comboStep === 4) {
        actor.superArmor = false;
        this.damageObstaclesInArea(room, actor.x, actor.z, 4.2, 26, spec.hex);
        this.pushEvent(room, {
          kind: 'shockwave',
          attackerId: actor.playerId,
          fighterId: 'prime',
          x: actor.x,
          y: actor.y + 0.14,
          z: actor.z,
          dirX: fx,
          dirZ: fz,
          radius: 4.1,
          colorHex: spec.hex,
          abilitySlot: 0,
          comboStep: 4,
          m1Variant: 'heavy',
          hitStopMs: 65,
        });
        for (const target of room.actors) {
          if (target.playerId === actor.playerId || target.isKO) continue;
          if (Math.abs(target.y - actor.y) > 2.6) continue;
          const dx = target.x - actor.x;
          const dz = target.z - actor.z;
          const dist = Math.hypot(dx, dz);
          if (dist <= 4.1) {
            const dirX = dist > 0.05 ? dx / dist : fx;
            const dirZ = dist > 0.05 ? dz / dist : fz;
            const calc = this.computeDynamicDamage(actor, target, 19, 0);
            if (this.applyHit(room, actor, target, calc.dmg, 26 + calc.staggerBonus, 9.8, dirX, dirZ, spec.hex, true, false, false, calc.isCrit, calc.isBackstab)) {
              actor.landedCurrentAction = true;
              actor.mana = clamp(actor.mana + 20, 0, actor.maxMana);
            }
          }
        }
        return;
      }

      // 6. KHEN 4th Hit: Damaging Dash Lunge slicing straight through!
      if (actor.fighterId === 'khen' && actor.comboStep === 4) {
        this.damageObstaclesInArea(room, actor.x + fx * 1.4, actor.z + fz * 1.4, 2.8, 18, spec.hex);
        this.pushEvent(room, {
          kind: 'shockwave',
          attackerId: actor.playerId,
          fighterId: 'khen',
          x: actor.x + fx * 1.4,
          y: actor.y + 0.85,
          z: actor.z + fz * 1.4,
          originX: actor.x - fx * 1.2,
          originY: actor.y + 0.85,
          originZ: actor.z - fz * 1.2,
          dirX: fx,
          dirZ: fz,
          colorHex: spec.hex,
          abilitySlot: 0,
          comboStep: 4,
          m1Variant: 'heavy',
        });
        for (const target of room.actors) {
          if (target.playerId === actor.playerId || target.isKO) continue;
          if (Math.abs(target.y - actor.y) > 2.4) continue;
          const dx = target.x - (actor.x - fx * 1.5);
          const dz = target.z - (actor.z - fz * 1.5);
          const along = dx * fx + dz * fz;
          const perp = Math.abs(dx * -fz + dz * fx);
          if (along >= -0.4 && along <= 5.4 && perp <= 1.85) {
            const calc = this.computeDynamicDamage(actor, target, 14, 0);
            if (this.applyHit(room, actor, target, calc.dmg, 20 + calc.staggerBonus, 8.2, fx, fz, spec.hex, true, false, false, calc.isCrit, calc.isBackstab)) {
              actor.landedCurrentAction = true;
              actor.speedBoostTimer = Math.max(actor.speedBoostTimer, 1.5);
              actor.mana = clamp(actor.mana + 18, 0, actor.maxMana);
            }
          }
        }
        return;
      }
    }

    if (actor.fighterId === 'damen' && slot === 3) {
      if (actor.pendingHoldVariant && actor.pendingAimX !== null && actor.pendingAimZ !== null) {
        // Hold-Drag variant: plant wide electrified Solar Tripwire across aim point!
        const cx = actor.pendingAimX;
        const cz = actor.pendingAimZ;
        const perpX = -fz;
        const perpZ = fx;
        const span = 3.0;
        this.spawnZone(
          room,
          actor,
          'solarTripwire',
          cx - perpX * span,
          actor.y,
          cz - perpZ * span,
          6.8,
          1.4,
          0xfacc15,
          cx + perpX * span,
          cz + perpZ * span
        );
        this.pushEvent(room, {
          kind: 'trap',
          attackerId: actor.playerId,
          fighterId: 'damen',
          x: cx,
          y: actor.y + 0.35,
          z: cz,
          dirX: perpX,
          dirZ: perpZ,
          colorHex: 0xfacc15,
          abilitySlot: 3,
          callout: 'SOLAR TRIPWIRE!',
        });
        actor.landedCurrentAction = true;
        return;
      }

      room.projectiles.push({
        id: makeId('proj'),
        ownerId: actor.playerId,
        fighterId: actor.fighterId,
        kind: 'lasso',
        x: actor.x + fx * 0.9,
        y: actor.y + 1.05,
        z: actor.z + fz * 0.9,
        vx: fx * 29,
        vz: fz * 29,
        rotY: actor.rotY,
        colorHex: 0xfacc15,
        originX: actor.x,
        originY: actor.y + 1.05,
        originZ: actor.z,
        isComboLink: actor.pendingComboLink,
        isOverdrive: actor.isOverdrive,
        age: 0,
        maxAge: 0.58,
        damage: ab.damage + (actor.isOverdrive ? 5 : 0),
        staggerDamage: ab.staggerDamage,
        knockback: ab.knockback,
        hitIds: new Set(),
      });
      return;
    }

    if (actor.fighterId === 'damen' && slot === 4) {
      for (const spread of [-0.36, -0.24, -0.12, 0, 0.12, 0.24, 0.36]) {
        const ang = actor.rotY + spread;
        room.projectiles.push({
          id: makeId('proj'),
          ownerId: actor.playerId,
          fighterId: actor.fighterId,
          kind: 'bullet',
          x: actor.x + Math.sin(ang) * 0.9,
          y: actor.y + 1.15,
          z: actor.z + Math.cos(ang) * 0.9,
          vx: Math.sin(ang) * 30,
          vz: Math.cos(ang) * 30,
          rotY: ang,
          colorHex: 0xfef08a,
          originX: actor.x,
          originY: actor.y + 1.15,
          originZ: actor.z,
          age: 0,
          maxAge: 0.72,
          damage: ab.damage,
          staggerDamage: ab.staggerDamage,
          knockback: ab.knockback,
          hitIds: new Set(),
        });
      }
      this.pushEvent(room, {
        kind: 'shockwave',
        attackerId: actor.playerId,
        fighterId: actor.fighterId,
        x: actor.x,
        y: actor.y + 0.1,
        z: actor.z,
        dirX: fx,
        dirZ: fz,
        colorHex: 0xfacc15,
        abilitySlot: 4,
        callout: 'HIGH NOON FAN!',
      });
      actor.landedCurrentAction = true;
      return;
    }

    // KHEN Crescent Wave (Hold-Drag plants Void Silence Trap; Tap fires blade that drops Void Anchor for Stage 2 Swap)
    if (actor.fighterId === 'khen' && slot === 3) {
      if (actor.pendingHoldVariant && actor.pendingAimX !== null && actor.pendingAimZ !== null) {
        this.spawnZone(
          room,
          actor,
          'voidAnchor',
          actor.pendingAimX,
          actor.y,
          actor.pendingAimZ,
          4.5,
          2.8,
          0xa855f7
        );
        this.pushEvent(room, {
          kind: 'trap',
          attackerId: actor.playerId,
          fighterId: 'khen',
          x: actor.pendingAimX,
          y: actor.y + 0.4,
          z: actor.pendingAimZ,
          colorHex: 0xa855f7,
          abilitySlot: 3,
          callout: 'VOID SILENCE TRAP!',
        });
        actor.landedCurrentAction = true;
        return;
      }

      const angles = actor.pendingComboLink || actor.isOverdrive ? [-0.14, 0.14] : [0];
      for (const off of angles) {
        const ang = actor.rotY + off;
        room.projectiles.push({
          id: makeId('proj'),
          ownerId: actor.playerId,
          fighterId: actor.fighterId,
          kind: 'crescent',
          x: actor.x + Math.sin(ang) * 0.95,
          y: actor.y + 1.15,
          z: actor.z + Math.cos(ang) * 0.95,
          vx: Math.sin(ang) * 23,
          vz: Math.cos(ang) * 23,
          rotY: ang,
          colorHex: 0xa855f7,
          originX: actor.x,
          originY: actor.y + 1.15,
          originZ: actor.z,
          isComboLink: actor.pendingComboLink,
          isOverdrive: actor.isOverdrive,
          age: 0,
          maxAge: 0.56,
          damage: ab.damage,
          staggerDamage: ab.staggerDamage,
          knockback: ab.knockback,
          hitIds: new Set(),
        });
      }
      this.pushEvent(room, {
        kind: 'shockwave',
        attackerId: actor.playerId,
        fighterId: actor.fighterId,
        x: actor.x,
        y: actor.y + 0.9,
        z: actor.z,
        dirX: fx,
        dirZ: fz,
        colorHex: 0xa855f7,
        abilitySlot: 3,
        isComboLink: actor.pendingComboLink,
      });
      return;
    }

    // KHEN Phantom Blitz Void Corridor Ultimate
    if (actor.fighterId === 'khen' && slot === 4) {
      const originX = actor.x;
      const originY = actor.y;
      const originZ = actor.z;
      const midX = actor.x + fx * 4.5;
      const midZ = actor.z + fz * 4.5;

      for (const target of room.actors) {
        if (target.playerId === actor.playerId || target.isKO) continue;
        if (Math.abs(target.y - actor.y) > 2.6) continue;
        const dx = target.x - originX;
        const dz = target.z - originZ;
        const along = dx * fx + dz * fz;
        const perp = Math.abs(dx * -fz + dz * fx);
        if (along > -0.6 && along <= 9.8 && perp <= 2.4) {
          const calc = this.computeDynamicDamage(actor, target, ab.damage, slot);
          if (
            this.applyHit(
              room,
              actor,
              target,
              calc.dmg,
              ab.staggerDamage + calc.staggerBonus,
              ab.knockback,
              fx,
              fz,
              spec.hex,
              true,
              false,
              true,
              calc.isCrit,
              calc.isBackstab
            )
          ) {
            actor.landedCurrentAction = true;
          }
        }
      }

      const arenaRadius = MAP_BY_ID[room.mapId].arenaRadius;
      this.damageObstaclesInArea(room, midX, midZ, 5.0, ab.damage * 1.4, spec.hex);
      const safe = resolveObstacleCollisions(room.mapId, actor.x + fx * 7.2, actor.y, actor.z + fz * 7.2, 0.48, room.obstacles);
      const r = Math.hypot(safe.x, safe.z);
      if (r > arenaRadius) {
        actor.x = (safe.x / r) * arenaRadius;
        actor.z = (safe.z / r) * arenaRadius;
      } else {
        actor.x = safe.x;
        actor.z = safe.z;
      }

      this.pushEvent(room, {
        kind: 'shockwave',
        attackerId: actor.playerId,
        fighterId: actor.fighterId,
        x: midX,
        y: originY + 0.15,
        z: midZ,
        originX,
        originY: originY + 1.0,
        originZ,
        dirX: fx,
        dirZ: fz,
        colorHex: spec.hex,
        abilitySlot: 4,
        isComboLink: true,
        callout: 'PHANTOM BLITZ!',
      });
      return;
    }

    // JM Solar Dragon Beam Ultimate (works from Sky Flight downward onto floor targets too!)
    if (actor.fighterId === 'jm' && slot === 4) {
      this.pushEvent(room, {
        kind: 'beam',
        attackerId: actor.playerId,
        fighterId: actor.fighterId,
        x: actor.x + fx * 1.1,
        y: actor.y + 1.25,
        z: actor.z + fz * 1.1,
        dirX: fx,
        dirZ: fz,
        colorHex: 0xfacc15,
        hitStopMs: 95,
        abilitySlot: 4,
        counterFlow: actor.counterFlowActive,
      });
      const maxBeamVert = actor.isFlying ? 8.5 : 2.6;
      for (const target of room.actors) {
        if (target.playerId === actor.playerId || target.isKO) continue;
        if (Math.abs(target.y - actor.y) > maxBeamVert) continue;
        const dx = target.x - actor.x;
        const dz = target.z - actor.z;
        const along = dx * fx + dz * fz;
        const perp = Math.abs(dx * -fz + dz * fx);
        if (along > 0 && along <= ab.range && perp <= 2.35) {
          const calc = this.computeDynamicDamage(actor, target, ab.damage, slot);
          if (this.applyHit(room, actor, target, calc.dmg, ab.staggerDamage + calc.staggerBonus, ab.knockback, fx, fz, spec.hex, true, false, true, calc.isCrit, calc.isBackstab)) {
            actor.landedCurrentAction = true;
          }
        }
      }
      return;
    }

    // MARJOHN Gale Snare Hold-Drag Remote Trap vs Tap Vortex
    if (actor.fighterId === 'marjohn' && slot === 3) {
      if (actor.pendingHoldVariant && actor.pendingAimX !== null && actor.pendingAimZ !== null) {
        const cx = actor.pendingAimX;
        const cz = actor.pendingAimZ;
        this.spawnZone(room, actor, 'galeSnare', cx, actor.y, cz, 4.5, 3.4, spec.hex);
        this.pushEvent(room, {
          kind: 'trap',
          attackerId: actor.playerId,
          fighterId: 'marjohn',
          x: cx,
          y: actor.y + 0.3,
          z: cz,
          colorHex: spec.hex,
          abilitySlot: 3,
          callout: 'GALE SNARE PLANTED!',
        });
        this.pushEvent(room, {
          kind: 'shockwave',
          attackerId: actor.playerId,
          fighterId: 'marjohn',
          x: cx,
          y: actor.y + 0.15,
          z: cz,
          colorHex: spec.hex,
          abilitySlot: 3,
        });
        actor.landedCurrentAction = true;
        return;
      }
      // Tap also leaves a 2.8s Gale Snare ring for Stage 2 Skyburst!
      this.spawnZone(room, actor, 'galeSnare', actor.x, actor.y, actor.z, 2.8, 3.2, spec.hex);
    }

    // JM Solar Sanctuary Ward Hold-Drag vs Tap Slam (projects to floor when flying!)
    if (actor.fighterId === 'jm' && slot === 3) {
      if (actor.pendingHoldVariant && actor.pendingAimX !== null && actor.pendingAimZ !== null) {
        const cx = actor.pendingAimX;
        const cz = actor.pendingAimZ;
        const zoneY = actor.isFlying ? getObstacleSupportY(room.mapId, cx, 0, cz, 0.42, room.obstacles) : actor.y;
        this.spawnZone(room, actor, 'solarSanctuary', cx, zoneY, cz, 5.0, 3.5, spec.hex);
        this.pushEvent(room, {
          kind: 'trap',
          attackerId: actor.playerId,
          fighterId: 'jm',
          x: cx,
          y: zoneY + 0.3,
          z: cz,
          colorHex: spec.hex,
          abilitySlot: 3,
        });
        this.pushEvent(room, {
          kind: 'shockwave',
          attackerId: actor.playerId,
          fighterId: 'jm',
          x: cx,
          y: zoneY + 0.15,
          z: cz,
          colorHex: spec.hex,
          abilitySlot: 3,
        });
        actor.landedCurrentAction = true;
        return;
      }
      const floorY = actor.isFlying ? getObstacleSupportY(room.mapId, actor.x, 0, actor.z, 0.42, room.obstacles) : actor.y;
      this.spawnZone(room, actor, 'solarSanctuary', actor.x, floorY, actor.z, 2.6, 3.1, spec.hex);
    }

    // PRIME Stage 1 Magma Uppercut vs Stage 2 / Hold-Drag Crater Slam + Molten Fissure
    if (actor.fighterId === 'prime' && slot === 3) {
      if (!actor.pendingHoldVariant) {
        // Stage 1: crisp Magma Uppercut
        this.damageObstaclesInArea(room, actor.x + fx * 1.4, actor.z + fz * 1.4, 3.5, 22, spec.hex);
        this.pushEvent(room, {
          kind: 'shockwave',
          attackerId: actor.playerId,
          fighterId: 'prime',
          x: actor.x + fx * 1.1,
          y: actor.y + 0.5,
          z: actor.z + fz * 1.1,
          dirX: fx,
          dirZ: fz,
          colorHex: spec.hex,
          abilitySlot: 3,
          callout: 'MAGMA UPPERCUT!',
        });
        for (const target of room.actors) {
          if (target.playerId === actor.playerId || target.isKO) continue;
          if (Math.abs(target.y - actor.y) > 2.4) continue;
          const dx = target.x - actor.x;
          const dz = target.z - actor.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 3.6) continue;
          if (dist > 0.05 && (dx / dist) * fx + (dz / dist) * fz < 0.15) continue;
          const dirX = dist > 0.05 ? dx / dist : fx;
          const dirZ = dist > 0.05 ? dz / dist : fz;
          const calc = this.computeDynamicDamage(actor, target, 14, 3);
          const hit = this.applyHit(room, actor, target, calc.dmg, 18 + calc.staggerBonus, 5.2, dirX, dirZ, spec.hex, true, false, false, calc.isCrit, calc.isBackstab);
          if (hit) {
            actor.landedCurrentAction = true;
            target.yVel = Math.max(target.yVel, 5.8);
            target.grounded = false;
          }
        }
        return;
      }

      // Stage 2 or Hold-Drag: Crater Slam + Molten Fissure zone
      const cx = actor.pendingAimX ?? actor.x + fx * 1.1;
      const cz = actor.pendingAimZ ?? actor.z + fz * 1.1;
      const safe = resolveObstacleCollisions(room.mapId, cx, actor.y, cz, 0.48, room.obstacles);
      actor.x = safe.x;
      actor.z = safe.z;
      this.damageObstaclesInArea(room, safe.x, safe.z, 4.9, ab.damage * 1.5, 0xf97316);
      this.spawnZone(room, actor, 'moltenFissure', safe.x, actor.y, safe.z, 4.8, 3.8, 0xf97316);
      this.pushEvent(room, {
        kind: 'trap',
        attackerId: actor.playerId,
        fighterId: 'prime',
        x: safe.x,
        y: actor.y + 0.2,
        z: safe.z,
        colorHex: 0xf97316,
        abilitySlot: 3,
        callout: 'MOLTEN FISSURE!',
      });
      this.pushEvent(room, {
        kind: 'shockwave',
        attackerId: actor.playerId,
        fighterId: 'prime',
        x: safe.x,
        y: actor.y + 0.12,
        z: safe.z,
        dirX: fx,
        dirZ: fz,
        colorHex: spec.hex,
        abilitySlot: 3,
        isComboLink: actor.pendingComboLink,
      });
      for (const target of room.actors) {
        if (target.playerId === actor.playerId || target.isKO) continue;
        if (Math.abs(target.y - actor.y) > 2.6) continue;
        const dx = target.x - safe.x;
        const dz = target.z - safe.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 4.9) continue;
        const dirX = dist > 0.05 ? dx / dist : fx;
        const dirZ = dist > 0.05 ? dz / dist : fz;
        const calc = this.computeDynamicDamage(actor, target, ab.damage, 3);
        if (this.applyHit(room, actor, target, calc.dmg, ab.staggerDamage + calc.staggerBonus, ab.knockback, dirX, dirZ, spec.hex, true, false, false, calc.isCrit, calc.isBackstab)) {
          actor.landedCurrentAction = true;
        }
      }
      return;
    }

    // Center point for aimed AoE Ultimates or JM airborne Heel Drop
    const impactX =
      (slot === 4 && (actor.fighterId === 'marjohn' || actor.fighterId === 'prime') && actor.pendingAimX !== null) ||
      (slot === 3 && actor.fighterId === 'jm' && actor.isFlying && actor.pendingAimX !== null)
        ? (actor.pendingAimX ?? actor.x)
        : actor.x;
    const impactZ =
      (slot === 4 && (actor.fighterId === 'marjohn' || actor.fighterId === 'prime') && actor.pendingAimZ !== null) ||
      (slot === 3 && actor.fighterId === 'jm' && actor.isFlying && actor.pendingAimZ !== null)
        ? (actor.pendingAimZ ?? actor.z)
        : actor.z;

    const effectiveRange =
      ab.range + (slot === 3 && (actor.pendingComboLink || actor.isOverdrive) ? 1.35 : 0);

    // Damage destructible buildings/ruins in strike impact zone
    const breakCenterX = slot === 0 ? actor.x + fx * 1.35 : impactX;
    const breakCenterZ = slot === 0 ? actor.z + fz * 1.35 : impactZ;
    this.damageObstaclesInArea(
      room,
      breakCenterX,
      breakCenterZ,
      slot === 0 ? effectiveRange * 0.9 : effectiveRange,
      ab.damage * (slot >= 3 ? 1.45 : 1.2),
      spec.hex
    );

    if (slot === 3 || slot === 4) {
      this.pushEvent(room, {
        kind: 'shockwave',
        attackerId: actor.playerId,
        fighterId: actor.fighterId,
        x: impactX,
        y: (actor.isFlying ? getMapTerrainHeight(room.mapId, impactX, impactZ) : actor.y) + 0.1,
        z: impactZ,
        dirX: fx,
        dirZ: fz,
        colorHex: spec.hex,
        abilitySlot: slot,
        isComboLink: actor.pendingComboLink,
        frenzyInside: actor.frenzyInside,
        counterFlow: actor.counterFlowActive,
      });
    } else if (slot === 0 && actor.comboStep === 4) {
      this.pushEvent(room, {
        kind: 'shockwave',
        attackerId: actor.playerId,
        fighterId: actor.fighterId,
        x: actor.x + fx * 0.9,
        y: actor.y + 0.12,
        z: actor.z + fz * 0.9,
        dirX: fx,
        dirZ: fz,
        colorHex: spec.hex,
        abilitySlot: 0,
        comboStep: 4,
        m1Variant: 'heavy',
      });
    }

    for (const target of room.actors) {
      if (target.playerId === actor.playerId || target.isKO) continue;
      // Allow JM Sky Flight skills to strike ground opponents below!
      const maxVert = actor.fighterId === 'jm' && actor.isFlying ? 8.5 : 2.6;
      if (Math.abs(target.y - actor.y) > maxVert) continue;
      const dx = target.x - impactX;
      const dz = target.z - impactZ;
      const dist = Math.hypot(dx, dz);
      if (dist > effectiveRange) continue;

      if (ab.arcCos > -0.99 && dist > 0.05) {
        const dot = (dx / dist) * fx + (dz / dist) * fz;
        if (dot < ab.arcCos) continue;
      }

      const dirX = dist > 0.05 ? dx / dist : fx;
      const dirZ = dist > 0.05 ? dz / dist : fz;
      const calc = this.computeDynamicDamage(actor, target, ab.damage, slot);
      const isHeavyHit = slot >= 3 || (slot === 0 && actor.comboStep === 4);
      const kbBoost = slot === 0 && actor.comboStep === 4 && actor.fighterId === 'jm' ? 3.0 : 1.0;

      const hitLanded = this.applyHit(
        room,
        actor,
        target,
        calc.dmg,
        ab.staggerDamage + calc.staggerBonus,
        ab.knockback * kbBoost,
        dirX,
        dirZ,
        spec.hex,
        isHeavyHit,
        false,
        slot === 4,
        calc.isCrit,
        calc.isBackstab
      );
      if (hitLanded) {
        actor.landedCurrentAction = true;
        if (slot === 0) {
          const chiGain = actor.comboStep === 4 ? 22 : actor.comboStep >= 2 ? 13 : 10;
          actor.mana = clamp(actor.mana + chiGain, 0, actor.maxMana);
        }
      }
    }
  }

  private applyHit(
    room: RoomInstance,
    attacker: InternalActor,
    target: InternalActor,
    damage: number,
    staggerDamage: number,
    knockback: number,
    dirX: number,
    dirZ: number,
    colorHex: number,
    isHeavy: boolean,
    isPull = false,
    isUltimate = false,
    isCrit = false,
    isBackstab = false
  ): boolean {
    if (target.isKO || target.actionState === 'clash') return false;

    // Perfect Evade check: dodging through an incoming hit with active dash i-frames!
    if (target.iframeTimer > 0) {
      if (target.actionState === 'dash' && !target.evadeRewardedThisDash) {
        target.evadeRewardedThisDash = true;
        target.perfectEvadeTimer = 1.6;
        target.rushFatigue = 0;
        target.stamina = clamp(target.stamina + 20, 0, target.maxStamina);
        target.mana = clamp(target.mana + 14, 0, target.maxMana);
        if (target.fighterId === 'jm') {
          target.counterFlowActive = true;
        }
        this.pushEvent(room, {
          kind: 'evade',
          attackerId: attacker.playerId,
          targetId: target.playerId,
          fighterId: target.fighterId,
          x: target.x,
          y: target.y + 1.15,
          z: target.z,
          colorHex: FIGHTER_BY_ID[target.fighterId].hex,
          hitStopMs: 45,
          counterFlow: target.fighterId === 'jm',
          callout: target.fighterId === 'jm' ? 'COUNTER EVADE!' : 'PERFECT EVADE!',
        });
      }
      return false;
    }

    // Guard / Parry Check
    if (target.shieldActive) {
      if (target.parryWindow) {
        target.parryCount += 1;
        target.rushFatigue = 0;
        target.mana = clamp(target.mana + 28, 0, target.maxMana);
        target.stamina = clamp(target.stamina + 30, 0, target.maxStamina);
        target.iframeTimer = Math.max(target.iframeTimer, 0.36);

        if (target.fighterId === 'jm') {
          target.counterFlowActive = true;
        }

        this.pushEvent(room, {
          kind: 'parry',
          attackerId: attacker.playerId,
          targetId: target.playerId,
          fighterId: target.fighterId,
          x: (attacker.x + target.x) * 0.5,
          y: target.y + 1.25,
          z: (attacker.z + target.z) * 0.5,
          dirX: -dirX,
          dirZ: -dirZ,
          colorHex: FIGHTER_BY_ID[target.fighterId].hex,
          hitStopMs: 85,
          rpsOutcome: 'parry_beats_strike',
          counterFlow: target.fighterId === 'jm',
          callout: target.fighterId === 'jm' ? 'COUNTER-FLOW PARRY!' : 'PERFECT PARRY!',
        });

        if (Math.hypot(attacker.x - target.x, attacker.z - target.z) < 5.2) {
          attacker.actionState = 'stagger';
          attacker.actionTimer = 0.9;
          attacker.actionDuration = 0.9;
          attacker.vx = -dirX * 9.0;
          attacker.vz = -dirZ * 9.0;
          this.addStagger(room, target, attacker, 36);
          if (target.fighterId === 'jm') {
            attacker.hp = Math.max(0, attacker.hp - 12);
            attacker.damagePhase = getDamagePhase(attacker.hp, attacker.maxHp, attacker.isKO);
            target.damageDealt += 12;
            if (attacker.hp <= 0) {
              this.eliminateActor(room, target, attacker, 'parry');
            }
          }
        }
        return false;
      }

      // Guard Break if ultimate or heavy stagger hits low-stamina blocker
      if ((isUltimate || isHeavy) && target.stamina < 16) {
        target.shieldActive = false;
        target.blockHeld = false;
        target.actionState = 'stagger';
        target.actionTimer = 0.85;
        target.actionDuration = 0.85;
        this.pushEvent(room, {
          kind: 'parry',
          attackerId: attacker.playerId,
          targetId: target.playerId,
          fighterId: attacker.fighterId,
          x: target.x,
          y: target.y + 1.3,
          z: target.z,
          colorHex: 0xf43f5e,
          hitStopMs: 75,
          callout: 'GUARD BREAK!',
        });
      } else {
        target.stamina = clamp(target.stamina - 10, 0, target.maxStamina);
        const reduced = Math.max(1, Math.round(damage * 0.22));
        target.hp = Math.max(0, target.hp - reduced);
        target.damagePhase = getDamagePhase(target.hp, target.maxHp, target.isKO);
        attacker.damageDealt += reduced;
        target.vx += dirX * knockback * 0.25;
        target.vz += dirZ * knockback * 0.25;
        this.pushEvent(room, {
          kind: 'block',
          attackerId: attacker.playerId,
          targetId: target.playerId,
          fighterId: target.fighterId,
          x: target.x,
          y: target.y + 1.25,
          z: target.z,
          colorHex: FIGHTER_BY_ID[target.fighterId].hex,
          damage: reduced,
        });
        if (target.hp <= 0) {
          this.eliminateActor(room, attacker, target, 'normal');
        }
        return false;
      }
    }

    // Prime Juggernaut Armor passive: 10% dmg reduction while swinging + Damen Awakened Snare Mark bonus
    let finalDmg = damage;
    if (target.fighterId === 'prime' && (target.actionState === 'attack' || target.actionState === 'skill')) {
      finalDmg = Math.max(1, Math.round(finalDmg * 0.9));
    }
    if (target.snareMarkedTimer > 0 && attacker.fighterId === 'damen') {
      finalDmg = Math.max(1, Math.round(finalDmg * AWAKENING_CONFIG.DAMEN_SNARE_BONUS_MULT));
    }

    target.hp = target.isDummy ? Math.max(1, target.hp - finalDmg) : Math.max(0, target.hp - finalDmg);
    target.damagePhase = getDamagePhase(target.hp, target.maxHp, target.isKO);
    target.lastDamagedAt = room.matchTime;
    attackerAddDamage(attacker, finalDmg);
    attacker.rushFatigue = 0;

    // Update Attacker Combo (resets if no damage dealt for 2.0 seconds) & Passives
    if (room.matchTime - attacker.lastHitAt <= 2.0) {
      attacker.comboCount += 1;
    } else {
      attacker.comboCount = 1;
    }
    attacker.lastHitAt = room.matchTime;

    if (attacker.fighterId === 'marjohn') {
      const gain = attacker.frenzyInside ? 2 : 1;
      attacker.passiveStacks = clamp(attacker.passiveStacks + gain, 0, 5);
    }

    // Overdrive Comeback trigger below 28% HP
    if (!target.isKO && !target.isOverdrive && target.hp > 0 && target.hp <= target.maxHp * 0.28) {
      target.isOverdrive = true;
      if (!target.overdriveAnnounced) {
        target.overdriveAnnounced = true;
        target.stamina = clamp(target.stamina + 35, 0, target.maxStamina);
        this.pushEvent(room, {
          kind: 'overdrive',
          targetId: target.playerId,
          fighterId: target.fighterId,
          x: target.x,
          y: target.y + 1.3,
          z: target.z,
          colorHex: 0xf43f5e,
        });
      }
    }

    // Prime passive: 15% reduced knockback taken
    const kbScale = target.fighterId === 'prime' ? 0.85 : 1.0;
    const effectiveKb = Math.abs(knockback) * kbScale;
    if (isPull) {
      target.vx = -dirX * effectiveKb;
      target.vz = -dirZ * effectiveKb;
    } else {
      target.vx += dirX * effectiveKb;
      target.vz += dirZ * effectiveKb;
      if (isHeavy && !target.superArmor) {
        target.yVel = Math.max(target.yVel, 4.4 * kbScale);
        target.grounded = false;
      }
    }

    const wasCounter = target.actionState === 'whiff';
    // Super Armor prevents Prime from being interrupted by basic M1 / light hits!
    const canStaggerTarget =
      !target.superArmor || isUltimate || finalDmg >= 24;
    if (canStaggerTarget && (isHeavy || finalDmg >= 16 || wasCounter)) {
      target.actionState = 'stagger';
      target.actionTimer = isHeavy ? 0.48 : 0.32;
      target.actionDuration = target.actionTimer;
      target.shieldActive = false;
      target.parryWindow = false;
    }

    if (!target.superArmor) {
      this.addStagger(room, attacker, target, staggerDamage);
    }

    const khenPredatorRefund = attacker.fighterId === 'khen' && isBackstab ? 10 : 0;

    this.pushEvent(room, {
      kind: 'hit',
      attackerId: attacker.playerId,
      targetId: target.playerId,
      fighterId: attacker.fighterId,
      x: target.x,
      y: target.y + 1.15,
      z: target.z,
      dirX,
      dirZ,
      colorHex,
      damage: finalDmg,
      isCrit: isCrit || isUltimate || wasCounter,
      isBackstab,
      isCounter: wasCounter,
      comboHit: attacker.comboCount,
      hitStopMs: isUltimate ? 95 : isHeavy || isCrit ? 55 : 0,
      abilitySlot: attacker.lastCastSlot ?? undefined,
      comboStep: attacker.comboStep || undefined,
      m1Variant: attacker.m1Variant,
      isComboLink: attacker.pendingComboLink,
      frenzyInside: attacker.frenzyInside,
      staminaRefund: khenPredatorRefund || undefined,
    });

    if (target.hp <= 0) {
      const cause: KoCause = isUltimate
        ? 'ultimate'
        : attacker.comboCount >= 3 || attacker.pendingComboLink
        ? 'combo'
        : 'normal';
      this.eliminateActor(room, attacker, target, cause);
    }
    return true;
  }

  private eliminateActor(
    room: RoomInstance,
    attacker: InternalActor | null,
    target: InternalActor,
    cause: KoCause
  ): void {
    if (target.isKO || target.isDummy) return;
    target.hp = 0;
    target.isKO = true;
    target.koTime = room.matchTime;
    target.koCause = cause;
    target.koStyle = attacker ? FIGHTER_BY_ID[attacker.fighterId].koStyle : target.koStyle;
    target.koByFighterId = attacker?.fighterId ?? target.fighterId;
    target.damagePhase = 'DEFEATED';
    target.actionState = 'ko';
    target.shieldActive = false;
    target.parryWindow = false;
    target.blockHeld = false;
    if (attacker && attacker.playerId !== target.playerId) {
      attacker.kills += 1;
    }

    const causeText =
      cause === 'parry'
        ? 'COUNTER EXECUTION!'
        : cause === 'ultimate'
        ? 'ULTIMATE FINISH!'
        : cause === 'combo'
        ? 'COMBO OBLITERATION!'
        : cause === 'clash'
        ? 'CLASH BREAKER KO!'
        : cause === 'grab'
        ? 'GUARD CRUSH KO!'
        : cause === 'ring'
        ? 'OUT OF SAFE RING!'
        : `${FIGHTER_BY_ID[target.fighterId].name} KO!`;

    this.pushEvent(room, {
      kind: 'ko',
      attackerId: attacker?.playerId,
      targetId: target.playerId,
      fighterId: attacker?.fighterId ?? target.fighterId,
      x: target.x,
      y: target.y + 1.0,
      z: target.z,
      colorHex: FIGHTER_BY_ID[attacker?.fighterId ?? target.fighterId].hex,
      hitStopMs: 120,
      callout: causeText,
      koStyle: target.koStyle,
      koCause: cause,
    });
  }

  private spawnRandomBattleEvent(room: RoomInstance): void {
    const kinds: BattlefieldEventKind[] = ['frenzy', 'hazard', 'gravity', 'surge'];
    const kind = kinds[room.eventRotationIdx % kinds.length];
    room.eventRotationIdx += 1;

    const ang = Math.random() * Math.PI * 2;
    const rad = 2.5 + Math.random() * 6.5;
    const x = Number((Math.cos(ang) * rad).toFixed(1));
    const z = Number((Math.sin(ang) * rad).toFixed(1));

    if (kind === 'frenzy') {
      room.battleEvent = {
        id: makeId('ev'),
        kind: 'frenzy',
        title: 'FRENZY ZONE',
        subtitle: '+25% DMG, rapid Stamina & 2x Passives inside ring',
        x,
        z,
        radius: 6.2,
        remaining: 11.0,
        telegraphRemaining: 0,
        colorHex: 0xf43f5e,
        hazardDetonated: false,
      };
    } else if (kind === 'hazard') {
      room.battleEvent = {
        id: makeId('ev'),
        kind: 'hazard',
        title: 'SKY LIGHTNING STRIKE',
        subtitle: 'Evacuate crimson danger circle before detonation!',
        x,
        z,
        radius: 5.5,
        remaining: 3.4,
        telegraphRemaining: 2.1,
        colorHex: 0xfacc15,
        hazardDetonated: false,
      };
    } else if (kind === 'gravity') {
      room.battleEvent = {
        id: makeId('ev'),
        kind: 'gravity',
        title: 'GRAVITY SURGE',
        subtitle: 'High jumps & boosted aerial combat everywhere!',
        x: 0,
        z: 0,
        radius: 20,
        remaining: 9.0,
        telegraphRemaining: 0,
        colorHex: 0x38bdf8,
        hazardDetonated: false,
      };
    } else {
      // Surge immediately refreshes all orbs + boosts Chi!
      for (const pk of room.pickups) {
        pk.active = true;
        pk.respawnTimer = 0;
      }
      room.battleEvent = {
        id: makeId('ev'),
        kind: 'surge',
        title: 'CHI OVERFLOW',
        subtitle: 'All Health & Chi shrines restored!',
        x: 0,
        z: 0,
        radius: 18,
        remaining: 4.5,
        telegraphRemaining: 0,
        colorHex: 0x10b981,
        hazardDetonated: false,
      };
    }
  }

  private tickBot(room: RoomInstance, bot: InternalActor, dt: number): void {
    if (bot.isDummy) {
      bot.hp = room.matchTime - bot.lastDamagedAt >= 2.2
        ? Math.min(bot.maxHp, bot.hp + 950 * dt)
        : Math.max(1, bot.hp);
      bot.damagePhase = getDamagePhase(bot.hp, bot.maxHp, false);
      const human = room.actors.find((a) => !a.isBot && !a.isKO);
      if (human) {
        bot.rotY = Math.atan2(human.x - bot.x, human.z - bot.z);
      }
      if (bot.actionState === 'idle' || bot.actionState === 'move') {
        const homeDx = 0 - bot.x;
        const homeDz = -4.5 - bot.z;
        const homeDist = Math.hypot(homeDx, homeDz);
        if (homeDist > 0.45) {
          bot.moveX = (homeDx / homeDist) * 0.6;
          bot.moveZ = (homeDz / homeDist) * 0.6;
        } else {
          bot.moveX = 0;
          bot.moveZ = 0;
        }
      } else {
        bot.moveX = 0;
        bot.moveZ = 0;
      }
      return;
    }

    if (bot.isKO) {
      if (bot.koTime !== null && room.matchTime - bot.koTime >= 2.8) {
        bot.isKO = false;
        bot.koTime = null;
        bot.hp = bot.maxHp;
        bot.mana = 50;
        bot.stamina = bot.maxStamina;
        bot.stagger = 0;
        bot.isStunned = false;
        bot.isOverdrive = false;
        bot.overdriveAnnounced = false;
        bot.damagePhase = 'NORMAL';
        bot.actionState = 'idle';
        bot.x = 0;
        bot.y = 0;
        bot.z = -5.5;
        bot.vx = 0;
        bot.yVel = 0;
        bot.vz = 0;
        bot.grounded = true;
      }
      return;
    }

    if (room.activeClash && (room.activeClash.playerAId === bot.playerId || room.activeClash.playerBId === bot.playerId)) {
      if (room.activeClash.remaining < 1.6) {
        const choices: CombatMoveType[] = ['strike', 'grab', 'parry'];
        const pick = choices[Math.floor(Math.random() * choices.length)];
        if (room.activeClash.playerAId === bot.playerId && !room.activeClash.choiceA) {
          room.activeClash.choiceA = pick;
        } else if (room.activeClash.playerBId === bot.playerId && !room.activeClash.choiceB) {
          room.activeClash.choiceB = pick;
        }
        if (room.activeClash.choiceA && room.activeClash.choiceB) {
          this.resolveClash(room);
        }
      }
      return;
    }

    if (
      room.activeHeadlock &&
      (room.activeHeadlock.grabberId === bot.playerId || room.activeHeadlock.victimId === bot.playerId)
    ) {
      // Bot mashes Grab during active 3-second headlock!
      if (Math.random() < dt * 5.2) {
        if (room.activeHeadlock.grabberId === bot.playerId) {
          room.activeHeadlock.grabberMashes += 1;
        } else {
          room.activeHeadlock.victimMashes += 1;
        }
      }
      return;
    }

    // Race toward Awakening Orbs if active & bot is not awakened
    if (room.awakeningPhase === 'ORBS_ACTIVE' && !bot.awakened) {
      let nearestOrb: AwakeningOrbState | null = null;
      let nearestDist = Infinity;
      for (const orb of room.awakeningOrbs) {
        if (!orb.active) continue;
        const od = Math.hypot(orb.x - bot.x, orb.z - bot.z);
        if (od < nearestDist) {
          nearestDist = od;
          nearestOrb = orb;
        }
      }
      if (nearestOrb && nearestDist > 0.2) {
        const ox = nearestOrb.x - bot.x;
        const oz = nearestOrb.z - bot.z;
        bot.moveX = ox / nearestDist;
        bot.moveZ = oz / nearestDist;
        bot.rotY = Math.atan2(ox, oz);
        if (nearestDist > 4.5 && bot.dashCooldown <= 0.02 && bot.stamina >= 22 && Math.random() < dt * 2.2) {
          this.tryDash(room, bot, bot.moveX, bot.moveZ, bot.rotY);
        }
        return;
      }
    }

    const foe = this.findPreferredTarget(room, bot, 35);
    if (!foe) return;
    const dx = foe.x - bot.x;
    const dz = foe.z - bot.z;
    const dist = Math.hypot(dx, dz);
    bot.rotY = Math.atan2(dx, dz);

    // Stay inside shrinking 2-minute storm ring!
    if (room.stormActive && Math.hypot(bot.x, bot.z) > Math.max(1.2, room.stormRadius * 0.82)) {
      const rDist = Math.max(0.01, Math.hypot(bot.x, bot.z));
      bot.moveX = -(bot.x / rDist) * 0.92;
      bot.moveZ = -(bot.z / rDist) * 0.92;
      if (bot.dashCooldown <= 0.02 && bot.stamina >= 16 && Math.random() < dt * 2.5) {
        this.tryDash(room, bot, bot.moveX, bot.moveZ, Math.atan2(-bot.x, -bot.z));
      }
      return;
    }

    // Dodge-step reactively out of incoming enemy telegraphs with standalone Dash!
    const inDangerTel = room.telegraphs.find(
      (t) => t.ownerId !== bot.playerId && Math.hypot(t.x - bot.x, t.z - bot.z) <= Math.max(3.6, t.radius + 0.5)
    );
    if (inDangerTel && bot.dashCooldown <= 0.02 && bot.stamina >= 16 && Math.random() < dt * 3.0) {
      this.tryDash(room, bot, -dz / Math.max(1, dist), dx / Math.max(1, dist));
      return;
    }

    // Trigger Stage 2 follow-up when primed!
    if (bot.stage2Slot === 3 && bot.cooldowns[3] <= 0.02 && bot.stamina >= 14 && Math.random() < dt * 2.4) {
      this.tryActivateAbility(room, bot, 3, false);
      return;
    }

    if (foe.y > bot.y + 0.6 && bot.grounded && Math.random() < dt * 1.4) {
      this.tryJump(room, bot);
    }

    // Brief 1.8s opening stance/pacing at round start so combat opens cleanly without instant spawn-rush
    if (room.matchTime < 1.8) {
      const side = Math.sin(room.matchTime * 2.2) * 0.35;
      if (dist > 6.8) {
        bot.moveX = (dx / dist) * 0.42;
        bot.moveZ = (dz / dist) * 0.42;
      } else {
        bot.moveX = (-dz / Math.max(1, dist)) * side;
        bot.moveZ = (dx / Math.max(1, dist)) * side;
      }
      return;
    }

    if (dist > 3.4) {
      bot.moveX = (dx / dist) * 0.56;
      bot.moveZ = (dz / dist) * 0.56;
      if (dist < 8.0 && bot.cooldowns[2] <= 0.02 && bot.mana >= 24 && Math.random() < dt * 0.55) {
        this.tryActivateAbility(room, bot, 2, false);
      }
    } else {
      bot.moveX = Math.sin(room.matchTime * 1.4) * 0.25;
      bot.moveZ = Math.cos(room.matchTime * 1.4) * 0.25;
      if (Math.random() < dt * 0.68) {
        if (foe.shieldActive) {
          this.tryGrab(room, bot);
        } else if (bot.awakened && bot.cooldowns[6] <= 0.02 && bot.mana >= 55 && Math.random() < 0.25) {
          this.tryActivateAbility(room, bot, 6, false);
        } else if (bot.mana >= 30 && Math.random() < 0.18) {
          this.tryActivateAbility(room, bot, 3, false);
        } else {
          this.tryActivateAbility(room, bot, Math.random() < 0.22 ? 1 : 0, bot.comboStep >= 3);
        }
      }
    }
  }

  private tick(): void {
    const now = Date.now();
    const dt = Math.min((now - this.lastTickMs) / 1000, 0.1);
    this.lastTickMs = now;

    for (const [code, room] of this.rooms.entries()) {
      if (room.phase !== 'lobby') {
        const activeConnected = room.players.some((p) => p.connected);
        if (!activeConnected && now - room.lastEmptyAt > 60_000) {
          this.rooms.delete(code);
          continue;
        }
        if (activeConnected) room.lastEmptyAt = now;
      }

      if (room.phase === 'countdown') {
        room.countdown -= dt;
        if (room.countdown <= 0) {
          room.countdown = 0;
          room.phase = 'combat';
          this.broadcastRoomState(room);
        } else {
          this.broadcastRoomState(room);
        }
        continue;
      }

      if (room.phase === 'roundEnd') {
        room.countdown -= dt;
        if (room.countdown <= 0) {
          this.startCountdown(room);
        } else {
          this.broadcastRoomState(room);
        }
        continue;
      }

      if (room.phase !== 'combat') continue;

      const awakeningCutsceneActive = tickAwakeningRoom(room, dt, this.getAwakeningHelpers());
      if (awakeningCutsceneActive) {
        this.broadcastSnapshot(room);
        room.pendingEvents = [];
        continue;
      }

      room.matchTime += dt;
      const arenaRadius = MAP_BY_ID[room.mapId].arenaRadius;

      // Active Clash QTE timer
      if (room.activeClash) {
        room.activeClash.remaining -= dt;
        if (room.activeClash.remaining <= 0) {
          this.resolveClash(room);
        }
      }

      // Active 3-Second Interactive Headlock Mash timer & pin
      if (room.activeHeadlock) {
        const hl = room.activeHeadlock;
        const grabber = room.actors.find((a) => a.playerId === hl.grabberId);
        const victim = room.actors.find((a) => a.playerId === hl.victimId);
        if (!grabber || !victim || grabber.isKO || victim.isKO) {
          room.activeHeadlock = null;
          if (grabber && grabber.actionState === 'headlock') grabber.actionState = 'idle';
          if (victim && victim.actionState === 'headlock') victim.actionState = 'idle';
        } else {
          hl.remaining -= dt;
          const fx = Math.sin(grabber.rotY);
          const fz = Math.cos(grabber.rotY);
          grabber.vx = 0;
          grabber.vz = 0;
          grabber.yVel = 0;
          victim.vx = 0;
          victim.vz = 0;
          victim.yVel = 0;
          victim.x = grabber.x + fx * 0.72;
          victim.z = grabber.z + fz * 0.72;
          victim.y = grabber.y;
          victim.rotY = grabber.rotY + Math.PI;
          hl.x = (grabber.x + victim.x) * 0.5;
          hl.y = grabber.y + 1.15;
          hl.z = (grabber.z + victim.z) * 0.5;
          if (hl.remaining <= 0) {
            this.resolveHeadlock(room);
          }
        }
      }

      // Dynamic Battlefield Events cycle
      if (room.battleEvent) {
        room.battleEvent.remaining -= dt;
        if (room.battleEvent.kind === 'hazard' && !room.battleEvent.hazardDetonated) {
          room.battleEvent.telegraphRemaining = Math.max(0, room.battleEvent.telegraphRemaining - dt);
          if (room.battleEvent.telegraphRemaining <= 0) {
            room.battleEvent.hazardDetonated = true;
            const hz = room.battleEvent;
            this.pushEvent(room, {
              kind: 'hazardHit',
              x: hz.x,
              y: 0.2,
              z: hz.z,
              colorHex: 0xfacc15,
              hitStopMs: 70,
              callout: 'LIGHTNING DETONATION!',
            });
            for (const actor of room.actors) {
              if (actor.isKO) continue;
              const d = Math.hypot(actor.x - hz.x, actor.z - hz.z);
              if (d <= hz.radius) {
                const dmg = 20;
                actor.hp = Math.max(0, actor.hp - dmg);
                actor.damagePhase = getDamagePhase(actor.hp, actor.maxHp, actor.isKO);
                actor.yVel = 6.5;
                actor.grounded = false;
                actor.actionState = 'stagger';
                actor.actionTimer = 0.55;
                actor.actionDuration = 0.55;
                this.addStagger(room, actor, actor, 30);
                if (actor.hp <= 0) {
                  this.eliminateActor(room, null, actor, 'normal');
                }
              }
            }
          }
        }
        if (room.battleEvent.remaining <= 0) {
          room.battleEvent = null;
          room.nextEventAt = room.matchTime + 14.0;
        }
      } else if (!room.isTrainingMode && room.matchTime >= room.nextEventAt) {
        this.spawnRandomBattleEvent(room);
      }

      // Pickups
      for (const pk of room.pickups) {
        if (!pk.active) {
          pk.respawnTimer -= dt;
          if (pk.respawnTimer <= 0) {
            pk.active = true;
            pk.respawnTimer = 0;
          }
          continue;
        }
        for (const actor of room.actors) {
          if (actor.isKO || actor.isDummy) continue;
          if (pk.kind === 'health' && actor.hp >= actor.maxHp) continue;
          if (pk.kind === 'mana' && actor.mana >= actor.maxMana) continue;
          const d = Math.hypot(actor.x - pk.x, actor.z - pk.z);
          if (d <= 1.25 && Math.abs(actor.y + 0.8 - pk.y) <= 1.45) {
            pk.active = false;
            pk.respawnTimer = pk.kind === 'health' ? 12.0 : 10.0;
            if (pk.kind === 'health') {
              const healed = Math.min(actor.maxHp - actor.hp, 30);
              actor.hp += healed;
              if (actor.hp > actor.maxHp * 0.45) actor.isOverdrive = false;
              actor.damagePhase = getDamagePhase(actor.hp, actor.maxHp, actor.isKO);
              this.pushEvent(room, {
                kind: 'pickup',
                targetId: actor.playerId,
                x: pk.x,
                y: pk.y,
                z: pk.z,
                colorHex: 0x10b981,
                callout: `+${healed} HP`,
              });
            } else {
              const restored = Math.min(actor.maxMana - actor.mana, 45);
              actor.mana += restored;
              actor.stamina = clamp(actor.stamina + 25, 0, actor.maxStamina);
              this.pushEvent(room, {
                kind: 'pickup',
                targetId: actor.playerId,
                x: pk.x,
                y: pk.y,
                z: pk.z,
                colorHex: 0x38bdf8,
                callout: `+${restored} CHI`,
              });
            }
            break;
          }
        }
      }

      // 1-Minute Sudden Death Shrinking Storm Zone (disabled in Training Area)
      room.stormMaxRadius = arenaRadius;
      if (!room.isTrainingMode && !room.stormActive && room.matchTime >= 60.0) {
        room.stormActive = true;
        room.stormRadius = arenaRadius;
        room.stormTickTimer = 0.5;
        this.pushEvent(room, {
          kind: 'hazardHit',
          x: 0,
          y: 0.6,
          z: 0,
          colorHex: 0xf43f5e,
          hitStopMs: 0,
          callout: '1:00 — STORM ZONE CLOSING!',
        });
      }
      if (room.stormActive) {
        room.stormRadius = Math.max(4.0, room.stormRadius - 0.85 * dt);
        room.stormTickTimer -= dt;
        if (room.stormTickTimer <= 0) {
          room.stormTickTimer = 0.5;
          for (const actor of room.actors) {
            if (actor.isKO) continue;
            if (Math.hypot(actor.x, actor.z) > room.stormRadius) {
              const burn = 6;
              actor.hp = Math.max(0, actor.hp - burn);
              actor.damagePhase = getDamagePhase(actor.hp, actor.maxHp, actor.isKO);
              actor.lastDamagedAt = room.matchTime;
              this.pushEvent(room, {
                kind: 'hazardHit',
                targetId: actor.playerId,
                fighterId: actor.fighterId,
                x: actor.x,
                y: actor.y + 1.0,
                z: actor.z,
                colorHex: 0xf43f5e,
                damage: burn,
              });
              if (actor.hp <= 0) {
                this.eliminateActor(room, null, actor, 'ring');
              }
            }
          }
        }
      }

      // Actors
      const zeroCdMode = room.isTrainingMode && room.trainingConfig.zeroCooldowns;
      for (const actor of room.actors) {
        if (zeroCdMode && !actor.isBot) {
          for (let i = 0; i < 7; i++) actor.cooldowns[i] = 0;
          actor.grabCooldown = 0;
          actor.dashCooldown = 0;
          actor.flightCooldown = 0;
          actor.flightRemaining = actor.flightMax;
          actor.mana = actor.maxMana;
          actor.stamina = actor.maxStamina;
        } else {
          for (let i = 0; i < 7; i++) {
            actor.cooldowns[i] = Math.max(0, actor.cooldowns[i] - dt);
          }
          actor.grabCooldown = Math.max(0, actor.grabCooldown - dt);
          actor.dashCooldown = Math.max(0, actor.dashCooldown - dt);
        }
        actor.clashCooldown = Math.max(0, actor.clashCooldown - dt);
        actor.iframeTimer = Math.max(0, actor.iframeTimer - dt);
        actor.perfectEvadeTimer = Math.max(0, actor.perfectEvadeTimer - dt);
        actor.speedBoostTimer = Math.max(0, actor.speedBoostTimer - dt);

        // Standalone 1.5s Dash Cooldown sync
        actor.dashCharges = actor.dashCooldown <= 0.01 ? 1 : 0;
        actor.dashMaxCharges = 1;
        actor.dashRechargeRemaining = actor.dashCooldown;

        // JM Sky Flight Passive (dedicated R toggle -> fly up to 7.0s -> 10.0s cooldown)
        if (actor.fighterId === 'jm') {
          if (actor.flightCooldown > 0) {
            actor.flightCooldown = zeroCdMode && !actor.isBot ? 0 : Math.max(0, actor.flightCooldown - dt);
            if (actor.flightCooldown <= 0) {
              actor.flightRemaining = actor.flightMax;
            }
          }
          if (actor.isFlying) {
            if (!(zeroCdMode && !actor.isBot)) {
              actor.flightRemaining = Math.max(0, actor.flightRemaining - dt);
            }
            if (
              actor.flightRemaining <= 0 ||
              actor.isKO ||
              actor.actionState === 'stagger' ||
              actor.actionState === 'clash' ||
              actor.actionState === 'headlock'
            ) {
              actor.isFlying = false;
              actor.flightCooldown = zeroCdMode && !actor.isBot ? 0 : 10.0;
              actor.grounded = false;
            }
          }
        }

        if (actor.rushFatigueDecayTimer > 0) {
          actor.rushFatigueDecayTimer = Math.max(0, actor.rushFatigueDecayTimer - dt);
          if (actor.rushFatigueDecayTimer <= 0) {
            actor.rushFatigue = 0;
          }
        }

        if (actor.stage2Slot !== null && actor.stage2Timer > 0) {
          actor.stage2Timer = Math.max(0, actor.stage2Timer - dt);
          if (actor.stage2Timer <= 0) {
            const pendingCd =
              actor.stage2PendingCooldown || FIGHTER_BY_ID[actor.fighterId].abilities[3].cooldown;
            actor.stage2Slot = null;
            actor.stage2Label = '';
            actor.stage2PendingCooldown = 0;
            actor.cooldowns[3] = Math.max(actor.cooldowns[3], pendingCd);
          }
        }

        if (actor.isBot) {
          this.tickBot(room, actor, dt);
        }

        if (actor.isKO) {
          this.clearActorTelegraph(room, actor);
          actor.vx *= Math.exp(-5.0 * dt);
          actor.vz *= Math.exp(-5.0 * dt);
          actor.x += actor.vx * dt;
          actor.z += actor.vz * dt;
          const r = Math.hypot(actor.x, actor.z);
          if (r > arenaRadius) {
            actor.x = (actor.x / r) * arenaRadius;
            actor.z = (actor.z / r) * arenaRadius;
          }
          continue;
        }

        if (actor.actionState === 'stagger') {
          actor.superArmor = false;
          this.clearActorTelegraph(room, actor);
        }

        if (actor.actionState === 'clash' || actor.actionState === 'headlock') {
          continue;
        }

        // Prime Steam Eruption: dashing across own Molten Fissure erupts a shockwave blast!
        if (actor.actionState === 'dash' && actor.fighterId === 'prime' && !actor.dashEruptedThisDash) {
          const fissure = room.zones.find(
            (z) =>
              z.ownerId === actor.playerId &&
              z.kind === 'moltenFissure' &&
              Math.hypot(actor.x - z.x, actor.z - z.z) <= z.radius + 0.5
          );
          if (fissure) {
            actor.dashEruptedThisDash = true;
            room.zones = room.zones.filter((z) => z.id !== fissure.id);
            this.pushEvent(room, {
              kind: 'trapTrigger',
              attackerId: actor.playerId,
              fighterId: 'prime',
              x: fissure.x,
              y: fissure.y + 0.35,
              z: fissure.z,
              colorHex: 0xfb923c,
              abilitySlot: 2,
              callout: 'STEAM ERUPTION!',
            });
            this.pushEvent(room, {
              kind: 'shockwave',
              attackerId: actor.playerId,
              fighterId: 'prime',
              x: fissure.x,
              y: fissure.y + 0.12,
              z: fissure.z,
              colorHex: 0xf43f5e,
              abilitySlot: 3,
              isComboLink: true,
            });
            for (const target of room.actors) {
              if (target.playerId === actor.playerId || target.isKO) continue;
              const d = Math.hypot(target.x - fissure.x, target.z - fissure.z);
              if (d <= 4.6) {
                const calc = this.computeDynamicDamage(actor, target, 11, 2);
                this.applyHit(
                  room,
                  actor,
                  target,
                  calc.dmg,
                  20 + calc.staggerBonus,
                  10.0,
                  d > 0.05 ? (target.x - fissure.x) / d : 0,
                  d > 0.05 ? (target.z - fissure.z) / d : 1,
                  0xf43f5e,
                  true,
                  false,
                  false,
                  calc.isCrit,
                  calc.isBackstab
                );
              }
            }
          }
        }

        // Frenzy Zone check
        actor.frenzyInside =
          room.battleEvent?.kind === 'frenzy' &&
          Math.hypot(actor.x - room.battleEvent.x, actor.z - room.battleEvent.z) <= room.battleEvent.radius;

        // JM Frenzy regeneration passive
        if (actor.fighterId === 'jm' && actor.frenzyInside && actor.hp < actor.maxHp * 0.4) {
          actor.hp = Math.min(actor.maxHp, actor.hp + 3.0 * dt);
        }

        // Reset combo strictly after 2.0s with no damage dealt; decay passive stacks after 3.2s
        if (actor.comboCount > 0 && room.matchTime - actor.lastHitAt >= 2.0) {
          actor.comboCount = 0;
        }
        if (room.matchTime - actor.lastHitAt > 3.2) {
          actor.passiveStacks = Math.max(0, actor.passiveStacks - 1);
        }
        if (room.matchTime - actor.lastDamagedAt > 2.4 && !actor.isStunned) {
          actor.stagger = Math.max(0, actor.stagger - 14 * dt);
        }

        // Whiff vulnerability timer
        if (actor.whiffTimer > 0) {
          actor.whiffTimer = Math.max(0, actor.whiffTimer - dt);
          if (actor.whiffTimer <= 0 && actor.actionState === 'whiff') {
            actor.actionState = actor.grounded ? 'idle' : 'jump';
          }
        }

        // Hold-to-Block / Parry
        if (actor.blockHeld && !actor.prevBlockHeld && actor.actionState !== 'stagger' && actor.actionState !== 'whiff' && actor.stamina >= 8) {
          if (actor.actionState === 'idle' || actor.actionState === 'move' || actor.actionState === 'jump') {
            actor.actionState = 'guard';
            actor.shieldActive = true;
            actor.parryWindow = true;
            actor.parryStartedAt = room.matchTime;
            actor.actionTimer = 0;
            actor.abilitySlot = null;
          }
        }
        actor.prevBlockHeld = actor.blockHeld;

        if (actor.blockHeld && actor.actionState === 'guard' && actor.stamina > 0) {
          actor.shieldActive = true;
          actor.parryWindow = room.matchTime - actor.parryStartedAt <= 0.26;
          actor.stamina = Math.max(0, actor.stamina - 8.0 * dt);
          if (actor.stamina <= 0.1) {
            actor.blockHeld = false;
            actor.shieldActive = false;
            actor.parryWindow = false;
            actor.actionState = 'idle';
          }
        } else if (!actor.blockHeld && actor.actionState === 'guard' && actor.actionTimer <= 0) {
          actor.shieldActive = false;
          actor.parryWindow = false;
          actor.actionState = 'idle';
        }

        // Tactical Stamina & Slow Chi Regen
        const canRegenStamina =
          !actor.shieldActive && actor.actionState !== 'stagger' && actor.actionState !== 'whiff';
        if (canRegenStamina) {
          let stamRate = 9.0;
          if (actor.isOverdrive) stamRate *= 1.35;
          if (actor.frenzyInside) stamRate *= 1.45;
          actor.stamina = clamp(actor.stamina + stamRate * dt, 0, actor.maxStamina);
        }
        actor.mana = clamp(actor.mana + (actor.frenzyInside ? 5.5 : 2.5) * dt, 0, actor.maxMana);

        // Timed Action Progression
        if (actor.actionTimer > 0) {
          const elapsedInAction = actor.actionDuration - actor.actionTimer;
          // JM Secret Ultimate Sky Ascent & Live Movement-Steering Aim
          if (actor.actionState === 'ultimate' && actor.abilitySlot === 5 && !actor.windupTriggered) {
            actor.y = Math.min(7.2, actor.y + dt * 11.5);
            actor.yVel = 0;
            actor.grounded = false;
            if (Math.abs(actor.moveX) > 0.08 || Math.abs(actor.moveZ) > 0.08) {
              const curAimX = (actor.pendingAimX ?? actor.x) + actor.moveX * 13.0 * dt;
              const curAimZ = (actor.pendingAimZ ?? actor.z) + actor.moveZ * 13.0 * dt;
              const clamped = this.clampAimPoint(room, actor, curAimX, curAimZ, JM_SECRET_ABILITY.aimRange ?? 17.5);
              actor.pendingAimX = clamped.x;
              actor.pendingAimZ = clamped.z;
              const adx = clamped.x - actor.x;
              const adz = clamped.z - actor.z;
              if (Math.hypot(adx, adz) > 0.15) {
                actor.rotY = Math.atan2(adx, adz);
              }
              if (actor.activeTelegraphId) {
                const tel = room.telegraphs.find((t) => t.id === actor.activeTelegraphId);
                if (tel) {
                  tel.x = clamped.x;
                  tel.z = clamped.z;
                }
              }
            }
          }

          if (actor.actionState === 'grab' && !actor.windupTriggered && elapsedInAction >= 0.11) {
            actor.windupTriggered = true;
            this.executeGrabImpact(room, actor);
          } else if (actor.abilitySlot !== null && !actor.windupTriggered) {
            const slotVal = actor.abilitySlot;
            const awAb =
              actor.awakened && (slotVal === 0 || slotVal === 2 || slotVal === 3 || slotVal === 4 || slotVal === 6)
                ? getAwakenedAbility(actor.fighterId, slotVal as 0 | 2 | 3 | 4 | 6)
                : null;
            const ab = awAb
              ? awAb
              : slotVal === 5
              ? JM_SECRET_ABILITY
              : FIGHTER_BY_ID[actor.fighterId].abilities[slotVal === 6 ? 4 : slotVal];
            const effectiveWindup =
              actor.abilitySlot === 0 && actor.fighterId === 'prime' && actor.comboStep === 4
                ? ab.windup + 0.08
                : ab.windup;
            if (elapsedInAction >= effectiveWindup && actor.actionState !== 'guard') {
              actor.windupTriggered = true;
              this.executeAbilityImpact(room, actor);
            }
          }
          if (actor.actionState === 'guard') {
            actor.parryWindow = room.matchTime - actor.parryStartedAt <= 0.26;
          }

          actor.actionTimer -= dt;
          if (actor.actionTimer <= 0) {
            actor.actionTimer = 0;
            actor.superArmor = false;
            const prevState = actor.actionState;
            const prevSlot = actor.abilitySlot;
            const missedBigMove =
              !actor.landedCurrentAction &&
              (prevState === 'grab' ||
                prevSlot === 3 ||
                prevSlot === 4 ||
                prevSlot === 5 ||
                prevSlot === 6);

            actor.abilitySlot = null;
            actor.pendingComboLink = false;

            if (prevState === 'stagger' && actor.isStunned) {
              actor.isStunned = false;
              actor.stagger = 0;
            }

            if (missedBigMove) {
              const prevAwAb =
                actor.awakened &&
                prevSlot !== null &&
                (prevSlot === 0 || prevSlot === 2 || prevSlot === 3 || prevSlot === 4 || prevSlot === 6)
                  ? getAwakenedAbility(actor.fighterId, prevSlot as 0 | 2 | 3 | 4 | 6)
                  : null;
              const whiffDur =
                prevState === 'grab'
                  ? 0.42
                  : prevAwAb
                  ? prevAwAb.whiffRecovery
                  : prevSlot === 5
                  ? JM_SECRET_ABILITY.whiffRecovery
                  : prevSlot !== null
                  ? FIGHTER_BY_ID[actor.fighterId].abilities[prevSlot === 6 ? 4 : prevSlot].whiffRecovery
                  : 0.4;
              actor.whiffTimer = whiffDur;
              actor.actionState = 'whiff';
              this.pushEvent(room, {
                kind: 'whiff',
                targetId: actor.playerId,
                fighterId: actor.fighterId,
                x: actor.x,
                y: actor.y + 1.35,
                z: actor.z,
                dirX: Math.sin(actor.rotY),
                dirZ: Math.cos(actor.rotY),
                colorHex: FIGHTER_BY_ID[actor.fighterId].hex,
                whiffSlot: prevSlot,
                abilitySlot: prevSlot ?? undefined,
              });
            } else if (!actor.blockHeld || prevState !== 'guard') {
              actor.actionState = actor.grounded ? 'idle' : 'jump';
              actor.shieldActive = false;
              actor.parryWindow = false;
            }
          }
        } else if (
          actor.actionState === 'attack' ||
          actor.actionState === 'skill' ||
          actor.actionState === 'ultimate' ||
          actor.actionState === 'dash' ||
          actor.actionState === 'grab' ||
          actor.actionState === 'stagger'
        ) {
          // Defensive unstuck guard: never leave an actor locked with timer <= 0
          actor.abilitySlot = null;
          actor.superArmor = false;
          actor.isStunned = false;
          actor.actionState = actor.grounded ? 'idle' : 'jump';
        }

        // Locomotion (Overdrive, Tailwind, Quick-Draw Step & Khen Lunge Speed Boosts!)
        const canMove =
          actor.actionState === 'idle' ||
          actor.actionState === 'move' ||
          actor.actionState === 'jump' ||
          actor.actionState === 'guard' ||
          actor.actionState === 'whiff';
        const baseMoveSpeed =
          FIGHTER_BY_ID[actor.fighterId].moveSpeed *
          (actor.isOverdrive ? 1.18 : 1.0) *
          (actor.speedBoostTimer > 0 ? 1.24 : 1.0) *
          (actor.fighterId === 'marjohn' ? 1 + actor.passiveStacks * 0.04 : 1.0);
        const speed =
          baseMoveSpeed *
          (actor.actionState === 'whiff'
            ? 0.44
            : actor.actionState === 'guard'
            ? 0.36
            : actor.isFlying
            ? 1.12
            : actor.grounded
            ? 1.0
            : actor.fighterId === 'marjohn'
            ? 1.04
            : 0.92);

        if (canMove && (Math.abs(actor.moveX) > 0.06 || Math.abs(actor.moveZ) > 0.06)) {
          const blend = !actor.grounded && actor.fighterId === 'marjohn' ? 0.72 : 0.55;
          actor.vx = actor.vx * (1 - blend) + actor.moveX * speed * blend;
          actor.vz = actor.vz * (1 - blend) + actor.moveZ * speed * blend;
          if (actor.actionState !== 'guard' && actor.actionState !== 'whiff') {
            if (actor.grounded) actor.actionState = 'move';
            const targetYaw = Math.atan2(actor.moveX, actor.moveZ);
            const diff = normalizeAngle(targetYaw - actor.rotY);
            actor.rotY += diff * Math.min(1, dt * 14);
          }
        } else if (actor.actionState === 'dash') {
          // Override friction during dash burst so fighter travels cleanly across the arena
          actor.vx *= Math.exp(-1.1 * dt);
          actor.vz *= Math.exp(-1.1 * dt);
        } else {
          actor.vx *= Math.exp(-10.0 * dt);
          actor.vz *= Math.exp(-10.0 * dt);
          if (actor.actionState === 'move') actor.actionState = actor.grounded ? 'idle' : 'jump';
        }

        actor.x += actor.vx * dt;
        actor.z += actor.vz * dt;

        const resolved = resolveObstacleCollisions(room.mapId, actor.x, actor.y, actor.z, 0.48, room.obstacles);
        actor.x = resolved.x;
        actor.z = resolved.z;

        const isSkyCharging = actor.actionState === 'ultimate' && actor.abilitySlot === 5 && !actor.windupTriggered;
        if (!isSkyCharging) {
          const supportY = getObstacleSupportY(room.mapId, actor.x, actor.y, actor.z, 0.42, room.obstacles);
          if (actor.isFlying) {
            const hoverY = supportY + 4.35;
            actor.y += (hoverY - actor.y) * Math.min(1, dt * 6.5);
            actor.yVel = 0;
            actor.grounded = false;
            if (actor.actionState === 'idle' || actor.actionState === 'move') {
              actor.actionState = 'jump';
            }
          } else {
            // Marjohn Gale Drift passive: slightly slower falling speed while airborne
            const baseGrav = room.battleEvent?.kind === 'gravity' ? 18.5 : 26.0;
            const grav = actor.fighterId === 'marjohn' && actor.yVel < 0 ? baseGrav * 0.68 : baseGrav;
            if (actor.y > supportY || actor.yVel > 0) {
              actor.y += actor.yVel * dt;
              actor.yVel -= grav * dt;
              const postSupportY = getObstacleSupportY(room.mapId, actor.x, actor.y, actor.z, 0.42, room.obstacles);
              if (actor.y <= postSupportY) {
                actor.y = postSupportY;
                actor.yVel = 0;
                actor.grounded = true;
                if (actor.actionState === 'jump') actor.actionState = 'idle';
              } else {
                actor.grounded = false;
              }
            } else {
              actor.y = supportY;
              actor.yVel = 0;
              actor.grounded = true;
            }
          }
        }

        const r = Math.hypot(actor.x, actor.z);
        if (r > arenaRadius) {
          actor.x = (actor.x / r) * arenaRadius;
          actor.z = (actor.z / r) * arenaRadius;
        }
      }

      // Soft separation
      for (let i = 0; i < room.actors.length; i++) {
        const a = room.actors[i];
        if (a.isKO || a.actionState === 'clash') continue;
        for (let j = i + 1; j < room.actors.length; j++) {
          const b = room.actors[j];
          if (b.isKO || b.actionState === 'clash') continue;
          if (Math.abs(a.y - b.y) > 1.4) continue;
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.001 && d < 1.15) {
            const push = (1.15 - d) * 0.5;
            a.x -= (dx / d) * push;
            a.z -= (dz / d) * push;
            b.x += (dx / d) * push;
            b.z += (dz / d) * push;
          }
        }
      }

      // Keep actors out of obstacles and inside arena bounds after separation
      for (const a of room.actors) {
        if (a.isKO || a.actionState === 'clash') continue;
        const postSep = resolveObstacleCollisions(room.mapId, a.x, a.y, a.z, 0.48, room.obstacles);
        a.x = postSep.x;
        a.z = postSep.z;
        const r = Math.hypot(a.x, a.z);
        if (r > arenaRadius) {
          a.x = (a.x / r) * arenaRadius;
          a.z = (a.z / r) * arenaRadius;
        }
      }

      // Update Projectiles
      const nextProj: InternalProjectile[] = [];
      for (const p of room.projectiles) {
        p.age += dt;
        p.x += p.vx * dt;
        p.y += (p.vy ?? 0) * dt;
        p.z += p.vz * dt;
        const groundY = getMapTerrainHeight(room.mapId, p.x, p.z);
        const relY = p.y - groundY;

        const owner = room.actors.find((a) => a.playerId === p.ownerId);

        if (p.kind === 'solarFireball') {
          const hitTarget =
            p.targetX !== undefined &&
            p.targetZ !== undefined &&
            Math.hypot(p.x - p.targetX, p.z - p.targetZ) <= 0.95;
          if (hitTarget || relY <= 0.65 || p.age >= p.maxAge - 0.02) {
            const detX = p.targetX ?? p.x;
            const detZ = p.targetZ ?? p.z;
            const detGroundY = getMapTerrainHeight(room.mapId, detX, detZ);
            const blastRadius = 6.2;
            this.pushEvent(room, {
              kind: 'fireballImpact',
              attackerId: p.ownerId,
              fighterId: 'jm',
              x: detX,
              y: detGroundY + 0.3,
              z: detZ,
              radius: blastRadius,
              colorHex: 0xfacc15,
              hitStopMs: 115,
              abilitySlot: 5,
              callout: 'SOLAR DETONATION!',
            });
            if (owner) {
              for (const target of room.actors) {
                if (target.playerId === p.ownerId || target.isKO) continue;
                const dx = target.x - detX;
                const dz = target.z - detZ;
                const d = Math.hypot(dx, dz);
                if (d <= blastRadius) {
                  const nx = d > 0.05 ? dx / d : 0;
                  const nz = d > 0.05 ? dz / d : 1;
                  const calc = this.computeDynamicDamage(owner, target, p.damage, 5);
                  this.applyHit(
                    room,
                    owner,
                    target,
                    calc.dmg,
                    p.staggerDamage + calc.staggerBonus,
                    p.knockback,
                    nx,
                    nz,
                    0xfacc15,
                    true,
                    false,
                    true,
                    true,
                    calc.isBackstab
                  );
                }
              }
            }
            continue;
          }
          nextProj.push(p);
          continue;
        }

        if (p.kind === 'tornadoVortex' && owner) {
          for (const target of room.actors) {
            if (target.playerId === p.ownerId || target.isKO) continue;
            const dx = p.x - target.x;
            const dz = p.z - target.z;
            const d = Math.hypot(dx, dz);
            if (d <= AWAKENING_CONFIG.MARJOHN_CAT5_RADIUS && d > 0.2) {
              target.vx += (dx / d) * AWAKENING_CONFIG.MARJOHN_CAT5_PULL * dt;
              target.vz += (dz / d) * AWAKENING_CONFIG.MARJOHN_CAT5_PULL * dt;
            }
          }
        }

        const hitObs = findObstacleAtPoint(room.mapId, p.x, relY, p.z, room.obstacles);
        if (hitObs) {
          this.damageObstacle(room, hitObs, p.pierceObstacles ? 999 : Math.round(p.damage * 1.45), p.x, relY, p.z, p.colorHex);
          if (!p.pierceObstacles) {
            if (p.kind === 'crescent' && owner && !room.zones.some((z) => z.ownerId === owner.playerId && z.kind === 'voidAnchor' && z.remaining > 2.6)) {
              this.spawnZone(room, owner, 'voidAnchor', p.x, Math.max(0, relY - 0.8), p.z, 3.4, 2.5, 0xa855f7);
            }
            continue;
          }
        }

        // Enforce strict max range on nerfed gun / tornado / short-mid projectiles
        const traveled = Math.hypot(
          p.x - (p.originX ?? p.x),
          p.z - (p.originZ ?? p.z)
        );
        if (p.maxRange && traveled >= p.maxRange) {
          if (p.kind === 'tornadoVortex' && owner) {
            this.pushEvent(room, {
              kind: 'shockwave',
              attackerId: owner.playerId,
              fighterId: 'marjohn',
              x: p.x,
              y: 0.35,
              z: p.z,
              radius: AWAKENING_CONFIG.MARJOHN_CAT5_RADIUS,
              colorHex: p.colorHex,
              abilitySlot: 6,
              hitStopMs: 85,
              callout: 'CAT-5 DETONATION!',
            });
            for (const target of room.actors) {
              if (target.playerId === owner.playerId || target.isKO) continue;
              const d = Math.hypot(target.x - p.x, target.z - p.z);
              if (d <= AWAKENING_CONFIG.MARJOHN_CAT5_RADIUS) {
                const calc = this.computeDynamicDamage(owner, target, p.damage * 0.65, 6);
                if (this.applyHit(room, owner, target, calc.dmg, 36, p.knockback, d > 0.05 ? (target.x - p.x) / d : 0, d > 0.05 ? (target.z - p.z) / d : 1, p.colorHex, true, false, true, true, calc.isBackstab)) {
                  target.yVel = Math.max(target.yVel, 10.5);
                  target.grounded = false;
                }
              }
            }
          }
          continue;
        }

        let consumed = false;
        if (owner) {
          for (const target of room.actors) {
            if (target.playerId === p.ownerId || target.isKO || p.hitIds.has(target.playerId)) continue;
            const d = Math.hypot(target.x - p.x, target.z - p.z);
            const targetMidY = target.y + 1.05;
            const hitRadius =
              p.kind === 'tornadoVortex'
                ? 2.8
                : p.kind === 'windBlade'
                ? 2.15
                : p.kind === 'lasso'
                ? 1.95
                : p.kind === 'crescent' || p.kind === 'tornado' || p.kind === 'jmBeam' || p.kind === 'magnum' || p.kind === 'solarRailgun'
                ? 1.7
                : 1.2;
            const maxYDiff = p.kind === 'jmBolt' || p.kind === 'tornadoVortex' ? 2.4 : 1.45;
            if (d <= hitRadius && Math.abs(targetMidY - relY) <= maxYDiff) {
              p.hitIds.add(target.playerId);
              const spd = Math.max(0.01, Math.hypot(p.vx, p.vz));
              const hitSlot: AbilitySlot =
                p.kind === 'tornadoVortex' || p.kind === 'solarRailgun'
                  ? 6
                  : p.kind === 'lasso' || p.kind === 'crescent'
                  ? 3
                  : 0;
              const calc = this.computeDynamicDamage(owner, target, p.damage, hitSlot);
              const isHeavyProj =
                p.kind === 'magnum' ||
                p.kind === 'lasso' ||
                p.kind === 'crescent' ||
                p.kind === 'jmBeam' ||
                p.kind === 'windBlade' ||
                p.kind === 'solarRailgun' ||
                p.kind === 'tornadoVortex';
              const landed = this.applyHit(
                room,
                owner,
                target,
                calc.dmg,
                p.staggerDamage + calc.staggerBonus,
                Math.abs(p.knockback),
                p.vx / spd,
                p.vz / spd,
                p.colorHex,
                isHeavyProj,
                p.kind === 'lasso' || (p.kind === 'windBlade' && p.knockback < 0),
                p.kind === 'solarRailgun' || p.kind === 'tornadoVortex',
                calc.isCrit,
                calc.isBackstab
              );
              if (landed) {
                owner.landedCurrentAction = true;
                if (p.kind === 'bullet' || p.kind === 'magnum' || p.kind === 'solarRailgun') {
                  owner.mana = clamp(owner.mana + (p.kind === 'magnum' ? 14 : 10), 0, owner.maxMana);
                  if (owner.fighterId === 'damen') {
                    owner.speedBoostTimer = Math.max(owner.speedBoostTimer, 1.5);
                    owner.dashCooldown = Math.max(0, owner.dashCooldown - 0.5);
                  }
                } else if (p.kind === 'tornado' || p.kind === 'jmBolt' || p.kind === 'jmBeam' || p.kind === 'windBlade') {
                  owner.mana = clamp(owner.mana + 11, 0, owner.maxMana);
                }
                if (p.kind === 'crescent' && owner.awakened) {
                  target.silencedTimer = Math.max(target.silencedTimer, AWAKENING_CONFIG.KHEN_SILENCE_DURATION_SEC);
                  this.pushEvent(room, {
                    kind: 'silence',
                    attackerId: owner.playerId,
                    targetId: target.playerId,
                    fighterId: owner.fighterId,
                    x: target.x,
                    y: target.y + 1.4,
                    z: target.z,
                    colorHex: 0xa855f7,
                    callout: 'SILENCED!',
                  });
                }
                if (p.kind === 'lasso' && owner.awakened) {
                  target.snareMarkedTimer = Math.max(target.snareMarkedTimer, AWAKENING_CONFIG.DAMEN_SNARE_MARK_SEC);
                }
              }
              if (p.kind === 'lasso') {
                this.pushEvent(room, {
                  kind: 'lasso',
                  attackerId: owner.playerId,
                  targetId: target.playerId,
                  fighterId: owner.fighterId,
                  x: target.x,
                  y: target.y + 1.15,
                  z: target.z,
                  originX: owner.x,
                  originY: owner.y + 1.05,
                  originZ: owner.z,
                  colorHex: 0xfacc15,
                });
              }
              if (
                p.kind === 'crescent' &&
                !room.zones.some((z) => z.ownerId === owner.playerId && z.kind === 'voidAnchor' && z.remaining > 2.6)
              ) {
                this.spawnZone(room, owner, 'voidAnchor', target.x, target.y, target.z, 3.4, 2.5, 0xa855f7);
              }
              if (
                p.kind !== 'crescent' &&
                p.kind !== 'magnum' &&
                p.kind !== 'jmBeam' &&
                p.kind !== 'windBlade' &&
                p.kind !== 'solarRailgun' &&
                p.kind !== 'tornadoVortex'
              ) {
                consumed = true;
                break;
              }
            }
          }
        }

        if (!consumed && p.age < p.maxAge && Math.hypot(p.x, p.z) <= arenaRadius + 3) {
          nextProj.push(p);
        } else if (
          !consumed &&
          p.kind === 'crescent' &&
          owner &&
          !room.zones.some((z) => z.ownerId === owner.playerId && z.kind === 'voidAnchor' && z.remaining > 2.6)
        ) {
          this.spawnZone(room, owner, 'voidAnchor', p.x, Math.max(0, relY - 0.8), p.z, 3.4, 2.5, 0xa855f7);
        } else if (!consumed && p.kind === 'tornadoVortex' && owner) {
          this.pushEvent(room, {
            kind: 'shockwave',
            attackerId: owner.playerId,
            fighterId: 'marjohn',
            x: p.x,
            y: 0.35,
            z: p.z,
            radius: AWAKENING_CONFIG.MARJOHN_CAT5_RADIUS,
            colorHex: p.colorHex,
            abilitySlot: 6,
            hitStopMs: 85,
            callout: 'CAT-5 DETONATION!',
          });
          for (const target of room.actors) {
            if (target.playerId === owner.playerId || target.isKO) continue;
            const d = Math.hypot(target.x - p.x, target.z - p.z);
            if (d <= AWAKENING_CONFIG.MARJOHN_CAT5_RADIUS) {
              const calc = this.computeDynamicDamage(owner, target, p.damage * 0.65, 6);
              if (this.applyHit(room, owner, target, calc.dmg, 36, p.knockback, d > 0.05 ? (target.x - p.x) / d : 0, d > 0.05 ? (target.z - p.z) / d : 1, p.colorHex, true, false, true, true, calc.isBackstab)) {
                target.yVel = Math.max(target.yVel, 10.5);
                target.grounded = false;
              }
            }
          }
        } else if (!consumed && p.age >= p.maxAge && p.kind === 'lasso' && p.hitIds.size === 0) {
          this.pushEvent(room, {
            kind: 'whiff',
            targetId: p.ownerId,
            fighterId: 'damen',
            x: p.x,
            y: Math.max(0.5, relY),
            z: p.z,
            colorHex: 0xf59e0b,
            whiffSlot: 3,
            abilitySlot: 3,
          });
        }
      }
      room.projectiles = nextProj;

      // Update Telegraphs
      const nextTelegraphs: InternalTelegraph[] = [];
      for (const tel of room.telegraphs) {
        const owner = room.actors.find((a) => a.playerId === tel.ownerId);
        if (!owner || owner.isKO || owner.actionState === 'stagger' || owner.actionState === 'clash') continue;
        tel.elapsed += dt;
        tel.progress = clamp(tel.elapsed / Math.max(0.05, tel.windup), 0, 1);
        if (tel.elapsed <= tel.windup + 0.14) {
          nextTelegraphs.push(tel);
        }
      }
      room.telegraphs = nextTelegraphs;

      // Update Tactical Zoning Traps & Wards
      const nextZones: InternalZone[] = [];
      for (const z of room.zones) {
        z.remaining -= dt;
        if (z.remaining <= 0) continue;
        const owner = room.actors.find((a) => a.playerId === z.ownerId);
        if (!owner) continue;

        z.tickTimer += dt;
        let removeZone = false;

        if (z.kind === 'galeSnare') {
          for (const target of room.actors) {
            if (target.playerId === z.ownerId || target.isKO) continue;
            const dx = z.x - target.x;
            const dz = z.z - target.z;
            const d = Math.hypot(dx, dz);
            if (d <= z.radius && d > 0.2) {
              target.vx += (dx / d) * 14.0 * dt;
              target.vz += (dz / d) * 14.0 * dt;
            }
          }
        } else if (z.kind === 'moltenFissure') {
          if (z.tickTimer >= 0.55) {
            z.tickTimer = 0;
            for (const target of room.actors) {
              if (target.playerId === z.ownerId || target.isKO) continue;
              if (Math.hypot(target.x - z.x, target.z - z.z) <= z.radius && Math.abs(target.y - z.y) <= 2.2) {
                this.applyHit(room, owner, target, 4, 8, 1.5, 0, 0, 0xf97316, false);
              }
            }
          }
        } else if (z.kind === 'solarTripwire' && !z.triggered) {
          const ex = z.endX ?? z.x;
          const ez = z.endZ ?? z.z;
          const abx = ex - z.x;
          const abz = ez - z.z;
          const abLenSq = Math.max(0.001, abx * abx + abz * abz);
          for (const target of room.actors) {
            if (target.playerId === z.ownerId || target.isKO || target.iframeTimer > 0) continue;
            if (Math.abs(target.y - z.y) > 1.8) continue;
            const tProj = clamp(((target.x - z.x) * abx + (target.z - z.z) * abz) / abLenSq, 0, 1);
            const closestX = z.x + tProj * abx;
            const closestZ = z.z + tProj * abz;
            if (Math.hypot(target.x - closestX, target.z - closestZ) <= 1.25) {
              z.triggered = true;
              removeZone = true;
              this.pushEvent(room, {
                kind: 'trapTrigger',
                attackerId: owner.playerId,
                targetId: target.playerId,
                fighterId: 'damen',
                x: target.x,
                y: target.y + 0.9,
                z: target.z,
                colorHex: 0xfacc15,
                hitStopMs: 55,
                callout: 'TRIPWIRE SNARE!',
              });
              const dx = owner.x - target.x;
              const dz = owner.z - target.z;
              const d = Math.max(0.01, Math.hypot(dx, dz));
              this.applyHit(room, owner, target, 22, 46, 8.8, dx / d, dz / d, 0xfacc15, true, true, false, true);
              break;
            }
          }
        } else if (z.kind === 'voidAnchor') {
          if (z.tickTimer >= 0.45) {
            z.tickTimer = 0;
            for (const target of room.actors) {
              if (target.playerId === z.ownerId || target.isKO) continue;
              if (Math.hypot(target.x - z.x, target.z - z.z) <= z.radius && Math.abs(target.y - z.y) <= 2.2) {
                target.stamina = Math.max(0, target.stamina - 7);
                target.vx *= 0.65;
                target.vz *= 0.65;
              }
            }
          }
        } else if (z.kind === 'voidDecoy' && !z.triggered) {
          for (const target of room.actors) {
            if (target.playerId === z.ownerId || target.isKO || target.iframeTimer > 0) continue;
            const dx = target.x - z.x;
            const dz = target.z - z.z;
            const d = Math.hypot(dx, dz);
            if (d <= z.radius && Math.abs(target.y - z.y) <= 2.0) {
              z.triggered = true;
              removeZone = true;
              this.pushEvent(room, {
                kind: 'trapTrigger',
                attackerId: owner.playerId,
                targetId: target.playerId,
                fighterId: 'khen',
                x: z.x,
                y: z.y + 0.9,
                z: z.z,
                colorHex: 0xa855f7,
                hitStopMs: 55,
                callout: 'DECOY COUNTER!',
              });
              const nx = d > 0.05 ? dx / d : 0;
              const nz = d > 0.05 ? dz / d : 1;
              this.applyHit(room, owner, target, 14, 28, 9.0, nx, nz, 0xa855f7, true, false, false, true);
              break;
            }
          }
        } else if (z.kind === 'solarSanctuary') {
          if (Math.hypot(owner.x - z.x, owner.z - z.z) <= z.radius && !owner.isKO) {
            owner.hp = Math.min(owner.maxHp, owner.hp + 4.5 * dt);
            owner.mana = Math.min(owner.maxMana, owner.mana + 5.0 * dt);
          }
          if (z.tickTimer >= 0.45) {
            z.tickTimer = 0;
            for (const target of room.actors) {
              if (target.playerId === z.ownerId || target.isKO) continue;
              const dx = target.x - z.x;
              const dz = target.z - z.z;
              const d = Math.hypot(dx, dz);
              if (d <= z.radius && Math.abs(target.y - z.y) <= 2.2) {
                const nx = d > 0.05 ? dx / d : 0;
                const nz = d > 0.05 ? dz / d : 1;
                target.vx += nx * 7.5;
                target.vz += nz * 7.5;
                this.applyHit(room, owner, target, 4, 12, 3.5, nx, nz, 0xfacc15, false);
              }
            }
          }
        } else {
          tickAwakenedZoneBehavior(room, z, owner, dt, this.getAwakeningHelpers());
        }

        if (!removeZone) {
          nextZones.push(z);
        }
      }
      room.zones = nextZones;

      if (room.isTrainingMode) {
        // Infinite training until player clicks Leave
      } else if (room.isSoloPractice) {
        const humanActor = room.actors.find((a) => !a.isBot);
        if (humanActor && humanActor.isKO) {
          room.victoryDelayTimer += dt;
          if (room.victoryDelayTimer >= 1.35) {
            const sock = this.playerSockets.get(humanActor.playerId);
            if (sock) {
              const client = this.clients.get(sock);
              if (client) {
                client.roomCode = null;
                client.playerId = null;
              }
              this.playerSockets.delete(humanActor.playerId);
              this.send(sock, {
                type: 'room:exited',
                reason: 'You were defeated by the Bot.',
              });
            }
            this.rooms.delete(code);
            continue;
          }
        }
      } else {
        const alive = room.actors.filter((a) => !a.isKO);
        if (alive.length <= 1) {
          room.victoryDelayTimer += dt;
          if (room.victoryDelayTimer >= 1.6) {
            const roundWinnerActor = alive[0] ?? null;
            let seriesWinnerId: string | null = null;
            if (roundWinnerActor) {
              const winPlayer = room.players.find((p) => p.playerId === roundWinnerActor.playerId);
              if (winPlayer) {
                winPlayer.wins += 1;
                roundWinnerActor.wins = winPlayer.wins;
                if (winPlayer.wins >= room.winsToWin) {
                  seriesWinnerId = winPlayer.playerId;
                }
              }
            }

            if (seriesWinnerId) {
              room.phase = 'victory';
              room.roundWinnerId = seriesWinnerId;
              room.winnerId = seriesWinnerId;
              this.broadcastRoomState(room);
            } else {
              // Constantly rotate map for the next round; characters stay locked
              const curMapIdx = MAPS.findIndex((m) => m.id === room.mapId);
              const nextMap = MAPS[(curMapIdx + 1) % MAPS.length];
              room.mapId = nextMap.id;
              room.roundNumber += 1;
              room.roundWinnerId = roundWinnerActor?.playerId ?? null;
              room.phase = 'roundEnd';
              room.countdown = 2.0;
              room.victoryDelayTimer = 0;
              this.broadcastRoomState(room);
            }
          }
        }
      }

      this.broadcastSnapshot(room);
      room.pendingEvents = [];
    }
  }

  private getAwakeningHelpers(): AwakeningHostHelpers {
    return {
      makeId,
      pushEvent: (room, ev) => this.pushEvent(room as RoomInstance, ev),
      spawnZone: (room, owner, kind, x, y, z, radius, duration, colorHex, endX, endZ) =>
        this.spawnZone(room as RoomInstance, owner as InternalActor, kind, x, y, z, radius, duration, colorHex, endX, endZ),
      spawnTelegraph: (room, actor, kind, x, y, z, dirX, dirZ, radius, length, angleHalf, windup, colorHex) =>
        this.spawnTelegraph(room as RoomInstance, actor as InternalActor, kind, x, y, z, dirX, dirZ, radius, length, angleHalf, windup, colorHex),
      clearActorTelegraph: (room, actor) => this.clearActorTelegraph(room as RoomInstance, actor as InternalActor),
      findNearestTarget: (room, actor, maxRange) =>
        this.findNearestTarget(room as RoomInstance, actor as InternalActor, maxRange),
      findPreferredTarget: (room, actor, maxRange) =>
        this.findPreferredTarget(room as RoomInstance, actor as InternalActor, maxRange),
      clampAimPoint: (room, actor, rawX, rawZ, maxRange) =>
        this.clampAimPoint(room as RoomInstance, actor as InternalActor, rawX, rawZ, maxRange),
      computeDynamicDamage: (actor, target, baseDamage, slot) =>
        this.computeDynamicDamage(actor as InternalActor, target as InternalActor, baseDamage, slot),
      applyHit: (room, attacker, target, damage, staggerDamage, knockback, dirX, dirZ, colorHex, isHeavy, isPull, isUltimate, isCrit, isBackstab) =>
        this.applyHit(room as RoomInstance, attacker as InternalActor, target as InternalActor, damage, staggerDamage, knockback, dirX, dirZ, colorHex, isHeavy, isPull, isUltimate, isCrit, isBackstab),
      damageObstacle: (room, obs, dmg, hitX, hitY, hitZ, colorHex) =>
        this.damageObstacle(room as RoomInstance, obs, dmg, hitX, hitY, hitZ, colorHex),
      damageObstaclesInArea: (room, x, z, radius, dmg, colorHex) =>
        this.damageObstaclesInArea(room as RoomInstance, x, z, radius, dmg, colorHex),
      eliminateActor: (room, attacker, target, cause) =>
        this.eliminateActor(room as RoomInstance, attacker as InternalActor | null, target as InternalActor, cause),
    };
  }

  private buildSnapshot(room: RoomInstance): ArenaSnapshot {
    return {
      serverTime: Date.now(),
      matchTime: Number(room.matchTime.toFixed(2)),
      lastInputSeq: { ...room.lastInputSeq },
      battleEvent: room.battleEvent
        ? {
            id: room.battleEvent.id,
            kind: room.battleEvent.kind,
            title: room.battleEvent.title,
            subtitle: room.battleEvent.subtitle,
            x: room.battleEvent.x,
            z: room.battleEvent.z,
            radius: room.battleEvent.radius,
            remaining: Number(room.battleEvent.remaining.toFixed(1)),
            telegraphRemaining: Number(room.battleEvent.telegraphRemaining.toFixed(1)),
            colorHex: room.battleEvent.colorHex,
          }
        : null,
      activeClash: room.activeClash ? { ...room.activeClash } : null,
      activeHeadlock: room.activeHeadlock
        ? {
            ...room.activeHeadlock,
            remaining: Number(Math.max(0, room.activeHeadlock.remaining).toFixed(2)),
          }
        : null,
      stormActive: room.stormActive,
      stormRadius: Number(room.stormRadius.toFixed(2)),
      stormMaxRadius: Number(room.stormMaxRadius.toFixed(2)),
      awakeningPhase: room.awakeningPhase,
      awakeningOrbs: room.awakeningOrbs.map((o) => ({
        id: o.id,
        x: Number(o.x.toFixed(2)),
        y: Number(o.y.toFixed(2)),
        z: Number(o.z.toFixed(2)),
        active: o.active,
        fadeTimer: Number(o.fadeTimer.toFixed(2)),
      })),
      awakeningCutscene: room.awakeningCutscene
        ? {
            id: room.awakeningCutscene.id,
            p1Id: room.awakeningCutscene.p1Id,
            p2Id: room.awakeningCutscene.p2Id,
            p1Name: room.awakeningCutscene.p1Name,
            p2Name: room.awakeningCutscene.p2Name,
            p1FighterId: room.awakeningCutscene.p1FighterId,
            p2FighterId: room.awakeningCutscene.p2FighterId,
            clockSec: Number(room.awakeningCutscene.clockSec.toFixed(2)),
            clashBalance: room.awakeningCutscene.clashBalance,
            p1Taps: room.awakeningCutscene.p1Taps,
            p2Taps: room.awakeningCutscene.p2Taps,
            p1Overdrive: room.awakeningCutscene.p1Overdrive,
            p2Overdrive: room.awakeningCutscene.p2Overdrive,
            outcome: room.awakeningCutscene.outcome,
            fadeMusicOut: room.awakeningCutscene.fadeMusicOut,
            resolved: room.awakeningCutscene.resolved,
          }
        : null,
      awakeningBanner: room.awakeningBanner
        ? {
            id: room.awakeningBanner.id,
            text: room.awakeningBanner.text,
            subtext: room.awakeningBanner.subtext,
            colorHex: room.awakeningBanner.colorHex,
            remaining: Number(room.awakeningBanner.remaining.toFixed(2)),
          }
        : null,
      actors: room.actors.map((a) => ({
        playerId: a.playerId,
        slotIndex: a.slotIndex,
        name: a.name,
        fighterId: a.fighterId,
        skinId: a.skinId,
        isBot: a.isBot,
        isDummy: a.isDummy,
        x: Number(a.x.toFixed(3)),
        y: Number(a.y.toFixed(3)),
        z: Number(a.z.toFixed(3)),
        vx: Number(a.vx.toFixed(2)),
        yVel: Number(a.yVel.toFixed(2)),
        vz: Number(a.vz.toFixed(2)),
        grounded: a.grounded,
        rotY: Number(a.rotY.toFixed(3)),
        hp: Math.round(a.hp),
        maxHp: a.maxHp,
        mana: Math.round(a.mana),
        maxMana: a.maxMana,
        stamina: Math.round(a.stamina),
        maxStamina: a.maxStamina,
        stagger: Math.round(a.stagger),
        isStunned: a.isStunned,
        isOverdrive: a.isOverdrive,
        frenzyInside: a.frenzyInside,
        passiveStacks: a.passiveStacks,
        counterFlowActive: a.counterFlowActive,
        stage2Slot: a.stage2Slot,
        stage2Timer: Number(a.stage2Timer.toFixed(2)),
        stage2Label: a.stage2Label,
        rushFatigue: a.rushFatigue,
        empoweredM1Ready: a.empoweredM1Ready,
        perfectEvadeTimer: Number(a.perfectEvadeTimer.toFixed(2)),
        comboCount: a.comboCount,
        comboResetRemaining:
          a.comboCount > 0 ? Number(Math.max(0, 2.0 - (room.matchTime - a.lastHitAt)).toFixed(2)) : 0,
        comboStep: a.comboStep,
        m1Variant: a.m1Variant,
        grabCooldown: Number(a.grabCooldown.toFixed(2)),
        damagePhase: a.damagePhase,
        actionState: a.actionState,
        abilitySlot: a.abilitySlot,
        actionTimer: Number(a.actionTimer.toFixed(2)),
        actionDuration: a.actionDuration,
        whiffTimer: Number(a.whiffTimer.toFixed(2)),
        cooldowns: [
          Number(a.cooldowns[0].toFixed(2)),
          Number(a.cooldowns[1].toFixed(2)),
          Number(a.cooldowns[2].toFixed(2)),
          Number(a.cooldowns[3].toFixed(2)),
          Number(a.cooldowns[4].toFixed(2)),
          Number(a.cooldowns[5].toFixed(2)),
          Number(a.cooldowns[6].toFixed(2)),
        ],
        dashCooldown: Number(a.dashCooldown.toFixed(2)),
        dashMaxCooldown: a.dashMaxCooldown,
        dashCharges: a.dashCharges,
        dashMaxCharges: a.dashMaxCharges,
        dashRechargeRemaining: Number(a.dashRechargeRemaining.toFixed(2)),
        isFlying: a.isFlying,
        flightRemaining: Number(a.flightRemaining.toFixed(2)),
        flightMax: a.flightMax,
        flightCooldown: Number(a.flightCooldown.toFixed(2)),
        speedBoostTimer: Number(a.speedBoostTimer.toFixed(2)),
        superArmor: a.superArmor,
        shieldActive: a.shieldActive,
        parryWindow: a.parryWindow,
        blockHeld: a.blockHeld,
        awakened: a.awakened,
        awakeningTransformTimer: Number(a.awakeningTransformTimer.toFixed(2)),
        silencedTimer: Number(a.silencedTimer.toFixed(2)),
        snareMarkedTimer: Number(a.snareMarkedTimer.toFixed(2)),
        isKO: a.isKO,
        koTime: a.koTime,
        koStyle: a.koStyle,
        koCause: a.koCause,
        koByFighterId: a.koByFighterId,
        wins: a.wins,
        kills: a.kills,
        parryCount: a.parryCount,
        damageDealt: a.damageDealt,
      })),
      projectiles: room.projectiles.map((p) => ({
        id: p.id,
        ownerId: p.ownerId,
        fighterId: p.fighterId,
        kind: p.kind,
        x: Number(p.x.toFixed(2)),
        y: Number(p.y.toFixed(2)),
        z: Number(p.z.toFixed(2)),
        vx: p.vx,
        vy: p.vy,
        vz: p.vz,
        rotY: p.rotY,
        colorHex: p.colorHex,
        originX: p.originX,
        originY: p.originY,
        originZ: p.originZ,
        targetX: p.targetX,
        targetY: p.targetY,
        targetZ: p.targetZ,
        isComboLink: p.isComboLink,
        isOverdrive: p.isOverdrive,
      })),
      zones: room.zones.map((z) => ({
        id: z.id,
        ownerId: z.ownerId,
        fighterId: z.fighterId,
        kind: z.kind,
        x: Number(z.x.toFixed(2)),
        y: Number(z.y.toFixed(2)),
        z: Number(z.z.toFixed(2)),
        endX: z.endX !== undefined ? Number(z.endX.toFixed(2)) : undefined,
        endZ: z.endZ !== undefined ? Number(z.endZ.toFixed(2)) : undefined,
        radius: z.radius,
        remaining: Number(z.remaining.toFixed(2)),
        maxDuration: z.maxDuration,
        colorHex: z.colorHex,
        triggered: z.triggered,
      })),
      telegraphs: room.telegraphs.map((t) => ({
        id: t.id,
        ownerId: t.ownerId,
        fighterId: t.fighterId,
        kind: t.kind,
        x: Number(t.x.toFixed(2)),
        y: Number(t.y.toFixed(2)),
        z: Number(t.z.toFixed(2)),
        dirX: Number(t.dirX.toFixed(3)),
        dirZ: Number(t.dirZ.toFixed(3)),
        radius: t.radius,
        length: t.length,
        angleHalf: t.angleHalf,
        progress: Number(t.progress.toFixed(2)),
        colorHex: t.colorHex,
      })),
      pickups: room.pickups.map((pk) => ({
        id: pk.id,
        kind: pk.kind,
        x: pk.x,
        y: pk.y,
        z: pk.z,
        active: pk.active,
      })),
      obstacles: room.obstacles.map((obs) => ({ ...obs })),
    };
  }

  private broadcastSnapshot(room: RoomInstance): void {
    const snapshot = this.buildSnapshot(room);
    const events = room.pendingEvents;
    for (const p of room.players) {
      const sock = this.playerSockets.get(p.playerId);
      if (sock) {
        this.send(sock, { type: 'game:snapshot', snapshot, events });
      }
    }
  }
}

function attackerAddDamage(attacker: InternalActor, dmg: number): void {
  attacker.damageDealt += dmg;
}
