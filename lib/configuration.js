// Copyright 2015+ Anthony Garcia <anthony@lagg.me>

var fs = require("fs"), path = require("path");

function Configuration() {
}

Configuration.APP_TF2 = 440;
Configuration.APP_CSGO = 730;

Configuration.DEFAULT_FILENAME = "config.json";
Configuration.DEFAULT_VALUES = {
    appId: Configuration.APP_CSGO,
    dataDir: "data",
    logDir: "logs",
    logLevel: "info",
    ajax: {
        host: "127.0.0.1",
        port: 5244,
        sslCert: null,
        sslKey: null,
        enabled: false
    },
    proxies: [],
    bindAddrs: [],
    bots: []
};
Configuration.raw = null;

Configuration._bindAddrIndex = 0;
Configuration._proxyIndex = 0;

Configuration.getBindAddress = function() {
    var addrs = Configuration.raw.bindAddrs || [];

    if (!addrs[Configuration._bindAddrIndex]) {
        Configuration._bindAddrIndex = 0;
    }

    return addrs[Configuration._bindAddrIndex++];
};

Configuration.getProxy = function() {
    var proxies = Configuration.raw.proxies || [];

    if (!proxies[Configuration._proxyIndex]) {
        Configuration._proxyIndex = 0;
    }

    return proxies[Configuration._proxyIndex++];
}

Configuration.prototype.overrideOpts = function(base, overrides) {
    var config = {};

    // Command line overrides config
    Object.keys(base).forEach(function(k) { config[k] = base[k]; });
    Object.keys(overrides).forEach(function(k) { config[k] = overrides[k]; });

    return config;
};

Configuration.prototype.load = function(callback, filename) {
    var self = this;
    var cmdOpts = self.parseCommandLine();
    var filename = filename || cmdOpts.conf || Configuration.DEFAULT_FILENAME;
    var configDir = path.dirname(filename);

    // Load filename
    fs.readFile(filename, function(err, data) {
        // Initialize to hardcoded defaults
        Configuration.raw = self.overrideOpts(Configuration.DEFAULT_VALUES, {});

        if (!err) {
            Configuration.raw = self.overrideOpts(Configuration.raw, JSON.parse(data));
        }

        // Load command line overrides
        Configuration.raw = self.overrideOpts(Configuration.raw, cmdOpts);

        // Do final post-processing
        if (!path.isAbsolute(Configuration.raw.logDir)) {
            Configuration.raw.logDir = path.join(configDir, Configuration.raw.logDir);
        }

        if (!path.isAbsolute(Configuration.raw.dataDir)) {
            Configuration.raw.dataDir = path.join(configDir, Configuration.raw.dataDir);
        }

        callback(err, Configuration.raw);
    });
};

Configuration.prototype.parseCommandLine = function(argv) {
    var relevantArgs = argv || process.argv.slice(2);
    var confArgs = {}
    var lastOpt = null;

    for (var i = 0; i < relevantArgs.length; ++i) {
        var arg = relevantArgs[i];

        if (arg.substring(0, 2) == "--") {
            // Check if any applicable operands were found for this
            // opt before replacing it and setting to true to at least
            // use as a flag opt if none are found.
            if (lastOpt && !confArgs[lastOpt]) {
                confArgs[lastOpt] = true;
            }

            // Convert to camely notation
            lastOpt = arg.substring(2).replace(/([a-z])-([a-z])/g, function(match, little, big) {
                return little + big.toUpperCase();
            }).replace('-', '');
        } else  {
            if (!lastOpt) {
                if (confArgs["positionals"] == undefined) {
                    confArgs["positionals"] = [];
                }

                confArgs["positionals"].push(arg);
            } else {
                // Do basic type handling
                switch(arg.toLowerCase()) {
                    case "true":
                    case "false":
                        arg = (arg.toLowerCase() == "true");
                        break;
                    case "null":
                        arg = null;
                        break;
                }

                if (confArgs[lastOpt]) {
                    if (!Array.isArray(confArgs[lastOpt])) {
                        confArgs[lastOpt] = [confArgs[lastOpt]];
                    }

                    confArgs[lastOpt].push(arg);
                } else if (!confArgs[lastOpt]) {
                    confArgs[lastOpt] = arg;
                }
            }
        }
    }

    return confArgs;
};

module.exports = Configuration;
