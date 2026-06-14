import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '@/constants/theme';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
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
  primary:   { bg: colors.primary, text: '#fff' },
  secondary: { bg: '#1A1208', text: '#fff' },
  outline:   { bg: 'transparent', text: '#1A1208', border: '#EDE8E2' },
  ghost:     { bg: 'transparent', text: '#A89A8A' },
  danger:    { bg: '#FFEBEE', text: '#C62828', border: '#FFCDD2' },
};

const SIZE_STYLES: Record<Size, { px: number; py: number; fontSize: number; radius: number }> = {
  sm: { px: 12, py: 7,  fontSize: 12, radius: 9  },
  md: { px: 16, py: 11, fontSize: 14, radius: 12 },
  lg: { px: 20, py: 15, fontSize: 16, radius: 14 },
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
      style={[
        styles.base,
        {
          backgroundColor: vs.bg,
          paddingHorizontal: ss.px,
          paddingVertical: ss.py,
          borderRadius: ss.radius,
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
            <Text style={[styles.icon, { fontSize: ss.fontSize + 2 }]}>{icon}</Text>
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
  },
  fullWidth: { alignSelf: 'stretch' },
  disabled: { opacity: 0.5 },
  label: { fontWeight: '700' },
  icon: {},
});
