import type {
  BaseStats,
  NormalizedItem,
  NormalizedChampion,
} from "@/types/data";

// Riotの成長係数（近似）：level 1..18
function growthFactor(level: number): number {
  const L = Math.max(1, Math.min(18, Math.floor(level)));
  const n = L - 1;
  return 0.7025 + 0.0175 * n; // 標準的に使われる係数
}

export function scaleLinear(
  base: number,
  growth: number,
  level: number
): number {
  const gf = growthFactor(level);
  return base + growth * (level - 1) * gf;
}

export function scaleAttackSpeed(
  baseAS: number,
  growthPercent: number,
  level: number
): number {
  const gf = growthFactor(level);
  const mult = 1 + (growthPercent / 100) * (level - 1) * gf;
  return baseAS * mult;
}

export type AggregatedStats = {
  level: number;
  totalHP: number;
  totalMP: number;
  totalAD: number;
  totalAP: number;
  totalArmor: number;
  totalMR: number;
  attackSpeed: number;
  // offense mods
  armorPenFlat: number;
  armorPenPercent: number; // 0..1
  magicPenFlat: number;
  magicPenPercent: number; // 0..1
  lifesteal: number; // 0..1
  omnivamp: number; // 0..1
  critChance: number; // 0..1
  critDamage: number; // 例: 1.75 (175%)
  runeDamageIncrease: number; // 0..1 合算（単純）
  onHit: {
    flatMagic: number;
    apRatioMagic: number;
    flatPhysical: number;
    adRatioPhysical: number;
    flatTrue: number;
    percentCurrentHp?: {
      amount: number;
      damageType: "physical" | "magical" | "true";
    };
    nthHit?: {
      n: number;
      amount: number;
      damageType: "physical" | "magical" | "true";
    };
  };
};

export type BuildInput = {
  champion: NormalizedChampion;
  level: number; // 1..18
  items: NormalizedItem[];
  runeDamageIncrease?: number; // runes.normalizedからの単純係数
  critDamage?: number; // 省略時 1.75
};

export function aggregateStats(
  base: BaseStats,
  level: number,
  items: NormalizedItem[]
): {
  hp: number;
  mp: number;
  ad: number;
  ap: number;
  armor: number;
  mr: number;
  as: number;
} {
  const hp = scaleLinear(base.hp.base, base.hp.growth, level);
  const mp = scaleLinear(base.mp.base, base.mp.growth, level);
  const ad = scaleLinear(base.ad.base, base.ad.growth, level);
  const ap = scaleLinear(base.ap.base, base.ap.growth, level);
  const armor = scaleLinear(base.armor.base, base.armor.growth, level);
  const mr = scaleLinear(base.mr.base, base.mr.growth, level);
  const as = scaleAttackSpeed(
    base.attackSpeed.base,
    base.attackSpeed.growth,
    level
  );

  // items flat additions
  let addHP = 0,
    addAD = 0,
    addAP = 0,
    addArmor = 0,
    addMR = 0;
  for (const it of items) {
    addHP += it.stats.hp || 0;
    addAD += it.stats.ad || 0;
    addAP += it.stats.ap || 0;
    addArmor += it.stats.armor || 0;
    addMR += it.stats.mr || 0;
  }
  return {
    hp: hp + addHP,
    mp,
    ad: ad + addAD,
    ap: ap + addAP,
    armor: armor + addArmor,
    mr: mr + addMR,
    as,
  };
}

export function buildAggregatedStats(input: BuildInput): AggregatedStats {
  const {
    champion,
    level,
    items,
    runeDamageIncrease = 0,
    critDamage = 1.75,
  } = input;
  const s = aggregateStats(champion.baseStats, level, items);

  // Offensive modifiers from items
  let armorPenFlat = 0;
  let armorPenPercent = 0;
  let magicPenFlat = 0;
  let magicPenPercent = 0;
  let lifesteal = 0;
  let omnivamp = 0;
  let critChance = 0;
  // on-hit accumulators
  const onHit = {
    flatMagic: 0,
    apRatioMagic: 0,
    flatPhysical: 0,
    adRatioPhysical: 0,
    flatTrue: 0,
    percentCurrentHp: undefined as
      | undefined
      | { amount: number; damageType: "physical" | "magical" | "true" },
    nthHit: undefined as
      | undefined
      | {
          n: number;
          amount: number;
          damageType: "physical" | "magical" | "true";
        },
  };

  for (const it of items) {
    const eff = it.passive?.effects;
    if (eff) {
      armorPenPercent += (eff.armorPenPercent || 0) / 100;
      magicPenPercent += (eff.magicPenPercent || 0) / 100;
      armorPenFlat += eff.flatArmorPen || 0;
      magicPenFlat += eff.magicPenFlat || 0;
      lifesteal += (eff.lifestealPercent || 0) / 100;
      omnivamp += (eff.omnivampPercent || 0) / 100;
    }
    critChance += (it.stats.critChance || 0) / 100;

    // collect on-hit
    if (it.onHit) {
      onHit.flatMagic += it.onHit.flatMagic || 0;
      onHit.apRatioMagic += it.onHit.apRatioMagic || 0;
      onHit.flatPhysical += it.onHit.flatPhysical || 0;
      onHit.adRatioPhysical += it.onHit.adRatioPhysical || 0;
      onHit.flatTrue += it.onHit.flatTrue || 0;
      if (it.onHit.percentCurrentHp && !onHit.percentCurrentHp) {
        onHit.percentCurrentHp = it.onHit.percentCurrentHp;
      }
      if (it.onHit.everyNth && !onHit.nthHit) {
        onHit.nthHit = {
          n: it.onHit.everyNth.n,
          amount: it.onHit.everyNth.amount,
          damageType: it.onHit.everyNth.damageType,
        };
      }
    }
  }

  // clamp
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  return {
    level,
    totalHP: s.hp,
    totalMP: s.mp,
    totalAD: s.ad,
    totalAP: s.ap,
    totalArmor: s.armor,
    totalMR: s.mr,
    attackSpeed: s.as,
    armorPenFlat,
    armorPenPercent: clamp01(armorPenPercent),
    magicPenFlat,
    magicPenPercent: clamp01(magicPenPercent),
    lifesteal: clamp01(lifesteal),
    omnivamp: clamp01(omnivamp),
    critChance: clamp01(critChance),
    critDamage,
    runeDamageIncrease: clamp01(runeDamageIncrease),
    onHit,
  };
}
