/**
 * React V2 wrapper. It renders the same UI as the legacy component but mounts
 * through connectV2() and exposes the resulting AppRepo instead of a raw
 * ConnectResult.
 *
 * - Pass `repo` when the host already called connectV2(): the UI will not
 *   connect again.
 * - Omit `repo`: the UI owns the connection and hands the AppRepo to
 *   `onRepoReady`.
 *
 * Unmount never disposes the repo: an AppRepo may be shared with the host.
 */
import { useEffect, useRef } from 'react';
import { SyncGroupConfiguratorCore } from '../core/configurator.js';
import type { BackendInfo, CoreEventMap, CoreEventName } from '../types.js';
import type { AppRepoLike } from '../core/v2-api.js';

export interface SyncGroupConfiguratorV2Props {
  appId: string;
  nodeId?: string;
  backendInfo?: BackendInfo;
  /** AppRepo from connectV2(). When present the UI reuses it. */
  repo?: AppRepoLike;
  /** Called once the core has an AppRepo (passed in or created by the UI). */
  onRepoReady?: (repo: AppRepoLike) => void;
  onConnected?: (data: CoreEventMap['connected']) => void;
  onBackendAdded?: (data: CoreEventMap['backend-added']) => void;
  onBackendRemoved?: (data: CoreEventMap['backend-removed']) => void;
  onDataGroupCreated?: (data: CoreEventMap['data-group-created']) => void;
  onSync?: (data: CoreEventMap['sync']) => void;
  onError?: (data: CoreEventMap['error']) => void;
  onCoreReady?: (core: SyncGroupConfiguratorCore | null) => void;
}

const EVENT_HANDLER_MAP: Record<string, CoreEventName> = {
  onConnected: 'connected',
  onBackendAdded: 'backend-added',
  onBackendRemoved: 'backend-removed',
  onDataGroupCreated: 'data-group-created',
  onSync: 'sync',
  onError: 'error',
};

export function SyncGroupConfiguratorV2(
  props: SyncGroupConfiguratorV2Props,
): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<SyncGroupConfiguratorCore | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const core = new SyncGroupConfiguratorCore(containerRef.current, {
      appId: props.appId,
      nodeId: props.nodeId,
      backendInfo: props.backendInfo,
      repo: props.repo,
    });
    coreRef.current = core;
    props.onCoreReady?.(core);

    for (const [propKey, eventName] of Object.entries(EVENT_HANDLER_MAP)) {
      const handler = props[propKey as keyof SyncGroupConfiguratorV2Props];
      if (typeof handler === 'function') {
        core.on(eventName, handler as never);
      }
    }

    void core.mountV2(props.repo).then((repo) => {
      if (repo) props.onRepoReady?.(repo);
    });

    return () => {
      core.destroy();
      coreRef.current = null;
      props.onCoreReady?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.appId, props.repo]);

  useEffect(() => {
    coreRef.current?.update({ backendInfo: props.backendInfo });
  }, [props.backendInfo]);

  return <div ref={containerRef} />;
}
