# zen-fs-config-ui 需求文档

## 1. 概述

`zen-fs-config-ui` 是一个用于配置 zen-fs-config 同步组的 UI 控件。它允许用户通过图形界面管理配置同步组（config-sync）和数据同步组（data-sync）的后端。

控件提供两种使用方式：
- **Web Component**：可在任何 HTML 页面中通过 `<sync-group-configurator>` 标签直接使用，无需构建工具
- **React 组件**：可在 React 项目中作为组件引入

## 2. 背景与目标

### 2.1 背景

zen-fs-config 支持两种同步组类型：
- **config-sync（配置同步组）**：用于存储应用配置，支持多个远程副本后端双向同步
- **data-sync（数据同步组）**：用于存储应用数据，提供直接文件系统访问

用户在配置这些后端时，需要知道后端的组类型，并根据类型执行不同的操作（添加副本 vs 创建数据组）。当前缺乏一个统一的 UI 控件来简化这个过程。

### 2.2 目标

- 提供一个统一的后端配置表单，用户无需预先知道后端的组类型
- 连接后端后自动检测其组类型（通过 `/.meta/group-type` 文件）
- 根据检测到的组类型自动切换到对应的管理视图
- 新仓库（无 group-type）默认为数据同步组
- 支持零构建直接在浏览器中使用

## 3. 核心概念

| 概念 | 说明 |
|---|---|
| 本地主后端 | 始终存在的本地存储后端（IndexedDB / InMemory），不可删除 |
| 远程后端 | 用户添加的远程存储后端（Gitee / GitHub / WebDAV / RemoteStorage 等） |
| 配置同步组 (config-sync) | 用于同步配置文件，本地主后端 + 多个远程副本 |
| 数据同步组 (data-sync) | 用于同步应用数据，本地主后端 + 多个远程数据后端 |
| group-type | 存储在远程后端 `/.meta/group-type` 的标记文件，值为 `config-sync` 或 `data-sync` |

## 4. 功能需求

### 4.1 初始状态

- 控件挂载后，自动创建本地主后端（IndexedDB）
- 显示本地主后端信息
- 提供「添加后端」按钮
- 不区分 config-sync / data-sync 视图（由第一个远程后端决定）

### 4.2 添加后端

- 点击「添加后端」弹出统一的后端配置表单
- 表单包含：
  - 后端类型选择器（从已注册的后端类型中选择）
  - 根据后端类型动态生成的字段输入框（由 `BackendMetadata.fields` 定义）
- 表单不包含组类型选择
- 提交后执行连接并检测组类型

### 4.3 自动组类型检测

连接后端后，读取远程 `/.meta/group-type` 文件：

| 远程 group-type | 行为 |
|---|---|
| `config-sync` | 进入配置同步组模式 |
| `data-sync` | 进入数据同步组模式 |
| 不存在（新仓库） | 默认进入数据同步组模式，并写入 `data-sync` 标记 |

### 4.4 配置同步组模式

当第一个远程后端检测为 `config-sync` 时进入此模式。

视图包含两个区域：

1. **同步后端**：
   - 列出本地主后端 + 所有远程副本后端
   - 提供「添加后端」按钮（添加配置副本）
   - 可删除远程副本（本地主后端不可删除）

2. **数据同步组**：
   - 列出已创建的数据同步组
   - 提供「添加数据同步组」按钮
   - 点击数据同步组可钻取管理其内部后端

### 4.5 数据同步组模式

当第一个远程后端检测为 `data-sync`（或新仓库默认）时进入此模式。

视图只包含一个区域：

- **同步后端**：
  - 列出本地主后端 + 所有远程数据后端
  - 提供「添加后端」按钮
  - 可删除远程后端（本地主后端不可删除）
- **不显示**配置同步组相关 UI

### 4.6 后端表单字段动态生成

- 根据选择的后端类型，从 `zen-fs-config` 的 `listBackendMetadata()` 获取字段定义
- 字段类型支持：text、password、select
- 必填字段标记 `*`
- 默认值从 `defaultOptions` 填充

### 4.7 错误处理

- 连接失败时显示错误信息 + 重试按钮
- 表单验证：必填字段为空时提示
- 后端 ID 冲突时提示

## 5. 非功能需求

### 5.1 使用方式

| 方式 | 说明 |
|---|---|
| Web Component | `<script>` 引入 IIFE bundle，直接写 `<sync-group-configurator>` 标签 |
| React | `npm install zen-fs-config-ui`，`import { SyncGroupConfigurator } from 'zen-fs-config-ui/react'` |

### 5.2 浏览器兼容性

- 支持现代浏览器（Chrome / Firefox / Safari / Edge 最新版本）
- 依赖 Custom Elements API、Shadow DOM
- 不支持 IE

### 5.3 依赖

- `zen-fs-config`（核心 API，peer dependency）
- `react` / `react-dom`（仅 React 包装层需要，peer dependency，可选）

### 5.4 包体积

- Web Component IIFE bundle 不打包 React，保持轻量
- React 层仅为薄包装，不重复打包核心逻辑

## 6. API 需求

### 6.1 Web Component 属性

```html
<sync-group-configurator
  app-id="my-app"
  node-id="node-1"
  backend-type="Gitee"
  backend-options='{"token":"xxx","owner":"weijia","repo":"configs"}'
></sync-group-configurator>
```

| 属性 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `app-id` | string | 是 | 应用 ID |
| `node-id` | string | 否 | 节点 ID，自动生成 |
| `backend-type` | string | 否 | 远程后端类型，提供则自动连接 |
| `backend-options` | string (JSON) | 否 | 远程后端配置，JSON 字符串 |

### 6.2 React 组件 Props

```tsx
<SyncGroupConfigurator
  appId="my-app"
  nodeId="node-1"
  backendInfo={{ type: 'Gitee', options: { token, owner, repo } }}
/>
```

| Prop | 类型 | 必填 | 说明 |
|---|---|---|---|
| `appId` | string | 是 | 应用 ID |
| `nodeId` | string | 否 | 节点 ID |
| `backendInfo` | `{ type: string; options: Record<string, unknown> }` | 否 | 远程后端连接信息 |

### 6.3 事件

| 事件 | 触发时机 | 数据 |
|---|---|---|
| `connected` | 成功连接后端并检测组类型后 | `{ groupType, backendId }` |
| `backend-added` | 后端添加成功 | `{ backendId, type, groupType }` |
| `backend-removed` | 后端删除成功 | `{ backendId }` |
| `error` | 发生错误 | `{ message }` |
