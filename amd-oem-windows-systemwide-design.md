# AMD Windows OEM Requirements (Source-Verified)

## Date

February 7, 2026

## Source Inputs

- `email.md`
- `transcript.md`

## Concrete Problems AMD Reported

1. **Sysprep/OOBE breaks first-run state**

- After Audit Mode install + `sysprep /generalize`, new users hit **Get Started** again.
- Initialization done by Audit Mode admin is not recognized for new users.

2. **System-wide install behavior is required**

- AMD needs install behavior that is not tied to one user profile.
- They need all-users behavior for OEM imaging flow.

3. **Shared machine-level model location is required**

- Models are preloaded in factory image.
- New users must use them without manual copy/move or re-download.

4. **Per-user defaults must propagate automatically**

- New users created post-sysprep must inherit usable config.
- Manual reconfiguration is not acceptable for validation/production.

5. **Base path permission constraints are part of the issue**

- Program Files write permissions caused failures.
- Default User path attempt still failed due to user-bound state.

6. **Launcher/re-init behavior is part of the same breakage**

- AMD explicitly called out returning to launcher/re-init behavior in this flow.

7. **OEM CLI/installer controls are required**

- AMD requested flags for install path, update behavior, and pre-seeded config.

8. **Windows update rollout control is required**

- AMD needs ability to disable auto-updates by default for managed rollout.

## AMD Requirements Verification (Reconciled From Two Independent Audits)

Status key: `Met`, `Partially met`, `Not met`, `Unknown`

| Requirement                                           | Status          | Confidence | Notes                                                                                                                                                                     |
| ----------------------------------------------------- | --------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| System-wide install for OEM imaging                   | `Partially met` | `Medium`   | Installer supports machine scope (`/INSTALL_SCOPE`, `/ALLUSERS`, `/OEM`) and persists machine config, but behavior still depends on OEM invoking machine scope correctly. |
| Sysprep/OOBE new user should not re-enter Get Started | `Partially met` | `Medium`   | Machine config hydration for missing user config is implemented, but no explicit launcher/Get Started UI gate change is present in this branch.                           |
| Per-user config propagation for future users          | `Met`           | `Medium`   | Machine-scoped config is reused for new users and optional preseed import is implemented.                                                                                 |
| Machine-level shared model config/path                | `Partially met` | `Medium`   | Shared ProgramData model config path is implemented, but model artifacts still need to be pre-placed in that shared location by OEM workflow.                             |
| Avoid model re-download/manual copy after sysprep     | `Partially met` | `Medium`   | Pathing/config supports this goal; actual avoidance of re-download depends on image payload placement and sysprep validation results.                                     |
| Installer/CLI controls (base path, update, preseed)   | `Met`           | `High`     | Required flags are implemented and persisted in machine config.                                                                                                           |
| Central auto-update disable for managed rollout       | `Met`           | `High`     | Auto-update disable is seedable by installer and propagated on first launch. Caveat: this is defaulting behavior, not a hard policy lock.                                 |
| Program Files vs writable data location handling      | `Partially met` | `Medium`   | Design steers data writes to ProgramData with ACL hardening; direct Program Files write model is not used.                                                                |
| Launcher/re-init behavior specifically                | `Unknown`       | `Low`      | Indirectly addressed by state hydration, but no direct launcher-specific code path was identified in this branch.                                                         |

## Evidence Pointers (Source Docs)

- System-wide + per-user + shared models are top priorities:
  - `email.md:31-47`
  - `transcript.md:205-213`
- Get Started / user-bound state after sysprep:
  - `email.md:33-39`
  - `transcript.md:40-47`
- Program Files permission pain:
  - `email.md:49-55`
  - `transcript.md:46-47`
- Shared models requirement:
  - `email.md:57-64`
  - `transcript.md:22-24`
- Launcher behavior mention:
  - `email.md:85-90`
  - `transcript.md:241-246`
- CLI/installer control request:
  - `email.md:17-21`
  - `email.md:120-127`
  - `transcript.md:173-185`
- Auto-update control request:
  - `email.md:66-75`
  - `transcript.md:104-110`

## Scope Note

This list is intentionally Windows-focused for OEM launch readiness and excludes Linux packaging/security items.
