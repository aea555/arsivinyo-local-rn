import { Sixtyfour_400Regular, useFonts } from '@expo-google-fonts/sixtyfour';
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
    Easing,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withRepeat,
    withSequence,
    withTiming
} from 'react-native-reanimated';

interface AnimatedSplashProps {
    onAnimationComplete: () => void;
}

const ANIMATION_DURATION = 2500; // Total splash duration

export const AnimatedSplash: React.FC<AnimatedSplashProps> = ({ onAnimationComplete }) => {
    const [fontsLoaded] = useFonts({
        Sixtyfour_400Regular,
    });

    // Letter scale animation
    const letterScale = useSharedValue(1);

    // Ripple animations (multiple ripples with staggered starts)
    const ripple1Progress = useSharedValue(0);
    const ripple2Progress = useSharedValue(0);
    const ripple3Progress = useSharedValue(0);

    useEffect(() => {
        // Start letter pulse animation
        letterScale.value = withRepeat(
            withSequence(
                withTiming(1.08, { duration: 600, easing: Easing.inOut(Easing.ease) }),
                withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) })
            ),
            -1, // Infinite repeat until we stop
            true
        );

        // Ripple 1 - starts immediately, repeats
        ripple1Progress.value = withRepeat(
            withTiming(1, { duration: 1500, easing: Easing.out(Easing.ease) }),
            -1,
            false
        );

        // Ripple 2 - starts with 500ms delay
        ripple2Progress.value = withDelay(
            500,
            withRepeat(
                withTiming(1, { duration: 1500, easing: Easing.out(Easing.ease) }),
                -1,
                false
            )
        );

        // Ripple 3 - starts with 1000ms delay
        ripple3Progress.value = withDelay(
            1000,
            withRepeat(
                withTiming(1, { duration: 1500, easing: Easing.out(Easing.ease) }),
                -1,
                false
            )
        );

        // End splash after duration
        const timer = setTimeout(() => {
            onAnimationComplete();
        }, ANIMATION_DURATION);

        return () => clearTimeout(timer);
    }, [letterScale, onAnimationComplete, ripple1Progress, ripple2Progress, ripple3Progress]);

    const letterAnimatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: letterScale.value }],
    }));

    const ripple1Style = useAnimatedStyle(() => ({
        transform: [{ scale: interpolate(ripple1Progress.value, [0, 1], [1, 3]) }],
        opacity: interpolate(ripple1Progress.value, [0, 0.2, 1], [0.6, 0.4, 0]),
    }));

    const ripple2Style = useAnimatedStyle(() => ({
        transform: [{ scale: interpolate(ripple2Progress.value, [0, 1], [1, 3]) }],
        opacity: interpolate(ripple2Progress.value, [0, 0.2, 1], [0.6, 0.4, 0]),
    }));

    const ripple3Style = useAnimatedStyle(() => ({
        transform: [{ scale: interpolate(ripple3Progress.value, [0, 1], [1, 3]) }],
        opacity: interpolate(ripple3Progress.value, [0, 0.2, 1], [0.6, 0.4, 0]),
    }));

    if (!fontsLoaded) {
        return (
            <View style={styles.container}>
                <Text style={styles.fallbackLetter}>A</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {/* Ripple circles behind the letter */}
            <View style={styles.rippleContainer}>
                <Animated.View style={[styles.ripple, ripple1Style]} />
                <Animated.View style={[styles.ripple, ripple2Style]} />
                <Animated.View style={[styles.ripple, ripple3Style]} />
            </View>

            {/* Animated letter */}
            <Animated.Text style={[styles.letter, letterAnimatedStyle]}>
                A
            </Animated.Text>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000000',
        justifyContent: 'center',
        alignItems: 'center',
    },
    rippleContainer: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        alignItems: 'center',
    },
    ripple: {
        position: 'absolute',
        width: 120,
        height: 120,
        borderRadius: 60,
        borderWidth: 2,
        borderColor: 'rgba(255, 255, 255, 0.5)',
        backgroundColor: 'transparent',
    },
    letter: {
        fontSize: 100,
        color: '#FFFFFF',
        fontFamily: 'Sixtyfour_400Regular',
        textShadowColor: 'rgba(255, 255, 255, 0.5)',
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 20,
    },
    fallbackLetter: {
        fontSize: 100,
        color: '#FFFFFF',
        fontWeight: '900',
    },
});

export default AnimatedSplash;
