# v1.5.0 Release Scope

Current distribution: **1.5.0-r1**, application version unchanged. The original v1.5.0 release is historical. See [r1 verification](../docs/RELEASE_1_5_0_R1_VERIFICATION.md) for the current verification record.

## Versions and downloads

- Plugin: 1.5.0; exporter: 1.5.0; API schema: 3.
- Grafana compatibility floor: 11.6.7; runtime checks performed on 11.6.7 and 12.4.0.
- Exporter Python compatibility floor: 3.9; packaged portable validation passed on Python 3.9.25.
- [Release downloads](https://github.com/alpaslancetin/grafana-anomaly-detector/releases/tag/v1.5.0-r1).
- [Installation and upgrade guide](GRAFANA_ANOMALY_DETECTOR_E2E_KURULUM_UPGRADE_KILAVUZU_v1.5.0_TR.md).

## Completed and verified

Direction-aware decisions (high_mean, low_mean, high_or_low), absolute/relative floors, activity gate, N-of-M persistence, recovery hysteresis, cooldown, and separate data-health states share the TypeScript/Python scoring contract.

Exporter transport includes root/base-path aliases, JSON errors, capability negotiation, atomic state with backup and process locking, idempotent registration, scoped revisions, explicit unregister, runtime-scope expiry, and configurable security/request limits.

Verification recorded for this release: 30 panel unit tests, 42 exporter tests, TypeScript typecheck/build/lint, 2,001 parity cases, a 36 source-target matrix, and Python 3.9.25 portable validation. These checks are not a claim of every production workload or chart interaction being covered.

Saved registrations allow exporter recomputation with the browser closed. This requires reachable sources, valid credentials, retained state, and a running exporter. Panel preview snapshots alone are not a 24/7 alerting guarantee.

## Chart and visibility scope

The chart is a custom SVG renderer, not the native Grafana Time Series/uPlot panel. It has expected bands, severity markers, incident navigation, pinned hover, legend isolate/toggle/show/hide, searchable/sortable scrollable series, and container-based responsive layout.

Visible sections can hide individual UI blocks. Hiding Score feed status does not stop publishing; Score feed mode controls publishing. Legend visibility is display-only and must not change exporter scoring.

Still incomplete: multi-unit/left-right axes, full FieldConfig display semantics, log/symlog, drag zoom/pan/reset and dashboard-range integration, shared cross-panel cursor, Shift-range legend selection, complete legend calculations, and virtualized large-series rendering. Hidden-series consistency across all incident summaries still needs coverage.

The r1 revision fixes delayed chart mounting, compact chart-only sizing and time-axis overlap. Very small 240x160 layouts, all visibility combinations, 80-200 percent browser zoom, and comprehensive pixel/geometry regression are not fully qualified. Native Grafana Time Series feature parity is not claimed.

## Production qualification still required

- Plugin signing: the distributed plugin is unsigned and requires an explicit Grafana allow-list entry or a separately signed build.
- Real labeled 30-60 day field-data backtesting and operator acceptance.
- Long-duration soak, the full concurrent-browser load matrix, and production notification delivery/authz validation.
- SBOM/dependency vulnerability review and organization-specific security acceptance.
- Field-specific deterministic availability/pool-state alerts and traffic-aware gap-count validation.
- Production canary/rollback execution. A documented runbook is not evidence that it was executed in production.

Champion/challenger tuning, operator feedback, configuration-drift UI, and expanded cross-signal correlation remain roadmap work. The entire master-analysis Definition of Done is not claimed complete.
