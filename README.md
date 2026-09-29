<h1>DiscGit oAuth Stars System</h1>
This is an app where you can monitor stars earning on your repository in Github. When someone gives a star to the repository, he automatically earns a role in the server that is spesified in the config file. Also when someone removed a star, he automatically loses his role. It has a build in Mongo Database which saves and merges the data from the Discord and Github oAuth that are saves to the Database.

<h2>Setup</h2>

1. Requires Node.js 20.19 or newer. Run `yarn install`.
2. Copy `config.js.example` to `config.js` and fill in the values.
3. In the Discord developer portal, enable the **Server Members** and **Message Content** privileged intents for the bot.
4. In the GitHub repository, add a webhook (Settings > Webhooks) pointing to `<hostname>github`, select the **Stars** event, and set its secret to the same value as `github_webhook_secret`.
5. Run `yarn start`.
