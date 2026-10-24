import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const libDir = path.join(here, '..', 'lib')

test('the digest host never imports the task-plan package', async () => {
  const names = await fs.readdir(libDir)
  for (const name of names) {
    if (!name.endsWith('.js') || name === 'client.js') continue
    const source = await fs.readFile(path.join(libDir, name), 'utf8')
    assert.equal(
      /(?:from\s*['"][^'"]*dsh-task-plan|require\(\s*['"][^'"]*dsh-task-plan)/.test(source),
      false,
      `${name} must not import dsh-task-plan`,
    )
  }
})
