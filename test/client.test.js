import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const bundlePath = path.join(here, '..', 'lib', 'client.js')

function fakeReact() {
  return {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
    useState(initial) {
      return [initial, () => {}]
    },
    useEffect() {},
    useRef(value) {
      return { current: value }
    },
  }
}

function loadClient() {
  const source = readFileSync(bundlePath, 'utf8')
  let definition = null
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(value) {
          definition = value
        },
      },
    },
    console,
  }
  vm.runInNewContext(source, sandbox)
  assert.ok(definition !== null)
  assert.equal(definition.id, 'dsh-task-digest')
  const react = fakeReact()
  const exported = definition.factory((name) => {
    if (name === 'react') return react
    throw new Error(`unexpected require: ${name}`)
  })
  return { exported, react }
}

function fakeContext(registrations) {
  return {
    effect(fn) {
      const disposable = fn()
      return () => {
        if (typeof disposable === 'function') disposable()
      }
    },
    locale: {
      register() {
        return () => {}
      },
      bind() {
        return (key) => key
      },
    },
    slots: {
      inject(_name, fn) {
        return fn()
      },
      register(options) {
        registrations.push(options)
        return () => {}
      },
    },
    uiWorkspace: {
      openSession() {},
    },
  }
}

test('the digest bundle registers only its own page and sidebar entry', () => {
  const { exported } = loadClient()
  assert.equal(typeof exported.apply, 'function')
  assert.equal(exported.inject.join(','), 'slots,locale,uiWorkspace')
  const registrations = []
  exported.apply(fakeContext(registrations))
  assert.equal(registrations.length, 2)
  const main = registrations.find((entry) => entry.name === 'main')
  assert.ok(main)
  assert.equal(main.key, 'task-digest')
  assert.ok(main.inject().openSession)
  const panel = registrations.find((entry) => entry.name === 'sidebar.panellist')
  assert.ok(panel)
  assert.equal(panel.id, 'task-digest')
  assert.equal(panel.order, 11)
})

test('digest formatting helpers', () => {
  const { exported } = loadClient()
  assert.equal(exported.__test.formatTokens(1234), '1.2K')
  assert.equal(exported.__test.formatMoney(0.00032), '¥0.0003')
})

test('the digest markdown renderer builds safe React nodes', () => {
  const { exported } = loadClient()
  const nodes = exported.__test.renderMarkdown('# 标题\n\n- 一\n- 二\n\n**粗体** 和 `code`\n\n| A | B |\n| --- | --- |\n| 1 | 2 |')
  assert.ok(Array.isArray(nodes))
  const heading = nodes.find((node) => node.type === 'h1')
  assert.ok(heading)
  assert.equal(heading.children[0], '标题')
  const list = nodes.find((node) => node.type === 'ul')
  assert.ok(list)
  assert.equal(list.children.length, 2)
  const table = nodes.find((node) => node.type === 'table')
  assert.ok(table)
  const paragraph = nodes.find((node) => node.type === 'p')
  const strong = paragraph.children.find((child) => child !== null && typeof child === 'object' && child.type === 'strong')
  assert.ok(strong)
  assert.equal(strong.children[0], '粗体')
})
