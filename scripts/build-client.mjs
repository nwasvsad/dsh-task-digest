/**
 * Client-bundle generator for the digest page.
 *
 * @module dsh-task-digest/scripts/build-client
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Plugin id: the loader row name and the module-table key. */
export const PLUGIN_ID = 'dsh-task-digest'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const sourcePath = resolve(root, 'src/client.js')
const outPath = resolve(root, 'lib/client.js')

function indent(text) {
  return text
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : `\t\t${line}`))
    .join('\n')
}

/**
 * Wrap one browser source in the module-loader factory.
 * @param {string} source Browser source (no ESM statements).
 * @returns {string} Complete bundle text.
 */
export function buildBundle(source) {
  const body = source.replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '').trim()
  if (/^\s*(?:import|export)\b/m.test(body)) {
    throw new Error('src/client.js must not contain import/export statements')
  }
  return `/**
 * Generated browser bundle for the DSH task-digest plugin. Do not edit:
 * regenerate with \`node scripts/build-client.mjs\`.
 */
window.__ModuleLoader__.load({
\tid: ${JSON.stringify(PLUGIN_ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
\t\tlet react = require("react");

${indent(body)}

\t\treturn module.exports;
\t}
});
`
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bundle = buildBundle(readFileSync(sourcePath, 'utf8'))
  writeFileSync(outPath, bundle, 'utf8')
  process.stdout.write(`wrote ${outPath} (${bundle.length} bytes)\n`)
}
