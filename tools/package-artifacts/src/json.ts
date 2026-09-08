import { readFile } from 'node:fs/promises'

export async function readJSON<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}
