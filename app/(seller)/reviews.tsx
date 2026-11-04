import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { fetchSellerByUserId, fetchReviews, replyToReview, type ReviewRow } from '@/lib/db';
import { fonts } from '@/lib/fonts';

type DemoReview = {
  id: string;
  customer: string;
  rating: number;
  comment: string;
  items: string;
  date: string;
  reply?: string;
};

function formatReviewDate(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffH = Math.floor(diffMs / 3600000);
  if (diffH < 24) return `${diffH} saat önce`;
  const diffDay = Math.floor(diffH / 24);
  if (diffDay === 1) return 'Dün';
  if (diffDay < 7) return `${diffDay} gün önce`;
  return `${Math.floor(diffDay / 7)} hafta önce`;
}

function rowToReview(r: ReviewRow): DemoReview {
  return {
    id: r.id,
    customer: r.customer_id.slice(0, 8) + '...',
    rating: r.rating,
    comment: r.comment ?? '',
    items: r.menu_item_title ?? '',
    date: formatReviewDate(r.created_at),
    reply: r.seller_reply ?? undefined,
  };
}

function Stars({ count }: { count: number }) {
  return (
    <View style={st.starsRow}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Text key={i} style={[st.star, i <= count && st.starActive]}>★</Text>
      ))}
    </View>
  );
}

export default function ReviewsScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [reviews, setReviews] = useState<DemoReview[]>([]);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  useEffect(() => {
    if (!profile?.id) return;
    (async () => {
      try {
        const seller = await fetchSellerByUserId(profile.id);
        if (!seller) return;
        const rows = await fetchReviews(seller.id);
        setReviews(rows.map(rowToReview));
      } catch {}
    })();
  }, [profile?.id]);

  const avgRating = reviews.length > 0 ? (reviews.reduce((s: number, r: DemoReview) => s + r.rating, 0) / reviews.length).toFixed(1) : '0';
  const ratingDist = [5, 4, 3, 2, 1].map((r) => ({
    rating: r,
    count: reviews.filter((rv: DemoReview) => rv.rating === r).length,
  }));

  const submitReply = async (id: string) => {
    if (!replyText.trim()) return;
    const previous = reviews;
    setReviews((prev: DemoReview[]) => prev.map((r: DemoReview) => r.id === id ? { ...r, reply: replyText.trim() } : r));
    const text = replyText.trim();
    setReplyingTo(null);
    setReplyText('');
    try {
      await replyToReview(id, text);
    } catch {
      setReviews(previous);
      setReplyingTo(id);
      setReplyText(text);
      Alert.alert('Yanıt gönderilemedi', 'Lütfen tekrar dene.');
    }
  };

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <Pressable style={st.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={20} color="#151A16" />
        </Pressable>
        <Text style={st.headerTitle}>Müşteri Yorumları</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        {/* Summary card */}
        <View style={st.summaryCard}>
          <View style={st.summaryLeft}>
            <Text style={st.avgRating}>{avgRating}</Text>
            <Stars count={Math.round(Number(avgRating))} />
            <Text style={st.totalReviews}>{reviews.length} değerlendirme</Text>
          </View>
          <View style={st.summaryRight}>
            {ratingDist.map((d) => (
              <View key={d.rating} style={st.distRow}>
                <Text style={st.distLabel}>{d.rating}</Text>
                <Text style={st.distStar}>★</Text>
                <View style={st.distBarBg}>
                  <View style={[st.distBarFill, { width: `${reviews.length > 0 ? (d.count / reviews.length) * 100 : 0}%` }]} />
                </View>
                <Text style={st.distCount}>{d.count}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Reviews */}
        {reviews.map((r) => (
          <View key={r.id} style={st.reviewCard}>
            <View style={st.reviewTop}>
              <View style={st.customerAvatar}>
                <Text style={st.customerInitial}>{r.customer.charAt(0)}</Text>
              </View>
              <View style={st.reviewInfo}>
                <Text style={st.customerName}>{r.customer}</Text>
                <Stars count={r.rating} />
              </View>
              <Text style={st.reviewDate}>{r.date}</Text>
            </View>

            <Text style={st.reviewComment}>{r.comment}</Text>
            <Text style={st.reviewItems}>🍽️ {r.items}</Text>

            {r.reply ? (
              <View style={st.replyBox}>
                <Text style={st.replyLabel}>Yanıtınız:</Text>
                <Text style={st.replyText}>{r.reply}</Text>
              </View>
            ) : replyingTo === r.id ? (
              <View style={st.replyInputBox}>
                <TextInput
                  style={st.replyInput}
                  value={replyText}
                  onChangeText={setReplyText}
                  placeholder="Yanıtınızı yazın..."
                  placeholderTextColor="#A3ACA5"
                  multiline
                />
                <View style={st.replyActions}>
                  <Pressable style={st.replyCancelBtn} onPress={() => { setReplyingTo(null); setReplyText(''); }}>
                    <Text style={st.replyCancelText}>İptal</Text>
                  </Pressable>
                  <Pressable style={st.replySendBtn} onPress={() => submitReply(r.id)}>
                    <Text style={st.replySendText}>Gönder</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable style={st.replyBtn} onPress={() => { setReplyingTo(r.id); setReplyText(''); }}>
                <Text style={st.replyBtnText}>Yanıtla</Text>
              </Pressable>
            )}
          </View>
        ))}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF8F2' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E3E6DE',
  },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#EFF2EA', alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 22, fontFamily: fonts.display, color: '#151A16', marginTop: -2 },
  headerTitle: { fontSize: 18, fontFamily: fonts.display, color: '#151A16' },
  scroll: { padding: 16, gap: 12 },

  summaryCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    gap: 20,
    borderWidth: 1,
    borderColor: '#E3E6DE',
  },
  summaryLeft: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  avgRating: { fontSize: 40, fontFamily: fonts.display, color: '#151A16' },
  totalReviews: { fontSize: 11, color: '#6B766F', fontFamily: fonts.semibold },
  summaryRight: { flex: 1, gap: 4, justifyContent: 'center' },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  distLabel: { fontSize: 12, fontFamily: fonts.bold, color: '#151A16', width: 10, textAlign: 'right' },
  distStar: { fontFamily: fonts.regular, fontSize: 10, color: '#E3A90F' },
  distBarBg: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#EDEFE8' },
  distBarFill: { height: 6, borderRadius: 3, backgroundColor: '#E3A90F' },
  distCount: { fontFamily: fonts.regular, fontSize: 11, color: '#6B766F', width: 16, textAlign: 'right' },

  starsRow: { flexDirection: 'row', gap: 1 },
  star: { fontFamily: fonts.regular, fontSize: 14, color: '#DDE1D8' },
  starActive: { color: '#E3A90F' },

  reviewCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E3E6DE',
    gap: 10,
  },
  reviewTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  customerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  customerInitial: { fontSize: 16, fontFamily: fonts.bold, color: colors.primary },
  reviewInfo: { flex: 1, gap: 2 },
  customerName: { fontSize: 14, fontFamily: fonts.bold, color: '#151A16' },
  reviewDate: { fontFamily: fonts.regular, fontSize: 11, color: '#6B766F' },
  reviewComment: { fontFamily: fonts.regular, fontSize: 13, color: '#3A453E', lineHeight: 19 },
  reviewItems: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F' },

  replyBox: {
    backgroundColor: '#F3F5EE',
    borderRadius: 12,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  replyLabel: { fontSize: 11, fontFamily: fonts.bold, color: colors.primary, marginBottom: 4 },
  replyText: { fontFamily: fonts.regular, fontSize: 13, color: '#3A453E', lineHeight: 18 },

  replyBtn: { alignSelf: 'flex-start' },
  replyBtnText: { fontSize: 13, color: colors.primary, fontFamily: fonts.bold },

  replyInputBox: { gap: 8 },
  replyInput: {
    backgroundColor: '#FAF8F2',
    borderRadius: 12,
    padding: 12,
    fontFamily: fonts.regular, fontSize: 13,
    color: '#151A16',
    minHeight: 60,
    borderWidth: 1,
    borderColor: '#E3E6DE',
  },
  replyActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  replyCancelBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, backgroundColor: '#EFF2EA' },
  replyCancelText: { fontSize: 13, fontFamily: fonts.semibold, color: '#56605A' },
  replySendBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.primary },
  replySendText: { fontSize: 13, fontFamily: fonts.bold, color: '#fff' },
});
