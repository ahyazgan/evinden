import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SearchField, TopBar } from '@/components/shared/TopBar';
import { fonts } from '@/lib/fonts';
import { useResponsive } from '@/lib/responsive';
import { useTheme } from '@/lib/theme-context';

const LOCATION_KEY = '@evinden_user_location';

export type UserLocation = {
  district: string;
  city: string;
  latitude: number;
  longitude: number;
};

const POPULAR_DISTRICTS: { district: string; city: string }[] = [
  { district: 'Kadıköy', city: 'İstanbul' },
  { district: 'Beşiktaş', city: 'İstanbul' },
  { district: 'Üsküdar', city: 'İstanbul' },
  { district: 'Beyoğlu', city: 'İstanbul' },
  { district: 'Çankaya', city: 'Ankara' },
  { district: 'Konak', city: 'İzmir' },
  { district: 'Nilüfer', city: 'Bursa' },
  { district: 'Muratpaşa', city: 'Antalya' },
];

export async function getSavedLocation(): Promise<UserLocation | null> {
  const raw = await AsyncStorage.getItem(LOCATION_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch {}
  }
  return null;
}

export async function saveLocation(loc: UserLocation): Promise<void> {
  await AsyncStorage.setItem(LOCATION_KEY, JSON.stringify(loc));
}

export function LocationPicker({ onDone }: { onDone: (loc: UserLocation) => void }) {
  const { colors: t } = useTheme();
  const { isDesktop } = useResponsive();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState<UserLocation | null>(null);

  // Kayıtlı bölge listede işaretli görünür.
  useEffect(() => {
    getSavedLocation().then(setCurrent).catch(() => {});
  }, []);

  const districts = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr');
    if (!q) return POPULAR_DISTRICTS;
    return POPULAR_DISTRICTS.filter(d =>
      d.district.toLocaleLowerCase('tr').includes(q) || d.city.toLocaleLowerCase('tr').includes(q),
    );
  }, [query]);

  const requestLocation = async () => {
    setLoading(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Konum izni verilmedi. Aşağıdan kendin seçebilirsin.');
        setLoading(false);
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const [geo] = await Location.reverseGeocodeAsync({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      const loc: UserLocation = {
        district: geo?.subregion || geo?.district || geo?.city || 'Bilinmeyen',
        city: geo?.region || geo?.city || 'Bilinmeyen',
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      await saveLocation(loc);
      onDone(loc);
    } catch {
      setError('Konum alınamadı. Aşağıdan kendin seçebilirsin.');
    }
    setLoading(false);
  };

  const selectManual = async (district: string, city: string) => {
    const loc: UserLocation = { district, city, latitude: 0, longitude: 0 };
    await saveLocation(loc);
    onDone(loc);
  };

  return (
    <View style={[s.container, { backgroundColor: t.background }]}>
      <View style={[s.column, isDesktop && s.columnDesktop]}>
        <TopBar title="Nereye gelsin?" subtitle="Sana teslimat yapan mutfakları gösterelim." />

        <ScrollView
          style={s.scroll}
          contentContainerStyle={[s.content, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            style={[s.gpsBtn, { backgroundColor: t.accent }, loading && s.gpsBusy]}
            onPress={requestLocation}
            disabled={loading}
            accessibilityRole="button"
            accessibilityState={{ disabled: loading, busy: loading }}
          >
            {loading ? (
              <ActivityIndicator color={t.onAccent} size="small" />
            ) : (
              <>
                <Ionicons name="location-outline" size={20} color={t.onAccent} />
                <Text style={[s.gpsBtnText, { color: t.onAccent }]}>Konumumu bul</Text>
              </>
            )}
          </Pressable>

          {error ? (
            <Text style={[s.error, { color: t.danger }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          <SearchField value={query} onChangeText={setQuery} placeholder="İlçe ara" accessibilityLabel="İlçe ara" />

          <Text style={[s.sectionTitle, { color: t.heading }]} accessibilityRole="header">Popüler bölgeler</Text>

          {districts.map(d => {
            const selected = current?.district === d.district && current?.city === d.city;
            return (
              <Pressable
                key={d.district}
                style={[s.row, { backgroundColor: t.surface, borderColor: selected ? t.primary : 'transparent' }]}
                onPress={() => selectManual(d.district, d.city)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Ionicons name="location-outline" size={20} color={t.text} />
                <Text style={[s.rowText, { color: t.text }]} numberOfLines={1}>{d.district}, {d.city}</Text>
                {selected ? <Ionicons name="checkmark" size={18} color={t.text} /> : null}
              </Pressable>
            );
          })}

          {districts.length === 0 ? (
            <Text style={[s.empty, { color: t.textSecondary }]}>Bu ilçeyi listede bulamadık.</Text>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
  },
  column: { flex: 1 },
  columnDesktop: { width: '100%', maxWidth: 520, alignSelf: 'center' },
  scroll: { flex: 1 },
  content: { paddingTop: 14, paddingHorizontal: 16, gap: 10 },

  gpsBtn: { height: 52, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  gpsBusy: { opacity: 0.7 },
  gpsBtnText: { fontSize: 15, fontFamily: fonts.extrabold },

  error: { fontSize: 13, lineHeight: 18, fontFamily: fonts.semibold },

  sectionTitle: { marginTop: 6, fontSize: 16, lineHeight: 22, fontFamily: fonts.display, letterSpacing: -0.3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 14, borderRadius: 14, borderWidth: 2 },
  rowText: { flex: 1, minWidth: 0, fontSize: 14, fontFamily: fonts.semibold },
  empty: { paddingVertical: 12, fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, textAlign: 'center' },
});
