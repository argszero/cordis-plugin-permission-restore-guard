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
import type { Context } from '@deepseek-ai/cordis';
import type { RestoreMode } from './mode.ts';
import type { RepairRecord } from './report.ts';
export { AUTO_PRESET, CUSTOM_PRESET, isStranded, relabelFor } from './relabel.ts';
export type { Fallbacks, KnobState, PresetSpec, Relabel, RelabelInput, RelabelReason } from './relabel.ts';
export { renderRepairReport, renderToolReport } from './report.ts';
export { DEFAULT_MODE } from './mode.ts';
export type { RestoreMode } from './mode.ts';
export type { RepairRecord, SessionSighting } from './report.ts';
/** The plugin's registered name. */
export declare const name = "permission-restore-guard";
/**
 * Services this plugin cannot work without. `permissionPresets` owns both the
 * refusal and the advertised names; `sessionProjections` owns the folded knob
 * state. Both are mounted by the product, so requiring them keeps the plugin
 * out of a composition where it could do nothing but lie.
 */
export declare const inject: string[];
/** The tool name the model calls. */
export declare const TOOL = "permission_restore";
/** Records kept before the oldest are dropped; exported because a bound nothing can assert is a comment. */
export declare const LEDGER_LIMIT = 50;
/** Configuration accepted by {@link apply}. */
export interface Config {
    /** `repair` records the replacement identity; `report` only says what it would record. */
    mode?: RestoreMode;
    /** Force the identity to record; ignored unless the service can resolve it. */
    preset?: string;
    /** Session ids (exact, or a `prefix*` glob) the guard must not touch. */
    exempt?: readonly string[];
}
/** One configuration value, resolved and validated before any session is seen. */
export interface Settings {
    /** The effective mode. */
    mode: RestoreMode;
    /** The operator's forced identity, if any. */
    preset: string | undefined;
    /** Exemption patterns. */
    exempt: readonly string[];
}
/**
 * Validate the configured values defensively. A bad value costs its own
 * setting and nothing else: the guard exists to keep a publication from
 * failing, so it must not become a new way for one to fail.
 * @param ctx - the plugin context, for the warning channel.
 * @param config - the raw config the composition supplied.
 * @returns the settings the guard runs with.
 */
export declare function normalizeConfig(ctx: Context, config: Config | undefined): Settings;
/**
 * Whether one session id is exempt from the guard.
 * @param id - the session id.
 * @param exempt - the configured patterns; `prefix*` matches by prefix.
 * @returns true when the guard must leave this session alone.
 */
export declare function isExempt(id: string, exempt: readonly string[]): boolean;
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
export declare function install(ctx: Context, settings: Settings, options?: {
    prepend?: boolean;
    records?: RepairRecord[];
}): () => void;
/**
 * Mount the repair: a prepended `session/created` listener that records a
 * restorable identity before the permission service can refuse the session,
 * plus a tool that reports and repairs already-live sessions.
 * @param ctx - the plugin context.
 * @param config - optional `mode`, `preset` and `exempt`.
 */
export declare function apply(ctx: Context, config?: Config): void;
declare const _default: {
    name: string;
    inject: string[];
    apply: typeof apply;
};
export default _default;
//# sourceMappingURL=index.d.ts.map