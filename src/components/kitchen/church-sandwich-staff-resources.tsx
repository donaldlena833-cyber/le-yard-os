import Link from "next/link";

const resourcePath = "/api/workspace/church-sandwich-staff-resources";
const pdfs = [
  { slug: "training", label: "Sandwich station training guide" },
  { slug: "supplier-intake", label: "Supplier label intake sheet" },
  { slug: "batch-labels", label: "Printable batch labels" },
] as const;
const linkStyle = "focus-ring inline-flex min-h-10 items-center rounded text-sm underline underline-offset-2";

export function ChurchSandwichStaffResources() {
  return (
    <section id="church-sandwich-staff-resources" aria-label="Sandwich station guides" className="scroll-mt-24">
      <ul className="flex flex-wrap gap-x-5 gap-y-1">
        {pdfs.map(({ slug, label }) => (
          <li key={slug}>
            <a href={`${resourcePath}/${slug}`} target="_blank" rel="noopener noreferrer" className={linkStyle}>
              {label}<span className="sr-only"> (PDF, opens in a new tab)</span>
            </a>
          </li>
        ))}
        <li><Link href="/tasks?tab=checklists" className={linkStyle}>Training checklists</Link></li>
      </ul>
    </section>
  );
}
