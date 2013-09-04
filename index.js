// Currently limited to a single instance due to dependency on Appy.
// TODO: consider making appy support multiple instances or removing
// the need for Appy

var appy = require('appy');
var async = require('async');
var uploadfs = require('uploadfs');
var fs = require('fs');
var path = require('path');
var _ = require('underscore');
var extend = require('extend');

module.exports = function(options) {
  return new AposSite(options);
};

function AposSite(options) {
  var self = this;

  self.apos = require('apostrophe')();
  self.root = options.root;
  self.rootDir = path.dirname(self.root.filename);

  // Fetch local overrides for this server, like minify: true or uploadfs configuration
  if (fs.existsSync(self.rootDir + '/data/local.js')) {
    var local = require(self.rootDir + '/data/local.js');
    extend(true, options, local);
  }

  self.uploadfs = uploadfs();

  if (!self.root) {
    throw 'Specify the `root` option and set it to `module` (yes, really)';
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
  self.imageSizes = self.apos.defaultImageSizes;
  if (options.imageSizes) {
    self.imageSizes = options.imageSizes;
  }
  if (options.addImageSizes) {
    self.imageSizes = self.imageSizes.concat(options.addImageSizes);
  }
  if (!options.sessionSecret) {
    throw "Specify the `sessionSecret` option. This should be a secure password not used for any other purpose.";
  }
  self.sessionSecret = options.sessionSecret;
  self.locals = options.locals || {};
  self.minify = options.minify;

  var uploadfsDefaultSettings = {
    backend: 'local',
    uploadsPath: self.rootDir + '/public/uploads',
    uploadsUrl: '/uploads',
    tempPath: self.rootDir + '/data/temp/uploadfs',
    // Register Apostrophe's standard image sizes. Notice you could
    // concatenate your own list of sizes if you had a need to
    imageSizes: self.imageSizes
  };
  uploadfsSettings = {};
  extend(true, uploadfsSettings, uploadfsDefaultSettings);
  extend(true, uploadfsSettings, options.uploadfs || {});

  appy.bootstrap({
    // Don't bother with viewEngine, we'll use apos.partial() if we want to
    // render anything directly
    auth: self.apos.appyAuth({
      loginPage: function(data) {
        return self.pages.decoratePageContent({ content: self.apos.partial('login', data), when: 'anon' });
      },
      redirect: function(user) {
        if (options.redirectAfterLogin) {
          return options.redirectAfterLogin(user);
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
      name: (options.db && options.db.name) || options.shortName,
      collections: (options.db && options.db.collections) || []
    },

    // Supplies LESS middleware
    static: self.rootDir + '/public',

    ready: function(appArg, dbArg)
    {
      self.app = appArg;
      self.db = dbArg;

      async.series([ createTemp, initUploadfs, initApos, initPages, initModules, bridgeModules, setRoutes, servePages, pushAssets, endAssets, afterInit ], go);
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
      partialPaths: [ self.rootDir + '/views/global' ],
      minify: self.minify
    }, callback);
  }

  function initPages(callback) {
    var pagesOptions = {};
    extend(true, pagesOptions, options.pages);
    pagesOptions.apos = self.apos;
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
      _.defaults(config, {
        app: self.app,
        apos: self.apos,
        pages: self.pages
      });
      var localFolder = self.rootDir + '/lib/modules/' + name;
      var localIndex = localFolder + '/index.js';
      var npmName = config.extend || name;
      var localFound = false;
      var npmFound = false;
      // Factory function accepts options and callback, returns an object to manage this module
      var factory;
      if (!fs.existsSync(localFolder)) {
        // Directly installing an npm module with no subclassing of any kind,
        // not even a folder with alternate templates. That's allowed
        factory = self.root.require(npmName);
        npmFound = true;
      } else {
        localFound = true;
        // Module exists locally. Was it also installed via npm? If so, subclass
        var base;
        try {
          base = self.root.require(npmName);
          npmFound = true;
        } catch (e) {
          // That's OK, this module simply only exists locally
        }
        if (!base) {
          // Exists locally only (well, it had better)
          try {
            factory = require(localIndex);
          } catch (e) {
            console.error('Unable to find ' + localIndex + '. Either you forgot to npm install something, or you forgot to set the extend property for this module.');
            throw e;
          }
        } else {
          // Inject a subclass at this point which provides the
          // right folder name for templates, so we can skip
          // index.js locally entirely or have one that doesn't bother
          // with that tedious step
          var InlineConstruct = function(optionsArg, callback) {
            var self = this;
            // Locate the constructor of the base. This ought to be
            // base.Construct but we didn't think that far ahead, so
            // figure it out if necessary
            var Super = base.Construct;
            if (!Super) {
              var npmConstructor = guessConstructor(npmName);
              Super = base[npmConstructor];
              if (!Super) {
                throw "Unable to figure out constructor function name for the module " + npmName + ", my best guess was " + npmConstructor + ". This module must export a function that returns an object when given options and a callback, and the constructor for use when subclassing should be the Construct property of that function, or a property named " + npmConstructor + ". If you get this error for an Apostrophe module please report it as a bug.";
              }
            }
            var options = {};
            extend(true, options, optionsArg);
            // We use guessConstructor to come up with a reasonable URL for assets
            // served by this local module, prefixing it with 'my'. It'll also get passed
            // through apos.cssName. So "apostrophe-blog" becomes /my-blog.
            var myConstructor = guessConstructor(name);
            options.modules = (options.modules || []).concat([{ dir: localFolder, name: 'my' + myConstructor }]);
            return Super.call(self, options, callback);
          };
          var inlineFactory = function(options, callback) {
            return new InlineConstruct(options, callback);
          };
          inlineFactory.Construct = InlineConstruct;
          // If there is a local subclass, require it and inject our inline class
          // as its superclass
          if (fs.existsSync(localIndex)) {
            factory = require(localIndex);
            // Make our inline subclass available to the module. It's OK if the
            // module doesn't care and does its own requiring and subclassing,
            // but this sure is convenient
            factory.Super = InlineConstruct;
          } else {
            // No local index.js, just template overrides etc. Use the
            // inline class directly
            factory = inlineFactory;
          }
        }
      }

      // What should the constructor on the browser side be called?
      // And what should it extend?
      //
      // apostrophe-snippets is smart enough to synthesize it if needed

      if (npmFound && localFound) {
        if (!config.browser) {
          config.browser = {};
        }
        if (!config.browser.construct) {
          if (name === npmName) {
            // Emphasizes we're subclassing something with an otherwise similar name
            config.browser.construct = 'My' + guessConstructor(name);
          } else {
            config.browser.construct = guessConstructor(name);
          }
        }
        if (!config.browser.baseConstruct) {
          // Browser-side constructors from npm always start with Apos
          config.browser.baseConstruct = 'Apos' + guessConstructor(npmName);
        }
      }

      if (factory.length === 1) {
        // Requires no callback. Replace it with a wrapper that does
        var originalFactory = factory;
        factory = function(config, callback) {
          setImmediate(function() {
            return callback(null);
          });
          return originalFactory(config);
        };
      }
      self.modules[name] = factory(config, function(err) {
        if (err) {
          console.error("Error configuring module " + name);
          throw err;
        }
        if (!self.modules[name]) {
          throw 'No module found for ' + name;
        }
        return callback(null);
      });
    }, callback);
  }

  // If a module is interested, give it a reference to the other modules.
  // This allows the groups module to access the people module, for instance.
  function bridgeModules(callback) {
    _.each(self.modules, function(module, name) {
      if (module.setBridge) {
        module.setBridge(self.modules);
      }
    });
    return callback(null);
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
    // Always set up the page loaders for any active modules that have them,
    // and for a virtual page named "global" which is super handy for footers etc.

    var loaders = [ 'global', self.pages.searchLoader ];

    _.each(self.modules, function(module, name) {
      if (module.loader) {
        loaders.push(module.loader);
      }
    });

    // Append any configured page loaders
    if (options.pages && options.pages.load) {
      loaders = loaders.concat(options.pages.load);
    }

    // Extend sensible defaults with custom settings
    var pagesOptions = {};
    extend(true, pagesOptions, {
      templatePath: self.rootDir + '/views/pages'
    });
    extend(true, pagesOptions, options.pages || {});

    // The merged loaders must win
    pagesOptions.load = loaders;

    var serve = self.pages.serve(pagesOptions);

    // All this does is call app.get('*', ... some middleware ... , serve) but
    // since the middleware option is an array we need to build a complete
    // array of options and use app.get.apply

    var appGetArguments = [ '*' ];
    appGetArguments = appGetArguments.concat(pagesOptions.middleware || []);
    appGetArguments.push(serve);
    self.app.get.apply(self.app, appGetArguments);

    return callback(null);
  }

  function pushAssets(callback) {
    _.each((options.assets && options.assets.stylesheets) || [], function(name) {
      pushAsset('stylesheet', name);
    });
    _.each((options.assets && options.assets.scripts) || [], function(name) {
      pushAsset('script', name);
    });
    function pushAsset(type, name) {
      return self.apos.pushAsset(type, name, self.rootDir, '');
    }
    return callback();
  }

  function endAssets(callback) {
    return self.apos.endAssets(callback);
  }

  function afterInit(callback) {
    if (options.afterInit) {
      return options.afterInit(callback);
    }
    return callback(null);
  }

  function go(err) {
    if (err) {
      throw err;
    }
    // Command line tasks
    if (self.apos.startTask(options.tasks || {})) {
      // Chill and let the task run until it's done, don't try to listen or exit
      return;
    }
    return appy.listen();
  }

  // Convert a module name to the probable name of its constructor property
  // (we look for Construct first, as newer modules go that way)
  function guessConstructor(name) {
    name = name.replace(/^apostrophe\-/, '');
    return self.apos.capitalizeFirst(self.apos.camelName(name));
  }
}
