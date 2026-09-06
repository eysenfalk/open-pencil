import type { EditorPreparationHandle } from '@/app/editor/preparation/types'
import type {
  StorageAdapter,
  StorageDocument,
  StorageDocumentBinding
} from '@/app/integrations/storage/types'
import { storageCanvasId } from '@/app/storage/id'
import { getLocalCanvasStore } from '@/app/storage/local-store'
import { seedStorageCanvasFromRemote } from '@/app/storage/sync/persist'

/** Load a bound replica without depending on tab state or the selected location. */
export async function readStorageDocument(
  document: StorageDocument,
  binding: StorageDocumentBinding,
  adapter: StorageAdapter,
  load: EditorPreparationHandle
): Promise<File> {
  const canvasId = storageCanvasId(binding)
  load.update({ phase: 'reading', detail: document.name })
  const local = getLocalCanvasStore()
  const metadata = await local.getMeta(canvasId)
  load.signal.throwIfAborted()
  const cached = metadata?.hasFig ? await local.readFig(canvasId) : null
  load.signal.throwIfAborted()
  const authoritative =
    metadata?.syncStatus !== 'synced' ||
    !document.metadataAuthoritative ||
    metadata.updatedAt >= document.updatedAt
  let bytes = cached && authoritative ? cached : null
  if (!bytes) {
    bytes = await adapter.getDocument(
      document.id,
      (progress) =>
        load.update({
          phase: 'reading',
          detail: document.name,
          completed: progress.transferredBytes,
          total: progress.totalBytes,
          unit: 'bytes'
        }),
      load.signal
    )
    load.signal.throwIfAborted()
    await seedStorageCanvasFromRemote({
      ...binding,
      canvasId,
      name: document.name,
      updatedAt: document.updatedAt,
      figBytes: bytes
    })
    load.signal.throwIfAborted()
  }
  return new File([Uint8Array.from(bytes)], `${document.name}.fig`, {
    type: 'application/octet-stream'
  })
}
