---
name: prepare-release
description: >-
  Cuts a Storyboard release from main: pull, version bump and sync, changelog
  cut and hidden-provider scan, (for a large change) comparison against the last
  release, release commit, preflight, tag, and checking the published release.
  Use when the user asks for a release, a version bump, a changelog cut, or a
  tag — including a session that just finished its own work and releases it.
---

# Prepare release (storyboard)

The rules behind these steps are `.claude/rules/release.md` (who releases, what the notes may say,
the release commit, a failing preflight) and `RELEASE.md` (the version commit, the tag, the GitHub
workflow). Do the steps in order and do not skip one because the change looks small.

## 1. Start from main

```bash
git switch main
git status --short            # must print nothing
git pull --ff-only
npm install                   # a new dependency breaks the build without it (0.16.0 added one)
git describe --tags --abbrev=0   # the last release, e.g. v0.16.1
git log --oneline <last>..HEAD
```

Read every commit in the range and both `[Unreleased]` sections. If the range holds a
work-format change, dozens of commits, a new runtime dependency, or a provider/transport change,
this is a **large release**: do step 4 as well.

## 2. Version

Agree the version with the maintainer (fixes only → patch; features or a format change → minor).
Then:

```bash
# edit "version" in the root package.json only
npm run version:sync
npm install
node scripts/sync-version.mjs --check
perl -0pi -e 's/## \[Unreleased\]\n/## [Unreleased]\n\n## [x.y.z] - YYYY-MM-DD\n/' CHANGELOG.md CHANGELOG.en.md
```

The date is the day the tag will be pushed (`date +%F`).

## 3. Read the notes as a stranger would

The new section ships as the public release notes. List the hidden provider ids from the catalog
and scan the section for them, for the phrases that give one away, and for personal data:

```bash
hidden=$(node -e '
const s=require("fs").readFileSync("packages/story-model/src/contracts/providerCatalog.ts","utf8");
const rows=[...s.matchAll(/\n  (?:\x27([a-z0-9-]+)\x27|([a-z0-9-]+)): \{/g)];
console.log(rows.filter((m,i)=>s.slice(m.index,(rows[i+1]?.index)??s.length).includes("isHidden: true")).map(m=>m[1]??m[2]).join("|"))')
for f in CHANGELOG.md CHANGELOG.en.md; do
  awk '/^## \[x\.y\.z\]/{p=1;next} /^## \[/{p=0} p' "$f" \
    | grep -nE "$hidden|구독|subscription|로그인 경로|login path|프로그램을 실행|runs a program|[0-9a-f]{32}|notion\.(so|site)/|/Users/|/home/[a-z]"
done   # must print nothing
```

A hit is fixed in both files before going on: drop the sentence or describe the effect for «some
providers». Also check that each entry says what a user sees, and that both languages say the
same thing.

## 4. Large release: compare with the last release

Only for a large release (step 1). The goal is to explain every difference between what users
have now and what this tag ships.

- Download the last release's CLI (`gh release download <last> -p 'storyboard-cli-*.tar.gz'`) and
  build HEAD (`npm run cli:build`; copy `apps/cli/dist/` whole — it carries the SQLite wasm).
- Run the same command list on both builds in fresh workspaces with `STORYBOARD_HOME` pointed at
  an empty directory (the machine's home config may enable providers users do not have):
  - with the `mock` provider, covering every noun's verbs;
  - with real providers pointed at a local fake server (`ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`)
    that logs request bodies and can answer with errors (429/401/500) and with truncated answers.
    Claude calls stream, so the fake server must answer `stream: true` with server-sent events.
- Compare stdout, stderr, exit codes, the work's files and the request bodies after masking
  timestamps, uuids, ports and the version. Every difference must trace to a changelog entry.
- Reproduce each «고침» entry on both builds, and open a work the last release wrote (and, after a
  format change, a work of the previous format: every verb must refuse it without writing).
- Keep the scripts in the scratchpad until the repository has a comparison script. A defect goes to
  the work session (`.claude/rules/release.md`, «Who releases»); the release waits.

## 5. Release commit

```bash
git add -A
git commit -F <message file>
```

Subject `chore(release): Cut x.y.z`; body in the four Korean labels, ending with
`Signed-off-by: Maroomir Yoon <maroomir@gmail.com>` and nothing after it — no `Co-Authored-By`,
no `Claude-Session`. `[Checking Method]` names only what was run, with its result.

## 6. Preflight (mandatory, on the release commit)

```bash
env -u ELECTRON_RUN_AS_NODE npm run release:preflight > preflight.log 2>&1; echo "exit=$?"
grep -aE "Tests +[0-9]+ (passed|failed)|passed, [0-9]+ failed|identical|differing|Smoke passed|Preflight passed|FAIL" preflight.log
```

Do not tag until it prints `Preflight passed for vx.y.z`. On a failure, read it first (rules,
«When the preflight fails»); never tag on a failed run. If the release commit has to change, amend
it and run the preflight again.

## 7. Tag and push

```bash
git tag -a vx.y.z -m "vx.y.z"
git push origin main
git push origin vx.y.z
```

## 8. Watch the workflow

```bash
gh run list -L 3 --json databaseId,workflowName,headBranch
gh run watch <release run id> --exit-status
gh run view <release run id> --json status,conclusion,jobs \
  --jq '"\(.status) \(.conclusion)", (.jobs[]|"\(.name) \(.conclusion)")'
```

`gh run watch` can return before the run ends; trust `gh run view` — `completed success` with
`verify`, `bvt` and `publish` all `success`. Check the CI run for the same commit as well.

## 9. Check what was published

```bash
gh release view vx.y.z --json isDraft,url,assets \
  --jq '"draft=\(.isDraft) \(.url)", (.assets[]|.name)'
gh release view vx.y.z --json body --jq .body | grep -ciE "$hidden|구독|subscription|/Users/"
```

Expect `draft=false`, the four assets (`install.sh`, `SHA256SUMS`, `storyboard-cli-x.y.z.tar.gz`,
`storyboard-vscode-x.y.z.vsix`) and a count of 0. Then download the CLI into an empty directory,
`shasum -a 256 -c SHA256SUMS --ignore-missing`, and run `--version`, `init`, `setup --provider
mock` and `novel generate` with it.

## Final response

The version and release URL; what shipped (one line per change); what was checked and the
results (preflight numbers, workflow jobs, assets, the published CLI run); anything changed in the
release commit beyond the version (for example a changelog sentence removed in step 3); and what
was not checked.
