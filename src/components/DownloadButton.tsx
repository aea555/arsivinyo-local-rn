import { Ionicons } from '@expo/vector-icons';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    View,
} from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSequence,
    withSpring,
} from 'react-native-reanimated';
import type { DownloadState } from '../api/types';
import { useTheme } from '../theme';
import { AppText as Text } from './AppText';

interface DownloadButtonProps {
    onPress: () => void;
    state: DownloadState;
    disabled?: boolean;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const DownloadButton: React.FC<DownloadButtonProps> = ({
    onPress,
    state,
    disabled = false,
}) => {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const scale = useSharedValue(1);

    const handlePressIn = useCallback(() => {
        scale.value = withSpring(0.95, { damping: 15 });
    }, [scale]);

    const handlePressOut = useCallback(() => {
        scale.value = withSpring(1, { damping: 15 });
    }, [scale]);

    const handlePress = useCallback(() => {
        if (disabled || state !== 'idle') return;

        // Pulse animation on press
        scale.value = withSequence(
            withSpring(0.9, { damping: 15 }),
            withSpring(1.05, { damping: 10 }),
            withSpring(1, { damping: 15 })
        );

        onPress();
    }, [disabled, state, onPress, scale]);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));

    const isLoading = state === 'starting' || state === 'downloading' || state === 'processing' || state === 'saving';
    const isCompleted = state === 'completed';
    const isError = state === 'error';

    const getButtonContent = () => {
        if (isLoading) {
            return (
                <>
                    <ActivityIndicator size="large" color={colors.accent} />
                    <Text style={[styles.buttonText, { color: colors.accent, marginTop: 16 }]}>
                        {state === 'starting' && t('home.downloadButtonHint')}
                        {state === 'downloading' && t('home.downloading')}
                        {state === 'processing' && t('home.processing')}
                        {state === 'saving' && t('common.loading')}
                    </Text>
                </>
            );
        }

        if (isCompleted) {
            return (
                <>
                    <Ionicons name="checkmark-circle" size={64} color={colors.success} />
                    <Text style={[styles.buttonText, { color: colors.success, marginTop: 16 }]}>
                        {t('home.downloadComplete')}
                    </Text>
                </>
            );
        }

        if (isError) {
            return (
                <>
                    <Ionicons name="alert-circle" size={64} color={colors.error} />
                    <Text style={[styles.buttonText, { color: colors.error, marginTop: 16 }]}>
                        {t('home.tryAgain')}
                    </Text>
                </>
            );
        }

        // Idle state
        return (
            <>
                <Ionicons name="download-outline" size={64} color={colors.accent} />
                <Text style={[styles.buttonText, { color: colors.accent, marginTop: 16 }]}>
                    {t('home.downloadButton')}
                </Text>
                <Text style={[styles.buttonHint, { color: colors.textMuted, marginTop: 8 }]}>
                    {t('home.downloadButtonHint')}
                </Text>
            </>
        );
    };

    const buttonBackgroundColor = isCompleted
        ? colors.success + '20' // 20% opacity
        : isError
            ? colors.error + '20'
            : colors.surface;

    const buttonBorderColor = isCompleted
        ? colors.success
        : isError
            ? colors.error
            : colors.border;

    return (
        <AnimatedPressable
            onPress={handlePress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            disabled={disabled || isLoading}
            style={[
                styles.button,
                animatedStyle,
                {
                    backgroundColor: buttonBackgroundColor,
                    borderColor: buttonBorderColor,
                },
            ]}
        >
            <View style={styles.buttonContent}>{getButtonContent()}</View>
        </AnimatedPressable>
    );
};

const styles = StyleSheet.create({
    button: {
        width: 260,
        height: 260,
        borderRadius: 32,
        borderWidth: 2,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 8,
    },
    buttonContent: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    buttonText: {
        fontSize: 18,
        fontWeight: '600',
        textAlign: 'center',
    },
    buttonHint: {
        fontSize: 13,
        textAlign: 'center',
        maxWidth: 180,
    },
});

export default DownloadButton;
