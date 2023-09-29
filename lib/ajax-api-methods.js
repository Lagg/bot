// Copyright 2015+ Anthony Garcia <anthony@lagg.me>
// Endpoint definitions used by the Ajax server

var BotManager = require("./bot-manager"),
    Configuration = require("./configuration");

// Top-level / basic info API
function Core(callback, coreObjects) {
    this.callback = callback;
    this.botless = true;
    this.coreObjects = coreObjects;
}

Core.prototype.getStatus = function(args) {
    var self = this;
    this.callback({
        bots: self.coreObjects.manager.getAll().filter(function(bot) {
            return bot.steamId;
        }).map(function(bot) {
            return {
                name: bot.name,
                id: bot.steamId,
                online: bot.loggedOn,
                loginAt: bot.loginAt,
                webLoginAt: bot.webLoginAt
            };
        })
    });
};

// Bot-level user profile / inv / trade related API
function Bot(callback, coreObjects) {
    this.callback = callback;
    this.coreObjects = coreObjects;
}

Bot.GC_TIMEOUT = 2000;

Bot.prototype.getApiKey = function(args) {
    var self = this;

    args.bot.loadApiKey(function(err, apiKey) {
        self.coreObjects.manager.relogIfNeeded(args.bot, err, function() {
            self.callback(err || {
                bot: args.bot.steamId,
                key: apiKey
            });
        });
    });
};

Bot.prototype.getConfirmations = function(args) {
    var self = this;

    args.bot.getConfirmations(function(err, data) {
        self.coreObjects.manager.relogIfNeeded(args.bot, err, function() {
            self.callback(err || data);
        });
    });
};

Bot.prototype.getContext = function(args) {
    var self = this;

    args.bot.loadInventoryContext(function(err, contexts) {
        self.coreObjects.manager.relogIfNeeded(args.bot, err, function() {
            self.callback(err || contexts);
        });
    });
};

Bot.prototype.getGc = function(args) {
    var bot = args.bot;
    var app = args.app;
    var call = args.call;
    var self = this;

    var gc = bot._gcs[app];

    if (!gc) {
        self.callback(new Error("Given app not loaded or unsupported"));
    } else if (call == "inv") {
        switch (app) {
            case "tf2":
                self.callback(gc.backpack);
                break;
            case "csgo":
                self.callback(gc.inventory);
                break;
            default:
                self.callback(new Error("No inv for app"));
                break;
        }
    } else if (call == "info") {
        self.callback({
            gcConnected: gc.haveGCSession,
            premium: gc.premium,
            invSlots: gc.backpackSlots
        });
    } else if (call == "inspect") {
        if (!args.link) {
            self.callback(new Error("Inspect link required"));
        } else {
            switch (app) {
                case "csgo":
                    var inspectTimeout = setTimeout(function() {
                        inspectTimeout = null;
                        self.callback(new Error("Inspect timed out"));
                    }, Bot.GC_TIMEOUT);

                    gc.inspectItem(args.link, function(data) {
                        if (inspectTimeout) {
                            clearTimeout(inspectTimeout);
                            self.callback(data);
                        }
                    });
                    break;
                default:
                    self.callback(new Error("No inspect call for app"));
                    break;
            }
        }
    } else {
        self.callback(new Error("Unknown call"));
    }
};

Bot.prototype.getInventory = function(args) {
    var bot = args.bot;
    var self = this;

    if (!(args = _assertApiArgs(args, ["appId", "contextId"], self.callback))) {
        return;
    }

    bot.loadInventory(args, function(err, inv) {
        self.coreObjects.manager.relogIfNeeded(bot, err, function() {
            self.callback(err || inv);
        });
    });
};

Bot.prototype.getTradeToken = function(args) {
    var self = this;

    args.bot.getOfferToken(function(err, token) {
        self.coreObjects.manager.relogIfNeeded(args.bot, err, function() {
            if (err) {
                self.callback(err);
            } else {
                self.callback({bot: args.bot.steamId, token: token});
            }
        });
    });
};

Bot.prototype.postSpool = function(args) {
    var mgr = this.coreObjects.manager;

    switch (args.queue) {
        case "confirmations":
            mgr.pushPendingConfirmation(args.bot);
            break;
        case "reconnect":
            mgr.pushPendingReconnect(args.bot);
            break;
        default:
            return this.callback({error: 400, message: "Bad queue"});
            break;
    }

    this.callback({error: null, message: "Bot spooled for " + args.queue});
};

function TradeOffers(callback, coreObjects) {
    this.callback = callback;
    this.coreObjects = coreObjects;
}

TradeOffers.prototype.getIndex = function(args) {
    var callback = this.callback;
    var condensed = this._condenseOffer.bind(this, args.bot);
    var self = this;

    if (args.offer) {
        args.bot.getOffer(args.offer, function(err, offer) {
            self.coreObjects.manager.relogIfNeeded(args.bot, err, function() {
                callback(err || {offer: condensed(offer)});
            });
        });
    } else {
        args.bot.getActiveOffers(function(err, offers) {
            self.coreObjects.manager.relogIfNeeded(args.bot, err, function() {
                callback(err || {offers: offers.map(condensed)});
            });
        });
    }
};

TradeOffers.prototype.postAccept = function(args) {
    var callback = this.callback;
    var self = this;

    args.bot.acceptOffer(args.offer, function(err, status) {
        self.coreObjects.manager.relogIfNeeded(args.bot, err, function() {
            if (err) {
                callback(err);
            } else {
                offer.accept(function(err, status) {
                    callback(err || {status: status});
                });
            }
        });
    });
};

TradeOffers.prototype.postCreate = function(args) {
    var callback = this.callback;
    var condensed = this._condenseOffer.bind(this, args.bot);
    var offerObj = null;
    var self = this;

    try {
        offerObj = JSON.parse(args.offer);
    } catch (err) {
        err.error = 400;
        callback(err);
        return;
    }

    args.bot.makeOffer(offerObj, function(err, result) {
        self.coreObjects.manager.relogIfNeeded(args.bot, err, function() {
            callback(err || condensed(result));
        });
    });
};

TradeOffers.prototype.postDecline = function(args) {
    var callback = this.callback;
    var self = this;

    args.bot.cancelOffer(args.offer, function(err) {
        self.coreObjects.manager.relogIfNeeded(args.bot, err, function() {
            callback(err || {canceled: true});
        });
    });
};

TradeOffers.prototype._condenseOffer = function(bot, offer) {
    var condensedOffer = {
        id: offer.id,
        botInitiated: offer.isOurOffer,
        botItems: bot._buildOfferItems(offer.itemsToGive),
        botSteamId: bot.steamId,
        userItems: bot._buildOfferItems(offer.itemsToReceive),
        userSteamId: offer.partner.getSteamID64(),
        message: offer.message,
        state: offer.state,
        createdAt: this._roundDateTs(offer.created),
        updatedAt: this._roundDateTs(offer.updated),
        expiresAt: this._roundDateTs(offer.expires)
    };

    if (offer.escrowEnds) {
        condensedOffer.escrowEndsAt = this._roundDateTs(offer.escrowEnds);
    }

    if (offer.confirmationMethod) {
        condensedOffer.confirmationMethod = offer.confirmationMethod;
    }

    if (offer.status) {
        condensedOffer.status = offer.status;
    }

    return condensedOffer;
};

TradeOffers.prototype._roundDateTs = function(date) {
    return Math.floor(date.getTime() / 1000);
};

module.exports = {
    Core: Core,
    Bot: Bot,
    Offers: TradeOffers
};

// Helper for required args that get translated to function params
function _assertApiArgs(args, argKeys, errorCallback) {
    var newArgs = {};
    var missingArgKeys = [];

    for (var i = 0; i < argKeys.length; i++) {
        var argKey = argKeys[i];
        var lowerArgKey = argKey.toLowerCase();

        if (typeof args[lowerArgKey] != "undefined") {
            newArgs[argKey] = args[lowerArgKey];
        } else {
            missingArgKeys.push(lowerArgKey);
        }
    }

    if (missingArgKeys.length > 0) {
        errorCallback({error: 400, message: "Missing required args: " + missingArgKeys.join(", ")});
        return null;
    } else {
        return newArgs;
    }
}
