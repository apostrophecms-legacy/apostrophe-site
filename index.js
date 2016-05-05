// Currently limited to a single instance due to dependency on Appy.
// TODO: consider making appy support multiple instances or removing
// the need for Appy

var appy = require('appy');
var async = require('async');
var uploadfs = require('uploadfs');
var fs = require('fs');
var path = require('path');
var _ = require('lodash');
var extend = require('extend');
var nodemailer = require('nodemailer');
var schemas = require('apostrophe-schemas');
var i18n = require('i18n');
var argv = require('optimist').argv;

module.exports = function(options) {
  return new AposSite(options);
};

function AposSite(options) {
  var self = this;

  self.init = function(options) {

    self.options = options;

    var localJsLocals = {};
    self.apos = require('apostrophe')();
    self.root = options.root;
    self.rootDir = path.dirname(self.root.filename);

    // stagecoach typically launches apostrophe via forever and does so with a full path to app.js.
    // Newer versions of forever chdir to / when you do this, which breaks apostrophe-browserify.
    // Resolving this by consistently changing directory to the app at startup. -Tom and Jimmy
    process.chdir(self.rootDir);

    self.prefix = options.prefix || '';

    // The apostrophe:generate task is implemented directly
    // here because it must generate a new asset generation
    // ID file before the regular bootstrap process of the
    // Apostrophe module can begin. TODO: this is a messy hack,
    // think about a more elegant way. -Tom

    self.generating = (argv._[0] === 'apostrophe:generation');

    var generation;

    if (self.generating) {
      // New asset generation file. Now the regular
      // asset builder mechanisms will do the rest of the work.
      //
      // Do not put it in the data/ folder, we want it to be
      // deployment-specific.
      generation = self.apos.generateId();
      fs.writeFileSync(self.rootDir + '/data/generation', generation);
    }

    // If you don't like our default set of allowed tags and attributes. This must
    // be generous enough to encompass at least all the tags in your styles menu, etc.
    self.sanitizeHtmlOptions = options.sanitizeHtml;

    // Fetch local overrides for this server, like minify: true or uploadfs configuration
    if (fs.existsSync(self.rootDir + '/data/local.js')) {
      var local = require(self.rootDir + '/data/local.js');
      // There may be nunjucks locals; if we just merge them in, we'll
      // clobber options.locals if it is a function. Set it aside to
      // merge later. -Tom
      localJsLocals = local.locals;
      delete local.locals;
      extend(true, options, local);
    }

    // The deployment system populates this file with a
    // shared unique ID for this deployment of the app.
    // If not, Apostrophe will gracefully fall back to
    // an identifier that is sufficiently unique for
    // single-process operation.

    if (fs.existsSync(self.rootDir + '/data/generation')) {
      generation = fs.readFileSync(self.rootDir + '/data/generation', 'utf8');
      generation = generation.replace(/[^\d]/g, '');
      if (generation.length) {
        options.generation = generation;
      }
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
    self.title = options.title;
    self.sessionSecret = options.sessionSecret;
    self.locals = options.locals || {};
    if (typeof(self.locals) === 'function') {
      // We need access to the site object inside a function
      self.locals = self.locals(self);
    }
    extend(true, self.locals, localJsLocals);
    _.defaults(self.locals, {
      siteTitle: self.title,
      shortName: self.shortName,
      hostName: self.hostName
    });
    self.minify = options.minify;

    if (!options.baseUrl) {
      if (options.hostName) {
        options.baseUrl = 'http://' + options.hostName;
      }
    }

    var uploadfsDefaultSettings = {
      backend: 'local',
      uploadsPath: self.rootDir + '/public/uploads',
      uploadsUrl: options.absoluteUrls ? (options.baseUrl + self.prefix + '/uploads') : (self.prefix + '/uploads'),
      tempPath: self.rootDir + '/data/temp/uploadfs',
      // Register Apostrophe's standard image sizes. Notice you could
      // concatenate your own list of sizes if you had a need to
      imageSizes: self.imageSizes
    };
    uploadfsSettings = {};
    extend(true, uploadfsSettings, uploadfsDefaultSettings);
    extend(true, uploadfsSettings, options.uploadfs || {});
    if (options.uploadsUrl) {
      // for bc
      uploadfsSettings.uploadsUrl = options.uploadsUrl;
    }

    var mailerOptions = options.mailer || {};
    _.defaults(mailerOptions, {
      transport: 'sendmail',
      transportOptions: {},
    });

    self.mailer = nodemailer.createTransport(mailerOptions.transport, mailerOptions.transportOptions);

    // Expose additional options via the mailer object as a workaround
    // for all this apostrophe-site silliness. -Tom
    self.mailer.aposOptions = {};
    _.assign(self.mailer.aposOptions, _.omit(mailerOptions, 'transport', 'transportOptions'));

    var i18nOptions = options.i18n || {};
    _.defaults(i18nOptions, {
      locales: ['en'],
      cookie: 'apos_language',
      directory: self.rootDir + '/locales'
    });

    i18n.configure(i18nOptions);

    var middleware = _.map(options.middleware || [], function(fn) {
      return addSiteToMiddleware(fn);
    });

    var moduleMiddleware;

    // Middleware that allows all the individual modules to
    // have middleware too
    middleware.push(function(req, res, next) {
      if (!moduleMiddleware) {
        moduleMiddleware = [];
        // We build this array only once, on the first invocation
        _.each(self.modules, function(module) {
          if (module.middleware) {
            moduleMiddleware = moduleMiddleware.concat(module.middleware);
          }
        });
        moduleMiddleware = _.map(moduleMiddleware, addSiteToMiddleware);
      }
      // Implement the next() callback chain for the module middleware
      var n = 0;
      function iterate() {
        if (n < moduleMiddleware.length) {
          return moduleMiddleware[n++](req, res, iterate);
        }
        return next();
      }
      iterate();
    });

    if (!self.options.sessionCore) {
      self.options.sessionCore = {};
    }
    if (!self.options.sessionCore.key) {
      // distinguish our sid, useful if multiple a2 apps are on one domain
      self.options.sessionCore.key = self.options.shortName + '.sid';
    }
    if (!self.options.sessionCore.cookie) {
      self.options.sessionCore.cookie = { httpOnly: true, secure: false, maxAge: null };
    }
    if (!self.options.sessionCore.cookie.path) {
      var cookiePath = '/';
      if (self.prefix) {
        cookiePath = self.prefix;
      }
      self.options.sessionCore.cookie.path = cookiePath;
    }

    var appyOptions = {
      passport: options.passport,

      rootDir: self.rootDir,

      // Allows gzip transfer encoding to be shut off if desired
      compress: options.compress,

      // Split CSS files when too large for <=IE9, but only
      // if requested
      bless: options.bless,

      auth: (options.auth === undefined) ? self.apos.appyAuth({
        loginPage: function(data, req) {
          // TODO: this is a hack and doesn't allow for some other module to
          // supply the password reset capability
          if (self.modules['apostrophe-people']) {
            data.resetAvailable = true;
          }
          return self.apos.decoratePageContent({ content: self.apos.partial(req, 'login', data), when: 'anon' }, req);
        },
        // Where to go after logging in
        redirect: function(req, callback) {
          return self.apos.authRedirectAfterLogin(req, callback);
        },
        adminPassword: self.adminPassword
      }) : options.auth,

      beforeSignin: self.apos.appyBeforeSignin,

      sessionSecret: self.sessionSecret,

      db: {
        uri: (options.db && options.db.uri) || undefined,
        host: (options.db && options.db.host) || 'localhost',
        port: (options.db && options.db.port) || 27017,
        name: (options.db && options.db.name) || options.shortName,
        user: (options.db && options.db.user) || undefined,
        password: (options.db && options.db.password) || undefined,
        collections: (options.db && options.db.collections) || []
      },

      address: options.address,
      port: options.port,

      // Supplies LESS middleware
      static: self.rootDir + '/public',

      middleware: [ i18n.init ].concat(middleware),

      prefix: self.prefix,

      ready: function(appArg, dbArg)
      {
        self.app = appArg;
        self.db = dbArg;

        async.series([ createTemp, initUploadfs, initApos, initSchemas, initPages, initModules, bridgeModules, setRoutes, servePages, endAssets, afterInit ], go);
      },

      // allow arguments to be passed to the session store and the
      // core session middleware. For bc accept .sessions as sessionStore

      sessionStore: self.options.sessionStore || self.options.sessions,
      sessionCore: self.options.sessionCore
    };

    // Ability to pass options directly to appy, take care as this can crush things above that matter
    if (options.appy) {
      _.assign(appyOptions, options.appy);
    }
    appy.bootstrap(appyOptions);

    function addSiteToMiddleware(fn) {
      if (fn.length > 3) {
        return function(req, res, next) {
          return fn(self, req, res, next);
        };
      } else {
        return fn;
      }
    }

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
      // Let the apostrophe module know to pass the site object as the first
      // argument to tasks that accept a fourth argument
      self.apos._site = self;
      // for bc
      self.apos._taskContext = self;

      return self.apos.init({
        db: self.db,
        app: self.app,
        bless: options.bless,
        uploadfs: self.uploadfs,
        locals: self.locals,
        filterTag: options.filterTag,
        // Allows us to extend shared layouts
        partialPaths: [ self.rootDir + '/views/global' ],
        minify: self.minify,
        sanitizeHtml: self.sanitizeHtmlOptions,
        mediaLibrary: options.mediaLibrary || {},
        lockups: options.lockups || {},
        afterGet: options.afterGet,
        rootDir: self.rootDir,
        workflow: options.workflow,
        configureNunjucks: options.configureNunjucks,
        secondChanceLogin: options.secondChanceLogin,
        redirectAfterLogin: options.redirectAfterLogin,
        lockTags: options.lockTags,
        files: options.files,
        prefix: self.prefix,
        prefixCssUrls: appy.prefixCssUrls,
        oembedWhitelist: options.oembedWhitelist,
        generation: options.generation,
        baseUrl: options.baseUrl,
        absoluteUrls: options.absoluteUrls,
        maxLoaderRecursion: options.maxLoaderRecursion
      }, callback);
    }

    function initSchemas(callback) {
      var schemasOptions = {};
      extend(true, schemasOptions, options.schemas);
      schemasOptions.apos = self.apos;
      schemasOptions.app = self.app;
      // Allows lib/modules/apostrophe-schemas/views to override
      // views for schema field types
      schemasOptions.modules = (schemasOptions.modules || []).concat([ { dir: self.rootDir + '/lib/modules/apostrophe-schemas', name: 'mySchemas' } ]);
      self.schemas = require('apostrophe-schemas')(schemasOptions, callback);
    }

    function initPages(callback) {
      var pagesOptions = {};
      extend(true, pagesOptions, options.pages);

      pagesOptions.apos = self.apos;
      pagesOptions.app = self.app;
      pagesOptions.schemas = self.schemas;
      // Allows lib/modules/apostrophe-pages/views to override
      // views for newPageSettings.html, etc.
      pagesOptions.modules = (pagesOptions.modules || []).concat([ { dir: self.rootDir + '/lib/modules/apostrophe-pages', name: 'myPages' } ]);
      self.pages = require('apostrophe-pages')(pagesOptions, function(err) {
        if (err) {
          return callback(err);
        }
        self.schemas.setPages(self.pages);
        return callback(null);
      });
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
          site: self,
          app: self.app,
          apos: self.apos,
          pages: self.pages,
          schemas: self.schemas,
          mailer: self.mailer
        });
        var localFolder = self.rootDir + '/lib/modules/' + name;
        var localIndex = localFolder + '/index.js';
        var npmName = config.extend || name;
        var localFound = false;
        var npmFound = false;
        // Factory function accepts options and callback, returns an object to manage this module
        var factory;
        if ((!fs.existsSync(localFolder)) && (!config.extend)) {
          // Directly installing an npm module with no subclassing of any kind,
          // not even a folder with alternate templates. That's allowed
          factory = self.root.require(npmName);
          npmFound = true;
        } else {
          localFound = true;
          // Module exists locally. Was it also installed via npm?
          // If so, subclass
          var base;
          try {
            base = self.root.require(npmName);
            npmFound = true;
          } catch (e) {
            // Real problems need to be really visible.
            // Unfortunately we have to resort to examining the
            // error message to distinguish MODULE_NOT_FOUND for
            // the module itself (which is fine) from MODULE_NOT_FOUND
            // for one of its dependencies (which is not cool).
            if (((e.code !== 'MODULE_NOT_FOUND') || (e.toString().indexOf('\'' + npmName + '\'')) === -1)) {
              throw e;
            }
            // That's OK, this module simply only exists locally
          }
          if (!base) {
            // Exists locally only (well, it had better)
            try {
              factory = require(localIndex);
            } catch (e) {
              console.error('Unable to find ' + localIndex + ', or an error took place in that file (see below). Perhaps you forgot to npm install something, or you forgot to set the extend property for this module.');
              throw e;
            }
          } else {
            // Inject a subclass at this point which provides the
            // right folder name for templates, so we can skip
            // index.js locally entirely or have one that doesn't bother
            // with that tedious step

            // For access to the apostrophe-site instance
            var site = self;

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
      if (self.apos.isTask()) {
        return callback(null);
      }
      // Always set up the page loaders for any active modules that have them,
      // and for a virtual page named "global" which is super handy for
      // footers etc.

      var loaders = [ 'global' ];

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
        templatePath: self.rootDir + '/views/pages',
        secondChanceLogin: options.secondChanceLogin
      });
      extend(true, pagesOptions, options.pages || {});

      // The merged loaders must win
      pagesOptions.load = loaders;

      // Allow each module to take a crack
      // at handling 404 not found. Let the
      // app level code have a go at it too

      var appNotfound = pagesOptions.notfound;
      pagesOptions.notfound = function(req, finalCallback) {
        var handlers = [];
        _.each(self.modules, function(module) {
          if (module.notfound) {
            handlers.push(module.notfound);
          }
        });
        if (appNotfound) {
          handlers.push(appNotfound);
        }
        return async.eachSeries(handlers, function(handler, callback) {
          return handler(req, function(err) {
            if (err) {
              return callback(err);
            }
            if (req.redirect || (!req.notfound)) {
              // Handled!
              return finalCallback(null);
            }
            return callback(null);
          });
        }, finalCallback);
      };

      if (options.secondChanceLogin === true) {
        // Make a note of the most recent Apostrophe page they saw,
        // to redirect to after login
        pagesOptions.updateAposAfterLogin = true;
      }

      var serve = self.pages.serve(pagesOptions);

      // All this does is call app.get('*', ... some middleware ... , serve) but
      // since the middleware option is an array we need to build a complete
      // array of options and use app.get.apply

      var appGetArguments = [ '*' ];
      appGetArguments = appGetArguments.concat(_.map(pagesOptions.middleware || []));
      // Allow each module to add pages.serve middleware too via
      // the pageMiddleware option. See also the plain ol' "middleware"
      // option, which runs on *all* requests like regular Express middleware
      _.each(self.modules, function(module, name) {
        if (module.pageMiddleware) {
          appGetArguments = appGetArguments.concat(module.pageMiddleware);
        }
      });
      appGetArguments.push(serve);
      self.app.get.apply(self.app, appGetArguments);

      return callback(null);
    }

    function pushAssets() {
      if (self.apos.isTask() && (!self.generating)) {
        return;
      }
      _.each((options.assets && options.assets.stylesheets) || [], function(name) {
        if (typeof(name) === 'object') {
          pushAsset('stylesheet', name.name, name);
        } else {
          pushAsset('stylesheet', name, {});
        }
      });
      _.each((options.assets && options.assets.scripts) || [], function(name) {
        if (typeof(name) === 'object') {
          pushAsset('script', name.name, name);
        } else {
          pushAsset('script', name, {});
        }
      });
      function pushAsset(type, name, _options) {
        var options = {
          fs: self.rootDir,
          web: '',
          when: 'always'
        };
        extend(true, options, _options);
        return self.apos.pushAsset(type, name, options);
      }
    }

    function endAssets(callback) {
      if (self.apos.isTask() && (!self.generating)) {
        return callback(null);
      }
      // We are the last to add a handler, so our
      // assets go last
      self.apos.on('beforeEndAssets', pushAssets);
      return async.series({
        beforeEndAssets: function(callback) {
          if (!options.beforeEndAssets) {
            return callback(null);
          }
          return options.beforeEndAssets(callback);
        },
        // now we're ready to let apostrophe minify, etc.
        endAssets: function(callback) {
          return self.apos.endAssets(callback);
        }
      }, callback);
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
      if (self.generating) {
        // An internally implemented task
        process.exit(0);
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
  };

  if (options) {
    self.init(options);
  }
  return self;
}
