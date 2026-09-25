/**
 * React wrapper around SyncGroupConfiguratorCore.
 *
 * Mounts the core into a ref'd div and forwards props. On unmount,
 * destroys the core.
 */
import { useEffect, useRef } from 'react';
import { SyncGroupConfiguratorCore } from '../core/configurator.js';
import type { BackendInfo, CoreEventMap, CoreEventName } from '../types.js';

export interface SyncGroupConfiguratorProps {
  appId: string;
  nodeId?: string;
  backendInfo?: BackendInfo;
  onConnected?: (data: CoreEventMap['connected']) => void;
  onBackendAdded?: (data: CoreEventMap['backend-added']) => void;
  onBackendRemoved?: (data: CoreEventMap['backend-removed']) => void;
  onDataGroupCreated?: (data: CoreEventMap['data-group-created']) => void;
  onError?: (data: CoreEventMap['error']) => void;
}

const EVENT_HANDLER_MAP: Record<string, CoreEventName> = {
  onConnected: 'connected',
  onBackendAdded: 'backend-added',
  onBackendRemoved: 'backend-removed',
  onDataGroupCreated: 'data-group-created',
  onError: 'error',
};

export function SyncGroupConfigurator(props: SyncGroupConfiguratorProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<SyncGroupConfiguratorCore | null>(null);

  // Mount once
  useEffect(() => {
    if (!containerRef.current) return;
    const core = new SyncGroupConfiguratorCore(containerRef.current, {
      appId: props.appId,
      nodeId: props.nodeId,
      backendInfo: props.backendInfo,
    });
    coreRef.current = core;

    // Attach event handlers
    for (const [propKey, eventName] of Object.entries(EVENT_HANDLER_MAP)) {
      const handler = props[propKey as keyof SyncGroupConfiguratorProps];
      if (typeof handler === 'function') {
        core.on(eventName, handler as never);
      }
    }

    void core.mount();

    return () => {
      core.destroy();
      coreRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.appId]);

  // Update backendInfo when it changes
  useEffect(() => {
    coreRef.current?.update({ backendInfo: props.backendInfo });
  }, [props.backendInfo]);

  return <div ref={containerRef} />;
}
