import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
    Pressable,
    StyleSheet,
    View,
    ViewStyle,
} from 'react-native';
import { useTheme } from '../theme';
import { AppText as Text } from './AppText';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

interface SettingsItemProps {
    icon: IoniconsName;
    title: string;
    subtitle?: string;
    value?: string;
    onPress?: () => void;
    rightElement?: React.ReactNode;
    showArrow?: boolean;
    style?: ViewStyle;
}

export const SettingsItem: React.FC<SettingsItemProps> = ({
    icon,
    title,
    subtitle,
    value,
    onPress,
    rightElement,
    showArrow = true,
    style,
}) => {
    const { colors } = useTheme();

    const Container = onPress ? Pressable : View;

    return (
        <Container
            onPress={onPress}
            style={({ pressed }: { pressed?: boolean }) => [
                styles.container,
                { backgroundColor: pressed ? colors.surfaceHover : colors.surface },
                style,
            ]}
        >
            <View style={[styles.iconContainer, { backgroundColor: colors.surfaceHover }]}>
                <Ionicons name={icon} size={20} color={colors.text} />
            </View>

            <View style={styles.textContainer}>
                <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
                {subtitle && (
                    <Text style={[styles.subtitle, { color: colors.textMuted }]}>{subtitle}</Text>
                )}
            </View>

            <View style={styles.rightContainer}>
                {value && (
                    <Text style={[styles.value, { color: colors.textMuted }]}>{value}</Text>
                )}
                {rightElement}
                {onPress && showArrow && (
                    <Ionicons
                        name="chevron-forward"
                        size={20}
                        color={colors.textSubtle}
                        style={styles.arrow}
                    />
                )}
            </View>
        </Container>
    );
};

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 12,
        marginVertical: 4,
    },
    iconContainer: {
        width: 36,
        height: 36,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    textContainer: {
        flex: 1,
    },
    title: {
        fontSize: 16,
        fontWeight: '500',
    },
    subtitle: {
        fontSize: 13,
        marginTop: 2,
    },
    rightContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    value: {
        fontSize: 14,
        marginRight: 4,
    },
    arrow: {
        marginLeft: 4,
    },
});

export default SettingsItem;
