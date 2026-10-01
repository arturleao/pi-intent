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

Every commit on `main` (including merge and squash commits) uses this format:

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

## Releasing

1. Derive the next version from commit types since the last tag: `git log $(git describe --tags --abbrev=0)..HEAD --oneline`.
2. `npm run release -- <major|minor|patch|X.Y.Z>` on a clean `main`. It bumps both packages, updates the iced-core range in pi-intent and `package-lock.json`, runs `npm test`, commits `chore(release): vX.Y.Z` and creates the annotated tag `vX.Y.Z`.
3. `git push --follow-tags`.

The `v*` tag triggers `.github/workflows/publish.yml`: `npm test`, checks the tag equals both package versions, publishes `iced-core` then `pi-intent` through npm trusted publishing (OIDC, no token, with provenance), skipping any version already on npm, and creates a GitHub release with generated notes.

Never `npm publish` by hand. No npm token is stored anywhere; each package has a trusted publisher on npmjs.com pointing at this repo and `publish.yml`.

## CI

`.github/workflows/ci.yml` runs on pushes to `main` and pull requests: `npm ci && npm test` on Linux and Windows, Node 20 and 22, plus a gitleaks scan of the full history. Keep it green.

## Repository hygiene: no local or private information

This repo is public. Never write host-, user-, or employer-specific detail into code, comments, docs, ICED unit records (`intent/`, `.iced/`), commit messages, issues, or test fixtures.

Never commit:

- tokens, API keys, OAuth credentials, cookies, `.npmrc` auth lines, session files, or anything from `~/.pi/agent/`;
- account names, emails beyond the package author, usernames, org/tenant names, private repo or project names;
- absolute local paths (`D:\...`, `C:\Users\<name>\...`, `/home/<name>/...`), machine names, IPs;
- verbatim logs, session transcripts, or stack traces containing any of the above.

ICED records are written by agents from real sessions: review `intent/<id>/` (iced.md, evidence.md, verify.json) before committing and redact paths and names. Use placeholders (`<account>`, `/path/to/project`, "a local checkout") in examples. `.pi/` is git-ignored because it holds local pi project config.
