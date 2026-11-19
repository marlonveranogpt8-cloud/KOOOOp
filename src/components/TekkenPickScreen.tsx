import React, { useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Coins,
  Copy,
  Flame,
  Link2,
  LogOut,
  MapPin,
  Play,
  Shield,
  ShieldCheck,
  Sparkles,
  Swords,
  Zap,
} from 'lucide-react';
import {
  FIGHTER_BY_ID,
  FIGHTERS,
  FighterId,
  MAPS,
  MapId,
  RoomChatMessage,
  RoomState,
  SKIN_LABELS,
  SKIN_ORDER,
  SkinId,
  getFighterSkinMeta,
} from '../shared/gameData.ts';
import { TekkenStagePreview } from './TekkenStagePreview.tsx';
import { FullscreenControls } from './FullscreenControls.tsx';
import { RoomChatBox } from './RoomChatBox.tsx';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';
import { soundEngine } from '../game/soundEngine.ts';
import type { UserAccount } from '../game/accountStore.ts';
import type { CloudUserProfile } from '../game/firebaseUsers.ts';

const LIGHT_TEXT_BY_FIGHTER: Record<FighterId, string> = {
  jm: '#b45309',
  marjohn: '#0369a1',
  prime: '#be123c',
  damen: '#b45309',
  khen: '#7e22ce',
};

interface TekkenPickScreenProps {
  room: RoomState;
  playerId: string;
  account: UserAccount | null;
  cloudUser: CloudUserProfile | null;
  isAdmin: boolean;
  pingMs: number | null;
  errorMessage: string | null;
  selectedSkin: SkinId;
  chatMessages: RoomChatMessage[];
  unreadChatCount: number;
  chatOpen: boolean;
  onToggleChat: () => void;
  onSendChat: (text: string) => void;
  onSelectFighter: (fighterId: FighterId) => void;
  onSelectSkin: (skinId: SkinId) => void;
  onSelectMap: (mapId: MapId) => void;
  onToggleReady: (ready: boolean) => void;
  onStartNow: () => void;
  onOpenAdminMonitor: () => void;
  onLeave: () => void;
}

export const TekkenPickScreen: React.FC<TekkenPickScreenProps> = ({
  room,
  playerId,
  account,
  cloudUser,
  isAdmin,
  pingMs,
  errorMessage,
  selectedSkin,
  chatMessages,
  unreadChatCount,
  chatOpen,
  onToggleChat,
  onSendChat,
  onSelectFighter,
  onSelectSkin,
  onSelectMap,
  onToggleReady,
  onStartNow,
  onOpenAdminMonitor,
  onLeave,
}) => {
  const [copied, setCopied] = useState(false);
  const { enterFullscreen } = usePWAInstall();

  const me = room.players.find((p) => p.playerId === playerId);
  const myFighterId: FighterId = me?.fighterId ?? 'jm';
  const mySkinId: SkinId = selectedSkin ?? me?.skinId ?? 'ascended';
  const mySpec = FIGHTER_BY_ID[myFighterId];
  const myInk = LIGHT_TEXT_BY_FIGHTER[myFighterId];
  const mySkinMeta = getFighterSkinMeta(myFighterId, mySkinId);
  const isHost = room.hostId === playerId;
  const canStart = room.isSoloPractice || room.isTrainingMode || room.players.length >= 2;
  const displayCoins = cloudUser?.coins ?? account?.coins ?? null;

  const cycleSkin = (dir: -1 | 1) => {
    soundEngine.unlock();
    soundEngine.play('uiSelect');
    const idx = SKIN_ORDER.indexOf(mySkinId);
    const nextIdx = (idx + dir + SKIN_ORDER.length) % SKIN_ORDER.length;
    onSelectSkin(SKIN_ORDER[nextIdx]);
  };

  const copyInvite = async () => {
    soundEngine.unlock();
    soundEngine.play('uiClick');
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('room', room.roomCode);
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const triggerMobileFs = () => {
    if (window.matchMedia('(pointer: coarse)').matches) {
      void enterFullscreen(true);
    }
  };

  return (
    <div className="h-[100dvh] w-full bg-slate-50 text-slate-900 flex flex-col justify-between px-2.5 pt-2.5 pb-12 sm:px-6 sm:py-4 overflow-y-auto overscroll-y-contain safe-area-pad animate-screen-enter">
      {/* Top Bar: Squad Clash Room Header & P1-P5 Slots */}
      <div className="w-full max-w-7xl mx-auto flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm">
          <div className="flex items-center gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {room.isTrainingMode
                  ? 'Training Area'
                  : room.isSoloPractice
                  ? 'Vs. Bot Arena'
                  : 'Squad Room Code'}
              </div>
              <div className="font-mono-num text-lg sm:text-xl font-bold tracking-widest text-amber-700 leading-none">
                {room.roomCode}
              </div>
            </div>

            {!room.isSoloPractice && !room.isTrainingMode && (
              <button
                type="button"
                onClick={copyInvite}
                className="ui-interactive min-h-[36px] px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 text-[11px] sm:text-xs font-semibold text-slate-800 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-sky-600" />}
                <span>{copied ? 'Copied' : 'Invite Link'}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {cloudUser && (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-slate-50 border border-slate-200">
                {cloudUser.photoURL ? (
                  <img
                    src={cloudUser.photoURL}
                    alt={cloudUser.displayName}
                    referrerPolicy="no-referrer"
                    className="w-5 h-5 rounded-full object-cover"
                  />
                ) : null}
                <span className="text-[11px] font-bold text-slate-900 max-w-[100px] truncate">
                  {cloudUser.displayName}
                </span>
              </div>
            )}
            {displayCoins !== null && (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-100 border border-amber-300 text-amber-900 font-mono-num text-[11px] font-bold">
                <Coins className="w-3.5 h-3.5 text-amber-600" />
                <span>{displayCoins}</span>
              </div>
            )}
            {isAdmin && (
              <button
                type="button"
                data-testid="admin-monitor-btn"
                onClick={onOpenAdminMonitor}
                className="ui-interactive min-h-[34px] px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-amber-300 text-[11px] font-display font-bold flex items-center gap-1 cursor-pointer"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Admin Monitor</span>
              </button>
            )}
            {pingMs !== null && (
              <span className="hidden sm:inline text-[11px] font-mono-num text-emerald-700 font-semibold">
                {pingMs} ms
              </span>
            )}
            <span className="text-[11px] sm:text-xs text-slate-600 font-mono-num">
              {room.isTrainingMode
                ? 'Free Practice · Dummy & Zero CD Toggles'
                : room.isSoloPractice
                ? '1P vs Smart Bot · Loss Exits'
                : `${room.players.length}/5 Joined · First to 3 Wins`}
            </span>
            <RoomChatBox
              messages={chatMessages}
              playerId={playerId}
              unreadCount={unreadChatCount}
              isOpen={chatOpen}
              onToggleOpen={onToggleChat}
              onSendMessage={onSendChat}
            />
            <FullscreenControls compact lockLandscape />
            <button
              type="button"
              onClick={() => {
                soundEngine.unlock();
                soundEngine.play('transitionWhoosh');
                onLeave();
              }}
              className="ui-interactive min-h-[36px] px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-rose-50 border border-slate-300 hover:border-rose-300 text-xs font-semibold text-slate-800 flex items-center gap-1 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Leave</span>
            </button>
          </div>
        </div>

        {/* Tekken-style P1–P5 Player Slots Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 sm:gap-2">
          {[0, 1, 2, 3, 4].map((slotIdx) => {
            const p = room.players.find((pl) => pl.slotIndex === slotIdx);
            const fSpec = p ? FIGHTER_BY_ID[p.fighterId] : null;
            const fInk = p ? LIGHT_TEXT_BY_FIGHTER[p.fighterId] : '#475569';
            const isSelf = p?.playerId === playerId;
            return (
              <div
                key={slotIdx}
                className={`rounded-xl px-2.5 py-1.5 border transition shadow-xs ${
                  p
                    ? isSelf
                      ? 'bg-white border-amber-500 ring-1 ring-amber-300'
                      : 'bg-white border-slate-200'
                    : 'bg-slate-100/80 border-slate-200/80 opacity-70'
                }`}
              >
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-mono-num font-bold text-slate-500">
                    P{slotIdx + 1} {isSelf ? '(You)' : ''}
                  </span>
                  {p ? (
                    <span className={`font-semibold ${p.ready ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {p.ready ? 'LOCKED' : 'SELECTING'}
                    </span>
                  ) : (
                    <span className="text-slate-400">OPEN</span>
                  )}
                </div>
                {p && fSpec ? (
                  <div className="mt-0.5 flex items-center justify-between gap-1">
                    <span className="text-xs font-bold text-slate-900 truncate">{p.name}</span>
                    <span className="text-[10px] font-display font-bold truncate" style={{ color: fInk }}>
                      {fSpec.name}
                    </span>
                  </div>
                ) : (
                  <div className="mt-0.5 text-[10px] text-slate-400 truncate">Waiting for friend...</div>
                )}
              </div>
            );
          })}
        </div>

        {errorMessage && (
          <div className="rounded-xl bg-rose-50 border border-rose-300 px-3.5 py-2 text-xs text-rose-800 font-medium">
            {errorMessage}
          </div>
        )}
      </div>

      {/* Center Stage: 3D Fighter Spotlight + Identity Passive / M1 Chain / Combo Link / 5 Skills + Stage */}
      <div className="w-full max-w-7xl mx-auto my-2 grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch flex-1">
        {/* 3D Spotlight Pedestal + Visible Skin Switcher Box */}
        <div
          className="lg:col-span-5 relative rounded-2xl bg-white border overflow-hidden flex flex-col justify-between transition-colors duration-300 shadow-lg"
          style={{
            borderColor: `${mySpec.color}88`,
            backgroundImage: `radial-gradient(circle at 50% 44%, ${mySpec.color}20, rgba(248, 250, 252, 0.96) 72%)`,
          }}
        >
          {/* Top Header + HP/STM + Skin Switcher Box */}
          <div className="relative z-10 px-3.5 pt-2.5 pb-1.5 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div
                  className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider truncate"
                  style={{ color: myInk }}
                >
                  {mySpec.title} · {mySpec.m1Combo.rangeIdentity}
                </div>
                <h2 className="font-display text-2xl sm:text-4xl font-bold text-slate-950 tracking-tight leading-none mt-0.5">
                  {mySpec.name}
                </h2>
              </div>
              <div className="text-right text-[10px] sm:text-[11px] font-mono-num font-bold text-slate-800 bg-white/95 px-2.5 py-1 rounded-lg border border-slate-200 shrink-0 shadow-xs">
                <div>HP {mySpec.maxHp}</div>
                <div className="text-amber-700">STM {mySpec.maxStamina}</div>
              </div>
            </div>

            {/* Skin Switcher Box */}
            <div
              data-testid="skin-switcher"
              className="rounded-xl bg-white/95 border border-slate-200 px-2.5 py-2 shadow-sm transition-all duration-300"
              style={{
                borderColor: `${mySkinMeta.accentColor}99`,
              }}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full shrink-0 border border-slate-300"
                      style={{ backgroundColor: mySkinMeta.accentColor }}
                    />
                    <span className="font-display font-bold text-xs sm:text-sm text-slate-900 truncate">
                      {mySkinMeta.name}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-600 truncate">{mySkinMeta.tagline}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    aria-label="Previous Skin"
                    onClick={() => cycleSkin(-1)}
                    className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 flex items-center justify-center text-slate-800 cursor-pointer transition active:scale-90"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Next Skin"
                    onClick={() => cycleSkin(1)}
                    className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 flex items-center justify-center text-slate-800 cursor-pointer transition active:scale-90"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {SKIN_ORDER.map((sid) => {
                  const active = mySkinId === sid;
                  const meta = getFighterSkinMeta(myFighterId, sid);
                  return (
                    <button
                      key={sid}
                      type="button"
                      data-skin-id={sid}
                      onClick={() => {
                        soundEngine.unlock();
                        soundEngine.play('uiSelect');
                        onSelectSkin(sid);
                      }}
                      className={`min-h-[28px] px-1.5 py-1 rounded-lg text-[10px] font-display font-bold uppercase tracking-wide border transition cursor-pointer truncate ${
                        active
                          ? 'text-slate-950 shadow-sm scale-[1.02]'
                          : 'bg-slate-100 border-slate-200 text-slate-700 hover:border-slate-400'
                      }`}
                      style={
                        active
                          ? {
                              backgroundColor: meta.accentColor,
                              borderColor: '#0f172a',
                            }
                          : undefined
                      }
                    >
                      {SKIN_LABELS[sid]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="w-full h-[170px] sm:h-[205px] lg:h-[235px] relative">
            <TekkenStagePreview fighterId={myFighterId} skinId={mySkinId} />
          </div>

          {/* Animated Power / Speed / Defense Stat Bars */}
          <div className="relative z-10 px-3.5 py-2.5 bg-white/95 border-t border-slate-200 grid grid-cols-3 gap-2.5 text-[10px] sm:text-[11px]">
            {[
              { label: 'Power', val: mySpec.stats.power, color: '#e11d48' },
              { label: 'Speed', val: mySpec.stats.speed, color: '#0284c7' },
              { label: 'Defense', val: mySpec.stats.defense, color: '#d97706' },
            ].map((st) => (
              <div key={st.label}>
                <div className="flex justify-between text-slate-600 mb-1">
                  <span className="font-semibold uppercase tracking-wide text-[9px] sm:text-[10px]">{st.label}</span>
                  <span className="font-mono-num font-bold text-slate-950">{st.val}/10</span>
                </div>
                <div className="h-2 rounded-full bg-slate-200 overflow-hidden relative">
                  <div
                    className="h-full rounded-full transition-all duration-500 ease-out relative"
                    style={{
                      width: `${st.val * 10}%`,
                      backgroundColor: st.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Side: Passive + M1 Chain + Combo Link + 5 Strategic Abilities + Stage Picker */}
        <div className="lg:col-span-7 flex flex-col justify-between gap-2">
          {/* Identity Passive + Special M1 + Combo Link */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="rounded-xl bg-white border border-slate-200 p-2.5 shadow-xs">
              <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-700">
                <Flame className="w-3.5 h-3.5 text-amber-600" />
                <span>Passive · {mySpec.passive.name}</span>
              </div>
              <p className="text-[11px] text-slate-700 mt-1 leading-snug">{mySpec.passive.shortDesc}</p>
              <p className="text-[10px] text-amber-700 font-medium mt-1 leading-snug">{mySpec.passive.frenzyBonus}</p>
            </div>

            <div className="rounded-xl bg-white border border-slate-200 p-2.5 shadow-xs">
              <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-sky-700">
                <Swords className="w-3.5 h-3.5 text-sky-600" />
                <span>
                  {mySpec.m1Combo.stepNames.length > 1
                    ? `${mySpec.m1Combo.stepNames.length}-Hit M1 Combo`
                    : 'Signature Basic M1'}
                </span>
              </div>
              <p className="text-[11px] text-slate-900 font-semibold mt-1 leading-snug">
                {mySpec.m1Combo.stepNames.join(' → ')}
              </p>
              <p className="text-[10px] text-slate-600 mt-1 leading-snug">
                Finisher: <span className="text-amber-700 font-semibold">{mySpec.m1Combo.heavyFinisherName}</span>
              </p>
            </div>

            <div className="rounded-xl bg-white border border-slate-200 p-2.5 shadow-xs">
              <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                <Link2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>{mySpec.comboLink.triggerName}</span>
              </div>
              <p className="text-[11px] text-slate-700 mt-1 leading-snug">{mySpec.comboLink.hint}</p>
              <p className="text-[10px] text-emerald-700 font-semibold mt-1">
                +{mySpec.comboLink.bonusDamage} Bonus DMG · +{mySpec.comboLink.bonusStagger} Stagger
              </p>
            </div>
          </div>

          {/* 5 Strategic Abilities with Keybind Badges */}
          <div className="rounded-2xl bg-white border border-slate-200 p-3 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2">
              <h3 className="font-display text-xs sm:text-sm font-bold uppercase tracking-wide text-slate-900">
                {mySpec.name}&apos;s Kit · Tap = Auto-Aim · Hold/Drag = Aim · Q Dash · F Guard · G Grab
              </h3>
              <span className="text-[10px] font-medium text-slate-500 whitespace-nowrap">
                KO Style: {mySpec.koStyle}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
              {mySpec.abilities.map((ab) => {
                const icon =
                  ab.slot === 0 ? <Swords className="w-3.5 h-3.5" /> :
                  ab.slot === 1 ? <Shield className="w-3.5 h-3.5" /> :
                  ab.slot === 2 ? <Zap className="w-3.5 h-3.5" /> :
                  ab.slot === 3 ? <Sparkles className="w-3.5 h-3.5" /> :
                  <Play className="w-3.5 h-3.5" />;
                return (
                  <div
                    key={ab.slot}
                    className="rounded-xl bg-slate-50 border border-slate-200 p-2 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between text-[9px] mb-1">
                        <span className="px-1.5 py-0.2 rounded bg-slate-900 text-white font-mono-num font-bold">
                          {ab.keyHint}
                        </span>
                        <span className="font-mono-num font-bold text-amber-700">
                          {ab.manaCost > 0 ? `${ab.manaCost}C ` : ''}{ab.staminaCost}S
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-[11px] font-bold text-slate-900">
                        <span style={{ color: myInk }}>{icon}</span>
                        <span className="truncate">{ab.name}</span>
                      </div>
                      <p className="text-[10px] text-slate-600 mt-1 leading-snug">{ab.shortDesc}</p>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[9px] font-mono-num text-slate-500">
                      <span className="font-bold uppercase" style={{ color: myInk }}>{ab.role}</span>
                      <span>CD {ab.cooldown}s</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Stage Selector (4 Maps including Shibuya Scramble) */}
          <div className="rounded-2xl bg-white border border-slate-200 p-3 shadow-xs">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-amber-600" />
                <h3 className="font-display text-xs sm:text-sm font-bold uppercase tracking-wide text-slate-900">
                  Select Stage (Destructible Buildings &amp; Ruins)
                </h3>
              </div>
              <span className="text-[10px] text-slate-500 font-medium">
                {isHost ? 'Host picks arena' : 'Synced to Host'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {MAPS.map((m) => {
                const selected = room.mapId === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    data-map-id={m.id}
                    disabled={!isHost}
                    onClick={() => {
                      soundEngine.unlock();
                      soundEngine.play('uiSelect');
                      onSelectMap(m.id);
                    }}
                    className={`text-left rounded-xl p-2 border transition ${
                      selected
                        ? 'bg-amber-50 border-amber-500 ring-1 ring-amber-300 shadow-xs'
                        : 'bg-slate-50 border-slate-200 hover:border-slate-400'
                    } ${isHost ? 'cursor-pointer' : 'cursor-default opacity-90'}`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className="font-display font-bold text-[11px] sm:text-xs text-slate-900 leading-tight">{m.name}</span>
                      {selected && <span className="text-[9px] font-bold text-amber-700 uppercase shrink-0">ACTIVE</span>}
                    </div>
                    <div className="text-[10px] text-slate-600 mt-0.5 line-clamp-2">{m.subtitle}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Roster Bar + Ready / Start Controls */}
      <div className="sticky bottom-0 lg:static z-20 w-full max-w-7xl mx-auto flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 bg-white/95 border border-slate-200 rounded-2xl p-2 sm:p-3 shadow-lg">
        <div className="grid grid-cols-5 gap-1.5 sm:gap-2 flex-1">
          {FIGHTERS.map((f) => {
            const isSelected = myFighterId === f.id;
            const pickedBy = room.players.filter((p) => p.fighterId === f.id);
            return (
              <button
                key={f.id}
                type="button"
                data-fighter-id={f.id}
                onClick={() => {
                  soundEngine.unlock();
                  soundEngine.play('uiSelect');
                  onSelectFighter(f.id);
                }}
                className={`min-h-[48px] sm:min-h-[54px] rounded-xl px-1.5 sm:px-2 py-1.5 border text-left transition cursor-pointer relative ${
                  isSelected
                    ? 'bg-slate-100 border-slate-900 ring-1 ring-slate-900 shadow-sm scale-[1.02]'
                    : 'bg-slate-50 border-slate-200 hover:border-slate-400'
                }`}
              >
                <div className="w-full h-1.5 rounded-full mb-1" style={{ backgroundColor: f.color }} />
                <div className="font-display font-bold text-[10px] sm:text-sm text-slate-900 truncate">{f.name}</div>
                <div className="text-[10px] text-slate-600 truncate hidden sm:block">{f.m1Combo.rangeIdentity}</div>
                {pickedBy.length > 0 && (
                  <div className="mt-0.5 flex flex-wrap gap-0.5">
                    {pickedBy.map((p) => (
                      <span
                        key={p.playerId}
                        className="text-[8px] sm:text-[9px] font-mono-num font-bold text-slate-950 px-1 rounded border border-slate-900/20"
                        style={{ backgroundColor: f.color }}
                      >
                        P{p.slotIndex + 1}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              soundEngine.unlock();
              soundEngine.play('uiSelect');
              triggerMobileFs();
              onToggleReady(!me?.ready);
            }}
            className={`btn-shimmer flex-1 sm:flex-none min-h-[46px] sm:min-h-[54px] px-4 sm:px-5 rounded-xl font-display font-bold text-sm sm:text-base tracking-wide transition hover:scale-[1.02] active:scale-95 cursor-pointer ${
              me?.ready
                ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-md'
                : 'bg-amber-400 hover:bg-amber-300 text-slate-950 shadow-md border border-amber-500/60'
            }`}
          >
            {me?.ready ? 'LOCKED IN ✓' : 'LOCK IN'}
          </button>

          {isHost && (
            <button
              type="button"
              data-testid="start-fight-btn"
              disabled={!canStart}
              onClick={() => {
                soundEngine.unlock();
                soundEngine.play('transitionWhoosh');
                triggerMobileFs();
                onStartNow();
              }}
              className="btn-shimmer min-h-[46px] sm:min-h-[54px] px-4 sm:px-5 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-white font-display font-bold text-sm sm:text-base tracking-wide transition hover:scale-[1.02] active:scale-95 shadow-md cursor-pointer whitespace-nowrap"
            >
              {room.isTrainingMode ? 'START TRAINING' : 'START FIGHT'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
