import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const root = process.cwd();
const migrationsDirectory = join(root, "supabase", "migrations");
const outputPath = join(root, "src", "types", "database.generated.ts");
const checkOnly = process.argv.includes("--check");
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort();

// This mirrors only the platform-owned objects referenced by our migrations.
// Application types are generated exclusively from the migrated public schema.
const bootstrap = `
  create schema if not exists extensions;
  create schema if not exists auth;
  create schema if not exists storage;

  do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;

  create table auth.users (
    instance_id uuid,
    id uuid primary key,
    aud text,
    role text,
    email text unique,
    encrypted_password text,
    email_confirmed_at timestamptz,
    raw_app_meta_data jsonb not null default '{}'::jsonb,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create table auth.identities (
    id uuid primary key,
    provider_id text not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    identity_data jsonb not null default '{}'::jsonb,
    provider text not null,
    last_sign_in_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (provider_id, provider)
  );

  create function auth.jwt()
  returns jsonb language sql stable
  as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
  $$;

  create function auth.uid()
  returns uuid language sql stable
  as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;

  create function auth.role()
  returns text language sql stable
  as $$
    select coalesce(nullif(auth.jwt() ->> 'role', ''), current_user::text)
  $$;

  create table storage.buckets (
    id text primary key,
    name text not null unique,
    public boolean not null default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );

  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text not null references storage.buckets(id) on delete cascade,
    name text not null,
    owner_id text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (bucket_id, name)
  );
  alter table storage.objects enable row level security;
  grant usage on schema auth, storage to authenticated;
  grant select on storage.buckets to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
`;

const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });

function indent(lines, spaces) {
  const prefix = " ".repeat(spaces);
  return lines.map((line) => `${prefix}${line}`);
}

function enumReference(name) {
  return `Database["public"]["Enums"][${JSON.stringify(name)}]`;
}

function mapPgType(formatted, enumNames) {
  const normalized = formatted.replace(/^public\./, "");
  if (normalized.endsWith("[]")) {
    return `${mapPgType(normalized.slice(0, -2), enumNames)}[]`;
  }
  if (enumNames.has(normalized)) return enumReference(normalized);
  if (normalized === "json" || normalized === "jsonb") return "Json";
  if (normalized === "boolean") return "boolean";
  if (
    normalized === "smallint" ||
    normalized === "integer" ||
    normalized === "bigint" ||
    normalized === "real" ||
    normalized === "double precision" ||
    normalized.startsWith("numeric") ||
    normalized.startsWith("decimal")
  ) {
    return "number";
  }
  if (
    normalized === "uuid" ||
    normalized === "text" ||
    normalized === "character" ||
    normalized.startsWith("character varying") ||
    normalized === "date" ||
    normalized.startsWith("time ") ||
    normalized.startsWith("timestamp ") ||
    normalized === "interval" ||
    normalized === "inet" ||
    normalized === "cidr" ||
    normalized === "tsvector" ||
    normalized === "bytea"
  ) {
    return "string";
  }
  if (normalized === "void") return "undefined";
  if (normalized === "trigger") return "unknown";
  throw new Error(`Unsupported PostgreSQL type: ${formatted}`);
}

function property(name, type, { optional = false, nullable = false } = {}) {
  return `${JSON.stringify(name)}${optional ? "?" : ""}: ${type}${nullable ? " | null" : ""}`;
}

function renderColumns(columns, mode, enumNames) {
  return columns.map((column) => {
    const type = mapPgType(column.formatted, enumNames);
    const nullable = !column.attnotnull;
    if (mode === "row") return property(column.attname, type, { nullable });
    if (mode === "insert") {
      const optional =
        nullable ||
        column.default_expr !== null ||
        column.attidentity !== "" ||
        column.attgenerated !== "";
      return property(column.attname, type, { optional, nullable });
    }
    return property(column.attname, type, { optional: true, nullable });
  });
}

function renderRelationships(relationships) {
  if (!relationships.length) return ["Relationships: []"];
  const lines = ["Relationships: ["];
  for (const relationship of relationships) {
    lines.push("  {");
    lines.push(`    foreignKeyName: ${JSON.stringify(relationship.foreign_key_name)}`);
    lines.push(`    columns: ${JSON.stringify(relationship.columns)}`);
    lines.push(`    referencedRelation: ${JSON.stringify(relationship.referenced_relation)}`);
    lines.push(`    referencedColumns: ${JSON.stringify(relationship.referenced_columns)}`);
    lines.push("  },");
  }
  lines.push("]");
  return lines;
}

function renderTable(name, columns, relationships, enumNames) {
  const lines = [`${JSON.stringify(name)}: {`, "  Row: {"];
  lines.push(...indent(renderColumns(columns, "row", enumNames), 4));
  lines.push("  }");
  lines.push("  Insert: {");
  lines.push(...indent(renderColumns(columns, "insert", enumNames), 4));
  lines.push("  }");
  lines.push("  Update: {");
  lines.push(...indent(renderColumns(columns, "update", enumNames), 4));
  lines.push("  }");
  lines.push(...indent(renderRelationships(relationships), 2));
  lines.push("}");
  return lines;
}

function renderView(name, columns, enumNames) {
  const lines = [`${JSON.stringify(name)}: {`, "  Row: {"];
  lines.push(...indent(renderColumns(columns, "row", enumNames), 4));
  lines.push("  }");
  lines.push("  Relationships: []");
  lines.push("}");
  return lines;
}

function renderFunction(fn, args, enumNames, relationKinds) {
  const lines = [`${JSON.stringify(fn.proname)}: {`];
  if (args.length === 0) {
    lines.push("  Args: Record<PropertyKey, never>");
  } else {
    lines.push("  Args: {");
    for (const arg of args) {
      const type = `${mapPgType(arg.formatted, enumNames)} | null`;
      lines.push(`    ${property(arg.arg_name, type, { optional: arg.optional })}`);
    }
    lines.push("  }");
  }

  const returnRelation = relationKinds.get(fn.return_name);
  let returns;
  if (fn.return_schema === "public" && returnRelation) {
    const group = returnRelation === "view" ? "Views" : "Tables";
    returns = `Database["public"]["${group}"][${JSON.stringify(fn.return_name)}]["Row"]`;
  } else {
    returns = mapPgType(fn.return_formatted, enumNames);
  }
  if (fn.proretset) returns = `${returns}[]`;
  lines.push(`  Returns: ${returns}`);
  lines.push("}");
  return lines;
}

function pushEntries(target, entries) {
  entries.forEach((entry, index) => {
    target.push(...indent(entry, 6));
    if (index < entries.length - 1) target[target.length - 1] += ";";
  });
}

function pushStringArrayProperty(target, name, values, spaces) {
  const prefix = " ".repeat(spaces);
  target.push(`${prefix}${name}: [`);
  for (const value of values) target.push(`${prefix}  ${JSON.stringify(value)},`);
  target.push(`${prefix}],`);
}

try {
  await db.exec(bootstrap);
  for (const file of migrationFiles) {
    await db.exec(await readFile(join(migrationsDirectory, file), "utf8"));
  }

  const [enumResult, relationResult, columnResult, foreignKeyResult, functionResult, argumentResult] =
    await Promise.all([
      db.query(`
        select type.typname as enum_name, enum.enumlabel as enum_value
        from pg_type type
        join pg_namespace namespace on namespace.oid = type.typnamespace
        join pg_enum enum on enum.enumtypid = type.oid
        where namespace.nspname = 'public'
        order by type.typname, enum.enumsortorder
      `),
      db.query(`
        select class.relname, class.relkind
        from pg_class class
        join pg_namespace namespace on namespace.oid = class.relnamespace
        where namespace.nspname = 'public'
          and class.relkind in ('r', 'p', 'v', 'm')
        order by class.relname
      `),
      db.query(`
        select class.relname, attribute.attname,
          format_type(attribute.atttypid, attribute.atttypmod) as formatted,
          attribute.attnotnull,
          pg_get_expr(default_value.adbin, default_value.adrelid) as default_expr,
          attribute.attidentity,
          attribute.attgenerated,
          attribute.attnum
        from pg_class class
        join pg_namespace namespace on namespace.oid = class.relnamespace
        join pg_attribute attribute on attribute.attrelid = class.oid
          and attribute.attnum > 0 and not attribute.attisdropped
        left join pg_attrdef default_value on default_value.adrelid = class.oid
          and default_value.adnum = attribute.attnum
        where namespace.nspname = 'public'
          and class.relkind in ('r', 'p', 'v', 'm')
        order by class.relname, attribute.attnum
      `),
      db.query(`
        select constraint_row.conname as foreign_key_name,
          child.relname as table_name,
          parent.relname as referenced_relation,
          array_agg(child_attribute.attname order by child_key.ordinality) as columns,
          array_agg(parent_attribute.attname order by child_key.ordinality) as referenced_columns
        from pg_constraint constraint_row
        join pg_class child on child.oid = constraint_row.conrelid
        join pg_namespace child_namespace on child_namespace.oid = child.relnamespace
        join pg_class parent on parent.oid = constraint_row.confrelid
        join pg_namespace parent_namespace on parent_namespace.oid = parent.relnamespace
        cross join lateral unnest(constraint_row.conkey) with ordinality
          child_key(attribute_number, ordinality)
        join pg_attribute child_attribute on child_attribute.attrelid = child.oid
          and child_attribute.attnum = child_key.attribute_number
        join pg_attribute parent_attribute on parent_attribute.attrelid = parent.oid
          and parent_attribute.attnum = constraint_row.confkey[child_key.ordinality]
        where constraint_row.contype = 'f'
          and child_namespace.nspname = 'public'
          and parent_namespace.nspname = 'public'
        group by constraint_row.conname, child.relname, parent.relname
        order by child.relname, constraint_row.conname
      `),
      db.query(`
        select procedure.oid::text, procedure.proname, procedure.proretset,
          procedure.pronargdefaults, return_namespace.nspname as return_schema,
          return_type.typname as return_name,
          format_type(procedure.prorettype, null) as return_formatted
        from pg_proc procedure
        join pg_namespace namespace on namespace.oid = procedure.pronamespace
        join pg_type return_type on return_type.oid = procedure.prorettype
        join pg_namespace return_namespace on return_namespace.oid = return_type.typnamespace
        where namespace.nspname = 'public' and procedure.prokind = 'f'
        order by procedure.proname, procedure.oid
      `),
      db.query(`
        select procedure.oid::text,
          argument.ordinality,
          coalesce(procedure.proargnames[argument.ordinality], 'arg_' || argument.ordinality::text) as arg_name,
          format_type(argument.type_oid, null) as formatted,
          argument.ordinality > procedure.pronargs - procedure.pronargdefaults as optional
        from pg_proc procedure
        join pg_namespace namespace on namespace.oid = procedure.pronamespace
        cross join lateral unnest(procedure.proargtypes::oid[]) with ordinality
          argument(type_oid, ordinality)
        where namespace.nspname = 'public' and procedure.prokind = 'f'
        order by procedure.oid, argument.ordinality
      `),
    ]);

  const enums = new Map();
  for (const row of enumResult.rows) {
    const values = enums.get(row.enum_name) ?? [];
    values.push(row.enum_value);
    enums.set(row.enum_name, values);
  }
  const enumNames = new Set(enums.keys());

  const relationKinds = new Map(
    relationResult.rows.map((row) => [
      row.relname,
      row.relkind === "v" || row.relkind === "m" ? "view" : "table",
    ]),
  );
  const columnsByRelation = new Map();
  for (const row of columnResult.rows) {
    const columns = columnsByRelation.get(row.relname) ?? [];
    columns.push(row);
    columnsByRelation.set(row.relname, columns);
  }
  const relationshipsByTable = new Map();
  for (const row of foreignKeyResult.rows) {
    const relationships = relationshipsByTable.get(row.table_name) ?? [];
    relationships.push(row);
    relationshipsByTable.set(row.table_name, relationships);
  }
  const argumentsByFunction = new Map();
  for (const row of argumentResult.rows) {
    const args = argumentsByFunction.get(row.oid) ?? [];
    args.push(row);
    argumentsByFunction.set(row.oid, args);
  }

  const tableEntries = [];
  const viewEntries = [];
  for (const [name, kind] of relationKinds) {
    const columns = columnsByRelation.get(name) ?? [];
    if (kind === "view") {
      viewEntries.push(renderView(name, columns, enumNames));
    } else {
      tableEntries.push(
        renderTable(name, columns, relationshipsByTable.get(name) ?? [], enumNames),
      );
    }
  }
  const functionEntries = functionResult.rows.map((fn) =>
    renderFunction(fn, argumentsByFunction.get(fn.oid) ?? [], enumNames, relationKinds),
  );

  const lines = [
    "// Generated from the ordered SQL migrations by scripts/generate-database-types.mjs.",
    "// Do not hand-edit. Regenerate after every schema migration.",
    "",
    "export type Json =",
    "  | string",
    "  | number",
    "  | boolean",
    "  | null",
    "  | { [key: string]: Json | undefined }",
    "  | Json[];",
    "",
    "export type Database = {",
    "  public: {",
    "    Tables: {",
  ];
  pushEntries(lines, tableEntries);
  lines.push("    }");
  lines.push("    Views: {");
  pushEntries(lines, viewEntries);
  lines.push("    }");
  lines.push("    Functions: {");
  pushEntries(lines, functionEntries);
  lines.push("    }");
  lines.push("    Enums: {");
  for (const [name, values] of enums) {
    lines.push(`      ${JSON.stringify(name)}: ${values.map(JSON.stringify).join(" | ")}`);
  }
  lines.push("    }");
  lines.push("    CompositeTypes: { [_ in never]: never }");
  lines.push("  }");
  lines.push("}");
  lines.push("");
  lines.push("export type PublicSchema = Database[\"public\"];");
  lines.push("export type TableName = keyof PublicSchema[\"Tables\"];");
  lines.push("export type ViewName = keyof PublicSchema[\"Views\"];");
  lines.push("export type FunctionName = keyof PublicSchema[\"Functions\"];");
  lines.push("export type EnumName = keyof PublicSchema[\"Enums\"];");
  lines.push("export type TableRow<Name extends TableName> = PublicSchema[\"Tables\"][Name][\"Row\"];");
  lines.push("export type TableInsert<Name extends TableName> = PublicSchema[\"Tables\"][Name][\"Insert\"];");
  lines.push("export type TableUpdate<Name extends TableName> = PublicSchema[\"Tables\"][Name][\"Update\"];");
  lines.push("export type ViewRow<Name extends ViewName> = PublicSchema[\"Views\"][Name][\"Row\"];");
  lines.push("export type EnumValue<Name extends EnumName> = PublicSchema[\"Enums\"][Name];");
  lines.push("");
  lines.push("export const DatabaseConstants = {");
  lines.push("  public: {");
  lines.push("    Enums: {");
  for (const [name, values] of enums) {
    lines.push(`      ${JSON.stringify(name)}: ${JSON.stringify(values)},`);
  }
  lines.push("    },");
  lines.push("  },");
  lines.push("} as const;");
  lines.push("");
  lines.push("export const DatabaseObjectNames = {");
  lines.push("  public: {");
  pushStringArrayProperty(
    lines,
    "Tables",
    [...relationKinds].filter(([, kind]) => kind === "table").map(([name]) => name),
    4,
  );
  pushStringArrayProperty(
    lines,
    "Views",
    [...relationKinds].filter(([, kind]) => kind === "view").map(([name]) => name),
    4,
  );
  pushStringArrayProperty(
    lines,
    "Functions",
    functionResult.rows.map((fn) => fn.proname),
    4,
  );
  pushStringArrayProperty(lines, "Enums", [...enums.keys()], 4);
  lines.push("  },");
  lines.push("} as const;");
  lines.push("");

  const generated = `${lines.join("\n")}\n`;
  const summary =
    `${tableEntries.length} tables, ${viewEntries.length} views, ` +
    `${functionEntries.length} functions, and ${enums.size} enums`;
  if (checkOnly) {
    const current = await readFile(outputPath, "utf8").catch(() => null);
    if (current !== generated) {
      throw new Error(
        `Generated database contract is stale (${summary}). Run npm run types:database.`,
      );
    }
    process.stdout.write(`Verified generated database contract: ${summary}\n`);
  } else {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, generated, "utf8");
    process.stdout.write(`Generated ${summary} at ${outputPath}\n`);
  }
} finally {
  await db.close();
}
