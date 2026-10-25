/**
 * Rendering for the two surfaces that report this guard: the tool's answer,
 * and the lines the plugin returns for a caller that wants the same text.
 *
 * Kept apart from the decision so a report can be asserted on its own: the
 * value of a diagnostic is what it does when there is nothing to fix.
 *
 * @module @argszero/cordis-plugin-permission-restore-guard/report
 */
import type { RelabelReason } from './relabel.ts';
import type { RestoreMode } from './mode.ts';
/** One session the guard examined and found stranded. */
export interface SessionSighting {
    /** The session id. */
    sessionId: string;
    /** The recorded preset that could not be restored. */
    before: string;
    /** The identity the guard records (or would record). */
    preset: string;
    /** Which branch chose it. */
    reason: RelabelReason;
    /** Whether the event was actually appended. */
    applied: boolean;
    /** Why the append failed, when it did. */
    failure?: string | undefined;
}
/** One repair the guard performed, kept so a session's history is visible after the fact. */
export interface RepairRecord {
    /** The session id. */
    sessionId: string;
    /** When the guard acted. */
    at: number;
    /** The identity it recorded (or would have, in report mode). */
    preset: string;
    /** Which branch chose it. */
    reason: RelabelReason;
    /** False in report mode, and when the append failed. */
    applied: boolean;
}
/**
 * The tool's answer for one sweep.
 * @param sightings - the stranded sessions found, in the store's order.
 * @param options - whether the caller asked for a repair, the guard's ledger,
 *   the mode the plugin is mounted with, and whether the call asked to write.
 * @returns the text the model reads.
 */
export declare function renderToolReport(sightings: SessionSighting[], options: {
    repair: boolean;
    records: readonly RepairRecord[];
    mount?: RestoreMode;
    requested?: boolean;
}): string;
/**
 * The lines a caller gets from the plugin itself, without a tool call.
 * @param records - the guard's ledger, newest first.
 * @param live - the live sessions' sighting this round, when a sweep ran.
 * @returns the report text.
 */
export declare function renderRepairReport(records: readonly RepairRecord[], live?: readonly SessionSighting[]): string;
//# sourceMappingURL=report.d.ts.map