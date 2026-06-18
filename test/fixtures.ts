import { readFileSync } from 'node:fs'

/** Read a fixture file from test/fixtures as UTF-8 text. */
export function loadFixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
}
