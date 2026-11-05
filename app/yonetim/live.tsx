import { useCallback, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { TopBar, TopIconButton } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { adminFetchLiveOrders, type LiveOrderRow } from '@/lib/db';
import { fonts } from '@/lib/fonts';
import { LIVE_STATUS_LABELS, sortLiveOrders, stuckInfo } from '@/lib/live-orders';
import { isPickup, paymentLabel } from '@/lib/order-options';
import { plannedLabel } from '@/lib/schedule-slots';
import { useTheme } from '@/lib/theme-context';
import { LogoLoader } from '@/components/shared/Logo';

const REFRESH_MS = 30_000;

function priceTL(cents: number) {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

export default function AdminLiveOrdersScreen() {
  const { colors: t } = useTheme();
  const router = useRouter();
  const [orders, setOrders] = useState<LiveOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const hasData = useRef(false);

  const load = useCallback(async () => {
    try {
      const rows = await adminFetchLiveOrders();
      setOrders(sortLiveOrders(rows));
      setUpdatedAt(new Date());
      setFailed(false);
      hasData.current = true;
    } catch {
      // Eski liste ekranda kalır, üstteki uyarı güncel olmadığını söyler.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Yalnızca ekran açıkken yenilenir.
  useFocusEffect(useCallback(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]));

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const stuckCount = orders.filter(o => stuckInfo(o)).length;
  const subtitle = loading
    ? undefined
    : `${orders.length} aktif · ${stuckCount} takılı${updatedAt ? ` · ${updatedAt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}` : ''}`;

  return (
    <View style={[s.safe, { backgroundColor: t.background }]}>
      <TopBar
        title="Canlı siparişler"
        subtitle={subtitle}
        back
        right={<TopIconButton icon="refresh" label="Yenile" onPress={refresh} />}
      />

      {loading ? (
        <View style={s.center}><LogoLoader /></View>
      ) : failed && !hasData.current ? (
        <View style={s.center}>
          <Text style={[s.emptyText, { color: t.textSecondary }]}>Siparişler açılamadı.</Text>
          <Button label="Tekrar dene" onPress={refresh} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.primary} />}
        >
          {failed ? <Text style={[s.stale, { color: t.danger }]}>Yenilenemedi, liste güncel olmayabilir.</Text> : null}
          {orders.length === 0 ? (
            <View style={s.empty}>
              <Ionicons name="checkmark-circle-outline" size={44} color={t.textMuted} />
              <Text style={[s.emptyText, { color: t.textSecondary }]}>Şu an aktif sipariş yok.</Text>
            </View>
          ) : (
            orders.map(order => {
              const stuck = stuckInfo(order);
              const status = LIVE_STATUS_LABELS[order.status] ?? order.status;
              return (
                <Pressable
                  key={order.order_id}
                  style={[s.card, { backgroundColor: t.surface }]}
                  onPress={() => router.push('/yonetim/orders' as any)}
                  accessibilityRole="link"
                  accessibilityLabel={`${order.restaurant_name}, ${status}, ${priceTL(order.total_cents)}${stuck ? `. Takılı: ${stuck.reason}` : ''}. Siparişlerde aç`}
                >
                  <View style={s.head}>
                    <Text style={[s.name, { color: t.text }]} numberOfLines={1}>{order.restaurant_name}</Text>
                    <Text style={[s.total, { color: t.text }]}>{priceTL(order.total_cents)}</Text>
                  </View>
                  <Text style={[s.meta, { color: t.textSecondary }]}>
                    #{order.order_id.slice(0, 8).toUpperCase()} · {status} · {order.minutes_in_status} dk
                  </Text>
                  <Text style={[s.meta, { color: t.textSecondary }]}>
                    {paymentLabel(order.payment_method, order.fulfillment)}{isPickup(order) ? ' · Gelip alacak' : ''}
                  </Text>
                  {order.scheduled_for ? (
                    <Text style={[s.meta, { color: t.textSecondary }]}>{plannedLabel(order.scheduled_for)}</Text>
                  ) : null}
                  {stuck ? (
                    <View style={s.stuck}>
                      <Ionicons name="alert-circle-outline" size={16} color={t.danger} />
                      <Text style={[s.stuckText, { color: t.danger }]}>{stuck.reason}</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  empty: { alignItems: 'center', gap: 10, paddingTop: 60 },
  emptyText: { fontSize: 14, fontFamily: fonts.regular, textAlign: 'center' },
  stale: { fontSize: 13, fontFamily: fonts.semibold },
  list: { padding: 16, gap: 10 },
  card: { borderRadius: 16, padding: 14, gap: 4, minHeight: 44 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  name: { flex: 1, minWidth: 0, fontSize: 15, fontFamily: fonts.bold },
  total: { fontSize: 15, fontFamily: fonts.extrabold },
  meta: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular },
  stuck: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 4 },
  stuckText: { flex: 1, fontSize: 13, lineHeight: 18, fontFamily: fonts.bold },
});
