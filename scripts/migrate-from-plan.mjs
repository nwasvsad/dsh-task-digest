/**
 * CLI for the report migration.
 *
 *   node scripts/migrate-from-plan.mjs \
 *     --from $DSH_HOME/task-plan \
 *     --to   $DSH_HOME/task-digest
 *
 * @module dsh-task-digest/scripts/migrate-from-plan
 */
import os from 'node:os'
import path from 'node:path'
import { migrate } from '../lib/migrate.js'

/**
 * Parse `--name value` / `--name=value` flags.
 * @param {string[]} argv Arguments.
 * @returns {Map<string, string|boolean>}
 */
function parseArgs(argv) {
  const args = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    if (key === 'force' || key === 'help') {
      args.set(key, true)
      continue
    }
    const value = argv[index + 1]
    if (value !== undefined && !value.startsWith('--')) {
      args.set(key, value)
      index += 1
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
if (args.get('help') === true) {
  process.stdout.write(
    'usage: node scripts/migrate-from-plan.mjs --from <planDataDir> --to <digestDataDir> [--force]\n',
  )
} else {
  const dshHome = process.env.DSH_HOME?.trim() || path.join(os.homedir(), '.dsh')
  const from = path.resolve(String(args.get('from') ?? path.join(dshHome, 'task-plan')))
  const to = path.resolve(String(args.get('to') ?? path.join(dshHome, 'task-digest')))
  const result = await migrate({ from, to, force: args.get('force') === true })
  process.stdout.write(
    `from=${from}\nto=${to}\nreports=${result.items} copiedFiles=${result.copiedFiles} ` +
      `skippedFiles=${result.skippedFiles} lastSummaryDate=${result.lastSummaryDate ?? 'null'}\n`,
  )
}
