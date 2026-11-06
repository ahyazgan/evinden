import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';

type Variant = 'primary' | 'accent' | 'secondary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  icon?: string;
};

const SIZE_STYLES: Record<Size, { px: number; minHeight: number; fontSize: number }> = {
  sm: { px: 12, minHeight: 44, fontSize: 13 },
  md: { px: 16, minHeight: 46, fontSize: 14 },
  lg: { px: 20, minHeight: 52, fontSize: 15 },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  icon,
}: Props) {
  const { colors: t } = useTheme();
  const vs = {
    primary: { bg: t.primary, text: t.onBrand, border: undefined },
    accent: { bg: t.accent, text: t.onAccent, border: undefined },
    secondary: { bg: t.panel, text: t.onBrand, border: undefined },
    outline: { bg: t.surface, text: t.text, border: t.surfaceBorder },
    ghost: { bg: 'transparent', text: t.textSecondary, border: undefined },
    danger: { bg: t.surface, text: t.danger, border: t.surfaceBorder },
  }[variant];
  const ss = SIZE_STYLES[size];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={[
        styles.base,
        {
          backgroundColor: vs.bg,
          paddingHorizontal: ss.px,
          minHeight: ss.minHeight,
          borderWidth: vs.border ? 1 : 0,
          borderColor: vs.border ?? 'transparent',
        },
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={vs.text} />
      ) : (
        <>
          {icon ? (
            <Text style={[styles.icon, { fontFamily: fonts.regular, fontSize: ss.fontSize + 2 }]}>{icon}</Text>
          ) : null}
          <Text style={[styles.label, { color: vs.text, fontSize: ss.fontSize }]}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderRadius: 12,
  },
  fullWidth: { alignSelf: 'stretch' },
  disabled: { opacity: 0.5 },
  label: { fontFamily: fonts.bold },
  icon: {},
});
