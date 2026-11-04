import { useEffect, useRef, useState } from 'react';
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
import { colors } from '@/constants/theme';
import { fonts } from '@/lib/fonts';
import { ONBOARDING_IMAGES } from '@/lib/food-images';

const STORAGE_KEY = '@evinden_onboarding_done';

type Slide = { id: string; image: ImageSourcePropType; title: string; subtitle: string };

const SLIDES: Slide[] = [
  {
    id: '1',
    image: ONBOARDING_IMAGES.slide1,
    title: 'Evden eve lezzet.',
    subtitle: 'Mahallendeki ev aşçılarının ve restoranların yemeği bir dokunuş uzağında.',
  },
  {
    id: '2',
    image: ONBOARDING_IMAGES.slide2,
    title: 'Yakınındaki mutfaklar',
    subtitle: 'Sana teslimat yapan mutfakları gör, menüye bak, siparişini ver.',
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
    title: 'Sen de mutfağını aç',
    subtitle: 'Ev yemeğini ya da restoran menünü sat, kazancını panelinden izle.',
  },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const dims = useWindowDimensions();
  const SCREEN_W = Math.min(dims.width, 480);
  const photoHeight = Math.round(Math.min(dims.height * 0.52, 420));
  const flatListRef = useRef<FlatList>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;

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
    <View style={[st.slide, { width: SCREEN_W }]}>
      <Image source={item.image} style={[st.photo, { width: SCREEN_W, height: photoHeight }]} resizeMode="cover" />
      <View style={st.slideText}>
        <Text style={st.title}>{item.title}</Text>
        <Text style={st.subtitle}>{item.subtitle}</Text>
      </View>
    </View>
  );

  return (
    <Animated.View style={[st.container, { opacity: fadeAnim }]}>
      <View style={[st.frame, { width: SCREEN_W }]}>
      <FlatList
        style={st.list}
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

      <Pressable style={st.skip} onPress={finish} hitSlop={12} accessibilityRole="button">
        <Text style={st.skipText}>Atla</Text>
      </Pressable>

      {/* Dots */}
      <View style={st.dotsRow}>
        {SLIDES.map((_, i) => (
          <View key={i} style={[st.dot, i === currentIndex && st.dotActive]} />
        ))}
      </View>

      {/* Button */}
      <View style={st.btnWrap}>
        <Pressable style={st.btn} onPress={goNext}>
          <Text style={st.btnText}>
            {currentIndex === SLIDES.length - 1 ? 'Başlayalım' : 'Devam'}
          </Text>
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
    backgroundColor: '#FAF8F2',
    zIndex: 100,
  },
  list: { flex: 1 },
  skip: {
    position: 'absolute',
    top: 52,
    right: 16,
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: { fontSize: 14, fontFamily: fonts.semibold, color: '#151A16' },

  slide: {},
  photo: { borderBottomLeftRadius: 26, borderBottomRightRadius: 26 },
  slideText: { paddingHorizontal: 28, paddingTop: 24, paddingBottom: 20, minHeight: 170 },
  title: {
    fontSize: 28,
    lineHeight: 33,
    fontFamily: fonts.display,
    letterSpacing: -0.6,
    color: colors.secondary,
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 16,
    color: '#56605A',
    textAlign: 'center',
    lineHeight: 23,
  },

  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 24,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#DDE1D8',
  },
  dotActive: {
    backgroundColor: colors.primary,
    width: 24,
  },

  btnWrap: { paddingHorizontal: 24, paddingBottom: 40 },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: 26,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontSize: 16, fontFamily: fonts.bold },
  frame: { flex: 1, alignSelf: 'center' },
});
