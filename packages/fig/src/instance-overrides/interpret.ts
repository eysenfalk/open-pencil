import type { GUID, NodeChange } from '@open-pencil/kiwi/fig/codec'
import { guidToString } from '@open-pencil/kiwi/fig/guid'
import type { Vector } from '@open-pencil/scene-graph'

import {
  fieldsBoundByAssignments,
  bindSourceProperties,
  componentBindings,
  instanceBindings,
  type BoundPropertyClaim,
  type PropertyBinding
} from './interpret-bindings'
import { invalidateInheritedTextData } from './text-provenance'
import type {
  ComponentPropAssignment,
  DerivedSymbolOverride,
  SymbolData,
  SymbolOverride
} from './types'

function readOverrideKey(value: unknown): GUID | undefined {
  if (!value || typeof value !== 'object' || !('sessionID' in value) || !('localID' in value))
    return undefined
  if (typeof value.sessionID !== 'number' || typeof value.localID !== 'number') return undefined
  return { sessionID: value.sessionID, localID: value.localID }
}

/** An explicit claim keeps the complete path relative to its owning occurrence. */
export interface InstancePropertyClaim {
  /** Source record declaring the claim; preserved when inherited by another occurrence. */
  declaredBy: string
  path: readonly GUID[]
  properties: Record<string, unknown>
}

/** One occurrence, not a shared source node or a SceneGraph editing clone. */
export interface InstanceOccurrence {
  readonly sourceId: string
  readonly overrideKey: GUID | undefined
  mainComponentId: string | null
  mainComponentOverrideKey?: GUID
  sourceComponentOverrideKey?: GUID
  sourceComponentId?: GUID
  properties: NodeChange
  children: InstanceOccurrence[]
  /** Explicit property records declared by this occurrence's source. */
  propertyClaims: InstancePropertyClaim[]
  bindingClaims: BoundPropertyClaim[]
  derivedSize?: Vector
  /** Whether this expansion supplies a name rather than only inheriting it. */
  hasOwnName: boolean
  defaultInstanceName?: string
}

export interface InstancePathDiagnostic {
  ownerId: string
  mainComponentId?: string | null
  path: readonly GUID[]
  reason: 'missing-target' | 'ambiguous-target'
}

export interface InstanceAssignmentDiagnostic extends InstancePathDiagnostic {
  assignments: readonly ComponentPropAssignment[]
}

export interface InterpretInstanceOptions {
  /** Apply explicitly saved effective bounds, geometry and typography; no inferred scaling or layout. */
  derivedBounds?: boolean
  /** Unresolved property overrides are skipped only when a diagnostic receiver is supplied. */
  onUnresolvedProperty?: (diagnostic: InstancePathDiagnostic) => void
  /** Explicit partial evaluation: report and skip missing assignment targets. Swaps remain fatal. */
  onUnresolvedAssignment?: (diagnostic: InstanceAssignmentDiagnostic) => void
}

class InstancePathError extends Error {
  constructor(
    readonly diagnostic: InstancePathDiagnostic,
    message: string
  ) {
    super(message)
    this.name = 'InstancePathError'
  }
}

class SegmentError extends Error {
  constructor(
    readonly count: number,
    guid: GUID
  ) {
    super(`Expected one instance-path target for ${guidToString(guid)}; found ${count}`)
    this.name = 'SegmentError'
  }
}

function sameGuid(left: GUID | undefined, right: GUID): boolean {
  return left?.sessionID === right.sessionID && left.localID === right.localID
}

/** Search through ordinary containers, but never cross an instance boundary implicitly. */
function findSegment(root: InstanceOccurrence, guid: GUID): InstanceOccurrence {
  const matches: InstanceOccurrence[] = []
  const visit = (node: InstanceOccurrence): void => {
    if (sameGuid(node.overrideKey, guid) || node.sourceId === guidToString(guid)) {
      matches.push(node)
      return
    }
    if (node.mainComponentId !== null) return
    for (const child of node.children) visit(child)
  }
  for (const child of root.children) visit(child)
  if (matches.length !== 1) {
    throw new SegmentError(matches.length, guid)
  }
  return matches[0]
}

function isRootGuid(owner: InstanceOccurrence, guid: GUID): boolean {
  return (
    sameGuid(owner.properties.symbolData?.symbolID, guid) ||
    sameGuid(owner.mainComponentOverrideKey, guid) ||
    sameGuid(owner.sourceComponentOverrideKey, guid) ||
    sameGuid(owner.sourceComponentId, guid)
  )
}

function retainEffectiveAssignments(
  source: NodeChange,
  occurrence: InstanceOccurrence,
  assignments: ComponentPropAssignment[]
): void {
  if (source.type === 'INSTANCE') occurrence.properties.componentPropAssignments = assignments
}

function restorePlacedSize(source: NodeChange, occurrence: InstanceOccurrence): void {
  if (source.type === 'INSTANCE' && source.size)
    occurrence.properties.size = structuredClone(source.size)
}

export function resolveOccurrencePath(
  owner: InstanceOccurrence,
  path: readonly GUID[]
): InstanceOccurrence {
  let target = owner
  for (const [index, guid] of path.entries()) {
    if (index === 0 && isRootGuid(owner, guid)) continue
    target = findSegment(target, guid)
  }
  return target
}

function applyPropertyOverrides(
  overrides: readonly SymbolOverride[],
  targetFor: (path: readonly GUID[]) => InstanceOccurrence,
  options: InterpretInstanceOptions,
  record: (
    target: InstanceOccurrence,
    props: Record<string, unknown>,
    path: readonly GUID[]
  ) => void,
  isRemovedTarget: (path: readonly GUID[]) => boolean
): void {
  for (const override of overrides) {
    const {
      guidPath,
      overriddenSymbolID: _swap,
      componentPropAssignments: _assignments,
      ...props
    } = override
    if (!guidPath?.guids?.length || Object.keys(props).length === 0) continue
    let target: InstanceOccurrence
    try {
      target = targetFor(guidPath.guids)
    } catch (error) {
      if (
        error instanceof InstancePathError &&
        error.diagnostic.reason === 'missing-target' &&
        isRemovedTarget(guidPath.guids)
      )
        continue
      if (!(error instanceof InstancePathError) || !options.onUnresolvedProperty) throw error
      options.onUnresolvedProperty(error.diagnostic)
      continue
    }
    invalidateInheritedTextData(target.properties, props)
    Object.assign(target.properties, structuredClone(props))
    record(target, props, guidPath.guids)
  }
}

function applyDerivedBounds(
  source: NodeChange,
  root: InstanceOccurrence,
  targetFor: (path: readonly GUID[]) => InstanceOccurrence,
  options: InterpretInstanceOptions
): void {
  if (!options.derivedBounds) return
  const derived = source.derivedSymbolData as DerivedSymbolOverride[] | undefined
  for (const entry of derived ?? []) {
    const path = entry.guidPath?.guids
    if (!path?.length) continue
    let target: InstanceOccurrence
    try {
      target = targetFor(path)
    } catch (error) {
      // Derived records can retain stale paths just like explicit property records.
      if (!(error instanceof InstancePathError) || !options.onUnresolvedProperty) throw error
      options.onUnresolvedProperty(error.diagnostic)
      continue
    }
    if (target === root) continue // Placed root bounds belong to its NodeChange.
    if (entry.derivedTextData)
      target.properties.derivedTextData = structuredClone(entry.derivedTextData)
    if (entry.fontSize !== undefined) target.properties.fontSize = entry.fontSize
    if (entry.lineHeight !== undefined)
      target.properties.lineHeight = structuredClone(entry.lineHeight)
    if (entry.letterSpacing !== undefined)
      target.properties.letterSpacing = structuredClone(entry.letterSpacing)
    if (entry.size) {
      target.properties.size = structuredClone(entry.size)
      target.derivedSize = structuredClone(entry.size)
    }
    if (entry.transform) target.properties.transform = structuredClone(entry.transform)
    const { fillGeometry, strokeGeometry, vectorData } = entry
    if (fillGeometry) target.properties.fillGeometry = structuredClone(fillGeometry)
    if (strokeGeometry) target.properties.strokeGeometry = structuredClone(strokeGeometry)
    if (vectorData) target.properties.vectorData = structuredClone(vectorData)
  }
}

function inheritedOccurrenceProperties(
  base: InstanceOccurrence | null
): Pick<InstanceOccurrence, 'propertyClaims' | 'mainComponentOverrideKey' | 'mainComponentId'> {
  return {
    propertyClaims: structuredClone(base?.propertyClaims ?? []),
    mainComponentOverrideKey: base?.mainComponentOverrideKey ?? base?.overrideKey,
    mainComponentId: base ? (base.mainComponentId ?? base.sourceId) : null
  }
}

function symbolOverrides(source: NodeChange): readonly SymbolOverride[] {
  return (source.symbolData as SymbolData | undefined)?.symbolOverrides ?? []
}

function replaceOccurrence(target: InstanceOccurrence, replacement: InstanceOccurrence): void {
  if (target.mainComponentId === null) throw new Error('Swap target is not an instance')
  target.mainComponentOverrideKey = replacement.mainComponentOverrideKey ?? replacement.overrideKey
  target.mainComponentId = replacement.mainComponentId ?? replacement.sourceId
  const { guid, parentIndex, type, name, transform, size, componentPropRefs } = target.properties
  target.properties = {
    ...replacement.properties,
    guid,
    parentIndex,
    type,
    transform,
    size,
    componentPropRefs: structuredClone(componentPropRefs),
    ...(target.hasOwnName
      ? { name }
      : { name: replacement.defaultInstanceName ?? replacement.properties.name })
  }
  target.children = replacement.children
  target.propertyClaims = replacement.propertyClaims
  target.bindingClaims = replacement.bindingClaims
}

function samePath(a: readonly GUID[], b: readonly GUID[]): boolean {
  return a.length === b.length && a.every((guid, index) => sameGuid(b[index], guid))
}

function groupedStructuralOverrides(overrides: readonly SymbolOverride[]): SymbolOverride[] {
  const groups: SymbolOverride[] = []
  for (const override of overrides) {
    const path = override.guidPath?.guids
    if (!path?.length) continue
    if (!override.overriddenSymbolID && !override.componentPropAssignments?.length) continue
    const existing = groups.find((group) => samePath(group.guidPath?.guids ?? [], path))
    if (!existing) {
      groups.push({
        guidPath: structuredClone(override.guidPath),
        overriddenSymbolID: structuredClone(override.overriddenSymbolID),
        componentPropAssignments: structuredClone(override.componentPropAssignments)
      })
      continue
    }
    if (override.overriddenSymbolID) existing.overriddenSymbolID = override.overriddenSymbolID
    existing.componentPropAssignments = [
      ...(existing.componentPropAssignments ?? []),
      ...(override.componentPropAssignments ?? [])
    ]
  }
  return groups.sort((a, b) => (a.guidPath?.guids?.length ?? 0) - (b.guidPath?.guids?.length ?? 0))
}

function rootAssignments(source: NodeChange, componentKey?: GUID): ComponentPropAssignment[] {
  return symbolOverrides(source).flatMap((override) => {
    const path = override.guidPath?.guids
    return path?.length === 1 &&
      (sameGuid(source.symbolData?.symbolID, path[0]) || sameGuid(componentKey, path[0]))
      ? (override.componentPropAssignments ?? [])
      : []
  })
}

function applyStructuralOverrides(
  overrides: readonly SymbolOverride[],
  targetFor: (path: readonly GUID[]) => InstanceOccurrence,
  expand: (
    id: string,
    bindings?: readonly PropertyBinding[],
    assignments?: readonly ComponentPropAssignment[]
  ) => InstanceOccurrence,
  reconfigure: (
    target: InstanceOccurrence,
    assignments: readonly ComponentPropAssignment[]
  ) => void,
  adopt: (target: InstanceOccurrence, replacement: InstanceOccurrence) => void,
  retireDescendants: (target: InstanceOccurrence) => void,
  options: InterpretInstanceOptions
): void {
  const structural = groupedStructuralOverrides(overrides)
  for (const override of structural) {
    const path = override.guidPath?.guids
    if (!path?.length) continue
    let target: InstanceOccurrence
    try {
      target = targetFor(path)
    } catch (error) {
      if (
        !(error instanceof InstancePathError) ||
        error.diagnostic.reason !== 'missing-target' ||
        override.overriddenSymbolID ||
        !options.onUnresolvedAssignment
      )
        throw error
      options.onUnresolvedAssignment({
        ...error.diagnostic,
        assignments: structuredClone(override.componentPropAssignments ?? [])
      })
      continue
    }
    if (override.overriddenSymbolID) {
      const replacement = expand(
        guidToString(override.overriddenSymbolID),
        [],
        override.componentPropAssignments
      )
      retireDescendants(target)
      replaceOccurrence(target, replacement)
      adopt(target, replacement)
    } else {
      reconfigure(target, override.componentPropAssignments ?? [])
    }
  }
}

function bindingContext(
  source: NodeChange,
  bindings: readonly PropertyBinding[],
  assignments: readonly ComponentPropAssignment[]
): readonly PropertyBinding[] {
  return source.type === 'SYMBOL'
    ? instanceBindings(componentBindings(source), assignments)
    : bindings
}

/**
 * Interpret source component expansion and explicit symbol overrides without SceneGraph.
 * This slice interprets direct component bindings and explicit symbol overrides.
 * Variables and derived layout remain unsupported.
 */
export function interpretInstance(
  changes: readonly NodeChange[],
  instanceId: string,
  options: InterpretInstanceOptions = {}
): InstanceOccurrence {
  return createOccurrenceInterpreter(changes).instance(instanceId, options)
}

export function interpretComponent(
  changes: readonly NodeChange[],
  componentId: string,
  options: InterpretInstanceOptions = {}
): InstanceOccurrence {
  return createOccurrenceInterpreter(changes).component(componentId, options)
}

/** One source index per document; evaluation state remains local to each call. */
export function createOccurrenceInterpreter(changes: readonly NodeChange[]) {
  const sources = new Map<string, NodeChange>()
  const children = new Map<string, NodeChange[]>()
  for (const change of changes) {
    if (!change.guid) continue
    const id = guidToString(change.guid)
    if (sources.has(id)) throw new Error(`Duplicate source node ${id}`)
    sources.set(id, change)
    if (!change.parentIndex?.guid) continue
    const parentId = guidToString(change.parentIndex.guid)
    const siblings = children.get(parentId)
    if (siblings) siblings.push(change)
    else children.set(parentId, [change])
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => {
      const left = a.parentIndex?.position ?? ''
      const right = b.parentIndex?.position ?? ''
      if (left === right) return 0
      return left < right ? -1 : 1
    })
  }

  return {
    instance: (id: string, options: InterpretInstanceOptions = {}) =>
      interpretRoot(sources, children, id, 'INSTANCE', options),
    component: (id: string, options: InterpretInstanceOptions = {}) =>
      interpretRoot(sources, children, id, 'SYMBOL', options),
    page: (id: string, options: InterpretInstanceOptions = {}) =>
      interpretRoot(sources, children, id, 'CANVAS', options)
  }
}

function interpretRoot(
  sources: ReadonlyMap<string, NodeChange>,
  children: ReadonlyMap<string, readonly NodeChange[]>,
  instanceId: string,
  expectedType: 'INSTANCE' | 'SYMBOL' | 'CANVAS',
  options: InterpretInstanceOptions
): InstanceOccurrence {
  const expanding = new Set<string>()
  const claimsByTarget = new WeakMap<InstanceOccurrence, InstancePropertyClaim[]>()
  const indexClaim = (target: InstanceOccurrence, claim: InstancePropertyClaim): void => {
    const claims = claimsByTarget.get(target) ?? []
    claims.push(claim)
    claimsByTarget.set(target, claims)
  }
  const retireDescendants = (target: InstanceOccurrence): void => {
    for (const child of target.children) {
      for (const claim of claimsByTarget.get(child) ?? []) claim.properties = {}
      retireDescendants(child)
    }
  }
  const propertyPatches = new WeakMap<InstanceOccurrence, Record<string, unknown>>()
  const recordPatch = (target: InstanceOccurrence, props: Record<string, unknown>): void => {
    propertyPatches.set(target, { ...propertyPatches.get(target), ...structuredClone(props) })
  }
  const restorePatches = (
    previous: InstanceOccurrence,
    next: InstanceOccurrence,
    assignments: readonly ComponentPropAssignment[],
    descendBindings = true
  ): void => {
    const boundFields = fieldsBoundByAssignments(next.properties, assignments)
    for (const claim of claimsByTarget.get(previous) ?? []) {
      claim.properties = Object.fromEntries(
        Object.entries(claim.properties).filter(([field]) => !boundFields.has(field))
      )
      indexClaim(next, claim)
    }
    const patch = propertyPatches.get(previous)
    if (patch) {
      const retained = Object.fromEntries(
        Object.entries(patch).filter(([field]) => !boundFields.has(field))
      )
      invalidateInheritedTextData(next.properties, retained)
      Object.assign(next.properties, structuredClone(retained))
      recordPatch(next, retained)
    }
    for (const child of previous.children) {
      const matches = next.children.filter((candidate) => candidate.sourceId === child.sourceId)
      if (matches.length === 1)
        restorePatches(
          child,
          matches[0],
          descendBindings ? assignments : [],
          child.mainComponentId === null
        )
    }
  }
  // Re-expansion recipes are occurrence-local; retaining them avoids falling back
  // to the unconfigured source when a more distant owner changes one binding.
  const recipes = new WeakMap<
    InstanceOccurrence,
    (assignments: readonly ComponentPropAssignment[]) => InstanceOccurrence
  >()
  const adopt = (target: InstanceOccurrence, replacement: InstanceOccurrence): void => {
    const recipe = recipes.get(replacement)
    if (!recipe) throw new Error('Missing occurrence expansion recipe')
    recipes.set(target, recipe)
  }
  const reconfigure = (
    target: InstanceOccurrence,
    assignments: readonly ComponentPropAssignment[]
  ): void => {
    const recipe = recipes.get(target)
    if (!recipe) throw new Error('Missing occurrence expansion recipe')
    const replacement = recipe(assignments)
    restorePatches(target, replacement, assignments)
    replaceOccurrence(target, replacement)
    adopt(target, replacement)
  }
  const inheritsInstanceName = (
    symbolId: GUID | undefined,
    base: InstanceOccurrence | null
  ): boolean => {
    if (!symbolId || !base) return false
    return sources.get(guidToString(symbolId))?.type === 'INSTANCE' && base.hasOwnName
  }
  const defaultInstanceName = (base: InstanceOccurrence | null): string | undefined => {
    if (!base) return undefined
    const source = sources.get(base.sourceId)
    if (source?.type === 'INSTANCE') return base.properties.name
    const parentGuid = source?.parentIndex?.guid
    const parent = parentGuid ? sources.get(guidToString(parentGuid)) : undefined
    return parent?.isStateGroup === true ? parent.name : base.properties.name
  }
  const bindingChangesComponent = (raw: NodeChange, bound: NodeChange): boolean => {
    const original = raw.symbolData?.symbolID
    const replacement = bound.symbolData?.symbolID
    return !!original && !!replacement && !sameGuid(original, replacement)
  }
  const sourceRootIdentity = (raw: NodeChange) => {
    const sourceComponentId = raw.symbolData?.symbolID
    const component = sourceComponentId ? sources.get(guidToString(sourceComponentId)) : undefined
    return {
      sourceComponentId,
      sourceComponentOverrideKey: readOverrideKey(component?.overrideKey)
    }
  }
  const resolvesInSourceComponent = (componentId: GUID, path: readonly GUID[]): boolean => {
    let sourceId = guidToString(componentId)
    for (const [index, segment] of path.entries()) {
      const source = sources.get(sourceId)
      if (!source) return false
      if (
        index === 0 &&
        (sameGuid(source.guid, segment) || sameGuid(readOverrideKey(source.overrideKey), segment))
      )
        continue
      const matches: NodeChange[] = []
      const visit = (parentId: string): void => {
        for (const child of children.get(parentId) ?? []) {
          if (
            sameGuid(child.guid, segment) ||
            sameGuid(readOverrideKey(child.overrideKey), segment)
          )
            matches.push(child)
          else if (!child.symbolData?.symbolID && child.guid) visit(guidToString(child.guid))
        }
      }
      visit(sourceId)
      if (matches.length !== 1) return false
      const matched = matches[0]
      if (index === path.length - 1) return true
      if (!matched.symbolData?.symbolID) return false
      sourceId = guidToString(matched.symbolData.symbolID)
    }
    return false
  }
  const expand = (
    id: string,
    bindings: readonly PropertyBinding[] = [],
    assignments: readonly ComponentPropAssignment[] = []
  ): InstanceOccurrence => {
    if (expanding.has(id)) throw new Error(`Cyclic component expansion at ${id}`)
    const raw = sources.get(id)
    if (!raw) throw new Error(`Missing source node ${id}`)
    const bindingClaims: BoundPropertyClaim[] = []
    const source = bindSourceProperties(raw, bindings, (claim) => bindingClaims.push(claim))
    expanding.add(id)
    try {
      const symbolId = source.symbolData?.symbolID
      const componentKey = symbolId
        ? readOverrideKey(sources.get(guidToString(symbolId))?.overrideKey)
        : undefined
      const ownAssignments = (source.componentPropAssignments ?? []) as ComponentPropAssignment[]
      const base = symbolId
        ? expand(
            guidToString(symbolId),
            [],
            [...ownAssignments, ...rootAssignments(source, componentKey), ...assignments]
          )
        : null
      const childBindings = bindingContext(source, bindings, assignments)
      const occurrence: InstanceOccurrence = {
        sourceId: id,
        ...sourceRootIdentity(raw),
        ...inheritedOccurrenceProperties(base),
        bindingClaims,
        hasOwnName: inheritsInstanceName(symbolId, base),
        overrideKey: readOverrideKey(source.overrideKey),
        properties: { ...base?.properties, ...source },
        children:
          base?.children ??
          (children.get(id) ?? []).map((child) => {
            if (!child.guid) throw new Error('Indexed child has no GUID')
            return expand(guidToString(child.guid), childBindings)
          })
      }
      retainEffectiveAssignments(source, occurrence, [
        ...ownAssignments,
        ...rootAssignments(source, componentKey),
        ...assignments
      ])
      if (base && bindingChangesComponent(raw, source)) {
        occurrence.properties.name = defaultInstanceName(base)
      }
      for (const claim of occurrence.propertyClaims) {
        indexClaim(resolveOccurrencePath(occurrence, claim.path), claim)
      }
      occurrence.defaultInstanceName = defaultInstanceName(occurrence)
      const overrides = symbolOverrides(source)
      const targetFor = (path: readonly GUID[]): InstanceOccurrence => {
        let target = occurrence
        try {
          for (const [index, guid] of path.entries()) {
            if (index === 0 && isRootGuid(occurrence, guid)) continue
            target = findSegment(target, guid)
          }
        } catch (cause) {
          if (!(cause instanceof SegmentError)) throw cause
          throw new InstancePathError(
            {
              ownerId: id,
              mainComponentId: occurrence.mainComponentId,
              path: structuredClone(path),
              reason: cause.count === 0 ? 'missing-target' : 'ambiguous-target'
            },
            `Override declared by ${id}, path [${path.map(guidToString).join(', ')}]: ${cause.message}`
          )
        }
        return target
      }
      applyStructuralOverrides(
        overrides.filter((override) => {
          const path = override.guidPath?.guids
          return !(
            path?.length === 1 &&
            isRootGuid(occurrence, path[0]) &&
            !override.overriddenSymbolID
          )
        }),
        targetFor,
        expand,
        reconfigure,
        adopt,
        retireDescendants,
        options
      )
      applyPropertyOverrides(
        overrides,
        targetFor,
        options,
        (target, props, path) => {
          if ('name' in props) target.hasOwnName = true
          recordPatch(target, props)
          const claim: InstancePropertyClaim = {
            declaredBy: id,
            path: structuredClone(path),
            properties: structuredClone(props)
          }
          occurrence.propertyClaims.push(claim)
          indexClaim(target, claim)
        },
        (path) => {
          const original = raw.symbolData?.symbolID
          return (
            !!original &&
            bindingChangesComponent(raw, source) &&
            resolvesInSourceComponent(original, path)
          )
        }
      )
      restorePlacedSize(source, occurrence)
      applyDerivedBounds(source, occurrence, targetFor, options)
      recipes.set(occurrence, (next) => expand(id, bindings, [...assignments, ...next]))
      return occurrence
    } finally {
      expanding.delete(id)
    }
  }
  if (sources.get(instanceId)?.type !== expectedType) {
    const kind = { INSTANCE: 'an instance', SYMBOL: 'a component', CANVAS: 'a page' }[expectedType]
    throw new Error(`Expected ${kind} source`)
  }
  const result = expand(instanceId)
  const pruneClaims = (node: InstanceOccurrence): void => {
    node.propertyClaims = node.propertyClaims.filter(
      (claim) => Object.keys(claim.properties).length > 0
    )
    for (const child of node.children) pruneClaims(child)
  }
  pruneClaims(result)
  return result
}
