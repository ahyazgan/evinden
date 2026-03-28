import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/constants/theme';

type OrderStatus = 'pending' | 'accepted' | 'preparing' | 'ready' | 'delivered' | 'cancelled';

type DemoOrder = {
  id: string;
  status: OrderStatus;
  total_cents: number;
  created_at: string;
  customer_name: string;
  delivery_address: string;
  items: { title: string; quantity: number; price_cents: number }[];
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

export default function SellerOrdersScreen() {
  const [orders, setOrders] = useState<DemoOrder[]>(INITIAL_ORDERS);
  const [filterIdx, setFilterIdx] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const activeFilter = FILTER_TABS[filterIdx];
  const filtered = orders.filter(o =>
    activeFilter.statuses.length === 0 || activeFilter.statuses.includes(o.status),
  );

  const advanceStatus = (id: string) => {
    setOrders(prev =>
      prev.map(o => {
        if (o.id !== id) return o;
        const next = NEXT_STATUS[o.status];
        return next ? { ...o, status: next } : o;
      }),
    );
  };

  const cancelOrder = (id: string) => {
    setOrders(prev => prev.map(o => (o.id === id ? { ...o, status: 'cancelled' } : o)));
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

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
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
                    {nextStatus && nextLabel ? (
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

  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyEmoji: { fontSize: 52 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#1A1208' },
});
