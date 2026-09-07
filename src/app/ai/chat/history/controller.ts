import type { Chat } from '@ai-sdk/vue'
import { watchThrottled } from '@vueuse/core'
import type { UIMessage } from 'ai'
import { ref, shallowRef, watch } from 'vue'

import { designModelProfile } from '@/app/ai/models'

import { chatDocumentId, resolveChatDocumentId, type ChatDocumentEditor } from './document'
import { createConversationStore } from './idb'
import { fallbackTitle, restoreMessages, snapshotMessages } from './messages'
import type { Conversation, ConversationMeta, ConversationStore } from './types'

type HistoryChat = Pick<Chat<UIMessage>, 'messages' | 'status' | 'stop'>

interface HistoryRuntime<TChat extends HistoryChat> {
  getEditor(): ChatDocumentEditor
  ensureChat(messages?: UIMessage[], sessionId?: string): Promise<TChat | null>
  resetChat(): Promise<void>
  backend(): ConversationMeta['backend']
}

/** Owns persisted conversation state independently of provider availability. */
export function createConversationHistory<TChat extends HistoryChat>(
  runtime: HistoryRuntime<TChat>,
  store: ConversationStore = createConversationStore()
) {
  const current = shallowRef<Conversation | null>(null)
  const messages = shallowRef<UIMessage[]>([])
  const conversations = ref<ConversationMeta[]>([])
  const storageError = ref(false)
  const interrupted = ref(false)
  const readOnly = ref(false)
  const busy = ref(false)
  let owner: ChatDocumentEditor | null = null
  let generation = 0
  let live: HistoryChat | null = null
  let stopWatch: (() => void) | undefined
  let writes: Promise<void> = Promise.resolve()
  let operation: Promise<unknown> = Promise.resolve()

  function serialize<T>(run: () => Promise<T>): Promise<T> {
    const next = operation.then(async () => {
      busy.value = true
      try {
        return await run()
      } finally {
        busy.value = false
      }
    })
    operation = next.catch(() => undefined)
    return next
  }

  async function refresh() {
    conversations.value = await store.list()
  }

  function persist() {
    const conversation = current.value
    if (!conversation || readOnly.value) return writes
    const content = live?.messages ?? messages.value
    if (content.length === 0 && conversation.titleSource === 'fallback') return writes
    const snapshot: Conversation = {
      ...conversation,
      title: conversation.titleSource === 'fallback' ? fallbackTitle(content) : conversation.title,
      updatedAt: new Date().toISOString(),
      interrupted:
        interrupted.value || live?.status === 'submitted' || live?.status === 'streaming',
      messages: snapshotMessages(content)
    }
    current.value = snapshot
    messages.value = content
    writes = writes
      .catch(() => undefined)
      .then(async () => {
        await store.write(snapshot)
        await store.select(snapshot.documentId, snapshot.id)
        return undefined
      })
      .then(async () => {
        storageError.value = false
        await refresh()
        return undefined
      })
      .catch((error) => {
        storageError.value = true
        throw error
      })
    return writes
  }

  async function detach() {
    interrupted.value ||= live?.status === 'submitted' || live?.status === 'streaming'
    await live?.stop()
    await persist()
    generation++
    stopWatch?.()
    stopWatch = undefined
    await runtime.resetChat()
    live = null
  }

  async function activate(conversation: Conversation) {
    owner = runtime.getEditor()
    interrupted.value = conversation.interrupted
    readOnly.value = conversation.documentId !== chatDocumentId(runtime.getEditor())
    current.value = conversation
    messages.value = restoreMessages(conversation.messages)
    if (conversation.messages.length || conversation.titleSource !== 'fallback') {
      await store.select(conversation.documentId, conversation.id)
    }
  }

  async function create() {
    const editor = runtime.getEditor()
    const now = new Date().toISOString()
    const conversation: Conversation = {
      id: crypto.randomUUID(),
      documentId: await resolveChatDocumentId(editor, store),
      documentName: editor.state.documentName,
      title: '',
      titleSource: 'fallback',
      createdAt: now,
      updatedAt: now,
      profileId: designModelProfile.value?.id ?? null,
      backend: runtime.backend(),
      interrupted: false,
      messages: []
    }
    await activate(conversation)
    await refresh()
  }

  async function loadDocument() {
    const editor = runtime.getEditor()
    const documentId = await resolveChatDocumentId(editor, store)
    if (
      owner === editor &&
      current.value &&
      !readOnly.value &&
      current.value.documentId !== documentId
    ) {
      await persist()
      await store.reassignDocument(current.value.documentId, documentId, editor.state.documentName)
      current.value = { ...current.value, documentId, documentName: editor.state.documentName }
      await refresh()
    }
    if (current.value?.documentId === documentId) {
      readOnly.value = false
      owner = editor
      return
    }
    await detach()
    const id = await store.getSelected(documentId)
    const conversation = id ? await store.read(id) : null
    if (conversation?.documentId === documentId) await activate(conversation)
    else await create()
    await refresh()
  }

  function ensureChat() {
    return serialize(async () => {
      if (readOnly.value && owner === runtime.getEditor()) return null
      await loadDocument()
      // Restoring the transcript is not equivalent to restoring an external agent session.
      if (
        current.value?.messages.length &&
        !live &&
        (runtime.backend() !== 'direct' || current.value.backend !== 'direct')
      )
        return null
      const editor = runtime.getEditor()
      const next = await runtime.ensureChat(messages.value, current.value?.id)
      if (runtime.getEditor() !== editor) {
        await next?.stop()
        await runtime.resetChat()
        return null
      }
      if (next && live !== next) {
        stopWatch?.()
        live = next
        const activeGeneration = ++generation
        const stopMessages = watchThrottled(
          () => next.messages,
          () => {
            if (live === next && generation === activeGeneration)
              void persist().catch(() => undefined)
          },
          { deep: true, throttle: 500, trailing: true }
        )
        const stopStatus = watch(
          () => next.status,
          () => {
            if (next.status === 'submitted') interrupted.value = false
            if (live === next && generation === activeGeneration)
              void persist().catch(() => undefined)
          }
        )
        stopWatch = () => {
          stopMessages()
          stopStatus()
        }
      }
      return next
    })
  }

  return {
    readOnly,
    current,
    messages,
    conversations,
    storageError,
    busy,
    ensureChat,
    initialize: () => serialize(loadDocument),
    flush: persist,
    newChat: () =>
      serialize(async () => {
        await detach()
        await create()
      }),
    open: (id: string) =>
      serialize(async () => {
        if (current.value?.id === id) return
        await detach()
        const conversation = await store.read(id)
        if (!conversation) return
        await activate(conversation)
      }),
    rename: (id: string, title: string) =>
      serialize(async () => {
        if (current.value?.id === id && current.value.messages.length === 0 && title.trim()) {
          current.value = { ...current.value, title: title.trim(), titleSource: 'manual' }
          await persist()
        }
        await store.rename(id, title)
        if (current.value?.id === id && title.trim())
          current.value = { ...current.value, title: title.trim(), titleSource: 'manual' }
        await refresh()
      }),
    remove: (id: string) =>
      serialize(async () => {
        if (current.value?.id === id) {
          await detach()
          current.value = null
          messages.value = []
        }
        await store.remove(id)
        if (!current.value) await create()
        await refresh()
      })
  }
}
