const express = require('express'),
  session = require('express-session'),
  passport = require('passport'),
  GitHubStrategy = require('passport-github').Strategy,
  DiscordStrategy = require("passport-discord").Strategy,
  mongoose = require('mongoose'),
  { Client, Intents, MessageEmbed } = require('discord.js'),
  bodyParser = require('body-parser'),
  app = express(),
  client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MEMBERS] }),
  Users = require('./models/Users'),
  config = require('./config');

let githubData = [];
let discordData = [];

/* Session Info */
app.use(session({
  secret: config.passport_secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    maxAge: 1000,
  },
})
);

app.use(passport.initialize());
app.use(passport.session());
app.use(bodyParser.urlencoded({ extended: false }))

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
app.get('/logout', checkAuthGithub, checkAuthDiscord, (req, res) => {
  req.logOut();
  res.redirect('/');
});

// Auth
app.get('/auth/github', checkAuthDiscord, passport.authenticate('github'));
app.get("/auth/discord", passport.authenticate("discord", { scope: ["identify", "email"] }));

// Check Auth
app.get('/auth/discord', checkAuthDiscord);
app.get('/auth/github', checkAuthGithub);

/* Callbacks */
app.get("/auth/discord/callback", passport.authenticate("discord", { failureRedirect: "/login" }), (req, res) => {
  discordData.push(req.user)
  res.redirect("/auth/github");
});
app.get("/auth/github/callback", passport.authenticate("github", { failureRedirect: "/login" }), async (req, res) => {
  githubData.push(req.user._json);
  const targetData = await Users.findOne({ githubid: githubData[0].id });
  if (!targetData) {
    const newUsers = new Users({
      _id: mongoose.Types.ObjectId(),
      githubUser: githubData[0].login,
      githubid: githubData[0].id,
      discordUser: discordData[0].username,
      discordid: discordData[0].id,
      githubData: githubData[0],
      discordData: discordData[0]
    })
    newUsers.save()
  }
  discordData = [];
  githubData = [];
  res.redirect('/');
});

/* Route that receives a POST request */
app.post('/github', async (req, res) => {
  const payload = JSON.parse(req.body.payload);
  const action = payload.action;

  const userData = await Users.findOne({ githubid: `${payload.sender.id}` });
  if (userData) {
    if (action == 'deleted') {
      const guild = client.guilds.cache.get(config.guild_id);
      const member = guild.members.cache.get(userData.discordid);

      if (member.roles.cache.has(config.role_id)) member.roles.remove(config.role_id);
    } else if (action == 'created') {
      const guild = client.guilds.cache.get(config.guild_id);
      const member = guild.members.cache.get(userData.discordid);

      if (!member.roles.cache.has(config.role_id)) member.roles.add(config.role_id);
    }
  }

  res.set('Content-Type', 'text/plain')
  res.send(`Received`)
})

/* Client Ready */
client.on("ready", () => {
  console.log("===");
  console.log(`Info: Make sure you have added the following url to the discord's OAuth callback url section in the developer portal:\nCallback URL: ${config.hostname}auth/discord/callback\n\nDeveloper Portal: https://discord.com/developers/applications/${client.user.id}/oauth2`);
  console.log("===");
  console.log(`${client.user.tag} is up and running!`)
})

/* Client Message */
client.on("message", message => {
  if (message.content === "connect") {
    const embed = new MessageEmbed()
      .setDescription(`[Click here!](${config.hostname})`)

    message.channel.send(embed);
  }
})

// Mongoose Connect
mongoose.connect(config.mongodb, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log("Connected to the Mongodb database.");
}).catch((err) => {
  console.log("Unable to connect to the Mongodb database. Error:" + err);
});

// Listen Server
app.listen(config.port ? config.port : 4000, () => console.log(`Server is up and running on port ${config.port ? config.port : 4000}`));

// Client Login
client.login(config.token)