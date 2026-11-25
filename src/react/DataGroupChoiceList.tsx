/**
 * 「数据同步组」候选选择列表（React，跨应用共用）。
 *
 * 为什么需要显式选择：`connect()` 只会取 `appDataGroups[0]`。一个 appId 下若存在
 * 多个数据组（历史 `default` 空组、换过后端的旧组），页面很容易挂到错的那个，
 * 数据写进空组、看起来像「没同步」。这里把候选全列出来（组 id / 名称 / 后端 /
 * 该组下有没有数据），点一下切换挂载对象。
 *
 * 候选数据由 `zen-fs-config` 的 `listDataGroupCandidates()` 提供；本组件只负责
 * 展示与选择，不读写存储、不自己解析「该挂哪个组」。
 *
 * 样式是内联的、不依赖 Tailwind：`variant="dark"`（默认，适配深色面板）/
 * `variant="light"`。容器可用 `className` / `style` 覆盖。
 */
import type { CSSProperties } from 'react';

/** 组件需要的最小候选字段（与 zen-fs-config 的 `DataGroupCandidate` 结构兼容）。 */
export interface DataGroupChoiceItem {
  id: string;
  name?: string;
  /** 组里是否有非本地后端（真能跨设备同步） */
  hasRemote: boolean;
  /** 目标目录下是否已有内容 */
  hasData: boolean;
  /** 后端类型列表 */
  backendTypes: string[];
  /** 本组隐式本地主存储名（IndexedDB store） */
  localStore: string;
}

export interface DataGroupChoiceListProps {
  /** 应用 id（与 `connect()` 相同），用于空状态提示 */
  appId: string;
  candidates: DataGroupChoiceItem[];
  /** 当前挂载的组 id */
  activeId: string | null;
  /** 用户点选候选 */
  onPick: (id: string) => void;
  /** 切换中禁用交互 */
  busy?: boolean;
  /** 组内数据目录（如 `/golf`），用于「有数据」的提示文案 */
  dataPath?: string;
  variant?: 'dark' | 'light';
  className?: string;
  style?: CSSProperties;
  /** 覆盖任意文案（i18n 用） */
  labels?: Partial<{
    emptyTitle: string;
    emptyHint: string;
    summary: string;
    remote: string;
    localOnly: string;
    hasData: string;
    current: string;
    noRemoteBackend: string;
    localRow: string;
  }>;
}

const DEFAULT_LABELS = {
  emptyTitle: '本机配置仓里还没有该应用的数据组',
  emptyHint:
    '页面连接配置仓后会自动创建一个本机默认组（仅 local-idb）；若长时间停在这里，说明配置仓未连通或建组失败，可在下方手动创建/连接。',
  summary: '点选即切换挂载',
  remote: '远端',
  localOnly: '仅本地',
  hasData: '有数据',
  current: '当前',
  noRemoteBackend: '无远端后端',
  localRow: '隐式 source · 不参与同步',
};

interface Palette {
  border: string;
  bg: string;
  text: string;
  muted: string;
  dim: string;
  activeBorder: string;
  activeBg: string;
  chipBg: string;
  remoteBg: string;
  remoteText: string;
  dataBg: string;
  dataText: string;
  currentBg: string;
  currentText: string;
}

const PALETTES: Record<'dark' | 'light', Palette> = {
  dark: {
    border: 'rgba(255,255,255,0.10)',
    bg: 'rgba(255,255,255,0.05)',
    text: 'rgba(255,255,255,0.85)',
    muted: 'rgba(255,255,255,0.55)',
    dim: 'rgba(255,255,255,0.35)',
    activeBorder: 'rgba(52,211,153,0.6)',
    activeBg: 'rgba(52,211,153,0.10)',
    chipBg: 'rgba(255,255,255,0.10)',
    remoteBg: 'rgba(56,189,248,0.15)',
    remoteText: 'rgba(186,230,253,0.95)',
    dataBg: 'rgba(52,211,153,0.20)',
    dataText: 'rgba(167,243,208,0.95)',
    currentBg: 'rgba(16,185,129,0.30)',
    currentText: 'rgba(209,250,229,0.95)',
  },
  light: {
    border: 'rgba(0,0,0,0.12)',
    bg: 'rgba(0,0,0,0.03)',
    text: 'rgba(0,0,0,0.85)',
    muted: 'rgba(0,0,0,0.55)',
    dim: 'rgba(0,0,0,0.38)',
    activeBorder: 'rgba(5,150,105,0.6)',
    activeBg: 'rgba(5,150,105,0.08)',
    chipBg: 'rgba(0,0,0,0.06)',
    remoteBg: 'rgba(2,132,199,0.10)',
    remoteText: 'rgba(3,105,161,0.95)',
    dataBg: 'rgba(5,150,105,0.12)',
    dataText: 'rgba(4,120,87,0.95)',
    currentBg: 'rgba(5,150,105,0.18)',
    currentText: 'rgba(4,120,87,0.95)',
  },
};

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

export function DataGroupChoiceList(props: DataGroupChoiceListProps): JSX.Element {
  const {
    appId,
    candidates,
    activeId,
    onPick,
    busy,
    dataPath,
    variant = 'dark',
    className,
    style,
    labels: labelOverrides,
  } = props;
  const labels = { ...DEFAULT_LABELS, ...(labelOverrides ?? {}) };
  const c = PALETTES[variant] ?? PALETTES.dark;

  const mono: CSSProperties = {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  };

  if (candidates.length === 0) {
    return (
      <div
        className={className}
        style={{
          border: `1px solid ${c.border}`,
          background: c.bg,
          borderRadius: 6,
          padding: '6px 8px',
          fontSize: 12,
          color: c.muted,
          lineHeight: 1.6,
          ...style,
        }}
      >
        <div style={{ marginBottom: 4 }}>
          {labels.emptyTitle}（appId=<span style={mono}>{appId}</span>）
        </div>
        <div style={{ color: c.dim }}>{labels.emptyHint}</div>
      </div>
    );
  }

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      <div style={{ fontSize: 12, color: c.muted, lineHeight: 1.6 }}>
        共 {candidates.length} 个候选组
        {dataPath ? `，标「${labels.hasData}」= ${dataPath} 下已有文件` : ''}；{labels.summary}。
        每组下方的 <span style={mono}>local-idb</span> 是本组内置的本地主存储，不参与远端同步。
      </div>

      {candidates.map((cand) => {
        const active = cand.id === activeId;
        return (
          <div
            key={cand.id}
            style={{
              border: `1px solid ${active ? c.activeBorder : c.border}`,
              background: active ? c.activeBg : c.bg,
              borderRadius: 6,
              overflow: 'hidden',
              opacity: busy ? 0.5 : 1,
              transition: 'border-color 120ms, background 120ms',
            }}
          >
            <button
              type="button"
              disabled={busy}
              onClick={() => onPick(cand.id)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '4px 8px',
                fontSize: 12,
                lineHeight: 1.8,
                color: c.text,
                background: 'transparent',
                border: 'none',
                cursor: busy ? 'not-allowed' : 'pointer',
              }}
            >
              <span style={mono}>{shortId(cand.id)}</span>
              {cand.name ? <span style={{ marginLeft: 8, color: c.muted }}>{cand.name}</span> : null}
              <span style={{ marginLeft: 8, color: c.dim }}>
                {cand.backendTypes.join(' / ') || labels.noRemoteBackend}
              </span>
              {cand.hasRemote ? (
                <span
                  style={{
                    marginLeft: 8,
                    padding: '0 4px',
                    borderRadius: 3,
                    background: c.remoteBg,
                    color: c.remoteText,
                  }}
                >
                  {labels.remote}
                </span>
              ) : (
                <span
                  style={{
                    marginLeft: 8,
                    padding: '0 4px',
                    borderRadius: 3,
                    background: c.chipBg,
                    color: c.muted,
                  }}
                >
                  {labels.localOnly}
                </span>
              )}
              {cand.hasData ? (
                <span
                  style={{
                    marginLeft: 8,
                    padding: '0 4px',
                    borderRadius: 3,
                    background: c.dataBg,
                    color: c.dataText,
                  }}
                >
                  {labels.hasData}
                </span>
              ) : null}
              {active ? (
                <span
                  style={{
                    marginLeft: 8,
                    padding: '0 4px',
                    borderRadius: 3,
                    background: c.currentBg,
                    color: c.currentText,
                  }}
                >
                  {labels.current}
                </span>
              ) : null}
            </button>

            {/* 与「配置同步组」卡片里的 local-idb 行对齐：数据组同样有隐式本地主存储 */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '2px 8px',
                borderTop: `1px solid ${c.border}`,
                padding: '2px 8px',
                fontSize: 11,
                color: c.dim,
              }}
            >
              <span style={{ ...mono, color: c.muted }}>local-idb</span>
              <span>IndexedDB</span>
              <span style={{ background: c.chipBg, borderRadius: 3, padding: '0 4px' }}>
                {labels.localRow}
              </span>
              <span
                title={cand.localStore}
                style={{
                  ...mono,
                  color: c.dim,
                  maxWidth: '60%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {cand.localStore}
              </span>
              {active ? <span style={{ color: c.dataText }}>已挂载</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default DataGroupChoiceList;
