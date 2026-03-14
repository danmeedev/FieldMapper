import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fieldmapper.app',
  appName: 'Field Mapper',
  webDir: 'src',
  server: {
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
