// Copyright 2015+ Anthony Garcia <anthony@lagg.me>
// Init and entry point logic

var Logger = require("./logger"),
    BotManager = require("./bot-manager"),
    Configuration = require("./configuration"),
    Control = require("./control"),
    Ajax = require("./ajax"),
    AjaxApi = require("./ajax-api-methods"),
    ControlCommands = require("./control-commands");

function Core() {
    this.objects = {
        manager: null,
        control: null,
        config: new Configuration,
        ajax: null,
        log: null,
        uncaughtLog: null
    };

    this._loaded = false;
}

Core.prototype.init = function(conf) {
    var coreObjects = this.objects;

    if (this._loaded) {
        coreObjects.log.warn("Tried to init twice");
    } else {
        this._loaded = true;
    }

    // Initialize core loggers
    coreObjects.log = new Logger("init");
    coreObjects.uncaughtLog = new Logger("FIXME", {logName: "FIXME", handleExceptions: true});

    if (conf.logDir) {
        coreObjects.log.info("Writing logs to directory '" + conf.logDir + "'");
    }

    // Initialize ajax
    coreObjects.ajax = new Ajax(coreObjects, AjaxApi);

    if (conf.ajax.enabled) {
        coreObjects.log.info("Starting ajax");
        coreObjects.ajax.init();
    }

    // Initialize bot manager and add bots such that
    // disabled ones are filtered
    coreObjects.manager = new BotManager;

    var bots = conf.bots.filter(function(bot) {
        return !bot.disabled;
    });

    bots.forEach(function(bot) {
        coreObjects.manager.add(bot);
        coreObjects.manager.pushPendingReconnect(bot);
    });

    coreObjects.log.info("Starting", bots.length, "bots");
    coreObjects.manager.init();

    // Initialize repl
    coreObjects.control = new Control(coreObjects, ControlCommands);
    coreObjects.control.init();
    coreObjects.control.print();
    console.log("repl loaded");
};

Core.prototype.initConfigured = function() {
    var self = this;

    this.objects.config.load(function(err, conf) {
        if (err) {
            console.error("Config error, using defaults:", err.message);
        }

        self.init(conf);
    });
};

module.exports = Core;
