import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/Enterprise';
import type { SlaPolicy } from '@/lib/enterprise';
import { moneyTL } from '@/lib/enterprise-format';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';

// Restoran 60 dakikaya kadar hazırlık süresi seçebilir; otomatik iptal eşiği sunucuda en az 90 dakikadır.
const PRESETS = [
  { key: 'strict', label: 'Katı', reminder: 5, cancel: 20, preparation: 90 },
  { key: 'balanced', label: 'Dengeli', reminder: 10, cancel: 30, preparation: 120 },
  { key: 'flexible', label: 'Esnek', reminder: 15, cancel: 45, preparation: 180 },
] as const;

const centsText = (cents: number) => (cents / 100).toFixed(2);

export function SlaPolicyEditor({ policy, dirty, saving, onChange, onSave }: {
  policy: SlaPolicy;
  dirty: boolean;
  saving: boolean;
  onChange: (policy: SlaPolicy) => void;
  onSave: () => void;
}) {
  const { colors: t } = useTheme();
  // Ceza alanı yazılırken yeniden biçimlenmez; dışarıdan gelen değer değişince eşitlenir.
  const [penaltyText, setPenaltyText] = useState(() => centsText(policy.penalty_cents));
  useEffect(() => {
    setPenaltyText(prev => (Math.round((Number(prev.replace(',', '.')) || 0) * 100) === policy.penalty_cents ? prev : centsText(policy.penalty_cents)));
  }, [policy.penalty_cents]);
  const changePenalty = (x: string) => {
    const clean = x.replace(/[^0-9.,]/g, '');
    setPenaltyText(clean);
    const value = Number(clean.replace(',', '.'));
    if (Number.isFinite(value)) onChange({ ...policy, penalty_cents: Math.round(value * 100) });
  };
  const cancelTooEarly = policy.action === 'cancel' && policy.preparation_cancel_minutes < 90;

  return (
    <View style={[s.card, { backgroundColor: t.surface }]}>
      <View style={s.switchRow}>
        <View style={s.grow}>
          <Text style={[s.title, { color: t.text }]}>İhlal takibi</Text>
          <Text style={[s.sub, { color: t.textSecondary }]}>Kapalıyken ihlal kaydı tutulmaz. Bekleyen sipariş yine iptal süresinde iptal edilir.</Text>
        </View>
        <Switch value={policy.enabled} onValueChange={enabled => onChange({ ...policy, enabled })} trackColor={{ false: t.divider, true: t.accent }} thumbColor={t.surface} accessibilityLabel="SLA ihlal takibi" />
      </View>
      <Text style={s.label}>Hazır kural profili</Text>
      <View style={s.presets}>
        {PRESETS.map(p => <Pressable key={p.key} onPress={() => onChange({ ...policy, reminder_minutes: p.reminder, cancel_minutes: p.cancel, preparation_cancel_minutes: p.preparation })} style={[s.preset, { backgroundColor: t.background, borderColor: t.surfaceBorder }]} accessibilityRole="button"><Text style={s.presetText}>{p.label}</Text></Pressable>)}
      </View>
      <View style={s.grid}>
        <View style={s.field}><Text style={s.label}>Hatırlatma (dk)</Text><Input value={String(policy.reminder_minutes)} keyboardType="number-pad" onChangeText={x => onChange({ ...policy, reminder_minutes: Number(x.replace(/\D/g, '')) || 0 })} /></View>
        <View style={s.field}><Text style={s.label}>İptal (dk)</Text><Input value={String(policy.cancel_minutes)} keyboardType="number-pad" onChangeText={x => onChange({ ...policy, cancel_minutes: Number(x.replace(/\D/g, '')) || 0 })} /></View>
        <View style={s.field}><Text style={s.label}>Hazırlama başlangıcı (dk)</Text><Input value={String(policy.preparation_cancel_minutes)} keyboardType="number-pad" onChangeText={x => onChange({ ...policy, preparation_cancel_minutes: Number(x.replace(/\D/g, '')) || 0 })} /></View>
        <View style={s.field}><Text style={s.label}>Ceza (TL)</Text><Input value={penaltyText} keyboardType="decimal-pad" onChangeText={changePenalty} /></View>
      </View>
      <Text style={s.label}>Hazırlama gecikmesinde</Text>
      <SegmentedControl options={[{ value: 'penalty', label: 'Yalnızca kaydet' }, { value: 'cancel', label: 'Siparişi iptal et' }]} value={policy.action} onChange={action => onChange({ ...policy, action })} />
      <View style={[s.preview, { backgroundColor: t.background }]}>
        <Text style={[s.previewTitle, { color: t.heading }]}>Kural önizlemesi</Text>
        <Text style={[s.sub, { color: t.textSecondary }]}>• {policy.reminder_minutes} dakikada restorana hatırlatma gider.</Text>
        <Text style={[s.sub, { color: t.textSecondary }]}>• {policy.cancel_minutes} dakikada onaylanmazsa sipariş iptal edilir{policy.enabled ? ' ve ihlal kaydedilir' : ''}.</Text>
        <Text style={[s.sub, { color: t.textSecondary }]}>• {policy.enabled
          ? `Onaydan ${policy.preparation_cancel_minutes} dakika sonra hâlâ hazırlanmaya başlanmadıysa ${policy.action === 'cancel' ? 'sipariş iptal edilir' : 'ihlal kaydedilir'}.`
          : 'Hazırlama gecikmesi izlenmez.'}</Text>
        {policy.enabled && policy.penalty_cents > 0 ? <Text style={[s.sub, { color: t.textSecondary }]}>• İhlal başına {moneyTL(policy.penalty_cents)} ceza kaydedilir. Hakedişten kendiliğinden düşülmez.</Text> : null}
        {cancelTooEarly ? <Text style={[s.sub, { color: t.danger }]}>Otomatik iptal için hazırlama süresi en az 90 dakika olmalı.</Text> : null}
      </View>
      {dirty ? <Text accessibilityLiveRegion="polite" style={[s.dirty, { color: t.amber }]}>Kaydedilmemiş değişiklikler var.</Text> : null}
      <Button label={dirty ? 'Değişiklikleri kaydet' : 'Kural kaydedildi'} onPress={onSave} loading={saving} disabled={!dirty || cancelTooEarly} fullWidth />
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 16, padding: 14, gap: 9 }, title: { fontSize: 15, fontFamily: fonts.bold },
  sub: { fontSize: 13, lineHeight: 19, fontFamily: fonts.regular }, label: { fontSize: 12, lineHeight: 16, fontFamily: fonts.semibold, color: '#56605A' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, grow: { flex: 1 }, presets: { flexDirection: 'row', gap: 8 },
  preset: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, presetText: { fontSize: 13, fontFamily: fonts.semibold },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, field: { width: '47%', gap: 4 }, preview: { borderRadius: 12, padding: 12, gap: 5 },
  previewTitle: { fontSize: 14, fontFamily: fonts.bold }, dirty: { fontSize: 12, fontFamily: fonts.semibold },
});
