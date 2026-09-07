import type { Meta, StoryObj } from '@storybook/vue3-vite'
import type { ChatStatus, UIMessage } from 'ai'
import { TooltipProvider } from 'reka-ui'
import { expect, userEvent, within } from 'storybook/test'
import { computed, onMounted, ref } from 'vue'

import type { AttachmentPresentation } from '@/app/ai/attachment/presentation/types'
import AppButton from '@/components/ui/AppButton.vue'
import AppSelect from '@/components/ui/AppSelect.vue'

import ChatComposer from './ChatComposer.vue'
import ChatHistory from './ChatHistory.vue'
import ChatTranscript from './ChatTranscript.vue'

interface Conversation {
  id: string
  title: string
  status: ChatStatus
  messages: UIMessage[]
}

function conversations(): Conversation[] {
  return [
    {
      id: 'dashboard',
      title: 'Monthly expense dashboard',
      status: 'ready',
      messages: [
        {
          id: 'request',
          role: 'user',
          parts: [
            { type: 'text', text: 'Build an expense dashboard with summary cards and a chart.' }
          ]
        },
        {
          id: 'response',
          role: 'assistant',
          parts: [
            {
              type: 'reasoning',
              text: 'I’ll inspect the frame, then arrange the summary cards and spending chart.',
              state: 'done'
            },
            {
              type: 'tool-create_frame',
              toolCallId: 'create-dashboard',
              state: 'output-available',
              input: { name: 'Expenses' },
              output: { id: 'frame-42', name: 'Expenses' }
            },
            {
              type: 'text',
              text: 'Created the **expense dashboard**.\n\n- Three summary cards\n- Monthly spending chart\n- Recent transactions\n\nWould you like a dark variant?'
            }
          ]
        }
      ]
    },
    {
      id: 'streaming',
      title: 'Explore a warmer color palette',
      status: 'streaming',
      messages: [
        {
          id: 'palette-request',
          role: 'user',
          parts: [{ type: 'text', text: 'Try a warmer palette, keeping the text accessible.' }]
        },
        {
          id: 'palette-response',
          role: 'assistant',
          parts: [
            {
              type: 'reasoning',
              text: 'Comparing contrast ratios against the cream background…',
              state: 'streaming'
            },
            {
              type: 'tool-set_fills',
              toolCallId: 'palette',
              state: 'input-available',
              input: { color: '#fef3c7' }
            }
          ]
        }
      ]
    },
    {
      id: 'error',
      title: 'Update a layer that no longer exists',
      status: 'error',
      messages: [
        {
          id: 'error-request',
          role: 'user',
          parts: [{ type: 'text', text: 'Rename the selected layer.' }]
        },
        {
          id: 'error-response',
          role: 'assistant',
          parts: [
            {
              type: 'tool-rename_node',
              toolCallId: 'rename',
              state: 'output-error',
              input: { id: 'deleted-layer' },
              errorText: 'The selected layer no longer exists.'
            },
            {
              type: 'text',
              text: 'I couldn’t find that layer. Select another layer and try again.'
            }
          ]
        }
      ]
    },
    { id: 'empty', title: 'New chat', status: 'ready', messages: [] },
    {
      id: 'long-title',
      title:
        'Review the complete onboarding flow across desktop and mobile, including accessibility and empty states',
      status: 'ready',
      messages: []
    }
  ]
}

interface Args {
  initialChat: string
  narrow: boolean
}
const meta = {
  title: 'Chat/Playground',
  args: { initialChat: 'dashboard', narrow: false },
  parameters: {
    docs: {
      description: {
        component:
          'The real transcript and composer, composed with isolated story fixtures. Controls above the panel are test controls, not the proposed history UI. No credentials, model calls, document edits, or persistence.'
      }
    }
  },
  render: (args) => ({
    components: {
      ChatHistory,
      ChatComposer,
      ChatTranscript,
      TooltipProvider,
      AppSelect,
      AppButton
    },
    setup() {
      const chats = ref(conversations())
      const selectedId = ref(args.initialChat)
      const selected = computed(() => chats.value.find((chat) => chat.id === selectedId.value))
      const options = computed(() =>
        chats.value.map((chat) => ({ value: chat.id, label: chat.title }))
      )
      const profile = ref('balanced')
      const presentations = ref<Record<string, { attachments: AttachmentPresentation[] }>>({})
      onMounted(() => {
        const canvas = document.createElement('canvas')
        canvas.width = 160
        canvas.height = 100
        const context = canvas.getContext('2d')
        if (!context) return
        context.fillStyle = '#fef3c7'
        context.fillRect(0, 0, 160, 100)
        context.fillStyle = '#9747ff'
        context.fillRect(12, 12, 40, 24)
        context.fillRect(60, 12, 40, 24)
        context.fillRect(108, 12, 40, 24)
        canvas.toBlob((preview) => {
          if (!preview) return
          presentations.value = {
            request: {
              attachments: [
                {
                  id: 'reference',
                  messageId: 'request',
                  kind: 'image',
                  name: 'reference.png',
                  mediaType: 'image/png',
                  originalSize: { x: 160, y: 100 },
                  preview
                },
                {
                  id: 'frame',
                  messageId: 'request',
                  kind: 'node',
                  name: 'Dashboard frame',
                  nodeId: 'preview-frame',
                  nodeType: 'FRAME',
                  originalSize: { x: 160, y: 100 },
                  preview
                }
              ]
            }
          }
        }, 'image/png')
      })
      const notice = ref('')
      function newChat() {
        const id = crypto.randomUUID()
        chats.value.push({ id, title: 'New chat', status: 'ready', messages: [] })
        selectedId.value = id
      }
      function removeChat() {
        chats.value = chats.value.filter((chat) => chat.id !== selectedId.value)
        const first = chats.value.at(0)
        if (first) selectedId.value = first.id
        else newChat()
      }
      function renameChat(id: string, title: string) {
        const chat = chats.value.find((chat) => chat.id === id)
        if (chat) chat.title = title
      }
      function submit(text: string) {
        const chat = selected.value
        if (!chat) return
        if (!chat.messages.length && chat.title === 'New chat') chat.title = text
        chat.messages.push({
          id: crypto.randomUUID(),
          role: 'user',
          parts: [{ type: 'text', text }]
        })
        chat.messages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: 'This is a **local preview response**. No model was called and no document was changed.'
            }
          ]
        })
        chat.status = 'ready'
      }
      function stop() {
        const chat = selected.value
        if (!chat) return
        chat.status = 'ready'
        for (const message of chat.messages) {
          message.parts = message.parts.map((part) => {
            if (part.type === 'reasoning') return { ...part, state: 'done' }
            if ('toolCallId' in part && part.state === 'input-available')
              return { ...part, state: 'output-error', errorText: 'Stopped in the story.' }
            return part
          })
        }
      }
      return {
        chats,
        renameChat,
        args,
        selectedId,
        selected,
        options,
        presentations,
        profile,
        notice,
        newChat,
        removeChat,
        submit,
        stop
      }
    },
    template: `
      <TooltipProvider>
        <div class="max-w-full space-y-3">
          <fieldset class="max-w-[420px] space-y-2 rounded border border-border p-3 text-xs">
            <legend class="px-1 text-muted">Story controls — not saved</legend>
            <AppSelect v-model="selectedId" label="Test conversation" :options="options" />
            <div class="flex gap-2">
              <AppButton size="xs" @click="newChat">New fixture</AppButton>
              <AppButton size="xs" @click="removeChat">Delete fixture</AppButton>
            </div>
            <label v-if="selected" class="flex items-center gap-2">Title
              <input v-model="selected.title" class="min-w-0 flex-1 rounded border border-border bg-input p-1" />
            </label>
          </fieldset>
          <section aria-label="Chat preview" :data-narrow="args.narrow" class="flex h-[620px] w-[420px] max-w-full flex-col overflow-hidden rounded-xl border border-border bg-panel data-[narrow=true]:w-[300px]">
            <ChatHistory :conversations="chats.map(chat => ({ ...chat, documentName: 'Demo document', available: true }))" :selected-id="selectedId" @select="selectedId = $event" @create="newChat" @rename="renameChat" @delete="removeChat" />
            <ChatTranscript v-if="selected" :key="selected.id" :messages="selected.messages" :presentations="presentations" :status="selected.status" />
            <p v-if="notice" role="status" class="px-3 py-2 text-xs text-muted">{{ notice }}</p>
            <ChatComposer :key="selectedId" :status="selected?.status ?? 'ready'" @submit="submit" @stop="stop" @settings="notice = 'These are mock profiles. Provider settings are unchanged.'">
              <template #model>
                <AppSelect v-model="profile" label="Mock model profile" :options="[{ value: 'balanced', label: 'Balanced (mock)' }, { value: 'fast', label: 'Fast (mock)' }]" />
              </template>
            </ChatComposer>
          </section>
        </div>
      </TooltipProvider>`
  })
} satisfies Meta<Args>
export default meta
type Story = StoryObj<typeof meta>
export const Conversations: Story = {}
export const Interaction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'New fixture' }))
    await userEvent.type(
      canvas.getByRole('textbox', { name: 'Describe a change' }),
      'Make a dashboard'
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Send message' }))
    await expect(canvas.getByText(/local preview response/)).toBeVisible()
    const title = canvas.getByRole('textbox', { name: 'Title' })
    await expect(title).toHaveValue('Make a dashboard')
    await userEvent.clear(title)
    await userEvent.type(title, 'My dashboard')
    await userEvent.click(canvas.getByRole('button', { name: 'Delete fixture' }))
    await expect(title).toHaveValue('Monthly expense dashboard')
    await expect(canvas.getByRole('button', { name: 'Create Frame Done' })).toBeVisible()
  }
}
export const Empty: Story = { args: { initialChat: 'empty' } }
export const Streaming: Story = { args: { initialChat: 'streaming' } }
export const ToolError: Story = { args: { initialChat: 'error' } }
export const Narrow: Story = { args: { narrow: true } }
export const LongTitle: Story = { args: { initialChat: 'long-title', narrow: true } }
