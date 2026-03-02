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

export type ThemeMode = 'dark' | 'light';
export type DarkThemeVariant = 'zinc' | 'slate' | 'crimson' | 'emerald';
export type LightThemeVariant = 'neutral' | 'warm' | 'cool';
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
};

export const lightThemes: Record<LightThemeVariant, ThemeColors> = {
    neutral: lightNeutral,
    warm: lightWarm,
    cool: lightCool,
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
    neutral: 'Neutral',
    warm: 'Warm',
    cool: 'Cool',
};
