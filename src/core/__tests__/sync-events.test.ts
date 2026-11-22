import { describe, it, expect } from 'vitest';
import { subscribeGroupSyncEvents } from '../configurator.js';

/**
 * UI 把 repo / dataGroup 的 onSyncEvent 转成元素事件。这里只测订阅适配层：
 * 新库有方法就订阅并可取消，老库没有方法时返回 null（行为不变）。
 */
describe('subscribeGroupSyncEvents', () => {
  it('转发事件并可取消订阅', () => {
    const handlers = new Set<(e: any) => void>();
    const group = {
      onSyncEvent: (h: (e: any) => void) => {
        handlers.add(h);
        return () => { handlers.delete(h); };
      },
    };

    const events: any[] = [];
    const unsubscribe = subscribeGroupSyncEvents(group, (e) => events.push(e));
    expect(unsubscribe).toBeTypeOf('function');
    expect(handlers.size).toBe(1);

    const event = {
      type: 'sync:end',
      groupKind: 'config',
      groupId: 'config',
      backendId: 'gitee-replica',
      pairId: 'p1',
      timestamp: 123,
    };
    for (const h of handlers) h(event);
    expect(events).toEqual([event]);

    unsubscribe!();
    expect(handlers.size).toBe(0);
    for (const h of handlers) h(event);
    expect(events).toHaveLength(1);
  });

  it('老版本库没有 onSyncEvent → null，不抛错', () => {
    expect(subscribeGroupSyncEvents({}, () => {})).toBeNull();
    expect(subscribeGroupSyncEvents(null, () => {})).toBeNull();
  });
});
