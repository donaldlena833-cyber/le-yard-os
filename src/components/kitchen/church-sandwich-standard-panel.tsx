import { ChevronDown } from "lucide-react";
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
    <div id="church-sandwich-recipes-title" className="scroll-mt-24">
      <p className="text-xs text-[var(--ink-soft)]">
        Approved by {churchSandwichStandard.approvedBy} · <time dateTime={churchSandwichStandard.approvedOn}>{approvedDate.format(new Date(churchSandwichStandard.approvedOn))}</time>
      </p>
      <div className="mt-2 divide-y divide-[var(--line)]">
        {churchSandwichBenchRecipes.map((recipe) => (
          <details key={recipe.key} className="group/recipe">
            <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md text-sm font-medium [&::-webkit-details-marker]:hidden">
              {recipe.name}
              <ChevronDown aria-hidden="true" className="mr-1 size-4 shrink-0 text-[var(--ink-soft)] group-open/recipe:rotate-180" />
            </summary>
            <table aria-label={`${recipe.name} portions`} className="w-full max-w-[32rem] text-left text-sm tabular-nums">
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
            <p className="mb-3 mt-2 text-sm text-[var(--ink-soft)]">{recipe.build}</p>
          </details>
        ))}
      </div>
    </div>
  );
}

export function ChurchSandwichQuotedCosts() {
  const { bread, meat } = churchSandwichQuoteSources;
  return (
    <section id="church-sandwich-costing-title" aria-label="Quoted sandwich costs" className="scroll-mt-24">
      <p className="text-xs text-[var(--ink-soft)]">Quoted subtotals before prep loss and missing prices.</p>
      <table aria-label="Sandwich cost estimates by size" className="mt-2 w-full text-left text-sm tabular-nums">
        <thead className="text-xs text-[var(--ink-soft)]">
          <tr className="border-b border-[var(--line)]">
            <th scope="col" className="py-2 pr-2 font-normal">Sandwich</th>
            {churchSandwichSizes.map((size) => <th key={size} scope="col" className="whitespace-nowrap py-2 pl-3 text-right font-normal">{size} in</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--line)]">
          {churchSandwichBenchRecipes.map((recipe) => {
            const { subtotal: breakfast, missing } = estimateChurchSandwichCost(recipe, 6);
            const { subtotal: lunch } = estimateChurchSandwichCost(recipe, 10);
            return (
              <tr key={recipe.key} className="align-top">
                <th scope="row" className="py-2 pr-2 text-left font-medium">
                  {recipe.name}
                  {missing.length > 0 && <p className="text-xs font-normal text-[var(--ink-soft)]">Unpriced · {missing.join(", ")}</p>}
                </th>
                <td className="py-2 pl-3 text-right">{money.format(breakfast)}</td>
                <td className="py-2 pl-3 text-right">{money.format(lunch)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <details className="mt-3 border-t border-[var(--line)] pt-3 text-xs text-[var(--ink-soft)]">
        <summary className="focus-ring cursor-pointer rounded-md text-sm font-semibold text-[var(--ink)]">Quotes and bread yield</summary>
        <ul className="mt-2 space-y-1">
          <li>{bread.vendor} · {money.format(bread.loafDollars)} per 20-inch loaf + {money.format(bread.deliveryDollars)} per delivery.</li>
          <li>
            {bread.assumedLoavesPerDelivery} loaves in one daily delivery · {money.format(bread.loafDollars * bread.assumedLoavesPerDelivery + bread.deliveryDollars)} per day.
            Estimated yield is three 6-inch or two 10-inch portions per loaf.
          </li>
          <li>{meat.vendor} · {meat.quotedOn} · {Array.from(meat.dollarsPerPound, ([ingredient, rate]) =>
            `sliced ${ingredient.toLowerCase()} ${money.format(rate)}/lb`).join(" and ")}.</li>
        </ul>
      </details>
    </section>
  );
}
