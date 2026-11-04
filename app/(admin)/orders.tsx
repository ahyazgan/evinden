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
import { adminMarkRefunded, refundOnlinePayment, reviewRefund } from '@/lib/db';

type OrderStatus = 'awaiting_payment' | 'pending' | 'accepted' | 'preparing' | 'ready' | 'delivered' | 'cancelled';

type AdminOrder = {
  id: string;
  customer_id: string | null;
  seller_id: string;
  status: OrderStatus;
  total_cents: number;
  delivery_address: string | null;
  payment_method: string;
  created_at: string;
  item_count: number;
  refund_status: string | null;
  refund_reason: string | null;
  payment_status: string;
  order_payments?: { last_error: string | null } | null;
};

const STATUS_CONFIG: Record<OrderStatus, { label: string; bg: string; text: string }> = {
  awaiting_payment: { label: 'Ödeme Bekleniyor', bg: '#FFF8E1', text: '#F57F17' },
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
  { key: 'refund', label: 'İade Talepleri' },
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
      const columns = 'id, customer_id, seller_id, status, total_cents, delivery_address, payment_method, created_at, refund_status, refund_reason, payment_status, order_items(id), order_payments(last_error)';
      // İade bekleyenler ne kadar eski olursa olsun listede kalmalı: son 100 siparişle sınırlanmaz.
      const [recent, refunds] = await Promise.all([
        supabase.from('orders').select(columns).order('created_at', { ascending: false }).limit(100),
        supabase.from('orders').select(columns).or('payment_status.eq.refund_pending,refund_status.eq.requested'),
      ]);
      if (!recent.error && recent.data) {
        const byId = new Map<string, any>();
        for (const o of [...recent.data, ...(refunds.data ?? [])] as any[]) byId.set(o.id, o);
        setOrders(
          [...byId.values()]
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map(o => ({ ...o, item_count: o.order_items?.length ?? 0 })),
        );
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
          const { error } = await supabase.from('orders').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', order.id);
          if (error) Alert.alert('Hata', 'Sipariş iptal edilemedi.');
          // Ödenmiş siparişin iptali ödemeyi iade kuyruğuna alır: güncel hali okunur.
          await loadOrders();
        },
      },
    ]);
  };

  const decideRefund = (order: AdminOrder, decision: 'approved' | 'rejected') => {
    Alert.alert(
      decision === 'approved' ? 'İadeyi Onayla' : 'İadeyi Reddet',
      `Sipariş #${order.id.slice(0, 8)} · ${priceTL(order.total_cents)}`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: decision === 'approved' ? 'Onayla' : 'Reddet',
          style: decision === 'approved' ? 'default' : 'destructive',
          onPress: async () => {
            try {
              await reviewRefund(order.id, decision);
              await loadOrders();
            } catch {
              Alert.alert('Hata', 'İade kararı kaydedilemedi.');
            }
          },
        },
      ],
    );
  };

  const confirmMarkRefunded = (order: AdminOrder) => {
    Alert.alert('Emin misiniz?', 'Bu işlem para iadesi yapmaz, yalnızca kaydı günceller. iyzico panelinde iadeyi gördüyseniz onaylayın.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'İşaretle',
        onPress: async () => {
          try {
            await adminMarkRefunded(order.id);
            await loadOrders();
          } catch {
            Alert.alert('Hata', 'Kayıt güncellenemedi.');
          }
        },
      },
    ]);
  };

  const refundMoney = (order: AdminOrder) => {
    Alert.alert('Parayı iade et', `${priceTL(order.total_cents)} müşterinin kartına iade edilecek.`, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'İade Et',
        style: 'destructive',
        onPress: async () => {
          try {
            await refundOnlinePayment(order.id);
            await loadOrders();
          } catch {
            await loadOrders();
            Alert.alert(
              'İade tamamlanamadı',
              'iyzico panelinden kontrol edin. Para iade edildiyse aşağıdaki seçenekle işaretleyin, edilmediyse tekrar deneyin.',
              [
                { text: 'Kapat', style: 'cancel' },
                { text: 'İade edildi olarak işaretle', onPress: () => confirmMarkRefunded(order) },
              ],
            );
          }
        },
      },
    ]);
  };

  const filtered = orders.filter(o => {
    if (filter === 'refund') return o.refund_status === 'requested' || o.payment_status === 'refund_pending';
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
                {order.refund_status === 'requested' && (
                  <View style={st.refundBox}>
                    <Text style={st.refundTitle}>İade talebi</Text>
                    {order.refund_reason ? <Text style={st.refundReason}>{order.refund_reason}</Text> : null}
                    <View style={st.refundActions}>
                      <Pressable style={st.refundReject} onPress={() => decideRefund(order, 'rejected')}>
                        <Text style={st.refundRejectText}>Reddet</Text>
                      </Pressable>
                      <Pressable style={st.refundApprove} onPress={() => decideRefund(order, 'approved')}>
                        <Text style={st.refundApproveText}>Onayla</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
                {(order.refund_status === 'approved' || order.refund_status === 'rejected') && (
                  <Text style={st.refundDecision}>
                    İade {order.refund_status === 'approved' ? 'onaylandı' : 'reddedildi'}
                  </Text>
                )}
                {order.payment_status === 'refund_pending' && (
                  <View style={st.refundBox}>
                    <Text style={st.refundTitle}>Müşteriye para iadesi bekliyor</Text>
                    {order.order_payments?.last_error ? (
                      <Text style={st.refundReason}>{order.order_payments.last_error}</Text>
                    ) : null}
                    <Pressable style={st.refundApprove} onPress={() => refundMoney(order)}>
                      <Text style={st.refundApproveText}>Parayı İade Et</Text>
                    </Pressable>
                  </View>
                )}
                {order.payment_status === 'refunded' && <Text style={st.refundDecision}>Para iade edildi</Text>}
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
  refundBox: { marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: '#FFF8E1', gap: 6 },
  refundTitle: { fontSize: 13, fontWeight: '700', color: '#E65100' },
  refundReason: { fontSize: 13, color: '#1A1208', lineHeight: 18 },
  refundActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  refundReject: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: '#FFEBEE' },
  refundRejectText: { fontSize: 13, fontWeight: '700', color: '#C62828' },
  refundApprove: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: '#E8F5E9' },
  refundApproveText: { fontSize: 13, fontWeight: '700', color: '#2E7D32' },
  refundDecision: { marginTop: 10, fontSize: 12, fontWeight: '700', color: '#6B5E50' },
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
