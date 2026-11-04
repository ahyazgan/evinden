import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth-context';
import {
  fetchSellerByUserId,
  fetchMenuItems,
  fetchWeeklyMenu,
  addWeeklyMenuItem,
  removeWeeklyMenuItem,
  toggleWeeklyMenuMode,
  type MenuItemRow,
  type WeeklyMenuRow,
} from '@/lib/db';
import { fonts } from '@/lib/fonts';
import { categoryLabel } from '@/lib/menu-categories';
import { useTheme } from '@/lib/theme-context';

const DAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const DAY_FULL = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

export default function WeeklyMenuScreen() {
  const { colors: t } = useTheme();
  const { profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [usesWeeklyMenu, setUsesWeeklyMenu] = useState(false);
  const [menuItems, setMenuItems] = useState<MenuItemRow[]>([]);
  const [weeklyEntries, setWeeklyEntries] = useState<WeeklyMenuRow[]>([]);
  const [selectedDay, setSelectedDay] = useState(0);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    if (!profile?.id) { setLoading(false); return; }
    (async () => {
      try {
        const seller = await fetchSellerByUserId(profile.id);
        if (!seller) { setLoading(false); return; }
        setSellerId(seller.id);
        setUsesWeeklyMenu((seller as any).uses_weekly_menu ?? false);
        const [items, weekly] = await Promise.all([
          fetchMenuItems(seller.id),
          fetchWeeklyMenu(seller.id).catch(() => [] as WeeklyMenuRow[]),
        ]);
        setMenuItems(items);
        setWeeklyEntries(weekly);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, [profile]);

  const dayEntries = weeklyEntries.filter(e => e.day_of_week === selectedDay);
  const dayItemIds = new Set(dayEntries.map(e => e.menu_item_id));
  const assignedItems = menuItems.filter(m => dayItemIds.has(m.id));
  const availableToAdd = menuItems.filter(m => !dayItemIds.has(m.id) && m.is_available);

  const handleToggle = async (enabled: boolean) => {
    if (!sellerId) return;
    setToggling(true);
    try {
      await toggleWeeklyMenuMode(sellerId, enabled);
      setUsesWeeklyMenu(enabled);
    } catch {
      Alert.alert('Hata', 'Ayar değiştirilemedi.');
    } finally {
      setToggling(false);
    }
  };

  const handleAdd = async (menuItemId: string) => {
    if (!sellerId) return;
    try {
      await addWeeklyMenuItem(sellerId, menuItemId, selectedDay);
      setWeeklyEntries(prev => [
        ...prev,
        { id: `temp-${Date.now()}`, seller_id: sellerId, menu_item_id: menuItemId, day_of_week: selectedDay, is_active: true, created_at: new Date().toISOString() },
      ]);
      setPickerVisible(false);
    } catch {
      Alert.alert('Hata', 'Eklenemedi.');
    }
  };

  const handleRemove = async (menuItemId: string) => {
    if (!sellerId) return;
    try {
      await removeWeeklyMenuItem(sellerId, menuItemId, selectedDay);
      setWeeklyEntries(prev => prev.filter(e => !(e.menu_item_id === menuItemId && e.day_of_week === selectedDay)));
    } catch {
      Alert.alert('Hata', 'Kaldırılamadı.');
    }
  };

  if (loading) {
    return (
      <View style={[styles.safe, { backgroundColor: t.background }]}>
        <TopBar title="Haftalık menü" back />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={t.primary} />
          <Text style={[styles.loadingText, { color: t.textSecondary }]}>Yükleniyor...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.safe, { backgroundColor: t.background }]}>
      <TopBar title="Haftalık menü" back />

      {/* Toggle */}
      <View style={[styles.toggleSection, { backgroundColor: t.surface }]}>
        <View style={styles.toggleInfo}>
          <Text style={[styles.toggleLabel, { color: t.text }]}>Haftalık menüyü aktif et</Text>
          <Text style={[styles.toggleHint, { color: t.textSecondary }]}>
            Müşterilerin hangi gün ne pişirdiğini görebilir.
          </Text>
        </View>
        <Switch
          value={usesWeeklyMenu}
          onValueChange={handleToggle}
          disabled={toggling}
          trackColor={{ true: t.primary, false: t.divider }}
          thumbColor={t.onBrand}
          {...({ activeThumbColor: t.onBrand } as object)}
          accessibilityLabel="Haftalık menüyü aktif et"
        />
      </View>

      {!usesWeeklyMenu ? (
        <View style={styles.disabledState}>
          <Ionicons name="calendar-outline" size={44} color={t.textMuted} />
          <Text style={[styles.emptyTitle, { color: t.heading }]}>Haftalık menü kapalı</Text>
          <Text style={[styles.emptySub, { color: t.textSecondary }]}>
            Bu özellik isteğe bağlı. Aktif edersen her güne özel yemek planlayabilirsin.
          </Text>
        </View>
      ) : (
        <>
          {/* Day tabs */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dayTabsRow}
            style={styles.noGrow}
          >
            {DAY_LABELS.map((label, idx) => {
              const count = weeklyEntries.filter(e => e.day_of_week === idx).length;
              const isSelected = selectedDay === idx;
              return (
                <Pressable
                  key={idx}
                  style={[styles.chip, { backgroundColor: isSelected ? t.brand : t.surface }]}
                  hitSlop={2}
                  onPress={() => setSelectedDay(idx)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={count > 0 ? `${DAY_FULL[idx]}, ${count} yemek` : DAY_FULL[idx]}
                >
                  <Text style={[styles.chipText, { color: isSelected ? t.onBrand : t.text }]}>{label}</Text>
                  {count > 0 && (
                    <View style={[styles.dayBadge, { backgroundColor: isSelected ? t.panel : t.background }]}>
                      <Text style={[styles.dayBadgeText, { color: isSelected ? t.onBrand : t.text }]}>{count}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Day title */}
          <View style={styles.dayHeader}>
            <Text style={[styles.dayHeaderText, { color: t.heading }]}>{DAY_FULL[selectedDay]}</Text>
            <Button label="Yemek ekle" size="sm" onPress={() => setPickerVisible(true)} />
          </View>

          {/* Assigned items */}
          <ScrollView contentContainerStyle={styles.itemsList} showsVerticalScrollIndicator={false}>
            {assignedItems.length === 0 ? (
              <View style={styles.emptyDay}>
                <Ionicons name="restaurant-outline" size={44} color={t.textMuted} />
                <Text style={[styles.emptySub, { color: t.textSecondary }]}>Bu gün için henüz yemek eklenmedi</Text>
              </View>
            ) : (
              assignedItems.map(item => (
                <View key={item.id} style={[styles.assignedCard, { backgroundColor: t.surface }]}>
                  <View style={styles.assignedInfo}>
                    <Text style={[styles.assignedTitle, { color: t.text }]}>{item.title}</Text>
                    {item.description ? (
                      <Text style={[styles.assignedDesc, { color: t.textSecondary }]} numberOfLines={1}>{item.description}</Text>
                    ) : null}
                    <Text style={[styles.assignedPrice, { color: t.text }]}>{priceTL(item.price_cents)}</Text>
                  </View>
                  <Pressable
                    style={styles.removeBtn}
                    onPress={() => handleRemove(item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.title} yemeğini bu günden kaldır`}
                  >
                    <Ionicons name="close-circle" size={24} color={t.danger} />
                  </Pressable>
                </View>
              ))
            )}
          </ScrollView>
        </>
      )}

      {/* Picker Modal */}
      <Modal visible={pickerVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPickerVisible(false)}>
        <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top', 'bottom']}>
          <View style={[styles.pickerHeader, { borderBottomColor: t.divider }]}>
            <Pressable style={styles.pickerClose} onPress={() => setPickerVisible(false)} accessibilityRole="button">
              <Text style={[styles.pickerCancel, { color: t.textSecondary }]}>Kapat</Text>
            </Pressable>
            <Text style={[styles.pickerTitle, { color: t.heading }]} numberOfLines={1} accessibilityRole="header">{DAY_FULL[selectedDay]}: yemek seç</Text>
            <View style={styles.pickerClose} />
          </View>

          {availableToAdd.length === 0 ? (
            <View style={styles.pickerEmpty}>
              <Ionicons name="checkmark-done-circle-outline" size={44} color={t.textMuted} />
              <Text style={[styles.emptySub, { color: t.textSecondary }]}>
                Menündeki tüm yemekler bu güne eklenmiş veya eklenecek aktif yemek yok.
              </Text>
            </View>
          ) : (
            <FlatList
              data={availableToAdd}
              keyExtractor={item => item.id}
              contentContainerStyle={styles.pickerList}
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.pickerItem, { backgroundColor: t.surface }]}
                  onPress={() => handleAdd(item.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}, ${priceTL(item.price_cents)}. Bu güne ekle`}
                >
                  <View style={styles.pickerItemInfo}>
                    <Text style={[styles.pickerItemTitle, { color: t.text }]}>{item.title}</Text>
                    {item.category ? (
                      <Text style={[styles.pickerItemCat, { color: t.textSecondary }]}>{categoryLabel(item.category)}</Text>
                    ) : null}
                    <Text style={[styles.pickerItemPrice, { color: t.text }]}>{priceTL(item.price_cents)}</Text>
                  </View>
                  <Ionicons name="add-circle-outline" size={26} color={t.text} />
                </Pressable>
              )}
            />
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  noGrow: { flexGrow: 0 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontFamily: fonts.regular, fontSize: 13 },

  toggleSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
  },
  toggleInfo: { flex: 1, marginRight: 12 },
  toggleLabel: { fontSize: 14, fontFamily: fonts.bold },
  toggleHint: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular, marginTop: 3 },

  disabledState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 18, fontFamily: fonts.display },
  emptySub: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, textAlign: 'center' },

  dayTabsRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  chip: { height: 40, minWidth: 44, paddingHorizontal: 14, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  chipText: { fontSize: 13, fontFamily: fonts.bold },
  dayBadge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  dayBadgeText: { fontSize: 11, fontFamily: fonts.bold },

  dayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  dayHeaderText: { fontSize: 18, lineHeight: 24, fontFamily: fonts.display, letterSpacing: -0.4 },

  itemsList: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32, gap: 10 },
  emptyDay: { alignItems: 'center', paddingTop: 40, paddingHorizontal: 32, gap: 8 },

  assignedCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, paddingVertical: 8, paddingLeft: 14, paddingRight: 4 },
  assignedInfo: { flex: 1, minWidth: 0 },
  assignedTitle: { fontSize: 15, fontFamily: fonts.bold },
  assignedDesc: { fontSize: 12, fontFamily: fonts.regular, marginTop: 2 },
  assignedPrice: { fontSize: 14, fontFamily: fonts.extrabold, marginTop: 4 },
  removeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  // Picker modal
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  pickerClose: { minHeight: 44, minWidth: 52, justifyContent: 'center' },
  pickerTitle: { flexShrink: 1, fontSize: 18, lineHeight: 24, fontFamily: fonts.display, letterSpacing: -0.3 },
  pickerCancel: { fontSize: 15, fontFamily: fonts.semibold },
  pickerList: { padding: 16, gap: 10 },
  pickerEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8 },
  pickerItem: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, padding: 14 },
  pickerItemInfo: { flex: 1, minWidth: 0 },
  pickerItemTitle: { fontSize: 15, fontFamily: fonts.bold },
  pickerItemCat: { fontSize: 12, fontFamily: fonts.regular, marginTop: 2 },
  pickerItemPrice: { fontSize: 14, fontFamily: fonts.extrabold, marginTop: 3 },
});
