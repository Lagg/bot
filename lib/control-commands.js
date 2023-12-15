// Copyright 2015+ Anthony Garcia <anthony@lagg.me>
// Simple command-to-method mapping logic similar to the ajax endpoints

var BotManager = require("./bot-manager"),
    SteamCommunity = require("steamcommunity"),
    SteamTotp = require("steam-totp"),
    SteamUser = require("steam-user"),
    Logger = require("./logger.js");

// Basic commands without prefix (e.g. help)
function Core(coreObjects) {
    this.coreObjects = coreObjects;
}

Core.prototype.help = function() {
    var terms = argsToArray(arguments);
    var commands = this.coreObjects.control.commands;
    var commandNames = Object.keys(commands);
    var commandCount = 0;

    commandNames.sort();

    for (var i = 0; i < commandNames.length; i++) {
        var commandName = commandNames[i];
        var command = commands[commandName];
        var commandMatches = terms.length == 0 || terms.filter(function(term) {
            return commandName.indexOf(term) != -1
        }).length > 0;

        if (commandMatches) {
            console.info(command.name + "\t" + command.requiredArgs + " required arguments");
            commandCount++;
        }
    }

    console.info();
    console.info(commandCount, "total");
};

Core.prototype.logReset = function() {
    Logger.close();
    console.info("Logging reset");
};

Core.prototype.quit = function() {
    var ajax = this.coreObjects.ajax;
    var ctrl = this.coreObjects.control;
    var mgr = this.coreObjects.manager;

    mgr.shutdown();

    if (ajax) {
        ajax.close();
    }

    if (ctrl) {
        ctrl.close();
    }
};

// Ajax API commands
function Api(coreObjects) {
    this.coreObjects = coreObjects;
    this.ajax = this.coreObjects.ajax;
}

Api.prototype.index = function(toggle) {
    var ajax = this.coreObjects.ajax;

    switch (toggle.toLowerCase()) {
        case "on":
            ajax.init();
            break;
        case "off":
            ajax.close();
            break;
        default:
            console.error("On or off?");
            break;
    }
};

Api.prototype.keyFlags = function(usernameOrKey) {
    var flags = argsToArray(arguments).slice(1);
    var meta = this.ajax.getApiKey(usernameOrKey);

    if (!meta) {
        console.error("No such API key");
        return;
    } else if (flags.length > 0) {
        this.ajax.updateApiKey(meta.key, flags);
        this.ajax.saveApiKeys();
    }

    console.log("Key for", meta.username, "is", meta.key, "having", meta.flags.join(", "));
};

Api.prototype.keyGen = function(username) {
    var ajax = this.coreObjects.ajax;
    var flags = argsToArray(arguments).slice(1);

    this.coreObjects.ajax.generateApiKey(username, flags, function(err, key) {
        if (err) {
            console.error("Error generating key for", username, ": ", err);
        } else {
            var keyMeta = ajax.apiKeys[key];

            console.log("Key for", keyMeta.username, "is", key, "having", keyMeta.flags.join(", "));

            ajax.saveApiKeys();
        }
    });
};

Api.prototype.keyLs = function() {
    var ajax = this.coreObjects.ajax;

    Object.keys(ajax.apiKeys).forEach(function(apiKey) {
        var meta = ajax.apiKeys[apiKey];
        console.log(apiKey, "for", meta.username, "having", meta.flags.join(", "));
    });
};

Api.prototype.keyLoad = function() {
    this.coreObjects.ajax.loadApiKeys();
};

Api.prototype.keyRm = function(usernameOrKey) {
    var meta = this.ajax.getApiKey(usernameOrKey);

    if (meta) {
        console.log("Removing", meta.key, "(" + meta.username + ")");
        this.ajax.deleteApiKey(meta.key);
        this.ajax.saveApiKeys();
    } else {
        console.log("No such user or key");
    }
};

Api.prototype.keySave = function() {
    this.coreObjects.ajax.saveApiKeys();
};

// Steam mobile auth related commands
function Authenticator(coreObjects) {
    this.coreObjects = coreObjects;
}

Authenticator.prototype.phoneAdd = function(bot, number) {
    var bot = this.coreObjects.manager.get(bot);

    if (!bot) {
        console.error("No such bot");
    } else {
        bot.addPhone(number, function(err) {
            if (err) {
                console.error("Error adding number: " + err.message);
            } else {
                console.log("Successfully connected " + number + " to " + bot.canonicalName);
            }
        });
    }
};

Authenticator.prototype.phoneFinalize = function(bot, code) {
    var managedBot = this.coreObjects.manager.get(bot);

    if (!managedBot) {
        console.warn("No such bot");
    } else {
        managedBot.verifyPhone(code, function(err) {
            if (err) {
                console.error("Verification error: " + err.message);
            } else {
                console.log(managedBot.canonicalName + " successfully verified");
            }
        });
    }
};

Authenticator.prototype.enable = function(bot) {
    var managedBot = this.coreObjects.manager.get(bot);

    if (!managedBot) {
        console.warn("No bot matching `" + bot + "` found. Try using the status command.");
    } else {
        console.info("Beginning 2fa enable on " + managedBot.canonicalName);

        managedBot._enableTwoFactor(function(err) {
            if (err) {
                console.error("Error enabling 2fa on " + managedBot.canonicalName + ": " + err.message);
            } else {
                console.info("Successfully enabled 2fa on " + managedBot.canonicalName + ". Remember to finalize.");
            }
        });
    }
};

Authenticator.prototype.finalize = function(bot, code) {
    var managedBot = this.coreObjects.manager.get(bot);

    if (!managedBot) {
        console.warn("No bot matching `" + bot + "` found. Try using the status command.");
    } else {
        console.info("Beginning 2fa finalization on " + managedBot.canonicalName);

        managedBot._finalizeTwoFactor(code, function(err) {
            if (err) {
                console.error("Error finalizing 2fa on " + managedBot.canonicalName + ": " + err.message);
            } else {
                console.info("Successfully finalized 2fa on " + managedBot.canonicalName);
            }
        });
    }
};

Authenticator.prototype.otpGen = function(bot) {
    var managedBot = this.coreObjects.manager.get(bot);

    if (!managedBot) {
        console.error("No managed bot matching " + bot + " was found");
        return;
    }

    managedBot._loadKeyData(function(err, data) {
        if (err) {
            console.error(err.message);
        } else {
            console.log(SteamTotp.generateAuthCode(data.shared_secret));
        }
    });
};

Authenticator.prototype.otpSend = function(bot, code) {
    var bot = this.coreObjects.manager.get(bot);

    if (!bot) {
        console.error("No such bot");
    } else {
        bot.sendOtp(code);
    }
};

Authenticator.prototype.resendEmail = function(bot) {
    var bot = this.coreObjects.manager.get(bot);

    if (!bot) {
        console.error("no such bot");
    } else {
        bot._user.requestValidationEmail(function(response) {
            console.log("Steam responded with code " + response);
        });
    }
};

// Bot related commands
function Bot(coreObjects) {
    this.coreObjects = coreObjects;
    this.mgr = this.coreObjects.manager;
}

Bot.prototype.add = function(username, password) {
    if (username.indexOf("7656") == 0) {
        console.log("Don't add id64s. That makes bad things happen.");
    } else {
        var bot = this.mgr.add({username: username, password: password});

        bot.connect(password, function(err) {
            if (err) {
                console.log("Error connecting " + username + ": " + err.message);
            } else {
                console.log("Connected " + username);
            }
        });
    }
};

Bot.prototype.addOffline = function() {
    var self = this;
    self.mgr.getAll().forEach(function(bot) {
        if (!bot.loggedOn) {
            self.mgr.pushPendingReconnect(bot);
        }
    });
};

Bot.prototype.checkConfirmations = function(bot) {
    var bot = this.mgr.get(bot);

    if (!bot) {
        console.warn("No such bot");
    } else {
        console.log("Pushing " + bot.fullName + " for confirmation check.");
        this.mgr.pushPendingConfirmation(bot);
    }
};

Bot.prototype.ls = function() {
    var terms = argsToArray(arguments);
    var onlineCount = 0;
    var bots = this.mgr.getAll();

    bots.filter(function(bot) {
        if (terms.length == 0) {
            return true;
        } else {
            return terms.filter(function(term) {
                var term = term.toLowerCase();
                var canonName = bot.canonicalName.toLowerCase();
                var fullName = bot.fullName.toLowerCase();

                return canonName.indexOf(term) == 0 || fullName.indexOf(term) == 0 || bot.steamId == term;
            }).length > 0;
        }
    }).forEach(function(bot) {
        var acctInfo = bot._user.accountInfo || {};
        var basicInfo = (bot.loggedOn? "ONLINE" : "OFFLINE") + ": " + bot.canonicalName;
        var emailInfo = bot._user.emailInfo;
        var vac = bot._user.vac;
        var wallet = bot._user.wallet;

        var limitInfo = Object.keys(bot._user.limitations || {})
            .filter(function(k) { return bot._user.limitations[k]; })
            .join(", ");

        var acctInfoFields = Object.keys(acctInfo).filter(function(field) {
            return acctInfo[field];
        });

        acctInfoFields.sort();

        onlineCount += bot.loggedOn;

        var info = "";

        if (bot._user.publicIP) {
            info += " " + bot._user.publicIP;
        }

        if (emailInfo) {
            info += " " + emailInfo.address + (!emailInfo.validated? " (Unvalidated)" : "");
        }

        if (wallet) {
            info += " (wallet: " + SteamUser.formatCurrency(wallet.balance, wallet.currency) + (!wallet.hasWallet? ", no wallet" : "") + ")";
        }

        if (limitInfo && limitInfo != "canInviteFriends") {
            info += " (limits: " + limitInfo + ")";
        }

        if (vac && vac.numBans > 0) {
            info += " (vac: " + vac.numBans + " in " + vac.appids.join(", ") + ")";
        }

        if (acctInfoFields.length > 0) {
            info += " (" + acctInfoFields.map(function(field) {
                return field + ": " + acctInfo[field];
            }).join(", ") + ")";
        }

        console.log(basicInfo + (info? ":" + info : ""));
    });

    console.log("\n" + "ONLINE:", onlineCount, "/", bots.length);
};

Bot.prototype.privacy = function(bot, stateName) {
    var states = SteamCommunity.PrivacyState;
    var stateId = states[stateName];
    var bot = this.mgr.get(bot);

    if (!stateId) {
        throw new Error("Privacy state must be one of " + Object.keys(states).join(", "));
    } else if (!bot) {
        throw new Error("No such bot");
    } else {
        console.info("Setting privacy to " + stateName);
    }

    bot._community.profileSettings({
        profile: stateId,
        comments: stateId,
        inventory: stateId,
        inventoryGifts: stateId == states.Public,
        gameDetails: stateId,
        playtime: stateId == states.Public
    }, function(err) {
        if (err) {
            console.error(err.message);
        } else {
            console.log("Privacy update done");
        }
    });
};

Bot.prototype.rename = function(bot, personaName) {
        var bot = this.mgr.get(bot);

        if (!bot) {
            console.error("No such bot");
        } else {
            bot.setPersona(personaName);
        }
};

Bot.prototype.rm = function(bot) {
    console.info("Removing " + bot);
    this.mgr.remove(bot);
};

Bot.prototype.steamapiKey = function(bot) {
    var bot = this.mgr.get(bot);

    if (!bot || !bot.loggedOn) {
        console.error("No such bot is online");
    } else {
        console.info("Loading key");

        bot.loadApiKey(function(err, key) {
            if (err) {
                console.error(err.message);
            } else {
                console.info(key);
            }
        });
    }
};

Bot.prototype.tradeUrl = function(bot) {
    var managedBot = this.mgr.get(bot);

    if (!managedBot || !managedBot.loggedOn) {
        console.warn("No bot matching  " + bot + " is online");
        return;
    }

    managedBot.getOfferToken(function(err, token) {
        if (err) {
            console.error("Can't fetch token for " + bot + ": " + err.message);
        } else {
            console.log("https://steamcommunity.com/tradeoffer/new?partner=" + managedBot._user.steamID.accountid + "&token=" + token);
        }
    });
};

// Trade offer related commands
function Offer(coreObjects) {
    this.coreObjects = coreObjects;
    this.mgr = this.coreObjects.manager;
}

Offer.prototype.accept = function(bot, offerId) {
    var mgr = this.mgr;
    var managedBot = mgr.get(bot);

    if (!managedBot || !managedBot.loggedOn) {
        console.error("No bot matching  " + bot + " is online");
        return;
    }

    managedBot.getOffer(offerId, function(err, offer) {
        if (err) {
            console.log("Error getting offer: " + err.message);
            return;
        }

        offer.accept(function(err, status) {
            if (err) {
                console.log("Error accepting offer: " + err.message);
                return;
            }

            console.log("Successfully accepted offer: " + status);

            mgr.pushPendingConfirmation(managedBot);
        });
    });
};

Offer.prototype.ls = function(bot) {
    var managedBot = this.mgr.get(bot);

    if (!managedBot || !managedBot.loggedOn) {
        console.error("No bot matching  " + bot + " is online");
        return;
    }

    managedBot.getActiveOffers(function(err, offers) {
        if (err) {
            console.log("Error getting offers: " + err.message);
            return;
        } else if (offers.length == 0) {
            console.log("No active offers for this bot");
            return;
        }

        Object.keys(offers).forEach(function(key) {
            var offer = offers[key];

            console.log(offer.id + ": From " + offer.partner.toString() + ": GIVING: " + offer.itemsToGive.length + ", RECEIVING: " + offer.itemsToReceive.length);
        });
    });
};

module.exports = {
    Core: Core,
    Api: Api,
    Auth: Authenticator,
    Bot: Bot,
    Offer: Offer
};

// Helpers
function argsToArray(args) {
    var arr = [];

    for (var i = 0; i < args.length; i++){
        arr.push(args[i]);
    }

    return arr;
}
