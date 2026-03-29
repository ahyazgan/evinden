import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants/theme';
import { COUPONS, formatDiscount, formatExpiry } from '@/lib/coupons';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';

export default function CampaignsScreen() {
  const router = useRouter();
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const handleCopy = async (code: string) => {
    try {
      await Clipboard.setStringAsync(code);
    } catch {
      // Clipboard not available on all platforms
    }
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const activeCoupons = COUPONS.filter(c => new Date(c.expiresAt) > new Date());

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      {/* Nav */}
      <View style={st.navBar}>
        <Pressable style={st.navBack} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={20} color="#1A1208" />
        </Pressable>
        <Text style={st.navTitle}>Kampanyalar</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        {/* Header info */}
        <View style={st.infoCard}>
          <Ionicons name="gift-outline" size={20} color={colors.primary} />
          <Text style={st.infoText}>
            Kupon kodunu sepette "Promosyon Kodu" alanına girerek kullanabilirsiniz.
          </Text>
        </View>

        {/* Coupon cards */}
        {activeCoupons.map(coupon => {
          const isCopied = copiedCode === coupon.code;
          return (
            <View key={coupon.code} style={st.couponCard}>
              {/* Top colored strip */}
              <View style={[st.couponStrip, { backgroundColor: coupon.color }]}>
                <Text style={st.couponEmoji}>{coupon.icon}</Text>
                <View style={st.couponStripBody}>
                  <Text style={st.couponTitle}>{coupon.title}</Text>
                  <Text style={st.couponDiscount}>{formatDiscount(coupon)}</Text>
                </View>
              </View>

              {/* Body */}
              <View style={st.couponBody}>
                <Text style={st.couponDesc}>{coupon.description}</Text>

                {/* Code row */}
                <View style={st.codeRow}>
                  <View style={st.codeBadge}>
                    <Text style={st.codeText}>{coupon.code}</Text>
                  </View>
                  <Pressable
                    style={[st.copyBtn, isCopied && st.copyBtnDone]}
                    onPress={() => handleCopy(coupon.code)}
                  >
                    <Ionicons
                      name={isCopied ? 'checkmark' : 'copy-outline'}
                      size={16}
                      color="#fff"
                    />
                    <Text style={st.copyBtnText}>
                      {isCopied ? 'Kopyalandı' : 'Kopyala'}
                    </Text>
                  </Pressable>
                </View>

                {/* Meta */}
                <View style={st.metaRow}>
                  <View style={st.metaChip}>
                    <Ionicons name="cart-outline" size={12} color="#6B5E50" />
                    <Text style={st.metaText}>
                      Min. ₺{(coupon.minOrderCents / 100).toFixed(0)}
                    </Text>
                  </View>
                  {coupon.maxDiscountCents > 0 && coupon.type !== 'free_delivery' && (
                    <View style={st.metaChip}>
                      <Ionicons name="pricetag-outline" size={12} color="#6B5E50" />
                      <Text style={st.metaText}>
                        Maks. ₺{(coupon.maxDiscountCents / 100).toFixed(0)}
                      </Text>
                    </View>
                  )}
                  {coupon.usageLimit > 0 && (
                    <View style={st.metaChip}>
                      <Ionicons name="refresh-outline" size={12} color="#6B5E50" />
                      <Text style={st.metaText}>{coupon.usageLimit}x kullanım</Text>
                    </View>
                  )}
                </View>

                {/* Expiry */}
                <View style={st.expiryRow}>
                  <Ionicons name="calendar-outline" size={13} color="#F57F17" />
                  <Text style={st.expiryText}>
                    Son: {formatExpiry(coupon.expiresAt)}
                  </Text>
                </View>
              </View>
            </View>
          );
        })}

        {activeCoupons.length === 0 && (
          <View style={st.emptyWrap}>
            <Ionicons name="ticket-outline" size={52} color="#C4B8AA" />
            <Text style={st.emptyTitle}>Aktif kampanya yok</Text>
            <Text style={st.emptySub}>Yeni kampanyalar için bizi takip edin!</Text>
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#F0ECE6',
  },
  navBack: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F0EA', alignItems: 'center', justifyContent: 'center' },
  navTitle: { fontSize: 18, fontWeight: '800', color: '#1A1208' },

  scroll: { padding: 16, paddingBottom: 20 },

  infoCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.primary + '10', borderRadius: 12, padding: 14, marginBottom: 16,
    borderWidth: 1, borderColor: colors.primary + '20',
  },
  infoText: { flex: 1, fontSize: 13, color: '#6B5E50', lineHeight: 19 },

  couponCard: {
    backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', marginBottom: 14,
    borderWidth: 1, borderColor: '#EDE8E2',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  couponStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16,
  },
  couponEmoji: { fontSize: 32 },
  couponStripBody: { flex: 1 },
  couponTitle: { fontSize: 16, fontWeight: '800', color: '#fff', marginBottom: 2 },
  couponDiscount: { fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: '600' },

  couponBody: { padding: 16, gap: 12 },
  couponDesc: { fontSize: 13, color: '#6B5E50', lineHeight: 20 },

  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  codeBadge: {
    flex: 1, backgroundColor: '#FAF7F2', borderRadius: 10, padding: 12,
    borderWidth: 1.5, borderColor: '#EDE8E2', borderStyle: 'dashed',
  },
  codeText: { fontSize: 16, fontWeight: '900', color: '#1A1208', textAlign: 'center', letterSpacing: 2 },
  copyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10,
  },
  copyBtnDone: { backgroundColor: '#2E7D32' },
  copyBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#F7F3EE', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
  },
  metaText: { fontSize: 11, color: '#6B5E50', fontWeight: '600' },

  expiryRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFF8E1', borderRadius: 8, padding: 10,
  },
  expiryText: { fontSize: 12, color: '#F57F17', fontWeight: '600' },

  emptyWrap: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#1A1208' },
  emptySub: { fontSize: 13, color: '#A89A8A' },
});
