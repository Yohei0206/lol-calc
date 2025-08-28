import type { Skill } from "@/types/data";
import type { AggregatedStats } from "./stats";

export function reducePhysical(
  damage: number,
  armor: number,
  armorPenFlat: number,
  armorPenPercent: number,
  armorReductionPercent = 0,
  armorReductionFlat = 0
): number {
  // Order: percent reduction -> flat reduction -> percent pen -> flat pen
  const afterReductionPct = armor * (1 - armorReductionPercent);
  const afterReduction = afterReductionPct - armorReductionFlat;
  const afterPctPen = afterReduction * (1 - armorPenPercent);
  const effectiveArmor = afterPctPen - armorPenFlat;
  const denom = 100 + effectiveArmor;
  const safeDenom = Math.max(0.0001, denom);
  return damage * (100 / safeDenom);
}

export function reduceMagical(
  damage: number,
  mr: number,
  magicPenFlat: number,
  magicPenPercent: number,
  mrReductionPercent = 0,
  mrReductionFlat = 0
): number {
  const afterReductionPct = mr * (1 - mrReductionPercent);
  const afterReduction = afterReductionPct - mrReductionFlat;
  const afterPctPen = afterReduction * (1 - magicPenPercent);
  const effectiveMR = afterPctPen - magicPenFlat;
  const denom = 100 + effectiveMR;
  const safeDenom = Math.max(0.0001, denom);
  return damage * (100 / safeDenom);
}

export function averageCritDamage(
  hitDamage: number,
  critChance: number,
  critDamage: number
): number {
  // 平均化: 通常 * (1-cc) + クリティカル * cc
  return hitDamage * (1 + critChance * (critDamage - 1));
}

export function skillBaseAtRank(
  skill: Skill,
  rank: number,
  opts?: { distanceFactor?: number }
): number {
  const arr = Array.isArray(skill.damage.base) ? skill.damage.base : [];
  let v = arr[rank] ?? 0;
  // Distance interpolation if defined and factor provided (0..1)
  if (skill.damage.distanceBase && typeof opts?.distanceFactor === "number") {
    const f = Math.max(0, Math.min(1, opts.distanceFactor));
    const floor = skill.damage.distanceBase.floor[rank] ?? v;
    const max = skill.damage.distanceBase.max[rank] ?? v;
    v = floor + (max - floor) * f;
  }
  return Math.max(0, v);
}

export function skillRatioDamage(
  skill: Skill,
  attacker: AggregatedStats,
  opts?: { distanceFactor?: number }
): number {
  let dmg = 0;
  // Flat ratios
  if (skill.damage.apRatio) dmg += attacker.totalAP * skill.damage.apRatio;
  if (skill.damage.adRatio) dmg += attacker.totalAD * skill.damage.adRatio;
  // Distance-scaled ratios (optional)
  if (typeof opts?.distanceFactor === "number") {
    const f = Math.max(0, Math.min(1, opts.distanceFactor));
    if (skill.damage.distanceAdRatio) {
      const r =
        skill.damage.distanceAdRatio.floor +
        (skill.damage.distanceAdRatio.max - skill.damage.distanceAdRatio.floor) * f;
      dmg += attacker.totalAD * r;
    }
    if (skill.damage.distanceApRatio) {
      const r =
        skill.damage.distanceApRatio.floor +
        (skill.damage.distanceApRatio.max - skill.damage.distanceApRatio.floor) * f;
      dmg += attacker.totalAP * r;
    }
  }
  return dmg;
}

export function skillPercentHpDamage(
  skill: Skill,
  rank: number,
  targetHp: { current: number; max: number }
): number {
  let dmg = 0;
  const pctMax = skill.damage.percentMaxHp?.[rank];
  if (typeof pctMax === "number") dmg += targetHp.max * pctMax;
  const pctCur = skill.damage.percentCurrentHp?.[rank];
  if (typeof pctCur === "number") dmg += targetHp.current * pctCur;
  const pctMissing = skill.damage.percentMissingHp?.[rank];
  if (typeof pctMissing === "number")
    dmg += (targetHp.max - targetHp.current) * pctMissing;
  return dmg;
}

export function applyDamageTypeReduction(
  value: number,
  type: Skill["damageType"],
  attacker: AggregatedStats,
  target: {
    armor: number;
    mr: number;
    armorReductionPercent?: number;
    mrReductionPercent?: number;
    armorReductionFlat?: number;
    mrReductionFlat?: number;
  }
): number {
  switch (type) {
    case "physical":
      return reducePhysical(
        value,
        target.armor,
        attacker.armorPenFlat,
        attacker.armorPenPercent,
        target.armorReductionPercent ?? 0,
        target.armorReductionFlat ?? 0
      );
    case "magical":
      return reduceMagical(
        value,
        target.mr,
        attacker.magicPenFlat,
        attacker.magicPenPercent,
        target.mrReductionPercent ?? 0,
        target.mrReductionFlat ?? 0
      );
    case "true":
      return value;
    default:
      return value;
  }
}

export function calculateSkillHit(
  skill: Skill,
  rank: number,
  attacker: AggregatedStats,
  target: {
    armor: number;
    mr: number;
    hp: { current: number; max: number };
    armorReductionPercent?: number;
    mrReductionPercent?: number;
    armorReductionFlat?: number;
    mrReductionFlat?: number;
  },
  opts?: { distanceFactor?: number }
): {
  raw: number;
  final: number;
  heal: number;
  breakdown: {
    base: number;
    ratio: number;
    percentHp: number;
    dotRaw?: number;
    dotFinal?: number;
  };
  ticks?: Array<{ timeOffset: number; damage: number }>;
} {
  const base = skillBaseAtRank(skill, rank, {
    distanceFactor: opts?.distanceFactor,
  });
  const ratioWithDist = skillRatioDamage(skill, attacker, {
    distanceFactor: opts?.distanceFactor,
  });
  const percentHp = skillPercentHpDamage(skill, rank, target.hp);
  let raw = base + ratioWithDist + percentHp;

  // DoT component (if any)
  let dotRaw: number | undefined;
  let dotFinal: number | undefined;
  const ticks: Array<{ timeOffset: number; damage: number }> = [];
  const dot = skill.damage.dot;
  if (dot) {
    const dps = dot.perSecond[rank] ?? 0;
    const dur = dot.duration[rank] ?? 0;
    if (dps > 0 && dur > 0) {
      dotRaw = dps * dur;
      // tick timeline (1s interval)
      const tickCount = Math.floor(dur);
      for (let i = 1; i <= tickCount; i++) {
        const tickRaw = dps * (1 + attacker.runeDamageIncrease);
        const tickFinal = applyDamageTypeReduction(
          tickRaw,
          skill.damageType,
          attacker,
          {
            armor: target.armor,
            mr: target.mr,
            armorReductionPercent: target.armorReductionPercent,
            mrReductionPercent: target.mrReductionPercent,
            armorReductionFlat: target.armorReductionFlat,
            mrReductionFlat: target.mrReductionFlat,
          }
        );
        ticks.push({ timeOffset: i, damage: tickFinal });
      }
    }
  }

  // Apply rune amplifications to both instant and dot
  raw = raw * (1 + attacker.runeDamageIncrease);
  if (typeof dotRaw === "number") {
    dotRaw = dotRaw * (1 + attacker.runeDamageIncrease);
  }

  const finalInstant = applyDamageTypeReduction(
    raw,
    skill.damageType,
    attacker,
    {
      armor: target.armor,
      mr: target.mr,
      armorReductionPercent: target.armorReductionPercent,
      mrReductionPercent: target.mrReductionPercent,
      armorReductionFlat: target.armorReductionFlat,
      mrReductionFlat: target.mrReductionFlat,
    }
  );
  if (typeof dotRaw === "number") {
    dotFinal = applyDamageTypeReduction(dotRaw, skill.damageType, attacker, {
      armor: target.armor,
      mr: target.mr,
      armorReductionPercent: target.armorReductionPercent,
      mrReductionPercent: target.mrReductionPercent,
      armorReductionFlat: target.armorReductionFlat,
      mrReductionFlat: target.mrReductionFlat,
    });
  }

  const totalFinal = finalInstant + (dotFinal ?? 0);
  const heal = totalFinal * attacker.omnivamp; // オムニヴァンプ回復（簡易）
  return {
    raw,
    final: totalFinal,
    heal,
    breakdown: {
      base,
  ratio: ratioWithDist,
      percentHp,
      ...(typeof dotRaw === "number" ? { dotRaw } : {}),
      ...(typeof dotFinal === "number" ? { dotFinal } : {}),
    },
    ticks: ticks.length ? ticks : undefined,
  };
}

export function calculateAutoAttackAverage(
  attacker: AggregatedStats,
  target: {
    armor: number;
    mr?: number;
    armorReductionPercent?: number;
    armorReductionFlat?: number;
    mrReductionPercent?: number;
    mrReductionFlat?: number;
  }
): {
  rawHit: number;
  avgCritHit: number;
  final: number;
  lifestealHeal: number;
} {
  const base = attacker.totalAD; // 基本AD
  const avg = averageCritDamage(base, attacker.critChance, attacker.critDamage);
  // 物理本体
  const reducedPhysical = reducePhysical(
    avg,
    target.armor,
    attacker.armorPenFlat,
    attacker.armorPenPercent,
    target.armorReductionPercent ?? 0,
    target.armorReductionFlat ?? 0
  );
  // オンヒット成分
  const onHitMagic =
    attacker.onHit.flatMagic + attacker.totalAP * attacker.onHit.apRatioMagic;
  const onHitPhysical =
    attacker.onHit.flatPhysical +
    attacker.totalAD * attacker.onHit.adRatioPhysical;
  const onHitTrue = attacker.onHit.flatTrue;
  // %現在HP系（1つだけ保持）
  if (attacker.onHit.percentCurrentHp) {
    // TODO: targetの現在HP依存。AA計算引数に hp を追加して対応予定（現状は未適用）
  }
  // N発ごと系は継続的DPSで扱うのが適切のためここでは無視（将来: タイムラインで）

  // 貫通・耐性適用
  const reducedOnHitPhysical =
    onHitPhysical > 0
      ? reducePhysical(
          onHitPhysical,
          target.armor,
          attacker.armorPenFlat,
          attacker.armorPenPercent,
          target.armorReductionPercent ?? 0,
          target.armorReductionFlat ?? 0
        )
      : 0;
  const reducedOnHitMagic =
    onHitMagic > 0
      ? reduceMagical(
          onHitMagic,
          target.mr ?? 0,
          attacker.magicPenFlat,
          attacker.magicPenPercent,
          target.mrReductionPercent ?? 0,
          target.mrReductionFlat ?? 0
        )
      : 0;

  // 合算してルーン増幅
  const sumBeforeAmp =
    reducedPhysical + reducedOnHitPhysical + reducedOnHitMagic + onHitTrue;
  const amplified = sumBeforeAmp * (1 + attacker.runeDamageIncrease);
  const lifestealHeal = reducedPhysical * attacker.lifesteal; // 物理本体にのみLS
  return { rawHit: base, avgCritHit: avg, final: amplified, lifestealHeal };
}
