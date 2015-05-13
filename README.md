# Apostrophe Site

The Apostrophe Site module makes it easy to build websites with the [Apostrophe](http://github.com/punkave/apostrophe) content management system for Node.

## Installation

It is easiest to start by cloning the [Apostrophe sandbox project](http://github.com/punkave/apostrophe-sandbox) and pushing it up to your own repository. But skipping that step is pretty easy too. Let's assume you're starting from scratch.

Apostrophe itself requires:

* [node](http://nodejs.org/), of course. You must have at least version `0.10`
* [mongodb](http://www.mongodb.org/) **version 2.2 or better**, on your local machine (or point to another database server)
* imagemagick, to resize uploaded images (specifically the `convert` and `identify` command line tools)

Create a new git project, then run `npm install apostrophe-site` to install the module.

## Configuring Your Site

Here's an `app.js` that demonstrates most of the options. Most of this is optional, of course. `root`, `shortName`, `hostName`, `adminPassword` and `sessionSecret` are required, and you almost certainly will want to add a few modules. You shoudl also set `baseUrl` if the protocol for your site is not HTTP. Everything else is totally skippable.

```javascript

    var site = require('apostrophe-site')({
      // Allows apostrophe-sites to require stuff
      // on our behalf and also find our root folder
      root: module,

      // Used to name the local mongodb database,
      // if you don't pass a db option with more details
      shortName: 'mysite',

      // Hostname you plan to give your site
      hostName: 'mysite.com',

      // If we don't set this, we get http://mysite.com
      baseUrl: 'https://mysite.com',

      // Title of your site. Used as a prefix to page titles and feed titles by default
      title: 'My Site',

      // This defaults to true and delivers HTML, CSS and JS much faster via
      // gzip transfer encoding. But you can set it to false if you must
      compress: true,

      // Apostrophe sizes your images to several awesome sizes right out of the box,
      // but we're greedy and we want something bigger than full (1280)
      addImageSizes: [
        {
          name: 'max',
          width: 1600,
          height: 1280
        }
      ],

      // By default the media library shows everyone's media until the user decides to
      // change that with the "uploaded by" filter. Want the default to go the other way?
      // Set the "owner" option as shown commented out below

      mediaLibrary: {
        // owner: 'user'
      },

      // Normally anyone who can edit a page or article etc. might
      // introduce new tags. If this is set true, new tags can only
      // be introduced via the admin tag editor
      lockTags: false,

      // Set up email transport via nodemailer. By default sendmail is used because
      // it requires no configuration, but you may use any valid transport, see the
      // nodemailer module documentation.

      mailer: {
        transport: 'sendmail',
        transportOptions: {}
      },

      // You can always log in at /login as admin, with this password
      adminPassword: 'SOMETHING SECURE PLEASE',

      // If a visitor tries to access a secured page, give them
      // a chance to log in and then be redirected to that page
      secondChanceLogin: true,

      // Invoked after login if secondChanceLogin is not set or
      // did not result in a page the user was allowed to see
      redirectAfterLogin: function(req, callback) {
        if (req.user.permissions.admin) {
          return callback('/awesomepeople');
        } else {
          return callback('/coolpeople');
        }
      },

      // Run some middleware on ALL requests. This happens AFTER
      // basics are in place like sessions and users and i18n.
      // Middleware functions here may take an initial "site" argument
      // in addition to req, res, next. Modules may also provide
      // middleware simply by setting a "middleware" property on
      // themselves

      middleware: [ /* middleware, functions, galore */ ],

      sessionSecret: 'SOMETHING RANDOM PLEASE',

      // Minify all CSS and JS into a single file each (can be fine-tuned
      // with other options). Great in production
      minify: true,

      // If the generated CSS has more than 4,095 rules, split into
      // multiple imported CSS files to avoid a limitation of IE9 and below.
      // This is disabled by default
      bless: false,

      // Any options accepted by the apostrophe-pages module,
      // such as tabOptions and descendantOptions
      pages: {
        // List all the page types users should be able to add here, including
        // things like "Blog" and "Events" that are powered by modules, so you get
        // to pick the order
        types: [
          // TODO double check this doesn't get ignored if blog is added later and wasn't wanted
          { name: 'default', label: 'Default (Two Column)' },
          { name: 'home', label: 'Home Page' },
          { name: 'blog', label: 'Blog' },
          { name: 'events', label: 'Events' }
        ]

        // Load descendants of homepage and current page two levels deep
        // instead of one
        tabOptions: { depth: 2 },
        descendantOptions: { depth: 2 },

        // Do something special if the URL doesn't match anything else
        notfound: function(req, callback) {
          if (req.url === '/special') {
            req.redirect = '/specialer';
          }
          return callback(null);
        }

        // Run some middleware on the route that serves pages.
        // This is not global middleware, see the top-level middleware option.

        // Middleware functions may take an initial "site" argument
        // in addition to req, res, next. Modules may also register
        // page-serving middleware simply by setting a
        // pageMiddleware property on themselves

        middleware: [ /* middleware, functions, galore */ ],

        // Custom page loader functions beyond those automatically
        // provided. Already you have the page with the slug 'global'
        // available at all times, the current page, its tabs, its
        // descendants, and anything loaded on behalf of your modules,
        // like blog posts appearing on the current page
        load: [
          function(req, callback) {
            if (!(req.page && (req.page.type === 'fancy'))) {
              // Doesn't concern us
              return callback(null);
            }
            // Set some custom data to be provided to the nunjucks template.
            // Anything in the extras object is pushed as data to the
            // page template.
            //
            // We have a callback here, so we could go get anything
            req.extras.fanciness = true;
            return callback(null);
          }
        ],
      },

      // Let's add the blog and events modules. You must npm install them.
      // apostrophe-site will require them for you and pass your options
      modules: {
        'apostrophe-events': {
          widget: true
        },
        'apostrophe-blog': {
          widget: true
        }
      },

      // Custom command line tasks. Run like this:
      // node app project:frobulate
      // argv is powered by optimist
      tasks: {
        project: {
          frobulate: function(apos, argv, callback) {
            console.log('Frobulated the hibblesnotz');
            console.log('You passed these arguments: ' + argv._);
            return callback(null);
          }
        }
      },

      locals: {
        // Extra locals visible to every nunjucks template. Functions and
        // data are both fair game. You may also pass a function that takes
        // the site object as its sole argument and returns an object containing
        // the desired locals as properties.
        embiggen: function(s) {
          return s * 1000;
        }
      },

      assets: {
        // Loads site.js from public/js
        scripts: [
          // load this js file all the time, minify it normally
          'site',
          {
            // Load this JS file only when a user is logged in, never minify it.
            // 'when' could also be 'always'. 'minify' defaults to true
            name: 'fancy',
            when: 'user',
            minify: false
          }
        ],
        // Loads site.less from public/css
        stylesheets: [
          'site'
        ]
      },

      // Last best chance to set custom Express routes
      setRoutes: function(callback) {
        site.app.get('/wacky', function(req, res) { res.send('wackiness'); });
        return callback(null);
      },

      // Just before apos.endAsset. Last chance to push any assets. Usually the
      // `assets` option above, and calling `pushAsset` from your modules,
      // is good enough.

      beforeEndAssets: function(callback) {
        // Apostrophe already loads these for logged-out users, but we
        // want them all the time in this project.
        site.apos.pushAsset('script', { name: 'vendor/blueimp-iframe-transport', when: 'always' });
        site.apos.pushAsset('script', { name: 'vendor/blueimp-fileupload', when: 'always' });
        return callback(null);
      },

      // Just before listen. Last chance to set up anything
      afterInit: function(callback) {
        return callback(null);
      },

      sanitizeHtml: {
        // Any options that can be passed to the sanitize-html
        // module are valid here. Used to adjust the way we filter
        // HTML saved in the rich text editor. You probably want
        // to stick with our standard set of allowed tags and
        // encourage users to respect your design rather than
        // fighting it
      },

      // A simple way to alter the results of every call to apos.get, and thus
      // every page, snippet, blog post, etc. The retrieved documents will be
      // in results.pages. Be aware that this property does not always exist,
      // as apos.get is sometimes used just to fetch distinct tags or
      // other metadata.
      afterGet: function(req, results, callback) {

      }
    });

```

## Two-Step Configuration

If you prefer you can configure Apostrophe in two steps:

```javascript
var site = require('apostrophe-site')();
site.init({ ... same configuration as above ... });
```

This allows you to pass your site object to functions implemented in other files in order to create parts of your configuration:

```javascript
// in app.js

var site = require('apostrophe-site')();
site.init({
  // ... regular stuff ...
  pages: {
    load: require('./lib/loaders.js')(site)
  }
});

// in lib/loaders.js

module.exports = function(site) {
  return [
    function(req, callback) {
      site.apos.doSomethingInteresting(callback);
    }
  ]
};
```

## Adding Modules to the Admin Bar

Adding a module to the `modules` property above does most of the work, but you do need to add it to the admin bar when appropriate. For instance, you'll want the "blog" menu to be added at the top of the page when the blog module is installed.

In our sandbox site or a project cloned from it, you would do that in `outerLayout.html`. Just look for calls like this one:

    {{ aposBlogMenu({ edit: permissions.edit }) }}

Conversely, if you choose not to include a module but haven't removed it from the admin bar, don't be surprised when you get a template error.

## Overriding the Templates of a Module

First `npm install` and configure `apostrophe-blog`. Then create a `lib/modules/apostrophe-blog/views` folder in your project. Copy any templates you wish to customize from the npm module's views folder to `lib/modules/apostrophe-blog/views`.

Boom! Apostrophe will automatically look first at your "project level" module folder.

*This also works for `apostrophe-schemas` and `apostrophe-pages`, even though they are not configured by the `modules` property.* `lib/modules/apostrophe-schemas/views` may contain overrides for schema field templates, and `lib/modules/apostrophe-pages/views` may contain overrides for `newPageSettings.html` and friends.

## Overriding a Module With a New Name

You can override a module more than once, for instance to set up two things that are similar in spirit to a blog. Just create folders in `lib/modules`, with your `views` overrides, and configure them in `app.js` via the `modules` option as shown above. Then use the `extend` property to tell Apostrophe what module you're extending.

You'll want to set the `name` and `instance` options so the database can distinguish between your stories and regular blog posts:
```javascript
    stories: {
      extend: 'apostrophe-blog',
      name: 'stories',
      instance: 'story',
      addFields: [
        {
          name: 'storyteller',
          type: 'string'
        }
      ]
    }
```
Note that you will need to copy the `new`, `edit` and `manage` templates to your `views` folder and fix any references to `blog` and `blog-post` to refer to `stories` and `story`.

## Overriding the Schema of a Module: Adding Custom Properties

As seen above, you can add and alter the properties of blog posts and similar things via the `addFields` and `alterFields` options as described in the [apostrophe-snippets](http://github.com/punkave/apostrophe-snippets) documentation. Those options can go right in the configuration for your module in `app.js`.

## Overriding and Extending Methods of a Module

If you really need to change a module's behavior, for instance changing what the page loader function does or the way it fetches data from the database, you'll need to subclass it. But we've made subclassing much easier. Just create an `index.js` file in your `lib/modules/mymodulename` folder.

Here's a really simple subclass that changes the way the `index` method of the blog behaves so that a featured story is available to the `index.html` template as the `featured` variable in nunjucks:
```javascript
    module.exports = stories;

    function stories(options, callback) {
      return new stories.Stories(options, callback);
    }

    stories.Stories = function(options, callback) {
      var self = this;

      module.exports.Super.call(this, options, null);

      var superIndex = self.index;
      self.index = function(req, snippets, callback) {
        self.get(req, { tags: 'featured' }, { limit: 1 }, function(err, results) {
          if(err) {
            callback(err);
          }
          if(results.total > 0) {
            req.extras.featured = results.snippets[0];
          }
          superIndex(req, snippets, callback);
        });
      };

      // Must wait at least until next tick to invoke callback!
      if (callback) {
        process.nextTick(function() { return callback(null); });
      }

    };
```
Note the use of `module.exports.Super`. This automatically points to the base class constructor.

Confused? Just remember to follow this pattern and put your method overrides after the call to `module.exports.Super`.

## Tip: Subclassing Snippets is Often a Good Idea

If it doesn't smell like a blog post, you probably want to subclass snippets instead. The blog module simply subclasses snippets and adds the idea of a publication date.

## Modules Can Have Nothing To Do With Snippets

You can configure modules that have nothing at all to do with snippets, too. Our own RSS and Twitter modules, for instance.

To configure a module with `apostrophe-site`, all you have to do is make sure it looks like this:
```javascript
    module.exports = factory;

    function factory(options, callback) {
      return new Construct(options, callback);
    }

    function Construct(options, callback) {
      var self = this;
      // Add a bunch of methods to self here, then...

      // Invoke the callback. This must happen on next tick or later!
      return process.nextTick(function() {
        return callback(null);
      });
    }

    // Export the constructor so others can subclass
    factory.Construct = Construct;
```
In a nutshell: you must export a factory function, and it must have a constructor as its `Construct` property.

## Options Provided to Modules

In addition to the options you specify in `app.js`, all modules receive:

`apos`: the `apos` object, a singleton which provides core methods for content management. See the [apostrophe](http://github.com/punkave/apostrophe) module documentation.

`pages`: the `pages` object, a singleton which provides methods for dealing with the page tree. See the [apostrophe-pages](http://github.com/punkave/apostrophe-pages) module documentation.

`schemas`: the `schemas` object, a singleton which provides methods for dealing with schemas. Most of the time you won't interact with this directly, but you might if you're writing a module that handles moderated submissions and the like. See the [apostrophe-schemas](http://github.com/punkave/apostrophe-schemas) module documentation.

`mailer`: a `nodemailer` transport object, ready to send email as needed. See the [nodemailer](http://www.nodemailer.com/) documentation.

`site`: an object containing `title`, `shortName` and `hostName` properties, as configured in `app.js`.

`modules`: an array of objects with `web` and `fs` properties, specifying the web and filesystem paths to each folder in the chain of overrides, which is useful if you wish to allow project-level overrides via `lib/modules` of views provided by an npm module. You can take advantage of this easily if you use the `mixinModuleAssets` and `serveAssets` mixins; see `assets.js` in the apostrophe module for documentation.

## Accessing Other Modules

After all modules have been initialized, `apostrophe-site` calls the `setBridge` method on each module that has one. This method receives an object containing all of the modules as properties. The `people` module, for instance, uses the bridge to access the `groups` module. Note that this is not called until after all modules have invoked their initialization callback.

## Publishing Modules

You can write custom modules in `lib/modules` for your project-specific needs, or install them with npm. If you use `lib/modules`, your module's code must load from `lib/modules/mymodulename/index.js`.

## Limitations

Currently `extend` does not check `lib/modules`, so the module you are extending must be published in npm. Most of the time we extend modules like `apostrophe-blog` and `apostrophe-snippets` in simple project-specific ways, so this isn't much of a problem so far.

## Internationalization

Using i18n is simple you enable it by adding the following in your apostrophe-site configuration in app.js:

```javascript
i18n: {
    // setup some locales - other locales default to defaultLocale silently
    locales:['en', 'de'],

    // you may alter a site wide default locale (optional, defaults to 'en')
    defaultLocale: 'de',

    // sets a custom cookie name to parse locale settings from  - defaults to apos_language (optional)
    cookie: 'yourcookiename',

    // whether to write new locale information to disk automatically - defaults to true (you will want to shut it off in production)
    // updateFiles: false
}
```

After doing this, you can internationalise text in your own templates with:

    {{ __('A sample string') }}

The `__` local will take care of language detection and will spit out the appropriate string from the JSON files that will be located in the `locales` folder of your project by default. If you look in that folder, you'll see multiple JSON files with a two letter language abbreviation as a filename, for instance:

    en.json
    de.json

Those will contain all the necessary strings. By default, i18n will automatically put anything new it finds there. However, you can disable this behaviour by setting `updateFiles` to false.

## More Modules, More Documentation

See [apostrophe](http://github.com/punkave/apostrophe),
[apostrophe-sandbox](http://github.com/punkave/apostrophe-sandbox),
[apostrophe-pages](http://github.com/punkave/apostrophe-pages),
[apostrophe-snippets](http://github.com/punkave/apostrophe-snippets),
[apostrophe-blog](http://github.com/punkave/apostrophe-blog),
[apostrophe-events](http://github.com/punkave/apostrophe-events),
[apostrophe-map](http://github.com/punkave/apostrophe-map),
[apostrophe-groups](http://github.com/punkave/apostrophe-groups),
[apostrophe-people](http://github.com/punkave/apostrophe-people),
[apostrophe-rss](http://github.com/punkave/apostrophe-rss) and
[apostrophe-twitter](http://github.com/punkave/apostrophe-twitter).

Also browse the [`apostrophe` tag on npm](https://npmjs.org/browse/keyword/apostrophe).

## Community

You should join the [apostrophenow Google Group](https://groups.google.com/forum/?fromgroups#!forum/apostrophenow) for discussion of both Apostrophe 1.5 and Apostrophe 2.

## Thanks for using Apostrophe!

[P'unk Avenue](http://punkave.com)

