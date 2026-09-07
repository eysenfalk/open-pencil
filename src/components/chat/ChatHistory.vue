<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useFocus } from '@vueuse/core'
import { useI18n } from '@open-pencil/vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppButton from '@/components/ui/AppButton.vue'

const {
  conversations,
  selectedId,
  disabled = false
} = defineProps<{
  conversations: { id: string; title: string; documentName: string; available: boolean }[]
  selectedId?: string
  disabled?: boolean
}>()
const emit = defineEmits<{
  select: [id: string]
  create: []
  rename: [id: string, title: string]
  delete: [id: string]
}>()
const { ai } = useI18n()
const all = ref(false)
const editing = ref(false)
const title = ref('')
const titleInput = ref<HTMLInputElement>()
const { focused: titleFocused } = useFocus(titleInput)
const confirming = ref(false)
watch(
  () => selectedId,
  () => {
    editing.value = false
    confirming.value = false
  }
)
const selected = computed({ get: () => selectedId ?? '', set: (id: string) => emit('select', id) })
const options = computed(() =>
  conversations
    .filter((chat) => all.value || chat.available || chat.id === selectedId)
    .map((chat) => ({
      value: chat.id,
      label: `${chat.title || ai.value.newChat}${all.value ? ` — ${chat.documentName}` : ''}`
    }))
)
async function rename() {
  confirming.value = false
  title.value = conversations.find((chat) => chat.id === selectedId)?.title ?? ''
  editing.value = true
  await nextTick()
  titleFocused.value = true
  titleInput.value?.select()
}
function confirmDelete() {
  editing.value = false
  confirming.value = true
}
function remove() {
  if (selectedId) emit('delete', selectedId)
  confirming.value = false
}
function save() {
  if (selectedId && title.value.trim()) emit('rename', selectedId, title.value)
  editing.value = false
}
</script>

<template>
  <div class="space-y-2 border-b border-border p-2">
    <div class="flex min-w-0 items-center gap-2">
      <AppSelect
        :key="options.map((option) => option.label).join('\u0000')"
        v-model="selected"
        :label="ai.chatHistory"
        :options="options"
        :disabled="disabled"
        class="min-w-0 flex-1"
      />
      <AppButton size="xs" :disabled="disabled" @click="emit('create')">{{ ai.newChat }}</AppButton>
    </div>
    <div class="flex items-center gap-2 text-[10px] text-muted">
      <label class="flex items-center gap-1"
        ><input v-model="all" type="checkbox" />{{ ai.allChats }}</label
      >
      <AppButton size="xs" :disabled="disabled || !selectedId" @click="rename">{{
        ai.renameChat
      }}</AppButton>
      <AppButton size="xs" :disabled="disabled || !selectedId" @click="confirmDelete">{{
        ai.deleteChat
      }}</AppButton>
    </div>
    <p v-if="all" class="text-[10px] text-muted">{{ ai.chatDocumentHint }}</p>
    <form
      v-if="editing"
      class="flex flex-wrap gap-1"
      @submit.prevent="save"
      @keydown.esc.stop="editing = false"
    >
      <input
        ref="titleInput"
        v-model="title"
        :aria-label="ai.chatTitle"
        class="min-w-0 basis-full rounded border border-border bg-input px-2 py-1 text-xs"
      />
      <AppButton size="xs" type="submit" :disabled="disabled || !title.trim()">{{
        ai.saveChatTitle
      }}</AppButton>
      <AppButton size="xs" @click="editing = false">{{ ai.cancelChatAction }}</AppButton>
    </form>
    <div v-if="confirming" class="space-y-1 text-xs" @keydown.esc.stop="confirming = false">
      <p>{{ ai.deleteChatConfirmation }}</p>
      <AppButton size="xs" color="error" :disabled="disabled" @click="remove">{{
        ai.deleteChat
      }}</AppButton>
      <AppButton size="xs" @click="confirming = false">{{ ai.cancelChatAction }}</AppButton>
    </div>
  </div>
</template>
