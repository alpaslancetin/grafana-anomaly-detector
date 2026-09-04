# 1.5.0-r1 release verification

Date: 2026-09-04. Application versions remain plugin/exporter **1.5.0**, API schema **3**.
The separate **1.5.0-r1** package revision identifies the post-release fixes.
Original v1.5.0 release assets/tag are not rewritten.

## Source verification

| Check | Result |
| --- | --- |
| Plugin Jest | 35/35 |
| TypeScript | PASS after removing the unused resize-ref import |
| ESLint | 0 errors, 3 existing TimeZone deprecation warnings |
| Exporter Python 3.12 image | 44/44 |
| Exporter Python 3.9.25 | 44/44, including default/sample YAML loading |
| TS/Python parity | 3,801 points, no mismatch; score-10 and zero-baseline checks passed |
| Grafana 12.4.0 browser suite | 19 passed, 1 skipped; authentication included |
| Demo pulse replay | 18/18, PyYAML-enabled Linux environment |
| HTTPS proxy contract | 19 checks in each prefix-preserving/prefix-stripping mode, recorded in the preceding proxy verification |

The browser suite covers six source/target UI paths and compact/view/edit/solo
resizing. The newly added 320x200, 400x260, 600x320 and 1200x700 chart-only test
checks SVG size equality, viewport overflow and time-label/caption separation.
Screenshots were inspected. These are not native Grafana Time Series feature-parity
claims. Deterministic incident frames test buttons/inspection, not source accuracy.

The TestData case is skipped because that dashboard is not installed in this demo
stack. Current lower-version coverage remains the previously recorded Grafana
11.6.7 smoke; the full r1 browser matrix was run on 12.4.0 only.

## Quality limits (not hidden)

The strict synthetic detection gate **FAILS** on known precision/F1 and hard-seasonal
recall criteria. This revision does not tune algorithms merely to pass one corpus.
The historical regression run also failed the 10k points/s performance floor in
this publication session (Linux clear level_shift approximately 8.5k points/s).
Other runs on this same checkout previously passed; host contention is a possible
explanation, not a proven exemption. Dedicated capacity qualification remains open.

Windows replay initially lacked PyYAML for the full demo config; the same replay
passed all 18 cases in the configured Linux image. This is distinguished from the
packaged minimal YAML examples, which passed loading even on the Python 3.9 image.

No 24-hour soak, real LB/authz acceptance, notification delivery, full cross-source
failure matrix, or real labeled field corpus is claimed in this publication pass.
This is a maintained bug-fix package, **not unconditional production approval**.

## Distribution safety

- Versioned ZIP names for both components; stable plugin installation ID.
- BUILD_INFO.json: source commit, package revision, per-file SHA-256 manifest.
- SHA256SUMS_v1.5.0-r1.txt verifies the ZIPs; original release checksums remain historical.
- Exporter includes config.yml and separate Prometheus/InfluxDB examples; secrets
  are environment references/placeholders, not a copied operator config.
- Dynamic distribution state is empty; runtime registry, local QA reports, auth
  sessions, temporary TLS keys, caches and node_modules are not packaged.
- RHEL support files are now source-controlled instead of existing only inside
  a ZIP. The installer preserves existing exporter.env on upgrade and installs
  YAML samples separately. RHEL systemd installation was not executed on this
  Windows/Linux-container host; shell validation is not a live RHEL acceptance test.
- Local test registry was backed up and restored with matching SHA-256. Runtime
  TTL expiry after service restart is normal and is not disabled for the test.

## Reproduce

Use the plugin npm scripts for unit/type/lint/build tests. Run exporter unittest
discovery from its source directory. Run parity and demo scripts from the repo root
with Node dependencies and PyYAML available. Browser tests require the local demo
stack and an authorized test account; never run mutation tests on production.

After committing the tested source and building the plugin:

```bash
python scripts/build_release.py --revision 1.5.0-r1
cd release
sha256sum -c SHA256SUMS_v1.5.0-r1.txt
```

The build script checks application-version alignment, emits normalized LF text
and Unix executable bits for shell scripts, and verifies archive member hashes.
