import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

type OrderStatus = 'pending' | 'accepted' | 'preparing' | 'ready' | 'delivered' | 'cancelled';

type AdminOrder = {
  id: string;
  customer_id: string;
  seller_id: string;
  status: OrderStatus;
  total_cents: number;
  delivery_address: string | null;
  payment_method: string;
  created_at: string;
  item_count: number;
};

const STATUS_CONFIG: Record<OrderStatus, { label: string; bg: string; text: string }> = {
  pending:    { label: 'Bekliyor',      bg: '#FFF8E1', text: '#F57F17' },
  accepted:   { label: 'Kabul Edildi',  bg: '#E3F2FD', text: '#1565C0' },
  preparing:  { label: 'Hazırlanıyor',  bg: '#FFF3E0', text: '#E65100' },
  ready:      { label: 'Hazır',         bg: '#E8F5E9', text: '#2E7D32' },
  delivered:  { label: 'Teslim Edildi', bg: '#E8F5E9', text: '#2E7D32' },
  cancelled:  { label: 'İptal',         bg: '#F5F5F5', text: '#9E9E9E' },
};

const FILTER_TABS = [
  { key: 'all', label: 'Tümü' },
  { key: 'active', label: 'Aktif' },
  { key: 'delivered', label: 'Teslim' },
  { key: 'cancelled', label: 'İptal' },
] as const;

function priceTL(cents: number) {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 60) return `${diffMin} dk önce`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} sa önce`;
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function AdminOrdersScreen() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<string>('all');

  const loadOrders = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('id, customer_id, seller_id, status, total_cents, delivery_address, payment_method, created_at, order_items(id)')
        .order('created_at', { ascending: false })
        .limit(100);
      if (!error && data) {
        setOrders(data.map((o: any) => ({
          ...o,
          item_count: o.order_items?.length ?? 0,
        })));
      }
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadOrders();
    setRefreshing(false);
  }, [loadOrders]);

  const cancelOrder = (order: AdminOrder) => {
    Alert.alert('Siparişi İptal Et', `Sipariş #${order.id.slice(0, 8)} iptal edilecek.`, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'İptal Et', style: 'destructive',
        onPress: async () => {
          setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: 'cancelled' as OrderStatus } : o));
          await supabase.from('orders').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', order.id);
        },
      },
    ]);
  };

  const filtered = orders.filter(o => {
    if (filter === 'active') return ['pending', 'accepted', 'preparing', 'ready'].includes(o.status);
    if (filter === 'delivered') return o.status === 'delivered';
    if (filter === 'cancelled') return o.status === 'cancelled';
    return true;
  });

  const activeCount = orders.filter(o => ['pending', 'accepted', 'preparing', 'ready'].includes(o.status)).length;

  if (loading) {
    return (
      <SafeAreaView style={st.safe} edges={['top']}>
        <View style={st.loading}><ActivityIndicator size="large" color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <Text style={st.headerTitle}>Sipariş İzleme</Text>
        <Text style={st.headerSub}>{orders.length} sipariş · {activeCount} aktif</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.filterRow} style={{ flexGrow: 0 }}>
        {FILTER_TABS.map(tab => (
          <Pressable key={tab.key} style={[st.filterPill, filter === tab.key && st.filterPillActive]} onPress={() => setFilter(tab.key)}>
            <Text style={[st.filterText, filter === tab.key && st.filterTextActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={st.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {filtered.length === 0 ? (
          <View style={st.empty}>
            <Ionicons name="receipt-outline" size={48} color="#E8E2DA" />
            <Text style={st.emptyText}>Sipariş bulunamadı</Text>
          </View>
        ) : (
          filtered.map(order => {
            const sc = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.pending;
            return (
              <View key={order.id} style={st.card}>
                <View style={st.cardTop}>
                  <View>
                    <Text style={st.orderId}>#{order.id.slice(0, 8)}</Text>
                    <Text style={st.orderDate}>{formatDate(order.created_at)}</Text>
                  </View>
                  <View style={[st.statusBadge, { backgroundColor: sc.bg }]}>
                    <Text style={[st.statusText, { color: sc.text }]}>{sc.label}</Text>
                  </View>
                </View>
                <View style={st.cardBody}>
                  <View style={st.infoRow}>
                    <Text style={st.infoLabel}>{order.item_count} ürün</Text>
                    <Text style={st.infoValue}>{priceTL(order.total_cents)}</Text>
                  </View>
                  {order.delivery_address && (
                    <Text style={st.address} numberOfLines={1}>📍 {order.delivery_address}</Text>
                  )}
                </View>
                {!['delivered', 'cancelled'].includes(order.status) && (
                  <Pressable style={st.cancelBtn} onPress={() => cancelOrder(order)}>
                    <Text style={st.cancelBtnText}>İptal Et</Text>
                  </Pressable>
                )}
              </View>
            );
          })
        )}
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#EDE8E2' },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#1A1208' },
  headerSub: { fontSize: 12, color: '#A89A8A', marginTop: 2 },
  filterRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  filterPill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F5F0EA', borderWidth: 1, borderColor: '#EDE8E2' },
  filterPillActive: { backgroundColor: '#1A1208', borderColor: '#1A1208' },
  filterText: { fontSize: 13, fontWeight: '600', color: '#6B5E50' },
  filterTextActive: { color: '#fff' },
  list: { padding: 16, gap: 10 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyText: { fontSize: 15, fontWeight: '600', color: '#A89A8A' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#EDE8E2' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  orderId: { fontSize: 15, fontWeight: '700', color: '#1A1208' },
  orderDate: { fontSize: 11, color: '#A89A8A', marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 11, fontWeight: '700' },
  cardBody: { marginTop: 12, gap: 6 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  infoLabel: { fontSize: 13, color: '#6B5E50' },
  infoValue: { fontSize: 16, fontWeight: '800', color: colors.primary },
  address: { fontSize: 12, color: '#A89A8A' },
  cancelBtn: { marginTop: 12, backgroundColor: '#FFEBEE', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  cancelBtnText: { fontSize: 13, fontWeight: '600', color: '#C62828' },
});
