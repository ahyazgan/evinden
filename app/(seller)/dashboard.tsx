import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { DEFAULT_SELLER_TYPE, DELIVERY_CONFIG, SELLER_TYPE_LABELS } from '@/constants/business';
import { Logo } from '@/components/shared/Logo';
import { TopBar } from '@/components/shared/TopBar';
import { useAuth } from '@/lib/auth-context';
import { fetchUnreadCount } from '@/lib/messages';
import { fetchCommissionRates, fetchSellerByUserId, fetchSellerOrderContacts, fetchSellerOrders, updateSeller, type CommissionRates, type OrderWithItems, type SellerRow } from '@/lib/db';
import { fonts } from '@/lib/fonts';
import { plannedLabel } from '@/lib/schedule-slots';
import { useResponsive } from '@/lib/responsive';
import { useTheme, type ThemeColors } from '@/lib/theme-context';

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

const DAY_NAMES = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const TODAY_IDX = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;

type OrderStatus = 'pending' | 'accepted' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered' | 'cancelled';

type RecentOrder = {
  id: string; status: OrderStatus; total_cents: number;
  created_at: string; customer_name: string; items: string;
};

type TopItem = { id: number; title: string; sold: number; revenue: number };

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
    .map(([title, data], i) => ({ id: i + 1, title, sold: data.sold, revenue: data.revenue }));
}

function computeCustomerStats(orders: OrderWithItems[], names: Map<string, string>): CustomerStats {
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
    .map(([id, data]) => {
      const order = orders.find(o => o.customer_id === id);
      return { name: (order && names.get(order.id)) || 'Müşteri', orders: data.orders, spent: data.spent };
    });
  return { totalCustomers, returningCustomers, avgOrderValue, topCustomers };
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending:   'Bekliyor',
  accepted:  'Kabul edildi',
  preparing: 'Hazırlanıyor',
  ready:     'Hazır',
  out_for_delivery: 'Yolda',
  delivered: 'Teslim edildi',
  cancelled: 'İptal',
};

function statusStyle(status: OrderStatus, t: ThemeColors): { bg: string; text: string } {
  switch (status) {
    case 'pending': return { bg: t.accent, text: t.onAccent };
    case 'ready':
    case 'delivered': return { bg: t.background, text: t.success };
    case 'cancelled': return { bg: t.background, text: t.danger };
    default: return { bg: t.background, text: t.text };
  }
}

function formatTime(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return 'Az önce';
  if (diffMin < 60) return `${diffMin} dk önce`;
  return `${Math.floor(diffMin / 60)} sa önce`;
}

function customerLabel(o: OrderWithItems, names: Map<string, string>): string {
  return names.get(o.id) || (o.customer_id ? 'Müşteri' : 'Silinmiş kullanıcı');
}

function itemsLabel(o: OrderWithItems): string {
  return o.order_items.map(i => `${i.quantity}× ${i.title_snapshot}`).join(' · ');
}

/** Sunucu cevapsız siparişi 30 dakikada iptal eder: expire_pending_orders(10, 30), migration 029. */
const PENDING_CANCEL_MIN = 30;

function pendingNote(o: OrderWithItems): string {
  // pending_since sütunu select('*') ile gelir, OrderRow tipinde henüz yok.
  const since = (o as OrderWithItems & { pending_since?: string | null }).pending_since ?? o.created_at;
  const left = PENDING_CANCEL_MIN - Math.floor((Date.now() - new Date(since).getTime()) / 60000);
  return `${formatTime(since)} · ${left > 0 ? `Yanıtlamazsan ${left} dk sonra iptal olur` : 'Birazdan iptal olacak'}`;
}

type IconName = keyof typeof Ionicons.glyphMap;

function StatCard({ value, label, highlight }: { value: string | number; label: string; highlight?: boolean }) {
  const { colors: t } = useTheme();
  return (
    <View style={[styles.statCard, { backgroundColor: highlight ? t.accent : t.surface }]}>
      <Text style={[styles.statNum, { color: highlight ? t.onAccent : t.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {value}
      </Text>
      <Text style={[styles.statLabel, { color: highlight ? t.onAccent : t.textSecondary }]}>{label}</Text>
    </View>
  );
}

function CountBadge({ count }: { count: number }) {
  const { colors: t } = useTheme();
  if (count <= 0) return null;
  return (
    <View style={[styles.badge, { backgroundColor: t.primary }]}>
      <Text style={[styles.badgeText, { color: t.onBrand }]}>{count}</Text>
    </View>
  );
}

export default function SellerDashboardScreen() {
  const { colors: t } = useTheme();
  const { isDesktop } = useResponsive();
  const { profile } = useAuth();
  const router = useRouter();
  const [selectedDay, setSelectedDay] = useState(TODAY_IDX);
  const [allOrders, setAllOrders] = useState<OrderWithItems[]>([]);
  const [customerNames, setCustomerNames] = useState<Map<string, string>>(new Map());
  const [seller, setSeller] = useState<SellerRow | null>(null);
  const storeOpen = !seller?.is_paused;
  const setStoreOpen = async (open: boolean) => {
    if (!seller) return;
    try {
      setSeller(await updateSeller(seller.id, { is_paused: !open }));
    } catch {
      Alert.alert('Mağaza güncellenemedi', 'Lütfen tekrar dene.');
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
      const [orders, contacts] = await Promise.all([
        fetchSellerOrders(s.id),
        fetchSellerOrderContacts(s.id).catch(() => []),
      ]);
      const names = new Map<string, string>();
      contacts.forEach(c => { if (c.customer_name) names.set(c.order_id, c.customer_name); });
      setCustomerNames(names);
      setAllOrders(orders);
      setRecentOrders(orders.slice(0, 5).map(o => ({
        id: o.id,
        status: o.status as OrderStatus,
        total_cents: o.total_cents,
        created_at: o.created_at,
        customer_name: customerLabel(o, names),
        items: itemsLabel(o),
      })));
    } catch {}
  }, [profile?.id]);

  useEffect(() => { loadData(); }, [loadData]);

  const WEEKLY = useMemo(() => computeWeekly(allOrders), [allOrders]);
  const TOP_ITEMS = useMemo(() => computeTopItems(allOrders), [allOrders]);
  const CUSTOMER_STATS = useMemo(() => computeCustomerStats(allOrders, customerNames), [allOrders, customerNames]);
  // Son beş siparişle sınırlı değil: bekleyen her sipariş burada görünür.
  const pendingOrders = useMemo(() => allOrders.filter(o => o.status === 'pending'), [allOrders]);

  const today = WEEKLY[TODAY_IDX];
  const pendingCount = pendingOrders.length;
  const weekRevenue = WEEKLY.reduce((s, d) => s + d.revenue, 0);
  const weekOrders = WEEKLY.reduce((s, d) => s + d.orders, 0);

  const maxRevenue = Math.max(1, ...WEEKLY.map(d => d.revenue));

  const storeName = seller?.display_name ?? 'Restoranım';
  const storeLocation = [seller?.district, seller?.city].filter(Boolean).join(', ');

  const toggleStore = () => {
    if (storeOpen) {
      Alert.alert(
        'Mağazayı kapat',
        'Mağazan müşterilere kapalı görünecek. Devam etmek istiyor musun?',
        [
          { text: 'Vazgeç', style: 'cancel' },
          { text: 'Kapat', style: 'destructive', onPress: () => setStoreOpen(false) },
        ],
      );
    } else {
      setStoreOpen(true);
    }
  };

  const goOrders = () => router.push('/(seller)/orders' as any);

  const storeState = seller ? (
    <Pressable
      style={styles.storeToggle}
      onPress={toggleStore}
      accessibilityRole="button"
      accessibilityLabel={storeOpen ? 'Mağaza açık. Kapatmak için dokun.' : 'Mağaza kapalı. Açmak için dokun.'}
    >
      <View style={[styles.storeChip, { backgroundColor: storeOpen ? t.accent : t.panel }]}>
        <Text style={[styles.storeChipText, { color: storeOpen ? t.onAccent : t.onBrand }]}>{storeOpen ? 'Açık' : 'Kapalı'}</Text>
      </View>
    </Pressable>
  ) : null;

  const quickLinks: { icon: IconName; label: string; route: string; badge?: number }[] = [
    { icon: 'restaurant-outline', label: 'Menüyü düzenle', route: '/(seller)/menu' },
    { icon: 'receipt-outline', label: 'Siparişler', route: '/(seller)/orders', badge: pendingCount },
    { icon: 'settings-outline', label: 'Mağaza ayarları', route: '/(seller)/profile' },
  ];

  const tools: { icon: IconName; label: string; route: string; badge?: number }[] = [
    { icon: 'wallet-outline', label: 'Kazancım', route: '/(seller)/earnings' },
    { icon: 'chatbubble-outline', label: 'Mesajlar', route: '/(seller)/messages', badge: unreadMessages },
    { icon: 'trending-up-outline', label: 'Gelir analizi', route: '/(seller)/analytics' },
    { icon: 'notifications-outline', label: 'Bildirimler', route: '/(seller)/notifications' },
    { icon: 'star-outline', label: 'Yorumlar', route: '/(seller)/reviews' },
    { icon: 'pricetag-outline', label: 'Kampanyalar', route: '/(seller)/campaigns' },
    { icon: 'document-text-outline', label: 'Sipariş fişi', route: '/(seller)/receipt' },
    { icon: 'swap-horizontal-outline', label: 'Müşteri modu', route: '/(customer)/profile' },
  ];

  return (
    <View style={[styles.safe, { backgroundColor: t.background }]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <TopBar
          leading={isDesktop ? undefined : <Logo size={26} tone="onBrand" inline />}
          title={isDesktop ? storeName : undefined}
          subtitle={isDesktop ? storeLocation || undefined : undefined}
          right={storeState}
        >
          {isDesktop ? null : (
            <View>
              <Text style={[styles.heroName, { color: t.onBrand }]} numberOfLines={2} accessibilityRole="header">{storeName}</Text>
              {storeLocation ? <Text style={[styles.heroLocation, { color: t.onBrandSoft }]} numberOfLines={1}>{storeLocation}</Text> : null}
            </View>
          )}
        </TopBar>

        <View style={styles.body}>
          {/* Kapalı uyarısı */}
          {seller && !storeOpen ? (
            <Pressable
              style={[styles.closedBanner, { backgroundColor: t.surface }]}
              onPress={() => setStoreOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Mağazan şu an kapalı. Aç."
            >
              <Text style={[styles.closedBannerText, { color: t.danger }]}>Mağazan şu an kapalı</Text>
              <View style={styles.inlineLink}>
                <Text style={[styles.closedBannerAction, { color: t.text }]}>Aç</Text>
                <Ionicons name="arrow-forward" size={16} color={t.text} />
              </View>
            </Pressable>
          ) : null}

          {/* Bugün istatistikleri */}
          <View style={styles.statsRow}>
            <StatCard value={pendingCount} label="Bekleyen" highlight />
            <StatCard value={today.orders} label="Bugünkü sipariş" />
            <StatCard value={priceTL(today.revenue)} label="Bugünkü gelir" />
          </View>

          {/* Yanıt bekleyenler */}
          <View style={styles.sectionHead}>
            <Text style={[styles.sectionTitle, { color: t.heading }]}>Yanıt bekleyenler</Text>
            <Pressable style={styles.allLink} onPress={goOrders} accessibilityRole="link" accessibilityLabel="Tüm siparişler">
              <Text style={[styles.allText, { color: t.textSecondary }]}>Tümü</Text>
            </Pressable>
          </View>
          {pendingOrders.length === 0 ? (
            <View style={[styles.card, { backgroundColor: t.surface }]}>
              <Text style={[styles.emptyLine, { color: t.textSecondary }]}>Şu an yanıt bekleyen sipariş yok.</Text>
            </View>
          ) : (
            <View style={styles.list}>
              {pendingOrders.map(order => (
                <Pressable
                  key={order.id}
                  style={[styles.card, { backgroundColor: t.surface }]}
                  onPress={goOrders}
                  accessibilityRole="button"
                  accessibilityLabel={`${customerLabel(order, customerNames)}, ${priceTL(order.total_cents)}. ${pendingNote(order)}`}
                >
                  <View style={styles.cardTop}>
                    <Text style={[styles.orderCustomer, { color: t.text }]} numberOfLines={1}>{customerLabel(order, customerNames)}</Text>
                    <Text style={[styles.orderTotal, { color: t.text }]}>{priceTL(order.total_cents)}</Text>
                  </View>
                  <Text style={[styles.orderItems, { color: t.textSecondary }]} numberOfLines={2}>{itemsLabel(order)}</Text>
                  {order.scheduled_for ? (
                    <Text style={[styles.orderNote, { color: t.text }]}>{plannedLabel(order.scheduled_for)}</Text>
                  ) : null}
                  <Text style={[styles.orderNote, { color: t.text }]}>{pendingNote(order)}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {/* Haftanın özeti */}
          <View style={[styles.card, styles.weekCard, { backgroundColor: t.surface }]}>
            <View style={styles.weekHeader}>
              <Text style={[styles.weekTitle, { color: t.heading }]}>Bu hafta</Text>
              <View style={styles.weekSummary}>
                <Text style={[styles.weekStat, { color: t.textSecondary }]}>{weekOrders} sipariş</Text>
                <Text style={[styles.weekStat, { color: t.textSecondary }]}>·</Text>
                <Text style={[styles.weekStatBold, { color: t.text }]}>{priceTL(weekRevenue)}</Text>
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
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={`${d.day}: ${d.orders} sipariş, ${priceTL(d.revenue)}`}
                  >
                    <Text style={[styles.barCount, { color: isSelected ? t.text : t.textSecondary }]}>{d.orders}</Text>
                    <View style={styles.barContainer}>
                      <View style={[styles.bar, { height: Math.max(6, ratio * 80), backgroundColor: t.brand, opacity: isSelected ? 1 : 0.3 }]} />
                    </View>
                    <Text
                      style={[
                        styles.barDay,
                        { color: isSelected ? t.text : t.textSecondary },
                        isToday && styles.barDayToday,
                      ]}
                    >
                      {d.day}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Seçili gün detayı */}
            <View style={[styles.selectedDay, { borderTopColor: t.divider }]}>
              <Text style={[styles.selectedDayLabel, { color: t.textSecondary }]}>
                {WEEKLY[selectedDay].day}{selectedDay === TODAY_IDX ? ' (Bugün)' : ''}
              </Text>
              <Text style={[styles.selectedDayRevenue, { color: t.text }]}>{priceTL(WEEKLY[selectedDay].revenue)}</Text>
              <Text style={[styles.selectedDayOrders, { color: t.textSecondary }]}>{WEEKLY[selectedDay].orders} sipariş</Text>
            </View>
          </View>

          {/* En çok satanlar */}
          <View style={styles.sectionHead}>
            <Text style={[styles.sectionTitle, { color: t.heading }]}>En çok satan ürünler</Text>
          </View>
          <View style={[styles.card, { backgroundColor: t.surface }]}>
            {TOP_ITEMS.length === 0 ? (
              <Text style={[styles.emptyLine, { color: t.textSecondary }]}>Henüz satış yok.</Text>
            ) : TOP_ITEMS.map((item, idx) => (
              <View
                key={item.id}
                style={[styles.topRow, idx < TOP_ITEMS.length - 1 && { borderBottomWidth: 1, borderBottomColor: t.divider }]}
              >
                <Text style={[styles.topRank, { color: t.textSecondary }]}>#{idx + 1}</Text>
                <View style={styles.flex}>
                  <Text style={[styles.topName, { color: t.text }]} numberOfLines={1}>{item.title}</Text>
                  <Text style={[styles.topMeta, { color: t.textSecondary }]}>{item.sold} adet satıldı</Text>
                </View>
                <Text style={[styles.topValue, { color: t.text }]}>{priceTL(item.revenue)}</Text>
              </View>
            ))}
          </View>

          {/* Müşteri istatistikleri */}
          <View style={styles.sectionHead}>
            <Text style={[styles.sectionTitle, { color: t.heading }]}>Müşteri istatistikleri</Text>
          </View>
          <View style={styles.statsRow}>
            <StatCard value={CUSTOMER_STATS.totalCustomers} label="Toplam müşteri" />
            <StatCard value={CUSTOMER_STATS.returningCustomers} label="Tekrar gelen" />
            <StatCard value={priceTL(CUSTOMER_STATS.avgOrderValue)} label="Ort. sipariş" />
          </View>

          {/* En sadık müşteriler */}
          <View style={[styles.card, styles.loyalCard, { backgroundColor: t.surface }]}>
            <Text style={[styles.weekTitle, { color: t.heading }]}>En sadık müşteriler</Text>
            {CUSTOMER_STATS.topCustomers.length === 0 ? (
              <Text style={[styles.emptyLine, { color: t.textSecondary }]}>Henüz müşteri yok.</Text>
            ) : CUSTOMER_STATS.topCustomers.map((c, i) => (
              <View key={i} style={styles.topRow}>
                <View style={[styles.avatar, { backgroundColor: t.background }]}>
                  <Text style={[styles.avatarText, { color: t.text }]}>{c.name.charAt(0)}</Text>
                </View>
                <View style={styles.flex}>
                  <Text style={[styles.topName, { color: t.text }]} numberOfLines={1}>{c.name}</Text>
                  <Text style={[styles.topMeta, { color: t.textSecondary }]}>{c.orders} sipariş</Text>
                </View>
                <Text style={[styles.topValue, { color: t.text }]}>{priceTL(c.spent)}</Text>
              </View>
            ))}
          </View>

          {/* Hızlı erişim */}
          <View style={styles.quickRow}>
            {quickLinks.map(link => (
              <Pressable
                key={link.route}
                style={[styles.quickBtn, { backgroundColor: t.surface }]}
                onPress={() => router.push(link.route as any)}
                accessibilityRole="button"
                accessibilityLabel={link.badge ? `${link.label}, ${link.badge} yeni` : link.label}
              >
                <Ionicons name={link.icon} size={22} color={t.text} />
                <Text style={[styles.tileLabel, { color: t.text }]}>{link.label}</Text>
                <CountBadge count={link.badge ?? 0} />
              </Pressable>
            ))}
          </View>

          {/* Yönetim araçları */}
          <View style={styles.sectionHead}>
            <Text style={[styles.sectionTitle, { color: t.heading }]}>Yönetim araçları</Text>
          </View>
          <View style={styles.toolsGrid}>
            {tools.map(tool => (
              <Pressable
                key={tool.route}
                style={[styles.toolBtn, { backgroundColor: t.surface }]}
                onPress={() => router.push(tool.route as any)}
                accessibilityRole="button"
                accessibilityLabel={tool.badge ? `${tool.label}, ${tool.badge} okunmamış` : tool.label}
              >
                <Ionicons name={tool.icon} size={22} color={t.text} />
                <Text style={[styles.tileLabel, { color: t.text }]}>{tool.label}</Text>
                <CountBadge count={tool.badge ?? 0} />
              </Pressable>
            ))}
          </View>

          {/* Komisyon & Teslimat bilgisi */}
          <View style={[styles.card, styles.infoRow, { backgroundColor: t.surface }]}>
            <View style={styles.infoBlock}>
              <Text style={[styles.infoTitle, { color: t.textSecondary }]}>Komisyon oranın</Text>
              <Text style={[styles.infoValue, { color: t.heading }]}>{commissionRates ? `%${commissionRates[seller?.seller_type ?? DEFAULT_SELLER_TYPE]}` : '-'}</Text>
              <Text style={[styles.infoSub, { color: t.textSecondary }]}>{SELLER_TYPE_LABELS[seller?.seller_type ?? DEFAULT_SELLER_TYPE]} · Her siparişten</Text>
            </View>
            <View style={[styles.infoSep, { backgroundColor: t.divider }]} />
            <View style={styles.infoBlock}>
              <Text style={[styles.infoTitle, { color: t.textSecondary }]}>Teslimat modeli</Text>
              <Text style={[styles.infoValue, { color: t.heading }]}>{DELIVERY_CONFIG.label}</Text>
              <Text style={[styles.infoSub, { color: t.textSecondary }]}>Kendi kuryenle teslim</Text>
            </View>
          </View>

          {/* Son siparişler */}
          <View style={styles.sectionHead}>
            <Text style={[styles.sectionTitle, { color: t.heading }]}>Son siparişler</Text>
          </View>
          {recentOrders.length === 0 ? (
            <View style={[styles.card, { backgroundColor: t.surface }]}>
              <Text style={[styles.emptyLine, { color: t.textSecondary }]}>Henüz sipariş yok.</Text>
            </View>
          ) : (
            <View style={styles.list}>
              {recentOrders.map(order => {
                const sc = statusStyle(order.status, t);
                return (
                  <View key={order.id} style={[styles.card, { backgroundColor: t.surface }]}>
                    <View style={styles.cardTop}>
                      <Text style={[styles.orderCustomer, { color: t.text }]} numberOfLines={1}>{order.customer_name}</Text>
                      <Text style={[styles.orderTotal, { color: t.text }]}>{priceTL(order.total_cents)}</Text>
                    </View>
                    <Text style={[styles.orderItems, { color: t.textSecondary }]} numberOfLines={1}>{order.items}</Text>
                    <View style={styles.orderMeta}>
                      <Text style={[styles.orderTime, { color: t.textSecondary }]}>{formatTime(order.created_at)}</Text>
                      <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
                        <Text style={[styles.statusText, { color: sc.text }]}>{STATUS_LABELS[order.status]}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingBottom: 32 },
  body: { paddingHorizontal: 16, paddingTop: 14 },
  flex: { flex: 1, minWidth: 0 },
  list: { gap: 10 },

  heroName: { fontSize: 24, lineHeight: 28, fontFamily: fonts.display, letterSpacing: -0.6 },
  heroLocation: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, marginTop: 2 },
  storeToggle: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  storeChip: { height: 32, paddingHorizontal: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  storeChipText: { fontSize: 13, fontFamily: fonts.extrabold },

  closedBanner: {
    borderRadius: 16,
    paddingHorizontal: 14,
    minHeight: 48,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  closedBannerText: { flexShrink: 1, fontSize: 13, fontFamily: fonts.bold },
  closedBannerAction: { fontSize: 13, fontFamily: fonts.extrabold },
  inlineLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },

  statsRow: { flexDirection: 'row', gap: 8 },
  statCard: { flex: 1, minWidth: 0, borderRadius: 16, padding: 12 },
  statNum: { fontSize: 24, lineHeight: 30, fontFamily: fonts.display, letterSpacing: -0.4 },
  statLabel: { fontSize: 12, lineHeight: 16, fontFamily: fonts.regular, marginTop: 2 },

  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, marginTop: 8, marginBottom: 2 },
  sectionTitle: { fontSize: 19, lineHeight: 24, fontFamily: fonts.display, letterSpacing: -0.3 },
  allLink: { minHeight: 44, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' },
  allText: { fontSize: 13, fontFamily: fonts.semibold },
  emptyLine: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular },

  card: { borderRadius: 16, padding: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  orderCustomer: { flexShrink: 1, fontSize: 15, fontFamily: fonts.bold },
  orderTotal: { fontSize: 15, fontFamily: fonts.extrabold },
  orderItems: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, marginTop: 3 },
  orderNote: { fontSize: 12, lineHeight: 16, fontFamily: fonts.semibold, marginTop: 6 },
  orderMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6 },
  orderTime: { fontSize: 12, fontFamily: fonts.regular },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 11, fontFamily: fonts.bold },

  // Haftalık grafik
  weekCard: { marginTop: 18, padding: 14 },
  weekHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  weekTitle: { fontSize: 16, fontFamily: fonts.display, letterSpacing: -0.2 },
  weekSummary: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  weekStat: { fontSize: 12, fontFamily: fonts.regular },
  weekStatBold: { fontSize: 13, fontFamily: fonts.extrabold },
  chart: { flexDirection: 'row', alignItems: 'stretch', gap: 4, height: 128 },
  barWrap: { flex: 1, alignItems: 'center', gap: 4 },
  barCount: { fontSize: 11, lineHeight: 14, fontFamily: fonts.semibold },
  barContainer: { flex: 1, justifyContent: 'flex-end', width: '100%', alignItems: 'center' },
  bar: { width: '70%', borderRadius: 5 },
  barDay: { fontSize: 11, lineHeight: 14, fontFamily: fonts.semibold },
  barDayToday: { fontFamily: fonts.extrabold },
  selectedDay: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectedDayLabel: { flex: 1, fontSize: 12, fontFamily: fonts.regular },
  selectedDayRevenue: { fontSize: 15, fontFamily: fonts.extrabold },
  selectedDayOrders: { fontSize: 12, fontFamily: fonts.regular },

  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  topRank: { width: 24, fontSize: 12, fontFamily: fonts.extrabold },
  topName: { fontSize: 13, fontFamily: fonts.bold },
  topMeta: { fontSize: 12, fontFamily: fonts.regular, marginTop: 1 },
  topValue: { fontSize: 13, fontFamily: fonts.extrabold },

  loyalCard: { marginTop: 10, padding: 14 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontFamily: fonts.extrabold },

  quickRow: { flexDirection: 'row', gap: 8, marginTop: 18 },
  quickBtn: { flex: 1, minWidth: 0, minHeight: 84, borderRadius: 16, padding: 12, alignItems: 'center', justifyContent: 'center', gap: 6 },
  toolsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  toolBtn: { flexBasis: '30%', flexGrow: 1, minHeight: 84, borderRadius: 16, padding: 12, alignItems: 'center', justifyContent: 'center', gap: 6 },
  tileLabel: { fontSize: 12, lineHeight: 16, fontFamily: fonts.bold, textAlign: 'center' },
  badge: { position: 'absolute', top: 8, right: 8, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 11, fontFamily: fonts.extrabold },

  infoRow: { flexDirection: 'row', gap: 12, marginTop: 18, padding: 14 },
  infoBlock: { flex: 1, minWidth: 0, alignItems: 'center' },
  infoTitle: { fontSize: 12, fontFamily: fonts.semibold, marginBottom: 4, textAlign: 'center' },
  infoValue: { fontSize: 20, lineHeight: 26, fontFamily: fonts.display, textAlign: 'center' },
  infoSub: { fontSize: 12, lineHeight: 16, fontFamily: fonts.regular, marginTop: 2, textAlign: 'center' },
  infoSep: { width: 1 },
});
