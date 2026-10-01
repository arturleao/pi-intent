# ICED for pi

**ICED** = **Intent, Context, Expectations, Done**. You say what you want in one line, answer a few
questions, sign off on what "done" means, and the agent builds it on its own. Independent verifiers then
try to prove the work is broken before you accept it.

| Package | What |
|---|---|
| [`@arturleao/pi-intent`](packages/pi-intent) | the [pi](https://pi.dev) extension: `/iced`, the `iced_*` tools, the gate, pi verifiers. **Start here.** |
| [`@arturleao/iced-core`](packages/iced-core) | host-neutral core library and the spec: units, contract, lint, lifecycle, verification with an injected agent |

```powershell
pi install npm:@arturleao/pi-intent
```

## Development

```powershell
npm install            # links the workspaces (pi host packages are not installed; pi provides them)
npm test               # both packages, node:test, no dependencies
npm run pack:check     # what each package would publish
```

The root `package.json` is a private workspace root whose `pi` manifest points at
`packages/pi-intent/extensions/iced/index.ts`, so pi can load the extension straight from a checkout:
`pi install <path to this repo>`, then `/reload` after changes.

Releasing: work lands on `dev`; merging `dev` into `main` releases. The publish workflow derives the version
from Conventional Commits, tags it, publishes both packages (one shared version) to npm with trusted publishing
and provenance, and creates the GitHub release. Commit conventions, versioning and repo hygiene rules: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
