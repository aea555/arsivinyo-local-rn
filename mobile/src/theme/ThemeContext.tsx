import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import {
    DarkThemeVariant,
    LightThemeVariant,
    ThemeColors,
    ThemeConfig,
    ThemeMode,
    ThemeVariant,
    darkThemes,
    defaultThemeConfig,
    getThemeColors,
    lightThemes,
} from './colors';

const THEME_STORAGE_KEY = '@arsivinyo_theme';

interface ThemeContextType {
    colors: ThemeColors;
    config: ThemeConfig;
    isDark: boolean;
    setMode: (mode: ThemeMode) => void;
    setVariant: (variant: ThemeVariant) => void;
    toggleMode: () => void;
    availableDarkVariants: DarkThemeVariant[];
    availableLightVariants: LightThemeVariant[];
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
    children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
    const systemColorScheme = useColorScheme();
    const [config, setConfig] = useState<ThemeConfig>(defaultThemeConfig);
    const [isLoaded, setIsLoaded] = useState(false);

    // Load saved theme on mount
    useEffect(() => {
        const loadTheme = async () => {
            try {
                const saved = await AsyncStorage.getItem(THEME_STORAGE_KEY);
                if (saved) {
                    const parsed = JSON.parse(saved) as ThemeConfig;
                    setConfig(parsed);
                } else {
                    // Use system preference for initial mode
                    const initialMode: ThemeMode = systemColorScheme === 'dark' ? 'dark' : 'light';
                    const initialVariant: ThemeVariant = initialMode === 'dark' ? 'zinc' : 'neutral';
                    setConfig({ mode: initialMode, variant: initialVariant });
                }
            } catch (error) {
                console.error('Failed to load theme:', error);
            } finally {
                setIsLoaded(true);
            }
        };
        loadTheme();
    }, [systemColorScheme]);

    // Save theme when it changes
    useEffect(() => {
        if (isLoaded) {
            AsyncStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(config)).catch((error) => {
                console.error('Failed to save theme:', error);
            });
        }
    }, [config, isLoaded]);

    const setMode = useCallback((mode: ThemeMode) => {
        setConfig((prev) => {
            // When switching modes, pick the default variant for that mode
            const newVariant: ThemeVariant = mode === 'dark' ? 'zinc' : 'neutral';
            return { mode, variant: newVariant };
        });
    }, []);

    const setVariant = useCallback((variant: ThemeVariant) => {
        setConfig((prev) => ({ ...prev, variant }));
    }, []);

    const toggleMode = useCallback(() => {
        setConfig((prev) => {
            const newMode: ThemeMode = prev.mode === 'dark' ? 'light' : 'dark';
            const newVariant: ThemeVariant = newMode === 'dark' ? 'zinc' : 'neutral';
            return { mode: newMode, variant: newVariant };
        });
    }, []);

    const colors = getThemeColors(config);
    const isDark = config.mode === 'dark';

    const value: ThemeContextType = {
        colors,
        config,
        isDark,
        setMode,
        setVariant,
        toggleMode,
        availableDarkVariants: Object.keys(darkThemes) as DarkThemeVariant[],
        availableLightVariants: Object.keys(lightThemes) as LightThemeVariant[],
    };

    // Don't render until theme is loaded to prevent flash
    if (!isLoaded) {
        return null;
    }

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextType => {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};

export default ThemeContext;
