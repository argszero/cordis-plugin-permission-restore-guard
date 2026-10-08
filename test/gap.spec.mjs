/**
 * The gap this package exists for, measured against the shipped service.
 *
 * Every arm here would fail if the harness changed the behaviour the README
 * and the tool description describe — which is the point: the prose is written
 * from these measurements, so they belong in the suite rather than in a note.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AUTO_PRESET } from '../lib/index.js'
import { eventsOf, knobsOf, resume, seedFor, world } from './harness.mjs'

describe('the published refusal', () => {
  it('refuses a restored Auto session when no integration is registered', async () => {
    const seed = await seedFor(AUTO_PRESET)
    const control = await world({ plugin: false })
    const { error } = resume(control, 'gap-control', seed)
    assert.ok(error, 'the control arm must throw; without it the plugin would be fixing nothing')
    assert.equal(error.message, 'permission: cannot restore preset "auto" without its active integration')
  })

  it('advertises `auto` exactly while an integration is registered', async () => {
    const without = await world({ plugin: false })
    assert.deepEqual([...without.presets.names], ['workspace-write', 'danger-full-access'])
    const with_ = await world({ plugin: false, auto: true })
    assert.deepEqual([...with_.presets.names], ['workspace-write', 'danger-full-access', 'auto'])
  })

  it('records the Auto identity as one durable event, and no new knob', async () => {
    // The repair is possible because the identity is a log event and the
    // projection folds the LAST one. If that stopped being true the plugin's
    // whole approach would be wrong, not merely stale.
    const seed = await seedFor(AUTO_PRESET)
    const presets = seed.filter(event => event.type === 'permission/preset')
    assert.deepEqual(presets.map(event => event.data.preset), ['workspace-write', 'auto'])
  })

  it('reproduces the failure with the plugin mounted but its listener ordered last', async () => {
    // The load-bearing property: a listener registered after the permission
    // service's runs after the throw. Measured through the shipped `install`,
    // with only the ordering switched, because the alternative — asserting the
    // prose — cannot tell the two registrations apart.
    const { install } = await import('../lib/index.js')
    const seed = await seedFor(AUTO_PRESET)
    const harness = await world({ plugin: false })
    const settings = { mode: 'repair', preset: undefined, exempt: [] }
    install(harness.ctx, settings, { prepend: false })
    const { session, error } = resume(harness, 'gap-ordering', seed)
    assert.ok(error, 'without prepend the guard must arrive after the service has thrown')
    assert.equal(error.message, 'permission: cannot restore preset "auto" without its active integration')
    assert.equal(eventsOf(session, 'permission/preset').length, 2, 'and it must not have written anything')
  })
})

describe('what the throw costs', () => {
  it('rolls the publication back instead of publishing a warnable session', async () => {
    const seed = await seedFor(AUTO_PRESET)
    const control = await world({ plugin: false })
    const { session, error } = resume(control, 'gap-rollback', seed)
    assert.ok(error)
    // The session is not in the store: this is why the client receives
    // `api-session/removed` and the sidebar drops the row.
    assert.equal(control.ctx.sessions.get(session.id), undefined)
    assert.equal(control.ctx.sessions.list().length, 0)
  })

  it('leaves the recorded knob events untouched — only the identity is stranded', async () => {
    const seed = await seedFor(AUTO_PRESET)
    const control = await world({ plugin: false })
    const { session } = resume(control, 'gap-knobs', seed)
    // The sandbox mode and approval policy the user actually had are intact:
    // the session is not mis-configured, it is un-openable. Compared against
    // the seed rather than against literals — the Auto preset's own bundle is
    // not the same on every line, and this arm is about the knobs surviving,
    // not about which line's table produced them.
    assert.deepEqual(knobsOf(session.snapshotEvents()), knobsOf(seed))
  })
})
