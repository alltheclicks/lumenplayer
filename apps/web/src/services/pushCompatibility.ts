import { detectPlatform } from '@lumen/input';

export type PushSupportStatus = 'supported' | 'requires-install' | 'unsupported';

export interface PushCapabilityFlag {
  label: string;
  supported: boolean;
}

export interface PushCompatibilityResult {
  status: PushSupportStatus;
  message: string;
  platform: string;
  browser: string;
  isIOS: boolean;
  isStandalone: boolean;
  iosVersion: string | null;
  capabilityFlags: PushCapabilityFlag[];
}

export interface PushCompatibilityMatrixRow {
  target: string;
  status: PushSupportStatus;
  note: string;
}

const IOS_MIN_MAJOR = 16;
const IOS_MIN_MINOR = 4;

const isLikelyTvUserAgent = (userAgent: string): boolean => (
  /Tizen|Web0S|WebOS|SMART-TV|SmartTV|HbbTV|BRAVIA|AFT|CrKey/i.test(userAgent)
);

const parseIOSVersion = (userAgent: string): { major: number; minor: number } | null => {
  const match = userAgent.match(/OS (\d+)[._](\d+)/i);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
  };
};

const detectIOS = (): boolean => {
  const userAgent = window.navigator.userAgent;
  const hasIOSUserAgent = /iPad|iPhone|iPod/i.test(userAgent);
  const isIPadDesktopMode = window.navigator.platform === 'MacIntel'
    && window.navigator.maxTouchPoints > 1;
  return hasIOSUserAgent || isIPadDesktopMode;
};

const detectBrowser = (userAgent: string): string => {
  if (/Edg\//i.test(userAgent)) return 'Edge';
  if (/SamsungBrowser/i.test(userAgent)) return 'Samsung Internet';
  if (/Firefox\//i.test(userAgent)) return 'Firefox';
  if (/Chrome\//i.test(userAgent)) return 'Chrome';
  if (/Safari\//i.test(userAgent)) return 'Safari';
  return 'Unknown browser';
};

const getStandaloneMode = (): boolean => (
  window.matchMedia('(display-mode: standalone)').matches
  || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
);

const isIOSPushSupported = (version: { major: number; minor: number } | null): boolean => {
  if (!version) {
    return false;
  }

  if (version.major > IOS_MIN_MAJOR) {
    return true;
  }

  if (version.major < IOS_MIN_MAJOR) {
    return false;
  }

  return version.minor >= IOS_MIN_MINOR;
};

export const getPushCompatibilityMatrix = (): PushCompatibilityMatrixRow[] => [
  {
    target: 'iOS/iPadOS Safari tab',
    status: 'requires-install',
    note: 'Push requires Home Screen install (16.4+).',
  },
  {
    target: 'iOS/iPadOS Home Screen app',
    status: 'supported',
    note: 'Supported on iOS/iPadOS 16.4+.',
  },
  {
    target: 'Android Chromium browsers',
    status: 'supported',
    note: 'Chrome/Edge/Samsung Internet support web push.',
  },
  {
    target: 'Android Firefox',
    status: 'supported',
    note: 'Recent Firefox Android builds support push notifications.',
  },
  {
    target: 'Smart TV browsers (Tizen/WebOS)',
    status: 'unsupported',
    note: 'No reliable web push support; hide/disable opt-in flow.',
  },
];

export const evaluatePushCompatibility = (): PushCompatibilityResult => {
  const userAgent = window.navigator.userAgent;
  const platform = detectPlatform();
  const browser = detectBrowser(userAgent);
  const isIOS = detectIOS();
  const iosVersion = parseIOSVersion(userAgent);
  const isStandalone = getStandaloneMode();
  const hasSecureContext = window.isSecureContext || window.location.hostname === 'localhost';
  const hasServiceWorker = 'serviceWorker' in window.navigator;
  const hasPushManager = 'PushManager' in window;
  const hasNotifications = 'Notification' in window;

  const capabilityFlags: PushCapabilityFlag[] = [
    { label: 'Secure context', supported: hasSecureContext },
    { label: 'Service Worker API', supported: hasServiceWorker },
    { label: 'PushManager API', supported: hasPushManager },
    { label: 'Notification API', supported: hasNotifications },
  ];

  if (platform !== 'web' || isLikelyTvUserAgent(userAgent)) {
    return {
      status: 'unsupported',
      message: 'Push notifications are not supported on detected TV/browser platform.',
      platform,
      browser,
      isIOS,
      isStandalone,
      iosVersion: iosVersion ? `${iosVersion.major}.${iosVersion.minor}` : null,
      capabilityFlags,
    };
  }

  if (!hasSecureContext || !hasServiceWorker || !hasPushManager || !hasNotifications) {
    return {
      status: 'unsupported',
      message: 'This browser is missing required web push capabilities.',
      platform,
      browser,
      isIOS,
      isStandalone,
      iosVersion: iosVersion ? `${iosVersion.major}.${iosVersion.minor}` : null,
      capabilityFlags,
    };
  }

  if (isIOS && !isIOSPushSupported(iosVersion)) {
    return {
      status: 'unsupported',
      message: 'iOS/iPadOS push notifications require version 16.4 or newer.',
      platform,
      browser,
      isIOS,
      isStandalone,
      iosVersion: iosVersion ? `${iosVersion.major}.${iosVersion.minor}` : null,
      capabilityFlags,
    };
  }

  if (isIOS && !isStandalone) {
    return {
      status: 'requires-install',
      message: 'On iOS/iPadOS, install app to Home Screen to enable push notifications.',
      platform,
      browser,
      isIOS,
      isStandalone,
      iosVersion: iosVersion ? `${iosVersion.major}.${iosVersion.minor}` : null,
      capabilityFlags,
    };
  }

  return {
    status: 'supported',
    message: 'This device can run the web push opt-in flow.',
    platform,
    browser,
    isIOS,
    isStandalone,
    iosVersion: iosVersion ? `${iosVersion.major}.${iosVersion.minor}` : null,
    capabilityFlags,
  };
};
