# zen-fs-config-ui

UI control for configuring [zen-fs-config](https://github.com/weijia/zen-fs-config) sync groups.

It lets users manage **config-sync** and **data-sync** backends through a graphical interface, with automatic group-type detection from the remote backend. Ships as both a **Web Component** (zero-build, drop-in) and a **React** component.

## Features

- **Unified backend form** — one form for all backend types; fields are generated dynamically from `zen-fs-config` backend metadata.
- **Auto group-type detection** — connects to a backend and reads `/.meta/group-type`; new backends default to `data-sync`.
- **Local-first** — always starts with a local IndexedDB primary backend (no "skip" step).
- **Two view modes** — `config-sync` shows sync backends + data groups; `data-sync` shows sync backends only.
- **Web Component + React** — use it in any HTML page or a React app.
- **Shadow DOM styling** — styles are isolated and won't leak into the host page.

## Installation

### NPM

```bash
npm install zen-fs-config-ui zen-fs-config
```

### Browser (no build step)

Drop the IIFE bundle in via a `<script>` tag:

```html
<script src="https://unpkg.com/zen-fs-config-ui/dist/zen-fs-config-ui.js"></script>
```

This bundles `zen-fs-config` and auto-registers the `<sync-group-configurator>` element.

### Via esm.sh (CDN)

When loading the **React** entry from esm.sh, you **must pin the React version** with the `?deps=` query parameter. Otherwise esm.sh resolves the `react@>=17.0.0` peer dependency to the latest major (e.g. React 19), which creates a *second* React instance if your app uses a different version — causing `Cannot read properties of null (reading 'useRef')` and a blank page.

**React 18 app:**

```tsx
import { SyncGroupConfigurator } from 'https://esm.sh/zen-fs-config-ui@0.1.1/react?deps=react@18,react-dom@18';
```

**React 19 app:**

```tsx
import { SyncGroupConfigurator } from 'https://esm.sh/zen-fs-config-ui@0.1.1/react?deps=react@19,react-dom@19';
```

The **Web Component** entry has no React dependency, so no pinning is needed:

```html
<script type="module">
  import 'https://esm.sh/zen-fs-config-ui@0.1.1/web-component';
</script>
<sync-group-configurator app-id="my-app"></sync-group-configurator>
```

## Usage

### Web Component

```html
<script src="zen-fs-config-ui.js"></script>

<sync-group-configurator app-id="my-app"></sync-group-configurator>
```

With a pre-configured remote backend:

```html
<sync-group-configurator
  app-id="my-app"
  backend-type="Gitee"
  backend-options='{"token":"xxx","owner":"weijia","repo":"configs"}'
></sync-group-configurator>
```

Listen for events:

```js
const el = document.querySelector('sync-group-configurator');
el.addEventListener('connected', (e) => {
  console.log('connected, group type:', e.detail.groupType);
});
el.addEventListener('backend-added', (e) => {
  console.log('backend added:', e.detail.backendId);
});
```

### React

```tsx
import { SyncGroupConfigurator } from 'zen-fs-config-ui/react';

function App() {
  return (
    <SyncGroupConfigurator
      appId="my-app"
      backendInfo={{ type: 'Gitee', options: { token, owner, repo } }}
      onConnected={({ groupType }) => console.log('connected:', groupType)}
      onBackendAdded={({ backendId }) => console.log('added:', backendId)}
    />
  );
}
```

### Registering backend types

Before rendering the control, register the backend types you want to support via `zen-fs-config`:

```ts
import { registerBackend } from 'zen-fs-config';
// e.g. Gitee, GitHub, WebDAV, RemoteStorage ...
registerBackend('Gitee', giteeFactory, giteeMetadata);
```

The control reads the registered metadata to render the backend type selector and dynamic form fields.

## API

### Web Component attributes

| Attribute | Type | Required | Description |
|---|---|---|---|
| `app-id` | string | yes | Application ID |
| `node-id` | string | no | Node identifier (auto-generated if omitted) |
| `backend-type` | string | no | Remote backend type; if set, auto-connects on mount |
| `backend-options` | string (JSON) | no | Remote backend options as a JSON string |

### React props

| Prop | Type | Required | Description |
|---|---|---|---|
| `appId` | string | yes | Application ID |
| `nodeId` | string | no | Node identifier |
| `backendInfo` | `{ type: string; options: Record<string, unknown> }` | no | Remote backend to connect on mount |
| `onConnected` | `(data) => void` | no | Fired after connecting & detecting group type |
| `onBackendAdded` | `(data) => void` | no | Fired when a backend is added |
| `onBackendRemoved` | `(data) => void` | no | Fired when a backend is removed |
| `onDataGroupCreated` | `(data) => void` | no | Fired when a data-sync group is created |
| `onError` | `(data) => void` | no | Fired on errors |

### Events

| Event | Payload |
|---|---|
| `connected` | `{ groupType: 'config-sync' \| 'data-sync'; backendId?: string }` |
| `backend-added` | `{ backendId: string; type: string; groupType: GroupMode }` |
| `backend-removed` | `{ backendId: string }` |
| `data-group-created` | `{ groupId: string }` |
| `error` | `{ message: string }` |

## How group-type detection works

1. The control always starts with a local IndexedDB backend.
2. When a remote backend is added (or provided via `backend-type` / `backendInfo`), it connects and reads `/.meta/group-type` from the remote.
3. If the marker says `config-sync` → switches to the **config-sync** view (sync backends + data groups).
4. If `data-sync` or the marker is absent (new repo) → switches to the **data-sync** view, and writes the `data-sync` marker.

The first remote backend's type determines the mode for the whole session.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # builds CJS + ESM + d.ts + browser IIFE
npm run dev         # watch mode
```

Outputs in `dist/`:

| File | Format | Description |
|---|---|---|
| `dist/index.js` / `.cjs` | ESM / CJS | Core + types |
| `dist/react/index.js` | ESM / CJS | React component |
| `dist/web-component/index.js` | ESM / CJS | Web Component |
| `dist/zen-fs-config-ui.js` | IIFE | Browser bundle (includes `zen-fs-config`) |

## License

MIT
