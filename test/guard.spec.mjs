/**
 * What the mounted guard does, measured against the shipped services.
 *
 * The arms are grouped by the claim each one would falsify:
 *
 * - **the repair** — a stranded session is published, its knobs are untouched,
 *   and the log it leaves behind opens in a later process. That last arm is the
 *   acceptance criterion the whole package exists for: it resumes the repaired
 *   events through a process that does NOT mount this plugin, so a repair that
 *   only works because the guard is present is not a repair.
 * - **what it must not do** — a healthy session, a report-mode run, an exempt
 *   id, and a guard whose own reading fails.
 * - **config** — a bad value costs its own setting and nothing else.
 * - **the tool** — the on-demand half, including the refusal that keeps a
 *   durable write from happening by accident.
 * - **the decision** — the pure branches, reachable without a harness.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AUTO_PRESET, CUSTOM_PRESET, isExempt, isStranded, normalizeConfig, relabelFor,
  renderRepairReport, renderToolReport,
} from '../lib/index.js'
import {
  PLAIN_PRESETS, PRESETS, eventsOf, knobsOf, logText, resume, run, seedFor, strand, world,
} from './harness.mjs'

/** The stranded state, as the guard's own reading folds it. */
const AUTO_KNOBS = { preset: 'auto', sandbox: 'danger-full-access', approval: 'ask' }

/** The names a deployment without the Auto integration advertises. */
const NO_AUTO = ['workspace-write', 'danger-full-access']

/** The service's own `resolve()`, reconstructed for the pure arms. */
const resolve = name => {
  const spec = PRESETS[name]
  if (spec === undefined) throw new Error(`permission: unknown preset "${name}"`)
  return spec
}

describe('the repair', () => {
  it('publishes a stranded session instead of refusing it', async () => {
    const seed = await seedFor(AUTO_PRESET)
    const harness = await world({ plugin: true })
    const { session, error } = resume(harness, 'repair-published', seed)
    assert.equal(error, undefined, 'the guarded publication must not raise')
    assert.equal(harness.ctx.sessions.get(session.id), session, 'and the entry must still be live')
    assert.equal(harness.ctx.sessions.list().length, 1)
  })

  it('leaves a log that a process without the guard can open', async () => {
    // The acceptance criterion. A repair that only worked while this plugin was
    // mounted would be a plugin that has to stay mounted forever; what makes the
    // session openable is the durable event, so the measurement has to be a
    // process that never loaded it.
    const seed = await seedFor(AUTO_PRESET)
    const guarded = await world({ plugin: true })
    const { session } = resume(guarded, 'repair-durable', seed)
    const repaired = session.snapshotEvents()

    const later = await world({ plugin: false })
    const { error } = resume(later, 'repair-durable', repaired)
    assert.equal(error, undefined, `the repaired log must open unguarded: ${error?.message}`)
  })

  it('records the identity, and nothing else', async () => {
    // The recorded name is whatever the service can actually restore for these
    // knobs, which depends on the preset table of the line under test — so the
    // invariant asserted here is that *one* identity is appended and that it is
    // the identity the service reports back, not a name written down in a test.
    const seed = await seedFor(AUTO_PRESET)
    const harness = await world({ plugin: true })
    const { session } = resume(harness, 'repair-only-identity', seed)
    const preset = eventsOf(session, 'permission/preset')
    assert.equal(preset.length, seed.filter(event => event.type === 'permission/preset').length + 1,
      'exactly one event may be appended')
    assert.equal(preset.at(-1).data.preset, harness.presets.current(session))
    assert.notEqual(preset.at(-1).data.preset, AUTO_PRESET, 'the one name the service would refuse again')
  })

  it('keeps the sandbox mode and the approval policy the session had', async () => {
    const seed = await seedFor(AUTO_PRESET)
    const harness = await world({ plugin: true })
    const { session } = resume(harness, 'repair-knobs', seed)
    assert.deepEqual(knobsOf(session.snapshotEvents()), knobsOf(seed))
    assert.equal(eventsOf(session, 'sandbox/mode').length, eventsOf({ snapshotEvents: () => seed }, 'sandbox/mode').length,
      'no knob event may be written by the repair')
    assert.equal(eventsOf(session, 'approval/policy').length, seed.filter(event => event.type === 'approval/policy').length)
  })

  it('keeps the selection that could not be restored', async () => {
    // The history is not edited: the Auto selection is what happened, and the
    // projection folds the last identity, so recording a new one is enough.
    const seed = await seedFor(AUTO_PRESET)
    const harness = await world({ plugin: true })
    const { session } = resume(harness, 'repair-history', seed)
    assert.equal(eventsOf(session, 'permission/preset')[1].data.preset, AUTO_PRESET)
    assert.equal(session.snapshotEvents().length, seed.length + 2, 'the seed boundary plus the repair')
  })

  it('records a configured preset that describes the same knobs', async () => {
    // A pure relabel: the knobs already equal this preset's bundle, so nothing
    // about the session changes but its name. The bundle is taken from the
    // line's own seed, because the Auto preset is not the same bundle on every
    // line this plugin supports.
    const probe = await seedFor(AUTO_PRESET)
    const table = { shared: { ...knobsOf(probe), name: 'shared' } }
    const seed = await seedFor(AUTO_PRESET, { presets: table, defaultPreset: 'shared' })
    const harness = await world({ plugin: true, presets: table, defaultPreset: 'shared' })
    const { session } = resume(harness, 'repair-matched', seed)
    assert.equal(eventsOf(session, 'permission/preset').at(-1).data.preset, 'shared')
    assert.equal(harness.presets.current(session), 'shared')
  })

  it('records what the picker will report when nothing matches', async () => {
    // A table that cannot describe the line's Auto bundle, so the guard has to
    // fall back — and the fallback has to be the name the service itself
    // derives for those knobs, not a third name of its own invention.
    const empty = { only: { sandbox: 'read-only', approval: 'ask', name: 'only' } }
    const seed = await seedFor(AUTO_PRESET)
    const harness = await world({ plugin: true, presets: empty, defaultPreset: 'only' })
    const { session } = resume(harness, 'repair-no-match', seed)
    const recorded = eventsOf(session, 'permission/preset').at(-1).data.preset
    assert.equal(recorded, CUSTOM_PRESET)
    assert.equal(harness.presets.current(session), CUSTOM_PRESET, 'the stored identity and the picker must agree')
  })

  it('never records Auto, even when the Auto bundle is what the knobs match', async () => {
    // The trap this plugin would fall into if it matched on knobs alone:
    // `auto` resolves to danger-full-access/ask, which is exactly the stranded
    // session's state, so a loop that did not skip the Auto name would record
    // the identity that cannot be restored and the second open would throw.
    const harness = await world({ plugin: true, presets: PLAIN_PRESETS, defaultPreset: 'sandboxed' })
    const seed = await seedFor(AUTO_PRESET, { presets: PLAIN_PRESETS, defaultPreset: 'sandboxed' })
    const { session, error } = resume(harness, 'repair-auto-bundle', seed)
    assert.equal(error, undefined)
    const recorded = eventsOf(session, 'permission/preset').at(-1).data.preset
    assert.notEqual(recorded, AUTO_PRESET)
    assert.equal(recorded, harness.presets.current(session))
  })

  it('honours an operator identity the service can resolve', async () => {
    const seed = await seedFor(AUTO_PRESET)
    const harness = await world({ plugin: true, config: { preset: 'workspace-write' } })
    const { session } = resume(harness, 'repair-operator', seed)
    assert.equal(eventsOf(session, 'permission/preset').at(-1).data.preset, 'workspace-write')
    assert.deepEqual(knobsOf(session.snapshotEvents()), knobsOf(seed),
      'an operator identity renames the session; it does not move its sandbox')
  })

  it('ignores an operator identity the service cannot resolve', async () => {
    // Ignored rather than thrown: a throw here lands inside the publication
    // boundary and would cost the session this plugin exists to save.
    const seed = await seedFor(AUTO_PRESET)
    const harness = await world({ plugin: true, config: { preset: 'no-such-preset' } })
    const { session, error } = resume(harness, 'repair-bad-operator', seed)
    assert.equal(error, undefined)
    assert.notEqual(eventsOf(session, 'permission/preset').at(-1).data.preset, 'no-such-preset')
  })
})

describe('what the guard must not do', () => {
  it('leaves a session that is not stranded alone', async () => {
    const harness = await world({ plugin: true })
    const session = harness.ctx.sessions.create(
      (await import('@deepseek-ai/dsh-session')).SessionId('healthy'),
      { meta: { cwd: process.cwd() } },
    )
    assert.deepEqual(eventsOf(session, 'permission/preset').map(event => event.data.preset), ['workspace-write'])
  })

  it('leaves a session alone when the Auto integration is live', async () => {
    const harness = await world({ plugin: true, auto: true })
    const seed = await seedFor(AUTO_PRESET)
    const { session, error } = resume(harness, 'auto-live', seed)
    assert.equal(error, undefined)
    assert.deepEqual(eventsOf(session, 'permission/preset').map(event => event.data.preset),
      ['workspace-write', 'auto'], 'the guard must not relabel a restorable session')
  })

  it('writes nothing in report mode, and says what it would write', async () => {
    const seed = await seedFor(AUTO_PRESET)
    const harness = await world({ plugin: true, config: { mode: 'report' } })
    const { session, error } = resume(harness, 'report-mode', seed)
    assert.ok(error, 'report mode leaves the shipped refusal in place — that is what the mode is')
    assert.equal(error.message, 'permission: cannot restore preset "auto" without its active integration')
    assert.equal(eventsOf(session, 'permission/preset').length, 2, 'and it must not have written the repair')
    assert.match(logText(harness.logged), /would record/)
  })

  it('leaves an exempt id to the refusal it was exempted from', async () => {
    const seed = await seedFor(AUTO_PRESET)
    const harness = await world({ plugin: true, config: { exempt: ['exempt-*'] } })
    const { error } = resume(harness, 'exempt-one', seed)
    assert.equal(error?.message, 'permission: cannot restore preset "auto" without its active integration')
  })

  it('still repairs the sessions an exemption does not name', async () => {
    const seed = await seedFor(AUTO_PRESET)
    const harness = await world({ plugin: true, config: { exempt: ['exempt-*'] } })
    const { session, error } = resume(harness, 'kept-one', seed)
    assert.equal(error, undefined)
    assert.equal(session.snapshotEvents().at(-1).type, 'permission/preset')
  })

  it('contains a failure of its own reading instead of vetoing the publication', async () => {
    // The one property that makes a `session/created` listener safe to add: an
    // exception raised while deciding must not become a second way for the
    // session to be lost. Here the advertised names are made to throw, which is
    // the guard's very first read.
    const seed = await seedFor(AUTO_PRESET)
    const harness = await world({ plugin: true })
    Object.defineProperty(harness.presets, 'names', { get() { throw new Error('catalog is unavailable') } })
    const { error } = resume(harness, 'guard-failure', seed)
    assert.equal(error?.message, 'permission: cannot restore preset "auto" without its active integration',
      'the observed failure must be the shipped one, not the guard\'s')
    assert.match(logText(harness.logged), /could not examine session "guard-failure": catalog is unavailable/)
  })
})

describe('config', () => {
  it('falls back to the repair for an unknown mode, and says so', async () => {
    const harness = await world({ plugin: true, config: { mode: 'repair-all' } })
    assert.match(logText(harness.logged), /unknown mode "repair-all"; using repair/)
    const seed = await seedFor(AUTO_PRESET)
    const { error } = resume(harness, 'config-mode', seed)
    assert.equal(error, undefined)
  })

  it('drops a bad `preset` and a bad `exempt`, keeping the repair', async () => {
    const harness = await world({ plugin: true, config: { preset: '', exempt: ['ok', 7] } })
    const text = logText(harness.logged)
    assert.match(text, /`preset` must be a non-empty string; ignoring it/)
    assert.match(text, /`exempt` must be an array of non-empty strings; keeping the valid entries/)
    const seed = await seedFor(AUTO_PRESET)
    const { error } = resume(harness, 'config-bad', seed)
    assert.equal(error, undefined)
  })

  it('treats a config that is not an object as an empty one', () => {
    const ctx = { logger: { warn: () => {} } }
    assert.deepEqual(normalizeConfig(ctx, undefined), { mode: 'repair', preset: undefined, exempt: [] })
  })

  it('matches exemptions exactly, or by the prefix a trailing star marks', () => {
    assert.equal(isExempt('abc', ['abc']), true)
    assert.equal(isExempt('abc', ['ab']), false, 'a bare pattern is exact, never a prefix')
    assert.equal(isExempt('abc123', ['abc*']), true)
    assert.equal(isExempt('abc', []), false)
  })
})

describe('the decision', () => {
  it('reads a stored Auto with no live Auto as stranded, and nothing else as stranded', () => {
    assert.equal(isStranded(AUTO_KNOBS, NO_AUTO), true)
    assert.equal(isStranded(AUTO_KNOBS, [...NO_AUTO, AUTO_PRESET]), false, 'a live integration makes it restorable')
    assert.equal(isStranded({ ...AUTO_KNOBS, preset: 'workspace-write' }, NO_AUTO), false)
    assert.equal(isStranded({ ...AUTO_KNOBS, preset: null }, NO_AUTO), false)
    assert.equal(isStranded(undefined, NO_AUTO), false, 'an unwired registry is not a stranded session')
  })

  it('reports the effective knobs the service would derive, fallbacks included', () => {
    const withFallback = relabelFor({
      state: { preset: 'auto', sandbox: null, approval: null },
      names: NO_AUTO,
      resolve,
      fallbacks: { sandboxMode: 'workspace-write', approvalPolicy: 'ask' },
    })
    assert.equal(withFallback.preset, 'workspace-write')
    assert.equal(withFallback.reason, 'matched-knobs')
    const withDefault = relabelFor({
      state: { preset: 'auto', sandbox: null, approval: null },
      names: NO_AUTO,
      resolve,
    })
    assert.equal(withDefault.approval, 'ask', 'the service defaults approval to `ask`, and so must this')
  })

  it('prefers the operator identity over a knob match', () => {
    const decision = relabelFor({
      state: AUTO_KNOBS, names: NO_AUTO, resolve, override: 'workspace-write',
    })
    assert.equal(decision.reason, 'operator')
  })

  it('falls through an operator identity the service will not resolve', () => {
    const decision = relabelFor({
      state: AUTO_KNOBS, names: NO_AUTO, resolve, override: 'gone',
    })
    assert.equal(decision.reason, 'no-match')
    const throwing = relabelFor({
      state: AUTO_KNOBS, names: [...NO_AUTO, 'broken'], resolve: name => {
        if (name === 'broken') throw new Error('broken')
        return resolve(name)
      }, override: 'broken',
    })
    assert.equal(throwing.reason, 'no-match', 'a resolver that throws must not become the guard\'s failure')
  })

  it('never records a name that could not be restored again, whatever list it is handed', () => {
    // `relabelFor` is exported, so its `names` argument is a caller's list. The
    // rule the plugin needs is "never record the identity that cannot be
    // restored", not "never record a name this particular caller left out" —
    // which is why the skip does not depend on the Auto name being absent.
    const decision = relabelFor({
      state: AUTO_KNOBS,
      names: [...NO_AUTO, AUTO_PRESET],
      resolve: name => name === AUTO_PRESET ? { sandbox: 'danger-full-access', approval: 'ask' } : resolve(name),
    })
    assert.notEqual(decision.preset, AUTO_PRESET)
    assert.equal(decision.reason, 'no-match', 'and it must fall through to the name the picker will report')
  })

  it('does not accept an operator identity the service resolves to nothing usable', () => {
    // The name is advertised and the resolver answers — with an object that has
    // no knob bundle in it. Recording it would leave the session restorable by
    // name and un-restorable in fact.
    const decision = relabelFor({
      state: AUTO_KNOBS,
      names: [...NO_AUTO, 'hollow'],
      resolve: name => name === 'hollow' ? {} : resolve(name),
      override: 'hollow',
    })
    assert.equal(decision.reason, 'no-match')
    assert.equal(decision.preset, CUSTOM_PRESET)
  })

  it('skips a configured preset whose own resolution throws', () => {
    const decision = relabelFor({
      state: AUTO_KNOBS,
      names: ['broken', ...NO_AUTO],
      resolve: name => { if (name === 'broken') throw new Error('broken'); return resolve(name) },
    })
    assert.equal(decision.preset, CUSTOM_PRESET)
  })
})

describe('the tool', () => {
  it('reports a live stranded session and writes nothing', async () => {
    const harness = await world({ plugin: true, auto: true })
    const [session] = await strand(harness, 'live-stranded')
    const before = session.snapshotEvents().length
    const result = await run(harness, { action: 'report' })
    assert.equal(result.stranded, 1)
    assert.equal(result.repaired, 0)
    assert.equal(result.autoLive, false)
    assert.deepEqual(result.repairs, [`live-stranded:${harness.presets.current(session)}`])
    assert.match(result.report, /1 stranded session/)
    assert.match(result.report, /would record/)
    // Which branch chose the identity depends on the line's Auto bundle — a
    // preset table that can describe those knobs gives `matched-knobs`, one that
    // cannot gives `no-match`. Both are correct answers, so the arm asserts that
    // one of the two explanations is present rather than which one.
    assert.match(result.report,
      /\(a configured preset describes the same knobs, so nothing about the session changes but its name\)|\(no configured preset matches these knobs, so the identity records exactly what the picker will report\)/)
    assert.match(result.report, /Nothing but a `permission\/preset` identity is written/)
    assert.equal(session.snapshotEvents().length, before, 'a report must not write')
  })

  it('refuses to repair without `confirm: true`', async () => {
    const harness = await world({ plugin: true, auto: true })
    const [session] = await strand(harness, 'live-unconfirmed')
    const before = session.snapshotEvents().length
    const result = await run(harness, { action: 'repair' })
    assert.equal(result.mode, 'refused')
    assert.equal(result.stranded, 0, 'a refusal must not even sweep')
    assert.match(result.report, /Refusing to repair without `confirm: true`/)
    assert.equal(session.snapshotEvents().length, before)
  })

  it('repairs on `confirm: true`, and the session stops being stranded', async () => {
    const harness = await world({ plugin: true, auto: true })
    const [session] = await strand(harness, 'live-repaired')
    const expected = harness.presets.current(session)
    const result = await run(harness, { action: 'repair', confirm: true })
    assert.equal(result.mode, 'repair')
    assert.equal(result.stranded, 1)
    assert.equal(result.repaired, 1)
    assert.match(result.report, new RegExp(`recorded "${expected}"`))
    assert.equal(session.snapshotEvents().at(-1).data.preset, expected)
    const again = await run(harness, { action: 'report' })
    assert.equal(again.stranded, 0, 'the sweep must not find it a second time')
  })

  it('repairs on the default action when the caller confirmed it', async () => {
    const harness = await world({ plugin: true, auto: true })
    await strand(harness, 'live-auto-confirm')
    const result = await run(harness, { action: 'auto', confirm: true })
    assert.equal(result.mode, 'repair')
    assert.equal(result.repaired, 1)
  })

  it('sweeps one session when the caller named one', async () => {
    const harness = await world({ plugin: true, auto: true })
    await strand(harness, ['live-first', 'live-second'])
    const one = await run(harness, { action: 'report', session: 'live-second' })
    assert.equal(one.repairs.length, 1)
    assert.match(one.repairs[0], /^live-second:/)
    const all = await run(harness, { action: 'report' })
    assert.equal(all.stranded, 2)
  })

  it('says plainly when there is nothing stranded', async () => {
    const harness = await world({ plugin: true })
    const result = await run(harness, { action: 'report' })
    assert.equal(result.stranded, 0)
    assert.equal(result.repaired, 0)
    assert.match(result.report, /No stranded sessions among the live sessions of this process/)
    assert.match(result.report, /No session has needed this guard in this process yet/)
  })

  it('reports the live Auto integration it is running with', async () => {
    const harness = await world({ plugin: true, auto: true })
    const result = await run(harness, { action: 'report' })
    assert.equal(result.autoLive, true)
    assert.equal(result.stranded, 0, 'with Auto live, nothing it sees is stranded')
  })

  it('counts every repair the process made, the tool\'s own included', async () => {
    const harness = await world({ plugin: true, auto: true })
    await strand(harness, 'ledger-one')
    const before = await run(harness, { action: 'report' })
    assert.match(before.report, /No session has needed this guard in this process yet/)
    await run(harness, { action: 'repair', confirm: true })
    const after = await run(harness, { action: 'report' })
    assert.match(after.report, /Repairs in this process \(newest first\):/)
    assert.match(after.report, /ledger-one: recorded "\S+" \(\S+\)/)
  })

  it('ledgers a repair the mounted listener made', async () => {
    const harness = await world({ plugin: true })
    const seed = await seedFor(AUTO_PRESET)
    resume(harness, 'listener-ledger', seed)
    const result = await run(harness, { action: 'report' })
    assert.match(result.report, /listener-ledger: recorded "\S+" \(\S+\)/)
  })

  it('writes nothing while the plugin is mounted in report mode', async () => {
    // The mount decides whether this process may write a session log, so a
    // confirmed repair call cannot overrule it — and the answer has to say so,
    // or a model would read "reported" as "repaired".
    const harness = await world({ plugin: true, auto: true, config: { mode: 'report' } })
    const [session] = await strand(harness, 'mount-report')
    const before = session.snapshotEvents().length
    const result = await run(harness, { action: 'repair', confirm: true })
    assert.equal(result.mode, 'report')
    assert.equal(result.repaired, 0)
    assert.match(result.report, /would record "\S+".* — not written/)
    assert.match(result.report, /mounted with `mode: "report"`, so nothing was written/)
    assert.equal(session.snapshotEvents().length, before)
  })
})

describe('the report text', () => {
  it('says nothing has been repaired when the ledger is empty', () => {
    assert.equal(renderRepairReport([]), 'No session has needed this guard in this process yet.')
  })

  it('ledgers a repair that was not applied as "would record"', () => {
    const text = renderRepairReport([
      { sessionId: 'a', at: 0, preset: 'custom', reason: 'no-match', applied: false },
    ])
    assert.match(text, /1970-01-01T00:00:00.000Z a: would record "custom" \(no-match\)/)
  })

  it('states a failed append instead of the name it wrote', () => {
    const text = renderToolReport([
      { sessionId: 'a', before: 'auto', preset: 'custom', reason: 'no-match', applied: false, failure: 'read-only' },
    ], { repair: true, records: [] })
    assert.match(text, /FAILED: read-only/)
    assert.doesNotMatch(text, /applied/)
  })

  it('renders a sweep of one and of many in the singular and the plural', () => {
    const sighting = { sessionId: 'a', before: 'auto', preset: 'custom', reason: 'no-match', applied: true }
    assert.match(renderToolReport([sighting], { repair: true, records: [] }), /^1 stranded session \(/)
    assert.match(renderToolReport([sighting, { ...sighting, sessionId: 'b' }], { repair: true, records: [] }),
      /^2 stranded sessions \(/)
  })

  it('includes the live sightings when a caller asks for the report itself', () => {
    const text = renderRepairReport([], [{ sessionId: 'a', before: 'auto', preset: 'custom', reason: 'no-match', applied: true }])
    assert.match(text, /1 stranded session/)
  })
})
