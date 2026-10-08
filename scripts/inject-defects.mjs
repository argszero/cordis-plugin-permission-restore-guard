/**
 * Defect injection: mutate the source, rebuild, run the suite, and require that
 * the mutation is caught. An arm whose mutation leaves the suite green is
 * SILENT — it proves nothing about the suite, and it is reported as a failure of
 * the harness rather than hidden.
 *
 * The suite imports `lib/*.js`, not `src/*.ts`, so every arm **emits** first; a
 * mutation that is never written to `lib/` is a mutation the suite cannot see. A
 * mutation that does not compile is reported separately as TYPEFAIL, because it
 * never reached the suite either.
 *
 * Every arm below is a defect this plugin could plausibly have shipped: one
 * distinction it exists to make, removed one line at a time. The arms are not
 * "does the test file import the module" — each one deletes a rule the plugin
 * states in prose to its users, so a SILENT arm is a claim the package makes
 * that nothing checks.
 *
 * ```sh
 * node scripts/inject-defects.mjs                     # every arm
 * node scripts/inject-defects.mjs --filter=relabel    # arms whose name matches
 * ```
 *
 * @module scripts/inject-defects
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Each arm names the one distinction it removes, and the file it lives in. */
const MUTATIONS = [
  {
    // The trap the package documents: `resolve('auto')` reports
    // danger-full-access/ask, which is frequently exactly what the stranded
    // session's knobs are, so an eligible Auto name re-seals the session.
    name: 'relabel: the Auto name is eligible as a relabel target',
    file: 'src/relabel.ts',
    edits: [['if (name === AUTO_PRESET || name === CUSTOM_PRESET) continue', 'if (name === CUSTOM_PRESET) continue']],
  },
  {
    // EQUIVALENT MUTANT, recorded rather than hidden. `custom` is the name this
    // package records when nothing matches, so skipping it can only change which
    // branch is *reported* (`matched-knobs` instead of `no-match`) — the payload
    // is `custom` either way, and the branch is prose in a report. Kept in the
    // list because "we tried to make this arm bite and could not, and here is
    // why" is a fact about the code.
    name: 'relabel: the derived custom name is eligible as a relabel target',
    file: 'src/relabel.ts',
    equivalent: 'skipping `custom` changes only the reported branch: the recorded name is `custom` either way, and a preset key may not be `custom` (the service refuses it)',
    edits: [['if (name === AUTO_PRESET || name === CUSTOM_PRESET) continue', 'if (name === AUTO_PRESET) continue']],
  },
  {
    name: 'relabel: the operator identity wins even where the service cannot resolve it',
    file: 'src/relabel.ts',
    edits: [["      resolvable = typeof spec?.sandbox === 'string' && typeof spec?.approval === 'string'",
      '      resolvable = true']],
  },
  {
    name: 'relabel: an operator identity that resolves to nothing is accepted',
    file: 'src/relabel.ts',
    edits: [['    } catch {\n      resolvable = false\n    }', '    } catch {\n      resolvable = true\n    }']],
  },
  {
    name: 'relabel: the operator identity is never consulted',
    file: 'src/relabel.ts',
    edits: [["  if (override !== undefined && override !== '' && names.includes(override)) {",
      "  if (override !== undefined && override === '' && names.includes(override)) {"]],
  },
  {
    name: 'relabel: the approval default the service applies is not applied',
    file: 'src/relabel.ts',
    edits: [["approval: state.approval ?? fallbacks?.approvalPolicy ?? 'ask'", "approval: state.approval ?? fallbacks?.approvalPolicy ?? ''"]],
  },
  {
    name: 'relabel: a recorded sandbox is overruled by the composition fallback',
    file: 'src/relabel.ts',
    edits: [['sandbox: state.sandbox ?? fallbacks?.sandboxMode', 'sandbox: fallbacks?.sandboxMode ?? state.sandbox ?? undefined']],
  },
  {
    name: 'relabel: a preset that matches on sandbox alone is accepted',
    file: 'src/relabel.ts',
    edits: [['    if (spec.sandbox === sandbox && spec.approval === approval) {', '    if (spec.sandbox === sandbox) {']],
  },
  {
    name: 'relabel: a resolver that throws is not tolerated',
    file: 'src/relabel.ts',
    edits: [['    } catch {\n      continue\n    }', '    } catch {\n      throw new Error(String(name))\n    }']],
  },
  {
    name: 'isStranded: every session with a recorded identity is stranded',
    file: 'src/relabel.ts',
    edits: [["  return state?.preset === AUTO_PRESET && !names.includes(AUTO_PRESET)", '  return state?.preset !== null && state?.preset !== undefined']],
  },
  {
    name: 'isStranded: a live Auto integration is ignored',
    file: 'src/relabel.ts',
    edits: [["  return state?.preset === AUTO_PRESET && !names.includes(AUTO_PRESET)", "  return state?.preset === AUTO_PRESET"]],
  },
  {
    name: 'install: the listener is never prepended, so the service throws first',
    file: 'src/index.ts',
    edits: [['options.prepend === false ? undefined : { prepend: true }', 'options.prepend === false ? { prepend: true } : undefined']],
  },
  {
    name: 'install: a failure of the guard\'s own reading is not contained',
    file: 'src/index.ts',
    edits: [['    } catch (error: unknown) {\n      ctx.logger.warn(',
      '    } catch (error: unknown) {\n      if (error) throw error\n      ctx.logger.warn(']],
  },
  {
    name: 'install: an exempt session is repaired anyway',
    file: 'src/index.ts',
    edits: [["      if (isExempt(String(session.id), settings.exempt)) return\n", '']],
  },
  {
    name: 'install: report mode writes the repair anyway',
    file: 'src/index.ts',
    edits: [["      if (settings.mode === 'report') {\n        note(ctx, records, {\n          sessionId: String(session.id), at: Date.now(), preset: relabel.preset,",
      "      if (false) {\n        note(ctx, records, {\n          sessionId: String(session.id), at: Date.now(), preset: relabel.preset,"]],
  },
  {
    name: 'install: a session that is not stranded is relabelled',
    file: 'src/index.ts',
    edits: [['      if (!isStranded(state, names)) return\n', '']],
  },
  {
    name: 'install: the repair is never written',
    file: 'src/index.ts',
    edits: [["      session.append('permission/preset', { preset: relabel.preset })\n      note(ctx, records, {",
      "      note(ctx, records, {"]],
  },
  {
    name: 'install: an applied repair is not ledgered',
    file: 'src/index.ts',
    edits: [['      note(ctx, records, {\n        sessionId: String(session.id), at: Date.now(), preset: relabel.preset,\n        reason: relabel.reason, applied: true,\n      })\n    } catch', '    } catch']],
  },
  {
    name: 'isExempt: a bare pattern is treated as a prefix',
    file: 'src/index.ts',
    edits: [["pattern.endsWith('*') ? id.startsWith(pattern.slice(0, -1)) : id === pattern", "id.startsWith(pattern.endsWith('*') ? pattern.slice(0, -1) : pattern)"]],
  },
  {
    name: 'normalizeConfig: an unknown mode is accepted as written',
    file: 'src/index.ts',
    edits: [["  const mode: RestoreMode = raw.mode === 'report' || raw.mode === 'repair' ? raw.mode : DEFAULT_MODE",
      "  const mode: RestoreMode = raw.mode ?? DEFAULT_MODE"]],
  },
  {
    name: 'normalizeConfig: a `preset` that is not a usable string is kept',
    file: 'src/index.ts',
    edits: [["  const preset = typeof raw.preset === 'string' && raw.preset !== '' ? raw.preset : undefined",
      '  const preset = raw.preset as string | undefined']],
  },
  {
    name: 'normalizeConfig: the unusable entries of `exempt` are kept',
    file: 'src/index.ts',
    edits: [["  const exempt = Array.isArray(raw.exempt) ? raw.exempt.filter(entry => typeof entry === 'string' && entry !== '') : []",
      '  const exempt = Array.isArray(raw.exempt) ? raw.exempt : []']],
  },
  {
    name: 'tool: a repair is performed without `confirm`',
    file: 'src/index.ts',
    edits: [["        if (action === 'repair' && args.confirm !== true) {", '        if (false) {']],
  },
  {
    name: 'tool: the caller\'s `session` limit is ignored',
    file: 'src/index.ts',
    edits: [['    if (only !== undefined && only !== id) continue\n', '']],
  },
  {
    name: 'tool: the mount\'s mode is not consulted when the call asks to write',
    file: 'src/index.ts',
    edits: [["        const writing = repair && settings.mode === 'repair'", '        const writing = repair']],
  },
  {
    name: 'tool: a sweep\'s repairs are not ledgered',
    file: 'src/index.ts',
    edits: [['        applied = true\n        note(ctx, records, {\n          sessionId: id, at: Date.now(), preset: relabel.preset, reason: relabel.reason, applied: true,\n        })\n', '        applied = true\n']],
  },
  {
    name: 'report: a sighting that was not written is reported as applied',
    file: 'src/report.ts',
    edits: [["      : sighting.applied ? 'applied' : 'not written'", "      : 'applied'"]],
  },
  {
    name: 'report: a sweep that found nothing is not distinguished',
    file: 'src/report.ts',
    edits: [['  if (sightings.length === 0) {', '  if (false) {']],
  },
  {
    name: 'report: the refusal a report-mode mount made is not disclosed',
    file: 'src/report.ts',
    edits: [["  if (options.requested === true && options.mount === 'report') {", '  if (false) {']],
  },
  {
    name: 'report: what the repair does and does not write is not stated',
    file: 'src/report.ts',
    edits: [["  lines.push(\n    'Nothing but a `permission/preset` identity is written: the session keeps its sandbox mode and approval'\n    + ' policy, and its log keeps every event it had, including the Auto selection that could not be restored.',\n  )\n", '']],
  },
  {
    name: 'report: the ledger is dropped from every answer',
    file: 'src/report.ts',
    edits: [['  return withLedger(lines.join(\'\\n\'), options.records)\n  }\n  const verb',
      "  return lines.join('\\n')\n  }\n  const verb"]],
  },
  {
    name: 'report: an empty ledger is rendered as if it had entries',
    file: 'src/report.ts',
    edits: [["  if (records.length === 0) return `${head}No session has needed this guard in this process yet.`", '  if (false) return head']],
  },
]

const argv = process.argv.slice(2)
const filter = argv.find(argument => argument.startsWith('--filter='))?.slice('--filter='.length)

/**
 * Run one command, capturing whether it succeeded.
 *
 * The timeout is not decoration: an arm that removes a guard from a listener
 * that runs inside a publication boundary can turn a caught failure into an
 * unhandled one, and a mutant that never terminates is a mutant the suite
 * cannot report on. It is killed here and counted as caught, which is what it
 * is — the suite never reaches its assertions because the code under test never
 * returns.
 */
function run(command, args) {
  try {
    execFileSync(command, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000 })
    return { ok: true, output: '' }
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

const results = []
for (const mutation of MUTATIONS) {
  if (filter !== undefined && !mutation.name.includes(filter)) continue
  const path = resolve(ROOT, mutation.file)
  const original = readFileSync(path, 'utf8')
  let mutated = original
  let applied = true
  for (const [from, to] of mutation.edits) {
    if (!mutated.includes(from)) {
      applied = false
      break
    }
    mutated = mutated.replace(from, to)
  }
  if (!applied) {
    results.push({ name: mutation.name, outcome: 'NO-OP', detail: 'the source no longer contains the text this arm mutates' })
    continue
  }
  try {
    writeFileSync(path, mutated)
    const built = run('npx', ['tsc'])
    if (!built.ok) {
      results.push({ name: mutation.name, outcome: 'TYPEFAIL', detail: 'the mutation does not compile, so the suite never ran' })
      continue
    }
    const tested = run('node', ['--test', 'test/*.spec.mjs'])
    results.push(tested.ok
      ? { name: mutation.name, outcome: 'SILENT', detail: 'the suite stayed green — this arm proves nothing' }
      : { name: mutation.name, outcome: 'CAUGHT', detail: '' })
  } finally {
    writeFileSync(path, original)
  }
}

// Put `lib/` back. The last arm left its mutation COMPILED there — the source is
// restored in the `finally` above, but the build output is not, and a checkout
// that runs this script and then publishes would ship the last mutant. Rebuilt
// once here so the tree is consistent whether a human runs this or CI does.
const restored = run('npx', ['tsc'])
if (!restored.ok) {
  process.stdout.write('\nWARNING: the rebuild after restoring the sources failed — lib/ may hold a mutant\n')
}

const caught = results.filter(result => result.outcome === 'CAUGHT').length
const declared = new Set(MUTATIONS.filter(mutation => mutation.equivalent !== undefined).map(mutation => mutation.name))
const equivalents = results.filter(result => result.outcome === 'SILENT' && declared.has(result.name))
const silent = results.filter(result => result.outcome === 'SILENT' && !declared.has(result.name))
const other = results.filter(result => result.outcome !== 'CAUGHT' && result.outcome !== 'SILENT')

for (const result of results) {
  const label = result.outcome === 'SILENT' && declared.has(result.name) ? 'EQUIVALENT' : result.outcome
  process.stdout.write(`${label.padEnd(10)} ${result.name}${result.detail === '' ? '' : `\n           ${result.detail}`}\n`)
}
process.stdout.write(`\n${caught}/${results.length} caught`)
process.stdout.write(silent.length === 0
  ? ` — no arm is silent (${equivalents.length} declared equivalent — see the arms)\n`
  : `, ${silent.length} SILENT\n`)
if (other.length > 0) {
  process.stdout.write(`${other.length} arm(s) could not be evaluated: ${other.map(result => `${result.outcome} ${result.name}`).join(', ')}\n`)
}
process.exitCode = silent.length === 0 && other.length === 0 ? 0 : 1
