/**
 * A persisted permission preset that cannot be restored, made restorable.
 *
 * `@deepseek-ai/dsh-permission-presets` writes and restores the same identity
 * on two different terms. Switching a session to the Auto preset succeeds even
 * with no Auto integration registered — `apply()` runs `this.autoAdmit?.()`, an
 * optional call that is a no-op when nothing registered. Restoring that
 * session does not: `pinInitialPermission()` throws
 * `permission: cannot restore preset "auto" without its active integration`.
 *
 * The throw is worse than it sounds, and that is what makes this worth a
 * plugin. The restore runs from the service's own `session/created` listener,
 * and `dsh-session`'s `announce()` lets a throwing `session/created` listener
 * veto publication — the session is disposed, the client is told
 * `api-session/removed`, and the row leaves the sidebar. The session's log on
 * disk is intact and complete; there is simply no way in the product to open
 * it again, because every open takes the same path to the same throw.
 *
 * The durable record is what makes this fixable from outside core. A session's
 * permission identity is one appended `permission/preset` event, and the
 * `permissions` projection folds the last one. So *recording a different
 * identity* is the whole repair — no log rewriting, no header surgery, and the
 * session keeps every event it ever had.
 *
 * This plugin listens on `session/created` with `{ prepend: true }`, which is
 * load-bearing rather than stylistic: `announce()` resolves its listener
 * snapshot up front and calls listeners in registration order, so a listener
 * registered after the service's would run after the service had already
 * thrown. Prepended, it runs inside the same publication boundary, before the
 * refusal — and appending from a `session/created` listener is what the
 * service itself already does when it pins a fresh session.
 *
 * What it writes is one `permission/preset` event. It writes no knob: the
 * session's sandbox mode and approval policy are left exactly as they were, so
 * this repair never changes what a session may do.
 *
 * ```yaml
 * - id: permission-restore-guard
 *   name: '@argszero/cordis-plugin-permission-restore-guard'
 * ```
 *
 * @module @argszero/cordis-plugin-permission-restore-guard
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { AUTO_PRESET, CUSTOM_PRESET, isStranded, relabelFor } from "./relabel.js";
import { DEFAULT_MODE } from "./mode.js";
import { renderRepairReport, renderToolReport } from "./report.js";
export { AUTO_PRESET, CUSTOM_PRESET, isStranded, relabelFor } from "./relabel.js";
export { renderRepairReport, renderToolReport } from "./report.js";
export { DEFAULT_MODE } from "./mode.js";
/** The plugin's registered name. */
export const name = 'permission-restore-guard';
/**
 * Services this plugin cannot work without. `permissionPresets` owns both the
 * refusal and the advertised names; `sessionProjections` owns the folded knob
 * state. Both are mounted by the product, so requiring them keeps the plugin
 * out of a composition where it could do nothing but lie.
 */
export const inject = ['sessionProjections', 'permissionPresets'];
/** The tool name the model calls. */
export const TOOL = 'permission_restore';
/** Records kept before the oldest are dropped; exported because a bound nothing can assert is a comment. */
export const LEDGER_LIMIT = 50;
/**
 * Validate the configured values defensively. A bad value costs its own
 * setting and nothing else: the guard exists to keep a publication from
 * failing, so it must not become a new way for one to fail.
 * @param ctx - the plugin context, for the warning channel.
 * @param config - the raw config the composition supplied.
 * @returns the settings the guard runs with.
 */
export function normalizeConfig(ctx, config) {
    const raw = config ?? {};
    const mode = raw.mode === 'report' || raw.mode === 'repair' ? raw.mode : DEFAULT_MODE;
    if (raw.mode !== undefined && raw.mode !== mode) {
        ctx.logger.warn(`permission-restore-guard: unknown mode ${JSON.stringify(raw.mode)}; using ${mode}`);
    }
    const preset = typeof raw.preset === 'string' && raw.preset !== '' ? raw.preset : undefined;
    if (raw.preset !== undefined && preset === undefined) {
        ctx.logger.warn('permission-restore-guard: `preset` must be a non-empty string; ignoring it');
    }
    const exempt = Array.isArray(raw.exempt) ? raw.exempt.filter(entry => typeof entry === 'string' && entry !== '') : [];
    if (raw.exempt !== undefined && (!Array.isArray(raw.exempt) || exempt.length !== raw.exempt.length)) {
        ctx.logger.warn('permission-restore-guard: `exempt` must be an array of non-empty strings; keeping the valid entries');
    }
    return { mode, preset, exempt };
}
/**
 * Whether one session id is exempt from the guard.
 * @param id - the session id.
 * @param exempt - the configured patterns; `prefix*` matches by prefix.
 * @returns true when the guard must leave this session alone.
 */
export function isExempt(id, exempt) {
    return exempt.some(pattern => pattern.endsWith('*') ? id.startsWith(pattern.slice(0, -1)) : id === pattern);
}
/**
 * Read the session's folded permission knobs, tolerating an unwired registry.
 *
 * The registry is reached through `ctx.get` rather than `ctx.sessionProjections`
 * for a reason that matters here: a service property read in cordis throws when
 * nothing is provided, and this read happens inside a `session/created` listener
 * where a throw vetoes the publication. An absent unit must be a value, not a
 * crash. The type still comes from the registry's own declaration, so the
 * projection key and its folded shape cannot drift from what the harness folds.
 */
function permissionState(ctx, session) {
    const projections = ctx.get('sessionProjections');
    const state = projections?.stateOf(session, 'permissions');
    if (state === undefined)
        return undefined;
    return state;
}
/** The composition fallbacks the service itself would apply to unrecorded knobs. */
function fallbacks(ctx) {
    const shell = ctx.get('shell');
    const approval = ctx.get('approval');
    return {
        sandboxMode: typeof shell?.sandboxMode === 'string' ? shell.sandboxMode : undefined,
        approvalPolicy: typeof approval?.config?.policy === 'string' ? approval.config.policy : undefined,
    };
}
/**
 * Register the prepended `session/created` listener that performs the repair.
 *
 * Exported, and exported *with* the ordering switch, because the ordering is
 * the whole mechanism: a listener registered after the permission service's
 * runs after the service has already thrown, and a suite that could only
 * observe the prepended form would be asserting the prose rather than the
 * behaviour. `prepend: false` exists so that claim can be measured; `apply`
 * always passes `true`.
 *
 * @param ctx - the plugin context.
 * @param settings - validated plugin settings.
 * @param options - `prepend` (true in production) and the ledger to fill.
 * @returns a disposer that removes the listener.
 */
export function install(ctx, settings, options = {}) {
    const presets = ctx.permissionPresets;
    const records = options.records;
    const listener = (session) => {
        // A throw here vetoes the publication this plugin exists to save, so every
        // failure is contained: an unwired registry, an unresolvable preset and a
        // refused append all end as a warning, never as a lost session.
        try {
            if (isExempt(String(session.id), settings.exempt))
                return;
            const state = permissionState(ctx, session);
            const names = presets.names;
            if (!isStranded(state, names))
                return;
            const relabel = relabelFor({
                state: state,
                names,
                resolve: (presetName) => presets.resolve(presetName),
                fallbacks: fallbacks(ctx),
                override: settings.preset,
            });
            if (settings.mode === 'report') {
                note(ctx, records, {
                    sessionId: String(session.id), at: Date.now(), preset: relabel.preset,
                    reason: relabel.reason, applied: false,
                });
                ctx.logger.warn(`permission-restore-guard: session "${session.id}" records preset "${AUTO_PRESET}" with no live integration`
                    + ` (report mode: would record "${relabel.preset}")`);
                return;
            }
            session.append('permission/preset', { preset: relabel.preset });
            note(ctx, records, {
                sessionId: String(session.id), at: Date.now(), preset: relabel.preset,
                reason: relabel.reason, applied: true,
            });
        }
        catch (error) {
            ctx.logger.warn(`permission-restore-guard: could not examine session "${session.id}": `
                + `${error instanceof Error ? error.message : String(error)}`);
        }
    };
    return ctx.on('session/created', listener, options.prepend === false ? undefined : { prepend: true });
}
/** Append one repair to the caller's ledger, bounded. */
function note(ctx, records, entry) {
    if (records === undefined)
        return;
    records.unshift(entry);
    if (records.length > LEDGER_LIMIT)
        records.length = LEDGER_LIMIT;
    void ctx;
}
/**
 * Mount the repair: a prepended `session/created` listener that records a
 * restorable identity before the permission service can refuse the session,
 * plus a tool that reports and repairs already-live sessions.
 * @param ctx - the plugin context.
 * @param config - optional `mode`, `preset` and `exempt`.
 */
export function apply(ctx, config = {}) {
    const settings = normalizeConfig(ctx, config);
    const presets = ctx.permissionPresets;
    const records = [];
    install(ctx, settings, { prepend: true, records });
    ctx.inject(['tools', 'sessions'], (toolCtx) => {
        toolCtx.tools.register(defineTool({
            name: TOOL,
            description: 'Report and repair sessions whose stored permission preset can no longer be restored. A session'
                + ' switched to the Auto review preset keeps that identity after the Auto integration stops being'
                + ' registered; the next time the session is opened the permission service refuses it'
                + ' ("cannot restore preset \\"auto\\" without its active integration"), the publication is rolled'
                + ' back, and the session disappears from the sidebar with its log intact. This tool lists the live'
                + ' sessions in that state and, with `action: "repair"` and `confirm: true`, appends the'
                + ' `permission/preset` event that makes them openable again — the same repair the mounted guard'
                + ' applies automatically when a stranded session is opened. It writes no knob, so no session'
                + ' permission changes. Call it when a session will not open at all after an update removed or'
                + ' disabled a permission integration, or when the model or a user reports a session missing from'
                + ' the sidebar while its files are still present.',
            parameters: {
                action: {
                    type: 'string',
                    description: '`report` (default) lists stranded sessions and what would be recorded; `repair` also records it. Repair needs `confirm: true`.',
                    enum: ['report', 'repair', 'auto'],
                },
                confirm: {
                    type: 'boolean',
                    description: 'Required for `action: "repair"` — the write is durable and changes the session\'s recorded identity.',
                },
                session: {
                    type: 'string',
                    description: 'Limit the action to one session id.',
                },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        mode: { type: 'string', required: true },
                        autoLive: { type: 'boolean', required: true },
                        stranded: { type: 'integer', required: true },
                        repaired: { type: 'integer', required: true },
                        repairs: { type: 'array', required: true, items: { type: 'string' } },
                        report: { type: 'string', required: true },
                    },
                },
                render: (_args, value) => [{ type: 'text', text: String(value.report ?? '') }],
            },
            async execute(rawArgs) {
                const args = rawArgs;
                const action = args.action ?? 'auto';
                if (action === 'repair' && args.confirm !== true) {
                    return {
                        mode: 'refused',
                        autoLive: presets.names.includes(AUTO_PRESET),
                        stranded: 0,
                        repaired: 0,
                        repairs: [],
                        report: 'Refusing to repair without `confirm: true`: this writes a durable `permission/preset` event into'
                            + ' each session it touches. Re-run with `confirm: true`, or `action: "report"` to see the list'
                            + ' first. The sessions themselves are not harmed either way — they are unopenable already.',
                    };
                }
                const repair = action === 'repair' || (action === 'auto' && args.confirm === true);
                const writing = repair && settings.mode === 'repair';
                const sightings = inspect(toolCtx, presets, settings, args.session, writing, records);
                return {
                    mode: writing ? 'repair' : 'report',
                    autoLive: presets.names.includes(AUTO_PRESET),
                    stranded: sightings.length,
                    repaired: sightings.filter(sighting => sighting.applied).length,
                    repairs: sightings.map(sighting => `${sighting.sessionId}:${sighting.preset}`),
                    report: renderToolReport(sightings, {
                        repair: writing,
                        requested: repair,
                        mount: settings.mode,
                        records,
                    }),
                };
            },
        }));
    });
}
/**
 * Look at the live sessions this process owns and report the stranded ones.
 * @param ctx - the plugin context.
 * @param presets - the permission-preset service.
 * @param settings - validated plugin settings.
 * @param only - optional single session id to limit the sweep to.
 * @param write - whether this sweep may append the repair. The mount's mode and
 *   the caller's own request both have to allow it: a process mounted with
 *   `mode: 'report'` never writes a session log, whatever a tool call asks for.
 * @param records - the process ledger, filled with the same shape the mounted
 *   listener fills it with, so "repairs in this process" means all of them.
 * @returns one sighting per stranded session, in the store's order.
 */
function inspect(ctx, presets, settings, only, write, records) {
    const names = presets.names;
    const autoLive = names.includes(AUTO_PRESET);
    const sightings = [];
    for (const session of ctx.sessions.list()) {
        const id = String(session.id);
        if (only !== undefined && only !== id)
            continue;
        if (isExempt(id, settings.exempt))
            continue;
        const state = permissionState(ctx, session);
        if (!isStranded(state, names))
            continue;
        const relabel = relabelFor({
            state: state,
            names,
            resolve: (presetName) => presets.resolve(presetName),
            fallbacks: fallbacks(ctx),
            override: settings.preset,
        });
        const before = String(state?.preset);
        let applied = false;
        let failure;
        if (settings.mode === 'repair' && write) {
            try {
                session.append('permission/preset', { preset: relabel.preset });
                applied = true;
                note(ctx, records, {
                    sessionId: id, at: Date.now(), preset: relabel.preset, reason: relabel.reason, applied: true,
                });
            }
            catch (error) {
                failure = error instanceof Error ? error.message : String(error);
            }
        }
        sightings.push({ sessionId: id, before, preset: relabel.preset, reason: relabel.reason, applied, failure });
    }
    return sightings;
}
export default { name, inject, apply };
