'use strict';

const express = require('express');
const path    = require('path');

const app  = express();
const PORT = 3001;

app.use(express.static(path.join(__dirname, 'public')));

// All routes serve the SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Shop Estimator running at http://localhost:${PORT}`);
});
