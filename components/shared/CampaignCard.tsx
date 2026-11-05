import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CouponRow } from '@/lib/db';
import { fonts } from '@/lib/fonts';
import { campaignCountdown } from '@/lib/home-filters';
import { useTheme } from '@/lib/theme-context';

export const CAMPAIGN_CARD_WIDTH = 248;

const lira = (cents: number) => `₺${(cents / 100).toFixed(0)}`;

function headline(c: CouponRow): string {
  if (c.discount_type === 'free_delivery') return 'Ücretsiz teslimat';
  return c.discount_type === 'percent' ? `%${c.discount_value} indirim` : `${lira(c.discount_value)} indirim`;
}

type Props = {
  coupon: CouponRow;
  /** Kampanyanın geçtiği restoran; boşsa tüm restoranlarda geçer */
  sellerName: string | null;
  onPress: () => void;
};

/** Kampanya kartı. Geri sayım yalnızca kampanyanın gerçek bitiş tarihi 24 saatten yakınsa çıkar. */
export function CampaignCard({ coupon, sellerName, onPress }: Props) {
  const { colors: t } = useTheme();
  const [now, setNow] = useState(() => Date.now());
  const countdown = campaignCountdown(coupon.expires_at, now);

  useEffect(() => {
    if (!campaignCountdown(coupon.expires_at, Date.now())) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [coupon.expires_at]);

  const where = sellerName ?? 'Tüm restoranlarda';
  const minimum = coupon.min_order_cents > 0 ? `${lira(coupon.min_order_cents)} ve üzeri` : 'Alt limit yok';

  return (
    <Pressable
      style={({ pressed }) => [s.card, { backgroundColor: t.brand }, pressed && s.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${headline(coupon)}, ${where}, kod ${coupon.code}${countdown ? `, kalan süre ${countdown}` : ''}`}
    >
      <View style={s.top}>
        <Text style={[s.headline, { color: t.accent }]} numberOfLines={1}>{headline(coupon)}</Text>
        {countdown ? (
          <View style={[s.timer, { backgroundColor: t.accent }]}>
            <Ionicons name="time-outline" size={13} color={t.onAccent} />
            <Text style={[s.timerText, { color: t.onAccent }]}>{countdown}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[s.where, { color: t.onBrand }]} numberOfLines={1}>{where}</Text>
      <Text style={[s.min, { color: t.onBrandSoft }]} numberOfLines={1}>{minimum}</Text>
      <View style={[s.code, { backgroundColor: t.panel }]}>
        <Text style={[s.codeText, { color: t.onBrand }]} numberOfLines={1}>{coupon.code}</Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: { width: CAMPAIGN_CARD_WIDTH, borderRadius: 16, padding: 14, gap: 3 },
  pressed: { opacity: 0.85 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 28 },
  headline: { flexShrink: 1, fontSize: 19, lineHeight: 24, fontFamily: fonts.display, letterSpacing: -0.4 },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, height: 24, borderRadius: 8 },
  timerText: { fontSize: 12, fontFamily: fonts.extrabold, fontVariant: ['tabular-nums'] },
  where: { fontSize: 14, fontFamily: fonts.semibold, marginTop: 4 },
  min: { fontSize: 12, fontFamily: fonts.regular },
  code: { alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 10, height: 28, borderRadius: 8, justifyContent: 'center', maxWidth: '100%' },
  codeText: { fontSize: 12, fontFamily: fonts.bold, letterSpacing: 0.4 },
});
