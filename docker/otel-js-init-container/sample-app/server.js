'use strict';
// Deliberately does NOT require any @opentelemetry package -- the whole
// point is to verify zero-code auto-instrumentation via the init container,
// not manual instrumentation. If NODE_OPTIONS/NODE_PATH aren't wired up by
// the init container, this app still runs fine, just uninstrumented.
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;

// One of these orders is missing its `items` array -- an easy oversight for
// a record that was created before `items` became required. Nothing here
// simulates or throws anything on purpose; `/list` just doesn't guard
// against it.
const orders = [
  { id: 1, customer: 'Acme Corp', items: [{ sku: 'A100', qty: 2 }] },
  { id: 2, customer: 'Globex', items: [{ sku: 'B200', qty: 1 }] },
  { id: 3, customer: 'Initech' },
];

function summarizeOrder(order) {
  return {
    id: order.id,
    customer: order.customer,
    itemCount: order.items.length,
  };
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'orders-api is running' });
});

// Separate from `/` so a bug in one route doesn't affect liveness/readiness
// probes.
app.get('/healthz', (req, res) => res.status(200).send('ok'));

app.get('/list', (req, res) => {
  const summaries = orders.map(summarizeOrder);
  res.json({ orders: summaries });
});

// Express 4's error-handling middleware signature (4 args) -- this is what
// @opentelemetry/instrumentation-express hooks to record the exception on
// the request span before it ever reaches here.
app.use((err, req, res, next) => {
  console.error('Request failed:', err.message);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(port, () => {
  console.log(`orders-api listening on port ${port}`);
});
