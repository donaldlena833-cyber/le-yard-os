import type { loadChurchCateringPrep } from "@/data/read-models/church-catering-prep.server";
import { calculateChurchCateringPrep } from "@/lib/kitchen/church-catering-prep";

const serviceDate = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: "UTC" });
const units = new Intl.NumberFormat("en-US");

export async function ChurchCateringPrep({ data }: { data: ReturnType<typeof loadChurchCateringPrep> }) {
  const result = await data;
  if (!result) return null;

  return (
    <section aria-labelledby="catering-prep-title" className="mb-6 rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4 sm:p-5">
      <h2 id="catering-prep-title" className="text-lg font-semibold">Catering prep for the next 7 days</h2>
      {result.state === "unavailable" ? (
        <p className="mt-2 text-sm text-[var(--ink-soft)]">Catering portions could not be loaded. Reload Kitchen to try again.</p>
      ) : result.days.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--ink-soft)]">No reviewed catering portions are scheduled.</p>
      ) : (
        <>
          <p className="my-2 text-sm text-[var(--ink-soft)]">Reviewed portions by service day. Use the chef’s signed recipes and batch labels before starting prep. The worksheet uses the current trial weights and estimates assembly time for one person on a stocked station.</p>
          <div className="divide-y divide-[var(--line)]">
            {result.days.map((day, index) => {
              const { sandwiches, baguettes, assemblySeconds, ingredients } = calculateChurchCateringPrep(day);
              return (
                <details key={day.serviceDate} open={index === 0} className="py-3">
                  <summary className="focus-ring cursor-pointer rounded-md text-sm font-semibold">
                    <time dateTime={day.serviceDate}>{serviceDate.format(new Date(`${day.serviceDate}T00:00:00Z`))}</time>
                    {` · ${units.format(baguettes)} sandwiches · ${units.format(day.jobCount)} ${day.jobCount === 1 ? "job" : "jobs"}`}
                  </summary>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 text-sm">
                      <h3 className="font-semibold">Sandwiches</h3>
                      <ul className="space-y-1 tabular-nums">
                        {sandwiches.map(({ name, quantity }) => <li key={name}>{units.format(quantity)} × {name}</li>)}
                      </ul>
                      <p>Trial assembly time about {units.format(Math.ceil(assemblySeconds / 60))} min.</p>
                    </div>
                    <div className="space-y-2 text-sm">
                      <h3 className="font-semibold">Usable ingredients</h3>
                      <ul className="space-y-1 tabular-nums">
                        <li>{units.format(baguettes)} × 10-inch baguettes</li>
                        {ingredients.map(({ ingredient, grams }) => <li key={ingredient}>{units.format(grams)} g {ingredient}</li>)}
                      </ul>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
