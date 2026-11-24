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
  lat: number;
  lon: number;
}

/** Camera distance below which city labels fade in. */
export const CITY_LABEL_SHOW_BELOW = 5.5;
/** Camera distance above which city labels fade out (hysteresis). */
export const CITY_LABEL_HIDE_ABOVE = 6.0;

/** OrbitControls limits — globe radius is 1.9, camera starts ~9.2 away. */
export const GLOBE_ZOOM_MIN_DISTANCE = 2.6;
export const GLOBE_ZOOM_MAX_DISTANCE = 14;

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
  { id: "tehran", name: "Tehran", lat: 35.7, lon: 51.4 },
  { id: "baghdad", name: "Baghdad", lat: 33.31, lon: 44.36 },
  { id: "dubai", name: "Dubai", lat: 25.2, lon: 55.27 },
  { id: "abu-dhabi", name: "Abu Dhabi", lat: 24.45, lon: 54.38 },
  { id: "doha", name: "Doha", lat: 25.29, lon: 51.53 },
  { id: "riyadh", name: "Riyadh", lat: 24.71, lon: 46.68 },
  { id: "jeddah", name: "Jeddah", lat: 21.49, lon: 39.19 },
  { id: "cairo", name: "Cairo", lat: 30.04, lon: 31.24 },
  { id: "istanbul", name: "Istanbul", lat: 41.01, lon: 28.98 },
  { id: "ankara", name: "Ankara", lat: 39.93, lon: 32.86 },
  { id: "beirut", name: "Beirut", lat: 33.89, lon: 35.5 },
  { id: "amman", name: "Amman", lat: 31.95, lon: 35.93 },
  { id: "jerusalem", name: "Jerusalem", lat: 31.77, lon: 35.21 },
  { id: "kuwait-city", name: "Kuwait City", lat: 29.38, lon: 47.98 },
  { id: "muscat", name: "Muscat", lat: 23.59, lon: 58.41 },
  { id: "london", name: "London", lat: 51.51, lon: -0.13 },
  { id: "paris", name: "Paris", lat: 48.86, lon: 2.35 },
  { id: "berlin", name: "Berlin", lat: 52.52, lon: 13.41 },
  { id: "madrid", name: "Madrid", lat: 40.42, lon: -3.7 },
  { id: "rome", name: "Rome", lat: 41.9, lon: 12.5 },
  { id: "amsterdam", name: "Amsterdam", lat: 52.37, lon: 4.9 },
  { id: "brussels", name: "Brussels", lat: 50.85, lon: 4.35 },
  { id: "vienna", name: "Vienna", lat: 48.21, lon: 16.37 },
  { id: "warsaw", name: "Warsaw", lat: 52.23, lon: 21.01 },
  { id: "moscow", name: "Moscow", lat: 55.76, lon: 37.62 },
  { id: "kyiv", name: "Kyiv", lat: 50.45, lon: 30.52 },
  { id: "stockholm", name: "Stockholm", lat: 59.33, lon: 18.07 },
  { id: "oslo", name: "Oslo", lat: 59.91, lon: 10.75 },
  { id: "copenhagen", name: "Copenhagen", lat: 55.68, lon: 12.57 },
  { id: "dublin", name: "Dublin", lat: 53.35, lon: -6.26 },
  { id: "lisbon", name: "Lisbon", lat: 38.72, lon: -9.14 },
  { id: "athens", name: "Athens", lat: 37.98, lon: 23.73 },
  { id: "new-york", name: "New York", lat: 40.71, lon: -74.01 },
  { id: "los-angeles", name: "Los Angeles", lat: 34.05, lon: -118.24 },
  { id: "chicago", name: "Chicago", lat: 41.88, lon: -87.63 },
  { id: "houston", name: "Houston", lat: 29.76, lon: -95.37 },
  { id: "toronto", name: "Toronto", lat: 43.65, lon: -79.38 },
  { id: "vancouver", name: "Vancouver", lat: 49.28, lon: -123.12 },
  { id: "mexico-city", name: "Mexico City", lat: 19.43, lon: -99.13 },
  { id: "sao-paulo", name: "São Paulo", lat: -23.55, lon: -46.63 },
  { id: "rio-de-janeiro", name: "Rio de Janeiro", lat: -22.91, lon: -43.17 },
  { id: "buenos-aires", name: "Buenos Aires", lat: -34.6, lon: -58.38 },
  { id: "lima", name: "Lima", lat: -12.05, lon: -77.04 },
  { id: "bogota", name: "Bogotá", lat: 4.71, lon: -74.07 },
  { id: "santiago", name: "Santiago", lat: -33.45, lon: -70.67 },
  { id: "lagos", name: "Lagos", lat: 6.52, lon: 3.38 },
  { id: "nairobi", name: "Nairobi", lat: -1.29, lon: 36.82 },
  { id: "johannesburg", name: "Johannesburg", lat: -26.2, lon: 28.05 },
  { id: "casablanca", name: "Casablanca", lat: 33.57, lon: -7.59 },
  { id: "algiers", name: "Algiers", lat: 36.75, lon: 3.06 },
  { id: "mumbai", name: "Mumbai", lat: 19.08, lon: 72.88 },
  { id: "delhi", name: "Delhi", lat: 28.61, lon: 77.21 },
  { id: "karachi", name: "Karachi", lat: 24.86, lon: 67.01 },
  { id: "lahore", name: "Lahore", lat: 31.55, lon: 74.36 },
  { id: "dhaka", name: "Dhaka", lat: 23.81, lon: 90.41 },
  { id: "bangkok", name: "Bangkok", lat: 13.76, lon: 100.5 },
  { id: "singapore", name: "Singapore", lat: 1.35, lon: 103.82 },
  { id: "jakarta", name: "Jakarta", lat: -6.21, lon: 106.85 },
  { id: "kuala-lumpur", name: "Kuala Lumpur", lat: 3.14, lon: 101.69 },
  { id: "hong-kong", name: "Hong Kong", lat: 22.32, lon: 114.17 },
  { id: "shanghai", name: "Shanghai", lat: 31.23, lon: 121.47 },
  { id: "beijing", name: "Beijing", lat: 39.9, lon: 116.41 },
  { id: "tokyo", name: "Tokyo", lat: 35.68, lon: 139.69 },
  { id: "seoul", name: "Seoul", lat: 37.57, lon: 126.98 },
  { id: "manila", name: "Manila", lat: 14.6, lon: 120.98 },
  { id: "hanoi", name: "Hanoi", lat: 21.03, lon: 105.85 },
  { id: "sydney", name: "Sydney", lat: -33.87, lon: 151.21 },
  { id: "melbourne", name: "Melbourne", lat: -37.81, lon: 144.96 },
  { id: "auckland", name: "Auckland", lat: -36.85, lon: 174.76 },
];
