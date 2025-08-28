import SimpleCalc from "@/components/SimpleCalc";
import Image from "next/image";
import championsData from "@/data/champions.normalized.json";
import type { NormalizedChampion } from "@/types/data";

export default function Home() {
  return (
    <main className="min-h-screen p-6 sm:p-10">
      <header className="flex items-center gap-3 mb-4">
        <Image
          src="https://raw.communitydragon.org/latest/game/assets/characters/jinx/hud/jinx_circle.png"
          alt="Jinx ロゴ"
          width={48}
          height={48}
          className="rounded-full border border-slate-300 dark:border-slate-700"
        />
        <h1 className="text-2xl font-semibold">LoL ダメージ計算機</h1>
      </header>
      <SimpleCalc
        champions={championsData as unknown as NormalizedChampion[]}
      />
    </main>
  );
}
