import Link from "next/link";

const resourcePath = "/api/workspace/church-sandwich-staff-resources";
const pdfs = [
  { slug: "training", label: "Sandwich station training guide" },
  { slug: "supplier-intake", label: "Supplier label intake sheet" },
  { slug: "batch-labels", label: "Printable batch labels" },
] as const;
const kitchenLinks = [
  { href: "#church-sandwich-evidence-heading", label: "Sandwich evidence by recipe" },
  { href: "#church-batch-queue-heading", label: "Open batches by discard time" },
  { href: "#church-sandwich-timing-heading", label: "Sandwich timing runs" },
] as const;
const linkStyle = "focus-ring inline-block rounded font-semibold underline underline-offset-2";

export function ChurchSandwichStaffResources() {
  return (
    <section id="church-sandwich-staff-resources" aria-labelledby="church-sandwich-staff-resources-heading" className="mb-6 scroll-mt-20 rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4 sm:p-5">
      <h2 id="church-sandwich-staff-resources-heading" className="text-lg font-semibold">Sandwich station training</h2>
      <p className="mt-2 text-sm text-[var(--ink-soft)]">Guide v0.17 uses bench recipes for rehearsal. Use the current chef-signed recipes and reviewed supplier labels for service.</p>
      <ul aria-label="Training PDFs" className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {pdfs.map(({ slug, label }) => (
          <li key={slug}>
            <a href={`${resourcePath}/${slug}`} target="_blank" rel="noopener noreferrer" className={linkStyle}>
              {label}<span className="sr-only"> (PDF, opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
      <nav aria-label="Kitchen evidence" className="mt-3 border-t border-[var(--line)] pt-3">
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
          {kitchenLinks.map(({ href, label }) => <li key={href}><a href={href} className={linkStyle}>{label}</a></li>)}
          <li><Link href="/tasks?tab=checklists" className={linkStyle}>Staff training checklists</Link></li>
        </ul>
      </nav>
    </section>
  );
}
