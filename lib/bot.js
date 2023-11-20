// Copyright 2015+ Anthony Garcia <anthony@lagg.me>

var SteamUser = require("steam-user"),
    SteamTradeOfferManager = require("steam-tradeoffer-manager"),
    SteamCommunity = require("steamcommunity"),
    SteamStore = require("steamstore"),
    fs = require("fs"),
    crypto = require("crypto"),
    Logger = require("./logger"),
    request = require("request"),
    URL = require("url"),
    Configuration = require("./configuration"),
    Control = require("./control"),
    totp = require("steam-totp"),
    path = require("path");

// Optional GC support
var TeamFortress2 = null,
    GlobalOffensive = null;
try { TeamFortress2 = require("tf2"); } catch { }
try { GlobalOffensive = require("globaloffensive"); } catch {}

module.exports = Bot;

function Bot(username, password, personaName) {
    var dataDirectory = Configuration.raw.dataDir;
    var bindAddress = Configuration.getBindAddress();
    var proxyUrl = Configuration.getProxy();


    this.username = username.toLowerCase();

    this.name = null;
    this.steamId = null;

    this.log = new Logger(this.username, {logName: "bots"});

    this.loginAt = null;
    this.webLoginAt = null;


    this._appCtxExp = new RegExp('var g_rgAppContextData = ([^\n]+);\r?\n');

    this._cookies = null;

    this._password = password; // I know, but it's going to be in the heap at some point anyway.

    this._sgCallback = null;

    this._2fa = null;

    this._2faPath = path.join(dataDirectory, this.username + ".2fa.json");

    this._sentryName = this.username + ".sentry";

    this._jar = request.jar();
    this._request = request.defaults({
        "proxy": proxyUrl,
        "jar": this._jar
    });

    this._community = new SteamCommunity({
        request: this._request
    });

    this._gcs = {};

    this._user = new SteamUser({
        promptSteamGuardCode: false,
        dataDirectory: dataDirectory,
        autoRelogin: false,
        httpProxy: proxyUrl,
        localAddress: bindAddress
    });

    this._offers = new SteamTradeOfferManager({
        steam: this._user,
        pollInterval: -1,
        community: this._community
    });

    this._store = new SteamStore({
        request: this._request
    });


    var gamesPlayed = [];
    var self = this;

    if (GlobalOffensive) {
        self._gcs.csgo = new GlobalOffensive(self._user);

        self._gcs.csgo.on("connectedToGC", function() {
            self.log.info("Connected to CSGO GC");
        });

        gamesPlayed.push(730);
    }

    if (TeamFortress2) {
        self._gcs.tf2 = new TeamFortress2(self._user);

        self._gcs.tf2.on("connectedToGC", function(version) {
            self.log.info("Connected to TF2 GC V" + version);
        });

        self._gcs.tf2.on("backpackLoaded", function() {
            self.log.info("Got TF2 GC backpack");
        });

        gamesPlayed.push(440);
    }

    this._user.storage.on("save", function(filename, contents, callback) {
        if (filename.indexOf("sentry.") == 0) {
            filename = self._sentryName;
        }

        self.log.debug("Writing " + filename);

        fs.writeFile(path.join(dataDirectory, filename), contents, function(writeError) {
            if (writeError) {
                self.log.error("Can't write " + filename + ": " + writeError.message);
                return callback(writeError);
            }

            return callback(writeError);
        });
    });

    this._user.storage.on("read", function(filename, callback) {
        if (filename.indexOf("sentry.") == 0) {
            filename = self._sentryName;
        }

        self.log.debug("Reading " + filename);

        return fs.readFile(path.join(dataDirectory, filename), function(readError, contents) {
            if (readError) {
                self.log.error("Can't read " + filename + ": " + readError.message);
                return callback(readError);
            }

            return callback(readError, contents);
        });
    });

    this._user.on("accountInfo", function(name) {
        self.name = name;
        self.log.info("Persona set to", self.name);
    });

    this._user.on("emailInfo", function(address, validated) {
        if (!validated) {
            self.log.warn(address + " needs to be validated");
        }
    });

    this._user.on("steamGuard", function(domain, callback, lastCodeWrong)  {
        if (this._sgCallback) {
            self.log.warn("Duplicate SteamGuard requests");
        }

        self._sgCallback = callback;

        var cooldown = lastCodeWrong? Bot.OTP_COOLDOWN : 0;
        var logSuffix = cooldown? " (last one wrong, " + (cooldown / 1000) + "s cooldown)" : "";
        var sgType = domain? "email (" + domain + ")" : "app";

        self.log.warn("Got SteamGuard " + sgType + " code request" + logSuffix);

        if (domain) {
            return;
        }

        self._loadKeyData(function(err, data) {
            if (err) {
                self.log.error("Couldn't read my 2fa key data. Halp: " + err.message);
                return self.disconnect();
            }

            setTimeout(function() {
                var code = totp.getAuthCode(data.shared_secret);

                self.log.info("Generated SteamGuard Mobile Authenticator OTP: " + code);

                self.sendOtp(code);
            }, cooldown);
        });
    });

    this._user.on("webSession", function(sessionId, cookies) {
        self._cookies = cookies;
        self._community.setCookies(cookies);
        self._store.setCookies(cookies);
        self.webLoginAt = new Date;
    });

    this._user.on("loggedOn", function(response) {
        switch (response.eresult) {
            case SteamUser.EResult.OK:
                self.steamId = self._user.steamID.getSteamID64();
                self.setPersona(self.name || personaName);
                self.loginAt = new Date;
                self.log.info("Logged in as " + self.canonicalName);
                self._user.gamesPlayed(gamesPlayed);
                break;
            case SteamUser.EResult.AccountLogonDenied:
                self.log.error("Logon denied");
                break;
            case SteamUser.EResult.Revoked:
                self.log.error("Logon auth revoked");
                break;
            case SteamUser.EResult.InvalidLoginAuthCode:
                self.log.error("Logon denied due to invalid OTP");
                break;
            default:
                self.log.error("Unknown logon response", response.eresult);
                break;
        }
    });

    this._user.on("friendRelationship", function(steamId, relationship) {
        if (relationship == SteamUser.EFriendRelationship.RequestRecipient) {
            self.log.debug("Friend request from " + steamId);
            self._user.removeFriend(steamId);
        }
    });

    this._user.on("tradeRequest", function(steamId, responseCallback) {
        self.log.debug("Trade request from " + steamId);
        responseCallback(false);
    });

    this._user.on("error", function(err) {
        self.log.error("User error: " + err.message);
    });


    Object.defineProperty(this, "loggedOn", { get: function() { return !!(self._user && self._user.steamID); }});
    Object.defineProperty(this, "apiKey", { get: function() { return self._offers? self._offers.apiKey : null; } });
    Object.defineProperty(this, "fullName", { get: function() { return (self.name? self.name : "Unnamed Bot") + " (" + (self.steamId || "00000000000000000") + ")"; }});
    Object.defineProperty(this, "canonicalName", { get: function() { return self.username + " (" + (self.steamId  || "00000000000000000") + ")"; }});
}

Bot.INV_PAGE_SIZE = 3000;
Bot.OTP_COOLDOWN = 15000;
Bot.CONNECT_TIMEOUT = 5000;

Bot.prototype._loadKeyData = function (callback) {
    var self = this;

    fs.readFile(self._2faPath, function(err, data) {
        if (err) {
            self.log.error("Error reading 2fa file:", err);
        } else {
            try {
                self._2fa = JSON.parse(data);
            } catch (parseErr) {
                err = parseErr;
            }
        }

        return callback(err, self._2fa);
    });
};

Bot.prototype.connect = function(password, callback) {
    if (typeof(password) == "function") {
        callback = password;
        password = null;
    } else {
        callback = callback || function(){};
    }

    var self = this;
    var timeout = Bot.CONNECT_TIMEOUT;
    var timeoutHit = false;
    var connectTimeout = setTimeout(function() {
        timeoutHit = true;
        callback(new Error("Connect timed out after " + timeout + "ms"));
    }, timeout);
    var doLogin = function() {
        self._loadKeyData(function(err, data) {
            var loginCreds = {
                accountName: self.username,
                password: self._password
            };

            if (!err) {
                loginCreds.twoFactorCode = totp.generateAuthCode(data.shared_secret);
            } else {
                self.log.warn("Error reading TFA data. Falling back to old login.");
            }

            try {
                if (!self.loggedOn) {
                    self._user.logOn(loginCreds);
                }
            } catch (err) {
                if (err.message == "Already logged on, cannot log on again") {
                    self.log.warn("Got weird loggedOn race condition, value currently " + self.loggedOn);
                } else {
                    throw err;
                }
            }
        });
    };

    this._password = password || this._password;

    this._user.once("webSession", function() {
        if (!timeoutHit) {
            clearTimeout(connectTimeout);
            callback(null);
        }
    });

    if (this.loggedOn) {
        self._user.logOff();
        self._user.once("disconnected", function() {
            if (!timeoutHit) {
                doLogin();
            }
        });
    } else {
        doLogin();
    }
};

Bot.prototype.connectAnonymously = function(callback) {
    this._user.once("loggedOn", function() {
        callback(null);
    });

    this._user.logOn();
};

Bot.prototype.disconnect = function() {
    // Order matters here
    try {
        this._community.stopConfirmationChecker();

        this._offers.shutdown();

        this._user.logOff();
    } catch (err) {
        console.log("Error during late shutdown: " + err.message);
    }
};

// Starts a 2fa enable flow for this bot.
Bot.prototype._enableTwoFactor = function(callback) {
    var self = this;

    fs.exists(self._2faPath, function(exists) {
        if (exists) {
            return callback(new Error("2FA payload already exists"));
        }

        self._user.enableTwoFactor(function(response) {
            self._2fa = response;

            if (!response || !response.shared_secret) {
                return callback(new Error("No shared secret in dump."));
            }

            fs.writeFile(self._2faPath, JSON.stringify(response), function (err) {
                if (err) {
                    return callback(new Error("Couldn't write 2FA payload: " + err.message));
                }

                return callback(null);
            });
        });
    });
};

// Completes two factor auth enabling with the given SMS code
Bot.prototype._finalizeTwoFactor = function(code, callback) {
    var self = this;

    this._loadKeyData(function(err, data) {
        if (err) {
            return callback(err);
        }

        self._user.finalizeTwoFactor(data.shared_secret, code, callback);
    });
};

Bot.prototype.loadApiKey = function(callback) {
    var self = this;

    if (self.apiKey) {
        return callback(null, self.apiKey);
    }

    self._offers.setCookies(self._cookies, function(err) {
        if (err) {
            self.log.error("Error setting trade offer cookies: " + err.message);
        } else {
            self.log.info("Using fetched API key " + self.apiKey);
        }

        return callback(err, self.apiKey);
    });
};

Bot.prototype.loadInventory = function(options, callback) {
    var self = this;
    options = options || {};
    options.appId = options.appId || Configuration.raw.appId;
    options.contextId = options.contextId || 2;
    options.count = options.count || Bot.INV_PAGE_SIZE;
    options.lang = options.lang || "english";

    if (!options.appId || !options.contextId) {
        return callback(new Error("Cannot load inventory. App and section not given."));
    }

    this._community.httpRequest({
        url: "http://steamcommunity.com/inventory/" + this.steamId + "/" + options.appId + "/" + options.contextId,
        qs: {
            l: options.lang,
            count: options.count,
            start_assetid: options.startId
        },
        json: true
    }, function(err, response, body) {
        return callback(err, body);
    }, "corebot");
};

Bot.prototype.loadInventoryContext = function(callback) {
    var self = this;

    self._community.httpRequest({
        url: "http://steamcommunity.com/profiles/" + self.steamId + "/inventory"
    }, function(err, response, body) {
        if (err) {
            return callback(err, null);
        }

        var match = body.match(self._appCtxExp);

        if (match && match[1]) {
            try {
                callback(null, JSON.parse(match[1]));
            } catch (err) {
                callback(err);
            }
        } else {
            callback(new Error(body.indexOf("This profile is private.") !== -1? "Not Logged In" : "No context data"));
        }
    }, "corebot");
};

Bot.prototype.setPersona = function(name) {
    this._user.setPersona(SteamUser.EPersonaState.Online, name);
};

Bot.prototype.addPhone = function(number, callback) {
    this._store.addPhoneNumber(number, false, callback);
};

Bot.prototype.verifyPhone = function(code, callback) {
    this._store.verifyPhoneNumber(code, callback);
};

Bot.prototype._generateOfferItem = function(item) {
    return {
        assetid: (item.assetid || item.id).toString(),
        appid: (item.appid || Configuration.raw.appId).toString(),
        contextid: item.contextid.toString(),
        amount: (item.amount || 1).toString()
    };
};

Bot.prototype._buildOfferItems = function(items) {
    var strippedItems = [];

    for(var i in items) {
        strippedItems.push(this._generateOfferItem(items[i]));
    }

    return strippedItems;
};

Bot.prototype.acceptConfirmation = function(confirmation, callback) {
    var self = this;
    var keyTime = totp.time();
    var detailKey = totp.getConfirmationKey(self._2fa.identity_secret, keyTime, "details");
    var allowKey = totp.getConfirmationKey(self._2fa.identity_secret, keyTime, "allow");

    confirmation.getOfferID(keyTime, detailKey, function(err, offerId) {
        if (err) {
            self.log.error("Couldn't get offer ID for confirmation " + confirmation.id + ": " + err.message);
        }

        self.log.info("Accepting confirmation " + confirmation.id + " for offer " + offerId, {
            confirmation: {
                title: confirmation.title,
                id: confirmation.id,
                time: confirmation.time,
                receiving: confirmation.receiving,
                key: confirmation.key,
                offerId: offerId
            }});

        confirmation.respond(keyTime, allowKey, true, function(err) {
            if (err) {
                self.log.error("Error accepting confirmation " + confirmation.id + " for offer " + offerId + ": " + err.message);
            }

            return callback(err, offerId);
        });
    });
};

Bot.prototype.acceptOffer = function(id, callback) {
    this.getOffer(id, function(err, offer) {
        if (err) {
            callback(err);
        } else {
            offer.accept(callback);
        }
    });
};

Bot.prototype.cancelOffer = function(id, callback) {
    this.getOffer(id, function(err, offer) {
        if (err) {
            callback(err);
        } else {
            offer.cancel(callback);
        }
    });
};

Bot.prototype.getConfirmations = function(callback) {
    var self = this;

    this._loadKeyData(function(err, data) {
        if (err) {
            return callback(err);
        }

        var keyTime = totp.time();
        var key = totp.getConfirmationKey(data.identity_secret, keyTime, "conf");

        try {
            self._community.getConfirmations(keyTime, key, function(err, confirmations) {
                if (err) {
                    self.log.error("Error fetching confirmations: " + err.message);
                }

                callback(err, confirmations);
            });
        } catch (err) {
            // Occasionally throws
            self.log.error("Error fetching confirmations: " + err.message);
            callback(err);
        }
    });
};

Bot.prototype.getActiveOffers = function(callback) {
    var self = this;
    var filter = SteamTradeOfferManager.EOfferFilter.ActiveOnly;

    self.loadApiKey(function(err) {
        if (err) {
            callback(err);
        } else {
            self._offers.getOffers(filter, null, function(err, sent, received) {
                callback(err, (sent || []).concat(received || []));
            });
        }
    });
};

Bot.prototype.getOffer = function(id, callback) {
    var self = this;

    self.loadApiKey(function(err, apiKey) {
        if (err) {
            return callback(err);
        }

        self._offers.getOffer(id, callback);
    });
};

Bot.prototype.getOfferToken = function(callback) {
    var self = this;

    self.loadApiKey(function(err, apiKey) {
        if (err) {
            return callback(err);
        }

        self._offers.getOfferToken(callback);
    });
};

// A wrapper over the offers module similar to this.request,
// options are as follows:
//
// userSteamId: The partner of the trade offer
// userTradeUrl: Trade URL
// message: Message sent with the offer, a reasonable default is used otherwise
// botItems: The item payload from the bot
// userItems: The item payload from the user
Bot.prototype.makeOffer = function (options, callback) {
    var itemsFromThem = this._buildOfferItems(options.userItems);
    var itemsFromMe = this._buildOfferItems(options.botItems);
    var url = URL.parse(options.userTradeUrl, true);
    var tradeOffer = this._offers.createOffer(options.userSteamId);

    options.userTradeUrl = (url.query && url.query.token)? url.query.token : options.userTradeUrl;
    options.message = options.message || "";

    tradeOffer.setMessage(options.message);
    tradeOffer.setToken(options.userTradeUrl);

    tradeOffer.addTheirItems(itemsFromThem);
    tradeOffer.addMyItems(itemsFromMe);

    var self = this;

    self.loadApiKey(function(err, apiKey) {
        if (err || !apiKey) {
            return callback(err || new Error("No key"));
        }

        tradeOffer.getUserDetails(function(err, me, them) {
            if (err || !me || !them) {
                return callback(err || new Error("Can't get escrow details"));
            }

            var theirDays = them.escrowDays;
            var myDays = me.escrowDays;

            if (itemsFromMe.length > 0 && myDays != 0) {
                callback(new Error("Bot would have items escrowed for " + myDays + " day(s)."));
            } else if (itemsFromThem.length > 0 && theirDays != 0) {
                callback(new Error("User would have items escrowed for " + theirDays + " day(s)."));
            } else {
                tradeOffer.send(function(err, status) {
                    if (err) {
                        callback(err)
                    } else {
                        tradeOffer.status = status;
                        callback(null, tradeOffer);
                    }
                });
            }
        });
    });
};

Bot.prototype.sendOtp = function(code) {
    if (this._sgCallback) {
        this._sgCallback(code);
        this._sgCallback = null;
    } else {
        this.log.warn("Tried to send OTP without being asked");
    }
};
