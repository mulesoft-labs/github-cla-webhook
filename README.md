# GitHub CLA Webhook

[![Build status][travis-image]][travis-url]
[![Test coverage][coveralls-image]][coveralls-url]

> Automate CLA verification for open source repositories using GitHub issues.

## Installation

1. Create a new [personal access token](https://github.com/settings/applications) with **public_repo** scope (required for checking collaborators).
2. Set environment variables (below).
3. Deploy.
4. Enable webhooks in the organisation/repository settings (`http://<url>/webhook`, with "Issues" and "Pull Requests" enabled), including the CLA repository.
5. Profit!

## Environment Variables

```
GITHUB_ACCESS_TOKEN="abc123"
TARGET_URL="https://api-notebook.anypoint.mulesoft.com/notebooks#bc1cf75a0284268407e4"
CLA_REPOSITORY="mulesoft/contributor-agreements"
CLA_USERS="mulesoft,mulesoft-labs,mulesoft-consulting"
```

## License

Apache License 2.0

[travis-image]: https://img.shields.io/travis/mulesoft-labs/github-cla-webhook.svg?style=flat
[travis-url]: https://travis-ci.org/mulesoft-labs/github-cla-webhook
[coveralls-image]: https://img.shields.io/coveralls/mulesoft-labs/github-cla-webhook.svg?style=flat
[coveralls-url]: https://coveralls.io/r/mulesoft-labs/github-cla-webhook?branch=master
