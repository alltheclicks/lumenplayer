import type { ShellController, ShellState } from "./testing/shellState.mjs";
import { createShellController } from "./testing/shellState.mjs";
import { FixturePlayerAdapter } from "./testing/fixturePlayerAdapter.mjs";
import { moveFocus, remoteAction } from "./focus/focusGrid.mjs";
import { messages, type LanguageCode } from "./i18n/messages";
import { productIdentity } from "./config/productIdentity";
import "./ui/styles.css";

const app = document.querySelector<HTMLDivElement>("#app") as HTMLDivElement;
if (!app) throw new Error("TV app root is missing.");

let storage: Pick<Storage, "getItem" | "setItem"> | undefined;
try {
  const localStorage = window.localStorage;
  storage = {
    getItem(key) {
      try { return localStorage.getItem(key); } catch { return null; }
    },
    setItem(key, value) {
      try { localStorage.setItem(key, value); } catch { /* Continue with the in-memory selection. */ }
    },
  };
} catch {
  storage = undefined;
}

const controller: ShellController = createShellController({ storage, adapter: new FixturePlayerAdapter() });
const supportedLanguages = Object.keys(messages) as LanguageCode[];

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function render(state: ShellState): void {
  const text = messages[state.language as LanguageCode] || messages.en;
  const isRtl = state.language === "ar";
  document.documentElement.lang = state.language;
  document.documentElement.dir = isRtl ? "rtl" : "ltr";
  document.title = productIdentity.displayName;

  if (state.screen === "settings") {
    app.innerHTML = `
      <div class="shell" dir="${isRtl ? "rtl" : "ltr"}">
        <aside class="rail"><div class="brand-mark" aria-hidden="true">K</div><div class="rail-label">${escapeHtml(productIdentity.displayName)}</div></aside>
        <main class="content settings-content">
          <div class="eyebrow">${escapeHtml(text.status)}</div>
          <h1>${escapeHtml(text.settingsTitle)}</h1>
          <p>${escapeHtml(text.settingsHint)}</p>
          <label class="field-label" for="language">${escapeHtml(text.language)}</label>
          <select id="language" data-focusable="language" data-focus-row="1" data-focus-col="1" aria-label="${escapeHtml(text.language)}">
            ${supportedLanguages.map((language) => `<option value="${language}"${state.language === language ? " selected" : ""}>${escapeHtml(messages[language].languageName)}</option>`).join("")}
          </select>
          <button class="secondary-button" data-focusable="back" data-focus-row="2" data-focus-col="1">${escapeHtml(text.back)}</button>
        </main>
      </div>`;
    app.querySelector<HTMLSelectElement>("#language")?.addEventListener("change", (event) => {
      controller.setLanguage((event.currentTarget as HTMLSelectElement).value);
    });
  } else if (state.screen === "playback") {
    app.innerHTML = `
      <div class="shell" dir="${isRtl ? "rtl" : "ltr"}">
        <aside class="rail"><div class="brand-mark" aria-hidden="true">K</div><div class="rail-label">${escapeHtml(productIdentity.displayName)}</div></aside>
        <main class="content playback-content">
          <div class="eyebrow">${escapeHtml(text.status)}</div>
          <h1>${escapeHtml(text.playbackTitle)}</h1>
          <section class="screen-columns">
            <div class="video-panel" aria-label="No playback">
              <div class="video-mark" aria-hidden="true">▶</div>
              <p>${escapeHtml(state.playback === "loading" ? text.loading : text.errorTitle)}</p>
              <span>${escapeHtml(text.fixture)}</span>
            </div>
            <div class="status-panel" role="status" aria-live="polite">
              <h2>${escapeHtml(state.playback === "loading" ? text.loading : text.errorTitle)}</h2>
              <p>${escapeHtml(state.error || text.errorBody)}</p>
              <p class="fixture-note">${escapeHtml(text.errorBody)}</p>
            </div>
          </section>
          <button class="secondary-button" data-focusable="back" data-focus-row="1" data-focus-col="1">${escapeHtml(text.back)}</button>
        </main>
      </div>`;
  } else {
    app.innerHTML = `
      <div class="shell" dir="${isRtl ? "rtl" : "ltr"}">
        <aside class="rail"><div class="brand-mark" aria-hidden="true">K</div><div class="rail-label">${escapeHtml(productIdentity.displayName)}</div></aside>
        <main class="content launch-content">
          <div class="eyebrow">${escapeHtml(text.status)}</div>
          <h1>${escapeHtml(text.launchTitle)}</h1>
          <p class="tagline">${escapeHtml(text.tagline)}</p>
          <p class="description">${escapeHtml(text.launchBody)}</p>
          <div class="actions">
            <button class="primary-button" data-focusable="launch" data-focus-row="0" data-focus-col="1">${escapeHtml(text.openTest)}</button>
            <button class="secondary-button" data-focusable="settings" data-focus-row="1" data-focus-col="1">${escapeHtml(text.settings)}</button>
          </div>
          <p class="fixture-note">${escapeHtml(text.fixture)}</p>
        </main>
      </div>`;
  }

  app.querySelector<HTMLElement>("[data-focusable]")?.focus();
}

controller.subscribe(render);
render(controller.getState());

app.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const focusable = target.closest<HTMLElement>("[data-focusable]");
  if (!focusable) return;
  if (focusable.dataset.focusable === "settings") controller.openSettings();
  if (focusable.dataset.focusable === "launch") void controller.startTest();
  if (focusable.dataset.focusable === "back") controller.back();
});

app.addEventListener("keydown", (event) => {
  const action = remoteAction(event.key, event.keyCode);
  if (action === "back") {
    event.preventDefault();
    controller.back();
    return;
  }
  if (!["left", "right", "up", "down"].includes(action)) return;
  const items = Array.from(app.querySelectorAll<HTMLElement>("[data-focusable]"))
    .map((item) => ({ id: item.dataset.focusable || "", row: Number(item.dataset.focusRow), col: Number(item.dataset.focusCol), element: item }));
  const current = (document.activeElement as HTMLElement | null)?.dataset.focusable || "";
  const next = moveFocus(current, action as "left" | "right" | "up" | "down", items);
  const destination = items.find((item) => item.id === next)?.element;
  if (destination) {
    event.preventDefault();
    destination.focus();
  }
});
