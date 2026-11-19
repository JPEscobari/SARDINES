# Cloudant design and controlled migration

Phase 2C implements a Cloudant adapter, but no live instance is configured or verified. SQLite remains the authority. See [adapter handoff](cloudant-adapter-handoff.md) for exact files, contract, tests and configuration.

## Implemented documents and indexes

One document per source: _id=source:<sha256(sourceType + NUL + exact content)>, _rev, kind=sardines_source_aggregate, schemaVersion=1, source, promises[], actions[], events[]. Preserve all existing typed IDs, source content/hash/analysis, Promise versions, timestamps and audit entries when migrating. Never migrate by calling saveAnalysis: that would regenerate IDs and lose reviewed state/audit history.

The source aggregate is the sole authority; a single revision write changes records and audit together. No multi-document bulk write is treated as a transaction. The built-in _all_docs primary index suffices for current key-paginated source scans. No Mango indexes are required or created by this implementation. Future projections for type/status/dueAt, account/updatedAt and action approval state need an explicit recoverable projection design; they must not become competing authorities. Aggregate growth is guarded at 900,000 serialized UTF-8 bytes; oversize migrations or edits fail without splitting/dropping history.

IBM references: [revision updates and 409/202 behavior](https://cloud.ibm.com/docs/Cloudant?topic=Cloudant-update-docs), [primary index and key pagination](https://cloud.ibm.com/docs/Cloudant?topic=Cloudant-get-documents), [document size limit](https://cloud.ibm.com/docs/Cloudant?topic=Cloudant-limits).

## Provisioning and identity

Identify an approved dedicated development instance/database, preferably non-partitioned. Confirm region, plan, IAM access to the target database, backup/retention policy and network access. No service provisioning is authorized or automated here. Server settings: OPERATIONAL_STORE=cloudant, CLOUDANT_URL, CLOUDANT_API_KEY, CLOUDANT_DATABASE. SQLite is selected when OPERATIONAL_STORE is absent or sqlite. Invalid Cloudant configuration never falls back to SQLite. Production authorization is not provided by these settings.

## Safe migration runbook (not executed; no automatic importer)

1. Inventory: identify the exact SQLite file, all application writers, selected backend, record counts, schema versions and data owner. Record a migration manifest with hashes/counts/IDs rather than confidential bodies in logs. Keep Mongo Task/Decision data outside this migration.
2. Backup: stop writers and close SQLite connections; checkpoint/close WAL safely and take a verified backup, or use a supported SQLite online backup operation. Never copy only the main file from a live WAL database. Test restoring the backup to a separate local path. Preserve the original database unchanged.
3. Dry run: read a backup, group Source/Promise/Action/AuditEvent records by source, validate all entities and exact evidence, verify parent references, IDs, source hashes and uniqueness. Attach audits via entityId. Retain original reviewed fields/versions. Build proposed aggregate JSON offline with schemaVersion=1. Check every aggregate's serialized byte size below 900,000. Report orphans/duplicates/oversize groups and stop; never drop or regenerate records to make the import pass.
4. Test target: obtain explicit approval to write an existing dedicated development database. Run the opt-in read test, then separately approved synthetic write test. Confirm write permissions, stale-write behavior and retained fixture ID. No migration claim follows from mock tests or read-only connectivity.
5. Import implementation/rehearsal: build a reviewed opt-in importer that creates aggregates with original IDs. Maintain a checkpoint manifest. On ID conflict compare full canonical content/hash; never overwrite different existing data. A crash can leave some complete aggregates imported; resume by manifest/hash verification, not blind reimport. Multi-source import is not globally atomic. Do not expose the target to users during import.
6. Verification: compare all source/promise/action/audit counts and canonical per-record hashes, IDs, reviewed versions, nulls and evidence. Test sample reads, review edits, duplicate sources, conflicts and UI flows against the target. Restore test-modified data only through an approved procedure; do not use production records as integration fixtures.
7. Controlled cutover: schedule a write freeze; take a final backup and reconcile changes since rehearsal. Verify target completely before switching OPERATIONAL_STORE and restarting. Keep SQLite backup read-only, permit one operational writer/backend only, verify /api/ready and smoke tests, and record the cutover manifest. Do not dual-write.
8. Rollback: before any new Cloudant writes, switch back to the preserved SQLite backup and restart. After new Cloudant writes, freeze writes and export/reconcile those changes into a separately validated SQLite restore before reverting; simply switching back would lose updates. Retain both copies and manifests until verification/retention approval. Never delete either store automatically.

## Remaining limits

A source aggregate is atomic but listing multiple sources is not a consistent snapshot. Replication conflicts require manual resolution; the adapter rejects conflicted leaves. Audit growth can exhaust the document guard and halt edits; design versioned archival with explicit consistency guarantees before reaching that limit. Promise lookup scans aggregates, so production needs benchmarking and a query design. Authentication, tenant isolation, approval identity and reliable HubSpot execution remain separate required work.

## Current live status and Phase 3A

Cloudant has since been configured and live persistence verified by the user. Phase 3A performed a read-only compatibility check successfully and made no Cloudant modifications. The earlier provisioning status is historical. See [action approval handoff](action-approval-handoff.md); migration steps remain a reference, not an executed migration.
