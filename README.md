# Jasper

A Jasmine-flavored Remote Dependency Test DSL for CasperJS.

### Requirements

- PhantomJS
- CasperJS

### Example Usage

```coffee
jasper = require('./path/to/jasper.js').jasper

jasper.start 'http://www.example.com/'

jasper.describe 'Remote Site Assertions', ->
  @open 'http://www.example.com/'

  # Assert the content of these meta tags
  @assertMetaTags
    foo: 'foo content'
    bar: 'bar content'

  # Assert that these elements exist on the page
  @assertSelectors
    'primary search': '#nav input.search'
    'search filter': '#sidebar .filter'

  # Assert that these cookies exist
  @assertCookies [ 'foo', 'bar' ]

  # Take screenshots of any elements on page with a 200px margin
  # saves to './screenshots' directory by default
  @captureSelectors
    'dom_element.png': '#any .dom .element'

jasper.describe 'Wait For Library to Load', ->
  url = 'http://www.example.com/'

  myLibraryIsLoaded = ->
    jasper.evaluate ->
      !!window.MyLibrary

  @openAndWait url, myLibraryIsLoaded, ->

    # Assert anything by running arbitrary code on the page
    @customAssertions
      'myFunction returns xyz': -> MyLibrary.myFunction() is 'xyz'
      'There are at least 5 products on the page': ->
        document.querySelectorAll('.product').length > 5

jasper.describe 'System Monitoring Assertions', ->

  # Assert Text
  @assertTextOnPages
    'http://example.com/signup': 'Sign up here!'

  # Assert HTTP redirects
  @assertRedirects
    'http://example.com/signup': 'https://example.com/signup'

  # Assert that these URLs return a 200 OK response code
  @assertRemoteResources [
    'http://example.com/logo.jpg'
    'http://example.com/foo.html'
  ]

jasper.run()
```

```bash
$ casperjs path/to/your_tests.coffee
// Use a custom screenshot directory
$ casperjs path/to/your_tests.coffee --screenshots_dir=/path/to/screenshots
// Add TeamCity support
$ casperjs path/to/your_tests.coffee --teamcity=true
```

### License

MIT License. Copyright &copy; 2013 Andrew Childs
