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
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants/theme';
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

const DAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const DAY_FULL = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

export default function WeeklyMenuScreen() {
  const router = useRouter();
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
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ marginTop: 12, color: '#5E6862', fontFamily: fonts.regular, fontSize: 13 }}>Yükleniyor...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#151A16" />
        </Pressable>
        <Text style={styles.headerTitle}>Haftalık Menü</Text>
        <View style={{ width: 34 }} />
      </View>

      {/* Toggle */}
      <View style={styles.toggleSection}>
        <View style={styles.toggleInfo}>
          <Text style={styles.toggleLabel}>Haftalık menüyü aktif et</Text>
          <Text style={styles.toggleHint}>
            Müşterilerin hangi gün ne pişirdiğini görebilir.
          </Text>
        </View>
        <Switch
          value={usesWeeklyMenu}
          onValueChange={handleToggle}
          disabled={toggling}
          trackColor={{ true: colors.primary, false: '#E3E6DE' }}
          thumbColor="#fff"
        />
      </View>

      {!usesWeeklyMenu ? (
        <View style={styles.disabledState}>
          <Ionicons name="calendar-outline" size={56} color="#C4CAC5" />
          <Text style={styles.disabledTitle}>Haftalık Menü Kapalı</Text>
          <Text style={styles.disabledSub}>
            Bu özellik opsiyoneldir. Aktif edersen her güne özel yemek planlayabilirsin.
          </Text>
        </View>
      ) : (
        <>
          {/* Day tabs */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dayTabsRow}
            style={{ flexGrow: 0 }}
          >
            {DAY_LABELS.map((label, idx) => {
              const count = weeklyEntries.filter(e => e.day_of_week === idx).length;
              const isSelected = selectedDay === idx;
              return (
                <Pressable
                  key={idx}
                  style={[styles.dayTab, isSelected && styles.dayTabActive]}
                  onPress={() => setSelectedDay(idx)}
                >
                  <Text style={[styles.dayTabText, isSelected && styles.dayTabTextActive]}>{label}</Text>
                  {count > 0 && (
                    <View style={[styles.dayTabBadge, isSelected && styles.dayTabBadgeActive]}>
                      <Text style={[styles.dayTabBadgeText, isSelected && styles.dayTabBadgeTextActive]}>{count}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Day title */}
          <View style={styles.dayHeader}>
            <Text style={styles.dayHeaderText}>{DAY_FULL[selectedDay]}</Text>
            <Pressable style={styles.addItemBtn} onPress={() => setPickerVisible(true)}>
              <Ionicons name="add-circle" size={20} color={colors.primary} />
              <Text style={styles.addItemBtnText}>Yemek Ekle</Text>
            </Pressable>
          </View>

          {/* Assigned items */}
          <ScrollView contentContainerStyle={styles.itemsList} showsVerticalScrollIndicator={false}>
            {assignedItems.length === 0 ? (
              <View style={styles.emptyDay}>
                <Ionicons name="restaurant-outline" size={40} color="#C4CAC5" />
                <Text style={styles.emptyDayText}>Bu gün için henüz yemek eklenmedi</Text>
                <Pressable style={styles.emptyAddBtn} onPress={() => setPickerVisible(true)}>
                  <Text style={styles.emptyAddBtnText}>+ Yemek Ekle</Text>
                </Pressable>
              </View>
            ) : (
              assignedItems.map(item => (
                <View key={item.id} style={styles.assignedCard}>
                  <View style={styles.assignedInfo}>
                    <Text style={styles.assignedTitle}>{item.title}</Text>
                    {item.description ? (
                      <Text style={styles.assignedDesc} numberOfLines={1}>{item.description}</Text>
                    ) : null}
                    <Text style={styles.assignedPrice}>{priceTL(item.price_cents)}</Text>
                  </View>
                  <Pressable
                    style={styles.removeBtn}
                    onPress={() => handleRemove(item.id)}
                    hitSlop={8}
                  >
                    <Ionicons name="close-circle" size={24} color="#C62828" />
                  </Pressable>
                </View>
              ))
            )}
          </ScrollView>
        </>
      )}

      {/* Picker Modal */}
      <Modal visible={pickerVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.pickerSafe} edges={['top', 'bottom']}>
          <View style={styles.pickerHeader}>
            <Pressable onPress={() => setPickerVisible(false)}>
              <Text style={styles.pickerCancel}>Kapat</Text>
            </Pressable>
            <Text style={styles.pickerTitle}>{DAY_FULL[selectedDay]} - Yemek Seç</Text>
            <View style={{ width: 50 }} />
          </View>

          {availableToAdd.length === 0 ? (
            <View style={styles.pickerEmpty}>
              <Ionicons name="checkmark-done-circle-outline" size={48} color="#5E6862" />
              <Text style={styles.pickerEmptyText}>
                Tüm menündeki yemekler bu güne eklenmis veya eklenecek aktif yemek yok.
              </Text>
            </View>
          ) : (
            <FlatList
              data={availableToAdd}
              keyExtractor={item => item.id}
              contentContainerStyle={styles.pickerList}
              renderItem={({ item }) => (
                <Pressable style={styles.pickerItem} onPress={() => handleAdd(item.id)}>
                  <View style={styles.pickerItemInfo}>
                    <Text style={styles.pickerItemTitle}>{item.title}</Text>
                    {item.category ? (
                      <Text style={styles.pickerItemCat}>{item.category}</Text>
                    ) : null}
                    <Text style={styles.pickerItemPrice}>{priceTL(item.price_cents)}</Text>
                  </View>
                  <Ionicons name="add-circle-outline" size={26} color={colors.primary} />
                </Pressable>
              )}
            />
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F1F2EE' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E3E6DE',
  },
  backBtn: { width: 34, alignItems: 'flex-start' },
  headerTitle: { fontSize: 18, color: '#151A16', fontFamily: fonts.display },

  toggleSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E3E6DE',
  },
  toggleInfo: { flex: 1, marginRight: 12 },
  toggleLabel: { fontSize: 14, fontFamily: fonts.bold, color: '#151A16' },
  toggleHint: { fontFamily: fonts.regular, fontSize: 12, color: '#5E6862', marginTop: 3, lineHeight: 17 },

  disabledState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  disabledTitle: { fontSize: 17, fontFamily: fonts.bold, color: '#56605A' },
  disabledSub: { fontFamily: fonts.regular, fontSize: 13, color: '#5E6862', textAlign: 'center', lineHeight: 19 },

  dayTabsRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  dayTab: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E3E6DE',
    alignItems: 'center',
    minWidth: 48,
  },
  dayTabActive: { backgroundColor: '#2C312E', borderColor: '#151A16' },
  dayTabText: { fontSize: 13, fontFamily: fonts.bold, color: '#56605A' },
  dayTabTextActive: { color: '#fff' },
  dayTabBadge: {
    backgroundColor: '#E3E6DE',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginTop: 4,
  },
  dayTabBadgeActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  dayTabBadgeText: { fontSize: 10, fontFamily: fonts.bold, color: '#56605A' },
  dayTabBadgeTextActive: { color: '#fff' },

  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
  },
  dayHeaderText: { fontSize: 16, fontFamily: fonts.bold, color: '#151A16' },
  addItemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: '#F1F2EE',
    borderWidth: 1,
    borderColor: colors.primary + '30',
  },
  addItemBtnText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.primary },

  itemsList: { padding: 16, paddingBottom: 40, gap: 10 },

  emptyDay: {
    alignItems: 'center',
    paddingTop: 50,
    gap: 12,
  },
  emptyDayText: { fontFamily: fonts.regular, fontSize: 14, color: '#5E6862', textAlign: 'center' },
  emptyAddBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 6,
  },
  emptyAddBtnText: { color: '#fff', fontSize: 13, fontFamily: fonts.bold },

  assignedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E3E6DE',
    padding: 14,
  },
  assignedInfo: { flex: 1 },
  assignedTitle: { fontSize: 15, fontFamily: fonts.bold, color: '#151A16' },
  assignedDesc: { fontFamily: fonts.regular, fontSize: 12, color: '#5E6862', marginTop: 2 },
  assignedPrice: { fontSize: 14, fontFamily: fonts.extrabold, color: colors.primary, marginTop: 4 },
  removeBtn: { padding: 4 },

  // Picker modal
  pickerSafe: { flex: 1, backgroundColor: '#F1F2EE' },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E3E6DE',
  },
  pickerTitle: { fontSize: 15, fontFamily: fonts.extrabold, color: '#151A16' },
  pickerCancel: { fontSize: 15, color: '#5E6862', fontFamily: fonts.semibold },
  pickerList: { padding: 16, gap: 10 },
  pickerEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  pickerEmptyText: { fontFamily: fonts.regular, fontSize: 13, color: '#5E6862', textAlign: 'center', lineHeight: 19 },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E3E6DE',
    padding: 14,
  },
  pickerItemInfo: { flex: 1 },
  pickerItemTitle: { fontSize: 15, fontFamily: fonts.bold, color: '#151A16' },
  pickerItemCat: { fontFamily: fonts.regular, fontSize: 11, color: '#5E6862', marginTop: 2 },
  pickerItemPrice: { fontSize: 14, fontFamily: fonts.extrabold, color: colors.primary, marginTop: 3 },
});
