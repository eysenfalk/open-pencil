import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { createPopulationWorkerClient } from '#core/kiwi/fig/population/client'
import type { FigSessionPopulateRequest, FigSessionResponse } from '#core/kiwi/fig/session/protocol'

for (const mutation of ['local-child', 'reorder', 'wrong-revision'] as const) {
  test(`rejects population deltas after ${mutation}`, async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const first = graph.createNode('RECTANGLE', page.id)
    const second = graph.createNode('RECTANGLE', page.id)
    let request: FigSessionPopulateRequest | undefined
    const port = {
      onmessage: null as ((event: MessageEvent<FigSessionResponse>) => void) | null,
      start: () => undefined,
      close: () => undefined,
      postMessage(message: FigSessionPopulateRequest) {
        request = message
      }
    }
    const worker = {
      terminate: () => undefined,
      postMessage: () => undefined,
      onerror: null,
      onmessage: null
    }
    const client = createPopulationWorkerClient(graph, worker, port)
    try {
      const pending = client.populate(page.id)
      if (!request) throw new Error('Missing request')
      if (mutation === 'local-child') graph.createNode('RECTANGLE', page.id)
      if (mutation === 'reorder') graph.insertChildAt(second.id, page.id, 0)
      const expected = [...page.childIds]
      port.onmessage?.({
        data: {
          type: 'population-result',
          requestId: request.requestId,
          baseRevision: request.baseRevision + (mutation === 'wrong-revision' ? 1 : 0),
          populated: true,
          delta: {
            created: [],
            updated: [[page.id, { childIds: [first.id] }]],
            deleted: [],
            instanceIndex: [],
            populatedRootIds: [page.id]
          }
        }
      } as MessageEvent<FigSessionResponse>)
      expect(await pending).toBeNull()
      expect(page.childIds).toEqual(expected)
    } finally {
      client.terminate()
    }
  })
}
