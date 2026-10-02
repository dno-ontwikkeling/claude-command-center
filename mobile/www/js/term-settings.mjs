// Phone terminal settings: stored on the phone only, never sent to the desktop
// (the desktop keeps its own in renderer/settings.js). Pure — storage is
// injected — so it is unit tested.

const KEY = 'cc.termSettings';

export const DEFAULTS = Object.freeze({ fontSize: 11, fontFamily: 'monospace', theme: 'system', scrollback: 5000 });

export const FONT_FAMILIES = [
  { value: 'monospace', label: 'System monospace' },
  { value: '"Roboto Mono", monospace', label: 'Roboto Mono' },
  { value: '"Droid Sans Mono", monospace', label: 'Droid Sans Mono' },
  { value: '"Cutive Mono", monospace', label: 'Cutive Mono' },
];

const clampInt = (v, min, max, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

export function normalize(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    fontSize: clampInt(s.fontSize, 8, 24, DEFAULTS.fontSize),
    fontFamily:
      typeof s.fontFamily === 'string' && s.fontFamily.trim() && s.fontFamily.length <= 100
        ? s.fontFamily
        : DEFAULTS.fontFamily,
    theme: ['system', 'dark', 'light'].includes(s.theme) ? s.theme : DEFAULTS.theme,
    scrollback: clampInt(s.scrollback, 500, 20000, DEFAULTS.scrollback),
  };
}

export const resolveTheme = (theme, prefersDark) =>
  theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;

// Same palettes as the desktop terminal (Campbell / One Half Light).
const DARK = {
  background: '#0C0C0C',
  foreground: '#CCCCCC',
  cursor: '#FFFFFF',
  cursorAccent: '#0C0C0C',
  selectionBackground: '#FFFFFF44',
  black: '#0C0C0C',
  red: '#C50F1F',
  green: '#13A10E',
  yellow: '#C19C00',
  blue: '#0037DA',
  magenta: '#881798',
  cyan: '#3A96DD',
  white: '#CCCCCC',
  brightBlack: '#767676',
  brightRed: '#E74856',
  brightGreen: '#16C60C',
  brightYellow: '#F9F1A5',
  brightBlue: '#3B78FF',
  brightMagenta: '#B4009E',
  brightCyan: '#61D6D6',
  brightWhite: '#F2F2F2',
};

const LIGHT = {
  background: '#FAFAFA',
  foreground: '#383A42',
  cursor: '#4F525E',
  cursorAccent: '#FAFAFA',
  selectionBackground: '#0037DA33',
  black: '#383A42',
  red: '#E45649',
  green: '#50A14F',
  yellow: '#C18401',
  blue: '#0184BC',
  magenta: '#A626A4',
  cyan: '#0997B3',
  white: '#FAFAFA',
  brightBlack: '#4F525E',
  brightRed: '#E45649',
  brightGreen: '#50A14F',
  brightYellow: '#C18401',
  brightBlue: '#0184BC',
  brightMagenta: '#A626A4',
  brightCyan: '#0997B3',
  brightWhite: '#FFFFFF',
};

export const palette = (theme) => ({ ...(theme === 'light' ? LIGHT : DARK) });

export function xtermOptions(settings, prefersDark) {
  return {
    fontSize: settings.fontSize,
    fontFamily: settings.fontFamily,
    scrollback: settings.scrollback,
    theme: palette(resolveTheme(settings.theme, prefersDark)),
  };
}

// get / update(patch) / subscribe(cb). Storage failures (private mode, quota)
// degrade to in-memory settings instead of breaking the terminal.
export function createSettingsStore(storage) {
  let value;
  try {
    const raw = storage.getItem(KEY);
    value = normalize(raw ? JSON.parse(raw) : null);
  } catch {
    value = { ...DEFAULTS };
  }
  const subs = new Set();
  return {
    get: () => value,
    update(patch) {
      value = normalize({ ...value, ...patch });
      try {
        storage.setItem(KEY, JSON.stringify(value));
      } catch {
        /* keep the in-memory value */
      }
      for (const cb of subs) cb(value);
      return value;
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}
