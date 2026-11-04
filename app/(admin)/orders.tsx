import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { adminMarkRefunded, refundOnlinePayment, reviewRefund } from '@/lib/db';
import { fonts } from '@/lib/fonts';
import { useTheme, type ThemeColors } from '@/lib/theme-context';

type OrderStatus = 'awaiting_payment' | 'pending' | 'accepted' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered' | 'cancelled';

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

const STATUS_CONFIG: Record<OrderStatus, { label: string; tone: 'neutral' | 'success' | 'danger' }> = {
  awaiting_payment: { label: 'Ödeme bekleniyor', tone: 'neutral' },
  pending:    { label: 'Bekliyor',      tone: 'neutral' },
  accepted:   { label: 'Kabul edildi',  tone: 'neutral' },
  preparing:  { label: 'Hazırlanıyor',  tone: 'neutral' },
  ready:      { label: 'Hazır',         tone: 'success' },
  out_for_delivery: { label: 'Yolda',   tone: 'neutral' },
  delivered:  { label: 'Teslim edildi', tone: 'success' },
  cancelled:  { label: 'İptal',         tone: 'danger' },
};

const FILTER_TABS = [
  { key: 'all', label: 'Tümü' },
  { key: 'active', label: 'Aktif' },
  { key: 'delivered', label: 'Teslim' },
  { key: 'cancelled', label: 'İptal' },
  { key: 'refund', label: 'İade talepleri' },
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
  const { colors: t } = useTheme();
  const st = useMemo(() => createStyles(t), [t]);
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
    Alert.alert('Emin misin?', 'Bu işlem para iadesi yapmaz, yalnızca kaydı günceller. iyzico panelinde iadeyi gördüysen onayla.', [
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
              'iyzico panelinden kontrol et. Para iade edildiyse aşağıdaki seçenekle işaretle, edilmediyse tekrar dene.',
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
    if (filter === 'active') return ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery'].includes(o.status);
    if (filter === 'delivered') return o.status === 'delivered';
    if (filter === 'cancelled') return o.status === 'cancelled';
    return true;
  });

  const activeCount = orders.filter(o => ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery'].includes(o.status)).length;

  const toneColor = { neutral: t.text, success: t.success, danger: t.danger };

  return (
    <View style={st.safe}>
      <TopBar title="Sipariş izleme" subtitle={loading ? undefined : `${orders.length} sipariş · ${activeCount} aktif`} />

      {loading ? (
        <View style={st.loading}><ActivityIndicator size="large" color={t.primary} /></View>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.filterRow} style={{ flexGrow: 0 }}>
            {FILTER_TABS.map(tab => (
              <Pressable
                key={tab.key}
                style={[st.filterPill, filter === tab.key && st.filterPillActive]}
                onPress={() => setFilter(tab.key)}
                hitSlop={{ top: 2, bottom: 2 }}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === tab.key }}
              >
                <Text style={[st.filterText, filter === tab.key && st.filterTextActive]}>{tab.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <ScrollView
            contentContainerStyle={st.list}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
          >
            {filtered.length === 0 ? (
              <View style={st.empty}>
                <Ionicons name="receipt-outline" size={48} color={t.textMuted} />
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
                      <View style={st.statusBadge}>
                        <Text style={[st.statusText, { color: toneColor[sc.tone] }]}>{sc.label}</Text>
                      </View>
                    </View>
                    <View style={st.cardBody}>
                      <View style={st.infoRow}>
                        <Text style={st.infoLabel}>{order.item_count} ürün</Text>
                        <Text style={st.infoValue}>{priceTL(order.total_cents)}</Text>
                      </View>
                      {order.delivery_address && (
                        <View style={st.addressRow}>
                          <Ionicons name="location-outline" size={14} color={t.textSecondary} />
                          <Text style={st.address} numberOfLines={1}>{order.delivery_address}</Text>
                        </View>
                      )}
                    </View>
                    {order.refund_status === 'requested' && (
                      <View style={st.refundBox}>
                        <Text style={st.refundTitle}>İade talebi</Text>
                        {order.refund_reason ? <Text style={st.refundReason}>{order.refund_reason}</Text> : null}
                        <View style={st.refundActions}>
                          <View style={st.refundBtn}>
                            <Button label="Reddet" variant="danger" onPress={() => decideRefund(order, 'rejected')} fullWidth />
                          </View>
                          <View style={st.refundBtn}>
                            <Button label="Onayla" onPress={() => decideRefund(order, 'approved')} fullWidth />
                          </View>
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
                        <View style={st.refundActions}>
                          <View style={st.refundBtn}>
                            <Button label="Parayı iade et" onPress={() => refundMoney(order)} fullWidth />
                          </View>
                        </View>
                      </View>
                    )}
                    {order.payment_status === 'refunded' && <Text style={st.refundDecision}>Para iade edildi</Text>}
                    {!['delivered', 'cancelled'].includes(order.status) && (
                      <View style={st.cancelBtn}>
                        <Button label="İptal et" variant="danger" onPress={() => cancelOrder(order)} fullWidth />
                      </View>
                    )}
                  </View>
                );
              })
            )}
            <View style={{ height: 32 }} />
          </ScrollView>
        </>
      )}
    </View>
  );
}

const createStyles = (t: ThemeColors) => StyleSheet.create({
  refundBox: { marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: t.background, gap: 6 },
  refundTitle: { fontSize: 13, fontFamily: fonts.bold, color: t.text },
  refundReason: { fontFamily: fonts.regular, fontSize: 13, color: t.text, lineHeight: 18 },
  refundActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  refundBtn: { flex: 1 },
  refundDecision: { marginTop: 10, fontSize: 12, fontFamily: fonts.bold, color: t.textSecondary },
  safe: { flex: 1, backgroundColor: t.background },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  filterRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  filterPill: { height: 40, paddingHorizontal: 14, borderRadius: 10, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' },
  filterPillActive: { backgroundColor: t.primary },
  filterText: { fontSize: 13, fontFamily: fonts.semibold, color: t.text },
  filterTextActive: { color: t.onBrand },
  list: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyText: { fontSize: 15, fontFamily: fonts.semibold, color: t.textSecondary },
  card: { backgroundColor: t.surface, borderRadius: 16, padding: 14 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  orderId: { fontSize: 15, fontFamily: fonts.bold, color: t.text },
  orderDate: { fontFamily: fonts.regular, fontSize: 12, color: t.textSecondary, marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: t.background },
  statusText: { fontSize: 11, fontFamily: fonts.bold },
  cardBody: { marginTop: 12, gap: 6 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  infoLabel: { fontFamily: fonts.regular, fontSize: 13, color: t.textSecondary },
  infoValue: { fontSize: 16, fontFamily: fonts.extrabold, color: t.text },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  address: { flex: 1, fontFamily: fonts.regular, fontSize: 12, color: t.textSecondary },
  cancelBtn: { marginTop: 12 },
});
