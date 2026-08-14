# Inventory catalog configuration

Version 0.2 layers operational capabilities over the coarse membership role. Executive Chef assignments can receive unit, category, item, vendor, price, par, and recipe capabilities at an assigned location without becoming organization Admin. Unit conversions remain an administrative action because changing conversion evidence can affect multiple historical workflows.

An empty connected tenant exposes setup actions in dependency order. New recipes remain visible once a yield unit exists, even with no inventory items. They save inactive as incomplete drafts, can receive ingredients later, and are visibly marked as not costable until ingredient/price evidence exists. Connected mode never inserts synthetic setup records.

The connected Inventory **Setup** tab is the Owner/Admin control plane for restaurant-specific catalog data. It intentionally starts empty—migration `202608010020_inventory_catalog_configuration.sql` does not seed vendors, items, recipes, or other restaurant records.

Configure records in dependency order:

1. measurement units and canonical conversions;
2. reporting categories and vendors;
3. inventory items with one canonical base unit;
4. vendor-neutral per-unit ingredient costs and auditable opening stock;
5. optional vendor purchase packs and dated integer-cent vendor prices;
6. effective-dated location pars;
7. recipes and their canonical-unit ingredients.

Catalog identities are durable. Units, conversions, categories, vendors, items, vendor packs, and recipes deactivate instead of being deleted. Direct costs and vendor prices both append effective-dated `item_price_history`; direct costs may be entered per any compatible unit without assigning a vendor. Opening stock uses the existing full-count workflow and remains pending until independently approved. Par changes are effective-dated, and every recipe save appends an immutable `inventory_recipe_versions` snapshot.

Catalog UI flows call the appropriate actor-derived command through the authenticated server workflow. The browser supplies a workspace location, the server derives its organization from an RLS-visible location, and the database derives the actor from `auth.uid()`. Owners and Admins may configure directly with their authenticated password session. Managers and operational Employees require effective job-role capabilities at that location. Direct authenticated `INSERT`, `UPDATE`, and `DELETE` privileges are revoked on the covered tables.

Each dialog creates one request UUID when it opens and reuses it after validation, network, or database errors. The database hashes the canonical command payload in `private.operation_requests`: an exact completed replay is safe, while reuse with a changed actor, tenant, target, command, or payload is rejected.

Run the focused portable verifier with:

```sh
npm run test:inventory-catalog:pglite
```

It applies all forward migrations in an isolated PGlite database and proves Owner/Admin and capability boundaries, direct-cost replay/location isolation, cross-tenant resource denial, history preservation, audit evidence, and direct-DML revocation. Migration 020 remains frozen; direct costs are added by migration `20260809142645_password_only_owners_and_direct_inventory_costs.sql`. Connected Owner/Admin MFA is an opt-in deployment gate and remains deferred until enrollment/recovery is ready. The consolidated generated database contract includes this catalog surface.
