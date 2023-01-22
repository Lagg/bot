// Copyright 2015+ Anthony Garcia <anthony@lagg.me>

global._mckay_statistics_opt_out = true;

var Core = require("./lib/core");

(function() {
    if (require.main !== module) {
        return;
    } else {
        (new Core).initConfigured();
    }
})();
