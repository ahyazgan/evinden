import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@/constants/theme';

type BadgeVariant = 'success' | 'amber' | 'primary' | 'muted' | 'danger' | 'info';

const VARIANT_STYLES: Record<BadgeVariant, { bg: string; text: string }> = {
  success: { bg: '#E8F5E9', text: '#2E7D32' },
  amber:   { bg: '#FFF8E1', text: '#F57F17' },
  primary: { bg: '#FFF0EB', text: colors.primary },
  muted:   { bg: '#F5F5F5', text: '#9E9E9E' },
  danger:  { bg: '#FFEBEE', text: '#C62828' },
  info:    { bg: '#E3F2FD', text: '#1565C0' },
};

type Props = {
  label: string;
  variant?: BadgeVariant;
  dot?: boolean;
  size?: 'sm' | 'md';
};

export function Badge({ label, variant = 'primary', dot = false, size = 'sm' }: Props) {
  const vs = VARIANT_STYLES[variant];
  return (
    <View style={[styles.base, { backgroundColor: vs.bg }, size === 'md' && styles.md]}>
      {dot ? <View style={[styles.dot, { backgroundColor: vs.text }]} /> : null}
      <Text style={[styles.label, { color: vs.text }, size === 'md' && styles.labelMd]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 4,
  },
  md: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 10, fontWeight: '700' },
  labelMd: { fontSize: 12 },
});
