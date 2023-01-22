// Copyright 2015+ Anthony Garcia <anthony@lagg.me>

var readline = require("readline"),
    Logger = require("./logger");

function Control(coreObjects, commandClasses) {
    this.reverseResolveExp = new RegExp('([a-z])([A-Z])', 'g');
    this.resolveExp = new RegExp('([a-z])-([a-z])', 'g');

    this.log = new Logger("repl");
    this.coreObjects = coreObjects;
    this.commandClasses = commandClasses;

    this.commands = this._mapClassesToCommands(this.commandClasses);
}

Control.DEFAULT_CLASS = "core";
Control.DEFAULT_METHOD = "index";

module.exports = Control;

Control._repl = null;
Control._restartRepl = null;

Control.prototype.close = function() {
    Control._restartRepl = false;

    if (Control._repl) {
        Control._repl.close();
    }
};

Control.prototype.init = function() {
    if (Control._repl) {
        return;
    }

    Control._repl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
        historySize: 100,
        completer: this._completeLine.bind(this)
    });

    Control._restartRepl = true;

    Control._repl.setPrompt("bot control> ");

    Control._repl.on("line", this._evalLine.bind(this));
    Control._repl.on("close", this._handleClose.bind(this));

    Control._repl.on("SIGCONT", this._handleContinue.bind(this));
    Control._repl.on("SIGINT", this._handleInterrupt.bind(this));
    Control._repl.on("SIGTSTP", this._handleStop.bind(this));
};

Control.prototype.resolveCommand = function(name) {
    return name.replace(this.resolveExp, function(match, little, big) {
        return little + big.toUpperCase();
    }).replace('-', '');
};

Control.prototype.reverseResolveCommand = function(name) {
    return name.replace(this.reverseResolveExp, function(match, little, big) {
        return little + '-' + big.toLowerCase();
    });
};

Control.prototype._completeLine = function (line) {
    var cmdOpts = line.split(' ').filter(Boolean);

    return [Object.keys(this.commands).filter(function (e) {
        return cmdOpts.length == 0? true : e.indexOf(cmdOpts[0]) == 0;
    }), line];
};

Control.prototype._evalLine = function (line) {
    var parsedCmdLine = this.parseLine(line);

    if (!parsedCmdLine) {
        this.print();
        return null;
    }

    var parsedCmdArgs = parsedCmdLine.args;
    var parsedCmdName = parsedCmdLine.name;
    var command = this.commands[parsedCmdLine.name];

     if (!command) {
        console.error(parsedCmdName + ": No such command");
    } else if (parsedCmdArgs.length < command.requiredArgs) {
        console.error(parsedCmdName + ": Expected " + command.requiredArgs + " arguments, got " + parsedCmdArgs.length);
    } else {
        try {
            var cls = new this.commandClasses[command.className](this.coreObjects);
            cls[command.methodName].apply(cls, parsedCmdArgs);
        } catch (err) {
            console.error(command.name, err);
        }
    }

    this.print();
};

Control.prototype._handleClose = function() {
    Control._repl = null;

    if (Control._restartRepl) {
        this.log.info("Restarting");
        this.init();
    } else {
        this.log.info("Closing");
    }
};

Control.prototype._handleContinue = function() {
    this.print("Unsupported");
};

Control.prototype._handleInterrupt = function() {
    this._evalLine("quit");
};

Control.prototype._handleStop = function() {
    this.print("Unsupported");
};

Control.prototype._mapClassesToCommands = function() {
    var commands = {};

    for (var i = 0, classKeys = Object.keys(this.commandClasses); i < classKeys.length; i++) {
        var className = classKeys[i];
        var cls = this.commandClasses[className];

        for (var j = 0, methodKeys = Object.keys(cls.prototype); j < methodKeys.length; j++) {
            var methodName = methodKeys[j];

            var prefix = this.reverseResolveCommand(className).toLowerCase();
            var suffix = this.reverseResolveCommand(methodName).toLowerCase();

            prefix = prefix == Control.DEFAULT_CLASS? '' : prefix;
            suffix = suffix == Control.DEFAULT_METHOD? '' : suffix;

            var commandName = prefix + (prefix && suffix? '-' : '') + suffix;

            commands[commandName] = {
                name: commandName,
                className: className,
                methodName: methodName,
                requiredArgs: cls.prototype[methodName].length
            };
        }
    }

    return commands;
};

Control.prototype.parseLine = function(line) {
    var tokens = [];
    var stringDepth = 0;
    var stringBuf = "";

    for (var i = 0; i < line.length; ++i) {
        var c = line[i];

        switch (c) {
            case '"':
                if (stringDepth > 0) {
                    --stringDepth;
                } else {
                    ++stringDepth;
                }

                if (stringDepth == 0) {
                    tokens.push(stringBuf);
                    stringBuf = "";
                }
                break;
            case ' ':
                if (stringDepth > 0) {
                    stringBuf += c;
                } else if (stringBuf && stringDepth == 0) {
                    tokens.push(stringBuf);
                    stringBuf = "";
                }
                break;
            default:
                stringBuf += c;
                break;
        }
    }

    if (stringBuf) {
        tokens.push(stringBuf);
    }

    if (tokens.length < 1) {
        return null;
    } else {
        var commandString = tokens[0];
        var commandArgs = tokens.slice(1);
        var command = this.commands[commandString];

        return {
            name: commandString,
            args: commandArgs
        };
    }
};

Control.prototype.print = function() {
    if (arguments.length > 0) {
        console.log.apply(null, arguments);
    }

    if (Control._repl) {
        Control._repl.prompt();
    }
};
