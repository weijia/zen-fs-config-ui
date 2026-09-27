# zen-fs-config-ui

UI control for configuring [zen-fs-config](https://github.com/weijia/zen-fs-config) sync groups.

It lets users manage **config-sync** and **data-sync** backends through a graphical interface, with automatic group-type detection from the remote backend. Ships as both a **Web Component** (zero-build, drop-in) and a **React** component.

## Features

- **Unified backend form** — one form for all backend types; fields are generated dynamically from `zen-fs-config` backend metadata.
- **Inline form (no popup)** — the backend form renders inline below the backend list, not in a modal dialog.
- **Config string import / export** — paste a `type:id:key=value,...` string to auto-fill the form; click 📋 on any backend to copy its config string.
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

Drop the IIFE bundle in via a `<script>` tag — no bundler, no NPM install:

```html
<script src="https://unpkg.com/zen-fs-config-ui/dist/zen-fs-config-ui.js"></script>
```

This bundles `zen-fs-config` and auto-registers the `<sync-group-configurator>` element. The global `window.ZenFSConfigUI` exposes `registerBackend()`, `wrapZenFSFileSystem()`, `listBackendMetadata()`, `serializeBackend()`, and `deserializeBackend()` so you can register backend types from other CDN `<script>` tags.

> **Note:** Always use the explicit path `/dist/zen-fs-config-ui.js` (the IIFE bundle). The bare `https://unpkg.com/zen-fs-config-ui` resolves to the CJS build and will throw `module is not defined` in browsers.

#### Complete browser example (Gitee + RemoteStorage, script tags only)

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Sync Group Configurator</title>
</head>
<body>
  <!-- 1. UI bundle — auto-registers <sync-group-configurator> and exposes ZenFSConfigUI -->
  <script src="https://unpkg.com/zen-fs-config-ui/dist/zen-fs-config-ui.js"></script>

  <!-- 2. Backend implementations (load their global builds) -->
  <script src="https://unpkg.com/zen-fs-gitee/dist/zen-fs-gitee.global.js"></script>
  <script src="https://unpkg.com/zen-fs-remotestoragejs/dist/zen-fs-remotestoragejs.global.js"></script>

  <!-- 3. Register both backends BEFORE the element is added to the DOM -->
  <script>
    // --- Gitee backend ---
    // ZenFSGitee.Gitee is a ZenFS Backend. Wrap it with wrapZenFSFileSystem.
    ZenFSConfigUI.registerBackend('Gitee', async (options) => {
      return ZenFSConfigUI.wrapZenFSFileSystem({ backend: ZenFSGitee.Gitee, ...options });
    }, {
      type: 'Gitee',
      label: 'Gitee',
      icon: '🐙',
      fields: [
        { key: 'token', label: 'Token', type: 'password', required: true,
          placeholder: 'gitee_pat_xxx' },
        { key: 'owner', label: 'Owner', type: 'text', required: true,
          placeholder: 'username or org' },
        { key: 'repo', label: 'Repo', type: 'text', required: true,
          placeholder: 'repo-name' },
        { key: 'branch', label: 'Branch', type: 'text', placeholder: 'master' },
      ],
      defaultOptions: { branch: 'master' },
      accountFields: ['token', 'owner'],
    });

    // --- RemoteStorage backend ---
    // createRemoteStorageFileSystem() returns a ZenFS FileSystem; pass it directly.
    ZenFSConfigUI.registerBackend('RemoteStorage', async (options) => {
      const fs = ZenFSRemoteStorage.createRemoteStorageFileSystem({
        href: options.href,
        token: options.token,
        basePath: options.basePath,
      });
      return ZenFSConfigUI.wrapZenFSFileSystem(fs);
    }, {
      type: 'RemoteStorage',
      label: 'RemoteStorage',
      icon: '☁️',
      fields: [
        { key: 'href', label: 'Server URL', type: 'text', required: true,
          placeholder: 'https://storage.5apps.com/' },
        { key: 'token', label: 'Bearer Token', type: 'password', required: true,
          placeholder: 'your-rs-token' },
        { key: 'basePath', label: 'Base Path', type: 'text', placeholder: '/public/' },
      ],
      defaultOptions: { basePath: '/public/' },
      accountFields: ['token', 'href'],
    });
  </script>

  <!-- 4. Use the Web Component -->
  <sync-group-configurator
    app-id="my-app"
    style="display:block;max-width:640px;margin:40px auto;"
  ></sync-group-configurator>

  <!-- 5. (Optional) Pre-configure a remote backend via attributes -->
  <!--
  <sync-group-configurator
    app-id="my-app"
    backend-type="Gitee"
    backend-options='{"token":"gitee_pat_xxx","owner":"weijia","repo":"configs"}'
  ></sync-group-configurator>
  -->

  <script>
    // 6. Listen for events
    const el = document.querySelector('sync-group-configurator');
    el.addEventListener('connected', (e) => {
      console.log('connected, group type:', e.detail.groupType);
    });
    el.addEventListener('backend-added', (e) => {
      console.log('backend added:', e.detail.backendId);
    });
  </script>
</body>
</html>
```

#### How backend registration works in the browser

The IIFE bundle includes `zen-fs-config` internally but does **not** include any backend implementations (Gitee, RemoteStorage, GitHub, etc.). Those are separate packages you load from a CDN and register via the global:

```js
// Available on window.ZenFSConfigUI after the <script> loads:
ZenFSConfigUI.registerBackend(type, factory, metadata);
ZenFSConfigUI.wrapZenFSFileSystem(config);   // wrap a ZenFS Backend or FileSystem
ZenFSConfigUI.listBackendMetadata();           // → array of registered types
ZenFSConfigUI.serializeBackend(type, id, options, description?);  // → config string
ZenFSConfigUI.deserializeBackend(str, metadataList);                // → parsed backend
```

The `factory` receives the form options and must return a `BackendInstance`. Use `wrapZenFSFileSystem` to adapt a ZenFS `Backend` (e.g. `Gitee`) or a ZenFS `FileSystem` (e.g. from `createRemoteStorageFileSystem`):

```js
// ZenFS Backend:
wrapZenFSFileSystem({ backend: ZenFSGitee.Gitee, token, owner, repo });

// ZenFS FileSystem instance:
const fs = ZenFSRemoteStorage.createRemoteStorageFileSystem({ href, token });
wrapZenFSFileSystem(fs);
```

The `<sync-group-configurator>` reads the registered metadata to render the backend type selector and dynamic form fields. If no backends are registered, the "添加后端" form will have an empty type list.

#### Config string format

Each backend can be serialized to a one-line config string and pasted back into the form's **"从配置字符串导入"** field. The format is:

```
type:id:key=value,key=value,desc=description
```

**Example:**

```
Gitee:my-repo:owner=weijia,repo=configs,branch=master,desc=personal configs
```

- Click the **📋** button on any backend to copy its config string.
- Paste a config string into the import field and click **导入** to auto-fill all form fields.

You can also use the global helpers directly:

```js
const str = ZenFSConfigUI.serializeBackend('Gitee', 'my-repo', { owner: 'weijia', repo: 'configs' }, 'personal');
// → "Gitee:my-repo:owner=weijia,repo=configs,desc=personal"

const parsed = ZenFSConfigUI.deserializeBackend(str, ZenFSConfigUI.listBackendMetadata());
// → { type: 'Gitee', id: 'my-repo', options: {...}, description: 'personal' }
```

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

Before the control can show backend types in its form, you must register them:

**NPM / bundler:**

```ts
import { registerBackend } from 'zen-fs-config';
// e.g. Gitee, GitHub, WebDAV, RemoteStorage ...
registerBackend('Gitee', giteeFactory, giteeMetadata);
```

**Browser (no build):**

When using the IIFE bundle, `registerBackend` is available on the global:

```js
ZenFSConfigUI.registerBackend('Gitee', factory, metadata);
```

The control reads the registered metadata to render the backend type selector and dynamic form fields. If no backends are registered, the form will have an empty type list.

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
