// panels.js - left rail as tabs. One tool shown at a time at full height, plus
// a hide toggle for full-table mode. Persists the active tab and hidden state.
// Touches the shell only, never the modules that render into each panel body.

const STORE_KEY = "scanline.railState";

// Compact tab labels for the section titles (the panel bodies keep their ids).
const LABELS = {
  "Presets": "Presets",
  "Filters": "Filters",
  "Columns": "Columns",
  "Factor Score": "Factor",
  "Saved": "Saved",
};

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    return { active: typeof s.active === "string" ? s.active : null, hidden: !!s.hidden };
  } catch (err) {
    return { active: null, hidden: false };
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (err) {
    // A failed persist is not fatal.
  }
}

window.Screener.registerModule("panels", () => {
  const rail = document.getElementById("left-rail");
  const app = document.getElementById("app");
  if (!rail || !app) {
    console.warn("panels: rail or app shell not found, skipping.");
    return;
  }

  const sections = [...rail.querySelectorAll(".rail-section")];
  if (!sections.length) return;

  const state = loadState();
  let activeKey =
    state.active && sections.some((s) => keyOf(s) === state.active) ? state.active : keyOf(sections[0]);

  function keyOf(section) {
    const t = section.querySelector(".rail-title");
    return t ? t.textContent.trim() : "";
  }

  // ---- Build the tab strip.
  const tabs = document.createElement("div");
  tabs.className = "rail-tabs";

  const tabByKey = new Map();
  for (const section of sections) {
    const key = keyOf(section);
    const tab = document.createElement("button");
    tab.className = "rail-tab";
    tab.type = "button";
    tab.textContent = LABELS[key] || key;
    tab.title = key;
    tab.addEventListener("click", () => activate(key));
    tabs.appendChild(tab);
    tabByKey.set(key, tab);
  }

  // Hide-rail button at the end of the strip.
  const hideBtn = document.createElement("button");
  hideBtn.className = "rail-hide";
  hideBtn.type = "button";
  hideBtn.textContent = "«"; // left guillemet
  hideBtn.title = "Hide rail (\\)";
  hideBtn.addEventListener("click", () => (isNarrow() ? setOpen(false) : setHidden(true)));
  tabs.appendChild(hideBtn);

  rail.insertBefore(tabs, rail.firstChild);

  function activate(key) {
    activeKey = key;
    for (const section of sections) {
      const on = keyOf(section) === key;
      section.classList.toggle("active", on);
      const tab = tabByKey.get(keyOf(section));
      if (tab) tab.classList.toggle("active", on);
    }
    saveState({ active: activeKey, hidden: isHidden() });
  }

  // ---- Hide / show the whole rail.
  const reveal = document.createElement("div");
  reveal.id = "rail-reveal";
  reveal.textContent = "»"; // right guillemet
  reveal.title = "Show rail (\\)";
  reveal.addEventListener("click", () => setHidden(false));
  app.appendChild(reveal);

  function isHidden() {
    return app.classList.contains("rail-hidden");
  }
  function setHidden(hidden) {
    app.classList.toggle("rail-hidden", hidden);
    saveState({ active: activeKey, hidden });
  }

  // ---- Narrow viewports: the rail is an off-canvas drawer opened by a hamburger.
  const narrowMq = window.matchMedia("(max-width: 899.98px)");
  const toggleBtn = document.getElementById("rail-toggle");
  const scrim = document.getElementById("rail-scrim");
  function isNarrow() {
    return narrowMq.matches;
  }
  function isOpen() {
    return app.classList.contains("rail-open");
  }
  function setOpen(open) {
    app.classList.toggle("rail-open", open);
    if (toggleBtn) {
      toggleBtn.setAttribute("aria-expanded", String(open));
      toggleBtn.setAttribute("aria-label", open ? "Close tools panel" : "Open tools panel");
    }
    if (open) {
      const t = tabByKey.get(activeKey);
      if (t) t.focus({ preventScroll: true });
    } else if (toggleBtn && rail.contains(document.activeElement)) {
      toggleBtn.focus({ preventScroll: true });
    }
  }
  if (toggleBtn) toggleBtn.addEventListener("click", () => setOpen(!isOpen()));
  if (scrim) scrim.addEventListener("click", () => setOpen(false));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen() && isNarrow()) setOpen(false);
  });
  const onMq = () => {
    if (!isNarrow()) setOpen(false);
  };
  if (narrowMq.addEventListener) narrowMq.addEventListener("change", onMq);

  // Backslash toggles the rail, except while typing in a field.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "\\" || e.ctrlKey || e.metaKey || e.altKey) return;
    const el = document.activeElement;
    const tag = el && el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el && el.isContentEditable)) return;
    e.preventDefault();
    if (isNarrow()) setOpen(!isOpen());
    else setHidden(!isHidden());
  });

  // ---- Apply persisted state.
  activate(activeKey);
  if (state.hidden) setHidden(true);

  // When another module wants to surface a tool (e.g. focus filters), allow a
  // custom event to switch tabs and reveal the rail.
  document.addEventListener("neon:rail-show", (e) => {
    const key = e.detail && e.detail.tab;
    if (key && tabByKey.has(key)) activate(key);
    setHidden(false);
    if (isNarrow()) setOpen(true);
  });
});
