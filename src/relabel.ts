/**
 * The one decision this plugin makes: which durable identity to record for a
 * session whose stored preset can no longer be restored.
 *
 * Kept pure and separate from the hook that calls it, because it is the part
 * that can be wrong in a way that silently changes a session's permissions —
 * so every branch is reachable in a unit test, without a harness.
 *
 * @module @argszero/cordis-plugin-permission-restore-guard/relabel
 */

/** The preset identity the Auto integration records while it is live. */
export const AUTO_PRESET = 'auto'

/** The harness's own name for "the effective knobs match no configured preset". */
export const CUSTOM_PRESET = 'custom'

/** One configured preset's knob bundle, as the public `resolve()` hands it out. */
export interface PresetSpec {
  /** Sandbox mode the preset selects. */
  readonly sandbox: string
  /** Approval policy the preset selects. */
  readonly approval: string
}

/** The recorded knob state of one session, as the `permissions` projection folds it. */
export interface KnobState {
  /** Last recorded `permission/preset` payload, or null. */
  readonly preset: string | null
  /** Last recorded `sandbox/mode` payload, or null. */
  readonly sandbox: string | null
  /** Last recorded `approval/policy` payload, or null. */
  readonly approval: string | null
}

/** Composition-level fallbacks, used exactly where the service uses them. */
export interface Fallbacks {
  /** `ctx.shell.sandboxMode`, when the shell service exposes one. */
  readonly sandboxMode?: string | undefined
  /** `ctx.approval.config.policy`, when the approval service exposes one. */
  readonly approvalPolicy?: string | undefined
}

/** Everything the decision reads. */
export interface RelabelInput {
  /** The session's folded knob state. */
  readonly state: KnobState
  /** Every preset name the service currently advertises (`names`), Auto included when live. */
  readonly names: readonly string[]
  /** The service's own `resolve()`, used to compare knob bundles. */
  readonly resolve: (name: string) => PresetSpec
  /** Composition fallbacks for unrecorded knobs. */
  readonly fallbacks?: Fallbacks | undefined
  /** An operator-forced identity; used when it is a name the service can resolve. */
  readonly override?: string | undefined
}

/** Why a relabel was chosen, so a report can say more than the name. */
export type RelabelReason =
  /** The recorded knobs equal one configured preset's bundle: a pure relabel. */
  | 'matched-knobs'
  /** The operator's `preset` config named a resolvable preset. */
  | 'operator'
  /** Nothing matches, so the identity records exactly what `derive()` will report. */
  | 'no-match'

/** The decision: the identity to record, and the evidence for it. */
export interface Relabel {
  /** The `permission/preset` payload to append. */
  readonly preset: string
  /** Which branch produced it. */
  readonly reason: RelabelReason
  /** The effective sandbox mode the comparison used. */
  readonly sandbox: string | undefined
  /** The effective approval policy the comparison used. */
  readonly approval: string
}

/**
 * Resolve the effective knob values the way the service derives them: a
 * recorded value wins, otherwise the composition fallback, otherwise the
 * service's own `'ask'` default for approval.
 * @param state - the session's folded knob state.
 * @param fallbacks - composition-level fallbacks.
 * @returns the pair the comparison runs against.
 */
function effective(state: KnobState, fallbacks: Fallbacks | undefined): { sandbox: string | undefined, approval: string } {
  return {
    sandbox: state.sandbox ?? fallbacks?.sandboxMode,
    approval: state.approval ?? fallbacks?.approvalPolicy ?? 'ask',
  }
}

/**
 * Decide the durable identity a session should carry once its stored Auto
 * selection can no longer be restored.
 *
 * The order is deliberate. An operator's explicit `preset` wins, but only when
 * the service can resolve it — an unresolvable one is ignored here rather than
 * throwing inside a `session/created` listener, where a throw would veto the
 * publication this plugin exists to save. Failing that, a configured preset
 * whose bundle equals the session's effective knobs is a pure relabel: the
 * session keeps every permission it had and only its name changes. Failing
 * that, the identity records exactly what the service's own `derive()` will
 * report for the resulting state, so the stored identity and the identity the
 * picker computes agree instead of drifting apart.
 *
 * No branch writes a knob. The sandbox mode and approval policy of the session
 * are whatever they already were; only the recorded identity changes.
 *
 * @param input - the folded state, the advertised names, and the resolver.
 * @returns the identity to record and the branch that chose it.
 */
export function relabelFor(input: RelabelInput): Relabel {
  const { state, names, resolve, fallbacks, override } = input
  const { sandbox, approval } = effective(state, fallbacks)

  if (override !== undefined && override !== '' && names.includes(override)) {
    let resolvable = false
    try {
      const spec = resolve(override)
      resolvable = typeof spec?.sandbox === 'string' && typeof spec?.approval === 'string'
    } catch {
      resolvable = false
    }
    if (resolvable) return { preset: override, reason: 'operator', sandbox, approval }
  }

  for (const name of names) {
    if (name === AUTO_PRESET || name === CUSTOM_PRESET) continue
    let spec: PresetSpec
    try {
      spec = resolve(name)
    } catch {
      continue
    }
    if (spec.sandbox === sandbox && spec.approval === approval) {
      return { preset: name, reason: 'matched-knobs', sandbox, approval }
    }
  }

  return { preset: CUSTOM_PRESET, reason: 'no-match', sandbox, approval }
}

/**
 * Whether this session is the one this plugin exists for: a stored Auto
 * identity with no live Auto integration in this process.
 * @param state - the session's folded knob state.
 * @param names - the advertised preset names; Auto is absent exactly when no
 *   integration is registered.
 * @returns true when the service's own restore would refuse this session.
 */
export function isStranded(state: KnobState | undefined, names: readonly string[]): boolean {
  return state?.preset === AUTO_PRESET && !names.includes(AUTO_PRESET)
}
