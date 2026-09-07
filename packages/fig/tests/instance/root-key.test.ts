import { expect, test } from 'bun:test'

import { interpretInstance } from '#fig/instance-overrides/interpret'

import type { NodeChange } from '@open-pencil/kiwi/fig/codec'

import { guid } from '../helpers/guid'

test('component root-key assignments configure children before expansion', () => {
  const changes = [
    {
      guid: guid(1),
      overrideKey: guid(90),
      type: 'SYMBOL',
      componentPropDefs: [
        { id: guid(80), name: 'Label', type: 'TEXT', initialValue: { textValue: 'Default' } }
      ]
    },
    {
      guid: guid(3),
      type: 'TEXT',
      parentIndex: { guid: guid(1), position: '!' },
      componentPropRefs: [{ defID: guid(80), componentPropNodeField: 'TEXT_DATA' }]
    },
    {
      guid: guid(2),
      type: 'INSTANCE',
      symbolData: {
        symbolID: guid(1),
        symbolOverrides: [
          {
            guidPath: { guids: [guid(90)] },
            componentPropAssignments: [{ defID: guid(80), value: { textValue: 'Assigned' } }]
          }
        ]
      }
    }
  ] as NodeChange[]
  expect(interpretInstance(changes, '1:2').children[0].properties.textData?.characters).toBe(
    'Assigned'
  )
})

test('a root-key swap replaces the component rather than resolving a child', () => {
  const changes = [
    { guid: guid(1), overrideKey: guid(90), type: 'SYMBOL' },
    { guid: guid(3), overrideKey: guid(91), type: 'SYMBOL', name: 'Replacement' },
    {
      guid: guid(4),
      type: 'TEXT',
      parentIndex: { guid: guid(3), position: '!' },
      textData: { characters: 'New' }
    },
    {
      guid: guid(2),
      type: 'INSTANCE',
      symbolData: {
        symbolID: guid(1),
        symbolOverrides: [{ guidPath: { guids: [guid(90)] }, overriddenSymbolID: guid(3) }]
      }
    }
  ] as NodeChange[]
  const result = interpretInstance(changes, '1:2')
  expect(result.mainComponentId).toBe('1:3')
  expect(result.children[0].properties.textData?.characters).toBe('New')
})

test('component overrideKey addresses the root while placed instance size remains authoritative', () => {
  const changes = [
    { guid: guid(1), overrideKey: guid(90), type: 'SYMBOL', size: { x: 100, y: 40 } },
    {
      guid: guid(2),
      type: 'INSTANCE',
      size: { x: 50, y: 20 },
      symbolData: {
        symbolID: guid(1),
        uniformScaleFactor: 0.5,
        symbolOverrides: [
          { guidPath: { guids: [guid(90)] }, size: { x: 100, y: 40 }, opacity: 0.4 }
        ]
      }
    }
  ] as NodeChange[]
  const result = interpretInstance(changes, '1:2')
  expect(result.properties.opacity).toBe(0.4)
  expect(result.properties.size).toEqual({ x: 50, y: 20 })
})
