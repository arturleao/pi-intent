# Contributing

Guidance for humans and agents working in this repo.

## Project

npm workspace with two published packages, released together at one version:

| Package | Path |
| --- | --- |
| `@arturleao/iced-core` | `packages/iced-core` (host-neutral library + spec) |
| `@arturleao/pi-intent` | `packages/pi-intent` (pi extension, depends on iced-core) |

The root `package.json` is private and never published. ESM, no build step.

Checks:

```
npm ci
npm test              # node --test in every workspace
npm run pack:check    # npm pack --dry-run for both packages
```

Run `npm test` before every commit.

## Commits: Conventional Commits 1.0.0

Every commit on `dev` and `main` (including merge and squash commits, and PR titles) uses this format:

```
<type>[optional scope][!]: <description>

[optional body]

[optional footer(s)]
```

Rules:

- Description: imperative mood, lowercase start, no trailing period, at most 72 characters on the subject line.
- Scope is optional; use the affected area: `core`, `verify`, `guard`, `init`, `gate`, `runner`, `picker`, `extension`, `spec`, `docs`, `deps`, `release`.
- Breaking change: `!` after type/scope and/or a `BREAKING CHANGE: <what changed and migration>` footer.
- One logical change per commit.

| Type | Use for | Release effect |
| --- | --- | --- |
| `feat` | new user-facing capability | MINOR |
| `fix` | bug fix | PATCH |
| `perf` | performance improvement | PATCH |
| `refactor` | code change, no behavior change | none |
| `docs` | documentation only | none |
| `test` | tests only | none |
| `build` | packaging, `package.json` files/exports | none |
| `ci` | CI config and workflows | none |
| `chore` | maintenance, deps, tooling, ICED records | none |
| `revert` | reverts a previous commit | matches reverted |

Examples:

```
feat(verify): pass full check output to verifiers
fix(gate): block inline code in verifier shell commands
docs(spec): clarify contract hash scope
feat(core)!: rename `verify.commands` to `verify.checks`

BREAKING CHANGE: rename `verify.commands` to `verify.checks` in .iced/config.json.
```

## Versioning: Semantic Versioning 2.0.0

Both packages always carry the same `MAJOR.MINOR.PATCH`; `pi-intent` depends on `^` that version of `iced-core`.

- MAJOR: incompatible changes to the unit format, config schema, library exports, or extension commands/tools.
- MINOR: backwards-compatible features.
- PATCH: backwards-compatible fixes and internal changes.

Pre-1.0.0 (current `0.x`): breaking changes bump MINOR (`0.1.0` to `0.2.0`); fixes and features bump PATCH.

Never edit `version` by hand in a feature commit; bumps go in their own release commit.

## Branches and releasing

- `dev` is the default branch: all work lands there (directly or through PRs into `dev`).
- `main` is the release branch: merging `dev` into `main` releases. Do not commit to `main` directly.
- Merge `dev` into `main` with a merge commit (not squash) so every commit type counts for the version bump.

Every push to `main` runs `.github/workflows/publish.yml`:

1. `npm test`.
2. `node scripts/release.mjs auto`: derives the bump from the commits since the last tag using the type table and versioning rules above. Only `feat`, `fix`, `perf`, `revert` and breaking commits release; a merge with only `docs`, `ci`, `chore` and the like publishes nothing.
3. When something is releasable: commits `chore(release): vX.Y.Z` (both package versions, the iced-core range in pi-intent, `package-lock.json`), tags `vX.Y.Z`, pushes both to `main`, publishes `iced-core` then `pi-intent` through npm trusted publishing (OIDC, no token, with provenance), skipping any version already on npm, creates a GitHub release with generated notes, and syncs `dev` with `main` (fast-forward, else a merge; a conflict is reported as a workflow warning to fix by hand).

Re-running the workflow is safe: it publishes whatever version `main` carries that npm lacks. Preview the next version locally on a clean tree with `node scripts/release.mjs auto --dry-run`. `npm run release -- <major|minor|patch|X.Y.Z>` on `main` remains for an explicit version; push it with `git push --follow-tags`.

Never `npm publish` by hand. No npm token is stored anywhere; each package has a trusted publisher on npmjs.com pointing at this repo and `publish.yml`.

## CI

`.github/workflows/ci.yml` runs on pushes to `dev` and `main` and on pull requests: `npm ci && npm test` on Linux and Windows, Node 22 and 24, plus a gitleaks scan of the full history. Keep it green.

## Repository hygiene: no local or private information

This repo is public. Never write host-, user-, or employer-specific detail into code, comments, docs, ICED unit records (`intent/`, `.iced/`), commit messages, issues, or test fixtures.

Never commit:

- tokens, API keys, OAuth credentials, cookies, `.npmrc` auth lines, session files, or anything from `~/.pi/agent/`;
- account names, emails beyond the package author, usernames, org/tenant names, private repo or project names;
- absolute local paths (`D:\...`, `C:\Users\<name>\...`, `/home/<name>/...`), machine names, IPs;
- verbatim logs, session transcripts, or stack traces containing any of the above.

ICED records are written by agents from real sessions: review `intent/<id>/` (iced.md, evidence.md, verify.json) before committing and redact paths and names. Use placeholders (`<account>`, `/path/to/project`, "a local checkout") in examples. `.pi/` is git-ignored because it holds local pi project config.
