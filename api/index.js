'use strict';

/**
 * Vercel serverless entry point.
 *
 * `vercel.json` rewrites every path to this function, so the whole Express
 * app - the UI, the Monaco assets and the JSON API - is served exactly the
 * same way it is served by `npm start` locally.
 */
const { app } = require('../server/index.js');

module.exports = app;
