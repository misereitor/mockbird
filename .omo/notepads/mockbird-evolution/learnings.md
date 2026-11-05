
## Task 54 final repair
Revert returned 500 because its mounted validation pipeline omitted `--mark-stale`; unresolved open pins made validate exit 1, rollback restored the pre-revert marker. Passing `--mark-stale` makes the intended stale-pin writer explicit and allows backup/revert retention to pass 19/19.

- Task 36 repair: sync-check and regression test now pass; inventory clean.

- Final repair: checks and regression test exit 0.
- Task 51: role routing keeps designer, critic-vision, reviewer cascades and defaults to deterministic stub.

- Task 51 repair: routing/mode fixture and benchmark connector integration added.

- Task 50: kill-switch, masking, budgets and cost controls implemented with offline tests.

- Task 31 repair: benchmark experiment flag and controlled fixture verified.

- Task 47: executable done-check validates approval hash, report freshness, blockers and generated specs.

- Task 47 repair: done-check fixtures cover valid, missing approval, and edited hash divergence.

- Task 47 final repair: explicit stale gitSHA and critic blocker tests pass with all done-check tests.

- Task 39: golden corpus check wired with manifest hashes and score records.

- Task 39 repair: golden check uses actual example screen paths and design output location.

- Task 39 final repair: mutation regression and verifier tests added; clean check passes.

- Task 58: service persistence helper provides atomic stores, audit events, backup retention and restore validation.

- Task 40: visual bisect helper added with temporary workspace cleanup and structured output.

- Task 40 repair: no-regression and evolution DEC correlation paths added.

- Task 40 final: genuine temp git three-commit regression fixture names middle SHA and DEC, no-regression and workspace preservation pass.

- Task 60: CLI facade delegates existing scripts and provides help/status/version.

- Task 60 repair: MIRROR, README and delegation coverage added.

- Task 55: users store helper covers atomic persistence, bootstrap admin, 72h invite hash and activation, roles and disabled persistence.

- Task 55 repair: role API/admin surface and activation password policy added.

- Task 55 harness repair: mounted copy-list includes users and persistence modules; stale viewer serve processes terminated.

- Task 55 final harness repair: serve user-store import supports mounted and normal layouts.

- Task 56: centralized authorization matrix and 40+ table-driven cases added.

- Task 56 repair: integrated service role middleware, CSRF/session write gate and route matrix coverage.

- Task 56 final surface repair: authenticated legacy editor headers bypass only API guard for GET comments, while role matrix and write CSRF remain enforced.

- Task 62: manual service PT-BR documents implemented commands, roles, security and operations.

- Task 62 repair: sync-check and clean service startup/admin bootstrap probes passed.

- Task 59: service CSP and threat model documented; existing sandbox/share/rate-limit controls preserved.

- Task 59 repair: HSTS is now testable behind HTTPS/reverse proxy and absent on local HTTP.

- Task 49: embedded design-run loop added with stub connector and pending approval report.

- Task 49 repair: valid brief fixture, npm wiring, six-phase cycle evidence and pending approval report added.

- Task 49 final repair: connector invocation fixed and happy/contradiction/4-cycle tests pass.

- Task 42: maturity scorecard added with six artifact metrics, history and docs output.

- Task 42 repair: deterministic rerun and contract-test mutation probes now pass.

- Task 44: old consumer fixtures and compatibility checker added.

- Task 44 repair: CI compat wiring and corrupted consumer mutation test added.

- Task 57: viewer collaboration notice and comment author metadata added.

- Task 57 repair: actual comment status route enforces author/editor/admin and activity history helper reads approvals/evolution.

- Task 57 final repair: activity API exposed and comment status route preserves role enforcement with legacy harness compatibility.

- Task 57 compatibility repair: legacy demo comments retain write compatibility with attributed editor identity.

- Task 57 final runtime repair: comment handler receives request explicitly, eliminating declared-write/XSS POST 500s.

- Task 46: blind experiment labels, deterministic seed order, vote gate and DEC winner added.

- Task 46 repair: deterministic kit vote acceptance and service anonymous vote rejection added.

- Task 52: offline connector guarantee, provider fallback tests and CI secret scan added.

- Task 52 repair: explicit test glob and practical secret scan exclusions fixed all offline gates.

- Task 52 final repair: injected fake-secret mutation probe now passes with named file and cleanup.

- Final-wave repair: exploration pilots now consume existing color tokens; audit totals/coverage and doc SHA anchors refreshed, all CI/doc checks green.

- Root verification rerun: exact npm run ci now exits 0; visual-gate contract ok and 0 failures, all three docs checks exit 0. Root log preserved warnings as non-blocking.

- F3 repair: done-check now safely handles nested screen IDs; approval downgrade and focused tests pass. Service bootstrap login remains blocked by create-admin producing null password hash; no false approval claimed.

- F3 service repair: --create-admin now requires a 12+ character password via --admin-password or MOCKBIRD_ADMIN_PASSWORD and stores only scrypt hash; auth bootstrap test and real HTTP login pass.
