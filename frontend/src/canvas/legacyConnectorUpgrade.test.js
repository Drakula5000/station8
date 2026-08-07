import test from 'node:test'
import assert from 'node:assert/strict'
import { upgradeLegacyConnectors } from './legacyConnectorUpgrade.js'

const arrow = (overrides = {}) => ({
  typeName: 'shape', id: 'shape:red', type: 'arrow', x: 10, y: 20, rotation: 0, index: 'a1', parentId: 'page:page', opacity: 1, isLocked: false, meta: {},
  props: { kind: 'arc', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, bend: 30, scale: 1, color: 'red', dash: 'dashed', size: 'm', arrowheadStart: 'none', arrowheadEnd: 'arrow', richText: { type: 'doc', content: [] }, ...overrides },
})

test('simple old native connectors upgrade to multipoint connectors without changing record identity', () => {
  const input = { store: { 'shape:red': arrow() } }
  const output = upgradeLegacyConnectors(input)
  const upgraded = output.store['shape:red']
  assert.equal(upgraded.id, 'shape:red')
  assert.equal(upgraded.type, 's8-connector')
  assert.equal(upgraded.props.points.length, 3)
  assert.equal(upgraded.props.color, 'red')
  assert.equal(upgraded.props.arrowheadEnd, 'arrow')
})

test('bound, labeled, and elbow arrows remain native to avoid losing semantics', () => {
  const bound = arrow()
  const labeled = arrow({ richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'keep me' }] }] } })
  const elbow = arrow({ kind: 'elbow' })
  const output = upgradeLegacyConnectors({ store: {
    'shape:red': bound,
    'binding:1': { typeName: 'binding', id: 'binding:1', type: 'arrow', fromId: 'shape:red', toId: 'shape:box', props: {} },
    'shape:label': { ...labeled, id: 'shape:label' },
    'shape:elbow': { ...elbow, id: 'shape:elbow' },
  } })
  assert.equal(output.store['shape:red'].type, 'arrow')
  assert.equal(output.store['shape:label'].type, 'arrow')
  assert.equal(output.store['shape:elbow'].type, 'arrow')
})
