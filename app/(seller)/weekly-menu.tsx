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
          <Text style={{ marginTop: 12, color: '#A89A8A', fontSize: 13 }}>Yükleniyor...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#1A1208" />
        </Pressable>
        <Text style={styles.headerTitle}>Haftalik Menu</Text>
        <View style={{ width: 34 }} />
      </View>

      {/* Toggle */}
      <View style={styles.toggleSection}>
        <View style={styles.toggleInfo}>
          <Text style={styles.toggleLabel}>Haftalik menuyu aktif et</Text>
          <Text style={styles.toggleHint}>
            Musterileriniz hangi gun ne pisirdiginizi gorebilir.
          </Text>
        </View>
        <Switch
          value={usesWeeklyMenu}
          onValueChange={handleToggle}
          disabled={toggling}
          trackColor={{ true: colors.primary, false: '#E0E0E0' }}
          thumbColor="#fff"
        />
      </View>

      {!usesWeeklyMenu ? (
        <View style={styles.disabledState}>
          <Ionicons name="calendar-outline" size={56} color="#D0C8BC" />
          <Text style={styles.disabledTitle}>Haftalik Menu Kapali</Text>
          <Text style={styles.disabledSub}>
            Bu ozellik opsiyoneldir. Aktif ederseniz her gune ozel yemek planlayabilirsiniz.
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
                <Ionicons name="restaurant-outline" size={40} color="#D0C8BC" />
                <Text style={styles.emptyDayText}>Bu gun icin henuz yemek eklenmedi</Text>
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
                    <Ionicons name="close-circle" size={24} color="#E53935" />
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
            <Text style={styles.pickerTitle}>{DAY_FULL[selectedDay]} - Yemek Sec</Text>
            <View style={{ width: 50 }} />
          </View>

          {availableToAdd.length === 0 ? (
            <View style={styles.pickerEmpty}>
              <Ionicons name="checkmark-done-circle-outline" size={48} color="#A89A8A" />
              <Text style={styles.pickerEmptyText}>
                Tum menunizdeki yemekler bu gune eklenmis veya eklenecek aktif yemek yok.
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
  safe: { flex: 1, backgroundColor: '#FAF7F2' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EDE8E2',
  },
  backBtn: { width: 34, alignItems: 'flex-start' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#1A1208', fontFamily: 'serif' },

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
    borderColor: '#EDE8E2',
  },
  toggleInfo: { flex: 1, marginRight: 12 },
  toggleLabel: { fontSize: 14, fontWeight: '700', color: '#1A1208' },
  toggleHint: { fontSize: 12, color: '#A89A8A', marginTop: 3, lineHeight: 17 },

  disabledState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  disabledTitle: { fontSize: 17, fontWeight: '700', color: '#6B5E50' },
  disabledSub: { fontSize: 13, color: '#A89A8A', textAlign: 'center', lineHeight: 19 },

  dayTabsRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  dayTab: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#EDE8E2',
    alignItems: 'center',
    minWidth: 48,
  },
  dayTabActive: { backgroundColor: '#1A1208', borderColor: '#1A1208' },
  dayTabText: { fontSize: 13, fontWeight: '700', color: '#6B5E50' },
  dayTabTextActive: { color: '#fff' },
  dayTabBadge: {
    backgroundColor: '#F0EBE5',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginTop: 4,
  },
  dayTabBadgeActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  dayTabBadgeText: { fontSize: 10, fontWeight: '700', color: '#6B5E50' },
  dayTabBadgeTextActive: { color: '#fff' },

  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
  },
  dayHeaderText: { fontSize: 16, fontWeight: '700', color: '#1A1208' },
  addItemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: '#FFF5F2',
    borderWidth: 1,
    borderColor: colors.primary + '30',
  },
  addItemBtnText: { fontSize: 13, fontWeight: '600', color: colors.primary },

  itemsList: { padding: 16, paddingBottom: 40, gap: 10 },

  emptyDay: {
    alignItems: 'center',
    paddingTop: 50,
    gap: 12,
  },
  emptyDayText: { fontSize: 14, color: '#A89A8A', textAlign: 'center' },
  emptyAddBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 6,
  },
  emptyAddBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  assignedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    padding: 14,
  },
  assignedInfo: { flex: 1 },
  assignedTitle: { fontSize: 15, fontWeight: '700', color: '#1A1208' },
  assignedDesc: { fontSize: 12, color: '#A89A8A', marginTop: 2 },
  assignedPrice: { fontSize: 14, fontWeight: '800', color: colors.primary, marginTop: 4 },
  removeBtn: { padding: 4 },

  // Picker modal
  pickerSafe: { flex: 1, backgroundColor: '#FAF7F2' },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EDE8E2',
  },
  pickerTitle: { fontSize: 15, fontWeight: '800', color: '#1A1208' },
  pickerCancel: { fontSize: 15, color: '#A89A8A', fontWeight: '600' },
  pickerList: { padding: 16, gap: 10 },
  pickerEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  pickerEmptyText: { fontSize: 13, color: '#A89A8A', textAlign: 'center', lineHeight: 19 },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    padding: 14,
  },
  pickerItemInfo: { flex: 1 },
  pickerItemTitle: { fontSize: 15, fontWeight: '700', color: '#1A1208' },
  pickerItemCat: { fontSize: 11, color: '#A89A8A', marginTop: 2 },
  pickerItemPrice: { fontSize: 14, fontWeight: '800', color: colors.primary, marginTop: 3 },
});
