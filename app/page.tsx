import SimpleCalc from "@/components/SimpleCalc";
import championsData from "@/data/champions.normalized.json";
import type { NormalizedChampion } from "@/types/data";

export default function Home() {
  return (
    <main className="min-h-screen p-6 sm:p-10">
      <SimpleCalc
        champions={championsData as unknown as NormalizedChampion[]}
      />
    </main>
  );
}
