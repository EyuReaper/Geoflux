import http from 'k6/http';
import { check, sleep } from 'k6';

// This is a k6 script for load testing the Geoflux Tile Server
// To run: k6 run load-test.js

export const options = {
  stages: [
    { duration: '30s', target: 50 }, // ramp up to 50 users
    { duration: '1m', target: 50 },  // stay at 50 users
    { duration: '30s', target: 0 },  // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<200'], // 95% of requests should be below 200ms
  },
};

const DATASET_ID = '00000000-0000-0000-0000-000000000000'; // Replace with a real ID for real tests
const API_URL = __ENV.API_URL || 'http://localhost:4000';

export default function () {
  // Simulate a user panning the map (requesting a set of tiles)
  // Zoom level 10 example
  const z = 10;
  const xBase = 512;
  const yBase = 340;

  // Request 4 tiles (a small viewport)
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const x = xBase + i;
      const y = yBase + j;
      
      const res = http.get(`${API_URL}/datasets/${DATASET_ID}/tiles/${z}/${x}/${y}.pbf?min=0&max=100&cats=&search=&mode=markers`);
      
      check(res, {
        'status is 200 or 204': (r) => r.status === 200 || r.status === 204,
        'is pbf': (r) => r.status === 204 || r.headers['Content-Type'] === 'application/x-protobuf',
      });
    }
  }

  sleep(1); // Wait 1 second before the next "move"
}
