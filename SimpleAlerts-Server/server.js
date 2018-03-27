//-- SHOUTOUT BallistyxStreams: YOU DA BOMB --//
require('dotenv').config();
const express = require('express');
const twitch = require('./twitch/twitch');
const db = require('./database/db');
const apiBase = '/api/v1/';
const https = require('https');
const bodyParser = require('body-parser');
const session = require('express-session');
const server = express();
var sessionProps = {
  secret: process.env.COOKIE_SECRET,
  cookie: {},
  resave: false,
  saveUninitialized: false
};

// Body Parser //
server.use(bodyParser.json());

if (process.env.NODE_ENV === 'production') {
  server.set('trust prozy', 1);
  sessionProps.cookie.secure = true;
}

// Session Manager //
server.use(session(sessionProps));

// PROPS TO: https://stackoverflow.com/questions/18310394/no-access-control-allow-origin-node-apache-port-issue //
server.use(function(req, res, next) {
  // Website you wish to allow to connect
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Request methods you wish to allow
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, OPTIONS, PUT, PATCH, DELETE'
  );

  // Request headers you wish to allow
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-Requested-With,content-type'
  );

  // Set to true if you need the website to include cookies in the requests sent
  // to the API (e.g. in case you use sessions)
  res.setHeader('Access-Control-Allow-Credentials', true);

  // Pass to next layer of middleware
  next();
});

server.listen(8000, () => {
  console.log('Server started on port: 8000');
});

// -- Routes -- //
server.get('/', (request, response) => {
  response.send('Hit /');
});

// Twitch Token Request //
server.post(apiBase + 'twitch/token', async (request, response) => {
  //-- User property --//
  var user = null;

  // Use code from client to request token //
  var authCode = request.body.code;

  // Given code, need to get auth token for requests //
  var token = await twitch.getAuthToken(authCode);

  // User just logged back in, lets find out who they are //
  var userJson = await twitch.getUserInfo(token);

  if (process.env.NODE_ENV === 'dev') {
    console.log('In dev env. Using other user ID.');
    // Use Dr. Disrespect's Twitch ID to hook into followers/subs //
    userJson.userID = process.env.TEST_TWITCH_ID;
  }

  // After login, store auth token & userID in cookie session //
  var currentSession = request.session;
  currentSession.token = token;

  // Check to see if user is part of SimpleAlerts //
  user = await db.findUser(userJson.userID);

  // If no user object is returned, create new user in DB //
  if (user === null) {
    // Create new user in db //
    user = await db.addNewUser(userJson, token);
  }

  // If user is live, setup webhook //
  var stream = await twitch.getStreamStatus(user);
  if (stream.type === 'live' || stream.type === 'vodcast') {
    console.log('User live, lets setup follower webhook.');
    twitch.initFollowerWebhook(user, token);
  }

  twitch.initStreamStatusWebhook(user, token);
  //twitch.setupPubSub(token);

  // Send data to client //
  response.send(user);
});

// Twitch Follower Webhook //
server.all('/hook/follower/:id', (request, response) => {
  console.log('Twitch Follower Webhook.');

  if (request.method === 'GET') {
    if (request.query['hub.mode'] === 'denied') {
      console.log('Follow Webhook Denied.');
      console.log(request.query['hub.reason']);
    } else {
      console.log('Follow Webhook Accepted. Returning challenge...');
      response.status(200, { 'Content-Type': 'text/plain' });
      response.end(request.query['hub.challenge']);
    }
  }

  if (request.method === 'POST') {
    console.log('New Follower!');
    console.log(request.body.data);
    response.status(200);
  }
});

// Twitch Stream Up/Down Webhook //
server.all('/hook/stream/status/:id', async (request, response) => {
  console.log('Twitch Stream Up/Down Webhook.');

  // Get user id param //
  var userID = request.params.id;
  // Get user from DB //
  var user = await db.findUser(userID);
  // Get Oauth Token from session cookie //
  var token = request.session.token;

  if (request.method === 'GET') {
    if (request.query['hub.mode'] === 'denied') {
      console.log('Twitch Stream Up/Down Webhook Denied.');
      console.log(request.query['hub.reason']);
    } else {
      console.log(
        'Twitch Stream Up/Down Webhook Accepted. Returning challenge...'
      );
      response.status(200, { 'Content-Type': 'text/plain' });
      response.end(request.query['hub.challenge']);
    }
  }

  if (request.method === 'POST') {
    console.log('Stream Status Change.');

    var data = request.body.data[0];
    console.log(data);

    if (data.length > 0) {
      console.log('Stream up. Subscribing to Follow Hook...');

      twitch.initFollowerWebhook(user, token);
    } else {
      console.log('Stream down.');
    }

    response.status(200);
  }
});
