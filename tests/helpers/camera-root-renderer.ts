import assert from "node:assert/strict";
import { agendaReactFixture } from "./agenda-load-lifecycle";
import type { DeviceSecurityUi } from "../../src/security/DeviceSecurityContext";

export interface NodeProps { children?: unknown; [name: string]: unknown; }
interface Element { type: unknown; props: NodeProps; key?: string; }
interface Context { provider: true; value: unknown; Provider: Context; }
export interface Tree { type: string; props: NodeProps; children: Tree[]; }
type Component = (props: NodeProps) => unknown;
function isElement(value: unknown): value is Element { return typeof value === "object" && value !== null && "type" in value && "props" in value; }
function isContext(value: unknown): value is Context { return typeof value === "object" && value !== null && "provider" in value; }
export function treeNodes(tree: Tree[], type: string): Tree[] { return tree.flatMap(node => [...(node.type === type ? [node] : []), ...treeNodes(node.children, type)]); }
export function treeText(tree: Tree[]): string { return tree.flatMap(node => [node.props.message, node.props.title, node.type === "#text" ? node.props.value : "", treeText(node.children)]).filter(value => typeof value === "string").join(" "); }

export function cameraRootRenderer() {
  const instances = new Map<string, { type: Component; hooks: ReturnType<typeof agendaReactFixture> }>();
  let active: ReturnType<typeof agendaReactFixture> | null = null;
  let security: DeviceSecurityUi | null = null;
  const hooks = () => { assert.ok(active, "HOOK_OUTSIDE_COMPONENT"); return active; };
  const react = {
    useState: <T>(initial: T | (() => T)) => hooks().react.useState(initial),
    useRef: <T>(initial: T) => hooks().react.useRef(initial),
    useEffect: (effect: () => void | (() => void), dependencies: readonly unknown[]) => hooks().react.useEffect(effect, dependencies),
    useSyncExternalStore: (subscribe: (listener: () => void) => () => void, snapshot: () => unknown) => hooks().react.useSyncExternalStore(subscribe, snapshot),
    useMemo: <T>(factory: () => T, dependencies: readonly unknown[]) => hooks().react.useMemo(factory, dependencies),
    useCallback: <T>(callback: T, dependencies: readonly unknown[]) => hooks().react.useCallback(callback, dependencies),
    createContext: (value: unknown) => { const context = { provider: true, value } as Context; context.Provider = context; return context; },
    useContext: (context: Context) => context.value,
    Component: class {
      state: object = {};
      constructor(readonly props: NodeProps) {}
      setState(next: object) { this.state = { ...this.state, ...next }; }
    },
  };
  const element = (type: unknown, props: NodeProps = {}, key?: string): Element => ({ type, props, key });
  return {
    react, jsx: { jsx: element, jsxs: element, Fragment: "Fragment" }, element,
    get security(): DeviceSecurityUi { assert.ok(security); return security; },
    render(root: Element): Tree[] {
      const visited = new Set<string>();
      function visit(value: unknown, path: string): Tree[] {
        if (value === null || value === undefined || typeof value === "boolean") return [];
        if (Array.isArray(value)) return value.flatMap((child, index) => visit(child, `${path}/${index}`));
        if (!isElement(value)) return [{ type: "#text", props: { value }, children: [] }];
        if (isContext(value.type)) {
          const previous = value.type.value;
          value.type.value = value.props.value;
          security = value.props.value as DeviceSecurityUi;
          const children = visit(value.props.children, `${path}/context`);
          value.type.value = previous;
          return children;
        }
        if (typeof value.type === "function") {
          const type = value.type as Component;
          if ("prototype" in type && type.prototype?.render) {
            const Class = type as unknown as new (props: NodeProps) => { render(): unknown };
            return visit(new Class(value.props).render(), `${path}/class`);
          }
          const identity = `${path}:${value.key ?? ""}`;
          let instance = instances.get(identity);
          if (instance?.type !== type) {
            instance?.hooks.unmount();
            instance = { type, hooks: agendaReactFixture() };
            instances.set(identity, instance);
          }
          visited.add(identity);
          const previous = active;
          active = instance.hooks;
          const output = instance.hooks.render(() => type(value.props));
          active = previous;
          return visit(output, `${identity}/render`);
        }
        assert.equal(typeof value.type, "string", "UNEXPECTED_JSX_TYPE");
        return [{ type: String(value.type), props: value.props, children: visit(value.props.children, `${path}/children`) }];
      }
      const tree = visit(root, "root");
      for (const [path, instance] of instances) {
        if (!visited.has(path)) { instance.hooks.unmount(); instances.delete(path); }
        else instance.hooks.commit();
      }
      return tree;
    },
    unmount() { for (const instance of instances.values()) instance.hooks.unmount(); instances.clear(); },
  };
}