import { strict as assert } from 'node:assert'

declare global {
  interface Window {
    __TAURI__: { core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> } }
  }
}

describe('native test credential isolation', () => {
  it('uses disposable memory credentials and exposes explicit retry without Keychain access', async () => {
    await browser.waitUntil(
      async () => browser.execute(() => Boolean(window.openPencil?.getStore?.())),
      { timeout: 30_000 }
    )
    const previousLaunch = await browser.execute(() => {
      // Probe the WebView storage itself: an app storage adapter would not prove profile isolation.
      // oxlint-disable-next-line open-pencil/no-direct-storage-access
      const previous = localStorage.getItem('native-test-launch-marker')
      // oxlint-disable-next-line open-pencil/no-direct-storage-access
      localStorage.setItem('native-test-launch-marker', 'present')
      return previous
    })
    assert.equal(previousLaunch, null)
    assert.equal(await $('[role="alertdialog"]').isExisting(), false)
    const result = await browser.execute(async () => {
      const invoke = window.__TAURI__.core.invoke
      const reference = { integrationId: 'native-test', profileId: 'isolation', field: 'api-key' }
      await invoke('credential_retry_access')
      const before = await invoke('credential_status', { reference })
      await invoke('credential_write', { reference, value: 'disposable-test-value' })
      const after = await invoke('credential_status', { reference })
      await invoke('credential_remove', { reference })
      const removed = await invoke('credential_status', { reference })
      return { before, after, removed }
    })
    assert.deepEqual(result, { before: 'missing', after: 'configured', removed: 'missing' })
  })

  it('hides credential controls when native access is healthy', async () => {
    await browser.keys([process.platform === 'darwin' ? 'Meta' : 'Control', ','])
    const section = await $('[data-test-id="settings-general-panel"]')
    await section.waitForDisplayed()
    assert.doesNotMatch(
      await section.getText(),
      /system credential store|Saved passwords and API keys/
    )
    assert.equal(await $('button=Retry access').isExisting(), false)
  })

  it('shows a paused section after denial and hides it after retry', async function () {
    this.timeout(180_000)
    const denied = await browser.execute(async () => {
      const reference = { integrationId: 'native-test', profileId: 'denial', field: 'api-key' }
      try {
        await window.__TAURI__.core.invoke('credential_write', {
          reference,
          value: 'open-pencil-native-test-denied'
        })
        return false
      } catch {
        return true
      }
    })
    assert.equal(denied, true)
    assert.equal(await $('[data-test-id="settings-general-panel"]').isDisplayed(), true)
    const retry = await $('button=Retry access')
    await retry.waitForExist()
    await retry.scrollIntoView()
    await browser.execute(() => {
      const panel = document.querySelector('[data-test-id="settings-general-panel"]')
      if (panel?.parentElement) panel.parentElement.scrollTop = panel.parentElement.scrollHeight
    })
    await retry.click()
    await browser.waitUntil(async () => !(await $('button=Retry access').isExisting()))
    assert.equal(
      await browser.execute(() =>
        window.__TAURI__.core.invoke<boolean>('credential_access_paused')
      ),
      false
    )
    await browser.execute(async () => {
      const reference = { integrationId: 'native-test', profileId: 'retry', field: 'api-key' }
      await window.__TAURI__.core.invoke('credential_write', { reference, value: 'disposable' })
      await window.__TAURI__.core.invoke('credential_remove', { reference })
    })
  })
})
