import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '@/constants/theme';
import { fonts } from '@/lib/fonts';

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

const VARIANT_STYLES: Record<Variant, { bg: string; text: string; border?: string }> = {
  primary:   { bg: colors.primary, text: '#FFFFFF' },
  accent:    { bg: colors.lime, text: colors.ink },
  secondary: { bg: colors.panel, text: '#FFFFFF' },
  outline:   { bg: '#FFFFFF', text: colors.ink, border: colors.border },
  ghost:     { bg: 'transparent', text: colors.muted },
  danger:    { bg: '#FFFFFF', text: colors.danger, border: colors.border },
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
  const vs = VARIANT_STYLES[variant];
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
