import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { guidToString } from '@open-pencil/kiwi/fig/guid'

import {
  createOccurrenceInterpreter,
  type InterpretInstanceOptions
} from '../instance-overrides/interpret'
import {
  resolveDocumentBindingReferences,
  type BindingReferenceDiagnostic
} from './binding-references'
import { planComponentConstruction } from './components'
import { collectSceneDependencies } from './dependency-closure'
import { inheritComponentPropertyDefinitions } from './property-inheritance'

/** Indexed source document. Resources remain separate from scene occurrences. */
export function createDocumentReader(source: readonly NodeChange[]) {
  const bindingDiagnostics: BindingReferenceDiagnostic[] = []
  const changes = resolveDocumentBindingReferences(source, (diagnostic) =>
    bindingDiagnostics.push(diagnostic)
  )
  inheritComponentPropertyDefinitions(changes)
  const resources = changes.filter(
    (change) => change.type === 'VARIABLE' || change.type === 'VARIABLE_SET'
  )
  const closure = collectSceneDependencies(changes)
  if (closure.missingIds.size)
    throw new Error(`Missing reachable sources: ${[...closure.missingIds].join(', ')}`)
  const sceneChanges = changes.filter(
    (change) =>
      change.type !== 'VARIABLE' &&
      change.type !== 'VARIABLE_SET' &&
      (change.type === 'CANVAS' ||
        (change.guid &&
          (closure.contentIds.has(guidToString(change.guid)) ||
            closure.ancestorIds.has(guidToString(change.guid)))))
  )
  const sourceInterpreter = createOccurrenceInterpreter(
    changes.filter((change) => change.type !== 'VARIABLE' && change.type !== 'VARIABLE_SET')
  )
  const interpreter = createOccurrenceInterpreter(sceneChanges)
  const pages = changes
    .filter((change) => change.type === 'CANVAS')
    .toSorted((a, b) => {
      const left = a.parentIndex?.position ?? ''
      const right = b.parentIndex?.position ?? ''
      if (left === right) return 0
      return left < right ? -1 : 1
    })
    .map((page) => {
      if (!page.guid) throw new Error('Page has no GUID')
      return { id: guidToString(page.guid), name: page.name ?? '' }
    })
  const pageIds = new Set(pages.map((page) => page.id))
  return {
    sourceRecords: changes,
    dependencyClosure: closure,
    pages,
    resources,
    bindingDiagnostics,
    readPage(id: string, options: InterpretInstanceOptions = {}) {
      if (!pageIds.has(id)) throw new Error(`Unknown page ${id}`)
      return interpreter.page(id, options)
    },
    planComponents(
      roots: readonly ReturnType<typeof interpreter.page>[],
      options: InterpretInstanceOptions = {}
    ) {
      return planComponentConstruction(changes, roots, (id) =>
        sourceInterpreter.component(id, options)
      )
    },
    readComponent: sourceInterpreter.component
  }
}
