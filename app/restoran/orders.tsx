import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Linking,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth-context';
import { fetchSellerByUserId, fetchSellerOrderContacts, fetchSellerOrders, openOrderConversation, updateOrderStatus, type OrderWithItems } from '@/lib/db';
import { sharingStatusOf, startSharing, stopSharing, useSharingStatuses, type SharingStatus } from '@/lib/courier-location';
import { useRealtimeOrders } from '@/lib/use-realtime-orders';
import { compareSellerOrders, isPickup, nextOrderLabel, nextOrderStatus, paymentLabel } from '@/lib/order-options';
import { plannedLabel } from '@/lib/schedule-slots';
import { fonts } from '@/lib/fonts';
import { useTheme, type ThemeColors } from '@/lib/theme-context';
import { LogoLoader } from '@/components/shared/Logo';

type OrderStatus = 'pending' | 'accepted' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered' | 'cancelled';

type DemoOrder = {
  id: string;
  status: OrderStatus;
  total_cents: number;
  created_at: string;
  customer_name: string;
  customer_phone: string | null;
  delivery_address: string;
  items: { title: string; quantity: number; price_cents: number }[];
  prepMin?: number;
  fulfillment: string;
  scheduled_for: string | null;
  tip_cents: number;
  payment_method: string;
};

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

/** Gelip almada teslim edilen sipariş "Müşteri aldı" olarak görünür. */
function statusLabel(order: { status: OrderStatus; fulfillment: string }): string {
  return order.status === 'delivered' && isPickup(order) ? 'Müşteri aldı' : STATUS_LABELS[order.status];
}

function priceTL(cents: number): string {
  // Kuruşsuz tutar sade yazılır: ₺260, ₺1.250, ₺45,50
  const [whole, fraction] = (cents / 100).toFixed(2).split('.');
  const lira = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return fraction === '00' ? `₺${lira}` : `₺${lira},${fraction}`;
}
function formatTime(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return 'Az önce';
  if (diffMin < 60) return `${diffMin} dk önce`;
  return `${Math.floor(diffMin / 60)} saat önce`;
}

const ONGOING_STATUSES: OrderStatus[] = ['accepted', 'preparing', 'ready', 'out_for_delivery'];

const FILTER_TABS: { label: string; key: string; statuses: OrderStatus[] }[] = [
  { label: 'Yeni', key: 'new', statuses: ['pending'] },
  { label: 'Devam eden', key: 'preparing', statuses: ONGOING_STATUSES },
  { label: 'Teslim edilen', key: 'delivered', statuses: ['delivered'] },
  { label: 'İptal', key: 'cancelled', statuses: ['cancelled'] },
  { label: 'Tümü', key: 'all', statuses: [] },
];

const PREP_TIMES = [15, 20, 25, 30, 45, 60];

const SHARE_TEXT: Record<SharingStatus['state'], { title: string; body: string }> = {
  idle: { title: 'Konum paylaşılmıyor', body: 'Müşteri kuryeyi haritada göremez.' },
  starting: { title: 'Konum izni isteniyor', body: 'Telefondaki izin penceresine bak.' },
  sharing: { title: 'Konum paylaşılıyor', body: 'Bu ekran açık kalmalı. Uygulamadan çıkarsan ya da telefon kilitlenirse paylaşım durur.' },
  denied: { title: 'Konum izni kapalı', body: 'Müşteri kuryeyi göremez. Telefon ayarlarından konum iznini açıp tekrar dene.' },
  services_off: { title: 'Telefonun konumu kapalı', body: 'Konumu açıp tekrar dene.' },
  failed: { title: 'Konum alınamadı', body: 'Bir süre sonra tekrar dene.' },
};

/** Yoldaki siparişte kuryenin konum paylaşımı. Yalnızca ön planda çalışır. */
function CourierSharePanel({ status, onStart, onStop }: { status: SharingStatus; onStart: () => void; onStop: () => void }) {
  const { colors: t } = useTheme();
  const { state, sendFailed } = status;
  const text = SHARE_TEXT[state];
  const sharing = state === 'sharing';
  return (
    <View style={[styles.sharePanel, { backgroundColor: t.background }]}>
      <View style={styles.shareHead}>
        <Ionicons name={sharing ? 'navigate' : 'navigate-outline'} size={18} color={sharing ? t.success : t.textSecondary} />
        <Text style={[styles.shareTitle, { color: sharing ? t.success : t.text }]} accessibilityLiveRegion="polite">{text.title}</Text>
      </View>
      <Text style={[styles.shareBody, { color: t.textSecondary }]}>
        {state === 'denied' && Platform.OS === 'web' ? 'Müşteri kuryeyi göremez. Tarayıcı ayarlarından konum iznini açıp tekrar dene.' : text.body}
      </Text>
      {sharing && sendFailed ? (
        <Text style={[styles.shareBody, { color: t.danger }]}>Konum gönderilemedi, internet bağlantını kontrol et.</Text>
      ) : null}
      <View style={styles.shareActions}>
        {state === 'denied' && Platform.OS !== 'web' ? (
          <View style={styles.actionFlex}>
            <Button label="Ayarları aç" variant="outline" fullWidth onPress={() => Linking.openSettings()} />
          </View>
        ) : null}
        {sharing ? (
          <View style={styles.actionFlex}>
            <Button label="Paylaşımı durdur" variant="outline" fullWidth onPress={onStop} />
          </View>
        ) : state !== 'starting' ? (
          <View style={styles.actionFlex}>
            <Button label={state === 'idle' ? 'Paylaşımı başlat' : 'Tekrar dene'} variant="outline" fullWidth onPress={onStart} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default function SellerOrdersScreen() {
  const { colors: t } = useTheme();
  const router = useRouter();
  const { profile } = useAuth();
  const [orders, setOrders] = useState<DemoOrder[]>([]);
  const [filterIdx, setFilterIdx] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [prepModalId, setPrepModalId] = useState<string | null>(null);
  const [selectedPrep, setSelectedPrep] = useState(20);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sellerId, setSellerId] = useState<string | null>(null);
  const sharingStatuses = useSharingStatuses();

  // Load orders from Supabase
  const loadOrders = useCallback(async () => {
    if (!profile?.id) { setLoading(false); return; }
    try {
      const seller = await fetchSellerByUserId(profile.id);
      if (seller) {
        setSellerId(seller.id);
        const [dbOrders, contacts] = await Promise.all([
          fetchSellerOrders(seller.id),
          fetchSellerOrderContacts(seller.id).catch(() => []),
        ]);
        const contactMap = new Map(contacts.map(c => [c.order_id, c]));
        setOrders(dbOrders.map(o => ({
          id: o.id,
          status: o.status as OrderStatus,
          total_cents: o.total_cents,
          created_at: o.created_at,
          customer_name: contactMap.get(o.id)?.customer_name ?? 'Müşteri',
          customer_phone: contactMap.get(o.id)?.customer_phone ?? null,
          delivery_address: o.delivery_address ?? '',
          items: o.order_items.map(i => ({
            title: i.title_snapshot,
            quantity: i.quantity,
            price_cents: i.unit_price_cents,
          })),
          fulfillment: o.fulfillment ?? 'delivery',
          scheduled_for: o.scheduled_for ?? null,
          tip_cents: o.tip_cents ?? 0,
          payment_method: o.payment_method ?? 'cash',
        })));
      }
    } catch {
      // Failed to load orders
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  // Real-time order updates
  useRealtimeOrders(sellerId ?? undefined, 'seller', (payload) => {
    if (payload.eventType === 'UPDATE') {
      // Sipariş başka yerden kapandıysa (yönetici, ikinci telefon) konum gönderimi de durur.
      if (payload.new.status !== 'out_for_delivery') stopSharing(payload.new.id, { clearServer: false });
      // Online sipariş ödeme alınınca güncelleme olarak gelir, listede henüz yoktur.
      if (!orders.some(o => o.id === payload.new.id)) {
        loadOrders();
        return;
      }
      setOrders(prev => prev.map(o =>
        o.id === payload.new.id
          ? { ...o, status: payload.new.status as OrderStatus }
          : o
      ));
    } else if (payload.eventType === 'INSERT') {
      // New order received, reload all
      loadOrders();
    }
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadOrders();
    setRefreshing(false);
  }, [loadOrders]);

  const activeFilter = FILTER_TABS[filterIdx];
  const filtered = orders
    .filter(o => activeFilter.statuses.length === 0 || activeFilter.statuses.includes(o.status))
    .sort((a, b) => compareSellerOrders(a, b));

  /** Durumu sunucuya yazar. Reddedilirse ekrandaki iyimser değişikliği geri alıp listeyi yeniler. */
  const syncStatus = async (id: string, status: OrderStatus, previous: OrderStatus): Promise<boolean> => {
    if (!sellerId) return true;
    try {
      await updateOrderStatus(id, status);
      return true;
    } catch {
      setOrders(prev => prev.map(o => (o.id === id ? { ...o, status: previous } : o)));
      await loadOrders();
      Alert.alert('Sipariş güncellenemedi', 'Sipariş başka bir işlemle değişmiş olabilir. Liste yenilendi.');
      return false;
    }
  };

  const advanceStatus = async (id: string) => {
    const order = orders.find(o => o.id === id);
    if (!order) return;
    const next = nextOrderStatus(order) as OrderStatus | null;
    if (!next) return;

    // Optimistic update
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status: next } : o));

    // Sync to Supabase
    // Müşteriye bildirim sunucudan gider (orders_notify).
    const saved = await syncStatus(id, next, order.status);
    if (!saved) return;
    if (next === 'out_for_delivery' && !isPickup(order)) await startSharing(id);
    // Konum satırını teslimde sunucu siler.
    if (order.status === 'out_for_delivery') await stopSharing(id, { clearServer: false });
  };

  const stopCourierSharing = async (id: string) => {
    const cleared = await stopSharing(id);
    if (!cleared) {
      Alert.alert('Son konum silinemedi', 'Paylaşım durdu, ama müşteri son konumu bir süre görebilir. İnternet bağlantını kontrol et.');
    }
  };

  const acceptWithPrepTime = async () => {
    if (!prepModalId) return;
    const previous = orders.find(o => o.id === prepModalId)?.status ?? 'pending';
    // Optimistic update
    setOrders(prev =>
      prev.map(o =>
        o.id === prepModalId ? { ...o, status: 'accepted' as OrderStatus, prepMin: selectedPrep } : o,
      ),
    );

    // Sync to Supabase
    await syncStatus(prepModalId, 'accepted', previous);

    setPrepModalId(null);
    setSelectedPrep(20);
  };

  const cancelOrder = (id: string) => {
    Alert.alert(
      'Siparişi iptal et',
      'Bu siparişi iptal etmek istediğine emin misin?',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'İptal et',
          style: 'destructive',
          onPress: async () => {
            const previous = orders.find(o => o.id === id)?.status ?? 'pending';
            setOrders(prev => prev.map(o => (o.id === id ? { ...o, status: 'cancelled' } : o)));
            await syncStatus(id, 'cancelled', previous);
          },
        },
      ],
    );
  };

  const pendingCount = orders.filter(o => o.status === 'pending').length;
  const preparingCount = orders.filter(o => ONGOING_STATUSES.includes(o.status)).length;
  const subtitle = loading
    ? undefined
    : [pendingCount > 0 ? `${pendingCount} yeni` : null, preparingCount > 0 ? `${preparingCount} devam eden` : null].filter(Boolean).join(' · ') || 'Bekleyen sipariş yok';

  const tabLabel = (key: string, label: string) => {
    const count = key === 'new' ? pendingCount : key === 'preparing' ? preparingCount : 0;
    return count > 0 ? `${label} (${count})` : label;
  };

  const openChat = async (orderId: string) => {
    try {
      const id = await openOrderConversation(orderId);
      router.push(`/chat/${id}` as any);
    } catch (e: any) {
      Alert.alert('Mesaj açılamadı', e?.code === '55000' ? e.message : 'Lütfen tekrar dene.');
    }
  };

  return (
    <View style={[styles.safe, { backgroundColor: t.background }]}>
      <TopBar title="Siparişler" subtitle={subtitle} />

      {/* Filter tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabScroll}
        style={styles.tabRow}
      >
        {FILTER_TABS.map((tab, idx) => {
          const on = filterIdx === idx;
          return (
            <Pressable
              key={tab.key}
              style={[styles.chip, { backgroundColor: on ? t.brand : t.surface }]}
              hitSlop={2}
              onPress={() => setFilterIdx(idx)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.chipText, { color: on ? t.onBrand : t.text }]}>{tabLabel(tab.key, tab.label)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} colors={[t.primary]} />
        }
      >
        {loading ? (
          <View style={styles.empty}>
            <LogoLoader />
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="receipt-outline" size={44} color={t.textMuted} />
            <Text style={[styles.emptyTitle, { color: t.heading }]}>Sipariş yok</Text>
            <Text style={[styles.emptySub, { color: t.textSecondary }]}>
              {activeFilter.key === 'new' ? 'Yeni sipariş gelince burada görünecek.' : 'Bu durumda sipariş bulunmuyor.'}
            </Text>
          </View>
        ) : (
          filtered.map(order => {
            const sc = statusStyle(order.status, t);
            const nextStatus = nextOrderStatus(order);
            const nextLabel = nextOrderLabel(order);
            const pickup = isPickup(order);
            const isExpanded = expandedId === order.id;
            const itemsText = order.items.map(i => `${i.quantity}× ${i.title}`).join(' · ');

            return (
              <View key={order.id} style={[styles.orderCard, { backgroundColor: t.surface }]}>
                {/* Top */}
                <Pressable
                  onPress={() => setExpandedId(isExpanded ? null : order.id)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isExpanded }}
                  accessibilityLabel={`${order.customer_name}, ${priceTL(order.total_cents)}, ${statusLabel(order)}${pickup ? ', gelip alacak' : ''}${order.scheduled_for ? `, ${plannedLabel(order.scheduled_for)}` : ''}. ${isExpanded ? 'Ayrıntıları gizle' : 'Ayrıntıları göster'}`}
                >
                  <View style={styles.orderTop}>
                    <Text style={[styles.customerName, { color: t.text }]} numberOfLines={1}>{order.customer_name}</Text>
                    <Text style={[styles.orderTotal, { color: t.text }]}>{priceTL(order.total_cents)}</Text>
                  </View>

                  {/* Item preview */}
                  <Text style={[styles.itemPreview, { color: t.textSecondary }]} numberOfLines={isExpanded ? undefined : 1}>{itemsText}</Text>

                  <Text style={[styles.deliveryAddr, { color: t.text }]}>{order.delivery_address || 'Adres bilgisi silindi'}</Text>

                  {order.scheduled_for ? (
                    <View style={[styles.plannedBadge, { backgroundColor: t.brand }]}>
                      <Ionicons name="calendar-outline" size={15} color={t.onBrand} />
                      <Text style={[styles.plannedText, { color: t.onBrand }]}>{plannedLabel(order.scheduled_for)}</Text>
                    </View>
                  ) : null}

                  <View style={styles.metaRow}>
                    <Text style={[styles.orderTime, { color: t.textSecondary }]}>{formatTime(order.created_at)}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
                      <Text style={[styles.statusText, { color: sc.text }]}>{statusLabel(order)}</Text>
                    </View>
                    {pickup ? (
                      <View style={[styles.statusBadge, styles.badgeRow, { backgroundColor: t.background }]}>
                        <Ionicons name="bag-handle-outline" size={13} color={t.text} />
                        <Text style={[styles.statusText, { color: t.text }]}>Gelip alacak</Text>
                      </View>
                    ) : null}
                    {order.prepMin && (order.status === 'accepted' || order.status === 'preparing') ? (
                      <View style={[styles.statusBadge, { backgroundColor: t.background }]}>
                        <Text style={[styles.statusText, { color: t.text }]}>Hazırlık: {order.prepMin} dk</Text>
                      </View>
                    ) : null}
                    <View style={styles.metaEnd}>
                      <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={t.textSecondary} />
                    </View>
                  </View>
                </Pressable>

                {/* Expanded details */}
                {isExpanded ? (
                  <View style={[styles.expandedWrap, { borderTopColor: t.divider }]}>
                    {order.items.map((item, idx) => (
                      <View key={idx} style={styles.itemRow}>
                        <Text style={[styles.itemRowText, { color: t.textSecondary }]}>{item.quantity}× {item.title}</Text>
                        <Text style={[styles.itemRowPrice, { color: t.text }]}>{priceTL(item.price_cents * item.quantity)}</Text>
                      </View>
                    ))}
                    {order.tip_cents > 0 ? (
                      <View style={styles.itemRow}>
                        <Text style={[styles.itemRowText, { color: t.textSecondary }]}>Bahşiş (komisyonsuz, tamamı senin)</Text>
                        <Text style={[styles.itemRowPrice, { color: t.text }]}>{priceTL(order.tip_cents)}</Text>
                      </View>
                    ) : null}
                    <View style={styles.itemRow}>
                      <Text style={[styles.itemRowText, { color: t.textSecondary }]}>Ödeme</Text>
                      <Text style={[styles.itemRowPrice, { color: t.text }]}>{paymentLabel(order.payment_method, order.fulfillment)}</Text>
                    </View>
                  </View>
                ) : null}

                {order.status === 'out_for_delivery' && !pickup ? (
                  <CourierSharePanel
                    status={sharingStatusOf(sharingStatuses, order.id)}
                    onStart={() => { startSharing(order.id); }}
                    onStop={() => stopCourierSharing(order.id)}
                  />
                ) : null}

                {/* Action buttons */}
                <View style={styles.actionRow}>
                  {order.customer_phone ? (
                    <Pressable
                      style={[styles.iconBtn, { backgroundColor: t.background }]}
                      onPress={() => Linking.openURL(`tel:${order.customer_phone}`)}
                      accessibilityRole="button"
                      accessibilityLabel="Müşteriyi ara"
                    >
                      <Ionicons name="call-outline" size={18} color={t.text} />
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={[styles.iconBtn, { backgroundColor: t.background }]}
                    onPress={() => openChat(order.id)}
                    accessibilityRole="button"
                    accessibilityLabel="Mesaj gönder"
                  >
                    <Ionicons name="chatbubble-outline" size={18} color={t.text} />
                  </Pressable>
                  {order.status === 'pending' ? (
                    <View style={styles.actionFlex}>
                      <Button label="İptal" variant="danger" fullWidth onPress={() => cancelOrder(order.id)} />
                    </View>
                  ) : null}
                  {order.status === 'pending' ? (
                    <View style={styles.actionFlex}>
                      <Button
                        label="Kabul et"
                        fullWidth
                        onPress={() => {
                          // Planlı siparişte hazırlık süresi sorulmaz: saat zaten belli.
                          if (order.scheduled_for) { advanceStatus(order.id); return; }
                          setSelectedPrep(20);
                          setPrepModalId(order.id);
                        }}
                      />
                    </View>
                  ) : nextStatus && nextLabel ? (
                    <View style={styles.actionFlex}>
                      <Button label={nextLabel} fullWidth onPress={() => advanceStatus(order.id)} />
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Preparation time picker modal */}
      <Modal visible={!!prepModalId} transparent animationType="fade" onRequestClose={() => setPrepModalId(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setPrepModalId(null)} accessibilityLabel="Kapat">
          <Pressable style={[styles.modalBox, { backgroundColor: t.surface }]} onPress={() => {}}>
            <Text style={[styles.modalTitle, { color: t.heading }]}>Hazırlık süresi</Text>
            <Text style={[styles.modalSubtitle, { color: t.textSecondary }]}>Tahmini hazırlık süresini seç</Text>
            <View style={styles.prepGrid}>
              {PREP_TIMES.map(min => {
                const on = selectedPrep === min;
                return (
                  <Pressable
                    key={min}
                    style={[styles.chip, { backgroundColor: on ? t.brand : t.background }]}
                    hitSlop={2}
                    onPress={() => setSelectedPrep(min)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.chipText, { color: on ? t.onBrand : t.text }]}>{min} dk</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.modalActions}>
              <View style={styles.actionFlex}>
                <Button label="Vazgeç" variant="outline" fullWidth onPress={() => setPrepModalId(null)} />
              </View>
              <View style={styles.actionFlex}>
                <Button label="Kabul et" fullWidth onPress={acceptWithPrepTime} />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  tabRow: { flexGrow: 0 },
  tabScroll: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  chip: { height: 40, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 13, fontFamily: fonts.bold },

  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 10 },

  orderCard: { borderRadius: 16, padding: 12 },
  orderTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  customerName: { flexShrink: 1, fontSize: 15, fontFamily: fonts.bold },
  orderTotal: { fontSize: 15, fontFamily: fonts.extrabold },
  itemPreview: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, marginTop: 3 },
  deliveryAddr: { fontSize: 12, lineHeight: 16, fontFamily: fonts.semibold, marginTop: 6 },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 6 },
  metaEnd: { marginLeft: 'auto' },
  orderTime: { fontSize: 12, fontFamily: fonts.regular },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  plannedBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginTop: 6 },
  plannedText: { fontSize: 13, fontFamily: fonts.bold },
  statusText: { fontSize: 11, fontFamily: fonts.bold },

  expandedWrap: { gap: 5, marginTop: 8, paddingTop: 8, borderTopWidth: 1 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  itemRowText: { flexShrink: 1, fontSize: 13, fontFamily: fonts.regular },
  itemRowPrice: { fontSize: 13, fontFamily: fonts.semibold },

  sharePanel: { borderRadius: 12, padding: 12, marginTop: 10, gap: 6 },
  shareHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shareTitle: { fontSize: 14, fontFamily: fonts.bold },
  shareBody: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular },
  shareActions: { flexDirection: 'row', gap: 8, marginTop: 4 },

  actionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionFlex: { flex: 1, minWidth: 0 },
  iconBtn: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalBox: { borderRadius: 16, padding: 20, width: '100%', maxWidth: 340 },
  modalTitle: { fontSize: 18, lineHeight: 24, fontFamily: fonts.display, textAlign: 'center' },
  modalSubtitle: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, textAlign: 'center', marginTop: 4, marginBottom: 16 },
  prepGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 20 },
  modalActions: { flexDirection: 'row', gap: 8 },

  empty: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 18, fontFamily: fonts.display },
  emptySub: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, textAlign: 'center' },
});
