# @argszero/cordis-plugin-permission-restore-guard

Makes a session openable again when its recorded permission preset can no longer be restored.

```sh
dsh plugin add github:argszero/cordis-plugin-permission-restore-guard
```

```yaml
# or mount it by hand in a dsh profile's cordis config
- id: permission-restore-guard
  name: '@argszero/cordis-plugin-permission-restore-guard'
```

## The two halves of one asymmetry

`@deepseek-ai/dsh-permission-presets` writes and restores the same identity on two different terms:

```ts
// packages/interaction/permission-presets/src/index.ts
apply()                { if (name === AUTO_PRESET) this.autoAdmit?.() }   // optional call: a no-op without an integration
pinInitialPermission() { if (this.autoAdmit === undefined) throw ... }     // a throw when the integration is gone
```

Selecting the Auto review preset while the integration is registered silently succeeds. Opening that
session later, in a process where the integration is no longer registered, fails:

```
permission: cannot restore preset "auto" without its active integration
```

The throw is worse than a failed open, because of where it lands. The restore runs from the service's
own `session/created` listener, and `dsh-session` lets a throwing `session/created` listener **veto the
publication**:

> A synchronous throw vetoes and rolls back with a paired disposal.
> — `packages/core/session/src/index.ts`, `Events['session/created']`

So the session is not published with a warning. It is rolled back, the client is told
`api-session/removed`, the row leaves the sidebar, and the log on disk stays complete and unopenable.
Every attempt to open it takes the same path to the same throw, so there is no way in the product back
in. A session is not so much broken as sealed.

## Why a plugin can fix it

A session's permission identity is **one appended event**, and the `permissions` projection folds the
last one:

```ts
case 'permission/preset': return { ...state, preset: event.data.preset }
```

Recording a different identity *is* the repair. No log rewriting, no header surgery, and the session
keeps every event it ever had — including the Auto selection, which is what actually happened.

This plugin listens on `session/created` with `{ prepend: true }`:

```ts
ctx.on('session/created', listener, { prepend: true })
```

The ordering is load-bearing rather than stylistic. `announce()` resolves its listener snapshot up
front and calls listeners in registration order, so a listener registered *after* the permission
service's runs after the service has already thrown. Prepended, it runs inside the same publication
boundary, before the refusal — and appending from a `session/created` listener is what the service
itself already does when it pins a fresh session.

The identity it records is chosen so that **no permission changes**:

1. the operator's configured `preset`, when the service can resolve it;
2. otherwise a configured preset whose sandbox mode and approval policy already equal the session's;
3. otherwise `custom` — the name the service's own `derive()` reports for those knobs, so the stored
   identity and the identity the picker computes agree instead of drifting apart.

No branch writes a knob. The sandbox mode and approval policy of the session are whatever they
already were; only the recorded name changes. `auto` is never recorded, even when the Auto bundle is
what the knobs match — that would seal the session again on the next open.

## Configuration

| key | default | meaning |
| --- | --- | --- |
| `mode` | `"repair"` | `"repair"` records the replacement identity. `"report"` only says what it would record, and leaves the shipped refusal in place. |
| `preset` | — | Force the identity to record. Ignored unless the service can resolve it. |
| `exempt` | `[]` | Session ids the guard must not touch. An id, or a `prefix*` glob. |

A bad value costs its own setting and nothing else, and says so on the warn channel: the guard exists
to keep a publication from failing, so it must not become a new way for one to fail. Every failure
inside the listener — an unwired projection registry, an unresolvable preset, a refused append — ends
as a warning, never as a lost session.

```yaml
- id: permission-restore-guard
  name: '@argszero/cordis-plugin-permission-restore-guard'
  config:
    mode: repair
    exempt: ['scratch-*']
```

## The tool

`permission_restore` covers the sessions the listener cannot reach. The listener only runs when a
session is opened, and a stranded session cannot be opened; the tool looks at the sessions that are
already live in this process.

| argument | meaning |
| --- | --- |
| `action` | `report` (the default) lists what it finds; `repair` records the identity; `auto` behaves as `repair` when the caller also confirmed. |
| `confirm` | Required for a repair. The write is durable and changes the session's recorded identity. |
| `session` | Limit the sweep to one session id. |

```
permission_restore { "action": "report" }

1 stranded session (stored preset "auto", no live Auto integration):
- session-14: would record "custom" (no configured preset matches these knobs, so the identity
  records exactly what the picker will report) — not written
Nothing but a `permission/preset` identity is written: the session keeps its sandbox mode and approval
policy, and its log keeps every event it had, including the Auto selection that could not be restored.
No session has needed this guard in this process yet.
```

`repair` without `confirm: true` is refused rather than performed. Whether the process may write at
all is still the mount's decision: a deployment mounted with `mode: "report"` never writes a session
log, and the tool's answer says so instead of reporting a repair that did not happen.

## What it does not do

- It does not re-register the Auto integration, and it does not restore what Auto did. A repaired
  session keeps the sandbox mode and approval policy it had; what it loses is the Auto *admission*
  hook, which is exactly the thing that cannot be restored without its integration.
- It does not touch a session that is not stranded, and it does not touch one that is not live. A
  stranded session that is on disk but not open is repaired when something opens it.
- It does not edit history. The Auto selection stays in the log; a later identity is appended.

## Traps this package is written against

- **Ordering.** A listener registered after the permission service's cannot prevent the throw. The
  suite measures both orderings through the shipped `install`, because asserting the prose cannot
  tell them apart.
- **`auto` is not a safe fallback.** `resolve('auto')` reports `danger-full-access` / `ask`, which is
  frequently what the stranded session's knobs *are* — so a knob-matching loop that did not skip the
  Auto name would record the identity that cannot be restored.
- **The tool's `action` is not the only gate.** A `report` call must not write even when the mount is
  in `repair` mode, and a `repair` call must not write when the mount is in `report` mode.

## Compatibility

The peers are the harness packages whose API this plugin is compiled against:

| package | range |
| --- | --- |
| `@deepseek-ai/cordis` | `^4.0.2` |
| `@deepseek-ai/dsh-permission-presets` | `>=0.1.7-alpha.1 <0.2.0 \|\| >=0.2.0-rc.1 <0.2.0 \|\| >=0.2.1-rc.1 <0.2.1` |
| `@deepseek-ai/dsh-session` | `>=0.1.7-alpha.1 <0.2.0 \|\| >=0.2.0-rc.1 <0.2.0 \|\| >=0.2.1-rc.1 <0.2.1` |
| `@deepseek-ai/dsh-session-projection` | `>=0.1.7-alpha.1 <0.2.0 \|\| >=0.2.0-rc.1 <0.2.0 \|\| >=0.2.1-rc.1 <0.2.1` |
| `@deepseek-ai/dsh-tools` | `>=0.1.7-alpha.1 <0.2.0 \|\| >=0.2.0-rc.1 <0.2.0 \|\| >=0.2.1-rc.1 <0.2.1` |

The range is a claim about versions, so it is measured rather than asserted: `npm run test:probe-lines`
pins **the whole line** — every `@deepseek-ai/dsh-*` package read from that line's own `dsh-agent`
manifest, plus the transitive requirements the published metadata omits — installs with
`--legacy-peer-deps`, reads every pinned version back, and only then runs the suite. The exact builds
verified are `0.1.7-alpha.1`, `0.1.7-rc.2`, `0.2.0-rc.2` and `0.2.1-rc.3` (`npm run test:probe-lines -- <build>`). A
line that fails there is removed from the range instead of left claimed. The `0.2.0` release line is
excluded deliberately: the projection state version is bumped per line and this plugin reads it, so the
next line is a claim nobody has run.

Two of those lines do not record the same identity, and that is the point of running the suite on all
three rather than one: the Auto preset's own bundle differs between them
(`danger-full-access`/`never` on one, `danger-full-access`/`ask` on another), so the preset a repair
can name is a different one. The plugin is correct on both; a suite that hard-coded either name would
have reported a working line as broken.

## Development

```sh
npm test                 # the suite, against the real harness services
npm run test:inject      # mutate one distinction at a time and require the suite to notice
npm run test:probe-lines # run the suite against each line the peer range admits
```

The suite mounts the real `dsh-session` store, the real projection registry and the real permission
service, because the refusal this plugin exists to prevent is produced by them. `ctx.shell` and
`ctx.approval` are the only stand-ins: the permission service only *reads* them, and mounting the real
ones would bring a subprocess executor and a sandbox provider into a suite about a durable identity
and a listener order.

## Licence

MIT
