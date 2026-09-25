# zen-fs-config-ui 设计文档

## 1. 架构总览

```
┌──────────────────────────────────────────────────────┐
│                    宿主应用                            │
│  (HTML / React / Vue / ...)                          │
└──────────────┬───────────────────────┬───────────────┘
               │                       │
   ┌───────────▼──────────┐  ┌─────────▼──────────────┐
   │   Web Component 层    │  │     React 包装层         │
   │ <sync-group-configurator> │  <SyncGroupConfigurator /> │
   │  (Custom Element)      │  │  (薄包装，转发 props)    │
   └───────────┬──────────┘  └─────────┬──────────────┘
               │                       │
               └───────────┬───────────┘
                           │
               ┌───────────▼───────────┐
               │      Core 层           │
               │  SyncGroupConfiguratorCore │
               │  (状态 + API + DOM 渲染) │
               └───────────┬───────────┘
                           │
               ┌───────────▼───────────┐
               │    zen-fs-config       │
               │  (connect / repo /     │
               │   dataGroup / metadata)│
               └────────────────────────┘
```

三层架构：
1. **Core 层**：纯 TypeScript，无框架依赖。管理状态、调用 zen-fs-config API、操作 DOM 渲染 UI
2. **Web Component 层**：Custom Element，将 Core 挂载到 Shadow DOM，暴露属性/事件
3. **React 层**：薄包装，用 ref div 承载 Core，props 变化时调用 `core.update()`

## 2. Core 层设计

### 2.1 核心类：`SyncGroupConfiguratorCore`

```typescript
interface CoreProps {
  appId: string;
  nodeId?: string;
  backendInfo?: { type: string; options: Record<string, unknown> };
}

interface CoreState {
  mode: 'initial' | 'config-sync' | 'data-sync';
  connecting: boolean;
  error: string | null;
  repo: IConfigRepo | null;
  dataGroup: AppDataGroup | null;
  configBackends: BackendDescriptor[];
  dataGroups: AppDataGroupDescriptor[];
  dataGroupBackends: Map<string, AppDataBackendDescriptor[]>;
  backendMetadata: BackendMetadata[];
}

class SyncGroupConfiguratorCore {
  constructor(container: HTMLElement, props: CoreProps);
  mount(): Promise<void>;
  update(props: Partial<CoreProps>): void;
  destroy(): void;
}
```

### 2.2 状态流转

```
         mount()
            │
            ▼
     ┌─────────────┐
     │   initial    │  (有 backendInfo → 自动 connect)
     └──────┬──────┘
            │
     connect() 检测 group-type
            │
   ┌────────┼────────────────┐
   │        │                │
   ▼        ▼                ▼
config-sync  data-sync    (无 backendInfo 保持 initial)
   │        │
   ▼        ▼
 渲染对应视图
```

### 2.3 DOM 渲染策略

采用**全量重渲染**策略：每次状态变化时，清空 container 并重新构建 DOM 树。简单可靠，无需虚拟 DOM。

```typescript
private render(): void {
  this.container.innerHTML = '';
  const root = this.buildRoot();
  this.container.appendChild(root);
}
```

辅助函数 `el(tag, attrs, children)` 用于简洁地创建 DOM 元素。

### 2.4 样式方案

- 使用 Shadow DOM 隔离样式（Web Component 模式）
- Core 层注入 `<style>` 到 container，使用前缀类名避免冲突（React 模式）
- 纯 CSS，不依赖任何 CSS-in-JS 库
- 提供 CSS 变量供宿主自定义主题

## 3. Web Component 层设计

### 3.1 Custom Element

```typescript
class SyncGroupConfiguratorElement extends HTMLElement {
  private core: SyncGroupConfiguratorCore | null = null;
  private shadow: ShadowRoot;

  static get observedAttributes(): string[] {
    return ['app-id', 'node-id', 'backend-type', 'backend-options'];
  }

  connectedCallback(): void;
  disconnectedCallback(): void;
  attributeChangedCallback(name, oldValue, newValue): void;
}
```

### 3.2 属性映射

| HTML 属性 | Core prop | 转换 |
|---|---|---|
| `app-id` | `appId` | 直接 |
| `node-id` | `nodeId` | 直接 |
| `backend-type` | `backendInfo.type` | 直接 |
| `backend-options` | `backendInfo.options` | JSON.parse |

### 3.3 事件分发

Core 层通过回调通知 Web Component，Web Component 转换为 `CustomEvent` 派发：

```typescript
core.on('connected', (data) => {
  this.dispatchEvent(new CustomEvent('connected', { detail: data }));
});
```

## 4. React 层设计

### 4.1 组件

```tsx
function SyncGroupConfigurator({ appId, nodeId, backendInfo }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<SyncGroupConfiguratorCore | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    coreRef.current = new SyncGroupConfiguratorCore(containerRef.current, {
      appId, nodeId, backendInfo,
    });
    coreRef.current.mount();
    return () => coreRef.current?.destroy();
  }, []);

  useEffect(() => {
    coreRef.current?.update({ backendInfo });
  }, [backendInfo]);

  return <div ref={containerRef} />;
}
```

### 4.2 事件处理

React 组件通过 props 接收事件回调，Core 层调用回调：

```tsx
<SyncGroupConfigurator
  appId="my-app"
  onConnected={(data) => console.log(data)}
  onBackendAdded={(data) => console.log(data)}
/>
```

## 5. 后端类型元数据

通过 `zen-fs-config` 的 `listBackendMetadata()` 获取所有已注册后端类型的表单定义。

宿主应用需在渲染控件前注册所需后端类型（如 Gitee、GitHub、WebDAV、RemoteStorage）。

```typescript
// 宿主应用
import { registerBackend } from 'zen-fs-config';
registerBackend('Gitee', factory, metadata);
```

控件读取 `metadata.fields` 动态生成表单字段。

## 6. 构建配置

### 6.1 产物

| 产物 | 格式 | 入口 | 说明 |
|---|---|---|---|
| `dist/index.js` | ESM | `src/index.ts` | npm 包主入口 |
| `dist/index.cjs` | CJS | `src/index.ts` | CommonJS |
| `dist/index.d.ts` | - | - | 类型声明 |
| `dist/react/index.js` | ESM | `src/react/index.ts` | React 组件 |
| `dist/web-component/index.js` | ESM | `src/web-component/index.ts` | Web Component |
| `dist/zen-fs-config-ui.js` | IIFE | `src/web-component/index.ts` | 浏览器直接使用 |

### 6.2 外部依赖

- npm build：`react`、`react-dom`、`zen-fs-config` 为 external
- IIFE build：`zen-fs-config` 打包进去（因为浏览器无 npm），`react`/`react-dom` 不涉及（IIFE 只含 WC）

## 7. 文件结构

```
zen-fs-config-ui/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── .gitignore
├── README.md
├── REQUIREMENTS.md
├── DESIGN.md
├── .github/
│   └── workflows/
│       └── publish.yml
└── src/
    ├── index.ts                    # 主入口，导出 core + 类型
    ├── types.ts                    # 公共类型定义
    ├── core/
    │   ├── index.ts                # Core 导出
    │   ├── configurator.ts         # SyncGroupConfiguratorCore 主类
    │   ├── state.ts                # 状态定义与管理
    │   ├── api.ts                  # zen-fs-config API 封装
    │   ├── render.ts               # DOM 渲染辅助函数
    │   ├── styles.ts               # 内联 CSS 样式
    │   └── views/
    │       ├── initial-view.ts     # 初始视图
    │       ├── config-sync-view.ts # 配置同步组视图
    │       ├── data-sync-view.ts   # 数据同步组视图
    │       └── backend-form.ts     # 后端配置表单
    ├── web-component/
    │   ├── index.ts                # 注册 Custom Element
    │   └── element.ts              # SyncGroupConfiguratorElement
    └── react/
        ├── index.ts                # React 组件导出
        └── SyncGroupConfigurator.tsx
```
