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

Here's an `app.js` that demonstrates most of the options. Most of this is optional, of course. `root`, `shortName`, `hostName`, `adminPassword` and `sessionSecret` are required.

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

      // Title of your site. Used as a prefix to page titles and feed titles by default
      title: 'My Site',

      // Apostrophe sizes your images to several awesome sizes right out of the box,
      // but we're greedy and we want something bigger than full (1280)
      addImageSizes: [
        {
          name: 'max',
          width: 1600,
          height: 1280
        }
      ],

      // You can always log in at /login as admin, with this password
      adminPassword: 'SOMETHING SECURE PLEASE',

      redirectAfterLogin: function(user) {
        if (user.permissions.admin) {
          return '/awesomepeople';
        } else {
          return '/coolpeople';
        }
      },

      sessionSecret: 'SOMETHING RANDOM PLEASE',

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

        // Run some middleware on the route that serves pages
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
            // We have a callback here, so we could go get anything
            req.page.extras.fanciness = true;
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
        // data are both fair game
        embiggen: function(s) {
          return s * 1000;
        }
      },

      assets: {
        // Loads site.js from public/js
        scripts: [
          'site'
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
      }
    });

```

## Adding Modules to the Admin Bar

Adding a module to the `modules` property above does most of the work, but you do need to add it to the admin bar when appropriate. For instance, you'll want the "blog" menu to be added at the top of the page when the blog module is installed.

In our sandbox site or a project cloned from it, you would do that in `outerLayout.html`. Just look for calls like this one:

    {{ aposBlogMenu({ edit: permissions.edit }) }}

Conversely, if you choose not to include a module but haven't removed it from the admin bar, don't be surprised when you get a template error.

## Overriding the Templates of a Module

First `npm install` and configure `apostrophe-blog`. Then create a `lib/modules/apostrophe-blog/views` folder in your project. Copy any templates you wish to customize from the npm module's views folder to `lib/modules/apostrophe-blog/views`.

Boom! Apostrophe will automatically look first at your "project level" module folder.

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

      self.superIndex = self.index;
      self.index = function(req, snippets, callback) {
        self.get(req, { tags: 'featured' }, { limit: 1 }, function(err, results) {
          if(err) {
            callback(err);
          }
          if(results.total > 0) {
            req.extras.featured = results.snippets[0];
          }
          self.superIndex(req, snippets, callback);
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

`site`: an object containing `title`, `shortName` and `hostName` properties, as configured in `app.js`.

`modules`: an array of objects with `web` and `fs` properties, specifying the web and filesystem paths to each folder in the chain of overrides, which is useful if you wish to allow project-level overrides via `lib/modules` of views provided by an npm module.

## Accessing Other Modules

After all modules have been initialized, `apostrophe-site` calls the `setBridge` method on each module that has one. This method receives an object containing all of the modules as properties. The `people` module, for instance, uses the bridge to access the `groups` module.

## Publishing Modules

You can write custom modules in `lib/modules` for your project-specific needs, or install them with npm. If you use `lib/modules`, your module's code must load from `lib/modules/mymodulename/index.js`.

## Limitations

Currently `extend` does not check `lib/modules`, so the module you are extending must be published in npm. Most of the time we extend modules like `apostrophe-blog` and `apostrophe-snippets` in simple project-specific ways, so this isn't much of a problem so far.

## Changelog

0.1.2: don't forget the search page's page loader function
0.1.1: Fixed a typo that prevented the `global` virtual page from loading by default.

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

