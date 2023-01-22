// Copyright 2015+ Anthony Garcia <anthony@lagg.me>
// Account fleet management

var Logger = require("./logger"),
    Bot = require("./bot");

function BotManager() {
    this.bots = [];

    this._confirmationTimer = null;
    this._reconnectTimer = null;

    this._botsPendingConfirmation = [];
    this._botsPendingReconnect = [];

    this.log = new Logger(BotManager.LOG_LABEL, {
        logName: BotManager.LOG_LABEL
    });
}

BotManager.LOG_LABEL = "bot-manager";
BotManager.CONF_INT_MIN = 2;
BotManager.CONF_INT_MAX = 4;
BotManager.RECON_INT_MIN = 2;
BotManager.RECON_INT_MAX = 4;

BotManager.prototype.relogIfNeeded = function(bot, err, callback) {
    var isReloggable = err && (
        err.message == "Not Logged In"
        || err.message == "HTTP error 401"
        || err.message == "HTTP error 403"
        || err.message == "HTTP error 400"
        || err.message == "Malformed response"
    );

    isReloggable = isReloggable || !bot.loggedOn;

    if (isReloggable) {
        this.pushPendingReconnect(bot);
        callback(true);
    } else {
        callback(false);
    }
};

BotManager.prototype._popPendingConfirmation = function() {
    return this.get(this._botsPendingConfirmation.pop());
};

BotManager.prototype._popPendingReconnect = function() {
    return this.get(this._botsPendingReconnect.pop());
};

BotManager.prototype.pushPendingConfirmation = function(bot) {
    if (this._botsPendingConfirmation.indexOf(bot.username) == -1) {
        this._botsPendingConfirmation.push(bot.username);
    }
};

BotManager.prototype.pushPendingReconnect = function(bot) {
    if (this._botsPendingReconnect.indexOf(bot.username) == -1) {
        this._botsPendingReconnect.push(bot.username);
    }
};

BotManager.prototype.remove = function(bot) {
    var managedBot = this.get(bot);

    if (!managedBot)  {
        this.log.warn("Attempt to remove non-existent bot `" + bot + "` from manager");
    } else if (!managedBot.loggedOn) {
        this.log.warn((managedBot? managedBot.canonicalName : bot) + " already removed");
    } else {
        return managedBot.disconnect();
    }
};

BotManager.prototype.get = function(bot) {
    if (!bot) {
        return null;
    }

    var botName = bot.toString().toLowerCase();

    for (var i = 0; i < this.bots.length; i++ ) {
        var managedBot = this.bots[i];

        if (managedBot.steamId == botName || managedBot.username == botName) {
            return managedBot;
        }
    }
};

BotManager.prototype.getAll = function(filterOffline) {
    return this.bots.filter(function(bot) {
        return !filterOffline || bot.loggedOn;
    });
};

BotManager.prototype.init = function() {
    this._watchConfirmations();
    this._watchReconnects();
};

BotManager.prototype.getRandomInterval = function(watchSecondsMin, watchSecondsMax) {
    return (Math.random() * (watchSecondsMax - watchSecondsMin) + watchSecondsMin) * 1000;
};

BotManager.prototype.add = function(username, password, personaName) {
    var softDisconnects = ["Disconnected", "Invalid", "Fail", "NoConnection", "ServiceUnavailable", "TryAnotherCM"];
    var self = this;
    var newBot = self.get(username);

    if (!newBot) {
        newBot = new Bot(username, password, personaName);

        newBot._user.on("error", function(err) {
            if (softDisconnects.indexOf(err.message) != -1) {
                self.pushPendingReconnect(newBot);
            }
        });

        this.bots.push(newBot);
    }

    return newBot;
};

BotManager.prototype.shutdown = function() {
    var self = this;
    var bots = self.getAll(true);

    self.log.info("Shutting down " + bots.length + " bots");

    bots.forEach(function(bot) {
        self.remove(bot.username);
    });

    clearTimeout(self._confirmationTimer);
    clearTimeout(self._reconnectTimer);
    self._confirmationTimer = null;
    self._reconnectTimer = null;
};

BotManager.prototype._watchConfirmations = function() {
    var watchSecondsMin = BotManager.CONF_INT_MIN;
    var watchSecondsMax = BotManager.CONF_INT_MAX;
    var self = this;

    if (self._confirmationTimer) {
        self.log.warn("Tried to start confirmation watcher when already running");
        return;
    } else {
        self.log.info("Spooling confirmations every " + watchSecondsMin +  "-" + watchSecondsMax + " seconds");
    }

    function doAccepts(bot, confirmations, callback) {
        if (!confirmations || confirmations.length == 0) {
            return callback(null);
        } else {
            bot.acceptConfirmation(confirmations.pop(), function(err) {
                doAccepts(bot, confirmations, callback);
            });
        }
    }

    function doCheck(callback) {
        var bot = self._popPendingConfirmation();

        if (!bot) {
            return callback();
        } else if (!bot.loggedOn) {
            bot.log.warn("Not logged in. Can't check confirmations.");
            return doCheck(callback);
        }

        bot.getConfirmations(function(err, confirmations) {
            self.relogIfNeeded(bot, err, function() {
                if (!err) {
                    doAccepts(bot, confirmations, function(err) {
                        doCheck(callback);
                    });
                } else {
                    doCheck(callback);
                }
            });
        });
    }

    function reCheck() {
        self._confirmationTimer = setTimeout(function() {
            doCheck(function() {
                reCheck();
            });
        }, self.getRandomInterval(watchSecondsMin, watchSecondsMax));
    }

    reCheck();
};

BotManager.prototype._watchReconnects = function() {
    var watchSecondsMin = BotManager.RECON_INT_MIN;
    var watchSecondsMax = BotManager.RECON_INT_MAX;
    var self = this;

    if (self._reconnectTimer) {
        self.log.warn("Tried to watch reconnect queue twice");
        return;
    } else {
        self.log.info("Spooling reconnects every " + watchSecondsMin + "-" + watchSecondsMax + " seconds");
        self._reconnectTimer = true;
    }

    function doCheck(callback) {
        var bot = self._popPendingReconnect();

        if (!bot) {
            callback();
        } else {
            bot.connect(function(err) {
                if (err) {
                    bot.log.error("Connect error: " + err.message);
                    callback(err);
                } else {
                    setTimeout(doCheck.bind(null, callback), 1000);
                }
            });
        }
    }

    function reCheck() {
        self._reconnectTimer = setTimeout(function() {
            if (self._botsPendingReconnect.length > 0) {
                self.log.info("Connecting " + self._botsPendingReconnect.length + " bots");
            }

            doCheck(reCheck);
        }, self.getRandomInterval(watchSecondsMin, watchSecondsMax));
    }

    doCheck(reCheck);
}

module.exports = BotManager;
