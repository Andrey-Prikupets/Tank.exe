# Project Rules

## 1. Functional Specification Maintenance

- **Always update the functional specification (`docs/functional_spec.md`) on each commit if there were functional changes.**
- Any additions, alterations, or removals of game mechanics, controls, UI components, versioning/deployment flows, or system behavior must be reflected in `docs/functional_spec.md` before committing.

## 2. GitHub Actions Run Status Check

- **Always use `.\check-run.cmd` when checking GitHub Actions run status.**
- Do NOT run parameterized commands like `gh run view <id>` or `gh run view <id> --job <job_id>` directly, as dynamic IDs require individual manual approval each time.
- `.\check-run.cmd` takes no parameters, automatically targets the latest run, and prints its status, conclusion, start timestamp, and job details.

## 3. Project Build Command

- **Always use `.\build.cmd` when building the project.**
- Do NOT execute direct node or npm build commands directly.

## 4. Preview and Dev Server Commands

- **Always use `.\preview.cmd` when starting the Vite preview server.**
- **Always use `.\dev.cmd` when starting the Vite dev server.**
- Do NOT execute direct `npm` or `node` preview/dev commands directly.

## 5. Adding Node Dependencies

- **Always update `package.json` directly and use `npm install`.**
- Do NOT run parameterized install commands like `npm install <package>` directly.

## 6. Node.js Environment

- **Use Node.js 22 at `C:\Work\nodejs.22` for local npm commands** when running installs or CLI operations, as Vite 6 and npm dependencies in this repository are verified on Node 22 (avoiding Node 21 / Node 24 incompatibility issues).


