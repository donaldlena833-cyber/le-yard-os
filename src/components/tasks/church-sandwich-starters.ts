const churchSandwichBenchRecipes = [
  { name: "Le Parisien", grams: "French-style ham 72 g, cultured butter 16 g", filling: 88, accent: "Full deli-style loose ham folds", build: "Spread butter across the crumb and distribute the loose ham folds to both ends.", seconds: 60 },
  { name: "Le Verger", grams: "Brie 45 g, apple 40 g, walnuts 14 g, honey 8 g", filling: 107, accent: "A little more walnut crunch and a lighter honey finish", build: "Lay Brie, overlap thin apple slices, distribute walnuts, then drizzle honey.", seconds: 90 },
  { name: "Le Bellecour", grams: "Brie 45 g, roasted red peppers 38 g, cornichons 18 g, Dijon 10 g", filling: 111, accent: "Extra pickle snap with drier peppers", build: "Spread Dijon, layer Brie and drained peppers, then distribute drained cornichons.", seconds: 90 },
  { name: "Le Bleu", grams: "Danish blue cheese 38 g, apple 42 g, arugula 10 g, honey 8 g, pistachios 13 g", filling: 111, accent: "Apple leads with a pistachio crunch", build: "Distribute blue cheese and apple, then add arugula, honey and pistachios.", seconds: 90 },
  { name: "Le Rustique", grams: "Coppa 58 g, roasted red peppers 32 g, cornichons 18 g, Dijon 10 g, arugula 12 g", filling: 130, accent: "Fuller deli folds and a brighter pickle bite", build: "Spread Dijon, fold coppa along the crumb, then add drained peppers, cornichons and arugula.", seconds: 90 },
  { name: "Le Figaro", grams: "Prosciutto 55 g, Brie 42 g, fig preserves 12 g, arugula 14 g", filling: 123, accent: "A peppery green finish with a modest fig spread", build: "Spread fig preserves, layer Brie and loose prosciutto folds, then tuck the arugula inside.", seconds: 90 },
] as const;

const benchRecipeText = churchSandwichBenchRecipes.map(({ name, grams, filling, accent, build }) =>
  `${name} · ${filling} g filling\n${grams}.\n${accent}. ${build}`,
).join("\n\n");

const recipeRehearsalItems = churchSandwichBenchRecipes.map(({ name, seconds }) =>
  `${name} build and pack | text | required | Time 3 clean builds. Record each build and ticket-to-ready time, median, slowest and rework. Trial build-to-wrapped-and-checked target ≤${seconds}s on a stocked station.`,
).join("\n");

export const churchSandwichSop = {
  title: "Church Street sandwich station",
  category: "Kitchen",
  changeSummary: "First chef review. Verify portions, measured prep times, batch labels and allergens before publishing for service.",
  body: `CHURCH STREET SANDWICH STATION · WORKING DRAFT
140 Church Street · Chef: ____ · Reviewed on: ____ · Rehearsal run: ____

CLASSIC BUILDS WITH A NEW YORK DELI TOUCH · BENCH TRIAL
Use one 10-inch baguette per sandwich. Weights are net, ready-to-build grams and exclude the bread. These are trial portions using the ingredients described on the current café menu.

${benchRecipeText}

CHEF TO COMPLETE · PRODUCT SPEC, TIMING AND HOLDING
Weigh edible component portions before assembly. Start with the bench recipes above, record the measured batch yield, and test the paper-wrapped sandwich at the counter and in a mock delivery bag. Record any changes and approve the exact supplier product, portion and build order per item. Record the approved opening quantity, refill trigger and batch size after the rehearsal.
For each prepared component, record the storage method, holding conditions, use-by/discard rule and reset steps for the next batch. Use the approved kitchen food-safety procedures to set these rules. Record the owner and approval date for each rule.

BATCH LABEL · TEST WITH THE REAL CONTAINER
Product or component / batch ID / prepared date and time / preparer / use-by or discard date and time / storage location / allergen reference and revision. Link each batch to supplier product and lot where available. Confirm a second person can trace a rehearsal unit back to its components and read the label at the station. Use the approved food-safety plan to set the label fields and limits for service.

ALLERGEN REVIEW · CHEF AND MANAGER SIGNOFF
Collect the current supplier labels and ingredient sheets for the baguette, meats, dairy, dressings, preserves and other packaged ingredients. Confirm ingredient allergens, shared equipment and cross-contact for each item against the exact products actually used. First look at the baguette, dairy, pistachios and walnuts, and review supplier sub-ingredients and the Dijon. These are review prompts. Record confirmed results, ingredient source, cross-contact controls, substitutions, reviewer, and date in the final matrix.
At the counter, involve the chef or manager when a guest reports an allergy. Check the approved matrix and confirm what the station can accommodate before accepting the order. Bring any unresolved item or substitution back to the chef. Manager handoff: verify signed-off information on the Square Restaurants POS item tile by pressing and holding it. Check the allergy notice on onsite and online menus and test how Square and each marketplace pass an allergy notification to the café where applicable. Check the NYC Health notice and sign requirements before opening.
Chef signoff and date: ____ · Manager and date: ____ · Approved matrix revision: ____

TIMED REHEARSAL
Use Checklists → Church Street sandwich rehearsal. Start from a clean station. Prep for six units and record the net yield, waste, prep time and batch label. Time three clean builds per sandwich. On a stocked bench, trial targets are 60 seconds or less for Le Parisien and 90 seconds or less for each other sandwich from build start to wrapped and checked. For a single-sandwich drill, aim for three minutes or less from ticket arrival to verified ready. Record each result, median, slowest and rework. Run a fresh pass after changing the layout or recipe. Include one dry-run allergy escalation, one mock delivery bag and a mixed-ticket pass with coffee. The chef reviews actual results before approving times for service.

SHIFT HANDOFF
At open, verify the six item builds, labels, counts and open issues. During service, use Square availability for an item you cannot fulfill. For a product tracked as sellable units, record a physical count in Operations Inventory using the quantity actually ready to sell. Record missing product, waste, remakes and corrective actions in the shift handoff.

References
https://leyardny.com/sandwicherie
https://squareup.com/help/us/en/article/6424-create-menus-with-square-for-restaurants
https://www.nyc.gov/site/doh/business/food-operators/required-signs.page`,
};

export const churchSandwichRehearsal = {
  name: "Church Street sandwich rehearsal",
  items: `Run details | text | required | Record date, lead, team, setup and practice channels. Ticket-to-verified-ready rehearsal target for one sandwich is ≤3 min.
Batch prep times and yield | text | required | Prep for six units. Record product, batch ID, prep start and stop, seconds, and usable yield and waste for every component tested.
Batch label and trace | text | required | Enter one example label and component lot references. Record whether a second person could trace the rehearsal unit.
${recipeRehearsalItems}
Mock pickup and delivery bag | text | required | Record identification, wrapping, order label, handoff seconds and any mix-up.
Mock allergy handoff | text | required | Record how the alert reached the chef, which sources were consulted, how the mock guest was updated, and any gap. Use rehearsal data.
Slowest step and changes | text | required | Record the bottleneck, one change for the next pass, owner and due date.
Chef and manager review | text | required | Record accepted timing and portions or pending retest, allergen matrix revision or pending checks, reviewers and date.`,
};
