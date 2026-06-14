import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { colors } from '@/constants/theme';

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
          placeholderTextColor="#C4B8AA"
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
    fontWeight: '700',
    color: '#6B5E50',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 10,
  },
  inputRowError: { borderColor: '#EF5350' },
  inputRowDisabled: { backgroundColor: '#F5F0EA', opacity: 0.7 },
  leftIcon: { fontSize: 18 },
  input: { flex: 1, fontSize: 15, color: '#1A1208', padding: 0 },
  error: { fontSize: 11, color: '#EF5350', fontWeight: '600' },
  hint: { fontSize: 11, color: '#A89A8A' },
});
