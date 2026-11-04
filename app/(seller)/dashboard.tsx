import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { colors } from '@/constants/theme';
import { DELIVERY_CONFIG, SELLER_TYPE_LABELS } from '@/constants/business';
import { useAuth } from '@/lib/auth-context';
import { fetchUnreadCount } from '@/lib/messages';
import { fetchCommissionRates, fetchSellerByUserId, fetchSellerOrders, updateSeller, type CommissionRates, type OrderWithItems, type SellerRow } from '@/lib/db';
import { fonts } from '@/lib/fonts';
import { useResponsive } from '@/lib/responsive';

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(0)}`;
}

const DAY_NAMES = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const TODAY_IDX = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;

type OrderStatus = 'pending' | 'accepted' | 'preparing' | 'ready' | 'delivered' | 'cancelled';

type RecentOrder = {
  id: string; status: OrderStatus; total_cents: number;
  created_at: string; customer_name: string; items: string;
};

type TopItem = { id: number; title: string; sold: number; revenue: number; emoji: string };

type CustomerStats = {
  totalCustomers: number;
  returningCustomers: number;
  avgOrderValue: number;
  topCustomers: { name: string; orders: number; spent: number }[];
};

function computeWeekly(orders: OrderWithItems[]) {
  const weekData = DAY_NAMES.map(day => ({ day, orders: 0, revenue: 0 }));
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
  weekStart.setHours(0, 0, 0, 0);

  orders.forEach(o => {
    const d = new Date(o.created_at);
    if (d >= weekStart && o.status !== 'cancelled') {
      const dayIdx = d.getDay() === 0 ? 6 : d.getDay() - 1;
      weekData[dayIdx].orders += 1;
      weekData[dayIdx].revenue += o.total_cents;
    }
  });
  return weekData;
}

function computeTopItems(orders: OrderWithItems[]): TopItem[] {
  const map = new Map<string, { sold: number; revenue: number }>();
  orders.forEach(o => {
    o.order_items.forEach(item => {
      const key = item.title_snapshot;
      const prev = map.get(key) ?? { sold: 0, revenue: 0 };
      map.set(key, { sold: prev.sold + item.quantity, revenue: prev.revenue + item.line_total_cents });
    });
  });
  return Array.from(map.entries())
    .sort((a, b) => b[1].sold - a[1].sold)
    .slice(0, 5)
    .map(([title, data], i) => ({ id: i + 1, title, sold: data.sold, revenue: data.revenue, emoji: '🍽️' }));
}

function computeCustomerStats(orders: OrderWithItems[]): CustomerStats {
  const customerMap = new Map<string, { orders: number; spent: number }>();
  orders.forEach(o => {
    if (!o.customer_id) return; // hesabını silmiş müşteri
    const prev = customerMap.get(o.customer_id) ?? { orders: 0, spent: 0 };
    customerMap.set(o.customer_id, { orders: prev.orders + 1, spent: prev.spent + o.total_cents });
  });
  const totalCustomers = customerMap.size;
  const returningCustomers = Array.from(customerMap.values()).filter(c => c.orders > 1).length;
  const totalSpent = orders.reduce((s, o) => s + o.total_cents, 0);
  const avgOrderValue = orders.length > 0 ? Math.round(totalSpent / orders.length) : 0;
  const topCustomers = Array.from(customerMap.entries())
    .sort((a, b) => b[1].orders - a[1].orders)
    .slice(0, 3)
    .map(([id, data]) => ({ name: id.slice(0, 8) + '...', orders: data.orders, spent: data.spent }));
  return { totalCustomers, returningCustomers, avgOrderValue, topCustomers };
}

const STATUS_CONFIG: Record<OrderStatus, { label: string; bg: string; text: string }> = {
  pending:   { label: 'Bekliyor',      bg: '#FFF8E1', text: '#F57F17' },
  accepted:  { label: 'Kabul Edildi',  bg: '#E3F2FD', text: '#1565C0' },
  preparing: { label: 'Hazırlanıyor',  bg: '#FFF3E0', text: '#E65100' },
  ready:     { label: 'Hazır',         bg: '#E8F5E9', text: '#2E7D32' },
  delivered: { label: 'Teslim Edildi', bg: '#E8F5E9', text: '#2E7D32' },
  cancelled: { label: 'İptal',         bg: '#F5F5F5', text: '#9E9E9E' },
};

function formatTime(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 60) return `${diffMin} dk önce`;
  return `${Math.floor(diffMin / 60)} sa önce`;
}

export default function SellerDashboardScreen() {
  const { isDesktop } = useResponsive();
  const { profile } = useAuth();
  const router = useRouter();
  const [selectedDay, setSelectedDay] = useState(TODAY_IDX);
  const [allOrders, setAllOrders] = useState<OrderWithItems[]>([]);
  const [seller, setSeller] = useState<SellerRow | null>(null);
  const storeOpen = !seller?.is_paused;
  const setStoreOpen = async (open: boolean) => {
    if (!seller) return;
    try {
      setSeller(await updateSeller(seller.id, { is_paused: !open }));
    } catch {
      Alert.alert('Mağaza güncellenemedi', 'Lütfen tekrar deneyin.');
    }
  };
  const [commissionRates, setCommissionRates] = useState<CommissionRates | null>(null);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [unreadMessages, setUnreadMessages] = useState(0);

  useFocusEffect(useCallback(() => {
    fetchUnreadCount('seller').then(setUnreadMessages);
  }, []));

  const loadData = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const s = await fetchSellerByUserId(profile.id);
      if (!s) return;
      setSeller(s);
      fetchCommissionRates().then(setCommissionRates).catch(() => {});
      const orders = await fetchSellerOrders(s.id);
      setAllOrders(orders);
      setRecentOrders(orders.slice(0, 5).map(o => ({
        id: o.id,
        status: o.status as OrderStatus,
        total_cents: o.total_cents,
        created_at: o.created_at,
        customer_name: o.customer_id ? o.customer_id.slice(0, 8) + '...' : 'Silinmiş kullanıcı',
        items: o.order_items.map(i => `${i.quantity}× ${i.title_snapshot}`).join(', '),
      })));
    } catch {}
  }, [profile?.id]);

  useEffect(() => { loadData(); }, [loadData]);

  const WEEKLY = useMemo(() => computeWeekly(allOrders), [allOrders]);
  const TOP_ITEMS = useMemo(() => computeTopItems(allOrders), [allOrders]);
  const CUSTOMER_STATS = useMemo(() => computeCustomerStats(allOrders), [allOrders]);

  const today = WEEKLY[TODAY_IDX];
  const pendingCount = recentOrders.filter(o => o.status === 'pending').length;
  const weekRevenue = WEEKLY.reduce((s, d) => s + d.revenue, 0);
  const weekOrders = WEEKLY.reduce((s, d) => s + d.orders, 0);

  const maxRevenue = Math.max(1, ...WEEKLY.map(d => d.revenue));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.topRow}>
          <View>
            {!isDesktop ? <Text style={styles.logo}>evinden</Text> : null}
            <Text style={styles.greeting}>Merhaba, {profile?.name?.split(' ')[0] ?? 'Satıcı'} 👋</Text>
          </View>
          <Pressable style={styles.backBtn} onPress={() => router.push('/(customer)/profile' as any)}>
            <Text style={styles.backBtnText}>← Müşteri Modu</Text>
          </Pressable>
        </View>

        {/* Mağaza özeti */}
        <View style={styles.storeCard}>
          <View style={styles.storeEmoji}>
            <Text style={{ fontFamily: fonts.regular, fontSize: 28 }}>🍲</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.storeName}>{seller?.display_name ?? 'Mutfağım'}</Text>
            <Text style={styles.storeLoc}>📍 {seller?.district ?? ''}{seller?.city ? `, ${seller.city}` : ''}</Text>
          </View>
          <Pressable
            style={[styles.activeBadge, !storeOpen && styles.closedBadge]}
            onPress={() => {
              if (storeOpen) {
                Alert.alert(
                  'Mağazayı Kapat',
                  'Mağazanız müşterilere kapalı görünecek. Devam etmek istiyor musunuz?',
                  [
                    { text: 'Vazgeç', style: 'cancel' },
                    { text: 'Kapat', style: 'destructive', onPress: () => setStoreOpen(false) },
                  ],
                );
              } else {
                setStoreOpen(true);
              }
            }}
          >
            <Text style={[styles.activeBadgeText, !storeOpen && styles.closedBadgeText]}>
              {storeOpen ? '● Açık' : '● Kapalı'}
            </Text>
          </Pressable>
        </View>

        {/* Kapalı uyarısı */}
        {!storeOpen ? (
          <Pressable style={styles.closedBanner} onPress={() => setStoreOpen(true)}>
            <Text style={styles.closedBannerText}>Mağazanız şu an kapalı</Text>
            <Text style={styles.closedBannerAction}>Aç →</Text>
          </Pressable>
        ) : null}

        {/* Bugün istatistikleri */}
        <Text style={styles.sectionTitle}>Bugün</Text>
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: '#FFF8E1' }]}>
            <Text style={styles.statNum}>{pendingCount}</Text>
            <Text style={styles.statLabel}>Bekleyen</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: '#E8F5E9' }]}>
            <Text style={styles.statNum}>{today.orders}</Text>
            <Text style={styles.statLabel}>Sipariş</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: '#E3F2FD' }]}>
            <Text style={[styles.statNum, { fontSize: 15 }]}>{priceTL(today.revenue)}</Text>
            <Text style={styles.statLabel}>Gelir</Text>
          </View>
        </View>

        {/* Haftanın özeti */}
        <View style={styles.weekCard}>
          <View style={styles.weekHeader}>
            <Text style={styles.weekTitle}>Bu Hafta</Text>
            <View style={styles.weekSummary}>
              <Text style={styles.weekStat}>{weekOrders} sipariş</Text>
              <Text style={styles.weekDot}>·</Text>
              <Text style={styles.weekStatBold}>{priceTL(weekRevenue)}</Text>
            </View>
          </View>

          {/* Bar chart */}
          <View style={styles.chart}>
            {WEEKLY.map((d, idx) => {
              const ratio = d.revenue / maxRevenue;
              const isToday = idx === TODAY_IDX;
              const isSelected = idx === selectedDay;
              return (
                <Pressable
                  key={d.day}
                  style={styles.barWrap}
                  onPress={() => setSelectedDay(idx)}
                >
                  <Text style={[styles.barCount, isSelected && styles.barCountActive]}>
                    {d.orders}
                  </Text>
                  <View style={styles.barContainer}>
                    <View
                      style={[
                        styles.bar,
                        { height: Math.max(6, ratio * 80) },
                        isSelected && styles.barActive,
                        isToday && !isSelected && styles.barToday,
                      ]}
                    />
                  </View>
                  <Text style={[styles.barDay, isSelected && styles.barDayActive, isToday && styles.barDayToday]}>
                    {d.day}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Seçili gün detayı */}
          <View style={styles.selectedDay}>
            <Text style={styles.selectedDayLabel}>
              {WEEKLY[selectedDay].day}{selectedDay === TODAY_IDX ? ' (Bugün)' : ''}
            </Text>
            <Text style={styles.selectedDayRevenue}>{priceTL(WEEKLY[selectedDay].revenue)}</Text>
            <Text style={styles.selectedDayOrders}>{WEEKLY[selectedDay].orders} sipariş</Text>
          </View>
        </View>

        {/* En çok satanlar */}
        <Text style={styles.sectionTitle}>En Çok Satan Ürünler</Text>
        <View style={styles.topItemsCard}>
          {TOP_ITEMS.map((item, idx) => (
            <View key={item.id} style={[styles.topItemRow, idx < TOP_ITEMS.length - 1 && styles.topItemBorder]}>
              <Text style={styles.topItemRank}>#{idx + 1}</Text>
              <Text style={styles.topItemEmoji}>{item.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.topItemName}>{item.title}</Text>
                <Text style={styles.topItemSold}>{item.sold} adet satıldı</Text>
              </View>
              <Text style={styles.topItemRevenue}>{priceTL(item.revenue)}</Text>
            </View>
          ))}
        </View>

        {/* Müşteri istatistikleri */}
        <Text style={styles.sectionTitle}>Müşteri İstatistikleri</Text>
        <View style={styles.customerStatsRow}>
          <View style={[styles.statCard, { backgroundColor: '#F3E5F5' }]}>
            <Text style={styles.statNum}>{CUSTOMER_STATS.totalCustomers}</Text>
            <Text style={styles.statLabel}>Toplam{'\n'}Müşteri</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: '#E0F7FA' }]}>
            <Text style={styles.statNum}>{CUSTOMER_STATS.returningCustomers}</Text>
            <Text style={styles.statLabel}>Tekrar{'\n'}Gelen</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: '#FFF3E0' }]}>
            <Text style={[styles.statNum, { fontSize: 15 }]}>{priceTL(CUSTOMER_STATS.avgOrderValue)}</Text>
            <Text style={styles.statLabel}>Ort.{'\n'}Sipariş</Text>
          </View>
        </View>

        {/* En sadık müşteriler */}
        <View style={styles.topCustomersCard}>
          <Text style={styles.topCustomersTitle}>En Sadık Müşteriler</Text>
          {CUSTOMER_STATS.topCustomers.map((c, i) => (
            <View key={i} style={styles.topCustomerRow}>
              <View style={[styles.topCustomerAvatar, { backgroundColor: ['#FFF3E0', '#E8F5E9', '#E3F2FD'][i] }]}>
                <Text style={styles.topCustomerInitial}>{c.name.charAt(0)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.topCustomerName}>{c.name}</Text>
                <Text style={styles.topCustomerOrders}>{c.orders} sipariş</Text>
              </View>
              <Text style={styles.topCustomerSpent}>{priceTL(c.spent)}</Text>
            </View>
          ))}
        </View>

        {/* Hızlı erişim */}
        <View style={styles.quickRow}>
          <Pressable style={styles.quickBtn} onPress={() => router.push('/(seller)/menu' as any)}>
            <Text style={styles.quickEmoji}>🍽️</Text>
            <Text style={styles.quickLabel}>Menüyü{'\n'}Düzenle</Text>
          </Pressable>
          <Pressable style={[styles.quickBtn, { position: 'relative' }]} onPress={() => router.push('/(seller)/orders' as any)}>
            <Text style={styles.quickEmoji}>📦</Text>
            <Text style={styles.quickLabel}>Siparişler</Text>
            {pendingCount > 0 ? (
              <View style={styles.quickBadge}>
                <Text style={styles.quickBadgeText}>{pendingCount}</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable style={styles.quickBtn} onPress={() => router.push('/(seller)/profile' as any)}>
            <Text style={styles.quickEmoji}>⚙️</Text>
            <Text style={styles.quickLabel}>Mağaza{'\n'}Ayarları</Text>
          </Pressable>
        </View>

        {/* Yönetim araçları */}
        <Text style={styles.sectionTitle}>Yönetim Araçları</Text>
        <View style={styles.toolsGrid}>
          <Pressable style={styles.toolBtn} onPress={() => router.push('/(seller)/earnings' as any)}>
            <Text style={styles.toolEmoji}>💰</Text>
            <Text style={styles.toolLabel}>Kazancım</Text>
          </Pressable>
          <Pressable style={[styles.toolBtn, { position: 'relative' }]} onPress={() => router.push('/(seller)/messages' as any)}>
            <Text style={styles.toolEmoji}>💬</Text>
            <Text style={styles.toolLabel}>Mesajlar</Text>
            {unreadMessages > 0 ? (
              <View style={styles.quickBadge}>
                <Text style={styles.quickBadgeText}>{unreadMessages}</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable style={styles.toolBtn} onPress={() => router.push('/(seller)/analytics' as any)}>
            <Text style={styles.toolEmoji}>📈</Text>
            <Text style={styles.toolLabel}>Gelir Analizi</Text>
          </Pressable>
          <Pressable style={styles.toolBtn} onPress={() => router.push('/(seller)/notifications' as any)}>
            <Text style={styles.toolEmoji}>🔔</Text>
            <Text style={styles.toolLabel}>Bildirimler</Text>
          </Pressable>
          <Pressable style={styles.toolBtn} onPress={() => router.push('/(seller)/reviews' as any)}>
            <Text style={styles.toolEmoji}>⭐</Text>
            <Text style={styles.toolLabel}>Yorumlar</Text>
          </Pressable>
          <Pressable style={styles.toolBtn} onPress={() => router.push('/(seller)/campaigns' as any)}>
            <Text style={styles.toolEmoji}>🎉</Text>
            <Text style={styles.toolLabel}>Kampanyalar</Text>
          </Pressable>
          <Pressable style={styles.toolBtn} onPress={() => router.push('/(seller)/receipt' as any)}>
            <Text style={styles.toolEmoji}>🧾</Text>
            <Text style={styles.toolLabel}>Sipariş Fişi</Text>
          </Pressable>
        </View>

        {/* Komisyon & Teslimat bilgisi */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <View style={styles.infoBlock}>
              <Text style={styles.infoBlockTitle}>Komisyon Oranınız</Text>
              <Text style={styles.infoBlockValue}>{commissionRates ? `%${commissionRates[seller?.seller_type ?? 'home']}` : '-'}</Text>
              <Text style={styles.infoBlockSub}>{SELLER_TYPE_LABELS[seller?.seller_type ?? 'home']} · Her siparişten</Text>
            </View>
            <View style={styles.infoSep} />
            <View style={styles.infoBlock}>
              <Text style={styles.infoBlockTitle}>Teslimat Modeli</Text>
              <Text style={styles.infoBlockValue}>{DELIVERY_CONFIG.label}</Text>
              <Text style={styles.infoBlockSub}>Kendi kuryenizle teslim</Text>
            </View>
          </View>
        </View>

        {/* Son siparişler */}
        <Text style={styles.sectionTitle}>Son Siparişler</Text>
        {recentOrders.map(order => {
          const sc = STATUS_CONFIG[order.status];
          return (
            <View key={order.id} style={styles.orderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.orderCustomer}>{order.customer_name}</Text>
                <Text style={styles.orderItems} numberOfLines={1}>{order.items}</Text>
                <Text style={styles.orderTime}>{formatTime(order.created_at)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 5 }}>
                <Text style={styles.orderTotal}>{priceTL(order.total_cents)}</Text>
                <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
                  <Text style={[styles.statusText, { color: sc.text }]}>{sc.label}</Text>
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF8F2' },
  scroll: { padding: 20, paddingBottom: 40 },

  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  logo: { fontSize: 24, fontFamily: fonts.display, color: colors.secondary, letterSpacing: -0.7 },
  greeting: { fontFamily: fonts.regular, fontSize: 13, color: '#6B766F', marginTop: 2 },
  backBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E3E6DE',
    backgroundColor: '#fff',
  },
  backBtnText: { fontSize: 12, fontFamily: fonts.semibold, color: '#56605A' },

  storeCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#E3E6DE',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  storeEmoji: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#FFF3E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeName: { fontSize: 17, fontFamily: fonts.extrabold, color: '#151A16', marginBottom: 3 },
  storeLoc: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F' },
  activeBadge: {
    backgroundColor: '#E8F5E9',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  activeBadgeText: { fontSize: 11, fontFamily: fonts.bold, color: '#2E7D32' },
  closedBadge: { backgroundColor: '#FFF5F5' },
  closedBadgeText: { color: '#E53935' },
  closedBanner: {
    backgroundColor: '#FFF5F5',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FFCDD2',
    padding: 12,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closedBannerText: { fontSize: 13, fontFamily: fonts.bold, color: '#C62828' },
  closedBannerAction: { fontSize: 13, fontFamily: fonts.extrabold, color: colors.primary },

  sectionTitle: {
    fontSize: 11,
    fontFamily: fonts.bold,
    color: '#6B766F',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  statCard: {
    flex: 1,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
  },
  statNum: { fontSize: 20, fontFamily: fonts.display, color: '#151A16' },
  statLabel: { fontFamily: fonts.regular, fontSize: 10, color: '#6B766F', marginTop: 3, textAlign: 'center' },

  // Haftalık grafik
  weekCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E3E6DE',
    padding: 16,
    marginBottom: 20,
  },
  weekHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  weekTitle: { fontSize: 14, fontFamily: fonts.extrabold, color: '#151A16' },
  weekSummary: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  weekStat: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F' },
  weekDot: { fontFamily: fonts.regular, fontSize: 12, color: '#A3ACA5' },
  weekStatBold: { fontSize: 13, fontFamily: fonts.extrabold, color: colors.primary },

  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 110 },
  barWrap: { flex: 1, alignItems: 'center', gap: 4 },
  barCount: { fontSize: 9, color: '#A3ACA5', fontFamily: fonts.semibold, height: 14 },
  barCountActive: { color: colors.primary },
  barContainer: { flex: 1, justifyContent: 'flex-end', width: '100%', alignItems: 'center' },
  bar: {
    width: '70%',
    borderRadius: 5,
    backgroundColor: '#E3E6DE',
  },
  barActive: { backgroundColor: colors.primary },
  barToday: { backgroundColor: '#F5C9BD' },
  barDay: { fontSize: 10, color: '#6B766F', fontFamily: fonts.semibold },
  barDayActive: { color: colors.primary },
  barDayToday: { fontFamily: fonts.extrabold },

  selectedDay: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#EFF2EA',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectedDayLabel: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F', flex: 1 },
  selectedDayRevenue: { fontSize: 15, fontFamily: fonts.extrabold, color: '#151A16' },
  selectedDayOrders: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F' },

  quickRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  quickBtn: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E3E6DE',
    padding: 14,
    alignItems: 'center',
    gap: 6,
  },
  quickEmoji: { fontFamily: fonts.regular, fontSize: 26 },
  quickLabel: { fontSize: 11, fontFamily: fonts.bold, color: '#151A16', textAlign: 'center', lineHeight: 15 },
  quickBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: colors.primary,
    borderRadius: 8,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  quickBadgeText: { fontSize: 10, fontFamily: fonts.extrabold, color: '#fff' },

  toolsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  toolBtn: {
    flexBasis: '30%',
    flexGrow: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E3E6DE',
    padding: 14,
    alignItems: 'center',
    gap: 6,
  },
  toolEmoji: { fontFamily: fonts.regular, fontSize: 24 },
  toolLabel: { fontSize: 11, fontFamily: fonts.bold, color: '#151A16', textAlign: 'center' },

  infoCard: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E3E6DE', padding: 16, marginBottom: 20 },
  infoRow: { flexDirection: 'row', gap: 12 },
  infoBlock: { flex: 1, alignItems: 'center' },
  infoBlockTitle: { fontSize: 10, fontFamily: fonts.bold, color: '#6B766F', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  infoBlockValue: { fontSize: 20, fontFamily: fonts.display, color: colors.primary },
  infoBlockSub: { fontFamily: fonts.regular, fontSize: 11, color: '#6B766F', marginTop: 2, textAlign: 'center' },
  infoSep: { width: 1, backgroundColor: '#E3E6DE' },

  // Top items
  topItemsCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E3E6DE',
    padding: 14,
    marginBottom: 20,
  },
  topItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  topItemBorder: { borderBottomWidth: 1, borderBottomColor: '#EFF2EA' },
  topItemRank: { fontSize: 12, fontFamily: fonts.extrabold, color: '#A3ACA5', width: 22 },
  topItemEmoji: { fontFamily: fonts.regular, fontSize: 20 },
  topItemName: { fontSize: 13, fontFamily: fonts.bold, color: '#151A16' },
  topItemSold: { fontFamily: fonts.regular, fontSize: 11, color: '#6B766F', marginTop: 1 },
  topItemRevenue: { fontSize: 13, fontFamily: fonts.extrabold, color: colors.primary },

  // Customer stats
  customerStatsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  topCustomersCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E3E6DE',
    padding: 14,
    marginBottom: 20,
  },
  topCustomersTitle: { fontSize: 14, fontFamily: fonts.extrabold, color: '#151A16', marginBottom: 12 },
  topCustomerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  topCustomerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topCustomerInitial: { fontSize: 14, fontFamily: fonts.extrabold, color: '#151A16' },
  topCustomerName: { fontSize: 13, fontFamily: fonts.bold, color: '#151A16' },
  topCustomerOrders: { fontFamily: fonts.regular, fontSize: 11, color: '#6B766F', marginTop: 1 },
  topCustomerSpent: { fontSize: 13, fontFamily: fonts.extrabold, color: colors.primary },

  orderRow: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E3E6DE',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  orderCustomer: { fontSize: 13, fontFamily: fonts.bold, color: '#151A16', marginBottom: 2 },
  orderItems: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F', marginBottom: 3 },
  orderTime: { fontFamily: fonts.regular, fontSize: 11, color: '#A3ACA5' },
  orderTotal: { fontSize: 14, fontFamily: fonts.extrabold, color: colors.primary },
  statusBadge: { borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3 },
  statusText: { fontSize: 10, fontFamily: fonts.bold },
});
