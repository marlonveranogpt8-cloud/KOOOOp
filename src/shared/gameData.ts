export type FighterId = 'marjohn' | 'prime' | 'damen' | 'khen' | 'jm';
export type SkinId = 'ascended' | 'classic' | 'special';
export type MapId = 'shibuya' | 'meadow' | 'temple' | 'obsidian';
export type DamagePhase = 'NORMAL' | 'DAMAGED' | 'SEVERELY DAMAGED' | 'CRITICAL' | 'DEFEATED';
export type AbilitySlot = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type RoomPhase = 'lobby' | 'countdown' | 'combat' | 'roundEnd' | 'victory';
export type MatchAwakeningPhase = 'PRE_AWAKENING' | 'ORBS_ACTIVE' | 'CUTSCENE' | 'AWAKENED_DUEL';
export type CombatMoveType = 'strike' | 'grab' | 'parry';
export type ActorActionState =
  | 'idle'
  | 'move'
  | 'jump'
  | 'attack'
  | 'grab'
  | 'headlock'
  | 'guard'
  | 'dash'
  | 'skill'
  | 'ultimate'
  | 'whiff'
  | 'clash'
  | 'stagger'
  | 'ko';
export type EliminationStyle = 'collapse' | 'launch' | 'shatter' | 'dissolve';
export type KoCause = 'normal' | 'parry' | 'combo' | 'ultimate' | 'clash' | 'grab' | 'ring';
export type BattlefieldEventKind = 'frenzy' | 'gravity' | 'hazard' | 'surge';

export type AbilityAimKind = 'none' | 'point' | 'line' | 'cone';
export type AimKind = AbilityAimKind;
export type ArenaZoneKind =
  | 'galeSnare'
  | 'moltenFissure'
  | 'solarTripwire'
  | 'voidAnchor'
  | 'voidDecoy'
  | 'solarSanctuary'
  | 'maelstromTornado'
  | 'cat5Typhoon'
  | 'magmaBranch'
  | 'shadowRift'
  | 'divineNova';
export type TelegraphKind = 'circle' | 'line' | 'cone';

export interface AbilitySpec {
  slot: AbilitySlot;
  name: string;
  role: 'Attack' | 'Guard' | 'Dash' | 'Skill' | 'Ultimate' | 'Awakening';
  shortDesc: string;
  cooldown: number; // seconds
  manaCost: number; // Chi cost
  staminaCost: number; // Tactical Stamina cost
  duration: number; // seconds
  windup: number; // seconds before hit triggers
  whiffRecovery: number; // extra vulnerability duration if missed
  damage: number;
  staggerDamage: number;
  range: number;
  arcCos: number; // dot product threshold for directional hit (-1 = 360°)
  knockback: number;
  keyHint: string;
  aimKind?: AbilityAimKind;
  aimRange?: number;
  aimRadius?: number;
  stage2Label?: string;
  holdAimLabel?: string;
  actionTag?: string;
}

export interface PassiveSpec {
  name: string;
  shortDesc: string;
  frenzyBonus: string;
}

export interface M1ComboSpec {
  stepNames: string[];
  heavyFinisherName: string;
  aerialName?: string;
  rangeIdentity: 'Close Brawler' | 'Mid Duelist' | 'Long Marksman' | 'Blink Assassin' | 'Counter Striker';
}

export interface ComboLinkSpec {
  triggerName: string;
  hint: string;
  bonusDamage: number;
  bonusStagger: number;
}

export interface FighterSpec {
  id: FighterId;
  name: string;
  title: string;
  role: string;
  color: string;
  hex: number;
  moveSpeed: number;
  maxHp: number;
  maxMana: number;
  maxStamina: number;
  stats: {
    power: number; // 1-10
    speed: number; // 1-10
    defense: number; // 1-10
  };
  koStyle: EliminationStyle;
  passive: PassiveSpec;
  m1Combo: M1ComboSpec;
  comboLink: ComboLinkSpec;
  abilities: [AbilitySpec, AbilitySpec, AbilitySpec, AbilitySpec, AbilitySpec];
}

export interface MapObstacle {
  id: string;
  kind: 'building' | 'pillar' | 'bridge' | 'wall' | 'platform';
  x: number;
  z: number;
  halfW: number;
  halfD: number;
  topY: number;
  colorHex: number;
  roofColorHex: number;
  destructible?: boolean;
  maxHp?: number;
}

export interface ObstacleState extends MapObstacle {
  hp: number;
  maxHp: number;
  destroyed: boolean;
}

export interface PickupSpawn {
  id: string;
  kind: 'health' | 'mana';
  x: number;
  z: number;
}

export interface MapSpec {
  id: MapId;
  name: string;
  subtitle: string;
  accentColor: string;
  skyHex: number;
  fogHex: number;
  arenaRadius: number;
  description: string;
}

export const FIGHTERS: FighterSpec[] = [
  {
    id: 'marjohn',
    name: 'MARJOHN',
    title: 'Azure Wind',
    role: 'Wind Staff Duelist',
    color: '#38bdf8',
    hex: 0x38bdf8,
    moveSpeed: 7,
    maxHp: 124,
    maxMana: 100,
    maxStamina: 100,
    stats: { power: 7, speed: 7, defense: 7 },
    koStyle: 'collapse',
    passive: {
      name: 'Gale Drift',
      shortDesc: 'Faster strafe speed, agile mid-air steering, and slower falling while spacing tornadoes.',
      frenzyBonus: 'Doubles Tailwind stack rate inside Frenzy Zones.',
    },
    m1Combo: {
      stepNames: ['Tornado Poke'],
      heavyFinisherName: 'Tornado Poke',
      rangeIdentity: 'Mid Duelist',
    },
    comboLink: {
      triggerName: 'GALE TYPHOON LINK',
      hint: 'Cloud Vault (1) → Cyclone Vortex (2)',
      bonusDamage: 12,
      bonusStagger: 20,
    },
    abilities: [
      {
        slot: 0,
        name: 'Tornado Poke',
        role: 'Attack',
        shortDesc: 'Fires a steady mid-range mini-tornado every 0.9s. Hold-Drag M1 to swipe-aim!',
        cooldown: 0.9,
        manaCost: 0,
        staminaCost: 8,
        duration: 0.24,
        windup: 0.08,
        whiffRecovery: 0.22,
        damage: 12,
        staggerDamage: 15,
        range: 7.6,
        arcCos: 0.5,
        knockback: 4.5,
        keyHint: 'M1',
      },
      {
        slot: 1,
        name: 'Zephyr Parry',
        role: 'Guard',
        shortDesc: 'Parry beats Strikes (0.26s window) for +28 Chi & Stamina. Weak to Grab!',
        cooldown: 1.2,
        manaCost: 0,
        staminaCost: 12,
        duration: 0.58,
        windup: 0.0,
        whiffRecovery: 0.2,
        damage: 0,
        staggerDamage: 0,
        range: 2.8,
        arcCos: -1,
        knockback: 7.5,
        keyHint: 'F',
      },
      {
        slot: 2,
        name: 'Cloud Vault',
        role: 'Skill',
        shortDesc: 'Vault skyward and slam down with a cyclone shockwave. Hold-Drag to aim landing!',
        cooldown: 5.5,
        manaCost: 20,
        staminaCost: 18,
        duration: 0.46,
        windup: 0.26,
        whiffRecovery: 0.42,
        damage: 17,
        staggerDamage: 24,
        range: 3.8,
        arcCos: -1,
        knockback: 8.5,
        keyHint: '1',
        aimKind: 'point',
        aimRange: 8.5,
        aimRadius: 3.4,
        holdAimLabel: 'Vault Slam',
        actionTag: 'Vault · Wind Slam',
      },
      {
        slot: 3,
        name: 'Cyclone Vortex',
        role: 'Skill',
        shortDesc: 'Tap: 360° vortex. Hold-Drag: Plant Gale Snare Trap -> Stage 2 Skyburst Launch!',
        cooldown: 5.8,
        manaCost: 26,
        staminaCost: 20,
        duration: 0.52,
        windup: 0.3,
        whiffRecovery: 0.52,
        damage: 20,
        staggerDamage: 28,
        range: 4.6,
        arcCos: -1,
        knockback: 9.0,
        keyHint: '2',
        aimKind: 'point',
        aimRange: 9.5,
        aimRadius: 3.4,
        stage2Label: 'SKYBURST',
        holdAimLabel: 'Gale Snare',
        actionTag: '360° Pull · Trap',
      },
      {
        slot: 4,
        name: 'Tempest Typhoon',
        role: 'Ultimate',
        shortDesc: 'Hold-Drag aims telegraphed storm funnel before wind-shear typhoon. Clash-able!',
        cooldown: 12.0,
        manaCost: 58,
        staminaCost: 28,
        duration: 0.78,
        windup: 0.46,
        whiffRecovery: 0.65,
        damage: 34,
        staggerDamage: 46,
        range: 5.6,
        arcCos: -1,
        knockback: 14.5,
        keyHint: '3',
        aimKind: 'point',
        aimRange: 8.5,
        aimRadius: 4.8,
        holdAimLabel: 'Storm Eye',
        actionTag: 'Storm Funnel · AoE',
      },
    ],
  },
  {
    id: 'prime',
    name: 'PRIME',
    title: 'Crimson Blaze',
    role: 'Heavy Brawler',
    color: '#f43f5e',
    hex: 0xf43f5e,
    moveSpeed: 10,
    maxHp: 138,
    maxMana: 100,
    maxStamina: 100,
    stats: { power: 10, speed: 10, defense: 9 },
    koStyle: 'launch',
    passive: {
      name: 'Juggernaut Armor',
      shortDesc: 'Super Armor during 4th-hit Ground Slam wind-up + 15% reduced knockback taken.',
      frenzyBonus: 'Gains armored flame pulse inside Frenzy Zones.',
    },
    m1Combo: {
      stepNames: ['Heavy Punch', 'Heavy Cross', 'Magma Hook', 'Ground Slam'],
      heavyFinisherName: 'AoE Ground Slam',
      rangeIdentity: 'Close Brawler',
    },
    comboLink: {
      triggerName: 'METEOR DETONATION',
      hint: 'Crater Slam (2) → Meteor Charge (1)',
      bonusDamage: 12,
      bonusStagger: 22,
    },
    abilities: [
      {
        slot: 0,
        name: 'Juggernaut 4-Hit',
        role: 'Attack',
        shortDesc: 'Fast 0.42s melee rush: 3 Heavy Punches into an armored AoE Ground Slam shockwave.',
        cooldown: 0.42,
        manaCost: 0,
        staminaCost: 8,
        duration: 0.22,
        windup: 0.06,
        whiffRecovery: 0.22,
        damage: 11,
        staggerDamage: 15,
        range: 3.25,
        arcCos: 0.2,
        knockback: 4.8,
        keyHint: 'M1',
      },
      {
        slot: 1,
        name: 'Iron Guard',
        role: 'Guard',
        shortDesc: 'Braced crimson guard & 0.26s Parry counter. Weak to Grab!',
        cooldown: 1.3,
        manaCost: 0,
        staminaCost: 12,
        duration: 0.6,
        windup: 0.0,
        whiffRecovery: 0.22,
        damage: 0,
        staggerDamage: 0,
        range: 2.7,
        arcCos: -1,
        knockback: 6.8,
        keyHint: 'F',
      },
      {
        slot: 2,
        name: 'Meteor Charge',
        role: 'Skill',
        shortDesc: 'Blazing bull-rush shoulder tackle. Crossing Molten Fissure triggers Steam Blast!',
        cooldown: 5.5,
        manaCost: 20,
        staminaCost: 18,
        duration: 0.52,
        windup: 0.24,
        whiffRecovery: 0.4,
        damage: 20,
        staggerDamage: 28,
        range: 3.2,
        arcCos: 0.2,
        knockback: 10.8,
        keyHint: '1',
        aimKind: 'line',
        aimRange: 7.8,
        aimRadius: 2.2,
        holdAimLabel: 'Charge Lane',
        actionTag: 'Blaze · Bull Rush',
      },
      {
        slot: 3,
        name: 'Crater Slam',
        role: 'Skill',
        shortDesc: 'Stage 1: Magma Uppercut. Stage 2 / Hold-Drag: Aimed Slam leaving Molten Fissure!',
        cooldown: 6.0,
        manaCost: 24,
        staminaCost: 20,
        duration: 0.56,
        windup: 0.26,
        whiffRecovery: 0.6,
        damage: 21,
        staggerDamage: 28,
        range: 4.8,
        arcCos: -1,
        knockback: 10.2,
        keyHint: '2',
        aimKind: 'point',
        aimRange: 8.2,
        aimRadius: 3.8,
        stage2Label: 'SLAM',
        holdAimLabel: 'Molten Pool',
        actionTag: 'Leap · Lava Zone',
      },
      {
        slot: 4,
        name: 'Avalanche Blow',
        role: 'Ultimate',
        shortDesc: 'Hold-Drag aims telegraphed Meteor Impact circle before crushing down!',
        cooldown: 13.0,
        manaCost: 56,
        staminaCost: 28,
        duration: 0.82,
        windup: 0.46,
        whiffRecovery: 0.72,
        damage: 35,
        staggerDamage: 46,
        range: 4.8,
        arcCos: -1,
        knockback: 16.5,
        keyHint: '3',
        aimKind: 'point',
        aimRange: 7.8,
        aimRadius: 4.4,
        holdAimLabel: 'Meteor Zone',
        actionTag: 'Meteor · Impact',
      },
    ],
  },
  {
    id: 'damen',
    name: 'DAMEN',
    title: 'Golden Outlaw',
    role: 'Gunslinger & Shield',
    color: '#f59e0b',
    hex: 0xf59e0b,
    moveSpeed: 7,
    maxHp: 134,
    maxMana: 100,
    maxStamina: 100,
    stats: { power: 9, speed: 7, defense: 8 },
    koStyle: 'shatter',
    passive: {
      name: 'Quick-Draw Step',
      shortDesc: 'Gun hits grant 1.5s speed boost and reduce Dash cooldown by 0.5s.',
      frenzyBonus: 'Shotgun & Deadeye crits gain extra range inside Frenzy Zones.',
    },
    m1Combo: {
      stepNames: ['Quickdraw Shot'],
      heavyFinisherName: 'Quickdraw Shot',
      rangeIdentity: 'Mid Duelist',
    },
    comboLink: {
      triggerName: 'BOUNTY EXECUTE',
      hint: 'Solar Lasso (2) → Outlaw Roll (1)',
      bonusDamage: 16,
      bonusStagger: 26,
    },
    abilities: [
      {
        slot: 0,
        name: 'Outlaw Revolver',
        role: 'Attack',
        shortDesc: 'Measured mid-range revolver shot (max ~10m, 0.8s CD). Hold-Drag M1 to swipe-aim!',
        cooldown: 0.8,
        manaCost: 0,
        staminaCost: 8,
        duration: 0.26,
        windup: 0.08,
        whiffRecovery: 0.24,
        damage: 14,
        staggerDamage: 16,
        range: 10.2,
        arcCos: 0.85,
        knockback: 3.8,
        keyHint: 'M1',
      },
      {
        slot: 1,
        name: 'Golden Aegis',
        role: 'Guard',
        shortDesc: 'Hold golden shield or time 0.26s Parry. Weak to Grab!',
        cooldown: 1.2,
        manaCost: 0,
        staminaCost: 11,
        duration: 0.65,
        windup: 0.0,
        whiffRecovery: 0.2,
        damage: 0,
        staggerDamage: 0,
        range: 2.8,
        arcCos: -1,
        knockback: 7.2,
        keyHint: 'F',
      },
      {
        slot: 2,
        name: 'Outlaw Roll',
        role: 'Skill',
        shortDesc: 'Crisp evasive roll into a wide 3-round Deadeye Fan Shot. Hold-Drag to aim!',
        cooldown: 4.8,
        manaCost: 18,
        staminaCost: 14,
        duration: 0.42,
        windup: 0.2,
        whiffRecovery: 0.3,
        damage: 22,
        staggerDamage: 26,
        range: 11.8,
        arcCos: 0.72,
        knockback: 7.8,
        keyHint: '1',
        aimKind: 'line',
        aimRange: 11.0,
        aimRadius: 2.1,
        holdAimLabel: 'Deadeye Shot',
        actionTag: 'Roll · Deadeye Shot',
      },
      {
        slot: 3,
        name: 'Solar Lasso',
        role: 'Skill',
        shortDesc: 'Tap: Fast wide-snare pull lasso. Hold-Drag: Plant wide electrified Solar Tripwire!',
        cooldown: 4.6,
        manaCost: 22,
        staminaCost: 16,
        duration: 0.42,
        windup: 0.18,
        whiffRecovery: 0.36,
        damage: 24,
        staggerDamage: 30,
        range: 14.0,
        arcCos: 0.78,
        knockback: -11.5,
        keyHint: '2',
        aimKind: 'point',
        aimRange: 12.0,
        aimRadius: 3.2,
        holdAimLabel: 'Tripwire',
        actionTag: 'Pull · Tripwire',
      },
      {
        slot: 4,
        name: 'High Noon Fan',
        role: 'Ultimate',
        shortDesc: 'Quick-lock wide 7-shot High Noon barrage cone. Hold-Drag to sweep target zone!',
        cooldown: 10.2,
        manaCost: 50,
        staminaCost: 22,
        duration: 0.62,
        windup: 0.3,
        whiffRecovery: 0.48,
        damage: 21,
        staggerDamage: 24,
        range: 15.0,
        arcCos: 0.45,
        knockback: 10.5,
        keyHint: '3',
        aimKind: 'cone',
        aimRange: 14.5,
        aimRadius: 0.46,
        holdAimLabel: 'Noon Cone',
        actionTag: 'Cone Barrage · AoE',
      },
    ],
  },
  {
    id: 'khen',
    name: 'KHEN',
    title: 'Arcane Violet',
    role: 'Void Assassin',
    color: '#a855f7',
    hex: 0xa855f7,
    moveSpeed: 9,
    maxHp: 116,
    maxMana: 100,
    maxStamina: 100,
    stats: { power: 8, speed: 9, defense: 6 },
    koStyle: 'dissolve',
    passive: {
      name: 'Shadow Backstab',
      shortDesc: '+20% bonus damage from behind; 4th-hit Dash Lunge grants a burst of speed.',
      frenzyBonus: 'Void skill cooldowns tick 25% faster during Frenzy.',
    },
    m1Combo: {
      stepNames: ['Dagger Slash', 'Twin Rend', 'Rift Slice', 'Dash Lunge'],
      heavyFinisherName: 'Void Dash Lunge',
      rangeIdentity: 'Blink Assassin',
    },
    comboLink: {
      triggerName: 'VOID MIRAGE LINK',
      hint: 'Shadow Blink (1) → Crescent Wave (2)',
      bonusDamage: 13,
      bonusStagger: 22,
    },
    abilities: [
      {
        slot: 0,
        name: 'Void 4-Hit Daggers',
        role: 'Attack',
        shortDesc: 'Fast 0.42s per hit: 3 Dagger Slashes into a Damaging Dash Lunge that slices through.',
        cooldown: 0.42,
        manaCost: 0,
        staminaCost: 7,
        duration: 0.22,
        windup: 0.06,
        whiffRecovery: 0.2,
        damage: 9,
        staggerDamage: 13,
        range: 3.15,
        arcCos: 0.2,
        knockback: 3.6,
        keyHint: 'M1',
      },
      {
        slot: 1,
        name: 'Arcane X-Parry',
        role: 'Guard',
        shortDesc: 'Cross-dagger guard & 0.26s Parry counter. Weak to Grab!',
        cooldown: 1.2,
        manaCost: 0,
        staminaCost: 12,
        duration: 0.56,
        windup: 0.0,
        whiffRecovery: 0.2,
        damage: 0,
        staggerDamage: 0,
        range: 2.7,
        arcCos: -1,
        knockback: 8.5,
        keyHint: 'F',
      },
      {
        slot: 2,
        name: 'Shadow Blink',
        role: 'Skill',
        shortDesc: 'Void warp leaving an explosive Void Decoy and slicing arrival point. Hold-Drag aims!',
        cooldown: 5.5,
        manaCost: 20,
        staminaCost: 16,
        duration: 0.46,
        windup: 0.28,
        whiffRecovery: 0.36,
        damage: 16,
        staggerDamage: 22,
        range: 3.2,
        arcCos: -1,
        knockback: 7.0,
        keyHint: '1',
        aimKind: 'point',
        aimRange: 8.5,
        aimRadius: 2.8,
        holdAimLabel: 'Void Warp',
        actionTag: 'Warp · Void Decoy',
      },
      {
        slot: 3,
        name: 'Crescent Wave',
        role: 'Skill',
        shortDesc: 'Stage 1: Fires blade leaving Void Anchor. Stage 2: Shadow Swap! Hold-Drag: Silence Trap.',
        cooldown: 5.4,
        manaCost: 26,
        staminaCost: 18,
        duration: 0.48,
        windup: 0.28,
        whiffRecovery: 0.48,
        damage: 20,
        staggerDamage: 24,
        range: 13.5,
        arcCos: 0.8,
        knockback: 6.5,
        keyHint: '2',
        aimKind: 'point',
        aimRange: 11.5,
        aimRadius: 2.8,
        stage2Label: 'SWAP',
        holdAimLabel: 'Void Trap',
        actionTag: 'Blade · Void Swap',
      },
      {
        slot: 4,
        name: 'Phantom Blitz',
        role: 'Ultimate',
        shortDesc: 'Hold-Drag aims telegraphed Void X-Corridor before high-speed void flurry!',
        cooldown: 11.5,
        manaCost: 58,
        staminaCost: 28,
        duration: 0.78,
        windup: 0.42,
        whiffRecovery: 0.65,
        damage: 36,
        staggerDamage: 48,
        range: 9.5,
        arcCos: 0.1,
        knockback: 12.5,
        keyHint: '3',
        aimKind: 'line',
        aimRange: 9.5,
        aimRadius: 2.2,
        holdAimLabel: 'Void Lane',
        actionTag: 'Void Corridor · Slash',
      },
    ],
  },
  {
    id: 'jm',
    name: 'JM',
    title: 'Golden Sovereign',
    role: 'Solar Martial Artist',
    color: '#facc15',
    hex: 0xfacc15,
    moveSpeed: 9,
    maxHp: 126,
    maxMana: 100,
    maxStamina: 100,
    stats: { power: 9, speed: 9, defense: 7 },
    koStyle: 'collapse',
    passive: {
      name: 'Sky Flight',
      shortDesc: 'Press E to toggle Sky Flight up to 7s (10s CD). Aim skills down & fire golden bolts!',
      frenzyBonus: 'Auto-regenerates 3 HP/sec below 40% HP inside Frenzy Zones.',
    },
    m1Combo: {
      stepNames: ['Solar Strike', 'Cross Kick', 'Mini Kamehameha', 'Dash Launch'],
      heavyFinisherName: 'High-Speed Dash Punch',
      aerialName: 'Solar Air Bolt',
      rangeIdentity: 'Counter Striker',
    },
    comboLink: {
      triggerName: 'SOVEREIGN METEOR',
      hint: 'Flash Step (1) → Heel Drop (2)',
      bonusDamage: 14,
      bonusStagger: 28,
    },
    abilities: [
      {
        slot: 0,
        name: 'Sovereign 4-Hit',
        role: 'Attack',
        shortDesc: 'Fast 0.42s melee: Strike -> Kick -> Mini Beam -> Dash Punch! Air M1 fires golden bolts.',
        cooldown: 0.42,
        manaCost: 0,
        staminaCost: 7,
        duration: 0.22,
        windup: 0.06,
        whiffRecovery: 0.22,
        damage: 10,
        staggerDamage: 14,
        range: 3.35,
        arcCos: 0.2,
        knockback: 4.5,
        keyHint: 'M1',
      },
      {
        slot: 1,
        name: 'Dragon Counter',
        role: 'Guard',
        shortDesc: '0.26s Parry counters attackers with uppercut DMG & Counter-Flow!',
        cooldown: 1.2,
        manaCost: 0,
        staminaCost: 12,
        duration: 0.6,
        windup: 0.0,
        whiffRecovery: 0.2,
        damage: 12,
        staggerDamage: 24,
        range: 3.1,
        arcCos: -1,
        knockback: 9.5,
        keyHint: 'F',
      },
      {
        slot: 2,
        name: 'Flash Step',
        role: 'Skill',
        shortDesc: 'High-speed golden afterimage palm burst through foes. Hold-Drag aims corridor!',
        cooldown: 5.5,
        manaCost: 20,
        staminaCost: 18,
        duration: 0.46,
        windup: 0.28,
        whiffRecovery: 0.38,
        damage: 17,
        staggerDamage: 24,
        range: 7.5,
        arcCos: 0.2,
        knockback: 8.5,
        keyHint: '1',
        aimKind: 'line',
        aimRange: 7.5,
        aimRadius: 2.2,
        holdAimLabel: 'Flash Lane',
        actionTag: 'Blink · Solar Palm',
      },
      {
        slot: 3,
        name: 'Heel Drop',
        role: 'Skill',
        shortDesc: 'Tap: Radial burst slam. Hold-Drag: Plant Solar Sanctuary Ward that repulses rushers!',
        cooldown: 5.5,
        manaCost: 26,
        staminaCost: 20,
        duration: 0.54,
        windup: 0.28,
        whiffRecovery: 0.54,
        damage: 23,
        staggerDamage: 30,
        range: 4.4,
        arcCos: -1,
        knockback: 11.5,
        keyHint: '2',
        aimKind: 'point',
        aimRange: 8.5,
        aimRadius: 3.5,
        holdAimLabel: 'Sanctuary',
        actionTag: 'Slam · Solar Ward',
      },
      {
        slot: 4,
        name: 'Solar Dragon Beam',
        role: 'Ultimate',
        shortDesc: 'Hold-Drag aims telegraphed golden beam corridor before firing twin-spiral beam!',
        cooldown: 12.5,
        manaCost: 58,
        staminaCost: 30,
        duration: 0.94,
        windup: 0.46,
        whiffRecovery: 0.72,
        damage: 38,
        staggerDamage: 46,
        range: 16.0,
        arcCos: 0.75,
        knockback: 15.5,
        keyHint: '3',
        aimKind: 'line',
        aimRange: 14.5,
        aimRadius: 2.3,
        holdAimLabel: 'Beam Lane',
        actionTag: 'Golden Beam · Line',
      },
    ],
  },
];

export const JM_SECRET_ABILITY: AbilitySpec = {
  slot: 5,
  name: 'Solar Meteor',
  role: 'Ultimate',
  shortDesc: 'Ascend into the sky, charge a giant yellow fireball, aim the blast zone & rain detonation!',
  cooldown: 16.0,
  manaCost: 48,
  staminaCost: 22,
  duration: 1.65,
  windup: 1.28,
  whiffRecovery: 0.6,
  damage: 44,
  staggerDamage: 58,
  range: 6.2,
  arcCos: -1,
  knockback: 17.5,
  keyHint: 'O / 6',
  aimKind: 'point',
  aimRange: 17.5,
  aimRadius: 6.2,
  holdAimLabel: 'Solar Meteor',
  actionTag: 'Sky Meteor · Aim',
};

export function isJtinsullenTag(name: string | undefined | null): boolean {
  return (name ?? '').trim().toLowerCase() === 'jtinsullen';
}

export const FIGHTER_BY_ID: Record<FighterId, FighterSpec> = Object.fromEntries(
  FIGHTERS.map((f) => [f.id, f])
) as Record<FighterId, FighterSpec>;

export interface FighterSkinMeta {
  id: SkinId;
  name: string;
  tierLabel: string;
  tagline: string;
  accentColor: string;
}

export const SKIN_ORDER: SkinId[] = ['ascended', 'classic', 'special'];

export const SKIN_LABELS: Record<SkinId, string> = {
  ascended: '★ ASCENDED',
  classic: 'CLASSIC',
  special: 'SPECIAL',
};

export const FIGHTER_SKINS: Record<FighterId, Record<SkinId, FighterSkinMeta>> = {
  jm: {
    ascended: {
      id: 'ascended',
      name: 'Seraphim Sovereign',
      tierLabel: '★ ASCENDED',
      tagline: 'White & gold celestial armor, orbiting halo & feathered energy wings',
      accentColor: '#fde047',
    },
    classic: {
      id: 'classic',
      name: 'Classic',
      tierLabel: 'CLASSIC',
      tagline: 'Original Golden Sovereign martial gi',
      accentColor: '#facc15',
    },
    special: {
      id: 'special',
      name: 'Golden Monarch',
      tierLabel: 'SPECIAL',
      tagline: 'Shadow-gold hunter trench coat, dark anime hair & radiant gold aura',
      accentColor: '#eab308',
    },
  },
  prime: {
    ascended: {
      id: 'ascended',
      name: 'Crimson Juggernaut',
      tierLabel: '★ ASCENDED',
      tagline: 'Heavy magma-cracked crimson gauntlets, spiked pauldrons & chest core',
      accentColor: '#fb7185',
    },
    classic: {
      id: 'classic',
      name: 'Classic',
      tierLabel: 'CLASSIC',
      tagline: 'Original Crimson Blaze brawler tank & gauntlets',
      accentColor: '#f43f5e',
    },
    special: {
      id: 'special',
      name: 'Sad Boi Emo',
      tierLabel: 'SPECIAL',
      tagline: 'Oversized dark hoodie, swept bangs over one eye & falling teardrops',
      accentColor: '#60a5fa',
    },
  },
  marjohn: {
    ascended: {
      id: 'ascended',
      name: 'Tempest Ronin',
      tierLabel: '★ ASCENDED',
      tagline: 'Navy & cyan wind-gi, billowing scarf, glowing staff & orbiting wind ring',
      accentColor: '#38bdf8',
    },
    classic: {
      id: 'classic',
      name: 'Classic',
      tierLabel: 'CLASSIC',
      tagline: 'Original Azure Wind martial robe & jade staff',
      accentColor: '#0ea5e9',
    },
    special: {
      id: 'special',
      name: 'Street Beggar',
      tierLabel: 'SPECIAL',
      tagline: 'Tattered patched clothes, worn shorts & tin begging cup in hand',
      accentColor: '#a3a3a3',
    },
  },
  damen: {
    ascended: {
      id: 'ascended',
      name: 'Solar Outlaw',
      tierLabel: '★ ASCENDED',
      tagline: 'Wide-brimmed hat, swaying high-collar duster coat & dual amber revolvers',
      accentColor: '#fbbf24',
    },
    classic: {
      id: 'classic',
      name: 'Classic',
      tierLabel: 'CLASSIC',
      tagline: 'Original Golden Outlaw trench & desert shield',
      accentColor: '#f59e0b',
    },
    special: {
      id: 'special',
      name: 'Obsidian Emo',
      tierLabel: 'SPECIAL',
      tagline: 'Jet-black skin, all-black chained streetwear & crimson glowing eyes',
      accentColor: '#ef4444',
    },
  },
  khen: {
    ascended: {
      id: 'ascended',
      name: 'Void Phantom',
      tierLabel: '★ ASCENDED',
      tagline: 'Hooded violet cloak, neon visor, jagged mantle & orbiting void shards',
      accentColor: '#c084fc',
    },
    classic: {
      id: 'classic',
      name: 'Classic',
      tierLabel: 'CLASSIC',
      tagline: 'Original Arcane Violet assassin garb & dual daggers',
      accentColor: '#a855f7',
    },
    special: {
      id: 'special',
      name: 'JM & Khen Duo',
      tierLabel: 'SPECIAL',
      tagline: 'Casual JM paired with loyal floppy-eared companion dog Khen at his side',
      accentColor: '#e879f9',
    },
  },
};

export function getFighterSkinMeta(fighterId: FighterId, skinId?: SkinId): FighterSkinMeta {
  const safeSkin: SkinId = skinId && SKIN_ORDER.includes(skinId) ? skinId : 'ascended';
  return FIGHTER_SKINS[fighterId][safeSkin];
}

export const MAPS: MapSpec[] = [
  {
    id: 'shibuya',
    name: 'Shibuya Scramble',
    subtitle: 'Urban Crosswalk · Destructible Storefronts',
    accentColor: '#2563eb',
    skyHex: 0xdbeafe,
    fogHex: 0xe2e8f0,
    arenaRadius: 38.0,
    description: 'Sunlit Shibuya scramble crosswalk flanked by destructible corner storefronts, kiosks, transit shelters, and glowing urban signage.',
  },
  {
    id: 'meadow',
    name: 'Golden Meadow',
    subtitle: 'Grand Inlaid Courtyard · Destructible Ruins',
    accentColor: '#facc15',
    skyHex: 0x7dd3fc,
    fogHex: 0xcbe7fb,
    arenaRadius: 38.0,
    description: 'Massive stone-and-gold courtyard framed by crumbling stone ruins, flaming braziers, perimeter colonnades, river moat, and cypress ridges.',
  },
  {
    id: 'temple',
    name: 'Sunset Temple Courtyard',
    subtitle: 'Grand Crimson Arena · Destructible Shrines',
    accentColor: '#fb923c',
    skyHex: 0x3b1d36,
    fogHex: 0x5c243a,
    arenaRadius: 38.0,
    description: 'Expansive crimson-and-gold martial courtyard ringed by destructible torii shrines and dusk mountain silhouettes.',
  },
  {
    id: 'obsidian',
    name: 'Obsidian Storm Peak',
    subtitle: 'Grand Volcanic Dais · Destructible Monoliths',
    accentColor: '#a855f7',
    skyHex: 0x0f172a,
    fogHex: 0x1e1b4b,
    arenaRadius: 37.0,
    description: 'Massive obsidian battle dais inlaid with glowing neon rift tiles, shatterable rift monoliths, and distant spire towers.',
  },
];

export const MAP_BY_ID: Record<MapId, MapSpec> = Object.fromEntries(
  MAPS.map((m) => [m.id, m])
) as Record<MapId, MapSpec>;

// Keep central arena lane wide open while placing well-spaced destructible buildings/ruins on outer quadrants
const MAP_OBSTACLES: Record<MapId, MapObstacle[]> = {
  shibuya: [
    { id: 'shib-cafe-nw', kind: 'building', x: -14.5, z: -13.5, halfW: 2.3, halfD: 2.0, topY: 4.2, colorHex: 0xe2e8f0, roofColorHex: 0x2563eb, destructible: true, maxHp: 110 },
    { id: 'shib-arcade-ne', kind: 'building', x: 14.5, z: -13.5, halfW: 2.3, halfD: 2.0, topY: 4.5, colorHex: 0xf1f5f9, roofColorHex: 0xec4899, destructible: true, maxHp: 110 },
    { id: 'shib-kiosk-sw', kind: 'building', x: -14.5, z: 13.5, halfW: 2.1, halfD: 1.9, topY: 3.4, colorHex: 0xf8fafc, roofColorHex: 0x0ea5e9, destructible: true, maxHp: 90 },
    { id: 'shib-shelter-se', kind: 'building', x: 14.5, z: 13.5, halfW: 2.1, halfD: 1.9, topY: 3.6, colorHex: 0xe2e8f0, roofColorHex: 0xf59e0b, destructible: true, maxHp: 90 },
    { id: 'shib-pillar-w', kind: 'pillar', x: -23.0, z: 0, halfW: 1.35, halfD: 1.35, topY: 4.8, colorHex: 0x94a3b8, roofColorHex: 0x38bdf8, destructible: true, maxHp: 75 },
    { id: 'shib-pillar-e', kind: 'pillar', x: 23.0, z: 0, halfW: 1.35, halfD: 1.35, topY: 4.8, colorHex: 0x94a3b8, roofColorHex: 0xf43f5e, destructible: true, maxHp: 75 },
  ],
  meadow: [
    { id: 'mead-ruin-nw', kind: 'pillar', x: -15.0, z: -14.5, halfW: 1.75, halfD: 1.75, topY: 3.8, colorHex: 0xd6d3d1, roofColorHex: 0xfacc15, destructible: true, maxHp: 85 },
    { id: 'mead-ruin-ne', kind: 'pillar', x: 15.0, z: -14.5, halfW: 1.75, halfD: 1.75, topY: 3.8, colorHex: 0xd6d3d1, roofColorHex: 0xfacc15, destructible: true, maxHp: 85 },
    { id: 'mead-ruin-sw', kind: 'pillar', x: -15.0, z: 14.5, halfW: 1.75, halfD: 1.75, topY: 3.6, colorHex: 0xd6d3d1, roofColorHex: 0x84cc16, destructible: true, maxHp: 85 },
    { id: 'mead-ruin-se', kind: 'pillar', x: 15.0, z: 14.5, halfW: 1.75, halfD: 1.75, topY: 3.6, colorHex: 0xd6d3d1, roofColorHex: 0x84cc16, destructible: true, maxHp: 85 },
  ],
  temple: [
    { id: 'temp-shrine-nw', kind: 'building', x: -15.0, z: -14.0, halfW: 1.9, halfD: 1.8, topY: 4.0, colorHex: 0x7f1d1d, roofColorHex: 0xfb923c, destructible: true, maxHp: 95 },
    { id: 'temp-shrine-ne', kind: 'building', x: 15.0, z: -14.0, halfW: 1.9, halfD: 1.8, topY: 4.0, colorHex: 0x7f1d1d, roofColorHex: 0xfb923c, destructible: true, maxHp: 95 },
    { id: 'temp-shrine-sw', kind: 'building', x: -15.0, z: 14.0, halfW: 1.9, halfD: 1.8, topY: 3.8, colorHex: 0x991b1b, roofColorHex: 0xfacc15, destructible: true, maxHp: 95 },
    { id: 'temp-shrine-se', kind: 'building', x: 15.0, z: 14.0, halfW: 1.9, halfD: 1.8, topY: 3.8, colorHex: 0x991b1b, roofColorHex: 0xfacc15, destructible: true, maxHp: 95 },
  ],
  obsidian: [
    { id: 'obs-mono-nw', kind: 'pillar', x: -15.0, z: -14.0, halfW: 1.65, halfD: 1.65, topY: 4.4, colorHex: 0x334155, roofColorHex: 0xa855f7, destructible: true, maxHp: 95 },
    { id: 'obs-mono-ne', kind: 'pillar', x: 15.0, z: -14.0, halfW: 1.65, halfD: 1.65, topY: 4.4, colorHex: 0x334155, roofColorHex: 0xa855f7, destructible: true, maxHp: 95 },
    { id: 'obs-mono-sw', kind: 'pillar', x: -15.0, z: 14.0, halfW: 1.65, halfD: 1.65, topY: 4.2, colorHex: 0x334155, roofColorHex: 0x38bdf8, destructible: true, maxHp: 95 },
    { id: 'obs-mono-se', kind: 'pillar', x: 15.0, z: 14.0, halfW: 1.65, halfD: 1.65, topY: 4.2, colorHex: 0x334155, roofColorHex: 0x38bdf8, destructible: true, maxHp: 95 },
  ],
};

const MAP_PICKUPS: Record<MapId, PickupSpawn[]> = {
  shibuya: [
    { id: 'pk-hp-1', kind: 'health', x: -17.5, z: 0 },
    { id: 'pk-hp-2', kind: 'health', x: 17.5, z: 0 },
    { id: 'pk-hp-3', kind: 'health', x: 0, z: 18.5 },
    { id: 'pk-mp-1', kind: 'mana', x: 0, z: -18.5 },
    { id: 'pk-mp-2', kind: 'mana', x: -8.5, z: 8.5 },
    { id: 'pk-mp-3', kind: 'mana', x: 8.5, z: -8.5 },
  ],
  meadow: [
    { id: 'pk-hp-1', kind: 'health', x: -19.0, z: 0 },
    { id: 'pk-hp-2', kind: 'health', x: 19.0, z: 0 },
    { id: 'pk-hp-3', kind: 'health', x: 0, z: 19.0 },
    { id: 'pk-mp-1', kind: 'mana', x: 0, z: -19.0 },
    { id: 'pk-mp-2', kind: 'mana', x: -10.0, z: 10.0 },
    { id: 'pk-mp-3', kind: 'mana', x: 10.0, z: -10.0 },
  ],
  temple: [
    { id: 'pk-hp-1', kind: 'health', x: -19.0, z: -5.5 },
    { id: 'pk-hp-2', kind: 'health', x: 19.0, z: 5.5 },
    { id: 'pk-hp-3', kind: 'health', x: 0, z: 19.0 },
    { id: 'pk-mp-1', kind: 'mana', x: 0, z: -19.0 },
    { id: 'pk-mp-2', kind: 'mana', x: 10.0, z: -10.0 },
    { id: 'pk-mp-3', kind: 'mana', x: -10.0, z: 10.0 },
  ],
  obsidian: [
    { id: 'pk-hp-1', kind: 'health', x: 0, z: -18.5 },
    { id: 'pk-hp-2', kind: 'health', x: -18.5, z: 0 },
    { id: 'pk-hp-3', kind: 'health', x: 18.5, z: 0 },
    { id: 'pk-mp-1', kind: 'mana', x: -10.0, z: -10.0 },
    { id: 'pk-mp-2', kind: 'mana', x: 10.0, z: 10.0 },
    { id: 'pk-mp-3', kind: 'mana', x: 0, z: 18.5 },
  ],
};

export function getMapObstacles(mapId: MapId): MapObstacle[] {
  return MAP_OBSTACLES[mapId];
}

export function createInitialObstacleStates(mapId: MapId): ObstacleState[] {
  return MAP_OBSTACLES[mapId].map((obs) => {
    const maxHp = obs.maxHp ?? 100;
    return {
      ...obs,
      hp: maxHp,
      maxHp,
      destroyed: false,
    };
  });
}

export function getMapPickupSpawns(mapId: MapId): PickupSpawn[] {
  return MAP_PICKUPS[mapId];
}

export function getDamagePhase(hp: number, maxHp: number, isKO: boolean): DamagePhase {
  if (isKO || hp <= 0) return 'DEFEATED';
  const pct = (hp / Math.max(1, maxHp)) * 100;
  if (pct <= 22) return 'CRITICAL';
  if (pct <= 48) return 'SEVERELY DAMAGED';
  if (pct <= 74) return 'DAMAGED';
  return 'NORMAL';
}

export function getMeadowStreamZ(x: number): number {
  return Math.sin(x * 0.11) * 3.8 - 1.2;
}

export function getMapTerrainHeight(mapId: MapId, x: number, z: number): number {
  const arenaR = MAP_BY_ID[mapId].arenaRadius;
  const r = Math.hypot(x, z);
  // Playable arena floor is 100% flat for clean 60fps ground previews, dashes, and knockbacks
  if (r <= arenaR + 1.8) {
    return 0;
  }
  const outer = r - (arenaR + 1.8);
  if (mapId === 'shibuya') {
    return outer * 0.06;
  }
  if (mapId === 'meadow') {
    return outer * 0.16 + Math.sin(x * 0.12) * Math.cos(z * 0.12) * 0.25;
  }
  if (mapId === 'temple') {
    return outer * 0.12;
  }
  return outer * 0.18 + Math.sin(x * 0.14) * Math.cos(z * 0.14) * 0.18;
}

export function getObstacleSupportY(
  mapId: MapId,
  x: number,
  currentRelY: number,
  z: number,
  actorRadius = 0.42,
  liveObstacles?: Array<MapObstacle & { destroyed?: boolean }>
): number {
  let maxTop = 0;
  const obstacles: Array<MapObstacle & { destroyed?: boolean }> = liveObstacles ?? getMapObstacles(mapId);
  for (const obs of obstacles) {
    if (obs.destroyed) continue;
    if (
      Math.abs(x - obs.x) <= obs.halfW + actorRadius * 0.6 &&
      Math.abs(z - obs.z) <= obs.halfD + actorRadius * 0.6 &&
      currentRelY >= obs.topY - 0.42
    ) {
      if (obs.topY > maxTop) maxTop = obs.topY;
    }
  }
  return maxTop;
}

export function resolveObstacleCollisions(
  mapId: MapId,
  x: number,
  relY: number,
  z: number,
  actorRadius = 0.48,
  liveObstacles?: Array<MapObstacle & { destroyed?: boolean }>
): { x: number; z: number } {
  let nx = x;
  let nz = z;
  const obstacles: Array<MapObstacle & { destroyed?: boolean }> = liveObstacles ?? getMapObstacles(mapId);
  for (const obs of obstacles) {
    if (obs.destroyed) continue;
    if (relY >= obs.topY - 0.42) continue;
    const expandW = obs.halfW + actorRadius;
    const expandD = obs.halfD + actorRadius;
    const dx = nx - obs.x;
    const dz = nz - obs.z;
    if (Math.abs(dx) < expandW && Math.abs(dz) < expandD) {
      const penX = expandW - Math.abs(dx);
      const penZ = expandD - Math.abs(dz);
      if (penX < penZ) {
        nx += dx >= 0 ? penX : -penX;
      } else {
        nz += dz >= 0 ? penZ : -penZ;
      }
    }
  }
  return { x: nx, z: nz };
}

export function findObstacleAtPoint<T extends MapObstacle & { destroyed?: boolean }>(
  mapId: MapId,
  x: number,
  relY: number,
  z: number,
  liveObstacles?: T[]
): T | null {
  const obstacles = (liveObstacles ?? getMapObstacles(mapId)) as T[];
  for (const obs of obstacles) {
    if (obs.destroyed) continue;
    if (
      relY < obs.topY &&
      Math.abs(x - obs.x) <= obs.halfW &&
      Math.abs(z - obs.z) <= obs.halfD
    ) {
      return obs;
    }
  }
  return null;
}

export function pointHitsObstacle(
  mapId: MapId,
  x: number,
  relY: number,
  z: number,
  liveObstacles?: Array<MapObstacle & { destroyed?: boolean }>
): boolean {
  return findObstacleAtPoint(mapId, x, relY, z, liveObstacles) !== null;
}

export interface RoomPlayer {
  playerId: string;
  slotIndex: number;
  name: string;
  fighterId: FighterId;
  skinId: SkinId;
  ready: boolean;
  connected: boolean;
  wins: number;
  isBot?: boolean;
  isDummy?: boolean;
}

export interface ArenaPickup {
  id: string;
  kind: 'health' | 'mana';
  x: number;
  y: number;
  z: number;
  active: boolean;
}

export interface BattlefieldEventState {
  id: string;
  kind: BattlefieldEventKind;
  title: string;
  subtitle: string;
  x: number;
  z: number;
  radius: number;
  remaining: number;
  telegraphRemaining: number; // >0 before hazard detonates
  colorHex: number;
}

export interface ClashState {
  id: string;
  playerAId: string;
  playerBId: string;
  remaining: number; // QTE decision countdown
  maxTime: number;
  choiceA: CombatMoveType | null;
  choiceB: CombatMoveType | null;
  x: number;
  y: number;
  z: number;
}

export interface HeadlockState {
  id: string;
  grabberId: string;
  victimId: string;
  remaining: number;
  duration: number;
  grabberMashes: number;
  victimMashes: number;
  x: number;
  y: number;
  z: number;
}

export interface ArenaZoneState {
  id: string;
  ownerId: string;
  fighterId: FighterId;
  kind: ArenaZoneKind;
  x: number;
  y: number;
  z: number;
  endX?: number;
  endZ?: number;
  radius: number;
  remaining: number;
  maxDuration: number;
  colorHex: number;
  triggered?: boolean;
}

export interface TelegraphState {
  id: string;
  ownerId: string;
  fighterId: FighterId;
  kind: TelegraphKind;
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirZ: number;
  radius: number;
  length: number;
  angleHalf: number;
  progress: number;
  colorHex: number;
}

export interface ArenaActorState {
  playerId: string;
  slotIndex: number;
  name: string;
  fighterId: FighterId;
  skinId: SkinId;
  isBot?: boolean;
  isDummy?: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  yVel: number;
  vz: number;
  grounded: boolean;
  rotY: number;
  hp: number;
  maxHp: number;
  mana: number; // Chi / Energy
  maxMana: number;
  stamina: number; // Tactical stamina (slower regen, governs spam)
  maxStamina: number;
  stagger: number; // 0..100 -> 100 triggers STUNNED
  isStunned: boolean;
  isOverdrive: boolean; // Low-HP (<28%) comeback overdrive
  frenzyInside?: boolean; // Visual indicator when standing inside active Frenzy Zone
  passiveStacks: number; // Character passive counter / buff stack
  counterFlowActive: boolean; // JM Parry/Evade buff or general empowered skill buff
  stage2Slot?: AbilitySlot | null;
  stage2Timer?: number;
  stage2Label?: string;
  rushFatigue?: number;
  empoweredM1Ready?: boolean;
  perfectEvadeTimer?: number;
  comboCount: number; // Consecutive hits landed
  comboResetRemaining?: number; // Seconds remaining before combo resets (max 2.0s)
  comboStep: 0 | 1 | 2 | 3 | 4; // 4-hit M1 stage
  m1Variant: 'light' | 'heavy';
  grabCooldown: number;
  damagePhase: DamagePhase;
  actionState: ActorActionState;
  abilitySlot: AbilitySlot | null;
  actionTimer: number;
  actionDuration: number;
  whiffTimer: number; // >0 means missed big move -> extra vulnerability
  cooldowns: [number, number, number, number, number, number, number];
  dashCooldown: number;
  dashMaxCooldown: number;
  dashCharges: number;
  dashMaxCharges: number;
  dashRechargeRemaining: number;
  isFlying?: boolean;
  flightRemaining?: number;
  flightMax?: number;
  flightCooldown?: number;
  speedBoostTimer?: number;
  superArmor?: boolean;
  shieldActive: boolean;
  parryWindow: boolean;
  blockHeld: boolean;
  awakened: boolean;
  awakeningTransformTimer?: number;
  silencedTimer?: number;
  snareMarkedTimer?: number;
  isKO: boolean;
  koTime: number | null;
  koStyle: EliminationStyle;
  koCause?: KoCause;
  koByFighterId?: FighterId;
  wins: number;
  kills: number;
  parryCount: number;
  damageDealt: number;
}

export interface AwakeningOrbState {
  id: string;
  x: number;
  y: number;
  z: number;
  active: boolean;
  fadeTimer: number;
}

export interface AwakeningBannerState {
  id: string;
  text: string;
  subtext?: string;
  colorHex: number;
  remaining: number;
}

export interface AwakeningCutsceneState {
  id: string;
  p1Id: string;
  p2Id: string;
  p1Name: string;
  p2Name: string;
  p1FighterId: FighterId;
  p2FighterId: FighterId;
  clockSec: number;
  clashBalance: number; // -1 (P1 dominates) .. +1 (P2 dominates)
  p1Taps: number;
  p2Taps: number;
  p1Overdrive: number;
  p2Overdrive: number;
  outcome: 'p1' | 'p2' | 'tie' | null;
  fadeMusicOut: boolean;
  resolved: boolean;
}

export type AwakeningDebugAction =
  | 'spawnOrbs'
  | 'awakenP1'
  | 'awakenP2'
  | 'triggerCutscene'
  | 'setTime89'
  | 'resetCooldowns';

export interface ProjectileState {
  id: string;
  ownerId: string;
  fighterId: FighterId;
  kind:
    | 'bullet'
    | 'magnum'
    | 'lasso'
    | 'crescent'
    | 'solarFireball'
    | 'tornado'
    | 'jmBeam'
    | 'jmBolt'
    | 'windBlade'
    | 'solarRailgun'
    | 'tornadoVortex';
  x: number;
  y: number;
  z: number;
  vx: number;
  vy?: number;
  vz: number;
  rotY: number;
  colorHex: number;
  originX?: number;
  originY?: number;
  originZ?: number;
  targetX?: number;
  targetY?: number;
  targetZ?: number;
  isComboLink?: boolean;
  isOverdrive?: boolean;
}

export type RpsOutcome =
  | 'strike_beats_grab'
  | 'grab_beats_parry'
  | 'parry_beats_strike'
  | 'weak_to_grab';

export interface CombatEvent {
  id: string;
  t: number;
  kind:
    | 'cast'
    | 'hit'
    | 'block'
    | 'parry'
    | 'evade'
    | 'trap'
    | 'trapTrigger'
    | 'grab'
    | 'headlockBreak'
    | 'whiff'
    | 'stun'
    | 'dash'
    | 'jump'
    | 'pickup'
    | 'shockwave'
    | 'beam'
    | 'lasso'
    | 'comboLink'
    | 'overdrive'
    | 'clashStart'
    | 'clashWin'
    | 'hazardHit'
    | 'fireballCharge'
    | 'fireballLaunch'
    | 'fireballImpact'
    | 'obstacleBreak'
    | 'awakeningOrbsSpawn'
    | 'awakeningPickup'
    | 'awakeningTransform'
    | 'awakeningCutsceneStart'
    | 'awakeningClashEnd'
    | 'lightning'
    | 'silence'
    | 'cometGrab'
    | 'omnislash'
    | 'ko';
  attackerId?: string;
  targetId?: string;
  fighterId?: FighterId;
  x: number;
  y: number;
  z: number;
  dirX?: number;
  dirZ?: number;
  originX?: number;
  originY?: number;
  originZ?: number;
  colorHex: number;
  damage?: number;
  radius?: number;
  isCrit?: boolean;
  isBackstab?: boolean;
  isCounter?: boolean;
  comboHit?: number;
  hitStopMs?: number;
  callout?: string;
  koStyle?: EliminationStyle;
  koCause?: KoCause;
  abilitySlot?: AbilitySlot;
  comboStep?: 1 | 2 | 3 | 4;
  m1Variant?: 'light' | 'heavy';
  rpsOutcome?: RpsOutcome;
  frenzyInside?: boolean;
  counterFlow?: boolean;
  isComboLink?: boolean;
  staminaRefund?: number;
  whiffSlot?: AbilitySlot | null;
}

export interface TrainingConfig {
  dummyEnabled: boolean;
  zeroCooldowns: boolean;
}

export interface RoomState {
  roomCode: string;
  hostId: string;
  phase: RoomPhase;
  mapId: MapId;
  isSoloPractice: boolean;
  isTrainingMode: boolean;
  trainingConfig?: TrainingConfig;
  countdown: number;
  matchTime: number;
  roundNumber: number;
  winsToWin: number;
  roundWinnerId: string | null;
  winnerId: string | null;
  players: RoomPlayer[];
}

export interface ArenaSnapshot {
  serverTime: number;
  matchTime: number;
  lastInputSeq: Record<string, number>;
  actors: ArenaActorState[];
  projectiles: ProjectileState[];
  zones: ArenaZoneState[];
  telegraphs: TelegraphState[];
  pickups: ArenaPickup[];
  obstacles?: ObstacleState[];
  battleEvent: BattlefieldEventState | null;
  activeClash: ClashState | null;
  activeHeadlock: HeadlockState | null;
  stormActive: boolean;
  stormRadius: number;
  stormMaxRadius: number;
  awakeningPhase: MatchAwakeningPhase;
  awakeningOrbs: AwakeningOrbState[];
  awakeningCutscene: AwakeningCutsceneState | null;
  awakeningBanner: AwakeningBannerState | null;
}

export interface RoomChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  fighterId?: FighterId;
  text: string;
  timestamp: number;
}

export type ClientMessage =
  | { type: 'net:ping'; clientSendTime: number }
  | { type: 'room:create'; playerName: string; isSoloPractice?: boolean; isTrainingMode?: boolean }
  | { type: 'room:join'; roomCode: string; playerName: string; reconnectToken?: string }
  | { type: 'room:selectFighter'; fighterId: FighterId }
  | { type: 'room:selectSkin'; skinId: SkinId }
  | { type: 'room:selectMap'; mapId: MapId }
  | { type: 'room:setReady'; ready: boolean }
  | { type: 'room:startNow' }
  | { type: 'room:rematch' }
  | { type: 'room:leave' }
  | { type: 'room:chat'; text: string }
  | {
      type: 'game:input';
      seq?: number;
      moveX: number;
      moveZ: number;
      aimYaw: number;
      aimPitch?: number;
      targetId?: string | null;
      blockHeld?: boolean;
      jumpHeld?: boolean;
    }
  | { type: 'game:jump'; seq?: number }
  | { type: 'game:toggleFlight'; seq?: number }
  | { type: 'game:dash'; seq?: number; moveX?: number; moveZ?: number; aimYaw?: number }
  | { type: 'game:grab'; seq?: number; aimYaw?: number; targetId?: string | null }
  | { type: 'game:clashPick'; clashId: string; choice: CombatMoveType }
  | { type: 'game:aimUpdate'; aimX: number; aimZ: number }
  | { type: 'game:trainingConfig'; dummyEnabled?: boolean; zeroCooldowns?: boolean }
  | { type: 'game:awakeningMash'; side?: 'p1' | 'p2' }
  | { type: 'game:awakeningSkip' }
  | { type: 'game:cutsceneSync'; clockSec: number }
  | { type: 'game:debug'; action: AwakeningDebugAction }
  | {
      type: 'game:ability';
      seq?: number;
      slot: AbilitySlot;
      holdHeavy?: boolean;
      aimYaw?: number;
      aimPitch?: number;
      targetId?: string | null;
      aimX?: number;
      aimZ?: number;
      isHoldVariant?: boolean;
    };

export type ServerMessage =
  | { type: 'net:pong'; clientSendTime: number; serverTime: number }
  | {
      type: 'room:joined';
      playerId: string;
      reconnectToken: string;
      room: RoomState;
      chatHistory?: RoomChatMessage[];
    }
  | { type: 'room:state'; room: RoomState }
  | { type: 'room:chat'; message: RoomChatMessage }
  | { type: 'room:error'; message: string }
  | { type: 'room:exited'; reason: string }
  | { type: 'game:snapshot'; snapshot: ArenaSnapshot; events: CombatEvent[] };
