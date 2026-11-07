import React, { Component, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button } from '@/components/ui/Button';
import { hideBootSplash } from '@/lib/boot-splash';
import { captureException } from '@/lib/error-tracking';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';

type Props = { children: ReactNode };
type State = { hasError: boolean; error: Error | null };

/** Sağlayıcıların dışında çalışır: useTheme burada varsayılan temayı döndürür. */
function ErrorFallback({ onReset }: { onReset: () => void }) {
  const { colors: t } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: t.background }]}>
      <Ionicons name="alert-circle-outline" size={56} color={t.textMuted} />
      <Text style={[styles.title, { color: t.heading }]} accessibilityRole="header">Bir sorun oluştu</Text>
      <Text style={[styles.message, { color: t.textSecondary }]}>
        Uygulama beklenmedik bir hatayla karşılaştı. Tekrar dene.
      </Text>
      <Button label="Tekrar dene" onPress={onReset} />
    </View>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Webde açılış görüntüsü hata ekranını örtmesin.
    hideBootSplash();
    captureException(error, {
      componentStack: errorInfo.componentStack ?? '',
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return <ErrorFallback onReset={this.handleReset} />;
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontFamily: fonts.display,
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontFamily: fonts.regular,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
});
