import { useTheme } from '@/src/theme';
import { Slot } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * Simple layout for the main app - no tabs needed
 * Just a full screen container for the home screen
 */
export default function MainLayout() {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Slot />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
