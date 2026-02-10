export interface KeyCodeMap {
  left: number;
  up: number;
  right: number;
  down: number;
  enter: number;
  back: number;
  esc: number;
  exit: number;
  play: number;
  pause: number;
  stop: number;
  red: number;
  green: number;
  yellow: number;
  blue: number;
  smartPlayPause: number;
  channelUp: number;
  channelDown: number;
  done: number;
  cancel: number;
  backward: number;
  forward: number;
  record: number;
  0: number;
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
  6: number;
  7: number;
  8: number;
  9: number;
}

export const SamsungKeyCodes: KeyCodeMap = {
  left: 37,
  up: 38,
  right: 39,
  down: 40,
  enter: 13,
  back: 10009,
  exit: 10182,
  play: 415,
  pause: 19,
  stop: 413,
  red: 403,
  green: 404,
  yellow: 405,
  blue: 406,
  smartPlayPause: 10252,
  channelUp: 427,
  channelDown: 428,
  done: 65376,
  cancel: 65385,
  backward: 412,
  forward: 417,
  record: 416,
  0: 48,
  1: 49,
  2: 50,
  3: 51,
  4: 52,
  5: 53,
  6: 54,
  7: 55,
  8: 56,
  9: 57,
  esc: 27,
};

export const LgKeyCodes: KeyCodeMap = {
  left: 37,
  up: 38,
  right: 39,
  down: 40,
  enter: 13,
  back: 461,
  exit: 10182,
  play: 415,
  pause: 19,
  stop: 413,
  red: 403,
  green: 404,
  yellow: 405,
  blue: 406,
  smartPlayPause: 10252,
  channelUp: 33,
  channelDown: 34,
  done: 65376,
  cancel: 65385,
  backward: 412,
  forward: 417,
  record: 416,
  0: 48,
  1: 49,
  2: 50,
  3: 51,
  4: 52,
  5: 53,
  6: 54,
  7: 55,
  8: 56,
  9: 57,
  esc: 27,
};

export const WebKeyCodes: KeyCodeMap = {
  left: 37,
  up: 38,
  right: 39,
  down: 40,
  enter: 13,
  back: 8,
  exit: 27,
  play: 415,
  pause: 19,
  stop: 413,
  red: 403,
  green: 404,
  yellow: 405,
  blue: 406,
  smartPlayPause: 32, // Space
  channelUp: 33, // PageUp
  channelDown: 34, // PageDown
  done: 13,
  cancel: 27,
  backward: 37, // Left arrow
  forward: 39, // Right arrow
  record: 416,
  0: 48,
  1: 49,
  2: 50,
  3: 51,
  4: 52,
  5: 53,
  6: 54,
  7: 55,
  8: 56,
  9: 57,
  esc: 27,
};
