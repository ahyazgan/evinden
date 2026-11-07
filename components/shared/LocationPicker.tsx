import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SearchField, TopBar } from '@/components/shared/TopBar';
import { nearestDistrict, normalizeSavedLocation, searchDistricts, type District } from '@/lib/districts';
import { fonts } from '@/lib/fonts';
import { useResponsive } from '@/lib/responsive';
import { useTheme } from '@/lib/theme-context';

const LOCATION_KEY = '@afiyetli_user_location';

export type UserLocation = {
  district: string;
  city: string;
  latitude: number;
  longitude: number;
};

/** Konum servisi kapalı ya da uydu bulunamıyorsa kişi dönen düğmede kalmasın. */
const GPS_TIMEOUT_MS = 10_000;

export async function getSavedLocation(): Promise<UserLocation | null> {
  const raw = await AsyncStorage.getItem(LOCATION_KEY);
  if (raw) {
    try { return normalizeSavedLocation(JSON.parse(raw)); } catch {}
  }
  return null;
}

export async function saveLocation(loc: UserLocation): Promise<void> {
  await AsyncStorage.setItem(LOCATION_KEY, JSON.stringify(loc));
}

export function LocationPicker({ onDone, onClose }: { onDone: (loc: UserLocation) => void; onClose?: () => void }) {
  const { colors: t } = useTheme();
  const { isDesktop } = useResponsive();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState<UserLocation | null>(null);
  // Elle seçim yapıldıysa ya da pencere kapandıysa geç gelen cihaz konumu seçimi ezmez.
  const gpsRun = useRef(0);
  useEffect(() => () => { gpsRun.current += 1; }, []);

  // Kayıtlı bölge listede işaretli görünür.
  useEffect(() => {
    getSavedLocation().then(setCurrent).catch(() => {});
  }, []);

  const districts = useMemo(() => searchDistricts(query), [query]);
  const searching = query.trim().length > 0;

  const finish = async (loc: UserLocation) => {
    // Kaydedilemese de seçim bu oturumda geçerlidir, kişi pencerede takılı kalmaz.
    await saveLocation(loc).catch(() => undefined);
    onDone(loc);
  };

  const requestLocation = async () => {
    const run = ++gpsRun.current;
    setLoading(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (run !== gpsRun.current) return;
      if (status !== 'granted') {
        setError('Konum izni verilmedi. Aşağıdan kendin seçebilirsin.');
        setLoading(false);
        return;
      }
      const position = await Promise.race<Location.LocationObject>([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), GPS_TIMEOUT_MS)),
      ]);
      if (run !== gpsRun.current) return;
      const { latitude, longitude } = position.coords;
      // Web'de ve bazı cihazlarda adres servisi yok: ad, en yakın ilçeden alınır.
      const [geo] = await Location.reverseGeocodeAsync({ latitude, longitude }).catch(() => []);
      if (run !== gpsRun.current) return;
      const near = nearestDistrict(latitude, longitude);
      await finish({
        district: geo?.subregion || geo?.district || geo?.city || near.district,
        city: geo?.region || geo?.city || near.city,
        latitude,
        longitude,
      });
    } catch {
      if (run !== gpsRun.current) return;
      setError('Konum alınamadı. Aşağıdan kendin seçebilirsin.');
    }
    if (run === gpsRun.current) setLoading(false);
  };

  const selectManual = async (d: District) => {
    gpsRun.current += 1;
    setLoading(false);
    await finish({ district: d.district, city: d.city, latitude: d.latitude, longitude: d.longitude });
  };

  return (
    <View style={[s.container, { backgroundColor: t.background }]}>
      <View style={[s.column, isDesktop && s.columnDesktop]}>
        <TopBar title="Nereye gelsin?" subtitle="Sana teslimat yapan restoranları gösterelim." onBack={onClose} />

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

          <Text style={[s.sectionTitle, { color: t.heading }]} accessibilityRole="header">{searching ? 'Sonuçlar' : 'Popüler bölgeler'}</Text>

          {districts.map(d => {
            const selected = current?.district === d.district && current?.city === d.city;
            return (
              <Pressable
                key={`${d.district}|${d.city}`}
                style={[s.row, { backgroundColor: t.surface, borderColor: selected ? t.primary : 'transparent' }]}
                onPress={() => selectManual(d)}
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
            <Text style={[s.empty, { color: t.textSecondary }]}>Bu ilçeyi bulamadık. Yazımı kontrol et ya da en yakın ilçeyi seç.</Text>
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
