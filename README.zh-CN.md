# zen-fs-config-ui

用于配置 [zen-fs-config](https://github.com/weijia/zen-fs-config) 同步组的图形界面控件。

它让用户通过图形界面管理 **config-sync** 与 **data-sync** 后端，并自动探测远端后端的组类型。同时提供 **Web Component**（零构建、直接引入）与 **React** 组件两种形态。

## 功能特性

- **统一后端表单** —— 所有后端类型共用一套表单，字段由 `zen-fs-config` 的后端元数据动态生成。
- **行内表单（非弹窗）** —— 后端表单渲染在后端列表下方，不使用模态框。
- **配置字符串导入 / 导出** —— 粘贴 `type:id:key=value,...` 字符串即可自动填充表单；点击任意后端的 📋 可复制其配置字符串。
- **组类型探测，绝不猜** —— 连接远端后端后交给 `zen-fs-config` 探测（先读 `/.meta/group.json`，再读旧标记 `/.meta/group-type`）。若远端是全新空仓，控件会询问用户初始化为 `config-sync` 还是 `data-sync`，不会自行假定类型。
- **本地优先** —— 始终先启动本地 IndexedDB 主库（没有「跳过」这一步）。
- **两种视图模式** —— `config-sync` 展示同步后端 + 数据组；`data-sync` 只展示同步后端。
- **Web Component + React** —— 可用于任意 HTML 页面或 React 应用。
- **Shadow DOM 样式隔离** —— 样式不会泄漏到宿主页面。

## 安装

### NPM

```bash
npm install zen-fs-config-ui zen-fs-config
```

### 浏览器（无需构建）

用 `<script>` 标签直接引入 IIFE 包 —— 不需要打包器，也不需要 NPM 安装：

```html
<script src="https://unpkg.com/zen-fs-config-ui/dist/zen-fs-config-ui.js"></script>
```

该包内部已包含 `zen-fs-config`，并会自动注册 `<sync-group-configurator>` 元素。全局对象 `window.ZenFSConfigUI` 暴露 `registerBackend()`、`wrapZenFSFileSystem()`、`listBackendMetadata()`、`serializeBackend()` 与 `deserializeBackend()`，便于从其它 CDN `<script>` 注册后端类型。

> **注意：** 必须使用完整路径 `/dist/zen-fs-config-ui.js`（IIFE 包）。直接写 `https://unpkg.com/zen-fs-config-ui` 会解析到 CJS 构建，浏览器里会抛 `module is not defined`。

#### 完整浏览器示例（Gitee + RemoteStorage，仅用 script 标签）

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>同步组配置器</title>
</head>
<body>
  <!-- 1. UI 包 —— 自动注册 <sync-group-configurator> 并暴露 ZenFSConfigUI -->
  <script src="https://unpkg.com/zen-fs-config-ui/dist/zen-fs-config-ui.js"></script>

  <!-- 2. 后端实现（加载各自的全局构建） -->
  <script src="https://unpkg.com/zen-fs-gitee/dist/zen-fs-gitee.global.js"></script>
  <script src="https://unpkg.com/zen-fs-remotestoragejs/dist/zen-fs-remotestoragejs.global.js"></script>

  <!-- 3. 在元素插入 DOM 之前注册两个后端 -->
  <script>
    // --- Gitee 后端 ---
    // ZenFSGitee.Gitee 是一个 ZenFS Backend，用 wrapZenFSFileSystem 包装。
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

    // --- RemoteStorage 后端 ---
    // createRemoteStorageFileSystem() 返回 ZenFS FileSystem，直接传入即可。
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

  <!-- 4. 使用 Web Component -->
  <sync-group-configurator
    app-id="my-app"
    style="display:block;max-width:640px;margin:40px auto;"
  ></sync-group-configurator>

  <!-- 5.（可选）通过属性预配置一个远端后端 -->
  <!--
  <sync-group-configurator
    app-id="my-app"
    backend-type="Gitee"
    backend-options='{"token":"gitee_pat_xxx","owner":"weijia","repo":"configs"}'
  ></sync-group-configurator>
  -->

  <script>
    // 6. 监听事件
    const el = document.querySelector('sync-group-configurator');
    el.addEventListener('connected', (e) => {
      console.log('已连接，组类型:', e.detail.groupType);
    });
    el.addEventListener('backend-added', (e) => {
      console.log('已添加后端:', e.detail.backendId);
    });
  </script>
</body>
</html>
```

#### 浏览器里的后端注册机制

IIFE 包内部包含 `zen-fs-config`，但**不**包含任何后端实现（Gitee、RemoteStorage、GitHub 等）。这些是独立包，需从 CDN 加载后通过全局对象注册：

```js
// <script> 加载完成后，以下方法在 window.ZenFSConfigUI 上可用：
ZenFSConfigUI.registerBackend(type, factory, metadata);
ZenFSConfigUI.wrapZenFSFileSystem(config);   // 包装 ZenFS Backend 或 FileSystem
ZenFSConfigUI.listBackendMetadata();           // → 已注册类型的数组
ZenFSConfigUI.serializeBackend(type, id, options, description?);  // → 配置字符串
ZenFSConfigUI.deserializeBackend(str, metadataList);                // → 解析出的后端
```

`factory` 接收表单选项，必须返回一个 `BackendInstance`。用 `wrapZenFSFileSystem` 适配 ZenFS `Backend`（如 `Gitee`）或 ZenFS `FileSystem`（如 `createRemoteStorageFileSystem` 的返回值）：

```js
// ZenFS Backend：
wrapZenFSFileSystem({ backend: ZenFSGitee.Gitee, token, owner, repo });

// ZenFS FileSystem 实例：
const fs = ZenFSRemoteStorage.createRemoteStorageFileSystem({ href, token });
wrapZenFSFileSystem(fs);
```

`<sync-group-configurator>` 读取已注册的元数据来渲染后端类型选择器与动态表单字段。若一个后端都没注册，「添加后端」表单的类型列表为空。

#### 配置字符串格式

每个后端都可序列化成一行配置字符串，粘贴回表单的 **「从配置字符串导入」** 输入框即可。格式为：

```
type:id:key=value,key=value,desc=description
```

**示例：**

```
Gitee:my-repo:owner=weijia,repo=configs,branch=master,desc=personal configs
```

- 点击任意后端的 **📋** 按钮可复制其配置字符串。
- 把配置字符串粘贴到导入框并点击 **导入**，即可自动填充所有表单字段。

也可以直接调用全局辅助函数：

```js
const str = ZenFSConfigUI.serializeBackend('Gitee', 'my-repo', { owner: 'weijia', repo: 'configs' }, 'personal');
// → "Gitee:my-repo:owner=weijia,repo=configs,desc=personal"

const parsed = ZenFSConfigUI.deserializeBackend(str, ZenFSConfigUI.listBackendMetadata());
// → { type: 'Gitee', id: 'my-repo', options: {...}, description: 'personal' }
```

### 通过 esm.sh（CDN）

从 esm.sh 加载 **React** 入口时，**必须**用 `?deps=` 查询参数锁定 React 版本。否则 esm.sh 会把 `react@>=17.0.0` 这个 peer 依赖解析到最新大版本（例如 React 19）；如果你的应用用的是别的版本，就会出现**第二个** React 实例 —— 导致 `Cannot read properties of null (reading 'useRef')` 和页面白屏。

**React 18 应用：**

```tsx
import { SyncGroupConfigurator } from 'https://esm.sh/zen-fs-config-ui@0.1.1/react?deps=react@18,react-dom@18';
```

**React 19 应用：**

```tsx
import { SyncGroupConfigurator } from 'https://esm.sh/zen-fs-config-ui@0.1.1/react?deps=react@19,react-dom@19';
```

**Web Component** 入口不依赖 React，无需锁定版本：

```html
<script type="module">
  import 'https://esm.sh/zen-fs-config-ui@0.1.1/web-component';
</script>
<sync-group-configurator app-id="my-app"></sync-group-configurator>
```

## 用法

### Web Component

```html
<script src="zen-fs-config-ui.js"></script>

<sync-group-configurator app-id="my-app"></sync-group-configurator>
```

预配置远端后端：

```html
<sync-group-configurator
  app-id="my-app"
  backend-type="Gitee"
  backend-options='{"token":"xxx","owner":"weijia","repo":"configs"}'
></sync-group-configurator>
```

监听事件：

```js
const el = document.querySelector('sync-group-configurator');
el.addEventListener('connected', (e) => {
  console.log('已连接，组类型:', e.detail.groupType);
});
el.addEventListener('backend-added', (e) => {
  console.log('已添加后端:', e.detail.backendId);
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

### 注册后端类型

控件要在表单里展示后端类型，必须先注册它们：

**NPM / 打包器：**

```ts
import { registerBackend } from 'zen-fs-config';
// 例如 Gitee、GitHub、WebDAV、RemoteStorage ...
registerBackend('Gitee', giteeFactory, giteeMetadata);
```

**浏览器（无需构建）：**

使用 IIFE 包时，`registerBackend` 挂在全局对象上：

```js
ZenFSConfigUI.registerBackend('Gitee', factory, metadata);
```

控件读取已注册的元数据来渲染后端类型选择器与动态表单字段。若未注册任何后端，表单的类型列表为空。

## API

### Web Component 属性

| 属性 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `app-id` | string | 是 | 应用 ID |
| `node-id` | string | 否 | 节点标识（省略时自动生成） |
| `backend-type` | string | 否 | 远端后端类型；设置后挂载时自动连接 |
| `backend-options` | string（JSON） | 否 | 远端后端选项，JSON 字符串 |

### React 属性

| Prop | 类型 | 必填 | 说明 |
|---|---|---|---|
| `appId` | string | 是 | 应用 ID |
| `nodeId` | string | 否 | 节点标识 |
| `backendInfo` | `{ type: string; options: Record<string, unknown> }` | 否 | 挂载时连接的远端后端 |
| `onConnected` | `(data) => void` | 否 | 连接并探测出组类型后触发 |
| `onBackendAdded` | `(data) => void` | 否 | 添加后端后触发 |
| `onBackendRemoved` | `(data) => void` | 否 | 移除后端后触发 |
| `onDataGroupCreated` | `(data) => void` | 否 | 创建 data-sync 组后触发 |
| `onSync` | `(data) => void` | 否 | 每个同步对每轮同步触发一次（`sync:end` / `sync:error`） |
| `onCoreReady` | `(core: SyncGroupConfiguratorCore \| null) => void` | 否 | 拿到 core 实例（可读 `core.getConnection()` 获取实时 `repo` / `dataGroup`） |
| `onError` | `(data) => void` | 否 | 出错时触发 |

### 事件

| 事件 | 载荷 |
|---|---|
| `connected` | `{ groupType: 'config-sync' \| 'data-sync'; backendId?: string; repo?: IConfigRepo; dataGroup?: AppDataGroup; backendInfo?: BackendInfo }` |
| `backend-added` | `{ backendId: string; type: string; groupType: GroupMode }` |
| `backend-removed` | `{ backendId: string }` |
| `data-group-created` | `{ groupId: string; dataGroup?: AppDataGroup }` |
| `sync` | `{ type: 'sync:end' \| 'sync:error'; groupKind: 'config' \| 'data'; groupId: string; backendId: string; pairId: string; timestamp: number; result?: SyncResult; error?: string }` |
| `error` | `{ message: string }` |

`connected` 载荷里的 `repo` / `dataGroup` / `backendInfo` 是**实时对象引用**（同文档内派发，不做克隆）。

### 获取运行中的 `repo` / `dataGroup`

控件不通过属性暴露实例，有两条交接路径：

- **Web Component** —— 元素缓存了最后一次 `connected` 载荷，随时可读，不必抢事件：
  `el.getConnection()` 返回该载荷（首次连接成功前为 `null`）。页面加载后控件在后台重连时，
  这一点尤其重要。
- **React** —— 用 `onConnected` 监听，或用 `onCoreReady` 拿到 core 实例后调用
  `core.getConnection()`。

引用拿到后一直复用即可，不要再调一次 `connect()`。

```js
const el = document.querySelector('sync-group-configurator');

// 首选：读缓存的载荷（晚注册监听、后台重连都不会漏）
const connection = el.getConnection();
const { repo, dataGroup, backendInfo } = connection ?? {};

// 或者监听事件
el.addEventListener('connected', (e) => {
  const { repo, dataGroup } = e.detail;
  // ...
});

// 1. 配置同步组根（`repo.fs` 已 chroot 到 /{appId}/）
repo.getConfig('/theme');
repo.setConfig('/theme', { color: 'dark' });
repo.fs.promises.readFile('/data.json');
repo.getSyncStatuses();           // 实时同步对状态（界面自己也在轮询）

// 2. 数据同步组（接入 data-sync 后端时存在）
dataGroup?.fs.promises.writeFile('/struct/host.json', json);
dataGroup?.getSyncStatuses();
```

React：

```tsx
<SyncGroupConfigurator
  appId="my-app"
  onConnected={({ repo, dataGroup }) => {
    // 同样的引用、同样的 API
  }}
  onCoreReady={(core) => {
    // core?.getConnection() → 同一份载荷，之后随时可读
  }}
/>
```

TypeScript 可用 `e.detail.repo as IConfigRepo` / `dataGroup as AppDataGroup` 收窄类型（两个类型都由
`zen-fs-config` 导出）。开启 `deferReplicaSetup` 时 repo 立即可用，但副本可能仍在建对 —— 见下文生命周期。

### 同步事件

控件把 `zen-fs-config` 的 `onSyncEvent` 流转发成一个 DOM 事件 `sync`（React 为 `onSync`），
每个同步对每跑一轮触发一次：

```js
el.addEventListener('sync', (e) => {
  const { type, groupKind, groupId, backendId, pairId, result, error } = e.detail;

  if (type === 'sync:error') {
    console.warn(`同步失败 ${backendId}: ${error}`);
    return;
  }
  // sync:end 在零变更轮也会发 —— 用 result 的计数过滤。
  const changed =
    (result?.filesCreated ?? 0) + (result?.filesUpdated ?? 0) + (result?.filesDeleted ?? 0);
  if (changed > 0) {
    console.log(`同步完成 ${backendId}: +${result.filesCreated} ~${result.filesUpdated} -${result.filesDeleted}`);
  }
});
```

`groupKind` 为 `config` 或 `data`；数据组的 `groupId` 是组 id，配置组固定为 `config`。事件在库完成状态簿记之后到达，控件收到后**立即**刷新状态行，不再等 2 秒定时器。

仍然不包含的部分：

- **不是文件级**：没有逐路径回调，只报「一轮同步」的结果。
- **不是远端主动推送**：某一轮是否发生仍由同步对调度决定 —— 实现了 `onChange` 的后端会即时推送本地写入，远端变更要等下一轮 `syncPollIntervalMs` 轮询（**默认 30 分钟**，来自 `zen-fs-sync`）。想更快拉取，就调小该间隔或调 `repo.flush()`。
- **旧版 `zen-fs-config`** 没有 `onSyncEvent`：控件不注册监听，`sync` 事件自然不触发，其它功能不受影响。

## 组类型探测流程

1. 控件始终先启动本地 IndexedDB 后端。
2. 添加远端后端（或通过 `backend-type` / `backendInfo` 提供）时，调用 `connect()` 时**不传** `groupType`，交给库探测远端（严格读 `/.meta/group.json`，再读旧标记 `/.meta/group-type`）。探测结果为 `unreachable`（→ 报错，不创建任何本地组）、`empty`、`marked`、`occupied` 四态之一。
3. 标记 / 描述符为 `config-sync` → **config-sync** 视图（同步后端 + 数据组）；为 `data-sync` → **data-sync** 视图。
4. 若远端是全新空仓，库抛出 `NEEDS_INIT`；控件打开初始化对话框（`views/init-confirm.ts`，三个选项：配置组 / 数据组 / 取消），并带上用户选择的 `initGroupType` 重连。选择取消则原样抛出该错误 —— 不会向远端写入任何内容。
5. 若远端其实已经是配置组，却被要求按 `data-sync` 连接，控件回退为按 `config-sync` 连接，而不是直接失败。

首个远端后端的类型决定整个会话的模式。

## 连接生命周期：已返回 vs 已就绪

控件连接时使用 `deferReplicaSetup: true`。因此 `connect()` 在本地仓可用时就返回（信号①），远端身份校验与建对继续在后台进行，由 `whenReplicasReady()` 通知结果（信号②）：

- **本地状态立即可用** —— 配置值可读可写，后端描述符已列出。
- **副本尚未建对** —— 配置组的状态行显示 `远端校验中 · connect 已返回，副本尚未建对`；它刻意**不**显示为「同步对 0」，避免把空的同步对列表误当成「没有远端」。
- **信号②到达** —— 状态行切回真实计数，详情行追加 `后台建对 就绪 X · 跳过 Y（backendId: reason）· 失败 Z`。身份冲突以 `skipped` 形式上报，不再抛出。
- **旧版 `zen-fs-config`** 不提供 `replicasPending` / `whenReplicasReady`；控件把两者都按可选字段读取，保持原先的即时行为（connect 返回时同步对已建好）。

## 开发

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # 构建 CJS + ESM + d.ts + 浏览器 IIFE
npm run dev         # 监听模式
```

`dist/` 下的产物：

| 文件 | 格式 | 说明 |
|---|---|---|
| `dist/index.js` / `.cjs` | ESM / CJS | 核心 + 类型 |
| `dist/react/index.js` | ESM / CJS | React 组件 |
| `dist/web-component/index.js` | ESM / CJS | Web Component |
| `dist/zen-fs-config-ui.js` | IIFE | 浏览器包（内含 `zen-fs-config`） |

## License

MIT
