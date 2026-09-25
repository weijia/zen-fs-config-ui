/**
 * Lightweight DOM helpers — no virtual DOM, just plain element creation.
 */

export type Attrs = Record<string, string | boolean | undefined>;
export type Child = Node | string | null | undefined | Child[];

/** Create an element with attributes and children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  children?: Child,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null) continue;
      if (k === 'className') { node.className = String(v); continue; }
      if (k === 'innerHTML') { node.innerHTML = String(v); continue; }
      if (k.startsWith('on') && typeof v === 'string') {
        // event handlers should be attached via addEventListener, not attrs
        continue;
      }
      if (typeof v === 'boolean') {
        if (v) node.setAttribute(k, '');
      } else {
        node.setAttribute(k, String(v));
      }
    }
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(parent: Node, children: Child): void {
  if (children == null) return;
  if (Array.isArray(children)) {
    for (const c of children) appendChildren(parent, c);
    return;
  }
  if (typeof children === 'string') {
    parent.appendChild(document.createTextNode(children));
    return;
  }
  parent.appendChild(children);
}

/** Attach an event listener and return the element for chaining. */
export function on<T extends Event>(
  node: HTMLElement,
  event: string,
  handler: (e: T) => void,
): HTMLElement {
  node.addEventListener(event, handler as EventListener);
  return node;
}

/** Clear all children from a node. */
export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}
