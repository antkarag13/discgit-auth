const mongoose = require("mongoose");

const profileSchema = mongoose.Schema({
    githubUser: String,
    githubid: String,
    discordUser: String,
    discordid: String,
    githubData: Object,
    discordData: Object
})

module.exports = mongoose.model("Users", profileSchema);