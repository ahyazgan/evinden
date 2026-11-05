import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform, StyleSheet, Text, Vibration, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth-context';
import { istanbulClock, isOpenAt } from '@/lib/date';
import { fetchSellerAlarmData, fetchSellerByUserId } from '@/lib/db';
import { fonts } from '@/lib/fonts';
import {
  ALARM_POLL_MS,
  ALARM_REPEAT_MS,
  alarmLabel,
  muteCurrent,
  ordersNeedingReply,
  pruneMuted,
  sameIds,
  shouldSound,
} from '@/lib/order-alarm';
import { playAlarmSound, releaseAlarmSound, stopAlarmSound } from '@/lib/order-alarm-sound';
import { useOrderSoundEnabled } from '@/lib/order-sound-setting';
import { useResponsive } from '@/lib/responsive';
import { useRealtimeOrders } from '@/lib/use-realtime-orders';
import { useTheme } from '@/lib/theme-context';

const VIBRATION_PATTERN = [0, 400, 200, 400];

/** Yanıt bekleyen siparişleri izler: canlı bağlantı, 20 saniyelik yoklama ve uygulamaya dönüş. */
function useOrdersNeedingReply(userId: string | null): string[] {
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const sellerIdRef = useRef<string | null>(null);
  const lastRequest = useRef(0);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const request = ++lastRequest.current;
    try {
      // Mağazasını sonradan oluşturan satıcı için boşsa yeniden aranır.
      if (!sellerIdRef.current) {
        sellerIdRef.current = (await fetchSellerByUserId(userId))?.id ?? null;
        setSellerId(sellerIdRef.current);
      }
      if (!sellerIdRef.current) return;
      const { orders, hours, hoursKnown } = await fetchSellerAlarmData(sellerIdRef.current);
      if (request !== lastRequest.current) return; // Daha yeni bir sorgu çalışıyor.
      // Saatler okunamazsa açık sayılır: gereksiz çalmak, siparişi kaçırmaktan iyidir.
      const openNow = !hoursKnown || isOpenAt(hours, istanbulClock());
      const next = ordersNeedingReply(orders, openNow).map(order => order.id);
      setIds(prev => (sameIds(prev, next) ? prev : next));
    } catch {
      // Bağlantı yoksa son bilinen durum kalır: alarm kendiliğinden susmaz, bir sonraki yoklama düzeltir.
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      sellerIdRef.current = null;
      setSellerId(null);
      setIds([]);
      return;
    }
    refresh();
    const timer = setInterval(refresh, ALARM_POLL_MS);
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => {
      clearInterval(timer);
      appState.remove();
      lastRequest.current++;
    };
  }, [userId, refresh]);

  useRealtimeOrders(sellerId ?? undefined, 'seller', () => { refresh(); });

  return ids;
}

/** Sesi tekrar tekrar çalar, telefonda titretir. Web'de tarayıcı engellerse bunu bildirir. */
function useAlarmSound(sounding: boolean) {
  const [blocked, setBlocked] = useState(false);

  const play = useCallback(async () => {
    const result = await playAlarmSound();
    setBlocked(result === 'blocked');
  }, []);

  useEffect(() => {
    if (!sounding) return;
    const tick = () => {
      if (Platform.OS !== 'web') {
        if (AppState.currentState !== 'active') return;
        Vibration.vibrate(VIBRATION_PATTERN);
      }
      play();
    };
    tick();
    const timer = setInterval(tick, ALARM_REPEAT_MS);
    return () => {
      clearInterval(timer);
      stopAlarmSound();
      if (Platform.OS !== 'web') Vibration.cancel();
      setBlocked(false);
    };
  }, [sounding, play]);

  useEffect(() => releaseAlarmSound, []);

  return { blocked, retry: play };
}

/**
 * Satıcı sekmelerinin hepsini sarar: sipariş bekliyorsa üstte uyarı gösterir ve ses çalar.
 * Yalnızca satıcı hesabında çalışır; mağaza kaydı yoksa hiçbir şey yapmaz.
 */
export function NewOrderAlarm({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const { colors: t } = useTheme();
  const { isDesktop } = useResponsive();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [soundEnabled] = useOrderSoundEnabled();
  const [mutedIds, setMutedIds] = useState<string[]>([]);

  const ids = useOrdersNeedingReply(profile?.role === 'seller' ? profile.id : null);
  const sounding = shouldSound(ids, mutedIds, soundEnabled);
  const { blocked, retry } = useAlarmSound(sounding);

  useEffect(() => {
    setMutedIds(prev => {
      const next = pruneMuted(prev, ids);
      return next.length === prev.length ? prev : next;
    });
  }, [ids]);

  const visible = ids.length > 0;

  // Üstteki uyarı güvenli alanı kendisi karşılar, altındaki TopBar ikinci kez boşluk bırakmasın.
  const childInsets = useMemo(() => (visible ? { ...insets, top: 0 } : insets), [visible, insets]);

  return (
    <View style={s.root}>
      {visible ? (
        <View style={{ backgroundColor: t.brand, paddingTop: insets.top }}>
          <View style={[s.banner, isDesktop && s.bannerWide, { backgroundColor: t.accent }]}>
            <View style={s.head}>
              <Ionicons name="notifications" size={20} color={t.onAccent} />
              <Text style={[s.title, { color: t.onAccent }]} accessibilityLiveRegion="assertive" numberOfLines={1}>
                {alarmLabel(ids.length)}
              </Text>
            </View>
            <View style={[s.actions, isDesktop && s.actionsWide]}>
              {sounding ? (
                <View style={!isDesktop && s.action}>
                  {blocked ? (
                    <Button label="Ses için dokun" variant="outline" fullWidth onPress={retry} />
                  ) : (
                    <Button label="Sesi kapat" variant="outline" fullWidth onPress={() => setMutedIds(prev => muteCurrent(ids, prev))} />
                  )}
                </View>
              ) : null}
              <View style={!isDesktop && s.action}>
                <Button label="Siparişleri aç" fullWidth onPress={() => router.push('/restoran/orders' as any)} />
              </View>
            </View>
          </View>
        </View>
      ) : null}
      <SafeAreaInsetsContext.Provider value={childInsets}>
        <View style={s.root}>{children}</View>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  banner: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  bannerWide: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  title: { flexShrink: 1, fontSize: 16, fontFamily: fonts.extrabold },
  actions: { flexDirection: 'row', gap: 8 },
  actionsWide: { flexShrink: 0 },
  action: { flex: 1, minWidth: 0 },
});
