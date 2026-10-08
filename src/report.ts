/**
 * Rendering for the two surfaces that report this guard: the tool's answer,
 * and the lines the plugin returns for a caller that wants the same text.
 *
 * Kept apart from the decision so a report can be asserted on its own: the
 * value of a diagnostic is what it does when there is nothing to fix.
 *
 * @module @argszero/cordis-plugin-permission-restore-guard/report
 */

import type { RelabelReason } from './relabel.ts'
import type { RestoreMode } from './mode.ts'
import { AUTO_PRESET } from './relabel.ts'

/** One session the guard examined and found stranded. */
export interface SessionSighting {
  /** The session id. */
  sessionId: string
  /** The recorded preset that could not be restored. */
  before: string
  /** The identity the guard records (or would record). */
  preset: string
  /** Which branch chose it. */
  reason: RelabelReason
  /** Whether the event was actually appended. */
  applied: boolean
  /** Why the append failed, when it did. */
  failure?: string | undefined
}

/** One repair the guard performed, kept so a session's history is visible after the fact. */
export interface RepairRecord {
  /** The session id. */
  sessionId: string
  /** When the guard acted. */
  at: number
  /** The identity it recorded (or would have, in report mode). */
  preset: string
  /** Which branch chose it. */
  reason: RelabelReason
  /** False in report mode, and when the append failed. */
  applied: boolean
}

const REASON_TEXT: Record<RelabelReason, string> = {
  'matched-knobs': 'a configured preset describes the same knobs, so nothing about the session changes but its name',
  'operator': 'the configured `preset` names it',
  'no-match': 'no configured preset matches these knobs, so the identity records exactly what the picker will report',
}

/**
 * The tool's answer for one sweep.
 * @param sightings - the stranded sessions found, in the store's order.
 * @param options - whether the caller asked for a repair, the guard's ledger,
 *   the mode the plugin is mounted with, and whether the call asked to write.
 * @returns the text the model reads.
 */
export function renderToolReport(
  sightings: SessionSighting[],
  options: { repair: boolean, records: readonly RepairRecord[], mount?: RestoreMode, requested?: boolean },
): string {
  const lines: string[] = []
  if (sightings.length === 0) {
    lines.push(
      `No stranded sessions among the live sessions of this process.`
      + ` A session whose stored preset is "${AUTO_PRESET}" while no Auto integration is registered would`
      + ` appear here; a session that is not currently live cannot be examined until something opens it,`
      + ` at which point the mounted guard handles it.`,
    )
    return withLedger(lines.join('\n'), options.records)
  }
  const verb = options.repair ? 'recorded' : 'would record'
  lines.push(`${sightings.length} stranded session${sightings.length === 1 ? '' : 's'} (stored preset "${AUTO_PRESET}", no live Auto integration):`)
  for (const sighting of sightings) {
    const state = sighting.failure !== undefined
      ? `FAILED: ${sighting.failure}`
      : sighting.applied ? 'applied' : 'not written'
    lines.push(
      `- ${sighting.sessionId}: ${verb} "${sighting.preset}" (${REASON_TEXT[sighting.reason]}) — ${state}`,
    )
  }
  lines.push(
    'Nothing but a `permission/preset` identity is written: the session keeps its sandbox mode and approval'
    + ' policy, and its log keeps every event it had, including the Auto selection that could not be restored.',
  )
  if (options.requested === true && options.mount === 'report') {
    lines.push(
      'This plugin is mounted with `mode: "report"`, so nothing was written even though the call asked for a'
      + ' repair. The mount is what decides whether this process may write a session log; mount it with the'
      + ' default `mode: "repair"` first.',
    )
  }
  return withLedger(lines.join('\n'), options.records)
}

/**
 * The lines a caller gets from the plugin itself, without a tool call.
 * @param records - the guard's ledger, newest first.
 * @param live - the live sessions' sighting this round, when a sweep ran.
 * @returns the report text.
 */
export function renderRepairReport(records: readonly RepairRecord[], live?: readonly SessionSighting[]): string {
  const lines: string[] = []
  if (live !== undefined) lines.push(renderToolReport([...live], { repair: true, records: [] }))
  return withLedger(lines.join('\n'), records)
}

/** Append the ledger section, or say plainly that nothing has been repaired yet. */
function withLedger(body: string, records: readonly RepairRecord[]): string {
  const head = body === '' ? '' : `${body}\n`
  if (records.length === 0) return `${head}No session has needed this guard in this process yet.`
  const lines = [`${head}Repairs in this process (newest first):`]
  for (const entry of records) {
    const when = new Date(entry.at).toISOString()
    lines.push(`- ${when} ${entry.sessionId}: ${entry.applied ? 'recorded' : 'would record'} "${entry.preset}" (${entry.reason})`)
  }
  return lines.join('\n')
}
