/**
 * The integration harness: a REAL cordis context, the REAL `dsh-session`
 * store, the REAL `dsh-session-projection` registry, the REAL
 * `dsh-permission-presets` service — and the REAL `dsh-tools` registry for the
 * tool arms.
 *
 * What this shape proves that a stand-in cannot: the refusal this plugin exists
 * to prevent is produced by the shipped permission service, reading the shipped
 * projection of a shipped session log, and the throw lands inside the shipped
 * `announce()` transaction. A fixture that imitated any of those would be
 * testing the plugin against behaviour the harness does not have.
 *
 * Two services ARE stand-ins, and the reason is scope rather than convenience:
 * `ctx.shell` and `ctx.approval` are injected capabilities the permission
 * service only *reads* (`shell.sandboxMode`, `approval.config.policy`, and
 * `approval.setPolicy` when a caller switches presets). Mounting the real ones
 * would bring a subprocess executor and a sandbox provider into a suite whose
 * subject is a durable identity and a listener order. The stand-ins expose
 * exactly the fields the real service reads, and one arm pins that the plugin
 * reads the same fields rather than its own idea of the defaults.
 */

import { Context } from '@deepseek-ai/cordis'
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import systemPromptPlugin from '@deepseek-ai/dsh-system-prompt'
import toolsPlugin from '@deepseek-ai/dsh-tools'
import permissionPresetsPlugin, { PermissionPresetService } from '@deepseek-ai/dsh-permission-presets'
import * as plugin from '../lib/index.js'
import { AUTO_PRESET } from '../lib/index.js'

/** The tool name the model calls. */
export const TOOL = 'permission_restore'

/** The preset table a deployment without the Auto integration ships. */
export const PRESETS = {
  'workspace-write': {
    sandbox: 'workspace-write',
    approval: 'ask',
    name: 'workspace-write',
    description: 'Write inside the workspace.',
  },
  'danger-full-access': {
    sandbox: 'danger-full-access',
    approval: 'never',
    name: 'danger-full-access',
    description: 'Full file access without approval prompts.',
  },
}

/** One preset table shaped like the one a small local model's deployment uses. */
export const PLAIN_PRESETS = {
  sandboxed: { sandbox: 'workspace-write', approval: 'ask', name: 'sandboxed' },
  wide: { sandbox: 'danger-full-access', approval: 'never', name: 'wide' },
}

/**
 * Mount the real harness and, by default, this plugin.
 * @param spec - `plugin: false` mounts everything except this plugin (the
 *   control arm); `auto: true` registers an Auto integration, as the live
 *   `dsh-experimental-auto-review` does; `config` is the plugin's config;
 *   `guard: false` mounts the services but not the repair listener, so a test
 *   can install the listener itself with an explicit ordering.
 * @returns the context, the permission service, the logger capture and the tool registry.
 */
export async function world(spec = {}) {
  const ctx = new Context()
  const logged = []
  ctx.logger.exporter({ levels: { default: 2 }, export: message => { logged.push(message) } })

  const policies = []
  ctx.provide('shell', { sandboxMode: spec.sandboxMode ?? 'workspace-write' })
  ctx.provide('approval', {
    config: { policy: spec.approvalPolicy ?? 'ask' },
    setPolicy: (_agent, policy) => { policies.push(policy) },
  })

  await ctx.plugin(systemPromptPlugin, {})
  await ctx.plugin(toolsPlugin)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(PermissionPresetService, {
    presets: spec.presets ?? PRESETS,
    defaultPreset: spec.defaultPreset ?? 'workspace-write',
  })
  const presets = ctx.get('permissionPresets')
  const disposeAuto = spec.auto === true ? presets.registerAuto(() => {}) : undefined

  if (spec.plugin !== false) await ctx.plugin(plugin, spec.config ?? {})
  return {
    ctx,
    presets,
    policies,
    logged,
    disposeAuto,
    tools: spec.plugin === false ? undefined : ctx.get('tools'),
  }
}

/**
 * Produce the durable seed event list for one preset selection, using a
 * throwaway harness that has the Auto integration live.
 *
 * The seed is produced by the REAL service rather than hand-written, so the
 * fixture cannot drift from what the product writes: `set(session, preset)`
 * appends exactly the events a user selecting that preset produces.
 * @param preset - the preset the user selected.
 * @param spec - forwarded to {@link world} (e.g. a custom preset table).
 * @returns the seed events a later process would read from disk.
 */
export async function seedFor(preset, spec = {}) {
  const source = await world({ ...spec, auto: true, plugin: false })
  const session = source.ctx.sessions.create(SessionId(`seed-${preset}`), { meta: { cwd: process.cwd() } })
  source.presets.set(session, preset)
  return session.snapshotEvents()
}

/**
 * Produce a session that is live, announced AND stranded — the state an update
 * leaves behind, reached the way the product reaches it: a session selected the
 * Auto preset while its integration was registered, and then that registration
 * was disposed (disabling or removing the integration) with the session still
 * open.
 *
 * This is the only shape the tool can act on. A session that is stranded but
 * not live is on disk, and nothing but opening it brings it into reach — which
 * is what the mounted listener is for.
 * @param harness - a harness from {@link world} with `auto: true`.
 * @param ids - one session id, or several; every one is stranded the same way.
 * @param preset - the preset to select before the integration goes away.
 * @returns the live, stranded sessions, in the order they were named.
 */
export async function strand(harness, ids, preset = AUTO_PRESET) {
  if (harness.disposeAuto === undefined) throw new Error('strand() needs world({ auto: true })')
  // The selection has to happen while the integration is still registered —
  // `set(session, 'auto')` resolves the name first and would refuse afterwards,
  // exactly as the product would. So every session is stranded in one pass and
  // the registration goes away once, at the end.
  const sessions = (Array.isArray(ids) ? ids : [ids]).map(id => {
    const session = harness.ctx.sessions.create(SessionId(id), { meta: { cwd: process.cwd() } })
    harness.presets.set(session, preset)
    return session
  })
  await harness.disposeAuto()
  return sessions
}

/**
 * Resume a seed the way `agent-loop`'s `publish` does: prepare, enter, announce,
 * and — when the announcement throws — release the detach the enter returned.
 * The throw this plugin is about happens inside `announce`.
 *
 * The detach call is not tidiness: `announce` does NOT roll itself back. Both
 * shipped callers yield the detach disposer inside an effect and only then
 * announce (`sessions.create`'s `ctx.effect`, agent-loop's `publish` + its
 * catch), so the rollback that removes the store entry is performed by the
 * caller. A harness that skipped it would keep the entry live and the arms
 * that measure the rollback edge would be measuring the harness.
 * @param harness - a harness from {@link world}.
 * @param id - the session id.
 * @param seed - the stored events.
 * @returns the live session, or the error the publication raised.
 */
export function resume(harness, id, seed) {
  const session = harness.ctx.sessions.prepare(SessionId(id), { seed, meta: { cwd: process.cwd() } })
  let detach
  try {
    detach = harness.ctx.sessions.enter(session)
    harness.ctx.sessions.announce(session)
    return { session, error: undefined }
  } catch (error) {
    detach?.()
    return { session, error }
  }
}

/**
 * The knob values a seed leaves a session in, as the line under test wrote them.
 *
 * Read from the seed rather than written into a test, because the Auto preset's
 * bundle is **not the same on every line**: on some it is
 * `danger-full-access`/`never`, on others `danger-full-access`/`ask`. A suite
 * that hard-coded either would be asserting one line's table while claiming to
 * cover the range — and would fail on a line that is working correctly.
 * @param seed - a stored event list.
 * @returns the last recorded sandbox mode and approval policy.
 */
export function knobsOf(seed) {
  const last = type => [...seed].reverse().find(event => event.type === type)?.data
  return {
    sandbox: last('sandbox/mode')?.mode ?? null,
    approval: last('approval/policy')?.policy ?? null,
  }
}

/** The events of one kind currently in a session's log. */
export function eventsOf(session, type) {
  return session.snapshotEvents().filter(event => event.type === type)
}

/** A fresh abort signal per call, as the tool pipeline expects. */
export const signal = () => new AbortController().signal

/**
 * Drive one tool call through the real registry.
 * @param harness - a harness from {@link world}.
 * @param args - tool arguments.
 * @returns the settled result.
 */
export function call(harness, args = {}) {
  return harness.tools.execute({ name: TOOL, arguments: args, signal: signal() })
}

/**
 * Drive one tool call and return the value it settled with.
 *
 * The registry hands back a settlement — `{ isError, content, value }` — and the
 * `value` is what the model sees after the output schema and the renderer have
 * had their say. A call that failed has no value worth reading, so this throws
 * instead of returning one.
 * @param harness - a harness from {@link world}.
 * @param args - tool arguments.
 * @returns the settled value.
 */
export async function run(harness, args = {}) {
  const settled = await call(harness, args)
  if (settled.isError === true) {
    const text = (settled.content ?? []).map(part => part.text).join('\n')
    throw new Error(`the tool call failed: ${text}`)
  }
  return settled.value
}

/** The captured log as one string. */
export function logText(logged) {
  return logged.map(message => message.args.map(argument => String(argument)).join(' ')).join('\n')
}
