import React, { useEffect, useRef, useState } from 'react';
import { AWAKENING_CONFIG } from '../shared/awakeningConfig.ts';
import type { AwakeningCutsceneState } from '../shared/gameData.ts';

interface CutsceneOverlayProps {
  cutscene: AwakeningCutsceneState;
  playerId: string;
  onMash: () => void;
  onSkip?: () => void;
}

export const CutsceneOverlay: React.FC<CutsceneOverlayProps> = ({
  cutscene,
  playerId,
  onMash,
  onSkip,
}) => {
  const clock = cutscene.clockSec;
  const T = AWAKENING_CONFIG.TIMELINE;

  const isWalkPhase = clock < T.PANEL_1_AT;
  const isPanel1 = clock >= T.PANEL_1_AT && clock < T.PANEL_2_AT;
  const isPanel2 = clock >= T.PANEL_2_AT && clock < T.CLASH_START_AT;
  const isClashPhase = clock >= T.CLASH_START_AT && !cutscene.resolved;

  const amP1 = playerId === cutscene.p1Id;
  const amP2 = playerId === cutscene.p2Id;
  const isParticipant = amP1 || amP2;

  const kit1 = AWAKENING_CONFIG.AWAKENED_KITS[cutscene.p1FighterId];
  const kit2 = AWAKENING_CONFIG.AWAKENED_KITS[cutscene.p2FighterId];

  // Hold-to-skip state (1.0s hold)
  const [skipProgress, setSkipProgress] = useState(0);
  const skipHoldStartRef = useRef<number | null>(null);
  const skipTriggeredRef = useRef(false);

  useEffect(() => {
    skipHoldStartRef.current = null;
    skipTriggeredRef.current = false;
    setSkipProgress(0);
  }, [cutscene.id]);

  useEffect(() => {
    if (!AWAKENING_CONFIG.ALLOW_SKIP || !onSkip) return;
    let raf = 0;
    const step = () => {
      if (skipHoldStartRef.current !== null && !skipTriggeredRef.current) {
        const elapsed = (performance.now() - skipHoldStartRef.current) / 1000;
        const pct = Math.min(1, elapsed / AWAKENING_CONFIG.SKIP_HOLD_SEC);
        setSkipProgress(pct);
        if (pct >= 1) {
          skipTriggeredRef.current = true;
          skipHoldStartRef.current = null;
          onSkip();
          return;
        }
        raf = requestAnimationFrame(step);
      }
    };
    const startLoop = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(step);
    };
    const onWindowUp = () => {
      skipHoldStartRef.current = null;
      setSkipProgress(0);
    };
    if (skipProgress > 0) startLoop();
    window.addEventListener('pointerup', onWindowUp);
    window.addEventListener('pointercancel', onWindowUp);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointerup', onWindowUp);
      window.removeEventListener('pointercancel', onWindowUp);
    };
  }, [onSkip, skipProgress]);

  const beginSkipHold = () => {
    if (!AWAKENING_CONFIG.ALLOW_SKIP || !onSkip || skipTriggeredRef.current) return;
    skipHoldStartRef.current = performance.now();
    setSkipProgress(0.02);
  };

  const cancelSkipHold = () => {
    skipHoldStartRef.current = null;
    setSkipProgress(0);
  };

  // Keyboard mash (Space for P1 / Enter for P2, with repeat ignored)
  useEffect(() => {
    if (!isClashPhase || !isParticipant) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (amP1 && e.code === 'Space') {
        e.preventDefault();
        onMash();
      } else if (amP2 && (e.code === 'Enter' || e.code === 'Space')) {
        e.preventDefault();
        onMash();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isClashPhase, isParticipant, amP1, amP2, onMash]);

  // Ease-in un-darkening curve from pure black over 0:00 -> 0:12
  const blackOpacity = isWalkPhase
    ? Math.max(0, Math.min(1, 1 - Math.pow(clock / Math.max(0.1, T.WALK_FADE_END), 1.35)))
    : 0;

  // Center divider moves left (-1 = P1 winning) to right (+1 = P2 winning)
  // For UI intuition: left fill % represents P1's push! When clashBalance = -1, P1 fills 100% left->right.
  const p1SharePct = Math.max(6, Math.min(94, 50 - cutscene.clashBalance * 44));
  const p2SharePct = 100 - p1SharePct;

  const p1Color = kit1.auraPrimaryCss;
  const p2Color =
    cutscene.p1FighterId === cutscene.p2FighterId ? '#fb7185' : kit2.auraPrimaryCss;

  return (
    <div
      data-testid="awakening-cutscene-overlay"
      className="fixed inset-0 z-50 overflow-hidden select-none pointer-events-auto"
    >
      {/* 0:00 - 0:12 Pure Black Fade-In Curtain + Atmospheric Embers */}
      {isWalkPhase && (
        <>
          <div
            data-testid="cutscene-black-fade"
            className="absolute inset-0 bg-black pointer-events-none transition-opacity duration-75"
            style={{ opacity: blackOpacity }}
          />
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'radial-gradient(circle at 50% 50%, transparent 45%, rgba(2, 6, 23, 0.65) 100%)',
            }}
          />
        </>
      )}

      {/* Letterbox Cinema Bars during Walk & Clash */}
      {(isWalkPhase || isClashPhase) && (
        <>
          <div className="absolute top-0 left-0 right-0 h-[9vh] max-h-16 bg-black z-10 pointer-events-none border-b border-white/10" />
          <div className="absolute bottom-0 left-0 right-0 h-[9vh] max-h-16 bg-black z-10 pointer-events-none border-t border-white/10" />
        </>
      )}

      {/* ~0:12 - 0:14: MANGA PANEL 1 ("LET'S LARP") */}
      {isPanel1 && (
        <div
          data-testid="cutscene-panel-1"
          className="absolute inset-0 z-30 flex items-center justify-center bg-black p-2 sm:p-5 animate-manga-shake"
        >
          <div
            className="relative w-full h-full max-w-6xl max-h-[88vh] overflow-hidden border-[5px] sm:border-[7px] border-white shadow-[0_0_50px_rgba(96,165,250,0.65)]"
            style={{
              background:
                'linear-gradient(125deg, #e0f2fe 0%, #93c5fd 38%, #3b82f6 82%, #1d4ed8 100%)',
            }}
          >
            {/* Halftone Dot Pattern Overlay */}
            <div
              className="absolute inset-0 opacity-25 pointer-events-none"
              style={{
                backgroundImage:
                  'radial-gradient(circle, rgba(15, 23, 42, 0.75) 1.4px, transparent 1.6px)',
                backgroundSize: '10px 10px',
              }}
            />

            {/* Radial Anime Speed Lines */}
            <svg
              className="absolute inset-0 w-full h-full opacity-35 pointer-events-none"
              viewBox="0 0 1000 560"
              preserveAspectRatio="none"
            >
              {Array.from({ length: 28 }).map((_, idx) => {
                const ang = (idx / 28) * Math.PI * 2;
                const x1 = 580 + Math.cos(ang) * 180;
                const y1 = 230 + Math.sin(ang) * 140;
                const x2 = 580 + Math.cos(ang) * 780;
                const y2 = 230 + Math.sin(ang) * 620;
                return (
                  <line
                    key={idx}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="#ffffff"
                    strokeWidth={idx % 3 === 0 ? 4 : 2}
                    strokeOpacity={0.7}
                  />
                );
              })}
            </svg>

            {/* Hand-lettered Impact Text: LET'S LARP */}
            <div className="relative z-20 flex flex-col justify-center h-full pl-6 sm:pl-14 max-w-[52%] pointer-events-none">
              <div
                className="font-manga text-slate-950 uppercase leading-[0.88] tracking-wider"
                style={{
                  fontSize: 'clamp(3.2rem, 10vw, 7.6rem)',
                  textShadow:
                    '3px 3px 0px rgba(255,255,255,0.65), -2px -2px 0px rgba(15,23,42,0.2)',
                  filter: 'contrast(1.2)',
                }}
              >
                <div>LET&apos;S</div>
                <div className="mt-1 sm:mt-2">LARP</div>
              </div>
              <div className="mt-3 inline-flex items-center gap-2 self-start bg-slate-950/90 text-sky-200 border-2 border-white px-3 py-1 rounded text-xs sm:text-sm font-display font-bold uppercase tracking-widest">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: kit1.auraPrimaryCss }}
                />
                {cutscene.p1Name} · {kit1.awakenedTitle}
              </div>
            </div>

            {/* P1 Anime Bust Illustration (or custom portraitUrl if provided) */}
            {kit1.portraitUrl ? (
              <img
                src={kit1.portraitUrl}
                alt={cutscene.p1Name}
                className="absolute right-0 bottom-0 h-[96%] w-auto object-contain pointer-events-none z-10"
              />
            ) : (
              <svg
                viewBox="0 0 640 520"
                className="absolute right-[-4%] sm:right-[2%] bottom-0 h-[97%] w-auto max-w-[78%] pointer-events-none z-10"
                aria-hidden="true"
              >
                <defs>
                  <radialGradient id="foreheadGlow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
                    <stop offset="35%" stopColor="#e0f2fe" stopOpacity="0.98" />
                    <stop offset="68%" stopColor="#38bdf8" stopOpacity="0.65" />
                    <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
                  </radialGradient>
                  <linearGradient id="coatShade" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#1e293b" />
                    <stop offset="55%" stopColor="#0f172a" />
                    <stop offset="100%" stopColor="#020617" />
                  </linearGradient>
                  <linearGradient id="skinShade" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#f3cfb6" />
                    <stop offset="70%" stopColor="#e2ad8e" />
                    <stop offset="100%" stopColor="#c78b6b" />
                  </linearGradient>
                </defs>
                {/* Dynamic Black Coat Shoulders */}
                <path
                  d="M95 520 L145 318 L242 268 L412 268 L508 320 L555 520 Z"
                  fill="url(#coatShade)"
                  stroke="#020617"
                  strokeWidth="6"
                  strokeLinejoin="round"
                />
                {/* Coat Fold Shadows */}
                <path d="M165 360 L215 470 M478 362 L435 468" stroke="#334155" strokeWidth="4" strokeLinecap="round" />
                {/* Sculpted Bare Chest & Collarbone + Dog Tag */}
                <path d="M258 308 L385 308 L368 520 L270 520 Z" fill="url(#skinShade)" stroke="#0f172a" strokeWidth="5" />
                <path d="M275 348 Q305 368 320 356 Q336 368 366 348" fill="none" stroke="#b97b5b" strokeWidth="3.5" strokeLinecap="round" />
                <path d="M320 364 L318 465" stroke="#b97b5b" strokeWidth="3" strokeLinecap="round" />
                {/* Layered Jagged White Fur Collar */}
                <path
                  d="M142 342 L95 282 L148 272 L120 218 L182 238 L178 184 L236 226 L262 292 L378 292 L412 222 L472 186 L458 240 L520 220 L488 276 L538 286 L476 348 L402 318 L372 302 L268 302 L228 322 Z"
                  fill="#f8fafc"
                  stroke="#0f172a"
                  strokeWidth="5.5"
                  strokeLinejoin="round"
                />
                <path
                  d="M165 292 L205 268 L245 296 M405 296 L444 268 L482 292"
                  fill="none"
                  stroke="#cbd5e1"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
                {/* Dog Tag Chain & Tag */}
                <path d="M286 306 Q315 398 302 428" fill="none" stroke="#94a3b8" strokeWidth="4" strokeDasharray="4 4" />
                <path d="M352 308 Q326 392 310 426" fill="none" stroke="#64748b" strokeWidth="3.5" strokeDasharray="4 4" />
                <rect x="288" y="424" width="28" height="40" rx="4" transform="rotate(14 302 444)" fill="#e2e8f0" stroke="#0f172a" strokeWidth="4" />
                <line x1="295" y1="436" x2="310" y2="440" stroke="#64748b" strokeWidth="2.5" />
                {/* Neck & Angular Anime Jawline */}
                <path d="M288 228 L286 312 L362 312 L360 228 Z" fill="#d39b7c" stroke="#0f172a" strokeWidth="4.5" />
                <path d="M288 250 Q324 282 360 248 L360 230 L288 230 Z" fill="#b97d5e" opacity="0.55" />
                <path
                  d="M262 114 L264 196 L296 244 L324 258 L352 244 L384 196 L386 114 Z"
                  fill="url(#skinShade)"
                  stroke="#0f172a"
                  strokeWidth="5"
                  strokeLinejoin="round"
                />
                {/* Cheek scar & nose bridge shadow */}
                <path d="M322 178 L317 206 L328 208" fill="none" stroke="#9f6548" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M342 222 L352 238 M346 226 L340 230" stroke="#b45349" strokeWidth="2.2" strokeLinecap="round" />
                {/* Half-lidded cool eyes & brow */}
                <path d="M276 164 L310 172" stroke="#0f172a" strokeWidth="5.5" strokeLinecap="round" />
                <path d="M338 172 L372 164" stroke="#0f172a" strokeWidth="5.5" strokeLinecap="round" />
                <path d="M280 176 Q295 174 308 178" fill="none" stroke="#0f172a" strokeWidth="3.5" />
                <path d="M340 178 Q353 174 368 176" fill="none" stroke="#0f172a" strokeWidth="3.5" />
                <ellipse cx="295" cy="180" rx="6" ry="3.5" fill="#1e293b" />
                <ellipse cx="353" cy="180" rx="6" ry="3.5" fill="#1e293b" />
                <circle cx="296" cy="179" r="1.5" fill="#bae6fd" />
                <circle cx="354" cy="179" r="1.5" fill="#bae6fd" />
                {/* Confident smirk */}
                <path d="M302 224 Q328 232 352 216" fill="none" stroke="#0f172a" strokeWidth="4.5" strokeLinecap="round" />
                <path d="M320 236 L332 235" stroke="#9f6548" strokeWidth="2.5" strokeLinecap="round" />
                {/* Spiky Tousled Anime Hair */}
                <path
                  d="M242 156 L230 120 L254 102 L248 76 L284 74 L306 46 L334 68 L368 50 L376 80 L412 88 L398 122 L410 148 L384 134 L364 152 L344 126 L324 148 L302 124 L280 148 L262 128 Z"
                  fill="#334155"
                  stroke="#0f172a"
                  strokeWidth="4.8"
                  strokeLinejoin="round"
                />
                {/* Hair shine highlight */}
                <path d="M276 92 Q324 72 370 92" fill="none" stroke="#64748b" strokeWidth="4" strokeLinecap="round" />
                {/* Glowing Forehead Core + Flare Rays */}
                <circle cx="324" cy="126" r="54" fill="url(#foreheadGlow)" />
                <path d="M324 68 L328 122 L382 126 L328 130 L324 184 L320 130 L266 126 L320 122 Z" fill="#ffffff" opacity="0.88" />
                <circle cx="324" cy="126" r="16" fill="#ffffff" />
                {/* Foreshortened Finger-Gun Pointing at Camera */}
                <g transform="translate(338, 290)">
                  {/* Wrist / Palm */}
                  <path
                    d="M38 118 L76 48 L128 38 L152 68 L136 126 L68 152 Z"
                    fill="url(#skinShade)"
                    stroke="#0f172a"
                    strokeWidth="5.5"
                    strokeLinejoin="round"
                  />
                  {/* Extended Thumb Up */}
                  <path
                    d="M72 56 L92 -6 Q104 -18 118 -4 L112 52"
                    fill="#f3cfb6"
                    stroke="#0f172a"
                    strokeWidth="5"
                    strokeLinejoin="round"
                  />
                  {/* Pointing Index Finger Foreshortened toward Viewer */}
                  <path
                    d="M28 74 L68 48 Q98 48 94 84 L54 106 Z"
                    fill="#f5d4bd"
                    stroke="#0f172a"
                    strokeWidth="5"
                    strokeLinejoin="round"
                  />
                  <ellipse cx="44" cy="86" rx="18" ry="15" fill="#f7decb" stroke="#0f172a" strokeWidth="5" />
                  <path d="M36 82 Q44 76 52 82" fill="none" stroke="#b97b5b" strokeWidth="2.5" strokeLinecap="round" />
                  {/* Curled Middle / Ring / Pinky Fingers */}
                  <ellipse cx="76" cy="112" rx="24" ry="14" fill="#e2ad8e" stroke="#0f172a" strokeWidth="4.8" />
                  <ellipse cx="90" cy="134" rx="20" ry="12" fill="#d39b7c" stroke="#0f172a" strokeWidth="4.8" />
                </g>
              </svg>
            )}
          </div>
        </div>
      )}

      {/* ~0:14 - 0:15: MANGA PANEL 2 ("JUST THIS ONCE.") */}
      {isPanel2 && (
        <div
          data-testid="cutscene-panel-2"
          className="absolute inset-0 z-30 flex items-center justify-center bg-black p-2 sm:p-5 animate-manga-shake"
        >
          <div className="relative w-full h-full max-w-6xl max-h-[88vh] overflow-hidden bg-white border-[5px] sm:border-[7px] border-white shadow-[0_0_50px_rgba(255,255,255,0.45)]">
            {/* Heavy B&W Ink Hatch Speed-Lines */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox="0 0 1000 560"
              preserveAspectRatio="none"
            >
              {Array.from({ length: 76 }).map((_, idx) => {
                const isLeft = idx < 38;
                const y = (idx % 38) * 15;
                const x1 = isLeft ? 0 : 1000;
                const x2 = isLeft ? 150 + (idx % 6) * 42 : 850 - (idx % 6) * 42;
                return (
                  <line
                    key={idx}
                    x1={x1}
                    y1={y}
                    x2={x2}
                    y2={y + (isLeft ? -16 : 16)}
                    stroke="#09090b"
                    strokeWidth={idx % 3 === 0 ? 3.5 : idx % 2 === 0 ? 2 : 1.2}
                    strokeOpacity={0.88}
                  />
                );
              })}
              {/* Swirling ink motion arcs around head */}
              <path d="M110 75 Q360 14 550 112" fill="none" stroke="#09090b" strokeWidth="4" strokeDasharray="18 5 6 4" />
              <path d="M80 108 Q320 46 500 138" fill="none" stroke="#09090b" strokeWidth="2.6" strokeDasharray="12 5" />
            </svg>

            {/* P2 High-Contrast B&W Ink Bust Illustration (or custom portraitUrl if provided) */}
            {kit2.portraitUrl ? (
              <img
                src={kit2.portraitUrl}
                alt={cutscene.p2Name}
                className="absolute left-4 bottom-0 h-[94%] w-auto object-contain grayscale contrast-200 pointer-events-none z-10"
              />
            ) : (
              <svg
                viewBox="0 0 580 500"
                className="absolute left-0 sm:left-[5%] bottom-0 h-[96%] w-auto max-w-[68%] pointer-events-none z-10"
                aria-hidden="true"
              >
                {/* Ink Collar & Coat Shoulders */}
                <path
                  d="M65 500 L142 384 L215 368 L365 368 L442 384 L512 500 Z"
                  fill="#ffffff"
                  stroke="#09090b"
                  strokeWidth="7.5"
                  strokeLinejoin="round"
                />
                <path d="M195 372 L245 452 M368 372 L328 452" stroke="#09090b" strokeWidth="4.5" strokeLinecap="round" />
                {/* Angular Chin & Face Outline */}
                <path
                  d="M156 118 L166 286 L218 368 L270 398 L322 368 L374 286 L384 118 Z"
                  fill="#ffffff"
                  stroke="#09090b"
                  strokeWidth="6.5"
                  strokeLinejoin="round"
                />
                {/* Cheek & Nose Ink Hatching */}
                <path d="M174 294 L196 312 M170 304 L192 322 M344 312 L366 294 M348 322 L370 304" stroke="#09090b" strokeWidth="2.4" />
                <path d="M268 258 L262 288 L274 292" fill="none" stroke="#09090b" strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round" />
                {/* Dense Chaotic Ink Hair */}
                <path
                  d="M138 242 Q120 110 190 62 Q266 22 358 62 Q420 105 398 234 L374 176 L354 222 L328 156 L300 218 L276 144 L244 212 L218 158 L192 214 L162 178 Z"
                  fill="#09090b"
                  stroke="#09090b"
                  strokeWidth="4.5"
                  strokeLinejoin="round"
                />
                {/* Loose hairline ink strands falling over eyes */}
                <path d="M222 146 L204 238 M252 148 L244 242 M296 144 L286 244 M336 148 L328 232" stroke="#09090b" strokeWidth="4.5" strokeLinecap="round" />
                {/* Wide unsettling eyes + heavy under-eye ink hatching */}
                <path d="M188 220 Q222 206 254 222" fill="none" stroke="#09090b" strokeWidth="4" />
                <path d="M286 222 Q318 206 352 220" fill="none" stroke="#09090b" strokeWidth="4" />
                <ellipse cx="222" cy="242" rx="31" ry="18" fill="#ffffff" stroke="#09090b" strokeWidth="5.5" />
                <circle cx="224" cy="242" r="8.5" fill="#ffffff" stroke="#09090b" strokeWidth="4" />
                <circle cx="224" cy="242" r="2.6" fill="#09090b" />
                <ellipse cx="318" cy="242" rx="31" ry="18" fill="#ffffff" stroke="#09090b" strokeWidth="5.5" />
                <circle cx="316" cy="242" r="8.5" fill="#ffffff" stroke="#09090b" strokeWidth="4" />
                <circle cx="316" cy="242" r="2.6" fill="#09090b" />
                {/* Fine cross-hatching under eyes */}
                <path d="M192 266 L244 266 M196 273 L240 273 M204 280 L232 280" stroke="#09090b" strokeWidth="2" />
                <path d="M294 266 L346 266 M298 273 L342 273 M306 280 L334 280" stroke="#09090b" strokeWidth="2" />
                {/* Wide Unsettling Smile with Crisp Upper Teeth */}
                <path
                  d="M214 324 Q270 318 326 326 Q306 368 270 368 Q232 368 214 324 Z"
                  fill="#09090b"
                  stroke="#09090b"
                  strokeWidth="5"
                />
                <path d="M223 328 Q270 325 317 329 L312 341 Q270 340 228 341 Z" fill="#ffffff" />
                <path d="M250 327 L250 340 M270 326 L270 340 M290 327 L290 340" stroke="#09090b" strokeWidth="1.6" />
                {/* Raised Two-Finger Hand Pose */}
                <g transform="translate(342, 266)">
                  <path
                    d="M36 234 L22 142 L-16 68 Q-10 48 8 60 L48 116 L60 16 Q76 4 88 20 L92 110 L114 70 Q130 66 134 84 L116 154 L110 234 Z"
                    fill="#ffffff"
                    stroke="#09090b"
                    strokeWidth="6.5"
                    strokeLinejoin="round"
                  />
                  {/* Finger creases & knuckles */}
                  <path d="M52 136 Q72 130 92 142 M66 64 L82 64 M4 82 L18 76" fill="none" stroke="#09090b" strokeWidth="3" strokeLinecap="round" />
                </g>
              </svg>
            )}

            {/* Classic Oval Speech Bubble: JUST THIS ONCE. */}
            <div className="relative z-20 flex items-center justify-end h-full pr-6 sm:pr-14 pointer-events-none">
              <div className="relative bg-white border-[5px] border-slate-950 rounded-[999px] px-7 py-8 sm:px-12 sm:py-12 shadow-[6px_6px_0px_#09090b]">
                <div
                  className="font-manga-bubble text-slate-950 text-center uppercase leading-[1.15]"
                  style={{ fontSize: 'clamp(1.6rem, 4.4vw, 3.2rem)' }}
                >
                  <div>JUST</div>
                  <div>THIS</div>
                  <div>ONCE.</div>
                </div>
                {/* Seamless SVG speech bubble ink tail pointing toward character */}
                <svg
                  viewBox="0 0 60 54"
                  className="absolute -bottom-[26px] left-10 w-12 h-11 pointer-events-none overflow-visible"
                  aria-hidden="true"
                >
                  <path d="M 12 -4 L 4 46 L 44 6 Z" fill="#ffffff" />
                  <path d="M 14 2 L 4 46 L 42 8" fill="none" stroke="#09090b" strokeWidth="5.5" strokeLinejoin="round" />
                </svg>
              </div>
            </div>

            <div className="absolute bottom-3 left-4 z-20 inline-flex items-center gap-2 bg-slate-950 text-white border-2 border-white px-3 py-1 rounded text-xs sm:text-sm font-display font-bold uppercase tracking-widest">
              {cutscene.p2Name} · {kit2.awakenedTitle}
            </div>
          </div>
        </div>
      )}

      {/* ~0:15 - 0:18: TUG-OF-WAR CLASH BAR & MASH CONTROLS */}
      {isClashPhase && (
        <div
          data-testid="cutscene-clash-bar"
          className="absolute inset-0 z-30 flex flex-col justify-between py-[10vh] sm:py-20 px-3 sm:px-8 pointer-events-none"
        >
          {/* Top-Center Tug-of-War Clash Bar */}
          <div className="w-full max-w-2xl mx-auto">
            <div className="bg-slate-950/90 border-2 border-amber-400/80 rounded-2xl p-2.5 sm:p-3.5 shadow-[0_0_32px_rgba(250,204,21,0.35)]">
              <div className="flex items-center justify-between gap-2 text-xs sm:text-sm font-display font-bold uppercase tracking-wide mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: p1Color }}
                  />
                  <span className="text-white truncate">{cutscene.p1Name}</span>
                  <span className="font-manga text-base sm:text-lg text-amber-300 shrink-0">
                    x{cutscene.p1Taps}!
                  </span>
                  {cutscene.p1Overdrive > 1.02 && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-400 text-slate-950 text-[10px] font-mono-num font-black">
                      {cutscene.p1Overdrive.toFixed(1)}x OD
                    </span>
                  )}
                </div>

                <span className="font-manga text-amber-400 text-sm sm:text-base tracking-widest shrink-0">
                  AWAKENING CLASH
                </span>

                <div className="flex items-center gap-2 min-w-0 justify-end">
                  {cutscene.p2Overdrive > 1.02 && (
                    <span className="px-1.5 py-0.5 rounded bg-rose-400 text-slate-950 text-[10px] font-mono-num font-black">
                      {cutscene.p2Overdrive.toFixed(1)}x OD
                    </span>
                  )}
                  <span className="font-manga text-base sm:text-lg text-amber-300 shrink-0">
                    x{cutscene.p2Taps}!
                  </span>
                  <span className="text-white truncate">{cutscene.p2Name}</span>
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: p2Color }}
                  />
                </div>
              </div>

              {/* Dual Push Bar */}
              <div className="relative h-6 sm:h-7 rounded-full overflow-hidden bg-slate-900 border-2 border-white/80 flex">
                <div
                  className="h-full transition-all duration-75"
                  style={{
                    width: `${p1SharePct}%`,
                    background: `linear-gradient(90deg, ${p1Color}, #fef08a)`,
                  }}
                />
                <div
                  className="h-full transition-all duration-75"
                  style={{
                    width: `${p2SharePct}%`,
                    background: `linear-gradient(90deg, #fda4af, ${p2Color})`,
                  }}
                />
                {/* Center Clash Spark Divider */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-9 bg-white border-2 border-slate-950 rounded-sm shadow-[0_0_16px_#ffffff] rotate-12"
                  style={{ left: `${p1SharePct}%` }}
                />
              </div>
            </div>
          </div>

          {/* Bottom Interactive Mash Button (Desktop & Mobile) */}
          <div className="flex flex-col items-center gap-2 pointer-events-auto">
            {isParticipant ? (
              <button
                type="button"
                data-testid="clash-mash-btn"
                onPointerDown={(e) => {
                  e.preventDefault();
                  onMash();
                }}
                className="animate-clash-mash px-8 py-3.5 sm:px-10 sm:py-4 rounded-2xl bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 border-4 border-white text-slate-950 font-manga text-2xl sm:text-3xl tracking-widest shadow-[0_0_32px_rgba(250,204,21,0.8)] active:scale-95 transition-transform cursor-pointer"
              >
                MASH!{' '}
                <span className="hidden sm:inline font-display text-sm font-black bg-slate-950 text-amber-300 px-2 py-0.5 rounded ml-1.5 align-middle">
                  {amP1 ? 'SPACE' : 'ENTER'}
                </span>
              </button>
            ) : (
              <div className="px-5 py-2 rounded-xl bg-slate-950/85 border border-white/30 text-white font-display font-bold text-xs uppercase tracking-widest">
                Spectating Awakening Clash...
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hold-to-Skip Button (1.0s hold) */}
      {AWAKENING_CONFIG.ALLOW_SKIP && onSkip && !cutscene.resolved && (
        <button
          type="button"
          data-testid="cutscene-skip-btn"
          onPointerDown={beginSkipHold}
          onPointerUp={cancelSkipHold}
          onPointerLeave={cancelSkipHold}
          onPointerCancel={cancelSkipHold}
          className="fixed top-4 right-4 z-50 overflow-hidden rounded-xl bg-slate-950/85 border-2 border-white/60 px-3.5 py-2 text-xs font-display font-bold uppercase tracking-wider text-white shadow-lg cursor-pointer"
        >
          <div
            className="absolute inset-0 bg-amber-400/50 transition-none pointer-events-none"
            style={{ width: `${Math.round(skipProgress * 100)}%` }}
          />
          <span className="relative z-10">Hold to Skip</span>
        </button>
      )}
    </div>
  );
};
