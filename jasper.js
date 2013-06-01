/**
 * Jasper
 * A Jasmine-flavored Remote Dependency Test DSL for CasperJS.
 */

var fs = require('fs');
var utils = require('utils');

var DELAY_BETWEEN_DESCRIBE_BLOCKS = 5000;
var REMOTE_SITE_TIMEOUT = 30000;
var WAIT_AFTER_PAGE_LOAD = 5000;

var jasper = require('casper').create({
  stepTimeout: 600000, // 10 minutes, casperjs default is none
  waitTimeout: 300000, // 5 minutes, casperjs default is 5 seconds
  timeout: 3600000, // 1 hour
  verbose: true,
  exitOnError: false,
  viewportSize: {
    width: 1000,
    height: 800
  },
  onStepTimeout: function _onStepTimeout(timeout, stepNum) {
    console.error(jasper.getColorizer().colorize("Maximum step execution timeout exceeded for step " + stepNum, 'RED_BAR', 80));
  },
  onTimeout: function _onTimeout(timeout) {
    console.error(jasper.getColorizer().colorize(utils.format("Script timeout of %dms reached.", timeout), 'RED_BAR', 80));
  },
  onWaitTimeout: function _onWaitTimeout(timeout) {
    console.error(jasper.getColorizer().colorize(utils.format("Wait timeout of %dms reached.", timeout), 'RED_BAR', 80));
  }
});

var SCREENSHOT_DIR = jasper.cli.get('screenshots_dir') || 'screenshots';
var IS_TEAMCITY = !!jasper.cli.get('teamcity');

// State

jasper.onlyDescribeIsActive = false;
jasper.lastDescribe = '';
jasper.exitCode = 0;
jasper.startTime = new Date().getTime();

// Benchmark

var benchmark = function() {
  jasper.lastBenchmarkTime = jasper.lastBenchmarkTime || jasper.startTime;

  var now = new Date().getTime();
  var sinceLastTime = '+' + ((now - jasper.lastBenchmarkTime) / 1000) + 's';
  var totalTime = '[' + ((now - jasper.startTime) / 1000) + 's]';
  jasper.lastBenchmarkTime = now;

  return jasper.getColorizer().colorize(totalTime + ' ' + sinceLastTime, 'PARAMETER');
};

// Event Handlers

jasper.on('url.changed', function (url) {
  console.log(benchmark(), 'url changed to:', url);
});

jasper.on('popup.created', function (page) {
  console.log(benchmark(), 'popup created for url:', page.url);
});

jasper.on('popup.closed', function (page) {
  console.log(benchmark(), 'popup closed for url:', page.url);
});

jasper.on('step.start', function (step) {
  console.log(benchmark(), 'step started');
});

jasper.on('step.timeout', function () {
  console.log(benchmark(), 'step timeout');
});

jasper.on('error', function(msg, backtrace) {
  jasper.exitCode = 1;
  rescueScreenshot('error');
  this.echo(msg);
});

jasper.test.on('success', function(success) {
  TeamCity.echo(success.message);
});

jasper.test.on('fail', function(fail) {
  jasper.exitCode = 1;
  TeamCity.echo(fail.message, true);
  rescueScreenshot('fail');
  dumpHTMLToFile('fail');
});

// TeamCity support

var TeamCity = {};

TeamCity.encode = function(message) {
  return (message + '').replace(new RegExp("(\\||\'|\\[|\\])", "g"), "|$1");
};

TeamCity.message = function(name, attributes) {
  if (IS_TEAMCITY) {
    var message = "##teamcity[" + name;
    forEach(attributes, function (value, key) {
      message += " " + key + "='" + TeamCity.encode(value) + "'";
    });
    message += "]";
    jasper.echo(message);
  }
};

TeamCity.echo = function(message, failed) {
  TeamCity.message('testStarted', { name: message });
  if (failed) {
    TeamCity.message('testFailed', { name: message });
  }
  TeamCity.message('testFinished', { name: message });
};

// Navigation Helpers

jasper.describe = function(description, fn, skipOnlyDescribeCheck) {
  this.then(function () {
    if (this.onlyDescribeIsActive && skipOnlyDescribeCheck !== true) {
      return this.echo('Skipping "' + description + '" due to describeOnly');
    }
    this.wait(DELAY_BETWEEN_DESCRIBE_BLOCKS, function() {
      this.page.clearCookies();
      this.lastDescribe = description;
      this.test.comment(description);
      TeamCity.message('testSuiteStarted', { name: description });
      this.then(fn);
      this.then(function() {
        TeamCity.message('testSuiteFinished', { name: description });
      });
    });
  });
};

jasper.describeOnly = function (description, fn) {
  this.onlyDescribeIsActive = true;
  return this.describe(description, fn, true);
};

jasper.xdescribe = function(description, fn) {
  this.then(function() {
    this.test.comment(description);
    TeamCity.message('testIgnored', {
      name: description,
      message: 'Tests intentionally skipped.'
    });
  });
};

jasper.openAndWait = function(url, eval_fn, then_fn) {
  this.thenOpen(url, function() {
    var wait_then_fn = function() {
      this.wait(WAIT_AFTER_PAGE_LOAD, then_fn);
    };
    var give_up_fn = function() {
      var msg;
      msg = 'Giving up after ' + (REMOTE_SITE_TIMEOUT / 1000) + ' seconds.';
      rescueScreenshot('ignored');
      dumpHTMLToFile('ignored');
      TeamCity.message('testIgnored', {
        name: jasper.lastDescribe,
        message: msg
      });
      this.test.comment(msg);
    };
    this.waitFor(eval_fn, wait_then_fn, give_up_fn, REMOTE_SITE_TIMEOUT);
  });
};

jasper.nativeRun = jasper.run;

jasper.run = function () {
  this.nativeRun(function () {
    this.test.renderResults(true, this.exitCode, this.cli.get('save') || false);
  });
};

// Assertions

jasper.assertSelectors = function(selectors) {
  forEach(selectors, function (selector, description) {
    jasper.test.assertSelectorExists(selector, description + ' "' + selector + '" should exist on the page');
  });
};

jasper.assertCookies = function(cookies) {
  forEach(cookies, function (cookie_name) {
    var cookie_value;
    forEach(jasper.page.cookies, function (cookie, key) {
      if (cookie.name === cookie_name) {
        cookie_value = cookie.value;
      }
    });
    jasper.test.assert(!!cookie_value, 'Cookie "' + cookie_name + '" should exist')
  });
};

jasper.assertMetaTags = function(tags) {
  forEach(tags, jasper.assertMetaTag);
};

jasper.assertMetaTag = function(expected_tag_value, tag_name) {
  var found_tag_value = jasper.evaluate(function(tag_name) {
    var tag = document.querySelector('meta[name="' + tag_name + '"]');
    return tag ? tag.content : false;
  }, {
    tag_name: tag_name
  });
  if (expected_tag_value) {
    jasper.test.assertEquals(found_tag_value, expected_tag_value, 'Meta tag "' + tag_name + '" should equal "' + expected_tag_value + '"');
  } else {
    jasper.test.assert(!!found_tag_value, 'Meta tag "' + tag_name + '" should exist');
  }
};

jasper.assertRedirects = function(redirects) {
  forEach(redirects, function(destination, start) {
    jasper.assertRedirect(destination, start)
  });
};

jasper.assertRedirect = function(destination, start) {
  var getLocationFn = function() {
    return document.location.href;
  };

  jasper.thenOpen(start, function() {
    function testFn() {
      return jasper.getCurrentUrl() === destination;
    }
    function thenFn() {
      jasper.test.assertEvalEquals(getLocationFn, destination, start + ' should redirect to ' + destination);
    }
    function onTimeout() {
      jasper.test.fail('Timeout: ' + start + ' should redirect to ' + destination);
    }
    jasper.waitFor(testFn, thenFn, onTimeout, REMOTE_SITE_TIMEOUT);
  });
};

jasper.assertRemoteResources = function(resources) {
  forEach(resources, jasper.assertRemoteResource);
};

jasper.assertRemoteResource = function(resource) {
  jasper.thenOpen(resource, function() {
    this.test.assertHttpStatus(200, resource + ' should return a 200 OK HTTP response code.');
  });
};

jasper.assertTextOnPages = function(pages) {
  forEach(pages, jasper.assertTextOnPage);
};

jasper.assertTextOnPage = function(text, page) {
  jasper.thenOpen(page, function() {
    this.test.assertTextExists(text, page + ' should contain "' + text + '"');
  });
};

jasper.customAssertions = function(assertions) {
  forEach(assertions, function (assertion, description) {
    jasper.test.assertEval(assertion, description);
  });
};

// Screenshot Helpers

jasper.captureSelector = function(filename, selector, padding) {
  padding = padding || 200;
  var bounds = jasper.getElementBounds(selector);
  bounds.width += padding;
  bounds.height += padding;
  bounds.left -= padding / 2;
  bounds.top -= padding / 2;
  return this.capture(filename, bounds);
};

jasper.captureSelectors = function(selectors, padding) {
  padding = padding || 200;

  forEach(selectors, function (selector, filename) {
    if (jasper.exists(selector)) {
      jasper.captureSelector(SCREENSHOT_DIR + '/' + filename, selector, padding);
    }
  });
};

jasper.capturePage = function(filename) {
  this.capture(SCREENSHOT_DIR + '/' + filename);
};

// Utils

jasper.formatFutureDate = function(days_ahead, format) {
  var now = new Date();
  now.setDate(now.getDate() + days_ahead);

  var syntax = {
    d: now.getDate(),
    D: now.getDate() < 10 ? '0' + now.getDate() : now.getDate(),
    m: now.getMonth() + 1,
    M: (now.getMonth() + 1) < 10 ? '0' + (now.getMonth() + 1) : now.getMonth() + 1,
    Z: (now.getMonth()) < 10 ? '0' + (now.getMonth()) : now.getMonth(),
    y: now.getFullYear().toString().substring(2, 4),
    Y: now.getFullYear()
  };

  forEach(syntax, function (replacement, code) {
    format = format.replace(new RegExp('%' + code, 'g'), replacement);
  })

  return format;
};

jasper.closePopups = function() {
  this.popups.splice(0);
};

jasper.injectScript = function(script) {
  this.options.clientScripts.push(script);
};

jasper.removeScript = function(script) {
  this.options.clientScripts.filter(function(clientScript) {
    return clientScript !== script;
  });
};

function rescueScreenshot(type) {
  var filename, timestamp;
  timestamp = new Date().getTime();
  filename = 'casper-' + type + '-' + timestamp + '-' + jasper.lastDescribe.replace(/\W/g, '') + '.png';
  jasper.test.comment('Screenshot saved to ' + SCREENSHOT_DIR + '/' + filename);

  return jasper.capture(SCREENSHOT_DIR + '/' + filename);
}

function dumpHTMLToFile(type) {
  var timestamp = new Date().getTime();
  var html = jasper.evaluate(function() {
    return document.documentElement.innerHTML;
  });
  var filename = 'casper-' + type + '-' + timestamp + '-' + jasper.lastDescribe.replace(/\W/g, '') + '.html';
  jasper.test.comment('HTML dump saved to ' + SCREENSHOT_DIR + '/' + filename);
  var f = fs.open(SCREENSHOT_DIR + '/' + filename, 'w');
  f.write(html);
  f.close();
}

function forEach(collection, iterator, context) {
  if (collection === null) return;
  if (collection.forEach) {
    collection.forEach(iterator, context);
  } else {
    var hasProp = {}.hasOwnProperty, key;
    for (key in collection) {
      if (hasProp.call(collection, key)) {
        if (iterator.call(context, collection[key], key, collection) === false) {
          return;
        }
      }
    }
  }
}

// Export

exports.jasper = jasper;
