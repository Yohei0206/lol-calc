// Normalized data model for champions, items, and runes

export type ScalarPerLevel = {
  base: number;
  growth: number;
};

export type BaseStats = {
  hp: ScalarPerLevel;
  mp: ScalarPerLevel;
  ad: ScalarPerLevel;
  ap: ScalarPerLevel; // Always 0 in base, included for completeness
  armor: ScalarPerLevel;
  mr: ScalarPerLevel;
  attackSpeed: ScalarPerLevel;
};

export type DotComponent = {
  perSecond: number[]; // length up to 5 (ranks)
  duration: number[]; // seconds per rank
};

export type ShieldComponent = {
  base: number[]; // shield amount per rank
  apRatio: number; // AP scaling if present
};

export type SkillDamage = {
  base: number[]; // base damage per rank (0..4)
  apRatio: number; // flat AP ratio (e.g., 0.6 == 60%)
  adRatio: number; // flat AD ratio
  percentMaxHp?: number[]; // e.g., [0.04, 0.05, ...] for 4%+ of target max HP
  percentCurrentHp?: number[]; // e.g., [0.03, 0.04, ...]
  percentMissingHp?: number[]; // e.g., [0.25] for 25% of missing health
  // Optional distance scaling for base damage: interpolate floor..max by distance factor (0..1)
  distanceBase?: {
    floor: number[]; // per rank minimum base
    max: number[]; // per rank maximum base
  };
  // Optional distance scaling for ratios (e.g., Jinx R AD scales with distance)
  distanceAdRatio?: { floor: number; max: number };
  distanceApRatio?: { floor: number; max: number };
  dot?: DotComponent; // damage over time
  shield?: ShieldComponent; // shielding component on the skill
};

export type Skill = {
  name: string;
  damage: SkillDamage;
  damageType: "physical" | "magical" | "true";
};

export type NormalizedChampion = {
  id: number;
  name: string;
  alias: string;
  baseStats: BaseStats;
  skills: Skill[];
};

export type ItemStats = {
  ad: number;
  ap: number;
  hp: number;
  armor: number;
  mr: number;
  haste: number;
  critChance: number;
};

export type ItemPassiveEffects = {
  armorPenPercent: number; // 0..100
  magicPenPercent: number; // 0..100
  flatArmorPen: number; // lethality-like fixed pen
  magicPenFlat: number; // flat magic penetration
  lifestealPercent: number; // 0..100
  omnivampPercent: number; // 0..100
};

export type NormalizedItem = {
  id: number;
  name: string;
  stats: ItemStats;
  passive: {
    description: string; // plain text
    effects: ItemPassiveEffects;
  };
  onHit?: {
    flatMagic?: number; // fixed magic on-hit per attack
    apRatioMagic?: number; // e.g., 0.2 for 20% AP added as magic on-hit
    flatPhysical?: number;
    adRatioPhysical?: number;
    flatTrue?: number;
    percentCurrentHp?: {
      amount: number;
      damageType: "physical" | "magical" | "true";
    };
    everyNth?: {
      n: number;
      amount: number;
      damageType: "physical" | "magical" | "true";
    };
  };
};

export type NormalizedRune = {
  id: number;
  name: string;
  effects: {
    damageIncrease: number; // 0..1
    description: string; // short description
  };
  isKeystone: boolean;
  path: string; // Precision, Domination, etc (ja path names are kept raw)
};
