import type { Skill } from "@/types/data";
import type { AggregatedStats } from "./stats";
import { calculateSkillHit, calculateAutoAttackAverage } from "./damage";

export type ComboAction =
  | {
      type: "skill";
      name: string;
      skill: Skill;
      rank: number;
      castTime: number;
    }
  | { type: "aa"; name?: string; castTime: number };

export type TargetState = {
  armor: number;
  mr: number;
  hp: { current: number; max: number };
  shield?: number;
  armorReductionPercent?: number;
  mrReductionPercent?: number;
  armorReductionFlat?: number;
  mrReductionFlat?: number;
};

export function runCombo(
  actions: ComboAction[],
  attacker: AggregatedStats,
  target: TargetState,
  opts?: { distanceFactor?: number; bonusOnce?: { name: string; amountFinal: number } }
) {
  const timeline: Array<{
    time: number;
    name: string;
    damage: number;
    hpAfter: number;
  }> = [];
  let t = 0;
  let currentHp = target.hp.current;
  let shield = target.shield ?? 0;
  let bonusUsed = false;
  for (const act of actions) {
    t += act.castTime;
    // dealt is derivable from timeline; omit local accumulator
    if (act.type === "skill") {
      const res = calculateSkillHit(act.skill, act.rank, attacker, target, opts);
      // Instant portion first with shield absorption
      let instant = res.final - (res.breakdown.dotFinal ?? 0);
      if (shield > 0) {
        const absorb = Math.min(shield, instant);
        shield -= absorb;
        instant -= absorb;
      }
      currentHp = Math.max(0, currentHp - instant);
      timeline.push({
        time: t,
        name: act.name,
        damage: instant,
        hpAfter: currentHp,
      });

      // Optional one-time bonus (e.g., Electrocute) applied after the instant hit
      if (!bonusUsed && opts?.bonusOnce && opts.bonusOnce.amountFinal > 0) {
        let bonus = opts.bonusOnce.amountFinal;
        if (shield > 0) {
          const absorb = Math.min(shield, bonus);
          shield -= absorb;
          bonus -= absorb;
        }
        if (bonus > 0) {
          currentHp = Math.max(0, currentHp - bonus);
          timeline.push({
            time: t,
            name: opts.bonusOnce.name,
            damage: bonus,
            hpAfter: currentHp,
          });
        }
        bonusUsed = true;
      }

      // Schedule DoT ticks if available
      if (res.ticks && res.ticks.length) {
        for (const tick of res.ticks) {
          const tickTime = t + tick.timeOffset;
          let tickDamage = tick.damage;
          if (shield > 0) {
            const absorb = Math.min(shield, tickDamage);
            shield -= absorb;
            tickDamage -= absorb;
          }
          currentHp = Math.max(0, currentHp - tickDamage);
          timeline.push({
            time: tickTime,
            name: `${act.name}-DoT`,
            damage: tickDamage,
            hpAfter: currentHp,
          });
        }
      }
    } else {
      const aa = calculateAutoAttackAverage(attacker, {
        armor: target.armor,
        mr: target.mr,
        armorReductionPercent: target.armorReductionPercent,
        armorReductionFlat: target.armorReductionFlat,
        mrReductionPercent: target.mrReductionPercent,
        mrReductionFlat: target.mrReductionFlat,
      });
      let aaDmg = aa.final;
      if (shield > 0) {
        const absorb = Math.min(shield, aaDmg);
        shield -= absorb;
        aaDmg -= absorb;
      }
      currentHp = Math.max(0, currentHp - aaDmg);
      timeline.push({
        time: t,
        name: act.name ?? "AA",
        damage: aaDmg,
        hpAfter: currentHp,
      });
    }
    target.hp.current = currentHp; // update for HP-dependent skills
  }
  return {
    totalDamage: timeline.reduce((s, x) => s + x.damage, 0),
    timeline: timeline.sort((a, b) => a.time - b.time),
    canKill: currentHp <= 0,
    overkill: Math.max(0, -currentHp),
  };
}
