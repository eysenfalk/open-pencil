import { expect, test } from 'bun:test'

import { summarizePathDiagnostics } from '../src/document/path-diagnostics'

test('groups repeated evaluations without collapsing owner or complete path', () => {
  const first = {
    ownerId: '1:1',
    path: [{ sessionID: 1, localID: 2 }],
    reason: 'missing-target' as const
  }
  const result = summarizePathDiagnostics([
    first,
    first,
    { ...first, ownerId: '1:3' },
    { ...first, path: [{ sessionID: 1, localID: 4 }, ...first.path] }
  ])
  expect(result.map((entry) => entry.occurrences)).toEqual([2, 1, 1])
  expect(first).not.toHaveProperty('occurrences')
})
