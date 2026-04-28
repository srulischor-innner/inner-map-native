// React error boundary scoped to the Guide tab Healing pill content.
// Recent additions to the healing slide visuals (survivalMode,
// groundBuilding, etc.) introduced a runtime crash that takes the whole
// app down. Catching it here so the user sees a calm fallback while we
// hunt the offender from the logs.
//
// Function components can't define error boundaries, so this is a
// classic class component. Keep it tiny — the real fix lives in the
// visual that actually threw.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts, spacing } from '../../constants/theme';

type Props = { children: React.ReactNode };
type State = { hasError: boolean; error: Error | null };

export class HealingErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // These are the diagnostic breadcrumbs we want when the app stops
    // crashing visibly — Metro will show the offending visual + stack.
    console.error('[healing-tab] crash:', error?.message);
    if (error?.stack) console.error('[healing-tab] error stack:', error.stack);
    if (info?.componentStack) console.error('[healing-tab] component stack:', info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.root}>
          <Text style={styles.text}>
            Something went wrong loading this section.
          </Text>
        </View>
      );
    }
    return this.props.children as any;
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  text: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 14,
    textAlign: 'center',
    letterSpacing: 0.3,
    lineHeight: 22,
  },
});
