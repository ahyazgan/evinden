import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { fetchSellerByUserId, fetchReviews, replyToReview, type ReviewRow } from '@/lib/db';

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

  const submitReply = (id: string) => {
    if (!replyText.trim()) return;
    setReviews((prev: DemoReview[]) => prev.map((r: DemoReview) => r.id === id ? { ...r, reply: replyText.trim() } : r));
    replyToReview(id, replyText.trim()).catch(() => {});
    setReplyingTo(null);
    setReplyText('');
  };

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <Pressable style={st.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Text style={st.backIcon}>‹</Text>
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
                  placeholderTextColor="#B8AFA4"
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
                <Text style={st.replyBtnText}>💬 Yanıtla</Text>
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
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EDE8E2',
  },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F0EA', alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 22, fontWeight: '700', color: '#1A1208', marginTop: -2 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#1A1208' },
  scroll: { padding: 16, gap: 12 },

  summaryCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    gap: 20,
    borderWidth: 1,
    borderColor: '#EDE8E2',
  },
  summaryLeft: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  avgRating: { fontSize: 40, fontWeight: '900', color: '#1A1208' },
  totalReviews: { fontSize: 11, color: '#8A7E72', fontWeight: '600' },
  summaryRight: { flex: 1, gap: 4, justifyContent: 'center' },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  distLabel: { fontSize: 12, fontWeight: '700', color: '#1A1208', width: 10, textAlign: 'right' },
  distStar: { fontSize: 10, color: '#EF9F27' },
  distBarBg: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#F0ECE6' },
  distBarFill: { height: 6, borderRadius: 3, backgroundColor: '#EF9F27' },
  distCount: { fontSize: 11, color: '#8A7E72', width: 16, textAlign: 'right' },

  starsRow: { flexDirection: 'row', gap: 1 },
  star: { fontSize: 14, color: '#E8E2DA' },
  starActive: { color: '#EF9F27' },

  reviewCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EDE8E2',
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
  customerInitial: { fontSize: 16, fontWeight: '700', color: colors.primary },
  reviewInfo: { flex: 1, gap: 2 },
  customerName: { fontSize: 14, fontWeight: '700', color: '#1A1208' },
  reviewDate: { fontSize: 11, color: '#A89A8A' },
  reviewComment: { fontSize: 13, color: '#4A3F35', lineHeight: 19 },
  reviewItems: { fontSize: 12, color: '#8A7E72' },

  replyBox: {
    backgroundColor: '#F7F3EE',
    borderRadius: 12,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  replyLabel: { fontSize: 11, fontWeight: '700', color: colors.primary, marginBottom: 4 },
  replyText: { fontSize: 13, color: '#4A3F35', lineHeight: 18 },

  replyBtn: { alignSelf: 'flex-start' },
  replyBtnText: { fontSize: 13, color: colors.primary, fontWeight: '700' },

  replyInputBox: { gap: 8 },
  replyInput: {
    backgroundColor: '#FAF7F2',
    borderRadius: 12,
    padding: 12,
    fontSize: 13,
    color: '#1A1208',
    minHeight: 60,
    borderWidth: 1,
    borderColor: '#EDE8E2',
  },
  replyActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  replyCancelBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, backgroundColor: '#F5F0EA' },
  replyCancelText: { fontSize: 13, fontWeight: '600', color: '#6B5E50' },
  replySendBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.primary },
  replySendText: { fontSize: 13, fontWeight: '700', color: '#fff' },
});
