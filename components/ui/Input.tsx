import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { colors } from '@/constants/theme';
import { fonts } from '@/lib/fonts';

type Props = TextInputProps & {
  label?: string;
  error?: string;
  leftIcon?: string;
  hint?: string;
};

export function Input({ label, error, leftIcon, hint, style, ...rest }: Props) {
  const hasError = !!error;

  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View
        style={[
          styles.inputRow,
          hasError && styles.inputRowError,
          rest.editable === false && styles.inputRowDisabled,
        ]}
      >
        {leftIcon ? <Text style={styles.leftIcon}>{leftIcon}</Text> : null}
        <TextInput
          style={[styles.input, style]}
          placeholderTextColor="#A3ACA5"
          {...rest}
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {hint && !error ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 5 },
  label: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: '#56605A',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E3E6DE',
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 10,
  },
  inputRowError: { borderColor: '#EF5350' },
  inputRowDisabled: { backgroundColor: '#EFF2EA', opacity: 0.7 },
  leftIcon: { fontFamily: fonts.regular, fontSize: 18 },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: '#151A16', padding: 0 },
  error: { fontSize: 11, color: '#EF5350', fontFamily: fonts.semibold },
  hint: { fontFamily: fonts.regular, fontSize: 11, color: '#6B766F' },
});
