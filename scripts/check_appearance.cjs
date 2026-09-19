// Regression checks for preference resolution and optional storage behavior.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("assets/js/appearance.js", "utf8");
function boot({ saved, dark = false, blocked = false } = {}) {
  const events = {},
    controlEvents = {},
    systemEvents = {},
    storage = new Map();
  if (saved !== undefined) storage.set("soham-appearance", saved);
  const root = { dataset: {} },
    meta = {},
    wrapper = { hidden: true };
  const control = {
    value: "system",
    closest: () => wrapper,
    addEventListener: (n, f) => (controlEvents[n] = f),
  };
  const system = {
    matches: dark,
    addEventListener: (n, f) => (systemEvents[n] = f),
  };
  const document = {
    documentElement: root,
    querySelector: (s) => (s.includes("meta[") ? meta : control),
    addEventListener: (n, f) => (events[n] = f),
  };
  const window = {
    matchMedia: () => system,
    addEventListener: (n, f) => (events[n] = f),
  };
  const localStorage = {
    getItem: (k) => {
      if (blocked) throw Error("blocked");
      return storage.get(k);
    },
    setItem: (k, v) => {
      if (blocked) throw Error("blocked");
      storage.set(k, v);
    },
  };
  vm.runInNewContext(source, { window, document, localStorage });
  const initial = root.dataset.theme;
  events.DOMContentLoaded();
  return {
    root,
    meta,
    control,
    wrapper,
    storage,
    initial,
    choose: (v) => {
      control.value = v;
      controlEvents.change();
    },
    systemChange: (v) => {
      system.matches = v;
      systemEvents.change();
    },
    crossTab: (v) => events.storage({ key: "soham-appearance", newValue: v }),
  };
}
let page = boot({ dark: true });
assert.equal(page.initial, "dark");
assert.equal(page.wrapper.hidden, false);
page.choose("light");
assert.equal(page.root.dataset.theme, "light");
page.systemChange(true);
assert.equal(page.root.dataset.theme, "light");
assert.equal(
  boot({ saved: page.storage.get("soham-appearance"), dark: true }).initial,
  "light",
);
page.choose("system");
page.systemChange(false);
assert.equal(page.root.dataset.theme, "light");
page.systemChange(true);
assert.equal(page.root.dataset.theme, "dark");
page.crossTab("light");
assert.equal(page.control.value, "light");
assert.equal(page.root.dataset.theme, "light");
page.crossTab(null);
assert.equal(page.control.value, "system");
assert.equal(page.root.dataset.theme, "dark");
page = boot({ blocked: true });
page.choose("dark");
assert.equal(page.root.dataset.theme, "dark");
assert.equal(page.meta.content, "#161617");
assert.equal(boot({ saved: "unexpected", dark: true }).initial, "dark");
console.log(
  "PASS: first-paint theme, explicit override, persistence, live system changes, cross-tab sync, invalid preferences, blocked storage",
);
