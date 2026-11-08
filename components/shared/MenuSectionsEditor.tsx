import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';
import { moveItem, newChoiceKey } from '@/lib/menu-choices';
import { saveMenuSections, type MenuSection } from '@/lib/db';

type Draft = { key: string; id: string | null; title: string };

const MAX_SECTIONS = 30;

/** Restoranın menü bölümleri: ekle, yeniden adlandır, sırala, sil. Kaydet tek seferde yazar. */
export function MenuSectionsEditor({ visible, sections, itemCounts, onClose, onSaved }: {
  visible: boolean;
  sections: MenuSection[];
  /** Bölümdeki ürün sayısı; silme uyarısında kullanılır */
  itemCounts: Record<string, number>;
  onClose: () => void;
  onSaved: (sections: MenuSection[]) => void;
}) {
  const { colors: t } = useTheme();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setDrafts(sections.map(sec => ({ key: sec.id, id: sec.id, title: sec.title })));
      setNewTitle('');
    }
  }, [visible, sections]);

  const add = () => {
    const title = newTitle.trim();
    if (!title) return;
    if (drafts.length >= MAX_SECTIONS) { Alert.alert('Sınır', `En fazla ${MAX_SECTIONS} bölüm açılabilir.`); return; }
    setDrafts(prev => [...prev, { key: newChoiceKey(), id: null, title }]);
    setNewTitle('');
  };

  const remove = (d: Draft) => {
    const count = d.id ? itemCounts[d.id] ?? 0 : 0;
    if (count === 0) { setDrafts(prev => prev.filter(x => x.key !== d.key)); return; }
    Alert.alert('Bölümü kaldır', `"${d.title}" bölümünde ${count} ürün var. Ürünler silinmez, "Diğer" altına geçer.`, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Kaldır', style: 'destructive', onPress: () => setDrafts(prev => prev.filter(x => x.key !== d.key)) },
    ]);
  };

  const save = async () => {
    const seen = new Set<string>();
    for (const d of drafts) {
      const title = d.title.trim();
      if (!title || title.length > 60) { Alert.alert('Bölüm adı', 'Her bölümün 1-60 karakterlik bir adı olmalı.'); return; }
      const lower = title.toLocaleLowerCase('tr-TR');
      if (seen.has(lower)) { Alert.alert('Bölüm adı', `"${title}" adında iki bölüm olamaz.`); return; }
      seen.add(lower);
    }
    setSaving(true);
    try {
      onSaved(await saveMenuSections(drafts.map(d => ({ id: d.id, title: d.title }))));
      onClose();
    } catch (e: any) {
      Alert.alert('Bölümler kaydedilemedi', e?.code === '22023' ? e.message : 'Lütfen tekrar dene.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[s.safe, { backgroundColor: t.background }]} edges={['top', 'bottom']}>
        <View style={[s.header, { borderBottomColor: t.divider }]}>
          <Pressable style={s.cancel} onPress={onClose} accessibilityRole="button">
            <Text style={[s.cancelText, { color: t.textSecondary }]}>İptal</Text>
          </Pressable>
          <Text style={[s.headerTitle, { color: t.heading }]} accessibilityRole="header">Menü bölümleri</Text>
          <Button label="Kaydet" size="sm" loading={saving} onPress={save} />
        </View>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <Text style={[s.hint, { color: t.textSecondary }]}>
            Menün müşteriye bu bölümlerle, bu sırayla görünür (Kampanyalar, Dürümler, İçecekler gibi). Bölüm açmazsan ürünler kategorilerine göre gruplanır. Bölümü olmayan ürünler sonda "Diğer" altında görünür.
          </Text>
          {drafts.length === 0 ? <Text style={[s.empty, { color: t.textSecondary }]}>Henüz bölüm yok.</Text> : null}
          {drafts.map((d, i) => (
            <View key={d.key} style={[s.row, { backgroundColor: t.surface }]}>
              <View style={s.flex}>
                <Input value={d.title} onChangeText={v => setDrafts(prev => prev.map(x => (x.key === d.key ? { ...x, title: v } : x)))} accessibilityLabel="Bölüm adı" maxLength={60} />
              </View>
              <Pressable style={s.icon} disabled={i === 0} onPress={() => setDrafts(prev => moveItem(prev, i, -1))} accessibilityRole="button" accessibilityLabel={`${d.title}: yukarı taşı`}>
                <Ionicons name="chevron-up" size={20} color={i === 0 ? t.textMuted : t.text} />
              </Pressable>
              <Pressable style={s.icon} disabled={i === drafts.length - 1} onPress={() => setDrafts(prev => moveItem(prev, i, 1))} accessibilityRole="button" accessibilityLabel={`${d.title}: aşağı taşı`}>
                <Ionicons name="chevron-down" size={20} color={i === drafts.length - 1 ? t.textMuted : t.text} />
              </Pressable>
              <Pressable style={s.icon} onPress={() => remove(d)} accessibilityRole="button" accessibilityLabel={`${d.title}: kaldır`}>
                <Ionicons name="trash-outline" size={20} color={t.danger} />
              </Pressable>
            </View>
          ))}
          <View style={s.addRow}>
            <View style={s.flex}>
              <Input value={newTitle} onChangeText={setNewTitle} placeholder="Yeni bölüm (ör: Dürümler)" maxLength={60} accessibilityLabel="Yeni bölüm adı" onSubmitEditing={add} />
            </View>
            <Pressable style={[s.addBtn, { backgroundColor: t.primary }]} onPress={add} accessibilityRole="button" accessibilityLabel="Bölüm ekle">
              <Ionicons name="add" size={22} color={t.onBrand} />
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1 },
  cancel: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  cancelText: { fontSize: 15, fontFamily: fonts.semibold },
  headerTitle: { flexShrink: 1, fontSize: 18, lineHeight: 24, fontFamily: fonts.display, letterSpacing: -0.3 },
  body: { padding: 16, paddingBottom: 40, gap: 8 },
  hint: { fontSize: 13, lineHeight: 19, fontFamily: fonts.regular, marginBottom: 8 },
  empty: { fontSize: 14, fontFamily: fonts.regular },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 12, padding: 8 },
  flex: { flex: 1, minWidth: 0 },
  icon: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  addBtn: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
