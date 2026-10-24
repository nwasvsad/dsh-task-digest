/**
 * In-process test entry point (the DSH file sandbox cannot spawn `node --test`
 * children because pipes are unavailable).
 */
await import('./parity.test.js')
await import('./store.test.js')
await import('./report.test.js')
await import('./scheduler.test.js')
await import('./routes.test.js')
await import('./client.test.js')
await import('./apply.test.js')
await import('./independence.test.js')
await import('./migration.test.js')
