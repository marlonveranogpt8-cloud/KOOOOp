import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  AbilitySlot,
  ArenaSnapshot,
  ClientMessage,
  CombatEvent,
  CombatMoveType,
  FighterId,
  MapId,
  RoomChatMessage,
  RoomState,
  ServerMessage,
  SkinId,
  TrainingConfig,
  AwakeningDebugAction,
} from './shared/gameData.ts';
import { AWAKENING_CONFIG } from './shared/awakeningConfig.ts';
import { CutsceneDirector } from './game/awakeningLogic.ts';
import { LobbyLanding } from './components/LobbyLanding.tsx';
import { TekkenPickScreen } from './components/TekkenPickScreen.tsx';
import {
  ArenaViewport,
  DamagePopup,
  HitFlashInfo,
  LocalControlState,
  OrbScreenIndicator,
  ScreenTintInfo,
  ScreenTintKind,
} from './components/ArenaViewport.tsx';
import { MobileCombatHUD } from './components/MobileCombatHUD.tsx';
import { CutsceneOverlay } from './components/CutsceneOverlay.tsx';
import { AwakeningDebugPanel } from './components/AwakeningDebugPanel.tsx';
import { AdminMonitorModal } from './components/AdminMonitorModal.tsx';
import { FirebaseSetupModal } from './components/FirebaseSetupModal.tsx';
import { ScreenTransition } from './components/ScreenTransition.tsx';
import { janeCutsceneAudio, soundEngine } from './game/soundEngine.ts';
import { canEnterArena } from './game/userLogic.ts';
import type { AimPreviewState } from './game/vfxManager.ts';
import {
  AccountStoreState,
  CoinRewardBreakdown,
  calculateMatchCoinReward,
  getActiveAccount,
  loadAccountStore,
  loginOrCreateAccount,
  logoutAccount,
  recordMatchReward,
} from './game/accountStore.ts';
import { auth, isFirebaseConfigPlaceholder } from './firebase.ts';
import {
  CloudUserProfile,
  commitMatchResultToCloud,
  isAdminEmail,
  signInWithGoogleCloud,
  signOutCloudUser,
  subscribeOwnCloudUser,
  syncCloudPresence,
  upsertCloudUserOnLogin,
} from './game/firebaseUsers.ts';

const SCREEN_TINT_STYLES: Record<ScreenTintKind, string> = {
  'high-noon-amber': 'radial-gradient(circle at 50% 42%, rgba(251, 191, 36, 0.26), rgba(180, 83, 9, 0.34) 75%)',
  'avalanche-red': 'radial-gradient(circle at 50% 48%, rgba(244, 63, 94, 0.22), rgba(127, 29, 29, 0.42) 78%)',
  'eclipse-vignette': 'radial-gradient(circle at 50% 50%, transparent 28%, rgba(15, 23, 42, 0.62) 86%)',
  'phantom-desat': 'radial-gradient(circle at 50% 50%, rgba(168, 85, 247, 0.16), rgba(15, 23, 42, 0.56) 82%)',
  'solar-white-gold': 'radial-gradient(circle at 50% 35%, rgba(254, 249, 195, 0.42), rgba(245, 158, 11, 0.24) 76%)',
};

export default function App() {
  const [viewMode, setViewMode] = useState<'game' | 'cinema'>('game');
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [playerId, setPlayerId] = useState<string>('');
  const [snapshot, setSnapshot] = useState<ArenaSnapshot | null>(null);
  const [pendingEvents, setPendingEvents] = useState<CombatEvent[]>([]);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [lockOnEnabled, setLockOnEnabled] = useState<boolean>(true);
  const [cancelAimTriggerSeq, setCancelAimTriggerSeq] = useState<number>(0);
  const [damagePopups, setDamagePopups] = useState<DamagePopup[]>([]);
  const [hitFlash, setHitFlash] = useState<HitFlashInfo | null>(null);
  const [screenTint, setScreenTint] = useState<ScreenTintInfo | null>(null);
  const [orbIndicators, setOrbIndicators] = useState<OrbScreenIndicator[]>([]);
  const [selectedSkin, setSelectedSkin] = useState<SkinId>('ascended');
  const [debugOpen, setDebugOpen] = useState<boolean>(
    () => new URLSearchParams(window.location.search).get('debug') === '1'
  );

  // Cutscene master clock & Jane audio timeline refs
  const cutsceneIdRef = useRef<string | null>(null);
  const cutsceneDirectorRef = useRef<CutsceneDirector | null>(null);
  const cutsceneFallbackStartRef = useRef<number | null>(null);
  const cutsceneMusicActiveRef = useRef<boolean>(false);

  // Room Chat & Screen Transition Curtain State
  const [chatMessages, setChatMessages] = useState<RoomChatMessage[]>([]);
  const [chatOpen, setChatOpen] = useState<boolean>(false);
  const [unreadChatCount, setUnreadChatCount] = useState<number>(0);
  const chatOpenRef = useRef<boolean>(false);
  chatOpenRef.current = chatOpen;
  const [screenTrans, setScreenTrans] = useState<{
    key: number;
    label: string;
    sublabel?: string;
    accentHex?: string;
  }>({ key: 0, label: 'KOOPAL CLASH' });

  // Firebase Auth + Firestore Cloud Profile State
  const isPlaceholderConfig = isFirebaseConfigPlaceholder();
  const [cloudUser, setCloudUser] = useState<CloudUserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showAdminMonitor, setShowAdminMonitor] = useState<boolean>(false);
  const [showFirebaseGuide, setShowFirebaseGuide] = useState<boolean>(false);

  // Local test fallback account (only used when FIREBASE_CONFIG has placeholder values)
  const [accountStore, setAccountStore] = useState<AccountStoreState>(() => loadAccountStore());
  const [lastCoinReward, setLastCoinReward] = useState<CoinRewardBreakdown | null>(null);
  const activeAccount = getActiveAccount(accountStore);
  const isAdmin = Boolean(cloudUser && isAdminEmail(cloudUser.email));
  const rewardedMatchKeyRef = useRef<string | null>(null);
  const prevViewStateRef = useRef<string>('title');

  const wsRef = useRef<WebSocket | null>(null);
  const cameraYawRef = useRef<number>(Math.PI);
  const aimPitchRef = useRef<number>(-0.45);
  const targetIdRef = useRef<string | null>(null);
  targetIdRef.current = targetId;
  const selectedSkinRef = useRef<SkinId>('ascended');
  selectedSkinRef.current = selectedSkin;

  // Latency compensation clock-sync & local prediction refs
  const clockOffsetMsRef = useRef<number>(0);
  const jitterMsRef = useRef<number>(15);
  const rttSamplesRef = useRef<number[]>([]);
  const inputSeqRef = useRef<number>(0);
  const localControlRef = useRef<LocalControlState>({
    moveX: 0,
    moveZ: 0,
    blockHeld: false,
    jumpTriggerSeq: 0,
  });
  const aimPreviewRef = useRef<AimPreviewState>({
    active: false,
    cancelled: false,
    aimKind: 'none',
    originX: 0,
    originZ: 0,
    aimX: 0,
    aimZ: 0,
    radius: 3,
    range: 8,
    colorHex: 0x38bdf8,
  });

  const urlParams = new URLSearchParams(window.location.search);
  const initialRoomCode = (urlParams.get('room') || '').toUpperCase().slice(0, 4);
  const autostartRequested = urlParams.get('autostart') === '1';
  const savedName = sessionStorage.getItem('sc3d_name') || 'Player';
  const autostartPhaseRef = useRef<'idle' | 'created' | 'done'>('idle');

  const triggerScreenTransition = useCallback(
    (label: string, sublabel?: string, accentHex = '#f59e0b') => {
      setScreenTrans((prev) => ({
        key: prev.key + 1,
        label,
        sublabel,
        accentHex,
      }));
    },
    []
  );

  const sendMsg = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  // Firebase Auth listener + live Firestore subscription for signed-in player
  useEffect(() => {
    if (!auth || isPlaceholderConfig) return;
    let unsubProfile: (() => void) | null = null;
    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }
      if (!user) {
        setCloudUser(null);
        return;
      }
      try {
        const profile = await upsertCloudUserOnLogin(user);
        setCloudUser(profile);
        sessionStorage.setItem('sc3d_name', profile.displayName.slice(0, 14));
        unsubProfile = subscribeOwnCloudUser(user.uid, (nextProfile) => {
          setCloudUser(nextProfile);
        });
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Unable to sync profile with Firestore.');
      }
    });
    return () => {
      if (unsubProfile) unsubProfile();
      unsubAuth();
    };
  }, [isPlaceholderConfig]);

  // Sync live online / in-match status to Firestore
  useEffect(() => {
    if (!cloudUser) return;
    const inMatch = Boolean(room && room.phase !== 'lobby' && room.phase !== 'victory');
    const nextStatus = inMatch ? 'in-match' : 'online';
    const myRoomPlayer = room?.players.find((p) => p.playerId === playerId);
    if (cloudUser.onlineStatus !== nextStatus || (myRoomPlayer && cloudUser.favoriteFighter !== myRoomPlayer.fighterId)) {
      void syncCloudPresence(cloudUser.uid, nextStatus, myRoomPlayer?.fighterId).catch(() => {});
    }
  }, [cloudUser?.uid, cloudUser?.onlineStatus, room?.phase, room?.players, playerId]);

  // Mark offline cleanly on page unload if signed in
  useEffect(() => {
    const uid = cloudUser?.uid;
    if (!uid) return;
    const onUnload = () => {
      void syncCloudPresence(uid, 'offline').catch(() => {});
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [cloudUser?.uid]);

  useEffect(() => {
    let closedByUnmount = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    const sendPing = (ws: WebSocket) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'net:ping', clientSendTime: Date.now() } satisfies ClientMessage));
      }
    };

    const connect = () => {
      setConnectionStatus('connecting');
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnectionStatus('connected');
        setErrorMessage(null);

        sendPing(ws);
        setTimeout(() => sendPing(ws), 220);
        setTimeout(() => sendPing(ws), 500);
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = setInterval(() => sendPing(ws), 2000);

        const savedRoom = sessionStorage.getItem('sc3d_room');
        const savedToken = sessionStorage.getItem('sc3d_token');
        const name = sessionStorage.getItem('sc3d_name') || 'Player';
        if (savedRoom && savedToken) {
          ws.send(
            JSON.stringify({
              type: 'room:join',
              roomCode: savedRoom,
              playerName: name,
              reconnectToken: savedToken,
            } satisfies ClientMessage)
          );
        }
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as ServerMessage;
          if (msg.type === 'net:pong') {
            const clientRecvTime = Date.now();
            const rtt = Math.max(1, clientRecvTime - msg.clientSendTime);
            const sampleOffset = msg.serverTime - (msg.clientSendTime + rtt * 0.5);

            const samples = rttSamplesRef.current;
            samples.push(rtt);
            if (samples.length > 8) samples.shift();
            const minRtt = Math.min(...samples);
            const maxRtt = Math.max(...samples);
            jitterMsRef.current = jitterMsRef.current * 0.7 + (maxRtt - minRtt) * 0.3;

            if (clockOffsetMsRef.current === 0 || rtt <= minRtt * 1.35) {
              clockOffsetMsRef.current =
                clockOffsetMsRef.current === 0
                  ? sampleOffset
                  : clockOffsetMsRef.current * 0.75 + sampleOffset * 0.25;
            }
            setPingMs(Math.round(rtt));
            return;
          }

          if (msg.type === 'room:joined') {
            setPlayerId(msg.playerId);
            setRoom(msg.room);
            setChatMessages(msg.chatHistory ?? []);
            setUnreadChatCount(0);
            setErrorMessage(null);
            sessionStorage.setItem('sc3d_room', msg.room.roomCode);
            sessionStorage.setItem('sc3d_token', msg.reconnectToken);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: 'room:selectSkin',
                  skinId: selectedSkinRef.current,
                } satisfies ClientMessage)
              );
            }
          } else if (msg.type === 'room:state') {
            setRoom(msg.room);
            if (msg.room.phase === 'victory') {
              soundEngine.play('victory');
            }
            if (msg.room.phase === 'lobby' || msg.room.phase === 'roundEnd' || msg.room.phase === 'countdown') {
              if (msg.room.phase === 'lobby') {
                setSnapshot(null);
                setTargetId(null);
              }
              setDamagePopups([]);
              setHitFlash(null);
            }
          } else if (msg.type === 'room:chat') {
            setChatMessages((prev) => [...prev.slice(-59), msg.message]);
            if (!chatOpenRef.current) {
              setUnreadChatCount((c) => c + 1);
            }
            if (msg.message.senderId !== playerId) {
              soundEngine.play('chatPop');
            }
          } else if (msg.type === 'room:exited') {
            sessionStorage.removeItem('sc3d_room');
            sessionStorage.removeItem('sc3d_token');
            setRoom(null);
            setSnapshot(null);
            setChatMessages([]);
            setChatOpen(false);
            setUnreadChatCount(0);
            setTargetId(null);
            setDamagePopups([]);
            setHitFlash(null);
            setPendingEvents([]);
            setErrorMessage(msg.reason || 'Returned to Lobby.');
          } else if (msg.type === 'room:error') {
            soundEngine.play('lockedError');
            setErrorMessage(msg.message);
            if (msg.message.includes('not found')) {
              sessionStorage.removeItem('sc3d_room');
              sessionStorage.removeItem('sc3d_token');
            }
          } else if (msg.type === 'game:snapshot') {
            setSnapshot(msg.snapshot);
            if (msg.events.length > 0) {
              setPendingEvents((prev) => [...prev, ...msg.events]);
            }
          }
        } catch {
          // ignore malformed packet
        }
      };

      ws.onclose = () => {
        setConnectionStatus('disconnected');
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        if (!closedByUnmount) {
          reconnectTimer = setTimeout(connect, 1500);
        }
      };
    };

    connect();
    return () => {
      closedByUnmount = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      wsRef.current?.close();
    };
  }, []);

  // Expose live game-phase state attribute & trigger polished transition curtains
  useEffect(() => {
    const state =
      viewMode === 'cinema'
        ? 'cinema'
        : !room
        ? 'title'
        : room.phase === 'lobby'
        ? 'lobby'
        : room.phase === 'victory'
        ? 'gameover'
        : 'playing';
    document.body.dataset.state = state;

    const prev = prevViewStateRef.current;
    if (prev !== state) {
      prevViewStateRef.current = state;
      if (state === 'lobby') {
        soundEngine.play('transitionWhoosh');
        triggerScreenTransition('CHALLENGER SELECT', 'SQUAD ROOM READY', '#0ea5e9');
      } else if (state === 'playing' && (prev === 'lobby' || prev === 'title')) {
        soundEngine.play('transitionWhoosh');
        triggerScreenTransition('ENTERING ARENA', 'GET READY FOR BATTLE', '#f59e0b');
      } else if (state === 'title' && prev !== 'title') {
        soundEngine.play('transitionWhoosh');
        triggerScreenTransition('MAIN LOBBY', 'KOOPAL CLASH', '#64748b');
      } else if (state === 'cinema') {
        soundEngine.play('transitionWhoosh');
        triggerScreenTransition('CINEMA CUT', '120S SHOWCASE', '#f59e0b');
      }
    }
  }, [room, viewMode, triggerScreenTransition]);

  // Debug panel toggle (` or F9)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.code === 'Backquote' || e.code === 'F9') {
        e.preventDefault();
        setDebugOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Cutscene Master Clock (audio.currentTime -> CutsceneDirector -> game:cutsceneSync) + Music Fade Lifecycle
  useEffect(() => {
    const inCombat = room?.phase === 'combat';
    const cs = inCombat ? snapshot?.awakeningCutscene ?? null : null;
    const isCutscene = Boolean(inCombat && snapshot?.awakeningPhase === 'CUTSCENE' && cs);

    if (!inCombat) {
      if (cutsceneMusicActiveRef.current) {
        cutsceneMusicActiveRef.current = false;
        janeCutsceneAudio.rampFadeOut(0.45);
      }
      cutsceneIdRef.current = null;
      cutsceneDirectorRef.current = null;
      cutsceneFallbackStartRef.current = null;
      soundEngine.setDucking(false);
      setOrbIndicators([]);
      return;
    }

    if (snapshot?.awakeningPhase !== 'ORBS_ACTIVE' && orbIndicators.length > 0) {
      setOrbIndicators([]);
    }

    if (isCutscene && cs) {
      soundEngine.setDucking(true);
      if (cutsceneIdRef.current !== cs.id) {
        cutsceneIdRef.current = cs.id;
        cutsceneFallbackStartRef.current = performance.now();
        cutsceneMusicActiveRef.current = true;
        cutsceneDirectorRef.current = new CutsceneDirector([
          {
            id: 'panel_1',
            time: AWAKENING_CONFIG.TIMELINE.PANEL_1_AT,
            action: () => soundEngine.play('heavy'),
          },
          {
            id: 'panel_2',
            time: AWAKENING_CONFIG.TIMELINE.PANEL_2_AT,
            action: () => soundEngine.play('heavy'),
          },
          {
            id: 'clash_start',
            time: AWAKENING_CONFIG.TIMELINE.CLASH_START_AT,
            action: () => soundEngine.play('clashBoom'),
          },
          {
            id: 'music_fade',
            time: AWAKENING_CONFIG.TIMELINE.MUSIC_FADE_START,
            action: () => {
              janeCutsceneAudio.rampFadeOut(
                Math.max(
                  0.5,
                  AWAKENING_CONFIG.TIMELINE.MUSIC_FADE_END - AWAKENING_CONFIG.TIMELINE.MUSIC_FADE_START
                )
              );
              cutsceneMusicActiveRef.current = false;
            },
          },
        ]);
        void janeCutsceneAudio.start();
      }
    } else {
      soundEngine.setDucking(false);
      // If cutscene was interrupted or skipped, fade music immediately
      if (
        cutsceneIdRef.current &&
        pendingEvents.some(
          (ev) => ev.kind === 'awakeningClashEnd' && ev.callout === 'CLASH INTERRUPTED'
        )
      ) {
        cutsceneIdRef.current = null;
        cutsceneMusicActiveRef.current = false;
        janeCutsceneAudio.rampFadeOut(0.45);
      }
    }
  }, [room?.phase, snapshot?.awakeningPhase, snapshot?.awakeningCutscene, pendingEvents, orbIndicators.length]);

  useEffect(() => {
    const interval = setInterval(() => {
      const director = cutsceneDirectorRef.current;
      if (!director && !cutsceneMusicActiveRef.current) return;

      const audioTime = janeCutsceneAudio.getCurrentTime();
      const clock =
        audioTime !== null
          ? audioTime
          : cutsceneFallbackStartRef.current !== null
          ? (performance.now() - cutsceneFallbackStartRef.current) / 1000
          : 0;

      if (director) {
        director.update(clock);
      }

      if (room?.phase === 'combat' && snapshot?.awakeningPhase === 'CUTSCENE' && snapshot.awakeningCutscene) {
        sendMsg({
          type: 'game:cutsceneSync',
          clockSec: Number(clock.toFixed(3)),
        });
      }

      if (clock >= AWAKENING_CONFIG.TIMELINE.MUSIC_FADE_END + 0.6 && cutsceneMusicActiveRef.current) {
        cutsceneMusicActiveRef.current = false;
        janeCutsceneAudio.stop();
        cutsceneDirectorRef.current = null;
      }
    }, 65);
    return () => clearInterval(interval);
  }, [room?.phase, snapshot?.awakeningPhase, snapshot?.awakeningCutscene, sendMsg]);

  // Award persistent match Coins & sync matchHistory cleanly once when a match ends in victory
  useEffect(() => {
    if (!room) {
      rewardedMatchKeyRef.current = null;
      setLastCoinReward(null);
      return;
    }
    if (room.phase !== 'victory') {
      rewardedMatchKeyRef.current = null;
      setLastCoinReward(null);
      return;
    }
    const matchKey = `${room.roomCode}:${room.roundNumber}:${room.winnerId ?? 'draw'}:${snapshot?.serverTime ?? 0}`;
    if (rewardedMatchKeyRef.current) return;
    rewardedMatchKeyRef.current = matchKey;

    const myActor = snapshot?.actors.find((a) => a.playerId === playerId);
    const won = room.winnerId === playerId;
    const reward = calculateMatchCoinReward({
      won,
      kills: myActor?.kills ?? 0,
      damageDealt: myActor?.damageDealt ?? 0,
      isTrainingMode: room.isTrainingMode,
    });
    setLastCoinReward(reward);

    if (cloudUser && myActor && !room.isTrainingMode) {
      void commitMatchResultToCloud(cloudUser, {
        matchId: `${room.roomCode}-${Date.now()}`,
        mapId: room.mapId,
        fighterId: myActor.fighterId,
        won,
        kills: myActor.kills,
        damageDealt: Math.round(myActor.damageDealt),
        coinsEarned: reward.total,
        mode: room.isSoloPractice ? 'vs-bot' : 'arena',
        timestampMs: Date.now(),
      })
        .then((nextProfile) => setCloudUser(nextProfile))
        .catch(() => {});
    } else if (reward.total > 0 && activeAccount?.username) {
      setAccountStore((prev) => {
        const res = recordMatchReward(
          prev,
          activeAccount.username,
          reward,
          won,
          myActor?.kills ?? 0
        );
        return res.store;
      });
    }
  }, [room, snapshot, playerId, cloudUser, activeAccount?.username]);

  // Optional ?autostart=1 quick-entry (respects mandatory login gate)
  useEffect(() => {
    if (!autostartRequested || connectionStatus !== 'connected') return;
    const gate = canEnterArena({
      isPlaceholderConfig,
      hasCloudUser: Boolean(cloudUser),
      hasLocalAccount: Boolean(activeAccount),
      isBanned: Boolean(cloudUser?.banned),
      connectionStatus,
    });
    if (!gate.allowed) return;
    if (!room && autostartPhaseRef.current === 'idle') {
      autostartPhaseRef.current = 'created';
      sendMsg({
        type: 'room:create',
        playerName: savedName,
        isSoloPractice: true,
        isTrainingMode: false,
      });
    } else if (room && room.phase === 'lobby' && autostartPhaseRef.current === 'created') {
      autostartPhaseRef.current = 'done';
      sendMsg({ type: 'room:setReady', ready: true });
      sendMsg({ type: 'room:startNow' });
    }
  }, [
    autostartRequested,
    connectionStatus,
    room,
    savedName,
    sendMsg,
    isPlaceholderConfig,
    cloudUser,
    activeAccount,
  ]);

  const handleGoogleSignIn = useCallback(async () => {
    if (isPlaceholderConfig) {
      setShowFirebaseGuide(true);
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    try {
      const profile = await signInWithGoogleCloud();
      setCloudUser(profile);
      sessionStorage.setItem('sc3d_name', profile.displayName.slice(0, 14));
      soundEngine.play('loginSuccess');
    } catch (err) {
      soundEngine.play('lockedError');
      const msg = err instanceof Error ? err.message : 'Google sign-in failed.';
      setAuthError(msg);
    } finally {
      setAuthLoading(false);
    }
  }, [isPlaceholderConfig]);

  const handleGoogleSignOut = useCallback(async () => {
    setAuthError(null);
    await signOutCloudUser(cloudUser?.uid);
    setCloudUser(null);
    setShowAdminMonitor(false);
  }, [cloudUser?.uid]);

  const handleCreateRoom = (
    name: string,
    opts?: { isSoloPractice?: boolean; isTrainingMode?: boolean }
  ) => {
    const gate = canEnterArena({
      isPlaceholderConfig,
      hasCloudUser: Boolean(cloudUser),
      hasLocalAccount: Boolean(activeAccount),
      isBanned: Boolean(cloudUser?.banned),
      connectionStatus,
    });
    if (!gate.allowed) {
      soundEngine.play('lockedError');
      setErrorMessage(gate.reason || 'Sign in with Google required to play.');
      return;
    }
    setErrorMessage(null);
    sessionStorage.setItem('sc3d_name', name);
    sendMsg({
      type: 'room:create',
      playerName: name,
      isSoloPractice: Boolean(opts?.isSoloPractice),
      isTrainingMode: Boolean(opts?.isTrainingMode),
    });
  };

  const handleJoinRoom = (code: string, name: string) => {
    const gate = canEnterArena({
      isPlaceholderConfig,
      hasCloudUser: Boolean(cloudUser),
      hasLocalAccount: Boolean(activeAccount),
      isBanned: Boolean(cloudUser?.banned),
      connectionStatus,
    });
    if (!gate.allowed) {
      soundEngine.play('lockedError');
      setErrorMessage(gate.reason || 'Sign in with Google required to play.');
      return;
    }
    setErrorMessage(null);
    sessionStorage.setItem('sc3d_name', name);
    sendMsg({ type: 'room:join', roomCode: code, playerName: name });
  };

  const handleLeave = () => {
    janeCutsceneAudio.rampFadeOut(0.35);
    soundEngine.setDucking(false);
    cutsceneIdRef.current = null;
    cutsceneDirectorRef.current = null;
    cutsceneMusicActiveRef.current = false;
    sessionStorage.removeItem('sc3d_room');
    sessionStorage.removeItem('sc3d_token');
    sendMsg({ type: 'room:leave' });
    setRoom(null);
    setSnapshot(null);
    setChatMessages([]);
    setChatOpen(false);
    setUnreadChatCount(0);
    setTargetId(null);
    setDamagePopups([]);
    setHitFlash(null);
    setOrbIndicators([]);
  };

  const handleToggleChat = useCallback(() => {
    setChatOpen((prev) => {
      const next = !prev;
      if (next) setUnreadChatCount(0);
      return next;
    });
  }, []);

  const handleSendChat = useCallback(
    (text: string) => {
      sendMsg({ type: 'room:chat', text });
    },
    [sendMsg]
  );

  const handleMoveInput = useCallback(
    (moveX: number, moveZ: number) => {
      inputSeqRef.current += 1;
      localControlRef.current.moveX = moveX;
      localControlRef.current.moveZ = moveZ;
      sendMsg({
        type: 'game:input',
        seq: inputSeqRef.current,
        moveX,
        moveZ,
        aimYaw: cameraYawRef.current,
        aimPitch: aimPitchRef.current,
        targetId: targetIdRef.current,
        blockHeld: localControlRef.current.blockHeld,
      });
    },
    [sendMsg]
  );

  const handleJump = useCallback(() => {
    inputSeqRef.current += 1;
    localControlRef.current.jumpTriggerSeq += 1;
    sendMsg({
      type: 'game:jump',
      seq: inputSeqRef.current,
    });
  }, [sendMsg]);

  const handleToggleFlight = useCallback(() => {
    inputSeqRef.current += 1;
    sendMsg({
      type: 'game:toggleFlight',
      seq: inputSeqRef.current,
    });
  }, [sendMsg]);

  const handleDash = useCallback(() => {
    inputSeqRef.current += 1;
    sendMsg({
      type: 'game:dash',
      seq: inputSeqRef.current,
      moveX: localControlRef.current.moveX,
      moveZ: localControlRef.current.moveZ,
      aimYaw: cameraYawRef.current,
    });
  }, [sendMsg]);

  const handleGrab = useCallback(() => {
    inputSeqRef.current += 1;
    sendMsg({
      type: 'game:grab',
      seq: inputSeqRef.current,
      aimYaw: cameraYawRef.current,
      targetId: targetIdRef.current,
    });
  }, [sendMsg]);

  const handleClashPick = useCallback(
    (clashId: string, choice: CombatMoveType) => {
      sendMsg({
        type: 'game:clashPick',
        clashId,
        choice,
      });
    },
    [sendMsg]
  );

  const handleBlockHoldChange = useCallback(
    (held: boolean) => {
      inputSeqRef.current += 1;
      localControlRef.current.blockHeld = held;
      sendMsg({
        type: 'game:input',
        seq: inputSeqRef.current,
        moveX: localControlRef.current.moveX,
        moveZ: localControlRef.current.moveZ,
        aimYaw: cameraYawRef.current,
        aimPitch: aimPitchRef.current,
        targetId: targetIdRef.current,
        blockHeld: held,
      });
    },
    [sendMsg]
  );

  const handleCastAbility = useCallback(
    (
      slot: AbilitySlot,
      holdHeavy?: boolean,
      aimPayload?: { aimX?: number; aimZ?: number; isHoldVariant?: boolean }
    ) => {
      inputSeqRef.current += 1;
      sendMsg({
        type: 'game:ability',
        seq: inputSeqRef.current,
        slot,
        holdHeavy,
        aimYaw: cameraYawRef.current,
        aimPitch: aimPitchRef.current,
        targetId: targetIdRef.current,
        aimX: aimPayload?.aimX,
        aimZ: aimPayload?.aimZ,
        isHoldVariant: aimPayload?.isHoldVariant,
      });
    },
    [sendMsg]
  );

  const handleAimUpdate = useCallback(
    (aimX: number, aimZ: number) => {
      sendMsg({
        type: 'game:aimUpdate',
        aimX,
        aimZ,
      });
    },
    [sendMsg]
  );

  const handleTrainingConfig = useCallback(
    (cfg: Partial<TrainingConfig>) => {
      sendMsg({
        type: 'game:trainingConfig',
        ...cfg,
      });
    },
    [sendMsg]
  );

  const handleAwakeningMash = useCallback(() => {
    soundEngine.play('mashTick');
    sendMsg({ type: 'game:awakeningMash' });
  }, [sendMsg]);

  const handleAwakeningSkip = useCallback(() => {
    janeCutsceneAudio.rampFadeOut(0.45);
    soundEngine.setDucking(false);
    cutsceneMusicActiveRef.current = false;
    cutsceneDirectorRef.current = null;
    sendMsg({ type: 'game:awakeningSkip' });
  }, [sendMsg]);

  const handleAwakeningDebug = useCallback(
    (action: AwakeningDebugAction) => {
      sendMsg({ type: 'game:debug', action });
    },
    [sendMsg]
  );

  const handleConsumeEvents = useCallback(() => {
    setPendingEvents([]);
  }, []);

  const handleSpawnDamagePopup = useCallback((popup: DamagePopup) => {
    setDamagePopups((prev) => [...prev.slice(-9), popup]);
    setTimeout(() => {
      setDamagePopups((prev) => prev.filter((p) => p.id !== popup.id));
    }, 560);
  }, []);

  const handleHitFlash = useCallback((flash: HitFlashInfo) => {
    setHitFlash(flash);
    setTimeout(() => {
      setHitFlash((cur) => (cur?.id === flash.id ? null : cur));
    }, 340);
  }, []);

  const handleScreenTint = useCallback((tint: ScreenTintInfo) => {
    setScreenTint(tint);
    setTimeout(() => {
      setScreenTint((cur) => (cur?.id === tint.id ? null : cur));
    }, tint.durationMs);
  }, []);

  const handleLoginAccount = useCallback((username: string) => {
    setAccountStore((prev) => {
      const res = loginOrCreateAccount(prev, username);
      if (res) {
        sessionStorage.setItem('sc3d_name', res.account.username);
        return res.store;
      }
      return prev;
    });
  }, []);

  const handleLogoutAccount = useCallback(() => {
    setAccountStore((prev) => logoutAccount(prev));
  }, []);

  return (
    <main className="relative w-full h-[100dvh] overflow-hidden bg-slate-50 text-slate-900">
      {viewMode === 'cinema' ? (
        <div className="fixed inset-0 w-full h-[100dvh] overflow-hidden">
          <button
            type="button"
            onClick={() => setViewMode('game')}
            className="fixed top-3 left-3 z-50 px-3.5 py-2 rounded-xl bg-white/95 hover:bg-slate-100 border border-slate-300 text-xs font-semibold text-slate-900 shadow-lg cursor-pointer"
          >
            ← Back to Multiplayer Game
          </button>
          <iframe
            src="/squad_clash_3d_golden_meadow_edition.html"
            title="KOOPAL CLASH Cinema Cut"
            className="w-full h-full border-0 block"
            allow="autoplay; fullscreen"
          />
        </div>
      ) : !room ? (
        <LobbyLanding
          initialRoomCode={initialRoomCode}
          initialName={cloudUser?.displayName || activeAccount?.username || savedName}
          account={activeAccount}
          cloudUser={cloudUser}
          authLoading={authLoading}
          authError={authError}
          isAdmin={isAdmin}
          isPlaceholderConfig={isPlaceholderConfig}
          connectionStatus={connectionStatus}
          pingMs={pingMs}
          errorMessage={errorMessage}
          onGoogleSignIn={handleGoogleSignIn}
          onGoogleSignOut={handleGoogleSignOut}
          onOpenAdminMonitor={() => setShowAdminMonitor(true)}
          onOpenFirebaseGuide={() => setShowFirebaseGuide(true)}
          onLoginAccount={handleLoginAccount}
          onLogoutAccount={handleLogoutAccount}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onOpenCinemaCut={() => setViewMode('cinema')}
        />
      ) : room.phase === 'lobby' ? (
        <TekkenPickScreen
          room={room}
          playerId={playerId}
          account={activeAccount}
          cloudUser={cloudUser}
          isAdmin={isAdmin}
          pingMs={pingMs}
          errorMessage={errorMessage}
          selectedSkin={selectedSkin}
          chatMessages={chatMessages}
          unreadChatCount={unreadChatCount}
          chatOpen={chatOpen}
          onToggleChat={handleToggleChat}
          onSendChat={handleSendChat}
          onSelectFighter={(fighterId: FighterId) => sendMsg({ type: 'room:selectFighter', fighterId })}
          onSelectSkin={(skinId: SkinId) => {
            setSelectedSkin(skinId);
            sendMsg({ type: 'room:selectSkin', skinId });
          }}
          onSelectMap={(mapId: MapId) => sendMsg({ type: 'room:selectMap', mapId })}
          onToggleReady={(ready: boolean) => sendMsg({ type: 'room:setReady', ready })}
          onStartNow={() => sendMsg({ type: 'room:startNow' })}
          onOpenAdminMonitor={() => setShowAdminMonitor(true)}
          onLeave={handleLeave}
        />
      ) : (
        <div className="fixed inset-0 w-full h-[100dvh] overflow-hidden animate-fade-in">
          <ArenaViewport
            mapId={room.mapId}
            roomPhase={room.phase}
            roomCountdown={room.countdown}
            playerId={playerId}
            targetId={targetId}
            lockOnEnabled={lockOnEnabled}
            snapshot={snapshot}
            pendingEvents={pendingEvents}
            onConsumeEvents={handleConsumeEvents}
            cameraYawRef={cameraYawRef}
            aimPitchRef={aimPitchRef}
            clockOffsetMsRef={clockOffsetMsRef}
            jitterMsRef={jitterMsRef}
            localControlRef={localControlRef}
            aimPreviewRef={aimPreviewRef}
            onCanvasAttack={(shiftHeld) => handleCastAbility(0, shiftHeld)}
            onCancelAim={() => setCancelAimTriggerSeq((v) => v + 1)}
            onSpawnDamagePopup={handleSpawnDamagePopup}
            onHitFlash={handleHitFlash}
            onScreenTint={handleScreenTint}
            onOrbIndicators={setOrbIndicators}
          />
          {screenTint && (
            <div
              key={screenTint.id}
              aria-hidden="true"
              className="fixed inset-0 z-20 pointer-events-none animate-screen-tint"
              style={{
                background: SCREEN_TINT_STYLES[screenTint.kind],
                ['--tint-dur' as string]: `${screenTint.durationMs}ms`,
              }}
            />
          )}
          <MobileCombatHUD
            room={room}
            playerId={playerId}
            account={activeAccount}
            cloudUser={cloudUser}
            isAdmin={isAdmin}
            lastCoinReward={lastCoinReward}
            pingMs={pingMs}
            snapshot={snapshot}
            targetId={targetId}
            lockOnEnabled={lockOnEnabled}
            cameraYawRef={cameraYawRef}
            aimPreviewRef={aimPreviewRef}
            cancelAimTriggerSeq={cancelAimTriggerSeq}
            damagePopups={damagePopups}
            hitFlash={hitFlash}
            orbIndicators={orbIndicators}
            chatMessages={chatMessages}
            unreadChatCount={unreadChatCount}
            chatOpen={chatOpen}
            onToggleChat={handleToggleChat}
            onSendChat={handleSendChat}
            onSelectTarget={setTargetId}
            onToggleLockOn={() => setLockOnEnabled((v) => !v)}
            onMoveInput={handleMoveInput}
            onJump={handleJump}
            onToggleFlight={handleToggleFlight}
            onDash={handleDash}
            onGrab={handleGrab}
            onClashPick={handleClashPick}
            onBlockHoldChange={handleBlockHoldChange}
            onCastAbility={handleCastAbility}
            onAimUpdate={handleAimUpdate}
            onTrainingConfig={handleTrainingConfig}
            onOpenAdminMonitor={() => setShowAdminMonitor(true)}
            onRematch={() => sendMsg({ type: 'room:rematch' })}
            onLeave={handleLeave}
          />
          {room.phase === 'combat' &&
            snapshot?.awakeningPhase === 'CUTSCENE' &&
            snapshot.awakeningCutscene && (
              <CutsceneOverlay
                cutscene={snapshot.awakeningCutscene}
                playerId={playerId}
                onMash={handleAwakeningMash}
                onSkip={handleAwakeningSkip}
              />
            )}
          {debugOpen && room.phase === 'combat' && snapshot && (
            <div className="relative z-[60]">
              <AwakeningDebugPanel
                awakeningPhase={snapshot.awakeningPhase}
                matchTime={snapshot.matchTime}
                cutsceneClock={snapshot.awakeningCutscene?.clockSec ?? null}
                onAction={handleAwakeningDebug}
              />
            </div>
          )}
        </div>
      )}

      {/* Non-blocking Screen Transition Curtain Overlay */}
      <ScreenTransition
        transitionKey={screenTrans.key}
        label={screenTrans.label}
        sublabel={screenTrans.sublabel}
        accentHex={screenTrans.accentHex}
      />

      {/* Modals: Admin Monitor (strictly sullenshades@gmail.com) & Firebase Setup Guide */}
      <AdminMonitorModal
        open={showAdminMonitor}
        currentUserEmail={cloudUser?.email}
        onClose={() => setShowAdminMonitor(false)}
      />
      <FirebaseSetupModal
        open={showFirebaseGuide}
        onClose={() => setShowFirebaseGuide(false)}
        onContinueLocalFallback={() => {
          handleLoginAccount('GuestFighter');
        }}
      />
    </main>
  );
}
