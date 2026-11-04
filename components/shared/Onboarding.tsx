import { useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ImageSourcePropType,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Logo } from '@/components/shared/Logo';
import { fonts } from '@/lib/fonts';
import { ONBOARDING_IMAGES } from '@/lib/food-images';
import { useTheme } from '@/lib/theme-context';

const STORAGE_KEY = '@evinden_onboarding_done';

/** Telefonda yazı alanı için ayrılan yükseklik: iki satır başlık ve üç satır metin */
const TEXT_BLOCK = 176;
const PLATE_MAX = 300;
const PLATE_MIN = 120;

type Slide = { id: string; image: ImageSourcePropType; title: string; subtitle: string };

const SLIDES: Slide[] = [
  {
    id: '1',
    image: ONBOARDING_IMAGES.slide1,
    title: 'Evden eve lezzet.',
    subtitle: 'Mahallendeki restoranların yemeği bir dokunuş uzağında.',
  },
  {
    id: '2',
    image: ONBOARDING_IMAGES.slide2,
    title: 'Yakınındaki restoranlar',
    subtitle: 'Sana teslimat yapan restoranları gör, menüye bak, siparişini ver.',
  },
  {
    id: '3',
    image: ONBOARDING_IMAGES.slide3,
    title: 'Yemeğin yola çıktı, sofrayı kur.',
    subtitle: 'Siparişin nerede, adım adım izle.',
  },
  {
    id: '4',
    image: ONBOARDING_IMAGES.slide4,
    title: 'Sen de restoranını ekle',
    subtitle: 'Menünü ekle, siparişlerini al, kazancını panelinden izle.',
  },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const { colors: t } = useTheme();
  const insets = useSafeAreaInsets();
  const dims = useWindowDimensions();
  const SCREEN_W = Math.min(dims.width, 480);
  const flatListRef = useRef<FlatList>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [listHeight, setListHeight] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Küçük ekranda tabak küçülür, yazı ve düğmeler sığar.
  const plate = Math.max(PLATE_MIN, Math.min(PLATE_MAX, SCREEN_W - 40, listHeight - TEXT_BLOCK - 16));
  const headlineSize = dims.height < 700 ? 34 : 42;

  const goNext = () => {
    if (currentIndex < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1, animated: true });
      setCurrentIndex(currentIndex + 1);
    } else {
      finish();
    }
  };

  const finish = async () => {
    await AsyncStorage.setItem(STORAGE_KEY, 'true');
    Animated.timing(fadeAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start(onDone);
  };

  const renderSlide = ({ item }: { item: Slide }) => (
    <View style={{ width: SCREEN_W, height: listHeight }}>
      <View style={st.plateWrap}>
        <Image
          source={item.image}
          style={{ width: plate, height: plate, borderRadius: plate / 2 }}
          resizeMode="cover"
        />
      </View>
      <View style={st.slideText}>
        <Text
          accessibilityRole="header"
          style={[st.title, { color: t.accent, fontSize: headlineSize, lineHeight: Math.round(headlineSize * 1.1) }]}
        >
          {item.title}
        </Text>
        <Text style={[st.subtitle, { color: t.onBrand }]}>{item.subtitle}</Text>
      </View>
    </View>
  );

  return (
    <Animated.View style={[st.container, { backgroundColor: t.brand, opacity: fadeAnim }]}>
      <View
        style={[
          st.frame,
          { width: SCREEN_W, paddingTop: Math.max(insets.top + 8, 20), paddingBottom: Math.max(insets.bottom, 16) + 8 },
        ]}
      >
        <View style={st.logo}>
          <Logo size={26} tone="onBrand" inline />
        </View>

        <View style={st.list} onLayout={e => setListHeight(e.nativeEvent.layout.height)}>
          {listHeight > 0 ? (
            <FlatList
              ref={flatListRef}
              data={SLIDES}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              keyExtractor={(s) => s.id}
              renderItem={renderSlide}
              onMomentumScrollEnd={(e) => {
                const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
                setCurrentIndex(idx);
              }}
              scrollEventThrottle={16}
            />
          ) : null}
        </View>

        <View style={st.dotsRow} accessible accessibilityLabel={`Adım ${currentIndex + 1} / ${SLIDES.length}`}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={i === currentIndex ? [st.dot, st.dotActive, { backgroundColor: t.accent }] : [st.dot, st.dotIdle, { backgroundColor: t.onBrandSoft }]}
            />
          ))}
        </View>

        <View style={st.actions}>
          <Pressable style={[st.btn, { backgroundColor: t.accent }]} onPress={goNext} accessibilityRole="button">
            <Text style={[st.btnText, { color: t.onAccent }]}>
              {currentIndex === SLIDES.length - 1 ? 'Başlayalım' : 'Devam'}
            </Text>
          </Pressable>

          <Pressable style={st.skip} onPress={finish} accessibilityRole="button">
            <Text style={[st.skipText, { color: t.onBrand }]}>Giriş yapmadan bak</Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

export async function shouldShowOnboarding(): Promise<boolean> {
  const done = await AsyncStorage.getItem(STORAGE_KEY);
  return done !== 'true';
}

const st = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
  },
  frame: { flex: 1, alignSelf: 'center' },
  logo: { paddingHorizontal: 20 },
  list: { flex: 1 },

  plateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  slideText: { paddingHorizontal: 20, minHeight: TEXT_BLOCK, justifyContent: 'flex-end' },
  title: { fontFamily: fonts.display, letterSpacing: -0.6 },
  subtitle: { marginTop: 12, fontSize: 16, lineHeight: 23, fontFamily: fonts.regular },

  dotsRow: { flexDirection: 'row', gap: 6, marginVertical: 18, paddingHorizontal: 20 },
  dot: { height: 6, borderRadius: 3 },
  dotActive: { width: 24 },
  dotIdle: { width: 6, opacity: 0.4 },

  actions: { paddingHorizontal: 20 },
  btn: { height: 54, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 15, fontFamily: fonts.extrabold },
  skip: { minHeight: 44, marginTop: 6, alignItems: 'center', justifyContent: 'center' },
  skipText: { fontSize: 14, fontFamily: fonts.semibold },
});
