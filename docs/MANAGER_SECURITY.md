# Manager security deployment and operation

Phase 1 keeps the existing vanilla POS and event data model. The old frontend PIN is removed. Google Firebase Authentication identifies the owner; enabled staff documents authorize manager or cashier access. Anonymous authentication identifies a cashier device but does not grant it access until the owner signs in on that device once.

## Enforcement

- The exact client rules are in ../firestore.rules. Enrolled manager/cashier accounts can read events. No browser can create, update or delete an event directly, nor grant itself a role.
- All 13 existing event types go through commitPosEvent. Only managers can submit non-sale events. Cashier sales are validated against a server catalog, including item overrides and the combined 20% discount limit. Existing business events remain append-only.
- managerSession bootstraps only the verified Google identity matching MOBIHOBBY_OWNER_EMAIL in the functions deployment environment. Never put passwords, OAuth credentials or Firebase CLI credentials in this repository.
- Each enrolled cashier device keeps its original anonymous UID. The manager session uses a separate in-memory auth instance and locks after 15 minutes or when Cashier mode is selected.
- Product/customer/preorder text is escaped in rendered HTML. This reduces stored script injection through imported or synchronized data.

## Cutover order

1. Back up each device and the cloud events, current Firestore rules and relevant Auth configuration. Drain all device queues, stop changes and close old app sessions. Cloud backups cannot capture unsynced local records.
2. Enable Google sign-in in Firebase Authentication while retaining anonymous sign-in. Add the actual application hostname to Authentication authorized domains (for GitHub Pages: junyuong.github.io). Keep existing domains.
3. Set functions/.env.PROJECT_ID with MOBIHOBBY_OWNER_EMAIL for the owner. Deploy the functions with firebase deploy --only functions --project PROJECT_ID. Requires the existing Blaze plan. Functions have zero minimum instances and a maximum of three per function.
4. Verify owner Google login and enrollment using the updated app on a preview before replacing production rules. Do not enable arbitrary existing anonymous accounts from the Auth user list.
5. Deploy the exact Firestore rules with firebase deploy --only firestore:rules --project PROJECT_ID. Preserve unrelated services such as Storage. Then run initializePosSecurity using the verified manager setup button. This builds only securityCatalog and securityConfig from the frozen legacy log, without changing business events.
6. Publish the updated frontend and service worker together. Reload every device, sign in as the owner once on each to enroll its anonymous cashier UID, then choose Cashier mode. Confirm synchronization succeeds before resuming sales.

## Staff and recovery

To revoke a device, set its staff/UID enabled field to false through a trusted admin environment. Client code cannot edit staff. To authorize another manager, an administrator explicitly creates an enabled manager staff document for its authenticated UID. There is no public self-enrollment endpoint.

Failed uploads remain in the local outbox under a stable event ID. Manager changes and old-format queue entries require manager sign-in to upload. Do not clear browser storage or reinstall the PWA while changes are pending. The cloud status badge reports failed permissions/uploads; a local sale is not proof it reached the server.

Keep production event backups private. The rollout does not delete or rewrite events. If the frontend needs rollback, retain the secure gateway and rules and fix forward; the old frontend cannot write under the new rules. Reopening legacy anonymous writes would restore the original vulnerability and needs a deliberate owner decision. Restore business records only from a reviewed backup through a manager workflow.

## Validation and remaining scope

Run npm ci, npm test and npm run test:rules (Java 21 required for the local Firestore emulator). Rules tests use demo-mobihobby, never production records. Backend unit tests exercise the actual callable handlers using a transaction fixture; they do not replace production smoke checks.

Phase 2 still needs atomic local state/outbox persistence, server-ordered incremental synchronization, deterministic rebuild/recovery and concurrent stock handling. The existing full replay feature retains its pre-existing limitations. Later phases cover modularization and preorder UX; this security deployment does not claim those phases complete.
