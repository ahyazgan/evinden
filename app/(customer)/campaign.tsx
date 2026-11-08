import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TopBar } from '@/components/shared/TopBar';
import { getAvailableCoupons, formatDiscount, formatExpiry, type Coupon } from '@/lib/coupons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { fonts } from '@/lib/fonts';
import { gridItemWidth, NARROW_PAGE_WIDTH, useResponsive } from '@/lib/responsive';
import { useTheme } from '@/lib/theme-context';

const tl = (cents: number) => `₺${(cents / 100).toFixed(0)}`;

/** "Hoş geldin · Min. ₺100": kuponun başlığı ve alt sınırı */
function couponSummary(coupon: Coupon): string {
  return [
    coupon.title !== coupon.code ? coupon.title : null,
    coupon.minOrderCents > 0 ? `Min. ${tl(coupon.minOrderCents)}` : null,
  ].filter(Boolean).join(' · ');
}

/** Tavanı, kullanım hakkı ve son tarihi. Tavansız ve süresiz kuponlarda o bilgi yazılmaz. */
function couponLimits(coupon: Coupon): string {
  const capped = coupon.type !== 'free_delivery' && coupon.maxDiscountCents > 0 && coupon.maxDiscountCents < Number.MAX_SAFE_INTEGER;
  return [
    capped ? `Maks. ${tl(coupon.maxDiscountCents)}` : null,
    coupon.usageLimit > 0 ? `${coupon.usageLimit}x kullanım` : null,
    coupon.expiresAt.startsWith('2099') ? null : `Son: ${formatExpiry(coupon.expiresAt)}`,
  ].filter(Boolean).join(' · ');
}

export default function CampaignsScreen() {
  const { colors: t } = useTheme();
  const { isDesktop, pageWidth } = useResponsive();
  const insets = useSafeAreaInsets();
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [activeCoupons, setActiveCoupons] = useState<Coupon[]>([]);

  useEffect(() => {
    getAvailableCoupons().then(setActiveCoupons).catch(() => {});
  }, []);

  const handleCopy = async (code: string) => {
    try {
      await Clipboard.setStringAsync(code);
    } catch {
      // Clipboard not available on all platforms
    }
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  // Bu ekran masaüstünde dar sütunda açılır.
  const cardWidth = isDesktop ? gridItemWidth(Math.min(pageWidth, NARROW_PAGE_WIDTH), 2, 12, 16) : undefined;

  return (
    <View style={[st.safe, { backgroundColor: t.background }]}>
      <TopBar back title="Kuponların" subtitle="Kodu kopyala, sepette kullan." />

      <ScrollView
        contentContainerStyle={[st.scroll, isDesktop && st.grid, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {activeCoupons.length === 0 ? (
          <View style={st.empty}>
            <Ionicons name="pricetag-outline" size={44} color={t.textMuted} />
            <Text style={[st.emptyTitle, { color: t.heading }]}>Şu an kupon yok</Text>
            <Text style={[st.emptySub, { color: t.textSecondary }]}>Yeni bir kupon olunca burada görünecek.</Text>
          </View>
        ) : null}

        {activeCoupons.map((coupon, index) => {
          const isCopied = copiedCode === coupon.code;
          const featured = index === 0;
          const summary = couponSummary(coupon);
          const limits = couponLimits(coupon);
          const soft = featured ? t.onBrandSoft : t.textSecondary;
          return (
            <View
              key={coupon.code}
              style={[st.card, { backgroundColor: featured ? t.brand : t.surface }, cardWidth ? { width: cardWidth } : null]}
            >
              <Text style={[st.discount, { color: featured ? t.accent : t.heading }]}>{formatDiscount(coupon)}</Text>
              {summary ? <Text style={[st.line, { color: soft }]}>{summary}</Text> : null}
              {coupon.description ? <Text style={[st.line, { color: soft }]}>{coupon.description}</Text> : null}

              <View style={[st.codeRow, { backgroundColor: featured ? t.panel : t.background }]}>
                <Text style={[st.code, { color: featured ? t.onBrand : t.text }]} numberOfLines={1}>{coupon.code}</Text>
                <Pressable
                  style={[st.copyBtn, { backgroundColor: t.accent }]}
                  onPress={() => handleCopy(coupon.code)}
                  accessibilityRole="button"
                  accessibilityLabel={isCopied ? `${coupon.code} kopyalandı` : `${coupon.code} kodunu kopyala`}
                >
                  {isCopied ? <Ionicons name="checkmark" size={16} color={t.onAccent} /> : null}
                  <Text style={[st.copyText, { color: t.onAccent }]}>{isCopied ? 'Kopyalandı' : 'Kopyala'}</Text>
                </Pressable>
              </View>

              {limits ? <Text style={[st.limits, { color: soft }]}>{limits}</Text> : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1 },

  scroll: { paddingHorizontal: 16, paddingTop: 14, gap: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },

  card: { borderRadius: 16, padding: 16 },
  discount: { fontSize: 24, lineHeight: 30, fontFamily: fonts.display, letterSpacing: -0.4 },
  line: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, marginTop: 2 },

  codeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    marginTop: 12, padding: 4, paddingLeft: 12, borderRadius: 12,
  },
  code: { flex: 1, minWidth: 0, fontSize: 14, fontFamily: fonts.extrabold },
  copyBtn: { minHeight: 44, paddingHorizontal: 14, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  copyText: { fontSize: 13, fontFamily: fonts.extrabold },

  limits: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular, marginTop: 10 },

  empty: { width: '100%', alignItems: 'center', paddingTop: 48, paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 18, fontFamily: fonts.display },
  emptySub: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, textAlign: 'center' },
});
