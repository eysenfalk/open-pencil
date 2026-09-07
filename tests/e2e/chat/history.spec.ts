import { test, expect } from '#tests/helpers/chat/fixture'

test('multiple conversations preserve messages and manual titles', async ({
  configuredChat: chat,
  page
}) => {
  await chat.submit('Create the first dashboard')
  await expect(chat.assistantMessage()).toBeVisible()
  await page.getByRole('button', { name: 'New chat', exact: true }).first().click()
  await expect(chat.input).toBeVisible()
  await expect(page.getByTestId('chat-message-user')).toHaveCount(0)
  await chat.submit('Create the second dashboard')
  await expect(chat.assistantMessage()).toBeVisible()
  await page.getByRole('combobox', { name: 'Conversation history' }).click()
  await page.getByRole('option', { name: 'Create the first dashboard', exact: true }).click()
  await expect(chat.userMessage()).toContainText('Create the first dashboard')
  await page.getByRole('button', { name: 'Rename', exact: true }).click()
  await page.getByRole('textbox', { name: 'Conversation title' }).fill('First design')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Conversation history' })).toContainText(
    'First design'
  )
})

test('saved transcripts remain readable after reload without provider setup', async ({
  configuredChat: chat,
  page
}) => {
  await chat.submit('A durable conversation')
  await expect(chat.assistantMessage()).toBeVisible()
  await page.getByRole('button', { name: 'New chat', exact: true }).first().click()
  await page.reload()
  await chat.chatTab.click()
  await page.getByRole('checkbox', { name: 'All chats' }).check()
  await page.getByRole('combobox', { name: 'Conversation history' }).click()
  await page.getByRole('option', { name: /A durable conversation/ }).click()
  await expect(chat.userMessage()).toContainText('A durable conversation')
  await expect(chat.assistantMessage()).toBeVisible()
})
