import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { FUNNEL_EXTRAS, funnelIsEmpty, funnelSteps, type FunnelRow } from '@/lib/analytics-core';
import { adminFetchFunnel } from '@/lib/db';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';
import { LogoLoader } from '@/components/shared/Logo';

const PERIODS = [7, 30] as const;

export default function AdminFunnelScreen() {
  const { colors: t } = useTheme();
  const [days, setDays] = useState<number>(7);
  const [rows, setRows] = useState<FunnelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setRows(await adminFetchFunnel(days));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const steps = funnelSteps(rows);

  return (
    <View style={[s.safe, { backgroundColor: t.background }]}>
      <TopBar title="Kullanım hunisi" subtitle={`Son ${days} gün`} back />
      <View style={s.chips}>
        {PERIODS.map(period => {
          const on = days === period;
          return (
            <Pressable
              key={period}
              style={[s.chip, { backgroundColor: on ? t.brand : t.surface }]}
              hitSlop={2}
              onPress={() => setDays(period)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text style={[s.chipText, { color: on ? t.onBrand : t.text }]}>{period} gün</Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={s.center}><LogoLoader /></View>
      ) : failed ? (
        <View style={s.center}>
          <Text style={[s.emptyText, { color: t.textSecondary }]}>Huni açılamadı.</Text>
          <Button label="Tekrar dene" onPress={load} />
        </View>
      ) : funnelIsEmpty(rows) ? (
        <View style={s.center}>
          <Ionicons name="funnel-outline" size={44} color={t.textMuted} />
          <Text style={[s.emptyTitle, { color: t.heading }]}>Henüz ölçüm yok</Text>
          <Text style={[s.emptyText, { color: t.textSecondary }]}>
            Son {days} günde kaydedilmiş müşteri oturumu yok. Uygulama kullanıldıkça burada görünür.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.list} showsVerticalScrollIndicator={false}>
          <View style={[s.card, { backgroundColor: t.surface }]}>
            {steps.map(step => (
              <View
                key={step.name}
                style={s.step}
                accessible
                accessibilityLabel={`${step.label}: ${step.sessions} oturum${step.dropOffPercent === null ? '' : `, önceki adımdan yüzde ${step.dropOffPercent} kayıp`}`}
              >
                <View style={s.stepHead}>
                  <Text style={[s.stepLabel, { color: t.text }]} numberOfLines={1}>{step.label}</Text>
                  <Text style={[s.stepCount, { color: t.text }]}>{step.sessions}</Text>
                </View>
                <View style={[s.track, { backgroundColor: t.background }]}>
                  <View style={[s.fill, { width: `${step.widthPercent}%`, backgroundColor: t.brand }]} />
                </View>
                {step.dropOffPercent !== null ? (
                  <Text style={[s.drop, { color: t.textSecondary }]}>Önceki adımdan %{step.dropOffPercent} kayıp</Text>
                ) : null}
              </View>
            ))}
          </View>

          <View style={[s.card, { backgroundColor: t.surface }]}>
            {FUNNEL_EXTRAS.map((extra, i) => (
              <View key={extra.name} style={[s.extra, i < FUNNEL_EXTRAS.length - 1 && { borderBottomWidth: 1, borderBottomColor: t.divider }]}>
                <Text style={[s.extraLabel, { color: t.textSecondary }]}>{extra.label}</Text>
                <Text style={[s.extraCount, { color: t.text }]}>{Number(rows.find(r => r.step === extra.name)?.sessions ?? 0)}</Text>
              </View>
            ))}
          </View>

          <Text style={[s.note, { color: t.textSecondary }]}>
            Her sayı o adımı en az bir kez gören oturumdur; oturum uygulama her açıldığında yenilenir. Satıcı ve yönetici oturumları sayılmaz.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  chips: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  chip: { height: 40, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 13, fontFamily: fonts.bold },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  emptyTitle: { fontSize: 18, fontFamily: fonts.display },
  emptyText: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, textAlign: 'center' },
  list: { padding: 16, gap: 10 },
  card: { borderRadius: 16, padding: 14, gap: 14 },
  step: { gap: 6 },
  stepHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  stepLabel: { flexShrink: 1, fontSize: 14, fontFamily: fonts.semibold },
  stepCount: { fontSize: 16, fontFamily: fonts.extrabold },
  track: { height: 10, borderRadius: 5, overflow: 'hidden' },
  fill: { height: 10, borderRadius: 5 },
  drop: { fontSize: 12, fontFamily: fonts.regular },
  extra: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 36, paddingBottom: 10 },
  extraLabel: { flexShrink: 1, fontSize: 14, fontFamily: fonts.regular },
  extraCount: { fontSize: 14, fontFamily: fonts.bold },
  note: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular, paddingHorizontal: 4 },
});
