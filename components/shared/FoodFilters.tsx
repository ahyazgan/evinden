import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { FOOD_FILTERS, type FoodFilterKey } from '@/lib/dietary';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';

type ChipsProps = {
  active: readonly FoodFilterKey[];
  onToggle: (key: FoodFilterKey) => void;
  options?: readonly { key: FoodFilterKey; label: string }[];
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
};

/** Sayfa zeminindeki yemek filtreleri: etkin koyu, diğerleri beyaz. Birden çok seçilebilir. */
export function FoodFilterChips({ active, onToggle, options = FOOD_FILTERS, style, contentStyle }: ChipsProps) {
  const { colors: t } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={style}
      contentContainerStyle={[s.row, contentStyle]}
    >
      {options.map(({ key, label }) => {
        const on = active.includes(key);
        return (
          <Pressable
            key={key}
            style={[s.chip, { backgroundColor: on ? t.brand : t.surface }]}
            onPress={() => onToggle(key)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
          >
            <Text style={[s.chipText, { color: on ? t.onBrand : t.text }]}>{label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Beyaz kart üstündeki küçük etiketler: Vegan, Acılı. */
export function FoodLabels({ labels, style }: { labels: readonly string[]; style?: StyleProp<ViewStyle> }) {
  const { colors: t } = useTheme();
  if (labels.length === 0) return null;
  return (
    <View style={[s.labels, style]}>
      {labels.map(label => (
        <View key={label} style={[s.label, { backgroundColor: t.background }]}>
          <Text style={[s.labelText, { color: t.text }]} numberOfLines={1}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: { gap: 8, alignItems: 'center' },
  chip: { height: 40, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 13, fontFamily: fonts.bold },
  labels: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  label: { height: 22, paddingHorizontal: 8, borderRadius: 6, justifyContent: 'center' },
  labelText: { fontSize: 11, fontFamily: fonts.semibold },
});
