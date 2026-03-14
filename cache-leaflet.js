// Downloads Leaflet library files for offline use
// Run this once while you have internet: node cache-leaflet.js

const https = require('https');
const fs = require('fs');
const path = require('path');

const files = [
  {
    url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    dest: 'public/lib/leaflet.js'
  },
  {
    url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    dest: 'public/lib/leaflet.css'
  },
  {
    url: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    dest: 'public/lib/images/marker-icon.png'
  },
  {
    url: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    dest: 'public/lib/images/marker-icon-2x.png'
  },
  {
    url: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    dest: 'public/lib/images/marker-shadow.png'
  },
  {
    url: 'https://unpkg.com/leaflet@1.9.4/dist/images/layers.png',
    dest: 'public/lib/images/layers.png'
  },
  {
    url: 'https://unpkg.com/leaflet@1.9.4/dist/images/layers-2x.png',
    dest: 'public/lib/images/layers-2x.png'
  }
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(path.join(__dirname, dest));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const fullDest = path.join(__dirname, dest);

    // Follow redirects
    function doRequest(reqUrl) {
      https.get(reqUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doRequest(res.headers.location);
          return;
        }
        const file = fs.createWriteStream(fullDest);
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log(`  Downloaded: ${dest}`);
          resolve();
        });
      }).on('error', reject);
    }

    doRequest(url);
  });
}

async function main() {
  console.log('Downloading Leaflet for offline use...\n');
  for (const f of files) {
    await download(f.url, f.dest);
  }
  console.log('\nDone! Now update index.html to use local Leaflet files.');
  console.log('Change the leaflet CSS/JS links from unpkg.com to /lib/leaflet.css and /lib/leaflet.js');
}

main().catch(console.error);
