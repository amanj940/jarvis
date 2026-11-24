/**
 * WORLD CITIES — built-in dataset for the Earth globe's zoom detail.
 *
 * No new dependency and no network: ~60 capitals + megacities, so the globe
 * stays useful offline and light on a weak laptop (7.x GB RAM, laptop GPU).
 *
 * How it is used (see EarthGlobe.tsx):
 *   - Every city gets a small dot on the surface, always visible.
 *   - Text labels appear only when the camera is close enough
 *     (see CITY_LABEL_SHOW_BELOW) and only for cities on the hemisphere
 *     facing the camera, so zooming out never leaves a wall of text.
 *   - Zoom limits live here too, so the globe and the controls agree.
 */

/** One city pinned to the globe. lat -90..90, lon -180..180. */
export interface WorldCity {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
}

/** Camera distance below which city labels fade in (visible at default zoom). */
export const CITY_LABEL_SHOW_BELOW = 12.0;
/** Camera distance above which city labels fade out (hysteresis). */
export const CITY_LABEL_HIDE_ABOVE = 14.0;

/** OrbitControls limits — globe radius is 1.9, camera starts ~9.2 away. */
export const GLOBE_ZOOM_MIN_DISTANCE = 2.6;
export const GLOBE_ZOOM_MAX_DISTANCE = 16;

/**
 * Hysteresis switch for city labels: show when the camera gets closer than
 * SHOW_BELOW, hide only once it pulls back past HIDE_ABOVE, so labels never
 * flicker at the threshold.
 */
export function shouldShowCityLabels(
  cameraDistance: number,
  currentlyShown: boolean
): boolean {
  if (currentlyShown) return cameraDistance <= CITY_LABEL_HIDE_ABOVE;
  return cameraDistance < CITY_LABEL_SHOW_BELOW;
}

export const WORLD_CITIES: WorldCity[] = [
  { id: "baghdad", name: "بغداد", country: "العراق", lat: 33.31, lon: 44.36 },
  { id: "riyadh", name: "الرياض", country: "السعودية", lat: 24.71, lon: 46.68 },
  { id: "cairo", name: "القاهرة", country: "مصر", lat: 30.04, lon: 31.24 },
  { id: "dubai", name: "دبي", country: "الإمارات", lat: 25.2, lon: 55.27 },
  { id: "abu-dhabi", name: "أبوظبي", country: "الإمارات", lat: 24.45, lon: 54.38 },
  { id: "doha", name: "الدوحة", country: "قطر", lat: 25.29, lon: 51.53 },
  { id: "kuwait-city", name: "الكويت", country: "الكويت", lat: 29.38, lon: 47.98 },
  { id: "muscat", name: "مسقط", country: "عمان", lat: 23.59, lon: 58.41 },
  { id: "manama", name: "المنامة", country: "البحرين", lat: 26.22, lon: 50.58 },
  { id: "amman", name: "عمان", country: "الأردن", lat: 31.95, lon: 35.93 },
  { id: "damascus", name: "دمشق", country: "سوريا", lat: 33.51, lon: 36.29 },
  { id: "beirut", name: "بيروت", country: "لبنان", lat: 33.89, lon: 35.5 },
  { id: "jerusalem", name: "القدس", country: "فلسطين", lat: 31.77, lon: 35.21 },
  { id: "sanaa", name: "صنعاء", country: "اليمن", lat: 15.35, lon: 44.2 },
  { id: "khartoum", name: "الخرطوم", country: "السودان", lat: 15.55, lon: 32.53 },
  { id: "tripoli", name: "طرابلس", country: "ليبيا", lat: 32.88, lon: 13.19 },
  { id: "tunis", name: "تونس", country: "تونس", lat: 36.8, lon: 10.18 },
  { id: "algiers", name: "الجزائر", country: "الجزائر", lat: 36.75, lon: 3.06 },
  { id: "rabat", name: "الرباط", country: "المغرب", lat: 34.02, lon: -6.83 },
  { id: "casablanca", name: "الدار البيضاء", country: "المغرب", lat: 33.57, lon: -7.59 },
  { id: "tehran", name: "طهران", country: "إيران", lat: 35.7, lon: 51.4 },
  { id: "ankara", name: "أنقرة", country: "تركيا", lat: 39.93, lon: 32.86 },
  { id: "istanbul", name: "إسطنبول", country: "تركيا", lat: 41.01, lon: 28.98 },
  { id: "london", name: "لندن", country: "بريطانيا", lat: 51.51, lon: -0.13 },
  { id: "paris", name: "باريس", country: "فرنسا", lat: 48.86, lon: 2.35 },
  { id: "berlin", name: "برلين", country: "ألمانيا", lat: 52.52, lon: 13.41 },
  { id: "madrid", name: "مدريد", country: "إسبانيا", lat: 40.42, lon: -3.7 },
  { id: "rome", name: "روما", country: "إيطاليا", lat: 41.9, lon: 12.5 },
  { id: "amsterdam", name: "أمستردام", country: "هولندا", lat: 52.37, lon: 4.9 },
  { id: "brussels", name: "بروكسل", country: "بلجيكا", lat: 50.85, lon: 4.35 },
  { id: "vienna", name: "فيينا", country: "النمسا", lat: 48.21, lon: 16.37 },
  { id: "warsaw", name: "وارسو", country: "بولندا", lat: 52.23, lon: 21.01 },
  { id: "moscow", name: "موسكو", country: "روسيا", lat: 55.76, lon: 37.62 },
  { id: "kyiv", name: "كييف", country: "أوكرانيا", lat: 50.45, lon: 30.52 },
  { id: "stockholm", name: "ستوكهولم", country: "السويد", lat: 59.33, lon: 18.07 },
  { id: "oslo", name: "أوسلو", country: "النرويج", lat: 59.91, lon: 10.75 },
  { id: "copenhagen", name: "كوبنهاغن", country: "الدنمارك", lat: 55.68, lon: 12.57 },
  { id: "athens", name: "أثينا", country: "اليونان", lat: 37.98, lon: 23.73 },
  { id: "washington", name: "واشنطن", country: "أمريكا", lat: 38.9, lon: -77.03 },
  { id: "new-york", name: "نيويورك", country: "أمريكا", lat: 40.71, lon: -74.01 },
  { id: "los-angeles", name: "لوس أنجلوس", country: "أمريكا", lat: 34.05, lon: -118.24 },
  { id: "toronto", name: "تورونتو", country: "كندا", lat: 43.65, lon: -79.38 },
  { id: "mexico-city", name: "مكسيكو سيتي", country: "المكسيك", lat: 19.43, lon: -99.13 },
  { id: "sao-paulo", name: "ساو باولو", country: "البرازيل", lat: -23.55, lon: -46.63 },
  { id: "buenos-aires", name: "بوينس آيرس", country: "الأرجنتين", lat: -34.6, lon: -58.38 },
  { id: "tokyo", name: "طوكيو", country: "اليابان", lat: 35.68, lon: 139.69 },
  { id: "beijing", name: "بكين", country: "الصين", lat: 39.9, lon: 116.41 },
  { id: "shanghai", name: "شنغهاي", country: "الصين", lat: 31.23, lon: 121.47 },
  { id: "seoul", name: "سيول", country: "كوريا الجنوبية", lat: 37.57, lon: 126.98 },
  { id: "delhi", name: "نيودلهي", country: "الهند", lat: 28.61, lon: 77.21 },
  { id: "mumbai", name: "مومباي", country: "الهند", lat: 19.08, lon: 72.88 },
  { id: "islamabad", name: "إسلام آباد", country: "باكستان", lat: 33.68, lon: 73.04 },
  { id: "jakarta", name: "جاكرتا", country: "إندونيسيا", lat: -6.21, lon: 106.85 },
  { id: "kuala-lumpur", name: "كوالالمبور", country: "ماليزيا", lat: 3.14, lon: 101.69 },
  { id: "singapore", name: "سنغافورة", country: "سنغافورة", lat: 1.35, lon: 103.82 },
  { id: "sydney", name: "سيدني", country: "أستراليا", lat: -33.87, lon: 151.21 },
  { id: "johannesburg", name: "جوهانسبرغ", country: "جنوب أفريقيا", lat: -26.2, lon: 28.05 },
  { id: "nairobi", name: "نيروبي", country: "كينيا", lat: -1.29, lon: 36.82 },
];
