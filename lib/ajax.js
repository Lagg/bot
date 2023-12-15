// Copyright 2015+ Anthony Garcia <anthony@lagg.me>
/* Simple Ajax-over-HTTP-based IPC
 *
 * API call protocol:
 *  Query (e.g. GET Class/Method) converted to raw API conventions (e.g. (new Class).getMethod)
 *  Resulting signature matched to class/method instance case insensitively
 *  If found, call with normalized query string or POST body as arg param, else 404
 *  If callback returns Error or http-error containing string, intelligently use code
 */

var http = require("http"),
    https = require("https"),
    path = require("path"),
    url = require("url"),
    qs = require("querystring"),
    crypto = require("crypto"),
    fs = require("fs"),

    Configuration = require("./configuration"),
    Logger = require("./logger");

// Server implementation
function Ajax(coreObjects, apiClasses, ajaxOptions) {
    this.config = ajaxOptions || Configuration.raw.ajax;

    this.apiClasses = apiClasses;
    this.apiKeys = {};
    this.coreObjects = coreObjects;

    this.insecureMode = !this.config.sslCert || !this.config.sslKey;

    this.server = null;
    this.log = new Logger("ajax");

    this.loadApiKeys();
}

Ajax.API_KEY_FILENAME = "ajax-api-keys.json";
Ajax.MAX_POST_SIZE = 512000;

Ajax.DEFAULT_CLASS = "core";
Ajax.DEFAULT_METHOD = "index";
Ajax.DEFAULT_USERNAME = "guest";
Ajax.DEFAULT_FLAGS = [];

Ajax.prototype.close = function() {
    var self = this;

    if (self.server) {
        self.server.close(function() {
            self.server = null;
        });
    }

    this.saveApiKeys();
};

Ajax.prototype.deleteApiKey = function(key) {
    if (this.apiKeys[key]) {
        delete this.apiKeys[key];
        return true;
    } else {
        return false;
    }
};

Ajax.prototype.generateApiKey = function(username, flags, callback) {
    var self = this;
    username = (username || Ajax.DEFAULT_USERNAME).toLowerCase();
    flags = flags || Ajax.DEFAULT_FLAGS;

    flags.sort();

    var existingKey = this.getApiKey(username);

    // Delete any existing keys under the same username
    if (existingKey) {
        this.log.warn("Deleting existing key", existingKey.key, "(" + username + ")");
        this.deleteApiKey(existingKey.key);
    }

    crypto.randomBytes(16, function(err, bytes) {
        var key = null;

        if (!err) {
            key = crypto.createHash("sha256");
            key.update(bytes);
            key = key.digest("hex").substring(0, 32).toUpperCase();

            self.apiKeys[key] = {
                username: username,
                flags: flags
            };
        }

        callback(err, key);
    });
};

Ajax.prototype.getApiKey = function(usernameOrKey) {
    var meta = this.apiKeys[usernameOrKey];
    var key = null;

    if (!meta) {
        var hashes = Object.keys(this.apiKeys)
        usernameOrKey = usernameOrKey.toLowerCase();

        for (var i = 0; i < hashes.length; i++) {
            var hash = hashes[i];
            var candidate = this.apiKeys[hash];

            if (usernameOrKey == candidate.username) {
                meta = candidate;
                key = hash;
                break;
            }
        }
    } else {
        key = usernameOrKey;
    }

    if (key && meta) {
        meta.key = key;
        return meta;
    } else {
        return null;
    }
};

Ajax.prototype.isCallAllowed = function(apiCall, apiKey) {
    var meta = this.apiKeys[apiKey];
    var flags = [];

    if (meta) {
        apiCall.callerUsername = meta.username;
        flags = meta.flags;
    }

    for (var i = 0; i < flags.length; i++) {
        var flag = meta.flags[i];

        var wildcard = "*";
        var wildcardClass = wildcard + "." + apiCall.apiMethod;
        var wildcardMethod = apiCall.apiClass + "." + wildcard;
        var fqn = apiCall.apiClass + "." + apiCall.apiMethod;
        var fullWildcard = wildcard + "." + wildcard;

        if (flag == wildcard
            || flag == wildcardClass
            || flag == wildcardMethod
            || flag == fqn
            || flag == fullWildcard) {
            return true;
        }
    }

    return false;
};

Ajax.prototype.init = function() {
    var self = this;

    if (self.server) {
        return;
    }

    var options = {};
    var mod = self.insecureMode? http : https;

    if (self.insecureMode) {
        self._createServer(http, options);
    } else {
        fs.readFile(self.config.sslCert, function(certErr, data) {
            options.cert = data;

            fs.readFile(self.config.sslKey, function(keyErr, data) {
                options.key = data;

                if (certErr) {
                    self.log.error("Failed to read cert data", certErr);
                }

                if (keyErr) {
                    self.log.error("Failed to read key data", keyErr);
                }

                if (options.cert && options.key) {
                    self._createServer(https, options);
                }
            });
        });
    }
};

Ajax.prototype.loadApiKeys = function(callback) {
    var filename = path.join(Configuration.raw.dataDir, Ajax.API_KEY_FILENAME);
    var self = this;
    var callback = callback || function(err){ if (err) { self.log.warn("API key load error:", err); } };

    fs.readFile(filename, function(err, data) {
        if (err) {
            callback(err);
        } else {
            try {
                self.apiKeys = JSON.parse(data) || this.apiKeys;
                callback();
            } catch (err) {
                callback(err);
            }
        }
    });
};

Ajax.prototype.saveApiKeys = function(callback) {
    var filename = path.join(Configuration.raw.dataDir, Ajax.API_KEY_FILENAME);
    var self = this;
    var callback = callback || function(err){ if (err) { self.log.warn("API key save error:", err); } };
    var stringifiedKeys = JSON.stringify(this.apiKeys, null, 4);

    fs.writeFile(filename, stringifiedKeys + "\n", callback);
};

Ajax.prototype.updateApiKey = function(key, flags)  {
    var meta = this.apiKeys[key];

    if (!meta) {
        throw new Error("Tried to update non-existent API key");
    } else {
        meta.flags = flags;
    }
};

Ajax.prototype._callMethod = function(apiCall, args, callback) {
    var args = this._normalizeArgs(args);

    // Instantiate API class object
    var apiClass = new this.apiClasses[apiCall.apiClass](callback, this.coreObjects);
    var apiMethod = apiCall.apiMethod;

    // Set API-defined flags
    // Autoconvert bot ID args to bot objects and require the arg
    var wantsBot = !apiClass.botless;

    // Get key metadata and inject caller's name if available for convenience/logging
    var apiKey = args.key || null;
    var apiKeyMeta = this.apiKeys[apiKey] || null;

    if (apiKeyMeta) {
        apiCall.callerUsername = apiKeyMeta.username;
    }

    // Handle access-level errors or otherwise call method
    if (!apiKeyMeta) {
        callback({error: 401, message: "Invalid key"});
    } else if (!this.isCallAllowed(apiCall, apiKey)) {
        callback({error: 403, message: "No access"});
    } else if (apiMethod[0] == "_") {
        callback({error: 403, message: "Forbidden"});
    } else if (wantsBot && typeof args.bot == "undefined") {
        callback({error: 400, message: "Bot ID required"});
    } else if (wantsBot && !(args.bot = this.coreObjects.manager.get(args.bot))) {
        callback({error: 404, message: "Bot not found"});
    } else {
        try {
            apiClass[apiMethod](args);
        } catch (err) {
            callback({error: 500, message: "API call had internal error", call: apiCall.rawName});
            this.log.error(apiCall.rawName, err);
        }
    }
}

Ajax.prototype._createServer = function(mod, options) {
    if (this.server) {
        return this.server;
    }

    this.server = mod.createServer(options);

    this.server.on("request", this._handleRequest.bind(this));
    this.server.on("listening", this._handleListening.bind(this));
    this.server.on("clientError", this._handleClientError.bind(this));
    this.server.on("error", this._handleError.bind(this));
    this.server.on("close", this._handleClose.bind(this));

    this.server.listen(this.config.port, this.config.host);

    return this.server;
};

Ajax.prototype._endResponse = function(apiCall, response, obj) {
    obj = obj || {};

    var logPrefix = (
        apiCall.callerIp
        + (apiCall.callerUsername? " (" + apiCall.callerUsername + ")" : "")
        + ": " + apiCall.rawName + ": "
    );

    if (obj instanceof Error) {
        obj = {
            error: obj.error || 500,
            message: obj.message
        };
    }

    var statusCode = parseInt(obj.error) || 200;
    var logLine = (obj.message || (statusCode == 200? "OK" : "Internal error")) + " (" + statusCode + ")";
    var logMethod = null;

    switch (statusCode) {
        case 200:
        case 404:
            logMethod = this.log.debug;
            break;
        case 500:
            logMethod = this.log.error;
            break;
        default:
            logMethod = this.log.warn;
            break;
    }

    logMethod(logPrefix + logLine);

    response.setHeader("Content-Type", "application/json");
    response.writeHead(statusCode);
    response.end(JSON.stringify(obj) + "\n");
};

Ajax.prototype._handleError = function(err) {
    this.log.error("server error: " + err.message);
};

Ajax.prototype._handleClientError = function(err, sock) {
    var errString = (err.library || "http") + " client error: " + err.reason + " (" + err.code + ")";
    this.log.error(errString);

    sock.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    sock.destroy();
};

Ajax.prototype._handleClose = function() {
    this.log.info("Closing");
};

Ajax.prototype._handleListening = function() {
    var addr = this.server.address();
    var proto = this.insecureMode? "http" : "https";

    this.log.info("Listening on " + proto + "://" + addr.address + ":" + addr.port + " with " + addr.family);

    if (this.insecureMode) {
        this.log.warn("Running without https");
    }
};

Ajax.prototype._handleRequest = function(request, response) {
    var self = this;
    var apiCall = this._parseCall(request);
    var endResponse = this._endResponse.bind(this, apiCall, response);

    if (!apiCall.resolved) {
        endResponse({error: 404, message: "No such API call", call: apiCall.rawName});
    } else if (apiCall.httpMethod == "post") {
        var rawPostData = "";

        request.on("data", function(data) {
            if (rawPostData.length + data.length > Ajax.MAX_POST_SIZE) {
                endResponse({error: 413, message: "Payload too large"});
                request.connection.destroy();
            } else {
                rawPostData += data;
            }
        });

        request.on("end", function() {
            if (!request.connection.destroyed) {
                self._callMethod(apiCall, qs.parse(rawPostData), endResponse);
            }
        });
    } else {
        self._callMethod(apiCall, apiCall.httpQueryString, endResponse);
    }
};

Ajax.prototype._normalizeArgs = function(args) {
    var newArgs = {};

    Object.keys(args).forEach(function(argKey) {
        var lowerArgKey = argKey.toLowerCase();

        newArgs[lowerArgKey] = args[argKey];
    });

    return newArgs;
};

Ajax.prototype._parseCall = function(request) {
    var parsedUrl = url.parse(request.url, true);
    var pathParts = parsedUrl.pathname.split('/').filter(Boolean);
    var httpMethod = request.method.toLowerCase();

    // Final parsed call, includes non-normalized parsed qs for convenience/reuse
    // Allow sane default class / method names for indexing
    var parsed = {
        httpMethod: httpMethod,
        httpQueryString: parsedUrl.query,
        callerIp: request.socket.remoteAddress || "0.0.0.0",
        rawApiClass: pathParts[0] || Ajax.DEFAULT_CLASS,
        rawApiMethod: httpMethod + (
            (pathParts[1] || Ajax.DEFAULT_METHOD)
            + (pathParts.length > 2? '_' + pathParts.slice(2).join('_') : '')
        )
    };

    // Lookup raw API class
    for (var i = 0, clsNames = Object.keys(this.apiClasses); i < clsNames.length; i++) {
        var clsName = clsNames[i];

        if (clsName.toLowerCase() == parsed.rawApiClass.toLowerCase()) {
            parsed.apiClass = clsName;
            break;
        }
    }

    // Lookup raw method name if class was resolved
    var methodNames = [];

    if (parsed.apiClass) {
        methodNames = Object.keys(this.apiClasses[parsed.apiClass].prototype);
    }

    for (var i = 0; i < methodNames.length; i++) {
        var methodName = methodNames[i];

        if (methodName.toLowerCase() == parsed.rawApiMethod.toLowerCase()) {
            parsed.apiMethod = methodName;
            break;
        }
    }

    // Convenience props for validation and logging
    parsed.resolved = !!(parsed.apiClass && parsed.apiMethod);
    parsed.rawName = (
        (parsed.apiClass || parsed.rawApiClass || "<null>")
        + "." +
        (parsed.apiMethod || parsed.rawApiMethod || "<null>")
    );

    return parsed;
};

module.exports = Ajax;
