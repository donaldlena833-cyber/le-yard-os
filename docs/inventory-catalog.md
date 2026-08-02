# Inventory catalog configuration

The connected Inventory **Setup** tab is the Owner/Admin control plane for restaurant-specific catalog data. It intentionally starts empty—migration `202608010020_inventory_catalog_configuration.sql` does not seed vendors, items, recipes, or other restaurant records.

Configure records in dependency order:

1. measurement units and canonical conversions;
2. reporting categories and vendors;
3. inventory items with one canonical base unit;
4. vendor purchase packs and dated integer-cent prices;
5. effective-dated location pars;
6. recipes and their canonical-unit ingredients.

Catalog identities are durable. Units, conversions, categories, vendors, items, vendor packs, and recipes deactivate instead of being deleted. Par changes are effective-dated, each vendor-pack price save appends `item_price_history`, and every recipe save appends an immutable `inventory_recipe_versions` snapshot.

All eight UI flows call `configure_inventory_catalog` through the authenticated server workflow. The browser supplies a workspace location, the server derives its organization from an RLS-visible location, and the database derives the actor from `auth.uid()`. Admins may configure directly; Owners require AAL2. Managers retain management read access but cannot configure the catalog. Direct authenticated `INSERT`, `UPDATE`, and `DELETE` privileges are revoked on the covered tables.

Each dialog creates one request UUID when it opens and reuses it after validation, network, or database errors. The database hashes the canonical command payload in `private.operation_requests`: an exact completed replay is safe, while reuse with a changed actor, tenant, target, command, or payload is rejected.

Run the focused portable verifier with:

```sh
npm run test:inventory-catalog:pglite
```

It applies migrations through 020 in an isolated PGlite database and proves the Owner/Admin and Owner-AAL2 boundaries, exact replay, cross-tenant resource denial, history preservation, and direct-DML revocation. Migration 020 is frozen after this verifier and focused UI/unit tests pass; follow-up schema changes must use a new migration. The consolidated generated database contract includes this catalog surface.
