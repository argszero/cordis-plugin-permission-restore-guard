/**
 * The one configuration value that decides whether this plugin is allowed to
 * write a session log at all.
 *
 * Its own module because both halves of the package name it — the listener that
 * repairs a session as it is published, and the tool that repairs one already
 * open — and neither is the other's natural home. Keeping it here stops the
 * report renderer from reaching back into the plugin entry, which would make the
 * renderer and the entry import each other.
 *
 * @module @argszero/cordis-plugin-permission-restore-guard/mode
 */
/** Default mode: the repair, since the alternative is a session nobody can open. */
export const DEFAULT_MODE = 'repair';
