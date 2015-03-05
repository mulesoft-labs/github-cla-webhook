var express = require('express')
var app = module.exports = express()
var port = process.env.PORT || 3000

app.use(require('./routes'))

if (!module.parent) {
  app.listen(port)
}
