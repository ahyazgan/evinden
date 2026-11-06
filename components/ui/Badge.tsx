import { StyleSheet, Text, View } from 'react-native';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';

export type BadgeVariant = 'success' | 'amber' | 'primary' | 'muted' | 'danger' | 'info';

type Props = {
  label: string;
  variant?: BadgeVariant;
  dot?: boolean;
  size?: 'sm' | 'md';
};

export function Badge({ label, variant = 'primary', dot = false, size = 'sm' }: Props) {
  const { colors: t } = useTheme();
  const vs = {
    success: { bg: `${t.success}18`, text: t.success },
    amber: { bg: `${t.amber}18`, text: t.amber },
    primary: { bg: t.accent, text: t.onAccent },
    muted: { bg: t.background, text: t.textSecondary },
    danger: { bg: `${t.danger}18`, text: t.danger },
    info: { bg: `${t.text}12`, text: t.text },
  }[variant];
  return (
    <View style={[styles.base, { backgroundColor: vs.bg }, size === 'md' && styles.md]}>
      {dot ? <View style={[styles.dot, { backgroundColor: vs.text }]} /> : null}
      <Text style={[styles.label, { color: vs.text }, size === 'md' && styles.labelMd]}>{label}</Text>
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
  label: { fontSize: 11, fontFamily: fonts.bold },
  labelMd: { fontFamily: fonts.regular, fontSize: 12 },
});
