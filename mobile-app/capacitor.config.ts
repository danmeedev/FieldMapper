import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fieldmapper.app',
  appName: 'Field Mapper',
  webDir: 'src',
  server: {
    // Persisted IndexedDB is tied to this origin; changes require a data migration.
    hostname: 'localhost',
    androidScheme: 'https',
    allowNavigation: [
      'basemap.nationalmap.gov',
      'services.arcgisonline.com',
      'gis.blm.gov',
      'carto.nationalmap.gov',
      'api.open-meteo.com',
      'epqs.nationalmap.gov'
    ]
  },
  plugins: {
    KeepAwake: {},
    Geolocation: {},
    Camera: {}
  },
  android: {
    allowMixedContent: true
  }
};

export default config;
