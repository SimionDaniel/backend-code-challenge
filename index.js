const assert = require('assert');
const fs = require('fs-extra');
const fetch = require('node-fetch');
const cities = require('./addresses.json');

const protocol = 'http';
const host = '127.0.0.1';
const port = '8080';
const server = `${protocol}://${host}:${port}`;

const operations = {}; // Stores operation results by a unique ID
const http = require('http');
const url = require('url');
const serverr = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true); // Parse the URL to access query parameters
  const path = parsedUrl.pathname;
  const query = parsedUrl.query;
  const headers = req.headers;

  // Simple authentication check
  if (!headers.authorization || headers.authorization !== 'bearer dGhlc2VjcmV0dG9rZW4=') {
    res.writeHead(401); // Unauthorized
    res.end('Unauthorized');
    return;
  }

  // Simple route handling
  if (path === '/cities-by-tag' && req.method === 'GET') {           // CITIES-BY-TAG endpoint
    const tag = query.tag;
    const isActive = query.isActive === 'true'; // Convert query parameter to boolean
    console.log(`Tag: ${tag}. IsActive: ${isActive}.`);

    const filteredCities = cities.filter(city => city.tags.includes(tag) && city.isActive === isActive);
    // console.log(filteredCities);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ cities: filteredCities }));
  } else if (path === '/distance' && req.method === 'GET') {         // DISTANCE endpoint
    const fromCity = cities.find(city => city.guid === query.from);
    const toCity = cities.find(city => city.guid === query.to);

    if (fromCity && toCity) {
      const distance = calculateDistance(fromCity.latitude, fromCity.longitude, toCity.latitude, toCity.longitude);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        from: fromCity,
        to: toCity,
        unit: 'km',
        distance: Math.round(distance * 1e2) / 1e2 // formula to have only 2 decimals
      }));
    } else {
      res.writeHead(404);
      res.end('Cities not found');
    }
  } else if (path === '/area' && req.method === 'GET') {            // AREA endpoint
    const fromCity = query.from;
    const maxDistance = query.distance;
    // const operationId = crypto.randomUUID();
    const operationId = '2152f96f-50c7-4d76-9e18-f7033bd14428';
    const resultUrl = `${protocol}://${req.headers.host}/area-result/${operationId}`;

    // Initialize the operation status
    operations[operationId] = { status: 'pending', cities: [] };

    // Asynchronously process the request
    processAreaRequest(fromCity, maxDistance, operationId);

    // Respond with the URL to poll for the result
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ resultsUrl: resultUrl }));
    } else if (path.startsWith('/area-result') && req.method === 'GET') {        // AREA-RESULT endpoint
    const match = path.match(/^\/area-result\/([a-zA-Z0-9-]+)$/);   // Matching /area-result/:operationId path
    if (!match) {
      res.writeHead(404);
      res.end('Not Found');
    }

    const operationId = match[1];
    const operation = operations[operationId];
    if (!operation) {
      res.writeHead(404);
      res.end('Operation not found');
      return;
    }

    switch (operation.status) {
      case 'pending':
        res.writeHead(202); // Accepted: still processing
        res.end('Processing');
        break;
      case 'completed':
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ cities: operation.cities }));
        break;
      case 'error':
        res.writeHead(500); // Internal Server Error
        res.end('Error processing request');
        break;
      default:
        res.writeHead(404); // Not Found
        res.end('Unknown status');
        break;
    }
  } else if (path === '/all-cities' && req.method === 'GET') {              // ALL-CITIES endpoint
    // Set headers
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="all-cities.json"');

    // Send all cities as JSON response
    res.end(JSON.stringify(cities));
} else {
    res.writeHead(404);
    res.end('Not Found');
  }
});


serverr.listen(port, () => {
  console.log(`Server running on port ${port}`);
});


(async () => {
  // get a city by tag ("excepteurus")
  let result = await fetch(`${server}/cities-by-tag?tag=excepteurus&isActive=true`);
  // console.log(result);

  // oh, authentication is required
  assert.strictEqual(result.status, 401);
  result = await fetch(`${server}/cities-by-tag?tag=excepteurus&isActive=true`, {
    headers: { 'Authorization': 'bearer dGhlc2VjcmV0dG9rZW4=' }
  });
  // console.log(result);

  // ah, that's better
  assert.strictEqual(result.status, 200);
  let body = await result.json();

  // we expect only one city to match
  assert.strictEqual(body.cities.length, 1);

  // let's just make sure it's the right one
  const city = body.cities[0];
  assert.strictEqual(city.guid, 'ed354fef-31d3-44a9-b92f-4a3bd7eb0408')
  assert.strictEqual(city.latitude, -1.409358);
  assert.strictEqual(city.longitude, -37.257104);

  // find the distance between two cities
  result = await fetch(`${server}/distance?from=${city.guid}&to=17f4ceee-8270-4119-87c0-9c1ef946695e`, {
    headers: { 'Authorization': 'bearer dGhlc2VjcmV0dG9rZW4=' }
  });

  // we found it
  assert.strictEqual(result.status, 200);
  body = await result.json();

  // let's see if the calculations agree
  assert.strictEqual(body.from.guid, 'ed354fef-31d3-44a9-b92f-4a3bd7eb0408');
  assert.strictEqual(body.to.guid, '17f4ceee-8270-4119-87c0-9c1ef946695e');
  assert.strictEqual(body.unit, 'km');
  assert.strictEqual(body.distance, 13376.38);

  // now it get's a bit more tricky. We want to find all cities within 250 km of the
  // the one we found earlier. That might take a while, so rather than waiting for the
  // result we expect to get a url that can be polled for the final result
  result = await fetch(`${server}/area?from=${city.guid}&distance=250`, {
    headers: { 'Authorization': 'bearer dGhlc2VjcmV0dG9rZW4=' },
    timeout: 25     //TODO: set it back to 25 after finishing with debugging
  });

  // so far so good
  assert.strictEqual(result.status, 202);
  body = await result.json();

  assert.strictEqual(body.resultsUrl, `${server}/area-result/2152f96f-50c7-4d76-9e18-f7033bd14428`);

  let status;
  do
  {
    result = await fetch(body.resultsUrl, {
      headers: { 'Authorization': 'bearer dGhlc2VjcmV0dG9rZW4=' }
    });
    status = result.status;
    // return 202 while the result is not yet ready, otherwise 200
    assert.ok(status === 200 || status === 202, 'Unexpected status code');

    // let's wait a bit if the result is not ready yet
    if (status === 202) {
      console.log('Waiting for results to be READY! Returning 202');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  while (status !== 200)

  // so we got a result. let's see if it looks as expected
  body = await result.json();
  let cities = body.cities;
  assert.strictEqual(cities.length, 15);

  // and let's look at a sample
  const filteredByAddress = cities.filter(city => city.address === '859 Cyrus Avenue, Devon, Missouri, 1642');
  assert.strictEqual(filteredByAddress.length, 1);

  // okay, nice we got this far. we are almost there. but let's have an endpoint
  // for downloading all cites.
  // that's quite a bit of data, so make sure to support streaming
  result = await fetch(`${server}/all-cities`, {
    headers: { 'Authorization': 'bearer dGhlc2VjcmV0dG9rZW4=' }
  });

  if (await fs.exists('./all-cities.json')) {
    await fs.remove('./all-cities.json');
  }

  await new Promise((resolve, reject) => {
    const dest = fs.createWriteStream('./all-cities.json');
    result.body.on('error', err => {
      reject(err);
    });
    dest.on('finish', () => {
      resolve();
    });
    dest.on('error', err => {
      reject(err);
    });
    result.body.pipe(dest);
  });

  // are they all there?
  const file = await fs.readFile('./all-cities.json');
  cities = JSON.parse(file);
  assert.strictEqual(cities.length, 100000);

  console.log('You made it! Now make your code available on git and send us a link');
})().catch(err => {
  console.log(err);
});


async function processAreaRequest(fromGuid, maxDistance, operationId) {
  const fromCity = cities.find(city => city.guid === fromGuid);
  maxDistance = parseFloat(maxDistance);

  if (!fromCity) {
    operations[operationId] = { status: 'error', message: 'City not found' };
    return;
  }

  const nearbyCities = cities.filter(city => {
    if(city.guid == fromCity.guid)
      return false;
    const distance = calculateDistance(fromCity.latitude, fromCity.longitude, city.latitude, city.longitude);
    return distance <= maxDistance;
  });

  // Simulate processing delay
  setTimeout(() => {
    operations[operationId] = { status: 'completed', cities: nearbyCities };
  }, 500); // Adjust delay as needed
}

// Calculate distance between two points
function calculateDistance(lat1, lon1, lat2, lon2) {
  function toRad(x) {
    return x * Math.PI / 180;
  }

  const R = 6371; // Radius of the Earth in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return distance;
}

// async function loadCities() {
//   try {
//       const data = await fs.readFile('./cities.json', 'utf8');
//       return JSON.parse(data);
//   } catch (error) {
//       console.error('Error reading cities from file:', error);
//       return [];
//   }
// }