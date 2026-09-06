/**
 * Theme color definitions for Arsivinyo Media Downloader
 * 
 * Each theme defines a complete color palette that can be easily swapped.
 * The structure is designed to be extensible - just add a new theme object.
 */

export interface ThemeColors {
    // Core backgrounds
    background: string;
    surface: string;
    surfaceHover: string;
    surfaceActive: string;

    // Text colors
    text: string;
    textMuted: string;
    textSubtle: string;

    // Primary action color
    primary: string;
    primaryHover: string;
    primaryText: string;

    // Accent colors
    accent: string;
    accentHover: string;

    // Borders and dividers
    border: string;
    borderSubtle: string;

    // Status colors
    success: string;
    error: string;
    warning: string;
    info: string;

    // Special
    overlay: string;
}

// ============================================
// DARK THEMES
// ============================================

export const darkZinc: ThemeColors = {
    background: '#09090b',
    surface: '#18181b',
    surfaceHover: '#27272a',
    surfaceActive: '#3f3f46',

    text: '#fafafa',
    textMuted: '#a1a1aa',
    textSubtle: '#71717a',

    primary: '#f4f4f5',
    primaryHover: '#e4e4e7',
    primaryText: '#09090b',

    accent: '#22d3ee',
    accentHover: '#06b6d4',

    border: '#27272a',
    borderSubtle: '#3f3f46',

    success: '#22c55e',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6',

    overlay: 'rgba(0, 0, 0, 0.7)',
};

export const darkSlate: ThemeColors = {
    background: '#020617',
    surface: '#0f172a',
    surfaceHover: '#1e293b',
    surfaceActive: '#334155',

    text: '#f8fafc',
    textMuted: '#94a3b8',
    textSubtle: '#64748b',

    primary: '#e2e8f0',
    primaryHover: '#cbd5e1',
    primaryText: '#020617',

    accent: '#60a5fa',
    accentHover: '#3b82f6',

    border: '#1e293b',
    borderSubtle: '#334155',

    success: '#22c55e',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6',

    overlay: 'rgba(2, 6, 23, 0.7)',
};

export const darkCrimson: ThemeColors = {
    background: '#0a0a0a',
    surface: '#171717',
    surfaceHover: '#262626',
    surfaceActive: '#404040',

    text: '#fafafa',
    textMuted: '#a3a3a3',
    textSubtle: '#737373',

    primary: '#dc2626',
    primaryHover: '#b91c1c',
    primaryText: '#ffffff',

    accent: '#f87171',
    accentHover: '#ef4444',

    border: '#262626',
    borderSubtle: '#404040',

    success: '#22c55e',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6',

    overlay: 'rgba(10, 10, 10, 0.7)',
};

export const darkEmerald: ThemeColors = {
    background: '#022c22',
    surface: '#064e3b',
    surfaceHover: '#065f46',
    surfaceActive: '#047857',

    text: '#ecfdf5',
    textMuted: '#a7f3d0',
    textSubtle: '#6ee7b7',

    primary: '#10b981',
    primaryHover: '#059669',
    primaryText: '#022c22',

    accent: '#34d399',
    accentHover: '#10b981',

    border: '#065f46',
    borderSubtle: '#047857',

    success: '#22c55e',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6',

    overlay: 'rgba(2, 44, 34, 0.7)',
};


// Editor-inspired dark palettes. Written for this app rather than copied from any
// particular scheme: each takes a familiar editor mood — cool low-contrast, warm
// terminal, high-contrast mono-ish, violet — and picks its own values so the app has
// its own identity and no dependency on someone else's brand.

/** Cool, low-contrast blue-grey. The long-session editor look. */
export const darkMidnight: ThemeColors = {
    background: '#0f1419',
    surface: '#171d25',
    surfaceHover: '#212936',
    surfaceActive: '#2d3748',

    text: '#e2e8f0',
    textMuted: '#94a3b8',
    textSubtle: '#64748b',

    primary: '#e2e8f0',
    primaryHover: '#cbd5e1',
    primaryText: '#0f1419',

    accent: '#7aa2f7',
    accentHover: '#5d87e8',

    border: '#212936',
    borderSubtle: '#2d3748',

    success: '#9ece6a',
    error: '#f7768e',
    warning: '#e0af68',
    info: '#7dcfff',

    overlay: 'rgba(0, 0, 0, 0.7)',
};

/** Warm browns with an amber accent. The old-terminal mood. */
export const darkEmber: ThemeColors = {
    background: '#1a1512',
    surface: '#241d18',
    surfaceHover: '#322820',
    surfaceActive: '#43352a',

    text: '#f5ebe0',
    textMuted: '#b9a48f',
    textSubtle: '#8a7663',

    primary: '#f5ebe0',
    primaryHover: '#e6d7c7',
    primaryText: '#1a1512',

    accent: '#f0a35e',
    accentHover: '#dc8a41',

    border: '#322820',
    borderSubtle: '#43352a',

    success: '#8fb573',
    error: '#e26d5c',
    warning: '#e6b450',
    info: '#7aa6c2',

    overlay: 'rgba(0, 0, 0, 0.72)',
};

/** True black with a green accent. Highest contrast, and kindest to OLED panels. */
export const darkCarbon: ThemeColors = {
    background: '#000000',
    surface: '#0d0d0d',
    surfaceHover: '#1a1a1a',
    surfaceActive: '#262626',

    text: '#ffffff',
    textMuted: '#a3a3a3',
    textSubtle: '#737373',

    primary: '#ffffff',
    primaryHover: '#e5e5e5',
    primaryText: '#000000',

    accent: '#a3e635',
    accentHover: '#84cc16',

    border: '#262626',
    borderSubtle: '#404040',

    success: '#4ade80',
    error: '#f87171',
    warning: '#fbbf24',
    info: '#60a5fa',

    overlay: 'rgba(0, 0, 0, 0.8)',
};

/** Violet-tinted dark with a bright accent. */
export const darkOrchid: ThemeColors = {
    background: '#14101a',
    surface: '#1e1828',
    surfaceHover: '#2a2136',
    surfaceActive: '#382c47',

    text: '#ede9f5',
    textMuted: '#a99fc0',
    textSubtle: '#7d7395',

    primary: '#ede9f5',
    primaryHover: '#d9d2e8',
    primaryText: '#14101a',

    accent: '#c084fc',
    accentHover: '#a855f7',

    border: '#2a2136',
    borderSubtle: '#382c47',

    success: '#7ee0a8',
    error: '#ff7a8a',
    warning: '#f5c56b',
    info: '#8fb8ff',

    overlay: 'rgba(0, 0, 0, 0.72)',
};

// ============================================
// LIGHT THEMES
// ============================================

export const lightNeutral: ThemeColors = {
    background: '#ffffff',
    surface: '#f5f5f5',
    surfaceHover: '#e5e5e5',
    surfaceActive: '#d4d4d4',

    text: '#171717',
    textMuted: '#525252',
    textSubtle: '#737373',

    primary: '#171717',
    primaryHover: '#262626',
    primaryText: '#ffffff',

    accent: '#6366f1',
    accentHover: '#4f46e5',

    border: '#e5e5e5',
    borderSubtle: '#d4d4d4',

    success: '#16a34a',
    error: '#dc2626',
    warning: '#d97706',
    info: '#2563eb',

    overlay: 'rgba(0, 0, 0, 0.5)',
};

export const lightWarm: ThemeColors = {
    background: '#fffbeb',
    surface: '#fef3c7',
    surfaceHover: '#fde68a',
    surfaceActive: '#fcd34d',

    text: '#451a03',
    textMuted: '#78350f',
    textSubtle: '#92400e',

    primary: '#b45309',
    primaryHover: '#92400e',
    primaryText: '#ffffff',

    accent: '#f97316',
    accentHover: '#ea580c',

    border: '#fde68a',
    borderSubtle: '#fcd34d',

    success: '#16a34a',
    error: '#dc2626',
    warning: '#d97706',
    info: '#2563eb',

    overlay: 'rgba(69, 26, 3, 0.5)',
};

export const lightCool: ThemeColors = {
    background: '#f0f9ff',
    surface: '#e0f2fe',
    surfaceHover: '#bae6fd',
    surfaceActive: '#7dd3fc',

    text: '#0c4a6e',
    textMuted: '#0369a1',
    textSubtle: '#0284c7',

    primary: '#0284c7',
    primaryHover: '#0369a1',
    primaryText: '#ffffff',

    accent: '#0ea5e9',
    accentHover: '#0284c7',

    border: '#bae6fd',
    borderSubtle: '#7dd3fc',

    success: '#16a34a',
    error: '#dc2626',
    warning: '#d97706',
    info: '#2563eb',

    overlay: 'rgba(12, 74, 110, 0.5)',
};

// ============================================
// THEME REGISTRY
// ============================================


/** Warm paper. Low blue, easy for long reading. */
export const lightPaper: ThemeColors = {
    background: '#faf6ef',
    surface: '#f2ece1',
    surfaceHover: '#e8e0d2',
    surfaceActive: '#ddd3c2',

    text: '#3b3630',
    textMuted: '#6b6257',
    textSubtle: '#918778',

    primary: '#3b3630',
    primaryHover: '#2a2621',
    primaryText: '#faf6ef',

    accent: '#b7791f',
    accentHover: '#975f13',

    border: '#e0d8ca',
    borderSubtle: '#ece5d9',

    success: '#4d7c2a',
    error: '#b83227',
    warning: '#b7791f',
    info: '#2b6cb0',

    overlay: 'rgba(0, 0, 0, 0.35)',
};

/** Cool, crisp light with a blue accent. */
export const lightFrost: ThemeColors = {
    background: '#f5f8fa',
    surface: '#ffffff',
    surfaceHover: '#eaf0f5',
    surfaceActive: '#dbe5ee',

    text: '#1f2933',
    textMuted: '#52616b',
    textSubtle: '#7b8794',

    primary: '#1f2933',
    primaryHover: '#111820',
    primaryText: '#ffffff',

    accent: '#2b7fd4',
    accentHover: '#1d63ab',

    border: '#dbe3ea',
    borderSubtle: '#eaf0f5',

    success: '#2f855a',
    error: '#c53030',
    warning: '#b7791f',
    info: '#2b7fd4',

    overlay: 'rgba(15, 23, 42, 0.35)',
};

export type ThemeMode = 'dark' | 'light';
export type DarkThemeVariant =
    | 'zinc' | 'slate' | 'crimson' | 'emerald'
    | 'midnight' | 'ember' | 'carbon' | 'orchid';
export type LightThemeVariant = 'neutral' | 'warm' | 'cool' | 'paper' | 'frost';
export type ThemeVariant = DarkThemeVariant | LightThemeVariant;

export interface ThemeConfig {
    mode: ThemeMode;
    variant: ThemeVariant;
}

export const darkThemes: Record<DarkThemeVariant, ThemeColors> = {
    zinc: darkZinc,
    slate: darkSlate,
    crimson: darkCrimson,
    emerald: darkEmerald,
    midnight: darkMidnight,
    ember: darkEmber,
    carbon: darkCarbon,
    orchid: darkOrchid,
};

export const lightThemes: Record<LightThemeVariant, ThemeColors> = {
    neutral: lightNeutral,
    warm: lightWarm,
    cool: lightCool,
    paper: lightPaper,
    frost: lightFrost,
};

export const getThemeColors = (config: ThemeConfig): ThemeColors => {
    if (config.mode === 'dark') {
        return darkThemes[config.variant as DarkThemeVariant] || darkZinc;
    }
    return lightThemes[config.variant as LightThemeVariant] || lightNeutral;
};

export const defaultThemeConfig: ThemeConfig = {
    mode: 'dark',
    variant: 'zinc',
};

// Theme display names for UI
export const themeDisplayNames: Record<ThemeVariant, string> = {
    zinc: 'Zinc',
    slate: 'Slate',
    crimson: 'Crimson',
    emerald: 'Emerald',
    midnight: 'Midnight',
    ember: 'Ember',
    carbon: 'Carbon',
    orchid: 'Orchid',
    neutral: 'Neutral',
    warm: 'Warm',
    cool: 'Cool',
    paper: 'Paper',
    frost: 'Frost',
};
