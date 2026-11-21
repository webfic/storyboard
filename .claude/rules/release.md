# Release (versioned cuts)

When preparing a Storyboard release (version bump, changelog, the extension/CLI artifacts, tag):

1. Follow the **`prepare-release`** skill (`.claude/skills/prepare-release/SKILL.md`).
2. Match the repo-root **`RELEASE.md`** for the version commit contents, tag shape (`v` + semver), and GitHub Release workflow.

## Who releases

- **A routine release** is cut by the session that finished the work, on `main` after that work
  has landed, following the `prepare-release` skill from its first step.
- **A release after a large change** (a work-format change, dozens of commits, a new runtime
  dependency, a provider or transport change) adds the comparison against the last release that
  the skill's «Large release» step describes. The maintainer may hand it to a release session.
- A release session does not fix code. A defect it finds is written up for the work session (what
  happens, how to reproduce it, where the cause probably is, what should happen, how to test it)
  and the release waits for the fix, unless the maintainer says to ship it as a known issue.

## Release notes and public text

- **The changelogs never reveal a hidden provider.** A hidden provider is a catalog row with
  `isHidden` (`.claude/rules/coding-standards.md`, «Hidden providers»). Its id, its config keys,
  its login path and its model list must not be named, nor anything that tells a reader it exists
  — a sentence such as «a provider that runs a program» or «the subscription login» gives it away
  as surely as its id. Describe the effect for «some providers», or leave the sentence out. A
  change that concerns only a hidden provider gets no entry, or only its effect.
- Entries stay vague about how a hidden path works: write what a user sees, not the mechanism.
- No personal data in the changelogs or the release notes (`.claude/rules/public-posts.md`).
- **The section date is the day the tag is pushed.** When a cut waited past midnight (a fix, a
  re-run), correct `## [x.y.z] - YYYY-MM-DD` in both files and amend the release commit before
  tagging.

## Release commit

- Subject `chore(release): Cut x.y.z`, the Korean four-label body (`agent-workflow.md`), and the
  `Signed-off-by` trailer only. No `Co-Authored-By` and no `Claude-Session` trailer, even when the
  harness suggests one.
- `[Checking Method]` states what was actually run and its result; it never claims a check that
  did not run.

## When the preflight fails

- Read the failure before running again. Re-running until it turns green hides a defect.
- A test that fails only under load: run that file alone several times. If it passes alone, it is
  a timing defect in the test — record it, hand it to the work session, and do not tag on a failed
  preflight. The tag waits for a preflight that passes on the release commit.

## Version and changelogs

The version lives in the **root `package.json`**; `npm run version:sync` mirrors it into `apps/vscode`, `apps/cli` and the version the CLI prints, and `node scripts/sync-version.mjs --check` is what the release workflow enforces. Run `npm install` afterwards so the root `package-lock.json` follows. One `v*` tag ships every app: the VSIX and the CLI tarball. **`CHANGELOG.md`** and **`CHANGELOG.en.md`** stay the source of the release notes — update both in the same change.

## Build verification test (BVT)

`npm run bvt` is the gate between the source checks and the jobs that build what ships: the
release workflow runs it as the `bvt` job after `verify`, and a tag that fails it stays a draft
with nothing uploaded. Run it locally before tagging. The code lives in `scripts/bvt/`, the data
in `bvt/`, and each step is also its own script:

- `bvt:contracts` — **diff contracts** (`scripts/bvt/diffContracts.mjs`): a change that has a
  mandatory companion must carry it in the same range — source ↔ both changelogs, a prompt
  resource ↔ its generated module, a params file ↔ its sibling schema and its coding-standards row,
  the config schema ↔ a settings test, `.claude/rules` ↔ `.cursor/rules`, a
  root version bump ↔ its `## [version]` section. The range is the newest `v*` tag that is an
  ancestor of HEAD (not HEAD itself) up to HEAD; pass another base ref as the first argument.
  Adding a rule is a row in `diffContractRules` plus a case in `apps/cli/test/bvtDiffContracts.test.ts`.
- `bvt:impact` — **impact map** (`bvt/impactMap.json`, `scripts/bvt/runImpactMap.mjs`): every
  changed file in the range is matched against `ignore`, then against the areas in order, and the
  first area whose `paths` match owns it; the checks of every touched area run once each (test runs
  of one workspace are merged into one vitest start), with `STORYBOARD_HOME` pointed at an empty
  directory so the machine's config cannot change the answer. **A file no row claims fails the
  run** (a deleted one is only counted, since its row went with it), and `apps/cli/test/bvtImpactMap.test.ts` fails as soon as a tracked file has no row, so a
  new folder gets its row before it ships. `--plan` prints the checks without running them. An
  area's checks are the focused tests of what it changes plus what `verify` does not run: the
  bundles, the prompt-resource check, the workflow YAML parse.
- `bvt:golden` — **golden workspaces** (`bvt/golden/scenarios.json`, `scripts/bvt/runGolden.mjs`):
  the built CLI drives each scenario with the `mock` provider (deterministic, free) and every
  file the work would commit is compared with the snapshot under `bvt/golden/<id>/`, after both
  sides mask what is minted per run (timestamps, uuids, content hashes, the version string). A
  `fresh` scenario runs `init` → `setup` → `novel generate` → `manuscript export` → `status`; a
  `reopen` scenario copies a **frozen** workspace an earlier release wrote (`bvt/golden/frozen/`,
  never rewritten by `--update`) and runs the reading and assembling verbs on it plus
  `draft generate --all`, which must generate nothing (the git-ignored cache is absent, so the
  committed story-state ledger is what says each draft is current), so the candidate proves it
  still opens what is on a writer's disk unchanged. An intended format change is
  approved by `npm run bvt:golden -- --update` and the snapshot diff in the same commit; a new
  frozen workspace is a copy of a fresh snapshot's `workspace/` made at a release and a `reopen`
  row pointing at it.
  A frozen workspace is retired only by a release that breaks the format on purpose and says so
  in both changelogs: 0.16.0 has no conversion (a 0.15 work is refused as «0.15 형식»), so
  `reopen-0.12.2` was retired and the frozen line starts again at `frozen/0.16.0-linear`.
- `bvt:smoke` — **artifact smoke** (`scripts/bvt/smoke.sh`, local wrapper `smokeRelease.sh`): the
  VSIX, the CLI tarball and `install.sh` are packaged by `scripts/package-release.sh` (the same
  script `publish` uses) and then *used*: `install.sh --from` installs the tarball into a scratch
  prefix, the installed `storyboard` prints the version and drives a mock work through
  `novel generate`, `draft show`, `scene create`, `status --json` (stdout must parse as a JSON
  result) and `manuscript export`; the VSIX is unzipped and its manifest version, `main`, webview
  page and changelog checked and the bundle parsed.

`npm run bvt` runs the four in that order.

## Preflight before the tag

**An agent never creates a release tag without `npm run release:preflight` passing on that commit.**
`scripts/release-preflight.sh` runs what the tag would set off, minus the upload: the tree must be
committed and on `main`, the version synced and untagged, both changelogs carrying a dated,
non-empty `## [<version>]` section; then lint, the tests and `npm run bvt`. A tag that fails on
GitHub is then the exception.
