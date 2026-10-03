# Toolchain

| Program | How to install | Why here | Source |
| --- | --- | --- | --- |
| node | nodejs.org | Run the action, tests, and the bundle | https://nodejs.org/ |
| npm | bundled with node | Install packages and run CI | https://github.com/npm/cli |

| Package | Where | Source | Why here |
| --- | --- | --- | --- |
| @actions/core | local | https://github.com/actions/toolkit | Action inputs, outputs, and the step summary |
| @actions/github | local | https://github.com/actions/toolkit | GitHub API client used by the action |
| @octokit/plugin-retry | local | https://github.com/octokit/plugin-retry.js | Retry transient GitHub API failures |
| typescript | local | https://github.com/microsoft/TypeScript | Typecheck |
| vitest | local | https://github.com/vitest-dev/vitest | Unit and integration tests |
| esbuild | local | https://github.com/evanw/esbuild | Bundle `dist/index.js` |
| eslint | local | https://github.com/eslint/eslint | Lint |
| typescript-eslint | local | https://github.com/typescript-eslint/typescript-eslint | TypeScript lint rules |
| msw | local | https://github.com/mswjs/msw | Fake GitHub API in tests |
| @types/node | local | https://github.com/DefinitelyTyped/DefinitelyTyped | Node types |
