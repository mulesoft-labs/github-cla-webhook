var lruCache = require('lru-cache')
var popsicle = require('popsicle')
var debug = require('debug')('mulesoft-cla-webhook:webhook')
var popsicleConstants = require('popsicle-constants')
var popsicleStatus = require('popsicle-status')
var popsicleResolve = require('popsicle-resolve')
var popsicleBasicAuth = require('popsicle-basic-auth')
var popsicleLimit = require('popsicle-limit')
var parseLinkHeader = require('parse-link-header')

/**
 * Export web hook.
 *
 * @type {Function}
 */
module.exports = webhook

/**
 * Store a cache of memberships as "organization:repo:login".
 *
 * @type {Object}
 */
var MEMBER_CACHE = lruCache({
  max: 500,
  maxAge: 1000 * 60 * 60 * 24
})

/**
 * Store a cache of CLA signatures as "login".
 *
 * @type {Object}
 */
var CLA_CACHE = lruCache({
  max: 2000,
  maxAge: 1000 * 60 * 60 * 24 * 30
})

/**
 * Limit GitHub API calls.
 *
 * @type {Function}
 */
var githubLimit = popsicleLimit(5000, popsicleLimit.HOUR)

/**
 * Personal GitHub API access token.
 *
 * @type {String}
 */
var ACCESS_TOKEN = process.env.GITHUB_ACCESS_TOKEN

/**
 * Users covered by the CLA.
 *
 * @type {Array}
 */
var CLA_USERS = process.env.CLA_USERS ? process.env.CLA_USERS.trim().split(/ *, */) : ['mulesoft', 'mulesoft-labs', 'mulesoft-consulting']

/**
 * Target URL for accepting the CLA.
 *
 * @type {String}
 */
var TARGET_URL = process.env.TARGET_URL || 'https://api-notebook.anypoint.mulesoft.com/notebooks#bc1cf75a0284268407e4'

/**
 * Repository of logged CLA agreements.
 *
 * @type {String}
 */
var CLA_REPOSITORY = process.env.CLA_REPOSITORY || 'mulesoft/contributor-agreements'

/**
 * Possible commit status states.
 *
 * @type {Object}
 */
var STATES = {
  PENDING: 'pending',
  SUCCESS: 'success',
  ERROR: 'error',
  FAILURE: 'failure'
}

/**
 * Corresponding descriptions of states.
 *
 * @type {Object}
 */
var STATE_DESCRIPTIONS = {
  pending: 'Checking for CLA signature.',
  success: 'Thanks for signing the CLA!',
  error: 'An error occured while checking for CLA signature - we are looking into it.',
  failure: 'Please sign the CLA to continue.'
}

/**
 * Make an API request to GitHub.
 *
 * @param  {Object}  opts
 * @return {Promise}
 */
function request (opts) {
  return popsicle(opts)
    .use(popsicleResolve('https://api.github.com'))
    .use(githubLimit)
    .use(popsicleBasicAuth(ACCESS_TOKEN, 'x-oauth-basic'))
    .before(function (req) {
      debug(req.method + ' ' + req.url)
    })
}

/**
 * Handle incoming web hooks.
 *
 * @param {Object}   req
 * @param {Object}   res
 * @param {Function} next
 */
function webhook (req, res, next) {
  var id = req.headers['x-github-delivery']
  var name = req.headers['x-github-event']
  var event = req.body

  debug('new event: %s %s', name, id)

  if (CLA_USERS.indexOf(event.repository.owner.login) > -1 && name === 'pull_request' && event.action === 'opened') {
    updatePullRequest(event.pull_request)
  } else if (event.repository.full_name === CLA_REPOSITORY && name === 'issues' && event.action === 'opened' && isClaAgreement(event.issue)) {
    updatePullRequests(event.issue.user.login)
  }

  return res.end()
}

/**
 * Review the status of an commit hash.
 *
 * @param  {String}  owner
 * @param  {String}  repository
 * @param  {String}  username
 * @param  {String}  sha
 * @return {Promise}
 */
function reviewStatus (owner, repository, username, sha) {
  return setReviewState(owner, repository, sha, STATES.PENDING)
    .then(function () {
      return checkMembership(owner, repository, username)
    })
    .then(function (isMember) {
      if (isMember) {
        return setReviewState(owner, repository, sha, STATES.SUCCESS)
      }

      return checkClaSignature(username)
        .then(function (hasSigned) {
          if (!hasSigned) {
            return setReviewState(owner, repository, sha, STATES.FAILURE)
          }

          return setReviewState(owner, repository, sha, STATES.SUCCESS)
        })
    })
    .catch(function (err) {
      console.log('review error: ', err.stack)

      return setReviewState(owner, repository, sha, STATES.ERROR)
    })
}

/**
 * Check the users membership to a repository.
 *
 * @param  {String}  owner
 * @param  {String}  repository
 * @param  {String}  username
 * @return {Promise}
 */
function checkMembership (owner, repository, username) {
  var data = {
    owner: owner,
    repo: repository,
    username: username
  }

  var id = [data.owner, data.repo, data.username].join(':')

  debug('check membership: %s', id)

  if (MEMBER_CACHE.has(id)) {
    return MEMBER_CACHE.get(id)
  }

  var result = request('/repos/{owner}/{repo}/collaborators/{username}')
    .use(popsicleConstants(data))
    .then(function (res) {
      return res.statusType() === 2
    })

  MEMBER_CACHE.set(id, result)

  return result
}

/**
 * Set the review state of the commit hash.
 *
 * @param  {String}  owner
 * @param  {String}  repository
 * @param  {String}  sha
 * @param  {String}  state
 * @return {Promise}
 */
function setReviewState (owner, repository, sha, state) {
  var data = {
    owner: owner,
    repo: repository,
    sha: sha
  }

  debug('set review state: %s/%s#%s -> %s', data.owner, data.repo, data.sha, state)

  return request({
      url: '/repos/{owner}/{repo}/statuses/{sha}',
      method: 'post',
      body: {
        state: state,
        target_url: TARGET_URL,
        description: STATE_DESCRIPTIONS[state],
        context: 'mulesoft/cla'
      }
    })
    .use(popsicleConstants(data))
    .use(popsicleStatus())
}

/**
 * Check the CLA is signed.
 *
 * @param  {String}  username
 * @return {Promise}
 */
function checkClaSignature (username) {
  debug('check cla signature: %s', username)

  if (CLA_CACHE.has(username)) {
    return CLA_CACHE.get(username)
  }

  var result = request({
    url: '/repos/' + CLA_REPOSITORY + '/issues',
    query: {
      creator: username,
      state: 'open'
    }
  })
    .use(popsicleStatus())
    .then(function (res) {
      return res.body.some(isClaAgreement)
    })

  CLA_CACHE.set(username, result)

  return result
}

/**
 * Verify the issue is a CLA agreement.
 *
 * @param  {Object}  issue
 * @return {Boolean}
 */
function isClaAgreement (issue) {
  return /^MuleSoft Contributor Agreement Acceptance/.test(issue.title)
}

/**
 * Update all pull requests created by a user.
 *
 * @param  {String}  username
 * @return {Promise}
 */
function updatePullRequests (username) {
  var query = CLA_USERS.map(function (owner) {
    return 'user:' + owner
  }).concat(['type:pr', 'author:' + username, 'is:open'])

  return updatePullRequestsBySearchUrl({
    url: '/search/issues',
    query: query
  })
    .catch(function (err) {
      console.log('update error: ', err.stack)
    })
}

/**
 * Update all pull requests found by a search.
 *
 * @param  {String}  url
 * @return {Promise}
 */
function updatePullRequestsBySearchUrl (url) {
  return request(url)
    .use(popsicleStatus())
    .then(function (res) {
      var prs = res.body.items.map(function (issue) {
        return request(issue.pull_request.url)
          .use(popsicleStatus())
          .then(function (res) {
            return updatePullRequest(res.body)
          })
      })

      var links = parseLinkHeader(res.get('Link'))

      return Promise.all(prs)
        .then(function () {
          if (links && links.next) {
            return updatePullRequestsBySearchUrl(links.next.url)
          }

          return true
        })
    })
}

/**
 * Update a single pull request status.
 *
 * @param  {Object}  issue
 * @return {Promise}
 */
function updatePullRequest (pr) {
  return reviewStatus(
    pr.base.repo.owner.login,
    pr.base.repo.name,
    pr.user.login,
    pr.head.sha
  )
}
