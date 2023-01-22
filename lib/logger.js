// Copyright 2015+ Anthony Garcia <anthony@lagg.me>

var fs = require("fs"),
    path = require("path"),
    Configuration = require("./configuration");

function Logger(label, options) {
    var options = options || {};

    this.logDir = options.logDir || Configuration.raw.logDir;
    this.logLevel = options.logLevel || Configuration.raw.logLevel || Logger.DEFAULT_LEVEL_THRESHOLD;
    this.logName = options.logName || Logger.DEFAULT_NAME;
    this.levels = options.levels || {};
    this.label = label || this.logName;

    this.useConsole = !options.noConsole;
    this.useFile = !options.noFile && this.logDir;
    this.useRotation = !options.noRotation;

    this.handleExceptions = options.handleExceptions;

    var self = this;

    // Assign default levels if not overridden
    Object.keys(Logger.DEFAULT_LEVELS).forEach(function(k) {
        self.levels[k] = self.levels[k] || Logger.DEFAULT_LEVELS[k];
    });

    // Add convenience funcs
    Object.keys(this.levels).forEach(this._addLog.bind(this));

    if (this.handleExceptions) {
        process.on("uncaughtException", this.emerg.bind(this, "uncaughtException:"));
    }
}

Logger._streams = {};

Logger.DEFAULT_NAME = "daemon";
Logger.DEFAULT_LEVEL_THRESHOLD = "debug";
Logger.DEFAULT_LABEL_CONSOLE_CODES = "97";
Logger.DEFAULT_LEVELS = {
    emerg: {
        consoleCodes: "41",
        level: 0
    },
    error: {
        consoleCodes: "31",
        level: 3
    },
    warn: {
        consoleCodes: "33",
        label: "warning",
        level: 4
    },
    info: {
        consoleCodes: "32",
        level: 6
    },
    debug: {
        consoleCodes: "90",
        level: 7
    }
};

Logger.prototype.log = function() {
    var level = null;
    var output = [];

    for (var i = 0; i < arguments.length; i++) {
        var arg = arguments[i];

        if (arg instanceof Error) {
            arg = arg.name + ": " + arg.message + "\nStack: " + arg.stack;
        } else if (typeof arg == "object") {
            arg = JSON.stringify(arg);
        }

        if (i == 0) {
            level = arg? arg.toString() : "null";
            var levelInfo = this.levels[level] || {};
            var thesholdLevelInfo = this.levels[this.logLevel] || {};

            // Don't bother wasting cycles if under priority
            if (levelInfo.level > thesholdLevelInfo.level) {
                return;
            }
        } else {
            output.push(arg);
        }
    }

    if (output.length > 0) {
        var line = output.join(" ");
        this._writeLog(level, line);
        this._writeConsoleLog(level, line);
    }
};

Logger.prototype._addLog = function(level) {
    var self = this;

    Object.defineProperty(this, level, {value: function() {
            var line = Array.prototype.slice.call(arguments);
            line.unshift(level);
            self.log.apply(self, line);
    }});
};

Logger.prototype._onStreamError = function(err) {
    this._writeConsoleLog("error", err.message);
};

Logger.prototype._zpad = function(num, len) {
    var len = len || 2;
    var num = num.toString();
    var needed = len - num.length;
    var p = "";

    if (needed > 0) {
        while(needed--) { p += '0'; }
    }

    return p + num;
};

Logger.prototype._writeConsoleLog = function(level, line) {
    if (!this.useConsole) {
        return false;
    }

    var levelInfo = this.levels[level] || {};
    var levelColor = levelInfo.consoleCodes || "0";
    var levelLabel = levelInfo.label || level;

    console.log(
        "[\x1b[" + Logger.DEFAULT_LABEL_CONSOLE_CODES + "m" + this.label + "\x1b[0m] "
        + "\x1b[" + levelColor + "m" + levelLabel + ":\x1b[0m "
        + line
    );

    return true;
};

Logger.prototype._writeLog = function(level, line) {
    if (!this.useFile) {
        return false;
    }

    // Generate timestamp parts (date of year reused for filenaming)
    var date = new Date;

    var doy = (
        this._zpad(date.getFullYear()) + '-'
        + this._zpad(date.getMonth() + 1) + '-'
        + this._zpad(date.getDate())
    );

    var dateTag = ('['
        + doy
        + ' '
        + this._zpad(date.getHours()) + ':'
        + this._zpad(date.getMinutes()) + ':'
        + this._zpad(date.getSeconds())
        + ']');

    // If not rotating discard doy now that display stamp is done
    if (!this.useRotation) {
        doy = null;
    }

    // Check date of year to see if stream cache needs reopening
    var streamMeta = Logger._streams[this.logName] || {};
    var stream = streamMeta.stream;
    var lastDoy = streamMeta.doy;

    if (stream && doy != lastDoy) {
        stream.end();
        stream = null;
    }

    if (!stream) {
        var suffix = doy? "-" + doy : "";
        var filename = path.join(this.logDir, this.logName + suffix + ".log");

        stream = fs.createWriteStream(filename, {flags: "a"});

        stream.on("error", this._onStreamError.bind(this));

        Logger._streams[this.logName] = {
            stream: stream,
            doy: doy
        };
    }

    // Final formatting and line write
    var levelTag = '[' + level.toUpperCase() + ']';
    var labelTag = '[' + this.label + ']';

    stream.write(dateTag + labelTag + levelTag + " " + line + "\n");

    return true;
};

module.exports = Logger;
