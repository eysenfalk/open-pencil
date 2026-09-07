import type { UIMessage } from 'ai'

import type { AttachmentPresentation } from '@/app/ai/attachment/presentation/types'

export interface ConversationMeta {
  id: string
  documentId: string
  documentName: string
  title: string
  titleSource: 'fallback' | 'manual' | 'generated'
  createdAt: string
  updatedAt: string
  profileId: string | null
  backend: 'direct' | 'acp' | 'harness'
  interrupted: boolean
}

export interface ConversationMessage {
  message: UIMessage
  displayText?: string
  attachments: AttachmentPresentation[]
}

export interface Conversation extends ConversationMeta {
  messages: ConversationMessage[]
}

export interface ConversationStore {
  list(documentId?: string): Promise<ConversationMeta[]>
  read(id: string): Promise<Conversation | null>
  write(conversation: Conversation): Promise<void>
  rename(id: string, title: string): Promise<void>
  remove(id: string): Promise<void>
  resolveFile(handle: FileSystemFileHandle): Promise<string>
  reassignDocument(from: string, to: string, name: string): Promise<void>
  getSelected(documentId: string): Promise<string | null>
  select(documentId: string, id: string): Promise<void>
}
