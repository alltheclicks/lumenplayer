export const localeIds = ["en", "de", "sr-Latn", "sr-Cyrl"] as const;

export type Locale = (typeof localeIds)[number];

export interface Messages {
  appName: string;
  platformCaption: string;
  tagline: string;
  intro: string;
  description: string;
  openPlayback: string;
  settings: string;
  language: string;
  back: string;
  chooseLanguage: string;
  home: string;
  playbackTitle: string;
  playbackDescription: string;
  streamUrl: string;
  startPlayback: string;
  stateIdle: string;
  stateLoading: string;
  statePlaying: string;
  stateError: string;
  noPlaybackAdapter: string;
  loadLanguageError: string;
  saveLanguageError: string;
  remoteHint: string;
}

const english: Messages = {
  appName: "Klaro Player",
  platformCaption: "ANDROID TV",
  tagline: "ONE SETUP. EVERY SCREEN.",
  intro: "Your TV, ready for Klaro",
  description:
    "A focused Android TV shell for your own sources. Choose a language or open the playback test.",
  openPlayback: "Open playback test",
  settings: "Settings",
  language: "Language",
  back: "Back",
  chooseLanguage: "Choose your language",
  home: "Home",
  playbackTitle: "Playback test",
  playbackDescription:
    "Enter a stream URL to check the shell. Playback is unavailable until the Android Media3 adapter is added.",
  streamUrl: "HLS stream URL (optional)",
  startPlayback: "Start playback test",
  stateIdle: "Ready to test",
  stateLoading: "Loading stream…",
  statePlaying: "Playback adapter connected",
  stateError: "Playback could not start",
  noPlaybackAdapter:
    "No real playback in this build. The Android Media3 adapter is not connected yet.",
  loadLanguageError: "Language preference could not be loaded. English is selected.",
  saveLanguageError: "Language preference could not be saved on this device.",
  remoteHint: "Use the remote arrows to move, OK to select, and Back to return.",
};

const messages: Record<Locale, Messages> = {
  en: english,
  de: {
    ...english,
    intro: "Dein Fernseher ist bereit für Klaro",
    platformCaption: "ANDROID TV",
    tagline: "EINRICHTEN. AUF JEDEM BILDSCHIRM.",
    description:
      "Eine Android-TV-Oberfläche für deine eigenen Quellen. Wähle eine Sprache oder öffne den Wiedergabetest.",
    openPlayback: "Wiedergabetest öffnen",
    settings: "Einstellungen",
    language: "Sprache",
    back: "Zurück",
    chooseLanguage: "Sprache auswählen",
    home: "Start",
    playbackTitle: "Wiedergabetest",
    playbackDescription:
      "Gib eine Stream-URL ein. Wiedergabe ist erst verfügbar, wenn der Android-Media3-Adapter hinzugefügt wurde.",
    streamUrl: "HLS-Stream-URL (optional)",
    startPlayback: "Wiedergabetest starten",
    stateIdle: "Bereit zum Testen",
    stateLoading: "Stream wird geladen…",
    statePlaying: "Wiedergabeadapter verbunden",
    stateError: "Wiedergabe konnte nicht starten",
    noPlaybackAdapter:
      "In diesem Build gibt es keine echte Wiedergabe. Der Android-Media3-Adapter ist noch nicht verbunden.",
    loadLanguageError: "Spracheinstellung konnte nicht geladen werden. Englisch ist ausgewählt.",
    saveLanguageError: "Spracheinstellung konnte nicht auf diesem Gerät gespeichert werden.",
    remoteHint: "Pfeiltasten bewegen, OK wählt aus, Zurück kehrt zurück.",
  },
  "sr-Latn": {
    ...english,
    intro: "Vaš TV je spreman za Klaro",
    platformCaption: "ANDROID TV",
    tagline: "JEDNO PODEŠAVANJE. SVAKI EKRAN.",
    description:
      "Android TV početni ekran za vaše izvore. Izaberite jezik ili otvorite test reprodukcije.",
    openPlayback: "Otvori test reprodukcije",
    settings: "Podešavanja",
    language: "Jezik",
    back: "Nazad",
    chooseLanguage: "Izaberite jezik",
    home: "Početna",
    playbackTitle: "Test reprodukcije",
    playbackDescription:
      "Unesite adresu toka za proveru ekrana. Reprodukcija nije dostupna dok se ne doda Android Media3 adapter.",
    streamUrl: "HLS adresa toka (opciono)",
    startPlayback: "Pokreni test reprodukcije",
    stateIdle: "Spremno za test",
    stateLoading: "Učitavanje toka…",
    statePlaying: "Adapter reprodukcije je povezan",
    stateError: "Reprodukcija nije pokrenuta",
    noPlaybackAdapter:
      "Ova verzija ne reprodukuje stvarni sadržaj. Android Media3 adapter još nije povezan.",
    loadLanguageError: "Jezik nije učitan. Izabran je engleski.",
    saveLanguageError: "Jezik nije sačuvan na ovom uređaju.",
    remoteHint: "Strelice pomeraju fokus, OK bira, a Nazad vraća na početni ekran.",
  },
  "sr-Cyrl": {
    ...english,
    intro: "Ваш ТВ је спреман за Klaro",
    platformCaption: "ANDROID TV",
    tagline: "ЈЕДНО ПОДЕШАВАЊЕ. СВАКИ ЕКРАН.",
    description:
      "Android TV почетни екран за ваше изворе. Изаберите језик или отворите тест репродукције.",
    openPlayback: "Отвори тест репродукције",
    settings: "Подешавања",
    language: "Језик",
    back: "Назад",
    chooseLanguage: "Изаберите језик",
    home: "Почетна",
    playbackTitle: "Тест репродукције",
    playbackDescription:
      "Унесите адресу тока за проверу екрана. Репродукција није доступна док се не дода Android Media3 адаптер.",
    streamUrl: "HLS адреса тока (опционо)",
    startPlayback: "Покрени тест репродукције",
    stateIdle: "Спремно за тест",
    stateLoading: "Учитавање тока…",
    statePlaying: "Адаптер репродукције је повезан",
    stateError: "Репродукција није покренута",
    noPlaybackAdapter:
      "Ова верзија не репродукује стварни садржај. Android Media3 адаптер још није повезан.",
    loadLanguageError: "Језик није учитан. Изабран је енглески.",
    saveLanguageError: "Језик није сачуван на овом уређају.",
    remoteHint: "Стрелице померају фокус, OK бира, а Назад враћа на почетни екран.",
  },
};

export const languageOptions: ReadonlyArray<{ id: Locale; nativeName: string }> = [
  { id: "en", nativeName: "English" },
  { id: "de", nativeName: "Deutsch" },
  { id: "sr-Latn", nativeName: "Srpski (latinica)" },
  { id: "sr-Cyrl", nativeName: "Српски (ћирилица)" },
];

export function isLocale(value: string | null | undefined): value is Locale {
  return value != null && localeIds.includes(value as Locale);
}

export function getMessages(locale: string | null | undefined): Messages {
  return isLocale(locale) ? messages[locale] : english;
}
