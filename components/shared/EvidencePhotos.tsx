import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { getRefundEvidenceUrl } from '@/lib/storage';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';

/** İade talebinin fotoğrafları; gizli depodan kısa ömürlü bağlantıyla gösterilir, dokununca büyük açılır. */
export function EvidencePhotos({ paths }: { paths: string[] }) {
  const { colors: t } = useTheme();
  const [urls, setUrls] = useState<(string | null)[]>([]);
  const key = paths.join('|');

  useEffect(() => {
    let alive = true;
    const list = key ? key.split('|') : [];
    const load = () => Promise.all(list.map(p => getRefundEvidenceUrl(p).catch(() => null))).then(next => { if (alive) setUrls(next); });
    void load();
    // Bağlantılar 10 dakikada dolar; ekran açık kaldıkça yenilenir.
    const timer = list.length > 0 ? setInterval(load, 8 * 60 * 1000) : null;
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, [key]);

  if (paths.length === 0) return null;
  return (
    <View style={s.wrap}>
      <Text style={[s.label, { color: t.textSecondary }]}>Müşterinin fotoğrafları ({paths.length})</Text>
      <View style={s.row}>
        {paths.map((p, i) => {
          const url = urls[i];
          return (
            <Pressable
              key={p}
              style={[s.thumb, { backgroundColor: t.background }]}
              disabled={!url}
              // Önizleme bağlantısı 10 dakikada dolar; büyük açarken taze bağlantı alınır.
              onPress={() => { getRefundEvidenceUrl(p).then(fresh => Linking.openURL(fresh)).catch(() => url && Linking.openURL(url)); }}
              accessibilityRole="link"
              accessibilityLabel={`Fotoğraf ${i + 1}: büyük aç`}
            >
              {url ? <Image source={{ uri: url }} style={s.img} /> : <Text style={[s.label, { color: t.textMuted }]}>…</Text>}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 12, fontFamily: fonts.semibold },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumb: { width: 64, height: 64, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  img: { width: 64, height: 64 },
});
