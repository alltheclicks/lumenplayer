import type { ShellController, ShellState } from "./testing/shellState.mjs";
import { createShellController } from "./testing/shellState.mjs";
import { buildTarget, buildSourceOrigins, createPlatformPlayback } from "./composition/platform";
import type { AVPlay } from "./adapters/tizen/avplay";
import { ensureCancellation } from "./composition/cancellation";
import { moveFocus, remoteAction } from "./focus/focusGrid.mjs";
import { messages, type LanguageCode } from "./i18n/messages";
import { productIdentity } from "./config/productIdentity";
import "./ui/styles.css";

ensureCancellation(window);

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

document.documentElement.dataset.tvTarget = buildTarget;
const mediaMount = document.createElement("div");
mediaMount.id = "media-surface";
mediaMount.hidden = true;
document.body.insertBefore(mediaMount, app);
const platformWindow = window as Window & { webapis?: { avplay?: AVPlay }; webOS?: unknown; PalmSystem?: unknown };
const createPlaybackController = createPlatformPlayback({ target: buildTarget, document, mount: mediaMount,
  sourceOrigins: buildSourceOrigins, avplay: platformWindow.webapis?.avplay, webOSAvailable: !!(platformWindow.webOS || platformWindow.PalmSystem) });

const controller: ShellController = createShellController({ storage, createPlaybackController });
const supportedLanguages = Object.keys(messages) as LanguageCode[];

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

let renderedScreen = "";
function render(state: ShellState): void {
  const previousFocus = (document.activeElement as HTMLElement | null)?.dataset.focusable;
  const text = messages[state.language as LanguageCode] || messages.en;
  const isRtl = state.language === "ar";
  document.documentElement.lang = state.language;
  document.documentElement.dir = isRtl ? "rtl" : "ltr";
  document.title = productIdentity.displayName;

  mediaMount.hidden = state.screen !== "playback";
  document.body.classList.toggle("playing-screen", state.screen === "playback");
  document.documentElement.classList.toggle("playing-screen", state.screen === "playback");
  const statusText = text.states[state.playback] || text.states.idle;
  const errorText = state.error ? (text.errors[state.error as keyof typeof text.errors] || text.errors.playback_failed) : "";
  // Status notifications must never detach or recreate the media surface.
  if (state.screen === "playback" && renderedScreen === "playback") {
    const status = app.querySelector("[data-playback-status]");
    const error = app.querySelector("[data-playback-error]");
    if (status) status.textContent = statusText;
    if (error) error.textContent = errorText;
    return;
  }
  renderedScreen = state.screen;

  if (state.screen === "settings") {
    app.innerHTML = `
      <div class="shell" dir="${isRtl ? "rtl" : "ltr"}">
        <aside class="rail"><div class="brand-mark" aria-hidden="true">K</div><div class="rail-label">${escapeHtml(productIdentity.displayName)}</div></aside>
        <main class="content settings-content">
          <div class="eyebrow">${escapeHtml(text.status)}</div>
          <h1>${escapeHtml(text.settingsTitle)}</h1>
          <p>${escapeHtml(text.settingsHint)}</p>
          <div class="field-label" id="language-label">${escapeHtml(text.language)}</div>
          <div class="language-options" role="group" aria-labelledby="language-label">
            ${supportedLanguages.map((language, index) => `<button class="secondary-button" data-language="${language}" data-focusable="language-${language}" data-focus-row="${index}" data-focus-col="1" aria-pressed="${state.language === language}">${escapeHtml(messages[language].languageName)}</button>`).join("")}
          </div>
          <button class="secondary-button" data-focusable="back" data-focus-row="${supportedLanguages.length}" data-focus-col="1">${escapeHtml(text.back)}</button>
        </main>
      </div>`;
  } else if (state.screen === "playback") {
    app.innerHTML = `
      <div class="shell" dir="${isRtl ? "rtl" : "ltr"}">
        <aside class="rail"><div class="brand-mark" aria-hidden="true">K</div><div class="rail-label">${escapeHtml(productIdentity.displayName)}</div></aside>
        <main class="content playback-content">
          <div class="eyebrow">${escapeHtml(text.status)}</div>
          <h1>${escapeHtml(text.playbackTitle)}</h1>
          <section class="screen-columns">
            <div class="status-panel" role="status" aria-live="polite">
              <h2 data-playback-status>${escapeHtml(statusText)}</h2>
              <p data-playback-error>${escapeHtml(errorText)}</p>
            </div>
          </section>
          <button class="secondary-button" data-focusable="settings" data-focus-row="1" data-focus-col="2">${escapeHtml(text.settings)}</button>
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
          <label for="live-url">${escapeHtml(text.urlLabel)}</label>
          <input id="live-url" type="password" autocomplete="off" spellcheck="false" dir="ltr" data-focusable="url" data-focus-row="0" data-focus-col="0" />
          <div class="actions">
            <button class="primary-button" data-focusable="launch" data-focus-row="0" data-focus-col="1">${escapeHtml(text.openTest)}</button>
            <button class="secondary-button" data-focusable="settings" data-focus-row="0" data-focus-col="2">${escapeHtml(text.settings)}</button>
          </div>
          <p class="fixture-note">${escapeHtml(text.fixture)}</p>
        </main>
      </div>`;
  }

  const focusables = Array.from(app.querySelectorAll<HTMLElement>("[data-focusable]"));
  (focusables.find((item) => item.dataset.focusable === previousFocus) || focusables[0])?.focus();
}

controller.subscribe(render);
render(controller.getState());

app.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const focusable = target.closest<HTMLElement>("[data-focusable]");
  if (!focusable) return;
  if (focusable.dataset.language) controller.setLanguage(focusable.dataset.language);
  if (focusable.dataset.focusable === "settings") controller.openSettings();
  if (focusable.dataset.focusable === "launch") {
    const input = app.querySelector<HTMLInputElement>("#live-url");
    const url = input?.value || "";
    if (input) input.value = "";
    void controller.startTest(url);
  }
  if (focusable.dataset.focusable === "back") controller.back();
});

app.addEventListener("keydown", (event) => {
  const action = remoteAction(event.key, event.keyCode);
  if (action === "ok" && document.activeElement instanceof HTMLButtonElement) {
    event.preventDefault();
    if (!event.repeat) document.activeElement.click();
    return;
  }
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

document.addEventListener("visibilitychange", () => {
  if (document.hidden) controller.back();
});
window.addEventListener("pagehide", (event) => {
  const input = app.querySelector<HTMLInputElement>("#live-url");
  if (input) input.value = "";
  controller.back();
  if (!event.persisted) controller.destroy();
});
