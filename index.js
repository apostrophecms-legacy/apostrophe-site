var appy = require('appy');
var async = require('async');
var uploadfs = require('uploadfs');
var fs = require('fs');
var apos = require('apostrophe')();
var _ = require('underscore');
var extend = require('extend');
var appy = require('appy');
var apostrophe = require('apostrophe');
var pages = require('apostrophe-pages');

module.exports = function(options) {
  return new AposSite(options);
};

function AposSite(options) {
  var self = this;

  self.apos = apostrophe();
  self.root = options.root;
  self.uploadfs = uploadfs();
  if (!self.root) {
    throw 'Specify the `root` option and set it to __dirname';
  }
  self.shortName = options.shortName;
  if (!self.shortName) {
    throw "Specify the `shortName` option and set it to the name of your project's repository or folder";
  }
  self.hostName = options.hostName;
  if (!self.hostName) {
    throw "Specify the `hostName` option and set it to the preferred hostname of your site, such as mycompany.com";
  }
  self.adminPassword = options.adminPassword;
  if (!self.adminPassword) {
    throw "Specify the `adminPassword` option and set it to a secure password for admin access. This account is always valid in addition to accounts in the database";
  }
  self.imageSizes = apos.defaultImageSizes;
  if (options.imageSizes) {
    if (options.imageSizes.$append) {
      self.imageSizes = self.imageSizes.concat(options.imageSizes);
    } else {
      self.imageSizes = options.imageSizes;
    }
  }
  if (!options.sessionSecret) {
    throw "Specify the `sessionSecret` option. This should be a secure password not used for any other purpose.";
  }
  self.sessionSecret = options.sessionSecret;
  self.locals = options.locals || {};
  self.minify = options.minify;

  var uploadfsDefaultSettings = {
    backend: 'local',
    uploadsPath: self.root + '/public/uploads',
    uploadsUrl: '/uploads',
    tempPath: self.root + '/data/temp/uploadfs',
    // Register Apostrophe's standard image sizes. Notice you could
    // concatenate your own list of sizes if you had a need to
    imageSizes: apos.defaultImageSizes.concat([])
  };
  uploadfsSettings = {};
  extend(true, uploadfsSettings, uploadfsDefaultSettings);
  extend(true, uploadfsSettings, options.uploadfs || {});

  appy.bootstrap({
    // Don't bother with viewEngine, we'll use apos.partial() if we want to
    // render anything directly
    auth: self.apos.appyAuth({
      loginPage: function(data) {
        return self.modules.pages.decoratePageContent({ content: apos.partial('login', data), when: 'anon' });
      },
      redirect: function(user) {
        if (options.redirectAfterLogin) {
          return options.redirectAfterLogin();
        }
        return '/';
      },
      adminPassword: self.adminPassword
    }),

    beforeSignin: self.apos.appyBeforeSignin,

    sessionSecret: self.sessionSecret,

    db: {
      host: (options.db && options.db.host) || 'localhost',
      port: (options.db && options.db.port) || 27017,
      collections: (options.db && options.db.collections) || []
    },

    // Supplies LESS middleware
    static: self.root + '/public',

    ready: function(appArg, dbArg)
    {
      self.app = appArg;
      self.db = dbArg;

      async.series([ createTemp, initUploadfs, initApos, initModules, bridgeModules, setRoutes ], listen);
    }
  });

  function createTemp(callback) {
    ensureDir(uploadfsSettings.tempPath);
    return callback(null);
  }

  function initUploadfs(callback) {
    self.uploadfs.init(uploadfsSettings, callback);
  }

  function ensureDir(p) {
    var needed = [];
    while (!fs.existsSync(p)) {
      needed.unshift(p);
      p = path.dirname(p);
    }
    _.each(needed, function(p) {
      fs.mkdirSync(p);
    });
  }

  function initApos(callback) {
    return self.apos.init({
      db: self.db,
      app: self.app,
      uploadfs: self.uploadfs,
      locals: self.locals,
      // Allows us to extend shared layouts
      partialPaths: [ self.root + '/views/global' ],
      minify: self.minify
    }, callback);
  }

  function initPages(callback) {
    var pagesOptions = {};
    extend(true, pagesOptions, options.pages);
    pagesOptions.app = self.apos;
    pagesOptions.app = self.app;
    self.pages = require('apostrophe-pages')(pagesOptions, callback);
  }

  function initModules(callback) {
    self.modules = {};
    var modulesConfig = options.modules || [];
    if ((!modulesConfig) || Array.isArray(modulesConfig)) {
      throw "modules option must be an object with a property for each module. The property name must be the name of the module, such as \"apostrophe-twitter\", and the value must be an object which may contain options. An empty object is acceptable for some modules.";
    }
    return async.eachSeries(_.keys(modulesConfig), function(name, callback) {
      var config = modulesConfig[name];
      var local = root + '/lib/modules/' + name + '/index.js';
      var factory;
      if (fs.existsSync(local)) {
        factory = require(local);
      } else {
        factory = require(name);
      }
      self.modules[name] = factory(config, function(err) {
        if (err) {
          console.error("Error configuring module " + name);
          throw err;
        }
        return callback(null);
      });
    }, callback);
  }

  // If a module is interested, give it a reference to the other modules.
  // This allows the groups module to access the people module, for instance.
  function bridgeModules(callback) {
    _.each(self.modules, function(module, name) {
      if (module.setModules) {
        module.setModules(self.modules);
      }
    });
  }

  // Last chance to set routes before the wildcard route for pages
  function setRoutes(callback) {
    if (options.setRoutes) {
      return options.setRoutes(callback);
    } else {
      return callback(null);
    }
  }

  function servePages(callback) {
    // Always set up the page loaders for any active modules that have them
    var loaders = [];

    _.each(self.modules, function(module) {
      if (module.loader) {
        loaders = loaders.push(module.loader);
      }
    });

    // Append any configured page loaders
    if (options.pages && options.pages.loaders) {
      loaders = loaders.concat(options.loaders);
    }

    // Extend sensible defaults with custom settings
    var pagesOptions = {};
    extend(true, pagesOptions, {
      templatePath: __dirname + '/views/pages'
    });
    extend(true, pagesOptions, options.pages || {});

    // The merged loaders must win
    pagesOptions.loaders = loaders;

    var serve = pages.serve(pagesOptions);

    // All this does is call app.get('*', ... some middleware ... , serve) but
    // since the middleware option is an array we need to build a complete
    // array of options and use app.get.apply

    var appGetArguments = [ '*' ];
    appGetArguments = appGetArguments.concat(pagesOptions.middleware || []);
    appGetArguments.push(serve);
    app.get.apply(app, appGetArguments);

    // Before we invoke the page server, check for
    // old-format URLs and hard redirects.

    // TODO: this wrapper for hard redirects should become
    // a middleware function, which pages.serve should support.
    // Then it can move into an apostrophe-redirects module.

  return callback(null);
}
