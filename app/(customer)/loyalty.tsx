import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useTheme } from '@/lib/theme-context';
import { fonts } from '@/lib/fonts';
import {
  EMPTY_LOYALTY,
  getLoyaltyData,
  redeemReward,
  getNextTierProgress,
  getFreeDeliveryProgress,
  TIER_CONFIG,
  REWARDS,
  type LoyaltyData,
  type LoyaltyReward,
} from '@/lib/loyalty';
import { applyReferralCode, getMyReferralCode, hasUsedReferralCode, shareReferralCode } from '@/lib/referral';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/Button';
import { TopBar } from '@/components/shared/TopBar';
import Animated, { FadeInDown } from 'react-native-reanimated';

type IconName = keyof typeof Ionicons.glyphMap;

const TIER_ICONS: Record<keyof typeof TIER_CONFIG, IconName> = {
  bronze: 'medal-outline',
  silver: 'medal-outline',
  gold: 'trophy-outline',
  platinum: 'diamond-outline',
};

const REWARD_ICONS: Record<LoyaltyReward['type'], IconName> = {
  free_delivery: 'bicycle-outline',
  discount_10: 'pricetag-outline',
  discount_20: 'gift-outline',
  discount_30: 'sparkles-outline',
};

const HOW_IT_WORKS: { icon: IconName; text: string }[] = [
  { icon: 'cart-outline', text: 'Teslim edilen her sipariş için puan kazan (1 TL = 1 puan)' },
  { icon: 'trending-up-outline', text: 'Daha çok sipariş ver, seviye atla, daha çok puan kazan' },
  { icon: 'gift-outline', text: 'Puanlarınla ücretsiz teslimat veya indirim kuponu al' },
  { icon: 'people-outline', text: 'Arkadaşını davet et, ikiniz de ₺15 indirim kazanın' },
];

export default function LoyaltyScreen() {
  const { colors: t } = useTheme();
  const { session } = useAuth();
  const [loyalty, setLoyalty] = useState<LoyaltyData>(EMPTY_LOYALTY);
  const [myCode, setMyCode] = useState<string | null>(null);
  const [usedCode, setUsedCode] = useState(true);
  const [friendCode, setFriendCode] = useState('');
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    getLoyaltyData().then(setLoyalty).catch(() => {});
    if (session?.userId) {
      getMyReferralCode().then(setMyCode).catch(() => {});
      hasUsedReferralCode(session.userId).then(setUsedCode).catch(() => {});
    }
  }, [session?.userId]);

  const submitFriendCode = async () => {
    if (!friendCode.trim() || applying) return;
    setApplying(true);
    const result = await applyReferralCode(friendCode);
    setApplying(false);
    Alert.alert(result.success ? 'Tebrikler!' : 'Kod uygulanamadı', result.message);
    if (result.success) {
      setUsedCode(true);
      setFriendCode('');
    }
  };

  const tierConf = TIER_CONFIG[loyalty.tier];
  const nextTier = getNextTierProgress(loyalty);
  const freeDelivery = getFreeDeliveryProgress(loyalty);

  const handleRedeem = useCallback(async (rewardId: string) => {
    const result = await redeemReward(rewardId);
    Alert.alert(result.success ? 'Tebrikler!' : 'Ödül alınamadı', result.message);
    if (result.success) {
      const updated = await getLoyaltyData();
      setLoyalty(updated);
    }
  }, []);

  return (
    <View style={[st.safe, { backgroundColor: t.background }]}>
      <TopBar back title="Sadakat programı" />

      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        {/* Koyu vurgu kartı */}
        <Animated.View entering={FadeInDown.duration(400)}>
          <View style={[st.tierCard, { backgroundColor: t.brand }]}>
            <Text style={[st.points, { color: t.accent }]}>{loyalty.points} puan</Text>
            <View style={st.tierRow}>
              <Ionicons name={TIER_ICONS[loyalty.tier]} size={16} color={t.onBrandSoft} />
              <Text style={[st.tierText, { color: t.onBrandSoft }]}>
                {tierConf.label} üye · {tierConf.pointMultiplier}x puan kazanımı
              </Text>
            </View>

            <View style={[st.statsRow, { backgroundColor: t.panel }]}>
              <View style={st.statItem}>
                <Text style={[st.statNum, { color: t.onBrand }]}>{loyalty.totalOrders}</Text>
                <Text style={[st.statLabel, { color: t.onBrandSoft }]}>Sipariş</Text>
              </View>
              <View style={st.statItem}>
                <Text style={[st.statNum, { color: t.onBrand }]}>₺{(loyalty.totalSpentCents / 100).toFixed(0)}</Text>
                <Text style={[st.statLabel, { color: t.onBrandSoft }]}>Harcama</Text>
              </View>
              <View style={st.statItem}>
                <Text style={[st.statNum, { color: t.onBrand }]}>{loyalty.referralCount}</Text>
                <Text style={[st.statLabel, { color: t.onBrandSoft }]}>Davet</Text>
              </View>
            </View>

            {nextTier && (
              <View style={st.progressSection}>
                <Text style={[st.progressText, { color: t.onBrandSoft }]}>
                  {nextTier.nextTier} seviyesine {nextTier.ordersNeeded} sipariş kaldı
                </Text>
                <View style={[st.progressBar, { backgroundColor: t.panel }]}>
                  <View style={[st.progressFill, { width: `${nextTier.progress * 100}%`, backgroundColor: t.accent }]} />
                </View>
              </View>
            )}
          </View>
        </Animated.View>

        {/* Ücretsiz teslimat */}
        <Animated.View entering={FadeInDown.delay(100).duration(400)}>
          <View style={[st.card, { backgroundColor: t.surface }]}>
            <View style={st.cardRow}>
              <View style={[st.iconCircle, { backgroundColor: t.chip }]}>
                <Ionicons name="bicycle-outline" size={20} color={t.text} />
              </View>
              <View style={st.flex}>
                <Text style={[st.cardTitle, { color: t.text }]}>Ücretsiz teslimat</Text>
                <Text style={[st.cardSub, { color: t.textSecondary }]}>Her 10 siparişte 1 ücretsiz teslimat</Text>
              </View>
            </View>
            <View style={st.deliveryProgress}>
              {Array.from({ length: 10 }).map((_, i) => {
                const done = i < freeDelivery.current;
                return (
                  <View key={i} style={[st.deliveryDot, { backgroundColor: done ? t.accent : t.chip }]}>
                    {done
                      ? <Ionicons name="checkmark" size={12} color={t.onAccent} />
                      : i === 9 ? <Ionicons name="gift-outline" size={12} color={t.text} /> : null}
                  </View>
                );
              })}
            </View>
            <Text style={[st.deliveryCount, { color: t.textSecondary }]}>
              {freeDelivery.current}/10 sipariş tamamlandı
            </Text>
          </View>
        </Animated.View>

        {/* Ödüller */}
        <Animated.View entering={FadeInDown.delay(200).duration(400)}>
          <Text style={[st.heading, { color: t.heading }]}>Ödüller</Text>
          <View style={st.rewardsGrid}>
            {REWARDS.map(reward => {
              const canAfford = loyalty.points >= reward.pointsCost;
              return (
                <Pressable
                  key={reward.id}
                  style={[st.rewardCard, { backgroundColor: t.surface }, !canAfford && st.rewardCardDim]}
                  onPress={() => canAfford && handleRedeem(reward.id)}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canAfford }}
                  accessibilityLabel={`${reward.title}, ${reward.pointsCost} puan`}
                >
                  <View style={[st.iconCircle, { backgroundColor: t.chip }]}>
                    <Ionicons name={REWARD_ICONS[reward.type]} size={20} color={t.text} />
                  </View>
                  <Text style={[st.rewardTitle, { color: t.text }]}>{reward.title}</Text>
                  <Text style={[st.rewardDesc, { color: t.textSecondary }]}>{reward.description}</Text>
                  <View style={[st.rewardCost, { backgroundColor: canAfford ? t.accent : t.chip }]}>
                    <Text style={[st.rewardCostText, { color: canAfford ? t.onAccent : t.textSecondary }]}>{reward.pointsCost} puan</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>

        {/* Davet */}
        <Animated.View entering={FadeInDown.delay(300).duration(400)}>
          <View style={[st.card, { backgroundColor: t.surface }]}>
            <Text style={[st.cardTitle, { color: t.text }]}>Arkadaşını davet et</Text>
            <Text style={[st.cardSub, { color: t.textSecondary, marginTop: 4 }]}>
              Arkadaşın kodunu girince ₺15 indirim kazanır. İlk siparişi teslim edildiğinde sen de ₺15 indirim kuponu kazanırsın.
            </Text>

            {myCode ? (
              <View style={[st.codeBox, { backgroundColor: t.background }]}>
                <Text style={[st.codeText, { color: t.text }]} numberOfLines={1}>{myCode}</Text>
                <Pressable
                  style={[st.shareBtn, { backgroundColor: t.accent }]}
                  onPress={() => shareReferralCode(myCode)}
                  accessibilityRole="button"
                  accessibilityLabel="Davet kodunu paylaş"
                >
                  <Ionicons name="share-outline" size={16} color={t.onAccent} />
                  <Text style={[st.shareText, { color: t.onAccent }]}>Paylaş</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={[st.referralStats, { color: t.textSecondary }]}>Davet kodun için giriş yap.</Text>
            )}

            {loyalty.referralCount > 0 && (
              <Text style={[st.referralStats, { color: t.textSecondary }]}>
                {loyalty.referralCount} arkadaşın katıldı · ₺{(loyalty.referralEarnings / 100).toFixed(0)} kazandın
              </Text>
            )}

            {session?.userId && !usedCode && (
              <View style={st.friendCodeRow}>
                <TextInput
                  style={[st.friendCodeInput, { color: t.text, backgroundColor: t.background }]}
                  value={friendCode}
                  onChangeText={setFriendCode}
                  placeholder="Davet kodun var mı?"
                  placeholderTextColor={t.textMuted}
                  accessibilityLabel="Davet kodu"
                  autoCapitalize="characters"
                />
                <Button label="Uygula" onPress={submitFriendCode} disabled={applying} />
              </View>
            )}
          </View>
        </Animated.View>

        {/* Nasıl çalışır */}
        <Animated.View entering={FadeInDown.delay(400).duration(400)}>
          <Text style={[st.heading, { color: t.heading }]}>Nasıl çalışır?</Text>
          <View style={[st.card, { backgroundColor: t.surface }]}>
            {HOW_IT_WORKS.map(item => (
              <View key={item.icon} style={st.howRow}>
                <View style={[st.iconCircle, { backgroundColor: t.chip }]}>
                  <Ionicons name={item.icon} size={20} color={t.text} />
                </View>
                <Text style={[st.howText, { color: t.textSecondary }]}>{item.text}</Text>
              </View>
            ))}
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  scroll: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 40, gap: 12 },

  tierCard: { borderRadius: 16, padding: 16 },
  points: { fontSize: 36, lineHeight: 42, fontFamily: fonts.display, letterSpacing: -0.6 },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  tierText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingVertical: 10, borderRadius: 12 },
  statItem: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 16, lineHeight: 22, fontFamily: fonts.extrabold },
  statLabel: { fontFamily: fonts.regular, fontSize: 12 },
  progressSection: { marginTop: 12 },
  progressText: { fontFamily: fonts.regular, fontSize: 13, marginBottom: 6 },
  progressBar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },

  card: { borderRadius: 16, padding: 14 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold },
  cardSub: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  iconCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

  deliveryProgress: { flexDirection: 'row', gap: 4, justifyContent: 'space-between', marginBottom: 8 },
  deliveryDot: { flex: 1, maxWidth: 28, aspectRatio: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  deliveryCount: { fontFamily: fonts.regular, fontSize: 12, textAlign: 'center' },

  heading: { fontSize: 18, lineHeight: 24, fontFamily: fonts.display, letterSpacing: -0.4, marginTop: 4, marginBottom: 10 },
  rewardsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  rewardCard: { width: '48%' as any, flexGrow: 1, borderRadius: 16, padding: 14, alignItems: 'center', gap: 6 },
  rewardCardDim: { opacity: 0.6 },
  rewardTitle: { fontSize: 14, fontFamily: fonts.bold, textAlign: 'center' },
  rewardDesc: { fontFamily: fonts.regular, fontSize: 12, textAlign: 'center', lineHeight: 16 },
  rewardCost: { marginTop: 4, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 10 },
  rewardCostText: { fontSize: 12, fontFamily: fonts.bold },

  codeBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 12, paddingVertical: 4, paddingLeft: 12, paddingRight: 4, borderRadius: 12 },
  codeText: { flexShrink: 1, fontSize: 14, letterSpacing: 1, fontFamily: fonts.extrabold },
  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, paddingHorizontal: 14, borderRadius: 10 },
  shareText: { fontSize: 13, fontFamily: fonts.extrabold },
  referralStats: { fontFamily: fonts.regular, fontSize: 12, textAlign: 'center', marginTop: 10 },
  friendCodeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  friendCodeInput: { flex: 1, minWidth: 0, height: 46, borderRadius: 12, paddingHorizontal: 14, fontSize: 14, fontFamily: fonts.semibold },

  howRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  howText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
});
