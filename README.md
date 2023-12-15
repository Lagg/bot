# Lagg.Bot @ Lagg.Me

IM The Supervisor of Steam accounts written for scalability, reusability and minimalism.

This is my Steam bot manager rewritten to gut the proprietary bits and other
dependency-heavy code highly unlikely to be useful to users. As well as heavy
cleanup.

Please note I won't be able to give much advice/tips outside of this README. It
took quite a bit of time getting it to this state as it is and I'm also still
actively using it. So I'll be spending any time I have for it working on the
project itself most likely. And the codebase is subject to change/improve accordingly.

# Usage

1. Run `npm install`

2. Refer to the Configuration guide and prepare auth files.

3. Run `node init.js` with optional command lines

4. Run commands like `help`

To get a headless bot manager use GNU screen or a similar terminal multiplexing tool.

# Configuration reference

All the below options can be overridden on the command line by using (e.g.) `--data-dir dir --use-ajax true`.
A config filename can be passed via the command line with `--conf <filename>`. Defaults to `config.json`.

See config.json.example for a basic configuration file enabling the bots and the json API.
If no config file is readable the bot manager will start using the minimum runtime defaults.

* `appId`: Default app ID. Used when app IDs are otherwise not given for something. Trying to figure out how to make this redundant.
* `dataDir`: Where to find sentry and 2fa files. Defaults to `data`.
  * Ensure your sentry and 2fa payload files match the format of `<username>.sentry` and `<username>.2fa.json` respectively.
* `logDir`: Where to write log files if desired. Defaults to disabled.
* `logLevel`: Log filter level, `info` for production is recommended. Defaults to `debug`.
* `ajax`: Ajax API opts
  * `host`: Host to bind JSON API listener to. Defaults to `localhost`. Secure proxy like nginx or ssl recommended for exposing to WAN.
  * `port`: JSON API port. Defaults to `5244`.
  * `sslCert`: Path to SSL cert to use for the listener. If null, plain HTTP assumed.
  * `sslKey`: Path to SSL key for the cert. If null, plain HTTP assumed.
  * `enabled`: Whether or not to start the API.
* `proxies`: A list of HTTP proxy URLs to use when possible. Each proxy in the list will be rotated as bots are initialized.
* `bindAddrs`: A list of local interface addresses to bind to if desired. Addresses are rotated similarly to proxies.
* `bots`: A list of `username`s and `password`s to log in to bots with. Optionally supports runtime `personaName`. `dataDir` should contain a sentry and 2fa payload for each username.

# Command reference

At the moment the bot manager runs with a REPL attached to the console that
takes commands for local admin. Including generating keys for Ajax API users.

* `help [term]`: List commands, optional arg filters command names.
* `offer-ls <bot>`: List trade offers for this bot.
* `offer-accept <bot> <offerid>`: Accept the given trade offer on this bot.
* `bot-ls`: List bots
* `bot-trade-url <bot>`: Get or generate this bot's trade URL.
* `bot-steamapi-key <bot>`: Get or generate this bot's Steam API key.
* `bot-add-offline`: Relog offline bots.
* `bot-check-confirmations <bot>`: Queue this bot for a confirmation check.
* `api-*`: Commands for managing Ajax API access and config.

In general this documentation is a TODO I will get to ASAP when not actively working on a project. Sry.

# Ajax API

My goal with lagg.bot is more or less to provide a minimal client/proxy that
only does what it needs to in places actually requiring the Steam client. Or
where Valve otherwise did a bad job providing API endpoints.

To this end, the main IPC method with the manager for making trades and doing
account mangement is a tiny JSON API.

The `api-key-*` commands are for managing the keys used to control API access
to avoid unauthorized use. And also have some level of access control support
implemented.

As a whole further documentation on this including actual endpoints is a TODO I
will get to ASAP when not actively working on a project. Sry again.

# Trivia

I feel it's worth noting that part of the reason I waited until now to open the
sauce was lack of time to do the reimplementation in a way that respected past
colleagues. As well as Valve and the community at large by not making things
easy to abuse. But the last few years of Valve's user-hostile behavior made the
decision to get around to it (and delete my main/real Steam account) **much**
easier. Also, being an Official TF Wiki staff member until '22 also made
gestures/projects like this... Awkward.

# Thanks

To @DoctorMcKay and his extremely useful libs saving me **many** hours and lines of code.

To my colleagues past, present and future that give me the honor of being paid for poking at Steam data in cool ways.

To Valve for making this fun in the first place. Even if they're mistaking app store paradigms/user-hostility for fun lately.
