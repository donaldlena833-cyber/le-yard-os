# Backup and restore process

Backups are a shared responsibility: Supabase protects the managed database according to the selected plan, while Le Yard must verify configuration, preserve private Storage objects, and rehearse recovery. The `backup_runs` table is an evidence registry; inserting a row does not create a backup.

## Required backup set

1. PostgreSQL database: schemas, Auth-linked application data, policies, and tenant records.
2. Private Storage: receipts, employee documents, chat attachments, closeouts, inventory evidence, SOPs, incidents, reports, imports, and checklist files.
3. Application configuration: reviewed migrations, deployment commit, and non-secret environment-variable names.
4. Secret inventory: credential owner and rotation date only. Never store raw secrets in backup evidence.

## Production policy decisions still required

Owners must approve:

- recovery point objective (acceptable data-loss window)
- recovery time objective (acceptable outage length)
- backup and evidence retention periods
- logical export cadence
- Storage manifest cadence
- encryption and off-platform copy requirements
- restore-test frequency and responsible person

The demo application deliberately labels these as not configured.

## Backup procedure

1. Confirm the Supabase project, environment, region, and backup/PITR settings in the platform console.
2. Confirm the latest managed database backup is healthy.
3. Generate an encrypted logical backup only through an approved, access-controlled runner when the policy requires one.
4. Generate a Storage manifest containing bucket, object path, version/etag when available, byte size, and checksum. Do not make a private bucket public to copy it.
5. Store backup artifacts in the approved encrypted destination with access independent from routine restaurant users.
6. Insert a `backup_runs` evidence record containing provider, backup type, status, timestamps, encrypted reference, and non-secret metadata.
7. Alert an Owner/Admin on failure; do not silently overwrite the last known-good evidence.

Never place a database password, Supabase secret key, signed file URL, or integration token in `backup_runs.metadata` or application logs.

## Restore drill

Perform drills in a disposable, isolated nonproduction project.

1. Obtain owner approval and choose a known backup point.
2. Create or identify an empty isolated restore target.
3. Restore the database according to the active Supabase plan/process.
4. Restore private Storage objects while preserving their tenant/location paths and private access.
5. apply any forward migrations newer than the restored point only after review
6. run database lint and the full RLS test suite
7. verify Auth/membership, signed file access, schedule, time clock, closeout/tips, inventory, CRM, reports, and audit immutability
8. confirm no email, push, Toast, Resy, payroll, accounting, or model integration can reach real recipients from the drill environment
9. measure recovery point and recovery time, then record `restore_tested_at` and evidence
10. destroy or archive the isolated target according to the approved policy

## Emergency restore

An emergency restore needs joint Owner authorization when possible. Preserve the damaged environment and audit evidence, pause write-capable integrations, communicate the chosen recovery point, restore into a validated target, and switch traffic only after RLS and critical workflow checks pass.

Do not run destructive local commands against a linked project. Do not use the synthetic seed during a production recovery.
