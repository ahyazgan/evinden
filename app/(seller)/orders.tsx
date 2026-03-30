import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { fetchSellerByUserId, fetchSellerOrders, updateOrderStatus, type OrderWithItems } from '@/lib/db';

type OrderStatus = 'pending' | 'accepted' | 'preparing' | 'ready' | 'delivered' | 'cancelled';

type DemoOrder = {
  id: string;
  status: OrderStatus;
  total_cents: number;
  created_at: string;
  customer_name: string;
  delivery_address: string;
  items: { title: string; quantity: number; price_cents: number }[];
  prepMin?: number;
};

const INITIAL_ORDERS: DemoOrder[] = [
  {
    id: 'o1',
    status: 'pending',
    total_cents: 17500,
    created_at: new Date(Date.now() - 5 * 60000).toISOString(),
    customer_name: 'Mehmet A.',
    delivery_address: 'Moda Cad. 42 D:3, Kadıköy',
    items: [
      { title: 'Kuru Fasulye + Pilav', quantity: 1, price_cents: 8000 },
      { title: 'Mercimek Çorbası', quantity: 2, price_cents: 4500 },
      { title: 'Karışık Salata', quantity: 1, price_cents: 3500 },
    ],
  },
  {
    id: 'o2',
    status: 'preparing',
    total_cents: 9500,
    created_at: new Date(Date.now() - 22 * 60000).toISOString(),
    customer_name: 'Ayşe K.',
    delivery_address: 'Bahariye Cad. 7 D:1, Kadıköy',
    items: [
      { title: 'İzmir Köfte', quantity: 1, price_cents: 9500 },
    ],
  },
  {
    id: 'o3',
    status: 'ready',
    total_cents: 4500,
    created_at: new Date(Date.now() - 45 * 60000).toISOString(),
    customer_name: 'Fatma Y.',
    delivery_address: 'Caferağa Mah. 15/2, Kadıköy',
    items: [
      { title: 'Mercimek Çorbası', quantity: 1, price_cents: 4500 },
    ],
  },
  {
    id: 'o4',
    status: 'delivered',
    total_cents: 21000,
    created_at: new Date(Date.now() - 2 * 3600000).toISOString(),
    customer_name: 'Ali B.',
    delivery_address: 'Moda Cad. 88 D:5, Kadıköy',
    items: [
      { title: 'İzmir Köfte', quantity: 2, price_cents: 9500 },
      { title: 'Karışık Salata', quantity: 1, price_cents: 3500 },
    ],
  },
  {
    id: 'o5',
    status: 'cancelled',
    total_cents: 8000,
    created_at: new Date(Date.now() - 5 * 3600000).toISOString(),
    customer_name: 'Zeynep D.',
    delivery_address: 'Söğütlüçeşme Cad. 4/8, Kadıköy',
    items: [
      { title: 'Kuru Fasulye + Pilav', quantity: 1, price_cents: 8000 },
    ],
  },
];

const STATUS_CONFIG: Record<OrderStatus, { label: string; bg: string; text: string }> = {
  pending:   { label: 'Bekliyor',      bg: '#FFF8E1', text: '#F57F17' },
  accepted:  { label: 'Kabul Edildi',  bg: '#E3F2FD', text: '#1565C0' },
  preparing: { label: 'Hazırlanıyor',  bg: '#FFF3E0', text: '#E65100' },
  ready:     { label: 'Hazır',         bg: '#E8F5E9', text: '#2E7D32' },
  delivered: { label: 'Teslim Edildi', bg: '#E8F5E9', text: '#2E7D32' },
  cancelled: { label: 'İptal',         bg: '#F5F5F5', text: '#9E9E9E' },
};

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  pending:  'accepted',
  accepted: 'preparing',
  preparing: 'ready',
  ready: 'delivered',
};
const NEXT_LABEL: Partial<Record<OrderStatus, string>> = {
  pending:   'Kabul Et',
  accepted:  'Hazırlanıyor',
  preparing: 'Hazır',
  ready:     'Teslim Edildi',
};

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}
function formatTime(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 60) return `${diffMin} dk önce`;
  return `${Math.floor(diffMin / 60)} saat önce`;
}

const FILTER_TABS: { label: string; key: string; statuses: OrderStatus[] }[] = [
  { label: 'Aktif', key: 'active', statuses: ['pending', 'accepted', 'preparing', 'ready'] },
  { label: 'Teslim', key: 'delivered', statuses: ['delivered'] },
  { label: 'İptal', key: 'cancelled', statuses: ['cancelled'] },
  { label: 'Tümü', key: 'all', statuses: [] },
];

const PREP_TIMES = [15, 20, 25, 30, 45, 60];

export default function SellerOrdersScreen() {
  const { profile } = useAuth();
  const [orders, setOrders] = useState<DemoOrder[]>(INITIAL_ORDERS);
  const [filterIdx, setFilterIdx] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [prepModalId, setPrepModalId] = useState<string | null>(null);
  const [selectedPrep, setSelectedPrep] = useState(20);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sellerId, setSellerId] = useState<string | null>(null);

  // Load orders from Supabase
  const loadOrders = useCallback(async () => {
    if (!profile?.id) { setLoading(false); return; }
    try {
      const seller = await fetchSellerByUserId(profile.id);
      if (seller) {
        setSellerId(seller.id);
        const dbOrders = await fetchSellerOrders(seller.id);
        if (dbOrders.length > 0) {
          setOrders(dbOrders.map(o => ({
            id: o.id,
            status: o.status as OrderStatus,
            total_cents: o.total_cents,
            created_at: o.created_at,
            customer_name: 'Müşteri',
            delivery_address: o.delivery_address ?? '',
            items: o.order_items.map(i => ({
              title: i.title_snapshot,
              quantity: i.quantity,
              price_cents: i.unit_price_cents,
            })),
          })));
        }
      }
    } catch {
      // Keep demo orders as fallback
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadOrders();
    setRefreshing(false);
  }, [loadOrders]);

  const activeFilter = FILTER_TABS[filterIdx];
  const filtered = orders.filter(o =>
    activeFilter.statuses.length === 0 || activeFilter.statuses.includes(o.status),
  );

  const advanceStatus = async (id: string) => {
    const order = orders.find(o => o.id === id);
    if (!order) return;
    const next = NEXT_STATUS[order.status];
    if (!next) return;

    // Optimistic update
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status: next } : o));

    // Sync to Supabase
    if (sellerId) {
      try { await updateOrderStatus(id, next); } catch {}
    }
  };

  const acceptWithPrepTime = async () => {
    if (!prepModalId) return;
    // Optimistic update
    setOrders(prev =>
      prev.map(o =>
        o.id === prepModalId ? { ...o, status: 'accepted' as OrderStatus, prepMin: selectedPrep } : o,
      ),
    );

    // Sync to Supabase
    if (sellerId) {
      try { await updateOrderStatus(prepModalId, 'accepted'); } catch {}
    }

    setPrepModalId(null);
    setSelectedPrep(20);
  };

  const cancelOrder = (id: string) => {
    Alert.alert(
      'Siparişi İptal Et',
      'Bu siparişi iptal etmek istediğinize emin misiniz?',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'İptal Et',
          style: 'destructive',
          onPress: async () => {
            setOrders(prev => prev.map(o => (o.id === id ? { ...o, status: 'cancelled' } : o)));
            if (sellerId) {
              try { await updateOrderStatus(id, 'cancelled'); } catch {}
            }
          },
        },
      ],
    );
  };

  const pendingCount = orders.filter(o => o.status === 'pending').length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Siparişler</Text>
        {pendingCount > 0 ? (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingBadgeText}>{pendingCount} yeni</Text>
          </View>
        ) : null}
      </View>

      {/* Filter tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabScroll}
        style={styles.tabRow}
      >
        {FILTER_TABS.map((tab, idx) => (
          <Pressable
            key={tab.key}
            style={[styles.tabPill, filterIdx === idx && styles.tabPillActive]}
            onPress={() => setFilterIdx(idx)}
          >
            <Text style={[styles.tabText, filterIdx === idx && styles.tabTextActive]}>
              {tab.label}
              {tab.key === 'active' && pendingCount > 0 ? ` (${pendingCount})` : ''}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📭</Text>
            <Text style={styles.emptyTitle}>Sipariş yok</Text>
          </View>
        ) : (
          filtered.map(order => {
            const sc = STATUS_CONFIG[order.status];
            const nextStatus = NEXT_STATUS[order.status];
            const nextLabel = NEXT_LABEL[order.status];
            const isExpanded = expandedId === order.id;

            return (
              <View key={order.id} style={styles.orderCard}>
                {/* Top */}
                <Pressable style={styles.orderTop} onPress={() => setExpandedId(isExpanded ? null : order.id)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.customerName}>{order.customer_name}</Text>
                    <Text style={styles.orderTime}>{formatTime(order.created_at)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 5 }}>
                    <Text style={styles.orderTotal}>{priceTL(order.total_cents)}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
                      <Text style={[styles.statusText, { color: sc.text }]}>{sc.label}</Text>
                    </View>
                  </View>
                </Pressable>

                {/* Item preview */}
                <Text style={styles.itemPreview} numberOfLines={isExpanded ? undefined : 1}>
                  {order.items.map(i => `${i.quantity}× ${i.title}`).join(' · ')}
                </Text>

                {/* Expanded details */}
                {isExpanded ? (
                  <View style={styles.expandedWrap}>
                    <View style={styles.divider} />
                    {order.items.map((item, idx) => (
                      <View key={idx} style={styles.itemRow}>
                        <Text style={styles.itemRowText}>{item.quantity}× {item.title}</Text>
                        <Text style={styles.itemRowPrice}>{priceTL(item.price_cents * item.quantity)}</Text>
                      </View>
                    ))}
                    <Text style={styles.deliveryAddr}>📍 {order.delivery_address}</Text>
                  </View>
                ) : null}

                {/* Prep time badge */}
                {order.prepMin && (order.status === 'accepted' || order.status === 'preparing') ? (
                  <View style={styles.prepBadge}>
                    <Text style={styles.prepBadgeText}>⏱ Hazırlık: {order.prepMin} dk</Text>
                  </View>
                ) : null}

                {/* Action buttons */}
                {(nextStatus || order.status === 'pending') ? (
                  <View style={styles.actionRow}>
                    {order.status === 'pending' ? (
                      <Pressable
                        style={styles.cancelBtn}
                        onPress={() => cancelOrder(order.id)}
                      >
                        <Text style={styles.cancelBtnText}>İptal Et</Text>
                      </Pressable>
                    ) : null}
                    {order.status === 'pending' ? (
                      <Pressable
                        style={styles.nextBtn}
                        onPress={() => { setSelectedPrep(20); setPrepModalId(order.id); }}
                      >
                        <Text style={styles.nextBtnText}>Kabul Et →</Text>
                      </Pressable>
                    ) : nextStatus && nextLabel ? (
                      <Pressable
                        style={styles.nextBtn}
                        onPress={() => advanceStatus(order.id)}
                      >
                        <Text style={styles.nextBtnText}>{nextLabel} →</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Preparation time picker modal */}
      <Modal visible={!!prepModalId} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setPrepModalId(null)}>
          <Pressable style={styles.modalBox} onPress={() => {}}>
            <Text style={styles.modalTitle}>Hazırlık Süresi</Text>
            <Text style={styles.modalSubtitle}>Tahmini hazırlık süresini seçin</Text>
            <View style={styles.prepGrid}>
              {PREP_TIMES.map(min => (
                <Pressable
                  key={min}
                  style={[styles.prepPill, selectedPrep === min && styles.prepPillActive]}
                  onPress={() => setSelectedPrep(min)}
                >
                  <Text style={[styles.prepPillText, selectedPrep === min && styles.prepPillTextActive]}>
                    {min} dk
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelBtn} onPress={() => setPrepModalId(null)}>
                <Text style={styles.modalCancelText}>Vazgeç</Text>
              </Pressable>
              <Pressable style={styles.modalAcceptBtn} onPress={acceptWithPrepTime}>
                <Text style={styles.modalAcceptText}>Kabul Et</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EDE8E2',
  },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#1A1208', fontFamily: 'serif' },
  pendingBadge: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pendingBadgeText: { fontSize: 12, fontWeight: '700', color: '#fff' },

  tabRow: { flexGrow: 0 },
  tabScroll: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  tabPill: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#EDE8E2',
  },
  tabPillActive: { backgroundColor: '#1A1208', borderColor: '#1A1208' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#A89A8A' },
  tabTextActive: { color: '#fff' },

  list: { padding: 16, paddingBottom: 40, gap: 10 },

  orderCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    padding: 14,
    gap: 8,
  },
  orderTop: { flexDirection: 'row', alignItems: 'flex-start' },
  customerName: { fontSize: 14, fontWeight: '800', color: '#1A1208', marginBottom: 2 },
  orderTime: { fontSize: 11, color: '#A89A8A' },
  orderTotal: { fontSize: 15, fontWeight: '800', color: colors.primary },
  statusBadge: { borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 10, fontWeight: '700' },

  itemPreview: { fontSize: 12, color: '#A89A8A' },

  expandedWrap: { gap: 5 },
  divider: { height: 1, backgroundColor: '#EDE8E2' },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between' },
  itemRowText: { fontSize: 13, color: '#6B5E50' },
  itemRowPrice: { fontSize: 13, fontWeight: '600', color: '#1A1208' },
  deliveryAddr: { fontSize: 11, color: '#A89A8A', marginTop: 4 },

  actionRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#FFCDD2',
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
    backgroundColor: '#FFF5F5',
  },
  cancelBtnText: { fontSize: 13, fontWeight: '700', color: '#E53935' },
  nextBtn: {
    flex: 2,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  nextBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },

  prepBadge: {
    backgroundColor: '#E3F2FD',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  prepBadgeText: { fontSize: 12, fontWeight: '700', color: '#1565C0' },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalBox: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 340,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#1A1208', textAlign: 'center' },
  modalSubtitle: { fontSize: 13, color: '#A89A8A', textAlign: 'center', marginTop: 4, marginBottom: 16 },
  prepGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    marginBottom: 20,
  },
  prepPill: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#FAF7F2',
    borderWidth: 1,
    borderColor: '#EDE8E2',
  },
  prepPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  prepPillText: { fontSize: 14, fontWeight: '700', color: '#6B5E50' },
  prepPillTextActive: { color: '#fff' },
  modalActions: { flexDirection: 'row', gap: 10 },
  modalCancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalCancelText: { fontSize: 14, fontWeight: '700', color: '#6B5E50' },
  modalAcceptBtn: {
    flex: 2,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalAcceptText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyEmoji: { fontSize: 52 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#1A1208' },
});
