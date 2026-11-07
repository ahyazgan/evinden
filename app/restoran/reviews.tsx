import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/lib/auth-context';
import { fetchSellerByUserId, fetchReviews, replyToReview, type ReviewRow } from '@/lib/db';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';

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
    // Müşteri ekranındaki gibi: yorumu yazanın adı restorana açılmaz.
    customer: 'Müşteri',
    rating: r.rating,
    comment: r.comment ?? '',
    items: r.menu_item_title ?? '',
    date: formatReviewDate(r.created_at),
    reply: r.seller_reply ?? undefined,
  };
}

function Stars({ count }: { count: number }) {
  const { colors: t } = useTheme();
  return (
    <View style={st.starsRow} accessible accessibilityLabel={`5 üzerinden ${count} puan`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Ionicons key={i} name={i <= count ? 'star' : 'star-outline'} size={14} color={i <= count ? t.text : t.textMuted} />
      ))}
    </View>
  );
}

export default function ReviewsScreen() {
  const { colors: t } = useTheme();
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
    <View style={[st.safe, { backgroundColor: t.background }]}>
      <TopBar title="Müşteri yorumları" subtitle={`${reviews.length} değerlendirme`} back />

      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Summary card */}
        <View style={[st.summaryCard, { backgroundColor: t.surface }]}>
          <View style={st.summaryLeft}>
            <Text style={[st.avgRating, { color: t.heading }]}>{avgRating}</Text>
            <Stars count={Math.round(Number(avgRating))} />
            <Text style={[st.totalReviews, { color: t.textSecondary }]}>{reviews.length} değerlendirme</Text>
          </View>
          <View style={st.summaryRight}>
            {ratingDist.map((d) => (
              <View key={d.rating} style={st.distRow}>
                <Text style={[st.distLabel, { color: t.text }]}>{d.rating}</Text>
                <Ionicons name="star" size={11} color={t.text} />
                <View style={[st.distBarBg, { backgroundColor: t.divider }]}>
                  <View style={[st.distBarFill, { backgroundColor: t.brand, width: `${reviews.length > 0 ? (d.count / reviews.length) * 100 : 0}%` }]} />
                </View>
                <Text style={[st.distCount, { color: t.textSecondary }]}>{d.count}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Reviews */}
        {reviews.length === 0 ? (
          <View style={st.empty}>
            <Ionicons name="star-outline" size={44} color={t.textMuted} />
            <Text style={[st.emptyTitle, { color: t.heading }]}>Henüz yorum yok</Text>
            <Text style={[st.emptySub, { color: t.textSecondary }]}>Müşterilerin yorum yaptıkça burada görünecek.</Text>
          </View>
        ) : null}
        {reviews.map((r) => (
          <View key={r.id} style={[st.reviewCard, { backgroundColor: t.surface }]}>
            <View style={st.reviewTop}>
              <View style={[st.customerAvatar, { backgroundColor: t.background }]}>
                <Text style={[st.customerInitial, { color: t.text }]}>{r.customer.charAt(0)}</Text>
              </View>
              <View style={st.reviewInfo}>
                <Text style={[st.customerName, { color: t.text }]} numberOfLines={1}>{r.customer}</Text>
                <Stars count={r.rating} />
              </View>
              <Text style={[st.reviewDate, { color: t.textSecondary }]}>{r.date}</Text>
            </View>

            <Text style={[st.reviewComment, { color: t.text }]}>{r.comment}</Text>
            {r.items ? (
              <View style={st.reviewItems}>
                <Ionicons name="restaurant-outline" size={14} color={t.textSecondary} />
                <Text style={[st.reviewItemsText, { color: t.textSecondary }]}>{r.items}</Text>
              </View>
            ) : null}

            {r.reply ? (
              <View style={[st.replyBox, { backgroundColor: t.background }]}>
                <Text style={[st.replyLabel, { color: t.text }]}>Yanıtın:</Text>
                <Text style={[st.replyText, { color: t.textSecondary }]}>{r.reply}</Text>
              </View>
            ) : replyingTo === r.id ? (
              <View style={st.replyInputBox}>
                <Input
                  style={st.replyInput}
                  value={replyText}
                  onChangeText={setReplyText}
                  placeholder="Yanıtını yaz..."
                  accessibilityLabel="Yanıtın"
                  multiline
                  textAlignVertical="top"
                />
                <View style={st.replyActions}>
                  <Button label="İptal" variant="outline" onPress={() => { setReplyingTo(null); setReplyText(''); }} />
                  <Button label="Gönder" onPress={() => submitReply(r.id)} />
                </View>
              </View>
            ) : (
              <Button label="Yanıtla" variant="outline" onPress={() => { setReplyingTo(r.id); setReplyText(''); }} />
            )}
          </View>
        ))}

        <View style={st.bottomSpace} />
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, gap: 10 },
  bottomSpace: { height: 20 },

  summaryCard: { flexDirection: 'row', borderRadius: 16, padding: 14, gap: 20 },
  summaryLeft: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  avgRating: { fontSize: 40, lineHeight: 48, fontFamily: fonts.display, letterSpacing: -0.8 },
  totalReviews: { fontSize: 12, fontFamily: fonts.semibold },
  summaryRight: { flex: 1, minWidth: 0, gap: 4, justifyContent: 'center' },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  distLabel: { width: 10, fontSize: 12, fontFamily: fonts.bold, textAlign: 'right' },
  distBarBg: { flex: 1, height: 6, borderRadius: 3 },
  distBarFill: { height: 6, borderRadius: 3 },
  distCount: { width: 18, fontSize: 12, fontFamily: fonts.regular, textAlign: 'right' },

  starsRow: { flexDirection: 'row', gap: 1 },

  empty: { alignItems: 'center', paddingTop: 32, paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 18, fontFamily: fonts.display },
  emptySub: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, textAlign: 'center' },

  reviewCard: { borderRadius: 16, padding: 14, gap: 10 },
  reviewTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  customerAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  customerInitial: { fontSize: 16, fontFamily: fonts.bold },
  reviewInfo: { flex: 1, minWidth: 0, gap: 2 },
  customerName: { fontSize: 14, fontFamily: fonts.bold },
  reviewDate: { fontSize: 12, fontFamily: fonts.regular },
  reviewComment: { fontSize: 13, lineHeight: 19, fontFamily: fonts.regular },
  reviewItems: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reviewItemsText: { flexShrink: 1, fontSize: 12, fontFamily: fonts.regular },

  replyBox: { borderRadius: 12, padding: 12 },
  replyLabel: { fontSize: 12, fontFamily: fonts.bold, marginBottom: 4 },
  replyText: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular },

  replyInputBox: { gap: 8 },
  replyInput: { minHeight: 60, paddingVertical: 10 },
  replyActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
});
