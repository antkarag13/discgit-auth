const express = require('express'),
  session = require('express-session'),
  passport = require('passport'),
  GitHubStrategy = require('passport-github').Strategy,
  DiscordStrategy = require("passport-discord").Strategy,
  mongoose = require('mongoose'),
  crypto = require('crypto'),
  { Client, GatewayIntentBits, EmbedBuilder, Events } = require('discord.js'),
  app = express(),
  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  }),
  Users = require('./models/Users'),
  config = require('./config');

/* Session Info */
app.use(session({
  secret: config.passport_secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    maxAge: 1000 * 60 * 60, // 1 hour
  },
})
);

app.use(passport.initialize());
app.use(passport.session());
// Keep the raw body so GitHub webhook signatures can be verified
const keepRawBody = (req, res, buf) => { req.rawBody = buf; };
app.use(express.urlencoded({ extended: false, verify: keepRawBody }));
app.use(express.json({ verify: keepRawBody }));

passport.serializeUser(function (user, cb) { cb(null, user); });
passport.deserializeUser(function (id, cb) { cb(null, id); });

// Strategies
passport.use(new GitHubStrategy({
  clientID: config.github_id,
  clientSecret: config.github_secret,
  callbackURL: `${config.hostname}auth/github/callback`,
},
  function (accessToken, refreshToken, profile, cb) { cb(null, profile); }
));
passport.use(new DiscordStrategy({
  clientID: config.client_id,
  clientSecret: config.client_secret,
  callbackURL: `${config.hostname}auth/discord/callback`,
},
  function (accessToken, refreshToken, profile, cb) { cb(null, profile); }
));

// Check Auth Functions
const checkAuthGithub = (req, res, next) => {
  if (req.user) next();
  else res.redirect('/login');
};
const checkAuthDiscord = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.redirect("/auth/discord");
};

// Main Page
app.get('/', checkAuthGithub, (req, res) => {
  res.sendFile(__dirname + '/login.html');
});

// Login Page
app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.redirect('/auth/discord');
});

// Logout
app.get('/logout', checkAuthGithub, checkAuthDiscord, (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('/');
  });
});

// Auth
app.get('/auth/github', checkAuthDiscord, passport.authenticate('github'));
app.get("/auth/discord", passport.authenticate("discord", { scope: ["identify", "email"] }));

// Check Auth
app.get('/auth/discord', checkAuthDiscord);
app.get('/auth/github', checkAuthGithub);

/* Callbacks */
app.get("/auth/discord/callback", passport.authenticate("discord", { failureRedirect: "/login" }), (req, res) => {
  // Keep the Discord profile in this user's session; the GitHub login replaces req.user
  req.session.discordData = req.user;
  res.redirect("/auth/github");
});
app.get("/auth/github/callback", passport.authenticate("github", { failureRedirect: "/login", keepSessionInfo: true }), async (req, res) => {
  const githubData = req.user._json;
  const discordData = req.session.discordData;
  if (!discordData) return res.redirect('/auth/discord');

  try {
    const targetData = await Users.findOne({ githubid: githubData.id });
    if (!targetData) {
      const newUsers = new Users({
        githubUser: githubData.login,
        githubid: githubData.id,
        discordUser: discordData.username,
        discordid: discordData.id,
        githubData: githubData,
        discordData: discordData
      })
      await newUsers.save();
    }
  } catch (err) {
    console.error("Unable to save the linked accounts:", err);
    return res.status(500).send("Unable to link your accounts, please try again.");
  }
  delete req.session.discordData;
  res.redirect('/');
});

/* Route that receives a POST request */
const verifyGithubSignature = (req) => {
  const signature = req.get('X-Hub-Signature-256');
  if (!signature || !req.rawBody) return false;

  const expected = 'sha256=' + crypto.createHmac('sha256', config.github_webhook_secret).update(req.rawBody).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

app.post('/github', async (req, res) => {
  if (!config.github_webhook_secret) return res.status(500).send('Webhook secret is not configured');
  if (!verifyGithubSignature(req)) return res.status(401).send('Invalid signature');

  res.set('Content-Type', 'text/plain');
  // Only star events change roles; anything else (e.g. ping) is acknowledged and ignored
  if (req.get('X-GitHub-Event') !== 'star') return res.send('Ignored');

  try {
    // GitHub sends either application/json or a form-encoded "payload" field
    const payload = req.body?.payload ? JSON.parse(req.body.payload) : req.body;
    const action = payload.action;

    const userData = await Users.findOne({ githubid: `${payload.sender.id}` });
    if (userData && (action == 'created' || action == 'deleted')) {
      const guild = client.guilds.cache.get(config.guild_id);
      const member = guild && await guild.members.fetch(userData.discordid).catch(() => null);

      if (member) {
        if (action == 'deleted' && member.roles.cache.has(config.role_id)) await member.roles.remove(config.role_id);
        if (action == 'created' && !member.roles.cache.has(config.role_id)) await member.roles.add(config.role_id);
      }
    }
  } catch (err) {
    console.error("Unable to handle the GitHub webhook:", err);
    return res.status(500).send('Error');
  }

  res.send(`Received`)
})

/* Client Ready */
client.once(Events.ClientReady, () => {
  console.log("===");
  console.log(`Info: Make sure you have added the following url to the discord's OAuth callback url section in the developer portal:\nCallback URL: ${config.hostname}auth/discord/callback\n\nDeveloper Portal: https://discord.com/developers/applications/${client.user.id}/oauth2`);
  console.log("===");
  console.log(`${client.user.tag} is up and running!`)
})

/* Client Message */
client.on(Events.MessageCreate, message => {
  if (message.author.bot) return;
  if (message.content === "connect") {
    const embed = new EmbedBuilder()
      .setDescription(`[Click here!](${config.hostname})`)

    message.channel.send({ embeds: [embed] });
  }
})

// Mongoose Connect
mongoose.connect(config.mongodb).then(() => {
  console.log("Connected to the Mongodb database.");
}).catch((err) => {
  console.log("Unable to connect to the Mongodb database. Error:" + err);
});

// Listen Server
app.listen(config.port ? config.port : 4000, () => console.log(`Server is up and running on port ${config.port ? config.port : 4000}`));

// Client Login
client.login(config.token).catch((err) => console.log("Unable to log in the Discord bot. Error:" + err));