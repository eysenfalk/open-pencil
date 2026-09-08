import type { GUID, NodeChange } from '@open-pencil/kiwi/fig/codec'
import { guidToString } from '@open-pencil/kiwi/fig/guid'

interface LinkedPropertyDefinition {
  id?: GUID
  parentPropDefId?: GUID
  [field: string]: unknown
}

/** Resolve definition inheritance only within the source node's ancestry. */
export function inheritComponentPropertyDefinitions(changes: readonly NodeChange[]): void {
  const sources = new Map(
    changes.flatMap((node) => (node.guid ? [[guidToString(node.guid), node] as const] : []))
  )
  const pending = new Set<NodeChange>()
  const complete = new Set<NodeChange>()
  const resolve = (node: NodeChange): void => {
    if (complete.has(node)) return
    if (pending.has(node)) throw new Error('Cyclic component-property ancestry')
    pending.add(node)
    const ancestors: NodeChange[] = []
    let parent = node.parentIndex?.guid
      ? sources.get(guidToString(node.parentIndex.guid))
      : undefined
    const visited = new Set<NodeChange>([node])
    while (parent) {
      if (visited.has(parent)) throw new Error('Cyclic component-property ancestry')
      visited.add(parent)
      resolve(parent)
      ancestors.push(parent)
      parent = parent.parentIndex?.guid
        ? sources.get(guidToString(parent.parentIndex.guid))
        : undefined
    }
    const definitions = node.componentPropDefs as LinkedPropertyDefinition[] | undefined
    if (definitions)
      node.componentPropDefs = definitions.map((definition) => {
        if (!definition.parentPropDefId) return definition
        const id = guidToString(definition.parentPropDefId)
        for (const ancestor of ancestors) {
          const matches = (
            (ancestor.componentPropDefs as LinkedPropertyDefinition[] | undefined) ?? []
          ).filter((candidate) => candidate.id && guidToString(candidate.id) === id)
          if (matches.length > 1) throw new Error(`Ambiguous parent property ${id}`)
          if (matches.length === 1) return { ...structuredClone(matches[0]), ...definition }
        }
        throw new Error(`Missing parent property ${id}`)
      })
    pending.delete(node)
    complete.add(node)
  }
  for (const node of changes) resolve(node)
}
