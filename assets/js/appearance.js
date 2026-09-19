// Run before the stylesheet so a saved preference is applied before first paint.
(() => {
  const key = "soham-appearance";
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  let preference = "system";
  try {
    const saved = localStorage.getItem(key);
    if (["light", "dark", "system"].includes(saved)) preference = saved;
  } catch (_) {
    /* Storage may be unavailable; the control still works. */
  }
  const apply = () => {
    const theme =
      preference === "system"
        ? system.matches
          ? "dark"
          : "light"
        : preference;
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "dark" ? "#161617" : "#ffffff";
  };
  apply();
  system.addEventListener("change", apply);
  window.addEventListener("storage", (event) => {
    if (event.key !== key && event.key !== null) return;
    preference = ["light", "dark"].includes(event.newValue)
      ? event.newValue
      : "system";
    apply();
    const control = document.querySelector("#appearance-select");
    if (control) control.value = preference;
  });
  document.addEventListener("DOMContentLoaded", () => {
    const control = document.querySelector("#appearance-select");
    if (!control) return;
    control.value = preference;
    control.closest(".appearance").hidden = false;
    control.addEventListener("change", () => {
      preference = control.value;
      try {
        localStorage.setItem(key, preference);
      } catch (_) {
        /* Optional persistence. */
      }
      apply();
    });
  });
})();
