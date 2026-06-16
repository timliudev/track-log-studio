/**
 * Column naming helpers. aRacer headers use the form `Canonical/中文說明`
 * (e.g. `RPM/引擎轉速`); the canonical name is the part before the first '/'.
 */

/** Extract the canonical name from a raw header field. */
export function canonicalName(rawName: string): string {
  const slash = rawName.indexOf('/')
  return (slash === -1 ? rawName : rawName.slice(0, slash)).trim()
}

/** Extract the description (after the first '/'), or undefined if none. */
export function descriptionOf(rawName: string): string | undefined {
  const slash = rawName.indexOf('/')
  if (slash === -1) return undefined
  const desc = rawName.slice(slash + 1).trim()
  return desc.length > 0 ? desc : undefined
}

/**
 * Canonical-name aliases: some firmware revisions name the same signal
 * differently. Looking up the key resolves to the first present alias.
 * Mirrors the ALIASES table in loga2nmea.py.
 */
export const ALIASES: Readonly<Record<string, readonly string[]>> = {
  AFR: ['AFR', 'AFR_WBO2'],
  Volt_Batt: ['Volt_Batt', 'Volt_Batt_indx'],
}

/** Candidate canonical names to try when resolving `name`, in priority order. */
export function aliasCandidates(name: string): readonly string[] {
  return ALIASES[name] ?? [name]
}
