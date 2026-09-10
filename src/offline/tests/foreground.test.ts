/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { appStateIsForeground, bindForegroundSource } from "../foregroundBinding";
import { createWebForegroundSource } from "../foreground.web";

test("initially hidden browser can reenter through focus/pageshow even with stale visibilityState", () => {
  const documentTarget = Object.assign(new EventTarget(), { visibilityState: "hidden" });
  const windowTarget = new EventTarget();
  const states: boolean[] = [];
  const source = createWebForegroundSource(documentTarget, windowTarget);
  const unbind = bindForegroundSource({ setForeground: (active) => states.push(active) }, source);
  assert.deepEqual(states, [false]);
  windowTarget.dispatchEvent(new Event("focus")); assert.equal(states.at(-1), true); assert.equal(source.current(), true);
  windowTarget.dispatchEvent(new Event("pagehide")); assert.equal(states.at(-1), false);
  windowTarget.dispatchEvent(new Event("pageshow")); assert.equal(states.at(-1), true);
  documentTarget.dispatchEvent(new Event("visibilitychange")); assert.equal(states.at(-1), false);
  documentTarget.visibilityState = "visible"; documentTarget.dispatchEvent(new Event("visibilitychange"));
  assert.equal(states.at(-1), true);
  const count = states.length; unbind();
  windowTarget.dispatchEvent(new Event("focus")); windowTarget.dispatchEvent(new Event("pagehide"));
  documentTarget.dispatchEvent(new Event("visibilitychange")); assert.equal(states.length, count);
});

test("window blur alone does not pause a visible tab; online events belong to connectivity", () => {
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const win = new EventTarget(); const states: boolean[] = [];
  const unbind = bindForegroundSource({ setForeground: (active) => states.push(active) }, createWebForegroundSource(doc, win));
  win.dispatchEvent(new Event("blur")); win.dispatchEvent(new Event("offline")); win.dispatchEvent(new Event("online"));
  assert.deepEqual(states, [true]); unbind();
});

test("native AppState active only and cleanup are forwarded independently of network", () => {
  for (const value of [null, "unknown", "inactive", "background", "extension"]) assert.equal(appStateIsForeground(value), false);
  assert.equal(appStateIsForeground("active"), true);
  let listener: ((active: boolean) => void) | undefined;
  const states: boolean[] = [];
  const unbind = bindForegroundSource({ setForeground: (active) => states.push(active) }, {
    current: () => appStateIsForeground("background"),
    subscribe: (next) => { listener = next; return () => { listener = undefined; }; },
  });
  listener?.(appStateIsForeground("active")); listener?.(appStateIsForeground("inactive"));
  listener?.(appStateIsForeground("active")); assert.deepEqual(states, [false, true, false, true]);
  unbind(); assert.equal(listener, undefined);
});