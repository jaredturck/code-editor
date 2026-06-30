# Code Editor

A desktop code editor built with Electron, React, TypeScript, Vite, and Tailwind CSS.

## Development

```bash
npm install
npm run dev
```

`npm run dev` starts the Vite renderer server, watches the Electron TypeScript files, and opens the application in an Electron window.

React changes use Vite hot module replacement. Changes inside `electron/` require restarting the development command.

## Project structure

```text
electron/
├── main.cts
├── preload.cts
└── tsconfig.json

src/
├── components/
├── types/
├── App.tsx
├── index.css
└── main.tsx
```

- `electron/main.cts` manages the desktop window and application lifecycle.
- `electron/preload.cts` exposes a small, isolated API to the React renderer.
- `src/` contains the React interface.

## Verification

```bash
npm run lint
npm run typecheck
npm run build
```
