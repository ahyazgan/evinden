import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { fonts } from '@/lib/fonts';
import { MAX_GROUPS, MAX_OPTIONS, newFormGroup, newFormOption, type FormGroup, type FormOption } from '@/lib/option-groups';
import { useTheme } from '@/lib/theme-context';

type Props = {
  groups: FormGroup[];
  onChange: (groups: FormGroup[]) => void;
};

/** Sık kullanılan kurallar: satıcı en az ve en fazla kutularıyla uğraşmadan seçer. */
const RULES = [
  { label: 'Zorunlu, 1 tane', min: '1', max: '1' },
  { label: 'İsteğe bağlı, 1 tane', min: '0', max: '1' },
  { label: 'İsteğe bağlı, sınırsız', min: '0', max: '' },
];

export function OptionGroupsEditor({ groups, onChange }: Props) {
  const { colors: t } = useTheme();

  const patchGroup = (key: string, patch: Partial<FormGroup>) =>
    onChange(groups.map(g => (g.key === key ? { ...g, ...patch } : g)));

  const patchOption = (group: FormGroup, key: string, patch: Partial<FormOption>) =>
    patchGroup(group.key, { options: group.options.map(o => (o.key === key ? { ...o, ...patch } : o)) });

  return (
    <View style={s.wrap}>
      <Text style={[s.title, { color: t.text }]}>Seçim grupları</Text>
      <Text style={[s.hint, { color: t.textSecondary }]}>
        Müşterinin ürünü sepete eklerken yapacağı seçimler: içecek, patates boyu, çıkarılacak malzeme gibi.
      </Text>

      {groups.map((group, index) => (
        <View key={group.key} style={[s.card, { backgroundColor: t.surface }]}>
          <View style={s.cardHead}>
            <Text style={[s.cardTitle, { color: t.heading }]}>{index + 1}. grup</Text>
            <Pressable
              style={s.iconBtn}
              onPress={() => onChange(groups.filter(g => g.key !== group.key))}
              accessibilityRole="button"
              accessibilityLabel={`${group.title || `${index + 1}. grup`} grubunu sil`}
            >
              <Ionicons name="trash-outline" size={20} color={t.danger} />
            </Pressable>
          </View>

          <Input
            label="Grup adı"
            value={group.title}
            onChangeText={v => patchGroup(group.key, { title: v })}
            placeholder="Örn: İçeceğini seç"
            maxLength={60}
          />

          <View style={s.rules}>
            {RULES.map(rule => {
              const on = group.minStr === rule.min && group.maxStr === rule.max;
              return (
                <Pressable
                  key={rule.label}
                  style={[s.chip, { backgroundColor: on ? t.brand : t.background }]}
                  hitSlop={2}
                  onPress={() => patchGroup(group.key, { minStr: rule.min, maxStr: rule.max })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[s.chipText, { color: on ? t.onBrand : t.text }]}>{rule.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={s.row}>
            <View style={s.flex}>
              <Input
                label="En az"
                value={group.minStr}
                onChangeText={v => patchGroup(group.key, { minStr: v })}
                keyboardType="number-pad"
                placeholder="0"
              />
            </View>
            <View style={s.flex}>
              <Input
                label="En fazla"
                value={group.maxStr}
                onChangeText={v => patchGroup(group.key, { maxStr: v })}
                keyboardType="number-pad"
                placeholder="Sınırsız"
              />
            </View>
          </View>

          <Text style={[s.optionsTitle, { color: t.text }]}>Seçenekler</Text>
          {group.options.map(option => (
            <View key={option.key} style={s.optionRow}>
              <View style={s.flex}>
                <Input
                  value={option.label}
                  onChangeText={v => patchOption(group, option.key, { label: v })}
                  placeholder="Örn: Ayran"
                  maxLength={60}
                  accessibilityLabel="Seçenek adı"
                />
              </View>
              <View style={s.price}>
                <Input
                  value={option.priceStr}
                  onChangeText={v => patchOption(group, option.key, { priceStr: v })}
                  placeholder="+₺0"
                  keyboardType="decimal-pad"
                  accessibilityLabel={`${option.label || 'Seçenek'} ek fiyatı`}
                />
              </View>
              <Pressable
                style={[s.stockBtn, { backgroundColor: option.isAvailable ? t.background : t.brand }]}
                onPress={() => patchOption(group, option.key, { isAvailable: !option.isAvailable })}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: !option.isAvailable }}
                accessibilityLabel={`${option.label || 'Seçenek'} tükendi`}
              >
                <Text style={[s.stockText, { color: option.isAvailable ? t.text : t.onBrand }]}>Bitti</Text>
              </Pressable>
              <Pressable
                style={s.iconBtn}
                onPress={() => patchGroup(group.key, { options: group.options.filter(o => o.key !== option.key) })}
                accessibilityRole="button"
                accessibilityLabel={`${option.label || 'Seçeneği'} kaldır`}
              >
                <Ionicons name="close-circle" size={22} color={t.danger} />
              </Pressable>
            </View>
          ))}
          {group.options.length < MAX_OPTIONS ? (
            <Pressable
              style={s.addRow}
              onPress={() => patchGroup(group.key, { options: [...group.options, newFormOption()] })}
              accessibilityRole="button"
            >
              <Ionicons name="add" size={18} color={t.text} />
              <Text style={[s.addText, { color: t.text }]}>Seçenek ekle</Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      {groups.length < MAX_GROUPS ? (
        <Button label="Seçim grubu ekle" variant="outline" fullWidth onPress={() => onChange([...groups, newFormGroup()])} />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 22, gap: 10 },
  title: { fontSize: 13, fontFamily: fonts.semibold },
  hint: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular, marginTop: -6 },
  card: { borderRadius: 14, padding: 14, gap: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold },
  rules: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 40, paddingHorizontal: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 12, fontFamily: fonts.bold },
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1, minWidth: 0 },
  optionsTitle: { fontSize: 13, fontFamily: fonts.semibold, marginTop: 4 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  price: { width: 72 },
  stockBtn: { height: 44, paddingHorizontal: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  stockText: { fontSize: 12, fontFamily: fonts.bold },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  addText: { fontSize: 13, fontFamily: fonts.bold },
});
