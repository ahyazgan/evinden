import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { cuisineLabel } from '@/lib/cuisines';
import { fonts } from '@/lib/fonts';
import {
  EMPTY_FILTERS, KM_OPTIONS, MINUTE_OPTIONS, MIN_ORDER_OPTIONS, RATING_OPTIONS, SORT_OPTIONS, activeFilterCount,
  type HomeFilters,
} from '@/lib/home-filters';
import { useTheme } from '@/lib/theme-context';

const CUISINES_COLLAPSED = 5;

type Props = {
  filters: HomeFilters;
  onChange: (next: HomeFilters) => void;
  cuisineOptions: { id: string; count: number }[];
  hasLocation: boolean;
};

const tl = (cents: number) => `₺${cents / 100}`;

/** Sıralama ve filtreler: masaüstünde kenar sütun, telefonda alttan açılan pencere içinde. */
export function HomeFilterPanel({ filters: f, onChange, cuisineOptions, hasLocation }: Props) {
  const { colors: t } = useTheme();
  const [cuisineQuery, setCuisineQuery] = useState('');
  const [allCuisines, setAllCuisines] = useState(false);

  const set = (patch: Partial<HomeFilters>) => onChange({ ...f, ...patch });
  const toggleCuisine = (id: string) =>
    set({ cuisines: f.cuisines.includes(id) ? f.cuisines.filter(c => c !== id) : [...f.cuisines, id] });

  const q = cuisineQuery.trim().toLocaleLowerCase('tr');
  const matching = cuisineOptions.filter(c => !q || cuisineLabel(c.id).toLocaleLowerCase('tr').includes(q));
  const shown = allCuisines || q ? matching : matching.slice(0, CUISINES_COLLAPSED);

  const Radio = ({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) => (
    <Pressable style={s.row} onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: on }}>
      <View style={[s.radio, { borderColor: on ? t.primary : t.surfaceBorder }]}>
        {on ? <View style={[s.radioDot, { backgroundColor: t.primary }]} /> : null}
      </View>
      <Text style={[s.text, { color: t.text }]}>{label}</Text>
    </Pressable>
  );

  const Check = ({ label, on, onPress, count }: { label: string; on: boolean; onPress: () => void; count?: number }) => (
    <Pressable style={s.row} onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
      <View style={[s.check, { borderColor: on ? t.primary : t.surfaceBorder, backgroundColor: on ? t.primary : 'transparent' }]}>
        {on ? <Ionicons name="checkmark" size={14} color={t.onBrand} /> : null}
      </View>
      <Text style={[s.text, { color: t.text }]} numberOfLines={1}>{label}</Text>
      {count != null ? <Text style={[s.count, { color: t.textMuted }]}>{count}</Text> : null}
    </Pressable>
  );

  /** Tümü + sınır seçenekleri: bir tek değer seçilir. */
  const Limit = ({ title, value, options, label, field }: {
    title: string;
    value: number | null;
    options: number[];
    label: (v: number) => string;
    field: 'minRating' | 'maxMinOrderCents' | 'maxMinutes' | 'maxKm';
  }) => (
    <>
      <View style={[s.divider, { backgroundColor: t.divider }]} />
      <Text style={[s.label, { color: t.text }]}>{title}</Text>
      <Radio label="Tümü" on={value == null} onPress={() => set({ [field]: null })} />
      {options.map(v => <Radio key={v} label={label(v)} on={value === v} onPress={() => set({ [field]: v })} />)}
    </>
  );

  return (
    <View>
      <Text style={[s.label, { color: t.text }]}>Sırala</Text>
      {SORT_OPTIONS.filter(o => !o.needsLocation || hasLocation).map(o => (
        <Radio key={o.key} label={o.label} on={f.sort === o.key} onPress={() => set({ sort: o.key })} />
      ))}

      {cuisineOptions.length > 0 ? (
        <>
          <View style={[s.divider, { backgroundColor: t.divider }]} />
          <Text style={[s.label, { color: t.text }]}>Mutfaklar</Text>
          {cuisineOptions.length > CUISINES_COLLAPSED ? (
            <View style={[s.search, { backgroundColor: t.background }]}>
              <Ionicons name="search" size={16} color={t.textSecondary} />
              <TextInput
                value={cuisineQuery}
                onChangeText={setCuisineQuery}
                placeholder="Mutfak ara"
                placeholderTextColor={t.textMuted}
                style={[s.searchInput, { color: t.text }]}
                accessibilityLabel="Mutfak ara"
              />
            </View>
          ) : null}
          {shown.map(c => (
            <Check key={c.id} label={cuisineLabel(c.id)} count={c.count} on={f.cuisines.includes(c.id)} onPress={() => toggleCuisine(c.id)} />
          ))}
          {!q && matching.length > CUISINES_COLLAPSED ? (
            <Pressable style={s.more} onPress={() => setAllCuisines(!allCuisines)} accessibilityRole="button">
              <Text style={[s.moreText, { color: t.text }]}>{allCuisines ? 'Daha az göster' : 'Daha fazla göster'}</Text>
              <Ionicons name={allCuisines ? 'chevron-up' : 'chevron-down'} size={16} color={t.text} />
            </Pressable>
          ) : null}
        </>
      ) : null}

      <View style={[s.divider, { backgroundColor: t.divider }]} />
      <Text style={[s.label, { color: t.text }]}>Popüler filtreler</Text>
      <Check label="Şimdi açık" on={f.open} onPress={() => set({ open: !f.open })} />
      <Check label="Kampanyalı" on={f.campaign} onPress={() => set({ campaign: !f.campaign })} />
      <Check label="Mahallenin favorisi" on={f.localFavorite} onPress={() => set({ localFavorite: !f.localFavorite })} />
      <Check label="Ücretsiz teslimat" on={f.freeDelivery} onPress={() => set({ freeDelivery: !f.freeDelivery })} />
      <Check label="Kapıda yemek kartı" on={f.mealCard} onPress={() => set({ mealCard: !f.mealCard })} />
      <Check label="Gelip alabilirim" on={f.pickup} onPress={() => set({ pickup: !f.pickup })} />

      <Limit title="Puan" value={f.minRating} options={RATING_OPTIONS} field="minRating" label={v => `${String(v).replace('.', ',')} ve üzeri`} />
      <Limit title="Minimum sepet" value={f.maxMinOrderCents} options={MIN_ORDER_OPTIONS} field="maxMinOrderCents" label={v => `${tl(v)} ve altı`} />
      <Limit title="Teslimat süresi" value={f.maxMinutes} options={MINUTE_OPTIONS} field="maxMinutes" label={v => `${v} dk ve altı`} />
      {hasLocation ? (
        <Limit title="Uzaklık" value={f.maxKm} options={KM_OPTIONS} field="maxKm" label={v => `${v} km ve altı`} />
      ) : null}

      {activeFilterCount(f) > 0 ? (
        <Pressable
          style={s.clear}
          onPress={() => onChange({ ...EMPTY_FILTERS, sort: f.sort })}
          accessibilityRole="button"
        >
          <Ionicons name="close-circle-outline" size={18} color={t.text} />
          <Text style={[s.moreText, { color: t.text }]}>Filtreleri temizle</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 14, fontFamily: fonts.bold, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
  text: { flexShrink: 1, fontSize: 14, fontFamily: fonts.regular },
  count: { marginLeft: 'auto', fontSize: 12, fontFamily: fonts.medium },
  divider: { height: 1, marginVertical: 12 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  check: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 10, borderRadius: 10, marginBottom: 4 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 14, fontFamily: fonts.regular },
  more: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40 },
  moreText: { fontSize: 13, fontFamily: fonts.semibold },
  clear: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, marginTop: 8 },
});
