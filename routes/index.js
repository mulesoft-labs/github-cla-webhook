var express = require('express')
var bodyParser = require('body-parser')
var app = module.exports = express.Router()

app.use(bodyParser.json())

app.post('/webhook', require('./webhook'))
