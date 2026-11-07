import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Input } from '@/components/ui/Input';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';
import { CHOICE_LIMIT, CHOICE_TEXT, moveItem, newChoiceKey, parsePriceStr, type ChoiceDraft, type ChoiceKind } from '@/lib/menu-choices';

/**
 * Ekstra, porsiyon veya çeşit listesi: ad ve fiyat yerinde düzenlenir, "Bitti" ile satıştan çekilir,
 * oklarla sıralanır. Değişiklikler ürün kaydedilince tek seferde yazılır.
 */
export function ChoiceListEditor({ kind, value, onChange }: { kind: ChoiceKind; value: ChoiceDraft[]; onChange: (next: ChoiceDraft[]) => void }) {
  const { colors: t } = useTheme();
  const text = CHOICE_TEXT[kind];
  const [newLabel, setNewLabel] = useState('');
  const [newPrice, setNewPrice] = useState('');

  const update = (key: string, patch: Partial<ChoiceDraft>) =>
    onChange(value.map(d => (d.key === key ? { ...d, ...patch } : d)));

  const add = () => {
    const label = newLabel.trim();
    if (!label) { Alert.alert('Ad gerekli', `${text.title} için bir ad yaz.`); return; }
    if (value.length >= CHOICE_LIMIT) { Alert.alert('Sınır', `En fazla ${CHOICE_LIMIT} seçenek eklenebilir.`); return; }
    const cents = newPrice.trim() === '' && kind !== 'portion' ? 0 : parsePriceStr(newPrice);
    if (cents === null || (kind === 'portion' && cents === 0)) {
      Alert.alert('Geçersiz fiyat', kind === 'portion' ? 'Porsiyonun fiyatını yaz.' : 'Fiyatı 12,50 gibi yaz ya da boş bırak.');
      return;
    }
    onChange([...value, { id: null, key: newChoiceKey(), label, priceStr: newPrice.trim() || '0', isAvailable: true }]);
    setNewLabel('');
    setNewPrice('');
  };

  return (
    <View style={s.wrap}>
      <Text style={[s.title, { color: t.text }]}>{text.title}</Text>
      <Text style={[s.hint, { color: t.textSecondary }]}>{text.hint}</Text>

      {value.map((d, i) => (
        <View key={d.key} style={[s.row, { backgroundColor: t.surface }]}>
          <View style={s.fields}>
            <View style={s.labelField}>
              <Input value={d.label} onChangeText={v => update(d.key, { label: v })} accessibilityLabel={`${text.title}: ad`} />
            </View>
            <View style={s.priceField}>
              <Input
                value={d.priceStr}
                onChangeText={v => update(d.key, { priceStr: v })}
                keyboardType="decimal-pad"
                accessibilityLabel={`${d.label}: fiyat (${text.pricePrefix})`}
              />
            </View>
          </View>
          <View style={s.tools}>
            <Pressable
              style={[s.stock, { backgroundColor: d.isAvailable ? t.background : t.danger }]}
              onPress={() => update(d.key, { isAvailable: !d.isAvailable })}
              accessibilityRole="switch"
              accessibilityState={{ checked: d.isAvailable }}
              accessibilityLabel={`${d.label}: satışta`}
            >
              <Text style={[s.stockText, { color: d.isAvailable ? t.text : t.onBrand }]}>{d.isAvailable ? 'Satışta' : 'Bitti'}</Text>
            </Pressable>
            <Pressable style={s.icon} disabled={i === 0} onPress={() => onChange(moveItem(value, i, -1))} accessibilityRole="button" accessibilityLabel={`${d.label}: yukarı taşı`}>
              <Ionicons name="chevron-up" size={20} color={i === 0 ? t.textMuted : t.text} />
            </Pressable>
            <Pressable style={s.icon} disabled={i === value.length - 1} onPress={() => onChange(moveItem(value, i, 1))} accessibilityRole="button" accessibilityLabel={`${d.label}: aşağı taşı`}>
              <Ionicons name="chevron-down" size={20} color={i === value.length - 1 ? t.textMuted : t.text} />
            </Pressable>
            <Pressable style={s.icon} onPress={() => onChange(value.filter(x => x.key !== d.key))} accessibilityRole="button" accessibilityLabel={`${d.label}: kaldır`}>
              <Ionicons name="close-circle" size={22} color={t.danger} />
            </Pressable>
          </View>
        </View>
      ))}

      <View style={s.addRow}>
        <View style={s.flex}>
          <Input value={newLabel} onChangeText={setNewLabel} placeholder={text.labelPlaceholder} accessibilityLabel={`Yeni ${text.title.toLocaleLowerCase('tr-TR')}: ad`} />
        </View>
        <View style={s.priceField}>
          <Input value={newPrice} onChangeText={setNewPrice} placeholder={text.pricePrefix} keyboardType="decimal-pad" accessibilityLabel={`Yeni ${text.title.toLocaleLowerCase('tr-TR')}: fiyat`} />
        </View>
        <Pressable style={[s.addBtn, { backgroundColor: t.primary }]} onPress={add} accessibilityRole="button" accessibilityLabel={`${text.title}: ekle`}>
          <Ionicons name="add" size={22} color={t.onBrand} />
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 22, gap: 8 },
  title: { fontSize: 13, fontFamily: fonts.semibold },
  hint: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular, marginTop: -4 },
  row: { borderRadius: 12, padding: 10, gap: 8 },
  fields: { flexDirection: 'row', gap: 8 },
  labelField: { flex: 1, minWidth: 0 },
  priceField: { width: 84 },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stock: { height: 36, paddingHorizontal: 12, borderRadius: 8, justifyContent: 'center', marginRight: 'auto' },
  stockText: { fontSize: 12, fontFamily: fonts.bold },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1, minWidth: 0 },
  addBtn: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
