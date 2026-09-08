<script setup lang="ts">
import { useI18n } from '@open-pencil/vue'
import { useCredentialRetry } from '@/app/settings/credentials/settings/use'
import AppButton from '@/components/ui/button/AppButton.vue'

const { credentials } = useI18n()
const { busy, outcome, retry } = useCredentialRetry()
</script>

<template>
  <div class="flex flex-col items-start gap-1">
    <AppButton size="xs" variant="ghost" :disabled="busy" @click="retry">{{
      credentials.retryAccess
    }}</AppButton>
    <p v-if="outcome !== 'idle'" role="status" class="text-[10px] text-muted">
      {{ outcome === 'ready' ? credentials.retryReady : credentials.retryFailed }}
    </p>
  </div>
</template>
