"use client";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SearchSelect } from "@/components/ui/search-select";
import { Checkbox } from "@/components/ui/checkbox";
import type {
  NormalizedChampion,
  NormalizedItem,
  NormalizedRune,
} from "@/types/data";
import type { ComboAction } from "@/lib/calc/combo";
import { buildAggregatedStats, aggregateStats } from "@/lib/calc/stats";
import {
  calculateSkillHit,
  calculateAutoAttackAverage,
} from "@/lib/calc/damage";
import { runCombo } from "@/lib/calc/combo";
import itemsData from "@/data/items.normalized.json";
import runesData from "@/data/runes.normalized.json";

type Props = {
  champions: NormalizedChampion[];
};

export default function SimpleCalc({ champions }: Props) {
  const [attackerId, setAttackerId] = useState<number>(champions[0]?.id ?? 1);
  const [targetId, setTargetId] = useState<number>(
    champions[1]?.id ?? champions[0]?.id ?? 1
  );
  const [attackerLevel, setAttackerLevel] = useState<number>(11);
  const [targetLevel, setTargetLevel] = useState<number>(11);
  const [skillIndex, setSkillIndex] = useState<number>(0); // 0..3
  const [skillRank, setSkillRank] = useState<number>(4); // 0..4
  // 距離スライダー（0..1）。距離スケール対応スキルにのみ適用。
  const [distanceFactor, setDistanceFactor] = useState<number>(1);
  const [targetHpPct, setTargetHpPct] = useState<number>(100);
  const [attackerHpPct, setAttackerHpPct] = useState<number>(100);
  const [shield, setShield] = useState<number>(0);
  const [armorRedPct, setArmorRedPct] = useState<number>(0);
  const [mrRedPct, setMrRedPct] = useState<number>(0);
  const [armorRedFlat, setArmorRedFlat] = useState<number>(0);
  const [mrRedFlat, setMrRedFlat] = useState<number>(0);
  // 攻撃側 貫通（UI簡易入力）
  const [armorPenPct, setArmorPenPct] = useState<number>(0);
  const [mrPenPct, setMrPenPct] = useState<number>(0);
  const [armorPenFlat, setArmorPenFlat] = useState<number>(0);
  const [mrPenFlat, setMrPenFlat] = useState<number>(0);
  const [runeAmpPct, setRuneAmpPct] = useState<number>(0);
  // アイテム/ルーン選択
  const [itemIds, setItemIds] = useState<number[]>([0, 0, 0, 0, 0, 0]);
  const [keystoneId, setKeystoneId] = useState<number>(0); // 0 = なし
  const [minorRuneIds, setMinorRuneIds] = useState<number[]>([0, 0]); // 0 = なし（2枠）
  // 防御側 アイテム/ルーン
  const [targetItemIds, setTargetItemIds] = useState<number[]>([
    0, 0, 0, 0, 0, 0,
  ]);
  const [defRuneIds, setDefRuneIds] = useState<number[]>([0, 0, 0]); // 防御系（3枠・任意）
  const [enableDefTimed, setEnableDefTimed] = useState<boolean>(true); // 12分以降の効果を適用
  const [procRunesActive, setProcRunesActive] = useState<boolean>(true); // Proc系ルーンを発動中とみなす
  // 能力上昇（ステータスのかけら）
  type Shard1 = "none" | "adaptive" | "as";
  type Shard2 = "none" | "adaptive";
  const [shard1, setShard1] = useState<Shard1>("none");
  const [shard2, setShard2] = useState<Shard2>("none");
  // コンボビルダー
  type ActionUI =
    | { type: "skill"; skillIndex: number; rank: number; castTime: number }
    | { type: "aa"; castTime: number };
  const [actions, setActions] = useState<ActionUI[]>([]);
  // UI 補助
  const [itemFilter, setItemFilter] = useState<string>("");
  const [runeFilter, setRuneFilter] = useState<string>("");
  const [collapseAtk, setCollapseAtk] = useState<boolean>(false);
  const [collapseDef, setCollapseDef] = useState<boolean>(false);
  const [collapseRes, setCollapseRes] = useState<boolean>(false);
  const [collapseCombo, setCollapseCombo] = useState<boolean>(false);
  // チャンピオン固有（簡易）
  const [applyJinxRocket, setApplyJinxRocket] = useState<boolean>(false);

  const attacker = useMemo(
    () => champions.find((c) => c.id === attackerId) ?? champions[0],
    [champions, attackerId]
  );
  const target = useMemo(
    () => champions.find((c) => c.id === targetId) ?? champions[0],
    [champions, targetId]
  );

  const allItems = itemsData as unknown as NormalizedItem[];
  const allRunes = runesData as unknown as NormalizedRune[];
  const itemsSelected = useMemo(
    () =>
      itemIds
        .map((id) => allItems.find((i) => i.id === id))
        .filter(Boolean) as NormalizedItem[],
    [itemIds, allItems]
  );
  const targetItemsSelected = useMemo(
    () =>
      targetItemIds
        .map((id) => allItems.find((i) => i.id === id))
        .filter(Boolean) as NormalizedItem[],
    [targetItemIds, allItems]
  );
  const allItemsFiltered = useMemo(() => {
    const q = itemFilter.trim();
    if (!q) return allItems;
    return allItems.filter((i) =>
      i.name.toLowerCase().includes(q.toLowerCase())
    );
  }, [allItems, itemFilter]);
  const selectedRunes = useMemo(() => {
    const list: NormalizedRune[] = [];
    const ks = allRunes.find((r) => r.id === keystoneId);
    if (ks) list.push(ks);
    for (const id of minorRuneIds) {
      const m = allRunes.find((r) => r.id === id);
      if (m) list.push(m);
    }
    return list;
  }, [allRunes, keystoneId, minorRuneIds]);
  const selectedDefRunes = useMemo(
    () =>
      defRuneIds
        .map((id) => allRunes.find((r) => r.id === id))
        .filter(Boolean) as NormalizedRune[],
    [defRuneIds, allRunes]
  );
  const runeNameMatch = (name?: string) => {
    const q = runeFilter.trim().toLowerCase();
    if (!q) return true;
    return (name ?? "").toLowerCase().includes(q);
  };
  const atkBase = useMemo(
    () =>
      buildAggregatedStats({
        champion: attacker,
        level: attackerLevel,
        items: itemsSelected,
        runeDamageIncrease: 0,
      }),
    [attacker, attackerLevel, itemsSelected]
  );
  const atkStats = useMemo(() => {
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    // ルーンの条件付き与ダメ増加（簡易）
    const hasActions = (actions?.length ?? 0) > 0;
    const numHits = hasActions ? actions.length : 1; // ざっくり: 各アクションを1ヒット扱い
    const hasAA = hasActions ? actions.some((a) => a.type === "aa") : false;
    const hasSkill = true; // 計算上、最低1スキルは選択されている
    const attackerHpNow = attackerHpPct;
    const targetHpNow = targetHpPct;
    const attackerMaxHP = atkBase.totalHP ?? 0;
    // 対象の最大HPは簡易に: ベース+アイテム（防御ルーンの%増加は無視）
    const targetMaxHP = aggregateStats(
      target.baseStats,
      targetLevel,
      targetItemsSelected
    ).hp;

    const isProcOK = (id: number): boolean => {
      if (!procRunesActive) return false;
      switch (id) {
        case 8005: // プレスアタック: 3ヒット
        case 8112: // 電撃: 3ヒット
          return numHits >= 3;
        case 8229: // 彗星: スキル命中
          return hasSkill;
        case 8369: // FS: 交戦開始
          return true;
        case 8010: // 征服者: スタック
          return numHits >= 4;
        case 8008: // リーサルテンポ: 通常攻撃
          return hasAA;
        case 8351: // グレイシャル: 行動不能（未検知）→トグル任せ
          return true;
        default:
          return true;
      }
    };

    // 与ダメ増加（%増幅）対象を限定して扱う
    // - 8369: ファーストストライク 7%（交戦開始時）
    // - 8005: プレスアタック 8%（3ヒット後）
    // - 8014: 最期の慈悲 8%（相手HP<=40%）
    // - 8299: 背水の陣 5%〜11%（自分のHPに応じて）
    // - 8017: 切り崩し 体力差に応じて最大15%（簡易）
    // それ以外（電撃/彗星/握撃 など追加ダメージ系）は%増幅に含めない
    const condAmp = selectedRunes.reduce((sum, r) => {
      const id = r.id;
      switch (id) {
        case 8369: {
          // First Strike
          return sum + (isProcOK(id) ? 0.07 : 0);
        }
        case 8005: {
          // Press the Attack
          return sum + (isProcOK(id) ? 0.08 : 0);
        }
        case 8014: {
          // Coup de Grace
          return sum + (targetHpNow <= 40 ? 0.08 : 0);
        }
        case 8299: {
          // Last Stand
          if (attackerHpNow <= 30) return sum + 0.11;
          if (attackerHpNow <= 60) return sum + 0.05;
          return sum;
        }
        case 8017: {
          // Cut Down（簡易スケール: 10%超過から最大+15%まで線形）
          if (attackerMaxHP > 0 && targetMaxHP > attackerMaxHP * 1.1) {
            const ratio = Math.min(
              1,
              (targetMaxHP / Math.max(1, attackerMaxHP) - 1.1) / 0.9
            );
            return sum + 0.15 * Math.max(0, ratio);
          }
          return sum;
        }
        default:
          return sum; // その他は%増幅に含めない
      }
    }, 0);

    const runeAmpFromRunes = condAmp;
    // 能力上昇の反映（簡易）
    const addAP =
      (shard1 === "adaptive" ? 9 : 0) + (shard2 === "adaptive" ? 9 : 0);
    const asMult = shard1 === "as" ? 1.1 : 1.0;
    const base = {
      ...atkBase,
      totalAP: atkBase.totalAP + addAP,
      attackSpeed: atkBase.attackSpeed * asMult,
      armorPenPercent: clamp01(atkBase.armorPenPercent + armorPenPct / 100),
      magicPenPercent: clamp01(atkBase.magicPenPercent + mrPenPct / 100),
      armorPenFlat: Math.max(0, atkBase.armorPenFlat + armorPenFlat),
      magicPenFlat: Math.max(0, atkBase.magicPenFlat + mrPenFlat),
      runeDamageIncrease: clamp01(
        atkBase.runeDamageIncrease + runeAmpPct / 100 + runeAmpFromRunes
      ),
    };

    // ジンクスQ（ロケット形態）の簡易オンヒット: +10%AD（物理）
    const isJinx = attacker.alias === "Jinx" || /ジンクス/.test(attacker.name);
    if (isJinx && applyJinxRocket) {
      return {
        ...base,
        onHit: {
          ...base.onHit,
          adRatioPhysical: base.onHit.adRatioPhysical + 0.1,
        },
      };
    }
    return base;
  }, [
    atkBase,
    armorPenPct,
    mrPenPct,
    armorPenFlat,
    mrPenFlat,
    runeAmpPct,
    selectedRunes,
    shard1,
    shard2,
    actions,
    procRunesActive,
    attackerHpPct,
    targetHpPct,
    targetLevel,
    targetItemsSelected,
    target.baseStats,
    attacker.alias,
    attacker.name,
    applyJinxRocket,
  ]);
  // 防御系ルーンからの簡易ステータス加算（説明文からフラット値を抽出）
  const parseFlatFromRune = (
    r: NormalizedRune,
    level: number
  ): {
    hp: number;
    armor: number;
    mr: number;
    armorPct: number;
    mrPct: number;
    gated12m: boolean;
  } => {
    const desc = r.effects?.description ?? "";
    const name = r.name ?? "";
    const findNum = (re: RegExp): number => {
      const m = re.exec(desc);
      if (!m) return 0;
      const n = Number((m[1] ?? "").replace(/[, ]/g, ""));
      return Number.isFinite(n) ? n : 0;
    };
    const findRange = (re: RegExp): [number, number] | null => {
      const m = re.exec(desc);
      if (!m) return null;
      const a = Number((m[1] ?? "").replace(/[, ]/g, ""));
      const b = Number((m[2] ?? "").replace(/[, ]/g, ""));
      if (Number.isFinite(a) && Number.isFinite(b)) return [a, b];
      return null;
    };
    let hp = 0,
      armor = 0,
      mr = 0;
    let armorPct = 0,
      mrPct = 0;
    const gated12m = /12\s*分/.test(desc);
    // 明示のフラット
    hp += findNum(/体力\s*\+\s*([0-9]+)/);
    armor += findNum(/(物理防御|アーマー)\s*\+\s*([0-9]+)/);
    mr += findNum(/(魔法防御|魔法耐性)\s*\+\s*([0-9]+)/);
    // スケーリング系（線形近似 1..18）
    const hpRange = findRange(/体力\s*\+\s*([0-9]+)\s*-\s*([0-9]+)/);
    if (hpRange) {
      const t = (Math.max(1, Math.min(18, Math.floor(level))) - 1) / 17;
      hp += Math.round(hpRange[0] + (hpRange[1] - hpRange[0]) * t);
    }
    const defRange = findRange(
      /物理\/魔法防御\([^)]*\)\s*\+\s*([0-9]+)\s*-\s*([0-9]+)/
    );
    if (defRange) {
      const t = (Math.max(1, Math.min(18, Math.floor(level))) - 1) / 17;
      const val = Math.round(defRange[0] + (defRange[1] - defRange[0]) * t);
      armor += val;
      mr += val;
    }
    // ％増加（両方）
    const bothPct = /物理防御.*?魔法防御.*?([0-9]+)\s*%\s*増加/.exec(desc);
    if (bothPct) {
      const v = Number(bothPct[1]);
      if (Number.isFinite(v)) {
        armorPct += v / 100;
        mrPct += v / 100;
      }
    }
    // 個別％増加
    const aPct = /(物理防御|アーマー)[^%]*([0-9]+)\s*%\s*増加/.exec(desc);
    if (aPct) {
      const v = Number(aPct[2]);
      if (Number.isFinite(v)) armorPct += v / 100;
    }
    const mPct = /(魔法防御|魔法耐性)[^%]*([0-9]+)\s*%\s*増加/.exec(desc);
    if (mPct) {
      const v = Number(mPct[2]);
      if (Number.isFinite(v)) mrPct += v / 100;
    }

    // 一部の命名での簡易対応
    if (/アイアンスキン/.test(name)) armor += 5;
    if (/ミラーシェル/.test(name)) mr += 6;
    return { hp, armor, mr, armorPct, mrPct, gated12m };
  };

  const tgtBase = useMemo(() => {
    const base = aggregateStats(
      target.baseStats,
      targetLevel,
      targetItemsSelected
    );
    // 防御系ルーン反映
    let addHP = 0,
      addArmor = 0,
      addMR = 0;
    let addArmorPct = 0,
      addMrPct = 0;
    for (const r of selectedDefRunes) {
      const adds = parseFlatFromRune(r, targetLevel);
      const gated = adds.gated12m && !enableDefTimed;
      if (!gated) {
        addHP += adds.hp;
        addArmor += adds.armor;
        addMR += adds.mr;
        addArmorPct += adds.armorPct;
        addMrPct += adds.mrPct;
      }
    }
    const armorBeforePct = base.armor + addArmor;
    const mrBeforePct = base.mr + addMR;
    const finalArmor = Math.max(0, armorBeforePct * (1 + addArmorPct));
    const finalMr = Math.max(0, mrBeforePct * (1 + addMrPct));
    return { ...base, hp: base.hp + addHP, armor: finalArmor, mr: finalMr };
  }, [
    target,
    targetLevel,
    targetItemsSelected,
    selectedDefRunes,
    enableDefTimed,
  ]);

  const targetHp = useMemo(
    () => ({
      max: Math.round(tgtBase.hp),
      current: Math.round(tgtBase.hp * (targetHpPct / 100)),
    }),
    [tgtBase.hp, targetHpPct]
  );

  const skill =
    attacker.skills[
      Math.max(0, Math.min(skillIndex, attacker.skills.length - 1))
    ];
  // ランク数: 通常はQ/W/E=5, R=3。データ配列がある場合はその範囲に丸める。
  const expectedRanks = skillIndex === 3 ? 3 : 5;
  const actualLen = Array.isArray(skill.damage.base)
    ? skill.damage.base.length
    : 0;
  const baseLen =
    actualLen > 0 ? Math.min(expectedRanks, actualLen) : expectedRanks; // 配列が空なら期待値
  const maxRank = Math.max(0, baseLen - 1);
  const rank = Math.max(0, Math.min(skillRank, maxRank));

  const skillRes = useMemo(
    () =>
      calculateSkillHit(
        skill,
        rank,
        atkStats,
        {
          armor: tgtBase.armor,
          mr: tgtBase.mr,
          hp: targetHp,
          armorReductionPercent: armorRedPct / 100,
          mrReductionPercent: mrRedPct / 100,
          armorReductionFlat: armorRedFlat,
          mrReductionFlat: mrRedFlat,
        },
        skill.damage.distanceBase ? { distanceFactor } : undefined
      ),
    [
      skill,
      rank,
      atkStats,
      tgtBase.armor,
      tgtBase.mr,
      targetHp,
      armorRedPct,
      mrRedPct,
      armorRedFlat,
      mrRedFlat,
  distanceFactor,
    ]
  );
  const comboRes = useMemo(
    () =>
      runCombo(
        [
          {
            type: "skill",
            name: ["Q", "W", "E", "R"][skillIndex] ?? "Skill",
            skill,
            rank,
            castTime: 0.25,
          },
        ],
        atkStats,
        {
          armor: tgtBase.armor,
          mr: tgtBase.mr,
          hp: { ...targetHp },
          shield,
          armorReductionPercent: armorRedPct / 100,
          mrReductionPercent: mrRedPct / 100,
          armorReductionFlat: armorRedFlat,
          mrReductionFlat: mrRedFlat,
        },
        skill.damage.distanceBase ? { distanceFactor } : undefined
      ),
    [
      atkStats,
      tgtBase.armor,
      tgtBase.mr,
      targetHp,
      shield,
      armorRedPct,
      mrRedPct,
      armorRedFlat,
      mrRedFlat,
      skill,
      rank,
      skillIndex,
  distanceFactor,
    ]
  );

  // 距離スケールUI（該当スキルのみ表示）
  const DistanceSlider = () => {
    if (!skill?.damage?.distanceBase) return null;
    const sliderVal = Math.round(distanceFactor * 100);
    return (
      <div className="mt-2">
        <div className="text-xs text-slate-600 dark:text-slate-300 mb-1">
          距離係数（最短 0 ↔ 最長 1）
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={sliderVal}
          onChange={(e) => setDistanceFactor(Number(e.currentTarget.value) / 100)}
          onInput={(e) => setDistanceFactor(Number((e.target as HTMLInputElement).value) / 100)}
          className="w-full h-3 cursor-pointer accent-slate-900"
        />
        <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-1">
          <span>{distanceFactor.toFixed(2)}</span>
          <Input
            className="w-16 h-6"
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={distanceFactor}
            onChange={(e) => {
              const v = Math.max(0, Math.min(1, Number((e.target as HTMLInputElement).value)));
              if (!Number.isNaN(v)) setDistanceFactor(v);
            }}
          />
        </div>
      </div>
    );
  };

  const aaRes = useMemo(
    () =>
      calculateAutoAttackAverage(atkStats, {
        armor: tgtBase.armor,
        mr: tgtBase.mr,
        armorReductionPercent: armorRedPct / 100,
        armorReductionFlat: armorRedFlat,
        mrReductionPercent: mrRedPct / 100,
        mrReductionFlat: mrRedFlat,
      }),
    [
      atkStats,
      tgtBase.armor,
      tgtBase.mr,
      armorRedPct,
      armorRedFlat,
      mrRedPct,
      mrRedFlat,
    ]
  );

  // コンボビルダー: 実行結果
  const builtActions: ComboAction[] = useMemo(() => {
    return actions.map((a) => {
      if (a.type === "aa")
        return { type: "aa", name: "AA", castTime: a.castTime } as ComboAction;
      const idx = Math.max(0, Math.min(3, a.skillIndex));
      const s = attacker.skills[idx];
      const expected = idx === 3 ? 3 : 5;
      const sActual = Array.isArray(s.damage.base) ? s.damage.base.length : 0;
      const sLen = sActual > 0 ? Math.min(expected, sActual) : expected;
      const r = Math.max(0, Math.min(sLen - 1, a.rank));
      return {
        type: "skill",
        name: ["Q", "W", "E", "R"][idx] ?? "Skill",
        skill: s,
        rank: r,
        castTime: a.castTime,
      } as ComboAction;
    });
  }, [actions, attacker.skills]);

  const comboBuiltRes = useMemo(() => {
    if (!builtActions.length) return null;
    return runCombo(
      builtActions,
      atkStats,
      {
        armor: tgtBase.armor,
        mr: tgtBase.mr,
        hp: { ...targetHp },
        shield,
        armorReductionPercent: armorRedPct / 100,
        mrReductionPercent: mrRedPct / 100,
        armorReductionFlat: armorRedFlat,
        mrReductionFlat: mrRedFlat,
      },
      // 距離係数はビルド済みコンボでも適用（距離スケール持ちアクションが含まれる可能性）
      { distanceFactor }
    );
  }, [
    builtActions,
    atkStats,
    tgtBase.armor,
    tgtBase.mr,
    targetHp,
    shield,
    armorRedPct,
    mrRedPct,
    armorRedFlat,
    mrRedFlat,
    distanceFactor,
  ]);

  const dpsInfo = useMemo(() => {
    const res = comboBuiltRes ?? comboRes; // デフォルトで単発のほう
    if (!res) return null;
    const timeline = res.timeline;
    const duration = timeline.length
      ? Math.max(...timeline.map((x) => x.time))
      : 0;
    const total = res.totalDamage;
    const dps = duration > 0 ? total / duration : total;
    // 秒間ダメージ（ビン）
    const N = Math.max(1, Math.ceil(duration));
    const bins = Array.from({ length: N }, () => 0);
    for (const ev of timeline) {
      const idx = Math.min(N - 1, Math.floor(ev.time));
      bins[idx] += ev.damage;
    }
    return { duration, total, dps, bins };
  }, [comboBuiltRes, comboRes]);

  // 可視化用: 体力バー（攻撃後のみ）
  const HpBar: React.FC<{ max: number; before: number; after: number }> = ({
    max,
    after,
  }) => {
    const m = Math.max(1, max);
    const aPct = Math.max(0, Math.min(100, (after / m) * 100));
    return (
      <div className="mt-2 text-xs">
        <div className="mb-0.5 text-[11px] text-slate-600 dark:text-slate-300">
          残りHP {Math.round(after)} / {Math.round(max)} ({aPct.toFixed(1)}%)
        </div>
        <div className="h-2 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden">
          <div
            className="h-full bg-emerald-500"
            style={{ width: `${aPct}%` }}
          />
        </div>
      </div>
    );
  };

  // 共有リンクとローカル保存
  type ShareState = {
    attackerId: number;
    targetId: number;
    attackerLevel: number;
    targetLevel: number;
    targetHpPct: number;
    shield: number;
    attackerHpPct: number;
    procRunesActive: boolean;
    armorRedPct: number;
    mrRedPct: number;
    armorRedFlat: number;
    mrRedFlat: number;
    armorPenPct: number;
    mrPenPct: number;
    armorPenFlat: number;
    mrPenFlat: number;
    runeAmpPct: number;
    itemIds: number[];
    keystoneId: number;
    minorRuneIds: number[];
    targetItemIds: number[];
    defRuneIds: number[];
    shard1: Shard1;
    shard2: Shard2;
    actions: ActionUI[];
    skillIndex: number;
    skillRank: number;
    applyJinxRocket: boolean;
    distanceFactor?: number;
  };
  const buildShareState = (): ShareState => ({
    attackerId,
    targetId,
    attackerLevel,
    targetLevel,
    targetHpPct,
    shield,
    attackerHpPct,
    procRunesActive,
    armorRedPct,
    mrRedPct,
    armorRedFlat,
    mrRedFlat,
    armorPenPct,
    mrPenPct,
    armorPenFlat,
    mrPenFlat,
    runeAmpPct,
    itemIds,
    keystoneId,
    minorRuneIds,
    targetItemIds,
    defRuneIds,
    shard1,
    shard2,
    actions,
    skillIndex,
    skillRank,
    applyJinxRocket,
    distanceFactor,
  });

  const applyShareState = (s: Partial<ShareState> & { runeId?: number }) => {
    if (!s || typeof s !== "object") return;
    if (s.attackerId) setAttackerId(s.attackerId);
    if (s.targetId) setTargetId(s.targetId);
    if (s.attackerLevel) setAttackerLevel(s.attackerLevel);
    if (s.targetLevel) setTargetLevel(s.targetLevel);
    if (s.targetHpPct != null) setTargetHpPct(s.targetHpPct);
    if (s.attackerHpPct != null) setAttackerHpPct(s.attackerHpPct);
    if (s.shield != null) setShield(s.shield);
    if (s.procRunesActive != null) setProcRunesActive(s.procRunesActive);
    if (s.armorRedPct != null) setArmorRedPct(s.armorRedPct);
    if (s.mrRedPct != null) setMrRedPct(s.mrRedPct);
    if (s.armorRedFlat != null) setArmorRedFlat(s.armorRedFlat);
    if (s.mrRedFlat != null) setMrRedFlat(s.mrRedFlat);
    if (s.armorPenPct != null) setArmorPenPct(s.armorPenPct);
    if (s.mrPenPct != null) setMrPenPct(s.mrPenPct);
    if (s.armorPenFlat != null) setArmorPenFlat(s.armorPenFlat);
    if (s.mrPenFlat != null) setMrPenFlat(s.mrPenFlat);
    if (s.runeAmpPct != null) setRuneAmpPct(s.runeAmpPct);
    if (Array.isArray(s.itemIds)) setItemIds(s.itemIds);
    if (s.keystoneId != null) setKeystoneId(s.keystoneId);
    if (Array.isArray(s.minorRuneIds)) setMinorRuneIds(s.minorRuneIds);
    if (Array.isArray(s.targetItemIds)) setTargetItemIds(s.targetItemIds);
    if (Array.isArray(s.defRuneIds)) setDefRuneIds(s.defRuneIds);
    if (s.shard1) setShard1(s.shard1);
    if (s.shard2) setShard2(s.shard2);
    if (s.runeId != null) {
      const r = allRunes.find((x) => x.id === s.runeId);
      if (r?.isKeystone) setKeystoneId(r.id);
      else if (r) setMinorRuneIds((prev) => [r.id, prev[1]]);
    }
    if (Array.isArray(s.actions)) setActions(s.actions);
    if (s.skillIndex != null) setSkillIndex(s.skillIndex);
    if (s.skillRank != null) setSkillRank(s.skillRank);
    if (typeof (s as Partial<ShareState>).applyJinxRocket === "boolean")
      setApplyJinxRocket(s.applyJinxRocket as boolean);
    if (typeof s.distanceFactor === "number")
      setDistanceFactor(s.distanceFactor);
  };

  useEffect(() => {
    // decode from URL ?s=
    try {
      const sp = new URLSearchParams(window.location.search);
      const enc = sp.get("s");
      if (enc) {
        const json = decodeURIComponent(atob(enc));
        const obj = JSON.parse(json);
        applyShareState(obj);
        return; // URL優先、LSは無視
      }
      const raw = localStorage.getItem("calcStateV1");
      if (raw) {
        const obj = JSON.parse(raw);
        applyShareState(obj);
      }
    } catch {}
    // 初期値: アタッカーのQを1回
    if (actions.length === 0)
      setActions([{ type: "skill", skillIndex: 0, rank: 0, castTime: 0.25 }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      const st: ShareState = {
        attackerId,
        targetId,
        attackerLevel,
        targetLevel,
        targetHpPct,
        shield,
        attackerHpPct,
        procRunesActive,
        armorRedPct,
        mrRedPct,
        armorRedFlat,
        mrRedFlat,
        armorPenPct,
        mrPenPct,
        armorPenFlat,
        mrPenFlat,
        runeAmpPct,
        itemIds,
        keystoneId,
        minorRuneIds,
        targetItemIds,
        defRuneIds,
        shard1,
        shard2,
        actions,
        skillIndex,
        skillRank,
        applyJinxRocket,
        distanceFactor,
      };
      localStorage.setItem("calcStateV1", JSON.stringify(st));
    } catch {}
  }, [
    attackerId,
    targetId,
    attackerLevel,
    targetLevel,
    targetHpPct,
    attackerHpPct,
    procRunesActive,
    shield,
    armorRedPct,
    mrRedPct,
    armorRedFlat,
    mrRedFlat,
    armorPenPct,
    mrPenPct,
    armorPenFlat,
    mrPenFlat,
    runeAmpPct,
    itemIds,
    keystoneId,
    minorRuneIds,
    targetItemIds,
    defRuneIds,
    shard1,
    shard2,
    actions,
    skillIndex,
    skillRank,
    applyJinxRocket,
    distanceFactor,
  ]);

  const copyShareLink = async () => {
    try {
      const st = buildShareState();
      const enc = btoa(encodeURIComponent(JSON.stringify(st)));
      const url = new URL(window.location.href);
      url.searchParams.set("s", enc);
      await navigator.clipboard.writeText(url.toString());
      alert("共有リンクをコピーしました");
    } catch {
      alert("共有リンクの作成に失敗しました");
    }
  };

  // ...（中略: 既存UI）

  // プリセット適用
  const findItemId = (name: string) =>
    allItems.find((i) => i.name.includes(name))?.id ?? 0;
  const findRuneId = (name: string) =>
    allRunes.find((r) => (r.name ?? "").includes(name))?.id ?? 0;
  const applyPresetADC = () => {
    const ie = findItemId("インフィニティ エッジ");
    const pd = findItemId("ファントム ダンサー");
    const rfc = findItemId("ラピッド ファイアキャノン");
    setItemIds([ie, pd, rfc, 0, 0, 0]);
    setKeystoneId(findRuneId("プレスアタック"));
    const minor1 = findRuneId("切り崩し");
    const minor2 = findRuneId("アクシオム");
    setMinorRuneIds([minor1, minor2]);
  };
  const applyPresetAP = () => {
    const luden = findItemId("ルーデン");
    const rabadon = findItemId("ラバドン");
    const nashor = findItemId("ナッシャー");
    setItemIds([luden, rabadon, nashor, 0, 0, 0]);
    setKeystoneId(findRuneId("秘儀の彗星"));
    const minor1 = findRuneId("切り崩し");
    const minor2 = findRuneId("アクシオム");
    setMinorRuneIds([minor1, minor2]);
  };
  const applyPresetTankDef = () => {
    const sunfire = findItemId("サンファイア");
    const thorn = findItemId("ソーンメイル");
    setTargetItemIds([sunfire, thorn, 0, 0, 0, 0]);
    const mirror = findRuneId("ミラーシェル");
    setDefRuneIds([mirror, 0, 0]);
  };

  const clearAtkItems = () => setItemIds([0, 0, 0, 0, 0, 0]);
  const clearDefItems = () => setTargetItemIds([0, 0, 0, 0, 0, 0]);
  const clearDefRunes = () => setDefRuneIds([0, 0, 0]);

  return (
    <div className="w-full max-w-screen-lg mx-auto grid gap-4">
      <h1 className="text-xl font-semibold">LoL Damage Calculator (MVP)</h1>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="font-medium mr-2">プリセット:</span>
        <Button variant="outline" size="sm" onClick={applyPresetADC}>
          ADC攻撃
        </Button>
        <Button variant="outline" size="sm" onClick={applyPresetAP}>
          AP攻撃
        </Button>
        <Button variant="outline" size="sm" onClick={applyPresetTankDef}>
          タンク防御
        </Button>
      </div>
      <div className="grid sm:grid-cols-3 gap-4 auto-rows-min">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-medium">攻撃側</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCollapseAtk((v) => !v)}
            >
              {collapseAtk ? "展開" : "折りたたみ"}
            </Button>
          </div>
          {!collapseAtk && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
                <label className="block">
                  チャンピオン
                  <SearchSelect
                    className="ml-2"
                    options={champions.map((c) => ({
                      label: c.name,
                      value: c.id,
                    }))}
                    value={attackerId}
                    onChange={(v) => setAttackerId(Number(v))}
                    placeholder="チャンピオン検索"
                  />
                </label>
                <label className="block">
                  レベル
                  <Input
                    className="ml-2 w-20"
                    type="number"
                    min={1}
                    max={18}
                    value={attackerLevel}
                    onChange={(e) =>
                      setAttackerLevel(
                        Number((e.target as HTMLInputElement).value)
                      )
                    }
                  />
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
                <label className="block">
                  スキル
                  <SearchSelect
                    className="ml-2"
                    options={attacker.skills.slice(0, 4).map((s, i) => ({
                      label: `${["Q", "W", "E", "R"][i] ?? `S${i + 1}`} - ${
                        s.name
                      }`,
                      value: i,
                    }))}
                    value={skillIndex}
                    onChange={(v) => setSkillIndex(Number(v))}
                    placeholder="スキル検索"
                  />
                </label>
                <label className="block">
                  スキルレベル
                  <Input
                    className="ml-2 w-20"
                    type="number"
                    min={1}
                    max={baseLen}
                    value={rank + 1}
                    onChange={(e) =>
                      setSkillRank(
                        Math.max(
                          0,
                          Math.min(
                            baseLen - 1,
                            Number((e.target as HTMLInputElement).value) - 1
                          )
                        )
                      )
                    }
                  />
                  <span className="ml-2 text-xs">1〜{baseLen}</span>
                </label>
              </div>
              {(() => {
                const isJinx =
                  attacker.alias === "Jinx" || /ジンクス/.test(attacker.name);
                if (!isJinx) return null;
                return (
                  <label className="mb-2 text-xs inline-flex items-center gap-2">
                    <Checkbox
                      checked={applyJinxRocket}
                      onChange={(e) =>
                        setApplyJinxRocket(
                          (e.target as HTMLInputElement).checked
                        )
                      }
                    />
                    Jinx Q: ロケット形態の追加ダメージを適用（+10%
                    ADをオンヒットに加算）
                  </label>
                );
              })()}
              {/* 距離スライダー（対応スキルのみ表示） */}
              <DistanceSlider />
              <div className="mt-2 text-xs flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-2">
                  <Checkbox
                    checked={procRunesActive}
                    onChange={(e) =>
                      setProcRunesActive((e.target as HTMLInputElement).checked)
                    }
                  />
                  Proc系ルーンを発動中として計算（電撃/プレスアタック/彗星
                  など）
                </label>
                <div className="flex items-center gap-2">
                  <span>攻撃側 現在HP</span>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    step={1}
                    value={attackerHpPct}
                    onChange={(e) =>
                      setAttackerHpPct(
                        Number((e.target as HTMLInputElement).value)
                      )
                    }
                    className="w-40 red"
                  />
                  <span className="tabular-nums w-10 text-right">
                    {attackerHpPct}%
                  </span>
                  <div className="flex gap-1">
                    {[100, 75, 50, 35, 25, 10].map((p) => (
                      <Button
                        key={p}
                        variant="outline"
                        size="sm"
                        onClick={() => setAttackerHpPct(p)}
                      >
                        {p}%
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-2">
                <div className="text-sm mb-1">アイテム（最大6）</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                  {itemIds.map((id, idx) => (
                    <SearchSelect
                      key={idx}
                      options={[
                        { label: "なし", value: 0 },
                        ...allItems.map((it) => ({
                          label: it.name,
                          value: it.id,
                        })),
                      ]}
                      value={id}
                      onChange={(v) =>
                        setItemIds((prev) =>
                          prev.map((x, i) => (i === idx ? Number(v) : x))
                        )
                      }
                      placeholder="アイテム検索"
                    />
                  ))}
                </div>
              </div>
              <div className="mt-2 space-y-1">
                <div className="text-sm">与ダメ系ルーン</div>
                <div className="text-xs flex flex-wrap gap-2 items-center">
                  <label>
                    キーストーン
                    <SearchSelect
                      className="ml-2 min-w-48"
                      options={[
                        { label: "なし", value: 0 },
                        ...allRunes
                          .filter((r) => r.isKeystone)
                          .map((r) => {
                            const id = r.id;
                            const ampLabel =
                              id === 8369
                                ? "+7%"
                                : id === 8005
                                ? "+8%"
                                : id === 8014
                                ? "+8%"
                                : ""; // その他は表示しない
                            return {
                              label: ampLabel ? `${r.name} (${ampLabel})` : r.name,
                              value: r.id,
                            };
                          }),
                      ]}
                      value={keystoneId}
                      onChange={(v) => setKeystoneId(Number(v))}
                      placeholder="キーストーン検索"
                    />
                  </label>
                  {minorRuneIds.map((id, idx) => (
                    <label key={idx}>
                      サブルーン{idx + 1}
                      <SearchSelect
                        className="ml-2 min-w-48"
                        options={[
                          { label: "なし", value: 0 },
                          ...allRunes
                            .filter(
                              (r) => !r.isKeystone && [8299, 8014, 8017].includes(r.id)
                            )
                            .map((r) => {
                              const id = r.id;
                              const ampLabel =
                                id === 8299
                                  ? "+5〜11%"
                                  : id === 8014
                                  ? "+8%"
                                  : id === 8017
                                  ? "最大+15%"
                                  : "";
                              return { label: `${r.name} (${ampLabel})`, value: r.id };
                            }),
                        ]}
                        value={id}
                        onChange={(v) =>
                          setMinorRuneIds((prev) =>
                            prev.map((x, i) => (i === idx ? Number(v) : x))
                          )
                        }
                        placeholder="サブルーン検索"
                      />
                    </label>
                  ))}
                </div>
                <div className="text-xs flex flex-wrap gap-4 items-center pt-1">
                  <label>
                    能力上昇1
                    <Select
                      className="ml-2 w-40"
                      value={shard1}
                      onChange={(e) => setShard1(e.target.value as Shard1)}
                    >
                      <option value="none">なし</option>
                      <option value="adaptive">適応力（+AP）</option>
                      <option value="as">攻撃速度（+10%）</option>
                    </Select>
                  </label>
                  <label>
                    能力上昇2
                    <Select
                      className="ml-2 w-40"
                      value={shard2}
                      onChange={(e) => setShard2(e.target.value as Shard2)}
                    >
                      <option value="none">なし</option>
                      <option value="adaptive">適応力（+AP）</option>
                    </Select>
                  </label>
                </div>
              </div>

              <div className="mt-3 text-xs rounded-md p-2 bg-slate-200/60 dark:bg-slate-800/50 space-y-1">
                <div className="font-medium">攻撃側 合計ステータス</div>
                <div>
                  AD: {Math.round(atkStats.totalAD)} / AP:{" "}
                  {Math.round(atkStats.totalAP)} / AS:{" "}
                  {atkStats.attackSpeed.toFixed(2)}
                </div>
                <div>
                  Crit: {(atkStats.critChance * 100).toFixed(0)}% / CritDmg:{" "}
                  {(atkStats.critDamage * 100).toFixed(0)}%
                </div>
                <div>
                  物理貫通: {(atkStats.armorPenPercent * 100).toFixed(0)}% +{" "}
                  {Math.round(atkStats.armorPenFlat)}
                </div>
                <div>
                  魔法貫通: {(atkStats.magicPenPercent * 100).toFixed(0)}% +{" "}
                  {Math.round(atkStats.magicPenFlat)}
                </div>
                <div>
                  与ダメ増加: {(atkStats.runeDamageIncrease * 100).toFixed(0)}%
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                <label>
                  AR貫通%{" "}
                  <Input
                    className="ml-2 w-20"
                    type="number"
                    min={0}
                    max={100}
                    value={armorPenPct}
                    onChange={(e) =>
                      setArmorPenPct(
                        Number((e.target as HTMLInputElement).value)
                      )
                    }
                  />
                </label>
                <label>
                  MR貫通%{" "}
                  <Input
                    className="ml-2 w-20"
                    type="number"
                    min={0}
                    max={100}
                    value={mrPenPct}
                    onChange={(e) =>
                      setMrPenPct(Number((e.target as HTMLInputElement).value))
                    }
                  />
                </label>
                <label>
                  AR貫通固定{" "}
                  <Input
                    className="ml-2 w-20"
                    type="number"
                    min={0}
                    value={armorPenFlat}
                    onChange={(e) =>
                      setArmorPenFlat(
                        Number((e.target as HTMLInputElement).value)
                      )
                    }
                  />
                </label>
                <label>
                  MR貫通固定{" "}
                  <Input
                    className="ml-2 w-20"
                    type="number"
                    min={0}
                    value={mrPenFlat}
                    onChange={(e) =>
                      setMrPenFlat(Number((e.target as HTMLInputElement).value))
                    }
                  />
                </label>
                <label>
                  与ダメ増加%{" "}
                  <Input
                    className="ml-2 w-20"
                    type="number"
                    min={0}
                    max={100}
                    value={runeAmpPct}
                    onChange={(e) =>
                      setRuneAmpPct(
                        Number((e.target as HTMLInputElement).value)
                      )
                    }
                  />
                </label>
              </div>
            </>
          )}
        </Card>
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-medium">結果</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCollapseRes((v) => !v)}
            >
              {collapseRes ? "展開" : "折りたたみ"}
            </Button>
          </div>
          {!collapseRes && (
            <div className="grid sm:grid-cols-1 gap-4">
              <div>
                <div className="font-medium">
                  スキル:{" "}
                  {["Q", "W", "E", "R"][skillIndex] ?? `S${skillIndex + 1}`} -{" "}
                  {skill.name} (Rank {rank + 1})
                </div>
                <div className="mt-1">軽減前: {Math.round(skillRes.raw)}</div>
                <div>
                  最終ダメージ合計:{" "}
                  <span className="font-semibold">
                    {Math.round(skillRes.final)}
                  </span>{" "}
                  / OV回復: {Math.round(skillRes.heal)}
                </div>
                {typeof skillRes.breakdown.dotFinal === "number" && (
                  <div className="text-xs text-gray-600">
                    内訳: 即時+DoT 合算（DoT{" "}
                    {Math.round(skillRes.breakdown.dotFinal)}）
                  </div>
                )}
                {(() => {
                  const before = targetHp.current;
                  // 単発スキルは comboRes の最終HPを参照（シールドやDoT適用後）
                  const after = (() => {
                    if (comboRes && comboRes.timeline.length)
                      return Math.round(
                        comboRes.timeline[comboRes.timeline.length - 1].hpAfter
                      );
                    // フォールバック: シールド考慮の概算
                    const dmg = Math.max(0, skillRes.final - shield);
                    return Math.max(0, before - dmg);
                  })();
                  return (
                    <HpBar max={targetHp.max} before={before} after={after} />
                  );
                })()}
                {comboRes.timeline.length > 1 && (
                  <div className="mt-2 text-xs">
                    <div className="font-medium">DoTタイムライン</div>
                    <ul className="list-disc ml-4">
                      {comboRes.timeline
                        .filter((x) => x.name.endsWith("-DoT"))
                        .map((x, i) => (
                          <li key={i}>
                            {x.time.toFixed(1)}s: {Math.round(x.damage)}{" "}
                            ダメージ → HP {Math.round(x.hpAfter)}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </div>
              <div>
                <div className="font-medium">通常攻撃（平均）</div>
                <div className="mt-1">一撃: {Math.round(aaRes.avgCritHit)}</div>
                <div>
                  最終ダメージ:{" "}
                  <span className="font-semibold">
                    {Math.round(aaRes.final)}
                  </span>{" "}
                  / LS回復: {Math.round(aaRes.lifestealHeal)}
                </div>
                {(() => {
                  const before = targetHp.current;
                  const dmg = Math.max(0, aaRes.final - shield);
                  const after = Math.max(0, before - dmg);
                  return (
                    <HpBar max={targetHp.max} before={before} after={after} />
                  );
                })()}
              </div>
            </div>
          )}
        </Card>
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-medium">対象（防御側）</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCollapseDef((v) => !v)}
            >
              {collapseDef ? "展開" : "折りたたみ"}
            </Button>
          </div>
          {!collapseDef && (
            <>
              <label className="block mb-2">
                チャンピオン
                <SearchSelect
                  className="ml-2"
                  options={champions.map((c) => ({
                    label: c.name,
                    value: c.id,
                  }))}
                  value={targetId}
                  onChange={(v) => setTargetId(Number(v))}
                  placeholder="チャンピオン検索"
                />
              </label>
              <div className="mt-2 text-xs flex items-center gap-2">
                <label className="inline-flex items-center gap-2">
                  <Checkbox
                    checked={enableDefTimed}
                    onChange={(e) =>
                      setEnableDefTimed((e.target as HTMLInputElement).checked)
                    }
                  />
                  12分以降の効果を適用（心身調整など）
                </label>
              </div>
              <label className="block mb-2">
                レベル
                <input
                  className="ml-2 border px-2 py-1 w-16"
                  type="number"
                  min={1}
                  max={18}
                  value={targetLevel}
                  onChange={(e) => setTargetLevel(Number(e.target.value))}
                />
              </label>
              <div className="mt-2">
                <div className="flex items-end justify-between mb-1">
                  <div className="text-sm">アイテム（最大6）</div>
                  <div className="text-xs flex items-center gap-2">
                    <label>
                      検索{" "}
                      <Input
                        className="w-28"
                        value={itemFilter}
                        onChange={(e) =>
                          setItemFilter((e.target as HTMLInputElement).value)
                        }
                      />
                    </label>
                    <Button variant="outline" size="sm" onClick={clearAtkItems}>
                      攻撃側クリア
                    </Button>
                    <Button variant="outline" size="sm" onClick={clearDefItems}>
                      防御側クリア
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                  {targetItemIds.map((id, idx) => (
                    <SearchSelect
                      key={idx}
                      options={[
                        { label: "なし", value: 0 },
                        ...allItemsFiltered.map((it) => ({
                          label: it.name,
                          value: it.id,
                        })),
                      ]}
                      value={id}
                      onChange={(v) =>
                        setTargetItemIds((prev) =>
                          prev.map((x, i) => (i === idx ? Number(v) : x))
                        )
                      }
                      placeholder="アイテム検索"
                    />
                  ))}
                </div>
              </div>
              <div className="mt-2">
                <div className="flex items-end justify-between mb-1">
                  <div className="text-sm">防御系ルーン（任意・最大3）</div>
                  <div className="text-xs flex items-center gap-2">
                    <label>
                      検索{" "}
                      <Input
                        className="w-28"
                        value={runeFilter}
                        onChange={(e) =>
                          setRuneFilter((e.target as HTMLInputElement).value)
                        }
                      />
                    </label>
                    <Button variant="outline" size="sm" onClick={clearDefRunes}>
                      防御ルーンクリア
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  {defRuneIds.map((id, idx) => {
                    const options = [
                      { label: "なし", value: 0 },
                      ...allRunes
                        .filter((r) => {
                          const d =
                            (r.effects?.description ?? "") +
                            " " +
                            (r.name ?? "");
                          return /(物理防御|アーマー|魔法防御|魔法耐性|体力|防御力のスケーリング|体力の伸び|アイアンスキン|ミラーシェル)/.test(
                            d
                          );
                        })
                        .filter((r) => runeNameMatch(r.name))
                        .map((r) => ({ label: r.name!, value: r.id })),
                    ];
                    return (
                      <SearchSelect
                        key={idx}
                        options={options}
                        value={id}
                        onChange={(v) =>
                          setDefRuneIds((prev) =>
                            prev.map((x, i) => (i === idx ? Number(v) : x))
                          )
                        }
                        placeholder="防御ルーン検索"
                      />
                    );
                  })}
                </div>
              </div>
              <div className="mb-2 text-xs flex items-center gap-2">
                <span>現在HP</span>
                <input
                  type="range"
                  min={1}
                  max={100}
                  step={1}
                  value={targetHpPct}
                  onChange={(e) =>
                    setTargetHpPct(Number((e.target as HTMLInputElement).value))
                  }
                  className="w-40 accent-slate-900"
                />
                <span className="tabular-nums w-10 text-right">
                  {targetHpPct}%
                </span>
                <div className="flex gap-1">
                  {[100, 75, 50, 35, 25, 10].map((p) => (
                    <Button
                      key={p}
                      variant="outline"
                      size="sm"
                      onClick={() => setTargetHpPct(p)}
                    >
                      {p}%
                    </Button>
                  ))}
                </div>
                <span className="ml-2">
                  {targetHp.current} / {targetHp.max}
                </span>
              </div>
              <label className="block mb-2">
                シールド
                <Input
                  className="ml-2 w-24"
                  type="number"
                  min={0}
                  value={shield}
                  onChange={(e) =>
                    setShield(Number((e.target as HTMLInputElement).value))
                  }
                />
              </label>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <label>
                  AR減少%{" "}
                  <Input
                    className="ml-2 w-20"
                    type="number"
                    min={0}
                    max={100}
                    value={armorRedPct}
                    onChange={(e) =>
                      setArmorRedPct(
                        Number((e.target as HTMLInputElement).value)
                      )
                    }
                  />
                </label>
                <label>
                  MR減少%{" "}
                  <Input
                    className="ml-2 w-20"
                    type="number"
                    min={0}
                    max={100}
                    value={mrRedPct}
                    onChange={(e) =>
                      setMrRedPct(Number((e.target as HTMLInputElement).value))
                    }
                  />
                </label>
                <label>
                  AR減少固定{" "}
                  <Input
                    className="ml-2 w-20"
                    type="number"
                    min={0}
                    value={armorRedFlat}
                    onChange={(e) =>
                      setArmorRedFlat(
                        Number((e.target as HTMLInputElement).value)
                      )
                    }
                  />
                </label>
                <label>
                  MR減少固定{" "}
                  <Input
                    className="ml-2 w-20"
                    type="number"
                    min={0}
                    value={mrRedFlat}
                    onChange={(e) =>
                      setMrRedFlat(Number((e.target as HTMLInputElement).value))
                    }
                  />
                </label>
              </div>
              <div className="mt-3 text-xs rounded-md p-2 bg-slate-200/60 dark:bg-slate-800/50">
                <div className="font-medium">防御側 合計ステータス</div>
                <div>
                  HP: {Math.round(tgtBase.hp)} / Armor:{" "}
                  {Math.round(tgtBase.armor)} / MR: {Math.round(tgtBase.mr)}
                </div>
              </div>
            </>
          )}
        </Card>
      </div>

      <section className="p-3 rounded border">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-medium">コンボビルダー</h2>
          <div className="flex items-center gap-2">
            <button
              className="text-xs border px-2 py-0.5 rounded"
              onClick={() => setCollapseCombo((v) => !v)}
            >
              {collapseCombo ? "展開" : "折りたたみ"}
            </button>
            <button
              className="text-sm border px-2 py-1 rounded"
              onClick={copyShareLink}
            >
              共有リンクをコピー
            </button>
          </div>
        </div>
        {!collapseCombo && (
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-sm font-medium">アクション追加</div>
              <div className="flex flex-wrap gap-2 text-xs items-center">
                <div className="flex items-center gap-1">
                  <span>Skill</span>
                  <Select
                    className="w-28"
                    value={String(skillIndex)}
                    onChange={(e) => setSkillIndex(Number(e.target.value))}
                  >
                    {attacker.skills.slice(0, 4).map((s, i) => (
                      <option key={i} value={i}>
                        {["Q", "W", "E", "R"][i]} - {s.name}
                      </option>
                    ))}
                  </Select>
                  <input
                    className="border px-1 py-1 w-16"
                    type="number"
                    min={0}
                    max={maxRank}
                    value={rank}
                    onChange={(e) => setSkillRank(Number(e.target.value))}
                  />
                  <input
                    className="border px-1 py-1 w-20"
                    type="number"
                    min={0}
                    step="0.05"
                    defaultValue={0.25}
                    id="skillCastTemp"
                  />
                  <button
                    className="border px-2 py-1 rounded"
                    onClick={() => {
                      const castInput = document.getElementById(
                        "skillCastTemp"
                      ) as HTMLInputElement;
                      const ct = Number(castInput?.value || 0.25);
                      setActions((prev) => [
                        ...prev,
                        { type: "skill", skillIndex, rank, castTime: ct },
                      ]);
                    }}
                  >
                    追加
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <span>AA</span>
                  <input
                    className="border px-1 py-1 w-20"
                    type="number"
                    min={0}
                    step="0.01"
                    defaultValue={Math.max(
                      0.1,
                      Number((1 / atkStats.attackSpeed).toFixed(2))
                    )}
                    id="aaCastTemp"
                  />
                  <button
                    className="border px-2 py-1 rounded"
                    onClick={() => {
                      const castInput = document.getElementById(
                        "aaCastTemp"
                      ) as HTMLInputElement;
                      const ct = Number(
                        castInput?.value ||
                          Math.max(0.1, 1 / atkStats.attackSpeed)
                      );
                      setActions((prev) => [
                        ...prev,
                        { type: "aa", castTime: ct },
                      ]);
                    }}
                  >
                    追加
                  </button>
                </div>
              </div>

              <div className="text-sm font-medium mt-2">アクション一覧</div>
              <ul className="text-xs space-y-1">
                {actions.map((a, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="w-6 text-right">{i + 1}.</span>
                    <span className="flex-1">
                      {a.type === "aa"
                        ? "AA"
                        : `${["Q", "W", "E", "R"][a.skillIndex]} (R${
                            a.rank + 1
                          })`}{" "}
                      / {a.castTime}s
                    </span>
                    <button
                      className="border px-2 py-0.5 rounded"
                      onClick={() =>
                        setActions((prev) =>
                          i > 0
                            ? prev.map((x, idx) =>
                                idx === i - 1
                                  ? prev[i]
                                  : idx === i
                                  ? prev[i - 1]
                                  : x
                              )
                            : prev
                        )
                      }
                    >
                      ↑
                    </button>
                    <button
                      className="border px-2 py-0.5 rounded"
                      onClick={() =>
                        setActions((prev) =>
                          i < prev.length - 1
                            ? prev.map((x, idx) =>
                                idx === i + 1
                                  ? prev[i]
                                  : idx === i
                                  ? prev[i + 1]
                                  : x
                              )
                            : prev
                        )
                      }
                    >
                      ↓
                    </button>
                    <button
                      className="border px-2 py-0.5 rounded"
                      onClick={() =>
                        setActions((prev) => prev.filter((_, idx) => idx !== i))
                      }
                    >
                      削除
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-sm font-medium">計算結果（コンボ）</div>
              {comboBuiltRes ? (
                <div className="mt-1 space-y-1">
                  <div>
                    合計ダメージ:{" "}
                    <span className="font-semibold">
                      {Math.round(comboBuiltRes.totalDamage)}
                    </span>
                  </div>
                  {dpsInfo && (
                    <>
                      <div>
                        時間: {dpsInfo.duration.toFixed(2)}s / 平均DPS:{" "}
                        <span className="font-semibold">
                          {dpsInfo.dps.toFixed(1)}
                        </span>
                      </div>
                      <div className="mt-1">秒間ダメージ:</div>
                      <ul className="list-disc ml-4">
                        {dpsInfo.bins.map((v, idx) => (
                          <li key={idx}>
                            {idx}-{idx + 1}s: {Math.round(v)}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {(() => {
                    const before = targetHp.current;
                    const after = comboBuiltRes.timeline.length
                      ? Math.round(
                          comboBuiltRes.timeline[
                            comboBuiltRes.timeline.length - 1
                          ].hpAfter
                        )
                      : before;
                    return (
                      <HpBar max={targetHp.max} before={before} after={after} />
                    );
                  })()}
                  <div className="mt-2 font-medium">タイムライン</div>
                  <ul className="list-disc ml-4 text-xs">
                    {comboBuiltRes.timeline.map((x, i) => (
                      <li key={i}>
                        {x.time.toFixed(2)}s: {x.name} → {Math.round(x.damage)}{" "}
                        ダメージ / HP {Math.round(x.hpAfter)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="text-xs text-gray-600">
                  アクションを追加するとコンボ結果が表示されます
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
