import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@/constants/theme';
import { useTheme } from '@/lib/theme-context';
import { fonts } from '@/lib/fonts';
import {
  getLoyaltyData,
  redeemReward,
  getNextTierProgress,
  getFreeDeliveryProgress,
  TIER_CONFIG,
  REWARDS,
  type LoyaltyData,
} from '@/lib/loyalty';
import { getReferralData, shareReferralCode, type ReferralData } from '@/lib/referral';
import Animated, { FadeInDown } from 'react-native-reanimated';

// ─── Demo data for display ───────────────────────────────────────────────────

const DEMO_LOYALTY: LoyaltyData = {
  totalOrders: 7,
  totalSpentCents: 87500,
  points: 142,
  tier: 'silver',
  freeDeliveryEarned: 0,
  freeDeliveryUsed: 0,
  lastOrderDate: '2026-03-28T14:30:00Z',
  streakDays: 3,
  referralCode: 'EVAB3K7',
  referralCount: 2,
  referralEarnings: 3000,
};

export default function LoyaltyScreen() {
  const router = useRouter();
  const { colors: t } = useTheme();
  const [loyalty, setLoyalty] = useState<LoyaltyData>(DEMO_LOYALTY);
  const [referral, setReferral] = useState<ReferralData | null>(null);

  useEffect(() => {
    getLoyaltyData().then(data => {
      // Use demo if no real data
      if (data.totalOrders === 0) setLoyalty(DEMO_LOYALTY);
      else setLoyalty(data);
    });
    getReferralData().then(setReferral);
  }, []);

  const tierConf = TIER_CONFIG[loyalty.tier];
  const nextTier = getNextTierProgress(loyalty);
  const freeDelivery = getFreeDeliveryProgress(loyalty);

  const handleRedeem = useCallback(async (rewardId: string) => {
    const result = await redeemReward(rewardId);
    Alert.alert(result.success ? 'Tebrikler! 🎉' : 'Yetersiz Puan', result.message);
    if (result.success) {
      const updated = await getLoyaltyData();
      setLoyalty(updated);
    }
  }, []);

  return (
    <SafeAreaView style={[st.safe, { backgroundColor: t.background }]} edges={['top']}>
      {/* Header */}
      <View style={[st.header, { backgroundColor: t.surface, borderBottomColor: t.surfaceBorder }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={t.text} />
        </Pressable>
        <Text style={[st.headerTitle, { color: t.text }]}>Sadakat Programı</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        {/* Tier Card */}
        <Animated.View entering={FadeInDown.duration(400)}>
          <View style={[st.tierCard, { borderColor: tierConf.color }]}>
            <View style={st.tierTop}>
              <Text style={st.tierIcon}>{tierConf.icon}</Text>
              <View style={st.tierInfo}>
                <Text style={[st.tierLabel, { color: tierConf.color }]}>{tierConf.label} Üye</Text>
                <Text style={[st.tierMultiplier, { color: t.textMuted }]}>
                  {tierConf.pointMultiplier}x puan kazanımı
                </Text>
              </View>
              <View style={st.pointsBadge}>
                <Text style={st.pointsNum}>{loyalty.points}</Text>
                <Text style={st.pointsLabel}>puan</Text>
              </View>
            </View>

            {/* Stats row */}
            <View style={st.statsRow}>
              <View style={st.statItem}>
                <Text style={[st.statNum, { color: t.text }]}>{loyalty.totalOrders}</Text>
                <Text style={[st.statLabel, { color: t.textMuted }]}>Sipariş</Text>
              </View>
              <View style={[st.statDivider, { backgroundColor: t.surfaceBorder }]} />
              <View style={st.statItem}>
                <Text style={[st.statNum, { color: t.text }]}>₺{(loyalty.totalSpentCents / 100).toFixed(0)}</Text>
                <Text style={[st.statLabel, { color: t.textMuted }]}>Harcama</Text>
              </View>
              <View style={[st.statDivider, { backgroundColor: t.surfaceBorder }]} />
              <View style={st.statItem}>
                <Text style={[st.statNum, { color: t.text }]}>{loyalty.referralCount}</Text>
                <Text style={[st.statLabel, { color: t.textMuted }]}>Davet</Text>
              </View>
            </View>

            {/* Next tier progress */}
            {nextTier && (
              <View style={st.progressSection}>
                <Text style={[st.progressText, { color: t.textSecondary }]}>
                  {nextTier.nextTier} seviyesine {nextTier.ordersNeeded} sipariş kaldı
                </Text>
                <View style={[st.progressBar, { backgroundColor: t.surfaceBorder }]}>
                  <View style={[st.progressFill, { width: `${nextTier.progress * 100}%`, backgroundColor: tierConf.color }]} />
                </View>
              </View>
            )}
          </View>
        </Animated.View>

        {/* Free Delivery Progress */}
        <Animated.View entering={FadeInDown.delay(100).duration(400)}>
          <View style={[st.section, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
            <View style={st.sectionRow}>
              <Text style={st.sectionIcon}>🚚</Text>
              <View style={{ flex: 1 }}>
                <Text style={[st.sectionTitle, { color: t.text }]}>Ücretsiz Teslimat</Text>
                <Text style={[st.sectionSub, { color: t.textMuted }]}>
                  Her 10 siparişte 1 ücretsiz teslimat
                </Text>
              </View>
            </View>
            <View style={st.deliveryProgress}>
              {Array.from({ length: 10 }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    st.deliveryDot,
                    i < freeDelivery.current
                      ? { backgroundColor: colors.primary }
                      : { backgroundColor: t.surfaceBorder },
                  ]}
                >
                  {i < freeDelivery.current && <Ionicons name="checkmark" size={10} color="#fff" />}
                  {i === 9 && <Text style={st.deliveryGift}>🎁</Text>}
                </View>
              ))}
            </View>
            <Text style={[st.deliveryCount, { color: t.textMuted }]}>
              {freeDelivery.current}/10 sipariş tamamlandı
            </Text>
          </View>
        </Animated.View>

        {/* Rewards */}
        <Animated.View entering={FadeInDown.delay(200).duration(400)}>
          <Text style={[st.heading, { color: t.text }]}>Ödüller</Text>
          <View style={st.rewardsGrid}>
            {REWARDS.map(reward => {
              const canAfford = loyalty.points >= reward.pointsCost;
              return (
                <Pressable
                  key={reward.id}
                  style={[st.rewardCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }, !canAfford && st.rewardCardDim]}
                  onPress={() => canAfford && handleRedeem(reward.id)}
                >
                  <Text style={st.rewardIcon}>{reward.icon}</Text>
                  <Text style={[st.rewardTitle, { color: t.text }]}>{reward.title}</Text>
                  <Text style={[st.rewardDesc, { color: t.textMuted }]}>{reward.description}</Text>
                  <View style={[st.rewardCost, canAfford && { backgroundColor: colors.primary }]}>
                    <Text style={[st.rewardCostText, canAfford && { color: '#fff' }]}>{reward.pointsCost} puan</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>

        {/* Referral */}
        <Animated.View entering={FadeInDown.delay(300).duration(400)}>
          <View style={[st.section, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
            <Text style={[st.sectionTitle, { color: t.text }]}>🎁 Arkadaşını Davet Et</Text>
            <Text style={[st.sectionSub, { color: t.textMuted, marginTop: 4 }]}>
              Arkadaşın üye olup ilk siparişini verdiğinde, ikinize de ₺15 indirim!
            </Text>

            <View style={[st.codeBox, { backgroundColor: t.background }]}>
              <Text style={[st.codeText, { color: t.text }]}>{referral?.myCode ?? loyalty.referralCode}</Text>
            </View>

            <Pressable style={st.shareBtn} onPress={shareReferralCode}>
              <Ionicons name="share-outline" size={18} color="#fff" />
              <Text style={st.shareBtnText}>Davet Linkini Paylaş</Text>
            </Pressable>

            {loyalty.referralCount > 0 && (
              <Text style={[st.referralStats, { color: t.textMuted }]}>
                {loyalty.referralCount} kişi davet edildi · ₺{(loyalty.referralEarnings / 100).toFixed(0)} kazanıldı
              </Text>
            )}
          </View>
        </Animated.View>

        {/* How it works */}
        <Animated.View entering={FadeInDown.delay(400).duration(400)}>
          <Text style={[st.heading, { color: t.text }]}>Nasıl Çalışır?</Text>
          <View style={[st.section, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
            {[
              { icon: '🛒', text: 'Her sipariş için puan kazan (1 TL = 1 puan)' },
              { icon: '📈', text: 'Daha çok sipariş ver, seviye atla, daha çok puan kazan' },
              { icon: '🎁', text: 'Puanlarınla ücretsiz teslimat veya indirim kuponu al' },
              { icon: '👥', text: 'Arkadaşını davet et, ikisine de ₺15 indirim' },
            ].map((item, i) => (
              <View key={i} style={st.howRow}>
                <Text style={st.howIcon}>{item.icon}</Text>
                <Text style={[st.howText, { color: t.textSecondary }]}>{item.text}</Text>
              </View>
            ))}
          </View>
        </Animated.View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 18, fontWeight: '800', fontFamily: fonts.extrabold },
  scroll: { padding: 16 },

  // Tier card
  tierCard: {
    borderRadius: 20,
    borderWidth: 2,
    padding: 20,
    marginBottom: 16,
    backgroundColor: '#fff',
  },
  tierTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tierIcon: { fontSize: 40 },
  tierInfo: { flex: 1 },
  tierLabel: { fontSize: 18, fontWeight: '800', fontFamily: fonts.extrabold },
  tierMultiplier: { fontSize: 12, marginTop: 2 },
  pointsBadge: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  pointsNum: { fontSize: 22, fontWeight: '800', color: '#fff', fontFamily: fonts.extrabold },
  pointsLabel: { fontSize: 10, color: 'rgba(255,255,255,0.8)', fontWeight: '600' },

  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F0ECE6',
  },
  statItem: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 18, fontWeight: '800', fontFamily: fonts.extrabold },
  statLabel: { fontSize: 11, marginTop: 2 },
  statDivider: { width: 1, height: 28 },

  progressSection: { marginTop: 16 },
  progressText: { fontSize: 12, marginBottom: 6 },
  progressBar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },

  // Section
  section: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  sectionIcon: { fontSize: 28 },
  sectionTitle: { fontSize: 15, fontWeight: '700', fontFamily: fonts.bold },
  sectionSub: { fontSize: 12 },

  // Free delivery dots
  deliveryProgress: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  deliveryDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deliveryGift: { fontSize: 12 },
  deliveryCount: { fontSize: 11, textAlign: 'center' },

  // Rewards
  heading: { fontSize: 16, fontWeight: '800', fontFamily: fonts.extrabold, marginBottom: 12, marginTop: 4 },
  rewardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  rewardCard: {
    width: '48%' as any,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    alignItems: 'center',
    gap: 6,
  },
  rewardCardDim: { opacity: 0.5 },
  rewardIcon: { fontSize: 28 },
  rewardTitle: { fontSize: 14, fontWeight: '700', fontFamily: fonts.bold, textAlign: 'center' },
  rewardDesc: { fontSize: 11, textAlign: 'center', lineHeight: 15 },
  rewardCost: {
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: '#F0ECE6',
  },
  rewardCostText: { fontSize: 12, fontWeight: '700', color: '#8A7E72' },

  // Referral
  codeBox: {
    marginTop: 12,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  codeText: { fontSize: 22, fontWeight: '800', letterSpacing: 3, fontFamily: fonts.extrabold },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 12,
  },
  shareBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  referralStats: { fontSize: 12, textAlign: 'center', marginTop: 10 },

  // How it works
  howRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  howIcon: { fontSize: 22 },
  howText: { flex: 1, fontSize: 13, lineHeight: 18 },
});
