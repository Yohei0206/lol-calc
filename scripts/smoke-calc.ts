import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  NormalizedChampion,
  NormalizedItem,
  NormalizedRune,
} from "@/types/data";
import { buildAggregatedStats } from "@/lib/calc/stats";
import {
  calculateSkillHit,
  calculateAutoAttackAverage,
} from "@/lib/calc/damage";
import { runCombo } from "@/lib/calc/combo";

function loadJson<T>(p: string): T {
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

function main() {
  const dataDir = join(process.cwd(), "data");
  const champs = loadJson<NormalizedChampion[]>(
    join(dataDir, "champions.normalized.json")
  );
  const items = loadJson<NormalizedItem[]>(
    join(dataDir, "items.normalized.json")
  );
  const runes = loadJson<NormalizedRune[]>(
    join(dataDir, "runes.normalized.json")
  );

  // Pick Annie and a couple of AP items as a quick test
  const annie = champs.find((c) => c.alias === "Annie");
  if (!annie) throw new Error("Annie not found");
  const apItems = items.filter((it) => it.stats.ap > 0).slice(0, 2);
  const runeAmp =
    runes.find((r) => r.effects.damageIncrease > 0)?.effects.damageIncrease ??
    0;

  const attacker = buildAggregatedStats({
    champion: annie,
    level: 11,
    items: apItems,
    runeDamageIncrease: runeAmp,
  });
  const targetArmor = 60;
  const targetMR = 40;
  const targetHp = { current: 1500, max: 2000 };

  const q = annie.skills[0];
  const res = calculateSkillHit(q, 4, attacker, {
    armor: targetArmor,
    mr: targetMR,
    hp: targetHp,
  });
  console.log("Annie Q rank5 =>", res);
  const aa = calculateAutoAttackAverage(attacker, {
    armor: targetArmor,
    mr: targetMR,
  });
  console.log("AutoAttack avg =>", aa);
  const combo = runCombo(
    [
      { type: "skill", name: "Q", skill: q, rank: 4, castTime: 0.25 },
      { type: "aa", castTime: 0.7 },
    ],
    attacker,
    { armor: targetArmor, mr: targetMR, hp: { ...targetHp } }
  );
  console.log("Combo Q->AA =>", combo);

  // Extra: Jinx W vs R check with missing HP scaling
  const jinx = champs.find((c) => c.alias === "Jinx");
  if (jinx) {
    const atkJinx = buildAggregatedStats({
      champion: jinx,
      level: 13,
      items: [],
      runeDamageIncrease: 0,
    });
    const w = jinx.skills[1];
    const r = jinx.skills[3];
    const ranks = { w: 4, r: 2 }; // W rank5, R rank3 (0-based)
    const def = { armor: 80, mr: 60 };

    const cases = [
      { label: "50% missing", hp: { current: 1000, max: 2000 } },
      { label: "80% missing", hp: { current: 400, max: 2000 } },
    ];
    for (const cse of cases) {
      const wRes = calculateSkillHit(w, ranks.w, atkJinx, {
        ...def,
        hp: cse.hp,
      });
      const rRes = calculateSkillHit(r, ranks.r, atkJinx, {
        ...def,
        hp: cse.hp,
      });
      console.log(
        `Jinx ${cse.label} -> W(final):`,
        wRes.final.toFixed(2),
        "R(final):",
        rRes.final.toFixed(2)
      );
    }
  }
}

main();
