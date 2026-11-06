import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';

type Props = TextInputProps & {
  label?: string;
  error?: string;
  leftIcon?: string;
  hint?: string;
};

export function Input({ label, error, leftIcon, hint, style, ...rest }: Props) {
  const { colors: t } = useTheme();
  const hasError = !!error;
  return (
    <View style={styles.wrap}>
      {label ? <Text style={[styles.label, { color: t.text }]}>{label}</Text> : null}
      <View style={[styles.inputRow, { backgroundColor: t.surface, borderColor: hasError ? t.danger : t.surfaceBorder }, rest.editable === false && [styles.inputRowDisabled, { backgroundColor: t.chip }]]}>
        {leftIcon ? <Text style={[styles.leftIcon, { color: t.textSecondary }]}>{leftIcon}</Text> : null}
        <TextInput style={[styles.input, { color: t.text }, style]} placeholderTextColor={t.textMuted} {...rest} />
      </View>
      {error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null}
      {hint && !error ? <Text style={[styles.hint, { color: t.textSecondary }]}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 5 },
  label: {
    fontSize: 13,
    fontFamily: fonts.semibold,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    minHeight: 48,
    gap: 10,
  },
  inputRowDisabled: { opacity: 0.7 },
  leftIcon: { fontFamily: fonts.regular, fontSize: 18 },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 15, padding: 0 },
  error: { fontSize: 12, fontFamily: fonts.semibold },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: '#5E6862' },
});
