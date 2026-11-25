import type { loadChurchCateringPrep } from "@/data/read-models/church-catering-prep.server";
import { calculateChurchCateringPrep } from "@/lib/kitchen/church-catering-prep";
import type { ChurchAvailabilityRecipe } from "@/lib/kitchen/church-sandwich-availability";
import { churchSandwichRecipeKeys } from "@/lib/kitchen/church-sandwich-bench";

const serviceDate = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: "UTC" });
const units = new Intl.NumberFormat("en-US");
const gramsLabel = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

function IngredientTotals({ baguettes, ingredients }: {
  baguettes: number;
  ingredients: readonly { ingredient: string; grams: number }[];
}) {
  return (
    <ul className="space-y-1 tabular-nums">
      <li>{units.format(baguettes)} × 10-inch {baguettes === 1 ? "baguette" : "baguettes"}</li>
      {ingredients.map(({ ingredient, grams }) => <li key={ingredient}>{gramsLabel.format(grams)} g {ingredient}</li>)}
    </ul>
  );
}

export function ChurchCateringPrep({ data: result, approvedRecipes }: {
  data: Awaited<ReturnType<typeof loadChurchCateringPrep>>;
  approvedRecipes: readonly ChurchAvailabilityRecipe[] | null;
}) {
  if (!result) return null;
  const recipes = result.state === "ready"
    && result.days.some(({ remainingPortions }) => churchSandwichRecipeKeys.some((key) => remainingPortions[key] > 0))
    ? approvedRecipes : null;

  return (
    <section id="catering-prep-title" aria-label="Catering prep for the next 7 days" className="scroll-mt-24">
      {result.state === "unavailable" ? (
        <p className="mt-2 text-sm text-[var(--ink-soft)]">Catering portions could not be loaded. Reload Kitchen to try again.</p>
      ) : result.days.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--ink-soft)]">No reviewed catering portions are scheduled.</p>
      ) : (
        <>
          <p className="my-2 text-sm text-[var(--ink-soft)]">Check batch labels before prep. Measured totals cover sandwiches still to build.</p>
          <div className="divide-y divide-[var(--line)]">
            {result.days.map((day, index) => {
              const { sandwiches, published, packed, baguettes, assemblySeconds, ingredients, signed } = calculateChurchCateringPrep(day, { recipes });
              return (
                <details key={day.serviceDate} open={index === 0} className="py-3">
                  <summary className="focus-ring cursor-pointer rounded-md text-sm font-semibold">
                    <time dateTime={day.serviceDate}>{serviceDate.format(new Date(`${day.serviceDate}T00:00:00Z`))}</time>
                    {` · ${units.format(published)} published · ${units.format(packed)} packed · ${units.format(baguettes)} still to build · ${units.format(day.jobCount)} ${day.jobCount === 1 ? "job" : "jobs"}`}
                  </summary>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 text-sm">
                      <h3 className="font-semibold">Sandwiches</h3>
                      <table aria-label="Sandwich portions" className="w-full text-left text-xs tabular-nums">
                        <thead>
                          <tr className="border-b border-[var(--line)] text-[var(--ink-soft)]">
                            <th scope="col" className="py-2 pr-2">Sandwich</th>
                            <th scope="col" className="px-1 py-2 text-right">Published</th>
                            <th scope="col" className="px-1 py-2 text-right">Packed</th>
                            <th scope="col" className="py-2 pl-1 text-right">Still to build</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--line)]">
                          {sandwiches.map((sandwich) => (
                            <tr key={sandwich.name}>
                              <th scope="row" className="py-2 pr-2 font-medium">{sandwich.name}</th>
                              <td className="px-1 py-2 text-right">{units.format(sandwich.published)}</td>
                              <td className="px-1 py-2 text-right">{units.format(sandwich.packed)}</td>
                              <td className="py-2 pl-1 text-right">{units.format(sandwich.remaining)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="space-y-2 text-sm">
                      {baguettes === 0 ? (
                        <p className="text-[var(--ink-soft)]">All published sandwiches are packed. No ingredient quantities remain for this day.</p>
                      ) : (
                        <>
                          <h3 className="font-semibold">Measured usable ingredient totals</h3>
                          {signed.status === "ready" && <IngredientTotals baguettes={baguettes} ingredients={signed.ingredients} />}
                          {signed.status === "pending" && (
                            <p className="text-[var(--ink-soft)]">Measured yield pending for {signed.pendingNames.join(", ")}.</p>
                          )}
                          {signed.status === "unavailable" && (
                            <p className="text-[var(--ink-soft)]">Measured totals could not be loaded.</p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {baguettes > 0 && (
                    <details className="mt-3 rounded-lg border border-[var(--line)] p-3">
                      <summary className="focus-ring cursor-pointer rounded-md text-sm font-semibold">Bench estimate</summary>
                      <div className="mt-2 space-y-2 text-xs text-[var(--ink-soft)]">
                        <p>Rehearsal only. These quantities use bench recipes for sandwiches still to build. Use signed totals for service prep.</p>
                        <IngredientTotals baguettes={baguettes} ingredients={ingredients} />
                        <p>Trial assembly time about {units.format(Math.ceil(assemblySeconds / 60))} min for one person at a stocked station.</p>
                      </div>
                    </details>
                  )}
                </details>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
