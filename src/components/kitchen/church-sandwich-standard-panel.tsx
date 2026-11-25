import { churchSandwichBenchRecipes } from "@/lib/kitchen/church-sandwich-bench";
import {
  churchSandwichPortionGrams,
  churchSandwichQuoteSources,
  churchSandwichSizes,
  churchSandwichStandard,
  estimateChurchSandwichCost,
} from "@/lib/kitchen/church-sandwich-standard";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const approvedDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

export function ChurchSandwichStandardPanel() {
  return (
    <section aria-labelledby="church-sandwich-recipes-title" className="mb-6 rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4 sm:p-5">
      <h2 id="church-sandwich-recipes-title" className="scroll-mt-24 text-lg font-semibold">Sandwich recipes</h2>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">
        Approved by {churchSandwichStandard.approvedBy} · <time dateTime={churchSandwichStandard.approvedOn}>{approvedDate.format(new Date(churchSandwichStandard.approvedOn))}</time>
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {churchSandwichBenchRecipes.map((recipe) => (
          <article key={recipe.key} className="min-w-0 rounded-xl border border-[var(--line)] p-3">
            <h3 className="text-sm font-semibold">{recipe.name}</h3>
            <table aria-label={`${recipe.name} portions`} className="mt-2 w-full text-left text-xs tabular-nums">
              <thead className="text-[var(--ink-soft)]">
                <tr className="border-b border-[var(--line)]">
                  <th scope="col" className="pb-1 pr-2 font-normal">Ingredient</th>
                  {churchSandwichSizes.map((size) => <th key={size} scope="col" className="pb-1 pl-2 text-right font-normal">{size} in</th>)}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row" className="py-1 pr-2 font-medium">Baguette</th>
                  {churchSandwichSizes.map((size) => <td key={size} className="py-1 pl-2 text-right">1</td>)}
                </tr>
                {recipe.portions.map(({ ingredient, grams }) => (
                  <tr key={ingredient}>
                    <th scope="row" className="py-1 pr-2 font-medium first-letter:uppercase">{ingredient}</th>
                    {churchSandwichSizes.map((size) => (
                      <td key={size} className="whitespace-nowrap py-1 pl-2 text-right">{churchSandwichPortionGrams(grams, size)} g</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 border-t border-[var(--line)] pt-2 text-xs text-[var(--ink-soft)]">{recipe.build}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function ChurchSandwichQuotedCosts() {
  const { bread, meat } = churchSandwichQuoteSources;
  return (
    <section aria-labelledby="church-sandwich-costing-title" className="my-4 rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4 sm:p-5">
      <h2 id="church-sandwich-costing-title" className="scroll-mt-24 text-base font-semibold">Sandwich costs</h2>
      <p className="mt-1 text-xs text-[var(--ink-soft)]">Quoted subtotals per sandwich. Prep loss and unpriced ingredients are excluded.</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {churchSandwichBenchRecipes.map((recipe) => {
          const { subtotal: breakfast, missing } = estimateChurchSandwichCost(recipe, 6);
          const { subtotal: lunch } = estimateChurchSandwichCost(recipe, 10);
          return (
            <li key={recipe.key} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm">
              <p className="font-semibold">{recipe.name}</p>
              <p className="tabular-nums">6 in {money.format(breakfast)} · 10 in {money.format(lunch)}</p>
              {missing.length > 0 && <p className="text-xs text-[var(--ink-soft)]">Price needed for {missing.join(", ")}</p>}
            </li>
          );
        })}
      </ul>
      <details className="mt-3 border-t border-[var(--line)] pt-3 text-xs text-[var(--ink-soft)]">
        <summary className="focus-ring cursor-pointer rounded-md text-sm font-semibold text-[var(--ink)]">Quotes and bread yield</summary>
        <ul className="mt-2 space-y-1">
          <li>{bread.vendor} · {money.format(bread.loafDollars)} per 20-inch loaf + {money.format(bread.deliveryDollars)} per delivery.</li>
          <li>Estimate assumes {bread.assumedLoavesPerDelivery} loaves per delivery and three 6-inch or two 10-inch portions per loaf.</li>
          <li>{meat.vendor} · {meat.quotedOn} · {Array.from(meat.dollarsPerPound, ([ingredient, rate]) =>
            `sliced ${ingredient.toLowerCase()} ${money.format(rate)}/lb`).join(" and ")}.</li>
        </ul>
      </details>
    </section>
  );
}
