/*
Fetch data from CommunityDragon and save to local JSON files under data/.
- Champions
- Items
- Runes (perks)
*/
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/ja_jp";
const EN_BASE_PRIMARY =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/en_us";
const EN_BASE_FALLBACK =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default";
const GAME_BASE = "https://raw.communitydragon.org/latest/game/data/characters";
const OUT_DIR = join(process.cwd(), "data");

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status} ${url}`);
  }
  return res.json();
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  // Endpoints
  const endpoints = {
    championSummary: `${BASE}/v1/champion-summary.json`,
    itemsJa: `${BASE}/v1/items.json`,
    itemsEnPrimary: `${EN_BASE_PRIMARY}/v1/items.json`,
    itemsEnFallback: `${EN_BASE_FALLBACK}/v1/items.json`,
  runesJa: `${BASE}/v1/perks.json`,
  runesEnPrimary: `${EN_BASE_PRIMARY}/v1/perks.json`,
  runesEnFallback: `${EN_BASE_FALLBACK}/v1/perks.json`,
    perkStyles: `${BASE}/v1/perkstyles.json`,
  } as const;

  console.log("Fetching champion summary...");
  const championSummary = await fetchJson<unknown[]>(endpoints.championSummary);
  writeFileSync(
    join(OUT_DIR, "champion_summary.raw.json"),
    JSON.stringify(championSummary, null, 2)
  );

  // Extract numeric IDs and fetch per-champion detailed JSON
  const ids: number[] = (
    Array.isArray(championSummary)
      ? (championSummary as Array<Record<string, unknown>>)
          .map((c) => (typeof c.id === "number" ? c.id : NaN))
          .filter((n) => Number.isFinite(n))
      : []
  ) as number[];

  console.log(`Fetching champions (${ids.length}) details...`);

  // Simple concurrency limiter
  async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    mapper: (item: T, index: number) => Promise<R>
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let i = 0;
    const workers = Array.from(
      { length: Math.max(1, Math.min(limit, items.length)) },
      async () => {
        while (true) {
          const idx = i++;
          if (idx >= items.length) break;
          try {
            results[idx] = await mapper(items[idx], idx);
          } catch (err) {
            console.warn("Failed to fetch item at index", idx, err);
            // @ts-expect-error allow sparse value; we'll filter later
            results[idx] = null;
          }
        }
      }
    );
    await Promise.all(workers);
    return results;
  }

  const championDetails = await mapWithConcurrency(ids, 10, async (id) => {
    const url = `${BASE}/v1/champions/${id}.json`;
    try {
      const data = await fetchJson<unknown>(url);
      return data;
    } catch (e) {
      console.warn(`Failed: ${url}`);
      throw e;
    }
  });

  const champions = championDetails.filter((x) => x != null);
  writeFileSync(
    join(OUT_DIR, "champions.raw.json"),
    JSON.stringify(champions, null, 2)
  );

  // Build a quick lookup map: champion id -> raw champion object
  type RawSpell = { spellKey?: string; name?: string };
  type RawChampion = {
    id?: number;
    spells?: RawSpell[];
    tacticalInfo?: { damageType?: string };
  };
  const championById = new Map<number, RawChampion>();
  for (const c of champions as unknown[]) {
    const obj = (c as RawChampion) ?? {};
    const id = typeof obj.id === "number" ? obj.id : -1;
    if (id >= 0) championById.set(id, obj);
  }

  // Fetch champion base stats from game bin.json (non-localized numeric data)
  type ChampionSummaryItem = { id: number; alias: string; name: string };
  const champsForStats: ChampionSummaryItem[] = Array.isArray(championSummary)
    ? (championSummary as unknown[])
        .map((c) => {
          const obj = c as Record<string, unknown>;
          const id = typeof obj.id === "number" ? obj.id : NaN;
          const alias = typeof obj.alias === "string" ? obj.alias : "";
          const name = typeof obj.name === "string" ? obj.name : "";
          if (!Number.isFinite(id) || !alias) return null;
          return { id, alias, name } as ChampionSummaryItem;
        })
        .filter((v): v is ChampionSummaryItem => v != null && v.id >= 0)
    : [];

  console.log(`Fetching champion base stats (${champsForStats.length})...`);

  type BaseStats = {
    hp: { base: number; growth: number };
    mp: { base: number; growth: number };
    ad: { base: number; growth: number };
    ap: { base: number; growth: number };
    armor: { base: number; growth: number };
    mr: { base: number; growth: number };
    attackSpeed: { base: number; growth: number };
  };

  const champStats = await mapWithConcurrency(champsForStats, 10, async (c) => {
    // Try with proper case alias (matches bin keys under Characters/<Alias>)
    const aliasProper = c.alias;
    const aliasLower = c.alias.toLowerCase();
    const url = `${GAME_BASE}/${aliasLower}/${aliasLower}.bin.json`;
    try {
      const data = await fetchJson<Record<string, unknown>>(url);
      const recordKey = `Characters/${aliasProper}/CharacterRecords/Root`;
      const rec = data[recordKey] as unknown;
      if (!rec) {
        throw new Error(`Character record not found at key: ${recordKey}`);
      }
      const recObj = (
        typeof rec === "object" && rec != null
          ? (rec as Record<string, unknown>)
          : {}
      ) as Record<string, unknown>;
      const ar =
        (recObj.primaryAbilityResource as Record<string, unknown>) ?? {};
      const isMana = (typeof ar.arType === "number" ? ar.arType : -1) === 0; // 0: Mana
      const mpBase = isMana
        ? Number((ar.arBase as number | undefined) ?? 0)
        : 0;
      const mpPerLvl = isMana
        ? Number((ar.arPerLevel as number | undefined) ?? 0)
        : 0;
      const stats: BaseStats = {
        hp: {
          base: Number((recObj.baseHP as number | undefined) ?? 0),
          growth: Number((recObj.hpPerLevel as number | undefined) ?? 0),
        },
        mp: { base: mpBase, growth: mpPerLvl },
        ad: {
          base: Number((recObj.baseDamage as number | undefined) ?? 0),
          growth: Number((recObj.damagePerLevel as number | undefined) ?? 0),
        },
        ap: { base: 0, growth: 0 },
        armor: {
          base: Number((recObj.baseArmor as number | undefined) ?? 0),
          growth: Number((recObj.armorPerLevel as number | undefined) ?? 0),
        },
        mr: {
          base: Number((recObj.baseSpellBlock as number | undefined) ?? 0),
          growth: Number(
            (recObj.spellBlockPerLevel as number | undefined) ?? 0
          ),
        },
        attackSpeed: {
          base: Number((recObj.attackSpeed as number | undefined) ?? 0),
          growth: Number(
            (recObj.attackSpeedPerLevel as number | undefined) ?? 0
          ),
        },
      };

      // Extract skills from bin.json using the spell resource paths listed in character record
      const spellPaths = Array.isArray(recObj.spells)
        ? (recObj.spells as unknown[])
        : [];
      const binData = data as Record<string, unknown>;
      const raw = championById.get(c.id) ?? {};
      const rawSpells: RawSpell[] = Array.isArray(raw.spells)
        ? raw.spells!
        : [];
      const champDamageType = raw?.tacticalInfo?.damageType ?? "";

      function toDamageType(): "physical" | "magical" | "true" {
        if (champDamageType === "kPhysical") return "physical";
        if (champDamageType === "kMagic") return "magical";
        return "magical";
      }

      const skillList = (spellPaths.slice(0, 4) as string[]).map(
        (path, idx) => {
          const node = binData[path] as Record<string, unknown> | undefined;
          const spell = (node?.mSpell as Record<string, unknown>) ?? {};
          type DataValue = { mName?: string; mValues?: number[] };
          const dataValues: DataValue[] = Array.isArray(spell?.DataValues)
            ? (spell.DataValues as unknown[] as DataValue[])
            : [];
          const spellCalcs = (spell as Record<string, unknown>)
            .mSpellCalculations as unknown as Record<string, unknown> | undefined;

          function getValuesByName(names: string[]): number[] | null {
            for (const cand of names) {
              const dv = dataValues.find(
                (v) => typeof v?.mName === "string" && v.mName === cand
              );
              if (dv && Array.isArray(dv.mValues))
                return dv.mValues.filter((n) => typeof n === "number");
            }
            return null;
          }

          function getNumberByName(names: string[]): number {
            for (const cand of names) {
              const dv = dataValues.find(
                (v) => typeof v?.mName === "string" && v.mName === cand
              );
              if (dv && Array.isArray(dv.mValues) && dv.mValues.length > 0) {
                // Ratios are commonly constant across ranks; take first.
                const val = dv.mValues.find((x) => typeof x === "number");
                if (typeof val === "number") return val;
              }
            }
            return 0;
          }

          function getNumberByRegex(re: RegExp): number {
            for (const dv of dataValues) {
              const name = dv?.mName ?? "";
              if (typeof name === "string" && re.test(name)) {
                if (Array.isArray(dv.mValues) && dv.mValues.length > 0) {
                  const val = dv.mValues.find((x) => typeof x === "number");
                  if (typeof val === "number") return val;
                }
              }
            }
            return 0;
          }

          function findValuesByRegex(re: RegExp): number[] {
            const out: number[] = [];
            for (const dv of dataValues) {
              const name = dv?.mName ?? "";
              if (
                typeof name === "string" &&
                re.test(name) &&
                Array.isArray(dv.mValues)
              ) {
                for (const v of dv.mValues)
                  if (typeof v === "number") out.push(v);
              }
            }
            return out;
          }

          // Base damage candidates (wider coverage)
          const baseCandidates: Array<number[]> = [];
          const pushIf = (arr: number[] | null | undefined) => {
            if (arr && arr.length) baseCandidates.push(arr);
          };
          pushIf(
            getValuesByName([
              "BaseDamage",
              "InitialDamage",
              "Damage",
              "PrimaryDamage",
              "ImpactDamage",
              "BoltDamage",
              "SlashDamage",
              "MagicDamage",
              "TotalDamage",
              "SpellDamage",
              "AOEDamage",
              "CenterDamage",
              "ExplosionDamage",
            ])
          );
          if (!baseCandidates.length) {
            // regex fallback: any Damage-like entry
            const byRe = findValuesByRegex(
              /(Magic|Spell|Total|Base).*Damage|^Damage$/i
            );
            if (byRe.length) baseCandidates.push(byRe);
          }
          // choose the longest candidate (likely the main base values per rank) and sanitize
          function sanitizeBase(arr: number[]): number[] {
            // filter out negatives; fallback to clamping at 0
            const filtered = arr.filter((n) => typeof n === "number");
            const nonNeg = filtered.some((n) => n < 0)
              ? filtered.map((n) => Math.max(0, n))
              : filtered;
            // limit to 5 ranks
            return nonNeg.slice(0, 5);
          }
          const baseArrRaw =
            baseCandidates.sort((a, b) => b.length - a.length)[0] ?? [];
          const baseArr = sanitizeBase(baseArrRaw);

          // AP ratio: broaden keys and add regex fallback
          let apRatio = getNumberByName([
            "APRatio",
            "SpellAPRatio",
            "TibbersAttackAPRatio",
            "MagicDamageAPRatio",
            "AbilityPowerRatio",
            "SpellDamageAPRatio",
            "APScaling",
            "AbilityPowerScaling",
          ]);
          if (!apRatio) {
            apRatio = getNumberByRegex(/(AP|AbilityPower).*(Ratio|Scaling)/i);
          }
          let adRatio = getNumberByName([
            "ADRatio",
            "AttackDamageRatio",
            "BonusADRatio",
            "TotalADRatio",
            "BonusAttackDamageRatio",
          ]);
          if (!adRatio) {
            adRatio = getNumberByRegex(
              /(AD|AttackDamage|BonusAD|TotalAD).*(Ratio|Scaling)/i
            );
          }

          // Percent HP damages (store as ratios; e.g., 0.04 for 4%)
          const pctMaxHp = findValuesByRegex(/(Percent|Pct).*Max.*Health/i);
          const pctCurHp = findValuesByRegex(/(Percent|Pct).*Current.*Health/i);
          // Missing health (英/日) + common data keys (e.g., PercentDamage)
          const pctMissingHpEn = findValuesByRegex(
            /(Percent|Pct).*Missing.*Health/i
          );
          // Japanese variants: 失った体力, 減少した体力, 不足している体力
          const pctMissingHpJa = findValuesByRegex(/(失った|減少|不足).*体力/i);
          // Known key names sometimes used for missing-health executes
          const pctMissingKnown =
            getValuesByName([
              "PercentDamage",
              "MissingHealthDamage",
              "MissingHealthPercent",
              "TargetMissingHealthPercent",
            ]) ?? [];
          // Fallback regex for generic Percent...Damage keys
          const pctMissingByKey = findValuesByRegex(
            /Percent.*(Damage|Execute)/i
          );
          const pctMissingHp = [
            ...pctMissingHpEn,
            ...pctMissingHpJa,
            ...pctMissingKnown,
            ...pctMissingByKey,
          ];
          function toRatio(arr: number[]): number[] {
            return arr.slice(0, 5).map((n) => (n > 1 ? n / 100 : n));
          }
          const percentMaxHp = pctMaxHp.length ? toRatio(pctMaxHp) : undefined;
          const percentCurrentHp = pctCurHp.length
            ? toRatio(pctCurHp)
            : undefined;
          const percentMissingHp = pctMissingHp.length
            ? toRatio(pctMissingHp)
            : undefined;

          // Damage over Time: per-second and duration
          const dotPerSec =
            getValuesByName(["DamagePerSecond", "BurnDPS", "PoisonDPS"]) ??
            findValuesByRegex(/(Damage|Burn|Poison).*Per(Second|Sec|Tick)/i);
          const dotDuration =
            getValuesByName(["Duration", "BurnDuration", "DoTDuration"]) ??
            findValuesByRegex(/(Dot|Burn|Poison).*Duration/i);
          const dot =
            dotPerSec.length || dotDuration.length
              ? {
                  perSecond: dotPerSec.slice(0, 5),
                  duration: dotDuration.slice(0, 5),
                }
              : undefined;

          // Shield amounts
          const shieldBase =
            getValuesByName(["Shield", "ShieldAmount", "BaseShield"]) ??
            findValuesByRegex(/Shield(Amount)?/i);
          const shieldAp = getNumberByName(["ShieldAPRatio", "APShieldRatio"]);

          const base =
            baseArr.length > 0 ? baseArr.slice(0, 5).map((n) => Number(n)) : [];

          // Distance scaling: detect Min/Floor and Max arrays (e.g., Jinx R)
          // Many champs use varied keys: DamageFloor/Max, DamageMin/Max, TotalDamageMin/Max, *MinTooltip/*MaxTooltip, etc.
          const dmgMinVals =
            getValuesByName([
              "DamageFloor",
              "DamageMin",
              "MinDamage",
              "TotalDamageMin",
              "TotalDamageMinTooltip",
              "BaseDamageMin",
            ]) ??
            findValuesByRegex(
              /(Damage\s*(Min|Minimum)|\b(Min|Minimum)\s*Damage\b|TotalDamageMin|MinTooltip)/i
            );
          const dmgMaxVals =
            getValuesByName([
              "DamageMax",
              "MaxDamage",
              "TotalDamageMax",
              "TotalDamageMaxTooltip",
              "BaseDamageMax",
            ]) ??
            findValuesByRegex(
              /(Damage\s*(Max|Maximum)|\b(Max|Maximum)\s*Damage\b|TotalDamageMax|MaxTooltip)/i
            );
          const distanceBase =
            dmgMinVals.length || dmgMaxVals.length
              ? {
                  floor: (dmgMinVals.length ? dmgMinVals : baseArr)
                    .slice(0, 5)
                    .map(Number),
                  max: (dmgMaxVals.length ? dmgMaxVals : baseArr)
                    .slice(0, 5)
                    .map(Number),
                }
              : undefined;
          // Distance-scaled ratios via mSpellCalculations (e.g., Jinx R)
          type CalcPart = {
            mCoefficient?: number;
            mStat?: number; // 2: AD, 4: AP (heuristic)
          };
          type GameCalculation = {
            mFormulaParts?: CalcPart[];
          };
          function extractDistanceRatio(
            calcObj: Record<string, unknown> | undefined,
            floorKeys: string[],
            maxKeys: string[]
          ): { ad?: { floor: number; max: number }; ap?: { floor: number; max: number } } | undefined {
            if (!calcObj) return undefined;
            const getCalcNode = (keys: string[]) => {
              for (const k of keys) {
                const v = calcObj[k] as GameCalculation | undefined;
                if (v && typeof v === "object") return v;
              }
              return undefined;
            };
            const floorNode = getCalcNode(floorKeys);
            const maxNode = getCalcNode(maxKeys);
            const parseParts = (node: GameCalculation | undefined) => {
              let ad = 0;
              let ap = 0;
              const parts: CalcPart[] = Array.isArray(node?.mFormulaParts)
                ? (node?.mFormulaParts as CalcPart[])
                : [];
              for (const p of parts) {
                const coef = typeof p?.mCoefficient === "number" ? p.mCoefficient! : 0;
                const stat = p?.mStat;
                // Heuristic: mStat 2 => Attack Damage; mStat 4 => Ability Power
                if (coef && typeof stat === "number") {
                  if (stat === 2) ad += coef;
                  else if (stat === 4) ap += coef;
                }
              }
              return { ad, ap };
            };
            const floorParts = parseParts(floorNode);
            const maxParts = parseParts(maxNode);
            const out: { ad?: { floor: number; max: number }; ap?: { floor: number; max: number } } = {};
            if (floorParts.ad || maxParts.ad) {
              out.ad = { floor: floorParts.ad, max: maxParts.ad };
            }
            if (floorParts.ap || maxParts.ap) {
              out.ap = { floor: floorParts.ap, max: maxParts.ap };
            }
            return out.ad || out.ap ? out : undefined;
          }
          const distanceRatios = extractDistanceRatio(
            spellCalcs,
            ["DamageFloor", "DamageMin", "TotalDamageMin", "BaseDamageMin"],
            ["DamageMax", "MaxDamage", "TotalDamageMax", "BaseDamageMax"]
          );
          const name = rawSpells[idx]?.name ?? `Skill${idx + 1}`;
          return {
            name,
            damage: {
              base,
              apRatio: Number(apRatio || 0),
              adRatio: Number(adRatio || 0),
              ...(percentMaxHp ? { percentMaxHp } : {}),
              ...(percentCurrentHp ? { percentCurrentHp } : {}),
              ...(percentMissingHp ? { percentMissingHp } : {}),
              ...(distanceBase ? { distanceBase } : {}),
              ...(distanceRatios?.ad
                ? { distanceAdRatio: { floor: Number(distanceRatios.ad.floor || 0), max: Number(distanceRatios.ad.max || 0) } }
                : {}),
              ...(distanceRatios?.ap
                ? { distanceApRatio: { floor: Number(distanceRatios.ap.floor || 0), max: Number(distanceRatios.ap.max || 0) } }
                : {}),
              ...(dot ? { dot } : {}),
              ...(shieldBase && shieldBase.length
                ? {
                    shield: {
                      base: shieldBase.slice(0, 5),
                      apRatio: Number(shieldAp || 0),
                    },
                  }
                : {}),
            },
            damageType: toDamageType(),
          };
        }
      );

      return {
        id: c.id,
        alias: c.alias,
        name: c.name,
        baseStats: stats,
        skills: skillList,
      };
    } catch {
      console.warn(`Failed to fetch stats for ${c.alias} from ${url}`);
      return null;
    }
  });

  const validChampStats = (
    champStats.filter(Boolean) as Array<{
      id: number;
      alias: string;
      name: string;
      baseStats: BaseStats;
      skills: Array<{
        name: string;
        damage: {
          base: number[];
          apRatio: number;
          adRatio: number;
          percentMaxHp?: number[];
          percentCurrentHp?: number[];
          percentMissingHp?: number[];
          distanceBase?: { floor: number[]; max: number[] };
          distanceAdRatio?: { floor: number; max: number };
          distanceApRatio?: { floor: number; max: number };
          dot?: { perSecond: number[]; duration: number[] };
          shield?: { base: number[]; apRatio: number };
        };
        damageType: string;
      }>;
    }>
  ).sort((a, b) => a.id - b.id);
  writeFileSync(
    join(OUT_DIR, "champion_stats.raw.json"),
    JSON.stringify(validChampStats, null, 2)
  );

  // Produce normalized champions (baseStats only for now; skills to be populated later)
  const normalized = validChampStats.map((c) => ({
    id: c.id,
    name: c.name,
    alias: c.alias,
    baseStats: c.baseStats,
    skills: c.skills,
  }));
  writeFileSync(
    join(OUT_DIR, "champions.normalized.json"),
    JSON.stringify(normalized, null, 2)
  );

  console.log("Fetching items (ja + en)...");
  const itemsJa = await fetchJson<unknown>(endpoints.itemsJa);
  let itemsEn: unknown | undefined;
  try {
    itemsEn = await fetchJson<unknown>(endpoints.itemsEnPrimary);
  } catch {
    console.warn("EN items primary failed, trying fallback...");
    try {
      itemsEn = await fetchJson<unknown>(endpoints.itemsEnFallback);
    } catch {
      console.warn("EN items fallback also failed. Proceeding with JA only.");
      itemsEn = undefined;
    }
  }
  writeFileSync(
    join(OUT_DIR, "items.raw.json"),
    JSON.stringify({ ja: itemsJa, en: itemsEn }, null, 2)
  );

  console.log("Fetching runes (perks)...");
  console.log("Fetching runes (ja + en)...");
  const runesJa = await fetchJson<unknown>(endpoints.runesJa);
  let runesEn: unknown | undefined;
  try {
    runesEn = await fetchJson<unknown>(endpoints.runesEnPrimary);
  } catch {
    console.warn("EN runes primary failed, trying fallback...");
    try {
      runesEn = await fetchJson<unknown>(endpoints.runesEnFallback);
    } catch {
      console.warn("EN runes fallback also failed. Proceeding with JA only.");
      runesEn = undefined;
    }
  }
  writeFileSync(
    join(OUT_DIR, "runes.raw.json"),
    JSON.stringify({ ja: runesJa, en: runesEn }, null, 2)
  );

  console.log("Fetching rune styles (perkstyles)...");
  const perkStyles = await fetchJson<unknown>(endpoints.perkStyles);
  writeFileSync(
    join(OUT_DIR, "perkstyles.raw.json"),
    JSON.stringify(perkStyles, null, 2)
  );
  // use runesJa / runesEn fetched above

  // Normalize items minimal stats and passive description
  type RawItem = { id?: number; name?: string; description?: string };
  function stripTags(html: string): string {
    return html
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  // Pick a stat number near a label, tolerant of "+15 アーマー" and "アーマー 15".
  function pickLabeledNumber(text: string, labelPattern: string): number | undefined {
    const numRe = "[+\\-]?[0-9]+(?:\\.[0-9]+)?";
    // number before label: +15 アーマー / 15 アーマー / 15% アーマー
    const reBefore = new RegExp(`(${numRe})\\s*%?\\s*(?:${labelPattern})(?!の)`, "i");
    const m1 = reBefore.exec(text);
    if (m1 && m1[1]) {
      const num = Number(m1[1].replace(/[, ]/g, ""));
      if (Number.isFinite(num)) return num;
    }
    // label before number: アーマー +15 / アーマー 15
    const reAfter = new RegExp(`(?:${labelPattern})(?!の)\\s*([+\\-]?[0-9]+(?:\\.[0-9]+)?)`, "i");
    const m2 = reAfter.exec(text);
    if (m2 && m2[1]) {
      const num = Number(m2[1].replace(/[, ]/g, ""));
      if (Number.isFinite(num)) return num;
    }
    return undefined;
  }
  // Legacy helper: extract the first numeric capture from a regex
  function pickNum(re: RegExp, text: string): number | undefined {
    const m = re.exec(text);
    if (!m) return undefined;
    for (let i = 1; i < m.length; i++) {
      const g = m[i];
      if (g && /[0-9]/.test(g)) {
        const num = Number(g.replace(/[, ]/g, ""));
        if (Number.isFinite(num)) return num;
      }
    }
    return undefined;
  }
  const itemsArr: RawItem[] = Array.isArray(itemsJa)
    ? (itemsJa as unknown[] as RawItem[])
    : [];
  const enById = new Map<number, RawItem>();
  if (Array.isArray(itemsEn)) {
    for (const it of (itemsEn as unknown[] as RawItem[])) {
      const id = typeof it.id === "number" ? it.id : NaN;
      if (Number.isFinite(id)) enById.set(id, it);
    }
  }
  const itemsNormalizedRaw = itemsArr.map((it) => {
    const descJa = typeof it.description === "string" ? it.description : "";
    const textJa = stripTags(descJa);
    const itEn = enById.get(it.id ?? -1);
    const descEn = typeof itEn?.description === "string" ? itEn.description : "";
    const textEn = stripTags(descEn);
    // Heuristic on-hit parser (命中時/攻撃命中時 など)
    type OnHitParsed = {
      flatMagic?: number;
      apRatioMagic?: number;
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
  function parseOnHitJa(t: string): OnHitParsed | undefined {
      const hasOnHit = /(命中時|攻撃命中時)/.test(t);
      if (!hasOnHit && !/回ごとに/.test(t) && !/現在体力/.test(t))
        return undefined;
      const out: OnHitParsed = {};
      const toType = (jp: string): "physical" | "magical" | "true" =>
        /真/.test(jp) ? "true" : /物理/.test(jp) ? "physical" : "magical";

      // % current HP on-hit
      const mPct =
        /(現在体力)[^0-9%]*([0-9]+(?:\.[0-9]+)?)\s*%[^。]*(物理|魔法|真)/.exec(
          t
        );
      if (mPct) {
        const amount = Number(mPct[2]) / 100;
        if (Number.isFinite(amount) && amount > 0)
          out.percentCurrentHp = { amount, damageType: toType(mPct[3]) };
      }

      // Every Nth hit (e.g., Kraken: 3回ごとに 真のダメージ X)
      const mNth =
        /([0-9]+)\s*回ごとに[^。]*(?:([0-9]+(?:\.[0-9]+)?)\s*)?(?:の)?(真|魔法|物理)[^。]*ダメージ/.exec(
          t
        );
      if (mNth) {
        const n = Number(mNth[1]);
        const amt = Number(mNth[2] ?? 0);
        if (Number.isFinite(n) && n > 0 && Number.isFinite(amt) && amt > 0) {
          out.everyNth = { n, amount: amt, damageType: toType(mNth[3]) };
        }
      }

      // Flat on-hit numbers
      // Try to scope around sentences containing 命中時
      const sentences = t
        .split(/[。\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const related = sentences.filter((s) => /(命中時|攻撃命中時)/.test(s));
      const scopes = related.length ? related : sentences;
      const pickFirstNum = (s: string) => {
        const m = /([0-9]+(?:\.[0-9]+)?)/.exec(s);
        return m ? Number(m[1]) : undefined;
      };
      for (const s of scopes) {
        if (/魔法ダメージ/.test(s)) {
          const n = pickFirstNum(s);
          if (Number.isFinite(n))
            out.flatMagic = Math.max(out.flatMagic || 0, Number(n));
          const apm = /魔力\s*の\s*([0-9]+(?:\.[0-9]+)?)\s*%/.exec(s);
          if (apm) {
            const r = Number(apm[1]) / 100;
            if (Number.isFinite(r))
              out.apRatioMagic = Math.max(out.apRatioMagic || 0, r);
          }
        } else if (/物理ダメージ/.test(s)) {
          const n = pickFirstNum(s);
          if (Number.isFinite(n))
            out.flatPhysical = Math.max(out.flatPhysical || 0, Number(n));
          const adm = /攻撃力\s*の\s*([0-9]+(?:\.[0-9]+)?)\s*%/.exec(s);
          if (adm) {
            const r = Number(adm[1]) / 100;
            if (Number.isFinite(r))
              out.adRatioPhysical = Math.max(out.adRatioPhysical || 0, r);
          }
        } else if (/真のダメージ/.test(s)) {
          const n = pickFirstNum(s);
          if (Number.isFinite(n))
            out.flatTrue = Math.max(out.flatTrue || 0, Number(n));
        }
      }

      // If nothing meaningful, return undefined
      const anyVal = [
        out.flatMagic,
        out.apRatioMagic,
        out.flatPhysical,
        out.adRatioPhysical,
        out.flatTrue,
        out.percentCurrentHp,
        out.everyNth,
      ].some((v: number | object | undefined) =>
        typeof v === "number" ? v > 0 : v != null
      );
      return anyVal ? out : undefined;
    }
    // EN on-hit parser
    function parseOnHitEn(t: string): OnHitParsed | undefined {
      const hasOnHit = /(on[-\s]?hit|basic attacks? deal)/i.test(t);
      if (!hasOnHit && !/every\s*\d+\s*(?:hit|attack)/i.test(t) && !/current health/i.test(t))
        return undefined;
      const out: OnHitParsed = {};
      const toType = (s: string): "physical" | "magical" | "true" =>
        /true/i.test(s) ? "true" : /phys/i.test(s) ? "physical" : "magical";

      // % current HP on-hit
      const mPct = /(current health)[^0-9%]*([0-9]+(?:\.[0-9]+)?)\s*%[^.]*?(physical|magic|true)/i.exec(t);
      if (mPct) {
        const amount = Number(mPct[2]) / 100;
        if (Number.isFinite(amount) && amount > 0)
          out.percentCurrentHp = { amount, damageType: toType(mPct[3]) };
      }

      // Every Nth hit (e.g., Every 3rd attack deals X true damage)
      const mNth = /every\s*([0-9]+)(?:st|nd|rd|th)?\s*(?:attack|hit)[^.]*?(?:deals|causes)?[^0-9%]*([0-9]+(?:\.[0-9]+)?)?[^.]*?(true|magic|physical)[^.]*?damage/i.exec(t);
      if (mNth) {
        const n = Number(mNth[1]);
        const amt = Number(mNth[2] ?? 0);
        if (Number.isFinite(n) && n > 0 && Number.isFinite(amt) && amt > 0) {
          out.everyNth = { n, amount: amt, damageType: toType(mNth[3]) };
        }
      }

      // Flat on-hit numbers in sentences containing on-hit/basic attacks
      const sentences = t
        .split(/[\.\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const related = sentences.filter((s) => /(on[-\s]?hit|basic attacks? deal)/i.test(s));
      const scopes = related.length ? related : sentences;
      const pickFirstNum = (s: string) => {
        const m = /([0-9]+(?:\.[0-9]+)?)/.exec(s);
        return m ? Number(m[1]) : undefined;
      };
      for (const s of scopes) {
        if (/magic[^.]*damage/i.test(s)) {
          const n = pickFirstNum(s);
          if (Number.isFinite(n)) out.flatMagic = Math.max(out.flatMagic || 0, Number(n));
          const apm = /ability power[^0-9]*([0-9]+(?:\.[0-9]+)?)\s*%/i.exec(s);
          if (apm) {
            const r = Number(apm[1]) / 100;
            if (Number.isFinite(r)) out.apRatioMagic = Math.max(out.apRatioMagic || 0, r);
          }
        } else if (/physical[^.]*damage/i.test(s)) {
          const n = pickFirstNum(s);
          if (Number.isFinite(n)) out.flatPhysical = Math.max(out.flatPhysical || 0, Number(n));
          const adm = /attack damage[^0-9]*([0-9]+(?:\.[0-9]+)?)\s*%/i.exec(s);
          if (adm) {
            const r = Number(adm[1]) / 100;
            if (Number.isFinite(r)) out.adRatioPhysical = Math.max(out.adRatioPhysical || 0, r);
          }
        } else if (/true[^.]*damage/i.test(s)) {
          const n = pickFirstNum(s);
          if (Number.isFinite(n)) out.flatTrue = Math.max(out.flatTrue || 0, Number(n));
        }
      }

      const anyVal = [
        out.flatMagic,
        out.apRatioMagic,
        out.flatPhysical,
        out.adRatioPhysical,
        out.flatTrue,
        out.percentCurrentHp,
        out.everyNth,
      ].some((v: number | object | undefined) =>
        typeof v === "number" ? v > 0 : v != null
      );
      return anyVal ? out : undefined;
    }
    function mergeOnHit(a?: OnHitParsed, b?: OnHitParsed): OnHitParsed | undefined {
      if (!a && !b) return undefined;
      const out: OnHitParsed = {};
      const pick = (x?: number, y?: number) => (typeof x === "number" ? x : typeof y === "number" ? y : undefined);
      out.flatMagic = pick(b?.flatMagic, a?.flatMagic);
      out.apRatioMagic = pick(b?.apRatioMagic, a?.apRatioMagic);
      out.flatPhysical = pick(b?.flatPhysical, a?.flatPhysical);
      out.adRatioPhysical = pick(b?.adRatioPhysical, a?.adRatioPhysical);
      out.flatTrue = pick(b?.flatTrue, a?.flatTrue);
      out.percentCurrentHp = b?.percentCurrentHp ?? a?.percentCurrentHp;
      out.everyNth = b?.everyNth ?? a?.everyNth;
      return out;
    }
  // Prefer parsing stats from English to avoid JP wording ambiguity
    const stats = {
      ad:
        pickLabeledNumber(textEn, "Attack Damage") ??
        pickLabeledNumber(textJa, "攻撃力") ??
        0,
      ap:
        pickLabeledNumber(textEn, "Ability Power") ??
        pickLabeledNumber(textJa, "魔力") ??
        0,
      hp:
        pickLabeledNumber(textEn, "Health") ??
        pickLabeledNumber(textJa, "体力") ??
        0,
      armor:
        pickLabeledNumber(textEn, "Armor(?! Penetration)") ??
        pickLabeledNumber(textJa, "(?:アーマー|物理防御)(?!貫通)") ??
        0,
      mr:
        pickLabeledNumber(textEn, "Magic Resist") ??
        pickLabeledNumber(textJa, "(?:魔法防御|魔法耐性)") ??
        0,
      haste:
        pickLabeledNumber(textEn, "Ability Haste") ??
        pickLabeledNumber(textJa, "スキルヘイスト") ??
        0,
      critChance:
        pickLabeledNumber(textEn, "Critical Strike Chance|Crit(ical)? Chance") ??
        pickLabeledNumber(textJa, "(?:クリティカル率|クリティカル確率)") ??
        0,
    };
    // Passive: EN first for numeric effects; JA kept for display
    const armorPenPercent =
      pickNum(/armor\s*penetration\s*([0-9]+)\s*%/i, textEn) ??
      pickNum(/物理防御貫通\s*([0-9]+)\s*%/, textJa) ??
      0;
    const magicPenPercent =
      pickNum(/magic\s*penetration\s*([0-9]+)\s*%/i, textEn) ??
      pickNum(/魔法防御貫通\s*([0-9]+)\s*%/, textJa) ??
      0;
    const flatArmorPen =
      pickNum(/(flat[^%]*armor\s*penetration|armor\s*penetration[^%]*flat)[^0-9]*([0-9]+)/i, textEn) ??
      pickNum(/(固定[^%]*物理防御貫通|物理防御貫通[^%]*固定)[^0-9]*([0-9]+)/, textJa) ??
      0;
    const magicPenFlat =
      pickNum(/magic\s*penetration\s*([0-9]+)/i, textEn) ??
      pickNum(/(固定[^%]*魔法防御貫通|魔法防御貫通[^%]*固定)[^0-9]*([0-9]+)/, textJa) ??
      0;
    const lifestealPercent =
      pickNum(/life\s*steal\s*([0-9]+)\s*%/i, textEn) ??
      pickNum(/ライフスティール\s*([0-9]+)\s*%/, textJa) ??
      0;
    const omnivampPercent =
      pickNum(/omnivamp\s*([0-9]+)\s*%/i, textEn) ??
      pickNum(/全能吸収\s*([0-9]+)\s*%/, textJa) ??
      0;
    return {
      id: it.id ?? 0,
      name: it.name ?? "",
      stats,
      passive: {
        description: textJa,
        effects: {
          armorPenPercent,
          magicPenPercent,
          flatArmorPen,
          magicPenFlat,
          lifestealPercent,
          omnivampPercent,
        },
      },
      ...(mergeOnHit(parseOnHitJa(textJa), parseOnHitEn(textEn))
        ? { onHit: mergeOnHit(parseOnHitJa(textJa), parseOnHitEn(textEn)) }
        : {}),
    };
  });
  // Deduplicate by id (keep first occurrence)
  type NormalizedItem = (typeof itemsNormalizedRaw)[number] & { id: number };
  const itemsUniqMap = new Map<number, NormalizedItem>();
  for (const it of itemsNormalizedRaw as NormalizedItem[]) {
    const id = it.id;
    if (typeof id === "number" && !itemsUniqMap.has(id)) {
      itemsUniqMap.set(id, it);
    }
  }
  const itemsNormalized = Array.from(itemsUniqMap.values());
  writeFileSync(
    join(OUT_DIR, "items.normalized.json"),
    JSON.stringify(itemsNormalized, null, 2)
  );

  // Normalize runes: extract simple damageIncrease if % ダメージ表記がある場合
  type RawRune = {
    id?: number;
    name?: string;
    shortDesc?: string;
    longDesc?: string;
  } & { iconPath?: string };
  // Build keystone id set from perkstyles (first slot per style contains keystones)
  type PerkStyles = {
    styles?: Array<{
      slots?: Array<{
        runes?: Array<{ id?: number }>;
        /** some builds have a type field like 'kKeystone' */
        type?: string;
      }>;
    }>;
  };
  const keystoneIdSet = new Set<number>();
  try {
    const ps = (perkStyles as PerkStyles) ?? {};
    const styles = Array.isArray(ps.styles) ? ps.styles : [];
    for (const style of styles) {
      const slots = Array.isArray(style.slots) ? style.slots : [];
      // Prefer slot with type containing 'Keystone'; fallback to first slot
      let ksSlot = slots.find(
        (s) => typeof s?.type === "string" && /keystone/i.test(s.type ?? "")
      );
      if (!ksSlot && slots.length > 0) ksSlot = slots[0];
      const runesInSlot = Array.isArray(ksSlot?.runes) ? ksSlot?.runes : [];
      for (const r of runesInSlot) {
        const id = typeof r?.id === "number" ? r.id : NaN;
        if (Number.isFinite(id)) keystoneIdSet.add(id);
      }
    }
  } catch {
    // If parsing fails, we'll just have an empty set and fall back to iconPath heuristic below
  }
  const runesArrJa: RawRune[] = Array.isArray(runesJa)
    ? (runesJa as unknown[] as RawRune[])
    : [];
  const enRuneById = new Map<number, RawRune>();
  if (Array.isArray(runesEn)) {
    for (const r of (runesEn as unknown[] as RawRune[])) {
      const id = typeof r?.id === "number" ? r.id! : NaN;
      if (Number.isFinite(id)) enRuneById.set(id, r);
    }
  }
  function extractDamageIncrease(text: string, lang: "ja" | "en"): number {
    // Strip tags and split to sentences
    const t = stripTags(text);
    const sentences = t
      .split(lang === "ja" ? /[。\n]/ : /[\.\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    // 1) Prefer explicit "extra damage" patterns
    const patterns = lang === "en"
      ? [
          /(?:deal|deals|causing you to deal)[^%]{0,60}?([0-9]+(?:\.[0-9]+)?)\s*%\s*(?:bonus|extra)?\s*damage/i,
          /([0-9]+(?:\.[0-9]+)?)\s*%\s*(?:bonus|extra)?\s*damage/i,
        ]
      : [
          /([0-9]+(?:\.[0-9]+)?)\s*%[^。]*追加[^。]*ダメージ/,
          /追加[^。]*ダメージ[^0-9%]*([0-9]+(?:\.[0-9]+)?)\s*%/,
        ];
    let best = 0;
    for (const s of sentences) {
      // In the primary pass, allow sentences even if they mention gold, as long as they contain an explicit extra damage pattern
      for (const re of patterns) {
        const m = re.exec(s);
        if (m && m[1]) {
          const value = Number(m[1]);
          if (Number.isFinite(value)) best = Math.max(best, value);
        }
      }
    }
    if (best > 0) return best / 100;
    // 2) Fallback: any % near damage keyword, still avoiding gold/health/other contexts
    const dmgKw = lang === "ja" ? /ダメージ/ : /damage/i;
    const pct = /([0-9]+(?:\.[0-9]+)?)\s*%/g;
    const excludeKw =
      lang === "ja"
        ? /(ゴールド|金貨|移動速度|タワー|タレット|建物|シールド|回復|体力)/
        : /(gold|movement\s*speed|shield|healing|heal|tower|turret|building|structure|health)/i;
    for (const s of sentences) {
      if (!dmgKw.test(s)) continue;
      if (excludeKw.test(s)) continue; // exclude entire sentence if contains excluded keywords
      let m: RegExpExecArray | null;
      while ((m = pct.exec(s))) {
        const value = Number(m[1]);
        if (!Number.isFinite(value)) continue;
        best = Math.max(best, value);
      }
    }
    return best > 0 ? best / 100 : 0;
  }
  const runesNormalized = runesArrJa.map((r) => {
    const textJaRune = [r.shortDesc ?? "", r.longDesc ?? ""].join(" ");
    const rEn = enRuneById.get(r.id ?? -1);
    const textEnRune = [rEn?.shortDesc ?? "", rEn?.longDesc ?? ""].join(" ");
    const iconPath = r.iconPath;
    const id = r.id ?? 0;
    // Primary detection via perkstyles keystone set; fallback to iconPath heuristic
    const isKeystoneFromStyles =
      typeof id === "number" && keystoneIdSet.has(id);
    const isKeystoneByPath =
      typeof iconPath === "string"
        ? /perk-images\/Styles\/[^/]+\/(FirstStrike|PressTheAttack|LethalTempo|FleetFootwork|Electrocute|HailOfBlades|Predator|SummonAery|ArcaneComet|PhaseRush|GraspOfTheUndying|Aftershock|Guardian|GlacialAugment|UnsealedSpellbook)/i.test(
            iconPath
          )
        : false;
    const isKeystone = isKeystoneFromStyles || isKeystoneByPath;
    const path =
      typeof iconPath === "string"
        ? iconPath.match(/perk-images\/Styles\/([^/]+)/i)?.[1] ?? ""
        : "";
    return {
      id: id,
      name: r.name ?? "",
      effects: {
        damageIncrease:
          (textEnRune && extractDamageIncrease(textEnRune, "en")) ||
          extractDamageIncrease(textJaRune, "ja"),
        description: r.shortDesc ?? "",
      },
      isKeystone,
      path,
    };
  });
  writeFileSync(
    join(OUT_DIR, "runes.normalized.json"),
    JSON.stringify(runesNormalized, null, 2)
  );

  console.log("Saved raw JSON files to data/");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
