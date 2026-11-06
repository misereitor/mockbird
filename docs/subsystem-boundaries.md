# Internal subsystem boundaries

Mockbird keeps six logical engines in one package. This is an ownership and
dependency contract, not a package split. The checked-in map is
`scripts/subsystem-map.json`; run `node scripts/check-subsystem-boundaries.mjs`
to validate paths, ownership, imports, allowed edges, and cycles.

| Engine | Responsibility | Owned inputs and outputs | Mapped modules |
| --- | --- | --- | --- |
| Design Engine | Plugin orchestration and project synchronization | OpenCode context and project files in; synchronized design assets and diagnostics out | `plugin/core.mjs` |
| Design System Engine | Token and design-system generation | Token source files in; generated token artifacts out | `skills/design/scripts/gen-tokens.mjs` |
| Validation Engine | Structural and contract validation | Design directory in; validation findings out | `skills/design/scripts/validate.mjs` |
| Visual QA Engine | Visual inspection and accessibility-oriented visual analysis | Rendered design inputs in; visual findings out | `skills/design/scripts/visual-critic.mjs` |
| Review Engine | Review orchestration and gate coordination | QA and agent results in; review decisions and reports out | `skills/design/scripts/visual-orchestrator.mjs` |
| Integration Engine | End-to-end mock runtime contract checks | Mock project fixtures in; integration pass/fail result out | `scripts/mock-check.mjs` |

## Dependency policy

Each mapped module currently has no direct import edge to another mapped
subsystem. Node built-ins, third-party packages, and unmapped support modules
are outside this graph. Any future cross-engine import must be added explicitly
to `allowedEdges`; the checker rejects all other mapped cross-engine imports and
rejects cycles.
