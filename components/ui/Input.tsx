import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
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
          placeholderTextColor="#5E6862"
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
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: '#151A16',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E3E6DE',
    paddingHorizontal: 14,
    minHeight: 48,
    gap: 10,
  },
  inputRowError: { borderColor: '#C62828' },
  inputRowDisabled: { backgroundColor: '#F1F2EE', opacity: 0.7 },
  leftIcon: { fontFamily: fonts.regular, fontSize: 18 },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: '#151A16', padding: 0 },
  error: { fontSize: 12, color: '#C62828', fontFamily: fonts.semibold },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: '#5E6862' },
});
